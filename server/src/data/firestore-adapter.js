/**
 * مهايئ Firestore — نفس واجهة مهايئ الذاكرة تماماً، لكن فوق Firebase Admin SDK.
 *
 * قرارات تصميمية مهمة:
 * 1) كل المعاملات المالية تمر عبر runTransaction — Firestore يضمن الذرية والتراجع
 *    التلقائي عند أي استثناء داخل الدالة.
 * 2) Firestore لا يدعم الاستعلامات داخل المعاملة — لذلك كل التحقق "هل سبق عكس هذا القيد؟"
 *    أو "هل استُخدم مفتاح التكرار؟" يتم عبر وثائق فهرس رفيعة
 *    (reversalIndex/{entryId}، idempotencyIndex/{key}) تُقرأ بـ tx.get داخل المعاملة
 *    — نمط آمن ضد سباق الاستدعاءات المتزامنة.
 * 3) لا يُسمح للعميل بالوصول إلى Firestore مباشرة في النموذج الجديد؛ كل الوصول
 *    من الخادم بصلاحيات Admin — وقواعد الأمان الجديدة ترفض كل وصول عميل للمجموعات المالية.
 */
import { initializeApp, applicationDefault, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { createRequire } from 'node:module';
import { config } from '../config.js';

const require = createRequire(import.meta.url);

function buildCredentials() {
  const { serviceAccountPath, serviceAccountJson, serviceAccountJsonBase64 } = config.firebase;
  if (serviceAccountPath) return cert(require(serviceAccountPath));
  if (serviceAccountJson) return cert(JSON.parse(serviceAccountJson));
  if (serviceAccountJsonBase64) {
    return cert(JSON.parse(Buffer.from(serviceAccountJsonBase64, 'base64').toString('utf8')));
  }
  return applicationDefault();
}

export class FirestoreStore {
  constructor() {
    const app = initializeApp({
      credential: buildCredentials(),
      projectId: config.firebase.projectId || undefined,
    }, `erp-${Date.now()}`);
    /** @type {import('firebase-admin/firestore').Firestore} */
    this.db = getFirestore(app);
    this.db.settings({ ignoreUndefinedProperties: true });
    this.mode = 'production';
    // بادئة المجموعات لفصل بيانات ERP عن أي بيانات قديمة في نفس المشروع
    this.prefix = config.firebase.collectionPrefix || '';
  }

  /** اسم المجموعة الفعلي مع البادئة */
  collName(name) {
    return `${this.prefix}${name}`;
  }

  ref(collection, id) {
    return { collection: this.collName(collection), id, _fs: this.db.collection(this.collName(collection)).doc(id) };
  }

  newId() {
    return this.db.collection('_ids').doc().id;
  }

  async get(refObj) {
    const snap = await refObj._fs.get();
    return snap.exists
      ? { exists: true, id: snap.id, ref: refObj, data: snap.data() }
      : { exists: false, id: refObj.id, ref: refObj, data: null };
  }

  async read(collection, opts = {}) {
    let q = this.db.collection(this.collName(collection));
    for (const [field, op, value] of opts.where || []) {
      q = q.where(field, op, value);
    }
    if (opts.orderBy) {
      const [field, dir = 'asc'] = opts.orderBy;
      q = q.orderBy(field, dir);
    }
    if (opts.limit) q = q.limit(opts.limit);
    const snap = await q.get();
    return snap.docs.map((d) => ({ id: d.id, ref: this.ref(collection, d.id), ...d.data() }));
  }

  /**
   * معاملة ذرية: fn تستقبل tx بواجهة مطابقة لمهايئ الذاكرة،
   * وأي استثناء داخلها يُلغي كل الكتابات (Rollback كامل).
   */
  async runTransaction(fn) {
    return this.db.runTransaction(async (t) => {
      const realTx = {
        async get(refObj) {
          const snap = await t.get(refObj._fs);
          return snap.exists
            ? { exists: true, id: snap.id, ref: refObj, data: snap.data() }
            : { exists: false, id: refObj.id, ref: refObj, data: null };
        },
        create(refObj, data) { t.create(refObj._fs, data); return refObj; },
        set(refObj, data) { t.set(refObj._fs, data); return refObj; },
        update(refObj, partial) { t.update(refObj._fs, partial); return refObj; },
        delete(refObj) { t.delete(refObj._fs); return refObj; },
      };
      return fn(realTx);
    });
  }
}

/** إنشاء متجر Firestore */
export function createFirestoreStore() {
  return new FirestoreStore();
}
