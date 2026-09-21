//! Web Push 密钥、订阅投递和后台任务。
//!
//! 站内通知表是业务事实源，本模块只负责把尚未展开的通知复制成设备级投递任务，
//! 再通过标准 Web Push 协议发送。外部 Push Service 的网络失败不会进入任何业务事务。

use std::{
    fs::{self, OpenOptions},
    io::{self, Write},
    net::{IpAddr, SocketAddr},
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};

use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use reqwest::{Client, StatusCode, Url, redirect::Policy};
use serde_json::{Value, json};
use sqlx::PgPool;
use thiserror::Error;
use time::OffsetDateTime;
use tokio::{net::lookup_host, time::timeout};
use uuid::Uuid;
use web_push_native::{
    WebPushBuilder,
    jwt_simple::{algorithms::ECDSAP256PublicKeyLike, algorithms::ES256KeyPair},
    p256::PublicKey,
};

const KEY_FILE_NAME: &str = "vapid-private-key";
const WORKER_INTERVAL: Duration = Duration::from_secs(5);
const CLAIM_BATCH_SIZE: i64 = 50;
const DELIVERY_BATCH_SIZE: i64 = 25;
const MAX_ATTEMPTS: i32 = 3;
const DELIVERY_TTL_SECONDS: u64 = 24 * 60 * 60;

#[derive(Debug, Error)]
pub enum PushServiceError {
    #[error("无法读取或创建 VAPID 私钥：{0}")]
    KeyIo(#[from] io::Error),
    #[error("VAPID 私钥格式无效")]
    InvalidKey,
    #[error("VAPID 私钥无法解析：{0}")]
    KeyParse(String),
}

/// 当前实例的 VAPID 密钥和发送客户端。
///
/// 私钥只从 `DATA_DIR` 读取一次并保存在内存中；公钥可以安全返回给浏览器。
#[derive(Clone)]
pub struct PushService {
    key_pair: Option<Arc<ES256KeyPair>>,
    public_key: Option<String>,
    subject: String,
}

impl PushService {
    /// 测试和未配置实例使用的禁用服务，不会创建文件或启动网络发送。
    #[must_use]
    pub fn disabled() -> Self {
        Self {
            key_pair: None,
            public_key: None,
            subject: String::new(),
        }
    }

    /// 从持久化数据目录读取或原子创建 VAPID 私钥。
    ///
    /// # Errors
    ///
    /// 数据目录不可写、既有密钥损坏或密钥无法解析时返回错误。
    pub fn load_or_create(data_dir: &Path, subject: String) -> Result<Self, PushServiceError> {
        let path = data_dir.join(KEY_FILE_NAME);
        let encoded = match fs::read_to_string(&path) {
            Ok(value) => value.trim().to_owned(),
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                let key = ES256KeyPair::generate();
                let encoded = URL_SAFE_NO_PAD.encode(key.to_bytes());
                write_private_key(&path, encoded.as_bytes())?;
                fs::read_to_string(&path)?.trim().to_owned()
            }
            Err(error) => return Err(PushServiceError::KeyIo(error)),
        };
        let raw = URL_SAFE_NO_PAD
            .decode(encoded.as_bytes())
            .map_err(|_| PushServiceError::InvalidKey)?;
        let key_pair = ES256KeyPair::from_bytes(&raw)
            .map_err(|error| PushServiceError::KeyParse(error.to_string()))?;
        let public_key =
            URL_SAFE_NO_PAD.encode(key_pair.public_key().public_key().to_bytes_uncompressed());
        Ok(Self {
            key_pair: Some(Arc::new(key_pair)),
            public_key: Some(public_key),
            subject,
        })
    }

    #[must_use]
    pub fn is_enabled(&self) -> bool {
        self.key_pair.is_some()
    }

    #[must_use]
    pub fn public_key(&self) -> Option<&str> {
        self.public_key.as_deref()
    }

