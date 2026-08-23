import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  ParseEnumPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
// `Prisma` reste importé pour le typage `Prisma.TransactionClient` du helper
// `resolveParentClassSectionIds`. Le seul usage en VALEUR qu'il avait
// (`instanceof Prisma.PrismaClientKnownRequestError`) est parti avec
// `mapWriteRefusal` dans `shared/prisma/write-refusal.ts` (S-E01-1e).
import { CalendarEventScope, CalendarEventType, CalendarEventVisibility, Prisma } from '@prisma/client';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

import {
  type ClientHintsRequest,
  extractAuditClientHints,
} from '../../shared/audit/client-hints';
import { deriveAlertActorProvenance } from '../../shared/audit/provenance';
import { CurrentJwt } from '../../shared/auth/current-user.decorator';
import { JwtAuthGuard } from '../../shared/auth/jwt-auth.guard';
import { type KeycloakJwtPayload } from '../../shared/auth/jwt.strategy';
import { PermissionsGuard } from '../../shared/auth/permissions.guard';
import { RequiresPermission } from '../../shared/auth/requires-permission.decorator';
import { UserSyncService } from '../../shared/auth/user-sync.service';
import {
  assertSingleScopeId,
  scopeOwnershipPlan,
  unknownScopeRef,
} from '../../shared/prisma/scope-fk';
import { TenantScopeService } from '../../shared/prisma/tenant-scope.service';
import { mapWriteRefusal } from '../../shared/prisma/write-refusal';
import { SchoolContextService } from '../school-structure/school-context.service';
import { StudentAccessService } from '../students/student-access.service';

import { CalendarSeedService } from './calendar-seed.service';
import { MAX_SEED_YEAR, MIN_SEED_YEAR } from './french-holidays';

/**
 * Construit le fragment de `where` Prisma qui applique l'ABAC de visibilité du
 * calendrier pour un rôle donné. Extrait comme fonction pure pour pouvoir être
 * testé unitairement (cf. `calendar.access.spec.ts`).
 *
 * - **admin** (super_admin / school_admin) : aucune restriction → `{}` (voit tout).
 * - **teacher** : `visibility ∈ {all, staff_only}` (jamais `admin_only`).
 * - **parent** : `visibility = all` ET portée pertinente, c.-à-d. soit un
 *   événement `school_wide`, soit un événement `class_section_scope` ciblant
 *   l'une des classes (`classSectionIds`) de ses enfants. Les portées
 *   intermédiaires (cycle / niveau) restent visibles tant qu'elles sont
 *   `visibility = all` — on ne masque que le bruit `class_section_scope` des
 *   autres classes. Les events `staff_only` / `admin_only` ne fuient jamais.
 *
 * `classSectionIds` n'est consulté que pour la branche parent.
 */
export function calendarVisibilityWhere(
  roles: string[],
  classSectionIds: string[],
): Record<string, unknown> {
  const isAdmin = roles.includes('super_admin') || roles.includes('school_admin');
  if (isAdmin) return {};

  const isStaff = roles.includes('teacher');
  if (isStaff) {
    return {
      visibility: { in: [CalendarEventVisibility.all, CalendarEventVisibility.staff_only] },
    };
  }

  // Parent : uniquement le public (`all`), restreint aux portées qui le concernent.
  return {
    visibility: CalendarEventVisibility.all,
    OR: [
      { scope: { not: CalendarEventScope.class_section_scope } },
      { classSectionId: { in: classSectionIds } },
    ],
  };
}

/**
 * S-E01-5 / PF-204 — LES QUATRE CLÉS ÉTRANGÈRES DE PORTÉE, ET POURQUOI RLS NE
 * LES COUVRE PAS (ADR-049 §D1, ADR-042 §D6).
 *
 * `calendar_event` porte quatre FK MONO-COLONNE qui nomment une portée :
 * `academicYearId`, `cycleId`, `gradeLevelId`, `classSectionId`. PostgreSQL
 * évalue l'intégrité référentielle EN DEHORS de la row security : le `WITH
 * CHECK` de `tenant_isolation` ne voit que `calendar_event.tenant_id`, et la
 * contrainte qui valide `cycle_id` s'exécute en tant que propriétaire de
 * `cycle`, policy éteinte. Un `cycleId` d'un AUTRE tenant s'insère donc
 * proprement sous une policy parfaitement correcte — puis `list`'s `include`
 * rend son `name` dans le portail parent du tenant A.
 *
 * Ces trois helpers sont PURS et SANS Prisma : ils décident QUOI vérifier. La
 * boucle `findFirst`, elle, est IMPURE et écrite EN LIGNE dans chaque callback
 * de `this.scope.run(...)` — jamais derrière un `this.<méthode>()`, parce que le
 * compteur de couverture de `tenant-adversarial-check.js` est LEXICAL et ne
 * traverse pas `this` (PF-200).
 */

