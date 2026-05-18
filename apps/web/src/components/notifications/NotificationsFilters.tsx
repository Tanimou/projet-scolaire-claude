'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

import { FilterBar, SearchInput, SelectFilter, type SelectOption } from '@pilotage/ui';

import type { Portal } from './NotificationCenter';

export interface NotificationsFiltersProps {
  portal: Portal;
  initialQ: string;
  initialStatus: string;
  initialKind: string;
  initialSeverity: string;
}

const STATUS_OPTIONS: SelectOption[] = [
  { value: 'unread', label: 'Non lues' },
  { value: 'read', label: 'Lues' },
];

const KIND_OPTIONS: SelectOption[] = [
  { value: 'announcement', label: 'Annonces' },
  { value: 'alert', label: 'Alertes' },
  { value: 'grade_published', label: 'Notes publiées' },
  { value: 'enrollment_status', label: 'Inscriptions' },
  { value: 'lesson_published', label: 'Cours publiés' },
  { value: 'system', label: 'Système' },
];

const SEVERITY_OPTIONS: SelectOption[] = [
  { value: 'danger', label: 'Critique' },
  { value: 'warning', label: 'Attention' },
  { value: 'success', label: 'Succès' },
  { value: 'info', label: 'Information' },
];

/**
 * Client-side filter strip for the shared notification center. URL-driven so
 * the page stays a server component. Pushes back to `/{portal}/notifications`
 * with the merged query string.
 */
export function NotificationsFilters({
  portal,
  initialQ,
  initialStatus,
  initialKind,
  initialSeverity,
}: NotificationsFiltersProps) {
  const router = useRouter();
  const params = useSearchParams();
  const [isPending, startTransition] = useTransition();

  function update(patch: Record<string, string | undefined>) {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    const qs = next.toString();
    startTransition(() => {
      router.push(qs ? `/${portal}/notifications?${qs}` : `/${portal}/notifications`);
    });
  }

  return (
    <FilterBar
      search={
        <SearchInput
          placeholder="Rechercher dans les notifications…"
          value={initialQ}
          onChange={(v) => update({ q: v || undefined })}
        />
      }
      filters={
        <>
          <SelectFilter
            options={STATUS_OPTIONS}
            value={initialStatus}
            onChange={(v) => update({ status: v || undefined })}
            placeholder="Toutes"
            clearable
            clearLabel="Toutes"
            fullWidth={false}
          />
          <SelectFilter
            options={KIND_OPTIONS}
            value={initialKind}
            onChange={(v) => update({ kind: v || undefined })}
            placeholder="Tous types"
            clearable
            clearLabel="Tous types"
            fullWidth={false}
          />
          <SelectFilter
            options={SEVERITY_OPTIONS}
            value={initialSeverity}
            onChange={(v) => update({ severity: v || undefined })}
            placeholder="Toutes priorités"
            clearable
            clearLabel="Toutes priorités"
            fullWidth={false}
          />
          {isPending && (
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
