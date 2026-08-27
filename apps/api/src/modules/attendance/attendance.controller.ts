import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { guardianshipLiveWhere } from '@pilotage/contracts';
import { AttendanceStatus, type Prisma } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Matches,
  ValidateNested,
} from 'class-validator';

import { CurrentJwt } from '../../shared/auth/current-user.decorator';
import { JwtAuthGuard } from '../../shared/auth/jwt-auth.guard';
import { type KeycloakJwtPayload } from '../../shared/auth/jwt.strategy';
import { PermissionsGuard } from '../../shared/auth/permissions.guard';
import { RequiresPermission } from '../../shared/auth/requires-permission.decorator';
import { UserSyncService } from '../../shared/auth/user-sync.service';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { TeacherProfileService } from '../teaching/teacher-profile.service';

/**
 * S-E05-6 / `PF-269` — la PROJECTION d'une ligne de liste d'appel.
 *
 * `student: true` rendait la ligne `Student` ENTIÈRE — `medicalNotes`,
 * `address`, `notes`, `customFields`, `birthDate`, `email`, `phone` — pour
 * chaque enfant de la classe, à chaque chargement. `S-E05-5` a restreint QUI
 * lit ; cette constante restreint CE QUI est rendu (`GUARDRAILS` §1).
 *
 * `externalRef` est retenu : c'est le matricule de l'établissement, et le type
 * du consommateur le déclare déjà (`AttendanceManager.tsx:12`) ; c'est
 * l'identifiant qui désambiguïserait des homonymes SI la liste le rendait —
 * aujourd'hui elle ne l'affiche pas (`AttendanceManager.tsx` ne le lit qu'au
 * niveau du type, jamais du JSX).
 *
 * `photoUrl` est EXCLU délibérément : rien dans l'espace enseignant ne
 * l'affiche (l'avatar est composé des initiales, `AttendanceManager.tsx:220`).
 *
 * Module-local et NON exportée : cette tranche n'introduit AUCUNE projection
 * partagée entre modules (`ADR-062 §D3`).
 */
const ATTENDANCE_ROSTER_STUDENT_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  externalRef: true,
} as const;

class OpenSessionDto {
  @IsUUID() teachingAssignmentId!: string;
  @IsDateString() date!: string;
  @IsOptional() @IsString() @Matches(/^\d{1,2}:\d{2}$/) startTime?: string;
  @IsOptional() @IsString() @Matches(/^\d{1,2}:\d{2}$/) endTime?: string;
  @IsOptional() @IsString() @MaxLength(200) topic?: string;
  @IsOptional() @IsBoolean() cancelled?: boolean;
}

class AttendanceItem {
  @IsUUID() studentId!: string;
  @IsEnum(AttendanceStatus) status!: AttendanceStatus;
  @IsOptional() @IsString() @Matches(/^\d{1,2}:\d{2}$/) arrivedAt?: string;
  @IsOptional() @IsString() @MaxLength(300) comment?: string;
}

class BatchAttendanceDto {
  @IsUUID() classSessionId!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({ each: true })
  @Type(() => AttendanceItem)
  records!: AttendanceItem[];
}

class JustifyDto {
  @IsString() @MaxLength(500) justification!: string;
}

/* ══════════════════════════════════════════════════════════════════════════════
 * S-E05-5 / PF-07 / ADR-061 — LA COUCHE DE DÉCISION, EXPORTÉE ET PURE.
 *
 * Les QUATRE handlers de LECTURE de ce contrôleur (`sessionDetail`, `roster`,
 * `studentAttendance`, `overview`) ne portaient qu'un contrôle de tenant. Leurs
 * frères d'ÉCRITURE (`listSessions`, `openSession`, `batch`) exigent la
 * propriété depuis toujours via `assertOwnership` (:451). Cette tranche donne
 * aux lectures l'ABAC que les écritures avaient déjà.
 *
 * FORME IMPOSÉE (maison, `lessons.controller.ts:114` `assertOwnedByTeacher`) :
 * le contrôleur RÉSOUT l'identité (une requête), puis passe des VALEURS SIMPLES
 * à une fonction EXPORTÉE et PURE qui compare et lève. La fonction pure est ce
 * que la spec teste directement — pas de module de test Nest, pas de conteneur
 * d'injection. Aucun paramètre `bypass` / `allow` / `skip`, aucune variable
 * d'environnement : un contrôle qu'on peut éteindre n'est pas un contrôle
 * (`DNC-10`).
 * ══════════════════════════════════════════════════════════════════════════ */

/** Le contexte d'autorisation de l'appelant, résolu DEHORS, comparé PUREMENT. */
export interface AttendanceReadContext {
  /** `super_admin` / `school_admin` : la propriété n'est pas exigée d'eux. */
  readonly isPrivileged: boolean;
  /** `null` = l'appelant n'a AUCUN profil professeur (donc aucune séance). */
  readonly teacherProfileId: string | null;
}

