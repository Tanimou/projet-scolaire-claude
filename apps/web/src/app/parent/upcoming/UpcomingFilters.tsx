'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

import { FilterBar, SearchInput, SelectFilter, type SelectOption } from '@pilotage/ui';

import type {
  HorizonFilter,
  KindFilter,
  KindOption,
  SubjectFilter,
  SubjectOption,
  TermFilter,
  TermOption,
} from './types';

const HORIZON_OPTIONS: SelectOption[] = [
  { value: 'this-week', label: 'Cette semaine (≤ 7 j)' },
  { value: 'next-week', label: 'Semaine prochaine (7–14 j)' },
  { value: 'later', label: 'Au-delà (15–60 j)' },
];

/**
 * URL-driven filter strip for /parent/upcoming. Preserves `studentId` so the
 * parent stays on their selected child while filtering.
 */
export function UpcomingFilters({
  subjects,
  kinds,
  terms,
  subjectId,
  kind,
  horizon,
  term,
  q,
}: {
  subjects: SubjectOption[];
  kinds: KindOption[];
  terms: TermOption[];
  subjectId: SubjectFilter;
  kind: KindFilter;
  horizon: HorizonFilter;
  term: TermFilter;
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
          placeholder="Rechercher (titre, description, matière)…"
          value={q}
          onChange={(value) => update({ q: value || undefined })}
        />
      }
      filters={
        <>
          <SelectFilter
            size="sm"
            value={horizon}
            onChange={(value) => update({ horizon: value || undefined })}
            options={HORIZON_OPTIONS}
            clearable
            clearLabel="Toutes les échéances"
            placeholder="Toutes les échéances"
            fullWidth={false}
          />
          {subjects.length > 1 && (
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
          )}
          {kinds.length > 1 && (
            <SelectFilter
              size="sm"
              value={kind}
              onChange={(value) => update({ kind: value || undefined })}
              options={kinds.map((k) => ({ value: k.value, label: k.label }))}
              clearable
              clearLabel="Tous les formats"
              placeholder="Tous les formats"
              fullWidth={false}
            />
          )}
          {terms.length > 1 && (
            <SelectFilter
              size="sm"
              value={term}
              onChange={(value) => update({ term: value || undefined })}
              options={terms.map((t) => ({ value: t.key, label: t.label }))}
              clearable
              clearLabel="Toutes les périodes"
              placeholder="Toutes les périodes"
              fullWidth={false}
            />
          )}
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
