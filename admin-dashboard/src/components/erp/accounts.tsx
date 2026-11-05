'use client';

/**
 * شجرة الحسابات — عرض هرمي قابل للطي مع أرصدة وشارات أنواع + جدول مسطح مع بحث،
 * وإضافة حساب جديد (اقتراح رمز تلقائي كابن للحساب المحدد) وتفعيل/تعطيل.
 */
import * as React from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, FolderTree, Plus, Power, Search, Sprout } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import {
  EmptyState, LoadError, Ltr, LoadingBlock, Money, ScrollTable, SectionCard, ToneBadge, useAsyncData,
} from '@/components/erp/shared';
import { useToast } from '@/hooks/use-toast';
import {
  ACCOUNT_TYPE_LABELS, api, can, ErpError, formatEGP, type Account, type AccountNode, type AccountType, type ErpUser,
} from '@/lib/erp';
import { cn } from '@/lib/utils';

const TYPE_BADGE_TONE: Record<AccountType, 'info' | 'warning' | 'success' | 'accent' | 'danger'> = {
  asset: 'info',
  liability: 'warning',
  equity: 'accent',
  revenue: 'success',
  expense: 'danger',
};

function TypeBadge({ type }: { type: AccountType }) {
  return <ToneBadge tone={TYPE_BADGE_TONE[type]}>{ACCOUNT_TYPE_LABELS[type] ?? type}</ToneBadge>;
}

/* ---------------------------------- الشجرة ---------------------------------- */

function TreeNodeRow({
  node, depth, expanded, onToggle, selectedCode, onSelect,
}: {
  node: AccountNode;
  depth: number;
  expanded: Set<string>;
  onToggle: (code: string) => void;
  selectedCode: string | null;
  onSelect: (acc: Account) => void;
}) {
  const isOpen = expanded.has(node.code);
  const hasChildren = (node.children?.length ?? 0) > 0;
  const selected = selectedCode === node.code;
  return (
    <div>
      <div
        className={cn(
          'group flex min-h-11 items-center gap-2 rounded-lg px-2 py-1.5 transition-colors',
          selected ? 'bg-emerald-50 dark:bg-emerald-950/40' : 'hover:bg-muted/60',
        )}
        style={{ paddingInlineStart: `${depth * 18 + 8}px` }}
      >
        <button
          type="button"
          aria-label={isOpen ? 'طي' : 'توسيع'}
          aria-expanded={isOpen}
          onClick={() => hasChildren && onToggle(node.code)}
          className={cn('flex size-7 items-center justify-center rounded-md', !hasChildren && 'invisible')}
        >
          {isOpen
            ? <ChevronDown className="size-4 text-muted-foreground" aria-hidden />
            : <ChevronLeft className="size-4 text-muted-foreground rtl:rotate-180" aria-hidden />}
        </button>
        <button
          type="button"
          onClick={() => onSelect(node)}
          className="flex min-w-0 flex-1 items-center gap-2 text-right"
        >
          {hasChildren
            ? <FolderTree className="size-4 shrink-0 text-amber-500" aria-hidden />
            : <Sprout className="size-4 shrink-0 text-emerald-500" aria-hidden />}
          <Ltr className="shrink-0 text-xs font-semibold text-muted-foreground">{node.code}</Ltr>
          <span className="truncate text-sm font-medium">{node.name}</span>
          {!node.active ? <ToneBadge tone="neutral">معطّل</ToneBadge> : null}
        </button>
        <div className="hidden shrink-0 items-center gap-2 sm:flex">
          <TypeBadge type={node.type} />
          <span className="min-w-24 text-left text-xs tabular-nums text-muted-foreground">
            <Money p={node.balancePiasters} withSymbol={false} />
          </span>
        </div>
      </div>
      {isOpen && hasChildren
        ? node.children!.map((child) => (
            <TreeNodeRow
              key={child.code}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              onToggle={onToggle}
              selectedCode={selectedCode}
              onSelect={onSelect}
            />
          ))
        : null}
    </div>
  );
}

