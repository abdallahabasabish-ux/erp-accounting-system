'use client';

/**
 * عناصر واجهة مشتركة لكل أقسام لوحة ERP — حالات تحميل/خطأ/فراغ، بطاقات إحصاء،
 * شارات حالة، مدخلات مبالغ بالجنيه، وجدول متوافق مع RTL والجوال.
 */
import * as React from 'react';
import { AlertTriangle, Inbox, Loader2, RefreshCw } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { ErpError, formatEGP } from '@/lib/erp';

/** محتوى LTR داخل سياق RTL (أرقام، رموز مستندات، بريد) حتى لا يتشوه النص */
export function Ltr({ children, className }: { children: React.ReactNode; className?: string }) {
  return <bdi dir="ltr" className={cn('inline-block', className)}>{children}</bdi>;
}

/** مبلغ مالي منسق من القروش (عدد صحيح) → جنيه */
export function Money({ p, className, withSymbol = true }: { p: number; className?: string; withSymbol?: boolean }) {
  const negative = p < 0;
  return (
    <span dir="ltr" className={cn('inline-block font-medium tabular-nums', negative && 'text-destructive', className)}>
      {formatEGP(p, withSymbol)}
    </span>
  );
}

/* ------------------------------ حالات البيانات ------------------------------ */

export function LoadingBlock({ label = 'جارٍ التحميل…', rows = 4 }: { label?: string; rows?: number }) {
  return (
    <div className="space-y-3" role="status" aria-label={label}>
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        {label}
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-8 w-full" style={{ opacity: 1 - i * 0.15 }} />
      ))}
    </div>
  );
}

