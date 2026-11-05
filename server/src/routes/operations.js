/**
 * مسارات الخزينة والموارد البشرية والمصروفات والمستخدمين والمصادقة والبوابة.
 */
import { Router } from 'express';
import {
  createTreasuryAccount, listTreasuryAccounts, createDisbursement, createTransfer,
  saveBankReconciliation, listReconciliations, listVouchers,
} from '../services/treasury-service.js';
import {
  createEmployee, updateEmployee, listEmployees, grantAdvance, accrueCommission,
} from '../services/employees-service.js';
import {
  createPayrollRun, approvePayrollRun, disbursePayrollRun, deleteDraftPayrollRun,
  listPayrollRuns, myPayrollSummary,
} from '../services/payroll-service.js';
import { createExpenseVoucher, listExpenses } from '../services/expenses-service.js';
import { listUsers, createUser, updateUser, setUserDisabled, rbacCatalog } from '../services/users-service.js';
import { demoLogin, publicUser, ROLES } from '../services/auth-service.js';
import { listAudit } from '../services/audit-service.js';
import { getSettings, updateSettings } from '../services/settings-service.js';

export function treasuryRouter(store, { requirePermission, ROLES, requireRole }) {
  const router = Router();

  router.get('/accounts', requirePermission('treasury:view'), async (_req, res, next) => {
    try { res.json({ accounts: await listTreasuryAccounts(store) }); }
    catch (err) { next(err); }
  });

  router.post('/accounts', requireRole(ROLES.ADMIN, ROLES.MANAGER), requirePermission('treasury:manage'), async (req, res, next) => {
    try { res.status(201).json(await createTreasuryAccount(store, req.user, req.body || {})); }
    catch (err) { next(err); }
  });

  /** سند صرف (مع فحص منع السحب المكشوف داخل المعاملة) */
  router.post('/disbursements', requirePermission('treasury:manage'), async (req, res, next) => {
    try { res.status(201).json(await createDisbursement(store, req.user, req.body || {})); }
    catch (err) { next(err); }
  });

  /** تحويل بين خزينتين — قيد واحد بطرفين نقديين */
  router.post('/transfers', requirePermission('treasury:manage'), async (req, res, next) => {
    try { res.status(201).json(await createTransfer(store, req.user, req.body || {})); }
    catch (err) { next(err); }
  });

  /** سندات الصرف والتحويل */
  router.get('/vouchers', requirePermission('treasury:view'), async (req, res, next) => {
    try {
      res.json({ vouchers: await listVouchers(store, { type: req.query.type, from: req.query.from, to: req.query.to }) });
    } catch (err) { next(err); }
  });

  /** التسوية البنكية */
  router.get('/reconciliations', requirePermission('treasury:view'), async (req, res, next) => {
    try { res.json({ reconciliations: await listReconciliations(store, { treasuryAccountId: req.query.account }) }); }
    catch (err) { next(err); }
  });

  router.post('/reconciliations', requirePermission('treasury:manage'), async (req, res, next) => {
    try { res.status(201).json(await saveBankReconciliation(store, req.user, req.body || {})); }
    catch (err) { next(err); }
  });

  return router;
}

export function hrRouter(store, { requirePermission, ROLES, requireRole }) {
  const router = Router();

  router.get('/employees', requirePermission('employees:view'), async (req, res, next) => {
    try { res.json({ employees: await listEmployees(store, { activeOnly: req.query.active === '1' }) }); }
    catch (err) { next(err); }
  });

  router.post('/employees', requireRole(ROLES.ADMIN, ROLES.MANAGER), requirePermission('employees:manage'), async (req, res, next) => {
    try { res.status(201).json(await createEmployee(store, req.user, req.body || {})); }
    catch (err) { next(err); }
  });

  router.patch('/employees/:id', requireRole(ROLES.ADMIN, ROLES.MANAGER), requirePermission('employees:manage'), async (req, res, next) => {
    try { res.json(await updateEmployee(store, req.user, req.params.id, req.body || {})); }
    catch (err) { next(err); }
  });

  /** منح سلفة */
  router.post('/advances', requirePermission('treasury:manage'), async (req, res, next) => {
    try { res.status(201).json(await grantAdvance(store, req.user, req.body || {})); }
    catch (err) { next(err); }
  });

  /** استحقاق عمولة/تعويض */
  router.post('/commissions', requirePermission('journal:create'), async (req, res, next) => {
    try { res.status(201).json(await accrueCommission(store, req.user, req.body || {})); }
    catch (err) { next(err); }
  });

  /** مسيرات الرواتب */
  router.get('/payroll-runs', requirePermission('payroll:view'), async (req, res, next) => {
    try { res.json({ runs: await listPayrollRuns(store, { status: req.query.status, period: req.query.period }) }); }
    catch (err) { next(err); }
  });

  router.post('/payroll-runs', requirePermission('payroll:run'), async (req, res, next) => {
    try { res.status(201).json(await createPayrollRun(store, req.user, req.body || {})); }
    catch (err) { next(err); }
  });

  router.post('/payroll-runs/:id/approve', requirePermission('payroll:approve'), async (req, res, next) => {
    try { res.json(await approvePayrollRun(store, req.user, { runId: req.params.id, ...(req.body || {}) })); }
    catch (err) { next(err); }
  });

  router.post('/payroll-runs/:id/disburse', requirePermission('payroll:approve'), async (req, res, next) => {
    try { res.json(await disbursePayrollRun(store, req.user, { runId: req.params.id, ...(req.body || {}) })); }
    catch (err) { next(err); }
  });

  router.delete('/payroll-runs/:id', requirePermission('payroll:run'), async (req, res, next) => {
    try { res.json(await deleteDraftPayrollRun(store, req.user, req.params.id)); }
    catch (err) { next(err); }
  });

  /** المسار الشخصي للموظف: بياناته ومستحقاته فقط */
  router.get('/me', async (req, res, next) => {
    try {
      if (!req.user.employeeId) throw Object.assign(new Error('حسابك غير مرتبط بملف موظف'), { status: 403, code: 'FORBIDDEN' });
      res.json(await myPayrollSummary(store, req.user.employeeId));
    } catch (err) { next(err); }
  });

  return router;
}

