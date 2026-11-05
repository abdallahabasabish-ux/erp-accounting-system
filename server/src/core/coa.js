/**
 * شجرة الحسابات القياسية (Chart of Accounts) — الهيكل المرجعي للنظام كله.
 *
 * قواعد الترقيم (4 خانات للسامي + لاحقة فرعي للتحليلية):
 *   1xxx الأصول (طبيعة مدين)
 *   2xxx الالتزامات (طبيعة دائن)
 *   3xxx حقوق الملكية (طبيعة دائن)
 *   4xxx الإيرادات (طبيعة دائن)
 *   5xxx المصروفات والتكاليف (طبيعة مدين)
 *
 * نوعان من الحسابات:
 *   group   = حساب تجميعي (رأس فرع في الشجرة) — لا يُرحَّل عليه قيد أبداً.
 *   posting = حساب ترحيل (ورقة شجرية) — يستقبل القيود فقط.
 *
 * الحسابات التحليلية الفرعية (عميل/موظف/مورد/خزينة) تُنشأ آلياً برمز
 * مثل 1120-C0001 (ذمة عميل) وتظل أبناء الحساب الرقابي (Control Account) —
 * وبذلك تتوازن القوائم دائماً لأن القوائم تُبنى على مستوى الرقابي أو أعلى.
 */

export const ACCOUNT_TYPE = {
  ASSET: 'asset',           // أصول
  LIABILITY: 'liability',   // التزامات
  EQUITY: 'equity',         // حقوق ملكية
  REVENUE: 'revenue',       // إيرادات
  EXPENSE: 'expense',       // مصروفات
};

export const NORMAL_SIDE = {
  asset: 'debit', expense: 'debit',
  liability: 'credit', equity: 'credit', revenue: 'credit',
};

/** التعريف الافتراضي للشجرة — يُزرع مرة واحدة ويُوسَّع من الواجهة لاحقاً */
export const DEFAULT_COA = [
  // ─── 1) الأصول ───────────────────────────────────────────────
  { code: '1000', name: 'الأصول', type: ACCOUNT_TYPE.ASSET, kind: 'group', parent: null },
  { code: '1100', name: 'الأصول المتداولة', type: ACCOUNT_TYPE.ASSET, kind: 'group', parent: '1000' },
  {
    code: '1110', name: 'النقد بالخزائن', type: ACCOUNT_TYPE.ASSET, kind: 'group', parent: '1100',
    hint: 'كل خزينة نقدية تُنشأ لها وثيقة خزينة بحساب فرعي 1110-Txx',
  },
  {
    code: '1115', name: 'النقد بالبنوك', type: ACCOUNT_TYPE.ASSET, kind: 'group', parent: '1100',
    hint: 'كل حساب بنكي تُنشأ له وثيقة خزينة بحساب فرعي 1115-Bxx',
  },
  {
    code: '1120', name: 'ذمم العملاء (مدينون)', type: ACCOUNT_TYPE.ASSET, kind: 'posting', parent: '1100',
    controlFor: 'customers', hint: 'الحساب الرقابي — الذمم التفصيلية على 1120-Cxxxx',
  },
  {
    code: '1140', name: 'سلف الموظفين', type: ACCOUNT_TYPE.ASSET, kind: 'posting', parent: '1100',
    controlFor: 'employees', hint: 'الحساب الرقابي — سلف الموظفين على 1140-Exxxx',
  },
  { code: '1150', name: 'مصروفات مدفوعة مقدماً', type: ACCOUNT_TYPE.ASSET, kind: 'posting', parent: '1100' },
  { code: '1160', name: 'ضريبة القيمة المضافة على المشتريات (خصم)', type: ACCOUNT_TYPE.ASSET, kind: 'posting', parent: '1100' },

  { code: '1200', name: 'الأصول الثابتة', type: ACCOUNT_TYPE.ASSET, kind: 'group', parent: '1000' },
  { code: '1210', name: 'أثاث وتجهيزات', type: ACCOUNT_TYPE.ASSET, kind: 'posting', parent: '1200' },
  { code: '1220', name: 'معدات وأجهزة حاسوب', type: ACCOUNT_TYPE.ASSET, kind: 'posting', parent: '1200' },
  { code: '1230', name: 'مجمع الإهلاك', type: ACCOUNT_TYPE.ASSET, kind: 'posting', parent: '1200', contra: true },

  // ─── 2) الالتزامات ───────────────────────────────────────────
  { code: '2000', name: 'الالتزامات', type: ACCOUNT_TYPE.LIABILITY, kind: 'group', parent: null },
  { code: '2100', name: 'التزامات متداولة', type: ACCOUNT_TYPE.LIABILITY, kind: 'group', parent: '2000' },
  {
    code: '2110', name: 'ذمم الموردين (دائنون)', type: ACCOUNT_TYPE.LIABILITY, kind: 'posting', parent: '2100',
    controlFor: 'suppliers', hint: 'الحساب الرقابي — الذمم التفصيلية على 2110-Sxxxx',
  },
  {
    code: '2120', name: 'رواتب مستحقة الدفع', type: ACCOUNT_TYPE.LIABILITY, kind: 'posting', parent: '2100',
    controlFor: 'employees', hint: 'الحساب الرقابي — مستحقات كل موظف على 2120-Exxxx',
  },
  { code: '2130', name: 'التأمينات الاجتماعية المستحقة', type: ACCOUNT_TYPE.LIABILITY, kind: 'posting', parent: '2100' },
  { code: '2140', name: 'ضرائب الرواتب المستحقة', type: ACCOUNT_TYPE.LIABILITY, kind: 'posting', parent: '2100' },
  { code: '2150', name: 'ضريبة القيمة المضافة المستحقة (مبيعات)', type: ACCOUNT_TYPE.LIABILITY, kind: 'posting', parent: '2100' },
  { code: '2210', name: 'قروض طويلة الأجل', type: ACCOUNT_TYPE.LIABILITY, kind: 'posting', parent: '2000' },

  // ─── 3) حقوق الملكية ─────────────────────────────────────────
  { code: '3000', name: 'حقوق الملكية', type: ACCOUNT_TYPE.EQUITY, kind: 'group', parent: null },
  { code: '3100', name: 'رأس المال', type: ACCOUNT_TYPE.EQUITY, kind: 'posting', parent: '3000' },
  { code: '3200', name: 'الأرباح المبقاة', type: ACCOUNT_TYPE.EQUITY, kind: 'posting', parent: '3000' },
  { code: '3300', name: 'المسحوبات الشخصية', type: ACCOUNT_TYPE.EQUITY, kind: 'posting', parent: '3000' },

  // ─── 4) الإيرادات ────────────────────────────────────────────
  { code: '4000', name: 'الإيرادات', type: ACCOUNT_TYPE.REVENUE, kind: 'group', parent: null },
  { code: '4100', name: 'إيرادات الخدمات', type: ACCOUNT_TYPE.REVENUE, kind: 'posting', parent: '4000' },
  { code: '4200', name: 'إيرادات المنتجات', type: ACCOUNT_TYPE.REVENUE, kind: 'posting', parent: '4000' },
  { code: '4300', name: 'إيرادات أخرى', type: ACCOUNT_TYPE.REVENUE, kind: 'posting', parent: '4000' },

  // ─── 5) المصروفات والتكاليف ──────────────────────────────────
  { code: '5000', name: 'المصروفات والتكاليف', type: ACCOUNT_TYPE.EXPENSE, kind: 'group', parent: null },
  { code: '5050', name: 'تكلفة الخدمات المقدمة (مدفوعات التنفيذ)', type: ACCOUNT_TYPE.EXPENSE, kind: 'posting', parent: '5000' },
  { code: '5100', name: 'مصروف الرواتب والبدلات', type: ACCOUNT_TYPE.EXPENSE, kind: 'posting', parent: '5000' },
  { code: '5110', name: 'مصروف التأمينات الاجتماعية (حصة الشركة)', type: ACCOUNT_TYPE.EXPENSE, kind: 'posting', parent: '5000' },
  { code: '5200', name: 'مصروف الإيجار', type: ACCOUNT_TYPE.EXPENSE, kind: 'posting', parent: '5000' },
  { code: '5300', name: 'المصروفات التسويقية', type: ACCOUNT_TYPE.EXPENSE, kind: 'posting', parent: '5000' },
  { code: '5400', name: 'البرمجيات والاستضافة', type: ACCOUNT_TYPE.EXPENSE, kind: 'posting', parent: '5000' },
  { code: '5500', name: 'الخدمات والمرافق', type: ACCOUNT_TYPE.EXPENSE, kind: 'posting', parent: '5000' },
  { code: '5600', name: 'مصروفات عمومية وأخرى', type: ACCOUNT_TYPE.EXPENSE, kind: 'posting', parent: '5000' },
];

