# HuddleTab Phase 1 Money Domain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and verify the framework-free accounting core for currency precision, safe integer money, exact decimal rates, deterministic splitting, dynamic ledger balances, and settlement recommendations.

**Architecture:** Keep every accounting rule under `src/domain/` with no React, Next.js, Drizzle, database, network, or UI dependencies. Represent formal amounts as `bigint`, isolate exchange-rate conversion from row allocation, and derive ledger/recommendation output from immutable facts rather than persisted balances.

**Tech Stack:** TypeScript, Vitest, fast-check, native `bigint`.

---

## File responsibility map

```text
src/domain/currency/currency.ts                 ISO 4217 minor-unit lookup and code normalization
src/domain/money/money.ts                       Safe same-currency arithmetic and API string conversion
src/domain/exchange-rate/decimal-rate.ts         Exact decimal parsing and one-total conversion
src/domain/splitting/allocation.ts               Stable integer remainder allocation by ActivityMember ID
src/domain/splitting/split.ts                    EQUAL / EXACT / PERCENTAGE / WEIGHT validation
src/domain/ledger/ledger.ts                      Dynamic balances derived from accounting facts
src/domain/settlement/recommendation.ts          Deterministic Largest Debtor ↔ Largest Creditor suggestions
tests/unit/domain/**                             Examples, boundaries, conservation, and determinism
```

## Locked interfaces and boundaries

- `Money = { currency: CurrencyCode; amountMinor: bigint }`; API/database adapters use decimal strings.
- `DecimalRate = { coefficient: bigint; scale: number }`; no formal calculation converts through `number`.
- `convertMinorAmount()` converts exactly one Expense total. Payment/share row allocation happens afterward through `allocateByWeights()`.
- `splitExpense()`, `calculateLedger()`, and `recommendSettlements()` are independent modules.
- Recommendations are transient values and never become Settlement facts without an explicit later write.
- The confirmed design does not name the half-tie rule for exchange conversion. This plan uses round-half-up at the Expense-total boundary; if product review requires banker's rounding, stop before Task 2 rather than silently changing it.

### Task 1: Add currency precision and safe Money primitives

**Files:**
- Create: `src/domain/currency/currency.ts`
- Create: `src/domain/money/money.ts`
- Create: `tests/unit/domain/money/money.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/domain/money/money.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { addMoney, formatMoney, moneyFromApi, moneyToApi } from "@/domain/money/money";
import { getCurrencyMinorUnits } from "@/domain/currency/currency";

describe("Money", () => {
  it("keeps ISO precision and values beyond Number.MAX_SAFE_INTEGER", () => {
    expect(getCurrencyMinorUnits("CNY")).toBe(2);
    expect(getCurrencyMinorUnits("JPY")).toBe(0);
    expect(getCurrencyMinorUnits("BHD")).toBe(3);
    const value = moneyFromApi({ currency: "CNY", amountMinor: "90071992547409931234" });
    expect(moneyToApi(value).amountMinor).toBe("90071992547409931234");
  });

  it("rejects float syntax and cross-currency arithmetic", () => {
    expect(() => moneyFromApi({ currency: "CNY", amountMinor: "1.5" })).toThrow(
      "金额必须是最小货币单位整数",
    );
    expect(() =>
      addMoney(
        moneyFromApi({ currency: "CNY", amountMinor: "1" }),
        moneyFromApi({ currency: "JPY", amountMinor: "1" }),
      ),
    ).toThrow("不能直接运算不同币种的金额");
  });

  it("formats without converting the full amount through Number", () => {
    expect(formatMoney(moneyFromApi({ currency: "CNY", amountMinor: "28600" }), "zh-CN")).toBe(
      "¥286.00",
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- tests/unit/domain/money/money.test.ts`

Expected: FAIL with `Failed to resolve import "@/domain/money/money"`.

- [ ] **Step 3: Write the minimal implementation**

Create `src/domain/currency/currency.ts`:

