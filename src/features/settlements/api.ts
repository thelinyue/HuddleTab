import { getCurrencyMinorUnits } from "@/domain/currency/currency";
import type { AvatarPreset } from "@/features/me/avatar-presets";
import type { CreateSettlementRequest } from "@/features/settlements/contracts";

export interface SettlementMemberDto {
  readonly id: string;
  readonly displayName: string;
  readonly status: "ACTIVE" | "LEFT";
  readonly avatarPreset?: AvatarPreset | null;
}

export interface SettlementPageContextDto {
  readonly activity: {
    readonly id: string;
    readonly name: string;
    readonly currency: string;
    readonly status: "ACTIVE" | "ENDED" | "ARCHIVED";
    readonly currentMemberId: string;
    readonly currentMemberStatus: "ACTIVE" | "LEFT";
    readonly currentMemberRole: "OWNER" | "ADMIN" | "MEMBER";
  };
  readonly members: readonly SettlementMemberDto[];
  readonly balances: readonly {
    readonly memberId: string;
    readonly netMinor: string;
  }[];
  readonly recommendations: readonly {
    readonly payerMemberId: string;
    readonly receiverMemberId: string;
    readonly amountMinor: string;
  }[];
}

export interface SettlementDto {
  readonly id: string;
  readonly payerMemberId: string;
  readonly receiverMemberId: string;
  readonly amountMinor: string;
  readonly currency: string;
  readonly occurredAt: string;
  readonly note: string | null;
}

export interface SettlementApiError {
  readonly code: string;
  readonly message: string;
  readonly details?: Record<string, string>;
}

async function readJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error("结算数据加载失败，请稍后重试。");
  return (await response.json()).data as T;
}

export function getSettlementContext(activityId: string) {
  return readJson<SettlementPageContextDto>(
    `/api/activities/${activityId}/settlements/context`,
  );
}

export function getSettlements(activityId: string) {
  return readJson<readonly SettlementDto[]>(
    `/api/activities/${activityId}/settlements`,
  );
}

/** Settlement 金额仅供输入框显示；提交前再转回 API 所需的精确最小单位字符串。 */
export function minorToInput(value: string, currency: string): string {
  const precision = getCurrencyMinorUnits(currency);
  const amount = BigInt(value);
  const divisor = 10n ** BigInt(precision);
  if (precision === 0) return amount.toString();
  return `${amount / divisor}.${(amount % divisor).toString().padStart(precision, "0")}`;
}

export async function createSettlement(
  activityId: string,
  input: CreateSettlementRequest,
) {
  const response = await fetch(`/api/activities/${activityId}/settlements`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const body = (await response.json()) as { error?: SettlementApiError };
    throw (
      body.error ?? {
        code: "SETTLEMENT_SAVE_FAILED",
        message: "结算保存失败，请稍后重试。",
      }
    );
  }
  return (await response.json()).data as { readonly settlement: SettlementDto };
}
