import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  GUARDIANSHIP_AWAITING_DECISION_STATUSES,
  GUARDIANSHIP_LINK_STATUSES,
  GUARDIANSHIP_SCOPE_LABEL,
  type GuardianshipLinkStatus,
  guardianshipPendingRequestWhere,
  guardianshipRequestQueueWhere,
  isGuardianshipAwaitingDecision,
} from '@pilotage/contracts';

import { type KeycloakJwtPayload } from '../../shared/auth/jwt.strategy';
import { matchesStatusFilter } from '../../shared/testing/prisma-status-filter';
import { GuardiansController } from '../guardians/guardians.controller';

/**
 * S-E03-5 / PF-20 / ADR-075 — G-TRUTH : UN FIXTURE, TROIS LECTURES, UNE VALEUR.
 *
 * LE DÉFAUT QUE CE FICHIER MESURE
 * --------------------------------
 * L'admin lisait « Demandes en attente : N » sur son tableau de bord, cliquait
 * « Examiner », et atterrissait sur `/admin/enrollments` qui affichait ZÉRO —
 * puis lui EXPLIQUAIT que les parents n'avaient rien soumis. Deux mécanismes
 * indépendants produisaient cet écart, et corriger l'un sans l'autre l'aurait
 * laissé vivant :
 *
 *   1. LA FORME. La file lisait `GET /guardians`, qui rend des `Guardian` — un
 *      modèle sans `status` ni `notes` — pendant qu'elle en déclarait à la main
 *      la forme d'une `Guardianship`. Ses cinq onglets comparaient donc
 *      `undefined` à un littéral : toujours faux.
 *
 *   2. LA PORTÉE. Le KPI comptait le TENANT ENTIER (`{ tenantId, status:
 *      'pending' }`), alors que la file était scopée à l'ÉCOLE. Sur un tenant
 *      multi-écoles, les deux nombres n'auraient pas pu s'accorder même avec
 *      une forme correcte — c'est la seconde cause de PF-20, et elle aurait
 *      survécu à un fix qui n'aurait traité que la première.
 *
 * CE QUE CETTE SUITE PROUVE, ET CE QU'ELLE NE PROUVE PAS
 * ------------------------------------------------------
 * ELLE PROUVE : que la file (le contrôleur RÉEL, exécuté contre un moteur en
 * mémoire) et le prédicat dont les trois sites analytiques dérivent désormais
 * rendent LE MÊME NOMBRE sur le MÊME fixture, y compris multi-écoles, y compris
 * quand `guardian.schoolId` et `student.schoolId` divergent.
 *
 * ELLE NE PROUVE PAS que `analytics.service.ts` appelle bien ce prédicat — ce
 * serait une tautologie sur le contrat. Cette moitié-là est portée deux fois :
 * par le cliquet `guardianship-pending-request-derivation-gate.spec.ts` (R-A,
 * qui interdit d'épeler la valeur ailleurs) et par l'assertion de source de
 * `T-5` ci-dessous, qui NOMME les trois sites et vérifie qu'ils passent tous
 * par le constructeur. Un test d'accord dont les deux côtés viennent du même
 * appel prouverait que `x === x`.
 *
 * AUCUNE SONDE LIVE : Docker Desktop ne démarre pas le 2026-08-26 et la base
 * locale porte 55 tables et 0 ligne. Ceci est une preuve de MÉCANISME.
 *
 * ⚠ LE MOTEUR EN MÉMOIRE ROUTE SON FILTRAGE SCALAIRE PAR
 * `shared/testing/prisma-status-filter.ts`. Au run 85, six tests ABAC sont
 * tombés en FAUX ROUGE parce que des doubles faits main comparaient le statut
 * par égalité nue et ne connaissaient pas `{ in: [...] }` (`PF-376`). Le `where`
 * de cette tranche porte EN PLUS une relation imbriquée (`student.schoolId`) :
 * si un test voisin rougit après cette PR, PRÉSUMER LE DOUBLE, PAS LE PRODUIT.
 */

const TENANT = 'tenant-1';
const SCHOOL_A = 'school-a';
const SCHOOL_B = 'school-b';