    /// 构造并发送一条标准 aes128gcm Web Push 消息。
    ///
    /// # Errors
    ///
    /// endpoint、订阅密钥、加密载荷或网络请求无效时返回错误分类。
    pub async fn send(
        &self,
        endpoint: &str,
        p256dh: &str,
        auth: &str,
        payload: &[u8],
    ) -> Result<PushSendOutcome, PushSendError> {
        let Some(key_pair) = &self.key_pair else {
            return Err(PushSendError::Permanent("推送服务未启用".to_owned()));
        };
        let endpoint_url = validate_endpoint(endpoint).await?;
        let public_key = URL_SAFE_NO_PAD
            .decode(p256dh.as_bytes())
            .map_err(|_| PushSendError::Permanent("p256dh 编码无效".to_owned()))?;
        let auth_bytes = URL_SAFE_NO_PAD
            .decode(auth.as_bytes())
            .map_err(|_| PushSendError::Permanent("auth 编码无效".to_owned()))?;
        let public_key = PublicKey::from_sec1_bytes(&public_key)
            .map_err(|_| PushSendError::Permanent("p256dh 公钥无效".to_owned()))?;
        if auth_bytes.len() != 16 {
            return Err(PushSendError::Permanent("auth 长度无效".to_owned()));
        }
        let auth = web_push_native::Auth::clone_from_slice(&auth_bytes);
        let uri = endpoint_url
            .as_str()
            .parse()
            .map_err(|_| PushSendError::Permanent("endpoint URI 无效".to_owned()))?;
        let request = WebPushBuilder::new(uri, public_key, auth)
            .with_valid_duration(Duration::from_secs(DELIVERY_TTL_SECONDS))
            .with_vapid(key_pair, &self.subject)
            .build(payload.to_vec())
            .map_err(|error| PushSendError::Permanent(format!("推送载荷加密失败：{error}")))?;

        let mut builder = Client::builder()
            .redirect(Policy::none())
            // 推送 endpoint 已完成 DNS/IP 校验；绕过环境代理，避免代理重新解析到未校验地址。
            .no_proxy()
            .timeout(Duration::from_secs(15));
        if let Some(host) = endpoint_url.host_str() {
            let port = endpoint_url.port_or_known_default().unwrap_or(443);
            let addresses = resolve_public_addresses(host, port).await?;
            builder = builder.resolve_to_addrs(host, &addresses);
        }
        let client = builder
            .build()
            .map_err(|error| PushSendError::Retryable(format!("推送客户端初始化失败：{error}")))?;
        let mut request_builder = client.post(endpoint_url).body(request.body().clone());
        for (name, value) in request.headers() {
            request_builder = request_builder.header(name.as_str(), value.as_bytes());
        }
        let response = request_builder
            .send()
            .await
            .map_err(|error| PushSendError::Retryable(format!("推送网络请求失败：{error}")))?;
        let status = response.status();
        let _ = response.bytes().await;
        Ok(match status {
            StatusCode::OK | StatusCode::CREATED | StatusCode::ACCEPTED => {
                PushSendOutcome::Delivered
            }
            StatusCode::GONE | StatusCode::NOT_FOUND => PushSendOutcome::Gone,
            status if status.is_server_error() || status == StatusCode::TOO_MANY_REQUESTS => {
                PushSendOutcome::Retryable(format!("Push Service 返回 HTTP {status}"))
            }
            status => PushSendOutcome::Permanent(format!("Push Service 返回 HTTP {status}")),
        })
    }
}

/// 注册订阅前执行相同的 endpoint、DNS 和密钥校验，避免把不可发送或危险地址写入数据库。
///
/// # Errors
///
/// endpoint、DNS 或订阅密钥不符合 Web Push 要求时返回校验错误。
pub async fn validate_subscription(
    endpoint: &str,
    p256dh: &str,
    auth: &str,
) -> Result<(), PushSendError> {
    if endpoint.len() > 4096 || p256dh.len() > 256 || auth.len() > 256 {
        return Err(PushSendError::UnsafeEndpoint("订阅字段过长".to_owned()));
    }
    let public_key = URL_SAFE_NO_PAD
        .decode(p256dh.as_bytes())
        .map_err(|_| PushSendError::Permanent("p256dh 编码无效".to_owned()))?;
    let auth_bytes = URL_SAFE_NO_PAD
        .decode(auth.as_bytes())
        .map_err(|_| PushSendError::Permanent("auth 编码无效".to_owned()))?;
    if auth_bytes.len() != 16 || PublicKey::from_sec1_bytes(&public_key).is_err() {
        return Err(PushSendError::Permanent("订阅密钥无效".to_owned()));
    }
    validate_endpoint(endpoint).await.map(|_| ())
}

