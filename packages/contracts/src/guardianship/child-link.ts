import { z } from 'zod';

import { GUARDIAN_RELATIONSHIP, type GuardianshipClaimStatus } from '../dto/child-claim';
import { UuidSchema } from '../dto/common';
// S-E03-3c / ADR-074 — le vocabulaire du statut de lien vit dans le module
// frère `link-liveness.ts` ; `import type` uniquement, donc aucun cycle à
// l'exécution et aucun coût pour `apps/web`.
import type { GuardianshipLinkStatus } from './link-liveness';

/**
 * S-E03-3b / PF-357 / PF-12 / ADR-073 — LA projection canonique de
 * « quels enfants sont liés à ce parent, et où en sont ses demandes ? ».
 *
 * CE QUE CE MODULE REMPLACE
 * -------------------------
 * `GET /api/v1/parent/child-claims` lisait UNE table — `GuardianshipClaim`, la
 * DEMANDE — et le portail parent en tirait un panneau posé directement sous une
 * liste d'enfants construite, elle, à partir de `Guardianship`, le FAIT. Mesuré
 * le 2026-08-26 sur la pile locale : **2460 liens `active`, 28 `pending`, 2459
 * parents distincts porteurs d'un lien actif — et 0 demande**. Donc 100 % des
 * parents qui voient leurs enfants listés lisaient, trois centimètres plus bas,
 * « Vous n'avez pas encore rattaché d'enfant ». C'est `DNC-01` — un panneau qui
 * contredit sa propre page — sous sa forme la plus pure, et c'est la troisième
 * clause de la phrase de l'audit dans `PF-12`.
 *
 * L'inverse tenait aussi : une demande `approved` dont le `Guardianship` avait
 * été révoqué depuis rendait toujours un badge « Validé » en vert. Le badge
 * affirmait un lien qui n'existait plus.
 *
 * POURQUOI LE VOCABULAIRE VIT ICI ET NON DANS LE COMPOSANT (ADR-073 §D1/§D2)
 * --------------------------------------------------------------------------
 * Parce que c'est le SERVEUR qui l'évalue. Le composant reçoit un `state` déjà
 * tranché — jamais un prédicat, jamais un statut brut à re-dériver. C'est la
 * forme du module frère `enrollment/select-active-enrollment.ts` (ADR-072 §A3)
 * et c'est ce qui rend « n'écris pas un second prédicat dans le composant »
 * STRUCTUREL plutôt qu'incantatoire. `apps/web` importe ce module en
 * `import type` uniquement.
 *
 * IL N'IMPORTE PAS `@prisma/client`, ET C'EST LA MÊME RAISON QU'AILLEURS
 * ---------------------------------------------------------------------
 * `packages/contracts` est aussi consommé par `apps/web` et construit en CJS
 * (GUARDRAILS §2). Ce paquet n'aura JAMAIS `@prisma/client` en dépendance. Les
 * statuts entrent donc comme des unions de littéraux et la fonction est PURE :
 * aucune I/O, aucune horloge, aucun `new Date(`.
 *
 * ⚠ LE PIÈGE DES DEUX CONSTANTES DE PARENTÉ (§12.2, PF-368)
 * ----------------------------------------------------------
 * `relationship` est validé contre `GUARDIAN_RELATIONSHIP`
 * (`../dto/child-claim`, SIX membres, miroir verbatim de `schema.prisma:161-168`)
 * et JAMAIS contre `GUARDIANSHIP_RELATIONSHIP` (`../enums/index.ts:16`, QUATRE
 * membres — il omet `grandparent` et `sibling`, donc il REJETTERAIT des lignes
 * vivantes). La constante est IMPORTÉE, jamais ré-exportée : `../dto` l'exporte
 * déjà par le baril racine et une seconde exportation serait un `TS2308`.
 * `enums/index.ts` n'est pas ouvert par cette tranche — `PF-368` est ENREGISTRÉ,
 * pas corrigé.
 *
 * ⚠ AUCUN NOM EXPORTÉ ICI NE PEUT COLLISIONNER AVEC `../enums`
 * -------------------------------------------------------------
 * Le baril racine est une pile d'`export *`. `../enums` exporte déjà
 * `GUARDIANSHIP_STATUS` et `GUARDIANSHIP_RELATIONSHIP` ; ce module n'exporte
 * NI l'un NI l'autre. Le statut du lien voyage en TYPE SEUL
 * (`ParentGuardianshipLinkStatus`) : une quatrième liste de littéraux à la main
 * serait exactement le défaut que `PF-368` enregistre, et elle n'a aucun usage
 * — ce statut ne franchit jamais le fil (§3.5).
 */

