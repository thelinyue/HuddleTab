import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  startPostgres,
  type PostgresHarness,
} from "@/../tests/support/postgres";
import {
  SystemSettingsService,
  smtpSchema,
} from "@/server/services/system-settings-service";

let harness: PostgresHarness;

function userId(label: string) {
  return `phase-9-settings-${label}-${randomUUID()}`;
}

function service() {
  return new SystemSettingsService(harness.sql, {
    secret: "phase-9-system-settings-test-secret",
  });
}

beforeAll(async () => {
  harness = await startPostgres();
});

afterAll(async () => {
  await harness?.stop();
});

afterEach(async () => {
  if (harness) {
    await harness.sql`delete from system_settings where id = 'singleton'`;
    await harness.sql`delete from "user" where id like 'phase-9-settings-%'`;
  }
});

describe("系统设置服务", () => {
  it("默认注册策略为仅邀请", async () => {
    await expect(service().getRegistrationPolicy()).resolves.toBe(
      "INVITE_ONLY",
    );
  });

  it("保存后读取注册策略，并记录最后更新管理员", async () => {
    const admin = userId("policy-admin");
    await harness.seedCredentialAdmin(admin);

    await service().setRegistrationPolicy("OPEN", admin);

    await expect(service().getRegistrationPolicy()).resolves.toBe("OPEN");
    await expect(
      harness.sql`select updated_by_user_id from system_settings where id = 'singleton'`,
    ).resolves.toEqual([{ updated_by_user_id: admin }]);
  });

  it("SMTP 密码仅保存密文，读取视图绝不回显密码", async () => {
    const admin = userId("smtp-admin");
    const password = "smtp-secret-for-test";
    await harness.seedCredentialAdmin(admin);

    await service().saveSmtp(
      {
        enabled: true,
        host: " smtp.example.com ",
        port: 465,
        secure: true,
        username: "mailer",
        password,
      },
      admin,
    );

    const [stored] = await harness.sql<{ smtp_password_encrypted: string }[]>`
      select smtp_password_encrypted from system_settings where id = 'singleton'`;
    expect(stored.smtp_password_encrypted).not.toContain(password);
    await expect(service().getSmtpView()).resolves.toEqual({
      enabled: true,
      configured: true,
      host: "smtp.example.com",
      port: 465,
      secure: true,
      username: "mailer",
    });
  });

  it("未配置 SMTP 不会影响已有凭证账号", async () => {
    const user = userId("existing-user");
    const admin = userId("smtp-admin");
    await harness.seedCredentialUser(user, `${user}@example.com`);
    await harness.seedCredentialAdmin(admin);

    await service().saveSmtp(
      {
        enabled: false,
        host: "",
        port: 587,
        secure: false,
        username: "",
        password: "",
      },
      admin,
    );

    await expect(service().getSmtpView()).resolves.toEqual({
      enabled: false,
      configured: false,
    });
    await expect(
      harness.sql`select id from account where user_id = ${user} and provider_id = 'credential'`,
    ).resolves.toHaveLength(1);
  });

  it("启用 SMTP 时拒绝缺少服务器、用户名或密码的配置", () => {
    expect(
      smtpSchema.safeParse({
        enabled: true,
        host: "smtp.example.com",
        port: 587,
        secure: false,
        username: "",
        password: "",
      }).success,
    ).toBe(false);
  });
});
