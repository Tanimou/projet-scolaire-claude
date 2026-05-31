import {
  Activity,
  AlertTriangle,
  Award,
  CheckCircle2,
  ClipboardList,
  GraduationCap,
  Megaphone,
  Ruler,
  Scale,
  Send,
  Sigma,
  Sparkles,
  TrendingDown,
  Users,
} from 'lucide-react';
import Link from 'next/link';

import { KpiCard, ProgressBar } from '@pilotage/ui';

import type { GradebookData } from './page';

type PerfBand = 'excellent' | 'bon' | 'correct' | 'risque' | 'unknown';

interface BandMeta {
  label: string;
  description: string;
  stripe: string;
  chip: string;
  iconBg: string;
  iconColor: string;
  /** ProgressBar fill hex */
  color: string;
}

const BAND_META: Record<PerfBand, BandMeta> = {
  excellent: {
    label: 'Excellent',
    description: '≥ 16 / 20',
    stripe: 'bg-emerald-500',
    chip: 'bg-emerald-100 text-emerald-700',
    iconBg: 'bg-emerald-100',
    iconColor: 'text-emerald-700',
    color: '#10B981',
  },
  bon: {
    label: 'Bon',
    description: 'Entre 14 et 16',
    stripe: 'bg-blue-500',
    chip: 'bg-blue-100 text-blue-700',
    iconBg: 'bg-blue-100',
    iconColor: 'text-blue-700',
    color: '#3B82F6',
  },
  correct: {
    label: 'Correct',
    description: 'Entre 10 et 14',
    stripe: 'bg-amber-500',
    chip: 'bg-amber-100 text-amber-800',
    iconBg: 'bg-amber-100',
    iconColor: 'text-amber-700',
    color: '#F59E0B',
  },
  risque: {
    label: 'À renforcer',
    description: '< 10 / 20',
    stripe: 'bg-rose-500',
    chip: 'bg-rose-100 text-rose-700',
    iconBg: 'bg-rose-100',
    iconColor: 'text-rose-700',
    color: '#F43F5E',
  },
  unknown: {
    label: 'Pas encore de moyenne',
    description: 'Aucune note publiée',
    stripe: 'bg-slate-300',
    chip: 'bg-slate-100 text-slate-600',
    iconBg: 'bg-slate-100',
    iconColor: 'text-slate-500',
    color: '#94A3B8',
  },
};

const BAND_ORDER: ReadonlyArray<PerfBand> = ['excellent', 'bon', 'correct', 'risque', 'unknown'];

type StatTone = 'emerald' | 'blue' | 'amber' | 'rose' | 'violet' | 'slate';

const TONE_CHIP: Record<StatTone, string> = {
  emerald: 'bg-emerald-100 text-emerald-700',
  blue: 'bg-blue-100 text-blue-700',
  amber: 'bg-amber-100 text-amber-800',
  rose: 'bg-rose-100 text-rose-700',
  violet: 'bg-violet-100 text-violet-700',
  slate: 'bg-slate-100 text-slate-600',
};

const TONE_ICON: Record<StatTone, string> = {
  emerald: 'bg-emerald-50 text-emerald-600 ring-emerald-100',
  blue: 'bg-blue-50 text-blue-600 ring-blue-100',
  amber: 'bg-amber-50 text-amber-600 ring-amber-100',
  rose: 'bg-rose-50 text-rose-600 ring-rose-100',
  violet: 'bg-violet-50 text-violet-600 ring-violet-100',
  slate: 'bg-slate-50 text-slate-600 ring-slate-200',
};

const KIND_LABEL: Record<string, string> = {
  written_test: 'DST',
  oral: 'Oral',
  homework: 'Maison',
  project: 'Projet',
  participation: 'Participation',
  practical: 'TP',
  other: 'Autre',
};

function bandOf(avg: number | null): PerfBand {
  if (avg == null) return 'unknown';
  if (avg >= 16) return 'excellent';
  if (avg >= 14) return 'bon';
  if (avg >= 10) return 'correct';
  return 'risque';
}

