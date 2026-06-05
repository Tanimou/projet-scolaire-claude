import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Logger,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { snapshotCoalesceKey } from '@pilotage/contracts';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

import { CurrentJwt } from '../../shared/auth/current-user.decorator';
import { JwtAuthGuard } from '../../shared/auth/jwt-auth.guard';
import { type KeycloakJwtPayload } from '../../shared/auth/jwt.strategy';
import { PermissionsGuard } from '../../shared/auth/permissions.guard';
import { RequiresPermission } from '../../shared/auth/requires-permission.decorator';
import { UserSyncService } from '../../shared/auth/user-sync.service';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { TeacherProfileService } from '../teaching/teacher-profile.service';

import { GradesService } from './grades.service';

class GradeInput {
  @IsUUID() studentId!: string;
  @IsOptional() @IsNumber() @Min(0) @Max(100) value?: number;
  @IsOptional() @IsBoolean() isAbsent?: boolean;
  @IsOptional() @IsString() @MaxLength(500) comment?: string;
}

class BatchGradesDto {
  @IsUUID() assessmentId!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @ValidateNested({ each: true })
  @Type(() => GradeInput)
  grades!: GradeInput[];
}

class ReviseGradeDto {
  @IsOptional() @IsNumber() @Min(0) @Max(100) value?: number;
  @IsOptional() @IsBoolean() isAbsent?: boolean;
  @IsOptional() @IsString() @MaxLength(500) comment?: string;
  @IsString() @MinLength(3) @MaxLength(500) reason!: string;
}

class FlagGradeDto {
  @IsBoolean() flagged!: boolean;
  // Short, bounded teacher reason — NOT a messaging surface (spec §6). Capped at
  // 280 chars so it stays a factual addendum to the templated alert body.
  @IsOptional() @IsString() @MaxLength(280) note?: string;
}

@ApiTags('grades')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('grades')
export class GradesController {
  private readonly logger = new Logger(GradesController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UserSyncService,
    private readonly teachers: TeacherProfileService,
    private readonly gradesSvc: GradesService,
  ) {}

  /**
   * Gradebook for one (teacher × class × subject) — the working surface for
   * data entry. Returns the matrix students × assessments + class average.
   */
  @Get('gradebook/:teachingAssignmentId')
  @RequiresPermission('grades.read')
  async gradebook(
    @Param('teachingAssignmentId') id: string,
    @CurrentJwt() jwt: KeycloakJwtPayload,
    @Query('termId') termId?: string,
  ) {
    const me = await this.users.ensureUser(jwt);
    const ta = await this.prisma.teachingAssignment.findUnique({ where: { id } });
    if (!ta || ta.tenantId !== me.tenantId) throw new NotFoundException();
    await this.assertCanRead(ta.teacherProfileId, me, jwt);

    const data = await this.gradesSvc.gradebookForAssignment(id, me.tenantId, { termId });
    if (!data) throw new NotFoundException();
    return data;
  }

