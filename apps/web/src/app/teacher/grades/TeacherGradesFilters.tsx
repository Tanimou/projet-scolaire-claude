'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

import { FilterBar, SearchInput, SelectFilter, type SelectOption } from '@pilotage/ui';

import type {
  ClassOption,
  GradeStatusFilter,
  SubjectOption,
  TermOption,
} from './types';

const STATUS_OPTIONS: SelectOption[] = [
  { value: 'draft', label: 'Brouillons' },
  { value: 'published', label: 'Publiées' },
  { value: 'revised', label: 'Révisées' },
  { value: 'absent', label: 'Absents' },
];

/**
 * URL-driven filter strip for /teacher/grades. Resets `page` on every change
 * so the table always lands on the first row of the new view.
 */
export function TeacherGradesFilters({
  classes,
  subjects,
  terms,
  status,
  classId,
  subjectId,
  termId,
  q,
}: {
  classes: ClassOption[];
  subjects: SubjectOption[];
  terms: TermOption[];
  status: GradeStatusFilter;
  classId: string;
  subjectId: string;
  termId: string;
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
          placeholder="Rechercher un élève, une évaluation…"
          value={q}
          onChange={(value) => update({ q: value || undefined })}
        />
      }
      filters={
        <>
          <SelectFilter
            size="sm"
            value={classId}
            onChange={(value) => update({ classId: value || undefined })}
            options={classes.map((c) => ({ value: c.id, label: c.name }))}
            clearable
            clearLabel="Toutes les classes"
            placeholder="Toutes les classes"
            fullWidth={false}
          />
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
            value={termId}
            onChange={(value) => update({ termId: value || undefined })}
            options={terms.map((t) => ({ value: t.id, label: t.name }))}
            clearable
            clearLabel="Toutes les périodes"
            placeholder="Toutes les périodes"
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