/**
 * Le SEUL endroit qui nomme les deux rôles privilégiés de ce contrôleur.
 * Identique au court-circuit pré-existant d'`assertOwnership`.
 *
 * LIMITE CONNUE, ÉCRITE PLUTÔT QUE DÉCOUVERTE (`PF-268`) : c'est un test sur le
 * NOM d'un rôle de realm, alors que `PermissionsGuard` résout aussi les rôles
 * PERSONNALISÉS via `UserSyncService.effectivePermissions` (`ADR-013`,
 * `ADR-047` — les rôles custom sont globaux). Un rôle « vie scolaire » qui
 * détiendrait `attendance.read` passerait le garde et serait refusé ici. Le
 * remède honnête est un code de permission dédié, que `AC-9` interdit dans
 * cette tranche. Mesuré le 2026-08-23 sur la pile locale : `select count(*)
 * from role` → **0**, donc zéro appelant vivant est concerné aujourd'hui.
 */
export function isPrivilegedAttendanceCaller(roles: readonly string[]): boolean {
  return roles.includes('super_admin') || roles.includes('school_admin');
}

/**
 * `AC-1` + `AC-2` — la séance appartient-elle à l'appelant ?
 *
 * `teacherProfileId === null` rend le MÊME 403 : un appelant sans profil
 * professeur ne possède aucune séance par construction de la clé étrangère.
 * Le traduire en 404 ou en 500 serait un changement de sémantique de refus
 * déguisé en refactor — et un `null` traité comme « laisser passer » serait
 * exactement le fail-open que `G-AUTHZ` refuse.
 *
 * UN SEUL message, partagé par `sessionDetail` et `roster` (`AC-2` dit *même*
 * message). Il ne réutilise PAS celui d'`assertOwnership` (« ouvrir une
 * séance ») : ce dernier est de forme ÉCRITURE, et
 * `teacher/classes/[id]/attendance/actions.ts:28` remonte `body.message`
 * VERBATIM à l'écran du professeur — on ne dit pas à quelqu'un qui LIT qu'il ne
 * peut pas OUVRIR. Il ne nomme ni tenant, ni table, ni code Prisma, ni id
 * (discipline `ADR-048 §D9`).
 */
export function assertSessionReadable(
  context: AttendanceReadContext,
  sessionTeacherProfileId: string,
): void {
  if (context.isPrivileged) return;
  if (
    context.teacherProfileId === null ||
    sessionTeacherProfileId !== context.teacherProfileId
  ) {
    throw new ForbiddenException('Vous ne pouvez consulter que les séances de vos affectations.');
  }
}

/** `AC-5` — la vue ÉTABLISSEMENT est réservée à l'administration. */
export function assertEstablishmentOverviewReadable(context: {
  readonly isPrivileged: boolean;
}): void {
  if (!context.isPrivileged) {
    throw new ForbiddenException(
      "La vue d'ensemble de l'assiduité est réservée à l'administration de l'établissement.",
    );
  }
}

/**
 * `AC-3` — l'assiduité d'UN élève. La règle COMPLÈTE, en un seul endroit.
 *
 * `ForbiddenException` **NUE, sans message** : byte-identique au refus parent
 * pré-existant (:361), que `AC-4` gèle. Y ajouter un message serait un
 * changement de copie produit sur les trois pages du portail parent.
 *
 * Les trois entrées sont prises en PARAMÈTRE même quand l'appelant sait déjà
 * que l'une d'elles est fausse : la fonction énonce la règle entière et se
 * teste sur les huit triplets booléens.
 */
export function assertStudentAttendanceReadable(decision: {
  readonly isPrivileged: boolean;
  readonly isGuardian: boolean;
  readonly teachesStudent: boolean;
}): void {
  if (decision.isPrivileged || decision.isGuardian || decision.teachesStudent) return;
  throw new ForbiddenException();
}

