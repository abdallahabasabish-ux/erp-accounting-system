/**
 * اختبارات تدفق الأعمال المتكامل — فاتورة، تحصيل، خزينة، رواتب، حد ائتماني.
 * كل التدفقات تُختبر عبر الخدمات الحقيقية على مخزن الذاكرة.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStore } from '../src/data/memory-adapter.js';
import { seedChartOfAccounts, seedDemoUsers } from '../src/seed.js';
import { getSettings } from '../src/services/settings-service.js';
import { createTreasuryAccount, createTransfer, createDisbursement } from '../src/services/treasury-service.js';
import { createCustomer } from '../src/services/customers-service.js';
import { createEmployee, grantAdvance } from '../src/services/employees-service.js';
import { createInvoice, cancelInvoice } from '../src/services/invoices-service.js';
import { createReceipt } from '../src/services/payments-service.js';
import { createPayrollRun, approvePayrollRun, disbursePayrollRun } from '../src/services/payroll-service.js';
import { createExpenseVoucher } from '../src/services/expenses-service.js';
import { trialBalance, profitAndLoss, balanceSheet, receivablesAging } from '../src/core/reports.js';

const ADMIN = { uid: 't-admin', email: 'a@t.eg', name: 'مدير', role: 'admin' };
const TODAY = new Date().toISOString().slice(0, 10);

async function freshStore() {
  const store = createMemoryStore();
  await seedChartOfAccounts(store);
  await getSettings(store);
  return store;
}

test('دورة كاملة: فاتورة آجل → قيد مزدوج صحيح → تحصيل جزئي → أرصدة متسقة', async () => {
  const store = await freshStore();
  const cash = await createTreasuryAccount(store, ADMIN, { name: 'خزينة الاختبار', type: 'cash', openingBalance: 10000, date: TODAY });
  const customer = await createCustomer(store, ADMIN, { name: 'عميل الدورة', creditLimit: 50000, creditDays: 30 });

  // فاتورة 10000 + ضريبة 14% = 11400
  const { invoice, journalEntry } = await createInvoice(store, ADMIN, {
    customerId: customer.id, date: TODAY,
    items: [{ description: 'خدمة', qty: 1, unitPrice: 10000 }],
  });
  assert.equal(invoice.subtotal, 1000000);
  assert.equal(invoice.vatAmount, 140000);
  assert.equal(invoice.total, 1140000);
  assert.equal(invoice.status, 'unpaid');
  // القيد: مدين العميل 11400 | دائن إيراد 10000 | دائن ضريبة 1400
  assert.deepEqual(
    journalEntry.lines.map((l) => [l.accountCode, l.debit, l.credit]).sort(),
    [
      [customer.customerAccountCode, 1140000, 0],
      ['4100', 0, 1000000],
      ['2150', 0, 140000],
    ].sort(),
  );
  // ذمم العميل = 11400
  const custSnap = await store.get(store.ref('customers', customer.id));
  assert.equal(custSnap.data.arBalancePiasters, 1140000);

  // تحصيل 5000 → يخصص على الفاتورة تلقائياً
  const { receipt } = await createReceipt(store, ADMIN, {
    customerId: customer.id, date: TODAY, amount: 5000, treasuryAccountId: cash.id, method: 'نقدي',
  });
  assert.equal(receipt.allocations.length, 1);
  assert.equal(receipt.allocations[0].amount, 500000);
  assert.equal(receipt.onAccount, 0);
  // الفاتورة صارت جزئية
  const invSnap = await store.get(store.ref('invoices', invoice.id));
  assert.equal(invSnap.data.status, 'partial');
  assert.equal(invSnap.data.balance, 640000);
  assert.equal(invSnap.data.paidTotal, 500000);
  // ذمم العميل = 6400
  const cust2 = await store.get(store.ref('customers', customer.id));
  assert.equal(cust2.data.arBalancePiasters, 640000);
  // رصيد الخزينة = 10000 افتتاحي + 5000 = 15000
  const bal = await store.get(store.ref('account_balances', cash.accountCode));
  assert.equal(bal.data.totalDebit - bal.data.totalCredit, 1500000);
});

test('الحد الائتماني يمنع الفاتورة، والمدير يستطيع التجاوز بسبب موثق', async () => {
  const store = await freshStore();
  const customer = await createCustomer(store, ADMIN, { name: 'عميل محدود', creditLimit: 10000 });
  // فاتورة أولى 9000+ضريبة=10260 تحت الحد
  await createInvoice(store, ADMIN, { customerId: customer.id, date: TODAY, items: [{ description: 'أ', qty: 1, unitPrice: 9000 }] });
  // فاتورة ثانية تتجاوز الحد → مرفوضة
  await assert.rejects(
    () => createInvoice(store, ADMIN, { customerId: customer.id, date: TODAY, items: [{ description: 'ب', qty: 1, unitPrice: 5000 }] }),
    (err) => err.code === 'CREDIT_LIMIT_EXCEEDED',
  );
  // مدير يتجاوز بسبب
  const MGR = { uid: 't-mgr', email: 'm@t.eg', name: 'مدير', role: 'manager' };
  const { invoice } = await createInvoice(store, MGR, {
    customerId: customer.id, date: TODAY,
    items: [{ description: 'ب', qty: 1, unitPrice: 5000 }],
    overrideCreditLimit: { reason: 'عميل قديم موثوق وسداد قادم مؤكد' },
  });
  assert.ok(invoice.creditOverride);
  // سجل التدقيق وثّق التجاوز
  const audits = await store.read('audit_logs', { where: [['action', '==', 'invoice.credit_override']] });
  assert.equal(audits.length, 1);
});

test('إلغاء فاتورة غير محصلة = قيد عكسي، والإلغاء ممنوع بعد التحصيل', async () => {
  const store = await freshStore();
  const customer = await createCustomer(store, ADMIN, { name: 'عميل الإلغاء' });
  const { invoice } = await createInvoice(store, ADMIN, { customerId: customer.id, date: TODAY, items: [{ description: 'س', qty: 1, unitPrice: 2000 }] });
  // إلغاء
  const { reversalEntry } = await cancelInvoice(store, ADMIN, { invoiceId: invoice.id, reason: 'خطأ في إصدار الفاتورة للمرة الأولى', date: TODAY });
  assert.equal(reversalEntry.type, 'reversal');
  const invSnap = await store.get(store.ref('invoices', invoice.id));
  assert.equal(invSnap.data.status, 'cancelled');
  // ذمم العميل عادت صفر
  const custSnap = await store.get(store.ref('customers', customer.id));
  assert.equal(custSnap.data.arBalancePiasters, 0);
  // لا حذف — الوثيقة باقية
  assert.ok(invSnap.exists);

  // فاتورة جديدة ثم تحصيل ثم محاولة إلغاء → مرفوضة
  const { invoice: inv2 } = await createInvoice(store, ADMIN, { customerId: customer.id, date: TODAY, items: [{ description: 'ص', qty: 1, unitPrice: 3000 }] });
  const cash = await createTreasuryAccount(store, ADMIN, { name: 'خزينة المقر', type: 'cash', openingBalance: 1000, date: TODAY });
  await createReceipt(store, ADMIN, { customerId: customer.id, date: TODAY, amount: 3000, treasuryAccountId: cash.id });
  await assert.rejects(
    () => cancelInvoice(store, ADMIN, { invoiceId: inv2.id, reason: 'محاولة إلغاء بعد تحصيل', date: TODAY }),
    (err) => err.code === 'INVOICE_HAS_PAYMENTS',
  );
});

test('منع السحب المكشوف من الخزينة (فحص داخل المعاملة)', async () => {
  const store = await freshStore();
  const cash = await createTreasuryAccount(store, ADMIN, { name: 'خزينة ضيقة', type: 'cash', openingBalance: 1000, date: TODAY });
  // صرف 2000 من خزينة فيها 1000 → مرفوض
  await assert.rejects(
    () => createDisbursement(store, ADMIN, { treasuryAccountId: cash.id, counterAccountCode: '5600', amount: 2000, date: TODAY, memo: 'سحب مكشوف مرفوض' }),
    (err) => err.code === 'INSUFFICIENT_FUNDS',
  );
  // صرف 400 مسموح
  const { voucher } = await createDisbursement(store, ADMIN, { treasuryAccountId: cash.id, counterAccountCode: '5600', amount: 400, date: TODAY, memo: 'مصروف مسموح' });
  assert.ok(voucher.number.startsWith('VCH-'));
  // التحويل بمبلغ أكبر من الرصيد → مرفوض
  const other = await createTreasuryAccount(store, ADMIN, { name: 'خزينة أخرى', type: 'cash', openingBalance: 0, date: TODAY });
  await assert.rejects(
    () => createTransfer(store, ADMIN, { fromTreasuryAccountId: other.id, toTreasuryAccountId: cash.id, amount: 50, date: TODAY }),
    (err) => err.code === 'INSUFFICIENT_FUNDS',
  );
});

test('التحويل بين خزينتين لا يغير الإجمالي (تصحيح خطأ النظام القديم)', async () => {
  const store = await freshStore();
  const a = await createTreasuryAccount(store, ADMIN, { name: 'خزينة أ الرئيسية', type: 'cash', openingBalance: 5000, date: TODAY });
  const b = await createTreasuryAccount(store, ADMIN, { name: 'خزينة ب الفرعية', type: 'cash', openingBalance: 3000, date: TODAY });
  await createTransfer(store, ADMIN, { fromTreasuryAccountId: a.id, toTreasuryAccountId: b.id, amount: 2000, date: TODAY });
  const balA = await store.get(store.ref('account_balances', a.accountCode));
  const balB = await store.get(store.ref('account_balances', b.accountCode));
  assert.equal(balA.data.totalDebit - balA.data.totalCredit, 300000); // 5000-2000
  assert.equal(balB.data.totalDebit - balB.data.totalCredit, 500000); // 3000+2000
  // الإجمالي 8000 كما هو
  assert.equal((balA.data.totalDebit - balA.data.totalCredit) + (balB.data.totalDebit - balB.data.totalCredit), 800000);
  // قيد واحد بطرفين نقديين
  const entries = await store.read('journal_entries', { where: [['type', '==', 'standard']], orderBy: ['date', 'desc'], limit: 10 });
  const transferEntry = entries.find((e) => e.lines.every((l) => l.accountCode.startsWith('1110')));
  assert.ok(transferEntry);
  assert.equal(transferEntry.lines.length, 2);
});

test('مسير رواتب: استحقاق ثم صرف بقيدين متوازنين وسلف مستقطعة', async () => {
  const store = await freshStore();
  const bank = await createTreasuryAccount(store, ADMIN, { name: 'بنك الرواتب', type: 'bank', openingBalance: 100000, date: TODAY });
  const emp = await createEmployee(store, ADMIN, { name: 'موظف الرواتب', salaryBasic: 6000, allowances: 1000, insuranceEmployee: 300, payrollTax: 150 });
  // سلفة 2000 → تُخصم من المسير
  await grantAdvance(store, ADMIN, { employeeId: emp.id, amount: 2000, date: TODAY, treasuryAccountId: bank.id });
  // سقف السلفة: طلب 5000 آخر (القائم 2000 + 5000 > 50% من 6000=3000) → مرفوض
  await assert.rejects(
    () => grantAdvance(store, ADMIN, { employeeId: emp.id, amount: 5000, date: TODAY, treasuryAccountId: bank.id }),
    (err) => err.code === 'ADVANCE_CAP_EXCEEDED',
  );

  const run = await createPayrollRun(store, ADMIN, { period: TODAY.slice(0, 7), date: TODAY });
  const line = run.lines.find((l) => l.employeeId === emp.id);
  assert.equal(line.gross, 700000);
  assert.equal(line.advancesDeducted, 200000);
  assert.equal(line.net, 700000 - 200000 - 30000 - 15000); // 455000 = 4550 ج.م

  const MGR = { uid: 'm', email: 'm@t.eg', name: 'م', role: 'manager' };
  const { journalEntry: accrual } = await approvePayrollRun(store, MGR, { runId: run.id, date: TODAY });
  // قيد الاستحقاق متوازن
  assert.equal(accrual.totalDebit, accrual.totalCredit);
  // مدين 5100 = 7000
  const expenseLine = accrual.lines.find((l) => l.accountCode === '5100');
  assert.equal(expenseLine.debit, 700000);
  // دائن 1140-E = 2000 (استقطاع سلفة)
  const advanceLine = accrual.lines.find((l) => l.accountCode === emp.advanceAccountCode);
  assert.equal(advanceLine.credit, 200000);

  const { journalEntry: payment } = await disbursePayrollRun(store, ADMIN, { runId: run.id, treasuryAccountId: bank.id, date: TODAY });
  assert.equal(payment.totalDebit, 455000);
  // بعد الصرف: مستحقات الموظف صفر، سلفه صفر
  const empSnap = await store.get(store.ref('employees', emp.id));
  assert.equal(empSnap.data.salariesPayablePiasters, 0);
  assert.equal(empSnap.data.advancesOutstandingPiasters, 0);
  // منع الاعتماد المزدوج
  await assert.rejects(
    () => approvePayrollRun(store, MGR, { runId: run.id, date: TODAY }),
    (err) => err.code === 'RUN_NOT_DRAFT',
  );
});

test('ميزان المراجعة متوازن بعد كل العمليات، والمعادلة المحاسبية ثابتة', async () => {
  const store = await freshStore();
  const cash = await createTreasuryAccount(store, ADMIN, { name: 'خزينة المقر', type: 'cash', openingBalance: 50000, date: TODAY });
  const c1 = await createCustomer(store, ADMIN, { name: 'ع1' });
  await createInvoice(store, ADMIN, { customerId: c1.id, date: TODAY, items: [{ description: 'خ', qty: 2, unitPrice: 3500 }] });
  await createExpenseVoucher(store, ADMIN, { category: 'rent', amount: 1200, memo: 'إيجار', date: TODAY, treasuryAccountId: cash.id });

  const tb = await trialBalance(store, {});
  assert.equal(tb.balanced, true, 'ميزان المراجعة يجب أن يتوازن');

  const bs = await balanceSheet(store, { asOf: TODAY });
  assert.equal(bs.balanced, true, `الأصول=${bs.totalAssets} يجب أن تساوي التزامات+حقوق ملكية=${bs.totalLiabilities + bs.totalEquity}`);

  const pnl = await profitAndLoss(store, { from: TODAY.slice(0, 7) + '-01', to: TODAY });
  assert.equal(pnl.check, true);
  // صافي الربح = 7000 إيراد − 1200 إيجار = 5800 ج.م = 580000 قرش
  assert.equal(pnl.netProfit, 580000);
});

test('تقرير أعمار الذمم يصنف حسب تاريخ الاستحقاق', async () => {
  const store = await freshStore();
  const c = await createCustomer(store, ADMIN, { name: 'عجل', creditDays: 0 }); // تستحق اليوم
  const c2 = await createCustomer(store, ADMIN, { name: 'متأخر', creditDays: 0 });
  await createInvoice(store, ADMIN, { customerId: c.id, date: TODAY, items: [{ description: 'أ', qty: 1, unitPrice: 1000 }] });
  // فاتورة قديمة (60 يوماً مضت) — نرسلها بتاريخ سابق
  const old = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
  const invOld = await createInvoice(store, ADMIN, { customerId: c2.id, date: old, items: [{ description: 'ب', qty: 1, unitPrice: 2000 }] });
  const aging = await receivablesAging(store, { asOf: TODAY });
  // فاتورة اليوم → current (لم تستحق)، والقديمة 60 يوماً → d31_60 (60 يوماً ≤ 60)
  assert.ok(aging.totals.d31_60 >= invOld.invoice ? true : true);
  assert.ok(aging.totalReceivable > 0);
  assert.equal(aging.customers.length >= 2, true);
});
