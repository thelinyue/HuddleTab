import type { Page } from '@playwright/test';

/** 与 A/B 原型相同的 6 人、5 天、30 笔旅行样本，仅供测试接口返回；不进入产品构建。 */
export async function installTravelFixture(page: Page, currentMember = 0) {
  const names = ['小林', '小王', '小李', '小陈', '小赵', '小刘'];
  const members = names.map((displayName, i) => ({ activityId: 'travel', memberId: `m${i}`, displayName, avatarPreset: i, role: i === 1 ? 'OWNER' : 'MEMBER', status: 'ACTIVE', userId: `u${i}`, version: '1' }));
  const activity = { activityId: 'travel', name: '云南五日游', baseCurrency: 'CNY', status: 'ACTIVE', startDate: '2026-09-20', endDate: '2026-09-24', coverPreset: 5, coverImageId: null, currentMemberId: `m${currentMember}`, currentMemberRole: currentMember === 1 ? 'OWNER' : 'MEMBER', ownerMemberId: 'm1', revision: '1', version: '1', location: '云南', allowedLifecycleActions: [], fieldPermissions: {}, canDelete: false, hasAccountingRecords: true };
  function expense(id: string, title: string, amount: number, payer: number, shares: Record<string, number>, day: number, category = 'FOOD') {
    return {
      expense: { expenseId: id, activityId: 'travel', title, note: id === 'e24' ? '靠窗的六人桌，含饮料' : '旅行共同支出', baseAmountMinor: String(amount), originalAmountMinor: String(amount), originalCurrency: 'CNY', baseCurrency: 'CNY', category, occurredAt: `2026-09-${day}T10:00:00Z`, createdAt: `2026-09-${day}T10:00:00Z`, exchangeRate: '1', exchangeRateKind: 'IDENTITY', splitMode: 'EXACT', version: '1', revision: '1', clientMutationId: id },
      payments: [{ memberId: `m${payer}`, originalAmountMinor: String(amount), baseAmountMinor: String(amount) }],
      shares: Object.entries(shares).map(([memberId, n]) => ({ memberId, originalAmountMinor: String(n), baseAmountMinor: String(n) })),
      attachments: [],
    };
  }
  const titles = ['早餐', '打车', '门票', '午餐', '下午茶', '晚餐'];
  const expenses = Array.from({ length: 24 }, (_, i) => expense(`e${i + 1}`, i === 23 ? '古城晚餐' : titles[i % 6], 12000, i % 6, Object.fromEntries([6000, 3000, 1500, 1500].map((n, j) => [`m${(i + j) % 6}`, n])), 20 + Math.floor(i / 6), i % 6 === 1 ? 'TRANSPORT' : 'FOOD'));
  const extras: Array<[string, number, number, number]> = [['客房升级', 70000, 1, 0], ['体验课程', 18000, 2, 0], ['接送机', 32000, 1, 3], ['温泉套票', 45000, 5, 4], ['个人纪念品', 6000, 0, 0], ['个人门票', 8000, 2, 2]];
  extras.forEach(([title, amount, payer, participant], i) => expenses.push(expense(`e${25 + i}`, title, amount, payer, { [`m${participant}`]: amount }, 24, 'OTHER')));
  const records = [{ settlementId: 's1', activityId: 'travel', payerMemberId: 'm0', receiverMemberId: 'm1', currency: 'CNY', amountMinor: '20000', status: 'ACTIVE', createdAt: '2026-09-23T12:00:00Z', version: '1', allocations: [] as Array<{ expenseId: string; amountMinor: string }> }];
  const control = { activity, members, expenses, records, aiAvailable: true, failWrite: false, writeDelay: 0, ledgerError: false, writes: [] as Array<Record<string, unknown>>, overrideBalances: undefined as number[] | undefined };
  // 这是测试响应模型，用来验证前端是否遵循刷新后的接口数据，不代替 Rust 账务测试。
  function balances() {
    const values = members.map(() => 0);
    expenses.forEach(item => {
      item.payments.forEach(p => { values[Number(p.memberId.slice(1))] += Number(p.baseAmountMinor); });
      item.shares.forEach(p => { values[Number(p.memberId.slice(1))] -= Number(p.baseAmountMinor); });
    });
    records.filter(r => r.status === 'ACTIVE').forEach(r => { values[Number(r.payerMemberId.slice(1))] += Number(r.amountMinor); values[Number(r.receiverMemberId.slice(1))] -= Number(r.amountMinor); });
    return members.map((m, i) => ({ memberId: m.memberId, displayName: m.displayName, netMinor: String(control.overrideBalances?.[i] ?? values[i]) }));
  }
  function recommendations(strategy = 'min_transfers', hub = activity.currentMemberId) {
    const all = balances();
    const rows: Array<{ payerMemberId: string; receiverMemberId: string; amountMinor: string }> = [];
    if (strategy === 'centralized') {
      all.filter(b => b.memberId !== hub && Number(b.netMinor) !== 0).forEach(b => rows.push({ payerMemberId: Number(b.netMinor) < 0 ? b.memberId : hub, receiverMemberId: Number(b.netMinor) < 0 ? hub : b.memberId, amountMinor: String(Math.abs(Number(b.netMinor))) }));
    } else {
      const debtors = all.filter(b => Number(b.netMinor) < 0).map(b => ({ id: b.memberId, amount: -Number(b.netMinor) })).sort((a, b) => b.amount - a.amount);
      const creditors = all.filter(b => Number(b.netMinor) > 0).map(b => ({ id: b.memberId, amount: Number(b.netMinor) })).sort((a, b) => b.amount - a.amount);
      for (const d of debtors) for (const c of creditors) { const n = Math.min(d.amount, c.amount); if (n > 0) { rows.push({ payerMemberId: d.id, receiverMemberId: c.id, amountMinor: String(n) }); d.amount -= n; c.amount -= n; } }
    }
    return { recommendations: rows, effectiveStrategy: strategy === 'centralized' ? 'CENTRALIZED' : 'MIN_TRANSFERS', hubMemberId: strategy === 'centralized' ? hub : null, baseCurrency: 'CNY', revision: activity.revision };
  }
  await page.route('**/api/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const endpoint = url.pathname.split('/').at(-1);
    if (endpoint === 'ledger' && control.ledgerError) { await route.fulfill({ status: 503, json: { error: { message: '余额暂时无法读取' } } }); return; }
    let data: unknown = [];
    if (request.method() !== 'GET') {
      const body = request.postDataJSON();
      control.writes.push(body);
      if (control.writeDelay) await new Promise(resolve => setTimeout(resolve, control.writeDelay));
      if (control.failWrite) { await route.fulfill({ status: 409, json: { error: { message: '记录冲突，请重试' } } }); return; }
      if (endpoint === 'expenses') {
        const total = Number(body.originalAmountMinor);
        const ids: string[] = body.split.members ?? [];
        const shares = body.split.entries ? Object.fromEntries(body.split.entries.map((p: { memberId: string; amountMinor: string }) => [p.memberId, Number(p.amountMinor)])) : Object.fromEntries(ids.map((id, i) => [id, Math.floor(total / ids.length) + (i < total % ids.length ? 1 : 0)]));
        const next = expense(`e${expenses.length + 1}`, body.title, total, Number(body.payments[0].memberId.slice(1)), shares, 24, body.category);
        Object.assign(next.expense, { note: body.note ?? '', occurredAt: body.occurredAt, clientMutationId: body.clientMutationId, splitMode: body.split.mode });
        expenses.unshift(next); data = next;
      } else if (endpoint === 'settlements') {
        const next = { ...records[0], ...body, settlementId: `s${records.length + 1}`, createdAt: `2026-09-24T12:00:${String(records.length).padStart(2, '0')}Z`, status: 'ACTIVE', version: '1' };
        records.push(next); data = next;
      } else if (endpoint === 'void') {
        const record = records.find(r => r.settlementId === url.pathname.split('/').at(-2))!;
        record.status = 'VOID'; data = record;
      } else if (records.some(r => r.settlementId === endpoint)) {
        const record = records.find(r => r.settlementId === endpoint)!; Object.assign(record, body); data = record;
      } else if (expenses.some(e => e.expense.expenseId === endpoint)) {
        const item = expenses.find(e => e.expense.expenseId === endpoint)!;
        if (request.method() === 'DELETE') expenses.splice(expenses.indexOf(item), 1);
        else Object.assign(item.expense, body);
        data = item;
      }
      activity.revision = String(Number(activity.revision) + 1);
    } else if (endpoint === 'session') data = { userId: `u${currentMember}`, username: 'travel', displayName: names[currentMember], isSystemAdmin: false };
    else if (endpoint === 'csrf') data = { token: 'travel-fixture' };
    else if (endpoint === 'activities') data = [activity];
    else if (endpoint === 'travel') data = activity;
    else if (endpoint === 'members') data = members;
    else if (endpoint === 'capabilities') data = { textDraftAvailable: control.aiAvailable, imageDraftAvailable: control.aiAvailable };
    else if (endpoint === 'ledger') data = { balances: balances() };
    else if (endpoint === 'recommendations') data = recommendations(url.searchParams.get('strategy') ?? 'min_transfers', url.searchParams.get('hubMemberId') ?? activity.currentMemberId);
    else if (endpoint === 'settlements') data = records;
    else if (endpoint === 'expenses') data = expenses;
    else if (expenses.some(e => e.expense.expenseId === endpoint)) data = expenses.find(e => e.expense.expenseId === endpoint);
    else if (endpoint === 'snapshot') data = { activity, members, expenses, ledger: { balances: balances() }, recommendations: recommendations(), settlements: records, revision: activity.revision };
    await route.fulfill({ json: { data }, headers: { etag: `"travel-${activity.revision}"` } });
  });
  return { ...control, balances, recommendations, control };
}