```ts
export type CurrencyCode = string & { readonly __currencyCode: unique symbol };
const ZERO = new Set(["BIF", "CLP", "DJF", "GNF", "ISK", "JPY", "KMF", "KRW", "PYG", "RWF", "UGX", "UYI", "VND", "VUV", "XAF", "XOF", "XPF"]);
const THREE = new Set(["BHD", "IQD", "JOD", "KWD", "LYD", "OMR", "TND"]);
const FOUR = new Set(["CLF", "UYW"]);

export function asCurrencyCode(input: string): CurrencyCode {
  const code = input.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) throw new Error("币种代码必须是三个大写字母");
  try {
    new Intl.NumberFormat("en", { style: "currency", currency: code }).format(0);
  } catch {
    throw new Error(`不支持的币种：${code}`);
  }
  return code as CurrencyCode;
}

/**
 * 正式金额只保存最小单位整数。绝大多数 ISO 4217 币种为两位小数，
 * 标准中的 0/3/4 位例外显式列出，避免显示 locale 影响账务精度。
 */
export function getCurrencyMinorUnits(input: string): number {
  const code = asCurrencyCode(input);
  if (ZERO.has(code)) return 0;
  if (THREE.has(code)) return 3;
  if (FOUR.has(code)) return 4;
  return 2;
}
```

Create `src/domain/money/money.ts`:

```ts
import { asCurrencyCode, getCurrencyMinorUnits, type CurrencyCode } from "@/domain/currency/currency";

export interface Money { readonly currency: CurrencyCode; readonly amountMinor: bigint }
export interface MoneyApi { readonly currency: string; readonly amountMinor: string }
const INTEGER = /^-?(0|[1-9]\d*)$/;

export function moneyFromApi(input: MoneyApi): Money {
  if (!INTEGER.test(input.amountMinor)) throw new Error("金额必须是最小货币单位整数");
  return { currency: asCurrencyCode(input.currency), amountMinor: BigInt(input.amountMinor) };
}
export function moneyToApi(input: Money): MoneyApi {
  return { currency: input.currency, amountMinor: input.amountMinor.toString() };
}
export function addMoney(left: Money, right: Money): Money {
  if (left.currency !== right.currency) throw new Error("不能直接运算不同币种的金额");
  return { currency: left.currency, amountMinor: left.amountMinor + right.amountMinor };
}

/** 只拆分 bigint 的整数与余数用于显示，禁止先把完整金额转成 Number。 */
export function formatMoney(input: Money, locale: string): string {
  const digits = getCurrencyMinorUnits(input.currency);
  const divisor = 10n ** BigInt(digits);
  const negative = input.amountMinor < 0n;
  const absolute = negative ? -input.amountMinor : input.amountMinor;
  const symbol = new Intl.NumberFormat(locale, {
    style: "currency", currency: input.currency, maximumFractionDigits: 0,
  }).formatToParts(0).find((part) => part.type === "currency")?.value ?? input.currency;
  const major = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(absolute / divisor);
  const fraction = digits === 0 ? "" : `.${(absolute % divisor).toString().padStart(digits, "0")}`;
  return `${negative ? "-" : ""}${symbol}${major}${fraction}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- tests/unit/domain/money/money.test.ts`

Expected: PASS with 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/domain/currency/currency.ts src/domain/money/money.ts tests/unit/domain/money/money.test.ts
git commit -m "feat: add safe Money primitives"
```

### Task 2: Parse exact rates and convert only the Expense total

**Files:**
- Create: `src/domain/exchange-rate/decimal-rate.ts`
- Create: `tests/unit/domain/exchange-rate/decimal-rate.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/domain/exchange-rate/decimal-rate.test.ts
import { describe, expect, it } from "vitest";
import { convertMinorAmount, decimalRateToString, parseDecimalRate } from "@/domain/exchange-rate/decimal-rate";

describe("DecimalRate", () => {
  it("normalizes exact decimals and converts the total without float arithmetic", () => {
    const rate = parseDecimalRate("0.0480");
    expect(rate).toEqual({ coefficient: 48n, scale: 3 });
    expect(decimalRateToString(rate)).toBe("0.048");
    expect(convertMinorAmount(6000n, 0, 2, rate)).toBe(28800n);
  });

  it("rounds a half upward and rejects unsafe syntax", () => {
    expect(convertMinorAmount(1n, 0, 2, parseDecimalRate("0.015"))).toBe(2n);
    for (const input of ["0", "-1", "1e-3", "0.1234567890123"]) {
      expect(() => parseDecimalRate(input)).toThrow("汇率必须是最多 12 位小数的正十进制数");
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- tests/unit/domain/exchange-rate/decimal-rate.test.ts`

