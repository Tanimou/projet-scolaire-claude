/**
 * S-E03-3 / PF-12 / ADR-072 — LA dérivation canonique de « cet enfant est-il
 * ACTIVEMENT INSCRIT ? ».
 *
 * CE QUE CE MODULE REMPLACE
 * -------------------------
 * Neuf re-dérivations écrites à la main (six surfaces parent, trois admin) et
 * cinq projections serveur filtrées différemment, qui divergeaient sur trois
 * axes mesurés le 2026-08-25 :
 *   (a) LA COLONNE      — deux surfaces client re-filtraient sur
 *                         `AcademicYear.status` une liste que le serveur avait
 *                         déjà filtrée sur `Enrollment.status`. Ce sont DEUX
 *                         colonnes indépendantes (`schema.prisma:319` / `:652`).
 *   (b) LE REPLI        — `enrollments.find(e => e.status === 'active') ??
 *                         enrollments[0]` sur une charge utile SANS AUCUN filtre
 *                         de statut (`students.controller.ts` `GET /students/:id`)
 *                         rendait une inscription `graduated` derrière un badge
 *                         « Inscription active » en vert. Ce repli n'était pas
 *                         une précaution : c'ÉTAIT le défaut.
 *   (c) L'ORDRE         — `take:1 orderBy enrolledAt desc` d'un côté, « toutes
 *                         les lignes actives, sans ordre » de l'autre,
 *                         `enrollments[0]` en ordre de retour serveur d'un
 *                         troisième. Trois ordres, donc trois réponses possibles
 *                         à une seule question.
 *
 * LA DÉFINITION CANONIQUE (ADR-072 §3, reprise verbatim de ADR-041 §D2/§D4)
 * -------------------------------------------------------------------------
 * Un enfant est ACTIVEMENT INSCRIT lorsqu'il porte une `Enrollment` dont le
 * `status` vaut `active` ET dont l'`academicYear` est l'année canonique active
 * du tenant, telle que résolue par `resolveActiveAcademicYear`
 * (`packages/contracts/src/academic-year/`, ADR-070). Lorsque PLUSIEURS lignes
 * qualifient, l'ordre total énoncé UNE FOIS ici tranche — jamais l'appelant.
 * Lorsqu'AUCUNE ne qualifie, la réponse est « pas activement inscrit », et elle
 * n'est JAMAIS adoucie par un repli sur une ligne arbitraire.
 *
 * POURQUOI IL EST ICI, ET POURQUOI IL N'IMPORTE PAS PRISMA
 * -------------------------------------------------------
 * Mêmes raisons que le module frère `academic-year/`, et la même forme
 * (ADR-070 §D1) : `apps/api`, `apps/worker` ET `apps/web` portent chacun des
 * sites, `apps/worker/tsconfig.json` fixe `rootDir: ./src`, et le seul foyer
 * commun est `@pilotage/contracts` — qui n'aura JAMAIS `@prisma/client` en
 * dépendance (GUARDRAILS §2 : le paquet est aussi consommé par `apps/web` et
 * construit en CJS). Ce module construit donc le `where` et l'`orderBy`, et un
 * adaptateur de trois lignes par application les passe au vrai `PrismaClient`.
 *
 * IL N'INVENTE AUCUN PORT, ET C'EST DÉLIBÉRÉ (ADR-072 §A2)
 * --------------------------------------------------------
 * Contrairement à `academic-year/`, ce module N'ÉMET AUCUNE REQUÊTE : il reçoit
 * des lignes déjà lues et rend un verdict. Copier ici le port
 * `AcademicYearReader` serait de la cérémonie — un port sans lecture. La
 * frontière est donc plus étroite : un constructeur de `where`, un ordre total,
 * une fonction de sélection pure, un label de portée.
 *
 * ⚠ CE PRÉDICAT EST UN PRÉDICAT D'AFFICHAGE, JAMAIS UN PRÉDICAT DE PORTÉE D'ACCÈS
 * -------------------------------------------------------------------------------
 * Il ne doit JAMAIS être importé depuis `StudentAccessService` ni depuis un
 * guard. `student-access.service.ts` lit les inscriptions ANCRÉES SUR LA SECTION
 * (`classSectionId: { in: … }`), sans clause d'année, et son docblock DÉCIDE
 * explicitement : « NO academic-year clause » (ADR-063 §D1) et « `status:'active'`
 * ONLY, deliberately and at a stated cost » (ADR-066 §D1). Y importer ce
 * prédicat AJOUTERAIT la clause d'année, donc RÉTRÉCIRAIT le périmètre
 * enseignant : ce serait une modification d'AUTORISATION, que la story interdit
 * (§8, STOP condition 5). ADR-063 §D1 et ADR-066 §D1 ne sont PAS rouverts ici.
 *
 * L'ORDRE TOTAL — ET POURQUOI `enrolledAt desc` SEUL N'EN EST PAS UN
 * ------------------------------------------------------------------
 * `orderBy: { enrolledAt: 'desc' }` (ce qu'emploient déjà B1, B2 et B4) N'EST
 * PAS un ordre total. L'index unique `@@unique([studentId, classSectionId,
 * academicYearId])` (`schema.prisma:669-670`) n'interdit PAS deux lignes ACTIVES
 * la même année dans DEUX sections différentes — et l'index partiel que le
 * commentaire juste au-dessus promet « in migration SQL » N'EXISTE NULLE PART :
 * `0_baseline/migration.sql:1272` ne crée que
 * `enrollment_student_id_class_section_id_academic_year_id_key`. Le schéma
 * affirme donc un invariant que la base ne tient pas — c'est PF-361, mesuré, et
 * c'est ce qui rend cet ordre PORTEUR DE CHARGE plutôt que défensif. Deux lignes
 * actives, même année, même `enrolledAt` (un import en lot les pose à la
 * milliseconde près) laissent donc Postgres libre de rendre l'une OU l'autre.
 * Le départage se fait sur `id`, clé primaire donc unique : l'ordre
 * `[{ enrolledAt: 'desc' }, { id: 'desc' }]` est TOTAL. `enrolledAt` reste la
 * clé de tête parce que c'est celle que les projections existantes emploient —
 * changer la clé de tête changerait des résultats sans rien fermer.
 *
 * L'ABSENCE EST RENDUE HONNÊTEMENT, JAMAIS ADOUCIE
 * ------------------------------------------------
 * `selectActiveEnrollment` ne replie JAMAIS sur `rows[0]`. Trois états, pas
 * deux : `active`, `out_of_scope` (des inscriptions existent, aucune ne
 * qualifie — année non canonique, `graduated`, `transferred_out`, `dropped`) et
 * `none` (aucune ligne). La distinction `out_of_scope` / `none` est ce qui
 * permet à la surface de dire « Hors année en cours » au lieu de « Aucune
 * inscription » à un enfant diplômé — ADR-041 §D3 : « the label is what makes a
 * changed number legible rather than alarming ».
 *
 * LA FENÊTRE DE REPORTING N'EST PAS UNE AFFIRMATION D'ACTIVITÉ
 * ------------------------------------------------------------
 * `selectReportingWindowEnrollment` existe pour UNE raison, et elle est
 * structurelle : `AnalyticsService.parentDashboard` dérive AUJOURD'HUI sa clé de
 * fenêtrage (`academicYearId`) DE l'inscription. Si la canonicalisation devenait
 * cette clé, un enfant dont l'inscription active vit dans une année NON
 * canonique — exactement la fixture d'AC-5, et l'année `active` des DEUX tenants
 * est terminée — verrait notes, alertes, assiduité et évolution retomber à zéro.
 * Le dashboard parent porte la promesse « cinq questions en moins de 2 s »
 * (GUARDRAILS §1). Ce qui change est donc CE QUI EST AFFIRMÉ (l'activité et son
 * label), JAMAIS la clé de fenêtrage. Cette fonction porte la précédence
 * historique, telle quelle, et son nom dit qu'elle n'affirme rien.
 *
 * `endedAt` EST RAPPORTÉ, JAMAIS SÉLECTIONNÉ (ADR-072 §R-7, résidu PF-364)
 * ------------------------------------------------------------------------
 * `ADR-041 §D2` demande un « effective-dated as of today » plutôt qu'un attribut
 * mutable. Contrairement à `AcademicYear`, `Enrollment` PEUT l'exprimer : il
 * porte `enrolledAt` ET `endedAt` (`schema.prisma:659-660`). Ce module
 * sélectionne néanmoins sur `status` + année canonique — parce que c'est ce que
 * les cinq projections font déjà et que basculer la sélection changerait des
 * résultats sans mesure préalable — et RAPPORTE le désaccord
 * (`endedAtDisagreement`), exactement comme `academic-year/` rapporte la vétusté
 * sans jamais la choisir. §D2 est donc déchargé EN INTENTION SEULEMENT. Résidu
 * nommé : PF-364.
 *
 * CE MODULE HÉRITE DE PF-328, IL NE LE RÉSOUT PAS
 * -----------------------------------------------
 * `resolveActiveAcademicYear` choisit l'année canonique DÉTERMINISTIQUEMENT, pas
 * CORRECTEMENT : aucun invariant en base ne garantit « au plus une année active
 * par école » (PF-328, ADR-070). Tout ce qui est bâti dessus hérite de cette
 * limite verbatim. Un module qui paraîtrait plus fort que le résolveur sur
 * lequel il repose serait `DNC-06`.
 *
 * PF-360 EST HÉRITÉ AUSSI : `Student.status` n'est consulté sur AUCUN chemin
 * parent. Un élève `archived` portant une inscription `active` dans l'année
 * canonique est rendu ACTIVEMENT INSCRIT par ce module. Mesuré, enregistré,
 * délibérément non corrigé dans cette tranche.
 *
 * LA DÉFINITION N'EST PAS RATIFIÉE (`confirmed: false`)
 * -----------------------------------------------------
 * ADR-041 (Consequences) l'exige : ces définitions sont des défauts produit
 * défendables choisis par la routine pour débloquer un épic XL, PAS des
 * définitions confirmées avec un utilisateur école. `ACTIVE_ENROLLMENT_DEFINITION
 * .confirmed` vaut donc `false`, et il est visible ici plutôt que dans un
 * rapport de run.
 *
 * AUCUNE HORLOGE ICI
 * ------------------
 * Aucun `new Date(`, aucun `Date.now(` — la date de référence est INJECTÉE,
 * comme dans le module frère (`hermetic-spec-writers-gate.spec.ts`).
 */

