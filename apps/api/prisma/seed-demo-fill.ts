/* eslint-disable no-console */
/**
 * Demo fill — populates the two dashboard cards that ship empty in the demo:
 *   1. Parent "Assiduité / Attendance" card  (attendanceRate, %)
 *   2. Teacher  + Parent "Évaluations à venir / Upcoming assessments" cards
 *
 * Anchored on the `voltaire-demo` tenant created by seed-demo.ts. Resolves every
 * target entity by query at runtime (no hard-coded UUIDs) and mirrors the EXACT
 * filter logic of the analytics handlers so the rows actually surface on the
 * dashboards:
 *
 *   • Parent attendance  (analytics.service.ts ~955): counts ALL AttendanceRecord
 *     rows for the *demo child* (`{ tenantId, studentId }`, no date window), so we
 *     must give the child herself attendance rows — not just her classmates.
 *   • Parent upcoming    (analytics.service.ts ~603): Assessment where
 *     `teachingAssignment.classSectionId = childClass` and
 *     `scheduledAt ∈ [now, now+60d]`.
 *   • Teacher upcoming   (analytics.service.ts ~1497): Assessment where
 *     `teacherProfileId = demoTeacher` and `scheduledAt ∈ [now, now+30d]`.
 *
 * To make ONE assessment row light up BOTH cards we seed it on a
 * TeachingAssignment whose `teacherProfileId` is the demo teacher AND whose
 * `classSectionId` is the demo child's class (find-or-create that edge).
 *
 * Fully IDEMPOTENT:
 *   - assessments are deleted by a title marker, then recreated → converges.
 *   - attendance uses a deterministic per-(session,student) status + upsert on the
 *     @@unique([classSessionId, studentId]) key → converges to the same rows.
 *   - sessions are looked up by (teachingAssignmentId, date) before create.
 *
 * Defensive: if any anchor (tenant / child / class / teacher / assignment) can't
 * be resolved, the affected part logs a warning and is skipped — never throws the
 * whole script, so a partial demo still fills what it can.
 *
 * Run AFTER seed-demo.ts + seed-demo-teacher.ts + seed-demo-parent.ts:
 *   pnpm --filter @pilotage/api exec tsx prisma/seed-demo-fill.ts
 */
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
import { PrismaClient, AttendanceStatus } from '@prisma/client';

loadEnv({ path: resolve(__dirname, '..', '.env') });
const prisma = new PrismaClient();

// Legacy marker — earlier runs prefixed titles with this; we now use clean,
// user-facing titles and clean it up on re-run (no debug text shown in the UI).
const LEGACY_ASSESSMENT_MARKER = '[SEED-FILL]';
const DAY_MS = 24 * 60 * 60 * 1000;

/** Deterministic 0..1 hash from a string — keeps re-runs converging (no RNG). */
function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // >>> 0 → unsigned, then normalise to [0,1)
  return (h >>> 0) / 4294967296;
}

/** Realistic, deterministic status mix: ~78% present, ~12% excused, ~7% late, ~3% absent. */
function statusFor(seed: string): AttendanceStatus {
  const r = hash01(seed);
  if (r < 0.78) return AttendanceStatus.present;
  if (r < 0.9) return AttendanceStatus.absent_excused;
  if (r < 0.97) return AttendanceStatus.late;
  return AttendanceStatus.absent;
}

