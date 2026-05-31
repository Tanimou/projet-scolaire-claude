'use client';

import { Layers, SearchX } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';

import {
  CapacityBar,
  EmptyState,
  FilterBar,
  SearchInput,
  SelectFilter,
  SubjectChip,
  formatGrade,
  type SelectOption,
} from '@pilotage/ui';

export interface ClassCardData {
  classSectionId: string;
  primaryAssignmentId: string;
  className: string;
  gradeLevelName: string;
  cycleName: string;
  cycleColor: string | null;
  enrolledCount: number;
  maxStudents: number;
  subjects: Array<{
    id: string;
    code: string;
    name: string;
    coefficient: number;
    assignmentId: string;
  }>;
  isMainTeacher: boolean;
  weeklyHours: number;
}

type SortKey = 'name' | 'students-desc' | 'hours-desc' | 'fill-desc';

const SORT_OPTIONS: SelectOption[] = [
  { value: 'name', label: 'Nom (A → Z)' },
  { value: 'students-desc', label: 'Effectif (haut → bas)' },
  { value: 'fill-desc', label: "Taux de remplissage" },
  { value: 'hours-desc', label: 'Volume horaire (haut → bas)' },
];

function fillRatio(c: ClassCardData): number {
  return c.maxStudents > 0 ? c.enrolledCount / c.maxStudents : 0;
}

