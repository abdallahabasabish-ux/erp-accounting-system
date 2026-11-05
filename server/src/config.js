/**
 * مركز الإعدادات — يُقرأ من متغيرات البيئة مرة واحدة عند الإقلاع.
 * قاعدة ذهبية: كل المبالغ تُخزَّن بالقروش (أعداد صحيحة)، والـ EGP يظهر فقط في واجهات الإدخال/العرض.
 */
import 'dotenv/config';

const env = process.env;

/** هل توجد بيانات حساب خدمة Firebase؟ */
function hasServiceAccount() {
  return Boolean(
    env.FIREBASE_SERVICE_ACCOUNT_PATH ||
    env.FIREBASE_SERVICE_ACCOUNT_JSON ||
    env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64
  );
}

export const config = {
  /** منفذ الاستماع */
  port: Number(env.PORT || 4000),

  /**
   * وضع التشغيل:
   * - 'production': Firestore حقيقي عبر Admin SDK
   * - 'demo': قاعدة بيانات في الذاكرة مع بذور تجريبية (لا تُستخدم أبداً في الإنتاج)
   */
  mode: (env.MODE || (hasServiceAccount() ? 'production' : 'demo')).toLowerCase(),

  /** المشروع على Firebase */
  firebase: {
    serviceAccountPath: env.FIREBASE_SERVICE_ACCOUNT_PATH || '',
    serviceAccountJson: env.FIREBASE_SERVICE_ACCOUNT_JSON || '',
    serviceAccountJsonBase64: env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64 || '',
    projectId: env.FIREBASE_PROJECT_ID || '',
    /**
     * بادئة مجموعات النظام الجديد داخل Firestore — تُستخدم عند المشاركة بين
     * النظام القديم والجديد في نفس المشروع (مثال: 'erp_' تجعل المجموعات erp_accounts...)
     * يُنصح بمشروع Firebase منفصل، والبادئة خيار احتياطي آمن.
     */
    collectionPrefix: env.FIRESTORE_COLLECTION_PREFIX || '',
  },

  /** ثوابت مالية — العملة الأساسية: الجنيه المصري بوحدة القرش (1 EGP = 100 قرش) */
  finance: {
    currency: 'EGP',
    minorUnit: 100,
    currencySymbol: 'ج.م',
    defaultVatRate: Number(env.DEFAULT_VAT_RATE ?? 14),           // نسبة ضريبة القيمة المضافة الافتراضية
    defaultCreditDays: Number(env.DEFAULT_CREDIT_DAYS ?? 30),    // فترة السداد الافتراضية (Net 30)
    defaultAdvanceCapPercent: Number(env.DEFAULT_ADVANCE_CAP_PERCENT ?? 50), // سقف السلفة من الراتب الأساسي
    timezone: env.TIMEZONE || 'Africa/Cairo',
  },

  /** المستخدمون التجريبيون (وضع demo فقط) */
  demo: {
    password: env.DEMO_PASSWORD || 'demo1234',
    secret: env.DEMO_SECRET || 'demo-secret',
  },

  /** سماحيات CORS للوحة التحكم */
  corsOrigins: (env.CORS_ORIGINS || '*').split(',').map((s) => s.trim()),
};

/** تحقق صارم من الإعدادات في وضع الإنتاج */
export function assertProductionConfig() {
  if (config.mode === 'production' && !config.firebase.projectId) {
    throw new Error('FIREBASE_PROJECT_ID مطلوب في وضع production');
  }
}
