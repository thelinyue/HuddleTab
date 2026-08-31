import { expect, test } from "vitest";

import {
  formatZonedDateInput,
  formatZonedDateTimeInput,
  formatZonedTimestamp,
  zonedDateTimeToIso,
} from "@/lib/time-zone";

const instant = new Date("2026-08-31T01:53:01.438Z");

test("按配置时区格式化日期、表单时间和带偏移时间戳", () => {
  expect(formatZonedDateInput(instant, "Asia/Shanghai")).toBe("2026-08-31");
  expect(formatZonedDateTimeInput(instant, "Pacific/Honolulu")).toBe(
    "2026-08-30T15:53",
  );
  expect(formatZonedTimestamp(instant, "Asia/Shanghai")).toBe(
    "2026-08-31T09:53:01.438+08:00",
  );
});

test("把配置时区中的表单墙上时间转换为 UTC 瞬间", () => {
  expect(zonedDateTimeToIso("2026-08-30T15:53", "Pacific/Honolulu")).toBe(
    "2026-08-31T01:53:00.000Z",
  );
});

test("拒绝夏令时跳跃期间不存在的墙上时间", () => {
  expect(() =>
    zonedDateTimeToIso("2026-03-08T02:30", "America/New_York"),
  ).toThrow("指定时间在配置时区中不存在");
});
