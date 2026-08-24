import { z } from "zod";

/**
 * 公共注册接口只接收这些字段。用户名的规范化与合法性判断保留给
 * normalizeUsername 的唯一入口，避免在 Zod 与认证插件之间出现第二套规则。
 */
export const registerInput = z.object({
  username: z.string(),
  password: z.string().min(8).max(128),
  nickname: z.string().trim().min(1).max(40),
  email: z.string().trim().toLowerCase().email().optional(),
  inviteProof: z.string().min(1).optional(),
});

/** Setup 复用注册的凭据字段校验，只额外接受从容器日志获得的一次性 token。 */
export const setupInput = registerInput
  .pick({ username: true, password: true, nickname: true })
  .extend({ setupToken: z.string().min(20).max(128) });
