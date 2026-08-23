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
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { EnrollmentStatus, Prisma } from '@prisma/client';
import { IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

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
import { NotificationsService } from '../notifications/notifications.service';
import { TeacherProfileService } from '../teaching/teacher-profile.service';

/**
 * S-E05-14 / PF-278 / `ADR-063 §D3` — la projection de la liste d'appel.
 *
 * Ce sont les QUATRE colonnes que ce fichier PROJETTE DÉJÀ, dix-huit lignes plus
 * haut : `list` (:142) rend exactement `{ id, firstName, lastName, externalRef }`
 * pour chaque élève. La tranche n'invente donc aucune forme — elle ALIGNE
 * `roster` sur la forme que son propre contrôleur applique déjà, là où il
 * renvoyait la ligne `Student` ENTIÈRE (`medicalNotes`, `address`, `phone`,
 * `email`, `birthDate`, `gender`, `nationality`, `notes`, `customFields`).
 *
 * `externalRef` reste : c'est l'identifiant de scolarité qui désambiguïserait
 * des homonymes, et `list` le rend déjà à ses appelants.
 *
 * `photoUrl` est EXCLU délibérément (`ADR-062 §D1`, sur MESURE) : la seule
 * surface enseignant qui affiche une liste d'élèves aujourd'hui compose un
 * avatar d'INITIALES (`apps/web/src/app/teacher/classes/[id]/attendance/
 * AttendanceManager.tsx`), donc réintroduire une URL qui résout vers la
 * photographie de chaque enfant, à l'intérieur d'une tranche de MINIMISATION de
 * charge utile, contredirait la tranche.
 *
 * Module-locale et NON exportée : aucune projection PARTAGÉE entre modules n'est
 * introduite (`ADR-062 §D3`). La constante jumelle d'`attendance` n'est PAS
 * importée — deux modules, deux décisions, chacune révocable seule.
 */
const ENROLLMENT_ROSTER_STUDENT_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  externalRef: true,
} as const;

/**
 * S-E05-14 / PF-280 / `ADR-063 §D4` — la LECTURE DE GARDE, et la seule source
 * du `classSection` rendu.
 *
 * `roster` faisait un `classSection.findUnique` SANS `select`, puis renvoyait la
 * ligne telle quelle sous `classSection`. Cette ligne porte `internalNotes` —
 * du texte libre rédigé par l'administration À PROPOS de la classe — et
 * `options` (`Json`). Mesuré : `internalNotes` n'est écrit et lu que sous
 * `apps/web/src/app/admin/classes/*` et `school-structure/classes.controller.ts`.
 * C'est un champ ADMIN, et le livrer à tout enseignant dans la tranche même qui
 * minimise la charge utile serait la contradiction exacte que `photoUrl` évite.
 *
 * Ce n'est PAS une seconde décision : la forme en deux temps imposée par
 * `AC-1` (garde étroite → verdict → charge utile) DÉTRUIT structurellement
 * l'ancien `cls`, donc la tranche ne peut pas être livrée sans décider ce
 * qu'est le `classSection` de la réponse.
 *
 * `tenantId` est SÉLECTIONNÉ (la comparaison de tenant en dépend) mais n'est
 * PAS rendu : la réponse est recomposée champ par champ.
 */
const ENROLLMENT_ROSTER_CLASS_SECTION_SELECT = {
  id: true,
  tenantId: true,
  name: true,
  maxStudents: true,
} as const;

/* ══════════════════════════════════════════════════════════════════════════════
 * S-E05-14 / PF-278 / ADR-063 — LA COUCHE DE DÉCISION, EXPORTÉE ET PURE.
 *
 * `roster` (:531) ne portait qu'une comparaison de tenant. Avec
 * `enrollments.read` détenu par `school_admin`, `teacher` ET `parent`
 * (`permissions.constants.ts:168`, `:225`, `:259`), tout parent authentifié de
 * l'établissement pouvait énumérer N'IMPORTE QUELLE classe par son id et lire
 * la ligne `Student` entière de CHAQUE enfant qui s'y trouve. Une liste
 * d'appel est de la donnée de PAIRS — les autres enfants de la classe — jamais
 * le dossier d'un parent.
 *
 * FORME IMPOSÉE (maison, `attendance.controller.ts:154`, `lessons.controller.ts:114`) :
 * le contrôleur RÉSOUT l'identité, puis passe des VALEURS SIMPLES à une
 * fonction EXPORTÉE et PURE qui compare et lève. La fonction pure est ce que la
 * spec teste directement — pas de module de test Nest, pas de conteneur
 * d'injection. Aucun paramètre `bypass` / `allow` / `skip`, aucune variable
 * d'environnement : un contrôle qu'on peut éteindre n'est pas un contrôle
 * (`DNC-10`).
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * Le SEUL endroit de ce fichier qui nomme les deux rôles privilégiés.
 *
 * LIMITE CONNUE, HÉRITÉE ET ÉCRITE PLUTÔT QUE DÉCOUVERTE (`PF-268`) : c'est un
 * test sur le NOM d'un rôle de realm, alors que `PermissionsGuard` résout aussi
 * les rôles PERSONNALISÉS via `UserSyncService.effectivePermissions`
 * (`ADR-013`, `ADR-047` — les rôles custom sont globaux). Un rôle « vie
 * scolaire » qui détiendrait `enrollments.read` passerait le garde et serait
 * refusé ici. Le remède honnête est un code de permission dédié, hors de la
 * portée de cette tranche (`AC-9`).
 *
 * SUR LE NOMBRE D'APPELANTS VIVANTS : `attendance.controller.ts:133` enregistre
 * `select count(*) from role` → **0**, mesuré sur la pile locale le 2026-08-23.
 * C'est une CITATION de cette mesure, pas une seconde mesure : cet agent n'a
 * pas rouvert la base. Copier la phrase comme si elle était une observation
 * fraîche fabriquerait la preuve (`DNC-06`).
 */
