import { ChevronRight, Lightbulb } from 'lucide-react';
import type { ComponentType } from 'react';

import { cn } from '../lib/cn';

export interface RecommendationCardProps {
  /** Custom icon (default: Lightbulb) */
  icon?: ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  href?: string;
  category?: string;
  className?: string;
}

/**
 * RecommendationCard — image 3 recommandations.
 * Compact card with icon + title + sub + chevron CTA.
 */
export function RecommendationCard({
  icon: Icon = Lightbulb,
  title,
  description,
  href,
  category,
  className,
}: RecommendationCardProps) {
  const inner = (
    <>
      <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sky-100 text-sky-700">
        <Icon className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        {category && (
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{category}</p>
        )}
        <h4 className="truncate text-sm font-bold text-slate-900">{title}</h4>
        {description && <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{description}</p>}
      </div>
      {href && <ChevronRight className="h-5 w-5 shrink-0 text-slate-400" aria-hidden />}
    </>
  );

  const baseClass = cn(
    'density-card-mini flex items-center gap-3 rounded-xl bg-white ring-1 ring-slate-200/60 transition hover:ring-slate-300',
    className,
  );

  if (href) {
    return (
      <a href={href} className={baseClass}>
        {inner}
      </a>
    );
  }
  return <article className={baseClass}>{inner}</article>;
}
