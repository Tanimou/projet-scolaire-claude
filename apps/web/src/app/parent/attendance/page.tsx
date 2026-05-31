import {
  AlertTriangle,
  CalendarCheck2,
  CheckCircle2,
  Clock,
  FileWarning,
  Sparkles,
  UserX,
} from 'lucide-react';
import type { Metadata } from 'next';

import { PortalShell } from '@/components/PortalShell';
import { api, ApiError } from '@/lib/api-client';
import {
  EmptyState,
  KpiCard,
  PageHeader,
  Pagination,
  ProgressBar,
  StatusBadge,
  SubjectChip,
  formatDateLong,
  formatPercent,
} from '@pilotage/ui';

import { ChildSelector } from '../_components/ChildSelector';
import { AttendanceCalendar, type CalendarRecord } from './AttendanceCalendar';
import { AttendanceFilters } from './AttendanceFilters';
import type {
  AttendancePeriod,
  AttendanceRecord,
  AttendanceResp,
  AttendanceStatus,
  AttendanceStatusFilter,
  SubjectOption,
} from './types';

export const metadata: Metadata = { title: 'Absences et retards' };
export const dynamic = 'force-dynamic';

interface StudentSummary {
  id: string;
  firstName: string;
  lastName: string;
}

async function safe<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (err) {
    if (err instanceof ApiError) return null;
    throw err;
  }
}

const STATUS_LABEL: Record<AttendanceStatus, string> = {
  present: 'Présent',
  absent: 'Absent',
  absent_excused: 'Absent (justifié)',
  late: 'Retard',
  left_early: 'Parti·e tôt',
};

const STATUS_TONE: Record<AttendanceStatus, 'success' | 'danger' | 'sky' | 'warning'> = {
  present: 'success',
  absent: 'danger',
  absent_excused: 'sky',
  late: 'warning',
  left_early: 'warning',
};

const PAGE_SIZE = 25;
const VALID_PERIODS: AttendancePeriod[] = ['all', 'month', '30d', '90d'];
const VALID_STATUS: AttendanceStatusFilter[] = [
  'absent_unjustified',
  'absent',
  'absent_excused',
  'late',
  'left_early',
  'present',
];

function startOfMonth(now: Date): Date {
  const d = new Date(now.getFullYear(), now.getMonth(), 1);
  d.setHours(0, 0, 0, 0);
  return d;
}

function daysAgo(n: number, now: Date): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d;
}

