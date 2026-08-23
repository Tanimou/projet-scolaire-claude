# ADR-061 — The attendance READ paths gain the ABAC their WRITE paths already have

- **Status** Accepted
- **Date** 2026-08-23 (run 71)
- **Story** `S-E05-5` — [`docs/spec/features/v3-e05/stories/S-E05-5.md`](../spec/features/v3-e05/stories/S-E05-5.md)
- **Epic** `V3-E05` — AuthN/AuthZ hardening and permission integrity (layer L0)
- **Closes** `PF-07` (on the WHO axis; see §D6) · **Raises** `PF-264` … `PF-274`
- **Supersedes** the audit sentence of `PF-07` — see §D0
- **Related** `ADR-015` (permission model) · `ADR-013`/`ADR-047` (custom roles are global) ·
  `ADR-032 §D5` / `ADR-042 §D1` (the owner connection escapes its own RLS) · `ADR-048 §D9` (no
  cross-tenant existence oracle) · `ADR-051 §D1` (`findForUser`, the read-only identity seam)

---

## Context

`apps/api/src/modules/attendance/attendance.controller.ts` carries eight handlers behind
`JwtAuthGuard` + `PermissionsGuard`. Its own ABAC helper, `assertOwnership`, was called on **exactly
three** of them — `listSessions`, `openSession`, `batch`, all write-shaped. Four **read** handlers
carried a `tenantId` comparison and nothing else, and a fifth handler (`justify`) is an unguarded
**mutation** (§D5).

## D0 — The audit sentence is SUPERSEDED, not merely confirmed

`PF-07` reads *"Two attendance read endpoints have no teacher ABAC — any teacher reads any class's
roster and student PII."* Re-measured against `HEAD` before a line was written, that undercounts on
**both** axes, and a future reader would otherwise trust it.

**It is four handlers, not two.**

| Handler | Route | Permission | What an unauthorised caller received |
|---|---|---|---|
| `sessionDetail` | `GET /class-sessions/:id` | `class_sessions.read` | the whole class as **full `Student` rows**, twice over (`enrollments{include:{student}}` **and** `attendanceRecords{include:{student}}`) |
| `roster` | `GET /class-sessions/:id/roster` | `attendance.read` | a full `Student` row per active enrolment |
| `studentAttendance` | `GET /attendance/students/:studentId` | `attendance.read` | one student's entire attendance history — the guardianship branch fires **only** `if (roles.includes('parent'))`, so every other audience skipped it |
| `overview` | `GET /attendance/overview` | `attendance.read` | the **establishment-wide** 50 most recent records, names attached |

**And the exposed audience includes `parent`, not only `teacher`.** `permissions.constants.ts`
grants `class_sessions.read` (`:264`) and `attendance.read` (`:265`) to `parent`. So handlers 1, 2
and 4 were reachable **today** by any authenticated parent of the establishment.

**A full `Student` row is not "PII".** It is `medicalNotes`, `address`, `notes`, `customFields`,
`birthDate`, `email`, `phone`, `gender`, `nationality` (`schema.prisma:488`) — RGPD
special-category data about **other families' children**, handed to a parent who asked for a class
id. This is the project's hardest stated constraint (`bmad/GUARDRAILS.md` §1 — children's data,
minimal access) breached by a read with no ABAC at all. `PF-07`'s severity is **raised**.

## Decision

Give the four read handlers the same ownership rule their write siblings already enforce, using the
house shape: **resolve identity outside, compare purely inside**
(`lessons.controller.ts:114` `assertOwnedByTeacher`). Seven symbols are exported from the
controller and tested directly, with no Nest testing module:

`AttendanceReadContext` · `isPrivilegedAttendanceCaller` · `assertSessionReadable` ·
`assertEstablishmentOverviewReadable` · `assertStudentAttendanceReadable` ·
`teacherOfStudentWhere` · `teacherOfStudentAssignmentWhere`.

No permission code is added, removed or re-granted; no route is added or removed
(`scripts/boot-route-baseline.json` is byte-unchanged); no `schema.prisma` or SQL change.

---

## D1 — The teaching wall constrains the ACADEMIC YEAR, and it therefore takes TWO statements

