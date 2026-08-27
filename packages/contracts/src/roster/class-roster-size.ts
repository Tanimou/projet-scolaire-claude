/**
 * S-E03-7 / PF-36 / ADR-079 — LA dérivation canonique de « combien d'élèves
 * sont inscrits ici ? ».
 *
 * CE QUE CE MODULE REMPLACE
 * -------------------------
 * L'audit interne (`02_Internal_Platform_Audit.md:140`) mesure : « 48 élèves
 * dans un contexte, 46 en cumul dans un autre, 43 distincts dans un troisième,
 * et une classe qui alterne entre 25 et 26 ». Les trois nombres ne sont pas
 * trois bugs : ce sont TROIS QUESTIONS DIFFÉRENTES portant UN SEUL NOM.
 *
 *   VARIANTE A — `_count: { select: { enrollments: true } }` ancré sur la
 *                SECTION : compte les SIX valeurs de `EnrollmentStatus`, donc un
 *                élève `dropped` ou `graduated` reste « dans la classe ».
 *                C'est le 48, et c'est l'alternance 25/26 : `GET /classes/:id`
 *                rendait `_count.enrollments` (six statuts) À CÔTÉ de
 *                `capacity.current` (= `enrollments.length`, `active` seul),
 *                DEUX effectifs contradictoires DANS LA MÊME charge utile.
 *
 *   VARIANTE B — `_count: { select: { enrollments: { where: { status:
 *                'active' } } } }` : les assis seuls. C'est le 46 une fois
 *                CUMULÉ sur les affectations de l'enseignant
 *                (`analytics.service.ts:1821`, `stat.studentCount += …`).
 *
 *   VARIANTE C — `new Set(rows.map((e) => e.studentId)).size`
 *                (`teachers.controller.ts:400-418`) : les élèves DISTINCTS.
 *                C'est le 43.
 *
 * B-cumulé et C ne peuvent PAS s'accorder par construction, et c'est le cœur de
 * cette tranche : voir « POURQUOI SOMMER EST FAUX » ci-dessous.
 *
 * LES DEUX QUESTIONS, SÉPARÉES PAR LE NOM (FR-2 / AC-2)
 * -----------------------------------------------------
 *   QUESTION 1 — `classRosterSize` : l'EFFECTIF D'UNE SECTION. Combien de
 *                lignes d'inscription d'une population nommée porte CETTE
 *                section, cette année-là. Une PLACE occupée.
 *
 *   QUESTION 2 — `countDistinctStudents` : le nombre d'ÉLÈVES DISTINCTS sur un
 *                ENSEMBLE de sections. Une TÊTE.
 *
 * Un effectif est un nombre de PLACES ; un nombre d'élèves est un nombre de
 * TÊTES. Les deux coïncident sur UNE section (l'index unique le garantit, voir
 * plus bas) et divergent dès qu'il y en a deux.
 *
 * ⚠ POURQUOI SOMMER LES EFFECTIFS NE RÉPOND JAMAIS À LA QUESTION 2 (AC-2)
 * -----------------------------------------------------------------------
 * L'effectif d'UNE section est HONNÊTE parce que l'index unique à trois
 * colonnes `@@unique([studentId, classSectionId, academicYearId])`
 * (`schema.prisma:669`) EXISTE — mesuré vivant sur `localhost:5432/pilotage` :
 * `enrollment_student_id_class_section_id_academic_year_id_key`. Un élève ne
 * peut donc pas être compté deux fois DANS UNE section pour une année.
 *
 * La SOMME des effectifs ne serait un nombre d'élèves que sous l'invariant
 * « au plus une inscription active par élève et par année ». Cet invariant est
 * AFFIRMÉ par un commentaire de `schema.prisma` juste au-dessus de cet index
 * (« … via a partial unique index in migration SQL ») et **il n'existe pas** :
 * `select indexname from pg_indexes where tablename='enrollment'` rend
 * exactement cinq index, aucun partiel, aucun sur `(student_id,
 * academic_year_id)` ; un `grep` sur les `migration.sql` de
 * `apps/api/prisma/migrations/` ne rend que l'unique à trois colonnes du
 * `0_baseline`. C'est PF-361, déjà
 * enregistrée, et cette tranche lui ajoute une preuve d'un cran supérieur
 * (`pg_indexes` contre la base vivante plutôt que le SQL de migration).
 *
 * Pire : les deux invariants sont EN OPPOSITION DIRECTE, à trois lignes d'écart
 * dans le même fichier, et **c'est le permissif qui est appliqué**. L'index à
 * trois colonnes AUTORISE explicitement un élève à porter deux inscriptions
 * `active` la même année dans DEUX sections. Un élève partagé entre la 6ᵉA et
 * la 6ᵉB n'est donc pas une anomalie de données : c'est le schéma tel qu'il est
 * livré. `B-cumulé > C` est le schéma qui fonctionne, pas une corruption.
 *
 * Conséquence de conception : la QUESTION 2 est CORRECTE PAR CONSTRUCTION —
 * elle DÉ-DUPLIQUE par `studentId`, TOUJOURS, donc elle rend le même nombre que
 * l'invariant manquant existe ou non. La tranche N'AJOUTE PAS l'index (FR-10) :
 * (a) un index unique partiel peut échouer sur des données existantes et
 * transformerait une story de vérité de LECTURE en migration de DONNÉES ;
 * (b) une dérivation qui n'est correcte QUE PARCE QU'un invariant tient est
 * exactement la fragilité dont PF-36 est fait ; (c) l'ajouter contredirait une
 * clé DÉJÀ LIVRÉE, ce qui en fait une décision de MODÈLE MÉTIER (« un élève
 * peut-il suivre deux sections la même année ? ») qu'une base vide ne peut pas
 * trancher. `G-MIGRATION` n'est donc pas déclenché.
 *
 * ET POURQUOI SOMMER EST PARFOIS JUSTE — `sumRosterSizes`
 * -------------------------------------------------------
 * Sommer des effectifs est CORRECT pour un TAUX D'OCCUPATION : `taux =
 * Σ effectifs ÷ Σ places` (`analytics.service.ts:3537`, `structure.controller
 * .ts:132`) compare des PLACES à des PLACES sur des sections DISJOINTES. Le
 * nombre rendu, `SummedRosterSizes`, est donc un nombre de PLACES OCCUPÉES et
 * son type le dit. Il n'est PAS assignable à `DistinctStudentCount` — un test
 * de type (`@ts-expect-error`) l'assied. C'est la FORME DU TYPE qui applique la
 * règle : `AC-2` note que le commentaire seul est ce que §1c avait déjà tenté,
 * et perdu.
 *
 * POURQUOI IL EST ICI, ET POURQUOI IL N'IMPORTE PAS PRISMA
 * -------------------------------------------------------
 * Même forme que les cinq modules frères (`academic-year/`, `enrollment/`,
 * `guardianship/`, `calendar/`, `school-time/`), et pour les mêmes raisons
 * (ADR-070 §D1) : `apps/api`, `apps/worker` ET `apps/web` portent des sites,
 * `apps/worker/tsconfig.json` fixe `rootDir: ./src`, et le seul foyer commun est
 * `@pilotage/contracts` — qui n'aura JAMAIS `@prisma/client` en dépendance
 * (GUARDRAILS §2, paquet construit en CJS et consommé par `apps/web`). Ce module
 * construit donc des `where` et des arguments de `_count` ; l'adaptateur
 * `apps/api/src/shared/roster/prisma-roster-reader.ts` les passe à Prisma.
 *
 * Poser la dérivation sous `apps/api/src/shared/` créerait un SIXIÈME foyer hors
 * famille (PF-365 aggravée), inatteignable depuis `apps/web` (PF-414) et depuis
 * `apps/worker`. Le pointeur `apps/api/src/shared/academic-year/
 * resolve-academic-year.ts` de l'argumentaire reçu N'EXISTE PAS : ce dossier ne
 * porte que l'adaptateur et la spec.
 *
 * IL EST DISJOINT DE `enrollment/select-active-enrollment.ts`, ET C'EST LE POINT
 * -----------------------------------------------------------------------------
 * Le module frère répond « CET ENFANT est-il activement inscrit ? » — une
 * question ANCRÉE SUR L'ÉLÈVE, qui produit un ÉTAT (`active` /`out_of_scope` /
 * `none`) et un LABEL. Celui-ci répond « combien d'élèves ICI ? » — une question
 * ANCRÉE SUR LA SECTION, qui produit un NOMBRE. Le cliquet d'ADR-072
 * (`enrollment-activity-derivation-gate.spec.ts:38-46`) EXCLUT délibérément la
 * famille ancrée sur la section : « ils comptent un effectif, ils n'affirment pas
 * l'activité d'UN enfant ». Cet ensemble exclu est EXACTEMENT celui que PF-36
 * occupe. Les deux ADR PARTITIONNENT la surface de lecture des inscriptions ;
 * elles ne se recouvrent pas, et aucun site n'a à importer les deux pour poser
 * une seule question.
 *
 * CE MODULE HÉRITE, IL NE RÉSOUT PAS (DNC-06)
 * --------------------------------------------
 * - PF-361 — l'index unique partiel promis par `schema.prisma:669-670` n'existe
 *   pas. Hérité, annoté, NON corrigé. La dé-duplication le rend sans effet sur
 *   la QUESTION 2 ; elle ne le fait pas exister.
 * - PF-409 — rien ne lie `Enrollment.academicYearId` à
 *   `ClassSection.academicYearId` : ni clé étrangère composite, ni `CHECK`, ni
 *   déclencheur (mesuré : `pg_constraint` sur `enrollment` rend 4 lignes, aucune
 *   ne porte cette paire). Un `_count` imbriqué sur `ClassSection.enrollments`
 *   est donc SANS PORTÉE D'ANNÉE, même quand la section, elle, appartient à une
 *   année. C'est pourquoi la portée d'année est DÉCLARÉE ici plutôt que
 *   supposée : `ROSTER_YEAR_IMPLIED_BY_SECTION` NOMME l'hypothèse au lieu de la
 *   taire. Hérité, NON corrigé.
 * - PF-415 — `enrollment.tenant_id` ne porte NI clé étrangère NI contrainte : la
 *   base ne rattrape pas un `_count` imbriqué dont le tenant vient du `where`
 *   parent. Ce module EXIGE `tenantId` DANS SON TYPE pour toute lecture DIRECTE
 *   (patron ADR-070 §D3) ; il ne peut rien exiger d'un `_count` imbriqué, dont
 *   Prisma n'expose pas la colonne. Enregistré, NON corrigé ici.
 * - PF-411 — `classSize` désigne TROIS populations dans le produit : les
 *   INSCRITS (ce module), les NOTÉS (`analytics.service.ts:1571`,
 *   `new Set(classGrades.map((g) => g.studentId)).size`) et les CLASSÉS. Le
 *   dénominateur de rang que le portail PARENT affiche (« 12 / 26 ») est celui
 *   des NOTÉS, et c'est le bon pour un RANG — on ne classe pas un enfant contre
 *   un camarade qui n'a aucune note. Le pointer vers l'effectif canonique serait
 *   une régression, pas une correction. `gradedPopulationSize` est donc exporté
 *   en TYPE SEULEMENT : le nom existe pour que personne ne le confonde avec un
 *   effectif, et aucune fonction ne le calcule ici.
 *
 * LA DÉFINITION N'EST PAS RATIFIÉE (`confirmed: false`)
 * -----------------------------------------------------
 * ADR-041 (Consequences) : ce sont des défauts produit défendables choisis par
 * la routine pour débloquer un épic, PAS des définitions confirmées avec un
 * utilisateur école.
 *
 * AUCUNE HORLOGE ICI — aucun `new Date(`, aucun `Date.now(`.
 */

