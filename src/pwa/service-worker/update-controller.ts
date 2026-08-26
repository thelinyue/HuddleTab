import { mayActivateUpdate } from "@/pwa/service-worker/update-policy";

type WaitingWorker = Pick<ServiceWorker, "postMessage">;

export type UpdateDependencies = {
  readonly pendingMutationCount: () => Promise<number>;
  readonly pendingAttachmentCount: () => Promise<number>;
  readonly reload: () => void;
};

/**
 * 更新激活必须服从前台账务队列：Service Worker 只接收明确的激活指令，
 * 不接管消费 Mutation 或附件上传。只有本次由用户发起更新后发生 controllerchange
 * 才允许刷新页面，避免首次安装 Service Worker 时意外重载。
 */
export function createUpdateController(dependencies: UpdateDependencies) {
  let activationRequested = false;

  return {
    async requestActivation(worker: WaitingWorker) {
      const decision = mayActivateUpdate({
        pendingMutations: await dependencies.pendingMutationCount(),
        pendingAttachments: await dependencies.pendingAttachmentCount(),
      });
      if (!decision.allowed)
        return { activated: false as const, reason: "PENDING_SYNC" as const };

      activationRequested = true;
      worker.postMessage({ type: "SKIP_WAITING" });
      return { activated: true as const };
    },
    handleControllerChange() {
      if (activationRequested) dependencies.reload();
    },
  };
}
