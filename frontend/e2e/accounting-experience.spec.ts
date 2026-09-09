import { expect, test, type Page } from '@playwright/test';

/** 确定性的前端验收数据，只拦截测试浏览器请求，不写入真实活动。 */
async function installFixture(page: Page, count = 4, shareMinor = 12000) {
  const members = Array.from({ length: count }, (_, index) => ({ activityId: 'demo', memberId: `m${index}`, displayName: ['小林', '小陈', '小周', '小王'][index] ?? `同行成员${index + 1}`, avatarPreset: index % 8, role: index ? 'MEMBER' : 'OWNER', status: 'ACTIVE', userId: `u${index}`, version: '1' }));
  const activity = { activityId: 'demo', name: '周末杭州小聚', baseCurrency: 'CNY', status: 'ACTIVE', startDate: '2026-09-05', endDate: '2026-09-06', currentMemberId: 'm0', currentMemberRole: 'OWNER', ownerMemberId: 'm0', revision: '1', version: '1' };
  const balances = members.map((member, index) => ({ memberId: member.memberId, displayName: member.displayName, netMinor: index ? String(-shareMinor) : String((count - 1) * shareMinor) }));
  const recommendations = { recommendations: members.slice(1).map(member => ({ payerMemberId: member.memberId, receiverMemberId: 'm0', amountMinor: String(shareMinor) })) };
  const records = [{ settlementId: 's1', activityId: 'demo', payerMemberId: 'm1', receiverMemberId: 'm0', currency: 'CNY', amountMinor: '8000', status: 'ACTIVE', createdAt: '2026-09-06T06:30:00Z', version: '1' }, { settlementId: 's2', activityId: 'demo', payerMemberId: 'm2', receiverMemberId: 'm0', currency: 'CNY', amountMinor: '2000', status: 'VOID', createdAt: '2026-09-05T10:20:00Z', version: '1' }];
  const expenses = [{ expense: { expenseId: 'e1', activityId: 'demo', title: '湖边晚餐', note: '四个人一起吃杭帮菜', baseAmountMinor: '48000', originalAmountMinor: '48000', originalCurrency: 'CNY', baseCurrency: 'CNY', category: 'FOOD', occurredAt: '2026-09-05T10:00:00Z', exchangeRate: '1', splitMode: 'EQUAL', version: '1' }, payments: [{ memberId: 'm0', originalAmountMinor: '48000' }], shares: members.map(member => ({ memberId: member.memberId, originalAmountMinor: '12000' })), attachments: [] }];
  const controls = { expenses, activityPending: false, historyPending: false, feedPending: false, snapshotPending: false, historyError: false, ledgerPending: false, failWrite: false, writes: [] as unknown[], summaryReads: 0, members, balances, activity };
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url()); const endpoint = url.pathname.split('/').at(-1);
    while ((endpoint === 'demo' && controls.activityPending) || (endpoint === 'settlements' && controls.historyPending) || (endpoint === 'expenses' && controls.feedPending) || (endpoint === 'snapshot' && controls.snapshotPending) || (endpoint === 'ledger' && controls.ledgerPending)) await new Promise(resolve => setTimeout(resolve, 30));
    if (endpoint === 'settlements' && controls.historyError) { await route.fulfill({ status: 503, json: { error: { message: '记录暂时无法读取' } } }); return; }
    if (route.request().method() !== 'GET') { controls.writes.push(route.request().postDataJSON()); await route.fulfill({ status: controls.failWrite ? 409 : 200, json: controls.failWrite ? { error: { message: '记录冲突，请重试' } } : { data: records[0] } }); return; }
    let data: unknown = [];
    else if (endpoint === 'session') data = { userId: 'u0', username: 'demo', displayName: '小林', isSystemAdmin: false };
    else if (endpoint === 'csrf') data = { token: 'fixture' };
    else if (endpoint === 'demo') data = activity;
    else if (endpoint === 'members') data = members;
    else if (endpoint === 'expenses') data = expenses;
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
  await page.getByLabel('结算金额（CNY）').fill('99');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '修改', exact: true }).click();
  await expect(page.getByLabel('结算金额（CNY）')).toHaveValue('80.00');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
});

