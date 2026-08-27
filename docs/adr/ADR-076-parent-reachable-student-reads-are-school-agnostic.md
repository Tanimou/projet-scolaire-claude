# ADR-076 — A student read restricted by an ABAC id set is school-agnostic; the school working scope belongs to the UNRESTRICTED path only

- **Status** Accepted (architecture ruling, `S-E03-3d` — run 88)
- **Date** 2026-08-26
- **Story** `S-E03-3d` — PF-12 axes 4 and 7: the parent LIST stops disagreeing with the parent DETAIL page about
  which children exist (`PF-356`), and a FAILED read stops being rendered as « Aucun enfant rattaché » (`PF-363`)
- **Epic** `V3-E03` — Truth & coherence (layer L0)
- **Closes** `PF-356` (axis 4 of `PF-12`) · `PF-363` (axis 7 of `PF-12`).
  **`PF-12` itself stays `open` / ADVANCED** — axes 5 (`PF-359`, blocked on `PF-362`'s semantic ruling) and 6
  (`PF-360`, blocked on a product decision about whether `Student.status` gates parent visibility) are untouched
  by this slice and are not resolved. `PF-12` MUST NOT be marked closed on this PR.
- **Raises** `PF-389` (the calendar list reproduces axis 4 on a different aggregate) · `PF-390` (`?unenrolled=true` is still keyed on `SchoolContextService.forUser`'s academic year, so the filter can be
  evaluated against a year the child's school does not run) ·
  `PF-394` (`scopeForUser` / `canAccessStudent` carry a DEAD `schoolId` parameter at ~25 call sites, advertising a
  school dimension nothing enforces) · `PF-395` (`parent/grades/page.tsx` keeps a bespoke copy of the
  children-read failure text that the shared component now duplicates). Ids allocated from **PF-389 upward**:
  `PF-380..PF-388` are held by open PR #279 and are therefore invisible in `main`'s `OPEN.md`
- **Related** `ADR-071 §D5` (a failed read is never rendered as a domain fact — `read()` / `ReadErrorState`, and
  **do not write a 61st `safe()`**) · `ADR-072` (canonical active enrollment; the "key on the school that BEARS
  THE ROWS" idiom) · `ADR-073` (the parent attachment surface projects from the fact) · `ADR-074` (canonical
  guardianship liveness — `guardianshipLiveWhere()`, the ONE home of the predicate) · `ADR-066` (student-access
  teacher scope and role union; `§D6` prices the inherited `PF-281`) · `ADR-065 §D5` (`studentIds: null` is the
  unrestricted sentinel; `[]` is the DENY and must produce `id: { in: [] }`) · `ADR-002` (tenant scoping) ·
  `GUARDRAILS.md` §2, §4, §5

---

## Verdict

**CONCERNS — proceed, under the rulings in `§D1`–`§D9`.**

Three things make this ADR mandatory rather than optional:

1. **A key is being REMOVED from a tenant-scoped Prisma `where`.** That is the `PF-11` class. It is the reason
   Evidence Tier A is not gradeable downward and the reason `§D4`'s negative tests are not optional.
2. **The rule generalises beyond the one line it fixes** — it decides, for every future scoped read, which of two
   scoping mechanisms is authoritative when both are in hand. Without a written rule the next controller will
   re-intersect them and re-manufacture `PF-12`.
3. **The finding's own population was wrong on axis 7**, and the corrected population is derived, not enumerated
   (`§D6`). A ratchet keyed on the STRING would have shipped green while the north-star page stayed broken.

No schema change, no migration, no new dependency, no new package, no guard or permission touched.
**`G-MIGRATION` is correctly NOT triggered** — `schema.prisma` must not be opened, so
`scripts/restore-drill-baseline.json` owes no entry (`PF-80` not armed). `G-AUTHZ` is **not** triggered: no
`@RequiresPermission`, no guard, no DTO, no permission-catalogue row changes (`§D8`). `G-AUDIT` not triggered
(read-only).

---

## Context — measured in source on 2026-08-26, in this checkout

**No live probe was possible and none is claimed.** Docker Desktop refuses to start this run and local
`pilotage@5432` holds 0 schools / 0 students / 0 guardianships, so every statement below is a source measurement
or a fixture-backed test expectation. Nothing in this ADR was executed against a running stack.

### C1 — the ABAC scope is ALREADY school-agnostic; the contradiction is in the controller

`apps/api/src/modules/students/student-access.service.ts:86-90` declares
`scopeForUser(user, jwt, _schoolId)`. The third parameter is underscore-prefixed and genuinely unread — the
file's own header (`:60-78`) says so in as many words: *the "school" dimension of this scope is not enforced*,
and `enrollments.controller.ts:678` passes `''` deliberately. The parent branch (`:109-117`) resolves
guardianships by `tenantId: user.tenantId` + `guardianshipLiveWhere()` + `guardian.userProfileId` — tenant-keyed,
school-free. **Verified: the brief's claim holds.**

`apps/api/src/modules/students/students.controller.ts:173-176, 193-196` then builds

```
const { schoolId, activeAcademicYearId } = await this.ctx.forUser(me);
const scope = await this.access.scopeForUser(me, jwt, schoolId);
const where = { tenantId, schoolId, ...(scope.studentIds === null ? {} : { id: { in: scope.studentIds } }) };
```

and that bare `schoolId` comes from `SchoolContextService.forUser` →
`school-structure/school-context.service.ts:100-128`, whose own doc comment reads *"the school in the tenant with
the most data attached… ties broken by createdAt asc"*. **Verified.**

`students.controller.ts:398` — the DETAIL path — gates on
`canAccessStudent(me, jwt, student.id, student.schoolId)` and carries **no school filter**. **Verified.**

**Therefore, in a multi-school tenant, a parent whose child sits in any school other than the heuristic "biggest"
one gets an EMPTY `GET /students` while `GET /students/:id` renders that same child in full.**

### C2 — the contradiction is wider than "list vs detail", and the parent portal already shows both sides

`apps/web/src/app/parent/children/page.tsx:132` reads `/api/v1/parent/child-claims`, which projects from
`Guardianship` (`ADR-073`) and is school-free; the same file at `:162` reads `/api/v1/students`, which is
school-filtered. **One page reads the same family through two projections that disagree.**
`apps/worker/src/modules/parent-digest/parent-digest-cron.service.ts` carries no `schoolId` at all — the digest
mails a parent about a child the portal list denies exists. **Verified.**

### C3 — the codebase has ALREADY written down the governing idiom

`students.controller.ts:335-338`, shipped by `S-E03-3` / `ADR-072`:

> *"La clé est l'école QUI PORTE LES LIGNES (`student.schoolId`), jamais `SchoolContextService.forUser`… Dans un
> tenant multi-écoles, keyer sur `forUser` ferait résoudre… DEUX années canoniques différentes — PF-12 reproduit
> dans son propre correctif, sur un axe neuf (axe 4 / PF-356)."*

The previous slice named this exact defect, in this exact file, and fixed it for the academic-year key only.
**This ADR is the generalisation of a rule this repository has already accepted — not a new invention.**

### C4 — axis 7, re-measured: the finding's row understates the population, and its keying is wrong

The row names six pages. The brief re-counted twelve. **Both are wrong, and the string is the wrong key.**

- Files under `apps/web/src/app/parent/**` containing « Aucun enfant rattaché »: **13**
  (attendance, calendar, children, comments, documents, grades, lessons, messages, messages/new, recommendations,
  settings, subjects, upcoming).
- Files under `apps/web/src/app/parent/**` that read `GET /api/v1/students`: **14** — the 13 above **plus
  `dashboard/page.tsx:205`**, which collapses a failed read to `[]` and renders *"Ajoutez votre enfant pour
  suivre sa scolarité"*. Different words, identical defect, on the page the north star calls **the core of the
  product**.
- Of those 14, exactly **1** (`grades/page.tsx`) routes the children read through `read()`.
  **`children/page.tsx` is HALF-converted**: `read()` for `/parent/child-claims`, `safe()` for `/students`, and
  its « Aucun enfant rattaché » `EmptyState` (`:266`) is dominated by the `safe()` collection. It imports
  `@/lib/read-result` and is still a live `PF-363` site — the import is not the test.

**So the true unconverted population is 13 files, not 6 and not 12** (`§D6` fixes the derivation).

---

## Decisions

### D1 — The rule (axis 4). ADOPTED, with the boundary stated as a disjunction, not a subtraction

> **When a read is restricted by an EXPLICIT ABAC id set, that set is the authority and the read is
> school-agnostic. When the scope is UNRESTRICTED (`studentIds === null`), the school working scope applies.**

The two branches are **mutually exclusive and jointly exhaustive**, and that is the load-bearing property: the
rule is not "drop `schoolId`", it is "`schoolId` and `id: { in: … }` never co-occur on a student read". A reader
who is told only "drop the key" will drop it on the admin path too, and `§D3` is why that would be wrong.

**Why the intersection adds no security.** `scope.studentIds` is computed inside `user.tenantId` on all three
restricted branches (parent → `guardianship.tenantId`; teacher → `teacherStudentIds`; student-self →
`student.findFirst({ where: { tenantId, userProfileId } })`). Every id in the set is therefore already a
same-tenant id the caller is entitled to. Intersecting that set with a *heuristic* — "whichever school happens
to hold the most students today" — cannot subtract an id the caller was not entitled to; it can only subtract
ids the caller **is** entitled to. It buys nothing and manufactures the contradiction. `§D4` requires this to be
proven by test rather than believed from this paragraph.

**Refutation considered and rejected.** One could argue the school key is defence-in-depth against a future bug
in `scopeForUser` that returns a foreign-tenant id. It is not: a foreign-tenant student is in a foreign-tenant
*school*, so `tenantId` — which stays — already denies it, and the `schoolId` key would deny it only by accident
of the heuristic landing on the right school. Defence-in-depth that works only when a heuristic guesses right is
not defence-in-depth. The real defence is `tenantId`, and it is untouched.

### D2 — The rule gets ONE home, and it is a PURE function, not an inline ternary

The predicate lands in a new module, `apps/api/src/modules/students/student-scope-where.ts`:

```
export function studentScopeWhere(
  scope: { studentIds: string[] | null },
  ctx: { tenantId: string; schoolId: string },
): Prisma.StudentWhereInput
```

- `studentIds === null` → `{ tenantId, schoolId }`
- otherwise → `{ tenantId, id: { in: scope.studentIds } }` (**including `[]`, which stays the DENY** — `ADR-065 §D5`)

Three reasons this shape and not another:

1. **`§D4` needs it testable with no database.** No live probe is possible this run. A pure function over a
   plain object is provable by unit test; a ternary inside a controller method is not, and a Nest-DI service
   method drags `PrismaService` into the fixture for nothing.
2. **The ratchet needs a named target** (`§D5`). "No student `where` pairs `schoolId` with an id set" is
   checkable; "the controller got it right" is not.
3. **It is where the repo puts this kind of thing.** `guardianshipLiveWhere()` (`ADR-074`),
   `guardianshipOnTheBooksWhere()` (`ADR-075`), `link-liveness.ts` — one predicate, one home, exported as a
   `where` fragment. This is the fourth instance of an established idiom, not a fifth idiom.

**It does NOT go in `packages/contracts`.** The return type is `Prisma.StudentWhereInput`; `ADR-072 §A1` holds
that contracts modules take no Prisma dependency. **It does NOT go in `link-liveness.ts`** — the brief's warning
that the guardianship predicate has exactly one home is about *guardianship liveness*, a different predicate.
Putting a Prisma-typed `where` builder into `packages/contracts/src/guardianship/` would violate `ADR-072 §A1`
and conflate two predicates. **One home each, not one home total.**

### D3 — `StudentAccessService` is NOT modified, and `_schoolId` is NOT deleted this slice

The service's signature is already correct: it is school-agnostic and says so. Deleting the dead parameter
touches ~25 `canAccessStudent` call sites across alerts, messaging, remediation, parent-exports, student-portal
and enrollments — a wide mechanical refactor with no behavioural content, inside a slice that is already removing
a key from a tenant-scoped `where`. **Recorded as `PF-394`, not fixed** (`RECORD, DON'T FIX`).

### D4 — Evidence: Tier A, and the negative half is the load-bearing half

`AC-1` (agreement) is the *easy* half. The half that must not be waved through is `AC-2`, because this is the
`PF-11` class. Required, all on fixtures (no live probe, none claimed):

| # | Test | Must show |
|---|---|---|
| T1 | Multi-school fixture, parent's child in the **non-biggest** school | `GET /students` returns the child (**RED before**) and `GET /students/:id` returns the same child — **one population, both paths** (`G-TRUTH`) |
| T2 | Foreign-tenant student | still **denied** — `tenantId` survives the edit (`G-TENANT`) |
| T3 | Same-tenant student the parent does **not** guard | still **denied** — `id: { in: … }` survives the edit |
| T4 | `scope.studentIds === []` | yields `id: { in: [] }`, not an absent key (`ADR-065 §D5` regression guard) |
| T5 | Admin (`studentIds === null`) | `where` is byte-identical to `main`'s — school working scope preserved (`AC-3`, `G-PORTAL`) |
| T6 | Teacher and student-self branches | school-agnostic, bounded by their own id sets (`G-PORTAL` — the student-self branch shares `scopeForUser`) |

T2 and T3 are **explicit negative tests**, not an argument in this ADR. `AC-2` says so and I am not softening it.

### D5 — The ratchet (`AC-4`): a NEW gate file, walk-derived, with a per-root vacuity floor

**Home:** `apps/api/src/shared/quality/student-school-scope-gate.spec.ts` — a new file, not an extension of
`student-authz-locality-gate.spec.ts`. That gate's rule is about **where authorisation is resolved**; this rule
is about **what keys a scoped read**. Different predicate, different failure message. The repo's convention is
one gate file per topic (41 files, 41 topics); `academic-year-resolution-gate` and
`enrollment-activity-derivation-gate` are the precedent for sibling topics staying separate.

**Rules:**

- **R1 (form).** Under `apps/api/src` and `apps/worker/src`, no object literal that reaches a Prisma `student`
  read (`findMany` / `findFirst` / `findUnique` / `count` / `aggregate` / `groupBy`) may bind **both** a
  `schoolId` key **and** an id-set restriction derived from a `scope`/`studentIds` expression.
  `student-scope-where.ts` is the sole file permitted to name both in one module — and there they are in
  **disjoint branches**, which R1 checks structurally rather than by allowlisting the filename.
- **R2 (home).** Every consumer of `scopeForUser` that builds a student `where` calls `studentScopeWhere`. A
  second hand-rolled spread of `scope.studentIds` into a `where` is a violation. This is the anti-drift rule:
  two hand-kept lists is the failure mode this repo has already paid for.

**Anti-vacuity floor (mandatory — `AC-4` says a ratchet that matches nothing must FAIL, not pass):**
per-root file-count floors (a GLOBAL floor stays satisfied by `apps/api` alone while a root silently drops out of
the walk — the lesson written into `student-authz-locality-gate.spec.ts`), plus ≥1 discovered `scopeForUser`
consumer, plus a **negative control** on a fixture under `__fixtures__/` carrying the forbidden shape (must be
flagged) and a **positive control** on the compliant shape (must pass). The inventory is **derived by walk, never
enumerated** (`ADR-064 §D1a`).

**RED-BEFORE is mandatory and must be a REAL pre-slice shape** — `students.controller.ts:193-196` is a genuine
R1 violation today, so the gate must be demonstrated flagging that exact construction before it is demonstrated
passing here. A ratchet whose red-before was only ever hypothetical is not evidence.

**Deviation, taken deliberately and recorded here (this paragraph is what
`student-school-scope-gate.spec.ts`'s docblock defers to).** The draft of this section required the red-before to
be read off `origin/main` sources via `git show`. The implementation declined that idiom and it is **right to
have declined**: this repo has already ruled against it and written the ruling down — `walk-read-gate.spec.ts`
records that a control built on `git show HEAD:` **inverts** the moment the slice is committed, and that CI
checks out at depth 1, so the `origin/main` blob is not reliably present. The house idiom is the **pre-slice
construction reconstructed inside the spec** (`audit-provenance-gate`, `open-redirect-gate`). That is what
ships: the exact `where` literal measured in `students.controller.ts` on 2026-08-26, rebuilt line-by-line and
fed to the same classifier, so it stays red forever instead of only until the commit. The substance `AC-4` asked
for — a genuine, non-hypothetical offending shape, flagged — is delivered; the mechanism differs and the
difference is stated rather than taken in silence.

**Second, smaller deviation, same class.** This section asks for the negative and positive controls to sit on a
fixture **file** under `__fixtures__/`. They are implemented as concatenated source strings classified against a
`FIXTURE_PATH` constant instead (5 red-before cases + 4 positive controls, all discriminating). Substance
satisfied, letter not. **Recorded, not re-scoped** — folding them into a fixture file is a later chore, not a
correction to this decision.

### D6 — Axis 7: the population is keyed on the READ, not on the string

`AC-5` names the population by the string « Aucun enfant rattaché ». **That keying is wrong and I am ruling
against it**, because it silently exempts `dashboard/page.tsx` — the north-star page — which commits the identical
defect with different words (`§C4`). A ratchet keyed on the string would ship **green** over a broken core page.

> **The population is: every file under `apps/web/src/app/parent/**` that renders a claim about the family
> dominated by a read of `GET /api/v1/students`.** Derived, that is **14 files**; **13 are unconverted**
> (`grades/page.tsx` is the one converted site; `children/page.tsx` is HALF-converted and counts as unconverted).

`dashboard/page.tsx` is therefore **in scope**, and this is not scope creep: `PF-363` *is* "a failed read rendered
as an emptiness claim", and the dashboard is that, on the same read, in the same portal. The conversion is the
same per-file edit as the other twelve.

### D7 — Axis 7 shape: ONE shared reader + ONE shared failure render — do not write the failure branch 13 times

Thirteen inline copies of `read()` + a bespoke `ReadErrorState` branch would replace one duplication (13 copies
of `safe()`) with another (13 copies of a failure render for **the same read**). Two shared pieces, both
compositions of what already exists:

1. **`apps/web/src/lib/parent-children.ts`** — `readParentChildren<T>(label): Promise<ReadResult<T[]>>`, a thin
   wrapper over `read()` + `api()` that unwraps `.data`. **Generic over the row type on purpose**: the 14 call
   sites use several different local row interfaces (`StudentSummary`, `Child`), and forcing one shared DTO would
   turn a read-path fix into a type migration. Each page keeps its own local interface; only the read path is
   shared. Precedent: `apps/web/src/lib/me.ts` is exactly this kind of shared server reader.
2. **`apps/web/src/components/parent/ChildrenReadError.tsx`** — a thin wrapper over the existing
   `@/components/ReadErrorState`, carrying the canonical children-read copy and deriving `variant` / `retryable`
   from `isAccessDenied`. It renders **only** the error block; each page keeps its own `PortalShell` +
   `PageHeader`, which differ per page. Precedent: `components/parent/ChildLinksPanel.tsx` already composes
   `ReadErrorState` this way.

**No new `@pilotage/ui` primitive.** `ErrorState` and `EmptyState` already exist and are reused unchanged
(`GUARDRAILS` §2: *"reuse `@pilotage/ui` first"*). `ChildrenReadError` is app-level composition, so it belongs in
`apps/web/src/components/parent/`, not in `packages/ui`.

**Copy rules, binding:**
- The shared component's strings are **copied byte-for-byte** from the four tuned strings in
  `parent/grades/page.tsx:141-156` (`PF-346`'s land-pass fix). *"The wording S-E03-2 tuned"* must not be
  re-drafted.
- **An EARNED empty keeps its existing per-page copy verbatim.** Each of the 13 pages has bespoke, page-specific
  empty-state prose (« Le cahier de texte apparaîtra ici… », « Les commentaires des enseignants apparaîtront
  ici. »). Those strings are **not** touched. Only the `null`→`[]` collapse is removed.
- `calendar/page.tsx` is the one page whose empty state promises something else remains visible (*"Le calendrier
  de l'établissement reste consultable ci-dessous"*). Its **failure** branch must not hide the school calendar,
  or the page would trade one false claim for another.
- `settings/page.tsx` carries the claim **twice** — an `EmptyState` (`:361`) and a KPI badge derived from
  `childCount` (`:287`). **Both** are dominated by the same read and both must be converted; a badge that says
  « Aucun enfant rattaché » next to an honest error block is the contradiction re-created inside one page.
- `grades/page.tsx` is **NOT** re-wired (hard constraint). Its bespoke copy will duplicate the shared component's
  — recorded as `PF-395`, to fold in a later slice.

### D8 — Gate ledger

| Gate | Applies | Ruling |
|---|---|---|
| `G-TRUTH` | **yes** | One fixture, one population, both paths (`§D4` T1). The `GET /students` `total` is computed from the same `where`, so the count moves with the list. **KPI scope label:** the parent list is *"the children this caller guards, tenant-wide"* — no longer *"…within the default school"*; `settings/page.tsx`'s child-count badge inherits that scope and must not be captioned otherwise |
| `G-PORTAL` | **yes** | Four portals checked. **admin** unchanged (`§D3`, T5). **teacher** — the taught-student list widens from "taught ∩ default school" to "taught", which is the intended correction but IS a behaviour change; see `§D9`. **parent** — the fix. **student** — the student-self branch shares `scopeForUser`, so `GET /students` becomes self-consistent for a learner outside the default school; `/student-portal/*` is unaffected because it passes `schoolId` only into the dead parameter (`§C1`) |
| `G-TENANT` | **yes** | A key is being removed from a tenant-scoped `where`. `tenantId` stays on **both** branches of `studentScopeWhere`, and T2 proves the foreign-tenant denial explicitly rather than arguing it |
| `G-DNC` | **yes** | `DNC-06` is the class being CLOSED (axis 7) and must not be reintroduced — hence `§D6`'s read-keyed population. **`DNC-11` is the boundary**: the widening admits only ids already in `scope.studentIds`, which for a parent is `guardianshipLiveWhere()` — a **refused or revoked** applicant is not in it (`ADR-074`), so no refused applicant enters the official population. T3 is the guard on that boundary |
| `G-AUTHZ` | **no** | No guard, decorator, DTO or permission metadata changes. If the implementation finds itself editing `@RequiresPermission`, that is a signal the design drifted — stop and re-enter at this ADR |
| `G-MIGRATION` | **no** | `schema.prisma` is not opened. No `restore-drill-baseline.json` entry is owed |

### D9 — Costs stated, not discovered later

1. **The teacher list widens.** A teacher teaching in two schools of one tenant currently sees only default-school
   students in `GET /students`; after this change they see all students they actually teach. Correct per
   `ADR-066`, but it is a visible change on a portal this slice is not otherwise touching, and T6 must pin it.
2. **`PF-281`'s blast radius grows with it.** `ADR-066 §D6` prices the inherited defect that
   `findForUser` ignores `TeacherProfile.active`, so a DEACTIVATED teacher keeps the taught-student scope. After
   this change that stale scope is no longer incidentally clipped to one school. The defect is unchanged; its
   reach is not. Stated here because `ADR-066 §D6` set the precedent of stating it.
3. **Admin and parent now scope differently on the same endpoint** — deliberate (`§D1`), and exactly why the rule
   is written as a disjunction and ratcheted (`§D5 R1`) rather than left to each reader's judgement.

---

## Module / file boundaries — exact, and disjoint by owner

**Backend (Amelia BE) — `apps/api` only**
- `apps/api/src/modules/students/student-scope-where.ts` — **NEW.** The predicate, one home (`§D2`).
- `apps/api/src/modules/students/students.controller.ts` — `:193-196` only: the `where` literal is replaced by a
  `studentScopeWhere(scope, { tenantId: me.tenantId, schoolId })` spread. `searchClause`, `callerFilters`,
  pagination, `orderBy`, the `include`, and `canonicalYearBySchool` are **untouched**.
- `apps/api/src/modules/students/student-access.service.ts` — **NOT MODIFIED** (`§D3`).
- Tests: `apps/api/src/modules/students/student-scope-where.spec.ts` (pure, T2–T6) and the multi-school fixture
  test for T1 beside the existing students specs.
- `apps/api/src/shared/quality/student-school-scope-gate.spec.ts` — **NEW** (`§D5`), plus its fixture under
  `apps/api/src/shared/quality/__fixtures__/`.

**Frontend (Amelia FE) — `apps/web` only**
- `apps/web/src/lib/parent-children.ts` — **NEW** (`§D7`).
- `apps/web/src/components/parent/ChildrenReadError.tsx` — **NEW** (`§D7`).
- Converted (13): `parent/attendance`, `parent/calendar`, `parent/children`, `parent/comments`,
  `parent/dashboard`, `parent/documents`, `parent/lessons`, `parent/messages`, `parent/messages/new`,
  `parent/recommendations`, `parent/settings`, `parent/subjects`, `parent/upcoming` — `page.tsx` each.
- **NOT touched:** `apps/web/src/app/parent/grades/page.tsx` (hard constraint),
  `apps/web/src/lib/read-result.ts`, `apps/web/src/components/ReadErrorState.tsx`.
- The 5 non-parent-children `safe()` declarations remaining under `apps/web/src/app/parent/**` (pages whose
  `safe()` wraps a read other than `/students`) are **out of scope** — `PF-05` is a standing finding and this
  slice narrows it, it does not close it.

**Shared UI (DS Guardian) — `packages/ui`**
- **Nothing.** `ErrorState` / `EmptyState` are reused unchanged.

**Not touched by anyone:** `prisma/schema.prisma`, `packages/contracts/src/guardianship/link-liveness.ts`,
`SchoolContextService`, any `@RequiresPermission`, `apps/worker`.

---

## Consequences

- One rule now decides school-vs-ABAC scoping for every scoped student read, with a ratchet that fails loudly
  when a new controller re-intersects them.
- The parent portal stops contradicting itself across list / detail / children-page / digest for a child outside
  the tenant's biggest school.
- A failed `/students` read is visibly a failure on all 14 parent pages that make a claim from it (13 converted
  here + `grades` already converted), and every earned empty keeps the prose `S-E03-2` tuned.
- Seven new findings are on the books (`PF-389`–`PF-395`, `PF-397`) instead of being silently fixed or silently skipped.
- **`PF-12` is ADVANCED, not closed.** Two of its six axes remain open and blocked (`PF-359`, `PF-360`).

## Verification this ADR expects (Evidence Tier A — not gradeable downward)

1. T1–T6 (`§D4`), fixture-based, with T1 shown **RED before / GREEN after**.
2. The `AC-4` ratchet (`§D5`), shown **RED against the pre-slice construction of `students.controller.ts`
   reconstructed in-spec** — not against an `origin/main` blob, per the deviation recorded in `§D5` — with its
   anti-vacuity floor and both controls (negative shape flagged, positive shape passing) executed.
3. This ADR.
4. **A live probe is NORMALLY required at Tier A and was IMPOSSIBLE this run** — Docker Desktop refuses to start
   and local `pilotage@5432` holds 0 schools / 0 students / 0 guardianships. **No live probe is claimed, and no
   statement in this ADR was executed against a running stack.** The substitution is fixture evidence, declared
   as such; `landed: true ≠ ran: true` — whoever lands this runs T1–T6 and the ratchet themselves rather than
   inheriting this paragraph.
5. `AC-6`: if any of the 13 sites cannot be converted, it ships **converted or not at all** — the STOP is stated
   explicitly in the PR body and earns a new PF id, exactly as `S-E03-2 AC-5` did. A half-migrated page is a
   worse state than an unconverted one, because the ratchet would then read as satisfied.
