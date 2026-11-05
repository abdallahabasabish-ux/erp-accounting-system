/**
 * محرك مسير الرواتب (Payroll Run Engine) — بمبدأ الاستحقاق الكامل.
 *
 * دورة المسير:
 *   draft    → احتساب (أساسي + بدلات − استقطاع سلف − تأمينات − ضرائب = الصافي)
 *   approved → ترحيل قيد الاستحقاق آلياً:
 *                مدين: مصروف الرواتب والبدلات (5100) بإجمالي القسط
 *                دائن: رواتب مستحقة 2120-Exxxx لكل موظف بالصافي
 *                دائن: التأمينات المستحقة (2130) + ضرائب الرواتب (2140)
 *                دائن: سلف الموظفين 1140-Exxxx باستقطاع السلف
 *   paid     → قيد الصرف: مدين رواتب مستحقة | دائن الخزينة/البنك
 */
import { toPiasters, assertSafeInt } from '../lib/money.js';
import { nowISO, periodBounds } from '../lib/dates.js';
import { errors } from '../lib/errors.js';
import { postJournalEntryTx } from '../core/journal.js';
import { allocatePayrollNumber } from '../core/sequence.js';
import { assertPeriodOpenForDate } from '../core/periods.js';
import { assertValidDate } from './customers-service.js';
import { writeAuditTx } from './audit-service.js';

/**
 * إنشاء مسير رواتب (مسودة) لفترة شهرية — احتساب فقط بلا أي أثر محاسبي.
 * @param input {period: 'YYYY-MM', notes?, adjustments?: {employeeId: {extraDeduction?, extraAllowance?}}}
 */
export async function createPayrollRun(store, actor, input) {
  const period = String(input.period || '');
  if (!/^\d{4}-\d{2}$/.test(period)) throw errors.badRequest('الفترة بصيغة YYYY-MM مطلوبة');
  const { end } = periodBounds(period);
  const postingDate = assertValidDate(input.date || end, 'تاريخ ترحيل المسير');

  const employees = await store.read('employees', { where: [['status', '==', 'active']], limit: 500 });
  if (employees.length === 0) throw errors.badRequest('لا يوجد موظفون نشطون لبناء مسير');
  const adjustments = input.adjustments || {};

  const lines = employees.map((emp) => {
    const adj = adjustments[emp.id] || {};
    const basic = emp.salaryBasicPiasters || 0;
    const allowances = (emp.allowancesPiasters || 0) + (adj.extraAllowance ? toPiasters(adj.extraAllowance) : 0);
    const gross = basic + allowances;
    const advancesDeducted = Math.min(
      emp.advancesOutstandingPiasters || 0,
      adj.advanceDeduction !== undefined ? toPiasters(adj.advanceDeduction) : emp.advancesOutstandingPiasters || 0,
    );
    const insurance = emp.insuranceEmployeePiasters || 0;
    const tax = emp.payrollTaxPiasters || 0;
    const otherDeduction = adj.extraDeduction ? toPiasters(adj.extraDeduction) : 0;
    const net = gross - advancesDeducted - insurance - tax - otherDeduction;
    if (net < 0) {
      throw errors.badRequest(`صافي راتب ${emp.name} سالب — راجع الاستقطاعات`);
    }
    return {
      employeeId: emp.id, employeeCode: emp.code, employeeName: emp.name,
      payableAccountCode: emp.payableAccountCode, advanceAccountCode: emp.advanceAccountCode,
      basic, allowances, gross, advancesDeducted, insurance, tax, otherDeduction, net,
    };
  });

  const totals = {
    gross: lines.reduce((s, l) => s + l.gross, 0),
    advances: lines.reduce((s, l) => s + l.advancesDeducted, 0),
    insurance: lines.reduce((s, l) => s + l.insurance, 0),
    tax: lines.reduce((s, l) => s + l.tax, 0),
    otherDeductions: lines.reduce((s, l) => s + l.otherDeduction, 0),
    net: lines.reduce((s, l) => s + l.net, 0),
  };
  // إثبات داخلي: الإجمالي = الصافي + كل الاستقطاعات
  const check = totals.gross - totals.advances - totals.insurance - totals.tax - totals.otherDeductions === totals.net;
  if (!check) throw new Error('اختلال حساب مسير الرواتب — أُلغيت العملية');

  const id = store.newId();
  return store.runTransaction(async (tx) => {
    // منع مسير مكرر لنفس الفترة (عداد مخصص)
    const number = await allocatePayrollNumber(tx, store, period);
    const run = {
      id, number, period, date: postingDate,
      lines, totals, check,
      status: 'draft', // draft → approved (استحقاق) → paid (صرف)
      journalEntryId: null, paymentEntryId: null,
      notes: input.notes || '',
      createdBy: { uid: actor.uid, email: actor.email, name: actor.name || '' },
      createdAt: nowISO(), updatedAt: nowISO(),
    };
    tx.set(store.ref('payroll_runs', id), run);
    await writeAuditTx(tx, store, {
      actor, action: 'payroll.create', entity: 'payroll_runs', entityId: id,
      summary: `مسير رواتب ${number} للفترة ${period} — صافي ${(totals.net / 100).toFixed(2)} ج.م لـ ${lines.length} موظف`,
    });
    return run;
  });
}