/** La valeur d'`EnrollmentStatus` qui compte comme « en cours ». */
const ACTIVE_STATUS = 'active';

/**
 * Les trois états canoniques. TROIS, pas deux : un vocabulaire binaire ne peut
 * pas distinguer « diplômé l'an dernier » de « aucun dossier de scolarité », et
 * échangerait un faux vert contre une fausse alerte.
 *
 * Le tuple est la SOURCE, l'union en est DÉRIVÉE : les schémas Zod qui doivent
 * valider ce champ (`dto/meeting-request.ts`) ont besoin d'une liste à
 * l'exécution, et deux listes tenues à la main divergent en silence.
 */
export const ENROLLMENT_ACTIVITY_STATE = ['active', 'out_of_scope', 'none'] as const;
export type EnrollmentActivityState = (typeof ENROLLMENT_ACTIVITY_STATE)[number];

/**
 * La ligne `enrollment` telle que ce module a besoin de la lire. Structurelle et
 * MINIMALE : toute projection qui porte ces cinq champs satisfait le contrat,
 * quelle que soit la richesse de ses `include`.
 *
 * ⚠ `status`, `enrolledAt`, `academicYearId` et `id` DOIVENT figurer dans le
 * `select` de la projection qui alimente une surface. Une projection qui les
 * omet pendant que le type client les déclare est exactement `DNC-06` — le
 * défaut mesuré sur `children/page.tsx:38` et `settings/page.tsx:55`, où
 * `academicYear.status` était typé non-optionnel et n'était JAMAIS envoyé par le
 * serveur, si bien que le prédicat client valait `false` pour TOUS les enfants,
 * inconditionnellement.
 */
