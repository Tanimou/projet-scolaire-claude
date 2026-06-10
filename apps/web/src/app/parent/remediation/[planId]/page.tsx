import {
  CalendarClock,
  GraduationCap,
  HeartHandshake,
  Lightbulb,
  MessagesSquare,
  Users,
} from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { PortalShell } from '@/components/PortalShell';
import { api, ApiError } from '@/lib/api-client';
import {
  Badge,
  Card,
  CardContent,
  EmptyState,
  PageHeader,
  StatusBadge,
  SubjectChip,
  formatDateLong,
} from '@pilotage/ui';

import { PlanCompletion } from './PlanCompletion';
import { formatSlotLabel, slotAvailabilityMeta, type CatalogueSlotShape } from './slot-format';

export const metadata: Metadata = { title: 'Soutien scolaire' };
export const dynamic = 'force-dynamic';

interface PlanResponse {
  id: string;
  status: 'open' | 'met' | 'closed';
  studentId: string;
  studentName: string;
  subjectId: string;
  subjectCode: string | null;
  subjectName: string | null;
  alertId: string | null;
  objective: string | null;
  baselineAvg: number | null;
  baselineTrendDelta: number | null;
  createdAt: string;
  /** E7-S6: set once the plan is completed (met|closed), else null. */
  closedAt?: string | null;
}

interface CatalogueTutor {
  id: string;
  type: 'teacher' | 'external' | 'peer';
  costKind: 'free' | 'volunteer' | 'paid_offline';
  displayName: string;
  blurb: string | null;
  subjectIds: string[];
  slots: CatalogueSlotShape[];
}

interface CatalogueResponse {
  subjectId: string;
  subjectName: string | null;
  tutors: CatalogueTutor[];
}

async function safe<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (err) {
    if (err instanceof ApiError) return null;
    throw err;
  }
}

const TUTOR_TYPE_LABEL: Record<CatalogueTutor['type'], string> = {
  teacher: 'Enseignant·e',
  external: 'Partenaire',
  peer: 'Entre pairs',
};

const COST_LABEL: Record<CatalogueTutor['costKind'], string> = {
  free: 'Gratuit',
  volunteer: 'Bénévole',
  paid_offline: 'Hors plateforme',
};

const TUTOR_TYPE_ICON: Record<CatalogueTutor['type'], typeof GraduationCap> = {
  teacher: GraduationCap,
  external: HeartHandshake,
  peer: Users,
};