The platform already answers *"does this teacher teach this child?"* twice —
`messaging.service.ts:90` and `remediation.service.ts:912` (whose docblock says it *"mirrors
messaging exactly"*). **Both constrain the academic year.** This copy does too.

The constraint is not cosmetic. `TeachingAssignment`'s uniqueness is
`@@unique([teacherProfileId, classSectionId, subjectId])` — **`academicYearId` is not in the key** —
so assignment rows *survive year rollover*. A predicate that asked only "an `active` enrolment in a
`classSection` the caller is assigned to teach" would let a teacher who had `6ème B` two years ago
read that class's **current** attendance history. A story that narrows an over-broad read must not
ship a wall broader than the platform's own two-year-old definition of the same relation, least of
all on children's attendance.

Prisma cannot correlate `classSection.teachingAssignments.some.academicYearId` to
`enrollment.academicYearId` inside one `where` — a correlated field reference does not exist in
`EnrollmentWhereInput`. So the wall is **two statements**, exactly as the two existing copies are:

1. `enrollment.findFirst(teacherOfStudentWhere(…))` → `{ classSectionId, academicYearId }`.
   Carries `tenantId`, `status: 'active'`, `academicYear: { status: 'active' }`, **and** the
   relational pre-filter `classSection.teachingAssignments.some({ tenantId, teacherProfileId })`
   that the story pinned. The pre-filter is not sufficient on its own — it is the second statement
   that closes the year — and it is kept because it narrows the candidate set to classes the caller
   touches at all and is directly asserted by the spec.
2. `teachingAssignment.findFirst(teacherOfStudentAssignmentWhere(…))` → pins the
   `(classSectionId, academicYearId)` pair on the caller.

**Two declared divergences from the existing copies, stated rather than left to be discovered.**

- **The join key.** Both existing copies take a `UserProfile` id and join
  `teacherProfile: { userProfileId }`; messaging's comment insists it is *"NEVER compared to a
  `TeacherProfile` id"*. `AC-6` forces `TeacherProfileService.findForUser`
  (`teacher-profile.service.ts:94`), which returns a **`TeacherProfile` id**, so the comparison here
  is direct. `findForUser` wins because it is the read-only seam `ADR-051 §D1` built precisely so an
  authorization path cannot provision. The two joins are equivalent.
- **No `try/catch → false`.** Both existing copies swallow every error into a denial. `PF-248`
  already records that as a defect: an infrastructure fault renders as a genuine ABAC refusal,
  undiagnosable. Errors propagate here. Copying the catch would have reproduced a **recorded open
  finding** inside the fix for another one.

**Consolidating the three copies is deliberately out of scope** — it crosses `messaging`,
`remediation` and `attendance`, and remediation's copy runs inside a `TenantScopeService` scope
while messaging's runs on the owner connection, so a shared helper must first decide the connection
question. → **`PF-270`**.

**Both `tenantId` clauses in each `where` are explicit and neither is redundant.** Today's
deployments run the `degraded_no_app_url` path, where the owner connection escapes its own RLS
policies (`ADR-032 §D5` / `ADR-042 §D1`): these clauses are the only thing that filters.

## D2 — Guard read, then payload read

`sessionDetail` and `roster` issued **one** deep `findUnique` and checked the tenant afterwards. The
deep `include` **is** the sensitive payload; materialising it into the process for a caller who is
about to be refused is the defect, not a detail of ordering. Both handlers now take the shape:

```
guard   = classSession.findUnique({ where: { id }, select: { id, tenantId, teacherProfileId } })
        → null or foreign tenant ⇒ NotFoundException()   // unchanged bare 404
        → assertSessionOwnership(...)                    // findForUser + pure comparator
payload = the existing deep read, UNCHANGED
```

Two statements where there was one, both reads, same request — no consequential TOCTOU. The
payload's own `if (!s || s.tenantId !== me.tenantId)` is **kept** although it is now unreachable in
practice: it costs one comparison and removes any argument about a window between the two reads. A
French comment says so, so a later reader does not "tidy" it away.

Cost: one primary-key `findUnique` selecting three scalar columns. `GET /class-sessions/:id` has
**no first-party caller at all**.

## D3 — Ownership is compared against `classSession.teacherProfileId`

`ClassSession` carries **both** `teachingAssignmentId` and a denormalised `teacherProfileId`
(`schema.prisma:1129-1130`). We compare the **denormalised column**, for a correctness reason and
not a preference:

- it is what the three existing `assertOwnership` call sites already trust — `batch` passes
  `session.teacherProfileId`;
- `openSession` writes it from `a.teacherProfileId`, so the two agree by construction;
- the teacher workspace calls `POST /class-sessions/open` (`actions.ts:19`) and then
  `GET /class-sessions/:id/roster` (`actions.ts:28`) on the same session. If the read predicate came
  from a *different* column than the write predicate, a drifted row would 403 the roster of a
  session the same teacher may legally write — turning a hardening slice into an outage on its only
  caller. **Read and write must refuse on the same bit.**

**Residual, measured rather than assumed.** `teaching-assignments.controller.ts` `update` (`:191`)
cannot rewrite `teacherProfileId` — its `data` carries only `weeklyHours`, `isMainTeacher`, `role` —
so the two columns cannot diverge *through the application* today. **Nothing in the database
enforces the equality**: no FK, no CHECK. This slice makes the denormalised column
authorization-bearing on four handlers, so a future backfill, import or admin tool that writes one
without the other becomes a silent ABAC divergence. → **`PF-271`**.

## D4 — 404 before 403, on every changed handler

Tenant/existence first (`NotFoundException`), ownership second (`ForbiddenException`) — the order
`listSessions` and `batch` already used. Inverting it would make the new 403 an **existence oracle**
for another tenant's session and student ids (`ADR-048 §D9`), precisely the class of leak this epic
exists to close. A foreign-tenant id still returns a **bare 404**, indistinguishable from a
nonexistent one, and three tests assert it (`AC-10`).

The residual, stated: **within** a tenant, an id the caller does not own now answers 403 while an
unknown id answers 404 — a same-tenant existence oracle newly present on two routes and
pre-existing on `studentAttendance`'s parent branch. Same-tenant, hence P3, and consistent with the
`lessons` house pattern: fix it there or nowhere. → **`PF-272`**.

## D5 — `overview` is refused BEFORE `ensureUser`, and its permission no longer describes its audience

The decision needs only the token, so it is taken before any database contact:

```ts
assertEstablishmentOverviewReadable({ isPrivileged: isPrivilegedAttendanceCaller(roles) });
const me = await this.users.ensureUser(jwt);
```

Placing it first also means a refused caller no longer reaches `ensureUser`, whose adoption branch
can **write** — a free reduction of the same "write on a refusal path" class `PF-265` records.

**The consequence this creates for the first time, recorded rather than hidden.**
`PermissionsGuard` resolves through `users.effectivePermissions(jwt.sub, realmRoles)`, which honours
**custom roles** (`ADR-013`, `ADR-047` — custom roles are global). A tenant that mints a « vie
scolaire »/CPE custom role holding `attendance.read` passes the guard and is then refused by the
handler's realm-role literal. So `@RequiresPermission('attendance.read')` on `overview` no longer
describes who may call it. The honest fix is a dedicated `attendance.read.establishment` code, which
`AC-9` forbids in this slice and `ADR-015` owns. **Measured 2026-08-23 on the local stack:
`select count(*) from role` → 0, and 0 custom grants of `attendance.read` /
`class_sessions.read` / `attendance.justify` — so the live outage risk is empirically nil today**,
and can become non-nil without a deploy because `roles.write`/`roles.assign` are `school_admin`
grants. → **`PF-268`**.

The realm-role literal itself is reused, not invented: it is house convention at ~19 sites
(`announcements`, `calendar`, `grades`, `assessments`, `lessons`, and `attendance.controller.ts`'s
own `assertOwnership`). Inventing a cross-cutting privilege seam here would be a new architectural
decision, and it belongs with the D1 consolidation.

Also corrected in this file, comment-only: `justify`'s docblock claimed *"admin or teacher of the
class"* while the handler performs **no** ownership check. That is a `DNC-06`-shaped promise inside
the file under change, so the comment now describes what executes. **The missing check itself is a
write-handler change and stays out of this read slice** → `PF-267`.

## D6 — What `PF-07` closed, and what it did NOT

**`PF-07` is closed on the WHO axis only.** The four handlers now refuse the audiences that had no
business reading them. **The WHAT axis is carried forward**: `roster` and `sessionDetail` still
return `include: { student: true }`, i.e. the whole `Student` row — `medicalNotes`, `address`,
`notes`, `customFields` — to the *owning* teacher on every attendance-taking page load. An
attendance roster needs `{ id, firstName, lastName, externalRef, photoUrl }`. That is RGPD
data-minimisation (`GUARDRAILS.md` §1), it changes a response contract consumed by
`teacher/classes/[id]/attendance`, and it is out of this slice. → **`PF-269` (P1)**. `PF-07`'s row
may not read `closed` without this sentence.

## D7 — Byte-identity of the parent path was chosen over the more correct rule, and `PF-266` is the price

`studentAttendance`'s audience order is **`parent` → privileged → teacher → refuse**, and the
`parent` branch is frozen to the byte: same `roles` read, same `findFirst`, same `where`, same
**naked** `ForbiddenException()`, same position. `AC-4` demands it, three parent pages are the
regression surface, and the cheapest way to keep them is to not touch the branch.

**Two consequences, both deliberate.**

1. A caller holding **both** `parent` and `teacher` takes the parent branch and is refused a pupil
   they teach. That is today's behaviour, unchanged, reachable by no first-party caller. The honest
   fix is to evaluate all three predicates and OR them, which cannot be done while `AC-4` demands
   byte-identity. → **`PF-266`**.
2. **`parent` deliberately precedes `privileged`.** A `school_admin` who is *also* a parent takes
   the guardianship branch today and is limited to their own children. The "natural" resolver
   `privileged → guardian → teacher` would silently **grant that caller cross-family access**,
   inside a story whose `AC-4` promises the parent path is unchanged. A slice that narrows four
   handlers must not widen a fifth path on its way past. Two tests pin the order — `['parent',
   'teacher']` and `['parent', 'school_admin']`, both non-guardians, both receiving the **parent**
   refusal (a bare 403 with no message) — so a future "tidy-up" that reorders the switch goes red.

`assertStudentAttendanceReadable` still takes all three booleans, and the teacher branch passes
`isGuardian: false` honestly: on that branch the caller is not a parent, so guardianship was never
consulted. The parameter exists so the pure function states the **complete** rule in one place and
is tested on all eight boolean triples.

---

## Consequences

**Positive.** Four read handlers stop being reachable by an audience with no relationship to the
children whose data they return. The sensitive payload is no longer materialised for a caller about
to be refused. Every new authorization decision is an exported pure function with a direct test, and
the ownership resolution is read-only (`AC-6`) — no refusal path provisions a `TeacherProfile`.

**Negative / accepted.** One extra scalar `findUnique` per `sessionDetail` / `roster` call; one
extra `findFirst` on the (caller-less) teacher branch of `studentAttendance`. A custom role holding
`attendance.read` is now refused `overview` (`PF-268`, empirically nil today). The denormalised
ownership column becomes authorization-bearing with no database constraint behind it (`PF-271`).

**Two findings surfaced while implementing, neither actionable here.** `super_admin` is **not** a key
of `REALM_ROLE_PERMISSIONS` (its keys are `school_admin`, `teacher`, `parent`, `student`), so a
caller holding only `super_admin` is refused by `PermissionsGuard` before any handler runs and every
`roles.includes('super_admin')` short-circuit in the codebase is unreachable in practice — kept here
for symmetry with the ~19 other sites, but **not** claimed as a tested audience → `PF-273`. And the
teacher error banner that will now render the new 403
(`apps/web/src/app/teacher/classes/[id]/attendance/AttendanceManager.tsx:124`) carries no
`role="alert"`, so a teacher on a screen reader gets no announcement when the refusal replaces the
roster they expected — pre-existing, WCAG 2.2 AA §4.1.3, and `apps/web` is outside this agent's file
set → `PF-274`.

**Not proven by this slice, stated plainly.** No jest, no `pnpm typecheck` and no build were run by
the implementing agent (budget: only the test-architect runs the chain). `apps/api` has no e2e
coverage of attendance at all, so `attendance-read-abac.spec.ts` is the only net. Nothing here is
claimed for `pilotage.srv861861.hstgr.cloud`, which was not contacted.

## Findings raised

`PF-264` (P1) · `PF-265` (P2) · `PF-266` (P3) · `PF-267` (P3) · `PF-268` (P2) · `PF-269` (P1) ·
`PF-270` (P2) · `PF-271` (P3) · `PF-272` (P3) · `PF-273` (P3) · `PF-274` (P2) — recorded in
[`traceability/OPEN.md`](../daily-improvement-v3/traceability/OPEN.md) and
[`audit-findings-index.md`](../daily-improvement-v3/audit-findings-index.md).
