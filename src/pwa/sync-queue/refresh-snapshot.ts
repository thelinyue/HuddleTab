type CachedSnapshot = { readonly revision: string };
type SnapshotRecord<T> = {
  readonly activityId: string;
  readonly userId: string;
  readonly revision: string;
  readonly fetchedAt: number;
  readonly snapshot: T;
};

/**
 * Revision 仅用于决定是否重拉完整快照，V1 不实现 Delta Sync。
 *
 * 待同步消费由独立队列覆盖在读取结果之上，不能通过本函数写入或篡改服务端
 * 权威快照，避免离线输入与真实账务事实相互污染。
 */
export async function refreshSnapshotIfChanged<T>(
  activityId: string,
  api: {
    getRevision(activityId: string): Promise<{ readonly revision: string }>;
    fetchSnapshot(activityId: string): Promise<{
      readonly userId: string;
      readonly revision: string;
      readonly snapshot: T;
    }>;
  },
  repository: {
    get(activityId: string): Promise<CachedSnapshot | undefined>;
    replace(record: SnapshotRecord<T>): Promise<void>;
  },
  now: () => number = Date.now,
) {
  const [local, head] = await Promise.all([
    repository.get(activityId),
    api.getRevision(activityId),
  ]);
  if (local?.revision === head.revision) return local;
  const fetched = await api.fetchSnapshot(activityId);
  const record: SnapshotRecord<T> = {
    activityId,
    userId: fetched.userId,
    revision: fetched.revision,
    fetchedAt: now(),
    snapshot: fetched.snapshot,
  };
  await repository.replace(record);
  return record;
}
