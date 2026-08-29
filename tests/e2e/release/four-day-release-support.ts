import { expect, type Page } from "@playwright/test";

import {
  tripSettlements,
  type ScenarioMember,
  type TripExpenseScenario,
} from "./four-day-accounting-scenario";

type PartyNames = Readonly<Record<ScenarioMember, string>>;

export interface ReleaseParty {
  readonly names: PartyNames;
  readonly pages: Readonly<Record<ScenarioMember, Page>>;
}

type Account = {
  readonly nickname: string;
  readonly username: string;
  readonly password: string;
};

type SettlementContext = {
  readonly activity: { readonly status: "ACTIVE" | "ENDED" | "ARCHIVED" };
  readonly members: readonly {
    readonly id: string;
    readonly displayName: string;
  }[];
  readonly balances: readonly {
    readonly memberId: string;
    readonly netMinor: string;
  }[];
  readonly recommendations: readonly {
    readonly payerMemberId: string;
    readonly receiverMemberId: string;
    readonly amountMinor: string;
  }[];
};

const categoryLabels = {
  FOOD: "餐饮",
  TRANSPORT: "交通",
  LODGING: "住宿",
  TICKET: "门票",
  SHOPPING: "购物",
  ENTERTAINMENT: "娱乐",
} as const;

const splitLabels = {
  EQUAL: "均摊",
  EXACT: "按金额",
  PERCENTAGE: "按比例",
  WEIGHT: "按份数",
} as const;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function readApi<T>(page: Page, url: string): Promise<T> {
  const result = await page.evaluate(async (path) => {
    const response = await fetch(path, { cache: "no-store" });
    return {
      status: response.status,
      body: (await response.json().catch(() => undefined)) as
        { data?: unknown; error?: { message?: string } } | undefined,
    };
  }, url);
  if (result.status !== 200 || result.body?.data === undefined) {
    throw new Error(
      result.body?.error?.message ??
        `读取 ${url} 失败，HTTP ${result.status}。`,
    );
  }
  return result.body.data as T;
}

/** 首次部署必须通过公开 Setup 表单创建 Owner 和 HttpOnly Session。 */
export async function initializeOwnerThroughUi(page: Page, account: Account) {
  await page.goto("/activities");
  await expect(page).toHaveURL(/\/setup$/);
  await page.getByLabel("管理员昵称").fill(account.nickname);
  await page.getByLabel("用户名").fill(account.username);
  await page.getByLabel("密码", { exact: true }).fill(account.password);
  await page.getByLabel("确认密码").fill(account.password);
  await page.getByRole("button", { name: "完成初始化" }).click();
  await expect(page).toHaveURL(/\/activities$/);
}

export async function openRegistrationThroughUi(page: Page) {
  await page.goto("/admin/settings");
  await expect(page.getByRole("heading", { name: "注册策略" })).toBeVisible();
  await page.getByRole("radio", { name: "开放注册" }).check();
  await page.getByRole("button", { name: "保存注册策略" }).click();
  await expect(page.getByRole("status")).toHaveText("注册策略已保存。");
}

export async function createActivityThroughUi(
  page: Page,
  input: {
    readonly name: string;
    readonly location: string;
    readonly startDate: string;
    readonly endDate: string;
  },
) {
  await page.goto("/activities");
  await page.getByLabel("创建活动").click();
  await page.getByLabel("活动名称").fill(input.name);
  await page.getByLabel("地点").fill(input.location);
  await page.getByLabel("主币种").fill("CNY");
  await page.getByLabel("开始日期").fill(input.startDate);
  await page.getByLabel("结束日期").fill(input.endDate);
  await page
    .getByRole("button", { name: "创建活动", exact: true })
    .last()
    .click();
  await expect(page).toHaveURL(/\/activities\/[^/]+$/);
  const activityId = new URL(page.url()).pathname.split("/").at(-1);
  if (!activityId) throw new Error("创建活动后没有获得活动 ID。");
  return activityId;
}

