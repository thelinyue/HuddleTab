import { ApplicationError } from "@/server/errors/application-error";

/**
 * 用户名的 NFKC、去首尾空白和英文小写规范化只在这里定义。
 * 所有唯一性比较必须使用此函数的返回值；显示昵称或 displayUsername 不参与唯一性。
 */
export function normalizeUsername(input: unknown): string {
  if (typeof input !== "string") {
    throw new ApplicationError("INVALID_USERNAME", "用户名必须是字符串。", 422);
  }

  const value = input.normalize("NFKC").trim().toLocaleLowerCase("en-US");

  if (value.length < 3 || value.length > 32) {
    throw new ApplicationError(
      "INVALID_USERNAME",
      "用户名长度必须为 3 到 32 个字符。",
      422,
    );
  }

  if (/\s|@/.test(value)) {
    throw new ApplicationError(
      "INVALID_USERNAME",
      "用户名不能包含空白或 @。",
      422,
    );
  }

  return value;
}
