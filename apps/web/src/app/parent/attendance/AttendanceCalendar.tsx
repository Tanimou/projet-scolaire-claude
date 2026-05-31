'use client';

import { CalendarRange, ChevronLeft, ChevronRight } from 'lucide-react';
import { useMemo, useState } from 'react';

import type { AttendanceStatus } from './types';

/**
 * Lightweight per-session record handed to the calendar. The page maps the
 * heavier `AttendanceRecord` down to this so the client bundle stays small.
 */
export interface CalendarRecord {
  /** ISO date of the class session (day granularity is all we use). */
  date: string;
  status: AttendanceStatus;
  /** Whether a justification has been filed (derived from `justifiedAt`). */
  justified: boolean;
}

/**
 * The aggregate "worst" state of a single day, worst-first. A day can hold
 * several sessions with mixed statuses; we surface the most actionable one so
 * the colour at a glance always reflects what a parent should care about.
 */
type DayState =
  | 'none'
  | 'present'
  | 'late'
  | 'absent_excused'
  | 'absent_unjustified';

interface DayCell {
  /** Day-of-month number, 1-31. */
  day: number;
  /** ISO `YYYY-MM-DD` key. */
  key: string;
  state: DayState;
  total: number;
  present: number;
  absent: number;
  late: number;
  unjustified: number;
  isToday: boolean;
}

const WEEKDAYS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

const STATE_STYLE: Record<
  Exclude<DayState, 'none'>,
  { cell: string; dot: string; label: string }
> = {
  present: {
    cell: 'bg-emerald-50 ring-emerald-200 text-emerald-900 hover:bg-emerald-100',
    dot: 'bg-emerald-500',
    label: 'Présent',
  },
  late: {
    cell: 'bg-amber-50 ring-amber-200 text-amber-900 hover:bg-amber-100',
    dot: 'bg-amber-500',
    label: 'Retard / départ anticipé',
  },
  absent_excused: {
    cell: 'bg-sky-50 ring-sky-200 text-sky-900 hover:bg-sky-100',
    dot: 'bg-sky-500',
    label: 'Absence justifiée',
  },
  absent_unjustified: {
    cell: 'bg-rose-50 ring-rose-200 text-rose-900 hover:bg-rose-100',
    dot: 'bg-rose-500',
    label: 'Absence à justifier',
  },
};

const LEGEND: Array<{ state: Exclude<DayState, 'none'>; text: string }> = [
  { state: 'present', text: 'Présent' },
  { state: 'late', text: 'Retard' },
  { state: 'absent_excused', text: 'Justifiée' },
  { state: 'absent_unjustified', text: 'À justifier' },
];

