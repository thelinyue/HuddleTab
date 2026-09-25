//! 日期结算使用账单本地日和固定账单集合；普通 revision 与活动行锁保护预览到提交的间隙。
use super::bill_clearing::{load_state, reconcile_activity};
use crate::application::{
    accounting::{LedgerMember, RequestedRecommendationStrategy, resolve_strategy},
    settlement::{SettlementRepositoryError as Error, SettlementScope},
    settlement_scope::{
        ConfirmBillOffsetsData, ScopeBalance, ScopeRecommendation, SettlementDateOption,
        SettlementPreview, SettlementPreviewRequest,
    },
};
use crate::domain::{
    ledger::Balance,
    settlement::{RecommendationStrategy, recommend_settlements_with_strategy},
};
use sqlx::{PgConnection, PgPool};
use std::collections::BTreeSet;
use time::{Date, OffsetDateTime, macros::format_description};
use uuid::Uuid;

/// # Errors
/// 日期为空、格式错误或时区名称无效时返回范围错误。
pub fn normalize_scope(mut scope: SettlementScope) -> Result<SettlementScope, Error> {
    if let Some(dates) = &mut scope.dates {
        if dates.is_empty() {
            return Err(Error::InvalidScope);
        }
        for date in dates.iter() {
            if date.len() != 10
                || Date::parse(date, format_description!("[year]-[month]-[day]")).is_err()
            {
                return Err(Error::InvalidScope);
            }
        }
        dates.sort();
        dates.dedup();
    }
    if scope.time_zone.is_empty() || scope.time_zone.len() > 100 {
        return Err(Error::InvalidScope);
    }
    Ok(scope)
}

async fn resolve_expenses(
    connection: &mut PgConnection,
    activity: Uuid,
    scope: &SettlementScope,
) -> Result<(Vec<Uuid>, Vec<SettlementDateOption>), Error> {
    let timezone_exists: bool =
        sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = $1)")
            .bind(&scope.time_zone)
            .fetch_one(&mut *connection)
            .await
            .map_err(database_error)?;
    if !timezone_exists {
        return Err(Error::InvalidScope);
    }
    let rows = sqlx::query_as::<_, (Uuid, String)>("SELECT id, to_char(occurred_at AT TIME ZONE $2, 'YYYY-MM-DD') FROM expenses WHERE activity_id = $1 AND deleted_at IS NULL ORDER BY occurred_at, id")
        .bind(activity).bind(&scope.time_zone).fetch_all(&mut *connection).await.map_err(database_error)?;
    let mut options = std::collections::BTreeMap::<String, i64>::new();
    let mut ids = Vec::new();
    for (id, date) in rows {
        *options.entry(date.clone()).or_default() += 1;
        if scope
            .dates
            .as_ref()
            .is_none_or(|dates| dates.contains(&date))
        {
            ids.push(id);
        }
    }
    if scope
        .dates
        .as_ref()
        .is_some_and(|dates| dates.iter().any(|date| !options.contains_key(date)))
    {
        return Err(Error::InvalidScope);
    }
    Ok((
        ids,
        options
            .into_iter()
            .rev()
            .map(|(date, expense_count)| SettlementDateOption {
                date,
                expense_count,
            })
            .collect(),
    ))
}

async fn context(
    connection: &mut PgConnection,
    activity: Uuid,
    user: Uuid,
    writable: bool,
) -> Result<(String, i64, Uuid), Error> {
    sqlx::query_as("SELECT a.base_currency, a.revision, m.id FROM activities a JOIN activity_members m ON m.activity_id = a.id WHERE a.id = $1 AND m.user_id = $2 AND m.status = 'ACTIVE' AND (NOT $3 OR a.status IN ('ACTIVE','ENDED'))")
        .bind(activity).bind(user).bind(writable).fetch_optional(&mut *connection).await.map_err(database_error)?.ok_or(Error::Forbidden)
}