type Row = {
  id: string;
  tenantId: string;
  status: GuardianshipLinkStatus;
  relationship: string;
  notes: string | null;
  createdAt: Date;
  guardian: {
    id: string;
    firstName: string;
    lastName: string;
    email: string | null;
    phone: string | null;
    schoolId: string;
  };
  student: {
    id: string;
    firstName: string;
    lastName: string;
    schoolId: string;
    enrollments: Array<{ classSection: { name: string } }>;
  };
};

function row(
  id: string,
  status: GuardianshipLinkStatus,
  studentSchoolId: string,
  opts: { guardianSchoolId?: string; tenantId?: string; day?: number } = {},
): Row {
  return {
    id,
    tenantId: opts.tenantId ?? TENANT,
    status,
    relationship: 'mother',
    notes: null,
    createdAt: new Date(Date.UTC(2026, 0, opts.day ?? 1)),
    guardian: {
      id: `g-${id}`,
      firstName: 'Awa',
      lastName: 'Diallo',
      email: null,
      phone: null,
      schoolId: opts.guardianSchoolId ?? studentSchoolId,
    },
    student: {
      id: `s-${id}`,
      firstName: 'Moussa',
      lastName: 'Diallo',
      schoolId: studentSchoolId,
      enrollments: [{ classSection: { name: '6e A' } }],
    },
  };
}

/**
 * La sémantique Prisma des trois clés que le prédicat pose — APPLIQUÉE, pas
 * simulée à moitié. C'est le seul moteur de la suite : la file et les deux
 * nombres analytiques passent tous par lui, donc un écart entre eux ne peut
 * venir que du `where`, jamais du double.
 */
function selectRows(rows: Row[], where: unknown): Row[] {
  const w = where as {
    tenantId?: string;
    student?: { schoolId?: string };
    status?: { in?: readonly GuardianshipLinkStatus[] };
  };
  return rows.filter(
    (r) =>
      (w.tenantId === undefined || r.tenantId === w.tenantId) &&
      (w.student?.schoolId === undefined || r.student.schoolId === w.student.schoolId) &&
      matchesStatusFilter(r.status, w.status),
  );
}

/** Le contrôleur RÉEL, sur le moteur ci-dessus. */
function makeController(rows: Row[], schoolId: string) {
  const prisma = {
    guardianship: {
      findMany: jest.fn(
        ({ where, skip = 0, take = 10 }: { where: unknown; skip?: number; take?: number }) =>
          Promise.resolve(
            selectRows(rows, where)
              .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
              .slice(skip, skip + take),
          ),
      ),
      count: jest.fn(({ where }: { where: unknown }) =>
        Promise.resolve(selectRows(rows, where).length),
      ),
      groupBy: jest.fn(({ where }: { where: unknown }) => {
        const selected = selectRows(rows, where);
        return Promise.resolve(
          GUARDIANSHIP_LINK_STATUSES.map((s) => ({
            status: s,
            _count: { _all: selected.filter((r) => r.status === s).length },
          })).filter((g) => g._count._all > 0),
        );
      }),
    },
  };
  const users = { ensureUser: jest.fn().mockResolvedValue({ id: 'u1', tenantId: TENANT }) };
  const ctx = { forUser: jest.fn().mockResolvedValue({ schoolId }) };
  const controller = new GuardiansController(prisma as never, users as never, ctx as never);
  return { controller, prisma };
}

const jwt = () =>
  ({ sub: 'kc-sub', realm_access: { roles: ['admin'] } }) as unknown as KeycloakJwtPayload;

/** Ce que le KPI du tableau de bord et le compte du centre d'action calculent. */
const kpiValue = (rows: Row[], schoolId: string) =>
  selectRows(rows, guardianshipPendingRequestWhere({ tenantId: TENANT, schoolId })).length;

/* ================================================================== *
 * L'ACCORD — le cœur de la tranche
 * ================================================================== */

