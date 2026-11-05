/**
 * موديول الفواتير (Invoicing & Revenue Control) — أساس الاعتراف بالإيراد (مبدأ الاستحقاق).
 *
 * عند إنشاء فاتورة آجل يُرحَّل تلقائياً داخل نفس المعاملة:
 *   مدين: حساب العميل الفرعي (1120-Cxxxx) بقيمة الإجمالي شاملاً الضريبة
 *   دائن: إيرادات الخدمات (4100) بقيمة الصافي بعد الخصم
 *   دائن: ضريبة القيمة المضافة المستحقة (2150) بقيمة الضريبة
 *
 * إلغاء الفاتورة: قيد عكسي — لا حذف فيزيائي أبداً.
 * الترقيم: ذري من الخادم (INV-YYYY-######) — لا تكرار ممكن.
 */
import { toPiasters, assertNonNegative, assertPositive, computeVat } from '../lib/money.js';
import { nowISO } from '../lib/dates.js';
import { errors } from '../lib/errors.js';
import { postJournalEntryTx, postJournalEntry, getEntry, ENTRY_TYPE } from '../core/journal.js';
import { allocateNumber } from '../core/sequence.js';
import { assertPeriodOpenForDate } from '../core/periods.js';
import { assertCreditWithinLimit, assertValidDate, dueDateFor } from './customers-service.js';
import { writeAuditTx } from './audit-service.js';

/** حساب الترحيل الافتراضي للإيراد حسب نوع الفاتورة */
const REVENUE_ACCOUNT = { service: '4100', product: '4200', other: '4300' };

/**
 * إنشاء فاتورة — معاملة واحدة تشمل: الترقيم + القيد + تحديث ذمم العميل + التدقيق.
 * @param input {customerId, date, dueDate?, kind?, items:[{description, qty, unitPrice}], discount?, vatRate?, notes?, overrideCreditLimit?{reason}}
 */
