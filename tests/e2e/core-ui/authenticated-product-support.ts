import { randomUUID } from "node:crypto";

import { expect, type Locator, type Page } from "@playwright/test";

import {
  avatarPresetPath,
  type AvatarPreset,
} from "@/features/me/avatar-presets";

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

/** 头像验收必须经过资料页真实表单，避免直接写数据库或浏览器存储掩盖保存链路问题。 */
export async function selectAvatarPresetThroughUi(
  page: Page,
  avatarPreset: AvatarPreset,
) {
  await page.goto("/me/profile");
  await expect(
    page.getByRole("heading", { name: "个人资料", exact: true }),
  ).toBeVisible();
  const option = page.getByRole("radio", {
    name: `头像 ${avatarPreset}`,
  });
  await page.locator("label").filter({ has: option }).click();
  await expect(option).toBeChecked();
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page).toHaveURL(/\/me$/);
}

/** 直接核对渲染图片来源，确保头像不是仅在选择器状态中变化。 */
export async function expectMemberAvatarPreset(
  root: Page | Locator,
  displayName: string,
  avatarPreset: AvatarPreset,
) {
  const avatar = root.getByRole("img", {
    name: `${displayName}的头像`,
  });
  await expect(avatar).toBeVisible();
  await expect(avatar.locator("img")).toHaveAttribute(
    "src",
    avatarPresetPath(avatarPreset),
  );
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
  await page.locator('button[aria-label="新建或加入活动"]').click();
  await page
    .getByRole("button", { name: "创建活动", exact: true })
    .first()
    .click();
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

/** 视觉验收使用每次新建的真实账号，确保邮箱未绑定状态不受持久化测试数据影响。 */
export async function registerAccountThroughUi(
  page: Page,
  account: {
    readonly nickname: string;
    readonly username: string;
    readonly password: string;
  },
) {
  await page.goto("/register");
  await page.getByLabel("昵称").fill(account.nickname);
  await page.getByLabel("用户名").fill(account.username);
  await page.getByLabel("密码", { exact: true }).fill(account.password);
  await page.getByLabel("确认密码").fill(account.password);
  await page.getByRole("button", { name: "注册", exact: true }).click();
  await expect(page).toHaveURL(/\/activities$/);
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
