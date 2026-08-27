import 'reflect-metadata';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  BadRequestException,
  ParseEnumPipe,
  ParseUUIDPipe,
  type ArgumentMetadata,
  type PipeTransform,
} from '@nestjs/common';
import { StudentStatus } from '@prisma/client';

import { type KeycloakJwtPayload } from '../../shared/auth/jwt.strategy';

import { StudentsController } from './students.controller';

/**
 * S-E05-16 / `PF-288` / `PF-51` clause 3 / `ADR-066` — `GET /api/v1/students`.
 *
 * TWO CLAIMS, and they fail on the pre-diff tree for two DIFFERENT reasons.
 *
 *  (1) `AC-6` — the query parameters are validated AT THE PIPE. Pre-diff there
 *      were NO pipes on this route at all, so `getQueryPipes('status')` returns
 *      an EMPTY array and every case below fails at its first assertion.
 *
 *  (2) `AC-11` / `AC-12` / `ADR-065 §D5` — the scope folds into the `where` as
 *      an INTERSECTION that the caller's own filters cannot widen or clobber.
 *      Pre-diff the fold was `...(scope.studentIds ? … : {})` (absent-key
 *      fail-open) and `where.enrollments = …` (a caller-controlled ASSIGNMENT).
 *
 * WHY THE PIPES ARE READ OFF ROUTE METADATA RATHER THAN RE-CONSTRUCTED. This
 * repo has been burned by the opposite: `S-E05-15`'s 55 cases all built the
 * controller directly, so the DI container, `PermissionsGuard` and every pipe
 * were absent from the call path and the assertions were vacuous. A freshly
 * constructed `new ParseEnumPipe(...)` in a test proves only that Nest's pipe
 * works — it proves nothing about THIS route. The pipe objects below are the
 * ones the `@Query(...)` decorators actually registered on
 * `StudentsController.prototype.list`, so a refactor that DROPS a pipe makes
 * these cases fail loudly instead of silently.
 */

/** Nest's route-parameter metadata key, as a LITERAL — same house convention as `enrollments-list-abac.spec.ts:117`. */
const ROUTE_ARGS_METADATA_KEY = '__routeArguments__';

/** The `@Query()` pipes Nest registered for one query key on `list`. */
function getQueryPipes(paramKey: string): PipeTransform[] {
  const meta =
    (Reflect.getMetadata(ROUTE_ARGS_METADATA_KEY, StudentsController, 'list') as
      | Record<string, { index: number; data?: unknown; pipes?: PipeTransform[] }>
      | undefined) ?? {};
  for (const entry of Object.values(meta)) {
    if (entry.data === paramKey) return entry.pipes ?? [];
  }
  return [];
}

/**
 * The ONE pipe registered for a query key, PINNED — same house convention as
 * `enrollments-list-abac.spec.ts:322` (`stmtAt`): an indexed read is narrowed by
 * throwing, never by a non-null assertion, so `noUncheckedIndexedAccess` keeps
 * doing its job. An empty list here IS the pre-diff state this file catches, and
 * it fails the case loudly instead of on a downstream `undefined.transform`.
 */
function soleQueryPipe(paramKey: string): PipeTransform {
  const pipes = getQueryPipes(paramKey);
  const pipe = pipes[0];
  if (pipes.length !== 1 || pipe === undefined) {
    throw new Error(
      `expected exactly ONE @Query('${paramKey}') pipe registered on StudentsController.list, got ${pipes.length}`,
    );
  }
  return pipe;
}

/** `{ optional: true }` is what lets an ABSENT parameter through; without it every caller takes a 400. */
function pipeOptional(pipe: PipeTransform): boolean | undefined {
  return (pipe as { options?: { optional?: boolean } }).options?.optional;
}

const QUERY_META: ArgumentMetadata = { type: 'query', metatype: String, data: undefined };

