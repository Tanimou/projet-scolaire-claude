import { Check, Clock, HeartHandshake, Mail, ShieldQuestion, Users, X } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { PortalShell } from '@/components/PortalShell';
import { api, ApiError } from '@/lib/api-client';
import {
  AvatarNameCell,
  EmptyState,
  KpiCard,
  PageHeader,
  Pagination,
  RowActions,
  StatusBadge,
} from '@pilotage/ui';

import { GuardiansExportButton } from './GuardiansExportButton';
import { GuardiansPageFilters } from './GuardiansPageFilters';

export const metadata: Metadata = { title: 'Parents / Tuteurs' };
export const dynamic = 'force-dynamic';

interface GuardianItem {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  profession: string | null;
  _count: { guardianships: number };
  guardianships: Array<{
    id: string;
    relationship: string;
    isPrimaryContact: boolean;
    status: 'pending' | 'active' | 'revoked';
    student: { id: string; firstName: string; lastName: string };
  }>;
}

async function safe<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (err) {
    if (err instanceof ApiError) return null;
    throw err;
  }
}

const RELATIONSHIP_LABEL: Record<string, string> = {
  mother: 'Mère',
  father: 'Père',
  legal_guardian: 'Tuteur',
  grandparent: 'Grand-parent',
  sibling: 'Frère/Sœur',
  other: 'Autre',
};

const PAGE_SIZE = 10;

export default async function GuardiansPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; relationship?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? '1', 10) || 1);

  const qs = new URLSearchParams();
  if (sp.q) qs.set('q', sp.q);
  qs.set('limit', '200');

  const guardians = await safe(
    api<{ data: GuardianItem[] }>(`/api/v1/guardians?${qs.toString()}`, { cache: 'no-store' }),
  );
  let allGuardians = guardians?.data ?? [];

  if (sp.relationship) {
    allGuardians = allGuardians.filter((g) =>
      g.guardianships.some((gs) => gs.relationship === sp.relationship),
    );
  }

  // KPI calculations
  const totalGuardians = allGuardians.length;
  const linksApproved = allGuardians.reduce(
    (acc, g) => acc + g.guardianships.filter((gs) => gs.status === 'active').length,
    0,
  );
  const linksPending = allGuardians.reduce(
    (acc, g) => acc + g.guardianships.filter((gs) => gs.status === 'pending').length,
    0,
  );
  const linksRevoked = allGuardians.reduce(
    (acc, g) => acc + g.guardianships.filter((gs) => gs.status === 'revoked').length,
    0,
  );

  const startIdx = (page - 1) * PAGE_SIZE;
  const pageGuardians = allGuardians.slice(startIdx, startIdx + PAGE_SIZE);

  const relationshipOptions = Object.entries(RELATIONSHIP_LABEL).map(([value, label]) => ({
    value,
    label,
  }));

  return (
    <PortalShell portal="admin">
      <PageHeader
        breadcrumb={[
          { label: 'Tableau de bord', href: '/admin/dashboard' },
          { label: 'Parents / Tuteurs' },
        ]}
        title="Parents / Tuteurs"
        subtitle="Gérez les responsables légaux et leurs rattachements aux élèves"
        actions={
          <GuardiansExportButton
            guardians={allGuardians}
            filtered={Boolean(sp.q || sp.relationship)}
          />
        }
      />

      {/* KPI strip */}
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          icon={HeartHandshake}
          tone="blue"
          label="PARENTS ENREGISTRÉS"
          value={totalGuardians}
        >
          Tous les responsables légaux
        </KpiCard>
        <KpiCard icon={Check} tone="green" label="LIENS APPROUVÉS" value={linksApproved}>
          Rattachements actifs
        </KpiCard>
        <KpiCard icon={Clock} tone="orange" label="LIENS EN ATTENTE" value={linksPending}>
          Demandes à valider
        </KpiCard>
        <KpiCard
          icon={ShieldQuestion}
          tone="rose"
          label="COMPTES À VÉRIFIER"
          value={linksRevoked}
        >
          Rattachements révoqués
        </KpiCard>
      </div>

      <div className="mt-6">
        <GuardiansPageFilters
          initialQ={sp.q ?? ''}
          initialRelationship={sp.relationship ?? ''}
          relationshipOptions={relationshipOptions}
        />
      </div>

      <section className="mt-6 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/60">
        {pageGuardians.length === 0 ? (
          <EmptyState
            icon={HeartHandshake}
            title="Aucun parent trouvé"
            description="Importez-en via /admin/imports (type « parents ») ou créez-les depuis la fiche d'un élève."
            tone="slate"
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50">
                  <tr className="text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    <th className="px-4 py-3">Parent / Tuteur</th>
                    <th className="px-4 py-3">Email</th>
                    <th className="px-4 py-3">Téléphone</th>
                    <th className="px-4 py-3 text-center">Élèves rattachés</th>
                    <th className="px-4 py-3">Relation principale</th>
                    <th className="px-4 py-3">Statut du lien</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {pageGuardians.map((g) => {
                    const primaryLink =
                      g.guardianships.find((gs) => gs.isPrimaryContact) ?? g.guardianships[0];
                    return (
                      <tr key={g.id} className="hover:bg-slate-50/60">
                        <td className="px-4 py-3">
                          <AvatarNameCell
                            firstName={g.firstName}
                            lastName={g.lastName}
                            sub={g.profession ?? undefined}
                            href={`/admin/guardians/${g.id}`}
                            tone="rose"
                          />
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-700">
                          {g.email ? (
                            <span className="inline-flex items-center gap-1.5">
                              <Mail className="h-3 w-3 text-slate-400" />
                              {g.email}
                            </span>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm tabular-nums text-slate-700">
                          {g.phone ?? '—'}
                        </td>
                        <td className="px-4 py-3 text-center font-mono text-sm tabular-nums text-slate-700">
                          {g._count.guardianships}
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-700">
                          {primaryLink
                            ? RELATIONSHIP_LABEL[primaryLink.relationship] ??
                              primaryLink.relationship
                            : '—'}
                        </td>
                        <td className="px-4 py-3">
                          {primaryLink ? (
                            <StatusBadge
                              status={primaryLink.status}
                              size="sm"
                              withDot
                              label={
                                primaryLink.status === 'active'
                                  ? 'Approuvé'
                                  : primaryLink.status === 'pending'
                                    ? 'En attente'
                                    : 'Révoqué'
                              }
                            />
                          ) : (
                            <StatusBadge label="—" tone="neutral" size="sm" />
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <RowActions
                            viewHref={`/admin/guardians/${g.id}`}
                            editHref={`/admin/guardians/${g.id}#edit`}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination
              page={page}
              total={totalGuardians}
              pageSize={PAGE_SIZE}
              itemLabel={{ singular: 'parent', plural: 'parents' }}
            />
          </>
        )}
      </section>

      <p className="mt-4 inline-flex items-center gap-1.5 text-xs text-slate-500">
        <Users className="h-3 w-3" />
        Le rattachement parent-élève peut aussi être géré depuis la fiche de chaque élève.
        <Link href="/admin/enrollments" className="font-bold accent-text hover:underline">
          Voir les demandes →
        </Link>
        <span className="hidden">
          <X className="h-3 w-3" />
        </span>
      </p>
    </PortalShell>
  );
}