async fn strategy(
    connection: &mut PgConnection,
    activity: Uuid,
    actor: Uuid,
    scope: &SettlementScope,
) -> Result<(RecommendationStrategy, Vec<Uuid>), Error> {
    let members = sqlx::query_as::<_, (Uuid, Option<Uuid>, String)>(
        "SELECT id, user_id, status FROM activity_members WHERE activity_id = $1 ORDER BY id",
    )
    .bind(activity)
    .fetch_all(&mut *connection)
    .await
    .map_err(database_error)?
    .into_iter()
    .map(|(member_id, user_id, status)| LedgerMember {
        member_id,
        user_id,
        status,
    })
    .collect::<Vec<_>>();
    let requested = match (scope.strategy.as_deref(), scope.hub_member_id.as_deref()) {
        (None, None) => RequestedRecommendationStrategy::Default,
        (Some("min_transfers"), None) => RequestedRecommendationStrategy::MinTransfers,
        (Some("centralized"), Some(id)) => RequestedRecommendationStrategy::Centralized {
            hub_member_id: Uuid::parse_str(id).map_err(|_| Error::InvalidScope)?,
        },
        _ => return Err(Error::InvalidScope),
    };
    let strategy = resolve_strategy(&members, actor, requested).map_err(|_| Error::InvalidScope)?;
    Ok((strategy, members.into_iter().map(|m| m.member_id).collect()))
}

/// 读取同一数据库快照中的日期、余额和推荐，不写入清偿关系。
/// # Errors
/// 权限不足、范围或策略无效、数据库不可用时返回错误。
pub async fn preview(
    pool: &PgPool,
    activity: Uuid,
    user: Uuid,
    request: SettlementPreviewRequest,
) -> Result<SettlementPreview, Error> {
    let mut transaction = pool.begin().await.map_err(database_error)?;
    sqlx::query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
        .execute(&mut *transaction)
        .await
        .map_err(database_error)?;
    let (currency, revision, actor) = context(&mut transaction, activity, user, false).await?;
    let scope = normalize_scope(SettlementScope {
        dates: request.dates,
        time_zone: request.time_zone,
        revision: revision.to_string(),
        strategy: request.strategy,
        hub_member_id: request.hub_member_id,
    })?;
    let (ids, date_options) = resolve_expenses(&mut transaction, activity, &scope).await?;
    let (strategy, members) = strategy(&mut transaction, activity, actor, &scope).await?;
    let state = load_state(&mut transaction, activity, None)
        .await
        .map_err(database_error)?;
    let balance_ids = if scope.dates.is_none() {
        state.scope_with_cash(&ids)
    } else {
        ids.clone()
    };
    let values = state.balances(&balance_ids).map_err(integrity_error)?;
    let balances = members
        .into_iter()
        .map(|member| Balance::new(member, values.get(&member).copied().unwrap_or(0)))
        .collect::<Vec<_>>();
    let recommendations = recommend_settlements_with_strategy(&balances, strategy)
        .map_err(|e| integrity_error(e.to_string()))?;
    let mut simulated = state.clone();
    let before = simulated.entries.len();
    let offset = simulated
        .offsets(&balance_ids, "AUTO")
        .map_err(integrity_error)?;
    let offset_expense_count = simulated.entries[before..]
        .iter()
        .map(|entry| entry.expense_id)
        .collect::<BTreeSet<_>>()
        .len();
    let requires_offset_confirmation = recommendations.is_empty() && offset > 0;
    let settled = recommendations.is_empty() && offset == 0;
    let (effective_strategy, hub_member_id) = match strategy {
        RecommendationStrategy::MinTransfers => ("MIN_TRANSFERS", None),
        RecommendationStrategy::Centralized { hub_member_id } => {
            ("CENTRALIZED", Some(hub_member_id.to_string()))
        }
    };
    transaction.commit().await.map_err(database_error)?;
    Ok(SettlementPreview {
        scope,
        base_currency: currency.trim().to_owned(),
        revision: revision.to_string(),
        expense_ids: ids.iter().map(ToString::to_string).collect(),
        date_options,
        balances: balances
            .into_iter()
            .map(|b| ScopeBalance {
                member_id: b.member_id().to_string(),
                net_minor: b.net_minor().to_string(),
            })
            .collect(),
        recommendations: recommendations
            .into_iter()
            .map(|r| ScopeRecommendation {
                payer_member_id: r.payer_member_id().to_string(),
                receiver_member_id: r.receiver_member_id().to_string(),
                amount_minor: r.amount_minor().to_string(),
            })
            .collect(),
        effective_strategy: effective_strategy.into(),
        hub_member_id,
        offset_minor: offset.to_string(),
        offset_expense_count,
        requires_offset_confirmation,
        settled,
    })
}

