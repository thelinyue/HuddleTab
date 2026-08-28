import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  loadFacts: vi.fn(),
}));

vi.mock(
  "@/server/permissions/authorize-activity-operation",
  async (importOriginal) => ({
    ...(await importOriginal()),
    authorizeActivityOperation: mocks.authorize,
  }),
);
vi.mock("@/server/repositories/ledger-repository", () => ({
  LedgerRepository: class {
    loadFacts = mocks.loadFacts;
  },
}));

import { ActivitySummaryService } from "@/server/services/activity-summary-service";
import { ExpenseService } from "@/server/services/expense-service";

const session = { user: { id: "user-1" } };
const authorization = {
  userId: "user-1",
  activity: {
    id: "activity-1",
    status: "ACTIVE" as const,
    baseCurrency: "CNY",
    revision: 2n,
  },
  member: { id: "member-1", role: "OWNER" as const, status: "ACTIVE" as const },
};

function createSql() {
  const transaction = vi.fn(async (strings: TemplateStringsArray) => {
    const query = strings.join(" ");
    if (query.includes("set transaction isolation level")) return [];
    if (query.includes("select name, start_date, end_date from activities")) {
      return [
        {
          name: "服务契约活动",
          start_date: "2026-08-20",
          end_date: "2026-08-24",
        },
      ];
    }
    if (query.includes("select id, display_name from activity_members")) {
      return [{ id: "member-1", display_name: "Owner" }];
    }
    if (query.includes("total_expense_minor")) {
      return [{ total_expense_minor: "0" }];
    }
    if (query.includes("group by original_currency")) return [];
    if (query.includes("group by category")) return [];
    if (query.includes("from user_activity_preferences")) return [];
    if (query.includes("profile.avatar_preset")) {
      return [
        {
          id: "member-1",
          display_name: "Owner",
          status: "ACTIVE",
          member_type: "USER",
          avatar_preset: 5,
        },
      ];
    }
    if (query.includes("select title from expenses")) return [];
    throw new Error(`未预期查询：${query}`);
  });
  return {
    begin: async (callback: (tx: typeof transaction) => Promise<unknown>) =>
      callback(transaction),
  };
}

it("真实 ActivitySummaryService 输出页面依赖的活动摘要字段", async () => {
  mocks.authorize.mockResolvedValue(authorization);
  mocks.loadFacts.mockResolvedValue({
    memberIds: ["member-1"],
    payments: [],
    shares: [],
    settlements: [],
  });
  const sql = createSql();

  const summary = await new ActivitySummaryService(sql as never).get(
    session,
    "activity-1",
  );

  expect(summary).toMatchObject({
    startDate: "2026-08-20",
    endDate: "2026-08-24",
    memberCount: 1,
    currentUserBalanceMinor: "0",
  });
});

it("真实 ExpenseService 上下文输出活动生命周期和成员头像预设", async () => {
  mocks.authorize.mockResolvedValue(authorization);
  const sql = createSql();

  const entryContext = await new ExpenseService(sql as never).getEntryContext(
    session,
    "activity-1",
  );

  expect(entryContext).toMatchObject({
    activity: { status: "ACTIVE" },
    members: [{ id: "member-1", avatarPreset: 5 }],
  });
});
