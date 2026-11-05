/**
 * مهايئ الذاكرة (Memory Adapter) — تنفيذ كامل لواجهة المخزن داخل الذاكرة.
 *
 * لماذا وجوده؟
 * - تشغيل وضع التجربة (demo) بدون أي بيانات اعتماد Firebase.
 * - تشغيل اختبارات المحرك المحاسبي الكاملة في أجزاء من الثانية وبعزل تام.
 * - نفس دلالات المعاملات: تجميع كتابات داخل المعاملة، ظهورها للقراءات التالية
 *   داخل نفس المعاملة، وإلغاؤها كلها عند أي استثناء (Atomicity + Isolation).
 */

export class MemoryStore {
  constructor(prefix = '') {
    /** @type {Map<string, Map<string, object>>} المجموعات → المعرف → الوثيقة */
    this.collections = new Map();
    this.mode = 'demo';
    this.prefix = prefix || '';
    this._txSeq = 0;
  }

  /** اسم المجموعة الفعلي (مع بادئة الفصل عن بيانات النظام القديم إن وُجدت) */
  collName(name) {
    return `${this.prefix}${name}`;
  }

  _coll(name) {
    const key = this.collName(name);
    if (!this.collections.has(key)) this.collections.set(key, new Map());
    return this.collections.get(key);
  }

  /** إنشاء مرجع وثيقة */
  ref(collection, id) {
    return { collection, id };
  }

  /** توليد معرف عشوائي غير متوقع الترتيب (للسجلات غير المرقمة) */
  newId() {
    const rand = Math.random().toString(36).slice(2, 10);
    return `${Date.now().toString(36)}${rand}`;
  }

  /** قراءة خارج المعاملة */
  async get(refObj) {
    const doc = this._coll(refObj.collection).get(refObj.id);
    return doc ? { exists: true, id: refObj.id, ref: refObj, data: structuredClone(doc) } : { exists: false, id: refObj.id, ref: refObj, data: null };
  }

  /**
   * استعلام خارج المعاملة مع فلترة وترتيب بسيطة (تكفي كل استعلامات النظام).
   * ops المدعومة: ==, !=, >=, <=, >, <, in, array-contains, array-contains-any
   */
  async read(collection, opts = {}) {
    let rows = [...this._coll(collection).entries()].map(([id, data]) => ({ id, ref: this.ref(collection, id), ...structuredClone(data) }));
    for (const [field, op, value] of opts.where || []) {
      rows = rows.filter((r) => matchOp(getValuesAlongPath(r, field.split('.')), op, value));
    }
    if (opts.orderBy) {
      const [field, dir = 'asc'] = opts.orderBy;
      rows.sort((a, b) => {
        const av = getPath(a, field), bv = getPath(b, field);
        const cmp = av === bv ? 0 : av > bv ? 1 : -1;
        return dir === 'desc' ? -cmp : cmp;
      });
    }
    if (opts.limit) rows = rows.slice(0, opts.limit);
    return rows;
  }

