import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ authorize: vi.fn() }));

vi.mock(
  "@/server/permissions/authorize-activity-operation",
  async (importOriginal) => ({
    ...(await importOriginal()),
    authorizeActivityOperation: mocks.authorize,
  }),
);

import { getActivityFieldPermissions } from "@/server/services/activity-details-service";
import { ActivityDetailsService } from "@/server/services/activity-details-service";

const session = { user: { id: "user-1" } };
const authorization = {
  userId: "user-1",
  activity: {
    id: "activity-1",
    status: "ACTIVE" as const,
    deletedAt: null,
    baseCurrency: "CNY",
    revision: 3n,
  },
  member: { id: "member-1", role: "OWNER" as const, status: "ACTIVE" as const },
};

function createSql(input?: {
  readonly status?: "ACTIVE" | "ENDED" | "ARCHIVED";
  readonly hasAccountingRecords?: boolean;
  readonly earliestExpenseDate?: string | null;
}) {
  let row = {
    id: "activity-1",
    name: "大阪行",
    location: "日本大阪" as string | null,
    base_currency: "CNY",
    start_date: "2026-08-20",
    end_date: "2026-08-24" as string | null,
    status: input?.status ?? "ACTIVE",
    revision: "3",
  };
  const audits: unknown[] = [];
  let updateCount = 0;
  const transaction = vi.fn(
    async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const query = strings.join(" ");
      if (query.includes("from activities") && query.includes("for update")) {
        return [row];
      }
      if (query.includes("exists(select 1 from expenses")) {
        return [
          {
            has_accounting_records: input?.hasAccountingRecords ?? false,
            earliest_expense_date: input?.earliestExpenseDate ?? null,
          },
        ];
      }
      if (query.includes("update activities")) {
        updateCount += 1;
        row = {
          ...row,
          name: values[0] as string,
          location: values[1] as string | null,
          base_currency: values[2] as string,
          start_date: values[3] as string,
          end_date: values[4] as string | null,
          revision: String(Number(row.revision) + 1),
        };
        return [row];
      }
      if (query.includes("insert into activity_audit_logs")) {
        audits.push(JSON.parse(values.at(-1) as string));
        return [];
      }
      throw new Error(`未预期查询：${query}`);
    },
  );
  return {
    sql: {
      begin: async (callback: (tx: typeof transaction) => Promise<unknown>) =>
        callback(transaction),
    },
    audits,
    getUpdateCount: () => updateCount,
  };
}

it("按角色、成员状态、生命周期和账务记录计算活动字段权限", () => {
  const cases = [
    {
      input: {
        role: "OWNER" as const,
        memberStatus: "ACTIVE" as const,
        activityStatus: "ACTIVE" as const,
        hasAccountingRecords: false,
      },
      expected: [true, true, true, true, true],
    },
    {
      input: {
        role: "ADMIN" as const,
        memberStatus: "ACTIVE" as const,
        activityStatus: "ACTIVE" as const,
        hasAccountingRecords: true,
      },
      expected: [true, true, false, true, true],
    },
    {
      input: {
        role: "OWNER" as const,
        memberStatus: "ACTIVE" as const,
        activityStatus: "ENDED" as const,
        hasAccountingRecords: false,
      },
      expected: [true, true, false, false, false],
    },
    {
      input: {
        role: "OWNER" as const,
        memberStatus: "ACTIVE" as const,
        activityStatus: "ARCHIVED" as const,
        hasAccountingRecords: false,
      },
      expected: [false, false, false, false, false],
    },
    {
      input: {
        role: "MEMBER" as const,
        memberStatus: "ACTIVE" as const,
        activityStatus: "ACTIVE" as const,
        hasAccountingRecords: false,
      },
      expected: [false, false, false, false, false],
    },
    {
      input: {
        role: "ADMIN" as const,
        memberStatus: "LEFT" as const,
        activityStatus: "ACTIVE" as const,
        hasAccountingRecords: false,
      },
      expected: [false, false, false, false, false],
    },
  ];

  for (const { input, expected } of cases) {
    expect(Object.values(getActivityFieldPermissions(input))).toEqual(expected);
  }
});

it("更新实际变化字段、递增 revision 并写入 before/after Audit", async () => {
  mocks.authorize.mockResolvedValue(authorization);
  const fake = createSql();

  const result = await new ActivityDetailsService(fake.sql as never).update(
    session,
    "activity-1",
    {
      revision: "3",
      name: "大阪秋日行",
      location: null,
      baseCurrency: "JPY",
    },
  );

  expect(result.activity).toMatchObject({
    name: "大阪秋日行",
    location: null,
    baseCurrency: "JPY",
    revision: "4",
  });
  expect(result.warnings).toEqual([]);
  expect(fake.audits).toEqual([
    {
      changes: {
        name: { before: "大阪行", after: "大阪秋日行" },
        location: { before: "日本大阪", after: null },
        baseCurrency: { before: "CNY", after: "JPY" },
      },
    },
  ]);
});

it("无实际变化时不更新 revision 且不写 Audit", async () => {
  mocks.authorize.mockResolvedValue(authorization);
  const fake = createSql();

  const result = await new ActivityDetailsService(fake.sql as never).update(
    session,
    "activity-1",
    { revision: "3", name: "大阪行", location: "日本大阪" },
  );

  expect(result.activity.revision).toBe("3");
  expect(fake.getUpdateCount()).toBe(0);
  expect(fake.audits).toEqual([]);
});

it("开始日期晚于最早消费日期时保存并返回非阻断警告", async () => {
  mocks.authorize.mockResolvedValue(authorization);
  const fake = createSql({
    hasAccountingRecords: true,
    earliestExpenseDate: "2026-08-25",
  });

  const result = await new ActivityDetailsService(fake.sql as never).update(
    session,
    "activity-1",
    { revision: "3", startDate: "2026-08-30", endDate: null },
  );

  expect(result.activity.startDate).toBe("2026-08-30");
  expect(result.warnings).toEqual(["EXPENSE_BEFORE_ACTIVITY_START"]);
});

it("稳定拒绝 revision 冲突、账务后改币种、生命周期锁定和非法日期", async () => {
  mocks.authorize.mockResolvedValue(authorization);
  await expect(
    new ActivityDetailsService(createSql().sql as never).update(
      session,
      "activity-1",
      { revision: "2", name: "旧客户端" },
    ),
  ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });

  await expect(
    new ActivityDetailsService(
      createSql({ hasAccountingRecords: true }).sql as never,
    ).update(session, "activity-1", {
      revision: "3",
      baseCurrency: "JPY",
    }),
  ).rejects.toMatchObject({ code: "BASE_CURRENCY_LOCKED" });

  mocks.authorize.mockResolvedValue({
    ...authorization,
    activity: { ...authorization.activity, status: "ENDED" as const },
  });
  await expect(
    new ActivityDetailsService(createSql({ status: "ENDED" }).sql as never).update(
      session,
      "activity-1",
      { revision: "3", startDate: "2026-08-21" },
    ),
  ).rejects.toMatchObject({ code: "ACTIVITY_FIELD_LOCKED" });

  mocks.authorize.mockResolvedValue(authorization);
  await expect(
    new ActivityDetailsService(createSql().sql as never).update(
      session,
      "activity-1",
      { revision: "3", startDate: "2026-08-30" },
    ),
  ).rejects.toMatchObject({ code: "INVALID_ACTIVITY_DATE_RANGE" });
});
