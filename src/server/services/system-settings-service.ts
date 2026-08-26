import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";

import nodemailer, { type Transporter } from "nodemailer";
import type postgres from "postgres";
import { z } from "zod";

import { authRuntimeConfig } from "@/server/auth/runtime-config";
import { ApplicationError } from "@/server/errors/application-error";

export const registrationPolicySchema = z.enum(["INVITE_ONLY", "OPEN"]);

export const smtpSchema = z
  .object({
    enabled: z.boolean(),
    host: z.string().trim().max(255, "SMTP 服务器地址不能超过 255 个字符。"),
    port: z
      .number()
      .int("SMTP 端口必须是整数。")
      .min(1, "SMTP 端口必须在 1 到 65535 之间。")
      .max(65535, "SMTP 端口必须在 1 到 65535 之间。"),
    secure: z.boolean(),
    username: z.string().max(255, "SMTP 用户名不能超过 255 个字符。"),
    password: z.string().max(1024, "SMTP 密码不能超过 1024 个字符。"),
  })
  .superRefine((value, context) => {
    if (value.enabled && (!value.host || !value.username || !value.password)) {
      context.addIssue({
        code: "custom",
        message: "启用 SMTP 时必须填写服务器、用户名和密码。",
      });
    }
  });

export type SmtpInput = z.infer<typeof smtpSchema>;

type SmtpView =
  | { readonly enabled: false; readonly configured: false }
  | {
      readonly enabled: true;
      readonly configured: boolean;
      readonly host?: string;
      readonly port?: number;
      readonly secure?: boolean;
      readonly username?: string;
    };

interface SmtpSettingsRow {
  readonly smtp_enabled: boolean;
  readonly smtp_host: string | null;
  readonly smtp_port: number | null;
  readonly smtp_secure: boolean;
  readonly smtp_username: string | null;
  readonly smtp_password_encrypted: string | null;
}

type MailTransport = Pick<Transporter, "sendMail">;

interface SystemSettingsOptions {
  readonly secret?: string;
  readonly createTransport?: (options: {
    host: string;
    port: number;
    secure: boolean;
    auth: { user: string; pass: string };
  }) => MailTransport;
}

/**
 * SMTP 密码属于部署级秘密。此封装从 Better Auth 的根密钥派生专用 AES 密钥，
 * 使数据库泄露时密码不以可读字段存在；密文格式带版本，便于将来有序轮换算法。
 */
export class SettingsSecretBox {
  private readonly key: Buffer;

  constructor(secret: string) {
    this.key = Buffer.from(
      hkdfSync(
        "sha256",
        Buffer.from(secret),
        Buffer.from("huddletab-system-settings"),
        Buffer.from("smtp-password-v1"),
        32,
      ),
    );
  }

