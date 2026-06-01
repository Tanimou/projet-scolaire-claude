import {
  SchoolPerformanceDrilldownService,
  type DrilldownGroup,
} from './school-performance-drilldown.service';

/**
 * Note brute factice → forme `grade` attendue par les `select` du service.
 * On ne renseigne que les champs réellement lus par chaque requête.
 */
function grade(opts: {
  studentId: string;
  value: number;
  maxScore?: number;
  cycle?: { id: string; name: string; color: string | null };
  classSection?: { id: string; name: string };
  subject?: { id: string; name: string; color: string | null };
  termId?: string | null;
  termOrder?: number;
}) {
  return {
    studentId: opts.studentId,
    value: opts.value,
    assessment: {
      maxScore: opts.maxScore ?? 20,
      termId: opts.termId ?? null,
      term: opts.termOrder !== undefined ? { orderIndex: opts.termOrder } : null,
      teachingAssignment: {
        classSection: {
          id: opts.classSection?.id ?? 'cs1',
          name: opts.classSection?.name ?? '6eA',
          gradeLevel: { cycle: opts.cycle ?? { id: 'cyc1', name: 'Collège', color: '#64748B' } },
        },
        subject: opts.subject ?? { id: 'subj1', name: 'Mathématiques', color: '#2563EB' },
      },
    },
  };
}

/**
 * Construit un service avec un prisma simulé. `grades` est le jeu retourné par
 * `grade.findMany`, `terms` par `term.findMany`, `enrollments` par
 * `enrollment.findMany`. L'année active est toujours résolue ('ay1').
 */
function makeService(opts: {
  grades?: unknown[];
  terms?: Array<{ id: string; name: string; orderIndex: number }>;
  enrollments?: Array<{ student: { id: string; firstName: string; lastName: string } }>;
}) {
  const prisma = {
    academicYear: {
      findFirst: jest.fn().mockResolvedValue({ id: 'ay1' }),
    },
    term: {
      findMany: jest.fn().mockResolvedValue(opts.terms ?? []),
    },
    enrollment: {
      findMany: jest.fn().mockResolvedValue(opts.enrollments ?? []),
    },
    grade: {
      findMany: jest.fn().mockResolvedValue(opts.grades ?? []),
    },
  };
  const service = new SchoolPerformanceDrilldownService(prisma as never);
  return { service, prisma };
}

const byId = (groups: DrilldownGroup[], id: string) => groups.find((g) => g.id === id)!;

describe('SchoolPerformanceDrilldownService — seuil de réussite (≥10/20 par élève)', () => {
  it('classe chaque élève selon sa MOYENNE, pas note par note (L1, par cycle)', async () => {
    // Élève A : 8 et 14 → moyenne 11 → réussite. Élève B : 6 et 9 → moyenne 7.5 → difficulté.
    const { service } = makeService({
      grades: [
        grade({ studentId: 'A', value: 8 }),
        grade({ studentId: 'A', value: 14 }),
        grade({ studentId: 'B', value: 6 }),
        grade({ studentId: 'B', value: 9 }),
      ],
    });

    const res = await service.drilldown({ tenantId: 't1', schoolId: 's1' });

    expect(res.level).toBe('cycle');
    const g = byId(res.groups, 'cyc1');
    expect(g.studentsWithGrades).toBe(2);
    expect(g.studentsPassing).toBe(1); // seul A (moyenne 11)
    expect(g.studentsFailing).toBe(1); // B (moyenne 7.5)
    expect(g.successRate).toBe(50);
    // Moyenne des moyennes = (11 + 7.5) / 2 = 9.25
    expect(g.averageOfAverages).toBe(9.25);
  });

  it('normalise sur 20 via (value / maxScore) * 20 avant le seuil', async () => {
    // Élève C : 16/40 = 8/20 → difficulté. Élève D : 22/40 = 11/20 → réussite.
    const { service } = makeService({
      grades: [
        grade({ studentId: 'C', value: 16, maxScore: 40 }),
        grade({ studentId: 'D', value: 22, maxScore: 40 }),
      ],
    });

    const res = await service.drilldown({ tenantId: 't1', schoolId: 's1' });
    const g = byId(res.groups, 'cyc1');
    expect(g.studentsPassing).toBe(1);
    expect(g.studentsFailing).toBe(1);
    expect(g.averageOfAverages).toBe(9.5); // (8 + 11) / 2
  });

  it('renvoie un payload vide cohérent quand aucune année active', async () => {
    const { service, prisma } = makeService({ grades: [] });
    prisma.academicYear.findFirst.mockResolvedValue(null);

    const res = await service.drilldown({ tenantId: 't1', schoolId: 's1' });
    expect(res.level).toBe('cycle');
    expect(res.scope.academicYearId).toBeNull();
    expect(res.groups).toEqual([]);
    expect(res.students).toEqual([]);
    // Pas de requête de notes si aucune année.
    expect(prisma.grade.findMany).not.toHaveBeenCalled();
  });
});

