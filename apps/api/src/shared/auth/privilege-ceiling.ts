import { ForbiddenException, Logger } from '@nestjs/common';

/**
 * S-E05-2 — LE PLAFOND DE PRIVILÈGE. The one place the rule lives:
 * *aucun octroyeur ne peut créer, réécrire ou assigner une permission qu'il ne
 * détient pas lui-même* (`PF-09` P0 BROKEN_SECURITY, `PF-156` P1 · ADR-015
 * amendment `S-E05-2` · gate G-AUTHZ).
 *
 * WHAT WAS OPEN, MEASURED
 * -----------------------
 * `roles.controller.ts create()` asked only whether a requested code EXISTS in
 * the `Permission` catalogue (`:116-122`), never whether the caller holds it;
 * `update()` rewrote an existing role's whole set from arbitrary codes; and
 * `users.service.ts assignRole()` granted a role without comparing anything.
 * `school_admin` holds both `roles.write` and `roles.assign`
 * (`permissions.constants.ts:209-211`), so the live chain was two requests:
 * mint a custom role carrying every code in `PERMISSIONS`, assign it to
 * yourself, re-authenticate — `UserSyncService.effectivePermissions` unions
 * custom-role permissions into the effective set with no ceiling at all.
 * (The brief's « POST the seeded super_admin role id » is NOT reproducible:
 * `grep -rn super_admin apps/api/prisma/` returns zero matches — `seed.ts`
 * seeds `school_admin`, `teacher`, `parent`, `student` and nothing else.)
 *
 * A PURE PREDICATE, ON PURPOSE
 * ----------------------------
 * No class, no injectable provider, no Nest module, no Prisma import, no
 * decorator —
 * the same posture as `shared/audit/provenance.ts` and for the same reason: a
 * plain function that every call site invokes explicitly is auditable by grep,
 * where a guard or an interceptor is a place a future author can forget to
 * apply. There is no barrel in `shared/auth/` (eight files, no `index.ts`), so
 * nothing is re-exported and call sites import this module directly, exactly as
 * they already import `permissions.guard` and `user-sync.service`.
 *
 * FAIL-CLOSED BY CONSTRUCTION (G-AUTHZ: « no fail-open guard »)
 * ------------------------------------------------------------
 *  - An `undefined` or EMPTY grantor set returns EVERY requested code. It is
 *    never read as « unknown, therefore allow ». This path is live, not
 *    theoretical: `user-sync.service.ts:67` resolves an unrecognised realm role
 *    to `[]`, so a caller whose realm role is not in `REALM_ROLE_PERMISSIONS`
 *    and who holds no custom role genuinely arrives here with an empty set.
 *  - An unknown or garbage code is not in the grantor's set, therefore it
 *    exceeds, therefore it is refused. This function never consults the
 *    catalogue and never special-cases a code it does not recognise — which is
 *    also why the parameter is `string[]` and not `PermissionCode[]`: the codes
 *    arrive from a request body, and a union type there would either refuse to
 *    compile or silently narrow away the very case that must be denied.
 *  - A malformed `requested` (not an array) cannot be compared code by code, so
 *    it is reported as one opaque exceeding entry — deny, never « nothing
 *    exceeds ». `class-validator` makes it unreachable from the four HTTP call
 *    sites; it is handled so the predicate is TOTAL.
 *  - `requested` empty returns `[]` (allow). That is the ONE permit-on-empty and
 *    it is stated, commented and tested so it can never be mistaken for a
 *    fail-open branch: a role carrying zero permissions grants zero privilege.
 *
 * NO ROLE-NAME SPECIAL CASE, AND THAT IS THE POINT
 * ------------------------------------------------
 * `super_admin` is unaffected structurally, not by exemption:
 * `REALM_ROLE_PERMISSIONS.super_admin` is the whole catalogue
 * (`permissions.constants.ts:143`), so this function returns `[]` for it. The
 * string `super_admin` appears nowhere below. An `if (roles.includes(…)) return
 * []` would be a bypass wearing a role name.
 *
 * DNC-10 — there is no off switch and nothing switchable in scope. This module
 * reads no environment, carries no bypass flag, has no development escape and
 * takes no options bag. Both exports have arity 2 and `privilege-ceiling.spec.ts`
 * asserts it, so an options object cannot appear later without turning a test red.
 */

const NOTHING_HELD: ReadonlySet<string> = new Set<string>();

/**
 * The sentinel reported when `requested` is not an array at all. It is not a
 * permission code and cannot be held by anyone, so it always denies.
 */
export const MALFORMED_REQUEST_SENTINEL = '<requête de permissions invalide>';

/** How many codes the French message names before it summarises the rest. */
const MAX_CODES_NAMED = 8;

