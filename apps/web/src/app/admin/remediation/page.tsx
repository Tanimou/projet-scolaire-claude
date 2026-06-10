import {
  CalendarCheck,
  Clock,
  GraduationCap,
  HeartHandshake,
  Target,
} from 'lucide-react';
import type { Metadata } from 'next';

import { PortalShell } from '@/components/PortalShell';
import { api, ApiError } from '@/lib/api-client';
import type {
  AdminRemediationCatalogueDto,
  AdminRemediationOverviewDto,
} from '@pilotage/contracts';
import { Card, CardContent, EmptyState, KpiCard, PageHeader, StatusBadge, SubjectChip } from '@pilotage/ui';

import { RemediationCatalogueManager } from './RemediationCatalogueManager';

export const metadata: Metadata = { title: 'Soutien scolaire' };
export const dynamic = 'force-dynamic';

interface SimpleSubject {
  id: string;
  code: string | null;
  name: string;
  color?: string | null;
}
interface TeacherItem {
  id: string;
  userProfile: { firstName: string; lastName: string };
}

async function safe<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (err) {
    if (err instanceof ApiError) return null;
    throw err;
  }
}

/**
 * Admin "Soutien scolaire" (E7-S5) — the catalogue curation + oversight surface.
 *
 * Gated server-side on `remediation.manage` (admin-only). Fetches the two admin
 * aggregate endpoints (catalogue + school-scoped overview) plus the existing
 * subject/teacher lookups (which already power /admin/subjects + /admin/teachers)
 * — four server reads, no client N+1 — and renders:
 *  - the RGPD-clean per-subject demand overview as KpiCards + a "Matières à
 *    renforcer" strip (aggregate counts only, never a child by name);
 *  - the tutors DataTable with create/edit/publish/retire/slot curation.
 *
 * Kind, non-stigmatising copy throughout (organising support, never failure).
 */