export function TeacherClassesGrid({ classes }: { classes: ClassCardData[] }) {
  const [q, setQ] = useState('');
  const [cycle, setCycle] = useState('');
  const [subject, setSubject] = useState('');
  const [sort, setSort] = useState<SortKey>('name');

  // Build the cycle / subject option lists from the data so the filters only
  // ever offer values the teacher actually has — no empty filter results from
  // stale options.
  const cycleOptions = useMemo<SelectOption[]>(() => {
    const seen = new Map<string, string>();
    for (const c of classes) if (c.cycleName) seen.set(c.cycleName, c.cycleName);
    return [...seen.keys()].sort((a, b) => a.localeCompare(b)).map((v) => ({ value: v, label: v }));
  }, [classes]);

  const subjectOptions = useMemo<SelectOption[]>(() => {
    const seen = new Map<string, string>();
    for (const c of classes) for (const s of c.subjects) seen.set(s.code, s.name);
    return [...seen.entries()]
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([value, label]) => ({ value, label }));
  }, [classes]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const filtered = classes.filter((c) => {
      if (needle) {
        const haystack = `${c.className} ${c.gradeLevelName} ${c.cycleName}`.toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      if (cycle && c.cycleName !== cycle) return false;
      if (subject && !c.subjects.some((s) => s.code === subject)) return false;
      return true;
    });

    const sorted = [...filtered];
    switch (sort) {
      case 'students-desc':
        sorted.sort((a, b) => b.enrolledCount - a.enrolledCount || a.className.localeCompare(b.className));
        break;
      case 'fill-desc':
        sorted.sort((a, b) => fillRatio(b) - fillRatio(a) || a.className.localeCompare(b.className));
        break;
      case 'hours-desc':
        sorted.sort((a, b) => b.weeklyHours - a.weeklyHours || a.className.localeCompare(b.className));
        break;
      default:
        sorted.sort((a, b) => a.className.localeCompare(b.className));
    }
    return sorted;
  }, [classes, q, cycle, subject, sort]);

  const hasActiveFilters = Boolean(q.trim() || cycle || subject);

  function reset() {
    setQ('');
    setCycle('');
    setSubject('');
    setSort('name');
  }

  return (
    <section className="mt-6">
      <FilterBar
        search={
          <SearchInput
            placeholder="Rechercher une classe (nom, niveau, cycle)…"
            value={q}
            onChange={setQ}
          />
        }
        filters={
          <>
            {cycleOptions.length > 1 && (
              <SelectFilter
                size="sm"
                value={cycle}
                onChange={(value) => setCycle(value)}
                clearable
                clearLabel="Tous les cycles"
                placeholder="Cycle"
                options={cycleOptions}
                fullWidth={false}
              />
            )}
            {subjectOptions.length > 1 && (
              <SelectFilter
                size="sm"
                value={subject}
                onChange={(value) => setSubject(value)}
                clearable
                clearLabel="Toutes les matières"
                placeholder="Matière"
                options={subjectOptions}
                fullWidth={false}
              />
            )}
            <SelectFilter
              size="sm"
              value={sort}
              onChange={(value) => setSort((value as SortKey) || 'name')}
              options={SORT_OPTIONS}
              fullWidth={false}
            />
          </>
        }
        primaryAction={null}
      />

      {/* Result count — gives the teacher a clear sense of the active filter scope */}
      {classes.length > 0 && (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-slate-500">
          <Layers className="h-3.5 w-3.5 text-slate-400" />
          <span>
            <strong className="font-bold text-slate-700 tabular-nums">{visible.length}</strong>{' '}
            classe{visible.length > 1 ? 's' : ''}
            {hasActiveFilters && classes.length !== visible.length
              ? ` sur ${classes.length}`
              : ''}
          </span>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={reset}
              className="ml-1 font-semibold accent-text hover:underline"
            >
              Réinitialiser
            </button>
          )}
        </p>
      )}

      <div className="mt-4">
        {visible.length === 0 ? (
          <EmptyState
            icon={SearchX}
            title="Aucune classe ne correspond"
            description="Aucune classe ne correspond à votre recherche ou à vos filtres. Ajustez les critères ou réinitialisez les filtres."
            tone="slate"
            action={
              hasActiveFilters
                ? { label: 'Réinitialiser les filtres', onClick: reset }
                : undefined
            }
          />
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {visible.map((c) => (
              <li
                key={c.classSectionId}
                className="relative overflow-hidden rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/60 transition hover:-translate-y-0.5 hover:ring-slate-300"
              >
                {/* Cycle-color accent rail — subtle but meaningful colour cue */}
                <span
                  aria-hidden
                  className="absolute inset-y-0 left-0 w-1"
                  style={{ backgroundColor: c.cycleColor ?? '#cbd5e1' }}
                />
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="truncate text-base font-bold text-slate-900">{c.className}</h3>
                    <p className="flex items-center gap-1.5 text-xs text-slate-500">
                      <span
                        aria-hidden
                        className="inline-block h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: c.cycleColor ?? '#cbd5e1' }}
                      />
                      {c.gradeLevelName} · {c.cycleName}
                    </p>
                  </div>
                  {c.isMainTeacher && (
                    <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-800">
                      Prof principal
                    </span>
                  )}
                </div>

                <div className="mt-3">
                  <div className="flex items-baseline justify-between text-xs">
                    <span className="text-slate-500">Effectif</span>
                    <span className="font-mono tabular-nums text-slate-700">
                      {c.enrolledCount} / {c.maxStudents}
                    </span>
                  </div>
                  <CapacityBar value={c.enrolledCount} max={c.maxStudents} className="mt-1" />
                </div>

                <div className="mt-3 flex flex-wrap gap-1.5">
                  {c.subjects.map((s) => (
                    <Link
                      key={s.id}
                      href={`/teacher/classes/${s.assignmentId}/grades`}
                      title={`Ouvrir la gradebook ${s.name}`}
                      className="rounded-full ring-1 ring-transparent transition hover:ring-slate-300"
                    >
                      <SubjectChip subjectCode={s.code} label={s.name} size="sm" />
                    </Link>
                  ))}
                </div>

                {c.weeklyHours > 0 && (
                  <p className="mt-2 text-[11px] text-slate-500">
                    Volume horaire : <strong>{formatGrade(c.weeklyHours, 1)} h/sem</strong>
                  </p>
                )}

                <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <Link
                    href={`/teacher/classes/${c.primaryAssignmentId}`}
                    className="font-bold accent-text hover:underline"
                  >
                    Voir la classe →
                  </Link>
                  <div className="flex gap-2">
                    <Link
                      href={`/teacher/classes/${c.primaryAssignmentId}/grades`}
                      className="rounded-md bg-emerald-50 px-2 py-1 font-bold text-emerald-700 hover:bg-emerald-100"
                    >
                      Notes
                    </Link>
                    <Link
                      href={`/teacher/classes/${c.primaryAssignmentId}/attendance`}
                      className="rounded-md bg-sky-50 px-2 py-1 font-bold text-sky-700 hover:bg-sky-100"
                    >
                      Appel
                    </Link>
                    <Link
                      href={`/teacher/classes/${c.primaryAssignmentId}/lessons`}
                      className="rounded-md bg-violet-50 px-2 py-1 font-bold text-violet-700 hover:bg-violet-100"
                    >
                      Cahier
                    </Link>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
