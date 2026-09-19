import { expect, test, type Page } from '@playwright/test';

type InstallOptions = { capabilityAvailable?: boolean; ambiguous?: boolean; imageAvailable?: boolean; textDelayMs?: number };

const activity = {
  activityId: 'demo',
  name: 'AI 录入测试活动',
  baseCurrency: 'CNY',
  status: 'ACTIVE',
  startDate: '2026-09-05',
  endDate: '2026-09-06',
  currentMemberId: 'm0',
  currentMemberRole: 'OWNER',
  ownerMemberId: 'm0',
  revision: '1',
  version: '1',
};

const members = [
  { activityId: 'demo', memberId: 'm0', displayName: '小林', avatarPreset: 0, role: 'OWNER', status: 'ACTIVE', userId: 'u0', version: '1' },
  { activityId: 'demo', memberId: 'm1', displayName: '小王', avatarPreset: 1, role: 'MEMBER', status: 'ACTIVE', userId: 'u1', version: '1' },
  { activityId: 'demo', memberId: 'm2', displayName: '小王', avatarPreset: 2, role: 'MEMBER', status: 'ACTIVE', userId: 'u2', version: '1' },
];

const otherActivity = {
  ...activity,
  activityId: 'other',
  name: '另一活动',
};

const otherMembers = members.map((member) => ({ ...member, activityId: 'other' }));

function draft(ambiguous: boolean) {
  return {
    title: 'AI 晚餐草稿', merchant: 'AI 晚餐草稿', amount: { amountMinor: '12800', currency: 'CNY' },
    occurredAt: '2026-09-18T12:00:00Z', categorySuggestion: 'FOOD', location: null, note: '模型备注', items: [], warnings: [], incompleteFields: [],
    payerSuggestions: [{ mention: '我', matchStatus: 'MATCHED', memberId: 'm0', candidateMemberIds: [], matchedDisplayName: '小林', candidateCount: null, amount: { amountMinor: '12800', currency: 'CNY' } }],
    splitSuggestion: { mode: 'EQUAL', participants: ambiguous
      ? [{ mention: '我', matchStatus: 'MATCHED', memberId: 'm0', candidateMemberIds: [], matchedDisplayName: '小林', candidateCount: null, value: null }, { mention: '小王', matchStatus: 'AMBIGUOUS', memberId: null, candidateMemberIds: ['m1', 'm2'], matchedDisplayName: null, candidateCount: 2, value: null }]
      : [{ mention: '我', matchStatus: 'MATCHED', memberId: 'm0', candidateMemberIds: [], matchedDisplayName: '小林', candidateCount: null, value: null }, { mention: '小王', matchStatus: 'MATCHED', memberId: 'm1', candidateMemberIds: [], matchedDisplayName: '小王', candidateCount: null, value: null }] },
  };
}

function aggregateFromInput(input: Record<string, any>) {
  const splitMembers = input.split.mode === 'EQUAL' ? input.split.members : input.split.entries.map((entry: { memberId: string }) => entry.memberId);
  return {
    expense: {
      expenseId: 'expense-ai-1', activityId: 'demo', clientMutationId: input.clientMutationId, title: input.title, note: input.note ?? null, category: input.category,
      occurredAt: input.occurredAt, originalCurrency: input.originalCurrency, originalAmountMinor: input.originalAmountMinor, baseCurrency: 'CNY', baseAmountMinor: input.originalAmountMinor,
      exchangeRateKind: input.exchangeRateKind, exchangeRate: input.exchangeRate, exchangeRateProvider: null, exchangeRateReferenceDate: null, splitMode: input.split.mode,
      version: '1', revision: '2', createdAt: input.occurredAt, updatedAt: input.occurredAt,
    },
    payments: input.payments.map((payment: { memberId: string; amountMinor: string }, index: number) => ({ factId: `payment-ai-${index}`, memberId: payment.memberId, originalAmountMinor: payment.amountMinor, baseAmountMinor: payment.amountMinor })),
    shares: splitMembers.map((memberId: string, index: number) => ({ factId: `share-ai-${index}`, memberId, originalAmountMinor: input.originalAmountMinor, baseAmountMinor: input.originalAmountMinor })),
    attachments: [],
    settlementProgress: { currency: 'CNY', members: [], remainingMinor: '0', settledMinor: '0', status: 'NO_SETTLEMENT_REQUIRED', totalRequiredMinor: '0' },
  };
}