#[derive(Debug)]
pub enum PushSendOutcome {
    Delivered,
    Gone,
    Retryable(String),
    Permanent(String),
}

#[derive(Debug, Error)]
pub enum PushSendError {
    #[error("推送 endpoint 不安全：{0}")]
    UnsafeEndpoint(String),
    #[error("推送请求应稍后重试：{0}")]
    Retryable(String),
    #[error("推送请求不可重试：{0}")]
    Permanent(String),
}

#[derive(sqlx::FromRow)]
struct NotificationToEnqueue {
    id: Uuid,
    recipient_user_id: Uuid,
    kind: String,
    created_at: OffsetDateTime,
}

#[derive(sqlx::FromRow)]
struct DeliveryJob {
    id: Uuid,
    notification_id: Uuid,
    recipient_user_id: Uuid,
    endpoint: String,
    p256dh: String,
    auth: String,
    kind: String,
    target_id: Uuid,
    activity_id: Uuid,
    payload: Value,
    attempts: i32,
}

/// 启动单一顺序投递循环；每次领取前先展开通知，再处理有限批次的设备任务。
pub fn spawn_push_worker(pool: PgPool, service: Arc<PushService>) {
    if !service.is_enabled() {
        tracing::warn!("VAPID 推送未启用，跳过后台投递任务");
        return;
    }
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(WORKER_INTERVAL);
        loop {
            interval.tick().await;
            if let Err(error) = run_push_cycle(&pool, &service).await {
                tracing::error!(error = %error, "PWA 推送后台任务失败，请检查数据库和外网连接");
            }
        }
    });
}

async fn run_push_cycle(pool: &PgPool, service: &PushService) -> Result<(), sqlx::Error> {
    let enqueued = enqueue_pending_notifications(pool).await?;
    expire_stale_deliveries(pool).await?;
    let jobs = claim_delivery_jobs(pool).await?;
    for job in jobs {
        if !push_kind_enabled(pool, job.recipient_user_id, &job.kind).await? {
            cancel_delivery(pool, job.id).await?;
            continue;
        }
        let payload = push_payload(&job);
        match service
            .send(&job.endpoint, &job.p256dh, &job.auth, &payload)
            .await
        {
            Ok(PushSendOutcome::Delivered) => complete_delivery(pool, job.id).await?,
            Ok(PushSendOutcome::Gone) => remove_subscription(pool, &job.endpoint).await?,
            Ok(PushSendOutcome::Retryable(error)) | Err(PushSendError::Retryable(error))
                if job.attempts < MAX_ATTEMPTS =>
            {
                retry_delivery(pool, job.id, job.attempts, &error).await?;
            }
            Ok(PushSendOutcome::Permanent(error) | PushSendOutcome::Retryable(error))
            | Err(
                PushSendError::Permanent(error)
                | PushSendError::UnsafeEndpoint(error)
                | PushSendError::Retryable(error),
            ) => {
                fail_delivery(pool, job.id, &error).await?;
            }
        }
    }
    if enqueued > 0 {
        tracing::info!(count = enqueued, "PWA 推送通知已展开为设备任务");
    }
    Ok(())
}

/// 清理超过 24 小时仍未送达的设备任务，避免服务长时间停机后重启时补发旧提醒。
async fn expire_stale_deliveries(pool: &PgPool) -> Result<(), sqlx::Error> {
    sqlx::query(
        "UPDATE notification_push_deliveries delivery
         SET status = 'FAILED', updated_at = NOW(), last_error = '通知已超过推送有效期'
         FROM notifications notification
         WHERE delivery.notification_id = notification.id
           AND delivery.status IN ('PENDING', 'RETRY')
           AND notification.created_at < NOW() - INTERVAL '24 hours'",
    )
    .execute(pool)
    .await
    .map(|_| ())
}

