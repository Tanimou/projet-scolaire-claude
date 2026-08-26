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
  /**
   * §2.7 / ADR-075 §D2 — la portée du KPI « Demandes en attente », du compte du
   * centre d'action et de la file `/admin/enrollments`. La chaîne est IDENTIQUE
   * aux trois endroits, et c'est la vérification visuelle de l'accord : si deux
   * surfaces affichent deux portées différentes, elles ne comptent pas la même
   * population, et l'une des deux ment.
   */
  awaitingDecision: 'Demandes de rattachement en attente d’une décision, pour cette école.',
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

/* ================================================================== *
 * §2.7 — « CETTE DEMANDE DE RATTACHEMENT ATTEND-ELLE UNE DÉCISION ? »
 *        (S-E03-5 / PF-20 / PF-373 / ADR-075)
 * ================================================================== */

/**
 * POURQUOI CETTE SECTION VIT ICI ET NON DANS UN CINQUIÈME MODULE FRÈRE
 * --------------------------------------------------------------------
 * `PF-365` / `PF-370` nomment déjà la prolifération de modules frères dans
 * `packages/contracts` comme un défaut ouvert. La question posée ici — « ce
 * lien attend-il une décision humaine ? » — est une TROISIÈME portée sur LA
 * MÊME colonne (`Guardianship.status`) que §2.2 et §2.3. Un module séparé
 * aurait dû ré-importer tout le vocabulaire de §2.1 pour ne rien ajouter
 * d'autre qu'une quatrième liste à tenir en face de la même énum Prisma.
 *
 * LE SUBSTITUT, ÉNONCÉ UNE FOIS, ICI
 * -----------------------------------
 * `EnrollmentRequest` N'EXISTE PAS dans `schema.prisma`. Le produit compte donc
 * les `Guardianship` en attente comme substitut d'une « demande d'inscription ».
 * Cet aveu vivait en commentaire dans `analytics.service.ts:2471`, au-dessus
 * d'UN des trois sites qui le pratiquaient — les deux autres l'appliquaient
 * sans le dire. Il est désormais énoncé LÀ OÙ LE SUBSTITUT EST DÉFINI, une
 * seule fois, pour que le prochain lecteur d'un de ces trois nombres tombe
 * dessus par le code plutôt que par chance.
 *
 * LA LISTE EST POSITIVE, COMME §2.2 ET CONTRAIREMENT À §2.3
 * ---------------------------------------------------------
 * `GUARDIANSHIP_AWAITING_DECISION_STATUSES` est écrite en toutes lettres et
 * NON dérivée par soustraction. L'asymétrie est la même que celle de §2.2 et
 * pour une raison voisine : un quatrième membre ajouté à `GuardianshipStatus`
 * ne doit pas devenir « en attente d'une décision admin » — donc s'ajouter au
 * KPI d'un directeur et à sa file de travail — par le simple fait d'avoir été
 * ajouté à une énum. Le défaut sûr penche du côté de ne pas inventer du travail
 * que personne n'a décidé.
 *
 * LA PORTÉE EST L'ÉCOLE, SUR L'AXE `student` (ADR-075 §D2)
 * --------------------------------------------------------
 * `Guardianship` ne porte PAS de `schoolId` (`schema.prisma:567-593`) ; les
 * deux axes disponibles sont `guardian.schoolId` et `student.schoolId`, et ils
 * PEUVENT diverger : `createGuardianship` refuse la création quand ils ne sont
 * pas égaux, mais c'est un contrôle À L'ÉCRITURE SEULEMENT — rien n'empêche une
 * mutation ultérieure de l'un des deux, ni une ligne importée d'être déjà
 * désalignée. Le choix n'est donc pas cosmétique.
 *
 * C'est `student.schoolId` :
 *   • la décision que l'admin prend porte sur le rattachement d'un ENFANT à
 *     SON établissement ;
 *   • `Student.schoolId` est l'axe de tous les autres KPI du tableau de bord
 *     admin (les six frères du même `Promise.all` sont `{tenantId, schoolId}`) ;
 *   • `Guardian.schoolId` est posé depuis le contexte de l'admin CRÉATEUR, ce
 *     qui en fait un axe de provenance, pas un axe de responsabilité.
 *
 * CONSÉQUENCE ASSUMÉE ET DÉCLARÉE : le KPI « Demandes en attente » CHANGE de
 * valeur pour tout tenant multi-écoles. Il était tenant-wide, seul au milieu de
 * six frères scopés à l'école ; il devient plus petit, et plus vrai — il compte
 * enfin la population que la file où son CTA envoie va montrer.
 *
 * LES DEUX CLÉS SONT REQUISES, ET C'EST LA MOITIÉ DU POINT (ADR-065 §D5)
 * ----------------------------------------------------------------------
 * `GuardianshipPendingRequestScope` déclare `tenantId` ET `schoolId` comme
 * champs REQUIS d'un argument REQUIS. Un
 * `...(schoolId ? { student: { schoolId } } : {})` devient donc INEXPRIMABLE
 * plutôt que déconseillé : Prisma laisse tomber une clé `undefined` en silence,
 * et la requête s'ÉLARGIT — c'est exactement la forme fail-open qui a fait
 * vivre ce défaut, et le typage est la seule des deux moitiés qui empêche la
 * récidive.
 *
 * De la même façon, le constructeur rend la portée COMPLÈTE en un seul appel
 * (tenant + école + statut). Aucun site appelant ne peut en épeler la moitié :
 * il n'existe pas de fragment « juste le statut » exposé pour cette question.
 */

