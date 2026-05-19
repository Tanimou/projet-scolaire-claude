'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

import { FilterBar, SearchInput, SelectFilter, type SelectOption } from '@pilotage/ui';

import type { RecipientReadFilter, RecipientRoleFilter } from './types';

const STATUS_OPTIONS: SelectOption[] = [
  { value: 'read', label: 'Lues' },
  { value: 'unread', label: 'Non lues' },
];

/**
 * URL-driven filter strip for the recipients table. The detail page mounts
 * this once so admins can narrow down on a portion of the roster (read /
 * unread, by role, free-text on name/email).
 */
export function RecipientsFilters({
  q,
  readStatus,
  roleSlug,
  roleOptions,
}: {
  q: string;
  readStatus: RecipientReadFilter;
  roleSlug: RecipientRoleFilter;
  roleOptions: Array<{ value: string; label: string; count: number }>;
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

  const roleSelectOptions: SelectOption[] = roleOptions.map((o) => ({
    value: o.value,
    label: `${o.label} (${o.count})`,
  }));

  return (
    <FilterBar
      className={pending ? 'opacity-70' : undefined}
      search={
        <SearchInput
          placeholder="Rechercher un destinataire…"
          value={q}
          onChange={(value) => update({ q: value || undefined })}
        />
      }
      filters={
        <>
          <SelectFilter
            size="sm"
            value={readStatus}
            onChange={(value) => update({ read: value || undefined })}
            options={STATUS_OPTIONS}
            clearable
            clearLabel="Lues et non lues"
            placeholder="Lues et non lues"
            fullWidth={false}
          />
          {roleSelectOptions.length > 1 && (
            <SelectFilter
              size="sm"
              value={roleSlug}
              onChange={(value) => update({ role: value || undefined })}
              options={roleSelectOptions}
              clearable
              clearLabel="Tous les rôles"
              placeholder="Tous les rôles"
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
      primaryAction={null}
    />
  );
}
