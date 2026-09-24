import { expect, test, type Page } from '@playwright/test';

/** 确定性的前端验收数据，只拦截测试浏览器请求，不写入真实活动。 */
async function installFixture(page: Page, count = 4, shareMinor = 12000) {
  const members = Array.from({ length: count }, (_, index) => ({ activityId: 'demo', memberId: `m${index}`, displayName: ['小林', '小陈', '小周', '小王'][index] ?? `同行成员${index + 1}`, avatarPreset: index % 8, role: index ? 'MEMBER' : 'OWNER', status: 'ACTIVE', userId: `u${index}`, version: '1' }));
  const activity = { activityId: 'demo', name: '周末杭州小聚', baseCurrency: 'CNY', status: 'ACTIVE', startDate: '2026-09-05', endDate: '2026-09-06', coverPreset: 5, coverImageId: null, currentMemberId: 'm0', currentMemberRole: 'OWNER', ownerMemberId: 'm0', revision: '1', version: '1' };
  const balances = members.map((member, index) => ({ memberId: member.memberId, displayName: member.displayName, netMinor: index ? String(-shareMinor) : String((count - 1) * shareMinor) }));
  const recommendations = { recommendations: members.slice(1).map(member => ({ payerMemberId: member.memberId, receiverMemberId: 'm0', amountMinor: String(shareMinor) })) };
  const records = [{ settlementId: 's1', activityId: 'demo', payerMemberId: 'm1', receiverMemberId: 'm0', currency: 'CNY', amountMinor: '8000', status: 'ACTIVE', createdAt: '2026-09-06T06:30:00Z', version: '1' }, { settlementId: 's2', activityId: 'demo', payerMemberId: 'm2', receiverMemberId: 'm0', currency: 'CNY', amountMinor: '2000', status: 'VOID', createdAt: '2026-09-05T10:20:00Z', version: '1' }];
  const expenses = [{ expense: { expenseId: 'e1', activityId: 'demo', title: '湖边晚餐', note: '四个人一起吃杭帮菜', baseAmountMinor: '48000', originalAmountMinor: '48000', originalCurrency: 'CNY', baseCurrency: 'CNY', category: 'FOOD', occurredAt: '2026-09-05T10:00:00Z', exchangeRate: '1', splitMode: 'EQUAL', version: '1' }, payments: [{ memberId: 'm0', originalAmountMinor: '48000', baseAmountMinor: '48000' }], shares: members.map(member => ({ memberId: member.memberId, originalAmountMinor: '12000', baseAmountMinor: '12000' })), attachments: [{ id: 'a1', byteSize: '456', createdAt: '2026-09-05T10:01:00Z', height: 480, mimeType: 'image/webp', width: 640 }] }];
  const controls = { expenses, activityPending: false, historyPending: false, feedPending: false, snapshotPending: false, historyError: false, ledgerPending: false, failWrite: false, writes: [] as unknown[], summaryReads: 0, members, balances, activity };
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url()); const endpoint = url.pathname.split('/').at(-1);
    while ((endpoint === 'demo' && controls.activityPending) || (endpoint === 'settlements' && controls.historyPending) || (endpoint === 'expenses' && controls.feedPending) || (endpoint === 'snapshot' && controls.snapshotPending) || (endpoint === 'ledger' && controls.ledgerPending)) await new Promise(resolve => setTimeout(resolve, 30));
    if (endpoint === 'settlements' && controls.historyError) { await route.fulfill({ status: 503, json: { error: { message: '记录暂时无法读取' } } }); return; }
    if (route.request().method() !== 'GET') { controls.writes.push(route.request().postDataJSON()); await route.fulfill({ status: controls.failWrite ? 409 : 200, json: controls.failWrite ? { error: { message: '记录冲突，请重试' } } : { data: records[0] } }); return; }
    let data: unknown = [];
    if (endpoint === 'session') data = { userId: 'u0', username: 'demo', displayName: '小林', isSystemAdmin: false };
    else if (endpoint === 'csrf') data = { token: 'fixture' };
    else if (endpoint === 'demo') data = activity;
    else if (endpoint === 'members') data = members;
    else if (endpoint === 'expenses') data = expenses;
    else if (expenses.some(item => item.expense.expenseId === endpoint)) data = expenses.find(item => item.expense.expenseId === endpoint);
    else if (endpoint === 'ledger') data = { balances };
    else if (endpoint === 'recommendations') data = recommendations;
    else if (endpoint === 'settlements') data = records;
    else if (endpoint === 'snapshot') data = { activity, members, expenses, ledger: { balances }, recommendations, settlements: records, revision: '1' };
    else if (endpoint === 'summary') { controls.summaryReads++; data = { activityName: activity.name, currency: 'CNY', startDate: activity.startDate, endDate: activity.endDate, memberCount: count, participatingMemberCount: count, expenseCount: 1, totalExpenseMinor: String(count * shareMinor), averageExpenseMinor: String(shareMinor), currentUserBalanceMinor: balances[0].netMinor, balances, recommendations: recommendations.recommendations, originalCurrencyTotals: [], categoryTotals: [] }; }
    await route.fulfill({ json: { data }, headers: { etag: '"fixture-1"' } });
  });
  return controls;
}

async function fitsScreen(page: Page) {
  // WebKit 的动态视口和 ResizeObserver 在下一帧更新，验收最终稳定尺寸。
  await expect.poll(() => page.evaluate(() => {
    const card = document.querySelector('#share-summary-preview-card')!.getBoundingClientRect();
    const stage = document.querySelector('.share-summary-preview')!.getBoundingClientRect();
    return document.documentElement.scrollWidth <= innerWidth + 1 && document.documentElement.scrollHeight <= innerHeight + 1 && card.bottom <= stage.bottom + 1;
  })).toBeTruthy();
  const size = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight, vw: innerWidth, vh: innerHeight }));
  expect(size.width).toBeLessThanOrEqual(size.vw + 1);
  expect(size.height).toBeLessThanOrEqual(size.vh + 1);
  const card = page.locator('#share-summary-preview-card');
  const stage = page.locator('.share-summary-preview');
  const bounds = await card.boundingBox(); const area = await stage.boundingBox();
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(area!.y + area!.height + 1);
}

