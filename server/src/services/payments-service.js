/**
 * موديول سندات القبض والمدفوعات (Receipts & Payment Approvals).
 *
 * إصلاحات جذرية للنظام القديم:
 * 1) التحصيل يخصم من فواتير محددة (تخصيص صريح أو تلقائي FIFO بالأقرب استحقاقاً)
 *    — لم يعد "مبلغاً عائماً" يطفأ في حقل العميل.
 * 2) سند التحصيل يُرحِّل قيداً متوازناً: مدين النقد/البنك | دائن ذمة العميل.
 * 3) مدفوعات البوابة تعود لسير اعتماد pending→approved على الخادم،
 *    والاعتماد نفسه هو من يرحّل القيد ويحدّث الفواتير — في معاملة واحدة.
 * 4) لا حذف لسندات مرحَّلة — التصحيح بقيد عكسي.
 */
import { toPiasters, assertPositive } from '../lib/money.js';
import { nowISO } from '../lib/dates.js';
import { errors } from '../lib/errors.js';
import { postJournalEntryTx } from '../core/journal.js';
import { allocateNumber } from '../core/sequence.js';
import { assertPeriodOpenForDate } from '../core/periods.js';
import { assertValidDate } from './customers-service.js';
import { writeAuditTx } from './audit-service.js';

/**
 * تخصيص مبلغ التحصيل على فواتير مفتوحة (FIFO بالأقرب استحقاقاً).
 * يعيد [{invoiceId, amount}] ويترك الزائد "على الحساب" (on-account).
 */
export function allocateFifo(amount, openInvoices) {
  const allocations = [];
  let remaining = amount;
  const sorted = [...openInvoices].sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));
  for (const inv of sorted) {
    if (remaining <= 0) break;
    const due = inv.balance ?? inv.total;
    if (due <= 0) continue;
    const take = Math.min(due, remaining);
    allocations.push({ invoiceId: inv.id, invoiceNumber: inv.number, amount: take });
    remaining -= take;
  }
  return { allocations, onAccount: remaining };
}

/** جلب الفواتير المفتوحة للعميل (داخل معاملة أو خارجها — تُقرأ هنا خارج tx) */
async function openInvoicesFor(store, customerId) {
  const invoices = await store.read('invoices', {
    where: [['customerId', '==', customerId]], orderBy: ['date', 'asc'], limit: 500,
  });
  return invoices.filter((i) => (i.status === 'unpaid' || i.status === 'partial') && (i.balance || 0) > 0);
}

/**
 * سند قبض نقدية من عميل — قيد + تخصيص فواتير + تحديث ذمم، في معاملة واحدة.
 * @param input {customerId, date, amount(EGP), treasuryAccountId, method?, allocations?, notes?, idempotencyKey?}
 */