/* ================================================================== *
 * LES POPULATIONS — DÉRIVÉES de `enum EnrollmentStatus`, jamais devinées
 * ================================================================== */

/**
 * Le miroir de `enum EnrollmentStatus` (`schema.prisma:176-183`), DANS L'ORDRE
 * DE DÉCLARATION. Le cliquet `class-roster-size-derivation-gate.spec.ts` le
 * compare BYTE À BYTE à l'énum lu dans le schéma : un septième membre FAIT
 * ROUGIR au lieu de se ranger en silence dans « tous les autres » (FR-4).
 *
 * `string` et non un enum Prisma : ce paquet ne dépend pas de `@prisma/client`.
 */
export const ROSTER_ALL_STATUSES = [
  'pending',
  'active',
  'transferred_in',
  'transferred_out',
  'graduated',
  'dropped',
] as const;
export type RosterStatus = (typeof ROSTER_ALL_STATUSES)[number];

/**
 * LES ASSIS — ceux qui occupent une place aujourd'hui. Liste POSITIVE et non un
 * complément : « qui est assis » doit rester lisible sans calculer une
 * soustraction, et un nouveau statut ne doit pas devenir un assis par défaut.
 *
 * `transferred_in` n'y figure PAS, délibérément : c'est un statut de PROVENANCE,
 * et la migration d'import le fait suivre d'une ligne `active`. L'y ajouter
 * changerait des nombres affichés sans mesure préalable — hors périmètre, et
 * `ROSTER_ON_THE_BOOKS_STATUSES` existe pour le site qui en aurait besoin.
 */
