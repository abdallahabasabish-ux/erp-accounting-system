/**
 * سجل التدقيق الإلزامي من الخادم (Mandatory Server-Side Audit Trail).
 * الفرق الجوهري عن النظام القديم: التسجيل يحدث داخل نفس معاملة العملية المالية —
 * فلا يمكن أن تحدث عملية مالية دون أثر، ولا أن يُبتلع فشل التسجيل.
 */
import { nowISO } from '../lib/dates.js';

/** كتابة حدث تدقيق داخل معاملة قائمة (أو مستقلة عند تمرير store بدون tx) */
export async function writeAuditTx(tx, store, { actor, action, entity, entityId, summary, before = null, after = null, reason = null }) {
  const ref = store.ref('audit_logs', store.newId());
  const log = {
    at: nowISO(),
    actor: {
      uid: actor?.uid || null,
      email: actor?.email || null,
      name: actor?.name || null,
      role: actor?.role || null,
    },
    action,             // مثال: invoice.create, payment.approve, period.close
    entity,             // مثال: invoices
    entityId: entityId || null,
    summary,            // وصف عربي مختصر
    before,
    after,
    reason,
  };
  tx.set(ref, log);
  return log;
}

/** كتابة حدث تدقيق مستقل (عمليات خارج المعاملات — مثل تسجيل الدخول) */
export async function writeAudit(store, params) {
  return store.runTransaction((tx) => writeAuditTx(tx, store, params));
}

/** قائمة سجل التدقيق مع فلاتر */
export async function listAudit(store, { entity, entityId, actorUid, action, limit = 200 } = {}) {
  const where = [];
  if (entity) where.push(['entity', '==', entity]);
  if (entityId) where.push(['entityId', '==', entityId]);
  if (actorUid) where.push(['actor.uid', '==', actorUid]);
  if (action) where.push(['action', '==', action]);
  return store.read('audit_logs', {
    where: where.length ? where : undefined,
    orderBy: ['at', 'desc'],
    limit,
  });
}
