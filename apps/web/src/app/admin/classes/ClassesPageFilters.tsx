'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

import { FilterBar, SelectFilter, type SelectOption } from '@pilotage/ui';

export interface ClassesPageFiltersProps {
  initialGradeLevelId: string;
  initialAcademicYearId: string;
  levelOptions: SelectOption[];
  yearOptions: SelectOption[];
}

/**
 * Client-side filter strip for `/admin/classes`.
 * Two selects (grade level + academic year) that drive the URL query string.
 */
export function ClassesPageFilters({
  initialGradeLevelId,
  initialAcademicYearId,
  levelOptions,
  yearOptions,
}: ClassesPageFiltersProps) {
  const router = useRouter();
  const params = useSearchParams();
  const [isPending, startTransition] = useTransition();

  function update(patch: Record<string, string | undefined>) {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    next.delete('page');
    startTransition(() => {
      router.push(`/admin/classes?${next.toString()}`);
    });
  }

  return (
    <FilterBar
      filters={
        <>
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
            options={yearOptions}
            value={initialAcademicYearId}
            onChange={(v) => update({ academicYearId: v || undefined })}
            placeholder="Toutes les années"
            clearable
            clearLabel="Toutes les années"
            fullWidth={false}
          />
          {isPending && (
            <span className="text-[11px] text-slate-400" aria-live="polite">
              Mise à jour…
            </span>
          )}
        </>
      }
    />
  );
}
