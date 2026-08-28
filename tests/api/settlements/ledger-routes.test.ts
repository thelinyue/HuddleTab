import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getBalances: vi.fn(),
  getRecommendations: vi.fn(),
  getPageContext: vi.fn(),
}));

vi.mock("@/server/auth/session", () => ({
  requireSession: vi.fn().mockResolvedValue({ user: { id: "user-1" } }),
  sessionUserId: vi.fn().mockReturnValue("user-1"),
}));
vi.mock("@/server/db/client", () => ({ sql: {} }));
vi.mock("@/server/services/ledger-service", () => ({
  LedgerService: class {
    getBalances = mocks.getBalances;
    getRecommendations = mocks.getRecommendations;
  },
}));
vi.mock("@/server/services/settlement-service", () => ({
  SettlementService: class {
    getPageContext = mocks.getPageContext;
  },
}));

import { GET as getLedger } from "@/app/api/activities/[activityId]/ledger/route";
import { GET as getRecommendations } from "@/app/api/activities/[activityId]/settlement-recommendations/route";
import { GET as getSettlementContext } from "@/app/api/activities/[activityId]/settlements/context/route";

const context = { params: Promise.resolve({ activityId: "activity-1" }) };

it("Ledger 路由返回当前权威余额和字符串 Revision", async () => {
  mocks.getBalances.mockResolvedValue({
    activityId: "activity-1",
    currency: "CNY",
    revision: "7",
    balances: [{ memberId: "A", netMinor: "500" }],
  });

  const response = await getLedger(
    new Request("http://localhost/api/activities/activity-1/ledger"),
    context,
  );

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    data: {
      activityId: "activity-1",
      currency: "CNY",
      revision: "7",
      balances: [{ memberId: "A", netMinor: "500" }],
    },
  });
});

it("推荐路由返回非持久化的确定性转账结果", async () => {
  mocks.getRecommendations.mockResolvedValue({
    activityId: "activity-1",
    currency: "CNY",
    revision: "7",
    recommendations: [
      { payerMemberId: "C", receiverMemberId: "A", amountMinor: "500" },
    ],
  });

  const response = await getRecommendations(
    new Request(
      "http://localhost/api/activities/activity-1/settlement-recommendations",
    ),
    context,
  );

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    data: {
      activityId: "activity-1",
      currency: "CNY",
      revision: "7",
      recommendations: [
        { payerMemberId: "C", receiverMemberId: "A", amountMinor: "500" },
      ],
    },
  });
});

it("结算上下文投影正式成员头像预设，访客固定为空", async () => {
  mocks.getPageContext.mockResolvedValue({
    activity: { id: "activity-1", name: "旅行", currency: "CNY" },
    members: [
      { id: "member-user", displayName: "小李", status: "ACTIVE", avatarPreset: 5 },
      { id: "member-guest", displayName: "临时成员", status: "ACTIVE", avatarPreset: null },
    ],
    balances: [],
    recommendations: [],
  });

  const response = await getSettlementContext(
    new Request("http://localhost/api/activities/activity-1/settlements/context"),
    context,
  );

  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    data: {
      members: [
        { id: "member-user", avatarPreset: 5 },
        { id: "member-guest", avatarPreset: null },
      ],
    },
  });
});
