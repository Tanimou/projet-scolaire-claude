'use client';

import {
  Award,
  Calendar,
  Check,
  ChevronRight,
  GraduationCap,
  Hash,
  LayoutGrid,
  Loader2,
  Palette,
  Percent,
  RotateCcw,
  Sparkles,
  TrendingUp,
} from 'lucide-react';
import { useCallback, useEffect, useState, useTransition } from 'react';

import { updateDisplayPreferencesAction } from './display-prefs-actions';
import {
  DISPLAY_PREFS_DEFAULTS,
  type DisplayAccent,
  type DisplayDateFormat,
  type DisplayDensity,
  type DisplayGradeFormat,
  type DisplayPreferences,
  type UpdateDisplayPreferencesPatch,
} from './display-prefs-types';

// -----------------------------------------------------------------------------
// Static descriptors — kept here so the panel stays self-contained.
// -----------------------------------------------------------------------------

const DENSITY_OPTIONS: Array<{
  value: DisplayDensity;
  label: string;
  hint: string;
  ringHeight: string;
}> = [
  { value: 'compact', label: 'Compact', hint: 'Maximise l’information à l’écran', ringHeight: 'h-1' },
  { value: 'cozy', label: 'Confortable', hint: 'Équilibre lecture / densité (recommandé)', ringHeight: 'h-1.5' },
  { value: 'spacious', label: 'Spacieux', hint: 'Espaces aérés, idéal grand écran', ringHeight: 'h-2.5' },
];

interface AccentDescriptor {
  value: DisplayAccent;
  label: string;
  swatch: string;
  swatchSoft: string;
  textOnSoft: string;
}

const ACCENT_OPTIONS: AccentDescriptor[] = [
  {
    value: 'default',
    label: 'Marque',
    swatch: 'bg-[var(--brand-primary,#2563EB)]',
    swatchSoft: 'bg-blue-50',
    textOnSoft: 'text-[var(--brand-primary,#2563EB)]',
  },
  { value: 'blue', label: 'Océan', swatch: 'bg-blue-600', swatchSoft: 'bg-blue-50', textOnSoft: 'text-blue-700' },
  { value: 'violet', label: 'Violet', swatch: 'bg-violet-600', swatchSoft: 'bg-violet-50', textOnSoft: 'text-violet-700' },
  { value: 'emerald', label: 'Émeraude', swatch: 'bg-emerald-600', swatchSoft: 'bg-emerald-50', textOnSoft: 'text-emerald-700' },
  { value: 'rose', label: 'Corail', swatch: 'bg-rose-600', swatchSoft: 'bg-rose-50', textOnSoft: 'text-rose-700' },
  { value: 'amber', label: 'Ambre', swatch: 'bg-amber-500', swatchSoft: 'bg-amber-50', textOnSoft: 'text-amber-700' },
];

const DATE_FORMAT_OPTIONS: Array<{
  value: DisplayDateFormat;
  label: string;
  hint: string;
  preview: (d: Date) => string;
}> = [
  { value: 'short', label: 'Court', hint: '21/05/2026', preview: (d) => formatShort(d) },
  { value: 'long', label: 'Long', hint: '21 mai 2026', preview: (d) => formatLong(d) },
  { value: 'relative', label: 'Relatif', hint: "il y a 2 jours, aujourd'hui…", preview: (d) => formatRelative(d) },
];

const GRADE_FORMAT_OPTIONS: Array<{
  value: DisplayGradeFormat;
  label: string;
  hint: string;
  preview: (g: number) => string;
}> = [
  { value: 'twenty', label: 'Sur 20', hint: '14,50 / 20', preview: (g) => `${g.toFixed(2).replace('.', ',')} / 20` },
  { value: 'percent', label: 'Pourcentage', hint: '72,5 %', preview: (g) => `${((g / 20) * 100).toFixed(1).replace('.', ',')} %` },
  { value: 'letter', label: 'Lettre', hint: 'A · B · C · D · E', preview: (g) => letterFromGrade(g) },
];

// -----------------------------------------------------------------------------
// Local formatters used inside the live-preview panel only.
// -----------------------------------------------------------------------------

const FR = 'fr-FR';

function formatShort(d: Date): string {
  return d.toLocaleDateString(FR, { day: '2-digit', month: '2-digit', year: 'numeric' });
}
function formatLong(d: Date): string {
  return d.toLocaleDateString(FR, { day: 'numeric', month: 'long', year: 'numeric' });
}
function formatRelative(d: Date): string {
  const diffMs = Date.now() - d.getTime();
  const days = Math.round(diffMs / (24 * 60 * 60 * 1000));
  if (days <= 0) return "Aujourd'hui";
  if (days === 1) return 'Hier';
  if (days < 7) return `il y a ${days} jours`;
  if (days < 30) return `il y a ${Math.round(days / 7)} sem.`;
  return formatShort(d);
}
function letterFromGrade(g: number): string {
  if (g >= 16) return 'A';
  if (g >= 14) return 'B';
  if (g >= 12) return 'C';
  if (g >= 10) return 'D';
  return 'E';
}