async fn enqueue_pending_notifications(pool: &PgPool) -> Result<u64, sqlx::Error> {
    let mut transaction = pool.begin().await?;
    let notifications = sqlx::query_as::<_, NotificationToEnqueue>(
        "SELECT id, recipient_user_id, type AS kind, created_at
         FROM notifications
         WHERE push_enqueued_at IS NULL
         ORDER BY created_at, id
         FOR UPDATE SKIP LOCKED
         LIMIT $1",
    )
    .bind(CLAIM_BATCH_SIZE)
    .fetch_all(&mut *transaction)
    .await?;
    let mut count = 0_u64;
    for notification in notifications {
        if let Some(kind) = NotificationPushKind::parse(&notification.kind) {
            sqlx::query(
                "INSERT INTO notification_push_deliveries
                    (id, notification_id, subscription_id, next_attempt_at, created_at, updated_at)
                 SELECT $1, $2, subscription.id, $3, $3, $3
                 FROM push_subscriptions subscription
                 LEFT JOIN notification_push_preferences preference
                   ON preference.user_id = subscription.user_id
                 WHERE subscription.user_id = $4
                   AND subscription.created_at <= $5
                   AND COALESCE(
                     CASE $6
                       WHEN 'MEMBERSHIP' THEN preference.membership_enabled
                       WHEN 'EXPENSE' THEN preference.expense_enabled
                       WHEN 'SETTLEMENT' THEN preference.settlement_enabled
                       WHEN 'ACTIVITY' THEN preference.activity_enabled
                     END, TRUE)
                 ON CONFLICT (notification_id, subscription_id) DO NOTHING",
            )
            .bind(Uuid::new_v4())
            .bind(notification.id)
            .bind(OffsetDateTime::now_utc())
            .bind(notification.recipient_user_id)
            .bind(notification.created_at)
            .bind(kind.category())
            .execute(&mut *transaction)
            .await?;
        }
        sqlx::query(
            "UPDATE notifications SET push_enqueued_at = $2 WHERE id = $1 AND push_enqueued_at IS NULL",
        )
        .bind(notification.id)
        .bind(OffsetDateTime::now_utc())
        .execute(&mut *transaction)
        .await?;
        count += 1;
    }
    transaction.commit().await?;
    Ok(count)
}

async fn claim_delivery_jobs(pool: &PgPool) -> Result<Vec<DeliveryJob>, sqlx::Error> {
    let mut transaction = pool.begin().await?;
    let jobs = sqlx::query_as::<_, DeliveryJob>(
        "SELECT delivery.id, delivery.notification_id, notification.recipient_user_id,
                subscription.endpoint, subscription.p256dh, subscription.auth,
                notification.type AS kind, notification.target_id, notification.activity_id,
                notification.payload, delivery.attempts
         FROM notification_push_deliveries delivery
         JOIN notifications notification ON notification.id = delivery.notification_id
         JOIN push_subscriptions subscription ON subscription.id = delivery.subscription_id
         WHERE delivery.status IN ('PENDING', 'RETRY')
           AND delivery.next_attempt_at <= NOW()
         ORDER BY delivery.next_attempt_at, delivery.id
         FOR UPDATE OF delivery SKIP LOCKED
         LIMIT $1",
    )
    .bind(DELIVERY_BATCH_SIZE)
    .fetch_all(&mut *transaction)
    .await?;
    if !jobs.is_empty() {
        let ids: Vec<Uuid> = jobs.iter().map(|job| job.id).collect();
        sqlx::query(
            "UPDATE notification_push_deliveries
             SET status = 'RETRY', attempts = attempts + 1,
                 next_attempt_at = NOW() + INTERVAL '5 minutes', updated_at = NOW()
             WHERE id = ANY($1)",
        )
        .bind(&ids)
        .execute(&mut *transaction)
        .await?;
    }
    transaction.commit().await?;
    Ok(jobs
        .into_iter()
        .map(|mut job| {
            job.attempts += 1;
            job
        })
        .collect())
}

