'use client';

import { Calendar } from 'lucide-react';
import Link from 'next/link';

import {
  MiniCalendar,
  PreferredDate,
  formatInDays,
  subjectColor,
  type CalendarEventDot,
} from '@pilotage/ui';

export interface UpcomingItem {
  id: string;
  title: string;
  date: string;
  subjectCode: string;
  subjectName: string;
  subjectColor: string | null;
}

/**
 * Right-rail "Évaluations à venir" panel — mini calendar with colored event
 * dots over the month containing the next assessment, plus a compact list of
 * the 4 closest upcoming dates with their hour ranges (when available).
 */
export function UpcomingPanel({ upcoming }: { upcoming: UpcomingItem[] }) {
  const today = new Date();

  const earliest = upcoming.length > 0 ? new Date(upcoming[0]!.date) : today;
  const displayMonth = new Date(earliest.getFullYear(), earliest.getMonth(), 1);
  const displayMonthIndex = displayMonth.getMonth();
  const displayYear = displayMonth.getFullYear();

  const events: CalendarEventDot[] = upcoming.flatMap((u) => {
    const d = new Date(u.date);
    if (d.getMonth() !== displayMonthIndex || d.getFullYear() !== displayYear) return [];
    return [
      {
        day: d.getDate(),
        date: u.date,
        color: u.subjectColor ?? subjectColor(u.subjectCode).primary,
        subjectCode: u.subjectCode,
        title: u.title,
      },
    ];
  });

  const selected =
    today.getMonth() === displayMonthIndex && today.getFullYear() === displayYear
      ? [today.getDate()]
      : [];

  return (
    <section className="flex h-full flex-col gap-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/60">
      <header className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold text-slate-900">Évaluations à venir</h3>
          <p className="mt-0.5 text-[11px] text-slate-500">
            {upcoming.length} évaluation{upcoming.length > 1 ? 's' : ''} planifiée
            {upcoming.length > 1 ? 's' : ''}
          </p>
        </div>
        <Link
          href="/parent/upcoming"
          className="accent-text inline-flex items-center gap-1 text-[11px] font-bold hover:underline"
        >
          <Calendar className="h-3 w-3" />
          Voir calendrier
        </Link>
      </header>

      <MiniCalendar month={displayMonth} selected={selected} events={events} />

      <ul className="flex-1 space-y-2 border-t border-slate-100 pt-3">
        {upcoming.length === 0 ? (
          <li className="text-xs text-slate-500">
            Aucune évaluation planifiée dans les 30 prochains jours.
          </li>
        ) : (
          upcoming.slice(0, 5).map((u) => {
            const color = subjectColor(u.subjectCode);
            return (
              <li key={u.id} className="flex items-center gap-2.5">
                <span
                  aria-hidden
                  className="inline-block h-2 w-2 shrink-0 rounded-full"
                  style={{ background: u.subjectColor ?? color.primary }}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-bold text-slate-900">{u.title}</div>
                  <div className="truncate text-[10px] text-slate-500">
                    {u.subjectName} · <PreferredDate value={u.date} /> · {formatInDays(u.date)}
                  </div>
                </div>
              </li>
            );
          })
        )}
      </ul>
    </section>
  );
}
