'use client';

/**
 * هيكل اللوحة — شريط جانبي RTL على اليمين (يطوي إلى درج Sheet على الجوال) +
 * شريط علوي: اسم المستخدم، شارة الدور، شارة الوضع (تجربة/إنتاج)، مبدّل الوضع، خروج.
 */
import * as React from 'react';
import { Landmark, LogOut, Menu, Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { ROLE_LABELS, type ErpMeta, type ErpUser } from '@/lib/erp';
import { cn } from '@/lib/utils';

export interface ErpNavItem {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  group: string;
}

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  const isDark = mounted && resolvedTheme === 'dark';
  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-10"
      aria-label={isDark ? 'التبديل إلى الوضع الفاتح' : 'التبديل إلى الوضع الداكن'}
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
    >
      {isDark ? <Sun className="size-4" aria-hidden /> : <Moon className="size-4" aria-hidden />}
    </Button>
  );
}

function ModeBadge({ meta }: { meta: ErpMeta | null }) {
  const demo = meta?.mode !== 'production';
  return (
    <Badge
      variant="outline"
      className={cn(
        'gap-1.5 px-2.5 py-1 text-[11px]',
        demo
          ? 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-300'
          : 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300',
      )}
    >
      <span className={cn('size-1.5 rounded-full', demo ? 'bg-amber-500' : 'bg-emerald-500')} aria-hidden />
      {demo ? 'وضع تجربة' : 'إنتاج'}
    </Badge>
  );
}

function RoleChip({ user }: { user: ErpUser }) {
  return (
    <Badge variant="outline" className="border-slate-200 bg-slate-50 text-[11px] text-slate-700 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-300">
      {ROLE_LABELS[user.role]}
    </Badge>
  );
}

function NavList({
  items, activeId, onNavigate, user,
}: {
  items: ErpNavItem[];
  activeId: string;
  onNavigate: (id: string) => void;
  user: ErpUser;
}) {
  const groups = React.useMemo(() => {
    const map = new Map<string, ErpNavItem[]>();
    for (const item of items) {
      const arr = map.get(item.group) ?? [];
      arr.push(item);
      map.set(item.group, arr);
    }
    return Array.from(map.entries());
  }, [items]);

  return (
    <TooltipProvider delayDuration={200}>
      <nav aria-label="أقسام النظام" className="flex-1 space-y-5 overflow-y-auto scrollbar-erp px-3 py-4">
        {groups.map(([group, groupItems]) => (
          <div key={group}>
            <p className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">{group}</p>
            <ul className="space-y-1">
              {groupItems.map((item) => {
                const active = item.id === activeId;
                return (
                  <li key={item.id}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          onClick={() => onNavigate(item.id)}
                          aria-current={active ? 'page' : undefined}
                          className={cn(
                            'flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors',
                            active
                              ? 'bg-emerald-600 text-white shadow-sm shadow-emerald-600/25'
                              : 'text-slate-600 hover:bg-emerald-50 hover:text-emerald-800 dark:text-slate-300 dark:hover:bg-emerald-950/40 dark:hover:text-emerald-200',
                          )}
                        >
                          <item.icon className={cn('size-4.5 shrink-0', active ? 'text-white' : 'text-emerald-600/80 dark:text-emerald-400/80')} aria-hidden />
                          <span className="truncate">{item.label}</span>
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="left">{item.label}</TooltipContent>
                    </Tooltip>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
        {/* إظهار بطاقة هوية داخل القائمة للجوال */}
        <div className="rounded-lg border bg-muted/40 p-3 md:hidden">
          <p className="text-sm font-semibold">{user.displayName}</p>
          <p className="mt-0.5 text-xs text-muted-foreground"><bdi dir="ltr">{user.email}</bdi></p>
        </div>
      </nav>
    </TooltipProvider>
  );
}

export function ErpShell({
  user, meta, navItems, activeId, onNavigate, onLogout, title, children,
}: {
  user: ErpUser;
  meta: ErpMeta | null;
  navItems: ErpNavItem[];
  activeId: string;
  onNavigate: (id: string) => void;
  onLogout: () => void;
  title: string;
  children: React.ReactNode;
}) {
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const navigate = (id: string) => {
    onNavigate(id);
    setDrawerOpen(false);
  };

  return (
    <div className="flex min-h-screen bg-muted/30">
      {/* الشريط الجانبي — يمين الشاشة في RTL */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-l bg-background md:flex">
        <div className="flex items-center gap-3 border-b px-4 py-4">
          <span className="flex size-10 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-sm shadow-emerald-600/30">
            <Landmark className="size-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold">نظام الأعمال</p>
            <p className="text-[11px] text-muted-foreground">لوحة المحاسبة ERP</p>
          </div>
        </div>
        <NavList items={navItems} activeId={activeId} onNavigate={navigate} user={user} />
        <div className="border-t p-3">
          <Button variant="outline" className="min-h-11 w-full justify-start gap-2 text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={onLogout}>
            <LogOut className="size-4" aria-hidden />
            تسجيل الخروج
          </Button>
        </div>
      </aside>

      {/* المحتوى */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <div className="flex h-14 items-center gap-2 px-3 sm:px-5">
            {/* درج الجوال */}
            <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
              <SheetTrigger asChild>
                <Button variant="outline" size="icon" className="size-10 md:hidden" aria-label="فتح القائمة">
                  <Menu className="size-5" aria-hidden />
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="w-72 p-0">
                <SheetHeader className="border-b py-4 text-right">
                  <SheetTitle className="flex items-center gap-2 text-sm">
                    <span className="flex size-8 items-center justify-center rounded-lg bg-emerald-600 text-white">
                      <Landmark className="size-4" aria-hidden />
                    </span>
                    نظام الأعمال المحاسبي
                  </SheetTitle>
                </SheetHeader>
                <NavList items={navItems} activeId={activeId} onNavigate={navigate} user={user} />
                <div className="border-t p-3">
                  <Button variant="outline" className="min-h-11 w-full justify-start gap-2 text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={onLogout}>
                    <LogOut className="size-4" aria-hidden />
                    تسجيل الخروج
                  </Button>
                </div>
              </SheetContent>
            </Sheet>

            <h1 className="truncate text-sm font-bold sm:text-base">{title}</h1>
            <div className="mr-auto flex items-center gap-2">
              <ModeBadge meta={meta} />
              <RoleChip user={user} />
              <span className="hidden max-w-40 truncate text-sm font-medium sm:inline">{user.displayName}</span>
              <ThemeToggle />
              <Button
                variant="ghost"
                size="icon"
                className="hidden size-10 text-muted-foreground hover:text-destructive md:inline-flex"
                aria-label="تسجيل الخروج"
                onClick={onLogout}
              >
                <LogOut className="size-4" aria-hidden />
              </Button>
            </div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 space-y-5 p-3 sm:p-5">{children}</main>
        <footer className="mt-auto border-t bg-background/60 px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] text-center text-[11px] text-muted-foreground">
          نظام الأعمال المحاسبي — القيد المزدوج · العملة: الجنيه المصري (ج.م) · جميع المبالغ محفوظة بالقروش
        </footer>
      </div>
    </div>
  );
}
