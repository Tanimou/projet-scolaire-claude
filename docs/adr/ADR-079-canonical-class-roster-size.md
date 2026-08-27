# ADR-079 — "How many students are in this class" is ONE derivation, and it is correct WITHOUT the invariant the schema comment promises

- **Status** Accepted (architecture ruling, `S-E03-7`)
- **Date** 2026-08-27
- **Story** `S-E03-7` — one class roster has ONE size (operator override; the epic ledger still lists `S-E03-7` as a
  matrix row with no story authored — see §8)
- **Epic** `V3-E03` — Canonical truth and query contracts (layer L0)
- **Closes** `PF-36` — *"Teacher counts vary 43 / 46 / 48 and one class alternates 25 / 26"* (`02_Internal_Platform_Audit.md:140`),
  **as the CLASS of derivations converted**, under the shrinking-allowlist rule of §D7
- **Raises** `PF-409` (nothing links `Enrollment.academicYearId` to `ClassSection.academicYearId`) · `PF-410` (the
  structure header counted enrolments tenant-wide with no school clause — **closed by this slice**) · `PF-411`
  (`classSize` names three different populations, one of them the FOURTH class denominator, derived from *who has a
  grade*, that the parent portal renders) · `PF-412` (the soft-delete probe in `classes.controller.ts` counted without `tenantId` —
  **closed by this slice**) · `PF-413` (`teacherDashboard` applies a year filter only when `academicYearId` is
  passed) · `PF-414` (a fourth, client-side derivation in `teacher/settings`) · `PF-415` (`enrollment.tenant_id`
  carries neither FK nor constraint, so nested `_count` tenancy is implied by the parent row and enforced by nothing)
- **Inherits, does NOT re-allocate** `PF-361` — the promised partial unique index does not exist in the database.
  It is an id that already exists on `main` (`OPEN.md:163`); this slice **annotates** it with a live-database
  re-measurement and keeps the id. See §7 for the allocation actually shipped and §7a for the renumbering that
  reconciled this record with the source.
- **Related** `ADR-072` (canonical active enrolment — this ADR governs exactly the set `ADR-072` **declared
  out of scope**: section-anchored counts) · `ADR-070` (canonical academic-year resolution — the *set* derivation
  reads the year through `resolveActiveAcademicYear`, never around it) · `ADR-041` (canonical KPI definitions) ·
  `ADR-064 §D1a` (inventory derived by walk, never enumerated) · `ADR-067 §D6` (one-way-ratchet house style) ·
  `ADR-002` (tenant scoping) · `GUARDRAILS.md` §2

---

## Verdict

**CONCERNS — proceed, under the rulings below.** No schema change, no migration, no new dependency, no new HTTP
style, no new package. Three rulings are genuinely new architecture and are why this ADR is mandatory:

1. the canonical roster derivation is **correct by construction** — it de-duplicates by `studentId` *always*, so it
   yields the same number whether or not the absent invariant holds (§D2);
2. the two questions currently sharing one name are **split by name**, and summing one to obtain the other is
   **forbidden in the type system**, not merely in a comment (§D3);
3. the missing partial unique index is **recorded, not added** (§D6) — and the reason is stronger than "migrations
   are risky": the database already ships a *contradictory* uniqueness key.

---

## 1. Context — measured on this tree on 2026-08-27, not derived from source

### 1a. Four incompatible answers to "how many students are in this class"

| # | Derivation | Population counted | Sites |
|---|---|---|---|
| **A** | `_count: { select: { enrollments: true } }` | **all six** `EnrollmentStatus` values — `pending`, `active`, `transferred_in`, `transferred_out`, `graduated`, `dropped` | `alerts/meeting-requests.service.ts:82,235,359,419` · `analytics/analytics.service.ts:842,996` · `grades/assessments.controller.ts:123` · `school-structure/classes.controller.ts:171` · `students/students.controller.ts:546` |
| **B** | `_count: { select: { enrollments: { where: { status: 'active' } } } }` | `active` only | `analytics.service.ts:1803,2002,2538,3527,3982` · `enrollments.controller.ts:714,921` · `classes.controller.ts:103,297` · `structure.controller.ts:95,195` · `teachers.controller.ts:147` |
| **B′** | **`B` summed over a teacher's assignments** | `active`, **counted once per (student × section)** | `analytics.service.ts:1821` (`stat.studentCount += a.classSection._count?.enrollments ?? 0`, teacher dashboard) · `analytics.service.ts:2697` (admin cycle roll-up) |
| **C** | `new Set(enrollments.map(e => e.studentId)).size` | `active`, **distinct students** | `teaching/teachers.controller.ts:400-415` (`GET /teachers/:id/load`) |

