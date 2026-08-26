import { z } from "zod";

export const createActivityInput = z
  .object({
    name: z.string().trim().min(1).max(80),
    location: z.string().trim().max(120).optional(),
    baseCurrency: z.string().regex(/^[A-Z]{3}$/),
    startDate: z.iso.date(),
    endDate: z.iso.date().optional(),
  })
  .refine(
    (input) => !input.endDate || input.endDate >= input.startDate,
    "结束日期不能早于开始日期。",
  );
