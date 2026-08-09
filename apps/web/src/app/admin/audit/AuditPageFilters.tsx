'use client';

import { FilterBar, SearchInput, SelectFilter, type SelectOption } from '@pilotage/ui';
import { CalendarRange, Globe, RotateCcw, X } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';


import { formatAuditDayFr } from './audit-kpi-state';
import {
  auditVocabularyMarker,
  classifyAuditPortalFilterValue,
  classifyAuditResourceType,
  isAuditPortalNone,
} from './audit-labels';

/**
 * Puce de filtre actif : le marqueur y est une **parenthèse**, pas une puce
 * imbriquée — une puce dans une puce est illisible à 320 px et redondante à
 * la lecture d'écran.
 */
function withVocabularyNote(label: string, vocabulary: 'canonical' | 'legacy' | 'unknown'): string {
  const marker = auditVocabularyMarker(vocabulary);
  return marker ? `${label} (${marker.toLowerCase()})` : label;
}

export interface AuditPageFiltersProps {
  initialQ: string;
  initialResourceType: string;
  initialPortal: string;
  initialActorId: string;
  initialFrom: string;
  initialTo: string;
  resourceTypeOptions: SelectOption[];
  portalOptions: SelectOption[];
  actorOptions: SelectOption[];
  /**
   * Le fuseau **résolu par le serveur** depuis `Tenant.timezone`, tel qu'il est
   * renvoyé dans `filters.timezone`. Jamais
   * `Intl.DateTimeFormat().resolvedOptions().timeZone` : le fuseau du navigateur
   * est le même mensonge déplacé sur le client, et il ferait contredire la
   * mention par le chiffre qu'elle explique.
   *
   * `null` quand l'appel n'a pas abouti : le fuseau n'est alors **pas résolu**,
   * et la page le dit au lieu d'en supposer un.
   */
  timezone: string | null;
  /**
   * « Aujourd'hui » **dans le fuseau de l'établissement**, calculé côté serveur
   * pour que le rendu SSR et l'hydratation ne puissent pas diverger autour de
   * minuit. Sert de borne `max` aux deux champs de date. `null` quand le fuseau
   * n'a pas pu être résolu.
   */
  tenantToday: string | null;
}

