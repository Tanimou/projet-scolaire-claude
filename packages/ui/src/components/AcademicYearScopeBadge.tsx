import { cva, type VariantProps } from 'class-variance-authority';
import {
  AlertOctagon,
  CalendarCheck2,
  CalendarClock,
  CalendarOff,
  CalendarX2,
  History,
  Hourglass,
} from 'lucide-react';
import type { ComponentType, ReactNode } from 'react';

import { cn } from '../lib/cn';
import { formatDateLong, formatInt } from '../lib/format';

import { StatusBadge, type StatusTone } from './StatusBadge';

/**
 * La forme d'une portée d'année scolaire TELLE QU'ELLE ARRIVE SUR LE FIL.
 *
 * Structurellement compatible avec `AcademicYearScope` de `@pilotage/contracts`, et
 * délibérément NON importée depuis lui : `packages/ui` ne gagne aucune dépendance
 * (patron `EnrollmentStatusBadge` / `MfaStatusBadge`). Un appelant passe son objet de
 * contrat directement ; TypeScript le vérifie structurellement au site d'appel.
 *
 * `startDate` / `endDate` sont typés `string | Date` et JAMAIS `Date` seul. C'est
 * load-bearing : côté serveur Nest tient des `Date`, mais ce qui traverse HTTP est une
 * CHAÎNE ISO. Un type qui n'admettrait que `Date` compilerait au vert et jetterait
 * `x.getTime is not a function` à l'exécution, sur chaque requête — les deux pages
 * cibles sont `force-dynamic`, donc l'erreur ne serait pas attrapée au build.
 * `formatDateLong` accepte les deux et normalise.
 */
export interface AcademicYearScopeInput {
  id: string;
  name: string;
  startDate: string | Date;
  endDate: string | Date;
  status: string;
  /** `true` ⇔ aucune année active : repli sur la plus récente, quel que soit son statut. */
  viaFallback: boolean;
  /** `startDate <= aujourd'hui <= endDate`, inclusif aux deux bornes. */
  containsReferenceDate: boolean;
  /** `endDate < aujourd'hui`. Voir `academicYearScopeState` pour le cas `staleByDays === 0`. */
  isStale: boolean;
  /** Jours PLEINS écoulés depuis `endDate`. `0` quand non vétuste — ou le dernier jour. */
  staleByDays: number;
  /** Années ACTIVES vues par la requête primaire. `> 1` prouve que l'invariant a sauté. */
  activeCount: number;
}

/**
 * Le vocabulaire canonique d'une portée d'année — SIX états, pas deux.
 *
 * - `current`     — l'année contient aujourd'hui. Le cas nominal.
 * - `last_day`    — l'année se termine AUJOURD'HUI. Voir le docblock ci-dessous : ce
 *                   n'est pas un raffinement cosmétique, c'est le seul état qui empêche
 *                   le badge d'écrire « terminée il y a 0 jours ».
 * - `stale`       — l'année est terminée depuis au moins un jour plein.
 * - `outside`     — l'année n'a PAS encore commencé (activée en avance). Sans cet état
 *                   le badge laisserait tomber `containsReferenceDate`, c'est-à-dire
 *                   qu'il recommettrait, une couche plus haut, le défaut même que cette
 *                   tranche ferme : un champ résolu puis jeté.
 * - `none`        — l'API a résolu et dit : aucune année active. C'est un FAIT métier.
 * - `unavailable` — le champ est ABSENT. Ce n'est pas un fait métier, et ça ne se peint
 *                   pas comme un. Voir `academicYearScopeState`.
 */
export type AcademicYearScopeState =
  | 'current'
  | 'last_day'
  | 'stale'
  | 'outside'
  | 'none'
  | 'unavailable';