export const ROSTER_SEATED_STATUSES = ['active'] as const satisfies readonly RosterStatus[];

/** LES SORTIS — l'enfant n'occupe plus de place. Liste POSITIVE. */
export const ROSTER_EXIT_STATUSES = [
  'transferred_out',
  'graduated',
  'dropped',
] as const satisfies readonly RosterStatus[];

/** LES ATTENDUS — un dossier déposé, pas encore une place. */
export const ROSTER_AWAITING_STATUSES = ['pending'] as const satisfies readonly RosterStatus[];

/**
 * SUR LES REGISTRES — tout SAUF les sortis. **DÉRIVÉE**, jamais écrite : deux
 * listes tenues à la main divergent en silence, et c'est le mode de panne que
 * cette maison a déjà mesuré (`project_paired_lists_drift`).
 */
export const ROSTER_ON_THE_BOOKS_STATUSES: readonly RosterStatus[] = ROSTER_ALL_STATUSES.filter(
  (status) => !(ROSTER_EXIT_STATUSES as readonly string[]).includes(status),
);

/**
 * Les populations, PAR LEUR NOM. Un site qui veut autre chose que « les assis »
 * la demande ICI ; il n'écrit plus de `where` à la main (FR-3).
 *
 *   `seated`         — les assis : la place est occupée. LE DÉFAUT.
 *   `onTheBooks`     — sur les registres : assis + attendus + entrants.
 *   `awaiting`       — les dossiers en attente (file d'admission).
 *   `everRegistered` — tout ce qui a jamais existé, y compris les sortis. C'est
 *                      la VARIANTE A, et elle reste NOMMABLE parce que sept
 *                      sites la veulent DÉLIBÉRÉMENT (voir ci-dessous).
 */
