'use client';

import { AlertTriangle, ArrowRight, Check, Loader2, ShieldCheck } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState, useTransition } from 'react';

import { FormDrawer } from '@pilotage/ui';

import { resolveImportConflict } from '../actions';
import type { BatchRow, ConflictField } from './types';

type Decision = 'keep_current' | 'take_source';

/** Human label for the entity being arbitrated — best-effort from the payload. */
function entityLabel(row: BatchRow): string {
  const p = row.payload ?? {};
  const first = typeof p.firstName === 'string' ? p.firstName : '';
  const last = typeof p.lastName === 'string' ? p.lastName : '';
  const name = `${first} ${last}`.trim();
  if (name) return name;
  const ref = typeof p.externalRef === 'string' ? p.externalRef : '';
  return ref ? `Réf. ${ref}` : `Ligne ${row.rowIndex}`;
}

function fmtVal(v: unknown): string {
  if (v === null || v === undefined || v === '') return '∅';
  return String(v);
}

/**
 * E11-S4 — conflict resolution (admin choice, audited). Renders the amber
 * "à arbitrer" action strip when conflicts exist, and opens a focus-trapped
 * FormDrawer (the E3-S3 hardened Drawer) per row with a side-by-side
 * source-vs-current table and a keep-current / take-source radiogroup.
 *
 * Children's-data guardrail: the apply NEVER auto-resolved a protected-field
 * conflict — this drawer is the only path that writes, and only on an explicit
 * choice, recorded `import.conflict.resolve`. Default = "Garder l'actuel" (safe).
 */
