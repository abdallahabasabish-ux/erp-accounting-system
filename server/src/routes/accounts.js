/**
 * مسارات شجرة الحسابات (Chart of Accounts API).
 */
import { Router } from 'express';

export function accountsRouter(store, { requirePermission, requireRole, ROLES }) {
  const router = Router();

  /** شجرة الحسابات كاملة (بالأرصدة) */
  router.get('/', requirePermission('accounts:view'), async (req, res, next) => {
    try {
      const accounts = await store.read('accounts', { orderBy: ['code', 'asc'], limit: 2000 });
      const balances = await store.read('account_balances', {});
      const balByCode = new Map(balances.map((b) => [b.code, b]));
      const rows = accounts.map((a) => {
        const b = balByCode.get(a.code);
        const side = a.type === 'asset' || a.type === 'expense' ? 'debit' : 'credit';
        const balance = b ? (side === 'debit' ? (b.totalDebit || 0) - (b.totalCredit || 0) : (b.totalCredit || 0) - (b.totalDebit || 0)) : 0;
        return { ...a, balancePiasters: balance };
      });
      // بناء الشجرة
      const byCode = new Map(rows.map((r) => [r.code, { ...r, children: [] }]));
      const roots = [];
      for (const node of byCode.values()) {
        if (node.parent && byCode.has(node.parent)) byCode.get(node.parent).children.push(node);
        else roots.push(node);
      }
      res.json({ accounts: rows, tree: roots });
    } catch (err) { next(err); }
  });

  /** إنشاء حساب جديد (تحت حساب أب) */
  router.post('/', requireRole(ROLES.ADMIN, ROLES.MANAGER), requirePermission('accounts:manage'), async (req, res, next) => {
    try {
      const { code, name, type, kind, parent } = req.body || {};
      if (!/^\d{4}$/.test(String(code || ''))) throw Object.assign(new Error('رمز الحساب 4 خانات رقمية'), { status: 400, code: 'BAD_REQUEST' });
      if (!name || !type) throw Object.assign(new Error('الاسم والنوع مطلوبان'), { status: 400, code: 'BAD_REQUEST' });
      const account = await store.runTransaction(async (tx) => {
        const ref = store.ref('accounts', code);
        const snap = await tx.get(ref);
        if (snap.exists) throw Object.assign(new Error('رمز الحساب مستخدم بالفعل'), { status: 409, code: 'CODE_TAKEN' });
        if (parent) {
          const parentSnap = await tx.get(store.ref('accounts', parent));
          if (!parentSnap.exists) throw Object.assign(new Error('الحساب الأب غير موجود'), { status: 400, code: 'BAD_REQUEST' });
        }
        const doc = {
          id: code, code, name: String(name).trim(), type,
          kind: kind === 'posting' ? 'posting' : 'group',
          parent: parent || null, active: true, isSystem: false,
          createdBy: { uid: req.user.uid, email: req.user.email },
          createdAt: new Date().toISOString(),
        };
        tx.set(ref, doc);
        return doc;
      });
      res.status(201).json(account);
    } catch (err) { next(err); }
  });

  /** تعطيل/تفعيل حساب (لا حذف — الحسابات المستخدمة تبقى في التاريخ) */
  router.patch('/:code/status', requireRole(ROLES.ADMIN, ROLES.MANAGER), requirePermission('accounts:manage'), async (req, res, next) => {
    try {
      const { active } = req.body || {};
      const updated = await store.runTransaction(async (tx) => {
        const ref = store.ref('accounts', req.params.code);
        const snap = await tx.get(ref);
        if (!snap.exists) throw Object.assign(new Error('الحساب غير موجود'), { status: 404, code: 'NOT_FOUND' });
        tx.update(ref, { active: Boolean(active), updatedAt: new Date().toISOString() });
        return { ...snap.data, active: Boolean(active) };
      });
      res.json(updated);
    } catch (err) { next(err); }
  });

  return router;
}