const DENSITY_TOKENS: Record<DisplayDensity, { pad: string; gap: string; rowPad: string }> = {
  compact: { pad: 'p-3', gap: 'gap-2', rowPad: 'py-2' },
  cozy: { pad: 'p-4', gap: 'gap-3', rowPad: 'py-3' },
  spacious: { pad: 'p-6', gap: 'gap-5', rowPad: 'py-4' },
};

const ACCENT_TOKENS: Record<DisplayAccent, { soft: string; text: string; ring: string }> = {
  default: { soft: 'bg-blue-50', text: 'text-[var(--brand-primary,#2563EB)]', ring: 'ring-[var(--brand-primary,#2563EB)]/30' },
  blue: { soft: 'bg-blue-50', text: 'text-blue-700', ring: 'ring-blue-200' },
  violet: { soft: 'bg-violet-50', text: 'text-violet-700', ring: 'ring-violet-200' },
  emerald: { soft: 'bg-emerald-50', text: 'text-emerald-700', ring: 'ring-emerald-200' },
  rose: { soft: 'bg-rose-50', text: 'text-rose-700', ring: 'ring-rose-200' },
  amber: { soft: 'bg-amber-50', text: 'text-amber-700', ring: 'ring-amber-200' },
};

// -----------------------------------------------------------------------------
// Panel
// -----------------------------------------------------------------------------

