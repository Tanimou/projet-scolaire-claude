import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { type AuditActionCode } from '@pilotage/contracts';
import { AcademicYearStatus, Prisma } from '@prisma/client';
import { IsDateString, IsEnum, IsInt, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

import { deriveAuditProvenance, type AuditActorProvenance } from '../../shared/audit/provenance';
import { writeAudit, type AuditTransactionClient } from '../../shared/audit/write-audit';
import { CurrentJwt } from '../../shared/auth/current-user.decorator';
import { JwtAuthGuard } from '../../shared/auth/jwt-auth.guard';
import { type KeycloakJwtPayload } from '../../shared/auth/jwt.strategy';
import { PermissionsGuard } from '../../shared/auth/permissions.guard';
import { RequiresPermission } from '../../shared/auth/requires-permission.decorator';
import { UserSyncService } from '../../shared/auth/user-sync.service';
import { PrismaService } from '../../shared/prisma/prisma.service';

import { SchoolContextService } from './school-context.service';

/**
 * S-E03-12 — does this error mean « someone else already has an active year
 * for this school »? Exported, and therefore testable, on purpose: the whole
 * value of this predicate is that it FIRES, and a private method whose shape
 * nobody can witness is how a mapping silently becomes vacuous.
 *
 * THE SHAPE IS MEASURED, NOT GUESSED (run 101, against a real PostgreSQL):
 * Prisma reports a violation of the partial unique index
 * `academic_year_one_active_per_school` as `P2002` with
 * `meta.target = ['school_id']` — the COLUMN LIST, never the index name. A
 * branch keyed on the index name compiles, reads plausibly, and never fires.
 *
 * The other unique index on this table, `academic_year_school_id_name_key`
 * over `(school_id, name)`, reports a TWO-element target, so requiring
 * EXACTLY ONE element discriminates the two without stealing that one's 409.
 */
export function isOneActiveYearViolation(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (err.code !== 'P2002') return false;
  const target = (err.meta as { target?: unknown } | undefined)?.target;
  return Array.isArray(target) && target.length === 1 && target[0] === 'school_id';
}

class CreateAcademicYearDto {
  @IsString() @MinLength(4) @MaxLength(40) name!: string;
  @IsDateString() startDate!: string;
  @IsDateString() endDate!: string;
  @IsOptional() @IsEnum(AcademicYearStatus) status?: AcademicYearStatus;
}

class UpdateAcademicYearDto {
  @IsOptional() @IsString() @MaxLength(40) name?: string;
  @IsOptional() @IsDateString() startDate?: string;
  @IsOptional() @IsDateString() endDate?: string;
  @IsOptional() @IsEnum(AcademicYearStatus) status?: AcademicYearStatus;
}

class TermDto {
  @IsString() @MinLength(1) @MaxLength(40) name!: string;
  @IsInt() orderIndex!: number;
  @IsDateString() startDate!: string;
  @IsDateString() endDate!: string;
}

/**
 * S-E05-13 / PF-51 / ADR-064 — the PATCH body of a term, as a CLASS.
 *
 * Same mechanism as `UpdateGradeLevelDto` in `cycles.controller.ts`:
 * `Partial<TermDto>` is a TYPE, so `emitDecoratorMetadata` wrote `Object` into
 * `design:paramtypes`, `ValidationPipe.toValidate()` refused to validate it,
 * and the global pipe at `main.ts:141-145` was bypassed rather than applied.
 *
 * WHAT THIS SITE IS, AND WHAT IT IS NOT — the two `Partial<>` bodies had very
 * different blast radii and conflating them would misreport both.
 * `updateTerm` already FIELD-PICKS below (`name`/`orderIndex`/`startDate`/
 * `endDate`, each `?? undefined`) instead of spreading the body, so there was
 * never a mass-assignment hole here and no tenancy escape: `Term.tenantId` was
 * never reachable from the wire. What WAS real is that no type or length check
 * ran at all, and `new Date('pas-une-date')` yields `Invalid Date`, which
 * Prisma rejects as a 500 where the caller deserved a 400. `@IsDateString()`
 * moves that refusal into the pipe.
 *
 * `orderIndex` deliberately carries `@IsInt()` and NO `@Min()`: `TermDto` above
 * has none, and a PATCH stricter than its own POST is a new inconsistency
 * introduced under cover of a hardening slice.
 *
 * NOT fixed here, recorded instead:
 *   • `PF-284` — `assertDateOrder` below runs only when BOTH dates are present,
 *     so a ONE-SIDED PATCH can still invert a term's stored date order. This
 *     DTO does not close it and cannot: `@IsDateString()` validates each field
 *     in isolation and cannot see the stored counterpart. It needs a
 *     handler-side read-then-compare against the row already loaded.
 *   • `PF-285` — `updateTerm`/`deleteTerm` write no audit row while their
 *     `academicYear` siblings in this same file relay through `writeAudit`.
 */
class UpdateTermDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(40) name?: string;
  @IsOptional() @IsInt() orderIndex?: number;
  @IsOptional() @IsDateString() startDate?: string;
  @IsOptional() @IsDateString() endDate?: string;
}

