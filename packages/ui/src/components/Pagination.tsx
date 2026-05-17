'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useTransition } from 'react';

import { cn } from '../lib/cn';

export interface PaginationProps {
  /** Current page (1-indexed) */
  page: number;
  /** Total number of items across all pages */
  total: number;
  /** Items per page */
  pageSize: number;
  /**
   * Called when the user picks another page.
   *
   * If omitted, Pagination falls back to URL-driven navigation: it pushes
   * `?page=N` (preserving every other query param) so server pages that render
   * `<Pagination />` from a Server Component just work without wiring a
   * client-side handler.
   */
  onPageChange?: (next: number) => void;
  /** Hide the "Affichage de X à Y sur N" summary */
  hideSummary?: boolean;
  /** Force-show page numbers even when total fits in one page */
  alwaysShow?: boolean;
  /** Custom item label for the summary (default "élément(s)") */
  itemLabel?: { singular: string; plural: string };
  /**
   * Search-param key holding the page number when falling back to URL mode.
   * Defaults to "page".
   */
  pageParam?: string;
  className?: string;
}

/**
 * Pagination — image-prescriptive footer used at the bottom of admin tables.
 *
 *   Affichage de 1 à 10 sur 1 248 élèves       [‹] [1] [2] [3] … [125] [›]
 *
 * Marked as a Client Component because it owns `onClick` handlers. Server
 * pages can render it directly: if no `onPageChange` is supplied, navigation
 * is performed via Next.js router updating the `?page=` query string.
 */
export function Pagination({
  page,
  total,
  pageSize,
  onPageChange,
  hideSummary,
  alwaysShow,
  itemLabel,
  pageParam = 'page',
  className,
}: PaginationProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(total, page * pageSize);

  const itemSingular = itemLabel?.singular ?? 'élément';
  const itemPlural = itemLabel?.plural ?? 'éléments';

  // Default URL-driven navigation (used when no onPageChange is provided)
  const navigateToPage = useCallback(
    (next: number) => {
      const params = new URLSearchParams(searchParams?.toString() ?? '');
      if (next <= 1) {
        params.delete(pageParam);
      } else {
        params.set(pageParam, String(next));
      }
      const qs = params.toString();
      startTransition(() => {
        router.push(qs ? `${pathname}?${qs}` : pathname);
      });
    },
    [router, pathname, searchParams, pageParam],
  );

  const go = useCallback(
    (n: number) => {
      if (n < 1 || n > totalPages || n === page) return;
      if (onPageChange) onPageChange(n);
      else navigateToPage(n);
    },
    [navigateToPage, onPageChange, page, totalPages],
  );

  if (!alwaysShow && total <= pageSize) return null;

  // Build the visible page-number window: first, last, current ± 1, with ellipses
  const pages: Array<number | 'gap'> = [];
  function pushUnique(n: number | 'gap') {
    if (n === 'gap') {
      if (pages[pages.length - 1] !== 'gap') pages.push('gap');
      return;
    }
    if (!pages.includes(n) && n >= 1 && n <= totalPages) pages.push(n);
  }
  pushUnique(1);
  if (page - 2 > 1) pushUnique('gap');
  pushUnique(page - 1);
  pushUnique(page);
  pushUnique(page + 1);
  if (page + 2 < totalPages) pushUnique('gap');
  pushUnique(totalPages);

  return (
    <nav
      aria-label="Pagination"
      data-pending={pending ? 'true' : undefined}
      className={cn(
        'flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-white px-4 py-3 text-sm text-slate-600',
        pending && 'opacity-70',
        className,
      )}
    >
      {!hideSummary && (
        <span className="text-xs text-slate-600 sm:text-sm">
          Affichage de <strong className="font-semibold">{start}</strong> à{' '}
          <strong className="font-semibold">{end}</strong> sur{' '}
          <strong className="font-semibold">{total.toLocaleString('fr-FR')}</strong>{' '}
          {total > 1 ? itemPlural : itemSingular}
        </span>
      )}
      <div className="ml-auto inline-flex items-center gap-1">
        <button
          type="button"
          aria-label="Page précédente"
          disabled={page <= 1 || pending}
          onClick={() => go(page - 1)}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        {pages.map((p, i) =>
          p === 'gap' ? (
            <span key={`gap-${i}`} className="px-1 text-slate-400">
              …
            </span>
          ) : (
            <button
              key={p}
              type="button"
              onClick={() => go(p)}
              disabled={pending}
              aria-current={p === page ? 'page' : undefined}
              className={cn(
                'inline-flex h-8 min-w-8 items-center justify-center rounded-md px-2 font-mono text-sm tabular-nums transition disabled:cursor-not-allowed',
                p === page
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-700 hover:bg-slate-100',
              )}
            >
              {p}
            </button>
          ),
        )}
        <button
          type="button"
          aria-label="Page suivante"
          disabled={page >= totalPages || pending}
          onClick={() => go(page + 1)}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </nav>
  );
}
