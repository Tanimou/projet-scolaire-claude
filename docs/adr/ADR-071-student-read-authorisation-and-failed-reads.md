# ADR-071 — Student read authorisation has ONE resolver, and a failed read is never rendered as an empty fact

- **Status** Accepted (architecture ruling, `S-E03-2` — run 81)
- **Date** 2026-08-25
- **Story** `S-E03-2` — [`docs/daily-improvement-v3/stories/S-E03-2.md`](../daily-improvement-v3/stories/S-E03-2.md)
- **Epic** `V3-E03` — Canonical truth and query contracts (layer L0)
- **Advances (does NOT close)** `PF-05` — "the parent grades page returns zero even when supplied the child
  identifier". Three mechanisms are removed (the private ABAC copy, the failed-read-as-emptiness render, the
  unnamed child in the empty state); the count divergence between the two projections is **not demonstrated on the
  current seed** (§Context M-6′) and the endpoints are **not merged**. The row stays `advanced`, residual named
  in §D8
- **Closes** the `PF-288` teacher fail-open at its **two remaining sites** — `grades.controller.ts:466` and
  `lessons.controller.ts:367`. `S-E05-16` / `ADR-066` closed it at `StudentAccessService` only; this ADR closes the
  class and installs the ratchet that keeps it closed
- **Raises** `PF-335` (default-child divergence — the grades page renders ONE child, the dashboard aggregates ALL,
  and the empty state names neither) · `PF-336` (the `safe()` swallow-and-render-empty pattern, 60 server
  components, **two** divergent semantics) · `PF-337` (three permissions for one datum: `students.read`,
  `grades.read`, `grades.read.self`) · `PF-338` (the student portal holds **two** internal grade projections, so
  the "fifth" is the fifth *and* sixth) · `PF-339` (`analytics.service.ts:977` `if (!g.value) continue` drops a
  legitimate grade of **zero** on the north-star page)
- **Related** `ADR-066` (student ABAC — teacher scope + role UNION; **this ADR is its enforcement half**) ·
  `ADR-015` (permission model) · `ADR-021` (student self-ABAC) · `ADR-065 §D5` (the deny sentinel is
  `id: { in: [] }`, never an absent key; never `...(x ? { x } : {})` in a `where`) · `ADR-051 §D1` (`findForUser`,
  never `ensureForUser`, on a refusal path) · `ADR-058` (scope abort recovery) · `ADR-063 §D1` (no academic-year
  clause on the section-keyed wall) · `ADR-064 §D1a` (inventory derived by walk, never enumerated) ·
  `ADR-067 §D6` (one-way-ratchet house style) · `GUARDRAILS.md` §2 (parent access goes through
  `StudentAccessService`), §5

---

## Verdict

**CONCERNS — proceed, under the rulings below.**

No schema change, no migration, no new dependency, no new package, no new HTTP style, no response-shape change.
`G-MIGRATION` is correctly **not** triggered; `schema.prisma` must not be touched, and
`scripts/restore-drill-baseline.json` therefore owes no entry (`PF-80` not armed).

Three things in this slice are genuine architecture and are why this ADR is mandatory rather than optional:
a **module-wiring ruling** that decides how two more modules reach the canonical ABAC (§D1), an **ordering ruling**
that says the authorisation decision is resolved *outside* the tenant scope (§D2), and a **cross-cutting front-end
rule** — *a failed read is never rendered as a domain fact* — which is new as a stated rule even though every
mechanism it uses already exists (§D5). Two further rulings decline to do what the brief's plainest reading would
suggest: the two endpoints are **not merged** (§D3) and the ratchet is **not** stated over `guardianship`
queries (§D4).

The CONCERNS, not the FAIL, are: the slice touches an authZ seam on the north-star portal (P1, `[authz][truth]`,
escalation panel required); it widens `StudentAccessService`'s blast radius by two more call sites, which carries
`PF-281` with it (§D7); and its headline finding `PF-05` **cannot honestly be closed** by this work (§D8).

---

## Context — what was measured, and where the brief was wrong

Measured 2026-08-25 against the running local stack (`docker exec pilotage_postgres psql -U pilotage -d pilotage`)
and by reading the tree. The brief's M-1…M-7 are reproduced faithfully by the code, with **four corrections** that
change the design.

### C-1. The two projections, and the guard asymmetry the brief did not name

