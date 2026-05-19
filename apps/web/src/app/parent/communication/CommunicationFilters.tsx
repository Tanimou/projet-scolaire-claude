'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

import { FilterBar, SearchInput, SelectFilter, type SelectOption } from '@pilotage/ui';

import type { PeriodFilter, SourceFilter, StatusFilter } from './types';

const SOURCE_OPTIONS: SelectOption[] = [
  { value: 'admin', label: "Direction de l'école" },
  { value: 'teacher', label: 'Enseignants' },
];

const STATUS_OPTIONS: SelectOption[] = [
  { value: 'unread', label: 'Non lues' },
  { value: 'read', label: 'Lues' },
];

const PERIOD_OPTIONS: SelectOption[] = [
  { value: '7d', label: '7 derniers jours' },
  { value: '30d', label: '30 derniers jours' },
  { value: '90d', label: '90 derniers jours' },
];

export function CommunicationFilters({
  source,
  status,
  period,
  q,
}: {
  source: SourceFilter;
  status: StatusFilter;
  period: PeriodFilter;
  q: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [isPending, startTransition] = useTransition();

  function update(patch: Record<string, string | undefined>) {
    const next = new URLSearchParams(params?.toString() ?? '');
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
      className={isPending ? 'opacity-70' : undefined}
      search={
        <SearchInput
          placeholder="Rechercher un message ou un interlocuteur…"
          value={q}
          onChange={(value) => update({ q: value || undefined })}
        />
      }
      filters={
        <>
          <SelectFilter
            size="sm"
            value={source}
            onChange={(value) => update({ source: value || undefined })}
            options={SOURCE_OPTIONS}
            clearable
            clearLabel="Toutes les sources"
            placeholder="Toutes les sources"
            fullWidth={false}
          />
          <SelectFilter
            size="sm"
            value={period}
            onChange={(value) => update({ period: value || undefined })}
            options={PERIOD_OPTIONS}
            clearable
            clearLabel="Cette année"
            placeholder="Cette année"
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
