'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

export interface ChildOption {
  id: string;
  firstName: string;
  lastName: string;
}

/**
 * Child selector pills — present on every parent sub-page when the parent has
 * more than one child. Pushes `?studentId=<id>` to the current URL while
 * preserving every other query param.
 */
export function ChildSelector({
  items,
  activeStudentId,
}: {
  items: ChildOption[];
  activeStudentId: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  if (items.length <= 1) return null;

  function pick(studentId: string) {
    const params = new URLSearchParams(searchParams?.toString() ?? '');
    params.set('studentId', studentId);
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`);
    });
  }

  return (
    <div
      role="radiogroup"
      aria-label="Sélection de l'enfant"
      className="mb-4 inline-flex flex-wrap items-center gap-1.5 rounded-full bg-slate-100 p-1"
    >
      {items.map((c) => {
        const active = c.id === activeStudentId;
        return (
          <button
            key={c.id}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={pending}
            onClick={() => pick(c.id)}
            className={
              active
                ? 'inline-flex items-center rounded-full bg-white px-3 py-1 text-xs font-bold text-slate-900 shadow-sm ring-1 ring-slate-200'
                : 'inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold text-slate-600 transition hover:bg-white/60 disabled:cursor-not-allowed disabled:opacity-60'
            }
          >
            {c.firstName} {c.lastName.slice(0, 1)}.
          </button>
        );
      })}
    </div>
  );
}
