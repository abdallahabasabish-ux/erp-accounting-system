'use client';

/**
 * نقطة دخول لوحة ERP — تجمّع الدخول والهيكل والأقسام في مسار واحد مع تنقل داخلي
 * بحالة العميل. القائمة الجانبية تُفلتر تلقائياً حسب صلاحيات المستخدم.
 */
import * as React from 'react';

import {
  Banknote, BookText, CalendarRange, FileText, HandCoins, LayoutDashboard, ListTree,
  Receipt, ShieldCheck, UserRound, Users, Wallet, BarChart3,
} from 'lucide-react';

import { LoginScreen } from '@/components/erp/login';
import { ErpShell, type ErpNavItem } from '@/components/erp/shell';
import { AccountsSection } from '@/components/erp/accounts';
import { AdminSection } from '@/components/erp/admin';
import { CustomersSection } from '@/components/erp/customers';
import { DashboardSection } from '@/components/erp/dashboard';
import { ExpensesSection } from '@/components/erp/expenses';
import { HrSection } from '@/components/erp/hr';
import { InvoicesSection } from '@/components/erp/invoices';
import { JournalSection } from '@/components/erp/journal';
import { PaymentsSection } from '@/components/erp/payments';
import { PeriodsSection } from '@/components/erp/periods';
import { PortalSection } from '@/components/erp/portal';
import { ReportsSection } from '@/components/erp/reports';
import { TreasurySection } from '@/components/erp/treasury';
import { useToast } from '@/hooks/use-toast';
import {
  api, can, ErpError, type Customer, type ErpMeta, type ErpUser,
} from '@/lib/erp';

const AUTH_KEY = 'erp_auth';

interface StoredAuth { token: string; user: ErpUser }

interface SectionDef extends ErpNavItem {
  visible: (user: ErpUser) => boolean;
  title: string;
}

const SECTIONS: SectionDef[] = [
  { id: 'dashboard', label: 'لوحة المعلومات', title: 'لوحة المعلومات', icon: LayoutDashboard, group: 'نظرة عامة', visible: (u) => can(u, 'dashboard:view') },
  { id: 'accounts', label: 'شجرة الحسابات', title: 'شجرة الحسابات', icon: ListTree, group: 'المحاسبة', visible: (u) => can(u, 'accounts:view') },
  { id: 'journal', label: 'القيود اليومية', title: 'القيود اليومية', icon: BookText, group: 'المحاسبة', visible: (u) => can(u, 'journal:view') },
  { id: 'reports', label: 'التقارير المالية', title: 'التقارير المالية', icon: BarChart3, group: 'المحاسبة', visible: (u) => can(u, 'reports:view') },
  { id: 'periods', label: 'الفترات المالية', title: 'الفترات المالية', icon: CalendarRange, group: 'المحاسبة', visible: (u) => can(u, 'periods:view') },
  { id: 'invoices', label: 'الفواتير', title: 'فواتير المبيعات', icon: FileText, group: 'العمليات', visible: (u) => can(u, 'invoices:view') },
  { id: 'payments', label: 'المدفوعات', title: 'سندات القبض والمدفوعات', icon: HandCoins, group: 'العمليات', visible: (u) => can(u, 'payments:view') },
  { id: 'customers', label: 'العملاء', title: 'العملاء والذمم', icon: Users, group: 'العمليات', visible: (u) => can(u, 'customers:view') },
  { id: 'expenses', label: 'المصروفات', title: 'المصروفات', icon: Receipt, group: 'العمليات', visible: (u) => can(u, 'expenses:view') },
  { id: 'treasury', label: 'الخزائن والبنوك', title: 'الخزائن والبنوك', icon: Wallet, group: 'الموارد', visible: (u) => can(u, 'treasury:view') },
  { id: 'hr', label: 'الموظفون والرواتب', title: 'الموظفون والرواتب', icon: Banknote, group: 'الموارد', visible: (u) => can(u, 'employees:view') || can(u, 'payroll:view') },
  { id: 'dues', label: 'مستحقاتي', title: 'مستحقاتي', icon: UserRound, group: 'حسابي', visible: (u) => u.role === 'employee' },
  { id: 'portal', label: 'بوابتي', title: 'بوابة العميل', icon: UserRound, group: 'حسابي', visible: (u) => u.role === 'client' },
  { id: 'admin', label: 'المستخدمون والتدقيق', title: 'المستخدمون وسجل التدقيق', icon: ShieldCheck, group: 'النظام', visible: (u) => can(u, 'users:manage') || can(u, 'audit:view') },
];

function readStoredAuth(): StoredAuth | null {
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredAuth;
    if (parsed?.token && parsed?.user?.uid) return parsed;
    return null;
  } catch {
    return null;
  }
}