| | **A** — `GET /api/v1/analytics/parent-dashboard/:studentId` | **B** — `GET /api/v1/grades/students/:studentId/grades` |
|---|---|---|
| implementation | `analytics.service.ts:881` (`parentDashboard`) | inline, `grades.controller.ts:383-417` |
| guard | **`StudentAccessService.canAccessStudent`** (`analytics.controller.ts:180`) — canonical | **private `assertCanReadStudent`** (`grades.controller.ts:449`) — a fourth copy |
| permission | `students.read` | `grades.read` |
| year filter | `assessment.teachingAssignment.academicYearId === activeEnrollment.academicYearId`; **no active enrollment ⇒ hard `[]`** (`:926`) | none |
| `isAbsent` | `false` | unconstrained |
| falsy value | `if (!g.value) continue` (`:977`) — **also drops a grade of 0** | unconstrained |
| status | `published`/`revised` | `published`/`revised` for non-staff; **teacher/admin also see drafts** (`seePrivate`, `:395`) |

**The asymmetry the brief missed:** A and B do not merely differ in their `where`, they differ in **who is let
in**. For a `teacher` principal, A is *bounded* (post-`ADR-066`) and B is *unrestricted* — so B is **wider on
authorisation** while being **narrower on nothing**, and A is narrower on data. "A ⊂ B" holds for the *rows*, not
for the *callers*. Both halves of that sentence matter: the row containment is what makes the brief's deduction
sound, and the caller divergence is what makes `AC-1` a P1 rather than a tidy-up.

### C-2. The surfaces — the brief undercounts B by one, and misses the admin portal on A

`grep -rn "grades/students/\|parent-dashboard" apps/web/src`:

| projection | surfaces |
|---|---|
| **A** | `/parent/dashboard` (`:238`, in a loop **over every child**) · `/parent/subjects` (`:231`) · `/parent/children/[id]` (`:168`) · `/parent/children/[id]/report` (`:154`) · **`/admin/students/[id]` (`:113`)** — five, and one of them is the **admin** portal |
| **B** | `/parent/grades` (`:139`) · **`/parent/documents` (`:263`)** — two, not one |
| **C** | `/student/grades` → `student-portal.controller.ts:58` → `student-portal.service.ts:195` |
| **D** | the same student-portal service's **live fall-through** at `:682` — a *different* `where` (`isAbsent: false`, `value: { not: null }`, no year filter) behind a snapshot cache |
| **E** | `/teacher/grades` reads `/api/v1/teachers/me/recent-grades` — a **teacher-keyed** projection, not a student-keyed one |

So `AC-6`'s answer is: **six** projections of "this child's grades", not five. C and D live in the same file and
disagree with each other. That is `PF-338`.

### C-3. The class is FOUR sites, and the ratchet's obvious rule would catch SEVEN innocents

`grep -rn "guardianship.findFirst\|guardianship.findMany" apps/api/src` returns **twelve** non-spec sites. Only
**four** resolve *"may this caller read this student?"*:

| site | teacher branch | verdict |
|---|---|---|
| `students/student-access.service.ts:112` | UNION, **bounded** (`ADR-066 §D2`) | the canonical home |
| `attendance/attendance.controller.ts:637` | **bounded** (`teacherOfStudentWhere`, `S-E05-5`), ordering documented | correct, but private |
| `grades/grades.controller.ts:466` | `if (roles.includes('teacher')) return;` — **UNRESTRICTED** | `PF-288`, live |
| `lessons/lessons.controller.ts:367` | **no teacher branch and no admin branch at all** — only `if (roles.includes('parent'))`; every other holder of `lessons.read` (i.e. `teacher`, `school_admin`) passes with **no student check whatsoever** | worse than `PF-288` |

The other eight are **notification fan-outs** and **admin listings** — `assessments.controller.ts:339`,
`enrollments.controller.ts:446`, `alerts.service.ts:1029`, `announcements.service.ts:181`,
`analytics.service.ts:2826` and `:3217`, `guardians.controller.ts:224` — plus one idempotency check
(`child-claims.service.ts:514`). They are recognisable **by construction**, not by name: a fan-out matches
`guardian: { userProfileId: { not: null } }` (every guardian **with an account**), an authorisation matches
`guardian: { userProfileId: <the caller's own id> }` (**this** guardian). §D4 turns that into the rule.

### C-4. M-6′ — the seed reproduction the brief said did not exist

