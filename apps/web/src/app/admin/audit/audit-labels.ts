/**
 * Libellés lisibles du journal d'audit — **module neutre, sans `'use client'`**.
 *
 * Pourquoi ce fichier existe (S-E04-2 / PF-14) : ces quatre déclarations vivaient
 * dans `AuditPageFilters.tsx`, qui porte `'use client'`. `page.tsx` est un composant
 * serveur et les **appelait** pour construire les options de filtre. Importer une
 * valeur depuis un module client est légal en Next 15 ; l'**appeler** depuis le
 * serveur ne l'est pas — le bundler remplace l'export par une référence client et
 * l'invoquer lève :
 *
 *   Attempted to call humanizeResourceType() from the server but humanizeResourceType
 *   is on the client.
 *
 * Mesuré le 2026-08-08 sur la stack locale, connecté en `school_admin` :
 * `/admin/audit` renvoyait **HTTP 500** (digest `2236692779`) et tombait sur la
 * frontière d'erreur `/admin/error.tsx`. La page n'a donc jamais rendu pour un
 * administrateur authentifié.
 *
 * Règle à tenir : ce module ne doit **jamais** recevoir `'use client'` ni importer
 * un module qui le porte. Il est consommé des deux côtés de la frontière —
 * `page.tsx` (serveur) et `AuditPageFilters` / `AuditTable` / `AuditDetailDrawer`
 * (client).
 *
 * Portée (mise à jour par `S-E04-4` / ADR-037) : les deux cartes de libellés qui
 * vivaient ici — `RESOURCE_TYPE_LABELS` (13 clés, dont 7 que **personne**
 * n'écrit) et `PORTAL_LABELS` (3 portails sur 4) — ont été **supprimées**. Le
 * vocabulaire est désormais déclaré une seule fois, dans
 * `packages/contracts/src/audit/`, et les trois consommateurs le lisent : cette
 * couche web, les prédicats KPI de l'API, et le générateur de CSV du worker.
 * Ce fichier n'est plus qu'un **adaptateur mince** : il ne déclare aucun
 * libellé d'audit et ne doit jamais recommencer à en déclarer.
 *
 * Il garde en revanche les déclarations de provenance de `S-E04-3`
 * (`PROVENANCE_UNAVAILABLE`, `hasNoProvenance`, `humanizeUserAgent`) — ce n'est
 * pas du vocabulaire d'audit, c'est de la lecture de `User-Agent`.
 */

import {
  AUDIT_PORTAL_NONE,
  AUDIT_PORTAL_NONE_LABEL,
  auditActionCountedBy,
  auditActionTone,
  auditVocabularyExplanation,
  auditVocabularyMarker,
  classifyAuditAction,
  classifyAuditPortal,
  classifyAuditResourceType,
  isAuditPortalNone,
  type AuditActionCountedBy,
  type AuditActionTone,
  type AuditVocabularyKind,
  type AuditVocabularyResolution,
} from '@pilotage/contracts';

export {
  AUDIT_PORTAL_NONE,
  auditActionCountedBy,
  auditActionTone,
  auditVocabularyExplanation,
  auditVocabularyMarker,
  classifyAuditAction,
  classifyAuditPortal,
  classifyAuditResourceType,
  isAuditPortalNone,
};
export type {
  AuditActionCountedBy,
  AuditActionTone,
  AuditVocabularyKind,
  AuditVocabularyResolution,
};

/**
 * Résout une valeur de **facette de portail**, sentinelle comprise (PF-123).
 *
 * `classifyAuditPortal` reste total et verbatim sur tout code inconnu : c'est sa
 * propriété, et on ne la casse pas. La sentinelle `__none__` n'est pas un code
 * porté par une ligne — c'est une valeur de filtre — donc sa traduction vit ici,
 * dans l'adaptateur web, et non dans la déclaration.
 *
 * Le vocabulaire rendu reste `unknown` : « Sans portail » n'est pas un portail
 * canonique, et le marqueur neutre le dit. Ne pas l'ajouter à `AUDIT_PORTALS`.
 */
export function classifyAuditPortalFilterValue(code: string): AuditVocabularyResolution {
  if (isAuditPortalNone(code)) {
    return { code, label: AUDIT_PORTAL_NONE_LABEL, vocabulary: 'unknown' };
  }
  return classifyAuditPortal(code);
}

/**
 * Libellé d'un type de ressource.
 *
 * Une valeur inclassable reste **visible et verbatim** (DNC-08). Le repli
 * « dé-souligner et capitaliser » a été retiré : `calendar_event` devenait
 * « Calendar event », un libellé deviné indiscernable d'un libellé canonique —
 * ce qui masquait précisément le trou que la complétude bidirectionnelle existe
 * pour révéler. C'est maintenant le marqueur qui porte le signal
 * (ADR-037 D4).
 */
export function humanizeResourceType(rt: string): string {
  return classifyAuditResourceType(rt).label;
}

export function humanizeAction(action: string): string {
  return classifyAuditAction(action).label;
}

export function humanizePortal(p: string | null): string {
  if (!p) return '—';
  return classifyAuditPortal(p).label;
}

