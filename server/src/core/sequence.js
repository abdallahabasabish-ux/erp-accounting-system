/**
 * التسلسل الرقمي الذري على الخادم (Server-Side Atomic Sequences).
 *
 * المشكلة التي يحلها (موثقة في تحليل النظام القديم): ترقيم الفواتير كان
 * `invoices.length + 1` من المتصفح — متصفحان متزامنان يولّدان نفس الرقم،
 * والمصفوفة المحمّلة قد تكون مفلترة أصلاً. 
 *
 * الحل: مجموعة عدادات `counters/{name}` تُحدَّث داخل نفس معاملة الترحيل —
 * قراءة → زيادة → كتابة في حدود المعاملة تعني أن طلبين متزامنين يحصلان
 * على رقمين مختلفين دائماً (Firestore يضمن عزل المعاملة).
 *
 * الترقيم سنوي متصل (gapless لكل سنة) لأغراض التدقيق والضريبة:
 *   INV-2026-000123 / JE-2026-000456 / REC-2026-000789 / PR-2026-11
 */

export const SEQUENCE_PREFIX = {
  invoice: 'INV',
  journal: 'JE',
  receipt: 'REC',
  payment: 'PAY',
  expense: 'EXP',
  payrollRun: 'PR',
  advance: 'ADV',
  voucher: 'VCH',
  treasury: 'TRS',  // عدّاد ترتيب الخزائن النقدية
  bank: 'BNK',      // عدّاد ترتيب الحسابات البنكية
};

/** بناء اسم العداد السنوي */
function counterName(kind, isoDate) {
  const year = isoDate.slice(0, 4);
  return `${kind}-${year}`;
}

/**
 * حجز الرقم التالي داخل معاملة قائمة.
 * @param {object} tx معاملة قائمة (tx.get/set)
 * @param {object} store المتجر (لإنشاء المراجع)
 * @param {string} kind نوع التسلسل (invoice/journal/receipt/...)
 * @param {string} isoDate تاريخ العملية (يحدد السنة)
 * @returns {Promise<{number: string, seq: number, docId: string}>}
 */
export async function allocateNumber(tx, store, kind, isoDate) {
  const prefix = SEQUENCE_PREFIX[kind];
  if (!prefix) throw new Error(`نوع تسلسل غير معروف: ${kind}`);
  const name = counterName(kind, isoDate);
  const counterRef = store.ref('counters', name);
  const snap = await tx.get(counterRef);
  const seq = (snap.exists ? (snap.data.value || 0) : 0) + 1;
  if (snap.exists) {
    tx.update(counterRef, { value: seq, updatedAt: new Date().toISOString() });
  } else {
    tx.set(counterRef, { name, value: seq, kind, year: isoDate.slice(0, 4), updatedAt: new Date().toISOString() });
  }
  const number = `${prefix}-${isoDate.slice(0, 4)}-${String(seq).padStart(6, '0')}`;
  // معرف الوثيقة = الرقم نفسه → تفرد طبيعي + فهرسة بديهية + منع التكرار على مستوى المفتاح
  return { number, seq, docId: number };
}

/** رقم مسير رواتب شهري (لا سنوي): PR-2026-11 */
export async function allocatePayrollNumber(tx, store, periodKey) {
  const counterRef = store.ref('counters', `payroll-${periodKey}`);
  const snap = await tx.get(counterRef);
  if (snap.exists) {
    throw Object.assign(new Error(`يوجد مسير رواتب بالفعل للفترة ${periodKey}`), { code: 'PAYROLL_EXISTS' });
  }
  tx.set(counterRef, { name: `payroll-${periodKey}`, value: 1, updatedAt: new Date().toISOString() });
  return `PR-${periodKey}`;
}

/**
 * حجز رمز كياني متسلسل (عميل C0001 / موظف E0001 / مورد S0001) — داخل معاملة قائمة.
 * ليس ترقيماً مالياً بل مفتاح قراءة-سهل للبشر، وبهيكل مستقر للحسابات الفرعية.
 */
export async function allocateEntityCode(tx, store, kind, prefix, pad = 4) {
  const counterRef = store.ref('counters', `entity-${kind}`);
  const snap = await tx.get(counterRef);
  const seq = (snap.exists ? (snap.data.value || 0) : 0) + 1;
  if (snap.exists) {
    tx.update(counterRef, { value: seq, updatedAt: new Date().toISOString() });
  } else {
    tx.set(counterRef, { name: `entity-${kind}`, value: seq, updatedAt: new Date().toISOString() });
  }
  return `${prefix}${String(seq).padStart(pad, '0')}`;
}
