'use client';

/**
 * القيود اليومية — جدول قيود قابل للتمديد لعرض الأطراف، فلاتر (فترة/نوع/مدى)،
 * إنشاء قيد يدوي بفرق توازن حي، وعكس أي قيد غير عكسي بسبب إلزامي.
 */
import * as React from 'react';
import { CheckCircle2, ChevronDown, Plus, Scale, Undo2, XCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  EmptyState, JournalTypeBadge, LoadError, LoadingTable, Ltr, Money, ScrollTable, SectionCard, useAsyncData,
} from '@/components/erp/shared';
import { useToast } from '@/hooks/use-toast';
import {
  JOURNAL_TYPE_LABELS, api, can, currentPeriodKey, ErpError, firstDayOfMonthISO, formatDate, formatEGP,
  parseEGPToPiasters, todayISO, type Account, type ErpUser, type JournalEntry, type JournalEntryType,
} from '@/lib/erp';
import { cn } from '@/lib/utils';

interface JournalFilters {
  period: string;
  type: string;
  from: string;
  to: string;
}

export function JournalSection({ user }: { user: ErpUser }) {
  const { toast } = useToast();
  const [filters, setFilters] = React.useState<JournalFilters>({ period: '', type: '', from: '', to: '' });
  const [applied, setApplied] = React.useState<JournalFilters>({ period: '', type: '', from: '', to: '' });

  const qs = React.useMemo(() => {
    const p = new URLSearchParams();
    if (applied.period) p.set('period', applied.period);
    if (applied.type) p.set('type', applied.type);
    if (applied.from) p.set('from', applied.from);
    if (applied.to) p.set('to', applied.to);
    p.set('limit', '100');
    return p.toString();
  }, [applied]);

  const { data, loading, error, reload } = useAsyncData<{ entries: JournalEntry[] }>(
    () => api.get(`journal?${qs}`),
    [qs],
  );
  const accountsState = useAsyncData<{ accounts: Account[] }>(() => api.get('accounts'), []);

  const [expandedId, setExpandedId] = React.useState<string | null>(null);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [reverseEntry, setReverseEntry] = React.useState<JournalEntry | null>(null);

  const canCreate = can(user, 'journal:create');
  const canReverse = can(user, 'journal:reverse');

  const applyFilters = () => setApplied({ ...filters });

  const entries = data?.entries ?? [];

  return (
    <div className="space-y-4">
      <SectionCard
        title="دفتر اليومية العام"
        description="كل حركات النظام مُرحَّلة هنا بقيود مزدوجة متوازنة"
        actions={canCreate ? (
          <Button size="sm" className="min-h-11 gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" aria-hidden /> قيد جديد
          </Button>
        ) : undefined}
      >
        {/* فلاتر */}
        <div className="mb-4 grid grid-cols-2 gap-2 rounded-lg border bg-muted/30 p-3 sm:grid-cols-3 lg:grid-cols-5">
          <div className="space-y-1">
            <Label htmlFor="jf-period" className="text-xs">الفترة (YYYY-MM)</Label>
            <Input id="jf-period" dir="ltr" className="h-10 text-left tabular-nums" placeholder={currentPeriodKey()}
              value={filters.period} onChange={(e) => setFilters((f) => ({ ...f, period: e.target.value.slice(0, 7) }))} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">النوع</Label>
            <Select value={filters.type || 'all'} onValueChange={(v) => setFilters((f) => ({ ...f, type: v === 'all' ? '' : v }))}>
              <SelectTrigger className="h-10 w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الأنواع</SelectItem>
                {(Object.keys(JOURNAL_TYPE_LABELS) as JournalEntryType[]).map((t) => (
                  <SelectItem key={t} value={t}>{JOURNAL_TYPE_LABELS[t]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="jf-from" className="text-xs">من تاريخ</Label>
            <Input id="jf-from" type="date" dir="ltr" className="h-10 text-left tabular-nums" value={filters.from}
              onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="jf-to" className="text-xs">إلى تاريخ</Label>
            <Input id="jf-to" type="date" dir="ltr" className="h-10 text-left tabular-nums" value={filters.to}
              onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))} />
          </div>
          <div className="flex items-end gap-2">
            <Button className="min-h-10 flex-1" onClick={applyFilters}>تطبيق</Button>
            <Button variant="ghost" className="min-h-10"
              onClick={() => { setFilters({ period: '', type: '', from: '', to: '' }); setApplied({ period: '', type: '', from: '', to: '' }); }}>
              مسح
            </Button>
          </div>
        </div>

        {loading ? <LoadingTable cols={5} />
          : error ? <LoadError error={error} onRetry={reload} />
          : entries.length === 0 ? <EmptyState title="لا توجد قيود مطابقة" hint="عدّل الفلاتر أو أنشئ قيداً جديداً" />
          : (
            <ScrollTable maxHeight="max-h-[560px]">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-background shadow-[0_1px_0_0_var(--border)]">
                  <tr className="text-right text-xs text-muted-foreground">
                    <th className="w-8 px-2 py-2.5" />
                    <th className="px-2 py-2.5 font-medium">الرقم</th>
                    <th className="px-2 py-2.5 font-medium">التاريخ</th>
                    <th className="px-2 py-2.5 font-medium">البيان</th>
                    <th className="px-2 py-2.5 font-medium">النوع</th>
                    <th className="px-2 py-2.5 font-medium">المدين</th>
                    <th className="px-2 py-2.5 font-medium">الدائن</th>
                    <th className="px-2 py-2.5 font-medium text-center">متوازن</th>
                    {canReverse ? <th className="px-2 py-2.5" /> : null}
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e) => {
                    const balanced = e.totalDebit === e.totalCredit;
                    const isExpanded = expandedId === e.id;
                    const reversible = e.type !== 'reversal';
                    return (
                      <React.Fragment key={e.id}>
                        <tr className="border-t transition-colors hover:bg-muted/40">
                          <td className="px-2 py-2.5">
                            <button
                              type="button"
                              aria-expanded={isExpanded}
                              aria-label={isExpanded ? 'إخفاء الأطراف' : 'عرض الأطراف'}
                              onClick={() => setExpandedId(isExpanded ? null : e.id)}
                              className="flex size-8 items-center justify-center rounded-md hover:bg-muted"
                            >
                              <ChevronDown className={cn('size-4 text-muted-foreground transition-transform', isExpanded && 'rotate-180')} aria-hidden />
                            </button>
                          </td>
                          <td className="whitespace-nowrap px-2 py-2.5">
                            <Ltr className="text-xs font-bold">{e.number}</Ltr>
                            {e.reversesOf ? <p className="mt-0.5 text-[10px] text-muted-foreground">عكس <Ltr>{e.reversesOf}</Ltr></p> : null}
                          </td>
                          <td className="whitespace-nowrap px-2 py-2.5 text-xs text-muted-foreground"><Ltr>{formatDate(e.date)}</Ltr></td>
                          <td className="max-w-52 px-2 py-2.5"><span className="line-clamp-2 text-xs leading-relaxed">{e.memo}</span></td>
                          <td className="px-2 py-2.5"><JournalTypeBadge type={e.type} labels={JOURNAL_TYPE_LABELS} /></td>
                          <td className="whitespace-nowrap px-2 py-2.5"><Money p={e.totalDebit} withSymbol={false} /></td>
                          <td className="whitespace-nowrap px-2 py-2.5"><Money p={e.totalCredit} withSymbol={false} /></td>
                          <td className="px-2 py-2.5 text-center">
                            {balanced
                              ? <CheckCircle2 className="mx-auto size-4.5 text-emerald-600" aria-label="متوازن" />
                              : <XCircle className="mx-auto size-4.5 text-destructive" aria-label="غير متوازن" />}
                          </td>
                          {canReverse ? (
                            <td className="px-2 py-2.5">
                              {reversible ? (
                                <Button variant="ghost" size="sm" className="min-h-9 gap-1 text-amber-700 hover:bg-amber-50 hover:text-amber-800 dark:text-amber-400 dark:hover:bg-amber-950/40"
                                  onClick={() => setReverseEntry(e)}>
                                  <Undo2 className="size-3.5" aria-hidden /> عكس
                                </Button>
                              ) : null}
                            </td>
                          ) : null}
                        </tr>
                        {isExpanded ? (
                          <tr className="border-t bg-muted/30">
                            <td colSpan={canReverse ? 9 : 8} className="px-4 py-3">
                              <div className="overflow-x-auto">
                                <table className="w-full min-w-[540px] text-xs">
                                  <thead>
                                    <tr className="text-right text-muted-foreground">
                                      <th className="pb-1.5 font-medium">الحساب</th>
                                      <th className="pb-1.5 font-medium">البيان</th>
                                      <th className="pb-1.5 font-medium">مدين</th>
                                      <th className="pb-1.5 font-medium">دائن</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {e.lines.map((l, i) => (
                                      <tr key={`${e.id}-${i}`} className="border-t border-border/60">
                                        <td className="py-1.5">
                                          <Ltr className="font-semibold">{l.accountCode}</Ltr>
                                          <span className="mr-2">{l.accountName}</span>
                                        </td>
                                        <td className="py-1.5 text-muted-foreground">{l.note || '—'}</td>
                                        <td className="py-1.5">{l.debit ? <Money p={l.debit} withSymbol={false} /> : <span className="text-muted-foreground">—</span>}</td>
                                        <td className="py-1.5">{l.credit ? <Money p={l.credit} withSymbol={false} /> : <span className="text-muted-foreground">—</span>}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </td>
                          </tr>
                        ) : null}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </ScrollTable>
          )}
      </SectionCard>

      <CreateEntryDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        accounts={accountsState.data?.accounts ?? []}
        onCreated={() => { setCreateOpen(false); reload(); }}
      />

      <ReverseDialog
        entry={reverseEntry}
        onClose={() => setReverseEntry(null)}
        onDone={() => { setReverseEntry(null); reload(); }}
      />
    </div>
  );
}

/* -------------------------------- قيد عكسي -------------------------------- */

function ReverseDialog({ entry, onClose, onDone }: { entry: JournalEntry | null; onClose: () => void; onDone: () => void }) {
  const { toast } = useToast();
  const [date, setDate] = React.useState(todayISO());
  const [reason, setReason] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (entry) { setDate(todayISO()); setReason(''); }
  }, [entry]);

  const reasonOk = reason.trim().length >= 5;

  const submit = async () => {
    if (!entry || !reasonOk) return;
    setSaving(true);
    try {
      await api.post(`journal/${encodeURIComponent(entry.id)}/reverse`, { date, reason: reason.trim() });
      toast({ title: 'تم ترحيل القيد العكسي', description: `عكس ${entry.number} بتاريخ ${date}`, variant: 'success' });
      onDone();
    } catch (e) {
      toast({ title: 'تعذر عكس القيد', description: e instanceof ErpError ? e.message : 'خطأ غير متوقع', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={entry !== null} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>عكس قيد</DialogTitle>
          <DialogDescription>
            سيُرحَّل قيد عكسي معاكس بالكامل للقيد <Ltr>{entry?.number ?? ''}</Ltr> — التصحيح الوحيد المسموح بعد الترحيل.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="space-y-2">
            <Label htmlFor="rev-date">تاريخ القيد العكسي</Label>
            <Input id="rev-date" type="date" dir="ltr" className="h-11 text-left tabular-nums" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="rev-reason">السبب (5 أحرف على الأقل)</Label>
            <Textarea id="rev-reason" className="min-h-20" value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder="مثال: خطأ في ترحيل مبلغ الفاتورة" />
            {reason && !reasonOk ? <p className="text-xs text-destructive">السبب قصير جداً — 5 أحرف على الأقل</p> : null}
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" className="min-h-11" onClick={onClose}>إلغاء</Button>
          <Button variant="destructive" className="min-h-11" disabled={!reasonOk || saving} onClick={() => void submit()}>
            {saving ? 'جارٍ الترحيل…' : 'ترحيل العكس'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------- إنشاء قيد -------------------------------- */

interface DraftLine {
  accountCode: string;
  debit: string;
  credit: string;
}

const emptyLine = (): DraftLine => ({ accountCode: '', debit: '', credit: '' });

function CreateEntryDialog({
  open, onOpenChange, accounts, onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  accounts: Account[];
  onCreated: () => void;
}) {
  const { toast } = useToast();
  const [date, setDate] = React.useState(todayISO());
  const [memo, setMemo] = React.useState('');
  const [type, setType] = React.useState<'standard' | 'adjusting'>('standard');
  const [lines, setLines] = React.useState<DraftLine[]>([emptyLine(), emptyLine()]);
  const [saving, setSaving] = React.useState(false);

  const postingAccounts = React.useMemo(
    () => accounts.filter((a) => a.kind === 'posting' && a.active),
    [accounts],
  );

  React.useEffect(() => {
    if (open) {
      setDate(todayISO());
      setMemo('');
      setType('standard');
      setLines([emptyLine(), emptyLine()]);
    }
  }, [open]);

  /** فرق التوازن بالقروش — حساب صحيح بلا floats */
  const diff = React.useMemo(() => {
    let debits = 0;
    let credits = 0;
    for (const l of lines) {
      debits += parseEGPToPiasters(l.debit) ?? 0;
      credits += parseEGPToPiasters(l.credit) ?? 0;
    }
    return debits - credits;
  }, [lines]);

  const filledLines = lines.filter((l) => l.accountCode && ((parseEGPToPiasters(l.debit) ?? 0) > 0 || (parseEGPToPiasters(l.credit) ?? 0) > 0));
  const lineErrors = lines.some((l) => (l.debit && l.credit) || (parseEGPToPiasters(l.debit) === null && l.debit) || (parseEGPToPiasters(l.credit) === null && l.credit));
  const memoOk = memo.trim().length >= 3;
  const canSubmit = filledLines.length >= 2 && diff === 0 && memoOk && !lineErrors && !saving;

  const setLine = (idx: number, patch: Partial<DraftLine>) =>
    setLines((ls) => ls.map((l, i) => (i === idx ? { ...l, ...patch } : l)));

  const submit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    try {
      const payloadLines = filledLines.map((l) => ({
        accountCode: l.accountCode,
        debit: l.debit && (parseEGPToPiasters(l.debit) ?? 0) > 0 ? l.debit : '0.00',
        credit: l.credit && (parseEGPToPiasters(l.credit) ?? 0) > 0 ? l.credit : '0.00',
        note: '',
      }));
      await api.post('journal', { date, memo: memo.trim(), type, lines: payloadLines });
      toast({ title: 'تم ترحيل القيد', description: `${filledLines.length} أطراف — ${formatEGP(diff === 0 ? filledLines.reduce((s, l) => s + (parseEGPToPiasters(l.debit) ?? 0), 0) : 0)}`, variant: 'success' });
      onCreated();
    } catch (e) {
      toast({ title: 'تعذر ترحيل القيد', description: e instanceof ErpError ? e.message : 'خطأ غير متوقع', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto scrollbar-erp sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>قيد يومية جديد</DialogTitle>
          <DialogDescription>المدين يجب أن يساوي الدائن — لا يُرحَّل القيد إلا متوازناً تماماً.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="je-date">التاريخ</Label>
              <Input id="je-date" type="date" dir="ltr" className="h-11 text-left tabular-nums" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>نوع القيد</Label>
              <Select value={type} onValueChange={(v) => setType(v as 'standard' | 'adjusting')}>
                <SelectTrigger className="h-11 w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="standard">قيود عادية</SelectItem>
                  <SelectItem value="adjusting">قيد تسوية</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2 space-y-2 sm:col-span-1">
              <Label htmlFor="je-memo">البيان</Label>
              <Input id="je-memo" className="h-11" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="وصف القيد" />
            </div>
          </div>

          {/* الأطراف */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>أطراف القيد</Label>
              <span className={cn('flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold tabular-nums',
                diff === 0 && filledLines.length >= 2
                  ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'
                  : 'bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300')}>
                <Scale className="size-3.5" aria-hidden />
                فرق التوازن: <Ltr>{formatEGP(diff)}</Ltr>
              </span>
            </div>
            <div className="space-y-2">
              {lines.map((l, idx) => {
                const debitP = parseEGPToPiasters(l.debit);
                const creditP = parseEGPToPiasters(l.credit);
                return (
                  <div key={idx} className="grid grid-cols-1 gap-2 rounded-lg border bg-muted/20 p-2 sm:grid-cols-[1fr_110px_110px_auto]">
                    <Select value={l.accountCode} onValueChange={(v) => setLine(idx, { accountCode: v })}>
                      <SelectTrigger className="h-11 w-full" aria-label={`حساب الطرف ${idx + 1}`}>
                        <SelectValue placeholder="اختر الحساب…" />
                      </SelectTrigger>
                      <SelectContent className="max-h-64">
                        {postingAccounts.map((a) => (
                          <SelectItem key={a.code} value={a.code}>
                            <span className="flex items-center gap-2">
                              <Ltr className="text-xs text-muted-foreground">{a.code}</Ltr> {a.name}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <div className="relative">
                      <Input
                        dir="ltr" inputMode="decimal" placeholder="مدين" aria-label="مدين بالجنيه"
                        className="h-11 pl-10 text-left tabular-nums"
                        value={l.debit}
                        onChange={(e) => setLine(idx, { debit: e.target.value.replace(/[^\d.]/g, ''), credit: '' })}
                      />
                      <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-[10px] text-muted-foreground">ج.م</span>
                    </div>
                    <div className="relative">
                      <Input
                        dir="ltr" inputMode="decimal" placeholder="دائن" aria-label="دائن بالجنيه"
                        className="h-11 pl-10 text-left tabular-nums"
                        value={l.credit}
                        onChange={(e) => setLine(idx, { credit: e.target.value.replace(/[^\d.]/g, ''), debit: '' })}
                      />
                      <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-[10px] text-muted-foreground">ج.م</span>
                    </div>
                    <Button
                      variant="ghost" size="icon" className="size-11 shrink-0 text-muted-foreground hover:text-destructive"
                      aria-label="حذف الطرف"
                      disabled={lines.length <= 2}
                      onClick={() => setLines((ls) => ls.filter((_, i) => i !== idx))}
                    >
                      ×
                    </Button>
                    {(l.debit && l.credit) ? (
                      <p className="text-xs text-destructive sm:col-span-4">أدخل مديناً أو دائناً فقط — ليس الاثنين معاً.</p>
                    ) : l.debit && debitP === null ? (
                      <p className="text-xs text-destructive sm:col-span-4">مبلغ المدين غير صالح (منزلتان كحد أقصى).</p>
                    ) : l.credit && creditP === null ? (
                      <p className="text-xs text-destructive sm:col-span-4">مبلغ الدائن غير صالح (منزلتان كحد أقصى).</p>
                    ) : null}
                  </div>
                );
              })}
            </div>
            <Button variant="outline" className="min-h-11 w-full gap-1.5 border-dashed"
              onClick={() => setLines((ls) => [...ls, emptyLine()])}>
              <Plus className="size-4" aria-hidden /> إضافة طرف
            </Button>
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" className="min-h-11" onClick={() => onOpenChange(false)}>إلغاء</Button>
          <Button className="min-h-11 bg-emerald-600 text-white hover:bg-emerald-700" disabled={!canSubmit} onClick={() => void submit()}>
            {saving ? 'جارٍ الترحيل…' : 'ترحيل القيد'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