async fn push_kind_enabled(pool: &PgPool, user_id: Uuid, kind: &str) -> Result<bool, sqlx::Error> {
    let category =
        NotificationPushKind::parse(kind).map_or("DISABLED", NotificationPushKind::category);
    sqlx::query_scalar(
        "SELECT COALESCE(
            CASE $2
              WHEN 'MEMBERSHIP' THEN membership_enabled
              WHEN 'EXPENSE' THEN expense_enabled
              WHEN 'SETTLEMENT' THEN settlement_enabled
              WHEN 'ACTIVITY' THEN activity_enabled
            END, TRUE)
         FROM notification_push_preferences
         WHERE user_id = $1
         UNION ALL
         SELECT TRUE
         LIMIT 1",
    )
    .bind(user_id)
    .bind(category)
    .fetch_one(pool)
    .await
}

async fn complete_delivery(pool: &PgPool, id: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query(
        "UPDATE notification_push_deliveries
         SET status = 'DELIVERED', delivered_at = NOW(), updated_at = NOW(), last_error = NULL
         WHERE id = $1",
    )
    .bind(id)
    .execute(pool)
    .await
    .map(|_| ())
}

async fn cancel_delivery(pool: &PgPool, id: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query(
        "UPDATE notification_push_deliveries
         SET status = 'CANCELLED', updated_at = NOW(), last_error = '用户已关闭该通知分类'
         WHERE id = $1",
    )
    .bind(id)
    .execute(pool)
    .await
    .map(|_| ())
}

async fn retry_delivery(
    pool: &PgPool,
    id: Uuid,
    attempts: i32,
    error: &str,
) -> Result<(), sqlx::Error> {
    let delay_minutes = i64::from(2_i32.pow(attempts.min(3).cast_unsigned()));
    sqlx::query(
        "UPDATE notification_push_deliveries
         SET status = 'RETRY', next_attempt_at = NOW() + make_interval(mins => $2),
             updated_at = NOW(), last_error = $3
         WHERE id = $1",
    )
    .bind(id)
    .bind(delay_minutes)
    .bind(error)
    .execute(pool)
    .await
    .map(|_| ())
}

async fn fail_delivery(pool: &PgPool, id: Uuid, error: &str) -> Result<(), sqlx::Error> {
    sqlx::query(
        "UPDATE notification_push_deliveries
         SET status = 'FAILED', updated_at = NOW(), last_error = $2
         WHERE id = $1",
    )
    .bind(id)
    .bind(error)
    .execute(pool)
    .await
    .map(|_| ())
}

async fn remove_subscription(pool: &PgPool, endpoint: &str) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM push_subscriptions WHERE endpoint = $1")
        .bind(endpoint)
        .execute(pool)
        .await
        .map(|_| ())
}

fn push_payload(job: &DeliveryJob) -> Vec<u8> {
    let (title, body, url) = notification_copy(
        &job.kind,
        &job.activity_id,
        &job.target_id,
        &job.payload,
        job.notification_id,
    );
    serde_json::to_vec(&json!({
        "title": title,
        "body": body,
        "icon": "/icons/icon-192.png",
        "badge": "/icons/icon-192.png",
        "tag": format!("huddletab-{}", job.notification_id),
        "data": { "notificationId": job.notification_id, "url": url }
    }))
    .expect("推送 JSON 由固定字段构造，始终可序列化")
}

