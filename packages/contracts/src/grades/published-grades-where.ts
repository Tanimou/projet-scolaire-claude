/**
 * S-E03-3 / `PF-05` / `AC-5` / `DNC-01` — LES DEUX PORTÉES « les notes de cet
 * enfant », NOMMÉES, DÉRIVÉES D'UN SEUL ENDROIT, ET DÉCLARÉES DIFFÉRENTES.
 *
 * POURQUOI CE MODULE N'EST PAS « UN SEUL `where` POUR LES DEUX »
 * --------------------------------------------------------------
 * `S-E03-2 / AC-5` avait tenté exactement cela et pris sa branche STOP : un
 * `where` canonique unique n'a pu être adopté ni à A ni à B, donc il n'a été
 * livré NULLE PART. La raison, mesurée depuis, est que la prémisse était
 * fausse — **les deux projections répondent à deux questions différentes**, et
 * les fondre en une seule aurait cassé une page réelle :
 *
 *   A  « les notes qui COMPTENT » — le jeu de NOTATION.
 *      `AnalyticsService.parentDashboard`, qui sert `/parent/dashboard`,
 *      `/parent/subjects`, `/parent/children/[id]/report` ET
 *      `/admin/students/[id]`. Il calcule des moyennes, donc il écarte les
 *      absences (une absence n'a pas de valeur) et se fenêtre sur l'année de
 *      reporting (une moyenne inter-années n'a pas de sens).
 *
 *   B  « le RELEVÉ de l'enfant » — le jeu d'ENREGISTREMENT.
 *      `GradesController.studentGrades`, qui sert `/parent/grades` et
 *      `/parent/documents`. Il liste, il ne note pas. Il GARDE les absences —
 *      **délibérément** : `GradeRow.tsx:87` leur affiche un badge « Abs » et
 *      `page.tsx:321` offre un filtre `performance === 'absent'`. Les retirer
 *      pour « faire converger » supprimerait une fonctionnalité vivante.
 *
 * CE QUE CE MODULE FERME DONC, ET CE QU'IL NE FERME PAS
 * -----------------------------------------------------
 * Il ne supprime pas la divergence : il la rend **DÉCLARÉE au lieu
 * d'ACCIDENTELLE**. Avant, deux littéraux recopiés à deux endroits pouvaient
 * dériver l'un de l'autre sans que rien ne rougisse — c'est `DNC-01`, la
 * divergence KPI/registre, dans sa forme la plus banale. Après, l'axe où les
 * deux DOIVENT s'accorder (le statut) vient d'UNE constante, et les deux axes
 * où elles diffèrent LÉGITIMEMENT sont énumérés ci-dessous, en toutes lettres,
 * à côté de la raison produit de chacun.
 *
 * LES QUATRE AXES, ET LEUR VERDICT
 * ---------------------------------
 *   (a) ANNÉE SCOLAIRE  A fenêtre, B non.   DIFFÈRENT — déclaré. B est un
 *                       relevé ; un relevé tronqué à l'année courante n'est
 *                       plus un relevé.
 *   (b) `isAbsent`      A écarte, B garde.  DIFFÈRENT — déclaré. Voir le badge
 *                       « Abs » ci-dessus : c'est une fonctionnalité de B.
 *   (c) valeur ZÉRO     les deux gardent.   D'ACCORD. `PF-339` a été FALSIFIÉE
 *                       par exécution (`ADR-084`) : le zéro n'a jamais été
 *                       perdu ici, il l'était dans la BOUCLE de A, pas dans son
 *                       `where`.
 *   (d) STATUT          les deux écartent.  D'ACCORD — et c'est le seul axe que
 *                       ce module RÉUNIT réellement, via
 *                       `PUBLISHED_GRADE_STATUSES`.
 *
 * CE QUE CE MODULE NE PROUVE PAS, DIT PLUTÔT QUE SOUS-ENTENDU
 * -----------------------------------------------------------
 * La divergence (a)/(b) est INOBSERVABLE SUR LA SEED : mesurée le 2026-08-29
 * contre le conteneur, la base porte 420 notes pour 420 élèves — **une note
 * par élève**, ZÉRO absence, ZÉRO `draft`, et UNE SEULE année scolaire pour la
 * totalité des inscriptions et des évaluations. Aucun test d'intégration
 * adossé à cette seed ne peut donc distinguer A de B. La sonde
 * `scripts/parent-grade-projection-divergence-probe.sql` mesure zéro, et son
 * CONTRÔLE NÉGATIF (`…-control.sql`) prouve que ce zéro est un fait sur la
 * SEED et non sur l'instrument : en injectant une absence et une note d'une
 * autre année dans une transaction annulée, les compteurs passent à
 * `b=3, a=1, axe_absence=1, axe_année=1`. Enregistré comme finding.
 */

