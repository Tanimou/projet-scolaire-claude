'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

import { FilterBar, SearchInput, SelectFilter, type SelectOption } from '@pilotage/ui';

import type { BandFilter, SortKey, StatusFilter } from './types';

const BAND_OPTIONS: SelectOption[] = [
  { value: 'excellent', label: 'Excellent (≥ 16)' },
  { value: 'bon', label: 'Bon (14–16)' },
  { value: 'correct', label: 'Correct (10–14)' },
  { value: 'risque', label: 'À renforcer (< 10)' },
  { value: 'unknown', label: 'Pas encore de moyenne' },
];

const STATUS_OPTIONS: SelectOption[] = [
  { value: 'above-class', label: '≥ moyenne de classe' },
  { value: 'below-class', label: '< moyenne de classe' },
  { value: 'improving', label: 'En hausse vs. trimestre' },
  { value: 'declining', label: 'En baisse vs. trimestre' },
  { value: 'no-data', label: 'Pas encore de note' },
];

const SORT_OPTIONS: SelectOption[] = [
  { value: 'name-asc', label: 'Nom A → Z' },
  { value: 'grade-desc', label: 'Moyenne ↓' },
  { value: 'grade-asc', label: 'Moyenne ↑' },
  { value: 'coef-desc', label: 'Coefficient ↓' },
  { value: 'delta-desc', label: 'Progression ↑' },
  { value: 'delta-asc', label: 'Progression ↓' },
];

/**
 * URL-driven filter strip for /parent/subjects. Preserves `studentId` so the
 * parent stays on their selected child while filtering.
 */
export function SubjectsFilters({
  band,
  status,
  sort,
  q,
}: {
  band: BandFilter;
  status: StatusFilter;
  sort: SortKey;
  q: string;
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
    startTransition(() => {
      router.push(`${pathname}?${next.toString()}`);
    });
  }

  return (
    <FilterBar
      className={pending ? 'opacity-70' : undefined}
      search={
        <SearchInput
          placeholder="Rechercher une matière…"
          value={q}
          onChange={(value) => update({ q: value || undefined })}
        />
      }
      filters={
        <>
          <SelectFilter
            size="sm"
            value={band}
            onChange={(value) => update({ band: value || undefined })}
            options={BAND_OPTIONS}
            clearable
            clearLabel="Tous les niveaux"
            placeholder="Tous les niveaux"
            fullWidth={false}
          />
          <SelectFilter
            size="sm"
            value={status}
            onChange={(value) => update({ status: value || undefined })}
            options={STATUS_OPTIONS}
            clearable
            clearLabel="Tous les statuts"
            placeholder="Tous les statuts"
            fullWidth={false}
          />
          <SelectFilter
            size="sm"
            value={sort === 'name-asc' ? '' : sort}
            onChange={(value) => update({ sort: value || undefined })}
            options={SORT_OPTIONS}
            clearable
            clearLabel="Tri par défaut (A → Z)"
            placeholder="Tri par défaut (A → Z)"
            fullWidth={false}
          />
          {pending && (
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