The brief's M-6 reports both endpoints answering `200` and agreeing (`n=1`), and concludes PF-05's count
divergence does not reproduce. Verified — and **incomplete**. `parent@pilotage.local` holds **two** active
guardianships, not one:

```
guardianship e9af2793… → 379643ab… Jade  Brun   — 1 published grade, 1 active enrolment, projection A = 1
guardianship 08719c9a… → 682ea2d7… Chloé Moreau — 0 published grades, 1 active enrolment, projection A = 0
```

`/api/v1/students` orders `[{ lastName: 'asc' }, { firstName: 'asc' }]` (`students.controller.ts:220`), so
**Brun** sorts first, `/parent/grades` defaults to `children[0]` (`page.tsx:~130`), and today the page shows
Jade's grade. Rename one child, add a third, or arrive without `?studentId` after the dashboard summarised a
*different* child, and the page renders **"Aucune note publiée"** — the literal PF-05 symptom — while
`/parent/dashboard`, which loops over **all** children (`page.tsx:238`), shows the published grade.

**This is a third, reproducible-on-demand PF-05 mechanism with no API divergence at all**, and neither the
audit text nor the brief names it. It is `PF-335`, and §D6 is its correction.

---

## Decisions

### D1 — the canonical ABAC is reached by **module import**, never by a local `providers:` copy

`GradesModule` and `LessonsModule` gain `StudentsModule` in `imports:` and drop nothing. They do **not** list
`StudentAccessService` in their own `providers:`.

This is a ruling *against* the two existing precedents, and the reason is written in
`students.module.ts:9-25`. `CalendarModule` (`:26`) and `EnrollmentsModule` (`:37`) provide the service **locally**
on the strength of a comment that says it "depends only on `PrismaService`, which is global". `S-E05-16` gave the
service a **second** constructor dependency and both files had to be patched under a comment that begins *"CETTE
JUSTIFICATION EST DEVENUE FAUSSE"*. A local `providers:` entry does not fail a test when the constructor changes —
it fails **Nest at bootstrap**, `Nest can't resolve dependencies of the StudentAccessService (PrismaService, ?)`,
which is a total outage, not a red suite. Two more copies would make four places to patch on the next constructor
change.

Cycle-freedom is **verified this run, not assumed**:

- `StudentsModule` imports `AuthModule`, `SchoolStructureModule`, `TeachingModule`.
- `SchoolStructureModule` imports `AuthModule` only. `TeachingModule` imports `AuthModule` + `SchoolStructureModule`.
- Nothing in that closure imports `GradesModule` or `LessonsModule`. `AnalyticsModule` imports `GradesModule`, and
  `StudentPortalModule` imports `StudentsModule` **and** `AnalyticsModule` — the resulting edge
  `StudentPortal → Analytics → Grades → Students` is a DAG because `StudentsModule` is a sink.

`CalendarModule` and `EnrollmentsModule` are **not** converted here. That is a scope ruling, not an endorsement:
converting them is a mechanical follow-up with a boot-failure mode, and this slice already carries a P1 authZ diff.

### D2 — the access decision is resolved **before** `scope.run`, never inside it

`lessons.controller.ts` currently performs its guardianship check **inside** `this.scope.run(tenantId, tx)`, on the
scoped `tx`. `StudentAccessService` reads on `PrismaService` — the **owner** connection. Calling it from inside an
open scope is refused for the reason `calendar.controller.ts:273-275` already states in production:

> *"HORS PORTÉE, et par nécessité : `scopeForUser` lit `guardianship` / `student` pour un parent, sur la connexion
> du PROPRIÉTAIRE. L'appeler depuis l'intérieur de la portée ferait détenir DEUX connexions au processus pendant
> toute la transaction interactive."*

Two further reasons compound it: a `ForbiddenException` thrown inside `scope.run` **aborts an interactive
transaction** to deliver a 403 that needed no transaction at all (`ADR-058` exists because scope aborts are not
free), and holding a second connection for the duration of every parent lessons read is a pool sink on the
latency-sensitive parent portal.

**Boundary, exactly:** in `lessons.controller.ts`, hoist the `studentId` authorisation above the
`return this.scope.run(...)` line. The *enrolment lookup* that follows it (`tx.enrollment.findMany`) stays inside
the scope — it is data, not authorisation.