export default async function RemediationPlanPage({
  params,
  searchParams,
}: {
  params: Promise<{ planId: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { planId } = await params;
  const sp = (await searchParams) ?? {};
  // The cron auto-suggest deep-link (FR-5) may append `?suggest=1`; harmless if absent.
  const suggestImproved = sp.suggest === '1';

  const plan = await safe(
    api<PlanResponse>(`/api/v1/remediation/plans/${planId}`, { cache: 'no-store' }),
  );
  if (!plan) notFound();

  const catalogue = await safe(
    api<CatalogueResponse>(
      `/api/v1/remediation/catalogue?subjectId=${encodeURIComponent(plan.subjectId)}`,
      { cache: 'no-store' },
    ),
  );
  const tutors = catalogue?.tutors ?? [];

  const subjectLabel = plan.subjectName ?? plan.subjectCode ?? 'cette matière';

  // E1/E2 fallback CTAs — the plan page is NEVER a dead-end (FR-3 / AC). When the
  // catalogue is empty, the parent can still message the teacher (E2) or reach the
  // recommendations surface (E1).
  const messagesHref =
    `/parent/messages/new?studentId=${encodeURIComponent(plan.studentId)}` +
    `&subjectId=${encodeURIComponent(plan.subjectId)}` +
    (plan.alertId ? `&alertId=${encodeURIComponent(plan.alertId)}` : '');
  const recommendationsHref = `/parent/recommendations?studentId=${encodeURIComponent(
    plan.studentId,
  )}`;

  return (
    <PortalShell portal="parent">
      <PageHeader
        breadcrumb={[
          { label: 'Tableau de bord', href: '/parent/dashboard' },
          { label: 'Recommandations', href: recommendationsHref },
          { label: 'Soutien scolaire' },
        ]}
        title={`Soutien en ${subjectLabel}`}
        subtitle="Le soutien proposé par l’école pour accompagner votre enfant. Vous suivrez les progrès depuis le tableau de bord."
      />

      {/* Plan target card — the diagnosis, framed kindly (support being organised). */}
      <Card className="mt-6 border-indigo-100 bg-gradient-to-br from-indigo-50/80 to-white">
        <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-4">
            <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-indigo-100 text-indigo-700">
              <GraduationCap className="h-6 w-6" aria-hidden />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-bold text-slate-900">
                  {plan.studentName}
                </h2>
                {plan.subjectCode && plan.subjectName && (
                  <SubjectChip
                    subjectCode={plan.subjectCode}
                    label={plan.subjectName}
                    size="sm"
                  />
                )}
                {plan.status === 'open' && (
                  <StatusBadge label="Soutien en cours" tone="sky" size="sm" withDot />
                )}
              </div>
              <p className="mt-1.5 text-sm text-slate-600">
                {plan.objective ??
                  `Nous accompagnons votre enfant en ${subjectLabel}. Choisissez un créneau de soutien ci-dessous.`}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Plan créé le {formatDateLong(plan.createdAt)}
                {plan.baselineAvg != null && (
                  <> · Moyenne de départ : {plan.baselineAvg.toFixed(1)}/20</>
                )}
                {plan.closedAt && plan.status !== 'open' && (
                  <> · Clôturé le {formatDateLong(plan.closedAt)}</>
                )}
              </p>

              {/* E7-S6 — kind, reversible completion verb (met|closed) + reopen +
                  the calm auto-suggest banner. The only client island on the page. */}
              <div className="mt-3">
                <PlanCompletion
                  planId={plan.id}
                  status={plan.status}
                  subjectLabel={subjectLabel}
                  suggestImproved={suggestImproved}
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* The read-only catalogue. Browse only — no booking verb in S1. */}
      <section className="mt-8" aria-labelledby="catalogue-heading">
        <div className="flex items-center gap-2">
          <h2 id="catalogue-heading" className="text-sm font-bold uppercase tracking-wider text-slate-700">
            Ressources de soutien disponibles
          </h2>
          {tutors.length > 0 && (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600">
              {tutors.length}
            </span>
          )}
        </div>

        {tutors.length === 0 ? (
          <EmptyState
            icon={Lightbulb}
            title="Aucune ressource de soutien pour l’instant"
            description={`L’école ne propose pas encore de soutien en ${subjectLabel}. Votre plan est enregistré : vous pouvez aussi échanger avec l’enseignant·e ou revoir les recommandations.`}
            tone="violet"
            className="mt-4"
          >
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              <Link
                href={messagesHref}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-violet-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-violet-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-1"
              >
                <MessagesSquare className="h-4 w-4" aria-hidden />
                Écrire à l’enseignant·e
              </Link>
              <Link
                href={recommendationsHref}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-white px-4 text-sm font-semibold text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              >
                <Lightbulb className="h-4 w-4" aria-hidden />
                Revoir les recommandations
              </Link>
            </div>
          </EmptyState>
        ) : (
          <ul className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2" role="list">
            {tutors.map((tutor) => {
              const TypeIcon = TUTOR_TYPE_ICON[tutor.type];
              return (
                <li key={tutor.id}>
                  <Card className="h-full">
                    <CardContent className="flex h-full flex-col gap-3 p-5">
                      <div className="flex items-start gap-3">
                        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-700">
                          <TypeIcon className="h-5 w-5" aria-hidden />
                        </span>
                        <div className="min-w-0 flex-1">
                          <h3 className="text-sm font-bold text-slate-900">
                            {tutor.displayName}
                          </h3>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5">
                            <Badge variant="brand" className="text-[11px]">
                              {TUTOR_TYPE_LABEL[tutor.type]}
                            </Badge>
                            <Badge variant="outline" className="text-[11px]">
                              {COST_LABEL[tutor.costKind]}
                            </Badge>
                          </div>
                        </div>
                      </div>

                      {tutor.blurb && (
                        <p className="text-sm leading-snug text-slate-600">{tutor.blurb}</p>
                      )}

                      <div className="mt-auto">
                        <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                          <CalendarClock className="h-3.5 w-3.5" aria-hidden />
                          Créneaux proposés
                        </p>
                        {tutor.slots.length === 0 ? (
                          <p className="text-xs text-slate-500">
                            Aucun créneau publié pour l’instant.
                          </p>
                        ) : (
                          <ul className="flex flex-wrap gap-1.5" role="list">
                            {tutor.slots.map((slot) => {
                              const avail = slotAvailabilityMeta(slot);
                              return (
                                <li
                                  key={slot.id}
                                  className="inline-flex items-center gap-1.5 rounded-lg bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 ring-1 ring-slate-200"
                                >
                                  {formatSlotLabel(slot)}
                                  {avail && (
                                    <StatusBadge
                                      label={avail.label}
                                      tone={avail.tone}
                                      size="sm"
                                    />
                                  )}
                                </li>
                              );
                            })}
                          </ul>
                        )}
                        {/* Booking is handled with the school — a calm, honest hint
                            (an already-booked seat shows the "Réservé" badge above;
                            a cancellation frees the seat and is never a dead-row). */}
                        <p className="mt-2 text-[11px] text-slate-500">
                          Pour réserver ou annuler un créneau, contactez l’école — un
                          créneau annulé redevient disponible pour une autre famille.
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </PortalShell>
  );
}
