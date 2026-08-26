import { z } from "zod";

/** 创建活动的 HTTP 输入只接受明确的日历日期与 ISO 三字母币种。 */
export const createActivityInput = z
  .object({
    name: z.string().trim().min(1).max(80),
    location: z.string().trim().max(120).optional(),
    baseCurrency: z.string().regex(/^[A-Z]{3}$/),
    startDate: z.iso.date(),
    endDate: z.iso.date().optional(),
  })
  .superRefine((input, context) => {
    if (input.endDate && input.endDate < input.startDate) {
      context.addIssue({
        code: "custom",
        path: ["endDate"],
        message: "结束日期不能早于开始日期。",
      });
    }
  });