export function isPrivilegedEnrollmentsCaller(roles: readonly string[]): boolean {
  return roles.includes('super_admin') || roles.includes('school_admin');
}

/** Un SEUL littéral pour le refus : deux copies dérivent, une copie ne dérive pas. */
const CLASS_ROSTER_REFUSAL = 'Vous ne pouvez consulter que la liste des élèves de vos classes.';

/**
 * `AC-3` + `AC-4` + `AC-7` — la liste d'appel de cette classe est-elle lisible
 * par cet appelant ? La règle ENTIÈRE, en un seul endroit, sur trois booléens.
 *
 * Les trois entrées sont prises en PARAMÈTRE même quand l'appelant sait déjà
 * que l'une d'elles est fausse : la fonction énonce la règle complète et se
 * teste sur les HUIT combinaisons — y compris `{ false, null, true }`,
 * impossible en production (le mur d'enseignement n'est pas interrogé sans
 * profil) et qui doit néanmoins LEVER.
 *
 * `teacherProfileId === null` est vérifié EN PREMIER et INDÉPENDAMMENT de
 * `teachesSection`, et rend le MÊME 403 : un appelant sans profil professeur
 * n'enseigne aucune classe par construction de la clé étrangère. La forme
 * inversée « `if (!isPrivileged && teacherProfileId && !teachesSection) throw` »
 * FAIL-OPEN sur un profil nul — c'est exactement le fail-open que `G-AUTHZ`
 * refuse, et il est écrit ici pour que personne ne le « simplifie » vers elle.
 *
 * Le message est de forme LECTURE (« consulter »), ne nomme ni tenant, ni
 * table, ni id, ni code Prisma (discipline `ADR-048 §D9`). Il ne réutilise pas
 * la copie d'`attendance` : ce n'est pas la même ressource.
 */
export function assertClassRosterReadable(decision: {
  readonly isPrivileged: boolean;
  readonly teacherProfileId: string | null;
  readonly teachesSection: boolean;
}): void {
  if (decision.isPrivileged) return;
  if (decision.teacherProfileId === null) {
    throw new ForbiddenException(CLASS_ROSTER_REFUSAL);
  }
  if (!decision.teachesSection) {
    throw new ForbiddenException(CLASS_ROSTER_REFUSAL);
  }
}