/** Les trois portées mutuellement exclusives, dans l'ordre d'inférence de `finalScope`. */
export const SCOPE_ID_FIELDS = ['classSectionId', 'gradeLevelId', 'cycleId'] as const;
export type ScopeIdField = (typeof SCOPE_ID_FIELDS)[number];
/** Tout ce dont `createEvent` doit prouver la propriété (l'année scolaire incluse). */
export type OwnedScopeField = ScopeIdField | 'academicYearId';

/**
 * Ce que `createEvent` ÉCRIT, donc ce qu'il vérifie — année scolaire comprise,
 * parce que son bloc `data` la persiste (contrairement à celui d'`update`).
 * RÈGLE : on vérifie EXACTEMENT les ids que l'on persiste.
 */
export const CREATE_OWNED_SCOPE_FIELDS = ['academicYearId', ...SCOPE_ID_FIELDS] as const;

/**
 * S-E01-1f / ADR-053 §D2 — `ScopeIdCarrier`, `assertSingleScopeId`,
 * `scopeOwnershipPlan` et `unknownScopeRef` vivent désormais dans
 * `shared/prisma/scope-fk.ts`, aux côtés d'`isSuppliedScopeId` (déjà promu par
 * S-E01-1e / ADR-051 §D3). `announcements` est le DEUXIÈME consommateur d'UNE
 * implémentation, au lieu d'une troisième copie écrite à la main.
 *
 * Ce qui RESTE ici, et pourquoi : la LISTE des champs. `SCOPE_ID_FIELDS` et
 * `CREATE_OWNED_SCOPE_FIELDS` décrivent ce que `calendar_event` porte — élargir
 * une union partagée à chaque module en ferait une liste tenue à la main de
 * plus. Les helpers sont génériques sur `F extends string` et lisent le tuple
 * qu'on leur passe.
 *
 * Aucun ré-export de complaisance ici : deux adresses pour une règle est
 * précisément ce que l'extraction empêche.
 *
 * La boucle `findFirst`, elle, reste écrite EN LIGNE dans chaque callback
 * `this.scope.run(...)` — jamais derrière un `this.<méthode>()` — parce que le
 * compteur de couverture de `tenant-adversarial-check.js` est LEXICAL et ne
 * traverse pas `this` (PF-200).
 */

class CreateCalendarEventDto {
  @IsString() @MinLength(1) @MaxLength(200) title!: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsEnum(CalendarEventType) type!: CalendarEventType;
  @IsOptional() @IsEnum(CalendarEventScope) scope?: CalendarEventScope;
  @IsOptional() @IsEnum(CalendarEventVisibility) visibility?: CalendarEventVisibility;
  @IsDateString() startsAt!: string;
  @IsDateString() endsAt!: string;
  @IsOptional() @IsBoolean() allDay?: boolean;
  @IsOptional() @IsString() color?: string;
  @IsOptional() @IsString() icon?: string;
  @IsOptional() @IsUUID() academicYearId?: string;
  @IsOptional() @IsUUID() cycleId?: string;
  @IsOptional() @IsUUID() gradeLevelId?: string;
  @IsOptional() @IsUUID() classSectionId?: string;
}

class UpdateCalendarEventDto extends CreateCalendarEventDto {
  @IsOptional() @IsString() @MaxLength(200) override title!: string;
  @IsOptional() @IsEnum(CalendarEventType) override type!: CalendarEventType;
  @IsOptional() @IsDateString() override startsAt!: string;
  @IsOptional() @IsDateString() override endsAt!: string;
}

