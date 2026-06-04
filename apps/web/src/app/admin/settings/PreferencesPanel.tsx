'use client';

import { Bell, CalendarClock, Loader2, Mail, Smartphone } from 'lucide-react';
import { useState, useTransition } from 'react';

import {
  setChannelForKindsAction,
  updatePreferenceAction,
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

export function PreferencesPanel({
  initial,
  recipientEmail,
}: {
  initial: PreferenceRow[];
  recipientEmail?: string | null;
}) {
  // Lifted, optimistic source of truth so the column summary + bulk toggles stay
  // in sync with the per-row switches. Seeded once from the server snapshot.
  const [rows, setRows] = useState<PreferenceRow[]>(initial);
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

  return (
    <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/60">
      <div className="border-b border-slate-100 px-6 py-4">
        <h2 className="text-base font-bold text-slate-900">Préférences de notification</h2>
        <p className="mt-1 text-xs text-slate-500">
          Choisissez les événements qui déclenchent une notification, et sur quel canal. Le canal
          in-app alimente la cloche du topbar et la page Notifications ; le canal email envoie un
          message
          {recipientEmail ? (
            <>
              {' '}à <strong className="font-semibold text-slate-700">{recipientEmail}</strong>
            </>
          ) : (
            ' à votre adresse'
          )}{' '}
          pour chaque événement activé.
        </p>
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
        <p className="border-b border-rose-100 bg-rose-50 px-6 py-2 text-[11px] font-semibold text-rose-600">
          {error} — réessayez dans un instant.
        </p>
      )}

      <div className="divide-y divide-slate-100">
        {rows.map((row) => {
          // The weekly digest is an email-only concept: it has no in-app surface,
          // so the In-app / Push cells render a muted, accessible "—" placeholder
          // and only the Email switch is interactive. The row also gets a subtle
          // violet accent + calendar chip so it reads as the "summary" feature.
          const isDigest = row.kind === 'weekly_digest';
          return (
            <div
              key={row.kind}
              className={`flex items-center gap-4 px-6 py-4 ${
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
                </div>
                <p className="mt-0.5 text-xs text-slate-500">{row.description}</p>
              </div>

              <div className="flex items-center gap-3">
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
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                          active ? 'bg-blue-600' : 'bg-slate-300'
                        }`}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
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
        Email activé : les notifications cochées vous sont aussi envoyées par email (le canal email
        est désactivé par défaut, à vous de l&apos;activer). Push arrive prochainement.
      </div>
    </div>
  );
}