export type RosterPopulation = 'seated' | 'onTheBooks' | 'awaiting' | 'everRegistered';

/**
 * Le prédicat de population, énoncé UNE fois (FR-3).
 *
 * ⚠ REND UNE COPIE FRAÎCHE ET MUTABLE, DÉLIBÉRÉMENT. Les listes SOURCES restent
 * `as const` — le cliquet les compare octet pour octet à l'énumération Prisma, et
 * une liste module-niveau rendue telle quelle serait mutable par n'importe quel
 * appelant (la règle déjà énoncée pour `enrollmentTotalOrder()`). Mais Prisma 5.22
 * déclare ses filtres en tableaux MUTABLES (`EnumEnrollmentStatusFilter.in?:
 * EnrollmentStatus[]`, `UuidFilter.in?: string[]`) : un `readonly` n'y est pas
 * assignable (TS4104/TS2322), et le rejet du littéral fait effondrer l'inférence
 * de charge utile de Prisma sur TOUS les sites. La copie satisfait les deux
 * contraintes à la fois — source figée, argument assignable.
 */
export function rosterStatusesFor(population: RosterPopulation): RosterStatus[] {
  switch (population) {
    case 'seated':
      return [...ROSTER_SEATED_STATUSES];
    case 'onTheBooks':
      return [...ROSTER_ON_THE_BOOKS_STATUSES];
    case 'awaiting':
      return [...ROSTER_AWAITING_STATUSES];
    case 'everRegistered':
      return [...ROSTER_ALL_STATUSES];
  }
}

