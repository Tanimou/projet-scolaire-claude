'use client';

import {
  AlertTriangle,
  ArrowRight,
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
  UserCircle2,
  Users,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { createTeacherAnnouncement } from '../actions';

type Scope = 'class_section_scope' | 'grade_level_scope' | 'cycle_scope';
type Priority = 'normal' | 'high' | 'urgent';

export interface TeachableClass {
  id: string;
  name: string;
  gradeLevelName: string;
  cycleName: string;
  cycleColor: string | null;
}

export interface TeachableLevel {
  id: string;
  name: string;
  cycleName: string;
}

export interface TeachableCycle {
  id: string;
  name: string;
  color: string | null;
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
  icon: typeof Users;
}> = [
  {
    value: 'class_section_scope',
    label: 'Une classe',
    hint: 'Les parents des élèves de cette classe',
    icon: Users,
  },
  {
    value: 'grade_level_scope',
    label: 'Un niveau',
    hint: 'Toutes les familles d’un niveau enseigné',
    icon: GraduationCap,
  },
  {
    value: 'cycle_scope',
    label: 'Un cycle',
    hint: 'Toutes les familles du cycle (la plus large)',
    icon: Layers,
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
    iconBg: 'bg-violet-100 text-violet-700',
  },
  {
    value: 'high',
    label: 'Importante',
    hint: 'Mise en avant ambre côté famille',
    badge: 'bg-amber-100 text-amber-800 ring-amber-200',
    ring: 'ring-amber-200',
    iconBg: 'bg-amber-100 text-amber-700',
  },
  {
    value: 'urgent',
    label: 'Urgente',
    hint: 'Notification danger + surlignage rouge',
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

export function TeacherMessageComposer({
  classes,
  levels,
  cycles,
}: {
  classes: TeachableClass[];
  levels: TeachableLevel[];
  cycles: TeachableCycle[];
}) {
  const router = useRouter();

  // Default to the most-precise scope available (class > level > cycle).
  const initialScope: Scope =
    classes.length > 0
      ? 'class_section_scope'
      : levels.length > 0
        ? 'grade_level_scope'
        : 'cycle_scope';

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [scope, setScope] = useState<Scope>(initialScope);
  const [priority, setPriority] = useState<Priority>('normal');
  const [classSectionId, setClassSectionId] = useState(classes[0]?.id ?? '');
  const [gradeLevelId, setGradeLevelId] = useState(levels[0]?.id ?? '');
  const [cycleId, setCycleId] = useState(cycles[0]?.id ?? '');
  const [pinned, setPinned] = useState(false);
  const [expiresAt, setExpiresAt] = useState('');
  const [busy, setBusy] = useState<null | 'draft' | 'publish'>(null);
  const [error, setError] = useState<string | null>(null);

  // Recipient preview state
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // Sort options once for stable selects.
  const sortedClasses = useMemo(
    () =>
      [...classes].sort(
        (a, b) =>
          a.cycleName.localeCompare(b.cycleName) ||
          a.gradeLevelName.localeCompare(b.gradeLevelName) ||
          a.name.localeCompare(b.name),
      ),
    [classes],
  );
  const sortedLevels = useMemo(
    () =>
      [...levels].sort(
        (a, b) => a.cycleName.localeCompare(b.cycleName) || a.name.localeCompare(b.name),
      ),
    [levels],
  );
  const sortedCycles = useMemo(
    () => [...cycles].sort((a, b) => a.name.localeCompare(b.name)),
    [cycles],
  );

  const scopeReady = useMemo(() => {
    switch (scope) {
      case 'class_section_scope':
        return !!classSectionId;
      case 'grade_level_scope':
        return !!gradeLevelId;
      case 'cycle_scope':
        return !!cycleId;
      default:
        return false;
    }
  }, [scope, classSectionId, gradeLevelId, cycleId]);

  // Debounced recipient estimate fetch — skips entirely when scope payload
  // is incomplete so the backend's validateScope() never returns 400 during
  // selection.
  const refreshPreview = useCallback(async () => {
    if (!scopeReady) {
      setPreview(null);
      setPreviewError(null);
      return;
    }
    setPreviewLoading(true);
    setPreviewError(null);
    const params = new URLSearchParams({ scope });
    if (scope === 'class_section_scope') params.set('classSectionId', classSectionId);
    if (scope === 'grade_level_scope') params.set('gradeLevelId', gradeLevelId);
    if (scope === 'cycle_scope') params.set('cycleId', cycleId);
    try {
      const res = await fetch(
        `/api/proxy/v1/announcements/preview-recipients?${params.toString()}`,
        { cache: 'no-store' },
      );
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
  }, [scope, classSectionId, gradeLevelId, cycleId, scopeReady]);

  useEffect(() => {
    const handle = setTimeout(refreshPreview, ESTIMATE_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [refreshPreview]);

  const submit = async (publishNow: boolean) => {
    if (!canSubmit) return;
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
      ...(scope === 'class_section_scope' && classSectionId ? { classSectionId } : {}),
      ...(scope === 'grade_level_scope' && gradeLevelId ? { gradeLevelId } : {}),
      ...(scope === 'cycle_scope' && cycleId ? { cycleId } : {}),
    };
    const res = await createTeacherAnnouncement(payload);
    setBusy(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    router.push('/teacher/messages');
  };

  const titleLen = title.length;
  const bodyLen = body.length;

  const audienceLabel = useMemo(() => {
    if (scope === 'class_section_scope') {
      const c = sortedClasses.find((x) => x.id === classSectionId);
      return c ? `Classe · ${c.name} · ${c.gradeLevelName} · ${c.cycleName}` : 'Choisir une classe';
    }
    if (scope === 'grade_level_scope') {
      const l = sortedLevels.find((x) => x.id === gradeLevelId);
      return l ? `Niveau · ${l.name} · ${l.cycleName}` : 'Choisir un niveau';
    }
    const cy = sortedCycles.find((x) => x.id === cycleId);
    return cy ? `Cycle · ${cy.name}` : 'Choisir un cycle';
  }, [scope, classSectionId, gradeLevelId, cycleId, sortedClasses, sortedLevels, sortedCycles]);

  const canSubmit = title.trim().length > 0 && body.trim().length > 0 && scopeReady;
  const activeExpiryPreset = presetKeyFor(expiresAt);

  // Available scopes — disable tile if the teacher has no eligible targets
  // for that level of breadth.
  const tileAvailability: Record<Scope, boolean> = {
    class_section_scope: sortedClasses.length > 0,
    grade_level_scope: sortedLevels.length > 0,
    cycle_scope: sortedCycles.length > 0,
  };

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
            <div>
              <p className="font-bold">Impossible d&apos;enregistrer ce message</p>
              <p className="mt-0.5">{error}</p>
            </div>
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
                placeholder="Ex : Sortie pédagogique au musée le 15 mai"
                className="block w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm transition focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-100"
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
                placeholder="Détaillez l'évènement, le lieu, l'heure, ce que les élèves doivent prévoir…"
                className="block w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm leading-relaxed text-slate-900 shadow-sm transition focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-100"
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
          subtitle="Choisissez la portée. Le nombre exact de destinataires se met à jour ci-contre."
        >
          <div className="grid gap-2.5 sm:grid-cols-3">
            {SCOPE_TILES.map((tile) => {
              const Icon = tile.icon;
              const active = scope === tile.value;
              const available = tileAvailability[tile.value];
              return (
                <button
                  key={tile.value}
                  type="button"
                  disabled={!available}
                  onClick={() => available && setScope(tile.value)}
                  title={
                    !available
                      ? "Aucune cible disponible pour cette portée — vérifiez vos rattachements de classes."
                      : undefined
                  }
                  className={`group flex items-start gap-3 rounded-2xl border p-3.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 ${
                    !available
                      ? 'cursor-not-allowed border-slate-200 bg-slate-50/60 opacity-60'
                      : active
                        ? 'border-violet-500 bg-gradient-to-br from-violet-50 via-white to-indigo-50 shadow-sm ring-1 ring-violet-200'
                        : 'border-slate-200 bg-white hover:border-violet-300 hover:bg-slate-50'
                  }`}
                  aria-pressed={active}
                >
                  <span
                    aria-hidden
                    className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${
                      active
                        ? 'bg-violet-600 text-white shadow-sm shadow-violet-300/60'
                        : 'bg-slate-100 text-slate-600 group-hover:bg-violet-100 group-hover:text-violet-700'
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-slate-900">
                      {tile.label}
                    </span>
                    <span className="mt-0.5 block text-[11px] leading-snug text-slate-500">
                      {tile.hint}
                    </span>
                  </span>
                  {active && (
                    <span
                      aria-hidden
                      className="ml-auto grid h-5 w-5 place-items-center rounded-full bg-violet-600 text-white"
                    >
                      <Check className="h-3 w-3" />
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {scope === 'class_section_scope' && (
            <div className="mt-4">
              <FieldRow label="Classe enseignée" required>
                <select
                  value={classSectionId}
                  onChange={(e) => setClassSectionId(e.target.value)}
                  required
                  className="block w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm transition focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-100"
                >
                  <option value="">— Choisir une classe —</option>
                  {sortedClasses.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} · {c.gradeLevelName} · {c.cycleName}
                    </option>
                  ))}
                </select>
              </FieldRow>
            </div>
          )}

          {scope === 'grade_level_scope' && (
            <div className="mt-4">
              <FieldRow label="Niveau enseigné" required>
                <select
                  value={gradeLevelId}
                  onChange={(e) => setGradeLevelId(e.target.value)}
                  required
                  className="block w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm transition focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-100"
                >
                  <option value="">— Choisir un niveau —</option>
                  {sortedLevels.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name} · {l.cycleName}
                    </option>
                  ))}
                </select>
              </FieldRow>
            </div>
          )}

          {scope === 'cycle_scope' && (
            <div className="mt-4">
              <FieldRow label="Cycle enseigné" required>
                <select
                  value={cycleId}
                  onChange={(e) => setCycleId(e.target.value)}
                  required
                  className="block w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm transition focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-100"
                >
                  <option value="">— Choisir un cycle —</option>
                  {sortedCycles.map((cy) => (
                    <option key={cy.id} value={cy.id}>
                      {cy.name}
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
                    className={`flex flex-col items-start gap-1.5 rounded-2xl border p-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 ${
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
                    className="block w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm transition focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-100"
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
                  Passé cette date, le message reste consultable depuis les archives mais
                  disparaît du flux des familles.
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
                    Le message reste en tête du flux des familles ciblées.
                  </span>
                </span>
              </label>
            </FieldRow>
          </div>
        </Section>

        {/* Bottom action bar */}
        <div className="sticky bottom-4 z-10 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white/95 px-4 py-3 shadow-lg shadow-slate-900/5 backdrop-blur">
          <div className="flex min-w-0 items-center gap-2 text-[12px] text-slate-600">
            {scopeReady ? (
              previewLoading ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-violet-500" />
                  <span>Estimation des destinataires…</span>
                </>
              ) : preview ? (
                <>
                  <Send className="h-3.5 w-3.5 text-violet-500" />
                  <span className="truncate">
                    Cible : <b className="text-slate-900 tabular-nums">{preview.count}</b>{' '}
                    destinataire{preview.count > 1 ? 's' : ''}
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
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-violet-600 via-indigo-600 to-blue-600 px-5 py-2 text-sm font-bold text-white shadow-lg shadow-indigo-500/30 transition hover:shadow-indigo-500/40 disabled:cursor-not-allowed disabled:opacity-60"
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
            loading={previewLoading}
            preview={preview}
            scopeReady={scopeReady}
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
  icon: typeof Users;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl bg-white p-5 ring-1 ring-slate-200">
      <header className="flex items-start gap-3">
        <span
          aria-hidden
          className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-violet-50 text-violet-700"
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
      ? {
          ring: 'ring-rose-300/80',
          icon: 'bg-rose-100 text-rose-700',
          label: 'Urgente',
          badge: 'bg-rose-100 text-rose-800 ring-rose-200',
        }
      : priority === 'high'
        ? {
            ring: 'ring-amber-200',
            icon: 'bg-amber-100 text-amber-700',
            label: 'Importante',
            badge: 'bg-amber-100 text-amber-800 ring-amber-200',
          }
        : {
            ring: 'ring-slate-200/70',
            icon: 'bg-violet-100 text-violet-700',
            label: 'Normale',
            badge: 'bg-slate-100 text-slate-700 ring-slate-200',
          };

  const Icon = priority === 'urgent' ? AlertTriangle : Megaphone;
  const displayTitle = title.trim() || 'Titre de votre message';
  const displayBody =
    body.trim() || 'Le message apparaîtra ici dès que vous commencerez à écrire.';

  return (
    <div className="rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
      <div className="flex items-center justify-between px-4 pt-3 pb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">
        <span>Aperçu côté famille</span>
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
              <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-violet-700 ring-1 ring-violet-200">
                <UserCircle2 className="h-3 w-3" /> Enseignant
              </span>
            </div>

            <h3 className="mt-1.5 break-words text-[15px] font-bold text-slate-900">
              {displayTitle}
            </h3>

            <p className="mt-1.5 line-clamp-4 whitespace-pre-line break-words text-[13px] leading-relaxed text-slate-600">
              {displayBody}
            </p>

            <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500">
              <span className="font-medium text-slate-600">{audienceLabel}</span>
              {expiresAt && (
                <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-slate-700">
                  expire le{' '}
                  {new Date(`${expiresAt}T00:00:00`).toLocaleDateString('fr-FR', {
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
          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-violet-700">
            Lire <ArrowRight className="h-3 w-3" />
          </span>
        </div>
      </article>
    </div>
  );
}

function RecipientEstimatePanel({
  loading,
  preview,
  scopeReady,
  error,
}: {
  loading: boolean;
  preview: PreviewResult | null;
  scopeReady: boolean;
  error: string | null;
}) {
  const buckets = [
    {
      key: 'parents',
      label: 'Parents',
      value: preview?.breakdown.parents ?? 0,
      tone: 'bg-blue-100 text-blue-800',
    },
    {
      key: 'teachers',
      label: 'Enseignants',
      value: preview?.breakdown.teachers ?? 0,
      tone: 'bg-emerald-100 text-emerald-800',
    },
    {
      key: 'admins',
      label: 'Admins',
      value: preview?.breakdown.admins ?? 0,
      tone: 'bg-violet-100 text-violet-800',
    },
    {
      key: 'other',
      label: 'Autres',
      value: preview?.breakdown.other ?? 0,
      tone: 'bg-slate-100 text-slate-700',
    },
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
          <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-violet-700 ring-1 ring-violet-200">
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
              <span className="text-[12px] text-slate-500">comptes ciblés</span>
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
      text: 'Une notification de sévérité danger sera envoyée aux familles destinataires.',
    });
  } else if (priority === 'high') {
    hints.push({
      icon: Megaphone,
      text: 'Une notification de sévérité avertissement sera envoyée aux familles destinataires.',
    });
  }
  if (pinned) {
    hints.push({
      icon: Pin,
      text: 'Le message restera en tête du flux des familles jusqu’à expiration.',
    });
  }
  if (scope === 'cycle_scope') {
    hints.push({
      icon: Layers,
      text: 'Diffusion cycle : toutes les familles du cycle recevront ce message.',
    });
  } else if (scope === 'grade_level_scope') {
    hints.push({
      icon: GraduationCap,
      text: 'Diffusion niveau : toutes les classes de ce niveau sont incluses.',
    });
  } else {
    hints.push({
      icon: Users,
      text: 'Seules les familles de la classe sélectionnée recevront ce message.',
    });
  }
  if (hints.length === 1) {
    hints.push({ icon: Sparkles, text: 'Vérifiez le rendu ci-dessus avant la publication.' });
  }

  return (
    <div className="rounded-2xl bg-gradient-to-br from-violet-50 via-white to-indigo-50 p-4 ring-1 ring-violet-100">
      <h2 className="text-[11px] font-bold uppercase tracking-wider text-violet-800">
        À retenir
      </h2>
      <ul className="mt-2 space-y-1.5">
        {hints.map((h, i) => {
          const Icon = h.icon;
          return (
            <li key={i} className="flex items-start gap-2 text-[12px] text-slate-700">
              <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-600" />
              <span>{h.text}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
