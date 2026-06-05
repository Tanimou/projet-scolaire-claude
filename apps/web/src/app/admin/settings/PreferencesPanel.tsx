'use client';

import {
  Bell,
  BellOff,
  CalendarClock,
  Loader2,
  Mail,
  Smartphone,
  Zap,
} from 'lucide-react';
import { useRef, useState, useTransition } from 'react';

import {
  setCadenceForKindsAction,
  setChannelForKindsAction,
  updatePreferenceAction,
  type NotificationCadenceCode,
  type NotificationKindCode,
  type UpdatePreferencePatch,
} from './preferences-actions';

export interface PreferenceRow {
  kind: NotificationKindCode;
  label: string;
  description: string;
  inAppEnabled: boolean;
  emailEnabled: boolean;
  pushEnabled: boolean;
  // E5-S3 — per-kind email cadence. The server defaults absent rows to `instant`,
  // so this is always present in the snapshot; default here too for resilience.
  cadence?: NotificationCadenceCode;
}

type Channel = 'inAppEnabled' | 'emailEnabled' | 'pushEnabled';

interface ChannelMeta {
  key: Channel;
  label: string;
  icon: typeof Bell;
  comingSoon?: boolean;
  /** Tailwind accent for the column header icon chip. */
  tint: string;
}

const CHANNELS: ChannelMeta[] = [
  { key: 'inAppEnabled', label: 'In-app', icon: Bell, tint: 'bg-blue-50 text-blue-600 ring-blue-100' },
  { key: 'emailEnabled', label: 'Email', icon: Mail, tint: 'bg-violet-50 text-violet-600 ring-violet-100' },
  {
    key: 'pushEnabled',
    label: 'Push',
    icon: Smartphone,
    comingSoon: true,
    tint: 'bg-slate-100 text-slate-400 ring-slate-200',
  },
];

/** Fixed column width so the header chips line up with each row's switches. */
const COL = 'w-[64px] shrink-0';

// ── Cadence model (E5-S3) ────────────────────────────────────────────────────
// Cadence governs the *email* channel frequency only — it composes with, never
// replaces, the channel switches. Labels frame "how often we reach you", never a
// judgement on the child (cahier tone mandate). The user-facing "Off" affordance
// collapses both `cadence='off'` and `emailEnabled=false` into one calm state.

interface CadenceMeta {
  value: NotificationCadenceCode;
  label: string;
  icon: typeof Zap;
  hint: string;
}

const CADENCE_OPTIONS: CadenceMeta[] = [
  { value: 'instant', label: 'Instant', icon: Zap, hint: 'Immédiatement, à chaque événement' },
  {
    value: 'daily_digest',
    label: 'Résumé quotidien',
    icon: CalendarClock,
    hint: 'Une fois par jour, regroupé',
  },
  { value: 'off', label: 'Off', icon: BellOff, hint: 'Ne pas m’envoyer d’email pour cela' },
];

/** The per-event kinds the cadence mute targets (the weekly digest is excluded). */
function muteableKinds(rows: PreferenceRow[]): NotificationKindCode[] {
  return rows.filter((r) => r.kind !== 'weekly_digest').map((r) => r.kind);
}

