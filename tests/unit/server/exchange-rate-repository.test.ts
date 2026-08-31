import { expect, test } from "vitest";

import { ExchangeRateRepository } from "@/server/repositories/exchange-rate-repository";

test("当天汇率缓存按部署 TZ 的自然日查询", async () => {
  const parameters: unknown[][] = [];
  const sql = (async (_strings: TemplateStringsArray, ...values: unknown[]) => {
    parameters.push(values);
    return [];
  }) as never;

  await new ExchangeRateRepository(sql, "Pacific/Honolulu").findToday(
    "JPY",
    "CNY",
    new Date("2026-08-31T01:53:00.000Z"),
  );

  expect(parameters[0]?.[2]).toEqual(new Date("2026-08-30T10:00:00.000Z"));
  expect(parameters[0]?.[3]).toEqual(new Date("2026-08-31T10:00:00.000Z"));
});
