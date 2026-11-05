'use client';

/**
 * الفترات المالية — قائمة الفترات الشهرية مع حالتها (مفتوحة/مغلقة/مقفلة)
 * وإغلاق بسبب (5 أحرف على الأقل) وإعادة فتح بسبب أقصر (10 أحرف على الأقل).
 */
import * as React from 'react';
import { CalendarOff, Lock, LockOpen } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  EmptyState, LoadError, LoadingTable, Ltr, SectionCard, ToneBadge, useAsyncData,
} from '@/components/erp/shared';
import { useToast } from '@/hooks/use-toast';
import {
  PERIOD_STATUS_LABELS, api, can, ErpError, formatDate, type ErpUser, type FiscalPeriod, type PeriodStatus,
} from '@/lib/erp';

const statusTone: Record<PeriodStatus, 'success' | 'warning' | 'danger'> = {
  open: 'success',
  closed: 'warning',
  locked: 'danger',
};

export function PeriodsSection({ user }: { user: ErpUser }) {
  const { toast } = useToast();
  const { data, loading, error, reload } = useAsyncData<{ periods: FiscalPeriod[] }>(() => api.get('periods'), []);
  const [closeOf, setCloseOf] = React.useState<FiscalPeriod | null>(null);
  const [reopenOf, setReopenOf] = React.useState<FiscalPeriod | null>(null);

  const canClose = can(user, 'periods:close');
  const periods = data?.periods ?? [];

  return (
    <SectionCard
      title="الفترات المالية"
      description="إغلاق الفترة يجمّد ترحيل القيود عليها — إعادة الفتح تحتاج صلاحية وبخساً موثقاً"
      actions={<ToneBadge tone="neutral"><Ltr>{periods.length}</Ltr> فترة</ToneBadge>}
    >
      {loading ? <LoadingTable cols={6} />
        : error ? <LoadError error={error} onRetry={reload} />
        : periods.length === 0 ? <EmptyState title="لا فترات معرفة" icon={CalendarOff} />
        : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b text-right text-xs text-muted-foreground">
                  <th className="px-2 py-2.5 font-medium">الفترة</th>
                  <th className="px-2 py-2.5 font-medium">من</th>
                  <th className="px-2 py-2.5 font-medium">إلى</th>
                  <th className="px-2 py-2.5 font-medium">الحالة</th>
                  <th className="px-2 py-2.5 font-medium">معلومات الإغلاق</th>
                  {canClose ? <th className="px-2 py-2.5 font-medium text-center">إجراءات</th> : null}
                </tr>
              </thead>
              <tbody>
                {periods.map((p) => (
                  <tr key={p.key} className="border-t transition-colors hover:bg-muted/40">
                    <td className="px-2 py-3"><Ltr className="font-bold">{p.key}</Ltr></td>
                    <td className="px-2 py-3 text-xs text-muted-foreground"><Ltr>{formatDate(p.start)}</Ltr></td>
                    <td className="px-2 py-3 text-xs text-muted-foreground"><Ltr>{formatDate(p.end)}</Ltr></td>
                    <td className="px-2 py-3">
                      <ToneBadge tone={statusTone[p.status]}>{PERIOD_STATUS_LABELS[p.status]}</ToneBadge>
                    </td>
                    <td className="px-2 py-3 text-xs text-muted-foreground">
                      {p.closeReason ? (
                        <span>
                          {p.closedBy?.name || p.closedBy?.email ? <>بواسطة {p.closedBy?.name || p.closedBy?.email} · </> : null}
                          «{p.closeReason}»
                          {p.reopenedAt ? <span className="mr-2 text-emerald-600 dark:text-emerald-400">أُعيد فتحها لاحقاً</span> : null}
                        </span>
                      ) : '—'}
                    </td>
                    {canClose ? (
                      <td className="px-2 py-3">
                        <div className="flex items-center justify-center gap-1.5">
                          {p.status === 'open' ? (
                            <Button size="sm" variant="outline" className="min-h-10 gap-1 border-amber-300 text-amber-700 hover:bg-amber-50 dark:text-amber-300 dark:hover:bg-amber-950/40"
                              onClick={() => setCloseOf(p)}>
                              <Lock className="size-3.5" aria-hidden /> إغلاق
                            </Button>
                          ) : p.status !== 'locked' ? (
                            <Button size="sm" variant="outline" className="min-h-10 gap-1"
                              onClick={() => setReopenOf(p)}>
                              <LockOpen className="size-3.5" aria-hidden /> إعادة فتح
                            </Button>
                          ) : <span className="text-xs text-muted-foreground">مقفلة نهائياً</span>}
                        </div>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

      <ReasonDialog
        open={closeOf !== null}
        title={`إغلاق الفترة ${closeOf?.key ?? ''}`}
        description="لن يُقبل أي قيد بتاريخ داخل هذه الفترة بعد الإغلاق."
        label="سبب الإغلاق"
        placeholder="مثال: جرد نهاية الشهر ومراجعة نهائية"
        minLength={5}
        minText="السبب قصير جداً — 5 أحرف على الأقل"
        confirmText="إغلاق الفترة"
        onClose={() => setCloseOf(null)}
        onSubmit={async (reason) => {
          if (!closeOf) return;
          await api.post(`periods/${encodeURIComponent(closeOf.key)}/close`, { reason });
          toast({ title: 'تم إغلاق الفترة', description: closeOf.key, variant: 'success' });
          reload();
        }}
        onDone={() => setCloseOf(null)}
      />

      <ReasonDialog
        open={reopenOf !== null}
        title={`إعادة فتح الفترة ${reopenOf?.key ?? ''}`}
        description="سيصبح ترحيل القيود على هذه الفترة ممكناً من جديد — سجل السبب للتوثيق."
        label="سبب إعادة الفتح"
        placeholder="مثال: تسوية قيد تم اكتشافه بعد الإغلاق"
        minLength={10}
        minText="السبب قصير جداً — 10 أحرف على الأقل"
        confirmText="إعادة الفتح"
        onClose={() => setReopenOf(null)}
        onSubmit={async (reason) => {
          if (!reopenOf) return;
          await api.post(`periods/${encodeURIComponent(reopenOf.key)}/reopen`, { reason });
          toast({ title: 'تم إعادة فتح الفترة', description: reopenOf.key, variant: 'success' });
          reload();
        }}
        onDone={() => setReopenOf(null)}
      />
    </SectionCard>
  );
}

/* --------------------------- حوار سبب عام (إغلاق/فتح) -------------------------- */

function ReasonDialog({
  open, title, description, label, placeholder, minLength, minText, confirmText, onClose, onSubmit, onDone,
}: {
  open: boolean;
  title: string;
  description: string;
  label: string;
  placeholder: string;
  minLength: number;
  minText: string;
  confirmText: string;
  onClose: () => void;
  onSubmit: (reason: string) => Promise<void>;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [reason, setReason] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (open) setReason('');
  }, [open]);

  const ok = reason.trim().length >= minLength;

  const submit = async () => {
    if (!ok) return;
    setSaving(true);
    try {
      await onSubmit(reason.trim());
      onDone();
    } catch (e) {
      toast({ title: 'تعذر تنفيذ العملية', description: e instanceof ErpError ? e.message : 'خطأ غير متوقع', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="period-reason">{label}</Label>
          <Textarea id="period-reason" className="min-h-20" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={placeholder} />
          {reason && !ok ? <p className="text-xs text-destructive">{minText}</p> : null}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" className="min-h-11" onClick={onClose}>إلغاء</Button>
          <Button variant={confirmText.includes('إغلاق') ? 'destructive' : 'default'}
            className="min-h-11" disabled={!ok || saving} onClick={() => void submit()}>
            {saving ? 'جارٍ التنفيذ…' : confirmText}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