/** "2026-05" → "mai 2026" (capitalized first letter). */
function monthLabel(date: Date): string {
  const raw = date.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/** Presence-rate tone — green > 95, amber 90-95, rose < 90. */
function rateTone(rate: number): 'green' | 'amber' | 'rose' {
  if (rate >= 95) return 'green';
  if (rate >= 90) return 'amber';
  return 'rose';
}

function progressToneForRate(
  rate: number,
): 'success' | 'warning' | 'danger' {
  if (rate >= 95) return 'success';
  if (rate >= 90) return 'warning';
  return 'danger';
}

interface SubjectBreakdownRow {
  subjectId: string;
  subjectName: string;
  color: string | null;
  total: number;
  absent: number;
  late: number;
  rate: number;
}

function computeSubjectBreakdown(records: AttendanceRecord[]): SubjectBreakdownRow[] {
  const bySubject = new Map<string, SubjectBreakdownRow>();
  for (const r of records) {
    const subj = r.classSession.teachingAssignment?.subject;
    if (!subj) continue;
    const key = subj.id;
    const cur = bySubject.get(key) ?? {
      subjectId: subj.id,
      subjectName: subj.name,
      color: subj.color,
      total: 0,
      absent: 0,
      late: 0,
      rate: 100,
    };
    cur.total += 1;
    if (r.status === 'absent' || r.status === 'absent_excused') cur.absent += 1;
    if (r.status === 'late' || r.status === 'left_early') cur.late += 1;
    bySubject.set(key, cur);
  }
  for (const row of bySubject.values()) {
    const present = row.total - row.absent;
    row.rate = row.total > 0 ? (present / row.total) * 100 : 100;
  }
  return Array.from(bySubject.values())
    .filter((s) => s.absent + s.late > 0)
    .sort((a, b) => b.absent + b.late * 0.5 - (a.absent + a.late * 0.5))
    .slice(0, 5);
}

export default async function ParentAttendancePage({
  searchParams,
}: {
  searchParams: Promise<{
    studentId?: string;
    page?: string;
    period?: string;
    status?: string;
    subjectId?: string;
    q?: string;
  }>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? '1', 10) || 1);
  const period: AttendancePeriod = VALID_PERIODS.includes(sp.period as AttendancePeriod)
    ? (sp.period as AttendancePeriod)
    : 'all';
  const statusFilter: AttendanceStatusFilter =
    sp.status && VALID_STATUS.includes(sp.status as AttendanceStatusFilter)
      ? (sp.status as AttendanceStatusFilter)
      : '';
  const search = (sp.q ?? '').trim().toLowerCase();

  const studentsResp = await safe(
    api<{ data: StudentSummary[] }>('/api/v1/students', { cache: 'no-store' }),
  );
  const children = studentsResp?.data ?? [];

  if (children.length === 0) {
    return (
      <PortalShell portal="parent">
        <PageHeader
          breadcrumb={[
            { label: 'Tableau de bord', href: '/parent/dashboard' },
            { label: 'Absences et retards' },
          ]}
          title="Absences et retards"
        />
        <EmptyState
          icon={UserX}
          title="Aucun enfant rattaché"
          description="Les présences et absences apparaîtront ici dès qu'un enfant sera lié à votre compte."
          tone="amber"
          className="mt-6"
        />
      </PortalShell>
    );
  }

  const activeStudentId =
    sp.studentId && children.find((c) => c.id === sp.studentId)
      ? sp.studentId
      : children[0]!.id;

  const resp = await safe(
    api<AttendanceResp>(`/api/v1/attendance/students/${activeStudentId}`, {
      cache: 'no-store',
    }),
  );
  const allRecords: AttendanceRecord[] = resp?.records ?? [];
  const apiSummary = resp?.summary ?? {
    total: 0,
    present: 0,
    absent: 0,
    absentExcused: 0,
    late: 0,
    leftEarly: 0,
  };

  // Derive subjects (for filter dropdown) from what the parent can actually see.
  const subjectMap = new Map<string, SubjectOption>();
  for (const r of allRecords) {
    const s = r.classSession.teachingAssignment?.subject;
    if (s && !subjectMap.has(s.id)) {
      subjectMap.set(s.id, { id: s.id, name: s.name, color: s.color });
    }
  }
  const subjects = Array.from(subjectMap.values()).sort((a, b) =>
    a.name.localeCompare(b.name, 'fr'),
  );
  const activeSubjectId =
    sp.subjectId && subjectMap.has(sp.subjectId) ? sp.subjectId : '';

  // KPI computation — stable, NOT influenced by filters (intentional: parents
  // need a steady global picture even when they slice by status/subject).
  const totalAll = apiSummary.total || allRecords.length;
  const presentAll = apiSummary.present;
  const presenceRate = totalAll > 0 ? (presentAll / totalAll) * 100 : 100;
  const absencesAll = apiSummary.absent + apiSummary.absentExcused;
  const unjustifiedAll = allRecords.filter(
    (r) => r.status === 'absent' && !r.justifiedAt,
  ).length;
  const lateAll = apiSummary.late + apiSummary.leftEarly;

  // 30-day window for the "tendance récente" hint.
  const now = new Date();
  const thirtyAgo = daysAgo(30, now);
  const last30 = allRecords.filter((r) => new Date(r.classSession.date) >= thirtyAgo);
  const last30Total = last30.length;
  const last30Present = last30.filter((r) => r.status === 'present').length;
  const last30Rate = last30Total > 0 ? (last30Present / last30Total) * 100 : null;
  const recentDelta = last30Rate != null ? Number((last30Rate - presenceRate).toFixed(1)) : null;

  // Subject breakdown over the full history.
  const subjectBreakdown = computeSubjectBreakdown(allRecords);

  // Lightweight records for the monthly heatmap (rendered client-side so month
  // navigation is instant). Reuses the data already fetched — no extra request.
  const calendarRecords: CalendarRecord[] = allRecords.map((r) => ({
    date: r.classSession.date,
    status: r.status,
    justified: r.justifiedAt != null,
  }));

  // Apply filters: period → status → subject → search.
  const monthStart = startOfMonth(now);
  const ninetyAgo = daysAgo(90, now);
  const filtered = allRecords
    .filter((r) => {
      const d = new Date(r.classSession.date);
      if (period === 'month') return d >= monthStart;
      if (period === '30d') return d >= thirtyAgo;
      if (period === '90d') return d >= ninetyAgo;
      return true;
    })
    .filter((r) => {
      if (!statusFilter) return true;
      if (statusFilter === 'absent_unjustified') {
        return r.status === 'absent' && !r.justifiedAt;
      }
      if (statusFilter === 'absent') {
        return r.status === 'absent' || r.status === 'absent_excused';
      }
      return r.status === statusFilter;
    })
    .filter((r) =>
      activeSubjectId
        ? r.classSession.teachingAssignment?.subject.id === activeSubjectId
        : true,
    )
    .filter((r) => {
      if (!search) return true;
      const subj = r.classSession.teachingAssignment?.subject;
      const cs = r.classSession.teachingAssignment?.classSection;
      const hay = [subj?.name ?? '', cs?.name ?? '', r.comment ?? '', r.justification ?? '']
        .join(' ')
        .toLowerCase();
      return hay.includes(search);
    });

  // Group filtered records by month (already date-desc from the API).
  const groups: Array<{ key: string; label: string; rows: AttendanceRecord[] }> = [];
  for (const r of filtered) {
    const d = new Date(r.classSession.date);
    const k = monthKey(d);
    let group = groups[groups.length - 1];
    if (!group || group.key !== k) {
      group = { key: k, label: monthLabel(d), rows: [] };
      groups.push(group);
    }
    group.rows.push(r);
  }

  const total = filtered.length;
  const startIdx = (page - 1) * PAGE_SIZE;
  const endIdx = startIdx + PAGE_SIZE;

  // Slice across groups so pagination still works with section headers.
  let seen = 0;
  const pageGroups: Array<{ key: string; label: string; rows: AttendanceRecord[]; absences: number }> = [];
  for (const g of groups) {
    if (seen >= endIdx) break;
    const rows: AttendanceRecord[] = [];
    for (const r of g.rows) {
      if (seen >= startIdx && seen < endIdx) rows.push(r);
      seen++;
    }
    if (rows.length > 0) {
      const absences = g.rows.filter(
        (r) => r.status === 'absent' || r.status === 'absent_excused',
      ).length;
      pageGroups.push({ key: g.key, label: g.label, rows, absences });
    }
  }

  // Active filter chips summary.
  const activeFilterChips: string[] = [];
  if (period === 'month') activeFilterChips.push('Ce mois-ci');
  if (period === '30d') activeFilterChips.push('30 derniers jours');
  if (period === '90d') activeFilterChips.push('90 derniers jours');
  if (statusFilter) {
    const labels: Record<Exclude<AttendanceStatusFilter, ''>, string> = {
      absent_unjustified: 'À justifier',
      absent: 'Absences (toutes)',
      absent_excused: 'Justifiées',
      late: 'Retards',
      left_early: 'Départs anticipés',
      present: 'Présences',
    };
    activeFilterChips.push(labels[statusFilter]);
  }
  if (activeSubjectId && subjectMap.has(activeSubjectId)) {
    activeFilterChips.push(`Matière : ${subjectMap.get(activeSubjectId)!.name}`);
  }
  if (search) activeFilterChips.push(`Recherche : « ${search} »`);

  const headerSubtitle =
    totalAll > 0
      ? `Historique d'assiduité sur ${totalAll} séance${totalAll > 1 ? 's' : ''} — pensez à transmettre les justificatifs sous 48 h`
      : "Les présences et retards apparaîtront ici dès que les enseignants feront l'appel";

  return (
    <PortalShell portal="parent">
      <PageHeader
        breadcrumb={[
          { label: 'Tableau de bord', href: '/parent/dashboard' },
          { label: 'Absences et retards' },
        ]}
        title="Absences et retards"
        subtitle={headerSubtitle}
      />

      <div className="mt-4">
        <ChildSelector items={children} activeStudentId={activeStudentId} />
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          icon={CheckCircle2}
          tone={rateTone(presenceRate)}
          label="TAUX DE PRÉSENCE"
          value={totalAll > 0 ? formatPercent(presenceRate, 1) : '—'}
          delta={recentDelta ?? undefined}
          deltaSuffix=" pts"
          deltaPeriod="30 derniers jours"
        >
          {presentAll} présence{presentAll > 1 ? 's' : ''} sur {totalAll} séance
          {totalAll > 1 ? 's' : ''}
        </KpiCard>
        <KpiCard icon={UserX} tone="rose" label="ABSENCES" value={absencesAll}>
          {apiSummary.absentExcused} justifiée{apiSummary.absentExcused > 1 ? 's' : ''} ·{' '}
          {apiSummary.absent} non justifiée{apiSummary.absent > 1 ? 's' : ''}
        </KpiCard>
        <KpiCard icon={Clock} tone="amber" label="RETARDS" value={lateAll}>
          {apiSummary.leftEarly} départ{apiSummary.leftEarly > 1 ? 's' : ''} anticipé
          {apiSummary.leftEarly > 1 ? 's' : ''}
        </KpiCard>
        <KpiCard
          icon={FileWarning}
          tone={unjustifiedAll > 0 ? 'orange' : 'slate'}
          label="À JUSTIFIER"
          value={unjustifiedAll}
        >
          {unjustifiedAll > 0
            ? 'Pensez à transmettre un mot d’excuse'
            : 'Aucune absence en attente'}
        </KpiCard>
      </div>

      {/* Unjustified absences alert strip */}
      {unjustifiedAll > 0 && (
        <div className="mt-4 flex items-start gap-3 rounded-2xl border border-orange-200 bg-orange-50/70 p-4">
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-orange-100 text-orange-600">
            <AlertTriangle className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1 text-sm text-orange-900">
            <p className="font-bold">
              {unjustifiedAll} absence{unjustifiedAll > 1 ? 's' : ''} en attente de
              justification
            </p>
            <p className="mt-0.5 text-xs text-orange-800/80">
              Les absences non justifiées peuvent déclencher une alerte automatique. Transmettez un
              justificatif à l’école (mot d’excuse, certificat médical) dès que possible.
            </p>
          </div>
        </div>
      )}

      {/* Monthly attendance heatmap — at-a-glance read of the term's rhythm */}
      {allRecords.length > 0 && (
        <div className="mt-6">
          <AttendanceCalendar records={calendarRecords} />
        </div>
      )}

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Filters + records (2/3) */}
        <div className="lg:col-span-2">
          <AttendanceFilters
            subjects={subjects}
            period={period}
            status={statusFilter}
            subjectId={activeSubjectId}
            q={search}
          />

          <section className="mt-4 space-y-6">
            {pageGroups.length === 0 ? (
              <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/60">
                <EmptyState
                  icon={allRecords.length === 0 ? CheckCircle2 : CalendarCheck2}
                  title={
                    allRecords.length === 0
                      ? 'Aucune absence enregistrée'
                      : 'Aucun enregistrement avec ces filtres'
                  }
                  description={
                    allRecords.length === 0
                      ? "L'historique des présences et absences apparaîtra ici quand les enseignants feront l'appel."
                      : 'Élargissez la période, retirez un filtre, ou videz la recherche pour voir plus de résultats.'
                  }
                  tone="slate"
                />
              </div>
            ) : (
              pageGroups.map((g) => (
                <article
                  key={g.key}
                  className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/60"
                >
                  <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/60 px-4 py-2.5">
                    <h3 className="text-sm font-bold text-slate-700">{g.label}</h3>
                    <div className="flex items-center gap-2 text-[11px] text-slate-500">
                      <span>
                        {g.rows.length} ligne{g.rows.length > 1 ? 's' : ''}
                      </span>
                      {g.absences > 0 && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 font-semibold text-rose-700">
                          <UserX className="h-3 w-3" />
                          {g.absences} abs.
                        </span>
                      )}
                    </div>
                  </header>
                  <ul className="divide-y divide-slate-100">
                    {g.rows.map((r) => {
                      const subj = r.classSession.teachingAssignment?.subject;
                      const cs = r.classSession.teachingAssignment?.classSection;
                      const needsJustification = r.status === 'absent' && !r.justifiedAt;
                      return (
                        <li
                          key={r.id}
                          className={
                            needsJustification
                              ? 'flex flex-wrap items-center gap-3 bg-orange-50/30 px-4 py-3 hover:bg-orange-50/50'
                              : 'flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-slate-50/60'
                          }
                        >
                          <div className="min-w-[110px] text-xs font-bold text-slate-700">
                            {formatDateLong(r.classSession.date)}
                          </div>
                          <div className="flex min-w-0 flex-1 items-center gap-2">
                            {subj ? (
                              <SubjectChip
                                subjectCode={subj.name}
                                label={subj.name}
                                size="sm"
                              />
                            ) : (
                              <span className="text-xs text-slate-400">Matière inconnue</span>
                            )}
                            {cs && (
                              <span className="text-[11px] text-slate-500">{cs.name}</span>
                            )}
                          </div>
                          <StatusBadge
                            label={STATUS_LABEL[r.status]}
                            tone={STATUS_TONE[r.status]}
                            size="sm"
                            withDot
                          />
                          <div className="basis-full text-[11px] text-slate-600 sm:basis-auto sm:min-w-[180px] sm:text-right">
                            {r.justifiedAt ? (
                              <span className="inline-flex items-center gap-1 text-emerald-700">
                                <CheckCircle2 className="h-3 w-3" />
                                {r.justification ?? 'Justifiée'}
                              </span>
                            ) : needsJustification ? (
                              <span className="font-semibold text-orange-700">
                                À justifier
                              </span>
                            ) : r.status === 'late' ? (
                              <span className="text-slate-500">
                                {r.arrivedAt ? `Arrivée ${r.arrivedAt}` : 'Retard'}
                              </span>
                            ) : r.comment ? (
                              <span className="text-slate-500">{r.comment}</span>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </article>
              ))
            )}

            {total > PAGE_SIZE && (
              <Pagination
                page={page}
                total={total}
                pageSize={PAGE_SIZE}
                itemLabel={{ singular: 'enregistrement', plural: 'enregistrements' }}
              />
            )}
          </section>

          {activeFilterChips.length > 0 && (
            <p className="mt-4 text-[11px] text-slate-500">
              Filtres actifs :{' '}
              {activeFilterChips.map((chip, idx) => (
                <span key={chip}>
                  <span className="font-bold text-slate-700">{chip}</span>
                  {idx < activeFilterChips.length - 1 && (
                    <span className="text-slate-400"> · </span>
                  )}
                </span>
              ))}
            </p>
          )}
        </div>

        {/* Subject breakdown (1/3) */}
        <aside className="lg:col-span-1">
          <div className="sticky top-4 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/60">
            <header className="flex items-center gap-2 border-b border-slate-100 bg-slate-50/60 px-4 py-3">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-violet-100 text-violet-600">
                <Sparkles className="h-4 w-4" />
              </span>
              <div>
                <h3 className="text-sm font-bold text-slate-800">Top matières concernées</h3>
                <p className="text-[11px] text-slate-500">
                  Là où les absences et retards s’accumulent
                </p>
              </div>
            </header>
            <div className="px-4 py-3">
              {subjectBreakdown.length === 0 ? (
                <p className="py-6 text-center text-xs text-slate-500">
                  Aucune absence ou retard enregistré — rien à signaler ici.
                </p>
              ) : (
                <ul className="space-y-3">
                  {subjectBreakdown.map((s) => (
                    <li key={s.subjectId} className="space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <SubjectChip subjectCode={s.subjectName} label={s.subjectName} size="sm" />
                          <span className="text-[11px] text-slate-500">
                            {s.total} séance{s.total > 1 ? 's' : ''}
                          </span>
                        </div>
                        <span className="font-mono text-xs font-bold tabular-nums text-slate-700">
                          {formatPercent(s.rate, 0)}
                        </span>
                      </div>
                      <ProgressBar
                        value={s.rate}
                        max={100}
                        tone={progressToneForRate(s.rate)}
                        height={6}
                      />
                      <div className="flex items-center gap-3 text-[11px] text-slate-500">
                        {s.absent > 0 && (
                          <span className="inline-flex items-center gap-1 text-rose-700">
                            <UserX className="h-3 w-3" />
                            {s.absent} abs.
                          </span>
                        )}
                        {s.late > 0 && (
                          <span className="inline-flex items-center gap-1 text-amber-700">
                            <Clock className="h-3 w-3" />
                            {s.late} ret.
                          </span>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <footer className="border-t border-slate-100 bg-slate-50/60 px-4 py-2.5">
              <p className="text-[10px] uppercase tracking-wider text-slate-400">
                Calculé sur tout l’historique
              </p>
            </footer>
          </div>
        </aside>
      </div>
    </PortalShell>
  );
}
