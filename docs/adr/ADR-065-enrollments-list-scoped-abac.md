# ADR-065 — `GET /enrollments` gains a SCOPED read where `roster` gained a WALL, and the empty array becomes the deny

- **Status** Accepted
- **Date** 2026-08-23 (run 75)
- **Story** `S-E05-15` — [`docs/spec/features/v3-e05/stories/S-E05-15.md`](../spec/features/v3-e05/stories/S-E05-15.md)
- **Epic** `V3-E05` — AuthN/AuthZ hardening and permission integrity (layer L0)
- **Closes** `PF-283` (P1) — **on this handler, on BOTH of its axes** (the bare list and the `?classSectionId=`
  filter). Not on the exposure class; see §D7.
- **Advances** `PF-51` — **clause (b)**, the four query parameters of `list`. `PF-51` is still **not** closed:
  the class survives across the other controllers (§D4, `PF-291`).
- **Raises** `PF-288` · `PF-289` · `PF-290` · `PF-291` · `PF-292` (three planning artefacts allocated the same
  four numbers to different subjects — arbitration below) · `PF-293`
- **Corrects** `ADR-063 §D6` — two of its sentences rest on call sites that do not exist (§D6)
- **Predecessors** `ADR-061` (`S-E05-5`, the WHO axis on attendance) · `ADR-062` (`S-E05-6`, the WHAT axis on
  attendance) · `ADR-063` (`S-E05-14`, the WHO + WHAT axes on `roster`, one route over in this same file)
- **Related** `ADR-015` / `ADR-021` (permission model, parent ABAC through `StudentAccessService`) ·
  `ADR-051 §D1` / `PF-265` (`findForUser`, never `ensureForUser`, on a refusal path) · `ADR-062 §D3` (no
  cross-module shared projection) · `ADR-063 §D1` (why no academic-year clause on a section-keyed wall) ·
  `ADR-032 §D5` / `ADR-042 §D1` (`degraded_no_app_url`: the owner connection escapes its own RLS policies) ·
  `ADR-048 §D9` (refusal-message discipline) · `GUARDRAILS.md` §2 (parent access goes through
  `StudentAccessService`)

---

## Id arbitration — four ids allocated three different ways, resolved by MEANING

The story spec, the architecture ruling and the pre-mortem each allocated `PF-288`..`PF-291` to a **different**
subject. The house rule for a colliding id (`PF-185` / `PF-186`, runs 53/54) is to arbitrate **by meaning**, never
by date, and to record the arbitration where the id is cited from source. It is recorded here.

| Id | Subject kept | Why this one |
|---|---|---|
| `PF-288` | `StudentAccessService.scopeForUser` is a measured fail-open for `teacher` | The story spec is the operator override and its `FR-9` names `PF-288` for exactly this; the pre-mortem agrees on the subject at a different number. It is also the only **P1** of the four, so it takes the lowest id |
| `PF-289` | a shipped docblock / ADR sentence asserts a parent-portal consumer of `list` that does not exist — and the same docblocks cite `list` at stale line numbers | Two of the three artefacts put this subject at `PF-288`/`PF-289`. The story spec's narrower "stale line refs" reading is folded in: same file, same sentences, one finding |
| `PF-290` | `GET /enrollments` has no pagination | Uncontested — two artefacts, same subject, same number |
| `PF-291` | `apps/api` has no global Prisma exception filter | The architecture ruling's allocation. Kept because it is the *systemic* form of `PF-51`, which this ADR advances |
| `PF-292` | second whole-`ClassSection` projection site (the `@Post()` create response) | The pre-mortem wanted `PF-291` for it; that number is taken above, so it moves to the next free one. **Renumbered by meaning, subject unchanged.** Not a leak — see the table at the end |

