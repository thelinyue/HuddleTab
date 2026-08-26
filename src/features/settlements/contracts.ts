/** API 传输层中的金额与 Revision 均使用字符串，避免 JavaScript 安全整数边界。 */
export interface LedgerBalanceDto {
  readonly memberId: string;
  readonly netMinor: string;
}

export interface ActivityLedgerDto {
  readonly activityId: string;
  readonly currency: string;
  readonly revision: string;
  readonly balances: readonly LedgerBalanceDto[];
}

export interface SettlementRecommendationDto {
  readonly payerMemberId: string;
  readonly receiverMemberId: string;
  readonly amountMinor: string;
}

export interface SettlementRecommendationResult {
  readonly activityId: string;
  readonly currency: string;
  readonly revision: string;
  readonly recommendations: readonly SettlementRecommendationDto[];
}
