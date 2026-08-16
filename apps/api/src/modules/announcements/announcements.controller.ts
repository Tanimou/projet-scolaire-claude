import {
  BadRequestException,
  Body,
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
import { AnnouncementPriority, AnnouncementScope } from '@prisma/client';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
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
import {
  isSuppliedScopeId,
  scopeOwnershipPlan,
  unknownScopeRef,
} from '../../shared/prisma/scope-fk';
import { NotificationsService } from '../notifications/notifications.service';
import { SchoolContextService } from '../school-structure/school-context.service';

import { AnnouncementRecipientsService } from './announcements.service';

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ S-E01-1f / PF-208 / ADR-053 — LES CINQ FK DE PORTÉE D'UNE ANNONCE        │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * `announcement` porte cinq FK MONO-COLONNE qui nomment une portée. PostgreSQL
 * évalue l'intégrité référentielle EN DEHORS de la row security (ADR-049 §D1,
 * ADR-042 §D6) : le `WITH CHECK` de `tenant_isolation` ne voit que
 * `announcement.tenant_id`, et la contrainte qui valide `class_section_id`
 * s'exécute en tant que PROPRIÉTAIRE de `class_section`, policy éteinte. Un id
 * d'un AUTRE tenant s'insère donc proprement sous une policy parfaitement
 * correcte.
 *
 * Pire ici que dans le calendrier : `announcement.user_profile_id` n'a AUCUNE
 * clé étrangère du tout (colonne `@db.Uuid` nue) — pas même l'existence n'est
 * garantie, et le remède « FK composite » de PF-205 est INDISPONIBLE sans
 * migration. Le prédicat applicatif est le SEUL contrôle qui puisse exister sur
 * cette colonne. C'est un finding séparé (schéma → G-MIGRATION), pas ce diff.
 *
 * La LISTE reste LOCALE au module (ADR-053 §D2) : les helpers purs partagés
 * (`shared/prisma/scope-fk.ts`) sont génériques sur `F extends string` et lisent
 * ce tuple. Élargir une union fermée partagée à chaque module en ferait une
 * liste tenue à la main de plus — la maladie que cet épic combat.
 */
const ANNOUNCEMENT_SCOPE_FIELDS = [
  'cycleId',
  'gradeLevelId',
  'classSectionId',
  'studentId',
  'userProfileId',
] as const;
type AnnouncementScopeField = (typeof ANNOUNCEMENT_SCOPE_FIELDS)[number];

/**
 * ADR-053 §D3 — LA PORTÉE DÉCLARÉE NOMME EXACTEMENT UN CHAMP, ET AUCUN AUTRE
 * N'EST PERSISTÉ.
 *
 * `create` (`:489-509`) persistait les CINQ ids inconditionnellement : une
 * annonce `class_section_scope` pouvait donc emporter un `userProfileId` que
 * AUCUNE portée déclarée n'explique — la forme de PF-206, sur une colonne sans
 * contrainte. Mesuré contre les deux composeurs livrés
 * (`AnnouncementComposer.tsx:279-281`, `TeacherMessageComposer.tsx:277-279`) :
 * chacun envoie EXACTEMENT un id, clé omise sinon (spread conditionnel). Ce
 * refus ne casse donc AUCUN appelant livré, et il plafonne le plan de propriété
 * à UNE sonde par requête.
 *
 * `validateScope` prouve que le champ REQUIS est présent ; ceci prouve
 * qu'aucun AUTRE ne l'est. Les deux sont purs et ne lisent pas la base : un
 * corps qu'ils refusent n'a coûté aucune requête.
 */
const SCOPE_REQUIRED_FIELD: Record<AnnouncementScope, AnnouncementScopeField | null> = {
  school_wide: null,
  cycle_scope: 'cycleId',
  grade_level_scope: 'gradeLevelId',
  class_section_scope: 'classSectionId',
  individual_student: 'studentId',
  individual_user: 'userProfileId',
};

/**
 * Refuse tout id de portée que la portée déclarée n'explique pas. Défini sur la
 * VÉRACITÉ (`isSuppliedScopeId`), jamais sur la présence de la clé :
 * `@IsOptional()` laisse passer `null` malgré le `?: string` du DTO, et traiter
 * une clé présente-mais-nulle comme « fournie » ferait échouer chaque écriture
 * ordinaire.
 */