/** 只读验收复用现有入口，进度直接由夹具响应提供，不在页面重新计算。 */
async function installReadonlyFixture(page: Page) {
  const control = await installFixture(page, 5);
  control.activity.status = 'ENDED';
  const item = control.expenses[0]!;
  item.expense.note = '靠窗的桌子\n包含饮料';
  item.expense.splitMode = 'EXACT';
  item.shares[4]!.originalAmountMinor = '0';
  item.shares[4]!.baseAmountMinor = '0';
  const progress = {
    currency: 'CNY', status: 'PARTIALLY_SETTLED', totalRequiredMinor: '36000', settledMinor: '18000', remainingMinor: '18000',
    members: control.members.slice(0, 4).map((member, index) => ({
      memberId: member.memberId, direction: index ? 'PAYABLE' : 'RECEIVABLE',
      expectedMinor: index ? '12000' : '36000', settledMinor: ['18000', '6000', '12000', '0'][index],
      remainingMinor: ['18000', '6000', '0', '12000'][index], status: index === 2 ? 'SETTLED' : index < 2 ? 'PARTIALLY_SETTLED' : 'UNSETTLED',
    })),
  };
  Object.assign(item, { settlementProgress: progress });
  item.payments.forEach((payment, index) => Object.assign(payment, { factId: `payment-${index}` }));
  item.shares.forEach((share, index) => Object.assign(share, { factId: `share-${index}` }));
  await page.route('**/api/activities/demo/expenses/e1/attachments/**', route => route.fulfill({ path: 'public/expense-categories/food.webp', contentType: 'image/webp' }));
  return { ...control, progress };
}

