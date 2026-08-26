export type ExpenseSplitInput =
  | { readonly mode: "EQUAL"; readonly members: readonly string[] }
  | {
      readonly mode: "EXACT" | "PERCENTAGE" | "WEIGHT";
      readonly entries: readonly {
        readonly memberId: string;
        readonly value: string;
      }[];
    };

export interface CreateExpenseRequest {
  readonly clientMutationId: string;
  readonly title: string;
  readonly category: string;
  readonly originalCurrency: string;
  readonly originalAmountMinor: string;
  readonly exchangeRate: string;
  readonly exchangeRateSource: "IDENTITY" | "PROVIDER" | "CACHE" | "MANUAL";
  readonly exchangeRateAt: string;
  readonly occurredAt: string;
  readonly note?: string;
  readonly payments: readonly {
    readonly memberId: string;
    readonly amountMinor: string;
  }[];
  readonly split: ExpenseSplitInput;
}

export interface UpdateExpenseRequest extends CreateExpenseRequest {
  readonly version: number;
}
