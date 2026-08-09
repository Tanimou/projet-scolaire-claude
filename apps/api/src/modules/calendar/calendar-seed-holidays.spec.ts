import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import {
  MAX_USER_AGENT_LENGTH,
  deriveAlertActorProvenance,
  sanitiseInetOrNull,
  truncateUserAgent,
} from '../../shared/audit/provenance';

import {
  CalendarSeedService,
  resolveAcademicYearId,
  type AcademicYearWindow,
} from './calendar-seed.service';
import { SeedHolidaysDto } from './calendar.controller';
import { buildFrenchHolidayPlan, FRENCH_PUBLIC_HOLIDAYS } from './french-holidays';

/**
 * S-E06-6 / PF-29 — preuves de l'import des jours fériés français.
 *
 * Le contrôle auditté écrivait 22 lignes sur un clic, sans confirmation, dans
 * l'année scolaire active périmée, hors transaction, sans ligne d'audit et avec
 * une requête de déduplication non scopée au locataire. Ce fichier prouve
 * chaque moitié :
 *
 *  - G-AUDIT : la ligne d'audit est écrite par le client de TRANSACTION, dans la
 *    même transaction que les événements — démontré dans les DEUX sens (le
 *    `createMany` échoue → rien ; l'audit échoue → rien non plus) ;
 *  - G-TENANT : la lecture d'existence porte `tenantId`, et 22 lignes
 *    identiques sous un locataire ÉTRANGER ne suppriment pas la création
 *    locale (le correctif naïf — `tenantId` sur la création seulement — échoue
 *    ici, c'est la raison d'être du test) ;
 *  - G-DNC : DNC-06 (le périmètre annoncé vient du plan qui écrit), DNC-02/03
 *    (le computus est épinglé, jamais touché), DNC-12 (`confirm` n'est jamais
 *    défaillé).
 *
 * Tout est monté sur un faux Prisma transactionnel (le suite jest de la maison
 * ne dépend jamais d'une base vivante — cf. l'en-tête de
 * `restore-drill-gate.spec.ts`). Un passage contre la base locale réelle est
 * rapporté séparément comme preuve exécutée.
 */

const TENANT = 'tenant-local';
const OTHER_TENANT = 'tenant-etranger';
const SCHOOL = 'school-1';
const ACTOR = 'user-admin-1';

/** Année scolaire A : 2025-09-01 → 2026-07-05. */
const YEAR_A: AcademicYearWindow = {
  id: 'ay-a',
  name: '2025–2026',
  startDate: new Date('2025-09-01T00:00:00Z'),
  endDate: new Date('2026-07-05T00:00:00Z'),
};
/** Année scolaire B : 2026-09-01 → 2027-07-04. */
const YEAR_B: AcademicYearWindow = {
  id: 'ay-b',
  name: '2026–2027',
  startDate: new Date('2026-09-01T00:00:00Z'),
  endDate: new Date('2027-07-04T00:00:00Z'),
};

interface EventRow {
  tenantId: string;
  schoolId: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  academicYearId: string | null;
  type: string;
  scope: string;
  visibility: string;
  createdBy: string | null;
}

interface EventWhere {
  tenantId: string;
  schoolId: string;
  title: { in: string[] };
  startsAt: { in: Date[] };
}

interface AcademicYearWhere {
  tenantId: string;
  schoolId: string;
}

interface Harness {
  prisma: unknown;
  /** Événements RÉELLEMENT commités (une transaction rejetée n'y touche pas). */
  events: EventRow[];
  /** Lignes d'audit réellement commitées. */
  audits: Array<Record<string, unknown>>;
  recorded: {
    existenceWheres: EventWhere[];
    academicYearWheres: AcademicYearWhere[];
    txCreateMany: number;
    txCreate: number;
    /** Toute écriture tentée hors transaction (doit rester 0). */
    outsideTxWrites: number;
    /** Client utilisé pour chaque `auditLog.create` : 'tx' ou 'root'. */
    auditClients: Array<'tx' | 'root'>;
  };
}

