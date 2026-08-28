import { mkdirSync } from "node:fs";
import path from "node:path";

import { expect, test, type Locator, type Page } from "@playwright/test";

import {
  openRegistrationThroughUi,
  prepareProductVisualScenario,
  signInThroughUi,
  uniqueScenarioSuffix,
} from "./authenticated-product-support";

test.skip(
  process.env.CAPTURE_PRODUCT_VISUAL_MATRIX !== "true",
  "仅在明确请求最新版视觉矩阵时生成截图。",
);

const screenshotDirectory = path.resolve(
  ".superpowers/sdd/huddletab-product-ui-refresh/screenshots",
);

type Theme = "light" | "dark";
type Viewport = { readonly width: number; readonly height: number };

async function expectTouchTarget(locator: Locator, label: string) {
  const box = await locator.boundingBox();
  expect(box, `${label}没有可测量的触控区域`).not.toBeNull();
  expect(box!.width, `${label}的触控宽度不足 44px`).toBeGreaterThanOrEqual(44);
  expect(box!.height, `${label}的触控高度不足 44px`).toBeGreaterThanOrEqual(44);
}

async function assertPageFrame(page: Page) {
  expect(
    await page
      .locator("body")
      .evaluate((body) => body.scrollWidth <= window.innerWidth),
    "页面出现横向滚动",
  ).toBe(true);

  const navigation = page.getByRole("navigation", { name: "主导航" });
  if (await navigation.isVisible()) {
    const navigationHeight = await navigation.evaluate(
      (element) => element.getBoundingClientRect().height,
    );
    const framePaddingBottom = await page
      .getByTestId("app-frame")
      .evaluate((element) =>
        Number.parseFloat(getComputedStyle(element).paddingBottom),
      );
    expect(
      framePaddingBottom,
      "页面底部留白不足以避让固定主导航",
    ).toBeGreaterThanOrEqual(navigationHeight);
    for (const link of await navigation.getByRole("link").all()) {
      await expectTouchTarget(link, `主导航 ${await link.textContent()}`);
    }
  }

  const activityNavigation = page.getByRole("navigation", { name: "活动导航" });
  if (await activityNavigation.isVisible()) {
    for (const link of await activityNavigation.getByRole("link").all()) {
      await expectTouchTarget(link, `活动导航 ${await link.textContent()}`);
    }
  }

  const firstFocusable = page
    .locator("button:visible, a[href]:visible, input:visible")
    .first();
  await firstFocusable.focus();
  await expect(firstFocusable, "页面首个操作必须可由键盘聚焦").toBeFocused();
  await page.evaluate(() =>
    (document.activeElement as HTMLElement | null)?.blur(),
  );
}

async function setTheme(page: Page, theme: Theme) {
  await page.emulateMedia({
    colorScheme: theme,
    reducedMotion: "reduce",
  });
  await page.evaluate(
    (nextTheme) => localStorage.setItem("theme", nextTheme),
    theme,
  );
}

async function capture(
  page: Page,
  name: string,
  viewport: Viewport,
  theme: Theme,
  openView: () => Promise<void>,
) {
  await page.setViewportSize(viewport);
  await setTheme(page, theme);
  await openView();
  await expect(page.locator("html")).toHaveClass(new RegExp(theme));
  await assertPageFrame(page);
  await page.screenshot({
    path: path.join(
      screenshotDirectory,
      `${name}-${viewport.width}x${viewport.height}-${theme}.png`,
    ),
    animations: "disabled",
  });
}

