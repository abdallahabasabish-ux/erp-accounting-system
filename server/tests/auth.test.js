/**
 * اختبارات المصادقة والصلاحيات — قفل إصلاح توقيع الرموز التجريبي ومنع الانحدار.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStore } from '../src/data/memory-adapter.js';
import { seedChartOfAccounts, seedDemoUsers } from '../src/seed.js';
import { demoLogin, resolveUser, roleHasPermission } from '../src/services/auth-service.js';
import { config } from '../src/config.js';

async function freshStore() {
  const store = createMemoryStore();
  await seedChartOfAccounts(store);
  await seedDemoUsers(store);
  return store;
}

test('دخول تجريبي ثم فحص الرمز: جولة كاملة ناجحة (يمنع انحدار توقيع HMAC)', async () => {
  // تأكد أننا في وضع demo للاختبار
  assert.equal(config.mode, 'demo');
  const store = await freshStore();
  const { token, user } = await demoLogin(store, { email: 'accountant@demo.eg', password: 'demo1234' });
  assert.ok(token.startsWith('demo.'));
  assert.equal(user.role, 'accountant');
  // الرمز الصحيح يُقبل
  const resolved = await resolveUser(store, `Bearer ${token}`);
  assert.equal(resolved.email, 'accountant@demo.eg');
  assert.equal(resolved.role, 'accountant');
  // تلاعب بحرف واحد في التوقيع → رفض
  const tampered = token.slice(0, -2) + (token.endsWith('AA') ? 'BB' : 'AA');
  await assert.rejects(() => resolveUser(store, `Bearer ${tampered}`), (e) => e.code === 'UNAUTHENTICATED');
});

test('كلمة مرور خاطئة ومستخدم معطّل يُرفضان', async () => {
  const store = await freshStore();
  await assert.rejects(
    () => demoLogin(store, { email: 'admin@demo.eg', password: 'wrong' }),
    (e) => e.code === 'UNAUTHENTICATED',
  );
  // تعطيل ثم محاولة دخول
  await store.runTransaction(async (tx) => {
    tx.update(store.ref('users', 'demo-accountant'), { disabled: true });
  });
  await assert.rejects(
    () => demoLogin(store, { email: 'accountant@demo.eg', password: 'demo1234' }),
    (e) => e.code === 'FORBIDDEN',
  );
  // حتى برمز صحيح سابق: فحص disabled في كل طلب
  const { token } = await demoLogin(store, { email: 'manager@demo.eg', password: 'demo1234' });
  const ok = await resolveUser(store, `Bearer ${token}`);
  assert.equal(ok.role, 'manager');
});

test('خريطة الصلاحيات: المحاسب لا يعتمد مدفوعات والمدير يفعل', () => {
  const acc = { role: 'accountant', permissions: null };
  const mgr = { role: 'manager', permissions: null };
  const admin = { role: 'admin', permissions: ['*'] };
  assert.equal(roleHasPermission(acc, 'invoices:create'), true);
  assert.equal(roleHasPermission(acc, 'payments:approve'), false);
  assert.equal(roleHasPermission(mgr, 'payments:approve'), true);
  assert.equal(roleHasPermission(mgr, 'users:manage'), false);
  assert.equal(roleHasPermission(admin, 'users:manage'), true);
});
