/**
 * L'état d'une carte KPI d'audit — **module neutre, sans `'use client'`**.
 *
 * Pourquoi ce fichier existe (PF-139, AC-9). `page.tsx` avalait toute `ApiError`
 * en `null` puis fabriquait `{ today: 0, criticalChanges: 0, sensitiveExports: 0 }`.
 * Une panne d'analytique rendait donc **trois zéros mesurés d'apparence** sur une
 * surface de gouvernance, et le tableau annonçait « Aucune entrée ne correspond à
 * vos filtres » — une affirmation, pas une absence. Avec la carte
 * « Connexions admin » retirée, le seul témoin honnête de cette rangée
 * disparaissait aussi : la panne serait devenue **quatre** zéros confiants.
 *
 * Trois états, jamais confondus :
 *
 * | État               | D'où il vient                          | Valeur rendue      |
 * |--------------------|----------------------------------------|--------------------|
 * | `measured`         | l'API a répondu, la valeur est un nombre | le chiffre         |
 * | `not-instrumented` | l'API a répondu, la valeur est `null`  | « Non instrumenté » |
 * | `unavailable`      | l'API **n'a pas répondu**              | « — » + « Indisponible » |
 *
 * Un `0` mesuré (un filtre qui ne matche rien) est un état `measured` et doit
 * rester **visuellement indiscernable** de n'importe quelle autre valeur
 * mesurée : c'est une vérité, pas un échec.
 *
 * La dérivation vit ici, exportée et pure, précisément pour être testable sans
 * moteur de rendu : `apps/web` n'a pas de runner de tests unitaires de
 * composants (PF-135), donc une règle qui ne serait vérifiable qu'à l'écran ne
 * serait pas vérifiée du tout (DNC-08).
 */

/** Les quatre clés servies par `/api/v1/analytics/audit`. */
export type AuditKpiKey =
  | 'eventsInRange'
  | 'criticalChanges'
  | 'sensitiveExports'
  | 'distinctActors';

/** L'enveloppe servie par l'API pour un KPI. `value: null` = non instrumenté. */
export interface AuditKpiPayload {
  value: number | null;
  /** Sur quelle population la valeur a été calculée. Servie, jamais devinée. */
  scope: 'filtered';
  /** Le titre de la carte, servi **avec** le chiffre pour qu'ils ne dérivent pas. */
  label: string;
}

/** L'écho des filtres réellement appliqués, dont le fuseau **résolu**. */
export interface AuditAppliedFilters {
  /** Fuseau de l'établissement, résolu côté serveur. Jamais fourni par le client. */
  timezone: string;
  from: string | null;
  to: string | null;
  actorId?: string | null;
  action?: string | null;
  resourceType?: string | null;
  portal?: string | null;
}

export type AuditKpiStateKind = 'measured' | 'not-instrumented' | 'unavailable';

export interface AuditKpiState {
  kind: AuditKpiStateKind;
  /** Ce que la carte affiche dans la fente valeur. Jamais un `0` fabriqué. */
  display: number | string;
  /** Le titre de la carte. */
  label: string;
  /** La phrase de portée, complète, toujours rendue. */
  scope: string;
  /** La note définitionnelle (quel prédicat), ou `null`. */
  note: string | null;
}

/** La valeur affichée quand la mesure n'a pas pu être lue. Jamais « 0 ». */
export const KPI_UNAVAILABLE_DISPLAY = '—';
export const KPI_UNAVAILABLE_LABEL_SUFFIX = 'Indisponible';
export const KPI_UNAVAILABLE_SCOPE =
  'Indisponible — la mesure n’a pas pu être lue. Le chiffre affiché serait une invention.';
export const KPI_NOT_INSTRUMENTED_DISPLAY = 'Non instrumenté';
export const KPI_NOT_INSTRUMENTED_SCOPE =
  'Aucun site d’écriture n’émet cette action : aucune valeur ne peut être affirmée.';