/**
 * L'ordre de dérivation, TOTAL et énoncé une seule fois. Aucune surface ne re-décide.
 *
 * ## Pourquoi `undefined` et `null` ne sont pas le même état
 *
 * `null` est une RÉPONSE : l'API a résolu et n'a trouvé aucune année active. C'est un
 * fait de domaine, avec une suite administrative — il mérite d'être peint.
 *
 * `undefined` est une ABSENCE DE CHAMP. Elle se produit dans la fenêtre de déploiement
 * glissant (web neuf, api ancienne : `web` et `api` sont deux services compose
 * distincts), et chez tout appelant pas encore converti. Les faire converger sur `none`
 * peindrait « Aucune année active » — un échec de lecture rendu comme un fait métier,
 * exactement l'erreur que `EnrollmentStatusBadge` a déjà nommée et fermée.
 *
 * ## Pourquoi `last_day` existe
 *
 * `startDate`/`endDate` sont des colonnes `@db.Date`, donc minuit UTC, et le résolveur
 * compare à un instant mur. Le 5 juillet 2026 à 00:00:01Z, une année qui finit le
 * 5 juillet 2026 rend déjà `isStale: true` avec `staleByDays: 0`. Tant que les deux
 * seuls consommateurs étaient des `logger.warn`, c'était du bruit de journal. Cette
 * tranche promeut ce calcul à un BADGE sur deux portails : sans `last_day`, le badge
 * annoncerait « terminée il y a 0 jours » à propos d'une année qui se termine ce jour
 * même — une contre-vérité affichée, produite par la tranche censée dire la vérité sur
 * la portée. Le résolveur n'est pas touché (il reste juste sur son propre prédicat) ;
 * c'est le rendu qui refuse de sur-affirmer.
 */
export function academicYearScopeState(
  year: AcademicYearScopeInput | null | undefined,
): AcademicYearScopeState {
  if (year === undefined) return 'unavailable';
  if (year === null) return 'none';
  if (year.isStale) return year.staleByDays <= 0 ? 'last_day' : 'stale';
  if (!year.containsReferenceDate) return 'outside';
  return 'current';
}

interface StatePresentation {
  icon: ComponentType<{ className?: string }>;
  tone: StatusTone;
}

/**
 * UNE table, une fois. Les icônes sont quatre FORMES distinctes et non quatre pastilles
 * de la même forme en quatre couleurs : une capture en niveaux de gris sépare encore les
 * états (WCAG 1.4.1). Le libellé porte de toute façon le sens en entier.
 *
 * `stale` est AMBRE, jamais rouge. Les chiffres de la page sont réels et lisibles ; ils
 * sont seulement vieux. Le rouge se lirait « donnée cassée » et fabriquerait précisément
 * la divergence que DNC-01 interdit. `none` est ambre parce que c'est le seul état avec
 * une suite administrative. `unavailable` est neutre — un échec de lecture n'est pas un
 * fait de domaine et ne mérite ni vert ni ambre.
 */
const STATE_PRESENTATION: Record<AcademicYearScopeState, StatePresentation> = {
  current: { icon: CalendarCheck2, tone: 'success' },
  last_day: { icon: Hourglass, tone: 'sky' },
  stale: { icon: CalendarX2, tone: 'warning' },
  outside: { icon: CalendarClock, tone: 'sky' },
  none: { icon: CalendarOff, tone: 'warning' },
  unavailable: { icon: AlertOctagon, tone: 'neutral' },
};

/**
 * Les hex EFFECTIVEMENT peints par les classes Tailwind que `StatusBadge` applique aux
 * tons ci-dessus, plus l'encre de la phrase de portée.
 *
 * Exporté pour que le contraste soit une DONNÉE ÉNUMÉRABLE et non une affirmation de
 * docblock : une spec peut marcher cette table avec `contrastRatio` / `WCAG_AA_NORMAL_TEXT`
 * au lieu de recopier cinq assertions à la main — et une paire ajoutée ici est couverte
 * sans que personne ait à s'en souvenir. Mesuré : emerald 4.84 · amber 4.51 · sky 5.17 ·
 * slate 9.45 · phrase `slate-600` sur blanc 7.58. Tous ≥ 4.5.
 *
 * ⚠ `text-slate-400` sur blanc = 2.56 : il ÉCHOUE. Ne jamais y descendre la phrase.
 */
export const ACADEMIC_YEAR_SCOPE_TONE_HEXES: Record<
  StatusTone | 'scopeSentence',
  { fg: string; bg: string }
> = {
  success: { fg: '#047857', bg: '#D1FAE5' },
  warning: { fg: '#B45309', bg: '#FEF3C7' },
  sky: { fg: '#0369A1', bg: '#E0F2FE' },
  neutral: { fg: '#334155', bg: '#F1F5F9' },
  danger: { fg: '#BE123C', bg: '#FFE4E6' },
  info: { fg: '#1D4ED8', bg: '#DBEAFE' },
  violet: { fg: '#6D28D9', bg: '#EDE9FE' },
  amber: { fg: '#B45309', bg: '#FEF3C7' },
  rose: { fg: '#BE123C', bg: '#FFE4E6' },
  teal: { fg: '#0F766E', bg: '#CCFBF1' },
  scopeSentence: { fg: '#475569', bg: '#FFFFFF' },
};

