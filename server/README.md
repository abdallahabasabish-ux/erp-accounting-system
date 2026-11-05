# نظام الأعمال المحاسبي — الخادم (ERP Accounting Backend)

نظام محاسبي مؤسسي **مزدوج القيد (Double-Entry)** بمعايير IFRS، مبني على Express + Firebase Admin SDK (Firestore)، بالعربية بالكامل، وكل المبالغ أعداد صحيحة بالقروش (1 ج.م = 100 قرش) — لا float إطلاقاً.

## المبادئ غير القابلة للتفاوض (مُثبتة بالاختبارات — 25/25 ✔)

| المبدأ | التطبيق |
|---|---|
| القيد المزدوج | كل معاملة تولّد قيداً متوازناً في `journal_entries` — الرفض بنيوي لغير المتوازن |
| الذرية الكاملة | الفاتورة/السند + قيده + أرصدة الأطراف + التدقيق في **معاملة Firestore واحدة** (فشل أي خطوة = Rollback كامل) |
| عدم القابلية للتعديل | لا يوجد أي مسار UPDATE/DELETE للقيود المرحَّلة — التصحيح بقيد عكسي مرتبط (مع فهرس يمنع العكس المزدوج) |
| الفترات المالية | فترات شهرية auto-create، الإغلاق بمدير وسبب، إقفال سنوي يقفل فترات السنة نهائياً |
| دقة النقود | Integers بالقروش + تقريب نصف-أعلى للضريبة + توزيع «أكبر باقٍ» للخصومات |
| الترقيم الذري | عدادات على الخادم داخل المعاملة: `INV-2026-000001`... بلا تكرار أو فجوات |
| RBAC | 5 أدوار (admin/manager/accountant/employee/client) + 30 صلاحية + فحص disabled في كل طلب |
| التدقيق | `audit_logs` يُكتب داخل نفس معاملة العملية — لا عملية بلا أثر |

## التشغيل

```bash
cp .env.example .env        # عدّل القيم
npm install
npm test                    # 25 اختباراً للمحرك المحاسبي

# وضع تجربة (بدون Firebase): مستخدمون وبيانات جاهزة
MODE=demo npm start         # → http://localhost:4000/api/health

# الإنتاج (Firestore حقيقي)
MODE=production FIREBASE_PROJECT_ID=xxx FIREBASE_SERVICE_ACCOUNT_JSON='{...}' npm start
```

### المستخدمون التجريبيون (وضع demo)
| البريد | الدور |
|---|---|
| admin@demo.eg | مدير النظام (كل الصلاحيات) |
| manager@demo.eg | مدير مالي (اعتماد وإغلاق فترات) |
| accountant@demo.eg | محاسب (قيود وفواتير وسندات) |
| employee@demo.eg | موظف (مستحقاته فقط عبر /api/hr/me) |
| client@demo.eg | عميل (بوابة: فواتيره وسداده) |

كلمة المرور للجميع: `demo1234` — **وضع التجربة فقط**.

## بنية الكود

```
src/
├── index.js            نقطة الإقلاع
├── app.js              تركيب Express + معالج أخطاء موحد
├── config.js           الإعدادات من البيئة
├── lib/                النقود (money) + التواريخ/الفترات + أخطاء الأعمال
├── data/               طبقة المخزن: memory-adapter (تجربة/اختبار) + firestore-adapter (إنتاج) — واجهة واحدة
├── core/               المحرك المحاسبي:
│   ├── coa.js          شجرة الحسابات القياسية (1000→5600) + خريطة فئات القديم
│   ├── journal.js      محرك القيد المزدوج (postJournalEntryTx داخل معاملة المتصل)
│   ├── sequence.js     الترقيم الذري (فاتورة/قيد/سند/صرف)
│   ├── periods.js      الفترات + الإقفال الشهري والسنوي
│   └── reports.js      ميزان المراجعة، قائمة الدخل، الميزانية، التدفقات، دفتر الأستاذ، أعمار الذمم
├── services/           منطق الأعمال: عملاء/فواتير/قبض/خزينة/موظفون/رواتب/مصروفات/مستخدمون/تدقيق
├── routes/             طبقة REST (كل مسار محمي بصلاحية محددة)
└── seed.js             شجرة الحسابات (إلزامية) + بيانات تجريبية حقيقية عبر الخدمات
schemas/                JSON Schema (draft-07) لكل مجموعة + catalog.json لخريطة القاعدة
tests/                  25 اختباراً: توازن، عكس، إغلاق، حدود ائتمانية، كشف، رواتب، قوائم
```

