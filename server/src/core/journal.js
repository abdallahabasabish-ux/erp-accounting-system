/**
 * محرك القيد المزدوج (Double-Entry Engine) — حجر الأساس غير القابل للتفاوض.
 *
 * الضمانات المعمارية:
 * 1) التوازن: ∑ المدين = ∑ الدائن يُفحص قبل التخزين — القيد غير المتوازن مستحيل بنيوياً.
 * 2) الذرية الكاملة: postJournalEntryTx تعمل *داخل معاملة المتصل* —
 *    الفاتورة + قيدها + سند التحصيل + أرصدة العملاء تُكتب جميعها في Single Transaction،
 *    وفشل أي خطوة يتراجع عن كل شيء (Rollback كامل).
 * 3) عدم القابلية للتعديل: لا يوجد أي مسار كود يُحدّث أو يحذف وثيقة قيد بعد ترحيلها.
 *    التصحيح الوحيد: قيد عكسي جديد (postReversal).
 * 4) الحماية من العكس المزدوج: فهرس reversal_index يُنشأ داخل نفس المعاملة —
 *    محاولتان متزامنتان لعكس نفس القيد، إحداهما فقط ستنجح.
 * 5) التكرار الآمن: idempotencyKey يجعل إعادة إرسال نفس الطلب تعيد القيد الأصلي بدلاً من إنشاء مكرر.
 * 6) الترحيل فقط على حسابات posting نشطة، وبتاريخ فترة مفتوحة.
 */
import { periodKeyOf, nowISO, isValidISODate } from '../lib/dates.js';
import { assertSafeInt } from '../lib/money.js';
import { errors } from '../lib/errors.js';
import { assertPeriodOpenForDate } from './periods.js';
import { allocateNumber } from './sequence.js';
import { NORMAL_SIDE } from './coa.js';

export const ENTRY_TYPE = {
  STANDARD: 'standard',   // قيد أصلي (فاتورة/سند/مصروف...)
  REVERSAL: 'reversal',   // قيد عكسي
  CLOSING: 'closing',     // قيد إقفال نهاية سنة (نظامي)
  OPENING: 'opening',     // قيد افتتاحي/رأس مال
  ADJUSTING: 'adjusting', // قيد تسوية
};

/**
 * إنشاء/جلب حساب فرعي تحليلي تحت حساب رقابي — داخل معاملة قائمة.
 * مثال: getOrCreateSubAccount(tx, store, {control:'1120', suffix:'C0001', name:'ذمة عميل: شركة النيل'})
 */
export async function getOrCreateSubAccount(tx, store, { control, suffix, name, meta = {} }) {
  const code = `${control}-${suffix}`;
  const ref = store.ref('accounts', code);
  const snap = await tx.get(ref);
  if (snap.exists) {
    if (snap.data.active === false) throw errors.invalidAccount(code, 'الحساب الفرعي معطل');
    return { code, created: false };
  }
  const parentSnap = await tx.get(store.ref('accounts', control));
  if (!parentSnap.exists) throw errors.invalidAccount(control, 'الحساب الرقابي الأب غير موجود');
  const parent = parentSnap.data;
  tx.set(ref, {
    id: code, code, name, type: parent.type, kind: 'posting', parent: control,
    active: true, isSystem: false, subOf: control, meta, createdAt: nowISO(),
  });
  return { code, created: true };
}

/**
 * التحقق الشكلي من أطراف القيد (خارج المعاملة — رخيص ومبكر).
 * يعيد الأطراف المعيارية والإجماليات، أو يرمي خطأ أعمال واضحاً.
 */
function validateLines(lines) {
  if (!Array.isArray(lines) || lines.length < 2) {
    throw errors.badRequest('القيد المزدوج يتطلب طرفين على الأقل (مدين ودائن)');
  }
  let totalDebit = 0;
  let totalCredit = 0;
  for (const [i, line] of lines.entries()) {
    const debit = line.debit || 0;
    const credit = line.credit || 0;
    assertSafeInt(debit, `طرف ${i + 1} مدين`);
    assertSafeInt(credit, `طرف ${i + 1} دائن`);
    if (debit < 0 || credit < 0) throw errors.badRequest(`الطرف ${i + 1}: لا يجوز وجود قيم سالبة`);
    if (debit > 0 && credit > 0) throw errors.badRequest(`الطرف ${i + 1}: لا يجوز أن يكون مديناً ودائناً معاً`);
    if (debit === 0 && credit === 0) throw errors.badRequest(`الطرف ${i + 1}: قيمة صفرية غير مسموحة`);
    if (!line.accountCode) throw errors.badRequest(`الطرف ${i + 1}: رمز الحساب مفقود`);
    totalDebit += debit;
    totalCredit += credit;
  }
  if (totalDebit !== totalCredit) throw errors.unbalanced(totalDebit, totalCredit);
  if (totalDebit === 0) throw errors.badRequest('قيد بقيمة صفرية غير مسموح');
  return { totalDebit, totalCredit };
}

