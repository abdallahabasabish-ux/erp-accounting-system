/**
 * اختبارات وحدة النقود — الدقة المالية غير القابلة للتفاوض.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  toPiasters, toEGP, formatEGP, computeVat, distribute, assertNonNegative,
} from '../src/lib/money.js';

test('toPiasters: تحويل نص عشري إلى قروش', () => {
  assert.equal(toPiasters('1250.75'), 125075);
  assert.equal(toPiasters('1250'), 125000);
  assert.equal(toPiasters(1250.75), 125075);
  assert.equal(toPiasters('1,250.75'), 125075);
  assert.equal(toPiasters('0.01'), 1);
  assert.equal(toPiasters('٠٫٥'.replace('٫', '.')), 50); // أرقام عربية
});

test('toPiasters: يرفض خانة عشرية ثالثة (لا قروش مجزأة)', () => {
  assert.throws(() => toPiasters('10.125'), /خانتين عشريتين/);
});

test('toPiasters: يرفض الصيغ غير الصالحة', () => {
  assert.throws(() => toPiasters('abc'));
  assert.throws(() => toPiasters(''));
  assert.throws(() => toPiasters('1.2.3'));
});

test('toEGP/formatEGP: العرض بالعكس الصحيح', () => {
  assert.equal(toEGP(125075), '1250.75');
  assert.equal(toEGP(-5000), '-50.00');
  assert.equal(formatEGP(123456789), '1,234,567.89 ج.م');
});

test('computeVat: ضريبة 14% بتقريب نصف-لأعلى بدون float', () => {
  // 5500 ج.م × 14% = 770 ج.م بالضبط
  assert.deepEqual(computeVat(550000, 14), { vat: 77000, total: 627000 });
  // 100.01 ج.م × 14% = 14.0014 ج.م = 1400.14 قرش → تُقرّب 1400
  assert.equal(computeVat(10001, 14).vat, 1400);
  // 100.03 ج.م × 14% = 14.0042 → تُقرّب 14.00
  assert.equal(computeVat(10003, 14).vat, 1400);
  // نصف قرش يقرّب لأعلى: 0.25 ج.م × 14% = 0.035 → 4 قروش (0.04)
  assert.equal(computeVat(25, 14).vat, 4);
  assert.equal(computeVat(0, 14).vat, 0);
});

test('distribute: توزيع بأكبر باقٍ — مجموع القطع = الأصل تماماً', () => {
  // 100 ج.م على 3 أطراف متساوية → 3333+3333+3334 = 10000
  const parts = distribute(10000, [1, 1, 1]);
  assert.equal(parts.reduce((a, b) => a + b, 0), 10000);
  assert.deepEqual(parts.sort((a, b) => b - a), [3334, 3333, 3333]);
  // توزيع غير متساوٍ
  const parts2 = distribute(1000, [1, 2]);
  assert.equal(parts2.reduce((a, b) => a + b, 0), 1000);
});

test('assertNonNegative: يرفض السالب', () => {
  assert.throws(() => assertNonNegative(-1));
  assert.equal(assertNonNegative(0), 0);
});
