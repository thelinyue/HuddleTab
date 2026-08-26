/**
 * 无状态发布 Smoke：只读取已部署实例，不创建用户、活动或附件。
 * 部署者必须显式提供一个已授权测试会话和既有附件坐标；Cookie 永不输出到日志。
 */
const baseUrl = (
  process.env.SMOKE_BASE_URL ??
  process.env.APP_BASE_URL ??
  "http://127.0.0.1:5660"
).replace(/\/$/, "");

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`缺少 ${name}，无法执行需要认证的 Smoke 检查。`);
  return value;
}

async function check(step, path, options = {}) {
  let response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      redirect: "manual",
      ...options,
    });
  } catch (error) {
    throw new Error(
      `[${step}] 无法连接 ${baseUrl}${path}：${error instanceof Error ? error.message : "未知网络错误"}`,
    );
  }
  if (!response.ok)
    throw new Error(
      `[${step}] 返回 HTTP ${response.status}，请检查应用日志和部署配置。`,
    );
  return response;
}

function authenticatedHeaders() {
  return { Cookie: required("SMOKE_SESSION_COOKIE") };
}

try {
  await check("health", "/api/health");
  await check("manifest", "/manifest.webmanifest");
  await check("entry-page", "/");
  await check("activity-list", "/api/activities", {
    headers: authenticatedHeaders(),
  });

  const activityId = required("SMOKE_ACTIVITY_ID");
  const expenseId = required("SMOKE_EXPENSE_ID");
  const attachmentId = required("SMOKE_ATTACHMENT_ID");
  await check(
    "authorized-attachment",
    `/api/activities/${encodeURIComponent(activityId)}/expenses/${encodeURIComponent(expenseId)}/attachments/${encodeURIComponent(attachmentId)}`,
    { headers: authenticatedHeaders() },
  );
  console.info(
    "[smoke] 发布检查通过：health、manifest、入口页、活动列表和授权附件均可访问。",
  );
} catch (error) {
  console.error(
    `[smoke] 发布检查失败：${error instanceof Error ? error.message : "未知错误"}`,
  );
  process.exitCode = 1;
}