test('首次流水骨架与按需模块，历史记录慢不阻塞余额', async ({ page }, info) => {
  const control = await installFixture(page); control.feedPending = true; control.snapshotPending = true;
  const scripts: string[] = []; page.on('request', request => { if (request.resourceType() === 'script') scripts.push(request.url()); });
  await page.goto('/activities/demo');
  await expect(page.getByRole('status', { name: '正在读取流水…' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: '活动导航' })).toBeVisible();
  await page.screenshot({ path: info.outputPath('feed-skeleton.png') });
  control.feedPending = false;
  await expect(page.getByRole('link', { name: /湖边晚餐/ })).toBeVisible();
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


/** 实测导航边缘和正文文档坐标，防止收起造成锚定抖动或只透明但仍挡住内容。 */
async function headerGeometry(page: Page) {
  return page.evaluate(() => {
    const header = document.querySelector<HTMLElement>('.workspace-header')!;
    const metadata = header.querySelector<HTMLElement>('.workspace-header__metadata')!;
    const nav = header.querySelector<HTMLElement>('.workspace-nav')!;
    const content = document.querySelector<HTMLElement>('.workspace-content')!;
    return { height: header.getBoundingClientRect().height, navBottom: nav.getBoundingClientRect().bottom, opacity: Number(getComputedStyle(metadata).opacity), documentTop: content.getBoundingClientRect().top + scrollY, scroll: scrollY, documentHeight: document.documentElement.scrollHeight };
  });
}

async function scrollHeader(page: Page, y: number) {
  await page.evaluate(async value => { window.scrollTo(0, value); await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); }, y);
}

test('活动页头：连续收起、回到顶部展开和入口保持稳定', async ({ page }, info) => {
  const control = await installFixture(page);
  Object.assign(control.activity, { fieldPermissions: { name: true, location: true, startDate: true, endDate: true, baseCurrency: false, inviteMode: true }, allowedLifecycleActions: ['END'], hasAccountingRecords: true, inviteMode: 'DIRECT_JOIN' });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const first = control.expenses[0];
  for (let i = 1; i < 25; i++) control.expenses.push({ ...first, expense: { ...first.expense, expenseId: `e${i + 1}`, title: `旅途支出 ${i + 1}` } });
  await page.goto('/activities/demo');
  await expect(page.locator('.expense-row')).toHaveCount(25);
  const expanded = await headerGeometry(page);
  await page.screenshot({ path: info.outputPath('header-expanded.png') });
  expect(expanded.height).toBe(128);
  for (const y of [8, 16, 24, 32, 180, 64, 32, 16, 0, 120, 0]) {
    await scrollHeader(page, y);
    const current = await headerGeometry(page);
    expect(current.scroll).toBe(y);
    expect(current.documentHeight).toBe(expanded.documentHeight);
    expect(current.documentTop).toBe(expanded.documentTop);
    expect(current.opacity).toBeCloseTo(1 - Math.min(y / 32, 1), 2);
    expect(current.navBottom).toBeCloseTo(expanded.navBottom - Math.min(y, 32), 0);
  }
  await scrollHeader(page, 180);
  await page.screenshot({ path: info.outputPath('header-collapsed.png') });
  const collapsed = await headerGeometry(page);
  expect(collapsed.navBottom).toBe(96);
  // 裁剪外的旧占位不能继续覆盖正文或拦截点击。
  expect(await page.evaluate(() => document.elementFromPoint(innerWidth / 2, 110)?.closest('.workspace-header') === null)).toBe(true);
  await page.getByRole('link', { name: '成员 4', exact: true }).click();
  const members = page.getByRole('dialog');
  await expect(members).toBeVisible();
  await members.locator('.form-overlay__body').evaluate(element => { element.scrollTop = 120; element.dispatchEvent(new Event('scroll')); });
  expect((await headerGeometry(page)).navBottom).toBe(collapsed.navBottom);
  await members.getByRole('button', { name: /^关闭/ }).click();
  await expect(members).toHaveCount(0);
  expect((await headerGeometry(page)).navBottom).toBe(collapsed.navBottom);
  await page.getByRole('link', { name: '活动管理', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: /^关闭/ }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('navigation', { name: '活动导航' }).getByRole('link', { name: '结算', exact: true }).click();
  await expect(page.getByRole('heading', { name: '实际结算记录' })).toBeVisible();
  const settlement = await headerGeometry(page);
  expect(settlement.opacity).toBeCloseTo(1 - Math.min(settlement.scroll / 32, 1), 2);
  await page.goBack();
  await expect(page.locator('.expense-row')).toHaveCount(25);
  await scrollHeader(page, 0);
  expect((await headerGeometry(page)).navBottom).toBe(expanded.navBottom);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect.poll(async () => (await headerGeometry(page)).opacity).toBe(0);
  await scrollHeader(page, -20);
  expect((await headerGeometry(page)).opacity).toBe(1);
  console.log(`${info.project.name}: 页头展开 ${expanded.height}px，收起 ${collapsed.navBottom}px`);
  await page.getByRole('link', { name: '返回活动列表' }).click();
  await expect(page).toHaveURL(/\/activities$/);
  expect(errors).toEqual([]);
});

test('活动页头：长名称、大人数、深色安全区和放大字体无溢出', async ({ page }, info) => {
  const control = await installFixture(page, 120);
  control.activity.name = '这是一个需要省略显示的很长很长的周末杭州旅行活动名称';
  await page.goto('/activities/demo');
  await expect(page.locator('.workspace-header h1')).toHaveText(control.activity.name);
  await page.evaluate(() => { document.documentElement.classList.add('dark', 'pwa-standalone'); document.documentElement.style.setProperty('--safe-area-top', '47px'); });
  const buttons = page.locator('.workspace-header__actions > a');
  for (const button of await buttons.all()) {
    const box = (await button.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44); expect(box.height).toBeGreaterThanOrEqual(44); expect(box.y).toBeGreaterThanOrEqual(47);
  }
  const title = (await page.locator('.workspace-header h1').boundingBox())!;
  const member = (await page.getByRole('link', { name: '成员 120', exact: true }).boundingBox())!;
  expect(title.x + title.width).toBeLessThanOrEqual(member.x);
  const back = (await page.getByRole('link', { name: '返回活动列表' }).boundingBox())!;
  expect(title.x).toBeGreaterThanOrEqual(back.x + back.width);
  await page.screenshot({ path: info.outputPath('header-dark-safe-area.png') });
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('header-large-text.png') });
});