@ApiTags('school-structure')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('academic-years')
export class AcademicYearsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UserSyncService,
    private readonly ctx: SchoolContextService,
  ) {}

  @Get()
  @RequiresPermission('academic_years.read')
  @ApiOkResponse({ description: 'Académic years for the current school, newest first' })
  async list(@CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    const { schoolId } = await this.ctx.forTenant(me.tenantId);
    const years = await this.prisma.academicYear.findMany({
      where: { schoolId },
      orderBy: { startDate: 'desc' },
      include: { _count: { select: { terms: true, classSections: true } }, terms: { orderBy: { orderIndex: 'asc' } } },
    });
    return { data: years };
  }

  /**
   * S-E03-12 — migration `20260829120000_academic_year_one_active_per_school`
   * makes « au plus UNE année `active` par école » a DATABASE fact
   * (`PF-328` multiplicity half, `PF-04` residual (ii)).
   *
   * Both write paths in this controller already close the other active years
   * inside the same transaction, so the index cannot fire on a well-formed
   * sequential request. It fires on a RACE: two concurrent writers each read
   * « no other active year », each close nothing, and each insert one.
   *
   * Before the index that race produced two active years SILENTLY — and a
   * second active year is the measured detonator for `PF-329`: it moves the
   * parent-vs-admin academic-year divergence from 0 children to 2463 of 2463
   * in a single step. After the index the loser of the race gets a unique
   * violation, which surfaces as a 500 unless it is named here. It is not a
   * server fault, so it is mapped to the 409 it actually is.
   *
   * THE PREDICATE IS MEASURED, NOT GUESSED. Prisma reports this violation as
   * `code P2002` with `meta.target = ['school_id']` — the COLUMN LIST, never
   * the index name. Keying this branch on the index name would have compiled,
   * read plausibly, and never once fired. The other unique index on this table
   * is `academic_year_school_id_name_key` over `(school_id, name)`, which
   * reports a TWO-element target, so requiring exactly one element
   * discriminates the two without over-matching.
   */
  private async guardOneActiveYear<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (err) {
      if (isOneActiveYearViolation(err)) {
        throw new ConflictException(
          'Une autre année scolaire de cette école vient de devenir « active ». Rechargez la page puis réessayez.',
        );
      }
      throw err;
    }
  }

  @Post()
  @RequiresPermission('academic_years.write')
  async create(@Body() body: CreateAcademicYearDto, @CurrentJwt() jwt: KeycloakJwtPayload) {
    this.assertDateOrder(body.startDate, body.endDate);
    const me = await this.users.ensureUser(jwt);
    const { schoolId } = await this.ctx.forTenant(me.tenantId);

    const existing = await this.prisma.academicYear.findUnique({
      where: { schoolId_name: { schoolId, name: body.name } },
    });
    if (existing) throw new ConflictException(`Une année scolaire « ${body.name} » existe déjà.`);

    // Only one 'active' year at a time — flip others to closed automatically
    const status = body.status ?? AcademicYearStatus.active;
    return this.guardOneActiveYear(() => this.prisma.$transaction(async (tx) => {
      if (status === AcademicYearStatus.active) {
        await tx.academicYear.updateMany({
          where: { schoolId, status: AcademicYearStatus.active },
          data: { status: AcademicYearStatus.closed },
        });
      }
      const created = await tx.academicYear.create({
        data: {
          tenantId: me.tenantId,
          schoolId,
          name: body.name,
          startDate: new Date(body.startDate),
          endDate: new Date(body.endDate),
          status,
        },
      });
      await this.audit(
        tx,
        me,
        deriveAuditProvenance(jwt),
        'academic_year.create',
        created.id,
        null,
        { name: body.name, status },
      );
      return created;
    }));
  }

  @Patch(':id')
  @RequiresPermission('academic_years.write')
  async update(
    @Param('id') id: string,
    @Body() body: UpdateAcademicYearDto,
    @CurrentJwt() jwt: KeycloakJwtPayload,
  ) {
    const me = await this.users.ensureUser(jwt);
    const year = await this.prisma.academicYear.findUnique({ where: { id } });
    if (!year) throw new NotFoundException('Année scolaire introuvable');
    if (year.tenantId !== me.tenantId) throw new ForbiddenException();
    if (body.startDate && body.endDate) this.assertDateOrder(body.startDate, body.endDate);

    return this.guardOneActiveYear(() => this.prisma.$transaction(async (tx) => {
      if (body.status === AcademicYearStatus.active) {
        // Close any other active year first
        await tx.academicYear.updateMany({
          where: { schoolId: year.schoolId, status: AcademicYearStatus.active, NOT: { id } },
          data: { status: AcademicYearStatus.closed },
        });
      }
      const updated = await tx.academicYear.update({
        where: { id },
        data: {
          name: body.name ?? undefined,
          startDate: body.startDate ? new Date(body.startDate) : undefined,
          endDate: body.endDate ? new Date(body.endDate) : undefined,
          status: body.status ?? undefined,
        },
      });
      await this.audit(
        tx,
        me,
        deriveAuditProvenance(jwt),
        'academic_year.update',
        id,
        { name: year.name },
        updated,
      );
      return updated;
    }));
  }

  @Delete(':id')
  @RequiresPermission('academic_years.write')
  async remove(@Param('id') id: string, @CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    const year = await this.prisma.academicYear.findUnique({
      where: { id },
      include: { _count: { select: { classSections: true } } },
    });
    if (!year) throw new NotFoundException('Année scolaire introuvable');
    if (year.tenantId !== me.tenantId) throw new ForbiddenException();
    if (year._count.classSections > 0) {
      throw new BadRequestException(
        `Cette année contient ${year._count.classSections} classe(s). Archivez-la au lieu de la supprimer.`,
      );
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.academicYear.delete({ where: { id } });
      await this.audit(
        tx,
        me,
        deriveAuditProvenance(jwt),
        'academic_year.delete',
        id,
        { name: year.name },
        null,
      );
    });
    return { ok: true };
  }

  /* ----- Terms (nested) ----- */

  @Get(':id/terms')
  @RequiresPermission('academic_years.read')
  async listTerms(@Param('id') yearId: string, @CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    const year = await this.prisma.academicYear.findUnique({ where: { id: yearId } });
    if (!year || year.tenantId !== me.tenantId) throw new NotFoundException('Année scolaire introuvable');
    const terms = await this.prisma.term.findMany({
      where: { academicYearId: yearId },
      orderBy: { orderIndex: 'asc' },
    });
    return { data: terms };
  }

  @Post(':id/terms')
  @RequiresPermission('terms.write')
  async createTerm(
    @Param('id', ParseUUIDPipe) yearId: string,
    @Body() body: TermDto,
    @CurrentJwt() jwt: KeycloakJwtPayload,
  ) {
    this.assertDateOrder(body.startDate, body.endDate);
    const me = await this.users.ensureUser(jwt);
    const year = await this.prisma.academicYear.findUnique({ where: { id: yearId } });
    if (!year || year.tenantId !== me.tenantId) throw new NotFoundException('Année scolaire introuvable');

    const dupName = await this.prisma.term.findFirst({
      where: { academicYearId: yearId, name: body.name },
    });
    if (dupName) throw new ConflictException(`Un trimestre « ${body.name} » existe déjà sur cette année.`);
    const dupOrder = await this.prisma.term.findFirst({
      where: { academicYearId: yearId, orderIndex: body.orderIndex },
    });
    if (dupOrder) throw new ConflictException(`L'ordre ${body.orderIndex} est déjà utilisé.`);

    return this.prisma.term.create({
      data: {
        tenantId: me.tenantId,
        academicYearId: yearId,
        name: body.name,
        orderIndex: body.orderIndex,
        startDate: new Date(body.startDate),
        endDate: new Date(body.endDate),
      },
    });
  }

  @Patch('terms/:termId')
  @RequiresPermission('terms.write')
  async updateTerm(
    @Param('termId', ParseUUIDPipe) termId: string,
    @Body() body: UpdateTermDto,
    @CurrentJwt() jwt: KeycloakJwtPayload,
  ) {
    const me = await this.users.ensureUser(jwt);
    const term = await this.prisma.term.findUnique({ where: { id: termId } });
    if (!term || term.tenantId !== me.tenantId) throw new NotFoundException('Trimestre introuvable');
    if (body.startDate && body.endDate) this.assertDateOrder(body.startDate, body.endDate);
    return this.prisma.term.update({
      where: { id: termId },
      data: {
        name: body.name ?? undefined,
        orderIndex: body.orderIndex ?? undefined,
        startDate: body.startDate ? new Date(body.startDate) : undefined,
        endDate: body.endDate ? new Date(body.endDate) : undefined,
      },
    });
  }

  @Delete('terms/:termId')
  @RequiresPermission('terms.write')
  async deleteTerm(
    @Param('termId', ParseUUIDPipe) termId: string,
    @CurrentJwt() jwt: KeycloakJwtPayload,
  ) {
    const me = await this.users.ensureUser(jwt);
    const term = await this.prisma.term.findUnique({ where: { id: termId } });
    if (!term || term.tenantId !== me.tenantId) throw new NotFoundException();
    await this.prisma.term.delete({ where: { id: termId } });
    return { ok: true };
  }

  private assertDateOrder(start: string, end: string) {
    if (new Date(start) >= new Date(end)) {
      throw new BadRequestException('La date de fin doit être après la date de début.');
    }
  }

  /**
   * S-E04-7 — relays onto the shared seam (`writeAudit`) instead of writing the
   * row itself. Three things about this signature are deliberate:
   *
   *  • `action` is `AuditActionCode`, not `string` (PF-162). An undeclared code
   *    is now a compile error at the three call sites above. The parameter stays
   *    a **type reference**, so `audit-vocabulary-gate.spec.ts` still classifies
   *    this helper as an OPEN-parameter forwarder and keeps resolving its codes
   *    from the call sites — the pinned forwarder list is unchanged, and the
   *    written set does not silently absorb all 57 declared codes.
   *  • `tx` stays a `Prisma.TransactionClient` parameter. The three callers
   *    already open the transaction; the seam's brand accepts a transaction
   *    client and rejects a full `PrismaService`, so "same transaction" is
   *    carried by the type across this hop.
   *  • the client hints are stated as `null` rather than omitted. This family
   *    captured no IP/UA before this slice — the callers hold `@CurrentJwt()`
   *    but no `@Req()` — so the honest blank is non-regressive, and writing it
   *    down here is what stops "no hints" becoming an ambient default
   *    (`ADR-036`). Threading `@Req()` through the three handlers is PF-123's
   *    remaining half and is deliberately NOT taken in this slice.
   */
  private async audit(
    // PF-164 — the BRAND, not `Prisma.TransactionClient`. A relay that widens
    // back to the bare type launders the invariant `ADR-035` D1 makes
    // compile-time: `writeAudit(tx, …)` in the body would still typecheck when
    // a caller handed this relay a full `PrismaService`, so the hole run 34
    // closed reopens one hop away — and the new ratchet, which reads only the
    // seam call, blesses it.
    tx: AuditTransactionClient,
    me: { id: string; tenantId: string },
    provenance: AuditActorProvenance,
    action: AuditActionCode,
    resourceId: string,
    before: Prisma.InputJsonValue | null,
    after: Prisma.InputJsonValue | null,
  ) {
    await writeAudit(tx, {
      tenantId: me.tenantId,
      actorId: me.id,
      action,
      resourceType: 'academic_year',
      resourceId,
      provenance: {
        actorRole: provenance.actorRole,
        portal: provenance.portal,
        ipAddress: null,
        userAgent: null,
      },
      ...(before === null ? {} : { before }),
      ...(after === null ? {} : { after }),
    });
  }
}
