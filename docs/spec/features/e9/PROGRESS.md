# E9 — Progress

> Epic: **E9 — Enrollment self-service UI (parent child-claim → admin approval)** · Tier 4 (Foundation,
> quality & interop) · Size ~S
> Spec-kit run: **2026-06-10** (docs-only; no code, no schema, no build). Roadmap status: `proposed`
> → promoted to **in-progress** (spec authored on this run). **Next slice → E9-S1.**

## Slice status

| Slice | Title | Tags | Risk | Status | PR |
|---|---|---|---|---|---|
| S1 | `GuardianshipClaim` schema + deny-by-default match + parent self-claim + status/manage → **ADR-022** | `[schema][auth][abac][rgpd]` | P1 | ⬜ not started (spec authored this run) | — |
| S2 | Admin approval queue + approve/reject + notify + UIs | `[auth][abac]` | P2 | ⬜ not started | — |

## What landed this run (spec run)

- `docs/spec/features/e9/` spec-kit authored: `spec.md`, `plan.md`, `data-model.md`, `ux.md`,
  `contracts/openapi.yaml`, `tasks.md`, `quickstart.md`, this `PROGRESS.md`, and `stories/S1-…md`.
  **Docs only** — no code, no schema, no migration, no build.
- Roadmap: **E9 to be promoted `proposed` → `in-progress`** (`bmad/roadmap.md`, reconcile on land).

## Key locked decisions (the spec's spine)

- **Reuse the `Guardianship.status` backbone verbatim.** The claim lifecycle is `pending` (submitted) →
  `active` (approved) / `revoked` (rejected/withdrawn) on the **existing** `Guardianship` model — verified
  in `schema.prisma` (model line ~505; `status`/`approvedBy`/`approvedAt`/`revokedAt` all present). **No new
  `GuardianshipStatus` value.** Access is granted **implicitly** by the existing `StudentAccessService`
  parent ABAC (reads `status:'active'`) — **no separate grant code**.
- **The ONLY additive schema = a dedicated `GuardianshipClaim` model (Option B)** (+ a
  `GuardianshipClaimStatus` enum + additive back-relation arrays + a partial-unique open-claim index applied
  on API boot, the E7-S2 `BookingIndexBootstrap` idiom). A dedicated **request→link model** (the E1-S3
  `MeetingRequest` precedent) — NOT columns on `Guardianship` (Option A, rejected) — because a
  **`match_failed` attempt has no `Guardianship`** to hang anything on, so the unmatched case is a
  first-class `GuardianshipClaim` row while the `Guardianship` stays a pure access link, and the
  **admin-creates-`active` path stays byte-untouched** (it never writes a claim). The matched claim
  **drives** a `pending` `Guardianship`. **NO new `NotificationKind`** — approve/reject reuse the existing
  **`enrollment_status`** kind (`sourceType='guardianship_claim'`). Additive, `db push`, non-destructive, no
  backfill. **Authoritative: `data-model.md` §1 (Option B) + §6.**
- **Deny-by-default match (the RGPD core).** Server-side, tenant + school-scoped: normalised name **plus** a
  corroborating factor (`externalRef` OR `birthDate`) **plus** exactly-one candidate, or it's a non-leaking
  `match_failed`. Name-only, fuzzy, cross-school, and >1-candidate all fail closed. **Match / no-match
  responses are shape-identical** + the endpoint is **rate-limited per guardian** (anti-enumeration; no new
  queue). **Authoritative: `data-model.md` §3.**
- **A claim NEVER auto-grants access.** The match only ever produces a **`pending`** link; a human with
  `guardianships.approve` is the gate. The parent write is a **new parent-narrowed `guardianships.claim`**
  permission (NOT the broad `guardianships.write`), so a parent can never self-create an `active` link.
  **`data-model.md` §5.**
- **The one new architectural decision** = the self-service child-claim **match-and-grant lifecycle**
  (deny-by-default matching + `pending`-as-claim reuse + anti-enumeration + human-in-the-loop grant) →
  **`docs/adr/ADR-022-enrollment-self-service-child-claim.md`**, authored on the **S1** run. ADR number
  **022** = next free after `ADR-021` (verified on disk this run; the S1 implementer re-verifies at
  authoring time per the E6/E7/E8 precedent).

## Schema posture (Winston — authoritative)

