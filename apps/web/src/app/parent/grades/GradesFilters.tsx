'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

import { FilterBar, SearchInput, SelectFilter, type SelectOption } from '@pilotage/ui';

import type { GradesPeriod, GradesPerformance, SubjectOption, TermOption } from './types';

const PERIOD_OPTIONS: Array<{ value: GradesPeriod; label: string }> = [
  { value: 'all', label: 'Toute la période' },
  { value: 'month', label: 'Ce mois-ci' },
  { value: 'term', label: 'Trimestre en cours' },
];

const PERFORMANCE_OPTIONS: SelectOption[] = [
  { value: 'excellent', label: 'Excellent (≥ 16)' },
  { value: 'satisfaisant', label: 'Satisfaisant (10–15)' },
  { value: 'insuffisant', label: 'Insuffisant (< 10)' },
  { value: 'absent', label: 'Absences uniquement' },
];

/**
 * URL-driven filter strip for /parent/grades. Drives `q`, `period`, `subjectId`,
 * `termId`, `performance`. Keeps `studentId` and clears `page` on every change so
 * the list always lands on the first row of the new filter set.
 */
export function GradesFilters({
  subjects,
  terms,
  period,
  subjectId,
  termId,
  performance,
  q,
}: {
  subjects: SubjectOption[];
  terms: TermOption[];
  period: GradesPeriod;
  subjectId: string;
  termId: string;
  performance: GradesPerformance | '';
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
    // Reset pagination when any filter changes.
    next.delete('page');
    startTransition(() => {
      router.push(`${pathname}?${next.toString()}`);
    });
  }

  return (
    <FilterBar
      className={pending ? 'opacity-70' : undefined}
      search={
        <SearchInput
          placeholder="Rechercher dans les notes…"
          value={q}
          onChange={(value) => update({ q: value || undefined })}
        />
      }
      filters={
        <>
          <SelectFilter
            size="sm"
            value={period}
            onChange={(value) => update({ period: value || undefined })}
            options={PERIOD_OPTIONS}
            fullWidth={false}
          />
          <SelectFilter
            size="sm"
            value={subjectId}
            onChange={(value) => update({ subjectId: value || undefined })}
            clearable
            clearLabel="Toutes les matières"
            placeholder="Toutes les matières"
            options={subjects.map((subject) => ({ value: subject.id, label: subject.name }))}
            fullWidth={false}
          />
          {terms.length > 0 && (
            <SelectFilter
              size="sm"
              value={termId}
              onChange={(value) => update({ termId: value || undefined })}
              clearable
              clearLabel="Tous les trimestres"
              placeholder="Tous les trimestres"
              options={terms.map((term) => ({ value: term.id, label: term.name }))}
              fullWidth={false}
            />
          )}
          <SelectFilter
            size="sm"
            value={performance}
            onChange={(value) => update({ performance: value || undefined })}
            clearable
            clearLabel="Toutes les performances"
            placeholder="Performance"
            options={PERFORMANCE_OPTIONS}
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
