import { fc, it } from "@fast-check/vitest";
import { expect } from "vitest";

import { recommendSettlements } from "@/domain/settlement/recommendation";
import { allocateByWeights } from "@/domain/splitting/allocation";

it.prop([
  fc.bigInt({ min: 0n, max: 10n ** 18n }),
  fc.uniqueArray(fc.uuid(), { minLength: 1, maxLength: 20 }),
])("分配守恒且不受输入顺序影响", (totalMinor, memberIds) => {
  const forward = allocateByWeights(
    totalMinor,
    memberIds.map((memberId) => ({ memberId, weight: 1n })),
  );
  const reverse = allocateByWeights(
    totalMinor,
    [...memberIds].reverse().map((memberId) => ({ memberId, weight: 1n })),
  );

  expect(forward.reduce((sum, row) => sum + row.amountMinor, 0n)).toBe(
    totalMinor,
  );
  expect(reverse).toEqual(forward);
});

it.prop([fc.bigInt({ min: 0n, max: 10n ** 12n })])(
  "两名成员的零和余额生成准确结算建议",
  (amountMinor) => {
    const recommendations = recommendSettlements([
      { memberId: "creditor", netMinor: amountMinor },
      { memberId: "debtor", netMinor: -amountMinor },
    ]);

    if (amountMinor === 0n) {
      expect(recommendations).toEqual([]);
      return;
    }

    expect(recommendations).toEqual([
      {
        payerMemberId: "debtor",
        receiverMemberId: "creditor",
        amountMinor,
      },
    ]);
  },
);