async function readonlyFitsWidth(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  const detail = page.getByRole('region', { name: '账单详情', exact: true });
  expect(await detail.evaluate(root => [root, ...root.querySelectorAll('.expense-detail-fields, .expense-detail-member-row, .money, .expense-settlement-progress__table, .expense-settlement-progress__row')].every(element => element.clientWidth === 0 || element.scrollWidth <= element.clientWidth + 1))).toBe(true);
  for (const button of await detail.getByRole('button', { name: /明细/ }).all()) {
    expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
}

test('只读账单：紧凑首屏、两种入口与原地展开', async ({ page }, info) => {
  const control = await installReadonlyFixture(page);
  await page.goto('/activities/demo');
  await page.locator('.expense-row').click();
  const detail = page.getByRole('region', { name: '账单详情', exact: true });
  await expect(detail.getByRole('button', { name: '查看分摊明细' })).toHaveAttribute('aria-expanded', 'false');
  await expect(detail.getByRole('button', { name: '查看结算明细' })).toHaveAttribute('aria-expanded', 'false');
  await expect(detail.locator('.expense-detail-split-members')).toBeHidden();
  if (page.viewportSize()!.width >= 390) {
    for (const selector of ['.expense-detail-summary', '.expense-detail-category', 'time']) {
      await expect(detail.locator(selector)).toBeInViewport({ ratio: 1 });
    }
  }
  await expect(detail.locator('.expense-attachments img')).toHaveJSProperty('complete', true);
  await readonlyFitsWidth(page);
  await page.screenshot({ path: `artifacts/readonly-detail/${info.project.name}-overlay.png`, scale: 'css' });
  await detail.getByRole('button', { name: '查看分摊明细' }).click();
  await expect(detail.locator('.expense-detail-split-members .expense-detail-member-row')).toHaveCount(5);
  await expect(detail.locator('.expense-detail-split-members')).toContainText('¥0.00');
  await detail.getByRole('button', { name: '查看结算明细' }).click();
  await expect(detail.getByRole('table')).toBeVisible();
  const firstRow = detail.locator('.expense-settlement-progress__row').nth(1);
  // 桌面窄弹层也按容器切换为姓名下的纵向金额。
  const cells = await firstRow.locator('[role="cell"]').evaluateAll(items => items.map(item => item.getBoundingClientRect().y));
  expect(cells[1]).toBeGreaterThan(cells[0]);
  expect(cells[2]).toBeGreaterThan(cells[1]);
  await readonlyFitsWidth(page);
  await page.getByRole('button', { name: '关闭账单详情' }).click();
  await expect(page.getByRole('dialog', { name: '账单详情' })).toHaveCount(0);
  await page.locator('.expense-row').click();
  await expect(detail.getByRole('button', { name: '查看分摊明细' })).toHaveAttribute('aria-expanded', 'false');
  await expect(detail.getByRole('button', { name: '查看结算明细' })).toHaveAttribute('aria-expanded', 'false');
  await page.getByRole('button', { name: '关闭账单详情' }).click();
  await page.goto('/activities/demo/expenses/e1');
  await expect(page.getByRole('button', { name: '返回流水' })).toBeVisible();
  await expect(detail.getByRole('button', { name: '查看分摊明细' })).toBeVisible();
  await expect(detail.locator('.expense-attachments img')).toHaveJSProperty('complete', true);
  await detail.getByRole('link', { name: '查看图片 1' }).click();
  await expect(page.getByRole('dialog', { name: '图片大图预览 1' })).toBeVisible();
  await page.getByRole('button', { name: '关闭图片预览', exact: true }).click();
  await expect(detail).toBeVisible();
  // 图片和键盘聚焦会滚动文档；从页顶截图，避免固定页头落在长截图中段。
  await page.evaluate(() => new Promise<void>(resolve => { window.scrollTo(0, 0); requestAnimationFrame(() => requestAnimationFrame(() => resolve())); }));
  await page.screenshot({ path: `artifacts/readonly-detail/${info.project.name}-page.png`, fullPage: true, scale: 'css' });
  await detail.getByRole('button', { name: '查看分摊明细' }).click();
  const settlementToggle = detail.getByRole('button', { name: /结算明细$/ });
  await settlementToggle.focus();
  await page.keyboard.press('Enter');
  await expect(settlementToggle).toHaveAttribute('aria-expanded', 'true');
  if (info.project.name === 'chromium-desktop') {
    await expect(detail.getByRole('columnheader', { name: '成员' })).toBeVisible();
  }
  await expect(detail.getByLabel('已结清', { exact: true })).toBeVisible();
  expect(await detail.locator('.expense-settlement-progress__remaining--settled > span').evaluate(element => element.getBoundingClientRect().height <= parseFloat(getComputedStyle(element).lineHeight) + 1)).toBe(true);
  await readonlyFitsWidth(page);
  await page.evaluate(() => new Promise<void>(resolve => { window.scrollTo(0, 0); requestAnimationFrame(() => requestAnimationFrame(() => resolve())); }));
  await page.screenshot({ path: `artifacts/readonly-detail/${info.project.name}-expanded.png`, fullPage: true, scale: 'css' });
  await page.keyboard.press('Space');
  await expect(settlementToggle).toHaveAttribute('aria-expanded', 'false');
  await page.getByRole('button', { name: '返回流水' }).click();
  await expect(page).toHaveURL('/activities/demo');
  expect(control.writes).toHaveLength(0);
});

test('只读账单：外币、大金额和长姓名在深色窄容器完整展示', async ({ page }, info) => {
  const control = await installReadonlyFixture(page);
  const item = control.expenses[0]!;
  control.members[0]!.displayName = '名字比较长的同行成员用于验证手机端布局';
  Object.assign(item.expense, { title: '跨城市多人出游往返交通与住宿组合账单用于验证长用途展示', originalCurrency: 'USD', originalAmountMinor: '9007199254740993', baseAmountMinor: '63050394783186951', exchangeRate: '7', exchangeRateKind: 'MANUAL' });
  item.payments = [{ ...item.payments[0]!, originalAmountMinor: '9007199254740893' }, { ...item.payments[0]!, memberId: 'm1', originalAmountMinor: '100' }];
  item.payments.forEach((payment, index) => Object.assign(payment, { factId: `payment-${index}` }));
  item.shares[0]!.originalAmountMinor = '9007199254704993';
  control.progress.members[0]!.remainingMinor = '63050394783186251';
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.goto('/activities/demo?viewExpense=e1');
  const detail = page.getByRole('region', { name: '账单详情', exact: true });
  await expect(detail.locator('.expense-detail-summary__amount')).toContainText('US$90,071,992,547,409.93');
  await expect(detail.locator('.expense-detail-summary__conversion')).toContainText('折算后 ¥630,503,947,831,869.51');
  await detail.getByRole('button', { name: '查看分摊明细' }).click();
  await detail.getByRole('button', { name: '查看结算明细' }).click();
  await readonlyFitsWidth(page);
  await page.screenshot({ path: `artifacts/readonly-detail/${info.project.name}-long-values.png`, scale: 'css' });
});

test('只读账单：归档与离线保持展开功能和只读边界', async ({ page }) => {
  const control = await installReadonlyFixture(page);
  control.activity.status = 'ARCHIVED';
  control.expenses[0]!.attachments = [];
  control.expenses[0]!.expense.note = '';
  await page.goto('/activities/demo');
  await expect(page.locator('.expense-row')).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await expect(page.getByText(/当前离线，以下流水/)).toBeVisible();
  await page.locator('.expense-row').click();
  const detail = page.getByRole('region', { name: '账单详情', exact: true });
  await expect(detail.getByText(/最近一次同步的只读快照/)).toBeVisible();
  await expect(detail.getByText('备注', { exact: true })).toHaveCount(0);
  await expect(detail.getByRole('heading', { name: '图片' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /删除账单|保存账单/ })).toHaveCount(0);
  await detail.getByRole('button', { name: '查看分摊明细' }).click();
  await detail.getByRole('button', { name: '查看结算明细' }).click();
  await readonlyFitsWidth(page);
  await page.getByRole('button', { name: '关闭账单详情' }).click();
  await expect(page.getByText(/当前离线，以下流水/)).toBeVisible();
  expect(control.writes).toHaveLength(0);
});

test('紧凑流水摘要为只读字段，独立结算页覆盖收付和零余额', async ({ page }, info) => {
  const control = await installFixture(page);
  await page.goto('/activities/demo');
  await expect(page.locator('.expense-summary .money').first()).toHaveText('¥480.00');
  await expect(page.locator('.personal-balance')).toContainText('我的应收');
  await expect(page.locator('.personal-balance a, .personal-balance button')).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: '活动导航' })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('compact-feed.png') });
  for (const [net, label, name] of [['36000', '我的应收', 'receivable'], ['-36000', '我的应付', 'payable'], ['0', '个人余额已平', 'settled']]) {
    control.balances.forEach((balance, index) => { balance.netMinor = index ? String(-Number(net) / 3) : net; });
    await page.goto('/activities/demo?tab=settlement');
    await expect(page).toHaveURL('/activities/demo/settlement');
    await expect(page.getByRole('region', { name: '我的结算' })).toContainText(label);
    await expect(page.getByRole('button', { name: '成员余额' })).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('.activity-floating-actions')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: info.outputPath(`settlement-${name}.png`) });
  }
  await page.getByRole('button', { name: '更多操作' }).click();
  await page.getByRole('link', { name: '生成分享摘要' }).click();
  await expect(page).toHaveURL(/\/share-summary\/demo$/);
});

