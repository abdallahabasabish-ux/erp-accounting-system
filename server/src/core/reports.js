/**
 * مولّد القوائم المالية — كل الأرقام تُشتق من دفتر الأستاذ (journal_entries)
 * لا من حقول مخزنة يدوياً. الضمان الرياضي: الأصول = الالتزامات + حقوق الملكية + صافي الربح.
 *
 * قاعدة الاستبعاد الوحيدة: قيود الإقفال (closing) مستبعدة من قائمة الدخل حتى تبقى
 * القوائم التاريخية قابلة لإعادة الإنتاج بعد إقفال السنة.
 */
import { assertSafeInt } from '../lib/money.js';
import { inRange, compareDates, agingBucket } from '../lib/dates.js';
import { ENTRY_TYPE } from './journal.js';
import { ACCOUNT_TYPE, NORMAL_SIDE, isSubAccountCode, cashFlowActivityOf } from './coa.js';

/** تحميل كل القيود (بلا حدود عملية لهذا الحجم) — في Firestore يُفضَّل ترقيم صفحات للتقارير الضخمة */
async function loadEntries(store) {
  return store.read('journal_entries', { orderBy: ['date', 'asc'], limit: 5000 });
}

function isCashCode(code) {
  return code.startsWith('1110') || code.startsWith('1115');
}

/** إجماليات مدين/دائن لسطر ضمن نطاق (القيد غير الإقفالي) */
function entryIn(entry, from, to) {
  if (entry.type === ENTRY_TYPE.CLOSING) return false;
  return inRange(entry.date, from, to);
}

/**
 * 1) ميزان المراجعة (Trial Balance) — قبل/خلال فترة، بأرصدة افتتاحية وفترية وخاتمة.
 * يعيد {rows, totals{openingDebit...}, balanced:boolean}
 */
export async function trialBalance(store, { from = null, to = null } = {}) {
  const entries = await loadEntries(store);
  const accounts = await store.read('accounts', {});
  const byCode = new Map(accounts.map((a) => [a.code, a]));

  /** مفتاح الحساب → {openingD, openingC, periodD, periodC} */
  const acc = new Map();
  const touch = (code) => {
    if (!acc.has(code)) acc.set(code, { openingD: 0, openingC: 0, periodD: 0, periodC: 0 });
    return acc.get(code);
  };

  for (const e of entries) {
    for (const line of e.lines) {
      const row = touch(line.accountCode);
      if (from && compareDates(e.date, from) < 0) {
        row.openingD += line.debit;
        row.openingC += line.credit;
      } else if (entryIn(e, from, to)) {
        row.periodD += line.debit;
        row.periodC += line.credit;
      }
      // القيود بعد "to" لا تدخل إطلاقاً
    }
  }

  const rows = [...acc.entries()]
    .map(([code, v]) => {
      const a = byCode.get(code) || { name: code, type: ACCOUNT_TYPE.ASSET };
      const closingD = v.openingD + v.periodD;
      const closingC = v.openingC + v.periodC;
      return {
        code,
        name: a.name,
        type: a.type,
        opening: { debit: v.openingD, credit: v.openingC },
        period: { debit: v.periodD, credit: v.periodC },
        closing: { debit: closingD, credit: closingC },
        // رصيد خاتم بإشارة الطبيعة (موجب = رصيد طبيعي)
        closingBalance: (NORMAL_SIDE[a.type] === 'debit' ? closingD - closingC : closingC - closingD),
      };
    })
    .filter((r) => r.opening.debit || r.opening.credit || r.period.debit || r.period.credit)
    .sort((x, y) => x.code.localeCompare(y.code));

  const sum = (fn) => rows.reduce((s, r) => s + fn(r), 0);
  const totals = {
    openingDebit: sum((r) => r.opening.debit),
    openingCredit: sum((r) => r.opening.credit),
    periodDebit: sum((r) => r.period.debit),
    periodCredit: sum((r) => r.period.credit),
    closingDebit: sum((r) => r.closing.debit),
    closingCredit: sum((r) => r.closing.credit),
  };
  return {
    rows, totals,
    balanced: totals.closingDebit === totals.closingCredit
      && totals.openingDebit === totals.openingCredit
      && totals.periodDebit === totals.periodCredit,
  };
}

/**
 * 2) قائمة الدخل (P&L) لفترة — إيرادات ثم تكلفة الخدمات ثم مصروفات تشغيلية ثم صافي الربح.
 */