const MONTHS_FR = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre',
];

/**
 * `2026-08-09` → « 9 août 2026 ».
 *
 * Découpe la chaîne civile ; **jamais** `new Date(ymd)`, qui parse en UTC puis
 * rend dans le fuseau du navigateur — la classe de bug exacte que cette tranche
 * supprime côté serveur. Une chaîne malformée est rendue **verbatim** (DNC-08) :
 * on n'invente pas une date pour faire joli.
 */
export function formatAuditDayFr(ymd: string | null | undefined): string | null {
  if (!ymd) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return ymd;
  const month = MONTHS_FR[Number(m[2]) - 1];
  if (!month) return ymd;
  const day = Number(m[3]);
  return `${day === 1 ? '1er' : day} ${month} ${m[1]}`;
}

/**
 * La fenêtre réellement appliquée, en français, **dérivée de l'écho serveur**.
 *
 * Aucun mot n'est codé en dur à propos d'une période que le serveur n'a pas
 * confirmée : sans `from` ni `to`, la phrase dit « depuis l'origine » plutôt que
 * de laisser un titre promettre une période inexistante (P2-14). Le fuseau
 * affiché est celui **résolu par le serveur**, jamais
 * `Intl.DateTimeFormat().resolvedOptions().timeZone` — le fuseau du navigateur
 * serait le même mensonge, déplacé sur le client.
 */
export function describeAuditWindow(filters: AuditAppliedFilters): string {
  const from = formatAuditDayFr(filters.from);
  const to = formatAuditDayFr(filters.to);
  const zone = `fuseau ${filters.timezone}`;
  if (from && to) return `du ${from} au ${to} inclus · ${zone}`;
  if (from) return `depuis le ${from} · ${zone}`;
  if (to) return `jusqu’au ${to} inclus · ${zone}`;
  return `depuis l’origine · ${zone}`;
}

/** `scope` servi → français. Le serveur reste la source de l'information. */
function scopeSentence(scope: string): string {
  return scope === 'filtered' ? 'filtre courant' : scope;
}

/**
 * Dérive l'état d'une carte.
 *
 * `responseMissing` est **distinct** de `payload.value === null` : la première
 * dit « nous n'avons pas pu lire », la seconde dit « nous avons lu, et il n'y a
 * rien à lire ». Les confondre est le défaut PF-139.
 *
 * Une clé absente d'une réponse pourtant reçue n'est pas traitée comme `0` non
 * plus : c'est une rupture de contrat (P0-1), donc `unavailable`. Une carte
 * vide et muette est le pire des trois.
 */
export function resolveAuditKpiState(input: {
  responseMissing: boolean;
  payload: AuditKpiPayload | null | undefined;
  /** Titre de repli, utilisé **uniquement** quand aucune charge utile n'existe. */
  fallbackLabel: string;
  filters: AuditAppliedFilters;
  note?: string | null;
}): AuditKpiState {
  const { responseMissing, payload, fallbackLabel, filters, note = null } = input;

  if (responseMissing || !payload) {
    return {
      kind: 'unavailable',
      display: KPI_UNAVAILABLE_DISPLAY,
      label: payload?.label ?? fallbackLabel,
      scope: KPI_UNAVAILABLE_SCOPE,
      note,
    };
  }

  const label = payload.label || fallbackLabel;
  const window = describeAuditWindow(filters);

  if (typeof payload.value !== 'number' || !Number.isFinite(payload.value)) {
    return {
      kind: 'not-instrumented',
      display: KPI_NOT_INSTRUMENTED_DISPLAY,
      label,
      scope: KPI_NOT_INSTRUMENTED_SCOPE,
      note,
    };
  }

  return {
    kind: 'measured',
    display: payload.value,
    label,
    scope: `Portée : ${scopeSentence(payload.scope)} · ${window}`,
    note,
  };
}