export function assertScopeCoherence(
  body: { scope: AnnouncementScope } & Partial<Record<AnnouncementScopeField, string | null>>,
): void {
  const expected = SCOPE_REQUIRED_FIELD[body.scope] ?? null;
  const extra = ANNOUNCEMENT_SCOPE_FIELDS.filter(
    (field) => field !== expected && isSuppliedScopeId(body[field]),
  );
  if (extra.length > 0) {
    throw new BadRequestException(
      `Cette portée n'explique pas les champs fournis (${extra.join(', ')}).`,
    );
  }
}

class CreateAnnouncementDto {
  @IsString() @MinLength(1) @MaxLength(200) title!: string;
  @IsString() @MinLength(1) @MaxLength(10000) body!: string;
  @IsEnum(AnnouncementScope) scope!: AnnouncementScope;
  @IsOptional() @IsEnum(AnnouncementPriority) priority?: AnnouncementPriority;
  @IsOptional() @IsUUID() cycleId?: string;
  @IsOptional() @IsUUID() gradeLevelId?: string;
  @IsOptional() @IsUUID() classSectionId?: string;
  @IsOptional() @IsUUID() studentId?: string;
  @IsOptional() @IsUUID() userProfileId?: string;
  @IsOptional() @IsDateString() expiresAt?: string;
  @IsOptional() @IsBoolean() pinned?: boolean;
  @IsOptional() @IsArray() attachments?: unknown[];
  @IsOptional() @IsBoolean() publishNow?: boolean;
}

class UpdateAnnouncementDto {
  @IsOptional() @IsString() @MaxLength(200) title?: string;
  @IsOptional() @IsString() @MaxLength(10000) body?: string;
  @IsOptional() @IsEnum(AnnouncementPriority) priority?: AnnouncementPriority;
  @IsOptional() @IsDateString() expiresAt?: string;
  @IsOptional() @IsBoolean() pinned?: boolean;
  @IsOptional() @IsArray() attachments?: unknown[];
}

class PreviewRecipientsDto {
  @IsEnum(AnnouncementScope) scope!: AnnouncementScope;
  @IsOptional() @IsUUID() cycleId?: string;
  @IsOptional() @IsUUID() gradeLevelId?: string;
  @IsOptional() @IsUUID() classSectionId?: string;
  @IsOptional() @IsUUID() studentId?: string;
  @IsOptional() @IsUUID() userProfileId?: string;
}

