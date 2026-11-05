/**
 * بذور النظام: شجرة الحسابات (إلزامية دائماً) + بيانات تجريبية كاملة (وضع demo فقط).
 * كل البيانات التجريبية تُنشأ عبر الخدمات الحقيقية — أي أن أرقام العرض تتولد من
 * قيود مزدوجة فعلية، لا من حقول مخترعة.
 */
import { DEFAULT_COA } from './core/coa.js';
import { nowISO } from './lib/dates.js';
import { getSettings } from './services/settings-service.js';
import { createTreasuryAccount } from './services/treasury-service.js';
import { createCustomer } from './services/customers-service.js';
import { createEmployee } from './services/employees-service.js';
import { createInvoice } from './services/invoices-service.js';
import { createReceipt } from './services/payments-service.js';
import { createExpenseVoucher } from './services/expenses-service.js';
import { grantAdvance, accrueCommission } from './services/employees-service.js';
import { createPayrollRun, approvePayrollRun, disbursePayrollRun } from './services/payroll-service.js';
import { createHash } from 'node:crypto';
import { config } from './config.js';
import { ROLES, DEFAULT_ROLE_PERMISSIONS } from './services/auth-service.js';

/** زرع شجرة الحسابات الافتراضية (idempotent — يُتخطى إن وُجدت) */
export async function seedChartOfAccounts(store) {
  const existing = await store.read('accounts', { limit: 1 });
  if (existing.length) return { seeded: false };
  await store.runTransaction(async (tx) => {
    for (const acc of DEFAULT_COA) {
      tx.set(store.ref('accounts', acc.code), {
        ...acc,
        id: acc.code,
        active: true,
        isSystem: true,
        createdAt: nowISO(),
      });
    }
  });
  return { seeded: true, count: DEFAULT_COA.length };
}

const sha256 = (t) => createHash('sha256').update(t).digest('hex');

/** زرع المستخدمين التجريبيين (demo فقط) */
export async function seedDemoUsers(store) {
  const existing = await store.read('users', { limit: 1 });
  if (existing.length) return { seeded: false };
  const passwordHash = sha256(config.demo.password);
  const users = [
    { id: 'demo-admin', email: 'admin@demo.eg', displayName: 'مدير النظام', role: ROLES.ADMIN, permissions: ['*'] },
    { id: 'demo-manager', email: 'manager@demo.eg', displayName: 'المدير المالي', role: ROLES.MANAGER, permissions: null },
    { id: 'demo-accountant', email: 'accountant@demo.eg', displayName: 'المحاسب الرئيسي', role: ROLES.ACCOUNTANT, permissions: null },
    { id: 'demo-employee', email: 'employee@demo.eg', displayName: 'موظف تجريبي', role: ROLES.EMPLOYEE, permissions: null, employeeId: null },
    { id: 'demo-client', email: 'client@demo.eg', displayName: 'عميل تجريبي', role: ROLES.CLIENT, permissions: null, customerId: null },
  ];
  await store.runTransaction(async (tx) => {
    for (const u of users) {
      tx.set(store.ref('users', u.id), {
        ...u,
        permissions: u.permissions ?? DEFAULT_ROLE_PERMISSIONS[u.role],
        passwordHash,
        disabled: false,
        createdAt: nowISO(), updatedAt: nowISO(),
        createdBy: 'seed',
      });
    }
  });
  return { seeded: true, users: users.map((u) => u.email) };
}

