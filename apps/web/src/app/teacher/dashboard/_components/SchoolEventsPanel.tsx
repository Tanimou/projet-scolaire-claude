import {
  CalendarDays,
  Flag,
  Sun,
  GraduationCap,
  Users,
  Award,
  MapPin,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { SectionHeader } from "@pilotage/ui";

export type SchoolEvent = {
  id: string;
  title: string;
  type: string;
  startsAt: string;
  endsAt: string | null;
  allDay?: boolean;
  location?: string | null;
  scopeType?: string | null;
};

type SchoolEventsPanelProps = {
  events: SchoolEvent[];
};

const TYPE_LABEL: Record<string, string> = {
  holiday: "Jour férié",
  break: "Vacances",
  exam: "Examen",
  meeting: "Réunion",
  ceremony: "Cérémonie",
  other: "Événement",
};

const TYPE_ICON: Record<string, LucideIcon> = {
  holiday: Flag,
  break: Sun,
  exam: GraduationCap,
  meeting: Users,
  ceremony: Award,
  other: CalendarDays,
};

// icon box background + text tone per event type
const TYPE_TONE: Record<string, string> = {
  holiday: "bg-amber-50 text-amber-600",
  break: "bg-sky-50 text-sky-600",
  exam: "bg-rose-50 text-rose-600",
  meeting: "bg-violet-50 text-violet-600",
  ceremony: "bg-emerald-50 text-emerald-600",
  other: "bg-slate-100 text-slate-600",
};

// type chip tone per event type
const CHIP_TONE: Record<string, string> = {
  holiday: "bg-amber-100 text-amber-700",
  break: "bg-sky-100 text-sky-700",
  exam: "bg-rose-100 text-rose-700",
  meeting: "bg-violet-100 text-violet-700",
  ceremony: "bg-emerald-100 text-emerald-700",
  other: "bg-slate-100 text-slate-600",
};

const SCOPE_LABEL: Record<string, string> = {
  school: "École",
  cycle: "Cycle",
  grade_level: "Niveau",
  class_section: "Classe",
};

const DAY_FMT = new Intl.DateTimeFormat("fr-FR", { day: "2-digit" });
const MONTH_FMT = new Intl.DateTimeFormat("fr-FR", { month: "short" });

function daysUntil(date: Date, now: Date): number {
  const startOfDay = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.round((startOfDay(date) - startOfDay(now)) / 86_400_000);
}

function relativeLabel(days: number): string {
  if (days <= 0) return "Aujourd'hui";
  if (days === 1) return "Demain";
  if (days < 7) return `Dans ${days} j`;
  if (days < 14) return "La semaine prochaine";
  return `Dans ${Math.round(days / 7)} sem.`;
}

export function SchoolEventsPanel({ events }: SchoolEventsPanelProps) {
  const now = new Date();

  // Keep events that are upcoming or still ongoing (multi-day vacances/exams),
  // soonest first, capped to keep the panel tidy.
  const upcoming = events
    .filter((e) => {
      const ref = e.endsAt ? new Date(e.endsAt) : new Date(e.startsAt);
      return ref.getTime() >= now.getTime();
    })
    .sort(
      (a, b) =>
        new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
    )
    .slice(0, 6);

  // Nothing to show → render nothing (avoids an empty card competing for space).
  if (upcoming.length === 0) return null;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <SectionHeader
        title="Vie de l'école"
        subtitle="Prochains événements du calendrier"
        action={{ label: "Tout voir", href: "/teacher/calendar" }}
      />
      <ul className="mt-4 space-y-2">
        {upcoming.map((e) => {
          const Icon = TYPE_ICON[e.type] ?? CalendarDays;
          const start = new Date(e.startsAt);
          const days = daysUntil(start, now);
          const soon = days <= 7;
          const scope = e.scopeType ? SCOPE_LABEL[e.scopeType] : null;

          return (
            <li key={e.id}>
              <Link
                href="/teacher/calendar"
                className="flex items-start gap-3 rounded-xl border border-slate-200 px-3 py-3 transition-colors hover:bg-slate-50"
              >
                {/* date block */}
                <div className="flex w-11 shrink-0 flex-col items-center rounded-lg bg-slate-50 py-1.5">
                  <span className="text-base font-semibold leading-none text-slate-900 tabular-nums">
                    {DAY_FMT.format(start)}
                  </span>
                  <span className="mt-0.5 text-[11px] font-medium uppercase text-slate-500">
                    {MONTH_FMT.format(start).replace(".", "")}
                  </span>
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${
                        TYPE_TONE[e.type] ?? TYPE_TONE.other
                      }`}
                    >
                      <Icon className="h-3.5 w-3.5" />
                    </span>
                    <p className="truncate text-sm font-medium text-slate-900">
                      {e.title}
                    </p>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                        CHIP_TONE[e.type] ?? CHIP_TONE.other
                      }`}
                    >
                      {TYPE_LABEL[e.type] ?? TYPE_LABEL.other}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                        soon
                          ? "bg-rose-50 text-rose-600"
                          : "bg-slate-100 text-slate-500"
                      }`}
                    >
                      {relativeLabel(days)}
                    </span>
                    {scope ? (
                      <span className="text-[11px] text-slate-400">{scope}</span>
                    ) : null}
                    {e.location ? (
                      <span className="inline-flex items-center gap-0.5 text-[11px] text-slate-400">
                        <MapPin className="h-3 w-3" />
                        <span className="truncate">{e.location}</span>
                      </span>
                    ) : null}
                  </div>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
