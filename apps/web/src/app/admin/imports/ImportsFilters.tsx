'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

import { FilterBar, SearchInput, SelectFilter, type SelectOption } from '@pilotage/ui';

import type {
  ModeFilter,
  PeriodFilter,
  StatusFilter,
  TypeFilter,
  TypeOption,
} from './types';

const PERIOD_OPTIONS: SelectOption[] = [
  { value: '24h', label: '24 dernières heures' },
  { value: '7d', label: '7 derniers jours' },
  { value: '30d', label: '30 derniers jours' },
  { value: '90d', label: '90 derniers jours' },
];

const STATUS_OPTIONS: SelectOption[] = [
  { value: 'inflight', label: 'En cours', hint: 'upload + validation + apply' },
  { value: 'pending', label: 'À confirmer', hint: 'validés en attente' },
  { value: 'applied', label: 'Appliqués', hint: 'lots terminés' },
  { value: 'failed', label: 'En échec', hint: 'failed + rolled_back' },
];

const MODE_OPTIONS: SelectOption[] = [
  { value: 'all_or_nothing', label: 'All-or-nothing' },
  { value: 'skip_invalid', label: 'Skip invalides' },
];

export interface ImportsFiltersProps {
  q: string;
  type: TypeFilter;
  status: StatusFilter;
  period: PeriodFilter;
  mode: ModeFilter;
  typeOptions: TypeOption[];
}

export function ImportsFilters({
  q,
  type,
  status,
  period,
  mode,
  typeOptions,
}: ImportsFiltersProps) {
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

  const typeSelectOptions: SelectOption[] = typeOptions.map((t) => ({
    value: t.value,
    label: t.label,
    hint: `${t.count}`,
  }));

  return (
    <FilterBar
      className={pending ? 'opacity-70' : undefined}
      search={
        <SearchInput
          placeholder="Rechercher un fichier (élèves-2026.csv…)"
          value={q}
          onChange={(value) => update({ q: value || undefined })}
        />
      }
      filters={
        <>
          {typeOptions.length > 0 && (
            <SelectFilter
              size="sm"
              value={type}
              onChange={(value) => update({ type: value || undefined })}
              options={typeSelectOptions}
              clearable
              clearLabel="Tous les types"
              placeholder="Tous les types"
              fullWidth={false}
            />
          )}
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
            value={period}
            onChange={(value) => update({ period: value || undefined })}
            options={PERIOD_OPTIONS}
            clearable
            clearLabel="Toute la période"
            placeholder="Toute la période"
            fullWidth={false}
          />
          <SelectFilter
            size="sm"
            value={mode}
            onChange={(value) => update({ mode: value || undefined })}
            options={MODE_OPTIONS}
            clearable
            clearLabel="Tous les modes"
            placeholder="Tous les modes"
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
