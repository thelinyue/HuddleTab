import { randomUUID } from "node:crypto";

import { expect, type Page } from "@playwright/test";
import postgres from "postgres";

const password = "offline-e2e-password";

function databaseUrl() {
  const value = process.env.DATABASE_URL;
  if (!value) throw new Error("离线 E2E 必须提供 DATABASE_URL。");
  return value;
}

/** 离线 E2E 通过真实数据库打开注册策略，再走真实 HTTP 注册与认证流程。 */
export async function prepareOfflineUser(page: Page) {
  const sql = postgres(databaseUrl());
  try {
    await sql`update system_settings set registration_policy = 'OPEN' where id = 'singleton'`;
  } finally {
    await sql.end();
  }

  const username = `offline_${randomUUID().replaceAll("-", "").slice(0, 20)}`;
  const registration = await page.request.post("/api/auth/register", {
    data: { username, password, nickname: "离线测试用户" },
  });
  expect(registration.status()).toBe(201);

  await page.goto("/");
  const signedIn = await page.evaluate(
    async ({ username, password: currentPassword }) => {
      const response = await fetch("/api/auth/sign-in/username", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password: currentPassword }),
      });
      return { ok: response.ok, status: response.status };
    },
    { username, password },
  );
  expect(signedIn).toMatchObject({ ok: true, status: 200 });

  const activity = await page.evaluate(async () => {
    const response = await fetch("/api/activities", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "离线验证活动",
        baseCurrency: "CNY",
        startDate: "2026-08-26",
      }),
    });
    return (await response.json()) as { data?: { id?: string } };
  });
  if (!activity.data?.id) throw new Error("离线 E2E 创建活动失败。");
  return { activityId: activity.data.id, username };
}

export async function countExpenses(page: Page, activityId: string) {
  return page.evaluate(async (id) => {
    const response = await fetch(`/api/activities/${id}/expenses`);
    const body = (await response.json()) as { data?: readonly unknown[] };
    return body.data?.length ?? 0;
  }, activityId);
}

/** 直接变更真实活动生命周期，用于验证客户端缓存不能越过服务端最终权限边界。 */
export async function setActivityStatus(
  activityId: string,
  status: "ACTIVE" | "ENDED" | "ARCHIVED",
) {
  const sql = postgres(databaseUrl());
  try {
    await sql`update activities set status = ${status}, updated_at = now() where id = ${activityId}`;
  } finally {
    await sql.end();
  }
}

/** 仅读取当前活动的本地 mutation 状态，断言离线输入是否被正确保留或确认。 */
export async function readLocalMutation(page: Page, activityId: string) {
  return page.evaluate(
    async (id) =>
      await new Promise<
        | {
            status?: string;
            payload?: {
              clientMutationId?: string;
              title?: string;
              originalAmountMinor?: string;
            };
            lastError?: { code?: string; message?: string };
          }
        | undefined
      >((resolve) => {
        const userId = sessionStorage.getItem(
          `huddletab:expense-feed-user:${id}`,
        );
        if (!userId) return resolve(undefined);
        const request = indexedDB.open(`huddletab:${userId}`);
        request.onerror = () => resolve(undefined);
        request.onsuccess = () => {
          const database = request.result;
          const lookup = database
            .transaction("pending_mutations")
            .objectStore("pending_mutations")
            .getAll();
          lookup.onerror = () => resolve(undefined);
          lookup.onsuccess = () => resolve(lookup.result[0]);
        };
      }),
    activityId,
  );
}
