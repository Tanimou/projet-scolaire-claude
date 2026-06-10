import { ForbiddenException, Injectable } from '@nestjs/common';
import type {
  StudentAttendanceRecord,
  StudentAttendanceResponse,
  StudentGradeRow,
  StudentGradesResponse,
  StudentMeResponse,
  StudentUpcomingResponse,
} from '@pilotage/contracts';

import { type KeycloakJwtPayload } from '../../shared/auth/jwt.strategy';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { StudentAccessService } from '../students/student-access.service';

/**
 * Student Portal read producer (E8-S1) — the fourth, read-only learner audience.
 *
 * Every read is server-resolved to the caller's OWN dossier via the student-self
 * ABAC wall (`StudentAccessService`, deny-by-default `[ownId]`/`[]`, never a peer,
 * never `null`). There is no `:studentId` path param anywhere on `/student/*` —
 * a client-supplied id is structurally impossible to inject. Tenant-scoped on
 * every query (server-derived from the JWT). Read-only: no student write verb
 * exists. The payloads structurally lack every peer-relative field (the narrowed
 * DTOs in `@pilotage/contracts`). See docs/adr/ADR-021-student-role-and-self-abac.md.
 */
@Injectable()
export class StudentPortalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly studentAccess: StudentAccessService,
    private readonly analytics: AnalyticsService,
  ) {}

  /**
   * Resolve the SINGLE Student linked to this account, tenant-scoped. Returns
   * `null` when unlinked (the kind activation gate, scenario 7) — never throws,
   * never another student's data. The lookup mirrors the ABAC branch exactly so
   * the wall and the reads can never diverge.
   */
  private async resolveSelf(me: {
    id: string;
    tenantId: string;
  }): Promise<{ id: string; firstName: string; lastName: string } | null> {
    return this.prisma.student.findFirst({
      where: { tenantId: me.tenantId, userProfileId: me.id },
      select: { id: true, firstName: true, lastName: true },
    });
  }

  /**
   * `GET /student/me` — the activation gate + header identity. `activated:false`
   * (and `student:null`) when the account has no linked Student. The class label
   * comes from the learner's own active enrollment (null when none).
   */
  async me(me: { id: string; tenantId: string }): Promise<StudentMeResponse> {
    const self = await this.resolveSelf(me);
    if (!self) return { student: null, activated: false };

    // Own current class section label, from the student's own active enrollment.
    // Newest first so a re-enrolled pupil shows the current class.
    const enrollment = await this.prisma.enrollment.findFirst({
      where: { tenantId: me.tenantId, studentId: self.id, status: 'active' },
      orderBy: { enrolledAt: 'desc' },
      select: { classSection: { select: { name: true } } },
    });

    return {
      student: {
        id: self.id,
        firstName: self.firstName,
        lastName: self.lastName,
        classSectionName: enrollment?.classSection?.name ?? null,
      },
      activated: true,
    };
  }

  /**
   * `GET /student/grades` — "Mes notes". The caller's own PUBLISHED grades
   * (`published`/`revised`, never draft) with the teacher comment, one aggregate
   * query (no N+1). Server-resolved studentId; `canAccessStudent(ownId)` runs
   * before the read as a defence-in-depth assertion of the wall. An unlinked
   * caller gets `{ data: [] }` — never a 500, never a peer's grades.
   */
  async grades(
    me: { id: string; tenantId: string },
    jwt: KeycloakJwtPayload,
    schoolId: string,
  ): Promise<StudentGradesResponse> {
    const self = await this.resolveSelf(me);
    if (!self) return { data: [] };

    // Defence-in-depth: the wall must affirm the caller can read their OWN id
    // before any grade leaves the producer. For a `student` token this is true
    // only for `self.id` (the ABAC branch returns exactly `[self.id]`).
    const allowed = await this.studentAccess.canAccessStudent(me, jwt, self.id, schoolId);
    if (!allowed) throw new ForbiddenException('Forbidden');

    const grades = await this.prisma.grade.findMany({
      where: {
        studentId: self.id,
        tenantId: me.tenantId,
        // Published-only for the learner: never a draft (the non-staff posture).
        status: { in: ['published', 'revised'] },
      },
      select: {
        id: true,
        value: true,
        isAbsent: true,
        comment: true,
        status: true,
        assessment: {
          select: {
            id: true,
            title: true,
            kind: true,
            maxScore: true,
            coefficientOverride: true,
            scheduledAt: true,
            term: { select: { id: true, name: true } },
            teachingAssignment: {
              select: {
                subject: {
                  select: { id: true, name: true, color: true, defaultCoefficient: true },
                },
              },
            },
          },
        },
      },
      orderBy: { assessment: { scheduledAt: 'desc' } },
    });

    const data: StudentGradeRow[] = grades.map((g) => {
      const a = g.assessment;
      const subject = a.teachingAssignment.subject;
      // Effective coefficient: assessment override → subject default (the most-
      // specific-wins rule, simplified — the grade-level SubjectCoefficient layer
      // is a parent/teacher analytics concern, not surfaced to the learner here).
      const coefficient =
        a.coefficientOverride !== null
          ? Number(a.coefficientOverride)
          : Number(subject.defaultCoefficient);
      return {
        id: g.id,
        subjectId: subject.id,
        subjectName: subject.name,
        subjectColor: subject.color,
        assessmentId: a.id,
        assessmentTitle: a.title,
        kind: a.kind,
        // Narrowed at the source by the `status: { in: ['published','revised'] }`
        // where-clause above, so this cast can never widen past what reaches the
        // learner (never a draft).
        status: g.status as 'published' | 'revised',
        value: g.value === null ? null : Number(g.value),
        maxScore: Number(a.maxScore),
        isAbsent: g.isAbsent,
        coefficient,
        comment: g.comment ?? null,
        termId: a.term?.id ?? null,
        termName: a.term?.name ?? null,
        scheduledAt: a.scheduledAt ? a.scheduledAt.toISOString() : null,
      };
    });

    return { data };
  }

  /**
   * `GET /student/upcoming` — "Mes prochaines évaluations". The caller's own
   * upcoming assessments (soonest-first), produced by `AnalyticsService.
   * parentUpcoming` re-scoped to the self-resolved studentId. Server-resolved id;
   * `canAccessStudent(ownId)` runs before the read as a defence-in-depth assertion
   * of the wall (true only for `self.id` on a `student` token). An unlinked caller
   * gets the kind empty payload — never a 500, never a peer's calendar.
   */
  async upcoming(
    me: { id: string; tenantId: string },
    jwt: KeycloakJwtPayload,
    schoolId: string,
  ): Promise<StudentUpcomingResponse> {
    const self = await this.resolveSelf(me);
    if (!self) return { classSectionName: null, gradeLevelName: null, data: [] };

    const allowed = await this.studentAccess.canAccessStudent(me, jwt, self.id, schoolId);
    if (!allowed) throw new ForbiddenException('Forbidden');

    // Reuse the parent producer verbatim, re-scoped to the learner's own id.
    const res = await this.analytics.parentUpcoming({
      tenantId: me.tenantId,
      studentId: self.id,
    });

    return {
      classSectionName: res.classSectionName,
      gradeLevelName: res.gradeLevelName,
      // Project into the narrowed, peer-free student DTO (the producer row carries
      // a `classSectionName` the learner doesn't need — drop it, keep only the
      // self-relevant scalars).
      data: res.data.map((a) => ({
        id: a.id,
        title: a.title,
        description: a.description,
        scheduledAt: a.scheduledAt,
        kind: a.kind,
        maxScore: a.maxScore,
        coefficient: a.coefficient,
        subjectId: a.subjectId,
        subjectCode: a.subjectCode,
        subjectName: a.subjectName,
        subjectColor: a.subjectColor,
        termId: a.termId,
        termName: a.termName,
      })),
    };
  }

  /**
   * `GET /student/attendance` — "Mon assiduité". The caller's own attendance
   * summary + recent records (bounded, newest-first), framed factually/kindly.
   * Server-resolved id; `canAccessStudent(ownId)` runs before the read. The
   * mapped rows expose ONLY status/justification/date/subject/class — never the
   * `recordedBy`/`justifiedBy` actor metadata the parent endpoint can carry (RGPD
   * minimisation). An unlinked caller gets a zero summary + empty records.
   */
  async attendance(
    me: { id: string; tenantId: string },
    jwt: KeycloakJwtPayload,
    schoolId: string,
  ): Promise<StudentAttendanceResponse> {
    const empty: StudentAttendanceResponse = {
      summary: { total: 0, present: 0, absent: 0, absentExcused: 0, late: 0, leftEarly: 0 },
      records: [],
    };

    const self = await this.resolveSelf(me);
    if (!self) return empty;

    const allowed = await this.studentAccess.canAccessStudent(me, jwt, self.id, schoolId);
    if (!allowed) throw new ForbiddenException('Forbidden');

    const records = await this.prisma.attendanceRecord.findMany({
      where: { studentId: self.id, tenantId: me.tenantId },
      select: {
        id: true,
        status: true,
        justification: true,
        classSession: {
          select: {
            date: true,
            teachingAssignment: {
              select: {
                subject: { select: { name: true, color: true } },
                classSection: { select: { name: true } },
              },
            },
          },
        },
      },
      orderBy: { classSession: { date: 'desc' } },
      take: 100,
    });

    const mapped: StudentAttendanceRecord[] = records.map((r) => {
      const ta = r.classSession.teachingAssignment;
      return {
        id: r.id,
        status: r.status,
        justification: r.justification ?? null,
        date: r.classSession.date.toISOString(),
        subjectName: ta?.subject?.name ?? null,
        subjectColor: ta?.subject?.color ?? null,
        classSectionName: ta?.classSection?.name ?? null,
      };
    });

    const summary = {
      total: mapped.length,
      present: mapped.filter((r) => r.status === 'present').length,
      absent: mapped.filter((r) => r.status === 'absent').length,
      absentExcused: mapped.filter((r) => r.status === 'absent_excused').length,
      late: mapped.filter((r) => r.status === 'late').length,
      leftEarly: mapped.filter((r) => r.status === 'left_early').length,
    };

    return { summary, records: mapped };
  }
}