export default async function AdminRemediationPage() {
  const [catalogue, overview, subjectsResp, teachersResp] = await Promise.all([
    safe(api<AdminRemediationCatalogueDto>('/api/v1/remediation/admin/tutors', { cache: 'no-store' })),
    safe(api<AdminRemediationOverviewDto>('/api/v1/remediation/admin/overview', { cache: 'no-store' })),
    safe(api<{ data: SimpleSubject[] }>('/api/v1/subjects', { cache: 'no-store' })),
    safe(api<{ data: TeacherItem[] }>('/api/v1/teachers?active=true', { cache: 'no-store' })),
  ]);

  const loadFailed = catalogue === null && overview === null;

  const tutors = catalogue?.tutors ?? [];
  const bySubject = overview?.bySubject ?? [];
  const totals = overview?.totals ?? { openPlans: 0, activeBookings: 0, publishedTutors: 0 };

  const subjects = (subjectsResp?.data ?? []).map((s) => ({
    id: s.id,
    code: s.code,
    name: s.name,
  }));
  const teachers = (teachersResp?.data ?? []).map((t) => ({
    id: t.id,
    name: `${t.userProfile.firstName} ${t.userProfile.lastName}`.trim(),
  }));

  const pendingTutors = tutors.filter((t) => !t.published).length;
  // Subjects where families seek support but no tutor is published yet (the gap signal).
  const demandRows = bySubject
    .filter((r) => r.openPlans > 0 || r.tutorCount > 0)
    .sort((a, b) => b.openPlans - a.openPlans);

  return (
    <PortalShell portal="admin">
      <PageHeader
        breadcrumb={[
          { label: 'Tableau de bord', href: '/admin/dashboard' },
          { label: 'Soutien scolaire' },
        ]}
        title="Soutien scolaire"
        subtitle="Constituez un catalogue d’intervenants de confiance pour vos familles et suivez les besoins d’accompagnement par matière."
      />

      <div className="mt-6 space-y-8">
        <section className="flex items-start gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/60 sm:p-5">
          <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-700">
            <HeartHandshake className="h-5 w-5" aria-hidden />
          </span>
          <p className="text-sm leading-relaxed text-slate-600">
            Approuvez les intervenants visibles des familles, publiez leurs créneaux de soutien, et
            repérez les matières où la demande dépasse l’offre. Les compteurs ci-dessous sont agrégés
            par matière — jamais nominatifs.
          </p>
        </section>

        {loadFailed && (
          <p role="alert" className="rounded-lg bg-rose-100/80 px-3 py-2 text-sm font-medium text-rose-800">
            Le catalogue n’a pas pu être chargé. Réessayez dans un instant.
          </p>
        )}

        {!loadFailed && (
          <>
            {/* KPI strip — aggregate, RGPD-clean. */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <KpiCard
                icon={GraduationCap}
                tone="violet"
                label="Intervenants publiés"
                value={totals.publishedTutors}
              />
              <KpiCard
                icon={Clock}
                tone={pendingTutors > 0 ? 'amber' : 'slate'}
                label="En attente d’approbation"
                value={pendingTutors}
              />
              <KpiCard icon={Target} tone="sky" label="Plans actifs" value={totals.openPlans} />
              <KpiCard
                icon={CalendarCheck}
                tone="blue"
                label="Séances réservées"
                value={totals.activeBookings}
              />
            </div>

            {/* Per-subject demand overview ("Matières à renforcer"). */}
            <section aria-labelledby="demand-heading">
              <h2 id="demand-heading" className="mb-1 text-sm font-bold uppercase tracking-wider text-slate-700">
                Besoins d’accompagnement par matière
              </h2>
              <p className="mb-4 text-sm text-slate-500">
                Repérez les matières où des familles cherchent du soutien mais où le catalogue manque
                d’intervenants.
              </p>

              {demandRows.length === 0 ? (
                <EmptyState
                  icon={Target}
                  tone="violet"
                  title="Aucun besoin d’accompagnement signalé pour l’instant"
                  description="Dès qu’une famille engagera un plan de soutien, la matière concernée apparaîtra ici."
                />
              ) : (
                <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" role="list">
                  {demandRows.map((r) => {
                    const gap = r.openPlans > 0 && r.tutorCount === 0;
                    return (
                      <li key={r.subjectId}>
                        <Card className="h-full">
                          <CardContent className="flex h-full flex-col gap-2 p-4">
                            <div className="flex items-center justify-between gap-2">
                              <SubjectChip
                                subjectCode={r.subjectName ?? '—'}
                                label={r.subjectName ?? 'Matière'}
                                size="sm"
                              />
                              {gap && (
                                <StatusBadge label="Capacité à renforcer" tone="amber" size="sm" withDot />
                              )}
                            </div>
                            <div className="mt-auto flex items-center gap-3 text-xs text-slate-600">
                              <span>
                                <strong className="font-bold tabular-nums text-slate-900">
                                  {r.openPlans}
                                </strong>{' '}
                                plan{r.openPlans > 1 ? 's' : ''} actif{r.openPlans > 1 ? 's' : ''}
                              </span>
                              <span aria-hidden className="text-slate-300">
                                ·
                              </span>
                              <span>
                                <strong className="font-bold tabular-nums text-slate-900">
                                  {r.tutorCount}
                                </strong>{' '}
                                intervenant{r.tutorCount > 1 ? 's' : ''}
                              </span>
                            </div>
                            {gap && (
                              <p className="text-xs text-amber-700">
                                Des familles cherchent un soutien en {r.subjectName ?? 'cette matière'} —
                                aucun intervenant publié.
                              </p>
                            )}
                          </CardContent>
                        </Card>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            {/* Catalogue management. */}
            <section aria-labelledby="catalogue-heading">
              <h2 id="catalogue-heading" className="mb-4 text-sm font-bold uppercase tracking-wider text-slate-700">
                Catalogue de soutien
              </h2>
              <RemediationCatalogueManager
                tutors={tutors}
                subjects={subjects}
                teachers={teachers}
              />
            </section>
          </>
        )}
      </div>
    </PortalShell>
  );
}