/**
 * The refusal sentence, in French, matching its neighbours (`Rôle introuvable`,
 * `Les rôles système ne sont pas modifiables`, `Permissions inconnues`,
 * `Permission(s) refusée(s)`).
 *
 * The codes are IN the string, not only in the sibling `missing` array, and that
 * is a hard requirement rather than a flourish: the admin portal renders API
 * errors through adapters that read `body.message` ONLY
 * (`apps/web/src/app/admin/roles/actions.ts:26-27, 45-47`), so a structured
 * field alone never reaches the human. They are kept raw (`grades.revise`)
 * because `RoleBuilderForm.tsx:322` shows admins raw codes in `font-mono` — the
 * error names exactly what they were just looking at.
 */
export const CEILING_REFUSAL_MESSAGE_PREFIX =
  'Permission(s) refusée(s) : vous ne pouvez pas accorder une permission que vous ne détenez pas vous-même';

const logger = new Logger('PrivilegeCeiling');

function nameCodes(codes: readonly string[]): string {
  const shown = codes.slice(0, MAX_CODES_NAMED);
  const rest = codes.length - shown.length;
  // Capped so a full-catalogue diff does not produce an unreadable wall in a
  // `text-sm` alert box.
  return rest > 0 ? `${shown.join(', ')} (+${rest} autres)` : shown.join(', ');
}

/**
 * The codes in `requested` that the grantor does NOT hold.
 * Order-preserving (first-requested order) and de-duplicated, so `missing`
 * never repeats a code the caller sent twice.
 *
 * @param grantorPermissions the grantor's EFFECTIVE set, derived at the
 *   controller from `UserSyncService.effectivePermissions` — the same seam
 *   `PermissionsGuard:27-28` uses. `undefined` denies everything.
 * @param requested the permission codes the request wants to mint, rewrite or
 *   hand over. Plain `string`, never `PermissionCode` — see the header.
 */
export function exceedsGrantor(
  grantorPermissions: ReadonlySet<string> | undefined,
  requested: readonly string[],
): string[] {
  const held = grantorPermissions ?? NOTHING_HELD;
  if (!Array.isArray(requested)) return [MALFORMED_REQUEST_SENTINEL];

  const exceeding: string[] = [];
  const seen = new Set<string>();
  for (const code of requested) {
    if (held.has(code)) continue;
    if (seen.has(code)) continue;
    seen.add(code);
    exceeding.push(code);
  }
  return exceeding;
}

/**
 * Throwing wrapper — the ONE place the refusal's HTTP shape is built.
 *
 * It exists so the four call sites (`roles.controller` create/update,
 * `users.service.assignRole`, `invite.controller`'s custom-role grant) cannot
 * drift into four slightly different `ForbiddenException` literals. The body is
 * structurally identical to the one `permissions.guard.ts:31-35` already emits —
 * `{ message, required, missing }` — so a client that renders one renders the
 * other. `missing` is the right word: these are the codes missing FROM THE
 * GRANTOR.
 *
 * `message` is a plain string and MUST stay one: `updateRoleAction`
 * (`apps/web/src/app/admin/roles/actions.ts:45-47`) returns `body.message` with
 * no type check and `RoleBuilderForm.tsx:236` renders it directly as a React
 * child — nesting an object under `message` would unmount the role editor with
 * « Objects are not valid as a React child ».
 *
 * A refusal writes NO audit row, deliberately: nothing happened, and the house
 * posture for a pre-transaction refusal (the two cross-tenant guards in
 * `users.service.ts`) is to write nothing. The `warn` below is the compensating
 * trace — an attempted privilege escalation is the highest-value security event
 * on a children's-data platform, and it must not be silent. It carries no actor
 * id because this predicate deliberately has no actor context; that residual is
 * recorded in the ADR-015 `S-E05-2` amendment rather than fixed with a third
 * parameter that would let an options bag in.
 */
export function assertWithinCeiling(
  grantorPermissions: ReadonlySet<string> | undefined,
  requested: readonly string[],
): void {
  const exceeding = exceedsGrantor(grantorPermissions, requested);
  if (exceeding.length === 0) return;

  logger.warn(
    `Privilege ceiling refused a grant: exceeding=[${exceeding.join(', ')}] ` +
      `requested=${Array.isArray(requested) ? requested.length : 'malformed'} ` +
      `grantorHolds=${grantorPermissions?.size ?? 0}`,
  );

  throw new ForbiddenException({
    message: `${CEILING_REFUSAL_MESSAGE_PREFIX} (${nameCodes(exceeding)}).`,
    required: Array.isArray(requested) ? [...requested] : [],
    missing: exceeding,
  });
}
