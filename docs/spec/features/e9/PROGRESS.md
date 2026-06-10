# E9 — Progress

> Epic: **E9 — Enrollment self-service UI (parent child-claim → admin approval)** · Tier 4 (Foundation,
> quality & interop) · Size ~S
> Spec-kit run: **2026-06-10** (docs-only; no code, no schema, no build). Roadmap status: `proposed`
> → promoted to **in-progress** (spec authored on this run). **Next slice → E9-S1.**

## Slice status

| Slice | Title | Tags | Risk | Status | PR |
|---|---|---|---|---|---|
| S1 | `GuardianshipClaim` schema + deny-by-default match + parent self-claim + status/manage → **ADR-022** | `[schema][auth][abac][rgpd]` | P1 | ✅ **shipped** (needs human review; RED gate fixed in-flight via `prisma generate`) | — |
| S2 | Admin approval queue + approve/reject + notify + UIs | `[auth][abac]` | P2 | ✅ **shipped** (needs human review) | — |

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

## What landed on the S1 run (epic-slice)

- **Schema (additive only):** `model GuardianshipClaim` + `enum GuardianshipClaimStatus`
  (`submitted/approved/rejected/match_failed/withdrawn`) + additive back-relations on
  `Guardian.claims` / `Student.claims` (`@relation("ClaimMatchedStudent")`) / `Guardianship.claim` (1:1) —
  **zero existing column/enum value changed**; `GuardianshipStatus` and the `POST /guardians/guardianships`
  admin path are byte-untouched. The partial-unique open-claim index is applied on API boot by
  `guardianship-claim-index.bootstrap.ts` (the E7-S2 `BookingIndexBootstrap` idiom — Prisma can't express a
  partial `@@unique`).
- **Permission:** the new parent-only `guardianships.claim` in `permissions.constants.ts` (line 261, `parent`
  block only) + `seed.ts` + `seed-demo.ts`. Admin/teacher/student tokens → 403.
- **API module `apps/api/src/modules/child-claims/`:** `child-claims.controller.ts` (server-derived
  `Guardian`/tenant/school, no client `guardianId`; `POST` submit, `GET` self-scoped list, `POST :id/withdraw`
  404-before-403), `child-claims.service.ts` (uniform `UNIFORM_RECEIVED` response, transaction + idempotency +
  P2002-collapse, per-guardian rate-limit, append-only audit), the **pure** `claim-match.ts` matcher
  (deny-by-default, exact-normalised, no fuzzy, exactly-one-candidate), `dto/`, wired in `app.module.ts`. Specs:
  `claim-match.spec.ts` + `child-claims.service.spec.ts`.
- **Contracts:** `packages/contracts/src/dto/child-claim.ts` (+ `dto/index.ts` export).
- **FE (`apps/web`):** `ChildClaimDrawer` + `ChildClaimsStatusStrip` (`components/parent/`) mounted on
  `/parent/children` (+ the dashboard empty-state CTA), with `claim-actions.ts` / `claim-types.ts`; graceful
  "indisponible" degrade on 404/501/503 while the `db push` is pending.
- **ADR:** `docs/adr/ADR-022-enrollment-self-service-child-claim.md`.
- **RED gate fixed in-flight:** 8 stale-Prisma-client TS2551/TS7006 errors cleared by `prisma generate`
  (the E7-S5/E8-S1 stale-client pattern — no source edit; the code was correct against the new schema).
  `pnpm typecheck` → 11/11 GREEN, `git diff --check` clean.
- **Two CONFIRMED `major` correctness bugs fixed by the lock-holding session before land** (from the
  verify panel): (1) **withdraw→reclaim P2002 swallow** — `withdraw()` now also nulls `guardianshipId`
  when flipping the claim to `withdrawn`, so a later re-claim's revoked-link reuse can attach a fresh
  `submitted` claim without colliding on the `@unique guardianshipId` (previously the target-agnostic
  P2002 catch silently swallowed it, leaving the link stuck `revoked` with nothing in the S2 queue);
  (2) **full-ISO DOB false `match_failed`** — `submitClaim()` normalises `birthDate` to its `yyyy-mm-dd`
  date portion up-front, so a non-form/API/E2E caller sending a full ISO datetime no longer misses the
  matcher's exact compare nor resolves to the wrong calendar day in the `@db.Date` filter.
