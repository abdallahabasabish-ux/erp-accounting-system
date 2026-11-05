/**
 * الفترات المالية وإغلاقها (Fiscal Periods & Accrual Enforcement).
 *
 * القاعدة: لا قيد يُرحَّل بتاريخ فاقد لفترة مغلقة أو مقفلة — منعاً باتاً،
 * وأي تصحيح لخطأ في فترة مغلقة يتم بقيد عكسي/تسوية في أول فترة مفتوحة
 * (وهذا ما تقتضيه سلسلة التدقيق).
 *
 * حالة الفترة:
 *   open    = تُقبل قيود جديدة
 *   closed  = مغلقة أمام القيود، يمكن إعادة فتحها بصلاحية مدير + سبب موثق
 *   locked  = مقفلة نهائياً (بعد إقفال السنة المالية) — لا إعادة فتح من الواجهة إطلاقاً
 *
 * الفترات تُنشأ تلقائياً (open) عند أول قيد يقع فيها.
 */
import { periodKeyOf, periodBounds, isValidISODate, nowISO } from '../lib/dates.js';
import { errors } from '../lib/errors.js';

export const PERIOD_STATUS = { OPEN: 'open', CLOSED: 'closed', LOCKED: 'locked' };

/** قراءة فترة (أو إنشاؤها تلقائياً مفتوحة إن لم توجد — داخل المعاملة) */
export async function ensurePeriod(tx, store, periodKey) {
  const ref = store.ref('fiscal_periods', periodKey);
  const snap = await tx.get(ref);
  if (snap.exists) return snap.data;
  const data = {
    id: periodKey,
    key: periodKey,
    status: PERIOD_STATUS.OPEN,
    start: periodBounds(periodKey).start,
    end: periodBounds(periodKey).end,
    closedAt: null, closedBy: null, closeReason: null,
    reopenedAt: null, reopenedBy: null,
    createdAt: nowISO(),
  };
  tx.set(ref, data);
  return data;
}

/** بوابة إلزامية: التحقق من أن تاريخ الترحيل يقع في فترة مفتوحة (تُستدعى داخل المعاملة) */
export async function assertPeriodOpenForDate(tx, store, isoDate) {
  if (!isValidISODate(isoDate)) throw errors.badRequest(`تاريخ ترحيل غير صالح: ${isoDate}`);
  const key = periodKeyOf(isoDate);
  const period = await ensurePeriod(tx, store, key);
  if (period.status === PERIOD_STATUS.LOCKED) {
    throw errors.periodLocked(key);
  }
  if (period.status === PERIOD_STATUS.CLOSED) {
    throw errors.periodLocked(key);
  }
  return period;
}

/** إغلاق فترة (صلاحية: مدير) — يُمنع الإغلاق إن وُجدت مسيرات رواتب مسودة في نفس الفترة */
export async function closePeriod(store, periodKey, actor, reason) {
  if (!reason || reason.trim().length < 5) {
    throw errors.badRequest('سبب إغلاق الفترة إلزامي (5 أحرف على الأقل) لأغراض سجل التدقيق');
  }
  return store.runTransaction(async (tx) => {
    const period = await ensurePeriod(tx, store, periodKey);
    if (period.status !== PERIOD_STATUS.OPEN) {
      throw errors.conflict('PERIOD_ALREADY_CLOSED', `الفترة ${periodKey} ليست مفتوحة (حالتها: ${period.status})`);
    }
    // لا نغلق فترة فيها مسير رواتب مسودة — يجب اعتماده أو حذفه أولاً
    const drafts = await store.read('payroll_runs', { where: [['period', '==', periodKey]] });
    if (drafts.some((r) => r.status === 'draft')) {
      throw errors.conflict('PERIOD_HAS_DRAFT_PAYROLL', `توجد مسيرات رواتب مسودة في ${periodKey} — اعتمدها أو احذفها قبل الإغلاق`);
    }
    const updated = {
      ...period,
      status: PERIOD_STATUS.CLOSED,
      closedAt: nowISO(),
      closedBy: { uid: actor.uid, email: actor.email, name: actor.name || '' },
      closeReason: reason.trim(),
    };
    tx.set(store.ref('fiscal_periods', periodKey), updated);
    return updated;
  });
}

