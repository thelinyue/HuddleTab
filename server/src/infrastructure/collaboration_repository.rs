use async_trait::async_trait;
use sqlx::{PgPool, Postgres, Transaction};
use time::OffsetDateTime;
use uuid::Uuid;

use crate::application::collaboration::{
    CollaborationRepository, CollaborationRepositoryError, GuestMember, Invitation, InvitationKind,
    InvitationPreview, JoinInvitationInput, JoinStatus, JoinedInvitation, NewGuest, NewInvitation,
};
use crate::domain::activity::InviteMode;

#[derive(Clone, Debug)]
pub struct PostgresCollaborationRepository {
    pool: PgPool,
}

impl PostgresCollaborationRepository {
    #[must_use]
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl CollaborationRepository for PostgresCollaborationRepository {
    async fn create_guest(
        &self,
        guest: NewGuest,
    ) -> Result<GuestMember, CollaborationRepositoryError> {
        let mut transaction = self.pool.begin().await.map_err(log_repository_error)?;
        let actor_member_id =
            authorize_owner(&mut transaction, guest.activity_id, guest.actor_user_id).await?;
        sqlx::query(
            "INSERT INTO activity_members (id, activity_id, display_name, role, joined_at) \
             VALUES ($1, $2, $3, 'MEMBER', $4)",
        )
        .bind(guest.id)
        .bind(guest.activity_id)
        .bind(&guest.display_name)
        .bind(guest.now)
        .execute(&mut *transaction)
        .await
        .map_err(log_repository_error)?;
        let revision = revise_and_audit(
            &mut transaction,
            AuditEntry {
                activity_id: guest.activity_id,
                actor_user_id: guest.actor_user_id,
                actor_member_id: Some(actor_member_id),
                action: "MEMBER_GUEST_ADDED",
                resource_type: "ACTIVITY_MEMBER",
                resource_id: guest.id,
                now: guest.now,
            },
        )
        .await?;
        transaction.commit().await.map_err(log_repository_error)?;
        Ok(GuestMember {
            id: guest.id,
            activity_id: guest.activity_id,
            display_name: guest.display_name,
            version: 1,
            revision,
        })
    }

    async fn create_invitation(
        &self,
        invitation: NewInvitation,
    ) -> Result<Invitation, CollaborationRepositoryError> {
        let mut transaction = self.pool.begin().await.map_err(log_repository_error)?;
        let actor_member_id = authorize_owner(
            &mut transaction,
            invitation.activity_id,
            invitation.actor_user_id,
        )
        .await?;
        sqlx::query(
            "INSERT INTO activity_invites (id, activity_id, created_by_member_id, token_hash, \
             kind, target_username, expires_at, max_uses, created_at) \
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
        )
        .bind(invitation.id)
        .bind(invitation.activity_id)
        .bind(actor_member_id)
        .bind(invitation.token_hash.as_slice())
        .bind(invitation.kind.as_str())
        .bind(&invitation.target_username)
        .bind(invitation.expires_at)
        .bind(invitation.max_uses)
        .bind(invitation.now)
        .execute(&mut *transaction)
        .await
        .map_err(log_repository_error)?;
        let revision = revise_and_audit(
            &mut transaction,
            AuditEntry {
                activity_id: invitation.activity_id,
                actor_user_id: invitation.actor_user_id,
                actor_member_id: Some(actor_member_id),
                action: "INVITATION_CREATED",
                resource_type: "INVITATION",
                resource_id: invitation.id,
                now: invitation.now,
            },
        )
        .await?;
        transaction.commit().await.map_err(log_repository_error)?;
        Ok(Invitation {
            id: invitation.id,
            activity_id: invitation.activity_id,
            kind: invitation.kind,
            target_username: invitation.target_username,
            expires_at: invitation.expires_at,
            max_uses: invitation.max_uses,
            use_count: 0,
            revoked_at: None,
            version: 1,
            revision,
        })
    }

    async fn list_invitations(
        &self,
        activity_id: Uuid,
        actor_user_id: Uuid,
    ) -> Result<Vec<Invitation>, CollaborationRepositoryError> {
        let mut transaction = self.pool.begin().await.map_err(log_repository_error)?;
        authorize_owner(&mut transaction, activity_id, actor_user_id).await?;
        let rows = sqlx::query_as::<
            _,
            (
                Uuid,
                String,
                Option<String>,
                OffsetDateTime,
                Option<i32>,
                i32,
                Option<OffsetDateTime>,
                i64,
            ),
        >(
            "SELECT id, kind, target_username, expires_at, max_uses, use_count, revoked_at, version \
             FROM activity_invites WHERE activity_id = $1 ORDER BY created_at DESC, id",
        )
        .bind(activity_id)
        .fetch_all(&mut *transaction)
        .await
        .map_err(log_repository_error)?;
        let revision =
            sqlx::query_scalar::<_, i64>("SELECT revision FROM activities WHERE id = $1")
                .bind(activity_id)
                .fetch_one(&mut *transaction)
                .await
                .map_err(log_repository_error)?;
        transaction.commit().await.map_err(log_repository_error)?;
        rows.into_iter()
            .map(|row| invitation_from_row(activity_id, revision, row))
            .collect()
    }

    async fn revoke_invitation(
        &self,
        activity_id: Uuid,
        invitation_id: Uuid,
        actor_user_id: Uuid,
        now: OffsetDateTime,
    ) -> Result<Invitation, CollaborationRepositoryError> {
        let mut transaction = self.pool.begin().await.map_err(log_repository_error)?;
        let actor_member_id = authorize_owner(&mut transaction, activity_id, actor_user_id).await?;
        let row = sqlx::query_as::<
            _,
            (
                String,
                Option<String>,
                OffsetDateTime,
                Option<i32>,
                i32,
                Option<OffsetDateTime>,
                i64,
            ),
        >(
            "SELECT kind, target_username, expires_at, max_uses, use_count, revoked_at, version \
             FROM activity_invites WHERE activity_id = $1 AND id = $2 FOR UPDATE",
        )
        .bind(activity_id)
        .bind(invitation_id)
        .fetch_optional(&mut *transaction)
        .await
        .map_err(log_repository_error)?
        .ok_or(CollaborationRepositoryError::NotFound)?;
        let revision = if row.5.is_some() {
            sqlx::query_scalar("SELECT revision FROM activities WHERE id = $1")
                .bind(activity_id)
                .fetch_one(&mut *transaction)
                .await
                .map_err(log_repository_error)?
        } else {
            sqlx::query(
                "UPDATE activity_invites SET revoked_at = $1, version = version + 1 WHERE id = $2",
            )
            .bind(now)
            .bind(invitation_id)
            .execute(&mut *transaction)
            .await
            .map_err(log_repository_error)?;
            revise_and_audit(
                &mut transaction,
                AuditEntry {
                    activity_id,
                    actor_user_id,
                    actor_member_id: Some(actor_member_id),
                    action: "INVITATION_REVOKED",
                    resource_type: "INVITATION",
                    resource_id: invitation_id,
                    now,
                },
            )
            .await?
        };
        transaction.commit().await.map_err(log_repository_error)?;
        Ok(Invitation {
            id: invitation_id,
            activity_id,
            kind: parse_kind(&row.0)?,
            target_username: row.1,
            expires_at: row.2,
            max_uses: row.3,
            use_count: row.4,
            revoked_at: row.5.or(Some(now)),
            version: row.6 + i64::from(row.5.is_none()),
            revision,
        })
    }

    async fn preview_invitation(
        &self,
        token_hash: &[u8; 32],
        now: OffsetDateTime,
    ) -> Result<Option<InvitationPreview>, CollaborationRepositoryError> {
        let row = sqlx::query_as::<_, (Uuid, String, i64, String, OffsetDateTime)>(
            "SELECT a.id, a.name, \
             (SELECT count(*) FROM activity_members m \
              WHERE m.activity_id = a.id AND m.status = 'ACTIVE'), i.kind, i.expires_at \
             FROM activity_invites i JOIN activities a ON a.id = i.activity_id \
             WHERE i.token_hash = $1 AND i.revoked_at IS NULL AND i.expires_at > $2 \
               AND (i.max_uses IS NULL OR i.use_count < i.max_uses) \
               AND a.status = 'ACTIVE' AND a.deleted_at IS NULL",
        )
        .bind(token_hash.as_slice())
        .bind(now)
        .fetch_optional(&self.pool)
        .await
        .map_err(log_repository_error)?;
        row.map(
            |(activity_id, activity_name, active_member_count, kind, expires_at)| {
                Ok(InvitationPreview {
                    activity_id,
                    activity_name,
                    active_member_count,
                    kind: parse_kind(&kind)?,
                    expires_at,
                })
            },
        )
        .transpose()
    }

    async fn join_invitation(
        &self,
        input: JoinInvitationInput,
    ) -> Result<JoinedInvitation, CollaborationRepositoryError> {
        let mut transaction = self.pool.begin().await.map_err(log_repository_error)?;
        let invitation = sqlx::query_as::<_, (Uuid, Uuid, String, Option<String>, String)>(
            "SELECT i.id, i.activity_id, i.kind, i.target_username, a.invite_mode \
             FROM activity_invites i JOIN activities a ON a.id = i.activity_id \
             WHERE i.token_hash = $1 AND i.revoked_at IS NULL AND i.expires_at > $2 \
               AND (i.max_uses IS NULL OR i.use_count < i.max_uses) \
               AND a.status = 'ACTIVE' AND a.deleted_at IS NULL \
             FOR UPDATE OF i, a",
        )
        .bind(input.token_hash.as_slice())
        .bind(input.now)
        .fetch_optional(&mut *transaction)
        .await
        .map_err(log_repository_error)?
        .ok_or(CollaborationRepositoryError::NotFound)?;
        let kind = parse_kind(&invitation.2)?;
        if kind == InvitationKind::Direct
            && invitation.3.as_deref() != Some(input.username.as_str())
        {
            return Err(CollaborationRepositoryError::Forbidden);
        }
        let existing_member = sqlx::query_as::<_, (Uuid, String)>(
            "SELECT id, status FROM activity_members WHERE activity_id = $1 AND user_id = $2 \
             FOR UPDATE",
        )
        .bind(invitation.1)
        .bind(input.user_id)
        .fetch_optional(&mut *transaction)
        .await
        .map_err(log_repository_error)?;
        if let Some((member_id, status)) = &existing_member {
            if status == "ACTIVE" {
                let revision = sqlx::query_scalar("SELECT revision FROM activities WHERE id = $1")
                    .bind(invitation.1)
                    .fetch_one(&mut *transaction)
                    .await
                    .map_err(log_repository_error)?;
                transaction.commit().await.map_err(log_repository_error)?;
                return Ok(JoinedInvitation {
                    status: JoinStatus::AlreadyMember,
                    activity_id: invitation.1,
                    member_id: Some(*member_id),
                    request_id: None,
                    revision,
                });
            }
        }
        let invite_mode = InviteMode::parse(&invitation.4)
            .map_err(|_| CollaborationRepositoryError::Unavailable)?;
        if invite_mode == InviteMode::RequireApproval {
            let pending =
                create_or_replay_join_request(&mut transaction, &input, invitation.0, invitation.1)
                    .await?;
            transaction.commit().await.map_err(log_repository_error)?;
            return Ok(pending);
        }
        if let Some((member_id, _)) = existing_member {
            sqlx::query(
                "UPDATE activity_members SET status = 'ACTIVE', left_at = NULL, display_name = $1, \
                 version = version + 1 WHERE id = $2",
            )
            .bind(&input.display_name)
            .bind(member_id)
            .execute(&mut *transaction)
            .await
            .map_err(log_repository_error)?;
            let joined = finish_join(
                &mut transaction,
                input,
                invitation.0,
                invitation.1,
                member_id,
            )
            .await?;
            transaction.commit().await.map_err(log_repository_error)?;
            return Ok(joined);
        }
        let member_id = Uuid::new_v4();
        sqlx::query(
            "INSERT INTO activity_members (id, activity_id, user_id, display_name, role, joined_at) \
             VALUES ($1, $2, $3, $4, 'MEMBER', $5)",
        )
        .bind(member_id)
        .bind(invitation.1)
        .bind(input.user_id)
        .bind(&input.display_name)
        .bind(input.now)
        .execute(&mut *transaction)
        .await
        .map_err(log_repository_error)?;
        let joined = finish_join(
            &mut transaction,
            input,
            invitation.0,
            invitation.1,
            member_id,
        )
        .await?;
        transaction.commit().await.map_err(log_repository_error)?;
        Ok(joined)
    }
}

type InvitationRow = (
    Uuid,
    String,
    Option<String>,
    OffsetDateTime,
    Option<i32>,
    i32,
    Option<OffsetDateTime>,
    i64,
);

fn invitation_from_row(
    activity_id: Uuid,
    revision: i64,
    row: InvitationRow,
) -> Result<Invitation, CollaborationRepositoryError> {
    Ok(Invitation {
        id: row.0,
        activity_id,
        kind: parse_kind(&row.1)?,
        target_username: row.2,
        expires_at: row.3,
        max_uses: row.4,
        use_count: row.5,
        revoked_at: row.6,
        version: row.7,
        revision,
    })
}

async fn authorize_owner(
    transaction: &mut Transaction<'_, Postgres>,
    activity_id: Uuid,
    actor_user_id: Uuid,
) -> Result<Uuid, CollaborationRepositoryError> {
    sqlx::query_scalar::<_, Uuid>(
        "SELECT m.id FROM activities a JOIN activity_members m ON m.activity_id = a.id \
         WHERE a.id = $1 AND a.status = 'ACTIVE' AND a.deleted_at IS NULL AND m.user_id = $2 \
           AND m.role = 'OWNER' AND m.status = 'ACTIVE' FOR UPDATE OF a",
    )
    .bind(activity_id)
    .bind(actor_user_id)
    .fetch_optional(&mut **transaction)
    .await
    .map_err(log_repository_error)?
    .ok_or(CollaborationRepositoryError::Forbidden)
}

struct AuditEntry {
    activity_id: Uuid,
    actor_user_id: Uuid,
    actor_member_id: Option<Uuid>,
    action: &'static str,
    resource_type: &'static str,
    resource_id: Uuid,
    now: OffsetDateTime,
}

async fn revise_and_audit(
    transaction: &mut Transaction<'_, Postgres>,
    entry: AuditEntry,
) -> Result<i64, CollaborationRepositoryError> {
    let revision = sqlx::query_scalar::<_, i64>(
        "UPDATE activities SET revision = revision + 1, updated_at = $1 \
         WHERE id = $2 RETURNING revision",
    )
    .bind(entry.now)
    .bind(entry.activity_id)
    .fetch_one(&mut **transaction)
    .await
    .map_err(log_repository_error)?;
    sqlx::query(
        "INSERT INTO activity_audit_logs (id, activity_id, actor_user_id, actor_member_id, \
         action, resource_type, resource_id, activity_revision, created_at) \
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
    )
    .bind(Uuid::new_v4())
    .bind(entry.activity_id)
    .bind(entry.actor_user_id)
    .bind(entry.actor_member_id)
    .bind(entry.action)
    .bind(entry.resource_type)
    .bind(entry.resource_id)
    .bind(revision)
    .bind(entry.now)
    .execute(&mut **transaction)
    .await
    .map_err(log_repository_error)?;
    Ok(revision)
}

async fn finish_join(
    transaction: &mut Transaction<'_, Postgres>,
    input: JoinInvitationInput,
    invitation_id: Uuid,
    activity_id: Uuid,
    member_id: Uuid,
) -> Result<JoinedInvitation, CollaborationRepositoryError> {
    sqlx::query("UPDATE activity_invites SET use_count = use_count + 1 WHERE id = $1")
        .bind(invitation_id)
        .execute(&mut **transaction)
        .await
        .map_err(log_repository_error)?;
    let revision = revise_and_audit(
        transaction,
        AuditEntry {
            activity_id,
            actor_user_id: input.user_id,
            actor_member_id: Some(member_id),
            action: "MEMBER_JOINED",
            resource_type: "ACTIVITY_MEMBER",
            resource_id: member_id,
            now: input.now,
        },
    )
    .await?;
    Ok(JoinedInvitation {
        status: JoinStatus::Joined,
        activity_id,
        member_id: Some(member_id),
        request_id: None,
        revision,
    })
}

/// Activity 行锁保证同一活动的申请创建串行化；部分唯一索引继续承担最终一致性约束。
async fn create_or_replay_join_request(
    transaction: &mut Transaction<'_, Postgres>,
    input: &JoinInvitationInput,
    invitation_id: Uuid,
    activity_id: Uuid,
) -> Result<JoinedInvitation, CollaborationRepositoryError> {
    if let Some(request_id) = sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM activity_join_requests
         WHERE activity_id = $1 AND applicant_user_id = $2 AND status = 'PENDING'",
    )
    .bind(activity_id)
    .bind(input.user_id)
    .fetch_optional(&mut **transaction)
    .await
    .map_err(log_repository_error)?
    {
        let revision =
            sqlx::query_scalar::<_, i64>("SELECT revision FROM activities WHERE id = $1")
                .bind(activity_id)
                .fetch_one(&mut **transaction)
                .await
                .map_err(log_repository_error)?;
        return Ok(JoinedInvitation {
            status: JoinStatus::PendingApproval,
            activity_id,
            member_id: None,
            request_id: Some(request_id),
            revision,
        });
    }