  /**
   * Batch save grades for an assessment. Upserts grades; preserves status
   * (drafts stay draft, published get a GradeRevision audit row if value changed).
   */
  @Post('batch')
  @RequiresPermission('grades.write')
  async batch(@Body() body: BatchGradesDto, @CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    const assessment = await this.prisma.assessment.findUnique({
      where: { id: body.assessmentId },
      include: {
        teachingAssignment: {
          include: {
            classSection: { include: { enrollments: { where: { status: 'active' } } } },
          },
        },
      },
    });
    if (!assessment || assessment.tenantId !== me.tenantId) throw new NotFoundException();
    await this.assertCanWrite(assessment.teacherProfileId, me, jwt);

    const enrolledIds = new Set(
      assessment.teachingAssignment.classSection.enrollments.map((e) => e.studentId),
    );
    const bad = body.grades.find((g) => !enrolledIds.has(g.studentId));
    if (bad) {
      throw new BadRequestException(
        `L'élève ${bad.studentId} n'est pas inscrit dans cette classe.`,
      );
    }
    for (const g of body.grades) {
      if (g.isAbsent && g.value !== undefined) {
        throw new BadRequestException(`Une note ne peut pas être présente ET marquée absent.`);
      }
      if (g.value !== undefined && Number(g.value) > Number(assessment.maxScore)) {
        throw new BadRequestException(
          `Note ${g.value} > maxScore ${assessment.maxScore} pour ${g.studentId}.`,
        );
      }
    }

    const now = new Date();
    let anyRevised = false;
    const result = await this.prisma.$transaction(async (tx) => {
      const results = [];
      for (const g of body.grades) {
        const existing = await tx.grade.findUnique({
          where: { assessmentId_studentId: { assessmentId: assessment.id, studentId: g.studentId } },
        });

        if (existing) {
          const wasPublished = existing.status === 'published' || existing.status === 'revised';
          const valueChanged = Number(existing.value) !== Number(g.value);
          if (wasPublished && valueChanged) {
            anyRevised = true;
            await tx.gradeRevision.create({
              data: {
                gradeId: existing.id,
                previousValue: existing.value,
                newValue: g.value === undefined ? null : (g.value as unknown as never),
                reason: 'Modification après publication (saisie batch)',
                revisedBy: me.id,
              },
            });
          }
          const r = await tx.grade.update({
            where: { id: existing.id },
            data: {
              value: g.isAbsent ? null : g.value,
              isAbsent: g.isAbsent ?? false,
              comment: g.comment,
              status: wasPublished && valueChanged ? 'revised' : existing.status,
            },
          });
          results.push(r);
        } else {
          const r = await tx.grade.create({
            data: {
              tenantId: me.tenantId,
              assessmentId: assessment.id,
              studentId: g.studentId,
              value: g.isAbsent ? null : g.value,
              isAbsent: g.isAbsent ?? false,
              comment: g.comment,
              status: assessment.isPublished ? 'published' : 'draft',
              publishedAt: assessment.isPublished ? now : null,
              enteredBy: me.id,
            },
          });
          results.push(r);
        }
      }
      return { ok: true, count: results.length };
    });

    // E6-S3 (FR5) — if the batch save flipped ≥1 published grade to `revised`,
    // enqueue ONE coalesced grade_revised recompute for the assessment's scope.
    // Best-effort, AFTER commit, never blocks the batch (mirrors the publish seam).
    if (anyRevised) {
      await this.enqueueGradeRevisedRecompute(me.tenantId, assessment.id);
    }

    return result;
  }