/// 锁内校验预览版本，再取服务器账单集合。幂等重放必须在此之前返回，不能被新 revision 拦截。
/// # Errors
/// 预览过期、金额超出范围、权限不足或数据库不可用时返回错误。
pub async fn validate_submission(
    connection: &mut PgConnection,
    activity: Uuid,
    user: Uuid,
    scope: &SettlementScope,
    payer: Uuid,
    receiver: Uuid,
    amount: i64,
) -> Result<Vec<Uuid>, Error> {
    let (_, revision, actor) = context(connection, activity, user, true).await?;
    if scope.revision != revision.to_string() {
        return Err(Error::PreviewExpired);
    }
    let (ids, _) = resolve_expenses(connection, activity, scope).await?;
    validate_transfer(
        connection, activity, actor, scope, &ids, payer, receiver, amount, None,
    )
    .await?;
    Ok(ids)
}

/// 校验固定范围内转账容量；修改记录时可排除该记录后重放。
/// # Errors
/// 金额、策略或成员不匹配，或数据库不可用时返回错误。
#[allow(clippy::too_many_arguments)] // 与创建和修改共同使用的锁内校验直接接收事实字段。
pub async fn validate_transfer(
    connection: &mut PgConnection,
    activity: Uuid,
    actor: Uuid,
    scope: &SettlementScope,
    ids: &[Uuid],
    payer: Uuid,
    receiver: Uuid,
    amount: i64,
    excluded: Option<Uuid>,
) -> Result<(), Error> {
    if amount <= 0 {
        return Err(Error::InvalidScope);
    }
    let (selected_strategy, members) = strategy(connection, activity, actor, scope).await?;
    let state = load_state(connection, activity, excluded)
        .await
        .map_err(database_error)?;
    let balance_ids = if scope.dates.is_none() {
        state.scope_with_cash(ids)
    } else {
        ids.to_vec()
    };
    let values = state.balances(&balance_ids).map_err(integrity_error)?;
    let capacity = if selected_strategy == RecommendationStrategy::MinTransfers {
        values
            .get(&payer)
            .copied()
            .unwrap_or(0)
            .saturating_neg()
            .max(0)
            .min(values.get(&receiver).copied().unwrap_or(0).max(0))
    } else {
        let balances = members
            .into_iter()
            .map(|id| Balance::new(id, values.get(&id).copied().unwrap_or(0)))
            .collect::<Vec<_>>();
        recommend_settlements_with_strategy(&balances, selected_strategy)
            .map_err(|e| integrity_error(e.to_string()))?
            .iter()
            .find(|r| r.payer_member_id() == payer && r.receiver_member_id() == receiver)
            .map_or(
                0,
                crate::domain::settlement::SettlementRecommendation::amount_minor,
            )
    };
    if amount > capacity {
        return Err(Error::InvalidScope);
    }
    Ok(())
}