/**
 * ترحيل قيد داخل معاملة قائمة (يستدعيه بقية الخدمات داخل معاملاتها).
 * هذا هو الشكل الوحيد الذي تستخدمه الخدمات — لضمان الذرية الكاملة عبر المستندات.
 */
export async function postJournalEntryTx(tx, store, input) {
  const {
    date, memo, lines, actor,
    type = ENTRY_TYPE.STANDARD,
    sourceRef = null,
    idempotencyKey = null,
    bypassPeriodCheck = false,
    reversalOf = null,
    reversalReason = null,
  } = input;

  if (!isValidISODate(date)) throw errors.badRequest(`تاريخ القيد غير صالح: ${date}`);
  if (!memo || String(memo).trim().length < 3) throw errors.badRequest('وصف القيد (memo) مطلوب');
  const { totalDebit, totalCredit } = validateLines(lines);

  // ── مفتاح التكرار: إعادة الطلب نفسه تعيد نفس القيد ──
  if (idempotencyKey) {
    const idxRef = store.ref('idempotency_index', idempotencyKey);
    const idx = await tx.get(idxRef);
    if (idx.exists) {
      const existing = await tx.get(store.ref('journal_entries', idx.data.entryId));
      if (existing.exists) return { entry: existing.data, idempotent: true };
    }
  }

  // ── بوابة الفترة المفتوحة ──
  let period;
  if (bypassPeriodCheck) {
    period = { key: periodKeyOf(date) };
  } else {
    period = await assertPeriodOpenForDate(tx, store, date);
  }

  // ── التحقق من كل حساب: موجود، ترحيلي، نشط ──
  const resolvedLines = [];
  for (const line of lines) {
    const accRef = store.ref('accounts', line.accountCode);
    const accSnap = await tx.get(accRef);
    if (!accSnap.exists) throw errors.invalidAccount(line.accountCode, 'غير موجود في شجرة الحسابات');
    const acc = accSnap.data;
    if (acc.kind !== 'posting') throw errors.invalidAccount(line.accountCode, 'هو حساب تجميعي — الترحيل على الحسابات الورقية فقط');
    if (acc.active === false) throw errors.invalidAccount(line.accountCode, 'الحساب معطل');
    resolvedLines.push({
      accountCode: acc.code,
      accountName: acc.name,
      debit: line.debit || 0,
      credit: line.credit || 0,
      note: line.note || '',
      party: line.party || null,
    });
  }

  // ── حجز الرقم التسلسلي الذري (نفس المعاملة) ──
  const { number, docId } = await allocateNumber(tx, store, 'journal', date);

  // ── كتابة القيد: لا يوجد أي مسار لاحق يعدّل أو يحذف هذه الوثيقة ──
  const entry = {
    id: docId,
    number,
    date,
    periodKey: period.key,
    type,
    memo: String(memo).trim(),
    sourceRef,
    lines: resolvedLines,
    totalDebit,
    totalCredit,
    currency: 'EGP',
    createdBy: { uid: actor.uid, email: actor.email, name: actor.name || '', role: actor.role || '' },
    createdAt: nowISO(),
    reversesOf: reversalOf,
    reversalReason,
  };
  tx.set(store.ref('journal_entries', docId), entry);

  // ── تحديث سجل الأرصدة المخزَّن مؤقتاً (قابل لإعادة البناء من القيود — ليس مصدر حقيقة) ──
  for (const line of resolvedLines) {
    const balRef = store.ref('account_balances', line.accountCode);
    const balSnap = await tx.get(balRef);
    const current = balSnap.exists ? balSnap.data : {
      code: line.accountCode, name: line.accountName, totalDebit: 0, totalCredit: 0, byPeriod: {},
    };
    tx.set(balRef, {
      ...current,
      code: line.accountCode,
      name: line.accountName,
      totalDebit: (current.totalDebit || 0) + line.debit,
      totalCredit: (current.totalCredit || 0) + line.credit,
      byPeriod: {
        ...current.byPeriod,
        [period.key]: {
          debit: (current.byPeriod?.[period.key]?.debit || 0) + line.debit,
          credit: (current.byPeriod?.[period.key]?.credit || 0) + line.credit,
        },
      },
      updatedAt: nowISO(),
    });
  }

  // ── مفاتيح التكرار والعكس (حماية سباق داخل نفس المعاملة) ──
  if (idempotencyKey) {
    tx.set(store.ref('idempotency_index', idempotencyKey), { entryId: docId, createdAt: nowISO() });
  }
  if (type === ENTRY_TYPE.REVERSAL && reversalOf) {
    const revRef = store.ref('reversal_index', reversalOf);
    const revSnap = await tx.get(revRef);
    if (revSnap.exists) {
      throw errors.conflict('ALREADY_REVERSED', `القيد ${reversalOf} سبق عكسه بالقيد ${revSnap.data.reversalEntryId}`);
    }
    tx.set(revRef, { entryId: reversalOf, reversalEntryId: docId, createdAt: nowISO(), reason: reversalReason });
  }

  return { entry, idempotent: false };
}

