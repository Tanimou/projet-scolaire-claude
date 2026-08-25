# V3-E03 — Canonical truth and query contracts

**Layer** L0 · **Size** XL · **Depends on** V3-E02, V3-E01, V3-E05, V3-E04 · **Blocks** V3-E07, V3-E09, V3-E11 → all of L1+
**Owns** PF-04, PF-05, PF-12, PF-15, PF-20, PF-24, PF-36, PF-40, PF-50 · **Gates** G-TRUTH, G-PORTAL (this slice also G-TENANT, G-DNC)
**Decisions** D-09 (canonical KPI definitions — `resolved` 2026-08-13, `ADR-041`)

**Status (2026-08-25)** `in-progress` — **two slices landed, both on 2026-08-25, and there was none before them.**
`S-E03-4` (run 80 — `PF-15` closed on ONE AXIS OF TWO with `PF-328` as the named residual, `PF-04`/`PF-36`
advanced not closed, `ADR-070`). `S-E03-2` (run 81 — **`PF-288` CLOSED as a class**, `PF-05` **advanced not
closed**, `ADR-071`). Both landed ⚠️ **needing human review, neither auto-merged**.

> *Numbering correction, run 81:* the entries below originally dated `S-E03-4` to "run 79". The selection log
> (`scheduled-tasks/daily-improvement-v3/state/selection-log.jsonl`) records `S-ROUTINE-1` as run 79, `S-E03-4`
> as run 80 and `S-E03-2` as run 81. The `OPEN.md` rows already say run 80; this file was the outlier.

---

## 0. Read this before anything else — this epic has no spec-kit

**`V3-E03` has never had an `epic-spec` run.** When `S-E03-4` was authored on 2026-08-25, `docs/spec/features/`
contained `v3-e01`, `v3-e02`, `v3-e04`, `v3-e05`, `v3-e06` and **no `v3-e03`** — no `spec.md`, no `tasks.md`, no
`data-model.md`, no `contracts/openapi.yaml`, and no `PROGRESS.md`. **This file is the epic's second written
artefact**, after the story itself; it was created *by* `S-E03-4` precisely so the next slice has a ledger to read.

Three consequences a later run must not rediscover:

1. **There is no enumerated slice backlog, so there is no denominator.** `S-E05`'s ledger says "12 of 12" and its
   own PROGRESS file explains at length why that number is "numerically true and semantically false". `V3-E03`
   starts clean: it says **"1 slice landed"** and nothing else. Do not write "1 of 9" — nine is the count of
   *findings the epic owns*, not of slices, and the mapping is not 1:1 (`S-E03-4` alone touches three of them).
2. **Slice ids come from `docs/daily-improvement-v3/traceability/OPEN.md`, not from a `tasks.md`.** `S-E03-4` is
   named there (`OPEN.md:117` — `PF-15 stale active academic year | V3-E03 | S-E03-4 | open`). The ids `S-E03-1`,
   `S-E03-2`, `S-E03-3`, `S-E03-5`… exist as matrix rows only and are **not implementable without an authoring
   pass of their own** — the same posture the `V3-E05` ledger records for its six unenumerated rows.
3. **An `epic-spec` run for `V3-E03` is still owed and is still the highest-leverage thing available for this
   epic.** `S-E03-4` deliberately did not do it: writing a spec-kit is an `epic-spec` run, not a slice, and
   conflating the two is how a P1 tenancy diff turns into a 4 000-line PR nobody can review.

**Why the epic sat at 0/9 for 22 days.** It is the largest epic in L0 (XL) and it was blocked on `D-09` until
2026-08-13 (`ADR-041`). After `D-09` resolved, nothing scheduled it: 78 runs closed 119 findings and 13 of them were
roadmap findings. `S-ROUTINE-1` (2026-08-23, `ADR-069`) made `RULE 0` enforceable **at selection time**; `S-E03-4`
is the first roadmap slice selected under that ledger, and it is the first `V3-E03` slice ever.

---

## Slice status

| Slice | Finding(s) | State |
|---|---|---|
| **`S-E03-4`** — canonical academic-year resolution | `PF-15` (one axis of two), advances `PF-04` / `PF-36`; raises `PF-327`…`PF-330` | ⚠️ **2026-08-25, run 80 — landed needing human review (NOT auto-merged), P1 `[tenancy][truth]`** |
| **`S-E03-2`** — the parent grades read becomes ONE guarded contract, and a failed read stops rendering as "no grades published" | **closes `PF-288`** (class, both remaining sites); **advances `PF-05`** — NOT closed; raises `PF-335`…`PF-353` | ⚠️ **2026-08-25, run 81 — landed needing human review (NOT auto-merged), P1 `[authz][truth]`** |
| `S-E03-1`, `S-E03-3`, `S-E03-5`… | `PF-12`, `PF-20`, `PF-24`, `PF-40`, `PF-50` | **matrix rows only** — no story authored. `S-E03-3` is now the cheapest of them: `parent-grade-projection-agreement.spec.ts` (run 81) already captures both projections' `where` clauses out of production code |

---

## S-E03-4 — evidence (run 80, 2026-08-25)

Story: [`docs/daily-improvement-v3/stories/S-E03-4.md`](../../../daily-improvement-v3/stories/S-E03-4.md).
ADR: [`docs/adr/ADR-070-canonical-academic-year-resolution.md`](../../../adr/ADR-070-canonical-academic-year-resolution.md).

