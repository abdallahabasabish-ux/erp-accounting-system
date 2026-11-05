/**
 * موديول المصروفات (Expenses) — كل مصروف = سند مصروف يُرحِّل قيداً مزدوجاً فوراً:
 *   نقداً: مدين حساب المصروف (5xxx) | دائن الخزينة/البنك — مع فحص عدم الكشف
 *   آجلاً (على مورد): مدين حساب المصروف | دائن ذمم الموردين (2110-Sxxxx)
 * الفئات التسع من النظام القديم مُوَرَّثة ومُربوطة بحسابات الشجرة (LEGACY_EXPENSE_CATEGORY_MAP).
 */
import { toPiasters, assertPositive } from '../lib/money.js';
import { nowISO } from '../lib/dates.js';
import { errors } from '../lib/errors.js';
import { postJournalEntryTx, getOrCreateSubAccount } from '../core/journal.js';
import { allocateNumber, allocateEntityCode } from '../core/sequence.js';
import { assertPeriodOpenForDate } from '../core/periods.js';
import { LEGACY_EXPENSE_CATEGORY_MAP } from '../core/coa.js';
import { assertValidDate } from './customers-service.js';
import { writeAuditTx } from './audit-service.js';

/** حل حساب المصروف من فئة قديمة أو رمز مباشر — يتم داخل المعاملة أدناه */

export async function createExpenseVoucher(store, actor, input) {
  const date = assertValidDate(input.date || nowISO().slice(0, 10), 'تاريخ المصروف');
  const amount = assertPositive(toPiasters(input.amount), 'مبلغ المصروف');
  const memo = String(input.memo || '').trim();
  if (memo.length < 3) throw errors.badRequest('بيان المصروف مطلوب');

  return store.runTransaction(async (tx) => {
    // 1) حساب المصروف: رمز مباشر أو فئة موروثة
    let expenseCode = input.expenseAccountCode || LEGACY_EXPENSE_CATEGORY_MAP[input.category];
    if (!expenseCode) {
      throw errors.badRequest(`فئة غير معروفة: ${input.category} — الفئات المقبولة: ${Object.keys(LEGACY_EXPENSE_CATEGORY_MAP).join(', ')}`);
    }
    const accSnap = await tx.get(store.ref('accounts', expenseCode));
    if (!accSnap.exists) throw errors.invalidAccount(expenseCode, 'حساب المصروف غير موجود');
    if (accSnap.data.kind !== 'posting' || !expenseCode.startsWith('5')) {
      throw errors.invalidAccount(expenseCode, 'يجب أن يكون حساب مصروف ترحيلي (5xxx)');
    }

    // 2) طرف الدائن: نقد (خزينة) أو مورد (ذمة)
    let creditLine;
    let creditLabel;
    if (input.paymentMethod === 'credit' || input.supplierName) {
      const supplierName = String(input.supplierName || '').trim();
      if (!supplierName) throw errors.badRequest('اسم المورد مطلوب للشراء الآجل');
      // حساب فرعي للمورد تحت 2110
      const existing = await store.read('suppliers', { where: [['name', '==', supplierName]], limit: 1 });
      let supplier = existing[0];
      let supplierCode;
      if (supplier) {
        supplierCode = supplier.code;
      } else {
        const code = await allocateEntityCode(tx, store, 'supplier', 'S');
        const id = store.newId();
        supplier = { id, code, name: supplierName, createdAt: nowISO() };
        tx.set(store.ref('suppliers', id), supplier);
        supplierCode = code;
      }
      const sub = await getOrCreateSubAccount(tx, store, {
        control: '2110', suffix: supplierCode, name: `ذمة مورد: ${supplier.name}`, meta: { supplierId: supplier.id },
      });
      creditLine = { accountCode: sub.code, debit: 0, credit: amount, note: 'شراء آجل من المورد' };
      creditLabel = `المورد ${supplier.name}`;
    } else {
      if (!input.treasuryAccountId) throw errors.badRequest('حدد خزينة الدفع treasuryAccountId أو جهّز المصروف على مورد');
      const tSnap = await tx.get(store.ref('treasury_accounts', input.treasuryAccountId));
      if (!tSnap.exists) throw errors.notFound('الخزينة/البنك');
      const treasury = tSnap.data;
      // منع الكشف عند الدفع النقدي
      const balSnap = await tx.get(store.ref('account_balances', treasury.accountCode));
      const available = balSnap.exists ? (balSnap.data.totalDebit || 0) - (balSnap.data.totalCredit || 0) : 0;
      if (available - amount < 0) throw errors.insufficientFunds(treasury.name, available, amount);
      creditLine = { accountCode: treasury.accountCode, debit: 0, credit: amount, note: `دفع من ${treasury.name}` };
      creditLabel = treasury.name;
    }

    await assertPeriodOpenForDate(tx, store, date);
    const { number, docId } = await allocateNumber(tx, store, 'expense', date);
    const { entry } = await postJournalEntryTx(tx, store, {
      date,
      memo: `سند مصروف ${number} — ${memo}`,
      lines: [
        { accountCode: expenseCode, debit: amount, credit: 0, note: memo },
        creditLine,
      ],
      actor,
      sourceRef: { module: 'expenses', docId, number },
      idempotencyKey: input.idempotencyKey ? `expense:${input.idempotencyKey}` : null,
    });

    const doc = {
      id: docId, number, date, amount, memo,
      expenseAccountCode: expenseCode, expenseAccountName: accSnap.data.name,
      category: input.category || null,
      creditLabel,
      treasuryAccountId: input.treasuryAccountId || null,
      supplierName: input.supplierName || null,
      paymentMethod: input.paymentMethod || (input.supplierName ? 'credit' : 'cash'),
      journalEntryId: entry.id,
      createdBy: { uid: actor.uid, email: actor.email },
      createdAt: nowISO(),
    };
    tx.set(store.ref('expenses', docId), doc);
    await writeAuditTx(tx, store, {
      actor, action: 'expense.create', entity: 'expenses', entityId: docId,
      summary: `مصروف ${(amount / 100).toFixed(2)} ج.م على ${accSnap.data.name} (${creditLabel})`,
    });
    return { expense: doc, journalEntry: entry };
  });
}

/** قائمة المصروفات */
export async function listExpenses(store, { from, to, category, limit = 200 } = {}) {
  const where = [];
  if (category) where.push(['category', '==', category]);
  if (from) where.push(['date', '>=', from]);
  if (to) where.push(['date', '<=', to]);
  return store.read('expenses', { where: where.length ? where : undefined, orderBy: ['date', 'desc'], limit });
}
