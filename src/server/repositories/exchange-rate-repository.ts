import type postgres from "postgres";

import type { ExchangeRateCache } from "@/server/services/exchange-rate-service";
import { DEFAULT_TIME_ZONE, zonedDayRange } from "@/lib/time-zone";

/** PostgreSQL 缓存适配器只负责读取和持久化，不包含 Provider 回退决策。 */
export class ExchangeRateRepository implements ExchangeRateCache {
  constructor(
    private readonly sql: ReturnType<typeof postgres>,
    private readonly timeZone = process.env.TZ ?? DEFAULT_TIME_ZONE,
  ) {}

  async findToday(from: string, to: string, at: Date) {
    const { start, end } = zonedDayRange(at, this.timeZone);
    const [row] = await this
      .sql`select rate, captured_at from exchange_rate_cache where base_currency = ${from} and quote_currency = ${to} and captured_at >= ${start} and captured_at < ${end} order by captured_at desc limit 1`;
    return row ? { rate: row.rate, capturedAt: row.captured_at } : null;
  }

  async findLatest(from: string, to: string) {
    const [row] = await this
      .sql`select rate, captured_at from exchange_rate_cache where base_currency = ${from} and quote_currency = ${to} order by captured_at desc limit 1`;
    return row ? { rate: row.rate, capturedAt: row.captured_at } : null;
  }

  async save(value: {
    from: string;
    to: string;
    rate: string;
    capturedAt: Date;
    provider: string;
  }): Promise<void> {
    await this
      .sql`insert into exchange_rate_cache (base_currency, quote_currency, captured_at, provider, rate)
      values (${value.from}, ${value.to}, ${value.capturedAt}, ${value.provider}, ${value.rate}) on conflict do nothing`;
  }
}
