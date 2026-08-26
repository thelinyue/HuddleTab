import { randomUUID } from "node:crypto";

/**
 * 隔离环境的完整备份恢复演练。它只通过应用 HTTP API 写入测试数据，
 * 从而同时验证授权、维护模式、归档、数据库和 uploads 的恢复边界。
 */
const baseUrl = (
  process.env.VERIFY_BASE_URL ??
  process.env.APP_BASE_URL ??
  "http://127.0.0.1:5660"
).replace(/\/$/, "");
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4////fwAJ+wP9CNHoHgAAAABJRU5ErkJggg==",
  "base64",
);

function required(name) {
  const value = process.env[name]?.trim();
  if (!value)
    throw new Error(`缺少 ${name}。备份恢复演练仅允许在隔离环境执行。`);
  return value;
}

function headers() {
  return { Cookie: required("VERIFY_SESSION_COOKIE") };
}

async function request(step, path, options = {}) {
  let response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      redirect: "manual",
      ...options,
    });
  } catch (error) {
    throw new Error(
      `[${step}] 无法连接应用：${error instanceof Error ? error.message : "未知网络错误"}`,
    );
  }
  if (!response.ok) {
    const detail = (await response.text()).replace(/\s+/g, " ").slice(0, 500);
    throw new Error(
      `[${step}] 返回 HTTP ${response.status}：${detail || "请检查中文应用日志后重试。"}`,
    );
  }
  return response;
}

async function json(step, path, body) {
  const response = await request(step, path, {
    method: "POST",
    headers: { ...headers(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return response.json();
}

try {
  const suffix = randomUUID();
  const today = new Date().toISOString().slice(0, 10);
  const timestamp = new Date().toISOString();
  const activity = await json("seed-activity", "/api/activities", {
    name: `恢复演练 ${suffix}`,
    baseCurrency: "CNY",
    startDate: today,
  });
  const activityId = activity.data.id;
  const ownerMemberId = activity.data.ownerMemberId;
  if (!activityId || !ownerMemberId)
    throw new Error("[seed-activity] 应用未返回测试活动身份。");

  const expense = await json(
    "seed-expense",
    `/api/activities/${encodeURIComponent(activityId)}/expenses`,
    {
      clientMutationId: suffix,
      title: "恢复前消费",
      category: "OTHER",
      originalCurrency: "CNY",
      originalAmountMinor: "100",
      exchangeRate: "1",
      exchangeRateSource: "IDENTITY",
      exchangeRateAt: timestamp,
      occurredAt: timestamp,
      payments: [{ memberId: ownerMemberId, amountMinor: "100" }],
      split: { mode: "EQUAL", members: [ownerMemberId] },
    },
  );
  const expenseId = expense.data?.expense?.id;
  if (!expenseId) throw new Error("[seed-expense] 应用未返回测试消费 ID。");

  const attachmentRequest = new FormData();
  attachmentRequest.set("clientAttachmentId", randomUUID());
  attachmentRequest.set(
    "file",
    new Blob([png], { type: "image/png" }),
    "restore-proof.png",
  );
  const uploaded = await request(
    "seed-attachment",
    `/api/activities/${encodeURIComponent(activityId)}/expenses/${encodeURIComponent(expenseId)}/attachments`,
    {
      method: "POST",
      headers: headers(),
      body: attachmentRequest,
    },
  );
  const attachment = await uploaded.json();
  const attachmentId = attachment.data?.id;
  if (!attachmentId)
    throw new Error("[seed-attachment] 应用未返回测试附件 ID。");
  const originalAttachment = await request(
    "read-original-attachment",
    `/api/activities/${encodeURIComponent(activityId)}/expenses/${encodeURIComponent(expenseId)}/attachments/${encodeURIComponent(attachmentId)}`,
    { headers: headers() },
  );
  const originalAttachmentBytes = Buffer.from(
    await originalAttachment.arrayBuffer(),
  );
  if (!originalAttachmentBytes.length)
    throw new Error("[read-original-attachment] 服务端未返回附件内容。");

  const createdBackup = await json("create-backup", "/api/admin/backups", {
    confirmed: true,
  });
  const backupId = createdBackup.data?.id;
  if (!backupId) throw new Error("[create-backup] 应用未返回备份 ID。");
  await json(
    "change-after-backup",
    `/api/activities/${encodeURIComponent(activityId)}/expenses`,
    {
      clientMutationId: randomUUID(),
      title: "恢复后应消失的消费",
      category: "OTHER",
      originalCurrency: "CNY",
      originalAmountMinor: "200",
      exchangeRate: "1",
      exchangeRateSource: "IDENTITY",
      exchangeRateAt: timestamp,
      occurredAt: timestamp,
      payments: [{ memberId: ownerMemberId, amountMinor: "200" }],
      split: { mode: "EQUAL", members: [ownerMemberId] },
    },
  );

  await json(
    "restore",
    `/api/admin/backups/${encodeURIComponent(backupId)}/restore`,
    { confirmed: true },
  );

  const restored = await request(
    "verify-record",
    `/api/activities/${encodeURIComponent(activityId)}/expenses/${encodeURIComponent(expenseId)}`,
    { headers: headers() },
  );
  const restoredBody = await restored.json();
  if (restoredBody.data?.expense?.title !== "恢复前消费")
    throw new Error("[verify-record] 原始消费未恢复。");
  const downloaded = await request(
    "verify-attachment",
    `/api/activities/${encodeURIComponent(activityId)}/expenses/${encodeURIComponent(expenseId)}/attachments/${encodeURIComponent(attachmentId)}`,
    { headers: headers() },
  );
  if (
    !Buffer.from(await downloaded.arrayBuffer()).equals(originalAttachmentBytes)
  )
    throw new Error("[verify-attachment] 原始附件内容不一致。");
  await request("health", "/api/health");
  console.info(
    "[verify-backup-restore] 演练通过：数据库记录、附件和健康检查均已恢复。",
  );
} catch (error) {
  console.error(
    `[verify-backup-restore] 演练失败：${error instanceof Error ? error.message : "未知错误"}`,
  );
  process.exitCode = 1;
}