### D3 — the two endpoints are **NOT** merged. One shared `where`-builder, in the `teaching-wall.where.ts` shape

The slice title says "ONE guarded contract". That is satisfied by **one guard** (§D1) and **one predicate**, not by
one endpoint. Merging A and B would change response shapes on **seven** surfaces including `/admin/students/[id]`,
and would be a new architectural decision of its own. `DNC-01` forbids the other failure mode explicitly: **do not
introduce a fifth projection while unifying** — and per §C-2 there are already six, so a new "unified" one would be
the seventh.

The address for the predicate is a **leaf** module in the house shape already set by
`apps/api/src/modules/teaching/teaching-wall.where.ts`: imports `type { Prisma }` and **nothing else** — no Nest
decorator, no provider, no service import — so it can be imported from a controller *and* from a service without
creating a module edge or a CJS require cycle. `teaching-wall.where.ts:1-30` documents that exact hazard and why
the file exists.

**Required properties of the builder** (each is a rule this repo has already paid for):

1. Every optional dimension is expressed as an **explicit parameter with an explicit branch**, never
   `...(x ? { x } : {})`. `ADR-065 §D5`: Prisma **strips `undefined` keys** and the query silently **widens**.
   Grep the diff for that shape before shipping it.
2. `tenantId` and `studentId` are **non-optional in the type**, for the same reason `teacherSectionsWhere`'s
   `teacherProfileId` is: a stripped key turns the predicate into "every row in the table".
3. The **year** dimension keeps A's semantics as an explicit, named argument, including the `[]`-on-no-enrolment
   behaviour of `analytics.service.ts:926` — it is a *decision* (`PF-329`), and hiding it inside a shared default
   would make B silently inherit an unstated rule.
4. `isAbsent` and the zero-value rule are **parameters, not constants** — B legitimately shows an absence row and A
   legitimately excludes it from an average.

### D4 — the ratchet is stated over **authorisation resolution**, not over `guardianship` queries

Per §C-3, eight of the twelve `guardianship.find*` sites are fan-outs and listings. A rule written as *"no
`guardianship` query outside `student-access.service.ts`"* would flag all eight, and at gate time only the three
outcomes the story forbids remain: an allowlist that swallows the rule, an out-of-scope conversion, or relaxing the
rule until it passes (`R-30`, run 22). `academic-year-resolution-gate.spec.ts:16-35` records this trap being fallen
into and climbed out of; do not re-enter it.

**The rule, in one line.** A function is a *student-authorisation resolution* when, in the same function body, it
(a) reads roles from `realm_access.roles`, **and** (b) issues a `guardianship` read whose `where` binds
`guardian: { userProfileId: … }` to the **caller's own** id, **and** (c) throws `ForbiddenException`. Such a
function must live in the file that **declares `canAccessStudent`**.

Non-negotiable properties, all inherited from `ADR-064 §D1a` / `ADR-067 §D6` and from the house exemplar
`academic-year-resolution-gate.spec.ts`:

- **Inventory derived by walk**, never a hand-typed path list. Two hand-kept lists is the drift that already cost
  this repo a 503 on four portals.
- **Home recognised by construction** — the file declaring `canAccessStudent`, asserted to be **exactly one**.
  Zero means the resolver vanished and the ratchet is decorative; two means re-divergence already happened.
- **Fixtures name no real model.** `body-metatype-gate.spec.ts:761` records the collision: a real model name
  spelled out in a fixture becomes a false positive for the next reviewer's grep. Pass the model name as a
  parameter; use a synthetic name in fixtures.
- **Anti-vacuity floor**, measured per walked root, asserted below the measured count.
- **Negative control**: fixtures that must **pass** — a notification fan-out and an admin listing — alongside
  fixtures that must **fail**. Without a passing case an always-red comparator satisfies every red case and proves
  nothing (run 45 / `TOOL-13`).
- **No `SKIP_*`, no `ALLOW_*`, no `NODE_ENV` escape** (`DNC-10`).
- If `attendance.controller.ts` stays allowlisted, the entry **carries its reason inline** — *"bounded teacher
  branch via `teacherOfStudentWhere`, `S-E05-5`; ordering choice documented at `:610-621`; conversion deferred,
  `PF-266` recorded"* — and the allowlist is asserted to contain **exactly** that entry.

