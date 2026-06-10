# ADR-022 — Enrollment self-service child-claim (deny-by-default, non-enumerating match → pending link)

- **Status:** Accepted
- **Date:** 2026-06-10
- **Epic / Slice:** E9 — Enrollment self-service UI · S1 (GuardianshipClaim schema + deny-by-default
  match + parent self-claim + status/withdraw)
- **Deciders:** Winston (Architect), Sally (UX), Critic (Pre-mortem), Murat (Test-Architect)
- **Supersedes / relates:** ADR-002 (multi-tenancy — every claim/match/read query carries an explicit
  server-derived `tenantId` + `schoolId`; RLS remains aspirational, so application-level scoping IS the
  wall), ADR-015 (RBAC + ABAC — adds the parent-only `guardianships.claim` permission), ADR-020 (the
  from-status-guarded `updateMany` + the boot-applied partial-unique index idiom, reused here for the
  open-claim guard and the withdraw flip).

## Context

The cahier describes a **parent → admin onboarding validation loop**: a parent should be able to
*request* attachment to their child, and the school should *validate* it before any access is granted.
Until E9 the platform only supported the reverse, admin-initiated flow (`POST /guardians/guardianships`
auto-creates an `active` link). E9-S1 opens the **parent half**: the platform's first parent-initiated
write that touches a **minor's** identity link. That makes it a strict RGPD / safeguarding surface — it
must never auto-grant access, never leak the roster, and always keep a human in the loop.

The implementation primitives are all conventional and reused — the `Guardianship.status`
(`pending`/`active`/`revoked`) state machine, the `@@unique([guardianId, studentId])` idempotency
anchor + revoked-row reuse, the append-only `AuditLog`-as-history, the `enrollment_status`
`NotificationKind` (S2), the REST style, the role-narrowed permission family. The **new cross-cutting
decision** worth recording is the **deny-by-default, non-enumerating child-claim matcher + the
request→link lifecycle + the human-in-the-loop access grant**, because future surfaces (E11 OneRoster
sync, any later self-service) will reference this contract.

## Decision

