'use client';

/**
 * الفواتير — جدول بحالات ملونة، إنشاء فاتورة ببنود ديناميكية وحساب حي بالقروش،
 * عرض تفصيلي مع قيد الترحيل، وإلغاء بسبب إلزامي (10 أحرف على الأقل).
 */
import * as React from 'react';
import { BookOpenCheck, Eye, Plus, ReceiptText, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import {
  EmptyState, InvoiceStatusBadge, LoadError, LoadingTable, Ltr, Money, ScrollTable, SectionCard, useAsyncData,
} from '@/components/erp/shared';
import { useToast } from '@/hooks/use-toast';
import {
  INVOICE_STATUS_LABELS, api, can, ErpError, formatEGP, formatDate, parseEGPToPiasters, todayISO,
  type Customer, type ErpUser, type Invoice, type InvoiceStatus,
} from '@/lib/erp';
import { cn } from '@/lib/utils';

const STATUS_TABS: { value: InvoiceStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'الكل' },
  { value: 'unpaid', label: 'غير مدفوعة' },
  { value: 'partial', label: 'جزئية' },
  { value: 'paid', label: 'مدفوعة' },
  { value: 'cancelled', label: 'ملغاة' },
];

interface DraftItem { description: string; qty: string; unitPrice: string }

export function InvoicesSection({ user, customers }: { user: ErpUser; customers: Customer[] | null }) {
  const { toast } = useToast();
  const [status, setStatus] = React.useState<InvoiceStatus | 'all'>('all');
  const { data, loading, error, reload } = useAsyncData<{ invoices: Invoice[] }>(
    () => api.get(`invoices${status === 'all' ? '' : `?status=${status}`}`),
    [status],
  );
  const [viewInvoice, setViewInvoice] = React.useState<Invoice | null>(null);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [cancelInvoice, setCancelInvoice] = React.useState<Invoice | null>(null);

  return (
    <div className="space-y-4">
      <SectionCard
        title="فواتير المبيعات"
        description="فواتير بضريبة القيمة المضافة تُرحَّل قيدها تلقائياً وتُسجل في ذمم العميل"
        actions={can(user, 'invoices:create') ? (
          <Button size="sm" className="min-h-11 gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" aria-hidden /> فاتورة جديدة
          </Button>
        ) : undefined}
      >
        {/* تبويبات حالة */}
        <div className="mb-4 flex flex-wrap gap-1.5" role="tablist" aria-label="تصفية بالحالة">
          {STATUS_TABS.map((t) => (
            <button
              key={t.value}
              type="button"
              role="tab"
              aria-selected={status === t.value}
              onClick={() => setStatus(t.value)}
              className={cn(
                'min-h-10 rounded-full border px-3.5 text-xs font-medium transition-colors',
                status === t.value
                  ? 'border-emerald-600 bg-emerald-600 text-white'
                  : 'border-border bg-background text-muted-foreground hover:border-emerald-400 hover:text-emerald-700',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {loading ? <LoadingTable cols={6} />
          : error ? <LoadError error={error} onRetry={reload} />
          : (data?.invoices.length ?? 0) === 0 ? <EmptyState title="لا توجد فواتير" hint="أنشئ أول فاتورة من الزر أعلاه" />
          : (
            <ScrollTable maxHeight="max-h-[520px]">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-background shadow-[0_1px_0_0_var(--border)]">
                  <tr className="text-right text-xs text-muted-foreground">
                    <th className="px-2 py-2.5 font-medium">الرقم</th>
                    <th className="px-2 py-2.5 font-medium">التاريخ</th>
                    <th className="px-2 py-2.5 font-medium">العميل</th>
                    <th className="px-2 py-2.5 font-medium">الإجمالي</th>
                    <th className="px-2 py-2.5 font-medium">المدفوع</th>
                    <th className="px-2 py-2.5 font-medium">المتبقي</th>
                    <th className="px-2 py-2.5 font-medium">الحالة</th>
                    <th className="px-2 py-2.5 font-medium text-center">إجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.invoices ?? []).map((inv) => (
                    <tr key={inv.id} className="border-t transition-colors hover:bg-muted/40">
                      <td className="whitespace-nowrap px-2 py-2.5">
                        <Ltr className="text-xs font-bold">{inv.number}</Ltr>
                      </td>
                      <td className="whitespace-nowrap px-2 py-2.5 text-xs text-muted-foreground"><Ltr>{formatDate(inv.date)}</Ltr></td>
                      <td className="max-w-40 truncate px-2 py-2.5 text-xs">{inv.customerName}</td>
                      <td className="whitespace-nowrap px-2 py-2.5"><Money p={inv.total} /></td>
                      <td className="whitespace-nowrap px-2 py-2.5 text-emerald-700 dark:text-emerald-400"><Money p={inv.paidTotal} /></td>
                      <td className="whitespace-nowrap px-2 py-2.5"><Money p={inv.balance} /></td>
                      <td className="px-2 py-2.5"><InvoiceStatusBadge status={inv.status} labels={INVOICE_STATUS_LABELS} /></td>
                      <td className="px-2 py-2.5">
                        <div className="flex items-center justify-center gap-1">
                          <Button variant="ghost" size="icon" className="size-9" aria-label={`عرض ${inv.number}`} onClick={() => setViewInvoice(inv)}>
                            <Eye className="size-4" aria-hidden />
                          </Button>
                          {can(user, 'invoices:cancel') && inv.status !== 'cancelled' ? (
                            <Button variant="ghost" size="icon" className="size-9 text-muted-foreground hover:text-destructive"
                              aria-label={`إلغاء ${inv.number}`} onClick={() => setCancelInvoice(inv)}>
                              <Trash2 className="size-4" aria-hidden />
                            </Button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollTable>
          )}
      </SectionCard>

      <CreateInvoiceDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        customers={customers}
        onCreated={() => { setCreateOpen(false); reload(); }}
      />

      <ViewInvoiceDialog invoice={viewInvoice} onClose={() => setViewInvoice(null)} />

      <CancelInvoiceDialog
        invoice={cancelInvoice}
        onClose={() => setCancelInvoice(null)}
        onDone={() => { setCancelInvoice(null); reload(); }}
      />
    </div>
  );
}

/* ------------------------------- عرض فاتورة -------------------------------- */

function ViewInvoiceDialog({ invoice, onClose }: { invoice: Invoice | null; onClose: () => void }) {
  return (
    <Dialog open={invoice !== null} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto scrollbar-erp sm:max-w-2xl">
        {invoice ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-center gap-2">
                فاتورة <Ltr>{invoice.number}</Ltr>
                <InvoiceStatusBadge status={invoice.status} labels={INVOICE_STATUS_LABELS} />
              </DialogTitle>
              <DialogDescription>
                {invoice.customerName} · تاريخ <Ltr>{formatDate(invoice.date)}</Ltr> · استحقاق <Ltr>{formatDate(invoice.dueDate)}</Ltr>
                {invoice.journalNumber ? <> · قيد الترحيل <Ltr>{invoice.journalNumber}</Ltr></> : null}
              </DialogDescription>
            </DialogHeader>

            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full min-w-[420px] text-sm">
                <thead className="bg-muted/50">
                  <tr className="text-right text-xs text-muted-foreground">
                    <th className="px-3 py-2 font-medium">الوصف</th>
                    <th className="px-3 py-2 font-medium">كمية</th>
                    <th className="px-3 py-2 font-medium">سعر الوحدة</th>
                    <th className="px-3 py-2 font-medium">الإجمالي</th>
                  </tr>
                </thead>
                <tbody>
                  {invoice.items.map((it, i) => (
                    <tr key={i} className="border-t">
                      <td className="px-3 py-2">{it.description}</td>
                      <td className="px-3 py-2 tabular-nums"><Ltr>{it.qty}</Ltr></td>
                      <td className="px-3 py-2"><Money p={it.unitPricePiasters} /></td>
                      <td className="px-3 py-2"><Money p={it.totalPiasters} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="space-y-1.5 rounded-lg bg-muted/40 p-3 text-sm">
              <Row label="الإجمالي قبل الخصم"><Money p={invoice.subtotal} /></Row>
              <Row label="الخصم"><Money p={invoice.discount} /></Row>
              <Row label={`ضريبة القيمة المضافة (${invoice.vatRate}%)`}><Money p={invoice.vatAmount} /></Row>
              <Separator />
              <Row label="الإجمالي"><span className="font-bold"><Money p={invoice.total} /></span></Row>
              <Row label="المدفوع"><Money p={invoice.paidTotal} /></Row>
              <Row label="المتبقي"><span className="font-bold"><Money p={invoice.balance} /></span></Row>
            </div>
            {invoice.notes ? <p className="text-xs text-muted-foreground">ملاحظات: {invoice.notes}</p> : null}

            {invoice.journalEntry ? (
              <div>
                <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
                  <BookOpenCheck className="size-4 text-emerald-600" aria-hidden />
                  قيد الترحيل <Ltr>{invoice.journalEntry.number}</Ltr>
                </p>
                <div className="max-h-52 overflow-y-auto rounded-lg border scrollbar-erp">
                  <table className="w-full min-w-[420px] text-xs">
                    <thead className="bg-muted/50">
                      <tr className="text-right text-muted-foreground">
                        <th className="px-3 py-2 font-medium">الحساب</th>
                        <th className="px-3 py-2 font-medium">مدين</th>
                        <th className="px-3 py-2 font-medium">دائن</th>
                      </tr>
                    </thead>
                    <tbody>
                      {invoice.journalEntry.lines.map((l, i) => (
                        <tr key={i} className="border-t">
                          <td className="px-3 py-2">
                            <Ltr className="font-semibold">{l.accountCode}</Ltr>
                            <span className="mr-1.5">{l.accountName}</span>
                          </td>
                          <td className="px-3 py-2">{l.debit ? <Money p={l.debit} withSymbol={false} /> : '—'}</td>
                          <td className="px-3 py-2">{l.credit ? <Money p={l.credit} withSymbol={false} /> : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span>{children}</span>
    </div>
  );
}

/* ------------------------------ إنشاء فاتورة ------------------------------- */

function CreateInvoiceDialog({
  open, onOpenChange, customers, onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  customers: Customer[] | null;
  onCreated: () => void;
}) {
  const { toast } = useToast();
  const [customerId, setCustomerId] = React.useState('');
  const [date, setDate] = React.useState(todayISO());
  const [items, setItems] = React.useState<DraftItem[]>([{ description: '', qty: '1', unitPrice: '' }]);
  const [discount, setDiscount] = React.useState('');
  const [vatRate, setVatRate] = React.useState('14');
  const [notes, setNotes] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setCustomerId('');
      setDate(todayISO());
      setItems([{ description: '', qty: '1', unitPrice: '' }]);
      setDiscount('');
      setVatRate('14');
      setNotes('');
    }
  }, [open]);

  /** معاينة حية بالقروش — كل عملية حسابية بأعداد صحيحة */
  const preview = React.useMemo(() => {
    let subtotal = 0;
    let invalid = false;
    for (const it of items) {
      const unit = parseEGPToPiasters(it.unitPrice);
      const qty = Math.trunc(Number(it.qty || '0'));
      if (!it.description.trim() || unit === null || unit < 0 || !Number.isSafeInteger(qty) || qty <= 0) {
        if (it.description.trim() || it.unitPrice) invalid = true;
        continue;
      }
      subtotal += unit * qty;
    }
    const disc = Math.min(parseEGPToPiasters(discount) ?? 0, subtotal);
    const vatPct = Math.round(Number(vatRate || '0') * 100) / 100;
    const vat = subtotal > 0 ? Math.round(((subtotal - disc) * vatPct) / 100) : 0;
    return { subtotal, disc, vat, total: subtotal - disc + vat, invalid, vatPct };
  }, [items, discount, vatRate]);

  const activeCustomers = (customers ?? []).filter((c) => c.active);
  const canSubmit = customerId && date && !preview.invalid && items.some((i) => i.description.trim() && (parseEGPToPiasters(i.unitPrice) ?? 0) > 0) && !saving;

  const submit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    try {
      const payloadItems = items
        .filter((i) => i.description.trim() && (parseEGPToPiasters(i.unitPrice) ?? 0) > 0)
        .map((i) => ({ description: i.description.trim(), qty: Math.trunc(Number(i.qty || '1')), unitPrice: i.unitPrice }));
      await api.post('invoices', {
        customerId, date,
        items: payloadItems,
        discount: discount || '0',
        vatRate: preview.vatPct,
        notes: notes.trim() || undefined,
      });
      toast({ title: 'تم إصدار الفاتورة', description: `الإجمالي ${formatEGP(preview.total)} — ورُحِّل قيدها تلقائياً`, variant: 'success' });
      onCreated();
    } catch (e) {
      toast({ title: 'تعذر إصدار الفاتورة', description: e instanceof ErpError ? e.message : 'خطأ غير متوقع', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto scrollbar-erp sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>فاتورة مبيعات جديدة</DialogTitle>
          <DialogDescription>المبالغ تُدخل بالجنيه — والتوزيع الضريبي يحتسب بالقروش دقيقاً.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="space-y-2 sm:col-span-2">
              <Label>العميل</Label>
              <Select value={customerId} onValueChange={setCustomerId}>
                <SelectTrigger className="h-11 w-full"><SelectValue placeholder="اختر العميل…" /></SelectTrigger>
                <SelectContent>
                  {activeCustomers.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      <span className="flex items-center gap-2"><Ltr className="text-xs text-muted-foreground">{c.code}</Ltr> {c.name}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="inv-date">التاريخ</Label>
              <Input id="inv-date" type="date" dir="ltr" className="h-11 text-left tabular-nums" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>

          {/* البنود */}
          <div className="space-y-2">
            <Label>بنود الفاتورة</Label>
            {items.map((it, idx) => (
              <div key={idx} className="grid grid-cols-[1fr_74px_120px_auto] gap-2 rounded-lg border bg-muted/20 p-2">
                <Input
                  className="h-11" placeholder="وصف الخدمة/الصنف"
                  value={it.description}
                  onChange={(e) => setItems((arr) => arr.map((x, i) => (i === idx ? { ...x, description: e.target.value } : x)))}
                  aria-label={`وصف البند ${idx + 1}`}
                />
                <Input
                  className="h-11 tabular-nums" dir="ltr" inputMode="numeric" placeholder="كمية"
                  value={it.qty}
                  onChange={(e) => setItems((arr) => arr.map((x, i) => (i === idx ? { ...x, qty: e.target.value.replace(/\D/g, '') } : x)))}
                  aria-label={`كمية البند ${idx + 1}`}
                />
                <div className="relative">
                  <Input
                    className="h-11 pl-10 text-left tabular-nums" dir="ltr" inputMode="decimal" placeholder="0.00"
                    value={it.unitPrice}
                    onChange={(e) => setItems((arr) => arr.map((x, i) => (i === idx ? { ...x, unitPrice: e.target.value.replace(/[^\d.]/g, '') } : x)))}
                    aria-label={`سعر البند ${idx + 1}`}
                  />
                  <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-[10px] text-muted-foreground">ج.م</span>
                </div>
                <Button variant="ghost" size="icon" className="size-11 text-muted-foreground hover:text-destructive" aria-label="حذف البند"
                  disabled={items.length <= 1}
                  onClick={() => setItems((arr) => arr.filter((_, i) => i !== idx))}>
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              </div>
            ))}
            <Button variant="outline" className="min-h-11 w-full gap-1.5 border-dashed"
              onClick={() => setItems((arr) => [...arr, { description: '', qty: '1', unitPrice: '' }])}>
              <Plus className="size-4" aria-hidden /> إضافة بند
            </Button>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>الخصم</Label>
              <div className="relative">
                <Input dir="ltr" inputMode="decimal" className="h-11 pl-10 text-left tabular-nums" value={discount}
                  onChange={(e) => setDiscount(e.target.value.replace(/[^\d.]/g, ''))} placeholder="0.00" />
                <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-[10px] text-muted-foreground">ج.م</span>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="inv-vat">نسبة الضريبة %</Label>
              <Input id="inv-vat" dir="ltr" inputMode="decimal" className="h-11 text-left tabular-nums" value={vatRate}
                onChange={(e) => setVatRate(e.target.value.replace(/[^\d.]/g, '').replace(/\.(?=.*\.)/g, ''))} />
            </div>
          </div>

          {/* المعاينة الحية */}
          <div className="space-y-1.5 rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 text-sm dark:border-emerald-900 dark:bg-emerald-950/30">
            <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-emerald-800 dark:text-emerald-300">
              <ReceiptText className="size-3.5" aria-hidden /> معاينة فورية
            </p>
            <Row label="الإجمالي قبل الخصم"><Money p={preview.subtotal} /></Row>
            <Row label="الخصم"><Money p={preview.disc} /></Row>
            <Row label={`ض.ق.م (${preview.vatPct}%)`}><Money p={preview.vat} /></Row>
            <Separator />
            <Row label="الإجمالي"><span className="text-base font-bold"><Money p={preview.total} /></span></Row>
          </div>

          <div className="space-y-2">
            <Label htmlFor="inv-notes">ملاحظات</Label>
            <Textarea id="inv-notes" className="min-h-16" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="اختياري" />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" className="min-h-11" onClick={() => onOpenChange(false)}>إلغاء</Button>
          <Button className="min-h-11 bg-emerald-600 text-white hover:bg-emerald-700" disabled={!canSubmit} onClick={() => void submit()}>
            {saving ? 'جارٍ الإصدار…' : 'إصدار الفاتورة'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------- إلغاء فاتورة ------------------------------- */

function CancelInvoiceDialog({ invoice, onClose, onDone }: { invoice: Invoice | null; onClose: () => void; onDone: () => void }) {
  const { toast } = useToast();
  const [reason, setReason] = React.useState('');
  const [date, setDate] = React.useState(todayISO());
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (invoice) { setReason(''); setDate(todayISO()); }
  }, [invoice]);

  const ok = reason.trim().length >= 10;

  const submit = async () => {
    if (!invoice || !ok) return;
    setSaving(true);
    try {
      await api.post(`invoices/${encodeURIComponent(invoice.id)}/cancel`, { reason: reason.trim(), date });
      toast({ title: 'تم إلغاء الفاتورة', description: `${invoice.number} — ورُحِّل قيد إلغاء معاكس`, variant: 'success' });
      onDone();
    } catch (e) {
      toast({ title: 'تعذر الإلغاء', description: e instanceof ErpError ? e.message : 'خطأ غير متوقع', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={invoice !== null} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>إلغاء فاتورة</DialogTitle>
          <DialogDescription>
            سيُرحَّل قيد عكسي لإلغاء الفاتورة <Ltr>{invoice?.number ?? ''}</Ltr> — لا يمكن التراجع.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="space-y-2">
            <Label htmlFor="cxl-date">تاريخ الإلغاء</Label>
            <Input id="cxl-date" type="date" dir="ltr" className="h-11 text-left tabular-nums" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cxl-reason">السبب (10 أحرف على الأقل)</Label>
            <Textarea id="cxl-reason" className="min-h-20" value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder="مثال: تم إصدار الفاتورة بالخطأ لعميل آخر" />
            {reason && !ok ? <p className="text-xs text-destructive">السبب قصير جداً — 10 أحرف على الأقل</p> : null}
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" className="min-h-11" onClick={onClose}>رجوع</Button>
          <Button variant="destructive" className="min-h-11" disabled={!ok || saving} onClick={() => void submit()}>
            {saving ? 'جارٍ الإلغاء…' : 'تأكيد الإلغاء'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
