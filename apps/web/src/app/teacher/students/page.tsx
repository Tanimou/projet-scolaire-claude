import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  Sparkles,
  User,
  Users,
} from 'lucide-react';
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
  formatGrade,
} from '@pilotage/ui';

import { AT_RISK_GRADE_20, isAtRisk, pctToGrade20 } from './at-risk';
import { ExportStudentsButton } from './ExportStudentsButton';
import { StudentsFilters, type StudentsActivity, type StudentsSort } from './StudentsFilters';

export const metadata: Metadata = { title: 'Mes élèves' };
export const dynamic = 'force-dynamic';

interface TeacherStudent {
  id: string;
  firstName: string;
  lastName: string;
  photoUrl: string | null;
  externalRef: string | null;
  gender: string | null;
  classes: Array<{ id: string; name: string; gradeLevelName: string }>;
  gradesCount: number;
  lastGradeAt: string | null;
  avgPct: number | null;
}

interface ClassSummary {
  id: string;
  name: string;
  gradeLevelName: string;
}

async function safe<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (err) {
    if (err instanceof ApiError) return null;
    throw err;
  }
}

const PAGE_SIZE = 25;
const RECENT_WINDOW_DAYS = 30;

function avgTone(pct: number | null): {
  bg: string;
  text: string;
  label: string;
} {
  if (pct == null) return { bg: 'bg-slate-100', text: 'text-slate-500', label: '—' };
  if (pct >= 80) return { bg: 'bg-emerald-50', text: 'text-emerald-700', label: 'Excellent' };
  if (pct >= 50) return { bg: 'bg-amber-50', text: 'text-amber-700', label: 'Satisfaisant' };
  return { bg: 'bg-rose-50', text: 'text-rose-700', label: 'À soutenir' };
}