async function installFixture(page: Page, options: InstallOptions = {}) {
  const controls = { capabilityCalls: 0, textCalls: 0, imageCalls: 0, expenses: [] as Array<Record<string, any>>, writes: [] as unknown[] };
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const isOtherActivity = path.includes('/activities/other/');
    const currentActivity = isOtherActivity ? otherActivity : activity;
    const currentMembers = isOtherActivity ? otherMembers : members;
    if (path.endsWith('/ai/expense-draft/capabilities')) {
      controls.capabilityCalls += 1;
      if (options.capabilityAvailable === false) { await route.fulfill({ status: 503, json: { error: { code: 'AI_PROVIDER_UNAVAILABLE', message: '暂不可用' } } }); return; }
      await route.fulfill({ json: { data: { textDraftAvailable: true, imageDraftAvailable: options.imageAvailable === true } } }); return;
    }
    if (path.endsWith('/ai/expense-draft/text')) {
      controls.textCalls += 1;
      if (options.textDelayMs) await new Promise((resolve) => setTimeout(resolve, options.textDelayMs));
      try { await route.fulfill({ json: { data: draft(Boolean(options.ambiguous)) } }); } catch { /* 浏览器取消请求时 Provider 夹具无需返回 */ }
      return;
    }
    if (path.endsWith('/ai/expense-draft/image')) {
      controls.imageCalls += 1;
      await route.fulfill({ json: { data: draft(Boolean(options.ambiguous)) } }); return;
    }
    if (request.method() !== 'GET') {
      if (path.includes('/attachments')) {
        controls.writes.push({ file: true });
        await route.fulfill({ json: { data: {} } }); return;
      }
      if (path.endsWith('/expenses')) {
        const input = request.postDataJSON() as Record<string, any>;
        controls.writes.push(input);
        const aggregate = aggregateFromInput(input);
        controls.expenses.push(aggregate);
        await route.fulfill({ json: { data: aggregate } }); return;
      }
      controls.writes.push(request.postDataJSON());
      await route.fulfill({ json: { data: {} } }); return;
    }
    let data: unknown = [];
    if (path.endsWith('/session')) data = { userId: 'u0', username: 'demo', displayName: '小林', isSystemAdmin: false };
    else if (path.endsWith('/csrf')) data = { token: 'fixture' };
    else if (path.endsWith('/snapshot')) data = { activity: currentActivity, members: currentMembers, expenses: controls.expenses, ledger: { balances: [] }, recommendations: { recommendations: [] }, settlements: [], revision: '1' };
    else if (path.endsWith('/members')) data = currentMembers;
    else if (path.endsWith('/expenses')) data = controls.expenses;
    else if (path.endsWith('/ledger')) data = { balances: [] };
    else if (path.endsWith('/recommendations')) data = { recommendations: [] };
    else if (path.endsWith('/settlements')) data = [];
    else if (path.endsWith('/demo')) data = activity;
    else if (path.endsWith('/other')) data = otherActivity;
    await route.fulfill({ json: { data }, headers: { etag: '"ai-fixture-1"' } });
  });
  return controls;
}

async function openSmartEntry(page: Page) {
  await page.goto('/activities/demo/expenses/new');
  await expect(page.getByRole('heading', { name: '新增账单' })).toBeVisible();
  await page.getByRole('button', { name: '智能录入' }).click();
  await expect(page.getByRole('heading', { name: '智能录入' })).toBeVisible();
}

