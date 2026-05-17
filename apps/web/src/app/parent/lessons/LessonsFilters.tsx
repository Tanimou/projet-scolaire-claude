'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

import { SelectFilter } from '@pilotage/ui';

import type { LessonsPeriod, SubjectOption } from './types';

const PERIOD_OPTIONS: Array<{ value: LessonsPeriod; label: string }> = [
  { value: 'week', label: 'Cette semaine' },
  { value: 'month', label: 'Ce mois-ci' },
  { value: 'all', label: 'Toute la période' },
  { value: 'homework', label: 'Devoirs uniquement' },
];

/**
 * URL-driven filter strip for /parent/lessons.
 * Writes `period` and `subjectId` to ?searchParams while preserving studentId.
 */
export function LessonsFilters({
  subjects,
  period,
  subjectId,
}: {
  subjects: SubjectOption[];
  period: LessonsPeriod;
  subjectId: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  function update(name: 'period' | 'subjectId', value: string) {
    const params = new URLSearchParams(searchParams?.toString() ?? '');
    if (value) {
      params.set(name, value);
    } else {
      params.delete(name);
    }
    // Reset pagination when the filter changes.
    params.delete('page');
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`);
    });
  }

  return (
    <div
      className={
        'flex flex-wrap items-center gap-2 rounded-2xl bg-white p-3 shadow-sm ring-1 ring-slate-200/60' +
        (pending ? ' opacity-70' : '')
      }
    >
      <div className="min-w-[180px]">
        <SelectFilter
          size="sm"
          value={period}
          onChange={(next) => update('period', next)}
          options={PERIOD_OPTIONS}
        />
      </div>
      <div className="min-w-[200px]">
        <SelectFilter
          size="sm"
          value={subjectId}
          onChange={(next) => update('subjectId', next)}
          clearable
          clearLabel="Toutes les matières"
          placeholder="Toutes les matières"
          options={subjects.map((s) => ({ value: s.id, label: s.name }))}
        />
      </div>
    </div>
  );
}