/* ================================================================== *
 * §3.3 — LE VOCABULAIRE, ÉNONCÉ UNE SEULE FOIS
 * ================================================================== */

/**
 * Les cinq membres du vocabulaire parent. CINQ, et le choix de leurs frontières
 * porte deux décisions :
 *
 *  - **`requested` recouvre DEUX provenances indiscernables.** Une demande
 *    `submitted` APPARIÉE pilote un `Guardianship` `pending` ; une demande
 *    `match_failed` ne pilote RIEN. Si `pending` était son propre état de fil,
 *    le parent lirait « l'établissement a bien un enfant de ce nom » directement
 *    sur le badge — une fuite plus grave que celle que le chemin de soumission
 *    évite si soigneusement. La distinction devient donc INEXPRIMABLE sur le
 *    fil, et pas seulement non imprimée (`FM-2`, T-5).
 *  - **« Validé » quitte le vocabulaire.** `linked` parle du FAIT (« Rattaché »).
 *    Aucun état ne tire son nom ni son libellé du statut `approved` d'une
 *    demande, donc le défaut « demande approuvée par-dessus un lien révoqué »
 *    n'est pas corrigé : il est INEXPRIMABLE (`AC-3`, T-2).
 *
 * Le tuple est la SOURCE, l'union en est DÉRIVÉE — deux listes tenues à la main
 * divergent en silence (la leçon des listes appariées).
 */
export const PARENT_CHILD_LINK_STATE = [
  /** Le FAIT : un `Guardianship` `active`. */
  'linked',
  /** En vol : un lien `pending` OU une demande non tranchée (appariée ou non). */
  'requested',
  /** L'établissement a refusé ; `decisionReason` remonte, `resubmit` aussi. */
  'request_rejected',
  /** Le parent a annulé sa propre demande. */
  'request_withdrawn',
  /** Le lien a existé et a été révoqué. */
  'ended',
] as const;
export type ParentChildLinkState = (typeof PARENT_CHILD_LINK_STATE)[number];

/**
 * Les trois valeurs de `GuardianshipStatus` (`schema.prisma:170-174`), en TYPE
 * SEUL et délibérément : voir l'avertissement du docblock. Aucun schéma Zod ne
 * valide cette union — le statut du lien ne franchit jamais le fil.
 *
 * ⚠ S-E03-3c / ADR-074 — ce n'est plus une liste de littéraux. Cette union
 * était la QUATRIÈME copie à la main des membres de `GuardianshipStatus`, et le
 * docblock de tête l'annonçait déjà comme une dette assumée. Elle ALIASE
 * désormais le vocabulaire canonique de `link-liveness.ts`, dont le cliquet
 * assied l'égalité avec l'énum Prisma lue dans `schema.prisma`. Le NOM est
 * conservé — il est importé par `child-claims.service.ts` et lu dans deux
 * signatures publiques, et le renommer serait un coût sans contrepartie.
 */
export type ParentGuardianshipLinkStatus = GuardianshipLinkStatus;

/**
 * §3.6 — le rang de l'ordre total. Énoncé UNE fois : trois ordres pour une
 * question était l'axe 3 de `PF-12`.
 */
export const PARENT_CHILD_LINK_STATE_RANK: Readonly<Record<ParentChildLinkState, number>> = {
  linked: 0,
  requested: 1,
  request_rejected: 2,
  request_withdrawn: 3,
  ended: 4,
};

/* ================================================================== *
 * §3.3 — LA DÉRIVATION, TOTALE SUR LES 4 × 6 PAIRES
 * ================================================================== */

