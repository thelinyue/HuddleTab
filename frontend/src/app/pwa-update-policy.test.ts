import { describe, expect, it } from "vitest";

import { canActivatePwaUpdate } from "./pwa-update-policy";
import type { MutationStatus } from "../pwa/indexed-db/schema";

describe("PWA 更新保护", () => {
  it.each([
    "PENDING",
    "SYNCING",
    "RETRYABLE",
    "REJECTED",
  ] as MutationStatus[])("%s 本地记录存在时阻止激活", (status) => {
    expect(canActivatePwaUpdate({ mutationStatuses: [status], attachmentStatuses: [] })).toEqual({
      allowed: false,
      message: "有新版本可用，完成同步后更新",
    });
  });

  it("全部记录已同步后允许激活", () => {
    expect(canActivatePwaUpdate({ mutationStatuses: ["SYNCED"], attachmentStatuses: ["SYNCED"] })).toEqual({
      allowed: true,
    });
  });
});