### What was actually wrong

`academic_year` was resolved **nine times by hand across seven files**, and the nine resolutions disagreed on
**four axes**:

| axis | the disagreement |
|---|---|
| **tenancy** | `school-context.service.ts:32` filtered on `schoolId` **alone** — no `tenantId` — in the service every authenticated request transits. `packages/imports-core/src/caches.ts:53` did the same, on the import **write** path. |
| **ordering** | four of the nine had **no `orderBy` at all**; the other five had `startDate desc`, which is not a total order. |
| **absence** | **three** different behaviours: `null`; a silent fallback to the most recent year of *any* status; and a fallback of `activeStudents` to the unscoped `totalStudents`. |
| **multiplicity** | `subjects.controller.ts:381` assumed *many* active years (`findMany`); the other eight assumed exactly one. |

Measured on the running stack (2026-08-25, `docker exec pilotage_postgres psql -U pilotage -d pilotage`):
`academic_year` holds **4 rows across 2 tenants**, each school has **exactly one** `active` year, and **both**
tenants' active year has already **ended** — `2025-2026` on 2026-07-05 (51 days) and `2023–2024` on 2024-07-05
(more than two years). No code path noticed. That is `PF-15` reproducing, and it is one measured mechanism of
`PF-04` (one dataset, incompatible counts across portals) and `PF-36` (teacher counts 43/46/48, a class 25/26).

### What the fix is, and why it has the shape it has

- **One module, framework-free**: `packages/contracts/src/academic-year/resolve-academic-year.ts` exports
  `resolveActiveAcademicYear` and `listActiveAcademicYears`. It imports **neither `@prisma/client` nor
  `@nestjs/*`** and adds **no dependency** to `packages/contracts/package.json` — the CJS pin of `GUARDRAILS §2` is
  untouched. Prisma reaches it through a **structural port** (`AcademicYearReader`), with a thin adapter per app.
- **`tenantId` is required by the TYPE**, not by convention: it sits on `ResolveActiveAcademicYearOptions`,
  `ListActiveAcademicYearsOptions` **and** the internal `AcademicYearWhere`, `buildWhere` puts it in every query
  **including the fallback branch**, and `requireTenantId` refuses the empty string at runtime. An unscoped
  active-year resolution is no longer merely forbidden — it is **unexpressible**.
- **The adapter is duplicated on purpose** (`apps/api/src/shared/academic-year/` and
  `apps/worker/src/shared/academic-year/`), forced by `apps/worker/tsconfig.json`'s `rootDir: ./src`. What is
  duplicated is a **wire**, not a decision (`ADR-070 §D2`). Unifying it requires changing `rootDir` first, which is
  its own ADR.
- **Twelve call sites converted, not nine.** The three extra are the callers of `buildImportCaches`
  (`imports.service.ts:515`, `integrations.service.ts:270`, `imports.processor.ts:205`), forced by hoisting the
  resolution out of `packages/imports-core/src/caches.ts`. That site is the **only one where the defect was
  PERSISTED**: `ImportCaches.activeAcademicYearId` is written into new `class_section` and `enrollment` rows by
  `handlers/classes.handler.ts` and `handlers/enrollments.handler.ts`, so a wrong resolution there corrupts data
  rather than misreporting a count. It was hoisted rather than converted in place because adding
  `@pilotage/contracts` to that package means a `package.json` + lockfile + **two production Dockerfile** edits
  that no agent in this run is allowed to build and verify.
- **Staleness is reported, never selected on**: `isStale`, `staleByDays`, `containsReferenceDate`, `activeCount`
  ride on `ResolvedAcademicYear`, and the two low-frequency alerts sites log one structured WARN.
  `SchoolContextService` deliberately logs **nothing** — one warning per authenticated request is noise, not
  signal.
- **No response shape changed.** Every consumer reads `.id` only (`activeYear?.id ?? null`); `forTenant` still
  returns `{ tenantId, schoolId, activeAcademicYearId }`. The richer `ResolvedAcademicYear` never reaches a
  response body.

### The honesty clause on site 6 — read it before quoting the closure

`school-context.service.ts` was **not** a demonstrated cross-tenant leak. `forTenant` derives `schoolId` either
from `resolveDefaultSchoolId(tenantId)` or from an explicit id it first validates with
`school.findFirst({ where: { id: schoolId, tenantId } })`, so the academic-year query was *transitively* safe — by
an invariant held two calls away, in a different method. The closure is claimed **on construction, not on a live
leak**. RLS did not cover the gap and could not: the whole path runs on `PrismaService`, the **owner** connection,
where row security is bypassed (`current_user = pilotage`, verified on the stack).

### Evidence, executed

| check | result |
|---|---|
| `pnpm typecheck` | **13 successful / 13 total**, `TYPECHECK_EXIT=0` |
| `git diff --check` | exit 0 (two informational CRLF warnings only) |
| `academic-year-resolution-gate.spec.ts` (the ratchet) | **PASS**, 22 cases, negative **and** positive controls, floors hold |
| `school-context-tenant-scope.spec.ts` (new, 7 cases) | **7/7 PASS**, **red-before evidenced by execution** |
| `resolve-academic-year.spec.ts` (30 cases) | PASS after two **test-side** defects were fixed |
| converted-site specs (analytics drilldown, subjects, imports, integrations, worker) | PASS |
| `analytics.service.spec.ts` — 7 pre-existing failures | **already in `scripts/known-test-failures.json` on `origin/main`, `"Owner: V3-E03"`** — not this PR's regression, but this **epic's** debt |

