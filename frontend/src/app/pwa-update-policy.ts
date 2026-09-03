import type { MutationStatus } from "../pwa/indexed-db/schema";

/**
 * Service Worker 更新前的本地数据闸门。任何未完成记录都先留在旧页面处理，
 * 让新版激活不会与用户仍在修正的离线账单同时发生。
 */
export function canActivatePwaUpdate(input: {
  mutationStatuses: readonly MutationStatus[];
  attachmentStatuses: readonly MutationStatus[];
}) {
  const unfinished = [
    ...input.mutationStatuses,
    ...input.attachmentStatuses,
  ].some((status) => status !== "SYNCED");
  return unfinished
    ? { allowed: false as const, message: "有新版本可用，完成同步后更新" }
    : { allowed: true as const };
}
