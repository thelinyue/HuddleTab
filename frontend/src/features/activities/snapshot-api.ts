import { apiClient } from "../../api/client";
import { unwrap, type ApiResult } from "../../api/error";
import type { components } from "../../api/generated/openapi";

export type ActivitySnapshotData = components["schemas"]["ActivitySnapshotData"];
type ActivitySnapshotEnvelope = components["schemas"]["ActivitySnapshotEnvelope"];

export type CachedActivitySnapshot = {
  etag: string;
  snapshot: ActivitySnapshotData;
};

export type SnapshotFetchResult =
  | { status: "modified"; value: CachedActivitySnapshot }
  | { status: "not-modified"; value: CachedActivitySnapshot };

async function requestSnapshot(activityId: string, etag?: string) {
  const params = { path: { activity_id: activityId } };
  const result = etag
    ? await apiClient.GET("/api/activities/{activity_id}/snapshot", {
        params,
        headers: { "If-None-Match": etag },
      })
    : await apiClient.GET("/api/activities/{activity_id}/snapshot", { params });
  return result as ApiResult<ActivitySnapshotEnvelope>;
}

function modified(result: ApiResult<ActivitySnapshotEnvelope>): SnapshotFetchResult {
  if (result.response.status !== 200 || result.data === undefined) {
    throw new Error("活动快照未返回完整数据。");
  }
  const etag = result.response.headers.get("etag");
  if (!etag) {
    throw new Error("活动快照响应缺少 ETag。");
  }
  return {
    status: "modified",
    value: { etag, snapshot: result.data.data },
  };
}

/** 只接受完整 200 替换或 304 复用，禁止把不同 revision 的字段做增量合并。 */
export async function fetchActivitySnapshot(
  activityId: string,
  current?: CachedActivitySnapshot,
): Promise<SnapshotFetchResult> {
  const result = await requestSnapshot(activityId, current?.etag);
  if (result.response.status === 304) {
    if (current) {
      if (result.response.headers.get("etag") !== current.etag) {
        throw new Error("活动快照 304 响应的 ETag 无效。");
      }
      return { status: "not-modified", value: current };
    }
    const unconditional = await requestSnapshot(activityId);
    if (unconditional.response.status === 304) {
      throw new Error("活动快照未返回完整数据。");
    }
    if (unconditional.response.status !== 200) {
      unwrap(unconditional);
    }
    return modified(unconditional);
  }
  if (result.response.status !== 200) {
    unwrap(result);
  }
  return modified(result);
}
