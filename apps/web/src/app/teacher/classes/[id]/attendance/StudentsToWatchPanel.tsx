import { CheckCircle2, Clock, ShieldAlert, UserMinus, X } from 'lucide-react';

import { AvatarNameCell, EmptyState, ProgressBar } from '@pilotage/ui';

import type { AttendanceStudentRow } from './types';

type Severity = 'critical' | 'warning' | 'note';

interface Watched extends AttendanceStudentRow {
  totalIssues: number;
  presenceRate: number;
  severity: Severity;
}

function severityOf(rate: number, absences: number): Severity {
  if (absences >= 3 || rate < 75) return 'critical';
  if (absences >= 2 || rate < 90) return 'warning';
  return 'note';
}

interface Props {
  students: AttendanceStudentRow[];
  totalSessions: number;
}

export function StudentsToWatchPanel({ students, totalSessions }: Props) {
  // Score each student. We highlight students who have at least one absence
  // or late, and rank by total issues then by name.
  const ranked: Watched[] = students
    .map((s) => {
      const totalIssues = s.stats.absent + s.stats.absentExcused + s.stats.late + s.stats.leftEarly;
      const recordedSessions = Math.max(s.stats.sessions, 1);
      const presenceRate = ((recordedSessions - s.stats.absent - s.stats.absentExcused) / recordedSessions) * 100;
      const severity = severityOf(presenceRate, s.stats.absent + s.stats.absentExcused);
      return { ...s, totalIssues, presenceRate, severity };
    })
    .filter((s) => s.totalIssues > 0)
    .sort((a, b) => {
      if (b.totalIssues !== a.totalIssues) return b.totalIssues - a.totalIssues;
      return a.lastName.localeCompare(b.lastName);
    })
    .slice(0, 6);

  const criticalCount = ranked.filter((s) => s.severity === 'critical').length;

  if (ranked.length === 0) {
    return (
      <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-emerald-200/60">
        <header className="flex items-center gap-2 border-b border-emerald-100 bg-emerald-50/60 px-4 py-3">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-100 text-emerald-600">
            <CheckCircle2 className="h-4 w-4" />
          </span>
          <div>
            <h3 className="text-sm font-bold text-emerald-900">Aucun élève à suivre</h3>
            <p className="text-[11px] text-emerald-800/70">
              Tous les élèves sont présents — bravo !
            </p>
          </div>
        </header>
        <EmptyState
          icon={UserMinus}
          title="Tout est en ordre"
          description={
            totalSessions > 0
              ? `Sur les ${totalSessions} dernière${totalSessions > 1 ? 's' : ''} séance${totalSessions > 1 ? 's' : ''} enregistrée${totalSessions > 1 ? 's' : ''}, aucun élève n'a accumulé d'absences ou retards.`
              : 'Vos séances apparaîtront ici dès que vous aurez fait votre premier appel.'
          }
          tone="green"
        />
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/60">
      <header className="flex items-center justify-between border-b border-slate-100 bg-slate-50/60 px-4 py-3">
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex h-8 w-8 items-center justify-center rounded-lg ${
              criticalCount > 0 ? 'bg-rose-100 text-rose-600' : 'bg-amber-100 text-amber-600'
            }`}
          >
            <UserMinus className="h-4 w-4" />
          </span>
          <div>
            <h3 className="text-sm font-bold text-slate-800">Élèves à suivre</h3>
            <p className="text-[11px] text-slate-500">
              {ranked.length} élève{ranked.length > 1 ? 's' : ''} avec absences ou retards
              {criticalCount > 0 && (
                <span className="ml-1 font-bold text-rose-700">
                  · {criticalCount} critique{criticalCount > 1 ? 's' : ''}
                </span>
              )}
            </p>
          </div>
        </div>
        <span className="text-[10px] uppercase tracking-wider text-slate-400">
          Sur {totalSessions} séance{totalSessions > 1 ? 's' : ''}
        </span>
      </header>
      <ul className="divide-y divide-slate-100">
        {ranked.map((s) => {
          const tone =
            s.severity === 'critical' ? 'danger' : s.severity === 'warning' ? 'warning' : 'info';
          return (
            <li key={s.id} className="grid grid-cols-12 gap-3 px-4 py-3">
              <div className="col-span-12 sm:col-span-5">
                <AvatarNameCell
                  firstName={s.firstName}
                  lastName={s.lastName}
                  size="sm"
                  sub={s.externalRef ? `Réf. ${s.externalRef}` : undefined}
                />
              </div>
              <div className="col-span-12 sm:col-span-4 flex items-center gap-1.5">
                {s.stats.absent > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-rose-50 px-1.5 py-0.5 text-[10px] font-bold text-rose-700">
                    <X className="h-2.5 w-2.5" />
                    {s.stats.absent} abs
                  </span>
                )}
                {s.stats.absentExcused > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">
                    <ShieldAlert className="h-2.5 w-2.5" />
                    {s.stats.absentExcused} exc
                  </span>
                )}
                {s.stats.late > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-orange-50 px-1.5 py-0.5 text-[10px] font-bold text-orange-700">
                    <Clock className="h-2.5 w-2.5" />
                    {s.stats.late} ret
                  </span>
                )}
              </div>
              <div className="col-span-12 sm:col-span-3 flex flex-col items-stretch gap-1">
                <div className="flex items-center justify-end gap-2">
                  <span className="font-mono text-xs font-bold tabular-nums text-slate-700">
                    {Math.round(s.presenceRate)} %
                  </span>
                  <span className="text-[10px] text-slate-400">présent</span>
                </div>
                <ProgressBar value={s.presenceRate} max={100} tone={tone} height={4} />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
