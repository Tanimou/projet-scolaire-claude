/**
 * Résolution d'un code d'audit vers son libellé — **le seul chemin** (S-E04-4).
 *
 * Trois états, pas deux. C'est la distinction qui empêche l'interface
 * d'affirmer une histoire fausse :
 *
 * | `vocabulary` | Condition                                   | Rendu                                   |
 * |--------------|---------------------------------------------|-----------------------------------------|
 * | `canonical`  | le code est déclaré dans `vocabulary.ts`    | libellé français, **aucun marqueur**    |
 * | `legacy`     | la valeur est dans la table d'alias gelée   | valeur **telle qu'écrite** + « Format hérité » |
 * | `unknown`    | ni l'un ni l'autre                          | valeur **verbatim** + « Code non répertorié » |
 *
 * Pourquoi trois. « Format hérité » affirme *ceci précède l'unification du
 * vocabulaire*. Un code qu'un développeur ajoute le mois prochain et oublie de
 * déclarer n'est pas historique — le marquer ainsi livrerait au DPO une
 * provenance inventée, exactement la classe d'erreur que cet épic supprime.
 * C'est aussi précisément l'échec que `calendar_event` a démontré et que la
 * complétude bidirectionnelle existe pour attraper : `unknown` est le signal
 * qui doit faire rougir le garde, pas une case où ranger le problème.
 *
 * **`unknown` renvoie `label === code`, verbatim.** L'ancien repli du portail
 * admin dé-soulignait et capitalisait (`calendar_event` → « Calendar event ») :
 * un libellé deviné est indiscernable d'un libellé canonique, et il masquait
 * justement le trou. Le marqueur porte désormais le signal ; la valeur reste
 * brute (changement de comportement délibéré — ADR-037 D4).
 *
 * DNC-08 : une valeur inclassable reste **visible**. Elle n'est jamais retirée
 * d'une liste de facettes, jamais rangée dans un seau « Autre », jamais avalée
 * par un `try/catch`, et elle apparaît dans le CSV remis au régulateur.
 */

import {
  AUDIT_ACTIONS,
  AUDIT_PORTALS,
  AUDIT_RESOURCE_TYPES,
  LEGACY_AUDIT_ACTION_ALIASES,
  LEGACY_AUDIT_RESOURCE_TYPE_ALIASES,
  type AuditLegacyAlias,
  type AuditVocabularyEntry,
} from './vocabulary';

/** L'origine du libellé rendu. Sérialisée telle quelle dans le CSV DPO. */
export type AuditVocabularyKind = 'canonical' | 'legacy' | 'unknown';

export interface AuditVocabularyResolution {
  /** La valeur stockée, **inchangée**. */
  code: string;
  /** Ce qu'on affiche au-dessus. Égal à `code` quand `vocabulary === 'unknown'`. */
  label: string;
  vocabulary: AuditVocabularyKind;
}

/**
 * Marqueur des valeurs antérieures à l'unification du vocabulaire.
 *
 * Ton **neutre**, jamais une alerte : ces lignes sont plus anciennes que le
 * vocabulaire, elles ne sont pas suspectes.
 */
export const LEGACY_FORMAT_MARKER = 'Format hérité';

/** Marqueur d'un code hors vocabulaire déclaré — ni canonique, ni hérité. */
export const UNKNOWN_FORMAT_MARKER = 'Code non répertorié';

export const LEGACY_FORMAT_EXPLANATION =
  'Enregistrée avant l’unification du vocabulaire d’audit. La valeur est affichée telle qu’elle a été écrite.';

export const UNKNOWN_FORMAT_EXPLANATION =
  'Ce code n’appartient pas au vocabulaire déclaré. La valeur est affichée telle qu’elle a été écrite.';

/** Le marqueur à afficher, ou `null` quand la valeur est canonique. */
export function auditVocabularyMarker(vocabulary: AuditVocabularyKind): string | null {
  if (vocabulary === 'legacy') return LEGACY_FORMAT_MARKER;
  if (vocabulary === 'unknown') return UNKNOWN_FORMAT_MARKER;
  return null;
}

/** La phrase d'explication, ou `null` quand la valeur est canonique. */
export function auditVocabularyExplanation(vocabulary: AuditVocabularyKind): string | null {
  if (vocabulary === 'legacy') return LEGACY_FORMAT_EXPLANATION;
  if (vocabulary === 'unknown') return UNKNOWN_FORMAT_EXPLANATION;
  return null;
}

function index(entries: readonly (AuditVocabularyEntry | AuditLegacyAlias)[]): Map<string, string> {
  return new Map(entries.map((e) => [e.code, e.label]));
}

const ACTION_LABELS = index(AUDIT_ACTIONS);
const LEGACY_ACTION_LABELS = index(LEGACY_AUDIT_ACTION_ALIASES);
const RESOURCE_TYPE_LABELS = index(AUDIT_RESOURCE_TYPES);
const LEGACY_RESOURCE_TYPE_LABELS = index(LEGACY_AUDIT_RESOURCE_TYPE_ALIASES);
const PORTAL_LABELS = index(AUDIT_PORTALS);

function resolve(
  code: string,
  canonical: Map<string, string>,
  legacy: Map<string, string>,
): AuditVocabularyResolution {
  const hit = canonical.get(code);
  if (hit !== undefined) return { code, label: hit, vocabulary: 'canonical' };
  const alias = legacy.get(code);
  if (alias !== undefined) return { code, label: alias, vocabulary: 'legacy' };
  // Verbatim. Jamais deviné, jamais mis dans un seau générique (DNC-08).
  return { code, label: code, vocabulary: 'unknown' };
}

export function classifyAuditAction(code: string): AuditVocabularyResolution {
  return resolve(code, ACTION_LABELS, LEGACY_ACTION_LABELS);
}

export function classifyAuditResourceType(code: string): AuditVocabularyResolution {
  return resolve(code, RESOURCE_TYPE_LABELS, LEGACY_RESOURCE_TYPE_LABELS);
}

/**
 * Les quatre portails. Il n'existe pas d'alias hérité de portail : les 54
 * lignes portent toutes `portal: 'admin'`, qui est déjà canonique.
 */
export function classifyAuditPortal(code: string): AuditVocabularyResolution {
  const hit = PORTAL_LABELS.get(code);
  if (hit !== undefined) return { code, label: hit, vocabulary: 'canonical' };
  return { code, label: code, vocabulary: 'unknown' };
}
