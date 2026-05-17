import { ArrowRight } from 'lucide-react';
import type { ComponentType } from 'react';

import { cn } from '../lib/cn';
import { subjectColor } from '../lib/subject-color';

export interface SubjectKpiCardProps {
  /** Canonical subject code or free-form name (e.g. 'MATH', 'Mathématiques') */
  subjectCode: string;
  /** Display label (defaults to the resolved subject's canonical name) */
  label: string;
  /** Optional icon, drawn in a translucent circle */
  icon?: ComponentType<{ className?: string }>;
  /** Primary count line (e.g. classes) */
  classCount?: number;
  /** Secondary count line (e.g. students) */
  studentCount?: number;
  /** Optional href + label for the drilldown link */
  href?: string;
  hrefLabel?: string;
  className?: string;
}

/**
 * SubjectKpiCard — image 6 prescriptive.
 * Gradient subject-coloured KPI card used in Teacher dashboard.
 */
export function SubjectKpiCard({
  subjectCode,
  label,
  icon: Icon,
  classCount,
  studentCount,
  href,
  hrefLabel = 'Voir les classes →',
  className,
}: SubjectKpiCardProps) {
  const color = subjectColor(subjectCode);
  const stats: string[] = [];
  if (classCount !== undefined) stats.push(`${classCount} classe${classCount > 1 ? 's' : ''}`);
  if (studentCount !== undefined) stats.push(`${studentCount} élève${studentCount > 1 ? 's' : ''}`);

  const inner = (
    <>
      <div className="flex items-start gap-3">
        {Icon && (
          <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/20 backdrop-blur">
            <Icon className="h-5 w-5 text-white" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-bold text-white">{label}</h3>
          {stats.length > 0 && (
            <p className="mt-1 text-xs text-white/85">{stats.join(' · ')}</p>
          )}
        </div>
      </div>
      {href && (
        <span className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-white/95 transition-transform group-hover:translate-x-0.5">
          {hrefLabel.replace(' →', '')}
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </span>
      )}
    </>
  );

  const baseClass = cn(
    'group relative flex flex-col rounded-2xl bg-gradient-to-br p-5 text-white shadow-md transition-transform hover:-translate-y-0.5',
    color.gradient,
    className,
  );

  if (href) {
    return (
      <a href={href} className={baseClass} data-subject={color.code}>
        {inner}
      </a>
    );
  }
  return (
    <article className={baseClass} data-subject={color.code}>
      {inner}
    </article>
  );
}
