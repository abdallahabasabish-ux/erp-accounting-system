/**
 * موديول العملاء والذمم المدينة (Customers & Accounts Receivable).
 *
 * القرار المعماري الحاسم: لكل عميل حساب فرعي تحليلي في شجرة الحسابات
 * (1120-Cxxxx) تحت الحساب الرقابي 1120 — كشف حساب العميل هو دفتر أستاذ
 * حسابه الفرعي، لا حقول totalPaid/balance قابلة للعبث كما في النظام القديم.
 */
import { toPiasters, assertNonNegative } from '../lib/money.js';
import { nowISO, todayISO, addDays, isValidISODate } from '../lib/dates.js';
import { errors } from '../lib/errors.js';
import { getOrCreateSubAccount } from '../core/journal.js';
import { allocateEntityCode } from '../core/sequence.js';
import { writeAuditTx } from './audit-service.js';
import { generalLedger } from '../core/reports.js';

/** إنشاء عميل جديد + حسابه الفرعي — معاملة واحدة */
export async function createCustomer(store, actor, input) {
  const name = String(input.name || '').trim();
  if (name.length < 2) throw errors.badRequest('اسم العميل مطلوب (حرفان على الأقل)');
  const creditLimit = assertNonNegative(toPiasters(input.creditLimit ?? 0), 'الحد الائتماني');
  const creditDays = Math.max(0, Number(input.creditDays ?? 30) | 0);

  return store.runTransaction(async (tx) => {
    const code = await allocateEntityCode(tx, store, 'customer', 'C');
    const id = store.newId();
    const ref = store.ref('customers', id);
    const customer = {
      id, code, name,
      phone: input.phone || '', email: input.email || '',
      company: input.company || '', address: input.address || '',
      creditLimitPiasters: creditLimit,
      creditDays,
      // ذاكرة قراءة سريعة للذمم — مصدر الحقيقة دائماً حساب 1120-Cxxxx في دفتر الأستاذ
      arBalancePiasters: 0,
      active: true,
      uid: input.uid || null, // ربط بوابة العميل
      createdBy: { uid: actor.uid, email: actor.email },
      createdAt: nowISO(), updatedAt: nowISO(),
    };
    tx.set(ref, customer);
    const { code: subCode } = await getOrCreateSubAccount(tx, store, {
      control: '1120', suffix: code, name: `ذمة عميل: ${name}`, meta: { customerId: id },
    });
    customer.customerAccountCode = subCode;
    tx.update(ref, { customerAccountCode: subCode });
    await writeAuditTx(tx, store, {
      actor, action: 'customer.create', entity: 'customers', entityId: id,
      summary: `إنشاء عميل ${name} (${code}) بحساب فرعي ${subCode}`,
    });
    return { ...customer, customerAccountCode: subCode };
  });
}

/** تحديث بيانات عميل — الحقول المالية (الحد الائتماني/أيام السداد) بصلاحية أعرض */
export async function updateCustomer(store, actor, customerId, patch) {
  return store.runTransaction(async (tx) => {
    const ref = store.ref('customers', customerId);
    const snap = await tx.get(ref);
    if (!snap.exists) throw errors.notFound('العميل');
    const current = snap.data;
    const allowed = ['name', 'phone', 'email', 'company', 'address'];
    const next = { updatedAt: nowISO(), updatedBy: actor.email };
    for (const k of allowed) if (patch[k] !== undefined) next[k] = String(patch[k]).trim();
    if (patch.creditLimit !== undefined) next.creditLimitPiasters = assertNonNegative(toPiasters(patch.creditLimit), 'الحد الائتماني');
    if (patch.creditDays !== undefined) next.creditDays = Math.max(0, Number(patch.creditDays) | 0);
    if (patch.active !== undefined) next.active = Boolean(patch.active);
    tx.update(ref, next);
    await writeAuditTx(tx, store, {
      actor, action: 'customer.update', entity: 'customers', entityId: customerId,
      summary: `تحديث بيانات العميل ${current.name}`,
      before: { creditLimitPiasters: current.creditLimitPiasters, creditDays: current.creditDays },
      after: { creditLimitPiasters: next.creditLimitPiasters, creditDays: next.creditDays },
    });
    return { ...current, ...next };
  });
}