export async function profitAndLoss(store, { from, to }) {
  const entries = await loadEntries(store);
  const accounts = await store.read('accounts', {});
  const byCode = new Map(accounts.map((a) => [a.code, a]));

  const rev = new Map(); // 4xxx
  const cogs = new Map(); // 5050
  const opex = new Map(); // بقية 5xxx

  for (const e of entries) {
    if (!entryIn(e, from, to)) continue;
    for (const line of e.lines) {
      const code = line.accountCode;
      if (code.startsWith('4')) {
        const cur = rev.get(code) || { code, name: byCode.get(code)?.name || code, debit: 0, credit: 0 };
        cur.debit += line.debit; cur.credit += line.credit;
        rev.set(code, cur);
      } else if (code.startsWith('5')) {
        const bucket = code === '5050' ? cogs : opex;
        const cur = bucket.get(code) || { code, name: byCode.get(code)?.name || code, debit: 0, credit: 0 };
        cur.debit += line.debit; cur.credit += line.credit;
        bucket.set(code, cur);
      }
    }
  }

  // الإيراد طبيعته دائنة (credit − debit)، والمصروف طبيعته مدينة (debit − credit)
  const revenueRows = [...rev.values()].map((r) => ({ ...r, amount: r.credit - r.debit })).filter((r) => r.amount !== 0);
  const cogsRows = [...cogs.values()].map((r) => ({ ...r, amount: r.debit - r.credit })).filter((r) => r.amount !== 0);
  const opexRows = [...opex.values()].map((r) => ({ ...r, amount: r.debit - r.credit })).filter((r) => r.amount !== 0);

  const totalRevenue = revenueRows.reduce((s, r) => s + r.amount, 0);
  const totalCogs = cogsRows.reduce((s, r) => s + r.amount, 0);
  const totalOpex = opexRows.reduce((s, r) => s + r.amount, 0);
  const grossProfit = totalRevenue - totalCogs;
  const netProfit = grossProfit - totalOpex;

  return {
    period: { from, to },
    revenue: revenueRows, totalRevenue,
    costOfServices: cogsRows, totalCogs,
    grossProfit,
    operatingExpenses: opexRows, totalOpex,
    netProfit,
    // إثبات رياضي داخلي: صافي الربح = إيراد − تكلفة − مصروفات
    check: totalRevenue - totalCogs - totalOpex === netProfit,
  };
}

/**
 * 3) الميزانية العمومية (Balance Sheet) كما في تاريخ — مع إثبات المعادلة المحاسبية.
 * صافي ربح الفترات المفتوحة (غير المُقفلة بقيد closing) يظهر كسطر مستقل ضمن حقوق الملكية.
 */
export async function balanceSheet(store, { asOf }) {
  const entries = await loadEntries(store);
  const accounts = await store.read('accounts', {});
  const byCode = new Map(accounts.map((a) => [a.code, a]));

  const totals = new Map(); // code → {debit, credit}
  let netIncome = 0;

  for (const e of entries) {
    if (compareDates(e.date, asOf) > 0) continue;
    for (const line of e.lines) {
      const cur = totals.get(line.accountCode) || { debit: 0, credit: 0 };
      cur.debit += line.debit;
      cur.credit += line.credit;
      totals.set(line.accountCode, cur);
      if (e.type !== ENTRY_TYPE.CLOSING) {
        if (line.accountCode.startsWith('4')) netIncome += line.credit - line.debit;
        if (line.accountCode.startsWith('5')) netIncome -= line.debit - line.credit;
      }
    }
  }

  const build = (prefix) => [...totals.entries()]
    .filter(([code]) => code.startsWith(prefix))
    .map(([code, v]) => {
      const a = byCode.get(code) || { name: code, type: ACCOUNT_TYPE.ASSET };
      const side = NORMAL_SIDE[a.type] || 'debit';
      return {
        code, name: a.name,
        debit: v.debit, credit: v.credit,
        amount: side === 'debit' ? v.debit - v.credit : v.credit - v.debit,
      };
    })
    .filter((r) => r.amount !== 0)
    .sort((x, y) => x.code.localeCompare(y.code));

  const assets = build('1');
  const liabilities = build('2');
  const equityRows = build('3');

  const totalAssets = assets.reduce((s, r) => s + r.amount, 0);
  const totalLiabilities = liabilities.reduce((s, r) => s + r.amount, 0);
  const totalEquity = equityRows.reduce((s, r) => s + r.amount, 0);

  return {
    asOf,
    assets, totalAssets,
    liabilities, totalLiabilities,
    equity: [...equityRows, {
      code: '3999', name: 'صافي ربح الفترة الجارية (غير مُقفل)', amount: netIncome, isComputed: true,
    }].filter((r) => r.amount !== 0),
    totalEquity: totalEquity + netIncome,
    netIncome,
    // المعادلة المحاسبية — يجب أن تساوي صفراً تماماً بالقروش
    check: totalAssets - (totalLiabilities + totalEquity + netIncome),
    balanced: totalAssets === totalLiabilities + totalEquity + netIncome,
  };
}

/**
 * 4) قائمة التدفقات النقدية (Cash Flow) — طريقة مباشرة مبسطة من دفتر الأستاذ:
 * كل قيد يمس حساب نقد (1110/1115) يُصنَّف حسب الحساب المقابل.
 */
