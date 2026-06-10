# E8 — Data model & migration plan (Architect: Winston)

> Companion to [`spec.md`](./spec.md) / [`plan.md`](./plan.md) / [`contracts/openapi.yaml`](./contracts/openapi.yaml) / [`tasks.md`](./tasks.md) / [`ux.md`](./ux.md).
> E8 "Student Portal" adds a **fourth read-only audience** — the learner, seeing **only their own**
> dossier (grades, upcoming assessments, attendance, announcements, the E6 trend, the E7 plan). It
> activates the **already-reserved `student` Keycloak realm-role** (ADR-004/ADR-015), adds a
> **student-self ABAC wall** (deny-by-default, self-only, never peer comparison), a **thin role-narrowed
> read-only permission family**, and **one additive identity link** — reusing the existing aggregate
> endpoints for every read.
>
> **Headline data-model fact: E8 makes exactly ONE additive schema change — the `Student.userProfileId`
> account link.** *(Reconciliation note, this spec run: an earlier draft of this file claimed the link
> "already exists" and that E8 was zero-schema. That was a verification error — the
> `userProfileId String? @unique … onDelete: SetNull` pattern exists on **`Guardian`** (the parent's
> auth↔domain join), **not** on `Student`. The live `Student` model, verified directly against
> `apps/api/prisma/schema.prisma`, has `email String?` but **no** `userProfileId`. E8-S1 therefore **adds**
> the link — an additive, nullable, `@unique`, `SetNull` FK via `db push` — so **S1 is a `[schema][auth]`
> slice.** Everything else in E8 is read-only reuse with no further schema change.)*
>
> **Migration convention (repo-wide, verified):** `prisma db push`, **no SQL `migrations/` folder**
> (`apps/api/prisma/migrations/` does not exist — same as E1-S3, E2-S1, E3-S1, E5-S2, E6-S1, E7-S1). The
> one E8 change (the `Student.userProfileId` link + its back-relation on `UserProfile`) is **additive and
> nullable** ⇒ safe on existing rows, zero-downtime (expand-only), **no backfill**. The only other
> DB-adjacent change is the **permission-seed delta** (rows in the existing `permission`/`role_permission`
> tables via `seed.ts`/`seed-demo.ts`, not a schema migration).
>
> **Tenant-isolation posture (honest record, per ADR-019).** The repo enforces tenant isolation **at the
> application layer** via explicit `where: { tenantId }` on every query (RLS DDL exists as intent — see
> ADR-019 "Tenant isolation posture"). E8 follows that exactly: every student read carries
> `where: { tenantId }` (server-derived from the JWT via `SchoolContextService.forUser`, never
> client-supplied) **and** the self-resolved `studentId`. No fabricated RLS DDL.

---

## 0. What already exists (the seams E8 reuses)

E8 is a **net-new audience over an existing data surface** — every learner read builds on a producer
already shipped, not from scratch:

| Asset | Location | Role for E8 |
|---|---|---|
| `Student` model (with `email`, **no `userProfileId` yet**) | `schema.prisma` `model Student` (`@@map("student")`) | the row E8 links to a login via the **additive** `userProfileId` (§1.1). |
| `Guardian.userProfileId String? @unique … onDelete: SetNull` | `schema.prisma` `model Guardian` | the **exact precedent** the new `Student.userProfileId` mirrors (the parent's auth↔domain join). |
| `student` realm-role (reserved) | ADR-004 (*"`student` (futur)"*) · ADR-015 | the realm-role E8 **activates** (realm export + JWT read + role guard + default permission set). |
| `StudentAccessService` (parent guardianship + teacher scope) | `apps/api/.../students/student-access.service.ts` | the **ABAC seam** E8 extends with the **student-self branch** (`roles.includes('student')` → scope = `[ownStudentId]`, deny-by-default). |
| `grades/students/:studentId/grades` (published-only for non-staff) | `apps/api/.../grades/grades.controller.ts` | the **producer** E8 reuses for "Mes notes" — resolved to a **self-derived** `studentId`, **published-only** (the `status in (published, revised)` non-staff filter already in place). |
| `AnalyticsService.parentUpcoming({ tenantId, studentId })` | `apps/api/.../analytics/analytics.service.ts` | the **upcoming-assessments** producer E8 reuses for "Mes prochaines évaluations" — self-resolved. |
| `attendance/students/:studentId` (summary + recent records) | `apps/api/.../attendance/attendance.controller.ts` | the **own-attendance** read (FR-4), self-scoped, factual framing. |
| `Announcement` + `AnnouncementReceipt` scope resolution + mark-read | `schema.prisma` `@@map("announcement[_receipt]")` · `apps/api/.../announcements` | the **announcement** read (FR-5), receipt-scoped — the student gets a receipt when a scope reaches them. |
| `student_subject_snapshot` (E6) + the snapshot-first/live trend reader | `schema.prisma` (E6) + `analytics.service.ts` | the **per-subject trend** "Mon objectif" reads (FR-6) — snapshot-first, live fall-through; **no new metric**. |
| `RemediationPlan` + `RemediationService.remediationProgress({ tenantId, studentId })` (E7-S3) | `schema.prisma` `@@map("remediation_plan")` + `apps/api/.../remediation` | the kind **"ton soutien en {matière}"** progress line (FR-6) — read-only (the student never books). |
| `PERMISSIONS` + `REALM_ROLE_PERMISSIONS` | `apps/api/.../shared/auth/permissions.constants.ts` | where the **thin role-narrowed student permission family** + `REALM_ROLE_PERMISSIONS.student` are added (§5). |
| `SchoolContextService.forUser` + `UserSyncService.ensureUser` | `apps/api/.../shared/auth` | the **server-derived tenant/school/identity** every student read uses (never client-supplied). |
| `/admin|/teacher|/parent` route groups + AppShell (ADR-003) | `apps/web/src/app/…` | the **`/student` route group** is a fourth peer, premium/responsive/WCAG-AA. |

> **Ruling — E8 is a NEW audience with exactly ONE additive schema change (the account link) and ONE new
> architectural decision** (the `student` realm-role activation + the student-self ABAC wall + the
> client/permission posture, deny-by-default, self-only, never peer comparison) → **ADR-021**, authored on
> the **S1 implementation run**. Everything else reuses existing aggregates, the existing ABAC service
> shape, the existing published-only/receipt-scoped reads, and the role-narrowed permission style (E4/E7).

---

## 1. Schema change — ONE additive link (the only E8 migration)

### 1.1 The student↔account link (additive, nullable, `@unique`)

`Student` currently carries `email String?` but **no** account FK (verified against the live schema — the
`userProfileId` you may see nearby is on **`Guardian`**, not `Student`). E8 adds the link so a `student`
JWT resolves to **exactly one** `Student`:

```prisma
model Student {
  id            String   @id @default(uuid()) @db.Uuid
  tenantId      String   @map("tenant_id") @db.Uuid
  schoolId      String   @map("school_id") @db.Uuid
  // … existing columns (firstName, lastName, email, status, customFields, …) …

  // E8 — the learner's login link (additive, nullable). One pupil ↔ one account.
  userProfileId String?  @unique @map("user_profile_id") @db.Uuid

  // … existing relations (school, guardianships, enrollments, grades, …) …
  userProfile   UserProfile? @relation("StudentAccount", fields: [userProfileId], references: [id], onDelete: SetNull)

  @@index([tenantId, schoolId])
  @@map("student")
}
```

And the additive back-relation on `UserProfile` (the only edit to an existing model besides `Student`):

```prisma
model UserProfile {
  // … existing fields/relations …
  studentAccount Student? @relation("StudentAccount")   // E8 — the linked pupil (1:1), additive
}
```

**Decisions / rationale**
- **`@unique` + nullable.** `@unique` guarantees a **single-self** resolution (`findFirst({ where: {
  tenantId, userProfileId: me.id } })` returns the one `Student` or `null`); nullable so every existing
  pupil (no login) is untouched — the change is **expand-only**, no backfill.
- **`onDelete: SetNull`.** Deleting the login does **not** delete the pupil's dossier (and the pupil's own
  `onDelete: Cascade` from `School` is unaffected); the link is severable without data loss. This is the
  **exact `Guardian.userProfileId` precedent** (`String? @unique … SetNull`), so the migration is a known,
  safe shape.
- **`@relation("StudentAccount")`** disambiguator — `Student` and `UserProfile` already have other
  relations; the named relation avoids any collision (the `Guardian`/`TutorUser` precedent).
- **No login-hint / `studentEmail` column needed.** Keycloak owns the credential; the JWT →
  `UserProfile` → `Student` chain resolves identity over the unique link. *(Recorded so a reviewer can
  confirm nothing is missing.)*