export function AuditPageFilters({
  initialQ,
  initialResourceType,
  initialPortal,
  initialActorId,
  initialFrom,
  initialTo,
  resourceTypeOptions,
  portalOptions,
  actorOptions,
  timezone,
  tenantToday,
}: AuditPageFiltersProps) {
  const router = useRouter();
  const params = useSearchParams();
  const [isPending, startTransition] = useTransition();

  function update(patch: Record<string, string | undefined>) {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    next.delete('page');
    startTransition(() => {
      router.push(`/admin/audit?${next.toString()}`);
    });
  }

  function clearAll() {
    startTransition(() => {
      router.push(`/admin/audit`);
    });
  }

  const hasActiveFilters =
    !!initialQ ||
    !!initialResourceType ||
    !!initialPortal ||
    !!initialActorId ||
    !!initialFrom ||
    !!initialTo;

  // Une plage inversée renvoyait un tableau vide **sans rien dire** : l'écran
  // affirmait « aucune entrée ne correspond » là où la question était mal posée.
  const rangeInverted = !!initialFrom && !!initialTo && initialFrom > initialTo;

  const portalChip = isAuditPortalNone(initialPortal)
    ? 'Portail : sans portail'
    : `Portail : ${withVocabularyNote(
        classifyAuditPortalFilterValue(initialPortal).label,
        classifyAuditPortalFilterValue(initialPortal).vocabulary,
      )}`;

  return (
    <div className="space-y-3">
      <FilterBar
        search={
          /* « login » enseignait un vocabulaire qui n'existe pas : aucun site
             d'écriture n'émet d'action de connexion (mesuré, S-E04-4). */
          <SearchInput
            placeholder="Rechercher une action (export, import, publish…)"
            value={initialQ}
            onChange={(v) => update({ action: v || undefined })}
          />
        }
        filters={
          <>
            <SelectFilter
              options={resourceTypeOptions}
              value={initialResourceType}
              onChange={(v) => update({ resourceType: v || undefined })}
              placeholder="Toutes les ressources"
              clearable
              clearLabel="Toutes les ressources"
              fullWidth={false}
            />
            <SelectFilter
              options={portalOptions}
              value={initialPortal}
              onChange={(v) => update({ portal: v || undefined })}
              placeholder="Tous les portails"
              clearable
              clearLabel="Tous les portails"
              fullWidth={false}
            />
            <SelectFilter
              options={actorOptions}
              value={initialActorId}
              onChange={(v) => update({ actorId: v || undefined })}
              placeholder="Tous les utilisateurs"
              clearable
              clearLabel="Tous les utilisateurs"
              fullWidth={false}
            />
            {isPending && (
              <span className="text-[11px] text-slate-500" aria-live="polite">
                Mise à jour des indicateurs et du tableau…
              </span>
            )}
          </>
        }
        primaryAction={
          hasActiveFilters ? (
            <button
              type="button"
              onClick={clearAll}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Réinitialiser
            </button>
          ) : null
        }
      />

      <div className="flex flex-wrap items-end gap-3 rounded-2xl bg-white p-3 shadow-sm ring-1 ring-slate-200/60">
        <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500">
          <CalendarRange className="h-3.5 w-3.5" />
          Période
        </div>
        <label className="flex flex-col text-[11px] font-medium text-slate-500">
          <span className="mb-1">Du</span>
          <input
            type="date"
            value={initialFrom}
            max={initialTo || tenantToday || undefined}
            onChange={(e) => update({ from: e.target.value || undefined })}
            className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 transition focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-400/30"
          />
        </label>
        <label className="flex flex-col text-[11px] font-medium text-slate-500">
          {/* Le libellé dit maintenant ce que la borne fait : côté serveur elle
              est devenue exclusive au **lendemain** du jour choisi, donc la
              journée entière est comptée. Sans cette mention, un DPO lit « au
              9 août » et suppose 00:00. */}
          <span className="mb-1">Au (inclus)</span>
          <input
            type="date"
            value={initialTo}
            min={initialFrom || undefined}
            max={tenantToday ?? undefined}
            aria-describedby="audit-to-hint"
            onChange={(e) => update({ to: e.target.value || undefined })}
            className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 transition focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-400/30"
          />
          <span id="audit-to-hint" className="mt-1 text-[11px] font-normal text-slate-600">
            La journée sélectionnée est comptée entière, jusqu’à 23:59:59.
          </span>
        </label>
        {/* Sans fuseau résolu, les raccourcis ne sont pas rendus : « Aujourd'hui »
            calculé dans un fuseau inconnu est exactement la supposition que
            cette tranche supprime. Ils reviennent dès que le service répond. */}
        {timezone && (
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            <QuickRangeButton label="Aujourd'hui" days={0} timeZone={timezone} onPick={update} />
            <QuickRangeButton label="7 j" days={7} timeZone={timezone} onPick={update} />
            <QuickRangeButton label="30 j" days={30} timeZone={timezone} onPick={update} />
            <QuickRangeButton label="90 j" days={90} timeZone={timezone} onPick={update} />
          </div>
        )}
        <p className="basis-full text-right text-[11px] text-slate-600">
          <span className="inline-flex items-center gap-1">
            <Globe className="h-3.5 w-3.5" aria-hidden />
            {timezone
              ? `Fuseau de l’établissement : ${timezone}`
              : 'Fuseau de l’établissement : non résolu — le service n’a pas répondu.'}
          </span>
        </p>
      </div>

      {rangeInverted && (
        <p className="text-xs text-rose-700" aria-live="polite">
          La date de début est postérieure à la date de fin : aucune période n’est sélectionnée.
        </p>
      )}

      {hasActiveFilters && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <span className="font-semibold uppercase tracking-wider">Filtres actifs :</span>
          {initialQ && (
            <FilterChip label={`Action : "${initialQ}"`} onClear={() => update({ action: undefined })} />
          )}
          {initialResourceType && (
            <FilterChip
              label={`Ressource : ${withVocabularyNote(
                classifyAuditResourceType(initialResourceType).label,
                classifyAuditResourceType(initialResourceType).vocabulary,
              )}`}
              onClear={() => update({ resourceType: undefined })}
            />
          )}
          {initialPortal && (
            <FilterChip label={portalChip} onClear={() => update({ portal: undefined })} />
          )}
          {initialActorId && (
            <FilterChip
              label={`Utilisateur : ${actorOptions.find((o) => o.value === initialActorId)?.label ?? '—'}`}
              onClear={() => update({ actorId: undefined })}
            />
          )}
          {/* Une date ISO brute est une sortie machine sur une page destinée à
              un DPO. Le formatage est **pur** (découpe de la chaîne civile),
              jamais `new Date(ymd)` — qui reparse en UTC et peut reculer d'un
              jour selon le fuseau du navigateur. */}
          {initialFrom && (
            <FilterChip
              label={`Depuis le ${formatAuditDayFr(initialFrom) ?? initialFrom}`}
              onClear={() => update({ from: undefined })}
            />
          )}
          {initialTo && (
            <FilterChip
              label={`Jusqu'au ${formatAuditDayFr(initialTo) ?? initialTo} inclus`}
              onClear={() => update({ to: undefined })}
            />
          )}
        </div>
      )}
    </div>
  );
}