Expected: FAIL with missing module `decimal-rate`.

- [ ] **Step 3: Write the minimal implementation**

```ts
// src/domain/exchange-rate/decimal-rate.ts
export interface DecimalRate { readonly coefficient: bigint; readonly scale: number }
const RATE = /^(?:0|[1-9]\d*)(?:\.(\d{1,12}))?$/;

export function parseDecimalRate(input: string): DecimalRate {
  const value = input.trim();
  const match = RATE.exec(value);
  if (!match) throw new Error("汇率必须是最多 12 位小数的正十进制数");
  const fraction = (match[1] ?? "").replace(/0+$/, "");
  const coefficient = BigInt(`${value.split(".")[0]}${fraction}`);
  if (coefficient <= 0n) throw new Error("汇率必须是最多 12 位小数的正十进制数");
  return { coefficient, scale: fraction.length };
}

export function decimalRateToString(rate: DecimalRate): string {
  if (rate.scale === 0) return rate.coefficient.toString();
  const digits = rate.coefficient.toString().padStart(rate.scale + 1, "0");
  return `${digits.slice(0, -rate.scale)}.${digits.slice(-rate.scale)}`;
}

/**
 * 先得到 Expense 唯一主币总额，再交给 allocation 分配行；本函数故意不接收成员行，
 * 从接口层防止逐行换算再求和。整数除法使用 round-half-up。
 */
export function convertMinorAmount(
  originalMinor: bigint,
  originalMinorUnits: number,
  baseMinorUnits: number,
  rate: DecimalRate,
): bigint {
  if (originalMinor < 0n) throw new Error("待换算金额不能为负数");
  const numerator = originalMinor * rate.coefficient * 10n ** BigInt(baseMinorUnits);
  const denominator = 10n ** BigInt(originalMinorUnits + rate.scale);
  const quotient = numerator / denominator;
  return (numerator % denominator) * 2n >= denominator ? quotient + 1n : quotient;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- tests/unit/domain/exchange-rate/decimal-rate.test.ts`

Expected: PASS with 2 tests.

- [ ] **Step 5: Commit**

```bash
git add src/domain/exchange-rate/decimal-rate.ts tests/unit/domain/exchange-rate/decimal-rate.test.ts
git commit -m "feat: add exact decimal exchange rates"
```

### Task 3: Add deterministic integer allocation

**Files:**
- Create: `src/domain/splitting/allocation.ts`
- Create: `tests/unit/domain/splitting/allocation.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/domain/splitting/allocation.test.ts
import { describe, expect, it } from "vitest";
import { allocateByWeights } from "@/domain/splitting/allocation";

describe("allocateByWeights", () => {
  it("gives remainder units to ActivityMember ids in ascending order", () => {
    expect(allocateByWeights(10000n, [
      { memberId: "c", weight: 1n }, { memberId: "a", weight: 1n }, { memberId: "b", weight: 1n },
    ])).toEqual([
      { memberId: "a", amountMinor: 3334n },
      { memberId: "b", amountMinor: 3333n },
      { memberId: "c", amountMinor: 3333n },
    ]);
  });

  it("rejects duplicate members and non-positive weights", () => {
    expect(() => allocateByWeights(10n, [{ memberId: "a", weight: 1n }, { memberId: "a", weight: 1n }])).toThrow("分配成员不能重复");
    expect(() => allocateByWeights(10n, [{ memberId: "a", weight: 0n }])).toThrow("分配权重必须大于零");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- tests/unit/domain/splitting/allocation.test.ts`

