import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  GUARDIANSHIP_ALL_STATES_ARE_DELIBERATE,
  GUARDIANSHIP_SCOPE_LABEL,
  guardianshipOnTheBooksWhere,
} from '@pilotage/contracts';
import { GuardianRelationship, GuardianshipStatus } from '@prisma/client';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

import { CurrentJwt } from '../../shared/auth/current-user.decorator';
import { JwtAuthGuard } from '../../shared/auth/jwt-auth.guard';
import { type KeycloakJwtPayload } from '../../shared/auth/jwt.strategy';
import { PermissionsGuard } from '../../shared/auth/permissions.guard';
import { RequiresPermission } from '../../shared/auth/requires-permission.decorator';
import { UserSyncService } from '../../shared/auth/user-sync.service';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { SchoolContextService } from '../school-structure/school-context.service';

class CreateGuardianDto {
  @IsString() @MinLength(1) @MaxLength(80) firstName!: string;
  @IsString() @MinLength(1) @MaxLength(80) lastName!: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() @MaxLength(40) phone?: string;
  @IsOptional() @IsString() @MaxLength(120) profession?: string;
  @IsOptional() @IsObject() address?: Record<string, unknown>;
  @IsOptional() @IsUUID() userProfileId?: string;
}

class UpdateGuardianDto {
  @IsOptional() @IsString() @MaxLength(80) firstName?: string;
  @IsOptional() @IsString() @MaxLength(80) lastName?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() @MaxLength(40) phone?: string;
  @IsOptional() @IsString() @MaxLength(120) profession?: string;
  @IsOptional() @IsObject() address?: Record<string, unknown>;
}

class CreateGuardianshipDto {
  @IsUUID() guardianId!: string;
  @IsUUID() studentId!: string;
  @IsEnum(GuardianRelationship) relationship!: GuardianRelationship;
  @IsOptional() @IsBoolean() isPrimaryContact?: boolean;
  @IsOptional() @IsBoolean() canPickup?: boolean;
  @IsOptional() @IsBoolean() hasLegalCustody?: boolean;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}

class UpdateGuardianshipDto {
  @IsOptional() @IsEnum(GuardianRelationship) relationship?: GuardianRelationship;
  @IsOptional() @IsBoolean() isPrimaryContact?: boolean;
  @IsOptional() @IsBoolean() canPickup?: boolean;
  @IsOptional() @IsBoolean() hasLegalCustody?: boolean;
  @IsOptional() @IsEnum(GuardianshipStatus) status?: GuardianshipStatus;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}

