'use client';

/**
 * التقارير المالية — ميزان مراجعة، قائمة دخل، ميزانية عمومية، تدفقات نقدية،
 * ودفتر أستاذ لأي حساب مع رصيد جارٍ. كل تقاريرها متوازنة وتظهر شارة التحقق.
 */
import * as React from 'react';
import { BadgeCheck, BookOpen, CheckCircle2, Scale, XCircle } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip as ReTooltip, XAxis, YAxis } from 'recharts';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  EmptyState, LoadError, LoadingTable, Ltr, Money, ScrollTable, SectionCard, StatCard, ToneBadge, useAsyncData,
} from '@/components/erp/shared';
import {
  ACCOUNT_TYPE_LABELS, api, currentPeriodKey, firstDayOfMonthISO, formatDate, formatEGP,
  type Account, type BalanceSheet, type CashFlow, type LedgerReport, type ProfitLoss, type TrialBalance,
} from '@/lib/erp';
import { cn } from '@/lib/utils';

function BalancedBadge({ ok, okText = 'متوازن ✓', badText = 'غير متوازن ✗' }: { ok: boolean; okText?: string; badText?: string }) {
  return ok
    ? <ToneBadge tone="success" className="gap-1"><CheckCircle2 className="size-3.5" aria-hidden /> {okText}</ToneBadge>
    : <ToneBadge tone="danger" className="gap-1"><XCircle className="size-3.5" aria-hidden /> {badText}</ToneBadge>;
}

function DateRange({
  from, to, onFrom, onTo, onApply, onReset, extra,
}: {
  from: string; to: string;
  onFrom: (v: string) => void; onTo: (v: string) => void;
  onApply: () => void; onReset: () => void;
  extra?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end gap-2 rounded-lg border bg-muted/30 p-3">
      <div className="space-y-1">
        <Label className="text-xs">من</Label>
        <Input type="date" dir="ltr" className="h-10 w-36 text-left tabular-nums" value={from} onChange={(e) => onFrom(e.target.value)} />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">إلى</Label>
        <Input type="date" dir="ltr" className="h-10 w-36 text-left tabular-nums" value={to} onChange={(e) => onTo(e.target.value)} />
      </div>
      <Button className="min-h-10" onClick={onApply}>تطبيق</Button>
      <Button variant="ghost" className="min-h-10" onClick={onReset}>مسح</Button>
      {extra}
    </div>
  );
}

export function ReportsSection() {
  return (
    <Tabs defaultValue="trial-balance" className="space-y-4">
      <SectionCard
        title="التقارير المالية"
        description="تقارير محاسبية كاملة مشتقة مباشرة من دفاتر القيد المزدوج"
        className="border-0 shadow-none bg-transparent"
        contentClassName="p-0"
      >
        <TabsList className="grid w-full max-w-2xl grid-cols-2 gap-1 sm:grid-cols-5">
          <TabsTrigger value="trial-balance" className="min-h-11 text-xs">ميزان المراجعة</TabsTrigger>
          <TabsTrigger value="profit-loss" className="min-h-11 text-xs">قائمة الدخل</TabsTrigger>
          <TabsTrigger value="balance-sheet" className="min-h-11 text-xs">الميزانية العمومية</TabsTrigger>
          <TabsTrigger value="cash-flow" className="min-h-11 text-xs">التدفقات النقدية</TabsTrigger>
          <TabsTrigger value="ledger" className="min-h-11 text-xs">دفتر الأستاذ</TabsTrigger>
        </TabsList>

        <TabsContent value="trial-balance" className="mt-4"><TrialBalanceTab /></TabsContent>
        <TabsContent value="profit-loss" className="mt-4"><ProfitLossTab /></TabsContent>
        <TabsContent value="balance-sheet" className="mt-4"><BalanceSheetTab /></TabsContent>
        <TabsContent value="cash-flow" className="mt-4"><CashFlowTab /></TabsContent>
        <TabsContent value="ledger" className="mt-4"><LedgerTab /></TabsContent>
      </SectionCard>
    </Tabs>
  );
}

