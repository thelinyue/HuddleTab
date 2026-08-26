import { expect, it, vi } from "vitest";

import { ApplicationError } from "@/server/errors/application-error";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  getRegistrationPolicy: vi.fn(),
  setRegistrationPolicy: vi.fn(),
  getSmtpView: vi.fn(),
  saveSmtp: vi.fn(),
  sendTestMail: vi.fn(),
}));

vi.mock("@/server/auth/session", () => ({
  requireSession: vi.fn().mockResolvedValue({ user: { id: "admin-1" } }),
}));
vi.mock("@/server/db/client", () => ({ sql: {} }));
vi.mock("@/server/permissions/require-system-admin", () => ({
  requireSystemAdmin: mocks.requireAdmin,
}));
vi.mock("@/server/services/system-settings-service", () => ({
  SystemSettingsService: class {
    getRegistrationPolicy = mocks.getRegistrationPolicy;
    setRegistrationPolicy = mocks.setRegistrationPolicy;
    getSmtpView = mocks.getSmtpView;
    saveSmtp = mocks.saveSmtp;
    sendTestMail = mocks.sendTestMail;
  },
}));

import {
  GET as getRegistrationPolicy,
  PUT as setRegistrationPolicy,
} from "@/app/api/admin/registration-policy/route";
import { GET as getSmtp, PUT as saveSmtp } from "@/app/api/admin/smtp/route";
import { POST as sendTestMail } from "@/app/api/admin/smtp/test/route";

it("注册策略路由要求平台管理员并读写策略", async () => {
  mocks.requireAdmin.mockResolvedValue("admin-1");
  mocks.getRegistrationPolicy.mockResolvedValue("INVITE_ONLY");

  const fetched = await getRegistrationPolicy(
    new Request("http://localhost/api/admin/registration-policy"),
  );
  const saved = await setRegistrationPolicy(
    new Request("http://localhost/api/admin/registration-policy", {
      method: "PUT",
      body: JSON.stringify({ policy: "OPEN" }),
    }),
  );

  expect(fetched.status).toBe(200);
  expect(saved.status).toBe(200);
  expect(mocks.requireAdmin).toHaveBeenCalledTimes(2);
  expect(mocks.setRegistrationPolicy).toHaveBeenCalledWith("OPEN", "admin-1");
});

it("SMTP 路由只返回安全视图，保存时由平台管理员授权", async () => {
  mocks.requireAdmin.mockResolvedValue("admin-1");
  mocks.getSmtpView.mockResolvedValue({
    enabled: true,
    configured: true,
    host: "smtp.example.com",
    port: 587,
    secure: false,
    username: "mailer",
  });
  const smtp = {
    enabled: true,
    host: "smtp.example.com",
    port: 587,
    secure: false,
    username: "mailer",
    password: "not-returned",
  };

  const fetched = await getSmtp(new Request("http://localhost/api/admin/smtp"));
  const saved = await saveSmtp(
    new Request("http://localhost/api/admin/smtp", {
      method: "PUT",
      body: JSON.stringify(smtp),
    }),
  );

  expect(fetched.status).toBe(200);
  expect(await fetched.json()).not.toMatchObject({
    data: expect.objectContaining({ password: expect.anything() }),
  });
  expect(saved.status).toBe(200);
  expect(mocks.saveSmtp).toHaveBeenCalledWith(smtp, "admin-1");
});

it("测试邮件要求显式真实收件人，并保留发送失败的中文错误契约", async () => {
  mocks.requireAdmin.mockResolvedValue("admin-1");
  const missingRecipient = await sendTestMail(
    new Request("http://localhost/api/admin/smtp/test", {
      method: "POST",
      body: JSON.stringify({}),
    }),
  );
  mocks.sendTestMail.mockRejectedValueOnce(
    new ApplicationError(
      "SMTP_TEST_FAILED",
      "测试邮件发送失败，请检查 SMTP 配置。",
      422,
    ),
  );
  const failed = await sendTestMail(
    new Request("http://localhost/api/admin/smtp/test", {
      method: "POST",
      body: JSON.stringify({ recipient: "owner@example.com" }),
    }),
  );

  expect(missingRecipient.status).toBe(422);
  expect(failed.status).toBe(422);
  await expect(failed.json()).resolves.toMatchObject({
    error: {
      code: "SMTP_TEST_FAILED",
      message: expect.stringContaining("失败"),
    },
  });
});

it("禁用管理员调用 SMTP 路由时返回 403", async () => {
  mocks.requireAdmin.mockRejectedValueOnce(
    new ApplicationError(
      "ACCOUNT_DISABLED",
      "账号已被禁用，无法执行系统管理操作。",
      403,
    ),
  );

  const response = await getSmtp(
    new Request("http://localhost/api/admin/smtp"),
  );

  expect(response.status).toBe(403);
  await expect(response.json()).resolves.toMatchObject({
    error: {
      code: "ACCOUNT_DISABLED",
      message: expect.stringContaining("禁用"),
    },
  });
});
