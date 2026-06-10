import { ForbiddenException, Injectable } from '@nestjs/common';
import type {
  StudentGradeRow,
  StudentGradesResponse,
  StudentMeResponse,
} from '@pilotage/contracts';

import { type KeycloakJwtPayload } from '../../shared/auth/jwt.strategy';
import { PrismaService } from '../../shared/prisma/prisma.service';
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
}
