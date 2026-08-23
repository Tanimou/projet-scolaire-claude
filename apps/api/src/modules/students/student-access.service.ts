import { Injectable } from '@nestjs/common';

import { type KeycloakJwtPayload } from '../../shared/auth/jwt.strategy';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { TeacherProfileService } from '../teaching/teacher-profile.service';
import { teacherSectionsWhere } from '../teaching/teaching-wall.where';

/**
 * ABAC for the Student aggregate.
 *
 * Resolution (S-E05-16 / `ADR-066 §D2` — a UNION, no longer a first-match chain):
 *   - super_admin / school_admin in realm_access → unrestricted within tenant
 *     (`studentIds: null`). **These are now the ONLY two roles that may return
 *     the `null` sentinel.**
 *   - teacher → EXACTLY the students holding an `active` Enrollment in a
 *     ClassSection the caller holds a TeachingAssignment for. Deny-by-default:
 *     no TeacherProfile → `[]`; a profile with zero assignments → `[]`. NEVER
 *     `null`. (Before S-E05-16 this branch returned the UNRESTRICTED sentinel
 *     behind a `TODO Phase 4` — the TeachingAssignment rows it waited for
 *     shipped long ago, and the TODO *was* the hard-coded bypass, `PF-288`.)
 *   - parent → ONLY the students they hold an `active` Guardianship for.
 *   - student (E8-S1) → ONLY the SINGLE Student linked to their own account
 *     (`Student.userProfileId === me.id`), tenant-scoped. The scope is EXACTLY
 *     `[ownStudentId]` (linked) or `[]` (unlinked) — NEVER `null`, NEVER a peer
 *     id. This is the strictest wall the platform has (the data subject reads
 *     it). See ADR-021.
 *
 * WHY A UNION AND NOT AN ORDERED CHAIN (`PF-297`, closed here). The chain used
 * to short-circuit `admin → teacher → parent → student` and its docblock called
 * that "highest privilege wins". That was sound only while the teacher branch
 * was UNRESTRICTED: a teacher whose own child attends the school — the most
 * common dual role in a school — fell into the teacher branch, and their child
 * was included *by accident*. The moment the teacher branch became a bounded
 * set, `teacher` and `parent` stopped being comparable, and that principal
 * would have LOST their own child's guardianship scope: 403 across the parent
 * dashboard, alerts, remediation, messaging and parent-exports, delivered by a
 * fix labelled "teacher". The same ordering already shadowed the student-self
 * branch for a `teacher`+`student` or `parent`+`student` principal.
 * WHERE THE UNION NARROWS, AND THE ONE PAIR WHERE IT WIDENS (`PF-306`,
 * corrected at the land pass — an earlier draft of this docblock claimed the
 * union NEVER widens, and that absolute is FALSE). For every pair involving
 * `teacher`, the union NARROWS: the old chain returned `null` (the whole
 * tenant) and the union returns a bounded set. But `parent`+`student` is a
 * genuine WIDENING — pre-diff the parent branch short-circuited and the
 * student-self branch was never reached, so such a principal saw ONLY their
 * guarded children; they now also see their own linked `Student` row. That is
 * the intended reading of both roles (the data subject may read themselves,
 * `ADR-021`), it is the one combination the new spec does NOT cover, and it is
 * stated here rather than hidden behind an absolute that does not hold.
 *
 * The branches are resolved LAZILY, per role held. A caller holding only
 * `parent` issues EXACTLY the one `guardianship.findMany` it issued before this
 * slice — the calendar's latency-sensitive parent read
 * (`calendar.controller.ts:273`, which calls this method OUTSIDE its tenant
 * scope on purpose, `PF-199`) pays nothing new.
 *
 * `_schoolId` (3rd parameter) is ACCEPTED AND NEVER READ, and that is a
 * RECORDED carry-forward, not an oversight — `PF-298` / `ADR-066 §D8`.
 * `model TeachingAssignment` has NO `schoolId` column (school is only reachable
 * as `classSection → gradeLevel → schoolId`), and `enrollments.controller.ts`
 * deliberately passes `''` here while `students.controller.ts` passes a
 * resolved id. Honouring it in one caller and not the others would make one
 * method return different scopes to different callers with no signature
 * difference to warn anyone. **The "school" dimension of this scope is not
 * enforced.**
 *
 * `PF-281` is INHERITED, priced, not fixed (`AC-9`): `findForUser` ignores
 * `TeacherProfile.active`, so a DEACTIVATED teacher keeps the full taught-student
 * scope this branch grants. Before this slice that defect reached one handler
 * (the enrollments list); after it, it reaches every `canAccessStudent` call
 * site — ~25. That is a real cost of shipping, stated in `ADR-066 §D6`.
 *
 * The service returns a "scope" object that controllers fold into their `where`
 * clauses. `studentIds: null` means "no restriction" (admins ONLY); a non-null
 * array narrows the result set, and the EMPTY array is the DENY — never an
 * absent key (`ADR-065 §D5`).
 */
