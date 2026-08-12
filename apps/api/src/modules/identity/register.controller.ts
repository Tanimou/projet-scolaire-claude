import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  InternalServerErrorException,
  Logger,
  Post,
  Req,
} from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { UserStatus } from '@prisma/client';
import { IsBoolean, IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

import { type ClientHintsRequest, extractAuditClientHints } from '../../shared/audit/client-hints';
import { type AuditProvenance, deriveAuditProvenance } from '../../shared/audit/provenance';
import { writeAudit } from '../../shared/audit/write-audit';
import { type KeycloakJwtPayload } from '../../shared/auth/jwt.strategy';
import { KeycloakAdminService } from '../../shared/keycloak/keycloak-admin.service';
import { PrismaService } from '../../shared/prisma/prisma.service';

class RegisterParentDto {
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

  @IsString()
  @MinLength(12, { message: 'Le mot de passe doit faire au moins 12 caractères.' })
  @MaxLength(128)
  password!: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @IsBoolean()
  acceptTerms!: boolean;

  @IsBoolean()
  acceptPrivacy!: boolean;

  @IsOptional()
  @IsBoolean()
  marketingOptIn?: boolean;
}

const DEMO_TENANT_SLUG = 'demo';

/**
 * The ONE realm role this endpoint grants — declared once and used TWICE
 * (`createUser({ realmRoles })` and the provenance payload below), so the audit
 * row can never claim a role different from the one actually granted. Two
 * literals kept in sync by review is exactly the drift `ADR-036` exists over.
 */
const PARENT_REALM_ROLE = 'parent' as const;

/**
 * THE refusal, built in ONE place — byte-identical to the string this handler has
 * always thrown, and now reached by BOTH conflict branches (see step 5b).
 *
 * `apps/web/src/app/parent/register/actions.ts:41-45` returns `body.message`
 * verbatim and `ParentRegisterForm.tsx` renders it raw, so this string IS user
 * interface copy even though no `apps/web` file changes in this slice.
 */
function alreadyExists(email: string): ConflictException {
  return new ConflictException(
    `Un compte existe déjà avec ${email}. Connectez-vous, ou récupérez votre mot de passe.`,
  );
}

/**
 * What the REGISTRANT reads when the registration failed AND the compensating
 * delete failed too — mirroring `invite.controller.ts:91-96`, but written for an
 * anonymous member of the public rather than for an administrator: nobody on this
 * path has a platform console, so the instruction is "quote this to support",
 * never "clean it up".
 *
 * One French sentence, cause first and the orphan id last so a wrap never
 * separates the instruction from its object. No support address: `SUPPORT_EMAIL`
 * lives in `apps/web/src/lib/support-contact.ts` precisely because four
 * hard-coded copies drifted (PF-17 / PF-54), and a fifth on the API side would be
 * the same defect.
 */
function orphanedKeycloakUserMessage(kcUserId: string): string {
  return (
    "La création de votre compte a échoué et le compte technique n'a pas pu être supprimé " +
    `automatiquement. Communiquez cet identifiant au support avant de réessayer : ${kcUserId}`
  );
}

/**
 * Duck-typed, deliberately, and NOT `instanceof Prisma.PrismaClientKnownRequestError`.
 *
 * The unit spec drives the transaction with a fake that rejects with a plain
 * `{ code: 'P2002' }`, which is the shape every Prisma unique-constraint error
 * presents; an `instanceof` here would make the branch untestable without
 * constructing a driver-internal class, and a branch nobody can drive is a branch
 * nobody has checked.
 */
function isUniqueConstraintViolation(cause: unknown): boolean {
  return (
    typeof cause === 'object' && cause !== null && (cause as { code?: unknown }).code === 'P2002'
  );
}

/**
 * Parent self-service registration.
 *
 * Public (unauthenticated) endpoint. Creates a Keycloak user with the `parent`
 * realm role and a permanent password, then a corresponding `user_profile` row
 * and its audit trace. The user can immediately log in via the credentials flow
 * on /parent/login.
 *
 * S-E05-11 (`PF-166`) — WHAT CHANGED AND WHY
 * ------------------------------------------
 * This is the ONE unauthenticated account-creation path in the product, and until
 * this slice it performed four separate, uncoordinated writes with no transaction
 * and no compensation: `keycloak.createUser`, `keycloak.setUserPassword`,
 * `tenant.upsert`, `userProfile.create`. A failure at the last one left an
 * ENABLED, profile-less Keycloak identity — the orphan class `PF-163` named at
 * the sibling address — and, independently, the handler wrote **no audit row on
 * any path**, so account creation (a privileged mutation by G-AUDIT's own
 * definition) was invisible to the audit trail.
 *
 * The fix is the one already shipped at `invite.controller.ts` and is copied from
 * it rather than invented: the two LOCAL writes plus one audit row move into a
 * single `$transaction` extracted into `persistRegisteredParent`, both Keycloak
 * calls stay OUTSIDE it and before it, and a `.catch()` at the call site deletes
 * the Keycloak identity THIS request created when the transaction rolls back.
 *
 * FAIL-CLOSED IS CHOSEN HERE, AND ON A PUBLIC FUNNEL THAT IS A REAL TRADE
 * ----------------------------------------------------------------------
 * `ADR-035` D2 (an audit failure fails the mutation) was decided on ADMIN paths.
 * Applying it to public signup means: `audit_log` unavailable ⇒ **no parent can
 * create an account**, and each attempt now also spends a `createUser` +
 * `setUserPassword` + `deleteUser` round-trip against the Keycloak admin API on
 * an endpoint that is still unthrottled (`PF-46`). Taken deliberately — an
 * unaudited account is worse than a deferred signup — and recorded, with the
 * amplification residual registered under `PF-46` rather than discovered in an
 * incident. See the `S-E05-11` amendment in `docs/adr/ADR-035-audit-in-transaction.md`.
 *
 * Phase 1C dev tradeoff, unchanged by this slice: `emailVerified=true` so the
 * parent can log in immediately after submitting the form. For production, set
 * `emailVerified=false` + `requiredActions=['VERIFY_EMAIL']` and gate sensitive
 * features until verification.
 */
@ApiTags('auth')
@Controller('auth')
export class RegisterController {
  private readonly logger = new Logger(RegisterController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly keycloak: KeycloakAdminService,
  ) {}

  @Post('register-parent')
  @ApiOkResponse({ description: 'Compte parent créé' })
  async registerParent(@Body() body: RegisterParentDto, @Req() req: ClientHintsRequest) {
    // 1. Validation — UNCHANGED, byte for byte. Both sentences are rendered raw
    //    by `ParentRegisterForm`, so they are UI copy and this is a robustness
    //    slice, not a UX one.
    if (!body.acceptTerms || !body.acceptPrivacy) {
      throw new BadRequestException("Vous devez accepter les CGU et la politique de confidentialité.");
    }
    if (!/[a-z]/.test(body.password) || !/[A-Z]/.test(body.password) || !/\d/.test(body.password) || !/[^A-Za-z0-9]/.test(body.password)) {
      throw new BadRequestException(
        'Le mot de passe doit contenir au moins une majuscule, une minuscule, un chiffre et un caractère spécial.',
      );
    }

    const email = body.email.toLowerCase();

    // 2. Reject if user already exists in Keycloak — UNCHANGED, and now the FIRST
    //    of two branches that reach the same 409 string (see 5b).
    const existing = await this.keycloak.findUserByEmail(email);
    if (existing) {
      throw alreadyExists(email);
    }

    // 3. Provenance, derived BEFORE the transaction opens (`ADR-036` D5). Two
    //    halves, and they are honest in two different ways.
    //
    //    (a) THE HINTS ARE THE TRANSPORT'S, AND ON THE PRODUCT PATH THAT IS NOT
    //        THE PARENT'S BROWSER — MEASURED, NOT ASSUMED (`PF-129`).
    //        This endpoint has exactly ONE caller repo-wide and it is a Next.js
    //        SERVER ACTION: `apps/web/src/app/parent/register/actions.ts:1,25-29`
    //        is `'use server'` and issues a bare `fetch` carrying only
    //        `Content-Type` / `Accept` — it never calls `clientProvenanceHeaders`.
    //        So `extractAuditClientHints` takes branch 2 (nobody claims to relay),
    //        and:
    //          • in production (`TRUST_PROXY_HOPS=2`, `ADR-036` D2) there is no
    //            `x-forwarded-for` on that hop, so the chain is shorter than N and
    //            `ipAddress` is honestly **null**;
    //          • on the local `--profile app` topology (N = 0) it is the WEB
    //            CONTAINER's egress address, one constant address shared by every
    //            registrant — literally `PF-31`;
    //          • `userAgent` is the server fetch's (`undici`), not the browser's.
    //        Capturing them anyway is still strictly better than a hard null: the
    //        seam never invents, and the day `apps/web` forwards the client
    //        provenance headers this line starts recording the real operator with
    //        no change here. That forwarding half lives in `apps/web`, which is
    //        outside this seam; it is registered as `PF-129`, not asserted away.
    //
    //    (b) THE ROLE IS AN OBSERVATION, NOT AN INVENTION.
    //        There is no JWT on a public path, so the payload below is
    //        synthesised — but every field of it is a statement about what this
    //        request just CREATED, not a guess about who called. `sub` is
    //        `kcUserId`, which is literally the `sub` claim every future token for
    //        this account will carry, and `realm_access.roles` is the single realm
    //        role granted at step 4 through the same constant. It goes through
    //        `deriveAuditProvenance` rather than being hand-written as
    //        `actorRole: 'parent'` because `audit-provenance-gate.spec.ts` G-3
    //        requires that no second file under `apps/api/src` decide an actor
    //        role from realm roles — the invariant, not the identifier.
    const hints = extractAuditClientHints(req);

    // 4. Create the Keycloak user WITHOUT a password. We set it explicitly below
    //    as non-temporary to avoid two things:
    //      1. Keycloak's passwordHistory(5) policy would reject re-setting an
    //         identical password right after createUser if we passed it as
    //         temporaryPassword.
    //      2. ROPC ('Account is not fully set up') if we left required actions
    //         pending.
    //
    //    THE irreversible steps, and the only ones the rollback below
    //    compensates. Both stay OUTSIDE the transaction, before it: an HTTP
    //    round-trip inside an interactive Prisma transaction is how a 5 s timeout
    //    becomes a production incident.
    const kcUserId = await this.keycloak.createUser({
      email,
      firstName: body.firstName,
      lastName: body.lastName,
      enabled: true,
      emailVerified: true,
      realmRoles: [PARENT_REALM_ROLE],
      requiredActions: [],
    });
    await this.keycloak.setUserPassword(kcUserId, body.password, false);

    // The identity now exists, so the synthetic payload of (b) can carry its real
    // subject. Still derived BEFORE the transaction opens, which is the rule that
    // matters (`ADR-036` D5) — the sanitisers ran in `extractAuditClientHints`
    // above, so no `@db.Inet` cast can roll back the mutation it was tracing.
    const registrantPayload: KeycloakJwtPayload = {
      sub: kcUserId,
      email,
      realm_access: { roles: [PARENT_REALM_ROLE] },
    };
    const provenance = deriveAuditProvenance(registrantPayload, hints);

    // 5. The local profile and the audit row, in ONE transaction, extracted into
    //    `persistRegisteredParent` below.
    //
    //    `.catch()` rather than a `try` on purpose: `scripts/audit-write-check.js`
    //    rule B (`:265-274`) walks every AST ancestor of a `writeAudit` call —
    //    function boundaries included — and turns red if a `try` appears anywhere
    //    above it. That is also why the transaction lives in its own method.
    await this.persistRegisteredParent({
      body,
      email,
      kcUserId,
      provenance,
    }).catch(async (cause: unknown): Promise<never> => {
      // 5a. UNCONDITIONAL, and the argument is written down rather than inherited
      //     by resemblance from `invite.controller.ts`: step 4 above is the ONLY
      //     producer of `kcUserId` in this handler, and step 2 REFUSES every
      //     pre-existing identity. So every identity reaching this line was
      //     created by THIS request — there is no adopted-identity case to
      //     exclude and therefore no branch in which the compensation could
      //     delete something it did not create. `persistRegisteredParent` also
      //     has no statement after its last write except `return created`, so a
      //     rejection here can never mean "committed, then failed".
      await this.compensateOrphanedKeycloakUser(kcUserId, cause);

      // 5b. THE FOURTH BRANCH, named rather than discovered later.
      //     `userProfile.create` can fail with P2002 when a `UserProfile` already
      //     exists for this email while no Keycloak identity does — reachable via
      //     `seed-demo.ts` rows and via any past partial failure of this very
      //     handler. BEFORE this slice that returned a raw Prisma message (a 500)
      //     and the Keycloak identity SURVIVED, so the next attempt hit the 409 at
      //     step 2. With the compensation in place the identity no longer
      //     survives, so without this mapping the same request would 500 forever
      //     in a self-cleaning loop — and would keep leaking driver detail to an
      //     anonymous caller, which is also a user-enumeration oracle
      //     distinguishing "this email has a local profile" from "this email is
      //     free" on an endpoint `PF-46` already flags as unthrottled.
      //
      //     Mapped to the SAME 409 the pre-existing conflict branch throws, so the
      //     two conflict paths stop being distinguishable — no new copy, no new
      //     status, no oracle, and the stable-409-on-retry behaviour a caller
      //     could observe before this slice is preserved rather than lost.
      if (isUniqueConstraintViolation(cause)) {
        throw alreadyExists(email);
      }

      // Best-effort and NON-MASKING: every other failure reaches the caller
      // unchanged. For the dominant case that is `AUDIT_WRITE_FAILED_MESSAGE`
      // (« L'opération a été annulée : la trace d'audit n'a pas pu être
      // enregistrée. »), which is now literally true — nothing survives.
      throw cause;
    });

    // 6. The response body is UNCHANGED and deliberately NOT widened with the
    //    created profile id / `kcUserId` the way `invite` does: `actions.ts:37`
    //    reads only `data.email`, and a widened body is still a contract change.
    return { ok: true, email };
  }

  /**
   * The local half, in ONE transaction: the demo tenant, the profile, and the
   * audit row.
   *
   * A separate method because the compensation at the call site needs a `catch`,
   * and rule B of `scripts/audit-write-check.js` rejects a `writeAudit` with a
   * `try` ANYWHERE among its AST ancestors — function boundaries included.
   *
   * THE `demo` TENANT UPSERT IS DELIBERATELY LEFT AS-IS — and that decision now
   * costs something, which is stated rather than left to be measured in an
   * incident. Re-deciding tenancy inside a robustness slice would be an ADR-002
   * change riding in on a compensation fix, so the upsert keeps its shape and its
   * owner (`PF-165`). What DID change is that it is now a **contended** write: it
   * is unconditional, every registration executes it, and inside an interactive
   * transaction it holds a row lock on the single `demo` tenant row for the
   * duration — including `userProfile.create` — so concurrent signups serialise
   * and a burst can hit Prisma's 5 s interactive timeout (P2028), each failure
   * paying a compensating `deleteUser`. The cheap hedge (`findUnique` first,
   * `upsert` only on a miss) is a behaviour change and is therefore NOT taken
   * here; it belongs to `PF-165` with the rest of the demo-tenant question.
   */
  private async persistRegisteredParent(input: {
    body: RegisterParentDto;
    email: string;
    kcUserId: string;
    provenance: AuditProvenance;
  }) {
    const { body, email, kcUserId, provenance } = input;

    return this.prisma.$transaction(async (tx) => {
      // G-TENANT — the tenant is resolved HERE, from a module constant, and
      // `RegisterParentDto` declares no tenant field of any kind, so no caller
      // value can influence tenancy (ADR-002). The `tenant.id` this upsert
      // returns feeds BOTH the profile and the audit row; neither is re-derived.
      // `AuditLog` has no foreign key to `Tenant` or to `UserProfile`
      // (`ADR-035` D7), so this ordering is the only thing that makes the row's
      // tenant provably the profile's.
      const tenant = await tx.tenant.upsert({
        where: { slug: DEMO_TENANT_SLUG },
        update: {},
        create: { slug: DEMO_TENANT_SLUG, name: 'Demo Tenant' },
      });

      // Provision the local user_profile so /api/v1/me works immediately.
      const created = await tx.userProfile.create({
        data: {
          tenantId: tenant.id,
          authProviderId: kcUserId,
          email,
          firstName: body.firstName,
          lastName: body.lastName,
          phone: body.phone ?? null,
          status: UserStatus.active,
          preferences: { marketingOptIn: body.marketingOptIn ?? false },
        },
      });

      // The audit row — same transaction, fail-closed (`ADR-035` D2).
      //
      // `actorId` and `resourceId` are THE SAME id, and that is not a copy-paste
      // slip: self-registration is the one mutation in the product where the
      // actor and the subject genuinely coincide — the parent created this
      // profile, and the profile IS the parent. `resourceId` is therefore a bare
      // uuid (`AuditLog.resourceId` is `@db.Uuid`; a composite is rejected by
      // PostgreSQL and the registration would fail because of its own audit row).
      //
      // `after` is an EXPLICIT allow-list, never `{ ...body }`. `RegisterParentDto`
      // carries a plaintext `password`, and this row is rendered on /admin/audit
      // AND exported by `audit-csv.generator.ts` — a spread would write a
      // credential into an append-only, exportable governance table in the very
      // slice whose justification is RGPD-level governance. `phone` is left out
      // for the same data-minimisation reason; `acceptTerms` / `acceptPrivacy`
      // are consent noise the `UserProfile` row already implies.
      await writeAudit(tx, {
        tenantId: tenant.id,
        actorId: created.id,
        action: 'user.register',
        resourceType: 'user_profile',
        resourceId: created.id,
        provenance,
        after: {
          email,
          realmRole: PARENT_REALM_ROLE,
          selfRegistered: true,
          marketingOptIn: body.marketingOptIn ?? false,
        },
      });

      return created;
    });
  }

  /**
   * The compensating action for the non-transactional prefix (step 4).
   *
   * Keycloak has no transaction to join — which is exactly why every call to it
   * stays outside the `$transaction`, and exactly why a rollback would otherwise
   * leave an enabled, profile-less account behind. Deleting it is the only thing
   * that makes `ADR-035` D2's fail-closed rule safe at this site.
   *
   * NOT bounded by a timeout, stated rather than left unconsidered: no call in
   * `KeycloakAdminService` sets an `AbortSignal`, and retrofitting one here only
   * would be a new convention riding in on a compensation slice. Registered as a
   * follow-up on the service as a whole, exactly as `invite.controller.ts:390-393`
   * records it.
   *
   * Contains no `writeAudit` call, deliberately — see `persistRegisteredParent`.
   */
  private async compensateOrphanedKeycloakUser(kcUserId: string, cause: unknown): Promise<void> {
    try {
      await this.keycloak.deleteUser(kcUserId);
    } catch (compensationError) {
      // NEVER SWALLOWED. The registrant gets a sentence naming the orphan so a
      // human can have it cleaned up, the original failure travels as `cause`,
      // and both reach the server log. `actions.ts` keeps only `body.message`, so
      // the id has to be IN the string — the structured field is for logs and
      // machines.
      this.logger.error(
        `Compensation failed: Keycloak user ${kcUserId} is orphaned (enabled, no UserProfile). ` +
          `Original registration failure: ${(cause as Error | undefined)?.message ?? String(cause)}. ` +
          `Delete failure: ${(compensationError as Error).message}`,
      );
      throw new InternalServerErrorException(
        { message: orphanedKeycloakUserMessage(kcUserId), kcUserId },
        { cause },
      );
    }
  }
}