/** ربط فئات المصروفات في النظام القديم بحسابات الشجرة الجديدة (خطة الترحيل) */
export const LEGACY_EXPENSE_CATEGORY_MAP = {
  operating: '5600',
  marketing: '5300',
  software: '5400',
  hosting: '5400',
  salaries: '5100',       // تنبيه: يجب إعادة تصنيف ما كان "رواتب" هنا إلى مسير الرواتب لمنع الازدواج
  task_payments: '5050',  // تكلفة خدمات مباشرة (تعويضات تنفيذ المهام)
  utilities: '5500',
  rent: '5200',
  other: '5600',
};

/** تحقق: هل الرمز بصيغة حساب فرعي تحليلي مثل 1120-C0001؟ */
export function isSubAccountCode(code) {
  return /^\d{4}-[A-Z]\d{3,6}$/.test(code);
}

/** استخراج رمز الحساب الرقابي الأب من رمز فرعي */
export function parentControlOf(subCode) {
  return subCode.split('-')[0];
}

/**
 * تصنيف الحساب لأغراض قائمة التدفقات النقدية (الطريقة المباشرة المبسطة):
 * يُحدَّد النشاط من طبيعة الحساب المقابل للحركة النقدية.
 */
export function cashFlowActivityOf(counterType, counterCode) {
  if (counterCode === '3100' || counterCode === '3300') return 'financing';
  if (counterCode === '2210') return 'financing';
  if (counterCode.startsWith('12') && counterCode.startsWith('1200') === false) {
    // 1210/1220/1230 أصول ثابتة — لكنها ليست حركة نقد مباشرة غالباً؛ نُبقيها استثمارية عند الشراء النقدي
  }
  if (['1210', '1220'].includes(counterCode)) return 'investing';
  if (counterType === ACCOUNT_TYPE.REVENUE) return 'operating';
  if (counterType === ACCOUNT_TYPE.EXPENSE) return 'operating';
  if (counterCode === '1120' || isSubAccountCode(counterCode) && counterCode.startsWith('1120')) return 'operating';
  if (counterCode === '2110' || counterCode.startsWith('2110')) return 'operating';
  if (counterCode === '2150' || counterCode.startsWith('1160')) return 'operating';
  if (counterCode === '2120' || counterCode.startsWith('2120') || counterCode.startsWith('1140')) return 'operating';
  return 'operating';
}
