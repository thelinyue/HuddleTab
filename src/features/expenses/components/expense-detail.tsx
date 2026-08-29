"use client";

import Link from "next/link";
import {
  ArrowLeftIcon,
  ChevronRightIcon,
  EllipsisIcon,
  PencilIcon,
  Trash2Icon,
} from "lucide-react";
import { useState } from "react";

import { MemberAvatar } from "@/components/design-system/member-avatar";
import { MoneyAmount } from "@/components/design-system/money-amount";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { asCurrencyCode } from "@/domain/currency/currency";
import { formatMoney } from "@/domain/money/money";
import type { ExpenseDetailResponse } from "@/features/expenses/api";
import {
  expenseCategoryLabels,
  type ExpenseCategory,
} from "@/features/expenses/categories";
import { ExpenseCategoryIllustration } from "@/features/expenses/components/expense-category-illustration";
import { ExpenseAttachments } from "@/features/attachments/expense-attachments";

const splitModeLabels: Record<string, string> = {
  EQUAL: "均摊",
  EXACT: "按金额",
  PERCENTAGE: "按比例",
  WEIGHT: "按份数",
};

function MoneyLine({
  currency,
  amountMinor,
  className,
}: {
  readonly currency: string;
  readonly amountMinor: string | bigint;
  readonly className?: string;
}) {
  return (
    <span className={`money ${className ?? ""}`}>
      {formatMoney(
        {
          currency: asCurrencyCode(currency),
          amountMinor: BigInt(amountMinor),
        },
        "zh-CN",
      )}
    </span>
  );
}

