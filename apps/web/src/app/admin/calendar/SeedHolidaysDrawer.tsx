'use client';

import { FormDrawer } from '@pilotage/ui';
import { AlertCircle, AlertTriangle, CalendarCheck, Info, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { previewFrenchHolidays, seedFrenchHolidays } from './actions';

/**
 * Confirmation surface for the bulk holiday import (S-E06-6 / PF-29).
 *
 * Three invariants this file exists to hold:
 *
 * 1. **The trigger never writes.** Opening this drawer performs a *dry run*
 *    (`dryRun: true`) — a read. `confirm: true` is sent from the submit handler
 *    ONLY, is never defaulted, and is never attached to the preview request
 *    (DNC-12: no bypass, no "ne plus demander", no query-param shortcut).
 * 2. **Every count rendered here comes from the server's own plan**, computed by
 *    the same code path that writes. The client never enumerates the holidays
 *    and never re-implements `computeEaster` (DNC-02/03) — two Easter
 *    implementations that can drift would be a worse defect than the one being
 *    fixed. When the plan is unavailable the drawer states the scope *without*
 *    a count rather than guessing one (DNC-06).
 * 3. **The real scope is named before the write**: both civil years, the
 *    per-row academic-year attachment, and — the audit's actual harm — the part
 *    of the span that no declared academic year covers, so the operator sees
 *    up-front that those rows will be created *unattached* instead of being
 *    silently stamped with the active year.
 */

/** Lower bound of the server DTO (`@Min(2000)`). */
const MIN_SEED_YEAR = 2000;
/**
 * The import emits `year` AND `year + 1`, so the selectable ceiling is one below
 * the DTO's `@Max(2100)` — otherwise the drawer would name a year the API
 * refuses (pre-mortem FM-10).
 */
const MAX_SEED_YEAR = 2099;

export interface SeedYearOption {
  id: string;
  name: string;
  status: string;
  startDate: string;
  endDate: string;
}

/** One row of the endpoint's `academicYearAttachment` breakdown. */
interface AttachmentRow {
  academicYearId: string | null;
  name: string | null;
  count: number;
}

interface SeedPlan {
  /** Civil years the runtime will actually touch — `[year, year + 1]`. */
  years: number[];
  planned: number;
  alreadyPresent: number;
  toCreate: number;
  /** Server-computed per-academic-year breakdown, `null` row included. */
  attachment: AttachmentRow[] | null;
}

type PlanState =
  | { status: 'loading' }
  | { status: 'ready'; plan: SeedPlan }
  /** The endpoint answered something this UI cannot read counts from. */
  | { status: 'unavailable' };

function asFiniteNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * Narrow the endpoint's plan response. Deliberately strict: a partial or
 * unexpected payload yields `null`, which renders the count-free wording — a
 * missing number is honest, an invented one is DNC-06.
 */
function readPlan(data: unknown): SeedPlan | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  const planned = asFiniteNumber(d.planned);
  const alreadyPresent = asFiniteNumber(d.alreadyPresent);
  const toCreate = asFiniteNumber(d.toCreate);
  const years = Array.isArray(d.years)
    ? d.years.filter((y): y is number => typeof y === 'number' && Number.isFinite(y))
    : [];
  if (planned === null || alreadyPresent === null || toCreate === null || years.length === 0) {
    return null;
  }
  const attachment = Array.isArray(d.academicYearAttachment)
    ? d.academicYearAttachment.flatMap<AttachmentRow>((row) => {
        if (!row || typeof row !== 'object') return [];
        const r = row as Record<string, unknown>;
        const count = asFiniteNumber(r.count);
        if (count === null) return [];
        return [
          {
            academicYearId: typeof r.academicYearId === 'string' ? r.academicYearId : null,
            name: typeof r.name === 'string' ? r.name : null,
            count,
          },
        ];
      })
    : null;
  return { years, planned, alreadyPresent, toCreate, attachment };
}

/** Banner copy after a real write — server counts only, never a client guess. */
function applyMessage(data: unknown, requestedYear: number): string {
  const plan = readPlan(data);
  const created = asFiniteNumber((data as Record<string, unknown> | null)?.created);
  const years = plan?.years?.length ? plan.years : [requestedYear, requestedYear + 1];
  if (created === null) return 'Import des jours fériés terminé.';
  const createdText =
    created === 1 ? '1 jour férié ajouté' : `${created} jours fériés ajoutés`;
  const presentText =
    plan === null
      ? ''
      : ` · ${plan.alreadyPresent} déjà ${plan.alreadyPresent === 1 ? 'présent' : 'présents'}`;
  return `${createdText}${presentText} · années civiles ${years.join(' et ')}.`;
}

