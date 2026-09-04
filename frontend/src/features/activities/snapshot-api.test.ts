import { afterEach, describe, expect, it, vi } from "vitest";

const client = vi.hoisted(() => ({ GET: vi.fn() }));
vi.mock("../../api/client", () => ({ apiClient: client }));

import { fetchActivitySnapshot } from "./snapshot-api";

const snapshot = {
  activity: { activityId: "activity-1" },
  expenses: [],
  ledger: { balances: [], baseCurrency: "CNY", revision: "7" },
  members: [],
  recommendations: { baseCurrency: "CNY", recommendations: [], revision: "7" },
  revision: "7",
  settlements: [],
};

function response(status: number, data?: unknown, etag?: string) {
  return {
    data,
    response: new Response(null, {
      status,
      headers: etag ? { ETag: etag } : undefined,
    }),
  };
}

afterEach(() => vi.clearAllMocks());

describe("Activity Snapshot adapter", () => {
  it("200 使用完整响应和 ETag 原子替换旧值", async () => {
    const current = { etag: 'W/"6"', snapshot: { ...snapshot, revision: "6" } };
    client.GET.mockResolvedValue(response(200, { data: snapshot }, 'W/"7"'));

    const result = await fetchActivitySnapshot("activity-1", current as never);

    expect(result).toEqual({
      status: "modified",
      value: { etag: 'W/"7"', snapshot },
    });
    expect(client.GET).toHaveBeenCalledWith(
      "/api/activities/{activity_id}/snapshot",
      {
        headers: { "If-None-Match": 'W/"6"' },
        params: { path: { activity_id: "activity-1" } },
      },
    );
  });

  it("304 复用调用方已有的完整对象", async () => {
    const current = { etag: 'W/"7"', snapshot };
    client.GET.mockResolvedValue(response(304, undefined, 'W/"7"'));

    const result = await fetchActivitySnapshot("activity-1", current as never);

    expect(result.status).toBe("not-modified");
    expect(result.value).toBe(current);
  });

  it("304 缺少或返回不匹配的 ETag 时拒绝复用旧对象", async () => {
    const current = { etag: 'W/"7"', snapshot };
    client.GET.mockResolvedValue(response(304));
    await expect(
      fetchActivitySnapshot("activity-1", current as never),
    ).rejects.toThrow("活动快照 304 响应的 ETag 无效。");

    client.GET.mockResolvedValue(response(304, undefined, 'W/"8"'));
    await expect(
      fetchActivitySnapshot("activity-1", current as never),
    ).rejects.toThrow("活动快照 304 响应的 ETag 无效。");
  });

  it("没有本地值却收到 304 时只重试一次无条件 GET", async () => {
    client.GET
      .mockResolvedValueOnce(response(304, undefined, 'W/"7"'))
      .mockResolvedValueOnce(response(200, { data: snapshot }, 'W/"7"'));

    await expect(fetchActivitySnapshot("activity-1")).resolves.toEqual({
      status: "modified",
      value: { etag: 'W/"7"', snapshot },
    });
    expect(client.GET).toHaveBeenCalledTimes(2);
    expect(client.GET).toHaveBeenLastCalledWith(
      "/api/activities/{activity_id}/snapshot",
      { params: { path: { activity_id: "activity-1" } } },
    );
  });

  it("完整响应缺少 ETag 或无条件重取仍返回 304 时报告中文协议错误", async () => {
    client.GET.mockResolvedValue(response(200, { data: snapshot }));
    await expect(fetchActivitySnapshot("activity-1")).rejects.toThrow(
      "活动快照响应缺少 ETag。",
    );

    client.GET
      .mockReset()
      .mockResolvedValueOnce(response(304, undefined, 'W/"7"'))
      .mockResolvedValueOnce(response(304, undefined, 'W/"7"'));
    await expect(fetchActivitySnapshot("activity-1")).rejects.toThrow(
      "活动快照未返回完整数据。",
    );
  });
});