Expected: FAIL with missing module `allocation`.

- [ ] **Step 3: Write the minimal implementation**

```ts
// src/domain/splitting/allocation.ts
export interface AllocationWeight { readonly memberId: string; readonly weight: bigint }
export interface AllocationResult { readonly memberId: string; readonly amountMinor: bigint }

/**
 * 先向下取整，再按 ActivityMember ID 升序补最小单位。输入顺序、昵称、UI 排序，
 * 以及 Guest 后续绑定账号都不能改变结果。
 */
export function allocateByWeights(totalMinor: bigint, inputs: readonly AllocationWeight[]): AllocationResult[] {
  if (totalMinor < 0n) throw new Error("分配总额不能为负数");
  if (inputs.length === 0) throw new Error("至少需要一个分配成员");
  const sorted = [...inputs].sort((a, b) => a.memberId.localeCompare(b.memberId));
  if (new Set(sorted.map((row) => row.memberId)).size !== sorted.length) throw new Error("分配成员不能重复");
  if (sorted.some((row) => row.weight <= 0n)) throw new Error("分配权重必须大于零");
  const weightSum = sorted.reduce((sum, row) => sum + row.weight, 0n);
  const result = sorted.map((row) => ({
    memberId: row.memberId,
    amountMinor: (totalMinor * row.weight) / weightSum,
  }));
  let remainder = totalMinor - result.reduce((sum, row) => sum + row.amountMinor, 0n);
  for (const row of result) {
    if (remainder === 0n) break;
    row.amountMinor += 1n;
    remainder -= 1n;
  }
  return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- tests/unit/domain/splitting/allocation.test.ts`

Expected: PASS with 2 tests.

- [ ] **Step 5: Commit**

```bash
git add src/domain/splitting/allocation.ts tests/unit/domain/splitting/allocation.test.ts
git commit -m "feat: add deterministic integer allocation"
```

### Task 4: Implement the four split modes

**Files:**
- Create: `src/domain/splitting/split.ts`
- Create: `tests/unit/domain/splitting/split.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/domain/splitting/split.test.ts
import { describe, expect, it } from "vitest";
import { splitExpense } from "@/domain/splitting/split";

describe("splitExpense", () => {
  it("supports all four modes with exact conservation", () => {
    expect(splitExpense({ mode: "EQUAL", totalMinor: 100n, memberIds: ["c", "a", "b"] })).toEqual([
      { memberId: "a", amountMinor: 34n },
      { memberId: "b", amountMinor: 33n },
      { memberId: "c", amountMinor: 33n },
    ]);
    expect(splitExpense({ mode: "EXACT", totalMinor: 100n, shares: [
      { memberId: "a", amountMinor: 60n }, { memberId: "b", amountMinor: 40n },
    ] })).toHaveLength(2);
    expect(splitExpense({ mode: "PERCENTAGE", totalMinor: 101n, shares: [
      { memberId: "b", basisPoints: 5000n }, { memberId: "a", basisPoints: 5000n },
    ] })[0]).toEqual({ memberId: "a", amountMinor: 51n });
    expect(splitExpense({ mode: "WEIGHT", totalMinor: 100n, shares: [
      { memberId: "a", weightHundredths: 100n }, { memberId: "b", weightHundredths: 300n },
    ] })).toEqual([{ memberId: "a", amountMinor: 25n }, { memberId: "b", amountMinor: 75n }]);
  });

  it("rejects invalid exact and percentage totals", () => {
    expect(() => splitExpense({ mode: "EXACT", totalMinor: 100n, shares: [{ memberId: "a", amountMinor: 99n }] })).toThrow("指定金额合计必须等于消费总额");
    expect(() => splitExpense({ mode: "PERCENTAGE", totalMinor: 100n, shares: [{ memberId: "a", basisPoints: 9999n }] })).toThrow("比例合计必须等于 100.00%");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- tests/unit/domain/splitting/split.test.ts`