- **Murat's P0 cross-tenant/cross-school no-match test added** to `child-claims.service.spec.ts` (asserts
  `where.tenantId`+`where.schoolId` on the candidate fetch and proves deny-by-default across schools) +
  a withdraw-decouple regression test + a full-ISO-DOB normalisation test. **child-claims suite → 21/21
  GREEN**; full build → **7/7 successful**.
- **Remaining (non-blocking, deferred to S2 / polish):** 3 `minor` findings — the parent-dashboard
  empty-state CTA renders `<ChildClaimDrawer>` without the `available` prop (not-migrated UX inconsistent
  with `/parent/children`); the FE re-declares the contract types in `claim-types.ts` instead of importing
  `@pilotage/contracts` (swap once dist is consumed); and a `ChildClaimDrawer` `aria-describedby` dangling-id
  edge in the empty-name state.

## What landed on the S2 run (epic-slice)

- **Contracts (additive only):** 4 new admin schemas/types in `packages/contracts/src/dto/child-claim.ts`
  — `AdminChildClaimRow(Schema)` (claimId/status/guardianshipId/submittedAt/relationship + parent-typed
  `evidence` {firstName/lastName/birthDate/externalRef/derived matchMethod} + joined `matchedStudent` |
  null + `requestingParent` {guardianId/firstName/lastName/userProfileId/email}),
  `AdminChildClaimQueueResponse(Schema)`, `RejectChildClaimRequest(Schema)` (`reason` trim min1 max500),
  `ApproveChildClaimResponse(Schema)`. Re-exported via the existing `dto/index.ts` `export *`. No edit to
  the S1 exports. The web slice still mirrors the shape FE-local (`apps/web/.../admin/child-claims/types.ts`)
  — dist not yet consumed by web.