/** بيانات تجريبية كاملة عبر الخدمات الحقيقية (demo فقط) */
export async function seedDemoData(store) {
  const invoices = await store.read('invoices', { limit: 1 });
  if (invoices.length) return { seeded: false };

  const today = nowISO().slice(0, 10);
  const admin = { uid: 'demo-admin', email: 'admin@demo.eg', name: 'مدير النظام', role: ROLES.ADMIN };

  // الإعدادات
  const settings = await getSettings(store);

  // 1) الخزائن والبنوك بأرصدة افتتاحية (قيد افتتاحي حقيقي)
  const cashBox = await createTreasuryAccount(store, admin, { name: 'الخزينة الرئيسية', type: 'cash', openingBalance: 150000, date: today });
  const bank = await createTreasuryAccount(store, admin, { name: 'البنك التجاري الدولي CIB', type: 'bank', bankName: 'CIB', accountNumber: '1000234567890', openingBalance: 350000, date: today });

  // 2) العملاء بحدود ائتمانية
  const nile = await createCustomer(store, admin, { name: 'شركة النيل للتصميم', phone: '01001234567', email: 'info@nile-design.eg', company: 'شركة النيل', creditLimit: 50000, creditDays: 30 });
  const zabadi = await createCustomer(store, admin, { name: 'مطعم الذواقة', phone: '01112345678', creditLimit: 20000, creditDays: 15 });
  const safwa = await createCustomer(store, admin, { name: 'مكتب الصفا للاستشارات', phone: '01223456789', creditLimit: 0, creditDays: 30 });

  // ربط مستخدم العميل التجريبي بمكتب الصفا
  await store.runTransaction(async (tx) => {
    tx.update(store.ref('customers', safwa.id), { uid: 'demo-client', updatedAt: nowISO() });
    tx.update(store.ref('users', 'demo-client'), { customerId: safwa.id, updatedAt: nowISO() });
  });

  // 3) الموظفون
  const ahmed = await createEmployee(store, admin, { name: 'أحمد عبد الرحمن', position: 'محاسب أول', salaryBasic: 8000, allowances: 1000, insuranceEmployee: 400, payrollTax: 200 });
  const sara = await createEmployee(store, admin, { name: 'سارة محمود', position: 'مصممة جرافيك', salaryBasic: 6000, allowances: 800, insuranceEmployee: 300, payrollTax: 120 });
  const mohamed = await createEmployee(store, admin, { name: 'محمد فتحي', position: 'مطور ويب', salaryBasic: 10000, allowances: 1500 });
  await store.runTransaction(async (tx) => {
    tx.update(store.ref('users', 'demo-employee'), { employeeId: ahmed.id, updatedAt: nowISO() });
    tx.update(store.ref('employees', ahmed.id), { uid: 'demo-employee', updatedAt: nowISO() });
  });

  // 4) فواتير (قيد مزدوج تلقائي)
  const inv1 = await createInvoice(store, admin, {
    customerId: nile.id, date: today, kind: 'service',
    items: [{ description: 'تصميم هوية بصرية كاملة', qty: 1, unitPrice: 12000 }, { description: 'تطوير موقع إلكتروني', qty: 1, unitPrice: 18000 }],
    notes: 'دفعة أولى من المشروع',
  });
  const inv2 = await createInvoice(store, admin, {
    customerId: zabadi.id, date: today, kind: 'service',
    items: [{ description: 'تصميم قائمة طعام تفاعلية', qty: 1, unitPrice: 6000 }],
    discount: 500,
  });
  const inv3 = await createInvoice(store, admin, {
    customerId: safwa.id, date: today, kind: 'service',
    items: [{ description: 'إدارة حسابات السوشيال ميديا (شهري)', qty: 3, unitPrice: 4000 }],
  });

  // 5) تحصيلات (تخصيص تلقائي FIFO على الفواتير)
  await createReceipt(store, admin, { customerId: nile.id, date: today, amount: 15000, treasuryAccountId: bank.id, method: 'تحويل بنكي' });
  await createReceipt(store, admin, { customerId: zabadi.id, date: today, amount: 6270, treasuryAccountId: cashBox.id, method: 'نقدي' });

  // 6) مصروفات (فئات النظام القديم موزعة على حسابات الشجرة)
  await createExpenseVoucher(store, admin, { category: 'rent', amount: 5000, memo: 'إيجار المكتب — شهري', date: today, treasuryAccountId: bank.id });
  await createExpenseVoucher(store, admin, { category: 'marketing', amount: 2000, memo: 'حملة إعلانات ممولة', date: today, treasuryAccountId: cashBox.id });
  await createExpenseVoucher(store, admin, { category: 'hosting', amount: 1200, memo: 'استضافة وخدمات سحابية', date: today, treasuryAccountId: bank.id });
  await createExpenseVoucher(store, admin, { category: 'operating', amount: 800, memo: 'مستلزمات مكتبية', date: today, treasuryAccountId: cashBox.id });

  // 7) سلفة واستحقاق عمولة
  await grantAdvance(store, admin, { employeeId: mohamed.id, amount: 2000, date: today, memo: 'سلفة ظروف عاجلة', treasuryAccountId: cashBox.id });
  await accrueCommission(store, admin, { employeeId: sara.id, amount: 1500, date: today, memo: 'تعويض تسليم هوية شركة النيل' });

  // 8) مسير رواتب الشهر الحالي: استحقاق ثم صرف
  const period = today.slice(0, 7);
  const run = await createPayrollRun(store, admin, { period, date: today, notes: 'مسير تجريبي' });
  await approvePayrollRun(store, { uid: 'demo-manager', email: 'manager@demo.eg', name: 'المدير المالي', role: ROLES.MANAGER }, { runId: run.id, date: today });
  await disbursePayrollRun(store, admin, { runId: run.id, treasuryAccountId: bank.id, date: today });

  return {
    seeded: true,
    summary: {
      treasury: [cashBox.name, bank.name],
      customers: [nile.code, zabadi.code, safwa.code],
      employees: [ahmed.code, sara.code, mohamed.code],
      invoices: [inv1.invoice.number, inv2.invoice.number, inv3.invoice.number],
      payrollRun: run.number,
      settingsVatRate: settings.vatRate,
    },
  };
}

/** تهيئة كاملة (تُستدعى عند الإقلاع) */
export async function bootstrapStore(store) {
  const coa = await seedChartOfAccounts(store);
  await getSettings(store); // تهيئة الإعدادات
  let users = { seeded: false };
  let demo = { seeded: false };
  if (store.mode === 'demo') {
    users = await seedDemoUsers(store);
    if (users.seeded) demo = await seedDemoData(store);
  }
  return { coa, users, demo };
}
