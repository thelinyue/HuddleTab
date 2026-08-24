import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Sql } from "postgres";

import { ApplicationError } from "@/server/errors/application-error";

export type SetupCredentialInput = {
  username: string;
  password: string;
  nickname: string;
};

export type SetupCredentialCreation = {
  userId: string;
  headers: Headers;
};

/**
 * Setup 创建的凭据不属于当前 PostgreSQL 事务：Better Auth 会通过自己的数据库调用写入
 * user/account/session。因此调用方必须在后续系统角色事务失败时调用 compensate，防止留下
 * 无角色的可登录账户；补偿只允许精确删除本次刚创建的 user。
 */
export interface SetupCredentialCreator {
  create(input: SetupCredentialInput): Promise<SetupCredentialCreation>;
  compensate(userId: string): Promise<void>;
}

export type SetupClaimResult = SetupCredentialCreation;

type SetupClaimOutcome = "COMMITTED" | "NOT_COMMITTED" | "UNKNOWN";

const SETUP_ADVISORY_LOCK = "huddletab-setup";

function hashToken(token: string): Buffer {
  return createHash("sha256").update(token, "utf8").digest();
}

function hasMatchingToken(
  storedHash: string | null,
  suppliedToken: string,
): boolean {
  if (!storedHash) return false;

  const stored = Buffer.from(storedHash, "base64url");
  const supplied = hashToken(suppliedToken);
  return stored.length === supplied.length && timingSafeEqual(stored, supplied);
}

/**
 * 首次初始化是一次性安全边界。所有 token 读写和首个管理员角色写入均在同一 PostgreSQL
 * advisory lock 保护下，保证多容器并发启动或并发 claim 时，最终仅有一个仍可用 token 和
 * 一个首个管理员。数据库只存 SHA-256 的 base64url 摘要，明文只返回给容器启动器。
 */
export class SetupService {
  constructor(
    private readonly sql: Sql,
    private readonly credentials: SetupCredentialCreator,
  ) {}

  /** 已完成或已有管理员时永久关闭 setup；其余情况表示仍需使用当前启动 token。 */
  async isSetupRequired(): Promise<boolean> {
    const [state] = await this.sql<
      { completed_at: Date | null; has_admin: boolean }[]
    >`
      select b.completed_at,
        exists(select 1 from system_roles where role = 'system_admin') as has_admin
      from system_bootstrap b
      where b.id = 'singleton'
    `;

    return !state?.completed_at && !state?.has_admin;
  }

  /**
   * 未初始化的每次容器启动都会产生新 token 并替换旧 hash。completed_at 是永久关闭标志，
   * 不因历史角色缺失而重新开放；发现既有管理员时则补写 completed_at 并清除残留 hash。
   */
  async rotateForUninitializedStartup(): Promise<string | null> {
    return this.sql.begin(async (transaction) => {
      await transaction`select pg_advisory_xact_lock(hashtext(${SETUP_ADVISORY_LOCK}))`;
      const [state] = await transaction<
        { completed_at: string | null; has_admin: boolean }[]
      >`
        select b.completed_at,
          exists(select 1 from system_roles where role = 'system_admin') as has_admin
        from system_bootstrap b
        where b.id = 'singleton'
      `;

      if (state?.completed_at || state?.has_admin) {
        await transaction`
          update system_bootstrap
          set setup_token_hash = null,
              completed_at = coalesce(completed_at, now())
          where id = 'singleton'
        `;
        return null;
      }

      const token = randomBytes(32).toString("base64url");
      const tokenHash = hashToken(token).toString("base64url");
      await transaction`
        update system_bootstrap
        set setup_token_hash = ${tokenHash}, generated_at = now(), completed_at = null
        where id = 'singleton'
      `;
      return token;
    });
  }

  /**
   * begin() 发生网络错误时，服务端可能已经提交但客户端尚未收到 COMMIT 响应。此处必须脱离
   * 原 transaction 重新读取提交结果：只有确认角色和 completed_at 都不存在时才可补偿；
   * 任何不确定状态都保留账户，避免删除已经提交的唯一管理员。
   */
  private async readClaimOutcome(userId: string): Promise<SetupClaimOutcome> {
    try {
      const [state] = await this.sql<
        { has_admin: boolean; completed_at: string | null }[]
      >`
        select exists(
          select 1 from system_roles
          where user_id = ${userId} and role = 'system_admin'
        ) as has_admin,
        (select completed_at from system_bootstrap where id = 'singleton') as completed_at
      `;

      if (state?.has_admin && state.completed_at) return "COMMITTED";
      if (!state?.has_admin && !state?.completed_at) return "NOT_COMMITTED";
      return "UNKNOWN";
    } catch {
      return "UNKNOWN";
    }
  }

  /**
   * 先锁定并校验 token，再创建 Better Auth 凭据，最后在锁内提交管理员角色和完成标志。
   * 凭据写入无法纳入该事务；若事务拒绝，先重新核查提交结果，再决定保留、补偿或返回恢复错误。
   */
  async claim(
    token: string,
    input: SetupCredentialInput,
  ): Promise<SetupClaimResult> {
    let created: SetupCredentialCreation | undefined;

    try {
      await this.sql.begin(async (transaction) => {
        await transaction`select pg_advisory_xact_lock(hashtext(${SETUP_ADVISORY_LOCK}))`;
        const [state] = await transaction<
          { setup_token_hash: string | null; completed_at: Date | null }[]
        >`
          select setup_token_hash, completed_at
          from system_bootstrap
          where id = 'singleton'
          for update
        `;

        if (
          state?.completed_at ||
          !hasMatchingToken(state?.setup_token_hash ?? null, token)
        ) {
          throw new ApplicationError(
            "INVALID_SETUP_TOKEN",
            "初始化口令无效或已失效。",
            403,
          );
        }

        created = await this.credentials.create(input);
        await transaction`
          insert into system_roles (user_id, role, granted_at)
          values (${created.userId}, 'system_admin', now())
        `;
        await transaction`
          update system_bootstrap
          set setup_token_hash = null, completed_at = now()
          where id = 'singleton'
        `;
      });
    } catch (error) {
      if (!created) throw error;

      const outcome = await this.readClaimOutcome(created.userId);
      if (outcome === "COMMITTED") return created;

      if (outcome === "UNKNOWN") {
        console.error(
          "首次初始化事务结果无法确认（SETUP_CLAIM_OUTCOME_UNKNOWN），请部署管理员检查数据库。用户标识：%s",
          created.userId,
        );
        throw new ApplicationError(
          "SETUP_CLAIM_OUTCOME_UNKNOWN",
          "初始化结果暂时无法确认，请部署管理员检查数据库后重试。",
          500,
        );
      }

      try {
        await this.credentials.compensate(created.userId);
      } catch {
        console.error(
          "首次初始化凭据补偿失败（SETUP_CREDENTIAL_COMPENSATION_FAILED），请部署管理员检查数据库。用户标识：%s",
          created.userId,
        );
        throw new ApplicationError(
          "SETUP_CREDENTIAL_COMPENSATION_FAILED",
          "初始化恢复失败，请部署管理员检查数据库后重试。",
          500,
        );
      }
      throw error;
    }

    return created!;
  }
}
