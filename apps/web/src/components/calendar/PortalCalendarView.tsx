'use client';

import {
  type CalendarAnchor,
  type CalendarWindow,
  capList,
  countEventsInWindow,
  eventStartMs,
  eventsInWindow,
  instantDateParts,
  isStartingWithinDays,
  monthGridCells,
  monthLabelParts,
  monthWindow,
  nextUpcomingEvent,
  upcomingEvents as allUpcomingEvents,
  weekWindow,
} from '@pilotage/contracts';
import {
  DetailDrawer,
  EmptyState,
  KpiCard,
  StatusBadge,
  formatDateLong,
  formatInDays,
} from '@pilotage/ui';
import {
  Calendar as CalendarIcon,
  CalendarCheck2,
  CalendarClock,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Flag,
  GraduationCap,
  Info,
  PartyPopper,
  School,
  Sparkles,
  Sun,
  Users,
} from 'lucide-react';
import { useMemo, useState } from 'react';


import { CalendarExportButton } from './CalendarExportButton';
import {
  FR_MONTHS_SHORT,
  calendarCappedHeader,
  calendarMonthLabel,
  calendarMonthScope,
  calendarNextScope,
  calendarTotalScope,
  calendarWeekScope,
} from './event-display';

import type { IcsEvent } from '@/lib/ics';


export type CalendarEventType =
  | 'vacation_break'
  | 'public_holiday'
  | 'exam_period'
  | 'meeting'
  | 'ceremony'
  | 'pedagogical_day'
  // `evaluation` est un type SYNTHÉTIQUE côté client : il n'existe pas dans
  // l'enum backend `CalendarEventType`. Le portail parent fusionne les
  // évaluations à venir (issues de `/analytics/parent-upcoming`) dans la même
  // vue calendrier en les mappant sur ce type. Les portails teacher/admin ne
  // passent jamais d'événements de ce type.
  | 'evaluation'
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
  /**
   * L'instant de référence, RÉSOLU CÔTÉ SERVEUR et traversant la frontière en
   * prop (S-E03-8 / PF-40 / ADR-078).
   *
   * Ce composant porte `'use client'`, et Next rend les composants clients SUR LE
   * SERVEUR avant de les hydrater. Tant qu'il lisait `new Date()` / `Date.now()`
   * au scope de rendu, chaque compteur était calculé une première fois sur
   * l'horloge et le fuseau du CONTENEUR, puis une seconde fois sur ceux du
   * NAVIGATEUR, et React remplaçait silencieusement le nœud de texte : le
   * chiffre changeait tout seul, sans action de l'utilisateur. C'est le seul des
   * quatre mécanismes de `PF-40` qui méritait le mot « interim » de l'audit.
   *
   * L'exemption de `FreshnessChip.tsx:66-76` NE S'APPLIQUE PAS ici, et ADR-078
   * pose le test en quatre points : le suffixe de `FreshnessChip` est
   * `aria-hidden`, porte `suppressHydrationWarning`, REFORMULE une valeur rendue
   * ailleurs dans la même puce, et se rafraîchit toutes les 30 s PAR DESSEIN.
   * Un KPI ne coche aucun des quatre : il est dans le nom accessible, il n'a
   * aucun jumeau faisant autorité à l'écran, et un changement après chargement y
   * est indiscernable d'un changement de données.
   */
  anchor: CalendarAnchor;
}

const TYPE_LABEL: Record<CalendarEventType, string> = {
  vacation_break: 'Vacances',
  public_holiday: 'Jour férié',
  exam_period: 'Examens',
  meeting: 'Réunion',
  ceremony: 'Cérémonie',
  pedagogical_day: 'Journée pédagogique',
  evaluation: 'Évaluation',
  custom: 'Événement',
};

