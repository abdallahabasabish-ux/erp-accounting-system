'use client';

/**
 * العملاء — جدول العملاء مع حدود الائتمان وأرصدة الذمم، إضافة/تعديل،
 * كشف حساب كامل (رصيد افتتاحي + حركات + رصيد ختامي) وتقرير أعمار الذمم.
 */
import * as React from 'react';
import { FileSearch, Pencil, Phone, Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import {
  EmptyState, LoadError, LoadingTable, Ltr, Money, ScrollTable, SectionCard, StatCard, ToneBadge, useAsyncData,
} from '@/components/erp/shared';
import { useToast } from '@/hooks/use-toast';
import {
  api, can, ErpError, formatEGP, formatDate, parseEGPToPiasters,
  type AgingReport, type Customer, type CustomerStatement, type ErpUser,
} from '@/lib/erp';

export function CustomersSection({ user }: { user: ErpUser }) {
  const customersState = useAsyncData<{ customers: Customer[] }>(() => api.get('customers'), []);
  const agingState = useAsyncData<AgingReport>(() => api.get('reports/aging'), []);

  const [editCustomer, setEditCustomer] = React.useState<Customer | null>(null);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [statementOf, setStatementOf] = React.useState<Customer | null>(null);

  const manage = can(user, 'customers:manage');
  const customers = customersState.data?.customers ?? [];

  return (
    <div className="space-y-4">
      {/* أعمار الذمم — مؤشرات */}
      {(() => {
        const aging = agingState.data;
        return aging ? (
          <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
            <StatCard title="إجمالي الذمم" value={<Money p={aging.totalReceivable} />} tone="warning" />
            <StatCard title="غير مستحقة" value={<Money p={aging.totals.current} />} tone="positive" />
            <StatCard title="1–30 يوم" value={<Money p={aging.totals.d1_30} />} />
            <StatCard title="31–60 يوم" value={<Money p={aging.totals.d31_60} />} tone="warning" />
            <StatCard title="61–90 يوم" value={<Money p={aging.totals.d61_90} />} tone="warning" />
            <StatCard title="+90 يوم" value={<Money p={aging.totals.d90_plus} />} tone="negative" />
          </div>
        ) : null;
      })()}

      <SectionCard
        title="قائمة العملاء"
        description="حدود الائتمان، أيام السداد، وأرصدة الذمم المدينة الحية"
        actions={manage ? (
          <Button size="sm" className="min-h-11 gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" aria-hidden /> عميل جديد
          </Button>
        ) : undefined}
      >
        {customersState.loading ? <LoadingTable cols={6} />
          : customersState.error ? <LoadError error={customersState.error} onRetry={customersState.reload} />
          : customers.length === 0 ? <EmptyState title="لا يوجد عملاء" hint="أضف أول عميل للبدء" />
          : (
            <ScrollTable maxHeight="max-h-[440px]">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-background shadow-[0_1px_0_0_var(--border)]">
                  <tr className="text-right text-xs text-muted-foreground">
                    <th className="px-2 py-2.5 font-medium">الكود</th>
                    <th className="px-2 py-2.5 font-medium">الاسم</th>
                    <th className="px-2 py-2.5 font-medium">اتصال</th>
                    <th className="px-2 py-2.5 font-medium">حد الائتمان</th>
                    <th className="px-2 py-2.5 font-medium">رصيد الذمم</th>
                    <th className="px-2 py-2.5 font-medium">أيام سداد</th>
                    <th className="px-2 py-2.5 font-medium">حساب الذمة</th>
                    <th className="px-2 py-2.5 font-medium text-center">إجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {customers.map((c) => {
                    const overLimit = c.creditLimitPiasters > 0 && c.arBalancePiasters > c.creditLimitPiasters;
                    return (
                      <tr key={c.id} className="border-t transition-colors hover:bg-muted/40">
                        <td className="px-2 py-2.5"><Ltr className="text-xs font-bold">{c.code}</Ltr></td>
                        <td className="max-w-44 truncate px-2 py-2.5">
                          {c.name}
                          {!c.active ? <ToneBadge tone="neutral" className="mr-2 text-[10px]">معطّل</ToneBadge> : null}
                        </td>
                        <td className="px-2 py-2.5 text-xs text-muted-foreground">
                          {c.phone ? <span className="flex items-center gap-1"><Phone className="size-3" aria-hidden /><Ltr>{c.phone}</Ltr></span> : '—'}
                        </td>
                        <td className="whitespace-nowrap px-2 py-2.5">{c.creditLimitPiasters ? <Money p={c.creditLimitPiasters} withSymbol={false} /> : '—'}</td>
                        <td className="whitespace-nowrap px-2 py-2.5">
                          <Money p={c.arBalancePiasters} className={overLimit ? 'font-bold text-destructive' : undefined} />
                          {overLimit ? <p className="text-[10px] font-medium text-destructive">تجاوز الحد</p> : null}
                        </td>
                        <td className="px-2 py-2.5 tabular-nums"><Ltr>{c.creditDays}</Ltr></td>
                        <td className="px-2 py-2.5"><Ltr className="text-[11px] text-muted-foreground">{c.customerAccountCode}</Ltr></td>
                        <td className="px-2 py-2.5">
                          <div className="flex items-center justify-center gap-1">
                            <Button variant="ghost" size="icon" className="size-9" aria-label={`كشف حساب ${c.name}`} onClick={() => setStatementOf(c)}>
                              <FileSearch className="size-4" aria-hidden />
                            </Button>
                            {manage ? (
                              <Button variant="ghost" size="icon" className="size-9" aria-label={`تعديل ${c.name}`} onClick={() => setEditCustomer(c)}>
                                <Pencil className="size-4" aria-hidden />
                              </Button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </ScrollTable>
          )}
      </SectionCard>

      {/* تفصيل أعمار الذمم لكل عميل */}
      {agingState.data && agingState.data.customers.length > 0 ? (
        <SectionCard title="تفصيل أعمار الذمم لكل عميل" description={`كما في ${formatDate(agingState.data.asOf)}`}>
          <ScrollTable maxHeight="max-h-[360px]">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-background shadow-[0_1px_0_0_var(--border)]">
                <tr className="text-right text-xs text-muted-foreground">
                  <th className="px-2 py-2.5 font-medium">العميل</th>
                  <th className="px-2 py-2.5 font-medium">غير مستحقة</th>
                  <th className="px-2 py-2.5 font-medium">1–30</th>
                  <th className="px-2 py-2.5 font-medium">31–60</th>
                  <th className="px-2 py-2.5 font-medium">61–90</th>
                  <th className="px-2 py-2.5 font-medium">+90</th>
                  <th className="px-2 py-2.5 font-medium">الإجمالي</th>
                </tr>
              </thead>
              <tbody>
                {agingState.data.customers.map((c) => (
                  <tr key={c.customerId} className="border-t transition-colors hover:bg-muted/40">
                    <td className="max-w-40 truncate px-2 py-2.5 text-xs">{c.customerName}</td>
                    <td className="px-2 py-2.5"><Money p={c.buckets.current} withSymbol={false} /></td>
                    <td className="px-2 py-2.5"><Money p={c.buckets.d1_30} withSymbol={false} /></td>
                    <td className="px-2 py-2.5"><Money p={c.buckets.d31_60} withSymbol={false} /></td>
                    <td className="px-2 py-2.5"><Money p={c.buckets.d61_90} withSymbol={false} /></td>
                    <td className="px-2 py-2.5"><Money p={c.buckets.d90_plus} withSymbol={false} /></td>
                    <td className="px-2 py-2.5 font-semibold"><Money p={c.total} withSymbol={false} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollTable>
        </SectionCard>
      ) : null}

      <CustomerFormDialog
        open={createOpen || editCustomer !== null}
        customer={editCustomer}
        onOpenChange={(v) => { if (!v) { setCreateOpen(false); setEditCustomer(null); } }}
        onSaved={() => { setCreateOpen(false); setEditCustomer(null); customersState.reload(); }}
      />

      <StatementDialog customer={statementOf} onClose={() => setStatementOf(null)} />
    </div>
  );
}

/* ----------------------------- نموذج عميل --------------------------------- */

function CustomerFormDialog({
  open, customer, onOpenChange, onSaved,
}: {
  open: boolean;
  customer: Customer | null;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [name, setName] = React.useState('');
  const [phone, setPhone] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [creditLimit, setCreditLimit] = React.useState('');
  const [creditDays, setCreditDays] = React.useState('30');
  const [saving, setSaving] = React.useState(false);
  const isEdit = customer !== null;

  React.useEffect(() => {
    if (!open) return;
    setName(customer?.name ?? '');
    setPhone(customer?.phone ?? '');
    setEmail(customer?.email ?? '');
    setCreditLimit(customer?.creditLimitPiasters ? (customer.creditLimitPiasters / 100).toFixed(2) : '');
    setCreditDays(String(customer?.creditDays ?? 30));
  }, [open, customer]);

  const creditP = parseEGPToPiasters(creditLimit);
  const canSubmit = name.trim().length >= 2 && (!creditLimit || creditP !== null) && Number(creditDays) >= 0 && !saving;

  const submit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        name: name.trim(), phone: phone.trim(), email: email.trim(),
        creditLimit: creditLimit || '0', creditDays: Math.trunc(Number(creditDays)),
      };
      if (isEdit && customer) await api.patch(`customers/${encodeURIComponent(customer.id)}`, body);
      else await api.post('customers', body);
      toast({ title: isEdit ? 'تم حفظ التعديلات' : 'تم إضافة العميل', description: name.trim(), variant: 'success' });
      onSaved();
    } catch (e) {
      toast({ title: 'تعذر الحفظ', description: e instanceof ErpError ? e.message : 'خطأ غير متوقع', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? `تعديل: ${customer?.name}` : 'عميل جديد'}</DialogTitle>
          <DialogDescription>
            يُنشأ لكل عميل حساب ذمة فرعي تلقائي تحت «العملاء» — <Ltr>1120-Cxxxx</Ltr>
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="space-y-2">
            <Label htmlFor="cu-name">الاسم *</Label>
            <Input id="cu-name" className="h-11" value={name} onChange={(e) => setName(e.target.value)} placeholder="اسم الشركة أو العميل" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="cu-phone">الهاتف</Label>
              <Input id="cu-phone" dir="ltr" className="h-11 text-left" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="01xxxxxxxxx" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cu-email">البريد</Label>
              <Input id="cu-email" type="email" dir="ltr" className="h-11 text-left" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cu-limit">حد الائتمان</Label>
              <div className="relative">
                <Input id="cu-limit" dir="ltr" inputMode="decimal" className="h-11 pl-10 text-left tabular-nums" value={creditLimit}
                  onChange={(e) => setCreditLimit(e.target.value.replace(/[^\d.]/g, ''))} placeholder="0.00" />
                <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-[10px] text-muted-foreground">ج.م</span>
              </div>
              {creditLimit && creditP === null ? <p className="text-xs text-destructive">مبلغ غير صالح</p> : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="cu-days">أيام السداد</Label>
              <Input id="cu-days" dir="ltr" inputMode="numeric" className="h-11 text-left tabular-nums" value={creditDays}
                onChange={(e) => setCreditDays(e.target.value.replace(/\D/g, '').slice(0, 4))} />
            </div>
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" className="min-h-11" onClick={() => onOpenChange(false)}>إلغاء</Button>
          <Button className="min-h-11 bg-emerald-600 text-white hover:bg-emerald-700" disabled={!canSubmit} onClick={() => void submit()}>
            {saving ? 'جارٍ الحفظ…' : isEdit ? 'حفظ التعديلات' : 'إضافة العميل'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------ كشف حساب ---------------------------------- */

function StatementDialog({ customer, onClose }: { customer: Customer | null; onClose: () => void }) {
  const state = useAsyncData<CustomerStatement | null>(
    async () => (customer ? api.get(`customers/${encodeURIComponent(customer.id)}/statement`) : null),
    [customer?.id],
  );

  return (
    <Dialog open={customer !== null} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto scrollbar-erp sm:max-w-3xl">
        {customer ? (
          <>
            <DialogHeader>
              <DialogTitle>كشف حساب: {customer.name}</DialogTitle>
              <DialogDescription>
                رمز العميل <Ltr>{customer.code}</Ltr> · حساب الذمة <Ltr>{customer.customerAccountCode}</Ltr>
                {' '}· حد ائتمان {customer.creditLimitPiasters ? formatEGP(customer.creditLimitPiasters) : 'بلا حد'} · سداد <Ltr>{customer.creditDays}</Ltr> يوم
              </DialogDescription>
            </DialogHeader>

            {state.loading ? <LoadingTable cols={5} rows={4} />
              : state.error ? <LoadError error={state.error} onRetry={state.reload} />
              : state.data ? (
                <div className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <StatCard title="الرصيد الافتتاحي" value={<Money p={state.data.openingBalance} />} />
                    <StatCard
                      title="الرصيد الختامي"
                      value={<Money p={state.data.closingBalance} />}
                      tone={state.data.closingBalance > 0 ? 'warning' : 'positive'}
                    />
                    <StatCard title="عدد الحركات" value={state.data.movements.length} />
                  </div>

                  {state.data.movements.length === 0 ? (
                    <EmptyState title="لا حركات على هذا العميل بعد" />
                  ) : (
                    <ScrollTable maxHeight="max-h-[380px]">
                      <table className="w-full text-sm">
                        <thead className="sticky top-0 z-10 bg-background shadow-[0_1px_0_0_var(--border)]">
                          <tr className="text-right text-xs text-muted-foreground">
                            <th className="px-2 py-2.5 font-medium">القيد</th>
                            <th className="px-2 py-2.5 font-medium">التاريخ</th>
                            <th className="px-2 py-2.5 font-medium">البيان</th>
                            <th className="px-2 py-2.5 font-medium">مدين</th>
                            <th className="px-2 py-2.5 font-medium">دائن</th>
                            <th className="px-2 py-2.5 font-medium">الرصيد الجاري</th>
                          </tr>
                        </thead>
                        <tbody>
                          {state.data.movements.map((m, i) => (
                            <tr key={`${m.entryId}-${i}`} className="border-t transition-colors hover:bg-muted/40">
                              <td className="whitespace-nowrap px-2 py-2.5"><Ltr className="text-xs font-semibold">{m.number}</Ltr></td>
                              <td className="whitespace-nowrap px-2 py-2.5 text-xs text-muted-foreground"><Ltr>{formatDate(m.date)}</Ltr></td>
                              <td className="max-w-56 px-2 py-2.5"><span className="line-clamp-1 text-xs">{m.memo}</span></td>
                              <td className="px-2 py-2.5">{m.debit ? <Money p={m.debit} withSymbol={false} /> : '—'}</td>
                              <td className="px-2 py-2.5">{m.credit ? <Money p={m.credit} withSymbol={false} /> : '—'}</td>
                              <td className="whitespace-nowrap px-2 py-2.5 font-semibold"><Money p={m.runningBalance} withSymbol={false} /></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </ScrollTable>
                  )}
                  <Separator />
                  <p className="text-center text-xs text-muted-foreground">
                    الرصيد الختامي هو{' '}
                    <span className="font-bold text-foreground"><Money p={state.data.closingBalance} /></span>
                    {state.data.closingBalance > 0 ? ' — مدين على العميل' : ' — لا مديونية'}
                  </p>
                </div>
              ) : null}
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
