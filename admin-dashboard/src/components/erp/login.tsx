'use client';

/**
 * شاشة الدخول — لوحة هوية على اليمين + نموذج بريد/كلمة مرور مع أزرار تعبئة سريعة
 * للحسابات التجريبية. عند النجاح يُخزَّن {token, user} في localStorage (erp_auth).
 */
import * as React from 'react';
import { BarChart3, BookOpenCheck, Eye, EyeOff, Landmark, Loader2, LogIn, ShieldCheck, Users } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { api, ErpError, type AuthResponse, type ErpUser } from '@/lib/erp';
import { cn } from '@/lib/utils';

const DEMO_ACCOUNTS: { email: string; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { email: 'admin@demo.eg', label: 'مدير النظام', icon: ShieldCheck },
  { email: 'manager@demo.eg', label: 'مدير مالي', icon: Landmark },
  { email: 'accountant@demo.eg', label: 'محاسب', icon: BookOpenCheck },
  { email: 'employee@demo.eg', label: 'موظف', icon: Users },
  { email: 'client@demo.eg', label: 'عميل', icon: BarChart3 },
];

const FEATURES = [
  { title: 'قيود مزدوجة فورية', text: 'كل عملية تُرحِّل قيداً محاسبياً متوازناً تلقائياً' },
  { title: 'فواتير بضريبة القيمة المضافة', text: 'احتساب دقيق بالقروش وتوزيع ذمم تلقائي' },
  { title: 'قوائم مالية كاملة', text: 'ميزان مراجعة، دخل، ميزانية عمومية، تدفقات نقدية' },
  { title: 'صلاحيات دقيقة', text: 'كل مستخدم يرى ما يخصه فقط — فحص على الخادم' },
];

