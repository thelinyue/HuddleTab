import { createHmac } from "node:crypto";
import type { Sql } from "postgres";

import { ApplicationError } from "@/server/errors/application-error";

/** V1 的固定窗口策略：每个身份标识在 15 分钟内最多允许 5 次尝试。 */
export const RATE_LIMIT_ATTEMPT_LIMIT = 5;
export const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

/**
 * 每种认证入口使用独立 scope，避免同一标识在不同攻击面共享错误的计数器。
 * INVITATION_TOKEN 为后续邀请入口预留；本阶段不接入任何邀请路由。
 */
export type RateLimitScope =
  | "LOGIN_USERNAME"
  | "LOGIN_IP"
  | "REGISTER_USERNAME"
  | "REGISTER_IP"
  | "SETUP_TOKEN"
  | "SETUP_IP"
  | "INVITATION_TOKEN";

export type RateLimitBucket = {
  scope: RateLimitScope;
  identifier: string;
};

/**
 * PostgreSQL 持久化认证限流器。
 *
 * 数据库只保存由既有 Better Auth secret 派生的 HMAC-SHA256 bucket key，绝不写入
 * 原始用户名、Setup Token、IP、密码或内部 synthetic email。固定窗口通过主键和
 * `attempts < limit` 的 upsert 在数据库内原子递增：第 limit 次返回成功，后续尝试
 * 没有 RETURNING 行并被拒绝；并发请求也由 PostgreSQL 的冲突行锁正确序列化。
 */
export class RateLimiter {
  constructor(
    private readonly sql: Sql,
    private readonly secret: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async consume(scope: RateLimitScope, identifier: string): Promise<void> {
    await this.consumeAll([{ scope, identifier }]);
  }

  /** 同一认证请求的稳定标识与可信 IP 必须在一个事务中共同消费。 */
  async consumeAll(buckets: readonly RateLimitBucket[]): Promise<void> {
    const uniqueBuckets = this.uniqueBuckets(buckets);
    if (uniqueBuckets.length === 0) return;

    const now = this.now();
    const windowStartedAt = new Date(
      Math.floor(now.getTime() / RATE_LIMIT_WINDOW_MS) * RATE_LIMIT_WINDOW_MS,
    );
    const expiresAt = new Date(
      windowStartedAt.getTime() + RATE_LIMIT_WINDOW_MS,
    );

    // postgres.js 的预编译 timestamptz 参数需字符串编码，ISO 仍保留精确 UTC 窗口边界。
    const windowStartedAtIso = windowStartedAt.toISOString();
    const expiresAtIso = expiresAt.toISOString();

    await this.sql.begin(async (transaction) => {
      for (const bucket of uniqueBuckets) {
        const bucketKey = this.createBucketKey(bucket);
        const updated = await transaction<{ attempts: number }[]>`
          insert into security_rate_limit_buckets (
            bucket_key, window_started_at, attempts, expires_at
          ) values (${bucketKey}, ${windowStartedAtIso}, 1, ${expiresAtIso})
          on conflict (bucket_key, window_started_at) do update
          set attempts = security_rate_limit_buckets.attempts + 1,
              expires_at = excluded.expires_at
          where security_rate_limit_buckets.attempts < ${RATE_LIMIT_ATTEMPT_LIMIT}
          returning attempts
        `;

        if (updated.length !== 1) {
          throw new ApplicationError(
            "RATE_LIMITED",
            "尝试次数过多，请稍后再试。",
            429,
          );
        }
      }
    });
  }

  private uniqueBuckets(
    buckets: readonly RateLimitBucket[],
  ): RateLimitBucket[] {
    const seen = new Set<string>();

    return buckets.filter((bucket) => {
      const key = `${bucket.scope}\u0000${bucket.identifier}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  /** 分隔 scope 与值，防止不同 scope 的同文本标识得到相同 bucket。 */
  private createBucketKey(bucket: RateLimitBucket): string {
    return createHmac("sha256", this.secret)
      .update(bucket.scope)
      .update("\u0000")
      .update(bucket.identifier)
      .digest("hex");
  }
}
