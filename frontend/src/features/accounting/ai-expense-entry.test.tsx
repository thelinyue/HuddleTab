import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError } from "../../api/error";
import { AiExpenseEntry, dismissAiFieldState, normalizeAiDraftForEditor } from "./ai-expense-entry";
import { createAiTextDraft } from "./api";

vi.mock("./api", () => ({ createAiTextDraft: vi.fn() }));

const members = [
  { activityId: "activity-1", displayName: "我", memberId: "member-me", role: "OWNER", status: "ACTIVE", userId: "user-1", version: "1" },
  { activityId: "activity-1", displayName: "小王", memberId: "member-wang-1", role: "MEMBER", status: "ACTIVE", userId: "user-2", version: "1" },
  { activityId: "activity-1", displayName: "小王", memberId: "member-wang-2", role: "MEMBER", status: "ACTIVE", userId: "user-3", version: "1" },
] as const;

const draft = {
  title: "居酒屋晚餐",
  merchant: null,
  amount: { amountMinor: "12800", currency: "JPY" },
  occurredAt: "2026-09-18T12:00:00Z",
  categorySuggestion: "FOOD",
  location: null,
  note: null,
  items: [],
  payerSuggestions: [
    { mention: "我", matchStatus: "MATCHED", memberId: "member-me", candidateMemberIds: [], matchedDisplayName: "我", candidateCount: null, amount: { amountMinor: "12800", currency: "JPY" } },
    { mention: "伪造", matchStatus: "MATCHED", memberId: "not-a-member", candidateMemberIds: ["not-a-member"], matchedDisplayName: null, candidateCount: null, amount: null },
    { mention: "小王", matchStatus: "AMBIGUOUS", memberId: null, candidateMemberIds: ["member-wang-1", "not-a-member"], matchedDisplayName: null, candidateCount: 2, amount: null },
  ],
  splitSuggestion: { mode: "EQUAL", participants: [{ mention: "我", matchStatus: "MATCHED", memberId: "member-me", candidateMemberIds: [], matchedDisplayName: "我", candidateCount: null, value: null }] },
  warnings: [],
  incompleteFields: [],
};

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("AI 文字草稿适配", () => {
  it("用户编辑任一账务区域后都能移除对应来源状态", () => {
    const fields = ["title", "amount", "currency", "occurredAt", "category", "note", "payer", "participants", "split"] as const;
    const states = Object.fromEntries(fields.map((field) => [field, "AI_SUGGESTED" as const]));
    for (const field of fields) expect(dismissAiFieldState(states, field)).not.toHaveProperty(field);
  });

  it("只保留当前活动 ACTIVE 成员的真实 memberId", () => {
    const normalized = normalizeAiDraftForEditor(draft, members, "CNY");
    expect(normalized.payerIds).toEqual(["member-me"]);
    expect(normalized.memberSuggestions.find((item) => item.mention === "伪造")).toMatchObject({ matchStatus: "UNMATCHED", memberId: undefined, candidateMemberIds: [] });
    expect(normalized.memberSuggestions.find((item) => item.mention === "小王")).toMatchObject({ matchStatus: "AMBIGUOUS", memberId: undefined, candidateMemberIds: ["member-wang-1"] });
  });

  it("使用服务端 minor unit，不重新解析模型十进制金额", () => {
    const normalized = normalizeAiDraftForEditor(draft, members, "CNY");
    expect(normalized.amountMinor).toBe("12800");
    expect(normalized.currency).toBe("JPY");
  });

  it("不完整分摊保留成员信息但不会伪造完整参数", () => {
    const normalized = normalizeAiDraftForEditor({ ...draft, splitSuggestion: { mode: "EXACT", participants: [{ ...draft.splitSuggestion.participants[0], value: null }] } }, members, "CNY");
    expect(normalized.participantIds).toEqual(["member-me"]);
    expect(normalized.splitValues).toBeUndefined();
    expect(normalized.warnings).toContain("分摊信息不完整，请在现有分摊编辑器中确认。");
  });
});

describe("AI 文字录入界面", () => {
  it("隐私确认前不发送请求，确认后保留输入并生成草稿", async () => {
    vi.mocked(createAiTextDraft).mockResolvedValue(draft);
    const onDraft = vi.fn();
    render(<AiExpenseEntry activityId="activity-1" members={members} baseCurrency="CNY" onDraft={onDraft} onManual={vi.fn()} />);
    const input = screen.getByRole("textbox", { name: /账单描述/ });
    fireEvent.change(input, { target: { value: "昨晚晚餐 12800 日元" } });
    fireEvent.click(screen.getByRole("button", { name: /生成账单草稿|重新生成草稿/ }));
    expect(createAiTextDraft).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("确认");
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /生成账单草稿|重新生成草稿/ }));
    await waitFor(() => expect(onDraft).toHaveBeenCalledOnce());
    expect(createAiTextDraft).toHaveBeenCalledWith("activity-1", "昨晚晚餐 12800 日元", expect.any(AbortSignal));
  });

  it("请求中禁止重复提交并支持取消", async () => {
    let resolve: ((value: typeof draft) => void) | undefined;
    vi.mocked(createAiTextDraft).mockImplementation(() => new Promise((complete) => { resolve = complete; }));
    render(<AiExpenseEntry activityId="activity-1" members={members} baseCurrency="CNY" onDraft={vi.fn()} onManual={vi.fn()} />);
    fireEvent.change(screen.getByRole("textbox", { name: /账单描述/ }), { target: { value: "一笔账" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "生成账单草稿" }));
    expect(screen.getByRole("button", { name: "取消智能录入" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "取消智能录入" }));
    expect(createAiTextDraft).toHaveBeenCalledOnce();
    resolve?.(draft);
  });

  it("把 429 映射为可操作提示且不泄露原始响应", async () => {
    vi.mocked(createAiTextDraft).mockRejectedValue(new ApiRequestError(429, undefined, 12));
    render(<AiExpenseEntry activityId="activity-1" members={members} baseCurrency="CNY" onDraft={vi.fn()} onManual={vi.fn()} />);
    fireEvent.change(screen.getByRole("textbox", { name: /账单描述/ }), { target: { value: "一笔账" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "生成账单草稿" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("12 秒");
    expect(screen.queryByText(/response|prompt|api\.deepseek/i)).not.toBeInTheDocument();
  });
});
