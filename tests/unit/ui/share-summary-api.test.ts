import { afterEach, expect, test, vi } from "vitest";

import { getShareSummary } from "@/features/settlements/share-summary/api";

afterEach(() => {
  vi.unstubAllGlobals();
});

test("把授权活动摘要转换为分享卡所需的实际结算数据", async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        data: {
          activityName: "真实大阪行",
          startDate: "2026-08-20",
          endDate: "2026-08-24",
          memberCount: 3,
          totalExpenseMinor: "50050",
          currency: "JPY",
          revision: "8",
          originalCurrencyTotals: [{ currency: "JPY", amountMinor: "50050" }],
          currentUserBalanceMinor: "-6966",
          balances: [
            { memberId: "member-a", displayName: "小王", netMinor: "1200" },
            { memberId: "member-b", displayName: "小李", netMinor: "-1200" },
            { memberId: "member-c", displayName: "小陈", netMinor: "0" },
          ],
          recommendations: [
            {
              payerMemberId: "member-b",
              receiverMemberId: "member-a",
              amountMinor: "1200",
            },
            {
              payerMemberId: "missing-member",
              receiverMemberId: "member-a",
              amountMinor: "300",
            },
          ],
          categoryTotals: [{ category: "FOOD", amountMinor: "50050" }],
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ),
  );
  vi.stubGlobal("fetch", fetchMock);

  await expect(getShareSummary("activity/actual")).resolves.toEqual({
    activityName: "真实大阪行",
    memberCount: 3,
    currency: "JPY",
    totalAmountMinor: 50050n,
    viewerSummary: { status: "payable", amountMinor: 6966n },
    recommendations: [
      { fromName: "小李", toName: "小王", amountMinor: 1200n },
      { fromName: "成员", toName: "小王", amountMinor: 300n },
    ],
    balances: [
      { memberName: "小王", status: "receivable", amountMinor: 1200n },
      { memberName: "小李", status: "payable", amountMinor: 1200n },
      { memberName: "小陈", status: "settled", amountMinor: 0n },
    ],
  });
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/activities/activity%2Factual/summary",
    { cache: "no-store" },
  );
});

test("摘要 API 返回错误时透传服务端中文提示", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { message: "登录状态已失效，请重新登录。" },
        }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      ),
    ),
  );

  await expect(getShareSummary("activity-1")).rejects.toThrow(
    "登录状态已失效，请重新登录。",
  );
});
