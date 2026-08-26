export { BUSINESS_SYNC_OWNER } from "@/pwa/service-worker/business-sync-boundary";

/** 待同步数据存在时不得 skipWaiting 或重载，避免用户本地账单在更新中丢失。 */
export function mayActivateUpdate(input: {
  pendingMutations: number;
  pendingAttachments: number;
}) {
  if (input.pendingMutations + input.pendingAttachments > 0)
    return {
      allowed: false as const,
      message: "有新版本可用，完成同步后更新。",
    };
  return { allowed: true as const, message: "可以更新。" };
}
