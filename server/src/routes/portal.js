/**
 * مسارات بوابة العميل (Client Portal) — العميل يرى فواتيره وكشف حسابه فقط
 * ويسدد بطلب مراجع للاعتماد. نطاق البيانات مفروض من الخادم بـ customerId
 * (في النظام القديم كان يُفترض من الواجهة — ثغرة موثقة).
 */
import { Router } from 'express';
import { requireClient } from '../services/auth-service.js';
import { customerStatement } from '../services/customers-service.js';
import { listInvoices } from '../services/invoices-service.js';
import { requestPortalPayment, listPaymentRequests } from '../services/payments-service.js';

export function portalRouter(store, { ROLES }) {
  const router = Router();
  router.use(requireClient(store));

  /** تحديد هوية العميل المطلوب: العميل نفسه إلزاماً، الإدارة عبر ?customer= */
  function targetCustomerId(req) {
    if (req.user.role === ROLES.CLIENT) return req.user.customerId;
    return req.query.customer || null;
  }

  /** نظرة عامة: بياناتي + فواتيري + طلباتي */
  router.get('/overview', async (req, res, next) => {
    try {
      const customerId = targetCustomerId(req);
      if (!customerId) return res.json({ overview: null });
      const custSnap = await store.get(store.ref('customers', customerId));
      if (!custSnap.exists) return next(Object.assign(new Error('ملف العميل غير موجود'), { status: 404, code: 'NOT_FOUND' }));
      const c = custSnap.data;
      const invoices = await listInvoices(store, { customerId, limit: 100 });
      const requests = await listPaymentRequests(store, { customerId, limit: 50 });
      res.json({
        overview: {
          customer: {
            id: c.id, code: c.code, name: c.name,
            creditLimitPiasters: c.creditLimitPiasters,
            arBalancePiasters: c.arBalancePiasters || 0,
          },
          invoices: invoices.map((i) => ({
            id: i.id, number: i.number, date: i.date, dueDate: i.dueDate,
            total: i.total, paidTotal: i.paidTotal, balance: i.balance, status: i.status,
          })),
          paymentRequests: requests.map((r) => ({
            id: r.id, amount: r.amount, method: r.method, status: r.status,
            createdAt: r.createdAt, rejectionReason: r.rejectionReason || null,
          })),
        },
      });
    } catch (err) { next(err); }
  });

  /** كشف حساب العميل */
  router.get('/statement', async (req, res, next) => {
    try {
      const customerId = targetCustomerId(req);
      if (!customerId) throw Object.assign(new Error('حدد العميل'), { status: 400, code: 'BAD_REQUEST' });
      res.json(await customerStatement(store, customerId, { from: req.query.from || null, to: req.query.to || null }));
    } catch (err) { next(err); }
  });

  /** طلب دفع جديد (يعلّق للاعتماد — لا أثر محاسبي حتى الاعتماد) */
  router.post('/payments', async (req, res, next) => {
    try {
      if (req.user.role !== ROLES.CLIENT) {
        throw Object.assign(new Error('طلبات الدفع من البوابة للعملاء فقط'), { status: 403, code: 'FORBIDDEN' });
      }
      res.status(201).json(await requestPortalPayment(store, req.user, req.body || {}));
    } catch (err) { next(err); }
  });

  return router;
}
