"use client";

import Link from "next/link";
import { ArrowLeftIcon, ChevronRightIcon } from "lucide-react";
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
import { asCurrencyCode } from "@/domain/currency/currency";
import { formatMoney } from "@/domain/money/money";
import type { ExpenseDetailResponse } from "@/features/expenses/api";
import {
  expenseCategoryLabels,
  type ExpenseCategory,
} from "@/features/expenses/categories";
import { ExpenseAttachments } from "@/features/attachments/expense-attachments";
import { ExpenseCategoryIllustration } from "@/features/expenses/components/expense-category-illustration";
import type { ExpenseEditTarget } from "@/features/expenses/components/expense-update";

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
  subdued = false,
}: {
  readonly title: string;
  readonly children: React.ReactNode;
  readonly subdued?: boolean;
}) {
  return (
    <section
      aria-label={title}
      className={`mt-4 ${subdued ? "text-muted-foreground" : ""}`}
    >
      <h2 className="type-label border-b py-2.5 font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function DetailRow({
  label,
  children,
  editLabel,
  onEdit,
}: {
  readonly label: string;
  readonly children: React.ReactNode;
  readonly editLabel?: string;
  readonly onEdit?: (trigger: HTMLElement) => void;
}) {
  return (
    <div className="grid min-h-11 grid-cols-[5.5rem_minmax(0,1fr)] items-center gap-3 border-b py-1.5 last:border-b-0">
      <dt className="type-label text-muted-foreground">{label}</dt>
      <dd className="type-label min-w-0 text-right font-medium">
        {editLabel ? (
          <button
            type="button"
            aria-label={editLabel}
            className="inline-flex min-h-10 w-full items-center justify-end gap-1 text-right outline-none focus-visible:rounded-sm focus-visible:ring-3 focus-visible:ring-ring/30"
            onClick={(event) => onEdit?.(event.currentTarget)}
          >
            <span className="min-w-0 truncate">{children}</span>
            <ChevronRightIcon
              aria-hidden="true"
              className="size-4 shrink-0 text-muted-foreground"
            />
          </button>
        ) : (
          children
        )}
      </dd>
    </div>
  );
}

function EditableHeroValue({
  label,
  children,
  onEdit,
}: {
  readonly label: string;
  readonly children: React.ReactNode;
  readonly onEdit?: (trigger: HTMLElement) => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      className="inline-flex w-full items-center justify-center gap-1 rounded-sm px-2 py-1 text-center outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
      onClick={(event) => onEdit?.(event.currentTarget)}
    >
      <span className="min-w-0 truncate">{children}</span>
      <ChevronRightIcon
        aria-hidden="true"
        className="size-4 shrink-0 text-muted-foreground"
      />
    </button>
  );
}

/**
 * 详情页仅组合服务端事实和分字段入口。每个入口携带明确目标，更新协调器再负责
 * 构建完整 PUT 请求；因此只读成员、活动和创建信息不会误变成可编辑控件。
 */
