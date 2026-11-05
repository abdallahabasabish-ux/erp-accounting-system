/**
 * أدوات التواريخ والفترات المالية.
 * كل التواريخ داخل النظام بصيغة ISO 'YYYY-MM-DD' (تاريخ ترحيل محاسبي بلا وقت)
 * + حقول ختم زمني منفصلة (createdAt) بـ ISO كامل.
 * مفتاح الفترة يُشتق من نص التاريخ نفسه وليس من UTC — تفادياً لانزياح اليوم
 * (خطأ موثق في النظام القديم: toISOString().slice(0,10)).
 */

/** اليوم الحالي كنص ISO حسب منطقة زمنية محددة */
export function todayISO(timezone = 'Africa/Cairo') {
  // 'en-CA' ينتج YYYY-MM-DD مباشرة
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

/** الطابع الزمني الكامل الآن */
export function nowISO() {
  return new Date().toISOString();
}

/** التحقق من صيغة تاريخ ISO صالح */
export function isValidISODate(text) {
  if (typeof text !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const d = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return false;
  // إعادة التركيب لضمان صحة اليوم/الشهر (يرفض مثل 2026-02-30)
  return d.toISOString().slice(0, 10) === text;
}

/**
 * مفتاح الفترة المالية الشهرية للتاريخ: 'YYYY-MM'
 * الفترة المالية شهرية (يناير-ديسمبر) — قابلة للتوسعة لسنة مالية تبدأ بأي شهر.
 */
export function periodKeyOf(isoDate) {
  if (!isValidISODate(isoDate)) throw new TypeError(`تاريخ غير صالح: ${isoDate}`);
  return isoDate.slice(0, 7);
}

/** بداية ونهاية الشهر (فترة) كتاريخين شاملين */
export function periodBounds(periodKey) {
  if (!/^\d{4}-\d{2}$/.test(periodKey)) throw new TypeError(`مفتاح فترة غير صالح: ${periodKey}`);
  const [y, m] = periodKey.split('-').map(Number);
  const start = `${periodKey}-01`;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const end = `${periodKey}-${String(lastDay).padStart(2, '0')}`;
  return { start, end };
}

/** مقارنة نصيّة آمنة لتاريخين ISO */
export function compareDates(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** هل التاريخ داخل [من، إلى] شاملة الطرفين */
export function inRange(isoDate, from, to) {
  if (from && compareDates(isoDate, from) < 0) return false;
  if (to && compareDates(isoDate, to) > 0) return false;
  return true;
}

/**
 * دلو عمر الدين (Aging bucket) بالنسبة لتاريخ مرجعي:
 * current (لم تستحق) | d1_30 | d31_60 | d61_90 | d90_plus
 */
export function agingBucket(dueDateISO, asOfISO) {
  const due = new Date(`${dueDateISO}T00:00:00Z`).getTime();
  const asOf = new Date(`${asOfISO}T00:00:00Z`).getTime();
  const days = Math.floor((asOf - due) / 86400000); // سالب = لم تستحق بعد
  if (days <= 0) return 'current';
  if (days <= 30) return 'd1_30';
  if (days <= 60) return 'd31_60';
  if (days <= 90) return 'd61_90';
  return 'd90_plus';
}

/** إضافة أيام لتاريخ ISO */
export function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** أرقام الأشهر بين مفتاحين (شامل) — لأغراض تقارير الفترات */
export function monthsBetween(fromKey, toKey) {
  const out = [];
  let [y, m] = fromKey.split('-').map(Number);
  const [ty, tm] = toKey.split('-').map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
    if (out.length > 240) throw new Error('مدى فترات غير منطقي (> 20 سنة)');
  }
  return out;
}
