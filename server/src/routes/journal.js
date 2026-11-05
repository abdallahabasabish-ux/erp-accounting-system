/**
 * مسارات القيود اليومية والفترات المالية والتقارير — واجهة REST للمحرك المحاسبي.
 */
import { Router } from 'express';
import { postJournalEntry, postReversal, listEntries, getEntry, allBalances } from '../core/journal.js';
import { trialBalance, profitAndLoss, balanceSheet, cashFlowStatement, generalLedger, receivablesAging } from '../core/reports.js';
import { closePeriod, reopenPeriod, listPeriods } from '../core/periods.js';
import { toPiasters } from '../lib/money.js';

export function journalRouter(store, { requirePermission, requireRole, ROLES }) {
  const router = Router();

  /** قائمة القيود */
  router.get('/', requirePermission('journal:view'), async (req, res, next) => {
    try {
      const rows = await listEntries(store, {
        from: req.query.from, to: req.query.to,
        periodKey: req.query.period, accountCode: req.query.account,
        type: req.query.type, limit: Math.min(Number(req.query.limit || 100), 500),
      });
      res.json({ entries: rows, count: rows.length });
    } catch (err) { next(err); }
  });

  /** قيد محدد */
  router.get('/:id', requirePermission('journal:view'), async (req, res, next) => {
    try {
      const entry = await getEntry(store, req.params.id);
      if (!entry) return next(Object.assign(new Error('القيد غير موجود'), { status: 404, code: 'NOT_FOUND' }));
      res.json(entry);
    } catch (err) { next(err); }
  });

  /** قيد يدوي — المحاسب يبني الأطراف والنظام يفرض التوازن */
  router.post('/', requirePermission('journal:create'), async (req, res, next) => {
    try {
      const { date, memo, lines, type, idempotencyKey } = req.body || {};
      const normalized = (lines || []).map((l) => ({
        accountCode: l.accountCode,
        debit: typeof l.debit === 'string' ? toPiasters(l.debit) : (l.debit || 0),
        credit: typeof l.credit === 'string' ? toPiasters(l.credit) : (l.credit || 0),
        note: l.note || '',
      }));
      const { entry } = await postJournalEntry(store, {
        date, memo, lines: normalized, actor: req.user,
        type: type || 'adjusting',
        idempotencyKey: idempotencyKey || null,
      });
      res.status(201).json({ entry });
    } catch (err) { next(err); }
  });

  /** قيد عكسي — التصحيح الوحيد المسموح */
  router.post('/:id/reverse', requirePermission('journal:reverse'), async (req, res, next) => {
    try {
      const { date, reason } = req.body || {};
      const result = await postReversal(store, {
        originalEntryId: req.params.id, date, reason, actor: req.user,
      });
      res.status(201).json(result);
    } catch (err) { next(err); }
  });

  /** جدول الأرصدة المخزنة (سريع) */
  router.get('/balances/all', requirePermission('accounts:view'), async (_req, res, next) => {
    try {
      res.json({ balances: await allBalances(store) });
    } catch (err) { next(err); }
  });

  return router;
}

export function reportsRouter(store, { requirePermission }) {
  const router = Router();

  /** 1) ميزان المراجعة */
  router.get('/trial-balance', requirePermission('reports:view'), async (req, res, next) => {
    try {
      res.json(await trialBalance(store, { from: req.query.from || null, to: req.query.to || null }));
    } catch (err) { next(err); }
  });

  /** 2) قائمة الدخل */
  router.get('/profit-loss', requirePermission('reports:view'), async (req, res, next) => {
    try {
      res.json(await profitAndLoss(store, { from: req.query.from, to: req.query.to }));
    } catch (err) { next(err); }
  });

  /** 3) الميزانية العمومية */
  router.get('/balance-sheet', requirePermission('reports:view'), async (req, res, next) => {
    try {
      res.json(await balanceSheet(store, { asOf: req.query.asOf }));
    } catch (err) { next(err); }
  });

  /** 4) التدفقات النقدية */
  router.get('/cash-flow', requirePermission('reports:view'), async (req, res, next) => {
    try {
      res.json(await cashFlowStatement(store, { from: req.query.from, to: req.query.to }));
    } catch (err) { next(err); }
  });

  /** 5) دفتر أستاذ حساب */
  router.get('/ledger/:accountCode', requirePermission('reports:view'), async (req, res, next) => {
    try {
      res.json(await generalLedger(store, req.params.accountCode, { from: req.query.from || null, to: req.query.to || null }));
    } catch (err) { next(err); }
  });

  /** 6) أعمار الذمم المدينة */
  router.get('/aging', requirePermission('reports:view'), async (req, res, next) => {
    try {
      res.json(await receivablesAging(store, { asOf: req.query.asOf || undefined }));
    } catch (err) { next(err); }
  });

  return router;
}

export function periodsRouter(store, { requirePermission, requireRole, ROLES }) {
  const router = Router();

  router.get('/', requirePermission('periods:view'), async (_req, res, next) => {
    try {
      res.json({ periods: await listPeriods(store) });
    } catch (err) { next(err); }
  });

  /** إغلاق فترة — مدير */
  router.post('/:key/close', requireRole(ROLES.ADMIN, ROLES.MANAGER), requirePermission('periods:close'), async (req, res, next) => {
    try {
      const period = await closePeriod(store, req.params.key, req.user, (req.body || {}).reason);
      res.json(period);
    } catch (err) { next(err); }
  });

  /** إعادة فتح فترة — مدير + سبب */
  router.post('/:key/reopen', requireRole(ROLES.ADMIN, ROLES.MANAGER), requirePermission('periods:close'), async (req, res, next) => {
    try {
      const period = await reopenPeriod(store, req.params.key, req.user, (req.body || {}).reason);
      res.json(period);
    } catch (err) { next(err); }
  });

  /** قيد الإقفال السنوي — مدير */
  router.post('/year-end/:year/close', requireRole(ROLES.ADMIN, ROLES.MANAGER), requirePermission('periods:close'), async (req, res, next) => {
    try {
      const { planYearEndClosing, executeYearEndClosing } = await import('../core/periods.js');
      const plan = await planYearEndClosing(store, req.params.year);
      const result = await executeYearEndClosing(store, req.params.year, req.user);
      res.json({ plan, result });
    } catch (err) { next(err); }
  });

  return router;
}