function makeHarness(
  options: {
    academicYears?: AcademicYearWindow[];
    events?: EventRow[];
    failCreateMany?: boolean;
    failAudit?: boolean;
  } = {},
): Harness {
  const events: EventRow[] = [...(options.events ?? [])];
  const audits: Array<Record<string, unknown>> = [];
  const recorded: Harness['recorded'] = {
    existenceWheres: [],
    academicYearWheres: [],
    txCreateMany: 0,
    txCreate: 0,
    outsideTxWrites: 0,
    auditClients: [],
  };

  const findEvents = (source: EventRow[], where: EventWhere) => {
    recorded.existenceWheres.push(where);
    return source
      .filter(
        (e) =>
          e.tenantId === where.tenantId &&
          e.schoolId === where.schoolId &&
          where.title.in.includes(e.title) &&
          where.startsAt.in.some((d) => d.getTime() === e.startsAt.getTime()),
      )
      .map((e) => ({ title: e.title, startsAt: e.startsAt }));
  };

  const findAcademicYears = (where: AcademicYearWhere) => {
    recorded.academicYearWheres.push(where);
    return (options.academicYears ?? [])
      .filter(() => where.tenantId === TENANT && where.schoolId === SCHOOL)
      .slice()
      .sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
  };

  const prisma = {
    academicYear: {
      findMany: jest.fn(async ({ where }: { where: AcademicYearWhere }) =>
        findAcademicYears(where),
      ),
    },
    calendarEvent: {
      // Lecture hors transaction : c'est le chemin `dryRun` (une simulation est
      // une lecture), donc légitime.
      findMany: jest.fn(async ({ where }: { where: EventWhere }) => findEvents(events, where)),
      createMany: jest.fn(async () => {
        recorded.outsideTxWrites += 1;
        throw new Error('createMany hors transaction');
      }),
      create: jest.fn(async () => {
        recorded.outsideTxWrites += 1;
        throw new Error('create hors transaction');
      }),
    },
    auditLog: {
      create: jest.fn(async () => {
        recorded.auditClients.push('root');
        recorded.outsideTxWrites += 1;
        throw new Error('auditLog.create hors transaction');
      }),
    },
    $transaction: jest.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
      // Tampon de mise en attente : rien n'est visible avant que le callback
      // ait résolu. Une rejection propage (elle n'est PAS avalée) et le tampon
      // est jeté — c'est ce qui rend la preuve G-AUDIT réelle.
      const stagedEvents: EventRow[] = [];
      const stagedAudits: Array<Record<string, unknown>> = [];
      const tx = {
        academicYear: {
          findMany: jest.fn(async ({ where }: { where: AcademicYearWhere }) =>
            findAcademicYears(where),
          ),
        },
        calendarEvent: {
          findMany: jest.fn(async ({ where }: { where: EventWhere }) =>
            findEvents([...events, ...stagedEvents], where),
          ),
          createMany: jest.fn(async ({ data }: { data: EventRow[] }) => {
            recorded.txCreateMany += 1;
            if (options.failCreateMany) throw new Error('createMany a échoué');
            stagedEvents.push(...data);
            return { count: data.length };
          }),
          create: jest.fn(async ({ data }: { data: EventRow }) => {
            recorded.txCreate += 1;
            stagedEvents.push(data);
            return data;
          }),
        },
        auditLog: {
          create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
            recorded.auditClients.push('tx');
            if (options.failAudit) throw new Error('auditLog.create a échoué');
            stagedAudits.push(data);
            return data;
          }),
        },
      };
      const out = await cb(tx);
      events.push(...stagedEvents);
      audits.push(...stagedAudits);
      return out;
    }),
  };

  return { prisma, events, audits, recorded };
}

function service(harness: Harness): CalendarSeedService {
  return new CalendarSeedService(harness.prisma as never);
}

function args(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: TENANT,
    schoolId: SCHOOL,
    actorId: ACTOR,
    actorRole: 'school_admin',
    portal: 'admin',
    year: 2026,
    confirm: true,
    dryRun: false,
    ipAddress: null,
    userAgent: null,
    ...overrides,
  } as Parameters<CalendarSeedService['seedFrenchHolidays']>[0];
}

/** Les 11 fériés d'UNE année civile, tels qu'ils existeraient déjà en base. */
function seededRows(year: number, tenantId = TENANT): EventRow[] {
  return FRENCH_PUBLIC_HOLIDAYS(year).map((h) => ({
    tenantId,
    schoolId: SCHOOL,
    title: h.title,
    startsAt: new Date(`${h.date}T00:00:00Z`),
    endsAt: new Date(`${h.date}T23:59:59Z`),
    academicYearId: null,
    type: 'public_holiday',
    scope: 'school_wide',
    visibility: 'all',
    createdBy: ACTOR,
  }));
}