/** `YYYY-MM` key for a year/month pair. */
function monthKey(year: number, month: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}`;
}

/** Local ISO `YYYY-MM-DD` for a date (avoids UTC off-by-one of toISOString). */
function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

function monthTitle(year: number, month: number): string {
  const raw = new Date(year, month, 1).toLocaleDateString('fr-FR', {
    month: 'long',
    year: 'numeric',
  });
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

/** Collapse a day's session statuses into a single worst-first state. */
function aggregate(records: CalendarRecord[]): DayState {
  if (records.length === 0) return 'none';
  let hasUnjustified = false;
  let hasExcused = false;
  let hasLate = false;
  for (const r of records) {
    if (r.status === 'absent' && !r.justified) hasUnjustified = true;
    else if (r.status === 'absent' || r.status === 'absent_excused') hasExcused = true;
    else if (r.status === 'late' || r.status === 'left_early') hasLate = true;
  }
  if (hasUnjustified) return 'absent_unjustified';
  if (hasExcused) return 'absent_excused';
  if (hasLate) return 'late';
  return 'present';
}

/**
 * Month-by-month attendance heatmap. Each day cell is coloured by its worst
 * status of the day (unjustified absence → late → justified → present), giving
 * parents an at-a-glance read of the term's rhythm that the chronological list
 * can't. Navigation is bounded to the months that actually contain data, with
 * the most recent active month selected by default. Fully client-side — it
 * reuses the records already fetched by the page, no extra round-trip.
 */
export function AttendanceCalendar({ records }: { records: CalendarRecord[] }) {
  // Group records by day once.
  const byDay = useMemo(() => {
    const map = new Map<string, CalendarRecord[]>();
    for (const r of records) {
      const key = r.date.slice(0, 10);
      const bucket = map.get(key);
      if (bucket) bucket.push(r);
      else map.set(key, [r]);
    }
    return map;
  }, [records]);

  // Sorted list of months that hold at least one record.
  const months = useMemo(() => {
    const set = new Set<string>();
    for (const key of byDay.keys()) set.add(key.slice(0, 7));
    return Array.from(set).sort();
  }, [byDay]);

  const today = new Date();
  const todayKey = dayKey(today);
  const fallbackKey = monthKey(today.getFullYear(), today.getMonth());
  const initialKey = months.length > 0 ? months[months.length - 1]! : fallbackKey;
  const [activeMonth, setActiveMonth] = useState(initialKey);

  const activeIndex = months.indexOf(activeMonth);
  const [yearStr, monthStr] = activeMonth.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr) - 1;

  // Build the calendar grid (Monday-first weeks, leading blanks for alignment).
  const cells = useMemo<Array<DayCell | null>>(() => {
    const firstDow = (new Date(year, month, 1).getDay() + 6) % 7; // Mon=0…Sun=6
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const out: Array<DayCell | null> = [];
    for (let i = 0; i < firstDow; i++) out.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
      const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const dayRecords = byDay.get(key) ?? [];
      const present = dayRecords.filter((r) => r.status === 'present').length;
      const absent = dayRecords.filter(
        (r) => r.status === 'absent' || r.status === 'absent_excused',
      ).length;
      const late = dayRecords.filter(
        (r) => r.status === 'late' || r.status === 'left_early',
      ).length;
      const unjustified = dayRecords.filter(
        (r) => r.status === 'absent' && !r.justified,
      ).length;
      out.push({
        day: d,
        key,
        state: aggregate(dayRecords),
        total: dayRecords.length,
        present,
        absent,
        late,
        unjustified,
        isToday: key === todayKey,
      });
    }
    return out;
  }, [year, month, byDay, todayKey]);

  // Visible-month summary (rate over recorded sessions only).
  const summary = useMemo(() => {
    let total = 0;
    let present = 0;
    let absent = 0;
    let late = 0;
    for (const c of cells) {
      if (!c) continue;
      total += c.total;
      present += c.present;
      absent += c.absent;
      late += c.late;
    }
    const rate = total > 0 ? Math.round((present / total) * 100) : null;
    return { total, present, absent, late, rate };
  }, [cells]);

  const canPrev = activeIndex > 0;
  const canNext = activeIndex >= 0 && activeIndex < months.length - 1;

  function go(delta: number) {
    if (activeIndex < 0) return;
    const next = activeIndex + delta;
    if (next < 0 || next >= months.length) return;
    setActiveMonth(months[next]!);
  }

  return (
    <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/60">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/60 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-blue-100 text-blue-600">
            <CalendarRange className="h-4 w-4" />
          </span>
          <div>
            <h3 className="text-sm font-bold text-slate-800">Calendrier d&apos;assiduité</h3>
            <p className="text-[11px] text-slate-500">
              Vue mensuelle — chaque jour est coloré selon son statut
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => go(-1)}
            disabled={!canPrev}
            aria-label="Mois précédent"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 ring-1 ring-slate-200 transition-colors hover:bg-white hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="min-w-[120px] text-center text-sm font-bold capitalize text-slate-700">
            {monthTitle(year, month)}
          </span>
          <button
            type="button"
            onClick={() => go(1)}
            disabled={!canNext}
            aria-label="Mois suivant"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 ring-1 ring-slate-200 transition-colors hover:bg-white hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </header>

      <div className="px-4 py-4">
        {/* Weekday header */}
        <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
          {WEEKDAYS.map((w, i) => (
            <div
              key={i}
              className={`pb-1 text-center text-[10px] font-bold uppercase tracking-wider ${
                i >= 5 ? 'text-slate-300' : 'text-slate-400'
              }`}
            >
              {w}
            </div>
          ))}
        </div>

        {/* Day grid */}
        <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
          {cells.map((cell, idx) => {
            if (!cell) return <div key={`b-${idx}`} aria-hidden />;
            if (cell.state === 'none') {
              return (
                <div
                  key={cell.key}
                  className={`flex aspect-square items-center justify-center rounded-lg text-xs font-semibold text-slate-300 ${
                    cell.isToday ? 'ring-2 ring-blue-300' : 'bg-slate-50/60'
                  }`}
                >
                  {cell.day}
                </div>
              );
            }
            const style = STATE_STYLE[cell.state];
            const tip = buildTooltip(cell);
            return (
              <div
                key={cell.key}
                title={tip}
                className={`group relative flex aspect-square flex-col items-center justify-center rounded-lg text-xs font-bold ring-1 transition-all hover:-translate-y-0.5 hover:shadow-sm ${style.cell} ${
                  cell.isToday ? 'ring-2 ring-blue-400' : ''
                }`}
              >
                <span>{cell.day}</span>
                <span className="mt-0.5 flex items-center gap-0.5">
                  <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} aria-hidden />
                  {cell.total > 1 && (
                    <span className="text-[9px] font-semibold tabular-nums opacity-70">
                      {cell.total}
                    </span>
                  )}
                </span>
              </div>
            );
          })}
        </div>

        {/* Legend + month summary */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
          <ul className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            {LEGEND.map((l) => (
              <li key={l.state} className="flex items-center gap-1.5 text-[11px] text-slate-600">
                <span className={`h-2.5 w-2.5 rounded-full ${STATE_STYLE[l.state].dot}`} aria-hidden />
                {l.text}
              </li>
            ))}
          </ul>
          {summary.total > 0 ? (
            <p className="text-[11px] text-slate-500">
              <span className="font-bold text-slate-700">{summary.rate}%</span> de présence ·{' '}
              {summary.absent > 0 && (
                <span className="font-semibold text-rose-700">{summary.absent} abs.</span>
              )}
              {summary.absent > 0 && summary.late > 0 && <span className="text-slate-300"> · </span>}
              {summary.late > 0 && (
                <span className="font-semibold text-amber-700">{summary.late} ret.</span>
              )}
              {summary.absent === 0 && summary.late === 0 && (
                <span className="font-semibold text-emerald-700">mois parfait ✨</span>
              )}
            </p>
          ) : (
            <p className="text-[11px] text-slate-400">Aucune séance enregistrée ce mois-ci</p>
          )}
        </div>
      </div>
    </section>
  );
}

/** Human-readable hover summary for a recorded day. */
function buildTooltip(cell: DayCell): string {
  const parts: string[] = [`${cell.total} séance${cell.total > 1 ? 's' : ''}`];
  if (cell.present > 0) parts.push(`${cell.present} présence${cell.present > 1 ? 's' : ''}`);
  if (cell.absent > 0) {
    const unj = cell.unjustified > 0 ? ` (dont ${cell.unjustified} à justifier)` : '';
    parts.push(`${cell.absent} absence${cell.absent > 1 ? 's' : ''}${unj}`);
  }
  if (cell.late > 0) parts.push(`${cell.late} retard${cell.late > 1 ? 's' : ''}`);
  return parts.join(' · ');
}
