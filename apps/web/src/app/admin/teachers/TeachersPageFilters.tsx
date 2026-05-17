'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

import { FilterBar, SearchInput, SelectFilter, type SelectOption } from '@pilotage/ui';

export interface TeachersPageFiltersProps {
  initialQ: string;
  initialActive: string;
  initialSubjectId: string;
  subjectOptions: SelectOption[];
  statusOptions: SelectOption[];
}

/** Client-side filter strip for `/admin/teachers`. */
export function TeachersPageFilters({
  initialQ,
  initialActive,
  initialSubjectId,
  subjectOptions,
  statusOptions,
}: TeachersPageFiltersProps) {
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
      router.push(`/admin/teachers?${next.toString()}`);
    });
  }

  return (
    <FilterBar
      search={
        <SearchInput
          placeholder="Rechercher un enseignant..."
          value={initialQ}
          onChange={(v) => update({ q: v || undefined })}
        />
      }
      filters={
        <>
          <SelectFilter
            options={subjectOptions}
            value={initialSubjectId}
            onChange={(v) => update({ subjectId: v || undefined })}
            placeholder="Filtrer par matière"
            clearable
            clearLabel="Toutes les matières"
            fullWidth={false}
          />
          <SelectFilter
            options={statusOptions}
            value={initialActive}
            onChange={(v) => update({ active: v || undefined })}
            placeholder="Tous"
            clearable
            clearLabel="Tous"
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
