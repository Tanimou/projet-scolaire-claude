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
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { SchoolAddressSchema } from '@pilotage/contracts';
import { Prisma } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsObject,
  IsOptional,
  IsString,
  Length,
  MaxLength,
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

/** DTO d'adresse structurée — sous-objet JSON du champ `School.address`. */
class SchoolAddressDto {
  @IsOptional() @IsString() @MaxLength(50) continent?: string;
  @IsString() @Length(2, 2) country!: string;
  @IsOptional() @IsString() @MaxLength(100) city?: string;
  @IsOptional() @IsString() @MaxLength(100) quartier?: string;
  @IsOptional() @IsString() @MaxLength(200) line1?: string;
  @IsOptional() @IsString() @MaxLength(20) postalCode?: string;
}

/**
 * Valide et normalise un objet d'adresse brut (provenant du champ JSON Prisma).
 * Retourne `null` si l'objet est absent ou invalide.
 */
function parseAddress(raw: unknown): ReturnType<typeof SchoolAddressSchema.parse> | null {
  const result = SchoolAddressSchema.safeParse(raw);
  return result.success ? result.data : null;
}

/**
 * S-E04-10 (PF-159 / AC-9) — la valeur d'adresse consignée dans une ligne d'audit.
 *
 * Elle passe par `parseAddress`, donc la ligne porte l'objet STRUCTURÉ validé et
 * non le JSON Prisma brut — c'est ce que le tiroir d'audit rend lisible.
 *
 * LE REPLI SUR LA VALEUR BRUTE N'EST PAS UNE COMMODITÉ. `parseAddress` renvoie
 * `null` pour une adresse ABSENTE **et** pour une adresse INVALIDE (une ligne
 * historique dont le `country` fait trois lettres, par exemple). Appliqué tel quel
 * au côté `before`, cela ferait affirmer à la trace qu'une adresse a été CRÉÉE là
 * où il y en avait déjà une — une falsification fabriquée par le correctif, sur le
 * seul champ dont la ligne d'audit est l'unique témoin survivant (G-TRUTH). On
 * retombe donc sur la valeur stockée quand elle existe mais ne valide pas, plutôt
 * que d'affirmer un vide.
 */
function auditAddress(raw: unknown): Prisma.InputJsonValue | null {
  const parsed = parseAddress(raw);
  if (parsed !== null) return parsed;
  if (raw === null || raw === undefined) return null;
  return raw as Prisma.InputJsonValue;
}

/**
 * S-E04-10 (PF-158 / AC-6) — vrai quand un `PATCH /schools/:id` ne change RIEN.
 *
 * Comparaison CHAMP PAR CHAMP sur les clés réellement fournies, et non détection
 * de corps vide : le cas visé est le double-clic ou le retry client, qui renvoie
 * les MÊMES valeurs, pas `{}`. Un `Object.keys(body).length === 0` laisserait le
 * défaut entier en place tout en ayant l'air corrigé.
 *
 * `address` est comparée à travers `parseAddress` DES DEUX CÔTÉS : l'ordre des
 * clés de la sortie Zod suit l'ordre de déclaration du schéma et est donc
 * déterministe, alors que celui du DTO issu de class-transformer suit la charge
 * utile reçue. Deux `null` de `parseAddress` ne sont JAMAIS traités comme égaux
 * (absente ≠ invalide) : le cas d'effacement s'appuie sur `school.address == null`,
 * la colonne elle-même, pour qu'une adresse stockée invalide ne soit pas prise
 * pour un non-événement.
 *
 * `status` ne peut plus apparaître ici : il a quitté le DTO (AC-1).
 */
function isSchoolUpdateNoOp(
  body: UpdateSchoolDto,
  school: { name: string; timezone: string; locale: string; address: unknown },
): boolean {
  if (body.name !== undefined && body.name !== school.name) return false;
  if (body.timezone !== undefined && body.timezone !== school.timezone) return false;
  if (body.locale !== undefined && body.locale !== school.locale) return false;
  if (body.address !== undefined) {
    if (body.address === null) {
      // Effacement : non-événement UNIQUEMENT si la colonne est déjà nulle.
      if (school.address !== null && school.address !== undefined) return false;
    } else {
      const next = parseAddress(body.address);
      const current = parseAddress(school.address);
      // Si l'un des deux côtés ne valide pas, on ne sait pas comparer : on refuse
      // de conclure au non-événement plutôt que de supprimer une vraie transition.
      if (next === null || current === null) return false;
      if (JSON.stringify(next) !== JSON.stringify(current)) return false;
    }
  }
  return true;
}

