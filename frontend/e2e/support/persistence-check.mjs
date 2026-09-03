const baseUrl = process.env.HUDDLETAB_E2E_BASE_URL;
const username = process.env.HUDDLETAB_E2E_USERNAME;
const password = process.env.HUDDLETAB_E2E_PASSWORD;
const attachmentMode = process.env.HUDDLETAB_E2E_ATTACHMENT_MODE === "true";

if (!baseUrl || !username || !password) {
  throw new Error("缺少持久性检查所需的临时环境，请通过 Phase 1E PowerShell 入口运行。");
}

function cookiePair(response, name) {
  return response.headers
    .getSetCookie()
    .map((value) => value.split(";", 1)[0])
    .find((value) => value.startsWith(`${name}=`));
}

const csrfResponse = await fetch(`${baseUrl}/api/auth/csrf`);
if (!csrfResponse.ok) throw new Error("重启后无法建立登录前 CSRF 上下文。");
const preAuthCookie = cookiePair(csrfResponse, "huddletab_pre_auth");
const csrf = (await csrfResponse.json()).data.token;
if (!preAuthCookie || !csrf) throw new Error("重启后 CSRF 响应不完整。");

const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    cookie: preAuthCookie,
    origin: baseUrl,
    "sec-fetch-site": "same-origin",
    "x-csrf-token": csrf,
  },
  body: JSON.stringify({ username, password }),
});
if (!loginResponse.ok) throw new Error("重启后临时账号无法登录。");
const sessionCookie = cookiePair(loginResponse, "huddletab_session");
if (!sessionCookie) throw new Error("重启后登录响应未返回 Session。");

const activitiesResponse = await fetch(`${baseUrl}/api/activities?view=current`, {
  headers: { cookie: sessionCookie },
});
if (!activitiesResponse.ok) throw new Error("重启后无法读取测试活动。");
const activities = (await activitiesResponse.json()).data;
if (!attachmentMode) {
  if (!activities.some((activity) => activity.name.startsWith("Phase 1E "))) {
    throw new Error("重启后未找到 Chromium 核心流程创建的持久数据。");
  }
  console.log("重启持久性检查通过：测试活动仍可读取。");
} else {
  const attachmentActivities = activities.filter((activity) =>
    activity.name.startsWith("Attachment ")
  );
  let attachmentFound = false;
  for (const activity of attachmentActivities) {
    const expensesResponse = await fetch(
      `${baseUrl}/api/activities/${encodeURIComponent(activity.activityId)}/expenses`,
      { headers: { cookie: sessionCookie } },
    );
    if (!expensesResponse.ok) throw new Error("重启后无法读取附件测试账单。");
    const expenses = (await expensesResponse.json()).data;
    const aggregate = expenses.find((item) =>
      item.expense.title.startsWith("附件餐费 ") && item.attachments.length > 0
    );
    if (!aggregate) continue;
    const attachment = aggregate.attachments[0];
    const download = await fetch(
      `${baseUrl}/api/activities/${encodeURIComponent(activity.activityId)}/expenses/${encodeURIComponent(aggregate.expense.expenseId)}/attachments/${encodeURIComponent(attachment.id)}`,
      { headers: { cookie: sessionCookie } },
    );
    if (!download.ok || download.headers.get("content-type") !== "image/webp") {
      throw new Error("重启后附件私有下载合同不完整。");
    }
    const bytes = Buffer.from(await download.arrayBuffer());
    if (bytes.length === 0 || bytes.subarray(0, 4).toString("ascii") !== "RIFF") {
      throw new Error("重启后附件内容不是有效 WebP。");
    }
    attachmentFound = true;
    break;
  }
  if (!attachmentFound) {
    throw new Error("重启后未找到 Chromium 附件流程创建的持久数据。");
  }
  console.log("重启持久性检查通过：测试账单及剩余附件仍可受权读取。");
}
