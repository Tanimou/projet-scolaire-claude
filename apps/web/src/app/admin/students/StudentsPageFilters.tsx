'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

import { FilterBar, SearchInput, SelectFilter, type SelectOption } from '@pilotage/ui';

export interface StudentsPageFiltersProps {
  initialQ: string;
  initialStatus: string;
  initialClassSectionId: string;
  initialGradeLevelId: string;
  classOptions: SelectOption[];
  levelOptions: SelectOption[];
  statusOptions: SelectOption[];
}

/**
 * Client-side filter strip for `/admin/students` — wires the search input and
 * select filters to the URL query string. Re-renders the server component via
 * `router.push` so the page re-fetches with the new filters applied.
 */
export function StudentsPageFilters({
  initialQ,
  initialStatus,
  initialClassSectionId,
  initialGradeLevelId,
  classOptions,
  levelOptions,
  statusOptions,
}: StudentsPageFiltersProps) {
  const router = useRouter();
  const params = useSearchParams();
  const [isPending, startTransition] = useTransition();

  function update(patch: Record<string, string | undefined>) {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    // Always reset to page 1 when filters change
    next.delete('page');
    startTransition(() => {
      router.push(`/admin/students?${next.toString()}`);
    });
  }

  return (
    <FilterBar
      search={
        <SearchInput
          placeholder="Rechercher un élève (nom, ID...)"
          value={initialQ}
          onChange={(v) => update({ q: v || undefined })}
        />
      }
      filters={
        <>
          <SelectFilter
            options={classOptions}
            value={initialClassSectionId}
            onChange={(v) => update({ classSectionId: v || undefined })}
            placeholder="Toutes les classes"
            clearable
            clearLabel="Toutes les classes"
            fullWidth={false}
          />
          <SelectFilter
            options={levelOptions}
            value={initialGradeLevelId}
            onChange={(v) => update({ gradeLevelId: v || undefined })}
            placeholder="Tous les niveaux"
            clearable
            clearLabel="Tous les niveaux"
            fullWidth={false}
          />
          <SelectFilter
            options={statusOptions}
            value={initialStatus}
            onChange={(v) => update({ status: v || undefined })}
            placeholder="Tous les statuts"
            clearable
            clearLabel="Tous les statuts"
            fullWidth={false}
          />
          {isPending && (
            <span className="text-[11px] text-slate-400" aria-live="polite">
              Mise à jour…
            </span>
          )}
        </>
      }
      primaryAction={null}
    />
  );
}
