import {
  PUBLISHED_GRADE_STATUSES,
  gradeRecordWhere,
  scoringWindowGradesWhere,
} from '@pilotage/contracts';

/**
 * S-E03-3 / `PF-05` / `AC-5` — LE CONTRAT DES DEUX PORTÉES.
 *
 * CE QUE CE FICHIER PROUVE, ET CE QU'IL NE PROUVE PAS
 * ---------------------------------------------------
 * Il prouve que les deux constructeurs rendent EXACTEMENT les clauses que la
 * production portait en littéral avant la tranche — l'ÉQUIVALENCE de la
 * dérivation, axe par axe. Il ne prouve PAS que la production les emploie :
 * c'est `parent-grade-projection-agreement.spec.ts` qui le fait, en capturant
 * les clauses DEPUIS le vrai code (`R-30` : une spec qui recopie la clause ne
 * teste que la copie).
 *
 * LES DEUX LITTÉRAUX D'AVANT, reproduits ici UNE fois, comme TÉMOIN
 * -----------------------------------------------------------------
 * C'est le seul endroit du dépôt où ils sont encore écrits à la main, et c'est
 * délibéré : ils sont la CIBLE d'une comparaison, pas une source de vérité. Si
 * un constructeur dérive d'un iota, ce fichier rougit.
 */

const TENANT = 'tenant-a';
const STUDENT = 'student-1';
const YEAR = 'year-active';

/** `analytics.service.ts:1102` AVANT la tranche, à l'octet près. */
const LEGACY_A = {
  tenantId: TENANT,
  studentId: STUDENT,
  status: { in: ['published', 'revised'] },
  isAbsent: false,
  assessment: { teachingAssignment: { academicYearId: YEAR } },
};

/** `grades.controller.ts:428` AVANT la tranche, principal PARENT, sans terme. */
const LEGACY_B_PARENT = {
  studentId: STUDENT,
  tenantId: TENANT,
  status: { in: ['published', 'revised'] },
};

describe('S-E03-3 — les deux portées sont ÉQUIVALENTES aux littéraux remplacés', () => {
  it('A — le jeu de NOTATION rend la clause de `analytics.service.ts`', () => {
    expect(
      scoringWindowGradesWhere({ tenantId: TENANT, studentId: STUDENT, academicYearId: YEAR }),
    ).toEqual(LEGACY_A);
  });

  it('B — le RELEVÉ parent rend la clause de `grades.controller.ts`', () => {
    expect(gradeRecordWhere({ tenantId: TENANT, studentId: STUDENT })).toEqual(LEGACY_B_PARENT);
  });

  it('B — avec `termId`, la clause `assessment` apparaît, comme le spread d’origine', () => {
    expect(gradeRecordWhere({ tenantId: TENANT, studentId: STUDENT, termId: 'term-1' })).toEqual({
      ...LEGACY_B_PARENT,
      assessment: { termId: 'term-1' },
    });
  });

  it('B — `termId` VIDE est traité comme ABSENT (le `termId ? …` d’origine était falsy)', () => {
    expect(gradeRecordWhere({ tenantId: TENANT, studentId: STUDENT, termId: '' })).toEqual(
      LEGACY_B_PARENT,
    );
  });

  it('B — `includeUnpublished` RETIRE le filtre de statut, comme `seePrivate`', () => {
    const where = gradeRecordWhere({
      tenantId: TENANT,
      studentId: STUDENT,
      includeUnpublished: true,
    });
    expect(where).toEqual({ studentId: STUDENT, tenantId: TENANT });
    expect(where.status).toBeUndefined();
  });
});

describe('S-E03-3 — les axes DÉCLARÉS diffèrent, et le seul axe COMMUN est partagé', () => {
  it('l’axe (d) STATUT vient d’UNE constante pour les DEUX portées', () => {
    const a = scoringWindowGradesWhere({
      tenantId: TENANT,
      studentId: STUDENT,
      academicYearId: YEAR,
    });
    const b = gradeRecordWhere({ tenantId: TENANT, studentId: STUDENT });
    expect(a.status).toEqual(b.status);
    expect(a.status).toEqual({ in: [...PUBLISHED_GRADE_STATUSES] });
  });

  it('l’axe (b) ABSENCE diffère : A l’exclut, B ne le mentionne PAS', () => {
    const a = scoringWindowGradesWhere({
      tenantId: TENANT,
      studentId: STUDENT,
      academicYearId: YEAR,
    });
    const b = gradeRecordWhere({ tenantId: TENANT, studentId: STUDENT });
    expect(a.isAbsent).toBe(false);
    // NE PAS « corriger » en ajoutant `isAbsent: false` ici : `/parent/grades`
    // affiche un badge « Abs » (`GradeRow.tsx:87`) et offre un filtre
    // `performance === 'absent'` (`page.tsx:321`). L'absence EST une ligne du
    // relevé.
    expect(b.isAbsent).toBeUndefined();
  });

  it('l’axe (a) ANNÉE diffère : A fenêtre, B rend TOUTES les années', () => {
    const a = scoringWindowGradesWhere({
      tenantId: TENANT,
      studentId: STUDENT,
      academicYearId: YEAR,
    });
    const b = gradeRecordWhere({ tenantId: TENANT, studentId: STUDENT });
    expect(a.assessment?.teachingAssignment?.academicYearId).toBe(YEAR);
    expect(b.assessment).toBeUndefined();
  });

  it('la constante de statut n’est pas PARTAGÉE PAR RÉFÉRENCE — un appelant ne peut pas muter l’autre', () => {
    const a = scoringWindowGradesWhere({
      tenantId: TENANT,
      studentId: STUDENT,
      academicYearId: YEAR,
    });
    const b = gradeRecordWhere({ tenantId: TENANT, studentId: STUDENT });
    expect(a.status).not.toBe(b.status);
    a.status?.in.push('draft' as never);
    expect(b.status?.in).toEqual([...PUBLISHED_GRADE_STATUSES]);
  });
});

describe('S-E03-3 — les portées non scopées sont INEXPRIMABLES (ADR-065 §D5)', () => {
  it.each([
    ['tenant vide', { tenantId: '', studentId: STUDENT, academicYearId: YEAR }],
    ['élève vide', { tenantId: TENANT, studentId: '', academicYearId: YEAR }],
    ['année vide', { tenantId: TENANT, studentId: STUDENT, academicYearId: '' }],
  ])('A refuse : %s', (_label, options) => {
    expect(() => scoringWindowGradesWhere(options)).toThrow();
  });

  it.each([
    ['tenant vide', { tenantId: '', studentId: STUDENT }],
    ['élève vide', { tenantId: TENANT, studentId: '' }],
  ])('B refuse : %s', (_label, options) => {
    expect(() => gradeRecordWhere(options)).toThrow();
  });

  it('A n’a AUCUNE surcharge « toutes années » — l’argument est REQUIS', () => {
    // Le fail-open que ce module rend inexprimable : un `academicYearId?`
    // optionnel aurait laissé le jeu de NOTATION s'élargir silencieusement à
    // toutes les années quand l'appelant oublie de le passer.
    expect(() =>
      (scoringWindowGradesWhere as (o: unknown) => unknown)({
        tenantId: TENANT,
        studentId: STUDENT,
      }),
    ).toThrow();
  });
});
