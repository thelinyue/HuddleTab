import type { PendingAttachment, PendingExpenseMutation } from "../../pwa/indexed-db/schema";
import type { ActivityMember } from "../activities/api";
export const categories = [
  ["FOOD", "餐饮", "food"], ["TRANSPORT", "交通", "transport"], ["LODGING", "住宿", "lodging"],
  ["TICKET", "门票", "ticket"], ["SHOPPING", "购物", "shopping"], ["ENTERTAINMENT", "娱乐", "entertainment"], ["OTHER", "其他", "other"],
] as const;

export function memberName(memberId: string, members: readonly ActivityMember[] | undefined): string {
  return members?.find((member) => member.memberId === memberId)?.displayName ?? "未知成员";
}

export function memberAvatarPreset(memberId: string, members: readonly ActivityMember[] | undefined): number | null | undefined {
  return members?.find((member) => member.memberId === memberId)?.avatarPreset;
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
    case "note": return "备注与附件";
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