/* ------------------------------ اقتراح رمز الابن ----------------------------- */

function suggestChildCode(parent: AccountNode | null, all: Account[]): string {
  if (!parent) return '';
  const children = all.filter((a) => a.parent === parent.code && /^\d+$/.test(a.code));
  if (children.length === 0) return `${parent.code}1`;
  const maxChild = children.map((c) => Number(c.code)).reduce((m, n) => Math.max(m, n), 0);
  const next = String(maxChild + 1);
  return next.length === 4 ? next : `${parent.code}${next.slice(parent.code.length).padStart(1, '0')}`.slice(0, 4);
}

/* --------------------------------- القسم ---------------------------------- */

export function AccountsSection({ user }: { user: ErpUser }) {
  const { toast } = useToast();
  const { data, loading, error, reload } = useAsyncData<{ accounts: Account[]; tree: AccountNode[] }>(
    () => api.get('accounts'),
    [],
  );
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());
  const [selected, setSelected] = React.useState<Account | null>(null);
  const [query, setQuery] = React.useState('');
  const [addOpen, setAddOpen] = React.useState(false);
  const [busyToggle, setBusyToggle] = React.useState<string | null>(null);

  const manage = can(user, 'accounts:manage') && (user.role === 'admin' || user.role === 'manager');

  React.useEffect(() => {
    if (!data) return;
    // فتح أول مستويات افتراضياً
    setExpanded((prev) => {
      if (prev.size > 0) return prev;
      const s = new Set<string>();
      const walk = (nodes: AccountNode[], depth: number) => {
        for (const n of nodes) {
          if (depth < 2) s.add(n.code);
          if (n.children) walk(n.children, depth + 1);
        }
      };
      walk(data.tree, 0);
      return s;
    });
  }, [data]);

  const toggle = (code: string) =>
    setExpanded((prev) => {
      const s = new Set(prev);
      if (s.has(code)) s.delete(code);
      else s.add(code);
      return s;
    });

  const filtered = React.useMemo(() => {
    const accounts = data?.accounts ?? [];
    if (!query.trim()) return accounts;
    const q = query.trim();
    return accounts.filter((a) => a.code.includes(q) || a.name.includes(q));
  }, [data, query]);

  const setAccountActive = async (acc: Account, active: boolean) => {
    setBusyToggle(acc.code);
    try {
      await api.patch(`accounts/${encodeURIComponent(acc.code)}/status`, { active });
      toast({
        title: active ? 'تم التفعيل' : 'تم التعطيل',
        description: `الحساب ${acc.name} (${acc.code}) الآن ${active ? 'نشط' : 'معطّل'}`,
        variant: 'success',
      });
      reload();
    } catch (e) {
      toast({ title: 'تعذر التحديث', description: e instanceof ErpError ? e.message : 'خطأ غير متوقع', variant: 'destructive' });
    } finally {
      setBusyToggle(null);
    }
  };

  if (loading) return <SectionCard title="شجرة الحسابات"><LoadingBlock rows={6} /></SectionCard>;
  if (error || !data) return <LoadError error={error} onRetry={reload} />;

  return (
    <div className="space-y-4">
      <SectionCard
        title="الشجرة الهرمية للحسابات"
        description="اضغط على السهم للتوسيع/الطي — واضغط على الحساب لتحديده كأب عند الإضافة"
        actions={manage ? (
          <Button size="sm" className="min-h-11 gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700" onClick={() => setAddOpen(true)}>
            <Plus className="size-4" aria-hidden /> حساب جديد
          </Button>
        ) : undefined}
      >
        {data.tree.length === 0 ? (
          <EmptyState title="لا توجد حسابات" />
        ) : (
          <div className="max-h-[480px] overflow-y-auto rounded-lg border scrollbar-erp" dir="rtl">
            {data.tree.map((node) => (
              <TreeNodeRow
                key={node.code}
                node={node}
                depth={0}
                expanded={expanded}
                onToggle={toggle}
                selectedCode={selected?.code ?? null}
                onSelect={setSelected}
              />
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="كل الحسابات"
        description={selected ? <>المحدد كأب للإضافة: <b>{selected.name}</b> (<Ltr>{selected.code}</Ltr>)</> : 'ابحث بالرمز أو الاسم'}
        actions={
          <div className="relative">
            <Search className="absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="بحث…"
              className="h-10 w-44 pr-9 sm:w-56"
              aria-label="بحث في الحسابات"
            />
          </div>
        }
      >
        {filtered.length === 0 ? (
          <EmptyState title="لا نتائج مطابقة" hint="جرّب رمزاً أو اسماً آخر" />
        ) : (
          <ScrollTable maxHeight="max-h-[420px]">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-background shadow-[0_1px_0_0_var(--border)]">
                <tr className="text-right text-xs text-muted-foreground">
                  <th className="px-2 py-2.5 font-medium">الرمز</th>
                  <th className="px-2 py-2.5 font-medium">الاسم</th>
                  <th className="px-2 py-2.5 font-medium">النوع</th>
                  <th className="px-2 py-2.5 font-medium">التصنيف</th>
                  <th className="px-2 py-2.5 font-medium">الرصيد</th>
                  <th className="px-2 py-2.5 font-medium">الحالة</th>
                  {manage ? <th className="px-2 py-2.5 font-medium text-center">تفعيل</th> : null}
                </tr>
              </thead>
              <tbody>
                {filtered.map((a) => (
                  <tr key={a.code} className="border-t transition-colors hover:bg-muted/40">
                    <td className="px-2 py-2.5"><Ltr className="text-xs font-semibold">{a.code}</Ltr></td>
                    <td className="max-w-48 truncate px-2 py-2.5">{a.name}</td>
                    <td className="px-2 py-2.5"><TypeBadge type={a.type} /></td>
                    <td className="px-2 py-2.5 text-xs text-muted-foreground">{a.kind === 'group' ? 'رئيسي (تجميعي)' : 'ترحيلي'}</td>
                    <td className="px-2 py-2.5"><Money p={a.balancePiasters} /></td>
                    <td className="px-2 py-2.5">
                      {a.active ? <ToneBadge tone="success">نشط</ToneBadge> : <ToneBadge tone="neutral">معطّل</ToneBadge>}
                    </td>
                    {manage ? (
                      <td className="px-2 py-2.5 text-center">
                        <Switch
                          checked={a.active}
                          disabled={busyToggle === a.code}
                          aria-label={`تفعيل حساب ${a.name}`}
                          onCheckedChange={(v) => void setAccountActive(a, v)}
                          className="mx-auto"
                        />
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollTable>
        )}
      </SectionCard>

      <AddAccountDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        accounts={data.accounts}
        tree={data.tree}
        presetParent={selected}
        onCreated={() => {
          setAddOpen(false);
          reload();
        }}
      />
    </div>
  );
}

/* ------------------------------ حوار إضافة حساب ----------------------------- */

function AddAccountDialog({
  open, onOpenChange, accounts, tree, presetParent, onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  accounts: Account[];
  tree: AccountNode[];
  presetParent: Account | null;
  onCreated: () => void;
}) {
  const { toast } = useToast();
  const [parentCode, setParentCode] = React.useState<string>(presetParent?.code ?? '');
  const [code, setCode] = React.useState('');
  const [name, setName] = React.useState('');
  const [type, setType] = React.useState<AccountType>('expense');
  const [kind, setKind] = React.useState<'group' | 'posting'>('posting');
  const [saving, setSaving] = React.useState(false);

  const parent = React.useMemo(() => accounts.find((a) => a.code === parentCode) ?? null, [accounts, parentCode]);

  React.useEffect(() => {
    if (!open) return;
    const p = presetParent ?? tree[0] ?? null;
    setParentCode(p?.code ?? '');
    setCode(p ? suggestChildCode(p as AccountNode, accounts) : '');
    setName('');
    setType((p?.type as AccountType) ?? 'expense');
    setKind('posting');
  }, [open, presetParent, tree, accounts]);

  React.useEffect(() => {
    if (parent) {
      setCode(suggestChildCode(parent as AccountNode, accounts));
      if (parent.type) setType(parent.type as AccountType);
    }
  }, [parentCode]);

  const codeValid = /^\d{4}$/.test(code);
  const codeTaken = accounts.some((a) => a.code === code);

  const submit = async () => {
    if (!codeValid || !name.trim() || !parent) return;
    setSaving(true);
    try {
      await api.post('accounts', { code, name: name.trim(), type, kind, parent: parent.code });
      toast({ title: 'تم إنشاء الحساب', description: `${name.trim()} — ${code}`, variant: 'success' });
      onCreated();
    } catch (e) {
      toast({ title: 'تعذر إنشاء الحساب', description: e instanceof ErpError ? e.message : 'خطأ غير متوقع', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const groupNodes = React.useMemo(() => {
    const out: { code: string; name: string; path: string }[] = [];
    const walk = (nodes: AccountNode[], path: string) => {
      for (const n of nodes) {
        const p = path ? `${path} ← ${n.name}` : n.name;
        if (n.kind === 'group') out.push({ code: n.code, name: n.name, path: p });
        if (n.children) walk(n.children, p);
      }
    };
    walk(tree, '');
    return out;
  }, [tree]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>إضافة حساب جديد</DialogTitle>
          <DialogDescription>الرمز 4 خانات رقمية — يُقترح تلقائياً كابن مباشر للحساب الأب المحدد.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="space-y-2">
            <Label>الحساب الأب</Label>
            <Select value={parentCode} onValueChange={setParentCode}>
              <SelectTrigger className="h-11 w-full"><SelectValue placeholder="اختر الأب" /></SelectTrigger>
              <SelectContent className="max-h-64">
                {groupNodes.map((g) => (
                  <SelectItem key={g.code} value={g.code}>
                    <span className="flex items-center gap-2">
                      <Ltr className="text-xs text-muted-foreground">{g.code}</Ltr> {g.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="acc-code">رمز الحساب</Label>
              <Input
                id="acc-code"
                dir="ltr"
                className="h-11 text-left tabular-nums"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
                placeholder="0000"
              />
              {code && !codeValid ? <p className="text-xs text-destructive">يجب أن يكون 4 خانات رقمية</p> : null}
              {codeValid && codeTaken ? <p className="text-xs text-destructive">الرمز مستخدم بالفعل</p> : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="acc-name">اسم الحساب</Label>
              <Input id="acc-name" className="h-11" value={name} onChange={(e) => setName(e.target.value)} placeholder="مثال: مصروف صيانة" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>نوع الحساب</Label>
              <Select value={type} onValueChange={(v) => setType(v as AccountType)}>
                <SelectTrigger className="h-11 w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(ACCOUNT_TYPE_LABELS) as AccountType[]).map((t) => (
                    <SelectItem key={t} value={t}>{ACCOUNT_TYPE_LABELS[t]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>التصنيف</Label>
              <Select value={kind} onValueChange={(v) => setKind(v as 'group' | 'posting')}>
                <SelectTrigger className="h-11 w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="posting">ترحيلي (يُقيَّد عليه)</SelectItem>
                  <SelectItem value="group">رئيسي (تجميعي)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <p className="flex items-center gap-1.5 rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
            <Power className="size-3.5" aria-hidden />
            الحساب يُنشأ نشطاً — ويمكن تعطيله لاحقاً من الجدول.
          </p>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" className="min-h-11" onClick={() => onOpenChange(false)}>إلغاء</Button>
          <Button
            className="min-h-11 bg-emerald-600 text-white hover:bg-emerald-700"
            disabled={!codeValid || codeTaken || !name.trim() || saving}
            onClick={() => void submit()}
          >
            إنشاء الحساب
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