describe('SchoolPerformanceDrilldownService — regroupement par niveau', () => {
  it('L1 ventile par cycle et trie par nom', async () => {
    const { service } = makeService({
      grades: [
        grade({ studentId: 'A', value: 15, cycle: { id: 'lyc', name: 'Lycée', color: null } }),
        grade({ studentId: 'B', value: 5, cycle: { id: 'col', name: 'Collège', color: null } }),
      ],
    });

    const res = await service.drilldown({ tenantId: 't1', schoolId: 's1' });
    expect(res.groups.map((g) => g.name)).toEqual(['Collège', 'Lycée']);
  });

  it('L2 ventile par classe quand cycleId est fourni', async () => {
    const { service } = makeService({
      grades: [
        grade({ studentId: 'A', value: 12, classSection: { id: 'csA', name: '6eA' } }),
        grade({ studentId: 'B', value: 8, classSection: { id: 'csB', name: '6eB' } }),
      ],
    });

    const res = await service.drilldown({ tenantId: 't1', schoolId: 's1', cycleId: 'cyc1' });
    expect(res.level).toBe('class');
    expect(res.groups.map((g) => g.id).sort()).toEqual(['csA', 'csB']);
    expect(byId(res.groups, 'csA').studentsPassing).toBe(1);
    expect(byId(res.groups, 'csB').studentsFailing).toBe(1);
  });

  it('L3 ventile par matière quand classSectionId est fourni', async () => {
    const { service } = makeService({
      grades: [
        grade({ studentId: 'A', value: 18, subject: { id: 'math', name: 'Maths', color: null } }),
        grade({ studentId: 'A', value: 4, subject: { id: 'fr', name: 'Français', color: null } }),
      ],
    });

    const res = await service.drilldown({
      tenantId: 't1',
      schoolId: 's1',
      classSectionId: 'cs1',
    });
    expect(res.level).toBe('subject');
    expect(byId(res.groups, 'math').studentsPassing).toBe(1);
    expect(byId(res.groups, 'fr').studentsFailing).toBe(1);
  });
});

describe('SchoolPerformanceDrilldownService — niveau élève (L4)', () => {
  it('liste les élèves inscrits avec moyenne, rang, statut et tendance', async () => {
    const enrollments = [
      { student: { id: 'A', firstName: 'Alice', lastName: 'Martin' } },
      { student: { id: 'B', firstName: 'Bob', lastName: 'Durand' } },
      { student: { id: 'C', firstName: 'Chloé', lastName: 'Nguyen' } },
    ];

    // 1er findMany (averagesForClassSubject) : périmètre courant.
    // 2e findMany (perTermAverages) : par trimestre, pour la tendance.
    const scopedGrades = [
      grade({ studentId: 'A', value: 16 }), // moyenne 16 → réussite, rang 1
      grade({ studentId: 'B', value: 9 }), // moyenne 9 → difficulté, rang 2
      // C : aucune note → sans note
    ];
    const perTermGrades = [
      // A : T1 = 12, T2 = 16 → delta +4
      grade({ studentId: 'A', value: 12, termId: 'T1', termOrder: 1 }),
      grade({ studentId: 'A', value: 16, termId: 'T2', termOrder: 2 }),
      // B : un seul trimestre → pas de tendance
      grade({ studentId: 'B', value: 9, termId: 'T2', termOrder: 2 }),
    ];

    const prisma = {
      academicYear: { findFirst: jest.fn().mockResolvedValue({ id: 'ay1' }) },
      term: { findMany: jest.fn().mockResolvedValue([]) },
      enrollment: { findMany: jest.fn().mockResolvedValue(enrollments) },
      grade: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce(scopedGrades)
          .mockResolvedValueOnce(perTermGrades),
      },
    };
    const service = new SchoolPerformanceDrilldownService(prisma as never);

    const res = await service.drilldown({
      tenantId: 't1',
      schoolId: 's1',
      classSectionId: 'cs1',
      subjectId: 'subj1',
    });

    expect(res.level).toBe('students');
    expect(res.students).toHaveLength(3);

    const a = res.students.find((s) => s.studentId === 'A')!;
    const b = res.students.find((s) => s.studentId === 'B')!;
    const c = res.students.find((s) => s.studentId === 'C')!;

    // Moyennes + statut
    expect(a.average).toBe(16);
    expect(a.status).toBe('success');
    expect(b.average).toBe(9);
    expect(b.status).toBe('at_risk');
    expect(c.average).toBeNull();
    expect(c.status).toBe('no_data');

    // Rang : A (16) devant B (9) ; C non classé.
    expect(a.rank).toBe(1);
    expect(b.rank).toBe(2);
    expect(a.rankOutOf).toBe(2);
    expect(c.rank).toBeNull();

    // Tendance : A a deux trimestres (delta +4) ; B un seul → null.
    expect(a.trend).toEqual({ previousAverage: 12, delta: 4 });
    expect(b.trend).toBeNull();

    // Tri d'affichage : meilleurs d'abord, sans-note en fin.
    expect(res.students.map((s) => s.studentId)).toEqual(['A', 'B', 'C']);
  });
});

describe('SchoolPerformanceDrilldownService — filtre trimestre', () => {
  it('propage termId dans le filtre Assessment des requêtes de notes', async () => {
    const { service, prisma } = makeService({
      grades: [grade({ studentId: 'A', value: 12 })],
      terms: [{ id: 'T1', name: 'Trimestre 1', orderIndex: 1 }],
    });

    const res = await service.drilldown({ tenantId: 't1', schoolId: 's1', termId: 'T1' });

    expect(res.scope.termId).toBe('T1');
    // La requête L1 doit filtrer par assessment.termId = 'T1'.
    const callArg = prisma.grade.findMany.mock.calls[0]![0] as {
      where: { assessment: { termId?: string } };
    };
    expect(callArg.where.assessment.termId).toBe('T1');
  });
});
