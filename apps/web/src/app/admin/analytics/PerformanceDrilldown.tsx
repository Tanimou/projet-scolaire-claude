'use client';

import { ChevronRight, Home, Minus, TrendingDown, TrendingUp } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useTransition } from 'react';

import { EmptyState, SelectFilter, StatusBadge } from '@pilotage/ui';

// ---------------------------------------------------------------------------
// Types — miroir du payload renvoyé par l'API drill-down.
// ---------------------------------------------------------------------------
export interface DrilldownGroup {
  id: string;
  name: string;
  color: string | null;
  studentsWithGrades: number;
  studentsPassing: number;
  studentsFailing: number;
  successRate: number | null;
  averageOfAverages: number | null;
}

export interface DrilldownStudent {
  studentId: string;
  firstName: string;
  lastName: string;
  average: number | null;
  rank: number | null;
  rankOutOf: number;
  trend: { previousAverage: number | null; delta: number | null } | null;
  status: 'success' | 'at_risk' | 'no_data';
}

export interface DrilldownResponse {
  level: 'cycle' | 'class' | 'subject' | 'students';
  scope: {
    academicYearId: string | null;
    termId: string | null;
    cycleId: string | null;
    classSectionId: string | null;
    subjectId: string | null;
  };
  terms: Array<{ id: string; name: string; orderIndex: number }>;
  groups: DrilldownGroup[];
  students: DrilldownStudent[];
}

export interface Selection {
  termId: string;
  cycleId?: string;
  cycleName?: string;
  classSectionId?: string;
  className?: string;
  subjectId?: string;
  subjectName?: string;
}

const LEVEL_LABEL: Record<DrilldownResponse['level'], string> = {
  cycle: 'Par cycle',
  class: 'Par classe',
  subject: 'Par matière',
  students: 'Par élève',
};

function formatRate(rate: number | null): string {
  return rate === null ? '—' : `${Math.round(rate)}%`;
}

function formatAvg(avg: number | null): string {
  return avg === null ? '—' : `${avg.toFixed(2)}/20`;
}

/** Tonalité du badge selon le taux de réussite (cohérent avec le seuil 50/75%). */
function rateTone(rate: number | null): 'success' | 'warning' | 'danger' | 'neutral' {
  if (rate === null) return 'neutral';
  if (rate >= 75) return 'success';
  if (rate >= 50) return 'warning';
  return 'danger';
}

