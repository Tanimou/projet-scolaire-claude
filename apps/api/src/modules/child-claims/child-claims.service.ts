import {
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  AdminChildClaimQueueResponse,
  AdminChildClaimRow,
  ApproveChildClaimResponse,
  ChildClaimAlreadyLinkedResponse,
  ChildClaimListResponse,
  ChildClaimStatusRow,
  ChildClaimSubmitResponse,
  GuardianRelationship,
  GuardianshipClaimStatus,
} from '@pilotage/contracts';

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
      await this.audit(tx, args, 'guardianship.claim_match_failed', null, {
        status: 'match_failed',
        claimedFirstName: args.firstName,
        claimedLastName: args.lastName,
        claimedDob: args.birthDate ?? null,
        claimedExternalRef: args.externalRef ?? null,
      });
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

        await this.audit(tx, args, 'guardianship.claim_submitted', null, {
          status: 'submitted',
          claimedFirstName: args.firstName,
          claimedLastName: args.lastName,
          claimedDob: args.birthDate ?? null,
          claimedExternalRef: args.externalRef ?? null,
          matchedStudentId: studentId,
          guardianshipId: link.id,
        });

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
   * The parent's own claim-status surface (self-scoped to the resolved Guardian,
   * tenant-scoped). The matched child name/details are projected ONLY when the driven
   * Guardianship is `active` (post-approval) — never on submitted/match_failed/
   * rejected/withdrawn (no oracle on the status read either). decisionReason only on
   * rejected. A single self-scoped query (no client N+1).
   */
  async listForGuardian(args: { tenantId: string; guardianId: string }): Promise<ChildClaimListResponse> {
    const rows = await this.prisma.guardianshipClaim.findMany({
      where: { tenantId: args.tenantId, guardianId: args.guardianId },
      orderBy: { createdAt: 'desc' },
      include: {
        guardianship: { select: { status: true } },
        student: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    const claims: ChildClaimStatusRow[] = rows.map((r) => {
      const linkActive = r.guardianship?.status === 'active';
      return {
        id: r.id,
        status: r.status,
        relationship: r.relationship,
        claimedFirstName: r.claimedFirstName,
        claimedLastName: r.claimedLastName,
        claimedBirthDate: this.toIsoDate(r.claimedDob),
        decisionReason: r.status === 'rejected' ? r.decisionReason : null,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
        child:
          linkActive && r.student
            ? { studentId: r.student.id, firstName: r.student.firstName, lastName: r.student.lastName }
            : null,
      };
    });

    return { claims };
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
  async withdraw(args: { tenantId: string; guardianId: string; actorId: string; claimId: string }): Promise<boolean> {
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
   *     append-only `guardianship.claim_approved` audit (actorRole 'admin').
   *  6. AFTER commit: best-effort parent notification (never rolls back).
   */
  async approveClaim(args: {
    tenantId: string;
    actorId: string;
    claimId: string;
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
        'admin',
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
        'admin',
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
   * Append-only audit (the direct prisma.auditLog.create pattern; resourceType
   * ='guardianship_claim'). The actor role/portal is parametrised (defaulting to
   * 'parent' for the S1 parent paths) so the S2 admin approve/reject decisions log
   * `actorRole:'admin'`/`portal:'admin'` — the audit row IS the status history,
   * so the actor must be truthful (Winston CONCERN #4).
   */
  private async audit(
    tx: Prisma.TransactionClient,
    args: Pick<SubmitClaimArgs, 'tenantId' | 'actorId'>,
    action: string,
    before: Prisma.InputJsonValue | null,
    after: Prisma.InputJsonValue,
    actor: 'parent' | 'admin' = 'parent',
  ): Promise<void> {
    await tx.auditLog.create({
      data: {
        tenantId: args.tenantId,
        actorId: args.actorId,
        actorRole: actor,
        portal: actor,
        action,
        resourceType: 'guardianship_claim',
        before: before ?? undefined,
        after,
      },
    });
  }
}