- **API (`apps/api/src/modules/child-claims/`):** the NEW `admin-child-claims.controller.ts`
  (`@Controller('admin/child-claims')`, **gated entirely by the admin-only `guardianships.approve`** — NOT
  bare `guardianships.read` which parent+teacher hold, closing the pre-mortem FM-1 leak; server-derived
  `me.tenantId`/`me.id` via `UserSyncService.ensureUser`; `ParseUUIDPipe` on `:id`; `?status` defaults to
  `submitted` and is enum-validated → 400 on a bad param). The `RejectChildClaimDto`
  (`@IsString @IsNotEmpty @MaxLength(500)` → 400 on blank). Three additive methods on `ChildClaimsService`:
  `listQueueForAdmin` (ONE tenant-scoped aggregate `findMany`, oldest-first FIFO, no N+1, derived
  `matchMethod`), `approveClaim` (404-before-403 → idempotent re-approve no-op 200 → 409 on
  non-submitted/match-failed → ONE `$transaction` with the from-status-guarded link `pending→active`
  +`approvedBy/At`, claim `submitted→approved` +`decidedBy/At`, append-only `guardianship.claim_approved`
  audit; `count===0` on the link flip → deterministic 409 ADR-020 loser; **this single transition IS the
  access grant**), `rejectClaim` (required reason → 404/409 ordering → `$transaction` link `pending→revoked`
  + claim `submitted→rejected` +`decisionReason` + `guardianship.claim_rejected` audit, grants nothing,
  re-submit path stays open). The `audit()` helper is parametrised `actor: 'parent' | 'admin'` (defaults
  `parent`, so S1 call sites stay byte-equivalent) — the admin decisions log `actorRole/portal:'admin'`
  (Winston CONCERN #4). Best-effort `notifyParentOfDecision` runs **AFTER** the committed `$transaction`,
  wrapped in try/catch (resolves the parent `userProfileId`, skip if null; reuses the `enrollment_status`
  kind — there is NO `guardianship` kind; `sourceType='guardianship_claim_{approved,rejected}'` so a later
  opposite decision isn't collapsed by the createMany dedup; approve deep-links to the child, reject to the
  re-submit surface) — a notify/Redis failure is logged + swallowed and can NEVER roll back the decision
  (FM-7/FM-8). Module wires `AdminChildClaimsController` + injects `NotificationsService`
  (`NotificationsModule` is `@Global`; the import is explicit). The parent `ChildClaimsController`, the
  matcher, `StudentAccessService` and the admin-initiated `POST /guardians/guardianships` auto-active path
  are byte-untouched (AC-8).
- **Tests:** `child-claims.service.spec.ts` extended with the S2 P0 suite — `listQueueForAdmin` (one
  aggregate, tenant-scoped, oldest-first, evidence/matchMethod/matched-student/parent projection),
  `approveClaim` (active+approvedBy + claim approved + admin audit + `enrollment_status` notify; 404 on
  cross-tenant; idempotent re-approve no-op 200; concurrent-loser 409; match_failed 409; notify-failure
  doesn't roll back; null-userProfileId guardian → 0 notifications no throw), `rejectClaim` (revoked +
  trimmed decisionReason + admin audit + notify; non-submitted 409; cross-tenant 404). The constructor
  fake now injects a `NotificationsService` stub.
- **FE (`apps/web/src/app/admin/child-claims/`):** `page.tsx` (server component, `force-dynamic`,
  `PortalShell`+`PageHeader`+`KpiCard "En attente"`, `safe()`-wrapped aggregate fetch → calm empty state
  while the S1 `db push` is pending), `ChildClaimsQueue.tsx` (`'use client'` evidence-card queue:
  parent-claim vs matched-student side-by-side, `SearchX` "Aucune correspondance" chip for a no-match,
  matchMethod chip, requesting parent + relationship + received-at, Approuver optimistic-removal action
  with a calm 409 path, Rejeter opening a reason-required `RejectClaimDrawer` over the hardened
  `@pilotage/ui` `FormDrawer`/`Drawer` focus-trap with a live char-counter + `aria-describedby` hint +
  `role=status` polite live region), `actions.ts` (`'use server'` approve/reject calling `api()` POST +
  `revalidatePath('/admin/child-claims')`), `types.ts` (FE-local byte-mirror). New "Demandes de
  rattachement" admin sidebar item (`UserPlus`, already-imported; placed in Pédagogie next to
  enrollments/meeting-requests). The S1 parent `ChildClaimsStatusStrip` already renders the approved
  (child + deep-link) / rejected (decisionReason + re-submit) branches — **verified, no parent FE change**
  (FR-10).
- **R2 (ledger):** `docs/spec/features/e9/contracts/openapi.yaml` already uses `kind=enrollment_status`
  for the approve/reject notifications (only the corrective prose "there is NO `guardianship` kind" +
  the intended `sourceType=guardianship_claim` remain) — **verified clean, no edit** (FR-12).
- **No schema change in S2.** Reads + transitions operate entirely on the S1 `GuardianshipClaim` table +
  the existing `Guardianship`/`AuditLog`/`Notification` tables. No new permission, no new ADR (reuses the
  documented ADR-020 from-status-guard + ADR-022 lifecycle), no second queue, no new `NotificationKind`.

## Next action

**E9 is now complete — both slices shipped.** Advance to the next epic per `bmad/roadmap.md`.

**Operator pre-req (gates demoability, not merge — carried over from S1):** apply the additive
`guardianship_claim` `prisma db push` + rebuild `packages/contracts/dist` (the runtime
`GUARDIANSHIP_CLAIM_STATUS` value import) via the single post-Workflow `pnpm build`. Until then the admin
queue degrades to a calm empty state and the parent strip shows "indisponible" — never a crash.
