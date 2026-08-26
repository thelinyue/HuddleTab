import { prepareExpense } from "@/domain/expenses/prepare-expense";
import type { CreateExpenseRequest } from "@/features/expenses/contracts";
import { openHuddleTabDb } from "@/pwa/indexed-db/database";
import type { PendingExpenseMutation } from "@/pwa/indexed-db/schema";

/** 离线创建只能保存完整 Expense，先复用 Domain 守恒校验，再原子写入队列与附件。 */
export async function enqueueExpense(input: {
  userId: string;
  activityId: string;
  baseCurrency: string;
  input: CreateExpenseRequest;
  files: readonly File[];
}) {
  if (input.files.length > 3) throw new Error("每笔消费最多选择三张附件。");
  const request = input.input;
  if (
    request.originalCurrency !== input.baseCurrency &&
    (!request.exchangeRate ||
      !["CACHE", "MANUAL"].includes(request.exchangeRateSource))
  )
    throw new Error("离线外币消费需要有效缓存汇率或手工汇率。");
  prepareExpense({
    originalCurrency: request.originalCurrency,
    baseCurrency: input.baseCurrency,
    originalAmountMinor: BigInt(request.originalAmountMinor),
    exchangeRate: request.exchangeRate,
    payments: request.payments.map((row) => ({
      memberId: row.memberId,
      amountMinor: BigInt(row.amountMinor),
    })),
    split:
      request.split.mode === "EQUAL"
        ? { mode: "EQUAL", members: request.split.members }
        : {
            mode: request.split.mode,
            entries: request.split.entries.map((row) => ({
              memberId: row.memberId,
              value: BigInt(row.value),
            })),
          },
  });
  const now = Date.now();
  const id = crypto.randomUUID();
  const mutation: PendingExpenseMutation = {
    id,
    userId: input.userId,
    activityId: input.activityId,
    kind: "CREATE_EXPENSE",
    payload: request,
    status: "PENDING",
    attemptCount: 0,
    nextAttemptAt: now,
    createdAt: now,
    updatedAt: now,
  };
  const attachments = input.files.map((file) => ({
    id: crypto.randomUUID(),
    userId: input.userId,
    activityId: input.activityId,
    mutationId: id,
    clientAttachmentId: crypto.randomUUID(),
    fileName: file.name,
    mimeType: file.type,
    blob: file,
    status: "PENDING" as const,
    attemptCount: 0,
    nextAttemptAt: now,
    createdAt: now,
    updatedAt: now,
  }));
  const db = await openHuddleTabDb(input.userId);
  const tx = db.transaction(
    ["pending_mutations", "pending_attachments"],
    "readwrite",
  );
  await tx.objectStore("pending_mutations").add(mutation);
  for (const attachment of attachments)
    await tx.objectStore("pending_attachments").add(attachment);
  await tx.done;
  db.close();
  return { mutation, attachments };
}
