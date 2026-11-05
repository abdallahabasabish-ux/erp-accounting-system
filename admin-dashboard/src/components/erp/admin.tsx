'use client';

/**
 * الإدارة — المستخدمون (إضافة/تعديل/صلاحيات/تعطيل بسبب) + سجل التدقيق الكامل.
 * يظهر حسب صلاحيات users:manage و audit:view.
 */
import * as React from 'react';
import { Ban, Pencil, Plus, RotateCcw, ScrollText, Users } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  EmptyState, LoadError, LoadingTable, Ltr, ScrollTable, SectionCard, ToneBadge, useAsyncData,
} from '@/components/erp/shared';
import { useToast } from '@/hooks/use-toast';
import {
  ALL_PERMISSIONS, ROLE_LABELS, api, ErpError, formatDateTime, type AuditLog, type ErpRole, type ErpUserRow,
} from '@/lib/erp';
import { cn } from '@/lib/utils';

const ROLES: ErpRole[] = ['admin', 'manager', 'accountant', 'employee', 'client'];

export function AdminSection({ canUsers, canAudit }: { canUsers: boolean; canAudit: boolean }) {
  const defaultTab = canUsers ? 'users' : 'audit';
  return (
    <Tabs defaultValue={defaultTab} className="space-y-4">
      <SectionCard
        title="المستخدمون والتدقيق"
        description="إدارة حسابات الفريق وصلاحياتهم + سجل تدقيق كامل لكل ما جرى في النظام"
        className="border-0 shadow-none bg-transparent"
        contentClassName="p-0"
      >
        <TabsList className="grid w-full max-w-md grid-cols-2">
          {canUsers ? (
            <TabsTrigger value="users" className="min-h-11 gap-1.5"><Users className="size-4" aria-hidden /> المستخدمون</TabsTrigger>
          ) : null}
          {canAudit ? (
            <TabsTrigger value="audit" className="min-h-11 gap-1.5"><ScrollText className="size-4" aria-hidden /> سجل التدقيق</TabsTrigger>
          ) : null}
        </TabsList>

        {canUsers ? <TabsContent value="users" className="mt-4"><UsersTab /></TabsContent> : null}
        {canAudit ? <TabsContent value="audit" className="mt-4"><AuditTab /></TabsContent> : null}
      </SectionCard>
    </Tabs>
  );
}

/* -------------------------------- المستخدمون -------------------------------- */

