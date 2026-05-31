'use client';

import { Check, Loader2, Palette, Pipette, RefreshCw, RotateCcw, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';

import { type BrandingResponse } from '@/lib/me';

import { saveBranding } from './actions';

const DEFAULT_PRIMARY = 'oklch(0.62 0.18 250)';

const PRESET_COLORS: Array<{ label: string; value: string }> = [
  { label: 'Bleu (par défaut)', value: DEFAULT_PRIMARY },
  { label: 'Indigo', value: 'oklch(0.55 0.22 280)' },
  { label: 'Violet', value: 'oklch(0.58 0.20 310)' },
  { label: 'Rose', value: 'oklch(0.65 0.20 0)' },
  { label: 'Rouge', value: 'oklch(0.60 0.22 25)' },
  { label: 'Orange', value: 'oklch(0.68 0.18 50)' },
  { label: 'Vert', value: 'oklch(0.62 0.17 150)' },
  { label: 'Teal', value: 'oklch(0.62 0.12 180)' },
];

/**
 * The native `<input type="color">` only understands 7-char hex. When the stored
 * value is OKLCH (our presets) or empty, we fall back to a sensible hex so the OS
 * picker opens on a reasonable color — picking always *writes* a hex string back,
 * which is itself a valid CSS color for the injected `--brand-*` variables.
 */
function toHexForPicker(value: string, fallback = '#2563eb'): string {
  const v = value.trim();
  return /^#([0-9a-f]{6}|[0-9a-f]{3})$/i.test(v) ? v : fallback;
}

export function BrandingForm({ initial }: { initial: BrandingResponse }) {
  const router = useRouter();
  const [form, setForm] = useState({
    displayName: initial.displayName,
    primaryColor: initial.primaryColor,
    accentColor: initial.accentColor ?? '',
    fontFamily: initial.fontFamily ?? '',
    logoUrl: initial.logoUrl ?? '',
  });
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  const change = (field: keyof typeof form, value: string) => {
    setForm((f) => ({ ...f, [field]: value }));
    setStatus('idle');
  };

  const resetColors = () => {
    setForm((f) => ({ ...f, primaryColor: DEFAULT_PRIMARY, accentColor: '' }));
    setStatus('idle');
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus('saving');
    setError(null);
    const result = await saveBranding(initial.schoolId, {
      displayName: form.displayName,
      primaryColor: form.primaryColor,
      accentColor: form.accentColor || null,
      fontFamily: form.fontFamily || null,
      logoUrl: form.logoUrl || null,
    });
    if (result.ok) {
      setStatus('saved');
      router.refresh();
    } else {
      setStatus('error');
      setError(result.error);
    }
  };

  const colorsDirty =
    form.primaryColor !== DEFAULT_PRIMARY || form.accentColor.trim() !== '';

  return (
    <form onSubmit={onSubmit} className="grid gap-6 lg:grid-cols-3">
      {/* LEFT — fields */}
      <div className="space-y-6 lg:col-span-2">
        <div className="rounded-2xl bg-white p-6 ring-1 ring-slate-200">
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500">Identité</h3>
          <div className="mt-4 space-y-4">
            <Field
              label="Nom affiché"
              id="displayName"
              value={form.displayName}
              onChange={(v) => change('displayName', v)}
              help="Apparaît dans le header de chaque portail."
            />
            <Field
              label="URL du logo (PNG ou SVG)"
              id="logoUrl"
              value={form.logoUrl}
              onChange={(v) => change('logoUrl', v)}
              placeholder="https://…/logo.svg"
              help="Phase 1B : URL externe. L&apos;upload via MinIO arrive en Phase 2."
            />
            <Field
              label="Police (Google Fonts)"
              id="fontFamily"
              value={form.fontFamily}
              onChange={(v) => change('fontFamily', v)}
              placeholder="Inter (défaut)"
              help="Laisser vide pour utiliser Inter."
            />
          </div>
        </div>

        <div className="rounded-2xl bg-white p-6 ring-1 ring-slate-200">
          <div className="flex items-center justify-between gap-3">
            <h3 className="inline-flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-slate-500">
              <Palette className="h-4 w-4 text-slate-400" />
              Palette
            </h3>
            <button
              type="button"
              onClick={resetColors}
              disabled={!colorsDirty}
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Réinitialiser
            </button>
          </div>

          {/* Primary */}
          <ColorChooser
            title="Couleur primaire"
            description="Boutons, badges et accents principaux. Cliquez une pastille, choisissez via la pipette, ou saisissez une valeur OKLCH / hex."
            value={form.primaryColor}
            onChange={(v) => change('primaryColor', v)}
          />

          {/* Accent */}
          <div className="mt-6 border-t border-slate-100 pt-6">
            <ColorChooser
              title="Couleur accent"
              description="Optionnelle — utilisée pour certains badges et libellés. Laissez vide pour reprendre la couleur primaire."
              value={form.accentColor}
              onChange={(v) => change('accentColor', v)}
              clearable
              optionalFallback={form.primaryColor || DEFAULT_PRIMARY}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={status === 'saving'}
            className="inline-flex h-12 items-center gap-2 rounded-xl bg-gradient-to-br from-indigo-600 via-blue-600 to-blue-700 px-6 text-sm font-bold text-white shadow-lg shadow-blue-500/30 transition hover:shadow-xl disabled:opacity-70"
          >
            {status === 'saving' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            {status === 'saving' ? 'Enregistrement…' : 'Enregistrer & appliquer'}
          </button>
          {status === 'saved' && (
            <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-700">
              <Check className="h-4 w-4" /> Branding mis à jour
            </span>
          )}
          {status === 'error' && (
            <span className="text-sm text-red-700">Échec : {error ?? 'inconnu'}</span>
          )}
        </div>
      </div>

      {/* RIGHT — live preview */}
      <aside className="lg:col-span-1">
        <div className="sticky top-24">
          <div className="text-sm font-bold uppercase tracking-wider text-slate-500">Aperçu</div>
          <div className="mt-3 overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <div
              className="h-20 px-5 py-4 text-white"
              style={{ background: form.primaryColor || DEFAULT_PRIMARY }}
            >
              <div className="flex items-center gap-2.5">
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-white/20 text-base font-bold backdrop-blur">
                  {form.displayName.charAt(0).toUpperCase() || 'P'}
                </span>
                <span className="text-base font-bold">{form.displayName || 'Pilotage scolaire'}</span>
              </div>
            </div>
            <div className="space-y-3 p-5">
              <button
                type="button"
                className="inline-flex h-10 items-center gap-2 rounded-lg px-4 text-sm font-semibold text-white"
                style={{ background: form.primaryColor || DEFAULT_PRIMARY }}
              >
                Action primaire <RefreshCw className="h-3.5 w-3.5" />
              </button>
              <div className="flex items-center gap-2">
                <span
                  className="rounded-full px-2 py-0.5 text-xs font-bold text-white"
                  style={{ background: form.accentColor || form.primaryColor || DEFAULT_PRIMARY }}
                >
                  Badge accent
                </span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                  Badge neutre
                </span>
              </div>
              <div className="rounded-xl border border-slate-200 p-3">
                <div className="text-xs font-bold uppercase tracking-wider text-slate-500">Carte exemple</div>
                <div className="mt-1.5 font-mono text-xl font-bold tabular-nums text-slate-900">13.4 / 20</div>
                <div
                  className="mt-1 text-xs font-semibold"
                  style={{ color: form.primaryColor || DEFAULT_PRIMARY }}
                >
                  En progression
                </div>
              </div>
            </div>
          </div>
          <p className="mt-3 text-xs text-slate-500">
            Le branding sera appliqué après rafraîchissement (cmd/ctrl + R) sur les 3 portails.
          </p>
        </div>
      </aside>
    </form>
  );
}

/**
 * A complete color control: preset swatches + an OS color picker (pipette) + a
 * manual OKLCH/hex text input, all kept in sync. Renders a live swatch that shows
 * the *true* current color regardless of format (the native picker can only show
 * hex, so the swatch is a plain div backed by the raw CSS value).
 */
function ColorChooser({
  title,
  description,
  value,
  onChange,
  clearable = false,
  optionalFallback,
}: {
  title: string;
  description: string;
  value: string;
  onChange: (v: string) => void;
  clearable?: boolean;
  optionalFallback?: string;
}) {
  const inputId = useId();
  const trimmed = value.trim();
  const isPreset = PRESET_COLORS.some((p) => p.value === trimmed);
  const isEmpty = trimmed === '';
  const effective = isEmpty ? optionalFallback : trimmed;

  return (
    <div>
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-slate-900">{title}</span>
        {!isEmpty && !isPreset && (
          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">
            Personnalisé
          </span>
        )}
      </div>
      <p className="mt-1 text-xs text-slate-500">{description}</p>

      <div className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-8">
        {PRESET_COLORS.map((p) => (
          <button
            type="button"
            key={p.value}
            onClick={() => onChange(p.value)}
            className={`relative h-12 rounded-xl ring-2 ring-offset-2 transition ${
              trimmed === p.value
                ? 'ring-slate-900'
                : 'ring-transparent hover:ring-slate-300'
            }`}
            style={{ background: p.value }}
            aria-label={p.label}
            aria-pressed={trimmed === p.value}
            title={p.label}
          >
            {trimmed === p.value && (
              <Check className="absolute inset-0 m-auto h-5 w-5 text-white" strokeWidth={3} />
            )}
          </button>
        ))}
      </div>

      <div className="mt-3 flex items-center gap-2">
        {/* Live swatch + native picker (label triggers the hidden input on click) */}
        <label
          htmlFor={inputId}
          className="group relative grid h-11 w-11 shrink-0 cursor-pointer place-items-center overflow-hidden rounded-xl ring-1 ring-slate-200 transition hover:ring-slate-400"
          style={{
            background: effective || '#ffffff',
            backgroundImage: isEmpty
              ? 'repeating-conic-gradient(#e2e8f0 0% 25%, #ffffff 0% 50%)'
              : undefined,
            backgroundSize: isEmpty ? '12px 12px' : undefined,
          }}
          title="Choisir une couleur"
        >
          <Pipette
            className="h-4 w-4 text-white opacity-0 mix-blend-difference transition group-hover:opacity-100"
            aria-hidden
          />
          <input
            id={inputId}
            type="color"
            value={toHexForPicker(trimmed)}
            onChange={(e) => onChange(e.target.value)}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            aria-label={`Sélecteur de couleur — ${title}`}
          />
        </label>

        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={clearable ? 'oklch(...) ou #… (vide = primaire)' : 'oklch(...) ou #…'}
          suppressHydrationWarning
          aria-label={`Valeur ${title}`}
          className="block h-11 w-full rounded-xl border border-slate-200 bg-white px-4 font-mono text-sm focus-visible:border-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
        />

        {clearable && !isEmpty && (
          <button
            type="button"
            onClick={() => onChange('')}
            className="inline-flex h-11 shrink-0 items-center gap-1 rounded-xl px-3 text-xs font-semibold text-slate-600 ring-1 ring-slate-200 transition hover:bg-slate-50 hover:text-slate-900"
            title="Retirer la couleur accent"
          >
            <X className="h-3.5 w-3.5" />
            Sans accent
          </button>
        )}
      </div>
    </div>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  placeholder,
  help,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  help?: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="text-sm font-semibold text-slate-900">
        {label}
      </label>
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        suppressHydrationWarning
        className="mt-1.5 block h-11 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm text-slate-900 placeholder:text-slate-400 focus-visible:border-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
      />
      {help && <p className="mt-1.5 text-xs text-slate-500">{help}</p>}
    </div>
  );
}