export interface EnrollmentActivityRow {
  id: string;
  academicYearId: string;
  /** `string` et non un enum : ce paquet ne dépend pas de `@prisma/client`. */
  status: string;
  enrolledAt: Date;
  /** Optionnel : rapporté par `endedAtDisagreement`, jamais sélectionné dessus. */
  endedAt?: Date | null;
}

/**
 * Le `where` PLEINEMENT ÉPINGLÉ. `tenantId` est REQUIS DANS LE TYPE, pas
 * seulement dans les options : c'est le type qui rend une lecture non scopée au
 * tenant inexprimable (ADR-070 §D3, même raison, même forme).
 */
export interface ActiveEnrollmentWhere {
  tenantId: string;
  status: 'active';
  academicYearId: string;
  studentId?: string;
}

/**
 * Le `where` du jeu CANDIDAT — les lignes `status: 'active'` de TOUTES les
 * années. Il existe parce que le filtre d'année NE DOIT PAS être appliqué par la
 * requête quand la surface a besoin de distinguer `out_of_scope` de `none` :
 * une requête déjà épinglée sur l'année canonique rend zéro ligne dans les deux
 * cas, et la surface ne peut plus dire « Hors année en cours » plutôt que
 * « Aucune inscription ».
 */
export interface CandidateEnrollmentWhere {
  tenantId: string;
  status: 'active';
  studentId?: string;
}

