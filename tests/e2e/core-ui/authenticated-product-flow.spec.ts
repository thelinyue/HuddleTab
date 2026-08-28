import { expect, test } from "@playwright/test";

import {
  addGuestThroughUi,
  createActivityThroughUi,
  createInviteThroughUi,
  expectMemberAvatarPreset,
  openRegistrationThroughUi,
  readExpenseId,
  registerFromInviteThroughUi,
  selectAvatarPresetThroughUi,
  signInThroughUi,
  uniqueScenarioSuffix,
} from "./authenticated-product-support";

test.skip(
  process.env.RUN_AUTHENTICATED_PRODUCT_E2E !== "true",
  "仅对保留数据的外部生产容器执行登录后核心业务验收。",
);

test("登录用户通过真实界面完成核心闭环与头像持久化", async ({
  page,
  browser,
}) => {
  const suffix = uniqueScenarioSuffix();
  const activityName = `核心验收活动 ${suffix}`;
  const expenseTitle = `四人晚餐 ${suffix}`;
  const joinedName = `受邀成员 ${suffix.slice(-6)}`;
  const joinedAccount = {
    nickname: joinedName,
    username: `member_${suffix.replaceAll("-", "_")}`,
    password: "HuddleTab-member-2026!",
  };

  await signInThroughUi(page);
  await openRegistrationThroughUi(page);
  const activityId = await createActivityThroughUi(page, activityName);
  await addGuestThroughUi(page, activityId, `小王 ${suffix.slice(-4)}`);
  await addGuestThroughUi(page, activityId, `小李 ${suffix.slice(-4)}`);
  const inviteUrl = await createInviteThroughUi(page, activityId);

  const memberContext = await browser.newContext();
  const memberPage = await memberContext.newPage();
  try {
    await registerFromInviteThroughUi(memberPage, inviteUrl, joinedAccount);
    await memberPage.goto(`/activities/${activityId}/members`);
    await expect(memberPage.getByText("活动成员 · 4人")).toBeVisible();
    await expect(
      memberPage.getByRole("button", { name: `查看成员 ${joinedName}` }),
    ).toBeVisible();

    await page.goto(`/activities/${activityId}`);
    await page.getByRole("button", { name: "记一笔" }).click();
    await page.getByLabel("金额", { exact: true }).fill("428");
    await page.getByLabel("用途").fill(expenseTitle);
    await page.getByRole("button", { name: "分摊设置" }).click();
    await expect(page.getByText("参与成员 · 4人")).toBeVisible();
    await expect(page.getByText(/¥107\.00/)).toHaveCount(5);
    await page.getByRole("button", { name: "完成" }).click();
    await page.getByRole("button", { name: "保存", exact: true }).click();

    const expenseId = await readExpenseId(page, activityId, expenseTitle);
    await page.goto(`/activities/${activityId}/expenses/${expenseId}`);
    await expect(page.getByRole("heading", { name: "账单详情" })).toBeVisible();
    await expect(page.getByText(expenseTitle, { exact: true })).toBeVisible();
    await page.getByRole("link", { name: "查看分摊明细" }).click();
    await expect(
      page.getByRole("heading", { name: "分摊明细", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("table", { name: "成员分摊明细" }),
    ).toBeVisible();

    await memberPage.goto(`/activities/${activityId}/settlements`);
    const recommendation = memberPage.getByRole("button", {
      name: new RegExp(`按建议记录：${joinedName}向.+支付.*107\\.00`),
    });
    await expect(recommendation).toBeVisible();
    await recommendation.click();
    await expect(memberPage.getByLabel("金额")).toHaveValue("107.00");
    await memberPage.getByLabel("备注").fill("核心 E2E 结算");
    await memberPage.getByRole("button", { name: "确认已支付" }).click();
    await expect(memberPage.getByText("核心 E2E 结算")).toBeVisible();

    await page.goto(`/activities/${activityId}/settlements`);
    await expect(page.getByText("核心 E2E 结算")).toBeVisible();
    await page.goto("/notifications");
    await expect(
      page.getByText("收到一笔结算", { exact: true }).first(),
    ).toBeVisible();
    await page.getByRole("button", { name: "结算", exact: true }).click();
    await expect(
      page.getByText("收到一笔结算", { exact: true }).first(),
    ).toBeVisible();
    await page.getByRole("button", { name: "全部", exact: true }).click();
    await page.getByRole("button", { name: "全部已读" }).click();
    await expect(page.getByRole("button", { name: "全部已读" })).toBeDisabled();

    const avatarContext = await browser.newContext({
      baseURL: new URL(memberPage.url()).origin,
    });
    const avatarPage = await avatarContext.newPage();
    try {
      // 全新上下文没有注册时创建的 Session，头像场景必须重新经过真实登录页。
      await signInThroughUi(avatarPage, joinedAccount);
      await selectAvatarPresetThroughUi(avatarPage, 5);
      await avatarPage.reload();
      await expect(
        avatarPage.getByRole("heading", { name: "我的", exact: true }),
      ).toBeVisible();
      await expectMemberAvatarPreset(avatarPage, joinedName, 5);

      const avatarActivityId = await createActivityThroughUi(
        avatarPage,
        `头像验收活动 ${suffix}`,
      );
      await avatarPage.goto(`/activities/${avatarActivityId}/members`);
      const ownerRow = avatarPage.getByRole("button", {
        name: `查看成员 ${joinedName}`,
      });
      await expect(ownerRow).toBeVisible();
      await expectMemberAvatarPreset(ownerRow, joinedName, 5);

      await avatarPage.goto("/me");
      await avatarPage.getByRole("button", { name: "退出登录" }).click();
      await expect(avatarPage).toHaveURL(/\/login$/);
    } finally {
      await avatarContext.close();
    }
  } finally {
    await memberContext.close();
  }
});