export function LoginScreen({ onSuccess, meta }: { onSuccess: (token: string, user: ErpUser) => void; meta: { mode: string; vatRate: number } | null }) {
  const { toast } = useToast();
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [showPassword, setShowPassword] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const doLogin = React.useCallback(async (mail: string, pass: string) => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res: AuthResponse = await api.post('auth/login', { email: mail, password: pass });
      toast({ title: 'تم تسجيل الدخول', description: `أهلاً بك، ${res.user.displayName}`, variant: 'success' });
      onSuccess(res.token, res.user);
    } catch (e) {
      const message = e instanceof ErpError ? e.message : 'تعذر تسجيل الدخول — حاول مرة أخرى';
      setError(message);
      toast({ title: 'فشل تسجيل الدخول', description: message, variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  }, [onSuccess, submitting, toast]);

  return (
    <div className="flex min-h-screen items-stretch bg-muted/40">
      {/* لوحة الهوية */}
      <aside className="relative hidden w-[46%] flex-col justify-between overflow-hidden bg-gradient-to-bl from-emerald-800 via-teal-800 to-slate-900 p-10 text-white lg:flex">
        <div className="absolute -left-24 -top-24 size-72 rounded-full bg-emerald-400/10 blur-2xl" aria-hidden />
        <div className="absolute -bottom-32 -right-16 size-96 rounded-full bg-teal-400/10 blur-2xl" aria-hidden />
        <div className="relative space-y-3">
          <div className="flex items-center gap-3">
            <span className="flex size-12 items-center justify-center rounded-2xl bg-white/10 backdrop-blur">
              <Landmark className="size-6" aria-hidden />
            </span>
            <div>
              <p className="text-lg font-bold leading-tight">نظام الأعمال المحاسبي</p>
              <p className="text-xs text-emerald-100/80">ERP مزدوج القيد — الجنيه المصري</p>
            </div>
          </div>
        </div>
        <div className="relative space-y-6">
          <h1 className="text-3xl font-bold leading-snug">
            محاسبة مؤسسية كاملة،
            <br />
            من القيد إلى القائمة المالية.
          </h1>
          <ul className="space-y-4">
            {FEATURES.map((f) => (
              <li key={f.title} className="flex gap-3">
                <span className="mt-1 flex size-6 shrink-0 items-center justify-center rounded-full bg-emerald-400/20 text-emerald-200">
                  <BookOpenCheck className="size-3.5" aria-hidden />
                </span>
                <div>
                  <p className="text-sm font-semibold">{f.title}</p>
                  <p className="text-xs text-emerald-100/70">{f.text}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-emerald-100/60">
          {meta ? (
            <>
              الوضع الحالي: {meta.mode === 'demo' ? 'وضع تجربة ببيانات بذور واقعية' : 'وضع إنتاج'} · نسبة الضريبة{' '}
              <bdi dir="ltr">{meta.vatRate}%</bdi>
            </>
          ) : (
            'جارٍ قراءة إعدادات النظام…'
          )}
        </p>
      </aside>

      {/* نموذج الدخول */}
      <main className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-md space-y-6">
          <div className="space-y-2 text-center lg:text-right">
            <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-emerald-600 text-white shadow-lg shadow-emerald-600/20 lg:mx-0">
              <Landmark className="size-7" aria-hidden />
            </span>
            <h2 className="text-2xl font-bold">تسجيل الدخول</h2>
            <p className="text-sm text-muted-foreground">أدخل بيانات حسابك للوصول إلى لوحة النظام المالية</p>
          </div>

          <Card className="shadow-xl shadow-slate-900/5">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">حسابك</CardTitle>
              <CardDescription>يتم فحص الصلاحيات على الخادم في كل طلب</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <form
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  void doLogin(email.trim(), password);
                }}
              >
                <div className="space-y-2">
                  <Label htmlFor="login-email">البريد الإلكتروني</Label>
                  <Input
                    id="login-email"
                    type="email"
                    dir="ltr"
                    className="h-11 text-left"
                    placeholder="admin@demo.eg"
                    autoComplete="username"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="login-password">كلمة المرور</Label>
                  <div className="relative">
                    <Input
                      id="login-password"
                      type={showPassword ? 'text' : 'password'}
                      dir="ltr"
                      className="h-11 pl-11 text-left"
                      placeholder="demo1234"
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                    />
                    <button
                      type="button"
                      aria-label={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                      onClick={() => setShowPassword((s) => !s)}
                      className="absolute inset-y-0 left-0 flex w-11 items-center justify-center text-muted-foreground hover:text-foreground"
                    >
                      {showPassword ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
                    </button>
                  </div>
                </div>

                {error ? (
                  <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {error}
                  </p>
                ) : null}

                <Button type="submit" disabled={submitting} className="h-11 w-full gap-2 bg-emerald-600 text-white hover:bg-emerald-700">
                  {submitting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <LogIn className="size-4" aria-hidden />}
                  دخول
                </Button>
              </form>

              <div className="space-y-2 border-t pt-4">
                <p className="text-xs text-muted-foreground">حسابات تجريبية (كلمة المرور <bdi dir="ltr">demo1234</bdi>) — اضغط للتعبئة:</p>
                <div className="flex flex-wrap gap-2">
                  {DEMO_ACCOUNTS.map((acc) => (
                    <button
                      key={acc.email}
                      type="button"
                      disabled={submitting}
                      onClick={() => {
                        setEmail(acc.email);
                        setPassword('demo1234');
                        void doLogin(acc.email, 'demo1234');
                      }}
                      className={cn(
                        'inline-flex min-h-11 items-center gap-2 rounded-lg border bg-background px-3 text-xs font-medium transition-colors',
                        'hover:border-emerald-500/60 hover:bg-emerald-50 hover:text-emerald-800 dark:hover:bg-emerald-950/40 dark:hover:text-emerald-200',
                        submitting && 'opacity-50',
                      )}
                    >
                      <acc.icon className="size-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden />
                      {acc.label}
                    </button>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
