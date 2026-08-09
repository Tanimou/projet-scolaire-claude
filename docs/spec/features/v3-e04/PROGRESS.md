# V3-E04 — Audit trail and governance surfaces

**Layer** L0 · **Size** M · **Closes** `PF-14`, `PF-31`, `PF-32` · **Gate** `G-AUDIT` (primary)
**Depends on** `V3-E02` (`code-complete` 2026-08-08 — dependency satisfied) · **Blocks** `V3-E03`, `V3-E11`
**Risks** `R-10` (accepted), `A-01` (permanent) · **Referenced, not fixed:** `PF-96`

**Status (2026-08-09, after `S-E04-6`)** — **`in-progress`. 6 of 8 slices shipped.**

The `epic-spec` run wrote `spec.md`, `plan.md`, `data-model.md`, `contracts/openapi.yaml`, `ux.md`, `tasks.md`,
`quickstart.md` and this file, and touched no code. **`S-E04-1` then shipped** the shared provenance home, the eight
`actorRole` literals, the nine `portal` write literals, the two anonymous inline copies, `ADR-036` and two new
specs — evidence in § `S-E04-1` below. **`S-E04-2` shipped** the authenticated render (verdict: **HTTP 500**,
`PF-14` reproduces) and its fix, plus the `/admin/reports` retirement. **`S-E04-3` shipped** `trust proxy`, the
client-hints seam, the `apps/web` producer on **both** server seams, and the honest-blank UI — evidence in
§ `S-E04-3` below. **`S-E04-4` shipped** the one canonical vocabulary in `packages/contracts/src/audit/`, its three
consumers (web adapter, API KPI predicates, worker CSV), the AST extractor and its gate, `ADR-037`, and the honest
« Non instrumenté » card — evidence in § `S-E04-4` below. **`S-E04-5` shipped** the first migration of the epic
(`Tenant.timezone`), one shared day-window resolver in `packages/contracts`, the single-`where` rewrite that makes
all four KPIs share the table's scope, the day-inclusive `to`, the `__none__` portal sentinel, the declared action
tone, and the reconciliation of `openapi.yaml` / `data-model.md` against shipped code (`PF-137`) — evidence in
§ `S-E04-5` below. **`S-E04-6` shipped** the in-transaction write seam (`apps/api/src/shared/audit/write-audit.ts`),
its compile-time brand, the three families that wrote **no row at all**, `ADR-035`, and the 12 new vocabulary codes —
evidence in § `S-E04-6` below. `S-E04-7`…`S-E04-8` remain **open**, and every gate they own is still described by
**how it will be evidenced**, never as met.

