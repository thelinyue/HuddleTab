"use client";

import { gsap } from "gsap";
import { useRef } from "react";

import {
  motionDuration,
  motionEase,
  useMotionGSAP,
} from "@/components/design-system/motion";
import { formatMoney } from "@/domain/money/money";
import { asCurrencyCode } from "@/domain/currency/currency";
import { cn } from "@/lib/utils";

type MoneyTone = "neutral" | "receivable" | "payable" | "settled" | "danger";
type MoneySize = "sm" | "md" | "lg";

const toneClassName: Record<MoneyTone, string> = {
  neutral: "text-foreground",
  receivable: "text-receivable",
  payable: "text-payable",
  settled: "text-success",
  danger: "text-[var(--amount-danger)]",
};

const sizeClassName: Record<MoneySize, string> = {
  sm: "text-sm",
  md: "text-base",
  lg: "text-xl font-semibold",
};

/** 所有账务金额都在最小单位 bigint 上格式化，界面不引入浮点数。 */
export function MoneyAmount({
  currency,
  amountMinor,
  tone = "neutral",
  size = "md",
  className,
}: {
  readonly currency: string;
  readonly amountMinor: bigint;
  readonly tone?: MoneyTone;
  readonly size?: MoneySize;
  readonly className?: string;
}) {
  const amount = formatMoney(
    { currency: asCurrencyCode(currency), amountMinor },
    "zh-CN",
  );
  const scope = useRef<HTMLSpanElement>(null);
  const previousAmount = useRef(amount);

  useMotionGSAP(
    (reducedMotion) => {
      const target = scope.current;
      if (!target || previousAmount.current === amount) return;
      previousAmount.current = amount;
      if (reducedMotion) {
        gsap.set(target, { opacity: 1, y: 0 });
        return;
      }
      gsap.fromTo(
        target,
        { opacity: 0.65, y: -2 },
        {
          duration: motionDuration.brief,
          ease: motionEase.emphasis,
          opacity: 1,
          overwrite: "auto",
          y: 0,
        },
      );
    },
    { dependencies: [amount], scope },
  );

  return (
    <span
      ref={scope}
      data-money-tone={tone}
      className={cn("money", toneClassName[tone], sizeClassName[size], className)}
    >
      {amount}
    </span>
  );
}