The architecture ruling's own `PF-290` — `Enrollment.endReason` (free-text administrative reason a schooling
ended) returned unprojected, because only the *relations* of `list` carry a `select` — is **not** dropped. Its
number is taken by the pagination finding above, so it moves to **`PF-293`**, subject unchanged. It is out of
`AC-6`'s declared scope (which names `ClassSection` only) and is recorded, not fixed.

---

## Context

`ADR-063` closed `roster` and said so precisely: *closed on this HANDLER, not on the CLASS*. The other door was
**twelve lines up in the same file**. `@Get()` `list` carried `@RequiresPermission('enrollments.read')` and a
`where` of `{ tenantId }` plus four **caller-supplied** filters — that is, the filter was the attacker's
parameter.

`enrollments.read` is held by `school_admin` (`permissions.constants.ts:168`), `teacher` (`:225`) and `parent`
(`:259`). Measured this run: it is **absent** from the `student` block (`:291-299`, seven grants, all `.self`
except `branding.read`), so the student portal is stopped at `PermissionsGuard` and never reaches ABAC at all.

Three defects, all reproduced on `main` before any edit:

1. **No ABAC, two axes.** `(a)` a bare `GET /enrollments` returned **every enrollment in the tenant**, each with
   `firstName`, `lastName`, `externalRef`; `(b)` `?classSectionId=<any id>` returned any class's roll — exactly
   the door `roster` had just closed. Axis `(a)` is the **wider** one and is the one a reader focused on the
   `?classSectionId=` axis forgets.
2. **The whole `ClassSection` row.** `include: { classSection: { include: { gradeLevel: true } } }` shipped
   `internalNotes` (admin free text about the class) and `options` (`Json?`), plus nine more columns, plus four
   `GradeLevel` columns.
3. **Unvalidated parameters** — `PF-51` clause (b). Three `@db.Uuid`-bound ids and one enum, all raw strings at
   runtime.

**Blast radius: zero.** `grep -rn "v1/enrollments" apps/web/src apps/web/e2e apps/worker/src` returns three hits,
all in `apps/web/src/app/admin/students/actions.ts` — `:55` `method: 'POST'`, `:74` `method: 'POST'` (`/transfer`),
`:92` `method: 'PATCH'`. **No portal issues a GET on this route.** There is no rendering surface to break.

---

## Decision

### §D1 — `list` **scopes** where `roster` **refuses**, and that divergence is the decision

Two handlers, one controller, one permission code, and from this slice on they answer the same role
**differently**. Written down so the next reader does not "harmonise" one into the other — and the direction such
a harmonisation would take is *loosening*, which is why it is written here rather than left implicit.

| realm role | `roster` (`ADR-063`) | `list` (this ADR) | why |
|---|---|---|---|
| `super_admin` / `school_admin` | allowed | allowed, tenant-wide | `isPrivilegedEnrollmentsCaller` — **reused, not re-implemented** (`PF-270`) |
| `teacher` | allowed on sections they hold a `TeachingAssignment` on | **scoped** to `classSectionId ∈ {those sections}` | same join key, same table; a blanket 403 here while `roster` allows would be an inconsistency inviting a loosening "fix" |
| `parent` | **403** | **scoped** to `studentId ∈ {active guardianships}` | different resource *shape* — see below |
| anything else | 403 | 403 | deny-by-default |

`roster` is a **peer-set** view: *who else is in class X*. A parent never has standing over that. `list` is a
**row-set** over `Enrollment`, and a parent has standing over their own child's rows. **Same permission code,
different resource shape, different verdict.**

The security property is therefore now a property of the **emitted `where`**, provable by a pure unit test rather
than by an end-to-end request nobody runs. `classifyEnrollmentListCaller` and `buildEnrollmentListWhere` are
exported, pure, take plain values, and follow the house form already in this file
(`isPrivilegedEnrollmentsCaller`, `assertClassRosterReadable`). `EnrollmentListScope` deliberately has **no
`denied` member**: a refused caller cannot, by typing, reach the `where` builder.