### 1.2 Why no other table / column

E8 **reads**; it creates no student-authored record (no booking, no message, no flag — all Non-goals). The
only persistent E8 effect beyond the link is **audit rows** on the existing append-only `AuditLog` (the
admin provisioning the link; optionally a student reading a sensitive surface — §4) — an **insert into an
existing table**, not a schema change. The announcement read reuses the existing `AnnouncementReceipt`
(the student receives a receipt like any recipient — §3); no new receipt shape.

> **Reviewer fallback (recorded, not adopted).** If a reviewer wants a per-cohort portal kill-switch (*"a
> school can disable the student portal"*), the smallest additive shape is a boolean on the **existing**
> `School`/`SchoolSettings` customization layer (ADR-013 settings JSONB — **no new table**), checked at the
> controller. Out of S1–S3 scope; recorded so the minimal-schema baseline is a deliberate decision.

---

## 2. Identity resolution & the student-self ABAC wall (the heart of E8)

This — plus the §1.1 link — is E8's "data model": a **resolution rule** plus a **deny-by-default scope**.

### 2.1 Self-resolution (server-derived, never client-supplied)

```
me            = UserSyncService.ensureUser(jwt)              // the caller's UserProfile (from JWT sub)
{ tenantId }  = SchoolContextService.forUser(me)            // server-derived tenant/school
ownStudent    = prisma.student.findFirst({                  // the ONE student for this account
                  where: { tenantId, userProfileId: me.id },
                  select: { id: true, schoolId: true },
                })
```

- The resolved `ownStudent.id` is the **only** student id any E8 read uses. **No `:studentId` path param
  exists** on `/student/*` endpoints — there is nothing to tamper with (the IDOR surface is structurally
  removed). If a legacy/shared aggregate is reused, the controller passes `ownStudent.id` — a client
  `?studentId=` is **ignored**, not validated.
- `ownStudent === null` ⇒ the kind **"compte non rattaché"** empty state (AC-1 / scenario 7), never a 500,
  never another student's data.

### 2.2 The student-self branch on `StudentAccessService` (deny-by-default, never `null`)

Extend the existing resolution order (admin → teacher → parent) with a **`student`** branch returning a
**single-id, non-null** scope (the opposite of `null` = unrestricted):

```ts
// inside StudentAccessService.scopeForUser(...) — additive branch, highest-privilege-first order kept
if (roles.includes('student')) {
  const self = await this.prisma.student.findFirst({
    where: { tenantId: user.tenantId, userProfileId: user.id },
    select: { id: true },
  });
  return { studentIds: self ? [self.id] : [], reason: 'student-self' };
  //                              ^^^ exactly one id, or [] (no access) — NEVER null (unrestricted)
}
```

- A `student` scope is **never `null`** (the admin/teacher "unrestricted" sentinel) — it is **exactly
  `[ownId]`** or **`[]`**. `canAccessStudent(studentId)` returns true **only** for the caller's own id (the
  existing `scope.studentIds.includes(studentId)` line enforces this once the branch returns a bounded
  array). **A student can never pass the wall for a foreign student.**
- **Deny-by-default:** a `student`-role token on a **parent** endpoint (`students.read` + guardianship)
  fails the guardianship wall (a student is not a guardian); on a **teacher/admin** endpoint it lacks the
  permission. The student reaches **only** the new `*.read.self` endpoints (§5).

> **PM-trap recorded (the E6/E7 caveat discipline).** The danger is a future refactor that treats
> `studentIds: null` as "this role sees everything". The student branch must **never** return `null`. The
> S1 story + the targeted test pin this: *a `student` caller's scope is a bounded one-element array (or
> empty), asserted directly* — so a regression that loosens it fails the gate.

### 2.3 Branch on `StudentAccessService` vs. a dedicated `StudentSelfService` (S1 implementer's call)

