# E7-S1 — Schema + alert→RemediationPlan promotion + read-only catalogue

> **Self-contained story spec.** A developer implements THIS slice from this file alone. It is the
> spine of E7 — the additive 4-model schema, the 3 role-narrowed permissions + the `remediation`
> NotificationKind, the contracts DTOs/enums, the parent **promote** endpoint + the read-only
> **catalogue** read, and the new "Trouver un soutien en {matière}" action on the existing
> `AlertNextSteps` surface that promotes-then-navigates to a plan page.
>
> **NO booking write path. NO concurrency surface. NO ADR this slice.** (ADR-020 lands with the first
> `Booking` write in S2.) The `Booking`/`TutorAvailability` tables land but ship **no write path** —
> provably no over-booking surface exists.
>
> Tags: `[schema][auth]` · Risk: **P1** · touches: **schema + backend + web** (no worker).

---

## 1. Intent (one sentence)

A parent on `/parent/recommendations`, on a subject-scoped alert, can tap **"Trouver un soutien en
{matière}"** to idempotently promote that alert into a guardianship-walled, baseline-capturing
`RemediationPlan` and land on `/parent/remediation/[planId]` showing the plan's target + a read-only,
subject-filtered, published-tutor catalogue (with a kind empty-state that falls back to the shipped
E1/E2 actions) — the existing E1/E2 alert actions unchanged, no booking write anywhere.

---

## 2. Context — the exact seams this slice reuses (read these first)

| Reuse | File | What to copy |
|---|---|---|
| Alert→record promotion (idempotent `@@unique`, ABAC-before-write, append-only audit, P2002 catch) | `apps/api/src/modules/alerts/alerts.service.ts` `recordMeetingIntent` (L386+) + `apps/api/src/modules/alerts/meeting-requests.service.ts` | the **exact** template for `createPlan` — findFirst fast-path echo + create with P2002 catch + best-effort audit |
| Parent ABAC-before-write controller idiom (`canAccessStudent`, 404-before-403, JWT-derived provenance) | `apps/api/src/modules/parent-exports/parent-exports.controller.ts` + `apps/api/src/modules/alerts/alerts.controller.ts` `authorizeParentAlertAction` (L192) | the controller shape for `RemediationController` |
| Server-derive student/subject from the alert (never trust client) | `alerts.service.ts` `findStudentIdForAlert` (L210), `recordMeetingIntent` select of `studentId/code/subjectId/schoolId` (L393-402) | derive `studentId`/`subjectId`/`schoolId` from the alert row inside the service |
| Role-narrowed permission house style | `apps/api/src/shared/auth/permissions.constants.ts` (`exports.execute.parent/.teacher`, L104-105) + `REALM_ROLE_PERMISSIONS` | add `remediation.read|manage|book` + role grants |
| Additive `NotificationKind` enum value | `apps/api/prisma/schema.prisma` `enum NotificationKind` (L1184) — `message` was E2's additive value | add `remediation` (S1 declares it; the booking notification that USES it is S2 — declaring early is fine, matches E1-S4 `weekly_digest`) |
| `MeetingRequest` model shape (tenant-first cols, `@@map`, `Timestamptz(6)`, `onDelete`) | `schema.prisma` `model MeetingRequest` (L1337) | the row-shape conventions for the 4 new models |
| The alert-action derivation (pure, unit-tested, structured-fields-only, never free-text) | `apps/web/src/app/parent/recommendations/alert-next-steps.ts` `deriveAlertActions` | add the new `find-tutoring` step **inside this pure function**, subject-scoped only, omitted on null subject |
| The panel that renders the steps | `apps/web/src/app/parent/recommendations/AlertNextSteps.tsx` | render the new step row + wire the promote-then-navigate server action |
| Contracts DTO module + export convention | `packages/contracts/src/dto/meeting-request.ts` + `index.ts` (`export * from './dto'`) | add `packages/contracts/src/dto/remediation.ts` |
| `AlertItem` shape consumed by the panel (already carries `code`/`subjectId`/`subjectName`/`subjectCode`) | `apps/web/src/app/parent/recommendations/types.ts` | no change needed — all structured fields already present |

> **Authoritative model/enum names + exact Prisma:** `docs/spec/features/e7/data-model.md` §1.0–§1.5.
> Copy those blocks verbatim. **Do NOT add the §1.6 partial-unique index** — that is S2's only schema
> step. **Do NOT add an ADR** — ADR-020 is S2.

---

## 3. Schema (`prisma db push`, additive only — no SQL `migrations/` folder)

Edit `apps/api/prisma/schema.prisma`. Add **exactly** what `data-model.md` §1.0–§1.5 specifies:

