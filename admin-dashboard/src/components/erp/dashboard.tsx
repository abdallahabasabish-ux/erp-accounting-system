'use client';

/**
 * لوحة المعلومات — مؤشرات رئيسية (نقد، ذمم، إيراد الشهر، صافي الربح، موظفون)،
 * شريط أعمار الذمم، رسم بياني مختصر، وآخر القيود والفواتير.
 */
import * as React from 'react';
import { BarChart3, Banknote, FileText, TrendingDown, TrendingUp, Users } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip as ReTooltip, XAxis, YAxis } from 'recharts';

import {
  EmptyState, InvoiceStatusBadge, JournalTypeBadge, LoadError, LoadingTable, Ltr, Money, SectionCard, StatCard, useAsyncData,
} from '@/components/erp/shared';
import {
  INVOICE_STATUS_LABELS, JOURNAL_TYPE_LABELS, api, firstDayOfMonthISO, formatEGP, formatDate,
  type AgingReport, type Invoice, type JournalEntry, type ProfitLoss, type TreasuryAccount,
} from '@/lib/erp';

interface DashboardData {
  treasuries: TreasuryAccount[];
  aging: AgingReport;
  pl: ProfitLoss;
  journal: JournalEntry[];
  invoices: Invoice[];
  activeEmployees: number | null;
}

const AGING_BUCKETS: { key: keyof AgingReport['totals']; label: string; color: string }[] = [
  { key: 'current', label: 'غير مستحقة', color: 'bg-emerald-500' },
  { key: 'd1_30', label: '1–30 يوم', color: 'bg-amber-400' },
  { key: 'd31_60', label: '31–60 يوم', color: 'bg-amber-500' },
  { key: 'd61_90', label: '61–90 يوم', color: 'bg-orange-500' },
  { key: 'd90_plus', label: '+90 يوم', color: 'bg-red-500' },
];

