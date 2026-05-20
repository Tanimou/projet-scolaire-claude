'use client';

import Link from 'next/link';

import { DateCard, MiniCalendar, subjectColor, type CalendarEventDot } from '@pilotage/ui';

export interface UpcomingItem {
  id: string;
  title: string;
  date: string;
  subjectCode: string;
  subjectName: string;
  classSectionName: string;
  inDays: number;
}

export function CalendarPanel({ upcoming }: { upcoming: UpcomingItem[] }) {
  const today = new Date();

  // Build month with the most upcoming events; fallback to current month
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
        color: subjectColor(u.subjectCode).primary,
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
    <div className="space-y-4">
      {/* Mini calendar */}
      <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/60">
        <h3 className="text-sm font-bold text-slate-900">Planning des évaluations</h3>
        <div className="mt-3">
          <MiniCalendar
            month={displayMonth}
            selected={selected}
            events={events}
            legend={[{ label: 'Évaluation prévue', color: '#8B5CF6' }]}
          />
        </div>
      </section>

      {/* Prochaines évaluations */}
      <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/60">
        <h3 className="text-sm font-bold text-slate-900">Prochaines évaluations</h3>
        {upcoming.length === 0 ? (
          <p className="mt-3 text-xs text-slate-500">
            Aucune évaluation planifiée dans les 30 prochains jours.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-3">
            {upcoming.slice(0, 4).map((u) => {
              const color = subjectColor(u.subjectCode);
              return (
                <li key={u.id} className="flex items-center gap-3">
                  <DateCard
                    date={u.date}
                    style={{ background: color.tonalHex, color: color.hex }}
                    compact
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-bold text-slate-900">{u.title}</div>
                    <div className="truncate text-[11px] text-slate-500">
                      {u.subjectName} · {u.classSectionName}
                    </div>
                  </div>
                  <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">
                    {u.inDays === 0
                      ? "Aujourd'hui"
                      : u.inDays === 1
                        ? 'Demain'
                        : `Dans ${u.inDays} jours`}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        <Link
          href="/teacher/assessments"
          className="mt-3 inline-flex text-xs font-bold accent-text hover:underline"
        >
          Voir toutes les évaluations →
        </Link>
      </section>
    </div>
  );
}