/**
 * Corps de `POST /calendar/events/seed-french-holidays`.
 *
 * `year` est **REQUIS** : toute la cascade de replis serveur (année scolaire
 * active → `startDate.getFullYear()`, puis `new Date().getFullYear()`) est
 * SUPPRIMÉE, pas gardée. Le repli *était* l'hypothèse — c'est la moitié
 * « année périmée » de PF-29 — et un 400 sur une année absente vaut mieux que
 * 22 lignes dans la mauvaise année. Changement cassant pour un seul appelant
 * (`apps/web/src/app/admin/calendar/actions.ts`), modifié dans la même PR.
 *
 * Validation à l'idiome de la maison (`classes.controller.ts`, `cycles.controller.ts`) :
 * `@IsInt() @Min() @Max()` **sans** `@Type(() => Number)`. La `ValidationPipe`
 * globale tourne en `transform: true` **sans** `enableImplicitConversion`, donc
 * un nombre JSON arrive déjà en `number` — et `@Type(() => Number)` ferait
 * silencieusement accepter `{"year":"2026"}`, soit l'inverse de l'intention de
 * PF-51. Ferme la famille PF-51 sur ce DTO : `{year:'abc'}` et `{year:1e9}`
 * renvoient 400 au lieu de produire une `Invalid Date` puis un 500 opaque.
 */
export class SeedHolidaysDto {
  @IsInt() @Min(MIN_SEED_YEAR) @Max(MAX_SEED_YEAR) year!: number;
  /** Jamais défaillé côté serveur : son absence est un refus (DNC-12). */
  @IsOptional() @IsBoolean() confirm?: boolean;
  /** Simulation : même lecture, même forme de réponse, aucune écriture. */
  @IsOptional() @IsBoolean() dryRun?: boolean;
}

/**
 * `mapWriteRefusal` (P2025 -> 404, l'oracle d'existence de S-E01-1d §D9) vit
 * désormais dans `shared/prisma/write-refusal.ts` : `lessons.controller.ts` en a
 * besoin à l'identique, et une deuxième copie tenue à la main d'une règle de
 * refus se trompe EN SILENCE — une copie qui oublie le mapping ne casse rien,
 * elle rouvre seulement l'oracle.
 *
 * Conséquence côté UI, inchangée et toujours le contrat de copie de cette
 * story : `aucun changement visible`. `CalendarManager.tsx` affiche `res.error`
 * verbatim ; un message Postgres brut y atterrirait non traduit devant un
 * administrateur.
 */

@ApiTags('calendar')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('calendar')
export class CalendarController {
  constructor(
    private readonly scope: TenantScopeService,
    private readonly users: UserSyncService,
    private readonly ctx: SchoolContextService,
    private readonly studentAccess: StudentAccessService,
    private readonly seed: CalendarSeedService,
  ) {}