- **Exactly ONE additive schema change, in S1:** `model GuardianshipClaim` + `enum GuardianshipClaimStatus`
  + the additive back-relation arrays on `Guardian`/`Student`/`Guardianship` + the partial-unique open-claim
  index (boot-applied). **NO new `NotificationKind`** (reuse `enrollment_status`). `db push` (no SQL
  `migrations/`), additive/expand-only, safe on existing rows (no backfill). `guardianship_claim` carries
  `tenantId`+`schoolId` and joins the RLS policy family (ADR-002). **S2 adds NO schema.**
- **`GuardianshipStatus` is UNCHANGED.** `model Guardianship`'s columns are UNCHANGED. The existing
  `POST /guardians/guardianships` (admin-creates-`active`) controller is byte-untouched. The
  `StudentAccessService` parent ABAC is byte-untouched.
- **No second table beyond the claim row, no new datastore, no second BullMQ queue, no new HTTP style.**

## Reuse map (what E9 does NOT rebuild)

- `Guardianship.status` lifecycle + `approvedBy`/`approvedAt`/`revokedAt` — **driven**, not invented.
- `StudentAccessService` parent ABAC — the **implicit access grant** on `active` (no change to the service).
- The permission seed (`guardianships.read|write|approve` exist) — admin reuses `read`+`approve`; only the
  thin parent-narrowed `guardianships.claim` is added.
- `NotificationsService.createMany` (the `enrollment_status` fan-out precedent) — approve/reject parent
  notifications; no new queue.
- The direct `prisma.auditLog.create` append-only pattern (grades/exports/imports) — the `guardianship.claim_*`
  verbs.
- `@@unique([guardianId, studentId])` + `P2002`-race collapse (E7 booking) + from-status-guarded `updateMany`
  (ADR-020) — idempotency + decision concurrency.
- The `POST /guardians/guardianships` **revoked-row reuse** — the re-submit-after-rejection precedent.
- `@pilotage/ui` (incl. the E3-S3 hardened `Drawer` focus-trap) + `packages/contracts` + the `/admin|/parent`
  route-group + AppShell (ADR-003) — reuse-first; **no `packages/ui` change anticipated**.

## Risk notes for the implementation runs

- **S1 is the load-bearing, `[auth][abac][rgpd]`-tagged slice** → escalation-panel territory (architect +
  security + test-architect). Sentinel must verify, before merge: the deny-by-default match (name + a factor
  + exactly one candidate; never name-only/fuzzy/cross-school), the **non-leaking uniform** match/no-match
  response, the **per-guardian rate-limit**, the **never-auto-grant** invariant (a `pending` link grants no
  access), and the **parent-can-never-create-`active`** permission wall.
- **RGPD / safeguarding** is the throughline: this surface gates access to a **minor's** dossier. Every path
  is tenant + school-scoped, server-derived, append-only audited; a human always approves.
- **Verified-fact note:** the roadmap's *"backend 90% ready"* is accurate — the `Guardianship.status`
  machinery, `approvedBy`/`approvedAt`/`revokedAt`, the permissions, and the parent ABAC all exist. What is
  **genuinely unbuilt**: any parent self-claim surface, any claim/approval endpoint, and the deny-by-default
  match (the existing `POST /guardians/guardianships` auto-approves to `active` — an admin path, not a
  parent claim).

## Decision points recorded for the S1 implementer

1. **Parent write permission** — **canonical = a new `guardianships.claim`** (parent-narrowed; keeps a
   parent from ever creating an `active` link). Fallback (recorded, not preferred) = grant the existing
   `guardianships.write` to `parent`, narrowed by the controller. Captured in ADR-022. (`data-model.md` §5.)
2. **NotificationKind** — **canonical = reuse the existing `enrollment_status`** kind (zero schema, no new
   kind; semantically "a status changed on your child's attachment"; `sourceType='guardianship_claim'`).
   Adding a dedicated `guardianship` kind was considered and **rejected** (it would be a new enum value the
   intake/spec forbid). The `kind=guardianship` strings in `contracts/openapi.yaml` are a typo to fix on S2
   (`tasks.md` ledger R2). (`data-model.md` §6.)
3. **Provenance shape** — **canonical = the `GuardianshipClaim` companion row** (handles `match_failed`
   without a guardianship; keeps the admin path untouched). The alternative (columns on `Guardianship`) is
   rejected with rationale in `data-model.md` §1.3 / ADR-022.

## Next action

Implement **E9-S1** from `tasks.md` + `stories/S1-…md` (the next `epic-slice` run). Re-verify the ADR number
(`022`) against `docs/adr/` at authoring time. Apply the additive `db push` (operator step) before the
parent surface is functional end-to-end.