/** Date at local midnight (ClassSession.date is @db.Date). */
function dateOnly(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

type Anchors = {
  tenantId: string;
  schoolId: string;
  childId: string;
  childName: string;
  classSectionId: string;
  classSectionName: string;
  academicYearId: string;
  /** Active enrollments in the child's class (incl. the child) → realistic attendance. */
  classStudentIds: string[];
};

/**
 * Resolve the parent → child → active enrollment → class, mirroring
 * seed-demo-surfaces.ts and the parentUpcoming handler (active enrollment, latest).
 */
async function resolveAnchors(tenantId: string): Promise<Anchors | null> {
  const parentUP = await prisma.userProfile.findFirst({
    where: { tenantId, email: 'parent.demo@voltaire.fr' },
  });
  if (!parentUP) {
    console.warn('! parent.demo@voltaire.fr not found — run prisma:seed:demo:parent first. Skipping fill.');
    return null;
  }

  const guardian = await prisma.guardian.findFirst({
    where: { tenantId, userProfileId: parentUP.id },
    include: { guardianships: { include: { student: true } } },
  });
  const child = guardian?.guardianships?.[0]?.student ?? null;
  if (!child) {
    console.warn('! no child linked to parent.demo — run prisma:seed:demo:parent first. Skipping fill.');
    return null;
  }

  // Same resolution the parent dashboard uses: active enrollment, most recent.
  const enrollment = await prisma.enrollment.findFirst({
    where: { tenantId, studentId: child.id, status: 'active' },
    orderBy: { enrolledAt: 'desc' },
    include: { classSection: { select: { id: true, name: true } } },
  });
  if (!enrollment) {
    console.warn(`! ${child.firstName} ${child.lastName} has no active enrollment — skipping fill.`);
    return null;
  }

  const classStudents = await prisma.enrollment.findMany({
    where: {
      tenantId,
      classSectionId: enrollment.classSectionId,
      academicYearId: enrollment.academicYearId,
      status: 'active',
    },
    select: { studentId: true },
  });
  const classStudentIds = Array.from(new Set([child.id, ...classStudents.map((e) => e.studentId)]));

  return {
    tenantId,
    schoolId: child.schoolId,
    childId: child.id,
    childName: `${child.firstName} ${child.lastName}`,
    classSectionId: enrollment.classSectionId,
    classSectionName: enrollment.classSection.name,
    academicYearId: enrollment.academicYearId,
    classStudentIds,
  };
}

/**
 * Find a TeachingAssignment rooting sessions on the child's class. Prefers one
 * owned by the demo teacher (so its teacher also "owns" them), else any
 * assignment of that class. Returns the assignment + its teacherProfile.
 */
async function resolveSessionAssignment(a: Anchors) {
  const demoTeacherUP = await prisma.userProfile.findFirst({
    where: { tenantId: a.tenantId, email: 'teacher.demo@voltaire.fr' },
  });
  const demoTeacherProfile = demoTeacherUP
    ? await prisma.teacherProfile.findUnique({ where: { userProfileId: demoTeacherUP.id } })
    : null;

  if (demoTeacherProfile) {
    const owned = await prisma.teachingAssignment.findFirst({
      where: {
        tenantId: a.tenantId,
        classSectionId: a.classSectionId,
        academicYearId: a.academicYearId,
        teacherProfileId: demoTeacherProfile.id,
      },
      include: { teacherProfile: true, subject: { select: { name: true } } },
    });
    if (owned) return owned;
  }

  const any = await prisma.teachingAssignment.findFirst({
    where: {
      tenantId: a.tenantId,
      classSectionId: a.classSectionId,
      academicYearId: a.academicYearId,
    },
    include: { teacherProfile: true, subject: { select: { name: true } } },
  });
  return any;
}

/**
 * SURFACE 1 — Attendance. Create ~6 past sessions on the child's class and record
 * attendance for every active classmate (incl. the child) with a deterministic
 * status. Dates are recent-past relative to `now` (the parent card has NO date
 * window, so this is purely for chronological realism).
 */
async function fillAttendance(a: Anchors): Promise<string> {
  const assignment = await resolveSessionAssignment(a);
  if (!assignment) {
    return `attendance: skipped — no teaching assignment for class ${a.classSectionName}.`;
  }
  const teacherProfile = assignment.teacherProfile;
  const recordedBy = teacherProfile.userProfileId; // AttendanceRecord.recordedBy = UserProfile.id

  // 6 weekly-ish sessions in the recent past (every 3 days back from yesterday).
  const now = new Date();
  const SESSION_COUNT = 6;
  const sessionIds: string[] = [];
  for (let i = 1; i <= SESSION_COUNT; i++) {
    const d = dateOnly(new Date(now.getTime() - i * 3 * DAY_MS));

    const topic = `Séance de ${assignment.subject?.name ?? 'cours'}`;
    let session = await prisma.classSession.findFirst({
      where: { tenantId: a.tenantId, teachingAssignmentId: assignment.id, date: d },
    });
    if (!session) {
      session = await prisma.classSession.create({
        data: {
          tenantId: a.tenantId,
          teachingAssignmentId: assignment.id,
          teacherProfileId: teacherProfile.id,
          date: d,
          startTime: '09:00',
          endTime: '10:00',
          topic,
          cancelled: false,
        },
      });
    } else if (session.topic !== topic) {
      // Heal any earlier debug-marker topic to the clean one.
      await prisma.classSession.update({ where: { id: session.id }, data: { topic } });
    }
    sessionIds.push(session.id);
  }

  // Attendance per (session × classmate). Upsert on the unique key → idempotent.
  let records = 0;
  for (const sessionId of sessionIds) {
    for (const studentId of a.classStudentIds) {
      const status = statusFor(`${sessionId}:${studentId}`);
      await prisma.attendanceRecord.upsert({
        where: { classSessionId_studentId: { classSessionId: sessionId, studentId } },
        create: {
          tenantId: a.tenantId,
          classSessionId: sessionId,
          studentId,
          status,
          recordedBy,
        },
        update: { status, recordedBy },
      });
      records++;
    }
  }

  // Compute the rate the parent card will show for the child (sanity in the log).
  const childRows = await prisma.attendanceRecord.findMany({
    where: { tenantId: a.tenantId, studentId: a.childId },
    select: { status: true },
    take: 200,
  });
  const present = childRows.filter((r) => r.status === 'present').length;
  const rate = childRows.length === 0 ? null : Math.round((present / childRows.length) * 1000) / 10;

  return (
    `attendance: ${sessionIds.length} sessions × ${a.classStudentIds.length} students = ${records} records ` +
    `(class ${a.classSectionName}); ${a.childName} rate ≈ ${rate ?? 'null'}% over ${childRows.length} recorded.`
  );
}

/**
 * Ensure a TeachingAssignment exists with teacherProfile=demoTeacher AND
 * classSection=childClass, so a single Assessment satisfies BOTH the teacher and
 * parent upcoming filters. Find-or-create on the @@unique([teacherProfileId,
 * classSectionId, subjectId]) edge, reusing a subject the demo teacher already
 * teaches when possible.
 */
async function resolveDualAssignment(a: Anchors) {
  const demoTeacherUP = await prisma.userProfile.findFirst({
    where: { tenantId: a.tenantId, email: 'teacher.demo@voltaire.fr' },
  });
  if (!demoTeacherUP) {
    console.warn('! teacher.demo@voltaire.fr not found — run prisma:seed:demo:teacher first.');
    return null;
  }
  const teacherProfile = await prisma.teacherProfile.findUnique({
    where: { userProfileId: demoTeacherUP.id },
  });
  if (!teacherProfile) {
    console.warn('! no TeacherProfile for teacher.demo — skipping upcoming assessments.');
    return null;
  }

  // Already teaching the child's class? Reuse it.
  const existing = await prisma.teachingAssignment.findFirst({
    where: {
      tenantId: a.tenantId,
      teacherProfileId: teacherProfile.id,
      classSectionId: a.classSectionId,
      academicYearId: a.academicYearId,
    },
    include: { subject: { select: { name: true } } },
  });
  if (existing) return { assignment: existing, teacherProfile };

  // Pick a subject: prefer one the demo teacher already teaches (avoids a unique
  // clash with another teacher's same-subject assignment in this class), else any.
  const ownAssignment = await prisma.teachingAssignment.findFirst({
    where: { tenantId: a.tenantId, teacherProfileId: teacherProfile.id },
    select: { subjectId: true },
    orderBy: { createdAt: 'asc' },
  });
  let subjectId = ownAssignment?.subjectId ?? null;

  if (!subjectId) {
    // Avoid subjects already used by OTHER teachers in this class (unique edge).
    const usedInClass = await prisma.teachingAssignment.findMany({
      where: { tenantId: a.tenantId, classSectionId: a.classSectionId, academicYearId: a.academicYearId },
      select: { subjectId: true },
    });
    const used = new Set(usedInClass.map((x) => x.subjectId));
    const candidate = await prisma.subject.findFirst({
      where: { tenantId: a.tenantId, schoolId: a.schoolId, id: { notIn: Array.from(used) } },
      orderBy: { createdAt: 'asc' },
    });
    subjectId = candidate?.id ?? null;
  }
  if (!subjectId) {
    console.warn('! no subject available to create a demo-teacher assignment — skipping upcoming assessments.');
    return null;
  }

  // Create the (demoTeacher × childClass × subject) edge.
  const created = await prisma.teachingAssignment.create({
    data: {
      tenantId: a.tenantId,
      teacherProfileId: teacherProfile.id,
      classSectionId: a.classSectionId,
      academicYearId: a.academicYearId,
      subjectId,
      role: 'subject_teacher',
    },
    include: { subject: { select: { name: true } } },
  });
  return { assignment: created, teacherProfile };
}

/**
 * SURFACE 2 — Upcoming assessments. Create 3 future assessments on the dual
 * assignment so they appear on BOTH the teacher (≤30d) and parent (≤60d) cards.
 * scheduledAt is future relative to real `now` (decoupled from the demo's past
 * active-year dates). termId is attached only if a sensible term exists.
 */
async function fillUpcomingAssessments(a: Anchors): Promise<string> {
  const resolved = await resolveDualAssignment(a);
  if (!resolved) {
    return 'upcoming assessments: skipped — could not resolve demo-teacher × child-class assignment.';
  }
  const { assignment, teacherProfile } = resolved;

  // Optional term label — most recent term of the child's enrollment year (handler
  // ignores term bounds, so a past-dated term is harmless; null is also fine).
  const term = await prisma.term.findFirst({
    where: { tenantId: a.tenantId, academicYearId: a.academicYearId },
    orderBy: { orderIndex: 'desc' },
    select: { id: true },
  });

  const now = new Date();
  const subjectName = assignment.subject?.name ?? 'Évaluation';
  const specs = [
    { offset: 7, kind: 'written_test' as const, label: 'Devoir surveillé' }, // teacher(≤30) + parent(≤60)
    { offset: 14, kind: 'homework' as const, label: 'Évaluation continue' }, // teacher(≤30) + parent(≤60)
    { offset: 21, kind: 'project' as const, label: 'Projet' }, //               teacher(≤30) + parent(≤60)
  ];
  const titles = specs.map((s) => `${s.label} — ${subjectName}`); // clean, user-facing

  // Idempotency: remove this script's prior assessments on THIS assignment — both
  // the new clean titles AND any legacy `[SEED-FILL] …`-marked rows — then recreate.
  // Scoped to the (demo-teacher × child-class) assignment + unpublished, so it can
  // never touch a real graded assessment.
  const del = await prisma.assessment.deleteMany({
    where: {
      tenantId: a.tenantId,
      teachingAssignmentId: assignment.id,
      isPublished: false,
      OR: [{ title: { in: titles } }, { title: { contains: LEGACY_ASSESSMENT_MARKER } }],
    },
  });

  let created = 0;
  for (let i = 0; i < specs.length; i++) {
    const s = specs[i]!;
    await prisma.assessment.create({
      data: {
        tenantId: a.tenantId,
        teachingAssignmentId: assignment.id,
        teacherProfileId: teacherProfile.id,
        termId: term?.id ?? null,
        title: titles[i]!,
        description: 'Évaluation de démonstration (à venir).',
        kind: s.kind,
        maxScore: 20,
        scheduledAt: new Date(now.getTime() + s.offset * DAY_MS),
        isPublished: false,
      },
    });
    created++;
  }

  return (
    `upcoming assessments: ${created} created (removed ${del.count} stale) on ` +
    `${assignment.subject?.name ?? 'subject'} / class ${a.classSectionName} / teacher.demo → ` +
    `visible on teacher (≤30d) + parent (≤60d) cards.`
  );
}

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: 'voltaire-demo' } });
  if (!tenant) {
    console.warn('! voltaire-demo tenant not found — run prisma:seed:demo first. Skipping fill.');
    return;
  }

  const anchors = await resolveAnchors(tenant.id);
  if (!anchors) return; // resolveAnchors already logged the reason.

  console.info(
    `▸ Demo fill anchored on ${anchors.childName} · class ${anchors.classSectionName} ` +
      `(${anchors.classStudentIds.length} active classmates).`,
  );

  // Each surface is independently defensive — one failing to resolve does not
  // block the other.
  const attendanceMsg = await fillAttendance(anchors).catch((e) => {
    console.error('  ✗ attendance fill error:', e);
    return 'attendance: errored (see above).';
  });
  const assessmentsMsg = await fillUpcomingAssessments(anchors).catch((e) => {
    console.error('  ✗ upcoming assessments fill error:', e);
    return 'upcoming assessments: errored (see above).';
  });

  console.info('══════════════════════════════════════════════');
  console.info('  ✓ Demo fill complete (voltaire-demo):');
  console.info(`     • ${attendanceMsg}`);
  console.info(`     • ${assessmentsMsg}`);
  console.info('══════════════════════════════════════════════');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
