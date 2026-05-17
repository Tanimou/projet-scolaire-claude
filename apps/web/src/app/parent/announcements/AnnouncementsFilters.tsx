'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

import { FilterBar, SearchInput, SelectFilter, type SelectOption } from '@pilotage/ui';

export interface AnnouncementsFiltersProps {
  initialQ: string;
  initialStatus: string;
  initialPriority: string;
  initialScope: string;
}

const STATUS_OPTIONS: SelectOption[] = [
  { value: 'unread', label: 'Non lues' },
  { value: 'read', label: 'Lues' },
];

const PRIORITY_OPTIONS: SelectOption[] = [
  { value: 'urgent', label: 'Urgente' },
  { value: 'high', label: 'Importante' },
  { value: 'normal', label: 'Normale' },
];

const SCOPE_OPTIONS: SelectOption[] = [
  { value: 'school_wide', label: "Toute l'école" },
  { value: 'cycle_scope', label: 'Cycle' },
  { value: 'grade_level_scope', label: 'Niveau' },
  { value: 'class_section_scope', label: 'Classe' },
  { value: 'individual_student', label: 'Mon enfant' },
];

/**
 * Client-side filter strip for `/parent/announcements`. URL-driven via
 * `searchParams`, keeps the page a server component. Resets to `?page=1`
 * whenever any filter changes.
 */
export function AnnouncementsFilters({
  initialQ,
  initialStatus,
  initialPriority,
  initialScope,
}: AnnouncementsFiltersProps) {
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
      router.push(`/parent/announcements?${next.toString()}`);
    });
  }

  return (
    <FilterBar
      search={
        <SearchInput
          placeholder="Rechercher dans les annonces…"
          value={initialQ}
          onChange={(v) => update({ q: v || undefined })}
        />
      }
      filters={
        <>
          <SelectFilter
            options={STATUS_OPTIONS}
            value={initialStatus}
            onChange={(v) => update({ status: v || undefined })}
            placeholder="Toutes"
            clearable
            clearLabel="Toutes"
            fullWidth={false}
          />
          <SelectFilter
            options={PRIORITY_OPTIONS}
            value={initialPriority}
            onChange={(v) => update({ priority: v || undefined })}
            placeholder="Toutes priorités"
            clearable
            clearLabel="Toutes priorités"
            fullWidth={false}
          />
          <SelectFilter
            options={SCOPE_OPTIONS}
            value={initialScope}
            onChange={(v) => update({ scope: v || undefined })}
            placeholder="Toutes audiences"
            clearable
            clearLabel="Toutes audiences"
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