1. **6 enums:** `TutorType` (teacher/external/peer), `TutorCostKind` (free/volunteer/paid_offline),
   `AvailabilityKind` (recurring_weekly/one_off), `RemediationPlanStatus` (open/met/closed),
   `BookingStatus` (requested/confirmed/completed/cancelled/declined/proposed_alternative).
2. **4 models** (verbatim from §1.1–§1.4): `Tutor` (`@@map("tutor")`), `TutorAvailability`
   (`@@map("tutor_availability")`), `RemediationPlan` (`@@map("remediation_plan")`), `Booking`
   (`@@map("booking")`). All tenant-first column + tenant-first composite indexes; `costKind` is a
   **label, never a price** (no Decimal/amount/currency); `subjectIds String[] @db.Uuid` on `Tutor`
   (denormalised, **not** a join table — `where: { subjectIds: { has: subjectId } }`).
3. **`RemediationPlan` idempotency:** `@@unique([tenantId, studentId, subjectId, status])` (the coarse
   app-level open-plan guard — `met`/`closed` historical rows coexist). The promote **upserts on the
   open-status tuple** + catches P2002 (mirrors `recordMeetingIntent`). **The cleaner partial-unique
   `WHERE status='open'` is deferred — S1 ships the `@@unique` + P2002-catch app-layer guard ONLY**
   (the data-model §1.3 caveat explicitly records this choice). Do not write raw SQL this slice.
4. **`Booking` idempotency:** `@@unique([availabilityId, sessionAt, planId])` lands (the table exists)
   — but **no booking write path ships**, so this index is dormant until S2.
5. **Additive back-relations** (§1.5) on `School`, `TeacherProfile`, `UserProfile`, `Student`,
   `Subject`, `AlertInstance` — purely additive virtual list fields with the `@relation("…")`
   disambiguators named in §1.5 (`"TutorUser"`, `"RemediationPlanCreator"`, `"BookingBooker"`). **No
   existing column is renamed, changed, or dropped.**
6. Run `prisma generate` then `prisma db push`. **Additive, safe on existing rows, no backfill.**

> **Tenant-isolation posture (honest, per ADR-019):** isolation is application-layer — `tenant_id`
> first column + tenant-first index + explicit `where: { tenantId }` on every query (server-derived
> from the JWT via `SchoolContextService.forUser`). **Do not fabricate RLS DDL** (the prevailing E6
> ruling). The data-model header documents this.

---

## 4. Permissions + NotificationKind (seed delta)

Edit `apps/api/src/shared/auth/permissions.constants.ts` **and** `apps/api/prisma/seed.ts` **and**
`apps/api/prisma/seed-demo.ts` (keep all three aligned — verify the exact array/role-grant shape in
seed files before editing):

| Permission code | label | resourceType | action | granted to |
|---|---|---|---|---|
| `remediation.read` | `Lire le soutien scolaire` | `remediation` | `read` | `parent`, `teacher`, `school_admin` |
| `remediation.manage` | `Gérer le catalogue de soutien` | `remediation` | `manage` | `school_admin` only |
| `remediation.book` | `Réserver un soutien` | `remediation` | `book` | `parent` only |

- Add the three to the `PERMISSIONS` tuple list **and** to the matching `REALM_ROLE_PERMISSIONS`
  arrays (`school_admin` gets read+manage; `teacher` gets read; `parent` gets read+book). `super_admin`
  auto-includes all via `PERMISSIONS.map`.
- Add `remediation` to `enum NotificationKind` in `schema.prisma` (additive, after `message`). S1 only
  **declares** it; the booking notification that uses it ships in S2.

---

## 5. Contracts (`packages/contracts`)

Add `packages/contracts/src/dto/remediation.ts` (mirror `meeting-request.ts`), exported via the
existing `export * from './dto'` barrel. Include (match the OpenAPI `contracts/openapi.yaml` schemas):

- **Enums/consts** (string-literal unions + `as const` arrays, the contracts house style): `TutorType`,
  `TutorCostKind`, `AvailabilityKind`, `RemediationPlanStatus`, `BookingStatus`.
- **Request DTOs used in S1:** `CreateRemediationPlanRequest` (`{ alertId: string; objective?: string |
  null }` — `studentId`/`subjectId` are **server-derived from the alert**, never in the request).
- **Response DTOs used in S1:** `RemediationPlanDto` (id, studentId, subjectId, alertId, status,
  objective, createdAt, closedAt), `RemediationPlanWithCountsDto` (adds subjectName, studentName,
  plannedSessions, completedSessions, nextSessionAt — S1 may return counts as 0 / null since no
  bookings exist yet, but the shape must be stable for S2/S3), `TutorDto`, `TutorAvailabilityDto`,
  `TutorWithAvailabilityDto`.

