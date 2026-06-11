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
  for (const c of classes) {
    classNamesPerYearLevel.add(`${c.academicYearId}:${c.gradeLevelId}:${c.name.toLowerCase()}`);
    classSectionsByName.set(`${c.academicYearId}:${c.name.toLowerCase()}`, {
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
    subjectsByCode,
    studentExternalRefs,
    studentsByExternalRef,
    guardiansByEmail,
    activeAcademicYearId: ay?.id ?? null,
  };
}
