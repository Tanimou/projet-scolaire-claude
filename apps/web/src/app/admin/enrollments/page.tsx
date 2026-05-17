import { Check, Clock, FileSearch, UserPlus, X } from 'lucide-react';
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
  formatDateShort,
} from '@pilotage/ui';

import { EnrollmentsPageTabs } from './EnrollmentsPageTabs';

export const metadata: Metadata = { title: 'Inscriptions' };
export const dynamic = 'force-dynamic';

interface EnrollmentRequestRow {
  id: string;
  status: 'pending' | 'active' | 'revoked';
  relationship: string;
  notes: string | null;
  createdAt: string;
  guardian: {
    id: string;
    firstName: string;
    lastName: string;
    email: string | null;
    phone: string | null;
  };
  student: {
    id: string;
    firstName: string;
    lastName: string;
    enrollments?: Array<{ classSection: { name: string } }>;
  };
}

async function safe<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (err) {
    if (err instanceof ApiError) return null;
    throw err;
  }
}

const PAGE_SIZE = 10;

function parseRequestType(notes: string | null): 'rattachement' | 'inscription' {
  if (notes && notes.startsWith('{')) {
    try {
      const parsed = JSON.parse(notes) as { kind?: string };
      if (parsed.kind === 'inscription') return 'inscription';
    } catch {
      /* ignore */
    }
  }
  return 'rattachement';
}

function parseReview(notes: string | null, fallback: string): string {
  if (notes && notes.startsWith('{')) {
    try {
      const parsed = JSON.parse(notes) as { review?: string };
      if (parsed.review) return parsed.review;
    } catch {
      /* ignore */
    }
  }
  return fallback;
}

export default async function EnrollmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const tab =
    (sp.tab as 'all' | 'pending' | 'to_verify' | 'approved' | 'rejected') ?? 'pending';
  const page = Math.max(1, parseInt(sp.page ?? '1', 10) || 1);

  const response = await safe(
    api<{ data: EnrollmentRequestRow[] }>(
      '/api/v1/guardians?includePending=true&limit=200',
      { cache: 'no-store' },
    ),
  );
  const allRequests = response?.data ?? [];

  // Compute counts per status (using the notes JSON flag for to_verify/approved distinction)
  const pending = allRequests.filter((r) => r.status === 'pending');
  const toVerify = pending.filter((r) => parseReview(r.notes, '') === 'to_verify');
  const realPending = pending.filter((r) => parseReview(r.notes, 'pending') === 'pending');
  const approved = allRequests.filter(
    (r) => r.status === 'active' && parseReview(r.notes, '') === 'approved',
  );
  const rejected = allRequests.filter((r) => r.status === 'revoked');

  // Tab filtering
  let rows: EnrollmentRequestRow[];
  if (tab === 'pending') rows = realPending;
  else if (tab === 'to_verify') rows = toVerify;
  else if (tab === 'approved') rows = approved;
  else if (tab === 'rejected') rows = rejected;
  else rows = [...pending, ...approved, ...rejected];

  const total = rows.length;
  const startIdx = (page - 1) * PAGE_SIZE;
  const pageRows = rows.slice(startIdx, startIdx + PAGE_SIZE);

  return (
    <PortalShell portal="admin">
      <PageHeader
        breadcrumb={[
          { label: 'Tableau de bord', href: '/admin/dashboard' },
          { label: 'Inscriptions' },
        ]}
        title="Inscriptions"
        subtitle="Validez les demandes de rattachement et d'inscription des élèves"
      />

      {/* KPI strip */}
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          icon={Clock}
          tone="orange"
          label="DEMANDES EN ATTENTE"
          value={realPending.length}
        >
          À traiter rapidement
        </KpiCard>
        <KpiCard
          icon={FileSearch}
          tone="sky"
          label="À VÉRIFIER"
          value={toVerify.length}
        >
          Documents à confirmer
        </KpiCard>
        <KpiCard
          icon={Check}
          tone="green"
          label="APPROUVÉES (CE MOIS)"
          value={approved.length}
        >
          Demandes acceptées
        </KpiCard>
        <KpiCard icon={X} tone="rose" label="REJETÉES" value={rejected.length}>
          Demandes refusées
        </KpiCard>
      </div>

      {/* Tabs */}
      <div className="mt-6">
        <EnrollmentsPageTabs
          activeTab={tab}
          counts={{
            all: pending.length + approved.length + rejected.length,
            pending: realPending.length,
            to_verify: toVerify.length,
            approved: approved.length,
            rejected: rejected.length,
          }}
        />
      </div>

      {/* Table */}
      <section className="mt-6 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/60">
        {pageRows.length === 0 ? (
          <EmptyState
            icon={UserPlus}
            title="Aucune demande dans cet onglet"
            description="Les demandes apparaîtront ici dès que des parents les soumettront depuis leur portail."
            tone="slate"
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50">
                  <tr className="text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    <th className="px-4 py-3">Demandeur</th>
                    <th className="px-4 py-3">Élève</th>
                    <th className="px-4 py-3">Type</th>
                    <th className="px-4 py-3">Classe souhaitée</th>
                    <th className="px-4 py-3">Statut</th>
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {pageRows.map((r) => {
                    const kind = parseRequestType(r.notes);
                    const review = parseReview(r.notes, r.status === 'pending' ? 'pending' : 'approved');
                    const className = r.student.enrollments?.[0]?.classSection.name ?? '—';
                    return (
                      <tr key={r.id} className="hover:bg-slate-50/60">
                        <td className="px-4 py-3">
                          <AvatarNameCell
                            firstName={r.guardian.firstName}
                            lastName={r.guardian.lastName}
                            sub={r.guardian.email ?? r.guardian.phone ?? undefined}
                            tone="rose"
                          />
                        </td>
                        <td className="px-4 py-3 text-sm font-semibold text-slate-900">
                          {r.student.firstName} {r.student.lastName}
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-700 capitalize">
                          {kind === 'inscription' ? 'Inscription' : 'Rattachement'}
                        </td>
                        <td className="px-4 py-3">
                          <span className="inline-flex rounded-md bg-blue-50 px-2 py-0.5 text-xs font-bold text-blue-700">
                            {className}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={review} size="sm" withDot />
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-500">
                          {formatDateShort(r.createdAt)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <RowActions viewHref={`/admin/guardians/${r.guardian.id}`} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination
              page={page}
              total={total}
              pageSize={PAGE_SIZE}
              itemLabel={{ singular: 'demande', plural: 'demandes' }}
            />
          </>
        )}
      </section>

      <p className="mt-4 text-xs text-slate-500">
        💡 Le modèle complet <code className="font-mono">EnrollmentRequest</code> (distinct de{' '}
        <code className="font-mono">Guardianship</code>) est planifié pour R6. Pour l&apos;instant,
        les demandes sont dérivées de <code className="font-mono">Guardianship</code> avec un flag
        JSON. Les actions Approuver / Rejeter ouvriront un <em>FormDrawer</em> dédié dans la phase
        R6.
      </p>

      <p className="mt-4">
        <Link
          href="/admin/enrollment-requests"
          className="text-xs text-slate-400 hover:underline"
        >
          (lien legacy — redirige ici)
        </Link>
      </p>
    </PortalShell>
  );
}
