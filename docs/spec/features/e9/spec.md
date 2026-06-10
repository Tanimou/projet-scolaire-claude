# E9 — Enrollment self-service UI (parent child-claim → admin approval)

> **Status:** in-progress (spec run) · **Size:** ~S · **Tier:** 4 (Foundation, quality & interop)
> **Why now:** E1–E8 are all shipped (E7-S1→S6 + E8-S1→S3 landed; commits `e208f25`/`c7f4f3d`). No
> open routine PRs (the in-flight throttle is clear). The roadmap's explicit next-step pointer routes
> to the highest Tier-4 filler — **E9 — Enrollment self-service UI** (`proposed`, ~S, "backend 90%
> ready") over E10 (the quality bar, ongoing). No `docs/spec/features/e9/` exists yet, so per the mode
> rules this is an **epic-spec** run (the spec-kit only — no code, no schema change, no build).
> **Audit:** the *backbone* is real and verified in `schema.prisma` — `Guardianship.status`
> (`pending`/`active`/`revoked`) + `approvedBy`/`approvedAt`/`revokedAt`, `EnrollmentStatus.pending`,
> the `guardianships.approve` permission (already seeded to school/super admin), and the
> `enrollment_status` `NotificationKind`. But there is **no parent child-claim surface** in `apps/web`
> and **no claim/approval endpoints** that drive the `pending → active` transition: the admin's
> `POST /guardians/guardianships` today **auto-sets `status: 'active'` + `approvedBy: me.id`** (an
> admin-initiated link), so the cahier's **parent→admin validation loop** is genuinely unbuilt. E9
> ships the **parent-initiated** half — a kind, status-tracked child-claim that lands in an admin
> approval queue — reusing the existing status machinery end-to-end.

## Vision

The cahier de charges describes a **parent→admin onboarding validation loop**: a parent should be able
to **request** to be attached to their child, and the school should **validate** that request before any
access is granted. Today the platform only supports the *reverse, admin-initiated* flow — a school admin
manually creates a guardian, then manually links them to a student (`status: 'active'` on the spot).
There is **no door a parent can knock on**. A newly-invited parent who wants to see their child's
dashboard has to phone the school and ask an administrator to wire the link by hand.

E9 opens that door, **kindly and safely**. A signed-in parent fills a short **child-claim** form —
the child's name, date of birth, and (optionally) the school-issued external reference — plus how they
are related. The system **matches** the claim against existing `Student` records **deny-by-default**:

- a confident match creates a **`pending` `Guardianship`** (never `active`) carrying the claim's
  provenance, and the parent sees *"Demande envoyée — en attente de validation par l'établissement"*;
- a **non-match never leaks** that no such child exists, never reveals a partial match, and never
  auto-grants anything — the same calm "we've received your request" outcome, so the form can't be used
  to enumerate the school's roster.

The claim lands in an admin **"Demandes de rattachement"** approval queue. An administrator with the
existing `guardianships.approve` permission reviews each request against the matched child and either:

- **approves** — one atomic transition flips the `pending` `Guardianship` to **`active`**, stamps
  `approvedBy`/`approvedAt`, and **that is the moment parent portal access is granted** (the parent's
  existing guardianship-ABAC wall now resolves the child); an in-app notification fans out to the parent
  (*"Votre rattachement à {enfant} a été validé"*); or
- **rejects** — **non-stigmatising**, with a short reason; the parent is told kindly and offered a
  **re-submit** path (fix a typo in the DOB, attach the right reference, try again). A rejection never
  deletes the audit trail and never bars a corrected re-claim.

**The visionary spine — a kind, status-tracked child-claim lifecycle.** The whole loop reuses the
**existing `Guardianship.status` machinery** (`pending`/`active`/`revoked` + `approvedBy`/`approvedAt`) as
the **access link**, and the **E1/E2 notification spine** (`NotificationsService.createMany`, the reused
**`enrollment_status`** `NotificationKind` — no new kind, no new queue). The **only** additive schema is a
thin **`GuardianshipClaim`** provenance/request row (how the parent described the child + the match
decision + the request's own lifecycle, so an admin can audit *why* a link exists and the unmatched case
is first-class) that **drives** a `Guardianship` — the request→link pattern the platform already uses
(E1-S3 `MeetingRequest`). No new datastore, no new BullMQ queue, no schema rewrite of any existing model —
the backbone the roadmap calls "90% ready" is reused, not rebuilt. (See `data-model.md` §1 — the
`GuardianshipClaim` model is authoritative; it is what `contracts/openapi.yaml` is written against.)

**The parent value, in one sentence.** A parent can **self-onboard to their child** — claim the child,
watch the request's status, and get told the moment access is granted — without a phone call, while the
school keeps **full, auditable, deny-by-default control** over who is attached to whose child.

## Users & why

- **Parent — the new initiator of this surface.** A signed-in parent (a `UserProfile` linked to a
  `Guardian`, or a parent-role user about to be) can **submit a child-claim**, **see its status**
  (pending / approved / rejected), and **re-submit** a rejected or corrected claim. Before E9 they
  could only *consume* a link an admin created for them; now they can *request* it. They never see
  another family's claim, never learn whether a non-matching child exists, and gain **zero access**
  until an admin approves.
- **School / super admin — the validator (unchanged authority, new queue).** An admin with the
  **already-seeded `guardianships.approve`** permission gets a **"Demandes de rattachement"** queue of
  pending claims, each showing the parent, the claimed child details, and the system's match decision,
  and **approves or rejects** each one. E9 adds **no new admin authority** — it surfaces a queue over
  the permission that already exists and was, until now, only exercised implicitly by the
  auto-active admin-link path.
- **Teacher — unchanged.** Teachers are not part of the enrollment-claim loop; no teacher capability is
  added, moved, or loosened.
- **The platform itself.** E9 is the platform's first **parent-initiated write that touches another
  person's child record**, so it is a strict RGPD/ABAC test: the claim is **deny-by-default** (never
  auto-grants, never leaks a non-match, never enumerates the roster), **tenant + school scoped**, and
  **append-only audited** at every step (claim submitted, approved, rejected, re-submitted). It reuses
  the existing guardianship-ABAC wall (a parent only ever reads a child they are *actively* attached to),
  so an approved claim is the *only* thing that opens access — there is no second access path to keep in
  sync.

