/** PostgreSQL `date` 是无时区的公历日期，不能经由 Date 或运行时 TZ 换算。 */
function calendarDayNumber(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthLengths = [
    31,
    leapYear ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  if (month < 1 || month > 12 || day < 1 || day > monthLengths[month - 1]!)
    return null;

  const daysBeforeMonth = [
    0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334,
  ];
  const previousYear = year - 1;
  const daysBeforeYear =
    previousYear * 365 +
    Math.floor(previousYear / 4) -
    Math.floor(previousYear / 100) +
    Math.floor(previousYear / 400);
  const leapDay = leapYear && month > 2 ? 1 : 0;
  return daysBeforeYear + daysBeforeMonth[month - 1]! + leapDay + day;
}

/** 返回包含首尾日期的活动天数；缺失、无效或倒序日期不产生误导性结果。 */
export function inclusiveCalendarDays(
  startDate: string | null | undefined,
  endDate: string | null | undefined,
): number | null {
  if (!startDate || !endDate) return null;
  const start = calendarDayNumber(startDate);
  const end = calendarDayNumber(endDate);
  if (start === null || end === null || end < start) return null;
  return end - start + 1;
}
