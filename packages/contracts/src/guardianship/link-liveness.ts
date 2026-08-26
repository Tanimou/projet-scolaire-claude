/**
 * S-E03-3c / PF-12 / PF-358 / ADR-074 — LA dérivation canonique de « ce lien
 * parent↔enfant est-il VIVANT ? ».
 *
 * CE QUE CE MODULE REMPLACE
 * -------------------------
 * `Guardianship.status` était prédicaté de TROIS façons différentes, et une
 * quatrième fois PAS DU TOUT, sur ~20 sites de lecture de production mesurés le
 * 2026-08-26 :
 *
 *   (a) `status: 'active'`            — douze sites (ABAC parent, alertes,
 *                                       annonces, digest, exports…).
 *   (b) `status: { not: 'revoked' }`  — deux sites admin
 *                                       (`guardians.controller.ts:108`,
 *                                       `students.controller.ts:376`).
 *   (c) AUCUN prédicat                — les `_count`
 *                                       (`students.controller.ts:276`,
 *                                       `guardians.controller.ts:116` et
 *                                       `:201`), qui comptent donc les liens
 *                                       RÉVOQUÉS.
 *
 * (a) et (b) ne sont PAS la même question, et c'est le point : (a) demande
 * « ce parent garde-t-il cet enfant MAINTENANT ? », (b) demande « ce lien
 * est-il AU REGISTRE ? » — donc y compris une demande en attente de décision.
 * Les deux sont légitimes. Ce qui ne l'était pas, c'est qu'aucune des deux ne
 * portât de nom, si bien que le choix entre elles se faisait site par site, à
 * la main, et que (c) était indistinguable d'un oubli.
 *
 * LES DEUX CONTRADICTIONS MESURÉES, ET POURQUOI ELLES SONT DU RESSORT DE PF-12
 * ----------------------------------------------------------------------------
 * 1. UNE SEULE CHARGE UTILE SE CONTREDIT ELLE-MÊME. `GET /guardians` renvoie,
 *    sur le MÊME objet, `_count.guardianships` NON FILTRÉ (`:116`) et le
 *    tableau `guardianships` filtré `{ not: 'revoked' }` (`:118`). Un parent
 *    dont un rattachement a été révoqué s'affiche donc « 2 rattachements » au
 *    dessus d'une liste qui en montre un. Ce n'est pas une divergence entre
 *    deux écrans — c'est une contradiction interne à une réponse, la forme
 *    exacte que `PF-12` nomme.
 *
 * 2. LA SUPPRESSION D'UN PARENT EST BLOQUÉE PAR UN COMPTE QUE LE REMÈDE
 *    ANNONCÉ NE FAIT PAS BAISSER. `DELETE /guardians/:id` (`:199-208`) refuse
 *    tant que `_count.guardianships > 0`, NON FILTRÉ, en répondant
 *    « Ce parent est lié à des élèves. Révoquez d'abord les rattachements. »
 *    Or révoquer un rattachement le passe à `revoked` — que ce compte
 *    CONTINUE de compter. L'instruction que le message donne ne peut donc
 *    JAMAIS débloquer la suppression : l'utilisateur qui l'applique à la
 *    lettre reboucle indéfiniment. C'est le défaut le plus concret de la
 *    tranche, et il est fermé par un test rouge-avant / vert-après.
 *
 * LA DÉFINITION CANONIQUE (ADR-074 §2)
 * -------------------------------------
 * Deux portées NOMMÉES, et une troisième qui doit être DÉCLARÉE pour exister :
 *
 *   • VIVANT (`live`)        — `status ∈ {active}`. Le lien confère la
 *                              relation MAINTENANT. C'est la portée de tout
 *                              contrôle d'accès et de tout comptage de
 *                              « responsables » affiché à un humain.
 *
 *   • AU REGISTRE (`onTheBooks`) — `status ∈ {active, pending}`, c'est-à-dire
 *                              TOUT SAUF terminé. Le lien existe et n'a pas
 *                              été révoqué ; il peut être en attente d'une
 *                              décision humaine. Portée des écrans admin qui
 *                              doivent voir ce qui reste à trancher.
 *
 *   • TOUS LES ÉTATS         — `GUARDIANSHIP_ALL_STATES_ARE_DELIBERATE`. Une
 *                              lecture non filtrée reste licite (l'écran de
 *                              gestion des rattachements DOIT montrer les liens
 *                              révoqués) mais elle doit désormais le DIRE. Voir
 *                              §"pourquoi un marqueur" plus bas.
 *
 * POURQUOI « AU REGISTRE » EST DÉRIVÉ ET NON ÉCRIT (leçon de la course
 * `academic_year.SELECT`, run 59 — deux listes tenues à la main dérivent)
 * ----------------------------------------------------------------------
 * `{ not: 'revoked' }` et `{ in: ['active','pending'] }` ne sont équivalents
 * QUE tant que `GuardianshipStatus` compte exactement trois membres. Écrire
 * `['active','pending']` en littéral créerait une SECONDE liste à tenir à la
 * main en face de `schema.prisma:170-174` — précisément le couple qui a déjà
 * coûté un 503 sur quatre portails. `GUARDIANSHIP_ON_THE_BOOKS_STATUSES` est
 * donc DÉRIVÉ : « tous les états, moins l'état terminal ». Un quatrième membre
 * ajouté à l'énum y entre automatiquement, ce qui préserve exactement la
 * sémantique de `{ not: 'revoked' }` qu'il remplace, sans qu'aucun humain n'ait
 * à s'en souvenir.
 *
 * `GUARDIANSHIP_LIVE_STATUSES` est au contraire une liste POSITIVE, et c'est
 * l'asymétrie qui est voulue : un état nouveau ne doit JAMAIS devenir vivant —
 * donc conférer un accès — par le simple fait d'avoir été ajouté à une énum.
 * Le défaut sûr des deux portées penche du même côté : ne pas élargir l'accès.
 *
 * Un cliquet (`apps/api/src/shared/quality/guardianship-liveness-derivation-gate.spec.ts`)
 * assied que `GUARDIANSHIP_LINK_STATUSES` est byte-identique à l'énum Prisma
 * LUE dans `schema.prisma`, pour que la dérivation ci-dessus reste vraie.
 *
 * POURQUOI IL EST ICI, ET POURQUOI IL N'IMPORTE PAS PRISMA
 * -------------------------------------------------------
 * Mêmes raisons et même forme que les modules frères `academic-year/`
 * (ADR-070) et `enrollment/` (ADR-072) : `apps/api`, `apps/worker` ET
 * `apps/web` portent chacun des sites, et le seul foyer commun est
 * `@pilotage/contracts` — qui n'aura JAMAIS `@prisma/client` en dépendance
 * (GUARDRAILS §2). Ce module construit donc un fragment de `where` structurel
 * que le vrai `PrismaClient` accepte tel quel, et n'émet aucune requête.
 *
 * ⚠ CE PRÉDICAT EST À LA FOIS UN PRÉDICAT D'AFFICHAGE ET UN PRÉDICAT DE PORTÉE
 * -----------------------------------------------------------------------------
 * C'est la différence AVEC le module frère `enrollment/`, et elle doit être lue
 * avant tout usage. `selectActiveEnrollment` porte un avertissement inverse :
 * il ne doit JAMAIS être importé depuis un guard, parce qu'il AJOUTE une clause
 * d'année et rétrécirait donc une portée d'accès.
 *
 * Ici, il n'y a rien à ajouter : `guardianshipLiveWhere()` rend EXACTEMENT
 * `status: { in: ['active'] }`, qui est le `status: 'active'` que
 * `StudentAccessService` épelle déjà à la main, à la valeur près. La conversion
 * des sites ABAC est donc une opération SANS EFFET SÉMANTIQUE — et c'est la
 * seule raison pour laquelle elle est permise dans une tranche qui n'a pas le
 * droit de modifier une autorisation. Un test l'assied explicitement.
 *
 * ⚠ CE MODULE NE PARLE QUE DE `Guardianship.status`. Il ne parle NI de
 * `GuardianshipClaim.status` (la PROVENANCE — voir `child-link.ts`, ADR-073),
 * NI de `Enrollment.status` (l'INSCRIPTION — voir `enrollment/`, ADR-072). Ces
 * trois colonnes ont été confondues au moins une fois dans le registre : la
 * note résiduelle du run 84 range `student-access.service.ts:192` et
 * `digest-aggregate.service.ts:60` parmi les sites de garde alors que les deux
 * sont des prédicats d'INSCRIPTION. C'est enregistré en `PF-374`.
 */

