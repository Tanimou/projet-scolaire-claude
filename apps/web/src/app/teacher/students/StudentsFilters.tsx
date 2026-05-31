'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

import { FilterBar, SearchInput, SelectFilter, type SelectOption } from '@pilotage/ui';

import { AT_RISK_GRADE_20 } from './at-risk';

export type StudentsActivity = 'recent' | 'none' | 'at-risk' | '';
export type StudentsSort = 'name' | 'recent' | 'avg-desc' | 'avg-asc';

interface ClassOption {
  id: string;
  name: string;
  gradeLevelName: string;
}

const GENDER_OPTIONS: SelectOption[] = [
  { value: 'M', label: 'Garçons' },
  { value: 'F', label: 'Filles' },
];

const ACTIVITY_OPTIONS: SelectOption[] = [
  { value: 'recent', label: 'Notes récentes (30j)' },
  { value: 'none', label: 'Aucune note encore' },
  { value: 'at-risk', label: `À risque (moy. < ${AT_RISK_GRADE_20})` },
];

const SORT_OPTIONS: SelectOption[] = [
  { value: 'name', label: 'Nom (A → Z)' },
  { value: 'recent', label: 'Activité récente' },
  { value: 'avg-desc', label: 'Moyenne (haute → basse)' },
  { value: 'avg-asc', label: 'Moyenne (basse → haute)' },
];

export function StudentsFilters({
  classes,
  q,
  classSectionId,
  gender,
  activity,
  sort,
}: {
  classes: ClassOption[];
  q: string;
  classSectionId: string;
  gender: string;
  activity: StudentsActivity;
  sort: StudentsSort;
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
          placeholder="Rechercher un élève (nom, prénom, référence)…"
          value={q}
          onChange={(value) => update({ q: value || undefined })}
        />
      }
      filters={
        <>
          <SelectFilter
            size="sm"
            value={classSectionId}
            onChange={(value) => update({ classSectionId: value || undefined })}
            clearable
            clearLabel="Toutes les classes"
            placeholder="Toutes les classes"
            options={classes.map((c) => ({
              value: c.id,
              label: `${c.name} · ${c.gradeLevelName}`,
            }))}
            fullWidth={false}
          />
          <SelectFilter
            size="sm"
            value={gender}
            onChange={(value) => update({ gender: value || undefined })}
            clearable
            clearLabel="Tous"
            placeholder="Genre"
            options={GENDER_OPTIONS}
            fullWidth={false}
          />
          <SelectFilter
            size="sm"
            value={activity}
            onChange={(value) => update({ activity: value || undefined })}
            clearable
            clearLabel="Toute activité"
            placeholder="Activité"
            options={ACTIVITY_OPTIONS}
            fullWidth={false}
          />
          <SelectFilter
            size="sm"
            value={sort}
            onChange={(value) => update({ sort: value || undefined })}
            options={SORT_OPTIONS}
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
