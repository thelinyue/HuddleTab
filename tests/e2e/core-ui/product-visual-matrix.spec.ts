import { mkdirSync, readdirSync, unlinkSync } from "node:fs";
import path from "node:path";

import { expect, test, type Locator, type Page } from "@playwright/test";

import {
  openRegistrationThroughUi,
  registerAccountThroughUi,
  selectAvatarPresetThroughUi,
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
  const pageWidths = await page.evaluate(() => ({
    scrollWidth: Math.max(
      document.documentElement.scrollWidth,
      document.body.scrollWidth,
    ),
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(pageWidths.scrollWidth, "页面出现横向滚动").toBeLessThanOrEqual(
    pageWidths.clientWidth,
  );

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
  const reducedMotionDurations = await firstFocusable.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      animation: style.animationDuration,
      transition: style.transitionDuration,
    };
  });
  for (const [kind, value] of Object.entries(reducedMotionDurations)) {
    const milliseconds = value.split(",").map((duration) => {
      const normalized = duration.trim();
      const numeric = Number.parseFloat(normalized);
      return normalized.endsWith("ms") ? numeric : numeric * 1_000;
    });
    expect(
      milliseconds.every((duration) => duration > 0 && duration <= 0.01),
      `Reduced Motion 未将${kind}时长压缩到 0.01ms`,
    ).toBe(true);
  }
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

function clearPreviousScreenshots() {
  mkdirSync(screenshotDirectory, { recursive: true });
  for (const fileName of readdirSync(screenshotDirectory)) {
    if (path.extname(fileName).toLowerCase() !== ".png") continue;
    unlinkSync(path.join(screenshotDirectory, fileName));
  }
}

test("生成 14 张我的模块视觉验收截图", async (
  { page, browser },
  testInfo,
) => {
  test.skip(
    testInfo.project.name !== "desktop-chromium",
    "视觉矩阵只由 desktop-chromium 串行清理并写入共享截图目录。",
  );
  clearPreviousScreenshots();
  await signInThroughUi(page);
  await openRegistrationThroughUi(page);
  const suffix = uniqueScenarioSuffix();
  const visualContext = await browser.newContext({
    baseURL: new URL(page.url()).origin,
  });
  const visualPage = await visualContext.newPage();

  try {
    await registerAccountThroughUi(visualPage, {
      nickname: "视觉验收成员",
      username: `me_visual_${suffix.replaceAll("-", "_")}`,
      password: "HuddleTab-visual-2026!",
    });
    await selectAvatarPresetThroughUi(visualPage, 5);

    const views = {
      me: async () => {
        await visualPage.goto("/me");
        await expect(
          visualPage.getByRole("heading", { name: "我的", exact: true }),
        ).toBeVisible();
        await expect(
          visualPage.getByText("视觉验收成员", { exact: true }),
        ).toBeVisible();
      },
      "me-profile": async () => {
        await visualPage.goto("/me/profile");
        await expect(
          visualPage.getByRole("heading", {
            name: "个人资料",
            exact: true,
          }),
        ).toBeVisible();
      },
      "me-email-unbound": async () => {
        await visualPage.goto("/me/email");
        await expect(
          visualPage.getByText("尚未绑定邮箱", { exact: true }),
        ).toBeVisible();
      },
      "me-email-bound": async () => {
        await visualPage.goto("/me/email");
        await expect(
          visualPage.getByRole("button", { name: "更换邮箱", exact: true }),
        ).toBeVisible();
      },
      "me-password": async () => {
        await visualPage.goto("/me/password");
        await expect(
          visualPage.getByRole("heading", {
            name: "修改密码",
            exact: true,
          }),
        ).toBeVisible();
      },
      "me-theme": async () => {
        await visualPage.goto("/me/theme");
        await expect(
          visualPage.getByRole("heading", { name: "主题", exact: true }),
        ).toBeVisible();
      },
      admin: async () => {
        await page.goto("/admin");
        await expect(
          page.getByRole("heading", { name: "系统管理", exact: true }),
        ).toBeVisible();
      },
    } satisfies Record<string, () => Promise<void>>;

    const mobile = { width: 390, height: 844 } as const;
    await capture(visualPage, "me", mobile, "light", views.me);
    await capture(
      visualPage,
      "me-profile",
      mobile,
      "light",
      views["me-profile"],
    );
    await capture(
      visualPage,
      "me-email-unbound",
      mobile,
      "light",
      views["me-email-unbound"],
    );

    await visualPage
      .getByLabel("真实邮箱")
      .fill(`visual_${suffix.replaceAll("-", "_")}@example.com`);
    await visualPage
      .getByRole("button", { name: "绑定邮箱", exact: true })
      .click();
    await expect(visualPage).toHaveURL(/\/me$/);

    await capture(
      visualPage,
      "me-email-bound",
      mobile,
      "light",
      views["me-email-bound"],
    );
    await capture(
      visualPage,
      "me-password",
      mobile,
      "light",
      views["me-password"],
    );
    await capture(visualPage, "me-theme", mobile, "light", views["me-theme"]);
    await capture(page, "admin", mobile, "light", views.admin);

    for (const name of ["me", "me-profile", "me-theme"] as const) {
      await capture(visualPage, name, mobile, "dark", views[name]);
    }

    for (const viewport of [
      { width: 700, height: 900 },
      { width: 1440, height: 1000 },
    ] as const) {
      for (const name of ["me", "me-profile"] as const) {
        await capture(visualPage, name, viewport, "light", views[name]);
      }
    }
  } finally {
    await visualContext.close();
  }
});