/**
 * اعتماد المسير = ترحيل قيد الاستحقاق (Accrual) — مبدأ الاستحقاق: المصروف يُعترف
 * به عند استحقاقه (نهاية الشهر) لا عند صرفه.
 */
export async function approvePayrollRun(store, actor, { runId, date } = {}) {
  return store.runTransaction(async (tx) => {
    const snap = await tx.get(store.ref('payroll_runs', runId));
    if (!snap.exists) throw errors.notFound('مسير الرواتب');
    const run = snap.data;
    if (run.status !== 'draft') throw errors.conflict('RUN_NOT_DRAFT', `المسير حالته ${run.status} — الاعتماد للمسودات فقط`);
    const postingDate = assertValidDate(date || run.date, 'تاريخ الترحيل');
    await assertPeriodOpenForDate(tx, store, postingDate);

    const lines = [
      { accountCode: '5100', debit: run.totals.gross, credit: 0, note: `إجمالي رواتب ${run.period}` },
    ];
    for (const l of run.lines) {
      if (l.net > 0) {
        lines.push({
          accountCode: l.payableAccountCode, debit: 0, credit: l.net,
          note: `صافي مستحق ${l.employeeName}`, party: { kind: 'employee', id: l.employeeId, name: l.employeeName },
        });
      }
      if (l.advancesDeducted > 0) {
        lines.push({
          accountCode: l.advanceAccountCode, debit: 0, credit: l.advancesDeducted,
          note: `استقطاع سلفة ${l.employeeName}`, party: { kind: 'employee', id: l.employeeId, name: l.employeeName },
        });
      }
    }
    if (run.totals.insurance > 0) lines.push({ accountCode: '2130', debit: 0, credit: run.totals.insurance, note: 'تأمينات اجتماعية مستحقة (حصة الموظف)' });
    if (run.totals.tax > 0) lines.push({ accountCode: '2140', debit: 0, credit: run.totals.tax, note: 'ضرائب رواتب مستحقة' });
    if (run.totals.otherDeductions > 0) lines.push({ accountCode: '5600', debit: 0, credit: run.totals.otherDeductions, note: 'خصومات أخرى (تعويض عكسي)' });

    const { entry } = await postJournalEntryTx(tx, store, {
      date: postingDate,
      memo: `قيد استحقاق رواتب الفترة ${run.period} (${run.number})`,
      lines, actor,
      sourceRef: { module: 'payroll_runs', docId: run.id, number: run.number },
      idempotencyKey: `payroll-approve-${run.id}`,
    });

    // تحديث ذاكرات الموظفين: السلف تُخصم، المستحقات ترتفع
    for (const l of run.lines) {
      const empRef = store.ref('employees', l.employeeId);
      const empSnap = await tx.get(empRef);
      if (!empSnap.exists) continue;
      tx.update(empRef, {
        advancesOutstandingPiasters: (empSnap.data.advancesOutstandingPiasters || 0) - l.advancesDeducted,
        salariesPayablePiasters: (empSnap.data.salariesPayablePiasters || 0) + l.net,
        updatedAt: nowISO(),
      });
    }

    tx.update(store.ref('payroll_runs', runId), {
      status: 'approved', journalEntryId: entry.id, journalNumber: entry.number,
      date: postingDate, approvedAt: nowISO(),
      approvedBy: { uid: actor.uid, email: actor.email },
      updatedAt: nowISO(),
    });
    await writeAuditTx(tx, store, {
      actor, action: 'payroll.approve', entity: 'payroll_runs', entityId: runId,
      summary: `اعتماد مسير ${run.number} وترحيل قيد الاستحقاق ${entry.number}`,
    });
    return { run: { ...run, status: 'approved' }, journalEntry: entry };
  });
}

