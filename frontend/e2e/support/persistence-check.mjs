const baseUrl = process.env.HUDDLETAB_E2E_BASE_URL;
const username = process.env.HUDDLETAB_E2E_USERNAME;
const password = process.env.HUDDLETAB_E2E_PASSWORD;

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
if (!activities.some((activity) => activity.name.startsWith("Phase 1E "))) {
  throw new Error("重启后未找到 Chromium 核心流程创建的持久数据。");
}
console.log("重启持久性检查通过：测试活动仍可读取。");
