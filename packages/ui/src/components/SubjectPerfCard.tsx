import { MoreVertical } from 'lucide-react';
import type { ComponentType } from 'react';

import { cn } from '../lib/cn';
import { deltaTone, formatGrade } from '../lib/format';
import { gradeVerdict } from '../lib/grade-bucket';
import { subjectColor } from '../lib/subject-color';
import { ProgressBar } from './ProgressBar';

export interface SubjectMetric {
  label: string;
  value: string | number;
  /** Force a delta-style tone (positive/negative/neutral) */
  trend?: 'up' | 'down' | 'neutral';
}

export interface SubjectPerfCardProps {
  subjectCode: string;
  subjectName: string;
  /** Average grade (e.g. 18.2) */
  grade: number | null;
  /** Maximum (default 20) */
  max?: number;
  /** Optional verdict badge label override (defaults to bucket) */
  badge?: string;
  /** 4 metric rows displayed below progress */
  metrics: SubjectMetric[];
  /** Optional kebab menu handler */
  onMenuClick?: () => void;
  /** Optional click handler / link */
  href?: string;
  className?: string;
}

const BADGE_TONE: Record<string, string> = {
  Excellent: 'bg-emerald-100 text-emerald-700',
  'Très bien': 'bg-emerald-100 text-emerald-700',
  Bien: 'bg-blue-100 text-blue-700',
  'Assez bien': 'bg-sky-100 text-sky-700',
  Passable: 'bg-amber-100 text-amber-700',
  'À améliorer': 'bg-amber-100 text-amber-700',
  Satisfaisant: 'bg-amber-100 text-amber-700',
  Insuffisant: 'bg-rose-100 text-rose-700',
};

/**
 * SubjectPerfCard — image 7 "Performance par matière".
 * Per-subject card with grade, badge, progress bar, and 4 metric rows.
 */
export function SubjectPerfCard({
  subjectCode,
  subjectName,
  grade,
  max = 20,
  badge,
  metrics,
  onMenuClick,
  href,
  className,
}: SubjectPerfCardProps) {
  const color = subjectColor(subjectCode);
  const finalBadge = badge ?? gradeVerdict(grade);
  const badgeTone = BADGE_TONE[finalBadge] ?? 'bg-slate-100 text-slate-700';
  const pct = grade != null ? (grade / max) * 100 : 0;

  const Wrapper: ComponentType<{ className?: string; children: React.ReactNode; href?: string }> = ({
    className: c,
    children,
    href: h,
  }) => (h ? <a href={h} className={c}>{children}</a> : <article className={c}>{children}</article>);

  return (
    <Wrapper
      href={href}
      className={cn(
        'flex flex-col gap-3 rounded-2xl bg-white p-5 ring-1 ring-slate-200/60',
        href && 'transition hover:-translate-y-0.5 hover:ring-slate-300',
        className,
      )}
    >
      {/* Header: icon + name + kebab */}
      <header className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden
            className="h-8 w-8 shrink-0 rounded-lg"
            style={{ background: color.tonal }}
          >
            <span
              className="block h-full w-full rounded-lg"
              style={{ background: color.primary, opacity: 0.25 }}
            />
          </span>
          <h3 className="truncate text-sm font-bold text-slate-900">{subjectName}</h3>
        </div>
        {onMenuClick && (
          <button
            type="button"
            onClick={onMenuClick}
            aria-label="Plus d'options"
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <MoreVertical className="h-4 w-4" />
          </button>
        )}
      </header>

      {/* Big grade + badge */}
      <div className="flex items-baseline gap-2">
        <div className="font-mono text-3xl font-bold tabular-nums text-slate-900">
          {formatGrade(grade, 1)}
        </div>
        <div className="text-sm text-slate-400">/ {max}</div>
        <span className={cn('ml-auto rounded-full px-2 py-0.5 text-[11px] font-bold', badgeTone)}>
          {finalBadge}
        </span>
      </div>

      <ProgressBar
        value={pct}
        height={6}
        color={color.primary}
        ariaLabel={`Progression ${subjectName}`}
      />

      <dl className="flex flex-col divide-y divide-slate-100">
        {metrics.map((m, i) => (
          <div key={i} className="flex items-center justify-between py-1.5">
            <dt className="text-[11px] text-slate-500">{m.label}</dt>
            <dd
              className={cn(
                'text-xs font-bold tabular-nums text-slate-900',
                m.trend === 'up' && 'text-emerald-700',
                m.trend === 'down' && 'text-rose-700',
              )}
            >
              {m.trend === 'up' && '↑ '}
              {m.trend === 'down' && '↓ '}
              {m.value}
            </dd>
          </div>
        ))}
      </dl>
    </Wrapper>
  );
}

/** Helper: derive trend hint from a delta number. */
export function trendOfDelta(value: number | null | undefined): SubjectMetric['trend'] {
  return deltaTone(value) === 'positive' ? 'up' : deltaTone(value) === 'negative' ? 'down' : 'neutral';
}
