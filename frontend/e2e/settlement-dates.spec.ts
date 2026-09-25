import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { installTravelFixture } from './fixtures/activity-travel';

/** 接口夹具只测试界面如何使用服务端范围结果，账务算法另由真实 PostgreSQL 测试验证。 */
async function installDates(page: Page, zeroNet = false) {
  const fixture = await installTravelFixture(page);
  fixture.members.splice(2);
  fixture.records.splice(0);
  const template = fixture.expenses[0];
  const bills = [
    { date: '2026-09-20', amount: 10000 },
    { date: '2026-09-22', amount: zeroNet ? -10000 : -4000 },
    { date: '2026-09-24', amount: 2500 },
  ];
  fixture.expenses.splice(0, fixture.expenses.length, ...bills.map((bill, i) => ({
    ...template, expense: { ...template.expense, expenseId: `d${i}`, title: ['湖边午餐', '返程车费', '机场早餐'][i], occurredAt: `${bill.date}T04:00:00Z`, baseAmountMinor: String(Math.abs(bill.amount)), originalAmountMinor: String(Math.abs(bill.amount)) },
    payments: [{ memberId: bill.amount > 0 ? 'm1' : 'm0', baseAmountMinor: String(Math.abs(bill.amount)), originalAmountMinor: String(Math.abs(bill.amount)) }],
    shares: [{ memberId: bill.amount > 0 ? 'm0' : 'm1', baseAmountMinor: String(Math.abs(bill.amount)), originalAmountMinor: String(Math.abs(bill.amount)) }],
  })));
  const control = { writes: [] as Record<string, any>[], expired: false };
  await page.route('**/api/activities/travel/**', async route => {
    const endpoint = new URL(route.request().url()).pathname.split('/').at(-1);
    if (!['settlement-preview', 'offset-confirmations', 'settlements'].includes(endpoint!) || (endpoint === 'settlements' && route.request().method() === 'GET')) { await route.fallback(); return; }
    const body = route.request().postDataJSON();
    const scope = body.scope ?? body;
    const selected = bills.filter(bill => !scope.dates || scope.dates.includes(bill.date));
    const total = selected.reduce((sum, bill) => sum + bill.amount, 0);
    if (endpoint === 'settlement-preview') {
      const recommendations = total ? [{ payerMemberId: total > 0 ? 'm0' : 'm1', receiverMemberId: total > 0 ? 'm1' : 'm0', amountMinor: String(Math.abs(total)) }] : [];
      const pendingOffsets = !total && selected.some(bill => bill.amount !== 0);
      await route.fulfill({ json: { data: {
        scope: { ...scope, revision: fixture.activity.revision }, revision: fixture.activity.revision, baseCurrency: 'CNY',
        dateOptions: bills.map(bill => ({ date: bill.date, expenseCount: 1 })), expenseIds: selected.map(bill => `d${bills.indexOf(bill)}`),
        balances: [{ memberId: 'm0', netMinor: String(-total) }, { memberId: 'm1', netMinor: String(total) }], recommendations,
        effectiveStrategy: scope.strategy === 'centralized' ? 'CENTRALIZED' : 'MIN_TRANSFERS', hubMemberId: scope.hubMemberId ?? null,
        requiresOffsetConfirmation: pendingOffsets, settled: !total && !pendingOffsets, offsetMinor: pendingOffsets ? '20000' : '0', offsetExpenseCount: pendingOffsets ? 2 : 0,
      } } }); return;
    }
    control.writes.push(body);
    if (control.expired) { await route.fulfill({ status: 409, json: { error: { code: 'SETTLEMENT_PREVIEW_EXPIRED', message: '结算预览已过期，请刷新后重新确认' } } }); return; }
    let remaining = endpoint === 'offset-confirmations' ? 0 : total - Number(body.amountMinor) * (total < 0 ? -1 : 1);
    selected.forEach((bill, i) => { bill.amount = i === 0 ? remaining : 0; });
    fixture.activity.revision = String(Number(fixture.activity.revision) + 1);
    if (endpoint === 'settlements') {
      const record = { ...body, activityId: 'travel', settlementId: `s${fixture.records.length}`, status: 'ACTIVE', createdAt: '2026-09-25T06:30:00Z', version: '1', allocations: [], scopeDates: selected.map(bill => bill.date), scopeExpenseIds: selected.map(bill => `d${bills.indexOf(bill)}`) };
      fixture.records.push(record);
      await route.fulfill({ json: { data: { settlement: record, idempotentReplay: false } } });
    } else await route.fulfill({ json: { data: { confirmationId: 'offset1', revision: fixture.activity.revision, idempotentReplay: false } } });
  });
  return control;
}

async function choose(page: Page, dates: string[]) {
  await page.getByRole('button', { name: '结算日期', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '结算日期' });
  await dialog.getByRole('button', { name: '清空', exact: true }).click();
  for (const date of dates) await dialog.getByRole('checkbox', { name: new RegExp(date.replaceAll('-', '/')) }).check();
  return dialog;
}

async function capture(page: Page, info: TestInfo, name: string) {
  if (await page.getByRole('dialog').count()) {
    await expect.poll(() => page.getByRole('dialog').evaluate(element => {
      const rect = element.getBoundingClientRect();
      return rect.top >= 0 && rect.bottom <= innerHeight + 1 && getComputedStyle(element).opacity === '1';
    })).toBe(true);
  }
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: `artifacts/date-settlement/${info.project.name}-${name}.png`, scale: 'css' });
}