## مرجع الـ API (مختصر — الكامل في توثيق كل ملف)

كل المسارات تحت `/api` وتتطلب `Authorization: Bearer <token>` ما عدا health/meta/auth.

| المسار | الطريقة | الوصف | الصلاحية |
|---|---|---|---|
| `/auth/login` | POST | دخول تجريبي (demo فقط) | عام |
| `/auth/session` | POST | التحقق من idToken (إنتاج) | عام |
| `/meta` | GET | وضع التشغيل والعملة والضريبة | عام |
| `/accounts` | GET/POST | شجرة الحسابات + إنشاء | accounts:view/manage |
| `/journal` | GET/POST | قائمة القيود + قيد يدوي | journal:view/create |
| `/journal/:id/reverse` | POST | قيد عكسي (سبب إلزامي) | journal:reverse |
| `/periods` | GET | قائمة الفترات | periods:view |
| `/periods/:key/close\|reopen` | POST | إغلاق/إعادة فتح (سبب) | periods:close |
| `/periods/year-end/:year/close` | POST | قيد إقفال سنة + قفل فتراتها | periods:close |
| `/reports/trial-balance` | GET | ميزان المراجعة (from/to) | reports:view |
| `/reports/profit-loss` | GET | قائمة الدخل | reports:view |
| `/reports/balance-sheet` | GET | الميزانية العمومية (asOf) | reports:view |
| `/reports/cash-flow` | GET | التدفقات النقدية | reports:view |
| `/reports/ledger/:accountCode` | GET | دفتر أستاذ حساب | reports:view |
| `/reports/aging` | GET | أعمار الذمم المدينة | reports:view |
| `/customers` | GET/POST/PATCH | العملاء + حدودهم | customers:view/manage |
| `/customers/:id/statement` | GET | كشف حساب من دفتر الأستاذ | customers:view |
| `/invoices` | GET/POST | فواتير بقيد تلقائي وVAT وحد ائتماني | invoices:view/create |
| `/invoices/:id/cancel` | POST | إلغاء بقيد عكسي | invoices:cancel |
| `/payments/receipts` | GET/POST | سندات قبض (تخصيص FIFO أو صريح) | payments:view/create |
| `/payments/requests` | GET | طلبات دفع البوابة | payments:view |
| `/payments/requests/:id/approve\|reject` | POST | اعتماد (يُرحِّل السند)/رفض | payments:approve |
| `/treasury/accounts` | GET/POST | خزائن وبنوك بأرصدة الدفاتر | treasury:view/manage |
| `/treasury/disbursements` | POST | صرف (فحص منع الكشف داخل المعاملة) | treasury:manage |
| `/treasury/transfers` | POST | تحويل بين خزينتين (قيد واحد) | treasury:manage |
| `/treasury/reconciliations` | GET/POST | التسوية البنكية | treasury:view/manage |
| `/hr/employees` | GET/POST/PATCH | الموظفون | employees:view/manage |
| `/hr/advances` | POST | منح سلفة (سقف % من الأساسي) | treasury:manage |
| `/hr/commissions` | POST | استحقاق تعويض (5050 | 2120-Ex) | journal:create |
| `/hr/payroll-runs` | GET/POST/DELETE | مسيرات الرواتب (مسودة/حذف مسودة) | payroll:view/run |
| `/hr/payroll-runs/:id/approve` | POST | ترحيل قيد الاستحقاق | payroll:approve |
| `/hr/payroll-runs/:id/disburse` | POST | قيد الصرف من خزينة | payroll:approve |
| `/hr/me` | GET | مسار الموظف الشخصي | دور employee |
| `/expenses` | GET/POST | مصروفات (فئة قديمة → حساب 5xxx) | expenses:view/create |
| `/users` | GET/POST/PATCH | إدارة المستخدمين | دور admin |
| `/audit` | GET | سجل التدقيق | admin/manager |
| `/settings` | GET/PATCH | إعدادات الشركة | - / admin+manager |
| `/portal/overview\|statement\|payments` | GET/POST | بوابة العميل (نطاقه فقط) | دور client |

