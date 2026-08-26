import { z } from "zod";

const positiveMinor = z
  .string()
  .regex(/^[1-9]\d*$/, "结算金额必须是正整数最小单位");

/** 结算只接受主币种最小单位，金额与真实付款事实在 Service 内再次核验。 */
export const createSettlementInput = z
  .object({
    payerMemberId: z.string().min(1),
    receiverMemberId: z.string().min(1),
    amountMinor: positiveMinor,
    occurredAt: z.iso.datetime(),
    note: z.string().trim().max(500).optional(),
    confirmOverSettlement: z.boolean().default(false),
  })
  .refine((input) => input.payerMemberId !== input.receiverMemberId, {
    path: ["receiverMemberId"],
    message: "付款人和收款人不能相同",
  });

export const updateSettlementInput = createSettlementInput.extend({
  version: z.number().int().positive(),
});
export const deleteSettlementInput = z.object({
  version: z.number().int().positive(),
});