/** L'ordre total. Un tableau — deux objets séparés ne se départagent pas. */
export type EnrollmentOrderBy = Array<{ enrolledAt: 'desc' } | { id: 'desc' }>;

function requireTenantId(tenantId: string): void {
  if (typeof tenantId !== 'string' || tenantId.length === 0) {
    throw new Error(
      'enrollment: `tenantId` est requis et non vide — une lecture d’inscriptions ' +
        'non scopée au tenant est exactement ce que ce module rend inexprimable (PF-12).',
    );
  }
}

/**
 * Le prédicat Prisma « activement inscrit », paramétré par le tenant ET l'année
 * canonique. À employer quand la requête doit elle-même trancher (aucun besoin
 * de distinguer `out_of_scope` de `none`).
 */
export function activeEnrollmentWhere(options: {
  tenantId: string;
  academicYearId: string;
  studentId?: string;
}): ActiveEnrollmentWhere {
  requireTenantId(options.tenantId);
  const where: ActiveEnrollmentWhere = {
    tenantId: options.tenantId,
    status: ACTIVE_STATUS,
    academicYearId: options.academicYearId,
  };
  if (options.studentId !== undefined) where.studentId = options.studentId;
  return where;
}

/**
 * Le prédicat du jeu CANDIDAT : `status: 'active'`, toutes années confondues.
 * L'année canonique est appliquée ensuite, en mémoire, par
 * `selectActiveEnrollment` — voir `CandidateEnrollmentWhere`.
 */
export function candidateEnrollmentWhere(options: {
  tenantId: string;
  studentId?: string;
}): CandidateEnrollmentWhere {
  requireTenantId(options.tenantId);
  const where: CandidateEnrollmentWhere = {
    tenantId: options.tenantId,
    status: ACTIVE_STATUS,
  };
  if (options.studentId !== undefined) where.studentId = options.studentId;
  return where;
}

/**
 * L'ordre total, reconstruit à chaque appel plutôt que partagé — un tableau de
 * module serait mutable par n'importe quel appelant.
 */
export function enrollmentTotalOrder(): EnrollmentOrderBy {
  return [{ enrolledAt: 'desc' }, { id: 'desc' }];
}

/**
 * LE MÊME ordre total, en mémoire. Il existe pour que la sélection JS et la
 * sélection SQL ne puissent pas diverger : deux ordres écrits séparément
 * DIVERGENT, c'est le défaut que cette tranche ferme.
 *
 * Négatif ⇒ `a` avant `b`. `enrolledAt` décroissant, puis `id` décroissant.
 */
export function compareEnrollmentsByTotalOrder(
  a: EnrollmentActivityRow,
  b: EnrollmentActivityRow,
): number {
  const byDate = b.enrolledAt.getTime() - a.enrolledAt.getTime();
  if (byDate !== 0) return byDate;
  if (a.id === b.id) return 0;
  return a.id < b.id ? 1 : -1;
}

