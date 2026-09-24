import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { installTravelFixture } from './fixtures/activity-travel';

type Metrics = { clicks: number; pageChanges: number; pageScroll: number; panelScroll: number; started: number };
declare global { interface Window { travelMetrics: Metrics; } }

/** 记录浏览器事件与实际滚动，耗时只描述自动化执行，不冒充真人任务时间。 */
async function measure(page: Page) {
  await page.evaluate(() => {
    window.travelMetrics = { clicks: 0, pageChanges: 0, pageScroll: 0, panelScroll: 0, started: performance.now() };
    let lastY = scrollY;
    const panelPositions = new WeakMap<Element, number>();
    document.addEventListener('click', () => { window.travelMetrics.clicks++; }, true);
    document.addEventListener('scroll', event => {
      if (event.target === document) { window.travelMetrics.pageScroll += Math.abs(scrollY - lastY); lastY = scrollY; }
      else if (event.target instanceof Element && event.target.closest('[aria-modal="true"]')) {
        const old = panelPositions.get(event.target) ?? 0;
        window.travelMetrics.panelScroll += Math.abs(event.target.scrollTop - old);
        panelPositions.set(event.target, event.target.scrollTop);
      }
    }, true);
    let path = location.pathname;
    for (const method of ['pushState', 'replaceState'] as const) {
      const original = history[method].bind(history);
      history[method] = (...args: Parameters<History['pushState']>) => {
        const previous = location.pathname; original(...args);
        if (previous !== location.pathname) window.travelMetrics.pageChanges++;
        path = location.pathname;
      };
    }
    addEventListener('popstate', () => { if (path !== location.pathname) window.travelMetrics.pageChanges++; path = location.pathname; });
  });
}
async function evidence(page: Page, info: TestInfo, name: string, extra: Record<string, unknown> = {}) {
  const values = await page.evaluate(() => ({ ...window.travelMetrics, automationMs: Math.round(performance.now() - window.travelMetrics.started) }));
  await info.attach(`${name}-metrics`, { body: JSON.stringify({ ...values, ...extra }, null, 2), contentType: 'application/json' });
  await page.screenshot({ path: info.outputPath(`${name}.png`) });
}
async function openFeed(page: Page) {
  await page.clock.setFixedTime(new Date('2026-09-24T12:00:00+08:00'));
  await page.goto('/activities/travel');
  await expect(page.locator('.expense-row')).toHaveCount(30);
  await expect(page.locator('.personal-balance')).toContainText('¥680.00');
}
async function recordManual(page: Page, payer: string, receiver: string, amount: string) {
  const entry = page.getByRole('button', { name: '补记结算', exact: true });
  await entry.scrollIntoViewIfNeeded();
  const before = (await entry.boundingBox())!.y;
  await entry.click();
  const form = page.getByRole('form', { name: '补记结算' });
  await form.getByRole('button', { name: '付款人：请选择' }).click();
  await form.getByRole('button', { name: payer, exact: true }).click();
  await form.getByRole('button', { name: '收款人：请选择' }).click();
  await form.getByRole('button', { name: receiver, exact: true }).click();
  await form.getByLabel('金额（CNY）').fill(amount);
  await form.getByRole('button', { name: '记录结算', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect.poll(async () => Math.abs((await entry.boundingBox())!.y - before)).toBeLessThanOrEqual(2);
  return Math.abs((await entry.boundingBox())!.y - before);
}

test('旅行流程一：连续记三笔并找回昨天晚餐，关闭编辑保留条件和位置', async ({ page }, info) => {
  const fixture = await installTravelFixture(page);
  await openFeed(page);
  await page.screenshot({ path: info.outputPath('travel-home.png') });
  await measure(page);
  for (const [title, amount] of [['早餐', '180'], ['打车', '60'], ['水果', '36']]) {
    await page.getByRole('button', { name: '记一笔', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '记一笔', exact: true });
    await dialog.getByLabel('金额', { exact: true }).fill(amount);
    await dialog.getByLabel('用途').fill(title);
    await dialog.getByRole('button', { name: '保存', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }
  await expect(page.locator('.expense-row')).toHaveCount(33);
  // 保存可先进入既有本地队列；等待三笔同步后再检查接口夹具的分摊事实。
  await expect.poll(() => fixture.expenses.slice(0, 3).map(e => e.shares.length)).toEqual([6, 6, 6]);
  await page.getByRole('button', { name: '搜索', exact: true }).click();
  const search = page.getByRole('textbox', { name: '搜索用途或备注' });
  await search.fill('古城晚餐'); await search.press('Enter');
  await page.getByRole('button', { name: '筛选', exact: true }).click();
  await page.getByRole('button', { name: '餐饮', exact: true }).click();
  await page.getByRole('button', { name: '应用筛选' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const row = page.locator('[data-reading-key="e24"]');
  const before = (await row.boundingBox())!.y;
  await row.click();
  await expect(page.getByRole('dialog', { name: '修改账单' })).toBeVisible();
  await page.getByRole('button', { name: '关闭修改账单' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(search).toHaveValue('古城晚餐');
  await expect(page.getByRole('button', { name: '移除餐饮' })).toBeVisible();
  await expect.poll(async () => Math.abs((await row.boundingBox())!.y - before)).toBeLessThanOrEqual(2);
  await evidence(page, info, 'flow-1', { anchorError: Math.abs((await row.boundingBox())!.y - before) });
});

test('旅行流程二：普通成员记录部分付款，权威响应从680更新为480', async ({ page }, info) => {
  const fixture = await installTravelFixture(page);
  await openFeed(page); await measure(page);
  await page.getByRole('link', { name: '结算', exact: true }).click();
  await expect(page.getByRole('region', { name: '我的结算' })).toContainText('¥680.00');
  await page.screenshot({ path: info.outputPath('travel-settlement.png') });
  const transfer = page.locator('[data-reading-key="transfer-m0-m1"]');
  const before = (await transfer.boundingBox())!.y;
  await page.getByRole('button', { name: '记录 小林付给小王', exact: true }).click();
  const form = page.getByRole('form', { name: '记录推荐转账' });
  await form.getByLabel('金额（CNY）').fill('200');
  await page.screenshot({ path: info.outputPath('travel-partial-payment.png') });
  await form.getByRole('button', { name: '记录结算', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('region', { name: '我的结算' })).toContainText('¥480.00');
  await expect.poll(async () => Math.abs((await transfer.boundingBox())!.y - before)).toBeLessThanOrEqual(2);
  const anchorError = Math.abs((await transfer.boundingBox())!.y - before);
  expect(fixture.control.writes).toHaveLength(1);
  expect(fixture.control.writes[0]).toMatchObject({ amountMinor: '20000', allocations: [] });
  await page.getByRole('button', { name: '返回流水' }).click();
  await expect(page.locator('.personal-balance')).toContainText('¥480.00');
  await evidence(page, info, 'flow-2', { anchorError });
});

test('旅行流程三：组织者原地查看六人余额并连续补记三笔付款', async ({ page }, info) => {
  const fixture = await installTravelFixture(page, 1);
  await page.goto('/activities/travel');
  await expect(page.locator('.expense-row')).toHaveCount(30);
  await measure(page);
  await page.getByRole('link', { name: '结算', exact: true }).click();
  await page.getByRole('button', { name: '成员余额', exact: true }).click();
  await expect(page.locator('.settlement-balance-list .balance-row')).toHaveCount(6);
  await page.screenshot({ path: info.outputPath('travel-member-balances.png') });
  let anchorError = 0;
  for (const [payer, receiver, amount] of [['小林', '小王', '200'], ['小陈', '小王', '320'], ['小赵', '小刘', '450']]) {
    anchorError = Math.max(anchorError, await recordManual(page, payer, receiver, amount));
    await expect(page.getByRole('button', { name: '成员余额', exact: true })).toHaveAttribute('aria-expanded', 'true');
    await expect(page).toHaveURL('/activities/travel/settlement');
  }
  expect(fixture.balances().map(b => Number(b.netMinor) / 100)).toEqual([-480, 300, 180, 0, 0, 0]);
  await expect(page.locator('.settlement-record')).toHaveCount(4);
  await expect(page.getByText('与我有关', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('region', { name: '我的结算' })).toContainText('¥300.00');
  await evidence(page, info, 'flow-3', { anchorError });
});

test('长流水与结算往返恢复账单锚点，关闭只读面板保持位置', async ({ page }, info) => {
  const fixture = await installTravelFixture(page);
  await openFeed(page);
  await page.evaluate(() => scrollTo(0, 1150));
  const anchor = await page.locator('.expense-row').evaluateAll(rows => {
    const row = rows.find(r => r.getBoundingClientRect().top >= 64)!;
    return { key: row.getAttribute('data-reading-key'), top: row.getBoundingClientRect().top };
  });
  await page.getByRole('link', { name: '结算', exact: true }).click();
  await page.getByRole('button', { name: '成员余额', exact: true }).click();
  await page.getByRole('button', { name: '返回流水' }).click();
  const row = page.locator(`[data-reading-key="${anchor.key}"]`);
  await expect.poll(async () => Math.abs((await row.boundingBox())!.y - anchor.top)).toBeLessThanOrEqual(2);
  await page.screenshot({ path: info.outputPath('restored-long-feed.png') });
  await info.attach('return-position', { body: JSON.stringify({ anchor, errorPx: Math.abs((await row.boundingBox())!.y - anchor.top) }), contentType: 'application/json' });
  await page.getByRole('link', { name: '结算', exact: true }).click();
  await expect(page.getByRole('button', { name: '成员余额', exact: true })).toHaveAttribute('aria-expanded', 'true');
  await page.goBack();
  await expect.poll(async () => Math.abs((await row.boundingBox())!.y - anchor.top)).toBeLessThanOrEqual(2);
  fixture.activity.status = 'ENDED';
  await page.goto('/activities/travel');
  await expect(page.locator('.expense-row')).toHaveCount(30);
  await page.evaluate(() => scrollTo(0, 800));
  const readonlyRow = page.locator('.expense-row').nth(10);
  await readonlyRow.scrollIntoViewIfNeeded();
  const before = (await readonlyRow.boundingBox())!.y;
  await readonlyRow.click();
  await expect(page.getByRole('dialog', { name: '账单详情' })).toBeVisible();
  await page.getByRole('button', { name: '关闭账单详情' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect.poll(async () => Math.abs((await readonlyRow.boundingBox())!.y - before)).toBeLessThanOrEqual(2);
});

test('三个独立玻璃按钮：宽度、末行避让、键盘和生命周期', async ({ page }, info) => {
  const fixture = await installTravelFixture(page);
  await openFeed(page);
  const buttons = page.locator('.activity-floating-action');
  await expect(buttons).toHaveCount(3);
  await expect(page.getByRole('button', { name: '智能录入' })).toHaveText('');
  await expect(page.locator('.activity-ai-icon')).toBeVisible();
  const boxes = await buttons.evaluateAll(items => items.map(item => { const r = item.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }));
  expect(boxes[0].width).toBeGreaterThanOrEqual(44);
  expect(boxes[1].width).toBeGreaterThan(boxes[2].width);
  expect(boxes[2].width).toBeGreaterThan(boxes[0].width);
  expect(boxes.every(b => b.height >= 56)).toBe(true);
  expect(Math.abs(boxes[1].x - boxes[0].x - boxes[0].width - 12)).toBeLessThan(1);
  await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
  await expect.poll(async () => (await page.locator('.expense-row').last().boundingBox())!.y + (await page.locator('.expense-row').last().boundingBox())!.height).toBeLessThanOrEqual(boxes[0].y - 12);
  expect(await page.evaluate(({ x, y }) => !document.elementFromPoint(x, y)?.closest('.activity-floating-actions'), { x: boxes[0].x + boxes[0].width + 6, y: boxes[0].y + 20 })).toBe(true);
  await page.screenshot({ path: info.outputPath('last-bill-clear.png') });
  await page.evaluate(() => { document.documentElement.style.fontSize = '32px'; document.documentElement.classList.add('dark'); document.documentElement.style.setProperty('--safe-area-bottom', '34px'); });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await expect(buttons).toHaveCount(3);
  await page.screenshot({ path: info.outputPath('floating-large-dark.png') });
  await page.emulateMedia({ reducedMotion: 'reduce', contrast: 'more' });
  await expect(page.locator('.activity-floating-action--manual')).toHaveCSS('backdrop-filter', 'none');
  await page.screenshot({ path: info.outputPath('floating-high-contrast.png') });
  await page.emulateMedia({ reducedMotion: 'no-preference', contrast: 'no-preference' });
  await page.evaluate(() => { document.documentElement.style.fontSize = ''; document.documentElement.classList.remove('dark'); });
  await page.getByRole('button', { name: '搜索', exact: true }).click();
  if (info.project.name !== 'chromium-desktop') await expect(page.locator('.activity-floating-actions')).toBeHidden();
  await page.getByRole('textbox', { name: '搜索用途或备注' }).press('Enter');
  await expect(page.locator('.activity-floating-actions')).toBeVisible();
  fixture.control.aiAvailable = false; await page.reload();
  await expect(page.locator('.activity-floating-action--ai')).toHaveCount(0);
  expect((await page.locator('.activity-floating-action--manual').boundingBox())!.x).toBeCloseTo(boxes[1].x, 0);
  fixture.activity.status = 'ENDED'; await page.reload();
  await expect(buttons).toHaveCount(1);
  await page.getByRole('link', { name: '结算', exact: true }).click();
  await expect(page.getByRole('button', { name: '补记结算', exact: true })).toBeVisible();
  fixture.activity.status = 'ARCHIVED'; await page.reload();
  await expect(page.getByRole('button', { name: '补记结算', exact: true })).toHaveCount(0);
  await expect(page.locator('.settlement-record')).toHaveCount(1);
});

test('个人余额为零仍显示统一收付任务，全员归零才显示全员已结清', async ({ page }) => {
  const fixture = await installTravelFixture(page, 1);
  fixture.control.overrideBalances = [-10000, 0, 10000, 0, 0, 0];
  await page.goto('/activities/travel/settlement');
  await expect(page.getByRole('region', { name: '我的结算' })).toContainText('个人余额已平');
  await expect(page.getByText('全员余额已结清', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '更多操作' }).click();
  await page.getByRole('button', { name: '切换结算方案' }).click();
  await page.getByRole('radio', { name: /由我统一收付/ }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.settlement-recommendation-item')).toHaveCount(2);
  await expect(page.getByRole('button', { name: '记录 小王付给小李' })).toBeVisible();
  fixture.control.overrideBalances = [0, 0, 0, 0, 0, 0]; await page.reload();
  await expect(page.getByText('全员余额已结清', { exact: true })).toBeVisible();
  await expect(page.locator('.settlement-recommendation-item')).toHaveCount(0);
});

test('结算失败保留输入，提交期间阻止关闭与重复付款', async ({ page }) => {
  const fixture = await installTravelFixture(page);
  fixture.control.failWrite = true; fixture.control.writeDelay = 800;
  await page.goto('/activities/travel/settlement');
  await page.getByRole('button', { name: '记录 小林付给小王' }).click();
  const form = page.getByRole('form', { name: '记录推荐转账' });
  await form.getByLabel('金额（CNY）').fill('200');
  await form.getByRole('button', { name: '记录结算', exact: true }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '关闭记录推荐转账' }).click();
  await expect(form).toBeVisible();
  await expect(form.getByRole('alert')).toContainText('记录冲突');
  await expect(form.getByLabel('金额（CNY）')).toHaveValue('200');
  expect(fixture.control.writes).toHaveLength(1);
  fixture.control.failWrite = false;
  await form.getByRole('button', { name: '记录结算', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('region', { name: '我的结算' })).toContainText('¥480.00');
  expect(fixture.records).toHaveLength(2);
});

test('旧结算链接保留成员面板，离线结算继续展示只读记录', async ({ page }) => {
  await installTravelFixture(page);
  await page.goto('/activities/travel?tab=settlement&panel=members');
  await expect(page).toHaveURL('/activities/travel/settlement?panel=members');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: /^关闭/ }).click();
  await expect(page).toHaveURL('/activities/travel/settlement');
  await expect(page.locator('.settlement-record')).toHaveCount(1);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await expect(page.getByText(/当前离线，以下结算/)).toBeVisible();
  await expect(page.getByRole('button', { name: '补记结算', exact: true })).toHaveCount(0);
  await expect(page.locator('.settlement-record')).toHaveCount(1);
});

test('阅读中的账单被移除后返回相邻账单，长金额和个人应收仍可完整展示', async ({ page }, info) => {
  const fixture = await installTravelFixture(page);
  await openFeed(page);
  await page.evaluate(() => scrollTo(0, 1150));
  const anchor = await page.locator('.expense-row').evaluateAll(rows => {
    const edge = document.querySelector('.workspace-header')!.getBoundingClientRect().bottom;
    const i = rows.findIndex(row => row.getBoundingClientRect().bottom > edge);
    return { removed: rows[i].getAttribute('data-reading-key'), next: rows[i + 1].getAttribute('data-reading-key'), top: rows[i + 1].getBoundingClientRect().top };
  });
  await page.getByRole('link', { name: '结算', exact: true }).click();
  fixture.expenses.splice(fixture.expenses.findIndex(item => item.expense.expenseId === anchor.removed), 1);
  await recordManual(page, '小林', '小王', '200');
  await page.getByRole('button', { name: '返回流水' }).click();
  await expect(page.locator(`[data-reading-key="${anchor.removed}"]`)).toHaveCount(0);
  await expect.poll(async () => Math.abs((await page.locator(`[data-reading-key="${anchor.next}"]`).boundingBox())!.y - anchor.top)).toBeLessThanOrEqual(2);
  fixture.control.overrideBalances = [987654321012, -987654321012, 0, 0, 0, 0];
  await page.reload();
  await expect(page.locator('.personal-balance')).toContainText('我的应收');
  await expect(page.locator('.personal-balance')).toContainText('¥9,876,543,210.12');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: info.outputPath('long-receivable.png') });
});

test('完成的推荐消失后保持邻近转账位置和焦点，成员余额仍然展开', async ({ page }, info) => {
  const fixture = await installTravelFixture(page, 1);
  // 足够长的历史用于验证页面中段定位；已作废记录不影响夹具余额。
  fixture.records.push(...Array.from({ length: 12 }, (_, i) => ({ ...fixture.records[0], settlementId: `void-${i}`, status: 'VOID' })));
  await page.goto('/activities/travel/settlement');
  await page.getByRole('button', { name: '成员余额', exact: true }).click();
  const current = page.locator('[data-reading-key="transfer-m3-m5"]');
  await current.evaluate(row => scrollTo(0, scrollY + row.getBoundingClientRect().top - 56));
  const next = page.locator('[data-reading-key="transfer-m3-m2"]');
  const before = (await next.boundingBox())!.y;
  await current.getByRole('button').click();
  await page.getByRole('form').getByRole('button', { name: '记录结算', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(current).toHaveCount(0);
  await expect.poll(async () => Math.abs((await next.boundingBox())!.y - before)).toBeLessThanOrEqual(2);
  await expect(next.getByRole('button')).toBeFocused();
  await expect(page.getByRole('button', { name: '成员余额', exact: true })).toHaveAttribute('aria-expanded', 'true');
  await info.attach('completed-transfer-position', { body: JSON.stringify({ errorPx: Math.abs((await next.boundingBox())!.y - before), focusRestored: true }), contentType: 'application/json' });
});