**What a blanket 403 would have cost**, recorded because a reviewer may still force the narrower slice: deleting
the `guardian` branch would leave `parent` holding `enrollments.read` with **no readable route at all** —
catalogue drift under another name (`PF-264` / `PF-53`) — and would force the first UI consumer to write an
*error* branch where an empty scope degrades naturally into an *empty state*.

### §D2 — the parent wall DOES use `StudentAccessService`; the teacher wall deliberately does NOT

`GUARDRAILS §2` mandates `StudentAccessService` for parent access, and its `parent` branch
(`student-access.service.ts:41-52`) is correct: it reads **active** guardianships and returns an array.

Its `teacher` branch is not. Measured this run at `student-access.service.ts:38-40`:

```ts
if (roles.includes('teacher')) {
  // TODO Phase 4: when teaching assignments exist, filter by the teacher's class sections.
  return { studentIds: null, reason: 'teacher (unrestricted until teaching assignments land)' };
```

`studentIds: null` is the **unrestricted** sentinel. Routing the teacher axis through it would ship a control
that is a **no-op for `teacher`** while every negative *parent* test went green — the worst possible outcome for a
`G-AUTHZ` slice, because the ledger would look clean. The `TeachingAssignment` rows that TODO waits for **exist**
and are already walked by this very controller (`teacherOfSectionWhere`). They are walked here too.

`student-access.service.ts` is **not** fixed: out of the declared file range, and five other controllers depend on
its current behaviour. Recorded as `PF-288`.

Two consequences, declared rather than discovered:

- **The asymmetry is deliberate and typed.** `EnrollmentListScope` admits `readonly string[]`, never
  `string[] | null`. If `scopeForUser` ever returned `null` on the parent branch, the controller **refuses**; the
  unrestricted sentinel cannot structurally become a filter.
- **`findForUser`, never `ensureForUser`** (`ADR-051 §D1` / `PF-265`). `ensureForUser` is an UPSERT; on a *list*
  route, reachable on every page load once a consumer exists, a refusal path that provisions a `TeacherProfile`
  row per probe is a sink.

`StudentAccessService` is provided **locally** in `EnrollmentsModule` rather than obtained by importing
`StudentsModule`. It depends only on `PrismaService`, a global module; the house precedent for exactly this, with
exactly this reason already written in its comment, is `calendar.module.ts:13-17`. Importing `StudentsModule`
would attach `EnrollmentsModule` to it — and transitively to `SchoolStructureModule` — for one stateless provider.

### §D3 — a THIRD module-local projection, not an import

