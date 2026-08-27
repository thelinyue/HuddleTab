import { FileTextIcon, ReceiptTextIcon, UsersIcon } from "lucide-react";

import { AppHeader } from "@/components/design-system/app-header";
import { EmptyState } from "@/components/design-system/empty-state";
import { MoneyAmount } from "@/components/design-system/money-amount";
import { asCurrencyCode } from "@/domain/currency/currency";
import { formatMoney } from "@/domain/money/money";
import {
  expenseCategoryLabels,
  type ExpenseCategory,
} from "@/features/expenses/categories";
import type { ExpenseDetailResponse } from "@/features/expenses/api";
import { ExpenseAttachments } from "@/features/attachments/expense-attachments";

function MoneyLine({
  currency,
  amountMinor,
}: {
  readonly currency: string;
  readonly amountMinor: string;
}) {
  return (
    <span className="money">
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

/** 详情只展示服务端返回的不可变快照与权限结果，LEFT 成员不会得到编辑或删除命令。 */
export function ExpenseDetail({
  data,
}: {
  readonly data: ExpenseDetailResponse;
}) {
  const { expense } = data;
  const memberAmounts = new Map<
    string,
    {
      displayName: string;
      paidMinor: bigint;
      shareMinor: bigint;
    }
  >();
  for (const payment of data.payments) {
    const current = memberAmounts.get(payment.memberId) ?? {
      displayName: payment.memberDisplayName,
      paidMinor: 0n,
      shareMinor: 0n,
    };
    current.paidMinor += BigInt(payment.baseAmountMinor);
    memberAmounts.set(payment.memberId, current);
  }
  for (const share of data.shares) {
    const current = memberAmounts.get(share.memberId) ?? {
      displayName: share.memberDisplayName,
      paidMinor: 0n,
      shareMinor: 0n,
    };
    current.shareMinor += BigInt(share.baseAmountMinor);
    memberAmounts.set(share.memberId, current);
  }
  return (
    <article className="py-5">
      <AppHeader
        eyebrow={expenseCategoryLabels[expense.category as ExpenseCategory]}
        title={expense.title}
      />
      <p className="mt-3 border-b pb-4">
        <MoneyAmount
          currency={expense.baseCurrency}
          amountMinor={BigInt(expense.baseAmountMinor)}
          size="lg"
        />
      </p>
      <dl className="divide-y">
        <div className="grid grid-cols-[7rem_1fr] gap-3 py-3">
          <dt className="text-muted-foreground">消费时间</dt>
          <dd>
            {new Intl.DateTimeFormat("zh-CN", {
              dateStyle: "medium",
              timeStyle: "short",
            }).format(new Date(expense.occurredAt))}
          </dd>
        </div>
        <div className="grid grid-cols-[7rem_1fr] gap-3 py-3">
          <dt className="text-muted-foreground">原币金额</dt>
          <dd>
            <MoneyLine
              currency={expense.originalCurrency}
              amountMinor={expense.originalAmountMinor}
            />
          </dd>
        </div>
        <div className="grid grid-cols-[7rem_1fr] gap-3 py-3">
          <dt className="text-muted-foreground">汇率</dt>
          <dd>
            {expense.exchangeRate}（{expense.exchangeRateSource}）
          </dd>
        </div>
        <div className="grid grid-cols-[7rem_1fr] gap-3 py-3">
          <dt className="text-muted-foreground">分摊方式</dt>
          <dd>{expense.splitMode}</dd>
        </div>
        <div className="grid grid-cols-[7rem_1fr] gap-3 py-3">
          <dt className="text-muted-foreground">创建人</dt>
          <dd>{expense.createdByDisplayName ?? "-"}</dd>
        </div>
        <div className="grid grid-cols-[7rem_1fr] gap-3 py-3">
          <dt className="text-muted-foreground">创建时间</dt>
          <dd>
            {new Intl.DateTimeFormat("zh-CN", {
              dateStyle: "medium",
              timeStyle: "short",
            }).format(new Date(expense.createdAt))}
          </dd>
        </div>
        <div className="grid grid-cols-[7rem_1fr] gap-3 py-3">
          <dt className="text-muted-foreground">最后修改</dt>
          <dd>
            {new Intl.DateTimeFormat("zh-CN", {
              dateStyle: "medium",
              timeStyle: "short",
            }).format(new Date(expense.updatedAt))}
          </dd>
        </div>
      </dl>
      <section className="mt-6">
        <h2 className="text-lg font-semibold">付款明细</h2>
        {data.payments.length ? (
          <ul className="mt-2 divide-y">
            {data.payments.map((payment) => (
              <li key={payment.memberId} className="flex justify-between py-2">
                <span>{payment.memberDisplayName}</span>
                <MoneyLine
                  currency={expense.baseCurrency}
                  amountMinor={payment.baseAmountMinor}
                />
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            icon={ReceiptTextIcon}
            title="没有付款明细"
            description="这笔消费尚未记录付款成员。"
          />
        )}
      </section>
      {data.attachments.length ? (
        <ExpenseAttachments
          activityId={expense.activityId}
          expenseId={expense.id}
          attachments={data.attachments}
        />
      ) : (
        <section className="mt-6" aria-labelledby="attachment-heading">
          <h2 id="attachment-heading" className="text-lg font-semibold">
            附件
          </h2>
          <EmptyState
            icon={FileTextIcon}
            title="没有附件"
            description="这笔消费没有可查看的附件。"
          />
        </section>
      )}
      <section className="mt-6" aria-labelledby="member-summary-heading">
        <h2 id="member-summary-heading" className="text-lg font-semibold">
          成员收支
        </h2>
        {memberAmounts.size ? (
          <ul className="mt-2 divide-y">
            {[...memberAmounts.entries()].map(([memberId, member]) => (
              <li key={memberId} className="py-3">
                <strong>{member.displayName}</strong>
                <dl className="mt-2 grid grid-cols-3 gap-2 text-sm">
                  <div>
                    <dt className="text-muted-foreground">已付</dt>
                    <dd>
                      <MoneyAmount
                        currency={expense.baseCurrency}
                        amountMinor={member.paidMinor}
                        size="sm"
                      />
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">承担</dt>
                    <dd>
                      <MoneyAmount
                        currency={expense.baseCurrency}
                        amountMinor={member.shareMinor}
                        size="sm"
                      />
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">净额</dt>
                    <dd>
                      <MoneyAmount
                        currency={expense.baseCurrency}
                        amountMinor={member.paidMinor - member.shareMinor}
                        size="sm"
                      />
                    </dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            icon={UsersIcon}
            title="没有成员收支"
            description="这笔消费尚未记录成员付款或承担。"
          />
        )}
      </section>
      {expense.note && (
        <section className="mt-6">
          <h2 className="text-lg font-semibold">备注</h2>
          <p className="mt-2 whitespace-pre-wrap">{expense.note}</p>
        </section>
      )}
      {(data.permissions.canUpdate || data.permissions.canDelete) && (
        <p className="mt-6 text-sm text-muted-foreground">此消费可由你管理。</p>
      )}
    </article>
  );
}