fn notification_copy(
    kind: &str,
    activity_id: &Uuid,
    target_id: &Uuid,
    payload: &Value,
    notification_id: Uuid,
) -> (String, String, String) {
    let activity = format!("/activities/{activity_id}");
    let display_name = payload
        .get("displayName")
        .and_then(Value::as_str)
        .unwrap_or("新成员");
    match kind {
        "JOIN_APPROVAL_REQUESTED" => (
            format!("{display_name} 申请加入活动"),
            "等待你处理加入申请".to_owned(),
            format!("{activity}?panel=members"),
        ),
        "JOIN_APPROVAL_RESOLVED" => (
            "加入申请已处理".to_owned(),
            "请打开伙记查看申请结果".to_owned(),
            format!("/notifications?focus={notification_id}"),
        ),
        "MEMBER_JOINED" => (
            format!("{display_name} 已加入活动"),
            "活动成员发生变化".to_owned(),
            activity,
        ),
        "PARTICIPATING_EXPENSE_CHANGED" => (
            "参与的账单已修改".to_owned(),
            "消费记录发生变更".to_owned(),
            format!("{activity}/expenses/{target_id}"),
        ),
        "PARTICIPATING_EXPENSE_DELETED" => (
            "参与的账单已删除".to_owned(),
            "该消费已不再计入活动账务".to_owned(),
            activity,
        ),
        "SETTLEMENT_RECEIVED" => (
            "收到一笔结算".to_owned(),
            "活动结算发生变化".to_owned(),
            format!("{activity}?tab=settlement"),
        ),
        "ACTIVITY_STATUS_CHANGED" => (
            "活动状态已更新".to_owned(),
            "请打开伙记查看活动状态".to_owned(),
            activity,
        ),
        "OWNERSHIP_CHANGED" => (
            "你已成为活动所有者".to_owned(),
            "请留意新的活动管理权限".to_owned(),
            activity,
        ),
        _ => (
            "你有一条新通知".to_owned(),
            "请打开伙记查看详情".to_owned(),
            format!("/notifications?focus={notification_id}"),
        ),
    }
}

/// 推送类别集中定义，避免 HTTP、SQL 和 worker 各自解释通知类型。
pub fn push_category(kind: &str) -> Option<&'static str> {
    NotificationPushKind::parse(kind).map(NotificationPushKind::category)
}

async fn validate_endpoint(endpoint: &str) -> Result<Url, PushSendError> {
    let url = Url::parse(endpoint)
        .map_err(|_| PushSendError::UnsafeEndpoint("URL 格式无效".to_owned()))?;
    if url.scheme() != "https" || url.username() != "" || url.password().is_some() {
        return Err(PushSendError::UnsafeEndpoint(
            "仅允许无凭据的 HTTPS endpoint".to_owned(),
        ));
    }
    let port = url.port_or_known_default().unwrap_or(443);
    if port != 443 || url.host_str().is_none() {
        return Err(PushSendError::UnsafeEndpoint(
            "endpoint 必须使用 HTTPS 443 端口".to_owned(),
        ));
    }
    let _ = resolve_public_addresses(url.host_str().unwrap_or_default(), port).await?;
    Ok(url)
}

async fn resolve_public_addresses(host: &str, port: u16) -> Result<Vec<SocketAddr>, PushSendError> {
    if let Ok(ip) = host.parse::<IpAddr>() {
        if forbidden_ip(ip) {
            return Err(PushSendError::UnsafeEndpoint(
                "endpoint 指向受限制的 IP 地址".to_owned(),
            ));
        }
        return Ok(vec![SocketAddr::new(ip, port)]);
    }
    let addresses = timeout(Duration::from_secs(3), lookup_host((host, port)))
        .await
        .map_err(|_| PushSendError::Retryable("endpoint DNS 解析超时".to_owned()))?
        .map_err(|_| PushSendError::Retryable("endpoint DNS 解析失败".to_owned()))?
        .collect::<Vec<_>>();
    if addresses.is_empty() || addresses.iter().any(|address| forbidden_ip(address.ip())) {
        return Err(PushSendError::UnsafeEndpoint(
            "endpoint DNS 指向受限制的地址".to_owned(),
        ));
    }
    Ok(addresses)
}