**The brief's TS6059 warning is stale.** `apps/api/tsconfig.build.json` already sets `rootDir` **and** excludes
`**/*.spec.ts`, and `keycloak-client-identity-gate.spec.ts:11-12` already imports
`../../../../web/src/lib/keycloak-clients`. A gate reading `apps/web` sources needs **no tsconfig edit**. Do not
"fix" a configuration that is already correct.

### D5 — a failed read is NEVER rendered as a domain fact. Reuse `ApiResult`, reuse `ErrorState`, add no new `safe()`

This is the `PF-05` core and the one genuinely new *rule*. Every mechanism it needs already exists and **must be
reused**:

| need | existing convention | address |
|---|---|---|
| a two-state read result | `ApiResult<T> = { ok: true; data: T } \| { ok: false; error: string }` | `api-client.ts:151` |
| error → result, safely | `apiResultFromError` — re-throws Next navigation signals **first**, never leaks `connect ECONNREFUSED 127.0.0.1:4000` to the browser, always returns a `string` | `api-client.ts:197` |
| an honest failure render | `ErrorState` — `role="alert"`, optional retry, already used by four `/student` pages | `@pilotage/ui`, `packages/ui/src/components/ErrorState.tsx` |

**Do not write a 61st `safe()`.** There are **60** `async function safe<T>` copies under `apps/web/src/app`, and
they do **not** agree: `/parent/grades:39` catches **only** `ApiError` and rethrows everything else, while
`/parent/dashboard:248` catches **everything**, guards `isNextNavigationSignal`, and logs. Adding a variant makes
it 61 with three semantics. That divergence is `PF-336`; this slice adopts the shared shape at the **two reads
named in `AC-4` and nowhere else** (`GUARDRAILS §5` — one coherent improvement per run).

The rendering contract, stated so a reviewer can check it:

- `{ ok: false }` on the **grades** read renders `ErrorState` — *"Nous n'avons pas pu charger les notes"* + retry.
  It **must not** render `EmptyState "Aucune note publiée"`.
- `{ ok: false }` on the **child-list** read renders `ErrorState`. It **must not** render
  `EmptyState "Aucun enfant rattaché"` — telling a parent their children are not linked to their account, because
  a server returned 500, is worse than the grades case.
- `{ ok: true, data: [] }` keeps the existing `EmptyState`, amended per §D6.
- The navigation-signal escape is **preserved, not merely inherited**: `api()` calls `redirect()` on 401, which
  throws a `NEXT_REDIRECT` digest. `apiResultFromError` re-throws it *first*; a hand-rolled `catch` that returns
  `{ ok: false }` instead would leave an expired session staring at the string `NEXT_REDIRECT;replace;/parent/login`
  (`PF-174`, already lived).

### D6 — the empty state must NAME THE CHILD

Per §C-4/`PF-335`, `/parent/grades` renders exactly **one** child while `/parent/dashboard` aggregates **all** of
them, and the empty state says *"Aucune note publiée"* — a sentence with no subject, which a parent reads as a
statement about **the school**, not about **this child**. That unqualified sentence is what makes the divergence
*invisible* rather than merely present.

The empty state must read *"Aucune note publiée pour <Prénom Nom>"*, with the child's name taken from the already
loaded `children` array — no extra fetch. This is a one-line correction inside `AC-4`'s file and it is the cheapest
honest thing in the whole slice.

### D7 — what this slice makes WORSE, stated rather than discovered

`AC-1` and `AC-2` route two more handlers through `StudentAccessService`, and `PF-281` rides along:
`findForUser` **ignores `TeacherProfile.active`**, so a deactivated teacher keeps the full taught-student scope.
`ADR-066 §D6` priced this at ~25 call sites; this slice makes it ~27. Not fixed here, restated here so the next
reader does not believe the ratchet closed it.

`AC-1` also **narrows** teacher access to `/grades/students/:id/stats` and `/grades/students/:id/grades` from *the
whole tenant* to *taught students*. That is the point, and it is a **behaviour change on a live portal**: a teacher
who previously opened any pupil's grade sheet from a deep link now gets 403. `ADR-066 §D1` already ruled that "a
wall that widens with history is not a wall"; the same ruling applies, and the release note must say so.

`ensureForUser` must appear **nowhere** on either refusal path (`PF-265` / `ADR-051 §D1`) — it is an UPSERT and
would provision a `TeacherProfile` on every probe. `StudentAccessService` already uses `findForUser`; the
conversion inherits that and must not reintroduce the upsert at the call site.

