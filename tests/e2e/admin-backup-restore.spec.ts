import { expect, test } from "@playwright/test";

test("管理员备份页要求明确确认后才创建备份", async ({ page }) => {
  let created = false;
  await page.route("**/api/admin/backups", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ data: [] }),
      });
      return;
    }
    const body = route.request().postDataJSON() as { confirmed?: boolean };
    created = body.confirmed === true;
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          id: "backup-1",
          filename: "backup_1_test.tar.gz",
          sizeBytes: "125",
          checksum: "a".repeat(64),
          status: "READY",
          createdAt: "2026-08-27T00:00:00.000Z",
        },
      }),
    });
  });

  await page.goto("/admin/backups");
  await expect(page.getByRole("heading", { name: "备份与恢复" })).toBeVisible();
  await expect(page.getByText("暂无可用备份。")).toBeVisible();

  await page.getByRole("button", { name: "创建备份" }).click();
  await expect(page.getByRole("alertdialog")).toContainText("创建完整备份");
  await page.getByRole("button", { name: "确认创建" }).click();

  await expect.poll(() => created).toBe(true);
  await expect(page.getByText("backup_1_test.tar.gz")).toBeVisible();
});

test("恢复操作先显示不可逆确认，取消时不发送恢复请求", async ({ page }) => {
  let restoreRequested = false;
  await page.route("**/api/admin/backups", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        data: [
          {
            id: "backup-1",
            filename: "backup_1_test.tar.gz",
            sizeBytes: "125",
            checksum: "a".repeat(64),
            status: "READY",
            createdAt: "2026-08-27T00:00:00.000Z",
          },
        ],
      }),
    });
  });
  await page.route("**/api/admin/backups/backup-1/restore", async (route) => {
    restoreRequested = true;
    await route.fulfill({
      status: 200,
      body: JSON.stringify({ data: { restored: true } }),
    });
  });

  await page.goto("/admin/backups");
  await page.getByRole("button", { name: "恢复" }).click();
  await expect(page.getByRole("alertdialog")).toContainText(
    "恢复会覆盖当前数据库和上传文件",
  );
  await page.getByRole("button", { name: "取消" }).click();

  expect(restoreRequested).toBe(false);
});
