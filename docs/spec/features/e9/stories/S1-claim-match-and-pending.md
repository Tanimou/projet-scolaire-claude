# E9-S1 — Parent child-claim + deny-by-default matcher → pending Guardianship (story)

> Self-contained story spec for **E9-S1** — the dev agents implement from this file alone. Authoritative
> schema = [`../data-model.md`](../data-model.md) §1 (**Option B — the dedicated `GuardianshipClaim`
> model**); API = [`../contracts/openapi.yaml`](../contracts/openapi.yaml); match rule = `../data-model.md`
> §3/§4; screens = [`../ux.md`](../ux.md). Tags **`[schema][auth][abac][rgpd]` · P1**. **Lands with
> `docs/adr/ADR-022-enrollment-self-service-child-claim.md`** (committed — Winston ruling).

## Goal (one sentence)

A signed-in parent submits a child-claim; a **confident, deny-by-default match** creates a
**`GuardianshipClaim(submitted)`** that **drives a `pending` `Guardianship`** (never `active`); a no/weak/
ambiguous match creates a `GuardianshipClaim(match_failed)` and **no link** — and **both return the
byte-identical, non-leaking, rate-limited response**. The parent can then track their own claims. **No
access is granted at claim time, ever.**

## touchesBackend: yes · touchesUi: yes · touchesSchema: yes (one additive model) · touchesWorker: no

## Scope (do exactly this, no more)

1. **Schema (`db push`, the only E9 schema step — `data-model.md` §1, Option B):**
   - Add `model GuardianshipClaim` + `enum GuardianshipClaimStatus { submitted approved rejected match_failed
     withdrawn }` + the additive back-relation arrays on `Guardian`/`Student`/`Guardianship` (and `School`
     if used for the tenant/school index). All additive; existing models gain only back-relation arrays.
   - Apply the **raw partial unique index** `guardianship_claim_open_unique ON guardianship_claim
     (guardian_id, matched_student_id) WHERE status='submitted'` idempotently on API boot (the E7-S2
     `BookingIndexBootstrap` idiom — Prisma cannot express a partial `@@unique`).
   - `guardianship_claim` carries `tenantId` + `schoolId`; add it to the RLS policy family (ADR-002).
   - **NO new `NotificationKind`** (S3 reuses `enrollment_status`); **no `GuardianshipStatus` change.**
2. **Permission:** add `guardianships.claim` (resource `guardianship`, action `claim`) to
   `permissions.constants.ts` + `seed.ts` + `seed-demo.ts`; grant to the **`parent`** realm-role ONLY.
3. **Pure matcher** (`apps/api/src/modules/.../claim-match.ts` — a tested pure module, the E7
   `session-instance.ts` precedent): `matchClaim({ tenantId, schoolId, firstName, lastName, birthDate,
   externalRef? }) → { outcome: 'matched'|'no_match'|'ambiguous', studentId? }` per `data-model.md` §4:
   externalRef path (exact, school-scoped) → else name + **mandatory** DOB (normalised, exact) → exactly-one
   = matched, zero = no_match, >1 = ambiguous; name-only (no DOB, no ref) = no_match.
4. **`POST /parent/child-claims`** (`guardianships.claim`):
   - `ensureUser(jwt)` → resolve the caller's **own** `Guardian` (`userProfileId === me.id`, tenant-scoped);
     a kind 422 if the signed-in user has no `Guardian` row (account-not-a-parent edge). **No client
     `guardianId`.**
   - Run the pure matcher (tenant + school-scoped).
   - **matched** → create a `GuardianshipClaim(submitted, matchedStudentId, claimed* provenance,
     relationship)` that **drives** a `pending` `Guardianship` (`guardianId=own`, `studentId=matched`,
     `status='pending'`); idempotent via the partial-unique open-claim index + the `@@unique([guardianId,
     studentId])` guardianship anchor (`P2002` → reuse: existing `pending`/`active` surfaces status,
     `revoked` reactivates to `pending`); append-only `guardianship.claim_submitted` audit.
   - **no_match / ambiguous** → create a `GuardianshipClaim(match_failed)` (no `matchedStudentId`, no
     `Guardianship`); append-only `guardianship.claim_match_failed` audit.
   - **Map EVERY outcome to the byte-identical `200` response** (`ChildClaimStatus`, `outcome=received`,
     `child=null`, `claimId=null`, the same `message`) — the no-oracle wall. **Rate-limit per `guardianId`**
     (count recent `GuardianshipClaim` rows in the window → `429`).