/**
 * `AC-3` + `AC-12` — le mur d'enseignement, en UNE instruction entièrement
 * SCALAIRE, et le type qui rend le fail-open INEXPRIMABLE.
 *
 * `teacherProfileId` est NON OPTIONNEL, délibérément. Prisma RETIRE les clés
 * `undefined` d'un `where` : écrit naïvement
 * `{ tenantId, classSectionId, teacherProfileId: tp?.id }` avec `tp === null`,
 * la requête devient « la première affectation de cette classe, à QUI QUE CE
 * SOIT » et l'appelant sans profil est ACCORDÉ. Le contrôleur doit donc rendre
 * son 403 AVANT que ce `where` existe — et la signature ci-dessous fait qu'il
 * ne peut pas faire autrement.
 *
 * `ADR-063 §D1` — POURQUOI AUCUNE CLAUSE D'ANNÉE SCOLAIRE ICI, ALORS QUE
 * `ADR-061 §D1` EN EXIGEAIT UNE. Le mur d'`attendance` est ÉLÈVE-clé : il
 * marche `professeur → affectations → classes → inscriptions → élève`, où
 * l'année est LIBRE, et comme `@@unique([teacherProfileId, classSectionId,
 * subjectId])` ne contient PAS `academicYearId`, une affectation SURVIT au
 * changement d'année et rejoindrait une inscription COURANTE. Ici les deux
 * côtés sont ancrés sur le MÊME `classSectionId`, et `ClassSection` est
 * elle-même épinglée à une année (`academicYearId` non nul, `@@unique(
 * [academicYearId, gradeLevelId, name])`, `schema.prisma:457`, `:478`) : l'id
 * de section fournit DÉJÀ l'année. Une affectation périmée pointe vers
 * l'ANCIENNE section — un autre id, dont la liste d'appel est l'ancienne.
 *
 * Pire, une clause d'année NUIRAIT :
 *  • `TeachingAssignment.academicYearId` est une colonne simple, sans clé
 *    étrangère composite vers `ClassSection.academicYearId` — les deux peuvent
 *    DIVERGER en données, et filtrer refuserait un professeur qui enseigne
 *    RÉELLEMENT la classe aujourd'hui ;
 *  • elle refuserait aussi un professeur consultant une section d'une année
 *    RÉVOLUE qu'il a authentiquement enseignée.
 * Précédent maison pour un contrôle section-clé : `announcements.controller.ts:1155`
 * — `{ tenantId, teacherProfileId, classSectionId }`, sans année.
 *
 * `findFirst` et non `findUnique` : un professeur peut détenir une affectation
 * PAR MATIÈRE sur la même section (la clé d'unicité inclut `subjectId`), donc
 * plusieurs lignes satisfont ce `where`. Seule leur EXISTENCE nous intéresse.
 *
 * `tenantId` est EXPLICITE et n'est pas redondant : les déploiements
 * d'aujourd'hui empruntent le chemin `degraded_no_app_url`, où la connexion du
 * PROPRIÉTAIRE échappe à ses propres policies RLS (`ADR-032 §D5` /
 * `ADR-042 §D1`). Cette clause est la SEULE chose qui filtre, et sans elle une
 * ligne d'affectation dérivée d'un autre tenant AUTORISERAIT.
 */
export function teacherOfSectionWhere(input: {
  readonly tenantId: string;
  readonly classSectionId: string;
  readonly teacherProfileId: string;
}): Prisma.TeachingAssignmentWhereInput {
  return {
    tenantId: input.tenantId,
    classSectionId: input.classSectionId,
    teacherProfileId: input.teacherProfileId,
  };
}

class CreateEnrollmentDto {
  @IsUUID() studentId!: string;
  @IsUUID() classSectionId!: string;
  @IsOptional() @IsEnum(EnrollmentStatus) status?: EnrollmentStatus;
}

class TransferEnrollmentDto {
  @IsUUID() toClassSectionId!: string;
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

class EndEnrollmentDto {
  @IsEnum(EnrollmentStatus) status!: EnrollmentStatus;
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

@ApiTags('enrollments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('enrollments')
export class EnrollmentsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UserSyncService,
    private readonly notifications: NotificationsService,
    /**
     * S-E05-14 — la RÉSOLUTION d'identité du mur d'enseignement de `roster`.
     * `TeachingModule` l'exporte déjà ; `EnrollmentsModule` l'importe, comme
     * `AttendanceModule` (`attendance.module.ts`). Aucun provider n'est ajouté.
     */
    private readonly teachers: TeacherProfileService,
  ) {}

  /** Fan-out: notify every active guardian of the student about the enrollment event. */
  private async notifyGuardiansOfEnrollment(args: {
    tenantId: string;
    studentId: string;
    enrollmentId: string;
    classSectionName: string;
    status: EnrollmentStatus;
    kind: 'created' | 'transferred' | 'ended';
  }): Promise<void> {
    try {
      const guardianships = await this.prisma.guardianship.findMany({
        where: {
          tenantId: args.tenantId,
          studentId: args.studentId,
          status: 'active',
          guardian: { userProfileId: { not: null } },
        },
        include: {
          guardian: { select: { userProfileId: true } },
          student: { select: { firstName: true } },
        },
      });
      const recipients = guardianships.filter((g) => g.guardian.userProfileId);
      if (recipients.length === 0) return;

      const titleByKind: Record<typeof args.kind, string> = {
        created: `Inscription confirmée — ${args.classSectionName}`,
        transferred: `Changement de classe — ${args.classSectionName}`,
        ended: `Fin d'inscription`,
      };
      const severityByKind: Record<typeof args.kind, 'success' | 'info' | 'warning'> = {
        created: 'success',
        transferred: 'info',
        ended: 'warning',
      };

      await this.notifications.createMany(
        recipients.map((g) => ({
          tenantId: args.tenantId,
          userProfileId: g.guardian.userProfileId!,
          kind: 'enrollment_status' as const,
          severity: severityByKind[args.kind],
          title: titleByKind[args.kind],
          body:
            args.kind === 'ended'
              ? `L'inscription de ${g.student.firstName} a pris fin.`
              : `${g.student.firstName} est désormais inscrit·e en « ${args.classSectionName} ».`,
          link: `/parent/children/${args.studentId}`,
          // Dedup key combines enrollmentId + status transition so a status flip
          // (active → ended → active) yields a fresh notification each time.
          sourceType: `enrollment_${args.kind}`,
          sourceId: args.enrollmentId,
        })),
      );
    } catch (err) {
       
      console.warn('[enrollments] notification fan-out failed', err);
    }
  }

