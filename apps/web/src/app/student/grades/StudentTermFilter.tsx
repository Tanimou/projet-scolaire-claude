'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

import { SelectFilter } from '@pilotage/ui';

/**
 * URL-driven term filter for /student/grades. A pure read filter — never a
 * mutation. Drives `?termId=`; clearing it shows every published grade.
 */
export function StudentTermFilter({
  terms,
  termId,
}: {
  terms: { id: string; name: string }[];
  termId: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  function update(next: string) {
    const params = new URLSearchParams(searchParams?.toString() ?? '');
    if (next) params.set('termId', next);
    else params.delete('termId');
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`);
    });
  }

  if (terms.length === 0) return null;

  return (
    <div className="flex items-center gap-3">
      <SelectFilter
        size="sm"
        label="Trimestre"
        value={termId}
        onChange={update}
        clearable
        clearLabel="Toute l'année"
        placeholder="Toute l'année"
        options={terms.map((t) => ({ value: t.id, label: t.name }))}
        fullWidth={false}
      />
      {pending && (
        <span className="text-[11px] text-slate-400" aria-live="polite">
          Mise à jour…
        </span>
      )}
    </div>
  );
}
