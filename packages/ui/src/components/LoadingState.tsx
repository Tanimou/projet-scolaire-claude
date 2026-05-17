import { cn } from '../lib/cn';

export interface SkeletonProps {
  className?: string;
}

/** Skeleton block — animated shimmer for placeholder layout. */
export function Skeleton({ className }: SkeletonProps) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-block animate-pulse rounded-md bg-slate-200/80',
        className,
      )}
    />
  );
}

export interface LoadingCardProps {
  /** Approximate height to match the final content height (avoids layout shift). */
  height?: number;
  className?: string;
}

/** LoadingCard — full-card skeleton with title + body skeletons. */
export function LoadingCard({ height = 160, className }: LoadingCardProps) {
  return (
    <div
      role="status"
      aria-label="Chargement en cours"
      style={{ minHeight: height }}
      className={cn('flex flex-col gap-3 rounded-2xl bg-white p-5 ring-1 ring-slate-200/60', className)}
    >
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-32 w-full" />
    </div>
  );
}

/** LoadingTable — table skeleton with N rows. */
export function LoadingTable({ rows = 5, className }: { rows?: number; className?: string }) {
  return (
    <div
      role="status"
      aria-label="Chargement en cours"
      className={cn('flex flex-col gap-2 rounded-2xl bg-white p-5 ring-1 ring-slate-200/60', className)}
    >
      <Skeleton className="h-4 w-1/4" />
      <div className="mt-2 flex flex-col gap-2">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="grid grid-cols-12 gap-3">
            <Skeleton className="col-span-1 h-8" />
            <Skeleton className="col-span-3 h-8" />
            <Skeleton className="col-span-2 h-8" />
            <Skeleton className="col-span-3 h-8" />
            <Skeleton className="col-span-3 h-8" />
          </div>
        ))}
      </div>
    </div>
  );
}