  @Get()
  @RequiresPermission('enrollments.read')
  async list(
    @CurrentJwt() jwt: KeycloakJwtPayload,
    @Query('studentId') studentId?: string,
    @Query('classSectionId') classSectionId?: string,
    @Query('academicYearId') academicYearId?: string,
    @Query('status') status?: EnrollmentStatus,
  ) {
    const me = await this.users.ensureUser(jwt);
    const data = await this.prisma.enrollment.findMany({
      where: {
        tenantId: me.tenantId,
        ...(studentId ? { studentId } : {}),
        ...(classSectionId ? { classSectionId } : {}),
        ...(academicYearId ? { academicYearId } : {}),
        ...(status ? { status } : {}),
      },
      orderBy: [{ enrolledAt: 'desc' }],
      include: {
        student: { select: { id: true, firstName: true, lastName: true, externalRef: true } },
        classSection: { include: { gradeLevel: true } },
        academicYear: { select: { id: true, name: true, status: true } },
      },
    });
    return { data };
  }

  /**
   * S-E04-6 — the enrollment and its audit row commit together.
   *
   * TWO BOUNDARIES THAT MUST HOLD (`ADR-035` D5), both stated rather than
   * assumed by the next reader:
   *
   *  • The capacity check below reads `_count` OUTSIDE the transaction and STAYS
   *    there. Wrapping the write did NOT close that TOCTOU race — two concurrent
   *    requests can still both pass it and over-fill a class. Unchanged by this
   *    slice, and said out loud so nobody reads the new `$transaction` as a fix.
   *  • `notifyGuardiansOfEnrollment` stays AFTER the commit. It reads every
   *    guardianship and writes N notifications; inside the transaction, a large
   *    roster would blow Prisma's 5 s interactive-transaction timeout and roll
   *    back a valid enrollment, and its swallowed error would become a rollback
   *    trigger for the very thing it is best-effort about.
   */
  @Post()
  @RequiresPermission('enrollments.write')
  async create(
    @Body() body: CreateEnrollmentDto,
    @CurrentJwt() jwt: KeycloakJwtPayload,
    @Req() req: ClientHintsRequest,
  ) {
    const me = await this.users.ensureUser(jwt);
    const provenance = deriveAuditProvenance(jwt, extractAuditClientHints(req));
    const [student, classSection] = await Promise.all([
      this.prisma.student.findUnique({ where: { id: body.studentId } }),
      this.prisma.classSection.findUnique({
        where: { id: body.classSectionId },
        include: {
          academicYear: true,
          _count: { select: { enrollments: { where: { status: 'active' } } } },
        },
      }),
    ]);
    if (!student || student.tenantId !== me.tenantId) throw new NotFoundException('Élève introuvable');
    if (!classSection || classSection.tenantId !== me.tenantId)
      throw new NotFoundException('Classe introuvable');
    if (classSection.academicYear.status === 'archived') {
      throw new BadRequestException("Impossible d'inscrire dans une année archivée.");
    }
    if (classSection.status === 'closed') {
      throw new BadRequestException('Cette classe est fermée.');
    }
    if (classSection._count.enrollments >= classSection.maxStudents) {
      throw new ConflictException(
        `Capacité atteinte : la classe « ${classSection.name} » a déjà ${classSection.maxStudents} élèves inscrits.`,
      );
    }

    // Block double enrollment in the same academic year (active only).
    const conflict = await this.prisma.enrollment.findFirst({
      where: {
        tenantId: me.tenantId,
        studentId: body.studentId,
        academicYearId: classSection.academicYearId,
        status: 'active',
      },
      include: { classSection: { select: { name: true } } },
    });
    if (conflict) {
      throw new ConflictException(
        `L'élève est déjà inscrit en « ${conflict.classSection.name} » pour cette année. Utilisez « transférer » pour le changer de classe.`,
      );
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const enrollment = await tx.enrollment.create({
        data: {
          tenantId: me.tenantId,
          studentId: body.studentId,
          classSectionId: body.classSectionId,
          academicYearId: classSection.academicYearId,
          status: body.status ?? 'active',
          enrolledAt: new Date(),
        },
        include: {
          classSection: { include: { gradeLevel: true } },
          academicYear: true,
        },
      });
      await writeAudit(tx, {
        tenantId: me.tenantId,
        actorId: me.id,
        action: 'enrollment.create',
        resourceType: 'enrollment',
        resourceId: enrollment.id,
        provenance,
        after: {
          studentId: enrollment.studentId,
          classSectionId: enrollment.classSectionId,
          academicYearId: enrollment.academicYearId,
          status: enrollment.status,
        },
      });
      return enrollment;
    });

