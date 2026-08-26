/** 待同步金额仅显示为本地预估，不能覆盖或伪装成服务器权威总额、余额和 Ledger。 */
export function mergeFeed(
  snapshot: { totalMinor: string; baseCurrency: string; feed: unknown[] },
  pending: readonly {
    payload: { originalCurrency: string; originalAmountMinor: string };
  }[],
) {
  return {
    ...snapshot,
    authoritativeTotalMinor: snapshot.totalMinor,
    localPendingEstimateMinor: pending
      .reduce(
        (sum, item) =>
          sum +
          (item.payload.originalCurrency === snapshot.baseCurrency
            ? BigInt(item.payload.originalAmountMinor)
            : 0n),
        0n,
      )
      .toString(),
    authorityLabel: "截至上次同步" as const,
  };
}
