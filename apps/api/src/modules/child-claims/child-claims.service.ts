import {
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  compareParentChildLinkRows,
  deriveParentChildLinkState,
  isNameableForGuardian,
  mayProjectChildIdentity,
} from '@pilotage/contracts';
import type {
  AdminChildClaimQueueResponse,
  AdminChildClaimRow,
  ApproveChildClaimResponse,
  AuditActionCode,
  ChildClaimAlreadyLinkedResponse,
  ChildClaimSubmitResponse,
  GuardianRelationship,
  GuardianshipClaimStatus,
  ParentChildLinkRow,
  ParentChildLinksResponse,
  ParentGuardianshipLinkStatus,
} from '@pilotage/contracts';
import { Prisma } from '@prisma/client';

import { type AuditProvenance } from '../../shared/audit/provenance';
import { writeAudit, type AuditTransactionClient } from '../../shared/audit/write-audit';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

import { type CandidateStudent, matchClaim } from './claim-match';

/**
 * The single uniform submit acknowledgement — IDENTICAL for matched / no-match /
 * ambiguous (the no-oracle wall, FR-3/AC-2). Echoes nothing roster-resolved.
 */
const UNIFORM_RECEIVED: ChildClaimSubmitResponse = {
  outcome: 'received',
  claimId: null,
  status: null,
  child: null,
  message:
    "Demande envoyée — l'établissement va la vérifier et vous serez notifié·e dès qu'elle sera validée.",
};

/** Per-guardian rate-limit (anti-enumeration). Counts EVERY POST attempt in the window. */
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000; // 10 min

export interface SubmitClaimArgs {
  tenantId: string;
  schoolId: string;
  guardianId: string;
  /** the acting parent UserProfile id (audit actorId). */
  actorId: string;
  firstName: string;
  lastName: string;
  /** ISO yyyy-mm-dd or undefined. */
  birthDate?: string;
  externalRef?: string;
  relationship: GuardianRelationship;
  /**
   * Derived by the controller from the JWT, BEFORE the transaction opens
   * (S-E04-7 / PF-122). Non-optional on purpose — `provenance.ts` already states
   * the rule: « un appelant oublié est une erreur de compilation et non une
   * provenance silencieusement nulle ». A default here would be the same silent
   * fallback the `'parent' | 'admin'` parameter used to be.
   */
  provenance: AuditProvenance;
}

type SubmitResult = ChildClaimSubmitResponse | ChildClaimAlreadyLinkedResponse;

/**
 * E9-S1 — Enrollment self-service child-claim service.
 *
 * The parent half of the loop: a deny-by-default, non-enumerating, per-guardian
 * rate-limited match that creates an idempotent, P2002-race-safe GuardianshipClaim
 * driving a `pending` Guardianship (NEVER active — human approval in S2 is the only
 * grant). Every read/write is tenant+school-scoped and server-derived; every write is
 * append-only audited (the AuditLog row IS the status history). The matcher only ever
 * produces a `pending` link; `StudentAccessService` reads `status:'active'` only, so a
 * pending claim grants nothing. See docs/adr/ADR-022-enrollment-self-service-child-claim.md.
 */