`ENROLLMENT_LIST_CLASS_SECTION_SELECT` is module-local and **not exported**.
`ENROLLMENT_ROSTER_CLASS_SECTION_SELECT` is **not** reused: `ADR-062 §D3` forbids a shared cross-module
projection, and its shape is wrong here anyway — it carries `maxStudents` (capacity, `roster`'s concern) and no
`gradeLevel`. Two constants, two decisions, each revocable alone.

**Kept:** `ClassSection.{id, name}` and `gradeLevel.{id, code, name, orderIndex}` — the join key, the class label,
the human level label, and the sort key of that label.

**Dropped, enumerated from `schema.prisma`:** `ClassSection.{tenantId, academicYearId, gradeLevelId, maxStudents,
room, color, icon, options, internalNotes, status, createdAt, updatedAt}` (eleven) and
`GradeLevel.{tenantId, schoolId, cycleId, createdAt}` (four).

With zero first-party consumers, *"the fields actually rendered"* has **no empirical answer**. The keep-list is
derived from the **model**, and that is stated rather than dressed up as a measurement (`DNC-06`).

### §D4 — the parameters are validated, and the pre-state is NOT claimed

`@Query('studentId'|'classSectionId'|'academicYearId', new ParseUUIDPipe({ optional: true }))` and
`@Query('status', new ParseEnumPipe(EnrollmentStatus, { optional: true }))`. House precedent:
`remediation.controller.ts:703`, `imports.controller.ts:64`.

**What was measured** (first-person, this run): in the pinned build `@nestjs/common@10.4.22`, **both**
`parse-uuid.pipe.js` and `parse-enum.pipe.js` open `transform` with
`if (isNil(value) && this.options?.optional) return value;` — read from `node_modules`. `{ optional: true }` is
therefore honoured by both, and a **bare** `ParseUUIDPipe` would 400 every caller that omits the parameter. Also
measured: `apps/api/src` registers **no** global Prisma exception filter, so any Prisma error on this path is an
unmapped 500.

**What was NOT measured, and is therefore not claimed.** No live engine was queried about the PRE-STATE of
`?status=<bogus>`. It was either a `PrismaClientValidationError` surfacing as 500 or a silently empty result;
this ADR does not pick one, because writing a number nobody took is `DNC-06`. The pipe makes the question moot.

**Declared behaviour change.** `isNil` covers `null | undefined` only. `?studentId=` (present, empty) is `''`, is
not nil, previously fell through the falsy guard `...(studentId ? … : {})` and was **silently ignored**; it is now
a **400**. `?studentId=a&studentId=b` parses to an array and is now a 400 too. With zero GET consumers this breaks
nothing — but it is a real semantic change and it is written, not discovered.

The systemic form of this stays open: `PF-291`.

### §D5 — the empty array is the deny; the ABSENT key is the fail-open

The original handler composed its `where` from four `...(x ? { x } : {})` spreads. Folding an ABAC clause in as a
fifth spread creates a **last-key-wins collision** on `studentId` / `classSectionId`: in one spread order the
caller's filter vanishes, in the other **the caller's filter overwrites the ABAC** — a complete IDOR that looks
scoped. So no ABAC key is introduced by spread at all: the caller's filters and the scope clause are two
**distinct members of an `AND`**, which is the intended semantics (INTERSECTION, never union) and in which neither
can erase the other.

The second trap is the "avoid an empty `IN`" reflex. `...(ids.length ? { … } : {})` turns the **least** entitled
caller — zero assignments, zero guardianships — into an **unfiltered** one. The key is **always** emitted;
`{ in: [] }` is the deny, and the spec asserts the emitted `{ in: [] }`, never "the key is absent". Named and
forbidden in the docblock so it cannot be reintroduced as a tidy-up.

Both walls also make the fail-open **unrepresentable in the type system**: `teacherSectionsWhere` types
`teacherProfileId` as non-optional (Prisma drops `undefined` keys, which would silently widen the scope to the
whole tenant at HTTP 200), so the 403 must be thrown before the `where` exists. `pnpm typecheck` is load-bearing
security again.

`tenantId: me.tenantId` is the **first key on all three branches**. Under `degraded_no_app_url` — every deployment
today — the owner connection escapes its own RLS policies (`ADR-032 §D5` / `ADR-042 §D1`), so the literal clause
is the only thing filtering. The teacher scope derives from a `tenantId`-filtered `teachingAssignment.findMany`,
so a foreign-tenant `classSectionId` intersects to `{ in: [] }`; a drifted cross-tenant assignment row is pinned
by a fixture and a test.

`list` filters where `roster` guard-reads, so a foreign-tenant id yields `[]` here and `404` there. That
difference is **kept**: `[]` is indistinguishable from "no enrollments" and leaks no existence signal. Do not
"improve" it into a 404.

### §D6 — corrections to `ADR-063 §D6`, which deferred this lock on two claims that do not hold

Both are `DNC-06`-class: written claims no runtime supports. Cited and corrected here rather than silently
overwritten.

1. `ADR-063 §D6` reads: *"Unlike `roster`, that path **is** consumed
   (`apps/web/src/app/admin/students/actions.ts:55`), so locking it needs its own consumer census and its own
   slice."* Line 55 is `method: 'POST'` — the **create** handler, same path string, different verb. The claim
   attributed a POST consumer to the GET handler and used it as the stated reason to defer this lock. → **`PF-288`**.
2. `ADR-063 §D6` and the docblock it mirrors also read: *"le portail parent lit légitimement l'inscription de SON
   enfant via `list`"*, and that sentence justified keeping `enrollments.read` in the `parent` catalogue. There is
   **no parent-portal call to `GET /api/v1/enrollments`** on any of the four portals. → **`PF-289`**.
3. `ADR-063 §D6` also planted, in `enrollments-roster-abac.spec.ts`, a `COUCHE 5` of **characterization** tests
   (`describe('PF-283 (OUVERT) …')`) asserting the *current* — leaky — behaviour of `list`, so that *"`PF-278`
   closed"* could never be read as *"the exposure class is closed"*. Its header stated its own expiry condition:
   those cases go **red, by name**, the day `PF-283` closes. That day is this ADR. They are **removed**, not
   rewritten in place — their inverse is asserted more completely in `enrollments-list-abac.spec.ts`, the file
   that belongs to this handler, and a comment block left at their old position records the move so the deletion
   is not misread as dropped coverage. Two consequences worth carrying: the throwing `studentAccess` stub in that
   harness only tells the truth (*"`roster` never consults `StudentAccessService`"*) once those two `list` calls
   are gone; and, generally, **a story closing a finding that an earlier story characterized must budget the
   characterizing file into its own file set** — `S-E05-15 §3` did not, and was corrected rather than widened
   silently. This is the pinning mechanism working as designed, not a regression.

Note the direction of the correction: `PF-289` removes the *stated* reason for the `parent` grant, but §D1 gives
it a *real* one — the guardian branch shipped here is the first route on which `parent`'s `enrollments.read`
actually means something. The catalogue re-decision remains `PF-264` / `PF-53`'s story.

### §D7 — `PF-268` inherited verbatim, and what this slice does NOT close

`isPrivilegedEnrollmentsCaller` is a realm-role **name** test, while `PermissionsGuard` also resolves **custom**
roles via `UserSyncService.effectivePermissions` (`ADR-013`, `ADR-047`). A custom "vie scolaire" role holding
`enrollments.read` would pass the guard and be **narrowed** here — refused, since it matches neither `teacher` nor
`parent`. That is the safe direction, and it is an asymmetry worth naming: the parent branch is *better* than the
privileged test, because `scopeForUser`'s final `return { studentIds: [] }` denies unknown roles by default.
`attendance.controller.ts:133` records `select count(*) from role` → **0** on the local stack; that figure is a
**CITATION** of that comment, not a fresh measurement — this run did not reopen the database.

**`PF-283` closes on both axes of this handler. It does not close the exposure class.** `roster` and `list` are
now both walled, but the other ~41 controllers were **not** surveyed for the same shape, and this ADR does not
claim they were. `list` also remains **unpaginated** (`PF-290`, already recorded descriptively as `D-18`): a bare
privileged call still returns every enrollment in the tenant with four relations joined. The teacher and guardian
scopes only **narrow** rows, so this slice does not worsen it — and it is not fixed here.

---

## Consequences

**Positive.** Both doors of the peer-enumeration class in this controller are shut. The security property is a
pure function of plain values, unit-testable without a Nest container. The `where` builder makes two distinct
fail-open shapes unrepresentable rather than merely absent. `internalNotes` and `options` leave the wire. Four
reachable 500s on a permissioned endpoint become 400s.

**Negative / accepted.** One more module-local projection constant to keep in step with the model (accepted:
`ADR-062 §D3`'s explicit trade). `EnrollmentsModule` gains a locally-provided `StudentAccessService`, so its
instance is not the one `StudentsModule` exports (accepted: the service is stateless and read-only). A teacher
with a profile but no assignment now receives an empty list rather than an error — the deliberate choice of §D1,
and the reason the spec carries a **positive, non-empty** assertion: a stub returning `[]` would otherwise satisfy
every negative test in `G-AUTHZ`.

**Merge conditions, declared rather than fixed.** `scripts/boot-check.js` has not run against `dist/` with the new
fifth constructor argument. No HTTP request was issued. **No `where` written in this slice has reached the
PostgreSQL engine** — every proof here is a proof about the emitted query object, and it is labelled as such.

**Gates.** `G-AUTHZ` — eight negatives and four positives, plus guard metadata; no permission granted that the
grantor lacks; this slice only narrows. `G-TENANT` — `tenantId` first on all three branches, asserted on the
assignment query too. `G-TRUTH` — **zero rendering surface**: no portal displays any field of this response today,
so no label, column, empty state or aria text changes; `internalNotes` and `options` left the wire, not a screen.
`G-PORTAL` — measured per portal, four portals, zero UI diff. `G-DNC` — `DNC-10` checked by a grep over the
controller source (no `bypass`/`allow`/`skip`, no `process.env`); `DNC-06` — every number is taken by its author
or labelled a CITATION. `G-MIGRATION` not triggered (no schema change, no `restore-drill-baseline.json` entry
owed). `G-AUDIT` not triggered (read path).

---

## New findings — recorded, not fixed

| Id | Severity | Finding |
|---|---|---|
| `PF-288` | **P1** `[security]` | `StudentAccessService.scopeForUser` returns `studentIds: null` (**unrestricted**) for `teacher` behind a stale *"TODO Phase 4: when teaching assignments exist"* (`student-access.service.ts:38-40`); the assignments landed long ago. Live consumers inherit it: `students.controller.ts:102`, `calendar.controller.ts:273`, and `alerts/meeting-requests.service.ts:7-13` already hand-rolls a workaround *around* it. Its `_schoolId` parameter is accepted and never read, so the school dimension of the scope is illusory. Also covers the `ADR-063` `:186` / `:248` POST-misattribution (`DNC-06`) corrected in §D6 above. |
| `PF-289` | P2 `[docs][privacy]` | `ADR-063` `:179` / `:244` and `enrollments.controller.ts:1154` (post-slice line) claim the parent portal reads `list`; no such call site exists on any portal. It was the stated justification for the `parent` `enrollments.read` grant. Feeds `PF-264` / `PF-53`. |
| `PF-290` | P2 `[perf]` | `GET /enrollments` has no `take`/`skip`/`cursor`. A bare privileged call returns every enrollment in the tenant with `student` + `classSection` + `gradeLevel` + `academicYear` joined. Reported to this agent as already recorded descriptively under `D-18` in the internal admissions/students audit evidence — a CITATION of the pre-mortem, not a file this agent opened (it is not present in this checkout). No OPEN row either way. Zero consumers makes a cap safe *later*. |
| `PF-291` | P3 `[reliability]` | `apps/api` has **no global Prisma exception filter** (`main.ts` registers `ValidationPipe` only), so every `P2023` / `PrismaClientValidationError` anywhere in the API is an unmapped 500. Per-endpoint pipes close this one route; the class stays open across the other controllers. This is the systemic form of `PF-51`. |
| `PF-293` | P3 `[privacy]` | `Enrollment.endReason` — free-text administrative reason a schooling ended, written by this same controller's cancel path as e.g. `'Annulation administrative'` — is returned **unprojected** by `list`, because only the *relations* of that query carry a `select`. Out of `AC-6`'s declared scope (`ClassSection` only). Record; do not widen this slice. |
| `PF-292` | P3 `[privacy]` | Second site of the whole-`ClassSection` projection in this same file: the `@Post()` create response also emits `classSection: { include: { gradeLevel: true } }`. Its audience is `enrollments.write`, held only by `school_admin` / `super_admin`, so `internalNotes` reaches only its own authors — **not a leak**, and deliberately not widened into this slice. Recorded so the next reader does not rediscover it as one. |
