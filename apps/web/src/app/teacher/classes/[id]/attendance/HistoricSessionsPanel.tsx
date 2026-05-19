import { CalendarCheck2, CalendarX, Check, Clock, ShieldAlert, X } from 'lucide-react';

import { EmptyState, ProgressBar } from '@pilotage/ui';

import type { AttendanceSession } from './types';

interface MonthGroup {
  key: string;
  label: string;
  sessions: AttendanceSession[];
}

function monthKey(iso: string): { key: string; label: string } {
  const d = new Date(iso);
  const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth()).padStart(2, '0')}`;
  const label = d.toLocaleDateString('fr-FR', {
    month: 'long',
    year: 'numeric',
  });
  return { key, label: label.charAt(0).toUpperCase() + label.slice(1) };
}

function presentTotal(s: AttendanceSession): number {
  return s.counts.present + s.counts.late;
}

function presenceRate(s: AttendanceSession): number | null {
  if (s.recordedTotal <= 0) return null;
  return (presentTotal(s) / s.recordedTotal) * 100;
}

function rateTone(rate: number | null): 'success' | 'info' | 'warning' | 'danger' | 'neutral' {
  if (rate == null) return 'neutral';
  if (rate >= 95) return 'success';
  if (rate >= 85) return 'info';
  if (rate >= 75) return 'warning';
  return 'danger';
}

function formatDayLabel(iso: string): { weekday: string; day: string; month: string } {
  const d = new Date(iso);
  return {
    weekday: d.toLocaleDateString('fr-FR', { weekday: 'short' }).replace('.', ''),
    day: String(d.getUTCDate()).padStart(2, '0'),
    month: d.toLocaleDateString('fr-FR', { month: 'short' }).replace('.', ''),
  };
}

function formatTimeRange(start: string | null, end: string | null): string | null {
  if (!start && !end) return null;
  if (start && end) return `${start} – ${end}`;
  return start ?? end;
}

interface Props {
  sessions: AttendanceSession[];
  activeSessionId?: string | null;
}

export function HistoricSessionsPanel({ sessions, activeSessionId }: Props) {
  if (sessions.length === 0) {
    return (
      <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/60">
        <header className="flex items-center gap-2 border-b border-slate-100 bg-slate-50/60 px-4 py-3">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-violet-100 text-violet-600">
            <CalendarCheck2 className="h-4 w-4" />
          </span>
          <div>
            <h3 className="text-sm font-bold text-slate-800">Séances précédentes</h3>
            <p className="text-[11px] text-slate-500">Historique des appels passés</p>
          </div>
        </header>
        <EmptyState
          icon={CalendarCheck2}
          title="Aucune séance enregistrée"
          description="Vos séances apparaîtront ici dès que vous aurez fait votre premier appel."
          tone="slate"
        />
      </div>
    );
  }

  // Group by month, preserving overall date-desc order.
  const groups: MonthGroup[] = [];
  for (const s of sessions) {
    const { key, label } = monthKey(s.date);
    let group = groups.find((g) => g.key === key);
    if (!group) {
      group = { key, label, sessions: [] };
      groups.push(group);
    }
    group.sessions.push(s);
  }

  return (
    <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/60">
      <header className="flex items-center justify-between border-b border-slate-100 bg-slate-50/60 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-violet-100 text-violet-600">
            <CalendarCheck2 className="h-4 w-4" />
          </span>
          <div>
            <h3 className="text-sm font-bold text-slate-800">Séances précédentes</h3>
            <p className="text-[11px] text-slate-500">
              {sessions.length} séance{sessions.length > 1 ? 's' : ''} enregistrée
              {sessions.length > 1 ? 's' : ''}
            </p>
          </div>
        </div>
      </header>
      <div className="max-h-[640px] overflow-y-auto">
        {groups.map((g) => (
          <section key={g.key}>
            <div className="sticky top-0 z-10 border-b border-slate-100 bg-slate-50/95 px-4 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500 backdrop-blur">
              <span>{g.label}</span>
              <span className="ml-2 text-slate-400">
                · {g.sessions.length} séance{g.sessions.length > 1 ? 's' : ''}
              </span>
            </div>
            <ul className="divide-y divide-slate-100">
              {g.sessions.map((s) => {
                const day = formatDayLabel(s.date);
                const timeRange = formatTimeRange(s.startTime, s.endTime);
                const rate = presenceRate(s);
                const tone = rateTone(rate);
                const isActive = activeSessionId === s.id;
                return (
                  <li
                    key={s.id}
                    className={`flex gap-3 px-4 py-3 transition ${
                      isActive ? 'bg-blue-50/40' : 'hover:bg-slate-50/60'
                    }`}
                  >
                    {/* Day pill */}
                    <div
                      className={`flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-xl text-center ${
                        s.cancelled
                          ? 'bg-slate-100 text-slate-400 line-through'
                          : isActive
                            ? 'bg-blue-100 text-blue-700'
                            : 'bg-slate-100 text-slate-700'
                      }`}
                    >
                      <span className="text-[9px] font-bold uppercase tracking-wider opacity-70">
                        {day.weekday}
                      </span>
                      <span className="font-mono text-base font-bold leading-none tabular-nums">
                        {day.day}
                      </span>
                      <span className="text-[9px] uppercase tracking-wider opacity-70">
                        {day.month}
                      </span>
                    </div>

                    <div className="min-w-0 flex-1 space-y-1.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-bold text-slate-900">
                            {s.topic || (
                              <span className="text-slate-400 italic">Sans sujet</span>
                            )}
                          </div>
                          {timeRange && (
                            <div className="font-mono text-[11px] tabular-nums text-slate-500">
                              {timeRange}
                            </div>
                          )}
                        </div>
                        {s.cancelled ? (
                          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                            <CalendarX className="h-3 w-3" />
                            Annulée
                          </span>
                        ) : s.recordedTotal === 0 ? (
                          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-700">
                            Appel à faire
                          </span>
                        ) : rate != null ? (
                          <span
                            className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[11px] font-bold tabular-nums ${
                              tone === 'success'
                                ? 'bg-emerald-100 text-emerald-700'
                                : tone === 'info'
                                  ? 'bg-blue-100 text-blue-700'
                                  : tone === 'warning'
                                    ? 'bg-amber-100 text-amber-700'
                                    : 'bg-rose-100 text-rose-700'
                            }`}
                          >
                            {Math.round(rate)} %
                          </span>
                        ) : null}
                      </div>

                      {!s.cancelled && s.recordedTotal > 0 && rate != null && (
                        <>
                          <ProgressBar value={rate} max={100} tone={tone} height={4} />
                          <div className="flex flex-wrap items-center gap-1 text-[10px]">
                            {s.counts.present > 0 && (
                              <span className="inline-flex items-center gap-0.5 rounded-md bg-emerald-50 px-1.5 py-0.5 font-bold text-emerald-700">
                                <Check className="h-2.5 w-2.5" />
                                {s.counts.present}
                              </span>
                            )}
                            {s.counts.late > 0 && (
                              <span className="inline-flex items-center gap-0.5 rounded-md bg-orange-50 px-1.5 py-0.5 font-bold text-orange-700">
                                <Clock className="h-2.5 w-2.5" />
                                {s.counts.late}
                              </span>
                            )}
                            {s.counts.absentExcused > 0 && (
                              <span className="inline-flex items-center gap-0.5 rounded-md bg-amber-50 px-1.5 py-0.5 font-bold text-amber-700">
                                <ShieldAlert className="h-2.5 w-2.5" />
                                {s.counts.absentExcused}
                              </span>
                            )}
                            {s.counts.absent > 0 && (
                              <span
                                className={`inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 font-bold ${
                                  s.unjustifiedAbsences > 0
                                    ? 'bg-rose-100 text-rose-700'
                                    : 'bg-rose-50 text-rose-600'
                                }`}
                              >
                                <X className="h-2.5 w-2.5" />
                                {s.counts.absent}
                                {s.unjustifiedAbsences > 0 && (
                                  <span className="ml-0.5 opacity-70">
                                    ({s.unjustifiedAbsences} non just.)
                                  </span>
                                )}
                              </span>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
