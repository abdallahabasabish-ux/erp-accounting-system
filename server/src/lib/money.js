/**
 * وحدة النقود — قلب دقة الحسابات المالية.
 *
 * القواعد غير القابلة للتفاوض:
 * 1) كل المبالغ المخزنة والمُرحَّلة هي أعداد صحيحة بالقروش (1 ج.م = 100 قرش).
 * 2) لا يمر أي مبلغ عبر float في منطق التخزين: التحويل من النص العشري يتم بتحليل
 *    الخانات مباشرة، والتوزيع النسبي يتم بخوارزمية "أكبر باقٍ" (Largest Remainder)
 *    حتى تبقى مجموع القطع مساوياً للمبلغ الأصلي بضعة قروش.
 * 3) التقريب الوحيد المسموح: نحو الأعلى للنصف (Half-Up) على أعداد صحيحة —
 *    يُستخدم في حساب ضريبة القيمة المضافة فقط.
 *
 * أقصى قيمة آمنة: حدود Number الصحيحة ≈ 9.0e15 قرش = 90 تريليون ج.م —
 * وهو أعلى بكثير من أي حجم أعمال واقعي، لذا لا خطر تجاوز الدقة.
 */

const MAX_SAFE_PIASTERS = 9_000_000_000_000_000; // حد أمان متعمد أدنى من الحد الأقصى للأعداد الصحيحة الآمنة

/**
 * تحويل قيمة EGP (نص عشري أو رقم) إلى قروش.
 * يقبل: "1250.75" و 1250.75 و "1,250.75" و "1250" — ويرفض أي خانة عشرية ثالثة.
 * @param {string|number} input
 * @returns {number} قروش (عدد صحيح)
 */
export function toPiasters(input) {
  if (input === null || input === undefined || input === '') {
    throw Object.assign(new TypeError('المبلغ فارغ'), { code: 'MONEY_EMPTY' });
  }
  let text = String(input).trim().replace(/[,\s_]/g, '');
  // تحويل الأرقام العربية إلى لاتينية
  text = text.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
  // إزالة رموز العملة والرموز غير الرقمية (نحفظ النقطة والسالب)
  text = text.replace(/[^\d.\-]/g, '');
  const negative = text.startsWith('-');
  text = text.replace(/^-/, '');
  // بعد التنظيف: يجب أن يتبقى رقم واحد على الأقل
  if (!/\d/.test(text)) {
    throw Object.assign(new TypeError(`صيغة مبلغ غير صالحة: ${input}`), { code: 'MONEY_FORMAT' });
  }
  const parts = text.split('.');
  if (parts.length > 2) throw Object.assign(new TypeError(`صيغة مبلغ غير صالحة: ${input}`), { code: 'MONEY_FORMAT' });
  const [intPart = '0', fracPart = ''] = parts;
  if (!/^\d*$/.test(intPart) || !/^\d*$/.test(fracPart)) {
    throw Object.assign(new TypeError(`صيغة مبلغ غير صالحة: ${input}`), { code: 'MONEY_FORMAT' });
  }
  if (fracPart.length > 2) {
    throw Object.assign(new TypeError(`لا يمكن أن يتجاوز المبلغ خانتين عشريتين (قروش): ${input}`), { code: 'MONEY_PRECISION' });
  }
  const frac = (fracPart + '00').slice(0, 2);
  const piasters = Number(intPart || '0') * 100 + Number(frac || '0');
  const signed = negative ? -piasters : piasters;
  assertSafeInt(signed);
  return signed;
}

/** تحويل قروش إلى نص عشري EGP (للعرض والإرجاع عبر الـ API) */
export function toEGP(piasters) {
  assertSafeInt(piasters);
  const sign = piasters < 0 ? '-' : '';
  const abs = Math.abs(Math.trunc(piasters));
  const egp = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, '0');
  return `${sign}${egp}.${frac}`;
}

