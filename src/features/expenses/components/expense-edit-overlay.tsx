"use client";

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ExpenseRequestError,
  addGuestMember,
  updateExpense,
  type ExpenseDetailResponse,
  type QuickExpenseContextDto,
} from "@/features/expenses/api";
import { ExpenseCategoryOptions } from "@/features/expenses/components/expense-category-picker";
import { useOnlineStatus } from "@/features/expenses/components/offline-status";
import {
  PayerPicker,
  resolvePayerPayments,
} from "@/features/expenses/components/payer-picker";
import { NavigationOverlay } from "@/components/ui/navigation-overlay";
import { SplitEditor } from "@/features/expenses/components/split-editor";
import {
  amountToMinor,
  buildUpdateExpenseRequest,
  dateTimeInput,
  expenseUpdateDraft,
  previewExpenseSplit,
  type ExpenseEditTarget,
  type ExpenseUpdateDraft,
} from "@/features/expenses/components/expense-update";
import type { QuickExpenseMember } from "@/features/expenses/components/quick-expense-form";
import {
  MemberPickerSheet,
  MemberPickerTrigger,
} from "@/features/members/components/member-picker";

const splitModeLabels = {
  EQUAL: "均摊",
  EXACT: "按金额",
  PERCENTAGE: "按比例",
  WEIGHT: "按份数",
} as const;

type ExpenseEditNavigationView =
  | "root"
  | "payer"
  | "payer-add-guest"
  | "participants"
  | "participants-add-guest";

type EditorProps = {
  readonly data: ExpenseDetailResponse;
  readonly context: QuickExpenseContextDto;
  readonly timeZone: string;
  readonly onSaved: () => void | Promise<void>;
  readonly onReloadLatest?: () => void | Promise<void>;
  readonly onOpenChange: (open: boolean) => void;
  readonly returnFocusRef?: RefObject<HTMLElement | null>;
};

function ErrorMessage({ message }: { readonly message: string | null }) {
  return message ? (
    <p role="alert" className="text-sm text-destructive">
      {message}
    </p>
  ) : null;
}

function SaveFooter({
  formId,
  saving,
  label = "保存",
  disabled = false,
}: {
  readonly formId: string;
  readonly saving: boolean;
  readonly label?: string;
  readonly disabled?: boolean;
}) {
  return (
    <Button
      form={formId}
      type="submit"
      className="h-12 w-full"
      disabled={saving || disabled}
    >
      {saving ? "保存中…" : label}
    </Button>
  );
}

function TextEditor({
  draft,
  onSave,
}: {
  readonly draft: ExpenseUpdateDraft;
  readonly onSave: (draft: ExpenseUpdateDraft) => Promise<void>;
}) {
  const [value, setValue] = useState(draft.title);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      id="expense-edit-title-form"
      className="grid gap-4 py-2"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (!value.trim()) {
          setError("标题不能为空。");
          return;
        }
        if (value.trim().length > 120) {
          setError("标题最多 120 个字符。");
          return;
        }
        setError(null);
        void onSave({ ...draft, title: value }).catch((reason) => {
          setError(
            reason instanceof Error
              ? reason.message
              : "账单更新失败，请稍后重试。",
          );
        });
      }}
    >
      <div className="grid gap-2">
        <Label htmlFor="expense-edit-title">标题</Label>
        <Input
          id="expense-edit-title"
          value={value}
          maxLength={120}
          required
          autoFocus
          onChange={(event) => setValue(event.target.value)}
        />
      </div>
      <ErrorMessage message={error} />
    </form>
  );
}

function AmountEditor({
  draft,
  onSave,
}: {
  readonly draft: ExpenseUpdateDraft;
  readonly onSave: (draft: ExpenseUpdateDraft) => Promise<void>;
}) {
  const [value, setValue] = useState(draft.amount);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      id="expense-edit-amount-form"
      className="grid gap-4 py-2"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        void onSave({ ...draft, amount: value }).catch((reason) => {
          setError(
            reason instanceof Error
              ? reason.message
              : "账单更新失败，请稍后重试。",
          );
        });
      }}
    >
      <div className="grid gap-2">
        <Label htmlFor="expense-edit-amount">金额</Label>
        <Input
          id="expense-edit-amount"
          type="text"
          inputMode="decimal"
          enterKeyHint="done"
          value={value}
          autoFocus
          onChange={(event) => setValue(event.target.value)}
        />
        <p className="text-sm text-muted-foreground">
          币种 {draft.currency} · 汇率 {draft.exchangeRate}
        </p>
      </div>
      <ErrorMessage message={error} />
    </form>
  );
}

