import { afterEach, expect, test, vi } from "vitest";

import { addGuestMember } from "@/features/expenses/api";

afterEach(() => {
  vi.unstubAllGlobals();
});

test("添加临时成员发送昵称并返回可直接加入选择器的真实成员", async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        data: {
          id: "guest-1",
          displayName: "阿岚",
          status: "ACTIVE",
          avatarPreset: null,
        },
      }),
      { status: 201, headers: { "Content-Type": "application/json" } },
    ),
  );
  vi.stubGlobal("fetch", fetchMock);

  await expect(addGuestMember("activity-1", "阿岚")).resolves.toEqual({
    id: "guest-1",
    displayName: "阿岚",
    status: "ACTIVE",
    avatarPreset: null,
  });
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/activities/activity-1/members",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ displayName: "阿岚" }),
    }),
  );
});