export function DisplayPreferencesPanel({
  initial,
  portal,
}: {
  initial: DisplayPreferences;
  portal: 'admin' | 'teacher' | 'parent';
}) {
  const [prefs, setPrefs] = useState<DisplayPreferences>(initial);
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  // Hide "Enregistré" badge automatically.
  useEffect(() => {
    if (status !== 'saved') return;
    const t = setTimeout(() => setStatus('idle'), 1800);
    return () => clearTimeout(t);
  }, [status]);

  const commit = useCallback(
    (patch: UpdateDisplayPreferencesPatch) => {
      const previous = prefs;
      const next: DisplayPreferences = { ...prefs, ...patch };
      setPrefs(next);
      setStatus('saving');
      setError(null);
      startTransition(async () => {
        const res = await updateDisplayPreferencesAction(patch);
        if (!res.ok) {
          setPrefs(previous);
          setStatus('error');
          setError(res.error);
        } else {
          setPrefs(res.data);
          setStatus('saved');
        }
      });
    },
    [prefs],
  );

  const isDefault =
    prefs.density === DISPLAY_PREFS_DEFAULTS.density &&
    prefs.accent === DISPLAY_PREFS_DEFAULTS.accent &&
    prefs.dateFormat === DISPLAY_PREFS_DEFAULTS.dateFormat &&
    prefs.gradeFormat === DISPLAY_PREFS_DEFAULTS.gradeFormat;

  function reset() {
    if (isDefault || pending) return;
    commit({ ...DISPLAY_PREFS_DEFAULTS });
  }

  return (
    <div className="space-y-4">
      <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/60">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-6 py-4">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-slate-900">Préférences d&apos;affichage</h2>
            <p className="mt-1 text-xs text-slate-500">
              Personnalisez la densité d&apos;affichage, la couleur d&apos;accent et le format des dates / notes.
              Vos préférences sont enregistrées sur votre compte et s&apos;appliquent à tous vos navigateurs.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge status={status} error={error} />
            <button
              type="button"
              onClick={reset}
              disabled={isDefault || pending}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Réinitialiser
            </button>
          </div>
        </div>

        <div className="divide-y divide-slate-100">
          {/* Density */}
          <FieldRow
            icon={LayoutGrid}
            label="Densité de l'interface"
            hint="Contrôle la compacité des cartes, tableaux et listes"
            iconTone="bg-blue-50 text-blue-600"
          >
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {DENSITY_OPTIONS.map((opt) => {
                const active = prefs.density === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => !active && commit({ density: opt.value })}
                    disabled={pending}
                    className={`group relative flex flex-col items-start gap-2 rounded-xl border p-3 text-left transition-all disabled:cursor-not-allowed disabled:opacity-60 ${
                      active
                        ? 'border-blue-500 bg-blue-50/40 ring-2 ring-blue-200'
                        : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex w-full items-center justify-between">
                      <span className="text-sm font-bold text-slate-900">{opt.label}</span>
                      {active && <Check className="h-4 w-4 text-blue-600" />}
                    </div>
                    <div className="w-full space-y-1">
                      <span className={`block ${opt.ringHeight} w-full rounded-full bg-slate-200`} />
                      <span className={`block ${opt.ringHeight} w-3/4 rounded-full bg-slate-200`} />
                      <span className={`block ${opt.ringHeight} w-1/2 rounded-full bg-slate-200`} />
                    </div>
                    <span className="text-[11px] text-slate-500">{opt.hint}</span>
                  </button>
                );
              })}
            </div>
          </FieldRow>

          {/* Accent */}
          <FieldRow
            icon={Palette}
            label="Couleur d'accent"
            hint="Teinte secondaire des badges, chips et survols dans l'aperçu ci-dessous"
            iconTone="bg-violet-50 text-violet-600"
          >
            <div className="flex flex-wrap gap-2">
              {ACCENT_OPTIONS.map((opt) => {
                const active = prefs.accent === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => !active && commit({ accent: opt.value })}
                    disabled={pending}
                    aria-pressed={active}
                    title={opt.label}
                    className={`group inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-bold transition-all disabled:cursor-not-allowed disabled:opacity-60 ${
                      active
                        ? 'border-slate-900 bg-slate-50 text-slate-900 ring-2 ring-slate-200'
                        : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 rounded-full shadow-inner ${opt.swatch} ${
                        active ? 'ring-2 ring-white ring-offset-2 ring-offset-slate-900' : ''
                      }`}
                    />
                    <span>{opt.label}</span>
                    {active && <Check className="h-3.5 w-3.5 text-slate-900" />}
                  </button>
                );
              })}
            </div>
          </FieldRow>

          {/* Date format */}
          <FieldRow
            icon={Calendar}
            label="Format des dates"
            hint="Comment afficher les dates dans les listes et les cartes"
            iconTone="bg-emerald-50 text-emerald-600"
          >
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {DATE_FORMAT_OPTIONS.map((opt) => {
                const active = prefs.dateFormat === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => !active && commit({ dateFormat: opt.value })}
                    disabled={pending}
                    className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-left transition-all disabled:cursor-not-allowed disabled:opacity-60 ${
                      active
                        ? 'border-emerald-500 bg-emerald-50/40 ring-2 ring-emerald-200'
                        : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    <div className="min-w-0">
                      <span className="block text-sm font-bold text-slate-900">{opt.label}</span>
                      <span className="block text-[11px] font-mono text-slate-500">{opt.hint}</span>
                    </div>
                    {active && <Check className="h-4 w-4 shrink-0 text-emerald-600" />}
                  </button>
                );
              })}
            </div>
          </FieldRow>

          {/* Grade format */}
          <FieldRow
            icon={GraduationCap}
            label="Format des notes"
            hint="Choisissez entre /20, pourcentage ou lettre (A → E)"
            iconTone="bg-amber-50 text-amber-600"
          >
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {GRADE_FORMAT_OPTIONS.map((opt) => {
                const active = prefs.gradeFormat === opt.value;
                const Icon = opt.value === 'percent' ? Percent : opt.value === 'letter' ? Award : Hash;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => !active && commit({ gradeFormat: opt.value })}
                    disabled={pending}
                    className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-left transition-all disabled:cursor-not-allowed disabled:opacity-60 ${
                      active
                        ? 'border-amber-500 bg-amber-50/40 ring-2 ring-amber-200'
                        : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
                        <Icon className="h-3.5 w-3.5" />
                      </span>
                      <div className="min-w-0">
                        <span className="block text-sm font-bold text-slate-900">{opt.label}</span>
                        <span className="block text-[11px] font-mono text-slate-500">{opt.hint}</span>
                      </div>
                    </div>
                    {active && <Check className="h-4 w-4 shrink-0 text-amber-600" />}
                  </button>
                );
              })}
            </div>
          </FieldRow>
        </div>
      </section>

      {/* Live preview ----------------------------------------------------- */}
      <LivePreview prefs={prefs} portal={portal} />
    </div>
  );
}

// -----------------------------------------------------------------------------
// Subparts
// -----------------------------------------------------------------------------

function FieldRow({
  icon: Icon,
  label,
  hint,
  iconTone,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  hint: string;
  iconTone: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 px-6 py-5 lg:grid-cols-12">
      <div className="lg:col-span-4">
        <div className="flex items-start gap-2.5">
          <span className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${iconTone}`}>
            <Icon className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-slate-900">{label}</h3>
            <p className="mt-0.5 text-[11px] text-slate-500">{hint}</p>
          </div>
        </div>
      </div>
      <div className="lg:col-span-8">{children}</div>
    </div>
  );
}

function StatusBadge({
  status,
  error,
}: {
  status: 'idle' | 'saving' | 'saved' | 'error';
  error: string | null;
}) {
  if (status === 'saving') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-700">
        <Loader2 className="h-3 w-3 animate-spin" />
        Enregistrement…
      </span>
    );
  }
  if (status === 'saved') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700 ring-1 ring-emerald-100">
        <Check className="h-3 w-3" />
        Enregistré
      </span>
    );
  }
  if (status === 'error') {
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-full bg-rose-50 px-2.5 py-1 text-[11px] font-bold text-rose-700 ring-1 ring-rose-100"
        title={error ?? undefined}
      >
        Erreur de sauvegarde
      </span>
    );
  }
  return null;
}

