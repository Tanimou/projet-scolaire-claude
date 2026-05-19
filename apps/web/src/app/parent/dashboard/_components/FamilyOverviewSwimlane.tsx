import {
  AlertTriangle,
  ArrowRight,
  ChevronRight,
  GraduationCap,
  Sparkles,
  TrendingDown,
  TrendingUp,
  UserX,
} from 'lucide-react';
import Link from 'next/link';
import type { CSSProperties } from 'react';

import { Avatar, formatGrade, formatPercent, SectionHeader } from '@pilotage/ui';

export interface FamilyChildOverview {
  id: string;
  firstName: string;
  lastName: string;
  classLabel: string | null;
  cycleColor: string | null;
  studentAverage: number | null;
  classAverage: number | null;
  attendanceRate: number | null;
  progression: number | null;
  openAlerts: number;
  highAlerts: number;
  hasData: boolean;
}

export interface FamilyOverviewSwimlaneProps {
  overviews: FamilyChildOverview[];
  activeStudentId: string;
}

function gradeTone(g: number | null): string {
  if (g == null) return 'text-slate-700';
  if (g >= 16) return 'text-emerald-700';
  if (g >= 14) return 'text-sky-700';
  if (g >= 12) return 'text-blue-700';
  if (g >= 10) return 'text-amber-700';
  return 'text-rose-700';
}

function attendanceTone(r: number | null): string {
  if (r == null) return 'text-slate-700';
  if (r >= 0.95) return 'text-emerald-700';
  if (r >= 0.85) return 'text-sky-700';
  if (r >= 0.75) return 'text-amber-700';
  return 'text-rose-700';
}

/**
 * Family overview swimlane — when a parent has 2+ children attached, this
 * renders a row of compact "child cards" with the headline KPIs (average,
 * attendance, open alerts, progression delta). The active child gets an
 * accent ring; tapping another card swaps the dashboard to that child via
 * the existing `?studentId=…` URL parameter. Server-rendered links only.
 */