/* ================================================================== *
 * §2.1 — LE VOCABULAIRE, ÉNONCÉ UNE FOIS
 * ================================================================== */

/**
 * Les trois membres de `GuardianshipStatus` (`schema.prisma:170-174`), dans
 * l'ordre de déclaration du schéma. Le cliquet assied l'égalité byte-à-byte
 * avec l'énum Prisma : c'est la SOURCE, pas une copie de confort.
 */
export const GUARDIANSHIP_LINK_STATUSES = ['pending', 'active', 'revoked'] as const;
export type GuardianshipLinkStatus = (typeof GUARDIANSHIP_LINK_STATUSES)[number];

/**
 * L'état TERMINAL — le seul qui retire le lien du registre. Nommé séparément
 * parce que la portée « au registre » se dérive de lui par soustraction.
 */
export const GUARDIANSHIP_ENDED_STATUS: GuardianshipLinkStatus = 'revoked';

/**
 * §2.2 — VIVANT. Liste POSITIVE, délibérément : un état ajouté plus tard ne
 * doit pas conférer un accès par défaut.
 */
export const GUARDIANSHIP_LIVE_STATUSES: readonly GuardianshipLinkStatus[] = ['active'] as const;

/**
 * §2.3 — AU REGISTRE. DÉRIVÉ par soustraction de l'état terminal, jamais écrit
 * en littéral : c'est ce qui garde l'équivalence avec le `{ not: 'revoked' }`
 * que cette constante remplace, sans tenir une seconde liste à la main.
 */