export function ConflictResolver({
  batchId,
  conflictRows,
}: {
  batchId: string;
  conflictRows: BatchRow[];
}) {
  const router = useRouter();
  const [openRow, setOpenRow] = useState<BatchRow | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  if (conflictRows.length === 0) return null;

  const onResolved = (msg: string) => {
    setOpenRow(null);
    setToast(msg);
    router.refresh();
  };

  return (
    <>
      <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
        <div className="flex items-start gap-2.5">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" aria-hidden />
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-bold text-amber-900">
              {conflictRows.length} ligne{conflictRows.length > 1 ? 's' : ''} à arbitrer
            </h3>
            <p className="mt-0.5 text-xs text-amber-800">
              La source et vos données diffèrent sur un champ protégé (identité de l&apos;élève).
              Aucune valeur n&apos;a été écrasée — choisissez celle à conserver. Chaque choix est
              enregistré dans le journal d&apos;audit.
            </p>
            <ul className="mt-3 space-y-2" role="list">
              {conflictRows.map((row) => (
                <li
                  key={row.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white px-3 py-2.5 ring-1 ring-amber-200/70"
                >
                  <div className="min-w-0">
                    <span className="text-sm font-bold text-slate-900">{entityLabel(row)}</span>
                    <span className="ml-2 font-mono text-[11px] text-slate-400">
                      ligne {row.rowIndex}
                    </span>
                    <div className="mt-0.5 text-[11px] text-amber-700">
                      {(row.conflictFields ?? []).map((f) => f.field).join(' · ')} en désaccord
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setOpenRow(row)}
                    className="inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-xl bg-amber-600 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-amber-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
                  >
                    Arbitrer
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {toast && (
        <p
          role="status"
          className="mt-3 inline-flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800 ring-1 ring-emerald-200"
        >
          <Check className="h-4 w-4" aria-hidden /> {toast}
        </p>
      )}

      {openRow && (
        <ConflictDrawer
          batchId={batchId}
          row={openRow}
          onClose={() => setOpenRow(null)}
          onResolved={onResolved}
        />
      )}
    </>
  );
}

function ConflictDrawer({
  batchId,
  row,
  onClose,
  onResolved,
}: {
  batchId: string;
  row: BatchRow;
  onClose: () => void;
  onResolved: (msg: string) => void;
}) {
  const [decision, setDecision] = useState<Decision>('keep_current');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const groupName = useId();
  const fields: ConflictField[] = row.conflictFields ?? [];

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const res = await resolveImportConflict(batchId, row.id, decision);
      if (res.ok) {
        onResolved('Arbitrage enregistré.');
      } else {
        setError(res.error);
      }
    });
  };

  return (
    <FormDrawer
      open
      onClose={onClose}
      title={`Arbitrer — ${entityLabel(row)}`}
      description="La source et vos données diffèrent. Choisissez la valeur à conserver — ce choix est enregistré dans le journal d'audit et reste annulable via le rollback de l'import."
      submitLabel={decision === 'take_source' ? 'Prendre la source' : 'Garder l’actuel'}
      onSubmit={submit}
      busy={pending}
      size="lg"
    >
      <div className="space-y-5">
        <div className="overflow-hidden rounded-xl border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500">
              <tr>
                <th scope="col" className="px-3 py-2 text-left font-semibold">
                  Champ
                </th>
                <th scope="col" className="px-3 py-2 text-left font-semibold">
                  Valeur actuelle
                </th>
                <th scope="col" className="px-3 py-2 text-left font-semibold">
                  Valeur de la source
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {fields.map((f, idx) => (
                <tr key={`${f.field}-${idx}`}>
                  <td className="px-3 py-2 align-top font-mono text-[11px] font-bold text-slate-500">
                    {f.field}
                  </td>
                  <td
                    className={`px-3 py-2 align-top font-mono text-slate-800 ${
                      decision === 'keep_current' ? 'bg-emerald-50' : ''
                    }`}
                  >
                    {fmtVal(f.current)}
                  </td>
                  <td
                    className={`px-3 py-2 align-top font-mono text-slate-800 ${
                      decision === 'take_source' ? 'bg-blue-50' : ''
                    }`}
                  >
                    {fmtVal(f.source)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <fieldset>
          <legend className="mb-2 text-sm font-semibold text-slate-700">
            Quelle valeur conserver ?
          </legend>
          <div
            role="radiogroup"
            aria-label="Choix d'arbitrage"
            className="grid grid-cols-1 gap-2 sm:grid-cols-2"
            onKeyDown={(e) => {
              // Arrow keys move to the SIBLING radio (WCAG 2.1.1). For this
              // 2-option group: Right/Down → take_source, Left/Up → keep_current.
              // The ChoiceCard effect focuses whichever card becomes `checked`,
              // so focus follows selection. Wrap-around by toggling.
              if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                e.preventDefault();
                setDecision('take_source');
              } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                e.preventDefault();
                setDecision('keep_current');
              }
            }}
          >
            <ChoiceCard
              name={groupName}
              checked={decision === 'keep_current'}
              onSelect={() => setDecision('keep_current')}
              icon={ShieldCheck}
              title="Garder l’actuel"
              body="Vos données ne changent pas. Le plus sûr — aucune écriture."
              tone="emerald"
            />
            <ChoiceCard
              name={groupName}
              checked={decision === 'take_source'}
              onSelect={() => setDecision('take_source')}
              icon={ArrowRight}
              title="Prendre la source"
              body="Remplace par la valeur de la source. Annulable via le rollback."
              tone="blue"
            />
          </div>
        </fieldset>

        <p className="flex items-start gap-1.5 text-[11px] text-slate-500">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden />
          Ce choix sera enregistré dans le journal d&apos;audit. Aucune donnée d&apos;élève
          n&apos;est modifiée sans votre décision explicite.
        </p>

        {error && (
          <p
            role="status"
            className="rounded-lg bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800 ring-1 ring-amber-200"
          >
            {error}
          </p>
        )}

        {pending && (
          <p role="status" className="flex items-center gap-2 text-sm text-slate-600">
            <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />{' '}
            Enregistrement de l&apos;arbitrage…
          </p>
        )}
      </div>
    </FormDrawer>
  );
}

function ChoiceCard({
  name,
  checked,
  onSelect,
  icon: Icon,
  title,
  body,
  tone,
}: {
  name: string;
  checked: boolean;
  onSelect: () => void;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: string;
  tone: 'emerald' | 'blue';
}) {
  const ref = useRef<HTMLButtonElement>(null);
  // Roving tabindex within the radiogroup (the E3-S3 / E5-S3 segmented-control
  // pattern). Arrow-key navigation is handled at the radiogroup level so it
  // moves to the SIBLING; this effect makes focus follow the new selection.
  useEffect(() => {
    if (checked) ref.current?.focus();
  }, [checked]);

  const activeRing =
    tone === 'emerald'
      ? 'border-emerald-500 bg-emerald-50 ring-1 ring-emerald-300'
      : 'border-blue-500 bg-blue-50 ring-1 ring-blue-300';

  return (
    <button
      ref={ref}
      type="button"
      role="radio"
      aria-checked={checked}
      tabIndex={checked ? 0 : -1}
      onClick={onSelect}
      className={`flex min-h-[44px] items-start gap-2.5 rounded-xl border p-3 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 ${
        checked ? activeRing : 'border-slate-200 bg-white hover:border-slate-300'
      }`}
    >
      <Icon
        className={`mt-0.5 h-5 w-5 shrink-0 ${tone === 'emerald' ? 'text-emerald-600' : 'text-blue-600'}`}
      />
      <span className="min-w-0">
        <span className="block text-sm font-bold text-slate-900">{title}</span>
        <span className="mt-0.5 block text-xs text-slate-600">{body}</span>
      </span>
    </button>
  );
}