function fmt(n: number | null | undefined, suffix = '') {
  if (n === null || n === undefined) return '—';
  return `${Math.round(n * 10) / 10}${suffix}`;
}

function formatScheduled(iso: string | null): string {
  if (!iso) return 'Non daté';
  try {
    return new Date(iso).toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: 'short',
    });
  } catch {
    return 'Non daté';
  }
}

function shortName(first: string, last: string): string {
  return `${last.toUpperCase()} ${first[0] ?? ''}.`.trim();
}

export function GradebookInsights({ data }: { data: GradebookData }) {
  const { rows, assessments, classAverage } = data;
  const studentCount = rows.length;

  // ---- KPI inputs ------------------------------------------------------------
  const publishedAssessments = assessments.filter((a) => a.isPublished).length;
  const draftAssessments = assessments.length - publishedAssessments;

  const studentsWithAverage = rows.filter((r) => r.average !== null);
  const studentsAtRisk = studentsWithAverage.filter((r) => (r.average ?? 0) < 10);
  const studentsExcellent = studentsWithAverage.filter((r) => (r.average ?? 0) >= 16);
  const studentsPassing = studentsWithAverage.filter((r) => (r.average ?? 0) >= 10);
  const passRate =
    studentsWithAverage.length === 0
      ? null
      : (studentsPassing.length / studentsWithAverage.length) * 100;

  const classAvgBand = bandOf(classAverage);
  const classAvgTone =
    classAvgBand === 'excellent' || classAvgBand === 'bon'
      ? 'green'
      : classAvgBand === 'correct'
        ? 'amber'
        : classAvgBand === 'risque'
          ? 'rose'
          : 'slate';

  const passRateTone =
    passRate === null
      ? 'slate'
      : passRate >= 75
        ? 'green'
        : passRate >= 50
          ? 'amber'
          : 'rose';

  // ---- Performance distribution ---------------------------------------------
  const distribution: Array<{ band: PerfBand; count: number; pct: number }> = BAND_ORDER.map(
    (band) => {
      const count = rows.filter((r) => bandOf(r.average) === band).length;
      const pct = studentCount === 0 ? 0 : (count / studentCount) * 100;
      return { band, count, pct };
    },
  ).filter((d) => d.count > 0);

  // ---- Per-assessment summary -----------------------------------------------
  const assessmentSummaries = assessments.map((a, idx) => {
    let graded = 0;
    let absent = 0;
    let sumNormalised = 0;
    for (const row of rows) {
      const cell = row.grades[idx];
      if (!cell) continue;
      if (cell.isAbsent) {
        absent += 1;
      } else if (cell.value !== null && cell.value !== undefined) {
        graded += 1;
        sumNormalised += (cell.value / a.maxScore) * 20;
      }
    }
    const completion = studentCount === 0 ? 0 : ((graded + absent) / studentCount) * 100;
    const avg = graded === 0 ? null : sumNormalised / graded;
    return {
      assessment: a,
      graded,
      absent,
      missing: Math.max(0, studentCount - graded - absent),
      completion,
      average: avg,
    };
  });

  // Assessments with incomplete saisie (< 80%) — surface as a soft warning.
  const incompleteAssessments = assessmentSummaries.filter(
    (s) => s.completion > 0 && s.completion < 80,
  );

  // ---- Top / À renforcer -----------------------------------------------------
  const ranked = studentsWithAverage
    .slice()
    .sort((a, b) => (b.average ?? -1) - (a.average ?? -1));
  const topPerformers = ranked.slice(0, 3);
  const atRiskList = ranked
    .slice()
    .reverse()
    .filter((r) => (r.average ?? 0) < 10)
    .slice(0, 4);

  // ---- Dispersion statistics -------------------------------------------------
  // Read the *spread* of the class, not just its centre: median, range and
  // standard deviation reveal whether the cohort is homogeneous or polarised —
  // a 12/20 average can hide a class split between very strong and struggling
  // students. Computed purely from the already-loaded student averages (/20).
  const sortedAverages = studentsWithAverage
    .map((r) => r.average as number)
    .sort((a, b) => a - b);
  const statN = sortedAverages.length;
  const meanAvg =
    statN === 0 ? null : sortedAverages.reduce((s, v) => s + v, 0) / statN;
  const medianAvg =
    statN === 0
      ? null
      : statN % 2 === 1
        ? sortedAverages[(statN - 1) / 2]
        : ((sortedAverages[statN / 2 - 1] ?? 0) + (sortedAverages[statN / 2] ?? 0)) / 2;
  const minAvg = statN === 0 ? null : sortedAverages[0];
  const maxAvg = statN === 0 ? null : sortedAverages[statN - 1];
  const rangeAvg = minAvg != null && maxAvg != null ? maxAvg - minAvg : null;
  const stdDev =
    statN === 0 || meanAvg == null
      ? null
      : Math.sqrt(
          sortedAverages.reduce((s, v) => s + (v - meanAvg) ** 2, 0) / statN,
        );

  // Homogeneity reading derived from the standard deviation (points /20).
  const homogeneity =
    stdDev == null
      ? null
      : stdDev < 1.5
        ? { label: 'Très homogène', hint: 'Niveaux resserrés', tone: 'emerald' as const }
        : stdDev < 3
          ? { label: 'Homogène', hint: 'Écarts modérés', tone: 'blue' as const }
          : stdDev < 4.5
            ? { label: 'Contrastée', hint: 'Niveaux variés', tone: 'amber' as const }
            : { label: 'Très dispersée', hint: 'Forte hétérogénéité', tone: 'rose' as const };

  // Only meaningful with at least two graded students.
  const showDispersion = statN >= 2 && medianAvg != null && minAvg != null && maxAvg != null;

  const hasAssessments = assessments.length > 0;

  // ---- Empty state (no assessments) -----------------------------------------
  if (!hasAssessments) {
    return (
      <section className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
        <span
          aria-hidden
          className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-500"
        >
          <ClipboardList className="h-6 w-6" />
        </span>
        <h3 className="mt-3 text-base font-bold text-slate-900">
          Aucune évaluation pour cette classe
        </h3>
        <p className="mt-1 text-sm text-slate-500">
          Créez une première évaluation ci-dessous pour activer la saisie des notes, les
          moyennes et le suivi de la classe.
        </p>
      </section>
    );
  }

  return (
    <div className="space-y-6">
      {/* KPI strip */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard icon={Users} tone="blue" label="ÉLÈVES" value={studentCount}>
          {studentsWithAverage.length === studentCount
            ? 'Tous évalués'
            : `${studentsWithAverage.length} avec moyenne · ${
                studentCount - studentsWithAverage.length
              } sans note`}
        </KpiCard>
        <KpiCard
          icon={ClipboardList}
          tone="violet"
          label="ÉVALUATIONS"
          value={assessments.length}
        >
          {publishedAssessments} publiée{publishedAssessments > 1 ? 's' : ''}
          {draftAssessments > 0
            ? ` · ${draftAssessments} brouillon${draftAssessments > 1 ? 's' : ''}`
            : ''}
        </KpiCard>
        <KpiCard
          icon={Award}
          tone={classAvgTone}
          label="MOYENNE CLASSE"
          value={classAverage === null ? '—' : `${fmt(classAverage)} / 20`}
        >
          {classAverage === null
            ? 'Aucune note publiée'
            : classAvgBand === 'excellent'
              ? 'Niveau excellent'
              : classAvgBand === 'bon'
                ? 'Niveau solide'
                : classAvgBand === 'correct'
                  ? 'Marge de progression'
                  : 'Nécessite un accompagnement'}
        </KpiCard>
        <KpiCard
          icon={CheckCircle2}
          tone={passRateTone}
          label="TAUX DE RÉUSSITE"
          value={passRate === null ? '—' : `${Math.round(passRate)} %`}
        >
          {passRate === null
            ? 'Pas encore évaluable'
            : `${studentsPassing.length}/${studentsWithAverage.length} élèves ≥ 10/20`}
        </KpiCard>
      </div>

      {/* Action strip */}
      {(draftAssessments > 0 ||
        studentsAtRisk.length > 0 ||
        incompleteAssessments.length > 0) && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-gradient-to-r from-amber-50 via-rose-50 to-white p-4 ring-1 ring-amber-200/70">
          <span
            aria-hidden
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700"
          >
            <AlertTriangle className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1 text-sm">
            <p className="font-bold text-slate-900">
              {[
                draftAssessments > 0
                  ? `${draftAssessments} évaluation${draftAssessments > 1 ? 's' : ''} en brouillon`
                  : null,
                incompleteAssessments.length > 0
                  ? `${incompleteAssessments.length} saisie${incompleteAssessments.length > 1 ? 's' : ''} incomplète${incompleteAssessments.length > 1 ? 's' : ''}`
                  : null,
                studentsAtRisk.length > 0
                  ? `${studentsAtRisk.length} élève${studentsAtRisk.length > 1 ? 's' : ''} sous 10/20`
                  : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
            <p className="mt-0.5 text-xs text-slate-600">
              {draftAssessments > 0
                ? 'Publiez vos brouillons pour partager les notes aux familles, et complétez les saisies en cours.'
                : 'Suivez les élèves en difficulté pour leur proposer un accompagnement.'}
            </p>
          </div>
        </div>
      )}

      {/* Two-panel: distribution + top/à renforcer */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        {/* Distribution panel */}
        <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/60 xl:col-span-7">
          <header className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Distribution des élèves</h3>
              <p className="mt-0.5 text-[11px] text-slate-500">
                Répartition par moyenne consolidée sur l&apos;ensemble des évaluations publiées
              </p>
            </div>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-600">
              {studentCount} élève{studentCount > 1 ? 's' : ''}
            </span>
          </header>

          {studentsWithAverage.length === 0 ? (
            <div className="mt-5 rounded-xl bg-slate-50 p-5 text-center text-sm text-slate-500">
              <Sparkles
                className="mx-auto mb-2 h-5 w-5 text-slate-400"
                aria-hidden
              />
              Aucune moyenne disponible : publiez des notes pour visualiser la répartition.
            </div>
          ) : (
            <ul className="mt-4 space-y-3">
              {distribution.map(({ band, count, pct }) => {
                const meta = BAND_META[band];
                return (
                  <li key={band} className="flex items-center gap-3">
                    <span
                      aria-hidden
                      className={`h-7 w-1.5 shrink-0 rounded-full ${meta.stripe}`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-3 text-xs">
                        <div className="flex items-center gap-2 truncate">
                          <span className="font-bold text-slate-900">{meta.label}</span>
                          <span className="text-slate-500">· {meta.description}</span>
                        </div>
                        <span className="shrink-0 font-mono font-bold tabular-nums text-slate-900">
                          {count}{' '}
                          <span className="text-[10px] font-medium text-slate-500">
                            ({Math.round(pct)} %)
                          </span>
                        </span>
                      </div>
                      <ProgressBar
                        value={pct}
                        color={meta.color}
                        height={6}
                        ariaLabel={`${count} élève(s) dans la bande ${meta.label}`}
                        className="mt-1.5"
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Top + À renforcer */}
        <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/60 xl:col-span-5">
          <header className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Élèves à surveiller</h3>
              <p className="mt-0.5 text-[11px] text-slate-500">
                Top performances et élèves en difficulté
              </p>
            </div>
          </header>

          {/* Top */}
          <div className="mt-4">
            <h4 className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-emerald-700">
              <Sparkles className="h-3 w-3" />
              Top {topPerformers.length}
            </h4>
            {topPerformers.length === 0 ? (
              <p className="mt-1 text-xs text-slate-500">
                Aucune moyenne disponible pour le moment.
              </p>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {topPerformers.map((row, i) => (
                  <li
                    key={row.studentId}
                    className="flex items-center gap-2 rounded-lg bg-emerald-50/60 px-2.5 py-1.5"
                  >
                    <span
                      aria-hidden
                      className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-emerald-100 text-[10px] font-bold text-emerald-700"
                    >
                      {i + 1}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-xs font-bold text-slate-900">
                      {shortName(row.student.firstName, row.student.lastName)}
                    </span>
                    <span className="shrink-0 font-mono text-xs font-bold tabular-nums text-emerald-700">
                      {fmt(row.average)} / 20
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* À renforcer */}
          <div className="mt-4 border-t border-slate-100 pt-4">
            <h4 className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-rose-700">
              <TrendingDown className="h-3 w-3" />À renforcer ({atRiskList.length})
            </h4>
            {atRiskList.length === 0 ? (
              <p className="mt-1 text-xs text-emerald-700">
                ✓ Aucun élève sous 10/20 — bravo !
              </p>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {atRiskList.map((row) => (
                  <li
                    key={row.studentId}
                    className="flex items-center gap-2 rounded-lg bg-rose-50/60 px-2.5 py-1.5"
                  >
                    <span
                      aria-hidden
                      className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-rose-100 text-[10px] font-bold text-rose-700"
                    >
                      <AlertTriangle className="h-3 w-3" />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-xs font-bold text-slate-900">
                      {shortName(row.student.firstName, row.student.lastName)}
                    </span>
                    <span className="shrink-0 font-mono text-xs font-bold tabular-nums text-rose-700">
                      {fmt(row.average)} / 20
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>

      {/* Dispersion / spread of the cohort */}
      {showDispersion && (
        <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/60">
          <header className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Dispersion de la classe</h3>
              <p className="mt-0.5 text-[11px] text-slate-500">
                Au-delà de la moyenne : l&apos;étalement réel des niveaux sur 20
              </p>
            </div>
            {homogeneity && (
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                  TONE_CHIP[homogeneity.tone]
                }`}
                title={homogeneity.hint}
              >
                <Scale className="h-2.5 w-2.5" />
                {homogeneity.label}
              </span>
            )}
          </header>

          {/* 0–20 spread axis with min–max band + median & mean markers */}
          <SpreadAxis
            min={minAvg}
            max={maxAvg}
            mean={meanAvg ?? medianAvg}
            median={medianAvg}
          />

          {/* Stat cells */}
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCell
              icon={Activity}
              tone="violet"
              label="Médiane"
              value={`${fmt(medianAvg)}`}
              suffix="/ 20"
              hint="50 % des élèves au-dessus"
            />
            <StatCell
              icon={Sigma}
              tone={homogeneity?.tone ?? 'slate'}
              label="Écart-type"
              value={`${fmt(stdDev)}`}
              suffix="pts"
              hint={homogeneity?.hint ?? ''}
            />
            <StatCell
              icon={Ruler}
              tone="blue"
              label="Étendue"
              value={`${fmt(rangeAvg)}`}
              suffix="pts"
              hint={`de ${fmt(minAvg)} à ${fmt(maxAvg)}`}
            />
            <StatCell
              icon={Award}
              tone="emerald"
              label="Meilleure / + faible"
              value={`${fmt(maxAvg)}`}
              suffix={`· ${fmt(minAvg)}`}
              hint="moyennes extrêmes"
            />
          </div>
        </section>
      )}

      {/* Per-assessment summary */}
      <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/60">
        <header className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-slate-900">Par évaluation</h3>
            <p className="mt-0.5 text-[11px] text-slate-500">
              Statut de publication, moyenne sur 20 et complétude des saisies
            </p>
          </div>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-600">
            {assessments.length} évaluation{assessments.length > 1 ? 's' : ''}
          </span>
        </header>

        <ul className="mt-4 divide-y divide-slate-100">
          {assessmentSummaries.map(
            ({ assessment: a, graded, absent, missing, completion, average }) => {
              const band = bandOf(average);
              const meta = BAND_META[band];
              const completionTone =
                completion >= 100
                  ? 'success'
                  : completion >= 80
                    ? 'info'
                    : completion >= 50
                      ? 'warning'
                      : completion > 0
                        ? 'danger'
                        : 'neutral';
              return (
                <li key={a.id} className="flex flex-col gap-3 py-3 lg:flex-row lg:items-center">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Activity className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
                      <span className="text-sm font-bold text-slate-900">{a.title}</span>
                      <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-600">
                        {KIND_LABEL[a.kind] ?? a.kind}
                      </span>
                      {a.isPublished ? (
                        <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-700">
                          <CheckCircle2 className="h-2.5 w-2.5" /> Publié
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-800">
                          <Megaphone className="h-2.5 w-2.5" /> Brouillon
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                      <span>📅 {formatScheduled(a.scheduledAt)}</span>
                      <span>· /{a.maxScore}</span>
                      <span>· coef {a.effectiveCoefficient}</span>
                      {absent > 0 && (
                        <span className="text-amber-700">
                          · {absent} absent{absent > 1 ? 's' : ''}
                        </span>
                      )}
                      {missing > 0 && (
                        <span className="text-rose-600">
                          · {missing} en attente
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:gap-4 lg:w-[420px] lg:shrink-0">
                    {/* Completion bar */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-slate-500">
                        <span>Saisies</span>
                        <span className="font-mono tabular-nums">
                          {graded + absent}/{studentCount}
                          {studentCount > 0 && (
                            <span className="ml-1 text-slate-400">
                              ({Math.round(completion)} %)
                            </span>
                          )}
                        </span>
                      </div>
                      <ProgressBar
                        value={completion}
                        tone={completionTone}
                        height={6}
                        ariaLabel={`Complétude de la saisie : ${Math.round(completion)} %`}
                        className="mt-1"
                      />
                    </div>

                    {/* Average pill */}
                    <span
                      className={`inline-flex shrink-0 items-center justify-center rounded-lg px-2.5 py-1 font-mono text-xs font-bold tabular-nums ${meta.chip}`}
                      title="Moyenne normalisée sur 20"
                    >
                      {average === null ? '— / 20' : `${fmt(average)} / 20`}
                    </span>
                  </div>
                </li>
              );
            },
          )}
        </ul>
      </section>

      {/* Inline tip for next step */}
      {draftAssessments > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-gradient-to-br from-blue-50 to-violet-50 p-4 ring-1 ring-blue-200/60">
          <span
            aria-hidden
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-blue-100 text-blue-700"
          >
            <Send className="h-4 w-4" />
          </span>
          <p className="min-w-0 flex-1 text-xs text-slate-700">
            <strong className="font-bold text-slate-900">
              {draftAssessments} évaluation{draftAssessments > 1 ? 's' : ''} en brouillon
            </strong>{' '}
            — utilisez le bouton « Publier » dans le carnet ci-dessous pour rendre les notes
            visibles aux familles.
          </p>
        </div>
      )}

      {studentCount === 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-amber-50 p-4 ring-1 ring-amber-200/60">
          <span
            aria-hidden
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700"
          >
            <GraduationCap className="h-4 w-4" />
          </span>
          <p className="min-w-0 flex-1 text-xs text-amber-900">
            Aucun élève n&apos;est inscrit dans cette classe pour l&apos;année active.
            Contactez l&apos;administration pour ajouter des inscriptions.
          </p>
        </div>
      )}

      {/* Quick links to sibling workspaces */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-slate-50 p-3 ring-1 ring-slate-200">
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
          Raccourcis :
        </span>
        <Link
          href="/teacher/reports"
          className="inline-flex items-center gap-1 rounded-lg bg-white px-2.5 py-1 text-xs font-bold text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-50"
        >
          <Award className="h-3 w-3 text-violet-600" /> Rapports
        </Link>
        <Link
          href="/teacher/assessments"
          className="inline-flex items-center gap-1 rounded-lg bg-white px-2.5 py-1 text-xs font-bold text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-50"
        >
          <ClipboardList className="h-3 w-3 text-blue-600" /> Mes évaluations
        </Link>
      </div>
    </div>
  );
}

/**
 * A 0–20 axis that draws the cohort's spread as a min–max band, with the
 * median (filled bar) and mean (hollow dot) marked, plus the 10/20 pass line.
 */
function SpreadAxis({
  min,
  max,
  mean,
  median,
}: {
  min: number;
  max: number;
  mean: number;
  median: number;
}) {
  const pos = (v: number) => Math.max(0, Math.min(100, (v / 20) * 100));
  const left = pos(min);
  const width = Math.max(pos(max) - left, 0.75);

  return (
    <div className="mt-4">
      <div className="relative h-2.5 rounded-full bg-slate-100">
        {/* 10/20 pass threshold */}
        <span
          aria-hidden
          className="absolute top-1/2 h-4 w-px -translate-y-1/2 bg-slate-300"
          style={{ left: '50%' }}
        />
        {/* min–max band */}
        <span
          aria-hidden
          className="absolute top-0 h-full rounded-full bg-gradient-to-r from-rose-300 via-amber-300 to-emerald-400"
          style={{ left: `${left}%`, width: `${width}%` }}
        />
        {/* median marker */}
        <span
          aria-hidden
          className="absolute top-1/2 z-10 h-4 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-violet-600 ring-2 ring-white"
          style={{ left: `${pos(median)}%` }}
        />
        {/* mean marker */}
        <span
          aria-hidden
          className="absolute top-1/2 z-10 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-slate-700 bg-white"
          style={{ left: `${pos(mean)}%` }}
        />
      </div>

      <div className="mt-1 flex justify-between text-[9px] font-medium text-slate-400">
        <span>0</span>
        <span>10</span>
        <span>20</span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-slate-500">
        <span className="inline-flex items-center gap-1">
          <span className="h-2.5 w-1 rounded-full bg-violet-600" aria-hidden />
          Médiane {fmt(median)}
        </span>
        <span className="inline-flex items-center gap-1">
          <span
            className="h-2.5 w-2.5 rounded-full border-2 border-slate-700 bg-white"
            aria-hidden
          />
          Moyenne {fmt(mean)}
        </span>
        <span className="inline-flex items-center gap-1">
          <span
            className="h-2 w-5 rounded-full bg-gradient-to-r from-rose-300 to-emerald-400"
            aria-hidden
          />
          Min–max {fmt(min)}–{fmt(max)}
        </span>
      </div>
    </div>
  );
}

/** Compact stat tile used in the dispersion panel. */
function StatCell({
  icon: Icon,
  tone,
  label,
  value,
  suffix,
  hint,
}: {
  icon: typeof Activity;
  tone: StatTone;
  label: string;
  value: string;
  suffix?: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl bg-slate-50/70 p-3 ring-1 ring-slate-200/60">
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ring-1 ${TONE_ICON[tone]}`}
        >
          <Icon className="h-3.5 w-3.5" />
        </span>
        <span className="truncate text-[10px] font-bold uppercase tracking-wider text-slate-500">
          {label}
        </span>
      </div>
      <p className="mt-2 font-mono text-lg font-bold tabular-nums text-slate-900">
        {value}
        {suffix && (
          <span className="ml-1 text-[11px] font-medium text-slate-400">{suffix}</span>
        )}
      </p>
      {hint && (
        <p className="mt-0.5 truncate text-[10px] text-slate-500" title={hint}>
          {hint}
        </p>
      )}
    </div>
  );
}