export const GUARDIANSHIP_ON_THE_BOOKS_STATUSES: readonly GuardianshipLinkStatus[] =
  GUARDIANSHIP_LINK_STATUSES.filter((s) => s !== GUARDIANSHIP_ENDED_STATUS);

/* ================================================================== *
 * §2.4 — LES CONSTRUCTEURS DE `where`
 * ================================================================== */

/**
 * Le fragment de `where` que Prisma accepte tel quel. Structurel, pour que
 * `@pilotage/contracts` reste sans dépendance Prisma (GUARDRAILS §2).
 *
 * ⚠ LE TABLEAU EST MUTABLE, ET CE N'EST PAS UN RELÂCHEMENT. `EnumGuardianshipStatusFilter`
 * déclare `in?: GuardianshipStatus[]` — un tableau MUTABLE. Un `readonly
 * GuardianshipLinkStatus[]` y est refusé (`TS2322` : *"is 'readonly' and cannot
 * be assigned to the mutable type"*), sur les deux applications. Le typecheck
 * l'a dit avant que quiconque ne le suppose.
 *
 * Les CONSTANTES restent `readonly` — c'est là que l'immuabilité compte, parce
 * qu'elles sont partagées. Chaque appel de constructeur COPIE (`[...]`) et rend
 * donc un tableau frais : aucun appelant ne peut muter la liste canonique par
 * le `where` qu'il vient de recevoir, ce qu'un `as` aurait au contraire permis
 * en silence.
 */
export interface GuardianshipStatusFilter {
  readonly status: { in: GuardianshipLinkStatus[] };
}

/**
 * « Ce lien confère-t-il la relation MAINTENANT ? » — la portée de tout
 * contrôle d'accès et de tout comptage montré à un humain.
 *
 * Équivaut, à la valeur près, au `status: 'active'` que douze sites épellent
 * aujourd'hui à la main. La conversion est donc sans effet sémantique.
 */
