# E9 — Slice backlog (tasks)

> Shippable vertical slices for **E9 — Enrollment self-service UI (parent child-claim → admin approval)**.
> Each slice = one PR + one build, demoable end-to-end. Ship **in order** (S1 → S2). Authoritative schema +
> match rule live in [`data-model.md`](./data-model.md); the API surface in
> [`contracts/openapi.yaml`](./contracts/openapi.yaml); the screens in [`ux.md`](./ux.md).

**Status legend:** `[ ]` not started · `[~]` in progress · `[x]` shipped.

> **Slice arc (2 slices):** **S1** is the load-bearing security + backbone slice — the additive
> `GuardianshipClaim` schema, the **deny-by-default match**, the parent self-claim write (always
> `pending`), the parent status read + re-submit + withdraw, and the `guardianships.claim` permission.
> **S2** is the admin half — the approval queue aggregate, approve/reject (atomic
> `pending→active`/`→revoked`), the `enrollment_status` notification fan-out, and the admin UI. **The
> whole schema delta lands once in S1.**
>
> **ADR posture (Winston's authoritative ruling — reconciled across the whole kit):** **`ADR-022` IS
> authored on S1 (committed, not conditional).** While the `GuardianshipClaim` request→link *model* is
> conventional (the E1-S3 `MeetingRequest` precedent) and E9 otherwise reuses the existing state machine,
> permission family, `enrollment_status` notification kind, ABAC wall, audit table and REST style, the
> **deny-by-default no-enumeration-oracle child-claim matcher + the parent self-service write against a
> minor's identity link + the human-in-the-loop access grant** is a genuinely new cross-cutting security
> decision (a contract future surfaces — E11 OneRoster sync, any later self-service — will reference). Per
> project-context §3, a new architectural decision lands **with** a new ADR →
> `docs/adr/ADR-022-enrollment-self-service-child-claim.md` (re-verify the number, next free after ADR-021,
> on the S1 run). spec.md / plan.md / PROGRESS.md / contracts all agree: committed.

---

## [ ] S1 — `GuardianshipClaim` schema + deny-by-default match + parent self-claim + status/manage · `[schema][auth][abac][rgpd]` · P1 · ~M

**Goal:** a parent can self-claim their child; a **confident** match creates a **`pending`** guardianship
with provenance (never auto-granting access, never leaking a non-match); the parent can track, re-submit
and withdraw the claim. **This is the schema + ADR-022 slice.** Demoable by claiming a known child
(→ pending) and a mistyped child (→ kind no-match, no link), and proving an already-linked child returns
"déjà rattaché".

**Scope (schema + api + web):**
- **Schema (`db push`, the ONLY E9 schema step — `data-model.md` §1, Option B):** add the dedicated
  `model GuardianshipClaim` + `enum GuardianshipClaimStatus` + the additive back-relation arrays on
  `Guardian`/`Student`/`Guardianship`, **plus** the raw partial unique index
  `guardianship_claim_open_unique (guardian_id, matched_student_id) WHERE status='submitted'` applied
  idempotently on API boot (the E7-S2 `BookingIndexBootstrap` idiom). **NO new `NotificationKind`** — the
  approve/reject notification reuses the existing **`enrollment_status`** kind (`data-model.md` §1.4/§6).
  `guardianship_claim` carries `tenantId`+`schoolId` (RLS policy family, ADR-002). **Additive,
  non-destructive, no SQL `migrations/`, safe on existing rows.**
- **Permission:** add `guardianships.claim` (parent-only) to `permissions.constants.ts` + `seed.ts` +
  `seed-demo.ts`; grant to the `parent` realm-role (`data-model.md` §5).
- **Match service (`child-claims.service.ts`):** the deny-by-default match (`data-model.md` §3) — normalise
  name, require name + a corroborating factor (`externalRef` OR `birthDate`), exactly-one candidate,
  tenant + school-scoped. >1 or weak → `match_failed` (no link). **Per-guardian rate-limit** (count recent
  `GuardianshipClaim` rows → 429).
- **`POST /parent/child-claims`** (`guardianships.claim`): server-derive/create the caller's `Guardian` from
  their `UserProfile`; on a confident match create/reuse the `pending` Guardianship
  (`@@unique([guardianId, studentId])`, `P2002`-race-safe) + a `GuardianshipClaim(submitted)` + append-only
  `guardianship.claim_submitted` audit; on a no/weak/ambiguous match write `GuardianshipClaim(match_failed)`
  + `guardianship.claim_match_failed` audit and return the **uniform** `outcome=not_found`. Idempotent
  (already-pending/active → existing status). Revoked-row reuse on re-submit.
- **`GET /parent/child-claims`** (`guardianships.read`): self-scoped to the caller's `Guardian` — status +
  matched child + rejection reason.
- **`POST /parent/child-claims/:id/withdraw`** (`guardianships.claim`, optional): cancel a still-`pending`
  claim (→ `revoked` link + `withdrawn` claim + audit).
- **FE:** the "Rattacher mon enfant" form (Drawer) + result/status states on `/parent/children` (+ dashboard
  empty-state CTA), reuse-first on `@pilotage/ui`.
- **Contracts:** `packages/contracts/src/dto/child-claim.ts` (request + status DTOs + enum).
- **ADR (COMMITTED — see the slice-arc note above):** author
  `docs/adr/ADR-022-enrollment-self-service-child-claim.md` (Winston gate) — the deny-by-default
  no-enumeration matcher, the `GuardianshipClaim` request→link lifecycle, the anti-enumeration response
  posture, and the human-in-the-loop access grant (pending-as-claim, approval as the single grant switch).
  Re-verify the number is the next free after ADR-021 on the S1 run.
- **Non-leak strictness gate (Sentinel, P0):** confirm the binary `outcome=submitted`/`not_found` (with
  `child=null` + rate-limit + no near-match/field hint + name-only-always-`not_found`) is an acceptable
  non-leak (`data-model.md` §3). **On any doubt → fall back to the fully-uniform "Demande envoyée" for both
  outcomes.** The stricter reading wins.

**Acceptance:** AC-1, AC-2, AC-3, AC-7, AC-8 (spec.md — the parent half + RGPD + no-regression).

**Targeted tests (Murat P0):**
- Confident match (name + DOB) → one `pending` Guardianship + `GuardianshipClaim(submitted)`; **no access
  granted** (the child not yet in the parent ABAC scope).
- No-match / name-only / wrong-DOB → **no** Guardianship, `match_failed` recorded, **uniform** `not_found`
  response (no roster leak).
- Ambiguous (twins, same name+DOB, no ref) → `match_failed` (no link), kind "provide reference" copy.
- Idempotent re-submit for an already-`pending`/`active` child → existing status, no duplicate link;
  concurrent double-submit collapses to one row (no 500).
- Cross-school / cross-tenant claim → no match (scope wall).
- Re-submit after a prior `revoked` → reuses the row back to `pending` + a fresh claim row.
- Rate-limit: N+1 attempts in the window → 429.

---

## [ ] S2 — Admin approval queue + approve/reject + notify + UIs · `[auth][abac]` · P2 · ~S-M

**Goal:** an admin works the "Demandes de rattachement" queue and approves (→ access granted + parent
notified) or rejects (kind reason + re-submit open). **No schema change.** Demoable by approving the S1
pending claim (the parent's portal then shows the child) and rejecting one (the parent sees the reason +
re-submit).

**Scope (api + web):**
- **`GET /admin/child-claims?status=pending`** (`guardianships.read`): the tenant-scoped aggregate —
  evidence + matched student + requesting parent + timestamps, one query (no N+1).
- **`POST /admin/child-claims/:id/approve`** (`guardianships.approve`): atomic from-status-guarded
  `pending→active` flip (`approvedBy`/`approvedAt`), claim → `approved` (`decidedBy`/`decidedAt`),
  append-only `guardianship.claim_approved` audit, best-effort in-app notification (kind
  **`enrollment_status`**, success, `sourceType='guardianship_claim'`, deep-link to the child) via
  `NotificationsService.createMany`. Idempotent (re-approve → no-op 200); concurrent double-approve → one
  winner, one 409.
- **`POST /admin/child-claims/:id/reject`** (`guardianships.approve`): required reason, `pending→revoked`,
  claim → `rejected` + `decisionReason`, append-only `guardianship.claim_rejected` audit, best-effort kind
  notification (re-submit deep-link). Re-submit stays open.
- **FE:** `/admin/child-claims` "Demandes de rattachement" queue page (server component) + approve action +
  reject `FormDrawer` (required reason), reuse-first on `@pilotage/ui` (the hardened `Drawer` focus-trap);
  a new "Demandes de rattachement" admin sidebar item. The parent status surface (S1) now reflects
  approved/rejected.

**Acceptance:** AC-4, AC-5, AC-6, AC-7, AC-8 (spec.md — the admin half + RGPD + no-regression).

**Targeted tests (Murat P0):**
- Approve → `Guardianship.status='active'` + `approvedBy`/`approvedAt` set + claim `approved` + audit +
  notification; the parent ABAC now returns the child. Re-approve → no-op 200.
- Concurrent double-approve → exactly one `active`, the other 409 (from-status guard).
- Reject without a reason → 400; with a reason → `revoked` + `decisionReason` + audit + notify; re-submit
  reuses the row.
- Cross-tenant claim id → 404 (no leak).
- Notification fan-out failure does **not** roll back the approve/reject transaction (best-effort).

---

## Cross-artifact reconciliation ledger (PM rulings — read before implementing)

The kit was authored by multiple lenses (PM/Architect/UX/contract). These are the resolved divergences;
the rulings are authoritative and the cited files are corrected on the slice that touches them.

| # | Divergence | PM ruling (authoritative) | Fix where |
|---|---|---|---|
| R1 | Claim shape: columns on `Guardianship` vs a `GuardianshipClaim` model | **`GuardianshipClaim` model** (`data-model.md` §1, Option B) — the contract is written against it; cleanest unmatched case + request→link separation | done (`data-model.md`, `spec.md`) |
| R2 | Notification kind `guardianship` (doesn't exist) vs `enrollment_status` | **`enrollment_status`** (existing kind; no new kind) | S2 — fix the `kind=guardianship` prose in `contracts/openapi.yaml` |
| R3 | Non-leak: binary found/not-found vs fully-uniform response | **Binary acceptable IF** `child=null` + rate-limit + no near-match/field hint + name-only-always-`not_found`; **Sentinel S1 gate; on doubt → fully-uniform** | S1 (Sentinel gate) |
| R4 | Admin routes `/guardianships/claims` vs `/admin/child-claims` | **`/admin/child-claims`** (the contract is the wire source of truth; `plan.md`'s sub-path was module-internal framing) | done |
| R5 | Parent permission: none vs new `guardianships.claim` | **One new parent-only `guardianships.claim`**; admin rides the existing `guardianships.approve` | done |
| R6 | ADR-022 committed vs conditional vs none | **ADR-022 IS authored on S1 (committed)** — the deny-by-default minor-identity self-service write + no-enumeration matcher is a new cross-cutting security decision (project-context §3). `plan.md`'s "no ADR expected" line is **superseded** by this ruling; align `plan.md` on the S1 run | S1 (+ align `plan.md`) |
| R7 | Slice count 2 (this file + contract tags) vs 3 (an earlier spec draft) | **2 slices** (S1 parent · S2 admin) — matches the contract's `[S1]`/`[S2]` tags; `spec.md` Slices reconciled to 2 | done (`spec.md`) |
| R8 | Audit verb `claim_submitted` vs `claim_requested` | **`claim_submitted`** (+ `claim_match_failed`/`approved`/`rejected`/`resubmitted`/`withdrawn`); `claim_requested` is a synonym | done (`data-model.md` §6) |

## Out of scope (recorded — see `spec.md` Non-goals)

- No auto-grant; no roster disclosure / enumeration; no new `GuardianshipStatus` value; no class-enrollment
  change (`EnrollmentStatus.pending` is the sibling pattern, not E9 scope); no new datastore / second BullMQ
  queue / new HTTP style; no student-portal or messaging involvement; no KYC / document upload; no bulk /
  cross-school / on-behalf claim; no admin "new claim" notification digest (recorded future option).