test('活动统计：通过活动级更多操作进入，分类、每日和成员统计在桌面与移动端完整可读', async ({ page }, info) => {
  const control = await installFixture(page);
  control.expenses.push(
    { expense: { expenseId: 'e2', activityId: 'demo', title: '地铁与打车', note: '', baseAmountMinor: '16000', originalAmountMinor: '16000', originalCurrency: 'CNY', baseCurrency: 'CNY', category: 'TRANSPORT', occurredAt: '2026-09-06T03:00:00Z', exchangeRate: '1', splitMode: 'EXACT', version: '1' }, payments: [{ memberId: 'm1', originalAmountMinor: '16000', baseAmountMinor: '16000' }], shares: [{ memberId: 'm0', originalAmountMinor: '4000', baseAmountMinor: '4000' }, { memberId: 'm1', originalAmountMinor: '12000', baseAmountMinor: '12000' }], attachments: [] },
    { expense: { expenseId: 'e3', activityId: 'demo', title: '民宿', note: '', baseAmountMinor: '32000', originalAmountMinor: '32000', originalCurrency: 'CNY', baseCurrency: 'CNY', category: 'LODGING', occurredAt: '2026-09-07T03:00:00Z', exchangeRate: '1', splitMode: 'EQUAL', version: '1' }, payments: [{ memberId: 'm2', originalAmountMinor: '32000', baseAmountMinor: '32000' }], shares: control.members.map(member => ({ memberId: member.memberId, originalAmountMinor: '8000', baseAmountMinor: '8000' })), attachments: [] },
  );
  await page.goto('/activities/demo');

  const share = page.getByRole('link', { name: '分享流水小票' });
  const filter = page.getByRole('button', { name: '筛选', exact: true });
  await expect(share).toHaveCount(0);
  await expect(page.getByRole('link', { name: /活动统计/ })).toHaveCount(0);
  const [filterBox, headerBox] = await Promise.all([
    filter.boundingBox(),
    page.locator('.expense-feed-section__header').boundingBox(),
  ]);
  expect(filterBox!.x + filterBox!.width).toBeGreaterThanOrEqual(headerBox!.x + headerBox!.width - 1);

  await page.getByRole('button', { name: '更多操作' }).click();
  const actions = page.getByRole('navigation', { name: '活动操作' });
  await expect(actions).toBeVisible();
  const statistics = actions.getByRole('link', { name: /活动统计/ });
  await statistics.click();
  await expect(page).toHaveURL('/activities/demo/statistics');
  await expect(page.getByRole('heading', { name: '活动统计' })).toBeVisible();
  await expect(page.getByRole('img', { name: /分类消费圆形图/ })).toBeVisible();
  await expect(page.getByLabel('每日消费柱状图')).toBeVisible();
  await expect(page.locator('.activity-statistics-member-row')).toHaveCount(4);
  await expect(page.locator('.activity-statistics-member-list')).toContainText('总消费');
  await expect(page.locator('.activity-statistics-member-list')).toContainText('总支出');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  const memberExpenseHelp = page.getByRole('button', { name: '成员费用说明' });
  await memberExpenseHelp.click();
  const memberExpenseDescription = page.getByText('按账单分摊结果统计到该成员名下的消费金额。');
  await expect(memberExpenseDescription).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(memberExpenseDescription).not.toBeVisible();
  await page.screenshot({ path: info.outputPath('activity-statistics.png'), fullPage: true });
});

test('结算摘要：首次余额加载前后保持紧凑高度', async ({ page }) => {
  const control = await installFixture(page);
  control.ledgerPending = true; control.snapshotPending = true;
  await page.goto('/activities/demo/settlement');
  await expect(page.getByRole('status', { name: '正在读取我的结算…' })).toBeVisible();
  const height = (await page.locator('.settlement-summary').boundingBox())!.height;
  control.ledgerPending = false; control.snapshotPending = false;
  await expect(page.getByRole('region', { name: '我的结算' })).toContainText('¥360.00');
  expect((await page.locator('.settlement-summary').boundingBox())!.height).toBe(height);
});

test('四人摘要一屏完整，当前页图片与屏幕一致', async ({ page }, info) => {
  await installFixture(page);
  await page.goto('/share-summary/demo');
  await expect(page.locator('#share-summary-preview-card')).toBeVisible();
  await expect(page.locator('#share-summary-preview-card [data-summary-row]')).toHaveCount(7);
  await fitsScreen(page);
  await page.screenshot({ path: info.outputPath('share-summary.png') });
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  if (info.project.name.includes('desktop')) {
    const pending = page.waitForEvent('download'); await page.getByRole('button', { name: '保存本页图片' }).click();
    const download = await pending; expect(download.suggestedFilename()).toBe('huddletab-settlement-summary-1.png');
    await download.saveAs(info.outputPath('summary-1.png'));
  } else {
    await page.getByRole('button', { name: '保存本页图片' }).click();
    const image = page.getByRole('img', { name: /PNG 预览/ }); await expect(image).toBeVisible();
    expect(await image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThanOrEqual(1500);
    await fitsScreen(page);
  }
  expect(errors).toEqual([]);
});

test('超量摘要每页无滚动，所有转账和余额恰好展示一次', async ({ page }, info) => {
  await installFixture(page, 30);
  await page.goto('/share-summary/demo');
  const next = page.getByRole('button', { name: '下一页' }); await expect(next).toBeVisible();
  const keys: string[] = [];
  for (let index = 0; index < 60; index++) {
    await fitsScreen(page);
    keys.push(...await page.locator('#share-summary-preview-card [data-summary-row]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-summary-row')!)));
    if (index === 1) await page.screenshot({ path: info.outputPath('share-pagination.png') });
    if (await next.isDisabled()) break;
    await next.click();
  }
  expect(keys).toHaveLength(59); expect(new Set(keys).size).toBe(59);
});

test('结算推荐与补记共用选择器，记录原地修改且保留错误输入', async ({ page }, info) => {
  const control = await installFixture(page);
  await page.goto('/activities/demo?tab=settlement');
  await expect(page.getByRole('heading', { name: '实际结算记录' })).toBeVisible();
  await page.screenshot({ path: info.outputPath('settlement.png'), fullPage: true });
  await page.locator('.settlement-recommendation-trigger').first().click();
  const form = page.getByRole('form', { name: '记录推荐转账' });
  await expect(form.getByLabel('金额（CNY）')).toHaveValue('120.00');
  await form.getByRole('button', { name: '付款人：小陈' }).click();
  await expect(form.getByRole('button', { name: /小林.*已选为收款人/ })).toBeDisabled();
  await form.getByLabel('搜索付款人').fill('小周');
  await form.getByRole('button', { name: '小周', exact: true }).click();
  await expect(form.getByLabel('金额（CNY）')).toHaveValue('120.00');
  await form.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '补记结算', exact: true }).click();
  const manual = page.getByRole('form', { name: '补记结算' });
  await manual.getByRole('button', { name: '付款人：请选择' }).click();
  await manual.getByRole('button', { name: '小陈', exact: true }).click();
  await manual.getByRole('button', { name: '收款人：请选择' }).click();
  const choices = manual.locator('.settlement-parties');
  await choices.evaluate(element => {
    const header = document.querySelector('.workspace-header')!.getBoundingClientRect().height;
    window.scrollTo(0, window.scrollY + element.getBoundingClientRect().top - header - 12);
  });
  await choices.screenshot({ path: info.outputPath('member-picker-detail.png') });
  await page.screenshot({ path: info.outputPath('member-picker.png') });
  await manual.getByRole('button', { name: '小林', exact: true }).click();
  await manual.getByLabel('金额（CNY）').fill('25');
  control.failWrite = true;
  await manual.getByRole('button', { name: '记录结算', exact: true }).click();
  await expect(manual.getByRole('alert')).toContainText('记录冲突');
  await expect(manual.getByLabel('金额（CNY）')).toHaveValue('25');
  await manual.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '修改', exact: true }).click();
  await page.getByRole('form', { name: '修改结算' }).getByLabel('金额（CNY）').fill('99');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '修改', exact: true }).click();
  await expect(page.getByRole('form', { name: '修改结算' }).getByLabel('金额（CNY）')).toHaveValue('80.00');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
});