> The booking/transition/overview DTOs (`CreateBookingRequest`, `TransitionBookingRequest`,
> `BookingDto`, `RemediationOverviewResponse`) are S2/S4/S6 — **optional to stub now, but do not wire
> any endpoint to them this slice.** Prefer adding only what S1 uses to keep the diff thin.

---

## 6. API — module + two endpoints (aggregate, tenant-scoped, no N+1)

Create `apps/api/src/modules/remediation/` (`remediation.module.ts`, `remediation.controller.ts`,
`remediation.service.ts`) and register the module in the API root module. Reuse `UserSyncService`,
`SchoolContextService`, `StudentAccessService`, `PrismaService`, `deriveAlertActorProvenance`. Guard
the controller with `JwtAuthGuard, PermissionsGuard`. Base route `@Controller('remediation')` →
`/api/v1/remediation/*`.

### 6.1 `POST /remediation/plans` — promote (parent, `remediation.book` + guardianship ABAC)

`@RequiresPermission('remediation.book')`. Flow (the `recordMeetingIntent` template):

1. `me = ensureUser(jwt)`; `{ schoolId } = ctx.forUser(me)`.
2. Load the alert in-tenant: `alertInstance.findFirst({ where: { id: dto.alertId, tenantId },
   select: { studentId, subjectId, schoolId, code } })`. **Not found → 404** (never leak existence).
3. **Guardianship ABAC BEFORE the write:** `canAccessStudent(me, jwt, alert.studentId, schoolId)` →
   false → **403**.
4. **Subject guard:** if `alert.subjectId` is null → **422** ("Cette alerte n'est pas rattachée à une
   matière") — a plan requires a subject. (The web side never offers the action for a null subject, so
   this is defence-in-depth, not the happy path.)
5. **Idempotent promote** on `@@unique([tenantId, studentId, subjectId, status])` with `status: 'open'`:
   fast-path `findFirst({ where: { tenantId, studentId, subjectId, status: 'open' } })` → if found,
   return it with **200**; else `create(...)` and on `P2002` re-read the open plan and return **200**.
   Created → **201**. Seed: `tenantId`, `schoolId: alert.schoolId`, `studentId`, `subjectId`,
   `alertId: dto.alertId`, `status: 'open'`, `objective: dto.objective ?? null`, `createdBy: me.id`.
   `createdAt` **is** the baseline marker the S3 strip frames the E6 trend against — **no separate
   baseline column is needed for S1** (the trend delta is computed live/snapshot vs `createdAt` in S3).
6. **Append-only audit** (best-effort, never blocks the write): `auditLog.create({ action:
   'remediation.plan_created', resourceType: 'remediation_plan', resourceId: plan.id, actorId: me.id,
   actorRole, portal, after: { studentId, subjectId, alertId } })` — wrapped in try/catch + logger,
   exactly like `recordMeetingIntent`. Skip the audit row on the idempotent-reuse (200) path (no
   re-stamp, matching the meeting-intent precedent).
7. Return the `RemediationPlanDto`.

### 6.2 `GET /remediation/catalogue?subjectId=` — read-only (parent, `remediation.read`)

`@RequiresPermission('remediation.read')`. `subjectId` is **required** (the plan's subject — the
catalogue filter). Flow:

1. `me = ensureUser(jwt)`; `{ schoolId } = ctx.forUser(me)`.
2. **Single aggregate query, no N+1:** `tutor.findMany({ where: { tenantId, schoolId, published: true,
   subjectIds: { has: subjectId } }, include: { availabilities: { where: { active: true } } } })`.
3. Map to `TutorWithAvailabilityDto[]`. **Never** return an unpublished or cross-tenant/cross-school
   tutor (the `published + tenant + school` gate is server-side).
4. The catalogue is **school-public to the school's parents** (no per-child ABAC on the catalogue
   itself) — but it is only reached FROM a plan whose student is guardianship-walled. An empty result
   is a valid 200 (the web empty-state handles it).

> Both endpoints are aggregate endpoints (project-context §2). No client N+1. No raw SQL.

---

## 7. Web — the action + the plan page

### 7.1 The new step in `deriveAlertActions` (pure, unit-tested)

Edit `apps/web/src/app/parent/recommendations/alert-next-steps.ts`:

- Add `'find-tutoring'` to `NextStepKind` and a `HeartHandshake` (lucide) icon option.
- Emit a `find-tutoring` step **only for `SUBJECT_SCOPED` codes AND when `subjectId` is non-null** —
  omit it entirely on a null subject (never a broken link). Label: **`Trouver un soutien en
  {subjectName ?? subjectCode ?? 'cette matière'}`**; helper: kind, non-stigmatising (e.g. *"Découvrir
  les ressources de soutien proposées par l'établissement pour cette matière."*); the step carries the
  alert's `subjectId` so the panel can promote.
- **Cap discipline:** `MAX_NAV_STEPS` currently 2; the tutoring step plus the existing reinforce/overview
  steps must stay within a sensible cap. Order the tutoring step **first** for subject-scoped codes (it
  is the most actionable new path) but keep the existing reinforce/overview steps present — bump
  `MAX_NAV_STEPS` to 3 if needed so the existing steps are not dropped (they must remain — AC: E1
  actions unchanged). The teacher CTA is still appended by the component on top.
- The `find-tutoring` step is **not** a plain `<Link href>` like the others — it must promote first,
  then navigate. Model it as a distinct kind the component special-cases (a button that calls the
  promote action), OR give it `href: null` and a `promote: true` marker. Keep the pure function pure
  (no I/O) — it only **describes** the step; the component performs the promote.

**Unit test (Murat, the one valuable test):** pin in `alert-next-steps.spec.ts` — (a) a `find-tutoring`
step is present for `LOW_SUBJECT_AVG` with a non-null subject and carries the subjectId; (b) it is
**absent** when `subjectId` is null; (c) it is absent for `HIGH_ABSENCE` (non-subject code); (d) the
existing reinforce/overview/attendance steps are unchanged.

### 7.2 The promote-then-navigate server action

Add `promoteRemediationPlanAction(alertId)` (a `'use server'` action mirroring
`requestMeetingIntentAction` in `intent-actions.ts`): POSTs `/remediation/plans` with the caller's
bearer, returns `{ ok: true, data: { planId } } | { ok: false, error }`. On `ok`, the client navigates
to `/parent/remediation/${planId}` (`router.push`). On error, surface a kind inline message (reuse the
panel's existing `aria-live` error region). The action is idempotent server-side, so a double-tap
lands on the same plan.

### 7.3 `AlertNextSteps.tsx` wiring

Render the `find-tutoring` step as a row (icon chip + label + helper, same visual grammar as the
existing rows) whose click runs `promoteRemediationPlanAction` inside `useTransition` then navigates.
Announce politely on the transition (the existing `aria-live` region). **The existing reinforce /
overview / "En parler à l'enseignant" CTAs are untouched** — the tutoring row is **additive**.

### 7.4 `/parent/remediation/[planId]/page.tsx` — the plan page

New route. Server component (data-fetching in the server component, project-context §2):

1. Fetch the plan (a `GET /remediation/plans` filtered by the caller's children, find the one matching
   `planId` — server-scoped; a plan not belonging to the caller's guarded students → Next.js
   `notFound()`). *(If a dedicated `GET /remediation/plans/:id` is cleaner, add it under the same
   `remediation.read` + guardianship wall — but reusing the list keeps the surface minimal; pick one,
   document it.)*
2. Show the plan **target**: subject name, the kind objective, "Soutien souhaité — {matière}".
   Reuse `@pilotage/ui` `Card`/`Badge`/`SubjectChip` — **reuse-first, no new shared component**.
3. Fetch + render the **read-only catalogue** (`GET /remediation/catalogue?subjectId={plan.subjectId}`)
   — each published tutor as a card (display name, blurb, cost **label**, subjects, their active slots
   shown read-only as informational text — **no "Réserver" button this slice**, booking is S2).
4. **Kind empty-state (never a dead-end):** when the catalogue is empty, render an `EmptyState`
   (*"Aucune ressource de soutien n'est disponible pour cette matière pour l'instant."*) that **falls
   back to the shipped E1/E2 CTAs** — a link to message the teacher (`/parent/messages/new?...`,
   the E2 alert-seeded compose) and/or the E1 meeting-request path, plus a link back to
   `/parent/grades?studentId=&subjectId=`. The page **always** offers a next action.

> Frontend must be premium, colorful, responsive, animated, accessible (project-context §2). WCAG 2.2
> AA: icon+text (not colour-alone), ≥4.5:1, focus-visible rings, ≥44px targets, kind FR copy (no
> "échec/mauvais/redoublement/leaderboard"), `prefers-reduced-motion`, mobile-first.

---

## 8. Acceptance criteria (folds spec AC-1/2/3/6/7)

1. **Schema additive:** the 4 tables + 6 enums land via `prisma db push` (no SQL `migrations/` folder);
   each tenant-scoped with a tenant-first column + tenant-first composite index; the only existing-model
   edits are the §1.5 additive back-relation arrays; **no existing column changed**; safe on existing
   rows. `Booking`/`TutorAvailability` tables exist but **no booking write path ships**.
2. **Promotion idempotent + ABAC + audited:** a parent promotes a subject-scoped alert into a
   `RemediationPlan` seeded with `alertId`/`studentId`/`subjectId` (server-derived from the alert),
   `status: 'open'`, `createdBy = me`; **guardianship ABAC runs BEFORE the write** (403 otherwise);
   idempotent per the open-plan `@@unique` (re-tap → 200, same plan, no duplicate audit/row, P2002-safe);
   writes one append-only `remediation.plan_created` audit row on create; cross-tenant/unknown alert →
   404; null-subject alert → 422. The **E1 meeting-intent and E2 messaging actions still work
   unchanged**.
3. **Catalogue read correct:** `GET /remediation/catalogue?subjectId=` returns **only** active+published,
   subject-matching, tenant+school-scoped tutors with their active slots; never a cross-tenant/
   unpublished leak; assembled in one aggregate query (no N+1); empty result is a valid 200.
4. **The action derives from structured fields + degrades on null subject:** the `find-tutoring` step
   appears only for subject-scoped codes with a non-null subject, omitted otherwise (no broken link);
   it promotes-then-navigates to `/parent/remediation/[planId]`; the existing steps are unchanged.
5. **Plan page never a dead-end:** shows the target + the read-only catalogue, and on an empty catalogue
   falls back to the shipped E1/E2 CTAs (message the teacher / reinforce subject / request meeting).
6. **Tenant/RGPD/audit:** every read/write carries explicit `where: { tenantId }` (server-derived);
   guardianship ABAC precedes the parent plan write; the three `remediation.*` permissions gate the
   roles (no existing permission loosened); the audit row is the history (no status-history table); no
   new sensitive data category; kind non-stigmatising FR copy throughout.
7. **Reuse-first, no drift:** reuses `deriveAlertActions`/`AlertNextSteps` (E1-S2), the
   `MeetingRequest` idempotency + ABAC-before-write + P2002-catch + best-effort-audit pattern (E1-S3),
   the role-narrowed permission style (E4), aggregate endpoints, `@pilotage/ui`, `packages/contracts`.
   **No second BullMQ queue, no new HTTP style, no new Keycloak role, no payment/PSP, no new datastore.**
8. **Tests:** unit test pins `deriveAlertActions`'s new `find-tutoring` step (present/absent cases) +
   the promotion idempotency (re-promote returns the same plan, one audit row). `pnpm typecheck` green
   (Murat, once); no `git diff --check` errors.

---

## 9. Pre-mortem failure modes → extra acceptance (Critic)

- **FM-1 — over-promotion / privilege creep:** the promote endpoint must NOT accept a client-supplied
  `studentId`/`subjectId` — they are derived from the alert row in-tenant. *(Test: a request whose
  alert belongs to another guardian's child → 403; a cross-tenant alertId → 404.)*
- **FM-2 — idempotency race:** two concurrent promotes of the same alert → exactly one `open` plan +
  one audit row (P2002 catch on the `@@unique`, then return 200). *(This is row-level idempotency, NOT
  the capacity concurrency of S2 — no ADR needed.)*
- **FM-3 — broken deep-link:** the `find-tutoring` step must never render with a null/undefined
  subject (omit it). The plan page must never render a "Réserver" affordance (booking is S2) — a
  reviewer greps for any booking POST and finds none.
- **FM-4 — dead-end plan page:** an empty catalogue must fall back to a live E1/E2 CTA, never a blank
  page. *(Scenario 7 in spec.md.)*
- **FM-5 — schema drift on existing tables:** the diff on existing models must be **only** additive
  back-relation list fields — a reviewer confirms no column/`@map`/index on an existing model changed.
- **FM-6 — accidental S2 scope:** no partial-unique index, no `CREATE … WHERE` raw SQL, no
  `ADR-020`, no `/remediation/bookings` route this slice.

---

## 10. Out of scope (later slices)

Booking create + the partial-unique index + **ADR-020** (S2) · the dashboard progress strip + the
additive `remediation` dashboard block + the trend-delta-vs-baseline read (S3) · teacher capacity +
booking transitions (S4) · admin curation `/admin/remediation` + tutor CRUD (S5) · notifications +
cancellation + completion + uptake sweep (S6). **This slice writes no `Booking`, publishes no
availability via API, and emits no `remediation` notification.**