    let request_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO activity_join_requests (
            id, activity_id, invitation_id, applicant_user_id, created_at
         ) VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(request_id)
    .bind(activity_id)
    .bind(invitation_id)
    .bind(input.user_id)
    .bind(input.now)
    .execute(&mut **transaction)
    .await
    .map_err(log_repository_error)?;
    let owner_user_id = sqlx::query_scalar::<_, Uuid>(
        "SELECT owner.user_id FROM activities activity
         JOIN activity_members owner
           ON owner.activity_id = activity.id AND owner.id = activity.owner_member_id
         WHERE activity.id = $1 AND owner.status = 'ACTIVE'",
    )
    .bind(activity_id)
    .fetch_one(&mut **transaction)
    .await
    .map_err(log_repository_error)?;
    sqlx::query(
        "INSERT INTO notifications (
            id, recipient_user_id, type, target_type, target_id, activity_id, payload, created_at
         ) VALUES (
            $1, $2, 'JOIN_APPROVAL_REQUESTED', 'ACTIVITY', $3, $3,
            jsonb_build_object('requestId', $4::text, 'displayName', $5::text), $6
         )",
    )
    .bind(Uuid::new_v4())
    .bind(owner_user_id)
    .bind(activity_id)
    .bind(request_id)
    .bind(&input.display_name)
    .bind(input.now)
    .execute(&mut **transaction)
    .await
    .map_err(log_repository_error)?;
    let revision = revise_and_audit(
        transaction,
        AuditEntry {
            activity_id,
            actor_user_id: input.user_id,
            actor_member_id: None,
            action: "JOIN_REQUEST_CREATED",
            resource_type: "JOIN_REQUEST",
            resource_id: request_id,
            now: input.now,
        },
    )
    .await?;
    Ok(JoinedInvitation {
        status: JoinStatus::PendingApproval,
        activity_id,
        member_id: None,
        request_id: Some(request_id),
        revision,
    })
}

fn parse_kind(value: &str) -> Result<InvitationKind, CollaborationRepositoryError> {
    match value {
        "LINK" => Ok(InvitationKind::Link),
        "DIRECT" => Ok(InvitationKind::Direct),
        _ => Err(CollaborationRepositoryError::Unavailable),
    }
}

fn log_repository_error(error: sqlx::Error) -> CollaborationRepositoryError {
    tracing::error!(%error, "协作事务执行失败");
    drop(error);
    CollaborationRepositoryError::Unavailable
}
