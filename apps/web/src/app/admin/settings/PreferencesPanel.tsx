'use client';

import { Loader2 } from 'lucide-react';
import { useState, useTransition } from 'react';

import {
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

const CHANNELS: Array<{ key: Channel; label: string; comingSoon?: boolean }> = [
  { key: 'inAppEnabled', label: 'In-app' },
  { key: 'emailEnabled', label: 'Email' },
  { key: 'pushEnabled', label: 'Push', comingSoon: true },
];

export function PreferencesPanel({ initial }: { initial: PreferenceRow[] }) {
  return (
    <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/60">
      <div className="border-b border-slate-100 px-6 py-4">
        <h2 className="text-base font-bold text-slate-900">Préférences de notification</h2>
        <p className="mt-1 text-xs text-slate-500">
          Choisissez les événements qui déclenchent une notification, et sur quel canal. Le canal
          in-app alimente la cloche du topbar et la page Notifications ; le canal email envoie un
          message à votre adresse pour chaque événement activé.
        </p>
      </div>

      <div className="divide-y divide-slate-100">
        {initial.map((row) => (
          <PreferenceRowComponent key={row.kind} row={row} />
        ))}
      </div>

      <div className="border-t border-slate-100 bg-slate-50 px-6 py-3 text-[11px] text-slate-500">
        Email activé : les notifications cochées vous sont aussi envoyées par email (le canal email
        est désactivé par défaut, à vous de l'activer). Push arrive prochainement.
      </div>
    </div>
  );
}

function PreferenceRowComponent({ row }: { row: PreferenceRow }) {
  const [optimistic, setOptimistic] = useState({
    inAppEnabled: row.inAppEnabled,
    emailEnabled: row.emailEnabled,
    pushEnabled: row.pushEnabled,
  });
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function flip(channel: Channel) {
    if (pending) return;
    const next = !optimistic[channel];
    const patch: UpdatePreferencePatch = { [channel]: next };
    setOptimistic((prev) => ({ ...prev, [channel]: next }));
    setError(null);
    startTransition(async () => {
      const res = await updatePreferenceAction(row.kind, patch);
      if (!res.ok) {
        setOptimistic((prev) => ({ ...prev, [channel]: !next })); // rollback
        setError(res.error ?? 'Erreur');
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-4 px-6 py-4">
      <div className="min-w-0 flex-1">
        <h3 className="text-sm font-bold text-slate-900">{row.label}</h3>
        <p className="text-xs text-slate-500">{row.description}</p>
        {error && <p className="mt-1 text-[10px] text-rose-600">{error}</p>}
      </div>

      <div className="flex items-center gap-3">
        {CHANNELS.map((ch) => {
          const active = optimistic[ch.key];
          return (
            <div key={ch.key} className="flex flex-col items-center gap-1">
              <button
                type="button"
                role="switch"
                aria-checked={active}
                aria-label={`${ch.label} pour ${row.label}`}
                disabled={pending || ch.comingSoon}
                onClick={() => flip(ch.key)}
                title={ch.comingSoon ? 'Canal disponible bientôt (R8.2)' : undefined}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                  active ? 'bg-blue-600' : 'bg-slate-300'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                    active ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
                {pending && (
                  <Loader2 className="absolute inset-0 m-auto h-3 w-3 animate-spin text-white" />
                )}
              </button>
              <span
                className={`text-[10px] font-bold uppercase tracking-wider ${
                  ch.comingSoon ? 'text-slate-400' : 'text-slate-600'
                }`}
              >
                {ch.label}
                {ch.comingSoon && <span className="ml-0.5 text-amber-600">•</span>}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
