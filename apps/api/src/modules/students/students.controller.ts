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
  ParseEnumPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  candidateEnrollmentWhere,
  enrollmentTotalOrder,
  projectEnrollmentActivity,
  resolveActiveAcademicYear,
  selectActiveEnrollment,
} from '@pilotage/contracts';
import type { EnrollmentActivityProjection } from '@pilotage/contracts';
import { Prisma, StudentStatus } from '@prisma/client';
import {
  IsDateString,
  IsEmail,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  MinLength,
} from 'class-validator';

import { prismaAcademicYearReader } from '../../shared/academic-year/prisma-academic-year-reader';
import { CurrentJwt } from '../../shared/auth/current-user.decorator';
import { JwtAuthGuard } from '../../shared/auth/jwt-auth.guard';
import { type KeycloakJwtPayload } from '../../shared/auth/jwt.strategy';
import { PermissionsGuard } from '../../shared/auth/permissions.guard';
import { RequiresPermission } from '../../shared/auth/requires-permission.decorator';
import { UserSyncService } from '../../shared/auth/user-sync.service';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { SchoolContextService } from '../school-structure/school-context.service';

import { StudentAccessService } from './student-access.service';

class CreateStudentDto {
  @IsString() @MinLength(1) @MaxLength(80) firstName!: string;
  @IsString() @MinLength(1) @MaxLength(80) lastName!: string;
  @IsOptional() @IsDateString() birthDate?: string;
  @IsOptional() @IsString() @MaxLength(80) externalRef?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() @MaxLength(40) phone?: string;
  @IsOptional() @IsString() @Length(1, 1) gender?: string;
  @IsOptional() @IsString() @Length(2, 2) nationality?: string;
  @IsOptional() @IsObject() address?: Record<string, unknown>;
  /** URL de la photo de profil de l'élève (stockée externement, ex: MinIO). */
  @IsOptional() @IsString() @MaxLength(2000) photoUrl?: string;
  @IsOptional() @IsString() @MaxLength(2000) medicalNotes?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
  @IsOptional() @IsObject() customFields?: Record<string, unknown>;
}

class UpdateStudentDto {
  @IsOptional() @IsString() @MaxLength(80) firstName?: string;
  @IsOptional() @IsString() @MaxLength(80) lastName?: string;
  @IsOptional() @IsDateString() birthDate?: string;
  @IsOptional() @IsString() @MaxLength(80) externalRef?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() @MaxLength(40) phone?: string;
  @IsOptional() @IsString() @Length(1, 1) gender?: string;
  @IsOptional() @IsString() @Length(2, 2) nationality?: string;
  @IsOptional() @IsObject() address?: Record<string, unknown>;
  /** URL de la photo de profil de l'élève (stockée externement, ex: MinIO). */
  @IsOptional() @IsString() @MaxLength(2000) photoUrl?: string;
  @IsOptional() @IsString() @MaxLength(2000) medicalNotes?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
  @IsOptional() @IsEnum(StudentStatus) status?: StudentStatus;
  @IsOptional() @IsObject() customFields?: Record<string, unknown>;
}

