import { InternalServerErrorException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { type AuditProvenance } from './provenance';

/**
 * S-E04-6 — THE shared seam every privileged mutation writes its audit row
 * through, **inside its own transaction** (`ADR-035`, gate G-AUDIT).
 *
 * WHY IT EXISTS
 * -------------
 * Measured on `main` before this slice: 6 call sites wrote `tx.auditLog.create`
 * inside a `$transaction`; 20 wrote `this.prisma.auditLog.create` outside one —
 * `roles.controller.ts create()` creates the role and *then*, separately, its
 * audit row, so a failure between the two leaves a role that exists unaudited.
 * Three whole families wrote **no row at all**: role grant/revoke, school
 * mutations, enrollment decisions. This function is the one place that can be
 * pointed at, and the transaction client in the first parameter is what makes
 * "in the same transaction" a property of the TYPE rather than of a review.
 *
 * THE BRAND IS NOT DECORATION — READ THIS BEFORE SIMPLIFYING IT
 * -------------------------------------------------------------
 * `plan.md` §5 and the story's note 1 both claimed that typing the first
 * parameter `Prisma.TransactionClient` makes `writeAudit(this.prisma, …)` a type
 * error. **It does not.** `Prisma.TransactionClient` is
 * `Omit<PrismaClient, ITXClientDenyList>`; `Omit` *removes* members, it does not
 * forbid them, TypeScript is structural, and excess-property checking applies
 * only to fresh object literals. A full `PrismaClient` has every remaining
 * member and is therefore assignable — the invariant would have been green
 * because it could not fire, which is precisely the class of guard this epic is
 * named after.
 *
 * `AuditTransactionClient` adds the two members the deny-list removes, as
 * optional `never`. `Prisma.TransactionClient` omits them → absent → an optional
 * property is satisfied. `PrismaService extends PrismaClient` **declares** them
 * as methods → a method is not assignable to `never` → compile error.
 * `write-audit.spec.ts` carries a `// @ts-expect-error` passing a real
 * `PrismaService`, so weakening the brand turns the single typecheck gate RED in
 * both directions rather than silently re-opening the hole.
 *
 * WHAT THIS FUNCTION DOES **NOT** DO (ADR-035 D3)
 * -----------------------------------------------
 * It performs the insert and nothing else. No `process.env`, no `ConfigService`,
 * no `NODE_ENV`, no feature flag, no `skip`/`force` member on the input — there
 * is no off switch and nothing switchable in scope (DNC-10). It does **not**
 * sanitise: `sanitiseInetOrNull` / `truncateUserAgent` already ran in
 * `client-hints.ts`, BEFORE the transaction opened. That ordering is load-bearing
 * and inherited from `S-E06-6`: `AuditLog.ipAddress` is `@db.Inet`, so a failed
 * cast inside the transaction would roll back the mutation the row exists to
 * trace — audit hygiene becoming an availability failure for the write itself.
 *
 * IT DOES NOT SWALLOW EITHER
 * --------------------------
 * `ADR-035` D2 is explicit: **an audit failure fails the mutation.** A
 * `try/catch` at a call site that downgrades a failed write to a warning is a
 * DNC-10 bypass by another name, and `write-audit.spec.ts` asserts statically
 * that no call site sits inside a `try` block. The one `catch` in this file does
 * the opposite of a downgrade: it re-throws, and exists only so the failure that
 * reaches the operator is a sentence they can act on. `SchoolsManager.tsx`
 * renders `res.error` verbatim in its inline banner, so a raw Prisma/driver
 * message would otherwise be shown to an administrator as UI copy.
 */

/**
 * A Prisma **transaction** client, and provably not a full client.
 *
 * Both members are the ones `Prisma.ITXClientDenyList` removes. Two rather than
 * one, so the brand still bites if a future Prisma release changes the deny-list
 * for either.
 */
export type AuditTransactionClient = Prisma.TransactionClient & {
  readonly $transaction?: never;
  readonly $connect?: never;
};

/**
 * What one audit row records.
 *
 * `provenance` is **required and non-optional**, deliberately — the rule
 * `provenance.ts:59-66` already states for `AuditActorProvenance`: *« un
 * appelant oublié est une erreur de compilation et non une provenance
 * silencieusement nulle »*. An optional provenance member would re-open exactly
 * the hole `S-E04-1` and `S-E04-3` closed: four call sites wired with no
 * `@Req()`, four all-null rows, and an acceptance criterion that says « real or
 * honestly null » ticked green. A caller with genuinely no request in scope
 * passes `deriveAuditProvenance(jwt, NO_CLIENT_HINTS)` and says so.
 *
 * `resourceId` is `string | null` and **must be a bare uuid or null**:
 * `AuditLog.resourceId` is `@db.Uuid`, so a composite identity such as
 * `` `${userId}:${roleId}` `` is rejected by PostgreSQL and the grant fails
 * because of its own audit row. Composite identity belongs in `before` / `after`.
 */
export interface AuditWriteInput {
  /** The **caller's** tenant, never the target's. */
  tenantId: string;
  /** The acting `UserProfile.id`, or null when no profile is resolvable. */
  actorId: string | null;
  /** A code declared in `AUDIT_ACTIONS` (`packages/contracts/src/audit`). */
  action: string;
  /** A code declared in `AUDIT_RESOURCE_TYPES`. */
  resourceType: string;
  /** A bare uuid, or null. Never a composite. */
  resourceId: string | null;
  /** Derived BEFORE `$transaction` opens, by `deriveAuditProvenance`. */
  provenance: AuditProvenance;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
}

/**
 * The message an administrator sees when the audit row could not be written.
 *
 * French, actionable, and free of driver detail — `SchoolsManager.tsx:32,41,52`
 * renders `res.error` raw inside a red inline banner, so this string IS user
 * interface copy even though no `apps/web` file changes in this slice.
 */
export const AUDIT_WRITE_FAILED_MESSAGE =
  'L’opération a été annulée : la trace d’audit n’a pas pu être enregistrée. ' +
  'Réessayez ; si l’erreur persiste, contactez l’administrateur.';

/**
 * Writes one audit row **inside the caller's transaction**.
 *
 * Call it with an **inline object literal** as the second argument. That is not
 * a style preference: `shared/quality/audit-vocabulary-gate.spec.ts` resolves the
 * action and resourceType of every row from the AST of the call site, and a
 * pre-built variable is invisible to it — the code would silently drop out of the
 * written set and the gate's reverse-completeness direction would then demand
 * that its real French label be deleted.
 */
export async function writeAudit(tx: AuditTransactionClient, input: AuditWriteInput): Promise<void> {
  try {
    await tx.auditLog.create({
      data: {
        tenantId: input.tenantId,
        actorId: input.actorId,
        actorRole: input.provenance.actorRole,
        portal: input.provenance.portal,
        action: input.action,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        ipAddress: input.provenance.ipAddress,
        userAgent: input.provenance.userAgent,
        ...(input.before === undefined ? {} : { before: input.before }),
        ...(input.after === undefined ? {} : { after: input.after }),
      },
    });
  } catch (cause) {
    // RE-THROWN, never downgraded. The mutation rolls back with it — that is the
    // decision (ADR-035 D2), not an accident of placement. The original error is
    // attached as `cause` so it reaches the server logs; only the sentence above
    // reaches the operator's screen.
    throw new InternalServerErrorException(AUDIT_WRITE_FAILED_MESSAGE, { cause });
  }
}
