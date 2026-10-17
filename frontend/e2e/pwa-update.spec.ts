import { expect, test, type Page } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const distRoot = fileURLToPath(new URL("../dist/", import.meta.url));
const contentTypes: Record<string, string> = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".webmanifest": "application/manifest+json",
  ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml", ".ico": "image/x-icon",
};
let server: Server;
let origin: string;
let workerRevision = 0;

test.beforeAll(async () => {
  const workerSource = await readFile(resolve(distRoot, "sw.js"), "utf8");
  // 只修改夹具响应中的版本标记，生产 Service Worker 的缓存、等待和激活逻辑照常运行。
  server = createServer(async (request, response) => {
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    response.setHeader("Cache-Control", "no-store");
    try {
      if (pathname.startsWith("/api/")) {
        const data = pathname.endsWith("/session")
          ? { userId: "pwa-user", username: "pwa-fixture", displayName: "更新测试", isSystemAdmin: false }
          : pathname.endsWith("/csrf") ? { token: "fixture" } : [];
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({ data }));
        return;
      }
      if (pathname === "/sw.js") {
        response.setHeader("Content-Type", "text/javascript");
        response.end(workerSource + "\nself.addEventListener('message', event => { if (event.data === 'pwa-fixture-revision') event.ports[0].postMessage(" + workerRevision + "); });");
        return;
      }
      const file = extname(pathname) ? resolve(distRoot, "." + pathname) : resolve(distRoot, "index.html");
      response.setHeader("Content-Type", contentTypes[extname(file)] ?? "application/octet-stream");
      response.end(await readFile(file));
    } catch {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("无法启动 PWA 更新验收服务。");
  origin = "http://127.0.0.1:" + address.port;
});

test.beforeEach(() => { workerRevision = 0; });
test.afterAll(async () => {
  server?.closeAllConnections();
  await new Promise<void>((resolveClose, reject) => {
    server?.close((error) => error ? reject(error) : resolveClose());
  });
});

async function startApp(page: Page) {
  await page.goto(origin + "/me/password");
  await expect(page.getByRole("heading", { name: "修改密码" })).toBeVisible();
  // 首次安装不抢占已打开的页面；进入已安装版本后再测试真正的升级。
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await expect(page.getByRole("heading", { name: "修改密码" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
}

async function activeRevision(page: Page) {
  return page.evaluate(() => new Promise<number>((resolveRevision) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = (event) => {
      channel.port1.close();
      resolveRevision(event.data);
    };
    navigator.serviceWorker.controller!.postMessage("pwa-fixture-revision", [channel.port2]);
  }));
}

async function installUpdate(page: Page) {
  workerRevision = 1;
  await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration())!.update(); });
  await expect(page.locator(".update-prompt")).toBeVisible();
}

async function assertPromptFits(page: Page) {
  await page.locator(".update-prompt").evaluate(async (element) => {
    await Promise.all(element.getAnimations().map((animation) => animation.finished));
  });
  const button = page.locator(".update-prompt").getByRole("button", { name: "更新", exact: true });
  await expect(button).toBeEnabled();
  const bounds = (await page.locator(".update-prompt").boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

async function seedOfflineRecords(page: Page) {
  await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolveDatabase, reject) => {
      const request = indexedDB.open("huddletab:pwa-user", 1);
      request.onsuccess = () => resolveDatabase(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const transaction = database.transaction(["pending_mutations", "pending_attachments"], "readwrite");
      transaction.objectStore("pending_mutations").put({
        id: "offline-expense", userId: "pwa-user", activityId: "fixture-activity", kind: "CREATE_EXPENSE",
        payload: {}, status: "REJECTED", attemptCount: 1, nextAttemptAt: 0, createdAt: 1, updatedAt: 1,
      });
      transaction.objectStore("pending_attachments").put({
        id: "offline-receipt", userId: "pwa-user", activityId: "fixture-activity", mutationId: "offline-expense",
        clientAttachmentId: "offline-receipt", fileName: "receipt.png", mimeType: "image/png",
        blob: new Uint8Array([1, 2, 3]).buffer, status: "REJECTED", attemptCount: 1,
        nextAttemptAt: 0, createdAt: 1, updatedAt: 1,
      });
      await new Promise<void>((resolveWrite, reject) => {
        transaction.oncomplete = () => resolveWrite();
        transaction.onerror = () => reject(transaction.error);
      });
    } finally {
      database.close();
    }
  });
}

async function offlineRecords(page: Page) {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolveDatabase) => {
      const request = indexedDB.open("huddletab:pwa-user", 1);
      request.onsuccess = () => resolveDatabase(request.result);
    });
    const readAll = (name: string) => new Promise<Array<Record<string, unknown>>>((resolveRead) => {
      const request = database.transaction(name).objectStore(name).getAll();
      request.onsuccess = () => resolveRead(request.result);
    });
    try {
      const mutations = await readAll("pending_mutations");
      const attachments = (await readAll("pending_attachments")).map((record) => ({
        ...record, blob: Array.from(new Uint8Array(record.blob as ArrayBuffer)),
      }));
      return { mutations, attachments };
    } finally {
      database.close();
    }
  });
}

test("有未同步数据和编辑草稿时，手动更新真正切换 Service Worker 并保留本地记录", async ({ page }, testInfo) => {
  await startApp(page);
  await seedOfflineRecords(page);
  const records = await offlineRecords(page);
  await page.getByLabel("当前密码", { exact: true }).fill("draft-only");
  await installUpdate(page);
  await expect(page.locator(".update-prompt")).toContainText("编辑完成后自动更新");
  await assertPromptFits(page);
  await page.screenshot({ path: testInfo.outputPath("update-light.png") });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.screenshot({ path: testInfo.outputPath("update-dark.png") });
  await page.locator(".update-prompt").getByRole("button", { name: "更新", exact: true }).focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("alertdialog", { name: "更新" });
  await expect(dialog).toContainText("未保存内容将丢失");
  await expect(dialog).toContainText("离线账单和附件保留");
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  expect(await activeRevision(page)).toBe(0);
  await page.locator(".update-prompt").getByRole("button", { name: "更新", exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath("update-confirmation.png") });
  const navigation = page.waitForEvent("framenavigated", { predicate: (frame) => frame === page.mainFrame() });
  await dialog.getByRole("button", { name: "更新", exact: true }).click();
  await navigation;
  await expect(page.getByRole("heading", { name: "修改密码" })).toBeVisible();
  expect(await activeRevision(page)).toBe(1);
  await expect(page.getByLabel("当前密码", { exact: true })).toBeEmpty();
  expect(await offlineRecords(page)).toEqual(records);
});

test("安全状态下等待十秒后自动激活新版并刷新", async ({ page }) => {
  await startApp(page);
  await installUpdate(page);
  await expect(page.locator(".update-prompt")).toContainText("稍后自动更新");
  const start = Date.now();
  await page.waitForTimeout(1_000);
  expect(await activeRevision(page)).toBe(0);
  await page.waitForEvent("framenavigated", { predicate: (frame) => frame === page.mainFrame(), timeout: 20_000 });
  expect(Date.now() - start).toBeGreaterThanOrEqual(9_000);
  await expect(page.getByRole("heading", { name: "修改密码" })).toBeVisible();
  expect(await activeRevision(page)).toBe(1);
});