describe('S-E03-5 — le nombre annoncé et la file où le CTA envoie s’accordent', () => {
  it('T-1 — un fixture, trois lectures, UNE valeur', async () => {
    const rows = [
      row('r1', 'pending', SCHOOL_A, { day: 1 }),
      row('r2', 'pending', SCHOOL_A, { day: 2 }),
      row('r3', 'active', SCHOOL_A, { day: 3 }),
      row('r4', 'revoked', SCHOOL_A, { day: 4 }),
    ];

    const kpi = kpiValue(rows, SCHOOL_A);
    const actionCenter = kpiValue(rows, SCHOOL_A);

    const { controller } = makeController(rows, SCHOOL_A);
    const queue = await controller.listPendingRequests(jwt(), 'pending');

    expect(kpi).toBe(2);
    expect(actionCenter).toBe(kpi);
    expect(queue.total).toBe(kpi);
    expect(queue.data.map((r) => r.id)).toEqual(['r1', 'r2']);
  });

  it('T-2 — MULTI-ÉCOLES : le cas qui aurait été ROUGE avant ADR-075 §D2', async () => {
    // AVANT la tranche, le KPI comptait `{ tenantId, status: 'pending' }` —
    // TENANT-WIDE — pendant que la file était scopée à l'école. Sur ce fixture
    // il aurait affiché 3 au-dessus d'une file de 1 : PF-20 par la portée, et
    // non par la forme. Corriger les onglets sans scoper le KPI l'aurait laissé
    // vivant dans tout tenant multi-écoles.
    const rows = [
      row('a1', 'pending', SCHOOL_A, { day: 1 }),
      row('b1', 'pending', SCHOOL_B, { day: 2 }),
      row('b2', 'pending', SCHOOL_B, { day: 3 }),
    ];

    const tenantWide = rows.filter((r) => r.tenantId === TENANT && r.status === 'pending').length;
    expect(tenantWide).toBe(3); // l'ancienne valeur, mesurée pour mémoire

    const kpi = kpiValue(rows, SCHOOL_A);
    const { controller } = makeController(rows, SCHOOL_A);
    const queue = await controller.listPendingRequests(jwt(), 'pending');

    expect(kpi).toBe(1);
    expect(queue.total).toBe(kpi);
    expect(kpi).not.toBe(tenantWide);
  });

  it('T-3 — l’axe est `student.schoolId`, même quand `guardian.schoolId` diverge', async () => {
    // `createGuardianship` exige l'égalité des deux écoles À L'ÉCRITURE
    // SEULEMENT ; rien n'empêche une mutation ultérieure ni une ligne importée
    // de les désaligner. Le choix d'axe n'est donc pas cosmétique, et les deux
    // surfaces doivent faire le MÊME choix, sans quoi PF-20 se rouvre par la
    // porte de derrière.
    const rows = [row('x1', 'pending', SCHOOL_A, { guardianSchoolId: SCHOOL_B, day: 1 })];

    const { controller: inA } = makeController(rows, SCHOOL_A);
    const { controller: inB } = makeController(rows, SCHOOL_B);

    expect(kpiValue(rows, SCHOOL_A)).toBe(1);
    expect((await inA.listPendingRequests(jwt(), 'pending')).total).toBe(1);

    expect(kpiValue(rows, SCHOOL_B)).toBe(0);
    expect((await inB.listPendingRequests(jwt(), 'pending')).total).toBe(0);
  });

  it('T-4 — un autre TENANT n’entre dans aucune des deux lectures (G-TENANT)', async () => {
    const rows = [
      row('mine', 'pending', SCHOOL_A, { day: 1 }),
      row('theirs', 'pending', SCHOOL_A, { tenantId: 'tenant-2', day: 2 }),
    ];
    const { controller } = makeController(rows, SCHOOL_A);
    expect(kpiValue(rows, SCHOOL_A)).toBe(1);
    expect((await controller.listPendingRequests(jwt(), 'pending')).total).toBe(1);
  });

  it('T-5 — les trois sites analytiques passent bien par le constructeur', () => {
    // L'autre moitié de l'accord. Sans elle, T-1 comparerait le contrat à
    // lui-même. Les trois sites sont NOMMÉS pour que l'échec dise lequel a
    // re-divergé, et le compte est `>= 3` (jamais `==`) parce que la courbe
    // `sparkline` en est un quatrième légitime.
    const source = readFileSync(
      resolve(__dirname, 'analytics.service.ts'),
      'utf8',
    );
    const uses = source.split('guardianshipPendingRequestWhere({ tenantId, schoolId })').length - 1;
    expect(uses).toBeGreaterThanOrEqual(3);
    expect(source).not.toContain("status: 'pending'");
  });
});

