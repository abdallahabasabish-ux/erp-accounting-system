/**
 * عميل ERP للواجهة — أنواع بيانات صارمة + استدعاءات API عبر وسيط نفس الأصل
 * (/api/erp/...) + أدوات المبالغ (قروش صحيحة فقط) + أدوات الصلاحيات.
 *
 * قاعدة ذهبية: كل المبالغ في استجابات الخادم أعداد صحيحة بالقروش (1 ج.م = 100 قرش).
 * لا floats في أي منطق مالي — التحويل من/إلى نص الجنيه يتم عبر تحليل نصي دقيق.
 */

/* ---------------------------------- أنواع ---------------------------------- */

export interface ErpMeta {
  mode: 'demo' | 'production';
  currency: string;
  currencySymbol: string;
  minorUnit: number;
  vatRate: number;
  timezone?: string;
  apiVersion?: string;
}

export type ErpRole = 'admin' | 'manager' | 'accountant' | 'employee' | 'client';

export interface ErpUser {
  uid: string;
  email: string;
  displayName: string;
  role: ErpRole;
  permissions: string[];
  disabled?: boolean;
  employeeId?: string | null;
  customerId?: string | null;
}

export interface AuthResponse {
  token: string;
  user: ErpUser;
}

export type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
export type AccountKind = 'group' | 'posting';

export interface Account {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  kind: AccountKind;
  parent: string | null;
  active: boolean;
  isSystem?: boolean;
  hint?: string;
  balancePiasters: number;
  children?: AccountNode[];
}

export type AccountNode = Account & { children?: AccountNode[] };

export type JournalEntryType = 'standard' | 'reversal' | 'closing' | 'opening' | 'adjusting';

export interface JournalLine {
  accountCode: string;
  accountName: string;
  debit: number;
  credit: number;
  note?: string | null;
  party?: { kind: string; id: string; name: string } | null;
}

export interface JournalEntry {
  id: string;
  number: string;
  date: string;
  periodKey: string;
  type: JournalEntryType;
  memo: string;
  sourceRef?: { module: string; docId: string; number: string } | null;
  lines: JournalLine[];
  totalDebit: number;
  totalCredit: number;
  createdBy?: { email: string; name?: string } | null;
  reversesOf?: string | null;
  reversalReason?: string | null;
}

export type PeriodStatus = 'open' | 'closed' | 'locked';

export interface FiscalPeriod {
  key: string;
  status: PeriodStatus;
  start: string;
  end: string;
  closedAt?: string | null;
  closedBy?: { email?: string; name?: string } | null;
  closeReason?: string | null;
  reopenedAt?: string | null;
  reopenedBy?: { email?: string; name?: string } | null;
}

export interface Customer {
  id: string;
  code: string;
  name: string;
  phone?: string;
  email?: string;
  creditLimitPiasters: number;
  creditDays: number;
  arBalancePiasters: number;
  active: boolean;
  customerAccountCode: string;
}

export interface StatementMovement {
  entryId: string;
  number: string;
  date: string;
  memo: string;
  type?: string;
  debit: number;
  credit: number;
  runningBalance: number;
  direction?: string;
  amount?: number;
}

export interface CustomerStatement {
  customer: { id: string; code: string; name: string; customerAccountCode: string; creditLimitPiasters: number; creditDays: number };
  openingBalance: number;
  movements: StatementMovement[];
  closingBalance: number;
}

export type InvoiceStatus = 'unpaid' | 'partial' | 'paid' | 'cancelled';

export interface InvoiceItem {
  description: string;
  qty: number;
  unitPricePiasters: number;
  totalPiasters: number;
}

export interface Invoice {
  id: string;
  number: string;
  date: string;
  dueDate: string;
  customerName: string;
  customerCode?: string;
  customerAccountCode?: string;
  items: InvoiceItem[];
  subtotal: number;
  discount: number;
  vatRate: number;
  vatAmount: number;
  total: number;
  paidTotal: number;
  balance: number;
  status: InvoiceStatus;
  journalNumber?: string | null;
  notes?: string | null;
  journalEntry?: JournalEntry | null;
}

