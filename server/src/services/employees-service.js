/**
 * موديول الموظفين والسلف (Employees & Advances Ledger).
 * لكل موظف حسابان فرعيان في شجرة الحسابات:
 *   1140-Exxxx = سلف الموظفين (أصل — ما على الموظف من سلف)
 *   2120-Exxxx = الرواتب المستحقة (التزام — ما المستحق للموظف)
 */
import { toPiasters, assertPositive, assertNonNegative } from '../lib/money.js';
import { nowISO } from '../lib/dates.js';
import { errors } from '../lib/errors.js';
import { getOrCreateSubAccount, postJournalEntryTx } from '../core/journal.js';
import { allocateEntityCode, allocateNumber } from '../core/sequence.js';
import { assertPeriodOpenForDate } from '../core/periods.js';
import { assertValidDate } from './customers-service.js';
import { writeAuditTx } from './audit-service.js';
import { getSettings } from './settings-service.js';

/** إنشاء موظف — مع حسابيه الفرعيين */
export async function createEmployee(store, actor, input) {
  const name = String(input.name || '').trim();
  if (name.length < 2) throw errors.badRequest('اسم الموظف مطلوب');
  const basic = assertNonNegative(toPiasters(input.salaryBasic ?? 0), 'الراتب الأساسي');
  const allowances = assertNonNegative(toPiasters(input.allowances ?? 0), 'البدلات');

  return store.runTransaction(async (tx) => {
    const code = await allocateEntityCode(tx, store, 'employee', 'E');
    const id = store.newId();
    const employee = {
      id, code, name,
      position: input.position || '', phone: input.phone || '', email: input.email || '',
      salaryBasicPiasters: basic,
      allowancesPiasters: allowances,
      insuranceEmployeePiasters: assertNonNegative(toPiasters(input.insuranceEmployee ?? 0), 'التأمينات'),
      payrollTaxPiasters: assertNonNegative(toPiasters(input.payrollTax ?? 0), 'ضريبة كسب العمل'),
      commissionPercent: Number(input.commissionPercent ?? 0) || 0,
      status: ['active', 'inactive', 'on_leave'].includes(input.status) ? input.status : 'active',
      hireDate: input.hireDate || nowISO().slice(0, 10),
      uid: input.uid || null,
      advancesOutstandingPiasters: 0, // ذاكرة قراءة — المصدر حساب 1140-Exxxx
      salariesPayablePiasters: 0,     // ذاكرة قراءة — المصدر حساب 2120-Exxxx
      createdBy: { uid: actor.uid, email: actor.email },
      createdAt: nowISO(), updatedAt: nowISO(),
    };
    tx.set(store.ref('employees', id), employee);
    const adv = await getOrCreateSubAccount(tx, store, {
      control: '1140', suffix: code, name: `سلفة موظف: ${name}`, meta: { employeeId: id },
    });
    const pay = await getOrCreateSubAccount(tx, store, {
      control: '2120', suffix: code, name: `راتب مستحق: ${name}`, meta: { employeeId: id },
    });
    employee.advanceAccountCode = adv.code;
    employee.payableAccountCode = pay.code;
    tx.update(store.ref('employees', id), { advanceAccountCode: adv.code, payableAccountCode: pay.code });
    await writeAuditTx(tx, store, {
      actor, action: 'employee.create', entity: 'employees', entityId: id,
      summary: `إضافة موظف ${name} (${code}) بحسابي سلفة ومستحقات ${adv.code}/${pay.code}`,
    });
    return employee;
  });
}

/** تحديث بيانات موظف */
export async function updateEmployee(store, actor, employeeId, patch) {
  return store.runTransaction(async (tx) => {
    const ref = store.ref('employees', employeeId);
    const snap = await tx.get(ref);
    if (!snap.exists) throw errors.notFound('الموظف');
    const next = { updatedAt: nowISO(), updatedBy: actor.email };
    for (const k of ['name', 'position', 'phone', 'email']) {
      if (patch[k] !== undefined) next[k] = String(patch[k]).trim();
    }
    if (patch.salaryBasic !== undefined) next.salaryBasicPiasters = assertNonNegative(toPiasters(patch.salaryBasic), 'الراتب الأساسي');
    if (patch.allowances !== undefined) next.allowancesPiasters = assertNonNegative(toPiasters(patch.allowances), 'البدلات');
    if (patch.insuranceEmployee !== undefined) next.insuranceEmployeePiasters = assertNonNegative(toPiasters(patch.insuranceEmployee), 'التأمينات');
    if (patch.payrollTax !== undefined) next.payrollTaxPiasters = assertNonNegative(toPiasters(patch.payrollTax), 'ضريبة كسب العمل');
    if (patch.status !== undefined && ['active', 'inactive', 'on_leave'].includes(patch.status)) next.status = patch.status;
    tx.update(ref, next);
    await writeAuditTx(tx, store, {
      actor, action: 'employee.update', entity: 'employees', entityId: employeeId,
      summary: `تحديث بيانات الموظف ${snap.data.name}`,
    });
    return { ...snap.data, ...next };
  });
}

/** قائمة الموظفين */
export async function listEmployees(store, { activeOnly = false, limit = 500 } = {}) {
  const where = activeOnly ? [['status', '==', 'active']] : [];
  return store.read('employees', { where, orderBy: ['code', 'asc'], limit });
}

/**
 * منح سلفة لموظف — قيد: مدين سلفة الموظف | دائن الخزينة.
 * سقف السلفة: لا تتجاوز نسبة مئوية من الراتب الأساسي (من الإعدادات، افتراضي 50%) + السلف القائمة.
 */
