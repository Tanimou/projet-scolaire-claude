import {
  ArrowRight,
  CalendarClock,
  ClipboardList,
  Compass,
  FileEdit,
  LifeBuoy,
  type LucideIcon,
  NotebookPen,
  Sparkles,
} from 'lucide-react';
import Link from 'next/link';

export interface TeacherActionItem {
  key:
    | 'draft-assessments'
    | 'incomplete-grading'
    | 'upcoming-week'
    | 'students-at-risk'
    | 'missing-lessons';
  label: string;
  count: number;
  severity: 'critical' | 'warning' | 'info';
  href: string;
  actionLabel: string;
  detail: string | null;
  preview?: Array<{ id: string; title: string; meta?: string | null }>;
}

export interface TeacherActionDigest {
  draftsToPublish: number;
  gradesToComplete: number;
  assessmentsThisWeek: number;
  studentsAtRisk: number;
  lessonsToFill: number;
}

export interface TeacherActionData {
  generatedAt: string;
  totalActionable: number;
  items: TeacherActionItem[];
  digest: TeacherActionDigest;
}

const ICON_BY_KEY: Record<TeacherActionItem['key'], LucideIcon> = {
  'draft-assessments': FileEdit,
  'incomplete-grading': ClipboardList,
  'upcoming-week': CalendarClock,
  'students-at-risk': LifeBuoy,
  'missing-lessons': NotebookPen,
};

const SEVERITY_STYLES: Record<
  TeacherActionItem['severity'],
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
    card: 'border-violet-200 bg-violet-50/60 hover:border-violet-300 hover:bg-violet-50',
    iconBg: 'bg-violet-100',
    iconFg: 'text-violet-700',
    count: 'text-violet-900',
    cta: 'text-violet-700 hover:text-violet-900',
    chip: 'bg-violet-600 text-white',
  },
};

function formatGeneratedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

export function TeacherActionCenter({ data }: { data: TeacherActionData | null }) {
  if (!data) {
    return (
      <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/60">
        <header className="flex items-center gap-3">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
            <Compass className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-base font-bold text-slate-900">Centre d&apos;action</h2>
            <p className="mt-0.5 text-[12px] text-slate-500">Aucune donnée pour l&apos;instant.</p>
          </div>
        </header>
      </section>
    );
  }

  const { items, digest, totalActionable, generatedAt } = data;
  const allClear = items.length === 0;
  const generatedAtLabel = formatGeneratedAt(generatedAt);

  return (
    <section className="rounded-2xl bg-gradient-to-br from-white to-violet-50/40 p-5 shadow-sm ring-1 ring-slate-200/60">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span
            className={[
              'inline-flex h-10 w-10 items-center justify-center rounded-xl shadow-sm ring-1',
              allClear
                ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
                : 'bg-gradient-to-br from-violet-500 to-indigo-500 text-white ring-white/40',
            ].join(' ')}
          >
            {allClear ? <Sparkles className="h-5 w-5" /> : <Compass className="h-5 w-5" />}
          </span>
          <div>
            <h2 className="flex items-center gap-2 text-base font-bold text-slate-900">
              Centre d&apos;action
              {!allClear && (
                <span className="inline-flex items-center rounded-full bg-slate-900 px-2 py-0.5 text-[11px] font-bold text-white">
                  {totalActionable.toLocaleString('fr-FR')}
                </span>
              )}
            </h2>
            <p className="mt-0.5 text-[12px] text-slate-500">
              {allClear
                ? 'Tout est à jour — aucune tâche ne demande votre attention.'
                : 'Ce qui demande votre attention sur vos classes aujourd’hui.'}
              {generatedAtLabel && (
                <span className="ml-1 text-slate-400">· mis à jour à {generatedAtLabel}</span>
              )}
            </p>
          </div>
        </div>

        {!allClear && (
          <div className="hidden flex-wrap items-center gap-1.5 md:flex">
            <DigestChip
              label="à publier"
              value={digest.draftsToPublish}
              tone="amber"
              hidden={digest.draftsToPublish === 0}
            />
            <DigestChip
              label="saisies à finir"
              value={digest.gradesToComplete}
              tone="rose"
              hidden={digest.gradesToComplete === 0}
            />
            <DigestChip
              label="élèves en difficulté"
              value={digest.studentsAtRisk}
              tone="rose"
              hidden={digest.studentsAtRisk === 0}
            />
            <DigestChip
              label="évals cette semaine"
              value={digest.assessmentsThisWeek}
              tone="violet"
              hidden={digest.assessmentsThisWeek === 0}
            />
            <DigestChip
              label="cahiers à remplir"
              value={digest.lessonsToFill}
              tone="sky"
              hidden={digest.lessonsToFill === 0}
            />
          </div>
        )}
      </header>

      {allClear ? (
        <div className="mt-4 flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50/60 p-4">
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
            <Sparkles className="h-5 w-5" />
          </span>
          <div className="text-sm text-emerald-900">
            <p className="font-bold">Rien en attente</p>
            <p className="mt-0.5 text-xs text-emerald-800/80">
              Aucune évaluation en brouillon, aucune saisie incomplète, aucun élève sous le seuil et
              aucun cahier de texte en retard. Beau travail&nbsp;!
            </p>
          </div>
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {items.map((item) => (
            <ActionCard key={item.key} item={item} />
          ))}
        </div>
      )}
    </section>
  );
}

function ActionCard({ item }: { item: TeacherActionItem }) {
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

function DigestChip({
  label,
  value,
  tone,
  hidden,
}: {
  label: string;
  value: number;
  tone: 'rose' | 'amber' | 'sky' | 'violet';
  hidden?: boolean;
}) {
  if (hidden) return null;
  const palette =
    tone === 'rose'
      ? 'bg-rose-50 text-rose-700 ring-rose-200'
      : tone === 'amber'
        ? 'bg-amber-50 text-amber-700 ring-amber-200'
        : tone === 'violet'
          ? 'bg-violet-50 text-violet-700 ring-violet-200'
          : 'bg-sky-50 text-sky-700 ring-sky-200';
  return (
    <span
      className={[
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1',
        palette,
      ].join(' ')}
    >
      <span className="tabular-nums">{value.toLocaleString('fr-FR')}</span>
      <span className="text-[11px] uppercase tracking-wider opacity-80">{label}</span>
    </span>
  );
}