class CreateSchoolDto {
  @IsString() @MinLength(2) @MaxLength(200) name!: string;
  @IsString() @MinLength(2) @MaxLength(30) schoolCode!: string;
  @IsString() @Length(2, 2) country!: string;
  @IsOptional() @IsString() timezone?: string;
  @IsOptional() @IsString() locale?: string;
  /** Adresse géographique structurée de l'établissement (optionnelle). */
  @IsOptional() @IsObject() @ValidateNested() @Type(() => SchoolAddressDto)
  address?: SchoolAddressDto;
}

/**
 * S-E04-10 (PF-155 / AC-1) — `status` a été RETIRÉ de ce DTO, délibérément.
 *
 * Tant qu'il y figurait, `PATCH /schools/:id { status: 'closed' }` fermait un
 * établissement par `update()`, et fermait donc deux portes en une :
 *
 *  (a) il CONTOURNAIT le refus de `DELETE /schools/:id` (« Impossible de supprimer
 *      une école contenant des élèves ou des années scolaires », `remove()`
 *      ci-dessous) — la seule règle métier qui protège la fermeture ;
 *  (b) il CLASSAIT la fermeture sous le code `school.update` au lieu de
 *      `school.close`. Les deux codes sont `critical: true`
 *      (`packages/contracts/src/audit/vocabulary.ts`), donc le compteur
 *      « Modifications critiques » ne bougeait pas : c'est l'ATTRIBUTION qui était
 *      fausse, et un auditeur filtrant « Fermeture d'un établissement » obtenait un
 *      résultat vide pour ces fermetures-là.
 *
 * `main.ts:140-146` configure `whitelist: true, forbidNonWhitelisted: true`, donc
 * envoyer `status` est désormais un **400 explicite**, jamais un champ ignoré en
 * silence. La classe est exportée pour que ce refus soit prouvable au niveau du
 * pipe lui-même (`schools.controller.spec.ts`) : les tests unitaires du contrôleur
 * ne traversent aucun `ValidationPipe`, donc une assertion posée sur `update()`
 * serait verte sans que la garde puisse jamais tirer.
 *
 * CAPACITÉ PERDUE, ASSUMÉE : `PATCH { status: 'active' }` était aussi le seul
 * chemin de RÉOUVERTURE d'une école fermée. Il n'a jamais eu de code d'audit, ni
 * d'endpoint, ni d'UI, ni de test — il n'existait que comme trou dans ce DTO.
 * Aucun `school.reopen` n'est inventé ici (ajouter du vocabulaire est le seam de
 * `S-E04-4`) ; le manque est enregistré comme décision ouverte.
 */
export class UpdateSchoolDto {
  @IsOptional() @IsString() @MaxLength(200) name?: string;
  @IsOptional() @IsString() timezone?: string;
  @IsOptional() @IsString() locale?: string;
  /** Adresse géographique structurée de l'établissement (optionnelle, `null` = effacer). */
  @IsOptional() @IsObject() @ValidateNested() @Type(() => SchoolAddressDto)
  address?: SchoolAddressDto | null;
}

