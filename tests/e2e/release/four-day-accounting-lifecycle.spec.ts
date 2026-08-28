import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { devices, expect, test } from "@playwright/test";

import {
  buildTripDates,
  dailyExpectedBalancesMinor,
  tripExpenses,
  tripSettlementCounts,
} from "./four-day-accounting-scenario";
import {
  archiveActivityThroughUi,
  assertAccountingEvidence,
  assertArchivedWriteBarriers,
  assertDailyBalances,
  assertDaySettled,
  createActivityThroughUi,
  createInviteThroughUi,
  editHotelAmountThroughUi,
  endActivityThroughUi,
  initializeOwnerThroughUi,
  openRegistrationThroughUi,
  recordExpenseThroughUi,
  registerTravelerThroughInvite,
  settleDayThroughUi,
  type ReleaseParty,
} from "./four-day-release-support";

test.skip(
  process.env.RUN_FOUR_DAY_RELEASE_E2E !== "true",
  "仅在隔离的临时生产 Compose 中执行四日多用户发布门禁。",
);

test("四名真实用户完成四日记账、每日结算、结束与归档", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(15 * 60_000);
  const timeZone = process.env.TZ ?? "Asia/Shanghai";
  const dates = buildTripDates(new Date(), timeZone);
  const screenshotDirectory =
    process.env.RELEASE_E2E_SCREENSHOT_DIR ??
    testInfo.outputPath("screenshots");
  await mkdir(screenshotDirectory, { recursive: true });
  page.setDefaultTimeout(15_000);

  const suffix = Date.now().toString(36);
  const names = {
    owner: "行程发起人",
    a: "旅伴 A",
    b: "旅伴 B",
    c: "旅伴 C",
  } as const;
  const ownerAccount = {
    nickname: names.owner,
    username: `trip_owner_${suffix}`,
    password: "HuddleTab-trip-owner-2026!",
  };

  await initializeOwnerThroughUi(page, ownerAccount);
  await openRegistrationThroughUi(page);
  const activityId = await createActivityThroughUi(page, {
    name: `四日旅行 ${suffix}`,
    location: "日本大阪",
    startDate: dates[0],
    endDate: dates[3],
  });
  const inviteUrl = await createInviteThroughUi(page, activityId);
  const baseURL = new URL(page.url()).origin;
  const mobile = devices["Pixel 7"];
  const contexts = {
    a: await browser.newContext({ ...mobile, baseURL }),
    b: await browser.newContext({ ...mobile, baseURL }),
    c: await browser.newContext({ ...mobile, baseURL }),
  };
  const party: ReleaseParty = {
    names,
    pages: {
      owner: page,
      a: await contexts.a.newPage(),
      b: await contexts.b.newPage(),
      c: await contexts.c.newPage(),
    },
  };
  for (const memberPage of Object.values(party.pages)) {
    memberPage.setDefaultTimeout(15_000);
  }

  try {
    for (const member of ["a", "b", "c"] as const) {
      await registerTravelerThroughInvite(party.pages[member], inviteUrl, {
        nickname: names[member],
        username: `trip_${member}_${suffix}`,
        password: "HuddleTab-trip-member-2026!",
      });
    }

    await page.goto(`/activities/${activityId}/members`);
    await expect(page.getByText("活动成员 · 4人")).toBeVisible();
    await page.screenshot({
      path: join(screenshotDirectory, "01-active-four-members.png"),
    });

    for (const dayIndex of [0, 1, 2, 3] as const) {
      for (const expense of tripExpenses.filter(
        (item) => item.dayIndex === dayIndex,
      )) {
        await recordExpenseThroughUi({
          party,
          activityId,
          date: dates[dayIndex],
          expense,
        });
        if (expense.key === "hotel") {
          await editHotelAmountThroughUi(page, activityId, expense.title);
        }
      }

      await assertDailyBalances(
        page,
        activityId,
        party.names,
        dailyExpectedBalancesMinor[dayIndex],
      );

      if (dayIndex === 3) {
        await page.goto(`/activities/${activityId}`);
        for (const date of dates) {
          const [year, month, day] = date.split("-").map(Number);
          await expect(
            page.getByRole("list", { name: `${year}年${month}月${day}日` }),
          ).toBeVisible();
        }
        await page.screenshot({
          path: join(screenshotDirectory, "02-four-day-expense-feed.png"),
        });
        await assertAccountingEvidence(page, activityId, party.names);
      }

      await settleDayThroughUi({
        party,
        activityId,
        dayIndex,
        date: dates[dayIndex],
      });
      await assertDaySettled(page, activityId, tripSettlementCounts[dayIndex]);
    }

    await endActivityThroughUi(page, activityId);
    await page.goto(`/activities/${activityId}/settlements`);
    await expect(
      page.getByRole("region", { name: "活动已结束" }),
    ).toBeVisible();
    await expect(page.getByText("没有推荐转账")).toBeVisible();
    await page.screenshot({
      path: join(screenshotDirectory, "03-ended-all-settled.png"),
    });

    await archiveActivityThroughUi(page, activityId);
    await page.goto("/activities");
    await page.getByText("查看历史活动", { exact: true }).click();
    await expect(page.getByRole("heading", { name: "历史活动" })).toBeVisible();
    await expect(
      page.getByText(`四日旅行 ${suffix}`, { exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: join(screenshotDirectory, "04-archived-history.png"),
    });
    await assertArchivedWriteBarriers(page, activityId, party.names);
  } finally {
    await Promise.all(
      Object.values(contexts).map((context) => context.close()),
    );
  }
});