export async function createInvoice(store, actor, input) {
  const date = assertValidDate(input.date || nowISO().slice(0, 10), 'تاريخ الفاتورة');
  const kind = REVENUE_ACCOUNT[input.kind] ? input.kind : 'service';

  // ── التحقق الحسابي خارج المعاملة (بدون float: كل شيء قروش) ──
  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw errors.badRequest('الفاتورة بلا بنود — أضف بنداً واحداً على الأقل');
  }
  const items = input.items.map((it, i) => {
    const qty = Number(it.qty ?? 1);
    if (!Number.isInteger(qty) || qty <= 0) throw errors.badRequest(`البند ${i + 1}: الكمية عدد صحيح موجب`);
    const unitPrice = assertPositive(toPiasters(it.unitPrice), `البند ${i + 1}: سعر الوحدة`);
    return {
      description: String(it.description || `بند ${i + 1}`).trim(),
      qty, unitPricePiasters: unitPrice,
      totalPiasters: qty * unitPrice,
    };
  });
  const subtotal = items.reduce((s, it) => s + it.totalPiasters, 0);
  const discount = assertNonNegative(toPiasters(input.discount ?? 0), 'الخصم');
  if (discount > subtotal) throw errors.badRequest('الخصم أكبر من إجمالي البنود');
  const taxable = subtotal - discount;
  const vatRate = input.vatRate === undefined ? null : Number(input.vatRate);
  const { vat, total } = computeVat(taxable, vatRate === null ? 0 : vatRate);
  // نسبة الضريبة الفعلية تُحل من إعدادات الشركة إن لم تُمرر
  const resolvedVatRate = vatRate === null ? null : vatRate;

  return store.runTransaction(async (tx) => {
    // 1) العميل وحسابه الفرعي
    const custSnap = await tx.get(store.ref('customers', input.customerId));
    if (!custSnap.exists) throw errors.notFound('العميل');
    const customer = custSnap.data;
    if (customer.active === false) throw errors.badRequest('العميل غير نشط — لا يمكن إصدار فواتير له');

    // 2) بوابة الحد الائتماني (يمكن تجاوزها لمدير + سبب موثق)
    const override = input.overrideCreditLimit;
    if (override && !['admin', 'manager'].includes(actor.role)) {
      throw errors.forbidden('تجاوز الحد الائتماني متاح للمدير فقط');
    }
    if (override && (!override.reason || override.reason.trim().length < 10)) {
      throw errors.badRequest('سبب تجاوز الحد الائتماني إلزامي (10 أحرف على الأقل)');
    }
    if (override) {
      await writeAuditTx(tx, store, {
        actor, action: 'invoice.credit_override', entity: 'customers', entityId: customer.id,
        summary: `تجاوز الحد الائتماني لعميل ${customer.name} بمبلغ ${total} قرش`,
        reason: override.reason.trim(),
      });
    } else {
      await assertCreditWithinLimit(tx, store, customer, total);
    }

    // 3) نسبة الضريبة من الإعدادات إن لم تُحدد صراحة
    let finalVatRate = resolvedVatRate;
    let vatAmount;
    let grandTotal;
    if (finalVatRate === null) {
      const st = await tx.get(store.ref('settings', 'main'));
      finalVatRate = st.exists ? (st.data.vatRate ?? 0) : 0;
      const re = computeVat(taxable, finalVatRate);
      vatAmount = re.vat;
      grandTotal = re.total;
    } else {
      vatAmount = vat;
      grandTotal = total;
    }

    // 4) الفترة مفتوحة؟ (بوابة المحرك داخل نفس المعاملة عند الترحيل)
    await assertPeriodOpenForDate(tx, store, date);

    // 5) الحساب الفرعي للعميل (تأكيد وجوده)
    const subSnap = await tx.get(store.ref('accounts', customer.customerAccountCode));
    if (!subSnap.exists) throw errors.invalidAccount(customer.customerAccountCode, 'حساب العميل الفرعي مفقود');

    // 6) الترقيم الذري
    const { number, docId } = await allocateNumber(tx, store, 'invoice', date);
    const dueDate = input.dueDate ? assertValidDate(input.dueDate, 'تاريخ الاستحقاق') : dueDateFor(customer, date);

    // 7) القيد المزدوج التلقائي — داخل نفس المعاملة
    const revenueCode = REVENUE_ACCOUNT[kind];
    const { entry } = await postJournalEntryTx(tx, store, {
      date,
      memo: `فاتورة ${number} إلى العميل ${customer.name} (${customer.code})`,
      lines: [
        {
          accountCode: customer.customerAccountCode, debit: grandTotal, credit: 0,
          note: `فاتورة ${number}`, party: { kind: 'customer', id: customer.id, name: customer.name },
        },
        { accountCode: revenueCode, debit: 0, credit: taxable, note: 'إيراد (صافي بعد الخصم)' },
        ...(vatAmount > 0 ? [{ accountCode: '2150', debit: 0, credit: vatAmount, note: `ضريبة قيمة مضافة ${finalVatRate}%` }] : []),
      ],
      actor,
      sourceRef: { module: 'invoices', docId, number },
      idempotencyKey: input.idempotencyKey ? `invoice:${input.idempotencyKey}` : null,
    });

    // 8) وثيقة الفاتورة
    const invoice = {
      id: docId, number, date, dueDate, kind,
      customerId: customer.id, customerCode: customer.code, customerName: customer.name,
      customerAccountCode: customer.customerAccountCode,
      items, subtotal, discount, vatRate: finalVatRate, vatAmount,
      total: grandTotal, paidTotal: 0, balance: grandTotal,
      status: 'unpaid', // unpaid | partial | paid | cancelled
      journalEntryId: entry.id, journalNumber: entry.number,
      notes: input.notes || '',
      creditOverride: override ? { reason: override.reason.trim(), by: actor.email } : null,
      createdBy: { uid: actor.uid, email: actor.email, name: actor.name || '' },
      createdAt: nowISO(), updatedAt: nowISO(),
    };
    tx.set(store.ref('invoices', docId), invoice);

    // 9) تحديث ذاكرة ذمم العميل (مصدر الحقيقة يظل دفتر الأستاذ)
    tx.update(store.ref('customers', customer.id), {
      arBalancePiasters: (customer.arBalancePiasters || 0) + grandTotal,
      updatedAt: nowISO(),
    });

    // 10) تدقيق داخل نفس المعاملة
    await writeAuditTx(tx, store, {
      actor, action: 'invoice.create', entity: 'invoices', entityId: docId,
      summary: `فاتورة ${number} للعميل ${customer.name} بقيمة ${(grandTotal / 100).toFixed(2)} ج.م`,
    });

    return { invoice, journalEntry: entry };
  });
}

