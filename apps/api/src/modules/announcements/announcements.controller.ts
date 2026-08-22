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
import { TenantScopeService } from '../../shared/prisma/tenant-scope.service';
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

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ S-E01-1g / PF-232 / ADR-054 — `announcements` ENTRE PARTIELLEMENT DANS LA │
 * │ PORTÉE TENANT. « PARTIELLEMENT » EST LE MOT EXACT (DNC-06).              │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * CONVERTIS, handler ENTIER par handler ENTIER (AC-2 / PF-217) — `unreadCount`,
 * `create`, `update`, `publish`, `markRead`. Douze sites d'appel passent de
 * `this.prisma.X` à `tx.X`.
 *
 * NON CONVERTIS, chacun avec le MÉCANISME écrit sur son propre docblock, jamais
 * « pas encore fait » — `list`, `getOne`, `previewRecipients`, `remove`,
 * `publishInternal`, `assertTeacherScope`, plus les DIX sites d'appel de
 * `AnnouncementRecipientsService`.
 *
 * LE CRITÈRE, énoncé une fois puisqu'il produit toute la partition ci-dessus :
 * un handler n'est convertible que si TOUTES les instructions qu'il provoque
 * sont LEXICALEMENT dans le callback. Un appel à un service injecté qui ferme
 * sur son PROPRE `PrismaService` casse ce critère du côté dangereux — ses
 * instructions partent sur la connexion du PROPRIÉTAIRE pendant que la
 * connexion applicative tient une transaction interactive ouverte, invisible au
 * typage `Prisma.TransactionClient` ET au compteur, qui est LEXICAL et ne
 * traverse pas `this` (PF-200). C'est le refus déjà posé par
 * `calendar.controller.ts:464` (CalendarSeedService) et
 * `lessons.controller.ts:166` (NotificationsService) ; c'est ici sa TROISIÈME
 * occurrence, donc une décision d'architecture (ADR-054 §D1) et plus un
 * commentaire local.
 *
 * CE QUE CE DIFF NE FAIT PAS, écrit plutôt que sous-entendu : l'application se
 * connecte TOUJOURS comme PROPRIÉTAIRE des tables, qui échappe à ses propres
 * policies faute de `FORCE ROW LEVEL SECURITY`. Le prédicat `tenantId`
 * explicite fait donc TOUT le travail et RLS ne le double pas. Aucun handler
 * ci-dessous n'est « isolé » ; le module n'est pas « converti » ; il est
 * PARTIELLEMENT converti, et la table qu'il possède (`announcement_receipt`)
 * est encore ÉCRITE entièrement hors portée, par `materialiseReceipts`.
 */
