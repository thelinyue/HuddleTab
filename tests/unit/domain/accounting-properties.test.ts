import { fc, it } from "@fast-check/vitest";
import { expect } from "vitest";
import { allocateByWeights } from "@/domain/splitting/allocation";
import { recommendSettlements } from "@/domain/settlement/recommendation";

it.prop([
  fc.bigInt({ min: 0n, max: 10n ** 18n }),
  fc.uniqueArray(fc.uuid(), { minLength: 1, maxLength: 20 }),
])(
  "allocation conserves every minor unit and ignores input order",
  (totalMinor, ids) => {
    const forward = allocateByWeights(
      totalMinor,
      ids.map((memberId) => ({ memberId, weight: 1n })),
    );
    const reverse = allocateByWeights(
      totalMinor,
      [...ids].reverse().map((memberId) => ({ memberId, weight: 1n })),
    );
    expect(forward.reduce((sum, row) => sum + row.amountMinor, 0n)).toBe(
      totalMinor,
    );
    expect(reverse).toEqual(forward);
  },
);

it.prop([fc.bigInt({ min: 0n, max: 10n ** 12n })])(
  "a two-member zero-sum balance is recommended exactly",
  (amountMinor) => {
    const result = recommendSettlements([
      { memberId: "creditor", netMinor: amountMinor },
      { memberId: "debtor", netMinor: -amountMinor },
    ]);
    expect(result.reduce((sum, row) => sum + row.amountMinor, 0n)).toBe(
      amountMinor,
    );
  },
);
