/**
 * إعدادات الشركة المالية — مستند واحد settings/main يُقرأ في كل العمليات الحسابية.
 */
import { nowISO } from '../lib/dates.js';
import { config } from '../config.js';

export async function getSettings(store) {
  const snap = await store.get(store.ref('settings', 'main'));
  if (snap.exists) return snap.data;
  // تهيئة أولى بقيم الافتراضية
  const defaults = {
    id: 'main',
    companyName: 'شركة الأعمال',
    currency: config.finance.currency,
    currencySymbol: config.finance.currencySymbol,
    minorUnit: config.finance.minorUnit,
    vatRate: config.finance.defaultVatRate,
    defaultCreditDays: config.finance.defaultCreditDays,
    advanceCapPercent: config.finance.defaultAdvanceCapPercent,
    timezone: config.finance.timezone,
    updatedAt: nowISO(),
  };
  await store.runTransaction((tx) => tx.set(store.ref('settings', 'main'), defaults));
  return defaults;
}

export async function updateSettings(store, actor, patch) {
  const allowed = ['companyName', 'vatRate', 'defaultCreditDays', 'advanceCapPercent', 'timezone'];
  const clean = {};
  for (const k of allowed) if (patch[k] !== undefined) clean[k] = patch[k];
  if (Object.keys(clean).length === 0) throw new Error('لا توجد حقول صالحة للتحديث');
  return store.runTransaction(async (tx) => {
    const current = await getSettings(store);
    const next = { ...current, ...clean, updatedAt: nowISO(), updatedBy: actor.email };
    tx.set(store.ref('settings', 'main'), next);
    return next;
  });
}