@ApiTags('schools')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('schools')
export class SchoolsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UserSyncService,
  ) {}

  /** List all schools belonging to caller's tenant. Phase 2D allows multiple. */
  @Get()
  @RequiresPermission('schools.read')
  async list(@CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    const schools = await this.prisma.school.findMany({
      where: { tenantId: me.tenantId },
      orderBy: { createdAt: 'asc' },
      include: {
        _count: {
          select: {
            students: true,
            academicYears: true,
          },
        },
      },
    });
    // Normalise le champ JSON `address` en objet structuré validé (ou null).
    return {
      data: schools.map((s) => ({
        ...s,
        address: parseAddress(s.address),
      })),
    };
  }

  /**
   * S-E04-6 — creation and its audit row, in ONE transaction.
   *
   * The duplicate check stays OUTSIDE: it is a read, and `schoolCode` is
   * globally unique, so the check races regardless of transaction placement —
   * the unique constraint is what actually decides. Posture recorded rather than
   * discovered in review: the 409 echoes the submitted code back, which is a
   * cross-tenant existence oracle on a globally unique column. Pre-existing, not
   * introduced here, and not silently changed inside an audit slice (`ADR-035`).
   */
  @Post()
  @RequiresPermission('schools.write')
  async create(
    @Body() body: CreateSchoolDto,
    @CurrentJwt() jwt: KeycloakJwtPayload,
    @Req() req: ClientHintsRequest,
  ) {
    const me = await this.users.ensureUser(jwt);
    const provenance = deriveAuditProvenance(jwt, extractAuditClientHints(req));
    // school_code must be globally unique (Prisma constraint)
    const dup = await this.prisma.school.findUnique({ where: { schoolCode: body.schoolCode } });
    if (dup) throw new ConflictException(`Code école « ${body.schoolCode} » déjà utilisé.`);

    const created = await this.prisma.$transaction(async (tx) => {
      const school = await tx.school.create({
        data: {
          tenantId: me.tenantId,
          name: body.name,
          schoolCode: body.schoolCode,
          country: body.country.toUpperCase(),
          timezone: body.timezone ?? 'Europe/Paris',
          locale: body.locale ?? 'fr-FR',
          ...(body.address ? { address: body.address as object } : {}),
        },
      });
      await writeAudit(tx, {
        tenantId: me.tenantId,
        actorId: me.id,
        action: 'school.create',
        resourceType: 'school',
        resourceId: school.id,
        provenance,
        after: {
          name: school.name,
          schoolCode: school.schoolCode,
          country: school.country,
          timezone: school.timezone,
          locale: school.locale,
        },
      });
      return school;
    });
    return { ...created, address: parseAddress(created.address) };
  }

  @Patch(':id')
  @RequiresPermission('schools.write')
  async update(
    @Param('id') id: string,
    @Body() body: UpdateSchoolDto,
    @CurrentJwt() jwt: KeycloakJwtPayload,
    @Req() req: ClientHintsRequest,
  ) {
    const me = await this.users.ensureUser(jwt);
    const provenance = deriveAuditProvenance(jwt, extractAuditClientHints(req));
    const school = await this.prisma.school.findUnique({ where: { id } });
    // G-TENANT — a foreign-tenant id is a 404 here, before the transaction opens,
    // so a refused request writes no row.
    if (!school || school.tenantId !== me.tenantId) throw new NotFoundException();

    // S-E04-10 (PF-158 / AC-8) — non-événement détecté APRÈS la garde de tenant et
    // AVANT l'ouverture de la transaction. Les deux moitiés de cette phrase sont
    // porteuses :
    //  · APRÈS la garde, sinon un `PATCH {}` sur un identifiant d'un autre tenant
    //    renverrait 200 avec le corps de l'école étrangère — un oracle de lecture
    //    inter-tenant créé par une correction de justesse (G-TENANT).
    //  · AVANT la transaction, parce que la règle est « une ligne d'audit = une
    //    vraie transition ». Envelopper `writeAudit` dans un `if` à l'intérieur de
    //    la transaction produirait le même compteur mais casserait l'invariant de
    //    forme dont dépendent l'extracteur AST du gate de vocabulaire et le
    //    ratchet `audit-write-check.js` : un appel = une instruction
    //    inconditionnelle, avec littéral inline (ADR-035 D1).
    // On renvoie l'entité existante NORMALISÉE comme le fait le chemin nominal —
    // un `return school;` brut renverrait `address` en JSON Prisma brut, soit un 200
    // au mauvais corps qu'aucune assertion sur les lignes d'audit ne verrait.
    if (isSchoolUpdateNoOp(body, school)) {
      return { ...school, address: parseAddress(school.address) };
    }

    // Extrait `address` séparément pour le caster en `object` (type attendu par Prisma Json).
    const { address, ...rest } = body;
    const updated = await this.prisma.$transaction(async (tx) => {
      const next = await tx.school.update({
        where: { id },
        data: {
          ...rest,
          // `null` efface explicitement ; `undefined` = pas de changement d'adresse.
          ...(address !== undefined
            ? { address: address === null ? Prisma.DbNull : (address as object) }
            : {}),
        },
      });
      await writeAudit(tx, {
        // The CALLER's tenant, never the target's — they are equal here only
        // because the guard above refused every case in which they would differ.
        tenantId: me.tenantId,
        actorId: me.id,
        action: 'school.update',
        resourceType: 'school',
        resourceId: id,
        provenance,
        before: {
          name: school.name,
          timezone: school.timezone,
          locale: school.locale,
          // S-E04-10 (AC-10) — `status` RESTE des deux côtés, en CONTEXTE assumé et
          // non par oubli. C'est l'état lisible au moment du changement : une
          // modification portée sur une école FERMÉE ne se lit pas comme la même
          // décision que sur une école ouverte, et `school.close` l'enregistre
          // aussi. Depuis AC-1 il est identique des deux côtés par construction —
          // `update()` ne peut plus le changer — ce qui est exactement pourquoi la
          // décision de le garder est écrite ici plutôt que devinée.
          status: school.status,
          // S-E04-10 (PF-159 / AC-9) — le cinquième champ, et le seul
          // structurellement intéressant que `update()` peut modifier ou EFFACER
          // (`Prisma.DbNull`). Sans lui, un PATCH d'adresse seule écrivait une ligne
          // `critical` dont le diff rendu était identique dans tous les champs
          // enregistrés — une modification critique au diff vide, sur le seul champ
          // dont cette ligne est l'unique témoin survivant.
          address: auditAddress(school.address),
        },
        after: {
          name: next.name,
          timezone: next.timezone,
          locale: next.locale,
          status: next.status,
          address: auditAddress(next.address),
        },
      });
      return next;
    });
    return { ...updated, address: parseAddress(updated.address) };
  }

  @Delete(':id')
  @RequiresPermission('schools.write')
  async remove(
    @Param('id') id: string,
    @CurrentJwt() jwt: KeycloakJwtPayload,
    @Req() req: ClientHintsRequest,
  ) {
    const me = await this.users.ensureUser(jwt);
    const provenance = deriveAuditProvenance(jwt, extractAuditClientHints(req));
    const school = await this.prisma.school.findUnique({
      where: { id },
      include: { _count: { select: { students: true, academicYears: true } } },
    });
    if (!school || school.tenantId !== me.tenantId) throw new NotFoundException();
    if (school._count.students > 0 || school._count.academicYears > 0) {
      throw new BadRequestException(
        'Impossible de supprimer une école contenant des élèves ou des années scolaires. Archivez-la plutôt.',
      );
    }
    // Soft-close instead of hard delete to preserve audit trail. The audit code is
    // therefore `school.close`, NOT `school.delete`: the row survives with
    // `status: 'closed'` and the vocabulary must not describe a deletion that did
    // not happen.
    return this.prisma.$transaction(async (tx) => {
      const closed = await tx.school.update({ where: { id }, data: { status: 'closed' } });
      await writeAudit(tx, {
        tenantId: me.tenantId,
        actorId: me.id,
        action: 'school.close',
        resourceType: 'school',
        resourceId: id,
        provenance,
        before: { name: school.name, schoolCode: school.schoolCode, status: school.status },
        after: { status: closed.status },
      });
      return closed;
    });
  }

  /**
   * Switch the caller's "active school" preference. Stored in
   * user_profile.preferences.activeSchoolId.
   *
   * S-E04-6 — DELIBERATELY NOT AUDITED, and deliberately NOT a member of the
   * « school mutation » family. It mutates `userProfile.preferences` — the
   * caller's own UI state — and no school row changes. Auditing it would fill the
   * governance trail with navigation, and calling it a school mutation would make
   * the family's coverage claim false in the other direction.
   */
  @Post(':id/switch')
  @RequiresPermission('schools.read')
  async switchActive(@Param('id') id: string, @CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    const school = await this.prisma.school.findUnique({ where: { id } });
    if (!school || school.tenantId !== me.tenantId) throw new NotFoundException();
    const prefs = (me.preferences as Record<string, unknown> | null) ?? {};
    await this.prisma.userProfile.update({
      where: { id: me.id },
      data: { preferences: { ...prefs, activeSchoolId: id } },
    });
    return { ok: true, activeSchoolId: id };
  }
}