**أكواد الأخطاء**: `UNBALANCED_ENTRY`, `PERIOD_LOCKED`, `INSUFFICIENT_FUNDS`, `CREDIT_LIMIT_EXCEEDED`, `ADVANCE_CAP_EXCEEDED`, `ALREADY_REVERSED`, `INVOICE_HAS_PAYMENTS`, `RUN_NOT_DRAFT`, `STALE_DOCUMENT`... كلها 422 برسالة عربية جاهزة للعرض.

## النشر على PaaS مجاني

### Render
1. ارفع مجلد `server/` إلى GitHub.
2. Render → **New → Blueprint** (سيقرأ `render.yaml`).
3. في Environment أضف:
   - `FIREBASE_PROJECT_ID` = معرف مشروعك
   - `FIREBASE_SERVICE_ACCOUNT_JSON` = محتوى `service-account.json` **في سطر واحد**
4. Health check: `/api/health` — والنشر تلقائي عند كل push.

### Railway / Fly.io
- Railway: اربط المستودع (سيقرأ `railway.json`) وأضف نفس المتغيرين.
- أو Docker: `docker build -t erp-api . && docker run -p 4000:4000 --env-file .env erp-api`

### إعداد Firebase (مرة واحدة)
1. Project Settings → Service accounts → **Generate new private key** → احفظ `service-account.json` (لا ترفعه لـ Git!).
2. Firestore: أنشئ قاعدة بيانات (Native mode).
3. قدّم القواعد الصارمة: `firebase deploy --only firestore:rules --project <id>` (ملف `firestore.rules`).
4. قدّم الفهارس: `firebase deploy --only firestore:indexes --project <id>` (ملف `firestore.indexes.json`).
5. إن شاركت المشروع مع النظام القديم: ضع `FIRESTORE_COLLECTION_PREFIX=erp_` — فتصبح المجموعات `erp_accounts`... بلا أي تصادم.
6. فعّل **App Check** وقيّد مفاتيح الويب (HTTP referrers) من إعدادات Auth.
7. شغّل الخادم مرة — تُزرع شجرة الحسابات والإعدادات تلقائياً (idempotent).

### أول دخول للإنتاج
1. أنشئ مستخدمك في Firebase Authentication (Email/Password).
2. سجّل دخولاً من اللوحة → يُهيأ ملفك بدور `employee` آمن افتراضياً.
3. من مستخدم admin (أنشئه مبدئياً يدوياً في `users/{uid}` بدور `admin`) ارفع أدوار فريقك من شاشة المستخدمين.

## الخريطة المحاسبية (مختصر)

- **1120** ذمم العملاء (رقابي) + فرعية `1120-Cxxxx` لكل عميل
- **1110/1115** النقد بالخزائن/البنوك + فرعية لكل خزينة
- **1140** سلف الموظفين + `1140-Exxxx` — **2120** رواتب مستحقة + `2120-Exxxx`
- **2150** ضريبة مخرجات — **2130/2140** تأمينات وضرائب رواتب
- **3100 رأس المال، 3200 الأرباح المبقاة** — **4100/4200/4300** إيرادات
- **5050** تكلفة الخدمات، **5100** رواتب، **5200** إيجار، **5300** تسويق، **5400** برمجيات، **5500** مرافق، **5600** أخرى

فئات النظام القديم التسع (`operating/marketing/.../task_payments`) مربوطة بـ `LEGACY_EXPENSE_CATEGORY_MAP` لتغذية سندات المصروفات مباشرة.