**The typecheck was RED when the escalation panel ran**, at 42 errors, all in one new file and all from one root
cause: the literal `*/` inside a prose token closed the ratchet spec's `/** … */` header at line 48 col 56, so
lines 48–115 were parsed as TypeScript. Test-only, one token, fixed, re-run green. Worth recording because the
background-task notification claimed "exit code 0" — that was a trailing `echo | tee`, not the gate. **Read the
last `GATE:`/`TYPECHECK_EXIT` line, never a notification.**

**Red-before is evidenced, not asserted.** `school-context-tenant-scope.spec.ts` was written against the *caller*
axis that neither the resolver spec nor the ratchet covers — *does a caller pass the right tenant?* — because
`tenantId: string` happily accepts the empty string, the school id, or another tenant's id. Site 6 was patched back
to `findFirst({ where: { schoolId, status: 'active' } })`, the suite ran **5 failed / 2 passed** (the seeded
drifted row returned the other tenant's year), and the file was then restored.

### The ratchet — and what it does not prove

`apps/api/src/shared/quality/academic-year-resolution-gate.spec.ts` (653 lines) derives its inventory by walking
three roots — including `packages/<paquet>/src`, the root the house precedent hardcodes away and the root where the
worst site lived. It recognises the resolver's home **by construction** (asserted to be exactly one file), separates
read from write **structurally** so the `academic-years.controller` state transition passes without a named
exception, carries per-root anti-vacuity floors measured at **170/61/48 against 150/50/38**, uses a synthetic
`fixtureYear` model, and ships `MANUAL_ALLOWLIST` **empty and asserted empty**. No `SKIP_*`, no `NODE_ENV` escape.

**It proves a SHAPE, not correctness.** Specifically it holds the **resolution** class shut (`status: 'active'`
filters outside the resolver) and **not** the **tenancy** class: a read re-introduced as
`academicYear.findFirst({ where: { schoolId } })` — no status literal — is green today, and
`academic-years.controller.ts:109` is exactly that shape right now (recorded as `PF-327`). Correctness is the
executed unit suite and the probe, not the gate.

### Merge conditions a human owns — none fixed here

1. **The story's P1 STOP condition was never measured as a committed artefact.**
   `scripts/academic-year-resolution-probe.js` **does not exist** (AC-9 unmet). The panel measured **0 drift, 4
   rows, 2 tenants, exactly 1 active year per school** via ad-hoc `docker exec` on the **local** stack. Re-run
   `SELECT count(*) FROM academic_year ay JOIN school s ON s.id = ay.school_id WHERE ay.tenant_id IS DISTINCT FROM
   s.tenant_id;` against the **Hostinger prod** DB before merge — non-zero means those schools silently lose their
   active year on all four portals and their imports start refusing, and **no schema constraint carries the local
   `0` to prod** (`AcademicYear.tenantId` has no FK and no composite FK to `school(tenant_id, id)`).
2. **The ledger side is entirely unwritten** (AC-12 unmet). `traceability/OPEN.md`, `CLOSED-L0.md`, `RUN-LOG.md`
   and `audit-findings-index.md` are unmodified. `PF-327`…`PF-330` are cited from **production comments** and exist
   in **no ledger file** — the exact id-collision failure mode this repo has already been bitten by (`PF-185`,
   `PF-186`, `TOOL-27` each named two findings in 2026-08-14). **Allocate against open PRs, not just `main`.**
3. **`PF-329` and `PF-330` are each used with two or three different meanings inside this diff.** `PF-330` means
   the unordered-fallback determinism note, the `ci-gate.sh` `GATE_MACHINERY` residual, **and** the
   `SchoolContextService` per-request cost. Renumber **by MEANING**, never by pattern-replace.
4. **`buildImportCaches` still issues five tenant-less sibling reads** — `gradeLevel`, `subject`, `classSection`,
   `student`, `guardian`, all scoped by school alone, on the same owner connection, feeding matching/dedup on the
   import **write** path — while the new header comment asserts the hoist *"closes the tenancy defect at the three
   callers"*. `ADR-070` sets the standard itself (it refuses "correct by accident of its caller" at
   `school-context.service.ts`); apply it to the five or soften the claim and give the gap an id.
5. **`@pilotage/imports-core` is not jest-mapped to source**, unlike `@pilotage/contracts` (mapped in both
   `apps/api/jest.config.js:19` and `apps/worker/jest.config.js:12`). The one package whose signature this diff
   **breaks** resolves through a gitignored `dist/` at test time *and* at runtime. **Landing prerequisite:
   `pnpm --filter @pilotage/imports-core build` via `exec` before any worker start** — a stale `dist` runs the old
   two-argument function, which ignores the passed year and re-resolves it school-only, with typecheck and the
   ratchet both green.

### Recorded, not blocking

