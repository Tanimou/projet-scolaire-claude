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
  GUARDIANSHIP_LINK_STATUSES,
  GUARDIANSHIP_SCOPE_LABEL,
  type GuardianshipLinkStatus,
  guardianshipOnTheBooksWhere,
  guardianshipRequestQueueWhere,
  pageSizeOf,
  pageWindow,
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

/**
 * S-E03-9 / PF-50 / ADR-080 — la fenêtre de page de la liste de responsables,
 * avec SES nombres : 50 par défaut, 200 au maximum. Inchangés.
 *
 * `.pick({ limit: true })` : ce point d'entrée n'a JAMAIS accepté d'`offset`.
 * Le retirer du schéma est plus honnête que d'en accepter un qui serait ignoré
 * en silence — un paramètre lu et jeté est la forme même du défaut que cette
 * tranche ferme.
 *
 * ⚠ `apps/web/src/app/admin/students/[id]` appelle `guardians?limit=200`,
 * c'est-à-dire EXACTEMENT le plafond. C'est l'argument mesuré d'ADR-080 §D1
 * pour loger la fabrique dans `packages/contracts` : le littéral du client et
 * le plafond du serveur ne sont pas deux listes tenues à la main.
 */
const GUARDIANS_LIST_PAGE_WINDOW = pageWindow({ def: 50, max: 200 }).pick({ limit: true });

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
    const parsedWindow = GUARDIANS_LIST_PAGE_WINDOW.safeParse({ limit });
    if (!parsedWindow.success) {
      throw new BadRequestException(parsedWindow.error.issues.map((i) => i.message));
    }
    const take = pageSizeOf(parsedWindow.data);
    const me = await this.users.ensureUser(jwt);
    const { schoolId } = await this.ctx.forUser(me);

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

  /**
   * S-E03-5 / PF-20 / ADR-075 §D1 — LA FILE DES DEMANDES DE RATTACHEMENT.
   *
   * POURQUOI UN ENDPOINT DÉDIÉ, ET NON LA RÉUTILISATION D'UN DES DEUX VOISINS
   * -------------------------------------------------------------------------
   * `/admin/enrollments` lisait `GET /guardians`, qui rend des lignes
   * **Guardian** — un modèle qui n'a NI `status` NI `notes`. La page en
   * déclarait pourtant à la main une forme de **Guardianship**, et `api<T>()`
   * castant sans valider, ses cinq onglets comparaient `undefined` à un
   * littéral. Toujours faux. Pour tout tenant. Depuis toujours. C'est la moitié
   * « 28 pending vs file vide » de `PF-20`, et c'est structurel.
   *
   * Les deux voies rejetées, par MESURE et non par coût :
   *
   *   (a) APLATIR `guardianships[]` DE `GET /guardians`. Depuis ADR-074 cette
   *       relation est filtrée par `guardianshipOnTheBooksWhere()` (`:127`),
   *       donc les liens RÉVOQUÉS n'y sont plus : l'onglet « Rejetées »
   *       resterait structurellement vide — `DNC-06` DÉPLACÉ au lieu d'être
   *       retiré. Son `student` ne sélectionne pas `enrollments`, donc la
   *       colonne « Classe souhaitée » resterait « — » sur toutes les lignes.
   *       Et son plafond de 200 GUARDIANS laisserait le comptage au client,
   *       rendant l'accord KPI↔file impossible PAR CONSTRUCTION.
   *
   *   (b) RÉUTILISER `GET guardianships/list` ci-dessus. Son `where` est
   *       tenant-wide, SANS axe école : la file d'une école deviendrait celle
   *       du tenant entier, une régression de portée dans une tranche qui n'y a
   *       pas droit. Il n'a pas de `take`. Et il est gardé par
   *       `guardianships.read`, que `permissions.constants.ts:226` accorde à
   *       `teacher` et `:260` à `parent`.
   *
   * POURQUOI `parents.read` ET NON `guardianships.read` — L'ÉCART ASSUMÉ
   * --------------------------------------------------------------------
   * Le brief demandait `guardianships.read`. MESURÉ avant d'écrire :
   * `permissions.constants.ts:226` et `:260` accordent ce code à `teacher` ET à
   * `parent`. Cette file rend l'email et le téléphone de parents, plus les noms
   * d'élèves — la poser sous ce code l'ouvrirait à deux audiences qui ne l'ont
   * pas aujourd'hui, c'est-à-dire élargirait une autorisation dans une tranche
   * Tier B qui n'a pas le droit d'en changer une.
   *
   * `parents.read` est le code que porte DÉJÀ l'endpoint que cette file lit
   * aujourd'hui (`GET /guardians`, `:91`), il est admin-seul
   * (`permissions.constants.ts:162`), et il gouverne déjà exactement ces
   * données. La posture d'autorisation de la file est donc INCHANGÉE, à la
   * ligne près : personne ne gagne ni ne perd l'accès.
   *
   * CE QU'IL REND, ET POURQUOI CHAQUE MORCEAU
   * ------------------------------------------
   * • des lignes **Guardianship** — la population que la page prétend lire ;
   * • `student.enrollments` (take 1) — la colonne « Classe souhaitée » ;
   * • une pagination SERVEUR (`page`/`pageSize`, défaut 10, plafond 100) ;
   * • `total`, compté en base sur le MÊME `where` que `data` ;
   * • `totalsByStatus`, un `groupBy` serveur sur la portée SANS filtre d'état,
   *   pour que les badges d'onglets lisent des totaux et jamais un `.length` de
   *   page. C'est la moitié de `PF-20` que la forme de ligne seule ne fermerait
   *   pas : des badges comptant une page tronquée sous un KPI comptant la base
   *   remplaceraient « 28 vs 0 » par « 28 vs 19 », ce qui est pire ;
   * • `guardianshipScope`, pour que le nombre porte sa portée (ADR-041 §D3).
   *
   * PAS DE COLLISION DE ROUTAGE : `@Get(':id')` ne matche qu'UN segment, et
   * `guardianships/list` coexiste déjà sous la même forme à deux segments.
   */
  @Get('guardianships/pending-requests')
  @RequiresPermission('parents.read')
  async listPendingRequests(
    @CurrentJwt() jwt: KeycloakJwtPayload,
    @Query('status') statusRaw?: string,
    @Query('page') pageRaw?: string,
    @Query('pageSize') pageSizeRaw?: string,
  ) {
    const me = await this.users.ensureUser(jwt);
    const { schoolId } = await this.ctx.forUser(me);
    const scope = { tenantId: me.tenantId, schoolId };

    // L'état demandé est DÉRIVÉ de la liste canonique, jamais comparé à un
    // littéral et jamais casté : `filter` sur `GUARDIANSHIP_LINK_STATUSES` est
    // à la fois la validation et le rétrécissement de type (ADR-067). Absent ⇒
    // tous les états, ce qui est la portée de l'onglet « Toutes ».
    const statuses =
      statusRaw === undefined || statusRaw === ''
        ? GUARDIANSHIP_LINK_STATUSES
        : GUARDIANSHIP_LINK_STATUSES.filter((s) => s === statusRaw);
    if (statuses.length === 0) {
      throw new BadRequestException(
        `Statut de rattachement inconnu : « ${statusRaw} ». Valeurs admises : ${GUARDIANSHIP_LINK_STATUSES.join(', ')}.`,
      );
    }

    // S-E03-9 / PF-50 / PF-424 — NON CONVERTI, et c'est une RAISON, pas un
    // chemin en attente de travail (AC-2).
    //
    // C'est la ONZIÈME forme, et la seule qui ne soit pas une fenêtre
    // `limit`/`offset` : c'est un NUMÉRO DE PAGE 1-basé (`?page=2&pageSize=10`)
    // dont le décalage est DÉRIVÉ (`skip: (page - 1) * pageSize`). L'exprimer
    // par la fabrique canonique exigerait soit de RENOMMER deux paramètres de
    // requête visibles par l'appelant — un changement d'API, pas un changement
    // d'analyseur, donc plus large que cette tranche —, soit d'ajouter une
    // SECONDE expression d'analyse au module canonique, ce que AC-1 interdit
    // précisément parce que c'est ainsi que la divergence recommence.
    //
    // Il CLAMPE CORRECTEMENT par le bas (`Math.max(…, 1)` aux deux lignes) : il
    // ne porte donc PAS le défaut d'inversion que la tranche ferme. Il reste
    // COMPTÉ dans le plafond décroissant `R2` du cliquet — un plafond n'exempte
    // personne, il interdit la récidive — et enregistré en `PF-424`.
    const pageSize = Math.min(Math.max(parseInt(pageSizeRaw ?? '10', 10) || 10, 1), 100);
    const page = Math.max(parseInt(pageRaw ?? '1', 10) || 1, 1);

    // UNE portée, construite UNE fois. Le `where` de la page, celui du `total`
    // et celui du `groupBy` sortent tous du même constructeur : aucun des trois
    // ne peut en épeler la moitié, ni oublier l'axe école.
    const where = guardianshipRequestQueueWhere(scope, statuses);
    const scopeWhere = guardianshipRequestQueueWhere(scope, GUARDIANSHIP_LINK_STATUSES);

    const [rows, total, byStatus] = await Promise.all([
      this.prisma.guardianship.findMany({
        where,
        orderBy: [{ createdAt: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          status: true,
          relationship: true,
          notes: true,
          createdAt: true,
          guardian: {
            select: { id: true, firstName: true, lastName: true, email: true, phone: true },
          },
          student: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              enrollments: {
                orderBy: { createdAt: 'desc' },
                take: 1,
                select: { classSection: { select: { name: true } } },
              },
            },
          },
        },
      }),
      this.prisma.guardianship.count({ where }),
      this.prisma.guardianship.groupBy({
        by: ['status'],
        where: scopeWhere,
        orderBy: { status: 'asc' },
        _count: { _all: true },
      }),
    ]);

    // Chaque état de l'énum est présent, à zéro s'il n'a aucune ligne : un
    // badge absent et un badge à zéro ne disent pas la même chose, et le
    // client ne doit pas avoir à deviner lequel il regarde.
    const totalsByStatus = Object.fromEntries(
      GUARDIANSHIP_LINK_STATUSES.map(
        (s): [GuardianshipLinkStatus, number] => [
          s,
          byStatus.find((g) => g.status === s)?._count._all ?? 0,
        ],
      ),
    ) as Record<GuardianshipLinkStatus, number>;

    return {
      data: rows,
      page,
      pageSize,
      total,
      totalsByStatus,
      guardianshipScope: GUARDIANSHIP_SCOPE_LABEL.awaitingDecision,
    };
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