> ### ▶ Next slice → **`S-E04-7`** — the remaining call sites move onto the seam, and a blocking gate keeps them there
>
> `[api][audit]` · size **M** · **`G-AUDIT` is its PRIMARY gate** · no new ADR (**`ADR-035` is amended**) ·
> **blockedBy** `S-E04-6` ✅ — shipped 2026-08-09, so it is unblocked. `G-MIGRATION` does **not** trigger.
>
> Start at `tasks.md` § `S-E04-7`. Five things `S-E04-6` hands over, none of which it may silently re-decide:
>
> 1. **The seam exists; it is not exclusive, and that gap IS this slice.** Measured on the `S-E04-6` branch:
>    **27 direct `auditLog.create` call sites remain outside the seam, across 15 files** — including
>    `identity/roles.controller.ts`, the exact defect `write-audit.ts`'s own docstring cites as its motivation (it
>    creates the role, then writes its audit row in a separate non-transactional statement).
> 2. **Land the pinned-inventory gate as an *allow-list*, not a ban.** A ban is RED on arrival. Walk
>    `apps/api/src/**/*.ts` (excluding `*.spec.ts` and `shared/audit/write-audit.ts`), collect every
>    `auditLog.create` site as `file` + count, and assert the set equals a checked-in inventory. A new file or a
>    higher count fails pointing at `writeAudit`; **migrating** a site fails too, so the inventory only ever shrinks
>    deliberately. Every other invariant of `S-E04-6` already has a test; the one thing nothing defends is **erosion**.
> 3. **The vocabulary gate's floor was redefined, not merely raised.** `EXTRACTED.seams` now counts *direct writes +
>    shared-seam calls*, floor **30**, precisely so this slice's migration conserves the total by construction and
>    cannot read as a regression. Do not re-narrow it to the direct form.
> 4. **`writeAudit`'s `action` / `resourceType` are typed `string`, not the declared unions.** `apps/api` already
>    depends on `@pilotage/contracts`, so typing them `AuditActionCode` / `AuditResourceTypeCode` converts `ADR-035`
>    D6 from convention to invariant and matches D1. It also removes D6.2's *"call it with an inline object literal"*
>    rule, which today has nothing but a comment behind it.
> 5. **`PF-121` / `PF-122` / the remaining `PF-123` sites are still yours.** `S-E04-6` closed `PF-123`'s **write**
>    half for `assessments.controller.ts` publish **only**, because that line was being edited anyway. `PF-150`
>    (`portal = ''`), `PF-129`, `PF-132` and `PF-141` remain.
>
> **Do not start with `S-E04-8`.** The chain is last by product ruling, not by convenience — see the ordering note
> below. Run `quickstart.md` §5 before writing code: the measurement table is meant to be **falsified**, not trusted.
>
> **A human owns two things before either one runs.** `S-E04-5`'s four cheap merge conditions: `PF-144` (two
> `@pilotage/ui` props with zero call sites, so `AC-9`'s rendering half is unreachable), `PF-145` (a malformed date
> renders as a service outage), `PF-146` (a malformed export parameter removes the window's lower bound), `PF-149`
> (full-ICU on `node:22-alpine` is asserted and never measured). And **`S-E04-6`'s posture decision**: `ADR-035` D2
> is now live — a failed audit insert throws and rolls back the mutation, so role grant/revoke, school
> create/update/close, all four enrollment decisions and grade publish **fail closed** on audit-table trouble. That
> is intentional, documented, and deliberately un-switchable (DNC-10) — and it is a new production failure mode on
> privileged admin paths.

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

## Slice backlog (`tasks.md` is the contract; 6 of 8 have shipped)

| Story | Title | State | blockedBy | `G-MIGRATION` | ADR |
|---|---|---|---|---|---|
| **`S-E04-1`** | Shared audit provenance: one home, one decision, one real actor role | **`shipped`** 2026-08-08 | — | no | **`ADR-036`** ✅ |
| **`S-E04-2`** | `/admin/audit` measured under authentication; the dead admin reports link is retired | **`shipped`** 2026-08-08 | — | no | — |
| **`S-E04-3`** | The operator's real IP and User-Agent reach the API — or the field stays blank | **`shipped`** 2026-08-08 | `S-E04-1` ✅ | no | **`ADR-036`** *(amended: D9/D10)* |
| **`S-E04-4`** | One canonical audit vocabulary, declared once, in `packages/contracts` | **`shipped`** 2026-08-09 | `S-E04-2` ✅ | no | **`ADR-037`** ✅ |
| **`S-E04-5`** | The KPIs share the table's scope, and the `to` filter includes its own day | **`shipped`** 2026-08-09 *(9/11 AC evidenced; AC-9 partial, AC-3 render half NOT OBSERVED)* | `S-E04-4` ✅ | **YES** — `Tenant.timezone`, `scripts/schema-drift-check.js` **PASS** | — *(`D-E04-5-1` / `D-E04-5-2`, no ADR — `ADR-034` explicitly **not** claimed)* |
| **`S-E04-6`** | Five privileged families write their audit row **in the same transaction** | **`shipped`** 2026-08-09 *(all 5 story AC evidenced; the seam is built but **not yet exclusive** — 27 direct sites remain, owner `S-E04-7`)* | `S-E04-1` ✅, `S-E04-3` ✅ | no | **`ADR-035`** ✅ |
| `S-E04-7` | The remaining call sites move onto the seam, and a blocking gate keeps them there | `todo` ◀ **next** *(unblocked)* | `S-E04-6` ✅ | no | — *(`ADR-035` amendment)* |
| `S-E04-8` | The hash chain from a declared genesis, its verification, and the documented gap | `todo` | `S-E04-3` ✅, `S-E04-6` ✅, `S-E04-7` | **YES** | `ADR-035` *(amendment)* |

**8 slices · 2 `todo` · 0 in progress · 6 shipped.** State vocabulary: `todo` → `in-progress` → `shipped`
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

## `S-E04-4` — shipped 2026-08-09 · one canonical audit vocabulary, declared once

**Branch** `ci/2026-08-08-v3-E04-4-audit-vocabulary` · **Risk** P1 · **Gates** `G-TRUTH`, `G-PORTAL`, `G-DNC`
(DNC-08 + DNC-09) · **`G-MIGRATION` did not trigger** · **Ships `ADR-037`** · **Advances `PF-32`** (vocabulary half)

### What landed

| # | Change | Where |
|---|---|---|
| FR1 | The **one** home — a pure module, no Prisma, no Nest, no `node:*`, no new dependency | new `packages/contracts/src/audit/{vocabulary,labels,index}.ts`; wired **both** through `src/index.ts` (`export * from './audit'`) **and** a `"./audit"` entry in `package.json` `exports` (pre-mortem #2 needs both, not one) |
| FR2 | The declaration itself | **48** action codes (each carrying its French label and its `critical` / `export` flags), **22** resource types, **4** portals — `student` included, which ADR-003 has had since day one and the old three-entry map rendered as a raw token |
| FR3 | The **frozen** legacy alias table — declared, never inlined | **5** action aliases + **8** resource-type aliases, the exact strings the pre-fix seed wrote |
| FR4 | Consumer 1 — web | `RESOURCE_TYPE_LABELS` and `PORTAL_LABELS` **deleted** from `apps/web/src/app/admin/audit/audit-labels.ts`, which becomes a thin adapter over `classifyAudit*`. No `'use client'` added; the four `S-E04-3` provenance declarations untouched |
| FR5 | Consumer 2 — API KPI predicates | `analytics.service.ts` — `criticalChanges` / `sensitiveExports` now read `AUDIT_CRITICAL_ACTIONS` / `AUDIT_EXPORT_ACTIONS` **∪ their legacy aliases**; every surviving `auditLog.count` keeps `tenantId` |
| FR6 | Consumer 3 — the worker CSV **nobody had counted** | `apps/worker/src/modules/exports/generators/audit-csv.generator.ts` — three derived columns added (`action_label`, `resource_type_label`, `vocabulary`); the raw `action` / `resource_type` columns are byte-for-byte unchanged (§2.8: labels are *additional*, a regulator never receives an interpretation in place of the record) |
| FR7 | The markers | new `apps/web/src/app/admin/audit/VocabularyMarker.tsx` — neutral slate, no `tone="warning"`, no alert-semantic icon (pre-mortem #5: 54 correctly-recorded rows must not read as 54 defects). Rendered in `AuditTable.tsx` and `AuditDetailDrawer.tsx` |
| FR8 | DNC-09 — the card that could only ever read `0` | `adminLogins` query **removed**; the API returns `number \| null` and `page.tsx` renders **« Non instrumenté »**, never a fabricated `0` |
| FR9 | The seed writes canonical codes | `seed-demo.ts` — 54 generic rows moved to canonical codes, plus a **named** 3-row `legacyFormatFixtureRows` block so the legacy path has live data (**57** rows total) |
| FR10 | The gate | new `apps/api/src/shared/quality/audit-vocabulary-gate.spec.ts` (V-0…V-10) + new `apps/worker/.../audit-csv.generator.spec.ts` + new cases in `analytics.service.spec.ts` |
| FR11 | The inverted case, **not** the skipped one | `audit-provenance-gate.spec.ts`'s `portal: 'admin'` case flipped to `toHaveLength(0)` with the reason written into the test body (pre-mortem #7 is precisely someone `.skip`ping it and taking the whole single-decision invariant with them) |
| FR12 | Test-infrastructure change, repo-wide in scope | both `apps/api/jest.config.js` and `apps/worker/jest.config.js` map `@pilotage/contracts` to `packages/contracts/src`, because `scripts/test-ratchet.js` spawns jest with `cwd: appDir` and so bypasses turbo's `test → ^build`. Documented in both configs — and see *Not claimed* below, because it has a cost |

### AC-7 — the vocabulary was **extracted**, not transcribed

`§1.2` of the story is the load-bearing measurement, and it is recorded here as the slice's own correction to the
run brief. The brief's inventory of **27** action codes came from `grep -rhoE "action:\s*'[a-z_]+'"`. That grep is
one-directional in the same way that let `calendar_event` go missing, it picks up at least one code that exists only
in a `*.spec.ts`, and it is blind to **five** distinct literal shapes in production sources:

| Shape | Real example | What the grep misses |
|---|---|---|
| Ternary in the key | `grades.controller.ts:345` `action: body.flagged ? 'grade.flag' : 'grade.unflag'` | `grade.unflag` |
| Union-typed helper parameter | `alerts.service.ts:617`, `remediation.controller.ts:889/:924/:994` | `remediation.plan_reopened`, `.tutor_updated`, `.availability_updated` |
| Positional argument to a private `audit()` helper | `academic-years.controller.ts:111/:154/:184` | `academic_year.update`, `academic_year.delete` |
| `action: string` helper parameter | `child-claims.service.ts:717`, `integrations.service.ts:637` | the five `guardianship.claim_*`, `integration.roster_source.created`, `import.sync.pull` |
| Template-literal **type** — an open set | `remediation.controller.ts:1020` `` action: `remediation.booking_${string}` `` | `remediation.booking_created`, `.booking_cancelled` |

**A declaration built from the brief's 27 would have shipped missing roughly fourteen labels on day one** — exactly
the defect this slice exists to end. So `audit-vocabulary-gate.spec.ts` runs a **TypeScript AST walker** over
`apps/api/src` + `packages/imports-core/src` (specs excluded) and the declaration is written to match *it*, not to
match any prose list — including the one in the story's own §3.1. The trap the brief did name is handled in the
negative: `orderBy: { action: 'asc' }` (and the array form at `roles.controller.ts:92`) must not yield the bogus
codes `asc` / `desc` and then force a French label onto a sort direction — V-1 asserts they do not.

The shipped declaration carries **48** canonical action codes and **22** resource types; the extractor's derived
`WRITTEN_*` sets are asserted at ≥ 40 / ≥ 20 rather than pinned to an exact number, deliberately — an exact count
would go red on the next legitimate audited action and teach the next author to edit the assertion.

**The guard runs in both directions.** Forward: every written code has a label. **Reverse:** no *declared* code is
written by nothing (families excepted) — which is what retires the 7 dead keys `AC-2` names, and which is also why
`seed-demo.ts` is now load-bearing for the gate: its `auditActions` / `auditResources` arrays are the only writer of
several labels. Editing the seed will redden V-1. That is intended; it is stated here so it is not mistaken for a
flaky test.

### AC-5 / G-PORTAL — all four portals, measured per portal

| Portal | Renders audit vocabulary? | What was checked | Result |
|---|---|---|---|
| `admin` | **Yes** — `/admin/audit` is the only page in the product that renders it | facet options, table chips, drawer, the « Format hérité » marker; `grep -rl "audit-labels\|classifyAudit" apps/web/src/app/admin` | **7 files**: `audit-labels.ts`, `page.tsx`, `AuditTable.tsx`, `AuditDetailDrawer.tsx`, `AuditPageFilters.tsx`, `AuditProvenance.tsx`, `VocabularyMarker.tsx` |
| `teacher` | **No page today** | `grep -rl "audit-labels\|classifyAudit" apps/web/src/app/teacher` | **0 files** |
| `parent` | **No page today** — the transparency panel « Qui a consulté les données de mon enfant » is explicitly a later epic | same grep over `apps/web/src/app/parent` | **0 files** |
| `student` | **No page today — but the label must exist**, because a row *can* carry `portal: 'student'` the moment a writer emits one | same grep over `apps/web/src/app/student`; plus `classifyAuditPortal('student')` → « Élève » (V-5) | **0 files**; resolver returns the French label, `vocabulary: 'canonical'` |

**No writer emits `portal: 'student'` today, and none was fabricated.** `deriveAuditProvenance` maps three realm
roles to three portals. Measured: `grep -rn "portal: 'student'"` over `apps/api/src`, `apps/worker/src` and
`packages/imports-core/src` returns **3 occurrences, all of them test fixtures** — `audit-vocabulary-gate.spec.ts`
(the unknown-code row, and a comment stating this very fact) and `audit-csv.generator.spec.ts`. Zero production
writers. The label is declared **ahead** of its writer on purpose: the alternative is that the first `student` row
ever written renders as a raw token on a governance surface, which is the shape of defect this epic removes.

**`PORTALS` was deliberately not widened** (`ADR-037` D2). `packages/contracts/src/enums/index.ts` still declares
exactly three, because `dto/auth.ts:10` consumes it as `portal: z.enum(PORTALS)` for **login** — a "unify these two"
refactor would silently make `student` a legal login portal. The gate asserts the non-widening rather than assuming
it: `[...PORTALS]` is exactly three **and** `auth.ts` is re-read to confirm the enum is still the one login
validates against.

### `PF-122` / `PF-123` — read while writing the extractor, deliberately **not** fixed

Both were re-confirmed by this slice and both stay open with owner **`S-E04-7`**, per the story's *Out of scope*
ruling (« Record, do not fix »):

- **`PF-122`** — `child-claims.service.ts` parametrises both provenance fields (`actor: 'parent' | 'admin' = 'parent'`
  → `actorRole: actor`, `portal: actor`), with the literal `'admin'` passed at two call sites. A `super_admin`
  approving a guardianship claim is still audited **`actorRole: 'admin'` — not a realm role at all**. This slice read
  the file (its `action: string` helper is one of the five extractor shapes above) and changed nothing in it.
- **`PF-123`** — `assessments.controller.ts:290` writes `assessment.publish` with **no `actorRole` and no `portal`
  key**. The `null`-portal row it produces is still reachable by no offered filter value (see § *The read side of
  `portal` was never inventoried*). Unchanged here.

Recording rather than fixing is the right call and also the cheap one: both are single-file provenance edits that
belong with the rest of the call-site migration, and folding them in would have widened a `[contracts]` slice into
`PF-31` territory mid-flight.

### Executed, not asserted

| Claim | Command | Observed |
|---|---|---|
| The tree typechecks | `pnpm typecheck` (repo root, run once by the test-architect) | **13 successful / 13 total — GREEN.** Includes `apps/api`'s `tsc --noEmit -p prisma/tsconfig.json`, so the rewritten seed STEP 13 is covered |
| No whitespace damage | `git diff --check` | exit 0. The only output is the expected CRLF-normalisation notice on `analytics.service.spec.ts`, a consequence of the `.gitattributes` addition |
| The new gate is real and non-vacuous | `apps/api` — `audit-vocabulary-gate.spec.ts` | **PASS, V-0…V-10** (~94 s). The AST extractor, the `asc`/`desc` trap, the five-shapes cases and the pre-fix positive control all fire |
| The inverted case was inverted, not deleted | `apps/api` — `audit-provenance-gate.spec.ts` | **PASS**, including the `portal: 'admin'` case now asserting `toHaveLength(0)` |
| The KPI predicates | `apps/api` — `analytics.service.spec.ts` | new `S-E04-4` block **green**; the 7 failures in that file are **all pre-baselined** in `scripts/known-test-failures.json` under `PF-63` — **no regression** |
| The regulator CSV | `apps/worker` — `audit-csv.generator.spec.ts` | **16 / 16 PASS** |
| `G-MIGRATION` does not trigger | `git diff --stat` | no `schema.prisma`, no `prisma/migrations/` |
| The CJS artefact resolves both wire-ups | manual `require` of the built package | `dist/index.js` → `classifyAuditAction: function`, `AUDIT_PORTALS.length === 4`; `dist/audit/index.js` resolves |

### The blocker the gate pass found, and why it was a real defect in the guard

`audit-vocabulary-gate.spec.ts`'s AC-1 single-declaration matcher went **RED on an untouched, unrelated file**:
`apps/web/src/components/shell/AppShellRoot.tsx`, whose two portal-nav maps contain `student: 'Mes notes'` and
`student: 'Ton espace élève'`. The matcher's own comment already stated the correct rule — the four portal codes are
too generic to key on in the *map* form — but the code implemented that exclusion **by omission**, building a
`CANONICAL_CODES_WITH_PORTALS` set for the descriptor form and passing plain `CANONICAL_CODES` to the map form on the
assumption that the two sets are disjoint. **They are not:** `student` is the one code that is both a portal and an
`AUDIT_RESOURCE_TYPES` entry, so the stated exclusion was silently never applied to the only code that needed it.

Fixed by subtracting the portal codes explicitly (`MAP_FORM_CODES = CANONICAL_CODES \ PORTAL_CODES`, 69 of 70)
rather than by adding a third file exclusion — an exclusion list weakens a shape-stated guard, which is what makes
it a guard. Measured after the fix, with an independent re-implementation of the matcher over the same 775 files:
**0 offenders**; the `vocabulary.ts` exclusion still trips at 72 associations; the `RoleBuilderForm.tsx` exclusion
still trips at **4** — and as a side effect the existing prose claiming it collides on *"exactly four tokens"* became
true, where it had silently been 5. A regression case was added asserting **both** halves: that the overlap exists at
all (`AUDIT_PORTALS ∩ CANONICAL_CODES === ['student']`, so a future refactor cannot delete the filter as decorative
without going red), and that no portal code survives into `MAP_FORM_CODES`.

### Deviations from the story, recorded rather than tidied away

1. **`packages/ui/src/components/SelectFilter.tsx` was edited, and the story forbids it** (§2.6: *"none is permitted
   in this slice"*; DoD: *"no `packages/ui/`"*). The change is one token — the option `hint` colour `text-slate-500`
   → `text-slate-600`, a pre-existing WCAG contrast defect. The reasoning is correct and measured, but `hint` is used
   by ~20 files across admin, teacher and parent, so a one-token change carries cross-portal blast radius with no
   test. **Kept and recorded here** (the alternative — reverting a real contrast fix to re-land it identically next
   run — is churn), but it is a scope deviation, not an oversight, and the DS follow-up it belongs with is the
   placeholder / chevron `slate-400` failures that were deferred.
2. **`LEGACY_FORMAT_MARKER` shipped as `'Format hérité'` (capitalised)**, where the story contract specified the
   literal lowercase `'format hérité'`. `AuditPageFilters` compensates with `.toLowerCase()`. Recorded so a later
   gate or e2e assertion written against the specified literal knows to match case-insensitively.
3. **The seed's final summary line was not updated with the rest.** `seed-demo.ts` prints
   `✓ 57 entrées d'audit créées (54 canoniques + 3 au format hérité)` at the per-step line, but the run-summary line
   further down still prints `AuditLogs 54`. Cosmetic, console-only, no behaviour depends on it — listed because
   *"check no doc still asserts 54 seeded rows"* is exactly the kind of item that is never checked once it is not
   written down.

---

## `S-E04-5` — shipped 2026-08-09 · the KPIs share the table's scope, and `to` includes its own day

`[schema][api][web][worker][truth]` · **`G-MIGRATION` triggered for the first time in this epic** · no ADR ·
two recorded decisions (`D-E04-5-1`, `D-E04-5-2`) · **needs human review, NOT auto-merged**.

### What landed

- **The first migration of the epic.** `apps/api/prisma/migrations/20260809120000_tenant_timezone/migration.sql`:
  a single `ALTER TABLE "tenant" ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'Europe/Paris';`. Additive,
  **non-volatile default** (no table rewrite on PG 15), no backfill, no index (access is by primary key),
  rollback stated in-file, **expand-only with no contract phase**. `prisma db push` appears **nowhere** in the diff
  or the run journal. The file was **hand-written rather than `prisma migrate dev --create-only`-generated**, with
  the reason written into its header: on any drift against `0_baseline` that command offers to **reset**, which
  would destroy the 54 legacy audit rows this whole epic is measured on. `scripts/schema-drift-check.js` is the
  compensating control and it was run — see *Executed, not asserted*.
- **One day-window resolver, in one place.** New `packages/contracts/src/audit/window.ts` — dependency-free,
  `Intl`-based, DST-aware, with an **exclusive `lt`** upper bound. `to = 2026-08-08` now resolves to
  `createdAt < 2026-08-08T22:00:00Z` for a `Europe/Paris` tenant, so 23:59:59 local **is** included. Three consumers
  call the same function: `analytics.service.ts` (the table + the four KPIs), the worker's
  `audit-csv.generator.ts` (the DPO export), and the `filters.timezone` echo the page renders. That is `ADR-037`'s
  discipline applied to a second vocabulary.
- **The single-`where` rewrite.** `auditList` builds **one** `where` literal carrying `tenantId` and every filter,
  and each KPI count spreads it and adds `AND: [...]` — never a top-level key that could overwrite the caller's own
  `action`/`actorId` predicate. `kpis.eventsInRange.value === total` is therefore **structural**, not asserted.
  Three all-time counters standing beside a filtered table are gone.
- **`adminLogins` is removed, not repaired** (`AC-4`). Its re-armable branch is deleted outright rather than
  re-scoped, which closes `PF-138` **by deletion** — there is no longer a branch that could lose its portal scope.
  The in-product sentence at `page.tsx:419` names **`V3-E05`** (which owns `PF-26`, the session lifecycle) as the
  owner of real login/session auditing. No "first authenticated request" heuristic was invented; that is not a login.
- **`{ value, scope, label }`** per KPI, the title resolved **server-side** so the card's title and its number cannot
  drift (`D-E04-5-1`).
- **The `__none__` portal sentinel** (`AUDIT_PORTAL_NONE`), offered by `/analytics/audit-facets` **only** when the
  tenant actually holds a `portal IS NULL` row, and decoded server-side to `portal: null`. `PF-123`'s **read** half.
- **The fourth audit vocabulary is gone** (`PF-134`). `AuditTable.tsx`'s inline substring matchers are replaced by a
  declared `auditActionTone` in `packages/contracts`. The two measured misses — `coefficient.upsert` and
  `grade.unflag`, both declared `critical` and both painted `neutral` — now resolve `danger`.
- **The docs the slice owns were reconciled** (`PF-137`): `contracts/openapi.yaml` (`Kpi` gains a **required**
  `label`; `sensitiveExports` corrected to the action-set criterion; the `Portal` enum documents `__none__`;
  `AuditFacetsResponse` declares `hasNullPortal`) and `data-model.md` (D-22 gains `label`, the §3.6 row is corrected
  with its measurement table, and **`D-25` is written** — it was cited by `schema.prisma` and by the migration
  header and existed at no address).

### Executed, not asserted

| Claim | Command | Observed |
|---|---|---|
| The repo typechecks | `pnpm typecheck -- --continue` | **`Tasks: 13 successful, 13 total`**. `--continue` is load-bearing: the first gate run reported *"10 successful, 13 total"*, which **under-reported** — turbo **cancelled** the in-flight `@pilotage/api` and `@pilotage/web` tasks when `@pilotage/worker` failed first |
| The KPI/window suite and the vocabulary gate | `pnpm exec jest --runTestsByPath src/modules/analytics/audit-kpis.spec.ts src/shared/quality/audit-vocabulary-gate.spec.ts` | **`2 passed / 2 total · 101 tests passed · 62.3 s`** |
| **`AC-6` — the migration replays and adds nothing** | `node scripts/schema-drift-check.js` | **`PASS — ok: 2 migration(s) built 55 tables and the datamodel adds nothing`**, exit 0, `migrate diff` in sync, scratch DB dropped |
| Whitespace / line-ending hygiene | `git diff --check` | exit **0**. Two informational CRLF notices (`schema.prisma`, `packages/ui/src/index.ts`), both files carrying small intentional diffs (8 and 2 lines) — no line-ending churn. The four new files were checked separately for trailing whitespace: **zero hits** |
| The removed keys have no surviving production reader | breaking-change sweep over `apps/` for `kpis.today` / `kpis.adminLogins` | only gate specs asserting their **absence**, plus unrelated local identifiers |

### The gate found a genuine defect, and it invalidated five acceptance criteria until it was fixed

`apps/api/src/modules/analytics/audit-kpis.spec.ts:57` declared an **uninhabitable** fixture parameter:

```ts
function row(partial: Partial<FakeRow> & { id: string; createdAt: string }): FakeRow
```

`FakeRow.createdAt` is `Date`, so the intersection collapses to `(Date | undefined) & string` = `Date & string`,
which nothing can satisfy. All 8 fixture literals were `TS2322`. **That file is the sole home of T1, T1b, T1c, T2,
T3, T4, T5 and T9**, so it had **never compiled** and `AC-1`, `AC-2`, `AC-5`, `AC-7` and `AC-11` had produced **no
evidence at all**. Any PR body asserting them before the fix would have been claiming a run that could not have
occurred. Fixed at the type layer with `Omit<Partial<FakeRow>, 'createdAt'> & { … createdAt: string }`, plus a
JSDoc stating why the `Omit` is load-bearing. **32 tests in that file now run and pass**, and the five criteria above
rest on that run — not on the earlier one.

A second, separate gate defect was confirmed and re-pointed: the DNC-09 / `PF-139` assertion
`expect(code).toContain('Indisponible')` in `audit-vocabulary-gate.spec.ts` was **red as written**. `CONSUMER_SOURCES`
is already built through `stripCommentsPreservingLines`, and the only capital-I *Indisponible* in `page.tsx` is
inside the `AuditKpi` JSDoc — blanked before the matcher ran; the two rendered strings are lowercase. The state
vocabulary does not live in `page.tsx` at all, it lives in `audit-kpi-state.ts`, which the gate never read. This was
a **spec-layer error, not a code error**. It was repaired by splitting the claim across the two files that carry its
halves, and by adding a **wiring assertion** (`page.tsx` must import from `'./audit-kpi-state'`, call
`resolveAuditKpiState`, and branch on `state.kind === 'unavailable'`) so the state gate cannot become a gate over a
file nothing renders. It was deliberately **not** weakened to a case-insensitive match on « indisponibles » — that
would pass on the outage banner alone and stop guarding the per-card state.

### `D-E04-5-2`'s consequence — implementation note 6 is **vacuous**, and that is recorded, not skipped

`tasks.md` note 6 asks for an `excludesLegacyRows` flag *where a KPI cannot match the legacy rows*. Under the
action-set criterion, **all four can**:

| KPI | Reaches the 3 legacy fixture rows? | Why |
|---|---|---|
| `eventsInRange` | ✅ | `count(*)` over the filtered `where` — it matches everything in range |
| `criticalChanges` | ✅ | the predicate includes `LEGACY_AUDIT_CRITICAL_ALIASES` (`Suppression`, `Mise à jour`) |
| `sensitiveExports` | ✅ | the predicate includes `LEGACY_AUDIT_EXPORT_ALIASES` (`Export`) — this is exactly the row the structural criterion would have dropped |
| `distinctActors` | ✅ | `groupBy actorId`; the legacy rows carry a non-null `actorId` |

**A field that can only ever be `false` is DNC-09 at the contract layer**, so it was **not shipped**. The
compensating evidence is the positive-control test in the `audit-kpis.spec.ts` T3 block, which proves each predicate
*does* reach its legacy alias. The residual risk — that live data holds a French value outside the frozen 13 — is
**`PF-143`, already open**; this slice references it and does not absorb it.

### Not claimed by this slice

| Claim | Status | Owner |
|---|---|---|
| **`AC-13` / any rendering claim — that `/admin/audit` renders after this diff** | **NOT OBSERVED.** No browser was driven. Three reviewing agents independently reported making no rendering observation. Every web claim in this section is pure-function, textual or type-level. This is the second consecutive slice to change `page.tsx` without executing it, on the one route in the product that returned **HTTP 500 for every admin** four commits ago | **`PF-135`** |
| That `AC-9`'s *rendered* three-state treatment works | **It cannot, as wired.** The derivation ships and is gated, but the `KpiCard` `state`/`scope` props written for it have **zero call sites** — see `PF-144`. The state word still renders at `font-mono text-3xl` | **`PF-144`** |
| That the runtime resolves `Europe/Paris` rather than `UTC` | **NOT MEASURED.** This diff is the **first server-side use of `Intl` with a `timeZone` option** in `apps/api` and `apps/worker`, and it *fails closed* on a reduced-ICU runtime. No `NODE_ICU_DATA`, no `full-icu`, no `apk add icu-data-full` exists anywhere in the repo | **`PF-149`** — command in the ledger |
| That RLS protects the new column | **It does not exist.** Zero `ENABLE ROW LEVEL SECURITY` and zero `CREATE POLICY` repo-wide, `0_baseline` included, despite `ADR-002`. Tenant scoping here is **application-level only**, and for `Tenant.timezone` it is satisfied **by identity** (the column sits on `tenant`, whose primary key *is* the discriminant). The migration header states this rather than inheriting the gap in silence | `V3-E01` / `ADR-032` |
| That the migration matches what `prisma migrate dev` would have generated | **Not diffed against Prisma's own output** — the file is hand-written, for the stated reset reason. `schema-drift-check.js` PASS is the compensating control, and it ran | recorded |

### Deviations from the story, recorded rather than tidied away

1. **`tone` is *derived*, not declared.** §2.6 asked for an explicit `'success'` on create/publish/approve and
   `'warning'` on update. The implementation adds the field as optional and derives every tone
   (`critical → danger`, `export → info`, else `neutral`), documents the reasoning in `labels.ts`, and pairs it with
   an `sr-only` sentence. Defensible — it reinterprets tone as *"which card counts this row"*, which is the more
   truthful reading — but it **silently removes green and amber from the Action column**, a visible change no
   acceptance criterion covers. Recorded here so it reads as a reversal, not an omission.
2. **`timezone` landed after `settings` in `schema.prisma`**, where §2.1 asked for it between `plan` and `settings`.
   Cosmetic; not worth a change.
3. **`packages/ui/src/components/KpiCard.tsx` was capped at "two lines, no API change" (§2.5) and grew a public
   three-state API instead.** Kept for now because reverting it and re-landing it wired is churn, but it is a scope
   deviation with a live consequence — see `PF-144`.

### Raised by this slice — nine findings, four of them merge conditions

| # | Severity | Where | What |
|---|---|---|---|
| **`PF-144`** | **major** | `packages/ui/src/components/KpiCard.tsx:85-87`, `apps/web/src/app/admin/audit/page.tsx:207` | `KpiCard` gained `state?: KpiState` and `scope?: ReactNode`, `packages/ui/src/index.ts` exports `KpiState` — and the **only caller passes neither**. `AuditKpi` routes scope through `children` and re-applies the amber ring by hand (`tone="amber"` + `className="ring-amber-200"`). Three consequences: an outage card stamps `data-state="measured"`; the `asStateWord` typography branch is **unreachable**, so « — » and « Non instrumenté » still render at `font-mono text-3xl`; and with `scope` undefined the card still emits its grey `—` delta placeholder, so an unavailable card shows **two** dashes. One concept, three representations, in one commit. Fix: pass `state={state.kind}` / `scope={state.scope}` and delete the page-level override — **or** revert `KpiCard` to the two-line change and drop the `KpiState` export. Not both, not neither |
| **`PF-145`** | **major** | `apps/api/src/modules/analytics/analytics.controller.ts:44` | `requireAuditDay()` throws `BadRequestException` on a malformed `from`/`to`, but story §2.2 says explicitly *malformed → treated as absent, do not 400*. `page.tsx:85`'s `safe()` collapses **every** `ApiError` to `null`, so `?to=2026-8-8` renders « Indicateurs indisponibles. Le service d'analytique n'a pas répondu » plus the « Entrées indisponibles » failure state, and « Réessayer » rebuilds the same bad URL. **A user typo is reported to a DPO as a service outage** — a G-TRUTH defect *created* by the slice whose thesis is that this surface does not lie. Compounding: the service test at `audit-kpis.spec.ts:356` asserts malformed → absent, behaviour no HTTP caller can now reach, so the suite documents two contradictory contracts |
| **`PF-146`** | **major** | `apps/worker/src/modules/exports/generators/audit-csv.generator.ts:74-77` | The 90-day default is applied with `??`, so it fires only on `null`/`undefined`. A **present-but-unparseable** `parameters.from` (`''`, `'2026-13-40'`, `'garbage'`) makes `normalizeYmd` return `null` → **no `createdAt` lower bound at all** → up to 50 000 rows of the tenant's entire history in a file labelled as a 90-day extract, with no truncation marker. This is a **regression**: the old `fromIso ? new Date(fromIso) : daysAgo(90)` used a truthy check, and `new Date('garbage')` made Prisma throw so the job failed **loudly**. Reachable end-to-end and unvalidated — `page.tsx` puts raw `sp.from`/`sp.to` into hidden fields, `actions.ts` posts them as `parameters`, and `CreateExportDto.parameters` is `@IsObject()` only. An over-broad extract carrying actor identities, IPs, user agents and before/after JSON, on a children's-data platform, under an RGPD data-minimisation surface. Fix: `normalizeYmd(fromIso) ?? zonedYmd(daysAgo(90, now), timezone)` — normalise **before** defaulting. Note the asymmetry `PF-145` creates: the *list* endpoint 400s a malformed day, the *export* of the same rows driven by the same two parameters validates nothing |
| **`PF-147`** | minor | `packages/contracts/src/audit/window.ts:267` | The non-existent-local-midnight fallback returns `first` unconditionally, which is correct only for zones **west** of UTC. Verified against a binary-search ground truth over 17 zones × 2024–2027: `Asia/Beirut` mismatches on **every** spring-forward day — helper `2026-03-28T21:00:00Z` vs true `22:00:00Z`. Paris, Santiago, Havana, São Paulo, Kiritimati, Lord Howe, New York, Gaza, Hebron, Damascus, Casablanca, Tehran, Sydney, Auckland, Kolkata and Chatham are all correct. Fix: `return lands ? second : (second > first ? second : first);` and add Beirut 2026-03-29 as a regression case. Latent today — every tenant defaults to `Europe/Paris` and no UI writes the column |
| **`PF-148`** | **major** | `AuditTable.tsx:280`, `AuditPageFilters.tsx:318` and `:351`, `page.tsx:378` | The four new controls set `focus-visible:outline-none` and replace the UA outline with `ring-blue-400/40`, compositing to **#bfdbfd — 1.42:1** on white (amber variant 1.34:1), far below the **3:1** of WCAG 2.2 SC 1.4.11, so they have **no perceivable focus state** (SC 2.4.7). Worst at `AuditTable.tsx:280`: that chevron is the **only keyboard route to the detail drawer this story just created** — the slice adds the keyboard path and then makes it invisible. For the two filter controls it is a **regression** (they previously had the browser's own ring). Fix: drop `outline-none` or pair the ring with an opaque colour + offset (`ring-blue-600` = 4.8:1; `outline-amber-700` on the amber banner). Do **not** copy `Button.tsx`'s `ring-brand-500/40` — the house pattern is itself thin |
| **`PF-149`** | **major, operator-verifiable only** | `packages/contracts/src/audit/window.ts:109-121` + `infra/docker/Dockerfile.{api,worker,web}` | `assertKnownTimezone` deliberately **throws** when `Intl` accepts a zone but resolves it to `UTC` (incomplete embedded ICU). Fail-closed is right, but `UnknownTimezoneError` is **caught nowhere in `apps/api/src`**, so it propagates to Nest's default filter → **500 on `GET /api/v1/analytics/audit` for every admin in every tenant** (all tenants share the same defaulted `Europe/Paris`); `audit-csv.generator.ts:68` runs the identical assertion so **every `audit_csv` job dies**; and `page.tsx:283` builds an unguarded `Intl.DateTimeFormat` **inside the server component render**, so a throw there is a 500 on the whole page, not the graceful « Indisponible » state this slice built. All three images are `node:22-alpine` with no full-ICU. The existing `toLocaleString('fr-FR')` calls degrade *silently*, so a shortfall would never have announced itself. **Run before merge, against the live containers:** `docker exec pilotage_api node -p "new Intl.DateTimeFormat('en-US',{timeZone:'Europe/Paris'}).resolvedOptions().timeZone + ' \| small_icu=' + process.config.variables.icu_small"` — expected `Europe/Paris \| small_icu=false`. Repeat for `pilotage_worker` and `pilotage_web`. If any prints `UTC`, this needs full-ICU images or a caught-and-reported fallback before it lands |
| **`PF-150`** | minor | `apps/api/src/modules/analytics/analytics.service.ts:3654` | `PF-123`'s read half is closed for `portal IS NULL` **only**, not for `''`. `hasNullPortal` tests `r.portal === null` while `observedPortals` filters `!!p`, so a distinct `portal = ''` row is dropped from the facet list **and** does not trigger the sentinel — leaving it reachable by no offered filter value, the exact defect class this slice claims to close. The provenance derivation added in `S-E04-1` returns a *string*, so a header/referer-derived `''` is plausible. Fix: `some((r) => !r.portal)` on both sides and decode the sentinel to `{ portal: { in: [null, ''] } }`, or normalise `''` → `null` at the write sites with a gate |
| **`PF-151`** | minor | `AuditPageFilters.tsx:203` and `:228`, `AuditTable.tsx:327` | Three a11y residuals in the new filter strip and legend. (i) The « Au (inclus) » hint span sits **inside** the `<label>` that wraps the input *and* is referenced by `aria-describedby`, so the accessible **name** becomes a 60-character sentence and the hint is announced twice; the neighbouring « Du » field is unaffected, so the two read inconsistently. (ii) The inverted-range error is mounted **together with** its `aria-live="polite"` attribute (the classic pattern that fails to announce) and is tied to neither input — no `aria-invalid`, no `aria-describedby` (SC 3.3.1 / 1.3.1). (iii) The legend's « Journalisée, non comptée » swatch is `bg-slate-400` = **2.56:1** on the `slate-50/40` band, below SC 1.4.11; and none of the three swatches matches what they explain — `StatusBadge` renders `bg-current` inside a tinted pill, so the legend teaches a mid-tone that never appears in the Action column |
| **`PF-152`** | minor | four addresses | Declarations this slice left that nothing can reach — the shape it exists to remove. (a) `analytics.service.ts:3578` `hasNullPortal` has **zero consumers**: `page.tsx` does not declare it, `AuditPageFilters` never receives it, and the signal is already derivable from `portals`. (b) `audit-kpi-state.ts:74` `KPI_UNAVAILABLE_LABEL_SUFFIX = 'Indisponible'` is **consumed by nothing** — the word reaches the screen via `KPI_UNAVAILABLE_SCOPE`, which merely *begins* with it, so the constant is a dead duplicate of a literal one line below and a drift hazard. It was deliberately **not** asserted in the gate: enshrining a dead export would make the gate green over nothing, which is the defect the gate pass had just fixed. (c) `audit-kpi-state.ts:39` declares `AuditKpiPayload.value: number \| null` and keeps a `not-instrumented` branch, but the API's `AuditKpi.value` is `number` and the contract's `Kpi.value` is `integer, minimum: 0` — **no null is representable**, so the branch is unreachable under the shipped contract. (d) `audit-kpi-state.ts:127` `describeAuditWindow` interpolates `filters.timezone` **unguarded** while `page.tsx:282` guards the same value, so a `filters` payload without `timezone` (a rolling deploy) prints « · fuseau undefined » on all four cards while the filter strip simultaneously says « Fuseau de l'établissement : non résolu » |

### The one test worth adding next

A **cross-surface agreement** test on the duplicated tenant-timezone resolution, in
`apps/api/src/shared/quality/audit-vocabulary-gate.spec.ts` (which already owns the cross-file assertions).
`analytics.service.ts:3416-3430` and `audit-csv.generator.ts:63-68` each independently do
`prisma.tenant.findUnique({ select: { timezone: true } })` followed by the **verbatim-identical** fallback. The
existing gate asserts, *textually*, that both files **call** `resolveAuditWindow` — it does not assert that both
**feed it the same zone**. That fallback is precisely the seam the story forbids opening: the page's
« Exporter en CSV » button posts the same `from`/`to` as the table above it, so if one surface ever defaults while
the other throws, the DPO gets a file that disagrees with the screen. Shape it **behaviourally**, not as another
grep: drive the real `auditList` and the real `generateAuditCsv` against the same mocked Prisma, same tenant, same
window, and assert deep-equal `createdAt` bounds for (1) `timezone: ''`, (2) `findUnique → null`, and (3) a garbage
zone where **both** must throw `UnknownTimezoneError` and neither may degrade to a default. Falsification: change
the fallback in either file to the server's zone, or make one swallow the error. DNC-08: if a surface cannot be
obtained, the test **fails and names what was missing**.

---

## `S-E04-6` — shipped 2026-08-09 · five privileged families write their audit row in the same transaction

`[api][audit][transaction][auth]` · **`G-AUDIT` primary**, G-TENANT, G-AUTHZ, G-DNC (`DNC-10`) · **`ADR-035`** ·
**P1 — needs human review, NOT auto-merged**. No schema, no migration, no `apps/web`, no `apps/worker`.

### What landed

- **One seam, and its first parameter is the invariant.** New `apps/api/src/shared/audit/write-audit.ts`
  (155 lines), re-exported from `shared/audit/index.ts` and declared nowhere else. Ten handlers across four
  families now write through it.
- **The plan's central claim was falsified, and the correction *is* the design.** `plan.md` §5, `tasks.md` note 1
  and the story all asserted that typing the first parameter `Prisma.TransactionClient` makes
  `writeAudit(this.prisma, …)` a compile error. **It does not.** `Prisma.TransactionClient` is
  `Omit<PrismaClient, ITXClientDenyList>`; `Omit` *removes* members, it does not forbid them; TypeScript is
  structural; excess-property checking applies only to fresh object literals. A full `PrismaClient` has every
  remaining member and is assignable — the invariant would have been **green because it could not fire**, which is
  the exact class of guard this epic is named after. `AuditTransactionClient` re-adds the two deny-listed members
  as optional `never`: a transaction client omits them (an optional property is satisfied); `PrismaService extends
  PrismaClient` **declares** them as methods, and a method is not assignable to `never`.
- **The brand is enforced by the one heavy gate, not by a reviewer.** `write-audit.spec.ts:223` carries a
  `// @ts-expect-error` passing a real `PrismaService`. `apps/api/tsconfig.json` includes `src/**/*` with **no**
  spec exclusion (only `tsconfig.build.json` excludes `**/*.spec.ts`, and `typecheck` does not use it), so that
  control is genuinely evaluated by `pnpm typecheck` and turns RED in **both** directions — weakening the brand
  fails, and so does removing the hole it guards. Without it, `writeAudit(this.prisma, …)` would be an
  out-of-transaction write that **every mocked spec in this diff still shows as green**.
- **Three families that wrote nothing now write.** Role grant/revoke (`identity/users.service.ts`), school
  create/update/close (`modules/schools/`), enrollment create/status-change/transfer/cancel
  (`modules/enrollments/`). A privilege could be conferred, an establishment closed and a child moved out of their
  class with no trace at all; `/admin/audit` now sees all ten decisions.
- **`assessment.publish` moves onto the seam and gains provenance it never had.** It was the *one* site already
  writing inside its transaction, so it is the site that proves the seam does not weaken what already worked — and
  it previously carried no `actorRole`, no `portal`, no IP/UA. That is **`PF-123`'s write half, at that one site**.
- **Provenance is derived before every `$transaction` opens**, on all ten handlers, via
  `deriveAuditProvenance(jwt, extractAuditClientHints(req))`. That ordering is `S-E06-6`'s rule and it is
  load-bearing: `AuditLog.ipAddress` is `@db.Inet`, so a failed cast *inside* the transaction would roll back the
  mutation the row exists to trace — audit hygiene becoming an availability failure for the write itself.
- **Vocabulary grows in exactly one place.** `packages/contracts/src/audit/vocabulary.ts`: 3 resource types
  (22 → **25**) and 9 actions (48 → **57**), zero copies in `apps/web`. `enrollment` **returns** as a label
  `S-E04-4` had deleted as orphaned — not a reversal of that decision but its completion (it was orphaned only
  because the enrollment decision was untraced), and `S-E04-4`'s by-name assertion was **amended with the reason**
  rather than removed.
- **The vocabulary gate learned the seam, and its floor was redefined rather than raised.** `EXTRACTED.seams` now
  counts *direct `auditLog.create` writes* **+** *shared-seam calls*, floor **30**, so `S-E04-7`'s migration
  conserves the total by construction and cannot read as a regression. Plus a V-1 uniqueness assertion (exactly
  **one** exported `writeAudit` under `apps/api/src`, resolved repo-wide), a per-family named recovery, and an
  in-memory falsification that deletes a family's call and watches the pair go RED.
- **`provenance-callsites.spec.ts` now drives the real `PermissionsGuard`** for the denial cases instead of only
  asserting metadata — a genuine strengthening, not a widening.
- **`ADR-035` ships** — D1 brand · **D2 fail-closed** · D3 pre-transaction sanitisation · D4 provenance carried,
  not re-derived · D5 fan-out stays outside · D6 vocabulary/seam · **D7 `PF-96` stated, relation untouched** ·
  D8 DNC-10 · D9 what it does not claim · **D10 (added in this land pass) the three behaviour changes**.

### Executed, not asserted

| Claim | Command | Observed |
|---|---|---|
| The repo typechecks, **including the brand control** | `pnpm typecheck` | **`13 successful, 13 total`** in **2m27s**, cache **miss** — `@pilotage/api` really executed `tsc --noEmit && tsc --noEmit -p prisma/tsconfig.json`, so `write-audit.spec.ts:223`'s `@ts-expect-error` was genuinely evaluated |
| The four family harnesses + the seam | jest on the 5 new specs | **`76 tests green`** |
| The vocabulary gate + the AC-8 authz table | jest on the 2 amended AST specs | **`123 tests green`** |
| Whitespace / line-ending hygiene | `git diff --check` | exit **0**, no output. `git diff --check` cannot see untracked files, so a separate trailing-whitespace grep was run over the six new source files: **clean** |
| Scope (FR-12 / AC-5) | `git status` on `apps/web`, `apps/worker`, `apps/api/prisma` | **zero** files |

**The honest limit of that evidence, stated rather than dressed up:** all eight rollback tests run against a
hand-written staging fake for `$transaction`. **Nothing here exercises real Prisma.** Same class of limit as
`PF-135` last slice — the typecheck is what makes the in-transaction claim more than a mock's opinion.

### `AC-4` — the finance clause is **vacuous today**, and that is a measurement

`ls -d apps/api/src/modules/*/ | wc -l` = **26 modules under `apps/api/src/modules`, none of them finance**
(`ADR-018` defers it). The criterion is therefore **NOT ticked**; it is armed by `S-E04-7`'s gate, whose walk root
is declared to include the module *before* it exists, so it is covered by default rather than by someone
remembering. **Two documents carried 25** — `S-E04-6.md:390` and the implementer's own note; `ADR-035` D9 carried
**26** and is the one that is right. The story's figure is stale and is left on the record here rather than
back-edited, because `AC-4` exists precisely so this number is a measurement and not a claim.

### Two blockers the gate/panel found, and they were one defect

**`ADR-035` and the code it documents lived in two different checkouts.** All nine modified and six new source
files were uncommitted in the **main** repo; `ADR-035-audit-in-transaction.md` existed only, untracked, inside the
worktree `.claude/worktrees/vigorous-cannon-d1d65a/`. A PR cut from the main checkout would have shipped a new
cross-cutting pattern — a branded in-transaction seam, plus the decision that an audit-write failure aborts the
mutation — **with no ADR** (GUARDRAILS §2), leaving all 16 in-code `ADR-035` references dangling and FR-9 / AC-5
unmet. Fixed by moving the **ADR to the code** (one file operation) rather than the code to the ADR (which would
have relocated 15 uncommitted files and the green typecheck evidence across trees to move one markdown file). The
stray worktree copy was **deleted**, not left in place: the duplicate was itself the trap that produced the
finding. Verified afterwards — exactly one `ADR-035*` path in the tree, and `035` is genuinely free
(`docs/adr/` holds `001`–`004`, `013`–`028`, `036`, `037`).

### Corrected in this land pass — an ADR that asserted a closure the code refuses

`ADR-035` D9 read: *"`users.service.assignRole` never checks that the role belongs to the caller's tenant … the
**new path this slice adds must close it**, with a foreign-tenant negative per G-TENANT."* The shipped code rules
the other way and says so at `users.service.ts:63-72`, and `users.service.spec.ts:214-246` has G-TENANT negatives
for a foreign `userId` and a foreign `userRoleId` — **none for a foreign role**. The code's ruling is the right
one (`Role` has no `tenantId`; tenancy runs `schoolId → School.tenantId`, and `schoolId: null` means global — a
tenant filter on a global catalogue, added inside an audit slice, is a visibility change dressed as a fix). **The
ADR was corrected, not the code**, and the gap is registered as `PF-153`. An ADR recording a check that does not
exist is worse than one recording the gap, because the next slice reads it as done.

### `G-TENANT` / `G-AUTHZ` — what is asserted

Every one of the ten handlers keeps its cross-tenant guard **before** `$transaction` opens, so a refused request
opens no transaction and writes no row: `enrollments` `create` (student **and** classSection), `update`,
`transfer` (current **and** target), `remove` (both branches); `schools` `update`, `remove`; `assessments.publish`
(plus `assertOwnership`); `users.service` `assignRole` (target profile), `revokeRole` (via
`ur.userProfile.tenantId`). Every audit row carries **the caller's** `tenantId`, never the target's — pinned at
`users.service.spec.ts:247`. No `@RequiresPermission` was added, widened or removed. No child PII widening: the
`before`/`after` payloads carry uuids, statuses, role slugs and school codes — no names, no grades, no guardian
data.

### Behaviour changes, named rather than discovered — now `ADR-035` D10

1. **`revokeRole` is idempotent.** Previously an unconditional `update` that moved `revokedAt` forward on an
   already-revoked assignment; now guarded on `revokedAt: null`, returning `current` (the record minus the joined
   `userProfile`/`role`). Pinned by a test — but it is a response-path change on an auth path inside an audit
   slice, which is why it is in the ADR now. Its own limit is `PF-157`: the guard is a read *before* the
   transaction, so concurrency defeats it.
2. **The no-op rule is applied to roles and not to the other three families** — `school.update`,
   `enrollment.status_change` and `enrollment.cancel` on an already-`dropped` enrollment each write a row for an
   identical-value request, and two of the three are `critical`. `PF-158`.
3. **`enrollment.transfer` files under `closed.id`**, where the story §2.3(c) said `opened.id`. The code's
   reasoning is better (the operator acted on the enrollment they transferred out of; `after` carries both ids) —
   the **story** is the document that is wrong, and `S-E04-7` must not "correct" it back.

### Not claimed by this slice

| Claim | Status | Owner |
|---|---|---|
| **That `writeAudit` is the only door** | **It is not.** Measured on this branch after the change: **27 direct `auditLog.create` call sites across 15 files** still bypass the seam, `identity/roles.controller.ts` among them — the exact defect the seam's own docstring cites as its motivation. The seam is the default for anything *new*; nothing yet stops a 28th | **`S-E04-7`** — pinned-inventory gate |
| **That `action` / `resourceType` are constrained to the declared vocabulary** | **They are typed `string`.** `apps/api` already depends on `@pilotage/contracts`, so D1 made "in the same transaction" a compile-time property while D6 — "the code is declared" — rests on a Jest AST walker plus an unenforceable convention (D6.2: *call it with an inline object literal*). A pre-built variable typechecks green and drops out of the written set | `S-E04-7` — the panel's one judgement call |
| **That real Prisma was exercised** | **NOT MEASURED.** Every rollback test runs against a hand-written `$transaction` staging fake | `PF-135`-adjacent |
| **That the transfer's *second* write rolling back the first is covered** | **NOT COVERED.** All four family harnesses inject failure through one boolean that throws on the **first** entity write; `transfer` is the only handler with two sequential entity writes. This is the cell the 8-test matrix cannot reach, and it is the one property the array→interactive conversion had to preserve | see *The one test worth adding next* |
| **That `/admin/audit` renders the 12 new labels** | **NOT OBSERVED**, and there is a build-order trap: `packages/contracts` builds to **CJS**, so the new French labels reach the page only after a contracts rebuild. A reviewer testing against a stale `dist` sees raw codes and misdiagnoses | `PF-135` / `PF-142` |
| **That the finance clause is satisfied** | **Vacuous** — 26 modules, none finance. Not ticked | `V3-E15` |
| **That `PF-96` is addressed** | **Stated, not changed** (`ADR-035` D7). `AuditLog` still has no FK to `Tenant`; a reflex cascade would let a tenant deletion erase its own audit history | a later slice |

### The one test worth adding next

**`transfer` is atomic across its two writes** — `apps/api/src/modules/enrollments/enrollments.controller.spec.ts`.
The capacity pre-check (`target._count.enrollments >= target.maxStudents`) runs **outside** the transaction, so a
concurrent enrolment can fill the target section between the check and `tx.enrollment.create`. That is the one
live path where the second write fails after the first succeeded, and if the `transferred_out` update did not roll
back, **a child is transferred out of their class and into nothing** — enrolled nowhere, children's data, the
RGPD-relevant harm this epic exists to prevent. Make the fault addressable (`entityOnCall?: number` in `makeDb`,
defaulting to call 1 so the four existing cases are untouched), expose `tx`, then assert: the call rejects, both
`entities()` and `auditRows()` are empty, **and** — the vacuity guard — `tx.enrollment.update` and
`tx.enrollment.create` were each called once, so the empty arrays are a rollback and not a transaction that never
opened. Falsification: hoist the close onto `this.prisma.enrollment.update(...)` before `$transaction` opens and
this test alone goes red. Expected to **pass as written** — it is insurance against a future tidy-up of
`transfer`, not a live defect. Second priority: the pinned-inventory gate described under *Next slice* above.

### Raised by this slice

| Finding | Severity | Where | What |
|---|---|---|---|
| **`PF-153`** | major | `apps/api/src/modules/identity/users.service.ts:85` | `assignRole`'s role lookup is unfiltered and **stays** unfiltered; `ADR-035` D9 was corrected to say so. Latent today (`roles.controller.ts:120` creates every custom role `schoolId: null`), live the moment `ADR-013`'s school-scoped roles land — at which point `GET /roles` is a cross-tenant catalogue disclosure and `POST /users/:id/roles` a cross-tenant grant. Owner `V3-E05` / `ADR-013` |
| **`PF-154`** | P2 | `apps/api/src/modules/enrollments/enrollments.controller.ts` (`transfer`) | The capacity check is a **TOCTOU read outside the transaction**. Pre-existing, not introduced here. The correct fix is a conditional `create` or a unique constraint, not a longer transaction. Owner `S-E04-7` or `V3-E05` |
| **`PF-155`** | major | `apps/api/src/modules/schools/schools.controller.ts:78`, `:203` | `PATCH /schools/:id { status: 'closed' }` closes a school through `update()` — bypassing `DELETE`'s students / academic-years refusal — and is filed as `school.update`; re-opening has no code at all. Both codes are `critical`, so the KPI count is unaffected and only the **attribution** is wrong. The bypass is pre-existing; the fidelity gap is created here, because this is the slice that declares `school.close` to be THE closure code |
| **`PF-156`** | major | `users.service.ts` + `shared/auth/user-sync.service.ts:80-84` | `roles.assign` self-escalation: no ceiling check, no `isSystem` refusal, and `effectivePermissions` unions every non-revoked assignment. Pre-existing; **now audited** (`role.grant`, critical) rather than silent. `ADR-035` D9 carries it with an owner |
| **`PF-157`** | minor | `users.service.ts:137` (and `:89` for the sibling) | Both idempotency guards read **before** `$transaction` opens, so two concurrent revokes both pass and write two `critical` rows for one revocation. `@@unique([userProfileId, roleId, schoolId])` cannot back them up — `schoolId` is `null` and PostgreSQL treats NULLs as distinct. In-scope fix: `tx.userRole.updateMany({ where: { id, revokedAt: null } })` and branch on `count` |
| **`PF-158`** | minor | `schools.controller.ts:203`, `enrollments.controller.ts:288` | An identical-value `PATCH` writes a `critical` row with byte-identical `before`/`after`, while the same diff suppresses it for roles. « Modifications critiques » counts clicks rather than decisions — the KPI two slices just made honest |
| **`PF-159`** | minor | `schools.controller.ts:208` | `school.update`'s `before`/`after` record `name`, `timezone`, `locale`, `status` and **omit `address`** — the fifth and only structurally interesting field the handler can change. An address-only PATCH writes a critical row whose diff is empty in every recorded field, on the one field where the row is the sole surviving record of the previous value. `parseAddress` is already in the file at `:58` |
| **`PF-160`** | minor | `apps/api/src/shared/audit/write-audit.ts` | `shared/audit/` stopped being framework-free: this is the first production file there to import `@nestjs/common`, and it embeds user-facing French copy (`AUDIT_WRITE_FAILED_MESSAGE`, justified by `SchoolsManager.tsx` rendering `res.error` verbatim). It re-throws, so DNC-10 holds — but when `S-E04-7` points ~27 more sites at the seam, including worker/queue paths, a 500 and « L'opération a été annulée » is the wrong shape. Prefer a plain typed `AuditWriteFailedError` in the seam, mapped to HTTP at the filter layer |
| **`PF-161`** | minor | `provenance-callsites.spec.ts:23` | The new `SchoolsController` import breaks `import/order` alphabetisation (`schools` must sort **after** `school-structure`: at segment 3, `s` = 115 vs `-` = 45), adding a 10th ESLint warning to `apps/api` against a `lint-warning-baseline.json` ceiling of 9 — `node scripts/lint-ratchet.js` enforces the ceiling in both directions and would exit 1. One-line move |
| **`PF-162`** | nit | `write-audit.ts:2` | `import { Prisma }` is a value import for a type-only use; `import type` is correct |

### Documentation debt this land pass did **not** close

`docs/daily-improvement-v3/architecture-impact.md` §4 still lists `ADR-035` in the **reservations** table now that
the file exists, and `dependency-map.md` does not yet carry the `writeAudit` seam or the redefined `SHARED_SEAMS`
floor. Neither dangles — that file's own precedence rule (line 99) states a number is claimed by the first file
committed under `docs/adr/`, never by a reservation, so `docs/adr/` already wins. Recorded so the next run flips
reserved → written rather than re-deciding it. Note also that `ADR-035` and `S-E04-6.md` cite the register as
*"`architecture-impact.md` §4"* without a path: it lives under `docs/daily-improvement-v3/`, **not** under
`docs/spec/features/v3-e04/`.

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
| **That `/admin/audit` renders after `S-E04-4`** | **NOT OBSERVED.** `S-E04-2` measured the authenticated render *once*, before this diff. Every web claim in § `S-E04-4` is pure-function or textual: `scripts/web-artifact-check.js` proves the route is *emitted*, nothing proves it *renders*. The diff puts a React element into `SelectOption.label` across the RSC boundary and a string into a numeric KPI slot — both legal, neither executed. `PF-135` names the ~25-line Playwright spec that would settle it | `PF-135` / a later slice |
| **That the tone/icon a row is painted with follows the declared vocabulary** | **IT DOES NOT.** `AuditTable.tsx` kept an inline substring predicate that no test covers, and two declared-critical actions already fall through it to `neutral`. Stated here because the slice's headline claim is *one declaration, every consumer reads it* — three consumers do; a fourth was left behind | `PF-134` |
| **That the built CJS `packages/contracts/dist` still resolves under test** | **NO TEST CHECKS IT ANY MORE.** Both jest configs now read contracts *source*. The artefact was verified **by hand** in this run (`dist/index.js` and `dist/audit/index.js` both resolve, `AUDIT_PORTALS.length === 4`); that is a one-off observation, not a gate | `PF-142` |
| **That the legacy alias table is exhaustive on live data** | **NOT MEASURED.** It was derived from the pre-fix seed. No `SELECT DISTINCT action, resource_type FROM audit_log` was run against a deployed tenant, and the routine has no hosted credentials | operator / `PF-143` |
| That `ADR-035` / `036` / `037` are free numbers | Checked against `docs/adr/` (holds `001`…`028`) and `architecture-impact.md` §4 (reserves `029`…`035`) **on 2026-08-08**. Each slice must **re-check immediately before creating its file** and record any renumber — the precedence rule `S-E02-18` installed (`PF-110`) makes `docs/adr/` the register of record | each owning slice |

---

## Findings ledger

| Finding | State after this run | Note |
|---|---|---|
| `PF-14` | **open** — specced | Split into an **open measurement** (does the page render authenticated?) and a confirmed dead link. Both owned by `S-E04-2` |
| `PF-31` | **open** — closed at the **8 + 9 literal sites**, *not* across `apps/api/src` | All 8 `actorRole` literals and all 9 `portal` write literals are gone, plus two anonymous inline derivations the intake had not measured; a `super_admin` minting a role is now audited `super_admin`, and a blocking spec keeps it that way. **This row read "the actor-role half is closed in `apps/api/src`" until the escalation panel falsified it** — see § *Three residuals inside the walk root* below. **Still open:** `PF-121` (`packages/imports-core`), **`PF-122`** (`child-claims.service.ts` parametrises both fields), **`PF-123`** (`assessments.controller.ts` writes neither), all owner `S-E04-7`. **The missing-row half is CLOSED by `S-E04-6`** — the three `M-33` families (role grant/revoke, `modules/schools/`, `modules/enrollments/`) now write, across ten handlers, each inside its own transaction and through the one seam. **The transactionality half is closed at those ten handlers only, not as a class:** 27 direct `auditLog.create` sites across 15 files still bypass `writeAudit`, `roles.controller.ts` among them, and nothing yet stops a 28th. Owner `S-E04-7`, whose pinned-inventory gate turns the remaining 27 into a countdown that can only go down |
| `PF-32` | **CLOSED** by `S-E04-4` (vocabulary half) + `S-E04-5` (scope half) | The three disagreeing populations became one declaration in `packages/contracts/src/audit/` with a both-directions gate (`S-E04-4`). `S-E04-5` closed the remaining three: the KPI/table scope mismatch (**one** `where`, spread into every KPI count with `AND: [...]`, so `eventsInRange === total` is structural), the `to` filter excluding its own day (`resolveAuditWindow`, exclusive `lt` at tenant-local midnight), and the `null`-portal facet row (`AUDIT_PORTAL_NONE`, offered only when observed). **One residual, tracked separately:** the sentinel covers `portal IS NULL` but not `portal = ''` — `PF-150` |
| **`PF-134`** | **CLOSED** by `S-E04-5` | `auditActionTone` is now declared in `packages/contracts/src/audit/labels.ts` and read by `AuditTable.tsx`; the inline substring matchers are deleted, and the gate asserts `AuditTable.tsx` contains no `.includes(` on the action string. The two measured misses are pinned by name: `auditActionTone('coefficient.upsert') === 'danger'` and the same for `grade.unflag`. **One recorded reversal:** tone is *derived* (`critical → danger`, `export → info`, else `neutral`) rather than explicitly declared per action as §2.6 asked, which silently removes green and amber from the Action column — see § `S-E04-5` → *Deviations*. Original text, kept for the record: `AuditTable.tsx`'s `pickActionTone` / `pickActionIcon` are a **fourth** audit vocabulary the slice left behind — inline substring matchers (`création\|publish\|approve`, `suppression\|delete`, …) sitting next to the declaration they were supposed to replace. It is **already wrong on real data**: `coefficient.upsert` and `grade.unflag` are declared `critical: true`, are counted by the « MODIFICATIONS CRITIQUES » card, and contain none of the tokens the predicate looks for — so they fall through to `neutral`. The card says a critical change happened; the row for it is painted unremarkable. The new seed makes it reachable, because STEP 13 now writes canonical codes where it previously wrote French strings that *did* match. **This is the single highest-value follow-up test** — parse `pickActionTone` with the AST walker the gate spec already imports, assert every `AUDIT_CRITICAL_ACTIONS` code hits a `danger`/`warning` literal, positive-control against `LEGACY_AUDIT_CRITICAL_ALIASES`. The fix that follows is small and in keeping with `ADR-037`: give `AUDIT_ACTIONS` a declared tone (or derive it from `critical`/`export`) and delete the last inline vocabulary |
| **`PF-135`** | **open — and now recurring for a second consecutive slice** | `S-E04-5` also drove no browser. It is the slice that removed a KPI key, added a three-state card derivation, added a portal sentinel to a client filter strip, and changed the table's tone source — all on `page.tsx`, all evidenced pure-function or textually. `AC-13` is therefore recorded **NOT OBSERVED** for `S-E04-5` too, with this finding as owner. The ~25-line Playwright spec is now worth strictly more than when it was first proposed: it would settle `AC-3`'s rendered half, `AC-9`'s rendered half (`PF-144`), and `PF-149`'s web third in one run. Original text: **Nothing in this diff executes `/admin/audit`.** All web evidence is pure-function or *textual* (a marker string appears in the component source). That is on the one route in the product that returned **HTTP 500 for every admin** three commits ago (`PF-14` / `S-E04-2`), and this diff introduces a pattern the page never used: a **React element** passed as `SelectOption.label` from a server component across the RSC boundary into a client filter, plus a KPI value that moves from `number` to `number \| string`. It typechecks and *should* render — "should render" is exactly the claim `PF-14` falsified. `apps/web/tests/e2e` has **zero** references to audit. Fix: one ~25-line Playwright spec on the existing `adminPage` fixture asserting status 200, « Non instrumenté », « Format hérité » and that the facet listbox opens — converting three currently-textual acceptance claims into executed evidence and re-arming the `PF-14` tripwire |
| **`PF-136`** | **open** — raised by the escalation panel and by the a11y lens | **Three consumers, two disagreeing merge rules for a mixed-vocabulary row.** `AuditDetailDrawer.tsx` resolves `auditVocabularyExplanation(action) ?? auditVocabularyExplanation(resourceType)` — action wins — so a row with a **legacy** action and an **unknown** resource type prints « Enregistrée avant l'unification du vocabulaire », claiming historic provenance for a brand-new undeclared code. That is precisely the error class `ADR-037` D4 exists to remove. The table does the cautious thing (`describeNonCanonicalFields` picks `unknown` when any axis is unknown) and the worker has `weakerVocabulary()` for the same merge. Second, in the same mechanism: the resource-type marker is wrapped `aria-hidden`, so a screen-reader user browsing the table cell-by-cell hears « Notes » and **nothing** about the value being outside the declared vocabulary — the entire regulatory signal, absent from the accessibility tree. Fix: resolve and render **per field**, and lift `weakerVocabulary` into `packages/contracts/src/audit/labels.ts` so the three consumers cannot disagree |
| **`PF-137`** | **CLOSED** by `S-E04-5` | Both documents were reconciled **against shipped code**, in the same diff, per `D-E04-5-1` and `D-E04-5-2`. `openapi.yaml`: `Kpi` is now `required: [value, scope, label]` with `label` declared; `sensitiveExports` reads the **action-set** criterion; the `Portal` parameter enum carries `__none__` with its server-side decoding; `AuditFacetsResponse` declares `hasNullPortal`. `data-model.md`: D-22 gains `label`, the §3.6 `sensitiveExports` row is corrected and carries the measurement table that decided it (the structural criterion would drop **51 of 52** export rows, including the legacy fixture row), and **`D-25` is written** — it was cited by `schema.prisma:256` and by the migration header and existed at no address. `ADR-034` is explicitly **not** claimed: `architecture-impact.md` §4 reserves the canonical KPI envelope for `V3-E03`, and both files now say so. Original text: The epic's own `contracts/openapi.yaml` (`AuditKpis`) and `data-model.md` `D-23` are **stale against shipped code**: they specify `adminLogins` removed and replaced by `distinctActors` in four `{value, scope}` envelopes, while `S-E04-4` ships `adminLogins: number \| null`. Both are defensible — the story mandated the interim shape — but leaving a contract file disagreeing with the code, inside an epic whose thesis is *no surface may assert what it cannot justify*, is the defect at the doc layer. Same file, same problem for `sensitiveExports`: the contract defines it structurally (`resourceType = 'export_job'`), the shipped code defines it by action, and the two genuinely disagree on the seeded legacy fixture row |
| **`PF-138`** | **CLOSED by deletion** — `S-E04-5` | The branch is **gone**, not re-scoped: `adminLogins` is removed from the response, the card is replaced by « Acteurs distincts », and the re-armable query no longer exists, so there is no longer a branch that can lose its portal scope. `audit-provenance-gate.spec.ts`'s zero-`portal: 'admin'` assertion therefore stays armed and did **not** need flipping. `AC-4`'s in-product half is `page.tsx:419`, which names **`V3-E05`** (owner of `PF-26`, the session lifecycle) as the owner of real login/session auditing; this ledger entry is its documentary half. Original text: The re-armable `adminLogins` branch **lost the `portal: 'admin'` scope** the deleted query carried: `where: { tenantId, action: { in: AUDIT_LOGIN_ACTIONS } }` behind a card labelled « CONNEXIONS ADMIN ». Unreachable today (the list is empty) — but its own comment says adding a code is the whole change, so the slice that instruments login makes an RGPD governance card over-report parent, teacher and student logins. Sharpened by the inverted gate: `audit-provenance-gate.spec.ts` now asserts **zero** `portal: 'admin'` literals in `apps/api/src`, so restoring the correct scope means flipping that gate back, and a future author hits RED first |
| **`PF-139`** | **half closed** by `S-E04-5`; the rendering half is **not** | **Closed:** the outage/instrumentation conflation. `resolveAuditKpiState` (`apps/web/src/app/admin/audit/audit-kpi-state.ts`) derives **three non-overlapping** states — `measured` / `not-instrumented` / `unavailable` — from a `responseMissing` flag that is distinct from a served `value: null`, so an analytics outage can no longer render as an affirmative claim about the audit log; `KPI_UNAVAILABLE_DISPLAY = '—'`, never `0`, and the gate asserts it is not a zero. **Not closed:** the clipping half. `KpiCard` grew the `state`/`scope` props and the state-word typography branch that would fix it, and **nothing passes them** — see `PF-144`. « Non instrumenté » still renders at `font-mono text-3xl`. Original text: `KpiCard` renders `value` at `font-mono text-3xl font-bold` inside `overflow-hidden`, with `min-w-0` on the *label* group only. « Non instrumenté » has a min-content width of ~11 mono chars at 30 px and cannot break mid-word; at the page's own `xl:grid-cols-4` the card's inner width is smaller than that, so the value or the « CONNEXIONS ADMIN » label is **clipped, not ellipsised** — and it worsens at 200 % zoom (SC 1.4.10 / 1.4.4). Every other string value in the codebase is short (`28/35`, `92%`). Second, same card: `page.tsx`'s `safe()` swallows every `ApiError` to `null` and the fallback hard-codes `adminLogins: null` — the **same sentinel** that means "not instrumented" — so an analytics outage renders as an affirmative claim about the audit log. Fix: `value="—"` with the phrase in the wrapping `children` sub-label, and a `kpisUnavailable = resp === null` flag distinct from the instrumentation gap |
| **`PF-140`** | **open** — regulator-facing artefact | Three things about the DPO CSV, none asked for by an AC. (i) `action_label`, `resource_type_label` and `vocabulary` are inserted **mid-header**, not appended, and a UTF-8 BOM is now prepended — any index-based or `created_at`-keyed downstream parser breaks. (ii) The single `vocabulary` column is `weakerVocabulary(action, resourceType)`, collapsing two axes, so a regulator cannot tell **which** value was unclassified — while the epic contract models vocabulary per entry, and the file already carries per-axis label columns. (iii) **Latent, not live:** the BOM promotes the file from "text" to "document French Excel opens as a spreadsheet", and `csvEscape` only quotes on `[",\n]` — it does not neutralise a leading `=`/`+`/`-`/`@`/tab, nor a bare `\r`. No exported column is reachable free text **today**, but `audit_log.user_agent` is a raw client header one column away. Fix: append `action_vocabulary` / `resource_type_vocabulary` at the end, and neutralise leading characters before any slice widens the export |
| **`PF-141`** | **open** — minor, but it is a user-visible contradiction | The table's action badge now renders `action.label` and the **raw stored code appears nowhere in the row**, while the action filter is still a free-text `contains` match against the raw column. A user who sees « Suppression d'un rôle » and types it gets zero rows. This also contradicts the invariant the rest of the slice states explicitly — the drawer renders the raw code under the title precisely because *« le libellé est posé au-dessus de la valeur réelle, il ne la remplace jamais »*, and the CSV keeps the raw column for the same reason. The table is the one surface that dropped it. Fix: a small monospace raw line under the badge, or resolve the query term through `AUDIT_ACTIONS` into an `OR` of codes |
| **`PF-142`** | **open** — test-infrastructure drift, repo-wide | Both `apps/api/jest.config.js` and `apps/worker/jest.config.js` now map `@pilotage/contracts` to `packages/contracts/src`. The rationale is correct and documented (`test-ratchet.js` spawns jest with `cwd: appDir`, bypassing turbo's `test → ^build`, so specs would otherwise read a stale git-ignored `dist/`) — but the consequence is that **no test in the repository verifies the built CJS artefact any more**, while `audit-csv.generator.ts` value-imports the resolvers at **module load** and sits in the worker's Nest graph. The stated compensating control (`pnpm --filter @pilotage/contracts build` as a landing prerequisite) is a human habit, and with GitHub Actions still billing-locked nothing automated backs it. Fix: make `pnpm --filter @pilotage/contracts build && node scripts/boot-check.js` a repeatable pre-merge step, or restore one spec that resolves the built package |
| **`PF-143`** | **open** — a measurement that was not taken | The frozen legacy alias table (5 actions, 8 resource types) is derived from the **pre-fix seed**, not from live data, yet the KPI predicates now depend on it being exhaustive. Any pre-V3 French value a deployed tenant carries outside those 13 resolves `unknown`, renders « Code non répertorié » instead of « Format hérité », and — for actions — silently leaves the `criticalChanges` count. Concretely: the old predicate listed `'Révision'` and `'revise'`; both were dropped with no alias replacing them. Nothing in this slice ran `SELECT DISTINCT action, resource_type FROM audit_log` against a real tenant. Fix: an operator step (or a one-off script) diffing the live distinct sets against `LEGACY_AUDIT_*_ALIASES` **before** the DPO sees a « Code non répertorié » |
| `PF-96` | **open** — referenced, **posture now stated** by `S-E04-6` | `ADR-035` D7 states it: `AuditLog` has no foreign key to `Tenant` and audit rows outlive their tenant. The relation is **untouched**, deliberately — a reflex cascade would let a tenant deletion erase its own audit history. Stated, not changed, which is all this epic ever owed it |
| **`PF-153`** | **open** — raised by `S-E04-6`; owner `V3-E05` / `ADR-013` | `users.service.ts:85` — `assignRole`'s role lookup is unfiltered and stays so; `Role` has no `tenantId` and its tenancy runs `schoolId → School.tenantId`, with `schoolId: null` meaning global. **`ADR-035` D9 originally asserted that this slice closes it; the text was corrected in the land pass to record the deferral, with `Role.schoolId` named as the tenancy path.** Latent today because `roles.controller.ts:120` creates every custom role with `schoolId: null`; live the moment `ADR-013`'s school-scoped roles land, at which point `GET /roles` (`roles.controller.ts:70`, unfiltered, full permission-code set) is a cross-tenant catalogue disclosure and `POST /users/:id/roles` a cross-tenant grant. Fix: `role.schoolId === null \|\| role.school.tenantId === tenantId`, **plus** the foreign-role G-TENANT negative the spec suite does not yet have |
| **`PF-154`** | **open** — raised by `S-E04-6`, **pre-existing**; owner `S-E04-7` / `V3-E05` | `enrollments.controller.ts` `transfer` — the capacity check (`target._count.enrollments >= target.maxStudents`) is a **TOCTOU read outside the transaction**. Not introduced here and not widened here; it is registered because `S-E04-6` is the slice that made the two writes atomic and therefore the slice that makes the remaining race legible. Fix: a conditional `create` or a unique constraint — **not** a longer transaction |
| **`PF-155`** | **open** — raised by `S-E04-6` | `schools.controller.ts:78` / `:203` — `UpdateSchoolDto` exposes `status?: SchoolStatus` (`active \| closed`), so `PATCH /schools/:id { status: 'closed' }` closes a school through `update()`, **bypassing `DELETE`'s students / academic-years refusal**, and is filed as `school.update`. Re-opening has no code at all. Both codes are `critical`, so the « Modifications critiques » count is unaffected — only the **attribution** and the coverage claim are. The bypass is pre-existing; the *fidelity* gap is created here, because this is the slice that declares `school.close` to be THE closure code. Fix: choose the action from the observed transition inside the transaction, or drop `status` from the DTO — with a test, since `schools.controller.spec.ts` exercises `update` only with a name change |
| **`PF-156`** | **open** — raised by `S-E04-6`, **pre-existing**; `ADR-015` territory | `users.service.ts` + `shared/auth/user-sync.service.ts:80-84` — any `roles.assign` holder can `POST /users/:ownProfileId/roles` with any role id from the global catalogue and self-grant its entire permission set; `effectivePermissions` unions every non-revoked assignment with **no ceiling**, and `isSystem` roles are not refused. This slice does **not** widen it (both cross-tenant guards kept and now tested) and deliberately does not close it — a silent authz change inside an audit slice is exactly what the epic exists to prevent. What changes: the escalation is now **recorded** (`role.grant`, critical). Fix, when taken: the grantor's `effectivePermissions` must be a superset of the granted role's, plus an explicit `isSystem` refusal for non-`super_admin` grantors |
| **`PF-157`** | **open** — raised by `S-E04-6` | `users.service.ts:137` (and `:89` for the sibling in `assignRole`) — the new `revokedAt !== null` idempotency guard is a **TOCTOU**: the read happens before `$transaction` opens, so two concurrent `DELETE /users/roles/:id` calls both pass, both update, and both write a `critical` `role.revoke` for one revocation, with `revokedAt` holding the retry's clock — the precise defect the guard was added to close. No database backstop: `@@unique([userProfileId, roleId, schoolId])` cannot deduplicate because `schoolId` is written `null` and PostgreSQL treats NULLs as distinct. In-scope fix: `tx.userRole.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: now } })` inside the transaction, branch on `count === 0`. The partial unique index `(user_profile_id, role_id) WHERE revoked_at IS NULL` is a schema change and is deferred |
| **`PF-158`** | **open** — raised by `S-E04-6` | `schools.controller.ts:203`, `enrollments.controller.ts:288` — the no-op rule is applied **inconsistently across the four families in one diff**. `assignRole`/`revokeRole` skip the row when nothing changed; `school.update` (whose DTO is entirely optional, so `PATCH {}` validates), `enrollment.status_change` and `enrollment.cancel` on an already-`dropped` enrollment each write a `critical` row with byte-identical `before`/`after`. A double-clicked control or a client retry therefore inflates « Modifications critiques » with non-events — the KPI `S-E04-4` and `S-E04-5` spent two slices making honest. Fix: mirror the role guard, and add the two no-op cases beside the existing AC-14 tests |
| **`PF-159`** | **open** — raised by `S-E04-6` | `schools.controller.ts:208` — `school.update`'s `before`/`after` record `name`, `timezone`, `locale`, `status` and **omit `address`**, the fifth and only structurally interesting field `update()` can change (it can also **erase** it via `Prisma.DbNull`). An address-only PATCH writes a critical row whose rendered diff is identical in every recorded field, on the one field where the audit row is the sole surviving record of the previous value. `parseAddress` is already in the file at `:58` |
| **`PF-160`** | **open** — raised by `S-E04-6`, architectural | `apps/api/src/shared/audit/write-audit.ts` — that directory stopped being framework-free: this is the first production file there to import `@nestjs/common` (`provenance.ts` and `client-hints.ts` import only `node:*` and siblings), and it embeds user-facing French copy (`AUDIT_WRITE_FAILED_MESSAGE`), justified because `SchoolsManager.tsx:32,41,52` renders `res.error` verbatim in a red inline banner. It also contradicts story §2.1 (*"Body: one `tx.auditLog.create`. Nothing else. **No** `try`/`catch`"*) — it re-throws, so DNC-10 is intact and it is covered by W-2/W-4, but the deviation must be legible. When `S-E04-7` points ~27 more sites at the seam, including worker/queue paths with no HTTP response, a 500 and « L'opération a été annulée » is the wrong shape. Fix: a plain typed `AuditWriteFailedError` in the seam, mapped to HTTP at the controller/filter layer |
| **`PF-161`** | **open** — raised by `S-E04-6`, CI hygiene | `provenance-callsites.spec.ts:23` — the new `SchoolsController` import is out of alphabetical order: `eslint-plugin-import`'s `alphabetize` compares path segments, and at index 3 `'schools'` vs `'school-structure'` compares `s` (115) against `-` (45), so `school-structure/*` must sort **first**. That is a 10th ESLint warning in `apps/api` against `scripts/lint-warning-baseline.json`'s ceiling of 9 (all nine currently `no-unused-vars`), and `scripts/lint-ratchet.js` enforces the ceiling in **both** directions — so it would exit 1. Every other new/moved import in the diff was checked and is correctly ordered. One-line move, below the three `school-structure/*` imports and above `students/student-access.service` |
| **`PF-162`** | **open** — nit, raised by `S-E04-6` | `write-audit.ts:2` — `import { Prisma }` is a value import used only for types (`Prisma.TransactionClient`, `Prisma.InputJsonValue`); `import type` is correct |
| `PF-121` | **open** — raised and registered by `S-E04-1` | The two `tx.auditLog.create` calls in `packages/imports-core/src/engine.ts` still hard-code both provenance fields, on a call path with no JWT (the worker drains a BullMQ job). Deliberately out of `S-E04-1`'s scope: `AC-2` is scoped to `apps/api/src`, and a job-written row needs provenance captured at *enqueue* plus a ruling on what portal a job acted through. Owner `S-E04-7` |
| **`PF-122`** | **open** — raised by the escalation panel, registered by this land pass | `child-claims.service.ts:722-729` is a **fourth decision site inside `apps/api/src`**: `actor: 'parent' \| 'admin' = 'parent'` → `actorRole: actor`, `portal: actor`, with the literal `'admin'` passed at `:522`/`:609`. A `super_admin` approving a guardianship claim is audited **`actorRole: 'admin'` — not a realm role at all**, so `/admin/audit`'s role facet carries a fifth orphan token no label map knows. Invisible to all four gate matchers by construction. Owner `S-E04-7` |
| **`PF-123`** | **write half CLOSED at the publish site** by `S-E04-6`; **still open** elsewhere | `S-E04-6` moved `assessments.controller.ts` publish onto the shared seam, so that row now carries `actorRole`, `portal`, `ipAddress` and `userAgent` derived from `deriveAuditProvenance` before the transaction opens. Story FR-7 authorised it and the reasoning is sound (the line was being edited anyway) — but note the boundary this crosses: the *Next slice* handover above reserved `PF-121`/`PF-122`/`PF-123` write halves for `S-E04-7` and said *"do not absorb the write halves to finish it"*. **Only the publish site was absorbed**; `PF-121` (`packages/imports-core`), `PF-122` (`child-claims.service.ts`) and the remaining `PF-123` sites stay with `S-E04-7`, and this row is the amendment that keeps the two documents from disagreeing. Original text: `assessments.controller.ts:290` writes `assessment.publish` with **no `actorRole` and no `portal` key** — grade publication records no actor role, and a `null` portal is reachable by **no** offered `/admin/audit` filter value (the facet list is built `where: { portal: { not: null } }`, `analytics.service.ts:3358-3364`). Owner `S-E04-7` |
| **`PF-128`** | **closed** by `S-E04-3` | `ADR-036`'s Context table named **one** `apps/web` server seam; there are **two** (`lib/api-client.ts` and `app/api/proxy/[...path]/route.ts`). A one-seam fix would have left every client-component-driven audited write blank forever, undetectably. Both seams now call the single `clientProvenanceHeaders` helper; the ADR's Context table is corrected in the same diff (`R-30`) |
| **`PF-129`** | **open** — raised by `S-E04-3` | `apps/web/src/app/parent/register/actions.ts:25` is a **third** server-side fetch to the API that bypasses the helper. Latent (no audit row on that path today); becomes `PF-31` again the moment one is added. **No web-side gate exists** — "every server-side fetch to `API_URL` goes through `clientProvenanceHeaders`" is asserted in prose and enforced nowhere. Owner `S-E04-7` |
| **`PF-130`** | **open** — raised by `S-E04-3` | `infra/nginx/conf.d/pilotage.conf:103` does not strip the three `x-pilotage-*` headers, so they are accepted from the public edge. One-header self-anonymisation by any authenticated actor, indistinguishable from an honest blank, nothing logged; and any leak of `AUDIT_FORWARD_TOKEN` becomes internet-facing forgery rather than an internal-network risk. Owner: infra / `S-E04-7` |
| **`PF-131`** | **open** — raised by `S-E04-3` | `infra/nginx/conf.d/pilotage.conf:116` (`/api/v1/notifications/stream`) sets no `X-Forwarded-For`, so hop depth there is 1 against a pin of 2. Latent today; the `N = 2` pin is the security argument and it does not hold uniformly. Owner: infra |
| **`PF-132`** | **open** — raised by `S-E04-3` | Both `.env` examples ship an `AUDIT_FORWARD_TOKEN` **placeholder**, the token is not in `REQUIRED_ENV`, no gate has a rule for it, and no test covers its value. A publicly-known token turns « null rather than wrong » into « plausible and wrong ». Fix belongs at the read site (`main.ts` → `configureAuditClientHints`), plus a one-way `production-artefact-check.js` row. Owner `S-E04-7` |
| **`PF-144`** | **open** — raised by `S-E04-5`, **merge condition** | Two new public `@pilotage/ui` props with **zero call sites**, and the concept built three times in one commit. `KpiCard` gained `state?: KpiState` + `scope?: ReactNode` (`packages/ui/src/index.ts` exports `KpiState`); `apps/web/.../page.tsx:207`, the only caller, passes **neither** — it re-derives the states in `audit-kpi-state.ts`, routes scope through `children`, and hand-rolls the amber ring. Live consequences: an outage card stamps `data-state="measured"`; `asStateWord` is unreachable so « — » / « Non instrumenté » keep `font-mono text-3xl` — the exact half of `PF-139` the DS change was written to fix; and with `scope` undefined the delta placeholder renders a **second** grey `—`. The story capped this file at *"two lines, no API change"* (§2.5) and §7 forbids pre-empting `ADR-034`. **Decision a human owns:** wire `state`/`scope` and delete the page-level override, **or** revert `KpiCard` and drop the `KpiState` export. Not both, not neither |
| **`PF-145`** | **open** — raised by `S-E04-5`, **merge condition** | `analytics.controller.ts:44` `requireAuditDay()` 400s a malformed `from`/`to`, which story §2.2 explicitly rules out (*"treated as absent, do not 400 — out of scope"*). `page.tsx:85`'s `safe()` collapses every `ApiError` to `null`, so a hand-edited or bookmarked `?to=aout` renders « Indicateurs indisponibles. Le service d'analytique n'a pas répondu » **plus** the « Entrées indisponibles » failure state, the shortcut chips and date `max` bounds disappear, and « Réessayer » loops on the same URL. Nothing names the bad parameter, so the operator reports an outage that does not exist. The page already proves it can distinguish a bad *question* from a bad *service* (`rangeInverted`); a malformed date bypasses that path. `audit-kpis.spec.ts:356` still asserts the lenient service behaviour, so the suite now documents two contradictory contracts, and there is no `analytics.controller.spec.ts` at all. **Either** revert to lenient (matches §2.2, costs nothing) **or** keep the 400 *and* ship a controller test plus a 4xx-vs-dead-service distinction in `safe()`. Keeping it silently is the one option that must not merge |
| **`PF-146`** | **open** — raised by `S-E04-5`, **merge condition, RGPD** | `audit-csv.generator.ts:74-77` applies the 90-day default with `??`, so a **present-but-unparseable** `parameters.from` (`''`, `'2026-13-40'`) skips the default, `normalizeYmd` returns `null`, and `auditWindowCreatedAtFilter` emits **no lower bound** — the DPO receives up to 50 000 rows of the tenant's entire history in a file labelled as a 90-day extract, with no truncation marker. A **regression**: the old truthy check made `new Date('garbage')` an Invalid Date that Prisma rejected, so the job failed loudly. Reachable and unvalidated end-to-end (`page.tsx` hidden fields → `actions.ts` → `POST /api/v1/exports`, whose `parameters` is `@IsObject()` only), and `audit-csv.generator.spec.ts` has no malformed-input case. Fix: normalise **before** defaulting; ideally validate `parameters.from`/`to` at job creation with the same rule the list endpoint now uses, and add the negative test (`from: 'garbage'` ⇒ `gte` equals the 90-day default, never `undefined`) |
| **`PF-147`** | **open** — raised by `S-E04-5` | `window.ts:267` — the non-existent-local-midnight fallback returns `first` unconditionally, correct only for zones **west** of UTC. Measured against a binary-search ground truth over 17 zones × 2024–2027: `Asia/Beirut` is wrong on every spring-forward day (helper `2026-03-28T21:00Z` vs true `22:00Z`); all 16 other zones tested are correct. Effect for such a tenant: rows written 23:00–23:59 local on the 28th are counted as the 29th — in the table, in all four KPIs, and in the regulator's CSV; symmetrically `to` drops the last hour of a day the UI labels « inclus ». Fix: `lands ? second : max(first, second)`. Latent today (every tenant defaults to `Europe/Paris`, no UI writes the column). Related: **T1c is nominally green over a dead branch** — only Paris and the fixed-offset `Pacific/Kiritimati` are under test, so neither reaches `secondOffset !== firstOffset` and the story's own falsification (*"remove the second offset read"*) stays green |
| **`PF-148`** | **open** — raised by `S-E04-5`, a11y | Focus-visible contrast on the four new controls. `focus-visible:outline-none` + `ring-blue-400/40` composites to **#bfdbfd — 1.42:1** on the white card, 1.38:1 on the blue chip, 1.34:1 amber; WCAG 2.2 SC 1.4.11 requires **3:1**, so there is no perceivable focus state (SC 2.4.7). Worst at `AuditTable.tsx:280` — the chevron is the **only keyboard route to the detail drawer this story created**. `AuditPageFilters.tsx:318`/`:351` are a **regression** (they had the UA ring). `page.tsx:378` (« Réessayer ») fails on a control that appears only during an outage, i.e. exactly when a keyboard user is hunting for it. Fix: drop `outline-none`, or pair with an opaque colour + offset (`ring-blue-600` 4.8:1; `outline-amber-700` on the banner). `Button.tsx`'s `ring-brand-500/40` is itself thin — do not copy it |
| **`PF-149`** | **open** — raised by `S-E04-5`, **merge condition, operator-verifiable only** | Full ICU on `node:22-alpine` is **asserted and never measured**, and the slice fails closed on it. `window.ts:109-121` throws `UnknownTimezoneError` when `Intl` resolves an accepted zone to `UTC`. That error is **caught nowhere in `apps/api/src`** → 500 on `GET /api/v1/analytics/audit` for **every admin in every tenant** (all share the defaulted `Europe/Paris`); `audit-csv.generator.ts:68` runs the same assertion so every `audit_csv` job dies. **Correction to the escalation panel's third claim, verified this pass:** `page.tsx:283` is *not* unguarded — it is `resolvedTimezone ? new Intl.DateTimeFormat(…) : …`, so a null/blank zone is handled. What it is *not* guarded against is a zone the runtime cannot resolve, and that formatter sits **inside the server component render**: under reduced ICU it would either throw `RangeError` (→ 500 on the whole page, not the « Indisponible » state this slice built) or silently resolve to `UTC` and compute a wrong « aujourd'hui » bound for the date inputs' `max`. **Neither branch was measured**, which is the finding — the web third is a smaller risk than the panel stated, not an absent one. All three images are `node:22-alpine`; no `NODE_ICU_DATA`, no `full-icu`, no `apk add icu-data-full` repo-wide. This diff is the **first server-side `Intl` use with a `timeZone` option** in `apps/api`/`apps/worker` — the existing `toLocaleString('fr-FR')` calls degrade *silently*, so a shortfall would never have announced itself. Check: `docker exec pilotage_api node -p "new Intl.DateTimeFormat('en-US',{timeZone:'Europe/Paris'}).resolvedOptions().timeZone + ' \| small_icu=' + process.config.variables.icu_small"` (expect `Europe/Paris \| small_icu=false`), repeated for `pilotage_worker` and `pilotage_web` |
| **`PF-150`** | **open** — raised by `S-E04-5`; owner `S-E04-7` with `PF-123`'s write half | `analytics.service.ts:3654` — `PF-123`'s read half is closed for `portal IS NULL` only. `hasNullPortal` tests `r.portal === null` while `observedPortals` filters `!!p`, so a distinct `portal = ''` row is dropped from the facet list **and** does not raise the sentinel: reachable by no offered filter value, the exact class this slice claims to close. Plausible because `S-E04-1`'s provenance derivation returns a *string*. Fix: `some((r) => !r.portal)` on both sides and decode the sentinel to `{ portal: { in: [null, ''] } }`, or normalise `''` → `null` at the write sites and gate it |
| **`PF-151`** | **open** — raised by `S-E04-5`, a11y | Three residuals in the new filter strip and legend: the « Au (inclus) » hint sits inside its `<label>` **and** is `aria-describedby`-referenced (60-char accessible name, hint announced twice, inconsistent with the « Du » field); the inverted-range error mounts **with** its `aria-live` region and is tied to neither input (no `aria-invalid`, no `aria-describedby` — SC 3.3.1 / 1.3.1); the legend's third swatch is `bg-slate-400` = 2.56:1 (SC 1.4.11) and none of the three swatches matches `StatusBadge`'s actual `bg-current`-in-a-tinted-pill rendering, weakening the SC 1.4.1 mitigation the legend exists to provide |
| **`PF-152`** | **open** — raised by `S-E04-5` | Four declarations that nothing can reach — the DNC-09 shape, reintroduced one layer up. (a) `analytics.service.ts:3578` `hasNullPortal`: **zero consumers**, already derivable from `portals`. (b) `audit-kpi-state.ts:74` `KPI_UNAVAILABLE_LABEL_SUFFIX`: **zero consumers**; the word reaches the screen only via `KPI_UNAVAILABLE_SCOPE`, which begins with it — a dead duplicate of a literal one line below, and a drift hazard. Deliberately **not** asserted in the gate: enshrining a dead export would make the gate green over nothing. (c) `audit-kpi-state.ts:39` `AuditKpiPayload.value: number \| null` and its `not-instrumented` branch are **unreachable under the shipped contract** (`Kpi.value` is `integer, minimum: 0`), so FE and BE declare the same wire object differently. (d) `audit-kpi-state.ts:127` `describeAuditWindow` interpolates `filters.timezone` unguarded where `page.tsx:282` guards it, so a rolling deploy prints « · fuseau undefined » on four cards while the strip says « non résolu » |
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
