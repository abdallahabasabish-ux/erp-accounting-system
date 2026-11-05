/**
 * مصنع المخزن — يختار المهايئ حسب وضع التشغيل.
 * الوحدات العليا (الخدمات/المحرك المحاسبي) لا تعرف شيئاً عن Firestore أو الذاكرة —
 * هذا هو الفصل الذي يجعل المنطق المالي قابلاً للاختبار 100% بدون سحابة.
 */
import { config } from '../config.js';
import { createMemoryStore } from './memory-adapter.js';

export async function createStore() {
  if (config.mode === 'production') {
    const { createFirestoreStore } = await import('./firestore-adapter.js');
    return createFirestoreStore(config.firebase.collectionPrefix || '');
  }
  return createMemoryStore(config.firebase.collectionPrefix || '');
}
