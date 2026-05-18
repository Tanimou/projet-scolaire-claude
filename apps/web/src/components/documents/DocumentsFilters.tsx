'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

import { SearchInput, SelectFilter } from '@pilotage/ui';

import type { KindFilter, SourceFilter } from './types';

const KIND_OPTIONS: Array<{ value: KindFilter; label: string }> = [
  { value: 'all', label: 'Tous types' },
  { value: 'pdf', label: 'PDF' },
  { value: 'doc', label: 'Documents' },
  { value: 'sheet', label: 'Tableurs' },
  { value: 'slide', label: 'Présentations' },
  { value: 'image', label: 'Images' },
  { value: 'video', label: 'Vidéos' },
  { value: 'audio', label: 'Audio' },
  { value: 'archive', label: 'Archives' },
  { value: 'link', label: 'Liens web' },
  { value: 'file', label: 'Autres' },
];

const SOURCE_OPTIONS_PARENT: Array<{ value: SourceFilter; label: string }> = [
  { value: 'all', label: 'Toutes les sources' },
  { value: 'announcement', label: 'Annonces école' },
  { value: 'lesson', label: 'Cahier de texte' },
];

const SOURCE_OPTIONS_TEACHER: Array<{ value: SourceFilter; label: string }> = [
  { value: 'all', label: 'Toutes les sources' },
  { value: 'announcement', label: 'Mes messages' },
  { value: 'lesson', label: 'Mes cours' },
];

interface ClassOption {
  value: string;
  label: string;
}

/**
 * URL-driven filter strip for the documents hub. Writes `q`, `source`,
 * `kind` (and optionally `classId` for teacher) to ?searchParams while
 * preserving every other key (studentId for parent). Pagination is reset
 * on every filter change so we never paginate beyond a stale page.
 */
export function DocumentsFilters({
  portal,
  initialQuery,
  source,
  kind,
  classId,
  classes,
}: {
  portal: 'parent' | 'teacher';
  initialQuery: string;
  source: SourceFilter;
  kind: KindFilter;
  classId?: string;
  classes?: ClassOption[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const sourceOptions =
    portal === 'teacher' ? SOURCE_OPTIONS_TEACHER : SOURCE_OPTIONS_PARENT;

  function update(name: 'q' | 'source' | 'kind' | 'classId', value: string) {
    const params = new URLSearchParams(searchParams?.toString() ?? '');
    if (value && value !== 'all') {
      params.set(name, value);
    } else {
      params.delete(name);
    }
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
      <div className="min-w-[240px] flex-1">
        <SearchInput
          size="sm"
          placeholder="Rechercher un document…"
          defaultValue={initialQuery}
          onChange={(next) => update('q', next)}
        />
      </div>
      <div className="min-w-[200px]">
        <SelectFilter
          size="sm"
          value={source}
          onChange={(next) => update('source', next)}
          options={sourceOptions}
        />
      </div>
      <div className="min-w-[180px]">
        <SelectFilter
          size="sm"
          value={kind}
          onChange={(next) => update('kind', next)}
          options={KIND_OPTIONS}
        />
      </div>
      {portal === 'teacher' && classes && classes.length > 0 && (
        <div className="min-w-[180px]">
          <SelectFilter
            size="sm"
            value={classId ?? 'all'}
            onChange={(next) => update('classId', next)}
            options={[
              { value: 'all', label: 'Toutes les classes' },
              ...classes,
            ]}
          />
        </div>
      )}
    </div>
  );
}
