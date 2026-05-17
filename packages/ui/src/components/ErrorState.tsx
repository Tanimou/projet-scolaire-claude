import { AlertOctagon, RotateCw } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '../lib/cn';

export interface ErrorStateProps {
  title?: string;
  description?: ReactNode;
  /** Optional retry button */
  onRetry?: () => void;
  retryLabel?: string;
  /** Optional secondary action */
  secondaryAction?: { label: string; href?: string; onClick?: () => void };
  className?: string;
}

/**
 * ErrorState — visible error block.
 * Used inside Card sections when an API call fails.
 */
export function ErrorState({
  title = "Une erreur s'est produite",
  description = 'Réessayez dans quelques instants ou contactez le support si le problème persiste.',
  onRetry,
  retryLabel = 'Réessayer',
  secondaryAction,
  className,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center gap-3 rounded-2xl bg-white p-10 text-center ring-1 ring-rose-200/60',
        className,
      )}
    >
      <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-50 text-rose-600">
        <AlertOctagon className="h-6 w-6" />
      </span>
      <h3 className="text-base font-bold text-slate-900">{title}</h3>
      <p className="max-w-md text-sm text-slate-500">{description}</p>
      <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-rose-600 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-rose-700"
          >
            <RotateCw className="h-4 w-4" />
            {retryLabel}
          </button>
        )}
        {secondaryAction &&
          (secondaryAction.href ? (
            <a
              href={secondaryAction.href}
              className="inline-flex items-center justify-center rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              {secondaryAction.label}
            </a>
          ) : (
            <button
              type="button"
              onClick={secondaryAction.onClick}
              className="inline-flex items-center justify-center rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              {secondaryAction.label}
            </button>
          ))}
      </div>
    </div>
  );
}
