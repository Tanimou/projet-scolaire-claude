import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  Logger,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { snapshotCoalesceKey } from '@pilotage/contracts';
import { Type } from 'class-transformer';
import {
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

import {
  type ClientHintsRequest,
  extractAuditClientHints,
} from '../../shared/audit/client-hints';
import { deriveAuditProvenance } from '../../shared/audit/provenance';
import { writeAudit } from '../../shared/audit/write-audit';
import { CurrentJwt } from '../../shared/auth/current-user.decorator';
import { JwtAuthGuard } from '../../shared/auth/jwt-auth.guard';
import { type KeycloakJwtPayload } from '../../shared/auth/jwt.strategy';
import { PermissionsGuard } from '../../shared/auth/permissions.guard';
import { RequiresPermission } from '../../shared/auth/requires-permission.decorator';
import { UserSyncService } from '../../shared/auth/user-sync.service';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { distinctScopeIdPlan, unknownScopeRef } from '../../shared/prisma/scope-fk';

import { SchoolContextService } from './school-context.service';

class CreateSubjectDto {
  @IsString() @MinLength(2) @MaxLength(40) code!: string;
  @IsString() @MinLength(2) @MaxLength(80) name!: string;
  @IsOptional() @IsNumber() @Min(0.1) @Max(20) defaultCoefficient?: number;
  @IsOptional() @IsString() @MaxLength(60) color?: string;
  @IsOptional() @IsString() @MaxLength(40) icon?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}

class UpdateSubjectDto {
  @IsOptional() @IsString() @MaxLength(80) name?: string;
  @IsOptional() @IsNumber() @Min(0.1) @Max(20) defaultCoefficient?: number;
  @IsOptional() @IsString() @MaxLength(60) color?: string;
  @IsOptional() @IsString() @MaxLength(40) icon?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}

class CoefficientEntry {
  @IsUUID() gradeLevelId!: string;
  @IsUUID() subjectId!: string;
  @IsNumber() @Min(0.1) @Max(20) coefficient!: number;
}

class BulkCoefficientDto {
  @ValidateNested({ each: true })
  @Type(() => CoefficientEntry)
  entries!: CoefficientEntry[];
}

/**
 * S-E05-3 / ADR-055 §D4 — les champs de portée de la matrice, DÉCLARÉS UNE FOIS
 * et dans l'ordre où les sondes les prouvent.
 *
 * L'ordre est significatif : sur un corps qui viole les deux, c'est le PREMIER
 * champ de ce tuple qui est nommé dans le refus. Le nom vient toujours du plan
 * rendu par `distinctScopeIdPlan`, jamais d'un littéral réécrit au point de
 * refus — deux listes tenues à la main qui divergent en silence est le défaut
 * répété de ce dépôt.
 */
const COEFFICIENT_SCOPE_FIELDS = ['gradeLevelId', 'subjectId'] as const;

@ApiTags('school-structure')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('subjects')
export class SubjectsController {
  private readonly logger = new Logger(SubjectsController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UserSyncService,
    private readonly ctx: SchoolContextService,
  ) {}

  @Get()
  @RequiresPermission('subjects.read')
  async list(@CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    const { schoolId } = await this.ctx.forTenant(me.tenantId);
    const subjects = await this.prisma.subject.findMany({
      where: { schoolId },
      orderBy: { name: 'asc' },
    });
    return {
      data: subjects.map((s) => ({
        ...s,
        defaultCoefficient: Number(s.defaultCoefficient),
      })),
    };
  }

  @Post()
  @RequiresPermission('subjects.write')
  async create(@Body() body: CreateSubjectDto, @CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    const { schoolId } = await this.ctx.forTenant(me.tenantId);
    const dup = await this.prisma.subject.findUnique({ where: { schoolId_code: { schoolId, code: body.code } } });
    if (dup) throw new ConflictException(`Une matière « ${body.code} » existe déjà.`);

    return this.prisma.$transaction(async (tx) => {
      const subject = await tx.subject.create({
        data: {
          tenantId: me.tenantId,
          schoolId,
          code: body.code,
          name: body.name,
          defaultCoefficient: body.defaultCoefficient ?? 1,
          color: body.color ?? null,
          icon: body.icon ?? null,
          active: body.active ?? true,
        },
      });
      // Auto-create coefficient rows for every existing grade level (default = subject default)
      const levels = await tx.gradeLevel.findMany({ where: { schoolId } });
      for (const lvl of levels) {
        await tx.subjectCoefficient.create({
          data: {
            tenantId: me.tenantId,
            gradeLevelId: lvl.id,
            subjectId: subject.id,
            coefficient: subject.defaultCoefficient,
          },
        });
      }
      return subject;
    });
  }

  @Patch(':id')
  @RequiresPermission('subjects.write')
  async update(
    @Param('id') id: string,
    @Body() body: UpdateSubjectDto,
    @CurrentJwt() jwt: KeycloakJwtPayload,
  ) {
    const me = await this.users.ensureUser(jwt);
    const subject = await this.prisma.subject.findUnique({ where: { id } });
    if (!subject || subject.tenantId !== me.tenantId) throw new NotFoundException();
    return this.prisma.subject.update({ where: { id }, data: body });
  }

  @Delete(':id')
  @RequiresPermission('subjects.write')
  async remove(@Param('id') id: string, @CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    const subject = await this.prisma.subject.findUnique({ where: { id } });
    if (!subject || subject.tenantId !== me.tenantId) throw new NotFoundException();
    // Soft-delete via active=false instead of hard-delete to preserve historical coefficients/grades (Phase 4+)
    return this.prisma.subject.update({ where: { id }, data: { active: false } });
  }

  /* ----- Coefficient matrix ----- */

  @Get('coefficients/matrix')
  @RequiresPermission('subjects.read')
  async coefficientMatrix(@CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    const { schoolId } = await this.ctx.forTenant(me.tenantId);
    const [subjects, levels, coefs] = await Promise.all([
      this.prisma.subject.findMany({ where: { schoolId, active: true }, orderBy: { name: 'asc' } }),
      this.prisma.gradeLevel.findMany({ where: { schoolId }, orderBy: { orderIndex: 'asc' } }),
      this.prisma.subjectCoefficient.findMany({
        where: { subject: { schoolId } },
      }),
    ]);

    return {
      subjects: subjects.map((s) => ({
        id: s.id,
        code: s.code,
        name: s.name,
        color: s.color,
        icon: s.icon,
        defaultCoefficient: Number(s.defaultCoefficient),
      })),
      gradeLevels: levels.map((l) => ({
        id: l.id,
        code: l.code,
        name: l.name,
        orderIndex: l.orderIndex,
        cycleId: l.cycleId,
      })),
      coefficients: coefs.map((c) => ({
        gradeLevelId: c.gradeLevelId,
        subjectId: c.subjectId,
        coefficient: Number(c.coefficient),
      })),
    };
  }

  /**
   * S-E04-3 / AC-4 — le second site d'écriture porté sur le seam de provenance,
   * et il est choisi pour être PROUVABLE de bout en bout : il est piloté depuis
   * `apps/web/src/app/admin/subjects/actions.ts` via le seam serveur partagé
   * `lib/api-client.ts`, avec les identifiants de l'administratrice de démo, et
   * n'exige aucune UI nouvelle. Le seed de calendrier ne suffisait pas : c'est un
   * bouton d'exploitation, pas une écriture d'usage courant.
   *
   * Les deux valeurs sont extraites AVANT `$transaction` — assainies hors de la
   * transaction, comme au site calendrier, pour la raison de S-E06-6 : un cast
   * `inet` raté ne doit pas annuler l'enregistrement qu'il trace.
   *
   * ─────────────────────────────────────────────────────────────────────────
   * S-E05-3 / PF-10 / ADR-055 — LA MATRICE N'ACCEPTE PLUS D'IDENTIFIANT ÉTRANGER
   * ─────────────────────────────────────────────────────────────────────────
   *
   * `SubjectCoefficient` est unique sur `(gradeLevelId, subjectId)` — une clé
   * qui ne porte AUCUNE colonne de tenant. Un appelant du tenant A dont le corps
   * nommait le couple du tenant B RÉÉCRIVAIT donc la ligne de B (branche
   * `update`), ou en créait une estampillée `tenantId: A` dont les deux FK
   * pointent chez B (branche `create` : une ligne dont la colonne de tenant
   * MENT sur son contenu, la forme de PF-208). Dans les deux cas cela re-pondère
   * la moyenne de chaque élève du tenant victime.
   *
   * Le correctif prouve la PROPRIÉTÉ des deux FK avant toute écriture, DANS la
   * même transaction et sur `tx` :
   *
   *  - deux sondes seulement, une par modèle, sur l'ensemble DISTINCT des ids
   *    (ADR-055 §D1). Une boucle par entrée émettrait soixante `findFirst` pour
   *    trente lignes — un nombre d'instructions borné par la REQUÊTE, ce que
   *    l'ADR-049 §D4 nomme comme violation ;
   *  - le prédicat est la CONJONCTION `{ id: { in }, tenantId, schoolId }`
   *    (ADR-055 §D2). `tenantId` reste porté explicitement parce que
   *    l'application se connecte en PROPRIÉTAIRE des tables et échappe donc à
   *    ses propres policies RLS (ADR-032 §D5) ; `schoolId` s'y ajoute parce
   *    qu'un tenant peut posséder PLUSIEURS écoles et que le GET frère ne montre
   *    que celle-là. Les deux colonnes sont dénormalisées côte à côte sans
   *    contrainte qui les lie : c'est la conjonction qui échoue fermé ;
   *  - la propriété se décide par `owned.length !== ids.length`, valide parce
   *    que `id` est la clé primaire et que les ids sont dédoublonnés. Pas de
   *    seconde liste tenue à la main ;
   *  - le refus réutilise `unknownScopeRef(field)` VERBATIM : un id étranger et
   *    un id simplement inconnu empruntent la même branche et produisent le même
   *    400 à l'octet près (ADR-049 §D2 — les distinguer serait un oracle
   *    d'existence inter-tenant).
   *
   * LIMITE NOMMÉE, assumée (ADR-055 §D3) : la portée est l'ÉCOLE, pas le tenant.
   * Un `gradeLevelId` d'une AUTRE école du MÊME tenant est désormais refusé, et
   * `forTenant` sans école explicite résout l'école par défaut (le plus d'élèves,
   * départage par `createdAt`) — si ce défaut bascule entre le GET et le PUT, un
   * enregistrement légitime peut être refusé. Refus, jamais corruption : le
   * choix inverse (sonder sur le seul `tenantId`) laisserait ouverte une fuite
   * inter-écoles à l'intérieur d'un tenant.
   *
   * DEUXIÈME LIMITE : `forTenant` lève `NotFoundException` pour un tenant sans
   * école. Ce handler ne l'appelait pas jusqu'ici ; un PUT sur un tenant vierge
   * répondra donc 404 au lieu d'écrire — un tenant sans école n'a de toute façon
   * ni niveau ni matière à pondérer.
   *
   * HORS PÉRIMÈTRE, explicitement : aucune conversion vers `TenantScopeService`
   * (ADR-054 §D2), aucune migration (la clé composite tenant-consciente est
   * consignée en PF-239), aucun plafond sur `entries[]` (PF-238), aucune reprise
   * des lignes sombres déjà écrites, et AUCUN second filtre sur la mise en file
   * de recalcul : celle-ci est un FRÈRE d'après-commit, jamais atteinte par un
   * refus — le préjudice (c) se ferme par construction.
   */
  @Put('coefficients/matrix')
  @RequiresPermission('subjects.write')
  async upsertCoefficients(
    @Body() body: BulkCoefficientDto,
    @CurrentJwt() jwt: KeycloakJwtPayload,
    @Req() req: ClientHintsRequest,
  ) {
    const me = await this.users.ensureUser(jwt);
    const { actorRole, portal, ipAddress, userAgent } = deriveAuditProvenance(
      jwt,
      extractAuditClientHints(req),
    );
    if (!Array.isArray(body.entries) || body.entries.length === 0) {
      throw new BadRequestException('Aucune entrée à enregistrer.');
    }
    // S-E05-3 / AC-1 — l'école de l'appelant, que ce handler était le SEUL de ce
    // contrôleur à ne pas résoudre. Même appel, même forme que le GET frère
    // (`forTenant(me.tenantId)`, sans école explicite) : une divergence ici
    // refuserait une matrice que le GET vient d'afficher.
    const { schoolId } = await this.ctx.forTenant(me.tenantId);
    // Moitié PURE, hors transaction : elle ne touche pas la base et refuse déjà
    // un id vide ou nul, donc un corps malformé n'ouvre même pas de transaction.
    const scopePlan = distinctScopeIdPlan(body.entries, COEFFICIENT_SCOPE_FIELDS);

    await this.prisma.$transaction(async (tx) => {
      // Moitié IMPURE, écrite EN LIGNE et sur `tx` (PF-200 : l'attribution de
      // `tenant-adversarial-check.js` est LEXICALE et ne traverse pas `this`).
      // Deux sondes, avant que la boucle d'écriture ne s'ouvre ; le champ nommé
      // dans le refus est LU dans le plan, jamais réécrit en littéral.
      for (const scope of scopePlan) {
        if (scope.field === 'gradeLevelId') {
          const owned = await tx.gradeLevel.findMany({
            where: { id: { in: scope.ids }, tenantId: me.tenantId, schoolId },
            select: { id: true },
          });
          if (owned.length !== scope.ids.length) throw unknownScopeRef(scope.field);
          continue;
        }
        if (scope.field === 'subjectId') {
          const owned = await tx.subject.findMany({
            where: { id: { in: scope.ids }, tenantId: me.tenantId, schoolId },
            select: { id: true },
          });
          if (owned.length !== scope.ids.length) throw unknownScopeRef(scope.field);
          continue;
        }
        // Échoue FERMÉ : un champ ajouté au tuple sans sa sonde refuse le corps
        // au lieu de le laisser passer non prouvé.
        throw unknownScopeRef(scope.field);
      }

      for (const e of body.entries) {
        await tx.subjectCoefficient.upsert({
          where: { gradeLevelId_subjectId: { gradeLevelId: e.gradeLevelId, subjectId: e.subjectId } },
          update: { coefficient: e.coefficient },
          create: {
            tenantId: me.tenantId,
            gradeLevelId: e.gradeLevelId,
            subjectId: e.subjectId,
            coefficient: e.coefficient,
          },
        });
      }
      // S-E04-7 — same transaction, same row, now through the shared seam. The
      // provenance was already destructured ABOVE the `$transaction` call (line
      // ~228), which is S-E06-6's ordering rule and the reason this site needed
      // no re-ordering to convert.
      await writeAudit(tx, {
        tenantId: me.tenantId,
        actorId: me.id,
        action: 'coefficient.upsert',
        resourceType: 'subject_coefficient',
        resourceId: null,
        provenance: {
          actorRole,
          portal,
          ipAddress,
          userAgent,
        },
        after: { count: body.entries.length },
      });
    });

    // E6-S3 (FR6) — best-effort, NON-BLOCKING coefficient-change recompute enqueue.
    // A coefficient edit re-weights the GLOBAL average of every pupil in every class
    // teaching the changed subject. The locked S1 trigger schema has no gradeLevelId
    // column, so we enqueue ONE class-LESS trigger per DISTINCT changed subject,
    // carrying (subjectId, academicYearId); the worker (FR7) fans it out to every
    // affected ClassSection of that year. Resolved AFTER the $transaction commits
    // (a sibling, never nested), so an enqueue failure can never roll back the save.
    // Idempotent upsert on (tenantId, coalesceKey, status='pending') → a 30-entry
    // matrix save collapses to one trigger per subject. Writes NO audit row
    // (recompute is derived bookkeeping — the coefficient.upsert audit is untouched).
    try {
      const subjectIds = [...new Set(body.entries.map((e) => e.subjectId))];
      const activeYears = await this.prisma.academicYear.findMany({
        where: { tenantId: me.tenantId, status: 'active' },
        select: { id: true },
      });
      const now = new Date();
      for (const subjectId of subjectIds) {
        for (const year of activeYears) {
          const scope = { subjectId, academicYearId: year.id };
          const coalesceKey = snapshotCoalesceKey(me.tenantId, 'coefficient_changed', scope);
          await this.prisma.snapshotRecomputeTrigger.upsert({
            where: {
              tenantId_coalesceKey_status: {
                tenantId: me.tenantId,
                coalesceKey,
                status: 'pending',
              },
            },
            create: {
              tenantId: me.tenantId,
              reason: 'coefficient_changed',
              status: 'pending',
              // class-LESS: the worker resolves classes from (subject, year).
              classSectionId: null,
              subjectId,
              academicYearId: year.id,
              coalesceKey,
            },
            update: { enqueuedAt: now },
          });
        }
      }
    } catch (err) {
      this.logger.warn(
        `[subjects] coefficient_changed snapshot recompute enqueue failed: ${(err as Error).message}`,
      );
    }

    return { ok: true, count: body.entries.length };
  }
}