const TYPE_TONE: Record<CalendarEventType, string> = {
  vacation_break: 'bg-amber-50 text-amber-800 border-amber-200',
  public_holiday: 'bg-rose-50 text-rose-800 border-rose-200',
  exam_period: 'bg-violet-50 text-violet-800 border-violet-200',
  meeting: 'bg-blue-50 text-blue-800 border-blue-200',
  ceremony: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  pedagogical_day: 'bg-cyan-50 text-cyan-800 border-cyan-200',
  evaluation: 'bg-indigo-50 text-indigo-800 border-indigo-200',
  custom: 'bg-slate-50 text-slate-800 border-slate-200',
};

const TYPE_SOLID: Record<CalendarEventType, string> = {
  vacation_break: 'bg-amber-500',
  public_holiday: 'bg-rose-500',
  exam_period: 'bg-violet-500',
  meeting: 'bg-blue-500',
  ceremony: 'bg-emerald-500',
  pedagogical_day: 'bg-cyan-500',
  evaluation: 'bg-indigo-500',
  custom: 'bg-slate-500',
};

const TYPE_ICON: Record<CalendarEventType, typeof Sun> = {
  vacation_break: Sun,
  public_holiday: Flag,
  exam_period: ClipboardList,
  meeting: Users,
  ceremony: PartyPopper,
  pedagogical_day: Sparkles,
  evaluation: GraduationCap,
  custom: CalendarIcon,
};

/** Plafond de la liste « À venir ». Le vrai total reste rendu à côté (AC-3). */
const UPCOMING_CAP = 12;

/** Nombre de pastilles d'événement qu'une case de jour peut dessiner. */
const DAY_CELL_VISIBLE = 2;

function scopeLabel(event: PortalCalendarEvent): string {
  if (event.classSection) return `Classe ${event.classSection.name}`;
  if (event.gradeLevel) return `Niveau ${event.gradeLevel.name}`;
  if (event.cycle) return `Cycle ${event.cycle.name}`;
  return "Toute l'école";
}

function formatRange(event: PortalCalendarEvent): string {
  const start = formatDateLong(event.startsAt);
  const end = formatDateLong(event.endsAt);
  return start === end ? start : `${start} → ${end}`;
}

