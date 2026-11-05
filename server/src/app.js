/**
 * تركيب تطبيق Express — الوسطيات + كل المسارات + معالج الأخطاء الموحد.
 */
import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { ApiError } from './lib/errors.js';
import { authenticate, ROLES, requireRole, requirePermission } from './services/auth-service.js';
import { accountsRouter } from './routes/accounts.js';
import { journalRouter, reportsRouter, periodsRouter } from './routes/journal.js';
import { customersRouter, invoicesRouter, paymentsRouter } from './routes/customers.js';
import {
  treasuryRouter, hrRouter, expensesRouter, usersRouter, authRouter, auditRouter, settingsRouter,
} from './routes/operations.js';
import { portalRouter } from './routes/portal.js';

const MW = { requirePermission, requireRole, ROLES };

export function buildApp(store) {
  const app = express();
  app.disable('x-powered-by');
  app.use(cors({ origin: config.corsOrigins.includes('*') ? true : config.corsOrigins }));
  app.use(express.json({ limit: '2mb' }));

  /** سجل طلبات مختصر (مطويري) */
  app.use((req, _res, next) => {
    if (process.env.QUIET !== '1') {
      console.log(`→ ${req.method} ${req.originalUrl}`);
    }
    next();
  });

  // الصحة والمعلومات العامة (بدون مصادقة)
  app.get('/api/health', (_req, res) => res.json({ ok: true, mode: store.mode, time: new Date().toISOString() }));
  app.get('/api/meta', async (_req, res) => {
    let vatRate = config.finance.defaultVatRate;
    try {
      const snap = await store.get(store.ref('settings', 'main'));
      if (snap.exists) vatRate = snap.data.vatRate ?? vatRate;
    } catch { /* تجاهل */ }
    res.json({
      mode: store.mode,
      currency: config.finance.currency,
      currencySymbol: config.finance.currencySymbol,
      minorUnit: config.finance.minorUnit,
      vatRate,
      timezone: config.finance.timezone,
      apiVersion: '1.0.0',
    });
  });

  // المصادقة ثم المسارات المحمية
  app.use('/api/auth', authRouter(store));
  app.use(authenticate(store));
  app.use('/api/accounts', accountsRouter(store, MW));
  app.use('/api/journal', journalRouter(store, MW));
  app.use('/api/periods', periodsRouter(store, MW));
  app.use('/api/reports', reportsRouter(store, MW));
  app.use('/api/customers', customersRouter(store, MW));
  app.use('/api/invoices', invoicesRouter(store, MW));
  app.use('/api/payments', paymentsRouter(store, MW));
  app.use('/api/treasury', treasuryRouter(store, MW));
  app.use('/api/hr', hrRouter(store, MW));
  app.use('/api/expenses', expensesRouter(store, MW));
  app.use('/api/users', usersRouter(store, MW));
  app.use('/api/audit', auditRouter(store, MW));
  app.use('/api/settings', settingsRouter(store, MW));
  app.use('/api/portal', portalRouter(store, MW));

  // مسارات غير معروفة
  app.use('/api', (_req, _res, next) => next(new ApiError(404, 'ROUTE_NOT_FOUND', 'المسار غير موجود')));

  // معالج الأخطاء الموحد: أخطاء الأعمال برموزها، وما عداه خطأ داخلي عام (بلا تسريب تفاصيل)
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof ApiError) {
      return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    }
    console.error('UNHANDLED:', err);
    return res.status(500).json({ error: { code: 'INTERNAL', message: 'خطأ غير متوقع في الخادم' } });
  });

  return app;
}