@Injectable()
export class ChildClaimsService {
  private readonly logger = new Logger(ChildClaimsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  private toIsoDate(d: Date | null | undefined): string | null {
    if (!d) return null;
    return d.toISOString().slice(0, 10);
  }

  /**
   * Submit a child-claim. Order:
   *  1. rate-limit (count the caller's own POSTs in the window) → 429.
   *  2. run the deny-by-default matcher against the MINIMAL tenant+school-scoped
   *     candidate set (narrowed in SQL by externalRef OR birthDate).
   *  3. matched → if an active link to the matched child already exists for the
   *     caller → already_linked; else create the claim(submitted) + driven pending
   *     Guardianship in one $transaction (idempotent + P2002-race-safe; revoked link
   *     reused back to pending). no_match/ambiguous → claim(match_failed), no link.
   *  4. ALWAYS return the uniform `received` shape (except the caller's own
   *     already_linked branch).
   */
  async submitClaim(args: SubmitClaimArgs): Promise<SubmitResult> {
    // 0. Normalise birthDate to its date portion (yyyy-mm-dd) up-front. The <input
    //    type="date"> form path only ever emits date-only, but a non-form API caller,
    //    an E2E fixture, or a value derived from Date.toISOString() in an east-of-UTC
    //    locale can send a full ISO datetime ('2012-04-05T22:00:00.000Z'). Left raw it
    //    (a) misses the matcher's exact string compare against the date-only candidate,
    //    and (b) `new Date(...)` can resolve to the WRONG calendar day in the @db.Date
    //    filter — a deterministic-but-wrong match_failed. Slicing here fixes both paths
    //    (and every downstream use in handleMatched, which shares this args object).
    if (args.birthDate) args.birthDate = args.birthDate.slice(0, 10);

    // 1. Rate-limit — counts EVERY attempt in the window (including idempotent
    //    no-ops and match_failed), so the oracle-probing path is the one throttled.
    const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MS);
    const recent = await this.prisma.guardianshipClaim.count({
      where: { tenantId: args.tenantId, guardianId: args.guardianId, createdAt: { gte: windowStart } },
    });
    if (recent >= RATE_LIMIT_MAX) {
      throw new HttpException(
        'Trop de tentatives — réessayez dans quelques minutes.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // 2. Matcher. Fetch the MINIMAL candidate set — ALWAYS tenant+school scoped AND
    //    narrowed in SQL by the corroborating factor (a DOB-only/name-only probe never
    //    materialises a population — PM-2). A name-only claim fetches nothing.
    const byExternalRef: CandidateStudent[] = args.externalRef
      ? (
          await this.prisma.student.findMany({
            where: {
              tenantId: args.tenantId,
              schoolId: args.schoolId,
              externalRef: args.externalRef.trim(),
            },
            select: { id: true, firstName: true, lastName: true, birthDate: true, externalRef: true },
            take: 2,
          })
        ).map((s) => ({ ...s, birthDate: this.toIsoDate(s.birthDate) }))
      : [];

    const byBirthDate: CandidateStudent[] = args.birthDate
      ? (
          await this.prisma.student.findMany({
            where: {
              tenantId: args.tenantId,
              schoolId: args.schoolId,
              birthDate: new Date(args.birthDate),
            },
            select: { id: true, firstName: true, lastName: true, birthDate: true, externalRef: true },
          })
        ).map((s) => ({ ...s, birthDate: this.toIsoDate(s.birthDate) }))
      : [];

    const result = matchClaim(
      {
        firstName: args.firstName,
        lastName: args.lastName,
        birthDate: args.birthDate,
        externalRef: args.externalRef,
      },
      { byExternalRef, byBirthDate },
    );

    if (result.outcome === 'matched' && result.studentId) {
      return this.handleMatched(args, result.studentId);
    }

    // 3b. No/ambiguous match → record a match_failed claim, NO link, uniform response.
    await this.prisma.$transaction(async (tx) => {
      const claim = await tx.guardianshipClaim.create({
        data: {
          tenantId: args.tenantId,
          schoolId: args.schoolId,
          guardianId: args.guardianId,
          claimedFirstName: args.firstName,
          claimedLastName: args.lastName,
          claimedDob: args.birthDate ? new Date(args.birthDate) : null,
          claimedExternalRef: args.externalRef ?? null,
          relationship: args.relationship,
          status: 'match_failed',
        },
      });
      await this.audit(
        tx,
        args,
        'guardianship.claim_match_failed',
        null,
        {
          status: 'match_failed',
          claimedFirstName: args.firstName,
          claimedLastName: args.lastName,
          claimedDob: args.birthDate ?? null,
          claimedExternalRef: args.externalRef ?? null,
        },
        args.provenance,
      );
      return claim;
    });

    return UNIFORM_RECEIVED;
  }

  /**
   * Matched path. Idempotent on (guardian, child) + P2002-race-safe.
   *  - an EXISTING active link to the matched child (caller's own) → already_linked.
   *  - an EXISTING pending link (already-submitted) → uniform received (no dup).
   *  - a revoked link → reused back to pending (createGuardianship revoked-reuse idiom).
   *  - else create the pending Guardianship + the driving claim in ONE transaction.
   * A concurrent double-submit hitting P2002 (on @@unique([guardianId,studentId]) or
   * the partial open-claim index) is caught and collapsed to the existing row.
   */
  private async handleMatched(args: SubmitClaimArgs, studentId: string): Promise<SubmitResult> {
    const existingLink = await this.prisma.guardianship.findUnique({
      where: { guardianId_studentId: { guardianId: args.guardianId, studentId } },
    });

    // Caller's OWN already-active link → gentle already_linked (never confirms any
    // other child). The chosen Sentinel reading keeps this branch.
    if (existingLink && existingLink.status === 'active') {
      return { outcome: 'already_linked', studentId };
    }

    // Already a pending link with an open claim → return the uniform response (no dup row).
    if (existingLink && existingLink.status === 'pending') {
      const openClaim = await this.prisma.guardianshipClaim.findFirst({
        where: { guardianshipId: existingLink.id, status: 'submitted' },
      });
      if (openClaim) return UNIFORM_RECEIVED;
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        // Create OR reuse the driven link as `pending` (never active; never stamps
        // approvedBy/approvedAt). A revoked row is reused back to pending.
        const link = existingLink
          ? await tx.guardianship.update({
              where: { id: existingLink.id },
              data: {
                relationship: args.relationship,
                status: 'pending',
                approvedBy: null,
                approvedAt: null,
                revokedAt: null,
              },
            })
          : await tx.guardianship.create({
              data: {
                tenantId: args.tenantId,
                guardianId: args.guardianId,
                studentId,
                relationship: args.relationship,
                status: 'pending',
              },
            });

        const claim = await tx.guardianshipClaim.create({
          data: {
            tenantId: args.tenantId,
            schoolId: args.schoolId,
            guardianId: args.guardianId,
            claimedFirstName: args.firstName,
            claimedLastName: args.lastName,
            claimedDob: args.birthDate ? new Date(args.birthDate) : null,
            claimedExternalRef: args.externalRef ?? null,
            relationship: args.relationship,
            matchedStudentId: studentId,
            guardianshipId: link.id,
            status: 'submitted',
          },
        });

        await this.audit(
          tx,
          args,
          'guardianship.claim_submitted',
          null,
          {
            status: 'submitted',
            claimedFirstName: args.firstName,
            claimedLastName: args.lastName,
            claimedDob: args.birthDate ?? null,
            claimedExternalRef: args.externalRef ?? null,
            matchedStudentId: studentId,
            guardianshipId: link.id,
          },
          args.provenance,
        );

        return claim;
      });
    } catch (err) {
      // Concurrent double-submit collapsed to the existing row — never a 500.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        this.logger.warn(
          `P2002 on child-claim submit (guardian=${args.guardianId}, student=${studentId}) — collapsed to existing row.`,
        );
        return UNIFORM_RECEIVED;
      }
      throw err;
    }

    return UNIFORM_RECEIVED;
  }

  /**
   * S-E03-3b / PF-357 / PF-12 / ADR-073 — the parent's own attachment surface,
   * projected from the FACT (`Guardianship`) unioned with its PROVENANCE
   * (`GuardianshipClaim`), self-scoped to the resolved Guardian and tenant-scoped.
   *
   * WHAT THIS REPLACES, AND WHY IT IS NOT A REFACTOR
   * -----------------------------------------------
   * `listForGuardian` read ONE table — the request — while the children list rendered
   * three centimetres above it on the same page reads the other one — the fact. Measured
   * 2026-08-26 on the live stack: **2460 `active` links, 28 `pending`, 2459 distinct
   * guardians holding an active link, and 0 claims**. So EVERY parent in the data was
   * shown their children and then told « Vous n'avez pas encore rattaché d'enfant ».
   * That is `DNC-01` — a panel contradicting its own page — and it is `PF-12`'s third
   * clause verbatim.
   *
   * THE UNION, IN THREE STEPS (§3.2). ROW IDENTITY IS THE CHILD, NOT THE RECORD (§3.1)
   * ---------------------------------------------------------------------------------
   *   1. every `Guardianship` of the caller becomes a row — **this is AC-1**;
   *   2. a claim resolving to an identity that already has a row becomes that row's
   *      PROVENANCE; otherwise it IS a row of its own — **this is AC-2**;
   *   3. provenance attaches BY PREFERENCE: first the claim whose `guardianshipId`
   *      equals the link's id, failing that the caller's most recent claim whose
   *      `matchedStudentId` equals the link's `studentId`, ordered `[createdAt desc,
   *      id desc]`.
   *
   * `identity(entity) = studentId ?? matchedStudentId ?? id`, and
   * `@@unique([guardianId, studentId])` (`schema.prisma:589`) makes the FACT side of a
   * row unambiguous by construction.
   *
   * ⚠ **Step 3's fallback is load-bearing, not tidiness.** BOTH `withdraw()` and
   * `rejectClaim()` null `guardianshipId` while revoking the link, in the same
   * transaction — see their own docblocks for why the FK must be released. Without the
   * fallback the revoked link they leave behind looks ADMIN-CREATED, loses the
   * `claimed*` values the parent typed, and is therefore dropped as unnameable (§3.4's
   * corollary) — so the parent's own withdrawn / rejected request would silently vanish
   * from the panel instead of resolving to `request_withdrawn` / `request_rejected`
   * with its « Renvoyer une demande » affordance. That is `FM-1`. Guarded by T-3 and
   * T-10. Recorded, not fixed: `PF-369`.
   *
   * ⚠ Before this slice's REVIEW pass the same missing fallback was a *leak* rather
   * than a disappearance, because `mayProjectChildIdentity` carried a `provenance ===
   * null` disjunct that printed the child's real name for admin-created links of ANY
   * status. That disjunct is gone (`ADR-073 §D5`); see the predicate's docblock.
   *
   * ⚠ Never `where: { guardianshipId: null }` to find the "orphan" claims. Membership is
   * DERIVED from the identity map — a hand-written second list of the same thing is how
   * the two sides drift (the paired-lists lesson).
   *
   * ONE ROW PER CHILD, INCLUDING WHEN THAT ABSORBS A ROW (W-2)
   * ----------------------------------------------------------
   * Claim-created rows join the identity map too, so two DETACHED claims at one identity
   * — reachable through reject → resubmit → reject, and through the revoked-reuse branch
   * of `submitClaim` — collapse to ONE row whose provenance is the most recent claim.
   * The older claim is absorbed and stops rendering. That is a deliberate
   * one-child-one-row decision (ADR-073 §R), not an accident.
   *
   * TENANCY (G-TENANT) — both reads carry `tenantId` AND `guardianId`, both server-derived
   * by the controller's `resolveGuardian`, never client-supplied, and both spelled as
   * plain required members. Never `...(x ? { x } : {})` in a `where`: Prisma strips
   * `undefined` and the query silently WIDENS (`ADR-065 §D5`).
   *
   * FM-4 / DNC-06 — every field of the wire shape has a source in a `select` written
   * here. The `student` relation on the GUARDIANSHIP read is the one that matters: 2460
   * of 2460 live active links have no claim at all, so omitting it would leave
   * `displayName` and `child` with no source for exactly the rows this method exists to
   * produce — `FM-4` reproduced inside its own fix.
   *
   * Two `findMany` calls replace one. No client N+1; no per-row query.
   */
  async listChildLinksForGuardian(args: {
    tenantId: string;
    guardianId: string;
  }): Promise<ParentChildLinksResponse> {
    const [links, claims] = await Promise.all([
      this.prisma.guardianship.findMany({
        where: { tenantId: args.tenantId, guardianId: args.guardianId },
        select: {
          id: true,
          studentId: true,
          relationship: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          // FM-4: without this the 2460 claim-less active links have NO name to print.
          student: { select: { id: true, firstName: true, lastName: true } },
        },
      }),
      this.prisma.guardianshipClaim.findMany({
        where: { tenantId: args.tenantId, guardianId: args.guardianId },
        select: {
          id: true,
          status: true,
          relationship: true,
          guardianshipId: true,
          matchedStudentId: true,
          claimedFirstName: true,
          claimedLastName: true,
          claimedDob: true,
          decisionReason: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
    ]);

    type LinkRow = (typeof links)[number];
    type ClaimRow = (typeof claims)[number];
    interface Draft {
      link: LinkRow | null;
      provenance: ClaimRow | null;
    }

    // Step 1 — every link of the caller is a row, keyed by the CHILD.
    const byIdentity = new Map<string, Draft>();
    const byLinkId = new Map<string, Draft>();
    for (const link of links) {
      const draft: Draft = { link, provenance: null };
      byIdentity.set(link.studentId, draft);
      byLinkId.set(link.id, draft);
    }

    // The one ordering used to decide preference, stated once: most recent first.
    const ordered = [...claims].sort((a, b) => {
      const at = a.createdAt.getTime();
      const bt = b.createdAt.getTime();
      if (at !== bt) return bt - at;
      if (a.id === b.id) return 0;
      return a.id < b.id ? 1 : -1;
    });

    // Step 3, first preference — the joined claim (`guardianshipId` is @unique, so at
    // most one claim can claim a given link).
    const attached = new Set<string>();
    for (const claim of ordered) {
      if (claim.guardianshipId === null) continue;
      const draft = byLinkId.get(claim.guardianshipId);
      if (draft && draft.provenance === null) {
        draft.provenance = claim;
        attached.add(claim.id);
      }
    }

    // Step 2 + step 3's fallback — in [createdAt desc, id desc] order, so the FIRST
    // claim to reach an identity is the most recent one, which is the preference §3.2
    // states. A claim reaching an identity that already holds provenance is ABSORBED.
    for (const claim of ordered) {
      if (attached.has(claim.id)) continue;
      const identity = claim.matchedStudentId ?? claim.id;
      const existing = byIdentity.get(identity);
      if (existing) {
        if (existing.provenance === null) existing.provenance = claim;
        continue;
      }
      byIdentity.set(identity, { link: null, provenance: claim });
    }

    const rows: ParentChildLinkRow[] = [];
    for (const draft of byIdentity.values()) {
      // §3.4 / ADR-073 §D4+§D5 — a draft with NO provenance and a link that is not
      // `active` has no name this caller may read: the child's identity is walled off
      // by the same `status: 'active'` rule `StudentAccessService` applies, and the
      // parent typed no `claimed*` values because they never made a request. It is
      // NOT rendered nameless — it is not projected at all. Dropping it here rather
      // than blanking `displayName` downstream is what keeps `link.student` from
      // leaking back out through the projection's own name fallback.
      if (!isNameableForGuardian(draft.link, draft.provenance)) continue;
      rows.push(this.projectChildLinkRow(draft.link, draft.provenance));
    }

    // §3.6 — ONE deterministic total order, stated once in the contract module.
    rows.sort(compareParentChildLinkRows);

    return { links: rows };
  }

  /**
   * The projection of ONE union row. Every downstream decision is taken HERE so the
   * portal is handed verdicts and no predicate (`ADR-073 §D1`): the raw
   * `GuardianshipClaimStatus` never reaches the wire, not as `status`, not nested.
   *
   * `displayName` is TOTAL, and the proof is short enough to keep next to the code.
   * `mayProjectChildIdentity` is `link !== null && link.status === 'active'`, and the
   * caller has already dropped every draft failing `isNameableForGuardian`, so on entry
   * `provenance !== null || (link !== null && link.status === 'active')`. If the
   * identity is not projected, `provenance !== null`, so `claimed*` exists. `(no link,
   * no claim)` is unreachable and the derivation throws on it (T-9). Every reachable
   * branch therefore has a name to print, and the branch that would have had to read
   * `link.student` WITHOUT the identity gate no longer exists — it throws, because
   * reaching it would mean the caller's filter was removed and a child's name was about
   * to be printed to a guardian the school has not (or no longer) authorised.
   *
   * `canWithdraw === true ⇒ claimId !== null` holds BY CONSTRUCTION — both read the same
   * `provenance` — which is what keeps the withdraw POST off the row's `id` (`FM-6`).
   */
  private projectChildLinkRow(
    link: {
      id: string;
      studentId: string;
      relationship: GuardianRelationship;
      status: ParentGuardianshipLinkStatus;
      createdAt: Date;
      updatedAt: Date;
      student: { id: string; firstName: string; lastName: string };
    } | null,
    provenance: {
      id: string;
      status: GuardianshipClaimStatus;
      relationship: GuardianRelationship;
      claimedFirstName: string;
      claimedLastName: string;
      claimedDob: Date | null;
      decisionReason: string | null;
      createdAt: Date;
      updatedAt: Date;
    } | null,
  ): ParentChildLinkRow {
    const state = deriveParentChildLinkState(link?.status ?? null, provenance?.status ?? null);
    const child =
      mayProjectChildIdentity(link, provenance) && link !== null
        ? {
            studentId: link.student.id,
            firstName: link.student.firstName,
            lastName: link.student.lastName,
          }
        : null;

    // The parent's OWN typed values are the fallback — they leak nothing, because the
    // parent supplied them. There is deliberately NO third fallback onto
    // `link.student`: that was the second path by which a non-active link printed the
    // child's real name, and it survived the identity gate on its own. An unnameable
    // draft is filtered upstream, so reaching here means that filter was removed.
    if (child === null && provenance === null) {
      throw new Error(
        'projectChildLinkRow: unnameable row reached the projection — a link that is not ' +
          '`active` with no provenance must be dropped by `isNameableForGuardian` (ADR-073 §D4/§D5).',
      );
    }
    const displayName = child
      ? `${child.firstName} ${child.lastName}`
      : `${provenance!.claimedFirstName} ${provenance!.claimedLastName}`;

    const isRejected = state === 'request_rejected';
    const timestamps = link ?? provenance;

    return {
      id: link?.id ?? provenance!.id,
      state,
      displayName,
      relationship: link?.relationship ?? provenance!.relationship,
      child,
      claimedBirthDate: provenance ? this.toIsoDate(provenance.claimedDob) : null,
      decisionReason: isRejected ? (provenance?.decisionReason ?? null) : null,
      claimId: provenance?.id ?? null,
      // PF-367 — UNCHANGED semantics, deliberately: widening this is a mutation change
      // (`withdraw()`'s from-status guard), therefore G-AUDIT, therefore its own slice.
      canWithdraw: provenance?.status === 'submitted',
      resubmit:
        isRejected && provenance
          ? {
              firstName: provenance.claimedFirstName,
              lastName: provenance.claimedLastName,
              birthDate: this.toIsoDate(provenance.claimedDob),
              relationship: provenance.relationship,
            }
          : null,
      createdAt: timestamps!.createdAt.toISOString(),
      updatedAt: timestamps!.updatedAt.toISOString(),
    };
  }

  /**
   * Withdraw a still-`submitted` claim (self-scoped — the claim's guardianId MUST equal
   * the caller's own Guardian; 404-before-403, no cross-family leak). Flips the claim
   * to `withdrawn` AND its driven Guardianship to `revoked` in one $transaction, both
   * from-status-guarded (the ADR-020 idiom) so a double-withdraw is a deterministic
   * harmless no-op. Append-only `guardianship.claim_withdrawn` audit.
   *
   * Returns true when something was withdrawn; false when nothing was withdrawable
   * (the controller maps a missing/own-but-not-submitted claim to 404 / a calm no-op).
   */
  async withdraw(args: {
    tenantId: string;
    guardianId: string;
    actorId: string;
    claimId: string;
    /** Derived from the JWT before the transaction opens (S-E04-7). */
    provenance: AuditProvenance;
  }): Promise<boolean> {
    const claim = await this.prisma.guardianshipClaim.findFirst({
      where: { id: args.claimId, tenantId: args.tenantId, guardianId: args.guardianId },
    });
    // 404-before-403: a missing / cross-family / cross-tenant id is indistinguishable.
    if (!claim) return false;

    const updated = await this.prisma.$transaction(async (tx) => {
      const res = await tx.guardianshipClaim.updateMany({
        where: { id: claim.id, tenantId: args.tenantId, guardianId: args.guardianId, status: 'submitted' },
        // Also DECOUPLE the claim from its (about-to-be-revoked) link by nulling
        // guardianshipId: GuardianshipClaim.guardianshipId is @unique, so a later
        // withdraw→reclaim of the same child reuses the revoked link and inserts a NEW
        // submitted claim with guardianshipId=link.id — which would collide on that
        // unique and be silently swallowed by the P2002 catch (leaving the link stuck
        // 'revoked', nothing in the S2 queue). Releasing the FK here keeps re-claim sound.
        data: { status: 'withdrawn', guardianshipId: null },
      });
      if (res.count === 0) return false; // double-withdraw / not-submitted → no-op.

      if (claim.guardianshipId) {
        await tx.guardianship.updateMany({
          where: { id: claim.guardianshipId, tenantId: args.tenantId, status: 'pending' },
          data: { status: 'revoked', revokedAt: new Date() },
        });
      }

      await this.audit(
        tx,
        { tenantId: args.tenantId, actorId: args.actorId } as SubmitClaimArgs,
        'guardianship.claim_withdrawn',
        { status: 'submitted' },
        { status: 'withdrawn', guardianship: 'revoked' },
        args.provenance,
      );
      return true;
    });

    return updated;
  }

  // ---------------------------------------------------------------------------
  // E9-S2 — Admin approval queue + atomic approve/reject + best-effort notify.
  //
  // The admin half of enrollment self-service. Every read/write is tenant-scoped
  // and server-derived (me.tenantId/me.id, NEVER client-supplied). The queue is
  // walled at the controller by `guardianships.approve` (admin-only — NOT bare
  // `guardianships.read`, which parent+teacher also hold; the pre-mortem FM-1
  // leak). The approve transition (claim submitted→approved AND link pending→active)
  // happens in ONE from-status-guarded $transaction (the ADR-020 idiom): the second
  // of two concurrent approvers deterministically loses with a 409, never a double
  // grant, never a 500. The single transition IS the access grant —
  // StudentAccessService reads `status:'active'`, so there is no second wiring step.
  // The parent notification fan-out runs AFTER the committed transaction, wrapped in
  // its own try/catch — a Redis/dispatch failure (or a null-login guardian) is
  // logged and swallowed and can NEVER roll back the decision (FM-7/FM-8).
  // ---------------------------------------------------------------------------

  /**
   * The admin approval queue. ONE aggregate `findMany` (no N+1) projected to
   * AdminChildClaimRow: the parent's typed evidence + a derived matchMethod, the
   * joined matched Student summary (null on a match_failed row), and the requesting
   * Guardian identity (name + login email). Oldest-first (FIFO — the longest-waiting
   * family is actioned first, per tasks.md FR-4). Tenant-scoped; `status` defaults to
   * 'submitted' at the controller and is validated against the enum there.
   */
  async listQueueForAdmin(args: {
    tenantId: string;
    status: GuardianshipClaimStatus;
  }): Promise<AdminChildClaimQueueResponse> {
    const rows = await this.prisma.guardianshipClaim.findMany({
      where: { tenantId: args.tenantId, status: args.status },
      orderBy: { createdAt: 'asc' },
      include: {
        student: {
          select: { id: true, firstName: true, lastName: true, birthDate: true, externalRef: true },
        },
        guardian: {
          select: { id: true, firstName: true, lastName: true, userProfileId: true, email: true },
        },
      },
    });

    const data: AdminChildClaimRow[] = rows.map((r) => ({
      claimId: r.id,
      status: r.status,
      guardianshipId: r.guardianshipId,
      submittedAt: r.createdAt.toISOString(),
      relationship: r.relationship,
      evidence: {
        firstName: r.claimedFirstName,
        lastName: r.claimedLastName,
        birthDate: this.toIsoDate(r.claimedDob),
        externalRef: r.claimedExternalRef,
        matchMethod: r.claimedExternalRef ? 'externalRef' : r.claimedDob ? 'name+dob' : null,
      },
      matchedStudent: r.student
        ? {
            studentId: r.student.id,
            firstName: r.student.firstName,
            lastName: r.student.lastName,
            birthDate: this.toIsoDate(r.student.birthDate),
            externalRef: r.student.externalRef,
          }
        : null,
      requestingParent: {
        guardianId: r.guardian.id,
        firstName: r.guardian.firstName,
        lastName: r.guardian.lastName,
        userProfileId: r.guardian.userProfileId,
        email: r.guardian.email,
      },
    }));

    return { data };
  }

  /**
   * Approve a pending claim — the atomic access grant. Flow ORDER (404-before-403,
   * no leak):
   *  1. load the claim by { id, tenantId } — a missing/cross-tenant id → 404.
   *  2. idempotent re-approve: claim already `approved` AND its link already `active`
   *     → no-op 200 (never a duplicate grant, never a 2nd audit/notification).
   *  3. claim not `submitted` (rejected/withdrawn/match_failed) → 409.
   *  4. no driven link (a match_failed has guardianshipId=null) → 409 (nothing to grant).
   *  5. ONE $transaction: from-status-guarded link flip pending→active (count===0 → a
   *     concurrent winner already flipped it → 409); then claim submitted→approved; then
   *     append-only `guardianship.claim_approved` audit (actorRole = the JWT's realm role,
   *     PF-122 — never the literal 'admin', which is not a realm role).
   *  6. AFTER commit: best-effort parent notification (never rolls back).
   */
  async approveClaim(args: {
    tenantId: string;
    actorId: string;
    claimId: string;
    /** PF-122: the acting admin's REAL realm role, derived at the controller. */
    provenance: AuditProvenance;
  }): Promise<ApproveChildClaimResponse> {
    const claim = await this.prisma.guardianshipClaim.findFirst({
      where: { id: args.claimId, tenantId: args.tenantId },
    });
    if (!claim) throw new NotFoundException('Demande introuvable');

    // Idempotent re-approve: already approved + the driven link already active → no-op.
    if (claim.status === 'approved' && claim.guardianshipId && claim.matchedStudentId) {
      const link = await this.prisma.guardianship.findFirst({
        where: { id: claim.guardianshipId, tenantId: args.tenantId, status: 'active' },
        select: { id: true },
      });
      if (link) {
        return {
          claimId: claim.id,
          status: 'approved',
          guardianshipId: claim.guardianshipId,
          guardianshipStatus: 'active',
          studentId: claim.matchedStudentId,
        };
      }
    }

    if (claim.status !== 'submitted') {
      throw new ConflictException("Cette demande n'est plus en attente");
    }
    if (!claim.guardianshipId || !claim.matchedStudentId) {
      throw new ConflictException("Cette demande n'est plus en attente");
    }

    const guardianshipId = claim.guardianshipId;
    const studentId = claim.matchedStudentId;

    await this.prisma.$transaction(async (tx) => {
      // From-status-guarded link flip pending→active (the access grant). If a
      // concurrent approver already flipped it, count===0 → the loser 409s (ADR-020).
      const linkRes = await tx.guardianship.updateMany({
        where: { id: guardianshipId, tenantId: args.tenantId, status: 'pending' },
        data: { status: 'active', approvedBy: args.actorId, approvedAt: new Date(), revokedAt: null },
      });
      if (linkRes.count === 0) {
        throw new ConflictException("Cette demande n'est plus en attente");
      }

      const claimRes = await tx.guardianshipClaim.updateMany({
        where: { id: claim.id, tenantId: args.tenantId, status: 'submitted' },
        data: { status: 'approved', decidedBy: args.actorId, decidedAt: new Date() },
      });
      if (claimRes.count === 0) {
        throw new ConflictException("Cette demande n'est plus en attente");
      }

      await this.audit(
        tx,
        { tenantId: args.tenantId, actorId: args.actorId },
        'guardianship.claim_approved',
        { status: 'submitted', guardianship: 'pending' },
        {
          status: 'approved',
          guardianship: 'active',
          decidedBy: args.actorId,
          decidedAt: new Date().toISOString(),
        },
        // PF-122 (write half): the actor's REAL Keycloak realm role, derived
        // from the JWT at the controller, never the literal 'admin' — which is
        // not a realm role and never was.
        args.provenance,
      );
    });

    // Best-effort parent notification AFTER commit (never rolls back the grant).
    await this.notifyParentOfDecision({
      tenantId: args.tenantId,
      claimId: claim.id,
      guardianId: claim.guardianId,
      decision: 'approved',
      studentId,
    });

    return {
      claimId: claim.id,
      status: 'approved',
      guardianshipId,
      guardianshipStatus: 'active',
      studentId,
    };
  }

  /**
   * Reject a pending claim — grants nothing. Flow ORDER mirrors approve:
   *  1. load by { id, tenantId } → 404 if missing/cross-tenant.
   *  2. claim not `submitted` → 409.
   *  3. ONE $transaction: if a driven link exists, from-status-guarded pending→revoked;
   *     claim submitted→rejected (+ decisionReason/decidedBy/decidedAt); count===0 →
   *     409 (raced); append-only `guardianship.claim_rejected` audit (actorRole 'admin').
   *     The revoked link + rejected claim are reused back by the S1 submit revoked-reuse
   *     branch, so a parent re-submit re-opens the queue.
   *  4. AFTER commit: best-effort parent notification (never rolls back).
   */
  async rejectClaim(args: {
    tenantId: string;
    actorId: string;
    claimId: string;
    reason: string;
    /** PF-122: the acting admin's REAL realm role, derived at the controller. */
    provenance: AuditProvenance;
  }): Promise<{ claimId: string; status: 'rejected' }> {
    const reason = args.reason.trim();
    const claim = await this.prisma.guardianshipClaim.findFirst({
      where: { id: args.claimId, tenantId: args.tenantId },
    });
    if (!claim) throw new NotFoundException('Demande introuvable');
    if (claim.status !== 'submitted') {
      throw new ConflictException("Cette demande n'est plus en attente");
    }

    await this.prisma.$transaction(async (tx) => {
      const claimRes = await tx.guardianshipClaim.updateMany({
        where: { id: claim.id, tenantId: args.tenantId, status: 'submitted' },
        // DECOUPLE the rejected claim from its (about-to-be-revoked) link by nulling
        // guardianshipId — same reasoning as the withdraw path: GuardianshipClaim.guardianshipId
        // is @unique, so a parent re-submit reuses the revoked link and inserts a NEW submitted
        // claim with guardianshipId=link.id. Leaving the rejected claim holding that FK makes the
        // re-submit collide on the unique → silently swallowed by the P2002 catch (link stuck
        // 'pending', nothing in the S2 queue, invisible to admins). Releasing the FK keeps re-claim sound.
        data: {
          status: 'rejected',
          guardianshipId: null,
          decisionReason: reason,
          decidedBy: args.actorId,
          decidedAt: new Date(),
        },
      });
      if (claimRes.count === 0) {
        throw new ConflictException("Cette demande n'est plus en attente");
      }

      if (claim.guardianshipId) {
        await tx.guardianship.updateMany({
          where: { id: claim.guardianshipId, tenantId: args.tenantId, status: 'pending' },
          data: { status: 'revoked', revokedAt: new Date() },
        });
      }

      await this.audit(
        tx,
        { tenantId: args.tenantId, actorId: args.actorId },
        'guardianship.claim_rejected',
        { status: 'submitted', guardianship: 'pending' },
        { status: 'rejected', guardianship: 'revoked', decisionReason: reason },
        // PF-122 (write half): see approveClaim — the real realm role, not 'admin'.
        args.provenance,
      );
    });

    // Best-effort parent notification AFTER commit (never rolls back the rejection).
    await this.notifyParentOfDecision({
      tenantId: args.tenantId,
      claimId: claim.id,
      guardianId: claim.guardianId,
      decision: 'rejected',
      studentId: claim.matchedStudentId,
      reason,
    });

    return { claimId: claim.id, status: 'rejected' };
  }

  /**
   * Best-effort parent notification on a decision. Mirrors the enrollments
   * `notifyGuardiansOfEnrollment` precedent: resolves the recipient userProfileId
   * from the claim's Guardian (skip if null — no login, no-op), fans out ONE in-app
   * `enrollment_status` notification (the REUSED kind — there is no 'guardianship'
   * NotificationKind), sourceType='guardianship_claim' with the decision verb appended
   * (so re-decisions on the same claim don't collapse on the createMany dedup key),
   * sourceId=claimId. Wrapped in try/catch — a notification/Redis/dispatch failure is
   * LOGGED and swallowed; it runs AFTER the committed transaction and can never roll it
   * back. Approve deep-links to the now-accessible child; reject deep-links to the
   * re-submit surface. Copy is kind / non-stigmatising (never 'refusé/échec' as fault).
   */
  private async notifyParentOfDecision(args: {
    tenantId: string;
    claimId: string;
    guardianId: string;
    decision: 'approved' | 'rejected';
    studentId: string | null;
    reason?: string;
  }): Promise<void> {
    try {
      const guardian = await this.prisma.guardian.findFirst({
        where: { id: args.guardianId, tenantId: args.tenantId },
        select: { userProfileId: true },
      });
      const recipient = guardian?.userProfileId;
      if (!recipient) return; // admin-created guardian, no login yet → no-op.

      // Resolve the child's first name for the (non-stigmatising) copy, best-effort.
      let childFirstName = 'votre enfant';
      if (args.studentId) {
        const student = await this.prisma.student.findFirst({
          where: { id: args.studentId, tenantId: args.tenantId },
          select: { firstName: true },
        });
        if (student) childFirstName = student.firstName;
      }

      if (args.decision === 'approved') {
        await this.notifications.createMany([
          {
            tenantId: args.tenantId,
            userProfileId: recipient,
            kind: 'enrollment_status',
            severity: 'success',
            title: `Rattachement validé — ${childFirstName}`,
            body: `Votre rattachement à ${childFirstName} a été validé. Vous avez désormais accès à son dossier.`,
            link: args.studentId ? `/parent/children/${args.studentId}` : '/parent/children',
            sourceType: 'guardianship_claim_approved',
            sourceId: args.claimId,
          },
        ]);
      } else {
        await this.notifications.createMany([
          {
            tenantId: args.tenantId,
            userProfileId: recipient,
            kind: 'enrollment_status',
            severity: 'info',
            title: 'Information à vérifier sur votre demande',
            body: args.reason
              ? `Votre demande de rattachement n'a pas pu être validée. Motif : ${args.reason}. Consultez le détail et renvoyez une demande corrigée.`
              : "Votre demande de rattachement n'a pas pu être validée. Consultez le détail et renvoyez une demande corrigée.",
            link: '/parent/children',
            sourceType: 'guardianship_claim_rejected',
            sourceId: args.claimId,
          },
        ]);
      }
    } catch (err) {
      this.logger.warn(
        `[child-claims] decision notification fan-out failed (claim=${args.claimId}, decision=${args.decision}) — swallowed, decision stands.`,
        err as Error,
      );
    }
  }

  /**
   * Append-only audit for the claim lifecycle, now through the shared seam
   * (`writeAudit`, `ADR-035`), inside the caller's transaction.
   *
   * ## PF-122's write half — why the `'parent' | 'admin'` parameter is gone
   *
   * This helper used to take `actor: 'parent' | 'admin' = 'parent'` and write it
   * into **both** `actorRole` and `portal`. `portal: 'admin'` was right.
   * `actorRole: 'admin'` was not: **`admin` is not a Keycloak realm role.** The
   * realm roles are the ones `ROLE_PRECEDENCE` lists in
   * `shared/audit/provenance.ts`, and an administrator authenticates as
   * `school_admin`. So every approve/reject decision recorded a role nobody
   * holds — and routing that value through the canonical seam unchanged would
   * have laundered a known-wrong provenance into the one place the repository
   * points at as authoritative. That is why the parameter is replaced rather
   * than forwarded.
   *
   * The value now comes from `deriveAuditProvenance(jwt, …)` at the controller,
   * ABOVE the `$transaction` call — S-E06-6's ordering rule, because
   * `AuditLog.ipAddress` is `@db.Inet` and a failed cast inside the transaction
   * would roll back the decision the row exists to trace.
   *
   * **Who may approve or reject is unchanged.** `@RequiresPermission
   * ('guardianships.approve')` and every ABAC path are untouched; this is a
   * change to what the row *says*, not to what the endpoint *allows* (ADR-015).
   */
  private async audit(
    // PF-164 — the BRAND, not `Prisma.TransactionClient`; see the same note on
    // `academic-years.controller.ts#audit`. Widening here would make the
    // compile-time half of `ADR-035` D1 unfireable one hop from the seam.
    tx: AuditTransactionClient,
    args: Pick<SubmitClaimArgs, 'tenantId' | 'actorId'>,
    action: AuditActionCode,
    before: Prisma.InputJsonValue | null,
    after: Prisma.InputJsonValue,
    provenance: AuditProvenance,
  ): Promise<void> {
    await writeAudit(tx, {
      tenantId: args.tenantId,
      actorId: args.actorId,
      action,
      resourceType: 'guardianship_claim',
      resourceId: null,
      provenance,
      ...(before === null ? {} : { before }),
      after,
    });
  }
}
