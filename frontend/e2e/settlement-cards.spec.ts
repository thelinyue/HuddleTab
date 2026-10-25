import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { installTravelFixture } from './fixtures/activity-travel';

/** 使用现有服务端响应形状验证视觉和交互，不在浏览器夹具中重新实现结算算法。 */
async function installCards(page: Page) {
  const fixture = await installTravelFixture(page, 1);
  fixture.control.overrideBalances = [-6000, 6000, 0, 0, 0, 0];
  const first = fixture.records[0];
  Object.assign(first, { createdAt: '2026-09-25T06:30:00Z', scopeDates: ['2026-09-20', '2026-09-22'], scopeExpenseIds: ['e1', 'e2'], scope: { dates: ['2026-09-20', '2026-09-22'], timeZone: 'Asia/Shanghai', revision: '1' }, applications: ['m0', 'm1'].map(memberId => ({ expenseId: 'e1', memberId, amountMinor: '3000', origin: 'AUTO' })) });
  fixture.records.push({ ...first, settlementId: 's2', amountMinor: '8000', status: 'VOID', createdAt: '2026-09-24T05:00:00Z', ...{ scopeDates: ['2025-12-31', '2026-01-01', '2026-01-03'], scopeExpenseIds: ['e3', 'e4', 'e5'], applications: [] } });
  fixture.records.push({ ...first, settlementId: 's3', amountMinor: '5000', createdAt: '2026-09-23T05:00:00Z', ...{ scopeDates: [], scopeExpenseIds: [], scope: null, applications: [] } });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  return fixture;
}

async function screenshot(page: Page, info: TestInfo, name: string) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  for (const dialog of await page.getByRole('dialog').all()) {
    await expect(dialog).toHaveCSS('opacity', '1');
  }
  await page.screenshot({ path: `artifacts/settlement-cards/${info.project.name}-${name}.png`, fullPage: true, scale: 'css', animations: 'disabled' });
}

