import { ForbiddenException, Logger } from '@nestjs/common';

/**
 * ADR-040 — the grantor-relative realm-role ladder (`D-12`, `PF-178`, `PF-09` residual).
 *
 * WHY THIS EXISTS AND WHY IT IS NOT THE PERMISSION CEILING
 * -------------------------------------------------------
 * `S-E05-2` closed `PF-156` (vertical privilege escalation) with a grantor-relative
 * PERMISSION ceiling: no grantor may confer a permission they do not themselves
 * hold (`privilege-ceiling.ts`). That ceiling is correct and it stays.
 *
 * Its measured consequence was that a `school_admin` (75 codes) could assign NONE
 * of the four other seeded roles, because each exceeds those 75 somewhere —
 * `teacher` by 6 codes, `parent` by 3, `student` by 5. The product was left with
 * no legitimate path for an administrator to onboard a teacher at all.
 *
 * The resolution is that these are **two different acts**:
 *
 *   - conferring a PERMISSION is bounded by what the grantor holds (the ceiling);
 *   - conferring an IDENTITY — "this person is a teacher" — is bounded by the
 *     grantor's own rung on this ladder.
 *
 * Naming somebody else a teacher is not the same event as awarding oneself
 * `grades.revise`. Conflating them is what produced `PF-156`; separating them is
 * what makes onboarding possible without reopening it.
 *
 * THE THREE PROPERTIES THAT KEEP THIS FROM BEING AN ESCALATION IN DISGUISE
 * -----------------------------------------------------------------------
 * 1. **No self-grant, at any rung** (`assertMayConferRealmRole`, checked FIRST).
 *    Without it a `school_admin` grants themselves `teacher`, re-authenticates,
 *    and holds `grades.revise` — precisely the escalation `S-E05-2` closed,
 *    reached by a longer path. This rule is not optional and not a nicety.
 * 2. **Strictly below, never at or above.** `school_admin → school_admin` is
 *    refused: only a `super_admin` mints an admin. This removes lateral
 *    self-cloning as an escalation route.
 * 3. **An unrankable role is UNGRANTABLE.** A role absent from the ladder is
 *    refused rather than assumed lowest (`DNC-08` — an unclassifiable state is
 *    never a pass). A future seeded role therefore fails closed until somebody
 *    ranks it deliberately.
 *
 * SCOPE — read this before adding a call site
 * ------------------------------------------
 * This ladder governs **seeded system roles only** (`Role.isSystem` with a slug
 * on the ladder). Custom roles and direct permission grants keep the permission
 * ceiling, unchanged. A call site that applies the ladder to a custom role would
 * be granting an unbounded permission set on the strength of a name.
 */

/**
 * Ascending order — index IS the rung. `student` is rung 0.
 *
 * These five slugs are the seeded system roles (`prisma/seed.ts:191-199`) and
 * the keys of `REALM_ROLE_PERMISSIONS` (`permissions.constants.ts:142`). A spec
 * pins that the two sets are identical, so adding a seeded role without ranking
 * it here is a red test rather than a silent fail-closed refusal in production.
 */
export const REALM_ROLE_LADDER = ['student', 'parent', 'teacher', 'school_admin', 'super_admin'] as const;

export type LadderRole = (typeof REALM_ROLE_LADDER)[number];

export const LADDER_SELF_GRANT_MESSAGE =
  'Attribution refusée : vous ne pouvez pas vous attribuer un rôle à vous-même.';

export const LADDER_RANK_MESSAGE_PREFIX =
  'Attribution refusée : vous ne pouvez attribuer qu’un rôle strictement inférieur au vôtre';

export const LADDER_UNRANKED_MESSAGE_PREFIX =
  'Attribution refusée : ce rôle n’est pas classé dans la hiérarchie de délégation';

const logger = new Logger('RoleLadder');

/**
 * The rung of a single role slug, or `undefined` when the slug is not on the
 * ladder. `undefined` means UNRANKABLE, which every caller must treat as a
 * refusal — never as rung 0.
 */
export function rankOf(slug: string | null | undefined): number | undefined {
  if (typeof slug !== 'string') return undefined;
  const index = (REALM_ROLE_LADDER as readonly string[]).indexOf(slug);
  return index === -1 ? undefined : index;
}

