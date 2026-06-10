# Story spec — E8-S1: Student role + self-ABAC + auth wiring + "Mes notes" → ADR-021

> **Author:** John (BMAD PM) · **Run mode:** epic-slice · **Epic:** E8 — Student Portal
> **Slice:** S1 · **Risk:** P1 · **Tags:** `[schema][auth]`
> **This file is self-contained.** A developer implements E8-S1 from this story alone. It distills
> `spec.md` (FR-1/2/3/4, AC-1/2/3/7/8), `plan.md` (§2 the spine, §4 ADR-021), and `data-model.md`
> (§1 the link, §2 the wall, §5 the permissions) into one buildable slice, with every claim
> verified against the live code on 2026-06-10 (line numbers below).

---

## 1. Intent (one sentence)

Activate the reserved `student` Keycloak realm-role and stand up a **fourth, read-only** portal
audience — the learner — by adding the single additive `Student.userProfileId String? @unique` account
link, a **deny-by-default student-self ABAC** branch that resolves the caller's own `studentId`
server-side (`[ownId]` or `[]`, never `null`, never a peer), five read-only `*.read.self` permissions
granted to `student` only, a `/student/*` route group reusing the `portal-parent` OIDC client, and the
first read surface **"Mes notes"** (`GET /student/me` + `GET /student/grades`), landing with
`docs/adr/ADR-021-student-role-and-self-abac.md`.

## 2. Why now / value

The learner — the subject of all this data — has no way in. E8-S1 gives a linked student a private,
read-only, kind window into **their own** published grades, reached through their own identity (no path
param to tamper with), proving the security-sensitive wall before any breadth (S2/S3) is added.

## 3. touches

- **touchesBackend: true** — `schema.prisma` (one additive FK), `StudentAccessService` (the student
  branch), `permissions.constants.ts` + `seed.ts` + `seed-demo.ts` (the grant), a new
  `StudentPortalController`/`Service`, `packages/contracts` (the DTOs).
- **touchesUi: true** — the `/student` route group scaffold (AppShell as a fourth portal) + the
  `/student/grades` "Mes notes" page + the unlinked-account activation gate; the web auth/middleware
  routing to honour the `student` role.
- **touchesWorker: false** — no worker, no queue, no cron. Reads only.

---

## 4. Verified ground truth (read before coding — line numbers as of 2026-06-10)