/// 原子确认抵销，不创建零金额转账。
/// # Errors
/// 权限、范围、revision、幂等校验失败，或数据库不可用时返回错误。
pub async fn confirm_offsets(
    pool: &PgPool,
    activity: Uuid,
    user: Uuid,
    mutation: Uuid,
    scope: SettlementScope,
) -> Result<ConfirmBillOffsetsData, Error> {
    let scope = normalize_scope(scope)?;
    let mut transaction = pool.begin().await.map_err(database_error)?;
    sqlx::query("SELECT id FROM activities WHERE id = $1 FOR UPDATE")
        .bind(activity)
        .execute(&mut *transaction)
        .await
        .map_err(database_error)?;
    let (_, revision, actor) = context(&mut transaction, activity, user, true).await?;
    let value = serde_json::to_value(&scope).map_err(|e| integrity_error(e.to_string()))?;
    if let Some((id, old_activity, old_scope, order)) = sqlx::query_as::<_, (Uuid, Uuid, serde_json::Value, i64)>("SELECT id, activity_id, scope_request, clearing_order FROM bill_offset_confirmations WHERE created_by_user_id = $1 AND client_mutation_id = $2")
        .bind(user).bind(mutation).fetch_optional(&mut *transaction).await.map_err(database_error)? {
        if old_activity != activity || old_scope != value { return Err(Error::MutationConflict); }
        return Ok(ConfirmBillOffsetsData { confirmation_id: id.to_string(), revision: order.to_string(), idempotent_replay: true });
    }
    if scope.revision != revision.to_string() {
        return Err(Error::PreviewExpired);
    }
    let (ids, _) = resolve_expenses(&mut transaction, activity, &scope).await?;
    strategy(&mut transaction, activity, actor, &scope).await?;
    let mut state = load_state(&mut transaction, activity, None)
        .await
        .map_err(database_error)?;
    let balance_ids = if scope.dates.is_none() {
        state.scope_with_cash(&ids)
    } else {
        ids.clone()
    };
    if state
        .balances(&balance_ids)
        .map_err(integrity_error)?
        .values()
        .any(|value| *value != 0)
        || state
            .offsets(&balance_ids, "AUTO")
            .map_err(integrity_error)?
            == 0
    {
        return Err(Error::InvalidScope);
    }
    let id = Uuid::new_v4();
    let now = OffsetDateTime::now_utc();
    sqlx::query("INSERT INTO bill_offset_confirmations (id, activity_id, created_by_user_id, client_mutation_id, scope_request, scope_expense_ids, clearing_order, created_at, scope_dates) VALUES ($1,$2,$3,$4,$5,$6,$7,$8, ARRAY(SELECT DISTINCT to_char(occurred_at AT TIME ZONE $9, 'YYYY-MM-DD') FROM expenses WHERE id = ANY($6)))")
        .bind(id).bind(activity).bind(user).bind(mutation).bind(value).bind(&ids).bind(revision + 1).bind(now).bind(&scope.time_zone).execute(&mut *transaction).await.map_err(database_error)?;
    reconcile_activity(&mut transaction, activity, false, "AUTO", now)
        .await
        .map_err(database_error)?;
    sqlx::query("UPDATE activities SET revision = revision + 1, updated_at = $2 WHERE id = $1")
        .bind(activity)
        .bind(now)
        .execute(&mut *transaction)
        .await
        .map_err(database_error)?;
    sqlx::query("INSERT INTO activity_audit_logs (id, activity_id, actor_user_id, actor_member_id, action, resource_type, resource_id, activity_revision, created_at) VALUES ($1,$2,$3,$4,'BILL_OFFSETS_CONFIRMED','BILL_OFFSET_CONFIRMATION',$5,$6,$7)")
        .bind(Uuid::new_v4()).bind(activity).bind(user).bind(actor).bind(id).bind(revision + 1).bind(now).execute(&mut *transaction).await.map_err(database_error)?;
    transaction.commit().await.map_err(database_error)?;
    Ok(ConfirmBillOffsetsData {
        confirmation_id: id.to_string(),
        revision: (revision + 1).to_string(),
        idempotent_replay: false,
    })
}

#[allow(clippy::needless_pass_by_value)] // 供 Result::map_err 直接消费错误。
fn database_error(error: sqlx::Error) -> Error {
    tracing::error!(%error, "日期结算数据访问失败");
    Error::Unavailable
}
#[allow(clippy::needless_pass_by_value)] // 供 Result::map_err 直接消费错误。
fn integrity_error(error: String) -> Error {
    tracing::error!(%error, "日期结算账务事实不一致");
    Error::Unavailable
}
