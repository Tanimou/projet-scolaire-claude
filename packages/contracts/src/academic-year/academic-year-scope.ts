/**
 * S-E03-16 / `PF-15` / `ADR-090` — LA PORTÉE D'ANNÉE, telle qu'elle voyage SUR LE FIL.
 *
 * LE DÉFAUT QUE CE FICHIER EXISTE POUR FERMER
 * -------------------------------------------
 * `resolve-academic-year.ts` DÉCORE chaque résolution : `name`, `startDate`,
 * `endDate`, `status`, `viaFallback`, `containsReferenceDate`, `isStale`,
 * `staleByDays`, `activeCount`. Puis `SchoolContextService` — LE service que
 * traversent les QUATRE portails — jetait tout sauf `.id`. La vétusté était
 * « exposée » au contrat et INEXISTANTE dans le système : mesurée le
 * 2026-08-30, l'année `active` des DEUX tenants est terminée (56 jours pour
 * l'un, 786 pour l'autre) et AUCUNE surface ne le disait.
 *
 * POURQUOI UN TYPE À PART, ET PAS `ResolvedAcademicYear` DIRECTEMENT
 * ------------------------------------------------------------------
 * `ResolvedAcademicYear.startDate` / `.endDate` sont des `Date`. Sur le fil,
 * `JSON.stringify` les rend en CHAÎNES ISO. Un consommateur web qui importerait
 * `ResolvedAcademicYear` tel quel typecheckerait vert et appellerait
 * `.toLocaleDateString()` sur une `string` — `TypeError` à CHAQUE requête (les
 * deux pages cibles sont `force-dynamic`, donc pas une seule fois au build).
 * Ce type est donc EXACTEMENT ce que Nest sérialise, pas ce que le résolveur
 * calcule ; le mapper ci-dessous est le seul endroit où la conversion arrive.
 * Un `DNC-06` posé de nos propres mains est un `DNC-06` quand même.
 *
 * `schoolId` n'y figure PAS : la portée décrit une ANNÉE, et l'école est déjà
 * portée par la réponse qui transporte cet objet. Ajouter un second porteur du
 * même fait serait la divergence que cette tranche referme.
 *
 * LA VÉTUSTÉ EST RAPPORTÉE, JAMAIS CHOISIE (`ADR-070`, `ADR-090`)
 * ---------------------------------------------------------------
 * Rien ici — et rien en aval — ne SÉLECTIONNE, ne filtre, ne trie ni ne masque
 * sur `isStale` ou `containsReferenceDate`. Sur les données mesurées, 0/2
 * tenants ont une année active contenant aujourd'hui : un filtre viderait les
 * quatre portails. Ces champs sont des FAITS RAPPORTÉS.
 *
 * AUCUNE HORLOGE ICI
 * ------------------
 * Aucun `new Date(`, aucun `Date.now(` : la date de référence est déjà
 * consommée par le résolveur, et `hermetic-spec-writers-gate.spec.ts` existe.
 * Ce mapper est PUR — même entrée, même sortie, pour toujours.
 */

import type { ResolvedAcademicYear } from './resolve-academic-year';

/**
 * L'année scolaire résolue, TELLE QU'ELLE ARRIVE EN JSON.
 *
 * Un seul type pour les cinq réponses HTTP et pour toutes les surfaces web :
 * trois interfaces recopiées à la main sur trois pages seraient exactement la
 * « dérive de deux listes tenues à la main » (run 59) réintroduite à
 * l'intérieur de sa propre correction.
 */
export interface AcademicYearScope {
  id: string;
  /** Le nom affichable — « 2025-2026 ». C'est lui qui manquait aux portails. */
  name: string;
  /** ISO 8601, tel que sérialisé. JAMAIS une `Date`. */
  startDate: string;
  /** ISO 8601, tel que sérialisé. JAMAIS une `Date`. */
  endDate: string;
  status: string;
  /** `true` ⇔ résolue par la politique de repli `mostRecentOfAnyStatus`. */
  viaFallback: boolean;
  /** `startDate <= référence <= endDate`, INCLUSIF. RAPPORTÉ, jamais choisi. */
  containsReferenceDate: boolean;
  /** `endDate < référence`. RAPPORTÉ, jamais choisi. */
  isStale: boolean;
  /** Jours pleins écoulés depuis `endDate` ; `0` quand non vétuste. */
  staleByDays: number;
  /** Années ACTIVES vues par la requête primaire ; `> 1` dénonce `PF-328`. */
  activeCount: number;
}

/**
 * LE mapper. Pur, total, sans horloge.
 *
 * Écrit champ par champ plutôt qu'en `{ ...resolved, startDate: … }` :
 * `ResolvedAcademicYear` porte `schoolId`, qu'un spread ferait fuiter dans le
 * contrat sans que personne ne l'ait décidé. Une projection se DÉCLARE.
 */
export function toAcademicYearScope(resolved: ResolvedAcademicYear): AcademicYearScope {
  return {
    id: resolved.id,
    name: resolved.name,
    startDate: resolved.startDate.toISOString(),
    endDate: resolved.endDate.toISOString(),
    status: resolved.status,
    viaFallback: resolved.viaFallback,
    containsReferenceDate: resolved.containsReferenceDate,
    isStale: resolved.isStale,
    staleByDays: resolved.staleByDays,
    activeCount: resolved.activeCount,
  };
}
