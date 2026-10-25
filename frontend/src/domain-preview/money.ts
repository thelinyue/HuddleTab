const ZERO_MINOR_UNITS = new Set([
  "BIF", "CLP", "DJF", "GNF", "ISK", "JPY", "KMF", "KRW", "PYG", "RWF", "UGX",
  "UYI", "VND", "VUV", "XAF", "XOF", "XPF",
]);
const THREE_MINOR_UNITS = new Set(["BHD", "IQD", "JOD", "KWD", "LYD", "OMR", "TND"]);
const FOUR_MINOR_UNITS = new Set(["CLF", "UYW"]);

export function normalizeCurrency(input: string): string {
  const code = input.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) throw new Error("币种代码必须是三个字母。");
  return code;
}

export function currencyMinorUnits(input: string): number {
  const code = normalizeCurrency(input);
  if (ZERO_MINOR_UNITS.has(code)) return 0;
  if (THREE_MINOR_UNITS.has(code)) return 3;
  if (FOUR_MINOR_UNITS.has(code)) return 4;
  return 2;
}

/** 沿用旧 UI 的精确文本解析，不让主单位金额经过 JavaScript number。 */
export function amountToMinor(value: string, currency: string): string {
  const precision = currencyMinorUnits(currency);
  const match = value.trim().match(/^(0|[1-9]\d*)(?:\.(\d+))?$/);
  if (!match) throw new Error("金额格式不正确。");
  if ((match[2]?.length ?? 0) > precision) throw new Error("金额小数位超过币种精度。");
  const fraction = (match[2] ?? "").padEnd(precision, "0");
  const minor = BigInt(match[1]) * 10n ** BigInt(precision) + BigInt(fraction || "0");
  if (minor <= 0n) throw new Error("金额必须大于 0。");
  return minor.toString();
}

type Rational = { numerator: bigint; denominator: bigint };

function gcd(left: bigint, right: bigint): bigint {
  let a = left < 0n ? -left : left;
  let b = right < 0n ? -right : right;
  while (b !== 0n) {
    const next = a % b;
    a = b;
    b = next;
  }
  return a || 1n;
}

function rational(numerator: bigint, denominator = 1n): Rational {
  if (denominator === 0n) throw new Error("除数不能为 0。");
  const sign = denominator < 0n ? -1n : 1n;
  const divisor = gcd(numerator, denominator);
  return { numerator: (numerator * sign) / divisor, denominator: (denominator * sign) / divisor };
}

function addRational(left: Rational, right: Rational): Rational {
  return rational(left.numerator * right.denominator + right.numerator * left.denominator, left.denominator * right.denominator);
}

function multiplyRational(left: Rational, right: Rational): Rational {
  return rational(left.numerator * right.numerator, left.denominator * right.denominator);
}

/** 解析记账金额表达式；只接受固定小数和四则运算，避免动态执行用户输入。 */
class AmountExpressionParser {
  private readonly source: string;
  private index = 0;

  constructor(value: string) {
    this.source = value.replaceAll("×", "*").replaceAll("÷", "/").replace(/\s+/g, "");
    if (!this.source) throw new Error("金额不能为空。");
    if (this.source.length > 200) throw new Error("金额表达式过长。");
  }

  parse(): Rational {
    const result = this.parseAdditive();
    if (this.index !== this.source.length) throw new Error("金额表达式格式不正确。");
    return result;
  }

  private parseAdditive(): Rational {
    let result = this.parseMultiplicative();
    while (this.index < this.source.length && (this.source[this.index] === "+" || this.source[this.index] === "-")) {
      const operator = this.source[this.index++];
      const right = this.parseMultiplicative();
      result = operator === "+" ? addRational(result, right) : addRational(result, rational(-right.numerator, right.denominator));
    }
    return result;
  }

  private parseMultiplicative(): Rational {
    let result = this.parseUnary();
    while (this.index < this.source.length && (this.source[this.index] === "*" || this.source[this.index] === "/")) {
      const operator = this.source[this.index++];
      const right = this.parseUnary();
      if (operator === "*") result = multiplyRational(result, right);
      else {
        if (right.numerator === 0n) throw new Error("除数不能为 0。");
        result = rational(result.numerator * right.denominator, result.denominator * right.numerator);
      }
    }
    return result;
  }

