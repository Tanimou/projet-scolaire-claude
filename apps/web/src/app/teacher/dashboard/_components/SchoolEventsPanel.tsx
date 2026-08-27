import {
  type CalendarAnchor,
  capList,
  eventStartMs,
  instantDateParts,
  isStartingWithinDays,
  upcomingEvents as allUpcomingEvents,
} from '@pilotage/contracts';
import { formatInDays } from '@pilotage/ui';
import { CalendarDays, ChevronRight, School } from 'lucide-react';
import Link from 'next/link';


import type { PortalCalendarEvent } from '@/components/calendar/PortalCalendarView';
import {
  CALENDAR_TYPE_ICON,
  CALENDAR_TYPE_LABEL,
  CALENDAR_TYPE_SOLID,
  CALENDAR_TYPE_TONE,
  FR_MONTHS_SHORT,
  calendarScopeLabel,
} from '@/components/calendar/event-display';

/** Nombre de cartes affichées. Le vrai total voyage dans le libellé du lien. */
const PANEL_CAP = 6;

/** Fenêtre du marqueur « imminent », en jours. */
const IMMINENT_DAYS = 7;

/**
 * Surfaces the next school calendar events (vacances, jours fériés, examens,
 * réunions, cérémonies, journées pédagogiques) on the teacher dashboard so staff
 * don't have to open the dedicated calendar page to learn what's coming up.
 *
 * The /calendar/events endpoint already ABAC-scopes results server-side — teachers
 * receive visibility "all" + "staff_only" — so no extra gating is needed here.
 *
 * Renders nothing when no upcoming event exists; an empty card would only add noise.
 *
 * ─── S-E03-8 / PF-40 ────────────────────────────────────────────────────────
 * Jumeau quasi mot-pour-mot du panneau parent, et il portait les mêmes deux
 * prédicats maison : une SIXIÈME déclaration de « à venir » et un `WEEK_MS`
 * glissant qui contredisait la semaine ISO de `/teacher/calendar`. Les deux
 * viennent maintenant de `@pilotage/contracts`, et l'ancre arrive en prop pour
 * qu'une seule horloge serve toute la requête.
 *
 * Le plafond de six cartes cesse d'être silencieux : le lien d'en-tête porte le
 * vrai total (`DNC-06`).
 */
export function SchoolEventsPanel({
  events,
  anchor,
}: {
  events: PortalCalendarEvent[];
  anchor: CalendarAnchor;
}) {
  const upcoming = capList(allUpcomingEvents(events, anchor), PANEL_CAP);

  if (upcoming.total === 0) return null;

  return (
    <section className="mt-6 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/60">
      <header className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 text-white shadow-sm shadow-violet-500/30">
            <CalendarDays className="h-4 w-4" aria-hidden />
          </span>
          <div>
            <h3 className="text-sm font-bold text-slate-900">Vie de l&apos;école</h3>
            <p className="mt-0.5 text-[11px] text-slate-600">
              Vacances, jours fériés, examens et événements de l&apos;établissement
            </p>
          </div>
        </div>
        <Link
          href="/teacher/calendar"
          className="accent-text inline-flex shrink-0 items-center gap-1 text-[11px] font-bold hover:underline"
        >
          {upcoming.truncated ? `Voir les ${upcoming.total} à venir` : 'Voir le calendrier'}
          <ChevronRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      </header>

      <ul className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {upcoming.items.map((e) => {
          const Icon = CALENDAR_TYPE_ICON[e.type];
          // Jour et mois dérivés du fuseau de l'ancre, jamais reformatés par
          // `toLocaleDateString` sans `timeZone`.
          const parts = instantDateParts(anchor, eventStartMs(e));
          const isImminent = isStartingWithinDays(e, anchor, IMMINENT_DAYS);
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
                    <Icon className="h-4 w-4" aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <div className="text-base font-bold leading-none tabular-nums text-slate-900">
                      {parts.dayOfMonth}
                    </div>
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-600">
                      {FR_MONTHS_SHORT[parts.monthIndex]}
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
                  {/* WCAG 1.4.1 — le rouge « imminent » reste doublé par le
                      texte relatif : la couleur n'est jamais le seul porteur. */}
                  <span
                    className={`text-[10px] font-semibold ${
                      isImminent ? 'text-rose-700' : 'text-slate-600'
                    }`}
                  >
                    {formatInDays(e.startsAt, anchor.nowMs)}
                  </span>
                </div>
                {/* WCAG 1.4.3 — `text-slate-400` sur blanc plafonnait à ~3,0:1
                    pour du texte non-large. `slate-600` porte 7,4:1. */}
                <div className="flex items-center gap-1 text-[10px] font-medium text-slate-600">
                  <School className="h-3 w-3" aria-hidden />
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
