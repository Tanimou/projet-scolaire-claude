import { ArrowLeft } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { PortalShell } from '@/components/PortalShell';
import { api, ApiError } from '@/lib/api-client';

import { RoleBuilderForm } from '../../RoleBuilderForm';

export const metadata: Metadata = { title: 'Éditer un rôle' };
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

interface PermGroup {
  groups: Record<string, { code: string; label: string; action: string }[]>;
}

export default async function EditRolePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let role: RoleListItem | undefined;
  try {
    const all = await api<{ data: RoleListItem[] }>('/api/v1/roles', { cache: 'no-store' });
    role = all.data.find((r) => r.id === id);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }
  if (!role) notFound();

  const { groups } = await api<PermGroup>('/api/v1/roles/permissions/catalog', { cache: 'no-store' });

  return (
    <PortalShell portal="admin">
      <Link
        href="/admin/roles"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-900"
      >
        <ArrowLeft className="h-4 w-4" /> Retour aux rôles
      </Link>
      <div className="mt-4">
        <div className="text-xs text-slate-500">Personnalisation · Éditer un rôle</div>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">{role.name}</h1>
        <p className="mt-1 font-mono text-xs text-slate-500">{role.slug}</p>
      </div>

      {role.isSystem ? (
        <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Ce rôle est un rôle système — sa configuration est gérée par la plateforme et n&apos;est pas modifiable depuis
          l&apos;interface admin. Vous pouvez créer un rôle personnalisé inspiré de celui-ci si besoin.
        </div>
      ) : (
        <div className="mt-8">
          <RoleBuilderForm
            mode="edit"
            roleId={role.id}
            initial={{
              name: role.name,
              slug: role.slug,
              description: role.description ?? '',
              portal: role.portal ?? 'admin',
              permissions: role.permissions,
            }}
            permissionGroups={groups}
          />
        </div>
      )}
    </PortalShell>
  );
}
