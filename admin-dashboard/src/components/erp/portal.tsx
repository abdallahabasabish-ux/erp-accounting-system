'use client';

/**
 * بوابتي — وجهة العميل: فواتيره وأرصدته وطلبات دفعه عبر البوابة (إرسال طلب دفع).
 */
import * as React from 'react';
import { CreditCard, FileText, Send, Wallet } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  EmptyState, InvoiceStatusBadge, LoadError, LoadingTable, Ltr, Money, SectionCard, StatCard, useAsyncData,
} from '@/components/erp/shared';
import { useToast } from '@/hooks/use-toast';
import {
  INVOICE_STATUS_LABELS, api, ErpError, formatDate, parseEGPToPiasters,
  type PaymentRequest, type PortalOverview,
} from '@/lib/erp';

export function PortalSection() {
  const { data, loading, error, reload } = useAsyncData<PortalOverview>(() => api.get('portal/overview'), []);
  const [payOpen, setPayOpen] = React.useState(false);

  if (loading) return <SectionCard title="بوابتي"><LoadingTable cols={5} rows={4} /></SectionCard>;
  if (error || !data) return <LoadError error={error} onRetry={reload} />;

  const { customer, invoices, paymentRequests } = data.overview;
  const totalDue = invoices.reduce((s, i) => s + (i.balance > 0 ? i.balance : 0), 0);

  return (
    <div className="space-y-4">
      <SectionCard
        title={`أهلاً بك، ${customer.name}`}
        description={`رمز العميل ${customer.code ?? ''} · هذا كل ما يخص حسابك: الفواتير والمدفوعات`}
        actions={
          <Button size="sm" className="min-h-11 gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700" onClick={() => setPayOpen(true)}>
            <CreditCard className="size-4" aria-hidden /> طلب دفع جديد
          </Button>
        }
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <StatCard title="إجمالي المستحق عليك" value={<Money p={totalDue} />} tone={totalDue > 0 ? 'warning' : 'positive'} icon={Wallet} />
          <StatCard title="عدد الفواتير" value={invoices.length} icon={FileText} />
          <StatCard title="طلبات الدفع" value={paymentRequests.length} hint="من البوابة" icon={Send} />
        </div>
      </SectionCard>

      <SectionCard title="فواتيري" description="حالة سداد كل فاتورة والمتبقي عليها">
        {invoices.length === 0 ? (
          <EmptyState title="لا فواتير على حسابك بعد" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b text-right text-xs text-muted-foreground">
                  <th className="px-2 py-2.5 font-medium">الرقم</th>
                  <th className="px-2 py-2.5 font-medium">التاريخ</th>
                  <th className="px-2 py-2.5 font-medium">الاستحقاق</th>
                  <th className="px-2 py-2.5 font-medium">الإجمالي</th>
                  <th className="px-2 py-2.5 font-medium">المدفوع</th>
                  <th className="px-2 py-2.5 font-medium">المتبقي</th>
                  <th className="px-2 py-2.5 font-medium">الحالة</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.id} className="border-t transition-colors hover:bg-muted/40">
                    <td className="px-2 py-2.5"><Ltr className="text-xs font-bold">{inv.number}</Ltr></td>
                    <td className="px-2 py-2.5 text-xs text-muted-foreground"><Ltr>{formatDate(inv.date)}</Ltr></td>
                    <td className="px-2 py-2.5 text-xs text-muted-foreground"><Ltr>{formatDate(inv.dueDate)}</Ltr></td>
                    <td className="px-2 py-2.5"><Money p={inv.total} withSymbol={false} /></td>
                    <td className="px-2 py-2.5 text-emerald-700 dark:text-emerald-400"><Money p={inv.paidTotal} withSymbol={false} /></td>
                    <td className="px-2 py-2.5 font-semibold"><Money p={inv.balance} withSymbol={false} /></td>
                    <td className="px-2 py-2.5"><InvoiceStatusBadge status={inv.status} labels={INVOICE_STATUS_LABELS} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <SectionCard title="طلبات الدفع من البوابة" description="حالة طلبات الدفع التي أرسلتها">
        {paymentRequests.length === 0 ? (
          <EmptyState title="لا طلبات دفع بعد" hint="استخدم «طلب دفع جديد» لإشعار الإدارة بعملية التحويل" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-sm">
              <thead>
                <tr className="border-b text-right text-xs text-muted-foreground">
                  <th className="px-2 py-2.5 font-medium">المبلغ</th>
                  <th className="px-2 py-2.5 font-medium">الطريقة</th>
                  <th className="px-2 py-2.5 font-medium">مرجع</th>
                  <th className="px-2 py-2.5 font-medium">أُرسل</th>
                  <th className="px-2 py-2.5 font-medium">الحالة</th>
                </tr>
              </thead>
              <tbody>
                {(paymentRequests as PaymentRequest[]).map((r) => (
                  <tr key={r.id} className="border-t">
                    <td className="px-2 py-2.5"><Money p={r.amount} withSymbol={false} /></td>
                    <td className="px-2 py-2.5 text-xs">{r.method || '—'}</td>
                    <td className="px-2 py-2.5 text-xs"><Ltr>{r.reference || '—'}</Ltr></td>
                    <td className="px-2 py-2.5 text-xs text-muted-foreground"><Ltr>{formatDate(r.createdAt)}</Ltr></td>
                    <td className="px-2 py-2.5 text-xs">
                      {r.status === 'approved' ? 'معتمد ✓' : r.status === 'rejected' ? `مرفوض — ${r.rejectionReason ?? ''}` : 'قيد المراجعة…'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <PortalPayDialog open={payOpen} onOpenChange={setPayOpen} onDone={() => { setPayOpen(false); reload(); }} />
    </div>
  );
}

function PortalPayDialog({ open, onOpenChange, onDone }: { open: boolean; onOpenChange: (v: boolean) => void; onDone: () => void }) {
  const { toast } = useToast();
  const [amount, setAmount] = React.useState('');
  const [method, setMethod] = React.useState('تحويل بنكي');
  const [reference, setReference] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (open) { setAmount(''); setMethod('تحويل بنكي'); setReference(''); }
  }, [open]);

  const amountP = parseEGPToPiasters(amount);
  const canSubmit = amountP !== null && amountP > 0 && reference.trim().length >= 3 && !saving;

  const submit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    try {
      await api.post('portal/payments', { amount, method, reference: reference.trim() });
      toast({ title: 'أُرسل طلب الدفع', description: 'سيتم اعتماده وترحيله بعد مراجعة الإدارة', variant: 'success' });
      onDone();
    } catch (e) {
      toast({ title: 'تعذر إرسال الطلب', description: e instanceof ErpError ? e.message : 'خطأ غير متوقع', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>طلب دفع جديد</DialogTitle>
          <DialogDescription>أبلغ الإدارة بعملية تحويل قمت بها — سيُراجع ويُرحَّل بعد الاعتماد.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
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
              <Label>الطريقة</Label>
              <Select value={method} onValueChange={setMethod}>
                <SelectTrigger className="h-11 w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="تحويل بنكي">تحويل بنكي</SelectItem>
                  <SelectItem value="محفظة إلكترونية">محفظة إلكترونية</SelectItem>
                  <SelectItem value="نقدي">نقدي</SelectItem>
                  <SelectItem value="شيك">شيك</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="pp-ref">مرجع التحويل</Label>
            <Input id="pp-ref" dir="ltr" className="h-11 text-left" value={reference} onChange={(e) => setReference(e.target.value)}
              placeholder="مثال: FT2404CIB12345" />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" className="min-h-11" onClick={() => onOpenChange(false)}>إلغاء</Button>
          <Button className="min-h-11 bg-emerald-600 text-white hover:bg-emerald-700" disabled={!canSubmit} onClick={() => void submit()}>
            {saving ? 'جارٍ الإرسال…' : 'إرسال الطلب'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