/** Les statuts qu'une note doit porter pour être visible d'une famille. */
export const PUBLISHED_GRADE_STATUSES = ['published', 'revised'] as const;

export type PublishedGradeStatus = (typeof PUBLISHED_GRADE_STATUSES)[number];

/**
 * Le sous-ensemble structurel de `Prisma.GradeWhereInput` que ces deux
 * projections emploient. Déclaré ici plutôt qu'importé : `@pilotage/contracts`
 * ne dépend pas de `@prisma/client`, exactement comme
 * `CandidateEnrollmentWhere`.
 */
export interface GradeScopeWhere {
  tenantId: string;
  studentId: string;
  status?: { in: PublishedGradeStatus[] };
  isAbsent?: false;
  assessment?: { teachingAssignment?: { academicYearId: string }; termId?: string };
}

function requireTenantId(tenantId: string): void {
  if (typeof tenantId !== 'string' || tenantId.length === 0) {
    throw new Error(
      'grades: `tenantId` est requis et non vide — une lecture de notes non ' +
        'scopée au tenant est exactement ce que ce module rend inexprimable.',
    );
  }
}

function requireStudentId(studentId: string): void {
  if (typeof studentId !== 'string' || studentId.length === 0) {
    throw new Error('grades: `studentId` est requis et non vide.');
  }
}

/**
 * A — LE JEU DE NOTATION. Publié/révisé, NON absent, fenêtré sur l'année de
 * reporting.
 *
 * ⚠ `academicYearId` est REQUIS et non optionnel, délibérément. À l'appel, A
 * n'émet PAS la requête quand l'année ne se résout pas (`analytics.service.ts`
 * rend `[]`) : rendre le paramètre optionnel ici permettrait d'exprimer « le
 * jeu de notation, toutes années confondues », qui n'est le jeu de personne et
 * serait une cinquième projection. C'est la forme d'`ADR-065 §D5` — un
 * paramètre optionnel qui ÉLARGIT silencieusement la requête quand il manque.
 */
export function scoringWindowGradesWhere(options: {
  tenantId: string;
  studentId: string;
  academicYearId: string;
}): GradeScopeWhere {
  requireTenantId(options.tenantId);
  requireStudentId(options.studentId);
  if (typeof options.academicYearId !== 'string' || options.academicYearId.length === 0) {
    throw new Error(
      'grades: `academicYearId` est requis pour le jeu de NOTATION — une moyenne ' +
        'inter-années n’est la moyenne de personne (axe (a), S-E03-3).',
    );
  }
  return {
    tenantId: options.tenantId,
    studentId: options.studentId,
    status: { in: [...PUBLISHED_GRADE_STATUSES] },
    isAbsent: false,
    assessment: { teachingAssignment: { academicYearId: options.academicYearId } },
  };
}

/**
 * B — LE RELEVÉ. Toutes années, absences COMPRISES (le badge « Abs » de
 * `/parent/grades` en dépend), éventuellement restreint à un trimestre.
 *
 * `includeUnpublished` porte la question « QUELS STATUTS », jamais « AS-TU LE
 * DROIT » (`FR4`) : l'appelant a déjà tranché l'autorisation avant d'arriver
 * ici. Le défaut est le plus restrictif — un appelant qui oublie le drapeau
 * obtient la vue famille, jamais la vue privée.
 */
export function gradeRecordWhere(options: {
  tenantId: string;
  studentId: string;
  termId?: string;
  includeUnpublished?: boolean;
}): GradeScopeWhere {
  requireTenantId(options.tenantId);
  requireStudentId(options.studentId);
  const where: GradeScopeWhere = {
    studentId: options.studentId,
    tenantId: options.tenantId,
  };
  // Le `termId` vide est traité comme absent — c'est ce que faisait le
  // `...(termId ? … : {})` d'origine, reproduit explicitement plutôt que par un
  // spread conditionnel (`ADR-065 §D5`).
  if (typeof options.termId === 'string' && options.termId.length > 0) {
    where.assessment = { termId: options.termId };
  }
  if (options.includeUnpublished !== true) {
    where.status = { in: [...PUBLISHED_GRADE_STATUSES] };
  }
  return where;
}