export async function createInviteThroughUi(page: Page, activityId: string) {
  await page.goto(`/activities/${activityId}/members`);
  await page.getByRole("button", { name: "邀请成员" }).click();
  const input = page.getByLabel("邀请链接");
  await expect(input).toBeVisible();
  const inviteUrl = await input.inputValue();
  if (!inviteUrl) throw new Error("邀请成员对话框没有生成链接。");
  return inviteUrl;
}

export async function registerTravelerThroughInvite(
  page: Page,
  inviteUrl: string,
  account: Account,
) {
  await page.goto(inviteUrl);
  await expect(page).toHaveURL(/\/login\?callbackURL=/);
  await page.getByRole("link", { name: "注册新账号" }).click();
  await expect(page).toHaveURL(/\/register\?callbackURL=/);
  await page.getByLabel("昵称").fill(account.nickname);
  await page.getByLabel("用户名").fill(account.username);
  await page.getByLabel("密码", { exact: true }).fill(account.password);
  await page.getByLabel("确认密码").fill(account.password);
  await page.getByRole("button", { name: "注册", exact: true }).click();
  await expect(page).toHaveURL(/\/activities\/[^/]+$/);
}

async function setParticipantSelection(
  page: Page,
  names: PartyNames,
  participants: readonly ScenarioMember[],
) {
  await page.getByRole("button", { name: "谁参与" }).click();
  for (const member of ["owner", "a", "b", "c"] as const) {
    const option = page.getByRole("checkbox", { name: names[member] });
    const selected = (await option.getAttribute("aria-checked")) === "true";
    if (selected !== participants.includes(member)) await option.click();
  }
  await page.getByRole("button", { name: "完成", exact: true }).click();
}

async function fillExpenseForm(
  page: Page,
  party: ReleaseParty,
  expense: TripExpenseScenario,
  date: string,
) {
  const form = page.locator("#quick-expense-form");
  await form
    .getByLabel("金额", { exact: true })
    .fill(expense.initialAmount ?? expense.amount);
  await form.getByLabel("用途").fill(expense.title);
  await page.getByRole("button", { name: "谁付款" }).click();
  if (expense.payments.length === 1) {
    await page
      .getByRole("radio", { name: party.names[expense.payments[0].member] })
      .click();
  } else {
    await page.getByRole("button", { name: "多人付款" }).click();
    for (const member of ["owner", "a", "b", "c"] as const) {
      const option = page.getByRole("checkbox", { name: party.names[member] });
      const selected = (await option.getAttribute("aria-checked")) === "true";
      const expected = expense.payments.some(
        (payment) => payment.member === member,
      );
      if (selected !== expected) await option.click();
    }
    for (const payment of expense.payments) {
      await page
        .getByLabel(`${party.names[payment.member]}付款金额`)
        .fill(payment.amount);
    }
    await page.getByRole("button", { name: "完成", exact: true }).click();
  }
  await setParticipantSelection(page, party.names, expense.participants);

  await form.getByRole("button", { name: "更多设置" }).click();
  await form
    .getByLabel(categoryLabels[expense.category], { exact: true })
    .check();
  await form.getByLabel("币种", { exact: true }).fill(expense.originalCurrency);
  await form.getByLabel("汇率", { exact: true }).fill(expense.exchangeRate);
  await form.getByLabel("汇率时间").fill(`${date}T09:00`);
  await form.getByLabel("消费时间").fill(`${date}T${expense.occurredTime}`);
  if (expense.originalCurrency !== "CNY") {
    await form.getByLabel("手动输入").check();
  }

  await form.getByRole("button", { name: "分摊设置" }).click();
  await form
    .getByRole("radiogroup", { name: "分摊方式" })
    .getByText(splitLabels[expense.split.mode], { exact: true })
    .click();
  if (expense.split.mode !== "EQUAL") {
    for (const entry of expense.split.entries) {
      await form
        .getByLabel(`${party.names[entry.member]}分摊值`)
        .fill(entry.value);
    }
  }
  await page.getByRole("button", { name: "完成", exact: true }).click();
}

async function waitForOfflineStorage(page: Page) {
  await expect
    .poll(
      () =>
        page.evaluate(async () =>
          Boolean(
            navigator.serviceWorker.controller &&
            (await caches.match(window.location.href)),
          ),
        ),
      { timeout: 20_000, message: "生产 PWA 未准备好离线账单缓存。" },
    )
    .toBe(true);
}