export function DashboardSection() {
  const { data, loading, error, reload } = useAsyncData<DashboardData>(async () => {
    const from = firstDayOfMonthISO();
    const [treasuriesRes, agingRes, plRes, journalRes, invoicesRes, employeesRes] = await Promise.allSettled([
      api.get<{ accounts: TreasuryAccount[] }>('treasury/accounts'),
      api.get<AgingReport>('reports/aging'),
      api.get<ProfitLoss>(`reports/profit-loss?from=${from}`),
      api.get<{ entries: JournalEntry[] }>('journal?limit=5'),
      api.get<{ invoices: Invoice[] }>('invoices'),
      api.get<{ employees: { status: string }[] }>('hr/employees'),
    ]);
    if (agingRes.status === 'rejected') throw agingRes.reason;
    return {
      treasuries: treasuriesRes.status === 'fulfilled' ? treasuriesRes.value.accounts : [],
      aging: agingRes.value,
      pl: plRes.status === 'fulfilled' ? plRes.value : { revenue: [], totalRevenue: 0, costOfServices: [], totalCogs: 0, grossProfit: 0, operatingExpenses: [], totalOpex: 0, netProfit: 0 },
      journal: journalRes.status === 'fulfilled' ? journalRes.value.entries : [],
      invoices: invoicesRes.status === 'fulfilled' ? invoicesRes.value.invoices.slice(0, 5) : [],
      activeEmployees: employeesRes.status === 'fulfilled' ? employeesRes.value.employees.filter((e) => e.status === 'active').length : null,
    };
  }, []);

  const totalCash = React.useMemo(
    () => (data?.treasuries ?? []).reduce((s, t) => s + (t.balancePiasters || 0), 0),
    [data],
  );

  const chartData = React.useMemo(
    () => data
      ? [
          { name: 'الإيرادات', amount: data.pl.totalRevenue / 100 },
          { name: 'تكلفة مباشرة', amount: data.pl.totalCogs / 100 },
          { name: 'مصروفات تشغيلية', amount: data.pl.totalOpex / 100 },
          { name: 'صافي الربح', amount: data.pl.netProfit / 100 },
        ]
      : [],
    [data],
  );

  if (loading) {
    return (
      <div className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => <StatCard key={i} title="…" value="" loading />)}
        </div>
        <SectionCard title="آخر القيود"><LoadingTable cols={5} /></SectionCard>
      </div>
    );
  }
  if (error || !data) return <LoadError error={error} onRetry={reload} />;

  const aging = data.aging;
  const totalAging = Math.max(aging.totalReceivable, 1);

  return (
    <div className="space-y-5">
      {/* المؤشرات الرئيسية */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard title="إجمالي النقد" value={<Money p={totalCash} />} hint={`${data.treasuries.length} خزينة/بنك`} icon={Banknote} tone="positive" />
        <StatCard title="ذمم مدينة" value={<Money p={aging.totalReceivable} />} hint={`حتى ${formatDate(aging.asOf)}`} icon={FileText} tone="warning" />
        <StatCard title="إيراد الشهر" value={<Money p={data.pl.totalRevenue} />} hint="قائمة الدخل — الشهر الحالي" icon={TrendingUp} />
        <StatCard
          title="صافي ربح الشهر"
          value={<Money p={data.pl.netProfit} />}
          hint={data.pl.netProfit >= 0 ? 'ربح' : 'خسارة'}
          icon={TrendingDown}
          tone={data.pl.netProfit >= 0 ? 'positive' : 'negative'}
        />
        <StatCard title="موظفون نشطون" value={data.activeEmployees ?? '—'} hint="الموظفون بحالة نشط" icon={Users} />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {/* أعمار الذمم */}
        <SectionCard title="أعمار الذمم المدينة" description={`إجمالي المستحق على العملاء: ${formatEGP(aging.totalReceivable)}`}>
          {aging.totalReceivable === 0 ? (
            <EmptyState title="لا توجد ذمم مستحقة" hint="كل فواتير العملاء مسددة بالكامل" />
          ) : (
            <div className="space-y-4">
              <div className="flex h-3.5 w-full overflow-hidden rounded-full bg-muted" role="img" aria-label="توزيع أعمار الذمم">
                {AGING_BUCKETS.map((b) => {
                  const v = aging.totals[b.key];
                  if (!v) return null;
                  return <span key={b.key} className={b.color} style={{ width: `${(v / totalAging) * 100}%` }} title={b.label} />;
                })}
              </div>
              <ul className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
                {AGING_BUCKETS.map((b) => (
                  <li key={b.key} className="flex items-center gap-2">
                    <span className={`size-2.5 rounded-sm ${b.color}`} aria-hidden />
                    <span className="text-muted-foreground">{b.label}</span>
                    <span className="mr-auto font-medium tabular-nums"><Ltr>{formatEGP(aging.totals[b.key])}</Ltr></span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </SectionCard>

        {/* ملخص الشهر */}
        <SectionCard title="ملخص الشهر الحالي" description="من قائمة الدخل للفترة من أول الشهر حتى اليوم">
          {chartData.every((d) => d.amount === 0) ? (
            <EmptyState title="لا توجد حركة بعد" hint="ستظهر الإيرادات والمصروفات هنا" />
          ) : (
            <div className="h-56 w-full" dir="ltr">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.08} vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} />
                  <YAxis tick={{ fontSize: 10 }} width={52} tickFormatter={(v: number) => v.toLocaleString('en-US')} />
                  <ReTooltip formatter={(v: number | string) => formatEGP(Number(v) * 100)} />
                  <Bar dataKey="amount" radius={[6, 6, 0, 0]} maxBarSize={44}>
                    <Cell fill="#059669" />
                    <Cell fill="#d97706" />
                    <Cell fill="#f59e0b" />
                    <Cell fill="#0d9488" />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </SectionCard>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {/* آخر القيود */}
        <SectionCard title="آخر القيود اليومية" description="أحدث 5 قيود مُرحَّلة">
          {data.journal.length === 0 ? (
            <EmptyState title="لا توجد قيود بعد" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-sm">
                <thead>
                  <tr className="border-b text-right text-xs text-muted-foreground">
                    <th className="pb-2 font-medium">الرقم</th>
                    <th className="pb-2 font-medium">التاريخ</th>
                    <th className="pb-2 font-medium">النوع</th>
                    <th className="pb-2 font-medium">المبلغ</th>
                  </tr>
                </thead>
                <tbody>
                  {data.journal.map((e) => (
                    <tr key={e.id} className="border-b last:border-0">
                      <td className="py-2.5"><Ltr className="text-xs font-semibold">{e.number}</Ltr></td>
                      <td className="py-2.5 text-xs text-muted-foreground"><Ltr>{formatDate(e.date)}</Ltr></td>
                      <td className="py-2.5"><JournalTypeBadge type={e.type} labels={JOURNAL_TYPE_LABELS} /></td>
                      <td className="py-2.5"><Money p={e.totalDebit} withSymbol={false} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>

        {/* آخر الفواتير */}
        <SectionCard title="آخر الفواتير" description="أحدث 5 فواتير مبيعات">
          {data.invoices.length === 0 ? (
            <EmptyState title="لا توجد فواتير بعد" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-sm">
                <thead>
                  <tr className="border-b text-right text-xs text-muted-foreground">
                    <th className="pb-2 font-medium">الرقم</th>
                    <th className="pb-2 font-medium">العميل</th>
                    <th className="pb-2 font-medium">الإجمالي</th>
                    <th className="pb-2 font-medium">الحالة</th>
                  </tr>
                </thead>
                <tbody>
                  {data.invoices.map((inv) => (
                    <tr key={inv.id} className="border-b last:border-0">
                      <td className="py-2.5"><Ltr className="text-xs font-semibold">{inv.number}</Ltr></td>
                      <td className="max-w-36 truncate py-2.5 text-xs">{inv.customerName}</td>
                      <td className="py-2.5"><Money p={inv.total} withSymbol={false} /></td>
                      <td className="py-2.5"><InvoiceStatusBadge status={inv.status} labels={INVOICE_STATUS_LABELS} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      </div>

      <p className="flex items-center justify-center gap-2 text-[11px] text-muted-foreground">
        <BarChart3 className="size-3.5" aria-hidden />
        تُحدَّث المؤشرات مباشرة من دفاتر القيد المزدوج — كل مبالغ محفوظة بالقروش.
      </p>
    </div>
  );
}
