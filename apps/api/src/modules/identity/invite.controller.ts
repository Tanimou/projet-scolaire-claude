import { randomBytes } from 'node:crypto';

import {
  BadRequestException,
  Body,
  Controller,
  ConflictException,
  InternalServerErrorException,
  Logger,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { isMfaEnrolledRealmRole } from '@pilotage/contracts';
import { UserStatus } from '@prisma/client';
import { IsEmail, IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

import { type AuditProvenance, deriveAuditProvenance } from '../../shared/audit/provenance';
import { writeAudit } from '../../shared/audit/write-audit';
import { CurrentJwt } from '../../shared/auth/current-user.decorator';
import { JwtAuthGuard } from '../../shared/auth/jwt-auth.guard';
import { type KeycloakJwtPayload } from '../../shared/auth/jwt.strategy';
import { PermissionsGuard } from '../../shared/auth/permissions.guard';
import { assertWithinCeiling } from '../../shared/auth/privilege-ceiling';
import { RequiresPermission } from '../../shared/auth/requires-permission.decorator';
import { UserSyncService } from '../../shared/auth/user-sync.service';
import { KeycloakAdminService } from '../../shared/keycloak/keycloak-admin.service';
import { PrismaService } from '../../shared/prisma/prisma.service';

class InviteUserDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  firstName!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  lastName!: string;

  /** Keycloak realm role to grant (school_admin / teacher / parent) */
  @IsEnum(['school_admin', 'teacher', 'parent'])
  realmRole!: 'school_admin' | 'teacher' | 'parent';

  /** Optional custom role slug to also assign in our DB */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  customRoleSlug?: string;
}

const PORTAL_CLIENT_ID: Record<InviteUserDto['realmRole'], string> = {
  school_admin: 'portal-admin',
  teacher: 'portal-teacher',
  parent: 'portal-parent',
};

const PORTAL_REDIRECT: Record<InviteUserDto['realmRole'], string> = {
  school_admin: '/admin/dashboard',
  teacher: '/teacher/dashboard',
  parent: '/parent/dashboard',
};

/**
 * THE refusal, built in ONE place (S-E04-9 / `ADR-035` D17).
 *
 * Every pre-existing Keycloak identity yields this ONE character-identical 409 —
 * no branch, therefore no oracle: the caller cannot tell a same-tenant profile
 * from a foreign-tenant one from a never-onboarded realm account. Byte-for-byte
 * the message this handler has always thrown —
 * `apps/web/src/app/admin/users/invite/actions.ts:26-34` reads only
 * `body.message` and renders it raw, so this string IS user-interface copy.
 */
function alreadyExists(email: string): ConflictException {
  return new ConflictException(
    `Un utilisateur existe déjà avec l'email ${email}. Il peut se connecter directement.`,
  );
}

/**
 * What the admin reads when the invitation failed AND the compensating delete
 * failed too (S-E04-9 AC-2). One French sentence, cause first, the orphan id
 * last so a wrap never separates the instruction from its object. No support
 * address: `SUPPORT_EMAIL` lives in `apps/web/src/lib/support-contact.ts`
 * precisely because four hard-coded copies drifted (PF-17 / PF-54), and a fifth
 * on the API side would be the same defect.
 */
function orphanedKeycloakUserMessage(kcUserId: string): string {
  return (
    "L'invitation a échoué et le compte technique n'a pas pu être supprimé automatiquement. " +
    `Communiquez cet identifiant à votre administrateur de plateforme pour nettoyage : ${kcUserId}`
  );
}

@ApiTags('users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('users')
export class InviteController {
  private readonly logger = new Logger(InviteController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UserSyncService,
    private readonly keycloak: KeycloakAdminService,
  ) {}

  @Post('invite')
  @RequiresPermission('users.write')
  @ApiOkResponse({ description: 'Invitation envoyée par email' })
  async invite(@Body() body: InviteUserDto, @CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    // Derived BEFORE the transaction opens (S-E06-6's rule). No `@Req()` on this
    // handler, so the client hints stay the honest blank they already were —
    // capturing them is PF-123's remaining half, not taken in this slice.
    const provenance = deriveAuditProvenance(jwt);
    const email = body.email.toLowerCase();

    // 1. An email that already has a Keycloak identity is REFUSED. One branch,
    //    one message, no lookup — deliberately identical to the pre-S-E04-9
    //    behaviour (`ADR-035` D16).
    //
    //    S-E04-9 SHIPS WITHOUT THE ADOPTION BRANCH, and that withdrawal is the
    //    finding rather than an omission. AC-4 rested on the premise « a Keycloak
    //    account with no local `UserProfile` is a state produced by exactly this
    //    bug ». Three facts falsified it:
    //      (a) `UserSyncService.ensureUser` USED TO create the `UserProfile`
    //          LAZILY, on FIRST LOGIN — every realm identity that had never logged
    //          in was profile-less BY DESIGN, not by failure. **S-E01-1a CLOSED
    //          THAT PREMISE** (`PF-01` half (a), ADR-043): the seam now RESOLVES
    //          or REFUSES (`UnprovisionedUserError`, 403,
    //          `code: 'ACCOUNT_NOT_PROVISIONED'`), creates no `Tenant` and no
    //          `UserProfile`, and the three realm identities are seeded into the
    //          real demonstration tenant instead (slug deliberately NOT spelled
    //          out here — `production-artefact-check.js` rule `A4` scans raw
    //          source, comments included). Kept in place rather than deleted because
    //          the reasoning is what makes the withdrawal reviewable — and the
    //          conclusion is UNCHANGED: a profile-less Keycloak identity is still
    //          not adoptable here (the state now means « not provisioned », which
    //          is even less of an invitation to adopt).
    //      (b) `infra/keycloak/realm-export.json` ships three of them —
    //          `admin@` / `teacher@` / `parent@pilotage.local`, enabled. They now
    //          DO have a matching row in `apps/api/prisma/seed-demo.ts` (S-E01-1a,
    //          seeded with no `authProviderId`: the realm export declares no `id`,
    //          so first login binds them through the email-linking fallback).
    //      (c) ADR-004 puts every tenant in ONE realm, so those identities are
    //          reachable from any tenant.
    //    Adoption therefore matched « any never-onboarded account », not « the
    //    orphan PF-163 made » — and it handed any `users.write` holder, in an
    //    arbitrary tenant, a password overwrite, a realm-role grant and a
    //    PERMANENT binding of that identity to their own tenant (`authProviderId`
    //    is globally unique, schema.prisma:838). That is the ADR-002 breach this
    //    slice exists to close, reached through a new door.
    //
    //    The positive marker adoption would need cannot be written here: Keycloak
    //    26 (`infra/docker-compose.yml:184`) disables unmanaged user attributes by
    //    default and the realm export declares no `components`, so an attribute
    //    stamped at `createUser` time would be dropped on write; the local
    //    alternative is an invite-intent table, and `G-MIGRATION` does not trigger
    //    in this slice. Re-pointed at a later slice, not silently dropped.
    //
    //    PF-163's escalation path is closed regardless, and by the stronger half:
    //    the rollback below DELETES the orphan (AC-1), and when that delete itself
    //    fails the admin is handed the id to clean up by hand (AC-2). The dead end
    //    is broken by removing the orphan, never by adopting it.
    const existing = await this.keycloak.findUserByEmail(email);
    if (existing) {
      throw alreadyExists(email);
    }

    // 1b. S-E05-2 — THE FOURTH GRANT PATH, and the one that would have made the
    //     other three cosmetic. `body.customRoleSlug` used to be resolved and
    //     granted INSIDE `persistInvitedProfile`'s transaction with no ceiling
    //     at all, on a handler gated only by `users.write` — WEAKER than
    //     `roles.assign`. `body.email` is attacker-controlled, so a grantor
    //     refused at `POST /users/:id/roles` could simply invite a second
    //     address they own with `customRoleSlug` pointing at a full-catalogue
    //     role, receive the set-password mail and log in holding it. Closing
    //     PF-09 at three sites and leaving this open would have shipped a claim
    //     the code does not carry.
    //
    //     RESOLVED HERE, BEFORE STEP 3, and that placement is deliberate: the
    //     Keycloak identity is not created yet, so a refusal costs no
    //     compensation — nothing exists to roll back. The transaction below
    //     receives an already-resolved id, so `persistInvitedProfile` keeps its
    //     shape, its `.catch()` compensation at the call site and its untouched
    //     `writeAudit` (a `try` anywhere among that call's AST ancestors turns
    //     rule B of `scripts/audit-write-check.js` red).
    //
    //     `effectivePermissions` is read ONLY when a custom role is actually
    //     requested — with no slug there is nothing to compare, and an
    //     unconditional read would be a query bought for no decision.
    let customRoleId: string | null = null;
    if (body.customRoleSlug) {
      const role = await this.prisma.role.findFirst({
        where: { slug: body.customRoleSlug },
        include: { rolePermissions: { include: { permission: true } } },
      });
      // An UNRESOLVABLE slug stays the silent no-op it has always been: no role,
      // no grant, no 400. Only a RESOLVED role whose permissions exceed the
      // grantor is refused — the ceiling changes who may grant what, never what
      // an unknown slug means.
      if (role) {
        const grantorPermissions = await this.users.effectivePermissions(
          jwt.sub,
          jwt.realm_access?.roles ?? [],
        );
        assertWithinCeiling(
          grantorPermissions,
          role.rolePermissions.map((rp) => rp.permission.code),
        );
        customRoleId = role.id;
      }
    }
    //
    //     NOT CEILING-CHECKED, STATED RATHER THAN IMPLIED: the `realmRole`
    //     channel. `@IsEnum(['school_admin','teacher','parent'])` lets a
    //     `school_admin` provision a `teacher` identity, and
    //     `REALM_ROLE_PERMISSIONS.teacher` carries `grades.revise` — a code the
    //     inviter does not hold. Applying the ceiling there would refuse « invite
    //     a teacher », which is the product's primary onboarding flow, so it is
    //     NOT taken here. It is an explicitly OPEN residual with an owner
    //     (ADR-015, `S-E05-2` D8), not an oversight: realm-role provisioning is
    //     a delegation question (§2.4 option 2), not a subset question.

    // 2. Required actions — MFA enforced for admin/teacher per ADR-004.
    //
    //    S-E05-8 / ADR-082 §D2 — CE SITE NE PORTE PLUS LA RÈGLE, IL LA CONSOMME.
    //    Le littéral `=== 'school_admin' || === 'teacher'` qui vivait ici est
    //    désormais l'UNIQUE déclaration du dépôt, dans
    //    `packages/contracts/src/security/mfa-enrolment-policy.ts`, parce que
    //    `me.controller.ts` doit dériver `mfaRequired` de LA MÊME règle : l'y
    //    recopier aurait fondé la seconde liste tenue à la main, c'est-à-dire la
    //    dérive que la tranche ferme. Table de vérité IDENTIQUE — aucun rôle ne
    //    gagne ni ne perd `CONFIGURE_TOTP` (`school_admin`/`teacher` oui,
    //    `parent` non ; le canal n'admet pas d'autre valeur). R4 du cliquet gèle
    //    qu'il n'existe pas de troisième copie.
    const requiredActions = ['UPDATE_PASSWORD'];
    if (isMfaEnrolledRealmRole(body.realmRole)) {
      requiredActions.push('CONFIGURE_TOTP');
    }

    // 3. Create the Keycloak user with a random temporary password (user resets via email)
    //    — THE irreversible step, and the only one the rollback below compensates
    //    (the numbering is load-bearing: `ActivationHint.tsx:10-23` cites §2/§3/§4
    //    of this file).
    const tempPassword = randomBytes(18).toString('base64url');
    const kcUserId = await this.keycloak.createUser({
      email,
      firstName: body.firstName,
      lastName: body.lastName,
      enabled: true,
      emailVerified: false,
      realmRoles: [body.realmRole],
      requiredActions,
      temporaryPassword: tempPassword,
    });

    // 4. Send the "Execute actions email" — Keycloak email contains the magic link
    const webBaseUrl = process.env.WEB_BASE_URL ?? 'http://localhost:3100';
    const redirectUri = `${webBaseUrl}${PORTAL_REDIRECT[body.realmRole]}`;
    try {
      await this.keycloak.sendExecuteActionsEmail(
        kcUserId,
        requiredActions,
        PORTAL_CLIENT_ID[body.realmRole],
        redirectUri,
      );
    } catch (err) {
      // Email failed — keep the user but surface a warning so admin can manually share the temp password
      //
      // DECIDED, NOT OVERLOOKED (S-E04-9): this branch is NOT compensated. It is
      // the pre-existing behaviour, its advice is still accurate (the temporary
      // password is real and the account usable), and deleting the account here
      // would make this very message false.
      //
      // RESIDUAL, STATED: it therefore still leaves an enabled identity with no
      // `UserProfile`, and step 1 still refuses the retry. That is unchanged by
      // this slice — an SMTP outage, not the audit rollback PF-163 named — and
      // closing it means changing this user-facing sentence, which is an
      // `apps/web` conversation (`ActivationHint.tsx`), not a compensation one.
      // Recorded in `ADR-035` D15, carried, not silently absorbed.
      const message = (err as Error).message;
      throw new BadRequestException({
        message: `Utilisateur créé dans Keycloak mais l'envoi de l'email a échoué : ${message}. Configurez SMTP côté Keycloak.`,
        kcUserId,
      });
    }

    // 5-7. S-E04-7 — the local profile, its optional custom role and the audit
    // row are written in ONE transaction, extracted into `persistInvitedProfile`
    // below. Every Keycloak call (steps 1-4) stays OUTSIDE: an HTTP round-trip
    // inside an interactive transaction is how a 5 s Prisma timeout becomes a
    // production incident.
    //
    // S-E04-9 — and because those Keycloak calls are already committed when this
    // rolls back, the rollback now COMPENSATES them. `.catch()` rather than a
    // `try` on purpose: `scripts/audit-write-check.js:265-274` walks every AST
    // ancestor of a `writeAudit` call, so a `try` anywhere above it turns rule B
    // red (`:569`) — which is also why the transaction lives in its own method.
    const profile = await this.persistInvitedProfile({
      me,
      body,
      email,
      kcUserId,
      requiredActions,
      provenance,
      customRoleId,
    }).catch(async (cause: unknown): Promise<never> => {
      // Unconditional: step 3 above is the ONLY producer of `kcUserId`, so every
      // identity reaching this point was created by THIS request. There is no
      // adopted-identity case to exclude — see step 1 — and therefore no branch
      // in which the compensation could delete something it did not create.
      await this.compensateOrphanedKeycloakUser(kcUserId, cause);
      // Best-effort and NON-MASKING: the original error is what the caller gets,
      // unchanged. For the dominant case that is `AUDIT_WRITE_FAILED_MESSAGE`
      // (« L'opération a été annulée : la trace d'audit n'a pas pu être
      // enregistrée. »), which is now literally true — nothing survives.
      throw cause;
    });

    return {
      ok: true,
      userProfileId: profile.id,
      kcUserId,
      emailSentTo: email,
    };
  }

  /**
   * Steps 5-7, in ONE transaction: the local profile, its optional custom role,
   * and the audit row.
   *
   * A separate method because the compensation at the call site needs a
   * `catch`, and rule B of `scripts/audit-write-check.js` rejects a `writeAudit`
   * with a `try` ANYWHERE among its AST ancestors — function boundaries
   * included. Nothing else moved: the `writeAudit` call below is still one
   * unconditional statement with an inline object literal and the transaction
   * client first (AC-7, `ADR-035` D2/D6).
   */
  private async persistInvitedProfile(input: {
    me: { id: string; tenantId: string };
    body: InviteUserDto;
    email: string;
    kcUserId: string;
    requiredActions: string[];
    provenance: AuditProvenance;
    /**
     * S-E05-2 — already RESOLVED and already ceiling-checked by `invite()`.
     * `null` means « no custom role », whether none was asked for or the slug
     * did not resolve. The lookup deliberately no longer happens in here: the
     * refusal must precede the irreversible Keycloak steps, and this method
     * exists only to hold the transaction.
     */
    customRoleId: string | null;
  }) {
    const { me, body, email, kcUserId, requiredActions, provenance, customRoleId } = input;

    return this.prisma.$transaction(async (tx) => {
      const created = await tx.userProfile.create({
        data: {
          // `UserProfile.tenantId` is the field that carries the tenant scoping
          // — always the CALLER's `me.tenantId` from `UserSyncService.ensureUser`
          // (ADR-002, `ADR-035` D7). Never derived from the Keycloak payload.
          tenantId: me.tenantId,
          authProviderId: kcUserId,
          email,
          firstName: body.firstName,
          lastName: body.lastName,
          status: UserStatus.active,
        },
      });

      // 6. Optionally assign a custom DB role — resolved and ceiling-checked in
      //    `invite()` step 1b, never here.
      if (customRoleId) {
        await tx.userRole.create({
          data: { userProfileId: created.id, roleId: customRoleId, grantedBy: me.id },
        });
      }

      // 7. Audit — same transaction, fail-closed (ADR-035 D2).
      await writeAudit(tx, {
        tenantId: me.tenantId,
        actorId: me.id,
        action: 'user.invite',
        resourceType: 'user_profile',
        resourceId: created.id,
        provenance,
        after: {
          email,
          realmRole: body.realmRole,
          customRoleSlug: body.customRoleSlug ?? null,
          requiredActions,
        },
      });

      return created;
    });
  }

  /**
   * The compensating action for the non-transactional prefix (steps 3-4).
   *
   * Keycloak has no transaction to join — which is exactly why S-E04-7 kept
   * every call to it outside the `$transaction`, and exactly why a rollback
   * leaves an enabled, profile-less account behind. Deleting it is the only
   * thing that makes ADR-035 D2's fail-closed rule safe at this site.
   *
   * NOT bounded by a timeout, stated rather than left unconsidered: no call in
   * `KeycloakAdminService` sets an `AbortSignal`, and retrofitting one here only
   * would be a new convention riding in on a compensation slice (AC-3 says
   * follow the file's conventions exactly). Registered as a follow-up on the
   * service as a whole, not patched here.
   *
   * Contains no `writeAudit` call, deliberately — see `persistInvitedProfile`.
   */
  private async compensateOrphanedKeycloakUser(kcUserId: string, cause: unknown): Promise<void> {
    try {
      await this.keycloak.deleteUser(kcUserId);
    } catch (compensationError) {
      // NEVER SWALLOWED (AC-2). The admin gets a sentence naming the orphan so a
      // human can clean it up, the original failure travels as `cause`, and both
      // reach the server log. `actions.ts` keeps only `body.message`, so the id
      // has to be IN the string — the structured field is for logs and machines.
      this.logger.error(
        `Compensation failed: Keycloak user ${kcUserId} is orphaned (enabled, no UserProfile). ` +
          `Original invite failure: ${(cause as Error | undefined)?.message ?? String(cause)}. ` +
          `Delete failure: ${(compensationError as Error).message}`,
      );
      throw new InternalServerErrorException(
        { message: orphanedKeycloakUserMessage(kcUserId), kcUserId },
        { cause },
      );
    }
  }
}
