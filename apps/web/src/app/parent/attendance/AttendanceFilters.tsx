'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

import { FilterBar, SearchInput, SelectFilter, type SelectOption } from '@pilotage/ui';

import type {
  AttendancePeriod,
  AttendanceStatusFilter,
  SubjectOption,
} from './types';

const PERIOD_OPTIONS: Array<{ value: AttendancePeriod; label: string }> = [
  { value: 'all', label: 'Tout l’historique' },
  { value: 'month', label: 'Ce mois-ci' },
  { value: '30d', label: '30 derniers jours' },
  { value: '90d', label: '90 derniers jours' },
];

const STATUS_OPTIONS: SelectOption[] = [
  { value: 'absent_unjustified', label: 'À justifier' },
  { value: 'absent', label: 'Absences (toutes)' },
  { value: 'absent_excused', label: 'Justifiées' },
  { value: 'late', label: 'Retards' },
  { value: 'left_early', label: 'Départs anticipés' },
  { value: 'present', label: 'Présences' },
];

/**
 * URL-driven filter strip for /parent/attendance. Resets `page` whenever any
 * filter changes so the list always lands on the first row of the new view.
 * Keeps `studentId` so the parent doesn't fall off their selected child.
 */
export function AttendanceFilters({
  subjects,
  period,
  status,
  subjectId,
  q,
}: {
  subjects: SubjectOption[];
  period: AttendancePeriod;
  status: AttendanceStatusFilter;
  subjectId: string;
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
          placeholder="Rechercher une matière, un commentaire…"
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
            value={subjectId}
            onChange={(value) => update({ subjectId: value || undefined })}
            options={subjects.map((subject) => ({ value: subject.id, label: subject.name }))}
            clearable
            clearLabel="Toutes les matières"
            placeholder="Toutes les matières"
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
