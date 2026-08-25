import { type PrismaClient } from '@prisma/client';

import { type ImportCaches } from './handler.types';

/**
 * A minimal Prisma surface the cache builder needs — lets both the API
 * `PrismaService` and the worker `PrismaService` (distinct Nest providers,
 * same `PrismaClient`) call this one builder without a cross-app import.
 */
type CachePrisma = Pick<
  PrismaClient,
  'gradeLevel' | 'subject' | 'classSection' | 'student' | 'guardian'
>;

/**
 * Build the per-batch O(1) lookup caches. Relocated verbatim from
 * `ImportsService.buildCaches` so the validate path (API) and the async apply
 * path (worker) build identical caches from ONE implementation.
 *
 * S-E03-4 / PF-15 / ADR-070 — `activeAcademicYearId` IS NOW PASSED IN, and that
 * is the whole point.
 *
 * This function used to resolve it itself:
 *
 *     prisma.academicYear.findFirst({ where: { schoolId, status: 'active' } })
 *
 * `schoolId` alone — **no `tenantId`, no `orderBy`** — i.e. byte-for-byte the
 * same defect as `school-context.service.ts:32`, but WORSE, because the result
 * is not merely reported: it becomes `ImportCaches.activeAcademicYearId`, which
 * `handlers/classes.handler.ts` and `handlers/enrollments.handler.ts` write into
 * new `class_section` and `enrollment` rows. A wrong resolution here does not
 * misreport a count; it PERSISTS one. RLS did not cover it either — this path
 * runs on `PrismaService`, the OWNER connection, where RLS is bypassed.
 *
 * It is hoisted rather than converted in place: `@pilotage/imports-core` would
 * otherwise need `@pilotage/contracts` as a dependency, which means a
 * `package.json` + `pnpm-lock.yaml` + two production Dockerfile edits that NO
 * agent in this run is allowed to build and verify. Hoisting closes the
 * ACADEMIC-YEAR tenancy defect at the three callers — all of which hold
 * `tenantId` — costs this package NO new dependency, and leaves zero
 * `academicYear` reads in `packages/**`, so the S-E03-4 ratchet needs no
 * allowlist for it.
 *
 * READ THAT CLAIM NARROWLY — IT IS ONE QUERY, NOT THIS FUNCTION.
 * -------------------------------------------------------------
 * An earlier draft of this header said hoisting "closes the tenancy defect at
 * the three callers", full stop. That was an overclaim, and the kind this
 * repository has been burned by: the FIVE sibling reads immediately below —
 * `gradeLevel`, `subject`, `classSection`, `student`, `guardian` — are still
 * scoped by `schoolId` ALONE, on the same owner connection, and they feed the
 * matching and dedup decisions of the import WRITE path. They are correct for
 * the same reason the academic-year read was correct before this slice: their
 * caller happens to pass a school of the right tenant. That is correctness by
 * accident of the caller, which is exactly what `ADR-002` exists to remove.
 * Applying `ADR-070`'s own standard to them is a separate slice with its own
 * evidence; recorded as `PF-334`, deliberately NOT fixed here.
 *
 * @param activeAcademicYearId resolved by the CALLER through the canonical
 *   `resolveActiveAcademicYear` (tenant-keyed, totally ordered). `null` when the
 *   (tenant, school) has no active year — exactly what the old `ay?.id ?? null`
 *   produced.
 */
