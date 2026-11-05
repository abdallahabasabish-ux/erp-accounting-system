/**
 * اختبارات محرك القيد المزدوج — قلب الضمانات المحاسبية.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStore } from '../src/data/memory-adapter.js';
import { seedChartOfAccounts } from '../src/seed.js';
import { postJournalEntry, postReversal, getEntry, listEntries } from '../src/core/journal.js';
import { errors } from '../src/lib/errors.js';

const ACTOR = { uid: 't1', email: 't@test.eg', name: 'اختبار', role: 'accountant' };

async function freshStore() {
  const store = createMemoryStore();
  await seedChartOfAccounts(store);
  return store;
}

beforeEach(() => {});

test('القيد المتوازن يُرحَّل ويحدّث أرصدة الحسابات', async () => {
  const store = await freshStore();
  // أنشئ حساب خزينة فرعياً أولاً (كما تفعل خدمة الخزينة)
  await store.runTransaction(async (tx) => {
    tx.set(store.ref('accounts', '1110-T01'), {
      id: '1110-T01', code: '1110-T01', name: 'خزينة تجربة', type: 'asset', kind: 'posting', parent: '1110', active: true, createdAt: '2026-01-01',
    });
  });
  const { entry } = await postJournalEntry(store, {
    date: '2026-11-01', memo: 'قيد افتتاحي تجريبي',
    lines: [
      { accountCode: '1110-T01', debit: 100000, credit: 0 },
      { accountCode: '3100', debit: 0, credit: 100000 },
    ],
    actor: ACTOR,
  });
  assert.ok(entry.number.startsWith('JE-2026-'));
  assert.equal(entry.totalDebit, 100000);
  assert.equal(entry.totalCredit, 100000);
  // رصيد الخزينة بعد القيد = 1000 ج.م
  const bal = await store.get(store.ref('account_balances', '1110-T01'));
  assert.equal(bal.data.totalDebit - bal.data.totalCredit, 100000);
});

test('القيد غير المتوازن مرفوض بنيوياً', async () => {
  const store = await freshStore();
  await assert.rejects(
    () => postJournalEntry(store, {
      date: '2026-11-01', memo: 'غير متوازن',
      lines: [
        { accountCode: '3100', debit: 100000, credit: 0 },
        { accountCode: '4100', debit: 0, credit: 99999 },
      ],
      actor: ACTOR,
    }),
    (err) => err.code === 'UNBALANCED_ENTRY',
  );
});

test('الطرف الواحد مرفوض — القيد المزدوج يتطلب طرفين على الأقل', async () => {
  const store = await freshStore();
  await assert.rejects(
    () => postJournalEntry(store, {
      date: '2026-11-01', memo: 'طرف واحد',
      lines: [{ accountCode: '3100', debit: 100000, credit: 0 }],
      actor: ACTOR,
    }),
    (err) => err.code === 'BAD_REQUEST',
  );
});

test('الترحيل على حساب تجميعي مرفوض — الورقية فقط', async () => {
  const store = await freshStore();
  await assert.rejects(
    () => postJournalEntry(store, {
      date: '2026-11-01', memo: 'على مجمّع',
      lines: [
        { accountCode: '1000', debit: 1, credit: 0 },
        { accountCode: '3100', debit: 0, credit: 1 },
      ],
      actor: ACTOR,
    }),
    (err) => err.code === 'INVALID_ACCOUNT',
  );
});

test('الترحيل على حساب غير موجود مرفوض', async () => {
  const store = await freshStore();
  await assert.rejects(
    () => postJournalEntry(store, {
      date: '2026-11-01', memo: 'حساب وهمي',
      lines: [
        { accountCode: '9900', debit: 5, credit: 0 },
        { accountCode: '3100', debit: 0, credit: 5 },
      ],
      actor: ACTOR,
    }),
    (err) => err.code === 'INVALID_ACCOUNT',
  );
});

test('مفتاح التكرار (idempotency): إعادة الطلب تعيد نفس القيد', async () => {
  const store = await freshStore();
  const input = {
    date: '2026-11-02', memo: 'قيد مكرر آمن',
    lines: [
      { accountCode: '3100', debit: 700, credit: 0 },
      { accountCode: '4100', debit: 0, credit: 700 },
    ],
    actor: ACTOR, idempotencyKey: 'op-123',
  };
  const first = await postJournalEntry(store, input);
  const second = await postJournalEntry(store, input);
  assert.equal(second.idempotent, true);
  assert.equal(second.entry.id, first.entry.id);
  // لا قيد جديد أُنشئ
  const all = await store.read('journal_entries', {});
  assert.equal(all.length, 1);
});

test('القيد العكسي: أطراف معكوسة + منع العكس المزدوج', async () => {
  const store = await freshStore();
  await store.runTransaction(async (tx) => {
    tx.set(store.ref('accounts', '1110-T01'), {
      id: '1110-T01', code: '1110-T01', name: 'خزينة تجربة', type: 'asset', kind: 'posting', parent: '1110', active: true, createdAt: '2026-01-01',
    });
  });
  const { entry } = await postJournalEntry(store, {
    date: '2026-11-03', memo: 'قيد أصلي',
    lines: [
      { accountCode: '1110-T01', debit: 5000, credit: 0 },
      { accountCode: '4100', debit: 0, credit: 5000 },
    ],
    actor: ACTOR,
  });
  const { entry: rev } = await postReversal(store, {
    originalEntryId: entry.id, date: '2026-11-04', reason: 'خطأ في التسجيل الأصلي', actor: ACTOR,
  });
  assert.equal(rev.type, 'reversal');
  assert.equal(rev.reversesOf, entry.id);
  const original = await getEntry(store, entry.id);
  assert.equal(rev.lines[0].debit, original.lines[0].credit);
  assert.equal(rev.lines[0].credit, original.lines[0].debit);
  // صافي أثر القيدين على الحساب = صفر
  const bal = await store.get(store.ref('account_balances', '1110-T01'));
  assert.equal(bal.data.totalDebit - bal.data.totalCredit, 0);
  // منع العكس المزدوج
  await assert.rejects(
    () => postReversal(store, { originalEntryId: entry.id, date: '2026-11-05', reason: 'محاولة عكس ثانية', actor: ACTOR }),
    (err) => err.code === 'ALREADY_REVERSED',
  );
});

test('لا يمكن ترحيل قيد في فترة مغلقة', async () => {
  const store = await freshStore();
  // أنشئ قيداً في نوفمبر ثم أغلق الفترة
  await postJournalEntry(store, {
    date: '2026-11-01', memo: 'قبل الإغلاق',
    lines: [
      { accountCode: '3100', debit: 100, credit: 0 },
      { accountCode: '4100', debit: 0, credit: 100 },
    ],
    actor: ACTOR,
  });
  const { closePeriod } = await import('../src/core/periods.js');
  await closePeriod(store, '2026-11', ACTOR, 'إغلاق شهري تجريبي');
  await assert.rejects(
    () => postJournalEntry(store, {
      date: '2026-11-15', memo: 'بعد الإغلاق',
      lines: [
        { accountCode: '3100', debit: 50, credit: 0 },
        { accountCode: '4100', debit: 0, credit: 50 },
      ],
      actor: ACTOR,
    }),
    (err) => err.code === 'PERIOD_LOCKED',
  );
});

test('قيد الإقفال السنوي يصفّر الإيرادات والمصروفات إلى الأرباح المبقاة', async () => {
  const store = await freshStore();
  // إيراد 100000 ومصروف 40000 في فترات 2026
  await postJournalEntry(store, {
    date: '2026-03-01', memo: 'إيراد',
    lines: [
      { accountCode: '1110-T01', debit: 0, credit: 0, note: '' },
      { accountCode: '3100', debit: 100000, credit: 0 },
      { accountCode: '4100', debit: 0, credit: 100000 },
    ].filter((l) => l.debit || l.credit),
    actor: ACTOR,
  });
  await postJournalEntry(store, {
    date: '2026-04-01', memo: 'مصروف',
    lines: [
      { accountCode: '5200', debit: 40000, credit: 0 },
      { accountCode: '3100', debit: 0, credit: 40000 },
    ],
    actor: ACTOR,
  });
  // أغلق كل فترات السنة
  const { closePeriod, executeYearEndClosing } = await import('../src/core/periods.js');
  for (let m = 1; m <= 12; m += 1) {
    const key = `2026-${String(m).padStart(2, '0')}`;
    const existing = await store.get(store.ref('fiscal_periods', key));
    if (!existing.exists) {
      // أنشئ الفترة مفتوحة ثم أغلقها — عبر أي ترحيل وهمي لا يلزم؛ ensurePeriod تُنشئها
      const { ensurePeriod } = await import('../src/core/periods.js');
      await store.runTransaction(async (tx) => { await ensurePeriod(tx, store, key); });
    }
    await closePeriod(store, key, ACTOR, 'إقفال نهاية سنة تجريبي');
  }
  const result = await executeYearEndClosing(store, '2026', ACTOR);
  assert.equal(result.netProfit, 60000); // 100000 - 40000
  // الإيراد صار صفراً (مدين 100000 يعادل دائنه)
  const rev = await store.get(store.ref('account_balances', '4100'));
  assert.equal(rev.data.totalDebit - rev.data.totalCredit, 0);
  const exp = await store.get(store.ref('account_balances', '5200'));
  assert.equal(exp.data.totalDebit - exp.data.totalCredit, 0);
  // الأرباح المبقاة زادت 60000
  const re = await store.get(store.ref('account_balances', '3200'));
  assert.equal(re.data.totalCredit - re.data.totalDebit, 60000);
});

test('قائمة القيود تعمل بفلاتر متعددة', async () => {
  const store = await freshStore();
  await postJournalEntry(store, {
    date: '2026-11-01', memo: 'قيد نوفمبر تجريبي',
    lines: [
      { accountCode: '3100', debit: 10, credit: 0 },
      { accountCode: '4100', debit: 0, credit: 10 },
    ],
    actor: ACTOR,
  });
  await postJournalEntry(store, {
    date: '2026-12-01', memo: 'قيد ديسمبر تجريبي',
    lines: [
      { accountCode: '3100', debit: 20, credit: 0 },
      { accountCode: '4100', debit: 0, credit: 20 },
    ],
    actor: ACTOR,
  });
  const nov = await listEntries(store, { periodKey: '2026-11' });
  assert.equal(nov.length, 1);
  const byAccount = await listEntries(store, { accountCode: '4100' });
  assert.equal(byAccount.length, 2);
});