function OccurredAtEditor({
  draft,
  onSave,
}: {
  readonly draft: ExpenseUpdateDraft;
  readonly onSave: (draft: ExpenseUpdateDraft) => Promise<void>;
}) {
  const [value, setValue] = useState(draft.occurredAt);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      id="expense-edit-occurred-at-form"
      className="grid gap-4 py-2"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        void onSave({ ...draft, occurredAt: value }).catch((reason) => {
          setError(
            reason instanceof Error
              ? reason.message
              : "账单更新失败，请稍后重试。",
          );
        });
      }}
    >
      <div className="grid gap-2">
        <Label htmlFor="expense-edit-occurred-at">消费时间</Label>
        <Input
          id="expense-edit-occurred-at"
          type="datetime-local"
          value={value}
          autoFocus
          aria-invalid={Boolean(error)}
          onChange={(event) => setValue(event.target.value)}
        />
        <ErrorMessage message={error} />
      </div>
    </form>
  );
}

function NoteEditor({
  draft,
  onSave,
}: {
  readonly draft: ExpenseUpdateDraft;
  readonly onSave: (draft: ExpenseUpdateDraft) => Promise<void>;
}) {
  const [value, setValue] = useState(draft.note);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      id="expense-edit-note-form"
      className="grid gap-4 py-2"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (value.length > 2000) {
          setError("备注最多 2000 个字符。");
          return;
        }
        setError(null);
        void onSave({ ...draft, note: value }).catch((reason) => {
          setError(
            reason instanceof Error
              ? reason.message
              : "账单更新失败，请稍后重试。",
          );
        });
      }}
    >
      <div className="grid gap-2">
        <Label htmlFor="expense-edit-note">备注</Label>
        <textarea
          id="expense-edit-note"
          value={value}
          maxLength={2000}
          rows={5}
          autoFocus
          className="min-h-32 w-full rounded-md border bg-background px-3 py-2 outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30"
          onChange={(event) => setValue(event.target.value)}
        />
      </div>
      <ErrorMessage message={error} />
    </form>
  );
}

function PaymentEditor({
  draft,
  context,
  online,
  onSave,
  onValidityChange,
  navigationView,
  onNavigationViewChange,
}: {
  readonly draft: ExpenseUpdateDraft;
  readonly context: QuickExpenseContextDto;
  readonly online: boolean;
  readonly onSave: (draft: ExpenseUpdateDraft) => Promise<void>;
  readonly onValidityChange: (valid: boolean) => void;
  readonly navigationView: ExpenseEditNavigationView;
  readonly onNavigationViewChange: (view: ExpenseEditNavigationView) => void;
}) {
  const [value, setValue] = useState(draft);
  const [createdMembers, setCreatedMembers] = useState<
    readonly QuickExpenseMember[]
  >([]);
  const [error, setError] = useState<string | null>(null);
  const total = (() => {
    try {
      return BigInt(amountToMinor(value.amount, value.currency));
    } catch {
      return null;
    }
  })();
  const resolution = resolvePayerPayments(
    value.payerSelection,
    total,
    value.currency,
  );
  const valid = total !== null && resolution.payments !== null;
  const members = [
    ...context.members.filter((member) => member.status === "ACTIVE"),
    ...createdMembers.filter(
      (created) => !context.members.some((member) => member.id === created.id),
    ),
  ];
  const picker = (
    <PayerPicker
      members={members}
      value={value.payerSelection}
      onChange={(payerSelection) =>
        setValue((current) => ({ ...current, payerSelection }))
      }
      totalMinor={total}
      currency={value.currency}
      canAddGuest={context.permissions.canManageMembers}
      online={online}
      onAddGuest={async (displayName) => {
        const member = await addGuestMember(context.activity.id, displayName);
        setCreatedMembers((current) => [...current, member]);
        return member;
      }}
      open={navigationView !== "root"}
      view={navigationView === "payer-add-guest" ? "add-guest" : "members"}
      showTrigger={navigationView === "root"}
      inline
      onOpenChange={(open) => onNavigationViewChange(open ? "payer" : "root")}
      onViewChange={(view) =>
        onNavigationViewChange(
          view === "add-guest" ? "payer-add-guest" : "payer",
        )
      }
    />
  );
  useEffect(() => onValidityChange(valid), [onValidityChange, valid]);
  return (
    <>
      {navigationView === "root" ? (
        <form
          id="expense-edit-payments-form"
          className="grid gap-4 py-2"
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            void onSave(value).catch((reason) => {
              setError(
                reason instanceof Error
                  ? reason.message
                  : "账单更新失败，请稍后重试。",
              );
            });
          }}
        >
          {picker}
        </form>
      ) : (
        <div className="grid gap-4 py-2">{picker}</div>
      )}
      {error ? <ErrorMessage message={error} /> : null}
    </>
  );
}