test('轻分组卡片：账单弹窗、菜单修改作废、焦点恢复与截图', async ({ page }, info) => {
  const fixture = await installCards(page);
  await page.goto('/activities/travel/settlement');
  const history = page.getByRole('region', { name: '全部结算记录' });
  await expect(history.locator('.settlement-record')).toHaveCount(3);
  await expect(page.getByRole('region', { name: '推荐转账' })).toContainText('1 笔');
  await expect(page.getByRole('button', { name: '切换结算方案' })).toContainText('最少转账');
  await expect(page.getByRole('button', { name: '修改', exact: true })).toHaveCount(0);
  const touchTargets = page.locator('.settlement-card button, .settlement-strategy-trigger');
  expect(await touchTargets.evaluateAll(buttons => buttons.every(button => {
    const bounds = button.getBoundingClientRect();
    return bounds.width >= 44 && bounds.height >= 44;
  }))).toBe(true);
  await screenshot(page, info, 'overview');
  const first = history.locator('[data-reading-key="record-s1"]');
  const details = first.getByRole('button', { name: /结算范围 9\/20、9\/22/ });
  await details.focus(); await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: '结算账单', exact: true });
  await expect(dialog.getByRole('heading', { name: '本次清偿涉及账单 · 1 笔' })).toBeVisible();
  await expect(dialog.locator('.settlement-transfer')).toHaveCount(0);
  await expect(dialog.getByText(/转账金额|结算日期：|记录于|自动清偿/)).toHaveCount(0);
  await expect(dialog.locator('.settlement-bill__title')).toHaveText(['早餐']);
  await expect(dialog).toContainText('账单总额');
  await expect(dialog).toContainText('本笔清偿涉及：小林、小王');
  await screenshot(page, info, 'details');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(details).toBeFocused();
  const old = history.locator('[data-reading-key="record-s3"]');
  await expect(old.getByRole('button', { name: '未记录日期范围' })).toBeVisible();
  const voided = history.locator('[data-reading-key="record-s2"]');
  await expect(voided.getByText('已作废', { exact: true })).toBeVisible();
  await expect(voided.getByRole('button', { name: '结算记录操作' })).toHaveCount(0);
  await voided.getByRole('button', { name: '结算范围 3 天 · 3 笔' }).click();
  await expect(dialog.locator('.settlement-bill')).toHaveCount(0);
  await expect(dialog).toContainText('已作废，不计入余额');
  await expect(dialog).toContainText('暂无具体清偿关联');
  await dialog.getByRole('button', { name: '关闭结算账单' }).click();
  await expect(dialog).toHaveCount(0);
  const menu = first.getByRole('button', { name: '结算记录操作' });
  await menu.click();
  await screenshot(page, info, 'menu');
  const beforeEdit = (await first.boundingBox())!.y;
  await page.getByRole('button', { name: '修改', exact: true }).click();
  let form = page.getByRole('form', { name: '修改结算' });
  await form.getByLabel('金额（CNY）').fill('150');
  await form.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(first).toContainText('¥150.00');
  await expect(menu).toBeFocused();
  await expect.poll(async () => Math.abs((await first.boundingBox())!.y - beforeEdit)).toBeLessThanOrEqual(2);
  await menu.click();
  const beforeVoid = (await first.boundingBox())!.y;
  await page.getByRole('button', { name: '作废', exact: true }).click();
  await page.getByRole('button', { name: '确认作废', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(first.getByText('已作废', { exact: true })).toBeVisible();
  await expect(details).toBeFocused();
  await expect.poll(async () => Math.abs((await first.boundingBox())!.y - beforeVoid)).toBeLessThanOrEqual(2);
  expect(fixture.control.writes).toHaveLength(2);
  const recommendation = page.getByRole('button', { name: '记录 小林付给小王', exact: true });
  await recommendation.press('Enter');
  const transferForm = page.getByRole('form', { name: '记录推荐转账' });
  await expect(transferForm.getByLabel('金额（CNY）')).toHaveValue('60.00');
  expect(fixture.control.writes).toHaveLength(2);
  await transferForm.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(recommendation).toBeFocused();
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await expect(page.getByRole('button', { name: '结算记录操作' })).toHaveCount(0);
});

test('历史结算账单：独立弹窗隔离范围、缺失提示、刷新及离线查看', async ({ page }, info) => {
  const fixture = await installCards(page);
  Object.assign(fixture.records[0], {
    scopeExpenseIds: ['e1', 'e2', 'missing-expense'],
    applications: ['e1', 'missing-expense', 'missing-expense'].map(expenseId => ({ expenseId, memberId: 'm0', amountMinor: '1000', origin: 'AUTO' })),
    allocations: [{ expenseId: 'e2', amountMinor: '1000' }],
  });
  await page.goto('/activities/travel/settlement');
  const first = page.locator('[data-reading-key="record-s1"]');
  const firstSummary = first.getByRole('button', { name: '结算范围 9/20、9/22 · 3 笔' });
  await firstSummary.click();
  const dialog = page.getByRole('dialog', { name: '结算账单', exact: true });
  await expect(dialog.locator('.settlement-bill__title')).toHaveText(['早餐', '打车']);
  await expect(dialog.getByRole('heading', { name: '本次清偿涉及账单 · 3 笔' })).toBeVisible();
  await expect(dialog.getByRole('status')).toHaveText('有 1 笔关联账单暂时无法读取。');
  await expect(dialog.getByText('明确归属', { exact: true })).toBeVisible();
  await screenshot(page, info, 'record-bills');
  await dialog.getByRole('button', { name: '关闭结算账单' }).click();
  await expect(dialog).toHaveCount(0);

  const voided = page.locator('[data-reading-key="record-s2"]');
  await voided.getByRole('button', { name: '结算范围 3 天 · 3 笔' }).click();
  await expect(dialog.locator('.settlement-bill')).toHaveCount(0);
  await expect(dialog).toContainText('已作废，不计入余额');
  await dialog.getByRole('button', { name: '关闭结算账单' }).click();
  await expect(dialog).toHaveCount(0);
  const old = page.locator('[data-reading-key="record-s3"]');
  await old.getByRole('button', { name: '未记录日期范围' }).click();
  await expect(dialog).toContainText('暂无具体清偿关联');
  await expect(dialog.locator('.settlement-bill')).toHaveCount(0);

  await page.reload();
  await firstSummary.click();
  await expect(dialog.locator('.settlement-bill__title')).toHaveText(['早餐', '打车']);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await expect(page.getByText('当前离线，以下结算使用最近一次同步的只读快照。')).toBeVisible();
  await expect(dialog.locator('.settlement-bill__title')).toHaveText(['早餐', '打车']);
  expect(fixture.control.writes).toHaveLength(0);
});