@Injectable()
export class StudentAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly teachers: TeacherProfileService,
  ) {}

  async scopeForUser(
    user: { id: string; tenantId: string },
    jwt: KeycloakJwtPayload,
    _schoolId: string,
  ): Promise<{ studentIds: string[] | null; reason: string }> {
    const roles = jwt.realm_access?.roles ?? [];
    if (roles.includes('super_admin') || roles.includes('school_admin')) {
      return { studentIds: null, reason: 'admin' };
    }

    // UNION, resolved lazily per role actually held. `reason` stays
    // byte-identical to the pre-diff strings for a single-role caller
    // (`parent`, `student-self`); a multi-role caller gets them joined, e.g.
    // `teacher+parent`.
    const ids = new Set<string>();
    const reasons: string[] = [];

    if (roles.includes('teacher')) {
      for (const id of await this.teacherStudentIds(user)) ids.add(id);
      reasons.push('teacher');
    }

    if (roles.includes('parent')) {
      const guardianships = await this.prisma.guardianship.findMany({
        where: {
          tenantId: user.tenantId,
          status: 'active',
          guardian: { userProfileId: user.id },
        },
        select: { studentId: true },
      });
      for (const g of guardianships) ids.add(g.studentId);
      reasons.push('parent');
    }

    // E8-S1 — student-self ABAC (deny-by-default, self-only, NEVER peer
    // comparison). Resolve the ONE Student linked to this account within the
    // caller's tenant. A client-supplied studentId can never widen this:
    // `canAccessStudent` only ever returns true for ids resolved here.
    if (roles.includes('student')) {
      const self = await this.prisma.student.findFirst({
        where: { tenantId: user.tenantId, userProfileId: user.id },
        select: { id: true },
      });
      if (self) ids.add(self.id);
      reasons.push('student-self');
    }

    if (reasons.length === 0) {
      return { studentIds: [], reason: 'no role with student access' };
    }
    return { studentIds: [...ids], reason: reasons.join('+') };
  }

  /**
   * S-E05-16 / `AC-1` / `AC-2` / `AC-3` — the teacher wall, deny-by-default.
   *
   * `findForUser` (`teaching/teacher-profile.service.ts:94`) and **never**
   * `ensureForUser`: the latter is an UPSERT, and putting it on a REFUSAL path
   * would provision a `TeacherProfile` row on every probe (`PF-265` /
   * `ADR-051 §D1`). `GET /api/v1/students` is a list route hit on every page
   * load; an upsert there is a sink.
   *
   * A `null` profile resolves to `[]`, never `null`. The widening this
   * forecloses is not hypothetical: `teacherSectionsWhere`'s `teacherProfileId`
   * is NON-OPTIONAL precisely because Prisma STRIPS `undefined` keys, so
   * `{ tenantId, teacherProfileId: tp?.id }` with a null profile would become
   * "every assignment in the tenant" — a silent HTTP-200 fail-open.
   *
   * THREE queries, every one carrying an EXPLICIT `tenantId` (`ADR-042 §D1`):
   * on `degraded_no_app_url` — i.e. every deployment today — the owner
   * connection escapes its own RLS policies and this clause is the only thing
   * working. A foreign-tenant `classSectionId` therefore falls on an EMPTY
   * INTERSECTION rather than on an authorisation.
   *
   * NO academic-year clause, and `new Set` rather than Prisma `distinct` — both
   * inherited from `ADR-063 §D1`, not re-litigated here: `ClassSection` is
   * itself pinned to a year so the section id already carries it, while
   * `TeachingAssignment.academicYearId` is a plain column that can DIVERGE from
   * its section's; and a teacher holds one assignment PER SUBJECT on the same
   * section (`@@unique([teacherProfileId, classSectionId, subjectId])`), so
   * duplicates are normal — deduped in JS because a jest double silently
   * ignores a Prisma `distinct` and would make the scope true for the wrong
   * reason.
   *
   * `status: 'active'` ONLY, deliberately and at a stated cost:
   * `EnrollmentStatus` also carries `pending`, `transferred_in`,
   * `transferred_out`, `graduated` and `dropped`, so a student who transfers
   * out mid-year leaves their teacher's scope immediately — the teacher loses
   * the alert history, the analytics and the remediation plan for a child they
   * taught all term. Kept anyway: a wall that widens with history is not a wall
   * (`ADR-066 §D1`).
   */
  private async teacherStudentIds(user: { id: string; tenantId: string }): Promise<string[]> {
    const tp = await this.teachers.findForUser(user);
    if (tp === null) return [];

    const assignments = await this.prisma.teachingAssignment.findMany({
      where: teacherSectionsWhere({ tenantId: user.tenantId, teacherProfileId: tp.id }),
      select: { classSectionId: true },
    });
    const classSectionIds = [...new Set(assignments.map((a) => a.classSectionId))];
    if (classSectionIds.length === 0) return [];

    const enrollments = await this.prisma.enrollment.findMany({
      where: {
        tenantId: user.tenantId,
        status: 'active',
        classSectionId: { in: classSectionIds },
      },
      select: { studentId: true },
    });
    return [...new Set(enrollments.map((e) => e.studentId))];
  }

  async canAccessStudent(
    user: { id: string; tenantId: string },
    jwt: KeycloakJwtPayload,
    studentId: string,
    schoolId: string,
  ): Promise<boolean> {
    const scope = await this.scopeForUser(user, jwt, schoolId);
    if (scope.studentIds === null) return true;
    return scope.studentIds.includes(studentId);
  }
}
