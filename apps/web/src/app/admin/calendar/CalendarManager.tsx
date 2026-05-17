'use client';

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

import {
  createCalendarEvent,
  deleteCalendarEvent,
  seedFrenchHolidays,
  updateCalendarEvent,
} from './actions';
import type { CalendarEvent, CalendarEventType } from './page';

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

interface Props {
  events: CalendarEvent[];
  years: Array<{ id: string; name: string; status: string }>;
  gradeLevels: Array<{ id: string; code: string; name: string }>;
  classes: Array<{ id: string; name: string; gradeLevel: { name: string } }>;
}

export function CalendarManager({ events, years, gradeLevels, classes }: Props) {
  const [editing, setEditing] = useState<CalendarEvent | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [monthOffset, setMonthOffset] = useState(0);
  const [filterType, setFilterType] = useState<CalendarEventType | 'all'>('all');

  const today = new Date();
  const month = new Date(today.getFullYear(), today.getMonth() + monthOffset, 1);
  const monthName = month.toLocaleString('fr-FR', { month: 'long', year: 'numeric' });

  const monthEvents = useMemo(() => {
    const start = new Date(month.getFullYear(), month.getMonth(), 1).getTime();
    const end = new Date(month.getFullYear(), month.getMonth() + 1, 1).getTime();
    return events.filter((e) => {
      const t = new Date(e.startsAt).getTime();
      if (t < start || t >= end) return false;
      if (filterType !== 'all' && e.type !== filterType) return false;
      return true;
    });
  }, [events, month, filterType]);

  const upcomingEvents = useMemo(() => {
    const now = Date.now();
    return [...events]
      .filter((e) => new Date(e.endsAt).getTime() >= now)
      .filter((e) => filterType === 'all' || e.type === filterType)
      .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())
      .slice(0, 12);
  }, [events, filterType]);

  const handleSeed = async () => {
    setBusy(true);
    setFeedback(null);
    const res = await seedFrenchHolidays();
    setBusy(false);
    if (!res.ok) setFeedback({ kind: 'err', text: res.error });
    else {
      const r = res.data as { created: number; skipped: number; year: number };
      setFeedback({
        kind: 'ok',
        text: `${r.created} jours fériés ajoutés (${r.skipped} déjà présents) pour ${r.year}–${r.year + 1}.`,
      });
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Supprimer cet événement ?')) return;
    setBusy(true);
    const res = await deleteCalendarEvent(id);
    setBusy(false);
    if (!res.ok) setFeedback({ kind: 'err', text: res.error });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-1.5">
          <button type="button" onClick={() => setMonthOffset((o) => o - 1)} className="grid h-8 w-8 place-items-center rounded-lg text-slate-600 hover:bg-slate-100">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="px-2 text-sm font-bold capitalize text-slate-900 min-w-[150px] text-center">
            {monthName}
          </span>
          <button type="button" onClick={() => setMonthOffset((o) => o + 1)} className="grid h-8 w-8 place-items-center rounded-lg text-slate-600 hover:bg-slate-100">
            <ChevronRight className="h-4 w-4" />
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

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button type="button" onClick={handleSeed} disabled={busy} className="inline-flex items-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-bold text-amber-900 hover:bg-amber-100 disabled:opacity-50">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            Importer les fériés (France)
          </button>
          <button type="button" onClick={() => setCreating(true)} className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-br from-indigo-600 via-blue-600 to-blue-700 px-4 py-2 text-sm font-bold text-white shadow-lg shadow-blue-500/30">
            <Plus className="h-4 w-4" /> Nouvel événement
          </button>
        </div>
      </div>

      {feedback && (
        <div className={`flex items-start gap-2 rounded-xl border px-4 py-2.5 text-sm ${
          feedback.kind === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-red-200 bg-red-50 text-red-900'
        }`}>
          {feedback.kind === 'ok' ? <CheckCircle2 className="h-4 w-4 mt-0.5" /> : <X className="h-4 w-4 mt-0.5" />}
          {feedback.text}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="lg:col-span-2 rounded-2xl bg-white ring-1 ring-slate-200 overflow-hidden">
          <div className="border-b border-slate-100 px-5 py-3.5 flex items-center gap-2">
            <CalendarIcon className="h-4 w-4 text-slate-500" />
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-600">Mois en cours</h3>
            <span className="ml-auto text-xs text-slate-500">{monthEvents.length} événement(s)</span>
          </div>
          <MonthGrid month={month} events={monthEvents} onClickEvent={(e) => setEditing(e)} />
        </section>

        <section className="rounded-2xl bg-white ring-1 ring-slate-200 overflow-hidden">
          <div className="border-b border-slate-100 px-5 py-3.5 flex items-center gap-2">
            <PartyPopper className="h-4 w-4 text-slate-500" />
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-600">À venir</h3>
          </div>
          <ul className="divide-y divide-slate-100 max-h-[600px] overflow-y-auto">
            {upcomingEvents.length === 0 ? (
              <li className="px-5 py-6 text-center text-sm text-slate-500">Aucun événement à venir</li>
            ) : (
              upcomingEvents.map((e) => (
                <li key={e.id} className="group flex items-start gap-3 px-5 py-3 hover:bg-slate-50">
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${TYPE_DOT[e.type]}`} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-bold text-slate-900 truncate">{e.title}</div>
                    <div className="mt-0.5 text-xs text-slate-500">{formatRange(e.startsAt, e.endsAt, e.allDay)}</div>
                    <ScopeBadge event={e} />
                  </div>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100">
                    <button onClick={() => setEditing(e)} className="grid h-7 w-7 place-items-center rounded-md text-slate-500 hover:bg-slate-200 hover:text-slate-900">
                      <Edit2 className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={() => handleDelete(e.id)} className="grid h-7 w-7 place-items-center rounded-md text-red-500 hover:bg-red-100">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </li>
              ))
            )}
          </ul>
        </section>
      </div>

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

function MonthGrid({
  month,
  events,
  onClickEvent,
}: {
  month: Date;
  events: CalendarEvent[];
  onClickEvent: (e: CalendarEvent) => void;
}) {
  const firstDow = (new Date(month.getFullYear(), month.getMonth(), 1).getDay() + 6) % 7;
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const today = new Date();
  const isCurrentMonth =
    today.getFullYear() === month.getFullYear() && today.getMonth() === month.getMonth();

  const byDay = new Map<number, CalendarEvent[]>();
  for (const e of events) {
    const s = new Date(e.startsAt);
    const en = new Date(e.endsAt);
    const startDay = s.getMonth() === month.getMonth() ? s.getDate() : 1;
    const endDay = en.getMonth() === month.getMonth() ? en.getDate() : daysInMonth;
    for (let d = startDay; d <= endDay; d++) {
      const arr = byDay.get(d) ?? [];
      arr.push(e);
      byDay.set(d, arr);
    }
  }

  const cells: Array<{ day: number; isPad?: boolean }> = [];
  for (let i = 0; i < firstDow; i++) cells.push({ day: 0, isPad: true });
  for (let d = 1; d <= daysInMonth; d++) cells.push({ day: d });
  while (cells.length % 7 !== 0) cells.push({ day: 0, isPad: true });

  return (
    <div className="p-4">
      <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2">
        {['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((d, i) => (<div key={i}>{d}</div>))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((c, idx) => {
          const dayEvents = c.day ? byDay.get(c.day) ?? [] : [];
          const isToday = isCurrentMonth && c.day === today.getDate();
          return (
            <div key={idx} className={`min-h-[80px] rounded-xl p-1.5 text-xs ${
              c.isPad ? 'bg-slate-50/40' : isToday ? 'bg-blue-50 ring-1 ring-blue-300' : 'bg-white ring-1 ring-slate-100'
            }`}>
              {!c.isPad && (
                <>
                  <div className={`mb-1 text-right text-[11px] font-bold ${isToday ? 'text-blue-700' : 'text-slate-400'}`}>
                    {c.day}
                  </div>
                  <div className="space-y-0.5">
                    {dayEvents.slice(0, 3).map((e) => (
                      <button key={e.id} type="button" onClick={() => onClickEvent(e)} className={`block w-full truncate rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${TYPE_TONE[e.type]}`} title={e.title}>
                        {e.title}
                      </button>
                    ))}
                    {dayEvents.length > 3 && (
                      <div className="text-[10px] text-slate-500 font-medium">+{dayEvents.length - 3}</div>
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
  years: Array<{ id: string; name: string; status: string }>;
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
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Flag className="h-4 w-4" />}
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