test('结算账单：排除仅在范围内的纯K，保留未参与消费的代收关联', async ({ page }) => {
  const fixture = await installCards(page);
  fixture.expenses[1].expense.title = '纯K';
  // e26 由小李付款、仅小林参与，小王虽未参与消费仍可作为代收人关联。
  Object.assign(fixture.records[0], {
    scopeExpenseIds: ['e1', 'e2', 'e26'],
    applications: ['e26', 'e1', 'e1'].map(expenseId => ({ expenseId, memberId: 'm0', amountMinor: '3000', origin: 'AUTO' })),
  });
  await page.goto('/activities/travel/settlement');
  await page.locator('[data-reading-key="record-s1"]').getByRole('button', { name: '结算范围 9/20、9/22 · 3 笔' }).click();
  const dialog = page.getByRole('dialog', { name: '结算账单', exact: true });
  await expect(dialog.getByRole('heading', { name: '本次清偿涉及账单 · 2 笔' })).toBeVisible();
  await expect(dialog.locator('.settlement-bill__title')).toHaveText(['早餐', '体验课程']);
  await expect(dialog.getByText('纯K', { exact: true })).toHaveCount(0);
  await expect(dialog.locator('.settlement-bill').filter({ hasText: '体验课程' })).toContainText('小李 付款 · 1 人参与');
  expect(fixture.control.writes).toHaveLength(0);
});

test('结算账单：读取失败可重试，不回退到范围冒充实际清偿', async ({ page }) => {
  const fixture = await installCards(page);
  let failed = true;
  await page.route('**/api/activities/travel/expenses', async route => {
    await route.fulfill(failed
      ? { status: 503, json: { error: { code: 'UNAVAILABLE', message: '账单读取失败' } } }
      : { json: { data: fixture.expenses } });
  });
  await page.goto('/activities/travel/settlement');
  await page.locator('[data-reading-key="record-s1"] .settlement-record__summary').click();
  const dialog = page.getByRole('dialog', { name: '结算账单', exact: true });
  await expect(dialog.getByRole('alert')).toContainText('账单读取失败', { timeout: 15_000 });
  failed = false;
  await dialog.getByRole('button', { name: '重试' }).click();
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await expect(dialog.locator('.settlement-bill__title')).toHaveText(['早餐']);
  await expect(dialog.getByRole('status')).toHaveCount(0);
  expect(fixture.control.writes).toHaveLength(0);
});

test('结算账单：旧离线快照缺少清偿字段时提示同步', async ({ page }) => {
  const fixture = await installCards(page);
  Reflect.deleteProperty(fixture.records[0], 'applications');
  await page.goto('/activities/travel/settlement');
  await page.locator('[data-reading-key="record-s1"] .settlement-record__summary').click();
  const dialog = page.getByRole('dialog', { name: '结算账单', exact: true });
  await expect(dialog).toContainText('具体清偿信息待同步，请联网后重试。');
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await expect(page.getByText('当前离线，以下结算使用最近一次同步的只读快照。')).toBeVisible();
  await expect(dialog).toContainText('具体清偿信息待同步，请联网后重试。');
  await expect(dialog.locator('.settlement-bill')).toHaveCount(0);
  await expect(dialog.getByText('暂无具体清偿关联', { exact: false })).toHaveCount(0);
  expect(fixture.control.writes).toHaveLength(0);
});

