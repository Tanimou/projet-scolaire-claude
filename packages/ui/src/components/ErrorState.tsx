import { AlertOctagon, RotateCw } from 'lucide-react';
import type { ComponentType, ReactNode } from 'react';

import { cn } from '../lib/cn';

export interface ErrorStateProps {
  /**
   * Lucide icon component rendered in the tonal square. Defaults to `AlertOctagon`.
   * Pass `ShieldAlert` for an access-denied failure, where "retry" is useless and
   * the remedy is a person, not a reload.
   */
  icon?: ComponentType<{ className?: string }>;
  title?: string;
  description?: ReactNode;
  /** Optional retry button. Client components only — a server page uses `children` instead. */
  onRetry?: () => void;
  retryLabel?: string;
  /** Optional secondary action */
  secondaryAction?: { label: string; href?: string; onClick?: () => void };
  /**
   * Optional extra content, rendered BELOW the action row — mirrors `EmptyState`'s
   * `children` slot. This is how a **server** component injects a client-side control
   * (e.g. a `'use client'` retry button calling `router.refresh()`): `onRetry` is a
   * function prop and cannot cross the server/client boundary, a rendered element can.
   */
  children?: ReactNode;
  className?: string;
}

/**
 * ErrorState — visible error block.
 *
 * Used inside Card sections when a read fails. Its `role="alert"` is the semantic
 * counterpart of `EmptyState`'s `role="status"`, and the distinction is load-bearing:
 * **a failed read is never a domain fact.** A page that renders a 403/500 through
 * `EmptyState` tells the reader "the school published nothing", which is a claim the
 * page has no evidence for. Reach for `EmptyState` only behind a successful response
 * with an empty collection; reach for this component for every failure.
 *
 * Accessibility notes (verified, do not re-derive):
 * - `text-slate-500` on white = 4.76:1, white on `bg-rose-600` = 4.83:1 — both AA.
 * - Meaning is carried by the icon AND the heading text, never by the rose ring alone
 *   (WCAG 1.4.1) — a monochrome screenshot must still read as an error.
 * - The icon is decorative (it duplicates the heading) and is `aria-hidden`.
 * - Controls clear the 44 px house target (WCAG 2.2 · 2.5.8 floor is 24 px).
 * - The focus ring and `prefers-reduced-motion` are handled globally in `globals.css`
 *   — never add `outline-none` here.
 * - Deliberately NO `animate-float`: an error that bobs reads as flippant.
 */
export function ErrorState({
  icon: Icon = AlertOctagon,
  title = "Une erreur s'est produite",
  description = 'Réessayez dans quelques instants ou contactez le support si le problème persiste.',
  onRetry,
  retryLabel = 'Réessayer',
  secondaryAction,
  children,
  className,
}: ErrorStateProps) {
  const hasActionRow = Boolean(onRetry || secondaryAction);

  return (
    <div
      role="alert"
      className={cn(
        'animate-fade-in flex flex-col items-center gap-3 rounded-2xl bg-white p-6 text-center ring-1 ring-rose-200/60 sm:p-10',
        className,
      )}
    >
      <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-50 text-rose-600">
        <Icon className="h-6 w-6" aria-hidden />
      </span>
      <h3 className="text-base font-bold text-balance text-slate-900">{title}</h3>
      <p className="max-w-md text-sm text-slate-500">{description}</p>
      {hasActionRow && (
        <div className="mt-2 flex w-full flex-col items-center justify-center gap-2 sm:w-auto sm:flex-row sm:flex-wrap">
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-lg bg-rose-600 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-rose-700 sm:w-auto"
            >
              <RotateCw className="h-4 w-4" aria-hidden />
              {retryLabel}
            </button>
          )}
          {secondaryAction &&
            (secondaryAction.href ? (
              <a
                href={secondaryAction.href}
                className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 sm:w-auto"
              >
                {secondaryAction.label}
              </a>
            ) : (
              <button
                type="button"
                onClick={secondaryAction.onClick}
                className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 sm:w-auto"
              >
                {secondaryAction.label}
              </button>
            ))}
        </div>
      )}
      {children}
    </div>
  );
}