test('首次流水骨架与按需模块，历史记录慢不阻塞余额', async ({ page }, info) => {
  const control = await installFixture(page); control.feedPending = true; control.snapshotPending = true;
  const scripts: string[] = []; page.on('request', request => { if (request.resourceType() === 'script') scripts.push(request.url()); });
  await page.goto('/activities/demo');
  await expect(page.getByRole('status', { name: '正在读取流水…' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: '活动导航' })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('feed-skeleton.png') });
  control.feedPending = false;
  await expect(page.getByRole('link', { name: /湖边晚餐/ })).toBeVisible();
  await expect(page.getByRole('img', { name: '含图片' })).toBeVisible();
  expect(scripts.some(url => /expense-editor-|settlement-page-/.test(url))).toBeFalsy();
  await page.screenshot({ path: info.outputPath('feed.png') });
  control.historyPending = true;
  await page.getByRole('link', { name: '结算', exact: true }).click();
  await expect(page.getByRole('region', { name: '我的结算' })).toContainText('¥360.00');
  await expect(page.getByRole('status', { name: '正在读取结算…' })).toBeVisible();
  await page.screenshot({ path: info.outputPath('settlement-skeleton.png') });
  control.historyPending = false; control.snapshotPending = false;
  await expect(page.getByText('记录于', { exact: false }).first()).toBeVisible();
});

test('长姓名与大金额分页完整，字号和视口改变后仍可截图', async ({ page }, info) => {
  const fixture = await installFixture(page, 12, 98765432100);
  fixture.activity.name = '杭州周末旅行与朋友共同消费的结算汇总';
  fixture.members.forEach((member, index) => { member.displayName = `成员${index + 1}这是一个需要换行展示的完整姓名`; fixture.balances[index].displayName = member.displayName; });
  await page.goto('/share-summary/demo');
  const next = page.getByRole('button', { name: '下一页' }); await expect(next).toBeVisible();
  await next.click();
  const anchor = await page.locator('#share-summary-preview-card [data-summary-row]').first().getAttribute('data-summary-row');
  await page.evaluate(() => { document.documentElement.style.fontSize = '20px'; });
  await page.setViewportSize({ width: 360, height: 740 });
  await expect(page.locator(`#share-summary-preview-card [data-summary-row="${anchor}"]`)).toBeVisible();
  await fitsScreen(page);
  await page.screenshot({ path: info.outputPath('share-large-text.png') });
});

test('结算记录失败只影响本区域，可重试且不误报空记录', async ({ page }) => {
  const control = await installFixture(page); control.historyError = true; control.snapshotPending = true;
  await page.goto('/activities/demo?tab=settlement');
  await expect(page.getByRole('region', { name: '我的结算' })).toContainText('¥360.00');
  const history = page.getByRole('region', { name: '实际结算记录' });
  await expect(history.getByRole('alert')).toContainText('记录暂时无法读取');
  await expect(history.getByText('还没有结算记录')).toHaveCount(0);
  control.historyError = false;
  await history.getByRole('button', { name: '重试', exact: true }).click();
  await expect(history.locator('.settlement-record')).toHaveCount(2);
  control.snapshotPending = false;
});


