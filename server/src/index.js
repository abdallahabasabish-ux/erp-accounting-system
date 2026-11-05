/**
 * نقطة إقلاع الخادم.
 * الاستخدام:
 *   npm start          → تشغيل API
 *   MODE=demo npm start → وضع تجربة ببيانات جاهزة
 */
import { config, assertProductionConfig } from './config.js';
import { createStore } from './data/index.js';
import { buildApp } from './app.js';
import { bootstrapStore } from './seed.js';

async function main() {
  assertProductionConfig();
  console.log(`◆ وضع التشغيل: ${config.mode}`);
  const store = await createStore();
  console.log(`◆ المخزن: ${store.mode === 'demo' ? 'ذاكرة (تجربة)' : `Firestore (${config.firebase.projectId})`}`);

  const boot = await bootstrapStore(store);
  if (boot.coa.seeded) console.log(`◆ شجرة الحسابات: زُرعت ${boot.coa.count} حساباً`);
  if (boot.users.seeded) console.log(`◆ مستخدمون تجريبيون: ${boot.users.users.join('، ')} (كلمة المرور: ${config.demo.password})`);
  if (boot.demo.seeded) console.log('◆ بيانات تجريبية: زُرعت عبر الخدمات الحقيقية (قيود مزدوجة فعلية)');

  const app = buildApp(store);
  app.listen(config.port, () => {
    console.log(`◆ الخادم يعمل على المنفذ ${config.port} — /api/health للفحص`);
  });
}

main().catch((err) => {
  console.error('فشل الإقلاع:', err);
  process.exit(1);
});