5. **`GET /parent/child-claims`** (`guardianships.claim` or the parent's existing `guardianships.read` —
   either; canonical `guardianships.claim`): the caller's **own** `GuardianshipClaim` rows (self-scoped to
   the caller's `Guardian`), each with `status` + (on `rejected`) `decisionReason` + the matched child
   **only when the driven link is `active`** (post-approval). Never another family's claim; never a matched
   child's name on a `submitted`/`match_failed`/`rejected` row.
6. **(Optional, may slip to S2) `POST /parent/child-claims/:id/withdraw`** (`guardianships.claim`): cancel a
   still-`submitted` claim → `withdrawn`, its driven link `revoked`; self-scoped; append-only
   `guardianship.claim_withdrawn` audit.
7. **FE:** the **"Rattacher mon enfant"** form (`@pilotage/ui` `FormDrawer` — prénom / nom / date de
   naissance / référence (optionnel) / lien de parenté) on `/parent/children` (+ a dashboard empty-state
   CTA), posting via a `'use server'` action; the **uniform calm acknowledgement** state (identical for
   match/no-match — `ux.md`); a "Mes demandes" status strip reading `GET /parent/child-claims`. **No
   `packages/ui` change.**
8. **Contracts:** `packages/contracts/src/dto/child-claim.ts` (the request + `ChildClaimStatus` +
   `GuardianshipClaimStatus`), exported + built to CJS.
9. **ADR:** author `docs/adr/ADR-022-enrollment-self-service-child-claim.md` (the matcher contract, the
   `GuardianshipClaim` request→link pattern, the no-enumeration-oracle posture, the human-in-the-loop grant;
   rejected alternatives: Option-A columns, name-only/fuzzy match, auto-grant).

## Acceptance (this slice)

- AC-1 (claim → `pending`, never `active`); AC-2 (no-match never leaks; byte-identical response;
  rate-limited); AC-3 (idempotency / double-claim / revoked-reuse); AC-8 (match path); AC-9 (no regression —
  the admin `POST /guardians/guardianships` path + `StudentAccessService` untouched; `GuardianshipStatus`
  unchanged). (See `../spec.md`.)

## Targeted tests (Murat P0 — the single most valuable first)

1. **The no-oracle assertion (P0):** the `POST` response object is **deep-equal** across `matched` /
   `no_match` / `ambiguous` fixtures (same body, same status code) — the one test that pins FR-2/AC-2.
2. matched (name+DOB) → one `GuardianshipClaim(submitted)` + one `pending` `Guardianship`; the child is
   **not** in the parent ABAC scope yet (no access).
3. name-only (no DOB/ref) → `no_match` → `match_failed`, no link.
4. ambiguous (twins, same name+DOB, no ref) → `match_failed`, no link.
5. the claim resolves the caller's **own** `Guardian`; a client-supplied `guardianId` is impossible/ignored.
6. idempotent re-claim (already `pending`/`active`) → no duplicate; `P2002` race collapses to one row.
7. cross-tenant / cross-school claim → no match.
8. rate-limit: N+1 attempts in the window → `429`.

## Guardrails (do NOT)

- Do **not** echo the matched child's name in the claim response (an oracle). Do **not** return a different
  status code/body for match vs no-match. Do **not** grant access (only `pending`). Do **not** grant
  `guardianships.write` to the parent (use `guardianships.claim`). Do **not** add a `NotificationKind`. Do
  **not** touch `StudentAccessService` or the admin `POST /guardians/guardianships`. Do **not** add fuzzy
  matching. Tenant-scope **every** query.
