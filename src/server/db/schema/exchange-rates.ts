import {
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/** 缓存只用于建议；Expense 自身始终保存创建时采用的精确汇率。 */
export const exchangeRateCache = pgTable(
  "exchange_rate_cache",
  {
    baseCurrency: text("base_currency").notNull(),
    quoteCurrency: text("quote_currency").notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
    provider: text("provider").notNull(),
    rate: numeric("rate").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [
        table.baseCurrency,
        table.quoteCurrency,
        table.capturedAt,
        table.provider,
      ],
    }),
  ],
);
