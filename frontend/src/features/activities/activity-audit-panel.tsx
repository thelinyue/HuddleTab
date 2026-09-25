import { History, RefreshCw } from "lucide-react";
import { Button, ErrorNotice, LoadingState } from "../../components/ui";
import { MemberAvatar } from "../../components/member-avatar";
import { formatMoney } from "../../domain-preview/money";
import { type ActivityAuditEntry, useActivityAuditQuery } from "./api";

const actionLabels: Record<string, string> = {
  ACTIVITY_CREATED: "创建了活动",
  ACTIVITY_UPDATED: "更新了活动资料",
  ACTIVITY_ENDED: "结束了活动",
  ACTIVITY_REOPENED: "重新开启了活动",
  ACTIVITY_ARCHIVED: "归档了活动",
  ACTIVITY_UNARCHIVED: "取消了归档",
  ACTIVITY_DELETED: "删除了活动",
  ACTIVITY_RESTORED: "恢复了活动",
  ACTIVITY_STATUS_CHANGED: "变更了活动状态",
  OWNER_TRANSFERRED: "转让了活动所有权",
  MEMBER_GUEST_ADDED: "添加了临时成员",
  MEMBER_GUEST_BOUND: "绑定了临时成员",
  MEMBER_JOINED: "加入了活动",
  MEMBER_LEFT: "离开了活动",
  MEMBER_REMOVED: "移除了成员",
  INVITATION_CREATED: "创建了邀请",
  INVITATION_REVOKED: "撤销了邀请",
  JOIN_REQUEST_CREATED: "提交了加入申请",
  JOIN_REQUEST_APPROVED: "通过了加入申请",
  JOIN_REQUEST_REJECTED: "拒绝了加入申请",
  EXPENSE_CREATED: "新增了账单",
  EXPENSE_UPDATED: "修改了账单",
  EXPENSE_DELETED: "删除了账单",
  SETTLEMENT_CREATED: "创建了结算",
  SETTLEMENT_UPDATED: "修改了结算",
  SETTLEMENT_VOIDED: "作废了结算",
  BILL_OFFSETS_CONFIRMED: "确认了账单抵销",
  ATTACHMENT_UPLOADED: "上传了附件",
  ATTACHMENT_DELETED: "删除了附件",
};

const fieldLabels: Record<string, string> = {
  name: "活动名称",
  location: "地点",
  baseCurrency: "主币种",
  startDate: "开始日期",
  endDate: "结束日期",
  inviteMode: "加入方式",
  coverPreset: "封面主题",
  cover: "自定义封面",
  title: "账单名称",
  category: "分类",
  note: "备注",
  originalCurrency: "币种",
  originalAmountMinor: "金额",
  occurredAt: "发生时间",
  splitMode: "分摊方式",
};

const inviteModeLabels: Record<string, string> = {
  DIRECT_JOIN: "直接加入",
  REQUIRE_APPROVAL: "需要审批",
};

const localDateFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "long",
  day: "numeric",
});

const localTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  dateStyle: "medium",
  timeStyle: "short",
});

const expenseTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  dateStyle: "medium",
  timeStyle: "short",
});

function actionLabel(action: string): string {
  return actionLabels[action] ?? "记录了一项活动操作";
}

function displayValue(field: string, value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "未设置";
  if (field === "inviteMode") return inviteModeLabels[value] ?? value;
  return value;
}

function entryDate(entry: ActivityAuditEntry): string {
  return localDateFormatter.format(new Date(entry.createdAt));
}

function entryTime(entry: ActivityAuditEntry): string {
  return localTimeFormatter.format(new Date(entry.createdAt));
}

function expenseAmount(entry: ActivityAuditEntry): string {
  if (!entry.expense) return "";
  try {
    return formatMoney(entry.expense.originalCurrency, entry.expense.originalAmountMinor);
  } catch {
    return `${entry.expense.originalAmountMinor} ${entry.expense.originalCurrency}`;
  }
}

function changeCurrency(entry: ActivityAuditEntry, side: "before" | "after"): string {
  const currencyChange = entry.changes.find((change) => change.field === "originalCurrency");
  return (side === "before" ? currencyChange?.beforeValue : currencyChange?.afterValue)
    ?? entry.expense?.originalCurrency
    ?? "CNY";
}

function displayChangeValue(
  entry: ActivityAuditEntry,
  field: string,
  value: string | null | undefined,
  side: "before" | "after",
): string {
  if (value === null || value === undefined || value === "") return "未设置";
  if (field === "originalAmountMinor") {
    try {
      return formatMoney(changeCurrency(entry, side), value);
    } catch {
      return `${value} ${changeCurrency(entry, side)}`;
    }
  }
  if (field === "occurredAt") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return expenseTimeFormatter.format(parsed);
  }
  if (field === "splitMode") {
    return { EQUAL: "平均分摊", EXACT: "按金额分摊", PERCENTAGE: "按比例分摊", WEIGHT: "按权重分摊" }[value] ?? value;
  }
  return displayValue(field, value);
}