/** Le contexte de la question. `academicYearId` vient de `resolveActiveAcademicYear`. */
export interface ActiveEnrollmentContext {
  /** REQUIS. Jamais optionnel, jamais déduit. */
  tenantId: string;
  /**
   * L'année canonique, résolue par `resolveActiveAcademicYear` et HISSÉE hors de
   * toute boucle (une résolution par élève serait un N+1 sur la liste `GET
   * /students`, qui rend jusqu'à 200 élèves — GUARDRAILS §2).
   *
   * ⚠ Elle doit être keyée sur l'ÉCOLE QUI PORTE LES LIGNES (`student.schoolId`),
   * jamais sur `SchoolContextService.forUser`, qui rend « l'école du tenant qui a
   * le plus d'élèves » (`school-context.service.ts:108-129`) : dans un tenant
   * multi-écoles, deux projections keyées différemment résoudraient DEUX années
   * canoniques et reproduiraient PF-12 sur un axe neuf (axe 4, PF-356).
   *
   * `null` ⇔ aucune année canonique ne se résout : l'état est alors `none` ou
   * `out_of_scope`, jamais `active`.
   */
  academicYearId: string | null;
  /** Le nom de l'année, quand l'appelant l'a — pour le label de portée. */
  academicYearName?: string | null;
  /**
   * Le nombre TOTAL de lignes d'inscription de l'enfant, quand `rows` n'en est
   * qu'un SOUS-ENSEMBLE filtré (typiquement le jeu candidat de `GET /students`).
   * Sans lui, un enfant diplômé dont aucune ligne active ne subsiste serait
   * classé `none` (« aucun dossier ») au lieu d'`out_of_scope` (« hors année en
   * cours ») — une réponse fausse, pas seulement imprécise.
   */
  totalEnrollmentCount?: number;
  /**
   * INJECTÉE. Sert UNIQUEMENT au diagnostic `endedAtDisagreement`. Absente ⇒ le
   * diagnostic vaut `null` (inconnu), jamais `false` : un « non » rendu sans
   * avoir regardé est `DNC-08`.
   */
  referenceDate?: Date;
}

export interface ActiveEnrollmentResolution<TRow extends EnrollmentActivityRow> {
  state: EnrollmentActivityState;
  /** La ligne canonique. NON `null` si et seulement si `state === 'active'`. */
  enrollment: TRow | null;
  /**
   * La ligne la plus récente dans l'ordre total, TOUS statuts fournis confondus.
   * Sert au LABEL (« Dernière inscription : … »), JAMAIS à l'affirmation
   * d'activité : elle est renseignée aussi quand `state !== 'active'`.
   */
  lastKnown: TRow | null;
  /** L'année sur laquelle la question a été posée. `null` ⇔ aucune canonique. */
  academicYearId: string | null;
  /** ADR-041 §D3 — la portée, en clair, à côté du verdict. */
  scopeLabel: string;
  /**
   * Combien de lignes qualifiaient. `> 1` PROUVE que l'ordre total est porteur
   * de charge (deux lignes actives la même année sont légales aujourd'hui).
   */
  candidateCount: number;
  /**
   * `status === 'active'` alors que `endedAt` est passé. RAPPORTÉ, jamais
   * sélectionné dessus (PF-364). `null` ⇔ aucune `referenceDate` fournie.
   */
  endedAtDisagreement: boolean | null;
  /** ADR-041 Consequences — la définition n'est pas ratifiée par un utilisateur. */
  confirmed: false;
}

/** Le label de portée, dérivé — jamais écrit en dur sur une surface (DNC-10). */
export function enrollmentScopeLabel(args: {
  state: EnrollmentActivityState;
  academicYearId: string | null;
  academicYearName?: string | null;
}): string {
  if (args.academicYearId === null) {
    return 'Aucune année scolaire de référence';
  }
  const year = args.academicYearName ?? args.academicYearId;
  if (args.state === 'active') return `Année ${year}`;
  if (args.state === 'out_of_scope') return `Hors année ${year}`;
  return `Aucune inscription · année ${year}`;
}

/**
 * L'entrée de registre au sens d'ADR-041 §D4 : un id, la définition, le label de
 * portée et le prédicat, au même endroit.
 *
 * ⚠ §D4 demandait UN REGISTRE dans `packages/contracts`. Il n'existe pas :
 * `academic-year/` puis ce module forment une FAMILLE DE MODULES à la place.
 * La divergence est enregistrée (PF-365) et tranchée dans ADR-072 §A6 plutôt
 * qu'héritée en silence ; sa convergence est une décision d'`epic-spec`, pas de
 * cette tranche.
 */
