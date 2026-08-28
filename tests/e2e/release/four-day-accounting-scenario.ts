export type ScenarioMember = "owner" | "a" | "b" | "c";
export type ScenarioCategory =
  "FOOD" | "TRANSPORT" | "LODGING" | "TICKET" | "SHOPPING" | "ENTERTAINMENT";

type ScenarioSplit =
  | { readonly mode: "EQUAL"; readonly members: readonly ScenarioMember[] }
  | {
      readonly mode: "EXACT" | "PERCENTAGE" | "WEIGHT";
      readonly entries: readonly {
        readonly member: ScenarioMember;
        readonly value: string;
      }[];
    };

export interface TripExpenseScenario {
  readonly key: string;
  readonly dayIndex: 0 | 1 | 2 | 3;
  readonly occurredTime: string;
  readonly title: string;
  readonly category: ScenarioCategory;
  readonly creator: ScenarioMember;
  readonly originalCurrency: "CNY" | "JPY";
  readonly amount: string;
  readonly initialAmount?: string;
  readonly exchangeRate: string;
  readonly baseAmountMinor: string;
  readonly payments: readonly {
    readonly member: ScenarioMember;
    readonly amount: string;
  }[];
  readonly participants: readonly ScenarioMember[];
  readonly split: ScenarioSplit;
  readonly offline?: boolean;
}

const allMembers = ["owner", "a", "b", "c"] as const;

/**
 * 发布门禁使用显式、可人工复算的账本。原币输入保留十进制文本，主币断言使用
 * 最小单位字符串，避免测试代码以浮点数重新实现生产换汇或分摊算法。
 */
export const tripExpenses: readonly TripExpenseScenario[] = [
  {
    key: "hotel",
    dayIndex: 0,
    occurredTime: "15:00",
    title: "酒店住宿",
    category: "LODGING",
    creator: "owner",
    originalCurrency: "CNY",
    amount: "1200",
    initialAmount: "1180",
    exchangeRate: "1",
    baseAmountMinor: "120000",
    payments: [{ member: "owner", amount: "1200" }],
    participants: allMembers,
    split: { mode: "EQUAL", members: allMembers },
  },
  {
    key: "airport-transfer",
    dayIndex: 0,
    occurredTime: "17:00",
    title: "机场接驳",
    category: "TRANSPORT",
    creator: "owner",
    originalCurrency: "CNY",
    amount: "360",
    exchangeRate: "1",
    baseAmountMinor: "36000",
    payments: [
      { member: "owner", amount: "200" },
      { member: "a", amount: "160" },
    ],
    participants: allMembers,
    split: {
      mode: "EXACT",
      entries: [
        { member: "owner", value: "80" },
        { member: "a", value: "80" },
        { member: "b", value: "100" },
        { member: "c", value: "100" },
      ],
    },
  },
  {
    key: "supplies",
    dayIndex: 0,
    occurredTime: "20:00",
    title: "便利店补给",
    category: "SHOPPING",
    creator: "b",
    originalCurrency: "CNY",
    amount: "96",
    exchangeRate: "1",
    baseAmountMinor: "9600",
    payments: [{ member: "b", amount: "96" }],
    participants: ["a", "b", "c"],
    split: { mode: "EQUAL", members: ["a", "b", "c"] },
  },
  {
    key: "breakfast",
    dayIndex: 1,
    occurredTime: "08:00",
    title: "早餐",
    category: "FOOD",
    creator: "a",
    originalCurrency: "CNY",
    amount: "168",
    exchangeRate: "1",
    baseAmountMinor: "16800",
    payments: [{ member: "a", amount: "168" }],
    participants: allMembers,
    split: { mode: "EQUAL", members: allMembers },
  },
  {
    key: "attraction-pass",
    dayIndex: 1,
    occurredTime: "10:00",
    title: "景点联票",
    category: "TICKET",
    creator: "c",
    originalCurrency: "CNY",
    amount: "600",
    exchangeRate: "1",
    baseAmountMinor: "60000",
    payments: [{ member: "c", amount: "600" }],
    participants: allMembers,
    split: {
      mode: "PERCENTAGE",
      entries: [
        { member: "owner", value: "40" },
        { member: "a", value: "30" },
        { member: "b", value: "20" },
        { member: "c", value: "10" },
      ],
    },
  },
  {
    key: "dinner",
    dayIndex: 1,
    occurredTime: "19:00",
    title: "旅行晚餐",
    category: "FOOD",
    creator: "a",
    originalCurrency: "CNY",
    amount: "480",
    exchangeRate: "1",
    baseAmountMinor: "48000",
    payments: [
      { member: "a", amount: "200" },
      { member: "b", amount: "280" },
    ],
    participants: allMembers,
    split: {
      mode: "WEIGHT",
      entries: [
        { member: "owner", value: "1" },
        { member: "a", value: "1" },
        { member: "b", value: "2" },
        { member: "c", value: "2" },
      ],
    },
  },
  {
    key: "museum",
    dayIndex: 2,
    occurredTime: "10:00",
    title: "博物馆门票",
    category: "TICKET",
    creator: "owner",
    originalCurrency: "JPY",
    amount: "10000",
    exchangeRate: "0.05",
    baseAmountMinor: "50000",
    payments: [{ member: "owner", amount: "10000" }],
    participants: allMembers,
    split: { mode: "EQUAL", members: allMembers },
  },
  {
    key: "souvenirs",
    dayIndex: 2,
    occurredTime: "15:00",
    title: "伴手礼",
    category: "SHOPPING",
    creator: "b",
    originalCurrency: "CNY",
    amount: "350",
    exchangeRate: "1",
    baseAmountMinor: "35000",
    payments: [{ member: "b", amount: "350" }],
    participants: ["b", "c"],
    split: {
      mode: "EXACT",
      entries: [
        { member: "b", value: "150" },
        { member: "c", value: "200" },
      ],
    },
  },
  {
    key: "night-cruise",
    dayIndex: 2,
    occurredTime: "19:30",
    title: "夜游船票",
    category: "ENTERTAINMENT",
    creator: "c",
    originalCurrency: "CNY",
    amount: "420",
    exchangeRate: "1",
    baseAmountMinor: "42000",
    payments: [{ member: "c", amount: "420" }],
    participants: ["a", "b", "c"],
    split: {
      mode: "WEIGHT",
      entries: [
        { member: "a", value: "1" },
        { member: "b", value: "2" },
        { member: "c", value: "3" },
      ],
    },
  },
  {
    key: "brunch",
    dayIndex: 3,
    occurredTime: "10:30",
    title: "返程早午餐",
    category: "FOOD",
    creator: "a",
    originalCurrency: "CNY",
    amount: "320",
    exchangeRate: "1",
    baseAmountMinor: "32000",
    payments: [{ member: "a", amount: "320" }],
    participants: allMembers,
    split: { mode: "EQUAL", members: allMembers },
  },
  {
    key: "fuel-parking",
    dayIndex: 3,
    occurredTime: "14:00",
    title: "加油停车",
    category: "TRANSPORT",
    creator: "b",
    originalCurrency: "CNY",
    amount: "180",
    exchangeRate: "1",
    baseAmountMinor: "18000",
    payments: [
      { member: "b", amount: "100" },
      { member: "c", amount: "80" },
    ],
    participants: ["b", "c"],
    split: {
      mode: "EXACT",
      entries: [
        { member: "b", value: "60" },
        { member: "c", value: "120" },
      ],
    },
  },
  {
    key: "return-taxi",
    dayIndex: 3,
    occurredTime: "16:00",
    title: "返程打车",
    category: "TRANSPORT",
    creator: "b",
    originalCurrency: "CNY",
    amount: "120",
    exchangeRate: "1",
    baseAmountMinor: "12000",
    payments: [{ member: "b", amount: "120" }],
    participants: ["b", "c"],
    split: { mode: "EQUAL", members: ["b", "c"] },
    offline: true,
  },
] as const;

