/**
 * خدمة المصادقة والصلاحيات (Authentication & Granular RBAC).
 *
 * الفلسفة الجديدة: الواجهة لا تقرر شيئاً — كل طلب API يحمل رمزاً يُفحص على الخادم،
 * والدور والصلاحيات مصدرهما وثيقة users/{uid} التي لا يعدّلها المستخدم نفسه إطلاقاً.
 * كما أن فحص disabled يحدث في *كل* طلب — تعطيل المستخدم يسري فوراً (خطأ موثق في النظام القديم).
 *
 * وضعان:
 * - production: رمز Firebase ID Token يُفحص بـ verifyIdToken (Admin SDK).
 * - demo: رموز موقعة داخلياً للمستخدمين التجريبيين.
 */
import { createHash, createHmac } from 'node:crypto';
import { config } from '../config.js';
import { nowISO } from '../lib/dates.js';
import { errors } from '../lib/errors.js';

export const ROLES = {
  ADMIN: 'admin',           // مدير النظام — كل الصلاحيات + إدارة المستخدمين
  MANAGER: 'manager',       // المدير — اعتماد، إغلاق فترات، تسويات
  ACCOUNTANT: 'accountant', // المحاسب — قيود، فواتير، سندات، تقارير
  EMPLOYEE: 'employee',     // الموظف — بياناته ومستحقاته فقط
  CLIENT: 'client',         // العميل — فواتيره وسداده فقط
};

/** كل الصلاحيات الممكنة (نقلت ووسّعت خريطة النظام القديم الـ 15) */
export const PERMISSIONS = [
  'dashboard:view',
  'accounts:view', 'accounts:manage',
  'journal:view', 'journal:create', 'journal:reverse',
  'customers:view', 'customers:manage',
  'invoices:view', 'invoices:create', 'invoices:cancel',
  'payments:view', 'payments:create', 'payments:approve',
  'treasury:view', 'treasury:manage',
  'expenses:view', 'expenses:create', 'expenses:approve',
  'employees:view', 'employees:manage',
  'payroll:view', 'payroll:run', 'payroll:approve',
  'periods:view', 'periods:close',
  'reports:view',
  'audit:view',
  'users:manage',
];

/** الافتراضي لكل دور — قابل للتخصيص لكل مستخدم عبر users.permissions */
export const DEFAULT_ROLE_PERMISSIONS = {
  admin: ['*'],
  manager: [
    'dashboard:view', 'accounts:view', 'accounts:manage',
    'journal:view', 'journal:create', 'journal:reverse',
    'customers:view', 'customers:manage',
    'invoices:view', 'invoices:create', 'invoices:cancel',
    'payments:view', 'payments:create', 'payments:approve',
    'treasury:view', 'treasury:manage',
    'expenses:view', 'expenses:create', 'expenses:approve',
    'employees:view', 'employees:manage',
    'payroll:view', 'payroll:run', 'payroll:approve',
    'periods:view', 'periods:close',
    'reports:view', 'audit:view',
  ],
  accountant: [
    'dashboard:view', 'accounts:view', 'accounts:manage',
    'journal:view', 'journal:create', 'journal:reverse',
    'customers:view', 'customers:manage',
    'invoices:view', 'invoices:create', 'invoices:cancel',
    'payments:view', 'payments:create',
    'treasury:view', 'treasury:manage',
    'expenses:view', 'expenses:create',
    'employees:view',
    'payroll:view', 'payroll:run',
    'periods:view',
    'reports:view',
  ],
  employee: [], // الموظف يستخدم مسارات /hr/me الخاصة به فقط
  client: [],   // العميل يستخدم مسارات /portal الخاصة به فقط
};

export function roleHasPermission(user, permission) {
  if (!user) return false;
  const perms = user.permissions || DEFAULT_ROLE_PERMISSIONS[user.role] || [];
  if (perms.includes('*')) return true;
  return perms.includes(permission);
}

/** تشفير كلمة مرور العرض التجريبي (demo فقط) */
function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

/** توقيع رمز تجريبي بسيط (HMAC) — demo فقط */
function signDemoToken(uid) {
  const payload = Buffer.from(JSON.stringify({ uid, iat: Date.now() })).toString('base64url');
  const sig = createHmac('sha256', config.demo.secret).update(payload).digest('base64url');
  return `demo.${payload}.${sig}`;
}

function parseDemoToken(token) {
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'demo') return null;
  const expect = createHmac('sha256', config.demo.secret).update(parts[1]).digest('base64url');
  if (expect !== parts[2]) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

/** دخول تجريبي (demo فقط): تحقق من البريد وكلمة المرور مقابل وثيقة المستخدم */
export async function demoLogin(store, { email, password }) {
  if (config.mode !== 'demo') throw errors.forbidden('الدخول المباشر متاح في وضع التجربة فقط — استخدم تسجيل دخول Firebase');
  const users = await store.read('users', { where: [['email', '==', String(email).toLowerCase().trim()]], limit: 1 });
  const user = users[0];
  if (!user) throw errors.unauthenticated('بيانات الدخول غير صحيحة');
  if (user.disabled) throw errors.forbidden('هذا الحساب معطّل — راجع مدير النظام');
  if (user.passwordHash !== sha256(password || '')) throw errors.unauthenticated('بيانات الدخول غير صحيحة');
  return {
    token: signDemoToken(user.id),
    user: publicUser(user),
  };
}