    // R8 fan-out — only notify guardians for active enrollments (skip pending).
    if (created.status === 'active') {
      await this.notifyGuardiansOfEnrollment({
        tenantId: me.tenantId,
        studentId: created.studentId,
        enrollmentId: created.id,
        classSectionName: created.classSection.name,
        status: created.status,
        kind: 'created',
      });
    }

    return created;
  }

  @Patch(':id')
  @RequiresPermission('enrollments.write')
  async update(
    @Param('id') id: string,
    @Body() body: EndEnrollmentDto,
    @CurrentJwt() jwt: KeycloakJwtPayload,
    @Req() req: ClientHintsRequest,
  ) {
    const me = await this.users.ensureUser(jwt);
    const provenance = deriveAuditProvenance(jwt, extractAuditClientHints(req));
    const enrollment = await this.prisma.enrollment.findUnique({
      where: { id },
      // S-E04-10 (PF-158) — MÊME `include` que l'écriture ci-dessous. Le retour
      // anticipé du non-événement doit reproduire la forme de réponse expédiée au
      // byte près : sans `classSection`, la correction deviendrait un 200 au
      // mauvais corps, exactement ce que le docblock de `transfer` interdit déjà
      // dans ce fichier, et qu'aucune assertion sur les lignes d'audit ne verrait.
      include: { classSection: { select: { name: true } } },
    });
    if (!enrollment || enrollment.tenantId !== me.tenantId) throw new NotFoundException();

    const isEnding = body.status !== 'active' && body.status !== 'pending';
    const becameActive = enrollment.status !== 'active' && body.status === 'active';

    // S-E04-10 (PF-158 / AC-8) — non-événement détecté APRÈS la garde de tenant et
    // AVANT l'ouverture de la transaction (voir `schools.controller.ts` pour le
    // pourquoi des deux moitiés : oracle inter-tenant d'un côté, forme d'appel
    // `writeAudit` inconditionnelle de l'autre — ADR-035 D1).
    //
    // LA SECONDE CLAUSE EST PORTEUSE, et un simple `body.status === status` serait
    // une PERTE DE DONNÉES : `:284` ne pose `endedAt`/`endReason` que lorsque
    // `isEnding && !enrollment.endedAt`. Une inscription créée directement dans un
    // statut terminal a donc `endedAt === null`, et un `PATCH { status: <même>,
    // reason }` horodate réellement la fin POUR LA PREMIÈRE FOIS — une vraie
    // transition, qui doit garder sa ligne. Le non-événement est le statut
    // identique ET la fin déjà horodatée.
    if (body.status === enrollment.status && !(isEnding && !enrollment.endedAt)) {
      return enrollment;
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const next = await tx.enrollment.update({
        where: { id },
        data: {
          status: body.status,
          ...(isEnding && !enrollment.endedAt ? { endedAt: new Date(), endReason: body.reason } : {}),
        },
        include: { classSection: { select: { name: true } } },
      });
      await writeAudit(tx, {
        tenantId: me.tenantId,
        actorId: me.id,
        action: 'enrollment.status_change',
        resourceType: 'enrollment',
        resourceId: id,
        provenance,
        before: { status: enrollment.status, endedAt: enrollment.endedAt?.toISOString() ?? null },
        after: {
          status: next.status,
          endedAt: next.endedAt?.toISOString() ?? null,
          endReason: next.endReason ?? null,
        },
      });
      return next;
    });

    if (becameActive || (isEnding && !enrollment.endedAt)) {
      await this.notifyGuardiansOfEnrollment({
        tenantId: me.tenantId,
        studentId: updated.studentId,
        enrollmentId: updated.id,
        classSectionName: updated.classSection.name,
        status: updated.status,
        kind: becameActive ? 'created' : 'ended',
      });
    }

