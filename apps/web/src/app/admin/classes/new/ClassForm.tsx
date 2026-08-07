'use client';

import { AlertCircle, BookOpen, CalendarDays, Loader2, Plus, RefreshCw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { createClass } from '../actions';

export interface YearOption {
  value: string;
  label: string;
  hint?: string;
}

export interface LevelGroup {
  id: string;
  name: string;
  color: string | null;
  levels: Array<{ value: string; label: string }>;
}

const NAME_MAX = 40;
const NOTES_MAX = 2000;
const CAPACITY_MIN = 1;
const CAPACITY_MAX = 200;
const DEFAULT_CAPACITY = 30;

/** Mirrors `ClassInfoEditor.isHexColor` — one validation idiom, not a third. */
function isHexColor(v: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(v.trim());
}

const INPUT =
  'block h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 ' +
  'placeholder:text-slate-500 focus-visible:border-blue-500 focus-visible:outline-none ' +
  'focus-visible:ring-2 focus-visible:ring-blue-500/40 disabled:bg-slate-50 disabled:text-slate-500';

/**
 * Create form for a class — the client island of `/admin/classes/new`.
 *
 * Every refusal `POST /classes` can raise (tenant 404 « Année scolaire
 * introuvable » / « Niveau introuvable », cross-school 400, archived-year 400,
 * duplicate 409) is rendered **verbatim** in the `role="alert"` region. The
 * server messages are the reviewed French copy; this form never re-maps a
 * status code to copy of its own and never swallows one.
 */
export function ClassForm({
  yearOptions,
  defaultYearId,
  levelGroups,
}: {
  yearOptions: YearOption[];
  defaultYearId: string;
  levelGroups: LevelGroup[];
}) {
  const router = useRouter();
  const errorRef = useRef<HTMLDivElement | null>(null);

  const [name, setName] = useState('');
  const [academicYearId, setAcademicYearId] = useState(defaultYearId);
  const [gradeLevelId, setGradeLevelId] = useState('');
  const [maxStudents, setMaxStudents] = useState('');
  const [room, setRoom] = useState('');
  const [color, setColor] = useState('');
  const [icon, setIcon] = useState('');
  const [internalNotes, setInternalNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [colorError, setColorError] = useState<string | null>(null);

  // WCAG 3.3.1 — move focus to the alert so a keyboard/screen-reader user is
  // taken to the refusal instead of being left on the submit button.
  useEffect(() => {
    if (error) {
      errorRef.current?.focus();
      errorRef.current?.scrollIntoView({ block: 'nearest' });
    }
  }, [error]);

  const trimmedName = name.trim();
  const cycleOfLevel = levelGroups.find((g) => g.levels.some((l) => l.value === gradeLevelId));
  const previewBg = isHexColor(color)
    ? color.trim()
    : (cycleOfLevel?.color ?? 'oklch(0.62 0.18 250)');
  const previewGlyph = icon.trim() || trimmedName.slice(0, 1).toUpperCase() || '?';

  const capacityNumber = maxStudents.trim() === '' ? undefined : Number(maxStudents);
  const capacityInvalid =
    capacityNumber !== undefined &&
    (!Number.isInteger(capacityNumber) ||
      capacityNumber < CAPACITY_MIN ||
      capacityNumber > CAPACITY_MAX);

  const canSubmit =
    !busy && trimmedName.length > 0 && academicYearId !== '' && gradeLevelId !== '' && !capacityInvalid;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    // `color` is a free `@MaxLength(40)` string server-side and is rendered into
    // a `style` on the classes list. Constrain it to a hex value here rather
    // than widening the field family S-E06-2 just fenced (PF-45).
    if (color.trim() !== '' && !isHexColor(color)) {
      setColorError('Utilisez un code hexadécimal à 6 chiffres, par exemple #2563eb.');
      return;
    }
    setColorError(null);

    setBusy(true);
    setError(null);
    const res = await createClass({
      name: trimmedName,
      academicYearId,
      gradeLevelId,
      // Champ vide → non transmis : le serveur applique son défaut (30 élèves).
      maxStudents: capacityNumber,
      room: room.trim() || undefined,
      color: color.trim() || undefined,
      icon: icon.trim() || undefined,
      internalNotes: internalNotes.trim() || undefined,
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    router.push(`/admin/classes/${res.data.id}`);
  };

  return (
    <form onSubmit={onSubmit} aria-busy={busy} className="space-y-6">
      <p className="text-xs text-slate-600">Les champs suivis de * sont obligatoires.</p>

      <div
        ref={errorRef}
        role="alert"
        tabIndex={-1}
        className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40 rounded-xl"
      >
        {error && (
          <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <div className="min-w-0 flex-1">
              {/* Message serveur restitué tel quel — aucune reformulation cliente. */}
              <p className="font-semibold">{error}</p>
              <button
                type="button"
                onClick={() => router.refresh()}
                className="mt-2 inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 text-xs font-bold text-red-900 hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40"
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden /> Rafraîchir les listes
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 1 — Rattachement pédagogique (le seul volet non modifiable ensuite) */}
      <section className="rounded-2xl bg-white p-5 ring-1 ring-slate-200">
        <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500">
          <CalendarDays className="h-4 w-4" aria-hidden /> Rattachement pédagogique
        </h3>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Année scolaire *" htmlFor="academicYearId">
            <select
              id="academicYearId"
              name="academicYearId"
              value={academicYearId}
              onChange={(e) => setAcademicYearId(e.target.value)}
              required
              aria-required="true"
              disabled={busy}
              aria-describedby="year-hint"
              suppressHydrationWarning
              className={INPUT}
            >
              <option value="">— Choisir une année —</option>
              {yearOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.hint ? `${o.label} — ${o.hint}` : o.label}
                </option>
              ))}
            </select>
            <p id="year-hint" className="mt-1 text-xs text-slate-600">
              Les années archivées ne peuvent plus recevoir de nouvelles classes et ne sont pas
              proposées ici.
            </p>
          </Field>

          <Field label="Niveau *" htmlFor="gradeLevelId">
            <select
              id="gradeLevelId"
              name="gradeLevelId"
              value={gradeLevelId}
              onChange={(e) => setGradeLevelId(e.target.value)}
              required
              aria-required="true"
              disabled={busy}
              suppressHydrationWarning
              className={INPUT}
            >
              <option value="">— Choisir un niveau —</option>
              {levelGroups.map((g) => (
                <optgroup key={g.id} label={g.name}>
                  {g.levels.map((l) => (
                    <option key={l.value} value={l.value}>
                      {l.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <p className="mt-1 text-xs text-slate-600">Les niveaux sont regroupés par cycle.</p>
          </Field>
        </div>
      </section>

      {/* 2 — Identité de la classe */}
      <section className="rounded-2xl bg-white p-5 ring-1 ring-slate-200">
        <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500">
          <BookOpen className="h-4 w-4" aria-hidden /> Identité de la classe
        </h3>

        <div className="mt-4 flex items-end gap-4">
          <div className="min-w-0 flex-1">
            <Field
              label="Nom de la classe *"
              htmlFor="name"
              counter={`${name.length}/${NAME_MAX}`}
              counterWarn={name.length >= NAME_MAX - 4}
            >
              <input
                id="name"
                name="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                aria-required="true"
                maxLength={NAME_MAX}
                disabled={busy}
                placeholder="6e A"
                suppressHydrationWarning
                className={INPUT}
              />
            </Field>
          </div>
          <div className="shrink-0 text-center">
            <span
              aria-hidden
              className="grid h-10 w-10 place-items-center rounded-lg text-sm font-bold text-white transition-colors duration-200 motion-reduce:transition-none"
              style={{ background: previewBg }}
            >
              {previewGlyph}
            </span>
            <span className="mt-1 block text-[10px] text-slate-600">Aperçu</span>
          </div>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Capacité maximale" htmlFor="maxStudents">
            <input
              id="maxStudents"
              name="maxStudents"
              type="number"
              inputMode="numeric"
              min={CAPACITY_MIN}
              max={CAPACITY_MAX}
              step={1}
              value={maxStudents}
              onChange={(e) => setMaxStudents(e.target.value)}
              disabled={busy}
              placeholder={String(DEFAULT_CAPACITY)}
              aria-invalid={capacityInvalid || undefined}
              aria-describedby="capacity-hint"
              suppressHydrationWarning
              className={INPUT}
            />
            <p
              id="capacity-hint"
              className={capacityInvalid ? 'mt-1 text-xs font-semibold text-red-700' : 'mt-1 text-xs text-slate-600'}
            >
              {capacityInvalid
                ? `Indiquez un nombre entier entre ${CAPACITY_MIN} et ${CAPACITY_MAX}.`
                : `Laissez vide pour la valeur par défaut : ${DEFAULT_CAPACITY} élèves.`}
            </p>
          </Field>

          <Field label="Salle" htmlFor="room">
            <input
              id="room"
              name="room"
              value={room}
              onChange={(e) => setRoom(e.target.value)}
              maxLength={40}
              disabled={busy}
              placeholder="B204"
              suppressHydrationWarning
              className={INPUT}
            />
          </Field>

          <Field label="Icône (emoji)" htmlFor="icon">
            <input
              id="icon"
              name="icon"
              value={icon}
              onChange={(e) => setIcon(e.target.value)}
              maxLength={40}
              disabled={busy}
              placeholder="🎓"
              suppressHydrationWarning
              className={INPUT}
            />
          </Field>

          <div>
            <span className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-600">
              Couleur
            </span>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={isHexColor(color) ? color.trim() : '#2563eb'}
                onChange={(e) => setColor(e.target.value)}
                disabled={busy}
                aria-label="Sélecteur de couleur"
                suppressHydrationWarning
                className="h-10 w-12 shrink-0 cursor-pointer rounded-lg border border-slate-200 bg-white p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
              />
              <input
                id="color"
                name="color"
                type="text"
                value={color}
                onChange={(e) => {
                  setColor(e.target.value);
                  setColorError(null);
                }}
                maxLength={40}
                disabled={busy}
                placeholder="#2563eb"
                aria-invalid={colorError ? true : undefined}
                aria-describedby={colorError ? 'color-error' : undefined}
                suppressHydrationWarning
                className={INPUT}
              />
            </div>
            {colorError && (
              <p id="color-error" className="mt-1 text-xs font-semibold text-red-700">
                {colorError}
              </p>
            )}
          </div>
        </div>
      </section>

      {/* 3 — Notes internes. Les « options pédagogiques » (JSONB libre) restent
          la propriété de ClassInfoEditor, sur la fiche de la classe. */}
      <section className="rounded-2xl bg-white p-5 ring-1 ring-slate-200">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">Notes internes</h3>
        <div className="mt-4">
          <Field
            label="Observations internes"
            htmlFor="internalNotes"
            counter={`${internalNotes.length}/${NOTES_MAX}`}
            counterWarn={internalNotes.length >= NOTES_MAX - 100}
          >
            <textarea
              id="internalNotes"
              name="internalNotes"
              value={internalNotes}
              onChange={(e) => setInternalNotes(e.target.value)}
              rows={3}
              maxLength={NOTES_MAX}
              disabled={busy}
              placeholder="Notes réservées à l'équipe administrative…"
              suppressHydrationWarning
              className="block w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-500 focus-visible:border-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 disabled:bg-slate-50"
            />
          </Field>
          <p className="mt-2 text-xs text-slate-600">
            Les options pédagogiques (LV2, section…) se renseignent depuis « Modifier infos » sur la
            liste des classes, une fois la classe créée.
          </p>
        </div>
      </section>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
        <button
          type="button"
          onClick={() => router.back()}
          disabled={busy}
          className="inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-slate-200 bg-white px-5 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 disabled:opacity-60 sm:w-auto"
        >
          Annuler
        </button>
        <button
          type="submit"
          disabled={!canSubmit}
          className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-indigo-600 via-blue-600 to-blue-700 px-5 text-sm font-bold text-white shadow-lg shadow-blue-500/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 disabled:opacity-60 sm:w-auto"
        >
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />
          ) : (
            <Plus className="h-4 w-4" aria-hidden />
          )}
          {busy ? 'Création en cours…' : 'Créer la classe'}
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  htmlFor,
  counter,
  counterWarn,
  children,
}: {
  label: string;
  htmlFor: string;
  counter?: string;
  counterWarn?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <label
          htmlFor={htmlFor}
          className="block text-xs font-bold uppercase tracking-wider text-slate-600"
        >
          {label}
        </label>
        {counter && (
          <span
            aria-hidden
            className={counterWarn ? 'text-[10px] tabular-nums text-amber-700' : 'text-[10px] tabular-nums text-slate-500'}
          >
            {counter}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}