export interface Receipt {
  id: string;
  number: string;
  date: string;
  customerName: string;
  customerCode?: string;
  amount: number;
  method: string;
  allocations: { invoiceNumber: string; amount: number }[];
  onAccount: number;
  treasuryAccountName: string;
  journalNumber?: string | null;
  notes?: string | null;
}

export type PaymentRequestStatus = 'pending' | 'approved' | 'rejected';

export interface PaymentRequest {
  id: string;
  amount: number;
  method?: string;
  reference?: string;
  status: PaymentRequestStatus;
  createdAt: string;
  rejectionReason?: string | null;
  customerName?: string;
  customerId?: string;
}

export interface TreasuryAccount {
  id: string;
  name: string;
  type: 'cash' | 'bank';
  accountCode: string;
  balancePiasters: number;
  bankName?: string | null;
  active?: boolean;
}

export interface TreasuryReconciliation {
  id: string;
  treasuryAccountId: string;
  treasuryAccountName?: string;
  treasuryAccountCode?: string;
  bankName?: string | null;
  statementDate: string;
  statementBalance: number;
  bookBalance?: number;
  difference?: number;
  clearedEntryIds?: string[];
  createdBy?: { email: string } | null;
  createdAt?: string;
}

export interface Employee {
  id: string;
  code: string;
  name: string;
  position?: string;
  salaryBasicPiasters: number;
  allowancesPiasters: number;
  insuranceEmployeePiasters: number;
  payrollTaxPiasters: number;
  commissionPercent?: number;
  advancesOutstandingPiasters: number;
  salariesPayablePiasters: number;
  status: string;
}

export interface PayrollRunLine {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  basic: number;
  allowances: number;
  gross: number;
  advancesDeducted: number;
  insurance: number;
  tax: number;
  otherDeduction?: number;
  net: number;
}

export interface PayrollRun {
  id: string;
  number: string;
  period: string;
  date: string;
  status: 'draft' | 'approved' | 'paid';
  lines: PayrollRunLine[];
  totals: { gross: number; advances: number; insurance: number; tax: number; net: number; otherDeductions?: number };
  journalNumber?: string | null;
  paymentEntryId?: string | null;
  notes?: string | null;
}

export interface HrMe {
  employee: { id: string; code: string; name: string; position?: string; salaryBasicPiasters: number; allowancesPiasters: number };
  advancesOutstandingPiasters: number;
  salariesPayablePiasters: number;
  payrollHistory: { period: string; status: string; date: string; mine: PayrollRunLine }[];
}

export type ExpenseCategory =
  | 'operating' | 'marketing' | 'software' | 'hosting' | 'salaries'
  | 'task_payments' | 'utilities' | 'rent' | 'other';

export interface Expense {
  id: string;
  number: string;
  date: string;
  amount: number;
  memo: string;
  expenseAccountName: string;
  expenseAccountCode?: string;
  category: ExpenseCategory;
  creditLabel: string;
  paymentMethod?: string;
  supplierName?: string | null;
}

export interface AuditLog {
  id: string;
  at: string;
  actor: { email?: string; name?: string; role?: string };
  action: string;
  entity: string;
  entityId?: string;
  summary: string;
}

export interface ErpUserRow {
  uid: string;
  email: string;
  displayName: string;
  role: ErpRole;
  permissions: string[];
  disabled: boolean;
  employeeId?: string | null;
  customerId?: string | null;
}

export interface ErpSettings {
  companyName: string;
  vatRate: number;
  defaultCreditDays: number;
  advanceCapPercent: number;
  currency?: string;
  currencySymbol?: string;
}

/* ------------------------------- تقارير مالية ------------------------------- */

export interface TrialBalanceRow {
  code: string;
  name: string;
  type: AccountType;
  opening: { debit: number; credit: number };
  period: { debit: number; credit: number };
  closing: { debit: number; credit: number };
  closingBalance: number;
}

export interface TrialBalance {
  rows: TrialBalanceRow[];
  totals: { openingDebit: number; openingCredit: number; periodDebit: number; periodCredit: number; closingDebit: number; closingCredit: number };
  balanced: boolean;
  period?: { from?: string; to?: string };
}

export interface PLLine { code: string; name: string; amount: number }