/**
 * `AC-3` + `AC-8` — premier des DEUX `where` du mur d'enseignement.
 *
 * ADR-061 §D1 — POURQUOI DEUX INSTRUCTIONS ET NON UNE. La plateforme répond
 * déjà DEUX fois à « ce professeur enseigne-t-il à cet élève ? »
 * (`messaging.service.ts:90`, `remediation.service.ts:912`), et les deux
 * CONTRAIGNENT L'ANNÉE SCOLAIRE : inscription active dans l'année **active**,
 * puis affectation sur le couple `(classSectionId, academicYearId)` de CETTE
 * inscription. La contrainte n'est pas cosmétique : l'unicité de
 * `TeachingAssignment` est `@@unique([teacherProfileId, classSectionId,
 * subjectId])` — `academicYearId` n'est PAS dans la clé — donc les affectations
 * SURVIVENT au changement d'année. Sans le couple, un professeur qui a eu
 * `6ème B` il y a deux ans lirait l'assiduité courante de cette classe. Prisma
 * ne sait pas corréler `classSection.teachingAssignments.some.academicYearId`
 * à `enrollment.academicYearId` dans un seul `where` : le couple exige une
 * seconde instruction, exactement comme les deux copies existantes.
 *
 * La clause relationnelle `classSection.teachingAssignments.some` est conservée
 * ici (forme épinglée par la story) : elle PRÉ-FILTRE sur les classes que
 * l'appelant enseigne, année confondue, et elle est vérifiée telle quelle par
 * la spec. Elle n'est pas suffisante seule — c'est la seconde instruction qui
 * ferme l'année.
 *
 * **Les DEUX `tenantId` sont explicites et aucun n'est redondant.** Les
 * déploiements d'aujourd'hui empruntent le chemin `degraded_no_app_url`, où la
 * connexion du PROPRIÉTAIRE échappe à ses propres policies RLS
 * (`ADR-032 §D5` / `ADR-042 §D1`) : ces clauses sont la SEULE chose qui filtre.
 *
 * Le chemin relationnel est `Enrollment.classSection → ClassSection.
 * teachingAssignments → TeachingAssignment.teacherProfileId`
 * (`schema.prisma:666`, `:474`, `:1009`) — vérifié contre le schéma.
 */
export function teacherOfStudentWhere(input: {
  readonly tenantId: string;
  readonly studentId: string;
  readonly teacherProfileId: string;
}): Prisma.EnrollmentWhereInput {
  return {
    tenantId: input.tenantId,
    studentId: input.studentId,
    status: 'active',
    academicYear: { status: 'active' },
    classSection: {
      teachingAssignments: {
        some: { tenantId: input.tenantId, teacherProfileId: input.teacherProfileId },
      },
    },
  };
}

/**
 * `AC-3` + `AC-8` — second `where` du mur d'enseignement : le couple
 * `(classSectionId, academicYearId)` de l'inscription retenue, épinglé sur
 * l'appelant. C'est CE `where` qui interdit au professeur d'une année révolue
 * de lire l'assiduité courante (ADR-061 §D1).
 *
 * DIVERGENCE ASSUMÉE avec les deux copies existantes, et elle est déclarée
 * plutôt que découverte : elles joignent `teacherProfile: { userProfileId }`
 * parce qu'elles reçoivent un id de `UserProfile` ; ici `AC-6` impose
 * `TeacherProfileService.findForUser`, qui rend un id de `TeacherProfile`, donc
 * la comparaison est directe. Les deux jointures sont équivalentes.
 *
 * NE PAS copier le `try/catch → false` des deux copies : `PF-248` enregistre
 * déjà cette forme comme un défaut (une panne d'infrastructure se présente
 * alors comme un refus ABAC authentique, indiagnosticable). Ici les erreurs
 * remontent.
 */
export function teacherOfStudentAssignmentWhere(input: {
  readonly tenantId: string;
  readonly classSectionId: string;
  readonly academicYearId: string;
  readonly teacherProfileId: string;
}): Prisma.TeachingAssignmentWhereInput {
  return {
    tenantId: input.tenantId,
    classSectionId: input.classSectionId,
    academicYearId: input.academicYearId,
    teacherProfileId: input.teacherProfileId,
  };
}

