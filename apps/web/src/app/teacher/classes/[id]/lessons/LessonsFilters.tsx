'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

import { FilterBar, SearchInput, SelectFilter, type SelectOption } from '@pilotage/ui';

import type { HomeworkFilter, PeriodFilter, SortKey, StatusFilter } from './types';

const STATUS_OPTIONS: SelectOption[] = [
  { value: 'published', label: 'Publiées' },
  { value: 'draft', label: 'Brouillons' },
];

const PERIOD_OPTIONS: SelectOption[] = [
  { value: '7d', label: '7 derniers jours' },
  { value: '30d', label: '30 derniers jours' },
  { value: '90d', label: '90 derniers jours' },
  { value: 'term', label: 'Ce trimestre' },
];

const HOMEWORK_OPTIONS: SelectOption[] = [
  { value: 'with', label: 'Avec devoirs' },
  { value: 'without', label: 'Sans devoirs' },
  { value: 'due-soon', label: 'À rendre sous 7 j' },
  { value: 'overdue', label: 'Échéance passée' },
];

const SORT_OPTIONS: SelectOption[] = [
  { value: 'date-desc', label: 'Date ↓ (récent)' },
  { value: 'date-asc', label: 'Date ↑ (ancien)' },
  { value: 'title-asc', label: 'Titre A → Z' },
];

/**
 * URL-driven filter strip for /teacher/classes/[id]/lessons. Lets teachers
 * slice the cahier de texte by status, period, homework signals, search and
 * sort while keeping the page server-rendered.
 */
export function LessonsFilters({
  q,
  status,
  period,
  homework,
  sort,
}: {
  q: string;
  status: StatusFilter;
  period: PeriodFilter;
  homework: HomeworkFilter;
  sort: SortKey;
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
          placeholder="Rechercher une entrée, un devoir, un mot-clé…"
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
          <SelectFilter
            size="sm"
            value={period}
            onChange={(value) => update({ period: value || undefined })}
            options={PERIOD_OPTIONS}
            clearable
            clearLabel="Toute période"
            placeholder="Toute période"
            fullWidth={false}
          />
          <SelectFilter
            size="sm"
            value={homework}
            onChange={(value) => update({ homework: value || undefined })}
            options={HOMEWORK_OPTIONS}
            clearable
            clearLabel="Tous devoirs"
            placeholder="Tous devoirs"
            fullWidth={false}
          />
          <SelectFilter
            size="sm"
            value={sort}
            onChange={(value) => update({ sort: value === 'date-desc' ? undefined : value })}
            options={SORT_OPTIONS}
            placeholder="Trier par"
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