`A` vs `B` is the audit's **48 vs 46**. `B′` vs `C` is the audit's **46 vs 43**. Both `B′` and `C` are labelled
*"the teacher's students"*, on two surfaces a teacher can open in the same minute. Grep count on
`apps/api/src`: **21 production sites** matching `_count: { select: { enrollments` (a 22nd match is the docblock of
`enrollment-activity-derivation-gate.spec.ts`).

### 1b. A **fourth** denominator the brief did not name — and it is the one PARENTS see

`analytics.service.ts:1571`:

```ts
const classSize = new Set(classGrades.map((g) => g.studentId)).size;
```

This is the value assigned to `card.classSize` at `:1597`, surfaced as `rank / classSize` on
`apps/web/src/app/parent/children/[id]/page.tsx:236-237` and `:553-554`, and on
`apps/web/src/app/parent/children/[id]/report/page.tsx:59`. **It counts students who have a grade**, not students who
are enrolled. On a class where three students have no grade yet, a parent is told *"12 / 22"* while the admin class
list says **25** and the teacher dashboard says **26**. The audit's "one class alternates 25 / 26" is `A` vs `B`;
this is a *fifth* number for the same label and it is the one shown to families. Recorded as **`PF-411`**.

### 1c. The invariant that would have made `B′ == C` is asserted in a comment and **absent from the database**

`apps/api/prisma/schema.prisma:669-671`:

```prisma
  // A student can have at most one active enrollment per academic year. We enforce uniqueness on
  // (studentId, academicYearId) when status='active' via a partial unique index in migration SQL.
  @@unique([studentId, classSectionId, academicYearId])
```

Executed against `localhost:5432/pilotage` (the database `DATABASE_URL` points at) on 2026-08-27:

```
enrollment_pkey                                       :: UNIQUE (id)
enrollment_tenant_id_idx                              :: btree (tenant_id)
enrollment_class_section_id_status_idx                :: btree (class_section_id, status)
enrollment_academic_year_id_status_idx                :: btree (academic_year_id, status)
enrollment_student_id_class_section_id_academic_year_id_key :: UNIQUE (student_id, class_section_id, academic_year_id)
```

Five indexes. **None is partial. None is on `(student_id, academic_year_id)`.** Grepping
`apps/api/prisma/migrations/*/migration.sql` for a unique index on `enrollment` returns only the plain
three-column key in `0_baseline`. **The promised partial unique index has never existed.** This is **`PF-361`**, already open on `main` (`OPEN.md:163`) — re-measured here against the LIVE database rather than only against the migration SQL, and **annotated, not re-allocated**.

**And the key that *does* exist contradicts the comment.** `UNIQUE (student_id, class_section_id, academic_year_id)`
is precisely the constraint that *permits* one student to hold two `active` enrolments in one academic year, provided
the sections differ. The two lines are not "a promise not yet kept" — they are **two invariants in direct
opposition, three lines apart**, and the one the database enforces is the permissive one. `B′ > C` is therefore not a
bug: it is the schema working as shipped.

### 1d. Evidence conditions for this slice

Docker is down on this machine this run; the native Postgres on `localhost:5432` holds the migrated schema but
`select count(*) from enrollment` returns **0**. Schema and index facts above are live measurements. **No count
claim in this slice may be a live query** — the red-before/green-after evidence is a jest fixture (`AC-4`).

---

## 2. The question this ADR answers

