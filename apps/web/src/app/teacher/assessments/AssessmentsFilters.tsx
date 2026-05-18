'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

import { FilterBar, SearchInput, SelectFilter, type SelectOption } from '@pilotage/ui';

export type AssessmentsStatus = 'upcoming' | 'today' | 'past' | 'published' | 'draft' | 'needs-publish' | '';
export type AssessmentsSort = 'date-desc' | 'date-asc' | 'title' | 'class';

interface OptionItem {
  id: string;
  label: string;
}

const STATUS_OPTIONS: SelectOption[] = [
  { value: 'upcoming', label: 'À venir' },
  { value: 'today', label: "Aujourd'hui" },
  { value: 'past', label: 'Passées' },
  { value: 'published', label: 'Publiées' },
  { value: 'draft', label: 'Brouillons' },
  { value: 'needs-publish', label: 'À publier (notes saisies)' },
];

const KIND_OPTIONS: SelectOption[] = [
  { value: 'written_test', label: 'Contrôle écrit' },
  { value: 'oral_test', label: 'Oral' },
  { value: 'homework', label: 'Devoir maison' },
  { value: 'project', label: 'Projet' },
  { value: 'practical', label: 'TP' },
  { value: 'participation', label: 'Participation' },
];

const SORT_OPTIONS: SelectOption[] = [
  { value: 'date-desc', label: 'Date (récent → ancien)' },
  { value: 'date-asc', label: 'Date (ancien → récent)' },
  { value: 'title', label: 'Titre (A → Z)' },
  { value: 'class', label: 'Classe (A → Z)' },
];

export function AssessmentsFilters({
  classes,
  subjects,
  terms,
  q,
  classSectionId,
  subjectCode,
  kind,
  status,
  termId,
  sort,
}: {
  classes: OptionItem[];
  subjects: OptionItem[];
  terms: OptionItem[];
  q: string;
  classSectionId: string;
  subjectCode: string;
  kind: string;
  status: AssessmentsStatus;
  termId: string;
  sort: AssessmentsSort;
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
          placeholder="Rechercher une évaluation (titre, description)…"
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
            placeholder="Classe"
            options={classes.map((c) => ({ value: c.id, label: c.label }))}
            fullWidth={false}
          />
          <SelectFilter
            size="sm"
            value={subjectCode}
            onChange={(value) => update({ subjectCode: value || undefined })}
            clearable
            clearLabel="Toutes les matières"
            placeholder="Matière"
            options={subjects.map((s) => ({ value: s.id, label: s.label }))}
            fullWidth={false}
          />
          <SelectFilter
            size="sm"
            value={kind}
            onChange={(value) => update({ kind: value || undefined })}
            clearable
            clearLabel="Tous les types"
            placeholder="Type"
            options={KIND_OPTIONS}
            fullWidth={false}
          />
          <SelectFilter
            size="sm"
            value={status}
            onChange={(value) => update({ status: value || undefined })}
            clearable
            clearLabel="Tous les statuts"
            placeholder="Statut"
            options={STATUS_OPTIONS}
            fullWidth={false}
          />
          {terms.length > 0 && (
            <SelectFilter
              size="sm"
              value={termId}
              onChange={(value) => update({ termId: value || undefined })}
              clearable
              clearLabel="Tous les trimestres"
              placeholder="Trimestre"
              options={terms.map((t) => ({ value: t.id, label: t.label }))}
              fullWidth={false}
            />
          )}
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