/**
 * La table de précédence de `§3.3`, évaluée DANS L'ORDRE. Six lignes, et l'ordre
 * est porteur de charge :
 *
 * | # | lien      | demande                                   | état                |
 * |---|-----------|-------------------------------------------|---------------------|
 * | 1 | `active`  | n'importe laquelle ou aucune              | `linked`            |
 * | 2 | `pending` | n'importe laquelle ou aucune              | `requested`         |
 * | 3 | n'importe | `rejected`                                | `request_rejected`  |
 * | 4 | n'importe | `withdrawn`                               | `request_withdrawn` |
 * | 5 | `revoked` | aucune / `submitted` / `match_failed` / `approved` | `ended`    |
 * | 6 | aucun     | `submitted` **ou** `match_failed`          | `requested`         |
 *
 * Les lignes 3 et 4 passent AVANT la ligne 5, et c'est ce qui rend une paire
 * « lien révoqué + demande rejetée » lisible comme `request_rejected` — le cas
 * que `rejectClaim` ET `withdraw()` produisent tous deux, puisque les deux
 * révoquent le lien dans la même transaction (W-1).
 *
 * La ligne 2 est INATTEIGNABLE avec une demande tranchée, pour cette même
 * raison : un lien reste `pending` tant que personne n'a décidé. Noté pour qu'un
 * lecteur futur ne « corrige » pas la ligne 2 en un état de refus.
 *
 * La 24ᵉ paire — `(aucun lien, approved)` — n'est nommée par aucune ligne du
 * tableau. Elle est tranchée ici, explicitement : une demande accordée dont le
 * fait n'existe plus ne peut pas dire `linked` sans mentir, et elle ne peut pas
 * dire `requested` puisque rien n'est en vol. Elle rend `ended`.
 *
 * `(aucun lien, aucune demande)` est INATTEIGNABLE par construction — une ligne
 * naît soit d'un lien, soit d'une demande — et JETTE plutôt que de rendre une
 * valeur par défaut : un état par défaut serait une affirmation inventée.
 */
export function deriveParentChildLinkState(
  linkStatus: ParentGuardianshipLinkStatus | null,
  claimStatus: GuardianshipClaimStatus | null,
): ParentChildLinkState {
  if (linkStatus === null && claimStatus === null) {
    throw new Error(
      'deriveParentChildLinkState: la paire (aucun lien, aucune demande) est inatteignable — ' +
        'une ligne du panneau naît toujours d’un Guardianship ou d’un GuardianshipClaim (ADR-073 §D1).',
    );
  }

  if (linkStatus === 'active') return 'linked'; // ligne 1
  if (linkStatus === 'pending') return 'requested'; // ligne 2
  if (claimStatus === 'rejected') return 'request_rejected'; // ligne 3
  if (claimStatus === 'withdrawn') return 'request_withdrawn'; // ligne 4
  if (linkStatus === 'revoked') return 'ended'; // ligne 5

  // Ici `linkStatus` ne peut plus être que `null` : les trois autres valeurs
  // sont retournées plus haut. Le `switch` couvre donc la ligne 6 et la 24ᵉ
  // paire, avec un `never` exhaustif — c'est ce qui rend la fonction TOTALE
  // sur les 4 × 6 paires (T-9) plutôt que « totale de l'avis de son auteur ».
  const remaining: 'submitted' | 'approved' | 'match_failed' | null = claimStatus;
  switch (remaining) {
    case 'submitted':
    case 'match_failed':
      return 'requested'; // ligne 6 — LA collapse qui tient le mur (FM-2)
    case 'approved':
      return 'ended'; // la 24ᵉ paire : l'accord a existé, le fait n'existe plus
    case null:
      throw new Error(
        'deriveParentChildLinkState: la paire (aucun lien, aucune demande) est inatteignable.',
      );
    default: {
      const exhaustive: never = remaining;
      throw new Error(`deriveParentChildLinkState: statut de demande inconnu ${String(exhaustive)}`);
    }
  }
}

/* ================================================================== *
 * §3.4 — QUAND L'IDENTITÉ DE L'ENFANT PEUT ÊTRE PROJETÉE
 * ================================================================== */