/**
 * §2.7.1 — EN ATTENTE D'UNE DÉCISION. Liste POSITIVE (voir le docblock).
 */
export const GUARDIANSHIP_AWAITING_DECISION_STATUSES: readonly GuardianshipLinkStatus[] = [
  'pending',
] as const;

/**
 * §2.7.2 — La portée d'une file de demandes. Les DEUX clés sont requises ; il
 * n'existe pas de variante « tenant seul ».
 */
export interface GuardianshipPendingRequestScope {
  readonly tenantId: string;
  readonly schoolId: string;
}

/**
 * Le fragment de `where` COMPLET : le tenant, l'école (par l'élève), et le
 * statut. Structurel, accepté tel quel par Prisma, sans dépendance générée.
 *
 * Le tableau `in` est MUTABLE pour la même raison qu'en §2.4 : Prisma déclare
 * `in?: GuardianshipStatus[]`, et un `readonly` y est refusé (`TS2322`). Chaque
 * appel COPIE, donc aucun appelant ne peut muter la liste canonique.
 */
export interface GuardianshipRequestQueueFilter {
  readonly tenantId: string;
  readonly student: { schoolId: string };
  readonly status: { in: GuardianshipLinkStatus[] };
}

/**
 * §2.7.3 — LE constructeur de portée de la file. Un seul, paramétré par les
 * états demandés, pour que la file (qui doit pouvoir montrer les demandes déjà
 * tranchées, sans quoi son onglet « Rejetées » serait structurellement vide —
 * `DNC-06` déplacé au lieu d'être retiré) et le KPI (qui ne compte que celles
 * en attente) partagent LITTÉRALEMENT la même jointure et le même axe école.
 *
 * ⚠ `statuses` n'a PAS de valeur par défaut : le passer est obligatoire, et les
 * seules valeurs licites viennent des constantes de ce module ou de
 * `GUARDIANSHIP_LINK_STATUSES` lui-même. Un appelant qui écrirait la liste en
 * littéral serait signalé par le cliquet
 * (`guardianship-pending-request-derivation-gate.spec.ts`).
 */
export function guardianshipRequestQueueWhere(
  scope: GuardianshipPendingRequestScope,
  statuses: readonly GuardianshipLinkStatus[],
): GuardianshipRequestQueueFilter {
  return {
    tenantId: scope.tenantId,
    student: { schoolId: scope.schoolId },
    status: { in: [...statuses] },
  };
}

/**
 * §2.7.4 — « Combien de demandes de rattachement attendent l'admin ? »
 *
 * LE prédicat unique dont dérivent le KPI du tableau de bord, la courbe sous ce
 * KPI, le compte du centre d'action, sa liste d'aperçu, et la file
 * `/admin/enrollments` où le CTA « Examiner » envoie. Tant qu'ils passent tous
 * par ici, le nombre annoncé et la liste affichée ne peuvent plus se
 * contredire — c'est l'énoncé de `PF-20` retourné en invariant.
 */