  @Get('events')
  @RequiresPermission('calendar.read')
  async list(
    @CurrentJwt() jwt: KeycloakJwtPayload,
    @Query('from') from?: string,
    @Query('to') to?: string,
    // S-E05-17 / ADR-067 §D2 — le type d'evenement etait annote `CalendarEventType`
    // mais ce type est EFFACE a l'execution : la chaine brute atteignait
    // `where.type` et Prisma repondait 500 (mesure). Ici l'allowlist est l'objet
    // enum Prisma LUI-MEME (7 valeurs, deja importe en VALEUR plus haut) : la
    // route accepte exactement l'enum, et aucun consommateur inter-paquet
    // n'existe, donc creer un `CALENDAR_EVENT_TYPE` dans les contrats ne serait
    // qu'une liste jumelle de plus (ADR-067 §D0).
    //
    // `{ optional: true }` ne saute que `undefined`/`null` : `?type=` (present
    // mais VIDE) devient donc 400 la ou il rendait 200. C'est DELIBERE et
    // documente en ADR-067 §D2 — aucune couche de normalisation n'est ajoutee
    // pour preserver l'ancien comportement.
    @Query('type', new ParseEnumPipe(CalendarEventType, { optional: true }))
    type?: CalendarEventType,
    @Query('academicYearId') academicYearId?: string,
  ) {
    const me = await this.users.ensureUser(jwt);
    // UNE seule expression du tenant, réutilisée par le filtre ET par la portée.
    // Deux lectures séparées de `me.tenantId` pourraient diverger, et une portée
    // dont le GUC ne vaut pas le `where.tenantId` rend `{ data: [] }` avec un
    // 200 — indiscernable, dans les quatre portails, d'une école sans événement.
    const tenantId = me.tenantId;
    const { schoolId } = await this.ctx.forTenant(tenantId);
    const where: Record<string, unknown> = { tenantId, schoolId };
    if (from || to) {
      where.startsAt = {
        ...(from ? { gte: new Date(from) } : {}),
        ...(to ? { lte: new Date(to) } : {}),
      };
    }
    if (type) where.type = type;
    if (academicYearId) where.academicYearId = academicYearId;

    // ABAC de visibilité : l'admin voit tout, le teacher voit `all + staff_only`,
    // le parent ne voit que `all` ET les portées qui le concernent (événements
    // de l'école entière OU des classes de ses enfants). On résout les classes
    // des enfants UNIQUEMENT pour un parent (les autres rôles n'en ont pas besoin)
    // afin d'éviter une requête superflue. Empêche toute fuite des événements
    // staff_only / admin_only via l'endpoint de lecture, bien que chaque rôle
    // possède techniquement `calendar.read`.
    const roles = jwt.realm_access?.roles ?? [];
    const isPrivileged =
      roles.includes('super_admin') || roles.includes('school_admin') || roles.includes('teacher');

    // HORS PORTÉE, et par nécessité : `scopeForUser` lit `guardianship` /
    // `student` pour un parent, sur la connexion du PROPRIÉTAIRE. L'appeler
    // depuis l'intérieur de la portée ferait détenir DEUX connexions au
    // processus pendant toute la transaction interactive.
    const parentStudentIds = isPrivileged
      ? null
      : (await this.studentAccess.scopeForUser(me, jwt, schoolId)).studentIds;

    // PORTÉE TARDIVE : tout ce qui précède est terminé. À l'intérieur, au plus
    // DEUX instructions (AC-8) — les inscriptions du parent puis les événements.
    return this.scope.run(tenantId, async (tx) => {
      const classSectionIds =
        parentStudentIds === null || parentStudentIds.length === 0
          ? []
          : await this.resolveParentClassSectionIds(tx, tenantId, parentStudentIds);
      Object.assign(where, calendarVisibilityWhere(roles, classSectionIds));

      // `include` = CLÔTURE RELATIONNELLE : sous RLS, `cycle`, `grade_level` et
      // `class_section` doivent PASSER pour le rôle applicatif aussi. Les trois
      // sont dans les 44 tables accordées ; la sonde de démarrage le vérifie.
      const events = await tx.calendarEvent.findMany({
        where,
        orderBy: { startsAt: 'asc' },
        include: {
          cycle: { select: { name: true, code: true } },
          gradeLevel: { select: { name: true, code: true } },
          classSection: { select: { name: true } },
        },
      });
      return { data: events };
    });
  }

  @Post('events')
  @RequiresPermission('calendar.write')
  async create(@Body() body: CreateCalendarEventDto, @CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    const { schoolId } = await this.ctx.forTenant(me.tenantId);
    return this.createEvent(me, schoolId, body);
  }