Expected: FAIL with missing module `split`.

- [ ] **Step 3: Write the minimal implementation**

```ts
// src/domain/splitting/split.ts
import { allocateByWeights, type AllocationResult } from "./allocation";

type Equal = { mode: "EQUAL"; totalMinor: bigint; memberIds: readonly string[] };
type Exact = { mode: "EXACT"; totalMinor: bigint; shares: readonly { memberId: string; amountMinor: bigint }[] };
type Percentage = { mode: "PERCENTAGE"; totalMinor: bigint; shares: readonly { memberId: string; basisPoints: bigint }[] };
type Weight = { mode: "WEIGHT"; totalMinor: bigint; shares: readonly { memberId: string; weightHundredths: bigint }[] };
export type SplitInput = Equal | Exact | Percentage | Weight;

function assertUnique(ids: readonly string[]): void {
  if (ids.length === 0) throw new Error("至少需要一个分摊成员");
  if (new Set(ids).size !== ids.length) throw new Error("分摊成员不能重复");
}

export function splitExpense(input: SplitInput): AllocationResult[] {
  if (input.totalMinor <= 0n) throw new Error("消费总额必须大于零");
  if (input.mode === "EQUAL") {
    assertUnique(input.memberIds);
    return allocateByWeights(input.totalMinor, input.memberIds.map((memberId) => ({ memberId, weight: 1n })));
  }
  assertUnique(input.shares.map((row) => row.memberId));
  if (input.mode === "EXACT") {
    if (input.shares.some((row) => row.amountMinor < 0n)) throw new Error("指定金额不能为负数");
    if (input.shares.reduce((sum, row) => sum + row.amountMinor, 0n) !== input.totalMinor) throw new Error("指定金额合计必须等于消费总额");
    return [...input.shares].sort((a, b) => a.memberId.localeCompare(b.memberId));
  }
  if (input.mode === "PERCENTAGE") {
    if (input.shares.reduce((sum, row) => sum + row.basisPoints, 0n) !== 10000n) throw new Error("比例合计必须等于 100.00%");
    return allocateByWeights(input.totalMinor, input.shares.map((row) => ({ memberId: row.memberId, weight: row.basisPoints })));
  }
  return allocateByWeights(input.totalMinor, input.shares.map((row) => ({ memberId: row.memberId, weight: row.weightHundredths })));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- tests/unit/domain/splitting/split.test.ts`

Expected: PASS with 2 tests.

- [ ] **Step 5: Commit**

```bash
git add src/domain/splitting/split.ts tests/unit/domain/splitting/split.test.ts
git commit -m "feat: add expense split modes"
```

### Task 5: Derive ledger balances from facts

**Files:**
- Create: `src/domain/ledger/ledger.ts`
- Create: `tests/unit/domain/ledger/ledger.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/domain/ledger/ledger.test.ts
import { describe, expect, it } from "vitest";
import { calculateLedger } from "@/domain/ledger/ledger";

describe("calculateLedger", () => {
  it("uses payment - share + outgoing - incoming", () => {
    expect(calculateLedger({
      memberIds: ["a", "b", "c"],
      payments: [{ memberId: "a", amountMinor: 9000n }],
      shares: [
        { memberId: "a", amountMinor: 3000n },
        { memberId: "b", amountMinor: 3000n },
        { memberId: "c", amountMinor: 3000n },
      ],
      settlements: [{ payerMemberId: "b", receiverMemberId: "a", amountMinor: 1000n }],
    })).toEqual([
      { memberId: "a", netMinor: 5000n },
      { memberId: "b", netMinor: -2000n },
      { memberId: "c", netMinor: -3000n },
    ]);
  });

  it("rejects unbalanced facts", () => {
    expect(() => calculateLedger({ memberIds: ["a"], payments: [{ memberId: "a", amountMinor: 1n }], shares: [], settlements: [] })).toThrow("账务事实不守恒，无法生成总账");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- tests/unit/domain/ledger/ledger.test.ts`

Expected: FAIL with missing module `ledger`.