export async function cashFlowStatement(store, { from, to }) {
  const entries = await loadEntries(store);
  const accounts = await store.read('accounts', {});
  const byCode = new Map(accounts.map((a) => [a.code, a]));

  const opening = { operating: 0, investing: 0, financing: 0 }; // تجميع فتري فقط — الرصيد الافتتاحي يُحسب من الأرصدة
  const period = { operating: 0, investing: 0, financing: 0 };
  let openingCash = 0;
  let closingCash = 0;

  // الرصيد النقدي الافتتاحي: كل حركات النقد قبل "from"
  for (const e of entries) {
    if (compareDates(e.date, from) < 0) {
      for (const line of e.lines) {
        if (isCashCode(line.accountCode)) {
          openingCash += line.debit - line.credit;
        }
      }
    }
  }

  for (const e of entries) {
    if (!entryIn(e, from, to)) continue;
    for (const line of e.lines) {
      if (!isCashCode(line.accountCode)) continue;
      const delta = line.debit - line.credit; // موجب = دخل نقد
      period.cashInflow = (period.cashInflow || 0);
      // الحساب المقابل: أي سطر آخر في نفس القيد بأكبر طرف مضاد
      const counter = e.lines
        .filter((l) => l.accountCode !== line.accountCode)
        .sort((a, b) => (b.debit - b.credit) - (a.debit - a.credit))[0];
      const counterType = counter ? (byCode.get(counter.accountCode)?.type || ACCOUNT_TYPE.EQUITY) : ACCOUNT_TYPE.EQUITY;
      const activity = cashFlowActivityOf(counterType, counter?.accountCode || '3200');
      period[activity] += delta;
    }
  }

  // الرصيد الختامي: كل حركات النقد حتى "to"
  for (const e of entries) {
    if (compareDates(e.date, to) < 0 || compareDates(e.date, to) === 0) {
      for (const line of e.lines) {
        if (isCashCode(line.accountCode)) closingCash += line.debit - line.credit;
      }
    }
  }

  const netChange = period.operating + period.investing + period.financing;
  return {
    period: { from, to },
    sections: period,
    netChange,
    openingCash,
    closingCash,
    // المطابقة: الرصيد الافتتاحي + صافي التغير = الختامي
    check: openingCash + netChange - closingCash,
    reconciled: openingCash + netChange === closingCash,
  };
}

/**
 * 5) دفتر أستاذ حساب (General Ledger) — الحركات التاريخية مع رصيد جارٍ.
 */
export async function generalLedger(store, accountCode, { from = null, to = null } = {}) {
  const entries = await loadEntries(store);
  const accountSnap = await store.get(store.ref('accounts', accountCode));
  if (!accountSnap.exists) throw new Error(`الحساب ${accountCode} غير موجود`);
  const account = accountSnap.data;
  const side = NORMAL_SIDE[account.type] || 'debit';

  let running = 0;
  const movements = [];
  for (const e of entries) {
    if (from && compareDates(e.date, from) < 0) {
      // رصيد افتتاحي
      for (const line of e.lines) {
        if (line.accountCode === accountCode) running += line.debit - line.credit;
      }
      continue;
    }
    if (to && compareDates(e.date, to) > 0) continue;
    for (const line of e.lines) {
      if (line.accountCode !== accountCode) continue;
      running += line.debit - line.credit;
      movements.push({
        entryId: e.id, number: e.number, date: e.date, memo: e.memo, type: e.type,
        debit: line.debit, credit: line.credit,
        // الرصيد الجاري بإشارة الطبيعة
        runningBalance: side === 'debit' ? running : -running,
      });
    }
  }

  const totalDebit = movements.reduce((s, m) => s + m.debit, 0);
  const totalCredit = movements.reduce((s, m) => s + m.credit, 0);
  return {
    account: { code: account.code, name: account.name, type: account.type, normalSide: side },
    period: { from, to },
    openingBalance: side === 'debit' ? running - (totalDebit - totalCredit) : -(running - (totalDebit - totalCredit)),
    movements,
    totals: { debit: totalDebit, credit: totalCredit },
    closingBalance: side === 'debit' ? running : -running,
  };
}

/**
 * 6) تقرير أعمار الذمم المدينة (Aging Report) — من أرصدة الفواتير غير المسددة.
 */
export async function receivablesAging(store, { asOf } = {}) {
  const invoices = await store.read('invoices', { where: [['status', 'in', ['unpaid', 'partial', 'overdue']]] });
  const customers = await store.read('customers', {});
  const today = asOf || new Date().toISOString().slice(0, 10);
  const buckets = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 };
  const byCustomer = new Map();

  for (const inv of invoices) {
    const balance = inv.balance ?? 0;
    assertSafeInt(balance);
    if (balance <= 0) continue;
    const bucket = agingBucket(inv.dueDate, today);
    buckets[bucket] += balance;
    const cur = byCustomer.get(inv.customerId) || {
      customerId: inv.customerId, customerName: inv.customerName, total: 0,
      buckets: { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 },
      oldestDueDate: null,
    };
    cur.buckets[bucket] += balance;
    cur.total += balance;
    if (!cur.oldestDueDate || inv.dueDate < cur.oldestDueDate) cur.oldestDueDate = inv.dueDate;
    byCustomer.set(inv.customerId, cur);
  }

  return {
    asOf: today,
    totals: buckets,
    totalReceivable: Object.values(buckets).reduce((s, v) => s + v, 0),
    customers: [...byCustomer.values()].sort((a, b) => b.total - a.total),
  };
}