export function PreferencesPanel({
  initial,
  recipientEmail,
}: {
  initial: PreferenceRow[];
  recipientEmail?: string | null;
}) {
  // Lifted, optimistic source of truth so the column summary + bulk toggles stay
  // in sync with the per-row switches. Seeded once from the server snapshot;
  // normalise the cadence default (absent → instant, matching the server).
  const [rows, setRows] = useState<PreferenceRow[]>(() =>
    initial.map((r) => ({ ...r, cadence: r.cadence ?? 'instant' })),
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function flipCell(kind: NotificationKindCode, channel: Channel) {
    if (busy) return;
    const row = rows.find((r) => r.kind === kind);
    if (!row) return;
    const next = !row[channel];
    const cellId = `${kind}:${channel}`;
    setRows((prev) => prev.map((r) => (r.kind === kind ? { ...r, [channel]: next } : r)));
    setBusy(cellId);
    setError(null);
    startTransition(async () => {
      const patch: UpdatePreferencePatch = { [channel]: next };
      const res = await updatePreferenceAction(kind, patch);
      if (!res.ok) {
        setRows((prev) => prev.map((r) => (r.kind === kind ? { ...r, [channel]: !next } : r)));
        setError(res.error ?? 'Erreur');
      }
      setBusy(null);
    });
  }

  function setCadence(kind: NotificationKindCode, next: NotificationCadenceCode) {
    if (busy) return;
    const row = rows.find((r) => r.kind === kind);
    if (!row || (row.cadence ?? 'instant') === next) return;
    const prevCadence = row.cadence ?? 'instant';
    const cellId = `${kind}:cadence`;
    setRows((prev) => prev.map((r) => (r.kind === kind ? { ...r, cadence: next } : r)));
    setBusy(cellId);
    setError(null);
    startTransition(async () => {
      const res = await updatePreferenceAction(kind, { cadence: next });
      if (!res.ok) {
        setRows((prev) => prev.map((r) => (r.kind === kind ? { ...r, cadence: prevCadence } : r)));
        setError(res.error ?? 'Erreur');
      }
      setBusy(null);
    });
  }

  function bulkChannel(channel: Channel, enabled: boolean) {
    if (busy) return;
    const before = rows;
    const cellId = `bulk:${channel}`;
    // The weekly digest is email-only — exclude it from In-app / Push bulk toggles.
    const targetKinds = rows
      .filter((r) => channel === 'emailEnabled' || r.kind !== 'weekly_digest')
      .map((r) => r.kind);
    const isTarget = (kind: NotificationKindCode) => targetKinds.includes(kind);
    setRows((prev) => prev.map((r) => (isTarget(r.kind) ? { ...r, [channel]: enabled } : r)));
    setBusy(cellId);
    setError(null);
    startTransition(async () => {
      const res = await setChannelForKindsAction(targetKinds, channel, enabled);
      if (!res.ok) {
        // Partial failure: keep the channel value only for kinds that actually
        // landed server-side, revert the rest to their pre-bulk value.
        const landed = new Set(res.succeededKinds);
        setRows(before.map((r) => (landed.has(r.kind) ? { ...r, [channel]: enabled } : r)));
        setError(res.error ?? 'Erreur');
      }
      setBusy(null);
    });
  }

  function bulkCadence(next: NotificationCadenceCode) {
    if (busy) return;
    const before = rows;
    const targetKinds = muteableKinds(rows);
    const isTarget = (kind: NotificationKindCode) => targetKinds.includes(kind);
    setBusy('bulk:cadence');
    setError(null);
    setRows((prev) => prev.map((r) => (isTarget(r.kind) ? { ...r, cadence: next } : r)));
    startTransition(async () => {
      const res = await setCadenceForKindsAction(targetKinds, next);
      if (!res.ok) {
        const landed = new Set(res.succeededKinds);
        setRows(before.map((r) => (landed.has(r.kind) ? { ...r, cadence: next } : r)));
        setError(res.error ?? 'Erreur');
      }
      setBusy(null);
    });
  }

  // Cadence mute header state: are ALL per-event kinds currently muted (`off`)?
  const muteable = rows.filter((r) => r.kind !== 'weekly_digest');
  const allMuted = muteable.length > 0 && muteable.every((r) => (r.cadence ?? 'instant') === 'off');

  return (
    <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/60">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-6 py-4">
        <div className="min-w-0">
          <h2 className="text-base font-bold text-slate-900">Préférences de notification</h2>
          <p className="mt-1 max-w-2xl text-xs text-slate-500">
            Choisissez les événements qui déclenchent une notification, sur quel canal, et{' '}
            <strong className="font-semibold text-slate-700">à quelle fréquence</strong> nous vous
            contactons par email. Le canal in-app alimente la cloche du topbar et la page
            Notifications ; le canal email envoie un message
            {recipientEmail ? (
              <>
                {' '}à <strong className="font-semibold text-slate-700">{recipientEmail}</strong>
              </>
            ) : (
              ' à votre adresse'
            )}
            . Vous gardez le contrôle, et vous pouvez changer à tout moment.
          </p>
        </div>
        {/* Global cadence mute — sets every per-event kind to "Off" (reversible). */}
        <button
          type="button"
          disabled={!!busy}
          onClick={() => bulkCadence(allMuted ? 'instant' : 'off')}
          aria-pressed={allMuted}
          className={`inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold ring-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 disabled:cursor-not-allowed disabled:opacity-50 ${
            allMuted
              ? 'bg-blue-600 text-white ring-blue-600 hover:bg-blue-700'
              : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50 hover:text-slate-900'
          }`}
        >
          {busy === 'bulk:cadence' ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : allMuted ? (
            <Zap className="h-3.5 w-3.5" aria-hidden />
          ) : (
            <BellOff className="h-3.5 w-3.5" aria-hidden />
          )}
          {allMuted ? 'Tout réactiver' : 'Tout mettre en sourdine'}
        </button>
      </div>

      {/* Column header: icon + live count + bulk action per channel. */}
      <div className="flex items-end gap-4 border-b border-slate-100 bg-slate-50/70 px-6 py-3">
        <div className="min-w-0 flex-1">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
            Événement
          </span>
        </div>
        <div className="flex items-start gap-3">
          {CHANNELS.map((ch) => {
            // The weekly digest is email-only: it doesn't count toward the
            // In-app / Push column totals or their bulk "tout activer".
            const applicable = rows.filter(
              (r) => ch.key === 'emailEnabled' || r.kind !== 'weekly_digest',
            );
            const count = applicable.filter((r) => r[ch.key]).length;
            const total = applicable.length;
            const allOn = total > 0 && count === total;
            const Icon = ch.icon;
            const bulkBusy = busy === `bulk:${ch.key}`;
            return (
              <div key={ch.key} className={`flex flex-col items-center gap-1 ${COL}`}>
                <span
                  className={`inline-flex h-7 w-7 items-center justify-center rounded-lg ring-1 ${ch.tint}`}
                >
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <span
                  className={`text-[10px] font-bold uppercase tracking-wider ${
                    ch.comingSoon ? 'text-slate-400' : 'text-slate-600'
                  }`}
                >
                  {ch.label}
                </span>
                {ch.comingSoon ? (
                  <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-600 ring-1 ring-amber-100">
                    Bientôt
                  </span>
                ) : (
                  <>
                    <span
                      className={`text-[10px] font-bold tabular-nums ${
                        count === 0 ? 'text-slate-400' : 'text-slate-700'
                      }`}
                    >
                      {count}/{total}
                    </span>
                    <button
                      type="button"
                      disabled={!!busy || total === 0}
                      onClick={() => bulkChannel(ch.key, !allOn)}
                      className="inline-flex items-center gap-0.5 text-[9px] font-bold uppercase tracking-wide text-slate-500 underline-offset-2 transition-colors hover:text-blue-600 hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {bulkBusy && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
                      {allOn ? 'Tout désact.' : 'Tout activer'}
                    </button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {error && (
        <p
          role="alert"
          className="border-b border-rose-100 bg-rose-50 px-6 py-2 text-[11px] font-semibold text-rose-600"
        >
          {error} — le réglage n&apos;a pas pu être enregistré, réessayez.
        </p>
      )}

      <div className="divide-y divide-slate-100">
        {rows.map((row) => {
          // The weekly digest is an email-only concept: it has no in-app surface,
          // so the In-app / Push cells render a muted, accessible "—" placeholder
          // and only the Email switch is interactive. It is its own "summary"
          // feature (violet accent + calendar chip) and is EXCLUDED from the
          // per-event cadence selector + the global mute.
          const isDigest = row.kind === 'weekly_digest';
          const cadence = row.cadence ?? 'instant';
          return (
            <div
              key={row.kind}
              className={`flex flex-col gap-4 px-6 py-4 lg:flex-row lg:items-center ${
                isDigest ? 'border-l-[3px] border-violet-400 bg-violet-50/30' : ''
              }`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  {isDigest && (
                    <span
                      aria-hidden
                      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-violet-50 text-violet-600 ring-1 ring-violet-100"
                    >
                      <CalendarClock className="h-3.5 w-3.5" />
                    </span>
                  )}
                  <h3 className="text-sm font-bold text-slate-900">{row.label}</h3>
                  {isDigest && row.emailEnabled && (
                    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 ring-1 ring-emerald-100">
                      Activé · prochain envoi lundi
                    </span>
                  )}
                  {!isDigest && cadence === 'daily_digest' && row.emailEnabled && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-bold text-sky-700 ring-1 ring-sky-100">
                      <CalendarClock className="h-3 w-3" aria-hidden />
                      Résumé quotidien · un email par jour
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-slate-500">{row.description}</p>

                {/* Per-event cadence selector — the primary email-frequency control.
                    Disabled-with-hint when email is off (cadence only governs email). */}
                {!isDigest && (
                  <CadenceSelect
                    kind={row.kind}
                    label={row.label}
                    value={cadence}
                    emailEnabled={row.emailEnabled}
                    busy={busy === `${row.kind}:cadence`}
                    disabled={!!busy}
                    onChange={(next) => setCadence(row.kind, next)}
                  />
                )}
              </div>

              <div className="flex items-center gap-3 lg:shrink-0">
                {CHANNELS.map((ch) => {
                  // In-app / Push are not applicable to the email-only digest.
                  if (isDigest && ch.key !== 'emailEnabled') {
                    return (
                      <div key={ch.key} className={`flex justify-center ${COL}`}>
                        <span
                          className="text-sm font-bold text-slate-400"
                          aria-label={`${ch.label} non applicable : le résumé est envoyé par email`}
                          title="Le résumé est envoyé par email"
                        >
                          —
                        </span>
                      </div>
                    );
                  }
                  const active = row[ch.key];
                  const cellBusy = busy === `${row.kind}:${ch.key}` || busy === `bulk:${ch.key}`;
                  const ariaLabel =
                    isDigest && ch.key === 'emailEnabled'
                      ? 'Recevoir le résumé hebdomadaire par email'
                      : `${ch.label} pour ${row.label}`;
                  return (
                    <div key={ch.key} className={`flex justify-center ${COL}`}>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={active}
                        aria-label={ariaLabel}
                        disabled={!!busy || ch.comingSoon}
                        onClick={() => flipCell(row.kind, ch.key)}
                        title={ch.comingSoon ? 'Canal disponible prochainement' : undefined}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 disabled:cursor-not-allowed disabled:opacity-50 ${
                          active ? 'bg-blue-600' : 'bg-slate-300'
                        }`}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform motion-reduce:transition-none ${
                            active ? 'translate-x-6' : 'translate-x-1'
                          }`}
                        />
                        {cellBusy && (
                          <Loader2 className="absolute inset-0 m-auto h-3 w-3 animate-spin text-white" />
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <div className="border-t border-slate-100 bg-slate-50 px-6 py-3 text-[11px] text-slate-500">
        La <strong className="font-semibold text-slate-600">fréquence</strong> ne s&apos;applique
        qu&apos;au canal email : <em>Instant</em> envoie un email à chaque événement,{' '}
        <em>Résumé quotidien</em> les regroupe en un seul email par jour, <em>Off</em> met cette
        catégorie en pause (réversible à tout moment). Push arrive prochainement.
      </div>
    </div>
  );
}

// =============================================================================
// CadenceSelect — keyboard radiogroup (Instant / Résumé quotidien / Off)
// =============================================================================
// Reuses the E3-S3 severity segmented-control pattern: role="radiogroup" with
// roving tabindex, ArrowLeft/Right/Up/Down navigation, Enter/Space select, a
// visible focus ring, ≥44px targets, and icon+text (never colour-alone). Cadence
// governs the EMAIL channel only, so when email is off the group is disabled with
// a programmatic hint — never silently ignored (WCAG SC 3.3 / cahier tone).

function CadenceSelect({
  kind,
  label,
  value,
  emailEnabled,
  busy,
  disabled,
  onChange,
}: {
  kind: NotificationKindCode;
  label: string;
  value: NotificationCadenceCode;
  emailEnabled: boolean;
  busy: boolean;
  disabled: boolean;
  onChange: (next: NotificationCadenceCode) => void;
}) {
  const groupDisabled = !emailEnabled;
  const hintId = `cadence-hint-${kind}`;
  // Refs let arrow-key navigation move DOM focus to the newly-selected option,
  // matching the radiogroup roving-tabindex contract (focus follows selection).
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);

  function move(currentIndex: number, dir: 1 | -1) {
    if (groupDisabled) return;
    const n = CADENCE_OPTIONS.length;
    const nextIndex = (currentIndex + dir + n) % n;
    const next = CADENCE_OPTIONS[nextIndex];
    if (next) {
      onChange(next.value);
      optionRefs.current[nextIndex]?.focus();
    }
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <span
        id={`cadence-label-${kind}`}
        className="text-[10px] font-bold uppercase tracking-wider text-slate-500"
      >
        Fréquence email
      </span>
      <div
        role="radiogroup"
        aria-labelledby={`cadence-label-${kind}`}
        aria-describedby={groupDisabled ? hintId : undefined}
        aria-disabled={groupDisabled || undefined}
        className="inline-flex flex-wrap gap-1.5"
      >
        {CADENCE_OPTIONS.map((opt, i) => {
          const active = value === opt.value;
          const Icon = opt.icon;
          // Roving tabindex: only the selected option is tabbable. When the group
          // is disabled (email off) we use aria-disabled — NOT the native `disabled`
          // attribute — so the selected option stays in the tab order: the radiogroup
          // remains keyboard/AT-reachable and its aria-describedby hint is announced on
          // focus (a native-disabled button is pruned from the tab order and overrides
          // tabIndex). Selection is kept inert by the !groupDisabled guards below.
          const tabbable = active;
          return (
            <button
              key={opt.value}
              ref={(el) => {
                optionRefs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={active}
              aria-disabled={groupDisabled || undefined}
              aria-label={`${opt.label} — ${opt.hint}, pour ${label}`}
              tabIndex={tabbable ? 0 : -1}
              disabled={disabled}
              onClick={() => !groupDisabled && onChange(opt.value)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                  e.preventDefault();
                  move(i, 1);
                } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                  e.preventDefault();
                  move(i, -1);
                } else if (e.key === ' ' || e.key === 'Enter') {
                  e.preventDefault();
                  if (!groupDisabled) onChange(opt.value);
                }
              }}
              className={`inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 motion-reduce:transition-none disabled:cursor-not-allowed ${
                groupDisabled
                  ? active
                    ? 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400'
                    : 'cursor-not-allowed border-slate-200 bg-white text-slate-300'
                  : active
                    ? 'border-blue-500 bg-blue-50 text-blue-700 shadow-sm'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              {busy && active ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <Icon className="h-3.5 w-3.5" aria-hidden />
              )}
              {opt.label}
            </button>
          );
        })}
      </div>
      {groupDisabled && (
        <span id={hintId} className="inline-flex items-center gap-1 text-[11px] text-slate-500">
          <Mail className="h-3 w-3" aria-hidden />
          Activez l&apos;email pour choisir la fréquence
        </span>
      )}
    </div>
  );
}
