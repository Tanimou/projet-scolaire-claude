'use client';

import { CalendarRange, RotateCcw, X } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

import { FilterBar, SearchInput, SelectFilter, type SelectOption } from '@pilotage/ui';

export interface AuditPageFiltersProps {
  initialQ: string;
  initialResourceType: string;
  initialPortal: string;
  initialActorId: string;
  initialFrom: string;
  initialTo: string;
  resourceTypeOptions: SelectOption[];
  portalOptions: SelectOption[];
  actorOptions: SelectOption[];
}

const RESOURCE_TYPE_LABELS: Record<string, string> = {
  user_profile: 'Utilisateurs',
  role: 'Rôles',
  assessment: 'Évaluations',
  academic_year: 'Année scolaire',
  subject_coefficient: 'Coefficients',
  import_batch: 'Imports',
  enrollment: 'Inscriptions',
  enrollment_request: 'Demandes',
  student: 'Élèves',
  class_section: 'Classes',
  teacher_profile: 'Enseignants',
  grade: 'Notes',
  announcement: 'Annonces',
};

const PORTAL_LABELS: Record<string, string> = {
  admin: 'Admin',
  teacher: 'Professeur',
  parent: 'Parent',
};

export function humanizeResourceType(rt: string): string {
  return (
    RESOURCE_TYPE_LABELS[rt] ??
    rt
      .replace(/_/g, ' ')
      .replace(/^./, (c) => c.toUpperCase())
  );
}

export function humanizePortal(p: string | null): string {
  if (!p) return '—';
  return PORTAL_LABELS[p] ?? p;
}

export function AuditPageFilters({
  initialQ,
  initialResourceType,
  initialPortal,
  initialActorId,
  initialFrom,
  initialTo,
  resourceTypeOptions,
  portalOptions,
  actorOptions,
}: AuditPageFiltersProps) {
  const router = useRouter();
  const params = useSearchParams();
  const [isPending, startTransition] = useTransition();

  function update(patch: Record<string, string | undefined>) {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    next.delete('page');
    startTransition(() => {
      router.push(`/admin/audit?${next.toString()}`);
    });
  }

  function clearAll() {
    startTransition(() => {
      router.push(`/admin/audit`);
    });
  }

  const hasActiveFilters =
    !!initialQ ||
    !!initialResourceType ||
    !!initialPortal ||
    !!initialActorId ||
    !!initialFrom ||
    !!initialTo;

  return (
    <div className="space-y-3">
      <FilterBar
        search={
          <SearchInput
            placeholder="Rechercher une action (login, publish, export…)"
            value={initialQ}
            onChange={(v) => update({ action: v || undefined })}
          />
        }
        filters={
          <>
            <SelectFilter
              options={resourceTypeOptions}
              value={initialResourceType}
              onChange={(v) => update({ resourceType: v || undefined })}
              placeholder="Toutes les ressources"
              clearable
              clearLabel="Toutes les ressources"
              fullWidth={false}
            />
            <SelectFilter
              options={portalOptions}
              value={initialPortal}
              onChange={(v) => update({ portal: v || undefined })}
              placeholder="Tous les portails"
              clearable
              clearLabel="Tous les portails"
              fullWidth={false}
            />
            <SelectFilter
              options={actorOptions}
              value={initialActorId}
              onChange={(v) => update({ actorId: v || undefined })}
              placeholder="Tous les utilisateurs"
              clearable
              clearLabel="Tous les utilisateurs"
              fullWidth={false}
            />
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

      <div className="flex flex-wrap items-end gap-3 rounded-2xl bg-white p-3 shadow-sm ring-1 ring-slate-200/60">
        <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500">
          <CalendarRange className="h-3.5 w-3.5" />
          Période
        </div>
        <label className="flex flex-col text-[11px] font-medium text-slate-500">
          <span className="mb-1">Du</span>
          <input
            type="date"
            value={initialFrom}
            onChange={(e) => update({ from: e.target.value || undefined })}
            className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 transition focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-400/30"
          />
        </label>
        <label className="flex flex-col text-[11px] font-medium text-slate-500">
          <span className="mb-1">Au</span>
          <input
            type="date"
            value={initialTo}
            onChange={(e) => update({ to: e.target.value || undefined })}
            className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 transition focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-400/30"
          />
        </label>
        <div className="ml-auto flex flex-wrap gap-1.5">
          <QuickRangeButton label="Aujourd'hui" days={0} onPick={update} />
          <QuickRangeButton label="7 j" days={7} onPick={update} />
          <QuickRangeButton label="30 j" days={30} onPick={update} />
          <QuickRangeButton label="90 j" days={90} onPick={update} />
        </div>
      </div>

      {hasActiveFilters && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <span className="font-semibold uppercase tracking-wider">Filtres actifs :</span>
          {initialQ && (
            <FilterChip label={`Action : "${initialQ}"`} onClear={() => update({ action: undefined })} />
          )}
          {initialResourceType && (
            <FilterChip
              label={`Ressource : ${humanizeResourceType(initialResourceType)}`}
              onClear={() => update({ resourceType: undefined })}
            />
          )}
          {initialPortal && (
            <FilterChip
              label={`Portail : ${humanizePortal(initialPortal)}`}
              onClear={() => update({ portal: undefined })}
            />
          )}
          {initialActorId && (
            <FilterChip
              label={`Utilisateur : ${actorOptions.find((o) => o.value === initialActorId)?.label ?? '—'}`}
              onClear={() => update({ actorId: undefined })}
            />
          )}
          {initialFrom && (
            <FilterChip label={`Depuis ${initialFrom}`} onClear={() => update({ from: undefined })} />
          )}
          {initialTo && (
            <FilterChip label={`Jusqu'au ${initialTo}`} onClear={() => update({ to: undefined })} />
          )}
        </div>
      )}
    </div>
  );
}

function QuickRangeButton({
  label,
  days,
  onPick,
}: {
  label: string;
  days: number;
  onPick: (patch: Record<string, string | undefined>) => void;
}) {
  function apply() {
    const today = new Date();
    const to = today.toISOString().slice(0, 10);
    const from = new Date(today.getTime() - days * 86_400_000).toISOString().slice(0, 10);
    onPick({ from, to });
  }
  return (
    <button
      type="button"
      onClick={apply}
      className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-600 transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
    >
      {label}
    </button>
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