test('活动页头：减少动态效果静态切换，无日期和短内容不误收起', async ({ page }) => {
  const control = await installFixture(page);
  Object.assign(control.activity, { startDate: null, endDate: null });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/activities/demo');
  await expect(page.locator('.workspace-header__metadata')).toHaveText('进行中');
  expect((await headerGeometry(page)).opacity).toBe(1);
  // 短内容先验收，再使用确定高度的测试内容验证滚动阈值。
  await page.locator('.workspace-content').evaluate(element => { element.setAttribute('style', 'min-height: 1800px'); });
  await scrollHeader(page, 16);
  expect((await headerGeometry(page)).opacity).toBe(1);
  await scrollHeader(page, 32);
  expect((await headerGeometry(page)).opacity).toBe(0);
  await scrollHeader(page, 16);
  expect((await headerGeometry(page)).opacity).toBe(1);
  await scrollHeader(page, 0);
  expect((await headerGeometry(page)).navBottom).toBe(128);
});

test('活动页头：加载骨架与完成后的占位一致', async ({ page }) => {
  const control = await installFixture(page);
  control.activityPending = true; control.snapshotPending = true;
  await page.goto('/activities/demo');
  await expect(page.locator('.workspace-header')).toHaveAttribute('aria-busy', 'true');
  const before = await headerGeometry(page);
  control.activityPending = false; control.snapshotPending = false;
  await expect(page.locator('.workspace-header h1')).toHaveText(control.activity.name);
  const after = await headerGeometry(page);
  expect(after.height).toBe(before.height);
  expect(after.documentTop).toBe(before.documentTop);
});