function formatRelative(iso: string | null): string {
  if (!iso) return 'Aucune note';
  const d = new Date(iso);
  const days = Math.round((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
  if (days <= 0) return "Aujourd'hui";
  if (days === 1) return 'Hier';
  if (days < 7) return `Il y a ${days} j`;
  if (days < 30) return `Il y a ${Math.floor(days / 7)} sem`;
  if (days < 365) return `Il y a ${Math.floor(days / 30)} mois`;
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default async function TeacherStudentsPage({
  searchParams,
}: {
  searchParams: Promise<{
    page?: string;
    classSectionId?: string;
    q?: string;
    gender?: string;
    activity?: string;
    sort?: string;
  }>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? '1', 10) || 1);
  const q = (sp.q ?? '').trim();
  const classSectionId = sp.classSectionId ?? '';
  const gender = sp.gender ?? '';
  const activity = (sp.activity ?? '') as StudentsActivity;
  const sort = ((sp.sort ?? 'name') as StudentsSort) || 'name';

  const resp = await safe(
    api<{ data: TeacherStudent[]; count: number; classesSummary: ClassSummary[] }>(
      '/api/v1/teachers/me/students',
      { cache: 'no-store' },
    ),
  );
  const allStudents = resp?.data ?? [];
  const classesSummary = resp?.classesSummary ?? [];

  const recentCutoff = Date.now() - RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000;

  // Apply filters
  const filtered = allStudents.filter((s) => {
    if (classSectionId && !s.classes.some((c) => c.id === classSectionId)) return false;
    if (gender && s.gender !== gender) return false;
    if (q) {
      const needle = q.toLowerCase();
      const hay = `${s.firstName} ${s.lastName} ${s.externalRef ?? ''}`.toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    if (activity === 'recent') {
      if (!s.lastGradeAt || new Date(s.lastGradeAt).getTime() < recentCutoff) return false;
    } else if (activity === 'none') {
      if (s.gradesCount > 0) return false;
    } else if (activity === 'at-risk') {
      if (!isAtRisk(s.avgPct)) return false;
    }
    return true;
  });

  // Sort
  const sorted = [...filtered].sort((a, b) => {
    if (sort === 'recent') {
      const ta = a.lastGradeAt ? new Date(a.lastGradeAt).getTime() : 0;
      const tb = b.lastGradeAt ? new Date(b.lastGradeAt).getTime() : 0;
      if (tb !== ta) return tb - ta;
    } else if (sort === 'avg-desc') {
      const av = a.avgPct ?? -1;
      const bv = b.avgPct ?? -1;
      if (bv !== av) return bv - av;
    } else if (sort === 'avg-asc') {
      const av = a.avgPct ?? 999;
      const bv = b.avgPct ?? 999;
      if (av !== bv) return av - bv;
    }
    return a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName);
  });

  const total = sorted.length;
  const startIdx = (page - 1) * PAGE_SIZE;
  const pageRows = sorted.slice(startIdx, startIdx + PAGE_SIZE);

  // KPIs (computed across the full roster, not the filter set)
  const uniqueClasses = new Set(allStudents.flatMap((s) => s.classes.map((c) => c.id))).size;
  const recentlyGraded = allStudents.filter(
    (s) => s.lastGradeAt && new Date(s.lastGradeAt).getTime() >= recentCutoff,
  ).length;
  const scored = allStudents.filter((s) => s.avgPct != null);
  const cohortAvgPct = scored.length
    ? scored.reduce((sum, s) => sum + (s.avgPct ?? 0), 0) / scored.length
    : null;
  const cohortAvg20 = cohortAvgPct != null ? pctToGrade20(cohortAvgPct) : null;
  // Aligné sur le filtre `activity === 'at-risk'` : une moyenne absente n'est
  // PAS comptée comme « à risque » (et `scored` exclut déjà les null).
  const atRiskCount = scored.filter((s) => isAtRisk(s.avgPct)).length;

  const hasActiveFilters = !!(q || classSectionId || gender || activity);

  return (
    <PortalShell portal="teacher">
      <PageHeader
        breadcrumb={[
          { label: 'Tableau de bord', href: '/teacher/dashboard' },
          { label: 'Élèves' },
        ]}
        title="Mes élèves"
        subtitle="Tous les élèves que vous enseignez cette année, à travers vos différentes classes"
        actions={<ExportStudentsButton students={sorted} filtered={hasActiveFilters} />}
      />

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <KpiCard icon={User} tone="blue" label="ÉLÈVES" value={allStudents.length}>
          Effectif distinct
        </KpiCard>
        <KpiCard icon={Users} tone="violet" label="CLASSES" value={uniqueClasses}>
          Classes enseignées
        </KpiCard>
        <KpiCard icon={Activity} tone="green" label="ACTIVITÉ RÉCENTE" value={recentlyGraded}>
          {allStudents.length > 0
            ? `Notés ≤ 30 j (${Math.round((recentlyGraded / allStudents.length) * 100)} %)`
            : 'Notés ≤ 30 j'}
        </KpiCard>
        <KpiCard
          icon={AlertTriangle}
          tone="rose"
          label="À RISQUE"
          value={atRiskCount}
          href="/teacher/students?activity=at-risk"
          hrefLabel="Voir la liste →"
        >
          {scored.length > 0
            ? `Moyenne < ${AT_RISK_GRADE_20}/20 · ${Math.round((atRiskCount / scored.length) * 100)} % des notés`
            : `Moyenne < ${AT_RISK_GRADE_20}/20`}
        </KpiCard>
        <KpiCard
          icon={Sparkles}
          tone="amber"
          label="MOYENNE COHORTE"
          value={cohortAvg20 != null ? `${formatGrade(cohortAvg20, 1)}/20` : '—'}
        >
          Sur vos évaluations
        </KpiCard>
      </div>

      <div className="mt-6">
        <StudentsFilters
          classes={classesSummary}
          q={q}
          classSectionId={classSectionId}
          gender={gender}
          activity={activity}
          sort={sort}
        />
      </div>

      <section className="mt-4 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/60">
        {pageRows.length === 0 ? (
          <EmptyState
            icon={User}
            title={hasActiveFilters ? 'Aucun élève ne correspond aux filtres' : 'Aucun élève trouvé'}
            description={
              hasActiveFilters
                ? "Ajustez les filtres pour voir d'autres élèves de vos classes."
                : "Vos classes n'ont pas encore d'élèves inscrits, ou aucune classe ne vous est affectée."
            }
            tone="slate"
          />
        ) : (
          <>
            <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/60 px-4 py-2 text-[11px] text-slate-500">
              <span>
                <strong className="font-bold text-slate-700">{total}</strong>{' '}
                {total > 1 ? 'élèves' : 'élève'}
                {hasActiveFilters ? ' filtrés' : ''} · page {page} sur {Math.max(1, Math.ceil(total / PAGE_SIZE))}
              </span>
              {hasActiveFilters && (
                <Link
                  href="/teacher/students"
                  className="font-bold text-slate-600 hover:text-slate-900 hover:underline"
                >
                  Réinitialiser les filtres
                </Link>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-white">
                  <tr className="text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    <th className="px-4 py-3">Élève</th>
                    <th className="px-4 py-3">Classe(s)</th>
                    <th className="px-4 py-3">Niveau</th>
                    <th className="px-4 py-3 text-right">Notes</th>
                    <th className="px-4 py-3 text-right">Moyenne</th>
                    <th className="px-4 py-3">Dernière activité</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {pageRows.map((s) => {
                    const tone = avgTone(s.avgPct);
                    const avg20 = s.avgPct != null ? pctToGrade20(s.avgPct) : null;
                    return (
                      <tr key={s.id} className="transition hover:bg-slate-50/60">
                        <td className="px-4 py-3">
                          <AvatarNameCell
                            firstName={s.firstName}
                            lastName={s.lastName}
                            src={s.photoUrl}
                            size="sm"
                            sub={s.externalRef ? `Réf. ${s.externalRef}` : undefined}
                          />
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            {s.classes.map((c) => (
                              <span
                                key={c.id}
                                className="inline-flex rounded-md bg-blue-50 px-2 py-0.5 text-xs font-bold text-blue-700"
                              >
                                {c.name}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-700">
                          {s.classes
                            .map((c) => c.gradeLevelName)
                            .filter((v, i, a) => a.indexOf(v) === i)
                            .join(' · ')}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {s.gradesCount > 0 ? (
                            <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-700">
                              <ClipboardList className="h-3 w-3" />
                              {s.gradesCount}
                            </span>
                          ) : (
                            <span className="text-xs text-slate-400">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {avg20 != null ? (
                            <div className="inline-flex flex-col items-end">
                              <span
                                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold ${tone.bg} ${tone.text}`}
                                title={`${tone.label} · ${formatGrade(s.avgPct ?? 0, 0)}%`}
                              >
                                <CheckCircle2 className="h-3 w-3" />
                                {formatGrade(avg20, 1)}/20
                              </span>
                              <span className="mt-0.5 text-[10px] text-slate-400">{tone.label}</span>
                            </div>
                          ) : (
                            <span className="text-xs text-slate-400">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-600">
                          {s.lastGradeAt ? (
                            <span title={new Date(s.lastGradeAt).toLocaleString('fr-FR')}>
                              {formatRelative(s.lastGradeAt)}
                            </span>
                          ) : (
                            <span className="text-slate-400">Pas encore noté</span>
                          )}
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
              itemLabel={{ singular: 'élève', plural: 'élèves' }}
            />
          </>
        )}
      </section>
    </PortalShell>
  );
}
