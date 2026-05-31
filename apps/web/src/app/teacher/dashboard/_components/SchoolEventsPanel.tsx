import { CalendarDays, ChevronRight, School } from 'lucide-react';
import Link from 'next/link';

import { formatInDays } from '@pilotage/ui';

import {
  CALENDAR_TYPE_ICON,
  CALENDAR_TYPE_LABEL,
  CALENDAR_TYPE_SOLID,
  CALENDAR_TYPE_TONE,
  calendarScopeLabel,
} from '@/components/calendar/event-display';
import type { PortalCalendarEvent } from '@/components/calendar/PortalCalendarView';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Surfaces the next school calendar events (vacances, jours fériés, examens,
 * réunions, cérémonies, journées pédagogiques) on the teacher dashboard so staff
 * don't have to open the dedicated calendar page to learn what's coming up.
 *
 * The /calendar/events endpoint already ABAC-scopes results server-side — teachers
 * receive visibility "all" + "staff_only" — so no extra gating is needed here.
 *
 * Renders nothing when no upcoming event exists; an empty card would only add noise.
 */
export function SchoolEventsPanel({ events }: { events: PortalCalendarEvent[] }) {
  const now = Date.now();
  const upcoming = events
    .filter((e) => new Date(e.endsAt).getTime() >= now)
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())
    .slice(0, 6);

  if (upcoming.length === 0) return null;

  return (
    <section className="mt-6 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/60">
      <header className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 text-white shadow-sm shadow-violet-500/30">
            <CalendarDays className="h-4 w-4" />
          </span>
          <div>
            <h3 className="text-sm font-bold text-slate-900">Vie de l&apos;école</h3>
            <p className="mt-0.5 text-[11px] text-slate-500">
              Vacances, jours fériés, examens et événements de l&apos;établissement
            </p>
          </div>
        </div>
        <Link
          href="/teacher/calendar"
          className="accent-text inline-flex shrink-0 items-center gap-1 text-[11px] font-bold hover:underline"
        >
          Voir le calendrier
          <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      </header>

      <ul className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {upcoming.map((e) => {
          const Icon = CALENDAR_TYPE_ICON[e.type];
          const start = new Date(e.startsAt);
          const startMs = start.getTime();
          // "Soon" = strictly upcoming and within a week — an event that started
          // days ago but hasn't ended yet should not be flagged as imminent.
          const isImminent = startMs >= now && startMs - now <= WEEK_MS;
          return (
            <li key={e.id} className="group">
              <Link
                href="/teacher/calendar"
                className="flex h-full flex-col gap-2 rounded-xl border border-slate-200/80 bg-slate-50/50 p-3 transition-all hover:-translate-y-0.5 hover:border-slate-300 hover:bg-white hover:shadow-sm"
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg text-white ${CALENDAR_TYPE_SOLID[e.type]}`}
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <div className="text-base font-bold leading-none tabular-nums text-slate-900">
                      {start.getDate()}
                    </div>
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                      {start.toLocaleDateString('fr-FR', { month: 'short' }).replace('.', '')}
                    </div>
                  </div>
                </div>
                <h4 className="line-clamp-2 text-xs font-bold leading-snug text-slate-900">
                  {e.title}
                </h4>
                <div className="mt-auto flex flex-wrap items-center gap-1.5">
                  <span
                    className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-bold ${CALENDAR_TYPE_TONE[e.type]}`}
                  >
                    {CALENDAR_TYPE_LABEL[e.type]}
                  </span>
                  <span
                    className={`text-[10px] font-semibold ${
                      isImminent ? 'text-rose-600' : 'text-slate-500'
                    }`}
                  >
                    {formatInDays(e.startsAt)}
                  </span>
                </div>
                <div className="flex items-center gap-1 text-[10px] font-medium text-slate-400">
                  <School className="h-3 w-3" />
                  <span className="truncate">{calendarScopeLabel(e)}</span>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
