# V3-E03 — Canonical truth and query contracts

**Layer** L0 · **Size** XL · **Depends on** V3-E02, V3-E01, V3-E05, V3-E04 · **Blocks** V3-E07, V3-E09, V3-E11 → all of L1+
**Owns** PF-04, PF-05, PF-12, PF-15, PF-20, PF-24, PF-36, PF-40, PF-50 · **Gates** G-TRUTH, G-PORTAL (this slice also G-TENANT, G-DNC)
**Decisions** D-09 (canonical KPI definitions — `resolved` 2026-08-13, `ADR-041`)

**Status (2026-08-25)** `in-progress` — **one slice landed: `S-E03-4` (2026-08-25, run 79 — `PF-15` closed on ONE
AXIS OF TWO with `PF-328` as the named residual, `PF-04`/`PF-36` advanced not closed, `ADR-070`).**

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
| **`S-E03-4`** — canonical academic-year resolution | `PF-15` (one axis of two), advances `PF-04` / `PF-36`; raises `PF-327`…`PF-330` | ⚠️ **2026-08-25, run 79 — landed needing human review (NOT auto-merged), P1 `[tenancy][truth]`** |
| `S-E03-1`, `S-E03-2`, `S-E03-3`, `S-E03-5`… | `PF-05`, `PF-12`, `PF-20`, `PF-24`, `PF-40`, `PF-50` | **matrix rows only** — no story authored, not implementable as-is |

---

## S-E03-4 — evidence (this PR, 2026-08-25)

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

## Next slice → `PF-329` — the parent dashboard's TENTH resolution mechanism

`analytics.service.ts:1189` takes `activeEnrollment?.academicYear`, the year of the pupil's active **enrolment**,
never the school's active year. On the measured data an enrolment in a closed year and a school flagged active on
another year give **two different "current year" answers for the same child** — `PF-04`/`PF-36` reproducing on the
**core** portal (`GUARDRAILS §1`: the parent dashboard is the north star, and it answers its five questions in under
2 s or it fails). This ranks ahead of:

- **`PF-328`** (the expand/contract migration + data decision) — bigger, needs a product ruling, and `G-MIGRATION`
  turns it into a different class of slice;
- **`PF-327`** (one missing `tenantId` in a `where`) and **`PF-330`** (a `forUserSchoolOnly` variant) — real, cheap,
  and not worth a slice of their own; fold them into whichever slice next touches those files.

**Take the ledger debt WITH it, not after it.** `PF-327`…`PF-330` are cited from production source and exist in no
ledger file. The next run that allocates ids reads `main` and collides. Also owed and still unwritten:
`scripts/academic-year-resolution-probe.js` (the epic's only Tier-A live artefact), and an **`epic-spec` run** for
`V3-E03` so this epic finally has a `spec.md`/`tasks.md` and a denominator.

*(Written 2026-08-25, `S-E03-4` land pass — the first entry in this file. Later slices: annotate, do not delete.)*
