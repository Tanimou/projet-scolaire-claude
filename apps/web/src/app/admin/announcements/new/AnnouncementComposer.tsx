'use client';

import {
  AlertTriangle,
  ArrowRight,
  Building2,
  CalendarX,
  Check,
  CircleDot,
  GraduationCap,
  Info,
  Layers,
  Loader2,
  Megaphone,
  Pin,
  Save,
  Send,
  Sparkles,
  Users,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { createAnnouncement } from '../actions';

type Scope = 'school_wide' | 'cycle_scope' | 'grade_level_scope' | 'class_section_scope';
type Priority = 'normal' | 'high' | 'urgent';

interface Cycle {
  id: string;
  name: string;
  gradeLevels: Array<{ id: string; name: string; classSections?: Array<{ id: string }> }>;
}

interface Klass {
  id: string;
  name: string;
  capacity?: number | null;
  enrolledCount?: number;
  gradeLevel: { id?: string; name: string; cycle?: { id: string; name: string } | null };
}

interface PreviewResult {
  count: number;
  breakdown: { parents: number; teachers: number; admins: number; other: number };
}

const TITLE_MAX = 200;
const BODY_MAX = 10_000;
const ESTIMATE_DEBOUNCE_MS = 350;

const SCOPE_TILES: Array<{
  value: Scope;
  label: string;
  hint: string;
  icon: typeof Building2;
}> = [
  {
    value: 'school_wide',
    label: 'Toute l’école',
    hint: 'Parents, enseignants & équipe administrative',
    icon: Building2,
  },
  {
    value: 'cycle_scope',
    label: 'Un cycle',
    hint: 'Familles & enseignants d’un cycle entier',
    icon: Layers,
  },
  {
    value: 'grade_level_scope',
    label: 'Un niveau',
    hint: 'Familles & enseignants d’un niveau ciblé',
    icon: GraduationCap,
  },
  {
    value: 'class_section_scope',
    label: 'Une classe',
    hint: 'Familles et enseignants d’une classe précise',
    icon: Users,
  },
];

const PRIORITY_TILES: Array<{
  value: Priority;
  label: string;
  hint: string;
  badge: string;
  ring: string;
  iconBg: string;
}> = [
  {
    value: 'normal',
    label: 'Normale',
    hint: 'Diffusion standard, sans accent visuel',
    badge: 'bg-slate-100 text-slate-700 ring-slate-200',
    ring: 'ring-slate-200',
    iconBg: 'bg-blue-100 text-blue-700',
  },
  {
    value: 'high',
    label: 'Importante',
    hint: 'Mise en avant avec badge orange',
    badge: 'bg-amber-100 text-amber-800 ring-amber-200',
    ring: 'ring-amber-200',
    iconBg: 'bg-amber-100 text-amber-700',
  },
  {
    value: 'urgent',
    label: 'Urgente',
    hint: 'Affichage rouge + notification danger',
    badge: 'bg-rose-100 text-rose-800 ring-rose-200',
    ring: 'ring-rose-200',
    iconBg: 'bg-rose-100 text-rose-700',
  },
];

const EXPIRY_PRESETS: Array<{ key: string; label: string; addDays: number | null }> = [
  { key: 'none', label: 'Sans expiration', addDays: null },
  { key: '7d', label: 'Dans 7 j', addDays: 7 },
  { key: '30d', label: 'Dans 30 j', addDays: 30 },
  { key: '90d', label: 'Dans 90 j', addDays: 90 },
];

function ymd(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function presetKeyFor(expiresAt: string): string {
  if (!expiresAt) return 'none';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (const p of EXPIRY_PRESETS) {
    if (p.addDays === null) continue;
    const d = new Date(today);
    d.setDate(d.getDate() + p.addDays);
    if (ymd(d) === expiresAt) return p.key;
  }
  return 'custom';
}

export function AnnouncementComposer({
  cycles,
  classes,
}: {
  cycles: Cycle[];
  classes: Klass[];
}) {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [scope, setScope] = useState<Scope>('school_wide');
  const [priority, setPriority] = useState<Priority>('normal');
  const [cycleId, setCycleId] = useState('');
  const [gradeLevelId, setGradeLevelId] = useState('');
  const [classSectionId, setClassSectionId] = useState('');
  const [pinned, setPinned] = useState(false);
  const [expiresAt, setExpiresAt] = useState('');
  const [busy, setBusy] = useState<null | 'draft' | 'publish'>(null);
  const [error, setError] = useState<string | null>(null);

  // Recipient preview state
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // Flatten level options for the grade-level scope picker (cycle · level).
  const allLevels = useMemo(
    () =>
      cycles.flatMap((c) =>
        c.gradeLevels.map((g) => ({
          id: g.id,
          label: `${c.name} · ${g.name}`,
          cycleName: c.name,
          levelName: g.name,
        })),
      ),
    [cycles],
  );

  // Cycle dropdown — show grade-level count to help the admin gauge breadth.
  const cycleOptions = useMemo(
    () =>
      cycles.map((c) => ({
        id: c.id,
        label: `${c.name} (${c.gradeLevels.length} niveau${c.gradeLevels.length > 1 ? 'x' : ''})`,
      })),
    [cycles],
  );

  // Class dropdown — group by grade level, surface enrolled/capacity when known.
  const classOptions = useMemo(
    () =>
      classes.map((c) => ({
        id: c.id,
        label: `${c.name} · ${c.gradeLevel.name}`,
        capacity: c.capacity ?? null,
        enrolled: c.enrolledCount ?? null,
      })),
    [classes],
  );

  // The scope-specific picker reads valid? from this — disable the action bar
  // when the user picked "Un cycle" but hasn't chosen which one.
  const scopeReady = useMemo(() => {
    switch (scope) {
      case 'cycle_scope':
        return !!cycleId;
      case 'grade_level_scope':
        return !!gradeLevelId;
      case 'class_section_scope':
        return !!classSectionId;
      default:
        return true;
    }
  }, [scope, cycleId, gradeLevelId, classSectionId]);

  // Debounced recipient estimate fetch — only fires when scope payload is
  // complete. Skipping the fetch when scopeReady is false avoids 400 spam
  // from the backend's validateScope() check.
  const refreshPreview = useCallback(async () => {
    if (!scopeReady) {
      setPreview(null);
      setPreviewError(null);
      return;
    }
    setPreviewLoading(true);
    setPreviewError(null);
    const params = new URLSearchParams({ scope });
    if (scope === 'cycle_scope') params.set('cycleId', cycleId);
    if (scope === 'grade_level_scope') params.set('gradeLevelId', gradeLevelId);
    if (scope === 'class_section_scope') params.set('classSectionId', classSectionId);
    try {
      const res = await fetch(`/api/proxy/v1/announcements/preview-recipients?${params.toString()}`, {
        cache: 'no-store',
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        let msg = `Erreur ${res.status}`;
        try {
          const j = JSON.parse(text) as { message?: string | string[] };
          msg = Array.isArray(j.message) ? j.message.join(' · ') : (j.message ?? msg);
        } catch {
          /* keep generic */
        }
        setPreviewError(msg);
        setPreview(null);
        return;
      }
      const data = (await res.json()) as PreviewResult;
      setPreview(data);
    } catch (err) {
      setPreviewError((err as Error).message);
      setPreview(null);
    } finally {
      setPreviewLoading(false);
    }
  }, [scope, cycleId, gradeLevelId, classSectionId, scopeReady]);

  useEffect(() => {
    const handle = setTimeout(refreshPreview, ESTIMATE_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [refreshPreview]);

  const submit = async (publishNow: boolean) => {
    setBusy(publishNow ? 'publish' : 'draft');
    setError(null);
    const payload: Record<string, unknown> = {
      title: title.trim(),
      body,
      scope,
      priority,
      pinned,
      publishNow,
      ...(expiresAt ? { expiresAt: new Date(`${expiresAt}T23:59:59`).toISOString() } : {}),
      ...(scope === 'cycle_scope' && cycleId ? { cycleId } : {}),
      ...(scope === 'grade_level_scope' && gradeLevelId ? { gradeLevelId } : {}),
      ...(scope === 'class_section_scope' && classSectionId ? { classSectionId } : {}),
    };
    const res = await createAnnouncement(payload);
    setBusy(null);
    if (!res.ok) setError(res.error);
    else router.push('/admin/communications');
  };

  const titleLen = title.length;
  const bodyLen = body.length;
  const audienceLabel = useMemo(() => {
    if (scope === 'school_wide') return 'Toute l’école';
    if (scope === 'cycle_scope') {
      const c = cycles.find((x) => x.id === cycleId);
      return c ? `Cycle · ${c.name}` : 'Choisir un cycle';
    }
    if (scope === 'grade_level_scope') {
      const l = allLevels.find((x) => x.id === gradeLevelId);
      return l ? `Niveau · ${l.label}` : 'Choisir un niveau';
    }
    if (scope === 'class_section_scope') {
      const k = classOptions.find((x) => x.id === classSectionId);
      return k ? `Classe · ${k.label}` : 'Choisir une classe';
    }
    return '';
  }, [scope, cycleId, gradeLevelId, classSectionId, cycles, allLevels, classOptions]);

  const canSubmit = title.trim().length > 0 && body.trim().length > 0 && scopeReady;
  const activeExpiryPreset = presetKeyFor(expiresAt);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit(false);
      }}
      className="grid gap-6 lg:grid-cols-5"
    >
      {/* Left column — composer */}
      <div className="space-y-5 lg:col-span-3">
        {error && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Section 1 — Contenu */}
        <Section icon={Sparkles} title="Contenu" subtitle="Titre clair, message structuré.">
          <div className="space-y-4">
            <FieldRow
              label="Titre"
              required
              hint={`${titleLen}/${TITLE_MAX}`}
              hintTone={titleLen > TITLE_MAX * 0.9 ? 'warn' : 'mute'}
            >
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={TITLE_MAX}
                required
                placeholder="Ex : Réunion parents-profs du 15 juin"
                className="block w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm transition focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
              />
            </FieldRow>

            <FieldRow
              label="Message"
              required
              hint={`${bodyLen}/${BODY_MAX}`}
              hintTone={bodyLen > BODY_MAX * 0.9 ? 'warn' : 'mute'}
            >
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                maxLength={BODY_MAX}
                required
                rows={7}
                placeholder="Détaillez le contexte, la date, le lieu, l'heure et les éventuelles consignes…"
                className="block w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm leading-relaxed text-slate-900 shadow-sm transition focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
              />
              <p className="mt-1.5 text-[11px] text-slate-500">
                Astuce : un saut de ligne sépare visuellement les paragraphes dans le rendu final.
              </p>
            </FieldRow>
          </div>
        </Section>

        {/* Section 2 — Audience */}
        <Section
          icon={Users}
          title="Audience"
          subtitle="Choisissez qui recevra ce message. Le nombre exact se met à jour ci-contre."
        >
          <div className="grid gap-2.5 sm:grid-cols-2">
            {SCOPE_TILES.map((tile) => {
              const Icon = tile.icon;
              const active = scope === tile.value;
              return (
                <button
                  key={tile.value}
                  type="button"
                  onClick={() => setScope(tile.value)}
                  className={`group flex items-start gap-3 rounded-2xl border p-3.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${
                    active
                      ? 'border-blue-500 bg-gradient-to-br from-blue-50 via-white to-indigo-50 shadow-sm ring-1 ring-blue-200'
                      : 'border-slate-200 bg-white hover:border-blue-300 hover:bg-slate-50'
                  }`}
                  aria-pressed={active}
                >
                  <span
                    aria-hidden
                    className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${
                      active
                        ? 'bg-blue-600 text-white shadow-sm shadow-blue-300/60'
                        : 'bg-slate-100 text-slate-600 group-hover:bg-blue-100 group-hover:text-blue-700'
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-slate-900">{tile.label}</span>
                    <span className="mt-0.5 block text-[11px] leading-snug text-slate-500">
                      {tile.hint}
                    </span>
                  </span>
                  {active && (
                    <span
                      aria-hidden
                      className="ml-auto grid h-5 w-5 place-items-center rounded-full bg-blue-600 text-white"
                    >
                      <Check className="h-3 w-3" />
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {scope === 'cycle_scope' && (
            <div className="mt-4">
              <FieldRow label="Cycle" required>
                <select
                  value={cycleId}
                  onChange={(e) => setCycleId(e.target.value)}
                  required
                  className="block w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm transition focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                >
                  <option value="">— Choisir un cycle —</option>
                  {cycleOptions.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </FieldRow>
            </div>
          )}

          {scope === 'grade_level_scope' && (
            <div className="mt-4">
              <FieldRow label="Niveau" required>
                <select
                  value={gradeLevelId}
                  onChange={(e) => setGradeLevelId(e.target.value)}
                  required
                  className="block w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm transition focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                >
                  <option value="">— Choisir un niveau —</option>
                  {allLevels.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.label}
                    </option>
                  ))}
                </select>
              </FieldRow>
            </div>
          )}

          {scope === 'class_section_scope' && (
            <div className="mt-4">
              <FieldRow label="Classe" required>
                <select
                  value={classSectionId}
                  onChange={(e) => setClassSectionId(e.target.value)}
                  required
                  className="block w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm transition focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                >
                  <option value="">— Choisir une classe —</option>
                  {classOptions.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                      {c.enrolled !== null && c.capacity
                        ? ` · ${c.enrolled}/${c.capacity}`
                        : c.enrolled !== null
                          ? ` · ${c.enrolled} élèves`
                          : ''}
                    </option>
                  ))}
                </select>
              </FieldRow>
            </div>
          )}
        </Section>

        {/* Section 3 — Priorité & publication */}
        <Section
          icon={CircleDot}
          title="Priorité & publication"
          subtitle="Affichage du message dans les flux et durée de visibilité."
        >
          <FieldRow label="Priorité">
            <div className="grid gap-2.5 sm:grid-cols-3">
              {PRIORITY_TILES.map((tile) => {
                const active = priority === tile.value;
                return (
                  <button
                    key={tile.value}
                    type="button"
                    onClick={() => setPriority(tile.value)}
                    className={`flex flex-col items-start gap-1.5 rounded-2xl border p-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${
                      active
                        ? 'border-slate-900 bg-slate-50 shadow-sm'
                        : 'border-slate-200 bg-white hover:border-slate-300'
                    }`}
                    aria-pressed={active}
                  >
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ring-1 ${tile.badge}`}
                    >
                      {tile.value === 'urgent' ? (
                        <AlertTriangle className="h-3 w-3" />
                      ) : tile.value === 'high' ? (
                        <Megaphone className="h-3 w-3" />
                      ) : (
                        <CircleDot className="h-3 w-3" />
                      )}
                      {tile.label}
                    </span>
                    <span className="text-[11px] leading-snug text-slate-500">{tile.hint}</span>
                  </button>
                );
              })}
            </div>
          </FieldRow>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <FieldRow label="Expire le">
              <div className="space-y-2">
                <div className="flex flex-wrap gap-1.5">
                  {EXPIRY_PRESETS.map((preset) => {
                    const active = activeExpiryPreset === preset.key;
                    return (
                      <button
                        key={preset.key}
                        type="button"
                        onClick={() => {
                          if (preset.addDays === null) {
                            setExpiresAt('');
                            return;
                          }
                          const d = new Date();
                          d.setHours(0, 0, 0, 0);
                          d.setDate(d.getDate() + preset.addDays);
                          setExpiresAt(ymd(d));
                        }}
                        className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition ${
                          active
                            ? 'border-slate-900 bg-slate-900 text-white'
                            : 'border-slate-200 bg-white text-slate-700 hover:border-slate-400'
                        }`}
                      >
                        {preset.label}
                      </button>
                    );
                  })}
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="date"
                    value={expiresAt}
                    onChange={(e) => setExpiresAt(e.target.value)}
                    className="block w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm transition focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  />
                  {expiresAt && (
                    <button
                      type="button"
                      onClick={() => setExpiresAt('')}
                      className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700"
                      aria-label="Retirer la date d'expiration"
                    >
                      <CalendarX className="h-3 w-3" /> Retirer
                    </button>
                  )}
                </div>
                <p className="text-[11px] text-slate-500">
                  Passé cette date, l&apos;annonce reste consultable depuis les archives mais
                  disparaît des flux destinataires.
                </p>
              </div>
            </FieldRow>

            <FieldRow label="Épinglage">
              <label
                className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-3.5 transition ${
                  pinned
                    ? 'border-amber-300 bg-amber-50/60 ring-1 ring-amber-200'
                    : 'border-slate-200 bg-white hover:border-slate-300'
                }`}
              >
                <input
                  type="checkbox"
                  checked={pinned}
                  onChange={(e) => setPinned(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-amber-600 focus:ring-amber-400"
                />
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                    <Pin className="h-3.5 w-3.5 text-amber-600" /> Épingler en haut
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-snug text-slate-500">
                    L&apos;annonce reste en tête des flux des destinataires.
                  </span>
                </span>
              </label>
            </FieldRow>
          </div>
        </Section>

        {/* Bottom action bar */}
        <div className="sticky bottom-4 z-10 flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white/95 px-4 py-3 shadow-lg shadow-slate-900/5 backdrop-blur">
          <div className="flex items-center gap-2 text-[12px] text-slate-600">
            {scopeReady ? (
              previewLoading ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />
                  <span>Estimation des destinataires…</span>
                </>
              ) : preview ? (
                <>
                  <Send className="h-3.5 w-3.5 text-blue-500" />
                  <span>
                    Cible : <b className="text-slate-900">{preview.count}</b> destinataires
                    {preview.count === 0 ? ' — vérifiez la portée' : ''}
                  </span>
                </>
              ) : previewError ? (
                <>
                  <AlertTriangle className="h-3.5 w-3.5 text-rose-500" />
                  <span className="text-rose-700">Estimation indisponible</span>
                </>
              ) : (
                <span className="text-slate-400">Prêt à publier.</span>
              )
            ) : (
              <>
                <Info className="h-3.5 w-3.5 text-slate-400" />
                <span>Sélectionnez l&apos;audience pour continuer.</span>
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={!canSubmit || busy !== null}
              onClick={() => submit(false)}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy === 'draft' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              Enregistrer en brouillon
            </button>
            <button
              type="button"
              disabled={!canSubmit || busy !== null}
              onClick={() => submit(true)}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-indigo-600 via-blue-600 to-blue-700 px-5 py-2 text-sm font-bold text-white shadow-lg shadow-blue-500/30 transition hover:shadow-blue-500/40 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy === 'publish' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              Publier maintenant
            </button>
          </div>
        </div>
      </div>

      {/* Right column — sticky preview */}
      <aside className="lg:col-span-2">
        <div className="sticky top-6 space-y-4">
          <PreviewCard
            title={title}
            body={body}
            priority={priority}
            pinned={pinned}
            audienceLabel={audienceLabel}
            expiresAt={expiresAt}
          />
          <RecipientEstimatePanel
            scope={scope}
            scopeReady={scopeReady}
            loading={previewLoading}
            preview={preview}
            error={previewError}
          />
          <HintsPanel scope={scope} priority={priority} pinned={pinned} />
        </div>
      </aside>
    </form>
  );
}

// ── helpers ────────────────────────────────────────────────────────────────

function Section({
  icon: Icon,
  title,
  subtitle,
  children,
}: {
  icon: typeof Building2;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl bg-white p-5 ring-1 ring-slate-200">
      <header className="flex items-start gap-3">
        <span
          aria-hidden
          className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-700"
        >
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-bold tracking-tight text-slate-900">{title}</h2>
          {subtitle && <p className="mt-0.5 text-[12px] text-slate-500">{subtitle}</p>}
        </div>
      </header>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function FieldRow({
  label,
  required,
  hint,
  hintTone = 'mute',
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  hintTone?: 'mute' | 'warn';
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-bold uppercase tracking-wider text-slate-600">
          {label}
          {required && <span className="ml-0.5 text-rose-500">*</span>}
        </span>
        {hint && (
          <span
            className={`text-[10px] font-semibold tabular-nums ${
              hintTone === 'warn' ? 'text-amber-600' : 'text-slate-400'
            }`}
          >
            {hint}
          </span>
        )}
      </div>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

function PreviewCard({
  title,
  body,
  priority,
  pinned,
  audienceLabel,
  expiresAt,
}: {
  title: string;
  body: string;
  priority: Priority;
  pinned: boolean;
  audienceLabel: string;
  expiresAt: string;
}) {
  const tone =
    priority === 'urgent'
      ? { ring: 'ring-rose-300/80', icon: 'bg-rose-100 text-rose-700', label: 'Urgente', badge: 'bg-rose-100 text-rose-800 ring-rose-200' }
      : priority === 'high'
        ? { ring: 'ring-amber-200', icon: 'bg-amber-100 text-amber-700', label: 'Importante', badge: 'bg-amber-100 text-amber-800 ring-amber-200' }
        : { ring: 'ring-slate-200/70', icon: 'bg-blue-100 text-blue-700', label: 'Normale', badge: 'bg-slate-100 text-slate-700 ring-slate-200' };

  const Icon = priority === 'urgent' ? AlertTriangle : Megaphone;
  const displayTitle = title.trim() || 'Titre de votre annonce';
  const displayBody = body.trim() || 'Le message apparaîtra ici dès que vous commencerez à écrire.';

  return (
    <div className="rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
      <div className="flex items-center justify-between px-4 pt-3 pb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">
        <span>Aperçu destinataire</span>
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-1.5 py-0.5 text-emerald-700 ring-1 ring-emerald-200">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Live
        </span>
      </div>
      <article className={`m-3 mt-0 rounded-2xl bg-white p-4 ring-1 ${tone.ring}`}>
        <div className="flex items-start gap-3">
          <div
            aria-hidden
            className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${tone.icon}`}
          >
            <Icon className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              {pinned && (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-700 ring-1 ring-amber-200">
                  <Pin className="h-3 w-3" /> Épinglée
                </span>
              )}
              {priority !== 'normal' && (
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ring-1 ${tone.badge}`}
                >
                  {tone.label}
                </span>
              )}
              <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-blue-700 ring-1 ring-blue-200">
                Nouveau
              </span>
            </div>

            <h3 className="mt-1.5 text-[15px] font-bold text-slate-900 break-words">
              {displayTitle}
            </h3>

            <p className="mt-1.5 line-clamp-4 text-[13px] leading-relaxed text-slate-600 whitespace-pre-line break-words">
              {displayBody}
            </p>

            <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500">
              <span className="font-medium text-slate-600">{audienceLabel}</span>
              {expiresAt && (
                <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-slate-700">
                  expire le {new Date(`${expiresAt}T00:00:00`).toLocaleDateString('fr-FR', {
                    day: '2-digit',
                    month: 'short',
                  })}
                </span>
              )}
              <span className="ml-auto">À l&apos;instant</span>
            </div>
          </div>
        </div>

        <div className="mt-3 flex items-center justify-end gap-2 border-t border-slate-100 pt-2">
          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-blue-700">
            Lire <ArrowRight className="h-3 w-3" />
          </span>
        </div>
      </article>
    </div>
  );
}

function RecipientEstimatePanel({
  scope,
  scopeReady,
  loading,
  preview,
  error,
}: {
  scope: Scope;
  scopeReady: boolean;
  loading: boolean;
  preview: PreviewResult | null;
  error: string | null;
}) {
  const buckets = [
    { key: 'parents', label: 'Parents', value: preview?.breakdown.parents ?? 0, tone: 'bg-blue-100 text-blue-800' },
    { key: 'teachers', label: 'Enseignants', value: preview?.breakdown.teachers ?? 0, tone: 'bg-emerald-100 text-emerald-800' },
    { key: 'admins', label: 'Admins', value: preview?.breakdown.admins ?? 0, tone: 'bg-violet-100 text-violet-800' },
    { key: 'other', label: 'Autres', value: preview?.breakdown.other ?? 0, tone: 'bg-slate-100 text-slate-700' },
  ];
  const total = preview?.count ?? 0;

  return (
    <div className="rounded-2xl bg-white p-5 ring-1 ring-slate-200">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-bold tracking-tight text-slate-900">Destinataires</h2>
          <p className="mt-0.5 text-[11px] text-slate-500">
            Estimation en direct selon l&apos;audience sélectionnée.
          </p>
        </div>
        {loading && (
          <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-blue-700 ring-1 ring-blue-200">
            <Loader2 className="h-3 w-3 animate-spin" /> Calcul
          </span>
        )}
      </div>

      <div className="mt-3">
        {!scopeReady ? (
          <p className="rounded-xl bg-slate-50 px-3 py-2 text-[12px] text-slate-500 ring-1 ring-slate-200">
            Complétez la portée pour estimer les destinataires.
          </p>
        ) : error ? (
          <p className="rounded-xl bg-rose-50 px-3 py-2 text-[12px] text-rose-700 ring-1 ring-rose-200">
            {error}
          </p>
        ) : (
          <>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold tabular-nums text-slate-900">{total}</span>
              <span className="text-[12px] text-slate-500">
                {scope === 'school_wide' ? 'comptes actifs' : 'comptes ciblés'}
              </span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {buckets.map((b) => (
                <div
                  key={b.key}
                  className="flex items-center justify-between rounded-xl bg-slate-50 px-2.5 py-1.5 ring-1 ring-slate-100"
                >
                  <span className="text-[11px] font-semibold text-slate-600">{b.label}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums ${b.tone}`}
                  >
                    {b.value}
                  </span>
                </div>
              ))}
            </div>
            {total === 0 && (
              <p className="mt-3 flex items-start gap-1.5 rounded-xl bg-amber-50 px-3 py-2 text-[11px] text-amber-800 ring-1 ring-amber-200">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                <span>
                  Aucun destinataire pour cette portée. Vérifiez les inscriptions actives ou
                  choisissez une autre cible.
                </span>
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function HintsPanel({
  scope,
  priority,
  pinned,
}: {
  scope: Scope;
  priority: Priority;
  pinned: boolean;
}) {
  const hints: Array<{ icon: typeof Info; text: string }> = [];
  if (priority === 'urgent') {
    hints.push({
      icon: AlertTriangle,
      text: 'Une notification de sévérité danger sera envoyée aux destinataires.',
    });
  } else if (priority === 'high') {
    hints.push({
      icon: Megaphone,
      text: 'Une notification de sévérité avertissement sera envoyée aux destinataires.',
    });
  }
  if (pinned) {
    hints.push({
      icon: Pin,
      text: 'L’annonce restera affichée en tête des flux jusqu’à expiration.',
    });
  }
  if (scope === 'school_wide') {
    hints.push({
      icon: Building2,
      text: 'La diffusion école entière inclut parents, enseignants et l’équipe administrative.',
    });
  }
  if (hints.length === 0) {
    hints.push({ icon: Sparkles, text: 'Vérifiez le rendu ci-dessus avant la publication.' });
  }

  return (
    <div className="rounded-2xl bg-gradient-to-br from-indigo-50 via-white to-blue-50 p-4 ring-1 ring-blue-100">
      <h2 className="text-[11px] font-bold uppercase tracking-wider text-blue-800">À retenir</h2>
      <ul className="mt-2 space-y-1.5">
        {hints.map((h, i) => {
          const Icon = h.icon;
          return (
            <li key={i} className="flex items-start gap-2 text-[12px] text-slate-700">
              <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-600" />
              <span>{h.text}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