export function PerformanceDrilldown({
  data,
  selection,
}: {
  data: DrilldownResponse | null;
  selection: Selection;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  /** Construit une URL en repartant de la sélection courante + un patch. */
  function hrefFor(patch: Partial<Selection> & { reset?: boolean }): string {
    const next: Selection = patch.reset
      ? { termId: selection.termId, ...patch }
      : { ...selection, ...patch };
    const qs = new URLSearchParams();
    if (next.termId) qs.set('termId', next.termId);
    if (next.cycleId) qs.set('cycleId', next.cycleId);
    if (next.cycleName) qs.set('cycleName', next.cycleName);
    if (next.classSectionId) qs.set('classSectionId', next.classSectionId);
    if (next.className) qs.set('className', next.className);
    if (next.subjectId) qs.set('subjectId', next.subjectId);
    if (next.subjectName) qs.set('subjectName', next.subjectName);
    const s = qs.toString();
    return s ? `${pathname}?${s}` : pathname;
  }

  function navigate(patch: Partial<Selection> & { reset?: boolean }) {
    startTransition(() => router.push(hrefFor(patch)));
  }

  function onTermChange(termId: string) {
    // Changer de trimestre conserve le chemin de drill-down courant.
    startTransition(() => {
      const qs = new URLSearchParams();
      if (termId) qs.set('termId', termId);
      if (selection.cycleId) qs.set('cycleId', selection.cycleId);
      if (selection.cycleName) qs.set('cycleName', selection.cycleName);
      if (selection.classSectionId) qs.set('classSectionId', selection.classSectionId);
      if (selection.className) qs.set('className', selection.className);
      if (selection.subjectId) qs.set('subjectId', selection.subjectId);
      if (selection.subjectName) qs.set('subjectName', selection.subjectName);
      const s = qs.toString();
      router.push(s ? `${pathname}?${s}` : pathname);
    });
  }

  const level = data?.level ?? 'cycle';
  const terms = data?.terms ?? [];

  const termOptions = [
    { value: '', label: 'Toute l’année' },
    ...terms.map((t) => ({ value: t.id, label: t.name })),
  ];

  // Fil d'Ariane du drill-down (cliquable pour remonter).
  const crumbs: Array<{ label: string; href?: string }> = [
    { label: 'Cycles', href: level === 'cycle' ? undefined : hrefFor({ reset: true }) },
  ];
  if (selection.cycleId) {
    crumbs.push({
      label: selection.cycleName ?? 'Cycle',
      href:
        level === 'class'
          ? undefined
          : hrefFor({
              reset: true,
              cycleId: selection.cycleId,
              cycleName: selection.cycleName,
            }),
    });
  }
  if (selection.classSectionId) {
    crumbs.push({
      label: selection.className ?? 'Classe',
      href:
        level === 'subject'
          ? undefined
          : hrefFor({
              reset: true,
              cycleId: selection.cycleId,
              cycleName: selection.cycleName,
              classSectionId: selection.classSectionId,
              className: selection.className,
            }),
    });
  }
  if (selection.subjectId) {
    crumbs.push({ label: selection.subjectName ?? 'Matière' });
  }

  return (
    <div className="rounded-2xl bg-white p-6 ring-1 ring-slate-200/60 shadow-sm">
      {/* En-tête : fil d'Ariane + sélecteur de trimestre */}
      <div className="flex flex-col gap-4 border-b border-slate-100 pb-4 sm:flex-row sm:items-center sm:justify-between">
        <nav aria-label="Fil d'Ariane" className="flex flex-wrap items-center gap-1 text-sm">
          <Link
            href={hrefFor({ reset: true })}
            className="inline-flex items-center gap-1 text-slate-500 hover:text-slate-900"
          >
            <Home className="h-3.5 w-3.5" />
          </Link>
          {crumbs.map((c, i) => (
            <span key={i} className="inline-flex items-center gap-1">
              <ChevronRight className="h-3.5 w-3.5 text-slate-300" />
              {c.href ? (
                <Link href={c.href} className="font-medium text-blue-600 hover:underline">
                  {c.label}
                </Link>
              ) : (
                <span className="font-semibold text-slate-900">{c.label}</span>
              )}
            </span>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
            Période
          </span>
          <div className="w-48">
            <SelectFilter
              options={termOptions}
              value={selection.termId}
              onChange={onTermChange}
              size="sm"
              placeholder="Toute l’année"
            />
          </div>
        </div>
      </div>

      {/* Étiquette du niveau courant */}
      <div className="mt-4 flex items-center justify-between">
        <h3 className="text-sm font-bold uppercase tracking-wide text-slate-700">
          {LEVEL_LABEL[level]}
        </h3>
        {isPending && <span className="text-xs text-slate-400">Chargement…</span>}
      </div>

      {/* Corps : groupes (L1/L2/L3) ou liste élèves (L4) */}
      <div className="mt-3" aria-busy={isPending}>
        {level === 'students' ? (
          <StudentsTable students={data?.students ?? []} />
        ) : (
          <GroupsTable
            level={level}
            groups={data?.groups ?? []}
            onDrill={(g) => navigate(drillPatch(level, g, selection))}
          />
        )}
      </div>
    </div>
  );
}

/** Détermine le patch de navigation au clic sur un groupe, selon le niveau. */
function drillPatch(
  level: DrilldownResponse['level'],
  g: DrilldownGroup,
  selection: Selection,
): Partial<Selection> & { reset?: boolean } {
  if (level === 'cycle') {
    return { reset: true, cycleId: g.id, cycleName: g.name };
  }
  if (level === 'class') {
    return {
      reset: true,
      cycleId: selection.cycleId,
      cycleName: selection.cycleName,
      classSectionId: g.id,
      className: g.name,
    };
  }
  // level === 'subject' → on descend vers les élèves (L4)
  return {
    reset: true,
    cycleId: selection.cycleId,
    cycleName: selection.cycleName,
    classSectionId: selection.classSectionId,
    className: selection.className,
    subjectId: g.id,
    subjectName: g.name,
  };
}

function GroupsTable({
  level,
  groups,
  onDrill,
}: {
  level: DrilldownResponse['level'];
  groups: DrilldownGroup[];
  onDrill: (g: DrilldownGroup) => void;
}) {
  if (groups.length === 0) {
    return (
      <EmptyState
        title="Pas encore de données"
        description="Les statistiques s’afficheront dès la première note publiée sur ce périmètre."
        tone="slate"
        className="mt-2"
      />
    );
  }

  const colLabel =
    level === 'cycle' ? 'Cycle' : level === 'class' ? 'Classe' : 'Matière';

  return (
    <div className="-mx-2 overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">
            <th className="px-3 py-2">{colLabel}</th>
            <th className="px-3 py-2 text-right">Élèves évalués</th>
            <th className="px-3 py-2 text-right">En réussite</th>
            <th className="px-3 py-2 text-right">En difficulté</th>
            <th className="px-3 py-2 text-right">Moyenne</th>
            <th className="px-3 py-2 text-right">Taux de réussite</th>
            <th className="px-3 py-2" aria-label="Explorer" />
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {groups.map((g) => (
            <tr
              key={g.id}
              onClick={() => onDrill(g)}
              className="cursor-pointer transition hover:bg-slate-50/70"
            >
              <td className="px-3 py-2.5">
                <span className="inline-flex items-center gap-2 font-semibold text-slate-900">
                  <span
                    aria-hidden
                    className="inline-block h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: g.color ?? '#94A3B8' }}
                  />
                  {g.name}
                </span>
              </td>
              <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-700">
                {g.studentsWithGrades}
              </td>
              <td className="px-3 py-2.5 text-right font-mono tabular-nums text-emerald-700">
                {g.studentsPassing}
              </td>
              <td className="px-3 py-2.5 text-right font-mono tabular-nums text-rose-700">
                {g.studentsFailing}
              </td>
              <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-700">
                {formatAvg(g.averageOfAverages)}
              </td>
              <td className="px-3 py-2.5 text-right">
                <SuccessBar rate={g.successRate} />
              </td>
              <td className="px-3 py-2.5 text-right text-slate-300">
                <ChevronRight className="ml-auto h-4 w-4" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Barre + libellé du taux de réussite (composant inline, zéro dépendance). */
function SuccessBar({ rate }: { rate: number | null }) {
  const tone = rateTone(rate);
  const barColor =
    tone === 'success'
      ? 'bg-emerald-500'
      : tone === 'warning'
        ? 'bg-amber-500'
        : tone === 'danger'
          ? 'bg-rose-500'
          : 'bg-slate-300';
  return (
    <div className="inline-flex items-center justify-end gap-2">
      <span className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-100">
        <span
          className={`block h-full rounded-full ${barColor}`}
          style={{ width: `${rate === null ? 0 : Math.max(2, Math.min(100, rate))}%` }}
        />
      </span>
      <span className="w-10 font-mono text-xs font-bold tabular-nums text-slate-700">
        {formatRate(rate)}
      </span>
    </div>
  );
}

function StudentsTable({ students }: { students: DrilldownStudent[] }) {
  if (students.length === 0) {
    return (
      <EmptyState
        title="Aucun élève à afficher"
        description="Cette classe n’a pas d’élève noté pour cette matière sur la période sélectionnée."
        tone="slate"
        className="mt-2"
      />
    );
  }

  return (
    <div className="-mx-2 overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">
            <th className="px-3 py-2 text-right">Rang</th>
            <th className="px-3 py-2">Élève</th>
            <th className="px-3 py-2 text-right">Moyenne</th>
            <th className="px-3 py-2 text-right">Tendance</th>
            <th className="px-3 py-2">Statut</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {students.map((s) => (
            <tr key={s.studentId} className="hover:bg-slate-50/60">
              <td className="px-3 py-2.5 text-right font-mono text-xs font-bold tabular-nums text-slate-500">
                {s.rank !== null ? `${s.rank}/${s.rankOutOf}` : '—'}
              </td>
              <td className="px-3 py-2.5 font-semibold text-slate-900">
                {s.lastName.toUpperCase()} {s.firstName}
              </td>
              <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-800">
                {formatAvg(s.average)}
              </td>
              <td className="px-3 py-2.5 text-right">
                <TrendCell trend={s.trend} />
              </td>
              <td className="px-3 py-2.5">
                <StatusBadge
                  label={
                    s.status === 'success'
                      ? 'En réussite'
                      : s.status === 'at_risk'
                        ? 'En difficulté'
                        : 'Sans note'
                  }
                  tone={
                    s.status === 'success'
                      ? 'success'
                      : s.status === 'at_risk'
                        ? 'danger'
                        : 'neutral'
                  }
                  size="sm"
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TrendCell({
  trend,
}: {
  trend: { previousAverage: number | null; delta: number | null } | null;
}) {
  if (!trend || trend.delta === null) {
    return <span className="text-xs text-slate-400">—</span>;
  }
  const { delta } = trend;
  if (delta > 0) {
    return (
      <span className="inline-flex items-center justify-end gap-1 font-mono text-xs font-bold tabular-nums text-emerald-600">
        <TrendingUp className="h-3.5 w-3.5" />+{delta.toFixed(2)}
      </span>
    );
  }
  if (delta < 0) {
    return (
      <span className="inline-flex items-center justify-end gap-1 font-mono text-xs font-bold tabular-nums text-rose-600">
        <TrendingDown className="h-3.5 w-3.5" />
        {delta.toFixed(2)}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center justify-end gap-1 font-mono text-xs font-bold tabular-nums text-slate-500">
      <Minus className="h-3.5 w-3.5" />
      0.00
    </span>
  );
}