function SplitEditorFlow({
  draft,
  context,
  online,
  onSave,
  onValidityChange,
  navigationView,
  onNavigationViewChange,
}: {
  readonly draft: ExpenseUpdateDraft;
  readonly context: QuickExpenseContextDto;
  readonly online: boolean;
  readonly onSave: (draft: ExpenseUpdateDraft) => Promise<void>;
  readonly onValidityChange: (valid: boolean) => void;
  readonly navigationView: ExpenseEditNavigationView;
  readonly onNavigationViewChange: (view: ExpenseEditNavigationView) => void;
}) {
  const [value, setValue] = useState(draft);
  const [createdMembers, setCreatedMembers] = useState<
    readonly QuickExpenseMember[]
  >([]);
  const [pickerDraft, setPickerDraft] = useState<readonly string[]>(
    draft.participantIds,
  );
  const [error, setError] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const members = [
    ...context.members.filter((member) => member.status === "ACTIVE"),
    ...createdMembers.filter(
      (created) => !context.members.some((member) => member.id === created.id),
    ),
  ];
  const preview = previewExpenseSplit(value);
  const selectedMembers = members.filter((member) =>
    value.participantIds.includes(member.id),
  );
  useEffect(
    () => onValidityChange(selectedMembers.length > 0 && preview !== null),
    [onValidityChange, preview, selectedMembers.length],
  );
  const picker = (
    <MemberPickerSheet
      open={navigationView !== "root"}
      onOpenChange={(open) =>
        onNavigationViewChange(open ? "participants" : "root")
      }
      title="参与成员"
      mode="multiple"
      members={members}
      selectedIds={pickerDraft}
      view={
        navigationView === "participants-add-guest" ? "add-guest" : "members"
      }
      onSelectedIdsChange={setPickerDraft}
      onCommit={(ids) => {
        const changed =
          ids.length !== value.participantIds.length ||
          ids.some((id) => !value.participantIds.includes(id));
        setValue((current) => ({
          ...current,
          participantIds: [...ids],
          splitEntries:
            changed && current.splitMode !== "EQUAL"
              ? {}
              : current.splitEntries,
        }));
        onNavigationViewChange("root");
      }}
      canComplete={pickerDraft.length > 0}
      canAddGuest={context.permissions.canManageMembers}
      online={online}
      onAddGuest={async (displayName) => {
        const member = await addGuestMember(context.activity.id, displayName);
        setCreatedMembers((current) => [...current, member]);
        return member;
      }}
      inline
      onViewChange={(view) =>
        onNavigationViewChange(
          view === "add-guest" ? "participants-add-guest" : "participants",
        )
      }
    />
  );
  const fields = (
    <>
      <div>
        <fieldset role="radiogroup" aria-label="分摊方式">
          <legend className="type-label font-medium">分摊方式</legend>
          <div className="mt-2 grid grid-cols-4 gap-2">
            {(
              Object.entries(splitModeLabels) as [
                ExpenseUpdateDraft["splitMode"],
                string,
              ][]
            ).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={value.splitMode === mode}
                className="min-h-11 rounded-sm border px-2 aria-checked:border-primary aria-checked:bg-primary/10 aria-checked:font-semibold"
                onClick={() =>
                  setValue((current) => ({ ...current, splitMode: mode }))
                }
              >
                {label}
              </button>
            ))}
          </div>
        </fieldset>
      </div>
      <MemberPickerTrigger
        label="参与成员"
        members={members}
        selectedIds={value.participantIds}
        onClick={() => {
          setPickerDraft(value.participantIds);
          onNavigationViewChange("participants");
        }}
        buttonRef={triggerRef}
      />
      <SplitEditor
        members={members}
        participantIds={value.participantIds}
        mode={value.splitMode}
        values={value.splitEntries}
        currency={value.currency}
        allocations={preview}
        onValueChange={(memberId, input) =>
          setValue((current) => ({
            ...current,
            splitEntries: { ...current.splitEntries, [memberId]: input },
          }))
        }
      />
    </>
  );
  return (
    <>
      {navigationView === "root" ? (
        <form
          id="expense-edit-split-form"
          className="grid gap-4 py-2"
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            void onSave(value).catch((reason) => {
              setError(
                reason instanceof Error
                  ? reason.message
                  : "账单更新失败，请稍后重试。",
              );
            });
          }}
        >
          {fields}
          {picker}
        </form>
      ) : (
        <div className="grid gap-4 py-2">{picker}</div>
      )}
      {error ? <ErrorMessage message={error} /> : null}
    </>
  );
}

