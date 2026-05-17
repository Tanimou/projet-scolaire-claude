'use client';

import { Loader2 } from 'lucide-react';
import { useState, useTransition } from 'react';

import { toggleRuleAction, type AlertRuleCode } from './actions';

export function AlertRuleToggle({
  code,
  initial,
}: {
  code: AlertRuleCode;
  initial: boolean;
}) {
  const [enabled, setEnabled] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function flip() {
    if (pending) return;
    const next = !enabled;
    setError(null);
    setEnabled(next); // optimistic
    startTransition(async () => {
      const res = await toggleRuleAction(code, next);
      if (!res.ok) {
        setEnabled(!next); // rollback
        setError(res.error ?? 'Erreur');
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-0.5">
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        onClick={flip}
        disabled={pending}
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:cursor-not-allowed ${
          enabled ? 'bg-blue-600' : 'bg-slate-300'
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
            enabled ? 'translate-x-6' : 'translate-x-1'
          }`}
        />
        {pending && (
          <Loader2 className="absolute inset-0 m-auto h-3 w-3 animate-spin text-white" />
        )}
      </button>
      {error && <span className="text-[10px] text-rose-600">{error}</span>}
    </div>
  );
}
