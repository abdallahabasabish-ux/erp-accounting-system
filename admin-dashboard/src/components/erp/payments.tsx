'use client';

/**
 * المدفوعات — سندات القبض (توزيع تلقائي FIFO أو تخصيص صريح) وطلبات بوابة الدفع
 * من العملاء مع اعتماد (إلى خزينة) أو رفض بسبب.
 */
import * as React from 'react';
import { BadgeCheck, Banknote, HandCoins, Info, Plus, XCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  EmptyState, LoadError, LoadingTable, Ltr, Money, ScrollTable, SectionCard,
  ToneBadge, useAsyncData,
} from '@/components/erp/shared';
import { useToast } from '@/hooks/use-toast';
import {
  PAYMENT_REQUEST_STATUS_LABELS, api, can, ErpError, formatEGP, formatDate, parseEGPToPiasters, todayISO,
  type Customer, type ErpUser, type Invoice, type PaymentRequest, type Receipt, type TreasuryAccount,
} from '@/lib/erp';

export function PaymentsSection({ user, customers }: { user: ErpUser; customers: Customer[] | null }) {
  const { toast } = useToast();
  const receiptsState = useAsyncData<{ receipts: Receipt[] }>(() => api.get('payments/receipts'), []);
  const requestsState = useAsyncData<{ requests: PaymentRequest[] }>(() => api.get('payments/requests'), []);
  const treasuriesState = useAsyncData<{ accounts: TreasuryAccount[] }>(() => api.get('treasury/accounts'), []);

  const [createOpen, setCreateOpen] = React.useState(false);
  const [approveReq, setApproveReq] = React.useState<PaymentRequest | null>(null);
  const [rejectReq, setRejectReq] = React.useState<PaymentRequest | null>(null);

  const refreshAll = () => {
    receiptsState.reload();
    requestsState.reload();
  };

  return (
    <Tabs defaultValue="receipts" className="space-y-4">
      <SectionCard
        title="المدفوعات والتحصيل"
        description="سندات القبض من العملاء + طلبات الدفع الواردة من بوابة العملاء"
        actions={can(user, 'payments:create') ? (
          <Button size="sm" className="min-h-11 gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" aria-hidden /> سند قبض
          </Button>
        ) : undefined}
        className="border-0 shadow-none bg-transparent"
        contentClassName="p-0"
      >
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="receipts" className="gap-1.5 min-h-11">
            <HandCoins className="size-4" aria-hidden /> سندات القبض
          </TabsTrigger>
          <TabsTrigger value="requests" className="gap-1.5 min-h-11">
            <Banknote className="size-4" aria-hidden /> طلبات بوابة الدفع
          </TabsTrigger>
        </TabsList>

        <TabsContent value="receipts" className="mt-4 space-y-4">
          {receiptsState.loading ? <LoadingTable cols={6} />
            : receiptsState.error ? <LoadError error={receiptsState.error} onRetry={receiptsState.reload} />
            : (receiptsState.data?.receipts.length ?? 0) === 0 ? <EmptyState title="لا توجد سندات قبض" hint="سجّل أول تحصيل من العملاء" />
            : (
              <ScrollTable maxHeight="max-h-[480px]">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 z-10 bg-background shadow-[0_1px_0_0_var(--border)]">
                    <tr className="text-right text-xs text-muted-foreground">
                      <th className="px-2 py-2.5 font-medium">الرقم</th>
                      <th className="px-2 py-2.5 font-medium">التاريخ</th>
                      <th className="px-2 py-2.5 font-medium">العميل</th>
                      <th className="px-2 py-2.5 font-medium">المبلغ</th>
                      <th className="px-2 py-2.5 font-medium">الطريقة</th>
                      <th className="px-2 py-2.5 font-medium">الخزينة</th>
                      <th className="px-2 py-2.5 font-medium">التخصيص</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(receiptsState.data?.receipts ?? []).map((r) => (
                      <tr key={r.id} className="border-t align-top transition-colors hover:bg-muted/40">
                        <td className="whitespace-nowrap px-2 py-2.5"><Ltr className="text-xs font-bold">{r.number}</Ltr></td>
                        <td className="whitespace-nowrap px-2 py-2.5 text-xs text-muted-foreground"><Ltr>{formatDate(r.date)}</Ltr></td>
                        <td className="max-w-36 truncate px-2 py-2.5 text-xs">{r.customerName}</td>
                        <td className="whitespace-nowrap px-2 py-2.5"><Money p={r.amount} /></td>
                        <td className="px-2 py-2.5 text-xs">{r.method || '—'}</td>
                        <td className="max-w-32 truncate px-2 py-2.5 text-xs text-muted-foreground">{r.treasuryAccountName}</td>
                        <td className="px-2 py-2.5">
                          <div className="flex flex-wrap gap-1">
                            {r.allocations.map((a, i) => (
                              <ToneBadge key={i} tone="info" className="text-[10px]">
                                <Ltr>{a.invoiceNumber}</Ltr> · <Money p={a.amount} withSymbol={false} />
                              </ToneBadge>
                            ))}
                            {r.onAccount > 0 ? <ToneBadge tone="warning" className="text-[10px]">على الحساب · <Money p={r.onAccount} withSymbol={false} /></ToneBadge> : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollTable>
            )}
        </TabsContent>

        <TabsContent value="requests" className="mt-4">
          {requestsState.loading ? <LoadingTable cols={5} />
            : requestsState.error ? <LoadError error={requestsState.error} onRetry={requestsState.reload} />
            : (requestsState.data?.requests.length ?? 0) === 0 ? <EmptyState title="لا توجد طلبات دفع" hint="طلبات العملاء من البوابة تظهر هنا" />
            : (
              <ScrollTable maxHeight="max-h-[480px]">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 z-10 bg-background shadow-[0_1px_0_0_var(--border)]">
                    <tr className="text-right text-xs text-muted-foreground">
                      <th className="px-2 py-2.5 font-medium">المبلغ</th>
                      <th className="px-2 py-2.5 font-medium">الطريقة</th>
                      <th className="px-2 py-2.5 font-medium">مرجع</th>
                      <th className="px-2 py-2.5 font-medium">الحالة</th>
                      <th className="px-2 py-2.5 font-medium">أُنشئ</th>
                      {can(user, 'payments:approve') ? <th className="px-2 py-2.5 font-medium text-center">إجراءات</th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {(requestsState.data?.requests ?? []).map((req) => (
                      <tr key={req.id} className="border-t transition-colors hover:bg-muted/40">
                        <td className="whitespace-nowrap px-2 py-2.5"><Money p={req.amount} /></td>
                        <td className="px-2 py-2.5 text-xs">{req.method || '—'}</td>
                        <td className="px-2 py-2.5 text-xs"><Ltr>{req.reference || '—'}</Ltr></td>
                        <td className="px-2 py-2.5">
                          <ToneBadge tone={req.status === 'approved' ? 'success' : req.status === 'rejected' ? 'danger' : 'warning'}>
                            {PAYMENT_REQUEST_STATUS_LABELS[req.status] ?? req.status}
                          </ToneBadge>
                          {req.status === 'rejected' && req.rejectionReason ? (
                            <p className="mt-1 text-[10px] text-muted-foreground">{req.rejectionReason}</p>
                          ) : null}
                        </td>
                        <td className="whitespace-nowrap px-2 py-2.5 text-xs text-muted-foreground"><Ltr>{formatDate(req.createdAt)}</Ltr></td>
                        {can(user, 'payments:approve') ? (
                          <td className="px-2 py-2.5">
                            {req.status === 'pending' ? (
                              <div className="flex items-center justify-center gap-1.5">
                                <Button size="sm" variant="outline" className="min-h-10 gap-1 border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-950/40"
                                  onClick={() => setApproveReq(req)}>
                                  <BadgeCheck className="size-4" aria-hidden /> اعتماد
                                </Button>
                                <Button size="sm" variant="outline" className="min-h-10 gap-1 border-red-200 text-red-700 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950/40"
                                  onClick={() => setRejectReq(req)}>
                                  <XCircle className="size-4" aria-hidden /> رفض
                                </Button>
                              </div>
                            ) : <span className="text-xs text-muted-foreground">—</span>}
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollTable>
            )}
        </TabsContent>
      </SectionCard>

      <CreateReceiptDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        customers={customers}
        treasuries={treasuriesState.data?.accounts ?? []}
        onCreated={() => { setCreateOpen(false); refreshAll(); }}
      />

      <ApproveRequestDialog
        request={approveReq}
        treasuries={treasuriesState.data?.accounts ?? []}
        onClose={() => setApproveReq(null)}
        onDone={() => { setApproveReq(null); refreshAll(); }}
      />

      <RejectRequestDialog
        request={rejectReq}
        onClose={() => setRejectReq(null)}
        onDone={() => { setRejectReq(null); refreshAll(); }}
      />
    </Tabs>
  );
}

/* ------------------------------ سند قبض جديد ------------------------------- */

interface DraftAlloc { invoiceId: string; amount: string }

function CreateReceiptDialog({
  open, onOpenChange, customers, treasuries, onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  customers: Customer[] | null;
  treasuries: TreasuryAccount[];
  onCreated: () => void;
}) {
  const { toast } = useToast();
  const [customerId, setCustomerId] = React.useState('');
  const [date, setDate] = React.useState(todayISO());
  const [amount, setAmount] = React.useState('');
  const [treasuryId, setTreasuryId] = React.useState('');
  const [method, setMethod] = React.useState('نقدي');
  const [notes, setNotes] = React.useState('');
  const [autoFifo, setAutoFifo] = React.useState(true);
  const [allocs, setAllocs] = React.useState<DraftAlloc[]>([]);
  const [openInvoices, setOpenInvoices] = React.useState<Invoice[]>([]);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setCustomerId(''); setDate(todayISO()); setAmount(''); setTreasuryId('');
      setMethod('نقدي'); setNotes(''); setAutoFifo(true); setAllocs([]); setOpenInvoices([]);
    }
  }, [open]);

  // جلب الفواتير المفتوحة للعميل عند اختياره وإيقاف FIFO
  React.useEffect(() => {
    if (!open || !customerId || autoFifo) { setOpenInvoices([]); return; }
    let cancelled = false;
    api
      .get<{ invoices: Invoice[] }>(`invoices?customer=${encodeURIComponent(customerId)}`)
      .then((d) => { if (!cancelled) setOpenInvoices(d.invoices.filter((i) => i.balance > 0 && i.status !== 'cancelled')); })
      .catch(() => { if (!cancelled) setOpenInvoices([]); });
    return () => { cancelled = true; };
  }, [open, customerId, autoFifo]);

  const amountP = parseEGPToPiasters(amount);
  const amountOk = amountP !== null && amountP > 0;
  const allocTotal = allocs.reduce((s, a) => s + (parseEGPToPiasters(a.amount) ?? 0), 0);
  const allocsOk = autoFifo || (allocs.length > 0 && allocs.every((a) => a.invoiceId && (parseEGPToPiasters(a.amount) ?? 0) > 0) && allocTotal === (amountP ?? -1));
  const canSubmit = customerId && amountOk && treasuryId && allocsOk && !saving;

  const submit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        customerId, date, amount, treasuryAccountId: treasuryId, method, notes: notes.trim() || undefined,
      };
      if (!autoFifo) body.allocations = allocs.map((a) => ({ invoiceId: a.invoiceId, amount: a.amount }));
      await api.post('payments/receipts', body);
      toast({
        title: 'تم تسجيل سند القبض',
        description: `${formatEGP(amountP ?? 0)} — ${autoFifo ? 'بتوزيع تلقائي FIFO على الفواتير المفتوحة' : 'بتخصيص صريح'}`,
        variant: 'success',
      });
      onCreated();
    } catch (e) {
      toast({ title: 'تعذر تسجيل السند', description: e instanceof ErpError ? e.message : 'خطأ غير متوقع', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto scrollbar-erp sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>سند قبض جديد</DialogTitle>
          <DialogDescription>يُرحَّل قيد التحصيل فوراً ويُخصم من ذمم العميل.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>العميل</Label>
              <Select value={customerId} onValueChange={setCustomerId}>
                <SelectTrigger className="h-11 w-full"><SelectValue placeholder="اختر…" /></SelectTrigger>
                <SelectContent>
                  {(customers ?? []).filter((c) => c.active).map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      <span className="flex items-center gap-2"><Ltr className="text-xs text-muted-foreground">{c.code}</Ltr> {c.name}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="rec-amount">المبلغ</Label>
              <div className="relative">
                <Input id="rec-amount" dir="ltr" inputMode="decimal" className="h-11 pl-10 text-left tabular-nums" value={amount}
                  onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} placeholder="0.00" />
                <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-[10px] text-muted-foreground">ج.م</span>
              </div>
              {amount && !amountOk ? <p className="text-xs text-destructive">مبلغ غير صالح</p> : null}
            </div>
            <div className="space-y-2">
              <Label>الخزينة / البنك</Label>
              <Select value={treasuryId} onValueChange={setTreasuryId}>
                <SelectTrigger className="h-11 w-full"><SelectValue placeholder="اختر…" /></SelectTrigger>
                <SelectContent>
                  {treasuries.filter((t) => t.active !== false).map((t) => (
                    <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="rec-date">التاريخ</Label>
              <Input id="rec-date" type="date" dir="ltr" className="h-11 text-left tabular-nums" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="col-span-2 space-y-2">
              <Label>طريقة الدفع</Label>
              <Select value={method} onValueChange={setMethod}>
                <SelectTrigger className="h-11 w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="نقدي">نقدي</SelectItem>
                  <SelectItem value="تحويل بنكي">تحويل بنكي</SelectItem>
                  <SelectItem value="شيك">شيك</SelectItem>
                  <SelectItem value="محفظة إلكترونية">محفظة إلكترونية</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg border bg-muted/30 px-3 py-2.5">
            <div className="flex items-center gap-2 text-xs">
              <Info className="size-4 text-teal-600" aria-hidden />
              <span>توزيع تلقائي FIFO على الفواتير الأقدم استحقاقاً</span>
            </div>
            <Switch checked={autoFifo} onCheckedChange={setAutoFifo} aria-label="توزيع تلقائي" />
          </div>

          {!autoFifo ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>تخصيص صريح على فواتير</Label>
                <span className="text-xs tabular-nums text-muted-foreground">
                  المخصص: <Money p={allocTotal} withSymbol={false} /> / <Money p={amountP ?? 0} withSymbol={false} />
                </span>
              </div>
              {openInvoices.length === 0 ? (
                <p className="text-xs text-muted-foreground">اختر عميلاً له فواتير مفتوحة أولاً.</p>
              ) : (
                <>
                  {allocs.map((a, idx) => (
                    <div key={idx} className="grid grid-cols-[1fr_120px_auto] gap-2">
                      <Select value={a.invoiceId} onValueChange={(v) => setAllocs((arr) => arr.map((x, i) => (i === idx ? { ...x, invoiceId: v } : x)))}>
                        <SelectTrigger className="h-11 w-full"><SelectValue placeholder="فاتورة…" /></SelectTrigger>
                        <SelectContent>
                          {openInvoices.map((inv) => (
                            <SelectItem key={inv.id} value={inv.id}>
                              <Ltr>{inv.number}</Ltr> — متبقٍ <Money p={inv.balance} withSymbol={false} />
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input dir="ltr" inputMode="decimal" className="h-11 text-left tabular-nums" placeholder="0.00" value={a.amount}
                        onChange={(e) => setAllocs((arr) => arr.map((x, i) => (i === idx ? { ...x, amount: e.target.value.replace(/[^\d.]/g, '') } : x)))} />
                      <Button variant="ghost" size="icon" className="size-11 text-muted-foreground hover:text-destructive" aria-label="حذف التخصيص"
                        onClick={() => setAllocs((arr) => arr.filter((_, i) => i !== idx))}>×</Button>
                    </div>
                  ))}
                  <Button variant="outline" className="min-h-10 w-full border-dashed"
                    onClick={() => setAllocs((arr) => [...arr, { invoiceId: '', amount: '' }])}>
                    + تخصيص على فاتورة
                  </Button>
                  {allocTotal !== (amountP ?? 0) ? (
                    <p className="text-xs text-amber-600 dark:text-amber-400">مجموع التخصيص يجب أن يساوي مبلغ السند تماماً.</p>
                  ) : null}
                </>
              )}
            </div>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="rec-notes">ملاحظات</Label>
            <Input id="rec-notes" className="h-11" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="اختياري" />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" className="min-h-11" onClick={() => onOpenChange(false)}>إلغاء</Button>
          <Button className="min-h-11 bg-emerald-600 text-white hover:bg-emerald-700" disabled={!canSubmit} onClick={() => void submit()}>
            {saving ? 'جارٍ التسجيل…' : 'تسجيل السند'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------- اعتماد طلب -------------------------------- */

function ApproveRequestDialog({
  request, treasuries, onClose, onDone,
}: {
  request: PaymentRequest | null;
  treasuries: TreasuryAccount[];
  onClose: () => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [treasuryId, setTreasuryId] = React.useState('');
  const [date, setDate] = React.useState(todayISO());
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (request) {
      setTreasuryId(treasuries[0]?.id ?? '');
      setDate(todayISO());
    }
  }, [request]);

  const submit = async () => {
    if (!request || !treasuryId) return;
    setSaving(true);
    try {
      await api.post(`payments/requests/${encodeURIComponent(request.id)}/approve`, { treasuryAccountId: treasuryId, date });
      toast({ title: 'تم اعتماد الطلب', description: `سُجل سند قبض بمبلغ ${formatEGP(request.amount)}`, variant: 'success' });
      onDone();
    } catch (e) {
      toast({ title: 'تعذر الاعتماد', description: e instanceof ErpError ? e.message : 'خطأ غير متوقع', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={request !== null} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>اعتماد طلب دفع</DialogTitle>
          <DialogDescription>
            سيُسجل سند قبض بمبلغ {request ? <Money p={request.amount} /> : '—'} ويُخصم من ذمم العميل.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="space-y-2">
            <Label>خزينة الاستلام</Label>
            <Select value={treasuryId} onValueChange={setTreasuryId}>
              <SelectTrigger className="h-11 w-full"><SelectValue placeholder="اختر الخزينة…" /></SelectTrigger>
              <SelectContent>
                {treasuries.filter((t) => t.active !== false).map((t) => (
                  <SelectItem key={t.id} value={t.id}>{t.name} — <Money p={t.balancePiasters} withSymbol={false} /></SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="apr-date">التاريخ</Label>
            <Input id="apr-date" type="date" dir="ltr" className="h-11 text-left tabular-nums" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" className="min-h-11" onClick={onClose}>إلغاء</Button>
          <Button className="min-h-11 bg-emerald-600 text-white hover:bg-emerald-700" disabled={!treasuryId || saving} onClick={() => void submit()}>
            {saving ? 'جارٍ الاعتماد…' : 'اعتماد وتسجيل السند'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------- رفض طلب ---------------------------------- */

function RejectRequestDialog({ request, onClose, onDone }: { request: PaymentRequest | null; onClose: () => void; onDone: () => void }) {
  const { toast } = useToast();
  const [reason, setReason] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (request) setReason('');
  }, [request]);

  const ok = reason.trim().length >= 5;

  const submit = async () => {
    if (!request || !ok) return;
    setSaving(true);
    try {
      await api.post(`payments/requests/${encodeURIComponent(request.id)}/reject`, { reason: reason.trim() });
      toast({ title: 'تم رفض الطلب', variant: 'success' });
      onDone();
    } catch (e) {
      toast({ title: 'تعذر الرفض', description: e instanceof ErpError ? e.message : 'خطأ غير متوقع', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={request !== null} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>رفض طلب دفع</DialogTitle>
          <DialogDescription>اذكر سبب الرفض ليظهر للعميل في البوابة.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="rej-reason">السبب (5 أحرف على الأقل)</Label>
          <Input id="rej-reason" className="h-11" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="مثال: مرجع التحويل غير واضح" />
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" className="min-h-11" onClick={onClose}>رجوع</Button>
          <Button variant="destructive" className="min-h-11" disabled={!ok || saving} onClick={() => void submit()}>
            {saving ? 'جارٍ الرفض…' : 'تأكيد الرفض'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