function LivePreview({
  prefs,
  portal,
}: {
  prefs: DisplayPreferences;
  portal: 'admin' | 'teacher' | 'parent';
}) {
  const density = DENSITY_TOKENS[prefs.density];
  const accent = ACCENT_TOKENS[prefs.accent];
  const today = new Date();
  const past = new Date();
  past.setDate(past.getDate() - 2);
  const dateFmt = DATE_FORMAT_OPTIONS.find((o) => o.value === prefs.dateFormat)!;
  const gradeFmt = GRADE_FORMAT_OPTIONS.find((o) => o.value === prefs.gradeFormat)!;

  const sampleAssessments = [
    { label: 'DM Maths', date: past, grade: 16.5 },
    { label: 'Contrôle Histoire', date: today, grade: 13.25 },
    { label: 'Exposé SVT', date: today, grade: 11.75 },
  ];

  const portalLabel =
    portal === 'teacher' ? 'Enseignant' : portal === 'parent' ? 'Parent' : 'Administration';

  return (
    <section className="overflow-hidden rounded-2xl bg-gradient-to-br from-slate-50 via-white to-slate-50 shadow-sm ring-1 ring-slate-200/60">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-white/60 px-6 py-3 backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <span className={`inline-flex h-7 w-7 items-center justify-center rounded-lg ${accent.soft} ${accent.text}`}>
            <Sparkles className="h-3.5 w-3.5" />
          </span>
          <h3 className="text-sm font-bold text-slate-900">Aperçu en direct</h3>
          <span className="text-[11px] text-slate-500">— vos choix appliqués sur des éléments d&apos;exemple ({portalLabel})</span>
        </div>
        <span className="hidden text-[10px] font-bold uppercase tracking-wider text-slate-400 sm:inline">
          Densité · {prefs.density} · Accent · {prefs.accent}
        </span>
      </div>

      <div className={`grid grid-cols-1 ${density.gap} ${density.pad} lg:grid-cols-3`}>
        {/* KPI sample */}
        <article className={`rounded-xl bg-white ring-1 ring-slate-200/60 ${density.pad}`}>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className={`inline-flex h-8 w-8 items-center justify-center rounded-lg ${accent.soft} ${accent.text}`}>
                <TrendingUp className="h-4 w-4" />
              </span>
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Moyenne classe</span>
            </div>
          </div>
          <div className="mt-3 font-mono text-2xl font-bold tabular-nums text-slate-900">
            {gradeFmt.preview(13.6)}
          </div>
          <p className="mt-1 text-[11px] text-slate-500">Mise à jour {dateFmt.preview(today)}</p>
        </article>

        {/* Recent assessments */}
        <article className={`rounded-xl bg-white ring-1 ring-slate-200/60 ${density.pad} lg:col-span-2`}>
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-bold text-slate-900">Dernières évaluations</h4>
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${accent.soft} ${accent.text}`}>
              <ChevronRight className="h-3 w-3" />
              3 entrées
            </span>
          </div>
          <ul className={`mt-3 divide-y divide-slate-100`}>
            {sampleAssessments.map((a, i) => (
              <li key={i} className={`flex items-center justify-between gap-3 ${density.rowPad}`}>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-900">{a.label}</p>
                  <p className="text-[11px] text-slate-500">{dateFmt.preview(a.date)}</p>
                </div>
                <span
                  className={`inline-flex min-w-[3.5rem] justify-center rounded-full px-2.5 py-0.5 text-xs font-bold tabular-nums ${
                    a.grade >= 14
                      ? 'bg-emerald-100 text-emerald-700'
                      : a.grade >= 10
                        ? 'bg-amber-100 text-amber-700'
                        : 'bg-rose-100 text-rose-700'
                  }`}
                >
                  {gradeFmt.preview(a.grade)}
                </span>
              </li>
            ))}
          </ul>
        </article>
      </div>

      <div className="border-t border-slate-100 bg-white/60 px-6 py-3 text-[11px] text-slate-500">
        <strong>Appliqué partout —</strong> la densité agit sur les cartes KPI, l&apos;accent
        colore les liens « Voir » et le bandeau de date du topbar, le format des notes change
        l&apos;affichage des pastilles de notes (les saisies restent toujours en /20). Le
        format des dates s&apos;applique à la puce « aujourd&apos;hui » du topbar.
      </div>
    </section>
  );
}
