import { randomUUID } from "node:crypto";
import { execFile as executeFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { expect, test } from "@playwright/test";

const execFile = promisify(executeFile);
const runCompose = process.env.RUN_PRODUCTION_COMPOSE === "true";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+I3M9WQAAAABJRU5ErkJggg==",
  "base64",
);

async function readJson(
  response: { status(): number; text(): Promise<string> },
  expectedStatus: number,
  action: string,
) {
  const body = await response.text();
  expect(response.status(), `${action}失败：${body}`).toBe(expectedStatus);
  return JSON.parse(body) as { data: unknown };
}

async function waitForHealthy(baseUrl: string) {
  const deadline = Date.now() + 90_000;
  let lastStatus = "未收到响应";
  while (Date.now() < deadline) {
    const health = await fetch(`${baseUrl}/api/health`).catch(() => undefined);
    if (health?.ok) return;
    lastStatus = health
      ? `${health.status} ${await health.text()}`
      : lastStatus;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`生产 Compose 应用未在规定时间内健康：${lastStatus}`);
}

test.skip(!runCompose, "仅在 WSL Docker 环境执行生产 Compose 演练");

test("生产 Compose 完成初始化、账务闭环并在双容器重启后保留数据", async ({
  page,
}, testInfo) => {
  test.setTimeout(240_000);
  const dataRoot = await mkdtemp(join(tmpdir(), "huddletab-compose-"));
  const projectOffset = testInfo.project.name === "mobile-chromium" ? 0 : 1;
  const port = 5661 + projectOffset + testInfo.parallelIndex * 2;
  const baseUrl = `http://127.0.0.1:${port}`;
  const project = `huddletab-phase10-${projectOffset}-${testInfo.parallelIndex}-${Date.now()}`;
  const environment = {
    ...process.env,
    APP_PORT: String(port),
    APP_BASE_URL: baseUrl,
    BETTER_AUTH_URL: baseUrl,
    DATA_HOST_DIR: dataRoot,
  };
  const compose = (args: readonly string[]) =>
    execFile("docker", ["compose", "-p", project, ...args], {
      cwd: process.cwd(),
      env: environment,
    });

  try {
    await compose(["up", "--build", "-d"]);
    await waitForHealthy(baseUrl);
    const logs = (await compose(["logs", "app"])).stdout;
    expect(logs).not.toContain("Setup Token");

    await page.goto(`${baseUrl}/login`);
    await expect(page).toHaveURL(`${baseUrl}/setup`);
    await page.getByLabel("管理员昵称").fill("Phase 10 管理员");
    await page.getByLabel("用户名").fill("phase10admin");
    await page
      .getByLabel("密码", { exact: true })
      .fill("phase10-compose-password");
    await page.getByLabel("确认密码").fill("phase10-compose-password");
    await page.getByRole("button", { name: "完成初始化" }).click();
    await expect(page).toHaveURL(`${baseUrl}/activities`);

    await page.waitForFunction(
      async () => {
        await navigator.serviceWorker.ready;
        return true;
      },
      undefined,
      { timeout: 30_000 },
    );
    await page.reload();
    await expect
      .poll(() =>
        page.evaluate(() => Boolean(navigator.serviceWorker.controller)),
      )
      .toBe(true);
    await page.goto(`${baseUrl}/activities`);
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const cache = await caches.open("huddletab-app-shell-v1");
          return (await cache.keys()).some(
            (request) => new URL(request.url).pathname === "/activities",
          );
        }),
      )
      .toBe(true);

    for (const path of [
      "/",
      "/login",
      "/login?callbackURL=%2Fjoin%2Fsecure_invite_token_123",
      "/register",
      "/register?callbackURL=%2Fjoin%2Fsecure_invite_token_123",
      "/setup",
      "/setup?source=compose",
      "/join/secure_invite_token_123?source=compose",
    ]) {
      const response = await page.goto(`${baseUrl}${path}`);
      expect(response?.status(), `访问 ${path} 应返回 HTML`).toBe(200);
    }

    for (const path of [
      "/login/help",
      "/register/invite?callbackURL=%2Fjoin%2Fsecure_invite_token_123",
      "/setup/status",
      "/join",
    ]) {
      await page.goto(`${baseUrl}${path}`);
    }

    const runtimeNavigationEntries = await page.evaluate(async () => {
      const cache = await caches.open("huddletab-app-shell-v1");
      return (await cache.keys()).map(
        (request) => new URL(request.url).pathname,
      );
    });
    expect(runtimeNavigationEntries).toContain("/activities");
    expect(runtimeNavigationEntries).toEqual(
      expect.not.arrayContaining([
        "/",
        "/login",
        "/register",
        "/setup",
        "/join",
      ]),
    );
    expect(
      runtimeNavigationEntries.some((pathname) =>
        ["/login", "/register", "/setup", "/join"].some(
          (root) => pathname === root || pathname.startsWith(`${root}/`),
        ),
      ),
    ).toBe(false);

    await page.goto(`${baseUrl}/activities`);
    expect(
      await page.evaluate(async () => (await fetch("/api/activities")).status),
    ).toBe(200);

    // 通过登录后的浏览器请求上下文走完整业务链路，确保 HttpOnly Session、数据库和 /data 同时真实工作。
    const request = page.request;
    const now = new Date().toISOString();
    const today = now.slice(0, 10);
    const activityResponse = await request.post(`${baseUrl}/api/activities`, {
      data: {
        name: "生产 Compose 持久化验收",
        location: "上海",
        baseCurrency: "CNY",
        startDate: today,
      },
    });
    const activityPayload = await readJson(activityResponse, 201, "创建活动");
    const activity = activityPayload.data as {
      id: string;
      ownerMemberId: string;
    };
    expect(activity.id).toEqual(expect.any(String));
    expect(activity.ownerMemberId).toEqual(expect.any(String));

    const guestResponse = await request.post(
      `${baseUrl}/api/activities/${activity.id}/members`,
      { data: { displayName: "Compose 临时成员" } },
    );
    const guestPayload = await readJson(guestResponse, 201, "添加临时成员");
    const guest = guestPayload.data as { id: string };
    expect(guest.id).toEqual(expect.any(String));

    const expenseInput = {
      clientMutationId: randomUUID(),
      title: "Compose 晚餐",
      category: "FOOD",
      originalCurrency: "CNY",
      originalAmountMinor: "12000",
      exchangeRate: "1",
      exchangeRateSource: "IDENTITY",
      exchangeRateAt: now,
      occurredAt: now,
      note: "重启前记录",
      payments: [{ memberId: activity.ownerMemberId, amountMinor: "12000" }],
      split: { mode: "EQUAL", members: [activity.ownerMemberId, guest.id] },
    } as const;
    const expenseResponse = await request.post(
      `${baseUrl}/api/activities/${activity.id}/expenses`,
      { data: expenseInput },
    );
    const expensePayload = await readJson(expenseResponse, 201, "创建账单");
    const createdExpense = expensePayload.data as {
      expense: { id: string; version: number; baseAmountMinor: string };
    };
    expect(createdExpense.expense).toMatchObject({
      version: 1,
      baseAmountMinor: "12000",
    });

    const editedTitle = "Compose 晚餐（已编辑）";
    const updateResponse = await request.put(
      `${baseUrl}/api/activities/${activity.id}/expenses/${createdExpense.expense.id}`,
      {
        data: {
          ...expenseInput,
          title: editedTitle,
          note: "重启前已编辑",
          version: createdExpense.expense.version,
        },
      },
    );
    const updatePayload = await readJson(updateResponse, 200, "编辑账单");
    expect(updatePayload.data).toMatchObject({
      title: editedTitle,
      note: "重启前已编辑",
      version: 2,
    });

    const attachmentResponse = await request.post(
      `${baseUrl}/api/activities/${activity.id}/expenses/${createdExpense.expense.id}/attachments`,
      {
        multipart: {
          file: { name: "receipt.png", mimeType: "image/png", buffer: png },
          clientAttachmentId: randomUUID(),
        },
      },
    );
    const attachmentPayload = await readJson(
      attachmentResponse,
      201,
      "上传附件",
    );
    const attachment = attachmentPayload.data as {
      id: string;
      mimeType: string;
    };
    expect(attachment).toMatchObject({
      id: expect.any(String),
      mimeType: "image/webp",
    });

    const attachmentDownload = await request.get(
      `${baseUrl}/api/activities/${activity.id}/expenses/${createdExpense.expense.id}/attachments/${attachment.id}`,
    );
    expect(attachmentDownload.status()).toBe(200);
    expect(attachmentDownload.headers()["content-type"]).toContain(
      "image/webp",
    );
    expect((await attachmentDownload.body()).byteLength).toBeGreaterThan(0);

    const settlementResponse = await request.post(
      `${baseUrl}/api/activities/${activity.id}/settlements`,
      {
        data: {
          payerMemberId: guest.id,
          receiverMemberId: activity.ownerMemberId,
          amountMinor: "6000",
          occurredAt: now,
          note: "Compose 已结算",
          confirmOverSettlement: false,
        },
      },
    );
    const settlementPayload = await readJson(
      settlementResponse,
      201,
      "记录结算",
    );
    const settlement = settlementPayload.data as {
      settlement: { id: string; amountMinor: string };
    };
    expect(settlement.settlement).toMatchObject({ amountMinor: "6000" });

    const csvResponse = await request.get(
      `${baseUrl}/api/activities/${activity.id}/export.csv`,
    );
    expect(csvResponse.status()).toBe(200);
    expect(await csvResponse.text()).toContain(`"${editedTitle}"`);

    const assertPersistedData = async (phase: string) => {
      const detailResponse = await request.get(
        `${baseUrl}/api/activities/${activity.id}/expenses/${createdExpense.expense.id}`,
      );
      const detailPayload = await readJson(
        detailResponse,
        200,
        `${phase}读取账单`,
      );
      expect(detailPayload.data).toMatchObject({
        expense: {
          title: editedTitle,
          note: "重启前已编辑",
          version: 2,
        },
        attachments: [{ id: attachment.id, mimeType: "image/webp" }],
      });

      const downloadResponse = await request.get(
        `${baseUrl}/api/activities/${activity.id}/expenses/${createdExpense.expense.id}/attachments/${attachment.id}`,
      );
      expect(downloadResponse.status(), `${phase}读取附件失败`).toBe(200);
      expect((await downloadResponse.body()).byteLength).toBeGreaterThan(0);

      const settlementsResponse = await request.get(
        `${baseUrl}/api/activities/${activity.id}/settlements`,
      );
      const settlementsPayload = await readJson(
        settlementsResponse,
        200,
        `${phase}读取结算`,
      );
      expect(settlementsPayload.data).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: settlement.settlement.id,
            amountMinor: "6000",
            note: "Compose 已结算",
          }),
        ]),
      );

      const persistedCsvResponse = await request.get(
        `${baseUrl}/api/activities/${activity.id}/export.csv`,
      );
      expect(persistedCsvResponse.status(), `${phase}导出 CSV 失败`).toBe(200);
      expect(await persistedCsvResponse.text()).toContain(`"${editedTitle}"`);
    };

    await page.goto(`${baseUrl}/activities/${activity.id}`);
    await expect(page.getByText(editedTitle, { exact: true })).toBeVisible();

    await compose(["restart", "app"]);
    await waitForHealthy(baseUrl);
    await assertPersistedData("应用容器重启后");

    await compose(["restart", "postgres"]);
    await waitForHealthy(baseUrl);
    await assertPersistedData("数据库容器重启后");
  } finally {
    await compose(["down", "--volumes", "--remove-orphans"]).catch(
      () => undefined,
    );
    await execFile("docker", [
      "run",
      "--rm",
      "--user",
      "0:0",
      "--mount",
      `type=bind,source=${dataRoot},target=/cleanup`,
      "--entrypoint",
      "find",
      "postgres:18-alpine",
      "/cleanup",
      "-mindepth",
      "1",
      "-delete",
    ]).catch(() => undefined);
    await rm(dataRoot, { recursive: true, force: true });
  }
});
