import type postgres from "postgres";

import { ApplicationError } from "@/server/errors/application-error";

/**
 * 维护状态独立于会被完整恢复的 system_settings，避免归档把 false 覆盖回运行中的恢复。
 * 此单例在共享 PostgreSQL 中保存，跨请求、重启和多实例一致；所有业务写 Route 必须在
 * 执行实际写入前调用 assertWritesAllowed。
 */
export class MaintenanceMode {
  constructor(private readonly sql: ReturnType<typeof postgres>) {}

  async enter(reason: "RESTORE", actorUserId: string): Promise<void> {
    await this.sql.begin(async (transaction) => {
      await transaction`insert into maintenance_state (id, active, updated_at)
        values ('singleton', false, now())
        on conflict (id) do nothing`;
      const [claimed] = await transaction<{ readonly id: string }[]>`
        update maintenance_state
        set active = true, updated_at = now()
        where id = 'singleton' and active = false
        returning id`;
      if (!claimed)
        throw new ApplicationError(
          "MAINTENANCE_MODE",
          "系统已处于维护恢复状态，暂时不能开始新的恢复操作。",
          503,
        );
      // actor 与 reason 暂不持久化，避免运行态闸门与业务用户表建立恢复期间的外键依赖。
      void reason;
      void actorUserId;
    });
  }

  async leave(): Promise<void> {
    await this.sql`update maintenance_state
      set active = false, updated_at = now()
      where id = 'singleton'`;
  }

  async isActive(): Promise<boolean> {
    const [state] = await this.sql<{ readonly active: boolean }[]>`
      select active from maintenance_state where id = 'singleton'`;
    return Boolean(state?.active);
  }

  async assertWritesAllowed(): Promise<void> {
    if (!(await this.isActive())) return;
    throw new ApplicationError(
      "MAINTENANCE_MODE",
      "系统正在维护恢复中，暂时不能写入数据，请稍后重试。",
      503,
    );
  }
}