  private parseUnary(): Rational {
    if (this.source[this.index] === "+") {
      this.index += 1;
      return this.parseUnary();
    }
    if (this.source[this.index] === "-") {
      this.index += 1;
      const value = this.parseUnary();
      return rational(-value.numerator, value.denominator);
    }
    return this.parsePrimary();
  }

  private parsePrimary(): Rational {
    if (this.source[this.index] === "(") {
      this.index += 1;
      const result = this.parseAdditive();
      if (this.source[this.index] !== ")") throw new Error("金额表达式括号不匹配。");
      this.index += 1;
      return result;
    }
    const start = this.index;
    while (/\d/.test(this.source[this.index] ?? "")) this.index += 1;
    const integer = this.source.slice(start, this.index);
    if (!integer) throw new Error("金额表达式格式不正确。");
    if (integer.length > 1 && integer.startsWith("0")) throw new Error("金额表达式格式不正确。");
    let fraction = "";
    if (this.source[this.index] === ".") {
      this.index += 1;
      const fractionStart = this.index;
      while (/\d/.test(this.source[this.index] ?? "")) this.index += 1;
      fraction = this.source.slice(fractionStart, this.index);
      if (!fraction) throw new Error("金额表达式格式不正确。");
    }
    const scale = 10n ** BigInt(fraction.length);
    return rational(BigInt(integer) * scale + BigInt(fraction || "0"), scale);
  }
}

function roundPositiveRational(value: Rational, precision: number): bigint {
  if (value.numerator <= 0n) throw new Error("金额必须大于 0。");
  const scaled = value.numerator * 10n ** BigInt(precision);
  let result = scaled / value.denominator;
  if ((scaled % value.denominator) * 2n >= value.denominator) result += 1n;
  if (result <= 0n) throw new Error("金额必须大于 0。");
  return result;
}

/** 支持四则表达式的金额转换；最终仍按币种精度四舍五入到最小单位。 */
export function amountExpressionToMinor(value: string, currency: string): string {
  const trimmed = value.trim();
  if (!/[+\-*/×÷()]/.test(trimmed)) return amountToMinor(trimmed, currency);
  const result = roundPositiveRational(new AmountExpressionParser(trimmed).parse(), currencyMinorUnits(currency));
  return result.toString();
}

export function minorToInput(value: string, currency: string): string {
  const precision = currencyMinorUnits(currency);
  const amount = BigInt(value);
  const divisor = 10n ** BigInt(precision);
  if (precision === 0) return amount.toString();
  const absolute = amount < 0n ? -amount : amount;
  const formatted = `${absolute / divisor}.${(absolute % divisor).toString().padStart(precision, "0")}`;
  return amount < 0n ? `-${formatted}` : formatted;
}

export function decimalToHundredths(value: string, label: string): string {
  const match = value.trim().match(/^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/);
  if (!match) throw new Error(`${label}格式不正确。`);
  return (BigInt(match[1]) * 100n + BigInt((match[2] ?? "").padEnd(2, "0"))).toString();
}

export function formatMoney(currency: string, amountMinor: string | bigint): string {
  const code = normalizeCurrency(currency);
  const minorUnits = currencyMinorUnits(code);
  const amount = typeof amountMinor === "bigint" ? amountMinor : BigInt(amountMinor);
  const divisor = 10n ** BigInt(minorUnits);
  const absolute = amount < 0n ? -amount : amount;
  const major = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(absolute / divisor);
  const fraction = minorUnits === 0 ? "" : `.${(absolute % divisor).toString().padStart(minorUnits, "0")}`;
  const symbol = new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: code,
    maximumFractionDigits: 0,
  }).formatToParts(0).find((part) => part.type === "currency")?.value ?? code;
  return `${amount < 0n ? "-" : ""}${symbol}${major}${fraction}`;
}
