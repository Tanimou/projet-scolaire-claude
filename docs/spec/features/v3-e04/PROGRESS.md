# V3-E04 — Audit trail and governance surfaces

**Layer** L0 · **Size** M · **Closes** `PF-14`, `PF-31`, `PF-32` · **Gate** `G-AUDIT` (primary)
**Depends on** `V3-E02` (`code-complete` 2026-08-08 — dependency satisfied) · **Blocks** `V3-E03`, `V3-E11`
**Risks** `R-10` (accepted), `A-01` (permanent) · **Referenced, not fixed:** `PF-96`

**Status (2026-08-08, after `S-E04-3`)** — **`in-progress`. 3 of 8 slices shipped.**

The `epic-spec` run wrote `spec.md`, `plan.md`, `data-model.md`, `contracts/openapi.yaml`, `ux.md`, `tasks.md`,
`quickstart.md` and this file, and touched no code. **`S-E04-1` then shipped** the shared provenance home, the eight
`actorRole` literals, the nine `portal` write literals, the two anonymous inline copies, `ADR-036` and two new
specs — evidence in § `S-E04-1` below. **`S-E04-2` shipped** the authenticated render (verdict: **HTTP 500**,
`PF-14` reproduces) and its fix, plus the `/admin/reports` retirement. **`S-E04-3` shipped** `trust proxy`, the
client-hints seam, the `apps/web` producer on **both** server seams, and the honest-blank UI — evidence in
§ `S-E04-3` below. `S-E04-4`…`S-E04-8` remain **open**, and every gate they own is still described by **how it will
be evidenced**, never as met.