export default function ErpPage() {
  const { toast } = useToast();
  const [auth, setAuth] = React.useState<StoredAuth | null>(null);
  const [booted, setBooted] = React.useState(false);
  const [meta, setMeta] = React.useState<ErpMeta | null>(null);
  const [active, setActive] = React.useState<string>('dashboard');

  // تسجيل معالج 401 مركزي
  React.useEffect(() => {
    api.onUnauthorized = () => {
      localStorage.removeItem(AUTH_KEY);
      setAuth(null);
      api.setToken(null);
    };
    return () => { api.onUnauthorized = null; };
  }, [toast]);

  // الإقلاع: قراءة الجلسة + جلب meta
  React.useEffect(() => {
    const stored = readStoredAuth();
    if (stored) {
      api.setToken(stored.token);
      setAuth(stored);
    }
    api
      .get<ErpMeta>('meta')
      .then(setMeta)
      .catch(() => setMeta({ mode: 'demo', currency: 'EGP', currencySymbol: 'ج.م', minorUnit: 100, vatRate: 14 }));
    setBooted(true);
  }, []);

  // القسم الافتراضي بعد الدخول
  const navItems = React.useMemo(
    () => SECTIONS.filter((s) => s.visible(auth?.user ?? { uid: '', email: '', displayName: '', role: 'client', permissions: [] })),
    [auth],
  );

  React.useEffect(() => {
    if (!auth) return;
    const allowed = SECTIONS.filter((s) => s.visible(auth.user));
    if (!allowed.some((s) => s.id === active)) setActive(allowed[0]?.id ?? 'dashboard');
  }, [auth, active]);

  const handleLoginSuccess = React.useCallback((token: string, user: ErpUser) => {
    localStorage.setItem(AUTH_KEY, JSON.stringify({ token, user }));
    api.setToken(token);
    setAuth({ token, user });
    const allowed = SECTIONS.filter((s) => s.visible(user));
    setActive(allowed[0]?.id ?? 'dashboard');
  }, []);

  const handleLogout = React.useCallback(() => {
    localStorage.removeItem(AUTH_KEY);
    api.setToken(null);
    setAuth(null);
    toast({ title: 'تم تسجيل الخروج', description: 'نراك قريباً — بياناتك محفوظة بأمان' });
  }, [toast]);

  // قائمة العملاء المشتركة بين الفواتير والمدفوعات
  const customersState = React.useMemo(() => {
    const needCustomers = auth && (can(auth.user, 'customers:view') || can(auth.user, 'invoices:create') || can(auth.user, 'payments:create'));
    return needCustomers;
  }, [auth]);
  const [customers, setCustomers] = React.useState<Customer[] | null>(null);
  React.useEffect(() => {
    if (!customersState || !auth) return;
    let cancelled = false;
    api
      .get<{ customers: Customer[] }>('customers')
      .then((d) => { if (!cancelled) setCustomers(d.customers); })
      .catch(() => { if (!cancelled) setCustomers(null); });
    return () => { cancelled = true; };
  }, [customersState, auth]);

  if (!booted) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <span className="size-8 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent" aria-hidden />
          جارٍ تهيئة النظام…
        </div>
      </div>
    );
  }

  if (!auth) {
    return <LoginScreen onSuccess={handleLoginSuccess} meta={meta} />;
  }

  const currentDef = SECTIONS.find((s) => s.id === active) ?? SECTIONS[0];

  return (
    <ErpShell
      user={auth.user}
      meta={meta}
      navItems={navItems}
      activeId={active}
      onNavigate={setActive}
      onLogout={handleLogout}
      title={currentDef.title}
    >
      <SectionBody section={currentDef.id} user={auth.user} customers={customers} />
    </ErpShell>
  );
}

function SectionBody({ section, user, customers }: { section: string; user: ErpUser; customers: Customer[] | null }) {
  switch (section) {
    case 'dashboard': return <DashboardSection />;
    case 'accounts': return <AccountsSection user={user} />;
    case 'journal': return <JournalSection user={user} />;
    case 'invoices': return <InvoicesSection user={user} customers={customers} />;
    case 'payments': return <PaymentsSection user={user} customers={customers} />;
    case 'customers': return <CustomersSection user={user} />;
    case 'treasury': return <TreasurySection user={user} />;
    case 'hr': return <HrSection user={user} />;
    case 'dues': return <HrSection user={user} />;
    case 'expenses': return <ExpensesSection user={user} />;
    case 'reports': return <ReportsSection />;
    case 'periods': return <PeriodsSection user={user} />;
    case 'admin': return <AdminSection canUsers={can(user, 'users:manage')} canAudit={can(user, 'audit:view')} />;
    case 'portal': return <PortalSection />;
    default:
      return (
        <div className="p-8 text-center text-muted-foreground">اختر قسماً من القائمة للبدء</div>
      );
  }
}