/**
 * `new Date().toISOString().slice(0, 10)` était le **jour UTC du navigateur** —
 * la moitié cliente du défaut que cette tranche corrige côté serveur. À 01:00 à
 * Paris le 9 août, « Aujourd'hui » posait `from=to=2026-08-08` : le contrôle le
 * plus cliqué de la page interrogeait la veille.
 *
 * Le jour est désormais lu dans le **fuseau de l'établissement** (`en-CA` rend
 * `YYYY-MM-DD`), et le recul de N jours se fait en arithmétique de date civile
 * via `Date.UTC` — un axe sans heure d'été, donc « il y a 7 jours » reste sept
 * dates calendaires même autour d'un changement d'heure.
 *
 * Le calcul se fait **dans le gestionnaire de clic**, pas au rendu : une valeur
 * dérivée de l'horloge pendant le rendu diverge entre SSR et hydratation.
 */
function QuickRangeButton({
  label,
  days,
  timeZone,
  onPick,
}: {
  label: string;
  days: number;
  timeZone: string;
  onPick: (patch: Record<string, string | undefined>) => void;
}) {
  function apply() {
    const to = tenantDay(new Date(), timeZone);
    const parts = to.split('-').map(Number);
    const y = parts[0] ?? 0;
    const m = parts[1] ?? 1;
    const d = parts[2] ?? 1;
    const from = new Date(Date.UTC(y, m - 1, d) - days * 86_400_000).toISOString().slice(0, 10);
    onPick({ from, to });
  }
  return (
    <button
      type="button"
      onClick={apply}
      className="inline-flex min-h-[28px] items-center rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-600 transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/40"
    >
      {label}
    </button>
  );
}

/**
 * La date civile de `instant` dans `timeZone`, au format `YYYY-MM-DD`.
 *
 * Un fuseau irrésolvable **n'est pas avalé** : `Intl` lève, et laisser cette
 * exception remonter est le comportement voulu (DNC-08). Un repli silencieux
 * sur le fuseau du navigateur rendrait le bouton faux sans que personne le
 * sache — exactement le défaut d'origine.
 */
function tenantDay(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

function FilterChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 py-1 pl-2.5 pr-1 text-[11px] font-medium text-blue-700 ring-1 ring-blue-200">
      {label}
      {/* 16 × 16 px échouait à SC 2.5.8 (24 × 24) sans relever d'aucune
          exception : la cible passe à 24 px, l'icône ne bouge pas. */}
      <button
        type="button"
        onClick={onClear}
        className="inline-flex h-6 w-6 items-center justify-center rounded-full transition hover:bg-blue-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/40"
        aria-label={`Retirer le filtre ${label}`}
      >
        <X className="h-3 w-3" aria-hidden />
      </button>
    </span>
  );
}