export function FamilyOverviewSwimlane({ overviews, activeStudentId }: FamilyOverviewSwimlaneProps) {
  if (overviews.length < 2) return null;

  const totalAlerts = overviews.reduce((acc, c) => acc + c.openAlerts, 0);
  const totalHighAlerts = overviews.reduce((acc, c) => acc + c.highAlerts, 0);
  const everyoneOk = totalAlerts === 0;

  return (
    <section className="mb-6 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/60">
      <SectionHeader
        title="Vue famille"
        subtitle={
          everyoneOk
            ? `Aperçu rapide de vos ${overviews.length} enfants — aucune alerte active`
            : `Aperçu rapide de vos ${overviews.length} enfants — ${totalAlerts} alerte${totalAlerts > 1 ? 's' : ''} active${totalAlerts > 1 ? 's' : ''}${
                totalHighAlerts > 0
                  ? ` (dont ${totalHighAlerts} critique${totalHighAlerts > 1 ? 's' : ''})`
                  : ''
              }`
        }
        compact
      />

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {overviews.map((c) => {
          const isActive = c.id === activeStudentId;
          const stripeStyle: CSSProperties = c.cycleColor
            ? { background: c.cycleColor }
            : { background: 'linear-gradient(90deg, #DBEAFE, #2563EB)' };
          const deltaTone =
            c.progression == null
              ? 'text-slate-500'
              : c.progression > 0.5
                ? 'text-emerald-700'
                : c.progression < -0.5
                  ? 'text-rose-700'
                  : 'text-slate-600';
          const ProgressionIcon =
            c.progression == null ? null : c.progression > 0 ? TrendingUp : TrendingDown;
          const alertsTone =
            c.highAlerts > 0
              ? 'text-rose-700'
              : c.openAlerts > 0
                ? 'text-amber-700'
                : 'text-emerald-700';
          const AlertsIcon =
            c.highAlerts > 0 ? AlertTriangle : c.openAlerts > 0 ? UserX : Sparkles;

          return (
            <Link
              key={c.id}
              href={`/parent/dashboard?studentId=${c.id}`}
              aria-current={isActive ? 'page' : undefined}
              className={`group relative flex flex-col overflow-hidden rounded-xl bg-white p-4 transition focus-visible:outline-none focus-visible:ring-2 ${
                isActive
                  ? 'accent-ring shadow-md ring-2'
                  : 'ring-1 ring-slate-200/60 hover:-translate-y-0.5 hover:shadow-md hover:ring-slate-300'
              }`}
            >
              {/* Cycle-color top stripe (subtle, falls back to brand gradient) */}
              <span aria-hidden className="absolute inset-x-0 top-0 h-1" style={stripeStyle} />

              {/* Header — avatar + name + class */}
              <div className="mt-1 flex items-center gap-3">
                <Avatar firstName={c.firstName} lastName={c.lastName} size="md" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-bold text-slate-900">
                    {c.firstName} {c.lastName.toUpperCase()}
                  </div>
                  <div className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-slate-500">
                    <GraduationCap className="h-3 w-3 shrink-0" aria-hidden />
                    <span className="truncate">{c.classLabel ?? 'Classe non assignée'}</span>
                  </div>
                </div>
                {isActive && (
                  <span className="accent-soft-bg accent-text inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider">
                    Actif
                  </span>
                )}
              </div>

              {/* KPI grid — 2×2 */}
              <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-slate-100 pt-3 text-[11px]">
                <div>
                  <dt className="font-bold uppercase tracking-wider text-slate-400">Moyenne</dt>
                  <dd
                    className={`mt-0.5 font-mono text-sm font-bold tabular-nums ${gradeTone(c.studentAverage)}`}
                  >
                    {c.studentAverage != null ? `${formatGrade(c.studentAverage)}/20` : '—'}
                  </dd>
                </div>
                <div>
                  <dt className="font-bold uppercase tracking-wider text-slate-400">Assiduité</dt>
                  <dd
                    className={`mt-0.5 font-mono text-sm font-bold tabular-nums ${attendanceTone(c.attendanceRate)}`}
                  >
                    {formatPercent(c.attendanceRate)}
                  </dd>
                </div>
                <div>
                  <dt className="font-bold uppercase tracking-wider text-slate-400">Alertes</dt>
                  <dd
                    className={`mt-0.5 flex items-center gap-1 font-mono text-sm font-bold tabular-nums ${alertsTone}`}
                  >
                    <AlertsIcon className="h-3.5 w-3.5" aria-hidden />
                    {c.openAlerts}
                  </dd>
                </div>
                <div>
                  <dt className="font-bold uppercase tracking-wider text-slate-400">
                    Progression
                  </dt>
                  <dd
                    className={`mt-0.5 flex items-center gap-1 font-mono text-sm font-bold tabular-nums ${deltaTone}`}
                  >
                    {ProgressionIcon && <ProgressionIcon className="h-3.5 w-3.5" aria-hidden />}
                    {c.progression != null
                      ? `${c.progression > 0 ? '+' : ''}${formatGrade(c.progression, 1)} pts`
                      : '—'}
                  </dd>
                </div>
              </dl>

              {/* Footer CTA */}
              <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3 text-[11px]">
                {c.studentAverage != null && c.classAverage != null ? (
                  <span className="text-slate-500">
                    Classe : {formatGrade(c.classAverage)}/20
                    {c.studentAverage - c.classAverage >= 0 ? (
                      <span className="ml-1 font-bold text-emerald-600">
                        (+{formatGrade(c.studentAverage - c.classAverage, 1)})
                      </span>
                    ) : (
                      <span className="ml-1 font-bold text-rose-600">
                        ({formatGrade(c.studentAverage - c.classAverage, 1)})
                      </span>
                    )}
                  </span>
                ) : (
                  <span className="text-slate-400">Pas encore de notes</span>
                )}
                <span
                  className={`inline-flex items-center gap-0.5 font-bold ${
                    isActive ? 'accent-text' : 'text-slate-500 group-hover:text-slate-900'
                  }`}
                >
                  {isActive ? 'Tableau actif' : 'Voir détail'}
                  {isActive ? (
                    <ArrowRight className="h-3 w-3" aria-hidden />
                  ) : (
                    <ChevronRight
                      className="h-3 w-3 transition group-hover:translate-x-0.5"
                      aria-hidden
                    />
                  )}
                </span>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