/**
 * The HIGHEST rung among the realm roles a grantor actually holds.
 *
 * Highest rather than first: a principal carrying both `teacher` and
 * `school_admin` acts at the admin rung. Unrankable entries (custom realm roles,
 * Keycloak defaults such as `offline_access`) are ignored here rather than
 * refused — they are noise in the token, not a grant request. `undefined` means
 * the grantor holds no rankable role at all, which is a refusal.
 */
export function grantorRank(realmRoles: readonly string[] | undefined): number | undefined {
  if (!Array.isArray(realmRoles)) return undefined;
  let best: number | undefined;
  for (const role of realmRoles) {
    const rank = rankOf(role);
    if (rank === undefined) continue;
    if (best === undefined || rank > best) best = rank;
  }
  return best;
}

/** True when this slug is governed by the ladder rather than by the permission ceiling. */
export function isLadderRole(slug: string | null | undefined): boolean {
  return rankOf(slug) !== undefined;
}

/**
 * The ONE place a realm-role grant is authorised. Throws, or returns silently.
 *
 * Order is load-bearing: the self-grant check runs BEFORE the rank comparison,
 * because a `super_admin` outranks every other rung and would otherwise be
 * permitted to grant themselves anything below — which is the escalation this
 * ladder exists to prevent, performed by the one principal with the most to gain.
 *
 * A refusal writes no audit row here: nothing happened, and the house posture for
 * a pre-transaction refusal is to write nothing (`privilege-ceiling.ts:153-157`).
 * The caller writes the audit row for the grant it performs; the `warn` below is
 * the compensating trace, and an attempted escalation is the highest-value
 * security event on a children's-data platform.
 *
 * @param grantorRealmRoles the grantor's realm roles, from `jwt.realm_access.roles`
 * @param targetSlug the seeded role slug being conferred
 * @param grantorUserId the grantor's own `UserProfile.id`
 * @param subjectUserId the `UserProfile.id` receiving the role
 */
export function assertMayConferRealmRole(
  grantorRealmRoles: readonly string[] | undefined,
  targetSlug: string,
  grantorUserId: string,
  subjectUserId: string,
): void {
  // 1. No self-grant, at any rung. First, deliberately — see the docblock.
  if (grantorUserId === subjectUserId) {
    logger.warn(
      `Role ladder refused a SELF-grant: target=${targetSlug} ` +
        `grantorHolds=[${(grantorRealmRoles ?? []).join(', ')}]`,
    );
    throw new ForbiddenException({
      message: LADDER_SELF_GRANT_MESSAGE,
      required: [targetSlug],
      missing: [targetSlug],
    });
  }

  // 2. An unrankable target is ungrantable (DNC-08 — fail closed).
  const targetRank = rankOf(targetSlug);
  if (targetRank === undefined) {
    logger.warn(`Role ladder refused an UNRANKED target: target=${targetSlug}`);
    throw new ForbiddenException({
      message: `${LADDER_UNRANKED_MESSAGE_PREFIX} (${targetSlug}).`,
      required: [targetSlug],
      missing: [targetSlug],
    });
  }

  // 3. The grantor must themselves be rankable.
  const rank = grantorRank(grantorRealmRoles);
  if (rank === undefined) {
    logger.warn(
      `Role ladder refused: grantor holds no rankable role. ` +
        `target=${targetSlug} grantorHolds=[${(grantorRealmRoles ?? []).join(', ')}]`,
    );
    throw new ForbiddenException({
      message: `${LADDER_RANK_MESSAGE_PREFIX} (${targetSlug}).`,
      required: [targetSlug],
      missing: [targetSlug],
    });
  }

  // 4. Strictly below. `>=` refuses both the equal rung and every rung above.
  if (targetRank >= rank) {
    logger.warn(
      `Role ladder refused a grant at or above the grantor rung: ` +
        `target=${targetSlug}(${targetRank}) grantorRung=${rank}`,
    );
    throw new ForbiddenException({
      message: `${LADDER_RANK_MESSAGE_PREFIX} (${targetSlug}).`,
      required: [targetSlug],
      missing: [targetSlug],
    });
  }
}
