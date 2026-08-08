# V3-E04 — Audit trail and governance surfaces

**Layer** L0 · **Size** M · **Closes** `PF-14`, `PF-31`, `PF-32` · **Gate** `G-AUDIT` (primary)
**Depends on** `V3-E02` (`code-complete` 2026-08-08 — dependency satisfied) · **Blocks** `V3-E03`, `V3-E11`
**Risks** `R-10` (accepted), `A-01` (permanent) · **Referenced, not fixed:** `PF-96`

**Status (2026-08-08, after the `epic-spec` run)** — **`specced`. Nothing is implemented. No slice has shipped.**
This run wrote `spec.md`, `plan.md`, `data-model.md`, `contracts/openapi.yaml`, `ux.md`, `tasks.md`, `quickstart.md`
and this file. It edited **no** file under `apps/`, `packages/`, `prisma/schema.prisma` or `scripts/`. Every acceptance
criterion below is **open**. Every gate below is described by **how it will be evidenced**, never as met.

> ### ▶ Next slice → **`S-E04-1`** — Shared audit provenance: one home, one decision, one real actor role
>
> `[api][audit][adr]` · size **M** · `G-MIGRATION` **does not trigger** · ships **`ADR-036`** · **blockedBy** nothing.
>
> Start at `tasks.md` § `S-E04-1`, whose **first task is T-0**: move `sanitiseInetOrNull`, `truncateUserAgent`,
> `MAX_USER_AGENT_LENGTH` and `deriveAlertActorProvenance` out of the `calendar` and `alerts` **feature** modules into
> a new `apps/api/src/shared/audit/` — first, so that a second copy is never written. Then the 8 literal `actorRole`
> sites and the 9 literal `portal` sites, then `ADR-036`.
>
> **Do not start with `S-E04-8`.** The chain is last by product ruling, not by convenience — see the ordering note
> below. Run `quickstart.md` §5 before writing code: the measurement table is meant to be **falsified**, not trusted.

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

## Slice backlog (`tasks.md` is the contract; nothing below has started)

| Story | Title | State | blockedBy | `G-MIGRATION` | ADR |
|---|---|---|---|---|---|
| **`S-E04-1`** | Shared audit provenance: one home, one decision, one real actor role | **`todo`** ◀ **next** | — | no | **`ADR-036`** |
| `S-E04-2` | `/admin/audit` measured under authentication; `/admin/reports` stops being a dead link | `todo` | — | no | — |
| `S-E04-3` | The operator's real IP and User-Agent reach the API — or the field stays blank | `todo` | `S-E04-1` | no | — |
| `S-E04-4` | One canonical audit vocabulary, declared once, in `packages/contracts` | `todo` | `S-E04-2` | no | **`ADR-037`** |
| `S-E04-5` | The KPIs share the table's scope, and the `to` filter includes its own day | `todo` | `S-E04-4` | **YES** (`Tenant.timezone`) | — |
| `S-E04-6` | Five privileged families write their audit row **in the same transaction** | `todo` | `S-E04-1`, `S-E04-3` | no | **`ADR-035`** |
| `S-E04-7` | The remaining call sites move onto the seam, and a blocking gate keeps them there | `todo` | `S-E04-6` | no | — |
| `S-E04-8` | The hash chain from a declared genesis, its verification, and the documented gap | `todo` | `S-E04-3`, `S-E04-6`, `S-E04-7` | **YES** | `ADR-035` *(amendment)* |

**8 slices · 8 `todo` · 0 in progress · 0 shipped.** State vocabulary: `todo` → `in-progress` → `shipped`
(or `blocked`, with the blocking decision id). A slice moves to `shipped` only when its own acceptance criteria are
evidenced in its PR — never because the code merged.

**The ordering is a product ruling, not a convenience.** The decision work (`ADR-036`) is first and the chain is last.
A chain computed over an `actorRole` that is a literal, an `ipAddress` that is the web container's and a `userAgent`
that is null on every UI-driven write would be a **cryptographically verifiable record of falsehoods** — strictly
worse than the honest blank the epic's own principle demands (*« une provenance absente, jamais une provenance
fausse »*), because a verified chain is believed. An autonomous run optimising for a satisfying deliverable would
build the chain early. It must not.

---

## Not claimed (kept honest — the whole point of this file)

| Item | Why it is not claimed | Who can close it |
|---|---|---|
| **Anything about `/admin/audit` rendering** | The authenticated render was **not performed** this run — the live probe 307s to login. `PF-14` is open **in both directions**: the static read found no crash, which is not the same as finding it works | `S-E04-2`, by an authenticated render |
| **Every acceptance criterion `AC-1`…`AC-12`** | This was a **docs-only** run. No code, no schema, no script was touched. Nothing is implemented | each owning slice |
| **Every gate** | `spec.md` §8 states how each **will** be evidenced. None is met. `G-AUDIT` in particular needs a rollback test in **both** directions **per family**, and none exists | each owning slice |
| The pinned hop count for `trust proxy` | **NOT MEASURED.** The real Traefik → nginx → api hop depth was not established this run. `ADR-036` cannot be written from this document alone — it needs the topology measured first | `S-E04-1` |
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
| `PF-31` | **open** — specced, and **narrowed by measurement** | The blanket "actor role is hard-coded" is true at **8 of 28** sites, not all; "role and school mutations write no audit row" is true of role **grant/revoke**, schools and enrollments, while role create/update/delete *are* audited (just not transactionally) |
| `PF-32` | **open** — specced, and **widened by measurement** | Four defects plus the vocabulary split (`spec.md` §1.3). Owned by `S-E04-4` + `S-E04-5` |
| `PF-96` | **open** — referenced, not fixed | Posture to be stated in `ADR-035` |
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
