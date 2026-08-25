# ADR-070 — The active academic year is resolved ONCE, by a framework-free port in `@pilotage/contracts`

- **Status** Accepted (architecture ruling, `S-E03-4` — run 79)
- **Date** 2026-08-25
- **Story** `S-E03-4` — [`docs/daily-improvement-v3/stories/S-E03-4.md`](../daily-improvement-v3/stories/S-E03-4.md)
- **Epic** `V3-E03` — Canonical truth and query contracts (layer L0)
- **Closes (one axis of two)** `PF-15` — stale/divergent active academic year. **The RESOLUTION axis closes; the
  DATA axis does not.** The resolver is canonical, tenant-keyed, totally ordered and now *reports* staleness. Both
  tenants' `active` year is still in the past and no invariant forbids it. The residual is `PF-328` and the ledger
  row must name it — see §D5 and §D7
- **Advances (not closed)** `PF-04` (one dataset, incompatible counts across portals) · `PF-36` (teacher-count
  variance) — one measured mechanism of each is removed; neither is claimed closed
- **Raises** `PF-327` (a second tenant-less `academicYear` query, `academic-years.controller.ts:109`) ·
  `PF-328` (no "at most one active year", no "active year contains today" — needs expand/contract + a data
  decision) · `PF-329` (the parent dashboard resolves the year from the pupil's *enrolment* — a tenth mechanism,
  on an axis this slice does not touch) · `PF-330` (`SchoolContextService` pays the year query on every
  authenticated request; most consumers discard it) · residual `R-1` (the ratchet's conditional execution path)
- **Related** `ADR-002` (multi-tenancy — this ADR makes an unscoped academic-year read *inexpressible* rather than
  merely forbidden) · `ADR-001` (modular monolith — no new package) · `ADR-064 §D1a` (inventory derived by walk,
  never enumerated — the ratchet reuses it verbatim) · `ADR-067 §D6` (the one-way-ratchet house style) ·
  `GUARDRAILS.md` §2 (`packages/contracts` builds to CJS and must not be destabilised), §5

---

## Verdict

**CONCERNS — proceeded, under the rulings below.** No schema change, no migration, no new dependency, no new HTTP
style, no new package. Two rulings are genuinely new architecture and are why this ADR is mandatory: a
**framework-free structural port hosted in `packages/contracts`** (§D1) and a **deliberately duplicated per-app
adapter** (§D2). One ruling changes observable behaviour in a state that does not exist on today's data (§D4), and
one deliberately declines to change behaviour that a reader might expect it to (§D5).

---

## Context — measured, not derived from source

Taken 2026-08-25 against the running local stack (`docker exec pilotage_postgres psql -U pilotage -d pilotage`).
`academic_year` holds **4 rows across 2 tenants**:

| tenant | school | name | start | end | status |
|---|---|---|---|---|---|
| `58d4ca12…` | `4e08405b…` | `2025-2026` | 2025-09-01 | 2026-07-05 | **active** |
| `53fe06f3…` | `a5b56876…` | `2021–2022` | 2021-09-01 | 2022-07-05 | closed |
| `53fe06f3…` | `a5b56876…` | `2022–2023` | 2022-09-01 | 2023-07-05 | closed |
| `53fe06f3…` | `a5b56876…` | `2023–2024` | 2023-09-01 | 2024-07-05 | **active** |

Reference date 2026-08-25. **Both** tenants' active year has ended — one by ~7 weeks, one by more than two years —
and no code path noticed. The only uniqueness on the model is `@@unique([schoolId, name])`; nothing constrains
`status`, nothing constrains date containment.

Against that data, the year was resolved **nine times by hand in seven files**, disagreeing on four axes:

| axis | divergence found |
|---|---|
| **tenant scope** | `school-structure/school-context.service.ts:32` filtered by `schoolId` **only** — no `tenantId`. The other eight were tenant-keyed |
| **determinism** | four sites called `findFirst` with **no `orderBy`** at all; four ordered by `startDate desc`, which is *not* a total order (§D4) |
| **absence** | three different treatments of "no active year": most-recent-of-any-status, empty result, `null` |
| **multiplicity** | one site (`subjects.controller.ts:381`) assumed *many* active years; eight assumed *one* |

`SchoolContextService` is injected into ~20 controllers and services across **all four portals**, so its
tenant-less read executed on essentially every authenticated request. That is what set this slice's evidence tier
and its risk tag — and it is also why §D6 states the exposure honestly rather than overclaiming a leak.

---

## §D1 — The resolver lives in `packages/contracts`, and takes a STRUCTURAL PORT rather than a Prisma client

**Ruling.** The canonical module is `packages/contracts/src/academic-year/`, re-exported from
`packages/contracts/src/index.ts` (one line). It imports **neither** `@prisma/client` **nor** `@nestjs/*`. It
consumes exactly one capability, declared as a structural interface:

```ts
export interface AcademicYearReader {
  findMany(args: { where: AcademicYearWhere; orderBy: AcademicYearOrderBy }): Promise<AcademicYearRecord[]>;
}
```

**The constraint that forced a workspace package.** `apps/worker/tsconfig.json` sets `"rootDir": "./src"`. A worker
file cannot import from `apps/api/**` without TS6059, and three of the converted sites are in the worker. Hosting
the resolver under `apps/api/src/shared/` was therefore not available — it would have meant either duplicating the
*rule* (the thing this slice exists to stop duplicating) or leaving the worker unconverted, which would leave the
§D6 ratchet with violators it could only silence by an allowlist.

**Rejected: a new `packages/academic-year` package**, mirroring `@pilotage/imports-core`. This is the obvious
answer and it is the expensive one. `infra/docker/Dockerfile.api` and `infra/docker/Dockerfile.worker` each list
every workspace package **by name, twice** — a `COPY packages/<x>/package.json` line and a
`RUN pnpm --filter <x> build` line. This repository has already been broken in production by exactly that class of
omission (the "imports-core Dockerfile" gotcha). It would additionally have needed two `package.json` edits, a
lockfile change, an eslint config, and **two `moduleNameMapper` entries**. Six plumbing edits on the production
deploy path, for one slice — and **agents never build** (GUARDRAILS §4), so no agent in this run could have
verified any of them. Rejected on deploy risk, not on taste.

**Chosen: `@pilotage/contracts`.** It is already a dependency of `apps/api`, `apps/worker` **and** `apps/web`;
already built in all three Dockerfiles; and already mapped to **source** in both jest configs
(`'^@pilotage/contracts$'` and `'^@pilotage/contracts/(.*)$'`), which matters because `scripts/test-ratchet.js`
spawns jest with `cwd: appDir` so turbo's `test → dependsOn ["^build"]` never runs. Its charter was never "Zod DTOs
only" — `src/` already holds `observability/`, `release/` and `security/`. `academic-year/` is a **new module in an
existing home, not a new home**.

**The constraint that choice creates.** `@pilotage/contracts` gains **no** new dependency, and in particular must
never import `@prisma/client`: `apps/web` consumes this package, and a Prisma import would land in the browser
bundle. The structural port is what makes that possible, and it is independently the right shape — framework-free,
injectable, trivially testable with an in-memory reader.

**What was NOT relaxed.** GUARDRAILS §2 pins `packages/contracts` to a CJS build (`main → dist/index.js`). That is
untouched. `packages/contracts/package.json` is untouched.

---

## §D2 — The Prisma adapter is DUPLICATED per app, on purpose

**Ruling.** Two three-line adapters exist and are expected to stay:

- `apps/api/src/shared/academic-year/prisma-academic-year-reader.ts`
- `apps/worker/src/shared/academic-year/prisma-academic-year-reader.ts`

Both are:

```ts
export function prismaAcademicYearReader(
  prisma: Pick<PrismaClient, 'academicYear'>,
): AcademicYearReader {
  return { findMany: (args) => prisma.academicYear.findMany(args) };
}
```

**Why duplication is the right answer here.** The same `rootDir: ./src` constraint of §D1 forbids the worker
importing the API's copy, and `@pilotage/contracts` cannot host either copy because it must not depend on
`@prisma/client`. The alternative — a third workspace package whose only purpose is to hold six lines — reopens
every Dockerfile cost §D1 rejected.

**What is duplicated carries no decision.** The `where`, the total order, the absence policy and the staleness
computation live in the resolver, in **one** copy. What is duplicated is a delegate handoff with no branch in it.
Duplicating a *decision* would be the drift this slice removes; duplicating a *wire* is not.

**The client is narrowed structurally** (`Pick<PrismaClient, 'academicYear'>`), following the precedent already set
by `packages/imports-core/src/caches.ts:11`. That is what lets `PrismaService`, a `Prisma.TransactionClient`, or a
plain client satisfy the port without the resolver knowing which connection it runs on.

**Reviewer instruction, so this is not "fixed" later by mistake:** a future refactor that unifies the two adapters
by moving one under a shared path must first change `apps/worker/tsconfig.json`'s `rootDir`, and that is a
different, larger decision requiring its own ADR.

---

## §D3 — `tenantId` is REQUIRED by the type, not by convention

**Ruling.** `tenantId: string` is a required field of `ResolveActiveAcademicYearOptions`, of
`ListActiveAcademicYearsOptions` **and** of the internal `AcademicYearWhere`. Every `where` the module builds —
including the fallback query of §D4 — carries it. There is no code path in the module that can issue an
academic-year query without a tenant.

This is the property that closes `school-context.service.ts:32`. The point is the **modality**: an unscoped
academic-year read is now *unexpressible*, not merely *forbidden*. ADR-002 states the rule; this type enforces it.

A runtime guard (`requireTenantId`) additionally rejects the empty string, which the type cannot catch when a value
arrives through an `as string` or unvalidated JSON. With no database invariant available in this slice (§D7), that
guard is the last barrier before a cross-tenant read.

---

## §D4 — The order is `[{ startDate: 'desc' }, { id: 'desc' }]`, because `startDate desc` alone is NOT a total order

**Ruling.** Every query the module issues — the primary `status: 'active'` query, the `mostRecentOfAnyStatus`
fallback, and `listActiveAcademicYears` — uses the same two-key order.

**Why the tie-break is load-bearing.** `orderBy: { startDate: 'desc' }` is a *partial* order. Two active years
sharing a `startDate` leave Postgres free to return either row, from one call to the next, without anything being
"broken": the plan decides, not the data. Two portals reading the same tenant can then legitimately disagree —
which is precisely the mechanism behind `PF-04`. The only uniqueness the schema offers is
`@@unique([schoolId, name])`, which says nothing about `startDate`. The tie-break is therefore taken on `id`, the
primary key: unique by construction, so the pair is a **total** order and the answer becomes a function of the
data.

**The order applies to the fallback too.** A fallback left unordered would fix determinism on only half the path.

**Behaviour-change disclosure.** Four sites (`analytics.service.ts` ×3, `school-performance-drilldown.service.ts`)
previously had **no `orderBy` at all**. On the measured data every school holds at most one active year, so the
observable result is **identical today**. The change is a strict improvement in a state that does not currently
exist — and `activeCount` on every resolution is what will make that state visible if it ever does.

---

## §D5 — Absence is the CALLER's decision — three meanings in the tree, TWO policies in the resolver

**Ruling.** `onAbsent` is a **required** option with **no default**:

```ts
export type AcademicYearAbsencePolicy = 'nullWhenNoActiveYear' | 'mostRecentOfAnyStatus';
```

The resolver never guesses. A default would silently hand one call site another call site's semantics — the exact
class of divergence being removed.

**The honest count.** The tree shows *three* treatments of absence: most-recent-of-any-status, empty result, and
`null`. Two of those — "empty result" and "`null`" — are the **same resolver behaviour** (return `null`) and differ
only in what the caller does with it afterwards. Modelling a third enum member identical in effect to another would
be ceremony pretending to be rigour. So: **three meanings in the callers, two policies in the resolver**, and each
caller keeps its own translation branch untouched.

`mostRecentOfAnyStatus` has exactly **one** caller — `analytics.service.ts:2394` (the admin dashboard). That is
recorded here so a future reader does not "harmonise" it away: it is the site whose fallback pair
(two `findFirst` calls, the first unordered and the second ordered by `startDate desc` alone) motivated the policy.

**Query-count property, not an implementation detail.** One query on the nominal path; two at most, and only under
`mostRecentOfAnyStatus` when no active year exists. Callers that hoisted the resolution out of a loop
(`alerts.service.ts`, `alerts-evaluator.service.ts`) keep exactly their previous cost. **No N+1 is introduced
anywhere.**

---

## §D6 — Staleness is REPORTED on every resolution, and SELECTED ON nowhere

**Ruling.** Every `ResolvedAcademicYear` carries `isStale`, `staleByDays`, `containsReferenceDate` and
`activeCount`. **Nothing in the module, and no call site, prefers a year because it contains the reference date.**

**Why reporting is not enough on its own, and why selecting would be wrong anyway.** A resolver that silently
returns a two-year-old year has not closed `PF-15`; hence the signals. But on the *measured* data (Context, above)
**no** year contains 2026-08-25 for **either** tenant. A resolver preferring "the year containing today" would
therefore return `null` everywhere and blank all four portals. Selecting on containment is a follow-up that needs
`PF-328`'s invariant and a data decision **first**.

**What would have to be true to select on it.** (1) `PF-328` lands: at most one `active` year per school, enforced
in the database, via expand/contract; (2) the two existing violating rows are resolved by a data decision — either
their `status` or their dates are corrected; (3) a defined behaviour exists for the gap between two academic years
(the summer), because containment is false for every row during it. Until all three hold, containment is a
**diagnostic**, not a selector.

**Who consumes `isStale` in this slice.** Two low-frequency sites only — `alerts.service.ts` and
`alerts-evaluator.service.ts` — each emitting **one** structured `logger.warn` naming `tenantId`, `schoolId`,
`academicYearId`, `endDate`, `referenceDate`, `staleByDays` and `activeCount`. Deliberately **not**
`SchoolContextService`: it runs on essentially every authenticated request, and a per-request warning is log spam,
not observability. **No endpoint response shape changes anywhere.**

**The clock is injected.** `referenceDate` is required; the module contains no `new Date(` and no `Date.now(`.
A default would be a hidden clock, and the staleness branch would be untestable.

**`containsReferenceDate` is inclusive at both bounds**, matching its sibling predicate
`apps/api/src/modules/calendar/calendar-seed.service.ts:86` (`resolveAcademicYearId`), whose spec pins
`2026-07-05 → ay-a` and `2026-07-06 → null`. Writing exclusive bounds here would have shipped a tenth semantics
while retiring nine. Their eventual convergence is recorded as `PF-329`.

---

## §D7 — What was deliberately NOT done

- **No migration, no constraint, no index.** The two natural invariants — *at most one `active` year per school*
  and *the active year contains today* — **both fail on existing data**. Imposing either needs an expand/contract
  plan and a decision about what "active" means for the two violating rows. Recorded as `PF-328`, deferred.
  `G-MIGRATION` is untriggered, so `scripts/restore-drill-baseline.json` correctly gains no entry (PF-80's
  obligation attaches to migrations).
- **The relational family is out of scope, and the ratchet is written so it stays visible.** Nine production sites
  constrain the year by a **join** — `where: { …, academicYear: { status: 'active' } }` on `enrollment` /
  `classSection` / `teachingAssignment`. They do not *resolve* a year; they filter rows *belonging to* an active
  year, and they tolerate multiplicity. Collapsing them onto a single-year resolver would **change their results**
  the moment a school carries two active years. Converting them is a separate slice with its own semantic
  decision.
- **The parent dashboard's enrolment-derived year is untouched** (`PF-329`). It is a tenth mechanism on a different
  axis. Naming it is what keeps `PF-04`'s eventual closure honest — and it is why
  `analytics.service.ts:1549` (`previousYearComparison`) still calls `academicYear.findFirst` directly. That call
  filters on `endDate`, not on `status`, so it is outside this ADR's rule and outside the ratchet's rule; its unit
  harness legitimately mocks **both** delegates.
- **`PF-327` and `PF-330` are recorded, not fixed** (RECORD, DON'T FIX).

---

## §D8 — What the ratchet proves, and what it does NOT

`apps/api/src/shared/quality/academic-year-resolution-gate.spec.ts` walks `apps/api/src`, `apps/worker/src` and
every `packages/<pkg>/src`, and fails on any **read** operation on the `academicYear` model whose `where`
constrains the status to `active` outside the module that **declares** `resolveActiveAcademicYear`.

Properties it holds, each learned the hard way in this repository:

- the inventory is **derived by walking**, never a hand-written twin list (paired hand-maintained lists have
  already produced a silent drift and a four-portal 503 here);
- the resolver's home is recognised **by construction** — the file that declares the function — so there is **no
  allowlist**; `MANUAL_ALLOWLIST` exists, is named, ships **empty**, and an assertion proves it empty;
- **no** environment escape hatch: no `SKIP_*`, no `ALLOW_*`, no `NODE_ENV` branch (DNC-10);
- anti-vacuity floors **per root**, not global — a global floor would stay satisfied by `apps/api` alone while
  `packages/` silently dropped out of the walk;
- **both** controls: violating fixtures that must be flagged, and legitimate ones — including the real state
  transition and the real adapters — that must pass. An always-red matcher satisfies every red case and proves
  nothing;
- fixtures carry **no real model name** (PF-295): the model name is a classifier **parameter**, and the fixtures
  use `fixtureYear`, which exists nowhere in the product.

**What it does not prove.** It proves a **shape** — no read filters `status: 'active'` outside the resolver. It
does **not** prove the resolver's order is the *right* order, nor that Postgres honours it, nor that any endpoint
returns the same number it did yesterday. That is carried elsewhere, and executed: the unit suite at
`apps/api/src/shared/academic-year/resolve-academic-year.spec.ts` and the SQL probe against the live stack.

**Known residual `R-1`, the gate's own execution path.** `scripts/ci-gate.sh` runs the full API suite only when the
diff touches `GATE_MACHINERY` (`^(scripts/|\.github/|infra/|apps/api/src/shared/quality/)`). This file is inside
that prefix, so the ratchet runs on **this** PR. A future PR touching only `packages/**` or `apps/worker/**` would
take the `--skip src/shared/quality/` branch and would not execute it. Real residual, recorded (`PF-330` family,
tracked as `R-1`) — not a hole this file closes alone.

---

## Consequences

**Positive.**

- One resolution rule, in one place, reachable from `apps/api`, `apps/worker` and (harmlessly) `apps/web`.
- An academic-year query without a tenant is no longer expressible in the canonical path.
- The answer is a function of the data, not of the query plan.
- `PF-15`'s actual condition is now *visible* at runtime instead of silently absorbed.
- The ratchet makes regression to a tenth hand-rolled resolution a red build rather than a review miss.

**Negative / accepted.**

- Two three-line adapters instead of one (§D2), for as long as `rootDir: ./src` stands.
- `packages/contracts` grows a non-DTO module, continuing a precedent (`observability/`, `release/`, `security/`)
  that a future reader may find surprising; §D1 is why.
- `apps/web` inherits the module through the shared package. It is pure functions and types, no new dependency,
  tree-shakeable, and no web file imports it — but the package boundary is shared, and that is stated rather than
  waved away.
- `PF-15` closes on **one axis of two**. If the ledger records it `closed`, it must record `PF-328` as the named
  residual in the same row. It must not read `closed` while a tenant's active year is two years old.