| Claim | Verified in | Note |
|---|---|---|
| `model Student` has **NO** `userProfileId` today | `apps/api/prisma/schema.prisma` lines 430–468 | has `email String?`, `medicalNotes`, relations; the FK must be **added**. |
| `Guardian.userProfileId String? @unique … onDelete: SetNull` precedent | same file lines 471–486 | the **exact shape** to mirror (the parent's auth↔domain join, NOT on Student). |
| Highest ADR on disk = `ADR-020` | `docs/adr/` | **`ADR-021` is the next free number** — confirmed. |
| `StudentAccessService.scopeForUser(user, jwt, schoolId)` returns `{ studentIds: string[] \| null, reason }`; `null` = unrestricted; parent branch = guardianship array; trailing `return { studentIds: [], … }` | `apps/api/src/modules/students/student-access.service.ts` (whole file) | add the **`student` branch BEFORE the final `[]` return**, after the parent branch. `canAccessStudent` folds `null→true` else `includes`. |
| Grade producer: `GET grades/students/:studentId/grades`, non-staff filtered to `status in ['published','revised']` | `apps/api/src/modules/grades/grades.controller.ts` lines 382–417 | reuse this **shape** self-resolved; `seePrivate` is false for `student` → published-only automatically. |
| `PERMISSIONS` catalog + `REALM_ROLE_PERMISSIONS` (no `student` key yet) | `apps/api/src/shared/auth/permissions.constants.ts` lines 5–261 | add 5 rows + a `student:` key. |
| Seed keeps its **own inline** `PERMISSIONS`/`ROLE_PERMISSIONS` (not imported from constants) | `apps/api/prisma/seed.ts` lines ~5–121 | mirror the 5 rows + a `student` role-permission list **in both** `seed.ts` and `seed-demo.ts`. |
| Web `Portal = 'admin'\|'teacher'\|'parent'`; `PORTALS`, `PORTAL_FROM_PROVIDER`, `REALM_ROLES_FOR_PORTAL`, `clientCreds(portal)` | `apps/web/src/auth.ts` lines 20–123 | add `'student'`; student's `clientCreds` must resolve to the **parent** client (see §8). |
| Middleware `PORTAL_REQUIRED_ROLES`, `AUTH_ROUTES_BY_PORTAL`, prefix detection | `apps/web/src/middleware.ts` lines 5–48 | add a `student` portal: required role `['student']`, prefix `/student`, login route. |
| `PortalKey = 'admin'\|'teacher'\|'parent'`; `AppShellRoot`/`PortalShell` keyed by it; sidebars per portal | `apps/web/src/components/shell/sidebar-items.ts` line 42 + `AppShellRoot.tsx` lines 34–149 | add `'student'` to `PortalKey`, a `studentSidebarItems` list, and wire `sidebarItemsFor`/defaults. |

> **The schema reconciliation is settled:** `Student.userProfileId` is **absent** today; S1 **adds** it.
> Do not skip the migration on the mistaken belief it exists, or the wall resolves over a missing field.

---

## 5. Scope — exactly this slice (do NOT build the epic)

### 5.1 Schema (the ONE E8 migration — additive, `db push`)

Edit `apps/api/prisma/schema.prisma`:

```prisma
model Student {
  // … all existing columns unchanged …
  // E8-S1 — the learner's login link (additive, nullable, unique). One pupil ↔ one account.
  userProfileId String?  @unique @map("user_profile_id") @db.Uuid

  // … existing relations unchanged …
  userProfile   UserProfile? @relation("StudentAccount", fields: [userProfileId], references: [id], onDelete: SetNull)

  // existing @@unique / @@index / @@map unchanged
}

model UserProfile {
  // … existing fields/relations unchanged …
  studentAccount Student? @relation("StudentAccount")   // E8-S1 — the linked pupil (1:1), additive
}
```

- **Named relation `"StudentAccount"`** — `Student`/`UserProfile` already share other relations; the
  named relation avoids collision (the `Guardian`/`TutorUser` precedent).
- `@unique` + nullable → single-self resolution, expand-only, **no backfill**, safe on existing rows.
- `onDelete: SetNull` → deleting the login does not delete the dossier (Guardian precedent exactly).
- Then `prisma generate` + `prisma db push` (NO SQL `migrations/` folder — repo convention).
- **This is the only schema change in the entire epic.** S2/S3 add none.

### 5.2 Permissions (seed delta — `permissions.constants.ts` + BOTH seeds)

Add to `PERMISSIONS` (constants + the inline list in `seed.ts` **and** `seed-demo.ts`):

```ts
['grades.read.self',        'Lire ses propres notes',          'grade',        'read.self'],
['assessments.read.self',   'Lire ses évaluations à venir',    'assessment',   'read.self'],
['attendance.read.self',    'Lire sa propre assiduité',        'attendance',   'read.self'],
['announcements.read.self', 'Lire les annonces le concernant', 'announcement', 'read.self'],
['analytics.read.self',     'Lire son tableau de bord élève',  'analytics',    'read.self'],
```

Add a **new** `student` realm-role grant (constants `REALM_ROLE_PERMISSIONS.student` + the seeds'
`ROLE_PERMISSIONS.student`) — **read-only, zero writes:**

```ts
student: [
  'grades.read.self',
  'assessments.read.self',
  'attendance.read.self',
  'announcements.read.self',
  'analytics.read.self',
  'profile.read.self',         // read own profile (existing perm)
  // NO profile.write.self by default (strict read-only; recorded choice, ADR-021)
],
```

- These five are granted **ONLY** to `student` (and to `super_admin` via the existing
  `PERMISSIONS.map(...)` blanket — harmless). **Never** added to `parent`/`teacher`/`school_admin`.
- `remediation.book`, `messaging.write`, any `grades.*`/`*.write` are **deliberately absent**.
- The S1 grant family is `grades.read.self` + `analytics.read.self` (the two S1 endpoints use them).
  The other three are seeded now (one schema/seed pass) but consumed in S2/S3 — seed all five in S1.

### 5.3 ABAC — the student-self branch (the load-bearing wall)

In `StudentAccessService.scopeForUser` (`apps/api/.../students/student-access.service.ts`), add a
`student` branch **after** the `parent` branch and **before** the final `return { studentIds: [], … }`:

```ts
if (roles.includes('student')) {
  const self = await this.prisma.student.findFirst({
    where: { tenantId: user.tenantId, userProfileId: user.id },
    select: { id: true },
  });
  // EXACTLY one id, or [] (no access) — NEVER null (which means unrestricted).
  return { studentIds: self ? [self.id] : [], reason: 'student-self' };
}
```

- **Invariant (must be pinned by test):** a `student` scope is **never `null`**, it is `[ownId]` or
  `[]`. `canAccessStudent(ownId)` is true only for the caller's own id.
- Existing admin/teacher/parent branches **unchanged**.
- (Acceptable alternative recorded in `data-model.md` §2.3: a dedicated `StudentSelfService`. Prefer the
  branch — one ABAC service, one audit surface.)

### 5.4 API — the student portal module (recommended shape: a new composing controller)

Create `apps/api/src/modules/student-portal/` (a new thin module under `JwtAuthGuard, PermissionsGuard`),
prefix `@Controller('student')`. **Every route resolves self server-side; NO `:studentId` path param.**

A shared self-resolver (private method or injected service) used by every route:

```ts
// me = await this.users.ensureUser(jwt);  (UserSyncService, existing)
// ownStudent = await this.prisma.student.findFirst({
//   where: { tenantId: me.tenantId, userProfileId: me.id },
//   select: { id: true, firstName: true, lastName: true, schoolId: true },
// });
// ownStudent === null → activation gate (NOT an error)
```

**`GET /student/me`** — `@RequiresPermission('analytics.read.self')` — the activation gate + header
identity. Returns:

```jsonc
{
  "student": { "id": "...", "firstName": "...", "lastName": "...", "classSectionName": "3e B" } | null,
  "activated": true | false   // false ⇔ student === null (no linked Student)
}
```
- `classSectionName` is best-effort from the student's active enrollment (omit/null if none).
- **Never** includes `medicalNotes`, discipline, guardian-private fields, draft data.

**`GET /student/grades`** — `@RequiresPermission('grades.read.self')` — "Mes notes". Flow:
1. `me = ensureUser(jwt)`; `ownStudent = findFirst({ tenantId, userProfileId: me.id })`.
2. `ownStudent === null` → return `{ data: [] }` (the page renders the activation gate via `/me`).
3. `await studentAccess.canAccessStudent(me, jwt, ownStudent.id, ownStudent.schoolId)` **before** the read
   (defence-in-depth — it returns true only for own id).
4. Read **published-only** grades grouped by subject, tenant-scoped, **one query, no N+1**:
   ```ts
   await this.prisma.grade.findMany({
     where: {
       studentId: ownStudent.id,
       tenantId: me.tenantId,
       status: { in: ['published', 'revised'] },   // NEVER draft — RGPD/read-only
     },
     include: {
       assessment: {
         include: {
           teachingAssignment: { include: { subject: { select: { id: true, name: true, color: true } } } },
           term: { select: { id: true, name: true } },
         },
       },
     },
     orderBy: { assessment: { scheduledAt: 'desc' } },
   });
   ```
   This mirrors `grades.controller.ts` lines 397–415 with `seePrivate=false` hard-wired (a student is
   never staff). Return `{ data: grades }` (or a narrowed projection — see §6 wall).
- **A client `?studentId=` is ignored** — there is no param and the where-clause uses `ownStudent.id`.

> **Module placement is the implementer's call** (plan.md §2): (a) new `StudentPortalController`
> composing existing producers — **recommended** (one wall, one audit surface, parent controllers
> untouched); or (b) student-walled routes on existing controllers. Either way every route runs
> `canAccessStudent(ownStudentId)` before returning data.

### 5.5 Provisioning audit (append-only)

When `Student.userProfileId` is set (seed/import for the MVP — **no provisioning UI** in scope), write
**one** append-only `AuditLog` row: `action = 'student.account_linked'`, `resourceType = 'student'`,
`resourceId = student.id`, `after = { userProfileId }`, tenant-scoped, best-effort (never blocks).
In the seed/import path that links the demo student, emit this row. (Reads follow the existing surfaces'
best-effort posture; light reads like `/student/me` need no audit row.)

### 5.6 Contracts (additive, `packages/contracts`)

Add additive E8 student DTO types (no breaking change to existing exports):
`StudentMeResponse { student: StudentHeader | null; activated: boolean }`,
`StudentHeader { id; firstName; lastName; classSectionName? }`,
and a `StudentGradesResponse { data: StudentGradeRow[] }` (reuse/narrow the existing grade-row shape).
These DTOs **structurally lack** every peer-relative field (no `studentRank`/`classAverage`/`classSize`).

### 5.7 Web — the `/student` route group (fourth portal)

1. **`auth.ts`** — extend `Portal` to include `'student'`; add `'student'` to `PORTALS`,
   `REALM_ROLES_FOR_PORTAL.student = ['student']`. **Reuse the parent client:** make
   `clientCreds('student')` resolve to the **parent** client id/secret (e.g. special-case `student` →
   read `KEYCLOAK_PARENT_CLIENT_ID`/`_SECRET`, falling back to `portal-parent`). Add a
   `keycloak-student` provider entry to `PORTAL_FROM_PROVIDER` **only if** an OIDC redirect flow is wired
   for it; the demo path uses the credentials provider, which only needs `PORTALS` + `REALM_ROLES_FOR_PORTAL`
   + `clientCreds`. **Do NOT add a new Keycloak client** — ADR-021 records the reuse decision.
2. **`middleware.ts`** — add `student` to `PORTAL_REQUIRED_ROLES` (`['student']`), the `/student` prefix
   detection, and `AUTH_ROUTES_BY_PORTAL.student = ['/student/login']`. The existing three portals
   unchanged.
3. **`sidebar-items.ts`** — extend `PortalKey` to include `'student'`; add `studentSidebarItems`
   (S1 entries: `{ key:'grades', label:'Mes notes', href:'/student/grades' }`; a dashboard placeholder/
   home can point at `/student/grades` for S1 since the dashboard ships in S3); wire `sidebarItemsFor`.
4. **`AppShellRoot.tsx` / `PortalShell.tsx`** — accept `'student'` in the `Portal`/`PortalKey` union;
   add `PORTAL_DEFAULT_TITLE.student` / `PORTAL_DEFAULT_SUBTITLE.student`; the `else` branch already
   handles non-admin flat sidebars (`sidebarItemsFor`).
5. **`apps/web/src/app/student/`** route group:
   - `student/login/page.tsx` — a login page (reuse the parent login form pattern, `portal="student"`).
   - `student/grades/page.tsx` — **"Mes notes"**: server component, `force-dynamic`, fetches
     `GET /api/v1/student/me` + `GET /api/v1/student/grades`, renders published grades by subject
     reusing `@pilotage/ui` (`PageHeader`, `KpiCard`, `EmptyState`, `formatGrade`, `gradeBucket`,
     and the parent `GradeRow` pattern). **No `ChildSelector`** (there is exactly one self).
   - **Unlinked activation gate:** when `/student/me` returns `activated: false`, render a kind
     `EmptyState` — *« Ton dossier n'est pas encore activé — contacte ton établissement. »* — never a
     crash, never another student's data.

### 5.8 ADR (Winston gate — lands this slice)

Author `docs/adr/ADR-021-student-role-and-self-abac.md` (status Accepted) recording:
(a) **role activation** — the reserved `student` realm-role is activated (realm/JWT/guard/default perms);
(b) **the student-self ABAC** — deny-by-default, self-only, `[ownId]`/`[]` **never `null`**, self resolved
from `Student.userProfileId === me.id`, client ids ignored, the peer wall baked into the **narrowed
payload shape**; (c) **the account link** — additive `Student.userProfileId @unique` (`SetNull`),
mirroring `Guardian`, why-not a join table; (d) **client posture** — reuse `portal-parent`, why-not a 4th
`portal-student` client (recorded alternative, future MFA option); (e) **read-only, RGPD-minimal** as a
hard boundary; rejected alternatives (2nd realm, custom app role, permissive unlinked default, a student
write path). Add a one-line "(activated by ADR-021)" note to the `student (futur)` mentions in ADR-004 +
ADR-015.

---

## 6. The peer-comparison wall (RGPD — in the SHAPE, not just the UI)

Every student payload **structurally lacks** `studentRank`, `classAverage`, `classRankTotal`, class size,
roster, any other-child datum (the E4 `ParentExportJobDto` narrowing precedent). For S1 the grades
payload carries only the caller's own grades; `/student/me` carries only own identity + class name. No
peer-relative figure can leak even if a UI is wrong. **No student read ever returns peer data, a roster,
or a ranking.**

---

## 7. Acceptance criteria (this slice)

1. **AC-1 (schema).** `Student.userProfileId String? @unique @db.Uuid` (`onDelete: SetNull`) +
   `UserProfile.studentAccount` back-relation land additively via `db push`; no existing column changes
   shape; safe on existing rows (null link until provisioned). `prisma generate` succeeds.
2. **AC-2 (the wall — must have a targeted test).** `StudentAccessService.scopeForUser` for a `student`
   caller returns `{ studentIds: [ownId] }` when linked and `{ studentIds: [] }` when unlinked —
   **never `null`, never a peer id** (asserted directly). `canAccessStudent` is true only for the own id.
   The `studentId` is server-resolved (no path param); a client-supplied id is **ignored**, not validated.
   A `student` token on a parent/teacher/admin endpoint is **denied** (missing permission + the existing
   guardianship/teaching wall).
3. **AC-3 (Mes notes).** `GET /student/grades` returns the caller's **published** (`published`/`revised`)
   grades by subject + teacher comment, tenant-scoped, one query (no N+1); **no draft** grade; read-only
   (no student write verb reachable). A student with **no linked `Student`** gets `activated:false` →
   a kind empty/activation state, **not** an error/500.
4. **AC-4 (auth routing).** A `student`-role login is routed to `/student/*` (not `/parent/*`); the
   `/student` middleware requires the `student` role; the existing three portals are unchanged; **no new
   OIDC client** is added (the `portal-parent` client is reused).
5. **AC-5 (permissions).** The five `*.read.self` permissions exist in the catalog and both seeds and are
   granted to `student` **only**; `student` carries **zero** write permissions; no existing permission is
   widened.
6. **AC-6 (RGPD / non-stigmatising).** The student read **excludes** `medicalNotes`/discipline/draft
   grades/guardian-private fields; the payload **structurally lacks** every peer-relative field; FR copy
   is kind/factual (no "échec/nul/dernier/classement"); the provisioning link write is audited
   (`student.account_linked`).
7. **AC-7 (ADR).** `docs/adr/ADR-021-student-role-and-self-abac.md` lands with the role activation,
   `portal-parent` client reuse (vs a 4th client), the `Student.userProfileId` link, the deny-by-default
   self-ABAC, and the permission-narrowing rationale; ADR-004/015 "(futur)" notes updated.
8. **AC-8 (no regression).** No parent/teacher/admin capability is moved/loosened/removed; the parent
   action loop is untouched; the only schema touch is the one additive link.

## 8. Out of scope (S2/S3 + non-goals)

Upcoming assessments + attendance (S2); announcements + the "Mon objectif" dashboard (S3); **any student
write** (no flag/ack/revise/justify, no booking — `remediation.book` never granted to `student`, no
messaging initiation); any provisioning UI; a 4th `portal-student` OIDC client (unless a reviewer chooses
it in ADR-021); any peer comparison/rank/roster; a second realm/queue/datastore/metric.

## 9. Pre-mortem → extra acceptance (Critic lens)

- **PM-1 — `null` scope regression.** A future refactor treats `studentIds: null` as "sees everything".
  *Mitigation/AC:* the targeted test asserts the `student` scope is a **bounded array** (`[ownId]` or
  `[]`), never `null` — a loosening fails the gate. (AC-2)
- **PM-2 — IDOR via a reused aggregate.** A reused parent endpoint accepts `?studentId=`. *Mitigation/AC:*
  `/student/*` has **no** `:studentId` param; the controller passes `ownStudent.id`; a supplied id is
  ignored. (AC-2)
- **PM-3 — unlinked crash/leak.** An unlinked `student` login 500s or falls through to peer data.
  *Mitigation/AC:* `findFirst → null → activated:false → []` → kind gate; tested. (AC-3)
- **PM-4 — draft leak.** A student sees an unpublished grade. *Mitigation/AC:* `status in
  ['published','revised']` hard-wired (no `seePrivate` branch for `student`). (AC-3)
- **PM-5 — migration skipped.** The dev believes `userProfileId` exists. *Mitigation/AC:* §4 + §5.1
  verified-absent note; the wall query references a real column or `prisma generate` fails. (AC-1)
- **PM-6 — permission over-grant.** A `*.read.self` perm leaks onto `parent`. *Mitigation/AC:* granted to
  `student` only in both seeds; reviewed. (AC-5)

## 10. Targeted test (Murat — the single most valuable)

`apps/api/.../students/student-access.service.spec.ts` (or a student-portal spec): given a `student`-role
jwt, assert `scopeForUser` returns `{ studentIds: [ownId] }` when a `Student.userProfileId === me.id`
exists, `{ studentIds: [] }` when none, **and never `null`**; and `canAccessStudent` is true for `ownId`,
false for any foreign id. This pins the load-bearing invariant of the whole epic.

## 11. Demo (quickstart)

1. Apply the migration (`db push`) + reseed so a demo `Student` is linked to a `student`-role
   `UserProfile`. 2. Log into `/student/login` as that student → routed to `/student/grades`.
3. See **only** your own published grades by subject. 4. Confirm there is no studentId to supply and no
   peer/rank anywhere. 5. Log in as an **unlinked** student → the kind activation gate, no crash, no data.