@ApiTags('students')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('students')
export class StudentsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UserSyncService,
    private readonly ctx: SchoolContextService,
    private readonly access: StudentAccessService,
  ) {}

  /**
   * S-E05-16 / `PF-288` / `PF-51` clause 3 / `ADR-066` — LE MUR ENSEIGNANT ET
   * LES PIPES DE CETTE LISTE.
   *
   * `AC-6` — VALIDATION AU PIPE, et non plus un CAST. `@Query('status')
   * status?: StudentStatus` n'était qu'une annotation TypeScript : la valeur
   * arrivait telle quelle du fil et repartait telle quelle dans un `where`
   * Prisma (`?status=<garbage>` → `P2023` → 500 non mappé ; la forme SYSTÉMIQUE
   * de ce défaut est `PF-291`, hors périmètre). `classSectionId` et
   * `academicYearId` atteignaient des colonnes `@db.Uuid` sans aucun contrôle.
   *
   * L'option `optional` est VÉRIFIÉE contre la source ÉPINGLÉE
   * `@nestjs/common@10.4.22` (`ADR-065 §D4` a posé ce précédent), pas supposée :
   * `parse-enum.pipe.js` et `parse-uuid.pipe.js` ouvrent tous deux `transform`
   * par `if (isNil(value) && this.options?.optional) return value;`, et
   * `ParseEnumPipeOptions` / `ParseUUIDPipeOptions` déclarent bien
   * `optional?: boolean`.
   *
   * CHANGEMENT DE COMPORTEMENT À ÉNONCER, jamais à revendiquer comme
   * pré-existant (`DNC-06`) : `isNil` ne couvre que `null`/`undefined`. Un
   * `?status=` PRÉSENT MAIS VIDE vaut `''`, qui n'est pas nil, donc il est
   * désormais REFUSÉ EN 400 là où l'ancien `...(status ? { status } : {})` le
   * traitait comme absent. Aucun appelant première-partie ne l'émet
   * (`apps/web/src/app/admin/students/page.tsx:140-142` et
   * `StudentsPageFilters.tsx:39-40` suppriment les valeurs falsy), mais une URL
   * mise en favori ou éditée à la main l'atteint — enregistré en `PF-304`.
   *
   * PAS de `{ version: '4' }` sur `ParseUUIDPipe` : tous les ids du schéma sont
   * `@default(uuid()) @db.Uuid`, mais les lignes IMPORTÉES ou SEMÉES ne sont pas
   * garanties v4 et la regex `all` est le mur sûr.
   *
   * NON CORRIGÉ ICI, enregistré : `?limit=` / `?offset=` passent toujours par un
   * `parseInt` à repli silencieux, et `?unenrolled=` reste une chaîne comparée à
   * `'true'` (`PF-303` — paramètre MORT : zéro appelant web, et structurellement
   * vide pour un enseignant, dont la portée DÉRIVE des inscriptions actives).
   *
   * `AC-11` / `ADR-065 §D5` — LA FORME DU `where`. Deux défauts DISTINCTS sont
   * fermés ici :
   *  • `...(scope.studentIds ? … : {})` était le FAIL-OPEN PAR CLÉ ABSENTE :
   *    `null` ET `[]` tombaient tous deux sur `{}`. `[]` étant truthy en JS, le
   *    cas vide narrowait correctement — par ACCIDENT. Le test est désormais
   *    `=== null` EXPLICITE : jamais la truthiness, JAMAIS `.length` (un
   *    refactor en `scope.studentIds?.length ? … : {}` rendrait l'école ENTIÈRE
   *    à un enseignant sans `TeacherProfile`).
   *  • `where.enrollments = …` était une AFFECTATION : le filtre
   *    `classSectionId` fourni par l'APPELANT écrasait toute clause de portée
   *    exprimée relationnellement — exactement le défaut que `S-E05-15` a fermé
   *    une route plus loin. Les filtres appelant passent maintenant par
   *    `AND: []`, c'est-à-dire une INTERSECTION, la forme adoptée par
   *    `buildEnrollmentListWhere`. Ainsi `?classSectionId=<section non
   *    enseignée>` rend `[]`, et une section d'un AUTRE tenant tombe sur une
   *    intersection VIDE, jamais sur une autorisation.
   *
   * `Prisma.StudentWhereInput` et non `Record<string, unknown>` (`PF-301`) :
   * l'ancienne annotation DÉSACTIVAIT le typecheck Prisma sur l'objet EXACT où
   * la clause ABAC se replie, ce qui rendait inapplicable la règle « le
   * typecheck porte la sécurité » d'`ADR-065 §D5`.
   */
  @Get()
  @RequiresPermission('students.read')
  async list(
    @CurrentJwt() jwt: KeycloakJwtPayload,
    @Query('q') q?: string,
    @Query('status', new ParseEnumPipe(StudentStatus, { optional: true }))
    status?: StudentStatus,
    @Query('classSectionId', new ParseUUIDPipe({ optional: true })) classSectionId?: string,
    @Query('academicYearId', new ParseUUIDPipe({ optional: true })) academicYearId?: string,
    @Query('unenrolled') unenrolled?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const me = await this.users.ensureUser(jwt);
    const { schoolId, activeAcademicYearId } = await this.ctx.forUser(me);
    const scope = await this.access.scopeForUser(me, jwt, schoolId);

    // Extrait en CONSTANTE ANNOTÉE, et non laissé en `...(q ? { … } : {})` :
    // dans un spread conditionnel, l'objet littéral n'est PAS typé
    // contextuellement par `Prisma.StudentWhereInput`, donc `mode: 'insensitive'`
    // s'inférerait en `string` et ne serait plus assignable à `QueryMode`. Le
    // `Record<string, unknown>` d'avant masquait cela en désactivant TOUT le
    // typecheck Prisma sur cet objet — c'est précisément `PF-301`.
    const searchClause: Prisma.StudentWhereInput = q
      ? {
          OR: [
            { firstName: { contains: q, mode: 'insensitive' } },
            { lastName: { contains: q, mode: 'insensitive' } },
            { externalRef: { contains: q, mode: 'insensitive' } },
            { email: { contains: q, mode: 'insensitive' } },
          ],
        }
      : {};

    const where: Prisma.StudentWhereInput = {
      tenantId: me.tenantId,
      schoolId,
      // `=== null` EXPLICITE : `null` est le sentinel NON RESTREINT (admins
      // seuls) ; `[]` est le REFUS et DOIT produire `id: { in: [] }`.
      ...(scope.studentIds === null ? {} : { id: { in: scope.studentIds } }),
      ...(status ? { status } : {}),
      ...searchClause,
    };

    // INTERSECTION, jamais AFFECTATION : les filtres de l'appelant s'AJOUTENT à
    // la portée, ils ne la remplacent pas.
    const callerFilters: Prisma.StudentWhereInput[] = [];
    if (classSectionId) {
      callerFilters.push({
        enrollments: {
          some: {
            classSectionId,
            status: 'active',
            ...(academicYearId ? { academicYearId } : {}),
          },
        },
      });
    } else if (unenrolled === 'true' && activeAcademicYearId) {
      callerFilters.push({
        enrollments: {
          none: { academicYearId: activeAcademicYearId, status: 'active' },
        },
      });
    }
    if (callerFilters.length > 0) where.AND = callerFilters;

    const take = Math.min(parseInt(limit ?? '50', 10) || 50, 200);
    const skip = parseInt(offset ?? '0', 10) || 0;

    const [items, total] = await Promise.all([
      this.prisma.student.findMany({
        where,
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
        take,
        skip,
        include: {
          // B3 — S-E03-3 / ADR-072. Le jeu CANDIDAT vient du contrat, pas
          // d'un littéral : mêmes lignes qu'avant (statut actif, toutes
          // années), désormais ORDONNÉES par l'ordre total, et le verdict
          // d'activité est dérivé plus bas par `selectActiveEnrollment`.
          enrollments: {
            where: candidateEnrollmentWhere({ tenantId: me.tenantId }),
            orderBy: enrollmentTotalOrder(),
            include: {
              // The list UI surfaces the full breadcrumb Cycle → Niveau → Classe,
              // so we need to load the gradeLevel + cycle even on the list endpoint.
              classSection: {
                select: {
                  id: true,
                  name: true,
                  gradeLevel: {
                    select: {
                      id: true,
                      name: true,
                      code: true,
                      cycle: { select: { id: true, name: true, color: true } },
                    },
                  },
                },
              },
              academicYear: { select: { id: true, name: true } },
            },
          },
          // First active primary guardian — surfaced as "Responsable légal" in the table
          guardianships: {
            where: { status: 'active' },
            orderBy: [{ isPrimaryContact: 'desc' }, { createdAt: 'asc' }],
            take: 1,
            include: {
              guardian: {
                select: { id: true, firstName: true, lastName: true, email: true },
              },
            },
          },
          // `enrollments` AJOUTÉ (additif) : le jeu candidat est filtré sur le
          // statut, donc sans le total un enfant diplômé serait rendu « aucune
          // inscription » au lieu de « hors année en cours ».
          // (`guardianships` compte aussi les liens RÉVOQUÉS — PF-358,
          //  enregistré, hors périmètre de cette tranche.)
          _count: { select: { guardianships: true, enrollments: true } },
        },
      }),
      this.prisma.student.count({ where }),
    ]);

    // B3 — l'année canonique est résolue UNE FOIS PAR ÉCOLE DISTINCTE, jamais
    // par élève : `take` monte à 200, et une résolution par ligne serait un N+1
    // sur la liste la plus chaude de l'admin (GUARDRAILS §2). En pratique la
    // liste est déjà scopée à une école, donc c'est UNE requête.
    const canonicalYears = await this.canonicalYearBySchool(
      me.tenantId,
      items.map((s) => s.schoolId),
    );

    // UNE date de référence pour toute la page : deux `new Date()` dans la même
    // boucle rendraient deux diagnostics `endedAtDisagreement` incomparables.
    const now = new Date();

    const data = items.map((student) => {
      const year = canonicalYears.get(student.schoolId) ?? null;
      return {
        ...student,
        enrollmentActivity: projectEnrollmentActivity(
          selectActiveEnrollment(student.enrollments, {
            tenantId: me.tenantId,
            academicYearId: year?.id ?? null,
            academicYearName: year?.name ?? null,
            totalEnrollmentCount: student._count.enrollments,
            referenceDate: now,
          }),
          (row) => ({
            academicYearId: row.academicYearId,
            academicYearName: row.academicYear.name,
            classSectionName: row.classSection.name,
            gradeLevelName: row.classSection.gradeLevel?.name ?? null,
          }),
        ) satisfies EnrollmentActivityProjection,
      };
    });

    return { data, total, limit: take, offset: skip };
  }

  /**
   * S-E03-3 / ADR-072 — l'année canonique, UNE résolution par école DISTINCTE.
   *
   * Deux propriétés, toutes deux porteuses de charge :
   *
   * 1. La clé est l'école QUI PORTE LES LIGNES (`student.schoolId`), jamais
   *    `SchoolContextService.forUser`, qui rend « l'école du tenant qui a le
   *    plus d'élèves » (`school-context.service.ts:108-129`). Dans un tenant
   *    multi-écoles, keyer sur `forUser` ferait résoudre à `GET /students` et à
   *    `parentDashboard` DEUX années canoniques différentes — PF-12 reproduit
   *    dans son propre correctif, sur un axe neuf (axe 4 / PF-356).
   *
   * 2. La mémoïsation est PAR ÉCOLE, pas par élève : `take` plafonne à 200 et
   *    une résolution par ligne serait un N+1 (GUARDRAILS §2).
   */
  private async canonicalYearBySchool(
    tenantId: string,
    schoolIds: readonly string[],
  ): Promise<Map<string, { id: string; name: string } | null>> {
    const out = new Map<string, { id: string; name: string } | null>();
    const distinct = [...new Set(schoolIds)];
    const referenceDate = new Date();
    for (const schoolId of distinct) {
      const year = await resolveActiveAcademicYear(prismaAcademicYearReader(this.prisma), {
        tenantId,
        schoolId,
        referenceDate,
        onAbsent: 'nullWhenNoActiveYear',
      });
      out.set(schoolId, year === null ? null : { id: year.id, name: year.name });
    }
    return out;
  }

  @Get(':id')
  @RequiresPermission('students.read')
  async getOne(@Param('id') id: string, @CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    const student = await this.prisma.student.findUnique({
      where: { id },
      include: {
        // B4 — S-E03-3 / ADR-072. L'HISTORIQUE RESTE ENTIER ET NON FILTRÉ : la
        // section « parcours scolaire » de la fiche en est un consommateur
        // légitime, et le tronquer serait une régression (AC-2). Ce qui change
        // est que l'historique cesse de faire DOUBLE EMPLOI comme réponse à
        // « est-il activement inscrit ? » — cette réponse est désormais le champ
        // explicite `enrollmentActivity`, dérivé côté serveur. Seul l'ORDRE
        // devient total (`enrolledAt desc` seul ne départage pas deux lignes
        // posées à la même milliseconde par un import en lot).
        enrollments: {
          orderBy: enrollmentTotalOrder(),
          include: {
            classSection: { include: { gradeLevel: { include: { cycle: true } } } },
            academicYear: true,
          },
        },
        guardianships: {
          where: { status: { not: 'revoked' } },
          include: { guardian: true },
        },
      },
    });
    if (!student || student.tenantId !== me.tenantId) throw new NotFoundException();
    if (!(await this.access.canAccessStudent(me, jwt, student.id, student.schoolId))) {
      throw new ForbiddenException("Vous n'avez pas accès à cet élève.");
    }

    // L'année canonique, résolue à travers `resolveActiveAcademicYear` (ADR-070)
    // et keyée sur l'école qui porte les lignes. UNE requête, hors de toute
    // boucle. Le champ est ADDITIF : `student` garde exactement sa forme.
    const canonicalYear = await resolveActiveAcademicYear(
      prismaAcademicYearReader(this.prisma),
      {
        tenantId: me.tenantId,
        schoolId: student.schoolId,
        referenceDate: new Date(),
        onAbsent: 'nullWhenNoActiveYear',
      },
    );

    const enrollmentActivity = projectEnrollmentActivity(
      // Ici `rows` est l'historique COMPLET : pas de `totalEnrollmentCount` à
      // fournir, le tableau EST le total.
      selectActiveEnrollment(student.enrollments, {
        tenantId: me.tenantId,
        academicYearId: canonicalYear?.id ?? null,
        academicYearName: canonicalYear?.name ?? null,
        referenceDate: new Date(),
      }),
      (row) => ({
        academicYearId: row.academicYearId,
        academicYearName: row.academicYear.name,
        classSectionName: row.classSection.name,
        gradeLevelName: row.classSection.gradeLevel?.name ?? null,
      }),
    ) satisfies EnrollmentActivityProjection;

    return { ...student, enrollmentActivity };
  }

  @Post()
  @RequiresPermission('students.write')
  async create(@Body() body: CreateStudentDto, @CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    const { schoolId } = await this.ctx.forUser(me);

    if (body.externalRef) {
      const dup = await this.prisma.student.findUnique({
        where: { schoolId_externalRef: { schoolId, externalRef: body.externalRef } },
      });
      if (dup) throw new ConflictException(`Référence externe « ${body.externalRef} » déjà utilisée.`);
    }

    if (body.birthDate) {
      const d = new Date(body.birthDate);
      const age = (Date.now() - d.getTime()) / (365.25 * 24 * 3600 * 1000);
      if (Number.isNaN(d.getTime()) || age < 2 || age > 30) {
        throw new BadRequestException('Date de naissance invalide (âge attendu 2–30 ans).');
      }
    }

    return this.prisma.student.create({
      data: {
        tenantId: me.tenantId,
        schoolId,
        firstName: body.firstName,
        lastName: body.lastName,
        birthDate: body.birthDate ? new Date(body.birthDate) : null,
        externalRef: body.externalRef,
        email: body.email,
        phone: body.phone,
        gender: body.gender,
        nationality: body.nationality?.toUpperCase(),
        address: body.address as never,
        photoUrl: body.photoUrl,
        medicalNotes: body.medicalNotes,
        notes: body.notes,
        customFields: (body.customFields ?? {}) as never,
      },
    });
  }

  @Patch(':id')
  @RequiresPermission('students.write')
  async update(
    @Param('id') id: string,
    @Body() body: UpdateStudentDto,
    @CurrentJwt() jwt: KeycloakJwtPayload,
  ) {
    const me = await this.users.ensureUser(jwt);
    const student = await this.prisma.student.findUnique({ where: { id } });
    if (!student || student.tenantId !== me.tenantId) throw new NotFoundException();

    if (body.externalRef && body.externalRef !== student.externalRef) {
      const dup = await this.prisma.student.findUnique({
        where: { schoolId_externalRef: { schoolId: student.schoolId, externalRef: body.externalRef } },
      });
      if (dup && dup.id !== id) {
        throw new ConflictException(`Référence externe « ${body.externalRef} » déjà utilisée.`);
      }
    }

    return this.prisma.student.update({
      where: { id },
      data: {
        ...(body.firstName !== undefined ? { firstName: body.firstName } : {}),
        ...(body.lastName !== undefined ? { lastName: body.lastName } : {}),
        ...(body.birthDate !== undefined ? { birthDate: body.birthDate ? new Date(body.birthDate) : null } : {}),
        ...(body.externalRef !== undefined ? { externalRef: body.externalRef } : {}),
        ...(body.email !== undefined ? { email: body.email } : {}),
        ...(body.phone !== undefined ? { phone: body.phone } : {}),
        ...(body.gender !== undefined ? { gender: body.gender } : {}),
        ...(body.nationality !== undefined ? { nationality: body.nationality?.toUpperCase() } : {}),
        ...(body.address !== undefined ? { address: body.address as never } : {}),
        ...(body.photoUrl !== undefined ? { photoUrl: body.photoUrl } : {}),
        ...(body.medicalNotes !== undefined ? { medicalNotes: body.medicalNotes } : {}),
        ...(body.notes !== undefined ? { notes: body.notes } : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
        ...(body.customFields !== undefined ? { customFields: body.customFields as never } : {}),
      },
    });
  }

  @Delete(':id')
  @RequiresPermission('students.delete')
  async remove(@Param('id') id: string, @CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    const student = await this.prisma.student.findUnique({
      where: { id },
      include: { _count: { select: { enrollments: true } } },
    });
    if (!student || student.tenantId !== me.tenantId) throw new NotFoundException();
    if (student._count.enrollments > 0) {
      throw new BadRequestException(
        "L'élève a un historique d'inscriptions. Marquez-le « withdrawn » au lieu de le supprimer.",
      );
    }
    await this.prisma.student.delete({ where: { id } });
    return { ok: true };
  }
}
