'use client';

import {
  Calendar as CalendarIcon,
  CalendarCheck2,
  CalendarClock,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Flag,
  Info,
  PartyPopper,
  School,
  Sparkles,
  Sun,
  Users,
} from 'lucide-react';
import { useMemo, useState } from 'react';

import {
  DetailDrawer,
  EmptyState,
  KpiCard,
  StatusBadge,
  formatDateLong,
  formatInDays,
} from '@pilotage/ui';

export type CalendarEventType =
  | 'vacation_break'
  | 'public_holiday'
  | 'exam_period'
  | 'meeting'
  | 'ceremony'
  | 'pedagogical_day'
  | 'custom';

export type CalendarEventScope =
  | 'school_wide'
  | 'cycle_scope'
  | 'grade_level_scope'
  | 'class_section_scope';

export interface PortalCalendarEvent {
  id: string;
  title: string;
  description: string | null;
  type: CalendarEventType;
  scope: CalendarEventScope;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  color: string | null;
  cycle?: { name: string; code: string } | null;
  gradeLevel?: { name: string; code: string } | null;
  classSection?: { name: string } | null;
}

export type Portal = 'parent' | 'teacher';

interface Props {
  portal: Portal;
  events: PortalCalendarEvent[];
}

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

const FR_MONTHS = [
  'Janvier',
  'Février',
  'Mars',
  'Avril',
  'Mai',
  'Juin',
  'Juillet',
  'Août',
  'Septembre',
  'Octobre',
  'Novembre',
  'Décembre',
];

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function startOfWeek(d: Date): Date {
  // ISO week — Monday first
  const day = (d.getDay() + 6) % 7;
  const r = startOfDay(d);
  r.setDate(r.getDate() - day);
  return r;
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function eventOverlapsDay(event: PortalCalendarEvent, day: Date): boolean {
  const dayStart = startOfDay(day).getTime();
  const dayEnd = dayStart + 24 * 60 * 60 * 1000 - 1;
  const s = new Date(event.startsAt).getTime();
  const e = new Date(event.endsAt).getTime();
  return s <= dayEnd && e >= dayStart;
}

function scopeLabel(event: PortalCalendarEvent): string {
  if (event.classSection) return `Classe ${event.classSection.name}`;
  if (event.gradeLevel) return `Niveau ${event.gradeLevel.name}`;
  if (event.cycle) return `Cycle ${event.cycle.name}`;
  return "Toute l'école";
}

function formatRange(event: PortalCalendarEvent): string {
  const s = new Date(event.startsAt);
  const e = new Date(event.endsAt);
  if (sameDay(s, e)) return formatDateLong(s);
  return `${formatDateLong(s)} → ${formatDateLong(e)}`;
}

export function PortalCalendarView({ portal, events }: Props) {
  const today = startOfDay(new Date());
  const [monthOffset, setMonthOffset] = useState(0);
  const [filterType, setFilterType] = useState<CalendarEventType | 'all'>('all');
  const [selected, setSelected] = useState<PortalCalendarEvent | null>(null);

  const month = useMemo(
    () => new Date(today.getFullYear(), today.getMonth() + monthOffset, 1),
    [today, monthOffset],
  );
  const monthLabel = `${FR_MONTHS[month.getMonth()]} ${month.getFullYear()}`;

  const filteredEvents = useMemo(
    () => (filterType === 'all' ? events : events.filter((e) => e.type === filterType)),
    [events, filterType],
  );

  const monthEvents = useMemo(() => {
    const start = new Date(month.getFullYear(), month.getMonth(), 1).getTime();
    const end = new Date(month.getFullYear(), month.getMonth() + 1, 0, 23, 59, 59).getTime();
    return filteredEvents.filter((e) => {
      const s = new Date(e.startsAt).getTime();
      const en = new Date(e.endsAt).getTime();
      return s <= end && en >= start;
    });
  }, [filteredEvents, month]);

  const upcomingEvents = useMemo(() => {
    const now = Date.now();
    return [...filteredEvents]
      .filter((e) => new Date(e.endsAt).getTime() >= now)
      .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())
      .slice(0, 12);
  }, [filteredEvents]);

  // KPIs
  const weekStart = startOfWeek(today);
  const weekEnd = addDays(weekStart, 7);
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0, 23, 59, 59);

  const inWindow = (e: PortalCalendarEvent, from: Date, to: Date) => {
    const s = new Date(e.startsAt).getTime();
    const en = new Date(e.endsAt).getTime();
    return s <= to.getTime() && en >= from.getTime();
  };

  const thisWeekCount = events.filter((e) => inWindow(e, weekStart, weekEnd)).length;
  const thisMonthCount = events.filter((e) => inWindow(e, monthStart, monthEnd)).length;
  const nextEvent = events
    .filter((e) => new Date(e.endsAt).getTime() >= today.getTime())
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())[0];

  return (
    <>
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard icon={CalendarRange} tone="blue" label="TOTAL" value={events.length}>
          Événements visibles
        </KpiCard>
        <KpiCard icon={CalendarCheck2} tone="violet" label="CE MOIS-CI" value={thisMonthCount}>
          {monthStart.toLocaleDateString('fr-FR', { month: 'long' })}
        </KpiCard>
        <KpiCard icon={CalendarClock} tone="rose" label="CETTE SEMAINE" value={thisWeekCount}>
          Sous 7 jours
        </KpiCard>
        <KpiCard
          icon={Sparkles}
          tone="amber"
          label="PROCHAIN"
          value={
            nextEvent
              ? nextEvent.startsAt
                  ? new Date(nextEvent.startsAt).toLocaleDateString('fr-FR', {
                      day: '2-digit',
                      month: 'short',
                    })
                  : '—'
              : '—'
          }
        >
          {nextEvent ? nextEvent.title : 'Aucun événement à venir'}
        </KpiCard>
      </div>

      {/* Filter chip row */}
      <div className="mt-6 flex flex-wrap items-center gap-2">
        <FilterChip active={filterType === 'all'} onClick={() => setFilterType('all')}>
          Tous
          <span className="ml-1.5 rounded-full bg-white/70 px-1.5 text-[10px] font-bold text-slate-600 group-data-[active=true]:bg-blue-600 group-data-[active=true]:text-white">
            {events.length}
          </span>
        </FilterChip>
        {(Object.keys(TYPE_LABEL) as CalendarEventType[]).map((t) => {
          const count = events.filter((e) => e.type === t).length;
          if (count === 0) return null;
          const Icon = TYPE_ICON[t];
          return (
            <FilterChip
              key={t}
              active={filterType === t}
              onClick={() => setFilterType(t)}
              accent={TYPE_SOLID[t]}
            >
              <Icon className="h-3.5 w-3.5" />
              {TYPE_LABEL[t]}
              <span className="ml-1.5 rounded-full bg-white/70 px-1.5 text-[10px] font-bold text-slate-600 group-data-[active=true]:bg-slate-900 group-data-[active=true]:text-white">
                {count}
              </span>
            </FilterChip>
          );
        })}
      </div>

      {/* Main grid : month view + upcoming sidebar */}
      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/60 lg:col-span-2">
          <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-3.5">
            <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 p-1">
              <button
                type="button"
                onClick={() => setMonthOffset((o) => o - 1)}
                aria-label="Mois précédent"
                className="grid h-7 w-7 place-items-center rounded-lg text-slate-600 hover:bg-white hover:text-slate-900"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="min-w-[150px] px-2 text-center text-sm font-bold capitalize text-slate-900">
                {monthLabel}
              </span>
              <button
                type="button"
                onClick={() => setMonthOffset((o) => o + 1)}
                aria-label="Mois suivant"
                className="grid h-7 w-7 place-items-center rounded-lg text-slate-600 hover:bg-white hover:text-slate-900"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
            {monthOffset !== 0 && (
              <button
                type="button"
                onClick={() => setMonthOffset(0)}
                className="rounded-lg px-2.5 py-1 text-xs font-bold text-blue-700 hover:bg-blue-50"
              >
                Aujourd&apos;hui
              </button>
            )}
            <span className="ml-auto text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              {monthEvents.length} événement{monthEvents.length !== 1 ? 's' : ''}
            </span>
          </div>
          <MonthGrid month={month} events={monthEvents} onClickEvent={(e) => setSelected(e)} />
        </section>

        <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/60">
          <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-3.5">
            <PartyPopper className="h-4 w-4 text-violet-500" />
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-700">À venir</h3>
            <span className="ml-auto text-[11px] text-slate-500">
              {upcomingEvents.length === 0 ? 'aucun' : `${upcomingEvents.length} prochains`}
            </span>
          </div>
          {upcomingEvents.length === 0 ? (
            <EmptyState
              icon={CalendarIcon}
              title="Aucun événement à venir"
              description={
                filterType === 'all'
                  ? "Aucun événement scolaire planifié. L'établissement publiera ici les vacances, examens et événements."
                  : 'Aucun événement de ce type à venir. Modifiez le filtre pour voir tous les événements.'
              }
              tone="slate"
            />
          ) : (
            <ul className="max-h-[640px] divide-y divide-slate-100 overflow-y-auto">
              {upcomingEvents.map((e) => (
                <li key={e.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(e)}
                    className="flex w-full items-start gap-3 px-5 py-3.5 text-left transition-colors hover:bg-slate-50/80"
                  >
                    <UpcomingDateBlock event={e} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start gap-2">
                        <h4 className="line-clamp-2 text-sm font-bold text-slate-900">{e.title}</h4>
                      </div>
                      <p className="mt-0.5 text-xs text-slate-500">{formatInDays(e.startsAt)}</p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <span
                          className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-bold ${TYPE_TONE[e.type]}`}
                        >
                          {TYPE_LABEL[e.type]}
                        </span>
                        <span className="inline-flex items-center gap-1 text-[10px] font-medium text-slate-500">
                          <School className="h-3 w-3" />
                          {scopeLabel(e)}
                        </span>
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* Footer note */}
      <div className="mt-4 flex flex-wrap items-center gap-2 rounded-2xl bg-slate-50 px-4 py-3 text-[11px] text-slate-600 ring-1 ring-slate-200/70">
        <Info className="h-3.5 w-3.5 text-slate-500" />
        <span>
          Calendrier officiel mis à jour par l&apos;administration de l&apos;établissement.
          {portal === 'parent'
            ? ' Les évaluations spécifiques à votre enfant restent visibles depuis l\'onglet « Évaluations à venir ».'
            : ' Cliquez sur un événement pour voir les détails et la portée.'}
        </span>
      </div>

      <DetailDrawer
        open={selected !== null}
        onClose={() => setSelected(null)}
        title={
          selected ? (
            <div className="flex items-center gap-2">
              <span
                className={`grid h-7 w-7 place-items-center rounded-lg text-white ${TYPE_SOLID[selected.type]}`}
              >
                {(() => {
                  const Icon = TYPE_ICON[selected.type];
                  return <Icon className="h-4 w-4" />;
                })()}
              </span>
              <span className="truncate">{selected.title}</span>
            </div>
          ) : (
            'Détails'
          )
        }
        description={selected ? formatRange(selected) : undefined}
      >
        {selected && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-bold ${TYPE_TONE[selected.type]}`}
              >
                {TYPE_LABEL[selected.type]}
              </span>
              <StatusBadge
                label={scopeLabel(selected)}
                tone={selected.scope === 'school_wide' ? 'sky' : 'violet'}
                size="sm"
                withDot
              />
              <span className="text-xs text-slate-500">{formatInDays(selected.startsAt)}</span>
            </div>

            {selected.description && (
              <div>
                <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  Description
                </div>
                <p className="whitespace-pre-line text-sm leading-relaxed text-slate-700">
                  {selected.description}
                </p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <DetailField label="Début">
                {new Date(selected.startsAt).toLocaleDateString('fr-FR', {
                  weekday: 'short',
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric',
                })}
              </DetailField>
              <DetailField label="Fin">
                {new Date(selected.endsAt).toLocaleDateString('fr-FR', {
                  weekday: 'short',
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric',
                })}
              </DetailField>
            </div>

            <div className="rounded-xl bg-slate-50 p-4 text-xs text-slate-600 ring-1 ring-slate-200">
              <p className="flex items-start gap-2">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500" />
                Cet événement a été publié par l&apos;équipe administrative de
                l&apos;établissement. Pour toute question, contactez le secrétariat.
              </p>
            </div>
          </div>
        )}
      </DetailDrawer>
    </>
  );
}

function MonthGrid({
  month,
  events,
  onClickEvent,
}: {
  month: Date;
  events: PortalCalendarEvent[];
  onClickEvent: (e: PortalCalendarEvent) => void;
}) {
  const firstDow = (new Date(month.getFullYear(), month.getMonth(), 1).getDay() + 6) % 7;
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const today = new Date();

  const cells: Array<{ date: Date; isPad: boolean }> = [];
  const prevMonthLast = new Date(month.getFullYear(), month.getMonth(), 0);
  const prevDays = prevMonthLast.getDate();
  for (let i = firstDow - 1; i >= 0; i--) {
    cells.push({
      date: new Date(prevMonthLast.getFullYear(), prevMonthLast.getMonth(), prevDays - i),
      isPad: true,
    });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ date: new Date(month.getFullYear(), month.getMonth(), d), isPad: false });
  }
  while (cells.length % 7 !== 0) {
    const last = cells[cells.length - 1]!.date;
    cells.push({
      date: new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1),
      isPad: true,
    });
  }

  return (
    <div className="p-4">
      <div className="mb-2 grid grid-cols-7 gap-1 text-center text-[11px] font-bold uppercase tracking-wider text-slate-500">
        {['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'].map((d, i) => (
          <div key={i}>{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((c, idx) => {
          const dayEvents = events.filter((e) => eventOverlapsDay(e, c.date));
          const isToday = sameDay(c.date, today);
          const isWeekend = c.date.getDay() === 0 || c.date.getDay() === 6;
          return (
            <div
              key={idx}
              className={`group relative min-h-[88px] rounded-xl p-1.5 text-xs ring-1 transition-shadow ${
                c.isPad
                  ? 'bg-slate-50/50 text-slate-300 ring-slate-100'
                  : isToday
                    ? 'bg-gradient-to-br from-blue-50 via-white to-blue-50 ring-blue-300 shadow-sm'
                    : isWeekend
                      ? 'bg-slate-50/70 ring-slate-100'
                      : 'bg-white ring-slate-100 hover:ring-slate-200'
              }`}
            >
              <div
                className={`mb-1 flex items-center justify-between gap-1 text-[11px] font-bold ${
                  c.isPad
                    ? 'text-slate-300'
                    : isToday
                      ? 'text-blue-700'
                      : isWeekend
                        ? 'text-slate-500'
                        : 'text-slate-700'
                }`}
              >
                <span
                  className={`inline-flex h-5 min-w-[20px] items-center justify-center rounded-md px-1 tabular-nums ${
                    isToday ? 'bg-blue-600 text-white shadow' : ''
                  }`}
                >
                  {c.date.getDate()}
                </span>
                {dayEvents.length > 2 && !c.isPad && (
                  <span className="rounded-full bg-slate-100 px-1.5 text-[9px] font-bold text-slate-600">
                    +{dayEvents.length - 2}
                  </span>
                )}
              </div>
              {!c.isPad && (
                <div className="space-y-0.5">
                  {dayEvents.slice(0, 2).map((e) => (
                    <button
                      key={e.id}
                      type="button"
                      onClick={() => onClickEvent(e)}
                      title={e.title}
                      className={`flex w-full items-center gap-1 truncate rounded-md border px-1.5 py-0.5 text-left text-[10px] font-semibold transition-transform hover:-translate-y-px hover:shadow-sm ${TYPE_TONE[e.type]}`}
                    >
                      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${TYPE_SOLID[e.type]}`} />
                      <span className="truncate">{e.title}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function UpcomingDateBlock({ event }: { event: PortalCalendarEvent }) {
  const date = new Date(event.startsAt);
  const today = startOfDay(new Date());
  const isImminent = date.getTime() <= addDays(today, 7).getTime();
  return (
    <div
      className={`flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-lg ring-1 ${
        isImminent ? 'bg-rose-50 ring-rose-200' : 'bg-slate-50 ring-slate-200'
      }`}
    >
      <span
        className={`text-[9px] font-bold uppercase tracking-wider ${
          isImminent ? 'text-rose-700' : 'text-slate-500'
        }`}
      >
        {date.toLocaleDateString('fr-FR', { month: 'short' }).replace('.', '')}
      </span>
      <span
        className={`text-base font-bold tabular-nums leading-none ${
          isImminent ? 'text-rose-900' : 'text-slate-900'
        }`}
      >
        {date.getDate()}
      </span>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
  accent,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  accent?: string;
}) {
  return (
    <button
      type="button"
      data-active={active}
      onClick={onClick}
      className={`group inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-all ${
        active
          ? 'border-blue-600 bg-blue-600 text-white shadow-sm shadow-blue-500/20'
          : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
      }`}
    >
      {accent && !active && <span className={`h-1.5 w-1.5 rounded-full ${accent}`} />}
      {children}
    </button>
  );
}

function DetailField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">
        {label}
      </div>
      <div className="text-sm text-slate-800">{children}</div>
    </div>
  );
}

