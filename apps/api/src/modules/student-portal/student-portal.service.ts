import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type {
  StudentAnnouncementRow,
  StudentAnnouncementsResponse,
  StudentAttendanceRecord,
  StudentAttendanceResponse,
  StudentDashboardResponse,
  StudentDashboardSubject,
  StudentGradeRow,
  StudentGradesResponse,
  StudentMeResponse,
  StudentUpcomingResponse,
} from '@pilotage/contracts';

import { type KeycloakJwtPayload } from '../../shared/auth/jwt.strategy';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { RemediationService } from '../remediation/remediation.service';
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
  private readonly logger = new Logger(StudentPortalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly studentAccess: StudentAccessService,
    private readonly analytics: AnalyticsService,
    private readonly remediation: RemediationService,
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

  /**
   * `GET /student/announcements` — "Les annonces". The caller's OWN receipt rows
   * for published, non-expired, tenant-scoped announcements (newest + pinned-first),
   * mirroring the parent receipt projection (announcements.controller.ts) but
   * NARROWED: no recipient roster, no read-statistics, no author email — only the
   * announcement the learner is addressed with + their own `readAt`. An unlinked
   * or no-receipt caller yields `{ data: [] }` — never a peer's / other-class
   * announcement. Server-resolved id; `canAccessStudent(ownId)` defence-in-depth.
   */
  async announcements(
    me: { id: string; tenantId: string },
    jwt: KeycloakJwtPayload,
    schoolId: string,
  ): Promise<StudentAnnouncementsResponse> {
    const self = await this.resolveSelf(me);
    if (!self) return { data: [] };

    const allowed = await this.studentAccess.canAccessStudent(me, jwt, self.id, schoolId);
    if (!allowed) throw new ForbiddenException('Forbidden');

    // Receipt-scoped on the caller's OWN userProfileId + tenant-scoped on the
    // announcement; published + non-expired only. Mirrors the parent receipt read
    // (NEVER the admin/author branch that leaks roster/stats/email).
    const receipts = await this.prisma.announcementReceipt.findMany({
      where: {
        userProfileId: me.id,
        announcement: {
          tenantId: me.tenantId,
          publishedAt: { not: null },
          OR: [{ expiresAt: null }, { expiresAt: { gte: new Date() } }],
        },
      },
      select: {
        readAt: true,
        announcement: {
          select: {
            id: true,
            title: true,
            body: true,
            scope: true,
            priority: true,
            pinned: true,
            publishedAt: true,
            authorRoleHint: true,
            cycle: { select: { name: true } },
            gradeLevel: { select: { name: true } },
            classSection: { select: { name: true } },
          },
        },
      },
      orderBy: [
        { announcement: { pinned: 'desc' } },
        { announcement: { publishedAt: 'desc' } },
      ],
    });

    const data: StudentAnnouncementRow[] = receipts.map((r) => {
      const a = r.announcement;
      // A friendly audience label — a class/level/cycle NAME, never a peer's name.
      const audienceLabel =
        a.classSection?.name ?? a.gradeLevel?.name ?? a.cycle?.name ?? null;
      const roleHint =
        a.authorRoleHint === 'admin' || a.authorRoleHint === 'teacher'
          ? a.authorRoleHint
          : null;
      return {
        id: a.id,
        title: a.title,
        body: a.body,
        scope: a.scope,
        priority: a.priority as 'normal' | 'high' | 'urgent',
        pinned: a.pinned,
        publishedAt: a.publishedAt ? a.publishedAt.toISOString() : null,
        audienceLabel,
        authorRoleHint: roleHint,
        readAt: r.readAt ? r.readAt.toISOString() : null,
      };
    });

    return { data };
  }

  /**
   * `POST /student/announcements/:id/read` — the ONE mutation a student may make:
   * flip the caller's OWN receipt `readAt` (idempotent). `:id` is an ANNOUNCEMENT
   * id, NOT a studentId — the receipt is keyed on `(announcementId, me.id)`, so a
   * student can only ever touch their own receipt (no IDOR). 404 when no receipt
   * exists for the caller (never reveals an announcement's existence).
   */
  async markAnnouncementRead(
    me: { id: string; tenantId: string },
    jwt: KeycloakJwtPayload,
    schoolId: string,
    announcementId: string,
  ): Promise<{ ok: true; alreadyRead?: boolean }> {
    const self = await this.resolveSelf(me);
    if (!self) throw new NotFoundException();

    const allowed = await this.studentAccess.canAccessStudent(me, jwt, self.id, schoolId);
    if (!allowed) throw new ForbiddenException('Forbidden');

    const receipt = await this.prisma.announcementReceipt.findUnique({
      where: {
        announcementId_userProfileId: { announcementId, userProfileId: me.id },
      },
    });
    if (!receipt) throw new NotFoundException();
    if (receipt.readAt) return { ok: true, alreadyRead: true };

    await this.prisma.announcementReceipt.update({
      where: { id: receipt.id },
      data: { readAt: new Date() },
    });
    return { ok: true };
  }

  /**
   * `GET /student/dashboard` — "Mon objectif". ONE aggregate composing, behind the
   * wall and BEST-EFFORT (each block in its own try/catch → empty on a throw, so a
   * snapshot/remediation/upcoming outage degrades that block only and the endpoint
   * always returns 200): (a) the E6 per-subject trend (self-only, peer-free), (b)
   * the next-3 upcoming assessments (the S2 producer), (c) the E7 remediation line
   * reused VERBATIM (already peer-free) re-framed second-person in the UI. The
   * payload STRUCTURALLY LACKS every peer-relative field (the narrowed DTO). An
   * unlinked caller gets a kind empty dashboard (never a 500, never a peer).
   */
  async dashboard(
    me: { id: string; tenantId: string },
    jwt: KeycloakJwtPayload,
    schoolId: string,
  ): Promise<StudentDashboardResponse> {
    const self = await this.resolveSelf(me);
    if (!self) {
      return {
        firstName: '',
        classSectionName: null,
        subjects: [],
        upcoming: [],
        remediation: [],
      };
    }

    const allowed = await this.studentAccess.canAccessStudent(me, jwt, self.id, schoolId);
    if (!allowed) throw new ForbiddenException('Forbidden');

    // Identity header (best-effort): own current class label.
    let classSectionName: string | null = null;
    try {
      const enrollment = await this.prisma.enrollment.findFirst({
        where: { tenantId: me.tenantId, studentId: self.id, status: 'active' },
        orderBy: { enrolledAt: 'desc' },
        select: { classSection: { select: { name: true } } },
      });
      classSectionName = enrollment?.classSection?.name ?? null;
    } catch (err) {
      this.logger.debug(`dashboard header degraded to null: ${String(err)}`);
    }

    // Block A — per-subject trend (self-only, snapshot-first / live fall-through).
    let subjects: StudentDashboardSubject[] = [];
    try {
      subjects = await this.subjectTrends(me.tenantId, self.id);
    } catch (err) {
      this.logger.debug(`dashboard subjects block degraded to []: ${String(err)}`);
      subjects = [];
    }

    // Block B — next-3 upcoming assessments (the S2 producer, re-scoped to self).
    let upcoming: StudentDashboardResponse['upcoming'] = [];
    try {
      const res = await this.analytics.parentUpcoming({
        tenantId: me.tenantId,
        studentId: self.id,
      });
      upcoming = res.data.slice(0, 3).map((a) => ({
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
      }));
    } catch (err) {
      this.logger.debug(`dashboard upcoming block degraded to []: ${String(err)}`);
      upcoming = [];
    }

    // Block C — E7 remediation progress, reused VERBATIM (already peer-free). The
    // UI re-frames it second-person ("ton soutien en {matière}"). No plan → [].
    let remediation: StudentDashboardResponse['remediation'] = [];
    try {
      remediation = await this.remediation.remediationProgress({
        tenantId: me.tenantId,
        studentId: self.id,
      });
    } catch (err) {
      this.logger.debug(`dashboard remediation block degraded to []: ${String(err)}`);
      remediation = [];
    }

    return {
      firstName: self.firstName,
      classSectionName,
      subjects,
      upcoming,
      remediation,
    };
  }

  /**
   * Per-subject trend for the learner's OWN subjects — a self-only producer that
   * NEVER computes a peer figure and NEVER runs the O(class) parent class scan.
   * ONE `studentSubjectSnapshot.findMany` (year-level, termId=null) for every
   * subject + ONE `subject.findMany` for the names/colours (no per-subject N+1).
   * On an empty/missing snapshot set (E6 db push pending) it falls through to a
   * single grade-based subject average + a heuristic trend. The `trend` direction
   * is derived from the snapshot `trendDelta` (reusing the E6 number), framed for
   * the UI to render kindly (`down` → "à consolider", never "en échec").
   */
  private async subjectTrends(
    tenantId: string,
    studentId: string,
  ): Promise<StudentDashboardSubject[]> {
    const IMPROVEMENT = 1.5; // the shared E3/E7 IMPROVEMENT delta threshold.

    // Snapshot-first: one findMany over the year-level per-subject snapshot rows.
    const snaps = await this.prisma.studentSubjectSnapshot.findMany({
      where: { tenantId, studentId, termId: null },
      select: { subjectId: true, average: true, trendDelta: true },
    });

    if (snaps.length > 0) {
      const subjectIds = snaps.map((s) => s.subjectId);
      const subjects = await this.prisma.subject.findMany({
        where: { tenantId, id: { in: subjectIds } },
        select: { id: true, name: true, color: true },
      });
      const byId = new Map(subjects.map((s) => [s.id, s]));
      return snaps.map((s) => {
        const subj = byId.get(s.subjectId);
        const studentAverage = s.average != null ? Number(s.average) : null;
        const delta = s.trendDelta != null ? Number(s.trendDelta) : null;
        return {
          subjectId: s.subjectId,
          subjectName: subj?.name ?? '—',
          subjectColor: subj?.color ?? null,
          studentAverage,
          trend: this.trendFromDelta(delta, studentAverage, IMPROVEMENT),
        };
      });
    }

    // Live fall-through (snapshots not yet materialised): the learner's own
    // published, non-absent grades grouped by subject → a single subject average.
    // No class scan, no peer figure. Trend is `unknown` (live has no delta here).
    const grades = await this.prisma.grade.findMany({
      where: {
        tenantId,
        studentId,
        status: { in: ['published', 'revised'] },
        isAbsent: false,
        value: { not: null },
      },
      select: {
        value: true,
        assessment: {
          select: {
            maxScore: true,
            teachingAssignment: {
              select: { subject: { select: { id: true, name: true, color: true } } },
            },
          },
        },
      },
    });

    const acc = new Map<
      string,
      { name: string; color: string | null; sum: number; n: number }
    >();
    for (const g of grades) {
      const subj = g.assessment.teachingAssignment?.subject;
      if (!subj || g.value == null) continue;
      const max = Number(g.assessment.maxScore ?? 20) || 20;
      const onTwenty = (Number(g.value) / max) * 20;
      const entry = acc.get(subj.id) ?? { name: subj.name, color: subj.color, sum: 0, n: 0 };
      entry.sum += onTwenty;
      entry.n += 1;
      acc.set(subj.id, entry);
    }

    return Array.from(acc.entries()).map(([subjectId, e]) => ({
      subjectId,
      subjectName: e.name,
      subjectColor: e.color,
      studentAverage: e.n === 0 ? null : Math.round((e.sum / e.n) * 100) / 100,
      trend: 'unknown' as const,
    }));
  }

  /**
   * Map an E6 trend delta into the four kind UI directions. `down` is framed in
   * the UI as "à consolider — concentre-toi ici" (never "en échec"). A null delta
   * with no average reads `unknown` ("pas encore assez de notes").
   */
  private trendFromDelta(
    delta: number | null,
    average: number | null,
    threshold: number,
  ): 'up' | 'flat' | 'down' | 'unknown' {
    if (delta == null) return average == null ? 'unknown' : 'flat';
    if (delta >= threshold) return 'up';
    if (delta <= -threshold) return 'down';
    return 'flat';
  }
}
