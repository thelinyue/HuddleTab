import { z } from "zod";

import { asCurrencyCode } from "@/domain/currency/currency";

/** API 仅接受项目固定目录内的 ISO 4217 code，展示名称永远不进入持久化边界。 */
export const currencyCodeInput = z
  .string()
  .regex(/^[A-Z]{3}$/, "币种必须是三个大写字母")
  .refine((value) => {
    try {
      asCurrencyCode(value);
      return true;
    } catch {
      return false;
    }
  }, "不支持的币种");