/**
 * La clause de vétusté, dérivée du nombre de jours et de rien d'autre.
 *
 * Exportée parce que la même phrase est nécessaire hors du badge (sous-titres, états
 * vides, `scope` de KPI). L'écrire une seconde fois à la main est exactement la dérive
 * « deux listes tenues à la main » que cet épic existe pour supprimer.
 *
 * La glose « plus de N ans » au-delà de 365 jours est REQUISE, pas optionnelle :
 * « 786 jours » n'est pas lisible d'un coup d'œil, et 786 est la valeur réellement
 * mesurée sur un des deux tenants. Le chiffre exact reste affiché — la glose s'ajoute,
 * elle ne remplace pas.
 */
export function academicYearStaleLabel(staleByDays: number): string {
  if (!Number.isFinite(staleByDays) || staleByDays <= 0) return 'dernier jour';
  const days = `${formatInt(staleByDays)} ${staleByDays === 1 ? 'jour' : 'jours'}`;
  if (staleByDays < 365) return `terminée il y a ${days}`;
  const years = Math.floor(staleByDays / 365);
  const gloss = years === 1 ? "plus d'un an" : `plus de ${formatInt(years)} ans`;
  return `terminée il y a ${days} (${gloss})`;
}

/** Le texte de la pastille. `null` ⇔ rien à peindre (voir `unavailable`). */
export function academicYearScopeBadgeLabel(
  state: AcademicYearScopeState,
  year: AcademicYearScopeInput | null | undefined,
): string | null {
  switch (state) {
    case 'unavailable':
      return null;
    case 'none':
      return 'Aucune année active';
    case 'current':
      return year ? `${year.name} · en cours` : null;
    case 'last_day':
      return year ? `${year.name} · dernier jour` : null;
    case 'outside':
      return year ? `${year.name} · pas encore commencée` : null;
    case 'stale':
      return year ? `${year.name} · ${academicYearStaleLabel(year.staleByDays)}` : null;
  }
}

/** L'année ACTIVE de l'établissement, quand la page en consulte une AUTRE. */
export interface ActiveAcademicYearRef {
  id: string;
  name: string;
}

/**
 * La phrase de portée : ce que les chiffres de la page couvrent, en clair.
 *
 * ## Le paramètre `activeYear` et pourquoi il n'est pas décoratif
 *
 * Une page qui possède un sélecteur d'année (`/admin/school/structure`) affiche des
 * chiffres portant sur l'année SÉLECTIONNÉE. Y peindre la portée de l'année ACTIVE
 * donnerait deux noms d'année sur un même écran, dont celui présenté comme « la portée
 * de ces chiffres » serait le mauvais — G-TRUTH inversé et DNC-01 en plein. Aujourd'hui
 * la page est muette ; ainsi faite, elle mentirait, ce qui est strictement pire.
 *
 * La règle, appliquée ici et pas dans deux pages : **`year` est TOUJOURS l'année sur
 * laquelle portent les chiffres**, jamais « l'année active » dans l'abstrait. Quand elle
 * diffère de l'année active, `activeYear` le dit explicitement au lieu de le taire.
 */
