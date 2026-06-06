import {
  CalendarClock,
  Clock,
  HeartHandshake,
  Hourglass,
  PartyPopper,
  Sparkles,
  Target,
  TrendingUp,
} from 'lucide-react';
import Link from 'next/link';

import { Badge, SectionHeader, SubjectChip, cn, formatGrade } from '@pilotage/ui';

/**
 * RemediationProgressStrip — E7-S3 (the measured-improvement payoff).
 *
 * A calm, mobile-first strip rendered near the parent-dashboard hero, one row per
 * OPEN `RemediationPlan`. It reads the additive optional `remediation` block that
 * rides the SAME parent-dashboard aggregate the page already fetches — no extra
 * round-trip, never a loading gate, degrades to NOTHING when absent/empty.
 *
 * The whole point of S3 is the *payoff progression*, framed patiently and kindly:
 *   - `trendDelta == null` (plan too fresh / no new grades) → neutral, patient
 *     « En attente des prochaines notes » (NEVER "no progress").
 *   - `trendDelta > 0 && !improved`                        → calm blue
 *     « +X pts depuis le début du soutien ».
 *   - `improved` (delta ≥ the shared E3 threshold)         → the E3 emerald
 *     IMPROVEMENT lane « Le soutien porte ses fruits — {matière} progresse 🎉 ».
 *   - `trendDelta <= 0`                                    → gentle, patient
 *     « Les premiers effets prennent quelques semaines » (NEVER "échec").
 *
 * The strip shows the MOVEMENT (delta), never the child's raw standing as a
 * verdict, never a class/peer comparison, never another child's name (FR copy
 * guardrails). It composes existing `@pilotage/ui` primitives (`Badge`,
 * `SectionHeader`, `SubjectChip`) + `lucide-react` only — no `packages/ui` change.
 *
 * Server component (no client interactivity): the next session renders as an
 * ABSOLUTE FR label ("prochaine mardi 17 h") so there is no relative-time tick to
 * keep silent. The emerald improvement message carries `role="status"` +
 * `aria-live="polite"` so a threshold crossing is announced once without focus
 * theft; the other states are NOT live regions (no announce-spam on every paint).
 */

const MAX_VISIBLE = 3;

export interface RemediationProgressItem {
  planId: string;
  subjectId: string;
  subjectCode: string | null;
  subjectName: string | null;
  objective: string | null;
  baselineAvg: number | null;
  currentAvg: number | null;
  trendDelta: number | null;
  improved: boolean;
  sessionsPlanned: number;
  sessionsDone: number;
  nextSessionAt: string | null;
  createdAt: string;
}

export interface RemediationProgressStripProps {
  /** The additive `remediation` block from the active child's dashboard payload. */
  plans?: RemediationProgressItem[] | null;
}

/** Absolute FR next-session label — "mardi 17 h" / "mardi 17 h 30". No tick. */
function formatNextSession(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const day = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'short' });
  const minutes = d.getMinutes();
  const hour = minutes === 0 ? `${d.getHours()} h` : `${d.getHours()} h ${String(minutes).padStart(2, '0')}`;
  return `${day} à ${hour}`;
}

type PayoffState = 'awaiting' | 'progress' | 'improved' | 'patient';

function resolvePayoff(item: RemediationProgressItem): PayoffState {
  // Null current/baseline → never a fabricated delta; patient "en attente".
  if (item.trendDelta == null) return 'awaiting';
  if (item.improved) return 'improved';
  if (item.trendDelta > 0) return 'progress';
  return 'patient'; // flat or negative — gentle, never "échec".
}

function PayoffBadge({ item }: { item: RemediationProgressItem }) {
  const state = resolvePayoff(item);
  const subject = item.subjectName ?? item.subjectCode ?? 'cette matière';

  if (state === 'improved') {
    // The E3 emerald IMPROVEMENT lane — reuse the exact contrast-checked tokens.
    return (
      <span
        role="status"
        aria-live="polite"
        className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700"
      >
        <PartyPopper aria-hidden className="h-3.5 w-3.5 shrink-0" />
        <TrendingUp aria-hidden className="h-3.5 w-3.5 shrink-0" />
        Le soutien porte ses fruits — {subject} progresse 🎉
      </span>
    );
  }

  if (state === 'progress') {
    return (
      <Badge
        variant="brand"
        aria-label={`Plus ${formatGrade(item.trendDelta, 1)} points depuis le début du soutien`}
        className="bg-blue-50 text-blue-700"
      >
        <TrendingUp aria-hidden className="h-3.5 w-3.5 shrink-0" />
        +{formatGrade(item.trendDelta, 1)} pts depuis le début du soutien
      </Badge>
    );
  }

  if (state === 'patient') {
    return (
      <Badge variant="neutral" aria-label="Les premiers effets prennent quelques semaines">
        <Clock aria-hidden className="h-3.5 w-3.5 shrink-0" />
        Les premiers effets prennent quelques semaines
      </Badge>
    );
  }

  // awaiting
  return (
    <Badge variant="neutral" aria-label="En attente des prochaines notes">
      <Hourglass aria-hidden className="h-3.5 w-3.5 shrink-0" />
      En attente des prochaines notes
    </Badge>
  );
}