@ApiTags('announcements')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('announcements')
export class AnnouncementsController {
  constructor(
    /**
     * S-E01-1g — TOUJOURS INJECTÉ, et ce n'est pas de la dette : les handlers
     * NON convertis (`list`, `getOne`, `previewRecipients`, `remove`) et les
     * deux méthodes privées (`publishInternal`, `assertTeacherScope`) émettent
     * encore sur la connexion du PROPRIÉTAIRE. Chacun porte son docblock
     * d'exclusion qui en NOMME LE MÉCANISME.
     */
    private readonly prisma: PrismaService,
    private readonly scope: TenantScopeService,
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
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ S-E01-1g — NON CONVERTI, ET LE MÉCANISME N'EST PAS « pas le temps »       │
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   *  1. **G-TRUTH.** `_count: { select: { recipients: true } }` (`:200`, `:217`)
   *     compte les lignes BRUTES d'`announcement_receipt`, lignes étrangères
   *     comprises — contrairement à `getOne`, qui résout ses reçus contre la
   *     recherche de profils DÉJÀ filtrée par tenant (`:559`). Les deux nombres
   *     DIVERGENT donc aujourd'hui, légitimement, pour tout tenant portant des
   *     lignes sombres héritées de PF-208. Passer ce `_count` sous la policy
   *     FK-dérivée CHANGERAIT le nombre affiché sur `/admin/announcements`
   *     sans qu'une seule ligne d'`apps/web` bouge : une réconciliation
   *     silencieuse d'une divergence réelle. C'est une décision produit, elle
   *     mérite son propre diff et sa propre fixture avant/après.
   *  2. **Budget.** La branche administrateur n'a AUCUN `take` : `findMany`
   *     complet + quatre `include` + un compte corrélé, dans une transaction
   *     interactive plafonnée à 5 s. `lessons.controller.ts:358` calcule sa
   *     borne HORS portée précisément pour ça ; ici il n'y a pas de borne à
   *     hisser, il faut en INVENTER une, ce qui change le contrat de l'API.
   *
   * CONSÉQUENCE ASSUMÉE : ces quatre sites restent sur la connexion du
   * PROPRIÉTAIRE et comptent NON COUVERTS. Ils ne sont PAS ajoutés à
   * `ENUMERATED_OUTSIDE_SCOPE` — l'énumération est une liste de RAISONS
   * STRUCTURELLES, pas de chemins en attente (ADR-048 §D6).
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

  /**
   * S-E01-1g — CONVERTI. UNE instruction, bornée par le SCHÉMA (un `count`), et
   * le handler ENTIER passe (AC-2) : il n'a rien d'autre à convertir.
   *
   * CLÔTURE — le filtre imbriqué `announcement: { … }` est une JOINTURE : il
   * exige `SELECT` sur `announcement` en plus d'`announcement_receipt`. Le
   * cliquet d'AC-6 dérive les privilèges de `tx.<modèle>.<verbe>(` et ne peut
   * PAS voir cette table-là ; elle est donc déclarée explicitement dans
   * `APP_ROLE_REQUIRED_PRIVILEGES` avec cette raison écrite.
   */
  @Get('unread-count')
  @RequiresPermission('announcements.read')
  async unreadCount(@CurrentJwt() jwt: KeycloakJwtPayload) {
    // HORS PORTÉE PAR NÉCESSITÉ (PF-199) : `ensureUser` PRODUIT le tenantId
    // qu'une portée exigerait ; elle ne peut pas le consommer.
    const me = await this.users.ensureUser(jwt);
    const tenantId = me.tenantId;
    const n = await this.scope.run(tenantId, async (tx) =>
      tx.announcementReceipt.count({
        where: {
          userProfileId: me.id,
          readAt: null,
          announcement: {
            tenantId,
            publishedAt: { not: null },
            OR: [{ expiresAt: null }, { expiresAt: { gte: new Date() } }],
          },
        },
      }),
    );
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
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ S-E01-1g — NON CONVERTI : L'EXCLUSION EST AU MILIEU DU HANDLER           │
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   * `this.recipients.computeRecipients` (`:397`) est ASSIS ENTRE les cinq sondes
   * de propriété (`:360-388`) et le `userProfile.findMany` final (`:420`).
   * `AnnouncementRecipientsService` ferme sur son PROPRE `PrismaService`
   * (`announcements.service.ts:52`) : appelé depuis l'intérieur d'un callback il
   * émettrait sur la connexion du PROPRIÉTAIRE pendant que la connexion
   * applicative tient la transaction — DEUX connexions retenues par requête
   * contre un `connection_limit=5` documenté, invisibles au typage comme au
   * compteur.
   *
   * Il reste donc TROIS formes possibles, et les trois sont refusées :
   *   (a) tout convertir → l'appel de service part sur le propriétaire depuis
   *       l'intérieur d'une portée : de la couverture FAUSSE, strictement pire
   *       qu'un site non couvert, qui lui se voit dans le total ;
   *   (b) convertir la moitié → `classifyCallSite` rend `owner-inside-scope`,
   *       compté NON COUVERT et NOMMÉ : le compteur recule (PF-217) ;
   *   (c) scinder en deux portées → deux transactions interactives, donc deux
   *       instantanés, sur un chemin de LECTURE dont tout l'intérêt est la
   *       cohérence du compte rendu.
   *
   * MESURÉ, et c'est ce qui tranche entre « exclure » et « lui passer un `tx` » :
   * ce service n'ouvre AUCUN `$transaction`, donc un paramètre `tx` COMPILERAIT
   * (contrairement à `CalendarSeedService`). Il déplacerait néanmoins le
   * compteur de ZÉRO — son fichier n'ouvre AUCUNE portée, donc ses dix
   * sites restent `covered === false` quel que soit le nom du récepteur — tout
   * en ajoutant cinq tables à une clôture VÉRIFIÉE AU DÉMARRAGE, globalement,
   * pour TOUS les modules convertis. Coût réel, gain nul, rayon de souffle
   * maximal : ADR-054 §D2.
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

  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ S-E01-1g — NON CONVERTI. TOUT-OU-RIEN, et le « tout » coûte trop.        │
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   * Ce handler a CINQ sites d'appel, et l'un d'eux se cache : la mise à jour
   * « lu automatiquement » (`:486`) vit dans la branche de RETOUR ANTICIPÉ des
   * non-administrateurs. Convertir les quatre visibles laisserait un
   * `this.prisma.*` DANS un callback, donc `owner-inside-scope` : compté NON
   * COUVERT, nommé par le script, et le compteur RECULE (PF-217). Les cinq
   * passent, ou aucun.
   *
   * Le « tout » est refusé pour deux raisons mesurées :
   *  1. **G-TRUTH.** `stats.total`, `readRate` et `recipients[]` sont des
   *     projections RENDUES, et elles sont honnêtes précisément grâce à la
   *     résolution `receipts.filter(profileById.has(...))` de S-E01-1f (`:559`).
   *     Les faire passer sous la policy FK-dérivée d'`announcement_receipt`
   *     déplacerait ces nombres pour les tenants portant des lignes sombres —
   *     un changement UTILISATEUR sans une ligne d'`apps/web` modifiée. À
   *     prouver par fixture avant/après, dans son propre diff.
   *  2. **Budget.** 500 reçus puis un `userProfile.findMany` sur jusqu'à 500 ids
   *     avec un `include` imbriqué `userRoles.role`, dans une transaction
   *     interactive de 5 s.
   *
   * Conséquence : cinq sites restent sur la connexion du PROPRIÉTAIRE, non
   * couverts, non énumérés (ADR-048 §D6). Corollaire utile : `user_role` et
   * `role` ne sont atteints QUE par ce handler et par `previewRecipients`, tous
   * deux hors portée — ils n'ont donc AUCUNE entrée de clôture dans ce diff, et
   * c'est volontaire (PF-219 : une entrée qu'aucune instruction de portée
   * n'exerce certifie une clôture que personne ne vérifie).
   */
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
    // `tenantId` EXPLICITE dans chaque `where`, MÊME converti (ADR-042 §D1) :
    // sur `degraded_no_app_url` — c'est-à-dire TOUS les déploiements
    // d'aujourd'hui — la portée s'ouvre sur le client PROPRIÉTAIRE, qui échappe
    // à ses propres policies faute de `FORCE ROW LEVEL SECURITY`. Ce prédicat
    // fait donc encore TOUT le travail ; RLS ne le double pas. Le retirer parce
    // que « la portée s'en charge » rouvrirait PF-208 partout.
    //
    // `await` SÉQUENTIEL, jamais `Promise.all` : une transaction interactive est
    // UNE connexion.
    //
    // La boucle et son `switch` restent écrits EN LIGNE DANS le callback, jamais
    // derrière un `this.<méthode>()` ni derrière un résolveur partagé :
    // l'attribution de `tenant-adversarial-check.js` est LEXICALE et ne traverse
    // pas `this` (PF-200 / ADR-053 §D2).
    //
    // BUDGET D'INSTRUCTIONS DANS LA PORTÉE : DEUX au maximum — `assertScopeCoherence`
    // plafonne le plan à UNE sonde, puis l'écriture. Borné par le SCHÉMA, jamais
    // par la requête (ADR-048 §D3 amendé).
    const tenantId = me.tenantId;
    const now = new Date();
    const created = await this.scope.run(tenantId, async (tx) => {
      for (const ref of scopeOwnershipPlan(body, ANNOUNCEMENT_SCOPE_FIELDS)) {
        let owned: { id: string } | null;
        switch (ref.field) {
          case 'cycleId':
            owned = await tx.cycle.findFirst({
              where: { id: ref.id, tenantId },
              select: { id: true },
            });
            break;
          case 'gradeLevelId':
            owned = await tx.gradeLevel.findFirst({
              where: { id: ref.id, tenantId },
              select: { id: true },
            });
            break;
          case 'classSectionId':
            owned = await tx.classSection.findFirst({
              where: { id: ref.id, tenantId },
              select: { id: true },
            });
            break;
          case 'studentId':
            owned = await tx.student.findFirst({
              where: { id: ref.id, tenantId },
              select: { id: true },
            });
            break;
          case 'userProfileId':
            owned = await tx.userProfile.findFirst({
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

      return tx.announcement.create({
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
    });

    // APRÈS la fermeture de la portée, jamais dedans — et c'est le point le plus
    // dangereux de cette tranche. `publishInternal` calcule un roster
    // proportionnel à (effectif × responsables légaux), matérialise N reçus,
    // puis ENFILE un job BullMQ : dans une transaction interactive plafonnée à
    // 5 s il expirerait en P2028 sur le tenant qui a les plus grosses classes —
    // c'est-à-dire en production et pas en recette — et il notifierait AVANT le
    // commit. Séquentiellement IDENTIQUE à HEAD, où aucune transaction
    // n'enveloppait `create`.
    if (body.publishNow) {
      await this.publishInternal(created.id);
    }
    return created;
  }

  /**
   * S-E01-1g — CONVERTI. DEUX instructions, et la conversion FERME une fenêtre
   * TOCTOU réelle : la garde d'autorisation (`findUnique` + les deux tests
   * ci-dessous) et l'écriture qu'elle autorise partagent désormais UNE
   * transaction, donc UN instantané. C'est l'argument exact que
   * `calendar_event.UPDATE` porte déjà dans la clôture.
   *
   * Les gardes sont REBRANCHÉES, jamais réécrites : `a.tenantId !== me.tenantId`
   * et le test `authorId` / `school_admin` survivent à l'octet près, dans le
   * même ordre, seul le RÉCEPTEUR change (ADR-042 §D1).
   */
  @Patch(':id')
  @RequiresPermission('announcements.write')
  async update(
    @Param('id') id: string,
    @Body() body: UpdateAnnouncementDto,
    @CurrentJwt() jwt: KeycloakJwtPayload,
  ) {
    const me = await this.users.ensureUser(jwt);
    const tenantId = me.tenantId;
    return this.scope.run(tenantId, async (tx) => {
      const a = await tx.announcement.findUnique({ where: { id } });
      if (!a || a.tenantId !== me.tenantId) throw new NotFoundException();
      if (a.authorId !== me.id && !(jwt.realm_access?.roles ?? []).includes('school_admin')) {
        throw new BadRequestException("Vous ne pouvez modifier que vos propres annonces.");
      }
      return tx.announcement.update({
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
    });
  }

  /**
   * S-E01-1g — CONVERTI sur sa GARDE, et sur elle seule. UNE instruction dans la
   * portée ; `publishInternal` est appelé APRÈS que la portée s'est refermée.
   *
   * Ce n'est pas un demi-handler au sens de PF-217 : `classifyCallSite` est
   * POSITIONNEL, et l'unique site d'appel lexicalement présent dans ce handler
   * — la lecture de garde ci-dessous — est dans le callback. Les sites de
   * `publishInternal` appartiennent à `publishInternal` — ils sont NOMMÉS,
   * exclus, et comptent non couverts là-bas.
   *
   * L'appel doit rester DEHORS : `TenantScopeService.run` RÉUTILISE un cadre
   * actif du même tenant sans nouveau BEGIN, donc un `publishInternal` appelé
   * de l'intérieur ferait rejoindre tout le fan-out à cette transaction — et
   * son expiration ferait alors rouler en arrière la publication elle-même.
   */
  @Post(':id/publish')
  @RequiresPermission('announcements.write')
  async publish(@Param('id') id: string, @CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    const tenantId = me.tenantId;
    const a = await this.scope.run(tenantId, async (tx) => {
      const found = await tx.announcement.findUnique({ where: { id } });
      if (!found || found.tenantId !== me.tenantId) throw new NotFoundException();
      return found;
    });
    if (a.publishedAt) {
      return { ok: true, alreadyPublished: true, publishedAt: a.publishedAt };
    }
    return this.publishInternal(id);
  }

  /**
   * S-E01-1g — CONVERTI. DEUX instructions, une lecture de garde et une écriture
   * d'une seule ligne : borné par le SCHÉMA (la clé unique
   * `announcementId_userProfileId`), jamais par la requête. Le chemin le plus
   * chaud des portails PARENT et ÉLÈVE, donc celui qu'il ne faut pas alourdir —
   * et il ne l'est pas : la portée n'ajoute pas une instruction.
   */
  @Post(':id/read')
  @RequiresPermission('announcements.read')
  async markRead(@Param('id') id: string, @CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    const tenantId = me.tenantId;
    return this.scope.run(
      tenantId,
      async (tx): Promise<{ ok: true; alreadyRead?: true }> => {
        const receipt = await tx.announcementReceipt.findUnique({
          where: { announcementId_userProfileId: { announcementId: id, userProfileId: me.id } },
        });
        if (!receipt) throw new NotFoundException();
        if (receipt.readAt) return { ok: true, alreadyRead: true };
        await tx.announcementReceipt.update({
          where: { id: receipt.id },
          data: { readAt: new Date() },
        });
        return { ok: true };
      },
    );
  }

  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ S-E01-1g — NON CONVERTI : UNE HYPOTHÈSE NON PROUVÉE SUR UNE CASCADE      │
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   * `announcement.delete` déclenche `onDelete: Cascade` vers
   * `announcement_receipt` (`schema.prisma`). MESURÉ dans la migration dérivée
   * (`20260813180000_tenant_rls_derived_policies:371`) : `app_user` détient sur
   * cette table `SELECT, INSERT, UPDATE` — et l'ensemble des privilèges
   * autorisés y est CLOS, sans `DELETE` (ADR-042 §D5).
   *
   * PostgreSQL exécute l'action référentielle par un trigger RI, au nom du
   * propriétaire de la contrainte, donc la suppression est ATTENDUE comme
   * passante — mais RIEN dans ce dépôt ne le PROUVE, et si l'hypothèse est
   * fausse chaque suppression d'annonce lève 42501 après la bascule. Deux
   * relecteurs indépendants ont demandé « prouve-le ou exclus-le » ; on exclut,
   * parce qu'une preuve par exécution appartient au harnais
   * `rls-isolation-check.js` et non à ce diff.
   *
   * CONSÉQUENCE DIRECTE ET VOULUE : `announcement` n'obtient PAS d'entrée
   * `DELETE` dans `APP_ROLE_REQUIRED_PRIVILEGES`. Chaque entrée déclarée par
   * cette tranche est exercée par un site d'appel converti du MÊME diff — c'est
   * l'inverse exact de la forme PF-219, et ce n'est vrai QUE parce que la
   * partition est étroite.
   */
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

  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ S-E01-1g — HORS PORTÉE, DÉLIBÉRÉMENT, POUR TROIS MÉCANISMES MESURÉS      │
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   *  1. **DEUX collaborateurs ferment sur leur PROPRE `PrismaService`** —
   *     `AnnouncementRecipientsService` (`announcements.service.ts:52`) et
   *     `NotificationsService` (PF-218). Appelés d'une portée, leurs
   *     instructions partent sur la connexion du PROPRIÉTAIRE pendant que la
   *     connexion applicative tient la transaction : deux connexions retenues
   *     par requête contre un `connection_limit=5`, et une couverture FAUSSE
   *     puisque le compteur, lexical, ne les voit pas.
   *  2. **Le coût est proportionnel à la REQUÊTE, pas au SCHÉMA.**
   *     `computeRecipients` pour `school_wide` lit TOUS les profils actifs du
   *     tenant ; `materialiseReceipts` insère N lignes ; `createMany` déduplique
   *     par un `OR` à N termes. Dans une transaction interactive de 5 s, une
   *     école de mille profils expire en P2028 — et l'échec est DÉPENDANT DE LA
   *     CHARGE, donc invisible à toute fixture.
   *  3. **Le fan-out ferait de l'E/S EXTERNE avant le COMMIT.**
   *     `dispatchEmails` enfile un job BullMQ : publié depuis une transaction,
   *     il annonce une publication qu'un rollback peut encore annuler.
   *
   * CONSÉQUENCE ÉCRITE PLUTÔT QUE SOUS-ENTENDUE : ces sites restent sur la
   * connexion du PROPRIÉTAIRE et comptent NON COUVERTS. Ils ne sont PAS ajoutés
   * à `ENUMERATED_OUTSIDE_SCOPE` : leur seule raison disponible serait « pas
   * encore converti », et l'énumération est une liste de RAISONS, pas de chemins
   * (ADR-048 §D6). Corollaire : `notification` n'obtient AUCUNE entrée de
   * clôture — la table n'est atteinte que par ce chemin non converti.
   */
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
   *
   * S-E01-1g — HORS PORTÉE, ET APPELÉ AVANT QU'AUCUNE PORTÉE NE S'OUVRE, dans
   * `create` comme dans `previewRecipients`. Deux raisons, l'ordre d'abord :
   * un refus de RÔLE ne doit coûter AUCUNE transaction, et le déplacer après
   * l'ouverture de la portée réordonnerait une garde d'autorisation (G-AUTHZ).
   * Ensuite l'attribution : le corps de cette méthode privée est LEXICALEMENT
   * hors de tout callback, donc lui passer un `tx` ferait tourner ses deux
   * instructions DANS la portée pendant que le compteur les lit toujours comme
   * non couvertes — le faux négatif de PF-200. Ses deux sites restent sur la
   * connexion du PROPRIÉTAIRE, non couverts, non énumérés.
   *
   * DURCISSEMENT au passage (pré-mortem FM-12) : la recherche de profil
   * enseignant ne portait AUCUN `tenantId` — elle n'était protégée
   * qu'INCIDEMMENT, parce que `me.id` a déjà été vérifié par `ensureUser`.
   * C'est la « protection accidentelle » que PF-208 nomme ; le prédicat la rend
   * structurelle. `teacher_profile.tenant_id` existe au schéma, donc ce
   * durcissement ne restreint aucun appelant légitime.
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
        where: { userProfileId: me.id, tenantId: me.tenantId },
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
