"use client";

import { CheckIcon, ChevronRightIcon, SearchIcon } from "lucide-react";
import { Command as CommandPrimitive } from "cmdk";

import {
  commonCurrencyCodes,
  currencyCatalog,
  getCurrencyDisplayName,
} from "@/domain/currency/currency";
import { cn } from "@/lib/utils";

const commonCodes = new Set<string>(commonCurrencyCodes);
const commonCurrencies = commonCurrencyCodes.map((code) =>
  currencyCatalog.find((currency) => currency.code === code),
);
const allCurrencies = currencyCatalog.filter(
  (currency) => !commonCodes.has(currency.code),
);

/**
 * 币种触发器只展示本地化名称，点击行为和 Overlay 生命周期由业务父组件持有，
 * 因而创建活动、活动管理和快速记账可以复用同一视觉而不嵌套 Dialog。
 */
export function CurrencyPickerTrigger({
  value,
  onClick,
  label = "币种",
  compact = false,
  disabled = false,
  className,
}: {
  readonly value: string;
  readonly onClick: () => void;
  readonly label?: string;
  readonly compact?: boolean;
  readonly disabled?: boolean;
  readonly className?: string;
}) {
  const name = getCurrencyDisplayName(value);
  return (
    <button
      type="button"
      aria-label={label}
      aria-haspopup="dialog"
      disabled={disabled}
      className={cn(
        compact
          ? "inline-flex min-h-11 items-center gap-1 rounded-md px-2 font-amount text-sm font-semibold text-foreground transition-colors hover:bg-muted/45 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:text-muted-foreground"
          : "flex min-h-11 w-full items-center justify-between gap-3 rounded-lg border bg-surface px-3 text-left text-sm transition-colors hover:bg-muted/35 focus-visible:border-ring focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:text-muted-foreground",
        className,
      )}
      onClick={onClick}
    >
      <span>{compact ? value : `${value} · ${name}`}</span>
      <ChevronRightIcon
        aria-hidden="true"
        className={cn("size-4 shrink-0 text-muted-foreground", compact && "size-3")}
      />
    </button>
  );
}

/**
 * 搜索列表由 cmdk 提供 Combobox 键盘语义；组件仅返回 ISO code，不向业务表单
 * 泄漏中文展示文案。常用项从全部项中排除，避免屏幕阅读器遇到重复选项。
 */
export function CurrencyPickerOptions({
  value,
  onSelect,
}: {
  readonly value: string;
  readonly onSelect: (code: string) => void;
}) {
  return (
    <CommandPrimitive className="flex min-h-0 flex-1 flex-col" label="搜索币种">
      <div className="flex min-h-11 items-center gap-2 rounded-lg border bg-background px-3 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/30">
        <SearchIcon aria-hidden="true" className="size-4 text-muted-foreground" />
        <CommandPrimitive.Input
          autoFocus
          aria-label="搜索币种"
          placeholder="搜索币种"
          className="min-h-11 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground md:text-sm"
        />
      </div>
      <CommandPrimitive.List className="mt-3 min-h-0 flex-1 overflow-y-auto pb-4">
        <CommandPrimitive.Empty className="py-8 text-center text-sm text-muted-foreground">
          未找到匹配的币种
        </CommandPrimitive.Empty>
        <CurrencyGroup
          heading="常用"
          currencies={commonCurrencies.filter(
            (currency): currency is NonNullable<typeof currency> =>
              Boolean(currency),
          )}
          value={value}
          onSelect={onSelect}
        />
        <CurrencyGroup
          heading="全部币种"
          currencies={allCurrencies}
          value={value}
          onSelect={onSelect}
        />
      </CommandPrimitive.List>
    </CommandPrimitive>
  );
}

function CurrencyGroup({
  heading,
  currencies,
  value,
  onSelect,
}: {
  readonly heading: string;
  readonly currencies: readonly (typeof currencyCatalog)[number][];
  readonly value: string;
  readonly onSelect: (code: string) => void;
}) {
  return (
    <CommandPrimitive.Group
      heading={heading}
      className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground"
    >
      {currencies.map((currency) => {
        const selected = value === currency.code;
        return (
          <CommandPrimitive.Item
            key={currency.code}
            value={`${currency.code} ${currency.name}`}
            keywords={[currency.code, currency.name]}
            onSelect={() => onSelect(currency.code)}
            className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 text-sm outline-none data-[selected=true]:bg-muted/55"
          >
            <CheckIcon
              aria-hidden="true"
              className={cn(
                "size-4 shrink-0 text-primary",
                !selected && "invisible",
              )}
            />
            <span className="w-10 shrink-0 font-amount font-semibold">
              {currency.code}
            </span>
            <span className="min-w-0 flex-1 truncate">{currency.name}</span>
          </CommandPrimitive.Item>
        );
      })}
    </CommandPrimitive.Group>
  );
}