/* ------------------------------ ميزان المراجعة ------------------------------ */

function TrialBalanceTab() {
  const [from, setFrom] = React.useState('');
  const [to, setTo] = React.useState('');
  const [applied, setApplied] = React.useState({ from: '', to: '' });
  const { data, loading, error, reload } = useAsyncData<TrialBalance>(
    () => api.get(`reports/trial-balance?${new URLSearchParams({ ...(applied.from && { from: applied.from }), ...(applied.to && { to: applied.to }) }).toString()}`),
    [applied],
  );

  return (
    <div>
      <DateRange from={from} to={to} onFrom={setFrom} onTo={setTo}
        onApply={() => setApplied({ from, to })}
        onReset={() => { setFrom(''); setTo(''); setApplied({ from: '', to: '' }); }}
        extra={data ? <div className="mr-auto"><BalancedBadge ok={data.balanced} /></div> : undefined}
      />
      {loading ? <LoadingTable cols={7} />
        : error ? <LoadError error={error} onRetry={reload} />
        : !data || data.rows.length === 0 ? <EmptyState title="لا أرصدة في هذه الفترة" />
        : (
          <ScrollTable maxHeight="max-h-[520px]">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-background shadow-[0_1px_0_0_var(--border)]">
                <tr className="text-right text-xs text-muted-foreground">
                  <th className="px-2 py-2.5 font-medium">الحساب</th>
                  <th className="px-2 py-2.5 font-medium">النوع</th>
                  <th className="px-2 py-2.5 font-medium">مدين افتتاحي</th>
                  <th className="px-2 py-2.5 font-medium">دائن افتتاحي</th>
                  <th className="px-2 py-2.5 font-medium">حركة مدين</th>
                  <th className="px-2 py-2.5 font-medium">حركة دائن</th>
                  <th className="px-2 py-2.5 font-medium">الرصيد الختامي</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.code} className="border-t transition-colors hover:bg-muted/40">
                    <td className="px-2 py-2.5">
                      <Ltr className="text-xs font-bold">{r.code}</Ltr>
                      <span className="mr-1.5 text-xs">{r.name}</span>
                    </td>
                    <td className="px-2 py-2.5 text-[11px] text-muted-foreground">{ACCOUNT_TYPE_LABELS[r.type] ?? r.type}</td>
                    <td className="px-2 py-2.5">{r.opening.debit ? <Money p={r.opening.debit} withSymbol={false} /> : '—'}</td>
                    <td className="px-2 py-2.5">{r.opening.credit ? <Money p={r.opening.credit} withSymbol={false} /> : '—'}</td>
                    <td className="px-2 py-2.5">{r.period.debit ? <Money p={r.period.debit} withSymbol={false} /> : '—'}</td>
                    <td className="px-2 py-2.5">{r.period.credit ? <Money p={r.period.credit} withSymbol={false} /> : '—'}</td>
                    <td className="px-2 py-2.5 font-semibold"><Money p={r.closingBalance} withSymbol={false} /></td>
                  </tr>
                ))}
                <tr className="border-t-2 bg-muted/50 font-bold">
                  <td className="px-2 py-2.5" colSpan={2}>الإجماليات</td>
                  <td className="px-2 py-2.5"><Money p={data.totals.openingDebit} withSymbol={false} /></td>
                  <td className="px-2 py-2.5"><Money p={data.totals.openingCredit} withSymbol={false} /></td>
                  <td className="px-2 py-2.5"><Money p={data.totals.periodDebit} withSymbol={false} /></td>
                  <td className="px-2 py-2.5"><Money p={data.totals.periodCredit} withSymbol={false} /></td>
                  <td className="px-2 py-2.5" />
                </tr>
              </tbody>
            </table>
          </ScrollTable>
        )}
    </div>
  );
}

/* -------------------------------- قائمة الدخل ------------------------------- */