/** إعادة فتح فترة مغلقة (صلاحية: مدير فقط، وسبب إلزامي — تُسجل في التدقيق) */
export async function reopenPeriod(store, periodKey, actor, reason) {
  if (!reason || reason.trim().length < 10) {
    throw errors.badRequest('سبب إعادة فتح الفترة إلزامي (10 أحرف على الأقل) ويُوثَّق في سجل التدقيق');
  }
  return store.runTransaction(async (tx) => {
    const ref = store.ref('fiscal_periods', periodKey);
    const snap = await tx.get(ref);
    if (!snap.exists) throw errors.notFound('الفترة');
    const period = snap.data;
    if (period.status === PERIOD_STATUS.LOCKED) {
      throw errors.forbidden('الفترة مقفلة نهائياً بعد إقفال السنة المالية — لا يمكن إعادة فتحها من الواجهة');
    }
    const updated = {
      ...period,
      status: PERIOD_STATUS.OPEN,
      reopenedAt: nowISO(),
      reopenedBy: { uid: actor.uid, email: actor.email, name: actor.name || '' },
      reopenReason: reason.trim(),
    };
    tx.set(ref, updated);
    return updated;
  });
}

/**
 * مخطط قيد الإقفال السنوي (بدون ترحيل): يحسب أطراف تصفير الإيرادات (4xxx)
 * والمصروفات (5xxx) إلى حساب الأرباح المبقاة (3200).
 * الترحيل الفعلي يتم عبر postYearEndClosing في طبقة الخدمة (بصلاحية مدير)
 * باستدعاء المحرك مع bypassPeriodCheck=true لأن فترات السنة كلها مغلقة.
 */
export async function planYearEndClosing(store, year) {
  if (!/^\d{4}$/.test(year)) throw errors.badRequest('السنة بصيغة YYYY مطلوبة');
  // فحص: كل فترات السنة مغلقة أو مقفلة
  for (let m = 1; m <= 12; m += 1) {
    const key = `${year}-${String(m).padStart(2, '0')}`;
    const snap = await store.get(store.ref('fiscal_periods', key));
    if (!snap.exists || snap.data.status === PERIOD_STATUS.OPEN) {
      throw errors.conflict('YEAR_HAS_OPEN_PERIODS', `لا يمكن إقفال السنة قبل إغلاق كل فتراتها — الفترة ${key} غير مغلقة`);
    }
  }
  // تجميع أرصدة الإيرادات والمصروفات من سجلات الأرصدة
  const balances = await store.read('account_balances', {});
  const lines = [];
  let net = 0;
  for (const b of balances) {
    const code = b.code;
    if (!code.startsWith('4') && !code.startsWith('5')) continue;
    const debit = b.totalDebit || 0;
    const credit = b.totalCredit || 0;
    if (debit === 0 && credit === 0) continue;
    if (code.startsWith('4')) {
      // الإيراد طبيعته دائن → ندين به لتصفيره
      lines.push({ accountCode: code, debit: credit - debit, credit: 0, note: 'إقفال إيراد' });
      net += credit - debit;
    } else {
      // المصروف طبيعته مدين → ندائن به لتصفيره
      lines.push({ accountCode: code, debit: 0, credit: debit - credit, note: 'إقفال مصروف' });
      net -= debit - credit;
    }
  }
  if (lines.length === 0) throw errors.conflict('NOTHING_TO_CLOSE', 'لا توجد أرصدة إيرادات/مصروفات لإقفالها');
  lines.push(net >= 0
    ? { accountCode: '3200', debit: 0, credit: net, note: 'صافي ربح السنة' }
    : { accountCode: '3200', debit: -net, credit: 0, note: 'صافي خسارة السنة' });
  return { year, lines, netProfit: net };
}

/** قائمة الفترات المعروفة (مرتبة تنازلياً) */
export async function listPeriods(store) {
  const rows = await store.read('fiscal_periods', { orderBy: ['key', 'desc'], limit: 120 });
  return rows;
}

/** تنفيذ الإقفال: ترحيل قيد الإقفال + قفل فترات السنة كلها (locked) */
export async function executeYearEndClosing(store, year, actor) {
  const plan = await planYearEndClosing(store, year);
  const closingDate = `${year}-12-31`;
  const result = await store.runTransaction(async (tx) => {
    const { postJournalEntryTx } = await import('./journal.js');
    const { entry } = await postJournalEntryTx(tx, store, {
      date: closingDate,
      memo: `قيد إقفال السنة المالية ${year} — تصفير الإيرادات والمصروفات إلى الأرباح المبقاة`,
      lines: plan.lines,
      actor,
      type: 'closing',
      bypassPeriodCheck: true,
      idempotencyKey: `year-end-closing-${year}`,
    });
    // قفل فترات السنة نهائياً
    const lockedPeriods = [];
    for (let m = 1; m <= 12; m += 1) {
      const key = `${year}-${String(m).padStart(2, '0')}`;
      const snap = await tx.get(store.ref('fiscal_periods', key));
      if (snap.exists && snap.data.status !== 'locked') {
        tx.update(store.ref('fiscal_periods', key), {
          status: 'locked', lockedAt: nowISO(), lockedBy: { uid: actor.uid, email: actor.email },
        });
        lockedPeriods.push(key);
      }
    }
    return { entry, lockedPeriods, netProfit: plan.netProfit };
  });
  return result;
}