test('流水筛选：草稿、多选、条件标签与搜索在窄屏完整可用', async ({ page }, info) => {
  const control = await installFixture(page);
  control.members[3].status = 'LEFT';
  await page.goto('/activities/demo');
  await expect(page.getByRole('heading', { name: '全部流水' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: '搜索用途或备注' })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('feed-default.png') });
  const filter = page.getByRole('button', { name: /^筛选/ });
  await filter.click();
  let dialog = page.getByRole('dialog', { name: '筛选流水' });
  await expect(dialog).toBeVisible();
  expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('INPUT');
  await dialog.getByRole('button', { name: '交通', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(filter).toBeFocused();
  await expect(page.locator('.expense-row')).toHaveCount(1);
  await filter.click();
  dialog = page.getByRole('dialog', { name: '筛选流水' });
  await expect(dialog.getByRole('button', { name: '交通', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await dialog.getByRole('button', { name: '餐饮', exact: true }).click();
  await dialog.getByLabel('开始日期').fill('2026-09-05');
  await expect(dialog.getByRole('button', { name: '应用筛选' })).toBeDisabled();
  await dialog.getByLabel('结束日期').fill('2026-09-05');
  await dialog.locator('summary').filter({ hasText: '付款人' }).click();
  await dialog.getByRole('textbox', { name: '搜索付款人' }).fill('小林');
  await dialog.getByRole('group', { name: '付款人', exact: true }).getByRole('checkbox', { name: '小林' }).click();
  await dialog.locator('summary').filter({ hasText: '付款人' }).click();
  await dialog.locator('summary').filter({ hasText: '参与人' }).click();
  await dialog.getByRole('textbox', { name: '搜索参与人' }).fill('小王');
  await dialog.getByRole('checkbox', { name: /小王.*已退出/ }).click();
  await dialog.locator('summary').filter({ hasText: '参与人' }).click();
  await dialog.locator('.feed-filter-scroll').evaluate(element => { element.scrollTop = 0; });
  const apply = dialog.getByRole('button', { name: '应用筛选' });
  await expect(apply).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: info.outputPath('feed-filter-dialog.png') });
  await apply.click();
  await expect(dialog).toHaveCount(0);
  await expect(filter).toHaveText('筛选4');
  await expect(page.getByText('找到 1 笔流水', { exact: true })).toBeVisible();
  await expect(page.getByLabel('消费摘要')).toContainText('¥480.00');
  await page.getByRole('button', { name: '搜索', exact: true }).click();
  const search = page.getByRole('textbox', { name: '搜索用途或备注' });
  await expect(search).toBeFocused();
  await search.fill('  晚餐  ');
  await search.press('Enter');
  await expect(page.locator('.expense-row')).toHaveCount(1);
  await page.screenshot({ path: info.outputPath('feed-filter-results.png'), fullPage: true });
  await page.getByRole('button', { name: '移除付款人：小林' }).click();
  await expect(filter).toHaveText('筛选3');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(search).toHaveCount(0);
  await expect(page.getByRole('button', { name: '移除餐饮' })).toBeVisible();
  await page.getByRole('button', { name: '清除全部', exact: true }).click();
  await expect(filter).toHaveText('筛选');
});

for (const width of [320, 380, 390, 430, 1440]) {
  test(`流水筛选：日期框在 ${width}px 下对齐且不溢出`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: width > 600 ? 1000 : 844 });
    await installFixture(page);
    await page.goto('/activities/demo');
    await page.getByRole('button', { name: '筛选', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '筛选流水' });
    const dates = dialog.locator('.feed-filter-dates');
    const start = dialog.getByLabel('开始日期');
    const end = dialog.getByLabel('结束日期');
    // 等待面板入场完成，并容忍 WebKit 对可见比例的亚像素舍入。
    await expect(dialog.getByRole('button', { name: '应用筛选' })).toBeInViewport({ ratio: 0.99 });

    async function expectDatesFit() {
      // 检查控件本身的边界，避免弹窗裁切溢出后页面宽度仍正常而漏报。
      await expect(async () => {
        const geometry = await dates.evaluate(element => {
          const bounds = element.getBoundingClientRect();
          return {
            left: bounds.left, right: bounds.right,
            fields: Array.from(element.querySelectorAll('.field')).map(field => {
              const box = field.getBoundingClientRect();
              const input = field.querySelector('input')!.getBoundingClientRect();
              const label = field.querySelector('.field__label')!.getBoundingClientRect();
              return { left: box.left, right: box.right, top: box.top, bottom: box.bottom,
                input: { left: input.left, right: input.right, top: input.top, width: input.width, height: input.height },
                labelLeft: label.left };
            }),
          };
        });
        const [first, second] = geometry.fields;
        for (const field of geometry.fields) {
          expect(field.input.left).toBeGreaterThanOrEqual(geometry.left - 1);
          expect(field.input.right).toBeLessThanOrEqual(geometry.right + 1);
          expect(Math.abs(field.input.left - field.labelLeft)).toBeLessThanOrEqual(1);
          expect(Math.abs(field.input.right - field.right)).toBeLessThanOrEqual(1);
          expect(field.input.height).toBeGreaterThanOrEqual(44);
        }
        expect(Math.abs(first.input.width - second.input.width)).toBeLessThanOrEqual(1);
        expect(Math.abs(first.input.height - second.input.height)).toBeLessThanOrEqual(1);
        if (width <= 380) {
          expect(Math.abs(first.input.left - second.input.left)).toBeLessThanOrEqual(1);
          expect(Math.abs(second.top - first.bottom - 10)).toBeLessThanOrEqual(1);
        } else {
          expect(Math.abs(first.input.top - second.input.top)).toBeLessThanOrEqual(1);
          expect(Math.abs(second.input.left - first.input.right - 10)).toBeLessThanOrEqual(1);
        }
      }).toPass();
    }

    await expectDatesFit();
    if (width === 390) await page.screenshot({ path: info.outputPath('dates-empty.png') });
    await start.fill('2026-09-05');
    await end.fill('2026-09-06');
    await expectDatesFit();
    await page.screenshot({ path: info.outputPath('dates-filled.png') });
    await dialog.getByRole('button', { name: '清空日期' }).click();
    await expect(start).toHaveValue('');
    await expect(end).toHaveValue('');
    await expectDatesFit();
    if (width === 390) await page.screenshot({ path: info.outputPath('dates-cleared.png') });
  });
}

