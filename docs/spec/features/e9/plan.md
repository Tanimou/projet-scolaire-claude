# E9 — Implementation plan (Architect: Winston)

> Companion to [`spec.md`](./spec.md) / [`data-model.md`](./data-model.md) /
> [`contracts/openapi.yaml`](./contracts/openapi.yaml) / [`ux.md`](./ux.md) / [`tasks.md`](./tasks.md) /
> [`quickstart.md`](./quickstart.md). How E9 wires the **parent child-claim → admin approval** loop onto
> the **existing `Guardianship.status` backbone** with the smallest possible surface — one additive
> schema delta, one new (parent-only) permission, zero new datastore/queue/notification-kind, no new HTTP
> style.
>
> **Authoritative ordering & ADR (reconciled with `tasks.md`/`data-model.md`/`contracts/`):** the
> **authoritative slice backlog is [`tasks.md`](./tasks.md)** — **S1 = the schema (claim provenance) +
> the deny-by-default no-oracle matcher + the parent self-claim + the parent status read + the
> `guardianships.claim` permission + the ADR**; **S2 = the admin approval queue + approve/reject +
> notification + both portal UIs.** *(An earlier draft of this plan ordered admin-first and noted "no ADR
> expected"; the canonical kit overrides both — the **parent-claim/matcher slice ships first** because it
> is the load-bearing security unit, and the deny-by-default no-enumeration-oracle matcher + the parent
> self-claim write IS a new architectural decision → **`docs/adr/ADR-022`** (the next free number after
> ADR-021), authored on the S1 run. Read §2 below for the matcher design that the ADR pins.)*

## 1. Architecture posture — wire an existing backbone, do not rebuild

E9 is a **capability-wiring** epic, not a new-subsystem epic. Everything load-bearing already exists in
`apps/api/prisma/schema.prisma` and the auth/notification/audit layers:

| Backbone asset | Where | E9 role |
|---|---|---|
| `Guardianship.status GuardianshipStatus { pending active revoked }` (default `active`) | `schema.prisma` ~514, enum ~128 | the **state machine** E9 drives: `pending → active` (approve), `pending → revoked` (reject). |
| `Guardianship.approvedBy` / `approvedAt` / `revokedAt` | `schema.prisma` ~515–517 | the **approval stamps** the approve/reject verbs fill (already present, currently only set by the admin-direct path). |
| `Guardianship.notes` | `schema.prisma` ~518 | reusable for the **rejection reason** (or the new provenance — data-model §1 locks it). |
| `@@unique([guardianId, studentId])` | `schema.prisma` ~525 | **idempotency**: one link per pair; re-claim is a no-op / `revoked`-reuse. |
| `guardianships.approve` permission (→ `school_admin`/`super_admin`) | `permissions.constants.ts` ~40, ~168 | the **admin gate** for the queue + approve/reject. **No new admin permission.** |
| `enrollment_status` `NotificationKind` + `NotificationsService.createMany` | `schema.prisma` ~1215, `notifications.service.ts`; precedent `enrollments.controller.ts` `notifyGuardiansOfEnrollment` | the **notification spine** for the parent on approve/reject. **No new kind/queue.** |
| Parent ABAC (`StudentAccessService`, `status: 'active'` guardianship gate) | `students/student-access.service.ts` ~40–49 | the **access wall** — unchanged; a `pending` link doesn't satisfy it, so **approval is the single grant switch**. |
| `AuditLog` (append-only `audit_log`) + the audit write path | `schema.prisma` ~1067 | every transition writes a row; verbs are **new strings**, not schema. |
| `Guardian.userProfileId String? @unique` | `schema.prisma` ~484 | the **parent identity link** — the claim resolves the caller's own `Guardian` from `userProfileId === me.id`. |
| `SchoolContextService.forUser` / `UserSyncService.ensureUser` | `shared/auth` | server-derived tenant/school/identity on every path. |
| Admin-direct `POST /guardians/guardianships` (instant `active`) | `guardians/guardians.controller.ts` ~239 | the path E9 runs **alongside** (untouched), with its `revoked`-reuse precedent E9 mirrors. |