export function academicYearScopeSentence(
  state: AcademicYearScopeState,
  year: AcademicYearScopeInput | null | undefined,
  activeYear?: ActiveAcademicYearRef | null,
): string | null {
  if (state === 'unavailable') {
    return "La portée de ces chiffres n'a pas pu être lue. Rechargez la page.";
  }
  if (state === 'none' || !year) {
    return 'Aucune année scolaire active : les chiffres de cette page peuvent être vides.';
  }

  const span = `${formatDateLong(year.startDate)} → ${formatDateLong(year.endDate)}`;
  const head = `Les chiffres de cette page portent sur l'année ${year.name} (${span})`;
  const offActiveYear = Boolean(activeYear && activeYear.id !== year.id);

  let sentence: string;
  switch (state) {
    case 'last_day':
      sentence = `${head}, dont c'est le dernier jour.`;
      break;
    case 'outside':
      sentence = `${head}, qui n'a pas encore commencé.`;
      break;
    case 'stale':
      // « Aucune année plus récente n'a été ouverte » est une affirmation sur
      // L'ÉTABLISSEMENT, pas sur l'année consultée — elle n'est vraie que si l'année
      // vétuste EST l'année active. Sur une page à sélecteur d'année qui regarde une
      // année passée, une année plus récente existe de façon démontrable : c'est
      // `activeYear`. L'ajouter là serait deux phrases qui se contredisent dans un même
      // paragraphe, c'est-à-dire le DNC-01 que ce paramètre existe pour empêcher.
      sentence = offActiveYear
        ? `${head}, ${academicYearStaleLabel(year.staleByDays)}.`
        : `${head}, ${academicYearStaleLabel(year.staleByDays)}. Aucune année plus récente n'a été ouverte.`;
      break;
    case 'current':
    default:
      sentence = `${head}.`;
  }

  if (offActiveYear && activeYear) {
    sentence += ` L'année active de l'établissement est ${activeYear.name}.`;
  }
  return sentence;
}

const stackVariants = cva('inline-flex min-w-0 flex-col items-start', {
  variants: {
    size: { sm: 'gap-1', md: 'gap-1.5' },
  },
  defaultVariants: { size: 'md' },
});

/**
 * Le libellé complet de `stale` fait ~40 caractères et DÉBORDE à 320 px sous le
 * `whitespace-nowrap` par défaut de `StatusBadge`. On garde donc sa table de tons — la
 * réutilisation qui compte — et on neutralise trois de ses classes via `cn`/`twMerge` :
 * `whitespace-normal` (retour à la ligne), `items-start` (icône alignée sur la première
 * ligne) et `rounded-xl` (une pastille pleinement arrondie sur deux lignes se lit comme
 * un défaut de rendu). `text-xs` relève aussi le plancher en taille `sm`, où
 * `StatusBadge` descend à 11 px : ce badge porte un fait, il ne descend pas sous 12 px.
 */
const chipOverride = 'items-start whitespace-normal rounded-xl text-xs min-h-6 max-w-full';

const sentenceVariants = cva('max-w-prose text-slate-600', {
  variants: {
    size: { sm: 'text-[11px] leading-snug', md: 'text-xs leading-snug' },
  },
  defaultVariants: { size: 'md' },
});

export interface AcademicYearScopeBadgeProps extends VariantProps<typeof stackVariants> {
  /**
   * La portée SUR LAQUELLE PORTENT LES CHIFFRES DE LA PAGE.
   *
   * `null` = l'API a répondu « aucune année active ». `undefined` = le champ est absent
   * (api antérieure au déploiement). Les deux sont distincts et le restent.
   */
  year: AcademicYearScopeInput | null | undefined;
  /**
   * L'année active de l'établissement, à ne passer QUE par une page dont les chiffres
   * peuvent porter sur une autre année (sélecteur d'année). Ignorée quand elle coïncide
   * avec `year`.
   */
  activeYear?: ActiveAcademicYearRef | null;
  /** `block` ajoute la phrase de portée sous la pastille. Défaut `inline`. */
  variant?: 'inline' | 'block';
  /**
   * Suite concrète — « turn information into action » : sur `stale` et `none`, un lien
   * admin vers l'ouverture d'une année ; côté enseignant, une phrase de renvoi. Rendue
   * par la seule variante `block`. Volontairement un slot : coder en dur une instruction
   * d'administration dans un composant partagé le rendrait faux côté enseignant.
   */
  action?: ReactNode;
  className?: string;
}