function titleForTarget(target: ExpenseEditTarget) {
  return {
    TITLE: "编辑标题",
    AMOUNT: "编辑金额",
    OCCURRED_AT: "编辑消费时间",
    CATEGORY: "编辑分类",
    NOTE: "编辑备注",
    PAYMENTS: "付款信息",
    SPLIT: "分摊设置",
  }[target];
}

function targetUnchanged(
  target: ExpenseEditTarget,
  initial: ExpenseUpdateDraft,
  candidate: ExpenseUpdateDraft,
) {
  switch (target) {
    case "TITLE":
      return initial.title.trim() === candidate.title.trim();
    case "AMOUNT":
      try {
        return (
          amountToMinor(initial.amount, initial.currency) ===
          amountToMinor(candidate.amount, candidate.currency)
        );
      } catch {
        return false;
      }
    case "OCCURRED_AT":
      return initial.occurredAt === candidate.occurredAt;
    case "CATEGORY":
      return initial.category === candidate.category;
    case "NOTE":
      return initial.note.trim() === candidate.note.trim();
    case "PAYMENTS":
      return (
        JSON.stringify(initial.payerSelection) ===
        JSON.stringify(candidate.payerSelection)
      );
    case "SPLIT":
      return (
        JSON.stringify({
          mode: initial.splitMode,
          participantIds: initial.participantIds,
          entries: initial.splitEntries,
        }) ===
        JSON.stringify({
          mode: candidate.splitMode,
          participantIds: candidate.participantIds,
          entries: candidate.splitEntries,
        })
      );
  }
}

/**
 * 账单字段编辑协调器只维护一个当前目标和一个完整草稿。任何字段保存都经过
 * 同一请求构建器，避免局部 PUT 遗漏付款、分摊或乐观锁版本。
 */