function ProfitLossTab() {
  const [from, setFrom] = React.useState(firstDayOfMonthISO());
  const [to, setTo] = React.useState('');
  const [applied, setApplied] = React.useState({ from: firstDayOfMonthISO(), to: '' });
  const { data, loading, error, reload } = useAsyncData<ProfitLoss>(
    () => api.get(`reports/profit-loss?${new URLSearchParams({ ...(applied.from && { from: applied.from }), ...(applied.to && { to: applied.to }) }).toString()}`),
    [applied],
  );

  const chart = React.useMemo(
    () => data
      ? [
          { name: 'الإيرادات', amount: data.totalRevenue / 100, fill: '#059669' },
          { name: 'تكلفة مباشرة', amount: data.totalCogs / 100, fill: '#d97706' },
          { name: 'مصروفات', amount: data.totalOpex / 100, fill: '#f59e0b' },
          { name: 'صافي الربح', amount: data.netProfit / 100, fill: '#0d9488' },
        ]
      : [],
    [data],
  );

  return (
    <div>
      <DateRange from={from} to={to} onFrom={setFrom} onTo={setTo}
        onApply={() => setApplied({ from, to })}
        onReset={() => { setFrom(firstDayOfMonthISO()); setTo(''); setApplied({ from: firstDayOfMonthISO(), to: '' }); }}
      />
      {loading ? <LoadingTable cols={4} />
        : error ? <LoadError error={error} onRetry={reload} />
        : !data ? null
        : (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-4">
              <StatCard title="إجمالي الإيرادات" value={<Money p={data.totalRevenue} />} tone="positive" />
              <StatCard title="تكلفة الخدمات" value={<Money p={data.totalCogs} />} />
              <StatCard title="الربح الإجمالي" value={<Money p={data.grossProfit} />} tone="positive" />
              <StatCard title="صافي الربح" value={<Money p={data.netProfit} />} tone={data.netProfit >= 0 ? 'positive' : 'negative'} hint={`مصروفات تشغيلية: ${formatEGP(data.totalOpex)}`} />
            </div>

            {chart.some((c) => c.amount !== 0) ? (
              <div className="h-48 w-full rounded-lg border p-2" dir="ltr">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chart} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.08} vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 10 }} width={52} tickFormatter={(v: number) => v.toLocaleString('en-US')} />
                    <ReTooltip formatter={(v: number | string) => formatEGP(Number(v) * 100)} />
                    <Bar dataKey="amount" radius={[6, 6, 0, 0]} maxBarSize={48}>
                      {chart.map((c, i) => <Cell key={i} fill={c.fill} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : null}

            <PLSection title="الإيرادات" lines={data.revenue} total={data.totalRevenue} totalLabel="إجمالي الإيرادات" tone="positive" />
            <PLSection title="تكلفة الخدمات المقدمة" lines={data.costOfServices} total={data.totalCogs} totalLabel="إجمالي التكلفة المباشرة" />
            <PLSection title="المصروفات التشغيلية" lines={data.operatingExpenses} total={data.totalOpex} totalLabel="إجمالي المصروفات التشغيلية" />

            <div className="flex items-center justify-between rounded-xl border-2 border-emerald-200 bg-emerald-50/60 px-4 py-3.5 dark:border-emerald-900 dark:bg-emerald-950/30">
              <p className="flex items-center gap-2 font-bold">
                <Scale className="size-5 text-emerald-600" aria-hidden />
                صافي الربح (الخسارة) للفترة
              </p>
              <p className={cn('text-xl font-extrabold tabular-nums', data.netProfit >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-destructive')}>
                <Money p={data.netProfit} />
              </p>
            </div>
          </div>
        )}
    </div>
  );
}

function PLSection({ title, lines, total, totalLabel, tone }: {
  title: string;
  lines: { code: string; name: string; amount: number }[];
  total: number;
  totalLabel: string;
  tone?: 'positive';
}) {
  return (
    <div className="rounded-lg border">
      <p className="border-b bg-muted/40 px-4 py-2 text-sm font-semibold">{title}</p>
      {lines.length === 0 ? (
        <p className="px-4 py-3 text-xs text-muted-foreground">لا بنود في هذه الفترة</p>
      ) : (
        <ul className="divide-y">
          {lines.map((l) => (
            <li key={l.code} className="flex items-center justify-between gap-4 px-4 py-2 text-sm">
              <span><Ltr className="text-xs text-muted-foreground">{l.code}</Ltr> {l.name}</span>
              <Money p={l.amount} withSymbol={false} className={tone === 'positive' ? 'text-emerald-700 dark:text-emerald-400' : ''} />
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center justify-between gap-4 border-t bg-muted/30 px-4 py-2 text-sm font-bold">
        <span>{totalLabel}</span>
        <Money p={total} withSymbol={false} />
      </div>
    </div>
  );
}

/* ----------------------------- الميزانية العمومية ---------------------------- */

function BalanceSheetTab() {
  const [asOf, setAsOf] = React.useState('');
  const [applied, setApplied] = React.useState('');
  const { data, loading, error, reload } = useAsyncData<BalanceSheet>(
    () => api.get(`reports/balance-sheet${applied ? `?asOf=${applied}` : ''}`),
    [applied],
  );

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end gap-2 rounded-lg border bg-muted/30 p-3">
        <div className="space-y-1">
          <Label className="text-xs">كما في تاريخ</Label>
          <Input type="date" dir="ltr" className="h-10 w-36 text-left tabular-nums" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
        </div>
        <Button className="min-h-10" onClick={() => setApplied(asOf)}>تطبيق</Button>
        <Button variant="ghost" className="min-h-10" onClick={() => { setAsOf(''); setApplied(''); }}>مسح</Button>
        {data ? <div className="mr-auto"><BalancedBadge ok={data.balanced} okText="معادلة متوازنة ✓" badText="غير متوازنة ✗" /></div> : null}
      </div>

      {loading ? <LoadingTable cols={4} />
        : error ? <LoadError error={error} onRetry={reload} />
        : !data ? null
        : (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <StatCard title="إجمالي الأصول" value={<Money p={data.totalAssets} />} tone="positive" />
              <StatCard title="إجمالي الالتزامات" value={<Money p={data.totalLiabilities} />} tone="warning" />
              <StatCard title="إجمالي حقوق الملكية" value={<Money p={data.totalEquity} />} hint={`صافي ربح الفترة الجارية: ${formatEGP(data.netIncome)}`} />
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <SideList title="الأصول" entries={data.assets} total={data.totalAssets} totalLabel="إجمالي الأصول" />
              <div className="space-y-4">
                <SideList title="الالتزامات" entries={data.liabilities} total={data.totalLiabilities} totalLabel="إجمالي الالتزامات" />
                <div className="rounded-lg border">
                  <p className="border-b bg-muted/40 px-4 py-2 text-sm font-semibold">حقوق الملكية</p>
                  <ul className="divide-y">
                    {data.equity.map((e) => (
                      <li key={e.code} className="flex items-center justify-between gap-4 px-4 py-2 text-sm">
                        <span><Ltr className="text-xs text-muted-foreground">{e.code}</Ltr> {e.name}</span>
                        <Money p={e.amount} withSymbol={false} />
                      </li>
                    ))}
                  </ul>
                  <div className="flex items-center justify-between gap-4 border-t bg-muted/30 px-4 py-2 text-sm font-bold">
                    <span>إجمالي حقوق الملكية</span>
                    <Money p={data.totalEquity} withSymbol={false} />
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between gap-4 rounded-xl border bg-muted/40 px-4 py-3 text-sm">
              <p className="font-semibold">التحقق من المعادلة: الأصول = الالتزامات + حقوق الملكية</p>
              <p className="tabular-nums">
                <Money p={data.totalAssets} withSymbol={false} /> = <Money p={data.totalLiabilities + data.totalEquity} withSymbol={false} />
                {' '}<BalancedBadge ok={data.balanced} okText="✓" badText="✗" />
              </p>
            </div>
          </div>
        )}
    </div>
  );
}

function SideList({ title, entries, total, totalLabel }: { title: string; entries: { code: string; name: string; amount: number }[]; total: number; totalLabel: string }) {
  return (
    <div className="rounded-lg border">
      <p className="border-b bg-muted/40 px-4 py-2 text-sm font-semibold">{title}</p>
      {entries.length === 0 ? (
        <p className="px-4 py-3 text-xs text-muted-foreground">لا بنود</p>
      ) : (
        <ul className="divide-y">
          {entries.map((e) => (
            <li key={e.code} className="flex items-center justify-between gap-4 px-4 py-2 text-sm">
              <span className="min-w-0"><Ltr className="text-xs text-muted-foreground">{e.code}</Ltr> {e.name}</span>
              <Money p={e.amount} withSymbol={false} />
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center justify-between gap-4 border-t bg-muted/30 px-4 py-2 text-sm font-bold">
        <span>{totalLabel}</span>
        <Money p={total} withSymbol={false} />
      </div>
    </div>
  );
}

/* ----------------------------- التدفقات النقدية ----------------------------- */

function CashFlowTab() {
  const [from, setFrom] = React.useState(firstDayOfMonthISO());
  const [to, setTo] = React.useState('');
  const [applied, setApplied] = React.useState({ from: firstDayOfMonthISO(), to: '' });
  const { data, loading, error, reload } = useAsyncData<CashFlow>(
    () => api.get(`reports/cash-flow?${new URLSearchParams({ ...(applied.from && { from: applied.from }), ...(applied.to && { to: applied.to }) }).toString()}`),
    [applied],
  );

  return (
    <div>
      <DateRange from={from} to={to} onFrom={setFrom} onTo={setTo}
        onApply={() => setApplied({ from, to })}
        onReset={() => { setFrom(firstDayOfMonthISO()); setTo(''); setApplied({ from: firstDayOfMonthISO(), to: '' }); }}
        extra={data ? <div className="mr-auto"><BalancedBadge ok={data.reconciled} okText="مطابَق ✓" badText="غير مطابق ✗" /></div> : undefined}
      />
      {loading ? <LoadingTable cols={3} />
        : error ? <LoadError error={error} onRetry={reload} />
        : !data ? null
        : (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard title="تشغيلية" value={<Money p={data.sections.operating} />} tone={data.sections.operating >= 0 ? 'positive' : 'negative'} hint="صافي التدفق من الأنشطة التشغيلية" />
              <StatCard title="استثمارية" value={<Money p={data.sections.investing} />} hint="الأصول طويلة الأجل" />
              <StatCard title="تمويلية" value={<Money p={data.sections.financing} />} tone={data.sections.financing >= 0 ? 'positive' : 'negative'} hint="رأس مال وقروض" />
              <StatCard title="صافي التغير في النقد" value={<Money p={data.netChange} />} tone={data.netChange >= 0 ? 'positive' : 'negative'} />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <StatCard title="النقد في بداية الفترة" value={<Money p={data.openingCash} />} />
              <StatCard title="النقد في نهاية الفترة" value={<Money p={data.closingCash} />} tone="positive" />
            </div>

            <div className="flex items-center justify-between gap-4 rounded-xl border bg-muted/40 px-4 py-3 text-sm">
              <p className="font-semibold">التحقق: النقد الافتتاحي + صافي التغير = النقد الختامي</p>
              <p className="tabular-nums">
                <Money p={data.openingCash} withSymbol={false} /> + <Money p={data.netChange} withSymbol={false} /> = <Money p={data.closingCash} withSymbol={false} />
              </p>
            </div>
          </div>
        )}
    </div>
  );
}

/* ------------------------------- دفتر الأستاذ ------------------------------- */

function LedgerTab() {
  const accountsState = useAsyncData<{ accounts: Account[] }>(() => api.get('accounts'), []);
  const posting = React.useMemo(
    () => (accountsState.data?.accounts ?? []).filter((a) => a.kind === 'posting'),
    [accountsState.data],
  );

  const [code, setCode] = React.useState('');
  const [from, setFrom] = React.useState('');
  const [to, setTo] = React.useState('');
  const [applied, setApplied] = React.useState({ code: '', from: '', to: '' });

  React.useEffect(() => {
    if (!code && posting.length > 0) setCode(posting[0].code);
  }, [posting.length]);

  const { data, loading, error, reload } = useAsyncData<LedgerReport | null>(
    async () => (applied.code
      ? api.get(`reports/ledger/${encodeURIComponent(applied.code)}?${new URLSearchParams({ ...(applied.from && { from: applied.from }), ...(applied.to && { to: applied.to }) }).toString()}`)
      : null),
    [applied],
  );

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end gap-2 rounded-lg border bg-muted/30 p-3">
        <div className="min-w-52 space-y-1">
          <Label className="text-xs">الحساب</Label>
          <Select value={code} onValueChange={setCode}>
            <SelectTrigger className="h-10 w-full"><SelectValue placeholder="اختر حساباً…" /></SelectTrigger>
            <SelectContent className="max-h-64">
              {posting.map((a) => (
                <SelectItem key={a.code} value={a.code}>
                  <span className="flex items-center gap-2"><Ltr className="text-xs text-muted-foreground">{a.code}</Ltr> {a.name}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">من</Label>
          <Input type="date" dir="ltr" className="h-10 w-36 text-left tabular-nums" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">إلى</Label>
          <Input type="date" dir="ltr" className="h-10 w-36 text-left tabular-nums" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <Button className="min-h-10" onClick={() => setApplied({ code, from, to })}>عرض</Button>
        <Button variant="ghost" className="min-h-10" onClick={() => { setFrom(''); setTo(''); setApplied((s) => ({ ...s, from: '', to: '' })); }}>مسح</Button>
      </div>

      {!applied.code ? <EmptyState title="اختر حساباً لعرض دفتر أستاذه" icon={BookOpen} />
        : loading ? <LoadingTable cols={6} />
        : error ? <LoadError error={error} onRetry={reload} />
        : !data || data.movements.length === 0 ? <EmptyState title="لا حركات على هذا الحساب في الفترة" />
        : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-bold">
                دفتر أستاذ: <Ltr>{data.account.code}</Ltr> — {data.account.name}
              </p>
              <div className="flex gap-2 text-xs">
                <ToneBadge tone="neutral">افتتاحي: <Money p={data.openingBalance} withSymbol={false} /></ToneBadge>
                <ToneBadge tone="info">ختامي: <Money p={data.closingBalance} withSymbol={false} /></ToneBadge>
              </div>
            </div>
            <ScrollTable maxHeight="max-h-[440px]">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-background shadow-[0_1px_0_0_var(--border)]">
                  <tr className="text-right text-xs text-muted-foreground">
                    <th className="px-2 py-2.5 font-medium">القيد</th>
                    <th className="px-2 py-2.5 font-medium">التاريخ</th>
                    <th className="px-2 py-2.5 font-medium">البيان</th>
                    <th className="px-2 py-2.5 font-medium">مدين</th>
                    <th className="px-2 py-2.5 font-medium">دائن</th>
                    <th className="px-2 py-2.5 font-medium">الرصيد</th>
                  </tr>
                </thead>
                <tbody>
                  {data.movements.map((m, i) => (
                    <tr key={`${m.entryId}-${i}`} className="border-t transition-colors hover:bg-muted/40">
                      <td className="whitespace-nowrap px-2 py-2.5"><Ltr className="text-xs font-semibold">{m.number}</Ltr></td>
                      <td className="whitespace-nowrap px-2 py-2.5 text-xs text-muted-foreground"><Ltr>{formatDate(m.date)}</Ltr></td>
                      <td className="max-w-64 px-2 py-2.5"><span className="line-clamp-1 text-xs">{m.memo}</span></td>
                      <td className="px-2 py-2.5">{m.debit ? <Money p={m.debit} withSymbol={false} /> : '—'}</td>
                      <td className="px-2 py-2.5">{m.credit ? <Money p={m.credit} withSymbol={false} /> : '—'}</td>
                      <td className="whitespace-nowrap px-2 py-2.5 font-semibold"><Money p={m.runningBalance} withSymbol={false} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollTable>
          </div>
        )}
    </div>
  );
}
