import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  initializeSetup: vi.fn().mockResolvedValue(undefined),
  startCleanup: vi.fn(),
}));

vi.mock("@/server/bootstrap/initialize-setup", () => ({
  initializeSetup: mocks.initializeSetup,
}));
vi.mock("@/server/db/client", () => ({ sql: {} }));
vi.mock("@/server/jobs/orphan-attachment-cleanup", () => ({
  startOrphanAttachmentCleanup: mocks.startCleanup,
}));

it("复用 Phase 2 初始化器一次且先于 Next.js 启动", async () => {
  const { prepareContainerStart } =
    await import("@/server/bootstrap/container-start");
  const initializeSetup = vi.fn().mockResolvedValue(undefined);
  const startNext = vi.fn().mockResolvedValue(undefined);

  await prepareContainerStart({ initializeSetup, startNext });

  expect(initializeSetup).toHaveBeenCalledTimes(1);
  expect(startNext).toHaveBeenCalledTimes(1);
  expect(initializeSetup.mock.invocationCallOrder[0]).toBeLessThan(
    startNext.mock.invocationCallOrder[0]!,
  );
});