- `school-performance-drilldown.service.ts:152` — `term.findMany({ where: { academicYearId } })`, **no `tenantId`**,
  directly below the converted resolution. Currently **unreachable** (`analytics.controller.ts:107` exposes no
  `@Query('academicYearId')`); it becomes a live cross-tenant read the day someone adds that param. Same shape at
  `analytics.service.ts:3817`.
- `alerts.service.ts:909`, `alerts-evaluator.service.ts:83`, `enrollment-xlsx.generator.ts:27` keep
  `...(schoolId ? { schoolId } : {})`. Without `schoolId` the resolution spans **every school in the tenant**, and
  the new total order makes a wrong-school pick **stable** rather than random. Within-tenant, pre-existing, now
  deterministic.
- The resolver replaced `findFirst` (implicit `LIMIT 1`, five sites also had `select: { id: true }`) with an
  unbounded `findMany`. `activeCount` is the only consumer of the full set; `take: 2` would preserve the
  multiplicity signal exactly.
- `startDate`/`endDate` are `@db.Date` (UTC midnight) while every call site injects `new Date()` (wall clock), so
  `isStale` fires on the year's **final day** with `staleByDays: 0`. Log noise only.
- Both tenants are already stale, so the new WARN fires on **every** alerts evaluation from day one. By design
  (`PF-15` exposes, never selects), but expect a permanently hot warn line, not an anomaly signal.

### `PF-15` closes on ONE AXIS OF TWO — do not let the row read plain `closed`

The **resolution** axis closes: canonical, tenant-keyed, totally ordered, staleness reported. The **data** axis does
not: both tenants' active year is still in the past, and **no invariant forbids it** (`AcademicYear` has only
`@@unique([schoolId, name])`). The residual is **`PF-328`**, deliberately deferred — the two natural invariants
(*at most one `active` year per school*, *the active year contains today*) **fail on the existing data**, so they
need an expand/contract migration **and** a product decision about what "active" means for the two violating rows.
G-MIGRATION was correctly **not** triggered, so `scripts/restore-drill-baseline.json` owes no entry (`PF-80` not
armed).

`PF-04` and `PF-36` are **advanced, not closed**: one measured mechanism of each is removed. `PF-329` — the parent
dashboard's enrolment-derived year — is a **tenth** mechanism on an axis this slice does not touch, and naming it is
what keeps `PF-04`'s eventual closure honest.

---

## S-E03-2 — evidence (run 81, 2026-08-25)

Story: [`docs/daily-improvement-v3/stories/S-E03-2.md`](../../../daily-improvement-v3/stories/S-E03-2.md).
ADR: [`docs/adr/ADR-071-student-read-authorisation-and-failed-reads.md`](../../../adr/ADR-071-student-read-authorisation-and-failed-reads.md).

**Selected as an operator override.** The `Next slice` pointer this file carried nominated `PF-329`; the SLICE
argument named `S-E03-2` / `PF-05` and wins outright (`selection-log.jsonl` run 81). `PF-329` stays open and
unclaimed, and the pointer below now points somewhere else again — read the reasoning, not the id.

### What was actually wrong — two defects that meet on one page

**(a) Authorisation.** The parent's "my child's grades" read was guarded by **private copies** of the student ABAC,
not by `StudentAccessService`. Twelve non-spec `guardianship.find*` sites exist; **four** are authorisation:

| site | teacher branch, pre-diff | this slice |
|---|---|---|
| `students/student-access.service.ts:112` | UNION, bounded (`ADR-066`) | **the home** |
| `attendance/attendance.controller.ts:637` | bounded (`teacherOfStudentWhere`) | allowlisted, reason inline |
| `grades/grades.controller.ts:466` | **UNRESTRICTED** — the verbatim `PF-288` fail-open `S-E05-16` closed at the service | **deleted** |
| `lessons/lessons.controller.ts:367` | **absent entirely** — only `roles.includes('parent')` | **converted** |

The lessons site is the worse of the two: every other holder of `lessons.read` — teacher, school_admin — read an
arbitrary student's lesson feed with **no check at all**.

**(b) Truth.** When either read on `/parent/grades` failed, `safe()` returned `null`, `?? []` turned it into an
empty array, and the parent was shown **"Aucune note publiée"** — a positive, school-wide claim manufactured out of
a 403. `PF-05` also reproduces on today's seed by a mechanism the audit never named: `parent@pilotage.local` holds
**two** active guardianships (Jade Brun, 1 published grade; Chloé Moreau, 0), `/api/v1/students` orders by
`lastName, firstName`, and `/parent/grades` defaults to `children[0]` while `/parent/dashboard` loops over **all**
children. Change a name and the grades page says "no grades published" while the dashboard shows 11.2 — **no API
divergence required**. That is `PF-335`.

### What the fix is, and why it has the shape it has

- **One service, wired by `imports:` not `providers:`.** `GradesModule` and `LessonsModule` gain
  `imports: [StudentsModule]` (`ADR-071 §D1`). `StudentsModule` already `exports` the service, and its closure is
  acyclic — `Students → {Auth, SchoolStructure, Teaching}`, `Teaching → {Auth, SchoolStructure}`,
  `SchoolStructure → {Auth}` — verified by reading the graph, because a missing edge here is a Nest **bootstrap**
  failure: a total API outage, not a red test.