test('智能录入文字草稿经过隐私确认、成员预填、修改后保存到流水', async ({ page }) => {
  const controls = await installFixture(page);
  await openSmartEntry(page);
  await expect(page.getByRole('tab', { name: '上传小票' })).not.toBeVisible();
  await page.getByRole('textbox', { name: '账单描述' }).fill('昨晚居酒屋消费 12800 元，我先付。');
  await page.getByRole('button', { name: '生成账单草稿' }).click();
  expect(controls.textCalls).toBe(0);
  await expect(page.getByRole('alert')).toContainText('确认');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: '重新生成草稿' }).click();
  await expect(page.getByRole('region', { name: '智能录入提示' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '记一笔' })).toBeVisible();
  await expect(page.getByRole('button', { name: '付款人：小林' })).toBeVisible();
  await expect(page.getByRole('button', { name: '参与人：2 人' })).toBeVisible();
  await expect(page.getByLabel('金额')).toHaveValue('128.00');
  await page.getByLabel('用途').fill('修改后晚餐');
  await page.getByLabel('金额').fill('130.00');
  await page.getByRole('button', { name: '保存' }).click();
  await expect(page.getByRole('link', { name: /修改后晚餐/ })).toBeVisible();
  expect(controls.writes.some((write) => (write as { title?: string }).title === '修改后晚餐')).toBe(true);
});

test('capability 失败时直接进入手动流程', async ({ page }) => {
  await installFixture(page, { capabilityAvailable: false });
  await page.goto('/activities/demo/expenses/new');
  await expect(page.getByLabel('金额')).toBeVisible();
  await expect(page.getByRole('heading', { name: '新增账单' })).not.toBeVisible();
  await expect(page.getByText('智能录入暂不可用')).toBeVisible();
});

test('AMBIGUOUS 成员只展示候选，不自动选择', async ({ page }) => {
  await installFixture(page, { ambiguous: true });
  await openSmartEntry(page);
  await page.getByRole('textbox', { name: '账单描述' }).fill('小王参与的晚餐');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: '生成账单草稿' }).click();
  await expect(page.getByText(/候选成员/)).toBeVisible();
  await expect(page.getByRole('button', { name: '参与人：1 人' })).toBeVisible();
  await expect(page.getByRole('button', { name: '参与人：2 人' })).not.toBeVisible();
});

test('390×844 智能录入无横向溢出', async ({ page }) => {
  await installFixture(page);
  await openSmartEntry(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('textbox', { name: '账单描述' }).fill('一笔移动端晚餐');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: '生成账单草稿' }).click();
  await expect(page.getByRole('heading', { name: '记一笔' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('小票图片预览、隐私确认、识别成功且默认不保存附件', async ({ page }) => {
  const controls = await installFixture(page, { imageAvailable: true });
  await openSmartEntry(page);
  await page.getByRole('tab', { name: '上传小票' }).click();
  await page.locator('#ai-expense-image').setInputFiles({ name: 'receipt.png', mimeType: 'image/png', buffer: Buffer.from([137, 80, 78, 71]) });
  await expect(page.getByAltText('待识别的小票预览')).toBeVisible();
  await page.getByRole('button', { name: '识别小票' }).click();
  expect(controls.imageCalls).toBe(0);
  await page.getByRole('checkbox', { name: /确认将小票图片/ }).check();
  await page.getByRole('button', { name: '重新识别' }).click();
  await expect(page.getByRole('heading', { name: '记一笔' })).toBeVisible();
  expect(controls.imageCalls).toBe(1);
  await page.getByRole('button', { name: '保存' }).click();
  await expect.poll(() => controls.writes.filter((write) => typeof write === 'object' && write !== null && 'title' in write).length).toBeGreaterThan(0);
  expect(controls.writes.some((write) => typeof write === 'object' && write !== null && 'file' in write)).toBe(false);
});

test('开启保存附件后沿用既有附件上传流程', async ({ page }) => {
  const controls = await installFixture(page, { imageAvailable: true });
  await openSmartEntry(page);
  await page.getByRole('tab', { name: '上传小票' }).click();
  await page.locator('#ai-expense-image').setInputFiles({ name: 'receipt.png', mimeType: 'image/png', buffer: Buffer.from([137, 80, 78, 71]) });
  await page.getByRole('checkbox', { name: '同时保存为账单附件' }).check();
  await page.getByRole('checkbox', { name: /确认将小票图片/ }).check();
  await page.getByRole('button', { name: '识别小票' }).click();
  await expect(page.getByRole('heading', { name: '记一笔' })).toBeVisible();
  await page.getByRole('button', { name: '保存' }).click();
  await expect.poll(() => controls.writes.filter((write) => typeof write === 'object' && write !== null && 'file' in write).length).toBeGreaterThan(0);
});

test('取消请求后输入仍保留且旧响应不覆盖状态', async ({ page }) => {
  const controls = await installFixture(page, { textDelayMs: 800 });
  await openSmartEntry(page);
  await page.getByRole('textbox', { name: '账单描述' }).fill('取消测试账单');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: '生成账单草稿' }).click();
  await page.getByRole('button', { name: '取消智能录入' }).click();
  await expect(page.getByRole('status')).toContainText('请求已取消');
  await expect(page.getByRole('textbox', { name: '账单描述' })).toHaveValue('取消测试账单');
  await page.waitForTimeout(900);
  await expect(page.getByRole('heading', { name: '记一笔' })).not.toBeVisible();
  expect(controls.textCalls).toBe(1);
});

test('切换 Activity 后丢弃旧草稿响应', async ({ page }) => {
  await installFixture(page, { textDelayMs: 800 });
  await openSmartEntry(page);
  await page.getByRole('textbox', { name: '账单描述' }).fill('旧活动账单');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: '生成账单草稿' }).click();
  await page.goto('/activities/other/expenses/new');
  await expect(page.getByRole('heading', { name: '新增账单' })).toBeVisible();
  await page.waitForTimeout(900);
  await expect(page.getByText('AI 晚餐草稿')).not.toBeVisible();
});

