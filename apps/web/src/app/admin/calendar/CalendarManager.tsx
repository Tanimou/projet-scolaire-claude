'use client';

import {
  type CalendarAnchor,
  capList,
  eventsInWindow,
  monthGridCells,
  monthLabelParts,
  monthWindow,
  upcomingEvents as allUpcomingEvents,
} from '@pilotage/contracts';
import {
  Calendar as CalendarIcon,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Edit2,
  Eye,
  Flag,
  Loader2,
  PartyPopper,
  Plus,
  School,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { useMemo, useState } from 'react';

import { SeedHolidaysDrawer, type SeedYearOption } from './SeedHolidaysDrawer';
import { createCalendarEvent, deleteCalendarEvent, updateCalendarEvent } from './actions';
import type { CalendarEvent, CalendarEventType } from './page';

import {
  calendarCappedHeader,
  calendarMonthLabel,
} from '@/components/calendar/event-display';

const TYPE_LABEL: Record<CalendarEventType, string> = {
  vacation_break: 'Vacances',
  public_holiday: 'Jour férié',
  exam_period: 'Examens',
  meeting: 'Réunion',
  ceremony: 'Cérémonie',
  pedagogical_day: 'Journée pédagogique',
  custom: 'Autre',
};

const TYPE_TONE: Record<CalendarEventType, string> = {
  vacation_break: 'bg-amber-100 text-amber-800 border-amber-200',
  public_holiday: 'bg-rose-100 text-rose-800 border-rose-200',
  exam_period: 'bg-violet-100 text-violet-800 border-violet-200',
  meeting: 'bg-blue-100 text-blue-800 border-blue-200',
  ceremony: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  pedagogical_day: 'bg-cyan-100 text-cyan-800 border-cyan-200',
  custom: 'bg-slate-100 text-slate-800 border-slate-200',
};

const TYPE_DOT: Record<CalendarEventType, string> = {
  vacation_break: 'bg-amber-500',
  public_holiday: 'bg-rose-500',
  exam_period: 'bg-violet-500',
  meeting: 'bg-blue-500',
  ceremony: 'bg-emerald-500',
  pedagogical_day: 'bg-cyan-500',
  custom: 'bg-slate-500',
};

/** Plafond de la liste « À venir ». Le vrai total est rendu à côté (AC-3). */
const UPCOMING_CAP = 12;

/** Nombre de pastilles d'événement qu'une case de jour peut dessiner. */
const DAY_CELL_VISIBLE = 3;

interface Props {
  events: CalendarEvent[];
  years: SeedYearOption[];
  gradeLevels: Array<{ id: string; code: string; name: string }>;
  classes: Array<{ id: string; name: string; gradeLevel: { name: string } }>;
  /**
   * L'instant de référence, résolu côté serveur dans `page.tsx` et traversant la
   * frontière en prop (S-E03-8 / PF-40 / ADR-078). Ce composant est
   * `'use client'` : tant qu'il faisait `new Date()` / `Date.now()` au scope de
   * rendu, ses compteurs étaient calculés sur l'horloge du conteneur puis
   * recalculés sur celle du navigateur.
   */
  anchor: CalendarAnchor;
}

export function CalendarManager({ events, years, gradeLevels, classes, anchor }: Props) {
  const [editing, setEditing] = useState<CalendarEvent | null>(null);
  const [creating, setCreating] = useState(false);
  const [seedOpen, setSeedOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [monthOffset, setMonthOffset] = useState(0);
  const [filterType, setFilterType] = useState<CalendarEventType | 'all'>('all');

  const monthParts = useMemo(() => monthLabelParts(anchor, monthOffset), [anchor, monthOffset]);
  const monthName = calendarMonthLabel(monthParts);

  const filteredEvents = useMemo(
    () => (filterType === 'all' ? events : events.filter((e) => e.type === filterType)),
    [events, filterType],
  );

  // ───────────────────────────────────────────────────────────────────────────
  // AC-1 — le mois de l'admin cesse de diverger de celui des portails.
  //
  // Ce filtre testait `startsAt` SEUL : un congé commencé le 28 octobre et
  // courant jusqu'au 10 novembre disparaissait de novembre côté admin pendant
  // qu'il y figurait côté parent et prof. Pire, la grille en dessous était DÉJÀ
  // écrite pour le chevauchement — elle bornait `startDay`/`endDay` au mois
  // précisément pour peindre un événement débordant — et ces deux branches
  // étaient du code MORT, rendues inatteignables par ce filtre.
  //
  // Le prédicat vient maintenant de `@pilotage/contracts` : chevauchement sur
  // intervalle semi-ouvert, la même réponse pour les trois portails.
  // ───────────────────────────────────────────────────────────────────────────
  const monthEvents = useMemo(
    () => eventsInWindow(filteredEvents, monthWindow(anchor, monthOffset)),
    [filteredEvents, anchor, monthOffset],
  );

  // AC-3 — l'admin tronquait à 12 EN SILENCE : rien à l'écran ne disait que 27
  // événements manquaient. Le vrai total est calculé avant la coupe et rendu.
  const upcomingAll = useMemo(
    () => allUpcomingEvents(filteredEvents, anchor),
    [filteredEvents, anchor],
  );
  const upcoming = useMemo(() => capList(upcomingAll, UPCOMING_CAP), [upcomingAll]);
  const upcomingHeader = calendarCappedHeader(upcoming);

  // The holiday import no longer fires on click: the trigger only opens the
  // confirmation drawer, which reads the plan (dry run) before anything is
  // written. See SeedHolidaysDrawer for the scope statement it must show
  // (S-E06-6 / PF-29).
  const handleDelete = async (id: string, title: string) => {
    // Still a native confirm (migrating it to ConfirmDialog is out of this
    // slice), but it now names what it deletes instead of nothing.
    if (!confirm(`Supprimer « ${title} » ?`)) return;
    setBusy(true);
    const res = await deleteCalendarEvent(id);
    setBusy(false);
    if (!res.ok) setFeedback({ kind: 'err', text: res.error });
  };

  return (
    <div className="space-y-6" aria-busy={busy}>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-1.5">
          <button type="button" onClick={() => setMonthOffset((o) => o - 1)} aria-label="Mois précédent" className="grid h-8 w-8 place-items-center rounded-lg text-slate-600 hover:bg-slate-100">
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </button>
          <span className="px-2 text-sm font-bold capitalize text-slate-900 min-w-[150px] text-center">
            {monthName}
          </span>
          <button type="button" onClick={() => setMonthOffset((o) => o + 1)} aria-label="Mois suivant" className="grid h-8 w-8 place-items-center rounded-lg text-slate-600 hover:bg-slate-100">
            <ChevronRight className="h-4 w-4" aria-hidden />
          </button>
          <button type="button" onClick={() => setMonthOffset(0)} className="ml-1 rounded-lg px-2.5 py-1 text-xs font-bold text-blue-700 hover:bg-blue-50">
            Aujourd&apos;hui
          </button>
        </div>

        <select value={filterType} onChange={(e) => setFilterType(e.target.value as CalendarEventType | 'all')} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm">
          <option value="all">Tous les types</option>
          {Object.entries(TYPE_LABEL).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>

        <div className="ml-auto flex w-full flex-wrap items-center gap-2 sm:w-auto">
          {/* Ellipsis = « ouvre une boîte de dialogue », ne déclenche rien. */}
          <button type="button" onClick={() => setSeedOpen(true)} className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-bold text-amber-900 hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/40 sm:w-auto">
            <Sparkles className="h-3.5 w-3.5" aria-hidden />
            Importer les jours fériés…
          </button>
          <button type="button" onClick={() => setCreating(true)} className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-gradient-to-br from-indigo-600 via-blue-600 to-blue-700 px-4 py-2 text-sm font-bold text-white shadow-lg shadow-blue-500/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 sm:w-auto">
            <Plus className="h-4 w-4" aria-hidden /> Nouvel événement
          </button>
        </div>
      </div>

      {/* WCAG 4.1.3 — le résultat d'une écriture de masse doit être annoncé. */}
      <div role="status" aria-live="polite">
        {feedback && (
          <div className={`flex items-start gap-2 rounded-xl border px-4 py-2.5 text-sm ${
            feedback.kind === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-red-200 bg-red-50 text-red-900'
          }`}>
            {feedback.kind === 'ok' ? <CheckCircle2 className="h-4 w-4 mt-0.5" aria-hidden /> : <X className="h-4 w-4 mt-0.5" aria-hidden />}
            {feedback.text}
          </div>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="lg:col-span-2 rounded-2xl bg-white ring-1 ring-slate-200 overflow-hidden">
          <div className="border-b border-slate-100 px-5 py-3.5 flex items-center gap-2">
            <CalendarIcon className="h-4 w-4 text-slate-500" />
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-600">
              {monthName}
            </h3>
            {/* Le compte NOMME son mois — et compte la même population que les
                portails, par le même prédicat de chevauchement. */}
            <span className="ml-auto text-xs text-slate-600">
              {monthEvents.length} événement{monthEvents.length !== 1 ? 's' : ''} en {monthName}
            </span>
          </div>
          <MonthGrid
            anchor={anchor}
            monthOffset={monthOffset}
            events={monthEvents}
            onClickEvent={(e) => setEditing(e)}
          />
        </section>

        <section className="rounded-2xl bg-white ring-1 ring-slate-200 overflow-hidden">
          <div className="border-b border-slate-100 px-5 py-3.5 flex items-center gap-2">
            <PartyPopper className="h-4 w-4 text-slate-500" aria-hidden />
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-600">À venir</h3>
            {upcomingHeader && (
              <span className="ml-auto text-xs text-slate-600">{upcomingHeader}</span>
            )}
          </div>
          <ul className="divide-y divide-slate-100 max-h-[600px] overflow-y-auto">
            {upcoming.total === 0 ? (
              <li className="px-5 py-6 text-center text-sm text-slate-500">Aucun événement à venir</li>
            ) : (
              upcoming.items.map((e) => (
                <li key={e.id} className="group flex items-start gap-3 px-5 py-3 hover:bg-slate-50">
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${TYPE_DOT[e.type]}`} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-bold text-slate-900 truncate">{e.title}</div>
                    <div className="mt-0.5 text-xs text-slate-500">{formatRange(e.startsAt, e.endsAt, e.allDay)}</div>
                    <ScopeBadge event={e} />
                  </div>
                  {/*
                    WCAG 2.4.7 / 2.5.8 — ces deux actions étaient en
                    `opacity-0 group-hover:opacity-100` : invisibles au clavier
                    (le focus se posait sur un bouton transparent) et
                    INATTEIGNABLES au doigt, faute de `:hover` sur pointeur
                    grossier. Elles réapparaissent au focus, et restent visibles
                    en permanence sur écran tactile.
                  */}
                  <div className="flex gap-1 opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-focus-within:opacity-100">
                    <button type="button" onClick={() => setEditing(e)} aria-label={`Modifier « ${e.title} »`} className="grid h-7 w-7 place-items-center rounded-md text-slate-600 hover:bg-slate-200 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40">
                      <Edit2 className="h-3.5 w-3.5" aria-hidden />
                    </button>
                    <button type="button" onClick={() => handleDelete(e.id, e.title)} aria-label={`Supprimer « ${e.title} »`} className="grid h-7 w-7 place-items-center rounded-md text-red-600 hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40">
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  </div>
                </li>
              ))
            )}
          </ul>
          {upcoming.truncated && (
            <p className="border-t border-slate-100 px-5 py-2.5 text-[11px] text-slate-600">
              + {upcoming.hidden} autre{upcoming.hidden !== 1 ? 's' : ''} événement
              {upcoming.hidden !== 1 ? 's' : ''} à venir — affinez le filtre de type pour les
              atteindre.
            </p>
          )}
        </section>
      </div>

      <SeedHolidaysDrawer
        open={seedOpen}
        onClose={() => setSeedOpen(false)}
        years={years}
        onImported={(text) => setFeedback({ kind: 'ok', text })}
      />

      {(creating || editing) && (
        <EventEditor
          event={editing}
          years={years}
          gradeLevels={gradeLevels}
          classes={classes}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSave={async (payload) => {
            setBusy(true);
            const res = editing
              ? await updateCalendarEvent(editing.id, payload)
              : await createCalendarEvent(payload);
            setBusy(false);
            if (!res.ok) {
              setFeedback({ kind: 'err', text: res.error });
              return false;
            }
            setCreating(false);
            setEditing(null);
            setFeedback({ kind: 'ok', text: editing ? 'Événement mis à jour.' : 'Événement créé.' });
            return true;
          }}
        />
      )}
    </div>
  );
}

/**
 * La grille du mois, entièrement dérivée de l'ancre serveur.
 *
 * Ce qui disparaît ici et pourquoi : la carte `byDay` bornait chaque événement
 * avec `s.getMonth() === month.getMonth() ? s.getDate() : 1` — une comparaison de
 * mois SANS COMPARER L'ANNÉE. Le défaut était inatteignable tant que le filtre
 * au-dessus ne gardait que les événements COMMENÇANT dans le mois ; le passage au
 * chevauchement l'aurait RÉACTIVÉ (un événement de novembre 2025 aurait peint
 * novembre 2026 depuis son vrai jour de début). Il fallait donc corriger les deux
 * dans la même tranche, et la façon de le faire sans le réintroduire est de ne
 * plus écrire d'arithmétique de dates ici du tout : chaque case porte SA fenêtre,
 * et l'appartenance se lit avec le même `eventsInWindow` que partout ailleurs.
 */
function MonthGrid({
  anchor,
  monthOffset,
  events,
  onClickEvent,
}: {
  anchor: CalendarAnchor;
  monthOffset: number;
  events: CalendarEvent[];
  onClickEvent: (e: CalendarEvent) => void;
}) {
  const cells = useMemo(() => monthGridCells(anchor, monthOffset), [anchor, monthOffset]);

  return (
    <div className="p-4">
      <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2">
        {['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'].map((d) => (<div key={d}>{d}</div>))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((c) => {
          const dayEvents = eventsInWindow(events, c.window);
          const overflow = dayEvents.length - DAY_CELL_VISIBLE;
          return (
            <div key={c.key} className={`min-h-[80px] rounded-xl p-1.5 text-xs ${
              c.isPadding ? 'bg-slate-50/40' : c.isToday ? 'bg-blue-50 ring-1 ring-blue-300' : 'bg-white ring-1 ring-slate-100'
            }`}>
              {!c.isPadding && (
                <>
                  <div className={`mb-1 text-right text-[11px] font-bold ${c.isToday ? 'text-blue-700' : 'text-slate-500'}`}>
                    {c.dayOfMonth}
                  </div>
                  <div className="space-y-0.5">
                    {dayEvents.slice(0, DAY_CELL_VISIBLE).map((e) => (
                      <button key={e.id} type="button" onClick={() => onClickEvent(e)} className={`block w-full truncate rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${TYPE_TONE[e.type]}`} title={e.title}>
                        {e.title}
                      </button>
                    ))}
                    {/* Débordement d'une CASE, pas un total tronqué : le nombre
                        caché est rendu dans le même élément que la coupe. */}
                    {overflow > 0 && (
                      <div className="text-[10px] text-slate-600 font-medium">+{overflow}</div>
                    )}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ScopeBadge({ event }: { event: CalendarEvent }) {
  const Icon = event.scope === 'school_wide' ? School : Eye;
  const label =
    event.scope === 'school_wide'
      ? 'Toute l’école'
      : event.classSection
        ? `Classe ${event.classSection.name}`
        : event.gradeLevel
          ? `Niveau ${event.gradeLevel.name}`
          : event.cycle
            ? `Cycle ${event.cycle.name}`
            : 'Scope custom';
  return (
    <span className="mt-1 inline-flex items-center gap-1 text-[10px] font-medium text-slate-500">
      <Icon className="h-3 w-3" />
      {label}
    </span>
  );
}

function EventEditor({
  event,
  years,
  gradeLevels,
  classes,
  onClose,
  onSave,
}: {
  event: CalendarEvent | null;
  years: SeedYearOption[];
  gradeLevels: Array<{ id: string; code: string; name: string }>;
  classes: Array<{ id: string; name: string; gradeLevel: { name: string } }>;
  onClose: () => void;
  onSave: (payload: Record<string, unknown>) => Promise<boolean>;
}) {
  const [title, setTitle] = useState(event?.title ?? '');
  const [description, setDescription] = useState(event?.description ?? '');
  const [type, setType] = useState<CalendarEventType>(event?.type ?? 'vacation_break');
  const [startsAt, setStartsAt] = useState(toLocalDate(event?.startsAt));
  const [endsAt, setEndsAt] = useState(toLocalDate(event?.endsAt));
  const [scope, setScope] = useState<'school_wide' | 'grade_level_scope' | 'class_section_scope'>(
    event?.scope === 'class_section_scope' ? 'class_section_scope'
      : event?.scope === 'grade_level_scope' ? 'grade_level_scope'
      : 'school_wide',
  );
  const [gradeLevelId, setGradeLevelId] = useState(event?.gradeLevelId ?? '');
  const [classSectionId, setClassSectionId] = useState(event?.classSectionId ?? '');
  const [academicYearId, setAcademicYearId] = useState(
    event?.academicYearId ?? years.find((y) => y.status === 'active')?.id ?? '',
  );
  const [saving, setSaving] = useState(false);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h3 className="text-base font-bold text-slate-900">{event ? 'Modifier l’événement' : 'Nouvel événement'}</h3>
          <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-3 p-5 max-h-[70vh] overflow-y-auto">
          <Field label="Titre">
            <input value={title} onChange={(e) => setTitle(e.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" placeholder="Ex : Vacances de Noël" />
          </Field>
          <Field label="Type">
            <select value={type} onChange={(e) => setType(e.target.value as CalendarEventType)} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm">
              {Object.entries(TYPE_LABEL).map(([k, v]) => (<option key={k} value={k}>{v}</option>))}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Début">
              <input type="date" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" />
            </Field>
            <Field label="Fin">
              <input type="date" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" />
            </Field>
          </div>
          <Field label="Année scolaire">
            <select value={academicYearId} onChange={(e) => setAcademicYearId(e.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm">
              <option value="">— Aucune —</option>
              {years.map((y) => (<option key={y.id} value={y.id}>{y.name} {y.status === 'active' ? '(active)' : ''}</option>))}
            </select>
          </Field>
          <Field label="Portée">
            <select value={scope} onChange={(e) => {
              const v = e.target.value as typeof scope;
              setScope(v);
              if (v !== 'class_section_scope') setClassSectionId('');
              if (v !== 'grade_level_scope') setGradeLevelId('');
            }} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm">
              <option value="school_wide">Toute l’école</option>
              <option value="grade_level_scope">Un niveau</option>
              <option value="class_section_scope">Une classe</option>
            </select>
          </Field>
          {scope === 'grade_level_scope' && (
            <Field label="Niveau">
              <select value={gradeLevelId} onChange={(e) => setGradeLevelId(e.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm">
                <option value="">— Choisir —</option>
                {gradeLevels.map((g) => (<option key={g.id} value={g.id}>{g.name}</option>))}
              </select>
            </Field>
          )}
          {scope === 'class_section_scope' && (
            <Field label="Classe">
              <select value={classSectionId} onChange={(e) => setClassSectionId(e.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm">
                <option value="">— Choisir —</option>
                {classes.map((c) => (<option key={c.id} value={c.id}>{c.name} · {c.gradeLevel.name}</option>))}
              </select>
            </Field>
          )}
          <Field label="Description (optionnelle)">
            <textarea value={description ?? ''} onChange={(e) => setDescription(e.target.value)} rows={3} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" />
          </Field>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-5 py-3.5">
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            Annuler
          </button>
          <button
            type="button"
            disabled={saving || !title.trim() || !startsAt || !endsAt}
            onClick={async () => {
              setSaving(true);
              const payload: Record<string, unknown> = {
                title: title.trim(),
                description: description?.trim() || undefined,
                type,
                scope,
                startsAt: new Date(`${startsAt}T00:00:00`).toISOString(),
                endsAt: new Date(`${endsAt}T23:59:59`).toISOString(),
                allDay: true,
                academicYearId: academicYearId || undefined,
                gradeLevelId: scope === 'grade_level_scope' ? gradeLevelId : null,
                classSectionId: scope === 'class_section_scope' ? classSectionId : null,
              };
              await onSave(payload);
              setSaving(false);
            }}
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-indigo-600 via-blue-600 to-blue-700 px-4 py-2 text-sm font-bold text-white shadow-lg shadow-blue-500/30 disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden /> : <Flag className="h-4 w-4" aria-hidden />}
            {event ? 'Mettre à jour' : 'Créer'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-600">{label}</span>
      {children}
    </label>
  );
}

function formatRange(startsAt: string, endsAt: string, allDay: boolean): string {
  const s = new Date(startsAt);
  const e = new Date(endsAt);
  const sameDay = s.toDateString() === e.toDateString();
  const fmt: Intl.DateTimeFormatOptions = allDay
    ? { dateStyle: 'medium' }
    : { dateStyle: 'short', timeStyle: 'short' };
  const format = (d: Date) => (allDay ? d.toLocaleDateString('fr-FR', fmt) : d.toLocaleString('fr-FR', fmt));
  if (sameDay) return format(s);
  return `${format(s)} → ${format(e)}`;
}

function toLocalDate(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