/**
 * 每笔消费均经过快速记账 UI。离线账单只把最后一次保存放到断网阶段，表单打开、
 * 本地入队、联网同步和服务端幂等结果仍由同一个真实浏览器 Context 完成。
 */
export async function recordExpenseThroughUi(input: {
  readonly party: ReleaseParty;
  readonly activityId: string;
  readonly date: string;
  readonly expense: TripExpenseScenario;
}) {
  const { party, activityId, date, expense } = input;
  const page = party.pages[expense.creator];
  await page.goto(`/activities/${activityId}`);
  await expect(page.getByRole("button", { name: "记一笔" })).toBeVisible();
  if (expense.offline) await waitForOfflineStorage(page);
  await page.getByRole("button", { name: "记一笔" }).click();
  await fillExpenseForm(page, party, expense, date);

  if (!expense.offline) {
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect(
      page.getByText(expense.title, { exact: true }).first(),
    ).toBeVisible();
    return;
  }

  const context = page.context();
  const pendingExpense = page.getByRole("article", { name: "本地离线消费" });
  const pendingStatus = pendingExpense.getByText("离线待同步", { exact: true });
  try {
    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await expect
      .poll(() =>
        page.evaluate(() => sessionStorage.getItem("huddletab:offline")),
      )
      .toBe("true");
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect(
      pendingExpense.getByText(expense.title, { exact: true }),
    ).toBeVisible();
    await expect(pendingStatus).toBeVisible();
  } finally {
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
  }

  await expect(pendingStatus).toBeHidden({
    timeout: 30_000,
  });
  await expect
    .poll(
      async () => {
        const rows = await readApi<readonly { readonly title: string }[]>(
          page,
          `/api/activities/${activityId}/expenses`,
        );
        return rows.filter((row) => row.title === expense.title).length;
      },
      { message: "返程打车同步后必须只有一笔正式账单。" },
    )
    .toBe(1);
}

