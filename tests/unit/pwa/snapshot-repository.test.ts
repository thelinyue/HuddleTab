import "fake-indexeddb/auto";
import { afterEach, expect, test } from "vitest";
import { deleteDB } from "idb";
import { SnapshotRepository } from "@/pwa/indexed-db/snapshot-repository";
import { mergeFeed } from "@/pwa/sync-queue/merge-feed";
afterEach(() => deleteDB("huddletab:u1"));
test("新 Revision 原子替换快照，并把待同步行作为本地预估叠加", async () => {
  const repo = await SnapshotRepository.open("u1");
  await repo.replace({
    activityId: "a1",
    userId: "u1",
    revision: "5",
    fetchedAt: 1,
    snapshot: { totalMinor: "1000", baseCurrency: "CNY", feed: [] },
  });
  await repo.replace({
    activityId: "a1",
    userId: "u1",
    revision: "7",
    fetchedAt: 2,
    snapshot: { totalMinor: "2000", baseCurrency: "CNY", feed: [] },
  });
  const view = mergeFeed(
    (await repo.require("a1")).snapshot as {
      totalMinor: string;
      baseCurrency: string;
      feed: unknown[];
    },
    [{ payload: { originalCurrency: "CNY", originalAmountMinor: "300" } }],
  );
  expect(view.authoritativeTotalMinor).toBe("2000");
  expect(view.localPendingEstimateMinor).toBe("300");
  expect(view.authorityLabel).toBe("截至上次同步");
  repo.close();
});