/**
 * Le prédicat d'identité, consommé PAR LA PROJECTION SEULE.
 *
 * UNE seule condition : **le lien est `active` MAINTENANT**. C'est le mur ABAC
 * que `StudentAccessService` applique déjà partout ailleurs
 * (`student-access.service.ts:111` et `:192` scopent un parent aux
 * `Guardianship` `active` SEULEMENT), et c'est la règle qu'`ADR-073 §D5`
 * énonce mot pour mot : *« jamais sur `pending`, jamais sur `revoked` »* —
 * `studentId` compris, puisqu'il ouvre le lien profond
 * `/parent/children/:id` qui rendra 403.
 *
 * ⚠ **CE PRÉDICAT A PORTÉ DEUX DISJONCTIONS DE PLUS, ET ELLES FUYAIENT.**
 * `§3.4` de la story ajoutait `provenance === null` et
 * `provenance.status === 'approved'`, et `§R.1` a tranché en faveur de la story
 * en écrivant que `§D5` y était « contenu » — l'inclusion est à l'envers :
 * `§D5` est le prédicat STRICT, `§3.4` était le prédicat LARGE. Mesuré sur la
 * pile le 2026-08-26 : **2460 liens vivants portent ZÉRO demande**, donc
 * `provenance === null` est le cas NORMAL et non l'exception. La disjonction
 * n'étant gardée par aucun statut de lien, elle projetait aussi le nom réel et
 * le `studentId` de l'enfant pour un lien `revoked` — c'est-à-dire vers le
 * responsable que `DELETE /guardians/guardianships/:id`
 * (`guardians.controller.ts:348`, le coupe-circuit de retrait de garde) vient
 * précisément de désautoriser — et pour un lien `pending`, vers un responsable
 * que l'établissement n'a pas encore autorisé. Divulgation de données
 * d'enfants, contre `GUARDRAILS §1`. Le prédicat revient donc à `§D5`.
 *
 * Tout le reste — lien `pending`, lien `revoked`, ligne née d'une demande —
 * projette `child: null` et se rabat sur les valeurs `claimed*` que le PARENT a
 * tapées lui-même, qui ne fuient rien puisqu'il les a fournies.
 *
 * ⚠ Corollaire, et il est porteur : une ligne dont le lien n'est PAS `active`
 * et qui n'a AUCUNE provenance n'a plus aucun nom que ce parent puisse lire.
 * Elle n'est pas rendue « sans nom » : elle n'est **pas projetée du tout**
 * (`§3.2`, filtre `isNameableForGuardian`) — ce qui restaure au passage
 * `ADR-073 §D4`. Sans ce filtre, le repli `displayName` de la projection
 * relisait `link.student` et la fuite survivait au prédicat.
 *
 * ⚠ La provenance reste rattachée par la préférence en deux temps de `§3.2`
 * étape 3, et le repli sur `matchedStudentId` reste OBLIGATOIRE : sans lui, le
 * lien révoqué que `withdraw()` laisse derrière lui paraîtrait créé par
 * l'établissement, perdrait sa provenance et disparaîtrait donc du panneau au
 * lieu d'y rester en `request_withdrawn`. C'est `FM-1`, gardé par T-3.
 */
export function mayProjectChildIdentity(
  link: { status: ParentGuardianshipLinkStatus } | null,
  _provenance: { status: GuardianshipClaimStatus } | null,
): boolean {
  return link !== null && link.status === 'active';
}

/**
 * §3.2 — la ligne a-t-elle un nom que CE parent a le droit de lire ?
 *
 * Deux sources de nom existent, et deux seulement : l'identité de l'enfant
 * quand `mayProjectChildIdentity` l'autorise, et les valeurs `claimed*` que le
 * parent a lui-même tapées, qui vivent sur la provenance. Une ligne qui n'a ni
 * l'une ni l'autre — un `Guardianship` `pending` ou `revoked` créé
 * administrativement, sans aucune demande derrière lui — ne peut être nommée
 * qu'en divulguant le dossier de l'enfant. Elle est donc écartée de la
 * projection.
 *
 * Ce n'est pas une perte de fonctionnalité : avant cette tranche le panneau ne
 * lisait QUE `GuardianshipClaim`, donc ces lignes ne rendaient déjà rien. Et
 * ce n'est pas un trou de cohérence non plus : la liste d'enfants au-dessus du
 * panneau (`GET /students` → `StudentAccessService`) est `active`-seulement,
 * donc les deux surfaces restent d'accord — ce qui est tout l'objet de
 * `PF-357`.
 */
export function isNameableForGuardian(
  link: { status: ParentGuardianshipLinkStatus } | null,
  provenance: { status: GuardianshipClaimStatus } | null,
): boolean {
  return provenance !== null || mayProjectChildIdentity(link, provenance);
}

/* ================================================================== *
 * §3.6 — L'ORDRE TOTAL, ÉNONCÉ UNE FOIS
 * ================================================================== */

/**
 * La clé de tri d'une ligne. `createdAt` est une chaîne ISO-8601 UTC produite
 * par `Date#toISOString()` : largeur fixe, donc l'ordre lexicographique EST
 * l'ordre chronologique. `id` départage — clé primaire, donc unique : l'ordre
 * `[rang, createdAt desc, id desc]` est TOTAL, jamais « presque total ».
 */
export interface ParentChildLinkSortKey {
  state: ParentChildLinkState;
  createdAt: string;
  id: string;
}