- [ ] **Step 3: Write the minimal implementation**

```ts
// src/domain/ledger/ledger.ts
export interface MemberBalance { readonly memberId: string; readonly netMinor: bigint }
export interface LedgerInput {
  readonly memberIds: readonly string[];
  readonly payments: readonly { memberId: string; amountMinor: bigint }[];
  readonly shares: readonly { memberId: string; amountMinor: bigint }[];
  readonly settlements: readonly { payerMemberId: string; receiverMemberId: string; amountMinor: bigint }[];
}

/** Ledger 每次由未删除事实重算，不存在可编辑的 user_balance 表。 */
export function calculateLedger(input: LedgerInput): MemberBalance[] {
  const values = new Map(input.memberIds.map((id) => [id, 0n]));
  const change = (id: string, delta: bigint): void => {
    if (!values.has(id)) throw new Error(`账务事实引用了未知成员：${id}`);
    values.set(id, values.get(id)! + delta);
  };
  for (const row of input.payments) change(row.memberId, row.amountMinor);
  for (const row of input.shares) change(row.memberId, -row.amountMinor);
  for (const row of input.settlements) {
    change(row.payerMemberId, row.amountMinor);
    change(row.receiverMemberId, -row.amountMinor);
  }
  const result = [...values].map(([memberId, netMinor]) => ({ memberId, netMinor }));
  if (result.reduce((sum, row) => sum + row.netMinor, 0n) !== 0n) throw new Error("账务事实不守恒，无法生成总账");
  return result.sort((a, b) => a.memberId.localeCompare(b.memberId));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- tests/unit/domain/ledger/ledger.test.ts`

Expected: PASS with 2 tests.

- [ ] **Step 5: Commit**

```bash
git add src/domain/ledger/ledger.ts tests/unit/domain/ledger/ledger.test.ts
git commit -m "feat: derive member ledger balances"
```

### Task 6: Generate deterministic settlement recommendations

**Files:**
- Create: `src/domain/settlement/recommendation.ts`
- Create: `tests/unit/domain/settlement/recommendation.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/domain/settlement/recommendation.test.ts
import { describe, expect, it } from "vitest";
import { recommendSettlements } from "@/domain/settlement/recommendation";

describe("recommendSettlements", () => {
  it("matches largest balances and uses member id for ties", () => {
    expect(recommendSettlements([
      { memberId: "creditor", netMinor: 5000n },
      { memberId: "debtor-b", netMinor: -2000n },
      { memberId: "debtor-c", netMinor: -3000n },
    ])).toEqual([
      { payerMemberId: "debtor-c", receiverMemberId: "creditor", amountMinor: 3000n },
      { payerMemberId: "debtor-b", receiverMemberId: "creditor", amountMinor: 2000n },
    ]);
    expect(recommendSettlements([
      { memberId: "creditor-b", netMinor: 100n }, { memberId: "creditor-a", netMinor: 100n },
      { memberId: "debtor-b", netMinor: -100n }, { memberId: "debtor-a", netMinor: -100n },
    ])[0]).toEqual({ payerMemberId: "debtor-a", receiverMemberId: "creditor-a", amountMinor: 100n });
  });

  it("rejects a non-zero-sum ledger", () => {
    expect(() => recommendSettlements([{ memberId: "a", netMinor: 1n }])).toThrow("成员余额合计必须为零");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- tests/unit/domain/settlement/recommendation.test.ts`

Expected: FAIL with missing module `recommendation`.

- [ ] **Step 3: Write the minimal implementation**