export function ExpenseDetail({
  data,
  activityName,
  timeZone,
  onEditTarget,
  editReturnFocusRef,
  onDelete,
}: {
  readonly data: ExpenseDetailResponse;
  readonly activityName: string;
  readonly timeZone: string;
  readonly onEditTarget?: (target: ExpenseEditTarget) => void;
  readonly editReturnFocusRef?: React.RefObject<HTMLElement | null>;
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
  const canEdit = data.permissions.canUpdate && Boolean(onEditTarget);
  const canDelete = data.permissions.canDelete && Boolean(onDelete);
  const edit = (target: ExpenseEditTarget, trigger: HTMLElement) => {
    if (editReturnFocusRef) editReturnFocusRef.current = trigger;
    onEditTarget?.(target);
  };

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
        <span aria-hidden="true" />
      </header>

      <div className="flex flex-col items-center pb-1 pt-2 text-center">
        <ExpenseCategoryIllustration category={category} className="size-11" />
        {canEdit ? (
          <h2 className="type-section-title mt-2 w-full font-semibold">
            <EditableHeroValue
              label="编辑标题"
              onEdit={(trigger) => edit("TITLE", trigger)}
            >
              {expense.title}
            </EditableHeroValue>
          </h2>
        ) : (
          <h2 className="type-section-title mt-2 font-semibold">
            {expense.title}
          </h2>
        )}
        {canEdit ? (
          <EditableHeroValue
            label="编辑金额"
            onEdit={(trigger) => edit("AMOUNT", trigger)}
          >
            <MoneyAmount
              currency={expense.baseCurrency}
              amountMinor={BigInt(expense.baseAmountMinor)}
              size="lg"
              className="type-display-amount font-semibold"
            />
          </EditableHeroValue>
        ) : (
          <MoneyAmount
            currency={expense.baseCurrency}
            amountMinor={BigInt(expense.baseAmountMinor)}
            size="lg"
            className="type-display-amount mt-1 font-semibold"
          />
        )}
      </div>

      <Section title="消费信息">
        <dl>
          <DetailRow
            label="消费时间"
            editLabel={canEdit ? "编辑消费时间" : undefined}
            onEdit={(trigger) => edit("OCCURRED_AT", trigger)}
          >
            {formatDateTime(expense.occurredAt, timeZone)}
          </DetailRow>
          <DetailRow label="活动">{activityName}</DetailRow>
          <DetailRow
            label="分类"
            editLabel={canEdit ? "编辑分类" : undefined}
            onEdit={(trigger) => edit("CATEGORY", trigger)}
          >
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
          <DetailRow
            label="备注"
            editLabel={canEdit ? "编辑备注" : undefined}
            onEdit={(trigger) => edit("NOTE", trigger)}
          >
            {expense.note || "无"}
          </DetailRow>
        </dl>
      </Section>

      <Section title="付款">
        <div className="border-b">
          {canEdit ? (
            <button
              type="button"
              aria-label="编辑付款"
              className="flex min-h-14 w-full items-center gap-2 py-1.5 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
              onClick={(event) => edit("PAYMENTS", event.currentTarget)}
            >
              <span className="flex min-w-0 flex-1 items-center gap-2">
                <span className="flex shrink-0 -space-x-1.5">
                  {data.payments.map((payment) => (
                    <MemberAvatar
                      key={payment.memberId}
                      memberId={payment.memberId}
                      displayName={payment.memberDisplayName}
                      avatarPreset={payment.avatarPreset}
                      className="size-7 border-2 border-surface"
                    />
                  ))}
                </span>
                <span className="type-label min-w-0 truncate font-medium">
                  {data.payments
                    .map((payment) => payment.memberDisplayName)
                    .join("、") || "请选择付款人"}
                </span>
                <span className="type-label shrink-0 text-right font-semibold">
                  {data.payments.length === 1 ? (
                    <MoneyLine
                      currency={expense.baseCurrency}
                      amountMinor={data.payments[0]!.baseAmountMinor}
                    />
                  ) : (
                    <span className="grid justify-items-end">
                      {data.payments.map((payment) => (
                        <MoneyLine
                          key={payment.memberId}
                          currency={expense.baseCurrency}
                          amountMinor={payment.baseAmountMinor}
                        />
                      ))}
                    </span>
                  )}
                </span>
              </span>
              <ChevronRightIcon
                aria-hidden="true"
                className="size-4 shrink-0 text-muted-foreground"
              />
            </button>
          ) : (
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
          )}
        </div>
        <div className="flex min-h-11 items-center justify-between">
          <span className="type-label text-muted-foreground">支付合计</span>
          <MoneyLine
            currency={expense.baseCurrency}
            amountMinor={paymentTotal}
            className="type-label font-semibold"
          />
        </div>
      </Section>

      <Section title="分摊">
        <dl>
          <DetailRow
            label="分摊方式"
            editLabel={canEdit ? "编辑分摊方式" : undefined}
            onEdit={(trigger) => edit("SPLIT", trigger)}
          >
            <span>
              {splitModeLabels[expense.splitMode] ?? expense.splitMode}（
              {data.shares.length}人）
            </span>
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
        <Link
          href={`/activities/${encodeURIComponent(expense.activityId)}/expenses/${encodeURIComponent(expense.id)}/split`}
          aria-label="查看分摊明细"
          className="flex min-h-11 items-center justify-between border-t text-sm font-medium text-primary"
        >
          查看分摊明细
          <ChevronRightIcon aria-hidden="true" className="size-4" />
        </Link>
      </Section>

      <Section title="创建信息" subdued>
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

      {canDelete ? (
        <div className="mt-5 border-t pt-4">
          <button
            type="button"
            className="min-h-11 w-full text-left font-medium text-destructive outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
            onClick={() => {
              setDeleteError(null);
              setDeleteOpen(true);
            }}
          >
            删除账单
          </button>
        </div>
      ) : null}

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除账单</AlertDialogTitle>
            <AlertDialogDescription>
              删除{" "}
              {formatMoney(
                {
                  currency: asCurrencyCode(expense.baseCurrency),
                  amountMinor: BigInt(expense.baseAmountMinor),
                },
                "zh-CN",
              )}{" "}
              后，这笔账单将从活动账务流程和结算结果中移除。此操作会根据最新账单版本再次校验。
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

export type { ExpenseEditTarget };
