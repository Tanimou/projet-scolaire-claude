import { Plus, ShieldCheck, ShieldQuestion, Sparkles, Users } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { PortalShell } from '@/components/PortalShell';
import { api } from '@/lib/api-client';
import { KpiCard, PageHeader } from '@pilotage/ui';

import { DeleteRoleButton } from './DeleteRoleButton';

export const metadata: Metadata = { title: 'Rôles & permissions' };
export const dynamic = 'force-dynamic';

interface RoleListItem {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  portal: 'admin' | 'teacher' | 'parent' | null;
  isSystem: boolean;
  permissions: string[];
}

const PORTAL_BADGE: Record<string, { label: string; class: string }> = {
  admin: { label: 'Admin', class: 'bg-indigo-50 text-indigo-700' },
  teacher: { label: 'Professeur', class: 'bg-teal-50 text-teal-700' },
  parent: { label: 'Famille', class: 'bg-sky-50 text-sky-700' },
};

export default async function AdminRolesPage() {
  const { data: roles } = await api<{ data: RoleListItem[] }>('/api/v1/roles', { cache: 'no-store' });
  const system = roles.filter((r) => r.isSystem);
  const custom = roles.filter((r) => !r.isSystem);

  const totalPermissions = roles.reduce((s, r) => s + r.permissions.length, 0);
  const adminRoles = roles.filter((r) => r.portal === 'admin').length;

  return (
    <PortalShell portal="admin">
      <PageHeader
        breadcrumb={[
          { label: 'Tableau de bord', href: '/admin/dashboard' },
          { label: 'Rôles' },
        ]}
        title="Rôles & permissions"
        subtitle="Définissez qui peut faire quoi sur la plateforme"
        actions={
          <Link
            href="/admin/roles/new"
            className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700"
          >
            <Plus className="h-4 w-4" /> Créer un rôle
          </Link>
        }
      />

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard icon={ShieldCheck} tone="blue" label="RÔLES SYSTÈME" value={system.length}>
          Non modifiables
        </KpiCard>
        <KpiCard icon={Sparkles} tone="violet" label="RÔLES PERSONNALISÉS" value={custom.length}>
          Configurables
        </KpiCard>
        <KpiCard icon={Users} tone="green" label="RÔLES ADMIN" value={adminRoles}>
          Sur le portail Admin
        </KpiCard>
        <KpiCard icon={ShieldQuestion} tone="orange" label="PERMISSIONS TOTALES" value={totalPermissions}>
          Toutes catégories
        </KpiCard>
      </div>

      <section className="mt-6">
        <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">
          Rôles système (non-modifiables)
        </h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {system.map((r) => (
            <RoleCard key={r.id} role={r} />
          ))}
        </div>
      </section>

      <section className="mt-10">
        <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">
          Rôles personnalisés ({custom.length})
        </h2>
        {custom.length === 0 ? (
          <div className="mt-3 rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
            <ShieldCheck className="mx-auto h-10 w-10 text-slate-300" />
            <p className="mt-3 text-sm text-slate-600">
              Aucun rôle personnalisé. Créez-en un pour gouverner des accès au-delà des rôles système.
            </p>
            <Link
              href="/admin/roles/new"
              className="mt-4 inline-flex items-center gap-1.5 text-sm font-bold text-blue-700 hover:underline"
            >
              <Plus className="h-3.5 w-3.5" />
              Créer mon premier rôle
            </Link>
          </div>
        ) : (
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {custom.map((r) => (
              <RoleCard key={r.id} role={r} />
            ))}
          </div>
        )}
      </section>
    </PortalShell>
  );
}

function RoleCard({ role }: { role: RoleListItem }) {
  const portalBadge = role.portal ? PORTAL_BADGE[role.portal] : null;
  return (
    <div className="rounded-2xl bg-white p-5 ring-1 ring-slate-200">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold text-slate-900">{role.name}</h3>
            {role.isSystem && (
              <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-blue-700">
                Système
              </span>
            )}
          </div>
          <div className="mt-1 font-mono text-xs text-slate-500">{role.slug}</div>
        </div>
        {portalBadge && (
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${portalBadge.class}`}>
            {portalBadge.label}
          </span>
        )}
      </div>
      {role.description && (
        <p className="mt-3 text-xs leading-relaxed text-slate-600">{role.description}</p>
      )}
      <div className="mt-4 flex items-center justify-between text-xs">
        <span className="text-slate-500">
          {role.permissions.length} {role.permissions.length > 1 ? 'permissions' : 'permission'}
        </span>
        <div className="flex items-center gap-2">
          <Link
            href={role.isSystem ? `/admin/roles/${role.id}` : `/admin/roles/${role.id}/edit`}
            className="font-semibold text-blue-700 hover:underline"
          >
            {role.isSystem ? 'Voir' : 'Éditer'}
          </Link>
          {!role.isSystem && <DeleteRoleButton roleId={role.id} roleName={role.name} />}
        </div>
      </div>
    </div>
  );
}