export async function createReceipt(store, actor, input) {
  const date = assertValidDate(input.date || nowISO().slice(0, 10), 'تاريخ السند');
  const amount = assertPositive(toPiasters(input.amount), 'مبلغ التحصيل');
  const method = input.method || 'cash';

  // الفواتير المفتوحة للتخصيص التلقائي (قراءة خارج المعاملة — التحقق النهائي داخلها)
  const openInvoices = await openInvoicesFor(store, input.customerId);
  const plan = input.allocations && input.allocations.length
    ? { allocations: input.allocations.map((a) => ({ invoiceId: a.invoiceId, amount: toPiasters(a.amount) })), onAccount: 0 }
    : allocateFifo(amount, openInvoices);

  return store.runTransaction(async (tx) => {
    const custSnap = await tx.get(store.ref('customers', input.customerId));
    if (!custSnap.exists) throw errors.notFound('العميل');
    const customer = custSnap.data;

    const treasurySnap = await tx.get(store.ref('treasury_accounts', input.treasuryAccountId));
    if (!treasurySnap.exists) throw errors.notFound('الخزينة/البنك');
    const treasury = treasurySnap.data;
    if (treasury.active === false) throw errors.badRequest('الخزينة/البنك غير نشط');

    await assertPeriodOpenForDate(tx, store, date);

    // التحقق من التخصيصات: المجموع ≤ المبلغ، والفواتير مفتوحة فعلاً
    const totalAlloc = plan.allocations.reduce((s, a) => s + a.amount, 0);
    if (totalAlloc > amount) throw errors.badRequest('مجموع التخصيصات يتجاوز مبلغ السند');
    for (const alloc of plan.allocations) {
      const invSnap = await tx.get(store.ref('invoices', alloc.invoiceId));
      if (!invSnap.exists) throw errors.notFound(`الفاتورة ${alloc.invoiceId}`);
      const inv = invSnap.data;
      if (inv.customerId !== input.customerId) throw errors.badRequest('التخصيص على فاتورة لعميل آخر');
      if (!['unpaid', 'partial'].includes(inv.status)) throw errors.badRequest(`الفاتورة ${inv.number} ليست مفتوحة`);
      if (alloc.amount > (inv.balance || 0)) throw errors.badRequest(`التخصيص يتجاوز متبقي الفاتورة ${inv.number}`);
    }
    const onAccount = amount - totalAlloc; // الدفع على الحساب يظل دائناً لذمة العميل

    // الترقيم + القيد
    const { number, docId } = await allocateNumber(tx, store, 'receipt', date);
    const { entry } = await postJournalEntryTx(tx, store, {
      date,
      memo: `سند قبض ${number} من العميل ${customer.name} (${customer.code})${method ? ` — ${method}` : ''}`,
      lines: [
        {
          accountCode: treasury.accountCode, debit: amount, credit: 0,
          note: `تحصيل ${method}`, party: { kind: 'customer', id: customer.id, name: customer.name },
        },
        {
          accountCode: customer.customerAccountCode, debit: 0, credit: amount,
          note: 'تحصيل من الذمة', party: { kind: 'customer', id: customer.id, name: customer.name },
        },
      ],
      actor,
      sourceRef: { module: 'receipts', docId, number },
      idempotencyKey: input.idempotencyKey ? `receipt:${input.idempotencyKey}` : null,
    });

    // تحديث الفواتير المخصصة
    for (const alloc of plan.allocations) {
      const invRef = store.ref('invoices', alloc.invoiceId);
      const invSnap = await tx.get(invRef);
      const inv = invSnap.data;
      const paidTotal = (inv.paidTotal || 0) + alloc.amount;
      const balance = inv.total - paidTotal;
      tx.update(invRef, {
        paidTotal, balance,
        status: balance === 0 ? 'paid' : 'partial',
        updatedAt: nowISO(),
      });
    }

    // وثيقة السند + ذمم العميل + تدقيق
    const receipt = {
      id: docId, number, date, customerId: customer.id, customerCode: customer.code,
      customerName: customer.name, customerAccountCode: customer.customerAccountCode,
      treasuryAccountId: treasury.id, treasuryAccountName: treasury.name, treasuryAccountCode: treasury.accountCode,
      amount, method,
      allocations: plan.allocations, onAccount,
      status: 'posted',
      journalEntryId: entry.id, journalNumber: entry.number,
      notes: input.notes || '',
      createdBy: { uid: actor.uid, email: actor.email, name: actor.name || '' },
      createdAt: nowISO(),
    };
    tx.set(store.ref('receipts', docId), receipt);
    tx.update(store.ref('customers', customer.id), {
      arBalancePiasters: (customer.arBalancePiasters || 0) - amount,
      updatedAt: nowISO(),
    });
    await writeAuditTx(tx, store, {
      actor, action: 'receipt.create', entity: 'receipts', entityId: docId,
      summary: `سند قبض ${number} بمبلغ ${(amount / 100).toFixed(2)} ج.م من ${customer.name}`,
    });

    return { receipt, journalEntry: entry };
  });
}

/** طلب دفع من بوابة العميل — يُسجل pending بلا أي أثر محاسبي حتى الاعتماد */
export async function requestPortalPayment(store, clientUser, input) {
  const amount = assertPositive(toPiasters(input.amount), 'المبلغ');
  const id = store.newId();
  return store.runTransaction(async (tx) => {
    const payment = {
      id,
      customerId: clientUser.customerId,
      amount,
      method: String(input.method || 'تحويل بنكي'),
      reference: String(input.reference || ''),
      receiptUrl: input.receiptUrl || null,
      orderId: input.orderId || null,
      status: 'pending',
      source: 'portal',
      requestedBy: { uid: clientUser.uid, email: clientUser.email },
      createdAt: nowISO(),
    };
    tx.set(store.ref('payment_requests', id), payment);
    await writeAuditTx(tx, store, {
      actor: clientUser, action: 'payment.request', entity: 'payment_requests', entityId: id,
      summary: `طلب دفع من البوابة بمبلغ ${(amount / 100).toFixed(2)} ج.م`,
    });
    return payment;
  });
}

