import { expect, it, vi } from "vitest";

import { createUpdateController } from "@/pwa/service-worker/update-controller";

it("待同步账单或附件存在时不激活等待中的更新", async () => {
  const worker = { postMessage: vi.fn() };
  const controller = createUpdateController({
    pendingMutationCount: async () => 1,
    pendingAttachmentCount: async () => 0,
    reload: vi.fn(),
  });

  await expect(controller.requestActivation(worker)).resolves.toEqual({
    activated: false,
    reason: "PENDING_SYNC",
  });
  expect(worker.postMessage).not.toHaveBeenCalled();
});

it("队列为空时才向等待中的 worker 请求激活", async () => {
  const worker = { postMessage: vi.fn() };
  const controller = createUpdateController({
    pendingMutationCount: async () => 0,
    pendingAttachmentCount: async () => 0,
    reload: vi.fn(),
  });

  await expect(controller.requestActivation(worker)).resolves.toEqual({
    activated: true,
  });
  expect(worker.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
});