`ADR-072` canonicalised *"is this child actively enrolled"* and **explicitly declared section-anchored counts out of
scope** (`enrollment-activity-derivation-gate.spec.ts:36-46`: *"ils comptent un effectif, ils n'affirment pas
l'activité d'UN enfant"*). That exclusion was correct then and it is the reason this slice exists now: the set
`ADR-072` fenced off is exactly the set `PF-36` is made of. **`ADR-079` governs that set. The two ADRs partition the
enrolment-reading surface; neither relaxes the other.**

---

## 3. Decision

### D1 — The home is `packages/contracts/src/roster/` — a NEW folder, and the reason is the partition

The house pattern from `S-E03-4` is a **structural port**: the Prisma-free derivation lives in
`packages/contracts/src/<domain>/`, a three-line adapter under `apps/*/src/shared/<domain>/` hands it the real
`PrismaClient`, the unit spec lives beside the adapter in `apps/api/src/shared/<domain>/`, and the repo-wide ratchet
lives in `apps/api/src/shared/quality/`.

> **The brief's file pointer is wrong and I am correcting it, not obeying it.**
> `apps/api/src/shared/academic-year/resolve-academic-year.ts` **does not exist**. The canonical module is
> `packages/contracts/src/academic-year/resolve-academic-year.ts`; `apps/api/src/shared/academic-year/` holds only
> `prisma-academic-year-reader.ts` (the adapter) and `resolve-academic-year.spec.ts` (the spec).
> `packages/contracts/src` contains **zero** `*.spec.ts` files — that is why the spec sits on the api side.
> Placing the derivation itself under `apps/api/src/shared/` as the brief asks would put it where
> `apps/worker` (`rootDir: ./src`) and `apps/web` can never import it.

**The `<domain>` here is `roster`, not `enrollment`, and that is a ruling — not an accident of naming.**

An earlier draft of this ADR made the module a **sibling inside `packages/contracts/src/enrollment/`**, on the
argument that `select-active-enrollment.ts` already declares a Prisma-free population vocabulary
(`activeEnrollmentWhere()`, `candidateEnrollmentWhere()`, `ACTIVE_ENROLLMENT_DEFINITION`), so a second folder would
be **a second enrolment-population vocabulary — the very drift `PF-36` is made of**. That argument was reversed
during implementation, and this is the record of the reversal.

**Why it was reversed: the two modules PARTITION the surface; they do not overlap.** `ADR-072`'s module answers
*"is THIS CHILD actively enrolled?"* — a question **anchored on the pupil**, returning a **state**
(`active` / `out_of_scope` / `none`) and a label. This module answers *"how many pupils HERE?"* — a question
**anchored on the section**, returning a **number**. `ADR-072`'s own ratchet
(`enrollment-activity-derivation-gate.spec.ts:36-46`) **deliberately excludes** the section-anchored family:
*"ils comptent un effectif, ils n'affirment pas l'activité d'UN enfant."* That excluded set is exactly the set
`PF-36` occupies. So the folder split does **not** create a second vocabulary for one question; it gives the second
question the home the first ADR reserved for it. No call site ever imports both to ask one thing. The rationale is
carried verbatim in the module docblock at `packages/contracts/src/roster/class-roster-size.ts:111-122` — this
section exists so the architectural record and the tree agree.

The trade accepted: two folders must be kept from drifting into one vocabulary. The ratchet
(`class-roster-size-derivation-gate.spec.ts`) plus `ADR-072`'s ratchet are the enforcement — each fences its own
family, and the positive controls in each assert the other's family still passes.

```
packages/contracts/src/roster/class-roster-size.ts              ← NEW: the derivation + the population vocabulary
packages/contracts/src/roster/index.ts                          ← NEW: the folder barrel
packages/contracts/src/enrollment/select-active-enrollment.ts   ← unchanged (ADR-072), the pupil-anchored half
apps/api/src/shared/roster/prisma-roster-reader.ts              ← NEW: the Prisma adapter
apps/api/src/shared/roster/class-roster-size.spec.ts            ← NEW: unit + red-before/green-after spec
apps/api/src/shared/quality/class-roster-size-derivation-gate.spec.ts ← NEW: the ratchet
```

`packages/contracts/package.json` gains **no dependency**. `@prisma/client` never enters contracts (`GUARDRAILS` §2).

### D2 — The set derivation de-duplicates by `studentId` **always** — correct by construction

`distinctStudentsAcrossSections(...)` MUST be implemented as a `groupBy`/`findMany` over `Enrollment` projecting
`studentId` and reducing through a `Set`, **never** as a sum of per-section counts.

The reason is not performance and not style: **a derivation that is only correct because an invariant holds is the
fragility `PF-36` is made of.** §1c shows the invariant does not hold and the enforced key contradicts it. A
de-duplicating derivation returns the same number in both worlds — if `PF-361` is ever fixed, nothing here changes;
if it is never fixed, nothing here is wrong. That is the whole ruling.

### D3 — The two questions are split BY NAME, and summing is blocked in the type system

Two exported derivations, named so they cannot be confused, plus a comment stating why summing is wrong:

| Name | Question | Shape |
|---|---|---|
| `classSectionRosterSize(...)` | **ONE** section: how many enrolments of population *P* does it hold? | returns a branded `RosterSize` |
| `distinctStudentsAcrossSections(...)` | **A SET** of sections: how many **distinct students** does it reach? | returns a branded `DistinctStudentCount` |

**The brand is load-bearing.** `type RosterSize = number & { readonly __rosterSize: unique symbol }` makes
`sizes.reduce((a, b) => a + b, 0)` a type error at the two sites that do it today (`analytics.service.ts:1821`,
`:2697`). A comment saying "do not sum" is what the schema already tried at §1c; the type system is what actually
holds. A caller who genuinely wants a total of seats — not students — calls `totalSeatsAcrossSections()`, which is a
**separate named export** whose docblock says it is a seat count and not a headcount.

### D4 — The population is named, never hand-written, and never silently forced to `active`

One exported union, stated once:

```ts
export type EnrollmentPopulation =
  | 'roster'          // status: 'active' — who is on the roster today
  | 'enrolment_history' // all six statuses — who has EVER been attached to this section
  | 'pending_intake'; // status: 'pending' — the admissions queue
```

Every converted site names its population. **`VARIANT A` sites are not bulk-rewritten to `roster`.** Two of them are
plausibly deliberate — `students.controller.ts:546` counts a *student's* enrolments (a history, correctly all six)
and `enrollments.controller.ts`'s queue genuinely wants `pending`. The implementer reads each site and either
converts it with the population it actually means, or records it. Any site whose intent cannot be read from its
surface is a **ruling of this ADR (`AC-3`), not a bug to fix** — the seven sites that stay unfiltered are named, one by one and with their reason, in the module docblock, and the ratchet carries a POSITIVE control asserting they still pass. `AC-3` is a classification duty, not a finding: it was NOT allocated a `PF-` id.

### D5 — Tenant scoping is asserted, not assumed (`G-TENANT`, `ADR-002`)

A nested `_count: { select: { enrollments: … } }` carries **no tenant predicate of its own**; it counts every related
row and relies on `Enrollment.tenantId == ClassSection.tenantId` holding by construction. Measured on
`localhost:5432`: there is **no composite foreign key** and **no check constraint** enforcing that equality
(`pg_constraint` on `enrollment` returns the primary key and three single-column FKs, nothing else), and
`relrowsecurity` is **`f`** on `enrollment`, `class_section` and `student` in this deployment. The implied tenancy is
therefore enforced by application discipline alone. Recorded as **`PF-415`**.

**Ruling:** the canonical module's `where` builders MUST take `tenantId` as a **required, non-optional** parameter
and always emit it — including on the nested-relation form, where Prisma permits it and every current site omits it.
This costs nothing and converts an assumption into a predicate. It is not a fix for `PF-415` (a DB-level constraint
is), and the ADR must not claim it is.

### D6 — The missing partial unique index is RECORDED, not added

**Do not add `CREATE UNIQUE INDEX … ON enrollment (student_id, academic_year_id) WHERE status = 'active'` in this
slice.** Three reasons, in order of weight:

1. **It would contradict a shipped key.** `UNIQUE (student_id, class_section_id, academic_year_id)` (§1c) exists to
   allow multi-section enrolment. Adding the partial index declares the opposite. Deciding which of the two is the
   product's real rule is a **data-model decision about whether a student may attend two sections in one year** —
   not a read-truth story, and not a call this slice's evidence can make (the local database is empty; the seeded
   environments are unreachable this run).