export async function grantAdvance(store, actor, input) {
  const date = assertValidDate(input.date || nowISO().slice(0, 10), 'تاريخ السلفة');
  const amount = assertPositive(toPiasters(input.amount), 'مبلغ السلفة');

  return store.runTransaction(async (tx) => {
    const empSnap = await tx.get(store.ref('employees', input.employeeId));
    if (!empSnap.exists) throw errors.notFound('الموظف');
    const employee = empSnap.data;
    if (employee.status !== 'active') throw errors.badRequest('السلفة للموظفين النشطين فقط');

    const settings = await getSettings(store);
    const cap = (employee.salaryBasicPiasters || 0) * ((settings.advanceCapPercent ?? 50) / 100);
    const outstanding = employee.advancesOutstandingPiasters || 0;
    if (outstanding + amount > cap) {
      throw errors.conflict(
        'ADVANCE_CAP_EXCEEDED',
        `تجاوز سقف السلفة: القائم ${(outstanding / 100).toFixed(2)} + المطلوب ${(amount / 100).toFixed(2)} يتجاوز الحد ${(cap / 100).toFixed(2)} ج.م (${settings.advanceCapPercent}% من الأساسي)`,
        { outstanding, amount, cap },
      );
    }

    const tSnap = await tx.get(store.ref('treasury_accounts', input.treasuryAccountId));
    if (!tSnap.exists) throw errors.notFound('الخزينة');
    const treasury = tSnap.data;

    // كفاية الرصيد
    const balSnap = await tx.get(store.ref('account_balances', treasury.accountCode));
    const available = balSnap.exists ? (balSnap.data.totalDebit || 0) - (balSnap.data.totalCredit || 0) : 0;
    if (available - amount < 0) throw errors.insufficientFunds(treasury.name, available, amount);

    await assertPeriodOpenForDate(tx, store, date);
    const { number, docId } = await allocateNumber(tx, store, 'advance', date);
    const { entry } = await postJournalEntryTx(tx, store, {
      date,
      memo: `سلفة ${number} للموظف ${employee.name}${input.memo ? ` — ${input.memo}` : ''}`,
      lines: [
        { accountCode: employee.advanceAccountCode, debit: amount, credit: 0, note: 'منح سلفة', party: { kind: 'employee', id: employee.id, name: employee.name } },
        { accountCode: treasury.accountCode, debit: 0, credit: amount, note: `صرف سلفة من ${treasury.name}` },
      ],
      actor,
      sourceRef: { module: 'advances', docId, number },
      idempotencyKey: input.idempotencyKey ? `advance:${input.idempotencyKey}` : null,
    });

    const doc = {
      id: docId, number, date, employeeId: employee.id, employeeCode: employee.code, employeeName: employee.name,
      advanceAccountCode: employee.advanceAccountCode, treasuryAccountId: treasury.id,
      amount, memo: input.memo || '',
      journalEntryId: entry.id,
      createdBy: { uid: actor.uid, email: actor.email },
      createdAt: nowISO(),
    };
    tx.set(store.ref('advances', docId), doc);
    tx.update(store.ref('employees', employee.id), {
      advancesOutstandingPiasters: outstanding + amount,
      updatedAt: nowISO(),
    });
    await writeAuditTx(tx, store, {
      actor, action: 'employee.advance', entity: 'advances', entityId: docId,
      summary: `منح سلفة ${(amount / 100).toFixed(2)} ج.م للموظف ${employee.name}`,
    });
    return { advance: doc, journalEntry: entry };
  });
}

/**
 * استحقاق عمولة/تعويض مهمة منفذة — قيد: مدين تكلفة الخدمات (5050) | دائن مستحقات الموظف (2120-Exxxx).
 * هذا هو المحل المحاسبي الصحيح لما كان مجموعة employeeLedger في النظام القديم.
 */
export async function accrueCommission(store, actor, input) {
  const date = assertValidDate(input.date || nowISO().slice(0, 10), 'تاريخ الاستحقاق');
  const amount = assertPositive(toPiasters(input.amount), 'مبلغ التعويض');
  return store.runTransaction(async (tx) => {
    const empSnap = await tx.get(store.ref('employees', input.employeeId));
    if (!empSnap.exists) throw errors.notFound('الموظف');
    const employee = empSnap.data;
    await assertPeriodOpenForDate(tx, store, date);
    const memo = `استحقاق تعويض للموظف ${employee.name}${input.memo ? ` — ${input.memo}` : ''}`;
    const { entry } = await postJournalEntryTx(tx, store, {
      date, memo,
      lines: [
        { accountCode: '5050', debit: amount, credit: 0, note: 'تكلفة خدمات مباشرة', party: { kind: 'employee', id: employee.id, name: employee.name } },
        { accountCode: employee.payableAccountCode, debit: 0, credit: amount, note: 'مستحق للموظف', party: { kind: 'employee', id: employee.id, name: employee.name } },
      ],
      actor,
      sourceRef: input.taskRef ? { module: 'tasks', docId: input.taskRef.taskId || null, number: input.taskRef.taskNumber || null } : null,
      idempotencyKey: input.idempotencyKey ? `commission:${input.idempotencyKey}` : null,
    });
    tx.update(store.ref('employees', employee.id), {
      salariesPayablePiasters: (employee.salariesPayablePiasters || 0) + amount,
      updatedAt: nowISO(),
    });
    await writeAuditTx(tx, store, {
      actor, action: 'employee.commission_accrual', entity: 'journal_entries', entityId: entry.id,
      summary: `استحقاق تعويض ${(amount / 100).toFixed(2)} ج.م للموظف ${employee.name}`,
    });
    return { journalEntry: entry };
  });
}