/** الترحيل المستقل (يفتح معاملته الخاصة) — للأغراض اليدوية والقيد الافتتاحي */
export async function postJournalEntry(store, input) {
  return store.runTransaction((tx) => postJournalEntryTx(tx, store, input));
}

/**
 * القيد العكسي — الطريقة الوحيدة لتصحيح قيد مرحَّل.
 * يُنشئ قيداً جديداً بأطراف معكوسة، مرتبطاً بالأصل، في فترة مفتوحة، مع سبب إلزامي.
 */
export async function postReversal(store, { originalEntryId, date, reason, actor }) {
  if (!reason || String(reason).trim().length < 10) {
    throw errors.badRequest('سبب القيد العكسي إلزامي (10 أحرف على الأقل) — يُوثَّق في سجل التدقيق');
  }
  const originalSnap = await store.get(store.ref('journal_entries', originalEntryId));
  if (!originalSnap.exists) throw errors.notFound('القيد الأصلي');
  const original = originalSnap.data;
  if (original.type === ENTRY_TYPE.REVERSAL) {
    throw errors.conflict('REVERSING_A_REVERSAL', 'لا يُعكس القيد العكسي — أنشئ قيداً تصحيحياً جديداً');
  }
  const reversedLines = original.lines.map((l) => ({
    accountCode: l.accountCode,
    debit: l.credit,
    credit: l.debit,
    note: `عكس: ${l.note || ''}`.trim(),
    party: l.party,
  }));
  const { entry } = await postJournalEntry(store, {
    date,
    memo: `قيد عكسي للقيد ${original.number} — ${String(reason).trim()}`,
    lines: reversedLines,
    actor,
    type: ENTRY_TYPE.REVERSAL,
    sourceRef: { module: 'journal', docId: original.id, number: original.number },
    reversalOf: original.id,
    reversalReason: String(reason).trim(),
  });
  return { entry, original };
}

/** جلب قيد بالرقم أو المعرف */
export async function getEntry(store, idOrNumber) {
  const snap = await store.get(store.ref('journal_entries', idOrNumber));
  if (snap.exists) return snap.data;
  const found = await store.read('journal_entries', { where: [['number', '==', idOrNumber]], limit: 1 });
  return found[0] || null;
}

/** قائمة القيود مع فلاتر اختيارية */
export async function listEntries(store, { from, to, periodKey, accountCode, type, limit = 100 } = {}) {
  const where = [];
  if (type) where.push(['type', '==', type]);
  let rows;
  if (periodKey) {
    where.push(['periodKey', '==', periodKey]);
    rows = await store.read('journal_entries', { where, orderBy: ['date', 'desc'], limit });
  } else if (from || to) {
    if (from) where.push(['date', '>=', from]);
    if (to) where.push(['date', '<=', to]);
    rows = await store.read('journal_entries', { where, orderBy: ['date', 'desc'], limit });
  } else if (accountCode) {
    rows = await store.read('journal_entries', {
      where: [['lines.accountCode', 'array-contains', accountCode]], orderBy: ['date', 'desc'], limit,
    });
  } else {
    rows = await store.read('journal_entries', { orderBy: ['createdAt', 'desc'], limit });
  }
  return rows;
}

/** قراءة رصيد حساب (تراكمي، بالقروش، بإشارة الطبيعة): موجب = رصيد طبيعي */
export function signedBalance(balanceDoc) {
  if (!balanceDoc) return 0;
  const d = balanceDoc.totalDebit || 0;
  const c = balanceDoc.totalCredit || 0;
  const side = balanceDoc.normalSide || 'debit';
  return side === 'debit' ? d - c : c - d;
}

/** قراءة أرصدة مجموعة حسابات عبر بادئة الرمز (مثال: 1110 للخزائن) */
export async function balancesByPrefix(store, prefix) {
  const rows = await store.read('account_balances', {});
  const accounts = await store.read('accounts', {});
  const accById = new Map(accounts.map((a) => [a.code, a]));
  return rows
    .filter((b) => b.code.startsWith(prefix))
    .map((b) => {
      const side = NORMAL_SIDE[accById.get(b.code)?.type] || 'debit';
      return {
        code: b.code,
        name: b.name,
        balance: side === 'debit' ? (b.totalDebit || 0) - (b.totalCredit || 0) : (b.totalCredit || 0) - (b.totalDebit || 0),
      };
    })
    .sort((a, b) => a.code.localeCompare(b.code));
}

/** جدول الأرصدة المخزنة كاملاً */
export async function allBalances(store) {
  const rows = await store.read('account_balances', {});
  const accounts = await store.read('accounts', {});
  const sideByCode = new Map(accounts.map((a) => [a.code, NORMAL_SIDE[a.type] || 'debit']));
  return rows
    .map((b) => ({ ...b, normalSide: sideByCode.get(b.code) || 'debit' }))
    .sort((a, b) => a.code.localeCompare(b.code));
}