export const dailyExpectedBalancesMinor = [
  { owner: 102_000n, a: -25_200n, b: -33_600n, c: -43_200n },
  { owner: -36_200n, a: 6_600n, b: -4_200n, c: 33_800n },
  { owner: 37_500n, a: -19_500n, b: -6_500n, c: -11_500n },
  { owner: -8_000n, a: 24_000n, b: 2_000n, c: -18_000n },
] as const;

export const tripSettlementCounts = [3, 6, 9, 12] as const;

export const tripSettlements: readonly {
  readonly dayIndex: 0 | 1 | 2 | 3;
  readonly payer: ScenarioMember;
  readonly receiver: ScenarioMember;
  readonly amount: string;
}[] = [
  { dayIndex: 0, payer: "a", receiver: "owner", amount: "252" },
  { dayIndex: 0, payer: "b", receiver: "owner", amount: "336" },
  { dayIndex: 0, payer: "c", receiver: "owner", amount: "432" },
  { dayIndex: 1, payer: "owner", receiver: "c", amount: "338" },
  { dayIndex: 1, payer: "b", receiver: "a", amount: "42" },
  { dayIndex: 1, payer: "owner", receiver: "a", amount: "24" },
  { dayIndex: 2, payer: "a", receiver: "owner", amount: "195" },
  { dayIndex: 2, payer: "c", receiver: "owner", amount: "115" },
  { dayIndex: 2, payer: "b", receiver: "owner", amount: "65" },
  { dayIndex: 3, payer: "c", receiver: "a", amount: "180" },
  { dayIndex: 3, payer: "owner", receiver: "a", amount: "60" },
  { dayIndex: 3, payer: "owner", receiver: "b", amount: "20" },
] as const;

export function categoryTotalsMinor(): Record<ScenarioCategory, bigint> {
  const totals = {} as Record<ScenarioCategory, bigint>;
  for (const expense of tripExpenses) {
    totals[expense.category] =
      (totals[expense.category] ?? 0n) + BigInt(expense.baseAmountMinor);
  }
  return totals;
}

/** 用目标时区取得今天，再按纯日历数回退，避免 UTC 午夜把旅行日期分到错误组。 */
export function buildTripDates(now: Date, timeZone: string): readonly string[] {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  const today = Date.UTC(value("year"), value("month") - 1, value("day"));
  return [-3, -2, -1, 0].map((offset) => {
    const date = new Date(today + offset * 86_400_000);
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
  });
}
