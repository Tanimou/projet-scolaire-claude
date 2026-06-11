'use client';

import { AlertTriangle, ArrowLeftRight, ArrowRight, Check, Loader2, ShieldCheck } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState, useTransition } from 'react';

import { FormDrawer } from '@pilotage/ui';

import { resolveImportConflict } from '../actions';
import type { BatchRow, ConflictField } from './types';

type Decision = 'keep_current' | 'take_source';

/** id → human class label (e.g. "6eB") for class-move conflicts. Built server-side. */
export type ClassLabels = Record<string, string>;

/**
 * Humanise a raw payload/conflict field key for display. Used by both the strip
 * sub-line and the drawer diff table. Falls back to the raw key (kept as a
 * tooltip for audit traceability) when unknown.
 */
const FIELD_LABELS: Record<string, string> = {
  firstName: 'Prénom',
  lastName: 'Nom',
  birthDate: 'Date de naissance',
  email: 'E-mail',
  notes: 'Notes',
  classSectionId: 'Classe',
};

function fieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field;
}

/**
 * A class-move conflict is the enrollments shape: exactly one `classSectionId`
 * field whose `current`/`source` are class-section UUIDs (a child moving class),
 * structurally different from the students identity conflict.
 */
function isClassMove(fields: ConflictField[]): boolean {
  return fields.length === 1 && fields[0]?.field === 'classSectionId';
}

/** Human label for the entity being arbitrated — best-effort from the payload. */
function entityLabel(row: BatchRow): string {
  const p = row.payload ?? {};
  const first = typeof p.firstName === 'string' ? p.firstName : '';
  const last = typeof p.lastName === 'string' ? p.lastName : '';
  const name = `${first} ${last}`.trim();
  if (name) return name;
  // Enrollment payload: student matricule + (optionally) the target class name.
  const matricule = typeof p.studentExternalRef === 'string' ? p.studentExternalRef : '';
  const className = typeof p.className === 'string' ? p.className : '';
  if (matricule) return className ? `${matricule} → ${className}` : `Réf. ${matricule}`;
  const ref = typeof p.externalRef === 'string' ? p.externalRef : '';
  return ref ? `Réf. ${ref}` : `Ligne ${row.rowIndex}`;
}

function fmtVal(v: unknown): string {
  if (v === null || v === undefined || v === '') return '∅';
  return String(v);
}

