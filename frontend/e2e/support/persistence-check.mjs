const baseUrl = process.env.HUDDLETAB_E2E_BASE_URL;
const username = process.env.HUDDLETAB_E2E_USERNAME;
const password = process.env.HUDDLETAB_E2E_PASSWORD;
const attachmentMode = process.env.HUDDLETAB_E2E_ATTACHMENT_MODE === "true";
const task29Mode = process.env.HUDDLETAB_E2E_TASK29_MODE === "true";
const task30Mode = process.env.HUDDLETAB_E2E_TASK30_MODE === "true";
const task31Mode = process.env.HUDDLETAB_E2E_TASK31_MODE === "true";
const uiParityMode = process.env.HUDDLETAB_E2E_UI_PARITY_MODE === "true";
const releaseMode = process.env.HUDDLETAB_E2E_RELEASE_MODE === "true";

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
if (releaseMode) {
  const systemResponse = await fetch(`${baseUrl}/api/admin/system-information`, {
    headers: { cookie: sessionCookie },
  });
  if (!systemResponse.ok) throw new Error("重启后无法读取候选镜像系统信息。");
  const system = (await systemResponse.json()).data;
  if (system.appVersion !== "0.0.5" || system.pwaVersion !== "0.0.5") {
    throw new Error("候选镜像重启后应用与 PWA 版本不是 0.0.5。");
  }
  console.log("重启持久性检查通过：候选版本 0.0.5 与测试数据仍可读取。");
} else if (task29Mode) {
  const usersResponse = await fetch(`${baseUrl}/api/admin/users`, {
    headers: { cookie: sessionCookie },
  });
  if (!usersResponse.ok) throw new Error("重启后无法读取系统管理用户数据。");
  const users = (await usersResponse.json()).data;
  if (!users.some((user) => user.username === username) || users.length < 2) {
    throw new Error("重启后未找到 Task 29 管理测试数据。");
  }
  console.log("重启持久性检查通过：系统管理用户与账号状态仍可读取。");
} else if (task31Mode) {
  const systemResponse = await fetch(`${baseUrl}/api/admin/system-information`, {
    headers: { cookie: sessionCookie },
  });
  if (!systemResponse.ok) throw new Error("重启后无法读取 Task 31 系统信息。");
  const system = (await systemResponse.json()).data;
  if (!system.appVersion || !system.pwaVersion || !system.databaseVersion || !system.dataDirectory) {
    throw new Error("重启后系统信息字段不完整。");
  }
  console.log("重启持久性检查通过：Task 31 系统信息仍可读取。");
} else if (task30Mode) {
  if (!activities.some((activity) => activity.name.startsWith("Task30 "))) {
    throw new Error("重启后未找到 Task 30 管理与分享测试活动。");
  }
  console.log("重启持久性检查通过：Task 30 测试活动仍可读取。");
} else if (uiParityMode) {
  if (!activities.some((activity) => activity.name.startsWith("UI 对照 "))) {
    throw new Error("重启后未找到 UI 对照流程创建的持久数据。");
  }
  console.log("重启持久性检查通过：UI 对照测试活动仍可读取。");
} else if (!attachmentMode) {
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
