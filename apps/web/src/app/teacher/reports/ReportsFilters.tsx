'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

import { FilterBar, SearchInput, SelectFilter, type SelectOption } from '@pilotage/ui';

import type {
  BandFilter,
  GradeLevelOption,
  SignalFilter,
  SortKey,
  SubjectOption,
} from './types';

const BAND_OPTIONS: SelectOption[] = [
  { value: 'excellent', label: 'Excellent (≥ 16)' },
  { value: 'bon', label: 'Bon (14 – 16)' },
  { value: 'correct', label: 'Correct (10 – 14)' },
  { value: 'risque', label: 'À renforcer (< 10)' },
  { value: 'unknown', label: 'Pas encore de moyenne' },
];

const SIGNAL_OPTIONS: SelectOption[] = [
  { value: 'at-risk', label: 'Classes à risque' },
  { value: 'low-pass-rate', label: 'Taux de réussite faible' },
  { value: 'declining', label: 'Tendance en baisse' },
  { value: 'improving', label: 'Tendance en hausse' },
  { value: 'no-data', label: 'Sans note publiée' },
];

const SORT_OPTIONS: SelectOption[] = [
  { value: 'name-asc', label: 'Classe A → Z' },
  { value: 'avg-desc', label: 'Moyenne ↓' },
  { value: 'avg-asc', label: 'Moyenne ↑' },
  { value: 'pass-asc', label: 'Réussite ↑' },
  { value: 'pass-desc', label: 'Réussite ↓' },
  { value: 'students-desc', label: 'Effectif ↓' },
  { value: 'trend-desc', label: 'Tendance ↑' },
  { value: 'trend-asc', label: 'Tendance ↓' },
];

/**
 * URL-driven filter strip for /teacher/reports. Keeps the page server-rendered
 * while letting teachers slice their class assignments by subject, level, perf
 * band, signal, search and sort.
 */
export function ReportsFilters({
  subjects,
  gradeLevels,
  q,
  subjectId,
  gradeLevel,
  band,
  signal,
  sort,
}: {
  subjects: SubjectOption[];
  gradeLevels: GradeLevelOption[];
  q: string;
  subjectId: string;
  gradeLevel: string;
  band: BandFilter;
  signal: SignalFilter;
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
          placeholder="Rechercher une classe, une matière, un niveau…"
          value={q}
          onChange={(value) => update({ q: value || undefined })}
        />
      }
      filters={
        <>
          <SelectFilter
            size="sm"
            value={subjectId}
            onChange={(value) => update({ subjectId: value || undefined })}
            options={subjects.map((s) => ({ value: s.id, label: s.name }))}
            clearable
            clearLabel="Toutes les matières"
            placeholder="Toutes les matières"
            fullWidth={false}
          />
          <SelectFilter
            size="sm"
            value={gradeLevel}
            onChange={(value) => update({ gradeLevel: value || undefined })}
            options={gradeLevels.map((g) => ({
              value: g.name,
              label: `${g.name} (${g.count})`,
            }))}
            clearable
            clearLabel="Tous les niveaux"
            placeholder="Tous les niveaux"
            fullWidth={false}
          />
          <SelectFilter
            size="sm"
            value={band}
            onChange={(value) => update({ band: value || undefined })}
            options={BAND_OPTIONS}
            clearable
            clearLabel="Toutes les bandes"
            placeholder="Toutes les bandes"
            fullWidth={false}
          />
          <SelectFilter
            size="sm"
            value={signal}
            onChange={(value) => update({ signal: value || undefined })}
            options={SIGNAL_OPTIONS}
            clearable
            clearLabel="Tous les signaux"
            placeholder="Tous les signaux"
            fullWidth={false}
          />
          <SelectFilter
            size="sm"
            value={sort}
            onChange={(value) => update({ sort: value === 'name-asc' ? undefined : value })}
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