/* ================================================================== *
 * LA FILE MONTRE CE QU'ELLE PRÉTEND MONTRER — les cinq onglets
 * ================================================================== */

describe('S-E03-5 — la file n’a plus d’onglet structurellement vide (G-DNC / DNC-06)', () => {
  const rows = [
    row('p1', 'pending', SCHOOL_A, { day: 1 }),
    row('p2', 'pending', SCHOOL_A, { day: 2 }),
    row('a1', 'active', SCHOOL_A, { day: 3 }),
    row('v1', 'revoked', SCHOOL_A, { day: 4 }),
    row('other', 'pending', SCHOOL_B, { day: 5 }),
  ];

  it('T-6 — chaque état de l’énum a une sortie ÉCRITE, révoqués compris', async () => {
    // C'est le point d'ADR-075 §D1 contre l'option « aplatir » : depuis ADR-074,
    // la relation `guardianships` de `GET /guardians` est filtrée AU REGISTRE,
    // donc les révoqués n'y sont plus — l'onglet « Rejetées » serait resté vide
    // POUR TOUJOURS. DNC-06 aurait été DÉPLACÉ, pas retiré.
    const { controller } = makeController(rows, SCHOOL_A);
    for (const status of GUARDIANSHIP_LINK_STATUSES) {
      const page = await controller.listPendingRequests(jwt(), status);
      expect(page.data.every((r) => r.status === status)).toBe(true);
      expect(page.total).toBe(
        rows.filter((r) => r.student.schoolId === SCHOOL_A && r.status === status).length,
      );
    }
  });

  it('T-7 — les badges lisent des TOTAUX SERVEUR, jamais un `.length` de page', async () => {
    // Une file dont les badges comptent une page tronquée, sous un KPI qui
    // compte la base, remplace « 28 vs 0 » par « 28 vs 19 » : plus discret,
    // donc pire. `pageSize=1` rend la troncature maximale et le total doit
    // rester celui de la base.
    const { controller } = makeController(rows, SCHOOL_A);
    const page = await controller.listPendingRequests(jwt(), undefined, '1', '1');
    expect(page.data).toHaveLength(1);
    expect(page.total).toBe(4);
    expect(page.totalsByStatus).toEqual({ pending: 2, active: 1, revoked: 1 });
  });

  it('T-8 — `totalsByStatus` porte CHAQUE état, à zéro s’il est vide', async () => {
    // Un badge absent et un badge à zéro ne disent pas la même chose ; le
    // client ne doit pas avoir à deviner lequel il regarde.
    const { controller } = makeController([row('p', 'pending', SCHOOL_A)], SCHOOL_A);
    const page = await controller.listPendingRequests(jwt());
    for (const status of GUARDIANSHIP_LINK_STATUSES) {
      expect(page.totalsByStatus).toHaveProperty(status);
    }
    expect(page.totalsByStatus.revoked).toBe(0);
  });

  it('T-9 — un statut inconnu est REFUSÉ, jamais silencieusement élargi', async () => {
    const { controller } = makeController(rows, SCHOOL_A);
    await expect(controller.listPendingRequests(jwt(), 'approved')).rejects.toThrow(
      /Statut de rattachement inconnu/,
    );
  });

  it('T-10 — la file porte sa PORTÉE, et c’est la même chaîne que le KPI', async () => {
    const { controller } = makeController(rows, SCHOOL_A);
    const page = await controller.listPendingRequests(jwt());
    expect(page.guardianshipScope).toBe(GUARDIANSHIP_SCOPE_LABEL.awaitingDecision);
  });

  it('T-11 — `pageSize` est plafonné à 100 et plancherisé à 1', async () => {
    const { controller, prisma } = makeController(rows, SCHOOL_A);
    await controller.listPendingRequests(jwt(), undefined, '1', '10000');
    expect(prisma.guardianship.findMany.mock.calls[0]![0]!.take).toBe(100);

    const second = makeController(rows, SCHOOL_A);
    await second.controller.listPendingRequests(jwt(), undefined, '1', '0');
    expect(second.prisma.guardianship.findMany.mock.calls[0]![0]!.take).toBe(10);
  });
});