function UsersTab() {
  const { toast } = useToast();
  const { data, loading, error, reload } = useAsyncData<{ users: ErpUserRow[] }>(() => api.get('users'), []);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [editOf, setEditOf] = React.useState<ErpUserRow | null>(null);
  const [disableOf, setDisableOf] = React.useState<ErpUserRow | null>(null);
  const users = data?.users ?? [];

  return (
    <SectionCard
      title="حسابات المستخدمين"
      description="الأدوار تحدد الصلاحيات الافتراضية، ويمكن تخصيص صلاحيات دقيقة لكل مستخدم"
      actions={
        <Button size="sm" className="min-h-11 gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700" onClick={() => setCreateOpen(true)}>
          <Plus className="size-4" aria-hidden /> مستخدم جديد
        </Button>
      }
    >
      {loading ? <LoadingTable cols={5} />
        : error ? <LoadError error={error} onRetry={reload} />
        : users.length === 0 ? <EmptyState title="لا مستخدمين" />
        : (
          <ScrollTable maxHeight="max-h-[460px]">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-background shadow-[0_1px_0_0_var(--border)]">
                <tr className="text-right text-xs text-muted-foreground">
                  <th className="px-2 py-2.5 font-medium">المستخدم</th>
                  <th className="px-2 py-2.5 font-medium">البريد</th>
                  <th className="px-2 py-2.5 font-medium">الدور</th>
                  <th className="px-2 py-2.5 font-medium">الصلاحيات</th>
                  <th className="px-2 py-2.5 font-medium">الحالة</th>
                  <th className="px-2 py-2.5 font-medium text-center">إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.uid} className={cn('border-t transition-colors hover:bg-muted/40', u.disabled && 'opacity-60')}>
                    <td className="px-2 py-2.5 font-medium">{u.displayName}</td>
                    <td className="px-2 py-2.5"><Ltr className="text-xs text-muted-foreground">{u.email}</Ltr></td>
                    <td className="px-2 py-2.5"><ToneBadge tone="info">{ROLE_LABELS[u.role] ?? u.role}</ToneBadge></td>
                    <td className="px-2 py-2.5 text-xs text-muted-foreground">
                      {u.permissions.includes('*') ? 'كل الصلاحيات' : <Ltr>{u.permissions.length}</Ltr>}
                    </td>
                    <td className="px-2 py-2.5">
                      {u.disabled ? <ToneBadge tone="danger">معطّل</ToneBadge> : <ToneBadge tone="success">نشط</ToneBadge>}
                    </td>
                    <td className="px-2 py-2.5">
                      <div className="flex items-center justify-center gap-1">
                        <Button variant="ghost" size="icon" className="size-9" aria-label={`تعديل ${u.displayName}`} onClick={() => setEditOf(u)}>
                          <Pencil className="size-4" aria-hidden />
                        </Button>
                        <Button
                          variant="ghost" size="icon"
                          className={cn('size-9', u.disabled ? 'text-emerald-600' : 'text-muted-foreground hover:text-destructive')}
                          aria-label={u.disabled ? `تفعيل ${u.displayName}` : `تعطيل ${u.displayName}`}
                          onClick={() => setDisableOf(u)}
                        >
                          {u.disabled ? <RotateCcw className="size-4" aria-hidden /> : <Ban className="size-4" aria-hidden />}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollTable>
        )}

      <UserFormDialog open={createOpen} onOpenChange={setCreateOpen} onSaved={() => { setCreateOpen(false); reload(); }} />
      <UserEditDialog user={editOf} onClose={() => setEditOf(null)} onSaved={() => { setEditOf(null); reload(); }} />
      <UserDisableDialog user={disableOf} onClose={() => setDisableOf(null)} onDone={() => { setDisableOf(null); reload(); }} />
    </SectionCard>
  );
}