2. **`D2` makes it unnecessary.** The canonical derivation is correct in both worlds. Adding the index would buy no
   correctness here.
3. It can fail on existing data, converting a read-projection story into a data migration.

`G-MIGRATION` therefore **does not apply to this slice.** If a later slice decides the invariant is the product rule,
it needs its own ADR, an expand/contract migration with a rollback statement, and a reconciliation pass — and
`db push` remains forbidden.

**If the implementer concludes the index is required for this story to be honest, that must be stated explicitly in
the PR with the measurement that forced it. It must never be added silently.**

### D7 — The ratchet is a shrinking allowlist derived by walk, with an anti-vacuity floor

`apps/api/src/shared/quality/class-roster-size-derivation-gate.spec.ts`, following `ADR-067 §D6` and the two-rule
scope pattern of `ADR-072 §A5`:

- **Rule A — zero tolerance** on the sites this slice converts: a `_count: { select: { enrollments` or a hand-written
  `status:` predicate on a **section-anchored** enrolment read, outside the declaring module, is a violation.
- **Rule B — decreasing ceiling** on the four walk roots (`apps/api/src`, `apps/worker/src`, `apps/web/src`,
  `packages/*/src`) for any site not converted in this slice. Residuals are **pinned, not exempted**.
- The inventory is produced **by walking the tree** (`ADR-064 §D1a`). A hand-typed literal list is forbidden — that
  is precisely how §1c's comment and §1c's index came to disagree.
