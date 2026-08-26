export interface ExchangeRateProvider {
  getRate(
    from: string,
    to: string,
    at: Date,
  ): Promise<{ rate: string; capturedAt: Date; provider: string }>;
}

export interface ExchangeRateCache {
  findToday(
    from: string,
    to: string,
    at: Date,
  ): Promise<{ rate: string; capturedAt: Date } | null>;
  findLatest(
    from: string,
    to: string,
  ): Promise<{ rate: string; capturedAt: Date } | null>;
  save(value: {
    from: string;
    to: string;
    rate: string;
    capturedAt: Date;
    provider: string;
  }): Promise<void>;
}

/** Provider 只给出建议；保存消费时使用请求中的精确汇率快照，之后不再追随实时值。 */
export class ExchangeRateService {
  constructor(
    private readonly provider: ExchangeRateProvider,
    private readonly cache: ExchangeRateCache,
  ) {}

  async suggest(from: string, to: string, at: Date) {
    if (from === to) {
      return { rate: "1", source: "IDENTITY" as const, capturedAt: at };
    }
    try {
      const value = await this.provider.getRate(from, to, at);
      await this.cache.save({ from, to, ...value });
      return {
        rate: value.rate,
        source: "PROVIDER" as const,
        capturedAt: value.capturedAt,
      };
    } catch {
      const cached =
        (await this.cache.findToday(from, to, at)) ??
        (await this.cache.findLatest(from, to));
      return cached ? { ...cached, source: "CACHE" as const } : null;
    }
  }
}