test('离线时不请求 capability 并保留手动新增入口', async ({ page }) => {
  const controls = await installFixture(page);
  await page.goto('/activities/demo');
  await expect(page.getByRole('heading', { name: '全部流水' })).toBeVisible();
  try {
    await page.getByRole('button', { name: '记一笔' }).click();
    await expect(page.getByLabel('金额')).toBeVisible();
    await page.context().setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    expect(controls.capabilityCalls).toBe(0);
    await expect(page.getByRole('button', { name: '智能录入' })).not.toBeVisible();
  } finally {
    await page.context().setOffline(false);
  }
});

test('当前 ArrayBuffer 附件记录在浏览器 IndexedDB 中可读', async ({ page }) => {
  await page.goto('/manifest.webmanifest');
  const result = await page.evaluate(async () => {
    const databaseName = `huddletab:compat-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const bytes = new TextEncoder().encode('synthetic-attachment');
    const record = await new Promise<any>((resolve, reject) => {
      const request = indexedDB.open(databaseName, 1);
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore('pending_attachments', { keyPath: 'id' });
        store.createIndex('by-mutation', 'mutationId');
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction('pending_attachments', 'readwrite');
        transaction.objectStore('pending_attachments').put({
          id: 'synthetic', userId: 'compat', activityId: 'activity', mutationId: 'mutation',
          clientAttachmentId: 'client', fileName: 'synthetic.png', mimeType: 'image/png',
          lastModified: 1_700_000_000_000, blob: bytes.buffer, status: 'PENDING',
          attemptCount: 0, nextAttemptAt: 0, createdAt: 0, updatedAt: 0,
        });
        transaction.oncomplete = () => {
          const readTransaction = database.transaction('pending_attachments', 'readonly');
          const readRequest = readTransaction.objectStore('pending_attachments').get('synthetic');
          readRequest.onsuccess = () => {
            database.close();
            resolve(readRequest.result);
          };
          readRequest.onerror = () => reject(readRequest.error);
        };
        transaction.onerror = () => reject(transaction.error);
      };
    });
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase(databaseName);
      request.onsuccess = request.onerror = request.onblocked = () => resolve();
    });
    return {
      isArrayBuffer: Object.prototype.toString.call(record.blob) === '[object ArrayBuffer]',
      byteLength: record.blob.byteLength,
      fileName: record.fileName,
      mimeType: record.mimeType,
      lastModified: record.lastModified,
    };
  });
  expect(result).toEqual({
    isArrayBuffer: true,
    byteLength: 'synthetic-attachment'.length,
    fileName: 'synthetic.png',
    mimeType: 'image/png',
    lastModified: 1_700_000_000_000,
  });
});
