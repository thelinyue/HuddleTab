import { readFileSync } from "node:fs";

import { expect, test } from "vitest";
import {
  BUSINESS_SYNC_OWNER,
  mayActivateUpdate,
} from "@/pwa/service-worker/update-policy";

test("存在待同步账单或附件时不允许触发重载更新", () => {
  expect(
    mayActivateUpdate({ pendingMutations: 1, pendingAttachments: 0 }),
  ).toEqual({ allowed: false, message: "有新版本可用，完成同步后更新。" });
  expect(
    mayActivateUpdate({ pendingMutations: 0, pendingAttachments: 1 }),
  ).toEqual({ allowed: false, message: "有新版本可用，完成同步后更新。" });
  expect(
    mayActivateUpdate({ pendingMutations: 0, pendingAttachments: 0 }),
  ).toEqual({ allowed: true, message: "可以更新。" });
  expect(BUSINESS_SYNC_OWNER).toBe("FOREGROUND_APP");
});

test("Service Worker 边界不拥有业务同步实现", () => {
  const source = ["business-sync-boundary.ts", "update-policy.ts"]
    .map((name) => readFileSync(`src/pwa/service-worker/${name}`, "utf8"))
    .join("\n");
  expect(source).not.toMatch(
    /sync-coordinator|pending_mutations|createExpense|BackgroundSync/,
  );
});
