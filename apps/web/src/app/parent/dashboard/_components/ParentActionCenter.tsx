import {
  ArrowRight,
  BellRing,
  CalendarClock,
  Compass,
  GraduationCap,
  type LucideIcon,
  UserCheck,
} from 'lucide-react';
import Link from 'next/link';

export interface ParentActionItem {
  key: 'active-alerts' | 'upcoming-soon' | 'new-grades' | 'attendance-watch';
  label: string;
  count: number;
  severity: 'critical' | 'warning' | 'info';
  href: string;
  actionLabel: string;
  detail: string | null;
  preview?: Array<{ id: string; title: string; meta?: string | null }>;
}

/** Minimal per-child slice the builder needs — derived from the page's familyData. */
export interface ParentActionChild {
  studentId: string;
  firstName: string;
  alerts: Array<{
    id: string;
    severity: 'low' | 'medium' | 'high';
    status: 'open' | 'acknowledged' | 'resolved' | 'dismissed';
    title: string;
    subjectName: string | null;
  }>;
  upcoming: Array<{ id: string; title: string; date: string; subjectName: string }>;
  recentGrades: Array<{
    id: string;
    title: string;
    date: string;
    subjectName: string;
    value: number | null;
    max: number;
  }>;
  attendanceRate: number | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

const ICON_BY_KEY: Record<ParentActionItem['key'], LucideIcon> = {
  'active-alerts': BellRing,
  'upcoming-soon': CalendarClock,
  'new-grades': GraduationCap,
  'attendance-watch': UserCheck,
};

const SEVERITY_RANK: Record<ParentActionItem['severity'], number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

const SEVERITY_STYLES: Record<
  ParentActionItem['severity'],
  { card: string; iconBg: string; iconFg: string; count: string; cta: string; chip: string }
> = {
  critical: {
    card: 'border-rose-200 bg-rose-50/60 hover:border-rose-300 hover:bg-rose-50',
    iconBg: 'bg-rose-100',
    iconFg: 'text-rose-700',
    count: 'text-rose-900',
    cta: 'text-rose-700 hover:text-rose-900',
    chip: 'bg-rose-600/95 text-white',
  },
  warning: {
    card: 'border-amber-200 bg-amber-50/60 hover:border-amber-300 hover:bg-amber-50',
    iconBg: 'bg-amber-100',
    iconFg: 'text-amber-700',
    count: 'text-amber-900',
    cta: 'text-amber-700 hover:text-amber-900',
    chip: 'bg-amber-500 text-white',
  },
  info: {
    card: 'border-sky-200 bg-sky-50/60 hover:border-sky-300 hover:bg-sky-50',
    iconBg: 'bg-sky-100',
    iconFg: 'text-sky-700',
    count: 'text-sky-900',
    cta: 'text-sky-700 hover:text-sky-900',
    chip: 'bg-sky-600 text-white',
  },
};

function inDays(target: Date, now: Date): number {
  return Math.max(0, Math.floor((target.getTime() - now.getTime()) / DAY_MS));
}

/**
 * Builds the parent family action feed entirely from data the dashboard page
 * already fetched (no extra round-trips). Aggregates across every attached
 * child so the parent can triage the whole family in one panel. When a single
 * child is attached, deep-links carry `?studentId=` and the per-row child name
 * is dropped (it would be redundant).
 */
export function buildParentActionItems(
  children: ParentActionChild[],
  now: Date = new Date(),
): ParentActionItem[] {
  const items: ParentActionItem[] = [];
  const multi = children.length > 1;
  const childQuery = (id: string) => (multi ? '' : `?studentId=${id}`);
  // When several children share the alert/grade lists we still want a single
  // deep-link; point at the first flagged child for single-target pages.
  const childTag = (firstName: string) => (multi ? firstName : null);

  const sevWeight: Record<'low' | 'medium' | 'high', number> = { high: 0, medium: 1, low: 2 };
  const sevenDaysAgo = new Date(now.getTime() - 7 * DAY_MS);
  const sevenDaysAhead = new Date(now.getTime() + 7 * DAY_MS);

  // ── 1. Active alerts (open / acknowledged) across all children ──────────
  const activeAlerts = children.flatMap((c) =>
    c.alerts
      .filter((a) => a.status === 'open' || a.status === 'acknowledged')
      .map((a) => ({ ...a, child: c })),
  );
  if (activeAlerts.length > 0) {
    const highCount = activeAlerts.filter((a) => a.severity === 'high').length;
    const sorted = [...activeAlerts].sort(
      (x, y) => sevWeight[x.severity] - sevWeight[y.severity],
    );
    const target = sorted[0]!.child;
    items.push({
      key: 'active-alerts',
      label: 'Alertes de suivi actives',
      count: activeAlerts.length,
      severity: highCount > 0 ? 'critical' : 'warning',
      href: `/parent/recommendations${childQuery(target.studentId)}`,
      actionLabel: 'Consulter',
      detail:
        highCount > 0
          ? `${highCount} prioritaire${highCount > 1 ? 's' : ''} à traiter`
          : `${activeAlerts.length} point${activeAlerts.length > 1 ? 's' : ''} à suivre`,
      preview: sorted.slice(0, 3).map((a) => ({
        id: a.id,
        title: a.title,
        meta:
          [childTag(a.child.firstName), a.subjectName].filter(Boolean).join(' · ') || null,
      })),
    });
  }

  // ── 2. Evaluations scheduled within the next 7 days ─────────────────────
  const upcomingSoon = children
    .flatMap((c) =>
      c.upcoming
        .map((u) => ({ ...u, child: c, when: new Date(u.date) }))
        .filter((u) => !Number.isNaN(u.when.getTime()) && u.when >= now && u.when <= sevenDaysAhead),
    )
    .sort((x, y) => x.when.getTime() - y.when.getTime());
  if (upcomingSoon.length > 0) {
    const nearest = inDays(upcomingSoon[0]!.when, now);
    const target = upcomingSoon[0]!.child;
    items.push({
      key: 'upcoming-soon',
      label: 'Évaluations cette semaine',
      count: upcomingSoon.length,
      severity: nearest <= 2 ? 'warning' : 'info',
      href: `/parent/upcoming${childQuery(target.studentId)}`,
      actionLabel: 'Préparer',
      detail: nearest === 0 ? "La plus proche est aujourd'hui" : `La plus proche dans ${nearest}j`,
      preview: upcomingSoon.slice(0, 3).map((u) => ({
        id: u.id,
        title: u.title,
        meta:
          [childTag(u.child.firstName), u.subjectName, `dans ${inDays(u.when, now)}j`]
            .filter(Boolean)
            .join(' · ') || null,
      })),
    });
  }

  // ── 3. Grades published in the last 7 days ──────────────────────────────
  const newGrades = children
    .flatMap((c) =>
      c.recentGrades
        .map((g) => ({ ...g, child: c, when: new Date(g.date) }))
        .filter((g) => !Number.isNaN(g.when.getTime()) && g.when >= sevenDaysAgo && g.when <= now),
    )
    .sort((x, y) => y.when.getTime() - x.when.getTime());
  if (newGrades.length > 0) {
    const belowAvg = newGrades.filter((g) => g.value != null && g.value < g.max / 2).length;
    const target = newGrades[0]!.child;
    items.push({
      key: 'new-grades',
      label: 'Nouvelles notes publiées',
      count: newGrades.length,
      severity: belowAvg > 0 ? 'warning' : 'info',
      href: `/parent/grades${childQuery(target.studentId)}`,
      actionLabel: 'Consulter',
      detail:
        belowAvg > 0
          ? `${belowAvg} sous la moyenne · 7 derniers jours`
          : `Sur les 7 derniers jours`,
      preview: newGrades.slice(0, 3).map((g) => ({
        id: g.id,
        title: g.title,
        meta:
          [
            childTag(g.child.firstName),
            g.subjectName,
            g.value != null ? `${formatNum(g.value)}/${g.max}` : null,
          ]
            .filter(Boolean)
            .join(' · ') || null,
      })),
    });
  }

  // ── 4. Attendance watch — children below 90% presence ───────────────────
  const flagged = children
    .filter((c) => c.attendanceRate != null && c.attendanceRate < 90)
    .map((c) => ({ child: c, rate: c.attendanceRate as number }))
    .sort((x, y) => x.rate - y.rate);
  if (flagged.length > 0) {
    const worst = flagged[0]!;
    const anyCritical = flagged.some((f) => f.rate < 80);
    items.push({
      key: 'attendance-watch',
      label: 'Assiduité à surveiller',
      count: flagged.length,
      severity: anyCritical ? 'critical' : 'warning',
      href: `/parent/attendance${childQuery(worst.child.studentId)}`,
      actionLabel: 'Vérifier',
      detail: multi
        ? `${flagged.length} enfant${flagged.length > 1 ? 's' : ''} sous 90 %`
        : `${formatNum(worst.rate)} % de présence`,
      preview: flagged.slice(0, 3).map((f) => ({
        id: f.child.studentId,
        title: multi ? f.child.firstName : 'Taux de présence',
        meta: `${formatNum(f.rate)} %`,
      })),
    });
  }

  return items.sort((a, b) => {
    if (SEVERITY_RANK[a.severity] !== SEVERITY_RANK[b.severity]) {
      return SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    }
    return b.count - a.count;
  });
}

function formatNum(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace('.', ',');
}

/**
 * Family action center — top-of-dashboard triage panel for parents. Renders the
 * cross-child feed produced by {@link buildParentActionItems}. The page should
 * only mount this when `items.length > 0` so it never competes with the
 * "everything is fine" messaging in the alerts card below.
 */
export function ParentActionCenter({ items }: { items: ParentActionItem[] }) {
  if (items.length === 0) return null;
  const totalActionable = items.reduce((sum, it) => sum + it.count, 0);

  return (
    <section className="mb-6 rounded-2xl bg-gradient-to-br from-white to-blue-50/40 p-5 shadow-sm ring-1 ring-slate-200/60">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-indigo-500 text-white shadow-sm ring-1 ring-white/40">
            <Compass className="h-5 w-5" />
          </span>
          <div>
            <h2 className="flex items-center gap-2 text-base font-bold text-slate-900">
              Centre de suivi
              <span className="inline-flex items-center rounded-full bg-slate-900 px-2 py-0.5 text-[11px] font-bold text-white">
                {totalActionable.toLocaleString('fr-FR')}
              </span>
            </h2>
            <p className="mt-0.5 text-[12px] text-slate-500">
              Ce qui demande votre attention pour le suivi de votre famille.
            </p>
          </div>
        </div>
      </header>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {items.map((item) => (
          <ActionCard key={item.key} item={item} />
        ))}
      </div>
    </section>
  );
}

function ActionCard({ item }: { item: ParentActionItem }) {
  const Icon = ICON_BY_KEY[item.key];
  const s = SEVERITY_STYLES[item.severity];
  return (
    <Link
      href={item.href}
      className={[
        'group relative flex h-full flex-col gap-3 rounded-xl border p-4 transition-all',
        'hover:-translate-y-0.5 hover:shadow-md',
        s.card,
      ].join(' ')}
    >
      <div className="flex items-start justify-between gap-3">
        <span
          className={[
            'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl shadow-inner',
            s.iconBg,
            s.iconFg,
          ].join(' ')}
        >
          <Icon className="h-4.5 w-4.5" />
        </span>
        <span
          className={[
            'inline-flex h-7 min-w-7 items-center justify-center rounded-full px-2 text-[12px] font-bold tabular-nums shadow-sm',
            s.chip,
          ].join(' ')}
        >
          {item.count.toLocaleString('fr-FR')}
        </span>
      </div>

      <div className="min-w-0 flex-1">
        <h3 className={['text-sm font-bold leading-snug', s.count].join(' ')}>{item.label}</h3>
        {item.detail && (
          <p className="mt-1 text-[12px] leading-relaxed text-slate-600">{item.detail}</p>
        )}

        {item.preview && item.preview.length > 0 && (
          <ul className="mt-3 space-y-1.5">
            {item.preview.map((p) => (
              <li
                key={p.id}
                className="flex items-baseline justify-between gap-2 text-[12px] leading-tight"
              >
                <span className="truncate font-semibold text-slate-800" title={p.title}>
                  {p.title}
                </span>
                {p.meta && (
                  <span className="shrink-0 text-[11px] text-slate-500" title={p.meta}>
                    {p.meta}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div
        className={[
          'mt-auto inline-flex items-center gap-1 text-[12px] font-bold transition-transform',
          s.cta,
          'group-hover:translate-x-0.5',
        ].join(' ')}
      >
        {item.actionLabel}
        <ArrowRight className="h-3.5 w-3.5" />
      </div>
    </Link>
  );
}
