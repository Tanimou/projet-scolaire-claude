'use client';

import { Loader2, Play } from 'lucide-react';
import { useState, useTransition } from 'react';

import { evaluateNowAction } from './actions';

export function EvaluateNowButton() {
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<string | null>(null);

  function run() {
    if (pending) return;
    setFeedback(null);
    startTransition(async () => {
      const r = await evaluateNowAction();
      if (r.ok) {
        const d = (r.data ?? {}) as { rulesRun?: number; detected?: number; createdInstances?: number };
        setFeedback(
          `Évaluation terminée — ${d.rulesRun ?? 0} règles, ${d.detected ?? 0} détections, ${d.createdInstances ?? 0} nouvelles alertes.`,
        );
      } else {
        setFeedback(r.error ?? 'Erreur');
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={run}
        disabled={pending}
        className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
        Lancer l&apos;évaluation
      </button>
      {feedback && (
        <span className="max-w-xs text-[11px] text-slate-500">{feedback}</span>
      )}
    </div>
  );
}