// ---------------------------------------------------------------------------
// AC-1 — rien ne s'écrit sans confirmation explicite (T1, T2)
// ---------------------------------------------------------------------------
describe('AC-1 — la confirmation est exigée côté serveur', () => {
  it('T1 — `confirm` absent : 400, zéro événement, zéro ligne d’audit', async () => {
    const h = makeHarness({ academicYears: [YEAR_A, YEAR_B] });
    await expect(
      service(h).seedFrenchHolidays(args({ confirm: false, dryRun: false })),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(h.events).toHaveLength(0);
    expect(h.audits).toHaveLength(0);
    expect(h.recorded.txCreateMany).toBe(0);
    expect(h.recorded.outsideTxWrites).toBe(0);
    expect(h.recorded.auditClients).toEqual([]);
    // Refus AVANT même la lecture : rien n'est interrogé.
    expect(h.recorded.existenceWheres).toHaveLength(0);
  });

  it('T2 — le message nomme les 22 événements ET les DEUX années civiles (DNC-06)', async () => {
    const h = makeHarness({ academicYears: [YEAR_A, YEAR_B] });
    const err = await service(h)
      .seedFrenchHolidays(args({ confirm: false }))
      .catch((e: Error) => e);

    const message = (err as BadRequestException).message;
    expect(message).toContain('22');
    expect(message).toContain('2026');
    expect(message).toContain('2027');
    expect(message).toContain('confirm');
  });
});

// ---------------------------------------------------------------------------
// AC-2 — l'année est CHOISIE, jamais supposée (T3, T4, T5)
// ---------------------------------------------------------------------------
describe('AC-2 — `year` est requis et sans repli', () => {
  it('T3 — avec year=2030, tout ce qui est écrit tombe en 2030 ou 2031 (jamais l’année active)', async () => {
    // L'année scolaire déclarée démarre en 2019 : l'ancien repli aurait écrit
    // 2019/2020 et estampillé les 22 lignes de son id.
    const stale: AcademicYearWindow = {
      id: 'ay-2019',
      name: '2019–2020',
      startDate: new Date('2019-09-01T00:00:00Z'),
      endDate: new Date('2020-07-05T00:00:00Z'),
    };
    const h = makeHarness({ academicYears: [stale] });
    const res = await service(h).seedFrenchHolidays(args({ year: 2030 }));

    expect(res.years).toEqual([2030, 2031]);
    expect(h.events).toHaveLength(22);
    for (const row of h.events) {
      expect([2030, 2031]).toContain(row.startsAt.getUTCFullYear());
      // Aucune ligne n'emporte l'id de l'année périmée.
      expect(row.academicYearId).toBeNull();
    }
  });

  it('T4 — le DTO refuse un corps vide (`year` requis)', () => {
    const errors = validateSync(plainToInstance(SeedHolidaysDto, {}), { whitelist: true });
    expect(errors.map((e) => e.property)).toContain('year');
  });

  it('T5 — le DTO borne et type `year` (famille PF-51 fermée sur ce DTO)', () => {
    const check = (payload: Record<string, unknown>) =>
      validateSync(plainToInstance(SeedHolidaysDto, payload), { whitelist: true });

    // Refusés — chacun produisait auparavant une `Invalid Date` puis un 500.
    expect(check({ year: 'abc' })).not.toHaveLength(0);
    expect(check({ year: '2026' })).not.toHaveLength(0); // pas de coercition implicite
    expect(check({ year: 1e9 })).not.toHaveLength(0);
    expect(check({ year: 1999 })).not.toHaveLength(0);
    expect(check({ year: 2101 })).not.toHaveLength(0);
    expect(check({ year: 2026.5 })).not.toHaveLength(0);

    // Acceptés.
    expect(check({ year: 2026, confirm: true })).toHaveLength(0);
    expect(check({ year: 2026, dryRun: true })).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// AC-3 — idempotence mesurée sur les LIGNES (T6, T16)
// ---------------------------------------------------------------------------
describe('AC-3 — relancer l’import ne crée aucun doublon', () => {
  it('T6 — 2e import identique : 0 créé, 22 déjà présents, magasin à 22, audit écrit avec created=0', async () => {
    const h = makeHarness({ academicYears: [YEAR_A, YEAR_B] });
    const first = await service(h).seedFrenchHolidays(args());
    expect(first.created).toBe(22);
    expect(h.events).toHaveLength(22);

    const second = await service(h).seedFrenchHolidays(args());
    expect(second.created).toBe(0);
    expect(second.alreadyPresent).toBe(22);
    expect(second.toCreate).toBe(0);
    expect(h.events).toHaveLength(22);

    // La ligne d'audit existe MÊME quand rien n'est créé.
    expect(h.audits).toHaveLength(2);
    const after = h.audits[1]?.after as Record<string, unknown>;
    expect(after.created).toBe(0);
    expect(after.alreadyPresent).toBe(22);
    expect(typeof after.summary).toBe('string');
    expect(after.summary as string).not.toHaveLength(0);
  });

  it('T16 — les 22 insertions sont UN `createMany` sur le client de transaction, jamais 22 `create`, jamais hors transaction', async () => {
    const h = makeHarness({ academicYears: [YEAR_A, YEAR_B] });
    await service(h).seedFrenchHolidays(args());

    expect(h.recorded.txCreateMany).toBe(1);
    expect(h.recorded.txCreate).toBe(0);
    expect(h.recorded.outsideTxWrites).toBe(0);
    // Une seule lecture d'existence pour les 22 candidats (pas 22 `findFirst`).
    expect(h.recorded.existenceWheres).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// AC-4 — G-AUDIT : une ligne, dans la MÊME transaction (T9..T12)
// ---------------------------------------------------------------------------
describe('AC-4 (G-AUDIT) — l’audit vit dans la transaction de l’import', () => {
  it('T9a — quand `createMany` échoue, ni les événements ni l’audit ne sont commités', async () => {
    const h = makeHarness({ academicYears: [YEAR_A, YEAR_B], failCreateMany: true });
    await expect(service(h).seedFrenchHolidays(args())).rejects.toThrow('createMany a échoué');
    expect(h.events).toHaveLength(0);
    expect(h.audits).toHaveLength(0);
  });

  it('T9b — quand `auditLog.create` échoue, aucun événement n’est commité non plus', async () => {
    const h = makeHarness({ academicYears: [YEAR_A, YEAR_B], failAudit: true });
    // S-E04-7 : l'écriture passe désormais par le seam `writeAudit`, qui RE-LANCE
    // l'échec enveloppé dans la phrase française destinée à l'opérateur
    // (`ADR-035` D2 — la ligne n'est jamais avalée, et le message affiché est une
    // phrase actionnable plutôt qu'une chaîne du pilote). Ce que T9b décide est
    // inchangé et reste décidé ci-dessous : rien n'est commité. La cause d'origine
    // est vérifiée aussi, pour que l'enveloppe ne puisse pas devenir un moyen de
    // perdre l'erreur réelle.
    await expect(service(h).seedFrenchHolidays(args())).rejects.toThrow(
      /la trace d’audit n’a pas pu être enregistrée/,
    );
    expect(h.events).toHaveLength(0);
    expect(h.audits).toHaveLength(0);
    // L'appel a bien eu lieu sur le client de TRANSACTION.
    expect(h.recorded.auditClients).toEqual(['tx']);

    const fresh = makeHarness({ academicYears: [YEAR_A, YEAR_B], failAudit: true });
    await expect(service(fresh).seedFrenchHolidays(args())).rejects.toMatchObject({
      cause: expect.objectContaining({
        message: expect.stringContaining('auditLog.create a échoué'),
      }),
    });
  });

  it('T10 — exactement une ligne, avec acteur, locataire, action, type et `after` cohérent avec la réponse', async () => {
    const h = makeHarness({ academicYears: [YEAR_A, YEAR_B] });
    const res = await service(h).seedFrenchHolidays(args());

    expect(h.audits).toHaveLength(1);
    expect(h.recorded.auditClients).toEqual(['tx']);
    const row = h.audits[0] as Record<string, unknown>;
    expect(row.tenantId).toBe(TENANT);
    expect(row.actorId).toBe(ACTOR);
    expect(row.actorRole).toBe('school_admin');
    expect(row.portal).toBe('admin');
    expect(row.action).toBe('calendar.seed_french_holidays');
    expect(row.resourceType).toBe('calendar_event');
    // Colonne uuid unique pour une action qui touche jusqu'à 22 lignes.
    expect(row.resourceId).toBeNull();

    const after = row.after as Record<string, unknown>;
    expect(after.requestedYear).toBe(2026);
    expect(after.years).toEqual(res.years);
    expect(after.planned).toBe(res.planned);
    expect(after.created).toBe(res.created);
    expect(after.alreadyPresent).toBe(res.alreadyPresent);
    expect(after.unattachedCount).toBe(
      res.academicYearAttachment.find((a) => a.academicYearId === null)?.count,
    );
    expect(after.academicYearIds).toEqual([YEAR_A.id, YEAR_B.id]);
  });

  it('T11 — `actorRole` est DÉRIVÉ : un JWT super_admin s’audite super_admin, jamais school_admin', async () => {
    const provenance = deriveAlertActorProvenance({
      realm_access: { roles: ['school_admin', 'super_admin'] },
    } as never);
    expect(provenance).toEqual({ actorRole: 'super_admin', portal: 'admin' });

    const h = makeHarness({ academicYears: [YEAR_A, YEAR_B] });
    await service(h).seedFrenchHolidays(
      args({ actorRole: provenance.actorRole, portal: provenance.portal }),
    );
    expect((h.audits[0] as Record<string, unknown>).actorRole).toBe('super_admin');

    // Et le handler ne contient aucun littéral 'school_admin'.
    const source = readFileSync(join(__dirname, 'calendar.controller.ts'), 'utf8');
    const handler = source.slice(source.indexOf('async seedFrenchHolidays('));
    expect(handler).not.toContain("'school_admin'");
  });

  it('T12 — IP et user-agent sont assainis AVANT la transaction (une valeur non-inet ne peut pas la faire échouer)', async () => {
    expect(sanitiseInetOrNull('203.0.113.7')).toBe('203.0.113.7');
    expect(sanitiseInetOrNull('::ffff:127.0.0.1')).toBe('::ffff:127.0.0.1');
    // Un X-Forwarded-For multi-valeurs est exactement ce que `inet` rejette.
    expect(sanitiseInetOrNull('203.0.113.7, 10.0.0.1')).toBeNull();
    expect(sanitiseInetOrNull('not-an-ip')).toBeNull();
    expect(sanitiseInetOrNull(undefined)).toBeNull();
    expect(truncateUserAgent('x'.repeat(2000))).toHaveLength(MAX_USER_AGENT_LENGTH);
    expect(truncateUserAgent('')).toBeNull();

    const ok = makeHarness({ academicYears: [YEAR_A, YEAR_B] });
    await service(ok).seedFrenchHolidays(
      args({ ipAddress: sanitiseInetOrNull('203.0.113.7'), userAgent: truncateUserAgent('Mozilla') }),
    );
    expect((ok.audits[0] as Record<string, unknown>).ipAddress).toBe('203.0.113.7');
    expect((ok.audits[0] as Record<string, unknown>).userAgent).toBe('Mozilla');

    const hostile = makeHarness({ academicYears: [YEAR_A, YEAR_B] });
    const res = await service(hostile).seedFrenchHolidays(
      args({
        ipAddress: sanitiseInetOrNull('not-an-ip'),
        userAgent: truncateUserAgent('u'.repeat(2000)),
      }),
    );
    // L'import réussit quand même : la provenance est absente, jamais fausse.
    expect(res.created).toBe(22);
    expect((hostile.audits[0] as Record<string, unknown>).ipAddress).toBeNull();
    expect((hostile.audits[0] as Record<string, unknown>).userAgent).toHaveLength(
      MAX_USER_AGENT_LENGTH,
    );
  });
});

// ---------------------------------------------------------------------------
// AC-5 — G-TENANT (T7, T8)
// ---------------------------------------------------------------------------
describe('AC-5 (G-TENANT) — la lecture d’existence est scopée au locataire', () => {
  it('T7 — 22 lignes identiques sous un locataire ÉTRANGER ne suppriment pas la création locale', async () => {
    // Le correctif naïf (ajouter `tenantId` à la création mais PAS au contrôle
    // d'existence) échoue ici : c'est la raison d'être du test.
    const h = makeHarness({
      academicYears: [YEAR_A, YEAR_B],
      events: seededRows(2026, OTHER_TENANT).concat(seededRows(2027, OTHER_TENANT)),
    });
    const res = await service(h).seedFrenchHolidays(args());

    expect(res.created).toBe(22);
    expect(res.alreadyPresent).toBe(0);
    expect(h.events.filter((e) => e.tenantId === TENANT)).toHaveLength(22);
  });

  it('T8 — `tenantId` figure dans le `where` de la lecture d’existence ET du `academicYear.findMany`', async () => {
    const h = makeHarness({ academicYears: [YEAR_A, YEAR_B] });
    await service(h).seedFrenchHolidays(args());

    expect(h.recorded.existenceWheres).toHaveLength(1);
    expect(h.recorded.existenceWheres[0]).toMatchObject({ tenantId: TENANT, schoolId: SCHOOL });
    expect(h.recorded.academicYearWheres[0]).toEqual({ tenantId: TENANT, schoolId: SCHOOL });
  });

  it('la déduplication garde `schoolId` : la 2e école du même locataire importe son jeu complet', async () => {
    const h = makeHarness({
      academicYears: [YEAR_A, YEAR_B],
      events: seededRows(2026).concat(seededRows(2027)),
    });
    const res = await service(h).seedFrenchHolidays(args({ schoolId: 'school-2' }));
    // `schoolId: 'school-2'` ne matche aucune ligne existante → jeu complet.
    expect(res.created).toBe(22);
  });
});

// ---------------------------------------------------------------------------
// AC-6 — vérité de la donnée : le rattachement suit la DATE (T13)
// ---------------------------------------------------------------------------
describe('AC-6 — `academicYearId` est résolu ligne par ligne', () => {
  it('T13 — Toussaint 2026 → B, Fête nationale 2026-07-14 → aucune, Noël 2027 → aucune, et les 22 lignes ne partagent PAS un seul id', async () => {
    const h = makeHarness({ academicYears: [YEAR_A, YEAR_B] });
    await service(h).seedFrenchHolidays(args({ year: 2026 }));

    const byKey = new Map(h.events.map((e) => [`${e.title}|${e.startsAt.toISOString()}`, e]));
    expect(byKey.get('Toussaint|2026-11-01T00:00:00.000Z')?.academicYearId).toBe(YEAR_B.id);
    // Creux d'été : aucune année scolaire française ne couvre le 14 juillet.
    expect(byKey.get('Fête nationale|2026-07-14T00:00:00.000Z')?.academicYearId).toBeNull();
    // Après la fin de B : hors de toute année déclarée.
    expect(byKey.get('Noël|2027-12-25T00:00:00.000Z')?.academicYearId).toBeNull();
    // Le 1er janvier 2026 tombe bien dans A.
    expect(byKey.get('Jour de l’an|2026-01-01T00:00:00.000Z')?.academicYearId).toBe(YEAR_A.id);

    // C'est exactement la forme du défaut : le code d'origine estampillait un
    // seul et même id sur les 22 lignes.
    const ids = new Set(h.events.map((e) => e.academicYearId));
    expect(ids.size).toBeGreaterThan(1);
  });

  it('les bornes sont inclusives et un chevauchement est départagé par `startDate` asc', () => {
    expect(resolveAcademicYearId(new Date('2025-09-01T00:00:00Z'), [YEAR_A, YEAR_B])).toBe('ay-a');
    expect(resolveAcademicYearId(new Date('2026-07-05T00:00:00Z'), [YEAR_A, YEAR_B])).toBe('ay-a');
    expect(resolveAcademicYearId(new Date('2026-07-06T00:00:00Z'), [YEAR_A, YEAR_B])).toBeNull();
    // Deux années qui se chevauchent (rien en base ne l'interdit) : la première
    // dans l'ordre `startDate` asc gagne, de façon déterministe.
    const overlap: AcademicYearWindow = {
      id: 'ay-overlap',
      name: 'chevauchante',
      startDate: new Date('2026-06-01T00:00:00Z'),
      endDate: new Date('2027-06-01T00:00:00Z'),
    };
    expect(resolveAcademicYearId(new Date('2026-07-01T00:00:00Z'), [YEAR_A, overlap])).toBe('ay-a');
  });

  it('sans aucune année scolaire déclarée, les 22 lignes sont créées avec `academicYearId: null`', async () => {
    const h = makeHarness({ academicYears: [] });
    const res = await service(h).seedFrenchHolidays(args());
    expect(res.created).toBe(22);
    expect(h.events.every((e) => e.academicYearId === null)).toBe(true);
    expect(res.academicYearAttachment).toEqual([{ academicYearId: null, name: null, count: 22 }]);
  });
});

// ---------------------------------------------------------------------------
// AC-7 — DNC-06 : la simulation ne peut pas mentir (T14)
// ---------------------------------------------------------------------------
describe('AC-7 (DNC-06) — `dryRun` est une lecture', () => {
  it('T14 — `dryRun: true` ne commite ni événement ni audit, et annonce le même périmètre que l’écriture suivante', async () => {
    const h = makeHarness({ academicYears: [YEAR_A, YEAR_B] });
    const dry = await service(h).seedFrenchHolidays(args({ dryRun: true, confirm: false }));

    expect(dry.dryRun).toBe(true);
    expect(dry.created).toBe(0);
    expect(h.events).toHaveLength(0);
    expect(h.audits).toHaveLength(0);
    expect(h.recorded.txCreateMany).toBe(0);
    expect(h.recorded.outsideTxWrites).toBe(0);
    // Une simulation n'exige PAS `confirm` (une lecture n'est pas une écriture).

    const real = await service(h).seedFrenchHolidays(args());
    expect(real.years).toEqual(dry.years);
    expect(real.planned).toBe(dry.planned);
    expect(real.toCreate).toBe(dry.toCreate);
    expect(real.academicYearAttachment).toEqual(dry.academicYearAttachment);
    expect(real.created).toBe(dry.toCreate);
  });

  it('la simulation reflète les lignes déjà présentes (le compte annoncé est le vrai)', async () => {
    const h = makeHarness({ academicYears: [YEAR_A, YEAR_B], events: seededRows(2026) });
    const dry = await service(h).seedFrenchHolidays(args({ dryRun: true }));
    expect(dry.planned).toBe(22);
    expect(dry.alreadyPresent).toBe(11);
    expect(dry.toCreate).toBe(11);
  });
});

// ---------------------------------------------------------------------------
// AC-8 — DNC-02/03 : le computus est épinglé, pas retouché (T15)
// ---------------------------------------------------------------------------
describe('AC-8 (DNC-02/03) — épingle des dates mobiles', () => {
  it('T15 — 2026 : 11 entrées, Lundi de Pâques 04-06, Ascension 05-14, Lundi de Pentecôte 05-25', () => {
    const holidays = FRENCH_PUBLIC_HOLIDAYS(2026);
    expect(holidays).toHaveLength(11);
    const byTitle = new Map(holidays.map((h) => [h.title, h.date]));
    expect(byTitle.get('Lundi de Pâques')).toBe('2026-04-06');
    expect(byTitle.get('Ascension')).toBe('2026-05-14');
    expect(byTitle.get('Lundi de Pentecôte')).toBe('2026-05-25');
  });

  it('T15 — 2025 : 04-21, 05-29, 06-09', () => {
    const byTitle = new Map(FRENCH_PUBLIC_HOLIDAYS(2025).map((h) => [h.title, h.date]));
    expect(byTitle.get('Lundi de Pâques')).toBe('2025-04-21');
    expect(byTitle.get('Ascension')).toBe('2025-05-29');
    expect(byTitle.get('Lundi de Pentecôte')).toBe('2025-06-09');
  });

  it('le plan couvre TOUJOURS deux années civiles — 22 entrées', () => {
    const plan = buildFrenchHolidayPlan(2026);
    expect(plan.years).toEqual([2026, 2027]);
    expect(plan.planned).toBe(22);
    expect(plan.entries).toHaveLength(22);
    expect(plan.entries.filter((e) => e.startsAt.getUTCFullYear() === 2026)).toHaveLength(11);
    expect(plan.entries.filter((e) => e.startsAt.getUTCFullYear() === 2027)).toHaveLength(11);
  });
});
