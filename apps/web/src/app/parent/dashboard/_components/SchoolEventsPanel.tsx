import {
  CalendarDays,
  Calendar as CalendarIcon,
  ChevronRight,
  ClipboardList,
  Flag,
  PartyPopper,
  School,
  Sparkles,
  Sun,
  Users,
} from 'lucide-react';
import Link from 'next/link';

import { formatInDays } from '@pilotage/ui';

import type { PortalCalendarEvent, CalendarEventType } from '@/components/calendar/PortalCalendarView';

const TYPE_LABEL: Record<CalendarEventType, string> = {
  vacation_break: 'Vacances',
  public_holiday: 'Jour férié',
  exam_period: 'Examens',
  meeting: 'Réunion',
  ceremony: 'Cérémonie',
  pedagogical_day: 'Journée pédagogique',
  custom: 'Événement',
};

const TYPE_TONE: Record<CalendarEventType, string> = {
  vacation_break: 'bg-amber-50 text-amber-800 border-amber-200',
  public_holiday: 'bg-rose-50 text-rose-800 border-rose-200',
  exam_period: 'bg-violet-50 text-violet-800 border-violet-200',
  meeting: 'bg-blue-50 text-blue-800 border-blue-200',
  ceremony: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  pedagogical_day: 'bg-cyan-50 text-cyan-800 border-cyan-200',
  custom: 'bg-slate-50 text-slate-800 border-slate-200',
};

const TYPE_SOLID: Record<CalendarEventType, string> = {
  vacation_break: 'bg-amber-500',
  public_holiday: 'bg-rose-500',
  exam_period: 'bg-violet-500',
  meeting: 'bg-blue-500',
  ceremony: 'bg-emerald-500',
  pedagogical_day: 'bg-cyan-500',
  custom: 'bg-slate-500',
};

const TYPE_ICON: Record<CalendarEventType, typeof Sun> = {
  vacation_break: Sun,
  public_holiday: Flag,
  exam_period: ClipboardList,
  meeting: Users,
  ceremony: PartyPopper,
  pedagogical_day: Sparkles,
  custom: CalendarIcon,
};

function scopeLabel(event: PortalCalendarEvent): string {
  if (event.classSection) return `Classe ${event.classSection.name}`;
  if (event.gradeLevel) return `Niveau ${event.gradeLevel.name}`;
  if (event.cycle) return `Cycle ${event.cycle.name}`;
  return "Toute l'école";
}

/**
 * Surfaces the next school-wide calendar events (vacances, jours fériés,
 * examens, réunions, cérémonies) on the parent dashboard so families don't have
 * to open the dedicated calendar page to learn what's coming up.
 *
 * Renders nothing when no upcoming event exists — the school may not have set up
 * a calendar yet, and an empty card would only add noise.
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
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 text-white shadow-sm shadow-blue-500/30">
            <CalendarDays className="h-4 w-4" />
          </span>
          <div>
            <h3 className="text-sm font-bold text-slate-900">Prochains événements scolaires</h3>
            <p className="mt-0.5 text-[11px] text-slate-500">
              Vacances, jours fériés, examens et événements de l&apos;établissement
            </p>
          </div>
        </div>
        <Link
          href="/parent/calendar"
          className="accent-text inline-flex shrink-0 items-center gap-1 text-[11px] font-bold hover:underline"
        >
          Voir le calendrier
          <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      </header>

      <ul className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {upcoming.map((e) => {
          const Icon = TYPE_ICON[e.type];
          const start = new Date(e.startsAt);
          const isImminent = start.getTime() - now <= 7 * 24 * 60 * 60 * 1000;
          return (
            <li key={e.id} className="group">
              <Link
                href="/parent/calendar"
                className="flex h-full flex-col gap-2 rounded-xl border border-slate-200/80 bg-slate-50/50 p-3 transition-all hover:-translate-y-0.5 hover:border-slate-300 hover:bg-white hover:shadow-sm"
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg text-white ${TYPE_SOLID[e.type]}`}
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
                    className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-bold ${TYPE_TONE[e.type]}`}
                  >
                    {TYPE_LABEL[e.type]}
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
                  <span className="truncate">{scopeLabel(e)}</span>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
