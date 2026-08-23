# ADR-063 — The enrollments roster gains an ownership wall and a projection, and the year clause is deliberately NOT copied

- **Status** Accepted
- **Date** 2026-08-23 (run 73)
- **Story** `S-E05-14` — [`docs/spec/features/v3-e05/stories/S-E05-14.md`](../spec/features/v3-e05/stories/S-E05-14.md)
- **Epic** `V3-E05` — AuthN/AuthZ hardening and permission integrity (layer L0)
- **Closes** `PF-278` (P1, **on this handler — not on the exposure class**, see §D6) · `PF-280` (P1)
- **Advances** `PF-51` — **partial, ONE site** (`roster`'s `classSectionId` path parameter). Never claimed closed.
- **Raises** `PF-281` · `PF-282` · `PF-283`
- **Predecessors** `ADR-061` (`S-E05-5`, PR #264) — the WHO axis, attendance · `ADR-062` (`S-E05-6`, PR #265) — the
  WHAT axis, attendance
- **Related** `ADR-015` (permission model) · `ADR-048 §D9` (refusal-message discipline, 404 before 403) ·
  `ADR-051 §D1` / `PF-265` (`findForUser`, never `ensureForUser`, on a refusal path) · `ADR-062 §D1` (`photoUrl`
  refused on measurement) · `ADR-062 §D3` (no cross-module shared projection) · `ADR-032 §D5` / `ADR-042 §D1`
  (`degraded_no_app_url`: the owner connection escapes its own RLS policies) · `GUARDRAILS.md` §1 (children's data,
  minimal access, non-negotiable)

---

## Id arbitration — three allocations named `PF-280`, resolved by MEANING

The story spec, the architecture ruling and the pre-mortem each allocated `PF-280` to a **different** subject. The
house rule for a colliding id (`PF-185`/`PF-186`, runs 53/54) is to arbitrate **by meaning**, never by date, and to
record the arbitration where the id is cited from source. It is recorded here:

| Id | Subject | Status | Why this one |
|---|---|---|---|
| `PF-280` | the roster response emitted the **whole `ClassSection` row**, `internalNotes` + `options` included | **closed by this slice** | The story spec (the operator override) is the authority, and its `AC-10` and `AC-16` name `PF-280` as the payload finding that closes here. The override wins outright |
| `PF-281` | `TeacherProfileService.findForUser` ignores `TeacherProfile.active`, so a deactivated teacher keeps every ABAC verdict it feeds | open, P2 | Both the architecture ruling and this ADR use `PF-281` for it; the pre-mortem’s competing use is the payload finding, already `PF-280` above |
| `PF-282` | `ADR-060` is absent from `docs/adr/` (the sequence runs 059 → 061), while `docs/adr/` is a citation namespace across `apps/api` docblocks | ~~open, P3~~ **closed-by-other-work** | Uncontested  **CORRECTION 2026-08-23, at the land pass:** `#263` (`S-E01-1l`, the ADR-060 author) merged mid-run; `ls docs/adr/` now lists `ADR-060-alerts-tenant-scope-and-the-returning-privilege.md`. `PF-282` is `closed-by-other-work`, not open — it was measured against a `main` from which a HELD PR was absent.|
| `PF-283` | `GET /enrollments?classSectionId=<id>` (`:122`) is the same peer-enumeration door, **with no ABAC** — the exposure class this slice does not close (§D6) | open, P1 | Both the ruling and the pre-mortem wanted `PF-280` for it; `PF-280` is taken by the payload finding above, so it moves to the next free number. Renumbered by meaning, subject unchanged |

---

## Context

`S-E05-5` and `S-E05-6` closed both axes of the same defect in `attendance`. **The identical defect was still
live one module over**, on a handler with the same name.

`apps/api/src/modules/enrollments/enrollments.controller.ts`, `@Get('roster/:classSectionId')`, before this
slice, did exactly three things:

1. `ensureUser`;
2. `classSection.findUnique({ where: { id } })` — **no `select`** — then `cls.tenantId !== me.tenantId` → 404;
3. `enrollment.findMany({ where: { classSectionId, status: 'active', tenantId }, include: { student: true } })`.

Measured facts, all re-verified at HEAD:

| Fact | Measurement |
|---|---|
| `enrollments.read` is held by `parent` | `permissions.constants.ts:168` (`school_admin`), `:225` (`teacher`), `:259` (`parent`) |
| `student` does **not** hold it | `permissions.constants.ts:291-298` — the student portal is refused at the guard, before any new code |
| No ABAC of any kind | the handler body above, in full |
| The whole `Student` row leaves | `include: { student: true }` — `medicalNotes`, `address`, `phone`, `email`, `birthDate`, `gender`, `nationality`, `notes`, `customFields`, `photoUrl` |
| The whole `ClassSection` row leaves | `return { classSection: cls, … }` — including `internalNotes` (admin-authored free text about the class) and `options` (`Json`) |
| First-party consumers | `grep -rn "enrollments/roster" apps/ packages/` → **exit 1, zero hits.** Re-run at implementation time, not quoted from the intake |

Net: **any authenticated parent of the establishment could enumerate any class section by id and read every
child's medical notes, address, phone, email and birth date.** A class roster is *peer* data — the other
children of the class — and is never a parent's dossier.

## Decision

Apply the `ADR-061` shape (pure exported decision layer, identity resolved outside, narrow guard read → verdict →
payload read) and the `ADR-062` shape (module-local non-exported projection), in one commit, to this handler.
**No new convention is introduced** — every element below reuses a documented precedent. This ADR exists because
two of its choices *diverge visibly from `ADR-061`* and would otherwise be read as oversights.

---

### §D1 — There is NO academic-year clause here, although `ADR-061 §D1` demanded one

`ADR-061 §D1` required a two-statement, year-coupled wall. **That requirement does not transfer, and copying it
would cause a silent teacher lockout.**

`ADR-061`'s wall is **student-keyed**: it walks `teacher → assignments → class sections → enrollments → student`,
where the academic year is *free* on both sides. Because `TeachingAssignment`'s uniqueness key is
`@@unique([teacherProfileId, classSectionId, subjectId])` — `academicYearId` is **not** in it — an assignment row
*survives* the year rollover and would reach a *current* enrollment. Hence the coupling.

Here **both sides are anchored on the same `classSectionId`**, and the section itself is year-pinned:
`ClassSection.academicYearId` is non-null (`schema.prisma:457`) and `@@unique([academicYearId, gradeLevelId,
name])` (`:478`). **The section id in the path already supplies the year.** A stale assignment points at the *old*
section — a different id, whose roster is the old roster.

Two further reasons a year clause would actively harm:

- `TeachingAssignment.academicYearId` is a plain column with **no composite foreign key** to
  `ClassSection.academicYearId`. The two can diverge in data, and filtering would 403 a teacher who *currently*
  teaches the class. With zero consumers, nobody would ever report it.
- It would refuse a teacher reading a past-year section they genuinely taught.

House precedent for a *section-keyed* check is `announcements.controller.ts:1155`:
`{ tenantId, teacherProfileId, classSectionId }`, **no year**. `TeachingAssignment` also carries **no `active`
flag**, so there is no activity filter to apply either.

`findFirst`, not `findUnique`: a teacher may hold one assignment *per subject* on the same section (`subjectId` is
in the uniqueness key), so several rows satisfy the `where`. Only their existence matters.

### §D2 — The wall is ONE `findFirst`, and the null profile returns BEFORE the `where` exists

This is the single highest-risk line in the slice. Written naively as
`teachingAssignment.findFirst({ where: { tenantId, classSectionId, teacherProfileId: tp?.id } })` with
`tp === null`, the key is `undefined` — and **Prisma drops `undefined` keys from a `where`**. The query then
returns *the section's first assignment belonging to anyone*, and the caller with no teacher profile is
**granted**. A textbook fail-open.

Two mechanisms, not one:

1. `assertClassRosterReadable` checks `teacherProfileId === null` **first and independently** of `teachesSection`,
   and throws. The inverted form
   `if (!isPrivileged && teacherProfileId && !teachesSection) throw` fails open on the same null, and the docblock
   says so explicitly so nobody "simplifies" toward it.
2. The exported builder `teacherOfSectionWhere` types `teacherProfileId` as **non-optional `string`**, making the
   dangerous call *unrepresentable* rather than merely unwritten.

`TeacherProfileService.findForUser` (`teacher-profile.service.ts:94`), **never** `ensureForUser`: the latter is an
UPSERT, and putting it on a refusal path would provision a `TeacherProfile` row for every parent who attempts an
enumeration (`PF-265` / `ADR-051 §D1`). The privileged short-circuit skips *both* lookups; it does **not** skip
the guard read (see §D5).

### §D3 — The student projection is this file's OWN existing shape, and `photoUrl` stays out

`ENROLLMENT_ROSTER_STUDENT_SELECT = { id, firstName, lastName, externalRef }` is **not a new shape**: the `list`
handler eighteen lines above (`enrollments.controller.ts:142`) already projects exactly those four columns. The
slice *aligns* `roster` on the projection its own controller already applies.

`photoUrl` is excluded, on measurement (`ADR-062 §D1`): the only teacher surface that renders a student list
today composes an **initials avatar** (`apps/web/src/app/teacher/classes/[id]/attendance/AttendanceManager.tsx`).
Re-introducing a URL that resolves to a photograph of every child, inside a payload-minimisation slice, would
contradict the slice. `externalRef` stays because it is the schooling identifier that would disambiguate
homonyms, and because `list` already returns it.

Module-local and **not exported**, and the attendance twin is **not imported** (`ADR-062 §D3`): two modules, two
decisions, each revocable alone.

### §D4 — The `ClassSection` payload is projected too, and that is the SAME decision, not a second one

`return { classSection: cls, … }` emitted the whole row. `internalNotes` is admin-authored free text *about the
class*; measured, it is written and read only under `apps/web/src/app/admin/classes/*` and
`school-structure/classes.controller.ts` — an **admin-only field**. Shipping it to every teacher inside a
payload-minimisation slice is the same contradiction `photoUrl` avoids.

This is not scope creep and not an "other handler" under the story's non-regression rule: the two-step shape
required by §D5 **structurally destroys `cls`** — the guard read becomes a narrow `select` — so the slice cannot
be shipped without deciding what the payload's `classSection` is.

The guard read selects `{ id, tenantId, name, maxStudents }`; the response emits `{ id, name, maxStudents }`.
`tenantId` is selected because the tenant comparison needs it and is **not** returned. `capacity` needs
`maxStudents`, which is why it stays.

**Why the narrowest set, and not the wider `{ …, status, room, color, icon, gradeLevelId, academicYearId }` the
architecture ruling offered as sufficient.** Both are acceptable to the ruling. With **zero consumers**, every
extra field is a field nobody requested, added inside the slice whose subject is minimisation; the defensible
default in a payload-minimisation decision is the smallest set that keeps the response coherent. Widening later
is additive and breaks nobody; narrowing later is not. Recorded here so the choice reads as deliberate.

### §D5 — 404 strictly before 403, and privilege does NOT outrank the tenant check

The refusal ladder is: `401` (JwtAuthGuard) → `403` (PermissionsGuard, missing `enrollments.read`) → `400`
(malformed uuid, pipe phase) → `404` (section absent **or** foreign tenant) → `403` (ownership).

Inverting the last two would make the 403 an **existence oracle** on another tenant's class-section ids
(`ADR-048 §D9`, `ADR-061`). The privileged short-circuit is therefore placed *inside* the ownership resolver,
**after** the guard read — a `super_admin` of tenant A hitting tenant B's `classSectionId` gets a bare 404, never
a payload. An implementer optimising "one less query" by short-circuiting privileged callers before the guard
read would open a cross-tenant read; the spec pins this with a test per role.

The 400 rung is not an oracle: a malformed id is invalid in every tenant. It lands in Nest's **pipe** phase,
before the handler body, therefore before `ensureUser` and before any database read.

Both queries carry an explicit `tenantId` clause. Today's deployments run `degraded_no_app_url`, where the owner
connection escapes its own RLS policies (`ADR-032 §D5` / `ADR-042 §D1`) — **the literal clause is the only thing
filtering.** A drifted cross-tenant assignment row is pinned by a fixture and a test.

### §D6 — `parent` is denied, the catalogue is NOT edited, and the exposure CLASS stays open

`enrollments.read` remains granted to `parent` (`permissions.constants.ts:259`): the parent portal legitimately
reads its own child's enrollment through `list`. Catalogue drift is `PF-264` / `PF-53`'s story, not this one.

**And this must not be read as closing the exposure class.** `GET /enrollments?classSectionId=<id>`
(`enrollments.controller.ts:122`) is the same peer-enumeration door: same controller, same permission, same
parent grant, arbitrary `classSectionId` query filter, and **no ABAC**. Its student projection is already
`ADR-062`-shaped, so the medical-data leak is not there — but **peer identity enumeration (which children are in
class X) survives this slice**. Unlike `roster`, that path *is* consumed
(`apps/web/src/app/admin/students/actions.ts:55`), so locking it needs its own consumer census and its own slice.

Therefore: **`PF-278` is closed on this HANDLER and on both of its axes; it is not closed on the CLASS.**
Recorded as **`PF-283`** (see the id-arbitration note below). Writing "any authenticated parent can enumerate any class section — closed" would be a
`DNC-06` violation at story level, promising deeper behaviour than the runtime delivers.

### §D7 — The `PF-268` limitation is inherited verbatim, and its number is CITED, not re-measured

`isPrivilegedEnrollmentsCaller` is a realm-role **name** test. `PermissionsGuard` also resolves **custom** roles
via `UserSyncService.effectivePermissions` (`ADR-013`, `ADR-047` — custom roles are global), so a "vie scolaire"
role holding `enrollments.read` would pass the guard and be refused here. The honest remedy is a dedicated
permission code, out of this slice's scope.

`attendance.controller.ts:133` records `select count(*) from role → 0`, measured on the local stack on
2026-08-23. **This ADR cites that measurement; it does not re-take it.** Copying the sentence as a fresh
first-person observation would fabricate evidence (`DNC-06`). The honesty is copied, the number is attributed.

---

## Gates

| Gate | Disposition |
|---|---|
| **G-AUTHZ** | Evidence: `parent` denied · teacher-with-profile-but-no-assignment denied · teacher-with-no-profile denied **and the assignment query proven un-issued** · token without `realm_access` → 403, not 500 · `super_admin`/`school_admin` pass · guard metadata and `@RequiresPermission('enrollments.read')` asserted unchanged · no `SKIP_`/`ALLOW_`/`NODE_ENV` branch, asserted on the resolver's source |
| **G-TENANT** | Foreign-tenant `classSectionId` → bare 404 from the guard read, asserted **before** any ownership query, for parent / teacher / school_admin / super_admin · a drifted cross-tenant assignment row authorises nothing · both payload queries carry `tenantId: me.tenantId` |
| **G-PORTAL** | Discharged by the **census**, not by four ticks: `grep -rn "enrollments/roster" apps/ packages/` → exit 1, zero first-party callers across admin / teacher / parent / student. Plus the catalogue fact that `student` does not hold `enrollments.read`. No UI surface exists to break. Residual: §D6 |
| **G-DNC** | `DNC-06` live twice — the handler docblock ("useful for the teacher portal" was false) and the story-level claim (§D6); both corrected. `DNC-10` live once — no bypass parameter, no options bag, no environment hatch. Others not reproduced |
| **G-TRUTH** | **NOT TRIGGERED** — no KPI, projection or aggregate *semantics* change. This is a read-shape narrowing, not a computed figure |
| **G-MIGRATION** | **NOT TRIGGERED** — `schema.prisma` was **read, not edited**; zero migrations. Therefore **no `scripts/restore-drill-baseline.json` entry is owed.** Stated explicitly because that omission has burned four runs |
| **G-AUDIT** | **NOT TRIGGERED** — read path, no privileged mutation. No `auditLog` write is added or removed; a refused read is not an audit event in this codebase's vocabulary |

`scripts/boot-route-baseline.json:68` carries `"GET /enrollments/roster/:classSectionId"` and stays
**byte-unchanged** — a `ParseUUIDPipe` on a `@Param` changes no path.

## Consequences

**Good.** The worst child-data exposure in the neighbourhood is closed on the handler that carried it. The
payload drops from a whole `Student` row × N children plus a whole `ClassSection` row, to four columns × N plus
three. The decision layer is pure, exported and exhaustively unit-tested over all eight boolean combinations, so
the next reader can change the *rule* without reading the controller.

**Costs, stated rather than discovered.**

- The response's `classSection` narrows from ~11 fields to 3. Safe **only** because the census shows zero
  consumers — this is a declared breaking change, not a silent one.
- The teaching wall costs one extra scalar query on the teacher path (none on the privileged path).
- The 403 branch will become a user-visible state the day someone builds a teacher roster UI, and will then need a
  French, non-stigmatising empty state. Forward note, not a finding — there is no consumer to render it.
- `PF-281`: `findForUser` ignores `TeacherProfile.active`, so a deactivated teacher keeps every ABAC verdict it
  feeds — the four `ADR-061` attendance reads and now this wall. Cross-cutting by construction (the seam is
  shared), so it cannot be fixed here without changing refusal semantics on already-shipped paths.
- The exposure **class** remains open at `:122` (§D6). This ADR closes a handler.

## Alternatives rejected

| Alternative | Why not |
|---|---|
| Copy `ADR-061 §D1`'s year-coupled two-statement wall | §D1 — the key shape differs; the section id already pins the year, and a year clause would 403 teachers who genuinely teach the class |
| Remove `enrollments.read` from the `parent` catalogue instead of adding ABAC | §D6 — the parent portal legitimately reads its own child's enrollment through `list`; catalogue drift is `PF-264`/`PF-53` |
| Share `ATTENDANCE_ROSTER_STUDENT_SELECT` across the two modules | `ADR-062 §D3` — a cross-module projection seam couples two revocation decisions into one |
| Reuse the guard row as the response's `classSection` (one query) | It only works because the guard read is a **narrow `select`**; with the pre-existing bare `findUnique` it silently reinstates the `internalNotes` leak. The narrow select is what makes the single read safe, and it is asserted |
| Switch the enrollment level itself to `select` | `Enrollment` carries no sensitive column, and a top-level `select` would silently drop `id`/`enrolledAt` from the body. Narrow only the relation |
| Fix `:122` in the same slice | It has a real consumer (`admin/students/actions.ts:55`) and needs its own census. `PF-283`, the natural `S-E05-15` |
| Assert the projection on the response **body** | `PF-275` — the fake Prisma records `select`/`include` without applying them, so a body assertion would be green whatever the controller asked for. The honest assertion is the **request shape**, and the spec says so in prose |
