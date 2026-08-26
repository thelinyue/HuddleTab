import { createHmac } from "node:crypto";

import type postgres from "postgres";

import { ApplicationError } from "@/server/errors/application-error";

export interface RateLimitPolicy {
  readonly limit: number;
  readonly windowSeconds: number;
}

/** 标识符只保存服务端 HMAC 摘要；同一窗口的计数与阈值判断位于一个事务中。 */
export class RateLimiter {
  constructor(
    private readonly sql: ReturnType<typeof postgres>,
    private readonly secret: string,
  ) {}

  async consume(
    scope: string,
    identifier: string,
    policy: RateLimitPolicy,
  ): Promise<void> {
    const bucketKey = createHmac("sha256", this.secret)
      .update(`${scope}:${identifier}`)
      .digest("base64url");
    const windowMs = policy.windowSeconds * 1000;
    const windowStartedAt = new Date(
      Math.floor(Date.now() / windowMs) * windowMs,
    );
    const expiresAt = new Date(windowStartedAt.getTime() + windowMs);

    await this.sql.begin(async (transaction) => {
      const [bucket] = await transaction`
        insert into security_rate_limit_buckets (bucket_key, window_started_at, attempts, expires_at)
        values (${bucketKey}, ${windowStartedAt}, 1, ${expiresAt})
        on conflict (bucket_key, window_started_at)
        do update set attempts = security_rate_limit_buckets.attempts + 1
        returning attempts`;
      if (Number(bucket?.attempts) > policy.limit) {
        throw new ApplicationError(
          "RATE_LIMITED",
          "尝试次数过多，请稍后再试。",
          429,
        );
      }
    });
  }
}