export function guardianshipPendingRequestWhere(
  scope: GuardianshipPendingRequestScope,
): GuardianshipRequestQueueFilter {
  return guardianshipRequestQueueWhere(scope, GUARDIANSHIP_AWAITING_DECISION_STATUSES);
}

/**
 * §2.7.5 — Le pendant EN MÉMOIRE, convention §2.5.
 *
 * Sans lui, corriger le `where` seul déplacerait la contradiction de Postgres
 * vers le processus : c'est exactement ce que faisaient
 * `child-claims.service.ts:240` (« une demande est-elle déjà en attente ? ») et
 * les trois surfaces admin qui comparaient le statut à la main.
 */
export function isGuardianshipAwaitingDecision(row: GuardianshipLivenessRow): boolean {
  return GUARDIANSHIP_AWAITING_DECISION_STATUSES.includes(row.status);
}

/* ================================================================== *
 * §2.8 — LA LIGNE DE LA FILE, DÉCLARÉE UNE FOIS
 * ================================================================== */

/**
 * La forme d'une ligne de la file des demandes de rattachement, telle que
 * `GET /api/v1/guardians/guardianships/pending-requests` la rend.
 *
 * POURQUOI ELLE EST DANS LE CONTRAT
 * ----------------------------------
 * `PF-371` nomme la classe : « un MIROIR FE écrit à la main d'un contrat livré,
 * sans rien qui tienne les deux en phase ». `admin/enrollments/page.tsx:25-43`
 * en était la démonstration la plus coûteuse du dépôt : il déclarait à la main
 * une forme de `Guardianship` (avec `status`, `notes`, `relationship`) alors que
 * l'endpoint appelé rendait des `Guardian`, qui n'ont NI `status` NI `notes`.
 * `api<T>()` CASTE sans valider, donc le compilateur ne pouvait rien voir, et
 * les cinq onglets de la page comparaient `undefined` à un littéral — toujours
 * faux, pour tout tenant, depuis toujours.
 *
 * ⚠ EXPORTÉE EN `type` SEULEMENT, et par ce module UNIQUEMENT. Un second export
 * du même nom par un autre module du paquet produirait `TS2308` au barrel
 * racine (`PF-368`, tombé une fois).
 */
export interface GuardianshipPendingRequestRow {
  readonly id: string;
  readonly status: GuardianshipLinkStatus;
  readonly relationship: string;
  readonly notes: string | null;
  readonly createdAt: string;
  readonly guardian: {
    readonly id: string;
    readonly firstName: string;
    readonly lastName: string;
    readonly email: string | null;
    readonly phone: string | null;
  };
  readonly student: {
    readonly id: string;
    readonly firstName: string;
    readonly lastName: string;
    readonly enrollments: ReadonlyArray<{
      readonly classSection: { readonly name: string } | null;
    }>;
  };
}

/**
 * L'enveloppe paginée. `total` et `totalsByStatus` sont des comptes SERVEUR sur
 * le MÊME `where` que `data` — jamais un `.length` de page.
 *
 * C'est la moitié de `PF-20` que la forme de ligne seule ne fermerait pas : une
 * file dont les badges comptent une page tronquée, sous un KPI qui compte la
 * base, remplace une contradiction visible (« 28 vs 0 ») par une contradiction
 * discrète (« 28 vs 19 ») — ce qui est pire, parce qu'elle ne se voit plus.
 */
export interface GuardianshipPendingRequestPage {
  readonly data: readonly GuardianshipPendingRequestRow[];
  readonly page: number;
  readonly pageSize: number;
  /** Le nombre de lignes que le `where` COURANT sélectionne, compté en base. */
  readonly total: number;
  /** Un compte serveur PAR ÉTAT, sur la portée (tenant+école), tous états confondus. */
  readonly totalsByStatus: Readonly<Record<GuardianshipLinkStatus, number>>;
  readonly guardianshipScope: string;
}