/** صرف الرواتب — قيد: مدين رواتب مستحقة لكل موظف | دائن الخزينة/البنك */
export async function disbursePayrollRun(store, actor, { runId, treasuryAccountId, date }) {
  const payDate = assertValidDate(date || nowISO().slice(0, 10), 'تاريخ الصرف');
  return store.runTransaction(async (tx) => {
    const snap = await tx.get(store.ref('payroll_runs', runId));
    if (!snap.exists) throw errors.notFound('مسير الرواتب');
    const run = snap.data;
    if (run.status !== 'approved') throw errors.conflict('RUN_NOT_APPROVED', 'الصرف بعد اعتماد المسير فقط');
    if ((run.totals.net || 0) <= 0) throw errors.badRequest('صافي المسير صفر — لا شيء يُصرف');

    const tSnap = await tx.get(store.ref('treasury_accounts', treasuryAccountId));
    if (!tSnap.exists) throw errors.notFound('الخزينة/البنك');
    const treasury = tSnap.data;

    // كفاية الرصيد الكلي
    const balSnap = await tx.get(store.ref('account_balances', treasury.accountCode));
    const available = balSnap.exists ? (balSnap.data.totalDebit || 0) - (balSnap.data.totalCredit || 0) : 0;
    if (available - run.totals.net < 0) throw errors.insufficientFunds(treasury.name, available, run.totals.net);

    await assertPeriodOpenForDate(tx, store, payDate);

    const lines = [];
    for (const l of run.lines) {
      if (l.net > 0) {
        lines.push({
          accountCode: l.payableAccountCode, debit: l.net, credit: 0,
          note: `صرف راتب ${l.employeeName}`, party: { kind: 'employee', id: l.employeeId, name: l.employeeName },
        });
      }
    }
    lines.push({ accountCode: treasury.accountCode, debit: 0, credit: run.totals.net, note: `صرف رواتب ${run.period}` });

    const { entry } = await postJournalEntryTx(tx, store, {
      date: payDate,
      memo: `صرف رواتب الفترة ${run.period} (${run.number}) من ${treasury.name}`,
      lines, actor,
      sourceRef: { module: 'payroll_runs', docId: run.id, number: run.number },
      idempotencyKey: `payroll-pay-${run.id}`,
    });

    for (const l of run.lines) {
      const empRef = store.ref('employees', l.employeeId);
      const empSnap = await tx.get(empRef);
      if (!empSnap.exists) continue;
      tx.update(empRef, {
        salariesPayablePiasters: (empSnap.data.salariesPayablePiasters || 0) - l.net,
        updatedAt: nowISO(),
      });
    }

    tx.update(store.ref('payroll_runs', runId), {
      status: 'paid', paymentEntryId: entry.id, paymentEntryNumber: entry.number,
      paidAt: nowISO(), paidBy: { uid: actor.uid, email: actor.email },
      paidFromTreasuryId: treasury.id, updatedAt: nowISO(),
    });
    await writeAuditTx(tx, store, {
      actor, action: 'payroll.disburse', entity: 'payroll_runs', entityId: runId,
      summary: `صرف رواتب ${run.period} بمبلغ ${(run.totals.net / 100).toFixed(2)} ج.م من ${treasury.name}`,
    });
    return { run: { ...run, status: 'paid' }, journalEntry: entry };
  });
}

/** حذف مسودة مسير (قبل الاعتماد فقط) */
export async function deleteDraftPayrollRun(store, actor, runId) {
  return store.runTransaction(async (tx) => {
    const snap = await tx.get(store.ref('payroll_runs', runId));
    if (!snap.exists) throw errors.notFound('مسير الرواتب');
    if (snap.data.status !== 'draft') throw errors.conflict('RUN_NOT_DRAFT', 'حذف المسودات فقط — المسير المعتمد يُعكس بقيد عكسي');
    tx.delete(store.ref('payroll_runs', runId));
    await writeAuditTx(tx, store, {
      actor, action: 'payroll.delete_draft', entity: 'payroll_runs', entityId: runId,
      summary: `حذف مسودة مسير رواتب ${snap.data.number}`,
    });
    return { deleted: runId };
  });
}

/** قائمة المسيرات */
export async function listPayrollRuns(store, { status, period, limit = 100 } = {}) {
  const where = [];
  if (status) where.push(['status', '==', status]);
  if (period) where.push(['period', '==', period]);
  return store.read('payroll_runs', { where: where.length ? where : undefined, orderBy: ['period', 'desc'], limit });
}

/** كشف مستحقات موظف (المسار الشخصي للموظف) */
export async function myPayrollSummary(store, employeeId) {
  const snap = await store.get(store.ref('employees', employeeId));
  if (!snap.exists) throw errors.notFound('الموظف');
  const emp = snap.data;
  const runs = await store.read('payroll_runs', { where: [['status', 'in', ['approved', 'paid']]], orderBy: ['period', 'desc'], limit: 24 });
  const myRuns = runs
    .map((r) => ({ period: r.period, status: r.status, date: r.date, mine: r.lines.find((l) => l.employeeId === employeeId) || null }))
    .filter((r) => r.mine);
  return {
    employee: {
      id: emp.id, code: emp.code, name: emp.name, position: emp.position,
      salaryBasicPiasters: emp.salaryBasicPiasters, allowancesPiasters: emp.allowancesPiasters,
    },
    advancesOutstandingPiasters: emp.advancesOutstandingPiasters || 0,
    salariesPayablePiasters: emp.salariesPayablePiasters || 0,
    payrollHistory: myRuns,
  };
}