- **Anti-vacuity floor per root**: the gate fails if the walk recognises **zero** enrolment-count constructions, and
  requires **exactly one** file declaring `classSectionRosterSize`. Zero would mean the contract vanished; two would
  mean canonicalisation has already re-diverged.
- `.tsx` is parsed as `ScriptKind.TSX` (the `apps/web` root is JSX; parsed as `.ts` the walk silently yields an empty
  tree — the trap `enrollment-activity-derivation-gate.spec.ts` documents).
- No env var, no `NODE_ENV`, no `SKIP_*` / `ALLOW_*` (`DNC-10`). `MANUAL_ALLOWLIST` ships **empty** and an assertion
  proves it.

**If not every site converts in one slice, `PF-36` closes as the SITES converted, with the class left open and said
so plainly in the ledger row.**

---

## 4. Alternatives considered and rejected

| Alternative | Why rejected |
|---|---|
| Add the partial unique index, then trust it | §D6. Contradicts a shipped key; turns a read story into a data-model decision; buys nothing given §D2 |
| Force every site to `status: 'active'` | Destroys the two legitimate populations (`enrolment_history`, `pending_intake`) and silently changes an admissions queue. `AC-3` forbids it |
| Keep the cumulative sum and relabel the teacher card *"places"* | The audit's complaint is that two surfaces disagree about **students**; relabelling one moves the contradiction into the copy |
| Put the derivation in `apps/api/src/shared/` as the brief asked | §D1 — unreachable from `apps/worker` (`rootDir`) and from `apps/web` |
| Keeping the derivation as a sibling inside `packages/contracts/src/enrollment/` | **Reversed during implementation — see §D1.** The two modules PARTITION the surface (pupil-anchored state vs section-anchored number), and `ADR-072`’s ratchet already fences the section-anchored family OUT. Filing the section-anchored half under `enrollment/` would have put the excluded set inside the folder that excludes it |

---

## 5. Consequences — numbers that change on the day this lands (`AC-7`)

Every number below must be re-stated in the PR with the *measured* before/after on the fixture, not the estimate:

