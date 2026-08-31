import { z } from "zod";

import { currencyCodeInput } from "@/server/validation/currency";

export const createActivityInput = z
  .object({
    name: z.string().trim().min(1).max(80),
    location: z.string().trim().max(120).optional(),
    baseCurrency: currencyCodeInput,
    startDate: z.iso.date(),
    endDate: z.iso.date().optional(),
  })
  .refine(
    (input) => !input.endDate || input.endDate >= input.startDate,
    "结束日期不能早于开始日期。",
  );

export const updateActivityInput = z
  .object({
    revision: z.string().regex(/^\d+$/, "revision 必须是非负整数字符串"),
    name: z.string().trim().min(1).max(80).optional(),
    location: z.string().trim().max(120).nullable().optional(),
    baseCurrency: currencyCodeInput.optional(),
    startDate: z.iso.date().optional(),
    endDate: z.iso.date().nullable().optional(),
  })
  .strict()
  .refine(
    (input) =>
      ["name", "location", "baseCurrency", "startDate", "endDate"].some(
        (field) => field in input,
      ),
    "至少提供一个需要更新的活动字段。",
  );