function groupEntries(entries: ActivityAuditEntry[]): Array<[string, ActivityAuditEntry[]]> {
  const groups = new Map<string, ActivityAuditEntry[]>();
  for (const entry of entries) {
    const date = entryDate(entry);
    const group = groups.get(date);
    if (group) group.push(entry);
    else groups.set(date, [entry]);
  }
  return [...groups.entries()];
}

/**
 * 活动记录只读取审计接口，不触碰通知查询或未读状态；MCP 创建的正式账单也会通过同一条账单写入链路出现在这里。
 * 时间线沿用 Sheet 的滚动容器，不为单条记录增加入场动画，避免长列表造成额外运动。
 */
export function ActivityAuditPanel({
  userId,
  activityId,
  offline,
}: {
  userId: string;
  activityId: string;
  offline: boolean;
}) {
  const query = useActivityAuditQuery(userId, activityId, !offline);

  if (offline) {
    return <div className="notice" role="status">当前离线，联网后才能查看活动记录。</div>;
  }

  if (query.isPending) return <LoadingState label="正在读取活动记录…" />;

  if (query.error) {
    return (
      <div className="activity-audit-panel__state">
        <ErrorNotice error={query.error} />
        <Button variant="secondary" type="button" onClick={() => void query.refetch()}>
          <RefreshCw aria-hidden="true" size={17} />
          重试
        </Button>
      </div>
    );
  }

  const entries = query.data?.pages.flatMap((page) => page.data) ?? [];
  if (!entries.length) {
    return (
      <div className="activity-audit-panel__empty">
        <History aria-hidden="true" size={24} />
        <strong>暂无活动记录</strong>
        <span>成员和活动的变更会显示在这里。</span>
      </div>
    );
  }

  return (
    <section className="activity-audit-panel" aria-label="活动记录">
      <p className="activity-audit-panel__description">查看成员与活动的变更历史</p>
      <div className="activity-audit-panel__timeline">
        {groupEntries(entries).map(([date, dateEntries]) => (
          <section className="activity-audit-day" key={date} aria-labelledby={`activity-audit-day-${date}`}>
            <h3 id={`activity-audit-day-${date}`}>{date}</h3>
            <ol className="activity-audit-list">
              {dateEntries.map((entry) => <AuditEntry key={entry.auditId} entry={entry} />)}
            </ol>
          </section>
        ))}
      </div>
      {query.hasNextPage ? (
        <Button
          className="activity-audit-panel__more"
          variant="secondary"
          type="button"
          busy={query.isFetchingNextPage}
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          加载更多
        </Button>
      ) : null}
    </section>
  );
}

function AuditEntry({ entry }: { entry: ActivityAuditEntry }) {
  const actorKey = entry.actorMemberId ?? entry.actorUserId ?? entry.auditId;
  const hasChanges = ["ACTIVITY_UPDATED", "EXPENSE_UPDATED"].includes(entry.action) && entry.changes.length > 0;
  return (
    <li className="activity-audit-entry">
      <MemberAvatar
        memberId={actorKey}
        userId={entry.actorUserId}
        displayName={entry.actorDisplayName}
        avatarPreset={entry.actorAvatarPreset}
        avatarImageId={entry.actorAvatarImageId}
        size="sm"
      />
      <div className="activity-audit-entry__body">
        <div className="activity-audit-entry__heading">
          <strong>{entry.actorDisplayName}</strong>
          <span>{actionLabel(entry.action)}</span>
          {entry.source === "MCP" ? <span className="activity-audit-entry__source" title="通过 MCP 创建">通过 MCP</span> : null}
        </div>
        <div className="activity-audit-entry__meta">
          <time dateTime={entry.createdAt}>{entryTime(entry)}</time>
          <span>第 {entry.revision} 次变更</span>
        </div>
        {entry.expense ? (
          <div className="activity-audit-entry__expense" aria-label="账单信息">
            <div className="activity-audit-entry__expense-heading">
              <strong>{entry.expense.title}</strong>
              <b>{expenseAmount(entry)}</b>
            </div>
            <div className="activity-audit-entry__expense-meta">
              <span>{entry.expense.category}</span>
              <time dateTime={entry.expense.occurredAt}>发生于 {expenseTimeFormatter.format(new Date(entry.expense.occurredAt))}</time>
            </div>
          </div>
        ) : null}
        {hasChanges ? (
          <ul
            className="activity-audit-entry__changes"
            aria-label={entry.action === "EXPENSE_UPDATED" ? "账单修改前后" : "活动资料修改前后"}
          >
            {entry.changes.map((change) => (
              <li className="activity-audit-entry__change" key={change.field}>
                <span>{fieldLabels[change.field] ?? change.field}</span>
                <span className="activity-audit-entry__value">{displayChangeValue(entry, change.field, change.beforeValue, "before")}</span>
                <span className="activity-audit-entry__arrow" aria-hidden="true">→</span>
                <span className="activity-audit-entry__value">{displayChangeValue(entry, change.field, change.afterValue, "after")}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </li>
  );
}