/** 日期展示显式使用部署端 TZ，避免服务端、浏览器和测试环境各自采用隐式时区。 */
function formatDateTime(value: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}`;
}

function Section({
  title,
  children,
}: {
  readonly title: string;
  readonly children: React.ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className="mt-2.5 rounded-sm border bg-surface px-3 shadow-sm"
    >
      <h2 className="type-label border-b py-2.5 font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function DetailRow({
  label,
  children,
}: {
  readonly label: string;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="grid min-h-10 grid-cols-[5.5rem_minmax(0,1fr)] items-center gap-3 border-b py-1.5 last:border-b-0">
      <dt className="type-label text-muted-foreground">{label}</dt>
      <dd className="type-label min-w-0 text-right font-medium">{children}</dd>
    </div>
  );
}

/**
 * 账单详情只组合服务端返回的付款、分摊和权限事实。金额与成员事实不在客户端补造，
 * 管理动作也必须同时满足服务端权限和真实回调，避免渲染无法落地的占位入口。
 */
export function ExpenseDetail({
  data,
  activityName,
  timeZone,
  onEdit,
  onDelete,
}: {
  readonly data: ExpenseDetailResponse;
  readonly activityName: string;
  readonly timeZone: string;
  readonly onEdit?: () => void;
  readonly onDelete?: () => Promise<void>;
}) {
  const { expense } = data;
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const category = expense.category as ExpenseCategory;
  const paymentTotal = data.payments.reduce(
    (sum, payment) => sum + BigInt(payment.baseAmountMinor),
    0n,
  );
  const participantCount = data.shares.length;
  const canEdit = data.permissions.canUpdate && Boolean(onEdit);
  const canDelete = data.permissions.canDelete && Boolean(onDelete);

  const remove = async () => {
    if (!onDelete || deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await onDelete();
      setDeleteOpen(false);
    } catch (error) {
      setDeleteError(
        error instanceof Error ? error.message : "账单删除失败，请稍后重试。",
      );
    } finally {
      setDeleting(false);
    }
  };

  return (
    <article className="-mx-4 min-h-[calc(100dvh-5rem)] bg-surface px-4 pb-6 min-[481px]:-mx-6 min-[481px]:px-6">
      <header className="grid min-h-14 grid-cols-[2.75rem_minmax(0,1fr)_2.75rem] items-center">
        <Button
          variant="ghost"
          size="icon"
          asChild
          aria-label="返回活动流水"
          className="-ml-3"
        >
          <Link href={`/activities/${encodeURIComponent(expense.activityId)}`}>
            <ArrowLeftIcon aria-hidden="true" className="size-5" />
          </Link>
        </Button>
        <h1 className="type-page-title text-center font-semibold">账单详情</h1>
        {canEdit || canDelete ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="账单操作"
                className="-mr-3"
              >
                <EllipsisIcon aria-hidden="true" className="size-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-36">
              {canEdit ? (
                <DropdownMenuItem
                  className="min-h-10 gap-2 px-2"
                  onSelect={onEdit}
                >
                  <PencilIcon aria-hidden="true" />
                  编辑账单
                </DropdownMenuItem>
              ) : null}
              {canDelete ? (
                <DropdownMenuItem
                  variant="destructive"
                  className="min-h-10 gap-2 px-2"
                  onSelect={() => {
                    setDeleteError(null);
                    setDeleteOpen(true);
                  }}
                >
                  <Trash2Icon aria-hidden="true" />
                  删除账单
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <span aria-hidden="true" />
        )}
      </header>

      <div className="flex flex-col items-center pb-1 pt-2 text-center">
        <ExpenseCategoryIllustration category={category} className="size-11" />
        <h2 className="type-section-title mt-2 font-semibold">
          {expense.title}
        </h2>
        <MoneyAmount
          currency={expense.baseCurrency}
          amountMinor={BigInt(expense.baseAmountMinor)}
          size="lg"
          className="type-display-amount mt-1 font-semibold"
        />
      </div>

      <Section title="付款信息">
        <ul className="divide-y">
          {data.payments.map((payment) => (
            <li
              key={payment.memberId}
              className="flex min-h-11 items-center gap-2 py-1.5"
            >
              <MemberAvatar
                memberId={payment.memberId}
                displayName={payment.memberDisplayName}
                avatarPreset={payment.avatarPreset}
                className="size-7"
              />
              <span className="type-label min-w-0 flex-1 truncate font-medium">
                {payment.memberDisplayName}
                <span className="ml-1.5 rounded-full bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary">
                  付款人
                </span>
              </span>
              <MoneyLine
                currency={expense.baseCurrency}
                amountMinor={payment.baseAmountMinor}
                className="type-label font-semibold"
              />
            </li>
          ))}
        </ul>
        <div className="flex min-h-11 items-center justify-between border-t">
          <span className="type-label text-muted-foreground">支付合计</span>
          <MoneyLine
            currency={expense.baseCurrency}
            amountMinor={paymentTotal}
            className="type-label font-semibold"
          />
        </div>
      </Section>

      <Section title="消费信息">
        <dl>
          <DetailRow label="消费时间">
            {formatDateTime(expense.occurredAt, timeZone)}
          </DetailRow>
          <DetailRow label="活动">
            <Link
              href={`/activities/${encodeURIComponent(expense.activityId)}`}
              aria-label={`查看活动 ${activityName}`}
              className="inline-flex max-w-full items-center justify-end gap-1"
            >
              <span className="truncate">{activityName}</span>
              <ChevronRightIcon
                aria-hidden="true"
                className="size-4 shrink-0 text-muted-foreground"
              />
            </Link>
          </DetailRow>
          <DetailRow label="分类">
            <span className="inline-flex items-center gap-1.5">
              <ExpenseCategoryIllustration
                category={category}
                className="size-5"
              />
              {expenseCategoryLabels[category] ?? expenseCategoryLabels.OTHER}
            </span>
          </DetailRow>
          {expense.originalCurrency !== expense.baseCurrency ? (
            <>
              <DetailRow label="原币金额">
                <MoneyLine
                  currency={expense.originalCurrency}
                  amountMinor={expense.originalAmountMinor}
                />
              </DetailRow>
              <DetailRow label="汇率">{expense.exchangeRate}</DetailRow>
            </>
          ) : null}
          <DetailRow label="备注">{expense.note || "无"}</DetailRow>
        </dl>
      </Section>

      <Section title="分摊信息">
        <dl>
          <DetailRow label="分摊方式">
            <Link
              href={`/activities/${encodeURIComponent(expense.activityId)}/expenses/${encodeURIComponent(expense.id)}/split`}
              aria-label="查看分摊明细"
              className="inline-flex items-center gap-1"
            >
              {splitModeLabels[expense.splitMode] ?? expense.splitMode}（
              {participantCount}人）
              <ChevronRightIcon
                aria-hidden="true"
                className="size-4 text-muted-foreground"
              />
            </Link>
          </DetailRow>
          <DetailRow label="参与成员">
            <span className="inline-flex -space-x-1.5">
              {data.shares.map((share) => (
                <MemberAvatar
                  key={share.memberId}
                  memberId={share.memberId}
                  displayName={share.memberDisplayName}
                  avatarPreset={share.avatarPreset}
                  className="size-7 border-2 border-surface"
                />
              ))}
            </span>
          </DetailRow>
        </dl>
      </Section>

      <Section title="创建信息">
        <dl>
          <DetailRow label="创建人">
            <span className="inline-flex items-center gap-1.5">
              <MemberAvatar
                memberId={expense.createdByMemberId}
                displayName={expense.createdByDisplayName ?? "未知成员"}
                avatarPreset={expense.createdByAvatarPreset}
                className="size-6"
              />
              {expense.createdByDisplayName ?? "-"}
            </span>
          </DetailRow>
          <DetailRow label="创建时间">
            {formatDateTime(expense.createdAt, timeZone)}
          </DetailRow>
        </dl>
      </Section>

      {data.attachments.length ? (
        <ExpenseAttachments
          activityId={expense.activityId}
          expenseId={expense.id}
          attachments={data.attachments}
        />
      ) : null}

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除账单</AlertDialogTitle>
            <AlertDialogDescription>
              删除后，这笔账单将不再计入活动账务。此操作会根据最新账单版本再次校验。
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError ? (
            <p role="alert" className="text-sm text-destructive">
              {deleteError}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleting}
              onClick={(event) => {
                event.preventDefault();
                void remove();
              }}
            >
              {deleting ? "删除中…" : "确认删除"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </article>
  );
}