- **The lessons decision is hoisted ABOVE `this.scope.run(...)`** (`§D2`). The service reads on the **owner**
  connection; calling it inside the scope holds two connections for the whole interactive transaction and makes a
  403 abort a transaction it never needed. The `tx.enrollment.findMany` that follows stays **inside** — it is data,
  not authorisation.
- **The grades 404-before-403 ordering is deliberately FROZEN.** The pre-existing `findUnique` + `tenantId` check
  produces the 404; the ABAC produces the 403. Hoisting authorisation above it would have converted the 404 into a
  cross-tenant **existence oracle**.
- **Honest failure rendering, by reuse.** `apps/web/src/lib/read-result.ts` (`read()`, `ReadResult`,
  `isAccessDenied`) sits on the existing `ApiResult` + `apiResultFromError`, and `NEXT_REDIRECT` is re-thrown
  **first** so an expired parent session never prints the Next digest into the UI (`PF-174`). A `'use client'`
  `ReadErrorState` wrapper carries the retry. **Two** reads converted, not a 61st `safe()` — 58 remain (`PF-336`).
- **The earned empty state names the child** (`AC-4b`, `PF-335`'s fix): *"Aucune note publiée pour `<Prénom Nom>`"*,
  from the already-loaded `children` array, no extra fetch. A sentence with no subject is read as a claim about the
  school.
- **`AC-5` took its STOP branch, and that is the correct outcome, not a shortfall.** The canonical
  `published-grades.where.ts` could not be adopted at **both** call sites, and §7 mandates *"ship neither and
  report"* — so it ships **nowhere**, and neither `analytics.service.ts` nor `grades.service.ts` is touched. The
  substitute, `parent-grade-projection-agreement.spec.ts`, captures both projections' `where` clauses **out of live
  production code** via a Prisma abort sentinel rather than re-typing them. A hand-copied comparison would have been
  the two-hand-kept-lists drift that produced a 503 on four portals.

### The ratchet — and what it does not prove

`apps/api/src/shared/quality/student-authz-locality-gate.spec.ts` (745 lines) states its rule over **authorisation
resolution**, never over `guardianship` queries. The obvious model-name rule flags **eight innocents**: the fan-outs
and admin listings bind `guardian: { userProfileId: { not: null } }` — *every guardian with an account* — where an
authorisation binds `guardian: { userProfileId: <caller> }`. The discriminator is **two signals in one body**: an
identity binding **and** a `realm_access` read.

Inventory derived by walk over three roots; home recognised **by construction** (asserted exactly one); synthetic
fixture model; per-root anti-vacuity floors; real-code negative controls (a fan-out **and** the digest cron); no
`SKIP_*` / `ALLOW_*` / `NODE_ENV`; `MANUAL_ALLOWLIST` asserted to contain **exactly** `attendance.controller.ts`
with its reason inline; and a self-scan forbidding `process.env`.

**It is narrower than its own docblock claims, and the gap is recorded as `PF-349`.** Two rewrites of the very shape
it polices pass it: `guardian: { userProfileId: { equals: me.id } }` (an object-literal value is classified
`fan-out` unconditionally), and `const where = {…}; findFirst({ where })` (only `PropertyAssignment` is walked, so a
shorthand yields zero bindings). Neither is disclosed in the "CE QUE LE CLIQUET NE PROUVE PAS" list. It also cannot
see the class `PF-341` belongs to at all — a filter with **no** authorisation reads no `guardianship` and no
`realm_access`, so it is invisible by construction.

### Evidence, executed

| check | result |
|---|---|
| `pnpm typecheck` | **13 successful / 13 total** — **RED at exit 2** when the escalation panel ran (see below) |
| `git diff --check` | exit 0, tracked **and** vs `main`; 0 trailing-whitespace lines across the 9 new files |
| `grades-read-abac.spec.ts`, `lessons-read-abac.spec.ts` | authored this run; 404-before-403 pinned at `grades-read-abac.spec.ts:242` |
| `lessons-scope-ownership.spec.ts` (pre-existing, rewired) | in-scope budget 3 → **2**; new `scopeAtOwnerAbacRead === [undefined]` |
| `parent-grade-projection-agreement.spec.ts` | both `where` clauses captured from production via abort sentinel |
| `student-authz-locality-gate.spec.ts` (the ratchet) | floors hold, negative controls on real code, allowlist asserted exactly one |
| **`scripts/parent-grades-contract-probe.js`** | **WRITTEN AND EXECUTED at the land pass — `AC-9` MET, Tier-A evidence item 4 MET.** `PROBE: PASS — 6/6` in `--expect-prefix` mode against the pre-slice image, then `PROBE: PASS — 6/6` in POST-FIX mode against the image rebuilt and recreated at land. See §"The Tier-A live probe, executed" below |
| `AC-13` (a browser driven against the stack) | **NOT OBSERVED** — third consecutive slice |

**The typecheck was RED when the panel ran, and the reason generalises.** The slice appended a constructor parameter
to `GradesController` (4 → 5) and `LessonsController` (5 → 6). **Two legacy harnesses this diff never opened** —
`lessons-scope-ownership.spec.ts:258` and `provenance-callsites.spec.ts:616` — construct those controllers
**positionally**, so they stopped compiling. Every *new* spec in the slice passes the argument correctly, and every
new spec uses `new Controller(...)` rather than Nest DI — which is simultaneously why the arity broke silently and
why the container wiring is proven by **prose** ("CYCLE-LIBRE, vérifié ce run") rather than by execution.

**The fix pass did not stop at the arity, and that matters.** Two assertions in `lessons-scope-ownership.spec.ts`
were **factually wrong** post-hoist, not merely uncompilable: they pinned `guardianship.findFirst` *inside*
`scope.run` and a 3-statement budget. A permissive double would have made them green while declaring an
authorisation the suite does not observe. The harness was instead rewired onto the **real** `StudentAccessService`
over the owner-connection double, so the 403 control still denies **for the real reason**
(`studentIds: []`), and a new assertion pins the invariant the hoist actually buys — one nothing anywhere pinned.
Likewise `parent-grade-projection-agreement.spec.ts:355` asserted "A émet ZÉRO requête" while `parentDashboard`
carries a **second**, unconditional `grade.findMany` at `analytics.service.ts:1096`; rewritten to assert **identity
rather than absence**.

### The Tier-A live probe, executed at the land pass (`AC-9` — closed, `PF-343`)

**Written and run by the land pass rather than inherited**, because Tier A is not gradeable downward and because
letting probe debt become a slice is exactly how `S-E03-4`'s probe was inherited. Both halves ran against the local
Docker stack; the API image was **rebuilt and the container recreated** between them (SKILL Step -1), and nothing
else in the stack was touched.

| | pre-slice image (built 14:40, no bind mounts) | image rebuilt + recreated at land |
|---|---|---|
| P1 unbound teacher reads an arbitrary child **transcript** | **200** — the fail-open, on the wire | **403** |
| P1b same teacher reads that child's **stats** | **200** | **403** |
| P2 parent reads their own guarded child | 200 | 200 — unchanged |
| P3a/P3b the two projections, same child, same breath | 200, counts agree (1 = 1) | 200, counts agree (1 = 1) |
| P4 same teacher reads that child's **lesson feed** | **200** | **403** |
| verdict | `PROBE: PASS — 6/6` (`--expect-prefix`) | `PROBE: PASS — 6/6` |

**`PF-288` is therefore observed, not inferred.** A provisioned teacher holding **zero** `TeachingAssignment` read
a child's full transcript, that child's statistics and that child's lesson feed from the running system.

**The first execution was a FALSE GREEN, and that is recorded as `PF-354`.** In POST-FIX mode every teacher
expectation answered 403 — exactly what the fix should produce. It was not the fix: `teacher@pilotage.local` had no
`UserProfile`, so `ensureUser` refused with `403 ACCOUNT_NOT_PROVISIONED` **before the request reached
`assertCanReadStudent`**, while the container still ran the pre-slice image. The probe now carries
`assertReached()`, which treats that code as **INCONCLUSIVE** — never a pass — and aborts naming the fixture work.
A probe that cannot separate the wall under test from a wall upstream is not evidence.

**What P3 still does NOT prove** (`§LIMIT` in the probe): it compares counts for ONE child on ONE seed, and the
dashboard projection is a strict SUBSET of the grades feed, so agreement means "the four divergence axes did not
bite on this child", never "the projections are one query". **`PF-05` stays `advanced`.**

**Local fixtures created by the land pass** (local data is expendable, SKILL Step -1): a `user_profile` for
`teacher@pilotage.local` in tenant `53fe06f3…` — deliberately with **no** `TeacherProfile` and **no** assignment,
which is the whole point — and a guardianship linking `parent@pilotage.local` to a child that has a published
grade. The probe **discovers** both rather than creating them, and says so when they are absent.

### Merge conditions a human owns

1. ~~**The Tier-A live probe does not exist.**~~ **DISCHARGED at the land pass — see the section above.** Original
   text retained for the record: **The Tier-A live probe does not exist.** `scripts/parent-grades-contract-probe.js` is named in `FR11`, in
   `AC-9`, and in `ADR-071 §Verification` item 4 as *non-downgradable* — and it is absent from the tree.
   `apps/web/tests/e2e/journeys/parent-grades-read-truth.spec.ts:28` **explicitly forwards** the S1/S3/S4
   failure-state proof to it, correctly refusing to fake a server-component failure with `page.route()`. `apps/web`
   has **no unit runner**. Net: `ReadErrorState`, both failure branches of `parent/grades/page.tsx`, and the
   `denied`-vs-`failure` split have **never been rendered by anything**. This is `landed: true ≠ ran: true` — run
   77 reproduced verbatim. Either write and execute the probe (mint tokens with the derived `secretOf`/`passwordOf`
   recipe from `scripts/keycloak-live-probe.js:252/:268`, **never a literal**, `PF-228`), or downgrade the claim in
   writing to *"mechanism proven, deployment not"* and re-point the e2e docblock at something that exists. Recorded
   as `PF-343`.
2. **`?classSectionId=` is the unguarded sibling of the parameter this slice walled.** `lessons.controller.ts` fires
   the new wall only `if (studentId)`; three lines above,
   `if (classSectionId) where.teachingAssignment = { classSectionId }` has **no ABAC whatsoever**. A parent drops
   `studentId`, passes any section id — handed to them verbatim by their own child's response
   `include: { classSection: { select: { id, name } } }` — and reads that class's published lesson feed. Pre-existing;
   this slice makes it load-bearing and then claims in production that the change *"supprime la possibilité même
   d'un appelant oublié"*, true of one branch of two. `PF-341`, and the next slice.
3. **The failure copy asserts a domain fact.** On a failed `/api/v1/students` read the page renders *"Vos enfants
   sont bien rattachés à votre compte — c'est l'affichage qui a échoué."* On a 403 — revoked guardianship, the exact
   case `isAccessDenied` routes down this branch — that is probably **false**, and it is shown to a parent. Same
   defect class as `PF-05`, opposite sign; flagged independently by four review lenses. The branch also passes
   `retryable={!isAccessDenied(...)}` while its description still says *"Réessayez dans un instant"*, so a denied
   parent is told to retry with no control to retry with. `PF-346`.
4. **`?? []` was dropped in the `safe()` → `read()` conversion.** `childrenRead.data.data` and `gradesRead.data.data`
   assume a body: `api()` returns `undefined` on HTTP 204, so a 200 with an empty or `null` body now throws inside
   the server component and lands on the generic `/parent/error.tsx`, where the pre-diff code rendered the honest
   empty state. `PF-347`.
5. **`assertCanReadStudent` survives as a two-line delegate**, where `AC-1` said *"DELETED outright, not delegated
   from"*. The rule content is genuinely gone — no Prisma read, no role branch — so this is not a fail-open, but a
   future grep for the removed guard still finds the name, and the ratchet cannot see it (it opens no `guardianship`
   read and reads no `realm_access`). Either inline it at both call sites or amend `AC-1`; do not leave the AC and
   the code disagreeing silently.

### Recorded, not blocking

- **The teacher wall now 403s for `pending` and `transferred_in` enrolments.** `student-access.service.ts:191`
  resolves taught students through `enrollment.findMany({ where: { status: 'active' } })`, and this slice extends
  that wall to three more routes. `pending` is the normal state during pre-rentrée enrolment. `ADR-071 §D1` prices
  only *"teachers lose non-taught access"*. `PF-350`.
- **A custom role holding `lessons.read` without a realm role is now a hard 403** on `/api/v1/lessons?studentId=`:
  `PermissionsGuard` resolves `effectivePermissions(sub, realmRoles)` (`ADR-013`/`ADR-015`), the guard passes, and
  `scopeForUser` falls to *no role with student access*. Deliberate and tested — and a second live-portal
  regression class absent from the ADR's release note. `PF-348`.
- **`ErrorState` gained a `children` slot with zero consumers**, documented as *"how a server component injects a
  client control"* — while the app solved the same need the opposite way, with the `ReadErrorState` client wrapper
  and `onRetry`. Two sanctioned mechanisms for one need, one dead on arrival, in a shared DS component, with a
  docblock that prescribes the pattern the only new call site does not use. `PF-351`.
- **The two new failure branches skip a heading level** (`h1` from `PageHeader` → `h3` from `ErrorState`), on
  branches where that `h3` carries the entire meaning of the screen. Pre-existing across all four portals; this
  diff adds two instances on a P0 parent surface. `PF-345` — **renumbered by MEANING** from the `PF-337` the DS
  lane had allocated to it, which `ADR-071:17` had already given to *three permissions for one datum*.
- **The new *Réinitialiser les filtres* CTA renders white on `--parent-500` at 3.79:1**, below the 4.5:1 required
  for 14 px bold. Only the 600/700 end of `--accent-gradient` clears it (5.12:1 / 6.57:1). This also **falsifies the
  assertion in `packages/design-tokens/src/tokens.css:66-69`** that the 500/600/700 ramp keeps white text ≥ 4.5:1 —
  measured, `--parent-500` is 3.79:1 and `--teacher-500` is 3.31:1; the claim holds from 600 down. Pattern is
  pre-existing (`parent/messages:114`, `parent/settings:358`); this is the third instance. `PF-352`.
- **`ADR-071 §D3` describes an artefact this PR does not contain** — the shared `teaching-wall.where.ts`-shaped
  predicate, with four non-negotiable properties. `AC-5` correctly refused to half-ship it, but the ADR text was not
  reconciled, so the next reader looks for the module and does not find it. Same row: `apps/web/src/lib/read-result.ts`
  is a new cross-cutting front-end convention that `§D5`'s reuse table does not name, and it value-imports
  `apiResultFromError` from `@/lib/api-client` — a **server** module whose own docblock warns that a value-import
  from a `'use client'` file breaks `next build` (`PF-133`). `read-result.ts` carries no such warning and exports
  `isAccessDenied`, which a client component would naturally reach for. `PF-353`.
- The `AC-4b` empty state still **contains** the literal substring *"Aucune note publiée"* (now suffixed with the
  child's name). `FR11-P4` specifies the probe assert the failure HTML does **not** contain that phrase; a naive
  substring probe will therefore also trip on the legitimate empty state. The shipped Playwright spec already works
  around this by keying on `role="status"` vs `role="alert"`. Key the probe the same way.

### `PF-05` is ADVANCED, never `closed` — and `PF-288` IS closed

`PF-288` closes as a **class**, not a handler: both remaining private copies are gone and a derived ratchet holds
the shape shut.

`PF-05` does **not** close, per `AC-7` and `ADR-071 §D8`. The count divergence between projections A and B is
**undemonstrated on the seed**; six projections remain six (`PF-337` names the three permissions for one datum,
`PF-338` the two the student portal holds that disagree with each other); and `PF-339` — `analytics.service.ts:977`
`if (!g.value) continue` — still deletes a legitimate grade of **zero** from every A-backed surface including the
north-star dashboard. Closing `PF-05` here would be the KPI/ledger divergence `DNC-01` forbids.

`G-MIGRATION` was correctly **not** triggered — no `schema.prisma` edit — so `scripts/restore-drill-baseline.json`
owes no entry (`PF-80` not armed).

---

## Next slice → `PF-341` — the `?classSectionId=` sibling of the parameter `S-E03-2` just walled

`lessons.controller.ts` now refuses an unauthorised `?studentId=`. Three lines above it,
`if (classSectionId) where.teachingAssignment = { classSectionId }` has **no ABAC at all**. A parent holding
`lessons.read` bypasses the new wall by **omitting the parameter it guards**: drop `studentId`, pass any section id
— handed to them verbatim by their own child's response `include: { classSection: { select: { id, name } } }` — and
read that class's published lesson feed: teacher names, subjects, homework, dates. `PF-340` confirms the two filters
never intersect, so there is no accidental containment.

Three reasons it ranks first:

1. **This slice made it load-bearing** and then wrote in production that the change *"supprime la possibilité même
   d'un appelant oublié"* — true of one branch of two. A closure claim standing beside a naked sibling is the
   `DNC-06` pattern.
2. **It is the cheapest slice on the board.** The guard, the service and the ratchet all now exist; it is one call
   and one spec. The only real design question is what a *parent* may pass — presumably only a section their child
   is enrolled in — and `StudentAccessService` already resolves that set.
3. **The ratchet cannot catch this class.** It keys on `guardianship` reads bound to caller identity, so a filter
   with *no* authorisation reads no `guardianship` and no `realm_access` and is invisible by construction. It needs
   a slice, not a gate.

It ranks ahead of:

- ~~**`PF-343`**~~ **DISCHARGED at the land pass of run 81** — `scripts/parent-grades-contract-probe.js` was
  written and executed, both halves, and the API image rebuilt between them. It did **not** become a slice. What it
  produced instead is a new open class, **`PF-354`**: every authorisation probe in `scripts/` asserts on a bare
  status code, and 401/403/404 are each reachable from several layers — so a probe that asserts a status is
  asserting a coincidence until it also asserts the discriminating body code.
- **`S-E03-3` / `PF-12`** — the A-and-B predicate unification that `AC-5` deliberately refused to half-ship. Bigger,
  and now **cheaper than it was**: `parent-grade-projection-agreement.spec.ts` already captures both `where` clauses
  out of live production code and names the divergence axes, so the red-before harness it needs is written. Next but
  one.
- **`PF-329`** — the parent dashboard's tenth academic-year mechanism, the pointer `S-E03-4` set here. Still open,
  still unclaimed. `S-E03-2` was an operator override, not a re-ranking of `PF-329`; do not read its displacement as
  a judgement.
- **`PF-346`** — the failure copy that asserts guardianship as a fact. A one-string change on a P0 parent surface
  that contradicts this slice's own `AC-4`. Fold it into this PR's merge if a human is in the file anyway.
- **`PF-328`** — the expand/contract migration and the product decision about what "active" means. Unchanged from
  `S-E03-4`'s ranking: bigger, needs a ruling, and `G-MIGRATION` makes it a different class of slice.

### Two structural gaps this epic keeps paying for

**No test executes the Nest module graph.** Three docblocks in this diff (`students.module.ts`, `grades.module.ts`,
`lessons.module.ts`) each state that a missing `imports: [StudentsModule]` fails Nest **at bootstrap** — *"une panne
TOTALE de l'API, pas un test rouge"* — and then rest on a hand-written prose claim (*"CYCLE-LIBRE, vérifié ce
run"*) as the only evidence. Every new spec here uses `new Controller(...)` positionally, which bypasses DI
entirely, which is both why the wiring is unproven **and** why two legacy harnesses broke on arity without anyone
noticing until the gate. One `apps/api/src/shared/quality/module-graph-bootstrap.spec.ts` asserting
`await Test.createTestingModule({ imports: [AppModule] }).compile()` resolves — Prisma and Keycloak overridden by
doubles — converts a total-outage failure mode from prose into an executed check, and covers every future module
that gains a dependency. **This is the single highest-value test this epic is missing.**

**`apps/web` still has no unit runner**, so every front-end truth claim in this epic is argued from reading. That is
what made `PF-343` possible: a shipped spec could forward its proof obligation to a file that does not exist, and
nothing failed. `V3-E06`'s ledger already nominates a unit runner over `apps/web/src/lib` as the cheapest slice on
that board; `read-result.ts` (77 new lines, zero tests, and the module 58 remaining `safe()` pages are meant to
migrate onto) is now a second reason.

**Still owed for `V3-E03`, unchanged since `S-E03-4`:** an **`epic-spec` run**, so this epic finally has a
`spec.md`, a `tasks.md` and a denominator. Two slices have now landed against a backlog nobody has enumerated.

*(Written 2026-08-25, `S-E03-2` land pass, run 81. Later slices: annotate, do not delete.)*