export function PortalCalendarView({ portal, events, anchor }: Props) {
  const [monthOffset, setMonthOffset] = useState(0);
  const [filterType, setFilterType] = useState<CalendarEventType | 'all'>('all');
  const [selected, setSelected] = useState<PortalCalendarEvent | null>(null);

  // Aucune `Date` n'est construite ici : `formatInDays` accepte un instant epoch,
  // donc l'étiquette relative se calcule directement sur l'ancre SERVEUR. Ce
  // second paramètre existait déjà dans `@pilotage/ui` et n'était appelé nulle
  // part — le joint était là, personne ne s'en servait.
  const monthParts = useMemo(() => monthLabelParts(anchor, monthOffset), [anchor, monthOffset]);
  const monthLabel = calendarMonthLabel(monthParts);

  const filteredEvents = useMemo(
    () => (filterType === 'all' ? events : events.filter((e) => e.type === filterType)),
    [events, filterType],
  );
  const activeTypeLabel = filterType === 'all' ? null : TYPE_LABEL[filterType];

  const icsEvents = useMemo<IcsEvent[]>(
    () =>
      filteredEvents.map((e) => ({
        id: e.id,
        title: e.title,
        description: e.description,
        startsAt: e.startsAt,
        endsAt: e.endsAt,
        allDay: e.allDay,
        categories: [TYPE_LABEL[e.type]],
        location: scopeLabel(e),
      })),
    [filteredEvents],
  );

  // ───────────────────────────────────────────────────────────────────────────
  // UNE fenêtre de mois, UNE fenêtre de semaine, UN prédicat « à venir ».
  //
  // Toutes viennent de `@pilotage/contracts` : la grille, l'en-tête de grille et
  // la bande de KPI ne peuvent plus répondre différemment à « cet événement
  // est-il dans ce mois ? ». La fenêtre du KPI mensuel est celle du mois
  // NAVIGUÉ, pas celle du mois courant : c'est ce qui rend le compteur et
  // l'en-tête de grille littéralement le MÊME nombre, et la carte NOMME le mois
  // qu'elle compte pour que « CE MOIS-CI » ne puisse pas mentir en décembre.
  // ───────────────────────────────────────────────────────────────────────────
  const monthRange = useMemo<CalendarWindow>(
    () => monthWindow(anchor, monthOffset),
    [anchor, monthOffset],
  );
  const weekRange = useMemo<CalendarWindow>(() => weekWindow(anchor), [anchor]);

  const monthEvents = useMemo(
    () => eventsInWindow(filteredEvents, monthRange),
    [filteredEvents, monthRange],
  );
  const weekCount = useMemo(
    () => countEventsInWindow(filteredEvents, weekRange),
    [filteredEvents, weekRange],
  );

  // TOUT le à-venir, trié, JAMAIS tronqué. La coupe est un fait de RENDU, et
  // `capList` garde le vrai total à côté de la liste coupée (AC-3 / DNC-06).
  const upcomingAll = useMemo(
    () => allUpcomingEvents(filteredEvents, anchor),
    [filteredEvents, anchor],
  );
  const upcoming = useMemo(() => capList(upcomingAll, UPCOMING_CAP), [upcomingAll]);
  const upcomingHeader = calendarCappedHeader(upcoming);

  // La tuile « PROCHAIN » et la liste « À venir » lisent le MÊME prédicat : elles
  // ne peuvent plus se contredire sur un événement terminé ce matin (l'une
  // comparait à MINUIT, l'autre à MAINTENANT).
  const nextEvent = useMemo(
    () => nextUpcomingEvent(filteredEvents, anchor),
    [filteredEvents, anchor],
  );
  const nextEventParts = nextEvent
    ? instantDateParts(anchor, eventStartMs(nextEvent))
    : null;

  const totalLabel = filterType === 'all' ? 'TOTAL' : 'AFFICHÉS';
  const monthKpiLabel = monthOffset === 0 ? 'CE MOIS-CI' : 'MOIS AFFICHÉ';

  return (
    <>
      {/*
        La bande de KPI OBÉIT au filtre actif et NOMME sa population (AC-2).

        Décision (ADR-078, D4) : la rangée de puces juste en dessous porte DÉJÀ
        les comptes NON filtrés — « Tous · N » et le compte de chaque type. Le
        registre « population entière » existe donc à 40 px de là, et une bande
        immobile n'ajoutait aucune information : elle apprenait seulement à
        l'utilisateur que la moitié de l'écran ignore le filtre qu'il vient de
        poser. Rien n'est perdu ; seul change quel nombre porte quel mot.
      */}
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          icon={CalendarRange}
          tone="blue"
          label={totalLabel}
          value={filteredEvents.length}
          scope={calendarTotalScope(activeTypeLabel)}
        />
        <KpiCard
          icon={CalendarCheck2}
          tone="violet"
          label={monthKpiLabel}
          value={monthEvents.length}
          scope={calendarMonthScope(monthParts, activeTypeLabel)}
        />
        <KpiCard
          icon={CalendarClock}
          tone="rose"
          label="CETTE SEMAINE"
          value={weekCount}
          scope={calendarWeekScope(activeTypeLabel)}
        />
        <KpiCard
          icon={Sparkles}
          tone="amber"
          label="PROCHAIN"
          value={
            nextEventParts
              ? `${nextEventParts.dayOfMonth} ${FR_MONTHS_SHORT[nextEventParts.monthIndex]}`
              : '—'
          }
          scope={calendarNextScope(activeTypeLabel)}
        >
          {nextEvent ? nextEvent.title : 'Aucun événement à venir'}
        </KpiCard>
      </div>

      {/*
        WCAG 4.1.3 — UN SEUL `role="status"` annonce le changement de filtre.
        Quatre `aria-live` concurrents (un par carte) produiraient quatre
        annonces qui se coupent la parole.
      */}
      <p role="status" aria-live="polite" className="sr-only">
        {activeTypeLabel
          ? `Filtre : ${activeTypeLabel}. ${filteredEvents.length} événements affichés, dont ${monthEvents.length} en ${monthLabel}.`
          : `Aucun filtre. ${filteredEvents.length} événements, dont ${monthEvents.length} en ${monthLabel}.`}
      </p>

      {/* Rangée de puces — les comptes de puce restent NON filtrés, et c'est
          voulu : une puce promet « ce que tu obtiendrais en cliquant », et elle
          porte son propre libellé. C'est le registre « population entière ». */}
      <div
        role="group"
        aria-label="Filtrer par type d'événement"
        className="mt-6 flex snap-x flex-nowrap items-center gap-2 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-x-visible"
      >
        <FilterChip
          active={filterType === 'all'}
          onClick={() => setFilterType('all')}
          label="Tous les types"
        >
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
              label={TYPE_LABEL[t]}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden />
              {TYPE_LABEL[t]}
              <span className="ml-1.5 rounded-full bg-white/70 px-1.5 text-[10px] font-bold text-slate-600 group-data-[active=true]:bg-slate-900 group-data-[active=true]:text-white">
                {count}
              </span>
            </FilterChip>
          );
        })}
        <CalendarExportButton
          events={icsEvents}
          calendarName="Calendrier scolaire"
          fileNameStem={`calendrier-scolaire-${portal}`}
        />
      </div>

      {/* Grille du mois + colonne « À venir ».
          Sous `lg`, la liste chronologique passe AVANT la grille : sur 375 px une
          grille de 7 colonnes ne porte aucun titre lisible, et la vraie réponse à
          « qu'est-ce qui arrive ? » est une liste. */}
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
                <ChevronLeft className="h-4 w-4" aria-hidden />
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
                <ChevronRight className="h-4 w-4" aria-hidden />
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
            {/* Le compte NOMME son mois : même population, même instant, même
                prédicat que la carte KPI mensuelle au-dessus. */}
            <span className="ml-auto text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              {monthEvents.length} événement{monthEvents.length !== 1 ? 's' : ''} en {monthLabel}
            </span>
          </div>
          <MonthGrid
            anchor={anchor}
            monthOffset={monthOffset}
            events={monthEvents}
            onClickEvent={(e) => setSelected(e)}
          />
        </section>

        <section className="order-first overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/60 lg:order-none">
          <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-3.5">
            <PartyPopper className="h-4 w-4 text-violet-500" aria-hidden />
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-700">À venir</h3>
            {/*
              AC-3 — le vrai total est calculé AVANT la coupe. L'ancien en-tête
              rendait la longueur d'une liste DÉJÀ tronquée à 12 : avec 39
              événements à venir, il annonçait « 12 prochains ». Un plafond
              montre son vrai total et dit qu'il plafonne, ou ne rend AUCUN
              nombre — ici `total === 0` rend `null`, et l'`EmptyState` parle.
            */}
            {upcomingHeader && (
              <span className="ml-auto text-[11px] text-slate-600">{upcomingHeader}</span>
            )}
          </div>
          {upcoming.total === 0 ? (
            <EmptyState
              icon={CalendarIcon}
              title="Aucun événement à venir"
              description={
                activeTypeLabel
                  ? `Aucun événement de type « ${activeTypeLabel} » à venir.`
                  : "Aucun événement scolaire planifié. L'établissement publiera ici les vacances, examens et événements."
              }
              tone="slate"
              action={
                activeTypeLabel
                  ? { label: 'Voir tous les types', onClick: () => setFilterType('all') }
                  : undefined
              }
            />
          ) : (
            <>
              <ul className="max-h-[640px] divide-y divide-slate-100 overflow-y-auto">
                {upcoming.items.map((e) => (
                  <li key={e.id}>
                    <button
                      type="button"
                      onClick={() => setSelected(e)}
                      className="flex w-full items-start gap-3 px-5 py-3.5 text-left transition-colors hover:bg-slate-50/80"
                    >
                      <UpcomingDateBlock event={e} anchor={anchor} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start gap-2">
                          <h4 className="line-clamp-2 text-sm font-bold text-slate-900">
                            {e.title}
                          </h4>
                        </div>
                        <p className="mt-0.5 text-xs text-slate-600">
                          {formatInDays(e.startsAt, anchor.nowMs)}
                        </p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          <span
                            className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-bold ${TYPE_TONE[e.type]}`}
                          >
                            {TYPE_LABEL[e.type]}
                          </span>
                          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-slate-600">
                            <School className="h-3 w-3" aria-hidden />
                            {scopeLabel(e)}
                          </span>
                        </div>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
              {upcoming.truncated && (
                <p className="border-t border-slate-100 px-5 py-2.5 text-[11px] text-slate-600">
                  + {upcoming.hidden} autre{upcoming.hidden !== 1 ? 's' : ''} événement
                  {upcoming.hidden !== 1 ? 's' : ''} à venir — la navigation mensuelle et les
                  filtres permettent de les atteindre.
                </p>
              )}
            </>
          )}
        </section>
      </div>

      {/* Note de pied */}
      <div className="mt-4 flex flex-wrap items-center gap-2 rounded-2xl bg-slate-50 px-4 py-3 text-[11px] text-slate-600 ring-1 ring-slate-200/70">
        <Info className="h-3.5 w-3.5 text-slate-500" aria-hidden />
        <span>
          Calendrier officiel mis à jour par l&apos;administration de l&apos;établissement. Un
          événement à cheval sur deux mois est compté dans chacun des deux : la grille répond à
          « qu&apos;est-ce qui concerne ce mois&nbsp;? », pas à « qu&apos;est-ce qui y
          commence&nbsp;? ».
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
                  return <Icon className="h-4 w-4" aria-hidden />;
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
              <span className="text-xs text-slate-600">{formatInDays(selected.startsAt, anchor.nowMs)}</span>
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
              <DetailField label="Début">{formatDateLong(selected.startsAt)}</DetailField>
              <DetailField label="Fin">{formatDateLong(selected.endsAt)}</DetailField>
            </div>

            <div className="rounded-xl bg-slate-50 p-4 text-xs text-slate-600 ring-1 ring-slate-200">
              <p className="flex items-start gap-2">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden />
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

/**
 * La grille du mois. Ses cases viennent de `monthGridCells(anchor, monthOffset)`,
 * donc il n'y a plus une seule construction de date locale ici : la pastille
 * « aujourd'hui » se peint sur la même case côté serveur et côté navigateur.
 */
function MonthGrid({
  anchor,
  monthOffset,
  events,
  onClickEvent,
}: {
  anchor: CalendarAnchor;
  monthOffset: number;
  events: PortalCalendarEvent[];
  onClickEvent: (e: PortalCalendarEvent) => void;
}) {
  const cells = useMemo(() => monthGridCells(anchor, monthOffset), [anchor, monthOffset]);

  return (
    <div className="p-4">
      <div className="mb-2 grid grid-cols-7 gap-1 text-center text-[11px] font-bold uppercase tracking-wider text-slate-500">
        {['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'].map((d) => (
          <div key={d}>{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((c) => {
          const dayEvents = eventsInWindow(events, c.window);
          const overflow = dayEvents.length - DAY_CELL_VISIBLE;
          return (
            <div
              key={c.key}
              className={`group relative min-h-[88px] rounded-xl p-1.5 text-xs ring-1 transition-shadow ${
                c.isPadding
                  ? 'bg-slate-50/50 text-slate-300 ring-slate-100'
                  : c.isToday
                    ? 'bg-gradient-to-br from-blue-50 via-white to-blue-50 shadow-sm ring-blue-300'
                    : c.isWeekend
                      ? 'bg-slate-50/70 ring-slate-100'
                      : 'bg-white ring-slate-100 hover:ring-slate-200'
              }`}
            >
              <div
                className={`mb-1 flex items-center justify-between gap-1 text-[11px] font-bold ${
                  c.isPadding
                    ? 'text-slate-300'
                    : c.isToday
                      ? 'text-blue-700'
                      : c.isWeekend
                        ? 'text-slate-500'
                        : 'text-slate-700'
                }`}
              >
                <span
                  className={`inline-flex h-5 min-w-[20px] items-center justify-center rounded-md px-1 tabular-nums ${
                    c.isToday ? 'bg-blue-600 text-white shadow' : ''
                  }`}
                >
                  {c.dayOfMonth}
                </span>
                {/*
                  Indicateur de DÉBORDEMENT, pas un total tronqué : il dit combien
                  de pastilles la case ne peut pas dessiner, dans le même élément
                  que la coupe. Le cliquet R3 exclut cette forme par une règle
                  ÉCRITE, précisément pour ne pas la confondre avec l'en-tête
                  « N prochains » qu'il existe pour attraper.
                */}
                {overflow > 0 && !c.isPadding && (
                  <span className="rounded-full bg-slate-100 px-1.5 text-[9px] font-bold text-slate-600">
                    +{overflow}
                  </span>
                )}
              </div>
              {!c.isPadding && (
                <div className="space-y-0.5">
                  {dayEvents.slice(0, DAY_CELL_VISIBLE).map((e) => (
                    <button
                      key={e.id}
                      type="button"
                      onClick={() => onClickEvent(e)}
                      title={e.title}
                      className={`flex w-full items-center gap-1 truncate rounded-md border px-1.5 py-0.5 text-left text-[10px] font-semibold transition-transform hover:-translate-y-px hover:shadow-sm ${TYPE_TONE[e.type]}`}
                    >
                      <span
                        className={`h-1.5 w-1.5 shrink-0 rounded-full ${TYPE_SOLID[e.type]}`}
                        aria-hidden
                      />
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

function UpcomingDateBlock({
  event,
  anchor,
}: {
  event: PortalCalendarEvent;
  anchor: CalendarAnchor;
}) {
  // Jour et mois dérivés du fuseau de l'ANCRE, pas de celui du visiteur : un
  // événement du 31 octobre à 23 h 30 ne peut plus s'afficher « 31 oct » côté
  // serveur et « 1 nov » côté navigateur.
  const parts = instantDateParts(anchor, eventStartMs(event));
  const isImminent = isStartingWithinDays(event, anchor, 7);
  return (
    <div
      className={`flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-lg ring-1 ${
        isImminent ? 'bg-rose-50 ring-rose-200' : 'bg-slate-50 ring-slate-200'
      }`}
    >
      <span
        className={`text-[9px] font-bold uppercase tracking-wider ${
          isImminent ? 'text-rose-700' : 'text-slate-600'
        }`}
      >
        {FR_MONTHS_SHORT[parts.monthIndex]}
      </span>
      <span
        className={`text-base font-bold leading-none tabular-nums ${
          isImminent ? 'text-rose-900' : 'text-slate-900'
        }`}
      >
        {parts.dayOfMonth}
      </span>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
  accent,
  label,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  accent?: string;
  label: string;
}) {
  return (
    <button
      type="button"
      data-active={active}
      aria-pressed={active}
      aria-label={label}
      onClick={onClick}
      className={`group inline-flex shrink-0 snap-start items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-all ${
        active
          ? 'border-blue-600 bg-blue-600 text-white shadow-sm shadow-blue-500/20'
          : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
      }`}
    >
      {accent && !active && <span className={`h-1.5 w-1.5 rounded-full ${accent}`} aria-hidden />}
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