```ts
// src/domain/settlement/recommendation.ts
import type { MemberBalance } from "@/domain/ledger/ledger";
export interface SettlementRecommendation { readonly payerMemberId: string; readonly receiverMemberId: string; readonly amountMinor: bigint }
type Working = { memberId: string; remaining: bigint };
const largestFirst = (a: Working, b: Working): number =>
  a.remaining === b.remaining ? a.memberId.localeCompare(b.memberId) : a.remaining > b.remaining ? -1 : 1;

/** 推荐是当前 Ledger 的瞬时视图，不持久化，也不代表现实付款已经发生。 */
export function recommendSettlements(balances: readonly MemberBalance[]): SettlementRecommendation[] {
  if (balances.reduce((sum, row) => sum + row.netMinor, 0n) !== 0n) throw new Error("成员余额合计必须为零");
  const creditors = balances.filter((row) => row.netMinor > 0n).map((row) => ({ memberId: row.memberId, remaining: row.netMinor }));
  const debtors = balances.filter((row) => row.netMinor < 0n).map((row) => ({ memberId: row.memberId, remaining: -row.netMinor }));
  const result: SettlementRecommendation[] = [];
  while (creditors.length && debtors.length) {
    creditors.sort(largestFirst); debtors.sort(largestFirst);
    const creditor = creditors[0]; const debtor = debtors[0];
    const amountMinor = creditor.remaining < debtor.remaining ? creditor.remaining : debtor.remaining;
    result.push({ payerMemberId: debtor.memberId, receiverMemberId: creditor.memberId, amountMinor });
    creditor.remaining -= amountMinor; debtor.remaining -= amountMinor;
    if (creditor.remaining === 0n) creditors.shift();
    if (debtor.remaining === 0n) debtors.shift();
  }
  return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- tests/unit/domain/settlement/recommendation.test.ts`

Expected: PASS with 2 tests.

- [ ] **Step 5: Commit**

```bash
git add src/domain/settlement/recommendation.ts tests/unit/domain/settlement/recommendation.test.ts
git commit -m "feat: add deterministic settlement recommendations"
```

### Task 7: Prove conservation and dependency boundaries

**Files:**
- Create: `tests/unit/domain/accounting-properties.test.ts`

- [ ] **Step 1: Write the property tests**

```ts
// tests/unit/domain/accounting-properties.test.ts
import { fc } from "@fast-check/vitest";
import { expect } from "vitest";
import { allocateByWeights } from "@/domain/splitting/allocation";
import { recommendSettlements } from "@/domain/settlement/recommendation";

fc.it.prop([
  fc.bigInt({ min: 0n, max: 10n ** 18n }),
  fc.uniqueArray(fc.uuid(), { minLength: 1, maxLength: 20 }),
])("allocation conserves every minor unit and ignores input order", (totalMinor, ids) => {
  const forward = allocateByWeights(totalMinor, ids.map((memberId) => ({ memberId, weight: 1n })));
  const reverse = allocateByWeights(totalMinor, [...ids].reverse().map((memberId) => ({ memberId, weight: 1n })));
  expect(forward.reduce((sum, row) => sum + row.amountMinor, 0n)).toBe(totalMinor);
  expect(reverse).toEqual(forward);
});

fc.it.prop([fc.bigInt({ min: 0n, max: 10n ** 12n })])(
  "a two-member zero-sum balance is recommended exactly",
  (amountMinor) => {
    const result = recommendSettlements([
      { memberId: "creditor", netMinor: amountMinor },
      { memberId: "debtor", netMinor: -amountMinor },
    ]);
    expect(result.reduce((sum, row) => sum + row.amountMinor, 0n)).toBe(amountMinor);
  },
);
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npm run test:unit -- tests/unit/domain/accounting-properties.test.ts`

Expected: PASS for both properties with fast-check's configured run count.

- [ ] **Step 3: Run the Phase 1 gate**

```bash
npm run format:check
npm run lint
npm run typecheck
npm run test:unit -- tests/unit/domain
npm run build
```

Expected: all commands exit `0`.

- [ ] **Step 4: Verify Domain has no framework/database import**

```powershell
$forbidden = Select-String -Path 'src/domain/**/*.ts' -Pattern 'from "(react|next|drizzle-orm|@/server)'
if ($forbidden) { $forbidden; exit 1 }
```

Expected: no output and exit code `0`.

- [ ] **Step 5: Commit**

```bash
git add tests/unit/domain/accounting-properties.test.ts
git commit -m "test: prove accounting domain invariants"
```
