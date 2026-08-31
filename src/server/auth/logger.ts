import { DEFAULT_TIME_ZONE, formatZonedTimestamp } from "@/lib/time-zone";

type AuthLogLevel = "debug" | "info" | "warn" | "error";

/** Better Auth 自定义日志器只改变人可读时间；级别、消息和脱敏上下文保持原样。 */
export const authLogger = {
  level: "warn" as const,
  log(level: AuthLogLevel, message: string, ...args: unknown[]) {
    const timestamp = formatZonedTimestamp(
      new Date(),
      process.env.TZ ?? DEFAULT_TIME_ZONE,
    );
    const line = `${timestamp} ${level.toUpperCase()} [Better Auth]: ${message}`;
    if (level === "error") console.error(line, ...args);
    else if (level === "warn") console.warn(line, ...args);
    else console.log(line, ...args);
  },
};