export interface ProfitLoss {
  revenue: PLLine[];
  totalRevenue: number;
  costOfServices: PLLine[];
  totalCogs: number;
  grossProfit: number;
  operatingExpenses: PLLine[];
  totalOpex: number;
  netProfit: number;
  check?: number;
  balanced?: boolean;
  period?: { from?: string; to?: string };
}

export interface BSEntry { code: string; name: string; amount: number }

export interface BalanceSheet {
  assets: BSEntry[];
  totalAssets: number;
  liabilities: BSEntry[];
  totalLiabilities: number;
  equity: BSEntry[];
  totalEquity: number;
  netIncome: number;
  balanced: boolean;
  asOf?: string;
}

export interface CashFlow {
  sections: { operating: number; investing: number; financing: number; cashInflow?: number };
  netChange: number;
  openingCash: number;
  closingCash: number;
  reconciled: boolean;
  period?: { from?: string; to?: string };
}

export interface AgingBuckets { current: number; d1_30: number; d31_60: number; d61_90: number; d90_plus: number }

export interface AgingReport {
  asOf: string;
  totals: AgingBuckets;
  totalReceivable: number;
  customers: { customerId: string; customerName: string; total: number; buckets: AgingBuckets; oldestDueDate?: string }[];
}

export interface LedgerReport {
  account: { code: string; name: string; type?: AccountType; normalSide?: string };
  openingBalance: number;
  movements: StatementMovement[];
  totals?: { debit: number; credit: number };
  closingBalance: number;
}

export interface PortalOverview {
  overview: {
    customer: { id: string; code?: string; name: string; creditLimitPiasters: number; arBalancePiasters: number };
    invoices: { id: string; number: string; date: string; dueDate: string; total: number; paidTotal: number; balance: number; status: InvoiceStatus }[];
    paymentRequests: PaymentRequest[];
  };
}

/* --------------------------------- الأخطاء --------------------------------- */

export class ErpError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ErpError';
    this.status = status;
    this.code = code;
  }
}

/* -------------------------------- عميل API --------------------------------- */

const API_BASE = '/api/erp';

export class ErpClient {
  private token: string | null = null;
  /** يضبطه التطبيق لمسح الجلسة عند 401 */
  onUnauthorized: (() => void) | null = null;

  setToken(token: string | null) {
    this.token = token;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    let res: Response;
    try {
      res = await fetch(`${API_BASE}/${path}`, { ...init, headers, cache: 'no-store' });
    } catch {
      throw new ErpError(0, 'NETWORK', 'تعذر الاتصال بالخادم — تحقق من الشبكة');
    }
    if (res.status === 401) {
      this.onUnauthorized?.();
      throw new ErpError(401, 'UNAUTHENTICATED', 'انتهت الجلسة أو رمز غير صالح — سجّل الدخول من جديد');
    }
    const data = (await res.json().catch(() => null)) as unknown;
    if (!res.ok) {
      const env = data as { error?: { code?: string; message?: string } } | null;
      throw new ErpError(
        res.status,
        env?.error?.code ?? 'ERROR',
        env?.error?.message ?? 'حدث خطأ غير متوقع — حاول مرة أخرى',
      );
    }
    return data as T;
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>(path);
  }
  post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) });
  }
  patch<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, { method: 'PATCH', body: JSON.stringify(body ?? {}) });
  }
  delete<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, { method: 'DELETE', body: JSON.stringify(body ?? {}) });
  }
}

export const api = new ErpClient();

/* ------------------------------ أدوات المبالغ ------------------------------ */

/** ينسق القروش إلى نص جنيه مع تجميع الآلاف وعلامتين عشريتين: 125075 → "1,250.75 ج.م" */
export function formatEGP(piasters: number, withSymbol = true): string {
  const sign = piasters < 0 ? '-' : '';
  const abs = Math.abs(Math.trunc(piasters));
  const egp = Math.floor(abs / 100);
  const pts = String(abs % 100).padStart(2, '0');
  return `${sign}${egp.toLocaleString('en-US')}.${pts}${withSymbol ? ' ج.م' : ''}`;
}

/** ينسق رقماً عشرياً (نسب، أعداد) مع اتجاه LTR محفوظ */
export function formatNumber(n: number, maxFraction = 2): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: maxFraction });
}