@ApiTags('guardians')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('guardians')
export class GuardiansController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UserSyncService,
    private readonly ctx: SchoolContextService,
  ) {}

  @Get()
  @RequiresPermission('parents.read')
  async list(
    @CurrentJwt() jwt: KeycloakJwtPayload,
    @Query('q') q?: string,
    @Query('studentId') studentId?: string,
    @Query('limit') limit?: string,
  ) {
    const me = await this.users.ensureUser(jwt);
    const { schoolId } = await this.ctx.forUser(me);
    const take = Math.min(parseInt(limit ?? '50', 10) || 50, 200);

    const where: Record<string, unknown> = { tenantId: me.tenantId, schoolId };
    if (q) {
      where.OR = [
        { firstName: { contains: q, mode: 'insensitive' } },
        { lastName: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
      ];
    }
    if (studentId) {
      where.guardianships = { some: { studentId, ...guardianshipOnTheBooksWhere() } };
    }

    // S-E03-3c / PF-358 / ADR-074 — LE COMPTE ET LE TABLEAU PORTENT DÉSORMAIS
    // LA MÊME PORTÉE. Avant cette tranche, `_count.guardianships` n'avait AUCUN
    // filtre tandis que le tableau juste en dessous filtrait `{ not: 'revoked' }` :
    // la même charge utile se contredisait donc elle-même — « 2 rattachements »
    // au-dessus d'une liste qui en montrait un. C'est la forme exacte que PF-12
    // nomme, sur un seul objet.
    const data = await this.prisma.guardian.findMany({
      where,
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      take,
      include: {
        _count: { select: { guardianships: { where: guardianshipOnTheBooksWhere() } } },
        guardianships: {
          where: guardianshipOnTheBooksWhere(),
          include: { student: { select: { id: true, firstName: true, lastName: true } } },
        },
      },
    });
    return { data, guardianshipScope: GUARDIANSHIP_SCOPE_LABEL.onTheBooks };
  }

  @Get(':id')
  @RequiresPermission('parents.read')
  async getOne(@Param('id') id: string, @CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    // S-E03-3c / ADR-074 §2.6 — LECTURE TOUS ÉTATS, DÉLIBÉRÉE. La fiche d'un
    // parent est une vue de GESTION : l'admin doit y voir l'historique, donc
    // les liens révoqués. Ce n'est PAS l'oubli de filtre que la tranche ferme
    // ailleurs — mais rien ne distinguait les deux avant que le site ne le
    // DISE. Il le dit maintenant, dans son propre code, là où un relecteur le
    // voit ; une allowlist dans le cliquet aurait produit l'inverse.
    void GUARDIANSHIP_ALL_STATES_ARE_DELIBERATE;
    const guardian = await this.prisma.guardian.findUnique({
      where: { id },
      include: {
        guardianships: { include: { student: true } },
      },
    });
    if (!guardian || guardian.tenantId !== me.tenantId) throw new NotFoundException();
    return { ...guardian, guardianshipScope: GUARDIANSHIP_SCOPE_LABEL.allStates };
  }

  @Post()
  @RequiresPermission('parents.write')
  async create(@Body() body: CreateGuardianDto, @CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    const { schoolId } = await this.ctx.forUser(me);

    if (body.email) {
      const existing = await this.prisma.guardian.findFirst({
        where: { tenantId: me.tenantId, schoolId, email: body.email },
      });
      if (existing) {
        throw new ConflictException(
          `Un parent avec l'email « ${body.email} » existe déjà. Réutilisez-le plutôt que d'en créer un nouveau.`,
        );
      }
    }

    return this.prisma.guardian.create({
      data: {
        tenantId: me.tenantId,
        schoolId,
        firstName: body.firstName,
        lastName: body.lastName,
        email: body.email,
        phone: body.phone,
        profession: body.profession,
        address: body.address as never,
        userProfileId: body.userProfileId,
      },
    });
  }

  @Patch(':id')
  @RequiresPermission('parents.write')
  async update(
    @Param('id') id: string,
    @Body() body: UpdateGuardianDto,
    @CurrentJwt() jwt: KeycloakJwtPayload,
  ) {
    const me = await this.users.ensureUser(jwt);
    const guardian = await this.prisma.guardian.findUnique({ where: { id } });
    if (!guardian || guardian.tenantId !== me.tenantId) throw new NotFoundException();

    return this.prisma.guardian.update({
      where: { id },
      data: {
        ...(body.firstName !== undefined ? { firstName: body.firstName } : {}),
        ...(body.lastName !== undefined ? { lastName: body.lastName } : {}),
        ...(body.email !== undefined ? { email: body.email } : {}),
        ...(body.phone !== undefined ? { phone: body.phone } : {}),
        ...(body.profession !== undefined ? { profession: body.profession } : {}),
        ...(body.address !== undefined ? { address: body.address as never } : {}),
      },
    });
  }

  @Delete(':id')
  @RequiresPermission('parents.delete')
  async remove(@Param('id') id: string, @CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    // S-E03-3c / PF-358 / ADR-074 — LE GARDE COMPTAIT LES LIENS RÉVOQUÉS, SI
    // BIEN QUE LE REMÈDE QU'IL PRESCRIT NE POUVAIT JAMAIS LE LEVER.
    //
    // Le message dit « Révoquez d'abord les rattachements ». Révoquer passe le
    // lien à `revoked` — que ce `_count` NON FILTRÉ continuait de compter. Un
    // utilisateur appliquant l'instruction à la lettre rebouclait donc
    // indéfiniment : la seule sortie était de supprimer les lignes en base.
    // Ce n'est pas une divergence d'affichage, c'est une opération admin
    // impossible à mener à terme.
    //
    // La portée correcte est AU REGISTRE, pas VIVANT : un lien `pending` est
    // une décision humaine encore en vol, et supprimer le parent sous elle la
    // ferait disparaître sans qu'elle ait été tranchée. Le garde reste donc
    // volontairement plus large que `guardianshipLiveWhere()`.
    const guardian = await this.prisma.guardian.findUnique({
      where: { id },
      include: {
        _count: { select: { guardianships: { where: guardianshipOnTheBooksWhere() } } },
      },
    });
    if (!guardian || guardian.tenantId !== me.tenantId) throw new NotFoundException();
    if (guardian._count.guardianships > 0) {
      throw new BadRequestException(
        'Ce parent est lié à des élèves. Révoquez d\'abord les rattachements.',
      );
    }
    await this.prisma.guardian.delete({ where: { id } });
    return { ok: true };
  }

  // ----- Guardianships (Guardian ↔ Student links) ---------------------------

  @Get('guardianships/list')
  @RequiresPermission('guardianships.read')
  async listGuardianships(
    @CurrentJwt() jwt: KeycloakJwtPayload,
    @Query('studentId') studentId?: string,
    @Query('guardianId') guardianId?: string,
  ) {
    const me = await this.users.ensureUser(jwt);
    // S-E03-3c / ADR-074 §2.6 — LECTURE TOUS ÉTATS, DÉLIBÉRÉE. C'est l'écran de
    // GESTION des rattachements : montrer les liens révoqués est sa raison
    // d'être, et son `orderBy` trie déjà sur `status`. La déclaration ne change
    // pas la requête ; elle rend l'intention lisible, pour que « non filtré »
    // cesse d'être indistinguable d'un oubli.
    void GUARDIANSHIP_ALL_STATES_ARE_DELIBERATE;
    const data = await this.prisma.guardianship.findMany({
      where: {
        tenantId: me.tenantId,
        ...(studentId ? { studentId } : {}),
        ...(guardianId ? { guardianId } : {}),
      },
      include: {
        guardian: true,
        student: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    });
    return { data, guardianshipScope: GUARDIANSHIP_SCOPE_LABEL.allStates };
  }

  @Post('guardianships')
  @RequiresPermission('guardianships.write')
  async createGuardianship(
    @Body() body: CreateGuardianshipDto,
    @CurrentJwt() jwt: KeycloakJwtPayload,
  ) {
    const me = await this.users.ensureUser(jwt);
    const [guardian, student] = await Promise.all([
      this.prisma.guardian.findUnique({ where: { id: body.guardianId } }),
      this.prisma.student.findUnique({ where: { id: body.studentId } }),
    ]);
    if (!guardian || guardian.tenantId !== me.tenantId) throw new NotFoundException('Parent introuvable');
    if (!student || student.tenantId !== me.tenantId) throw new NotFoundException('Élève introuvable');
    if (guardian.schoolId !== student.schoolId) {
      throw new BadRequestException('Le parent et l\'élève doivent appartenir à la même école.');
    }
    const dup = await this.prisma.guardianship.findUnique({
      where: { guardianId_studentId: { guardianId: body.guardianId, studentId: body.studentId } },
    });
    if (dup && dup.status !== 'revoked') {
      throw new ConflictException('Ce parent est déjà rattaché à cet élève.');
    }

    // Demote any other primary contact if this one is marked primary.
    if (body.isPrimaryContact) {
      await this.prisma.guardianship.updateMany({
        where: { studentId: body.studentId, isPrimaryContact: true },
        data: { isPrimaryContact: false },
      });
    }

    if (dup && dup.status === 'revoked') {
      return this.prisma.guardianship.update({
        where: { id: dup.id },
        data: {
          relationship: body.relationship,
          isPrimaryContact: body.isPrimaryContact ?? false,
          canPickup: body.canPickup ?? true,
          hasLegalCustody: body.hasLegalCustody ?? true,
          status: 'active',
          notes: body.notes,
          revokedAt: null,
          approvedBy: me.id,
          approvedAt: new Date(),
        },
      });
    }

    return this.prisma.guardianship.create({
      data: {
        tenantId: me.tenantId,
        guardianId: body.guardianId,
        studentId: body.studentId,
        relationship: body.relationship,
        isPrimaryContact: body.isPrimaryContact ?? false,
        canPickup: body.canPickup ?? true,
        hasLegalCustody: body.hasLegalCustody ?? true,
        status: 'active',
        approvedBy: me.id,
        approvedAt: new Date(),
        notes: body.notes,
      },
    });
  }

  @Patch('guardianships/:id')
  @RequiresPermission('guardianships.write')
  async updateGuardianship(
    @Param('id') id: string,
    @Body() body: UpdateGuardianshipDto,
    @CurrentJwt() jwt: KeycloakJwtPayload,
  ) {
    const me = await this.users.ensureUser(jwt);
    const link = await this.prisma.guardianship.findUnique({ where: { id } });
    if (!link || link.tenantId !== me.tenantId) throw new NotFoundException();

    if (body.isPrimaryContact === true) {
      await this.prisma.guardianship.updateMany({
        where: { studentId: link.studentId, id: { not: id }, isPrimaryContact: true },
        data: { isPrimaryContact: false },
      });
    }

    return this.prisma.guardianship.update({
      where: { id },
      data: {
        ...(body.relationship !== undefined ? { relationship: body.relationship } : {}),
        ...(body.isPrimaryContact !== undefined ? { isPrimaryContact: body.isPrimaryContact } : {}),
        ...(body.canPickup !== undefined ? { canPickup: body.canPickup } : {}),
        ...(body.hasLegalCustody !== undefined ? { hasLegalCustody: body.hasLegalCustody } : {}),
        ...(body.status !== undefined
          ? {
              status: body.status,
              ...(body.status === 'revoked' ? { revokedAt: new Date() } : {}),
            }
          : {}),
        ...(body.notes !== undefined ? { notes: body.notes } : {}),
      },
    });
  }

  @Delete('guardianships/:id')
  @RequiresPermission('guardianships.write')
  async revokeGuardianship(@Param('id') id: string, @CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    const link = await this.prisma.guardianship.findUnique({ where: { id } });
    if (!link || link.tenantId !== me.tenantId) throw new NotFoundException();
    return this.prisma.guardianship.update({
      where: { id },
      data: { status: 'revoked', revokedAt: new Date() },
    });
  }
}
