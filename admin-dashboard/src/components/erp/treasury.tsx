'use client';

/**
 * الخزائن والبنوك — بطاقات أرصدة حية، إنشاء خزينة/بنك، سندات صرف إلى حسابات
 * مصروف/سلف/رأس مال مع رسالة عدم كفاية الرصيد، تحويلات، وتسوية بنكية بمطابقة قيود.
 */
import * as React from 'react';
import { ArrowLeftRight, Banknote, CheckSquare, Landmark, Plus, Scale, Wallet } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  EmptyState, LoadError, LoadingBlock, Ltr, Money, SectionCard, ToneBadge, useAsyncData,
} from '@/components/erp/shared';
import { useToast } from '@/hooks/use-toast';
import {
  api, can, ErpError, formatDate, formatEGP, parseEGPToPiasters, todayISO,
  type Account, type ErpUser, type JournalEntry, type LedgerReport, type TreasuryAccount, type TreasuryReconciliation,
} from '@/lib/erp';
import { cn } from '@/lib/utils';

export function TreasurySection({ user }: { user: ErpUser }) {
  const accountsState = useAsyncData<{ accounts: TreasuryAccount[] }>(() => api.get('treasury/accounts'), []);
  const accState = useAsyncData<{ accounts: Account[] }>(() => api.get('accounts'), []);
  const journalState = useAsyncData<{ entries: JournalEntry[] }>(() => api.get('journal?limit=30'), []);
  const reconState = useAsyncData<{ reconciliations: TreasuryReconciliation[] }>(() => api.get('treasury/reconciliations'), []);

  const manage = can(user, 'treasury:manage');
  const canCreate = manage && (user.role === 'admin' || user.role === 'manager');
  const treasuries = accountsState.data?.accounts ?? [];

  const [createOpen, setCreateOpen] = React.useState(false);
  const [disburseOpen, setDisburseOpen] = React.useState(false);
  const [transferOpen, setTransferOpen] = React.useState(false);
  const [reconcileOpen, setReconcileOpen] = React.useState(false);

  const refresh = () => {
    accountsState.reload();
    reconState.reload();
    journalState.reload();
  };

  /** سندات الصرف/التحويل/القبض — أحدث القيود التي تمس حسابات الخزائن */
  const vouchers = React.useMemo(() => {
    const treasuryCodes = new Set(treasuries.map((t) => t.accountCode));
    return (journalState.data?.entries ?? [])
      .filter((e) => e.lines.some((l) => treasuryCodes.has(l.accountCode)))
      .slice(0, 10);
  }, [journalState.data, treasuries]);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {accountsState.loading
          ? Array.from({ length: 2 }).map((_, i) => <div key={i} className="h-36 animate-pulse rounded-xl border bg-muted/30" />)
          : treasuries.map((t) => (
              <div key={t.id} className="rounded-xl border bg-background p-5 shadow-sm transition-shadow hover:shadow-md">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <span className={cn('flex size-10 items-center justify-center rounded-xl text-white',
                      t.type === 'bank' ? 'bg-slate-700' : 'bg-emerald-600')}>
                      {t.type === 'bank' ? <Landmark className="size-5" aria-hidden /> : <Wallet className="size-5" aria-hidden />}
                    </span>
                    <div>
                      <p className="font-bold">{t.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {t.type === 'bank' ? 'حساب بنكي' : 'خزينة نقدية'}
                        {t.bankName ? <> · {t.bankName}</> : null}
                      </p>
                    </div>
                  </div>
                  <ToneBadge tone={t.type === 'bank' ? 'accent' : 'info'}><Ltr>{t.accountCode}</Ltr></ToneBadge>
                </div>
                <p className="mt-4 text-2xl font-extrabold tabular-nums text-emerald-700 dark:text-emerald-400">
                  <Money p={t.balancePiasters} />
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">الرصيد الحي من دفتر الأستاذ</p>
              </div>
            ))}
      </div>

      {canCreate ? (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="min-h-11 gap-1.5" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" aria-hidden /> خزينة / بنك جديد
          </Button>
          <Button variant="outline" className="min-h-11 gap-1.5" onClick={() => setDisburseOpen(true)}>
            <Banknote className="size-4" aria-hidden /> سند صرف
          </Button>
          <Button variant="outline" className="min-h-11 gap-1.5" onClick={() => setTransferOpen(true)}>
            <ArrowLeftRight className="size-4" aria-hidden /> تحويل بين خزائن
          </Button>
          <Button variant="outline" className="min-h-11 gap-1.5" onClick={() => setReconcileOpen(true)}>
            <Scale className="size-4" aria-hidden /> تسوية بنكية
          </Button>
        </div>
      ) : manage ? (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="min-h-11 gap-1.5" onClick={() => setDisburseOpen(true)}>
            <Banknote className="size-4" aria-hidden /> سند صرف
          </Button>
          <Button variant="outline" className="min-h-11 gap-1.5" onClick={() => setTransferOpen(true)}>
            <ArrowLeftRight className="size-4" aria-hidden /> تحويل بين خزائن
          </Button>
          <Button variant="outline" className="min-h-11 gap-1.5" onClick={() => setReconcileOpen(true)}>
            <Scale className="size-4" aria-hidden /> تسوية بنكية
          </Button>
        </div>
      ) : null}

      {/* سندات حديثة تمس الخزائن */}
      <SectionCard title="أحدث السندات على الخزائن" description="قيود الصرف والتحويل والقبض التي تحركت بها الأرصدة">
        {accountsState.loading || journalState.loading ? <LoadingBlock rows={4} />
          : vouchers.length === 0 ? <EmptyState title="لا حركات نقدية بعد" />
          : (
            <div className="max-h-72 space-y-2 overflow-y-auto scrollbar-erp pl-1">
              {vouchers.map((v) => {
                const amount = v.lines.reduce((s, l) => s + (l.debit || 0), 0);
                return (
                  <div key={v.id} className="flex items-center gap-3 rounded-lg border bg-background px-3 py-2.5">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
                      <Banknote className="size-4.5" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium">{v.memo}</p>
                      <p className="text-[11px] text-muted-foreground">
                        <Ltr>{v.number}</Ltr> · <Ltr>{formatDate(v.date)}</Ltr>
                      </p>
                    </div>
                    <Money p={amount} withSymbol={false} className="text-xs" />
                  </div>
                );
              })}
            </div>
          )}
      </SectionCard>

      {/* التسويات السابقة */}
      <SectionCard title="التسويات البنكية" description="مطابقات كشوف الحسابات المحفوظة">
        {reconState.loading ? <LoadingBlock rows={3} />
          : reconState.error ? <LoadError error={reconState.error} onRetry={reconState.reload} />
          : (reconState.data?.reconciliations.length ?? 0) === 0 ? <EmptyState title="لا تسويات محفوظة بعد" hint="أنشئ تسوية لمطابقة كشف البنك مع الدفاتر" />
          : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-b text-right text-xs text-muted-foreground">
                    <th className="px-2 py-2.5 font-medium">الخزينة/البنك</th>
                    <th className="px-2 py-2.5 font-medium">تاريخ الكشف</th>
                    <th className="px-2 py-2.5 font-medium">رصيد الكشف</th>
                    <th className="px-2 py-2.5 font-medium">رصيد الدفاتر</th>
                    <th className="px-2 py-2.5 font-medium">الفرق</th>
                  </tr>
                </thead>
                <tbody>
                  {(reconState.data?.reconciliations ?? []).map((r) => (
                    <tr key={r.id} className="border-b last:border-0">
                      <td className="px-2 py-2.5 text-xs">{r.bankName ?? r.treasuryAccountId}</td>
                      <td className="px-2 py-2.5 text-xs"><Ltr>{formatDate(r.statementDate)}</Ltr></td>
                      <td className="px-2 py-2.5"><Money p={r.statementBalance} withSymbol={false} /></td>
                      <td className="px-2 py-2.5"><Money p={r.bookBalance ?? 0} withSymbol={false} /></td>
                      <td className="px-2 py-2.5">
                        {(r.difference ?? 0) === 0
                          ? <ToneBadge tone="success">مطابق ✓</ToneBadge>
                          : <span className="font-semibold text-amber-700 dark:text-amber-400"><Money p={r.difference ?? 0} /></span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </SectionCard>

      <CreateTreasuryDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={refresh} />

      <DisburseDialog
        open={disburseOpen}
        onOpenChange={setDisburseOpen}
        treasuries={treasuries}
        accounts={accState.data?.accounts ?? []}
        onDone={() => { setDisburseOpen(false); refresh(); }}
      />

      <TransferDialog
        open={transferOpen}
        onOpenChange={setTransferOpen}
        treasuries={treasuries}
        onDone={() => { setTransferOpen(false); refresh(); }}
      />

      <ReconcileDialog
        open={reconcileOpen}
        onOpenChange={setReconcileOpen}
        treasuries={treasuries}
        onDone={() => { setReconcileOpen(false); refresh(); }}
      />
    </div>
  );
}

/* ----------------------------- إنشاء خزينة -------------------------------- */

function CreateTreasuryDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (v: boolean) => void; onCreated: () => void }) {
  const { toast } = useToast();
  const [name, setName] = React.useState('');
  const [type, setType] = React.useState<'cash' | 'bank'>('cash');
  const [bankName, setBankName] = React.useState('');
  const [opening, setOpening] = React.useState('');
  const [date, setDate] = React.useState(todayISO());
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (open) { setName(''); setType('cash'); setBankName(''); setOpening(''); setDate(todayISO()); }
  }, [open]);

  const openingP = parseEGPToPiasters(opening);
  const canSubmit = name.trim().length >= 2 && (!opening || openingP !== null) && !saving && (type === 'cash' || bankName.trim());

  const submit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    try {
      await api.post('treasury/accounts', {
        name: name.trim(), type,
        bankName: type === 'bank' ? bankName.trim() : undefined,
        openingBalance: opening || '0', date,
      });
      toast({ title: 'تم إنشاء الحساب', description: `${name.trim()} مع حساب فرعي في الشجرة`, variant: 'success' });
      onCreated();
    } catch (e) {
      toast({ title: 'تعذر الإنشاء', description: e instanceof ErpError ? e.message : 'خطأ غير متوقع', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>خزينة / حساب بنكي جديد</DialogTitle>
          <DialogDescription>يُنشأ حساب فرعي تلقائياً: <Ltr>1110-Txx</Ltr> نقدي أو <Ltr>1115-Bxx</Ltr> بنكي.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="space-y-2">
            <Label htmlFor="tr-name">الاسم</Label>
            <Input id="tr-name" className="h-11" value={name} onChange={(e) => setName(e.target.value)} placeholder="مثال: خزينة الفرع" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>النوع</Label>
              <Select value={type} onValueChange={(v) => setType(v as 'cash' | 'bank')}>
                <SelectTrigger className="h-11 w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">خزينة نقدية</SelectItem>
                  <SelectItem value="bank">حساب بنكي</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {type === 'bank' ? (
              <div className="space-y-2">
                <Label htmlFor="tr-bank">اسم البنك</Label>
                <Input id="tr-bank" className="h-11" value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="مثال: بنك مصر" />
              </div>
            ) : null}
            <div className={type === 'bank' ? 'col-span-2' : ''}>
              <Label htmlFor="tr-opening">الرصيد الافتتاحي (اختياري)</Label>
              <div className="relative mt-2">
                <Input id="tr-opening" dir="ltr" inputMode="decimal" className="h-11 pl-10 text-left tabular-nums" value={opening}
                  onChange={(e) => setOpening(e.target.value.replace(/[^\d.]/g, ''))} placeholder="0.00" />
                <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-[10px] text-muted-foreground">ج.م</span>
              </div>
              {opening && openingP === null ? <p className="mt-1 text-xs text-destructive">مبلغ غير صالح</p> : null}
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="tr-date">تاريخ الافتتاح</Label>
            <Input id="tr-date" type="date" dir="ltr" className="h-11 text-left tabular-nums" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" className="min-h-11" onClick={() => onOpenChange(false)}>إلغاء</Button>
          <Button className="min-h-11 bg-emerald-600 text-white hover:bg-emerald-700" disabled={!canSubmit} onClick={() => void submit()}>
            {saving ? 'جارٍ الإنشاء…' : 'إنشاء'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------ سند صرف ----------------------------------- */

function DisburseDialog({
  open, onOpenChange, treasuries, accounts, onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  treasuries: TreasuryAccount[];
  accounts: Account[];
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [treasuryId, setTreasuryId] = React.useState('');
  const [counterCode, setCounterCode] = React.useState('');
  const [amount, setAmount] = React.useState('');
  const [date, setDate] = React.useState(todayISO());
  const [memo, setMemo] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [inlineError, setInlineError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setTreasuryId(treasuries[0]?.id ?? '');
      setCounterCode(''); setAmount(''); setDate(todayISO()); setMemo(''); setInlineError(null);
    }
  }, [open]);

  /** الحسابات المقابلة المسموحة: مصروفات 5xxx + سلف موظفين 1140 + رأس المال 3100 */
  const counterAccounts = React.useMemo(
    () => accounts.filter((a) => a.kind === 'posting' && a.active && (a.code.startsWith('5') || a.code === '1140' || a.code === '3100')),
    [accounts],
  );

  const amountP = parseEGPToPiasters(amount);
  const selected = treasuries.find((t) => t.id === treasuryId) ?? null;
  const canSubmit = treasuryId && counterCode && amountP !== null && amountP > 0 && memo.trim().length >= 3 && !saving;

  const submit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    setInlineError(null);
    try {
      await api.post('treasury/disbursements', {
        treasuryAccountId: treasuryId, counterAccountCode: counterCode, amount, date, memo: memo.trim(),
      });
      toast({ title: 'تم ترحيل سند الصرف', description: `${formatEGP(amountP)} من ${selected?.name ?? ''}`, variant: 'success' });
      onDone();
    } catch (e) {
      const message = e instanceof ErpError ? e.message : 'خطأ غير متوقع';
      setInlineError(message);
      toast({ title: 'تعذر الصرف', description: message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>سند صرف</DialogTitle>
          <DialogDescription>مدين الحساب المقابل | دائن الخزينة — يُرفض الصرف إذا لم يكفِ الرصيد.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>من خزينة</Label>
              <Select value={treasuryId} onValueChange={setTreasuryId}>
                <SelectTrigger className="h-11 w-full"><SelectValue placeholder="اختر…" /></SelectTrigger>
                <SelectContent>
                  {treasuries.filter((t) => t.active !== false).map((t) => (
                    <SelectItem key={t.id} value={t.id}>{t.name} — <Money p={t.balancePiasters} withSymbol={false} /></SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>الحساب المقابل</Label>
              <Select value={counterCode} onValueChange={setCounterCode}>
                <SelectTrigger className="h-11 w-full"><SelectValue placeholder="اختر…" /></SelectTrigger>
                <SelectContent className="max-h-64">
                  {counterAccounts.map((a) => (
                    <SelectItem key={a.code} value={a.code}>
                      <span className="flex items-center gap-2"><Ltr className="text-xs text-muted-foreground">{a.code}</Ltr> {a.name}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>المبلغ</Label>
              <div className="relative">
                <Input dir="ltr" inputMode="decimal" className="h-11 pl-10 text-left tabular-nums" value={amount}
                  onChange={(e) => { setAmount(e.target.value.replace(/[^\d.]/g, '')); setInlineError(null); }} placeholder="0.00" />
                <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-[10px] text-muted-foreground">ج.م</span>
              </div>
              {amount && amountP === null ? <p className="text-xs text-destructive">مبلغ غير صالح</p> : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="dis-date">التاريخ</Label>
              <Input id="dis-date" type="date" dir="ltr" className="h-11 text-left tabular-nums" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="dis-memo">البيان</Label>
            <Input id="dis-memo" className="h-11" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="مثال: سداد إيجار المكتب" />
          </div>
          {inlineError ? (
            <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{inlineError}</p>
          ) : null}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" className="min-h-11" onClick={() => onOpenChange(false)}>إلغاء</Button>
          <Button className="min-h-11 bg-emerald-600 text-white hover:bg-emerald-700" disabled={!canSubmit} onClick={() => void submit()}>
            {saving ? 'جارٍ الترحيل…' : 'ترحيل الصرف'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------- تحويل ------------------------------------- */

function TransferDialog({
  open, onOpenChange, treasuries, onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  treasuries: TreasuryAccount[];
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [fromId, setFromId] = React.useState('');
  const [toId, setToId] = React.useState('');
  const [amount, setAmount] = React.useState('');
  const [date, setDate] = React.useState(todayISO());
  const [memo, setMemo] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [inlineError, setInlineError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setFromId(treasuries[0]?.id ?? '');
      setToId(treasuries[1]?.id ?? '');
      setAmount(''); setDate(todayISO()); setMemo(''); setInlineError(null);
    }
  }, [open]);

  const amountP = parseEGPToPiasters(amount);
  const same = fromId && fromId === toId;
  const canSubmit = fromId && toId && !same && amountP !== null && amountP > 0 && !saving;

  const submit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    setInlineError(null);
    try {
      await api.post('treasury/transfers', { fromTreasuryAccountId: fromId, toTreasuryAccountId: toId, amount, date, memo: memo.trim() || undefined });
      toast({ title: 'تم التحويل', description: `${formatEGP(amountP)} بين الحسابين — قيد بطرفين نقديين`, variant: 'success' });
      onDone();
    } catch (e) {
      const message = e instanceof ErpError ? e.message : 'خطأ غير متوقع';
      setInlineError(message);
      toast({ title: 'تعذر التحويل', description: message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>تحويل بين خزينتين</DialogTitle>
          <DialogDescription>قيد واحد بطرفين نقديين — صافي أثره صفر على إجمالي النقد.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>من</Label>
              <Select value={fromId} onValueChange={(v) => { setFromId(v); setInlineError(null); }}>
                <SelectTrigger className="h-11 w-full"><SelectValue placeholder="من…" /></SelectTrigger>
                <SelectContent>
                  {treasuries.map((t) => (
                    <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>إلى</Label>
              <Select value={toId} onValueChange={(v) => { setToId(v); setInlineError(null); }}>
                <SelectTrigger className="h-11 w-full"><SelectValue placeholder="إلى…" /></SelectTrigger>
                <SelectContent>
                  {treasuries.map((t) => (
                    <SelectItem key={t.id} value={t.id} disabled={t.id === fromId}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>المبلغ</Label>
              <div className="relative">
                <Input dir="ltr" inputMode="decimal" className="h-11 pl-10 text-left tabular-nums" value={amount}
                  onChange={(e) => { setAmount(e.target.value.replace(/[^\d.]/g, '')); setInlineError(null); }} placeholder="0.00" />
                <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-[10px] text-muted-foreground">ج.م</span>
              </div>
              {amount && amountP === null ? <p className="text-xs text-destructive">مبلغ غير صالح</p> : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="trf-date">التاريخ</Label>
              <Input id="trf-date" type="date" dir="ltr" className="h-11 text-left tabular-nums" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="trf-memo">ملاحظة</Label>
            <Input id="trf-memo" className="h-11" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="اختياري" />
          </div>
          {same ? <p className="text-xs text-destructive">اختر خزينتين مختلفتين.</p> : null}
          {inlineError ? (
            <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{inlineError}</p>
          ) : null}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" className="min-h-11" onClick={() => onOpenChange(false)}>إلغاء</Button>
          <Button className="min-h-11 bg-emerald-600 text-white hover:bg-emerald-700" disabled={!canSubmit} onClick={() => void submit()}>
            {saving ? 'جارٍ التحويل…' : 'تنفيذ التحويل'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------ تسوية بنكية -------------------------------- */

function ReconcileDialog({
  open, onOpenChange, treasuries, onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  treasuries: TreasuryAccount[];
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [treasuryId, setTreasuryId] = React.useState('');
  const [statementDate, setStatementDate] = React.useState(todayISO());
  const [statementBalance, setStatementBalance] = React.useState('');
  const [cleared, setCleared] = React.useState<Set<string>>(new Set());
  const [saving, setSaving] = React.useState(false);

  const selected = treasuries.find((t) => t.id === treasuryId) ?? null;
  const ledgerState = useAsyncData<LedgerReport | null>(
    async () => (open && selected ? api.get(`reports/ledger/${encodeURIComponent(selected.accountCode)}`) : null),
    [open, selected?.accountCode],
  );

  React.useEffect(() => {
    if (open) {
      setTreasuryId(treasuries[0]?.id ?? '');
      setStatementDate(todayISO());
      setStatementBalance('');
      setCleared(new Set());
    }
  }, [open]);

  const stmtP = parseEGPToPiasters(statementBalance);
  const bookBalance = ledgerState.data?.closingBalance ?? 0;
  const difference = stmtP === null ? null : stmtP - bookBalance;

  const toggleCleared = (id: string) =>
    setCleared((prev) => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id);
      else s.add(id);
      return s;
    });

  const submit = async () => {
    if (!treasuryId || stmtP === null) return;
    setSaving(true);
    try {
      await api.post('treasury/reconciliations', {
        treasuryAccountId: treasuryId, statementDate, statementBalance, clearedEntryIds: Array.from(cleared),
      });
      toast({
        title: 'تم حفظ التسوية',
        description: difference === 0 ? 'الكشف مطابق للدفاتر تماماً' : `فرق مسجل: ${formatEGP(difference ?? 0)}`,
        variant: 'success',
      });
      onDone();
    } catch (e) {
      toast({ title: 'تعذر حفظ التسوية', description: e instanceof ErpError ? e.message : 'خطأ غير متوقع', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto scrollbar-erp sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>تسوية بنكية</DialogTitle>
          <DialogDescription>أدخل رصيد كشف البنك وعلّم القيود المُسقطة (المصروفة) لاحتساب الفرق.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-2">
              <Label>الخزينة/البنك</Label>
              <Select value={treasuryId} onValueChange={(v) => { setTreasuryId(v); setCleared(new Set()); }}>
                <SelectTrigger className="h-11 w-full"><SelectValue placeholder="اختر…" /></SelectTrigger>
                <SelectContent>
                  {treasuries.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="rec-st-date">تاريخ الكشف</Label>
              <Input id="rec-st-date" type="date" dir="ltr" className="h-11 text-left tabular-nums" value={statementDate} onChange={(e) => setStatementDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>رصيد الكشف</Label>
              <div className="relative">
                <Input dir="ltr" inputMode="decimal" className="h-11 pl-10 text-left tabular-nums" value={statementBalance}
                  onChange={(e) => setStatementBalance(e.target.value.replace(/[^\d.]/g, ''))} placeholder="0.00" />
                <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-[10px] text-muted-foreground">ج.م</span>
              </div>
              {statementBalance && stmtP === null ? <p className="text-xs text-destructive">مبلغ غير صالح</p> : null}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 rounded-lg border bg-muted/30 p-3 text-center text-xs">
            <div>
              <p className="text-muted-foreground">رصيد الدفاتر</p>
              <p className="mt-1 font-bold"><Money p={bookBalance} /></p>
            </div>
            <div>
              <p className="text-muted-foreground">رصيد الكشف</p>
              <p className="mt-1 font-bold">{stmtP === null ? '—' : <Money p={stmtP} />}</p>
            </div>
            <div>
              <p className="text-muted-foreground">الفرق</p>
              <p className={cn('mt-1 font-bold', difference === null ? '' : difference === 0 ? 'text-emerald-600' : 'text-amber-600')}>
                {difference === null ? '—' : <Money p={difference} />}
              </p>
            </div>
          </div>

          {ledgerState.loading ? <LoadingBlock rows={3} label="جارٍ جلب حركات الحساب…" />
            : ledgerState.error ? <LoadError error={ledgerState.error} onRetry={ledgerState.reload} />
            : (ledgerState.data?.movements.length ?? 0) === 0 ? <EmptyState title="لا حركات على هذا الحساب" />
            : (
              <div>
                <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
                  <CheckSquare className="size-4 text-emerald-600" aria-hidden />
                  القيود — علّم المسقطة على الكشف (<Ltr>{cleared.size}</Ltr> محدد)
                </p>
                <div className="max-h-52 space-y-1.5 overflow-y-auto rounded-lg border p-2 scrollbar-erp">
                  {ledgerState.data!.movements.map((m) => (
                    <label key={m.entryId} className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-2 hover:bg-muted/50">
                      <input
                        type="checkbox"
                        checked={cleared.has(m.entryId)}
                        onChange={() => toggleCleared(m.entryId)}
                        className="size-4 accent-emerald-600"
                        aria-label={`إسقاط القيد ${m.number}`}
                      />
                      <span className="w-28 shrink-0"><Ltr className="text-[11px] font-semibold">{m.number}</Ltr></span>
                      <span className="w-20 shrink-0 text-[11px] text-muted-foreground"><Ltr>{formatDate(m.date)}</Ltr></span>
                      <span className="min-w-0 flex-1 truncate text-xs">{m.memo}</span>
                      <span className="shrink-0 tabular-nums text-xs"><Money p={m.debit - m.credit} withSymbol={false} /></span>
                    </label>
                  ))}
                </div>
              </div>
            )}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" className="min-h-11" onClick={() => onOpenChange(false)}>إلغاء</Button>
          <Button className="min-h-11 bg-emerald-600 text-white hover:bg-emerald-700" disabled={!treasuryId || stmtP === null || saving} onClick={() => void submit()}>
            {saving ? 'جارٍ الحفظ…' : 'حفظ التسوية'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