/**
 * Décrit en français **quels champs** d'une entrée sortent du vocabulaire
 * canonique, pour la phrase `sr-only` du tableau.
 *
 * Calculée, jamais figée : une ligne dont seule l'action est héritée ne doit
 * pas annoncer que son type de ressource l'est aussi.
 */
export function describeNonCanonicalFields(entry: {
  action: string;
  resourceType: string;
}): {
  kind: AuditVocabularyKind;
  marker: string;
  explanation: string;
  fields: string;
  /**
   * Combien de champs sortent du vocabulaire — 1 ou 2. Exposé pour que
   * l'appelant accorde son verbe sans re-tester la chaîne : `AuditTable.tsx`
   * faisait `fields.includes(' et ')`, et une correspondance de sous-chaîne sur
   * une valeur d'audit est précisément ce que PF-134 supprime de ce fichier.
   */
  fieldCount: number;
} | null {
  const action = classifyAuditAction(entry.action);
  const resourceType = classifyAuditResourceType(entry.resourceType);
  const offenders: Array<{ name: string; kind: AuditVocabularyKind }> = [];
  if (action.vocabulary !== 'canonical') {
    offenders.push({ name: "l’action", kind: action.vocabulary });
  }
  if (resourceType.vocabulary !== 'canonical') {
    offenders.push({ name: 'le type de ressource', kind: resourceType.vocabulary });
  }
  if (offenders.length === 0) return null;
  // Quand les deux champs divergent, on annonce le plus prudent des deux :
  // « non répertorié » ne prétend rien sur l'ancienneté de la ligne.
  const kind: AuditVocabularyKind = offenders.some((o) => o.kind === 'unknown')
    ? 'unknown'
    : 'legacy';
  return {
    kind,
    marker: auditVocabularyMarker(kind) ?? '',
    explanation: auditVocabularyExplanation(kind) ?? '',
    fields: offenders.map((o) => o.name).join(' et '),
    fieldCount: offenders.length,
  };
}

/**
 * Phrase unique employée partout où la provenance client est absente
 * (`S-E04-3`, `ADR-036 D4`). Elle est **déclarée ici et nulle part ailleurs**
 * pour que la table et le tiroir ne puissent pas diverger.
 *
 * Elle ne nomme **aucune cause** : la même absence couvre une ligne héritée,
 * un chemin qui ne relaie pas encore, et un jeton de transfert refusé. Toute
 * formulation causale (« entrée antérieure au suivi », « requête relayée »)
 * serait fausse sur une partie des lignes — et une explication fausse dans une
 * surface de gouvernance est pire qu'une absence énoncée.
 */
export const PROVENANCE_UNAVAILABLE = 'Provenance non disponible';

/**
 * Vrai quand l'entrée ne porte **aucune** provenance client.
 *
 * Déclarée dans ce module neutre — et non à côté du composant — parce que
 * `page.tsx` (serveur) l'**appelle** : une valeur importée depuis un module
 * client est légale, l'invoquer depuis le serveur ne l'est pas. C'est la règle
 * que `PF-14` / `S-E04-2` a coûté une page en HTTP 500 pour établir.
 */
export function hasNoProvenance(entry: {
  ipAddress: string | null;
  userAgent: string | null;
}): boolean {
  return !entry.ipAddress && !entry.userAgent;
}

const BROWSER_TOKENS: Array<[RegExp, string]> = [
  // L'ordre est porteur : Edge et Opera annoncent aussi `Chrome`, et Chrome
  // annonce aussi `Safari`. Un ordre inversé enregistrerait chaque session Edge
  // comme Chrome — une fausseté légère, mais exactement la classe d'erreur que
  // cet épic existe pour supprimer.
  [/\bEdg[A-Z]?\//, 'Edge'],
  [/\bOPR\//, 'Opera'],
  [/\bChrome\//, 'Chrome'],
  [/\bFirefox\//, 'Firefox'],
  [/\bSafari\//, 'Safari'],
];

const OS_TOKENS: Array<[RegExp, string]> = [
  [/Windows NT/, 'Windows'],
  [/\bMac OS X\b/, 'macOS'],
  [/\bAndroid\b/, 'Android'],
  [/\b(iPhone|iPad|iPod)\b/, 'iOS'],
  [/\bLinux\b/, 'Linux'],
];

/**
 * Libellé court d'un `User-Agent` — « Chrome sur Windows ».
 *
 * Renvoie `null` quand rien ne correspond : l'appelant affiche alors la chaîne
 * brute. On ne devine jamais, et on n'écrit jamais « Navigateur inconnu » — ce
 * libellé n'est qu'une aide à la lecture posée **au-dessus** de la valeur
 * réelle, jamais un remplacement de celle-ci.
 */
export function humanizeUserAgent(ua: string | null): string | null {
  if (!ua) return null;
  const browser = BROWSER_TOKENS.find(([re]) => re.test(ua))?.[1] ?? null;
  const os = OS_TOKENS.find(([re]) => re.test(ua))?.[1] ?? null;
  if (browser && os) return `${browser} sur ${os}`;
  if (browser) return browser;
  return null;
}