/**
 * AcademicYearScopeBadge — l'unique rendu de « sur quelle année portent ces chiffres ».
 *
 * ## Pourquoi ce composant ne reçoit NI lignes NI `endDate` à interpréter
 *
 * Le type de props rend une liste d'années **inexprimable**, et le composant ne calcule
 * jamais la vétusté : il reçoit `isStale` / `staleByDays` déjà décidés côté serveur.
 * Recalculer ici depuis `endDate` serait une SECONDE dérivation du fait unique que cette
 * tranche existe pour arrêter de perdre — sur une horloge CLIENT, donc non testable et
 * source de désaccord d'hydratation. Verdict en entrée, pixels en sortie.
 *
 * ## Pourquoi la vétusté ne peut pas devenir un filtre ici
 *
 * Aucune prop `onClick`, `href`, `onSelect`, `value` ni `selected`. Le rendu est un
 * `<span>` non focusable. Sur les données mesurées (0/2 tenants contiennent aujourd'hui ;
 * 56 et 786 jours), filtrer ou masquer sur `isStale` / `containsReferenceDate` VIDERAIT
 * les quatre portails. L'interdiction n'est donc pas une consigne de revue : elle est
 * inexprimable dans l'API du composant.
 *
 * ## Ce que le badge n'affirme jamais
 *
 * Aucun effectif, aucun total, aucun pourcentage — il nomme une PORTÉE. Aucun nouveau
 * chiffre ne peut donc contredire un autre portail (DNC-01).
 *
 * ## Accessibilité (mesurée, pas déclarée)
 * - Contraste : voir `ACADEMIC_YEAR_SCOPE_TONE_HEXES`, table énumérable, tous ≥ 4.5:1.
 *   La phrase est `text-slate-600` (7.58:1) et jamais `slate-400` (2.56:1, échec).
 * - WCAG 1.4.1 : chaque état porte icône + texte, formes distinctes. Le niveau de gris
 *   sépare encore les états.
 * - WCAG 4.1.2 : la phrase de portée est un `<p>` FRÈRE, jamais un `title` ni un
 *   `aria-label`. Une portée réservée aux lecteurs d'écran est l'interface qui promet ce
 *   que la page ne montre pas.
 * - L'icône duplique le libellé : décorative, donc `aria-hidden`.
 * - Rendu SERVEUR : pas de `'use client'`, pas de hook, pas d'`aria-live` — l'état change
 *   à la navigation, pas sur place.
 * - WCAG 2.5.8 : non interactif, donc aucun plancher de cible ne s'applique ; ce qui
 *   passe par `action` prend la cible maison de 44 px.
 * - Aucune transition locale, aucun `outline-none` : anneaux de focus et
 *   `prefers-reduced-motion` restent globaux (`globals.css`).
 */
export function AcademicYearScopeBadge({
  year,
  activeYear,
  size = 'md',
  variant = 'inline',
  action,
  className,
}: AcademicYearScopeBadgeProps) {
  const resolvedSize = size ?? 'md';
  const state = academicYearScopeState(year);

  // Le champ est absent : on ne peint RIEN, ce qui est le comportement d'aujourd'hui.
  // C'est la dégradation qui rend la tranche révertible sans casse pendant la fenêtre de
  // déploiement glissant — et l'inverse (une pastille « indisponible » sur chaque page
  // admin le temps d'un déploiement) serait du bruit, pas de l'information.
  if (state === 'unavailable') return null;

  const { icon: Icon, tone } = STATE_PRESENTATION[state];
  const label = academicYearScopeBadgeLabel(state, year);
  if (!label) return null;

  const iconSize = resolvedSize === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4';
  const offActiveYear = Boolean(year && activeYear && activeYear.id !== year.id);
  const sentence =
    variant === 'block' ? academicYearScopeSentence(state, year, activeYear) : null;

  return (
    <div className={cn(stackVariants({ size: resolvedSize }), className)}>
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <StatusBadge
          label={label}
          tone={tone}
          size={resolvedSize}
          className={chipOverride}
          icon={<Icon className={cn(iconSize, 'mt-px shrink-0')} aria-hidden />}
        />
        {/* Témoins secondaires : RENDUS À CÔTÉ et jamais À LA PLACE — un cas
            `viaFallback && isStale` perdrait sinon l'une des deux vérités. */}
        {year?.viaFallback && (
          <StatusBadge
            label="repli"
            tone="neutral"
            size="sm"
            icon={<History className="h-3 w-3 shrink-0" aria-hidden />}
          />
        )}
        {/* `activeCount > 1` est IMPOSSIBLE tant que l'index unique partiel
            `academic_year_one_active_per_school` tient. C'est un TÉMOIN, pas une
            décoration : s'il apparaît un jour, l'index a sauté. Ne pas le supprimer au
            motif qu'il est mort. */}
        {year && year.activeCount > 1 && (
          <StatusBadge label={`${formatInt(year.activeCount)} années actives`} tone="warning" size="sm" />
        )}
        {offActiveYear && <StatusBadge label="hors année active" tone="neutral" size="sm" />}
      </div>
      {sentence && <p className={sentenceVariants({ size: resolvedSize })}>{sentence}</p>}
      {variant === 'block' && action}
    </div>
  );
}
