/**
 * مسارات العملاء والفواتير والمدفوعات — واجهة REST لموديول الذمم المدينة.
 */
import { Router } from 'express';
import {
  createCustomer, updateCustomer, listCustomers, customerStatement, linkCustomerUser,
} from '../services/customers-service.js';
import { createInvoice, cancelInvoice, listInvoices, getInvoice } from '../services/invoices-service.js';
import {
  createReceipt, requestPortalPayment, approvePortalPayment, rejectPortalPayment,
  listReceipts, listPaymentRequests,
} from '../services/payments-service.js';

export function customersRouter(store, { requirePermission, ROLES, requireRole }) {
  const router = Router();

  router.get('/', requirePermission('customers:view'), async (req, res, next) => {
    try { res.json({ customers: await listCustomers(store, { activeOnly: req.query.active === '1' }) }); }
    catch (err) { next(err); }
  });

  router.post('/', requirePermission('customers:manage'), async (req, res, next) => {
    try { res.status(201).json(await createCustomer(store, req.user, req.body || {})); }
    catch (err) { next(err); }
  });

  router.patch('/:id', requirePermission('customers:manage'), async (req, res, next) => {
    try { res.json(await updateCustomer(store, req.user, req.params.id, req.body || {})); }
    catch (err) { next(err); }
  });

  /** كشف حساب العميل */
  router.get('/:id/statement', requirePermission('customers:view'), async (req, res, next) => {
    try {
      res.json(await customerStatement(store, req.params.id, { from: req.query.from || null, to: req.query.to || null }));
    } catch (err) { next(err); }
  });

  router.post('/:id/link-user', requireRole(ROLES.ADMIN, ROLES.MANAGER), async (req, res, next) => {
    try { res.json(await linkCustomerUser(store, req.user, req.params.id, (req.body || {}).uid)); }
    catch (err) { next(err); }
  });

  return router;
}

export function invoicesRouter(store, { requirePermission }) {
  const router = Router();

  router.get('/', requirePermission('invoices:view'), async (req, res, next) => {
    try {
      res.json({ invoices: await listInvoices(store, {
        customerId: req.query.customer, status: req.query.status,
        from: req.query.from, to: req.query.to,
        limit: Math.min(Number(req.query.limit || 200), 500),
      }) });
    } catch (err) { next(err); }
  });

  router.get('/:id', requirePermission('invoices:view'), async (req, res, next) => {
    try { res.json(await getInvoice(store, req.params.id)); }
    catch (err) { next(err); }
  });

  /** إنشاء فاتورة آجل — قيد مزدوج تلقائي + فحص حد ائتماني */
  router.post('/', requirePermission('invoices:create'), async (req, res, next) => {
    try { res.status(201).json(await createInvoice(store, req.user, req.body || {})); }
    catch (err) { next(err); }
  });

  /** إلغاء بقيد عكسي — لا حذف */
  router.post('/:id/cancel', requirePermission('invoices:cancel'), async (req, res, next) => {
    try { res.json(await cancelInvoice(store, req.user, req.body ? { ...req.body, invoiceId: req.params.id } : { invoiceId: req.params.id })); }
    catch (err) { next(err); }
  });

  return router;
}

export function paymentsRouter(store, { requirePermission }) {
  const router = Router();

  router.get('/receipts', requirePermission('payments:view'), async (req, res, next) => {
    try {
      res.json({ receipts: await listReceipts(store, {
        customerId: req.query.customer, from: req.query.from, to: req.query.to,
        limit: Math.min(Number(req.query.limit || 200), 500),
      }) });
    } catch (err) { next(err); }
  });

  /** سند قبض من عميل — تخصيص صريح أو تلقائي FIFO */
  router.post('/receipts', requirePermission('payments:create'), async (req, res, next) => {
    try { res.status(201).json(await createReceipt(store, req.user, req.body || {})); }
    catch (err) { next(err); }
  });

  /** طلبات دفع البوابة */
  router.get('/requests', requirePermission('payments:view'), async (req, res, next) => {
    try {
      res.json({ requests: await listPaymentRequests(store, { status: req.query.status, customerId: req.query.customer }) });
    } catch (err) { next(err); }
  });

  router.post('/requests/:id/approve', requirePermission('payments:approve'), async (req, res, next) => {
    try { res.json(await approvePortalPayment(store, req.user, { paymentId: req.params.id, ...(req.body || {}) })); }
    catch (err) { next(err); }
  });

  router.post('/requests/:id/reject', requirePermission('payments:approve'), async (req, res, next) => {
    try { res.json(await rejectPortalPayment(store, req.user, { paymentId: req.params.id, ...(req.body || {}) })); }
    catch (err) { next(err); }
  });

  return router;
}
