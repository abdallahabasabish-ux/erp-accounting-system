/**
 * موديول الخزائن والبنوك (Cash & Treasury Management).
 *
 * إصلاحات جذرية:
 * 1) رصيد كل خزينة/بنك = رصيد حسابه الفرعي في دفتر الأستاذ — لا حقول رصيد يدوية،
 *    ولا معادلة خاطئة تجعل التحويل يزيد الرصيد (خطأ موثق في النظام القديم).
 * 2) التحويل بين خزينتين = قيد واحد بطرفين نقديين — صافي أثره صفر على الإجمالي.
 * 3) منع السحب المكشوف يُفحص داخل المعاملة (قراءة رصيد متسقة)، لا من نص DOM.
 * 4) التسوية البنكية وثيقة موثقة بالمطابقة والفرق والمعاملات المعلقة.
 */
import { toPiasters, assertPositive, assertNonNegative } from '../lib/money.js';
import { nowISO } from '../lib/dates.js';
import { errors } from '../lib/errors.js';
import { getOrCreateSubAccount, postJournalEntryTx } from '../core/journal.js';
import { allocateNumber } from '../core/sequence.js';
import { assertPeriodOpenForDate } from '../core/periods.js';
import { assertValidDate } from './customers-service.js';
import { writeAuditTx } from './audit-service.js';

/** إنشاء خزينة/حساب بنكي جديد مع حسابه الفرعي (1110-Txx نقدي / 1115-Bxx بنكي) */
export async function createTreasuryAccount(store, actor, input) {
  const name = String(input.name || '').trim();
  if (name.length < 2) throw errors.badRequest('اسم الخزينة/البنك مطلوب');
  const type = input.type === 'bank' ? 'bank' : 'cash';
  const opening = input.openingBalance !== undefined ? assertNonNegative(toPiasters(input.openingBalance), 'الرصيد الافتتاحي') : 0;
  const date = assertValidDate(input.date || nowISO().slice(0, 10), 'تاريخ الافتتاح');

  return store.runTransaction(async (tx) => {
    const code = await allocateNumber(tx, store, type === 'bank' ? 'bank' : 'treasury', date);
    const suffix = type === 'bank' ? `B${String(code.seq).padStart(2, '0')}` : `T${String(code.seq).padStart(2, '0')}`;
    const control = type === 'bank' ? '1115' : '1110';
    const { code: subCode } = await getOrCreateSubAccount(tx, store, {
      control, suffix, name: `${type === 'bank' ? 'بنك' : 'خزينة'}: ${name}`,
      meta: { kind: 'treasury', treasuryType: type },
    });
    const id = store.newId();
    const doc = {
      id, code: subCode, name, type,
      accountCode: subCode,
      bankName: input.bankName || null,
      accountNumberMasked: input.accountNumber ? `****${String(input.accountNumber).slice(-4)}` : null,
      active: true,
      createdBy: { uid: actor.uid, email: actor.email },
      createdAt: nowISO(), updatedAt: nowISO(),
    };
    tx.set(store.ref('treasury_accounts', id), doc);

    // رصيد افتتاحي اختياري: مدين النقد | دائن رأس المال (3100)
    if (opening > 0) {
      await assertPeriodOpenForDate(tx, store, date);
      const { number } = await allocateNumber(tx, store, 'journal', date);
      await postJournalEntryTx(tx, store, {
        date,
        memo: `رصيد افتتاحي لـ${type === 'bank' ? 'بنك' : 'خزينة'} ${name}`,
        lines: [
          { accountCode: subCode, debit: opening, credit: 0, note: 'رصيد افتتاحي' },
          { accountCode: '3100', debit: 0, credit: opening, note: 'رصيد افتتاحي' },
        ],
        actor,
        type: 'opening',
        sourceRef: { module: 'treasury_accounts', docId: id, number },
      });
    }
    await writeAuditTx(tx, store, {
      actor, action: 'treasury.create', entity: 'treasury_accounts', entityId: id,
      summary: `إنشاء ${type === 'bank' ? 'حساب بنكي' : 'خزينة'} «${name}» بالحساب ${subCode}`,
    });
    return doc;
  });
}

/** قائمة الخزائن مع أرصدها الحالية (من سجل الأرصدة) */
export async function listTreasuryAccounts(store) {
  const accounts = await store.read('treasury_accounts', { orderBy: ['createdAt', 'asc'], limit: 100 });
  const balances = await store.read('account_balances', {});
  const balByCode = new Map(balances.map((b) => [b.code, b]));
  return accounts.map((t) => {
    const b = balByCode.get(t.accountCode);
    const balance = b ? (b.totalDebit || 0) - (b.totalCredit || 0) : 0;
    return { ...t, balancePiasters: balance };
  });
}