## Concrete scenarios

1. **A parent claims their child (the headline, S1).** A signed-in parent opens
   **`/parent/children/claim`**, fills the child-claim form — *Prénom*, *Nom*, *Date de naissance*, optional
   *Référence établissement*, *Lien de parenté* — and submits. The server matches the claim against
   `Student` records in the parent's school **deny-by-default**: an exact-enough match creates a
   **`pending` `Guardianship`** (never `active`) with the claim's provenance recorded, and the parent
   sees *"Demande envoyée — en attente de validation par l'établissement"* with a **status chip**. The
   parent gains **no access yet**.

2. **The non-match never leaks (the security-sensitive path, S1).** A parent submits a claim that
   matches **no** student (wrong DOB, a child at another school, a fishing attempt). The response is the
   **same calm acknowledgement** — *"Votre demande a bien été reçue"* — with **no signal** that no such
   child exists, no count of near-matches, no roster data. Internally the claim is recorded as
   `unmatched` (pending an admin's manual handling or silent expiry); **nothing is granted**, and the
   form **cannot be used to enumerate** the school's students.

3. **The admin reviews the queue and approves (S2).** A school admin opens
   **`/admin/child-claims`** — the **"Demandes de rattachement"** queue — and sees each pending
   claim: the requesting parent, the claimed child details, the **match decision** (matched student vs.
   "no match — handle manually"), and the relationship. They click **Approuver**. One atomic transition
   flips the `pending` `Guardianship` to **`active`**, stamps `approvedBy = me.id` / `approvedAt = now`,
   writes an append-only `guardianship.claim_approved` audit row, and fans out an in-app
   `enrollment_status` notification to the parent. **From this instant the parent's existing
   guardianship-ABAC wall resolves the child** — the dashboard, alerts and recommendations light up. No
   second "grant access" step exists.

4. **The admin rejects, kindly, with a re-submit path (S2).** The admin spots a mismatch (the DOB
   doesn't match the matched child, or the parent claimed the wrong child) and clicks **Rejeter**,
   choosing/typing a short, **non-stigmatising** reason (*"La date de naissance ne correspond pas —
   merci de vérifier et de renvoyer la demande."*). The claim moves to a terminal **rejected** state
   (the `Guardianship` is revoked / the claim marked rejected with the reason), an append-only
   `guardianship.claim_rejected` row is written, and the parent gets a kind notification with a **"Renvoyer
   une demande"** action. **No access is granted; nothing stigmatising is shown; the parent can fix and
   re-submit.**

5. **The parent re-submits after a rejection (S1).** The parent returns to `/parent/children`, sees
   the rejected request with its reason, corrects the DOB, and submits again. A **fresh `pending`**
   claim is created (idempotency keyed so a duplicate *identical* pending claim is collapsed, not
   stacked); it re-enters the admin queue. The rejection history is preserved in the audit trail.

6. **Idempotent double-submit (defensive).** A parent double-clicks submit, or refreshes and re-posts
   the same claim. The second identical submission against an **already-pending** claim for the same
   `(guardian, student)` returns the **existing** pending request (a no-op), never a duplicate row, never
   a 500 — the `@@unique([guardianId, studentId])` on `Guardianship` plus a status guard make the retry
   deterministic.

7. **A parent who is already actively attached (graceful).** A parent claims a child they are **already
   `active`ly** attached to. The system does **not** create a pending claim (they already have access);
   it returns a kind *"Vous êtes déjà rattaché·e à cet enfant"* and deep-links to the child — no duplicate
   guardianship, no admin queue noise.

8. **Approve is atomic and race-safe (defensive).** Two admins open the same pending claim and both
   click **Approuver**. A from-status-guarded transition (`updateMany ... where status = 'pending'`)
   makes exactly one flip win; the second is a deterministic, harmless no-op (already active), never a
   double-grant, never a 500 — the ADR-020 concurrency idiom reused.

## Functional requirements

**FR-1 — Parent child-claim submission (deny-by-default matching).** A signed-in parent can submit a
child-claim — `firstName`, `lastName`, `birthDate`, optional `externalRef`, `relationship` — scoped to
the parent's own tenant + school. The server matches the claim against `Student` records
**deny-by-default**: a confident match (name + DOB, or `externalRef`, within the parent's school)
creates a **`pending` `Guardianship`** (status `pending`, **never `active`**) carrying the claim
provenance; a non-match records an `unmatched` claim and returns the **same** calm acknowledgement. The
matching logic and confidence rule are locked in `data-model.md` §3. **No access is granted at claim
time, ever.**

**FR-2 — Non-enumeration / non-leak.** The claim endpoint returns an **identical** response shape and
copy for matched, unmatched and ambiguous claims (*"Votre demande a bien été reçue"* + a request id +
status `pending`). It **never** reveals whether a matching child exists, never returns a count of
near-matches, never returns any `Student` field the parent didn't already supply. The form cannot be
used to enumerate or probe the roster (rate-limited per parent — see FR-9).

**FR-3 — Parent claim-status surface.** A parent can list **their own** claims with status
(`pending` / `active`/approved / `rejected` + the rejection reason when present) and re-submit a
rejected or corrected claim. Scoped to the parent's own `Guardian`; a parent never sees another family's
claim. Reads are aggregate, server-assembled (no client N+1).

**FR-4 — Admin approval queue ("Demandes de rattachement").** An admin with **`guardianships.approve`**
(already seeded; **no new admin permission**) can list the tenant's **pending** child-claims — the
requesting parent, the claimed child details, the **match decision** (matched `Student` summary or "no
match"), the relationship and submission time — ordered oldest-first. Tenant + school scoped; an admin
never sees another tenant's queue. The parent side is gated by **one new parent-only permission,
`guardianships.claim`** (the `exports.execute.parent` house style — see `data-model.md` §5), never an
admin permission.

**FR-5 — Atomic approve = grant access.** Approving a pending claim performs **one atomic transition**:
the `pending` `Guardianship` → **`active`**, `approvedBy = me.id`, `approvedAt = now`, append-only
`guardianship.claim_approved` audit. **This single transition is the access grant** — the parent's
existing guardianship-ABAC wall (`StudentAccessService`) resolves the child immediately after, with **no
second wiring step**. The transition is **from-status-guarded** (`where status = 'pending'`) so a
concurrent double-approve is a deterministic no-op, never a double-grant.

**FR-6 — Non-stigmatising reject + re-submit.** Rejecting a pending claim moves it to a terminal
**rejected** state with a **short, required, non-stigmatising reason**, writes an append-only
`guardianship.claim_rejected` row, and **grants nothing**. The parent is notified kindly and offered a
**re-submit** path; a corrected re-claim creates a **fresh pending** request (the rejection history is
preserved in audit). Copy is factual and kind — never "refusé/invalide/rejeté" framed at the parent as
fault; prefer *"Information à vérifier"*.

**FR-7 — Notification on every status change (reuse the spine).** Each transition fans out an **in-app**
notification to the parent via **`NotificationsService.createMany`**, reusing the **existing
`enrollment_status` `NotificationKind`** (no new kind, **no new BullMQ queue**): claim received (optional),
approved, rejected. Email is **opt-in only**, riding the existing `NotificationPreference` channel gate
(default OFF / RGPD) through the already-wired dispatcher — **no new worker code, no new template family**
beyond the existing notification-email path.

**FR-8 — Append-only audit + tenant/school scope on every write.** Every claim write is tenant- and
school-scoped (server-derived, never client-supplied) and append-only audited: `guardianship.claim_submitted`,
`guardianship.claim_approved`, `guardianship.claim_rejected`, `guardianship.claim_resubmitted`. The
`AuditLog` row **is** the status history — **no separate `claim_status_history` table** (the E1-S1
precedent: the append-only log is the history). `before`/`after` capture the status flip.

**FR-9 — Abuse resistance.** The parent claim endpoint is **rate-limited per parent** (a small cap per
window, counted on existing claim rows → 429, **no new table/queue** — the E2-S4 send-rate-limit idiom)
so the deny-by-default matcher cannot be hammered to probe the roster. Re-submits after a rejection are
allowed but bounded.

**FR-10 — Aggregate endpoints, reuse-first UI.** Parent and admin reads are **aggregate endpoints** —
parent under `/api/v1/parent/child-claims*`, admin under `/api/v1/admin/child-claims*` (the routes
`contracts/openapi.yaml` defines; Winston's `plan.md` §3 framed them as a guardianship sub-path — the
contract is the wire source of truth) — assembling the full payload server-side. The UI reuses
`@pilotage/ui` (status chips, `DataTable`, `FormDrawer`/`Drawer`, the proven action-center pattern from
E1-S3 `MeetingRequest` and E2-S4 moderation) — premium, responsive, WCAG-AA, no `packages/ui` change
expected.

## Acceptance criteria

- **AC-1 (parent claim → pending, never active, S1).** A signed-in parent submits a child-claim; on a
  confident match the server creates a `Guardianship` with **`status = 'pending'`** (asserted: never
  `active`, `approvedBy`/`approvedAt` null), records the claim provenance, and returns
  `{ requestId, status: 'pending' }` with kind copy. The parent has **no access** to the child
  immediately after (the guardianship-ABAC wall still denies — pending ≠ active).
- **AC-2 (non-match never leaks, S1).** A claim matching **no** student returns the **identical**
  response shape + copy as a matched claim (status `pending`, a request id); the response body contains
  **no** `Student` field the parent didn't supply, **no** match boolean, **no** near-match count. Two
  otherwise-identical requests (one that matches, one that doesn't) are **indistinguishable** to the
  caller. The endpoint is rate-limited (429 past the cap).
- **AC-3 (parent status surface + re-submit + withdraw, S1).** A parent lists **their own** claims with correct
  status + rejection reason; a parent **cannot** see another family's claim (scoped to their `Guardian`);
  a rejected claim can be **re-submitted**, creating a fresh `pending` request; an identical double-submit
  against an existing pending claim is collapsed to the existing request (no duplicate row, no 500).
- **AC-4 (admin queue, S2).** An admin with `guardianships.approve` lists the tenant's **pending** claims
  with the parent, claimed child, **match decision** and relationship, oldest-first, tenant+school scoped;
  a non-`guardianships.approve` caller (parent/teacher) is **denied** (403); no new **admin** permission was
  added. The **parent** claim routes require the new parent-only `guardianships.claim`; an admin/teacher
  token is **denied** there too (the wall runs both ways).
- **AC-5 (atomic approve = access, S2).** Approving flips the `pending` `Guardianship` → **`active`**
  with `approvedBy`/`approvedAt` stamped in **one** transition; **immediately after, the parent's
  guardianship-ABAC wall resolves the child** (the parent dashboard/alerts now load for that child) with
  no other change; an append-only `guardianship.claim_approved` row exists; a concurrent double-approve
  yields exactly one active row (deterministic no-op on the second), never a double-grant, never a 500.
- **AC-6 (non-stigmatising reject + notify, S2).** Rejecting requires a short reason, moves the claim to
  a terminal rejected state, **grants nothing**, writes `guardianship.claim_rejected`, and fans out a
  **kind** in-app `enrollment_status` notification with a re-submit deep-link; the parent-facing copy is
  factual and non-stigmatising (no "échec/refusé-as-fault" framing).
- **AC-7 (RGPD / append-only / tenant scope, every slice).** Every claim write is tenant+school scoped
  and server-derived; every transition is append-only audited (the `AuditLog` row *is* the status
  history — no new history table); no claim read or write can cross tenants/schools; the parent never
  learns of a non-matching child.
- **AC-8 (no regression).** The existing admin-initiated `POST /guardians/guardianships` auto-active link
  path is **unchanged** (E9 adds the *parent-initiated pending* path alongside it, it does not rewrite
  the admin one); no existing permission is widened (the one new permission, `guardianships.claim`, is
  strictly additive + parent-only); no parent/teacher/admin capability is moved or loosened; the **only**
  schema touch is the additive `GuardianshipClaim` model in S1 (see `data-model.md` §1 — one new table +
  one new enum + additive back-relations, `db push`, safe on existing rows; the only `[schema]` slice).

## Slices (ship in order; each ≤ a day, one PR, demoable end-to-end)

> **Authoritative slice backlog = [`tasks.md`](./tasks.md).** The scope ships as **2 thin vertical
> slices** (matching `tasks.md` + the `contracts/openapi.yaml` `[S1]`/`[S2]` tags). The whole schema delta
> (one `GuardianshipClaim` model) lands once in S1.
>
> **S1** stands up the **parent half end-to-end**: the additive `GuardianshipClaim` schema + the one new
> parent-only `guardianships.claim` permission, the deny-by-default matcher, the parent
> `POST /parent/child-claims` write (match → `pending` `Guardianship`, else `match_failed`, idempotent,
> rate-limited, non-leaking), the parent **status read + re-submit + withdraw**, the submit + status UI,
> and **ADR-022**. After S1 a parent can claim a child and watch the request — but only an admin can grant
> access. **S2** ships the **admin half**: the approval queue + the atomic approve/reject transitions + the
> `enrollment_status` parent notification + the admin UI — the loop closes end-to-end.

- **S1 — Parent child-claim + deny-by-default matcher → `pending` Guardianship + status/manage.**
  *(schema + api + web; `[schema][auth][abac][rgpd]` P1)* The additive `GuardianshipClaim` model (the only
  E9 schema step, `db push` — `data-model.md` §1: the new **`GuardianshipClaim`** model + the
  `GuardianshipClaimStatus` enum + additive back-relations + the partial-unique open-claim index) **plus**
  the one new parent-only `guardianships.claim` permission constant + seed (not a schema change). The
  parent `POST /api/v1/parent/child-claims` endpoint: server-derive the parent's `Guardian` + tenant +
  school, run the **pure deny-by-default matcher** against `Student` (name+DOB or `externalRef`,
  school-scoped) → on a match create a `GuardianshipClaim(submitted)` **driving a `pending` `Guardianship`**
  (status `pending`, **never** `active`); on no/ambiguous match a `GuardianshipClaim(match_failed)` with
  **no link**; **shape-identical, rate-limited, near-match-free response** for both (FR-2, `data-model.md`
  §3); idempotent (the partial-unique open-claim index + a status guard); append-only
  `guardianship.claim_submitted` / `claim_match_failed` audit; **never grants access**. The parent
  **status read** (`GET /parent/child-claims`, own claims only) + **re-submit** (a `rejected` claim →
  `submitted`, its link `revoked → pending`) + **withdraw** (`POST …/:id/withdraw`, a `submitted` claim →
  `withdrawn`). A `/parent/children/claim` submit form + a `/parent/children` "Mes demandes" status strip
  (reuse `@pilotage/ui`, kind copy). **Lands with `docs/adr/ADR-022-enrollment-self-service-child-claim.md`**
  — the canonical kit ruling (reconciled across `plan.md`/`data-model.md`/`tasks.md`/`contracts/`): the
  **deny-by-default no-enumeration-oracle child-claim matcher + the parent self-service write against a
  minor's identity link** (a new matching contract + the `GuardianshipClaim` request→link pattern + the
  human-in-the-loop access grant) merits an ADR even though every *implementation* primitive (state
  machine, permission family, `enrollment_status` kind, ABAC wall, audit table, REST style) is reused.
  *(This is the FR-1/FR-2/AC-1/AC-2 tripwire slice.)*

- **S2 — Admin approval queue + atomic approve/reject + parent notification (the loop closes).** *(api +
  web; `[auth][abac]` P2)* `GET /api/v1/admin/child-claims?status=submitted` (pending claims with parent +
  claimed evidence + matched student + match method, `guardianships.read`, tenant scoped, newest-first) +
  `POST /api/v1/admin/child-claims/:id/approve` (**atomic** claim `submitted → approved` **and** the driven
  link `pending → active` in one `$transaction`, from-status-guarded, stamp `approvedBy`/`approvedAt`,
  `guardianship.claim_approved` audit, **this is the access grant**, `guardianships.approve`) +
  `POST …/:id/reject` (claim `rejected` + driven link `revoked` + required reason,
  `guardianship.claim_rejected` audit, grants nothing). Each transition fans out an in-app
  **`enrollment_status`** notification to the parent (`NotificationsService.createMany`, **reused
  kind/queue**; opt-in email via the existing gate). FE = the **"Demandes de rattachement"** queue at
  `/admin/child-claims` (reuse the E1-S3 / E2-S4 action-center table pattern, approve/reject row actions,
  a reason `FormDrawer`/`Dialog`). **No schema change.**

## Non-goals (explicit)

- **No new access path.** The **only** thing that grants a parent access to a child is a `Guardianship`
  reaching **`active`** (the existing ABAC wall). E9 does **not** add a side-channel, a feature flag, or
  a "provisional read" — a `pending` claim grants **nothing**.
- **No roster enumeration / no leak.** The claim form **never** confirms or denies a child's existence,
  never returns a near-match list, never returns `Student` fields the parent didn't supply. This is a
  hard RGPD wall, not a polish item.
- **No rewrite of the admin-initiated link.** The existing `POST /guardians/guardianships` auto-active
  admin link stays as-is; E9 adds the **parent-initiated pending** path **alongside** it.
- **No automatic / fuzzy auto-approve.** A match never auto-approves — an admin always validates. The
  matcher's job is only to **suggest** the candidate student to the admin; the human decides.
- **No self-service account creation / no Keycloak provisioning.** E9 assumes the parent already has a
  signed-in parent-role `UserProfile` (+ `Guardian`). Creating the parent **login** (Keycloak user,
  invite email, password) is **out of scope** — recorded as a follow-on. E9 is the **claim → approval**
  loop, not the identity-provisioning loop.
- **No student-claim / no teacher-claim.** Only a parent claims a child. A student (E8) never claims; a
  teacher is not in this loop.
- **No new enrollment of a student into a class.** `EnrollmentStatus.pending` is **referenced** as part
  of the same onboarding backbone, but E9 does **not** build a parent-driven *class-enrollment* request
  (placing a child in a section) — that is a separate, admin-owned flow. E9 is **guardianship** claim
  only. (Recorded: a future "enrollment request" could reuse the same queue pattern.)
- **No new BullMQ queue, no new datastore, no new `NotificationKind`, no new HTTP style.** Notifications
  reuse `enrollment_status` + the existing dispatcher; the loop reuses `Guardianship.status`.
- **Exactly ONE additive schema change.** S1 adds the `GuardianshipClaim` model (`data-model.md` §1 —
  one new table + one new enum + additive back-relations, `db push`, safe on existing rows). **No further
  schema change** in S2/S3.

## Dependencies & reuse

- **`Guardianship.status` (`pending`/`active`/`revoked`) + `approvedBy`/`approvedAt`/`revokedAt`** —
  the **verified** state machine E9 drives (schema lines 505–529). The `pending` value already exists;
  E9 is the first surface that *creates* a `pending` guardianship and the first that *approves* one via
  a parent-initiated request.
- **`guardianships.approve` permission** — **already seeded** to school/super admin
  (`permissions.constants.ts` lines 40, 168). E9 surfaces a queue over it; **no new admin permission**
  (the one new permission, `guardianships.claim`, is parent-only — `data-model.md` §5).
- **`@@unique([guardianId, studentId])` on `Guardianship`** — the idempotency anchor: one claim per
  (parent, child); a re-submit reuses the revoked/rejected row (the admin-link path already does this
  for `revoked → active`, lines 270–285).
- **`NotificationsService.createMany` + `NotificationKind.enrollment_status`** — the in-app fan-out on
  every status change; **reused**, no new kind/queue. Opt-in email via the existing
  `NotificationPreference` channel gate + the already-wired `notifications-email` dispatcher.
- **`StudentAccessService` (guardianship-ABAC wall)** — **unchanged**; an approved (active) claim is the
  *only* thing that opens the parent's read access — there is no second wall to keep in sync.
- **`AuditLog` (append-only)** — the claim status history (the E1-S1 precedent: the log *is* the
  history, no new table). `before`/`after` capture each status flip.
- **ADR-020 (booking/availability concurrency)** — the from-status-guarded `updateMany` idiom reused for
  the **race-safe approve** (exactly-one-flip-wins). E9's own decision (the deny-by-default claim
  contract + pending-as-access-gate) is recorded in **ADR-022** if S1's matcher warrants it.
- **`@pilotage/ui` + the E1-S3 `MeetingRequest` / E2-S4 moderation action-center pattern + ADR-003
  route groups** — the `/parent/children` (claim + status) + `/admin/child-claims` surfaces are
  premium, responsive, WCAG-AA, reuse-first (no `packages/ui` change expected).