export const ACTIVE_ENROLLMENT_DEFINITION = {
  id: 'enrollment.active',
  definition:
    "Un enfant est activement inscrit lorsqu'il porte une Enrollment de statut " +
    "'active' dont l'academicYear est l'année canonique active du tenant, telle " +
    'que résolue par resolveActiveAcademicYear (ADR-070). Plusieurs candidates ⇒ ' +
    "l'ordre total [enrolledAt desc, id desc]. Aucune candidate ⇒ « pas activement " +
    'inscrit », jamais un repli sur une ligne arbitraire.',
  scopeLabel: enrollmentScopeLabel,
  predicate: activeEnrollmentWhere,
  /** ADR-041 Consequences — pas ratifiée par un utilisateur école. */
  confirmed: false as const,
} as const;

/**
 * LA sélection canonique, pure, sur un tableau DÉJÀ LU.
 *
 * Ne replie JAMAIS sur `rows[0]`. Ne consulte JAMAIS `AcademicYear.status` :
 * l'année canonique arrive par `ctx.academicYearId`, résolue THROUGH
 * `resolveActiveAcademicYear` — la contourner en écrivant
 * `academicYear: { status: 'active' }` collisionne avec le cliquet d'ADR-070 et
 * est une condition d'ARRÊT de cette story.
 */
export function selectActiveEnrollment<TRow extends EnrollmentActivityRow>(
  rows: readonly TRow[],
  ctx: ActiveEnrollmentContext,
): ActiveEnrollmentResolution<TRow> {
  requireTenantId(ctx.tenantId);

  const ordered = [...rows].sort(compareEnrollmentsByTotalOrder);
  const lastKnown = ordered.length > 0 ? (ordered[0] as TRow) : null;

  const candidates =
    ctx.academicYearId === null
      ? []
      : ordered.filter(
          (row) => row.status === ACTIVE_STATUS && row.academicYearId === ctx.academicYearId,
        );

  const chosen = candidates.length > 0 ? (candidates[0] as TRow) : null;

  const knownRowCount = Math.max(
    ordered.length,
    typeof ctx.totalEnrollmentCount === 'number' ? ctx.totalEnrollmentCount : 0,
  );

  const state: EnrollmentActivityState =
    chosen !== null ? 'active' : knownRowCount > 0 ? 'out_of_scope' : 'none';

  return {
    state,
    enrollment: chosen,
    lastKnown,
    academicYearId: ctx.academicYearId,
    scopeLabel: enrollmentScopeLabel({
      state,
      academicYearId: ctx.academicYearId,
      academicYearName: ctx.academicYearName,
    }),
    candidateCount: candidates.length,
    endedAtDisagreement: describeEndedAtDisagreement(chosen, ctx.referenceDate),
    confirmed: false,
  };
}

/**
 * PF-364 / ADR-072 §R-7 — le désaccord entre `status: 'active'` et un `endedAt`
 * déjà passé. RAPPORTÉ. Rien ici ne SÉLECTIONNE dessus.
 */
function describeEndedAtDisagreement(
  row: EnrollmentActivityRow | null,
  referenceDate?: Date,
): boolean | null {
  if (referenceDate === undefined) return null;
  if (row === null) return false;
  const endedAt = row.endedAt ?? null;
  if (endedAt === null) return false;
  return row.status === ACTIVE_STATUS && endedAt.getTime() < referenceDate.getTime();
}

/**
 * LA FENÊTRE DE REPORTING — la ligne `status: 'active'` la plus récente dans
 * l'ordre total, TOUTES ANNÉES CONFONDUES.
 *
 * ⚠ CE N'EST PAS UNE AFFIRMATION D'ACTIVITÉ, et son nom le dit. Elle porte
 * VERBATIM la précédence dont `AnalyticsService.parentDashboard` dérive
 * aujourd'hui sa clé de fenêtrage (`academicYearId`), pour que la
 * canonicalisation change ce qui est AFFIRMÉ sans jamais vider la page qui porte
 * la promesse « cinq questions en moins de 2 s ». Voir le docblock du module.
 *
 * Elle existe aussi pour que plus AUCUN appelant n'ait besoin d'écrire
 * `enrollments[0]` : un index `[0]` sur un tableau d'inscriptions est
 * précisément la forme que le cliquet
 * `apps/api/src/shared/quality/enrollment-activity-derivation-gate.spec.ts` rend
 * inexprimable.
 */