/** Le comparateur de `§3.6`. Un seul, pour que la réponse soit une seule. */
export function compareParentChildLinkRows(
  a: ParentChildLinkSortKey,
  b: ParentChildLinkSortKey,
): number {
  const rank = PARENT_CHILD_LINK_STATE_RANK[a.state] - PARENT_CHILD_LINK_STATE_RANK[b.state];
  if (rank !== 0) return rank;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
  if (a.id === b.id) return 0;
  return a.id < b.id ? 1 : -1;
}

/* ================================================================== *
 * §3.5 — LA FORME DU FIL : le composant ne reçoit AUCUN prédicat
 * ================================================================== */

/**
 * Une ligne du panneau parent. Elle remplace `ChildClaimStatusRow` — elle ne
 * cohabite pas avec elle : deux formes, c'est deux vérités (`DNC-01`).
 *
 * **Le `GuardianshipClaimStatus` brut QUITTE LE FIL.** Ni en `status`, ni imbriqué
 * sous un objet `claim`. Toute décision aval — `displayName`, `child`,
 * `decisionReason`, `canWithdraw`, `resubmit` — est DÉJÀ prise côté serveur.
 *
 * ⚠ `id` n'est PAS le `claimId`, et c'est le piège de `FM-6` : `id` vaut l'id du
 * `Guardianship` dès qu'un lien existe, alors que
 * `POST /parent/child-claims/:id/withdraw` attend un id de DEMANDE. Poster `id`
 * rendrait 404 sur exactement les lignes retirables. `claimId` est donc son
 * propre champ, et l'invariant `canWithdraw === true ⇒ claimId !== null` tient
 * par CONSTRUCTION (les deux dérivent de la même provenance) — assis par T-10.
 *
 * ⚠ `canWithdraw` conserve la sémantique d'aujourd'hui (`provenance?.status ===
 * 'submitted'`), ce qui PRÉSERVE DÉLIBÉRÉMENT une fuite déjà en production :
 * une ligne `match_failed` n'obtient pas le bouton « Annuler la demande » alors
 * qu'une ligne `submitted` appariée l'obtient, si bien que l'AFFORDANCE
 * distingue apparié de non apparié là où le libellé refuse de le faire. La
 * fermer exige d'élargir la garde de statut de `withdraw()` — une MUTATION, donc
 * `G-AUDIT`, donc sa propre tranche. Enregistré : **`PF-367`**. Ne pas
 * « améliorer » ici.
 */
export const ParentChildLinkRowSchema = z.object({
  /** id du `Guardianship` quand un lien existe, sinon id de la demande. */
  id: z.string(),
  state: z.enum(PARENT_CHILD_LINK_STATE),
  /** Résolu CÔTÉ SERVEUR (§3.4) — le portail ne choisit jamais entre deux noms. */
  displayName: z.string(),
  relationship: z.enum(GUARDIAN_RELATIONSHIP),
  child: z
    .object({
      studentId: UuidSchema,
      firstName: z.string(),
      lastName: z.string(),
    })
    .nullable(),
  /** La date de naissance que le PARENT a tapée, ou `null`. Jamais celle du dossier. */
  claimedBirthDate: z.string().nullable(),
  /** Non nul UNIQUEMENT sur `request_rejected`. */
  decisionReason: z.string().nullable(),
  /** L'action « Annuler la demande » en a besoin — voir l'avertissement `FM-6`. */
  claimId: UuidSchema.nullable(),
  canWithdraw: z.boolean(),
  /** `request_rejected` uniquement : de quoi pré-remplir le tiroir de renvoi. */
  resubmit: z
    .object({
      firstName: z.string(),
      lastName: z.string(),
      birthDate: z.string().nullable(),
      relationship: z.enum(GUARDIAN_RELATIONSHIP),
    })
    .nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ParentChildLinkRow = z.infer<typeof ParentChildLinkRowSchema>;

/**
 * L'enveloppe. La clé `links` est REQUISE — un `200` qui ne la porte pas est une
 * lecture ÉCHOUÉE, jamais une lecture vide (`ADR-073 §D6.5`, `FM-8`). C'est ce
 * qui empêche un décalage de déploiement (nouveau front, API pas encore
 * redémarrée) de recréer le défaut exact que cette tranche ferme, sous un
 * `?? []` qui paraîtrait prudent.
 */
export const ParentChildLinksResponseSchema = z.object({
  links: z.array(ParentChildLinkRowSchema),
});
export type ParentChildLinksResponse = z.infer<typeof ParentChildLinksResponseSchema>;