/**
 * يحلل نص جنيه مكتوباً من المستخدم ("1250.75" أو "1,250.75") إلى قروش صحيحة.
 * يعيد null إذا كان النص غير صالح. حساب نصي دقيق بلا floats.
 */
export function parseEGPToPiasters(input: string): number | null {
  if (!input) return null;
  let s = input.trim().replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))); // أرقام عربية
  s = s.replace(/[,٬’\s]/g, '').replace(/[٫]/g, '.');
  if (!/^-?\d{1,15}(\.\d{1,2})?$/.test(s)) return null;
  const neg = s.startsWith('-');
  const [intPart, decPart = ''] = s.replace(/^-/, '').split('.');
  const piasters = Number(intPart) * 100 + Number((decPart + '00').slice(0, 2));
  if (!Number.isSafeInteger(piasters)) return null;
  return neg ? -piasters : piasters;
}

/* ------------------------------ أدوات الصلاحيات ----------------------------- */

/** هل يملك المستخدم صلاحية معينة؟ (["*"] تعني الكل) */
export function can(user: ErpUser | null, permission: string): boolean {
  if (!user) return false;
  const perms = user.permissions || [];
  if (perms.includes('*')) return true;
  return perms.includes(permission);
}

export const ROLE_LABELS: Record<ErpRole, string> = {
  admin: 'مدير النظام',
  manager: 'مدير مالي',
  accountant: 'محاسب',
  employee: 'موظف',
  client: 'عميل',
};

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  asset: 'أصول',
  liability: 'التزامات',
  equity: 'حقوق ملكية',
  revenue: 'إيرادات',
  expense: 'مصروفات',
};

export const JOURNAL_TYPE_LABELS: Record<JournalEntryType, string> = {
  standard: 'قيود عادية',
  reversal: 'قيد عكسي',
  closing: 'قيد إغلاق',
  opening: 'قيد افتتاحي',
  adjusting: 'قيد تسوية',
};

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  unpaid: 'غير مدفوعة',
  partial: 'مدفوعة جزئياً',
  paid: 'مدفوعة',
  cancelled: 'ملغاة',
};

export const PERIOD_STATUS_LABELS: Record<PeriodStatus, string> = {
  open: 'مفتوحة',
  closed: 'مغلقة',
  locked: 'مقفلة',
};

export const PAYMENT_REQUEST_STATUS_LABELS: Record<PaymentRequestStatus, string> = {
  pending: 'قيد الانتظار',
  approved: 'معتمد',
  rejected: 'مرفوض',
};

export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  operating: 'تشغيلية',
  marketing: 'تسويقية',
  software: 'برمجيات',
  hosting: 'استضافة',
  salaries: 'رواتب',
  task_payments: 'مدفوعات مهام',
  utilities: 'مرافق',
  rent: 'إيجار',
  other: 'أخرى',
};

export const EXPENSE_CATEGORIES = Object.keys(EXPENSE_CATEGORY_LABELS) as ExpenseCategory[];

/** كل الصلاحيات الممكنة (نفس قائمة الخادم) — لمحرر صلاحيات المستخدمين */
export const ALL_PERMISSIONS = [
  'dashboard:view',
  'accounts:view', 'accounts:manage',
  'journal:view', 'journal:create', 'journal:reverse',
  'customers:view', 'customers:manage',
  'invoices:view', 'invoices:create', 'invoices:cancel',
  'payments:view', 'payments:create', 'payments:approve',
  'treasury:view', 'treasury:manage',
  'expenses:view', 'expenses:create', 'expenses:approve',
  'employees:view', 'employees:manage',
  'payroll:view', 'payroll:run', 'payroll:approve',
  'periods:view', 'periods:close',
  'reports:view',
  'audit:view',
  'users:manage',
];

/* -------------------------------- أدوات تواريخ ------------------------------ */

export function todayISO(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function currentPeriodKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function firstDayOfMonthISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

/** يعرض التاريخ YYYY-MM-DD كما هو (نص محايد الاتجاه داخل bdi) */
export function formatDate(iso?: string | null): string {
  return iso ? iso.slice(0, 10) : '—';
}

export function formatDateTime(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