fn forbidden_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(value) => {
            value.is_private()
                || value.is_loopback()
                || value.is_link_local()
                || value.is_unspecified()
                || value.is_broadcast()
                || value.is_multicast()
                || value.octets()[0] == 100 && (64..=127).contains(&value.octets()[1])
        }
        IpAddr::V6(value) => {
            value.is_loopback()
                || value.is_unspecified()
                || value.is_multicast()
                || value.is_unique_local()
                || value.is_unicast_link_local()
        }
    }
}

fn write_private_key(path: &Path, bytes: &[u8]) -> Result<(), io::Error> {
    let parent = path
        .parent()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "VAPID 私钥路径缺少父目录"))?;
    fs::create_dir_all(parent)?;
    let temporary_path = PathBuf::from(format!("{}.{}.tmp", path.display(), Uuid::new_v4()));
    let result = (|| {
        #[cfg(unix)]
        let mut file = {
            use std::os::unix::fs::OpenOptionsExt;
            OpenOptions::new()
                .write(true)
                .create_new(true)
                .mode(0o600)
                .open(&temporary_path)?
        };
        #[cfg(not(unix))]
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary_path)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        match fs::hard_link(&temporary_path, path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => Ok(()),
            Err(error) => Err(error),
        }
    })();
    let _ = fs::remove_file(&temporary_path);
    result
}

/// Web Push 能力使用的固定通知类型和分类映射。
pub enum NotificationPushKind {
    Membership,
    Expense,
    Settlement,
    Activity,
}

impl NotificationPushKind {
    #[must_use]
    pub fn parse(kind: &str) -> Option<Self> {
        Some(match kind {
            "JOIN_APPROVAL_REQUESTED" | "JOIN_APPROVAL_RESOLVED" | "MEMBER_JOINED" => {
                Self::Membership
            }
            "PARTICIPATING_EXPENSE_CHANGED" | "PARTICIPATING_EXPENSE_DELETED" => Self::Expense,
            "SETTLEMENT_RECEIVED" => Self::Settlement,
            "ACTIVITY_STATUS_CHANGED" | "OWNERSHIP_CHANGED" => Self::Activity,
            _ => return None,
        })
    }

    #[must_use]
    pub const fn category(self) -> &'static str {
        match self {
            Self::Membership => "MEMBERSHIP",
            Self::Expense => "EXPENSE",
            Self::Settlement => "SETTLEMENT",
            Self::Activity => "ACTIVITY",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn notification_kinds_map_to_the_four_user_categories() {
        assert_eq!(push_category("JOIN_APPROVAL_REQUESTED"), Some("MEMBERSHIP"));
        assert_eq!(
            push_category("PARTICIPATING_EXPENSE_CHANGED"),
            Some("EXPENSE")
        );
        assert_eq!(push_category("SETTLEMENT_RECEIVED"), Some("SETTLEMENT"));
        assert_eq!(push_category("OWNERSHIP_CHANGED"), Some("ACTIVITY"));
        assert_eq!(push_category("UNKNOWN"), None);
    }

    #[test]
    fn settlement_push_copy_does_not_include_amount() {
        let notification_id = Uuid::new_v4();
        let (title, body, url) = notification_copy(
            "SETTLEMENT_RECEIVED",
            &Uuid::new_v4(),
            &Uuid::new_v4(),
            &json!({ "amountMinor": "123456", "amount": "¥1,234.56" }),
            notification_id,
        );
        let copy = format!("{title} {body}");
        assert!(!copy.contains("123456"));
        assert!(!copy.contains("1,234.56"));
        assert!(url.contains("tab=settlement"));
    }

    #[test]
    fn vapid_key_is_persisted_and_reused() {
        let directory = tempfile::tempdir().expect("应创建临时 VAPID 目录");
        let first =
            PushService::load_or_create(directory.path(), "mailto:test@example.com".to_owned())
                .expect("首次应生成 VAPID 私钥");
        let second =
            PushService::load_or_create(directory.path(), "mailto:test@example.com".to_owned())
                .expect("后续应读取 VAPID 私钥");
        assert!(first.is_enabled());
        assert_eq!(first.public_key(), second.public_key());
    }
}
