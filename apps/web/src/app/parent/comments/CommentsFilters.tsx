'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

import { FilterBar, SearchInput, SelectFilter, type SelectOption } from '@pilotage/ui';

import type {
  SubjectFilter,
  SubjectOption,
  TermFilter,
  TermOption,
  TierFilter,
} from './types';

const TIER_OPTIONS: SelectOption[] = [
  { value: 'positive', label: 'Encouragements (≥ 14)' },
  { value: 'neutral', label: 'Neutres (10–14)' },
  { value: 'concern', label: 'À surveiller (< 10)' },
];

/**
 * URL-driven filter strip for /parent/comments. Preserves `studentId`
 * so the parent doesn't fall off their selected child.
 */
export function CommentsFilters({
  subjects,
  terms,
  subjectId,
  tier,
  term,
  q,
}: {
  subjects: SubjectOption[];
  terms: TermOption[];
  subjectId: SubjectFilter;
  tier: TierFilter;
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
          placeholder="Rechercher dans les commentaires…"
          value={q}
          onChange={(value) => update({ q: value || undefined })}
        />
      }
      filters={
        <>
          <SelectFilter
            size="sm"
            value={tier}
            onChange={(value) => update({ tier: value || undefined })}
            options={TIER_OPTIONS}
            clearable
            clearLabel="Toutes les tonalités"
            placeholder="Toutes les tonalités"
            fullWidth={false}
          />
          {subjects.length > 0 && (
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