describe('GET /api/v1/students — AC-6: the query params are validated AT THE PIPE (PF-51 clause 3)', () => {
  it('`status` carries an OPTIONAL ParseEnumPipe (registered on the ROUTE, not re-built here)', () => {
    expect(getQueryPipes('status')).toHaveLength(1);
    const pipe = soleQueryPipe('status');
    expect(pipe).toBeInstanceOf(ParseEnumPipe);
    expect(pipeOptional(pipe)).toBe(true);
  });

  it('`classSectionId` and `academicYearId` each carry an OPTIONAL ParseUUIDPipe, with NO version', () => {
    for (const key of ['classSectionId', 'academicYearId']) {
      expect(getQueryPipes(key)).toHaveLength(1);
      const pipe = soleQueryPipe(key);
      expect(pipe).toBeInstanceOf(ParseUUIDPipe);
      expect(pipeOptional(pipe)).toBe(true);
      // NO `version` => the `all` regex. Imported/seeded rows are not
      // guaranteed v4, so pinning `{ version: '4' }` would 400 legitimate ids.
      expect((pipe as { options?: { version?: string } }).options?.version).toBeUndefined();
    }
  });

  it('`?status=<garbage>` is REFUSED 400 by the route-registered pipe', async () => {
    const pipe = soleQueryPipe('status');

    await expect(pipe.transform('deleted', QUERY_META)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(pipe.transform('ACTIVE', QUERY_META)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      pipe.transform("active'; DROP TABLE students;--", QUERY_META),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('the refusal is a 400 and it happens BEFORE any Prisma statement is issued', async () => {
    const pipe = soleQueryPipe('status');
    const findMany = jest.fn();
    const count = jest.fn();
    const controller = new StudentsController(
      { student: { findMany, count } } as never,
      {} as never,
      {} as never,
      {} as never,
    );

    let status: unknown;
    try {
      // This is what Nest does before it invokes the handler.
      await pipe.transform('garbage', QUERY_META);
      throw new Error('the pipe accepted a garbage enum value');
    } catch (err) {
      expect(err).toBeInstanceOf(BadRequestException);
      status = (err as BadRequestException).getStatus();
    }

    expect(status).toBe(400);
    // The handler is never reached, so `student.findMany` / `count` — the only
    // Prisma statements this route issues — are never called. Pre-diff the
    // value reached a `@db` enum column and surfaced as an unmapped 500
    // (`P2023`, the systemic form is `PF-291`).
    expect(controller).toBeDefined();
    expect(findMany).not.toHaveBeenCalled();
    expect(count).not.toHaveBeenCalled();
  });

  it('`?status=` (PRESENT BUT EMPTY) is now a 400 — a STATED behaviour change, not a pre-state', async () => {
    // `parse-enum.pipe.js` short-circuits on `isNil(value) && optional`, and
    // `isNil` covers ONLY `null`/`undefined`. `''` is neither, so it is refused.
    // Pre-diff `...(status ? { status } : {})` treated `''` as absent.
    // No first-party caller emits it (`admin/students/page.tsx:140-142` and
    // `StudentsPageFilters.tsx:39-40` drop falsy values) — `PF-304`.
    const pipe = soleQueryPipe('status');
    await expect(pipe.transform('', QUERY_META)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('`optional: true` lets an ABSENT parameter through untouched (no 400 on the common path)', async () => {
    for (const key of ['status', 'classSectionId', 'academicYearId']) {
      const pipe = soleQueryPipe(key);
      await expect(pipe.transform(undefined, QUERY_META)).resolves.toBeUndefined();
      await expect(pipe.transform(null, QUERY_META)).resolves.toBeNull();
    }
  });

  it('every legitimate StudentStatus value still passes', async () => {
    const pipe = soleQueryPipe('status');
    for (const value of Object.values(StudentStatus)) {
      await expect(pipe.transform(value, QUERY_META)).resolves.toBe(value);
    }
  });

  it('a non-UUID `classSectionId` is REFUSED 400 instead of reaching a @db.Uuid column', async () => {
    const pipe = soleQueryPipe('classSectionId');
    await expect(pipe.transform('not-a-uuid', QUERY_META)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    // No `version` option => the `all` regex, so imported/seeded non-v4 ids pass.
    await expect(
      pipe.transform('11111111-1111-1111-1111-111111111111', QUERY_META),
    ).resolves.toBe('11111111-1111-1111-1111-111111111111');
    await expect(
      pipe.transform('3f2504e0-4f89-41d3-9a0c-0305e82c3301', QUERY_META),
    ).resolves.toBe('3f2504e0-4f89-41d3-9a0c-0305e82c3301');
  });
});

/**
 * `AC-11` / `AC-12` — how the scope MEETS the caller's filters.
 *
 * These build the controller directly and ON PURPOSE: the subject here is the
 * `where` object the handler hands to Prisma, and the only way to read it is to
 * capture the Prisma argument. The pipes are proved separately above, against
 * route metadata, precisely so that this half is not mistaken for a full-stack
 * proof.
 */
describe('GET /api/v1/students — AC-11/AC-12: the scope INTERSECTS, it is never clobbered', () => {
  const TENANT = 't1';
  const SCHOOL = 'school-1';
  const YEAR = '2222abcd-0000-4000-8000-000000000001';
  const CS_MINE = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
  const CS_NOT_MINE = '11111111-1111-1111-1111-111111111111';

  function build(scopeStudentIds: string[] | null) {
    const findMany = jest.fn().mockResolvedValue([]);
    const count = jest.fn().mockResolvedValue(0);
    const controller = new StudentsController(
      { student: { findMany, count } } as never,
      { ensureUser: jest.fn().mockResolvedValue({ id: 'u1', tenantId: TENANT }) } as never,
      {
        forUser: jest
          .fn()
          .mockResolvedValue({ schoolId: SCHOOL, activeAcademicYearId: YEAR }),
      } as never,
      {
        scopeForUser: jest
          .fn()
          .mockResolvedValue({ studentIds: scopeStudentIds, reason: 'test' }),
      } as never,
    );
    const jwt = { sub: 'kc' } as unknown as KeycloakJwtPayload;
    const whereOf = () =>
      (findMany.mock.calls[0][0] as { where: Record<string, unknown> }).where;
    return { controller, jwt, findMany, count, whereOf };
  }

  it('an EMPTY scope is the DENY — `id: { in: [] }`, never an absent key', async () => {
    const { controller, jwt, whereOf, count } = build([]);

    await controller.list(jwt);

    // S-E03-3d / `PF-356` / `ADR-076` — MISE À JOUR DÉLIBÉRÉE, PAS UNE
    // SUPPRESSION. Le jeu VIDE est un jeu EXPLICITE, il perd donc lui aussi la
    // clé `schoolId` : ce cas assertait `schoolId: SCHOOL` avant la tranche.
    // La claim de CE test n'a pas bougé d'un pouce — `[]` doit produire
    // `id: { in: [] }`, jamais une clé absente — et ce refus est IMPOSSIBLE à
    // satisfaire avec ou sans clé d'école. On assert désormais l'ABSENCE de
    // `schoolId` en plus, pour que le retrait soit lui-même sous cliquet.
    expect(whereOf()).toMatchObject({ tenantId: TENANT, id: { in: [] } });
    expect(whereOf()).not.toHaveProperty('schoolId');
    expect(SCHOOL).toBe('school-1');
    // `count` must carry the SAME where — a total computed without the scope
    // leaks the size of the school.
    expect(count).toHaveBeenCalledWith({ where: whereOf() });
  });

  it('a BOUNDED scope narrows to exactly those ids, and carries NO school key (ADR-076)', async () => {
    const { controller, jwt, whereOf } = build(['s1', 's2']);

    await controller.list(jwt);

    expect(whereOf().id).toEqual({ in: ['s1', 's2'] });
    // Le jeu d'ids EST l'autorité et il est déjà tenant-keyé ; l'intersecter
    // avec « la plus grosse école » ne refusait aucun accès illégitime, elle
    // faisait disparaître des enfants légitimes (`PF-356`).
    expect(whereOf()).not.toHaveProperty('schoolId');
    // G-TENANT — la clé retirée n'est PAS celle du tenant.
    expect(whereOf().tenantId).toBe(TENANT);
  });

  it('the `null` sentinel (admins only) omits the `id` key entirely AND keeps the school working scope', async () => {
    const { controller, jwt, whereOf } = build(null);

    await controller.list(jwt);

    expect(whereOf()).not.toHaveProperty('id');
    // `AC-3` — la branche NON RESTREINTE est inchangée : son école de travail
    // est un choix délibéré de l'admin, pas une heuristique subie.
    expect(whereOf().schoolId).toBe(SCHOOL);
  });

  it('a caller-supplied `classSectionId` cannot CLOBBER the scope — both survive under AND', async () => {
    const { controller, jwt, whereOf } = build(['s1']);

    await controller.list(jwt, undefined, undefined, CS_NOT_MINE);

    const where = whereOf();
    // The scope clause is STILL there…
    expect(where.id).toEqual({ in: ['s1'] });
    // …and the caller filter is an INTERSECTION, not an assignment on `where`.
    expect(where).not.toHaveProperty('enrollments');
    expect(where.AND).toEqual([
      { enrollments: { some: { classSectionId: CS_NOT_MINE, status: 'active' } } },
    ]);
  });

  it('a teacher asking for a section they do not teach gets an intersection that cannot match', async () => {
    // The scope holds only students of CS_MINE; the caller asks for CS_NOT_MINE.
    // Both clauses are present, so the intersection is structurally empty —
    // pre-diff, the caller's filter REPLACED the (relational) scope clause.
    const { controller, jwt, whereOf } = build(['student-of-cs-mine']);

    await controller.list(jwt, undefined, undefined, CS_NOT_MINE);

    expect(whereOf().id).toEqual({ in: ['student-of-cs-mine'] });
    expect(whereOf().AND).toHaveLength(1);
    expect(CS_MINE).not.toBe(CS_NOT_MINE);
  });

  it('`unenrolled=true` also intersects instead of assigning', async () => {
    const { controller, jwt, whereOf } = build(['s1']);

    await controller.list(jwt, undefined, undefined, undefined, undefined, 'true');

    expect(whereOf().id).toEqual({ in: ['s1'] });
    expect(whereOf()).not.toHaveProperty('enrollments');
    expect(whereOf().AND).toEqual([
      { enrollments: { none: { academicYearId: YEAR, status: 'active' } } },
    ]);
  });

  it('with no caller filter at all, no empty `AND` is emitted', async () => {
    const { controller, jwt, whereOf } = build(['s1']);

    await controller.list(jwt);

    expect(whereOf()).not.toHaveProperty('AND');
  });
});

/**
 * `DNC-10` / `AC-12` — THE BYPASS THIS SLICE RETIRES MUST NOT COME BACK.
 *
 * The `TODO Phase 4` comment in `student-access.service.ts` WAS the hard-coded
 * bypass: it justified returning the unrestricted sentinel for every teacher.
 * These are grep-shaped assertions over the CODE only (comments stripped) —
 * a prose instruction does not stop a copy, this does. Same convention as
 * `enrollments-list-abac.spec.ts:869-877`.
 */
describe('S-E05-16 — DNC-10: no replacement bypass on the teacher axis', () => {
  const stripComments = (src: string): string =>
    src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

  const CODE = stripComments(readFileSync(join(__dirname, 'student-access.service.ts'), 'utf8'));
  const CTRL = stripComments(readFileSync(join(__dirname, 'students.controller.ts'), 'utf8'));

  it('no env flag, allow-list or escape hatch on the decision path', () => {
    expect(CODE).not.toMatch(/process\.env/);
    expect(CODE).not.toMatch(/SKIP_|ALLOW_|BYPASS|ALLOWLIST/);
  });

  it('exactly ONE `studentIds: null` survives in the code, and it is the ADMIN branch', () => {
    expect(CODE.split('studentIds: null').length - 1).toBe(1);
    expect(CODE).toMatch(/reason: 'admin'/);
    expect(CODE).not.toMatch(/unrestricted until teaching assignments land/);
    expect(CODE).not.toMatch(/TODO Phase 4/);
  });

  it('the READ-ONLY resolver is used and the UPSERT one is not (PF-265 / ADR-051 §D1)', () => {
    expect(CODE).toMatch(/teachers\.findForUser\(/);
    expect(CODE).not.toMatch(/ensureForUser/);
  });

  it('the two new reads carry an explicit tenantId in the CODE, not only in a comment (AC-3)', () => {
    // `teacherSectionsWhere` carries it by type AND by call site; the
    // enrollment read carries it inline; the profile read carries it inside
    // `findForUser`, which is declared in the gate enumeration already.
    expect(CODE).toMatch(/teacherSectionsWhere\(\{\s*tenantId: user\.tenantId/);
    expect(CODE).toMatch(/tenantId: user\.tenantId,\s*status: 'active'/);
  });

  it('the scope is folded on `=== null`, never on truthiness or `.length` (AC-12) — at its NEW single home', () => {
    // S-E03-3d / `ADR-076` — la discrimination a DÉMÉNAGÉ, elle n'a pas
    // disparu : `student-scope-where.ts` la porte désormais, et le contrôleur
    // en est un appelant unique. Cette claim est la MÊME (`PF-288` /
    // `ADR-065 §D5` : jamais la truthiness, JAMAIS `.length`) ; ce qui change
    // est le fichier où elle est vérifiée. Les DEUX fichiers sont lus, pour
    // qu'un retour de la composition en ligne rougisse ici.
    const SCOPE = stripComments(
      readFileSync(join(__dirname, 'student-scope-where.ts'), 'utf8'),
    );
    expect(SCOPE).toMatch(/studentIds === null/);
    for (const src of [SCOPE, CTRL]) {
      expect(src).not.toMatch(/studentIds\?\.length/);
      expect(src).not.toMatch(/studentIds \? \{/);
    }
    expect(CTRL).toMatch(/\.\.\.studentScopeWhere\(\{/);
  });

  it('S-E03-3d — the list `where` no longer makes `schoolId` and an ABAC id set CO-OCCUR (PF-356)', () => {
    // La forme pré-tranche, littéralement : `tenantId: me.tenantId,` suivi de
    // `schoolId,` nu, puis du pli du sentinel. Son retour est ce que le cliquet
    // `student-school-scope-gate.spec.ts` refuse à l'échelle du dépôt ; ici on
    // le refuse au site nommé, en clair, pour le relecteur.
    // Le motif est ANCRÉ sur la DÉCLARATION du `where` : un motif nu
    // `tenantId: me.tenantId, schoolId,` serait un FAUX POSITIF sur l'ARGUMENT
    // que le handler passe désormais à `studentScopeWhere(…)` — lequel est une
    // entrée de dérivation, pas une clause. Mesurer, pas supposer.
    expect(CTRL).not.toMatch(
      /const where: Prisma\.StudentWhereInput = \{\s*tenantId: me\.tenantId,\s*schoolId,/,
    );
    expect(CTRL).not.toMatch(/scope\.studentIds === null \? \{\} :/);
  });

  it('the clobbering `where.enrollments = …` ASSIGNMENT is gone from the list handler (AC-11)', () => {
    expect(CTRL).not.toMatch(/where\.enrollments\s*=/);
    expect(CTRL).toMatch(/where\.AND = callerFilters/);
  });

  it('the list handler types its `where` as `Prisma.StudentWhereInput`, not `Record<string, unknown>` (PF-301)', () => {
    expect(CTRL).toMatch(/const where: Prisma\.StudentWhereInput/);
  });
});
