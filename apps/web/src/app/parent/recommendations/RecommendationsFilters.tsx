'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

import { FilterBar, SearchInput, SelectFilter, type SelectOption } from '@pilotage/ui';

import type {
  AcknowledgedFilter,
  AlertCodeFilter,
  SeverityFilter,
  SubjectOption,
} from './types';

const SEVERITY_OPTIONS: SelectOption[] = [
  { value: 'high', label: 'Critiques' },
  { value: 'medium', label: 'Modérées' },
  { value: 'low', label: 'Faibles' },
];

const CODE_OPTIONS: SelectOption[] = [
  { value: 'LOW_SUBJECT_AVG', label: 'Moyenne basse' },
  { value: 'NEGATIVE_TREND', label: 'Tendance négative' },
  { value: 'REPEATED_FAILURE', label: 'Échecs répétés' },
  { value: 'MISSING_ASSESSMENT', label: 'Évaluation manquante' },
  { value: 'HIGH_ABSENCE', label: 'Absences élevées' },
  { value: 'TEACHER_COMMENT_FLAG', label: 'Signalement enseignant' },
  { value: 'BEHAVIOR_ALERT', label: 'Comportement' },
];

const STATUS_OPTIONS: SelectOption[] = [
  { value: 'open', label: 'À examiner' },
  { value: 'acknowledged', label: 'Lues' },
];

/**
 * URL-driven filter strip for /parent/recommendations. Preserves `studentId`
 * so the parent doesn't fall off their selected child.
 */
export function RecommendationsFilters({
  subjects,
  severity,
  alertCode,
  subjectId,
  ackStatus,
  q,
}: {
  subjects: SubjectOption[];
  severity: SeverityFilter;
  alertCode: AlertCodeFilter;
  subjectId: string;
  ackStatus: AcknowledgedFilter;
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
          placeholder="Rechercher dans les recommandations…"
          value={q}
          onChange={(value) => update({ q: value || undefined })}
        />
      }
      filters={
        <>
          <SelectFilter
            size="sm"
            value={severity}
            onChange={(value) => update({ severity: value || undefined })}
            options={SEVERITY_OPTIONS}
            clearable
            clearLabel="Toutes sévérités"
            placeholder="Toutes sévérités"
            fullWidth={false}
          />
          <SelectFilter
            size="sm"
            value={alertCode}
            onChange={(value) => update({ code: value || undefined })}
            options={CODE_OPTIONS}
            clearable
            clearLabel="Tous les types"
            placeholder="Tous les types"
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
          <SelectFilter
            size="sm"
            value={ackStatus}
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