  /** Revise a single published grade with an audit-tracked reason. */
  @Post(':id/revise')
  @RequiresPermission('grades.revise')
  async revise(
    @Param('id') id: string,
    @Body() body: ReviseGradeDto,
    @CurrentJwt() jwt: KeycloakJwtPayload,
  ) {
    const me = await this.users.ensureUser(jwt);
    const grade = await this.prisma.grade.findUnique({
      where: { id },
      include: { assessment: true },
    });
    if (!grade || grade.tenantId !== me.tenantId) throw new NotFoundException();
    await this.assertCanWrite(grade.assessment.teacherProfileId, me, jwt);
    if (grade.status === 'draft') {
      throw new BadRequestException(
        'Cette note est encore en brouillon — modifiez-la sans passer par la révision.',
      );
    }
    if (body.isAbsent && body.value !== undefined) {
      throw new BadRequestException(`Une note ne peut pas être présente ET marquée absent.`);
    }
    if (body.value !== undefined && Number(body.value) > Number(grade.assessment.maxScore)) {
      throw new BadRequestException(
        `Note ${body.value} > maxScore ${grade.assessment.maxScore}.`,
      );
    }

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.gradeRevision.create({
        data: {
          gradeId: grade.id,
          previousValue: grade.value,
          newValue: body.value !== undefined && !body.isAbsent ? (body.value as never) : null,
          reason: body.reason.trim(),
          revisedBy: me.id,
        },
      });
      return tx.grade.update({
        where: { id: grade.id },
        data: {
          value: body.isAbsent ? null : body.value ?? grade.value,
          isAbsent: body.isAbsent ?? grade.isAbsent,
          comment: body.comment ?? grade.comment,
          status: 'revised',
        },
        include: { revisions: { orderBy: { revisedAt: 'desc' } } },
      });
    });

    // E6-S3 (FR5) — enqueue a grade_revised recompute AFTER the revise commits.
    // Best-effort sibling of the $transaction (never nested in / never rolls it back).
    await this.enqueueGradeRevisedRecompute(me.tenantId, grade.assessmentId);

    return result;
  }

  /**
   * Flag / unflag a published grade as « à signaler » (E3-S1). Feeds the
   * `TEACHER_COMMENT_FLAG` rule, which raises one explainable guardian alert per
   * flagged published grade on the next evaluation pass.
   *
   * Ownership ABAC reuses `assertCanWrite(assessment.teacherProfileId, …)` — the
   * grade's owner is the assignment teacher, NOT `Grade.enteredBy` (an admin may
   * have batch-entered it). Cross-tenant id → 404 (checked before ownership so a
   * 403 never confirms the id exists). Draft grades cannot be flagged (the
   * evaluator only reads published grades → a draft flag would be a silent
   * dead-end). Idempotent: a redundant flag/unflag is a 200 no-op that re-stamps
   * nothing and writes NO audit row; every real transition writes exactly one
   * append-only `grade.flag`/`grade.unflag` `AuditLog` row (best-effort,
   * non-rolling-back), tenant-scoped.
   */
  @Patch(':id/flag')
  @RequiresPermission('grades.write')
  async flag(
    @Param('id') id: string,
    @Body() body: FlagGradeDto,
    @CurrentJwt() jwt: KeycloakJwtPayload,
  ) {
    const me = await this.users.ensureUser(jwt);
    const grade = await this.prisma.grade.findUnique({
      where: { id },
      include: { assessment: true },
    });
    if (!grade || grade.tenantId !== me.tenantId) throw new NotFoundException();
    await this.assertCanWrite(grade.assessment.teacherProfileId, me, jwt);
    if (grade.status !== 'published' && grade.status !== 'revised') {
      throw new BadRequestException(
        'Seules les notes publiées peuvent être signalées.',
      );
    }

    // Idempotency: no-op when the flag already matches the requested state.
    const didTransition = grade.isFlagged !== body.flagged;
    if (!didTransition) {
      return {
        id: grade.id,
        isFlagged: grade.isFlagged,
        flaggedAt: grade.flaggedAt?.toISOString() ?? null,
        flagNote: grade.flagNote ?? null,
      };
    }

    const now = new Date();
    const note = body.flagged ? body.note?.trim() || null : null;
    const updated = await this.prisma.grade.update({
      where: { id: grade.id },
      data: {
        isFlagged: body.flagged,
        flaggedAt: body.flagged ? now : null,
        flaggedBy: body.flagged ? me.id : null,
        flagNote: note,
      },
    });

    // Append-only audit, one row per real transition. Best-effort: a write
    // failure is logged and swallowed (never rolls back the flag).
    const roles = jwt.realm_access?.roles ?? [];
    const actorRole =
      ['super_admin', 'school_admin', 'teacher', 'parent'].find((r) => roles.includes(r)) ??
      roles[0] ??
      null;
    try {
      await this.prisma.auditLog.create({
        data: {
          tenantId: me.tenantId,
          actorId: me.id,
          actorRole,
          portal: actorRole === 'teacher' ? 'teacher' : actorRole ? 'admin' : null,
          action: body.flagged ? 'grade.flag' : 'grade.unflag',
          resourceType: 'grade',
          resourceId: grade.id,
          before: { isFlagged: grade.isFlagged } as Prisma.InputJsonValue,
          after: { isFlagged: body.flagged } as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      this.logger.error(
        `Failed to write ${body.flagged ? 'grade.flag' : 'grade.unflag'} audit row for grade ${grade.id} (flag unaffected): ${(err as Error).message}`,
      );
    }

    return {
      id: updated.id,
      isFlagged: updated.isFlagged,
      flaggedAt: updated.flaggedAt?.toISOString() ?? null,
      flagNote: updated.flagNote ?? null,
    };
  }

  /** Per-student statistics — averages, per subject + overall. */
  @Get('students/:studentId/stats')
  @RequiresPermission('grades.read')
  async studentStats(
    @Param('studentId') studentId: string,
    @Query('termId') termId: string | undefined,
    @Query('academicYearId') academicYearId: string | undefined,
    @CurrentJwt() jwt: KeycloakJwtPayload,
  ) {
    const me = await this.users.ensureUser(jwt);
    const student = await this.prisma.student.findUnique({ where: { id: studentId } });
    if (!student || student.tenantId !== me.tenantId) throw new NotFoundException();
    await this.assertCanReadStudent(studentId, me, jwt);
    return this.gradesSvc.statsForStudent(studentId, me.tenantId, { termId, academicYearId });
  }

  /** Per-student detailed grades feed (published only for non-staff). */
  @Get('students/:studentId/grades')
  @RequiresPermission('grades.read')
  async studentGrades(
    @Param('studentId') studentId: string,
    @CurrentJwt() jwt: KeycloakJwtPayload,
    @Query('termId') termId?: string,
  ) {
    const me = await this.users.ensureUser(jwt);
    const student = await this.prisma.student.findUnique({ where: { id: studentId } });
    if (!student || student.tenantId !== me.tenantId) throw new NotFoundException();
    await this.assertCanReadStudent(studentId, me, jwt);

    const roles = jwt.realm_access?.roles ?? [];
    const seePrivate = roles.includes('super_admin') || roles.includes('school_admin') || roles.includes('teacher');

    const grades = await this.prisma.grade.findMany({
      where: {
        studentId,
        tenantId: me.tenantId,
        ...(termId ? { assessment: { termId } } : {}),
        ...(seePrivate ? {} : { status: { in: ['published', 'revised'] } }),
      },
      include: {
        assessment: {
          include: {
            teachingAssignment: {
              include: { subject: { select: { id: true, name: true, color: true } } },
            },
            term: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { assessment: { scheduledAt: 'desc' } },
    });
    return { data: grades };
  }

  private async assertCanWrite(
    teacherProfileId: string,
    me: { id: string; tenantId: string },
    jwt: KeycloakJwtPayload,
  ) {
    const roles = jwt.realm_access?.roles ?? [];
    if (roles.includes('super_admin') || roles.includes('school_admin')) return;
    const tp = await this.teachers.ensureForUser(me);
    if (teacherProfileId !== tp.id) {
      throw new ForbiddenException('Vous ne pouvez modifier que les notes de vos propres évaluations.');
    }
  }

  private async assertCanRead(
    teacherProfileId: string,
    me: { id: string; tenantId: string },
    jwt: KeycloakJwtPayload,
  ) {
    const roles = jwt.realm_access?.roles ?? [];
    if (roles.includes('super_admin') || roles.includes('school_admin')) return;
    if (roles.includes('teacher')) {
      const tp = await this.teachers.ensureForUser(me);
      if (teacherProfileId !== tp.id)
        throw new ForbiddenException('Accès limité à vos affectations.');
      return;
    }
    throw new ForbiddenException('Accès refusé.');
  }

  private async assertCanReadStudent(
    studentId: string,
    me: { id: string; tenantId: string },
    jwt: KeycloakJwtPayload,
  ) {
    const roles = jwt.realm_access?.roles ?? [];
    if (roles.includes('super_admin') || roles.includes('school_admin')) return;
    if (roles.includes('teacher')) {
      // teachers can read any student in their school (Phase 4 simplification)
      return;
    }
    if (roles.includes('parent')) {
      const gship = await this.prisma.guardianship.findFirst({
        where: {
          tenantId: me.tenantId,
          studentId,
          status: 'active',
          guardian: { userProfileId: me.id },
        },
      });
      if (!gship) throw new ForbiddenException("Vous n'avez pas accès à cet élève.");
      return;
    }
    throw new ForbiddenException();
  }

  /**
   * E6-S3 (FR5) — best-effort, NON-BLOCKING `grade_revised` snapshot-recompute
   * enqueue. Called AFTER a grade flips to `status='revised'` on BOTH revise seams
   * (single `POST :id/revise` and the batch `wasPublished && valueChanged` path),
   * always OUTSIDE the revise `$transaction` so an enqueue failure can never roll
   * back the revise. Idempotent upsert on (tenantId, coalesceKey, status='pending'):
   * a burst of revisions for the same (class, subject, term) collapses into ONE
   * pending row. Class-wide scope (no studentId) so the cascaded class averages /
   * ranks / global rows refresh for every pupil — mirrors the publish enqueue in
   * assessments.controller.ts. A missed enqueue degrades only cache freshness (the
   * safety-net sweep + live fallback cover it), NEVER the revise.
   */
  private async enqueueGradeRevisedRecompute(
    tenantId: string,
    assessmentId: string,
  ): Promise<void> {
    try {
      const assessment = await this.prisma.assessment.findFirst({
        where: { id: assessmentId, tenantId },
        select: {
          termId: true,
          teachingAssignment: {
            select: { classSectionId: true, subjectId: true, academicYearId: true },
          },
        },
      });
      const ta = assessment?.teachingAssignment;
      if (!ta?.classSectionId || !ta.subjectId) return;
      const scope = {
        classSectionId: ta.classSectionId,
        subjectId: ta.subjectId,
        termId: assessment?.termId ?? null,
        academicYearId: ta.academicYearId ?? null,
      };
      const coalesceKey = snapshotCoalesceKey(tenantId, 'grade_revised', scope);
      await this.prisma.snapshotRecomputeTrigger.upsert({
        where: {
          tenantId_coalesceKey_status: { tenantId, coalesceKey, status: 'pending' },
        },
        create: {
          tenantId,
          reason: 'grade_revised',
          status: 'pending',
          classSectionId: scope.classSectionId,
          subjectId: scope.subjectId,
          termId: scope.termId,
          academicYearId: scope.academicYearId,
          coalesceKey,
        },
        // Re-revise while a recompute is still pending: refresh enqueuedAt so the
        // FIFO drain re-orders, but stay ONE coalesced row.
        update: { enqueuedAt: new Date() },
      });
    } catch (err) {
      this.logger.warn(
        `[grades] grade_revised snapshot recompute enqueue failed for assessment ${assessmentId}: ${(err as Error).message}`,
      );
    }
  }
}