export function expensesRouter(store, { requirePermission }) {
  const router = Router();

  router.get('/', requirePermission('expenses:view'), async (req, res, next) => {
    try {
      res.json({ expenses: await listExpenses(store, { from: req.query.from, to: req.query.to, category: req.query.category }) });
    } catch (err) { next(err); }
  });

  /** سند مصروف — قيد فوري: مدين مصروف | دائن نقد أو مورد */
  router.post('/', requirePermission('expenses:create'), async (req, res, next) => {
    try { res.status(201).json(await createExpenseVoucher(store, req.user, req.body || {})); }
    catch (err) { next(err); }
  });

  return router;
}

export function usersRouter(store, { ROLES: R, requireRole, adminOnly }) {
  const router = Router();

  router.get('/', requireRole(R.ADMIN), async (_req, res, next) => {
    try { res.json({ users: await listUsers(store) }); }
    catch (err) { next(err); }
  });

  router.post('/', requireRole(R.ADMIN), async (req, res, next) => {
    try { res.status(201).json(await createUser(store, req.user, req.body || {})); }
    catch (err) { next(err); }
  });

  router.patch('/:id', requireRole(R.ADMIN), async (req, res, next) => {
    try { res.json(await updateUser(store, req.user, req.params.id, req.body || {})); }
    catch (err) { next(err); }
  });

  router.post('/:id/disabled', requireRole(R.ADMIN), async (req, res, next) => {
    try {
      const { disabled, reason } = req.body || {};
      res.json(await setUserDisabled(store, req.user, req.params.id, Boolean(disabled), reason));
    } catch (err) { next(err); }
  });

  router.get('/rbac/catalog', requireRole(R.ADMIN), async (_req, res) => {
    res.json(rbacCatalog());
  });

  return router;
}

export function authRouter(store) {
  const router = Router();

  /** دخول تجريبي (demo فقط) */
  router.post('/login', async (req, res, next) => {
    try {
      const { email, password } = req.body || {};
      res.json(await demoLogin(store, { email, password }));
    } catch (err) { next(err); }
  });

  /** في الإنتاج: العميل يرسل idToken من Firebase Auth للتحقق وربط الجلسة */
  router.post('/session', async (req, res, next) => {
    try {
      const { authenticate } = await import('../services/auth-service.js');
      req.user = await (async () => {
        const { resolveUser } = await import('../services/auth-service.js');
        return resolveUser(store, req.headers.authorization || '');
      })();
      res.json({ user: publicUser({ ...req.user, id: req.user.uid }) });
    } catch (err) { next(err); }
  });

  router.get('/me', async (req, res, next) => {
    try {
      const { resolveUser } = await import('../services/auth-service.js');
      const user = await resolveUser(store, req.headers.authorization || '');
      res.json({ user: publicUser({ ...user, id: user.uid }) });
    } catch (err) { next(err); }
  });

  return router;
}

export function auditRouter(store, { ROLES: R, requireRole }) {
  const router = Router();

  router.get('/', requireRole(R.ADMIN, R.MANAGER), async (req, res, next) => {
    try {
      res.json({ logs: await listAudit(store, {
        entity: req.query.entity, entityId: req.query.entityId,
        actorUid: req.query.actor, action: req.query.action,
        limit: Math.min(Number(req.query.limit || 200), 500),
      }) });
    } catch (err) { next(err); }
  });

  return router;
}

export function settingsRouter(store, { ROLES: R, requireRole }) {
  const router = Router();

  router.get('/', async (_req, res, next) => {
    try { res.json(await getSettings(store)); }
    catch (err) { next(err); }
  });

  router.patch('/', requireRole(R.ADMIN, R.MANAGER), async (req, res, next) => {
    try { res.json(await updateSettings(store, req.user, req.body || {})); }
    catch (err) { next(err); }
  });

  return router;
}