/**
 * LES SEPT SITES `_count` NON FILTRÉS QUI RESTENT NON FILTRÉS, ET POURQUOI
 * (FR-3 / AC-3)
 * ------------------------------------------------------------------------
 * Ils sont ancrés sur l'ÉLÈVE, pas sur la section, et ils ne posent donc PAS la
 * question de ce module. Les convertir serait une erreur de catégorie, et pour
 * deux d'entre eux une régression de sûreté. Le cliquet porte un contrôle
 * POSITIF qui assied qu'ils PASSENT — sans lui, il exigerait de casser ADR-072.
 *
 *   `alerts/meeting-requests.service.ts:82,:235,:359,:419` — alimentent
 *     `totalEnrollmentCount` d'ADR-072. Sans le total NON FILTRÉ, un enfant
 *     diplômé serait classé `none` (« aucun dossier ») au lieu d'`out_of_scope`
 *     (« hors année en cours ») — une réponse fausse, pas seulement imprécise.
 *   `analytics/analytics.service.ts:842,:996` — même rôle, et le fichier porte
 *     déjà le commentaire qui le dit.
 *   `students/students.controller.ts:546` — c'est une GARDE DE SUPPRESSION
 *     (`if (student._count.enrollments > 0) throw`). La router vers une
 *     population « assis » laisserait un admin supprimer définitivement un élève
 *     portant un historique de scolarité.
 */
export const DELIBERATE_UNFILTERED_PUPIL_ANCHORED_SITES = [
  'apps/api/src/modules/alerts/meeting-requests.service.ts',
  'apps/api/src/modules/analytics/analytics.service.ts',
  'apps/api/src/modules/students/students.controller.ts',
] as const;

/* ================================================================== *
 * LA PORTÉE D'ANNÉE — DÉCLARÉE, jamais supposée (FR-5)
 * ================================================================== */

/**
 * Le marqueur « l'année vient de la SECTION, pas de la ligne d'inscription ».
 *
 * Il existe parce que PF-409 mesure que cette implication N'EST PAS GARANTIE :
 * `Enrollment.academicYearId` et `ClassSection.academicYearId` sont deux
 * colonnes indépendantes, sans clé étrangère composite ni `CHECK`. Un site qui
 * porte ce marqueur DÉCLARE qu'il hérite de l'hypothèse ; il ne la tait pas.
 *
 * ⚠ Le porter n'AJOUTE aucune clause d'année (FR-5, dernière phrase) : le
 * marqueur est une DÉCLARATION, pas un filtre. Ajouter une clause à un site qui
 * n'en avait pas changerait des nombres sans mesure — précisément ce que AC-7
 * interdit.
 */
