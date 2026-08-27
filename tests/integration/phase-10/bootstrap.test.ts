import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  startCleanup: vi.fn(),
}));

vi.mock("@/server/db/client", () => ({ sql: {} }));
vi.mock("@/server/jobs/orphan-attachment-cleanup", () => ({
  startOrphanAttachmentCleanup: mocks.startCleanup,
}));

it("生产启动只启动后台清理，不再生成 Setup Token", async () => {
  const { initializeContainerRuntime } =
    await import("@/server/bootstrap/container-start");

  await initializeContainerRuntime();

  expect(mocks.startCleanup).toHaveBeenCalledTimes(1);
});