@ApiTags('attendance')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller()
export class AttendanceController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UserSyncService,
    private readonly teachers: TeacherProfileService,
  ) {}

  // -------- Class sessions --------

  /**
   * List past class sessions for a teaching assignment with per-session
   * attendance counts. Used by the teacher attendance workspace to show
   * historic sessions + student-leaderboard data. Sorted by date desc.
   */
  @Get('class-sessions')
  @RequiresPermission('class_sessions.read')
  async listSessions(
    @Query('teachingAssignmentId') teachingAssignmentId: string | undefined,
    @Query('limit') limitStr: string | undefined,
    @CurrentJwt() jwt: KeycloakJwtPayload,
  ) {
    if (!teachingAssignmentId) {
      throw new BadRequestException('teachingAssignmentId requis.');
    }
    const me = await this.users.ensureUser(jwt);
    const a = await this.prisma.teachingAssignment.findUnique({
      where: { id: teachingAssignmentId },
      include: {
        classSection: {
          include: {
            enrollments: {
              where: { status: 'active' },
              select: { studentId: true },
            },
          },
        },
      },
    });
    if (!a || a.tenantId !== me.tenantId) throw new NotFoundException('Affectation introuvable.');
    await this.assertOwnership(a.teacherProfileId, me, jwt);

    const parsedLimit = parseInt(limitStr ?? '200', 10);
    const limit = Number.isFinite(parsedLimit)
      ? Math.min(Math.max(parsedLimit, 1), 500)
      : 200;

    const sessions = await this.prisma.classSession.findMany({
      where: { tenantId: me.tenantId, teachingAssignmentId: a.id },
      orderBy: { date: 'desc' },
      take: limit,
      include: {
        attendanceRecords: {
          select: { status: true, studentId: true, justification: true },
        },
      },
    });

    // Per-student leaderboard from the windowed sessions.
    const studentStats = new Map<
      string,
      { absent: number; absentExcused: number; late: number; leftEarly: number; sessions: number }
    >();
    for (const s of sessions) {
      const seenInSession = new Set<string>();
      for (const r of s.attendanceRecords) {
        seenInSession.add(r.studentId);
        const cur = studentStats.get(r.studentId) ?? {
          absent: 0,
          absentExcused: 0,
          late: 0,
          leftEarly: 0,
          sessions: 0,
        };
        if (r.status === 'absent') cur.absent += 1;
        else if (r.status === 'absent_excused') cur.absentExcused += 1;
        else if (r.status === 'late') cur.late += 1;
        else if (r.status === 'left_early') cur.leftEarly += 1;
        studentStats.set(r.studentId, cur);
      }
      for (const studentId of seenInSession) {
        const cur = studentStats.get(studentId)!;
        cur.sessions += 1;
      }
    }

    const studentIds = Array.from(studentStats.keys());
    const students = studentIds.length
      ? await this.prisma.student.findMany({
          where: { id: { in: studentIds }, tenantId: me.tenantId },
          select: { id: true, firstName: true, lastName: true, externalRef: true },
        })
      : [];

    return {
      classSize: a.classSection.enrollments.length,
      sessions: sessions.map((s) => {
        const counts = s.attendanceRecords.reduce(
          (acc, r) => {
            acc[r.status] = (acc[r.status] ?? 0) + 1;
            return acc;
          },
          {} as Record<string, number>,
        );
        const unjustifiedAbsences = s.attendanceRecords.filter(
          (r) => r.status === 'absent' && (!r.justification || r.justification.trim() === ''),
        ).length;
        return {
          id: s.id,
          date: s.date,
          startTime: s.startTime,
          endTime: s.endTime,
          topic: s.topic,
          cancelled: s.cancelled,
          recordedTotal: s.attendanceRecords.length,
          counts: {
            present: counts.present ?? 0,
            absent: counts.absent ?? 0,
            absentExcused: counts.absent_excused ?? 0,
            late: counts.late ?? 0,
            leftEarly: counts.left_early ?? 0,
          },
          unjustifiedAbsences,
        };
      }),
      students: students.map((st) => ({
        ...st,
        stats: studentStats.get(st.id) ?? {
          absent: 0,
          absentExcused: 0,
          late: 0,
          leftEarly: 0,
          sessions: 0,
        },
      })),
    };
  }

  /** Opens (or returns existing) the session for a (teachingAssignment, date) — idempotent. */
  @Post('class-sessions/open')
  @RequiresPermission('class_sessions.write')
  async openSession(@Body() body: OpenSessionDto, @CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    const a = await this.prisma.teachingAssignment.findUnique({
      where: { id: body.teachingAssignmentId },
    });
    if (!a || a.tenantId !== me.tenantId) throw new NotFoundException('Affectation introuvable.');
    await this.assertOwnership(a.teacherProfileId, me, jwt);

    const date = new Date(body.date);
    const existing = await this.prisma.classSession.findFirst({
      where: { teachingAssignmentId: a.id, date },
    });
    if (existing) {
      return this.prisma.classSession.update({
        where: { id: existing.id },
        data: {
          startTime: body.startTime ?? existing.startTime,
          endTime: body.endTime ?? existing.endTime,
          topic: body.topic ?? existing.topic,
          cancelled: body.cancelled ?? existing.cancelled,
        },
      });
    }
    return this.prisma.classSession.create({
      data: {
        tenantId: me.tenantId,
        teachingAssignmentId: a.id,
        teacherProfileId: a.teacherProfileId,
        date,
        startTime: body.startTime,
        endTime: body.endTime,
        topic: body.topic,
        cancelled: body.cancelled ?? false,
      },
    });
  }

  /**
   * S-E05-5 / `AC-1` — SCINDÉ EN REQUÊTE DE GARDE PUIS REQUÊTE DE CHARGE.
   *
   * L'`include` profond ci-dessous EST la lecture coûteuse : il matérialise la
   * classe ENTIÈRE — une ligne par inscription active, plus tous les
   * `AttendanceRecord`, la `ClassSection` et la `TeachingAssignment`. La
   * matérialiser dans le processus pour un appelant qu'on s'apprête à refuser
   * est le défaut, pas un détail d'ordonnancement. La garde ne lit donc que
   * TROIS colonnes scalaires, et la charge n'est émise qu'après le verdict.
   *
   * S-E05-6 / `PF-269` — la LARGEUR de cette charge a changé depuis S-E05-5 :
   * les lignes `Student` ne sont plus COMPLÈTES. Elles sont projetées sur
   * `ATTENDANCE_ROSTER_STUDENT_SELECT` (quatre champs), donc `medicalNotes`,
   * `address`, `notes` et `customFields` ne sont plus émis du tout. Le NOMBRE
   * de lignes, lui, est inchangé : c'est lui qui justifie encore la scission.
   *
   * ORDRE DE REFUS (`AC-10`, `ADR-048 §D9`) : 404 d'abord (tenant / existence),
   * 403 ensuite (propriété). L'inverser ferait du 403 un oracle d'existence sur
   * les ids de séance d'un AUTRE tenant.
   */
  @Get('class-sessions/:id')
  @RequiresPermission('class_sessions.read')
  async sessionDetail(@Param('id') id: string, @CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    const guard = await this.prisma.classSession.findUnique({
      where: { id },
      select: { id: true, tenantId: true, teacherProfileId: true },
    });
    if (!guard || guard.tenantId !== me.tenantId) throw new NotFoundException();
    await this.assertSessionOwnership(guard.teacherProfileId, me, jwt);

    const s = await this.prisma.classSession.findUnique({
      where: { id },
      include: {
        teachingAssignment: {
          include: {
            classSection: { include: { enrollments: { where: { status: 'active' }, include: { student: { select: ATTENDANCE_ROSTER_STUDENT_SELECT } } } } },
            subject: { select: { id: true, name: true, color: true } },
          },
        },
        attendanceRecords: { include: { student: { select: ATTENDANCE_ROSTER_STUDENT_SELECT } } },
      },
    });
    // CONSERVÉE DÉLIBÉRÉMENT : la garde ci-dessus rend cette ligne inatteignable
    // en pratique. Elle coûte une comparaison et retire tout argument sur une
    // fenêtre TOCTOU entre les deux lectures. Ne pas la « nettoyer ».
    if (!s || s.tenantId !== me.tenantId) throw new NotFoundException();
    return s;
  }

  // -------- Attendance records --------

  /** Records attendance for a session. Upserts so it's safe to re-submit. */
  @Post('attendance/batch')
  @RequiresPermission('attendance.write')
  async batch(@Body() body: BatchAttendanceDto, @CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    const session = await this.prisma.classSession.findUnique({
      where: { id: body.classSessionId },
      include: {
        /**
         * S-E03-7 / ADR-079 — ÉPINGLÉ, DÉLIBÉRÉMENT NON CONVERTI (AC-9).
         *
         * Ce n'est PAS un compte : c'est une GARDE D'APPARTENANCE. Les lignes
         * alimentent `new Set(...)` puis REJETTENT tout enregistrement dont
         * l'élève n'y figure pas. Élargir la population laisserait pointer un
         * enfant parti ; la rétrécir rendrait un enfant légitimement inscrit
         * NON MARQUABLE en plein cours. Un changement de population est ici une
         * décision d'AUTORISATION D'ÉCRITURE, pas une correction de vérité de
         * lecture, et le delta n'est pas mesurable ce run (base vide). Il reste
         * dans le plafond DÉCROISSANT du cliquet — épinglé, pas exempté.
         */
        teachingAssignment: { include: { classSection: { include: { enrollments: { where: { status: 'active' } } } } } },
      },
    });
    if (!session || session.tenantId !== me.tenantId) throw new NotFoundException();
    await this.assertOwnership(session.teacherProfileId, me, jwt);

    const enrolled = new Set(
      session.teachingAssignment.classSection.enrollments.map((e) => e.studentId),
    );
    const bad = body.records.find((r) => !enrolled.has(r.studentId));
    if (bad) throw new BadRequestException(`L'élève ${bad.studentId} n'est pas inscrit dans cette classe.`);

    const ops = body.records.map((r) =>
      this.prisma.attendanceRecord.upsert({
        where: { classSessionId_studentId: { classSessionId: session.id, studentId: r.studentId } },
        create: {
          tenantId: me.tenantId,
          classSessionId: session.id,
          studentId: r.studentId,
          status: r.status,
          arrivedAt: r.arrivedAt,
          comment: r.comment,
          recordedBy: me.id,
        },
        update: {
          status: r.status,
          arrivedAt: r.arrivedAt,
          comment: r.comment,
          recordedBy: me.id,
          recordedAt: new Date(),
        },
      }),
    );
    await this.prisma.$transaction(ops);
    return { ok: true, count: ops.length };
  }

  /**
   * Mark an absence as justified.
   *
   * ⚠️ S-E05-5 / `PF-267` — CE DOCBLOC DISAIT « admin OR TEACHER OF THE CLASS ».
   * Il PROMETTAIT une règle de propriété que l'exécution n'implémente PAS : ce
   * handler ne porte qu'un contrôle de tenant (:328) et n'appelle
   * `assertOwnership` nulle part. C'est la forme `DNC-06` — un guide plus
   * profond que le runtime — à l'intérieur du fichier que cette tranche
   * modifie, donc la phrase est corrigée pour décrire ce qui S'EXÉCUTE.
   *
   * La règle RÉELLE aujourd'hui : tout détenteur de `attendance.justify`, dans
   * son tenant, sur n'importe quel enregistrement. La permission n'est accordée
   * qu'à `school_admin` (`permissions.constants.ts:188`) et jamais à `teacher`,
   * donc l'exposition vivante se limite au chemin des rôles personnalisés.
   * AJOUTER le contrôle manquant est une modification d'un handler d'ÉCRITURE
   * et reste HORS de cette tranche de lecture — c'est `PF-267`, ouvert.
   */
  @Post('attendance/:id/justify')
  @RequiresPermission('attendance.justify')
  async justify(
    @Param('id') id: string,
    @Body() body: JustifyDto,
    @CurrentJwt() jwt: KeycloakJwtPayload,
  ) {
    const me = await this.users.ensureUser(jwt);
    const rec = await this.prisma.attendanceRecord.findUnique({
      where: { id },
      include: { classSession: true },
    });
    if (!rec || rec.tenantId !== me.tenantId) throw new NotFoundException();
    if (rec.status !== 'absent' && rec.status !== 'late') {
      throw new BadRequestException('Seules absences/retards peuvent être justifiés.');
    }
    return this.prisma.attendanceRecord.update({
      where: { id },
      data: {
        status: rec.status === 'absent' ? 'absent_excused' : rec.status,
        justification: body.justification.trim(),
        justifiedBy: me.id,
        justifiedAt: new Date(),
      },
    });
  }

  /**
   * Per-student attendance feed. Used by parent portal + student profile.
   *
   * S-E05-5 / `AC-3` + `AC-4` — L'ORDRE DES PUBLICS EST DÉLIBÉRÉ :
   * `parent` → privilégié → professeur → refus.
   *
   * Le bloc `parent` reste PREMIER et TERMINAL, gelé à l'octet (`AC-4`) : mêmes
   * rôles lus, même `findFirst`, même objet `where`, même `ForbiddenException`
   * NUE, même position — avant la requête des enregistrements. Trois pages du
   * portail parent en dépendent ; la manière la moins chère de ne pas les
   * casser est de ne pas y toucher.
   *
   * CONSÉQUENCE NOMMÉE PLUTÔT QUE DÉCOUVERTE (`PF-266`, P3) : un appelant
   * portant À LA FOIS `parent` et `teacher` — un professeur dont l'enfant est
   * scolarisé ici — emprunte la branche parent et se voit refuser un élève
   * qu'il enseigne. C'est le comportement d'AUJOURD'HUI, inchangé. Placer le
   * court-circuit privilégié AVANT le bloc parent aurait ÉLARGI l'accès d'un
   * `school_admin` également parent — aujourd'hui borné à ses propres enfants —
   * à l'intérieur d'une tranche qui RESSERRE. Une tranche qui resserre quatre
   * handlers n'en élargit pas un cinquième au passage.
   */
  @Get('attendance/students/:studentId')
  @RequiresPermission('attendance.read')
  async studentAttendance(
    @Param('studentId') studentId: string,
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @CurrentJwt() jwt: KeycloakJwtPayload,
  ) {
    const me = await this.users.ensureUser(jwt);
    const student = await this.prisma.student.findUnique({ where: { id: studentId } });
    if (!student || student.tenantId !== me.tenantId) throw new NotFoundException();

    const roles = jwt.realm_access?.roles ?? [];
    if (roles.includes('parent')) {
      const gship = await this.prisma.guardianship.findFirst({
        where: {
          tenantId: me.tenantId,
          studentId,
          ...guardianshipLiveWhere(),
          guardian: { userProfileId: me.id },
        },
      });
      if (!gship) throw new ForbiddenException();
    } else {
      // ── S-E05-5 / AC-3 — la branche PROFESSEUR, nouvelle. ──────────────────
      // `isGuardian: false` n'est pas un raccourci : sur cette branche
      // l'appelant n'est pas parent, donc la tutelle n'a JAMAIS été consultée.
      // Le paramètre existe pour que la fonction pure énonce la règle COMPLÈTE
      // en un seul endroit et se teste sur les huit triplets.
      const isPrivileged = isPrivilegedAttendanceCaller(roles);
      let teachesStudent = false;
      if (!isPrivileged) {
        // JAMAIS `ensureForUser` (AC-6 / ADR-051 §D1) : un REFUS ne doit rien
        // provisionner. `findForUser` est en lecture seule et porte son
        // `tenantId`.
        const tp = await this.teachers.findForUser(me);
        if (tp) {
          const enrollment = await this.prisma.enrollment.findFirst({
            where: teacherOfStudentWhere({
              tenantId: me.tenantId,
              studentId,
              teacherProfileId: tp.id,
            }),
            orderBy: { enrolledAt: 'desc' },
            select: { classSectionId: true, academicYearId: true },
          });
          if (enrollment) {
            // ADR-061 §D1 — le couple (classSectionId, academicYearId) ferme
            // l'ANNÉE : `TeachingAssignment` n'a pas `academicYearId` dans sa
            // clé d'unicité, donc les affectations survivent au changement
            // d'année scolaire.
            const assignment = await this.prisma.teachingAssignment.findFirst({
              where: teacherOfStudentAssignmentWhere({
                tenantId: me.tenantId,
                classSectionId: enrollment.classSectionId,
                academicYearId: enrollment.academicYearId,
                teacherProfileId: tp.id,
              }),
              select: { id: true },
            });
            teachesStudent = assignment !== null;
          }
        }
      }
      assertStudentAttendanceReadable({ isPrivileged, isGuardian: false, teachesStudent });
    }

    const records = await this.prisma.attendanceRecord.findMany({
      where: {
        studentId,
        tenantId: me.tenantId,
        ...(from || to
          ? {
              classSession: {
                date: {
                  ...(from ? { gte: new Date(from) } : {}),
                  ...(to ? { lte: new Date(to) } : {}),
                },
              },
            }
          : {}),
      },
      include: {
        classSession: {
          include: {
            teachingAssignment: {
              include: {
                subject: { select: { id: true, name: true, color: true } },
                classSection: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
      orderBy: { classSession: { date: 'desc' } },
    });

    // Compute summary
    const summary = {
      total: records.length,
      present: records.filter((r) => r.status === 'present').length,
      absent: records.filter((r) => r.status === 'absent').length,
      absentExcused: records.filter((r) => r.status === 'absent_excused').length,
      late: records.filter((r) => r.status === 'late').length,
      leftEarly: records.filter((r) => r.status === 'left_early').length,
    };

    return { records, summary };
  }

  /**
   * Per-class roster + their attendance for a given date (teacher's view when taking attendance).
   *
   * S-E05-5 / `AC-2` — MÊME forme en deux temps que `sessionDetail`, MÊME
   * helper, MÊME message. La charge rend une ligne `Student` par inscription
   * active : elle n'est émise qu'après le verdict.
   *
   * S-E05-6 / `PF-269` — cette ligne est PROJETÉE, plus complète : quatre
   * champs, voir `ATTENDANCE_ROSTER_STUDENT_SELECT`. Les `AttendanceRecord`
   * joints, eux, restent des lignes ENTIÈRES (`comment`, `justification`,
   * `recordedBy`) — gelé délibérément par la tranche, suivi en `PF-277`.
   *
   * AUCUN appelant de première partie n'est cassé :
   * `teacher/classes/[id]/attendance/actions.ts:28` n'obtient son `sessionId`
   * que de `class-sessions/open` (`actions.ts:19`) ou de
   * `class-sessions?teachingAssignmentId=` (`page.tsx:74`), tous deux déjà
   * derrière `assertOwnership`. Et la propriété se lit sur la MÊME colonne que
   * l'écriture (`ADR-061 §D3`), donc la paire ouvrir → appel ne peut pas 403.
   */
  @Get('class-sessions/:id/roster')
  @RequiresPermission('attendance.read')
  async roster(@Param('id') id: string, @CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    const guard = await this.prisma.classSession.findUnique({
      where: { id },
      select: { id: true, tenantId: true, teacherProfileId: true },
    });
    if (!guard || guard.tenantId !== me.tenantId) throw new NotFoundException();
    await this.assertSessionOwnership(guard.teacherProfileId, me, jwt);

    const session = await this.prisma.classSession.findUnique({
      where: { id },
      include: {
        teachingAssignment: {
          include: {
            classSection: {
              include: {
                enrollments: {
                  where: { status: 'active' },
                  include: { student: { select: ATTENDANCE_ROSTER_STUDENT_SELECT } },
                  orderBy: { student: { lastName: 'asc' } },
                },
              },
            },
          },
        },
        attendanceRecords: true,
      },
    });
    // Voir `sessionDetail` : conservée délibérément, inatteignable en pratique.
    if (!session || session.tenantId !== me.tenantId) throw new NotFoundException();

    const recordByStudent = new Map(session.attendanceRecords.map((r) => [r.studentId, r]));
    return {
      session: {
        id: session.id,
        date: session.date,
        startTime: session.startTime,
        endTime: session.endTime,
        topic: session.topic,
        cancelled: session.cancelled,
      },
      roster: session.teachingAssignment.classSection.enrollments.map((e) => ({
        enrollmentId: e.id,
        student: e.student,
        record: recordByStudent.get(e.studentId) ?? null,
      })),
    };
  }

  /**
   * S-E05-5 — la RÉSOLUTION d'identité pour les chemins de LECTURE.
   *
   * Lecture seule (`findForUser`), JAMAIS `ensureForUser` : un refus ne doit
   * PROVISIONNER rien (`ADR-051 §D1`). Non fusionnée avec `assertOwnership`
   * (ci-dessous) délibérément — ce dernier reste sur `ensureForUser` et ses
   * trois sites d'appel d'ÉCRITURE sont hors de la portée de cette tranche
   * (`PF-265`).
   *
   * `sessionTeacherProfileId` vient de `classSession.teacherProfileId`, la
   * colonne DÉNORMALISÉE — la MÊME que `batch` (:282) utilise déjà pour
   * autoriser l'écriture (`ADR-061 §D3`). Lire et écrire doivent refuser sur le
   * même bit, sinon une ligne dérivée 403 la liste d'appel d'une séance que le
   * même professeur peut légalement écrire.
   *
   * Le court-circuit privilégié saute la requête ENTIÈREMENT : un administrateur
   * n'a jamais besoin d'un profil professeur, et ne pas le demander est une
   * instruction de moins sur le chemin admin.
   */
  private async assertSessionOwnership(
    sessionTeacherProfileId: string,
    me: { id: string; tenantId: string },
    jwt: KeycloakJwtPayload,
  ): Promise<void> {
    const isPrivileged = isPrivilegedAttendanceCaller(jwt.realm_access?.roles ?? []);
    const tp = isPrivileged ? null : await this.teachers.findForUser(me);
    assertSessionReadable({ isPrivileged, teacherProfileId: tp?.id ?? null }, sessionTeacherProfileId);
  }

  private async assertOwnership(
    teacherProfileId: string,
    me: { id: string; tenantId: string },
    jwt: KeycloakJwtPayload,
  ) {
    const roles = jwt.realm_access?.roles ?? [];
    if (roles.includes('super_admin') || roles.includes('school_admin')) return;
    const tp = await this.teachers.ensureForUser(me);
    if (teacherProfileId !== tp.id) {
      throw new ForbiddenException('Vous ne pouvez ouvrir une séance que sur vos affectations.');
    }
  }

  /**
   * Admin attendance overview — aggregates today + recent records for the
   * `/admin/attendance` page (KPI strip + recent records table).
   * Returns at most 50 most-recent records.
   *
   * S-E05-5 / `AC-5` — LE REFUS PASSE AVANT `ensureUser`, ET C'EST DÉLIBÉRÉ.
   *
   * La décision ne dépend QUE du jeton, donc elle est prenable avant tout
   * contact avec la base. La placer en premier fait qu'un appelant refusé
   * n'atteint plus `ensureUser`, dont la branche d'adoption peut ÉCRIRE
   * (`user-sync.service.ts`) — une réduction gratuite de la même classe
   * « écriture sur un chemin de refus » que `PF-265` enregistre. Ne pas la
   * « ranger » sous `ensureUser`.
   *
   * Ce handler rendait l'ÉTABLISSEMENT entier — les 50 enregistrements les plus
   * récents, nom et prénom de l'élève attachés — à tout détenteur de
   * `attendance.read`, c'est-à-dire aussi à `parent` (`PF-264`).
   */
  @Get('attendance/overview')
  @RequiresPermission('attendance.read')
  async overview(@CurrentJwt() jwt: KeycloakJwtPayload) {
    assertEstablishmentOverviewReadable({
      isPrivileged: isPrivilegedAttendanceCaller(jwt.realm_access?.roles ?? []),
    });
    const me = await this.users.ensureUser(jwt);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);

    // Today's attendance counts (one query, count by status)
    const todayRecords = await this.prisma.attendanceRecord.findMany({
      where: {
        tenantId: me.tenantId,
        classSession: { date: { gte: today, lt: tomorrow } },
      },
      select: { status: true, justification: true },
    });
    const counts = todayRecords.reduce(
      (acc, r) => {
        acc[r.status] = (acc[r.status] ?? 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );
    const unjustifiedAbsences = todayRecords.filter(
      (r) => r.status === 'absent' && (!r.justification || r.justification.trim() === ''),
    ).length;

    // Recent 50 attendance records across the establishment
    const recent = await this.prisma.attendanceRecord.findMany({
      where: { tenantId: me.tenantId },
      orderBy: { recordedAt: 'desc' },
      take: 50,
      include: {
        student: { select: { id: true, firstName: true, lastName: true } },
        classSession: {
          select: {
            id: true,
            date: true,
            teachingAssignment: {
              select: {
                classSection: { select: { id: true, name: true } },
                subject: { select: { name: true } },
              },
            },
          },
        },
      },
    });

    return {
      kpis: {
        present: counts.present ?? 0,
        absent: counts.absent ?? 0,
        late: counts.late ?? 0,
        leftEarly: counts.left_early ?? 0,
        excused: counts.absent_excused ?? 0,
        unjustifiedAbsences,
      },
      records: recent.map((r) => ({
        id: r.id,
        status: r.status,
        justification: r.justification,
        createdAt: r.recordedAt.toISOString(),
        student: r.student,
        date: r.classSession.date.toISOString(),
        classSectionName: r.classSession.teachingAssignment.classSection.name,
        subjectName: r.classSession.teachingAssignment.subject.name,
      })),
    };
  }
}