export const ROSTER_YEAR_IMPLIED_BY_SECTION = 'roster.year.implied-by-section' as const;

/** La portée d'année d'un site : soit explicite, soit déclarée implicite. */
export type RosterYearScope =
  | { academicYearId: string }
  | typeof ROSTER_YEAR_IMPLIED_BY_SECTION;

function yearClauseOf(scope: RosterYearScope): { academicYearId?: string } {
  return scope === ROSTER_YEAR_IMPLIED_BY_SECTION ? {} : { academicYearId: scope.academicYearId };
}

/* ================================================================== *
 * LES NOMBRES BRANDÉS — la somme devient INEXPRIMABLE là où il faut des têtes
 * ================================================================== */

declare const CLASS_ROSTER_SIZE: unique symbol;
declare const DISTINCT_STUDENT_COUNT: unique symbol;
declare const SUMMED_ROSTER_SIZES: unique symbol;
declare const GRADED_POPULATION_SIZE: unique symbol;

/** L'effectif d'UNE section — un nombre de PLACES OCCUPÉES. */
export type ClassRosterSize = number & { readonly [CLASS_ROSTER_SIZE]: true };

/** Un nombre d'ÉLÈVES DISTINCTS — un nombre de TÊTES. */
export type DistinctStudentCount = number & { readonly [DISTINCT_STUDENT_COUNT]: true };

/**
 * Une somme d'effectifs — des PLACES, jamais des élèves. Réservée aux TAUX
 * D'OCCUPATION. Volontairement NON assignable à `DistinctStudentCount`.
 */
export type SummedRosterSizes = number & { readonly [SUMMED_ROSTER_SIZES]: true };

/**
 * PF-411 — la population des NOTÉS, que le portail parent emploie comme
 * dénominateur de rang. Exportée en TYPE SEULEMENT (AC-3 / §3 D6) : le nom
 * existe pour qu'on ne la confonde pas avec un effectif, et ce module NE LA
 * CALCULE PAS. La rediriger vers l'effectif canonique changerait un rang affiché
 * à une famille — une décision produit, pas une correction de vérité.
 */
export type GradedPopulationSize = number & { readonly [GRADED_POPULATION_SIZE]: true };

/* ================================================================== *
 * QUESTION 1 — l'effectif d'UNE section
 * ================================================================== */

/** L'argument d'un `_count` Prisma sur `ClassSection.enrollments`. */
export interface RosterCountArg {
  where: {
    /** MUTABLE : `EnumEnrollmentStatusFilter.in` de Prisma 5.22 l'est (voir
     * `rosterStatusesFor`). Le constructeur ne rend que des copies fraîches. */
    status: { in: RosterStatus[] };
    academicYearId?: string;
  };
}

/**
 * LE seul constructeur d'argument de `_count` sur `ClassSection.enrollments`.
 *
 * ⚠ CONTRAINTE DE CONCEPTION, VÉRIFIÉE EN SOURCE (AC-6) : l'appel doit être posé
 * À LA CLAUSE `enrollments:` —
 * `_count: { select: { enrollments: rosterCountArg(…) } }` — et jamais en
 * remplaçant le littéral `_count` entier par un spread. Le classifieur du
 * cliquet S-E03-3 (`enrollment-activity-derivation-gate.spec.ts`, `classify()`
 * lignes 384-405) reconnaît la famille d'APPARTENANCE par la PRÉSENCE de la clé
 * `enrollments` sous `_count`. Faire disparaître cette clé de l'AST ferait
 * tomber son plancher `hasMembershipFamily >= 5` (test :638) — un rouge dans un
 * cliquet voisin, causé par une conversion qui n'a rien changé au sens.
 */
export function rosterCountArg(options: {
  population: RosterPopulation;
  yearScope: RosterYearScope;
}): RosterCountArg {
  return {
    where: {
      status: { in: rosterStatusesFor(options.population) },
      ...yearClauseOf(options.yearScope),
    },
  };
}

