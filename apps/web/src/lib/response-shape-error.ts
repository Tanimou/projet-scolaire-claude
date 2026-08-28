import type { ZodError } from 'zod';

/**
 * S-E03-11 / PF-427 / ADR-081 §D3 — l'échec d'ANALYSE d'une enveloppe de page.
 *
 * **Module feuille.** Il n'importe qu'un TYPE de `zod` (`import type`, effacé à
 * la compilation) : aucune valeur, donc aucun graphe. Il n'importe ni
 * `next/headers`, ni `@/auth`, ni `@/lib/api-client` — l'importer depuis un
 * composant `'use client'` ne peut donc pas reproduire **PF-133**. C'est la
 * même construction, et la même raison, que `@/lib/api-error-message`.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ `ResponseShapeError` N'ÉTEND **PAS** `ApiError`, ET C'EST LA DÉCISION LA
 * PLUS IMPORTANTE DU FICHIER. NE PAS LA « SIMPLIFIER ».
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Cinq des sept fichiers qui lisent une enveloppe portent encore la copie
 * locale de `safe()` que PF-05 a nommée :
 *
 *     catch (err) { if (err instanceof ApiError) return null; throw err; }
 *
 * Si l'échec d'analyse était une `ApiError`, ces `safe()` l'AVALERAIENT en
 * `null`, et la page rendrait ensuite son état « lecture indisponible » :
 * quatre cartes KPI ambrées « Indisponible », « Mesure indisponible », des
 * tirets cadratins. Autrement dit **une rupture de contrat déguisée en panne
 * d'API** — un échec présenté comme un fait sur l'établissement, exactement la
 * tromperie que PF-05, ADR-071 et G-TRUTH existent pour interdire. Ce serait un
 * défaut PIRE que celui que la tranche corrige, et — c'est le point — VISUELLEMENT
 * IDENTIQUE au quasi-incident du run 94 qu'elle prétend fermer.
 *
 * Parce que `safe()` **re-jette** tout ce qui n'est pas une `ApiError`, une
 * classe distincte se propage jusqu'à la frontière d'erreur EXISTANTE du
 * portail (`apps/web/src/app/admin/error.tsx`). C'est ce choix — et lui seul —
 * qui rend SANS DANGER le fait de laisser les cinq `safe()` tranquilles, ce que
 * la discipline de portée de cette tranche exige (leur conversion vers `read()`
 * appartient à la classe PF-05, hors périmètre ici).
 *
 * **Le prix, déclaré plutôt que tu.** `PortalErrorState` affiche « le problème
 * est peut-être temporaire — réessayez dans un instant », ce qui est FAUX pour
 * une rupture de contrat : réessayer ne peut pas aboutir. Et en production Next
 * masque le message d'une erreur de composant serveur et ne transmet qu'un
 * `digest`, donc le détail par clé n'atteint JAMAIS le navigateur. Les deux
 * points sont réels ; aucun n'est corrigé ici — les corriger demanderait
 * d'inventer une UI d'erreur, ce que la tranche s'interdit (AC-3 : « la surface
 * d'erreur EXISTANTE »). Ils sont ENREGISTRÉS. Le détail diagnostique part dans
 * le JOURNAL SERVEUR, où il est réellement lisible.
 */

/**
 * Une clé en désaccord, réduite à ce qui est DIAGNOSTIQUE et à rien de plus.
 *
 * ⚠ AUCUNE VALEUR DE RÉPONSE N'EST PORTÉE ICI, ET C'EST UNE RÈGLE
 * STRUCTURELLE, PAS UNE REVUE À REFAIRE. Cette plateforme traite des données
 * d'ENFANTS. Le `received` de zod peut contenir un fragment de charge utile —
 * sur `data.3.guardians.0.email`, l'adresse d'un parent — qui voyagerait
 * ensuite jusqu'à un journal ou un ticket de support. `path` (chemin de CLÉS de
 * NOTRE schéma), `code` (code zod) et `expected` (type attendu par NOTRE
 * schéma) proviennent tous les trois du SCHÉMA, jamais de la réponse.
 * `received` est délibérément ABSENT du type : il n'y a pas de champ où le
 * mettre.
 */
export interface ResponseShapeIssue {
  /** `total`, `totals`, `data.3` — un chemin de CLÉS, jamais un contenu. */
  readonly path: string;
  /** Le code zod : `invalid_type`, `custom`, `too_small`… */
  readonly code: string;
  /** Le type attendu par NOTRE schéma, quand zod le nomme. */
  readonly expected?: string;
}

/**
 * Réduit les problèmes zod à la forme sûre ci-dessus.
 *
 * Un chemin VIDE (`[]`) désigne l'enveloppe ELLE-MÊME — typiquement une réponse
 * qui n'est pas un objet. Il est NOMMÉ plutôt que rendu comme une chaîne vide,
 * sans quoi le message le plus fréquent serait aussi le moins diagnostiquable.
 */
export function responseShapeIssues(error: ZodError): ResponseShapeIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.length > 0 ? issue.path.join('.') : '(enveloppe)',
    code: issue.code,
    ...('expected' in issue && typeof issue.expected === 'string'
      ? { expected: issue.expected }
      : {}),
  }));
}

/** Rend les clés en désaccord sous une forme lisible dans un message. */
export function formatResponseShapeIssues(issues: readonly ResponseShapeIssue[]): string {
  if (issues.length === 0) return '(aucune signalée)';
  return issues
    .map((i) => (i.expected ? `${i.path} (${i.code}, attendu ${i.expected})` : `${i.path} (${i.code})`))
    .join(' ; ');
}

/**
 * Le contrat de réponse a été rompu : l'API a répondu, mais sa réponse ne
 * correspond pas à l'enveloppe que cette page sait lire.
 *
 * Ce n'est **ni** une panne (réessayer n'aboutira pas) **ni** un fait sur
 * l'établissement (il n'y a pas « aucun export », il y a une réponse
 * illisible). C'est pour cela qu'elle a sa propre classe.
 */
export class ResponseShapeError extends Error {
  /** Nom stable, écrit — jamais `constructor.name`, que la minification renomme. */
  override readonly name = 'ResponseShapeError';

  /**
   * Le GABARIT de route, jamais l'URL complète : `/api/v1/analytics/audit` et
   * non `…?actorId=…&studentId=…`. Une chaîne de requête porte des valeurs de
   * filtre qui peuvent désigner un enfant.
   */
  readonly endpoint: string;

  /** Les clés en désaccord — chemins et codes seulement (voir plus haut). */
  readonly issues: readonly ResponseShapeIssue[];

  constructor(endpoint: string, issues: readonly ResponseShapeIssue[]) {
    super(
      `Enveloppe inattendue de ${endpoint} — clés en désaccord : ${formatResponseShapeIssues(
        issues,
      )}`,
    );
    this.endpoint = endpoint;
    this.issues = issues;
  }
}

/**
 * Vrai pour une rupture de contrat de réponse.
 *
 * La classe est exportée depuis ce module feuille unique : il n'y a donc pas le
 * risque de double instance de module qu'aurait une classe re-déclarée par
 * paquet, et `instanceof` est fiable.
 */
export function isResponseShapeError(err: unknown): err is ResponseShapeError {
  return err instanceof ResponseShapeError;
}
