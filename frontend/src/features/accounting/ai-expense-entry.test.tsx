import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError } from "../../api/error";
import { AiExpenseEntry, dismissAiFieldState, normalizeAiDraftForEditor } from "./ai-expense-entry";
import { createAiImageDraft, createAiTextDraft } from "./api";

vi.mock("./api", () => ({ createAiImageDraft: vi.fn(), createAiTextDraft: vi.fn() }));

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

  it("识别详情不会静默写入备注", () => {
    const normalized = normalizeAiDraftForEditor({ ...draft, location: "新宿", merchant: "居酒屋" }, members, "CNY", "IMAGE");
    expect(normalized.note).toBeUndefined();
    expect(normalized.recognitionDetails).toEqual(expect.arrayContaining(["商家：居酒屋", "地点：新宿"]));
  });
});

describe("AI 文字录入界面", () => {
  it("点击生成后直接请求并保留输入生成草稿", async () => {
    vi.mocked(createAiTextDraft).mockResolvedValue(draft);
    const onDraft = vi.fn();
    render(<AiExpenseEntry activityId="activity-1" members={members} baseCurrency="CNY" onDraft={onDraft} onManual={vi.fn()} />);
    const input = screen.getByRole("textbox", { name: /账单描述/ });
    fireEvent.change(input, { target: { value: "昨晚晚餐 12800 日元" } });
    fireEvent.click(screen.getByRole("button", { name: /生成账单草稿|重新生成草稿/ }));
    await waitFor(() => expect(onDraft).toHaveBeenCalledOnce());
    expect(createAiTextDraft).toHaveBeenCalledWith("activity-1", "昨晚晚餐 12800 日元", expect.any(AbortSignal));
  });

  it("请求中禁止重复提交并支持取消", async () => {
    let resolve: ((value: typeof draft) => void) | undefined;
    vi.mocked(createAiTextDraft).mockImplementation(() => new Promise((complete) => { resolve = complete; }));
    render(<AiExpenseEntry activityId="activity-1" members={members} baseCurrency="CNY" onDraft={vi.fn()} onManual={vi.fn()} />);
    fireEvent.change(screen.getByRole("textbox", { name: /账单描述/ }), { target: { value: "一笔账" } });
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
    fireEvent.click(screen.getByRole("button", { name: "生成账单草稿" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("12 秒");
    expect(screen.queryByText(/response|prompt|api\.deepseek/i)).not.toBeInTheDocument();
  });

  it("图片模式复用记一笔的图片入口并在选图后立即请求图片草稿", async () => {
    vi.mocked(createAiImageDraft).mockResolvedValue(draft);
    const onDraft = vi.fn();
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    const view = render(<AiExpenseEntry activityId="activity-1" members={members} baseCurrency="CNY" imageAvailable onDraft={onDraft} onManual={vi.fn()} />);
    fireEvent.click(screen.getByRole("tab", { name: "图片识别" }));
    expect(screen.getByText("添加图片")).toBeInTheDocument();
    expect(screen.getByText("未添加图片")).toBeInTheDocument();
    const fileInput = screen.getByLabelText("小票图片");
    expect(fileInput).toHaveClass("quick-expense-attachment__input");
    expect(fileInput).not.toHaveAttribute("capture");
    const file = new File([new Uint8Array([1, 2, 3])], "receipt.jpg", { type: "image/jpeg" });
    fireEvent.change(fileInput, { target: { files: [file] } });
    await waitFor(() => expect(onDraft).toHaveBeenCalledOnce());
    expect(createAiImageDraft).toHaveBeenCalledWith("activity-1", file, expect.any(String), expect.any(AbortSignal));
    expect(onDraft.mock.calls[0][0]).toMatchObject({ source: "IMAGE" });
    view.unmount();
    expect(revoke).toHaveBeenCalled();
    revoke.mockRestore();
  });

  it("系统来源选择后的图片复用同一套识别流程", async () => {
    vi.mocked(createAiImageDraft).mockResolvedValue(draft);
    const onDraft = vi.fn();
    render(<AiExpenseEntry activityId="activity-1" members={members} baseCurrency="CNY" imageAvailable onDraft={onDraft} onManual={vi.fn()} />);
    fireEvent.click(screen.getByRole("tab", { name: "图片识别" }));
    const fileInput = screen.getByLabelText("小票图片");
    const file = new File([new Uint8Array([1, 2, 3])], "camera.jpg", { type: "image/jpeg" });
    fireEvent.change(fileInput, { target: { files: [file] } });
    await waitFor(() => expect(onDraft).toHaveBeenCalledOnce());
    expect(createAiImageDraft).toHaveBeenCalledWith("activity-1", file, expect.any(String), expect.any(AbortSignal));
  });
});