    return updated;
  }

  /**
   * Transfer student from current active enrollment to a new class (same academic year).
   *
   * S-E04-6 — converted from the ARRAY `$transaction([...])` form to the
   * interactive one, because the array form exposes no `tx` client and therefore
   * cannot host the audit write at all.
   *
   * THE RESPONSE SHAPE IS UNCHANGED, ON PURPOSE. The array form resolved to the
   * two-element tuple `[closed, opened]`; the callback returns exactly that tuple,
   * in that order. A consumer reading `res[1].id` must keep working — a silent
   * drift here would be a 200 with the wrong body, which no test of the audit row
   * would ever catch. Pinned in `enrollments.controller.spec.ts`.
   *
   * ONE row, not two. The transfer is one decision; writing an
   * `enrollment.transfer` row per affected enrollment would leave an auditor with
   * two unlinked rows and no way to reconstruct the move. `resourceId` is the
   * CLOSED enrollment (the one the operator acted on); the opened one is named in
   * `after`.
   */
  @Post(':id/transfer')
  @RequiresPermission('enrollments.write')
  async transfer(
    @Param('id') id: string,
    @Body() body: TransferEnrollmentDto,
    @CurrentJwt() jwt: KeycloakJwtPayload,
    @Req() req: ClientHintsRequest,
  ) {
    const me = await this.users.ensureUser(jwt);
    const provenance = deriveAuditProvenance(jwt, extractAuditClientHints(req));
    const current = await this.prisma.enrollment.findUnique({
      where: { id },
      include: { classSection: { include: { academicYear: true } } },
    });
    if (!current || current.tenantId !== me.tenantId) throw new NotFoundException();
    if (current.status !== 'active') {
      throw new BadRequestException('Seule une inscription active peut être transférée.');
    }
    if (current.classSectionId === body.toClassSectionId) {
      throw new BadRequestException("L'élève est déjà dans cette classe.");
    }

    const target = await this.prisma.classSection.findUnique({
      where: { id: body.toClassSectionId },
      include: {
        academicYear: true,
        _count: { select: { enrollments: { where: { status: 'active' } } } },
      },
    });
    if (!target || target.tenantId !== me.tenantId) throw new NotFoundException('Classe cible introuvable');
    if (target.academicYearId !== current.academicYearId) {
      throw new BadRequestException('Le transfert doit rester dans la même année scolaire.');
    }
    if (target._count.enrollments >= target.maxStudents) {
      throw new ConflictException(`Capacité atteinte sur « ${target.name} ».`);
    }

    return this.prisma.$transaction(async (tx) => {
      const closed = await tx.enrollment.update({
        where: { id },
        data: {
          status: 'transferred_out',
          endedAt: new Date(),
          endReason: body.reason ?? `Transféré vers ${target.name}`,
        },
      });
      const opened = await tx.enrollment.create({
        data: {
          tenantId: me.tenantId,
          studentId: current.studentId,
          classSectionId: body.toClassSectionId,
          academicYearId: current.academicYearId,
          status: 'active',
        },
      });
      await writeAudit(tx, {
        tenantId: me.tenantId,
        actorId: me.id,
        action: 'enrollment.transfer',
        resourceType: 'enrollment',
        resourceId: closed.id,
        provenance,
        before: { classSectionId: current.classSectionId, status: current.status },
        after: {
          closedEnrollmentId: closed.id,
          openedEnrollmentId: opened.id,
          classSectionId: opened.classSectionId,
          reason: body.reason ?? null,
        },
      });
      // The array form's resolved value, byte-for-byte. Do not "tidy" this into
      // an object — it is the shipped response body.
      return [closed, opened];
    });
  }

  /**
   * S-E04-6 — cancellation and its audit row commit together, on BOTH branches.
   *
   * The `pending` branch HARD-deletes. `AuditLog` has no FK to `Enrollment` (and
   * none is added here — PF-96's posture is stated in `ADR-035`, not changed), so
   * the row will point at an id that no longer resolves. `before` therefore
   * carries the full payload: after the delete, the audit row is the only record
   * that the enrollment ever existed.
   */
  @Delete(':id')
  @RequiresPermission('enrollments.delete')
  async remove(
    @Param('id') id: string,
    @CurrentJwt() jwt: KeycloakJwtPayload,
    @Req() req: ClientHintsRequest,
  ) {
    const me = await this.users.ensureUser(jwt);
    const provenance = deriveAuditProvenance(jwt, extractAuditClientHints(req));
    const enrollment = await this.prisma.enrollment.findUnique({ where: { id } });
    if (!enrollment || enrollment.tenantId !== me.tenantId) throw new NotFoundException();
    // Allow hard-delete only when status is pending. Otherwise mark as dropped (soft).
    if (enrollment.status === 'pending') {
      await this.prisma.$transaction(async (tx) => {
        await tx.enrollment.delete({ where: { id } });
        await writeAudit(tx, {
          tenantId: me.tenantId,
          actorId: me.id,
          action: 'enrollment.cancel',
          resourceType: 'enrollment',
          resourceId: id,
          provenance,
          before: {
            studentId: enrollment.studentId,
            classSectionId: enrollment.classSectionId,
            academicYearId: enrollment.academicYearId,
            status: enrollment.status,
            enrolledAt: enrollment.enrolledAt.toISOString(),
            hardDeleted: true,
          },
        });
      });
      return { ok: true, deleted: true };
    }
    // S-E04-10 (PF-158 / AC-8) — non-événement, APRÈS la garde de tenant, AVANT la
    // transaction. Ce qui est gardé ici est l'ÉCRASEMENT DE L'HORODATAGE, pas le
    // changement de statut : une inscription déjà `dropped` ET déjà horodatée ne
    // change rien. Une inscription `dropped` dont `endedAt` est encore nul est en
    // revanche une vraie première annulation et garde sa ligne.
    if (enrollment.status === 'dropped' && enrollment.endedAt !== null) {
      return enrollment;
    }
    return this.prisma.$transaction(async (tx) => {
      const dropped = await tx.enrollment.update({
        where: { id },
        data: {
          status: 'dropped',
          // S-E04-10 (PF-157, cinquième site) — même forme conditionnelle que
          // `update()` à `:284`. L'écriture inconditionnelle poussait `endedAt` sur
          // l'horloge de l'annulation ADMINISTRATIVE alors que l'inscription avait
          // déjà une fin — celle d'un `transferred_out` ou d'un `completed` — et
          // effaçait donc la date à laquelle la scolarité s'est réellement
          // terminée. Un `DELETE` sur une inscription non terminale reste une vraie
          // transition et garde sa ligne ; c'est la date d'origine qui est
          // préservée, pas la ligne d'audit qui est supprimée.
          ...(enrollment.endedAt ? {} : { endedAt: new Date(), endReason: 'Annulation administrative' }),
        },
      });
      await writeAudit(tx, {
        tenantId: me.tenantId,
        actorId: me.id,
        action: 'enrollment.cancel',
        resourceType: 'enrollment',
        resourceId: id,
        provenance,
        // `endedAt` des deux côtés pour que la PRÉSERVATION soit lisible dans la
        // trace : sans lui, la ligne n'enregistrait que `status` + `hardDeleted` et
        // un écrasement d'horodatage y était invisible.
        before: {
          status: enrollment.status,
          endedAt: enrollment.endedAt?.toISOString() ?? null,
          hardDeleted: false,
        },
        after: {
          status: dropped.status,
          endedAt: dropped.endedAt?.toISOString() ?? null,
          endReason: dropped.endReason ?? null,
        },
      });
      return dropped;
    });
  }

  /**
   * S-E05-14 / PF-278 / ADR-063 — la liste d'appel d'une classe : QUI la lit,
   * DANS QUEL ORDRE on refuse, et CE QUI part sur le fil.
   *
   * CE QUI S'EXÉCUTE (`DNC-06` — le commentaire précédent disait « useful for
   * the teacher portal », ce qui était FAUX : recensement des consommateurs
   * relancé le 2026-08-23, `grep -rn "enrollments/roster" apps/ packages/` →
   * code de sortie 1, **ZÉRO appelant de première partie** sur les quatre
   * portails. Décrire un souhait au lieu du runtime est la violation ; la
   * phrase est corrigée, pas conservée) :
   *
   *  1. `ParseUUIDPipe` refuse un id malformé en phase PIPE — donc AVANT toute
   *     lecture de base. Aujourd'hui il atteignait une colonne `@db.Uuid` et
   *     rendait `P2023` → 500 (`PF-51`, avancé ICI sur UN SEUL site — partiel,
   *     jamais clos).
   *  2. Lecture de GARDE, `select` seulement : classe absente OU d'un autre
   *     tenant → 404 NU. Le 404 vient EN PREMIER et le court-circuit privilégié
   *     ne le saute PAS — inverser l'ordre ferait du 403 un oracle d'existence
   *     sur les ids de classe d'un AUTRE tenant (`ADR-048 §D9`, `ADR-061`), y
   *     compris pour un `super_admin` du tenant A visant le tenant B.
   *  3. Verdict de PROPRIÉTÉ : privilégié (`super_admin` / `school_admin`), ou
   *     professeur portant une `TeachingAssignment` sur CETTE section. Tout le
   *     reste — `parent` inclus, et un appelant sans profil professeur — → 403.
   *  4. Seulement ENSUITE la charge utile. AUCUNE donnée d'enfant n'est
   *     matérialisée pour un appelant refusé.
   *
   * CE QUI PART SUR LE FIL : quatre colonnes par élève
   * (`ENROLLMENT_ROSTER_STUDENT_SELECT`) au lieu de la ligne `Student`
   * ENTIÈRE, et un `classSection` recomposé `{ id, name, maxStudents }` au lieu
   * de la ligne `ClassSection` entière (`internalNotes`, `options`).
   * `enrollments`, `capacity` et le tri `student.lastName` ascendant sont
   * INCHANGÉS.
   *
   * `enrollments.read` n'est PAS retiré du catalogue `parent` : le portail
   * parent lit légitimement l'inscription de SON enfant via `list` (:122). La
   * dérive de catalogue est l'histoire de `PF-264` / `PF-53`, pas celle-ci.
   *
   * CE QUE CETTE TRANCHE NE FERME PAS (`ADR-063 §D6`) : `GET /enrollments?
   * classSectionId=<id>` (:122) porte la MÊME permission, dans le MÊME
   * contrôleur, SANS ABAC. `PF-278` est clos sur ce HANDLER, pas sur la CLASSE
   * d'exposition — l'énumération de pairs par la route de liste survit et est
   * enregistrée en `PF-283` (arbitrage d'id : `ADR-063`, §« Id arbitration »).
   */
  @Get('roster/:classSectionId')
  @RequiresPermission('enrollments.read')
  async roster(
    @Param('classSectionId', ParseUUIDPipe) classSectionId: string,
    @CurrentJwt() jwt: KeycloakJwtPayload,
  ) {
    const me = await this.users.ensureUser(jwt);
    const cls = await this.prisma.classSection.findUnique({
      where: { id: classSectionId },
      select: ENROLLMENT_ROSTER_CLASS_SECTION_SELECT,
    });
    if (!cls || cls.tenantId !== me.tenantId) throw new NotFoundException();
    await this.assertSectionOwnership(classSectionId, me, jwt);

    const enrollments = await this.prisma.enrollment.findMany({
      where: { classSectionId, status: 'active', tenantId: me.tenantId },
      include: { student: { select: ENROLLMENT_ROSTER_STUDENT_SELECT } },
      orderBy: { student: { lastName: 'asc' } satisfies Prisma.StudentOrderByWithRelationInput },
    });
    return {
      classSection: { id: cls.id, name: cls.name, maxStudents: cls.maxStudents },
      enrollments,
      capacity: { current: enrollments.length, max: cls.maxStudents },
    };
  }

  /**
   * S-E05-14 — la RÉSOLUTION d'identité du chemin de LECTURE de `roster`.
   *
   * Lecture seule (`findForUser`, `teacher-profile.service.ts:94`), JAMAIS
   * `ensureForUser` : un refus ne doit PROVISIONNER rien — `ensureForUser` est
   * un UPSERT, et le placer sur un chemin de refus créerait une ligne
   * `TeacherProfile` pour chaque parent qui tente une énumération
   * (`PF-265` / `ADR-051 §D1`).
   *
   * Le court-circuit privilégié saute les DEUX requêtes : un administrateur n'a
   * ni profil professeur ni affectation, et ne pas les demander est deux
   * instructions de moins sur le chemin admin. Il ne saute PAS la lecture de
   * garde — celle-ci a déjà rendu son 404 avant qu'on arrive ici.
   *
   * L'ORDRE DES TROIS LIGNES EST LE CONTRÔLE : le profil nul rend son 403 dans
   * `assertClassRosterReadable` AVANT que `teacherOfSectionWhere` soit
   * construit, parce que le type de ce dernier n'accepte pas `undefined` (voir
   * son docblock : Prisma retire les clés `undefined` d'un `where`, ce qui
   * transformerait le mur en fail-open).
   */
  private async assertSectionOwnership(
    classSectionId: string,
    me: { id: string; tenantId: string },
    jwt: KeycloakJwtPayload,
  ): Promise<void> {
    const isPrivileged = isPrivilegedEnrollmentsCaller(jwt.realm_access?.roles ?? []);
    if (isPrivileged) {
      assertClassRosterReadable({ isPrivileged: true, teacherProfileId: null, teachesSection: false });
      return;
    }
    const tp = await this.teachers.findForUser(me);
    if (tp === null) {
      assertClassRosterReadable({ isPrivileged: false, teacherProfileId: null, teachesSection: false });
      return;
    }
    const assignment = await this.prisma.teachingAssignment.findFirst({
      where: teacherOfSectionWhere({
        tenantId: me.tenantId,
        classSectionId,
        teacherProfileId: tp.id,
      }),
      select: { id: true },
    });
    assertClassRosterReadable({
      isPrivileged: false,
      teacherProfileId: tp.id,
      teachesSection: assignment !== null,
    });
  }
}
