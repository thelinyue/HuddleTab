use async_trait::async_trait;
use sqlx::{PgPool, Postgres, Transaction};
use time::OffsetDateTime;
use uuid::Uuid;

use crate::application::collaboration::{
    CollaborationRepository, CollaborationRepositoryError, GuestMember, Invitation, InvitationKind,
    InvitationPreview, JoinInvitationInput, JoinRequestView, JoinStatus, JoinedInvitation,
    NewGuest, NewInvitation,
};
use crate::domain::{
    activity::InviteMode,
    join_request::{DecisionEffect, JoinDecision, JoinRequestStatus},
};

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
// 协作写入必须在同一事务实现中保持邀请、活动、成员的固定锁序和审计顺序。
#[allow(clippy::too_many_lines)]
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
        if let Some(guest_member_id) = invitation.guest_member_id {
            let guest_exists = sqlx::query_scalar::<_, Uuid>(
                "SELECT id FROM activity_members
                 WHERE id = $1 AND activity_id = $2 AND user_id IS NULL AND status = 'ACTIVE'
                 FOR UPDATE",
            )
            .bind(guest_member_id)
            .bind(invitation.activity_id)
            .fetch_optional(&mut *transaction)
            .await
            .map_err(log_repository_error)?
            .is_some();
            if !guest_exists {
                return Err(CollaborationRepositoryError::GuestNotFound);
            }
        }
        sqlx::query(
            "INSERT INTO activity_invites (id, activity_id, created_by_member_id, token_hash, \
             kind, target_username, guest_member_id, expires_at, max_uses, created_at) \
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
        )
        .bind(invitation.id)
        .bind(invitation.activity_id)
        .bind(actor_member_id)
        .bind(invitation.token_hash.as_slice())
        .bind(invitation.kind.as_str())
        .bind(&invitation.target_username)
        .bind(invitation.guest_member_id)
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
            guest_member_id: invitation.guest_member_id,
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
                Option<Uuid>,
                OffsetDateTime,
                Option<i32>,
                i32,
                Option<OffsetDateTime>,
                i64,
            ),
        >(
            "SELECT id, kind, target_username, guest_member_id, expires_at, max_uses, use_count, revoked_at, version \
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
                Option<Uuid>,
                OffsetDateTime,
                Option<i32>,
                i32,
                Option<OffsetDateTime>,
                i64,
            ),
        >(
            "SELECT kind, target_username, guest_member_id, expires_at, max_uses, use_count, revoked_at, version \
             FROM activity_invites WHERE activity_id = $1 AND id = $2 FOR UPDATE",
        )
        .bind(activity_id)
        .bind(invitation_id)
        .fetch_optional(&mut *transaction)
        .await
        .map_err(log_repository_error)?
        .ok_or(CollaborationRepositoryError::NotFound)?;
        let revision = if row.6.is_some() {
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
            guest_member_id: row.2,
            expires_at: row.3,
            max_uses: row.4,
            use_count: row.5,
            revoked_at: row.6.or(Some(now)),
            version: row.7 + i64::from(row.6.is_none()),
            revision,
        })
    }

    async fn preview_invitation(
        &self,
        token_hash: &[u8; 32],
        now: OffsetDateTime,
    ) -> Result<Option<InvitationPreview>, CollaborationRepositoryError> {
        let row = sqlx::query_as::<
            _,
            (
                Uuid,
                String,
                i64,
                String,
                Option<Uuid>,
                Option<String>,
                OffsetDateTime,
            ),
        >(
            "SELECT a.id, a.name, \
             (SELECT count(*) FROM activity_members m \
              WHERE m.activity_id = a.id AND m.status = 'ACTIVE'), i.kind, i.guest_member_id, \
              guest.display_name, i.expires_at \
             FROM activity_invites i JOIN activities a ON a.id = i.activity_id \
             LEFT JOIN activity_members guest \
               ON guest.activity_id = i.activity_id AND guest.id = i.guest_member_id \
             WHERE i.token_hash = $1 AND i.revoked_at IS NULL AND i.expires_at > $2 \
               AND (i.max_uses IS NULL OR i.use_count < i.max_uses) \
               AND (i.guest_member_id IS NULL \
                    OR (guest.user_id IS NULL AND guest.status = 'ACTIVE')) \
               AND a.status = 'ACTIVE' AND a.deleted_at IS NULL",
        )
        .bind(token_hash.as_slice())
        .bind(now)
        .fetch_optional(&self.pool)
        .await
        .map_err(log_repository_error)?;
        row.map(
            |(
                activity_id,
                activity_name,
                active_member_count,
                kind,
                guest_member_id,
                guest_display_name,
                expires_at,
            )| {
                Ok(InvitationPreview {
                    activity_id,
                    activity_name,
                    active_member_count,
                    kind: parse_kind(&kind)?,
                    guest_member_id,
                    guest_display_name,
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
        let invitation = sqlx::query_as::<
            _,
            (
                Uuid,
                Uuid,
                String,
                Option<String>,
                String,
                Option<Uuid>,
                i32,
            ),
        >(
            "SELECT i.id, i.activity_id, i.kind, i.target_username, a.invite_mode, \
                    i.guest_member_id, i.use_count \
             FROM activity_invites i JOIN activities a ON a.id = i.activity_id \
             WHERE i.token_hash = $1 AND i.revoked_at IS NULL AND i.expires_at > $2 \
               AND (i.guest_member_id IS NOT NULL \
                    OR i.max_uses IS NULL OR i.use_count < i.max_uses) \
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
        if let Some(guest_member_id) = invitation.5 {
            let guest_user_id = sqlx::query_scalar::<_, Option<Uuid>>(
                "SELECT user_id FROM activity_members \
                 WHERE id = $1 AND activity_id = $2 AND status = 'ACTIVE' FOR UPDATE",
            )
            .bind(guest_member_id)
            .bind(invitation.1)
            .fetch_optional(&mut *transaction)
            .await
            .map_err(log_repository_error)?
            .ok_or(CollaborationRepositoryError::InvalidInvitation)?;
            if guest_user_id == Some(input.user_id) && invitation.6 == 1 {
                let revision = sqlx::query_scalar("SELECT revision FROM activities WHERE id = $1")
                    .bind(invitation.1)
                    .fetch_one(&mut *transaction)
                    .await
                    .map_err(log_repository_error)?;
                transaction.commit().await.map_err(log_repository_error)?;
                return Ok(JoinedInvitation {
                    status: JoinStatus::AlreadyBound,
                    activity_id: invitation.1,
                    member_id: Some(guest_member_id),
                    request_id: None,
                    revision,
                });
            }
            if guest_user_id.is_some() || invitation.6 != 0 {
                return Err(CollaborationRepositoryError::InvalidInvitation);
            }
            let existing_member = sqlx::query_scalar::<_, Uuid>(
                "SELECT id FROM activity_members WHERE activity_id = $1 AND user_id = $2 \
                 FOR UPDATE",
            )
            .bind(invitation.1)
            .bind(input.user_id)
            .fetch_optional(&mut *transaction)
            .await
            .map_err(log_repository_error)?;
            if existing_member.is_some() {
                return Err(CollaborationRepositoryError::GuestBindingConflict);
            }
            sqlx::query(
                "UPDATE activity_members SET user_id = $1, version = version + 1 WHERE id = $2",
            )
            .bind(input.user_id)
            .bind(guest_member_id)
            .execute(&mut *transaction)
            .await
            .map_err(log_repository_error)?;
            sqlx::query("UPDATE activity_invites SET use_count = use_count + 1 WHERE id = $1")
                .bind(invitation.0)
                .execute(&mut *transaction)
                .await
                .map_err(log_repository_error)?;
            let revision = revise_and_audit(
                &mut transaction,
                AuditEntry {
                    activity_id: invitation.1,
                    actor_user_id: input.user_id,
                    actor_member_id: Some(guest_member_id),
                    action: "MEMBER_GUEST_BOUND",
                    resource_type: "ACTIVITY_MEMBER",
                    resource_id: guest_member_id,
                    now: input.now,
                },
            )
            .await?;
            transaction.commit().await.map_err(log_repository_error)?;
            return Ok(JoinedInvitation {
                status: JoinStatus::Bound,
                activity_id: invitation.1,
                member_id: Some(guest_member_id),
                request_id: None,
                revision,
            });
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
        if let Some((member_id, status)) = &existing_member
            && status == "ACTIVE"
        {
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

    async fn list_join_requests(
        &self,
        activity_id: Uuid,
        actor_user_id: Uuid,
    ) -> Result<Vec<JoinRequestView>, CollaborationRepositoryError> {
        let mut transaction = self.pool.begin().await.map_err(log_repository_error)?;
        authorize_owner_for_join_requests(&mut transaction, activity_id, actor_user_id).await?;
        let revision =
            sqlx::query_scalar::<_, i64>("SELECT revision FROM activities WHERE id = $1")
                .bind(activity_id)
                .fetch_one(&mut *transaction)
                .await
                .map_err(log_repository_error)?;
        let rows = sqlx::query_as::<_, JoinRequestRow>(
            "SELECT request.id, request.activity_id, request.applicant_user_id,
                    applicant.display_name AS applicant_display_name, request.status,
                    request.decided_at, request.created_at
             FROM activity_join_requests request
             JOIN users applicant ON applicant.id = request.applicant_user_id
             WHERE request.activity_id = $1 AND request.status = 'PENDING'
             ORDER BY request.created_at, request.id",
        )
        .bind(activity_id)
        .fetch_all(&mut *transaction)
        .await
        .map_err(log_repository_error)?;
        transaction.commit().await.map_err(log_repository_error)?;
        rows.into_iter()
            .map(|row| join_request_from_row(row, revision))
            .collect()
    }

    async fn get_join_request(
        &self,
        request_id: Uuid,
        applicant_user_id: Uuid,
    ) -> Result<JoinRequestView, CollaborationRepositoryError> {
        let row = sqlx::query_as::<_, JoinRequestWithRevisionRow>(
            "SELECT request.id, request.activity_id, request.applicant_user_id,
                    applicant.display_name AS applicant_display_name, request.status,
                    request.decided_at, request.created_at, activity.revision
             FROM activity_join_requests request
             JOIN users applicant ON applicant.id = request.applicant_user_id
             JOIN activities activity ON activity.id = request.activity_id
             WHERE request.id = $1 AND request.applicant_user_id = $2",
        )
        .bind(request_id)
        .bind(applicant_user_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(log_repository_error)?
        .ok_or(CollaborationRepositoryError::NotFound)?;
        join_request_from_row(row.request, row.revision)
    }

    async fn decide_join_request(
        &self,
        activity_id: Uuid,
        request_id: Uuid,
        actor_user_id: Uuid,
        decision: JoinDecision,
        now: OffsetDateTime,
    ) -> Result<JoinRequestView, CollaborationRepositoryError> {
        let mut transaction = self.pool.begin().await.map_err(log_repository_error)?;
        let request = sqlx::query_as::<_, LockedJoinRequestRow>(
            "SELECT invitation_id, applicant_user_id, status
             FROM activity_join_requests
             WHERE id = $1 AND activity_id = $2 FOR UPDATE",
        )
        .bind(request_id)
        .bind(activity_id)
        .fetch_optional(&mut *transaction)
        .await
        .map_err(log_repository_error)?
        .ok_or(CollaborationRepositoryError::NotFound)?;
        let activity = sqlx::query_as::<_, LockedActivityRow>(
            "SELECT status, deleted_at, revision FROM activities WHERE id = $1 FOR UPDATE",
        )
        .bind(activity_id)
        .fetch_optional(&mut *transaction)
        .await
        .map_err(log_repository_error)?
        .ok_or(CollaborationRepositoryError::NotFound)?;
        if activity.deleted_at.is_some() {
            return Err(CollaborationRepositoryError::NotFound);
        }
        let actor_member_id =
            authorize_owner_for_decision(&mut transaction, activity_id, actor_user_id).await?;
        let current_status = JoinRequestStatus::parse(&request.status)
            .map_err(|_| CollaborationRepositoryError::Unavailable)?;
        match current_status
            .decide(decision)
            .map_err(|_| CollaborationRepositoryError::JoinRequestClosed)?
        {
            DecisionEffect::Replay => {
                let view =
                    load_join_request_view(&mut transaction, request_id, activity.revision).await?;
                transaction.commit().await.map_err(log_repository_error)?;
                return Ok(view);
            }
            DecisionEffect::Apply(_) => {}
        }

        if decision == JoinDecision::Approve {
            if activity.status != "ACTIVE" {
                return Err(CollaborationRepositoryError::ActivityNotJoinable);
            }
            approve_join_request(&mut transaction, activity_id, &request, now).await?;
        }
        let target_status = decision.status();
        sqlx::query(
            "UPDATE activity_join_requests
             SET status = $1, decided_by_member_id = $2, decided_at = $3
             WHERE id = $4",
        )
        .bind(target_status.as_str())
        .bind(actor_member_id)
        .bind(now)
        .bind(request_id)
        .execute(&mut *transaction)
        .await
        .map_err(log_repository_error)?;
        sqlx::query(
            "UPDATE notifications SET read_at = COALESCE(read_at, $1),
             payload = payload || jsonb_build_object('status', $2::text)
             WHERE recipient_user_id = $3 AND activity_id = $4
               AND type = 'JOIN_APPROVAL_REQUESTED' AND payload->>'requestId' = $5::text",
        )
        .bind(now)
        .bind(target_status.as_str())
        .bind(actor_user_id)
        .bind(activity_id)
        .bind(request_id)
        .execute(&mut *transaction)
        .await
        .map_err(log_repository_error)?;
        sqlx::query(
            "INSERT INTO notifications (
                id, recipient_user_id, type, target_type, target_id, activity_id, payload, created_at
             ) VALUES (
                $1, $2, 'JOIN_APPROVAL_RESOLVED', 'ACTIVITY', $3, $3,
                jsonb_build_object('requestId', $4::text, 'status', $5::text), $6
             )",
        )
        .bind(Uuid::new_v4())
        .bind(request.applicant_user_id)
        .bind(activity_id)
        .bind(request_id)
        .bind(target_status.as_str())
        .bind(now)
        .execute(&mut *transaction)
        .await
        .map_err(log_repository_error)?;
        let action = match decision {
            JoinDecision::Approve => "JOIN_REQUEST_APPROVED",
            JoinDecision::Reject => "JOIN_REQUEST_REJECTED",
        };
        let revision = revise_and_audit(
            &mut transaction,
            AuditEntry {
                activity_id,
                actor_user_id,
                actor_member_id: Some(actor_member_id),
                action,
                resource_type: "JOIN_REQUEST",
                resource_id: request_id,
                now,
            },
        )
        .await?;
        let view = load_join_request_view(&mut transaction, request_id, revision).await?;
        transaction.commit().await.map_err(log_repository_error)?;
        Ok(view)
    }
}

#[derive(sqlx::FromRow)]
struct JoinRequestRow {
    id: Uuid,
    activity_id: Uuid,
    applicant_user_id: Uuid,
    applicant_display_name: String,
    status: String,
    decided_at: Option<OffsetDateTime>,
    created_at: OffsetDateTime,
}

#[derive(sqlx::FromRow)]
struct JoinRequestWithRevisionRow {
    #[sqlx(flatten)]
    request: JoinRequestRow,
    revision: i64,
}

#[derive(sqlx::FromRow)]
struct LockedJoinRequestRow {
    invitation_id: Uuid,
    applicant_user_id: Uuid,
    status: String,
}

#[derive(sqlx::FromRow)]
struct LockedActivityRow {
    status: String,
    deleted_at: Option<OffsetDateTime>,
    revision: i64,
}

#[derive(sqlx::FromRow)]
struct LockedInvitationRow {
    kind: String,
    target_username: Option<String>,
    expires_at: OffsetDateTime,
    max_uses: Option<i32>,
    use_count: i32,
    revoked_at: Option<OffsetDateTime>,
}

type InvitationRow = (
    Uuid,
    String,
    Option<String>,
    Option<Uuid>,
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
        guest_member_id: row.3,
        expires_at: row.4,
        max_uses: row.5,
        use_count: row.6,
        revoked_at: row.7,
        version: row.8,
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

async fn authorize_owner_for_decision(
    transaction: &mut Transaction<'_, Postgres>,
    activity_id: Uuid,
    actor_user_id: Uuid,
) -> Result<Uuid, CollaborationRepositoryError> {
    sqlx::query_scalar::<_, Uuid>(
        "SELECT member.id FROM activities activity
         JOIN activity_members member ON member.id = activity.owner_member_id
         WHERE activity.id = $1 AND member.user_id = $2 AND member.role = 'OWNER'
           AND member.status = 'ACTIVE'",
    )
    .bind(activity_id)
    .bind(actor_user_id)
    .fetch_optional(&mut **transaction)
    .await
    .map_err(log_repository_error)?
    .ok_or(CollaborationRepositoryError::Forbidden)
}

async fn authorize_owner_for_join_requests(
    transaction: &mut Transaction<'_, Postgres>,
    activity_id: Uuid,
    actor_user_id: Uuid,
) -> Result<Uuid, CollaborationRepositoryError> {
    sqlx::query_scalar::<_, Uuid>(
        "SELECT member.id FROM activities activity
         JOIN activity_members member ON member.id = activity.owner_member_id
         WHERE activity.id = $1 AND activity.deleted_at IS NULL AND member.user_id = $2
           AND member.role = 'OWNER' AND member.status = 'ACTIVE' FOR UPDATE OF activity",
    )
    .bind(activity_id)
    .bind(actor_user_id)
    .fetch_optional(&mut **transaction)
    .await
    .map_err(log_repository_error)?
    .ok_or(CollaborationRepositoryError::Forbidden)
}

/// 批准路径在申请和 Activity 已加锁后再锁邀请，随后才接触成员行，保持固定锁序。
async fn approve_join_request(
    transaction: &mut Transaction<'_, Postgres>,
    activity_id: Uuid,
    request: &LockedJoinRequestRow,
    now: OffsetDateTime,
) -> Result<(), CollaborationRepositoryError> {
    let invitation = sqlx::query_as::<_, LockedInvitationRow>(
        "SELECT kind, target_username, expires_at, max_uses, use_count, revoked_at
         FROM activity_invites WHERE id = $1 AND activity_id = $2 FOR UPDATE",
    )
    .bind(request.invitation_id)
    .bind(activity_id)
    .fetch_optional(&mut **transaction)
    .await
    .map_err(log_repository_error)?
    .ok_or(CollaborationRepositoryError::InvalidInvitation)?;
    if invitation.revoked_at.is_some()
        || invitation.expires_at <= now
        || invitation
            .max_uses
            .is_some_and(|maximum| invitation.use_count >= maximum)
    {
        return Err(CollaborationRepositoryError::InvalidInvitation);
    }
    let applicant = sqlx::query_as::<_, (String, String)>(
        "SELECT username, display_name FROM users WHERE id = $1",
    )
    .bind(request.applicant_user_id)
    .fetch_optional(&mut **transaction)
    .await
    .map_err(log_repository_error)?
    .ok_or(CollaborationRepositoryError::NotFound)?;
    let kind = parse_kind(&invitation.kind)?;
    if kind == InvitationKind::Direct
        && invitation.target_username.as_deref() != Some(applicant.0.as_str())
    {
        return Err(CollaborationRepositoryError::InvalidInvitation);
    }
    let existing_member = sqlx::query_as::<_, (Uuid, String)>(
        "SELECT id, status FROM activity_members
         WHERE activity_id = $1 AND user_id = $2 FOR UPDATE",
    )
    .bind(activity_id)
    .bind(request.applicant_user_id)
    .fetch_optional(&mut **transaction)
    .await
    .map_err(log_repository_error)?;
    match existing_member {
        Some((_, status)) if status == "ACTIVE" => {
            return Err(CollaborationRepositoryError::Conflict);
        }
        Some((member_id, _)) => {
            sqlx::query(
                "UPDATE activity_members
                 SET status = 'ACTIVE', left_at = NULL, display_name = $1, version = version + 1
                 WHERE id = $2",
            )
            .bind(&applicant.1)
            .bind(member_id)
            .execute(&mut **transaction)
            .await
            .map_err(log_repository_error)?;
        }
        None => {
            sqlx::query(
                "INSERT INTO activity_members (
                    id, activity_id, user_id, display_name, role, joined_at
                 ) VALUES ($1, $2, $3, $4, 'MEMBER', $5)",
            )
            .bind(Uuid::new_v4())
            .bind(activity_id)
            .bind(request.applicant_user_id)
            .bind(&applicant.1)
            .bind(now)
            .execute(&mut **transaction)
            .await
            .map_err(log_repository_error)?;
        }
    }
    let consumed = sqlx::query(
        "UPDATE activity_invites SET use_count = use_count + 1
         WHERE id = $1 AND revoked_at IS NULL AND expires_at > $2
           AND (max_uses IS NULL OR use_count < max_uses)",
    )
    .bind(request.invitation_id)
    .bind(now)
    .execute(&mut **transaction)
    .await
    .map_err(log_repository_error)?;
    if consumed.rows_affected() != 1 {
        return Err(CollaborationRepositoryError::InvalidInvitation);
    }
    Ok(())
}

async fn load_join_request_view(
    transaction: &mut Transaction<'_, Postgres>,
    request_id: Uuid,
    revision: i64,
) -> Result<JoinRequestView, CollaborationRepositoryError> {
    let row = sqlx::query_as::<_, JoinRequestRow>(
        "SELECT request.id, request.activity_id, request.applicant_user_id,
                applicant.display_name AS applicant_display_name, request.status,
                request.decided_at, request.created_at
         FROM activity_join_requests request
         JOIN users applicant ON applicant.id = request.applicant_user_id
         WHERE request.id = $1",
    )
    .bind(request_id)
    .fetch_one(&mut **transaction)
    .await
    .map_err(log_repository_error)?;
    join_request_from_row(row, revision)
}

fn join_request_from_row(
    row: JoinRequestRow,
    revision: i64,
) -> Result<JoinRequestView, CollaborationRepositoryError> {
    Ok(JoinRequestView {
        id: row.id,
        activity_id: row.activity_id,
        applicant_user_id: row.applicant_user_id,
        applicant_display_name: row.applicant_display_name,
        status: JoinRequestStatus::parse(&row.status)
            .map_err(|_| CollaborationRepositoryError::Unavailable)?,
        decided_at: row.decided_at,
        created_at: row.created_at,
        revision,
    })
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
    let owner_user_id = sqlx::query_scalar::<_, Uuid>(
        "SELECT owner.user_id FROM activities activity
         JOIN activity_members owner ON owner.id = activity.owner_member_id
         WHERE activity.id = $1 AND owner.status = 'ACTIVE' AND owner.user_id IS NOT NULL",
    )
    .bind(activity_id)
    .fetch_one(&mut **transaction)
    .await
    .map_err(log_repository_error)?;
    sqlx::query(
        "INSERT INTO notifications (
            id, recipient_user_id, type, target_type, target_id, activity_id, payload, created_at
         ) VALUES ($1, $2, 'MEMBER_JOINED', 'ACTIVITY', $3, $3,
            jsonb_build_object('displayName', $4::text), $5)",
    )
    .bind(Uuid::new_v4())
    .bind(owner_user_id)
    .bind(activity_id)
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