export async function buildImportCaches(
  prisma: CachePrisma,
  schoolId: string,
  activeAcademicYearId: string | null,
): Promise<ImportCaches> {
  const [levels, subjects, classes, students, guardians] = await Promise.all([
    prisma.gradeLevel.findMany({ where: { schoolId } }),
    prisma.subject.findMany({ where: { schoolId } }),
    prisma.classSection.findMany({
      where: { gradeLevel: { schoolId } },
      select: {
        id: true,
        name: true,
        academicYearId: true,
        gradeLevelId: true,
        maxStudents: true,
        _count: { select: { enrollments: { where: { status: 'active' } } } },
      },
    }),
    prisma.student.findMany({
      where: { schoolId, externalRef: { not: null } },
      // E11-S2 — also select the reconcilable fields so a matched re-import can be
      // classified unchanged/updated/conflict in `applyRow` with no extra query.
      select: {
        id: true,
        externalRef: true,
        firstName: true,
        lastName: true,
        birthDate: true,
        email: true,
        notes: true,
      },
    }),
    prisma.guardian.findMany({
      where: { schoolId, email: { not: null } },
      select: { id: true, firstName: true, lastName: true, email: true },
    }),
  ]);

  const gradeLevelsByCode = new Map<string, { id: string; name: string }>();
  const gradeLevelsByName = new Map<string, { id: string; name: string; code: string }>();
  for (const l of levels) {
    gradeLevelsByCode.set(l.code.toLowerCase(), { id: l.id, name: l.name });
    gradeLevelsByName.set(l.name.toLowerCase(), { id: l.id, name: l.name, code: l.code });
  }
  const subjectsByCode = new Map<string, { id: string; name: string }>();
  for (const s of subjects) subjectsByCode.set(s.code.toUpperCase(), { id: s.id, name: s.name });

  const classNamesPerYearLevel = new Set<string>();
  const classSectionsByName = new Map<
    string,
    { id: string; gradeLevelId: string; academicYearId: string; maxStudents: number; currentSize: number }
  >();
  // E11 polish (#5 follow-on iii) — grade-level disambiguation. A class name is
  // unique only PER (year, gradeLevel) — `@@unique([academicYearId, gradeLevelId,
  // name])`, NOT per year. Two same-named sections in different grade levels (e.g.
  // a "6eA" in 6ème and a stray "6eA" in 5ème) share the `academicYearId:name`
  // `classSectionsByName` key, so the last `set()` wins — silently overwriting the
  // earlier entry. An enrollments row carries ONLY `className` (no grade level by
  // contract), so it cannot pick between them. We record every such ambiguous
  // `academicYearId:name` key here; the enrollments handler must NOT trust the
  // (last-write-wins, arbitrary) `classSectionsByName` entry for an ambiguous name
  // and instead surfaces a clear French 4xx. The overwhelmingly common
  // unambiguous case is byte-identical (the name maps to exactly one class).
  const classSectionsByNameAmbiguous = new Set<string>();
  const seenNameKeys = new Set<string>();
  for (const c of classes) {
    classNamesPerYearLevel.add(`${c.academicYearId}:${c.gradeLevelId}:${c.name.toLowerCase()}`);
    const nameKey = `${c.academicYearId}:${c.name.toLowerCase()}`;
    if (seenNameKeys.has(nameKey)) classSectionsByNameAmbiguous.add(nameKey);
    seenNameKeys.add(nameKey);
    classSectionsByName.set(nameKey, {
      id: c.id,
      gradeLevelId: c.gradeLevelId,
      academicYearId: c.academicYearId,
      maxStudents: c.maxStudents,
      currentSize: c._count.enrollments,
    });
  }
  const studentExternalRefs = new Map<string, string>();
  const studentsByExternalRef: ImportCaches['studentsByExternalRef'] = new Map();
  for (const s of students) {
    if (!s.externalRef) continue;
    studentExternalRefs.set(s.externalRef, s.id);
    studentsByExternalRef.set(s.externalRef, {
      id: s.id,
      firstName: s.firstName,
      lastName: s.lastName,
      birthDate: s.birthDate,
      email: s.email,
      notes: s.notes,
    });
  }

  const guardiansByEmail = new Map<string, { id: string; firstName: string; lastName: string }>();
  for (const g of guardians) {
    if (g.email) {
      guardiansByEmail.set(g.email.toLowerCase(), { id: g.id, firstName: g.firstName, lastName: g.lastName });
    }
  }

  return {
    gradeLevelsByCode,
    gradeLevelsByName,
    classNamesPerYearLevel,
    classSectionsByName,
    classSectionsByNameAmbiguous,
    subjectsByCode,
    studentExternalRefs,
    studentsByExternalRef,
    guardiansByEmail,
    activeAcademicYearId,
  };
}