@ApiTags('announcements')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('announcements')
export class AnnouncementsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UserSyncService,
    private readonly ctx: SchoolContextService,
    private readonly recipients: AnnouncementRecipientsService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Lists announcements:
   *   - staff admins see ALL announcements of the school (including drafts authored by others)
   *   - teachers with `mine=true` see their OWN authored announcements (drafts + published)
   *   - everyone else (and teachers without `mine`) see ONLY those targeted at them (via AnnouncementReceipt) AND published
   */
  @Get()
  @RequiresPermission('announcements.read')
  async list(
    @CurrentJwt() jwt: KeycloakJwtPayload,
    @Query('onlyUnread') onlyUnread?: string,
    @Query('mine') mine?: string,
  ) {
    const me = await this.users.ensureUser(jwt);
    const roles = jwt.realm_access?.roles ?? [];
    const isAdmin = roles.includes('super_admin') || roles.includes('school_admin');
    const isTeacher = roles.includes('teacher');
    const onlyMine = mine === 'true';

    if (isAdmin && !onlyMine) {
      const data = await this.prisma.announcement.findMany({
        where: { tenantId: me.tenantId },
        orderBy: [{ pinned: 'desc' }, { publishedAt: 'desc' }, { createdAt: 'desc' }],
        include: {
          cycle: { select: { name: true } },
          gradeLevel: { select: { name: true } },
          classSection: { select: { name: true } },
          student: { select: { id: true, firstName: true, lastName: true } },
          _count: { select: { recipients: true } },
        },
      });
      return { data };
    }

    // `mine=true` — author-scoped view (used by teacher messaging center).
    // Returns the user's own announcements (drafts + published) with recipient counts.
    if (onlyMine && (isAdmin || isTeacher)) {
      const data = await this.prisma.announcement.findMany({
        where: { tenantId: me.tenantId, authorId: me.id },
        orderBy: [{ pinned: 'desc' }, { publishedAt: 'desc' }, { createdAt: 'desc' }],
        include: {
          cycle: { select: { name: true } },
          gradeLevel: { select: { name: true } },
          classSection: { select: { name: true } },
          student: { select: { id: true, firstName: true, lastName: true } },
          _count: { select: { recipients: true } },
        },
      });
      return { data };
    }

    // For non-staff (parents, teachers without mine=true) — only published & targeted at them
    const receipts = await this.prisma.announcementReceipt.findMany({
      where: {
        userProfileId: me.id,
        announcement: {
          tenantId: me.tenantId,
          publishedAt: { not: null },
          OR: [{ expiresAt: null }, { expiresAt: { gte: new Date() } }],
        },
        ...(onlyUnread === 'true' ? { readAt: null } : {}),
      },
      include: {
        announcement: {
          include: {
            cycle: { select: { name: true } },
            gradeLevel: { select: { name: true } },
            classSection: { select: { name: true } },
            student: { select: { id: true, firstName: true, lastName: true } },
          },
        },
      },
      orderBy: [
        { announcement: { pinned: 'desc' } },
        { announcement: { publishedAt: 'desc' } },
      ],
    });

    // Enrich with author identity (firstName/lastName) so the parent communication
    // page can group communications by interlocutor. Single batch query keyed on
    // distinct authorIds present in the fetched receipts (no schema change needed —
    // Announcement.authorId is a plain UUID without a Prisma relation).
    const authorIds = Array.from(
      new Set(receipts.map((r) => r.announcement.authorId).filter(Boolean)),
    );
    const authors = authorIds.length
      ? await this.prisma.userProfile.findMany({
          where: { id: { in: authorIds }, tenantId: me.tenantId },
          select: { id: true, firstName: true, lastName: true },
        })
      : [];
    const authorById = new Map(authors.map((a) => [a.id, a]));

    return {
      data: receipts.map((r) => ({
        ...r.announcement,
        readAt: r.readAt,
        receiptId: r.id,
        author: authorById.get(r.announcement.authorId) ?? null,
      })),
    };
  }

  @Get('unread-count')
  @RequiresPermission('announcements.read')
  async unreadCount(@CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    const n = await this.prisma.announcementReceipt.count({
      where: {
        userProfileId: me.id,
        readAt: null,
        announcement: {
          tenantId: me.tenantId,
          publishedAt: { not: null },
          OR: [{ expiresAt: null }, { expiresAt: { gte: new Date() } }],
        },
      },
    });
    return { unread: n };
  }

  /**
   * Estimates the number of recipients an announcement would reach if published
   * right now with the given scope payload. Used by the composer to surface a
   * live "Cette annonce touchera ~N personnes" panel before the admin clicks
   * Publier. Returns `count` (distinct user profiles in the union) and a
   * `breakdown` by role (parents / teachers / admins / staff).
   *
   * Pure-read (no side effects). Same auth surface as `create` — requires
   * `announcements.write` because the breakdown reveals roster size which is
   * sensitive context.
   *
   * S-E01-1f (AC-3) — CE QUE CE BLOC PROMETTAIT ET NE FAISAIT PAS. Le
   * commentaire d'origine affirmait que « le composeur ne peut pas servir à
   * énumérer l'école via le preview ». MESURÉ à `bc4e590` : le handler ne
   * refusait aux enseignants que `school_wide` / `individual_user` et
   * n'appliquait AUCUNE des vérifications d'empreinte de `create` — un
   * enseignant obtenait donc la taille de roster de N'IMPORTE QUELLE classe de
   * son école. Intra-tenant, donc pas la faille P1, mais de la dette
   * d'attente à trois lignes du diff (DNC-06). Le contrôle d'empreinte de
   * `create` est désormais FACTORISÉ (`assertTeacherScope`) et appliqué ici :
   * le commentaire redevient vrai parce que le code a changé, pas l'inverse.
   *
   * MESURÉ AUSSI, et contraire à la prémisse du brief : ce endpoint ne fuitait
   * PAS de COMPTE inter-tenant. `count` vaut `profiles.length`, issu du
   * `userProfile.findMany({ …, tenantId })` ci-dessous ; un id étranger rendait
   * donc `0`, à l'octet près comme un id inexistant. Cette sécurité était
   * ACCIDENTELLE — un refactor remplaçant `profiles.length` par `ids.length` la
   * transformerait en l'oracle exact que l'on décrit. Les sondes de propriété
   * ci-dessous la rendent INTENTIONNELLE, et le test la fige.
   */
  @Get('preview-recipients')
  @RequiresPermission('announcements.write')
  async previewRecipients(@Query() q: PreviewRecipientsDto, @CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    const { schoolId } = await this.ctx.forUser(me);
    const roles = jwt.realm_access?.roles ?? [];
    const isAdmin = roles.includes('super_admin') || roles.includes('school_admin');
    const isTeacher = roles.includes('teacher');

    // Validate scope payload requirements early so the preview surfaces the
    // same "Champ requis" hints as a real publish attempt.
    this.validateScope({
      title: 'preview',
      body: 'preview',
      scope: q.scope,
      cycleId: q.cycleId,
      gradeLevelId: q.gradeLevelId,
      classSectionId: q.classSectionId,
      studentId: q.studentId,
      userProfileId: q.userProfileId,
    } as CreateAnnouncementDto);
    assertScopeCoherence(q);

    if (!isAdmin && isTeacher) {
      await this.assertTeacherScope(me, q.scope, q.classSectionId ?? null);
    }

    // AC-3 — LES MÊMES SONDES QUE `create`, dans le même ordre (après les refus
    // de rôle, avant toute lecture de roster) et avec le MÊME refus à l'octet
    // près. Un endpoint de prévisualisation qui exécute quatre requêtes non
    // tenantées contre des ids étrangers est une surface d'existence et de
    // charge même quand il ne rend aucun compte. Écrit EN LIGNE (PF-200).
    const tenantId = me.tenantId;
    for (const ref of scopeOwnershipPlan(q, ANNOUNCEMENT_SCOPE_FIELDS)) {
      let owned: { id: string } | null;
      switch (ref.field) {
        case 'cycleId':
          owned = await this.prisma.cycle.findFirst({
            where: { id: ref.id, tenantId },
            select: { id: true },
          });
          break;
        case 'gradeLevelId':
          owned = await this.prisma.gradeLevel.findFirst({
            where: { id: ref.id, tenantId },
            select: { id: true },
          });
          break;
        case 'classSectionId':
          owned = await this.prisma.classSection.findFirst({
            where: { id: ref.id, tenantId },
            select: { id: true },
          });
          break;
        case 'studentId':
          owned = await this.prisma.student.findFirst({
            where: { id: ref.id, tenantId },
            select: { id: true },
          });
          break;
        case 'userProfileId':
          owned = await this.prisma.userProfile.findFirst({
            where: { id: ref.id, tenantId },
            select: { id: true },
          });
          break;
        default: {
          const exhaustive: never = ref.field;
          throw unknownScopeRef(exhaustive);
        }
      }
      if (owned === null) throw unknownScopeRef(ref.field);
    }

    const recipientIds = await this.recipients.computeRecipients({
      tenantId: me.tenantId,
      schoolId,
      scope: q.scope,
      cycleId: q.cycleId ?? null,
      gradeLevelId: q.gradeLevelId ?? null,
      classSectionId: q.classSectionId ?? null,
      studentId: q.studentId ?? null,
      userProfileId: q.userProfileId ?? null,
    });

    const ids = [...recipientIds];
    if (ids.length === 0) {
      return {
        count: 0,
        breakdown: { parents: 0, teachers: 0, admins: 0, other: 0 },
      };
    }

    // Single batched lookup: join user_profiles → user_roles (active only) →
    // roles to bucket the recipient set. A profile with both teacher + parent
    // roles is counted once per role bucket (so the breakdown sum can exceed
    // `count`); `count` itself is the distinct profile count.
    const profiles = await this.prisma.userProfile.findMany({
      where: { id: { in: ids }, tenantId: me.tenantId },
      select: {
        id: true,
        userRoles: {
          where: { revokedAt: null },
          select: { role: { select: { slug: true } } },
        },
      },
    });

    let parents = 0;
    let teachers = 0;
    let admins = 0;
    let other = 0;
    for (const p of profiles) {
      const slugs = new Set(p.userRoles.map((ur) => ur.role.slug));
      let bucketed = false;
      if (slugs.has('parent')) {
        parents++;
        bucketed = true;
      }
      if (slugs.has('teacher')) {
        teachers++;
        bucketed = true;
      }
      if (slugs.has('super_admin') || slugs.has('school_admin')) {
        admins++;
        bucketed = true;
      }
      if (!bucketed) other++;
    }

    return {
      count: profiles.length,
      breakdown: { parents, teachers, admins, other },
    };
  }

  @Get(':id')
  @RequiresPermission('announcements.read')
  async getOne(@Param('id') id: string, @CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    const a = await this.prisma.announcement.findUnique({
      where: { id },
      include: {
        cycle: { select: { name: true } },
        gradeLevel: { select: { name: true } },
        classSection: { select: { name: true } },
        student: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    if (!a || a.tenantId !== me.tenantId) throw new NotFoundException();

    const roles = jwt.realm_access?.roles ?? [];
    const isAdmin = roles.includes('super_admin') || roles.includes('school_admin');
    const isAuthor = a.authorId === me.id;

    if (!isAdmin && !isAuthor) {
      // Must have a receipt for this user
      const receipt = await this.prisma.announcementReceipt.findUnique({
        where: { announcementId_userProfileId: { announcementId: id, userProfileId: me.id } },
      });
      if (!receipt) throw new NotFoundException();
      // Auto-mark-as-read on detail open
      if (!receipt.readAt) {
        await this.prisma.announcementReceipt.update({
          where: { id: receipt.id },
          data: { readAt: new Date() },
        });
      }
      return { ...a, readAt: receipt.readAt ?? new Date() };
    }

    // Admin / author detail view: enrich with recipient breakdown so the
    // /admin/announcements/[id] page can surface the real engagement of the
    // announcement (read rate, time-to-read, per-recipient roster). The list
    // endpoint only exposes a count; everything else here is detail-page only.
    const allReceipts = await this.prisma.announcementReceipt.findMany({
      where: { announcementId: id },
      orderBy: [{ readAt: 'desc' }, { createdAt: 'asc' }],
      take: 500,
    });

    const userProfileIds = allReceipts.map((r) => r.userProfileId);
    const authorIds = a.authorId ? [a.authorId] : [];
    const allIds = Array.from(new Set([...userProfileIds, ...authorIds]));
    const profiles = allIds.length
      ? await this.prisma.userProfile.findMany({
          where: { id: { in: allIds }, tenantId: me.tenantId },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            userRoles: {
              where: { revokedAt: null },
              select: { role: { select: { slug: true, name: true } } },
            },
          },
        })
      : [];
    const profileById = new Map(
      profiles.map((p) => [
        p.id,
        {
          id: p.id,
          firstName: p.firstName,
          lastName: p.lastName,
          email: p.email,
          roles: p.userRoles.map((ur) => ur.role.slug),
          roleLabels: p.userRoles.map((ur) => ur.role.name),
        },
      ]),
    );

    // ┌────────────────────────────────────────────────────────────────────────┐
    // │ AC-4 (moitié DIVULGATION) — LA PROJECTION NE REND QUE LES REÇUS RÉSOLUS │
    // └────────────────────────────────────────────────────────────────────────┘
    //
    // `announcement_receipt` n'a PAS de `tenant_id` : la lecture ci-dessus ne
    // peut donc pas être filtrée par tenant, et pour une annonce publiée AVANT
    // ce correctif elle rend encore les lignes inter-tenant écrites par PF-208.
    // La recherche de profils (`:361-363`) est, elle, filtrée par tenant : ces
    // lignes rendaient `userProfile: null`, mais leur UUID brut, leur nombre et
    // leur poids dans `stats.total` / `readRate` étaient rendus À L'ATTAQUANT —
    // un oracle de CARDINALITÉ et d'EXISTENCE (les noms et e-mails, eux,
    // n'ont jamais fuité).
    //
    // On résout donc les reçus CONTRE la recherche déjà filtrée par tenant, et
    // on ne rend que ceux-là. Deux conséquences, écrites ici plutôt que
    // découvertes plus tard :
    //   (a) les lignes inter-tenant préexistantes deviennent INVISIBLES dans
    //       l'UI — c'est voulu : une UI qui vous dit combien de lignes
    //       étrangères vous avez réussi à injecter EST l'oracle. Leur détection
    //       est un recensement OPÉRATEUR (finding séparé), pas un écran ;
    //   (b) un reçu dont le profil a été supprimé DUR cesse d'être compté :
    //       petit changement de vérité, défendable (un utilisateur supprimé ne
    //       peut pas lire).
    const receipts = allReceipts.filter((r) => profileById.has(r.userProfileId));

    const totalReceipts = receipts.length;
    const readReceipts = receipts.filter((r) => r.readAt !== null);
    const readCount = readReceipts.length;
    const unreadCount = totalReceipts - readCount;
    const readRate = totalReceipts > 0 ? readCount / totalReceipts : 0;

    let firstReadAt: Date | null = null;
    let lastReadAt: Date | null = null;
    const minutesToRead: number[] = [];
    for (const r of readReceipts) {
      if (!r.readAt) continue;
      if (!firstReadAt || r.readAt < firstReadAt) firstReadAt = r.readAt;
      if (!lastReadAt || r.readAt > lastReadAt) lastReadAt = r.readAt;
      const ref = a.publishedAt ?? r.createdAt;
      if (ref) {
        const m = Math.max(0, (r.readAt.getTime() - ref.getTime()) / 60000);
        if (Number.isFinite(m)) minutesToRead.push(m);
      }
    }
    minutesToRead.sort((x, y) => x - y);
    const medianMinutesToRead =
      minutesToRead.length === 0
        ? null
        : minutesToRead[Math.floor(minutesToRead.length / 2)];

    return {
      ...a,
      author: profileById.get(a.authorId)
        ? {
            id: a.authorId,
            firstName: profileById.get(a.authorId)!.firstName,
            lastName: profileById.get(a.authorId)!.lastName,
          }
        : null,
      stats: {
        total: totalReceipts,
        read: readCount,
        unread: unreadCount,
        readRate,
        firstReadAt: firstReadAt ? firstReadAt.toISOString() : null,
        lastReadAt: lastReadAt ? lastReadAt.toISOString() : null,
        medianMinutesToRead,
      },
      recipients: receipts.map((r) => ({
        id: r.id,
        userProfileId: r.userProfileId,
        readAt: r.readAt ? r.readAt.toISOString() : null,
        createdAt: r.createdAt.toISOString(),
        userProfile: profileById.get(r.userProfileId) ?? null,
      })),
    };
  }

  @Post()
  @RequiresPermission('announcements.write')
  async create(@Body() body: CreateAnnouncementDto, @CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    const { schoolId } = await this.ctx.forUser(me);
    const roles = jwt.realm_access?.roles ?? [];
    const isAdmin = roles.includes('super_admin') || roles.includes('school_admin');
    const isTeacher = roles.includes('teacher');
    const authorRoleHint = isAdmin ? 'admin' : isTeacher ? 'teacher' : null;

    // Validate scope payload
    this.validateScope(body);
    // ADR-053 §D3 — PUR, donc AVANT tout accès à la base : un corps refusé ici
    // n'a coûté aucune requête et n'a rien pu révéler.
    assertScopeCoherence(body);

    // Teachers can only broadcast to scopes that are part of their teaching footprint.
    // School-wide and individual_user are admin-only (those reach across the whole
    // organisation or arbitrary staff/parents and would bypass the teaching boundary).
    if (!isAdmin && isTeacher) {
      await this.assertTeacherScope(me, body.scope, body.classSectionId ?? null);
    }

    // ┌────────────────────────────────────────────────────────────────────────┐
    // │ AC-1 / ADR-053 §D1 — LES SONDES DE PROPRIÉTÉ                           │
    // └────────────────────────────────────────────────────────────────────────┘
    //
    // ORDRE, et c'est une exigence : APRÈS les refus de rôle/portée ci-dessus,
    // AVANT l'écriture. Un appelant n'apprend rien sur un corps qu'il n'avait
    // pas le droit d'envoyer.
    //
    // `findFirst` et non `findUnique` : « appartient à un autre tenant » et
    // « n'existe pas » empruntent LA MÊME branche (`→ null`) et produisent le
    // MÊME message à l'octet près. Distinguer les deux serait un oracle
    // d'existence inter-tenant.
    //
    // `tenantId` EXPLICITE dans chaque `where`. LIMITE NOMMÉE (DNC-06) : ce
    // module n'est PAS converti à `withTenant` — ces sondes tournent sur la
    // connexion du PROPRIÉTAIRE des tables, qui échappe à ses propres policies
    // faute de `FORCE ROW LEVEL SECURITY`. Ce prédicat fait donc TOUT le
    // travail ; RLS ne le double pas.
    //
    // `await` SÉQUENTIEL, jamais `Promise.all` : la forme doit rester valide le
    // jour où elle entre dans une transaction interactive, qui est UNE connexion.
    //
    // La boucle est écrite EN LIGNE, jamais derrière un `this.<méthode>()` :
    // l'attribution de `tenant-adversarial-check.js` est LEXICALE (PF-200).
    const tenantId = me.tenantId;
    for (const ref of scopeOwnershipPlan(body, ANNOUNCEMENT_SCOPE_FIELDS)) {
      let owned: { id: string } | null;
      switch (ref.field) {
        case 'cycleId':
          owned = await this.prisma.cycle.findFirst({
            where: { id: ref.id, tenantId },
            select: { id: true },
          });
          break;
        case 'gradeLevelId':
          owned = await this.prisma.gradeLevel.findFirst({
            where: { id: ref.id, tenantId },
            select: { id: true },
          });
          break;
        case 'classSectionId':
          owned = await this.prisma.classSection.findFirst({
            where: { id: ref.id, tenantId },
            select: { id: true },
          });
          break;
        case 'studentId':
          owned = await this.prisma.student.findFirst({
            where: { id: ref.id, tenantId },
            select: { id: true },
          });
          break;
        case 'userProfileId':
          owned = await this.prisma.userProfile.findFirst({
            where: { id: ref.id, tenantId },
            select: { id: true },
          });
          break;
        default: {
          // Switch CLOS : un sixième champ ne compile pas, et s'il atteignait
          // l'exécution il REFUSE au lieu de passer (échec fermé).
          const exhaustive: never = ref.field;
          throw unknownScopeRef(exhaustive);
        }
      }
      if (owned === null) throw unknownScopeRef(ref.field);
    }

    const now = new Date();
    const created = await this.prisma.announcement.create({
      data: {
        tenantId: me.tenantId,
        schoolId,
        title: body.title.trim(),
        body: body.body,
        scope: body.scope,
        priority: body.priority ?? 'normal',
        cycleId: body.cycleId,
        gradeLevelId: body.gradeLevelId,
        classSectionId: body.classSectionId,
        studentId: body.studentId,
        userProfileId: body.userProfileId,
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined,
        pinned: body.pinned ?? false,
        authorId: me.id,
        authorRoleHint,
        attachments: (body.attachments ?? []) as never,
        publishedAt: body.publishNow ? now : null,
      },
    });

    if (body.publishNow) {
      await this.publishInternal(created.id);
    }
    return created;
  }

  @Patch(':id')
  @RequiresPermission('announcements.write')
  async update(
    @Param('id') id: string,
    @Body() body: UpdateAnnouncementDto,
    @CurrentJwt() jwt: KeycloakJwtPayload,
  ) {
    const me = await this.users.ensureUser(jwt);
    const a = await this.prisma.announcement.findUnique({ where: { id } });
    if (!a || a.tenantId !== me.tenantId) throw new NotFoundException();
    if (a.authorId !== me.id && !(jwt.realm_access?.roles ?? []).includes('school_admin')) {
      throw new BadRequestException("Vous ne pouvez modifier que vos propres annonces.");
    }
    return this.prisma.announcement.update({
      where: { id },
      data: {
        ...(body.title !== undefined ? { title: body.title.trim() } : {}),
        ...(body.body !== undefined ? { body: body.body } : {}),
        ...(body.priority !== undefined ? { priority: body.priority } : {}),
        ...(body.expiresAt !== undefined
          ? { expiresAt: body.expiresAt ? new Date(body.expiresAt) : null }
          : {}),
        ...(body.pinned !== undefined ? { pinned: body.pinned } : {}),
        ...(body.attachments !== undefined ? { attachments: body.attachments as never } : {}),
      },
    });
  }

  @Post(':id/publish')
  @RequiresPermission('announcements.write')
  async publish(@Param('id') id: string, @CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    const a = await this.prisma.announcement.findUnique({ where: { id } });
    if (!a || a.tenantId !== me.tenantId) throw new NotFoundException();
    if (a.publishedAt) {
      return { ok: true, alreadyPublished: true, publishedAt: a.publishedAt };
    }
    return this.publishInternal(id);
  }

  @Post(':id/read')
  @RequiresPermission('announcements.read')
  async markRead(@Param('id') id: string, @CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    const receipt = await this.prisma.announcementReceipt.findUnique({
      where: { announcementId_userProfileId: { announcementId: id, userProfileId: me.id } },
    });
    if (!receipt) throw new NotFoundException();
    if (receipt.readAt) return { ok: true, alreadyRead: true };
    await this.prisma.announcementReceipt.update({
      where: { id: receipt.id },
      data: { readAt: new Date() },
    });
    return { ok: true };
  }

  @Delete(':id')
  @RequiresPermission('announcements.write')
  async remove(@Param('id') id: string, @CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    const a = await this.prisma.announcement.findUnique({ where: { id } });
    if (!a || a.tenantId !== me.tenantId) throw new NotFoundException();
    if (a.authorId !== me.id && !(jwt.realm_access?.roles ?? []).includes('school_admin')) {
      throw new BadRequestException("Vous ne pouvez supprimer que vos propres annonces.");
    }
    await this.prisma.announcement.delete({ where: { id } });
    return { ok: true };
  }

  private async publishInternal(id: string) {
    const a = await this.prisma.announcement.findUniqueOrThrow({ where: { id } });
    const recipients = await this.recipients.computeRecipients(a);
    const inserted = await this.recipients.materialiseReceipts(id, recipients);
    await this.prisma.announcement.update({
      where: { id },
      data: { publishedAt: a.publishedAt ?? new Date() },
    });

    // Fan out into the unified Notification feed (R8). Deduped on sourceId
    // so re-publishing the same announcement doesn't ping recipients twice.
    if (recipients.size > 0) {
      const severityFromPriority =
        a.priority === 'urgent'
          ? ('danger' as const)
          : a.priority === 'high'
            ? ('warning' as const)
            : ('info' as const);
      await this.notifications.createMany(
        [...recipients].map((userProfileId) => ({
          tenantId: a.tenantId,
          userProfileId,
          kind: 'announcement' as const,
          severity: severityFromPriority,
          title: a.title,
          body: a.body ? a.body.slice(0, 280) : null,
          link: `/parent/announcements`,
          sourceType: 'announcement',
          sourceId: a.id,
        })),
      );
    }

    return { ok: true, publishedAt: new Date(), recipientCount: inserted };
  }

  /**
   * S-E01-1f (AC-3 / PM-5) — L'EMPREINTE D'ENSEIGNEMENT, FACTORISÉE.
   *
   * Le corps est celui qui vivait EN LIGNE dans `create` (`:466-485` à
   * `bc4e590`), déplacé mot pour mot — mêmes messages, même ordre, même
   * `tenantId` sur la recherche d'affectation — et appelé désormais par `create`
   * ET par `previewRecipients`. Deux copies à la main d'une règle
   * d'autorisation, c'est la dérive que ce dépôt a déjà payée ; et c'est
   * précisément l'écart qui laissait un enseignant énumérer par le preview une
   * classe qu'il ne pouvait pas cibler par la publication.
   *
   * PORTÉE de ce contrôle, dite honnêtement : il ne couvre que
   * `class_section_scope`. Un enseignant peut toujours viser N'IMPORTE QUEL
   * élève (`individual_student`) ou N'IMPORTE QUEL niveau / cycle de SON tenant.
   * Les sondes de propriété prouvent le TENANT, jamais l'empreinte — ne pas
   * décrire AC-1 comme fermant la frontière enseignant. C'est un finding
   * séparé, pas ce diff.
   */
  private async assertTeacherScope(
    me: { id: string; tenantId: string },
    scope: AnnouncementScope,
    classSectionId: string | null,
  ) {
    if (scope === 'school_wide' || scope === 'individual_user') {
      throw new BadRequestException(
        "Cette portée est réservée à l'administration. Choisissez une classe, un niveau ou un cycle où vous enseignez.",
      );
    }
    if (scope === 'class_section_scope' && classSectionId) {
      const teacher = await this.prisma.teacherProfile.findFirst({
        where: { userProfileId: me.id },
        select: { id: true },
      });
      if (!teacher) throw new BadRequestException("Profil enseignant introuvable.");
      const assignment = await this.prisma.teachingAssignment.findFirst({
        where: {
          tenantId: me.tenantId,
          teacherProfileId: teacher.id,
          classSectionId,
        },
        select: { id: true },
      });
      if (!assignment) {
        throw new BadRequestException(
          "Vous ne pouvez diffuser une annonce qu'aux classes que vous enseignez.",
        );
      }
    }
  }

  private validateScope(b: CreateAnnouncementDto) {
    const ensure = (k: keyof CreateAnnouncementDto) => {
      if (!b[k]) throw new BadRequestException(`Champ requis : ${String(k)} pour cette portée.`);
    };
    switch (b.scope) {
      case 'cycle_scope':
        ensure('cycleId');
        break;
      case 'grade_level_scope':
        ensure('gradeLevelId');
        break;
      case 'class_section_scope':
        ensure('classSectionId');
        break;
      case 'individual_student':
        ensure('studentId');
        break;
      case 'individual_user':
        ensure('userProfileId');
        break;
      case 'school_wide':
      default:
        break;
    }
  }
}