test('流水筛选：编辑和结算往返保留，退出活动及刷新重置', async ({ page }) => {
  await installFixture(page);
  await page.goto('/activities/demo');
  await page.getByRole('button', { name: '搜索', exact: true }).click();
  await page.getByRole('textbox', { name: '搜索用途或备注' }).fill('晚餐');
  await page.getByRole('button', { name: '筛选', exact: true }).click();
  await page.getByRole('button', { name: '餐饮', exact: true }).click();
  await page.getByRole('button', { name: '应用筛选' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.locator('.expense-row').click();
  await expect(page.getByRole('dialog', { name: '修改账单' })).toBeVisible();
  await page.getByRole('button', { name: '关闭修改账单' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: '搜索用途或备注' })).toHaveValue('晚餐');
  await page.getByRole('link', { name: '结算', exact: true }).click();
  await expect(page.getByRole('region', { name: '我的结算' })).toBeVisible();
  await page.getByRole('button', { name: '返回流水' }).click();
  await expect(page.getByRole('textbox', { name: '搜索用途或备注' })).toHaveValue('晚餐');
  await expect(page.getByRole('button', { name: '移除餐饮' })).toBeVisible();
  await page.getByRole('link', { name: '返回活动列表' }).click();
  await expect(page).toHaveURL('/activities');
  await expect(page.getByRole('heading', { name: '活动', exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('button', { name: '搜索', exact: true })).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('button', { name: '筛选', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '搜索', exact: true }).click();
  await page.getByRole('textbox', { name: '搜索用途或备注' }).fill('晚餐');
  await page.reload();
  await expect(page.getByRole('button', { name: '搜索', exact: true })).toHaveAttribute('aria-expanded', 'false');
});

test('流水筛选：只读详情与离线快照往返保留条件', async ({ page }) => {
  const control = await installFixture(page);
  control.activity.status = 'ENDED';
  await page.goto('/activities/demo');
  await page.getByRole('button', { name: '筛选', exact: true }).click();
  await page.getByRole('button', { name: '餐饮', exact: true }).click();
  await page.getByRole('button', { name: '应用筛选' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.locator('.expense-row').click();
  await expect(page.getByRole('heading', { name: '账单详情' })).toBeVisible();
  await page.getByRole('button', { name: '关闭账单详情' }).click();
  await expect(page.getByRole('button', { name: '移除餐饮' })).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await expect(page.getByText(/当前离线，以下流水/)).toBeVisible();
  await expect(page.getByText('找到 1 笔流水', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '搜索', exact: true }).click();
  await page.getByRole('textbox', { name: '搜索用途或备注' }).fill('不存在');
  await expect(page.getByRole('heading', { name: '没有符合条件的流水' })).toBeVisible();
  await page.getByRole('button', { name: '清除全部条件' }).click();
  await expect(page.locator('.expense-row')).toHaveCount(1);
});

test('流水筛选：小视口键盘区域保留操作栏，遮罩及下滑取消草稿', async ({ page }, info) => {
  test.skip(info.project.name === 'chromium-desktop', '移动端面板验收');
  await installFixture(page, 12);
  await page.goto('/activities/demo');
  const filter = page.getByRole('button', { name: /^筛选/ });
  await filter.click();
  let dialog = page.getByRole('dialog', { name: '筛选流水' });
  await dialog.getByRole('button', { name: '交通', exact: true }).click();
  await page.locator('.feed-filter-overlay .form-overlay__scrim').click({ position: { x: 12, y: 8 } });
  await expect(dialog).toHaveCount(0);
  await filter.click();
  dialog = page.getByRole('dialog', { name: '筛选流水' });
  await expect(dialog.getByRole('button', { name: '交通', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await dialog.locator('summary').filter({ hasText: '付款人' }).click();
  // 浏览器自动化不弹出系统软键盘，模拟其 visualViewport 缩小事件检查布局。
  await page.evaluate(() => {
    Object.defineProperty(window.visualViewport!, 'height', { configurable: true, value: 360 });
    window.visualViewport!.dispatchEvent(new Event('resize'));
  });
  const memberSearch = dialog.getByRole('textbox', { name: '搜索付款人' });
  await memberSearch.fill('小林');
  await expect(memberSearch).toBeFocused();
  await expect.poll(async () => {
    const bounds = await dialog.getByRole('button', { name: '应用筛选' }).boundingBox();
    return bounds !== null && bounds.y >= 0 && bounds.y + bounds.height <= 361;
  }).toBe(true);
  const inputBox = await memberSearch.boundingBox();
  const footerBox = await dialog.locator('.feed-filter-footer').boundingBox();
  expect(inputBox!.y + inputBox!.height).toBeLessThanOrEqual(footerBox!.y + 1);
  await page.screenshot({ path: info.outputPath('feed-filter-keyboard.png') });
  await page.evaluate(() => { Reflect.deleteProperty(window.visualViewport!, 'height'); window.visualViewport!.dispatchEvent(new Event('resize')); });
  await memberSearch.blur();
  const header = dialog.locator('.form-overlay__header');
  const box = (await header.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 220, { steps: 8 });
  await page.mouse.up();
  await expect(dialog).toHaveCount(0);
  await expect(filter).toHaveText('筛选');
});

async function scrollHeader(page: Page, y: number) {
  await page.evaluate(async value => { window.scrollTo(0, value); await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); }, y);
}

async function dispatchTouchSwipe(page: Page, deltaX: number, deltaY: number) {
  await page.locator('.workspace-content').evaluate((element, delta) => {
    const box = element.getBoundingClientRect();
    const startX = box.left + box.width / 2;
    const startY = box.top + Math.min(Math.max(96, box.height / 3), 220);
    const dispatch = (type: 'pointerdown' | 'pointermove' | 'pointerup', clientX: number, clientY: number, buttons: number) => {
      element.dispatchEvent(new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        button: 0,
        buttons,
        clientX,
        clientY,
        isPrimary: true,
        pointerId: 41,
        pointerType: 'touch',
      }));
    };
    dispatch('pointerdown', startX, startY, 1);
    dispatch('pointermove', startX + delta.deltaX * .4, startY + delta.deltaY * .4, 1);
    dispatch('pointermove', startX + delta.deltaX, startY + delta.deltaY, 1);
    dispatch('pointerup', startX + delta.deltaX, startY + delta.deltaY, 0);
  }, { deltaX, deltaY });
}

test('活动页头：长流水滚动时标题和三个入口保持可达，成员面板关闭后位置不变', async ({ page }, info) => {
  const control = await installFixture(page);
  const original = control.expenses[0];
  for (let i = 2; i <= 30; i++) control.expenses.push({ ...original, expense: { ...original.expense, expenseId: `e${i}`, title: `旅行消费${i}` } });
  await page.goto('/activities/demo');
  await expect(page.locator('.expense-row')).toHaveCount(30);
  const header = await page.locator('.workspace-header').boundingBox();
  await page.evaluate(() => scrollTo(0, 1100));
  await expect.poll(async () => (await page.locator('.workspace-header').boundingBox())!.y).toBe(0);
  expect((await page.locator('.workspace-header').boundingBox())!.height).toBe(header!.height);
  const before = await page.evaluate(() => scrollY);
  await page.getByRole('link', { name: '成员 4' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: /^关闭/ }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(before);
  await expect(page.getByRole('link', { name: '结算', exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('compact-header-scrolled.png') });
});

test('活动页头：长名称、大字体与深色安全区无水平溢出', async ({ page }, info) => {
  const control = await installFixture(page, 30);
  control.activity.name = '杭州周末旅行与朋友共同消费的结算汇总';
  await page.goto('/activities/demo');
  await expect(page.locator('.expense-row')).toHaveCount(1);
  await page.evaluate(() => { document.documentElement.style.fontSize = '24px'; document.documentElement.classList.add('dark', 'pwa-standalone'); document.documentElement.style.setProperty('--safe-area-top', '44px'); document.documentElement.style.setProperty('--safe-area-bottom', '34px'); });
  await expect(page.getByRole('link', { name: '成员 30' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: info.outputPath('compact-header-large-dark.png') });
});

test('活动页头：加载骨架与完成后的标题高度一致', async ({ page }) => {
  const control = await installFixture(page);
  control.activityPending = true; control.snapshotPending = true;
  await page.goto('/activities/demo');
  await expect(page.locator('.workspace-header')).toHaveAttribute('aria-busy', 'true');
  const before = (await page.locator('.workspace-header').boundingBox())!.height;
  control.activityPending = false; control.snapshotPending = false;
  await expect(page.locator('.workspace-header h1')).toHaveText(control.activity.name);
  expect((await page.locator('.workspace-header').boundingBox())!.height).toBe(before);
});

/** 统计验收只扩展本地接口夹具，消费与付款使用同一份主币种事实。 */
async function installStatisticsFixture(page: Page) {
  const controls = await installFixture(page);
  const template = controls.expenses[0]!;
  const items = [
    ['e1', '湖边晚餐', 'FOOD', '2026-09-05T10:00:00Z', '48000'],
    ['e2', '西湖游船', 'ENTERTAINMENT', '2026-09-06T08:00:00Z', '22000'],
    ['e3', '往返高铁', 'TRANSPORT', '2026-09-05T03:00:00Z', '62000'],
    ['e4', '两晚住宿', 'LODGING', '2026-09-07T08:00:00Z', '128000'],
    ['e5', '早餐', 'FOOD', '2026-09-08T01:00:00Z', '8000'],
    ['e6', '咖啡', 'FOOD', '2026-09-08T06:00:00Z', '6000'],
  ].map(([id, title, category, occurredAt, amount], index) => ({
    ...template, attachments: [],
    expense: { ...template.expense, expenseId: id!, title: title!, category: category!, occurredAt: occurredAt!, baseAmountMinor: amount!, originalAmountMinor: amount! },
    payments: [{ memberId: `m${index % 4}`, baseAmountMinor: amount!, originalAmountMinor: amount! }],
    shares: controls.members.map(member => ({ memberId: member.memberId, baseAmountMinor: String(BigInt(amount!) / 4n), originalAmountMinor: String(BigInt(amount!) / 4n) })),
  }));
  controls.expenses.splice(0, controls.expenses.length, ...items);
  return controls;
}

test('活动统计增强：日期、视图和详情返回保留统计上下文', async ({ page }, info) => {
  await installStatisticsFixture(page);
  await page.goto('/activities/demo');
  await page.getByRole('button', { name: '更多操作' }).click();
  await page.getByRole('link', { name: '活动统计', exact: true }).click();
  await expect(page.getByLabel('活动消费总览')).toContainText('6 笔');
  await page.screenshot({ path: info.outputPath('statistics-overview.png'), fullPage: true, scale: 'css' });
  await page.getByRole('button', { name: '选择统计日期范围' }).click();
  await page.getByRole('button', { name: /2026年9月6日/ }).click();
  await page.getByRole('button', { name: /2026年9月8日/ }).click();
  await page.getByRole('button', { name: '应用', exact: true }).click();
  await expect(page.getByLabel('活动消费总览')).toContainText('4 笔');
  for (const name of ['笔数', '条形', '累计消费', '按总支出', '明细']) await page.getByRole('button', { name, exact: true }).click();
  await expect(page.getByRole('img', { name: /累计消费折线图/ })).toBeVisible();
  const selectedUrl = page.url();
  await page.getByRole('link', { name: /两晚住宿/ }).click();
  await expect(page.getByRole('heading', { name: '账单详情', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '返回活动统计' }).click();
  await expect(page).toHaveURL(selectedUrl);
  await expect(page.getByRole('button', { name: '笔数', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: '明细', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '选择统计日期范围' }).click();
  await page.getByRole('button', { name: /2026年9月5日/ }).click();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page).toHaveURL(selectedUrl);
  await page.getByRole('button', { name: '选择统计日期范围' }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: '选择统计日期范围' })).toBeFocused();
  await page.getByRole('button', { name: '重置', exact: true }).click();
  await expect(page.getByLabel('活动消费总览')).toContainText('6 笔');
  await page.getByRole('button', { name: '返回流水' }).click();
  await expect(page).toHaveURL('/activities/demo');
});

test('活动统计增强：长日期、大金额、长名称及深色窄屏不溢出', async ({ page }, info) => {
  const controls = await installStatisticsFixture(page);
  controls.members[0]!.displayName = '名字比较长的同行成员用于验证手机端布局';
  controls.expenses[0]!.expense.title = '跨城市多人出游往返交通与住宿组合账单用于验证长用途展示';
  controls.expenses[0]!.expense.baseAmountMinor = '9007199254740993';
  controls.expenses[0]!.payments[0]!.baseAmountMinor = '9007199254740993';
  controls.expenses[0]!.shares[0]!.baseAmountMinor = '9007199254740993';
  controls.expenses[5]!.expense.occurredAt = '2026-12-05T06:00:00Z';
  await page.goto('/activities/demo/statistics');
  await expect(page.getByLabel('每日消费柱状图')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.getByRole('button', { name: '累计消费', exact: true }).click();
  await expect(page.getByRole('img', { name: /累计消费折线图/ })).toBeVisible();
  expect(await page.locator('.activity-statistics-bars-scroll').evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.getByText('查看每日明细', { exact: true }).click();
  await expect(page.getByRole('table')).toContainText('2026-12-05');
  await page.getByRole('button', { name: '选择统计日期范围' }).click();
  const picker = page.locator('.statistics-date-popover');
  await expect(picker).toBeVisible();
  const box = await picker.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
  await page.keyboard.press('Escape');
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  await page.getByRole('button', { name: '条形', exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  expect(await page.locator('.statistics-category-value .money').evaluateAll(elements => elements.every(el => {
    const box = el.getBoundingClientRect();
    const section = el.closest('section')!.getBoundingClientRect();
    return box.right <= section.right && box.left >= section.left && el.scrollWidth <= el.clientWidth + 1;
  }))).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: info.outputPath('statistics-dark-stress.png'), fullPage: true, scale: 'css' });
});
