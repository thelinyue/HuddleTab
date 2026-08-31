import { afterEach, expect, test, vi } from "vitest";

import { authLogger } from "@/server/auth/logger";

const originalTimeZone = process.env.TZ;

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  if (originalTimeZone === undefined) delete process.env.TZ;
  else process.env.TZ = originalTimeZone;
});

test("Better Auth 日志按运行时 TZ 输出偏移并保留附加上下文", () => {
  process.env.TZ = "Asia/Shanghai";
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-31T01:53:01.438Z"));
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const context = { requestId: "request-1" };

  authLogger.log?.("warn", "Invalid password", context);

  expect(warn).toHaveBeenCalledWith(
    "2026-08-31T09:53:01.438+08:00 WARN [Better Auth]: Invalid password",
    context,
  );
});