/**
 * إلغاء فاتورة — قيد عكسي موثق، لا حذف أبداً.
 * يُمنع الإلغاء إن كانت الفاتورة قد حصّلنا عليها جزئياً أو كلياً —
 * يجب أولاً عكس سندات التحصيل ثم إلغاء الفاتورة.
 */
export async function cancelInvoice(store, actor, { invoiceId, reason, date }) {
  if (!reason || String(reason).trim().length < 10) {
    throw errors.badRequest('سبب الإلغاء إلزامي (10 أحرف على الأقل) — يُوثَّق في القيد العكسي وسجل التدقيق');
  }
  const cancelDate = assertValidDate(date || nowISO().slice(0, 10), 'تاريخ الإلغاء');
  return store.runTransaction(async (tx) => {
    const invSnap = await tx.get(store.ref('invoices', invoiceId));
    if (!invSnap.exists) throw errors.notFound('الفاتورة');
    const invoice = invSnap.data;
    if (invoice.status === 'cancelled') throw errors.conflict('ALREADY_CANCELLED', 'الفاتورة ملغاة بالفعل');
    if ((invoice.paidTotal || 0) > 0) {
      throw errors.conflict(
        'INVOICE_HAS_PAYMENTS',
        `لا يمكن إلغاء فاتورة عليها تحصيلات (${(invoice.paidTotal / 100).toFixed(2)} ج.م) — اعكس سندات التحصيل أولاً`,
      );
    }

    // القيد العكسي — يفحص التكرار عبر reversal_index داخلياً
    const originalEntry = await tx.get(store.ref('journal_entries', invoice.journalEntryId));
    if (!originalEntry.exists) throw errors.notFound('قيد الفاتورة الأصلي');
    const reversedLines = originalEntry.data.lines.map((l) => ({
      accountCode: l.accountCode, debit: l.credit, credit: l.debit, note: l.note, party: l.party,
    }));
    const { entry: reversalEntry } = await postJournalEntryTx(tx, store, {
      date: cancelDate,
      memo: `إلغاء الفاتورة ${invoice.number} — ${String(reason).trim()}`,
      lines: reversedLines,
      actor,
      type: ENTRY_TYPE.REVERSAL,
      sourceRef: { module: 'invoices', docId: invoice.id, number: invoice.number },
      reversalOf: invoice.journalEntryId,
      reversalReason: String(reason).trim(),
    });

    // حالة الفاتورة + ذمم العميل
    tx.update(store.ref('invoices', invoice.id), {
      status: 'cancelled', balance: 0, cancelledAt: nowISO(),
      cancelledBy: { uid: actor.uid, email: actor.email },
      cancellationReason: String(reason).trim(),
      reversalEntryId: reversalEntry.id,
      updatedAt: nowISO(),
    });
    const custSnap = await tx.get(store.ref('customers', invoice.customerId));
    if (custSnap.exists) {
      tx.update(store.ref('customers', invoice.customerId), {
        arBalancePiasters: (custSnap.data.arBalancePiasters || 0) - invoice.total,
        updatedAt: nowISO(),
      });
    }
    await writeAuditTx(tx, store, {
      actor, action: 'invoice.cancel', entity: 'invoices', entityId: invoice.id,
      summary: `إلغاء الفاتورة ${invoice.number} بقيد عكسي ${reversalEntry.number}`,
      reason: String(reason).trim(),
    });
    return { invoice: { ...invoice, status: 'cancelled' }, reversalEntry };
  });
}

/** قائمة الفواتير */
export async function listInvoices(store, { customerId, status, from, to, limit = 200 } = {}) {
  const where = [];
  if (customerId) where.push(['customerId', '==', customerId]);
  if (status) where.push(['status', '==', status]);
  if (from) where.push(['date', '>=', from]);
  if (to) where.push(['date', '<=', to]);
  return store.read('invoices', {
    where: where.length ? where : undefined,
    orderBy: ['date', 'desc'], limit,
  });
}

/** تفاصيل فاتورة مع قيدها */
export async function getInvoice(store, invoiceId) {
  const snap = await store.get(store.ref('invoices', invoiceId));
  if (!snap.exists) throw errors.notFound('الفاتورة');
  const invoice = snap.data;
  const entry = invoice.journalEntryId ? await getEntry(store, invoice.journalEntryId) : null;
  return { ...invoice, journalEntry: entry };
}
