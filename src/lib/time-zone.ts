export const DEFAULT_TIME_ZONE = "Asia/Shanghai";

interface ZonedParts {
  readonly year: string;
  readonly month: string;
  readonly day: string;
  readonly hour: string;
  readonly minute: string;
  readonly second: string;
  readonly fractionalSecond: string;
}

function zonedParts(value: Date, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat("en-CA-u-ca-iso8601-nu-latn", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: 3,
    hourCycle: "h23",
  }).formatToParts(value);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour"),
    minute: read("minute"),
    second: read("second"),
    fractionalSecond: read("fractionalSecond"),
  };
}

function timeZoneOffset(value: Date, timeZone: string) {
  const name = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "longOffset",
  })
    .formatToParts(value)
    .find((part) => part.type === "timeZoneName")?.value;
  if (name === "GMT" || name === "UTC") return { text: "Z", millis: 0 };

  const match = /^GMT([+-])(\d{2}):(\d{2})$/.exec(name ?? "");
  if (!match) throw new Error(`无法解析时区 ${timeZone} 的 UTC 偏移。`);
  const sign = match[1] === "+" ? 1 : -1;
  const millis = sign * (Number(match[2]) * 60 + Number(match[3])) * 60 * 1000;
  return { text: `${match[1]}${match[2]}:${match[3]}`, millis };
}

/** 将绝对时刻格式化为配置时区的日期，供 date 输入默认值使用。 */
export function formatZonedDateInput(value: Date, timeZone: string): string {
  const parts = zonedParts(value, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** 将绝对时刻格式化为 datetime-local 所需的无偏移墙上时间。 */
export function formatZonedDateTimeInput(
  value: Date,
  timeZone: string,
): string {
  const parts = zonedParts(value, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

/** 人可读日志与导出保留本地时间和明确偏移，避免把墙上时间误当 UTC。 */
export function formatZonedTimestamp(value: Date, timeZone: string): string {
  const parts = zonedParts(value, timeZone);
  const offset = timeZoneOffset(value, timeZone).text;
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}.${parts.fractionalSecond}${offset}`;
}

function parseLocalDateTime(value: string) {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(
      value,
    );
  if (!match) throw new Error("日期时间格式不正确。");
  const fields = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: Number(match[6] ?? "0"),
    millisecond: Number((match[7] ?? "0").padEnd(3, "0")),
  };
  const probe = new Date(
    Date.UTC(
      fields.year,
      fields.month - 1,
      fields.day,
      fields.hour,
      fields.minute,
      fields.second,
      fields.millisecond,
    ),
  );
  if (
    probe.getUTCFullYear() !== fields.year ||
    probe.getUTCMonth() !== fields.month - 1 ||
    probe.getUTCDate() !== fields.day ||
    probe.getUTCHours() !== fields.hour ||
    probe.getUTCMinutes() !== fields.minute ||
    probe.getUTCSeconds() !== fields.second
  ) {
    throw new Error("日期时间格式不正确。");
  }
  return { ...fields, wallClockMillis: probe.getTime() };
}

/**
 * datetime-local 不携带偏移。这里显式用部署 TZ 求对应瞬间，并在 DST 跳跃时
 * 回读校验，拒绝该时区中不存在的墙上时间。
 */
export function zonedDateTimeToIso(value: string, timeZone: string): string {
  const fields = parseLocalDateTime(value);
  let candidateMillis = fields.wallClockMillis;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const offset = timeZoneOffset(new Date(candidateMillis), timeZone).millis;
    const next = fields.wallClockMillis - offset;
    if (next === candidateMillis) break;
    candidateMillis = next;
  }

  const candidate = new Date(candidateMillis);
  const actual = zonedParts(candidate, timeZone);
  if (
    actual.year !== String(fields.year).padStart(4, "0") ||
    actual.month !== String(fields.month).padStart(2, "0") ||
    actual.day !== String(fields.day).padStart(2, "0") ||
    actual.hour !== String(fields.hour).padStart(2, "0") ||
    actual.minute !== String(fields.minute).padStart(2, "0") ||
    actual.second !== String(fields.second).padStart(2, "0")
  ) {
    throw new Error("指定时间在配置时区中不存在。");
  }
  return candidate.toISOString();
}

/** 返回某个绝对时刻在配置时区所属自然日的 UTC 起止瞬间。 */
export function zonedDayRange(value: Date, timeZone: string) {
  const parts = zonedParts(value, timeZone);
  const start = new Date(
    zonedDateTimeToIso(
      `${parts.year}-${parts.month}-${parts.day}T00:00`,
      timeZone,
    ),
  );
  const nextDay = new Date(
    Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day) + 1,
    ),
  );
  const end = new Date(
    zonedDateTimeToIso(
      `${nextDay.getUTCFullYear()}-${String(nextDay.getUTCMonth() + 1).padStart(2, "0")}-${String(nextDay.getUTCDate()).padStart(2, "0")}T00:00`,
      timeZone,
    ),
  );
  return { start, end };
}