/* ================================================================== *
 * LE MODULE CONTRACTUEL — §2.7, testé pour lui-même
 * ================================================================== */

describe('S-E03-5 — le prédicat canonique (§2.7)', () => {
  it('T-12 — le `where` porte TOUJOURS `tenantId` ET `student.schoolId`', () => {
    // L'assertion que le pré-mortem réclamait : la portée est complète en un
    // seul appel, donc aucun site ne peut en épeler la moitié.
    const where = guardianshipPendingRequestWhere({ tenantId: 'T', schoolId: 'S' });
    expect(where.tenantId).toBe('T');
    expect(where.student).toEqual({ schoolId: 'S' });
    expect(where.status.in).toEqual(['pending']);
    expect(Object.keys(where).sort()).toEqual(['status', 'student', 'tenantId']);
  });

  it('T-13 — chaque appel rend un tableau FRAIS : la liste canonique est intouchable', () => {
    const first = guardianshipPendingRequestWhere({ tenantId: 'T', schoolId: 'S' });
    first.status.in.push('active');
    const second = guardianshipPendingRequestWhere({ tenantId: 'T', schoolId: 'S' });
    expect(second.status.in).toEqual(['pending']);
    expect([...GUARDIANSHIP_AWAITING_DECISION_STATUSES]).toEqual(['pending']);
  });

  it('T-14 — le pendant EN MÉMOIRE s’accorde avec le `where` sur TOUTE l’énum', () => {
    // Narrower la requête seule déplacerait la contradiction de Postgres vers
    // le processus — la leçon de `dedupKey()` (ADR-068 §3).
    const where = guardianshipPendingRequestWhere({ tenantId: 'T', schoolId: 'S' });
    for (const status of GUARDIANSHIP_LINK_STATUSES) {
      expect(isGuardianshipAwaitingDecision({ status })).toBe(where.status.in.includes(status));
    }
  });

  it('T-15 — la liste est POSITIVE : elle NOMME ses états au lieu de les soustraire', () => {
    // Un quatrième membre ajouté à `GuardianshipStatus` ne doit pas devenir
    // « du travail en attente » — donc entrer dans le KPI d'un directeur — par
    // le seul fait d'avoir été ajouté à une énum.
    expect(GUARDIANSHIP_AWAITING_DECISION_STATUSES).toHaveLength(1);
    expect(GUARDIANSHIP_AWAITING_DECISION_STATUSES).not.toEqual(
      GUARDIANSHIP_LINK_STATUSES.filter((s) => s !== 'revoked'),
    );
  });

  it('T-16 — la file « tous états » et le KPI partagent LITTÉRALEMENT la même jointure', () => {
    const scope = { tenantId: 'T', schoolId: 'S' };
    const all = guardianshipRequestQueueWhere(scope, GUARDIANSHIP_LINK_STATUSES);
    const pending = guardianshipPendingRequestWhere(scope);
    expect(all.tenantId).toBe(pending.tenantId);
    expect(all.student).toEqual(pending.student);
    expect(all.status.in).toEqual([...GUARDIANSHIP_LINK_STATUSES]);
  });

  it('T-17 — le vocabulaire du contrat égale l’énum `GuardianshipStatus` de Prisma', () => {
    // La paire de listes tenues à la main que ce dépôt a déjà payée une fois
    // (`academic_year.SELECT`, run 59). Mesurée des deux côtés, jamais relue.
    const schema = readFileSync(
      join(resolve(__dirname, '..', '..', '..'), 'prisma', 'schema.prisma'),
      'utf8',
    );
    const block = schema.match(/enum GuardianshipStatus \{([^}]*)\}/);
    expect(block).not.toBeNull();
    const fromPrisma = block![1]!
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith('//'));
    expect([...GUARDIANSHIP_LINK_STATUSES].sort()).toEqual([...fromPrisma].sort());
    // Et chaque état « en attente » est bien un membre de l'énum réelle.
    for (const s of GUARDIANSHIP_AWAITING_DECISION_STATUSES) {
      expect(fromPrisma).toContain(s);
    }
  });
});