export function selectReportingWindowEnrollment<TRow extends EnrollmentActivityRow>(
  rows: readonly TRow[],
): TRow | null {
  const ordered = [...rows]
    .filter((row) => row.status === ACTIVE_STATUS)
    .sort(compareEnrollmentsByTotalOrder);
  return ordered.length > 0 ? (ordered[0] as TRow) : null;
}

/**
 * La ligne la plus récente dans l'ordre total, SANS aucun filtre de statut.
 * Employée par les projections qui rendent l'historique complet (`GET
 * /students/:id`) pour étiqueter « dernière inscription connue » — un LABEL,
 * jamais un verdict.
 */
export function selectMostRecentEnrollment<TRow extends EnrollmentActivityRow>(
  rows: readonly TRow[],
): TRow | null {
  const ordered = [...rows].sort(compareEnrollmentsByTotalOrder);
  return ordered.length > 0 ? (ordered[0] as TRow) : null;
}

/* ================================================================== *
 * LA PROJECTION SÉRIALISABLE — ce que les cinq charges utiles portent
 * ================================================================== */

/**
 * Ce que B1..B5 mettent SUR LE FIL. Aucune `Date`, aucun objet Prisma : une
 * charge utile que les quatre portails lisent telle quelle, sans re-décider.
 *
 * ⚠ Il n'y a volontairement AUCUN tableau d'inscriptions ici. Une surface qui
 * recevrait les lignes devrait choisir parmi elles, c'est-à-dire re-dériver —
 * la forme même que cette tranche supprime. La FORME DU TYPE est l'application
 * de la règle.
 */
export interface EnrollmentActivityProjection {
  state: EnrollmentActivityState;
  /** ADR-041 §D3 — rendu À CÔTÉ du verdict, jamais dans un `title`/`aria-label`. */
  scopeLabel: string;
  academicYearId: string | null;
  academicYearName: string | null;
  classSectionName: string | null;
  gradeLevelName: string | null;
  /** Renseigné quand `state !== 'active'` : « Dernière inscription : … ». */
  lastKnown: {
    academicYearId: string | null;
    academicYearName: string | null;
    classSectionName: string | null;
    /** Le statut BRUT (`graduated`, `transferred_out`, …). La traduction fr est
     *  celle du design-system (`defaultLabelForStatus`), jamais une carte de plus. */
    status: string;
  } | null;
  candidateCount: number;
  endedAtDisagreement: boolean | null;
  confirmed: false;
}

/** Les libellés qu'une projection sait extraire de SA ligne. 3 lignes par appelant. */
export interface EnrollmentRowLabels {
  academicYearId?: string | null;
  academicYearName?: string | null;
  classSectionName?: string | null;
  gradeLevelName?: string | null;
}

/**
 * Passe d'une résolution à la charge utile. `describe` est fourni par chaque
 * projection parce que les `include` diffèrent (B1 porte `gradeLevel`, B3 porte
 * `gradeLevel.cycle`, B4 l'historique complet) — et parce que ADR-062 §D3
 * INTERDIT d'exporter une forme de `select`/`include` partagée entre modules
 * (→ PF-276). On partage le PRÉDICAT, l'ORDRE et la SÉLECTION ; jamais la
 * projection.
 */
export function projectEnrollmentActivity<TRow extends EnrollmentActivityRow>(
  resolution: ActiveEnrollmentResolution<TRow>,
  describe: (row: TRow) => EnrollmentRowLabels,
): EnrollmentActivityProjection {
  const active = resolution.enrollment === null ? null : describe(resolution.enrollment);
  const last = resolution.lastKnown === null ? null : describe(resolution.lastKnown);

  return {
    state: resolution.state,
    scopeLabel: resolution.scopeLabel,
    academicYearId: resolution.academicYearId,
    academicYearName: active?.academicYearName ?? null,
    classSectionName: active?.classSectionName ?? null,
    gradeLevelName: active?.gradeLevelName ?? null,
    lastKnown:
      resolution.state === 'active' || resolution.lastKnown === null || last === null
        ? null
        : {
            academicYearId: last.academicYearId ?? null,
            academicYearName: last.academicYearName ?? null,
            classSectionName: last.classSectionName ?? null,
            status: resolution.lastKnown.status,
          },
    candidateCount: resolution.candidateCount,
    endedAtDisagreement: resolution.endedAtDisagreement,
    confirmed: false,
  };
}
