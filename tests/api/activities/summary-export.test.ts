import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ get: vi.fn(), getExpenseExport: vi.fn() }));
vi.mock("@/server/auth/session", () => ({
  requireSession: vi.fn().mockResolvedValue({ user: { id: "user-1" } }),
  sessionUserId: vi.fn().mockReturnValue("user-1"),
}));
vi.mock("@/server/db/client", () => ({ sql: {} }));
vi.mock("@/server/services/activity-summary-service", () => ({
  ActivitySummaryService: class {
    get = mocks.get;
    getExpenseExport = mocks.getExpenseExport;
  },
}));

import { GET } from "@/app/api/activities/[activityId]/summary/route";
import { GET as exportCsv } from "@/app/api/activities/[activityId]/export.csv/route";

it("summary 返回授权账务摘要且不包含私有字段", async () => {
  mocks.get.mockResolvedValue({
    activityName: "大阪",
    memberCount: 3,
    startDate: "2026-08-20",
    endDate: "2026-08-24",
    currentUserBalanceMinor: "-1200",
    currency: "CNY",
    revision: "2",
    balances: [],
  });
  const response = await GET(
    new Request("http://localhost/api/activities/activity-1/summary"),
    { params: Promise.resolve({ activityId: "activity-1" }) },
  );
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.data).toMatchObject({
    activityName: "大阪",
    memberCount: 3,
    startDate: "2026-08-20",
    endDate: "2026-08-24",
    currentUserBalanceMinor: "-1200",
  });
  expect(JSON.stringify(body)).not.toMatch(/email|attachment|audit/i);
});

it("CSV 导出使用固定列、私有缓存策略和安全下载文件名", async () => {
  mocks.getExpenseExport.mockResolvedValue([
    {
      occurredAt: "2026-08-23T08:00:00.000Z",
      title: "晚餐",
      category: "FOOD",
      originalAmount: "1200",
      originalCurrency: "CNY",
      exchangeRate: "1",
      baseAmount: "1200",
      payers: [
        { name: "小王", amount: "800" },
        { name: "小李", amount: "400" },
      ],
      participants: [{ name: "小王", amount: "1200" }],
      splitMode: "EQUAL",
      creatorName: "小王",
      createdAt: "2026-08-23T09:00:00.000Z",
      note: null,
    },
  ]);

  const response = await exportCsv(
    new Request("http://localhost/api/activities/activity-1/export.csv"),
    { params: Promise.resolve({ activityId: "activity-1" }) },
  );

  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain(
    "text/csv; charset=utf-8",
  );
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("content-disposition")).toContain(
    'filename="activity-export.csv"',
  );
  const bytes = new Uint8Array(await response.clone().arrayBuffer());
  expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  const csv = await response.text();
  expect(csv).toContain(
    "消费时间,用途,分类,原始金额,原始币种,汇率,主币种金额,付款人,参与成员,分摊方式,创建人,创建时间,备注",
  );
  expect(csv).toContain("小王:800 | 小李:400");
  expect(csv).not.toMatch(/email|attachment|audit/i);
});
