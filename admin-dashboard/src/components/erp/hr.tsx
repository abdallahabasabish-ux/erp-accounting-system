'use client';

/**
 * الموظفون والرواتب — جدول موظفين بالرواتب والسلف، إضافة/تعديل، منح سلفة (مع
 * سقف السلفة) وعمولات، ومسيرات رواتب (إنشاء/اعتماد/صرف/حذف مسودة).
 * دور الموظف يرى قسم «مستحقاتي» فقط من hr/me.
 */
import * as React from 'react';
import { ChevronDown, HandCoins, Percent, Plus, Pencil, Trash2, Wallet } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  EmptyState, LoadError, LoadingTable, Ltr, Money, ScrollTable, SectionCard, StatCard, ToneBadge, useAsyncData,
} from '@/components/erp/shared';
import { useToast } from '@/hooks/use-toast';
import {
  api, can, currentPeriodKey, ErpError, formatDate, formatEGP, parseEGPToPiasters, todayISO,
  type ErpUser, type Employee, type HrMe, type PayrollRun, type TreasuryAccount,
} from '@/lib/erp';
import { cn } from '@/lib/utils';

/* ----------------------------- قسم الموظفين -------------------------------- */

export function HrSection({ user }: { user: ErpUser }) {
  // الموظف — مستحقاته فقط
  if (user.role === 'employee') return <MyDuesSection />;

  return (
    <Tabs defaultValue="employees" className="space-y-4">
      <SectionCard
        title="الموظفون والرواتب"
        description="بيانات الموظفين والسلف والمسيرات الشهرية — كل شيء مرتبط بحسابات الشجرة"
        className="border-0 shadow-none bg-transparent"
        contentClassName="p-0"
      >
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="employees" className="min-h-11 gap-1.5">
            <Wallet className="size-4" aria-hidden /> الموظفون
          </TabsTrigger>
          <TabsTrigger value="payroll" className="min-h-11 gap-1.5">
            <HandCoins className="size-4" aria-hidden /> مسيرات الرواتب
          </TabsTrigger>
        </TabsList>

        <TabsContent value="employees" className="mt-4">
          <EmployeesTab user={user} />
        </TabsContent>
        <TabsContent value="payroll" className="mt-4">
          <PayrollTab user={user} />
        </TabsContent>
      </SectionCard>
    </Tabs>
  );
}

/* --------------------------------- مستحقاتي -------------------------------- */

