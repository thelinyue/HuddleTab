import { randomUUID } from "node:crypto";

import {
  expect,
  type APIResponse,
  type Browser,
  type Page,
} from "@playwright/test";

export const ownerCredentials = {
  username: process.env.E2E_ADMIN_USERNAME ?? "codex-e2e-admin",
  password: process.env.E2E_ADMIN_PASSWORD ?? "HuddleTab-E2E-2026!",
} as const;

export function uniqueScenarioSuffix() {
  return `${Date.now().toString(36)}-${randomUUID().slice(0, 6)}`;
}

/** 生产容器 E2E 只使用公开登录页建立 HttpOnly Session，不注入浏览器存储。 */
export async function signInThroughUi(
  page: Page,
  credentials = ownerCredentials,
) {
  await page.goto("/login");
  await page.getByLabel("用户名").fill(credentials.username);
  await page.getByLabel("密码", { exact: true }).fill(credentials.password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(/\/activities$/);
  await expect(
    page.getByRole("heading", { name: "活动", exact: true }),
  ).toBeVisible();
}

/** 注册策略通过管理员真实界面开启，避免 E2E 绕过系统管理权限。 */
export async function openRegistrationThroughUi(page: Page) {
  await page.goto("/admin/settings");
  await expect(page.getByRole("heading", { name: "注册策略" })).toBeVisible();
  await page.getByRole("radio", { name: "开放注册" }).check();
  await page.getByRole("button", { name: "保存注册策略" }).click();
  await expect(page.getByRole("status")).toHaveText("注册策略已保存。");
}

export async function createActivityThroughUi(page: Page, name: string) {
  await page.goto("/activities");
  await page.locator('button[aria-label="创建活动"]').click();
  await page.getByLabel("活动名称").fill(name);
  await page.getByLabel("地点").fill("上海");
  await page
    .getByRole("button", { name: "创建活动", exact: true })
    .last()
    .click();
  await expect(page).toHaveURL(/\/activities\/[^/]+$/);
  const activityId = new URL(page.url()).pathname.split("/").at(-1);
  if (!activityId) throw new Error("创建活动后未能从地址中读取活动 ID。");
  return activityId;
}

export async function addGuestThroughUi(
  page: Page,
  activityId: string,
  displayName: string,
) {
  await page.goto(`/activities/${activityId}/members`);
  await page.getByRole("button", { name: "添加临时成员" }).click();
  await page.getByLabel("临时成员昵称").fill(displayName);
  await page.getByRole("button", { name: "确认添加" }).click();
  await expect(
    page.getByRole("button", { name: `查看成员 ${displayName}` }),
  ).toBeVisible();
}

export async function createInviteThroughUi(page: Page, activityId: string) {
  await page.goto(`/activities/${activityId}/members`);
  await page.getByRole("button", { name: "邀请成员" }).click();
  const input = page.getByLabel("邀请链接");
  await expect(input).toBeVisible();
  const inviteUrl = await input.inputValue();
  if (!inviteUrl) throw new Error("邀请对话框没有返回邀请链接。");
  return inviteUrl;
}

export async function registerFromInviteThroughUi(
  page: Page,
  inviteUrl: string,
  account: {
    readonly nickname: string;
    readonly username: string;
    readonly password: string;
  },
) {
  await page.goto(inviteUrl);
  await expect(page).toHaveURL(/\/login\?callbackURL=/);
  await expect(page.getByText("登录后将继续加入受邀活动")).toBeVisible();
  await page.getByRole("link", { name: "注册新账号" }).click();
  await expect(page).toHaveURL(/\/register\?callbackURL=/);
  await expect(
    page.getByText("注册后将继续加入受邀活动").first(),
  ).toBeVisible();
  await page.getByLabel("昵称").fill(account.nickname);
  await page.getByLabel("用户名").fill(account.username);
  await page.getByLabel("密码", { exact: true }).fill(account.password);
  await page.getByLabel("确认密码").fill(account.password);
  await page.getByRole("button", { name: "注册", exact: true }).click();
  await expect(page).toHaveURL(/\/activities\/[^/]+$/);
}

export async function readExpenseId(
  page: Page,
  activityId: string,
  title: string,
) {
  const expenseLink = page
    .locator(`a[href^="/activities/${activityId}/expenses/"]`)
    .filter({
      hasText: title,
    });
  await expect(expenseLink).toBeVisible();
  const href = await expenseLink.getAttribute("href");
  const expenseId = href?.split("/").at(-1);
  if (!expenseId) throw new Error("流水列表没有可用的账单详情链接。");
  return expenseId;
}

type QuickExpenseContext = {
  readonly activity: {
    readonly currentMemberId: string;
  };
  readonly members: readonly { readonly id: string }[];
};

async function responseData<T>(
  response: APIResponse,
  expectedStatus: number,
  operation: string,
) {
  const body = (await response.json().catch(() => undefined)) as
    | { readonly data?: T; readonly error?: { readonly message?: string } }
    | undefined;
  expect(
    response.status(),
    `${operation}失败：${body?.error?.message ?? "响应异常"}`,
  ).toBe(expectedStatus);
  if (body?.data === undefined) throw new Error(`${operation}没有返回数据。`);
  return body.data;
}

async function expectResponseStatus(
  response: APIResponse,
  expectedStatus: number,
  operation: string,
) {
  const body = (await response.json().catch(() => undefined)) as
    { readonly error?: { readonly message?: string } } | undefined;
  expect(
    response.status(),
    `${operation}失败：${body?.error?.message ?? "响应异常"}`,
  ).toBe(expectedStatus);
}

/**
 * 视觉矩阵只用正式 HTTP 契约建立可重复场景。页面关键行为仍由独立核心流程通过 UI 验证，
 * 此处不写数据库，也不增加仅供测试使用的生产端点。
 */
export async function prepareProductVisualScenario(
  page: Page,
  browser: Browser,
  suffix: string,
) {
  const activityHome = await responseData<{
    readonly active: readonly { readonly id: string; readonly name: string }[];
    readonly ended: readonly { readonly id: string; readonly name: string }[];
    readonly archived: readonly {
      readonly id: string;
      readonly name: string;
    }[];
  }>(await page.request.get("/api/activities"), 200, "读取历史 E2E 活动");
  const testActivityPrefixes = ["核心验收活动 ", "日本大阪之旅", "周末露营"];
  for (const activity of [
    ...activityHome.active,
    ...activityHome.ended,
    ...activityHome.archived,
  ]) {
    if (
      !testActivityPrefixes.some((prefix) => activity.name.startsWith(prefix))
    )
      continue;
    await responseData(
      await page.request.post(`/api/activities/${activity.id}/delete`),
      200,
      `清理历史 E2E 活动 ${activity.name}`,
    );
  }

  const notifications = await responseData<{
    readonly items: readonly {
      readonly id: string;
      readonly readAt: string | null;
    }[];
  }>(await page.request.get("/api/notifications"), 200, "读取历史 E2E 通知");
  for (const notification of notifications.items) {
    if (notification.readAt) continue;
    await responseData(
      await page.request.post(`/api/notifications/${notification.id}/read`),
      200,
      "清理历史 E2E 通知未读状态",
    );
  }

  const activeActivity = await responseData<{ readonly id: string }>(
    await page.request.post("/api/activities", {
      data: {
        name: "日本大阪之旅",
        location: "大阪",
        baseCurrency: "CNY",
        startDate: "2026-08-28",
        endDate: "2026-08-31",
      },
    }),
    201,
    "创建视觉验收活动",
  );

  for (const displayName of ["小王", "小李"]) {
    await responseData(
      await page.request.post(`/api/activities/${activeActivity.id}/members`, {
        data: { displayName },
      }),
      201,
      `添加临时成员${displayName}`,
    );
  }

  const invitation = await responseData<{ readonly invitePath: string }>(
    await page.request.post(
      `/api/activities/${activeActivity.id}/invitations/link`,
    ),
    201,
    "创建视觉验收邀请",
  );
  const inviteProof = decodeURIComponent(
    invitation.invitePath.split("/").at(-1) ?? "",
  );
  if (!inviteProof) throw new Error("视觉验收邀请没有返回凭证。");

  const memberContext = await browser.newContext({
    baseURL: new URL(page.url()).origin,
  });
  const memberPage = await memberContext.newPage();
  const memberAccount = {
    nickname: "小陈",
    username: `visual_${suffix.replaceAll("-", "_")}`,
    password: "HuddleTab-visual-2026!",
  };
  try {
    await responseData(
      await memberPage.request.post("/api/auth/register", {
        data: { ...memberAccount, inviteProof },
      }),
      201,
      "注册视觉验收成员",
    );
    await expectResponseStatus(
      await memberPage.request.post("/api/auth/sign-in/username", {
        data: {
          username: memberAccount.username,
          password: memberAccount.password,
        },
      }),
      200,
      "登录视觉验收成员",
    );
    await responseData(
      await memberPage.request.post("/api/invitations/join", {
        data: { inviteProof },
      }),
      201,
      "加入视觉验收活动",
    );

    const ownerEntry = await responseData<QuickExpenseContext>(
      await page.request.get(
        `/api/activities/${activeActivity.id}/expenses/entry-context`,
      ),
      200,
      "读取视觉验收记账上下文",
    );
    expect(ownerEntry.members).toHaveLength(4);
    const now = new Date().toISOString();
    const expenseResult = await responseData<{
      readonly expense: { readonly id: string };
    }>(
      await page.request.post(`/api/activities/${activeActivity.id}/expenses`, {
        data: {
          clientMutationId: `visual-${suffix}`,
          title: "大阪烧晚餐",
          category: "FOOD",
          originalCurrency: "CNY",
          originalAmountMinor: "42800",
          exchangeRate: "1",
          exchangeRateSource: "IDENTITY",
          exchangeRateAt: now,
          occurredAt: now,
          note: "道顿堀晚餐",
          payments: [
            {
              memberId: ownerEntry.activity.currentMemberId,
              amountMinor: "42800",
            },
          ],
          split: {
            mode: "EQUAL",
            members: ownerEntry.members.map((member) => member.id),
          },
        },
      }),
      201,
      "创建视觉验收账单",
    );

    const memberEntry = await responseData<QuickExpenseContext>(
      await memberPage.request.get(
        `/api/activities/${activeActivity.id}/expenses/entry-context`,
      ),
      200,
      "读取受邀成员记账上下文",
    );
    await responseData(
      await memberPage.request.post(
        `/api/activities/${activeActivity.id}/settlements`,
        {
          data: {
            payerMemberId: memberEntry.activity.currentMemberId,
            receiverMemberId: ownerEntry.activity.currentMemberId,
            amountMinor: "10700",
            occurredAt: now,
            note: "微信转账",
            confirmOverSettlement: false,
          },
        },
      ),
      201,
      "创建视觉验收结算",
    );

    const endedActivity = await responseData<{ readonly id: string }>(
      await page.request.post("/api/activities", {
        data: {
          name: "周末露营",
          location: "安吉",
          baseCurrency: "CNY",
          startDate: "2026-08-22",
          endDate: "2026-08-23",
        },
      }),
      201,
      "创建已结束活动",
    );
    await responseData(
      await page.request.post(`/api/activities/${endedActivity.id}/end`),
      200,
      "结束视觉验收活动",
    );

    return {
      activityId: activeActivity.id,
      activityName: "日本大阪之旅",
      expenseId: expenseResult.expense.id,
      endedActivityId: endedActivity.id,
    };
  } finally {
    await memberContext.close();
  }
}