### D8 — `PF-05` is ADVANCED. It is not closed, and the row must not read plain `closed`

Three mechanisms are removed: the private ABAC copy (§D1), failed-read-as-emptiness (§D5), and the subject-less
empty state (§D6). What remains open:

1. **The count divergence is not demonstrated.** On today's seed both endpoints answer `200` and agree
   (`n=1`). The audit sentence describes a state the current data does not produce; `AC-7` anticipated this and
   the honest outcome is `advanced`.
2. **The four `where` axes still diverge in production** unless §D3's builder is adopted by **both** call sites.
   Adopting it in one is worse than adopting it in neither — it creates a canonical predicate that one of the two
   canonical consumers ignores.
3. **Six projections remain six** (§C-2). `PF-338` names the two inside the student portal that disagree with each
   other; `PF-337` names the three permissions.
4. **`PF-339`** — `if (!g.value) continue` still deletes a grade of **zero** from every A-backed surface,
   including the north-star dashboard. The naive fix is wrong twice over: `value` is a Prisma `Decimal`, and
   `Number(0)` is falsy. The correct predicate is `g.value == null`. Recorded, deliberately **not** fixed here
   (`RECORD, DON'T FIX`), because changing an average on five surfaces is its own slice with its own evidence.

**Closing `PF-05` on the strength of `AC-1`…`AC-4` would be exactly the kind of KPI/ledger divergence `DNC-01`
exists to forbid.** Write `advanced`, name `PF-335`…`PF-339` in `OPEN.md`, and allocate those ids **against open
PRs as well as `main`** — `PF-185`/`PF-186`/`TOOL-27` each named two findings on 2026-08-14 because the allocator
read only `main`.

---

## Consequences

**Positive.** The `PF-288` teacher fail-open stops existing anywhere in the tree, and a ratchet prevents its
fifth incarnation. The parent portal stops asserting a falsehood — *"the school has published no grades"* — on
every 403/404/500. `/parent/grades` stops being ambiguous about which child it is describing. Two more modules
reach the ABAC through the same door, so the next constructor change patches one file, not five.

**Negative, accepted.** A teacher loses tenant-wide grade reads (§D7). `PF-281` reaches two more handlers (§D7).
`GradesModule` and `LessonsModule` gain a module edge to `StudentsModule`, which is a coupling the enrollments
precedent deliberately avoided — §D1 argues the boot-failure mode costs more than the edge. The `ApiResult` shape
now has two consumers with different lifetimes (server actions, server-component reads) and 58 pages still on the
old pattern; `PF-336` must be visible in `OPEN.md` or the inconsistency will read as an accident.

**Neutral.** No migration, no schema change, no contract build change, no new dependency, no new package,
`packages/contracts` CJS pin untouched (`GUARDRAILS §2`).

---

## Verification this ADR expects (Evidence Tier A, non-downgradable)

1. Full gate table — `G-AUTHZ`, `G-TENANT`, `G-TRUTH`, `G-PORTAL`, `G-DNC`.
2. **RED-BEFORE, evidenced by execution, not asserted** — a teacher with zero `TeachingAssignment` for the student
   is granted today on **both** `/grades/students/:id/grades` and `/lessons?studentId=…`, and denied after. Run the
   spec against the pre-diff code, paste the failure count, then restore (`school-context-tenant-scope.spec.ts` in
   `S-E03-4` is the house precedent for how to evidence this).
3. The one-way ratchet of §D4, with its floors, its negative control, and its allowlist asserted **exactly**.
4. **An EXECUTED live probe** committed as a runnable script, minting tokens the way
   `scripts/keycloak-live-probe.js` does (`adminToken()` `:151`, `mint()` `:279`, `secretOf`/`passwordOf`
   `:252`/`:268`) — **never a re-typed password literal** (`PF-228`). `landed: true ≠ ran: true`: run 77 shipped a
   structurally inexecutable probe. The probe must at minimum assert the teacher denial and the two projections'
   agreement on the Jade Brun fixture.
5. `pnpm typecheck` green, run **once**, by the test-architect only. Read the **last** `GATE:` line — never grep
   for it (`tenant-scope-deployment-check.js:261` prints a bare `GATE: PASS` around line 84).

*(Written 2026-08-25, `S-E03-2` planning pass — Winston, BMAD Architect.)*
