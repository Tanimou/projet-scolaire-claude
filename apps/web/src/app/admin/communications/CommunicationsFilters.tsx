'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

import { FilterBar, SearchInput, SelectFilter, type SelectOption } from '@pilotage/ui';

import type {
  AnnouncementScope,
  PinnedFilter,
  PriorityFilter,
  ScopeFilter,
  StatusFilter,
} from './types';

const SCOPE_OPTIONS: { value: AnnouncementScope; label: string }[] = [
  { value: 'school_wide', label: "Toute l'école" },
  { value: 'cycle_scope', label: 'Cycle' },
  { value: 'grade_level_scope', label: 'Niveau' },
  { value: 'class_section_scope', label: 'Classe' },
  { value: 'individual_student', label: 'Élève (parents)' },
  { value: 'individual_user', label: 'Utilisateur' },
];

const PRIORITY_OPTIONS: SelectOption[] = [
  { value: 'urgent', label: 'Urgente' },
  { value: 'high', label: 'Haute' },
  { value: 'normal', label: 'Normale' },
];

const STATUS_OPTIONS: SelectOption[] = [
  { value: 'published', label: 'Publiées (actives)' },
  { value: 'expired', label: 'Expirées' },
  { value: 'draft', label: 'Brouillons' },
];

const PINNED_OPTIONS: SelectOption[] = [{ value: 'pinned', label: 'Épinglées' }];

/**
 * URL-driven filter strip for /admin/communications. Resets `page` on every
 * change so the parent doesn't end up on an out-of-range page after filtering.
 */
export function CommunicationsFilters({
  availableScopes,
  q,
  scope,
  priority,
  status,
  pinned,
}: {
  availableScopes: AnnouncementScope[];
  q: string;
  scope: ScopeFilter;
  priority: PriorityFilter;
  status: StatusFilter;
  pinned: PinnedFilter;
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

  const visibleScopes = SCOPE_OPTIONS.filter((s) => availableScopes.includes(s.value));

  return (
    <FilterBar
      className={pending ? 'opacity-70' : undefined}
      search={
        <SearchInput
          placeholder="Rechercher dans les annonces…"
          value={q}
          onChange={(value) => update({ q: value || undefined })}
        />
      }
      filters={
        <>
          <SelectFilter
            size="sm"
            value={status}
            onChange={(value) => update({ status: value || undefined })}
            options={STATUS_OPTIONS}
            clearable
            clearLabel="Tous les statuts"
            placeholder="Tous les statuts"
            fullWidth={false}
          />
          <SelectFilter
            size="sm"
            value={priority}
            onChange={(value) => update({ priority: value || undefined })}
            options={PRIORITY_OPTIONS}
            clearable
            clearLabel="Toutes priorités"
            placeholder="Toutes priorités"
            fullWidth={false}
          />
          {visibleScopes.length > 1 && (
            <SelectFilter
              size="sm"
              value={scope}
              onChange={(value) => update({ scope: value || undefined })}
              options={visibleScopes}
              clearable
              clearLabel="Toutes les portées"
              placeholder="Toutes les portées"
              fullWidth={false}
            />
          )}
          <SelectFilter
            size="sm"
            value={pinned}
            onChange={(value) => update({ pinned: value || undefined })}
            options={PINNED_OPTIONS}
            clearable
            clearLabel="Toutes"
            placeholder="Toutes"
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
