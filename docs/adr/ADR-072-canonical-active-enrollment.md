# ADR-072 — "Is this child actively enrolled" is ONE derivation, stated once in `@pilotage/contracts`

- **Status** Accepted (architecture ruling, `S-E03-3` — run 82)
- **Date** 2026-08-25
- **Story** `S-E03-3` — [`docs/spec/features/v3-e03/stories/S-E03-3.md`](../spec/features/v3-e03/stories/S-E03-3.md)
  (planning copy: [`docs/daily-improvement-v3/stories/S-E03-3.md`](../daily-improvement-v3/stories/S-E03-3.md))
- **Epic** `V3-E03` — Canonical truth and query contracts (layer L0)
- **Advances (does NOT close)** `PF-12` — the parent child/enrolment self-contradiction. **Three of nine measured
  axes close** (§1). The audit's own `PF-12` sentence has three clauses and the third one — the claim panel — is
  `PF-357`, untouched here. The ledger row must read `advanced`, naming the closed and open axes by id (§R)
- **Raises** `PF-356` · `PF-357` · `PF-358` · `PF-359` · `PF-360` · `PF-361` · `PF-362` · `PF-363` (declared by the
  story's §7 table) and, allocated at the land pass for two meanings that table did not carry, `PF-364` (§R-7) and
  `PF-365` (§A6). All ten are declared in `docs/daily-improvement-v3/audit-findings-index.md` in the same commit
- **Related** `ADR-041` §D2 / §D3 / §D4 / Consequences (canonical KPI definitions — this ADR is an *instance* of that
  ruling, and §A6 records where it deviates) · `ADR-070` (canonical academic-year resolution — this module reads the
  canonical year **through** `resolveActiveAcademicYear`, never around it, and inherits its residual verbatim) ·
  `ADR-063 §D1` and `ADR-066 §D1` (`StudentAccessService` is section-anchored and deliberately carries **no**
  academic-year clause — §A4 is why this predicate must never be imported there) · `ADR-062 §D3` (no shared
  `select`/`include` shape between modules — why `projectEnrollmentActivity` takes a `describe` callback) ·
  `ADR-064 §D1a` (inventory derived by walk, never enumerated) · `ADR-067 §D6` (the one-way-ratchet house style) ·
  `GUARDRAILS.md` §2 (`packages/contracts` builds to CJS and must not be destabilised), §5

---

## Verdict

**CONCERNS — proceeded, under the rulings below.** No schema change, no migration, no new dependency, no new HTTP
style, no new package, no guard and no permission touched. Four rulings are genuinely new architecture and are why
this ADR is mandatory: a **second structural-port module in `packages/contracts`** that deliberately declines to
carry a port at all (§A1, §A2); a **display predicate that is forbidden from becoming an access-scope predicate**
(§A4); a **ratchet with two declared scope rules instead of one** (§A5); and an **acknowledged deviation from
`ADR-041 §D4`'s single registry** (§A6). One ruling changes what several surfaces display on the day it lands, and
that is the point rather than a side effect (§5).

---

## 1. Context — measured 2026-08-25, not derived from source

The audit (`02_Internal_Platform_Audit.md` §7, App. B.7) observed **one seeded child** described simultaneously as
*"actively enrolled in 2nde A"* by the parent dashboard and the child-detail page, and as *"no active enrolment"* by
the children list, the « Ma famille » settings tab and the claim panel. **Nothing was broken. Each surface asked a
different question and every answer was locally correct.**

Nine surfaces re-derived the answer by hand, over payloads filtered three different ways:

| axis | divergence found | this slice |
|---|---|---|
| **1** | two client surfaces re-filtered on `AcademicYear.status` a list the server had already filtered on `Enrollment.status`. These are two **independent** columns (`schema.prisma:319` / `:652`) | **CLOSED** |
| **2** | `enrollments.find(e => e.status === 'active') ?? enrollments[0]` over a payload carrying **no status filter at all** (`GET /students/:id`) rendered a `graduated` row behind a green *"Inscription active"* badge | **CLOSED** |
| **3** | three orderings for one question: `take:1 orderBy enrolledAt desc`, "all active rows, unordered", and `enrollments[0]` in server return order | **CLOSED** |
| 4 | `schoolId` applied in `GET /students` and in neither `StudentAccessService` nor `AnalyticsService.parentDashboard` | recorded — `PF-356` |
| 5 | the claim panel answers from `GuardianshipClaim`, everything else from `Guardianship` | recorded — `PF-357` |
| 6 | `Guardianship.status` predicated three ways; `_count.guardianships` counts revoked links | recorded — `PF-358` |
| 7 | a failed read is rendered as *"Aucun enfant rattaché"* on six parent server pages | recorded — `PF-363` |
| 8 | `messaging` / `remediation` / `exports` each add their own year predicate | recorded — `PF-359` |
| 9 | `Student.status` is consulted on **no** parent path | recorded — `PF-360` |

Three of those nine were **factually false at all times, not merely divergent**: `children/page.tsx`,
`settings/page.tsx` and `messages/new/page.tsx` declared `academicYear: { status: string }` while the projection
feeding them (`GET /students`) selected only `{ id, name }`. `e.academicYear.status === 'active'` therefore compared
`undefined === 'active'` — **always false, for every child**. The « CLASSES ACTIVES » and « CYCLES SUIVIS » counters
were structurally `0`. That is `DNC-06` (the interface promising what the runtime does not deliver) doubled with
`DNC-01` (a KPI disagreeing with the badges on its own page).

---

## 2. What this ADR decides, in four lines

1. The definition is stated **once**, in `packages/contracts/src/enrollment/`, and is reproduced verbatim in §3.
2. The choice among several qualifying rows is made by a **total order** stated once (§4), never by a caller.
3. The **server** answers the question; portals consume an explicit field and never choose among rows (§A3).
4. Absence is answered honestly in **three** states, never softened by a fallback to an arbitrary row (§3, §5).

---

## 3. The canonical definition — verbatim, and this is the clause other files cite

> A child is **actively enrolled** when they hold an `Enrollment` whose `status` is `active` **and** whose
> `academicYear` is the tenant's canonical active year as resolved by `resolveActiveAcademicYear`
> (`packages/contracts/src/academic-year/`, `ADR-070`). Where more than one such row exists, the canonical one is
> chosen by a **single total order stated once in the contract module** — never by the caller. Where none exists,
> the answer is **"not actively enrolled"**, and it is **never** softened by falling back to an arbitrary row.

The answer is **three-valued**, because a two-valued vocabulary cannot express it without lying in one direction or
the other:

| state | meaning |
|---|---|
| `active` | a row qualifies in the canonical academic year |
| `out_of_scope` | enrolment rows exist, **none** qualifies — a non-canonical year (pre-enrolment, stale year) **or** a terminal status (`graduated`, `transferred_out`, `dropped`). Neutral: a finished school year is not a parent problem |
| `none` | zero enrolment rows for this child. The only state with an administrative next step |

A fourth state, `unavailable`, exists **only in the presentation layer** (`packages/ui`,
`apps/web/src/lib/enrollment-activity.ts`): a read that FAILED is not a domain fact, and it must never be
collapsed into `none`. That is `PF-05`'s lesson (`ADR-071`) applied to this field.

**The definition is NOT ratified.** `ADR-041` (Consequences) requires every definition the routine chooses on a
school's behalf to say so. `ACTIVE_ENROLLMENT_DEFINITION.confirmed` is therefore `false`, in the source, where a
reader meets it — not in a run report.

---

## 4. The total order is `[{ enrolledAt: 'desc' }, { id: 'desc' }]`, because `enrolledAt desc` alone is NOT a total order

`orderBy: { enrolledAt: 'desc' }` — what the existing projections already used — does not decide between two rows
sharing an `enrolledAt`. The unique index `@@unique([studentId, classSectionId, academicYearId])`
(`schema.prisma:669-670`) does **not** forbid two `active` rows for one pupil in one year in two different
**sections**, and the partial index promised in the schema comment beside it **does not exist in any migration**
(`PF-361`). A bulk import writes rows to the same millisecond. Postgres is then free to return either — which is
precisely the "two portals disagree while nothing is broken" shape this epic exists to remove.

`id` is the primary key, therefore unique, therefore the tiebreak makes the order **total**.

`enrolledAt` stays the **leading** key deliberately: it is the key the five existing projections already used.
Changing the leading key would change results without closing anything — a cost with no purchase.

The **same** order is stated twice, in SQL form (`enrollmentTotalOrder()`) and in memory
(`compareEnrollmentsByTotalOrder()`), in one file and beside each other, because two orders written apart diverge —
which is the finding.

---

## 5. Some numbers change in the UI the day this lands. That is the point

`ADR-041 §D3` anticipated this exactly: *"Some numbers will change in the UI on the day this lands. That is the
point."* Concretely, and stated here so nobody reads it later as a regression:

- A child whose only enrolment is `graduated` **stops** reading *"Inscription active"* on the child-detail page and
  reads `out_of_scope` with a scope line naming the last known enrolment.
- The parent children-list counters « CLASSES ACTIVES » / « CYCLES SUIVIS » **stop being structurally `0`** and start
  reporting a real number (§1).
- A child whose active enrolment sits in a **non-canonical** year is now reported `out_of_scope` on the activity
  axis. It is **not** hidden: what changed is what is *asserted*, never what is *shown*.

`ADR-041 §D3`'s remedy is carried with the change rather than after it: **the scope label**. Every state is rendered
beside a sentence naming the year (and, off `active`, the last known enrolment) it is a claim about. A changed number
with a scope line is legible; the same number without one is alarming. The label is a sibling `<p>` in the DOM, never
a `title` or an `aria-label` — scope that exists only for screen readers is the interface promising what the page
does not show.

**What does NOT change is the reporting window** — see §A7.

---

## §A1 — The module lives in `packages/contracts`, and does not import Prisma

Same reasoning and same shape as its sibling `academic-year/` (`ADR-070 §D1`): `apps/api`, `apps/worker` **and**
`apps/web` each carry sites; `apps/worker/tsconfig.json` pins `rootDir: ./src`; the only common home is
`@pilotage/contracts`. That package will never take `@prisma/client` as a dependency — it is consumed by `apps/web`
and builds to CJS (`GUARDRAILS §2`). The module therefore **builds** the `where` and the `orderBy`, and a three-line
adapter per application hands them to the real client.

---

## §A2 — It invents NO port, and that is deliberate

`academic-year/` defines an `AcademicYearReader` port because it **issues a read**. This module issues none: it
receives rows that have already been read and returns a verdict. Copying the port here would be ceremony — a port
with nothing to read through it. The boundary is therefore narrower on purpose: a `where` builder, a total order, a
pure selection function, and a scope label.

The consequence is worth stating, because it is the thing a future reader will want to "fix": **the two contract
modules in this family do not have the same shape, and they should not.** One resolves by reading; the other decides
over what a caller read. Making them symmetric would add an abstraction that carries no behaviour.

---

## §A3 — The server answers; the portal consumes a verdict and cannot re-derive one

The parent-facing payloads carry an explicit canonical field (`enrollmentActivity`, and on the meeting-request row
the flat pair `enrollmentActivityState` / `enrollmentScopeLabel`). The client never chooses among rows.

Two enforcement points, both structural rather than conventional:

- **`tenantId` is required by the TYPE**, not by the options bag (`ADR-070 §D3`, same reason, same form). A
  tenant-less enrolment read is not forbidden by review; it is inexpressible.
- **`EnrollmentStatusBadge` (`packages/ui`) accepts a state, never rows.** A presentational component handed rows
  would have to choose among them — the derivation this ADR deletes, relocated into `packages/ui`, *outside* the walk
  roots of the gate that forbids it, and therefore strictly worse than the original bug. The prop shape is the rule.

`apps/web` imports the contract module with `import type` **only**. `packages/contracts` builds to CJS: executing
`selectActiveEnrollment()` from the web app would fail at runtime with a green typecheck and a green ratchet until
`dist/enrollment/` existed. The portal consumes **data**, never code from that package.

---

## §A4 — This is a DISPLAY predicate. It must never become an ACCESS-SCOPE predicate

It must never be imported from `StudentAccessService` or from a guard.

`student-access.service.ts` reads enrolments anchored on the **section** (`classSectionId: { in: … }`), with no year
clause, and its docblock decides that explicitly: *"NO academic-year clause"* (`ADR-063 §D1`) and *"`status:'active'`
ONLY, deliberately and at a stated cost"* (`ADR-066 §D1`). Importing this predicate there would **add** the year
clause and therefore **narrow** the teacher perimeter — an authorisation change, which the story forbids (§8, STOP
condition 5). `ADR-063 §D1` and `ADR-066 §D1` are **not** reopened here.

The ratchet is worded so that this file is excluded **by the statement of the rule, not by an exception**: rule R3
covers enrolment reads *anchored on the pupil*, and a `where` carrying `classSectionId` without `studentId` is not
one. A test asserts that the file passes, and another that it does not import the predicate.

---

## §A5 — The ratchet has TWO declared scope rules, and one would have been worse

Measured on `HEAD` before conversion: **34** contraventions across the four walk roots. This slice removes **20**.
The remaining **14** are all outside the declared perimeter (admin surfaces and API routing reads).

A single zero-tolerance rule over all four roots would have required converting those 14 — that is, one of the three
exits `academic-year-resolution-gate.spec.ts:20-32` names and forbids: an allowlist, an out-of-perimeter conversion,
or loosening the rule until it passes (`R-30`). The scope is therefore **declared**, never relaxed:

- **RULE A — zero tolerance** on the parent portal and on the server projections this slice converts. This is the
  **class** the ratchet closes: *"no parent surface re-derives enrolment activity."* Not the global class — and
  this ADR, `OPEN.md` and `PROGRESS.md` all say exactly that, in the same words.
- **RULE B — a decreasing ceiling** over all four roots. The count of re-derivations outside the declaring module is
  pinned and may only fall. This is the house convention (`lint-ratchet.spec.ts`, `test-ratchet.spec.ts`), so it is
  **no new architectural decision**. The 14 remaining sites are recorded as residuals, **not allowlisted**: a ceiling
  exempts nobody, it forbids recurrence.

`MANUAL_ALLOWLIST` exists, is named, and **ships empty with an assertion that it is empty**. No environment variable,
no `NODE_ENV`, no `SKIP_*` / `ALLOW_*` (`DNC-10`). The home module is recognised **by construction** — the file that
declares `selectActiveEnrollment`, found by the same walk, and the gate requires **exactly one**: zero would mean the
contract vanished and the ratchet is decorative; two would mean the canonicalisation has already re-diverged.

`.tsx` roots are parsed with `ScriptKind.TSX`. Parsed as `.ts`, JSX angle brackets become type assertions and the
parse either breaks or — worse — **succeeds silently on an empty tree**, giving a vacuous ratchet over half the
defect. The negative control therefore carries a `.tsx` fixture, or it proves nothing for the web root.

---

## §A6 — `ADR-041 §D4` asked for ONE registry. What exists is a FAMILY of modules, and that deviation is recorded

`ADR-041 §D4` reads: *"Definitions live in one module, not in each query. A single registry in `packages/contracts`,
each entry carrying id, definition, scope label and the predicate. Portals import the predicate; they never
re-derive it."*

The second sentence is honoured in full. The first is **not**: there is no single registry. `academic-year/`
(`ADR-070`) and now `enrollment/` are two sibling modules, each carrying its own entry
(`ACTIVE_ENROLLMENT_DEFINITION` = id + definition + scope label + predicate).

**Ruled: the family stands for now, and convergence is an `epic-spec` decision, not a slice decision.** Two modules
are not yet a registry problem; collapsing them under a shared index while the epic still has no `spec.md` would be
inventing the registry's shape from a sample of two, and the two modules deliberately do **not** have the same shape
(§A2). What is refused is inheriting the deviation *silently*: it is recorded as **`PF-365`**, owned by `V3-E03`,
with the fix direction *"introduce the registry when a third definition lands, or when the epic-spec run for
`V3-E03` decides its shape — whichever comes first."*

---

## §A7 — The reporting window is NOT an activity claim, and its name says so

`AnalyticsService.parentDashboard` derives its **windowing key** (`academicYearId`) from the pupil's enrolment. If
canonicalisation became that key, a child whose active enrolment lives in a non-canonical year — the `AC-5` fixture,
and *both* tenants' `active` year has already ended (`ADR-070` Context, `PF-328`) — would see grades, alerts,
attendance and trend all fall to zero. The parent dashboard carries the north star's *"five questions in under two
seconds"* (`GUARDRAILS §1`).

So `selectReportingWindowEnrollment()` carries the historical precedence **verbatim**, and is named so that no
reader mistakes it for the verdict. **What changes is what is ASSERTED — activity and its label. Never the
windowing key.**

---

## Residuals — named, by id, so none of them is inherited silently

- **§R-1 — `PF-328`, inherited from `ADR-070`, not solved.** No database invariant guarantees "at most one active
  year per school", and on the measured data **both** tenants' `active` year is in the past. The canonical year is
  therefore chosen **deterministically**, not **correctly**, and everything built on it inherits that limit verbatim.
  The contract's docblock says so, because a module that appeared stronger than the resolver beneath it would be
  `DNC-06`.
- **§R-2 — `PF-361`.** The partial unique index promised by the comment at `schema.prisma:669-670` exists in no
  migration; only `enrollment_student_id_class_section_id_academic_year_id_key` does. Two `active` enrolments for one
  pupil in one year in different sections are legal. §4's total order is written **not to assume otherwise**.
- **§R-3 — `PF-360`.** `Student.status` is consulted on no parent path. An `archived` pupil holding an `active`
  enrolment in the canonical year is reported **actively enrolled** by this module. Measured, recorded, deliberately
  not fixed in this slice.
- **§R-4 — `PF-356`.** The canonical year must be keyed on the school that owns the rows (`student.schoolId`), never
  on `SchoolContextService.forUser` — which returns *"the school in the tenant with the most students"*
  (`school-context.service.ts:108-129`). In a multi-school tenant, two projections keyed differently would resolve
  **two** canonical years and reproduce `PF-12` on a fresh axis. The contract's `ActiveEnrollmentContext` docblock
  states the requirement; nothing yet **enforces** it.
- **§R-5 — `PF-357`, and it is why `PF-12` does not close.** The claim panel answers from `GuardianshipClaim` while
  everything else answers from `Guardianship`, so it can still contradict, on the same page, the badge this ADR
  fixes. That is the **third clause of the audit's own `PF-12` sentence**.
- **§R-6 — `PF-363`.** Six parent server pages keep their local `safe()` and still render a failed read as *"Aucun
  enfant rattaché"*. `S-E03-2` shipped `apps/web/src/lib/read-result.ts` for exactly this class. `AC-7` explicitly
  chose **not to half-migrate**; the files are named in the residual.
- **§R-7 — `PF-364`. `endedAt` is REPORTED, never SELECTED on.** `ADR-041 §D2` asks for *"effective-dated as of
  today"* rather than a mutable attribute. Unlike `AcademicYear`, `Enrollment` **can** express it: it carries
  `enrolledAt` **and** `endedAt` (`schema.prisma:659-660`). This module nonetheless selects on `status` + canonical
  year — because that is what the five projections already do, and switching the selection would change results with
  no prior measurement — and **reports** the disagreement as `endedAtDisagreement`, exactly as `academic-year/`
  reports staleness without ever selecting on it. **`ADR-041 §D2` is therefore discharged in INTENTION ONLY.** The
  fix direction is: measure how many rows disagree, then decide, then switch — in that order.

`endedAtDisagreement` is `null`, never `false`, when no reference date is injected. A "no" returned without having
looked is `DNC-08`.

---

## Consequences

**Positive.**

- One derivation of "actively enrolled", in one place, reachable from `apps/api`, `apps/worker` and `apps/web`.
- The absence of an enrolment is answered honestly, and the `out_of_scope` / `none` distinction makes a changed
  number legible instead of alarming.
- Three surfaces whose predicate was **always false** now report a real number, and the KPI beside the badges cannot
  disagree with them — both read `isActivelyEnrolled` over the same verdict.
- A tenant-less enrolment read is not expressible on the canonical path.
- The ratchet turns a tenth hand-rolled derivation into a red build instead of a review miss — for the parent portal
  as a class (RULE A), and as a decreasing ceiling everywhere else (RULE B).

**Negative / accepted.**

- `ADR-041 §D4`'s single registry still does not exist; a family of two modules stands in its place (§A6, `PF-365`).
- The ratchet closes a **declared** class, not the global one: 14 measured re-derivations remain outside the parent
  perimeter, pinned by a ceiling rather than removed.
- `PF-12` closes **advanced**, never `closed`. A row marked `closed` while the claim panel (`PF-357`) still
  contradicts the children list would be the `DNC-06` pattern the two preceding slices each caught themselves
  committing.
- Several surfaces display different values from the day this lands (§5). Intended, and mitigated by the scope label
  rather than by softening the verdict.
- `packages/contracts` grows a second non-DTO module, continuing the precedent `ADR-070 §D1` opened. §A1 is why.