/** اعتماد طلب دفع البوابة — يحوّله سند قبض مرحَّل (قيد + تخصيص + ذمم) في معاملة واحدة */
export async function approvePortalPayment(store, actor, { paymentId, treasuryAccountId, date, allocations }) {
  const paySnap = await store.get(store.ref('payment_requests', paymentId));
  if (!paySnap.exists) throw errors.notFound('طلب الدفع');
  const request = paySnap.data;
  if (request.status !== 'pending') {
    throw errors.conflict('REQUEST_NOT_PENDING', `الطلب حالته ${request.status} — الاعتماد متاح للطلبات المعلقة فقط`);
  }
  const { receipt } = await createReceipt(store, actor, {
    customerId: request.customerId,
    date: date || nowISO().slice(0, 10),
    amount: request.amount / 100, // مخزنة بالقروش → نعيدها EGP لواجهة createReceipt
    treasuryAccountId,
    method: request.method,
    allocations,
    notes: `اعتماد طلب بوابة ${paymentId}${request.reference ? ` — مرجع: ${request.reference}` : ''}`,
    idempotencyKey: `portal-payment-${paymentId}`,
  });
  return store.runTransaction(async (tx) => {
    tx.update(store.ref('payment_requests', paymentId), {
      status: 'approved',
      approvedAt: nowISO(),
      approvedBy: { uid: actor.uid, email: actor.email },
      receiptId: receipt.id,
      receiptNumber: receipt.number,
    });
    await writeAuditTx(tx, store, {
      actor, action: 'payment.approve', entity: 'payment_requests', entityId: paymentId,
      summary: `اعتماد طلب دفع بوابة وإصدار سند ${receipt.number}`,
    });
    return { request: { ...request, status: 'approved' }, receipt };
  });
}

/** رفض طلب دفع بوابة — بلا أي أثر محاسبي، مع سبب */
export async function rejectPortalPayment(store, actor, { paymentId, reason }) {
  if (!reason || String(reason).trim().length < 5) throw errors.badRequest('سبب الرفض إلزامي');
  return store.runTransaction(async (tx) => {
    const snap = await tx.get(store.ref('payment_requests', paymentId));
    if (!snap.exists) throw errors.notFound('طلب الدفع');
    if (snap.data.status !== 'pending') throw errors.conflict('REQUEST_NOT_PENDING', 'الطلب ليس معلقاً');
    tx.update(store.ref('payment_requests', paymentId), {
      status: 'rejected',
      rejectedAt: nowISO(),
      rejectedBy: { uid: actor.uid, email: actor.email },
      rejectionReason: String(reason).trim(),
    });
    await writeAuditTx(tx, store, {
      actor, action: 'payment.reject', entity: 'payment_requests', entityId: paymentId,
      summary: `رفض طلب دفع بوابة`, reason: String(reason).trim(),
    });
    return { ...snap.data, status: 'rejected' };
  });
}

/** قائمة سندات القبض */
export async function listReceipts(store, { customerId, from, to, limit = 200 } = {}) {
  const where = [];
  if (customerId) where.push(['customerId', '==', customerId]);
  if (from) where.push(['date', '>=', from]);
  if (to) where.push(['date', '<=', to]);
  return store.read('receipts', { where: where.length ? where : undefined, orderBy: ['date', 'desc'], limit });
}

/** قائمة طلبات دفع البوابة */
export async function listPaymentRequests(store, { status, customerId, limit = 200 } = {}) {
  const where = [];
  if (status) where.push(['status', '==', status]);
  if (customerId) where.push(['customerId', '==', customerId]);
  return store.read('payment_requests', { where: where.length ? where : undefined, orderBy: ['createdAt', 'desc'], limit });
}