/** تنسيق عرض: "1,250.75 ج.م" */
export function formatEGP(piasters) {
  const decimal = toEGP(piasters);
  const [intPart, fracPart] = decimal.split('.');
  const neg = intPart.startsWith('-');
  const digits = neg ? intPart.slice(1) : intPart;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${neg ? '-' : ''}${grouped}.${fracPart} ج.م`;
}

/** ضمان أن القيمة عدد صحيح آمن (تُستخدم قبل أي تخزين أو ترحيل) */
export function assertSafeInt(n, label = 'المبلغ') {
  if (!Number.isInteger(n)) {
    throw Object.assign(new TypeError(`${label} ليس عدداً صحيحاً بالقروش: ${n}`), { code: 'MONEY_NOT_INTEGER' });
  }
  if (Math.abs(n) > MAX_SAFE_PIASTERS) {
    throw Object.assign(new RangeError(`${label} يتجاوز الحد الآمن للحساب`), { code: 'MONEY_TOO_LARGE' });
  }
  return n;
}

/**
 * ضريبة القيمة المضافة بتقريب نصف-لأعلى بحساب صحيح خالص:
 * vat = floor(taxable*rate + 50) / 100 — بدون أي float في المعادلة.
 * @param {number} taxablePiasters وعاء الضريبة بالقروش
 * @param {number} ratePercent نسبة مئوية (مثال 14)
 */
export function computeVat(taxablePiasters, ratePercent) {
  assertSafeInt(taxablePiasters, 'الوعاء الضريبي');
  if (taxablePiasters < 0) throw new RangeError('الوعاء الضريبي لا يجوز أن يكون سالباً');
  if (!(ratePercent >= 0 && ratePercent <= 100)) throw new RangeError('نسبة الضريبة يجب أن تكون بين 0 و 100');
  const numerator = taxablePiasters * ratePercent; // عدد صحيح
  const vat = Math.floor((numerator + 50) / 100);
  return { vat, total: taxablePiasters + vat };
}

/**
 * توزيع مبلغ على نسب — بخوارزمية «أكبر باقٍ» بحيث مجموع النواتج = المبلغ تماماً.
 * مثال: توزيع خصم على بنود الفاتورة دون فقدان قرش واحد.
 * @param {number} total إجمالي بالقروش
 * @param {number[]} ratios نسب (قد لا يكون مجموعها 1 — تُطبَّع داخلياً)
 * @returns {number[]} قطع بالقروش مجموعها = total
 */
export function distribute(total, ratios) {
  assertSafeInt(total, 'إجمالي التوزيع');
  if (ratios.length === 0) throw new RangeError('لا توجد نسب للتوزيع');
  const sum = ratios.reduce((a, b) => a + b, 0);
  if (sum <= 0) throw new RangeError('مجموع النسب يجب أن يكون موجباً');
  // نستخدم تقريبRound على حاصل ضرب صحيح لتقليل انحراف float إلى أقصى حد،
  // ثم نصحح الباقي بالقروش (± عدد قروش صغير) على أكبر القطع.
  const scaled = ratios.map((r) => Math.round((total * r) / sum));
  let remainder = total - scaled.reduce((a, b) => a + b, 0);
  const order = scaled.map((v, i) => ({ i, v })).sort((a, b) => b.v - a.v);
  let idx = 0;
  const step = remainder > 0 ? 1 : -1;
  while (remainder !== 0) {
    scaled[order[idx % order.length].i] += step;
    remainder -= step;
    idx += 1;
    if (idx > ratios.length * 2 + Math.abs(remainder) + 10) throw new Error('فشل توزيع المبلغ');
  }
  const assigned = scaled.reduce((a, b) => a + b, 0);
  if (assigned !== total) throw new Error(`فشل توزيع المبلغ: ${assigned} ≠ ${total}`);
  return scaled;
}

/** التحقق من أن المبلغ موجب تماماً */
export function assertPositive(piasters, label = 'المبلغ') {
  assertSafeInt(piasters, label);
  if (piasters <= 0) throw Object.assign(new RangeError(`${label} يجب أن يكون أكبر من صفر`), { code: 'MONEY_NOT_POSITIVE' });
  return piasters;
}

/** التحقق من أن المبلغ غير سالب (الصفر مسموح — مثال: خصم) */
export function assertNonNegative(piasters, label = 'المبلغ') {
  assertSafeInt(piasters, label);
  if (piasters < 0) throw Object.assign(new RangeError(`${label} لا يجوز أن يكون سالباً`), { code: 'MONEY_NEGATIVE' });
  return piasters;
}
