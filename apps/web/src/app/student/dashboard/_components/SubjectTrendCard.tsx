import { Minus, Sparkles, TrendingUp } from 'lucide-react';
import type { ComponentType } from 'react';

import { SubjectChip, cn, formatGrade } from '@pilotage/ui';
import type { StudentDashboardSubject } from '@pilotage/contracts';

/**
 * SubjectTrendCard — E8-S3 Block A "Mon évolution par matière".
 *
 * One card per subject showing the learner's OWN trend — direction word + icon +
 * own average only. NO class average, NO rank (structurally absent from the DTO).
 * Direction is conveyed by icon + word + colour TOGETHER (never colour alone,
 * WCAG 1.4.1). Copy is kind and forward-looking — a `down` subject reads
 * "à consolider — concentre-toi ici", NEVER "en échec / en baisse / mauvais".
 *
 * Server component: the amber "à consolider" uses amber-700 on amber-50 (≥4.5:1).
 */

type Trend = StudentDashboardSubject['trend'];

const TREND_META: Record<
  Trend,
  {
    label: string;
    Icon: ComponentType<{ className?: string }>;
    chipClass: string;
    iconClass: string;
  }
> = {
  up: {
    label: 'en progrès',
    Icon: TrendingUp,
    chipClass: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    iconClass: 'text-emerald-600',
  },
  flat: {
    label: 'stable',
    Icon: Minus,
    chipClass: 'bg-slate-50 text-slate-600 ring-slate-200',
    iconClass: 'text-slate-500',
  },
  down: {
    label: 'à consolider — concentre-toi ici',
    Icon: Sparkles,
    chipClass: 'bg-amber-50 text-amber-700 ring-amber-200',
    iconClass: 'text-amber-600',
  },
  unknown: {
    label: 'pas encore assez de notes',
    Icon: Minus,
    chipClass: 'bg-slate-50 text-slate-500 ring-slate-200',
    iconClass: 'text-slate-400',
  },
};

export function SubjectTrendCard({ subject }: { subject: StudentDashboardSubject }) {
  const meta = TREND_META[subject.trend];
  const Icon = meta.Icon;

  return (
    <article className="flex items-center gap-3 rounded-2xl bg-white px-4 py-3 shadow-sm ring-1 ring-slate-200/60">
      <span
        aria-hidden
        className="h-9 w-1.5 shrink-0 rounded-full"
        style={{ background: subject.subjectColor ?? 'oklch(0.56 0.19 292)' }}
      />
      <div className="min-w-0 flex-1">
        <SubjectChip
          subjectCode={subject.subjectName}
          label={subject.subjectName}
          size="sm"
        />
        <div
          className={cn(
            'mt-1.5 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1',
            meta.chipClass,
          )}
        >
          <Icon className={cn('h-3.5 w-3.5 shrink-0', meta.iconClass)} aria-hidden />
          {meta.label}
        </div>
      </div>
      {subject.studentAverage != null && (
        <div className="shrink-0 text-right">
          <div className="font-mono text-lg font-bold tabular-nums text-slate-900">
            {formatGrade(subject.studentAverage, 1)}
          </div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            sur 20
          </div>
        </div>
      )}
    </article>
  );
}
