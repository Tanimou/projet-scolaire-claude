import { ArrowLeft } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { PortalShell } from '@/components/PortalShell';
import { api } from '@/lib/api-client';

import { InviteForm } from './InviteForm';

export const metadata: Metadata = { title: 'Inviter un utilisateur' };
export const dynamic = 'force-dynamic';

interface RoleListItem {
  id: string;
  slug: string;
  name: string;
  isSystem: boolean;
  portal: 'admin' | 'teacher' | 'parent' | null;
}

export default async function InviteUserPage() {
  const { data: roles } = await api<{ data: RoleListItem[] }>('/api/v1/roles', { cache: 'no-store' });
  const customRoles = roles.filter((r) => !r.isSystem);

  return (
    <PortalShell portal="admin">
      <Link
        href="/admin/users"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-900"
      >
        <ArrowLeft className="h-4 w-4" /> Retour aux utilisateurs
      </Link>
      <div className="mt-4">
        <div className="text-xs text-slate-500">Personnes · Onboarding</div>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">Inviter un utilisateur</h1>
        <p className="mt-1 text-sm text-slate-600">
          Un email sera envoyé à l&apos;utilisateur avec un lien sécurisé pour définir son mot de passe et — si admin
          ou prof — configurer son authentification à deux facteurs.
        </p>
      </div>
      <div className="mt-8">
        <InviteForm customRoles={customRoles} />
      </div>
    </PortalShell>
  );
}