1. **A dedicated `GuardianshipClaim` model drives a `Guardianship`** (Option B, the E1-S3
   `MeetingRequest` precedent) — NOT columns on `Guardianship` (Option A, rejected). The claim is the
   *request* (its own `GuardianshipClaimStatus` lifecycle + the parent's typed provenance); the
   `Guardianship` is the *access link*. A `match_failed` claim is a first-class row with
   `matchedStudentId=null` + `guardianshipId=null` — no `Guardianship` orphan, no FK strain. The
   admin-initiated `active`-link path stays byte-untouched (it never writes a claim).

2. **The matcher is deny-by-default, exact, and non-enumerating.** Pure module (`claim-match.ts`),
   tenant+school-scoped, fetching only the MINIMAL candidate set:
   - **externalRef path** (highest confidence, no DOB needed): exactly-1 exact hit → matched; 0 →
     fall through.
   - **name + DOB path**: DOB is MANDATORY (a name-only claim is too leaky); exact normalised
     (trimmed, accent-folded, case-insensitive — applied symmetrically to both sides) lastName +
     firstName on the claim's birthDate; exactly-1 → matched; 0 → no_match; >1 → ambiguous.
   - **name only (no DOB, no ref) → always no_match**, regardless of the roster (anti-fishing).
   - NO fuzzy / Levenshtein — exact only, zero false-positive surface. The matcher only *suggests* a
     candidate; the human (S2 approval) is the only access grant.

3. **The non-leak response wall (the security core).** The `POST /parent/child-claims` response is
   **byte-identical** for matched / no_match / ambiguous: `{ outcome:'received', claimId:null,
   status:null, child:null, message }`, same 200, same keys, same values. It never echoes a
   roster-resolved field, a match boolean, a near-match count, or a which-field hint. The resolved
   claimId/status are observable only later via the self-scoped `GET /parent/child-claims` (and even
   there the matched child's name surfaces ONLY once the driven link is `active`, post-approval). The
   ONE non-uniform branch is the caller's **own** already-`active` link → `{ outcome:'already_linked',
   studentId }` — the chosen Sentinel reading (it confirms only the caller's own existing access,
   never any other child). **On any doubt the stricter reading wins: fall back to the fully-uniform
   `received` for the already-linked case too.** A per-guardian rate-limit (≤5 / 10 min, counted on
   existing `GuardianshipClaim` rows — the E2-S4 idiom, no new table/queue) throttles every POST
   attempt (including idempotent no-ops and match_failed) → 429 with calm copy.

4. **A claim NEVER auto-grants access.** A matched claim drives a `Guardianship` with
   `status:'pending'` only — `approvedBy`/`approvedAt` are never stamped on the claim path.
   `StudentAccessService` reads `status:'active'` exclusively, so a pending claim resolves nothing.
   The S2 admin approval (`pending → active`) is the single grant switch. The parent path rides a
   NEW parent-only `guardianships.claim` permission — never `guardianships.write` — so a parent can
   never self-create an `active` link.

5. **Idempotency + race-safety.** A boot-applied partial-unique index
   `guardianship_claim_open_unique (guardian_id, matched_student_id) WHERE status='submitted'` (the
   E7-S2 `BookingIndexBootstrap` idiom, best-effort with a logged warning if the table is not yet
   pushed) + the existing `@@unique([guardianId, studentId])` guard the matched path. A re-claim of an
   already-pending child returns the existing claim's uniform response (no duplicate); an already-active
   link → `already_linked`; a revoked link is reused back to pending; a concurrent double-submit hitting
   `P2002` (on either unique) is caught and collapsed to the existing row (never a 500). The matched path
   writes the claim + the pending link in one `$transaction` (no orphan).

6. **Withdraw + status read are self-scoped.** `GET /parent/child-claims` and
   `POST /parent/child-claims/:id/withdraw` resolve the caller's own `Guardian`
   (`userProfileId === me.id`, tenant-scoped) and scope every row to it (404-before-403, no
   cross-family leak). Withdraw flips a still-`submitted` claim → `withdrawn` and its pending link →
   `revoked` in one from-status-guarded `$transaction` (double-withdraw is a deterministic no-op).

7. **Tenant + school scope + append-only audit on every write.** `tenantId`/`schoolId`/`guardianId`
   are server-derived from the resolved Guardian, never from the body. Every write is append-only
   audited via `prisma.auditLog.create` (`resourceType='guardianship_claim'`):
   `guardianship.claim_submitted`, `guardianship.claim_match_failed`, `guardianship.claim_withdrawn`.
   The AuditLog row IS the status history — no separate `claim_status_history` table.

## Consequences

- **Positive:** the parent self-onboards without a phone call; the school keeps full, auditable,
  deny-by-default control; the unmatched case is first-class; the admin `active`-link path is
  untouched; zero new datastore / queue / `NotificationKind` / HTTP style; one additive schema change
  (`GuardianshipClaim` + `GuardianshipClaimStatus` + additive back-relations, `db push`, safe on
  existing rows).
- **Trade-offs / known limits:** the binary received/already-linked signal is gated behind the rate
  limit (the accepted reading per §3; the fully-uniform fallback is one flag away). A **timing channel**
  (the matched path does more DB work than the no-match path) is a theoretical oracle — **out of scope
  for S1**, recorded here; the byte-identical body + the rate limit are the S1 mitigations. The
  boot-applied index is operator-gated like E7/E8 (the additive `db push` must be applied before the
  surface is functional; the API boots cleanly with the table absent and degrades to a graceful
  "indisponible" / empty state, never a 500).

## Rejected alternatives

- **Option A — columns on `Guardianship`.** The unmatched case has no `studentId` for the FK, forcing
  an audit-log-only side channel, and it overloads the access-link row with request metadata null for
  every admin-created link. Option B keeps request and access link cleanly separated.
- **Name-only / fuzzy match.** A surname-only or Levenshtein match is a roster oracle and a
  false-positive risk against a minor's record. Exact + a mandatory corroborating factor only.
- **Auto-grant on a confident match.** Violates the human-in-the-loop safeguarding requirement — a
  match only ever suggests a candidate to the S2 admin queue.
- **Granting `guardianships.write` to the parent.** Would let a parent self-create an `active` link.
  A thin parent-only `guardianships.claim` keeps the matrix auditable and the wall one-directional.