function UserFormDialog({ open, onOpenChange, onSaved }: { open: boolean; onOpenChange: (v: boolean) => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [email, setEmail] = React.useState('');
  const [displayName, setDisplayName] = React.useState('');
  const [role, setRole] = React.useState<ErpRole>('accountant');
  const [password, setPassword] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (open) { setEmail(''); setDisplayName(''); setRole('accountant'); setPassword(''); }
  }, [open]);

  const canSubmit = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) && displayName.trim().length >= 2 && password.length >= 8 && !saving;

  const submit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    try {
      await api.post('users', { email: email.trim(), displayName: displayName.trim(), role, password });
      toast({ title: 'تم إنشاء المستخدم', description: displayName.trim(), variant: 'success' });
      onSaved();
    } catch (e) {
      toast({ title: 'تعذر الإنشاء', description: e instanceof ErpError ? e.message : 'خطأ غير متوقع', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>مستخدم جديد</DialogTitle>
          <DialogDescription>الدور يمنح الصلاحيات الافتراضية — ويمكن تخصيصها لاحقاً من التعديل.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="space-y-2">
            <Label htmlFor="us-email">البريد الإلكتروني</Label>
            <Input id="us-email" type="email" dir="ltr" className="h-11 text-left" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="user@company.eg" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="us-name">الاسم المعروض</Label>
            <Input id="us-name" className="h-11" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>الدور</Label>
              <Select value={role} onValueChange={(v) => setRole(v as ErpRole)}>
                <SelectTrigger className="h-11 w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="us-pass">كلمة المرور</Label>
              <Input id="us-pass" type="password" dir="ltr" className="h-11 text-left" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="8 أحرف على الأقل" />
            </div>
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" className="min-h-11" onClick={() => onOpenChange(false)}>إلغاء</Button>
          <Button className="min-h-11 bg-emerald-600 text-white hover:bg-emerald-700" disabled={!canSubmit} onClick={() => void submit()}>
            {saving ? 'جارٍ الإنشاء…' : 'إنشاء المستخدم'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function UserEditDialog({ user, onClose, onSaved }: { user: ErpUserRow | null; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [displayName, setDisplayName] = React.useState('');
  const [role, setRole] = React.useState<ErpRole>('accountant');
  const [permissions, setPermissions] = React.useState<string[]>([]);
  const [useRoleDefaults, setUseRoleDefaults] = React.useState(true);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (user) {
      setDisplayName(user.displayName);
      setRole(user.role);
      if (user.permissions.includes('*')) { setUseRoleDefaults(true); setPermissions([]); }
      else { setUseRoleDefaults(false); setPermissions(user.permissions); }
    }
  }, [user]);

  const togglePerm = (p: string) =>
    setPermissions((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));

  const submit = async () => {
    if (!user) return;
    setSaving(true);
    try {
      const patch: Record<string, unknown> = { displayName: displayName.trim(), role };
      if (!useRoleDefaults) patch.permissions = permissions;
      await api.patch(`users/${encodeURIComponent(user.uid)}`, patch);
      toast({ title: 'تم حفظ التعديلات', description: user.displayName, variant: 'success' });
      onSaved();
    } catch (e) {
      toast({ title: 'تعذر الحفظ', description: e instanceof ErpError ? e.message : 'خطأ غير متوقع', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={user !== null} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto scrollbar-erp sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>تعديل مستخدم</DialogTitle>
          <DialogDescription><Ltr>{user?.email ?? ''}</Ltr></DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="ue-name">الاسم المعروض</Label>
              <Input id="ue-name" className="h-11" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>الدور</Label>
              <Select value={role} onValueChange={(v) => setRole(v as ErpRole)}>
                <SelectTrigger className="h-11 w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex items-center justify-between rounded-lg border bg-muted/30 px-3 py-2.5">
            <span className="text-xs">استخدام صلاحيات الدور الافتراضية</span>
            <Switch checked={useRoleDefaults} onCheckedChange={setUseRoleDefaults} aria-label="صلاحيات الدور الافتراضية" />
          </div>
          {!useRoleDefaults ? (
            <div className="space-y-2">
              <Label>صلاحيات مخصصة</Label>
              <div className="grid max-h-64 grid-cols-1 gap-1.5 overflow-y-auto rounded-lg border p-3 scrollbar-erp sm:grid-cols-2">
                {ALL_PERMISSIONS.map((p) => (
                  <label key={p} className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-xs hover:bg-muted/50">
                    <Checkbox checked={permissions.includes(p)} onCheckedChange={() => togglePerm(p)} aria-label={p} />
                    <Ltr className="text-[11px]">{p}</Ltr>
                  </label>
                ))}
              </div>
            </div>
          ) : null}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" className="min-h-11" onClick={onClose}>إلغاء</Button>
          <Button className="min-h-11 bg-emerald-600 text-white hover:bg-emerald-700" disabled={saving || !displayName.trim()} onClick={() => void submit()}>
            {saving ? 'جارٍ الحفظ…' : 'حفظ'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function UserDisableDialog({ user, onClose, onDone }: { user: ErpUserRow | null; onClose: () => void; onDone: () => void }) {
  const { toast } = useToast();
  const [reason, setReason] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const disabling = user ? !user.disabled : false;

  React.useEffect(() => {
    if (user) setReason('');
  }, [user]);

  const ok = !disabling || reason.trim().length >= 5;

  const submit = async () => {
    if (!user || !ok) return;
    setSaving(true);
    try {
      await api.post(`users/${encodeURIComponent(user.uid)}/disabled`, { disabled: disabling, reason: reason.trim() || undefined });
      toast({
        title: disabling ? 'تم تعطيل المستخدم' : 'تم تفعيل المستخدم',
        description: `${user.displayName} — يسري فوراً على جلساته`,
        variant: 'success',
      });
      onDone();
    } catch (e) {
      toast({ title: 'تعذر التنفيذ', description: e instanceof ErpError ? e.message : 'خطأ غير متوقع', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={user !== null} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{disabling ? `تعطيل: ${user?.displayName}` : `تفعيل: ${user?.displayName}`}</DialogTitle>
          <DialogDescription>
            {disabling
              ? 'سيُمنع المستخدم من كل الطلبات فوراً — حتى الجلسات النشطة.'
              : 'سيستعيد المستخدم وصوله بحصته من الصلاحيات.'}
          </DialogDescription>
        </DialogHeader>
        {disabling ? (
          <div className="space-y-2">
            <Label htmlFor="ud-reason">سبب التعطيل</Label>
            <Input id="ud-reason" className="h-11" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="مثال: انتهاء العقد" />
            {reason && reason.trim().length < 5 ? <p className="text-xs text-destructive">5 أحرف على الأقل</p> : null}
          </div>
        ) : null}
        <DialogFooter className="gap-2">
          <Button variant="outline" className="min-h-11" onClick={onClose}>إلغاء</Button>
          <Button variant={disabling ? 'destructive' : 'default'} className="min-h-11" disabled={!ok || saving} onClick={() => void submit()}>
            {saving ? 'جارٍ التنفيذ…' : disabling ? 'تعطيل' : 'تفعيل'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------- سجل التدقيق -------------------------------- */

function AuditTab() {
  const { data, loading, error, reload } = useAsyncData<{ logs: AuditLog[] }>(() => api.get('audit?limit=100'), []);
  const logs = data?.logs ?? [];

  return (
    <SectionCard title="سجل التدقيق" description="كل عملية حساسة موثقة بالممثل والزمن والملخص">
      {loading ? <LoadingTable cols={5} />
        : error ? <LoadError error={error} onRetry={reload} />
        : logs.length === 0 ? <EmptyState title="السجل فارغ" />
        : (
          <ScrollTable maxHeight="max-h-[520px]">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-background shadow-[0_1px_0_0_var(--border)]">
                <tr className="text-right text-xs text-muted-foreground">
                  <th className="px-2 py-2.5 font-medium">الزمن</th>
                  <th className="px-2 py-2.5 font-medium">الممثل</th>
                  <th className="px-2 py-2.5 font-medium">الإجراء</th>
                  <th className="px-2 py-2.5 font-medium">الكيان</th>
                  <th className="px-2 py-2.5 font-medium">الملخص</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id} className="border-t transition-colors hover:bg-muted/40">
                    <td className="whitespace-nowrap px-2 py-2.5 text-xs text-muted-foreground"><Ltr>{formatDateTime(l.at)}</Ltr></td>
                    <td className="max-w-36 px-2 py-2.5">
                      <p className="truncate text-xs font-medium">{l.actor?.name || l.actor?.email}</p>
                      {l.actor?.email ? <p className="truncate text-[10px] text-muted-foreground"><Ltr>{l.actor.email}</Ltr></p> : null}
                    </td>
                    <td className="px-2 py-2.5"><Ltr className="text-[11px] font-semibold text-teal-700 dark:text-teal-400">{l.action}</Ltr></td>
                    <td className="px-2 py-2.5 text-xs text-muted-foreground"><Ltr>{l.entity}</Ltr></td>
                    <td className="max-w-72 px-2 py-2.5"><span className="line-clamp-2 text-xs leading-relaxed">{l.summary}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollTable>
        )}
    </SectionCard>
  );
}