**Ruling (reconciled with the canonical kit):** E9 reuses the existing state machine, permission family
shape, notification kind, ABAC wall, audit table, and REST style — the only **schema** delta is
**additive provenance** (data-model §1). **However**, the canonical `data-model.md`/`tasks.md` rightly
record that the **deny-by-default, no-enumeration-oracle child-claim matcher + the parent self-claim write
path** (a parent initiating a write against a *minor's identity link*, gated by a brand-new self-service
matching contract) **is a new architectural decision** → **`docs/adr/ADR-022`**, authored on the **S1**
run. *(Read §2 for the matcher design the ADR pins: pure module, identical response across all outcomes,
deny-by-default on ambiguity, school-scoped.)* The schema-shape choice (additive columns on `Guardianship`
vs a dedicated `GuardianshipClaim` model) is settled in **`data-model.md` §1 — Option B, a dedicated
`GuardianshipClaim` model, is CHOSEN** (it makes the unmatched case a first-class row, the E1-S3
`MeetingRequest`→action precedent; Option A/columns is the recorded rejected alternative). The ADR is about
the **matcher/claim contract**, not the row shape. **Reconciliation note:** any reference in this plan's
prose to "provenance columns on `Guardianship`" / `claimSource=parent` is **superseded by `data-model.md`
§1** — read it as "fields on the `GuardianshipClaim` row" (`claimedFirstName/…`, `matchedStudentId`,
`status`), with the claim **driving** a `pending` `Guardianship` on a match.

> **Note on slice labels below.** The original draft of this plan tagged the **admin** spine as S1 and the
> **parent** claim as S2. The **authoritative order is the reverse** (`tasks.md`: S1 = parent claim +
> matcher + status + schema + ADR-022; S2 = admin approval + UIs). The §3/§4 sections below describe the
> same two halves correctly — **read their (S1)/(S2) tags as "the parent half" / "the admin half"**, and
> defer to `tasks.md` for the shippable ordering.

## 2. Where the deny-by-default matcher lives (the security core)

The claim **matcher** (FR-2) is the single security-sensitive unit. It is a **pure, server-side** function
(`apps/api/.../guardianships/claim-match.ts` — a tested pure module, the E7 `session-instance.ts`
precedent) so the no-oracle contract is unit-testable in isolation:

- **Input:** `{ tenantId, firstName, lastName, birthDate, externalRef? }` (all server-trusted: tenantId
  derived, the rest the parent's claim).
- **Normalisation:** trim + lowercase + accent-fold name; `externalRef` exact (case-insensitive) when
  supplied; `birthDate` exact date.
- **Query:** `student.findMany({ where: { tenantId, /* normalised match */ } })` — **always tenant-scoped**.
- **Output (deny-by-default):**
  - **exactly one** candidate → `{ outcome: 'matched', studentId }` (→ create/reuse a `pending`
    guardianship).
  - **zero** candidates → `{ outcome: 'no_match' }` (→ record a no-resolved-student claim **or** simply
    return the identical response with no row; data-model §3 locks whether a no-match persists a row).
  - **more than one** candidate → `{ outcome: 'ambiguous' }` (→ a claim flagged for admin review; **never**
    auto-link).
- **The controller maps ALL outcomes to the SAME HTTP 202 + the SAME body** (*"Demande envoyée."*). The
  `outcome` never escapes to the parent response. (FM-1 wall — Critic + Sentinel both pin this.)

> **Why a pure module:** the no-oracle property is "the parent response is identical across outcomes." A
> pure matcher + a controller that discards `outcome` makes that property a **2-line test assertion**
> (assert the response object is deep-equal across matched/no_match/ambiguous fixtures), not an integration
> guess.

## 3. The two new surfaces (modules)

> **Route reconciliation (authoritative = `contracts/openapi.yaml` + `data-model.md` §5).** The canonical
> REST surface is **`POST/GET /api/v1/parent/child-claims`** (+ `…/{id}/withdraw`) for the parent and
> **`GET /api/v1/admin/child-claims`** + **`POST /api/v1/admin/child-claims/{id}/approve|reject`** for the
> admin — the `/admin/*` + `/parent/*` audience-prefixed style (the E8 `/student/*` + `parent-exports`
> precedent). Any `/guardianships/claims*` or `/admin/enrollment-requests` path in this plan's prose below
> is **superseded** by those canonical routes; read them as the `/admin/child-claims` equivalents. The
> module may still live beside the `guardians` module (sharing its deps) — only the **route prefix** is
> reconciled.

### 3.1 Admin approval spine (S1) — extend the existing guardianship surface

The admin queue + approve/reject live next to the existing guardianship endpoints. **Decision (Winston):**
add them to the **`guardians` module** (where `createGuardianship`/`updateGuardianship` already live) under
a **`claims` sub-path** — `GET /guardianships/claims`, `POST /guardianships/claims/:id/approve`,
`POST /guardianships/claims/:id/reject` — so the approval logic sits beside the link-creation logic it
mirrors, on the same `guardianships.approve`/`guardianships.write` permission family. (Alternative
considered: a dedicated `child-claims` module — rejected as over-structure for ~3 routes that share the
`Guardianship` aggregate and the guardian module's `PrismaService`/`UserSyncService`/`NotificationsService`
deps.)

- **`GET /guardianships/claims?status=pending`** (`guardianships.approve`): aggregate read of pending (and,
  with `?status=`, other-status) claims — the claim-provenance + the joined `guardian` (parent) + `student`
  (proposed child) + the child's active `classSection` — **one query, no N+1**, tenant-scoped.
- **`POST /guardianships/claims/:id/approve`** (`guardianships.approve`): load the guardianship
  (404-before-403 cross-tenant), assert it is `pending` (else benign idempotent no-op / 409 on a `revoked`
  one — contract §approve), `$transaction`: `status → active` + `approvedBy = me.id` + `approvedAt = now()`
  + append-only `guardianship.claim_approved` audit; **after commit, best-effort** `notifications.createMany`
  (kind `enrollment_status`, parent recipient = `guardian.userProfileId`, link `/parent/children`). Never
  throws on a notification failure.
- **`POST /guardianships/claims/:id/reject`** (`guardianships.approve`, body `{ reason }`): load + assert
  `pending`; `$transaction`: `status → revoked` + `revokedAt = now()` + reason captured (provenance/`notes`)
  + append-only `guardianship.claim_rejected` audit (the reason in `after`); best-effort kind notification.

### 3.2 Parent claim surface (S2) — a thin parent module path

The parent claim + status read live on a **parent-scoped path** (`/api/v1/parent/child-claims`), mirroring
the `parent-exports` module precedent (a distinct parent-permitted surface, never reusing an admin
permission). **Decision:** a small `child-claims` controller (in the `guardians` module or a sibling
`parent-claims` module — the S2 story locks it; default = a `ParentChildClaimsController` in the guardians
module to share the matcher + Prisma deps) on the **new parent-only `guardianships.claim`** permission.

- **`POST /parent/child-claims`** (`guardianships.claim`): resolve the caller's own `Guardian`
  (`Guardian.userProfileId === me.id`, tenant-scoped; **no client `guardianId`**) → 422 kind error if the
  signed-in user has no `Guardian` row (an account-not-a-parent edge); run the **pure matcher**; on
  `matched` create/reuse a `pending` guardianship (provenance + `guardianship.claim_requested` audit);
  **map every outcome to the identical 202 "Demande envoyée."** (no-oracle).
- **`GET /parent/child-claims`** (`guardianships.claim`): the caller's **own** claims only (the caller's
  `Guardian`'s guardianships that are parent-self-claims — `claimSource = parent` provenance), each with its
  status + (on `revoked`) the kind reason — **never** a non-matched child's data.

## 4. Data flow (request paths)

**Parent claim (S2):**
```
POST /parent/child-claims { firstName, lastName, birthDate, externalRef?, relationship }
  → ensureUser(jwt) → forUser(me) → resolve OWN Guardian (userProfileId===me.id, tenantId) [422 if none]
  → matchClaim({ tenantId, ...normalised })           # pure, tenant-scoped, deny-by-default
      matched   → upsert pending Guardianship(guardianId=own, studentId=matched, status=pending,
                  claimSource=parent, claimedAt=now, relationship) + audit claim_requested
      no_match  → (record no-resolved claim OR nothing — data-model §3)
      ambiguous → record admin-review claim (no studentId resolved) OR pending-unresolved
  → 202 { message: "Demande envoyée." }                # IDENTICAL across all 3 outcomes (no oracle)
```

**Admin approve (S1):**
```
POST /guardianships/claims/:id/approve
  → ensureUser(jwt) → guardianships.approve → load Guardianship (tenant-scoped; 404 cross-tenant)
  → assert status===pending (else idempotent no-op if already active / 409 if revoked)
  → $transaction: status=active, approvedBy=me.id, approvedAt=now + AuditLog(claim_approved)
  → (post-commit, best-effort) notifications.createMany(kind=enrollment_status, parent, link=/parent/children)
  → 200 { id, status: 'active', approvedAt }
```

**Admin reject (S1):**
```
POST /guardianships/claims/:id/reject { reason }
  → ... load + assert pending
  → $transaction: status=revoked, revokedAt=now, reason captured + AuditLog(claim_rejected, after.reason)
  → (post-commit, best-effort) notifications.createMany(kind=enrollment_status, parent, kind copy)
  → 200 { id, status: 'revoked' }
```

## 5. Frontend (apps/web)

- **`/parent/children/claim`** (S2) — a server-component page + a `'use client'` `ChildClaimForm`
  (`'use server'` action posting to `POST /parent/child-claims`), fields: prénom, nom, date de naissance,
  matricule (optionnel), lien de parenté (`relationship` select). On submit → the kind *"Demande envoyée"*
  confirmation, **never** a "found/not found" signal.
- **`/parent/children`** (S2/S3) — a **"Mes demandes"** status strip listing the caller's own claims with a
  `Badge` (`en attente` / `validé` / `refusé — {raison}`) + a **"Refaire une demande"** CTA on a refusal
  (S3 re-submit loop).
- **`/admin/enrollment-requests` → "Demandes de rattachement"** (S1 thin page, S3 nav wiring) — a
  server-component page over `GET /guardianships/claims?status=pending` rendering the queue (`Table`/`Card`),
  each row with parent + proposed child + class + relationship + submitted-at and **Approuver** /
  **Refuser** actions (`FormDrawer`/`Dialog` for the reject reason). A pending-count badge on the nav item
  (S3). *(Note: `/admin/enrollment-requests` currently redirects to `/admin/enrollments`; E9 either repoints
  it to the claim queue or adds a sibling `/admin/child-claims` — S3 locks the route, ux §1.)*
- **Reuse-first:** `@pilotage/ui` `Card`/`Section`/`Badge`/`Table`/`FormDrawer`/`Dialog`/`Button` — **no
  `packages/ui` change anticipated**. Aggregate reads only (no client N+1).

## 6. Concurrency, idempotency & edge posture

- **Idempotent claim** — `@@unique([guardianId, studentId])` makes a duplicate impossible; the create is an
  **upsert-by-pair** (P2002 → reuse the existing row: `pending`/`active` → surface status, `revoked` →
  reactivate to `pending`), mirroring `createGuardianship`'s `revoked`-reuse.
- **Idempotent approve/reject** — guard on the current status (`pending`-only transition); approving an
  already-`active` claim is a no-op (no second notification); a from-status-guarded `updateMany`
  (the ADR-020 idiom, optional) makes a concurrent double-approve deterministic, never a double-notify.
- **No-oracle invariant** — the controller **never** branches its response on the matcher outcome (§2).
  Sentinel + the Critic pre-mortem both assert this on the S2 verify pass.
- **Best-effort notifications** — every `createMany` is wrapped (the `enrollments.controller.ts`
  try/catch precedent); a Redis/SMTP failure never rolls back the state transition.

## 7. Test strategy (Murat — lightest valuable set)

- **S1:** a targeted spec on the approve/reject verbs — `pending → active` stamps `approvedBy`/`approvedAt`
  + writes `claim_approved` audit + best-effort notify; `pending → revoked` captures the reason + writes
  `claim_rejected`; idempotent re-approve = no second notify; cross-tenant claim → 404.
- **S2 (the P0 test):** the **no-oracle** matcher spec — assert the **response is deep-equal** across
  `matched` / `no_match` / `ambiguous` fixtures (the single most valuable test in the epic), plus: the
  claim resolves the caller's OWN `Guardian` (a client-supplied `guardianId` is impossible/ignored), an
  ambiguous match does NOT auto-link, a re-claim is idempotent (`revoked`-reuse).
- **S3:** none required beyond the build/typecheck gate (web wiring + copy); optional a11y snapshot.

## 8. Risks & mitigations (feeds the Critic)

| Risk | Mitigation |
|---|---|
| **Enumeration oracle** (parent learns a child exists) | identical 202 across all matcher outcomes; matched `studentId` never in the parent response; pure-matcher deep-equal test (AC-2). |
| **Auto-grant** (claim grants access before approval) | claim creates **`pending`** only; parent ABAC gates on `status:'active'`; approval is the single grant switch (AC-1/AC-4). |
| **Over-broad match** (parent links someone else's child) | deny-by-default: ambiguous (>1) never auto-links; even a single match lands `pending` for human review; DOB + optional matricule narrow. |
| **Cross-tenant leak** | every query tenant-scoped (server-derived); cross-tenant claim/approve → 404. |
| **Duplicate / race** | `@@unique([guardianId, studentId])` + upsert-by-pair; status-guarded transitions. |
| **Stigmatising rejection** | kind reason copy bank (ux §7); `revoked` + re-submit path, never a dead end. |
| **Regression on admin-direct path** | E9 adds routes **alongside** `POST /guardians/guardianships`; that path is untouched (AC-9). |
