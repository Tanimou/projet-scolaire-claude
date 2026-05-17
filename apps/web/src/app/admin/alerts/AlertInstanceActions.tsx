'use client';

import { Check, Eye, Loader2, X } from 'lucide-react';
import { useState, useTransition } from 'react';

import {
  acknowledgeAlertAction,
  dismissAlertAction,
  resolveAlertAction,
} from './actions';

type Status = 'open' | 'acknowledged' | 'resolved' | 'dismissed';

export function AlertInstanceActions({
  id,
  status,
}: {
  id: string;
  status: Status;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    if (pending) return;
    setError(null);
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) setError(r.error ?? 'Erreur');
    });
  }

  if (status === 'resolved' || status === 'dismissed') {
    return <span className="text-[11px] text-slate-400">—</span>;
  }

  return (
    <div className="flex flex-col items-end gap-0.5">
      <div className="inline-flex items-center gap-1">
        {status === 'open' && (
          <button
            type="button"
            onClick={() => run(() => acknowledgeAlertAction(id))}
            disabled={pending}
            title="Marquer comme vue"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-sky-50 text-sky-700 transition hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}
          </button>
        )}
        <button
          type="button"
          onClick={() => run(() => resolveAlertAction(id))}
          disabled={pending}
          title="Résoudre"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-emerald-50 text-emerald-700 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
        </button>
        <button
          type="button"
          onClick={() => run(() => dismissAlertAction(id))}
          disabled={pending}
          title="Ignorer"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-slate-100 text-slate-600 transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3.5 w-3.5" />}
        </button>
      </div>
      {error && <span className="text-[10px] text-rose-600">{error}</span>}
    </div>
  );
}