export function LoadingTable({ cols, rows = 5 }: { cols: number; rows?: number }) {
  return (
    <div className="space-y-2" role="status" aria-label="جارٍ تحميل الجدول">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-3">
          {Array.from({ length: cols }).map((__, j) => (
            <Skeleton key={j} className="h-9 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}

export function LoadError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const message = error instanceof ErpError ? error.message : 'حدث خطأ غير متوقع أثناء تحميل البيانات';
  const code = error instanceof ErpError ? error.code : null;
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-center">
      <AlertTriangle className="size-8 text-destructive" aria-hidden />
      <div>
        <p className="font-medium text-destructive">{message}</p>
        {code ? <p className="mt-1 text-xs text-muted-foreground"><Ltr>{code}</Ltr></p> : null}
      </div>
      <Button variant="outline" size="sm" onClick={onRetry} className="min-h-11">
        <RefreshCw className="size-4" aria-hidden /> إعادة المحاولة
      </Button>
    </div>
  );
}

export function EmptyState({ title, hint, icon: Icon = Inbox }: { title: string; hint?: string; icon?: React.ComponentType<{ className?: string }> }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-8 text-center text-muted-foreground">
      <Icon className="size-9 opacity-60" aria-hidden />
      <p className="font-medium text-foreground">{title}</p>
      {hint ? <p className="text-sm">{hint}</p> : null}
    </div>
  );
}

/* --------------------------------- بطاقات --------------------------------- */

export function SectionCard({
  title, description, actions, children, footer, className, contentClassName,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  return (
    <Card className={className}>
      <CardHeader className="flex-row items-start justify-between space-y-0 gap-3">
        <div className="min-w-0 space-y-1">
          <CardTitle className="text-base font-semibold">{title}</CardTitle>
          {description ? <CardDescription className="text-xs leading-relaxed">{description}</CardDescription> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </CardHeader>
      <CardContent className={contentClassName}>{children}</CardContent>
      {footer ? <CardFooter className="border-t pt-4">{footer}</CardFooter> : null}
    </Card>
  );
}

export function StatCard({
  title, value, hint, icon: Icon, loading, tone = 'default',
}: {
  title: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
  loading?: boolean;
  tone?: 'default' | 'positive' | 'warning' | 'negative';
}) {
  const toneClass =
    tone === 'positive' ? 'text-emerald-600 dark:text-emerald-400'
    : tone === 'warning' ? 'text-amber-600 dark:text-amber-400'
    : tone === 'negative' ? 'text-destructive'
    : 'text-foreground';
  return (
    <Card className="gap-2 py-4">
      <CardContent className="space-y-1 px-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium text-muted-foreground">{title}</p>
          {Icon ? <Icon className="size-4 text-muted-foreground/70" aria-hidden /> : null}
        </div>
        {loading ? <Skeleton className="h-7 w-28" /> : <p className={cn('text-lg font-bold tabular-nums', toneClass)}>{value}</p>}
        {hint && !loading ? <p className="text-[11px] leading-relaxed text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}

/* --------------------------------- شارات ---------------------------------- */

type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'accent';

const badgeToneClasses: Record<BadgeTone, string> = {
  neutral: 'bg-muted text-muted-foreground border-border',
  success: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-900',
  warning: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-900',
  danger: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/50 dark:text-red-300 dark:border-red-900',
  info: 'bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-950/50 dark:text-teal-300 dark:border-teal-900',
  accent: 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800/60 dark:text-slate-300 dark:border-slate-700',
};

export function ToneBadge({ tone = 'neutral', children, className }: { tone?: BadgeTone; children: React.ReactNode; className?: string }) {
  return (
    <Badge variant="outline" className={cn('font-medium', badgeToneClasses[tone], className)}>
      {children}
    </Badge>
  );
}

/** شارة حالة الفاتورة — أحمر غير مدفوعة، كهرماني جزئية، أخضر مدفوعة، رمادي ملغاة */
export function InvoiceStatusBadge({ status, labels }: { status: string; labels: Record<string, string> }) {
  const tone: BadgeTone =
    status === 'paid' ? 'success' : status === 'partial' ? 'warning' : status === 'unpaid' ? 'danger' : 'neutral';
  return <ToneBadge tone={tone}>{labels[status] ?? status}</ToneBadge>;
}

/** شارة نوع القيد اليومي */
export function JournalTypeBadge({ type, labels }: { type: string; labels: Record<string, string> }) {
  const tone: BadgeTone =
    type === 'reversal' ? 'warning' : type === 'closing' ? 'accent' : type === 'opening' ? 'info' : type === 'adjusting' ? 'success' : 'neutral';
  return <ToneBadge tone={tone}>{labels[type] ?? type}</ToneBadge>;
}

/* ------------------------------- مدخل المبالغ ------------------------------- */

export interface MoneyInputProps extends Omit<React.ComponentProps<typeof Input>, 'onChange' | 'value' | 'type'> {
  value: string;
  onValueChange: (v: string) => void;
  /** رسالة تحقق اختيارية تظهر أسفل الحقل */
  errorText?: string | null;
}

/** حقل مبلغ بالجنيه — يقبل أرقاماً عشرية بحد أقصى منزلتين، والتحقق نصي بلا floats */
export function MoneyInput({ value, onValueChange, errorText, className, ...props }: MoneyInputProps) {
  return (
    <div className="space-y-1">
      <div className="relative">
        <Input
          {...props}
          type="text"
          inputMode="decimal"
          dir="ltr"
          value={value}
          onChange={(e) => onValueChange(e.target.value.replace(/[^\d.]/g, ''))}
          className={cn('pr-12 text-left tabular-nums', errorText && 'border-destructive', className)}
          placeholder="0.00"
        />
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">ج.م</span>
      </div>
      {errorText ? <p className="text-xs text-destructive">{errorText}</p> : null}
    </div>
  );
}

/* ------------------------------- خطاف بيانات ------------------------------- */

export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: unknown;
  reload: () => void;
  setData: React.Dispatch<React.SetStateAction<T | null>>;
}

/** خطاف تحميل بيانات بسيط مع إعادة محاولة — يكفي لكل أقسام اللوحة */
export function useAsyncData<T>(loader: () => Promise<T>, deps: React.DependencyList): AsyncState<T> {
  const [data, setData] = React.useState<T | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<unknown>(null);
  const [tick, setTick] = React.useState(0);
  const loaderRef = React.useRef(loader);
  React.useEffect(() => {
    loaderRef.current = loader;
  });

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    loaderRef
      .current()
      .then((d) => { if (!cancelled) { setData(d); setError(null); } })
      .catch((e) => { if (!cancelled) setError(e); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [...deps, tick]);

  const reload = React.useCallback(() => setTick((t) => t + 1), []);
  return { data, loading, error, reload, setData };
}

/** جدول داخل حاوية قابلة للتمرير أفقياً (جوال) وعمودياً (قوائم طويلة) */
export function ScrollTable({ children, maxHeight = 'max-h-[420px]', className }: { children: React.ReactNode; maxHeight?: string; className?: string }) {
  return (
    <div className={cn('-mx-2 overflow-x-auto px-2', className)}>
      <div className={cn('min-w-[560px] overflow-y-auto scrollbar-erp', maxHeight)}>
        {children}
      </div>
    </div>
  );
}

export { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';