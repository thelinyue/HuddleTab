import { ApplicationError } from "@/server/errors/application-error";

/** NFKC + 英文小写是全局唯一判断的唯一入口，显示昵称不参与唯一性。 */
export function normalizeUsername(input: string): string {
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