export function ExpenseEditOverlay({
  open,
  target = "TITLE",
  onOpenChange,
  onSaved,
  onReloadLatest,
  returnFocusRef,
  data,
  context,
  timeZone,
}: EditorProps & {
  readonly open: boolean;
  readonly target?: ExpenseEditTarget;
}) {
  const initialDraft = useMemo(
    () => expenseUpdateDraft(data, timeZone),
    [data, timeZone],
  );
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [coordinatorSaving, setCoordinatorSaving] = useState(false);
  const [completionValid, setCompletionValid] = useState(true);
  const [navigationView, setNavigationView] =
    useState<ExpenseEditNavigationView>("root");
  const savingRef = useRef(false);
  const online = useOnlineStatus();

  useEffect(() => {
    // target/open 代表一次新的编辑会话，必须清空上一会话遗留的本地导航栈。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNavigationView("root");
  }, [open, target]);

  const save = async (candidate: ExpenseUpdateDraft) => {
    if (savingRef.current) return;
    if (targetUnchanged(target, initialDraft, candidate)) {
      setError(null);
      onOpenChange(false);
      return;
    }
    if (!online) {
      const offlineError = new Error("编辑账单需要联网，请恢复网络后重试。");
      setError(offlineError.message);
      throw offlineError;
    }
    savingRef.current = true;
    setCoordinatorSaving(true);
    setError(null);
    try {
      await updateExpense(
        data.expense.activityId,
        data.expense.id,
        buildUpdateExpenseRequest(data, candidate, timeZone),
      );
      await onSaved();
      onOpenChange(false);
    } catch (reason) {
      if (reason instanceof ExpenseRequestError && reason.status === 409) {
        setConflict(true);
        setError(
          "账单已被其他成员更新。当前输入已保留，请查看最新内容后重新编辑。",
        );
        return;
      }
      setError(
        reason instanceof Error ? reason.message : "账单更新失败，请稍后重试。",
      );
      throw reason;
    } finally {
      savingRef.current = false;
      setCoordinatorSaving(false);
    }
  };
  const handleLatest = () => {
    onOpenChange(false);
    void (onReloadLatest ?? onSaved)();
  };
  const errorContent = error ? (
    <div className="grid gap-2">
      <ErrorMessage message={error} />
      {conflict ? (
        <Button type="button" variant="outline" onClick={handleLatest}>
          查看最新内容
        </Button>
      ) : null}
    </div>
  ) : null;

  const navigationTitle =
    navigationView === "payer"
      ? "谁付款"
      : navigationView === "payer-add-guest"
        ? "添加临时成员"
        : navigationView === "participants"
          ? "参与成员"
          : navigationView === "participants-add-guest"
            ? "添加临时成员"
            : titleForTarget(target);
  const navigateBack = () => {
    setNavigationView((current) =>
      current === "payer-add-guest"
        ? "payer"
        : current === "participants-add-guest"
          ? "participants"
          : "root",
    );
  };
  const updateOpen = (nextOpen: boolean) => {
    if (!nextOpen) setNavigationView("root");
    onOpenChange(nextOpen);
  };

  if (target === "CATEGORY") {
    return (
      <NavigationOverlay
        open={open}
        onOpenChange={updateOpen}
        title={titleForTarget(target)}
        returnFocusRef={returnFocusRef}
      >
        {errorContent}
        {coordinatorSaving ? <p role="status">更新中…</p> : null}
        <ExpenseCategoryOptions
          value={initialDraft.category}
          onChange={(category) =>
            void save({ ...initialDraft, category }).catch(() => undefined)
          }
        />
      </NavigationOverlay>
    );
  }

  if (target === "SPLIT") {
    return (
      <NavigationOverlay
        open={open}
        onOpenChange={updateOpen}
        title={navigationTitle}
        mobileFullScreen
        keyboardAware
        onBack={navigationView === "root" ? undefined : navigateBack}
        backLabel={
          navigationView === "participants-add-guest" ? "参与成员" : "分摊设置"
        }
        returnFocusRef={returnFocusRef}
        footer={
          navigationView === "root" ? (
            <SaveFooter
              formId="expense-edit-split-form"
              saving={coordinatorSaving}
              label="完成"
              disabled={!completionValid}
            />
          ) : null
        }
      >
        <SplitEditorFlow
          key={`${target}-${open ? "open" : "closed"}-${data.expense.version}`}
          draft={initialDraft}
          context={context}
          online={online}
          onSave={save}
          onValidityChange={setCompletionValid}
          navigationView={navigationView}
          onNavigationViewChange={setNavigationView}
        />
        {errorContent}
      </NavigationOverlay>
    );
  }

  if (target === "PAYMENTS") {
    return (
      <NavigationOverlay
        open={open}
        onOpenChange={updateOpen}
        title={navigationTitle}
        mobileFullScreen
        keyboardAware
        onBack={navigationView === "root" ? undefined : navigateBack}
        backLabel={navigationView === "payer-add-guest" ? "谁付款" : "付款信息"}
        returnFocusRef={returnFocusRef}
        footer={
          navigationView === "root" ? (
            <SaveFooter
              formId="expense-edit-payments-form"
              saving={coordinatorSaving}
              label="完成"
              disabled={!completionValid}
            />
          ) : null
        }
      >
        <PaymentEditor
          key={`${target}-${open ? "open" : "closed"}-${data.expense.version}`}
          draft={initialDraft}
          context={context}
          online={online}
          onSave={save}
          onValidityChange={setCompletionValid}
          navigationView={navigationView}
          onNavigationViewChange={setNavigationView}
        />
        {errorContent}
      </NavigationOverlay>
    );
  }

  const content =
    target === "TITLE" ? (
      <TextEditor draft={initialDraft} onSave={save} />
    ) : target === "AMOUNT" ? (
      <AmountEditor draft={initialDraft} onSave={save} />
    ) : target === "OCCURRED_AT" ? (
      <OccurredAtEditor draft={initialDraft} onSave={save} />
    ) : (
      <NoteEditor draft={initialDraft} onSave={save} />
    );
  return (
    <NavigationOverlay
      open={open}
      onOpenChange={updateOpen}
      title={titleForTarget(target)}
      keyboardAware
      returnFocusRef={returnFocusRef}
      footer={
        <SaveFooter
          formId={`expense-edit-${target.toLowerCase().replace("_", "-")}-form`}
          saving={coordinatorSaving}
        />
      }
    >
      <div
        key={`${target}-${open ? "open" : "closed"}-${data.expense.version}`}
      >
        {content}
      </div>
      {errorContent}
    </NavigationOverlay>
  );
}

export { dateTimeInput };
export type { ExpenseEditTarget };
