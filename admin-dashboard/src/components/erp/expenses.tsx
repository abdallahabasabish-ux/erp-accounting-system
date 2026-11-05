'use client';

/**
 * المصروفات — سندات مصروف تُرحَّل فوراً: فئة جاهزة (9 فئات موروثة) أو حساب 5xxx
 * مباشر، ودفع نقدي من خزينة أو شراء آجل على مورد.
 */
import * as React from 'react';
import { Plus, Receipt } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  EmptyState, LoadError, LoadingTable, Ltr, Money, ScrollTable, SectionCard, ToneBadge, useAsyncData,
} from '@/components/erp/shared';
import { useToast } from '@/hooks/use-toast';
import {
  EXPENSE_CATEGORIES, EXPENSE_CATEGORY_LABELS, api, can, ErpError, formatEGP, formatDate, parseEGPToPiasters, todayISO,
  type Account, type ErpUser, type Expense, type ExpenseCategory, type TreasuryAccount,
} from '@/lib/erp';

export function ExpensesSection({ user }: { user: ErpUser }) {
  const { data, loading, error, reload } = useAsyncData<{ expenses: Expense[] }>(() => api.get('expenses'), []);
  const [createOpen, setCreateOpen] = React.useState(false);
  const expenses = data?.expenses ?? [];

  return (
    <SectionCard
      title="المصروفات"
      description="كل سند مصروف يُرحِّل قيداً مزدوجاً: مدين مصروف | دائن خزينة أو مورد"
      actions={can(user, 'expenses:create') ? (
        <Button size="sm" className="min-h-11 gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700" onClick={() => setCreateOpen(true)}>
          <Plus className="size-4" aria-hidden /> مصروف جديد
        </Button>
      ) : undefined}
    >
      {loading ? <LoadingTable cols={6} />
        : error ? <LoadError error={error} onRetry={reload} />
        : expenses.length === 0 ? <EmptyState title="لا مصروفات مسجلة" hint="سجّل أول سند مصروف" />
        : (
          <ScrollTable maxHeight="max-h-[520px]">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-background shadow-[0_1px_0_0_var(--border)]">
                <tr className="text-right text-xs text-muted-foreground">
                  <th className="px-2 py-2.5 font-medium">الرقم</th>
                  <th className="px-2 py-2.5 font-medium">التاريخ</th>
                  <th className="px-2 py-2.5 font-medium">البيان</th>
                  <th className="px-2 py-2.5 font-medium">الفئة</th>
                  <th className="px-2 py-2.5 font-medium">حساب المصروف</th>
                  <th className="px-2 py-2.5 font-medium">مصدر الدفع</th>
                  <th className="px-2 py-2.5 font-medium">المبلغ</th>
                </tr>
              </thead>
              <tbody>
                {expenses.map((ex) => (
                  <tr key={ex.id} className="border-t transition-colors hover:bg-muted/40">
                    <td className="whitespace-nowrap px-2 py-2.5"><Ltr className="text-xs font-bold">{ex.number}</Ltr></td>
                    <td className="whitespace-nowrap px-2 py-2.5 text-xs text-muted-foreground"><Ltr>{formatDate(ex.date)}</Ltr></td>
                    <td className="max-w-52 px-2 py-2.5"><span className="line-clamp-1 text-xs">{ex.memo}</span></td>
                    <td className="px-2 py-2.5"><ToneBadge tone="warning">{EXPENSE_CATEGORY_LABELS[ex.category] ?? ex.category}</ToneBadge></td>
                    <td className="px-2 py-2.5 text-xs">
                      <Ltr className="text-muted-foreground">{ex.expenseAccountCode}</Ltr> {ex.expenseAccountName}
                    </td>
                    <td className="px-2 py-2.5 text-xs text-muted-foreground">{ex.creditLabel}</td>
                    <td className="whitespace-nowrap px-2 py-2.5"><Money p={ex.amount} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollTable>
        )}

      <CreateExpenseDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => { setCreateOpen(false); reload(); }}
      />
    </SectionCard>
  );
}

function CreateExpenseDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (v: boolean) => void; onCreated: () => void }) {
  const { toast } = useToast();
  const [source, setSource] = React.useState<'category' | 'account'>('category');
  const [category, setCategory] = React.useState<ExpenseCategory>('operating');
  const [accountCode, setAccountCode] = React.useState('');
  const [amount, setAmount] = React.useState('');
  const [memo, setMemo] = React.useState('');
  const [date, setDate] = React.useState(todayISO());
  const [payMode, setPayMode] = React.useState<'cash' | 'credit'>('cash');
  const [treasuryId, setTreasuryId] = React.useState('');
  const [supplierName, setSupplierName] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  const accountsState = useAsyncData<{ accounts: Account[] }>(() => api.get('accounts'), []);
  const treasuriesState = useAsyncData<{ accounts: TreasuryAccount[] }>(() => api.get('treasury/accounts'), []);

  React.useEffect(() => {
    if (open) {
      setSource('category'); setCategory('operating'); setAccountCode(''); setAmount('');
      setMemo(''); setDate(todayISO()); setPayMode('cash'); setTreasuryId(''); setSupplierName('');
    }
  }, [open]);

  const expenseAccounts = React.useMemo(
    () => (accountsState.data?.accounts ?? []).filter((a) => a.kind === 'posting' && a.active && a.code.startsWith('5')),
    [accountsState.data],
  );
  React.useEffect(() => {
    if (!accountCode && expenseAccounts.length > 0) setAccountCode(expenseAccounts[0].code);
  }, [expenseAccounts.length]);

  React.useEffect(() => {
    if (open && !treasuryId) {
      const first = (treasuriesState.data?.accounts ?? []).find((t) => t.active !== false);
      if (first) setTreasuryId(first.id);
    }
  }, [open, treasuriesState.data]);

  const amountP = parseEGPToPiasters(amount);
  const canSubmit =
    amountP !== null && amountP > 0 && memo.trim().length >= 3 && date &&
    (source === 'category' || accountCode) &&
    (payMode === 'cash' ? Boolean(treasuryId) : supplierName.trim().length >= 2) &&
    !saving;

  const submit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    try {
      const body: Record<string, unknown> = { amount, memo: memo.trim(), date };
      if (source === 'category') body.category = category;
      else body.expenseAccountCode = accountCode;
      if (payMode === 'cash') body.treasuryAccountId = treasuryId;
      else { body.paymentMethod = 'credit'; body.supplierName = supplierName.trim(); }
      await api.post('expenses', body);
      toast({
        title: 'تم ترحيل سند المصروف',
        description: `${formatEGP(amountP)} — ${payMode === 'cash' ? 'دفع نقدي' : `آجل على ${supplierName.trim()}`}`,
        variant: 'success',
      });
      onCreated();
    } catch (e) {
      toast({ title: 'تعذر ترحيل المصروف', description: e instanceof ErpError ? e.message : 'خطأ غير متوقع', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto scrollbar-erp sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>سند مصروف جديد</DialogTitle>
          <DialogDescription>اختر فئة جاهزة أو حساب مصروف مباشر (5xxx) — وحدد طريقة الدفع.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <RadioGroup value={source} onValueChange={(v) => setSource(v as 'category' | 'account')} className="grid grid-cols-2 gap-2">
            <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm has-[button[data-state=checked]]:border-emerald-500 has-[button[data-state=checked]]:bg-emerald-50 dark:has-[button[data-state=checked]]:bg-emerald-950/40">
              <RadioGroupItem value="category" aria-label="فئة جاهزة" />
              فئة جاهزة
            </label>
            <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm has-[button[data-state=checked]]:border-emerald-500 has-[button[data-state=checked]]:bg-emerald-50 dark:has-[button[data-state=checked]]:bg-emerald-950/40">
              <RadioGroupItem value="account" aria-label="حساب مباشر" />
              حساب مباشر (5xxx)
            </label>
          </RadioGroup>

          {source === 'category' ? (
            <div className="space-y-2">
              <Label>فئة المصروف</Label>
              <Select value={category} onValueChange={(v) => setCategory(v as ExpenseCategory)}>
                <SelectTrigger className="h-11 w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {EXPENSE_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>{EXPENSE_CATEGORY_LABELS[c]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div className="space-y-2">
              <Label>حساب المصروف (ترحيلي 5xxx)</Label>
              <Select value={accountCode} onValueChange={setAccountCode}>
                <SelectTrigger className="h-11 w-full"><SelectValue placeholder="اختر الحساب…" /></SelectTrigger>
                <SelectContent className="max-h-64">
                  {expenseAccounts.map((a) => (
                    <SelectItem key={a.code} value={a.code}>
                      <span className="flex items-center gap-2"><Ltr className="text-xs text-muted-foreground">{a.code}</Ltr> {a.name}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>المبلغ</Label>
              <div className="relative">
                <Input dir="ltr" inputMode="decimal" className="h-11 pl-10 text-left tabular-nums" value={amount}
                  onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} placeholder="0.00" />
                <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-[10px] text-muted-foreground">ج.م</span>
              </div>
              {amount && amountP === null ? <p className="text-xs text-destructive">مبلغ غير صالح</p> : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="exp-date">التاريخ</Label>
              <Input id="exp-date" type="date" dir="ltr" className="h-11 text-left tabular-nums" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="exp-memo">البيان *</Label>
            <Input id="exp-memo" className="h-11" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="مثال: فاتورة كهرباء المكتب" />
          </div>

          <div className="space-y-2">
            <Label>طريقة الدفع</Label>
            <RadioGroup value={payMode} onValueChange={(v) => setPayMode(v as 'cash' | 'credit')} className="grid grid-cols-2 gap-2">
              <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm has-[button[data-state=checked]]:border-emerald-500 has-[button[data-state=checked]]:bg-emerald-50 dark:has-[button[data-state=checked]]:bg-emerald-950/40">
                <RadioGroupItem value="cash" aria-label="نقدي من خزينة" />
                نقدي من خزينة
              </label>
              <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm has-[button[data-state=checked]]:border-emerald-500 has-[button[data-state=checked]]:bg-emerald-50 dark:has-[button[data-state=checked]]:bg-emerald-950/40">
                <RadioGroupItem value="credit" aria-label="آجل على مورد" />
                آجل على مورد
              </label>
            </RadioGroup>
          </div>

          {payMode === 'cash' ? (
            <div className="space-y-2">
              <Label>خزينة الدفع</Label>
              <Select value={treasuryId} onValueChange={setTreasuryId}>
                <SelectTrigger className="h-11 w-full"><SelectValue placeholder="اختر الخزينة…" /></SelectTrigger>
                <SelectContent>
                  {(treasuriesState.data?.accounts ?? []).filter((t) => t.active !== false).map((t) => (
                    <SelectItem key={t.id} value={t.id}>{t.name} — <Money p={t.balancePiasters} withSymbol={false} /></SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="exp-supplier">اسم المورد</Label>
              <Input id="exp-supplier" className="h-11" value={supplierName} onChange={(e) => setSupplierName(e.target.value)}
                placeholder="مثال: شركة الإمداد للتوريدات" />
              <p className="text-xs text-muted-foreground">يُنشأ حساب ذمة مورد تلقائي تحت <Ltr>2110</Ltr>.</p>
            </div>
          )}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" className="min-h-11" onClick={() => onOpenChange(false)}>إلغاء</Button>
          <Button className="min-h-11 gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700" disabled={!canSubmit} onClick={() => void submit()}>
            <Receipt className="size-4" aria-hidden />
            {saving ? 'جارٍ الترحيل…' : 'ترحيل المصروف'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
