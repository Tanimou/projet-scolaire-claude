'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

import { FilterBar, SearchInput, SelectFilter, type SelectOption } from '@pilotage/ui';

export interface GuardiansPageFiltersProps {
  initialQ: string;
  initialRelationship: string;
  relationshipOptions: SelectOption[];
}

/** Client-side filter strip for `/admin/guardians`. */
export function GuardiansPageFilters({
  initialQ,
  initialRelationship,
  relationshipOptions,
}: GuardiansPageFiltersProps) {
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
      router.push(`/admin/guardians?${next.toString()}`);
    });
  }

  return (
    <FilterBar
      search={
        <SearchInput
          placeholder="Rechercher un parent (nom, email, profession)..."
          value={initialQ}
          onChange={(v) => update({ q: v || undefined })}
        />
      }
      filters={
        <>
          <SelectFilter
            options={relationshipOptions}
            value={initialRelationship}
            onChange={(v) => update({ relationship: v || undefined })}
            placeholder="Toutes les relations"
            clearable
            clearLabel="Toutes les relations"
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
