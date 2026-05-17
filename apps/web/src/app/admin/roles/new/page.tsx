import { ArrowLeft } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { PortalShell } from '@/components/PortalShell';
import { api } from '@/lib/api-client';

import { RoleBuilderForm } from '../RoleBuilderForm';

export const metadata: Metadata = { title: 'Créer un rôle' };
export const dynamic = 'force-dynamic';

interface PermGroup {
  groups: Record<string, { code: string; label: string; action: string }[]>;
}

export default async function NewRolePage() {
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
        <div className="text-xs text-slate-500">Personnalisation · Nouveau rôle</div>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">Créer un rôle personnalisé</h1>
        <p className="mt-1 text-sm text-slate-600">
          Définissez un rôle métier (ex. « comptable », « surveillant », « infirmier ») et cochez les permissions à
          accorder.
        </p>
      </div>

      <div className="mt-8">
        <RoleBuilderForm mode="create" permissionGroups={groups} />
      </div>
    </PortalShell>
  );
}
