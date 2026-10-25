import type { PendingAttachment, PendingExpenseMutation } from "../../pwa/indexed-db/schema";
import type { ActivityMember } from "../activities/api";
import type { ExpenseAggregate } from "./api";

/** 历史进度只辅助区分原本无需结算的账单，待结状态统一以当前净余额为准。 */
export function currentSettlementLabel(aggregate: Pick<ExpenseAggregate, "currentSettlement" | "settlementProgress">): string {
  if (!aggregate.currentSettlement) return "当前结算信息待同步";
  if (BigInt(aggregate.currentSettlement.remainingMinor) > 0n) return "待结算";
  return aggregate.settlementProgress?.status === "NO_SETTLEMENT_REQUIRED" ? "无需结算" : "已结清";
}
export const categories = [
  ["FOOD", "餐饮", "food"], ["TRANSPORT", "交通", "transport"], ["LODGING", "住宿", "lodging"],
  ["TICKET", "门票", "ticket"], ["SHOPPING", "购物", "shopping"], ["ENTERTAINMENT", "娱乐", "entertainment"], ["OTHER", "其他", "other"],
] as const;

export type QuickExpensePreferences = {
  category?: (typeof categories)[number][0];
  payerMode?: "single" | "multiple";
  payerIds?: string[];
  participantIds?: string[];
};

function quickExpensePreferencesKey(userId: string, activityId: string): string {
  return `huddletab:expense-preferences:${userId}:${activityId}`;
}

/** 本地记忆按账号和活动隔离；成员状态变化时由调用方再过滤 ID。 */
export function readQuickExpensePreferences(userId: string, activityId: string): QuickExpensePreferences | undefined {
  try {
    const raw = window.localStorage.getItem(quickExpensePreferencesKey(userId, activityId));
    if (!raw) return undefined;
    const value = JSON.parse(raw) as Partial<QuickExpensePreferences>;
    if (!value || typeof value !== "object") return undefined;
    return {
      category: typeof value.category === "string" ? value.category as QuickExpensePreferences["category"] : undefined,
      payerMode: value.payerMode === "single" || value.payerMode === "multiple" ? value.payerMode : undefined,
      payerIds: Array.isArray(value.payerIds) ? value.payerIds.filter((id): id is string => typeof id === "string") : undefined,
      participantIds: Array.isArray(value.participantIds) ? value.participantIds.filter((id): id is string => typeof id === "string") : undefined,
    };
  } catch {
    return undefined;
  }
}

export function saveQuickExpensePreferences(userId: string, activityId: string, value: QuickExpensePreferences): void {
  try {
    window.localStorage.setItem(quickExpensePreferencesKey(userId, activityId), JSON.stringify(value));
  } catch {
    // 隐私模式或存储配额不足时退化为当前表单状态，不影响账单写入。
  }
}

export function memberName(memberId: string, members: readonly ActivityMember[] | undefined): string {
  return members?.find((member) => member.memberId === memberId)?.displayName ?? "未知成员";
}

export function memberAvatarPreset(memberId: string, members: readonly ActivityMember[] | undefined): number | null | undefined {
  return members?.find((member) => member.memberId === memberId)?.avatarPreset;
}

/** 统一把成员的自定义头像版本传给 MemberAvatar；临时成员自然回退到内置头像。 */
export function memberAvatarImage(memberId: string, members: readonly ActivityMember[] | undefined): { userId?: string | null; avatarImageId?: string | null } {
  const member = members?.find((item) => item.memberId === memberId);
  return { userId: member?.userId, avatarImageId: member?.avatarImageId };
}

export type PendingExpenseDraft = PendingExpenseMutation & { attachments: PendingAttachment[] };
export type QuickExpenseView =
  | "entry"
  | "payer"
  | "payer-add-guest"
  | "participants"
  | "participants-add-guest"
  | "category"
  | "currency"
  | "currency-rate"
  | "note"
  | "split";


export function quickExpenseViewTitle(view: QuickExpenseView): string {
  switch (view) {
    case "payer": return "付款人";
    case "payer-add-guest": return "添加临时成员";
    case "participants": return "参与人";
    case "participants-add-guest": return "添加临时成员";
    case "category": return "分类";
    case "currency": return "选择币种";
    case "currency-rate": return "设置汇率";
    case "note": return "备注与图片";
    case "split": return "分摊设置";
    default: return "记一笔";
  }
}

export function parentQuickExpenseView(view: QuickExpenseView): QuickExpenseView {
  if (view === "payer-add-guest") return "payer";
  if (view === "participants-add-guest") return "participants";
  if (view === "currency-rate") return "currency";
  return "entry";
}

export function quickExpenseBackLabel(view: QuickExpenseView, rootLabel = "记一笔"): string {
  if (view === "payer-add-guest") return "付款人";
  if (view === "participants-add-guest") return "参与人";
  if (view === "currency-rate") return "选择币种";
  return rootLabel;
}

/** 不同任务只占用完成它所需的高度，复杂分摊才提供第二个上拉停靠点。 */
export function quickExpenseMobileSheet(view: QuickExpenseView) {
  switch (view) {
    case "category":
      return { maxHeight: 0.45 };
    case "payer":
    case "payer-add-guest":
    case "participants":
    case "participants-add-guest":
    case "currency":
    case "currency-rate":
    case "note":
      return { maxHeight: 0.72 };
    case "split":
      return { maxHeight: 0.88, detents: [0.7, 0.88] as const, initialDetent: 0.7 };
    default:
      return { maxHeight: 0.88 };
  }
}

export function quickExpenseOverlayClass(view: QuickExpenseView): string {
  return `quick-expense-overlay quick-expense-overlay--entry quick-expense-overlay--view-${view}`;
}

