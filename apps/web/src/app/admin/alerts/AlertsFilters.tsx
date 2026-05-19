'use client';

import { RotateCcw, X } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

import { FilterBar, SearchInput, SelectFilter, type SelectOption } from '@pilotage/ui';

import type { AlertsTabKey } from './types';

export interface AlertsFiltersProps {
  currentTab: AlertsTabKey;
  initialQ: string;
  initialRuleCode: string;
  initialSeverity: string;
  initialClassSection: string;
  initialStatus: string;
  ruleCodeOptions: SelectOption[];
  severityOptions: SelectOption[];
  classSectionOptions: SelectOption[];
  statusOptions: SelectOption[];
}

export function AlertsFilters({
  currentTab,
  initialQ,
  initialRuleCode,
  initialSeverity,
  initialClassSection,
  initialStatus,
  ruleCodeOptions,
  severityOptions,
  classSectionOptions,
  statusOptions,
}: AlertsFiltersProps) {
  const router = useRouter();
  const params = useSearchParams();
  const [isPending, startTransition] = useTransition();

  function update(patch: Record<string, string | undefined>) {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    next.set('tab', currentTab);
    startTransition(() => {
      router.push(`/admin/alerts?${next.toString()}`);
    });
  }

  function clearAll() {
    startTransition(() => {
      router.push(`/admin/alerts?tab=${currentTab}`);
    });
  }

  const hasActiveFilters =
    !!initialQ || !!initialRuleCode || !!initialSeverity || !!initialClassSection || !!initialStatus;

  return (
    <div className="space-y-3">
      <FilterBar
        search={
          <SearchInput
            placeholder="Rechercher un élève (nom, prénom)…"
            value={initialQ}
            onChange={(v) => update({ q: v || undefined })}
          />
        }
        filters={
          <>
            <SelectFilter
              options={ruleCodeOptions}
              value={initialRuleCode}
              onChange={(v) => update({ ruleCode: v || undefined })}
              placeholder="Toutes les règles"
              clearable
              clearLabel="Toutes les règles"
              fullWidth={false}
            />
            <SelectFilter
              options={severityOptions}
              value={initialSeverity}
              onChange={(v) => update({ severity: v || undefined })}
              placeholder="Toutes sévérités"
              clearable
              clearLabel="Toutes sévérités"
              fullWidth={false}
            />
            <SelectFilter
              options={classSectionOptions}
              value={initialClassSection}
              onChange={(v) => update({ classSection: v || undefined })}
              placeholder="Toutes les classes"
              clearable
              clearLabel="Toutes les classes"
              fullWidth={false}
            />
            {currentTab !== 'rules' && statusOptions.length > 1 && (
              <SelectFilter
                options={statusOptions}
                value={initialStatus}
                onChange={(v) => update({ status: v || undefined })}
                placeholder={currentTab === 'active' ? 'Ouvertes + vues' : 'Résolues + ignorées'}
                clearable
                clearLabel={currentTab === 'active' ? 'Ouvertes + vues' : 'Résolues + ignorées'}
                fullWidth={false}
              />
            )}
            {isPending && (
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
              onClick={clearAll}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Réinitialiser
            </button>
          ) : null
        }
      />

      {hasActiveFilters && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <span className="font-semibold uppercase tracking-wider">Filtres actifs :</span>
          {initialQ && (
            <FilterChip
              label={`Élève : "${initialQ}"`}
              onClear={() => update({ q: undefined })}
            />
          )}
          {initialRuleCode && (
            <FilterChip
              label={`Règle : ${
                ruleCodeOptions.find((o) => o.value === initialRuleCode)?.label ?? initialRuleCode
              }`}
              onClear={() => update({ ruleCode: undefined })}
            />
          )}
          {initialSeverity && (
            <FilterChip
              label={`Sévérité : ${
                severityOptions.find((o) => o.value === initialSeverity)?.label ?? initialSeverity
              }`}
              onClear={() => update({ severity: undefined })}
            />
          )}
          {initialClassSection && (
            <FilterChip
              label={`Classe : ${
                classSectionOptions.find((o) => o.value === initialClassSection)?.label ??
                initialClassSection
              }`}
              onClear={() => update({ classSection: undefined })}
            />
          )}
          {initialStatus && (
            <FilterChip
              label={`Statut : ${
                statusOptions.find((o) => o.value === initialStatus)?.label ?? initialStatus
              }`}
              onClear={() => update({ status: undefined })}
            />
          )}
        </div>
      )}
    </div>
  );
}

function FilterChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-medium text-blue-700 ring-1 ring-blue-200">
      {label}
      <button
        type="button"
        onClick={onClear}
        className="rounded-full p-0.5 transition hover:bg-blue-100"
        aria-label={`Retirer le filtre ${label}`}
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}
