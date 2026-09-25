//! 从固定结算范围重建可追溯投影。预览复用同一重放函数，不写账务数据。
use crate::domain::bill_clearing::ClearingState;
use sqlx::{FromRow, PgConnection};
use time::OffsetDateTime;
use uuid::Uuid;

#[derive(FromRow)]
struct PositionRow {
    expense_id: Uuid,
    member_id: Uuid,
    net_minor: i64,
}

#[derive(FromRow)]
struct EventRow {
    id: Uuid,
    payer_member_id: Option<Uuid>,
    receiver_member_id: Option<Uuid>,
    amount_minor: i64,
    scope_expense_ids: Vec<Uuid>,
    clearing_origin: String,
    all_dates: bool,
}

/// 调用方负责事务一致性。排除某笔转账用于修改前的容量校验，不影响持久化事实。
/// # Errors
/// 查询失败、历史归属超额或头寸溢出时返回错误。
pub async fn load_state(
    connection: &mut PgConnection,
    activity_id: Uuid,
    excluded: Option<Uuid>,
) -> Result<ClearingState, sqlx::Error> {
    let mut state = ClearingState {
        expense_order: sqlx::query_scalar("SELECT id FROM expenses WHERE activity_id = $1 AND deleted_at IS NULL ORDER BY occurred_at, id")
            .bind(activity_id).fetch_all(&mut *connection).await?,
        ..ClearingState::default()
    };
    let positions = sqlx::query_as::<_, PositionRow>(
        "SELECT e.id AS expense_id, facts.member_id, sum(facts.amount_minor)::bigint AS net_minor \
         FROM expenses e JOIN (SELECT expense_id, payer_member_id AS member_id, base_amount_minor AS amount_minor \
         FROM expense_payments UNION ALL SELECT expense_id, member_id, -base_amount_minor FROM expense_shares) facts \
         ON facts.expense_id = e.id WHERE e.activity_id = $1 AND e.deleted_at IS NULL \
         GROUP BY e.id, facts.member_id HAVING sum(facts.amount_minor) <> 0",
    ).bind(activity_id).fetch_all(&mut *connection).await?;
    for position in positions {
        if position.net_minor == i64::MIN {
            return Err(integrity("账单金额超出安全范围"));
        }
        state.original.insert(
            (position.expense_id, position.member_id),
            position.net_minor,
        );
    }
    state.remaining.clone_from(&state.original);
    let events = sqlx::query_as::<_, EventRow>(
        "SELECT id, payer_member_id, receiver_member_id, amount_minor, scope_expense_ids, clearing_origin, all_dates FROM ( \
         SELECT id, payer_member_id, receiver_member_id, amount_minor, scope_expense_ids, clearing_origin, clearing_order, created_at, COALESCE(scope_request->>'dates', 'null') = 'null' AS all_dates \
         FROM settlements WHERE activity_id = $1 AND status = 'ACTIVE' AND ($2::uuid IS NULL OR id <> $2) UNION ALL \
         SELECT id, NULL::uuid, NULL::uuid, 0::bigint, scope_expense_ids, 'AUTO', clearing_order, created_at, COALESCE(scope_request->>'dates', 'null') = 'null' \
         FROM bill_offset_confirmations WHERE activity_id = $1) events ORDER BY clearing_order, created_at, id",
    ).bind(activity_id).bind(excluded).fetch_all(&mut *connection).await?;
    for event in events {
        let scope = if event.all_dates {
            state.scope_with_cash(&event.scope_expense_ids)
        } else {
            event.scope_expense_ids.clone()
        };
        if let (Some(payer), Some(receiver)) = (event.payer_member_id, event.receiver_member_id) {
            let explicit = sqlx::query_as::<_, (Uuid, i64)>("SELECT expense_id, amount_minor FROM settlement_allocations WHERE settlement_id = $1 ORDER BY expense_id")
                .bind(event.id).fetch_all(&mut *connection).await?;
            let mut available = event.amount_minor;
            for (expense, amount) in explicit {
                available = available
                    .checked_sub(amount)
                    .filter(|a| *a >= 0)
                    .ok_or_else(|| integrity("历史归属超过实际转账"))?;
                state
                    .transfer(
                        event.id,
                        payer,
                        receiver,
                        amount,
                        &[expense],
                        "HISTORICAL_EXPLICIT",
                    )
                    .map_err(integrity)?;
            }
            state
                .transfer(
                    event.id,
                    payer,
                    receiver,
                    available,
                    &scope,
                    &event.clearing_origin,
                )
                .map_err(integrity)?;
            // 历史未确认的纯抵销不能借用无关转账固化；仅保留与该付款成员相连的抵销。
            if event.clearing_origin == "HISTORICAL_AUTO" {
                state
                    .offsets_touching(&scope, &event.clearing_origin, &[payer, receiver])
                    .map_err(integrity)?;
            } else {
                state
                    .offsets(&scope, &event.clearing_origin)
                    .map_err(integrity)?;
            }
        } else {
            state.offsets(&scope, "AUTO").map_err(integrity)?;
        }
    }
    Ok(state)
}

/// 在持有活动行锁的事务内更新派生记录；固定账单集合保证新增账单不会扩大旧付款范围。
/// # Errors
/// 重放失败或派生记录写入失败时返回错误，调用方必须回滚事务。
pub async fn reconcile_activity(
    connection: &mut PgConnection,
    activity_id: Uuid,
    _preserve_existing: bool,
    _origin: &'static str,
    now: OffsetDateTime,
) -> Result<(), sqlx::Error> {
    let state = load_state(connection, activity_id, None).await?;
    sqlx::query("DELETE FROM bill_clearing_entries WHERE activity_id = $1")
        .bind(activity_id)
        .execute(&mut *connection)
        .await?;
    for entry in state.display_entries() {
        sqlx::query("INSERT INTO bill_clearing_entries (id, activity_id, expense_id, member_id, settlement_id, offset_expense_id, kind, amount_minor, origin, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)")
            .bind(Uuid::new_v4()).bind(activity_id).bind(entry.expense_id).bind(entry.member_id)
            .bind(entry.settlement_id).bind(entry.offset_expense_id)
            .bind(if entry.settlement_id.is_some() { "PAYMENT" } else { "OFFSET" })
            .bind(entry.amount_minor).bind(entry.origin).bind(now).execute(&mut *connection).await?;
    }
    Ok(())
}

fn integrity(message: impl Into<String>) -> sqlx::Error {
    sqlx::Error::Protocol(message.into())
}