export async function editHotelAmountThroughUi(
  page: Page,
  activityId: string,
  title: string,
) {
  const expenses = await readApi<
    readonly { readonly id: string; readonly title: string }[]
  >(page, `/api/activities/${activityId}/expenses`);
  const hotel = expenses.find((expense) => expense.title === title);
  if (!hotel) throw new Error("没有找到需要更正的酒店账单。");
  await page.goto(`/activities/${activityId}/expenses/${hotel.id}`);
  await page.getByRole("button", { name: "账单操作" }).click();
  await page.getByRole("menuitem", { name: "编辑账单" }).click();
  await expect(page.getByRole("heading", { name: "编辑账单" })).toBeVisible();
  await page.locator("#quick-expense-form").getByLabel("金额").fill("1200");
  await page.getByRole("button", { name: "保存修改" }).click();
  await expect
    .poll(async () => {
      const detail = await readApi<{
        readonly expense: {
          readonly baseAmountMinor: string;
          readonly version: number;
        };
      }>(page, `/api/activities/${activityId}/expenses/${hotel.id}`);
      return `${detail.expense.baseAmountMinor}:${detail.expense.version}`;
    })
    .toBe("120000:2");
  await expect(
    page.getByText("¥1,200.00", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByText("¥1,180.00", { exact: true })).toHaveCount(0);
}

async function settlementContext(page: Page, activityId: string) {
  return readApi<SettlementContext>(
    page,
    `/api/activities/${activityId}/settlements/context`,
  );
}

export async function assertDailyBalances(
  page: Page,
  activityId: string,
  names: PartyNames,
  expected: Readonly<Record<ScenarioMember, bigint>>,
) {
  const context = await settlementContext(page, activityId);
  expect(context.activity.status).toBe("ACTIVE");
  const memberIdByName = new Map(
    context.members.map((member) => [member.displayName, member.id]),
  );
  const balanceByMemberId = new Map(
    context.balances.map((balance) => [balance.memberId, balance.netMinor]),
  );
  for (const member of ["owner", "a", "b", "c"] as const) {
    const memberId = memberIdByName.get(names[member]);
    expect(
      memberId ? balanceByMemberId.get(memberId) : undefined,
      `${names[member]} 的每日结算前余额不正确`,
    ).toBe(expected[member].toString());
  }
}

export async function settleDayThroughUi(input: {
  readonly party: ReleaseParty;
  readonly activityId: string;
  readonly dayIndex: 0 | 1 | 2 | 3;
  readonly date: string;
}) {
  const settlements = tripSettlements.filter(
    (settlement) => settlement.dayIndex === input.dayIndex,
  );
  for (const settlement of settlements) {
    const page = input.party.pages[settlement.payer];
    const payerName = input.party.names[settlement.payer];
    const receiverName = input.party.names[settlement.receiver];
    await page.goto(`/activities/${input.activityId}/settlements`);
    const recommendation = page.getByRole("button", {
      name: new RegExp(
        `按建议记录：${escapeRegex(payerName)}向${escapeRegex(receiverName)}支付.*${escapeRegex(settlement.amount)}\\.00`,
      ),
    });
    await expect(recommendation).toBeVisible();
    await recommendation.click();
    await expect(page.getByLabel("金额")).toHaveValue(
      `${settlement.amount}.00`,
    );
    await page.getByLabel("结算时间").fill(`${input.date}T21:00`);
    const note = `Day ${input.dayIndex + 1} 每日结算 ${payerName}`;
    await page.getByLabel("备注").fill(note);
    await page.getByRole("button", { name: "确认已支付" }).click();
    const matchingHistoryRow = page
      .getByRole("region", { name: "实际结算记录" })
      .getByRole("listitem")
      .filter({ hasText: payerName })
      .filter({ hasText: receiverName })
      .filter({ hasText: `¥${settlement.amount}.00` })
      .filter({ hasText: note });
    await expect(matchingHistoryRow).toHaveCount(1);
  }
}

export async function assertDaySettled(
  page: Page,
  activityId: string,
  expectedSettlementCount: number,
) {
  const [context, settlements] = await Promise.all([
    settlementContext(page, activityId),
    readApi<readonly unknown[]>(
      page,
      `/api/activities/${activityId}/settlements`,
    ),
  ]);
  expect(context.activity.status).toBe("ACTIVE");
  expect(context.recommendations).toHaveLength(0);
  expect(context.balances.map((balance) => balance.netMinor)).toEqual([
    "0",
    "0",
    "0",
    "0",
  ]);
  expect(settlements).toHaveLength(expectedSettlementCount);
}

type ExpenseDetail = {
  readonly expense: {
    readonly id: string;
    readonly title: string;
    readonly category: string;
    readonly originalCurrency: string;
    readonly originalAmountMinor: string;
    readonly baseAmountMinor: string;
    readonly exchangeRate: string;
    readonly splitMode: string;
  };
  readonly payments: readonly {
    readonly memberDisplayName: string;
    readonly baseAmountMinor: string;
  }[];
  readonly shares: readonly {
    readonly memberDisplayName: string;
    readonly baseAmountMinor: string;
  }[];
};

async function openSplitDetail(
  page: Page,
  activityId: string,
  detail: ExpenseDetail,
) {
  await page.goto(`/activities/${activityId}/expenses/${detail.expense.id}`);
  await expect(
    page.getByText(detail.expense.title, { exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "查看分摊明细" }).click();
  return page.getByRole("table", { name: "成员分摊明细" });
}

/** 汇总使用公开只读 API 复算，特殊付款和分摊仍打开真实详情页面核验。 */
export async function assertAccountingEvidence(
  page: Page,
  activityId: string,
  names: PartyNames,
) {
  const [summary, expenseRows] = await Promise.all([
    readApi<{
      readonly totalExpenseMinor: string;
      readonly originalCurrencyTotals: readonly {
        readonly currency: string;
        readonly amountMinor: string;
      }[];
      readonly categoryTotals: readonly {
        readonly category: string;
        readonly amountMinor: string;
      }[];
    }>(page, `/api/activities/${activityId}/summary`),
    readApi<readonly { readonly id: string; readonly title: string }[]>(
      page,
      `/api/activities/${activityId}/expenses`,
    ),
  ]);
  expect(expenseRows).toHaveLength(12);
  expect(summary.totalExpenseMinor).toBe("479400");
  expect(
    Object.fromEntries(
      summary.originalCurrencyTotals.map((row) => [
        row.currency,
        row.amountMinor,
      ]),
    ),
  ).toEqual({
    CNY: "429400",
    JPY: "10000",
  });
  expect(
    Object.fromEntries(
      summary.categoryTotals.map((row) => [row.category, row.amountMinor]),
    ),
  ).toEqual({
    ENTERTAINMENT: "42000",
    FOOD: "96800",
    LODGING: "120000",
    SHOPPING: "44600",
    TICKET: "110000",
    TRANSPORT: "66000",
  });

  const details = await Promise.all(
    expenseRows.map((row) =>
      readApi<ExpenseDetail>(
        page,
        `/api/activities/${activityId}/expenses/${row.id}`,
      ),
    ),
  );
  const paymentTotals = new Map<string, bigint>();
  const shareTotals = new Map<string, bigint>();
  for (const detail of details) {
    for (const payment of detail.payments) {
      paymentTotals.set(
        payment.memberDisplayName,
        (paymentTotals.get(payment.memberDisplayName) ?? 0n) +
          BigInt(payment.baseAmountMinor),
      );
    }
    for (const share of detail.shares) {
      shareTotals.set(
        share.memberDisplayName,
        (shareTotals.get(share.memberDisplayName) ?? 0n) +
          BigInt(share.baseAmountMinor),
      );
    }
  }
  expect(Object.fromEntries(paymentTotals)).toEqual({
    [names.owner]: 190_000n,
    [names.a]: 84_800n,
    [names.b]: 94_600n,
    [names.c]: 110_000n,
  });
  expect(Object.fromEntries(shareTotals)).toEqual({
    [names.owner]: 94_700n,
    [names.a]: 98_900n,
    [names.b]: 136_900n,
    [names.c]: 148_900n,
  });

  const byTitle = new Map(
    details.map((detail) => [detail.expense.title, detail]),
  );
  const airport = byTitle.get("机场接驳")!;
  let table = await openSplitDetail(page, activityId, airport);
  const airportOwner = table.getByRole("row", {
    name: new RegExp(names.owner),
  });
  await expect(airportOwner).toContainText("¥80.00");
  await expect(airportOwner).toContainText("¥200.00");
  await expect(airportOwner).toContainText("+¥120.00");
  const airportA = table.getByRole("row", { name: new RegExp(names.a) });
  await expect(airportA).toContainText("¥80.00");
  await expect(airportA).toContainText("¥160.00");
  await expect(airportA).toContainText("+¥80.00");

  const pass = byTitle.get("景点联票")!;
  table = await openSplitDetail(page, activityId, pass);
  const passOwner = table.getByRole("row", { name: new RegExp(names.owner) });
  await expect(passOwner).toContainText("40%");
  await expect(passOwner).toContainText("¥240.00");
  await expect(passOwner).toContainText("−¥240.00");
  const passC = table.getByRole("row", { name: new RegExp(names.c) });
  await expect(passC).toContainText("10%");
  await expect(passC).toContainText("¥60.00");
  await expect(passC).toContainText("¥600.00");
  await expect(passC).toContainText("+¥540.00");

  const dinner = byTitle.get("旅行晚餐")!;
  table = await openSplitDetail(page, activityId, dinner);
  const dinnerB = table.getByRole("row", { name: new RegExp(names.b) });
  await expect(dinnerB).toContainText("2份");
  await expect(dinnerB).toContainText("¥160.00");
  await expect(dinnerB).toContainText("¥280.00");
  await expect(dinnerB).toContainText("+¥120.00");

  const museum = byTitle.get("博物馆门票")!;
  await page.goto(`/activities/${activityId}/expenses/${museum.expense.id}`);
  await expect(page.getByText("原币金额", { exact: true })).toBeVisible();
  await expect(page.getByText(/10,000/)).toBeVisible();
  await expect(page.getByText("0.05", { exact: true })).toBeVisible();

  const taxi = byTitle.get("返程打车")!;
  table = await openSplitDetail(page, activityId, taxi);
  await expect(table.getByRole("row")).toHaveCount(3);
  const taxiB = table.getByRole("row", { name: new RegExp(names.b) });
  await expect(taxiB).toContainText("¥60.00");
  await expect(taxiB).toContainText("¥120.00");
  await expect(taxiB).toContainText("+¥60.00");
  const taxiC = table.getByRole("row", { name: new RegExp(names.c) });
  await expect(taxiC).toContainText("¥60.00");
  await expect(taxiC).toContainText("−¥60.00");
  await expect(table).not.toContainText(names.owner);
  await expect(table).not.toContainText(names.a);
}

export async function endActivityThroughUi(page: Page, activityId: string) {
  await page.goto(`/activities/${activityId}/more`);
  await page.getByRole("button", { name: "结束活动" }).click();
  await expect(page.getByRole("status")).toHaveText("活动状态已更新。");
  await expect(page.getByRole("button", { name: "归档活动" })).toBeVisible();
}

export async function archiveActivityThroughUi(page: Page, activityId: string) {
  await page.goto(`/activities/${activityId}/more`);
  await page.getByRole("button", { name: "归档活动" }).click();
  await expect(page.getByRole("status")).toHaveText("活动状态已更新。");
  await expect(page.getByRole("button", { name: "解除归档" })).toBeVisible();
}

export async function assertArchivedWriteBarriers(
  page: Page,
  activityId: string,
  names: PartyNames,
) {
  await page.goto(`/activities/${activityId}`);
  await expect(page.getByRole("region", { name: "活动已归档" })).toBeVisible();
  await expect(page.getByRole("button", { name: "记一笔" })).toHaveCount(0);
  const context = await settlementContext(page, activityId);
  const memberIdByName = new Map(
    context.members.map((member) => [member.displayName, member.id]),
  );
  const ownerId = memberIdByName.get(names.owner);
  const memberAId = memberIdByName.get(names.a);
  if (!ownerId || !memberAId) throw new Error("归档写入校验缺少成员 ID。");
  const now = new Date().toISOString();
  const results = await page.evaluate(
    async ({ id, ownerMemberId, otherMemberId, occurredAt }) => {
      const request = async (url: string, init: RequestInit) => {
        const response = await fetch(url, init);
        const body = (await response.json().catch(() => undefined)) as
          { error?: { code?: string } } | undefined;
        return { status: response.status, code: body?.error?.code };
      };
      const headers = { "Content-Type": "application/json" };
      return Promise.all([
        request(`/api/activities/${id}/expenses`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            clientMutationId: `archived-${Date.now()}`,
            title: "归档后账单",
            category: "FOOD",
            originalCurrency: "CNY",
            originalAmountMinor: "100",
            exchangeRate: "1",
            exchangeRateSource: "IDENTITY",
            exchangeRateAt: occurredAt,
            occurredAt,
            payments: [{ memberId: ownerMemberId, amountMinor: "100" }],
            split: { mode: "EQUAL", members: [ownerMemberId] },
          }),
        }),
        request(`/api/activities/${id}/settlements`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            payerMemberId: ownerMemberId,
            receiverMemberId: otherMemberId,
            amountMinor: "100",
            occurredAt,
            confirmOverSettlement: false,
          }),
        }),
        request(`/api/activities/${id}/members`, {
          method: "POST",
          headers,
          body: JSON.stringify({ displayName: "归档后临时成员" }),
        }),
        request(`/api/activities/${id}/invitations/link`, { method: "POST" }),
      ]);
    },
    {
      id: activityId,
      ownerMemberId: ownerId,
      otherMemberId: memberAId,
      occurredAt: now,
    },
  );
  expect(results).toEqual([
    { status: 409, code: "ACTIVITY_READ_ONLY" },
    { status: 409, code: "ACTIVITY_READ_ONLY" },
    { status: 409, code: "ACTIVITY_READ_ONLY" },
    { status: 409, code: "ACTIVITY_READ_ONLY" },
  ]);
}
