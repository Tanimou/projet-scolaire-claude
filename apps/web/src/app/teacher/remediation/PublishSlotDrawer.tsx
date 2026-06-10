'use client';

import { CalendarPlus, Loader2 } from 'lucide-react';
import { useState, useTransition } from 'react';

import { FormDrawer } from '@pilotage/ui';
import type { TeachableSubjectDto } from '@pilotage/contracts';

import { publishSlotAction, type PublishSlotInput } from './remediation-actions';

const WEEKDAYS = [
  { value: 0, label: 'Lundi' },
  { value: 1, label: 'Mardi' },
  { value: 2, label: 'Mercredi' },
  { value: 3, label: 'Jeudi' },
  { value: 4, label: 'Vendredi' },
  { value: 5, label: 'Samedi' },
  { value: 6, label: 'Dimanche' },
] as const;

/**
 * E7-S4 — publish a new remediation availability slot (client island).
 *
 * A teacher offers a recurring weekly slot (jour + horaire) or a one-off dated
 * slot, scoped to a subject they teach (the dropdown is server-filtered to the
 * caller's teaching assignments; the ownership wall re-validates on submit). The
 * capacity is the seat count (the FR-7 concurrency primitive). Kind copy
 * ("Proposez un créneau d'aide", never "obligation"). Full keyboard + focus-trap
 * via the shared `FormDrawer`; an `aria-live` region announces the result.
 */
export function PublishSlotDrawer({
  teachableSubjects,
}: {
  teachableSubjects: TeachableSubjectDto[];
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [kind, setKind] = useState<'recurring_weekly' | 'one_off'>('recurring_weekly');
  const [subjectId, setSubjectId] = useState(teachableSubjects[0]?.id ?? '');
  const [weekday, setWeekday] = useState<number>(1);
  const [startTime, setStartTime] = useState('17:00');
  const [endTime, setEndTime] = useState('18:00');
  const [startsAt, setStartsAt] = useState('');
  const [capacity, setCapacity] = useState(1);

  const noSubjects = teachableSubjects.length === 0;

  const valid =
    !!subjectId &&
    capacity >= 1 &&
    (kind === 'recurring_weekly' ? !!startTime : !!startsAt);

  function reset() {
    setKind('recurring_weekly');
    setSubjectId(teachableSubjects[0]?.id ?? '');
    setWeekday(1);
    setStartTime('17:00');
    setEndTime('18:00');
    setStartsAt('');
    setCapacity(1);
    setError(null);
  }

  function submit() {
    if (!valid) return;
    const input: PublishSlotInput =
      kind === 'recurring_weekly'
        ? { kind, subjectId, weekday, startTime, endTime: endTime || null, capacity }
        : { kind, subjectId, startsAt: new Date(startsAt).toISOString(), capacity };
    setError(null);
    startTransition(async () => {
      const res = await publishSlotAction(input);
      if (res.ok) {
        setOpen(false);
        reset();
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          reset();
          setOpen(true);
        }}
        disabled={noSubjects}
        className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50"
        title={noSubjects ? 'Aucune matière enseignée cette année' : undefined}
      >
        <CalendarPlus className="h-4 w-4" aria-hidden />
        Proposer un créneau
      </button>

      <FormDrawer
        open={open}
        onClose={() => setOpen(false)}
        title="Proposer un créneau de soutien"
        description="Indiquez quand vous pouvez accompagner un élève. L’administration publiera votre soutien aux familles."
        submitLabel="Publier le créneau"
        busy={pending}
        disabledSubmit={!valid}
        onSubmit={submit}
      >
        <div className="space-y-4">
          {error && (
            <p role="alert" className="rounded-lg bg-rose-100/80 px-3 py-2 text-sm font-medium text-rose-800">
              {error}
            </p>
          )}

          <div>
            <label htmlFor="slot-subject" className="block text-sm font-semibold text-slate-700">
              Matière
            </label>
            <select
              id="slot-subject"
              value={subjectId}
              onChange={(e) => setSubjectId(e.target.value)}
              className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 shadow-sm focus-visible:border-indigo-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
            >
              {teachableSubjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <fieldset>
            <legend className="text-sm font-semibold text-slate-700">Type de créneau</legend>
            <div className="mt-1.5 flex gap-2">
              {(
                [
                  { v: 'recurring_weekly', label: 'Hebdomadaire' },
                  { v: 'one_off', label: 'Ponctuel' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.v}
                  type="button"
                  aria-pressed={kind === opt.v}
                  onClick={() => setKind(opt.v)}
                  className={`min-h-11 flex-1 rounded-lg px-3 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${
                    kind === opt.v
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </fieldset>

          {kind === 'recurring_weekly' ? (
            <>
              <div>
                <label htmlFor="slot-weekday" className="block text-sm font-semibold text-slate-700">
                  Jour
                </label>
                <select
                  id="slot-weekday"
                  value={weekday}
                  onChange={(e) => setWeekday(Number(e.target.value))}
                  className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 shadow-sm focus-visible:border-indigo-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
                >
                  {WEEKDAYS.map((d) => (
                    <option key={d.value} value={d.value}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="slot-start" className="block text-sm font-semibold text-slate-700">
                    Début
                  </label>
                  <input
                    id="slot-start"
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 shadow-sm focus-visible:border-indigo-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
                  />
                </div>
                <div>
                  <label htmlFor="slot-end" className="block text-sm font-semibold text-slate-700">
                    Fin
                  </label>
                  <input
                    id="slot-end"
                    type="time"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 shadow-sm focus-visible:border-indigo-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
                  />
                </div>
              </div>
            </>
          ) : (
            <div>
              <label htmlFor="slot-datetime" className="block text-sm font-semibold text-slate-700">
                Date et heure
              </label>
              <input
                id="slot-datetime"
                type="datetime-local"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 shadow-sm focus-visible:border-indigo-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
              />
            </div>
          )}

          <div>
            <label htmlFor="slot-capacity" className="block text-sm font-semibold text-slate-700">
              Nombre de places
            </label>
            <input
              id="slot-capacity"
              type="number"
              min={1}
              max={50}
              value={capacity}
              onChange={(e) => setCapacity(Math.max(1, Number(e.target.value) || 1))}
              className="mt-1.5 w-28 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 shadow-sm focus-visible:border-indigo-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
            />
            <p className="mt-1 text-xs text-slate-500">
              Le nombre d’élèves que vous pouvez accompagner sur ce créneau.
            </p>
          </div>

          {pending && (
            <p className="flex items-center gap-1.5 text-xs text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />
              Publication en cours…
            </p>
          )}
        </div>
      </FormDrawer>
    </>
  );
}
