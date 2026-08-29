import type { ReactNode } from "react";

import { asCurrencyCode } from "@/domain/currency/currency";
import { formatMoney } from "@/domain/money/money";
import { cn } from "@/lib/utils";

import type { ShareSummaryStatus } from "../types";

const statusLabel: Record<ShareSummaryStatus, string> = {
  receivable: "应收",
  payable: "应付",
  settled: "已结清",
};

const statusClassName: Record<ShareSummaryStatus, string> = {
  receivable: "text-[#16745B]",
  payable: "text-[#D97815]",
  settled: "text-[#7D8782]",
};

const avatarPalette = [
  "bg-[#DDF2E8] text-[#146B52]",
  "bg-[#FFF0D6] text-[#C66A0C]",
  "bg-[#E8F0E5] text-[#53795B]",
  "bg-[#E7F0ED] text-[#2A735F]",
  "bg-[#F5E8D7] text-[#9F6621]",
] as const;

/** 分享卡金额不使用动效组件，避免导出时因 hydration 或主题状态造成像素差异。 */
export function ShareMoneyAmount({
  currency,
  amountMinor,
  status,
  className,
}: {
  readonly currency: string;
  readonly amountMinor: bigint;
  readonly status?: ShareSummaryStatus;
  readonly className?: string;
}) {
  return (
    <span
      data-share-money-status={status}
      className={cn(
        "font-amount tabular-nums",
        status ? statusClassName[status] : "text-[#17211D]",
        className,
      )}
    >
      {formatMoney(
        { currency: asCurrencyCode(currency), amountMinor },
        "zh-CN",
      )}
    </span>
  );
}

/** 状态文字独立于色彩，保证群聊压缩或无障碍阅读时仍能分辨收支方向。 */
export function ShareStatusText({
  status,
}: {
  readonly status: ShareSummaryStatus;
}) {
  return (
    <span
      data-share-status={status}
      className={cn("font-semibold", statusClassName[status])}
    >
      {statusLabel[status]}
    </span>
  );
}

/** 分区共享轻边框和留白，视觉分层依赖背景而不是堆叠阴影。 */
export function ShareSectionCard({
  children,
  className,
}: {
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <section
      className={cn(
        "rounded-[28px] border border-[#D9E7DF] bg-white/90 px-8 py-7",
        className,
      )}
    >
      {children}
    </section>
  );
}

/** 名字首字母圆标避免依赖网络头像，使 PNG 导出不受图片请求时机影响。 */
export function ShareMemberAvatar({
  name,
  index,
  className,
}: {
  readonly name: string;
  readonly index: number;
  readonly className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex size-11 shrink-0 items-center justify-center rounded-full text-base font-bold",
        avatarPalette[index % avatarPalette.length],
        className,
      )}
    >
      {name.trim().slice(0, 2) || "友"}
    </span>
  );
}