/**
 * سند صرف من خزينة إلى حساب مقابل (مصروف/سلفة/رأس مال/أي حساب ترحيلي).
 * الفحص الحرج: لا سحب مكشوف — الرصيد يُقرأ داخل المعاملة.
 * @param input {treasuryAccountId, counterAccountCode, amount(EGP), date, memo}
 */
export async function createDisbursement(store, actor, input) {
  const date = assertValidDate(input.date || nowISO().slice(0, 10), 'تاريخ السند');
  const amount = assertPositive(toPiasters(input.amount), 'مبلغ الصرف');
  const memo = String(input.memo || '').trim();
  if (memo.length < 3) throw errors.badRequest('بيان الصرف مطلوب');

  return store.runTransaction(async (tx) => {
    const tSnap = await tx.get(store.ref('treasury_accounts', input.treasuryAccountId));
    if (!tSnap.exists) throw errors.notFound('الخزينة/البنك');
    const treasury = tSnap.data;

    const counterSnap = await tx.get(store.ref('accounts', input.counterAccountCode));
    if (!counterSnap.exists) throw errors.invalidAccount(input.counterAccountCode, 'الحساب المقابل غير موجود');
    if (counterSnap.data.kind !== 'posting') throw errors.invalidAccount(input.counterAccountCode, 'حساب تجميعي');
    if (counterSnap.data.code === treasury.accountCode) throw errors.badRequest('الحساب المقابل لا يكون نفس الخزينة');

    await assertPeriodOpenForDate(tx, store, date);

    // منع السحب المكشوف — رصيد متسق داخل المعاملة
    const balSnap = await tx.get(store.ref('account_balances', treasury.accountCode));
    const available = balSnap.exists ? (balSnap.data.totalDebit || 0) - (balSnap.data.totalCredit || 0) : 0;
    if (available - amount < 0) {
      throw errors.insufficientFunds(treasury.name, available, amount);
    }

    const { number, docId } = await allocateNumber(tx, store, 'voucher', date);
    const { entry } = await postJournalEntryTx(tx, store, {
      date,
      memo: `سند صرف ${number} من ${treasury.name} — ${memo}`,
      lines: [
        { accountCode: counterSnap.data.code, debit: amount, credit: 0, note: memo },
        { accountCode: treasury.accountCode, debit: 0, credit: amount, note: `صرف من ${treasury.name}` },
      ],
      actor,
      sourceRef: { module: 'vouchers', docId, number },
      idempotencyKey: input.idempotencyKey ? `voucher:${input.idempotencyKey}` : null,
    });

    const doc = {
      id: docId, number, date, type: 'disbursement',
      treasuryAccountId: treasury.id, treasuryAccountCode: treasury.accountCode, treasuryAccountName: treasury.name,
      counterAccountCode: counterSnap.data.code, counterAccountName: counterSnap.data.name,
      amount, memo,
      journalEntryId: entry.id,
      createdBy: { uid: actor.uid, email: actor.email },
      createdAt: nowISO(),
    };
    tx.set(store.ref('vouchers', docId), doc);
    await writeAuditTx(tx, store, {
      actor, action: 'treasury.disburse', entity: 'vouchers', entityId: docId,
      summary: `صرف ${(amount / 100).toFixed(2)} ج.م من ${treasury.name} إلى ${counterSnap.data.name}`,
    });
    return { voucher: doc, journalEntry: entry };
  });
}

/**
 * تحويل بين خزينتين — قيد واحد بطرفين نقديين (يصلح خطأ النظام القديم حيث
 * كان التحويل يُحسب تدفقاً موجباً يزيد الرصيد).
 * @param input {fromTreasuryAccountId, toTreasuryAccountId, amount(EGP), date, memo}
 */