const DAY_MS = 86_400_000;

function utcDay(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m, d));
}

function addDaysUtc(d: Date, days: number): Date {
  return new Date(d.getTime() + days * DAY_MS);
}

function formatDay(d: Date): string {
  return d.toLocaleDateString('fr-FR', { dateStyle: 'medium', timeZone: 'UTC' });
}

/** Start of the span the import covers: 1 janvier {year}. */
function spanStart(year: number): Date {
  return utcDay(year, 0, 1);
}

/** End of the span: 25 décembre {year + 1} (the last French public holiday). */
function spanEnd(year: number): Date {
  return utcDay(year + 1, 11, 25);
}

/** `YYYY-MM-DD` or a full ISO instant → the UTC day it denotes. */
function parseDay(iso: string): Date | null {
  const t = Date.parse(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  if (Number.isNaN(t)) return null;
  const d = new Date(t);
  return utcDay(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

interface Coverage {
  year: SeedYearOption;
  from: Date;
  to: Date;
}

/** Academic years overlapping the span, clipped to it, earliest first. */
function coveringYears(year: number, years: SeedYearOption[]): Coverage[] {
  const from = spanStart(year);
  const to = spanEnd(year);
  return years
    .flatMap<Coverage>((y) => {
      const s = parseDay(y.startDate);
      const e = parseDay(y.endDate);
      if (!s || !e || e < from || s > to) return [];
      return [{ year: y, from: s < from ? from : s, to: e > to ? to : e }];
    })
    .sort((a, b) => a.from.getTime() - b.from.getTime());
}

/**
 * Parts of the span no declared academic year covers. Holidays falling in these
 * gaps are created with `academicYearId: null` — correct, not missing data. The
 * summer gap (14 juillet, 15 août) is in here for every French school year.
 */
function uncoveredRanges(year: number, covers: Coverage[]): Array<{ from: Date; to: Date }> {
  const to = spanEnd(year);
  const gaps: Array<{ from: Date; to: Date }> = [];
  let cursor = spanStart(year);
  for (const c of covers) {
    if (c.from > cursor) gaps.push({ from: cursor, to: addDaysUtc(c.from, -1) });
    if (addDaysUtc(c.to, 1) > cursor) cursor = addDaysUtc(c.to, 1);
  }
  if (cursor <= to) gaps.push({ from: cursor, to });
  return gaps;
}

interface YearChoice {
  year: number;
  label: string;
}

/**
 * The operator picks a civil year, labelled with the school year that starts in
 * it so the choice reads in the admin's vocabulary. The active academic year is
 * only the *default suggestion* here — visible and overridable, therefore
 * chosen. The server no longer falls back to it (that fallback was PF-29).
 */
function buildYearChoices(years: SeedYearOption[]): YearChoice[] {
  const labels = new Map<number, string>();
  for (const y of years) {
    const start = parseDay(y.startDate);
    if (!start) continue;
    const civil = start.getUTCFullYear();
    if (civil < MIN_SEED_YEAR || civil > MAX_SEED_YEAR || labels.has(civil)) continue;
    labels.set(civil, `${civil} · ${y.name}${y.status === 'active' ? ' (active)' : ''}`);
  }
  const now = new Date().getUTCFullYear();
  for (const civil of [now - 1, now, now + 1]) {
    if (civil < MIN_SEED_YEAR || civil > MAX_SEED_YEAR || labels.has(civil)) continue;
    labels.set(civil, String(civil));
  }
  return [...labels.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([year, label]) => ({ year, label }));
}

function defaultYear(years: SeedYearOption[]): number {
  const active = years.find((y) => y.status === 'active');
  const start = active ? parseDay(active.startDate) : null;
  const civil = start?.getUTCFullYear();
  if (civil && civil >= MIN_SEED_YEAR && civil <= MAX_SEED_YEAR) return civil;
  const now = new Date().getUTCFullYear();
  return Math.min(Math.max(now, MIN_SEED_YEAR), MAX_SEED_YEAR);
}

const SELECT_CLS =
  'block h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 ' +
  'focus-visible:border-blue-500 focus-visible:outline-none focus-visible:ring-2 ' +
  'focus-visible:ring-blue-500/40 disabled:bg-slate-50 disabled:text-slate-500';

export function SeedHolidaysDrawer({
  open,
  onClose,
  years,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  years: SeedYearOption[];
  /** Called with the server-built success sentence once rows are committed. */
  onImported: (message: string) => void;
}) {
  const choices = buildYearChoices(years);
  const [year, setYear] = useState(() => defaultYear(years));
  const [plan, setPlan] = useState<PlanState>({ status: 'loading' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorRef = useRef<HTMLDivElement | null>(null);
  /** Guards against a slow preview landing after a newer one. */
  const previewToken = useRef(0);

  // The plan is a READ (`dryRun: true`): opening the drawer or changing the year
  // writes nothing — no calendar event, no audit row.
  useEffect(() => {
    if (!open) return;
    const token = ++previewToken.current;
    setPlan({ status: 'loading' });
    let cancelled = false;
    void previewFrenchHolidays(year)
      .then((res) => {
        if (cancelled || token !== previewToken.current) return;
        const parsed = res.ok ? readPlan(res.data) : null;
        setPlan(parsed ? { status: 'ready', plan: parsed } : { status: 'unavailable' });
      })
      .catch(() => {
        // Un plan indisponible ne bloque pas : la portée est alors énoncée sans
        // chiffre, jamais avec un chiffre deviné.
        if (!cancelled && token === previewToken.current) setPlan({ status: 'unavailable' });
      });
    return () => {
      cancelled = true;
    };
  }, [open, year]);

  // WCAG 3.3.1 — take a keyboard / screen-reader user to the refusal instead of
  // leaving them on the submit button.
  useEffect(() => {
    if (error) {
      errorRef.current?.focus();
      errorRef.current?.scrollIntoView({ block: 'nearest' });
    }
  }, [error]);

  const submit = useCallback(async () => {
    setBusy(true);
    setError(null);
    // The ONLY place `confirm: true` is produced. The drawer having been opened
    // and read is what that flag asserts.
    const res = await seedFrenchHolidays(year);
    setBusy(false);
    if (!res.ok) {
      // Server message rendered verbatim — no client re-wording of a 400.
      setError(res.error);
      return;
    }
    onImported(applyMessage(res.data, year));
    onClose();
  }, [onClose, onImported, year]);

  const covers = coveringYears(year, years);
  const gaps = uncoveredRanges(year, covers);
  const gapsText =
    gaps
      .slice(0, 3)
      .map((g) => `du ${formatDay(g.from)} au ${formatDay(g.to)}`)
      .join(' ; ') + (gaps.length > 3 ? ' ; …' : '');
  const ready = plan.status === 'ready' ? plan.plan : null;
  const attachmentRows = ready?.attachment?.length ? ready.attachment : null;
  const unattachedCount =
    attachmentRows?.find((row) => row.academicYearId === null)?.count ?? null;
  const spanYears = ready?.years?.length ? ready.years : [year, year + 1];
  const nothingToCreate = ready !== null && ready.toCreate === 0;

  // Aucun compte affiché ⇒ pas de soumission pendant le calcul du plan (AC-7) ;
  // rien à créer ⇒ bouton désactivé plutôt qu'une écriture vide auditée.
  const submitDisabled = plan.status === 'loading' || nothingToCreate;

  const submitLabel =
    ready === null
      ? 'Importer les jours fériés'
      : ready.toCreate === 0
        ? 'Aucun import à effectuer'
        : ready.toCreate === 1
          ? 'Importer 1 jour férié'
          : `Importer ${ready.toCreate} jours fériés`;

  return (
    <FormDrawer
      open={open}
      onClose={onClose}
      title="Importer les jours fériés français"
      description="Les jours fériés déjà enregistrés seront ignorés."
      submitLabel={submitLabel}
      cancelLabel="Annuler"
      onSubmit={submit}
      busy={busy}
      disabledSubmit={submitDisabled}
      size="md"
    >
      <div className="space-y-5" aria-busy={busy}>
        <div
          ref={errorRef}
          role="alert"
          tabIndex={-1}
          className="rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40"
        >
          {error && (
            <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <p className="min-w-0 flex-1">
                <span className="font-semibold">L&apos;import n&apos;a pas abouti :</span> {error}
              </p>
            </div>
          )}
        </div>

        {years.length === 0 && (
          // Informatif, non bloquant : l'import reste valide sans année scolaire
          // déclarée — les événements sont simplement créés sans rattachement.
          <div className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
            <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <p>
              Aucune année scolaire n&apos;est enregistrée : tous les jours fériés seront créés{' '}
              <strong>sans rattachement</strong>. Vous pouvez en déclarer une depuis{' '}
              <a
                href="/admin/academic-years"
                className="font-semibold text-blue-700 underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
              >
                Années scolaires
              </a>
              .
            </p>
          </div>
        )}

        <label className="block">
          <span className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-600">
            Année civile de départ
          </span>
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            disabled={busy}
            aria-required="true"
            aria-describedby="seed-year-hint"
            className={SELECT_CLS}
          >
            {choices.map((c) => (
              <option key={c.year} value={c.year}>
                {c.label}
              </option>
            ))}
          </select>
          <span id="seed-year-hint" className="mt-1 block text-xs text-slate-500">
            L&apos;année est choisie ici : le serveur ne la déduit plus de l&apos;année scolaire
            active.
          </span>
        </label>

        <ul className="space-y-3 text-sm text-slate-700">
          <li className="flex items-start gap-2">
            <CalendarCheck className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" aria-hidden />
            <span>
              <span className="font-bold text-slate-900">
                {spanYears.length} années civiles : {spanYears.join(' et ')}
              </span>
              <span className="block text-slate-600">
                Du {formatDay(spanStart(year))} au {formatDay(spanEnd(year))} : les jours fériés
                français de {spanYears[0]} <em>et</em> de {spanYears[spanYears.length - 1]}.
              </span>
            </span>
          </li>

          <li className="flex items-start gap-2">
            <CalendarCheck className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" aria-hidden />
            <span>
              Type «&nbsp;Jour férié&nbsp;», portée «&nbsp;Toute l&apos;école&nbsp;», visibilité
              «&nbsp;Tous&nbsp;». Journées entières.
            </span>
          </li>

          <li className="flex items-start gap-2">
            <CalendarCheck className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" aria-hidden />
            <span>
              {plan.status === 'loading' ? (
                <span className="inline-flex items-center gap-2 text-slate-600" role="status">
                  <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />
                  Calcul de la portée exacte…
                </span>
              ) : ready === null ? (
                // No count is rendered when the server plan is unreadable: the
                // dialog must never promise a scope it did not measure.
                <span>
                  La portée chiffrée n&apos;a pas pu être calculée. L&apos;import reste limité aux
                  jours fériés de {spanYears.join(' et ')} et ignore ceux déjà présents.
                </span>
              ) : (
                <span>
                  <span className="font-bold text-slate-900">
                    {ready.planned} jours fériés analysés · {ready.toCreate} à créer
                  </span>
                  <span className="block text-slate-600">
                    {ready.alreadyPresent} déjà {ready.alreadyPresent === 1 ? 'présent' : 'présents'}{' '}
                    (même intitulé, même date) — ils ne seront pas dupliqués. Relancer l&apos;import
                    à l&apos;identique ne crée aucun doublon.
                  </span>
                </span>
              )}
            </span>
          </li>

          <li className="flex items-start gap-2">
            <CalendarCheck className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" aria-hidden />
            <span>
              Chaque jour férié est rattaché à l&apos;année scolaire qui contient sa date.
              {/* Répartition renvoyée par le serveur (source de vérité) ; à défaut,
                  les années scolaires qui recouvrent la période, dérivées des
                  bornes déjà chargées par la page. */}
              {attachmentRows !== null ? (
                <span className="mt-1 block space-y-0.5">
                  {attachmentRows.map((row) => (
                    <span key={row.academicYearId ?? 'none'} className="block text-slate-600">
                      {row.name ?? 'Aucune année scolaire'} · {row.count} événement(s)
                    </span>
                  ))}
                </span>
              ) : covers.length === 0 ? (
                <span className="mt-1 block text-slate-600">
                  Aucune année scolaire déclarée ne couvre cette période.
                </span>
              ) : (
                <span className="mt-1 block space-y-0.5">
                  {covers.map((c) => (
                    <span key={c.year.id} className="block text-slate-600">
                      {c.year.name} · du {formatDay(c.from)} au {formatDay(c.to)}
                    </span>
                  ))}
                </span>
              )}
            </span>
          </li>

          {(gaps.length > 0 || (unattachedCount ?? 0) > 0) && (
            <li className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-amber-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>
                {gaps.length === 0
                  ? 'Une partie de la période n’est couverte par aucune année scolaire'
                  : gaps.length === 1
                    ? `Une partie de la période (${gapsText}) n’est couverte par aucune année scolaire`
                    : `Plusieurs parties de la période (${gapsText}) ne sont couvertes par aucune année scolaire`}
                {' : '}ces jours fériés seront créés{' '}
                <strong>sans rattachement</strong> (c&apos;est le cas du 14 juillet et du 15 août).
                C&apos;est correct : leur date n&apos;appartient à aucune année scolaire déclarée.
                {unattachedCount !== null && (
                  <span className="mt-1 block font-bold">
                    {unattachedCount} événement(s) sans rattachement.
                  </span>
                )}
              </span>
            </li>
          )}
        </ul>

        {busy && (
          <p role="status" className="flex items-center gap-2 text-sm text-slate-600">
            <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />
            Import en cours…
          </p>
        )}
      </div>
    </FormDrawer>
  );
}
