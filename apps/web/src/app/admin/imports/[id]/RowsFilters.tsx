'use client';

import { RotateCcw } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

import { FilterBar, SearchInput, SelectFilter, type SelectOption } from '@pilotage/ui';

import type { ErrorFieldFacet, RowStatusFilter } from './types';

const STATUS_OPTIONS: SelectOption[] = [
  { value: 'invalid', label: 'Invalides' },
  { value: 'valid', label: 'Valides' },
  { value: 'applied', label: 'Appliquées' },
  { value: 'skipped', label: 'Ignorées' },
  { value: 'rolled_back', label: 'Annulées' },
  { value: 'pending', label: 'En attente' },
];

/**
 * URL-driven filter strip for the rows table on /admin/imports/[id].
 *
 * - `status` narrows the table to a single row status bucket
 * - `errorField` narrows invalid rows to those carrying an error on a given column
 *   (only meaningful when `status=invalid` — but kept independent so admins can
 *   start from "what's wrong with email" without having to also flip status)
 * - `q` matches against row index OR any payload value (case-insensitive)
 * - Always resets `page` so the table lands on row 1 of the new view.
 */
export function RowsFilters({
  status,
  errorField,
  q,
  errorFields,
}: {
  status: RowStatusFilter;
  errorField: string;
  q: string;
  errorFields: ErrorFieldFacet[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  function update(patch: Record<string, string | undefined>) {
    const next = new URLSearchParams(searchParams?.toString() ?? '');
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    next.delete('page');
    startTransition(() => {
      router.push(`${pathname}?${next.toString()}`);
    });
  }

  function reset() {
    startTransition(() => {
      router.push(pathname ?? '');
    });
  }

  const hasActiveFilters = !!q || !!status || !!errorField;

  const errorFieldOptions: SelectOption[] = errorFields.map((f) => ({
    value: f.key,
    label: `${f.label} · ${f.rowCount}`,
  }));

  return (
    <FilterBar
      className={pending ? 'opacity-70' : undefined}
      search={
        <SearchInput
          placeholder="Rechercher une ligne, un champ ou une valeur…"
          value={q}
          onChange={(value) => update({ q: value || undefined })}
        />
      }
      filters={
        <>
          <SelectFilter
            size="sm"
            value={status}
            onChange={(value) => update({ status: value || undefined })}
            options={STATUS_OPTIONS}
            clearable
            clearLabel="Tous statuts"
            placeholder="Tous statuts"
            fullWidth={false}
          />
          {errorFields.length > 0 && (
            <SelectFilter
              size="sm"
              value={errorField}
              onChange={(value) => update({ errorField: value || undefined })}
              options={errorFieldOptions}
              clearable
              clearLabel="Tous les champs"
              placeholder="Champ en erreur"
              fullWidth={false}
            />
          )}
          {pending && (
            <span className="text-[11px] text-slate-400" aria-live="polite">
              Mise à jour…
            </span>
          )}
        </>
      }
      primaryAction={
        hasActiveFilters ? (
          <button
            type="button"
            onClick={reset}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Réinitialiser
          </button>
        ) : null
      }
    />
  );
}