  /**
   * تنفيذ معاملة ذرية: كل الكتابات تُطبَّق معاً أو تُلغى كلها.
   * داخل المعاملة تُرى الكتابات المُجرّبة عبر tx.get (Read-Your-Writes).
   */
  async runTransaction(fn) {
    const txSeq = ++this._txSeq;
    /** الكتابات المؤجلة داخل هذه المعاملة */
    const staged = new Map(); // "coll/id" → {op, data|null}

    const keyOf = (r) => `${r.collection}/${r.id}`;

    const tx = {
      async get(refObj) {
        const key = keyOf(refObj);
        if (staged.has(key)) {
          const s = staged.get(key);
          return s.op === 'delete'
            ? { exists: false, id: refObj.id, ref: refObj, data: null }
            : { exists: true, id: refObj.id, ref: refObj, data: structuredClone(s.data) };
        }
        const doc = this._collGet(refObj);
        return doc
          ? { exists: true, id: refObj.id, ref: refObj, data: structuredClone(doc) }
          : { exists: false, id: refObj.id, ref: refObj, data: null };
      },
      create(refObj, data) {
        const key = keyOf(refObj);
        if (staged.has(key) && staged.get(key).op !== 'delete') {
          throw new Error(`الوثيقة موجودة بالفعل: ${key}`);
        }
        staged.set(key, { op: 'set', data: { ...data, id: refObj.id } });
        return refObj;
      },
      set(refObj, data) {
        staged.set(keyOf(refObj), { op: 'set', data: { ...data, id: refObj.id } });
        return refObj;
      },
      update(refObj, partial) {
        const key = keyOf(refObj);
        const prev = staged.has(key)
          ? structuredClone(staged.get(key).data || {})
          : structuredClone(this._collGet(refObj) || {});
        if (!staged.has(key) && !this._collHas(refObj)) {
          throw new Error(`تحديث لوثيقة غير موجودة: ${key}`);
        }
        staged.set(key, { op: 'set', data: { ...prev, ...partial, id: refObj.id } });
        return refObj;
      },
      delete(refObj) {
        staged.set(keyOf(refObj), { op: 'delete', data: null });
        return refObj;
      },
      /** أدوات داخلية للـ tx (غير جزء من واجهة Firestore) */
      _collGet(refObj) { return this._collRaw(refObj.collection).get(refObj.id) || null; },
      _collHas(refObj) { return this._collRaw(refObj.collection).has(refObj.id); },
      _collRaw(name) { return MemoryStore.prototype._coll.call(this.__store, name); },
    };
    // ربط المرجع الداخلي بالمتجر
    tx.__store = this;

    try {
      const result = await fn(tx);
      // التثبيت: تطبيق كل الكتابات المرحّلة دفعة واحدة
      for (const [key, s] of staged) {
        const [coll, id] = key.split('/');
        const map = this._coll(coll);
        if (s.op === 'delete') map.delete(id);
        else map.set(id, structuredClone(s.data));
      }
      return result;
    } catch (err) {
      // لا شيء يُطبَّق — التراجع الكامل (Rollback) تلقائي لأن staging أُهمل
      throw err;
    }
  }

  /** تفريغ كامل (للاختبارات فقط) */
  _reset() {
    this.collections.clear();
  }

  /** إحصاءات سريعة (للرصد) */
  stats() {
    const out = {};
    for (const [name, map] of this.collections) out[name] = map.size;
    return out;
  }
}

function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o === undefined || o === null ? undefined : o[k]), obj);
}

/**
 * كل القيم المحتملة على طول مسار قد يعبر مصفوفات كائنات —
 * يحاكي دلالات Firestore لمسارات مثل 'lines.accountCode' مع array-contains.
 */
function getValuesAlongPath(obj, segments) {
  if (segments.length === 0) return [obj];
  if (obj === null || obj === undefined) return [];
  if (Array.isArray(obj)) {
    return obj.flatMap((item) => getValuesAlongPath(item, segments));
  }
  const [head, ...rest] = segments;
  return getValuesAlongPath(obj[head], rest);
}

function matchOp(actual, op, expected) {
  // actual = مصفوفة القيم المحتملة على طول المسار (مُسطَّحة بالفعل من getValuesAlongPath)
  const values = actual;
  const any = (fn) => values.some((v) => fn(v));
  switch (op) {
    case '==': return any((v) => v === expected);
    case '!=': return !matchOp(actual, '==', expected);
    case '>': return any((v) => v > expected);
    case '>=': return any((v) => v >= expected);
    case '<': return any((v) => v < expected);
    case '<=': return any((v) => v <= expected);
    case 'in': return Array.isArray(expected) && any((v) => expected.includes(v));
    case 'array-contains': return any((v) => v === expected);
    case 'array-contains-any': return Array.isArray(expected) && any((v) => expected.includes(v));
    default: throw new Error(`معامل فلترة غير مدعوم: ${op}`);
  }
}

/** إنشاء متجر ذاكرة جديد */
export function createMemoryStore(prefix = '') {
  return new MemoryStore(prefix);
}