> ### ▶ Next slice → **`S-E04-4`** — one canonical audit vocabulary, declared once, in `packages/contracts`
>
> `[contracts][web][api][seed]` · size **M** · `G-MIGRATION` **does not trigger — deliberately** · ships **`ADR-037`**
> · **blockedBy** `S-E04-2` ✅.
>
> Start at `tasks.md` § `S-E04-4`. Two things `S-E04-3` handed it, neither of which it may silently re-decide:
>
> 1. **`audit-labels.ts` is now bigger, and it is still the wrong home.** `S-E04-2` created it (as the *neutral*
>    module `PF-14` cost a 500 to establish) and `S-E04-3` added `PROVENANCE_UNAVAILABLE`, `hasNoProvenance` and
>    `humanizeUserAgent` to it. That file's own header says it is an intermediate step inside the admin portal, not
>    the canonical vocabulary — `S-E04-4` retires it into `packages/contracts`. Adding a *second* canonical home
>    beside it would be the exact defect this epic is about.
> 2. **There are two actor vocabularies in one column, and one of them is not a realm role.** `PF-122`
>    (`child-claims.service.ts`) still writes `actorRole: 'admin'`. Declare the enum against what is **measured in
>    the database**, not against what `ROLE_PRECEDENCE` can produce, or the enum is wrong on live rows the day it
>    ships.
>
> Read § *The read side of `portal` was never inventoried* (below, raised by `S-E04-1`, untouched by `S-E04-2` and
> `S-E04-3`) before touching the facet query: `analytics.service.ts:3358-3364` builds the portal facet
> `where: { portal: { not: null } }`, so a `null`-portal row — which is what `PF-123` writes — is reachable by **no
> offered filter value at all**. That is the half of `PF-32` a label map cannot fix.
>
> **Do not start with `S-E04-8`.** The chain is last by product ruling, not by convenience — see the ordering note
> below. Run `quickstart.md` §5 before writing code: the measurement table is meant to be **falsified**, not trusted.
>
> **`S-E04-6` is also unblocked now** (its `blockedBy` was `S-E04-1` + `S-E04-3`, both shipped). It is the
> transactionality slice, and `ADR-035` is its ADR — re-check the number against `docs/adr/` immediately before
> creating the file (`PF-110`'s precedence rule).

---

## Why this epic was selected

`docs/spec/features/v3-e04/` did not exist, so the mode was forced to `epic-spec` by the roadmap's own rule.
`V3-E02` is `code-complete`, so the dependency is satisfied. Roadmap candidate 0 (`S-E02-20`) is **struck through** —
`PF-116`/`PF-117`/`PF-118` were all closed by `S-E02-19` itself at Step 5 — leaving `V3-E04` the top live candidate on
the roadmap's own sequencing (§3: *"`V3-E04` depends on `V3-E02` … and unlocks evidence for everything after it"*).
`S-E06-6` made the case concrete: it wrote the **first** `AuditLog.ipAddress` in the codebase and derived `actorRole`
from the JWT on **one** handler, while the rest of the codebase did neither, and it handed this epic the `trust proxy`
decision verbatim (`docs/spec/features/v3-e06/PROGRESS.md:370-371`).

---

## What Step 2 measured — and where it contradicts the epic contract

All measurements taken 2026-08-08 against the **running local Docker stack** and the source tree. They are newer than
the audits (`A2 §5.6`, `App. B.5`, `App. C.2`) and **take precedence** over them.

**The register of record is [`data-model.md` §0](./data-model.md#0-mesures--létat-réel-le-2026-08-08)** — it carries the
`Source` column for every row. The ids below are **its** ids. They were renumbered in the land pass: this table and
`data-model.md` briefly carried **two different registers under one `M-n` namespace** (`M-7` meant "sites outside
`apps/api`" in one file and "sites hard-coding `portal: 'admin'`" in the other; `M-24` meant RLS in one and "third
vocabulary consumer" in the other). Every measurement was accurate; the *ids* collided — the same shape as `PF-110`,
which this kit denounces for ADR numbers. Recorded and closed as **`PF-120`**.

| # | Measurement | Value |
|---|---|---|
| M-1 | Rows in `audit_log` | **54** |
| M-2 | Rows carrying `hash` / `prev_hash` | **0 / 0** — the chain has never existed |
| M-3 | Rows carrying `ip_address` / `user_agent` | **0 / 0** |
| M-4 | `actor_role` distribution | `school_admin` × **53**, `teacher` × **1** |
| M-5 + M-7 | Audit write sites | **28** in `apps/api/src` (16 files) + **2** in `packages/imports-core/src/engine.ts` = **30** |
| M-6 | Sites hard-coding `actorRole: 'school_admin'` | **8**, not "all" — the contract's blanket claim is wrong by 20 |
| M-10 | Sites hard-coding `portal: 'admin'` | **9** |
| M-32 | Sites writing inside a `$transaction` (`tx.auditLog.create`) | **6 of 28** in `apps/api`; the other **22** write outside one |
| M-9 | `roles.controller.ts` | `create()` writes the role then a **separate** audit row, no `$transaction`; `update()` opens one and writes the audit row **outside** it |
| M-33 | Families writing **no** audit row at all | role grant/revoke (`identity/users.service.ts:57`, `:74`), `modules/schools/` (**0** refs), `modules/enrollments/` (**0** refs) |
| M-30 | Finance module in `apps/api/src/modules` | **does not exist** — `AC-2`'s finance clause is vacuous today |
| M-11 | Distinct `resourceType` codes written | **20** |
| M-12…M-16 | `RESOURCE_TYPE_LABELS` keys | **13** — of which **7** are written by nobody; intersection with M-11 is **6**; **14** written codes have no label; intersection with what is **in the database** is **0** |
| M-16 / M-17 | `resource_type` / `action` in the 54 live rows | 8 / 5 **French display strings** in structural columns |
| M-18 | `criticalChanges` KPI | measured **9**, reached only via the French `Suppression`; `delete` / `Révision` / `revise` match **nothing** |
| M-19 / M-20 | `sensitiveExports` / `adminLogins` | **7** / **0** — and `adminLogins` is **structurally always 0**: no call site writes a login row |
| M-21 | `to` filter | `lte: new Date(to)` — the selected day is dropped |
| M-22 | KPI scope | all four computed on a `where` that ignores every user filter |
| M-23 | `trust proxy` in `apps/api/src` + `infra/` | **0 occurrences**; `main.ts:37` is a bare `NestFactory.create` → `req.ip` is the socket peer |
| M-24 | RLS in the whole repository | **0 occurrences** of `ENABLE ROW LEVEL SECURITY` / `CREATE POLICY`, `0_baseline` included — although `ADR-002` declares it |
| M-26 | `Tenant.timezone` | **does not exist**; only `School.timezone` (default `Europe/Paris`) |
| M-29 | `/admin/reports` | no route directory; linked from `sidebar-items.ts:175`; already in `link-integrity-baseline.json` |
| M-34 | `/admin/analytics` | **exists**, titled « Analytique des performances », and has **no sidebar entry at all** — orphaned under the same `BarChart3` icon the dead entry carries. Registered as **`PF-119`** |
| M-31 | Third vocabulary consumer | `apps/worker/.../exports/generators/audit-csv.generator.ts:16` exports `action` **raw** |
| M-27 / M-28 | `AuditLog` → `Tenant` | no foreign key (`PF-96`); one index only, `(tenant_id, created_at)` |

**Independently re-verified by the routine in the land pass (`R-30` — agent numbers are not taken on trust):** M-1…M-4
(live `psql`), M-6, M-7 (`packages/imports-core/src/engine.ts:197`/`:288`, both `tx.auditLog.create`), M-10 (**9**
production sites, the `analytics.service.ts:3324` occurrence correctly excluded as a *query filter*, not a write),
M-24, M-30, M-32 (6 + 22 = 28, reconciles with M-5), M-33 and M-34.

**The one thing this run could NOT measure, and it matters most.**
**Does `/admin/audit` still crash?** `PF-14`'s server/client boundary crash **did not reproduce statically**, and the
live probe returned `307 → /admin/login`, so **the authenticated render was never observed**. This spec therefore
treats it as an **open measurement in both directions** and names the way to settle it (an authenticated render with
the demo admin). It is `S-E04-2`'s headline acceptance criterion. **Nothing in this kit claims the page renders, and
nothing claims it crashes.**

**Where the contract is materially wider than written.** `PF-32` is specced as *"the end-date filter and the three
structurally wrong KPIs"*. It measures as **four** defects plus a **vocabulary split** reaching into
`packages/contracts`, the seed, the 54 live rows, the label map and the worker's CSV export — `G-TRUTH` and
`G-PORTAL` work, not a filter fix. A slice that implements the contract's wording alone would under-scope this epic by
roughly a third. `tasks.md` carries the vocabulary as its **own** slice with its own migration verdict.

---

## Slice backlog (`tasks.md` is the contract; 1 of 8 has shipped)

| Story | Title | State | blockedBy | `G-MIGRATION` | ADR |
|---|---|---|---|---|---|
| **`S-E04-1`** | Shared audit provenance: one home, one decision, one real actor role | **`shipped`** 2026-08-08 | — | no | **`ADR-036`** ✅ |
| **`S-E04-2`** | `/admin/audit` measured under authentication; the dead admin reports link is retired | **`shipped`** 2026-08-08 | — | no | — |
| **`S-E04-3`** | The operator's real IP and User-Agent reach the API — or the field stays blank | **`shipped`** 2026-08-08 | `S-E04-1` ✅ | no | **`ADR-036`** *(amended: D9/D10)* |
| `S-E04-4` | One canonical audit vocabulary, declared once, in `packages/contracts` | `todo` ◀ **next** | `S-E04-2` ✅ | no | **`ADR-037`** |
| `S-E04-5` | The KPIs share the table's scope, and the `to` filter includes its own day | `todo` | `S-E04-4` | **YES** (`Tenant.timezone`) | — |
| `S-E04-6` | Five privileged families write their audit row **in the same transaction** | `todo` *(unblocked)* | `S-E04-1` ✅, `S-E04-3` ✅ | no | **`ADR-035`** |
| `S-E04-7` | The remaining call sites move onto the seam, and a blocking gate keeps them there | `todo` | `S-E04-6` | no | — |
| `S-E04-8` | The hash chain from a declared genesis, its verification, and the documented gap | `todo` | `S-E04-3`, `S-E04-6`, `S-E04-7` | **YES** | `ADR-035` *(amendment)* |

**8 slices · 5 `todo` · 0 in progress · 3 shipped.** State vocabulary: `todo` → `in-progress` → `shipped`
(or `blocked`, with the blocking decision id). A slice moves to `shipped` only when its own acceptance criteria are
evidenced in its PR — never because the code merged.

**The ordering is a product ruling, not a convenience.** The decision work (`ADR-036`) is first and the chain is last.
A chain computed over an `actorRole` that is a literal, an `ipAddress` that is the web container's and a `userAgent`
that is null on every UI-driven write would be a **cryptographically verifiable record of falsehoods** — strictly
worse than the honest blank the epic's own principle demands (*« une provenance absente, jamais une provenance
fausse »*), because a verified chain is believed. An autonomous run optimising for a satisfying deliverable would
build the chain early. It must not.

---

## `S-E04-1` — shipped 2026-08-08 · shared audit provenance

**Branch** `ci/2026-08-08-v3-e04-s1-audit-provenance` · **Risk** P1 · **Gates** `G-AUDIT` *(partial)*, `G-AUTHZ`,
`G-DNC` · **`G-MIGRATION` did not trigger** · **Ships `ADR-036`**

### What landed

| # | Change | Where |
|---|---|---|
| T-0 | New shared home, created **first** | `apps/api/src/shared/audit/provenance.ts` + `index.ts` (barrel, declares nothing) |
| T-0 | Originals **deleted**, no shim | `modules/alerts/alert-provenance.ts` and its spec **do not exist**; the three sanitiser declarations are gone from `modules/calendar/calendar-seed.service.ts` (the file and `CalendarSeedService` stay) |
| T-0 | 11 importers repointed | `alerts.controller`, `meeting-requests.controller`, `calendar.controller`, `messaging.controller`, `parent-exports.controller`, `remediation.controller`, `teacher-exports.controller`, `calendar-seed-holidays.spec`, plus the moved spec — **0** references to an `alert-provenance` path remain in `apps/api/src` |
| FR2 | `deriveAuditProvenance(jwt, _req?: unknown)` | canonical; `deriveAlertActorProvenance` kept as a **one-line delegation** and declares nothing of its own; `ROLE_PRECEDENCE` / `ROLE_PORTAL` stay module-private; the never-throws `realmRoles[0] ?? null` fallback is unchanged |
| FR3 | **8** `actorRole` literals + **8** of the `portal` literals replaced with the derived value | `invite.controller:155`, `roles.controller:135/:185/:219`, `imports.service:440` (via the widened `actor` seam), `integrations.service:639` (same), `academic-years.controller:266` (widened private `audit()` helper, one edit covering three audited actions), `subjects.controller:227` |
| FR4 | the **9th** `portal` literal | `snapshot-ops.service:196` — `enqueueRebuild` now takes `portal: string \| null` and `analytics.controller` threads the derived value down |
| FR5 | the second inline derivation + its portal ternary | `grades.controller` — collapsed onto `deriveAuditProvenance` |
| FR6 | deliberately **not** touched | `analytics.service.ts:3324` (a `where:` **query filter**, `S-E04-5`'s work) and `calendar.controller` (the only site capturing a real `@Ip()`/`@Headers('user-agent')` — repointed only, so this slice **reduced what no site records**) |
| FR7 | `ADR-036` **verified, not re-authored** | already existed on the branch (architect agent, same run); checked against §3's seven items — all seven present. Two **additions**: `D5` now records the shipped `(jwt, _req?: unknown)` signature so the ADR matches the code, and a new **`D8`** records the unrecognised-role fallback as a *kept* decision against the epic principle. Number **not** changed (`PF-110`) |
| FR8/FR9 | two new specs | `shared/quality/audit-provenance-gate.spec.ts` (G-1…G-7, **56** cases — 52 plus the four added by the gate-pass correction below: three recorded-fixture integrity cases and the walk-exclusion case) and `shared/audit/provenance-callsites.spec.ts` (T-1…T-10 + the AuthZ metadata block) |

### Executed, not asserted

`pnpm --filter @pilotage/api test -- --testPathPattern "shared/(audit|quality/audit-provenance-gate)"`
→ **3 suites passed, 115 tests passed** (`provenance.spec.ts`, `audit-provenance-gate.spec.ts`,
`provenance-callsites.spec.ts`). `ts-jest` compiles each suite, so the widened service signatures and every
controller constructor the callsites spec instantiates are type-checked by that run; the full `pnpm typecheck` is
the test-architect's gate, not this agent's.

### DNC-08 / AC-14 — the negative controls, with the observed output

Method: the four collapsed files were restored to their `HEAD` content (`git show HEAD:<path>`) — not hand-mutated,
so the control exercises the code that actually shipped before, which is the `R-30` discipline — and the same two
suites re-run. **8 gate cases and 6 controller cases went red; 101 stayed green.** Restored afterwards from a
byte-copy and the guard re-measured green.

```
Tests: 14 failed, 101 passed, 115 total      (HEAD content restored in 4 files)

FAIL src/shared/quality/audit-provenance-gate.spec.ts
  ● G-2 … declares no actorRole: 'school_admin' outside *.spec.ts
      Expected Array []  /  Received [ "apps/api/src/modules/identity/roles.controller.ts", … ]
  ● G-2 … the only surviving portal: 'admin' is a where: FILTER, and there is exactly one
      Expected length: 1  /  Received length: 5
        analytics.service.ts (where: …)  ← the legitimate one
        snapshot-ops.service.ts  "portal: 'admin',"
        roles.controller.ts      "portal: 'admin'," × 3
  ● G-3 … the only role-precedence ordering in the whole app is provenance.ts
      Received [ "apps/api/src/modules/analytics/analytics.controller.ts",
                 "apps/api/src/modules/grades/grades.controller.ts" ]
  ● G-3 … no file decides a portal inline
      Received [ "apps/api/src/modules/grades/grades.controller.ts" ]
  ● G-3 … AC-7 negative control — the SAME matchers FLAGGED all three pre-fix copies at HEAD
      Expected: false / Received: true      (the "…and all three are gone" half)
  ● G-AUDIT … roles.controller.ts still writes THREE audit rows
      Expected: 3 / Received: 0             (deriveAuditProvenance(jwt) occurrences)
  ● G-AUDIT … every edited handler file reads the derivation from the shared home
  ● G-AUDIT … snapshot-ops.service.ts takes portal as a threaded argument, not a literal

FAIL src/shared/audit/provenance-callsites.spec.ts
  ● T-1 / AC-3 — a super_admin writes actorRole super_admin, portal admin
      Received actorRole: "school_admin"    ← AC-3's exact defect, observed
  ● T-3 — a teacher writes actorRole teacher AND portal teacher
      Received actorRole: "school_admin", portal: "admin"
  ● T-4 — precedence beats array order            Received "school_admin"
  ● T-10 — unknown-only realm role, portal null   Received "school_admin"/"admin"
  ● T-8 — a teacher rebuild reaches enqueueRebuild with portal teacher
      Received { actorId, actorRole: "teacher", body, tenantId }   ← no portal key at all
  ● T-8b — an admin rebuild still records admin   Received: no portal key
```

**What the control also proved, and it is not flattering to the story.** `T-9a` (the owning teacher at
`grades.controller`) and the `school_admin` case **stayed green against `HEAD`** — because the ternary it replaces
produced the *same* value for every role that can actually reach the handler. The `grades` collapse is therefore
caught by **`G-3`**, not by a boundary assertion, and the two are complementary rather than redundant. An assertion
that was already green is not evidence (`AC-14`), so it is named here rather than counted.

### Corrected by this run's gate pass — two blockers the recorded evidence could not have caught

Both were found *after* the transcript above was written, by the typecheck gate and the verify panel. Named here
rather than quietly overwritten, because the block above is what the next run reads as settled evidence.

1. **`integrations.service.spec.ts` was the caller FR3's compile-error mechanism was supposed to catch — and it
   caught it.** The widened non-optional seam was propagated to `imports.service.spec.ts:30` but **not** to its
   sibling: `const ACTOR = { id: 'admin-up-1', tenantId: TENANT }` was still passed to `service.connect(ACTOR, …)`
   and `service.sync(id, ACTOR, …)` at **16 call sites**, each now missing `actorRole` and `portal` → 16 × `TS2345`,
   and `apps/api/tsconfig.json` includes `src/**/*`, so `pnpm typecheck` compiled it. **It is not a design failure —
   it is the design working**: FR3 chose non-optional fields precisely so a missed caller is a compile error rather
   than a silently wrong attribution, and this is that error firing on a caller the slice missed. The reason the
   "Executed, not asserted" run above could not see it is stated in its own command line: the pattern
   `shared/(audit|quality/audit-provenance-gate)` never loads this file. **A narrowed `--testPathPattern` cannot
   observe a widened seam's other callers** — that is the transferable lesson, not "add a file to a list".
   Fixed by widening the fixture to the shape `imports.service.spec.ts` already used. **`integrations.service.spec.ts`
   is therefore a touched file of this slice** (it is absent from the T-0/FR3 rows above).

2. **AC-7's negative control read the *moving* `HEAD`, so it was green only while the slice was uncommitted.**
   `atHead()` ran `git show HEAD:<path>`. The moment this work is committed — and permanently on `main` after the
   squash-merge — `HEAD` **is** the fixed tree, so (a) `atHead('…/modules/alerts/alert-provenance.ts')` targets a
   path this slice **deletes**: `git show` exits 128 and `execFileSync` **throws** inside the test, and (b) the two
   survivors return the *collapsed* sources, so the three `toBe(true)` assertions invert. The single assertion this
   slice presents as its proof of non-vacuity would have been **permanently RED on `main` from the first commit** —
   which is how a guard gets `.skip`-ed, taking the whole one-decision invariant with it. The transcript above
   contains the failure *without recognising it*: the line
   `● G-3 … AC-7 negative control … Expected: false / Received: true (the "…and all three are gone" half)` is
   exactly the working-tree-equals-`HEAD` case, i.e. the post-commit state.

   **Pinning a sha instead of `HEAD` does not fix it.** `.github/workflows/ci.yml` uses `actions/checkout@v4` with
   no `fetch-depth`, i.e. depth **1**, in the `test` job that runs `node scripts/test-ratchet.js api` — so
   `e218017` is unreachable there and a pinned `git show` would fail for a second, different reason.

   Fixed by **recording** the three pre-fix sources instead of resolving them through a ref:
   `apps/api/src/shared/audit/__fixtures__/pre-fix/{analytics.controller,grades.controller,alert-provenance}.ts.txt`,
   byte-for-byte `git show e218017:<path>`, with a `README.md` stating the provenance and the command. The property
   that mattered is kept — they are the **real** pre-fix bytes, not a string the author believed was there (`R-30`)
   — and the fragility is gone: no `git` binary, no `.git`, no history depth. Three mechanics make the arrangement
   hold rather than rot: the **sha256 of each file's LF-normalised bytes is pinned in the spec**, so editing a
   fixture to quiet a red matcher is itself a red test; the extension is **`.ts.txt`**, so `walk()` does not collect
   them and `tsc`/`ts-jest` do not compile them, asserted by a new case that the directory contributes **zero**
   entries to the walk; and `.gitattributes` pins them `eol=lf` so a Windows checkout cannot change every digest.

   **Re-measured on the fix** (both changed suites, unfiltered by pattern within them):
   `pnpm --filter @pilotage/api test -- --testPathPattern "(shared/quality/audit-provenance-gate|modules/integrations/integrations.service)"`
   → **2 suites passed, 74 tests passed**. And the control is still discriminating, driven through the real
   stripper and the real matchers: `declaresRolePrecedenceOrdering` is **true** on all three recorded fixtures and
   **false** on both files in the working tree; `declaresInlinePortalDecision` is **true** on the recorded
   `grades.controller` and **false** on the shipped one. `pnpm typecheck` → **13 successful, 13 total** (`api`,
   `web`, `worker` all real cache misses that executed); `git diff --check` → exit 0 (CRLF `core.autocrlf` notices
   only); `node scripts/production-artefact-check.js` → exit 0 (`__fixtures__` is already one of its excluded
   directories, and the recorded sources carry no dev artefact).

### The `snapshot-ops` ruling (FR4) — the brief's caveat is falsified, no `system` constant exists

The operator brief allowed a named `actorRole: 'system', portal: null` constant *if* `snapshot-ops.service.ts:196`
had no JWT in scope. Measured: `enqueueRebuild` has **exactly one caller repo-wide**,
`analytics.controller.ts` `snapshotRebuild`, an HTTP handler carrying `@CurrentJwt() jwt` and
`@RequiresPermission('schools.read')`. It already received `actorRole` as a **parameter**; only `portal` was a
literal. So `portal` is threaded from the same JWT read, **no `SYSTEM_AUDIT_PROVENANCE` was introduced**, and the
guard asserts its absence — an unused actor-less audit shape is precisely what a later author reaches for to bypass
the JWT. If a genuinely actor-less writer is ever found, that is the slice that earns the constant.

### Two measured corrections to this kit's own documents (`R-30`)

1. **The derivation existed four times, not once.** `tasks.md` § `S-E04-1` counted *literals* and did not measure
   *duplicate derivations*, which is what `AC-1` is stated over. Two **anonymous** inline copies existed
   (`analytics.controller`, `grades.controller`) and are in no file list of the intake. `AC-1` is unsatisfiable
   while they live — a name-based guard passes over both, which is `S-E06-5`'s recorded lesson arriving early — so
   they were collapsed in this slice and `AC-7` records that the guard flagged them **before** the collapse.
2. **The `parent → portal 'admin'` defect at `grades.controller` is LATENT, not live.** The story calls it a live
   defect. Measured: `flag()` is `@RequiresPermission('grades.write')` and then calls
   `assertCanWrite(assessment.teacherProfileId, …)`, which returns early only for `super_admin`/`school_admin` and
   otherwise requires the caller to **be** the owning teacher — so a `parent` cannot reach that write at all. The
   collapse removes a wrong branch nobody had executed. `AC-8` is therefore evidenced where a parent **genuinely**
   acts: `ParentExportsController.createBulletin` (`exports.execute.parent`, guardianship ABAC) is driven with a
   parent JWT and asserted to hand `actorRole: 'parent', portal: 'parent'` to the service. At `grades` the parent
   path is asserted in the **negative** — `ForbiddenException` **and** `auditLog.create` never called — never as a
   forbidden success path.

### `G-AUTHZ` — what is asserted, and what must not be read into it

`PermissionsGuard` never runs when a controller is instantiated directly, which every controller spec in this
repository does. So "drive `RolesController.create` with a `teacher` JWT and observe `teacher`/`teacher`" proves the
wiring and **must not** be read as "a teacher may create a role". The wall is asserted separately: the
`@RequiresPermission` metadata is read off each edited handler's prototype via `Reflect.getMetadata` and compared to
the code it carries today — `roles.write` ×3, `users.write`, `imports.execute`, `integrations.write` ×2,
`subjects.write`, `academic_years.write` ×3, `schools.read`, `grades.write`, `exports.execute.parent` — with a
positive control proving the metadata read is real (an undecorated function reports `undefined`). **No permission
was added, removed or widened; nothing was granted that a grantor lacks; `tenantId`/`actorId` still come from
`users.ensureUser(jwt)` and never from a route param or body.**

### DNC-10 — no off switch, structurally

`provenance.ts` contains no `process.env`, no `ConfigService`, no `NODE_ENV`, no flag read, no `req.ip`, no header
read and no reference to `_req` at all; its exported **function** list is asserted to be exactly the four public
names, so a `deriveAuditProvenanceUnsafe` cannot appear beside it unnoticed; `ROLE_PRECEDENCE`/`ROLE_PORTAL` are
asserted **not** exported. `REALM_ROLES` from `packages/contracts` is deliberately **not** imported (a set is not an
ordering) and the guard asserts that absence, so a future reorder of a display list cannot silently reorder audit
attribution.

### What `S-E04-1` did NOT do, and is not claimed

- **`ipAddress`/`userAgent` are still `null`** everywhere except `calendar.controller`. That is `ADR-036` D4
  executing, not a gap in the code — and `S-E04-3` owns making them real. `T-5` drives the function with an object
  carrying `ip: '203.0.113.7'` and a `user-agent` header and asserts both come back `null`; that test is what
  catches a premature `S-E04-3`.
- **Transactionality is untouched** (`S-E04-6`). `roles.controller` still writes its audit row outside a
  `$transaction`, exactly as before. `G-AUDIT` is claimed **partial** for this reason.
- **The authenticated `/admin/audit` render was NOT performed.** `tasks.md` § `S-E04-1` precondition 1 asks for it;
  it needs a running stack plus demo credentials, it is `S-E04-2`'s headline acceptance criterion, and the same
  contract says not to fix that page here. `PF-14` stays open **in both directions**.
- **`packages/imports-core` was not touched** — `engine.ts:201-202` and `:292-293` still write
  `actorRole: 'school_admin'` + `portal: 'admin'`. **Read plainly: after this slice, `import.apply` and
  `import.rollback` rows still say `school_admin`/`admin` whoever ran them.** There is no JWT anywhere on that call
  path (the worker drains a BullMQ job), so a correct provenance needs capture at *enqueue* and a payload field —
  real design work. Registered as **`PF-121`**, owner `S-E04-7`. The epic's "one derivation" claim is true of
  `apps/api/src`, **not** of the monorepo.
- **No schema, no migration, no endpoint, no permission, no env var, no flag, no CI stage.** `git diff --stat` shows
  no change under `prisma/`, `packages/`, `apps/web/`, `apps/worker/`, `infra/`, or to `apps/api/src/main.ts`
  (asserted by the guard for `main.ts`: it still contains no `trust proxy`).

### One residual raised by this slice, not fixed

`G-3`'s exclusion set is **two named files** — `shared/audit/provenance.ts` (the declaration) and the guard spec
itself, which must quote the shapes it forbids to keep its own positive controls honest. Excluding all `*.spec.ts`
instead would have opened the evasion route the pre-mortem names, so the narrow form is deliberate; but a second
declaration planted **inside the guard spec** would still be invisible. Bounded three ways today (both exclusions
are asserted to actually trip the matcher, `G3_EXCLUSIONS` is asserted to have length 2, and no production file may
import a `*.spec.ts`), and the honest statement is that the bound is structural rather than complete. `S-E04-7`
owns the `scripts/audit-write-check.js` ratchet where a walk root wider than `apps/api/src` belongs.

### Three residuals inside the walk root — `AC-1`'s wording narrowed before it landed in the ledger

The slice's headline `AC-1` read *"exactly one file in `apps/api/src` decides an actor role"*. **It is not true**, and
the new gate is structurally blind to the counter-examples. The escalation panel found them and this land pass
re-verified all three by reading the code rather than accepting the panel's word (`R-30`). None is a regression —
all three predate the slice — but the claim is narrowed **before** it reaches `bmad/roadmap.md`, because a ledger line
the next autonomous run reads at Step 1 is exactly the kind of stale truth that makes it skip real work.

| id | Site | Shape | Why every matcher passes over it |
|---|---|---|---|
| `PF-121` | `packages/imports-core/src/engine.ts:201-202`, `:292-293` | `actorRole: 'school_admin'` + `portal: 'admin'` literals | outside the walk root (`apps/api/src`); no JWT on the path |
| **`PF-122`** | `child-claims.service.ts:722-729`, driven by `:522` / `:609` | `actor: 'parent' \| 'admin' = 'parent'` → `actorRole: actor`, `portal: actor` | `HARDCODED_ACTOR_ROLE` is pinned to `school_admin`; `HARDCODED_PORTAL` requires a quote **immediately** after `portal:` (here it meets `actor`); the precedence matcher needs four role names in one bracket; the portal matcher needs a `?` ternary |
| **`PF-123`** | `assessments.controller.ts:290` | **neither key written** — both columns `null` | a gate that bans literals cannot see an **absence** |

`PF-122` is the sharpest of the three: it writes `actorRole: 'admin'`, **a value that is not a Keycloak realm role**
and that `ROLE_PRECEDENCE`/`ROLE_PORTAL` can never produce, on `guardianship.claim_approved` /
`claim_rejected`. So `S-E04-4` (one canonical vocabulary) will read **two incompatible actor vocabularies out of one
column**, and `/admin/audit`'s role facet already carries a fifth orphan token. The measurement error is upstream of
the code: `spec.md:22` and `data-model.md` `M-6` classify this file among *"the other 20 that already take `actorRole`
from arguments"* — taking it from a **call-site literal** is not deriving it from the JWT, which is the same
mis-measurement class as `S-E06-5`, one layer up from where this slice defended against it.

**What `S-E04-7` owes because of this:** a `G-2`-adjacent rule stated over the **column** rather than over three known
literals — *every `auditLog.create` payload under the walk root must reach `actorRole`/`portal` from a
`derive*Provenance` call in the same lexical scope* — with `PF-122` and `PF-123` as its positive controls. Widening
`HARDCODED_ACTOR_ROLE` from the single literal `'school_admin'` to *any string-literal `actorRole:` value* is the
minimum form that would have caught `PF-122`.

### The read side of `portal` was never inventoried — decide it in `S-E04-2` / `S-E04-5`

Raised by the security lens, and it is the one thing in this diff that could change what an auditor **sees**.
`portal` stopped being a constant in a field `/admin/audit` uses as an **exact-match query filter**. The derivation
reads the *realm* role, but `PermissionsGuard` does not: `effectivePermissions`
(`shared/auth/user-sync.service.ts:64-87`) **unions realm-role permissions with custom `UserRole`→`Role`→`Permission`
grants** (`ADR-015`). So a user whose realm roles are `['teacher']` — or only `['default-roles-…','offline_access']` —
can legitimately hold `roles.write` / `users.invite` / `structure.write` / `integrations.write`, pass every guard, and
now have their **admin-plane** writes recorded `portal: 'teacher'` or `portal: null` where they previously recorded
`'admin'`: `role.create|update|delete`, `user.invite`, `academic_year.*`, `coefficient.upsert`,
`import.conflict.resolve`, roster `connect|sync`, `analytics.snapshot_rebuild`.

That is more truthful provenance and **less reachable evidence**, because three consumers this diff did not touch
assume uniformity:

- `analytics.service.ts:3246` — `...(portal ? { portal } : {})`, exact match. An auditor filtering **Portail = admin**
  (a real `<Select>`, `apps/web/src/app/admin/audit/AuditPageFilters.tsx:120-122`) no longer sees those rows.
- `:3358-3364` — the facet list is built `where: { portal: { not: null } }`, so a `null`-portal row is reachable by
  **no offered filter value at all** — invisible to any filtered review, with no « sans portail » option.
- `:3324` — the `adminLogins` KPI hard-codes `portal: 'admin'` and will silently undercount. (It is `0` today by
  `M-19`, so nothing drifts *yet*: none of the 9 edited sites writes a `login` action.)

The sharpest case is that `role.create`/`role.update` **is** the privilege-granting surface, so the rows that would
evidence an escalation are exactly the rows now filed away from the admin-portal view. `actorId` stays truthful, which
only helps someone who already knows whom to suspect. **The provenance posture is deliberate** (`provenance.ts:101-112`
names this exact `ADR-015` case and defers `azp` to `S-E04-3` per `ADR-036` D6); what was nowhere in the diff, the ADR
or `tasks.md` is that `portal` is a **filter predicate and a KPI predicate**, not a displayed string. **Minimum owed:**
a `null`-portal facet (or `portal: null` folded into the admin view) so no audit row is unreachable by every filter
value, plus one test over `auditList({ portal: 'admin' })` asserting a custom-role admin-plane row is still reachable.
Owner `S-E04-2` (whose headline is measuring `/admin/audit` under authentication) or `S-E04-5`.

**Adjacent, pre-existing, deliberately not scoped here:** `Role` carries no `tenantId`, and
`modules/identity/roles.controller.ts` does `role.delete({ where: { id } })` and
`role.findFirst({ where: { slug, schoolId: null } })` with **no tenant predicate** — a cross-tenant role write
reachable by id, already flagged in-file as "Phase 2". `PF-11`-family; worth an id while `roles.controller` is fresh.

### Secondary observations recorded rather than fixed (all non-blocking)

1. **`AuditProvenance.ipAddress`/`userAgent` are dead surface with a footgun.** All 9 call sites destructure
   `{ actorRole, portal }`; nobody reads the two `null` fields. A future site writing
   `data: { ...deriveAuditProvenance(jwt) }` silently blanks a real captured value — and `calendar.controller` (the
   only site capturing `@Ip()`/`@Headers('user-agent')`) is protected today only because it happens to call the
   *other* function, plus one regex in `G-5`. `S-E04-3` should make the regression **unrepresentable**:
   `deriveAuditProvenance` returns role/portal only, and a separate `captureClientHints(req)` carries the hints.
2. **`deriveAlertActorProvenance` keeps a feature name in the shared home**, and is now the *majority* entry point
   (7 modules, 13 call sites, vs 9 for the canonical one). `G-6` pins both as required exports, so the rename now costs
   a gate edit. Owner `S-E04-7`, in the slice that widens the walk root, so the rename lands once.
3. **`G-3` includes `*.spec.ts` and flags any bracketed literal naming the four roles.** Deliberate and fail-closed,
   but a future `z.enum(['super_admin','school_admin','teacher','parent'])` or a per-role test table anywhere under
   `apps/api/src` goes red with a message about audit provenance. The escape route (drive `deriveAuditProvenance` once
   per role) belongs in a comment where an author will actually hit it.
4. **`shared/audit/index.ts` is dead surface.** All 18 importers use `'../../shared/audit/provenance'` directly; none
   uses the barrel, and no sibling `shared/*` area has one. Its only consumer is the guard case asserting it declares
   nothing. Either delete it or make it the single public path — two live paths to one symbol is drift waiting for the
   next author.
5. **Commit hygiene hazard, not a design issue.** `git check-ignore` matches **nothing** in this checkout's untracked
   set: `.agent/`, `.agents/`, `.claude/`, `_bmad/`, `.playwright-cli/`, `antigravity_rapport_excellence.pdf`,
   `daily improvment V2.txt`, `cleanup-worktrees.sh`, `scripts/generate_improvement_proposal*.js`. A `git add -A` in a
   land pass commits a PDF and two scratch scripts, against `project-context.md` §2. **Stage explicitly.**

---

## `S-E04-2` — shipped 2026-08-08 · the render was performed, and it crashed

### The headline verdict: `PF-14` **reproduces**. The page had never rendered for an authenticated admin.

The measurement the kit asked for three times was finally taken. Logged in to the **local** stack
(`http://localhost:3000`) as `mme.dupont@voltaire.fr` (`school_admin`) and loaded `/admin/audit`.

**Verdict: HTTP 500.** The page fell through to `/admin/error.tsx` — « Une erreur est survenue »,
`Référence : 2236692779`.

**Browser console, captured verbatim** (`quickstart.md` §3 asked for it precisely so a hydration warning could not be
mistaken for a render failure — it is neither; this is a hard server-side 500):

```
[error] Failed to load resource: the server responded with a status of 500 (Internal Server Error)
[error] {digest: 2236692779, stack: Error: An error occurred in the Server Components render. …}
[error] [portal-error] {digest: 2236692779, …}
```

**Server log, same digest — the actual cause, which no static read could have named with certainty:**

```
⨯ Error: Attempted to call humanizeResourceType() from the server but humanizeResourceType is on the
  client. It's not possible to invoke a client function from the server, it can only be rendered as a
  Component or passed to props of a Client Component.
    at .next/server/app/admin/audit/page.js:2:12793
    { digest: '2236692779' }
```

### The spec's own hypothesis was half right, and the wrong half was the load-bearing one

`spec.md` §0 and `tasks.md` § `S-E04-2` both recorded the `humanize*` import as *"the only smell … **legal in Next 15**,
though it forces them into the client bundle"*. **Importing** a value from a `'use client'` module is indeed legal.
**Calling** it from a server component is not: the bundler replaces the export with a client reference, and invoking
that reference throws. `page.tsx:93` and `:98` called both functions inside an `Array.map` building the filter
options — so the crash was **unconditional**, on every authenticated load, with no data dependency.

This is the second time this kit has recorded a *"did not reproduce statically"* that a running stack falsified
(`R-30`, `feedback_false_red_evidence`). A static read can establish that code *looks* correct; only execution
establishes that it *is*. The kit was right to refuse to close `PF-14` in either direction without the render.

### The fix — minimal, and it makes the class of bug unavailable rather than just absent

`apps/web/src/app/admin/audit/audit-labels.ts` is **new** and carries **no** `'use client'`. It holds the two label
maps and the two `humanize*` functions, and it is imported by all four consumers — `page.tsx` (server) plus
`AuditPageFilters` / `AuditTable` / `AuditDetailDrawer` (client). `AuditPageFilters.tsx` **no longer exports them**:
a re-export would have preserved the exact trap for the next server caller, so the definitions moved rather than
being aliased. The file's header states the invariant in the imperative — this module must never gain `'use client'`
nor import one.

### `/admin/reports` — repointed, per `ux.md` §8's preferred option, and it closed `PF-119` too

`sidebar-items.ts:175` now reads `{ key: 'analytics', icon: BarChart3, label: 'Analytique',
href: '/admin/analytics' }`. One line fixes **two** defects: a menu entry pointing at a route that was never built,
and a real page (`/admin/analytics`, « Analytique des performances ») that had **no** sidebar entry at all, sitting
under the very icon the dead entry carried. `/admin/analytics` is reachable from the admin menu **for the first
time**. No reports page was built — `tasks.md` refuses one, and the admin already has `/admin/exports`
(« Exports & Rapports ») and `/admin/analytics`.

> **`AC-4` reconciled, not silently satisfied.** `AC-4` says the label must equal *"the destination page's own
> `PageHeader` title"*. That title is « **Analytique des performances** »; the object `tasks.md` and `ux.md` both
> prescribe **verbatim, twice** carries `label: 'Analytique'`. Taken literally the two clauses disagree. The
> prescribed object was followed, because « Analytique » is exactly the destination's own breadcrumb leaf
> (`analytics/page.tsx:90`) and a sidebar cannot carry a four-word label. So the menu names the page as the page
> names itself, in the short form the page itself uses — the intent `ux.md` states in prose (*"or the menu lies in a
> new way"*). Recorded rather than glossed over.

### Executed, not asserted

| Claim | Command / action | Observed |
|---|---|---|
| The page crashed for an authenticated admin | browser login + `/admin/audit` | **HTTP 500**, digest `2236692779`, console + server log above |
| The page renders after the fix | rebuilt `web` image, `--force-recreate`, second authenticated render | see § *Second render* below |
| The link gate passes with the row **retired** | `node scripts/link-integrity-check.js` | `LINK INTEGRITY CHECK: PASS` — **verdict line read, not `$?`** (`R-23`) |
| The gate **would go red** if the entry came back | re-inserted the old entry, re-ran the gate, reverted | `LINK INTEGRITY CHECK: FAIL` + `✗ apps/web — DEAD LINK — /admin/reports matches no emitted route.` |
| No surface references the dead route | `grep -rn "/admin/reports" apps/web/src` | **no matches** (`AC-2`) |
| No residual outside `apps/web` | same grep over `scripts/` | **no matches**; the baseline row is gone, so the ratchet **lowered by one** |

### The gate caught something the slice's own reasoning had missed — and it was right to

The first full `ci-gate.sh` run returned **`GATE: FAIL (1 stage)`** — `✗ 3 NEW test failure(s) — not in the baseline`,
all three in `apps/api/src/shared/quality/link-integrity-gate.spec.ts`. Every other stage was green, including the
link-integrity stage itself. The cause was not a bug in the change: that spec used `/admin/reports` as its **live
specimen** in three places — as a `MEASURED_DEAD` row asserted to be in the baseline, as the `href-like` extraction
example, and as the real-tree subject of the `prefix-constant` refusal proof. Retiring the target pulled the ground
out from under its own test suite. **This is exactly the blast radius `PF-80` describes**: an editor working inside
`apps/web` cannot see that a spec in `apps/api` pins the string it just deleted. Only the full gate could.

The fix follows the precedent this very file records for `/help`: **narrow, never delete.** A row that stops being
true still has to be asserted in its new direction, or the suite silently stops covering the target it was written
for. So `/admin/reports` moved out of `MEASURED_DEAD` into a new `MEASURED_RETIRED` list — and the distinction is
recorded in the code, because the two narrowings are *not* the same thing: `/help` became **alive**;
`/admin/reports` is still dead forever, but is no longer **referenced**, so it is no longer debt and the reviewed
baseline may no longer carry it. Two assertions replace the one that was lost, and the second is the one that
actually guards the regression — it drives `extractLiteralLinks()` over the real tree and fails **by name** if any
surface links the target again, rather than surfacing later as a generic dead-link problem.

The two other specimens moved to real targets rather than to fixtures, so the tests keep proving something about the
product: the `href-like` example is now `/admin/analytics` (the href that replaced it, at the same sidebar site), and
the refusal proof is now `PF-92`'s `/parent/remediation` — still dead, still baselined, still referenced with a real
`file:line` (`RemediationProgressStrip.tsx:233`), which is what that test needs to mean anything.

**Re-run in isolation: `172 passed · 1 skipped · 0 failed`**, then the full gate was re-run end to end for the
authoritative verdict rather than trusting the isolated pass (`R-23`, `PF-80`).

### What this slice deliberately did NOT do

- **It did not touch the read side of `portal`.** The `where: { portal: { not: null } }` facet vs the exact-match
  filter at `analytics.service.ts:3246` — so a `null`-portal row is offered by no filter value — is **still open**,
  still owed by `S-E04-4` / `S-E04-5`. `PF-123`'s rows remain unreachable by any filtered review.
- **It did not move the vocabulary to `packages/contracts`.** `audit-labels.ts` is an intermediate step inside the
  admin portal, not the canonical home. `S-E04-4` (`ADR-037`) owns that, and the new file says so in its header.
- **It made no claim about the audit *data*.** The page now renders; whether what it renders is true is `S-E04-5`'s
  question.

### Raised by this slice

| Finding | One line |
|---|---|
| **`PF-124`** *(new, P2)* | `apps/web/src/app/admin/login/page.tsx` — the « Mot de passe oublié ? » link is built with a `redirect_uri` of `http://localhost:3100/admin/login` while the container serves `:3000` (`KEYCLOAK_PUBLIC_URL` / `WEB_PUBLIC_URL` drift). Keycloak will reject the redirect as unregistered, or bounce the operator to a dead port. Observed in the login page's DOM during this slice's login step; **not** a `V3-E04` seam — owner `V3-E05` |
| **`PF-125`** *(new, P3)* | The credentials login round-trip took **~30 s** on the local stack (`POST /api/auth/callback/credentials`), while a direct Keycloak password grant from the host returns in **1.1 s**. Cause not investigated; recorded as a measurement, not a diagnosis |

---

## `S-E04-3` — shipped 2026-08-08 · the operator's real IP and User-Agent reach the API

**Branch** `ci/2026-08-08-v3-E04-3-client-provenance` · **Risk** P0 · **Gates** `G-AUDIT` *(partial)*, `G-AUTHZ`,
`G-DNC` · **`G-MIGRATION` did not trigger** · **Amends `ADR-036`** (D9/D10) · **Closes `PF-128`**

### What landed

| # | Change | Where |
|---|---|---|
| T-1 | `trust proxy`, pinned from a refusing key — the **only** `app.set('trust proxy', …)` in `apps/api` | new `apps/api/src/shared/config/trust-proxy.ts` (186 l) + `main.ts`; `TRUST_PROXY_HOPS` joins `REQUIRED_ENV` |
| T-2 | The **only** header/socket read, two branches | new `apps/api/src/shared/audit/client-hints.ts` (318 l) |
| T-3 | One `apps/web` producer, called from **both** server seams | new `apps/web/src/lib/client-provenance.ts` (350 l) ← `lib/api-client.ts` **and** `app/api/proxy/[...path]/route.ts` |
| T-4 | The honest blank, stated per surface | new `apps/web/src/app/admin/audit/AuditProvenance.tsx` (97 l); `PROVENANCE_UNAVAILABLE` / `hasNoProvenance` / `humanizeUserAgent` in `audit-labels.ts` |
| T-5 | Hints threaded to two write sites | `subjects.controller.ts:226`, `calendar.controller.ts:294` — **2 of ~13** `deriveAuditProvenance` call sites; see *Not claimed* |
| T-6 | Two new configuration keys, declared in five files each | `infra/docker-compose.yml`, `infra/docker-compose.prod.yml`, `.env.example`, `.env.prod.example`, `apps/api/.env.example` |
| T-7 | Four new specs | `client-hints.spec.ts` (307 l), `client-hints.supertest.spec.ts` (217 l), `trust-proxy.spec.ts` (206 l), `trust-proxy-dnc10-gate.spec.ts` (347 l) |

**`applyTrustProxy` is called by `main.ts` *and* by the supertest harness**, deliberately: a test that configured
`trust proxy` inline would prove a property of the test, not of the artefact that ships. That is the `S-E02-18` /
`S-E02-19` lesson applied before it could be re-learned.

### `PF-128` — the second seam, found by measuring rather than by reading

`ADR-036`'s Context table named **one** `apps/web` server seam. There are **two**: `lib/api-client.ts` and
`app/api/proxy/[...path]/route.ts`, the latter serving every client-component-driven write. A one-seam fix would have
left that entire class of audited write blank **forever**, and the blank is indistinguishable from the designed-for
blank — so nothing would ever have reported it. Closed here; the ADR's own Context table is corrected in the same
diff. Registered in `docs/daily-improvement-v3/audit-findings-index.md`.

### The two blockers the land pass fixed — and why they are one defect, not two

Both were found by the gate and the escalation panel, **not** by the implementing agents, and both are the same
shape: **the failure value and the designed-for value are the same `null`.**

1. **`WEB_TRUST_PROXY_HOPS` was declared in exactly one file — the one that reads it.** A repo-wide grep returned
   only `apps/web/src/lib/client-provenance.ts`. So `webTrustProxyHops()` always took its fallback branch and
   returned `0`, `resolveClientAddress()` short-circuited at its first line (`if (hops < 1) return null`), and
   `x-pilotage-client-ip` was **never emitted — in production as well as locally**. `AC-1` ("two audited actions
   from two different client addresses produce two different `ip_address` values") was unsatisfiable **by
   construction**, permanently, with one `console.warn` per web process as the only signal. Note the asymmetry that
   let it through: `TRUST_PROXY_HOPS` was declared in five places *and* asserted by a declaration-parity block in
   `trust-proxy-dnc10-gate.spec.ts` — the gate was pointed at the half that fails loudly.
2. **`AUDIT_FORWARD_TOKEN` was byte-different on the two sides of the hop.** Repo-root `.env:80` carried
   `local-dev-audit-forward-token` (fed to both containers through `x-app-env`); `apps/web/.env.local:40` carried
   `dev-local-forward-token-not-a-secret` — read by the `next dev --port 3100` process the operator actually uses.
   Branch 1 of `extractAuditClientHints` therefore returned `NO_CLIENT_HINTS` on every local UI-driven write, so
   **both** `ip_address` and `user_agent` came back `null`, and the read-back evidence would have looked exactly
   like the honest blank.

**Fixed, and the durable half is the rule, not the four declarations.** `WEB_TRUST_PROXY_HOPS` is now declared in
`infra/docker-compose.yml` (on the **`web` service**, not the `x-app-env` anchor — that anchor also reaches
`migrator` and `seed`, which render no page and can claim no client; the file states this rule 30 lines below for
`WEB_METRICS_PORT`), `infra/docker-compose.prod.yml` (`2`), `.env.example` (`0`), `.env.prod.example` (`2`), all in
the **refusing** `${VAR:?}` form. The parity guard in `trust-proxy-dnc10-gate.spec.ts` gained 4 cases, and the
load-bearing one is stated over the *shape* — **a key must be declared in a file other than the one that reads it** —
not over the instance. The same pass **tightened a hole the slice itself had opened**: the two existing API
assertions used an unanchored `/TRUST_PROXY_HOPS:\s*\$\{TRUST_PROXY_HOPS:\?/`, which the new `WEB_TRUST_PROXY_HOPS:`
line satisfies, so the API key could have been deleted from both compose files with the block still green. Now
`(?<![A-Z_])`.

### ⚠️ Gitignored file edits — stated here because a reviewer cannot see them in the diff

| File | Key | Value | Why |
|---|---|---|---|
| `.env` (repo root) | `WEB_TRUST_PROXY_HOPS` | `0` | **Required, not optional** — the refusing `${VAR:?}` form makes every local `docker compose` command fail without it |
| `apps/web/.env.local` | `AUDIT_FORWARD_TOKEN` | `local-dev-audit-forward-token` | aligned **to** `.env:80` (was `dev-local-forward-token-not-a-secret`). That direction was chosen because `.env` feeds both containers through `x-app-env`, so editing it needs a container restart; editing the web file affects only `next dev` |

### Executed, not asserted

| Claim | Command | Observed |
|---|---|---|
| The tree typechecks | `pnpm typecheck` (repo root, once, 3m52s) | **13 successful / 13 total — GREEN.** `@pilotage/api`, `@pilotage/web`, `@pilotage/worker` all cache-**missed** and executed |
| Diff hygiene | `git diff --check` | exit **0**; the 8 untracked new source files also checked individually via `--no-index` — no findings |

The typecheck went **RED first**: 4 × `noUncheckedIndexedAccess` errors in the new
`apps/web/src/lib/client-provenance.ts` (`:203`, `:204`, `:206`, `:212`), all one defect — regex-capture and
`split()` indexing assigned to `string`. Fixed by porting the guarding style of the API twin
(`shared/audit/client-hints.ts:246-262`), which compiles for exactly this reason. Recorded rather than smoothed over,
because "the gate caught the thing the gate exists to catch" is the useful half.

### ✅ MEASURED — `AC-13` / `AC-16`, executed by the routine after the sprint returned

The sprint left this open ("no end-to-end audited write was driven, no row read back"). The routine closed it: one
rationed `docker compose build api` — Step −1's condition held, because `pilotage_api` carried the image of
2026-08-07 and `infra/docker-compose.yml` mounts no source into it, so a restart could not have picked the code up —
then six probes against the running stack, each row **read back from Postgres**. The HTTP response was never the
evidence.

Boot log of the recreated container, quoted rather than paraphrased:

```
[Bootstrap] Preflight configuration OK — 4 variable(s) requise(s) déclarée(s) :
            KEYCLOAK_URL, KEYCLOAK_ADMIN_USER, KEYCLOAK_ADMIN_PASSWORD, TRUST_PROXY_HOPS.
[Bootstrap] Provenance d'audit — trust proxy pinné à 0 saut(s) (ADR-036 D2) ; jeton de transfert configuré.
```

**Baseline before the probes — the finding, reproduced one last time:** `select count(*), count(ip_address),
count(user_agent) from audit_log` → **54 / 0 / 0**, matching `M-3` at the top of this file. After: **59 / 4 / 4**.

Endpoint: `PUT /api/v1/subjects/coefficients/matrix` (`action='coefficient.upsert'`; the audit row is written
**inside** the `$transaction`). Actor: `admin@pilotage.local` via a Keycloak direct-access grant on `portal-admin`.

| # | Request | Branch | `ip_address` **stored** | `user_agent` **stored** | Proves |
|---|---|---|---|---|---|
| A | host → `localhost:4000`, no `x-pilotage-*` | 2 (`req.ip`, `N=0`) | `172.18.0.1` | `probe-A-host/1.0` | reference point |
| B | from **inside** `pilotage_worker` → `api:4000` | 2 | **`172.18.0.5`** | `probe-B-worker-container/1.0` | **AC-1** — two client addresses, two different stored values |
| C | host **+ forged** `X-Forwarded-For: 203.0.113.77` | 2 | `172.18.0.1` — **unchanged** | `probe-C-forged-xff/1.0` | **AC-2** — `203.0.113.77` appears nowhere in the table |
| D | `x-pilotage-client-ip: 198.51.100.42` + **wrong** token | 1, refused | **`NULL`** | **`NULL`** | **AC-3** — forged address refused **and** no fall-back to the relay's own address |
| E | same headers + **correct** token | 1, matched | `198.51.100.42` | `Mozilla/5.0 (Windows NT 10.0) RealOperatorBrowser/1.0` | **AC-4** |
| F | valid forward token, **no** `Bearer` | — | — (no row written) | — | **G-AUTHZ** — `HTTP 401` |

Row D is the one to read twice. It is the only new row that is blank, and it is blank **on both columns** — the whole
security argument executing. Had branch 1 fallen back to `req.ip`, D would read `172.18.0.1` and *every other
acceptance criterion above would still have passed*: A, B, C and E cannot distinguish the correct implementation from
the one that silently records the relay. D is the only probe that can, which is why it exists.

**F also closes the `AC-11` / `G-AUTHZ` residual** the sprint registered as missing ("no test drives a protected route
with a valid `x-pilotage-forward-token` and no `Bearer`"). It is now measured behaviour, not a structural inference.

**What this still does NOT prove, stated plainly.** Every probe drove the **API** directly. No write was driven
through `apps/web`, because the `web` container cannot be rebuilt (`PF-126`) and its running image predates the seam.
So `clientProvenanceHeaders()` — both web seams, and `PF-128`'s whole point — is proven by unit test and by the API
accepting exactly the headers it emits (probe E replays them byte-for-byte), **not** by an executed
browser → web → api round trip. Note also that locally `WEB_TRUST_PROXY_HOPS=0`, so even a working web container
would forward **no** address by design (`ADR-036` D10): the honest local outcome is a null `ip_address` with a real
`user_agent`. Named explicitly because that `null` is indistinguishable from the failure it would hide — the same
shape as the two blockers above, and the reason this section quotes counts and a boot log rather than a verdict.

### The gate caught one more thing, and it had been latent for months (`PF-133`)

The full `scripts/ci-gate.sh` returned **`GATE: FAIL (4 stage(s))`** on the sprint's tree — while `pnpm typecheck`
was **13/13 green**. Only one of the four was a real defect; `web artefact`, `csp` and `link integrity` all merely
read `apps/web/.next/`, so they failed *because* the build emitted nothing. One defect, four red stages.

```
./src/lib/api-client.ts
Error: You're importing a component that needs "next/headers".
Import trace: ./src/lib/api-client.ts → ./src/components/notifications/NotificationCenter.tsx
                                      → ./src/components/notifications/NotificationListItem.tsx
```

`NotificationListItem.tsx` is `'use client'` and imported the **value** `KIND_ICON` from `NotificationCenter.tsx`, a
**server** component that imports `api` from `@/lib/api-client`. Importing a value across that boundary drags the
whole server module into the browser graph. This was **already true before this slice** and silently tolerated: the
server fetch helper was simply being bundled for the browser, useless but harmless. Adding `next/headers` — the one
import that is *hard* server-only — turned a long-standing boundary violation into a build failure.

Fixed at the boundary, not at the import: the client-safe vocabulary moved to
`apps/web/src/components/notifications/notification-model.ts` (types + `KIND_ICON` + `KIND_LABEL`, no `api-client`),
and the two `'use client'` files import **from there directly**. A re-export from `NotificationCenter` would *not*
have worked — the import **specifier** decides the graph — and `await import('next/headers')` would have gone green
while leaving a client component depending on a server module, i.e. hidden the defect rather than closed it.

**Why it is a finding and not just a fix:** nothing in the repository asserts this invariant. `tsc` cannot see it,
and `next build` only sees it once a hard server-only import exists — so any *other* `'use client'` file importing a
value from a server module is still latent today, and will surface as a mystery build break in whichever unrelated
slice next touches `api-client.ts`. Registered as **`PF-133`**, owner `V3-E02` (build/gate).

#### …and fixing `PF-133` silently broke a different gate, which is the part worth reading

The first fix moved the whole vocabulary out of `NotificationCenter.tsx` — including `type Portal`. Build went green,
lint went green, and `test:api` reported **one new failure**: `link-integrity-gate.spec.ts` G-1, *"resolves the four
real declarations this slice depends on"*.

The cause is not local to that spec. `scripts/link-integrity-check.js` resolves a template's union **from the file
that carries the link**, and `NotificationCenter.tsx:240` writes `` href={`/${portal}/notifications`} ``. With the
alias moved, `resolveDeclaredUnion('portal', …)` returned `null`, so the template stopped expanding into
`/admin/notifications`, `/teacher/notifications`, `/parent/notifications` and degraded to an unresolved shape —
listed in the gate's own output as `« étoile »/notifications (3 sites) ← portal`.

**And the link-integrity stage stayed `✓ PASS`**, because an unresolved shape is *tolerated* by design. Three routes
stopped being checked, the stage that checks them reported success, and the only red anywhere in the repository was
one floor assertion in a spec whose whole purpose is to be that floor. This is precisely the failure
`resolveDeclaredUnion`'s own docblock names — *"picking the nearest one would under-approximate invisibly"* — observed
from the other side: not a resolver picking wrongly, but a refactor removing what it resolves.

**Correct fix, and it is narrower than the first one:** only **values** cross the server/client boundary harmfully. An
`import type` is erased before bundling and creates no graph edge — which is why `next build`'s trace named
`NotificationListItem.tsx` (imports the value `KIND_ICON`) and **not** `NotificationsFilters.tsx`, which was already
importing `type Portal` from the same server module without consequence. So `KIND_ICON` / `KIND_LABEL` / the row types
moved; `type Portal` moved **back**; the link expands again; both gates are green for the right reason. The constraint
is written into both files at the two places someone would next reach for it.

The transferable lesson, and the reason this is in `PROGRESS.md` rather than a commit message: **a green stage is not
evidence of coverage.** `link integrity` passed in both runs — before the regression and during it. What caught it was
a *floor* assertion pinned to a real declaration in a real file, the kind of test that looks redundant right up until
a refactor walks past it. `AC-7`'s negative control in `S-E04-1` was the same shape, and `PF-127` is the same
asymmetry a third time.

### Residuals raised by this slice, registered rather than fixed

| id / where | One line |
|---|---|
| **`PF-129`** — `apps/web/src/app/parent/register/actions.ts:25` | A **third** server-side fetch to the API that does not call `clientProvenanceHeaders`. Latent today (`RegisterController` writes no audit row), but the day it does, branch 2 records `req.ip` = the **web container** — `PF-31` rebuilt by the fix written to delete it. `PF-128`'s own failure mode, one file over, and **no web-side gate exists** — the invariant is asserted in prose only |
| **`PF-130`** — `infra/nginx/conf.d/pilotage.conf:103` | `location /api/` does not clear the three `x-pilotage-*` headers, so they arrive from the internet. Any authenticated actor can blank **their own** provenance with one header (`x-pilotage-forward-token: junk` → branch 1 → token fails → `NO_CLIENT_HINTS`), and the row is indistinguishable from an honest blank with nothing logged. Fix: strip the three headers at the edge in every `location` proxying to `api_upstream` |
| **`PF-131`** — `infra/nginx/conf.d/pilotage.conf:116` | `location /api/v1/notifications/stream` sets **no** `X-Forwarded-For`, so the real hop depth there is 1 while the API is pinned at 2. Latent (no `auditLog.create` reachable under that prefix) but it means the `N = 2` pin does not hold uniformly across the public surface |
| **`PF-132`** — `.env.example:117` / `.env.prod.example` | The shipped `AUDIT_FORWARD_TOKEN` placeholders. An operator who copies the example file publishes a governance trail whose `ip_address` any anonymous caller can choose — strictly worse than shipping the feature off. Fix belongs where the value is **read** (`main.ts` → `configureAuditClientHints`): refuse to configure the seam on a shipped placeholder or a value under ~32 bytes, log the refusal by name, leave provenance null |
| **`AC-11` / `G-AUTHZ`** | The **behavioural** half is missing: no test drives a `JwtAuthGuard`-protected route with a valid `x-pilotage-forward-token` and no `Bearer` and asserts **401**. Structurally verified (the header and env name appear in no guard, strategy, tenant resolver or role derivation), so this is missing evidence, not a live bypass — but the gate's stated purpose is to make a future author's mistake red, and a middleware that short-circuits the guard would satisfy the structural test |
| **RGPD / retention** | Populating `ip_address` + `user_agent` on an **append-only** table with **no purge path anywhere** (`apps/api`, `apps/worker`, `packages/imports-core`) turns the audit trail into indefinite storage of parents' and teachers' personal data — and `exportAuditAction` ships it into MinIO behind a signed URL. "Minimal access + append-only audit" and "erasure on request" now conflict on the same rows. Wants a **decision** (retention window / IP truncation for aged rows), not code |
| a11y — `AuditTable.tsx:96` | The audit row is **mouse-only** (`<tr onClick>`, no `tabIndex`/`onKeyDown`/`role`), and this slice makes drawer-only content load-bearing: the raw `user-agent` string and the « jamais remplacée par l'adresse d'un relais » sentence live **only** in the drawer. WCAG 2.2 SC 2.1.1, Level A. Compounded by `AuditProvenance.tsx:90`, where the full UA is exposed only through `title=` — not keyboard-reachable, not shown on touch |
| copy — `AuditProvenance.tsx:80` | The absence phrase is rendered **per-row**, so in the state that will be the default everywhere (`ipAddress` null, `userAgent` real) the table shows « Provenance non disponible » on one line and the browser on the next, and the drawer renders « Adresse IP → Provenance non disponible » beside « Navigateur → Chrome sur Windows ». The component's own docblock says the two fields are independent; this rendering breaks that rule |
| two `normaliseClientAddress` | Two exported functions, one name, one slice, different contracts — the web copy validates against IPv4/IPv6 regexes, the API copy strips decorations and defers to `sanitiseInetOrNull`. Not a correctness bug (the API re-validates) but it is the "second copy survives its own review" shape this slice spends paragraphs refusing elsewhere. Same for the duplicated `MAX_*_TRUST_PROXY_HOPS = 2` bound |
| `client-provenance.ts:339` | The always-emitted **empty** token header is load-bearing and untested end-to-end: its arrival is the only thing keeping the API on branch 1. If any intermediary drops an empty-valued header, the API falls to branch 2 and records the web container's address. A non-empty sentinel removes the dependency |
| `client-provenance.ts:261` | Fail-open branch: `hops === 1` with an empty chain trusts `x-real-ip`. Neither declared topology uses `W = 1`, so it is latent — but it is reachable only when the assumed single relay did not set XFF, i.e. exactly when the topology assumption is already false |

### What this slice deliberately did NOT do

- **It did not thread hints at every write site.** Only **2 of ~13** `deriveAuditProvenance` call sites pass them, and
  no gate requires a new audited write to. `/admin/audit` therefore renders « Provenance non disponible » identically
  for *"the write site never captures it"* and *"it was not resolvable"* — an auditor cannot tell a design gap from an
  honest blank. Scope-consistent (`S-E04-7` owns the column-level rule) but **stated here rather than discovered
  later**.
- **It did not add a web-side unit runner.** `apps/web` has none — `package.json` carries dev/build/start/lint/
  typecheck plus Playwright e2e, no jest, no vitest — so `resolveClientAddress` / `normaliseClientAddress`, the 350
  lines that decide whether a browser can choose its own audit row, are **executed by no test**. Introducing a test
  toolchain to a workspace that has none is a new architectural decision and out of scope for this slice. The
  reachable form, recorded for whoever takes it: an `apps/api` quality spec that loads the web module through a
  dynamic `require` (precedent: `csp-gate.spec.ts:36`, `link-integrity-gate.spec.ts:40`), since
  `client-provenance.ts` has **zero** imports. A static `import` would break `apps/api`'s `rootDir` with `TS6059`.
- **It did not touch the read side of `portal`**, the vocabulary, transactionality, or the hash chain.

---
## Not claimed (kept honest — the whole point of this file)

| Item | Why it is not claimed | Who can close it |
|---|---|---|
| ~~**Anything about `/admin/audit` rendering**~~ | **CLOSED by `S-E04-2`** — the authenticated render was performed on 2026-08-08: it returned **HTTP 500** (digest `2236692779`), the cause was a client-only function called from the server, and a second render after the fix is recorded above. `PF-14` is settled in the **reproduces** direction | — *(done)* |
| **Every acceptance criterion `AC-1`…`AC-12`** *(minus the six `S-E04-1` closed)* | Still true of `AC-2`…`AC-12` as epic-level criteria: `S-E04-1` closed **its own** six ACs (evidence in § `S-E04-1`) and touched no other. `spec.md`'s epic `AC-2` finance clause stays **vacuous** (`M-30`) | each owning slice |
| **Every gate** | `spec.md` §8 states how each **will** be evidenced. None is met. `G-AUDIT` in particular needs a rollback test in **both** directions **per family**, and none exists | each owning slice |
| ~~The pinned hop count for `trust proxy`~~ | ~~**NOT MEASURED.**~~ **SUPERSEDED 2026-08-08 by `S-E04-1`.** The topology *was* measured and `ADR-036` *was* written: **`N = 2`** for production (Traefik → nginx → api) and **`N = 0`** for the local `--profile app` stack, each pinned to the file and line it was read from. What remains unestablished is narrower and is stated **inside the ADR** under its own heading: the host Traefik runs from `/root/docker-compose.yml` on the VPS, outside this repository, and was not read — so `N = 2` is pinned on the *deployment shape*, not on Traefik's source. Row kept struck rather than deleted, because a reader who stops here would re-measure work that is done | ~~`S-E04-1`~~ → the Traefik-source half: operator / `S-E04-3` |
| The chain's concurrency mechanism | **NOT MEASURED and NOT CHOSEN.** Advisory lock vs `Serializable` vs a `chainSeq` column — the third is a schema change and the second has **zero occurrences** in `apps/api`. `S-E04-8`'s first task is to choose and justify | `S-E04-8` |
| Whether the existing `(tenant_id, created_at)` index suffices for chain traversal | **NOT MEASURED.** No `EXPLAIN` was run. Do not add a redundant index on the strength of this spec | `S-E04-8` |
| How many `audit_log` rows exist on the **hosted** deployment | **NOT MEASURED** — the routine has no hosted credentials. The genesis anchor must record the count **at the moment it is declared**, whatever it is; it is never assumed to be 54 | operator / `S-E04-8` |
| That the 54 legacy rows will be corrected | **They will not be.** `spec.md` §6 rules that an `UPDATE` over an append-only audit trail — performed in the epic that installs tamper-evidence — is refused. The seed is corrected; the rows are rendered honestly with `vocabulary: "unknown"` | n/a — a decision, not a gap |
| That the pre-V3 gap will ever close | **It will not.** `A-01` is permanent: backfill is impossible and fabricating it would be worse than the gap. `R-10` accepted. The gap must be visible **in-product**, not only here | n/a |
| That `PF-96` is addressed | **It is not.** `AuditLog` has no FK to `Tenant`; audit rows outlive their tenant. Referenced, posture to be **stated** in `ADR-035`, relation **untouched** — a reflex cascade would let a tenant deletion erase its own audit history | a later slice |
| That RLS protects audit rows | **It does not exist.** 0 occurrences repo-wide, `0_baseline` included, despite `ADR-002`. This epic's tenant scoping is **application-level only**; `ADR-032` / `V3-E01` owns that work. This sentence exists so nobody writes the opposite | `V3-E01` |
| That `AC-2`'s finance clause is satisfiable | **It is vacuous today** — there is no finance module (`ADR-018` defers it). Ticking it would be false. `S-E04-7`'s gate arms it for the module that does not yet exist | `V3-E15` |
| Retention / legal-hold policy | Out of scope by the epic contract — D-08-adjacent legal input, and `R-13` forbids this routine authoring policy text | human + D-08 |
| The parent panel « Qui a consulté les données de mon enfant » | **Deliberately not built.** It needs a guardianship-scoped read endpoint, `G-AUTHZ` negatives per role, and a product decision about which action types are parent-visible at all. What this epic owes it is **one** thing: the vocabulary declared in `packages/contracts` (`ADR-037`), so the panel is later a read endpoint and a page rather than a second label map | a later epic |
| Any UI, a11y or rendering claim in `ux.md` | **No browser was driven.** `apps/web` has no unit runner (Playwright only). Every layout, contrast and a11y statement is read from source or computed from a hex value. No axe scan, no screen-reader pass — that is `VAL-08` | `VAL-08` |
| That `ADR-035` / `036` / `037` are free numbers | Checked against `docs/adr/` (holds `001`…`028`) and `architecture-impact.md` §4 (reserves `029`…`035`) **on 2026-08-08**. Each slice must **re-check immediately before creating its file** and record any renumber — the precedence rule `S-E02-18` installed (`PF-110`) makes `docs/adr/` the register of record | each owning slice |

---

## Findings ledger

| Finding | State after this run | Note |
|---|---|---|
| `PF-14` | **open** — specced | Split into an **open measurement** (does the page render authenticated?) and a confirmed dead link. Both owned by `S-E04-2` |
| `PF-31` | **open** — closed at the **8 + 9 literal sites**, *not* across `apps/api/src` | All 8 `actorRole` literals and all 9 `portal` write literals are gone, plus two anonymous inline derivations the intake had not measured; a `super_admin` minting a role is now audited `super_admin`, and a blocking spec keeps it that way. **This row read "the actor-role half is closed in `apps/api/src`" until the escalation panel falsified it** — see § *Three residuals inside the walk root* below. **Still open:** `PF-121` (`packages/imports-core`), **`PF-122`** (`child-claims.service.ts` parametrises both fields), **`PF-123`** (`assessments.controller.ts` writes neither), all owner `S-E04-7`; the transactionality half (`S-E04-6`); and the families that write **no** audit row at all — role grant/revoke, `modules/schools/`, `modules/enrollments/` (`M-33`) |
| `PF-32` | **open** — specced, and **widened by measurement** | Four defects plus the vocabulary split (`spec.md` §1.3). Owned by `S-E04-4` + `S-E04-5` |
| `PF-96` | **open** — referenced, not fixed | Posture to be stated in `ADR-035` |
| `PF-121` | **open** — raised and registered by `S-E04-1` | The two `tx.auditLog.create` calls in `packages/imports-core/src/engine.ts` still hard-code both provenance fields, on a call path with no JWT (the worker drains a BullMQ job). Deliberately out of `S-E04-1`'s scope: `AC-2` is scoped to `apps/api/src`, and a job-written row needs provenance captured at *enqueue* plus a ruling on what portal a job acted through. Owner `S-E04-7` |
| **`PF-122`** | **open** — raised by the escalation panel, registered by this land pass | `child-claims.service.ts:722-729` is a **fourth decision site inside `apps/api/src`**: `actor: 'parent' \| 'admin' = 'parent'` → `actorRole: actor`, `portal: actor`, with the literal `'admin'` passed at `:522`/`:609`. A `super_admin` approving a guardianship claim is audited **`actorRole: 'admin'` — not a realm role at all**, so `/admin/audit`'s role facet carries a fifth orphan token no label map knows. Invisible to all four gate matchers by construction. Owner `S-E04-7` |
| **`PF-123`** | **open** — raised by the escalation panel, registered by this land pass | `assessments.controller.ts:290` writes `assessment.publish` with **no `actorRole` and no `portal` key** — grade publication records no actor role, and a `null` portal is reachable by **no** offered `/admin/audit` filter value (the facet list is built `where: { portal: { not: null } }`, `analytics.service.ts:3358-3364`). Owner `S-E04-7` |
| **`PF-128`** | **closed** by `S-E04-3` | `ADR-036`'s Context table named **one** `apps/web` server seam; there are **two** (`lib/api-client.ts` and `app/api/proxy/[...path]/route.ts`). A one-seam fix would have left every client-component-driven audited write blank forever, undetectably. Both seams now call the single `clientProvenanceHeaders` helper; the ADR's Context table is corrected in the same diff (`R-30`) |
| **`PF-129`** | **open** — raised by `S-E04-3` | `apps/web/src/app/parent/register/actions.ts:25` is a **third** server-side fetch to the API that bypasses the helper. Latent (no audit row on that path today); becomes `PF-31` again the moment one is added. **No web-side gate exists** — "every server-side fetch to `API_URL` goes through `clientProvenanceHeaders`" is asserted in prose and enforced nowhere. Owner `S-E04-7` |
| **`PF-130`** | **open** — raised by `S-E04-3` | `infra/nginx/conf.d/pilotage.conf:103` does not strip the three `x-pilotage-*` headers, so they are accepted from the public edge. One-header self-anonymisation by any authenticated actor, indistinguishable from an honest blank, nothing logged; and any leak of `AUDIT_FORWARD_TOKEN` becomes internet-facing forgery rather than an internal-network risk. Owner: infra / `S-E04-7` |
| **`PF-131`** | **open** — raised by `S-E04-3` | `infra/nginx/conf.d/pilotage.conf:116` (`/api/v1/notifications/stream`) sets no `X-Forwarded-For`, so hop depth there is 1 against a pin of 2. Latent today; the `N = 2` pin is the security argument and it does not hold uniformly. Owner: infra |
| **`PF-132`** | **open** — raised by `S-E04-3` | Both `.env` examples ship an `AUDIT_FORWARD_TOKEN` **placeholder**, the token is not in `REQUIRED_ENV`, no gate has a rule for it, and no test covers its value. A publicly-known token turns « null rather than wrong » into « plausible and wrong ». Fix belongs at the read site (`main.ts` → `configureAuditClientHints`), plus a one-way `production-artefact-check.js` row. Owner `S-E04-7` |
| `R-10` / `A-01` | unchanged | Accepted; the gap is documented and must be rendered in-product by `S-E04-8` |

---

## Housekeeping raised by this run

- **`docs/spec/features/v3-e04/data-model.md` carried two literal NUL bytes** (offsets 33328 and 33374), inside a
  table row that discusses PostgreSQL rejecting NUL in `jsonb`. Git therefore classified the file as **binary**, so it
  would have reached the mandated human review as *"Binary file not shown"*, and `grep` over the doc set would have
  silently skipped it. This is **`PF-95` recurring** — the same shape, at a second address, in a docs file this time.
  `PF-95`'s own record notes that no gate can catch this class (`git diff --check` has no text to scan on a binary
  file) and that the ~10-line "tracked files must contain no NUL" check **was never built**.
  **FIXED in this run's land pass:** each raw byte was replaced with the *spelled-out* form `U+0000` — never with an
  escape a tool might expand back into the byte. Verified after the fix: **0 NUL bytes across all eight files** of the
  kit; `git diff --numstat` now reports `625 0 docs/spec/features/v3-e04/data-model.md` (a line count, i.e. **text**)
  rather than `- -` (binary); `git diff --check` clean.
- **This file reproduced the same defect while reporting it**, and the fact is left on the record rather than tidied
  away: quoting the escape sequence emitted a real NUL into `PROGRESS.md`, which was then detected and stripped
  (verified: 0 NUL bytes across all **eight** files of this kit). That is the second and third instance of `PF-95` in one
  run, in two different agents' output — which is the strongest available argument that the missing check is worth
  ~10 lines. **Raise it as a `V3-E06` follow-up**: a tracked-file NUL scan in the `scripts/*-check.js` family, wired
  into both harnesses, landing green today with a zero-entry baseline.
