import { Mail, ShieldCheck, UserCog, UserX } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { PortalShell } from '@/components/PortalShell';
import { api } from '@/lib/api-client';
import { KpiCard, PageHeader } from '@pilotage/ui';

import { UsersTable } from './UsersTable';

export const metadata: Metadata = { title: 'Utilisateurs' };
export const dynamic = 'force-dynamic';

interface UserListItem {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  status: string;
  authLinked: boolean;
  roles: { slug: string; name: string }[];
  createdAt: string;
}

interface RoleListItem {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  portal: string | null;
  isSystem: boolean;
  permissions: string[];
}

export default async function AdminUsersPage() {
  const [usersRes, rolesRes] = await Promise.all([
    api<{ data: UserListItem[]; total: number }>('/api/v1/users', { cache: 'no-store' }),
    api<{ data: RoleListItem[] }>('/api/v1/roles', { cache: 'no-store' }),
  ]);

  const activeUsers = usersRes.data.filter((u) => u.status === 'active').length;
  const inactiveUsers = usersRes.data.filter((u) => u.status !== 'active').length;
  const invitedUsers = usersRes.data.filter((u) => !u.authLinked).length;

  return (
    <PortalShell portal="admin">
      <PageHeader
        breadcrumb={[
          { label: 'Tableau de bord', href: '/admin/dashboard' },
          { label: 'Utilisateurs' },
        ]}
        title="Utilisateurs"
        subtitle="Gérez les comptes plateforme et leurs rôles"
        actions={
          <Link
            href="/admin/users/invite"
            className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700"
          >
            <Mail className="h-4 w-4" /> Inviter un utilisateur
          </Link>
        }
      />

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard icon={UserCog} tone="blue" label="UTILISATEURS ACTIFS" value={activeUsers}>
          {usersRes.total} utilisateurs au total
        </KpiCard>
        <KpiCard icon={Mail} tone="orange" label="INVITATIONS ENVOYÉES" value={invitedUsers}>
          En attente de première connexion
        </KpiCard>
        <KpiCard icon={UserX} tone="rose" label="COMPTES DÉSACTIVÉS" value={inactiveUsers}>
          Suspendus ou archivés
        </KpiCard>
        <KpiCard icon={ShieldCheck} tone="green" label="RÔLES CONFIGURÉS" value={rolesRes.data.length}>
          Système + custom
        </KpiCard>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <section className="lg:col-span-2">
          <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/60">
            <div className="border-b border-slate-100 px-6 py-4">
              <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500">
                Utilisateurs ({usersRes.total})
              </h3>
            </div>
            <UsersTable users={usersRes.data} roles={rolesRes.data} />
          </div>
        </section>

        <aside className="space-y-4">
          <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200/60">
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500">Rôles système</h3>
            <ul className="mt-4 space-y-3">
              {rolesRes.data.map((r) => (
                <li key={r.id} className="border-b border-slate-100 pb-3 last:border-0 last:pb-0">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-semibold text-slate-900">{r.name}</div>
                      <div className="text-xs text-slate-500">
                        <code className="font-mono">{r.slug}</code> · {r.permissions.length}{' '}
                        permissions
                      </div>
                    </div>
                    {r.isSystem && (
                      <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-blue-700">
                        Système
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <Link
            href="/admin/roles"
            className="block rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-700 shadow-sm transition hover:border-blue-300 hover:bg-blue-50"
          >
            <div className="font-bold text-slate-900">Gérer les rôles & permissions</div>
            <p className="mt-1.5 text-xs">
              Créez des rôles métier custom (ex. « comptable », « surveillant », « infirmier ») et
              choisissez les permissions à accorder.
            </p>
            <span className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-blue-700">
              Ouvrir l&apos;éditeur →
            </span>
          </Link>
        </aside>
      </div>
    </PortalShell>
  );
}