test("生成 30 张风险分层产品截图", async ({ page, browser }) => {
  mkdirSync(screenshotDirectory, { recursive: true });
  await signInThroughUi(page);
  await openRegistrationThroughUi(page);
  const scenario = await prepareProductVisualScenario(
    page,
    browser,
    uniqueScenarioSuffix(),
  );

  const views = {
    activities: async () => {
      await page.goto("/activities");
      await expect(
        page.getByRole("heading", { name: "活动", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText(scenario.activityName, { exact: true }),
      ).toBeVisible();
    },
    "activity-feed": async () => {
      await page.goto(`/activities/${scenario.activityId}`);
      await expect(page.getByText("大阪烧晚餐", { exact: true })).toBeVisible();
    },
    "quick-expense": async () => {
      await views["activity-feed"]();
      await page.getByRole("button", { name: "记一笔" }).click();
      await expect(
        page.getByRole("heading", { name: "记一笔", exact: true }),
      ).toBeVisible();
      await expect(page.getByLabel("金额", { exact: true })).toBeFocused();
    },
    "split-settings": async () => {
      await views["quick-expense"]();
      await page.getByLabel("金额", { exact: true }).fill("428");
      await page.getByLabel("用途").fill("晚餐");
      await page.getByRole("button", { name: "分摊设置" }).click();
      await expect(page.getByText("参与成员 · 4人")).toBeVisible();
      const surface = page.locator('[data-quick-expense-step="SPLIT"]');
      const translation = await surface.evaluate((element) => {
        const matrix = new DOMMatrixReadOnly(
          getComputedStyle(element).transform,
        );
        return { x: matrix.m41, y: matrix.m42 };
      });
      expect(translation, "Reduced Motion 下步骤切换不能保留位移").toEqual({
        x: 0,
        y: 0,
      });
    },
    members: async () => {
      await page.goto(`/activities/${scenario.activityId}/members`);
      await expect(page.getByText("活动成员 · 4人")).toBeVisible();
    },
    settlements: async () => {
      await page.goto(`/activities/${scenario.activityId}/settlements`);
      await expect(
        page.getByRole("heading", { name: "推荐转账" }),
      ).toBeVisible();
    },
    "expense-detail": async () => {
      await page.goto(
        `/activities/${scenario.activityId}/expenses/${scenario.expenseId}`,
      );
      await expect(
        page.getByRole("heading", { name: "账单详情", exact: true }),
      ).toBeVisible();
    },
    "expense-split-detail": async () => {
      await page.goto(
        `/activities/${scenario.activityId}/expenses/${scenario.expenseId}/split`,
      );
      await expect(
        page.getByRole("heading", { name: "分摊明细", exact: true }),
      ).toBeVisible();
    },
    notifications: async () => {
      await page.goto("/notifications");
      await expect(
        page.getByRole("heading", { name: "通知", exact: true }),
      ).toBeVisible();
      await page.getByRole("button", { name: "未读", exact: true }).click();
      await expect(
        page.getByText("收到一笔结算", { exact: true }).first(),
      ).toBeVisible();
    },
    me: async () => {
      await page.goto("/me");
      await expect(
        page.getByRole("heading", { name: "我的", exact: true }),
      ).toBeVisible();
      await expect(page.getByText("验收管理员", { exact: true })).toBeVisible();
    },
    more: async () => {
      await page.goto(`/activities/${scenario.activityId}/more`);
      await expect(
        page.getByRole("heading", { name: "活动信息" }),
      ).toBeVisible();
    },
    "state-ended": async () => {
      await page.goto(`/activities/${scenario.endedActivityId}`);
      await expect(page.getByText("活动已结束", { exact: true })).toBeVisible();
    },
  } satisfies Record<string, () => Promise<void>>;

  const mobile = { width: 390, height: 844 } as const;
  for (const [name, openView] of Object.entries(views)) {
    await capture(page, name, mobile, "light", openView);
  }

  for (const name of [
    "activities",
    "activity-feed",
    "quick-expense",
    "split-settings",
    "members",
    "settlements",
    "notifications",
    "state-ended",
  ] as const) {
    await capture(page, name, mobile, "dark", views[name]);
  }

  for (const viewport of [
    { width: 700, height: 900 },
    { width: 1440, height: 1000 },
  ] as const) {
    for (const name of [
      "activities",
      "activity-feed",
      "split-settings",
      "notifications",
      "me",
    ] as const) {
      await capture(page, name, viewport, "light", views[name]);
    }
  }
});