| Surface | Today | After | Why |
|---|---|---|---|
| Teacher dashboard, subject card *"élèves"* (`apps/web/src/app/teacher/dashboard/page.tsx:231` ← `analytics.service.ts:1821`) | cumulative `B′` — a student in two of the teacher's sections counted twice | distinct `C` | `D2`/`D3` |
| `GET /teachers/:id/load` (`teachers.controller.ts:418`) | distinct `C` | **unchanged** | already correct; it becomes the canonical call instead of a hand-rolled `Set` |
| Admin cycle roll-up *"élèves"* (`analytics.service.ts:2697`) | cumulative `B′` | distinct | same defect, admin surface |
| Admin class list (`apps/web/src/app/admin/classes/page.tsx:243` ← `classes.controller.ts:103`) | `B` | unchanged (`roster`) | already the roster population |
| Admin class **detail** (`classes.controller.ts:171` → `classes/[id]/page.tsx:386`) | `A` — six statuses | **changes** if converted to `roster` | this is the audit's *"25 / 26"*. State the fixture delta |
| Teacher assessment grading progress (`teacher/assessments/page.tsx:382-387` ← `assessments.controller.ts:123`) | `A` as the **denominator of a percentage** | changes | a graded-out-of-N bar computed over six statuses over-states the work remaining |
| Parent *"rang / classSize"* (`parent/children/[id]/page.tsx:236`) | **grade-derived** (§1b) | **unchanged in this slice** | out of scope; recorded as `PF-411`. Say so rather than implying the parent number was fixed |

A silent value change on a dashboard is worse than the divergence. Each row above is a PR line item.

## 6. Portal sweep (`G-PORTAL`) — all four checked

- **admin** — shows it: classes list (`page.tsx:243`), class detail (`[id]/page.tsx:386,396`), structure tree, cycle
  roll-up, student detail *"Inscriptions"* (`students/[id]/page.tsx:184` — an **enrolment history**, correctly `A`).
- **teacher** — shows it in **six** places: `dashboard:231`, `classes:68`, `classes/[id]:217`,
  `classes/[id]/attendance:83`, `assessments:382`, `settings:100`. This is where the audit measured `PF-36`.
- **parent** — shows a class denominator, but **not this one**: `rank / classSize` from §1b's grade-derived value.
  Verified, out of scope, recorded (`PF-411`).
- **student** — grep over `apps/web/src/app/student` returns **no** roster-size render. *"This portal does not show
  it"* is the verified answer.

## 7. Findings raised (allocated from `PF-409`; highest on `main` is `PF-408`)

**This table is the single authority for `PF-409`…`PF-415`.** It matches, id for id, the shipped source
(`packages/contracts/src/roster/class-roster-size.ts:126-146`, `:286`, `:329`, `:406`, `:561`;
`apps/api/src/modules/school-structure/structure.controller.ts:136`) and the story's §8
(`docs/spec/features/v3-e03/stories/S-E03-7.md:635-646`). The `OPEN.md` rows land in the **same commit** so the next
run's allocator cannot re-issue these ids (`project_parallel_runs_collide_on_ids`).

