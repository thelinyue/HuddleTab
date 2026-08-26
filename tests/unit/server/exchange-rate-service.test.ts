import { expect, it, vi } from "vitest";

import { ExchangeRateService } from "@/server/services/exchange-rate-service";

it("Provider 失败时使用最近缓存而不阻塞记账", async () => {
  const provider = { getRate: vi.fn().mockRejectedValue(new Error("timeout")) };
  const cache = {
    findToday: vi.fn().mockResolvedValue(null),
    findLatest: vi.fn().mockResolvedValue({
      rate: "0.048",
      capturedAt: new Date("2026-08-22T08:00:00Z"),
    }),
    save: vi.fn(),
  };

  await expect(
    new ExchangeRateService(provider, cache).suggest(
      "JPY",
      "CNY",
      new Date("2026-08-23T08:00:00Z"),
    ),
  ).resolves.toMatchObject({ rate: "0.048", source: "CACHE" });
});