/** قائمة العملاء مع أرصدة الذمم (من الذاكرة السريعة) */
export async function listCustomers(store, { activeOnly = false, limit = 500 } = {}) {
  const where = activeOnly ? [['active', '==', true]] : [];
  const rows = await store.read('customers', { where, orderBy: ['code', 'asc'], limit });
  return rows;
}

/** كشف حساب العميل (Statement of Account) — مبني على دفتر أستاذ حسابه الفرعي */
export async function customerStatement(store, customerId, { from = null, to = null } = {}) {
  const snap = await store.get(store.ref('customers', customerId));
  if (!snap.exists) throw errors.notFound('العميل');
  const customer = snap.data;
  if (!customer.customerAccountCode) throw errors.badRequest('العميل بلا حساب فرعي — رحّل بياناته أولاً');

  const ledger = await generalLedger(store, customer.customerAccountCode, { from, to });
  // إثراء الحركات بمرجع المستند المصدر (فاتورة/سند) لسهولة التتبع
  const movements = ledger.movements.map((m) => ({
    ...m,
    direction: m.debit > 0 ? 'debit' : 'credit', // مدين = فاتورة (زيادة ذمة)، دائن = تحصيل
    amount: m.debit > 0 ? m.debit : m.credit,
  }));
  return {
    customer: {
      id: customer.id, code: customer.code, name: customer.name,
      customerAccountCode: customer.customerAccountCode,
      creditLimitPiasters: customer.creditLimitPiasters,
      creditDays: customer.creditDays,
    },
    period: ledger.period,
    openingBalance: ledger.openingBalance, // موجب = مستحق على العميل
    movements,
    totals: ledger.totals,
    closingBalance: ledger.closingBalance,
  };
}

/**
 * فحص الحد الائتماني — يُستدعى داخل معاملة إنشاء الفاتورة.
 * القاعدة: المستحق الجاري + قيمة الفاتورة ≤ الحد الائتماني (إن وُجد حد).
 */
export async function assertCreditWithinLimit(tx, store, customer, invoiceTotal) {
  const limit = customer.creditLimitPiasters || 0;
  if (limit <= 0) return; // بلا حد ائتماني = لا قيد
  // مصدر الحقيقة: رصيد الحساب الفرعي للعميل من سجل الأرصدة
  const balSnap = await tx.get(store.ref('account_balances', customer.customerAccountCode));
  const currentAR = balSnap.exists ? (balSnap.data.totalDebit || 0) - (balSnap.data.totalCredit || 0) : 0;
  const wouldBe = currentAR + invoiceTotal;
  if (wouldBe > limit) {
    throw errors.creditLimitExceeded(customer.name, limit, wouldBe);
  }
}

/** ربط مستخدم بوابة بعميل قائم (للإدارة) */
export async function linkCustomerUser(store, actor, customerId, uid) {
  return store.runTransaction(async (tx) => {
    const ref = store.ref('customers', customerId);
    const snap = await tx.get(ref);
    if (!snap.exists) throw errors.notFound('العميل');
    tx.update(ref, { uid, updatedAt: nowISO() });
    await writeAuditTx(tx, store, {
      actor, action: 'customer.link_user', entity: 'customers', entityId: customerId,
      summary: `ربط مستخدم البوابة ${uid} بالعميل ${snap.data.name}`,
    });
    return { ...snap.data, uid };
  });
}

/** تاريخ الاستحقاق الافتراضي لعميل */
export function dueDateFor(customer, invoiceDate) {
  return addDays(invoiceDate, customer.creditDays ?? 30);
}

/** تحقق شكلي من التاريخ قبل الاستخدام */
export function assertValidDate(date, label = 'التاريخ') {
  if (!isValidISODate(date)) throw errors.badRequest(`${label} غير صالح (الصيغة YYYY-MM-DD)`);
  return date;
}

/** اليوم الحالي حسب إعدادات النظام */
export { todayISO };