| id | P | Finding | Status in this slice |
|---|---|---|---|
| **`PF-409`** | P2 | **Nothing links `Enrollment.academicYearId` to `ClassSection.academicYearId`** — two independent FKs, no composite key, no `CHECK`, no trigger (`pg_constraint` on `enrollment` returns 4 rows, none carrying the pair; measured 2026-08-27). A nested `_count` on `ClassSection.enrollments` is therefore **year-unscoped even when the section belongs to a year** | **recorded, not fixed** — the assumption is now *named* by `ROSTER_YEAR_IMPLIED_BY_SECTION` instead of being silent |
| **`PF-410`** | P2 | `structure.controller.ts:108` counted enrolments **tenant-wide with no school clause**, beside `:106-107` keyed by school and `:131` summing school-keyed classes. Header ≠ tree in a multi-school tenant | **CLOSED by this slice** (`AC-7` #3) |
| **`PF-411`** | P2 | **`classSize` names three populations**: the enrolled (`attendance.controller.ts:378`), the **graded** (`analytics.service.ts:1571` — the PARENT rank denominator), the ranked (`snapshot-recompute.service.ts:287`, `:353`). The name lies about two of the three | **recorded, not fixed** — `gradedPopulationSize` is exported as a **type only**, so the name exists but no function here computes it; pointing the parent rank at the roster would be a product decision, not a truth fix (§5) |
| **`PF-412`** | P3 | the soft-delete probe in `classes.controller.ts` — `enrollment.count({ where: { classSectionId: id } })` **without `tenantId`** | **CLOSED by this slice — by an explicit `tenantId: me.tenantId` clause, added in the land pass.** ⚠ This row first shipped claiming closure by `DistinctStudentsWhere`’s type. That was wrong: the line was byte-identical to `main`, and this probe is not a roster read at all — it asks « any trace of enrolment, all statuses, all years », which `rosterCountArg` exists precisely NOT to answer. The by-construction argument in §D3 is real but applies to direct ROSTER reads only |
| **`PF-413`** | P2 | `teacherDashboard` (`analytics.service.ts:1791-1795`) applies a year filter **only if `academicYearId` is passed**; without it, assignments from **every** year aggregate. `teacher/settings/page.tsx:107` already carries a comment saying so | **recorded, not fixed** — its own slice, because it changes displayed values |
| **`PF-414`** | P3 | `apps/web/src/app/teacher/settings/page.tsx:100-106` — a **fourth derivation, client-side**, de-duplicating CLASSES rather than STUDENTS | **recorded, not fixed** — pinned by ratchet rule R3; convert when `/teachers/me/assignments` exposes the distinct count |
| **`PF-415`** | P2 | **`enrollment.tenant_id` carries neither FK nor constraint**; the ~13 nested `_count` sites are tenant-scoped by the parent `where` **by convention and by nothing else**. `relrowsecurity = f` on `enrollment` / `class_section` / `student` on the measured deployment | **recorded, not fixed** — §D5 requires `tenantId` in the type for every DIRECT read; Prisma exposes no column for a nested `_count`, so the nested form stays a `G-TENANT` slice |

**Inherited, id preserved, NOT re-allocated:**

| id | P | Finding | Status |
|---|---|---|---|
| **`PF-361`** | P1 | The partial unique index promised by `schema.prisma:669-670` does not exist; the enforced key `UNIQUE (student_id, class_section_id, academic_year_id)` **permits** the multiplicity the comment forbids. Already open on `main` (`OPEN.md:163`, raised at run 82 by `S-E03-3`) | **ANNOTATED** — re-measured against the LIVE database (`pg_indexes`, 5 indexes, none partial) rather than only against the migration SQL. Unchanged otherwise; §D6 says why this slice does not add it. §D2 makes it *irrelevant to correctness* without fixing it |

### 7a. Renumbering — this record was reconciled with the source, by MEANING

An earlier draft of §7 allocated `PF-409`…`PF-412` to **four different findings** from the ones the shipped source
and the story cite. Both sets were in flight at once, and seven of the source ids are spelled into production
docblocks — so the **source allocation wins** and this record was renumbered to match, by meaning and never by
pattern (`project_parallel_runs_collide_on_ids`):

| Earlier draft's id | Meaning | Correct id |
|---|---|---|
| `PF-409` | the missing partial unique index | **`PF-361`** — already on `main`; annotated, not re-allocated |
| `PF-410` | `classSize` derived from distinct **graded** students (parent rank denominator) | **`PF-411`** |
| `PF-411` | nested `_count` tenant-scoped only by implication | **`PF-415`** |
| `PF-412` | the `VARIANT A` sites must be classified per-site, not bulk-converted | **not a finding** — it is the `AC-3` ruling of §D4; no `PF-` id is allocated to it |

## 8. Ledger disagreement

`docs/spec/features/v3-e03/PROGRESS.md:81` still lists `S-E03-7` as a **matrix row only — no story authored**, and
the file's `Next slice` pointer nominates a different finding. The SLICE is an operator override and wins; the
PROGRESS row is out of date and must be updated in the same commit.

## 9. Gates

`G-TRUTH` (primary) · `G-PORTAL` (§6, four portals) · `G-TENANT` (§D5) · `G-DNC` (no `DNC-01`…`DNC-12`
reproduction; §D7 forbids the escape hatches). **`G-MIGRATION` does not apply** — §D6.

**Evidence tier B.** Required: the `AC-4` red-before/green-after fixture (one student, two `active` enrolments in the
**same** academic year across two of the teacher's sections, plus one non-active enrolment in one of them; assert the
teacher-dashboard number and the `/teachers/:id/load` number agree), the failure output pasted **before** the change,
the `§D7` ratchet, and the evidence line. **If the fixture passes before the change, the premise of this ADR is
wrong: stop, say so, and report what was measured.**