/**
 * Marque un compte BRUT rendu par Prisma comme l'effectif d'UNE section.
 *
 * Le fil transporte des `number` NUS — la marque ne survit pas à `JSON.parse`.
 * Elle vit CÔTÉ SERVEUR, entre la lecture et la charge utile : c'est là que
 * l'erreur (sommer des effectifs pour obtenir des élèves) s'écrit.
 */
export function classRosterSize(rawCount: number): ClassRosterSize {
  requireNonNegativeInteger(rawCount, 'classRosterSize');
  return rawCount as ClassRosterSize;
}

/**
 * LA SOMME — des PLACES OCCUPÉES, pour un TAUX D'OCCUPATION. Elle est offerte,
 * nommée, et son type interdit de la faire passer pour des élèves.
 */
export function sumRosterSizes(sizes: readonly ClassRosterSize[]): SummedRosterSizes {
  let total = 0;
  for (const size of sizes) total += size;
  return total as SummedRosterSizes;
}

/* ================================================================== *
 * QUESTION 2 — les élèves DISTINCTS sur un ENSEMBLE de sections
 * ================================================================== */

/**
 * Le `where` d'une lecture DIRECTE d'inscriptions ancrée sur un ENSEMBLE de
 * sections. `tenantId` est REQUIS DANS LE TYPE, pas seulement dans les options :
 * c'est le type qui rend une lecture non scopée au tenant inexprimable
 * (ADR-070 §D3, FR-7). PF-415 mesure que la base ne l'impose pas — pas de clé
 * étrangère, pas de contrainte sur `enrollment.tenant_id`.
 */
export interface DistinctStudentsWhere {
  tenantId: string;
  /** MUTABLES : `EnumEnrollmentStatusFilter.in` / `UuidFilter.in` de Prisma 5.22
   * le sont (voir `rosterStatusesFor`). Le constructeur ne rend que des copies. */
  status: { in: RosterStatus[] };
  classSectionId: { in: string[] };
  academicYearId?: string;
}

function requireTenantId(tenantId: string): void {
  if (typeof tenantId !== 'string' || tenantId.length === 0) {
    throw new Error(
      'roster: `tenantId` est requis et non vide — une lecture d’inscriptions non ' +
        'scopée au tenant est exactement ce que ce module rend inexprimable (PF-36 / PF-415).',
    );
  }
}

function requireNonNegativeInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(
      `roster: ${label} attend un entier >= 0, a reçu ${String(value)}. Un « 0 » rendu ` +
        "sans avoir lu est DNC-08 : rendre l'indisponibilité, jamais un zéro.",
    );
  }
}

/**
 * Le `where` de la QUESTION 2. Il LIT, il ne somme pas (FR-6) : une seule
 * requête rapporte les `studentId`, et `countDistinctStudents` les dé-duplique.
 */
export function distinctStudentsWhere(options: {
  tenantId: string;
  classSectionIds: readonly string[];
  population: RosterPopulation;
  yearScope: RosterYearScope;
}): DistinctStudentsWhere {
  requireTenantId(options.tenantId);
  return {
    tenantId: options.tenantId,
    status: { in: rosterStatusesFor(options.population) },
    classSectionId: { in: [...options.classSectionIds] },
    ...yearClauseOf(options.yearScope),
  };
}

/** Une ligne telle que la QUESTION 2 a besoin de la lire. MINIMALE. */
export interface RosterStudentRow {
  studentId: string;
}

/**
 * LE compte d'élèves DISTINCTS. Correct par CONSTRUCTION : il dé-duplique
 * TOUJOURS, donc il rend le même nombre que l'invariant absent de PF-361 tienne
 * ou non.
 */
export function countDistinctStudents(rows: readonly RosterStudentRow[]): DistinctStudentCount {
  const seen = new Set<string>();
  for (const row of rows) seen.add(row.studentId);
  return seen.size as DistinctStudentCount;
}

