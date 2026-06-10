import {
  CalendarClock,
  Clock,
  HeartHandshake,
  Hourglass,
  PartyPopper,
  Target,
  TrendingUp,
} from 'lucide-react';

import { Badge, SectionHeader, SubjectChip, cn, formatGrade } from '@pilotage/ui';
import type { RemediationProgressDto } from '@pilotage/contracts';

/**
 * StudentSupportStrip — E8-S3 "Ton soutien" (the E7 remediation progress, in the
 * SECOND person).
 *
 * A student-scoped sibling of the parent `RemediationProgressStrip` — it never
 * imports the parent strip (whose deep-links go to /parent/* and whose copy is
 * third-person "Soutien en cours"). It reads the SAME `RemediationProgressDto`
 * (already peer-free) from the dashboard aggregate, re-worded for the learner:
 * "Ton soutien en maths : 2 séances faites, prochaine mardi".
 *
 * The four payoff states mirror the parent strip verbatim, re-framed kindly:
 *   - awaiting  → "En attente de tes prochaines notes" (never "no progress")
 *   - progress  → "+X pts depuis le début de ton soutien"
 *   - improved  → the E3 emerald lane: "Ton soutien en {matière} porte ses fruits 🎉"
 *   - patient   → "Les premiers effets prennent quelques semaines" (never "échec")
 *
 * Read-only: the rows are display-only (the learner never books) — no deep-link,
 * no CTA. Server component: the next-session label is ABSOLUTE FR (no tick). Only
 * the emerald improvement message carries `role="status"`/`aria-live="polite"` so
 * a threshold crossing is announced once; the other states are not live regions.
 */

export interface StudentSupportStripProps {
  plans?: RemediationProgressDto[] | null;
}

const MAX_VISIBLE = 3;

/** Absolute FR next-session label — "mardi 17 h" / "mardi 17 h 30". No tick. */
function formatNextSession(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const day = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'short' });
  const minutes = d.getMinutes();
  const hour =
    minutes === 0 ? `${d.getHours()} h` : `${d.getHours()} h ${String(minutes).padStart(2, '0')}`;
  return `${day} à ${hour}`;
}

type PayoffState = 'awaiting' | 'progress' | 'improved' | 'patient';

function resolvePayoff(item: RemediationProgressDto): PayoffState {
  if (item.trendDelta == null) return 'awaiting';
  if (item.improved) return 'improved';
  if (item.trendDelta > 0) return 'progress';
  return 'patient';
}

function PayoffBadge({ item }: { item: RemediationProgressDto }) {
  const state = resolvePayoff(item);
  const subject = item.subjectName ?? item.subjectCode ?? 'cette matière';

  if (state === 'improved') {
    return (
      <span
        role="status"
        aria-live="polite"
        className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700"
      >
        <PartyPopper aria-hidden className="h-3.5 w-3.5 shrink-0" />
        <TrendingUp aria-hidden className="h-3.5 w-3.5 shrink-0" />
        Ton soutien en {subject} porte ses fruits 🎉
      </span>
    );
  }

  if (state === 'progress') {
    return (
      <Badge
        variant="brand"
        aria-label={`Plus ${formatGrade(item.trendDelta, 1)} points depuis le début de ton soutien`}
        className="bg-violet-50 text-violet-700"
      >
        <TrendingUp aria-hidden className="h-3.5 w-3.5 shrink-0" />+
        {formatGrade(item.trendDelta, 1)} pts depuis le début de ton soutien
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

  return (
    <Badge variant="neutral" aria-label="En attente de tes prochaines notes">
      <Hourglass aria-hidden className="h-3.5 w-3.5 shrink-0" />
      En attente de tes prochaines notes
    </Badge>
  );
}

function PlanRow({ item }: { item: RemediationProgressDto }) {
  const subject = item.subjectName ?? item.subjectCode ?? 'Matière';
  const nextLabel = formatNextSession(item.nextSessionAt);
  const improved = resolvePayoff(item) === 'improved';

  return (
    <div
      className={cn(
        'flex min-h-11 flex-col gap-3 rounded-2xl p-4 ring-1 sm:flex-row sm:items-center',
        improved
          ? 'bg-emerald-50 ring-emerald-200'
          : 'bg-gradient-to-r from-violet-50/50 via-white to-white ring-slate-200/60',
      )}
    >
      <div className="flex min-w-0 flex-1 items-start gap-2.5">
        <span
          aria-hidden
          className={cn(
            'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
            improved ? 'bg-emerald-100 text-emerald-700' : 'bg-violet-100 text-violet-700',
          )}
        >
          <Target className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-semibold text-slate-900">Ton soutien</span>
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

      <div className="flex shrink-0 items-center gap-1.5 text-xs text-slate-600">
        <CalendarClock aria-hidden className="h-3.5 w-3.5 shrink-0 text-slate-400" />
        {item.sessionsPlanned > 0 ? (
          <span>
            {item.sessionsDone}/{item.sessionsPlanned} séance{item.sessionsPlanned > 1 ? 's' : ''}
            {nextLabel ? ` · prochaine ${nextLabel}` : ''}
          </span>
        ) : (
          <span>Séances à planifier avec ton établissement</span>
        )}
      </div>

      <div className="flex shrink-0 items-center">
        <PayoffBadge item={item} />
      </div>
    </div>
  );
}

export function StudentSupportStrip({ plans }: StudentSupportStripProps) {
  // Degrade to nothing — no open plan → no strip, no nag.
  if (!plans || plans.length === 0) return null;

  const ordered = [...plans].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  const visible = ordered.slice(0, MAX_VISIBLE);
  const overflow = ordered.length - visible.length;

  return (
    <section aria-label="Ton soutien">
      <SectionHeader
        title="Ton soutien"
        icon={<HeartHandshake aria-hidden className="h-4 w-4 text-violet-600" />}
        compact
      />
      <div className="mt-3 space-y-2.5">
        {visible.map((item) => (
          <PlanRow key={item.planId} item={item} />
        ))}
      </div>
      {overflow > 0 ? (
        <p className="mt-2 text-xs font-medium text-slate-500">
          +{overflow} autre{overflow > 1 ? 's' : ''} accompagnement{overflow > 1 ? 's' : ''}
        </p>
      ) : null}
    </section>
  );
}
