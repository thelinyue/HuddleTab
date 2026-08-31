export type CurrencyCode = string & {
  readonly __currencyCode: unique symbol;
};

export interface CurrencyCatalogEntry {
  readonly code: CurrencyCode;
  readonly name: string;
}

export const commonCurrencyCodes = ["CNY", "USD", "JPY", "SGD"] as const;

const supportedCurrencyCodes = `
AED AFN ALL AMD ANG AOA ARS AUD AWG AZN BAM BBD BDT BGN BHD BIF BMD BND BOB BRL BSD BTN BWP BYN BZD CAD CDF CHF CLP CNY COP CRC CUP CVE CZK DJF DKK DOP DZD EGP ERN ETB EUR FJD FKP GBP GEL GHS GIP GMD GNF GTQ GYD HKD HNL HTG HUF IDR ILS INR IQD IRR ISK JMD JOD JPY KES KGS KHR KMF KPW KRW KWD KYD KZT LAK LBP LKR LRD LSL LYD MAD MDL MGA MKD MMK MNT MOP MRU MUR MVR MWK MXN MYR MZN NAD NGN NIO NOK NPR NZD OMR PAB PEN PGK PHP PKR PLN PYG QAR RON RSD RUB RWF SAR SBD SCR SDG SEK SGD SHP SLE SOS SRD SSP STN SVC SYP SZL THB TJS TMT TND TOP TRY TTD TWD TZS UAH UGX USD UYU UZS VES VND VUV WST XAF XCD XCG XOF XPF YER ZAR ZMW ZWG
`
  .trim()
  .split(/\s+/);
const supportedCurrencyCodeSet = new Set(supportedCurrencyCodes);
const displayNameOverrides: Readonly<Record<string, string>> = {
  AUD: "澳元",
  CNY: "人民币",
  EUR: "欧元",
  GBP: "英镑",
  JPY: "日元",
  SGD: "新加坡元",
  USD: "美元",
};
const currencyDisplayNames = new Intl.DisplayNames("zh-CN", {
  type: "currency",
  fallback: "code",
});

const ZERO_MINOR_UNITS = new Set([
  "BIF",
  "CLP",
  "DJF",
  "GNF",
  "ISK",
  "JPY",
  "KMF",
  "KRW",
  "PYG",
  "RWF",
  "UGX",
  "UYI",
  "VND",
  "VUV",
  "XAF",
  "XOF",
  "XPF",
]);
const THREE_MINOR_UNITS = new Set([
  "BHD",
  "IQD",
  "JOD",
  "KWD",
  "LYD",
  "OMR",
  "TND",
]);
const FOUR_MINOR_UNITS = new Set(["CLF", "UYW"]);

/** 将外部币种输入规范化为 ISO 4217 三字母代码，拒绝不可被运行时识别的币种。 */
export function asCurrencyCode(input: string): CurrencyCode {
  const code = input.trim().toUpperCase();

  if (!/^[A-Z]{3}$/.test(code)) {
    throw new Error("币种代码必须是三个大写字母");
  }

  if (!supportedCurrencyCodeSet.has(code)) {
    throw new Error(`不支持的币种：${code}`);
  }

  return code as CurrencyCode;
}

/** 中文名称只用于界面展示；持久化与接口始终使用标准三字母代码。 */
export function getCurrencyDisplayName(input: string): string {
  const code = asCurrencyCode(input);
  return displayNameOverrides[code] ?? currencyDisplayNames.of(code) ?? code;
}

/** 固定目录避免浏览器 ICU 版本差异改变客户端可选择的币种集合。 */
export const currencyCatalog: readonly CurrencyCatalogEntry[] =
  supportedCurrencyCodes.map((code) => {
    const normalized = asCurrencyCode(code);
    return { code: normalized, name: getCurrencyDisplayName(normalized) };
  });

/**
 * 正式金额以最小单位整数保存。ISO 4217 的 0/3/4 位例外在此显式列出，
 * 避免设备 locale 或 UI 格式化策略改变账务精度。
 */
export function getCurrencyMinorUnits(input: string): number {
  const code = asCurrencyCode(input);

  if (ZERO_MINOR_UNITS.has(code)) return 0;
  if (THREE_MINOR_UNITS.has(code)) return 3;
  if (FOUR_MINOR_UNITS.has(code)) return 4;

  return 2;
}
