# ADR-066 — `StudentAccessService` stops shipping an UNRESTRICTED sentinel for `teacher`, and first-match role precedence becomes a UNION

- **Status** Accepted (architecture ruling, `S-E05-16` planning phase — run 76)
- **Date** 2026-08-23
- **Story** `S-E05-16` — [`docs/spec/features/v3-e05/stories/S-E05-16.md`](../spec/features/v3-e05/stories/S-E05-16.md)
- **Epic** `V3-E05` — AuthN/AuthZ hardening and permission integrity (layer L0)
- **Closes** `PF-288` (P1 `[security][privacy]`) — the `teacher` fail-open in `scopeForUser` and the absent-key
  consumption at `students.controller.ts:107`
- **Advances** `PF-51` — **clause 3 of 3, the enum clause**, on `GET /api/v1/students`. `PF-51` is **not** closed:
  the class survives across every other controller, and `PF-291` records the systemic alternative
- **Raises** `PF-296` · `PF-297` · `PF-298` · `PF-299` · `PF-300`
- **Predecessors** `ADR-061` (`S-E05-5`, the WHO axis on attendance) · `ADR-063` (`S-E05-14`, the roster wall) ·
  `ADR-065` (`S-E05-15`, the `/enrollments` list scope — **and §D2 of it is the sentence this ADR retires**)
- **Related** `ADR-015` / `ADR-021` (permission model; parent and student-self ABAC through
  `StudentAccessService`) · `ADR-051 §D1` / `PF-265` (`findForUser`, never `ensureForUser`, on a refusal path) ·
  `ADR-065 §D4` (the pinned-pipe verification method) · `ADR-065 §D5` (the empty array is the deny; the absent
  key is the fail-open) · `ADR-032 §D5` / `ADR-042 §D1` (`degraded_no_app_url`: the owner connection escapes its
  own RLS policies) · `PF-199` / `ADR-048` (identity resolution stays OUTSIDE the tenant scope) ·
  `GUARDRAILS.md` §2

---

## Verdict

**CONCERNS — proceed, under the eight rulings below.** Nothing in the slice requires a new architectural style;
every decision here either reuses a documented convention or is recorded as a decision in this ADR. Two of the
rulings (`§D2`, `§D6`) change the slice as the story describes it, and neither is optional: `§D6` is a **boot
failure** if skipped, `§D2` is a **parent-portal regression** if skipped.

No schema change. No migration. `TeachingAssignment`, `Enrollment`, `TeacherProfile` and their `tenant_id`
columns all exist on the pre-diff tree, so the ADR rule's schema clause (`tenant_id` + RLS + non-destructive
migration) is **N/A this slice** — and `scripts/restore-drill-baseline.json` needs no entry.

---

## §D1 — the teacher branch is TWO tenant-keyed statements, and it reuses the wall it must not re-derive

The `teacher` branch resolves in three steps, in this order:

1. `TeacherProfileService.findForUser(me)` — **never** `ensureForUser`. `AC-2` and `ADR-051 §D1` / `PF-265`:
   `ensureForUser` is an UPSERT, and `GET /api/v1/students` is a list route hit on every admin page load. `null`
   resolves to `{ studentIds: [], reason: 'teacher (no teaching profile)' }` — **`[]`, never `null`**, and never a
   throw (this method's contract is a scope, not an HTTP verdict; five consumers turn it into their own 403/404).
2. `teachingAssignment.findMany({ where: teacherSectionsWhere({ tenantId: me.tenantId, teacherProfileId }),
   select: { classSectionId: true } })`, deduplicated with `new Set` — a teacher holds one assignment **per
   subject** on the same section (`@@unique([teacherProfileId, classSectionId, subjectId])`), so duplicates are
   normal. `new Set`, not Prisma `distinct`: a jest double ignores `distinct` silently and would make the scope
   true for the wrong reason (`ADR-065 §D2`'s reasoning, carried).
3. `enrollment.findMany({ where: { tenantId: me.tenantId, status: 'active', classSectionId: { in: sectionIds } },
   select: { studentId: true } })`, deduplicated.

**No academic-year clause**, on either statement, for the reason already arbitrated in `ADR-063 §D1` and restated
in the `teacherSectionsWhere` docblock: `ClassSection.academicYearId` is non-null, so a section id already
carries its year, while `TeachingAssignment.academicYearId` is a plain column that can diverge from its section's.
Filtering on it would refuse a teacher who really does teach the class today. **Declared consequence:** a section
from a closed year whose enrolments were never transitioned off `active` stays in scope. That is a data-hygiene
question, not an ABAC one, and it is written rather than discovered.

`tenantId` is the **first key on both statements** even though the section ids of step 3 are already
tenant-filtered by step 2. Under `degraded_no_app_url` — every deployment today — the owner connection escapes
its own RLS policies (`ADR-032 §D5` / `ADR-042 §D1`), so the literal clause is the only thing filtering. This is
what makes `AC-3` hold: a foreign-tenant `?classSectionId=` never appears in `sectionIds`, so it intersects to
**empty**, and the caller is never *authorised* — they are *unmatched*.

**The empty set is emitted, never skipped.** If `sectionIds` is empty the branch returns `[]`. The
`...(ids.length ? { … } : {})` reflex — which turns the *least* entitled caller into an *unfiltered* one — is
forbidden by `ADR-065 §D5` and must be named in the docblock so it cannot return as a tidy-up.

## §D2 — role resolution becomes a UNION, because `teacher` stops being the widest scope (`PF-297`)

`scopeForUser` resolves roles by **first-match precedence** (`:33` admin → `:36` teacher → `:40` parent → `:56`
student), and its docblock calls this *"highest privilege wins"*. That ordering is only sound while each branch
is a **superset** of the ones below it. It is sound today **only because the teacher branch is unrestricted**.

The moment `teacher` returns a bounded set, `teacher` and `parent` become **incomparable**. A caller holding both
realm roles — a teacher whose own child attends the school, the single most ordinary multi-role case a school
has — would fall into the teacher branch and **lose the guardianship scope for their own child**. Every parent
route in the list of `§D5` would 403 for them: the parent dashboard, alerts, remediation, messaging,
parent-exports. That is not a tightening, it is the north-star surface breaking (`GUARDRAILS §1`: the parent
dashboard is the core).

**Decision.** The `teacher`, `parent` and `student` branches are evaluated as a **union of non-null scopes**, not
as a precedence chain. `super_admin` / `school_admin` keep their short-circuit and keep `null` — they are the
only branches for which `null` survives (`AC-1`). Concretely: collect the applicable branch results, and return
`null` iff an admin role is present, otherwise the deduplicated union of whichever of the three bounded branches
apply. A caller with none of the four roles keeps `{ studentIds: [], reason: 'no role with student access' }`.

The union is **not** a widening: each contributing branch is already exactly the set that role is entitled to,
and today, with the teacher branch unrestricted, the union of `{teacher, parent}` is `null` — literally what the
caller gets now. The union only ever *narrows* relative to the pre-diff tree.

**What was measured, this run, on the live stack** (`pilotage_postgres`, up 23 h): `select count(*) from
teacher_profile tp join guardian g on g.user_profile_id = tp.user_profile_id` returns **0**. So the overlap is
**latent in the demo dataset, not live** — which is exactly why it must be fixed by construction now rather than
found in production later. `teacher_profile` = 186 rows, all with a non-null `user_profile_id`, all with at least
one `teaching_assignment` (`0` teachers with zero assignments), and `teaching_assignment` = 286 rows over 186
distinct profiles.

Recorded as **`PF-296`**, closed in this slice for the `teacher × parent` and `teacher × student` pairs. The
*general* form — that role resolution here is a hand-rolled precedence chain with no test pinning the ordering
contract — stays open under the same id.

## §D3 — placement (`AC-4`): the twins move to a named seam in `teaching/`, and the obvious placement is a REQUIRE CYCLE

`AC-4` offers "reuse `teacherSectionsWhere` (`enrollments.controller.ts:405`) through a placement both modules can
import." **Importing it from `enrollments.controller.ts` is a FAIL, and not on style grounds.**
`enrollments.controller.ts:37` imports `StudentAccessService` from `students/student-access.service`. An import in
the other direction closes a **hard CommonJS require cycle** between a file whose classes carry Nest decorators
and a file whose class is a Nest provider. One side evaluates against a half-initialised module object at
decoration time; the failure surfaces as `Nest can't resolve dependencies` or a `Cannot read properties of
undefined`, at boot, with a stack trace that names neither cause. Measured, not assumed: the import at `:37` is
on the pre-diff tree.

**Decision.** `teacherSectionsWhere` and its twin `teacherOfSectionWhere` (`:221`) move, **unchanged, logic
untouched**, to a new leaf file:

```
apps/api/src/modules/teaching/teaching-wall.where.ts
```

Both docblocks move with them, and their cross-references (`enrollments.controller.ts:384`, `:679`, `:695`,
`:1204`) are repointed in the same diff — a stale `:220` cross-reference after a move is a `DNC-06` instance, not
a cosmetic. Importers to update: `enrollments.controller.ts`, `enrollments-list-abac.spec.ts:27`,
`enrollments-roster-abac.spec.ts:17`.

**Why `teaching/` and why both twins.** The predicate's return type is `Prisma.TeachingAssignmentWhereInput` — it
belongs to the teaching aggregate, not to enrollments. `apps/api/src/modules/teaching/` is a **leaf**: measured
this run, every relative import in it points at `shared/` or `school-structure/`, and nothing in it imports
`students/` or `enrollments/`. Both future consumers already depend on it (`enrollments.controller.ts:38` imports
`TeacherProfileService` from it). And `OPEN.md`'s own fix direction for `PF-270` names the destination in
so many words — *"one `TeachingWall` seam"* — so the file is named for the seam it is meant to become. Moving
only one twin would split a pair whose docblocks cite each other; moving both keeps one file honest.

**The ratchet hazard of `AC-4`, resolved by measurement rather than by caution.** The precedent it warns about
(an extraction that turned `ci-gate.sh` red without a logic change) is the template-literal rule on
`apps/api/src/shared/prisma/`. This move never touches that folder. `scripts/ci-gate.sh:375` triggers its tenant
stages on `^apps/api/src/modules/` **as a whole**, so origin and destination are inside the same trigger and no
boundary is crossed. A pure `where`-builder issues no Prisma statement, so it needs no
`ENUMERATED_OUTSIDE_SCOPE` entry of its own. And `scripts/tenant-adversarial-check.js` names no file in either
module except `teaching/teacher-profile.service.ts` (checked). **No ratchet is relaxed, and none needs to be.**

**`PF-270` is NOT closed by this.** The three divergent copies of *"does this teacher teach this child?"*
(`messaging.service.ts:90`, `remediation.service.ts:912`, and the `ADR-061` attendance copy) are untouched: they
key on `teacherProfile: { userProfileId }` rather than `teacherProfileId`, and consolidating them is blocked on
the connection question `OPEN.md` already records (one copy runs inside a `TenantScopeService` scope, another on
the owner connection). This slice creates the **address** for that consolidation and adds **no fourth copy** —
which is the whole of what `AC-4` asks. The row stays open, and this ADR is the evidence for why.

## §D4 — pipes (`AC-6`), verified against the pin, and the one place that can now 400

Measured, first-person, from `apps/api/node_modules/@nestjs/common` (**version read: `10.4.22`**, the pin):
`parse-enum.pipe.js` and `parse-uuid.pipe.js` both open `transform` with
`if (isNil(value) && this.options?.optional) return value;`, and both accept the option object as an
`@Optional()` constructor parameter. `ParseEnumPipeOptions` declares `optional?: boolean` in
`parse-enum.pipe.d.ts`. `{ optional: true }` is therefore honoured by both, and a **bare** pipe would 400 every
caller that omits the parameter. Same method as `ADR-065 §D4`; same result; re-run rather than inherited.

```ts
@Query('status', new ParseEnumPipe(StudentStatus, { optional: true })) status?: StudentStatus,
@Query('classSectionId', new ParseUUIDPipe({ optional: true })) classSectionId?: string,
@Query('academicYearId', new ParseUUIDPipe({ optional: true })) academicYearId?: string,
```

House precedent, identical shape, one module over: `enrollments.controller.ts:638-641`. `StudentStatus` is a
real Prisma enum (`active | transferred | graduated | withdrawn`, read from `schema.prisma:54`), so
`ParseEnumPipe`'s `Object.keys(enumType).map(k => enumType[k])` yields the four strings. `ClassSection.id` and
`AcademicYear.id` are both `@default(uuid()) @db.Uuid`, and two live rows of each read from `pilotage_postgres`
are v4 UUIDs — so the default `version: 'all'` regex matches and no caller is broken by the format.

**Declared behaviour changes**, written rather than discovered:

- `?status=` / `?classSectionId=` (present, empty) is `''`, is not nil, previously fell through the falsy guards
  at `:108` and `:121` and was **silently ignored**; it is now a **400**. `?classSectionId=a&classSectionId=b`
  parses to an array; `ParseUUIDPipe.isUUID` throws `'The value passed as UUID is not a string'` → **400**.
- The one first-party caller that builds this query string, `apps/web/src/app/admin/students/page.tsx:139-144`,
  emits each parameter only under `if (sp.x)`, so it **never** sends an empty one. Measured. But the values come
  from `searchParams`, and that `api<ListResponse>(...)` at `:147` is **not** wrapped in the file's own `safe()`
  helper — so a hand-edited `?status=foo` now surfaces as a 400 instead of the pre-diff 500 (unmapped
  `PrismaClientValidationError`, `PF-291`). **Both are unhandled; 400 is strictly the better one, and this is an
  improvement, not a regression.** Not fixed here — recorded under `PF-291`, which already owns the class.
- **The pre-state of `?status=<garbage>` is NOT claimed.** No live engine was asked whether it was a 500 or a
  silently empty result. Writing a number nobody took is `DNC-06`; the pipe makes the question moot. The `AC-6`
  evidence spec must assert **the pipe refuses before Prisma is reached** (zero Prisma statements), not a
  before/after status code.

`@Param('id')` on `findOne` (`:188`) stays unvalidated. It is inside the declared perimeter and it would be a
one-token change, but it is a *different* defect class (`PF-291`, the 500-vs-400 mapping) on a *different*
handler, and `GUARDRAILS §5` forbids widening a change to finish a feature. Recorded as part of `PF-291`'s
surface, not fixed.

## §D5 — blast radius (`AC-5`): the verdict changes on ~25 sites, and the four portals do not notice

The rule is mechanical: **every** `canAccessStudent` call site tightens for a `teacher` caller, from
*"any student in the tenant"* to *"a student they teach"*. There is no site where this is unintended. The reason
is one measured fact, and it is the strongest `G-PORTAL` statement this epic has produced:

**No first-party surface reaches `canAccessStudent` or `scopeForUser` with a teacher token.**

| Site | Route / caller | Verdict change for `teacher` | Intended? |
|---|---|---|---|
| `students.controller.ts:102` | `GET /students` (list) | unrestricted → taught students | **Yes — this is the defect.** Consumers measured: `apps/web/src/app/admin/*` (admin token) and `apps/web/src/app/parent/*` (parent token). **Zero teacher, zero student consumers** — the teacher portal reads `/api/v1/teachers/me/students` instead (`apps/web/src/app/teacher/students/page.tsx:108`), which is already teacher-scoped |
| `students.controller.ts:207` | `GET /students/:id` | unrestricted → taught students | Yes. Consumers: `admin/students/[id]`, `parent/children/[id]`, `parent/children/[id]/report`. No teacher consumer |
| `analytics.controller.ts:180,197,215` | `parent-dashboard/:id`, `parent-comments/:id`, `parent-upcoming/:id` | unrestricted → taught | Yes. The teacher portal calls `analytics/teacher-dashboard`, `teacher-action-center`, `teacher-reports` — measured, none of the three walled routes |
| `alerts.controller.ts:160` | `GET /alerts/parent/:studentId` | unrestricted → taught | Yes. Guarded by `profile.read.self`, which `teacher` **does** hold (`permissions.constants.ts:252-254`), so the route is reachable by a teacher today for **any** child. This is the leak, not a feature |
| `alerts.controller.ts:208` | parent alert lifecycle (`ack`/…) | unrestricted → taught | Yes. Same permission, same reasoning; it is a **write** path, which makes the pre-diff state worse than the read |
| `remediation.controller.ts:98,156,175,236,314,387,403` (7) | plan promote / list / get / transitions | unrestricted → taught | Yes. `remediation.read` **is** a teacher permission. The teacher portal calls only `/remediation/teacher*` (measured), which is a different, already-scoped surface |
| `messaging.service.ts:143` | `GET /messaging/eligible-teachers` | unrestricted → taught | Yes — with a caveat: its refusal message is `'Not a guardian of this student'`, which becomes **wrong for a teacher caller**. Fix the message or `ADR-048 §D9` (refusal-message discipline) is breached |
| `messaging.service.ts:281` | thread create | unrestricted → taught | Yes. Note the second, independent wall two lines down (`isTeacherOfStudent`) already enforces the teaching relation on the *thread's* teacher — so this site tightens the *caller* axis, which was genuinely open |
| `messaging.service.ts:452` | send message | **unchanged** | N/A — guarded by `if (senderRole === 'parent')`, so a teacher sender never reaches it |
| `parent-exports.controller.ts:65` | parent bulletin job | unrestricted → taught | Yes |
| `student-portal.service.ts:185,283,337,408,496,551` (6) | student self-reads | **unchanged** | **Verified, `AC-5`'s explicit ask.** Each passes `self.id`, resolved server-side from `Student.userProfileId === me.id`. A `student`-role caller never enters the teacher branch, and after `§D2` a hypothetical `teacher + student` caller gets the **union**, which still contains `self.id`. The strictest wall the platform has (`ADR-021`) is untouched in both directions |
| `calendar.controller.ts:273` | `GET /calendar` | **unchanged, by construction** | **`AC-7`, confirmed by reading `:265-273`.** `isPrivileged` is computed at `:264-266` as `super_admin \|\| school_admin \|\| teacher`, and `scopeForUser` is called **only** in the `: null` arm of the ternary at `:271-273`. A teacher token never reaches the service. This is a *separate* teacher fail-open living in the calendar controller, and it is **out of `AC-9`'s perimeter** — it stays open under `PF-288`'s successor surface, and is NOT closed by this slice. Say so in `PROGRESS.md`; do not let the row read as closed |
| `alerts/meeting-requests.service.ts` | teacher meeting queue | **unchanged** | It hand-rolls a scope *around* this service precisely because the sentinel was unrestricted. Its docblock (`:12-14`) becomes **false** the moment this lands — see `PF-298` |

**Deny-by-default cost, priced.** A `teacher` with no `TeacherProfile` goes from *"everything"* to `[]` on all
~25 sites at once. Measured on the live stack: `0` of the 186 `teacher_profile` rows lack a `user_profile_id`,
and `0` lack a teaching assignment — so **no live teacher is locked out by this change in the demo dataset**.
The residual is a Keycloak-side one: a user granted the `teacher` realm role with no provisioned profile. That
user is *supposed* to see nothing, which is the point of `AC-2`, and `ensureForUser` is the wrong cure
(`ADR-051 §D1`).

## §D6 — the DI consequence is a BOOT FAILURE, and it is in scope whether `AC-9` names it or not

`AC-2` requires injecting `TeacherProfileService`. `StudentAccessService` is a Nest provider with a
one-argument constructor, and it is instantiated from **three** injectors, not one:

| Module | How it gets the service | After the constructor change |
|---|---|---|
| `students.module.ts:12` | own provider, and **exports** it to `alerts`, `analytics`, `messaging`, `parent-exports`, `remediation`, `student-portal` | **must add `TeachingModule` to `imports`** |
| `enrollments.module.ts:29` | own local provider | already imports `TeachingModule` (`:28`) — **no change** |
| `calendar.module.ts:17` | own local provider | **must add `TeachingModule` to `imports`** — it does not import it today |

Skip either and the API does not boot: `Nest can't resolve dependencies of the StudentAccessService (PrismaService,
?)`. Neither module file is named by `AC-9`. **They are in scope regardless** — they are the mechanical
consequence of the change `AC-2` mandates, not a widening, and a two-line `imports:` edit is the smallest
possible form of it. Both must be named in the PR body so the diff does not read as scope creep.

Both edits are cycle-free, verified: `TeachingModule` imports only `AuthModule` and `SchoolStructureModule`, and
imports neither `StudentsModule` nor `CalendarModule`. `TeachingModule` declares controllers, which is harmless —
Nest registers a controller once, from its declaring module.

`apps/api/src/modules/students/student-access.service.spec.ts:20` and `:33` call
`new StudentAccessService(prisma as never)` and must gain the second argument.

**Rejected alternative**, and why it is written down: resolving the profile inline with
`this.prisma.teacherProfile.findFirst(...)` keeps the constructor at one argument and touches no module file. It
is rejected because it manufactures a **fourth** copy of the identity resolver in the same slice whose `AC-4`
forbids a fourth copy of the wall, and because `PF-281` (`findForUser` ignores `TeacherProfile.active`) is a
one-clause fix at **one** site — but only while there is one site. The operator override (`AC-2`) says
`findForUser`; the override wins, and it is also right.

## §D7 — the consumption shape at `students.controller.ts` (`ADR-065 §D5`, applied)

The `where` is typed `Record<string, unknown>` (`:104`). That annotation **disables Prisma's type checking on the
exact object an ABAC clause is folded into**, and it is what let `:107` and the later `where.enrollments = …`
assignment at `:122` coexist unexamined. `ADR-065 §D5` closes with *"`pnpm typecheck` is load-bearing security
again"*; it cannot be, through a `Record<string, unknown>`.

**Decision.** Type it `Prisma.StudentWhereInput`, and test the sentinel **explicitly**:

```ts
...(scope.studentIds === null ? {} : { id: { in: scope.studentIds } }),
```

not `scope.studentIds ? …`. The truthiness test happens to be correct today (`[]` is truthy in JS), which is
worse than being wrong — it is correct **by accident**, it reads as the forbidden `ADR-065 §D5` shape, and it
would silently invert the day the field's type changes. The `=== null` form says what the sentinel is.

The caller's `classSectionId` filter and the ABAC clause are on **different keys** (`enrollments` vs `id`), so
there is no last-key-wins collision to fix here — but the docblock must say so, because the next person to fold
an `enrollments`-shaped ABAC clause into this handler would create one. Recorded as **`PF-300`**, closed in this
slice.

**Risk to flag for the test-architect (the only agent who runs `pnpm typecheck`):** narrowing
`Record<string, unknown>` to `Prisma.StudentWhereInput` is the one edit in this slice that can turn the typecheck
gate red — `where.enrollments = { some: { … } }` at `:122` and the `mode: 'insensitive'` literals at `:112-115`
must satisfy the generated types. Expect it; do not "fix" it by reverting to the loose type.

## §D8 — `_schoolId` (`AC-8`): RECORDED, not honoured, and here is the measurement behind that

`scopeForUser`'s third parameter is `_schoolId` and is never read (`:30`). Honouring it in the teacher branch
would require a relational hop, not a column: **measured this run**, `model TeachingAssignment`
(`schema.prisma:1006-1026`) has `tenantId`, `teacherProfileId`, `classSectionId`, `subjectId`, `academicYearId`
— **no `schoolId`**. School is reachable only as `classSection → gradeLevel → schoolId`.

Honouring it *here* and nowhere else would also make the service return different scopes for the same user
depending on which controller called it: `enrollments.controller.ts:735` passes the **empty string** deliberately
(its docblock says why), while `students.controller.ts:102` passes a resolved `schoolId`. One caller would get a
school-filtered scope and the other a tenant-wide one, from the same method, with no signature difference to
warn anybody.

**Decision: record, do not honour.** Fixing it is a signature change across five consumers plus a resolution of
what `''` should mean, and it belongs to its own slice. Recorded as **`PF-299`**. The parameter keeps its
underscore — the underscore is the honest signal — and the docblock must state that the school dimension is
**not** enforced, so a reader cannot infer a control that does not exist (`DNC-06`).

---

## Gate obligations this slice inherits (and one that is easy to miss)

**`ENUMERATED_OUTSIDE_SCOPE` must be extended in the same diff.** `scripts/tenant-adversarial-check.js:2266-2287`
carries an entry whose `glob` is `apps/api/src/modules/students/student-access.service.ts` and whose `statements`
array is **exhaustive per statement** — today exactly `guardianship.findMany` and `student.findFirst`, each with
its own reason string. `enumerationDrift()` (`:3977`) compares declared against found. The two new statements of
`§D1` (`teachingAssignment.findMany`, `enrollment.findMany`) will make `ci-gate.sh` go **RED with no logic error
anywhere**, in exactly the class of failure `AC-4` warns about — just on a different axis than the one it names.
Each new statement needs its own entry and its own reason, on the same `PF-199` grounds as the two already
there: this method resolves the ABAC scope, so it must not run inside the scope it is opening.
`teacherProfile.findFirst` needs **no** new entry — it is already declared under
`teaching/teacher-profile.service.ts` (`:2331-2338`), which is where it executes. Recorded as **`PF-297`**.

**`DNC-06` obligations, in-diff, not deferred.** Three shipped prose artefacts assert the sentinel this slice
deletes. Each becomes a guide/runtime mismatch the moment it lands:

1. `student-access.service.ts:11-12` — *"teacher → can see all students in the school (Phase 3D simplification…)"*.
   The story already requires this one.
2. `alerts.controller.ts:184-185` — *"Admin/teacher tokens (scope studentIds:null) pass the ABAC check
   unrestricted, matching the read."*
3. `alerts/meeting-requests.service.ts:11-14` — *"`StudentAccessService.scopeForUser` still returns
   `studentIds:null` for teachers, so we cannot lean on student-scope here."*

(2) and (3) are one-line comment corrections in files this slice otherwise does not touch. Recorded as
**`PF-298`**; correcting them in-diff is cheaper than carrying them, and `ADR-065 §D2` — *"why the teacher wall
does NOT go through `StudentAccessService`"* — needs a superseding note in `PROGRESS.md` for the same reason:
its premise is exactly what this slice removes.

**`DNC-10`.** The `TODO Phase 4` **is** the hard-coded bypass. It is removed, not replaced, not re-expressed as a
config flag, not softened into an allow-list.

---

## New findings — recorded, allocated from `PF-296`

`NEXT.md` is empty on this tree; `PF-295` is already taken in `OPEN.md` (the self-matching `Partial<>` census).
Allocation therefore starts at `PF-296`.

> **Id arbitration (`PF-308`, corrected at the land pass — the table below was WRONG when the sprint wrote it).**
> The sprint's draft of this table allocated `PF-296`…`PF-300` to a **different permutation** of these subjects
> than the shipped source cites, and never allocated `PF-301`…`PF-304` at all. Arbitrated **by meaning**, the
> `PF-185`/`PF-186` rule (runs 53/54): **the ids quoted from `apps/api/src` and `scripts/` WIN**, because those
> citations are shipped and a reader follows them from the code. The table was rewritten to match them; the
> `§D2` heading, which cited `PF-296` for the union, was corrected to `PF-297` in the same pass. Nine source
> citations were the authority: `students.module.ts:11`, `calendar.module.ts:14`, `enrollments.module.ts:28`
> (`PF-296`); `student-access.service.ts:29` and its spec (`PF-297`); `student-access.service.ts:50` (`PF-298`);
> `scripts/tenant-adversarial-check.js:2301` (`PF-299`); `alerts.controller.ts:186`,
> `meeting-requests.service.ts:14` (`PF-300`); `students.controller.ts` and its spec (`PF-301`, `PF-303`,
> `PF-304`); `alerts.controller.ts:197` (`PF-302`).

| Id | Severity | Subject | Disposition |
|---|---|---|---|
| `PF-296` | **P2** `[reliability]` | The three modules that provide `StudentAccessService` **locally** (`students`, `calendar`, `enrollments`) each carried the docblock premise *"ne dépend que de `PrismaService`"*, which this slice **falsifies**. A fourth injector added on that premise fails at **BOOT**, not in a test | **Docblocks corrected in-diff** at all three sites and `TeachingModule` added to each `imports`; `§D6`. The derived spec that would make a fourth injector fail RED is **not written** — stays open |
| `PF-297` | **P1** `[security][privacy]` | `scopeForUser` resolved roles by FIRST MATCH (`admin → teacher → parent → student`), sound **only** while the teacher branch was unrestricted. The moment it becomes a bounded set, a `teacher`+`parent` principal — a teacher whose own child attends the school — **loses their own child** on every parent surface, delivered by a fix labelled "teacher" | **Closed in-slice** by `§D2` (union), proven for `teacher × parent` and `teacher × student` at `student-access.service.spec.ts:459` |
| `PF-298` | P2 | `scopeForUser`'s `_schoolId` is accepted and **never read**; `TeachingAssignment` carries no `schoolId` column (school is reachable only as `classSection → gradeLevel → schoolId`), and one of the five consumers passes `''` | **Recorded, NOT fixed** (`§D8`). `AC-8`'s disposition is explicit rather than undecided. **The school dimension of this scope is not enforced** |
| `PF-299` | P2 `[gate]` | `ENUMERATED_OUTSIDE_SCOPE` in `scripts/tenant-adversarial-check.js` is **statement-exhaustive per glob**, so adding any Prisma statement to an already-enumerated file turns `ci-gate.sh` red without a logic error. Second instance of the class after the `shared/prisma/` template-literal ratchet | **Closed in-slice** by extending the entry with the two new statements (gate exit 0). The *class* — no compile-time link between the file and its declaration — stays open |
| `PF-300` | P2 `[docs]` `DNC-06` | Shipped docblocks **outside** the perimeter assert the retired `studentIds: null` teacher sentinel as **current fact** | **Census INCOMPLETE — 4 of 7 corrected in-diff** (`alerts.controller.ts:186`, `meeting-requests.service.ts:14`, `tenant-scope.service.ts`, `ADR-065 §D2` superseded in `PROGRESS.md`). Three instances remain and all three are load-bearing rationale, not colour. Stays open |
| `PF-301` | P3 | `students.controller.list` typed its `where` as `Record<string, unknown>`, **disabling** Prisma type-checking on the exact object the ABAC clause is folded into — so `ADR-065 §D5`'s "the typecheck is load-bearing security" could not hold through it | **Closed in-slice** by `§D7` (`Prisma.StudentWhereInput`), with a source ratchet at `students-list-teacher-scope.spec.ts:356` |
| `PF-302` | P2 `[ux]` | A `teacher` still **sees** alerts they can no longer act on — the alert LIST does not run through `scopeForUser` but the lifecycle mutations now do, so the list shows a foreign child's alert and the button returns 403 | **Recorded, not fixed.** A 403 dead-end is a worse surface than a shorter list; story to be written |
| `PF-303` | P3 | `?unenrolled=` on `GET /api/v1/students` is a **DEAD** parameter — zero web callers, and structurally empty for a teacher, whose scope *derives* from active enrollments | **Recorded, not fixed.** Delete it or give it a caller |
| `PF-304` | P2 | Present-but-**empty** query values (`?status=`, `?classSectionId=`, `?academicYearId=`) now **400** where they were silently ignored: the pipes short-circuit on `isNil`, and `''` is not nil | **Behaviour change, DECLARED** (`§D4`), not claimed as pre-existing. No first-party caller emits them; a bookmarked or hand-edited URL reaches it |

**Raised later, at the verify and land passes** (`PF-305`…`PF-313`) — recorded in `OPEN.md` with their measurements
rather than restated here. Two of them rank as this epic's next slices: **`PF-310`** (the wall has **no expiry**, so
it accumulates every student a teacher has ever taught — the finding that re-opens `PF-288` *by ageing*, with every
test green) and **`PF-309`** (the Student aggregate's READ is now walled and its **WRITE** is not — an asymmetry
this slice CREATES).

**Not raised, deliberately, and NOT to be fixed here** (`AC-9`): `PF-294` (`classes.controller.ts:130`, the third
door), `PF-281` (`findForUser` ignores `TeacherProfile.active` — the same seam this slice leans on; its price is
now **one** site higher, and that is the only thing this slice changes about it), `PF-291` (global Prisma
exception filter), `PF-270` (the three divergent wall copies — this slice creates their address and adds no
fourth). The `calendar.controller.ts:265` teacher short-circuit is a **live, separate** teacher fail-open that
this slice does **not** close; `PROGRESS.md` must say so plainly.

---

## Consequences

- `StudentAccessService` gains a second constructor dependency and stops being resolvable from a module that does
  not import `TeachingModule`. That coupling is the point: the DI graph now fails **loudly at boot** rather than
  silently returning an unrestricted scope.
- `apps/api/src/modules/teaching/teaching-wall.where.ts` becomes the named `TeachingWall` seam `PF-270` asks for.
  Nothing is consolidated into it yet, and no fourth copy is created.
- `GET /api/v1/students` narrows for `teacher` on both axes (the bare list and `?classSectionId=`), and its three
  query parameters are refused at the pipe. No first-party portal surface changes behaviour: measured, the
  handler's only consumers hold `admin` or `parent` tokens.
- `PF-51` reaches clause 3 of 3 on **this handler**. The row does **not** flip: the enum/notification-kind class
  survives elsewhere, and `PF-291` records the systemic alternative that would retire the per-endpoint strategy.
- One reversible risk to the typecheck gate (`§D7`), declared in advance rather than discovered at the gate.
