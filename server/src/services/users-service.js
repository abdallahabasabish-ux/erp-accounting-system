/**
 * موديول إدارة المستخدمين — إنشاء الأدوار وتعديل الصلاحيات والتعطيل الفوري.
 * إدارة المستخدمين متاحة لدور admin فقط.
 */
import { createHash } from 'node:crypto';
import { nowISO } from '../lib/dates.js';
import { errors } from '../lib/errors.js';
import { ROLES, PERMISSIONS, DEFAULT_ROLE_PERMISSIONS, publicUser } from './auth-service.js';
import { writeAuditTx } from './audit-service.js';
import { config } from '../config.js';

/** قائمة المستخدمين */
export async function listUsers(store) {
  const rows = await store.read('users', { orderBy: ['createdAt', 'asc'], limit: 500 });
  return rows.map(publicUser);
}

/** إنشاء مستخدم (demo: بكلمة مرور — production: يُنشأ من Firebase Auth ثم يُهيأ هنا) */
export async function createUser(store, actor, input) {
  const email = String(input.email || '').toLowerCase().trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw errors.badRequest('بريد إلكتروني غير صالح');
  if (!Object.values(ROLES).includes(input.role)) throw errors.badRequest(`الدور غير صالح — الأدوار: ${Object.values(ROLES).join(', ')}`);
  let permissions = null;
  if (Array.isArray(input.permissions) && input.permissions.length) {
    const invalid = input.permissions.filter((p) => !PERMISSIONS.includes(p) && p !== '*');
    if (invalid.length) throw errors.badRequest(`صلاحيات غير معروفة: ${invalid.join(', ')}`);
    permissions = input.permissions;
  }

  return store.runTransaction(async (tx) => {
    const existing = await store.read('users', { where: [['email', '==', email]], limit: 1 });
    if (existing.length) throw errors.conflict('EMAIL_TAKEN', 'البريد مستخدم بالفعل');
    const id = input.uid || store.newId();
    const user = {
      id, email, displayName: input.displayName || email.split('@')[0],
      role: input.role, permissions,
      disabled: false,
      employeeId: input.employeeId || null,
      customerId: input.customerId || null,
      // hash كلمة المرور في وضع demo فقط — الإنتاج يعتمد Firebase Auth
      passwordHash: config.mode === 'demo' ? createHash('sha256').update(input.password || 'demo1234').digest('hex') : null,
      createdAt: nowISO(), updatedAt: nowISO(),
      createdBy: actor.email,
    };
    tx.set(store.ref('users', id), user);
    await writeAuditTx(tx, store, {
      actor, action: 'user.create', entity: 'users', entityId: id,
      summary: `إنشاء مستخدم ${email} بدور ${input.role}`,
    });
    return publicUser(user);
  });
}

/** تحديث دور/صلاحيات/اسم مستخدم */
export async function updateUser(store, actor, userId, patch) {
  return store.runTransaction(async (tx) => {
    const ref = store.ref('users', userId);
    const snap = await tx.get(ref);
    if (!snap.exists) throw errors.notFound('المستخدم');
    const next = { updatedAt: nowISO(), updatedBy: actor.email };
    if (patch.displayName !== undefined) next.displayName = String(patch.displayName).trim();
    if (patch.role !== undefined) {
      if (!Object.values(ROLES).includes(patch.role)) throw errors.badRequest('دور غير صالح');
      next.role = patch.role;
    }
    if (patch.permissions !== undefined) {
      if (!Array.isArray(patch.permissions)) throw errors.badRequest('الصلاحيات مصفوفة');
      const invalid = patch.permissions.filter((p) => !PERMISSIONS.includes(p) && p !== '*');
      if (invalid.length) throw errors.badRequest(`صلاحيات غير معروفة: ${invalid.join(', ')}`);
      next.permissions = patch.permissions;
    }
    if (patch.employeeId !== undefined) next.employeeId = patch.employeeId;
    if (patch.customerId !== undefined) next.customerId = patch.customerId;
    tx.update(ref, next);
    await writeAuditTx(tx, store, {
      actor, action: 'user.update', entity: 'users', entityId: userId,
      summary: `تحديث مستخدم ${snap.data.email}`,
      before: { role: snap.data.role, disabled: snap.data.disabled },
      after: { role: next.role ?? snap.data.role, disabled: snap.data.disabled },
    });
    return { ...snap.data, ...next };
  });
}

/** تعطيل/تفعيل مستخدم — يسري فوراً في الطلب التالي (فحص disabled في كل طلب) */
export async function setUserDisabled(store, actor, userId, disabled, reason) {
  if (disabled && (!reason || String(reason).trim().length < 5)) {
    throw errors.badRequest('سبب التعطيل إلزامي ويُوثَّق في التدقيق');
  }
  return store.runTransaction(async (tx) => {
    const ref = store.ref('users', userId);
    const snap = await tx.get(ref);
    if (!snap.exists) throw errors.notFound('المستخدم');
    if (snap.data.id === actor.uid) throw errors.badRequest('لا يمكنك تعطيل حسابك بنفسك');
    tx.update(ref, { disabled: Boolean(disabled), disabledReason: disabled ? String(reason).trim() : null, updatedAt: nowISO() });
    await writeAuditTx(tx, store, {
      actor, action: disabled ? 'user.disable' : 'user.enable', entity: 'users', entityId: userId,
      summary: `${disabled ? 'تعطيل' : 'تفعيل'} المستخدم ${snap.data.email}`,
      reason: disabled ? String(reason).trim() : null,
    });
    return { ...snap.data, disabled: Boolean(disabled) };
  });
}

/** كتالوج الأدوار والصلاحيات (للواجهة) */
export function rbacCatalog() {
  return {
    roles: Object.values(ROLES),
    permissions: PERMISSIONS,
    defaults: DEFAULT_ROLE_PERMISSIONS,
  };
}
