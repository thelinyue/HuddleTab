import { expect, test } from "@playwright/test";

test.skip(
  process.env.RUN_WSL_UI_TEST !== "true",
  "仅对外部 WSL Compose 实例执行浏览器 UI 验收。",
);

test("用户只通过页面完成初始化、创建活动、注册和记账", async ({
  page,
  browser,
}, testInfo) => {
  await page.goto("/activities");
  await expect(page).toHaveURL(/\/setup$/);

  await page.getByLabel("管理员昵称").fill("UI 验收管理员");
  await page.getByLabel("用户名").fill("uiadmin");
  await page.getByLabel("密码", { exact: true }).fill("ui-flow-password");
  await page.getByLabel("确认密码").fill("ui-flow-password");
  await page.getByRole("button", { name: "完成初始化" }).click();

  await expect(page).toHaveURL(/\/activities$/);
  await expect(
    page.getByRole("heading", { name: "活动", exact: true }),
  ).toBeVisible();

  await page.getByRole("button", { name: "创建活动" }).last().click();
  await page.getByLabel("活动名称").fill("UI 验收活动");
  await page.getByRole("button", { name: "创建活动" }).last().click();
  await expect(page).toHaveURL(/\/activities\/[^/]+$/);
  await expect(page.getByRole("button", { name: "记一笔" })).toBeVisible();
  await page.getByRole("button", { name: "记一笔" }).click();

  const categoryAssetPaths = [
    "food",
    "transport",
    "lodging",
    "ticket",
    "shopping",
    "entertainment",
    "other",
  ];
  for (const category of categoryAssetPaths) {
    const response = await page.request.get(
      `/expense-categories/${category}.webp`,
    );
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("image/webp");
  }

  await page.getByRole("button", { name: "分类" }).click();
  const categoryDialog = page.getByRole("dialog", { name: "分类" });
  const categoryImages = categoryDialog.locator(
    "img[data-category-illustration]",
  );
  await expect(
    categoryDialog.getByRole("radiogroup", { name: "分类" }),
  ).toBeVisible();
  await expect(categoryDialog.getByRole("radio")).toHaveCount(7);
  await expect(categoryImages).toHaveCount(7);
  for (let index = 0; index < 7; index += 1) {
    const image = categoryImages.nth(index);
    await image.scrollIntoViewIfNeeded();
    await expect
      .poll(() =>
        image.evaluate((element) => {
          const image = element as HTMLImageElement;
          return image.complete && image.naturalWidth > 0;
        }),
      )
      .toBe(true);
  }
  await categoryDialog
    .getByRole("radio", { name: "餐饮", exact: true })
    .click();
  await expect(categoryDialog).not.toBeVisible();

  await page.getByLabel("金额").fill("88");
  await page.getByLabel("用途").fill("UI 验收晚餐");
  await page.getByRole("button", { name: "保存" }).click();
  await expect(
    page.getByText("UI 验收晚餐", { exact: true }).first(),
  ).toBeVisible();

  await page.goto("/admin/settings");
  await page.getByRole("radio", { name: "开放注册" }).check();
  await page.getByRole("button", { name: "保存注册策略" }).click();
  await expect(page.getByRole("status")).toHaveText("注册策略已保存。");

  const memberContext = await browser.newContext();
  const memberPage = await memberContext.newPage();
  await memberPage.goto("/register");
  await memberPage.getByLabel("昵称").fill("UI 验收成员");
  await memberPage
    .getByLabel("用户名")
    .fill(`uimember${testInfo.project.name.replaceAll("-", "")}`);
  await memberPage
    .getByLabel("密码", { exact: true })
    .fill("ui-member-password");
  await memberPage.getByLabel("确认密码").fill("ui-member-password");
  await memberPage.getByRole("button", { name: "注册" }).click();
  await expect(memberPage).toHaveURL(/\/activities$/);
  await expect(
    memberPage.getByRole("heading", { name: "活动", exact: true }),
  ).toBeVisible();
  await memberContext.close();
});