/**
 * Les élèves distincts, VENTILÉS par clé (une matière, un cycle, une école…).
 * Une seule lecture, un `Set` par clé — jamais une requête par clé (GUARDRAILS
 * §2 : « Never N+1 »), et jamais une somme.
 */
export function countDistinctStudentsByKey<TRow extends RosterStudentRow>(
  rows: readonly TRow[],
  keysOf: (row: TRow) => readonly string[],
): Map<string, DistinctStudentCount> {
  const sets = new Map<string, Set<string>>();
  for (const row of rows) {
    for (const key of keysOf(row)) {
      let bucket = sets.get(key);
      if (bucket === undefined) {
        bucket = new Set<string>();
        sets.set(key, bucket);
      }
      bucket.add(row.studentId);
    }
  }
  const out = new Map<string, DistinctStudentCount>();
  for (const [key, bucket] of sets) out.set(key, bucket.size as DistinctStudentCount);
  return out;
}

/* ================================================================== *
 * LE PORT — trois lignes d'adaptateur par application
 * ================================================================== */

/**
 * Le port framework-free de la QUESTION 2. `apps/api` le branche via
 * `apps/api/src/shared/roster/prisma-roster-reader.ts` ; ce module n'importe
 * jamais `@prisma/client`.
 */
export interface RosterReader {
  findMany(args: {
    where: DistinctStudentsWhere;
    select: { studentId: true; classSectionId: true };
  }): Promise<Array<{ studentId: string; classSectionId: string }>>;
}

/**
 * LA lecture canonique des élèves distincts. Une requête, jamais une somme.
 * Le cas « aucune section » est rendu SANS requête et rend `0` — un zéro
 * LU (l'ensemble vide n'a aucun élève), pas un zéro par défaut.
 */
export async function readDistinctStudentsAcrossSections(
  reader: RosterReader,
  options: {
    tenantId: string;
    classSectionIds: readonly string[];
    population: RosterPopulation;
    yearScope: RosterYearScope;
  },
): Promise<{
  rows: Array<{ studentId: string; classSectionId: string }>;
  distinctStudents: DistinctStudentCount;
}> {
  requireTenantId(options.tenantId);
  if (options.classSectionIds.length === 0) {
    return { rows: [], distinctStudents: 0 as DistinctStudentCount };
  }
  const rows = await reader.findMany({
    where: distinctStudentsWhere(options),
    select: { studentId: true, classSectionId: true },
  });
  return { rows, distinctStudents: countDistinctStudents(rows) };
}

/* ================================================================== *
 * L'ENTRÉE DE REGISTRE (ADR-041 §D4)
 * ================================================================== */

export const CLASS_ROSTER_SIZE_DEFINITION = {
  id: 'roster.size',
  definition:
    "L'effectif d'UNE section est le nombre de lignes d'inscription qu'elle porte " +
    "dans une population NOMMÉE (par défaut « les assis », status 'active'). Le " +
    "nombre d'ÉLÈVES sur un ENSEMBLE de sections est le nombre de studentId " +
    'DISTINCTS lus en une requête — jamais la somme des effectifs, l’invariant ' +
    '« au plus une inscription active par élève et par année » n’existant pas en ' +
    'base (PF-361). La somme des effectifs est un nombre de PLACES et ne sert ' +
    "qu'aux taux d'occupation.",
  populations: {
    seated: ROSTER_SEATED_STATUSES,
    onTheBooks: ROSTER_ON_THE_BOOKS_STATUSES,
    awaiting: ROSTER_AWAITING_STATUSES,
    everRegistered: ROSTER_ALL_STATUSES,
  },
  /** Hérités, NON résolus par ce module (DNC-06). */
  inheritedFindings: ['PF-361', 'PF-409', 'PF-411', 'PF-415'],
  /** ADR-041 Consequences — pas ratifiée par un utilisateur école. */
  confirmed: false as const,
} as const;
