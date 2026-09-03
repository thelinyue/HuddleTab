import type postgres from "postgres";
import { z } from "zod";

export const registrationPolicySchema = z.enum(["INVITE_ONLY", "OPEN"]);

/**
 * 旧栈仍保留的注册策略读取服务；邮件服务已从产品范围移除。
 */
export class SystemSettingsService {
  constructor(private readonly sql: ReturnType<typeof postgres>) {}

  async getRegistrationPolicy(): Promise<z.infer<typeof registrationPolicySchema>> {
    const [settings] = await this.sql<
      { readonly registration_policy: z.infer<typeof registrationPolicySchema> }[]
    >`select registration_policy from system_settings where id = 'singleton'`;
    return settings?.registration_policy ?? "INVITE_ONLY";
  }

  async setRegistrationPolicy(
    policy: z.infer<typeof registrationPolicySchema>,
    actorUserId: string,
  ): Promise<void> {
    const parsed = registrationPolicySchema.parse(policy);
    await this.sql`
      insert into system_settings (id, registration_policy, updated_at, updated_by_user_id)
      values ('singleton', ${parsed}, now(), ${actorUserId})
      on conflict (id) do update set
        registration_policy = excluded.registration_policy,
        updated_at = now(),
        updated_by_user_id = excluded.updated_by_user_id`;
  }
}
