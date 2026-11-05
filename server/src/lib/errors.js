/**
 * أخطاء الأعمال المهيكلة — كل خطأ له كود ثابت يفهمه الواجهة ويعرضه كرسالة عربية واضحة.
 * هذا يمنع الواجهات من "تخمين" سبب الرفض ويوحّد التعامل مع الأخطاء في كل الطبقات.
 */
export class ApiError extends Error {
  /**
   * @param {number} status رمز HTTP
   * @param {string} code كود ثابت قابل للبرمجة (BALANCE_INSUFFICIENT ...)
   * @param {string} message رسالة عربية موجّهة للمستخدم
   * @param {object} [details] تفاصيل إضافية (مثال: أرقام الأطراف غير المتوازنة)
   */
  constructor(status, code, message, details = undefined) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const errors = {
  badRequest: (msg, details) => new ApiError(400, 'BAD_REQUEST', msg, details),
  unauthenticated: (msg = 'يجب تسجيل الدخول أولاً') => new ApiError(401, 'UNAUTHENTICATED', msg),
  forbidden: (msg = 'لا تملك صلاحية تنفيذ هذه العملية') => new ApiError(403, 'FORBIDDEN', msg),
  notFound: (what = 'السجل') => new ApiError(404, 'NOT_FOUND', `${what} غير موجود`),
  conflict: (code, msg, details) => new ApiError(409, code, msg, details),

  /** أخطاء قواعد محاسبية — كلها 422 (Unprocessable) لأن الطلب مفهوم لكنه يخالف قاعدة أعمال */
  unbalanced: (d, c) =>
    new ApiError(422, 'UNBALANCED_ENTRY', `القيد غير متوازن: إجمالي المدين ${d} لا يساوي إجمالي الدائن ${c} (بالقروش)`, { debit: d, credit: c }),
  periodLocked: (periodKey) =>
    new ApiError(422, 'PERIOD_LOCKED', `الفترة المالية ${periodKey} مغلقة — لا يمكن ترحيل قيود بتاريخ يقع داخلها`, { periodKey }),
  insufficientFunds: (name, available, requested) =>
    new ApiError(422, 'INSUFFICIENT_FUNDS', `رصيد «${name}» غير كافٍ: المتاح ${(available / 100).toFixed(2)} ج.م والمطلوب ${(requested / 100).toFixed(2)} ج.م`, { available, requested }),
  creditLimitExceeded: (name, limit, wouldBe) =>
    new ApiError(422, 'CREDIT_LIMIT_EXCEEDED', `تجاوز الحد الائتماني للعميل «${name}» — سيصبح المستحق ${(wouldBe / 100).toFixed(2)} ج.م والحد ${(limit / 100).toFixed(2)} ج.م`, { limit, wouldBe }),
  invalidAccount: (code, why) =>
    new ApiError(422, 'INVALID_ACCOUNT', `الحساب ${code} غير صالح للترحيل: ${why}`, { code }),
  staleDocument: (msg = 'تم تعديل السجل من مستخدم آخر أثناء عملك — أعد تحميل الصفحة وأعد المحاولة') =>
    new ApiError(409, 'STALE_DOCUMENT', msg),
};