  encrypt(value: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(value, "utf8"),
      cipher.final(),
    ]);
    return `v1:${iv.toString("base64url")}:${cipher.getAuthTag().toString("base64url")}:${ciphertext.toString("base64url")}`;
  }

  decrypt(envelope: string): string {
    const [version, encodedIv, encodedTag, encodedCiphertext] =
      envelope.split(":");
    if (version !== "v1" || !encodedIv || !encodedTag || !encodedCiphertext) {
      throw new Error("SMTP 密文格式无效。");
    }
    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.key,
      Buffer.from(encodedIv, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(encodedTag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(encodedCiphertext, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  }
}

/**
 * 系统设置仅使用 system_settings 的单例行。服务层重复校验输入，避免未来调用方绕过
 * Route Handler 写入不完整 SMTP 配置；所有公开读取模型都刻意排除密码密文。
 */
export class SystemSettingsService {
  private readonly secrets: SettingsSecretBox;
  private readonly createTransport: NonNullable<
    SystemSettingsOptions["createTransport"]
  >;

  constructor(
    private readonly sql: ReturnType<typeof postgres>,
    options: SystemSettingsOptions = {},
  ) {
    this.secrets = new SettingsSecretBox(
      options.secret ?? authRuntimeConfig.secret,
    );
    this.createTransport =
      options.createTransport ?? nodemailer.createTransport;
  }

  async getRegistrationPolicy(): Promise<
    z.infer<typeof registrationPolicySchema>
  > {
    const [settings] = await this.sql<
      {
        readonly registration_policy: z.infer<typeof registrationPolicySchema>;
      }[]
    >`select registration_policy from system_settings where id = 'singleton'`;
    return settings?.registration_policy ?? "INVITE_ONLY";
  }

  async setRegistrationPolicy(
    policy: z.infer<typeof registrationPolicySchema>,
    actorUserId: string,
  ): Promise<void> {
    const parsed = registrationPolicySchema.parse(policy);
    await this
      .sql`insert into system_settings (id, registration_policy, updated_at, updated_by_user_id)
      values ('singleton', ${parsed}, now(), ${actorUserId})
      on conflict (id) do update set
        registration_policy = excluded.registration_policy,
        updated_at = now(),
        updated_by_user_id = excluded.updated_by_user_id`;
  }

  async saveSmtp(input: SmtpInput, actorUserId: string): Promise<void> {
    const parsed = smtpSchema.parse(input);
    const encryptedPassword = parsed.enabled
      ? this.secrets.encrypt(parsed.password)
      : null;
    await this.sql`insert into system_settings (
        id, smtp_enabled, smtp_host, smtp_port, smtp_secure, smtp_username,
        smtp_password_encrypted, updated_at, updated_by_user_id
      ) values (
        'singleton', ${parsed.enabled}, ${parsed.enabled ? parsed.host : null},
        ${parsed.enabled ? parsed.port : null}, ${parsed.enabled && parsed.secure},
        ${parsed.enabled ? parsed.username : null}, ${encryptedPassword}, now(), ${actorUserId}
      ) on conflict (id) do update set
        smtp_enabled = excluded.smtp_enabled,
        smtp_host = excluded.smtp_host,
        smtp_port = excluded.smtp_port,
        smtp_secure = excluded.smtp_secure,
        smtp_username = excluded.smtp_username,
        smtp_password_encrypted = excluded.smtp_password_encrypted,
        updated_at = now(),
        updated_by_user_id = excluded.updated_by_user_id`;
  }

  async getSmtpView(): Promise<SmtpView> {
    const settings = await this.getSmtpSettings();
    if (!settings?.smtp_enabled) return { enabled: false, configured: false };

    const configured = Boolean(
      settings.smtp_host &&
      settings.smtp_port &&
      settings.smtp_username &&
      settings.smtp_password_encrypted,
    );
    return {
      enabled: true,
      configured,
      ...(settings.smtp_host ? { host: settings.smtp_host } : {}),
      ...(settings.smtp_port ? { port: settings.smtp_port } : {}),
      secure: settings.smtp_secure,
      ...(settings.smtp_username ? { username: settings.smtp_username } : {}),
    };
  }

  /** 测试邮件只在内存中解密一次，结果与收件人均不会进入 API 响应或日志。 */
  async sendTestMail(recipient: string): Promise<void> {
    const target = z
      .string()
      .email("请填写有效的测试收件人地址。")
      .refine(
        (email) => !email.toLowerCase().endsWith("@local.invalid"),
        "测试邮件必须发送到真实收件人地址。",
      )
      .parse(recipient);
    const settings = await this.getSmtpSettings();
    if (
      !settings?.smtp_enabled ||
      !settings.smtp_host ||
      !settings.smtp_port ||
      !settings.smtp_username ||
      !settings.smtp_password_encrypted
    ) {
      throw new ApplicationError(
        "SMTP_TEST_FAILED",
        "SMTP 尚未完成配置，无法发送测试邮件。",
        422,
      );
    }

    try {
      const transport = this.createTransport({
        host: settings.smtp_host,
        port: settings.smtp_port,
        secure: settings.smtp_secure,
        auth: {
          user: settings.smtp_username,
          pass: this.secrets.decrypt(settings.smtp_password_encrypted),
        },
      });
      await transport.sendMail({
        from: settings.smtp_username,
        to: target,
        subject: "HuddleTab SMTP 测试邮件",
        text: "这是一封 HuddleTab SMTP 配置测试邮件。",
      });
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      // 密码、密文、收件人与底层 SMTP 错误都可能含敏感内容，因此日志只保留固定中文结论。
      console.warn("SMTP 测试邮件发送失败，详情已脱敏。");
      throw new ApplicationError(
        "SMTP_TEST_FAILED",
        "测试邮件发送失败，请检查 SMTP 配置。",
        422,
      );
    }
  }

  private async getSmtpSettings(): Promise<SmtpSettingsRow | undefined> {
    const [settings] = await this.sql<SmtpSettingsRow[]>`
      select smtp_enabled, smtp_host, smtp_port, smtp_secure, smtp_username, smtp_password_encrypted
      from system_settings where id = 'singleton'`;
    return settings;
  }
}