  @Patch('events/:id')
  @RequiresPermission('calendar.write')
  async update(
    @Param('id') id: string,
    @Body() body: UpdateCalendarEventDto,
    @CurrentJwt() jwt: KeycloakJwtPayload,
  ) {
    const me = await this.users.ensureUser(jwt);
    const tenantId = me.tenantId;

    // PUR, donc DEHORS (ADR-049 §D3) : une exclusivité mutuelle ne lit pas la
    // base, elle ne peut donc rien révéler, et un corps qu'elle refuse n'ouvre
    // aucune transaction.
    assertSingleScopeId(body, SCOPE_ID_FIELDS);
    // S-E01-5 — `update` ne prouve la propriété QUE des ids qu'il ÉCRIT.
    // `academicYearId` en est délibérément absent : le bloc `data` ci-dessous ne
    // le persiste pas (mesuré, :288-304). Cette asymétrie avec `createEvent` est
    // le symptôme de PF-206 (le DTO l'accepte, l'UI l'envoie à chaque
    // enregistrement, le handler le jette en silence), PAS un trou dans la
    // vérification ; le test G1 épingle la prémisse en LISANT cette source, pour
    // qu'ajouter le champ plus tard vire au rouge au lieu de rester muet.
    const ownership = scopeOwnershipPlan(body, SCOPE_ID_FIELDS);

    // La lecture de garde ET l'écriture dans LA MÊME portée : elles doivent voir
    // le même GUC. Deux portées successives, ce serait deux transactions, donc
    // potentiellement deux connexions.
    return this.scope.run(tenantId, async (tx) => {
      const event = await tx.calendarEvent.findUnique({ where: { id } });
      // Garde applicative CONSERVÉE — défense en profondeur. Le plancher RLS ne
      // la remplace pas : il la double.
      if (!event || event.tenantId !== tenantId) throw new NotFoundException();

      const startsAt = body.startsAt ? new Date(body.startsAt) : event.startsAt;
      const endsAt = body.endsAt ? new Date(body.endsAt) : event.endsAt;
      if (startsAt > endsAt) {
        throw new BadRequestException('startsAt doit être avant endsAt.');
      }

      // ORDRE, et c'est une exigence (ADR-049 §D1) : les sondes de propriété
      // passent APRÈS la garde `event.tenantId`. L'appelant n'apprend rien sur
      // son corps tant qu'il n'a pas prouvé qu'il possède la ligne du chemin.
      //
      // `tenantId` EXPLICITE dans le `where`, gardé même là où RLS le rend
      // redondant (ADR-042 §D1) : exécuté en `app_user` c'est la policy qui
      // travaille, exécuté en PROPRIÉTAIRE — `degraded_no_app_url`, c'est-à-dire
      // TOUS les déploiements d'aujourd'hui, et le propriétaire échappe à ses
      // propres policies — cette clause est la SEULE chose qui travaille.
      //
      // `await` séquentiel, jamais `Promise.all` : une transaction interactive
      // est UNE connexion.
      for (const ref of ownership) {
        let owned: { id: string } | null;
        switch (ref.field) {
          case 'classSectionId':
            owned = await tx.classSection.findFirst({
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
          case 'cycleId':
            owned = await tx.cycle.findFirst({
              where: { id: ref.id, tenantId },
              select: { id: true },
            });
            break;
          default: {
            // Switch CLOS : un cinquième champ ne compile pas, et à l'exécution
            // il REFUSE au lieu de passer (échec fermé).
            const exhaustive: never = ref.field;
            throw unknownScopeRef(exhaustive);
          }
        }
        if (owned === null) throw unknownScopeRef(ref.field);
      }

      try {
        return await tx.calendarEvent.update({
          where: { id },
          data: {
            ...(body.title !== undefined ? { title: body.title } : {}),
            ...(body.description !== undefined ? { description: body.description } : {}),
            ...(body.type !== undefined ? { type: body.type } : {}),
            ...(body.scope !== undefined ? { scope: body.scope } : {}),
            ...(body.visibility !== undefined ? { visibility: body.visibility } : {}),
            ...(body.startsAt !== undefined ? { startsAt } : {}),
            ...(body.endsAt !== undefined ? { endsAt } : {}),
            ...(body.allDay !== undefined ? { allDay: body.allDay } : {}),
            ...(body.color !== undefined ? { color: body.color } : {}),
            ...(body.icon !== undefined ? { icon: body.icon } : {}),
            ...(body.cycleId !== undefined ? { cycleId: body.cycleId || null } : {}),
            ...(body.gradeLevelId !== undefined ? { gradeLevelId: body.gradeLevelId || null } : {}),
            ...(body.classSectionId !== undefined
              ? { classSectionId: body.classSectionId || null }
              : {}),
          },
        });
      } catch (error) {
        throw mapWriteRefusal(error);
      }
    });
  }

  @Delete('events/:id')
  @RequiresPermission('calendar.write')
  async remove(@Param('id') id: string, @CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    const tenantId = me.tenantId;

    return this.scope.run(tenantId, async (tx) => {
      const event = await tx.calendarEvent.findUnique({ where: { id } });
      if (!event || event.tenantId !== tenantId) throw new NotFoundException();
      try {
        await tx.calendarEvent.delete({ where: { id } });
      } catch (error) {
        throw mapWriteRefusal(error);
      }
      return { ok: true };
    });
  }

  /**
   * Importe les jours fériés français des DEUX années civiles `year` et
   * `year + 1` (11 + 11 = 22 événements), de façon idempotente.
   *
   * S-E06-6 / PF-29 — le contrôle écrivait en masse sans rien demander et sans
   * nommer son périmètre. Désormais :
   * - `confirm: true` est exigé **côté serveur** (donc un `curl` y est soumis),
   * - `dryRun: true` renvoie le même plan sans rien écrire, et l'UI construit sa
   *   confirmation EXCLUSIVEMENT depuis cette réponse (DNC-06 rendu
   *   structurellement impossible plutôt que relu),
   * - `year` est requis (plus aucun repli sur l'année scolaire active),
   * - tout l'import + UNE ligne d'audit tiennent dans une seule transaction.
   *
   * IP / user-agent — S-E04-3. Ce handler capturait `@Ip()` + `@Headers('user-agent')`
   * lui-même : sur le chemin piloté par l'UI, `@Ip()` valait l'adresse du
   * conteneur `web` (identique pour tous les acteurs, à jamais — PF-31) et
   * `undici` n'envoyait aucun user-agent du navigateur. Les deux valeurs passent
   * désormais par L'UNIQUE point d'extraction `extractAuditClientHints`, qui
   * applique la règle d'ADR-036 (jeton de transfert vérifié en temps constant,
   * ou `null` — jamais l'adresse du relais) et rend des valeurs DÉJÀ assainies :
   * le service reçoit la même forme qu'avant, donc un cast `inet` raté ne peut
   * toujours pas faire rouler en arrière la transaction qu'il audite (S-E06-6).
   *
   * Aucun intercepteur partagé n'est construit : la décision de S-E04-1 tient,
   * chaque site appelle le seam explicitement, et l'ensemble reste greppable.
   *
   * S-E01-1d — CE HANDLER EST DÉLIBÉRÉMENT HORS DE LA PORTÉE TENANT, et c'est
   * une exclusion NOMMÉE, pas un oubli. `CalendarSeedService` ouvre son propre
   * `this.prisma.$transaction(...)` sur le service injecté : imbriqué dans une
   * portée, il n'aurait PAS été attrapé par le typage `Prisma.TransactionClient`
   * de `withTenant`, parce que le service se referme sur SON PrismaService.
   * Prisma ouvrirait alors une seconde transaction indépendante sur la connexion
   * du PROPRIÉTAIRE, où aucun GUC n'est posé — ça marcherait, en silence, hors
   * de la portée. C'est le danger d'AC-5, vivant, dans le module choisi.
   *
   * C'est aussi le chemin audit-dans-la-transaction d'ADR-035 : les 22
   * événements et LA ligne d'audit tiennent dans une transaction unique, et les
   * séparer pour faire entrer la portée serait payer la conversion en garantie
   * d'audit. Le convertir est sa propre story (PF-198).
   */
  @Post('events/seed-french-holidays')
  @RequiresPermission('calendar.write')
  async seedFrenchHolidays(
    @Body() body: SeedHolidaysDto,
    @CurrentJwt() jwt: KeycloakJwtPayload,
    @Req() req: ClientHintsRequest,
  ) {
    const me = await this.users.ensureUser(jwt);
    const { schoolId } = await this.ctx.forTenant(me.tenantId);
    // Rôle et portail DÉRIVÉS du JWT (helper partagé, déjà importé par
    // messaging / remediation / *-exports) — jamais le rôle « admin d'école »
    // codé en dur des autres sites d'audit : un super_admin s'audite super_admin.
    const { actorRole, portal } = deriveAlertActorProvenance(jwt);
    const { ipAddress, userAgent } = extractAuditClientHints(req);

    return this.seed.seedFrenchHolidays({
      tenantId: me.tenantId,
      schoolId,
      actorId: me.id,
      actorRole,
      portal,
      year: body.year,
      confirm: body.confirm === true,
      dryRun: body.dryRun === true,
      ipAddress,
      userAgent,
    });
  }

  /**
   * Renvoie les `classSectionId` des classes actives des enfants du parent.
   *
   * S-E01-1d — la méthode reçoit désormais `tx` en PARAMÈTRE LEXICAL et les
   * `studentIds` DÉJÀ résolus. La moitié `scopeForUser` (qui lit `guardianship`
   * / `student`) a été remontée dans `list`, AVANT l'ouverture de la portée :
   * elle résout l'identité, donc elle ne peut pas s'exécuter sous un GUC qu'elle
   * n'a pas encore produit. Le repli reste identique — tableau vide si le parent
   * n'a aucun enfant ou aucune inscription active, et `calendarVisibilityWhere`
   * se rabat alors sur les seuls événements `school_wide` (G-PORTAL).
   */
  private async resolveParentClassSectionIds(
    tx: Prisma.TransactionClient,
    tenantId: string,
    studentIds: string[],
  ): Promise<string[]> {
    const enrollments = await tx.enrollment.findMany({
      where: {
        tenantId,
        status: 'active',
        studentId: { in: studentIds },
      },
      select: { classSectionId: true },
    });

    // Dédoublonne (plusieurs enfants peuvent partager une classe).
    return [...new Set(enrollments.map((e) => e.classSectionId))];
  }

  private async createEvent(
    me: { id: string; tenantId: string },
    schoolId: string,
    body: CreateCalendarEventDto,
  ) {
    const startsAt = new Date(body.startsAt);
    const endsAt = new Date(body.endsAt);
    if (startsAt > endsAt) {
      throw new BadRequestException('startsAt doit être avant endsAt.');
    }
    // ADR-049 §D3 — AU PLUS UN id de portée, avant tout le reste. Les trois
    // gardes de cohérence ci-dessous sont inertes quand `body.scope` est absent
    // (elles testent toutes `&& body.scope`), donc sans cette ligne un second id
    // se glisse dans la ligne sans qu'aucune portée déclarée ne l'explique.
    assertSingleScopeId(body, SCOPE_ID_FIELDS);
    // Validate scope consistency: if a scoped id is provided, scope must match.
    if (body.classSectionId && body.scope && body.scope !== 'class_section_scope') {
      throw new BadRequestException("scope doit être 'class_section_scope' si classSectionId est fourni.");
    }
    if (body.gradeLevelId && body.scope && body.scope !== 'grade_level_scope') {
      throw new BadRequestException("scope doit être 'grade_level_scope' si gradeLevelId est fourni.");
    }
    if (body.cycleId && body.scope && body.scope !== 'cycle_scope') {
      throw new BadRequestException("scope doit être 'cycle_scope' si cycleId est fourni.");
    }

    const finalScope =
      body.scope ??
      (body.classSectionId
        ? CalendarEventScope.class_section_scope
        : body.gradeLevelId
          ? CalendarEventScope.grade_level_scope
          : body.cycleId
            ? CalendarEventScope.cycle_scope
            : CalendarEventScope.school_wide);

    // Toute la validation PURE ci-dessus se fait DEHORS — « portée tardive,
    // fermeture précoce » d'ADR-048 §D3 tient intégralement. Ce qui a migré à
    // l'INTÉRIEUR, c'est uniquement ce qui NE PEUT PAS être calculé dehors : la
    // propriété d'un id se lit en base, et se la lire sur la connexion du
    // propriétaire (qui voit TOUS les tenants) ne serait pas une vérification
    // plus faible — ce serait le bug lui-même réécrit en vérification.
    //
    // BUDGET AMENDÉ (ADR-049 §D4, note datée dans ADR-048 §D3) : au plus TROIS
    // instructions ici — ≤ 1 sonde de portée (l'exclusivité mutuelle a réduit
    // trois alternatives à une) + ≤ 1 sonde d'année scolaire + le `create`.
    const tenantId = me.tenantId;
    const ownership = scopeOwnershipPlan(body, CREATE_OWNED_SCOPE_FIELDS);

    return this.scope.run(tenantId, async (tx) => {
      // Même forme, même raison qu'en `update` : `tenantId` EXPLICITE dans le
      // `where` (ADR-042 §D1) pour que la vérification soit correcte MÊME sans
      // RLS dessous, et `findFirst` plutôt que `findUnique` pour que « d'un
      // autre tenant » et « inexistant » soient LA MÊME branche.
      for (const ref of ownership) {
        let owned: { id: string } | null;
        switch (ref.field) {
          case 'academicYearId':
            owned = await tx.academicYear.findFirst({
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
          case 'gradeLevelId':
            owned = await tx.gradeLevel.findFirst({
              where: { id: ref.id, tenantId },
              select: { id: true },
            });
            break;
          case 'cycleId':
            owned = await tx.cycle.findFirst({
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

      return tx.calendarEvent.create({
        data: {
          tenantId,
          schoolId,
          academicYearId: body.academicYearId,
          type: body.type,
          scope: finalScope,
          visibility: body.visibility ?? CalendarEventVisibility.all,
          title: body.title,
          description: body.description,
          startsAt,
          endsAt,
          allDay: body.allDay ?? true,
          color: body.color,
          icon: body.icon,
          cycleId: body.cycleId,
          gradeLevelId: body.gradeLevelId,
          classSectionId: body.classSectionId,
          createdBy: me.id,
        },
      });
    });
  }
}
