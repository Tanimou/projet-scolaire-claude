import { type PrismaClient } from '@prisma/client';

import { type ImportCaches } from './handler.types';

/**
 * A minimal Prisma surface the cache builder needs — lets both the API
 * `PrismaService` and the worker `PrismaService` (distinct Nest providers,
 * same `PrismaClient`) call this one builder without a cross-app import.
 */
type CachePrisma = Pick<
  PrismaClient,
  'gradeLevel' | 'subject' | 'classSection' | 'student' | 'guardian' | 'academicYear'
>;

/**
 * Build the per-batch O(1) lookup caches. Relocated verbatim from
 * `ImportsService.buildCaches` so the validate path (API) and the async apply
 * path (worker) build identical caches from ONE implementation.
 */
export async function buildImportCaches(prisma: CachePrisma, schoolId: string): Promise<ImportCaches> {
  const [levels, subjects, classes, students, guardians, ay] = await Promise.all([
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
    prisma.academicYear.findFirst({ where: { schoolId, status: 'active' } }),
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
    activeAcademicYearId: ay?.id ?? null,
  };
}