test('结算账单弹窗：59笔独立滚动、关闭可达且不改变历史列表位置', async ({ page }, info) => {
  const fixture = await installCards(page);
  const template = fixture.expenses[0];
  for (let index = 31; index <= 59; index++) {
    fixture.expenses.push({ ...template, expense: { ...template.expense, expenseId: `e${index}`, title: `核对账单${index}`, occurredAt: `2026-09-25T00:00:${index}Z` } });
  }
  Object.assign(fixture.records[0], {
    scopeExpenseIds: fixture.expenses.map(item => item.expense.expenseId),
    applications: fixture.expenses.map(item => ({ expenseId: item.expense.expenseId, memberId: 'm0', amountMinor: '100', origin: 'AUTO' })),
  });
  await page.goto('/activities/travel/settlement');
  const trigger = page.getByRole('button', { name: '结算范围 9/20、9/22 · 59 笔' });
  await trigger.scrollIntoViewIfNeeded();
  const before = (await trigger.boundingBox())!.y;
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: '结算账单', exact: true });
  await expect(dialog.locator('.settlement-bill')).toHaveCount(59);
  await expect(dialog.getByRole('heading', { name: '本次清偿涉及账单 · 59 笔' })).toBeVisible();
  await expect(page.locator('.settlement-record__details')).toHaveCount(0);
  expect(await dialog.evaluate(root => root.scrollWidth <= root.clientWidth + 1)).toBe(true);
  await screenshot(page, info, 'bills-long-list');
  const body = dialog.locator('.form-overlay__body');
  await body.evaluate(element => { element.scrollTop = element.scrollHeight; });
  await expect(dialog.getByText('核对账单59', { exact: true })).toBeInViewport();
  const close = dialog.getByRole('button', { name: '关闭结算账单' });
  await expect(close).toBeInViewport();
  await close.click();
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect.poll(async () => Math.abs((await trigger.boundingBox())!.y - before)).toBeLessThanOrEqual(2);
});

test('轻分组卡片：空态、长姓名、大金额、深色与只读状态', async ({ page }, info) => {
  const fixture = await installCards(page);
  fixture.records.splice(0);
  await page.goto('/activities/travel/settlement');
  await expect(page.getByText('还没有结算记录')).toBeVisible();
  await expect(page.locator('img[src*="settlement-history-empty"]')).toHaveCount(0);
  await screenshot(page, info, 'empty');
  fixture.members[0].displayName = '负责接送与酒店预订的超长姓名同行成员';
  fixture.members[1].displayName = 'AnotherVeryLongMemberNameWithoutSpaces';
  fixture.control.overrideBalances = [-999999999900, 999999999900, 0, 0, 0, 0];
  fixture.records.push({ settlementId: 'large', activityId: 'travel', payerMemberId: 'm0', receiverMemberId: 'm1', amountMinor: '999999999900', currency: 'CNY', status: 'ACTIVE', createdAt: '2026-09-25T06:30:00Z', version: '1', allocations: [] });
  await page.reload();
  await expect(page.locator('.settlement-recommendation-item')).toContainText('9,999,999,999.00');
  await expect.poll(() => page.locator('.settlement-card').evaluateAll(cards => cards.every(card => card.scrollWidth <= card.clientWidth + 1))).toBe(true);
  await screenshot(page, info, 'long-content');
  await page.emulateMedia({ colorScheme: 'dark' });
  await screenshot(page, info, 'dark');
  fixture.activity.status = 'ARCHIVED';
  await page.reload();
  await expect(page.getByRole('button', { name: '结算记录操作' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '记录其他转账' })).toHaveCount(0);
});
