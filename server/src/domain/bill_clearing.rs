//! 按固定账单范围重放清偿。每笔账单的剩余头寸始终守恒，统一收付的中转债务也有归属。
use std::collections::{BTreeMap, BTreeSet, VecDeque};
use uuid::Uuid;

type Positions = BTreeMap<(Uuid, Uuid), i64>;

#[derive(Clone, Debug)]
pub struct ClearingEntry {
    pub expense_id: Uuid,
    pub member_id: Uuid,
    pub settlement_id: Option<Uuid>,
    pub offset_expense_id: Option<Uuid>,
    pub amount_minor: i64,
    pub origin: String,
}

#[derive(Clone, Debug)]
struct Edge {
    expense: Uuid,
    from: Uuid,
    to: Uuid,
    amount: i64,
}

/// 原始头寸仅用于展示清偿进度；剩余头寸可以包含后来代收款的成员，不能用展示进度代替余额。
#[derive(Clone, Debug, Default)]
pub struct ClearingState {
    pub original: Positions,
    pub remaining: Positions,
    pub entries: Vec<ClearingEntry>,
    pub expense_order: Vec<Uuid>,
    /// 没有存续账单承接的真实付款保留为独立现金头寸，只能在全活动范围内退回或确认抵销。
    pub cash_positions: BTreeSet<Uuid>,
}

impl ClearingState {
    #[must_use]
    pub fn scope_with_cash(&self, scope: &[Uuid]) -> Vec<Uuid> {
        scope
            .iter()
            .chain(self.cash_positions.iter())
            .copied()
            .collect()
    }
    /// # Errors
    /// 范围内成员金额累加溢出时返回错误。
    pub fn balances(&self, scope: &[Uuid]) -> Result<BTreeMap<Uuid, i64>, String> {
        let ids = scope.iter().copied().collect::<BTreeSet<_>>();
        let mut result = BTreeMap::<Uuid, i64>::new();
        for ((expense, member), net) in &self.remaining {
            if ids.contains(expense) {
                let value = result.entry(*member).or_default();
                *value = value.checked_add(*net).ok_or("结算金额超出安全范围")?;
            }
        }
        Ok(result)
    }

    fn edges(&self, scope: &[Uuid]) -> Vec<Edge> {
        let ids = scope.iter().copied().collect::<BTreeSet<_>>();
        let mut edges = Vec::new();
        for expense in self.expense_order.iter().filter(|id| ids.contains(id)) {
            let positions = self
                .remaining
                .iter()
                .filter(|((id, _), _)| id == expense)
                .collect::<Vec<_>>();
            for ((_, debtor), debt) in positions.iter().filter(|(_, net)| **net < 0) {
                for ((_, creditor), credit) in positions.iter().filter(|(_, net)| **net > 0) {
                    edges.push(Edge {
                        expense: *expense,
                        from: *debtor,
                        to: *creditor,
                        amount: (-**debt).min(**credit),
                    });
                }
            }
        }
        edges
    }

    fn path(edges: &[Edge], from: Uuid, to: Uuid) -> Option<Vec<Edge>> {
        let mut queue = VecDeque::from([from]);
        let mut visited = BTreeSet::from([from]);
        let mut previous = BTreeMap::<Uuid, Edge>::new();
        while let Some(member) = queue.pop_front() {
            for edge in edges.iter().filter(|edge| edge.from == member) {
                if !visited.insert(edge.to) {
                    continue;
                }
                previous.insert(edge.to, edge.clone());
                if edge.to == to {
                    let mut path = Vec::new();
                    let mut current = to;
                    while current != from {
                        let step = previous.get(&current)?.clone();
                        current = step.from;
                        path.push(step);
                    }
                    path.reverse();
                    return Some(path);
                }
                queue.push_back(edge.to);
            }
        }
        None
    }

    fn change(&mut self, expense: Uuid, member: Uuid, delta: i64) -> Result<(), String> {
        let net = self.remaining.entry((expense, member)).or_default();
        *net = net
            .checked_add(delta)
            .filter(|value| *value != i64::MIN)
            .ok_or("结算金额超出安全范围")?;
        Ok(())
    }

    fn record(
        &mut self,
        expense: Uuid,
        member: Uuid,
        settlement: Option<Uuid>,
        other: Option<Uuid>,
        amount: i64,
        origin: &str,
    ) {
        if expense.is_nil() || self.original.get(&(expense, member)).copied().unwrap_or(0) == 0 {
            return;
        }
        // 现金头寸的 ID 就是原转账 ID，抵销到真实账单时仍可追溯到这笔付款。
        let (settlement, other) = match other.filter(|id| self.cash_positions.contains(id)) {
            Some(id) => (Some(id), None),
            None => (settlement, other),
        };
        self.entries.push(ClearingEntry {
            expense_id: expense,
            member_id: member,
            settlement_id: settlement,
            offset_expense_id: other,
            amount_minor: amount,
            origin: origin.to_owned(),
        });
    }