Two equivalent shapes (recorded, like E7's `subjectIds[]` vs. `TutorSubject` choice):
- **(A) Additive branch on `StudentAccessService`** (above) — minimal, reuses the existing
  `canAccessStudent` fold; the student scope rides the same service the parent/teacher use. **Preferred**
  (one ABAC service, one place to audit the wall).
- **(B) A dedicated `StudentSelfService.resolveSelf(me): { studentId } | { unlinked }`** the student
  controllers call directly. Cleaner separation, a second service to keep in sync. Acceptable if a
  reviewer prefers an explicit student surface (plan.md §2 sketches this shape).

Either way the **invariant is identical**: server-derived, self-only, deny-by-default, **never `null`**.

---

## 3. Read paths — aggregate endpoints (reuse, resolved to self; no client N+1)

All E8 reads are **aggregate endpoints** under `/api/v1/student/*` (project-context §2, ADR-drift-safe),
each resolving `ownStudent.id` server-side and assembling its full payload by **reusing the parent-side
producer**. **No `:studentId` path param.** See [`contracts/openapi.yaml`](./contracts/openapi.yaml).

| Endpoint | Slice | Reuses | Returns |
|---|---|---|---|
| `GET /student/me` | S1 | `ensureUser` + self-resolve | `{ student: {id, firstName, classSectionName, …} \| null, activated: boolean }` — the activation gate + header identity |
| `GET /student/grades` | S1 | the **published-only** grade read (`grades/students/:studentId/grades`), self-resolved | own **published** grades by subject + teacher comment (read-only; **no draft**) |
| `GET /student/upcoming` | S2 | `AnalyticsService.parentUpcoming`, self-resolved | own upcoming assessments (subject/date/coefficient, soonest first) |
| `GET /student/attendance` | S2 | the per-student attendance feed, self-resolved | own attendance summary + recent records (factual framing) |
| `GET /student/announcements` | S3 | the **receipt-scoped** announcement read + mark-read | the announcements addressed to the student (school/class/level/personal), newest first |
| `GET /student/dashboard` | S3 | E6 `student_subject_snapshot` trend (snapshot-first/live) + FR-4 upcoming + E7 `remediationProgress` | the **"Mon objectif"** composite: own per-subject trend + next assessments + (where present) the kind remediation progress line. **No rank, no class average, no peer data.** |

- **Snapshot-first / live fall-through** (E6 posture) on the dashboard trend — a miss is never an error.
- **Best-effort composition** (E7-S3 posture) on the remediation line — a throw → omit the line, never
  errors the <2 s dashboard.
- **No new metric** — every figure is one the parent surface already computes; E8 *reframes* it
  second-person and **strips every peer-relative field** before it leaves the producer.

> **The peer-comparison wall is in the payload shape, not just the UI.** The student dashboard DTO is a
> **narrowed** projection of the parent dashboard response (the E4 `ParentExportJobDto` narrowing
> precedent) that **structurally lacks** `studentRank` / `classAverage` / `classRankTotal` — so it cannot
> leak them even if the UI is wrong. This omission is the RGPD wall baked into the data shape itself.

---

## 4. ABAC, tenancy, audit & RGPD checklist

- **Tenant scope** — every student read carries explicit `where: { tenantId }` (server-derived; ADR-019
  application-layer isolation). No cross-tenant / cross-school read is possible (the student is resolved
  inside the caller's tenant; the announcement read filters `tenantId + schoolId + scope`).
- **Student-self ABAC (deny-by-default)** — §2: scope = `[ownId]` or `[]`, never `null`; self resolved from
  identity; client-supplied ids ignored. No endpoint loosens an existing permission.
- **Append-only audit** — the **admin provisioning** of the link (`Student.userProfileId` set) writes one
  append-only `AuditLog` row (`action = student.account_linked`, children's-data governance). Optionally, a
  student reading a sensitive surface writes a best-effort `student.read.<surface>` row (parity with how
  sensitive parent reads are logged); light reads (`/student/me`, `/student/announcements`) follow the
  existing surfaces' posture. Audit never blocks a read.
- **RGPD / non-stigmatising** — E8 creates **no new sensitive personal data** (reads only, plus the one
  account link). The student sees **only their own** record, a **subset** of what the parent sees: it
  **excludes** `medicalNotes`, discipline records, draft grades, raw alert-engine internals, and all
  adult-facing analytics; **no peer-relative field ever enters a student payload** (the narrowed DTO, §3);
  copy is encouraging and factual (AC-6). The student-self ABAC is the strictest wall the platform has (the
  data subject reads it), so it is **deny-by-default**, pinned by ADR-021 + the S1 test.
- **No writes** — no student write verb exists (Non-goals): no booking (`remediation.book` never granted to
  `student`), no messaging initiation, no flag/ack/revise/justify. The only mutation a student can make is
  the existing self-scoped announcement receipt mark-read.

---

## 5. Permissions (seed delta) — a thin, read-only, student-scoped family

Add to `apps/api/.../shared/auth/permissions.constants.ts` (the `PERMISSIONS` catalog **and**
`REALM_ROLE_PERMISSIONS.student`), plus `apps/api/prisma/seed.ts` + `seed-demo.ts` (keep aligned). The
names follow the established **`<resource>.<action>.<audience>`** role-narrowed style (the E4
`exports.execute.parent` / `exports.execute.teacher` and E7 `remediation.read|book` precedent):

| Permission | resourceType / action | Granted to | Backs |
|---|---|---|---|
| `grades.read.self` | `grade` / `read.self` | `student` only | FR-3 "Mes notes" |
| `assessments.read.self` | `assessment` / `read.self` | `student` only | FR-4 "Mes prochaines évaluations" |
| `attendance.read.self` | `attendance` / `read.self` | `student` only | FR-4 "Mes présences" |
| `announcements.read.self` | `announcement` / `read.self` | `student` only | FR-5 "Mes annonces" |
| `analytics.read.self` | `analytics` / `read.self` | `student` only | FR-6 "Mon objectif" dashboard + `/student/me` |

```ts
// permissions.constants.ts — additive entries in PERMISSIONS (read-only, student-scoped)
['grades.read.self',        'Lire ses propres notes',          'grade',        'read.self'],
['assessments.read.self',   'Lire ses évaluations à venir',    'assessment',   'read.self'],
['attendance.read.self',    'Lire sa propre assiduité',        'attendance',   'read.self'],
['announcements.read.self', 'Lire les annonces le concernant', 'announcement', 'read.self'],
['analytics.read.self',     'Lire son tableau de bord élève',  'analytics',    'read.self'],

// REALM_ROLE_PERMISSIONS — NEW key, read-only, self-only
student: [
  'grades.read.self',
  'assessments.read.self',
  'attendance.read.self',
  'announcements.read.self',
  'analytics.read.self',
  'profile.read.self',     // existing — read own profile
  // 'profile.write.self', // optional — let a student edit own contact; the strict-read-only default OMITS it
],
```

> **Convention match + the wall.** These are **role-narrowed, read-only** permissions granted **only** to
> `student` — never added to `parent`/`teacher`/`school_admin`; `super_admin` gets them only via the
> existing blanket `PERMISSIONS.map(...)` (harmless). They never widen an existing permission.
> `remediation.book` / `messaging.write` / any `*.write` are **deliberately absent** — the read-only wall
> is in the grant list itself. Whether to grant `profile.write.self` (let a student edit their own contact)
> vs. a fully read-only student is a **recorded S1 choice** (the spec's strict-read-only default omits it).
> **Crucially, a permission alone is necessary-but-not-sufficient — the student-self ABAC (§2) is what
> narrows every read to self; a grant must never imply peer access.**

---

## 6. The new architectural decision → ADR-021 (Winston gate)

E8 introduces **one new cross-cutting decision**: **activating the `student` realm-role + defining the
student-self ABAC wall + the client/permission posture + the account link.** That is a *new architectural
decision* (a new authenticated audience, a new deny-by-default ABAC rule whose subject is the data owner, a
realm-client choice, and a new identity seam) → per project-context §3 it **lands with a new ADR**:
**`docs/adr/ADR-021-student-role-and-self-abac.md`**, authored on the **S1 implementation run** (the slice that
wires the role + the wall + the link + the first read).

The ADR records:
- **(a) Role activation** — the `student` realm-role (already *reserved* in ADR-004/ADR-015) is
  *activated*: realm export entry, JWT `realm_access.roles` read, NestJS role-guard acceptance, and the
  default `REALM_ROLE_PERMISSIONS.student` read-only set (§5).
- **(b) The student-self ABAC wall** — **deny-by-default, self-only, never peer comparison**: scope =
  `[ownStudentId]` or `[]`, **never `null`**; self resolved from identity via `Student.userProfileId ===
  me.id`; client-supplied student ids **ignored**; the peer-comparison wall baked into the **narrowed
  payload shape** (§3), not just the UI. **Why not** reuse `StudentAccessService.canAccessStudent` with a
  client-supplied id (re-introduces IDOR; the student needs single-self resolution, not list-membership).
- **(c) The account link** — the additive nullable **`Student.userProfileId @unique` (`SetNull`)** seam
  (§1.1), mirroring `Guardian.userProfileId`. **Why not** a join table (overkill for a strict 1:1).
- **(d) Client posture** — **why** the student **reuses the existing `portal-parent` OIDC client**
  (ADR-004 "1 realm, 3 clients" upheld — the realm role distinguishes the audience in tokens/logs) and
  **why not** a 4th `portal-student` client (recorded as a future option with its own MFA/branding posture
  — not an S1 requirement).
- **(e) Read-only, RGPD-minimal scope** as a hard boundary; **rejected alternatives** — a per-student
  `student_access`/visibility table (over-engineering — the unique link + the ABAC branch suffice); a
  `null`-scope "student sees their cohort" shortcut (a RGPD violation — explicitly forbidden); a student
  write path / second realm (out of scope / ADR-004 already rejected multi-realm).

The **ADR number is 021** — the highest ADR on disk is `ADR-020-booking-availability-concurrency`, so
**021 is the next free filesystem number** (verify against the index at authoring time, per the E6/E7
reconciliation precedent).

Everything else in E8 is **within existing conventions**: the role-narrowed read-only permission family
(E4/E7), the aggregate-endpoint contract, the self-resolution over the new unique link, the published-only
grade read, the receipt-scoped announcement read, the E6 snapshot trend (snapshot-first / live
fall-through), the E7 plan-progress read (best-effort), the narrowed-DTO projection (E4 `ParentExportJobDto`),
the `/admin|/teacher|/parent` route-group + AppShell (ADR-003), `@pilotage/ui`, `packages/contracts`,
append-only audit. **No other ADR is tripped:** no new HTTP style, no new state lib, no second BullMQ queue,
no new datastore, no new domain event, no new Keycloak client, no payment integration (ADR-018 upheld), no
new metric.

---

## 7. Migration steps (per slice)

> **Slice order is owned by [`spec.md`](./spec.md) / [`tasks.md`](./tasks.md)** (PM). The one
> schema-bearing step is in **S1** (the additive `Student.userProfileId` link); S2/S3 add no schema.

- **S1 (role + ABAC + auth wiring + my-grades):** edit `schema.prisma` — add the additive nullable
  `Student.userProfileId @unique … SetNull` + the `UserProfile.studentAccount` back-relation →
  `prisma generate` → `prisma db push` (additive, no existing column changed). Activate the `student`
  realm-role (realm export + JWT read + role guard); add the §5 permissions to `permissions.constants.ts`
  + `REALM_ROLE_PERMISSIONS.student` + `seed.ts`/`seed-demo.ts`; add the student-self ABAC branch (§2.2);
  add the E8 student DTOs to `packages/contracts`; wire `GET /student/me` (activation gate) +
  `GET /student/grades` (self-resolved, **published-only**); the `/student` route group + AppShell + the
  "Mes notes" view. **Lands with `docs/adr/ADR-021-student-role-and-self-abac.md`** (Winston gate).
- **S2 (upcoming + attendance):** `GET /student/upcoming` (reuse `parentUpcoming`) + `GET
  /student/attendance` (reuse the per-student feed), both self-resolved, + the "Mes prochaines
  évaluations" / "Mes présences" views. **No schema step, no new permission beyond S1.**
- **S3 (announcements + "Mon objectif" dashboard):** `GET /student/announcements` (receipt-scoped; the
  additive recipient rule so the student's own `UserProfile` gets a receipt when a scope reaches them) +
  `GET /student/dashboard` (the narrowed composite: E6 trend + next assessments + the E7 remediation
  progress line, **zero peer comparison**) + the dashboard + announcements views. **No schema step, no new
  permission, no new ADR** (within ADR-021).

### Index / tenancy / RGPD checklist (every slice)
- The new `Student.userProfileId @unique` is itself the index for the self-resolve; the reused reads ride
  the **existing** tenant-first indexes (`Student @@index([tenantId, schoolId])`, the analytics /
  announcement / attendance indexes the parent reads already use). No other new index.
- Every student read: server-derived `tenantId` + self-resolved `studentId`; client ids ignored;
  deny-by-default ABAC; sensitive reads audited; **no peer-relative field in any student payload**.
- No student write verb, no booking, no messaging initiation, no peer comparison, no new sensitive data;
  one additive nullable link as the only schema change — the strictest RGPD posture the platform has,
  pinned by ADR-021.