export function guardianshipLiveWhere(): GuardianshipStatusFilter {
  return { status: { in: [...GUARDIANSHIP_LIVE_STATUSES] } };
}

/**
 * « Ce lien est-il AU REGISTRE ? » — vivant OU en attente d'une décision
 * humaine ; tout sauf révoqué. Remplace `{ not: 'revoked' }`.
 */
export function guardianshipOnTheBooksWhere(): GuardianshipStatusFilter {
  return { status: { in: [...GUARDIANSHIP_ON_THE_BOOKS_STATUSES] } };
}

/* ================================================================== *
 * §2.5 — LES PRÉDICATS EN MÉMOIRE
 * ================================================================== */

/**
 * La forme minimale qu'une ligne doit porter pour être jugée. Volontairement
 * structurelle : une ligne Prisma complète la satisfait, un fixture de test
 * aussi, et le module n'a besoin d'aucun type généré.
 */
export interface GuardianshipLivenessRow {
  readonly status: GuardianshipLinkStatus;
}

/**
 * LE prédicat que la note résiduelle du run 84 réclamait sous ce nom exact.
 *
 * ⚠ Un `where` corrigé côté base doit l'être aussi en mémoire : narrower la
 * requête seule déplacerait la contradiction de Postgres vers le processus
 * (la leçon de `dedupKey()`, ADR-068 §3). Les deux moitiés vivent donc ici.
 */
export function isLiveGuardianship(row: GuardianshipLivenessRow): boolean {
  return GUARDIANSHIP_LIVE_STATUSES.includes(row.status);
}

/** Le pendant en mémoire de `guardianshipOnTheBooksWhere()`. */
export function isGuardianshipOnTheBooks(row: GuardianshipLivenessRow): boolean {
  return GUARDIANSHIP_ON_THE_BOOKS_STATUSES.includes(row.status);
}

/* ================================================================== *
 * §2.6 — L'ÉTIQUETTE DE PORTÉE, ET LE MARQUEUR D'INTENTION
 * ================================================================== */

/**
 * L'étiquette que la surface affiche à côté d'un compte, pour que le nombre
 * porte sa portée (ADR-041 §D3 : « the label is what makes a number honest »).
 */
export const GUARDIANSHIP_SCOPE_LABEL = {
  live: 'Rattachements actifs',
  onTheBooks: 'Rattachements au registre (actifs et en attente)',
  allStates: 'Tous les rattachements, révoqués compris',
} as const;

/**
 * POURQUOI UN MARQUEUR PLUTÔT QU'UNE ALLOWLIST DANS LE CLIQUET
 * ------------------------------------------------------------
 * Une lecture non filtrée reste parfaitement licite : l'écran admin de gestion
 * des rattachements (`guardians.controller.ts` `GET guardianships/list`) DOIT
 * montrer les liens révoqués — c'est sa raison d'être, et son `orderBy` trie
 * déjà sur `status`. Le défaut n'a jamais été « une lecture non filtrée »,
 * c'est « une lecture non filtrée INDISTINGUABLE d'un oubli ».
 *
 * Le cliquet ne peut pas trancher cela tout seul, et une allowlist de fichiers
 * dans le cliquet serait l'une des trois sorties interdites
 * (`academic-year-resolution-gate.spec.ts:20-32`). Le site DÉCLARE donc son
 * intention, dans son propre code, à l'endroit où un relecteur la verra :
 *
 *     // eslint-disable-next-line @typescript-eslint/no-unused-vars -- N/A
 *     GUARDIANSHIP_ALL_STATES_ARE_DELIBERATE;
 *
 * La différence est celle entre une exception accordée par le gate et une
 * décision prise par l'auteur : la seconde se relit, la première s'oublie.
 */
export const GUARDIANSHIP_ALL_STATES_ARE_DELIBERATE = 'guardianship:all-states:deliberate' as const;