    /// 沿债务路径核销两端现金及中间抵销；没有通向收款人的路径时，把待转出债务交给代收人。
    /// # Errors
    /// 头寸变化超出安全金额范围时返回错误。
    pub fn transfer(
        &mut self,
        id: Uuid,
        payer: Uuid,
        receiver: Uuid,
        mut amount: i64,
        scope: &[Uuid],
        origin: &str,
    ) -> Result<(), String> {
        while amount > 0 {
            if let Some(path) = Self::path(&self.edges(scope), payer, receiver) {
                let applied = path
                    .iter()
                    .map(|edge| edge.amount)
                    .min()
                    .unwrap_or(0)
                    .min(amount);
                for (index, edge) in path.iter().enumerate() {
                    self.change(edge.expense, edge.from, applied)?;
                    self.change(edge.expense, edge.to, -applied)?;
                    self.record(
                        edge.expense,
                        edge.from,
                        (index == 0).then_some(id),
                        index.checked_sub(1).map(|i| path[i].expense),
                        applied,
                        origin,
                    );
                    self.record(
                        edge.expense,
                        edge.to,
                        (index + 1 == path.len()).then_some(id),
                        path.get(index + 1).map(|e| e.expense),
                        applied,
                        origin,
                    );
                }
                amount -= applied;
            } else {
                let target = self
                    .expense_order
                    .iter()
                    .filter(|expense| scope.contains(expense))
                    .find_map(|expense| {
                        let net = self.remaining.get(&(*expense, payer)).copied().unwrap_or(0);
                        (net < 0).then_some((*expense, -net))
                    })
                    .or_else(|| {
                        self.expense_order
                            .iter()
                            .filter(|expense| scope.contains(expense))
                            .find_map(|expense| {
                                let net = self
                                    .remaining
                                    .get(&(*expense, receiver))
                                    .copied()
                                    .unwrap_or(0);
                                (net > 0).then_some((*expense, net))
                            })
                    });
                let (expense, capacity) = target.unwrap_or_else(|| {
                    let expense = scope
                        .iter()
                        .copied()
                        .find(|id| self.expense_order.contains(id))
                        .unwrap_or(id);
                    if expense == id {
                        self.cash_positions.insert(id);
                        if !self.expense_order.contains(&id) {
                            self.expense_order.push(id);
                        }
                    }
                    (expense, amount)
                });
                let applied = amount.min(capacity);
                self.change(expense, payer, applied)?;
                self.change(expense, receiver, -applied)?;
                self.record(expense, payer, Some(id), None, applied, origin);
                self.record(expense, receiver, Some(id), None, applied, origin);
                amount -= applied;
            }
        }
        Ok(())
    }

    /// 只消除完整债务环，每笔账单两侧等额变化；单独抵销一个成员会造成日期范围不守恒。
    /// # Errors
    /// 金额溢出或抵销路径不完整时返回错误。
    pub fn offsets(&mut self, scope: &[Uuid], origin: &str) -> Result<i64, String> {
        self.offsets_touching(scope, origin, &[])
    }

    /// 保留历史付款成员参与的抵销环。
    /// # Errors
    /// 金额溢出或抵销路径不完整时返回错误。
    pub fn offsets_touching(
        &mut self,
        scope: &[Uuid],
        origin: &str,
        members: &[Uuid],
    ) -> Result<i64, String> {
        let mut total = 0_i64;
        loop {
            let edges = self.edges(scope);
            let cycle = edges
                .iter()
                .filter(|edge| members.is_empty() || members.contains(&edge.from))
                .find_map(|edge| {
                    Self::path(&edges, edge.to, edge.from).map(|mut path| {
                        path.insert(0, edge.clone());
                        path
                    })
                });
            let Some(cycle) = cycle else {
                break;
            };
            let amount = cycle
                .iter()
                .map(|edge| edge.amount)
                .min()
                .ok_or("抵销路径为空")?;
            for (index, edge) in cycle.iter().enumerate() {
                self.change(edge.expense, edge.from, amount)?;
                self.change(edge.expense, edge.to, -amount)?;
                let previous = &cycle[(index + cycle.len() - 1) % cycle.len()];
                let next = &cycle[(index + 1) % cycle.len()];
                self.record(
                    edge.expense,
                    edge.from,
                    None,
                    Some(previous.expense),
                    amount,
                    origin,
                );
                self.record(
                    edge.expense,
                    edge.to,
                    None,
                    Some(next.expense),
                    amount,
                    origin,
                );
                total = total.checked_add(amount).ok_or("抵销金额超出安全范围")?;
            }
        }
        Ok(total)
    }

    /// 中转或反向付款可能恢复原有债务；展示金额以当前剩余头寸为上限，禁止累计重复计数。
    #[must_use]
    pub fn display_entries(&self) -> Vec<ClearingEntry> {
        let mut capacity = self
            .original
            .iter()
            .map(|(key, original)| {
                let remaining = self.remaining.get(key).copied().unwrap_or(0);
                let pending = if original.signum() == remaining.signum() {
                    remaining.abs()
                } else {
                    0
                };
                (*key, (original.abs() - pending).max(0))
            })
            .collect::<BTreeMap<_, _>>();
        self.entries
            .iter()
            .filter_map(|entry| {
                let available = capacity.get_mut(&(entry.expense_id, entry.member_id))?;
                let amount = (*available).min(entry.amount_minor);
                *available -= amount;
                (amount > 0).then(|| ClearingEntry {
                    amount_minor: amount,
                    ..entry.clone()
                })
            })
            .collect()
    }
}