test('日期多选：取消、空选择、跨页保留、100与60、部分付款和范围结清', async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const control = await installDates(page);
  await page.goto('/activities/travel/settlement');
  let dialog = await choose(page, []);
  await expect(dialog.getByRole('button', { name: '应用日期' })).toBeDisabled();
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByRole('button', { name: '结算日期', exact: true })).toContainText('全部日期');
  dialog = await choose(page, ['2026-09-20']);
  await dialog.getByRole('button', { name: '应用日期' }).click();
  await expect(page.getByRole('region', { name: '我的结算' })).toContainText('¥100.00');
  await page.getByRole('button', { name: '返回流水' }).click();
  await page.getByRole('link', { name: '结算', exact: true }).click();
  await expect(page.getByRole('button', { name: '结算日期', exact: true })).toContainText('已选 1 天 · 1 笔账单');
  dialog = await choose(page, ['2026-09-20', '2026-09-22']);
  await capture(page, info, 'date-picker');
  await dialog.getByRole('button', { name: '应用日期' }).click();
  await expect(page.getByRole('region', { name: '我的结算' })).toContainText('¥60.00');
  await capture(page, info, 'recommendations');
  await page.getByRole('button', { name: '记录 小林付给小王', exact: true }).click();
  let form = page.getByRole('form', { name: '记录推荐转账' });
  await expect(form).toContainText('2026/09/20、2026/09/22');
  await capture(page, info, 'transfer-form');
  await form.getByLabel('金额（CNY）').fill('20');
  await form.getByRole('button', { name: '记录结算', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('region', { name: '我的结算' })).toContainText('¥40.00');
  expect(control.writes[0]).toMatchObject({ amountMinor: '2000', scope: { dates: ['2026-09-20', '2026-09-22'], timeZone: 'Asia/Shanghai', revision: '1' } });
  await page.getByRole('button', { name: '记录 小林付给小王', exact: true }).click();
  form = page.getByRole('form', { name: '记录推荐转账' });
  await form.getByRole('button', { name: '记录结算', exact: true }).click();
  await expect(page.getByText('所选日期已结清', { exact: true })).toBeVisible();
  await capture(page, info, 'settled');
  dialog = await choose(page, ['2026-09-24']);
  await dialog.getByRole('button', { name: '应用日期' }).click();
  await expect(page.getByRole('region', { name: '我的结算' })).toContainText('¥25.00');
  await expect(page.locator('.settlement-record')).toHaveCount(2);
});

test('无现金抵销必须确认，过期转账不能静默使用新金额', async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const control = await installDates(page, true);
  await page.goto('/activities/travel/settlement');
  const dialog = await choose(page, ['2026-09-20', '2026-09-22']);
  await dialog.getByRole('button', { name: '应用日期' }).click();
  await expect(page.getByRole('button', { name: '确认抵销', exact: true })).toBeVisible();
  expect(control.writes).toHaveLength(0);
  await capture(page, info, 'confirm-offset');
  await page.getByRole('button', { name: '确认抵销', exact: true }).click();
  await expect(page.getByText('所选日期已结清', { exact: true })).toBeVisible();
  await expect(page.locator('.settlement-record')).toHaveCount(0);
  const next = await choose(page, ['2026-09-24']);
  await next.getByRole('button', { name: '应用日期' }).click();
  control.expired = true;
  await page.getByRole('button', { name: '记录 小林付给小王', exact: true }).click();
  const form = page.getByRole('form', { name: '记录推荐转账' });
  await form.getByRole('button', { name: '记录结算', exact: true }).click();
  await expect(form.getByRole('button', { name: '刷新结算预览' })).toBeVisible();
  await expect(form.getByRole('button', { name: '记录结算', exact: true })).toHaveCount(0);
  expect(control.writes).toHaveLength(2);
  await form.getByRole('button', { name: '刷新结算预览' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('全选恢复全部日期，离线使用全活动快照并禁用范围写入', async ({ page }) => {
  const control = await installDates(page);
  await page.goto('/activities/travel/settlement');
  let dialog = await choose(page, ['2026-09-20']);
  await dialog.getByRole('button', { name: '全选', exact: true }).click();
  await expect(dialog.getByRole('checkbox', { checked: true })).toHaveCount(3);
  await dialog.getByRole('button', { name: '应用日期' }).click();
  await expect(page.getByRole('button', { name: '结算日期', exact: true })).toContainText('全部日期');
  dialog = await choose(page, ['2026-09-20']);
  await dialog.getByRole('button', { name: '应用日期' }).click();
  await expect(page.getByRole('region', { name: '我的结算' })).toContainText('¥100.00');
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await expect(page.getByRole('button', { name: '结算日期', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '结算日期', exact: true })).toContainText('全部日期 · 离线快照');
  await expect(page.getByRole('region', { name: '我的结算' })).toContainText('¥85.00');
  await expect(page.getByRole('button', { name: /^(记录 |确认抵销)/ })).toHaveCount(0);
  expect(control.writes).toHaveLength(0);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.getByRole('region', { name: '我的结算' })).toContainText('¥100.00');
});
