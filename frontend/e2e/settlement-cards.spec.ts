import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { installTravelFixture } from './fixtures/activity-travel';

/** 使用现有服务端响应形状验证视觉和交互，不在浏览器夹具中重新实现结算算法。 */
async function installCards(page: Page) {
  const fixture = await installTravelFixture(page, 1);
  fixture.control.overrideBalances = [-6000, 6000, 0, 0, 0, 0];
  const first = fixture.records[0];
  Object.assign(first, { createdAt: '2026-09-25T06:30:00Z', scopeDates: ['2026-09-20', '2026-09-22'], scopeExpenseIds: ['e1', 'e2'], scope: { dates: ['2026-09-20', '2026-09-22'], timeZone: 'Asia/Shanghai', revision: '1' }, applications: [{ expenseId: 'e1', memberId: 'm0', amountMinor: '20000', origin: 'AUTO' }] });
  fixture.records.push({ ...first, settlementId: 's2', amountMinor: '8000', status: 'VOID', createdAt: '2026-09-24T05:00:00Z', ...{ scopeDates: ['2025-12-31', '2026-01-01', '2026-01-03'], scopeExpenseIds: ['e3', 'e4', 'e5'] } });
  fixture.records.push({ ...first, settlementId: 's3', amountMinor: '5000', createdAt: '2026-09-23T05:00:00Z', ...{ scopeDates: [], scopeExpenseIds: [], scope: null, applications: [] } });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  return fixture;
}

async function screenshot(page: Page, info: TestInfo, name: string) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: `artifacts/settlement-cards/${info.project.name}-${name}.png`, fullPage: true, scale: 'css', animations: 'disabled' });
}

test('轻分组卡片：历史展开、菜单修改作废、焦点恢复与截图', async ({ page }, info) => {
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
  const details = first.getByRole('button', { name: /结算 9\/20、9\/22/ });
  await details.focus(); await page.keyboard.press('Enter');
  await expect(details).toHaveAttribute('aria-expanded', 'true');
  await expect(first.getByText('自动清偿 1 笔账单')).toBeVisible();
  await expect(first.getByText(/结算日期：2026\/09\/20、2026\/09\/22/)).toBeVisible();
  await screenshot(page, info, 'details');
  await details.press('Space');
  await expect(details).toHaveAttribute('aria-expanded', 'false');
  const old = history.locator('[data-reading-key="record-s3"]');
  await expect(old.getByRole('button', { name: '未记录日期范围' })).toBeVisible();
  const voided = history.locator('[data-reading-key="record-s2"]');
  await expect(voided.getByText('已作废', { exact: true })).toBeVisible();
  await expect(voided.getByRole('button', { name: '结算记录操作' })).toHaveCount(0);
  await voided.getByRole('button', { name: '结算 3 天 · 3 笔' }).click();
  await expect(voided.getByText(/2025\/12\/31、2026\/01\/01、2026\/01\/03/)).toBeVisible();
  await voided.getByRole('button', { name: '结算 3 天 · 3 笔' }).click();
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