/** Resolve a class-section UUID to its human label, falling back to the raw id. */
function classLabelOf(value: unknown, classLabels: ClassLabels): string {
  if (typeof value !== 'string' || !value) return fmtVal(value);
  return classLabels[value] ?? value;
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
  classLabels = {},
}: {
  batchId: string;
  conflictRows: BatchRow[];
  /** id → class name, for rendering class-move (enrollments) conflicts legibly. */
  classLabels?: ClassLabels;
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
              La source et vos données diffèrent. Aucune valeur n&apos;a été écrasée — choisissez
              celle à conserver. Chaque choix est enregistré dans le journal d&apos;audit.
            </p>
            <ul className="mt-3 space-y-2" role="list">
              {conflictRows.map((row) => {
                const rowFields = row.conflictFields ?? [];
                const classMove = isClassMove(rowFields);
                return (
                <li
                  key={row.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white px-3 py-2.5 ring-1 ring-amber-200/70"
                >
                  <div className="min-w-0">
                    <span className="text-sm font-bold text-slate-900">{entityLabel(row)}</span>
                    <span className="ml-2 font-mono text-[11px] text-slate-400">
                      ligne {row.rowIndex}
                    </span>
                    <div className="mt-0.5 flex items-center gap-1 text-[11px] text-amber-700">
                      {classMove ? (
                        <>
                          <ArrowLeftRight className="h-3.5 w-3.5 shrink-0 text-amber-700" aria-hidden />
                          Changement de classe
                        </>
                      ) : (
                        <>{rowFields.map((f) => fieldLabel(f.field)).join(' · ')} en désaccord</>
                      )}
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
                );
              })}
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
          classLabels={classLabels}
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
  classLabels,
  onClose,
  onResolved,
}: {
  batchId: string;
  row: BatchRow;
  classLabels: ClassLabels;
  onClose: () => void;
  onResolved: (msg: string) => void;
}) {
  const [decision, setDecision] = useState<Decision>('keep_current');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const groupName = useId();
  const fields: ConflictField[] = row.conflictFields ?? [];
  const classMove = isClassMove(fields);

  // Class-move resolved names for the choice-card prose (UUID never shown inline).
  const moveField = classMove ? fields[0] : undefined;
  const currentClassName = moveField
    ? classLabelOf(moveField.current, classLabels)
    : 'sa classe actuelle';
  const sourceClassName = moveField
    ? classLabelOf(moveField.source, classLabels)
    : 'la nouvelle classe';

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const res = await resolveImportConflict(batchId, row.id, decision);
      if (res.ok) {
        // Shape-aware success copy.
        const msg = classMove
          ? decision === 'take_source'
            ? 'Élève déplacé.'
            : 'Classe conservée.'
          : 'Arbitrage enregistré.';
        onResolved(msg);
      } else {
        setError(res.error);
      }
    });
  };

  const title = classMove
    ? `Changer de classe — ${entityLabel(row)}`
    : `Arbitrer — ${entityLabel(row)}`;
  const description = classMove
    ? "La source place cet élève dans une autre classe que celle où il est inscrit. Choisissez de le laisser dans sa classe actuelle ou de le déplacer. Ce choix est enregistré et reste annulable via le rollback de l'import."
    : "La source et vos données diffèrent. Choisissez la valeur à conserver — ce choix est enregistré dans le journal d'audit et reste annulable via le rollback de l'import.";
  const submitLabel = classMove
    ? decision === 'take_source'
      ? 'Déplacer l’élève'
      : 'Garder la classe actuelle'
    : decision === 'take_source'
      ? 'Prendre la source'
      : 'Garder l’actuel';

  return (
    <FormDrawer
      open
      onClose={onClose}
      title={title}
      description={description}
      submitLabel={submitLabel}
      onSubmit={submit}
      busy={pending}
      size="lg"
    >
      <div className="space-y-5">
        <div className="overflow-hidden rounded-xl border border-slate-200">
          <div className="overflow-x-auto">
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
                {fields.map((f, idx) => {
                  const isClassField = f.field === 'classSectionId';
                  return (
                    <tr key={`${f.field}-${idx}`}>
                      <td
                        className="px-3 py-2 align-top text-[11px] font-bold text-slate-500"
                        title={f.field}
                      >
                        {fieldLabel(f.field)}
                      </td>
                      <td
                        className={`px-3 py-2 align-top text-slate-800 ${
                          decision === 'keep_current' ? 'bg-emerald-50' : ''
                        }`}
                      >
                        {isClassField ? (
                          <DiffClassValue value={f.current} classLabels={classLabels} />
                        ) : (
                          <span className="font-mono">{fmtVal(f.current)}</span>
                        )}
                      </td>
                      <td
                        className={`px-3 py-2 align-top text-slate-800 ${
                          decision === 'take_source' ? 'bg-blue-50' : ''
                        }`}
                      >
                        {isClassField ? (
                          <DiffClassValue value={f.source} classLabels={classLabels} />
                        ) : (
                          <span className="font-mono">{fmtVal(f.source)}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <fieldset>
          <legend className="mb-2 text-sm font-semibold text-slate-700">
            {classMove ? 'Que faire de cet élève ?' : 'Quelle valeur conserver ?'}
          </legend>
          <div
            role="radiogroup"
            aria-label={classMove ? 'Choix de classe' : "Choix d'arbitrage"}
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
              title={classMove ? 'Garder la classe actuelle' : 'Garder l’actuel'}
              body={
                classMove
                  ? `L’élève reste dans ${currentClassName}. Aucun changement — le plus sûr.`
                  : 'Vos données ne changent pas. Le plus sûr — aucune écriture.'
              }
              tone="emerald"
            />
            <ChoiceCard
              name={groupName}
              checked={decision === 'take_source'}
              onSelect={() => setDecision('take_source')}
              icon={classMove ? ArrowLeftRight : ArrowRight}
              title={classMove ? `Déplacer vers ${sourceClassName}` : 'Prendre la source'}
              body={
                classMove
                  ? `Libère la place actuelle et inscrit l’élève dans ${sourceClassName}. Annulable via le rollback.`
                  : 'Remplace par la valeur de la source. Annulable via le rollback.'
              }
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

/**
 * A class-section value in the diff table: the resolved human label as the
 * headline, the raw UUID kept as a small auditable sub-line (never the headline,
 * so the admin isn't arbitrating between two opaque ids).
 */
function DiffClassValue({
  value,
  classLabels,
}: {
  value: unknown;
  classLabels: ClassLabels;
}) {
  const id = typeof value === 'string' ? value : '';
  const label = classLabelOf(value, classLabels);
  const showRaw = id && id !== label;
  return (
    <span className="block">
      <span className="font-medium text-slate-900">{label}</span>
      {showRaw && (
        <span className="mt-0.5 block font-mono text-[10px] text-slate-500" title={id}>
          {id}
        </span>
      )}
    </span>
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
