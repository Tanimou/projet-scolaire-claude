'use client';

import { RotateCcw } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

import { FilterBar, SearchInput, SelectFilter, type SelectOption } from '@pilotage/ui';

import type {
  ExportKindFilter,
  ExportPeriod,
  ExportStatusFilter,
  RequesterOption,
} from './types';

const PERIOD_OPTIONS: Array<{ value: ExportPeriod; label: string }> = [
  { value: 'all', label: 'Tout l’historique' },
  { value: '24h', label: '24 dernières heures' },
  { value: '7d', label: '7 derniers jours' },
  { value: '30d', label: '30 derniers jours' },
  { value: '90d', label: '90 derniers jours' },
];

const KIND_OPTIONS: SelectOption[] = [
  { value: 'grades_xlsx', label: 'Notes (Excel)' },
  { value: 'attendance_xlsx', label: 'Présences (Excel)' },
  { value: 'enrollment_xlsx', label: 'Inscriptions (Excel)' },
  { value: 'report_card_pdf', label: 'Bulletins (PDF)' },
  { value: 'audit_csv', label: 'Audit (CSV)' },
  { value: 'xlsx', label: '— Tous les Excel' },
  { value: 'pdf', label: '— Tous les PDF' },
  { value: 'csv', label: '— Tous les CSV' },
];

const STATUS_OPTIONS: SelectOption[] = [
  { value: 'inflight', label: 'En file ou en cours' },
  { value: 'pending', label: 'En file' },
  { value: 'running', label: 'En cours' },
  { value: 'succeeded', label: 'Prêts' },
  { value: 'failed', label: 'En échec' },
  { value: 'completed', label: 'Terminés (prêts + échecs)' },
];

/**
 * URL-driven filter strip for /admin/exports. Resets `page` on every change so
 * the list always lands on the first row of the new view.
 */
export function ExportsFilters({
  period,
  status,
  kind,
  requesterId,
  q,
  requesters,
}: {
  period: ExportPeriod;
  status: ExportStatusFilter;
  kind: ExportKindFilter;
  requesterId: string;
  q: string;
  requesters: RequesterOption[];
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

  function reset() {
    startTransition(() => {
      router.push(pathname ?? '/admin/exports');
    });
  }

  const hasActiveFilters =
    !!q || !!kind || !!status || !!requesterId || (period && period !== 'all');

  return (
    <FilterBar
      className={pending ? 'opacity-70' : undefined}
      search={
        <SearchInput
          placeholder="Rechercher un fichier ou un·e demandeur·euse…"
          value={q}
          onChange={(value) => update({ q: value || undefined })}
        />
      }
      filters={
        <>
          <SelectFilter
            size="sm"
            value={period === 'all' ? '' : period}
            onChange={(value) => update({ period: value || undefined })}
            options={PERIOD_OPTIONS.filter((o) => o.value !== 'all')}
            clearable
            clearLabel="Tout l’historique"
            placeholder="Tout l’historique"
            fullWidth={false}
          />
          <SelectFilter
            size="sm"
            value={kind}
            onChange={(value) => update({ kind: value || undefined })}
            options={KIND_OPTIONS}
            clearable
            clearLabel="Tous les types"
            placeholder="Tous les types"
            fullWidth={false}
          />
          <SelectFilter
            size="sm"
            value={status}
            onChange={(value) => update({ status: value || undefined })}
            options={STATUS_OPTIONS}
            clearable
            clearLabel="Tous statuts"
            placeholder="Tous statuts"
            fullWidth={false}
          />
          {requesters.length > 1 && (
            <SelectFilter
              size="sm"
              value={requesterId}
              onChange={(value) => update({ requesterId: value || undefined })}
              options={requesters.map((r) => ({ value: r.id, label: r.name }))}
              clearable
              clearLabel="Tous les demandeurs"
              placeholder="Tous les demandeurs"
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
      primaryAction={
        hasActiveFilters ? (
          <button
            type="button"
            onClick={reset}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Réinitialiser
          </button>
        ) : null
      }
    />
  );
}