export async function createTransfer(store, actor, input) {
  const date = assertValidDate(input.date || nowISO().slice(0, 10), 'تاريخ التحويل');
  const amount = assertPositive(toPiasters(input.amount), 'مبلغ التحويل');

  return store.runTransaction(async (tx) => {
    const fromSnap = await tx.get(store.ref('treasury_accounts', input.fromTreasuryAccountId));
    const toSnap = await tx.get(store.ref('treasury_accounts', input.toTreasuryAccountId));
    if (!fromSnap.exists || !toSnap.exists) throw errors.notFound('الخزينة المصدر/الهدف');
    const from = fromSnap.data;
    const to = toSnap.data;
    if (from.id === to.id) throw errors.badRequest('التحويل من نفس الخزينة إلى نفسها غير مفيد ومرفوض');

    await assertPeriodOpenForDate(tx, store, date);

    // كفاية الرصيد في المصدر
    const balSnap = await tx.get(store.ref('account_balances', from.accountCode));
    const available = balSnap.exists ? (balSnap.data.totalDebit || 0) - (balSnap.data.totalCredit || 0) : 0;
    if (available - amount < 0) throw errors.insufficientFunds(from.name, available, amount);

    const { number, docId } = await allocateNumber(tx, store, 'voucher', date);
    const { entry } = await postJournalEntryTx(tx, store, {
      date,
      memo: `تحويل ${number} من ${from.name} إلى ${to.name}${input.memo ? ` — ${input.memo}` : ''}`,
      lines: [
        { accountCode: to.accountCode, debit: amount, credit: 0, note: `استلام تحويل من ${from.name}` },
        { accountCode: from.accountCode, debit: 0, credit: amount, note: `تحويل إلى ${to.name}` },
      ],
      actor,
      sourceRef: { module: 'vouchers', docId, number },
      idempotencyKey: input.idempotencyKey ? `transfer:${input.idempotencyKey}` : null,
    });

    const doc = {
      id: docId, number, date, type: 'transfer',
      fromTreasuryAccountId: from.id, fromTreasuryAccountCode: from.accountCode, fromTreasuryAccountName: from.name,
      toTreasuryAccountId: to.id, toTreasuryAccountCode: to.accountCode, toTreasuryAccountName: to.name,
      amount, memo: input.memo || '',
      journalEntryId: entry.id,
      createdBy: { uid: actor.uid, email: actor.email },
      createdAt: nowISO(),
    };
    tx.set(store.ref('vouchers', docId), doc);
    await writeAuditTx(tx, store, {
      actor, action: 'treasury.transfer', entity: 'vouchers', entityId: docId,
      summary: `تحويل ${(amount / 100).toFixed(2)} ج.م من ${from.name} إلى ${to.name}`,
    });
    return { transfer: doc, journalEntry: entry };
  });
}

/** التسوية البنكية: حفظ مطابقة كشف بنكي مع دفتر النظام وتحديد الفروقات */
export async function saveBankReconciliation(store, actor, input) {
  const statementDate = assertValidDate(input.statementDate, 'تاريخ كشف الحساب');
  const statementBalance = toPiasters(input.statementBalance);

  return store.runTransaction(async (tx) => {
    const tSnap = await tx.get(store.ref('treasury_accounts', input.treasuryAccountId));
    if (!tSnap.exists) throw errors.notFound('الحساب البنكي');
    const bank = tSnap.data;

    // رصيد الدفاتر حتى تاريخ الكشف (من الأرصدة الحالية + قيود بعد التاريخ تُطرح)
    const entries = await store.read('journal_entries', {
      where: [['lines.accountCode', 'array-contains', bank.accountCode]], orderBy: ['date', 'asc'], limit: 2000,
    });
    let bookBalance = 0;
    const uncleared = [];
    const clearedSet = new Set(input.clearedEntryIds || []);
    for (const e of entries) {
      if (e.date > statementDate) continue;
      for (const line of e.lines) {
        if (line.accountCode !== bank.accountCode) continue;
        bookBalance += line.debit - line.credit;
      }
      if (!clearedSet.has(e.id)) uncleared.push({ entryId: e.id, number: e.number, date: e.date, memo: e.memo, amount: e.lines.find((l) => l.accountCode === bank.accountCode)?.debit - e.lines.find((l) => l.accountCode === bank.accountCode)?.credit });
    }
    const difference = statementBalance - bookBalance;

    const id = store.newId();
    const doc = {
      id, treasuryAccountId: bank.id, treasuryAccountCode: bank.accountCode, bankName: bank.name,
      statementDate, statementBalance, bookBalance, difference,
      clearedEntryIds: [...clearedSet],
      unclearedItems: uncleared,
      reconciled: difference === 0,
      createdBy: { uid: actor.uid, email: actor.email },
      createdAt: nowISO(),
    };
    tx.set(store.ref('bank_reconciliations', id), doc);
    await writeAuditTx(tx, store, {
      actor, action: 'treasury.reconcile', entity: 'bank_reconciliations', entityId: id,
      summary: `تسوية بنكية لـ${bank.name} بتاريخ ${statementDate} — الفرق ${(difference / 100).toFixed(2)} ج.م`,
    });
    return doc;
  });
}

/** قائمة التسويات البنكية */
export async function listReconciliations(store, { treasuryAccountId, limit = 50 } = {}) {
  const where = treasuryAccountId ? [['treasuryAccountId', '==', treasuryAccountId]] : [];
  return store.read('bank_reconciliations', { where: where.length ? where : undefined, orderBy: ['statementDate', 'desc'], limit });
}

/** حركات سندات الخزينة (سحب/تحويل) */
export async function listVouchers(store, { type, from, to, limit = 200 } = {}) {
  const where = [];
  if (type) where.push(['type', '==', type]);
  if (from) where.push(['date', '>=', from]);
  if (to) where.push(['date', '<=', to]);
  return store.read('vouchers', { where: where.length ? where : undefined, orderBy: ['date', 'desc'], limit });
}