function PlanRow({ item }: { item: RemediationProgressItem }) {
  const subject = item.subjectName ?? item.subjectCode ?? 'Matière';
  const nextLabel = formatNextSession(item.nextSessionAt);
  const improved = resolvePayoff(item) === 'improved';

  return (
    <Link
      href={`/parent/remediation/${item.planId}`}
      aria-label={`Voir le plan de soutien en ${subject}`}
      className={cn(
        'flex min-h-11 flex-col gap-3 rounded-2xl p-4 ring-1 transition sm:flex-row sm:items-center',
        improved
          ? 'bg-emerald-50 ring-emerald-200 hover:bg-emerald-100/50'
          : 'bg-gradient-to-r from-indigo-50/50 via-white to-white ring-slate-200/60 hover:bg-slate-50',
      )}
    >
      {/* Identity — objective + subject */}
      <div className="flex min-w-0 flex-1 items-start gap-2.5">
        <span
          aria-hidden
          className={cn(
            'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
            improved ? 'bg-emerald-100 text-emerald-700' : 'bg-indigo-100 text-indigo-700',
          )}
        >
          <Target className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-semibold text-slate-900">Soutien en cours</span>
            {item.subjectCode ? (
              <SubjectChip subjectCode={item.subjectCode} label={subject} size="xs" />
            ) : (
              <span className="text-sm font-semibold text-slate-900">· {subject}</span>
            )}
          </div>
          {item.objective ? (
            <p className="mt-0.5 truncate text-xs text-slate-600">{item.objective}</p>
          ) : null}
        </div>
      </div>

      {/* Sessions */}
      <div className="flex shrink-0 items-center gap-1.5 text-xs text-slate-600">
        <CalendarClock aria-hidden className="h-3.5 w-3.5 shrink-0 text-slate-400" />
        {item.sessionsPlanned > 0 ? (
          <span>
            {item.sessionsPlanned} séance{item.sessionsPlanned > 1 ? 's' : ''}
            {nextLabel ? ` · prochaine ${nextLabel}` : ''}
          </span>
        ) : (
          <span className="font-medium text-indigo-700">
            Aucune séance planifiée — réserver
          </span>
        )}
      </div>

      {/* Payoff */}
      <div className="flex shrink-0 items-center">
        <PayoffBadge item={item} />
      </div>
    </Link>
  );
}

export function RemediationProgressStrip({ plans }: RemediationProgressStripProps) {
  // Degrade to nothing — no open plan → no strip, no nag, no reserved box.
  if (!plans || plans.length === 0) return null;

  // Most-recent first, capped — a calm "+N autres" note beyond the cap.
  const ordered = [...plans].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  const visible = ordered.slice(0, MAX_VISIBLE);
  const overflow = ordered.length - visible.length;

  return (
    <section className="mt-6" aria-label="Accompagnement en cours">
      <SectionHeader
        title="Accompagnement en cours"
        icon={<HeartHandshake aria-hidden className="h-4 w-4 text-indigo-600" />}
        actionLabel="Voir le plan"
        actionHref={
          visible.length === 1 ? `/parent/remediation/${visible[0]?.planId}` : '/parent/remediation'
        }
        compact
      />
      <div className="mt-3 space-y-2.5">
        {visible.map((item) => (
          <PlanRow key={item.planId} item={item} />
        ))}
      </div>
      {overflow > 0 ? (
        <Link
          href="/parent/remediation"
          className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-700"
        >
          <Sparkles aria-hidden className="h-3 w-3" />+{overflow} autre{overflow > 1 ? 's' : ''}
        </Link>
      ) : null}
    </section>
  );
}