function MyDuesSection() {
  const { data, loading, error, reload } = useAsyncData<HrMe>(() => api.get('hr/me'), []);

  if (loading) return <SectionCard title="مستحقاتي"><LoadingTable cols={4} rows={4} /></SectionCard>;
  if (error || !data) return <LoadError error={error} onRetry={reload} />;

  return (
    <div className="space-y-4">
      <SectionCard
        title={`مستحقاتي — ${data.employee.name}`}
        description={data.employee.position ? `الوظيفة: ${data.employee.position} · الرمز ${data.employee.code}` : undefined}
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <StatCard title="الراتب الأساسي" value={<Money p={data.employee.salaryBasicPiasters} />} hint={`بدلات: ${formatEGP(data.employee.allowancesPiasters)}`} />
          <StatCard title="سلف مستحقة عليّ" value={<Money p={data.advancesOutstandingPiasters} />} tone={data.advancesOutstandingPiasters > 0 ? 'warning' : 'positive'} />
          <StatCard title="رواتب مستحقة لي" value={<Money p={data.salariesPayablePiasters} />} tone={data.salariesPayablePiasters > 0 ? 'positive' : 'default'} />
        </div>
      </SectionCard>

      <SectionCard title="تاريخ مسيرات رواتبّ" description="صافي راتبك في كل مسير تم صرفه">
        {(data.payrollHistory.length ?? 0) === 0 ? (
          <EmptyState title="لا مسيرات بعد" hint="سيظهر سجل رواتبك بعد أول مسير" />
        ) : (
          <ScrollTable maxHeight="max-h-[380px]">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-background shadow-[0_1px_0_0_var(--border)]">
                <tr className="text-right text-xs text-muted-foreground">
                  <th className="px-2 py-2.5 font-medium">الفترة</th>
                  <th className="px-2 py-2.5 font-medium">التاريخ</th>
                  <th className="px-2 py-2.5 font-medium">الأساسي</th>
                  <th className="px-2 py-2.5 font-medium">البدلات</th>
                  <th className="px-2 py-2.5 font-medium">التأمين</th>
                  <th className="px-2 py-2.5 font-medium">الضريبة</th>
                  <th className="px-2 py-2.5 font-medium">الصافي</th>
                  <th className="px-2 py-2.5 font-medium">الحالة</th>
                </tr>
              </thead>
              <tbody>
                {data.payrollHistory.map((h) => (
                  <tr key={h.period} className="border-t transition-colors hover:bg-muted/40">
                    <td className="px-2 py-2.5"><Ltr className="text-xs font-bold">{h.period}</Ltr></td>
                    <td className="px-2 py-2.5 text-xs text-muted-foreground"><Ltr>{formatDate(h.date)}</Ltr></td>
                    <td className="px-2 py-2.5"><Money p={h.mine.basic} withSymbol={false} /></td>
                    <td className="px-2 py-2.5"><Money p={h.mine.allowances} withSymbol={false} /></td>
                    <td className="px-2 py-2.5"><Money p={h.mine.insurance} withSymbol={false} /></td>
                    <td className="px-2 py-2.5"><Money p={h.mine.tax} withSymbol={false} /></td>
                    <td className="px-2 py-2.5 font-bold"><Money p={h.mine.net} /></td>
                    <td className="px-2 py-2.5">
                      <ToneBadge tone={h.status === 'paid' ? 'success' : h.status === 'approved' ? 'info' : 'neutral'}>
                        {h.status === 'paid' ? 'مصروف' : h.status === 'approved' ? 'معتمد' : 'مسودة'}
                      </ToneBadge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollTable>
        )}
      </SectionCard>
    </div>
  );
}

/* ------------------------------- تبويب الموظفين ------------------------------ */

function EmployeesTab({ user }: { user: ErpUser }) {
  const { toast } = useToast();
  const employeesState = useAsyncData<{ employees: Employee[] }>(() => api.get('hr/employees'), []);
  const treasuriesState = useAsyncData<{ accounts: TreasuryAccount[] }>(() => api.get('treasury/accounts'), []);

  const [formOpen, setFormOpen] = React.useState(false);
  const [editEmp, setEditEmp] = React.useState<Employee | null>(null);
  const [advanceOf, setAdvanceOf] = React.useState<Employee | null>(null);
  const [commissionOf, setCommissionOf] = React.useState<Employee | null>(null);

  const employees = employeesState.data?.employees ?? [];
  const manage = can(user, 'employees:manage') && (user.role === 'admin' || user.role === 'manager');
  const canAdvance = can(user, 'treasury:manage');
  const canCommission = can(user, 'journal:create');

  return (
    <SectionCard
      title="الموظفون"
      description="الرواتب والبدلات والتأمينات والضريبة — والسلف المستحقة لكل موظف"
      actions={manage ? (
        <Button size="sm" className="min-h-11 gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700" onClick={() => setFormOpen(true)}>
          <Plus className="size-4" aria-hidden /> موظف جديد
        </Button>
      ) : undefined}
    >
      {employeesState.loading ? <LoadingTable cols={7} />
        : employeesState.error ? <LoadError error={employeesState.error} onRetry={employeesState.reload} />
        : employees.length === 0 ? <EmptyState title="لا يوجد موظفون" />
        : (
          <ScrollTable maxHeight="max-h-[460px]">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-background shadow-[0_1px_0_0_var(--border)]">
                <tr className="text-right text-xs text-muted-foreground">
                  <th className="px-2 py-2.5 font-medium">الكود</th>
                  <th className="px-2 py-2.5 font-medium">الاسم</th>
                  <th className="px-2 py-2.5 font-medium">الوظيفة</th>
                  <th className="px-2 py-2.5 font-medium">الأساسي</th>
                  <th className="px-2 py-2.5 font-medium">البدلات</th>
                  <th className="px-2 py-2.5 font-medium">تأمين/ضريبة</th>
                  <th className="px-2 py-2.5 font-medium">سلف مستحقة</th>
                  <th className="px-2 py-2.5 font-medium">رواتب مستحقة</th>
                  {manage || canAdvance || canCommission ? <th className="px-2 py-2.5 font-medium text-center">إجراءات</th> : null}
                </tr>
              </thead>
              <tbody>
                {employees.map((emp) => (
                  <tr key={emp.id} className="border-t transition-colors hover:bg-muted/40">
                    <td className="px-2 py-2.5"><Ltr className="text-xs font-bold">{emp.code}</Ltr></td>
                    <td className="max-w-36 truncate px-2 py-2.5">{emp.name}</td>
                    <td className="max-w-28 truncate px-2 py-2.5 text-xs text-muted-foreground">{emp.position || '—'}</td>
                    <td className="px-2 py-2.5"><Money p={emp.salaryBasicPiasters} withSymbol={false} /></td>
                    <td className="px-2 py-2.5"><Money p={emp.allowancesPiasters} withSymbol={false} /></td>
                    <td className="px-2 py-2.5 text-xs text-muted-foreground">
                      <Money p={emp.insuranceEmployeePiasters} withSymbol={false} /> / <Money p={emp.payrollTaxPiasters} withSymbol={false} />
                    </td>
                    <td className="px-2 py-2.5"><Money p={emp.advancesOutstandingPiasters} withSymbol={false} className={emp.advancesOutstandingPiasters > 0 ? 'text-amber-600 dark:text-amber-400' : ''} /></td>
                    <td className="px-2 py-2.5"><Money p={emp.salariesPayablePiasters} withSymbol={false} /></td>
                    {manage || canAdvance || canCommission ? (
                      <td className="px-2 py-2.5">
                        <div className="flex items-center justify-center gap-1">
                          {canAdvance ? (
                            <Button variant="ghost" size="icon" className="size-9" aria-label={`منح سلفة لـ ${emp.name}`} onClick={() => setAdvanceOf(emp)}>
                              <HandCoins className="size-4 text-amber-600" aria-hidden />
                            </Button>
                          ) : null}
                          {canCommission ? (
                            <Button variant="ghost" size="icon" className="size-9" aria-label={`عمولة لـ ${emp.name}`} onClick={() => setCommissionOf(emp)}>
                              <Percent className="size-4 text-teal-600" aria-hidden />
                            </Button>
                          ) : null}
                          {manage ? (
                            <Button variant="ghost" size="icon" className="size-9" aria-label={`تعديل ${emp.name}`} onClick={() => setEditEmp(emp)}>
                              <Pencil className="size-4" aria-hidden />
                            </Button>
                          ) : null}
                        </div>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollTable>
        )}

      <EmployeeFormDialog
        open={formOpen || editEmp !== null}
        employee={editEmp}
        onOpenChange={(v) => { if (!v) { setFormOpen(false); setEditEmp(null); } }}
        onSaved={() => { setFormOpen(false); setEditEmp(null); employeesState.reload(); }}
      />

      <AdvanceDialog
        employee={advanceOf}
        treasuries={treasuriesState.data?.accounts ?? []}
        capHint={null}
        onClose={() => setAdvanceOf(null)}
        onDone={() => { setAdvanceOf(null); employeesState.reload(); }}
      />

      <CommissionDialog
        employee={commissionOf}
        onClose={() => setCommissionOf(null)}
        onDone={() => { setCommissionOf(null); employeesState.reload(); }}
      />
    </SectionCard>
  );
}

/* ----------------------------- نموذج موظف --------------------------------- */

function EmployeeFormDialog({
  open, employee, onOpenChange, onSaved,
}: {
  open: boolean;
  employee: Employee | null;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [name, setName] = React.useState('');
  const [position, setPosition] = React.useState('');
  const [basic, setBasic] = React.useState('');
  const [allowances, setAllowances] = React.useState('');
  const [insurance, setInsurance] = React.useState('');
  const [tax, setTax] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const isEdit = employee !== null;

  React.useEffect(() => {
    if (!open) return;
    setName(employee?.name ?? '');
    setPosition(employee?.position ?? '');
    setBasic(employee ? (employee.salaryBasicPiasters / 100).toFixed(2) : '');
    setAllowances(employee ? (employee.allowancesPiasters / 100).toFixed(2) : '');
    setInsurance(employee ? (employee.insuranceEmployeePiasters / 100).toFixed(2) : '');
    setTax(employee ? (employee.payrollTaxPiasters / 100).toFixed(2) : '');
  }, [open, employee]);

  const amountsOk = [basic, allowances, insurance, tax].every((v) => !v || parseEGPToPiasters(v) !== null);
  const canSubmit = name.trim().length >= 2 && amountsOk && parseEGPToPiasters(basic) !== null && (parseEGPToPiasters(basic) ?? 0) > 0 && !saving;

  const submit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    try {
      const body = {
        name: name.trim(), position: position.trim(),
        salaryBasic: basic || '0', allowances: allowances || '0',
        insuranceEmployee: insurance || '0', payrollTax: tax || '0',
      };
      if (isEdit && employee) await api.patch(`hr/employees/${encodeURIComponent(employee.id)}`, body);
      else await api.post('hr/employees', body);
      toast({ title: isEdit ? 'تم حفظ بيانات الموظف' : 'تم إضافة الموظف', description: name.trim(), variant: 'success' });
      onSaved();
    } catch (e) {
      toast({ title: 'تعذر الحفظ', description: e instanceof ErpError ? e.message : 'خطأ غير متوقع', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const netPreview = (parseEGPToPiasters(basic) ?? 0) + (parseEGPToPiasters(allowances) ?? 0)
    - (parseEGPToPiasters(insurance) ?? 0) - (parseEGPToPiasters(tax) ?? 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? `تعديل: ${employee?.name}` : 'موظف جديد'}</DialogTitle>
          <DialogDescription>
            يُنشأ لكل موظف حساب سلفة <Ltr>1140-Exxxx</Ltr> وحساب راتب مستحق <Ltr>2120-Exxxx</Ltr> تلقائياً.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="emp-name">الاسم *</Label>
              <Input id="emp-name" className="h-11" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="emp-pos">الوظيفة</Label>
              <Input id="emp-pos" className="h-11" value={position} onChange={(e) => setPosition(e.target.value)} placeholder="مثال: محاسب" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <MoneyField id="emp-basic" label="الراتب الأساسي" value={basic} onChange={setBasic} required />
            <MoneyField id="emp-allow" label="البدلات" value={allowances} onChange={setAllowances} />
            <MoneyField id="emp-ins" label="تأمينات الموظف" value={insurance} onChange={setInsurance} />
            <MoneyField id="emp-tax" label="ضريبة كسب العمل" value={tax} onChange={setTax} />
          </div>
          <p className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
            صافي متوقع شهرياً: <span className="font-bold text-foreground"><Money p={netPreview} /></span>
          </p>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" className="min-h-11" onClick={() => onOpenChange(false)}>إلغاء</Button>
          <Button className="min-h-11 bg-emerald-600 text-white hover:bg-emerald-700" disabled={!canSubmit} onClick={() => void submit()}>
            {saving ? 'جارٍ الحفظ…' : isEdit ? 'حفظ' : 'إضافة'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MoneyField({ id, label, value, onChange, required }: { id: string; label: string; value: string; onChange: (v: string) => void; required?: boolean }) {
  const invalid = value && parseEGPToPiasters(value) === null;
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}{required ? ' *' : ''}</Label>
      <div className="relative">
        <Input id={id} dir="ltr" inputMode="decimal" className="h-11 pl-10 text-left tabular-nums" value={value}
          onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, ''))} placeholder="0.00" />
        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-[10px] text-muted-foreground">ج.م</span>
      </div>
      {invalid ? <p className="text-xs text-destructive">مبلغ غير صالح</p> : null}
    </div>
  );
}

/* -------------------------------- سلفة ------------------------------------- */

function AdvanceDialog({
  employee, treasuries, capHint, onClose, onDone,
}: {
  employee: Employee | null;
  treasuries: TreasuryAccount[];
  capHint: string | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [amount, setAmount] = React.useState('');
  const [treasuryId, setTreasuryId] = React.useState('');
  const [memo, setMemo] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [inlineError, setInlineError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (employee) {
      setAmount(''); setTreasuryId(treasuries[0]?.id ?? ''); setMemo(''); setInlineError(null);
    }
  }, [employee]);

  const amountP = parseEGPToPiasters(amount);
  const capP = employee ? Math.round(employee.salaryBasicPiasters * 0.5) : 0; // السقف الافتراضي 50% من الأساسي
  const overCap = amountP !== null && employee && employee.advancesOutstandingPiasters + amountP > capP;
  const canSubmit = employee && amountP !== null && amountP > 0 && treasuryId && !overCap && !saving;

  const submit = async () => {
    if (!canSubmit || !employee) return;
    setSaving(true);
    setInlineError(null);
    try {
      await api.post('hr/advances', { employeeId: employee.id, amount, treasuryAccountId: treasuryId, memo: memo.trim() || undefined });
      toast({ title: 'تم صرف السلفة', description: `${employee.name} — ${formatEGP(amountP)}`, variant: 'success' });
      onDone();
    } catch (e) {
      const message = e instanceof ErpError ? e.message : 'خطأ غير متوقع';
      setInlineError(message);
      toast({ title: 'تعذر صرف السلفة', description: message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={employee !== null} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>منح سلفة: {employee?.name}</DialogTitle>
          <DialogDescription>مدين حساب سلفة الموظف | دائن الخزينة — وتُخصم تلقائياً من مسير الشهر.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          {employee ? (
            <p className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
              السلف القائمة: <Money p={employee.advancesOutstandingPiasters} /> · سقف السلفة (50% من الأساسي):{' '}
              <Money p={capP} />
            </p>
          ) : null}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>المبلغ</Label>
              <div className="relative">
                <Input dir="ltr" inputMode="decimal" className="h-11 pl-10 text-left tabular-nums" value={amount}
                  onChange={(e) => { setAmount(e.target.value.replace(/[^\d.]/g, '')); setInlineError(null); }} placeholder="0.00" />
                <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-[10px] text-muted-foreground">ج.م</span>
              </div>
            </div>
            <div className="space-y-2">
              <Label>من خزينة</Label>
              <Select value={treasuryId} onValueChange={setTreasuryId}>
                <SelectTrigger className="h-11 w-full"><SelectValue placeholder="اختر…" /></SelectTrigger>
                <SelectContent>
                  {treasuries.filter((t) => t.active !== false).map((t) => (
                    <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="adv-memo">البيان</Label>
            <Input id="adv-memo" className="h-11" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="مثال: سلفة ظروف اضطرارية" />
          </div>
          {overCap ? (
            <p role="alert" className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
              تجاوز سقف السلفة — الحد الأقصى المتاح مع السلف القائمة هو {formatEGP(Math.max(capP - (employee?.advancesOutstandingPiasters ?? 0), 0))}.
            </p>
          ) : null}
          {inlineError ? (
            <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{inlineError}</p>
          ) : null}
          {capHint ? <p className="text-xs text-muted-foreground">{capHint}</p> : null}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" className="min-h-11" onClick={onClose}>إلغاء</Button>
          <Button className="min-h-11 bg-emerald-600 text-white hover:bg-emerald-700" disabled={!canSubmit} onClick={() => void submit()}>
            {saving ? 'جارٍ الصرف…' : 'صرف السلفة'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------- عمولة ------------------------------------ */

function CommissionDialog({ employee, onClose, onDone }: { employee: Employee | null; onClose: () => void; onDone: () => void }) {
  const { toast } = useToast();
  const [amount, setAmount] = React.useState('');
  const [memo, setMemo] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (employee) { setAmount(''); setMemo(''); }
  }, [employee]);

  const amountP = parseEGPToPiasters(amount);
  const canSubmit = employee && amountP !== null && amountP > 0 && memo.trim().length >= 3 && !saving;

  const submit = async () => {
    if (!canSubmit || !employee) return;
    setSaving(true);
    try {
      await api.post('hr/commissions', { employeeId: employee.id, amount, memo: memo.trim() });
      toast({ title: 'تم ترحيل العمولة', description: `${employee.name} — ${formatEGP(amountP)} على حساب مستحقات العمولات`, variant: 'success' });
      onDone();
    } catch (e) {
      toast({ title: 'تعذر ترحيل العمولة', description: e instanceof ErpError ? e.message : 'خطأ غير متوقع', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={employee !== null} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>ترحيل عمولة: {employee?.name}</DialogTitle>
          <DialogDescription>مدين مصروف عمولات | دائن مستحقات عمولات الموظف.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
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
            <Label htmlFor="com-memo">البيان</Label>
            <Input id="com-memo" className="h-11" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="مثال: عمولة مبيعات نوفمبر" />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" className="min-h-11" onClick={onClose}>إلغاء</Button>
          <Button className="min-h-11 bg-emerald-600 text-white hover:bg-emerald-700" disabled={!canSubmit} onClick={() => void submit()}>
            {saving ? 'جارٍ الترحيل…' : 'ترحيل العمولة'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------ مسيرات الرواتب ------------------------------ */

function PayrollTab({ user }: { user: ErpUser }) {
  const { toast } = useToast();
  const runsState = useAsyncData<{ runs: PayrollRun[] }>(() => api.get('hr/payroll-runs'), []);
  const treasuriesState = useAsyncData<{ accounts: TreasuryAccount[] }>(() => api.get('treasury/accounts'), []);

  const [createOpen, setCreateOpen] = React.useState(false);
  const [expanded, setExpanded] = React.useState<string | null>(null);
  const [disburseRun, setDisburseRun] = React.useState<PayrollRun | null>(null);

  const canRun = can(user, 'payroll:run');
  const canApprove = can(user, 'payroll:approve');
  const runs = runsState.data?.runs ?? [];

  const act = async (run: PayrollRun, action: 'approve' | 'disburse' | 'delete', extra?: Record<string, unknown>) => {
    try {
      if (action === 'approve') {
        await api.post(`hr/payroll-runs/${encodeURIComponent(run.id)}/approve`, extra ?? { date: todayISO() });
        toast({ title: 'تم اعتماد المسير', description: `${run.number} — أصبح جاهزاً للصرف`, variant: 'success' });
      } else if (action === 'delete') {
        await api.delete(`hr/payroll-runs/${encodeURIComponent(run.id)}`);
        toast({ title: 'تم حذف المسودة', variant: 'success' });
      }
      runsState.reload();
    } catch (e) {
      toast({ title: 'تعذر تنفيذ العملية', description: e instanceof ErpError ? e.message : 'خطأ غير متوقع', variant: 'destructive' });
    }
  };

  return (
    <SectionCard
      title="مسيرات الرواتب"
      description="مسير شهري يجمع الرواتب ويخصم السلف والتأمينات والضرائب — ثم يُعتمد ويُصرف"
      actions={canRun ? (
        <Button size="sm" className="min-h-11 gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700" onClick={() => setCreateOpen(true)}>
          <Plus className="size-4" aria-hidden /> مسير جديد
        </Button>
      ) : undefined}
    >
      {runsState.loading ? <LoadingTable cols={6} />
        : runsState.error ? <LoadError error={runsState.error} onRetry={runsState.reload} />
        : runs.length === 0 ? <EmptyState title="لا مسيرات بعد" hint="أنشئ مسيراً للشهر الحالي" />
        : (
          <div className="space-y-2">
            {runs.map((run) => {
              const isExpanded = expanded === run.id;
              return (
                <div key={run.id} className="rounded-xl border bg-background">
                  <div className="flex flex-wrap items-center gap-3 p-3.5">
                    <button
                      type="button"
                      className="flex size-9 items-center justify-center rounded-lg hover:bg-muted"
                      aria-expanded={isExpanded}
                      aria-label={isExpanded ? 'إخفاء تفاصيل الموظفين' : 'عرض تفاصيل الموظفين'}
                      onClick={() => setExpanded(isExpanded ? null : run.id)}
                    >
                      <ChevronDown className={cn('size-4 text-muted-foreground transition-transform', isExpanded && 'rotate-180')} aria-hidden />
                    </button>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold">
                        <Ltr>{run.number}</Ltr>
                        <span className="mr-2 text-xs font-normal text-muted-foreground">فترة <Ltr>{run.period}</Ltr> · <Ltr>{formatDate(run.date)}</Ltr></span>
                      </p>
                      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-muted-foreground">
                        <span>إجمالي: <Money p={run.totals.gross} withSymbol={false} /></span>
                        <span>سلف مخصومة: <Money p={run.totals.advances} withSymbol={false} /></span>
                        <span>تأمين: <Money p={run.totals.insurance} withSymbol={false} /></span>
                        <span>ضريبة: <Money p={run.totals.tax} withSymbol={false} /></span>
                        <span className="font-semibold text-foreground">الصافي: <Money p={run.totals.net} /></span>
                      </div>
                    </div>
                    <ToneBadge tone={run.status === 'paid' ? 'success' : run.status === 'approved' ? 'info' : 'neutral'}>
                      {run.status === 'paid' ? 'مصروف' : run.status === 'approved' ? 'معتمد' : 'مسودة'}
                    </ToneBadge>
                    <div className="flex items-center gap-1.5">
                      {canApprove && run.status === 'draft' ? (
                        <Button size="sm" variant="outline" className="min-h-10 border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-950/40"
                          onClick={() => void act(run, 'approve')}>
                          اعتماد
                        </Button>
                      ) : null}
                      {canApprove && run.status === 'approved' ? (
                        <Button size="sm" className="min-h-10 bg-emerald-600 text-white hover:bg-emerald-700" onClick={() => setDisburseRun(run)}>
                          صرف
                        </Button>
                      ) : null}
                      {canRun && run.status === 'draft' ? (
                        <Button size="icon" variant="ghost" className="size-9 text-muted-foreground hover:text-destructive"
                          aria-label={`حذف مسودة ${run.number}`}
                          onClick={() => {
                            if (window.confirm(`حذف مسودة المسير ${run.number}؟ لا يمكن التراجع.`)) void act(run, 'delete');
                          }}>
                          <Trash2 className="size-4" aria-hidden />
                        </Button>
                      ) : null}
                    </div>
                  </div>
                  {isExpanded ? (
                    <div className="border-t bg-muted/20 p-3">
                      <ScrollTable maxHeight="max-h-72">
                        <table className="w-full text-xs">
                          <thead className="sticky top-0 bg-background">
                            <tr className="text-right text-muted-foreground">
                              <th className="px-2 py-2 font-medium">الموظف</th>
                              <th className="px-2 py-2 font-medium">الأساسي</th>
                              <th className="px-2 py-2 font-medium">البدلات</th>
                              <th className="px-2 py-2 font-medium">سلف مخصومة</th>
                              <th className="px-2 py-2 font-medium">تأمين</th>
                              <th className="px-2 py-2 font-medium">ضريبة</th>
                              <th className="px-2 py-2 font-medium">الصافي</th>
                            </tr>
                          </thead>
                          <tbody>
                            {run.lines.map((l) => (
                              <tr key={l.employeeId} className="border-t">
                                <td className="px-2 py-2">
                                  <Ltr className="font-semibold">{l.employeeCode}</Ltr> {l.employeeName}
                                </td>
                                <td className="px-2 py-2"><Money p={l.basic} withSymbol={false} /></td>
                                <td className="px-2 py-2"><Money p={l.allowances} withSymbol={false} /></td>
                                <td className="px-2 py-2">{l.advancesDeducted ? <Money p={l.advancesDeducted} withSymbol={false} /> : '—'}</td>
                                <td className="px-2 py-2"><Money p={l.insurance} withSymbol={false} /></td>
                                <td className="px-2 py-2"><Money p={l.tax} withSymbol={false} /></td>
                                <td className="px-2 py-2 font-bold"><Money p={l.net} withSymbol={false} /></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </ScrollTable>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}

      <CreateRunDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={() => { setCreateOpen(false); runsState.reload(); }} />

      <DisburseRunDialog
        run={disburseRun}
        treasuries={treasuriesState.data?.accounts ?? []}
        onClose={() => setDisburseRun(null)}
        onDone={() => { setDisburseRun(null); runsState.reload(); }}
      />
    </SectionCard>
  );
}

function CreateRunDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (v: boolean) => void; onCreated: () => void }) {
  const { toast } = useToast();
  const [period, setPeriod] = React.useState(currentPeriodKey());
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (open) setPeriod(currentPeriodKey());
  }, [open]);

  const valid = /^\d{4}-(0[1-9]|1[0-2])$/.test(period);

  const submit = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      await api.post('hr/payroll-runs', { period });
      toast({ title: 'تم إنشاء المسير', description: `فترة ${period} — أُنشئ كمسودة ويحتاج اعتماداً`, variant: 'success' });
      onCreated();
    } catch (e) {
      toast({ title: 'تعذر إنشاء المسير', description: e instanceof ErpError ? e.message : 'خطأ غير متوقع', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>مسير رواتب جديد</DialogTitle>
          <DialogDescription>يجمع تلقائياً رواتب كل الموظفين النشطين ويخصم السلف والتأمينات والضرائب.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="pr-period">الفترة (YYYY-MM)</Label>
          <Input id="pr-period" dir="ltr" className="h-11 text-left tabular-nums" value={period}
            onChange={(e) => setPeriod(e.target.value.slice(0, 7))} placeholder={currentPeriodKey()} />
          {!valid && period ? <p className="text-xs text-destructive">الصيغة: سنة-شهر مثل <Ltr>2026-11</Ltr></p> : null}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" className="min-h-11" onClick={() => onOpenChange(false)}>إلغاء</Button>
          <Button className="min-h-11 bg-emerald-600 text-white hover:bg-emerald-700" disabled={!valid || saving} onClick={() => void submit()}>
            {saving ? 'جارٍ الإنشاء…' : 'إنشاء المسير'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DisburseRunDialog({
  run, treasuries, onClose, onDone,
}: {
  run: PayrollRun | null;
  treasuries: TreasuryAccount[];
  onClose: () => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [treasuryId, setTreasuryId] = React.useState('');
  const [date, setDate] = React.useState(todayISO());
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (run) { setTreasuryId(treasuries[0]?.id ?? ''); setDate(todayISO()); }
  }, [run]);

  const submit = async () => {
    if (!run || !treasuryId) return;
    setSaving(true);
    try {
      await api.post(`hr/payroll-runs/${encodeURIComponent(run.id)}/disburse`, { treasuryAccountId: treasuryId, date });
      toast({ title: 'تم صرف الرواتب', description: `${run.number} — صافي ${formatEGP(run.totals.net)}`, variant: 'success' });
      onDone();
    } catch (e) {
      toast({ title: 'تعذر الصرف', description: e instanceof ErpError ? e.message : 'خطأ غير متوقع (تأكد من كفاية رصيد الخزينة)', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={run !== null} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>صرف مسير الرواتب <Ltr>{run?.number ?? ''}</Ltr></DialogTitle>
          <DialogDescription>
            سيُرحَّل قيد صرف صافي <span className="font-bold text-foreground">{run ? formatEGP(run.totals.net) : '—'}</span> من الخزينة المحددة.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="space-y-2">
            <Label>خزينة الصرف</Label>
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
            <Label htmlFor="prd-date">التاريخ</Label>
            <Input id="prd-date" type="date" dir="ltr" className="h-11 text-left tabular-nums" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" className="min-h-11" onClick={onClose}>إلغاء</Button>
          <Button className="min-h-11 bg-emerald-600 text-white hover:bg-emerald-700" disabled={!treasuryId || saving} onClick={() => void submit()}>
            {saving ? 'جارٍ الصرف…' : 'صرف الرواتب'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