/** تحقق رمز في وضع الإنتاج عبر Firebase Admin (استيراد كسول) */
async function verifyFirebaseIdToken(idToken) {
  const { getAuth } = await import('firebase-admin/auth');
  return getAuth().verifyIdToken(idToken, true); // checkRevoked=true — إبطال فوري للجلسات
}

/**
 * فحص رمز الطلب وإعادة المستخدم الكامل (دور + صلاحيات + حالة disabled).
 * يُستدعى في كل طلب محمي.
 */
export async function resolveUser(store, authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) throw errors.unauthenticated();
  const token = authHeader.slice(7).trim();

  let uid = null;
  let email = null;
  let name = null;

  if (token.startsWith('demo.')) {
    if (config.mode !== 'demo') throw errors.unauthenticated('رموز التجربة غير مقبولة في الإنتاج');
    const payload = parseDemoToken(token);
    if (!payload) throw errors.unauthenticated('رمز غير صالح أو منتهي');
    ({ uid, email } = payload);
  } else if (config.mode === 'production') {
    const decoded = await verifyFirebaseIdToken(token);
    uid = decoded.uid;
    email = decoded.email || null;
    name = decoded.name || null;
  } else {
    throw errors.unauthenticated('رمز غير صالح');
  }

  const snap = await store.get(store.ref('users', uid));
  if (!snap.exists) throw errors.unauthenticated('المستخدم غير مهيأ في النظام — راجع مدير النظام');
  const user = snap.data;
  // الإبطال الفوري: مستخدم معطّل = مرفوض في كل طلب
  if (user.disabled) throw errors.forbidden('هذا الحساب معطّل — راجع مدير النظام');

  return {
    uid: user.id,
    email: user.email,
    name: user.displayName || name || '',
    role: user.role,
    permissions: user.permissions || DEFAULT_ROLE_PERMISSIONS[user.role] || [],
    employeeId: user.employeeId || null,
    customerId: user.customerId || null,
    isDemo: token.startsWith('demo.'),
  };
}

/** إسقاط آمن للمستخدم (بدون حقول حساسة) */
export function publicUser(user) {
  return {
    uid: user.id, email: user.email, displayName: user.displayName,
    role: user.role, permissions: user.permissions || DEFAULT_ROLE_PERMISSIONS[user.role] || [],
    disabled: Boolean(user.disabled), employeeId: user.employeeId || null, customerId: user.customerId || null,
  };
}

/** إنشاء/تحديث وثيقة مستخدم من بيانات Firebase (تُستدعى بعد verifyIdToken في الإنتاج) */
export async function upsertUserFromFirebase(store, { uid, email, displayName }) {
  return store.runTransaction(async (tx) => {
    const ref = store.ref('users', uid);
    const snap = await tx.get(ref);
    if (snap.exists) return snap.data;
    const user = {
      id: uid, email: (email || '').toLowerCase(), displayName: displayName || email || uid,
      role: ROLES.EMPLOYEE, permissions: null, disabled: false,
      employeeId: null, customerId: null, createdAt: nowISO(), updatedAt: nowISO(),
      createdBy: 'firebase-auth-bootstrap',
    };
    tx.set(ref, user);
    return user;
  });
}

/* ─────────────── وسائط Express ─────────────── */

/** وسطية المصادقة: ترفق req.user أو ترفض الطلب */
export function authenticate(store) {
  return async (req, _res, next) => {
    try {
      req.user = await resolveUser(store, req.headers.authorization || '');
      next();
    } catch (err) {
      next(err);
    }
  };
}

/** وسطية الدور: السماح لأدوار محددة فقط */
export function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user) return next(errors.unauthenticated());
    if (!roles.includes(req.user.role)) {
      return next(errors.forbidden(`هذه العملية متاحة للأدوار: ${roles.join(', ')}`));
    }
    next();
  };
}

/** وسطية الصلاحية الدقيقة */
export function requirePermission(permission) {
  return (req, _res, next) => {
    if (!req.user) return next(errors.unauthenticated());
    if (!roleHasPermission(req.user, permission)) {
      return next(errors.forbidden(`تفتقر لصلاحية: ${permission}`));
    }
    next();
  };
}

/** وسطية بوابة العميل: فقط دور client (أو admin للفحص) */
export function requireClient(store) {
  return async (req, _res, next) => {
    try {
      if (!req.user) return next(errors.unauthenticated());
      if (req.user.role === ROLES.CLIENT) {
        if (!req.user.customerId) return next(errors.forbidden('حسابك غير مرتبط بملف عميل'));
        return next();
      }
      if (req.user.role === ROLES.ADMIN || req.user.role === ROLES.MANAGER) return next();
      return next(errors.forbidden('هذا المسار خاص ببوابة العملاء'));
    } catch (err) {
      next(err);
    }
  };
}
