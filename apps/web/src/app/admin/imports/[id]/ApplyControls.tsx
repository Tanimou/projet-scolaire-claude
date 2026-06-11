'use client';

import { AlertTriangle, Check, CheckCircle2, Loader2, RotateCcw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { applyImport, rollbackImport } from '../actions';

export function ApplyControls({ batchId, invalidCount }: { batchId: string; invalidCount: number }) {
  const router = useRouter();
  const [mode, setMode] = useState<'all_or_nothing' | 'skip_invalid'>(
    invalidCount === 0 ? 'all_or_nothing' : 'skip_invalid',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onApply = async () => {
    if (!confirm(`Appliquer cet import (${mode}) ? Cette action peut être annulée dans les 24h.`)) return;
    setBusy(true);
    setError(null);
    // Async (E11-S1): the apply is now enqueued onto the `imports` queue and returns
    // immediately with the batch in `queued`. `router.refresh()` flips the page into
    // the live progress strip, which then auto-polls to terminal.
    const res = await applyImport(batchId, mode);
    setBusy(false);
    if (!res.ok) setError(res.error);
    else router.refresh();
  };

  return (
    <div className="rounded-2xl border border-blue-200 bg-blue-50/50 p-5">
      <h3 className="text-sm font-bold text-slate-900">Prêt à appliquer ?</h3>
      <p className="mt-1 text-xs text-slate-700">
        Choisissez comment traiter les éventuelles lignes invalides. L&apos;application est mise en
        file d&apos;attente puis exécutée en arrière-plan — vous pourrez suivre l&apos;avancement en
        direct sans rester sur cette page. En cas d&apos;échec d&apos;une ligne valide en mode
        all-or-nothing, aucune donnée n&apos;est conservée.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <ModeOption
          checked={mode === 'all_or_nothing'}
          onChange={() => setMode('all_or_nothing')}
          title="All-or-nothing"
          body="N'applique que si 100 % des lignes sont valides. Le plus sûr."
          disabled={invalidCount > 0}
          disabledHint={invalidCount > 0 ? `${invalidCount} ligne(s) invalide(s) — impossible.` : undefined}
        />
        <ModeOption
          checked={mode === 'skip_invalid'}
          onChange={() => setMode('skip_invalid')}
          title="Skip invalid"
          body="Applique les lignes valides et ignore les invalides. Utile pour traiter le valide tout de suite."
        />
      </div>

      {error && (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-900">
          {error}
        </div>
      )}

      <div className="mt-5">
        <button
          type="button"
          onClick={onApply}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-indigo-600 via-blue-600 to-blue-700 px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-blue-500/30 disabled:opacity-70"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
          {busy ? 'Mise en file…' : 'Appliquer l\'import'}
        </button>
      </div>
    </div>
  );
}

function ModeOption({
  checked,
  onChange,
  title,
  body,
  disabled,
  disabledHint,
}: {
  checked: boolean;
  onChange: () => void;
  title: string;
  body: string;
  disabled?: boolean;
  disabledHint?: string;
}) {
  return (
    <label
      className={`relative flex cursor-pointer items-start gap-3 rounded-xl border-2 p-3 transition ${
        disabled
          ? 'cursor-not-allowed border-slate-200 bg-slate-100 opacity-60'
          : checked
            ? 'border-blue-500 bg-blue-50'
            : 'border-slate-200 bg-white hover:bg-slate-50'
      }`}
    >
      <input
        type="radio"
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        className="mt-1 h-4 w-4 shrink-0"
      />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-bold text-slate-900">{title}</div>
        <p className="mt-0.5 text-xs text-slate-600">{body}</p>
        {disabledHint && (
          <div className="mt-2 inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-red-700">
            <AlertTriangle className="h-3 w-3" />
            {disabledHint}
          </div>
        )}
      </div>
      {checked && !disabled && (
        <div className="absolute right-2 top-2 grid h-5 w-5 place-items-center rounded-full bg-blue-600 text-white">
          <Check className="h-3 w-3" strokeWidth={3} />
        </div>
      )}
    </label>
  );
}

export function RollbackButtonClient({ batchId, isSync }: { batchId: string; isSync?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const noun = isSync ? 'cette synchronisation' : 'cet import';
  const onRollback = async () => {
    if (
      !confirm(
        `Annuler ${noun} ? Toutes les entités créées seront supprimées (les entités existantes restent intactes).`,
      )
    )
      return;
    setBusy(true);
    const res = await rollbackImport(batchId);
    setBusy(false);
    if (!res.ok) alert(res.error);
    else router.refresh();
  };
  return (
    <button
      type="button"
      onClick={onRollback}
      disabled={busy}
      className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-amber-600 px-4 py-2 text-xs font-bold text-white shadow-md hover:bg-amber-700 disabled:opacity-70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
      {busy ? 'Annulation…' : isSync ? 'Annuler cette synchro' : 'Annuler cet import'}
    </button>
  );
}
