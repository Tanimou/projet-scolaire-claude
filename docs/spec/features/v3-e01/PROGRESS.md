# V3-E01 — Tenant isolation and identity resolution

**Layer** L0 · **Size** L · **Depends on** `V3-E02` (reviewed migrations + restore rehearsal must exist first —
satisfied: `S-E02-3` done 2026-08-07) · **Blocks** `V3-E03`, and transitively every layer above
**Closes** PF-01, PF-02, PF-18, VAL-02, VAL-04 · **Gates** G-TENANT, G-AUTHZ, G-MIGRATION · **DNC** DNC-10
**Epic brief** [`docs/daily-improvement-v3/epics/V3-E01-tenant-isolation.md`](../../../daily-improvement-v3/epics/V3-E01-tenant-isolation.md)

**Status (2026-08-14)** `in-progress` — **five partial slices and THREE whole ones landed**: `S-E01-2` (one of its three
thirds), `S-E01-2b` (the policies on the 44 tables that carry a `tenant_id`, proven to refuse for a real non-owner
role — but **not** the connection cutover), `S-E01-2c` (the FK-path policies on the **five** tenant-DERIVED tables,
plus `ADR-042`), `S-E01-2d` (`outbox_event`'s denormalised `tenant_id`, plus `ADR-044`), `S-E01-1a` (the identity seam
stops inventing a tenant — `PF-01` half (a)), **`S-E01-3`** (the two-tenant adversarial suite at
catalog-enumerated breadth, plus `ADR-045` — the epic's first slice to land **whole**, and it closes **`VAL-02`'s DATABASE half** — the application half stays open, see the ledger)
and **`S-E01-1b`** (the cutover's REFERENCE SURFACE — the authorization join `app_user` could not complete, `role`
re-classified as tenant-derived rather than global, plus `ADR-046`; the second slice to land whole, and still **not**
the cutover) and **`S-E01-1c`** (the cutover's **WRITE** surface — `app_user` may edit a CUSTOM role, and a SYSTEM
role is made unwritable **by the database** through six `AS RESTRICTIVE` per-command policies, plus `ADR-047`;
the third slice to land whole, closing `PF-193`, and **still not** the cutover)
and — **2026-08-15** — **`S-E01-1d`** + **`S-E01-1d (b)`** (the tenant scope **SEAM**: a second, non-owner
`PrismaClient` on `DATABASE_URL_APP`, `calendar` converted as the first module whose handlers run inside
`withTenant`, and `AC-9` redefined from scope *openings* to attributed *call sites*, landing on a truthful
`[LIMIT]` of **6 scoped + 113 enumerated / 794 across 226 files**, plus `ADR-048`; **still not** the global cutover —
`DATABASE_URL` is untouched — and its executed proof has **not yet run green**, see the section below)
and — **2026-08-15** — **`S-E01-5`** (the epic’s first slice that **closes a leak** rather than building the machinery
to close leaks: `calendar_event`’s four **mono-column** scope FKs are proven OWNED by a
`findFirst({ where: { id, tenantId } })` issued on the scope’s own `tx`, **inside** `this.scope.run(...)`, before the
write — PostgreSQL evaluates referential integrity **outside** row security, so no policy ever refused a foreign
`cycleId` and `list`’s `include` rendered another tenant’s cycle name in the **parent** portal; plus `ADR-049`, an
in-place amendment of `ADR-048 §D3`’s statement budget, and the boot-probe closure gaining `academic_year` under a
test that now derives it from the controller’s real call sites. **Closes `PF-204`’s CREATABLE half only** — nothing
looks at rows already written, that is `PF-205`, whose PROD census is `unmeasured`; **no migration, no `schema.prisma`,
no `apps/web` file**)
and — **2026-08-15** — **`S-E01-4a`** (the **fourth OIDC client**: `D-02` decided by operator override, the
`student → parent` client alias **deleted** rather than emptied, one shared accessor
`apps/web/src/lib/keycloak-clients.ts` behind all three `auth.ts` seams *and* the reset link, `portal-student` +
the missing `student` realm role added to `infra/keycloak/realm-export.json`, and `infra/kc-prod-redirects.mjs`
stopped binding two portals to one client and stopped writing a cross-portal `/api/auth/callback/*` wildcard; plus
`ADR-050`, amending `ADR-021` in place. **Closes `PF-18`**; **`VAL-04` stays open** — no live Keycloak ran, `TOOL-19`
— and the slice's own executable gate `AC-6`/`AC-7` is **not built**, so the invariant has no ratchet. This slice is
**orthogonal to the tenant work**: no `apps/api` file, no Prisma query, no migration).
and — **2026-08-15** — **`S-E01-4b`** (the **ratchet** the `S-E01-4a` paragraph above says was missing:
`scripts/keycloak-client-check.js`, an **unconditional TIER-1** `ci-gate.sh` stage mirrored into `ci.yml`, and
`ADR-052`. It closes the `GATE_MACHINERY` hole that made `apps/web/src/lib/keycloak-clients.ts` invisible to the only
spec asserting `PF-18` stays fixed, and it **derives** its expectation by *executing* the accessor, because `PF-18`'s
shape was an alias **inside a function body** that no constant-lifting parser can see. **`VAL-04` still stays open** —
`docker info` exits 1 on this host, so nothing live ran and `scripts/keycloak-live-probe.js` ships **written and never
executed**; **`AC-9` is unmet** (`infra/docker-compose.yml` is not in the diff); and **the ratchet has no executable
negative control of its own** (`PF-225`). No `apps/api` runtime file, no Prisma query, no migration).
**⚠️ Correction, same date: the sentence that opens this section and its slice count are STALE in a second way** —
~~`S-E01-1e` landed (run 61) and has its own section below, but was never added to this list, and `bmad/roadmap.md`'s
ledger table has no row for it at all.~~ **REPAIRED 2026-08-15 (run 63): `S-E01-1e` now has a *Slice status* row
here and a row in `bmad/roadmap.md`, added retroactively and marked as such.** Count the *Slice status* table, not
this paragraph — that instruction stands, and it is why the repair was made in the table rather than in this
sentence.
and — **2026-08-15** — **`S-E01-1f`** (`announcements`' five mono-column scope FKs proven **OWNED** before the write,
`computeRecipients` made structurally incapable of returning a foreign `userProfileId`, and the ownership helpers
extracted into `shared/prisma/scope-fk.ts`; plus `ADR-053`, superseding `ADR-049 §D5`. **Closes `PF-208`** — the
first instance of this defect class to reach a cross-tenant **WRITE** — and corrects its recorded severity in **both**
directions. **NOT a conversion:** no `withTenant`, no `APP_ROLE_REQUIRED_PRIVILEGES` entry, `24 + 120 / 803`
unmoved, `PF-02` unmoved. Its **read** half is one third done — see the section below).
The epic is **not** `shipped`, and **four** sentences must not be misread:

1. **The running application is still not RLS-isolated**, and no policy slice changed that. It connects as
   `pilotage`, the table owner; `FORCE ROW LEVEL SECURITY` is deliberately absent; the remaining step is a
   **connection cutover**, which belongs to `S-E01-1`.
   > **Annotated 2026-08-15 by `S-E01-1d`, and the correction is narrow.** The default connection is still the owner
   > and this sentence still holds for the application as a whole. What changed is that **one module** — `calendar` —
   > now runs its four handlers on a **second**, non-owner client **when `DATABASE_URL_APP` is declared against a
   > migrated database**; absent that variable it stays in `degraded_no_app_url` and behaves exactly as before. The
   > cutover is therefore no longer a single event to be scheduled: it is a per-module migration with a measured
   > counter (`6 + 113 / 794`) and a named refusal state. `S-E01-1` still owns the **global** `DATABASE_URL` flip.
2. **Policy coverage is now complete in the catalog sense — 53 of 55 base tables** (45 by `tenant_id` column,
   **7** by FK path after `S-E01-1b` made the derivation **transitively** closed, and **1** auto-discriminant:
   `tenant` itself, under `id = <GUC>`). The residue is **two** tables — `permission` (global reference data) and
   `_prisma_migrations` (the ledger) — each outside **by name and with a reason** (`ADR-042 §D4`, `ADR-046 §D1`).
   *(This paragraph read `50 … 45 + 5`, residue of five, until `S-E01-1b`; `role` and `role_permission` moved from
   the residue into the derived set, and `tenant` into a class of its own.)* **No base table is outside all three
   classes any more** — that was `outbox_event`, and the `outbox_event` finding is closed. Complete coverage is
   *not* isolation; see (1).
3. **After `S-E01-1a`, the tenancy of a request is resolved rather than invented — but a subject with no profile is
   still admitted through `@RequiresPermission`.** `permissions.guard.ts:28` unions realm-role permissions without
   requiring a `UserProfile`, so the refusal only bites where the handler body calls `ensureUser`. That is `PF-165`
   half (b), its own slice, and it is the reason `S-E01-1a` closes half of a finding and not a gate.
4. **`VAL-02`’s DATABASE half is closed and `G-TENANT` is not.** `S-E01-3` proves the shipped policies deny at **catalog-enumerated
   breadth** — 50 tables × 4 verbs × both directions, positive control first, one mutant killed by execution — and
   that is exactly the validation `VAL-02` asked for. It is **not** a statement about the running application, and the
   suite refuses to let it be read as one: on its GREEN path it prints four `[LIMIT]` lines, two of them headed
   `THE APPLICATION IS NOT READY TO CUT OVER`. **Do not let a green check erase that.** A gate that is green because
   the property it guards is unreachable from the request path is the shape sentence (1) describes, and this suite is
   built to *name* that shape rather than inherit it.

> **⚠️ Finding-id collision, recorded 2026-08-14 (run 55) as `TOOL-30`.** `S-E01-1a` and `S-E01-2c`/`S-E01-2d` were
> written by parallel runs that could not see each other's unmerged PRs, and they allocated **`PF-185`, `PF-186` and
> `TOOL-27` twice each**, for six genuinely different findings. `PF-01` half (b) forks out as `PF-185` *in the
> registration sense*; the `outbox_event` finding closed here is `PF-185` *in the tenancy sense*. Both rows are kept
> in `OPEN.md` with a collision banner. **Until `TOOL-30` renumbers them, read the description, never the number.**

> **What `S-E01-2d` changed, stated because the count moved without a number being edited.** `TENANT_COLS` went from
> 44 to 45 and `DERIVED_EXPECTED` stayed at 5, both read from the catalog, so the agreement
> `RLS_ON == TENANT_COLS + DERIVED_EXPECTED` went from `44 + 5` to `45 + 5` on its own. That is the first real
> exercise of the form `ADR-042 §D3` was built for; the earlier slices could only assert that it *would* behave so.
> It is also the first slice of the three to touch `schema.prisma`, so the `prisma generate` RED trap (`P-05`) is
> **armed and closed inside the same diff** — the two earlier slices avoided it only because policies and grants are
> not modellable in Prisma, and that avoidance was never available to a column.

> **This file is new on 2026-08-11.** The epic had no `PROGRESS.md` and no `docs/spec/features/v3-e01/` directory at
> all, because no `S-E01-*` slice had ever landed. `docs/daily-improvement-v3/stories/sprint-02.md` **does not exist**
> — `sprints/sprint-plan.md` §"Sprint 02" enumerates the four `S-E01-*` slices as bullet lines and nothing more, so
> none of them has a written story contract. `S-E01-2` authored its own in-run, the same posture as `S-E05-2`.

> **Why there is no `spec.md` here.** Same posture as [`v3-e02`](../v3-e02/PROGRESS.md),
> [`v3-e05`](../v3-e05/PROGRESS.md) and [`v3-e06`](../v3-e06/PROGRESS.md): the epic brief in
> `docs/daily-improvement-v3/epics/V3-E01-tenant-isolation.md` already carries objective, scope, out-of-scope, data
> impact, edge cases, 10 acceptance criteria, test strategy and rollout. Re-authoring that as a `spec.md` while a
> P0-adjacent finding was open would be ceremony. This file is the epic's status ledger.

## Slice status

| Story | Title | State | Run | Evidence |
|---|---|---|---|---|
| **S-E01-1a** | The identity seam stops **inventing** a tenant — `ensureUser` refuses an unprovisioned subject instead of upserting a `demo` tenant around it | 🟡 **shipped in part — 2026-08-14, ⚠️ NOT auto-merged (P1 · `[auth][security][tenancy]`)** — [`stories/S-E01-1a.md`](./stories/S-E01-1a.md) | 53 | **Evidence, executed:** `jest apps/api/src/shared/auth/user-sync.service.spec.ts` **22/22 pass** (new file, 470 lines — before it the tenant origin of the whole API had *no* test); `jest src/modules/identity src/shared/quality src/shared/auth` **1717 pass**; `pnpm typecheck` **13/13 exit 0** with `@pilotage/api` a genuine cache miss that compiled the changed sources and `prisma/seed-demo.ts`; `git diff --check` exit 0; `node scripts/production-artefact-check.js` **green** (it went RED mid-run on two *comments* naming the demo slug — rule `A4` scans raw source, comments included — and both were reworded, not exempted). **Closes `PF-01` half (a)** only. Deletes `DEMO_TENANT_SLUG` + the creation branch from `user-sync.service.ts:9,38-56`; refuses with an exported `UnprovisionedUserError` (`403`, `code: ACCOUNT_NOT_PROVISIONED`, one French sentence for all three refusal reasons) and **writes nothing** while refusing, proven on the fake client's call record rather than only on the thrown error. Ships **`ADR-043`**. **Three refusal branches shipped where the story specified one** (`no-match`, `ambiguous-email`, `email-bound-to-another-subject`) — tested (T-4/T-5/T-6), reconciled into `ADR-043` §D7. **Half (b) stays open as `PF-185`; `PF-186` records the unscoped email lookup.** No schema change (`G-MIGRATION` does not trigger), no cutover, no `pending` enum. **Four residuals a human owns — see [`S-E01-1a` — what landed, and the four residuals](#s-e01-1a--what-landed-and-the-four-residuals)** |
| **S-E01-1b** | The connection cutover's **REFERENCE SURFACE**: `app_user` can complete an authorization join, and `role` stops being mis-classified as global | 🟢 **shipped — 2026-08-14** — proven by execution | 56 | **Evidence, executed against real PostgreSQL:** `node scripts/rls-isolation-check.js` → **`RLS ISOLATION: PROVEN for the non-owner role`, exit 0, 165 assertions**. The fail-before / pass-after pair, both halves run: the join `user_profile -> user_role -> role -> role_permission -> permission` raises **`permission denied for table role`** on the ledger *without* this migration and returns **`AUTHZ_JOIN|1`** with it (and `AUTHZ_JOIN_FOREIGN|0`). Census agreement moved **`45 + 5` → `45 + 7 + 1 = 53`** with **no literal edited**: the derivation became a recursive CTE and a third catalog-derived term (`AUTODISC|tenant`) joined it. `A_SEES_B_ROLE|0` / `B_SEES_B_ROLE|1`; **`A_SEES_B_ROLEPERM` went `1` → `0`** (a cross-tenant read measured under a bare grant, closed before it shipped); system role visible under A, under B and under **no** context, with the school-scoped one invisible as its control; `NOCTX_TENANTS|0` (no enumeration oracle, no `SECURITY DEFINER` function); `_prisma_migrations` readable with and without a context. **E-8 mutation check: 3 predicate defects injected, 3 killed** — and the FIRST run of it killed only 2, which is what forced the `pg_get_expr` **owner-side predicate evaluation** into existence. Rollback EXECUTED (`AFTER_POLICIES\|0`, `AFTER_RLS\|0`, `AFTER_GRANTS\|0`, `AFTER_ROLE_FK\|0`, `AFTER_ROLE_INDEX\|0`); scratch DB dropped and verified. Ships **`ADR-046`**, amends **`ADR-042 §D2/§D3`** in place. Records **`PF-191`** (closed), **`PF-192`** (closed), **`PF-193`** (open). **No cutover, no `DATABASE_URL` change.** See the section below |
| **S-E01-1c** | The connection cutover's **WRITE SURFACE**: `app_user` may edit a **CUSTOM** role, and a **SYSTEM** role becomes unwritable **by the database** rather than by a handler | 🟢 **shipped — 2026-08-14, ⚠️ NOT auto-merged (P1 · `[schema][security][authz][migration][rls][tenancy][db-grants]`)** — [`stories/S-E01-1c.md`](./stories/S-E01-1c.md) | 57 | **Evidence, executed against real PostgreSQL:** `node scripts/rls-isolation-check.js` **×2** → `RLS ISOLATION: PROVEN for the non-owner role`, exit 0, byte-stable across both runs; `node scripts/tenant-adversarial-check.js` → green, **791 call sites classified over 167 `(table, privilege)` pairs, 165 satisfied**; `pnpm typecheck` → exit 0, 13/13, `@pilotage/api` a genuine cache **miss** that ran `tsc --noEmit && tsc --noEmit -p prisma/tsconfig.json`; `git diff --check` exit 0, extended by `--no-index` over the three untracked files. `apps/api/prisma/migrations/20260814210000_role_write_surface_rls/migration.sql` (487 lines, hand-written, ADR-027/G-MIGRATION) grants `INSERT, UPDATE, DELETE` on `role` and `INSERT, DELETE` on `role_permission`, under **six** `AS RESTRICTIVE`, per-command, `TO PUBLIC` policies named `system_role_write_guard_{insert,update,delete}` on each table. **`schema.prisma` is NOT touched** — no column, no constraint, no index — so the `prisma generate` RED trap (`P-05`) is **not armed**, the first `V3-E01` migration since `S-E01-2c` for which that is true, and it is a measurement (no `schema.prisma` hunk in the diff), not a hope. The load-bearing assertions genuinely fired: **`WRITE_GUARD_PERMISSIVE == 0`** (a guard that lost `AS RESTRICTIVE` would **OR** with `tenant_isolation` and allow every write, silently), `TOTAL_POLICIES == POLICIES + 6` (the six are invisible to every `polname = 'tenant_isolation'` census term, so they get their own), the six-policy `WRITE_GUARD_SHAPE` set equality, `DERIVED_DELETE_NAMES` set-equal to `['role','role_permission']` (`ADR-042 §D5`'s zero becomes a **named** two, `ADR-047 §D4`), **AC-8b mutant killed by execution** (`before=1, weakened=0, restored=1`), and the header rollback **executed** with `tenant_isolation` surviving and both tables reading back exactly `SELECT`. Ships **`ADR-047`**; amends `ADR-042 §D5`; supersedes one clause of `ADR-046 §D5`. **Closes `PF-193`** and **`TOOL-32`**; **records `PF-194` (P1)** and **`PF-197` (P2)**. **The harness falsified the spec that commissioned it:** `PF-195`/`PF-196` were pre-allocated on the premise that the 44 tenant-scoped tables hold `SELECT, INSERT` only; the checker measured `20260813120000:480` and **refused to spend the ids** — no finding was written for a premise that is false. **⚠️ NOT the cutover** — `DATABASE_URL` untouched, `FORCE ROW LEVEL SECURITY` still absent, no runtime module changed, zero `withTenant` call sites, and the app still connects as owner `pilotage`, which is why nothing regresses and why `PF-194` is inert **today**. See the section below |
| **S-E01-1d** | The tenant scope **SEAM**: a second, non-owner `PrismaClient` on `DATABASE_URL_APP`, and `calendar` becomes the first module whose handlers run inside `withTenant` | 🟡 **shipped in part — 2026-08-15, ⚠️ NOT auto-merged (P1 · `[security][tenancy][rls][auth][db][api]`)** — [`stories/S-E01-1d.md`](./stories/S-E01-1d.md) | 58 | **What landed:** `app-role-prisma.service.ts` (new, 291 lines) **composes** `PrismaService` rather than extending it, is provided by the already-`@Global()` `PrismaModule`, and is injected in **exactly one** place — `TenantScopeService`; `calendar.module.ts` wires nothing new, so no module can reach the second client except through the seam (`ADR-048 §D1`, AC-4's structural proof). `calendar.controller.ts`'s four handlers become the first production callers of `withTenant`/`runWithTenant` — the seam itself (`runWithTenant`, `TenantTransactionRunner`, `assertTenantId`) already existed on `main` from `S-E01-2b`, so this is its **first caller**, not a new convention. **Every handler KEEPS its application filter** (`where: { tenantId, schoolId }` in `list`, `tenantId: me.tenantId` in `create`, the `if (!event \|\| event.tenantId !== tenantId) throw NotFoundException()` guard in `update`/`remove`): RLS **doubles** the guard, it does not replace it. The GUC is transaction-local (`set_config(..., true)`), so no context leaks onto a pooled connection. `list`'s parent branch is refactored (hoisting `scopeForUser` out of the scope) and is **semantically identical** — `studentIds === null \|\| length === 0 → []` → `school_wide` fallback, so G-PORTAL parent visibility is preserved. Degraded mode is **three** states, not two (`§D5`): `enforced` / `degraded_no_app_url` / `refused_unusable`, the third **refusing** rather than falling back to the owner, surfaced as an unlabelled `pilotage_tenant_scope_enforced` gauge on `/metrics`. **`§D9` is the reusable decision:** `P2025` from the database floor maps to the same `NotFoundException` the application guard throws, because a hardening that answered 500-vs-404 would have created an **existence oracle** the pre-story code did not have. Ships **`ADR-048`**. **NOT the cutover** — `DATABASE_URL` untouched, `schema.prisma` untouched, no migration |
| **S-E01-1d (b)** | The **GATE** and its executed proof: `AC-9` redefined from scope *openings* to attributed *call sites*, plus `scripts/tenant-scope-check.js` | 🟡 **shipped in part — 2026-08-15, ⚠️ NOT auto-merged (P1 · `[security][tenancy][rls][ci-gate][adr-drift][gate-red]`)** — [`stories/S-E01-1d-b.md`](./stories/S-E01-1d-b.md) | 58 | **Evidence, executed:** `pnpm typecheck` → **exit 0, 13/13**, `@pilotage/api` a genuine cache **miss** (a `noUncheckedIndexedAccess` error in the new `tenant-scope.spec.ts:462` DNC-10 ratchet was found by the gate and fixed in-run with an explicit `undefined` guard, not a `!`); `node scripts/tenant-adversarial-check.js` → **exit 0**, `[LIMIT] 6 scoped + 113 enumerated / 794 across 226 files`; `git diff --check` exit 0 on the working tree **and** vs `origin/main`; **no `schema.prisma`, no migration** (so `P-05` is disarmed and `restore-drill-baseline.json`/`PF-80` untouched). **The `AC-9` redefinition is the deliverable and it is a WALL, not a knob:** the old input counted the string `.withTenant(` — scope *openings* — and four openings in `calendar.controller.ts` cover **six** call sites, so it under-reported by construction; it is now `scopedCallSites + enumeratedCallSites === prismaCallSites`, every enumerated entry carrying its own reason, and the verdict switch was inverted **fail-closed** (`else record` → `else fail`). Landing on a truthful `[LIMIT]` at 6/794 is the honest outcome; a green there would have been the finding (`ADR-048 §D6`). **✅ `AC-1` IS MET — the executed proof RAN GREEN TWICE at land, taken by the routine because agents never build (GUARDRAILS §4).** `pnpm --filter @pilotage/api build` exit 0 (verified by **artefact mtime**, not exit code), then `node scripts/tenant-scope-check.js` ×2 → **`TENANT SCOPE: PROVEN — the compiled seam is refused by PostgreSQL for a non-owner role`, exit 0 both times**: `app_user` proven non-owner / no `BYPASSRLS` / not a member of the owner and owning **0** tables under test, `appRoleVerdict` — *the same function production boots on* — returning `enforcing`, the `PF-203` `relrowsecurity`/`pg_policy` arming check green, **positive control first** (tenant A reads, updates 1 row and creates its own `calendar_event`), **then** the denial (tenant B invisible to `findUnique` by primary key → `null`; `updateMany`/`deleteMany` by primary key → **0** rows; a unique `update` raising **`P2025`**; B's row read back UNCHANGED by the owner), plus a **no-scope control** proving the GUC is what makes the difference (0 rows outside any scope). **`TOOL-27`/`TOOL-31` did not recur** — the deterministic disconnect-before-drop held on both runs. Cleanup verified **out of band**: `tenant_scope_%` → `(none)`, `app_user` in its pre-run state, live `pilotage` untouched (`_prisma_migrations = 2`, `pg_policies = 0`). **Three of the sprint's four merge conditions were discharged at land** (the proof, the `.env.example` default, the missing `AC-14`); the fourth is now **`PF-204`**. Records **`PF-198`–`PF-204`** and **`TOOL-33`**. **See [the conditions](#s-e01-1d--the-seam-and-the-proof-that-has-never-run-green--ran-green-twice-at-land) below** |
| **S-E01-1** | Explicit tenant resolution, `pending` state, remove the `demo` fallback — **plus the `app_user` connection cutover** | ⬜ **RE-SCOPED 2026-08-14, and now BEHIND `S-E01-1e`** — steps 1 partially taken by `S-E01-1a`; the GRANT half of step 3 is taken by `S-E01-1b` | — | `PF-01` half (a) is taken by `S-E01-1a`; what remains under this id is **steps 2–5** of [Next slice](#next-slice): the first real `withTenant` call site, the `DATABASE_URL` → `app_user` cutover with the missing GRANTs, the decision on the six FK-derived tables (`PF-183`, held PR #245), and the `ADR-032` §D3 one-line correction. The `pending` `UserStatus` is an **enum change** (`schema.prisma:31-35` has only `active|suspended|deleted`), so it carries `G-MIGRATION` and belongs here, not in `1a`. **This is still the slice that mints the first real tenant claim** — but note the *source* of that claim forks on `D-02` (`PF-185`) |
| **S-E01-2** | RLS policies + real `withTenant` call sites + **parameterised GUC** | 🟡 **partial — the parameterisation third only** | 2026-08-11 | 57/57 jest in `apps/api/src/shared/prisma/prisma.service.spec.ts` (no DB, no `DATABASE_URL`, no generated client), `pnpm typecheck` 13/13 exit 0, `git diff --check` exit 0. Ships **`ADR-032`**; annotates `ADR-002`. Closes **`PF-02` half (b)**; **half (a) stays open**; records **`PF-179`**. See the section below |
| **S-E01-2b** | The RLS half: 44 policies, the `nullif` NULL-context decision, the append-only grant split, and the `Prisma.TransactionClient` narrowing — **without** `FORCE` and **without** a call site, both on purpose | 🟡 **partial — the policy half, proven; not the cutover** | 2026-08-13 | `node scripts/rls-isolation-check.js` → **`RLS ISOLATION: PROVEN for the non-owner role`, exit 0** against the real local PostgreSQL (44/44 RLS enabled, 44/44 `tenant_isolation` policies, connected as `app_user` owning 0 tables without `BYPASSRLS`, positive control first, executed rollback). `pnpm typecheck` **13/13 exit 0**; `git diff --check` exit 0. **5 mutants injected into the migration, 5 killed.** Ships `ADR-032` §D5–§D8. **`PF-02` half (a) closes only PARTIALLY.** See the section below |
| **S-E01-2c** | The tenant-**DERIVED** half: 5 FK-path `EXISTS` policies, a derived set computed from `pg_constraint` rather than listed, a per-table grant with **no `DELETE` anywhere**, and `outbox_event` deferred by name | 🟡 **partial — the five FK-derivable tables; `outbox_event` deferred, and still not the cutover** | 2026-08-13 | `apps/api/prisma/migrations/20260813180000_tenant_rls_derived_policies/migration.sql` (hand-reviewed, `schema.prisma` untouched so the `prisma generate` RED trap stays disarmed); `scripts/rls-isolation-check.js` extended from 44 to **44 + 5**, with `DERIVED_EXPECTED` derived from `pg_constraint` and an `AC-5b` **set-equality** residue check; `rls-isolation-gate.spec.ts` +450 lines. `pnpm typecheck` **13/13 exit 0** (`@pilotage/api` a genuine cache **miss** that compiled the new spec); `git diff --check` exit 0, extended by `--no-index` over the three untracked files. Ships **`ADR-042`** (extends `ADR-032`, supersedes nothing); annotates `ADR-032` in two places **in place**. Advances `PF-02` half (a); records **`PF-185`** (`outbox_event`) and **`PF-186`** (`ON DELETE CASCADE` vs append-only). **⚠️ The checker's own green is NOT established by this run's gate** — see the section below |
| **S-E01-2d** | The LAST table outside every policy: `outbox_event` gets a **denormalised** `tenant_id` (it holds no FK and never will — `aggregate_type`/`aggregate_id` are polymorphic), an `ON DELETE CASCADE` FK to `tenant`, the leading index the new column needs, the ordinary `tenant_isolation` policy of the 44, and `SELECT, INSERT, UPDATE` — **no `DELETE`** | 🟡 **partial — policy coverage is now complete; still not the cutover** | 2026-08-14 | `apps/api/prisma/migrations/20260814120000_outbox_event_tenant_scope/migration.sql` (hand-reviewed; **`schema.prisma` IS touched** — a column and an FK, which `migrate diff` sees — so `prisma generate` runs in this slice, `P-05`); `scripts/rls-isolation-check.js` census moves from `44 + 5` to `45 + 5` **with no literal edited**, the separate fail-closed `psql` probe is **deleted** and the proof folded into `PROOF_SQL` so the `permission denied` stderr guard covers this table too; `rls-isolation-gate.spec.ts` gains the third migration's ratchet and **inverts** the six `S-E01-2c` outbox assertions rather than deleting them. **Executed, not asserted:** `node scripts/rls-isolation-check.js` → **`RLS ISOLATION: PROVEN for the non-owner role`, exit 0, run twice**, census **`45 + 5`**, `RLS_ON = POLICIES = GRANTED = 50`; `rls-isolation-gate.spec.ts` **97/97** in 112 s; `tsc --noEmit` **forced non-cached** in `apps/api` → 0 and `-p prisma/tsconfig.json` → 0 (this run's `pnpm typecheck` was a **vacuous `FULL TURBO` replay** — see the section below); generated client carries `OutboxEvent.tenantId` with an mtime **after** the schema edit, so `P-05` is closed by observation. Ships **`ADR-044`** (discharges `ADR-042 §D7`, supersedes nothing). **Closes `PF-185`.** `PF-186` (cascade vs append-only) untouched and still open. **⚠️ Three conditions a human owns — see [the section below](#s-e01-2d--the-last-table-what-it-decided-and-the-one-path-that-has-never-run)** |
| **S-E01-3** | Two-tenant adversarial suite in CI (VAL-02) — catalog-enumerated BREADTH, four verbs, both directions | ✅ **done** | 2026-08-14 | `node scripts/tenant-adversarial-check.js` → **675 assertions, 4 named limits, 0 failures, exit 0**, three consecutive byte-identical runs (20 s / 21 s / 20 s, modulo the generated scratch database name) against the real local PostgreSQL. 45 tenant-bearing + 5 FK-derived tables enumerated from the live catalog of its own scratch database; `COVERED` = 50 against a floor of 40, `UNCOVERED` asserted empty by set equality; per `(table, verb)` the expected outcome is read from `role_table_grants`, so `42501` is never scored as isolation and a WIDENED grant FAILS. `MUTANT_KILLED` executed in-suite. Ships **`ADR-045`**; guard spec `apps/api/src/shared/quality/tenant-adversarial-gate.spec.ts` **EXECUTED — jest 58/58 pass in 7 s** (it had never been run when the branch was first proposed, which is how a `toContain` on a sentence the checker does not carry reached review); wired into `ci-gate.sh` + `ci.yml` with its own trigger. **Latent flake closed while running it:** `.gitattributes` pins `*.ts`/`*.sh`/`*.yml` to `eol=lf` but **not `*.js`**, so the checker is CRLF on a Windows checkout and LF on the Linux CI — the two guard assertions that anchor a MULTI-LINE fragment (the `INS_A_OWN` / `INS_A_FGN` ordering, and the banner extraction) were therefore green in CI and **red on a developer machine**, the worse of the two directions. Every source the spec reads is now normalised to `
` at the read, so the guard judges content and never checkout style. **CORRECTION to the previous note in this row:** "the same shape through the application's own query paths" is **not** what remained and is not what this slice ships — `PrismaService.withTenant` has **0 production callers out of 722 Prisma call sites** (measured by the suite itself), so there are no application query paths to run it through. What remained was BREADTH, and the application-path work is the cutover, `S-E01-1`. **⚠️ RE-CORRECTED AT LAND BY RUN 56 — the argument is sound and its conclusion does not follow.** That `withTenant` has 0/722 callers establishes that the application half is *unmeasurable today*; it does not establish that it is *unnecessary*. `VAL-02` is defined as a suite « on every read/write/export/job » (`audit-findings-index.md:336`), and this one drives `psql` — no controller, no export, no worker job. Accepting « we cannot exercise it yet, therefore it is closed » is the `PF-02` pattern itself: a guardrail recorded as discharged while nothing exercises it. Closes `VAL-02`’s **DATABASE half only**; the application half is open and owned by `S-E01-1`. Advances `PF-02` half (a). **⚠️ REBASE CORRECTION, and it is the durable lesson of this row:** the branch was first measured at `51b4634`, i.e. BEFORE `S-E01-2d` (`e53f2d9`) merged, and its first evidence line (*"661 assertions, 44 + 5 = 49"*) was true of a tree that no longer existed. On the merged ledger `outbox_event` carries a `tenant_id`, so the live-catalog census returned it, `PLAN` did not attempt it, and three named assertions were red — caught in review, not by a run. Fixed at the right layer rather than patched: `outbox_event` joined `PLAN` as the 45th ordinary tenant-bearing table (seeded for both tenants, four verbs), the privilege matrix takes its `SELECT, INSERT, UPDATE` from `ADR-044 §D3` **by name** instead of the `FULL_DML` default, and the old fail-closed probe was **deleted** — after `ADR-044` a `permission denied` there would be a MISSING GRANT, the very false green this suite exists to refuse. The guard spec **inverts** its six `outbox_event` assertions rather than dropping them. An evidence line is only true of the tree it was measured on |
| **S-E01-4** | Student Keycloak client split (**+ `VAL-04` live review**) | ✅ **SPLIT 2026-08-15 and now FULLY ALLOCATED — both halves have shipped.** `D-02` was DECIDED by operator override in run 60, not deferred. The artefact-and-code half is **`S-E01-4a`**; the executable gate (`AC-6`/`AC-7`) is **`S-E01-4b`**, both below. Nothing remains under this id | 60, 62 | `PF-18` closed by `S-E01-4a` (artefact + code) and **ratcheted** by `S-E01-4b` (`scripts/keycloak-client-check.js`, unconditional TIER-1). **`VAL-04` stays `open` and is the only residue** — no live Keycloak has ever run against this change (`docker info` → exit 1 at both attempts, run 60 `TOOL-19` and run 62), and its points 2 and 4 need a browser |
| **S-E01-4a** | The student portal gets its **OWN** OIDC client (`portal-student`), and the two client-id seams stop being able to diverge | 🟡 **shipped in part — 2026-08-15, ⚠️ NOT auto-merged (P1 · `[auth][security][oidc][keycloak][config-drift][adr-drift][frontend]`)** — [`stories/S-E01-4a.md`](./stories/S-E01-4a.md) | 60 | **Closes `PF-18`** (the code + artefact halves), ships **`ADR-050`**, amends **`ADR-021`** in place at its three anchors (§Decision reuse clause, §Rejected-alternatives fourth-client bullet, §Consequences), records **`PF-209`**–**`PF-214`**. `CLIENT_PORTAL_OVERRIDE = { student: 'parent' }` is **deleted, not emptied** — `auth.ts`'s three server seams (OIDC provider `:96`, ROPC `:169`, refresh `:326`) all resolve through the one accessor `resolvePortalClientId(portal, env)` in the new `apps/web/src/lib/keycloak-clients.ts`, whose override key is built from the **same** portal it resolves, so no code path leads from portal A to portal B's id. `PORTAL_FROM_PROVIDER` is now *derived* from `portalProviderId`, closing a second hand-written copy that could have addressed a callback NextAuth never emits. The reset link stops carrying its own `portal-${portal === 'student' ? 'parent' : portal}` literal and receives the id as a **server-resolved prop** (`NEXT_PUBLIC_*` rejected on purpose — build-time inlining would re-create the divergence, `ADR-050 §D2`); no secret crosses the `'use client'` boundary. **The infra half landed with it, and that ordering is the whole point:** `infra/keycloak/realm-export.json` gains the `portal-student` confidential client derived field-for-field from `portal-parent` (three exact redirect URIs, `S256`, no callback wildcard) **and the missing `student` realm role** without which `REALM_ROLES_FOR_PORTAL.student` could never be satisfied; `infra/kc-prod-redirects.mjs` splits `'portal-parent': ['parent','student']` into one segment per client, replaces `${BASE}/api/auth/callback/*` with the two exact paths per portal, **exits 1** on a multi-portal binding, and counts a **missing client as a failure** instead of a green skip; `.env.example` gains the student pair plus the deploy-ordering note. **Four things a human owns — see [`S-E01-4a` — what landed, and what a human owns](#s-e01-4a--what-landed-and-what-a-human-owns).** |
| **S-E01-4b** | The per-portal OIDC client identity gets a **RATCHET**, and the ratchet derives its expectation by **executing** the production accessor instead of parsing it | 🟡 **shipped in part — 2026-08-15, ⚠️ NOT auto-merged (P1 · `[auth][security][ci-gate][tooling][adr-052][no-schema][no-runtime-change][blocking-stage-added])`** — [`stories/S-E01-4b.md`](./stories/S-E01-4b.md) | 62 | **Ratchets `PF-18`** (closed on the artefact by `S-E01-4a`, un-ratcheted until now), ships **`ADR-052`** (amended at land — see below), records **`PF-221`**–**`PF-227`**. **`VAL-04` stays `open`.** **What landed:** `scripts/keycloak-client-check.js` (1042 lines) + an **unconditional TIER-1** stage in `scripts/ci-gate.sh` mirrored into `.github/workflows/ci.yml` + 150 lines appended to `keycloak-client-identity-gate.spec.ts`. **No runtime file in any of the three apps changes** — the single `apps/api` file is under `src/shared/quality/`, i.e. gate machinery. **The hole it closes is real and was re-measured at land:** `GATE_MACHINERY` matches `scripts/`, `.github/`, `infra/` and `apps/api/src/shared/quality/` — and **not** `apps/web/src/lib/keycloak-clients.ts`, **not** `apps/web/src/auth.ts` — so the only executable assertion that `PF-18` stays fixed was skipped on precisely the diff that can reintroduce it. **The load-bearing decision is `§D1`: the gate EXECUTES the accessor** (`tsc`-transpiled through `vm.runInNewContext`, after asserting inertness — no import outside `./portals`, no `require`, no `process.env`) because `PF-18`'s shape was an **alias inside the function body**, invisible to the constant-lifting parsers `csv-escape-check.js` / `audit-write-check.js` use. Derivation alone is not enough — an accessor regression moves both sides together — so the assertion is a **bijection** portal ↔ client with a vacuity floor. **The wildcard rule was NARROWED, not relaxed, and the brief was overruled on a measurement:** *"no wildcard anywhere in a redirect URI"* is FALSE of all four clients today (each carries its own `<origin>/<portal>/*`), so that checker would have gone red on `main` on day one and the only route to green was breaking SSO on four portals — `W-1`/`W-2`/`W-3` (no `*` in a callback URI · the only `*` is the client's own portal root · no client carries another portal's segment) are strictly stronger. **Executed:** `node scripts/keycloak-client-check.js` → `GATE: PASS`, exit 0, **1.542 / 1.563 / 1.563 s**; `pnpm typecheck` **13/13** exit 0 (`@pilotage/api` a genuine cache miss); `git diff --check` exit 0; `jest keycloak-client-identity-gate.spec.ts` **20/20** in 6.0 s; the four AC-5 negative controls driven through `auditRealm(rule, realm)` on in-memory clones, all RED, with the forbidden repair refused **by name**. **Four things a human owns — see [`S-E01-4b` — the ratchet, and the half that never ran](#s-e01-4b--the-ratchet-and-the-half-that-never-ran).** In one line each: (1) **`VAL-04` is not discharged** — `timeout 60 docker info` → exit 1, no realm, no token, no `azp`, and `scripts/keycloak-live-probe.js` (449 lines) ships **written and never executed**; points 2 and 4 need a browser and are not closed under any outcome; (2) **`AC-9` is unmet** — `infra/docker-compose.yml` is absent from the diff, and the story (§0(c), AC-9) and `ADR-052 §D7` now contradict each other in the same diff; (3) **the ratchet does not ratchet itself** — with `wildcardProblems()` gutted to `return []` the gate exits 0 and the spec passes 20/20 (`PF-225`); (4) **`ADR-052 §D4` shipped contradicted by its own code** and was amended at land (the stage has no `KEYCLOAK_IDENTITY_RE` trigger; the trigger is now recorded as **rejected**, not as pending) |
| **S-E01-5** | `calendar_event`'s scope foreign keys are checked for **OWNERSHIP**, inside the scope, before the write — not only for coherence | 🟢 **shipped — 2026-08-15, ⚠️ NOT auto-merged (P1 · `[security][tenancy][authz][api]`)** — [`stories/S-E01-5.md`](./stories/S-E01-5.md) | 59 | **Closes `PF-204`** (the *creatable* half), ships **`ADR-049`**, amends **`ADR-048 §D3`** in place, records **`PF-205`** and **`PF-206`**. One production file changes: `calendar.controller.ts`. Each supplied scope id (`academicYearId`, `cycleId`, `gradeLevelId`, `classSectionId`) is proven owned by `findFirst({ where: { id, tenantId }, select: { id: true } })` issued **on the scope's own `tx`, inside `this.scope.run(...)`, before the write** — outside it would run on the OWNER connection, which sees every tenant, i.e. it would validate the defect it refuses. `findFirst` and not `findUnique`, because `findUnique` cannot carry the non-unique `tenantId` and the composite predicate would then be applied *after* the foreign row was fetched. One **400** for both failure modes, byte-identical, indistinguishable **by construction** rather than by careful wording (`ADR-048 §D9`). Mutual exclusivity of the three scope ids is defined on **truthiness, never key presence** — which is what keeps the admin UI working, since `CalendarManager.tsx` always sends `gradeLevelId`/`classSectionId` and usually as `null` — and it independently closes the inference hole where an unvalidated `cycleId` rode into the row behind a `class_section_scope`. **The budget is amended honestly, not moved quietly:** `ADR-048 §D3`'s ≤ 2 becomes **≤ 3** for `create` and `update` (`list` 1–2, `remove` 2, both unchanged), asserted executably by B1. **No `schema.prisma`, no migration** (`G-MIGRATION` not triggered, `restore-drill-baseline.json` untouched, the `prisma generate` RED trap disarmed), **no `apps/web` file**. **Two things it does NOT do, both recorded:** it validates NEW writes and remediates nothing already stored (`PF-205` owns the retroactive half and the composite-FK migration that would make the reference *impossible* rather than *checked*), and it does not repair `update` silently dropping `academicYearId` (`PF-206`) — that premise is instead **pinned by a source assertion**, so adding the field later turns a silent hole into a red test. **⚠️ Renumbered at implementation:** written as `S-E01-4`, which was already the Keycloak client split — see the story header. **ADDENDUM AT VERIFY — a SECOND defect was found by the gate pass and fixed at its own layer, and it is the one to read if you read nothing else here.** `APP_ROLE_REQUIRED_PRIVILEGES` (`shared/prisma/tenant-scope.ts:122`) is the hand-maintained relational closure that `appRoleVerdict` walks **at boot**; a missing entry makes the deployment fall back to `degraded_no_app_url` (RLS off, gauge 0). This slice adds 7 Prisma call sites on 4 tables inside the scope — `cycle`, `grade_level` and `class_section` were already listed **by luck** (for `list`’s `include`), and **`academic_year` was not**. On a cluster where `app_user` was granted partially — the exact failure family that constant exists to refuse — the boot probe would have certified `enforcing: true` while **every** calendar-event creation 500s on `permission denied for table academic_year`, and the admin UI sends `academicYearId` on every save (`CalendarManager.tsx:353-354, :439`). Fail-CLOSED, so not a leak — but a security probe green-lighting a state it never checked is the `PF-02` shape inside the probe built to refuse it. The entry is added **and the coupling that never existed is now tested**: **AC-10** derives `(table, privilege)` from the controller’s real `tx.<model>.<verb>(` call sites and requires the declared closure to cover them, with a non-empty-corpus guard so it cannot pass vacuously — proven **red before green** (`+ Array [ "academic_year.SELECT" ]`). **AC-4’s pre-fix RED was never captured** (the spec imports five symbols that exist only post-fix, so it cannot compile against `HEAD~1`); **mutation testing was substituted and is stronger** — three mutants, all killed: `where: { id }` stripped of `tenantId` → 11 red, the refusal dropped with the probe retained → 9 red, `academicYearId` removed from `CREATE_OWNED_SCOPE_FIELDS` → 6 red. **Four things a human owns, none of them fixed here:** (1) the **retroactive census has never been run against PROD** — `calendar_event` measured **0 rows** on the LOCAL database, which is clean and therefore uninformative, so `PF-205`’s blast radius on `pilotage.srv861861.hstgr.cloud` is `unmeasured` at the moment `PF-204` is asked to read `closed`; (2) **`announcements.controller.ts` carries the identical, live, UNRECORDED instance of the same defect** — five mono-column scope FKs written straight from the body, coherence-only validation, **no ownership probe on the admin path**, and `scope: individual_user` with a foreign `userProfileId` writes an `announcement_receipt` **and a `Notification`** into another tenant’s user feed, i.e. a cross-tenant **write** rather than a rendered name; it needs its own `PF-` before anyone reads `PF-204: closed` as « the class is shut »; (3) **a NEW 400 on a path that previously succeeded** — a `PATCH` carrying two truthy scope ids at once is now refused (intended, `ADR-049 §D3`, pinned by M1b), which an integration caller could trip; (4) **the exclusivity invariant is on the BODY, not on the ROW** — `update` merges into the stored row, so `PATCH {classSectionId}` on an event already holding `cycleId` persists **both**, and `update` still carries **no** scope⇄id coherence guard at all (unlike `createEvent:611-619`), which is wider than what `ADR-049 §D3` claims. Both ids are tenant-owned, so it is a claim-width defect and not a leak — but `PF-205` may **not** assume the invariant holds on rows written after this slice. **Two re-runs the orchestrator owns:** `scripts/tenant-scope-check.js` loads `apps/api/dist/shared/prisma/*.js`, so the closure edit is invisible to it until the build — after it, the script must report **9** privileges and stay green; and `node scripts/tenant-adversarial-check.js` was **not** run on this diff although it triples the converted module’s table surface (2 → 6), and its `scoped + enumerated === total` equality is the only mechanical check of that. Non-blocking drift: `scripts/tenant-adversarial-check.js:1884,2290` still say `calendar.controller.ts` has « six call sites » (now 13, comment only — the counter is computed), `ADR-049 §D5`’s heading says « private method » where the code deliberately **inlines** the probe loop in each `this.scope.run(...)` callback because `tenant-adversarial-check.js`’s coverage counter is **lexical** (PF-200), and `tenant-scope.spec.ts:366` still enumerates four table names, so `academic_year` is covered by AC-10 but not pinned there. Ownership is proven for `tenant_id`, **not** `school_id` — a same-tenant / other-school `classSectionId` still passes, latent today because `ctx.forTenant` returns one school |
| **S-E01-1e** | The **SECOND** module (`lessons`) enters the tenant seam, and the coverage counter stops being **receiver-blind** | 🟡 **shipped in part — 2026-08-15** — ⚠️ **ROW ADDED RETROACTIVELY (run 63)**: the slice landed as `f9eff0a` during run 61 and was never added to this table, exactly as [the correction note above](#v3-e01--tenant-isolation-and-identity-resolution) says. The section below is the authoritative account; this row exists so the table stops disagreeing with it | 61 | Closes **`PF-217`**, settles **`PF-199`**, records **`PF-218`**/**`PF-219`**, ships **`ADR-051`**, advances `PF-02` half (a). Attribution re-derived, never edited: `13 scoped + 111 enumerated / 800` → **`24 scoped + 120 enumerated / 803`**. **The finding is worth more than the movement:** `PRISMA_CALL_SITE_RE` matched `prisma.`, `this.prisma.` and `tx.` identically and `covers()` was purely **positional**, so a statement on the **owner** connection *inside* a `scope.run` callback counted as **scoped** — a half-converted handler scored **higher** than a correct one, i.e. the readiness metric moved the **wrong way** precisely when the code was wrong. `SCOPE_SAFE_RECEIVERS = ['tx']` + a pure `classifyCallSite` with four outcomes close it, receiver test **before** enumeration test so an allow-listed file cannot launder a covered site (`ADR-051 §D1`). **No SQL, no `schema.prisma`** — `G-MIGRATION` untriggered, `PF-80` never armed. See [the section below](#s-e01-1e--the-second-module-and-the-counter-that-moved-the-wrong-way-until-it-was-repaired) |
| **S-E01-1f** | `announcements`' five scope foreign keys are proven **OWNED** before the write, `computeRecipients` is made structurally incapable of returning a foreign profile, and the ownership helpers become a **shared** rule rather than one controller's habit | 🟡 **shipped in part — 2026-08-15, ⚠️ NOT auto-merged (P1 · `[security][authz][tenancy][api][behavior-change]`)** — [`stories/S-E01-1f.md`](./stories/S-E01-1f.md) | 63 | **Closes `PF-208`** — the twin `S-E01-5`'s escalation panel named and could not fix, and the first instance of this defect class to reach a cross-tenant **WRITE** (`announcement_receipt` **and** `Notification` rows addressed at another tenant's profiles). Ships **`ADR-053`** (§D1 probes · §D2 extraction, **superseding `ADR-049 §D5`** · §D3 the new refusal · §D4 the chokepoint · §D5 preview · §D6 what is not decided); records **`PF-228`**–**`PF-233`**. **What landed:** `create` and `preview-recipients` probe all five **supplied** scope ids with `findFirst({ where: { id, tenantId } })` — `findFirst` not `findUnique`, a `switch` closed by a `const exhaustive: never`, a refusal **byte-identical** for *« other tenant »* and *« does not exist »* (`ADR-048 §D9`), ordered **after** the pure and role refusals so a doomed body costs no query; `computeRecipients` gains five tenant predicates plus a bounded `resolveWithinTenant`, **required and not belt-and-braces** because `publishInternal` recomputes from the **stored** ids and never re-enters the controller probe (`PF-230`); the pure plan helpers move into **`apps/api/src/shared/prisma/scope-fk.ts`** with **no compatibility re-export**, while the field lists, the `findFirst` loop (lexical counter, `PF-200`) and a generic `assertOwnedByTenant` are deliberately **not** extracted; and **`assertScopeCoherence`** (`ADR-053 §D3`) adds a new 400 for bodies whose scope does not explain the ids they carry, measured against both shipped composers first. **The severity correction is part of the deliverable:** `PF-208`'s recorded blast radius was wrong in **both** directions — the rows do **not** render in the victim's feed, so it is (a) integrity / invisible **dark** rows and (b) a **cardinality-and-existence oracle to the attacker**; and **four** branches leaked, not one. **NOT a conversion** — no `withTenant`, no `APP_ROLE_REQUIRED_PRIVILEGES` entry (`AC-6`/`AC-7` cut → **`PF-232`**), `tenant-scope.ts` and `announcements.module.ts` byte-unchanged, so `24 + 120 / 803` and `PF-02` are where `S-E01-1e` left them and the explicit predicate does **all** the work (`DNC-06`). **Evidence, executed:** `pnpm typecheck` **13/13 exit 0** with `@pilotage/api` a genuine cache **miss**; `git diff --check` exit 0; `jest src/modules/announcements src/modules/calendar` → **5 suites / 106 tests PASS** (125 s), including the new 734-line `announcements-scope-ownership.spec.ts` and its **negative control** (the pre-fix query fired against the same fake DB returns the victim's rows; an unknown Prisma operator **throws** rather than silently returning `[]`). **No `schema.prisma`, no migration** (`P-05` disarmed). **Four things a human owns — see [`S-E01-1f` — the write path closed, the read path one third done](#s-e01-1f--the-write-path-closed-the-read-path-one-third-done)** |
| **S-E01-1g** | The **THIRD** module (`announcements`) enters the tenant scope **PARTIALLY**, and the rule deciding *which handlers can enter at all* becomes an architectural decision instead of a third local comment | 🟡 **shipped in part — 2026-08-16** — [`stories/S-E01-1g.md`](./stories/S-E01-1g.md) | this run | **Closes `PF-232`** (its conversion half), records **`PF-235`** / **`PF-236`**, ships **`ADR-054`**, advances `PF-02` half (a). Attribution **re-derived by the script, never edited**: `24 scoped + 120 enumerated / 816` → **`36 scoped + 120 enumerated / 816`** — `+12` is **exactly** the number of sites converted, so there is **no `owner-inside-scope` residue** and the `PF-217` trap was avoided *by construction*; `enumerated` unmoved at 120, denominator unmoved at 816, verb-aware still `165 satisfied, 2 not`. **Five whole handlers** converted (`unreadCount`, `create`, `update`, `publish`, `markRead`); four handlers, two private methods and all ten sites of `announcements.service.ts` **excluded, each with its mechanism in a docblock at its own definition site**. `APP_ROLE_REQUIRED_PRIVILEGES` gains six rows and four **extended** (never duplicated) `why` strings; `announcements.module.ts` **byte-unchanged by design** (`PrismaModule` is `@Global()`). **`ADR-054` is the deliverable as much as the code:** `§D1` the partition criterion (*a handler converts only if every statement it provokes is **lexically** inside the callback; a collaborator closing over its own `PrismaService` is **excluded**, never threaded a `tx`*) — the third occurrence of a rule `calendar` and `lessons` each recorded locally; `§D2` the **measured** refusal of the `tx` thread (it would *compile*, unlike `CalendarSeedService`, but moves the counter by **zero** while adding five tables to a globally-probed closure); `§D3` the half of the boot-probe rule the first two modules never had to write — an **over**-declared row 503s **calendar and lessons too**, this list being global; `§D4` `remove` excluded because the `announcement`→`announcement_receipt` cascade is **expected, not proven**, so `announcement`/`DELETE` is deliberately undeclared; `§D5` the mandatory `DNC-06` sentence. **Named limits:** the module is **PARTIALLY** converted, `list`/`getOne` are refused on **`G-TRUTH`** (their `_count`/`stats` are rendered projections that legitimately diverge over the dark rows `PF-230` owns), the app still connects as **owner** with no `FORCE ROW LEVEL SECURITY`, and **`PF-02` did not close**. **No `schema.prisma`, no migration, no `apps/web`, no `apps/worker`.** See [the section below](#s-e01-1g--the-third-module-enters-the-scope-partially-and-this-time-the-counter-moved-by-exactly-what-was-converted) |

## `S-E01-1a` — what landed, and the four residuals

**Delivered.** `ensureUser` no longer contains a tenant slug. The branch that upserted a `demo` `Tenant` into
existence and created an `active` `UserProfile` inside it is **deleted, not guarded** — there is no fail-open leg, no
`NODE_ENV` branch, no `ALLOW_*`/`SKIP_*` flag, and the file reads no environment variable at all. A ratchet in
`user-sync.service.spec.ts:451-462` reads the stripped source for exactly those escape hatches, with a non-vacuity
floor and a `__filename` self-exclusion, so the absence is mechanised rather than asserted (`DNC-10`). The positive
control (T-2) asserts against a synthetic `TENANT_INVENTED` marker, which is what stops the whole suite being green
on a service that refuses everything.

**403, not 401, argued from measurement.** `apps/web/src/lib/api-client.ts:111-113` intercepts 401 before any caller
and redirects to `/{portal}/login?error=session_expired`, and `AppShellRoot.tsx:86` calls `fetchMe()` on every page of
all four portals. A 401 here is an infinite login loop captioned by a falsehood. 403 is terminal and true.

**No audit row on refusal, and that is forced rather than lazy.** `AuditLog.tenantId` is required, so auditing a
refusal would mean inventing the tenant id the code just refused to invent. The compensating trace is a `warn`
carrying the `sub` alone — no email, no name (RGPD minimisation).

**The four residuals, none of them fixed here, all of them measured.**

1. **The seeded identities live in the tenant that holds the children's data.** STEP 15 of `seed-demo.ts` upserts
   `admin@` / `teacher@` / `parent@pilotage.local` into `T` — the populated demonstration tenant — **with no
   `authProviderId`**, because the realm export declares no user `id` (Keycloak mints the UUID at import, per
   cluster). `infra/keycloak/realm-export.json` ships those identities enabled, `emailVerified`, with a repo-literal
   password, and `admin@` carries the `school_admin` realm role. Before this slice that credential auto-provisioned
   into an *empty* tenant; after it, first login adopts the seeded row and it is `school_admin` **inside the tenant
   with the student records**. The blast radius of an unrotated demo password moved from nothing to everything.
   `seed-keycloak-users.ts` rotates only the accounts it provisions itself, and these three are not among them.
2. **Adoption is by bare email string, unscoped by tenant and unverified.** `payload.email_verified` is parsed in
   `jwt.strategy.ts:12` and never read; `email` is unique only *per tenant* (`schema.prisma:879`); `status` is never
   consulted, so a `suspended` or `deleted` row still resolves and can still be bound to a fresh subject. One matching
   row is treated as consent. Recorded as `PF-186` (unscoped lookup) — `status` is the natural `S-E01-1b`.
3. **A first binding cannot be undone by anything in the repo.** After first login binds `authProviderId`, a realm
   re-import (ordinary here: Postgres is a native Windows service, Keycloak is a container, so the container volume is
   wiped while the database survives) presents a new `sub`; `findUnique` misses, `findMany` returns the row bound to
   the old `sub`, and the account is refused **permanently**. Re-running either seed does not repair it —
   `seed-demo.ts`'s `update` branch deliberately never touches `authProviderId`, and `seed-keycloak-users.ts`'s
   `DEMO_USERS` list covers only the two `@voltaire.fr` accounts. Recovery is hand-written SQL. On a database where
   the *old* lazy-provisioning already ran, the same mechanism produces a second row with the same email in the `demo`
   tenant, which is either inert (while the old `sub` holds) or a permanent `ambiguous-email` refusal (once it does
   not). Neither state is remediated, and the seed prints success in both.
4. **The refusal reaches the user as a generic crash screen, not as the French sentence.** `apps/web/src/lib/me.ts:34`
   catches 401 only; `AppShellRoot` awaits `fetchMe()` in a **layout server component**, so a 403 propagates to the
   portal `error.tsx` boundaries, whose message Next redacts to a digest in production. `ACCOUNT_NOT_PROVISIONED`
   appears nowhere under `apps/web/src`. The 403-over-401 decision still holds; what is false is any claim that the
   copy is what a refused user reads. This is the deferred UI half, and it is named so the human merging is not told
   the failure mode is softer than it is.

## `S-E01-2` — what actually landed, and what the title still promises

The slice title names **three** things. It delivered **one**, and the honest reading matters more here than anywhere
else in the programme, because this is the epic whose whole purpose is to stop a *claim* of isolation standing in for
isolation.

**Delivered.** `apps/api/src/shared/prisma/prisma.service.ts:29` read
`tx.$executeRawUnsafe("SET LOCAL app.current_tenant_id = '" + tenantId + "'")`. The tenant value now travels as a
**bound parameter** through a tagged `$queryRaw` template — `SELECT set_config('app.current_tenant_id', $1, true) AS
applied` — a non-canonical-UUID id is **refused before `$transaction` opens** (`TenantContextError`; the non-`string`
check runs before the regex, because `tenantId: string` is a compile-time promise over a JWT claim), and the value
`set_config` returns is **read back** and compared `!==` against the id requested, so `fn` never runs under an
unproven context. `ADR-032` D1–D4 are decided **and executed**; `ADR-002` is annotated in two places rather than
rewritten, because the rest of it is still the target.

**Not delivered, and measured rather than assumed.** Zero `ENABLE ROW LEVEL SECURITY` and zero `CREATE POLICY` exist
anywhere in the repository, `0_baseline` included. `withTenant` has **zero production call sites** — a grep over
`apps/**` and `packages/**` returns its own definition and its own spec. So the runtime blast radius of this diff is
**exactly zero**: it removed an injection sink on a seam nobody calls, guarding a database with no policies.
**`PF-02` half (a) — "RLS claimed, not implemented" — remains true**, which is why the traceability row is
`in-progress` and not `closed`, and why the epic is nowhere near `shipped`.

**Recorded, not fixed.** `PF-179` — two `$executeRawUnsafe` survivors outside the tenant seam
(`modules/child-claims/guardianship-claim-index.bootstrap.ts:32`, `modules/remediation/booking-index.bootstrap.ts:30`).
Both are constant bootstrap DDL with no interpolated external value, so neither is an injection; both sit in modules
another track owns, so fixing them across the boundary was declined deliberately. The source ratchet this slice ships
reads `apps/api/src/shared/prisma/**` only and cannot see them.

## `S-E01-2b` — what landed, what did not, and why the difference is deliberate

**Delivered, and proven by execution rather than asserted.**
`apps/api/prisma/migrations/20260813120000_tenant_rls_policies/migration.sql` — hand-reviewed (ADR-027, G-MIGRATION),
not produced by `migrate dev`, with `schema.prisma` untouched on purpose so the `prisma generate` RED trap stays
disarmed — poses `ENABLE ROW LEVEL SECURITY` and a single `tenant_isolation` policy (`FOR ALL TO PUBLIC`, `USING` ≡
`WITH CHECK`) on the **44** tables carrying a `tenant_id` column, and grants DML on those 44 to the non-owner login
role `app_user`.

The predicate is
`nullif(current_setting('app.current_tenant_id', true), '')::uuid = tenant_id`, and each of its three parts closes a
prerequisite this file previously listed as an acceptance criterion:

1. `missing_ok` (`, true`) — without it every connection that never went through `withTenant` raises `42704`.
2. **`nullif(…, '')`** — the correction this slice added, and it was not in the original plan. Measured on this
   cluster: after a `COMMIT`, a `set_config(…, true)` leaves the GUC at **`''`, not NULL**. Prisma pools connections,
   so a bare cast raises `22P02` on the **second** query of every pooled connection. `nullif` is **not** an
   `IS NULL OR` in disguise — it maps `''` to NULL, and NULL passes no row. Direction stays fail-closed.
   *(The story spec `stories/S-E01-2b.md` still prescribes the bare-cast form in its §predicate; it predates the
   measurement and must be read against the migration header, which carries the evidence.)*
3. **Cast, never text-compare** — `assertTenantId` preserves case deliberately while PostgreSQL renders `uuid`
   lowercase, so `tenant_id::text = …` would filter to zero rows *invisibly*.

`FOR ALL TO PUBLIC`, never `TO app_user`: a role-scoped policy exempts every *other* future non-owner role in silence.

**The grant is not uniform, and that is the strongest decision in the slice.** `audit_log` and `conversation_message`
receive `SELECT, INSERT` only. A blanket grant would have made the audit hash chain (`hash`/`prev_hash`) rewritable by
the application role at cutover — GUARDRAILS §1 and ADR-037 §D4. `conversation_report` is excluded from that carve-out
**by name and with its reason** (moderation mutates `status`/`reviewed_by`/`reviewed_at`), so nobody widens it later by
analogy. Measured before restricting: zero `conversationMessage.update|delete|upsert` call sites, and the only
`auditLog` mutator is `apps/api/prisma/seed-demo.ts:298`, which connects as the **owner** and is unaffected.

**Proof.** `scripts/rls-isolation-check.js`, wired as `ci-gate.sh` stage 600 and a `ci.yml` step, both no-skip
(DNC-08). It creates a scratch database, applies the whole ledger, connects **as `app_user`**, and asserts the
**positive control first** — rows APPEAR under GUC = tenant A before they disappear under GUC = tenant B — because
`app_user` held zero privileges before this migration, so a proof showing only absence would have been green for the
wrong reason. It also asserts `current_user` owns **0** tables and lacks `BYPASSRLS`, a foreign `INSERT` refused by
`WITH CHECK`, a cross-tenant `UPDATE` refused, the pooled-connection `22P02` case, the append-only privilege census,
and an **executed** rollback. Verdict this run: **`RLS ISOLATION: PROVEN for the non-owner role`, exit 0.**
The escalation panel then injected **5 mutants** into the migration (`USING (true)`, `WITH CHECK (true)`, bare
`::uuid`, one table removed from the 44-array, the append-only carve-out emptied) and the gate **killed all 5**,
restoring the file byte-identically. This gate is load-bearing, not decorative.

**Also delivered:** `prisma.service.ts` narrows `fn` from `PrismaClient` to `Prisma.TransactionClient` — obligation 3
below. The cast is **deleted, not relocated**; `TenantTransactionRunner` is parameterised so `runWithTenant` returns
the client's exact type. It lands now precisely because there are still **zero** call sites: the only moment it costs
nothing.

**NOT delivered, measured rather than assumed — read this before concluding anything about isolation.**

- **`FORCE ROW LEVEL SECURITY` is absent, deliberately.** The API, the seeds and `prisma migrate` all connect as
  `pilotage`, the owner of the 55 tables, and an owner is not subject to its own policies without `FORCE`. Posing
  `FORCE` today would return **zero rows to every query of every portal** — an outage, not a hardening. The correct
  repair for the owner-bypass trap is that the application **stops connecting as owner**. This supersedes
  `ADR-032` §Deferred item 1, and it is recorded **in the ADR** (§D5, with item 1 annotated in place) — not in a
  migration comment, which cannot supersede a decision of record.
- **The running application is therefore still not RLS-isolated.** What remains is a **connection cutover**, not more
  policy work. `withTenant` still has **zero** production call sites.
- **Coverage is partial.** Six tables without a `tenant_id` are tenant-derived through a foreign key and carry **no
  policy**: `grade_revision`, `announcement_receipt`, `branding`, `import_row`, `user_role`, `outbox_event`. Named,
  with their reasons, in the migration header.
- **The grant set is deliberately incomplete for the cutover** (role/permission/tenant tables), which `S-E01-1` must
  finish before flipping `DATABASE_URL`.

**Two conditions a human owns before this merges.**

1. **The jest half has never executed, anywhere.** This worktree has no `node_modules`, and `<rootDir>` under a
   dot-directory collects 0 tests. `rls-isolation-gate.spec.ts` (526 lines, new) and the `AC-10` block appended to
   `prisma.service.spec.ts` are unverified, and they are pure textual assertions over exact French strings — the most
   brittle shape there is. Run `pnpm --filter @pilotage/api test` from the main checkout and **reject a "0 tests"
   result as a failure, not a pass.**
2. **The GRANT half is conditional; the ledger entry is permanent.** `migration.sql` guards all 44 GRANTs on
   `has_app_user CONSTANT boolean := EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user')`. On a cluster where
   `app_user` post-dates the migration — which is the prod shape, since the container is provisioned with
   `POSTGRES_USER: pilotage` only — the policies land, the grants are skipped, and `_prisma_migrations` records the
   migration as applied, so Prisma never replays it. The cutover is then **not** a connection change: `app_user` gets
   `permission denied` on all 44 tables. Every gate in this diff runs against a scratch database where the checker
   creates the role first, so the one configuration that ships to production is the one no gate exercises. Before
   merging, on the dev cluster **and** the Hostinger prod Postgres:
   `SELECT rolname, rolsuper, rolbypassrls, pg_has_role('app_user','pilotage','USAGE') AS inherits_owner FROM pg_roles WHERE rolname = 'app_user';`
   — expect `f | f | f`. Any `t` means the GRANT must additionally gate on those attributes, because a role that
   inherits the owner bypasses RLS while every assertion above still reads green.

**Deferred, recorded rather than fixed** (follow-up story, none blocking): the header's rollback carries a second
literal copy of the 44-name array and the checker executes a *different*, discovery-based rollback, so the documented
one has never been run; `AC-7e` is proven by absence of a string in stdout while its sibling `AC-7d` requires a
positive match; the census assertions compare **counts**, not name **sets**, in the executed layer; `app.user` is
interpolated as an unquoted identifier into `CREATE ROLE`/`REVOKE`/`DROP ROLE`; and 44 × `ALTER TABLE … ENABLE ROW
LEVEL SECURITY` in one transaction takes `ACCESS EXCLUSIVE` across the schema, so the deploy note should say "quiet
window".

## `S-E01-2c` — the derived half, what it decided, and the one thing it does not prove

**Delivered.** `apps/api/prisma/migrations/20260813180000_tenant_rls_derived_policies/migration.sql` poses
`ENABLE ROW LEVEL SECURITY` + a `tenant_isolation` policy — same **name** as the 44, because the census counts by
name — on the **five** base tables that carry no `tenant_id` and hold a foreign key to a table that does:

| child | FK column | parent | index that already leads with the FK |
|---|---|---|---|
| `announcement_receipt` | `announcement_id` | `announcement` | `announcement_receipt_announcement_id_user_profile_id_key` |
| `branding` | `school_id` *(also the PK)* | `school` | `branding_pkey` |
| `grade_revision` | `grade_id` | `grade` | `grade_revision_grade_id_revised_at_idx` |
| `import_row` | `batch_id` | `import_batch` | `import_row_batch_id_row_index_key` |
| `user_role` | `user_profile_id` | `user_profile` | `user_role_user_profile_id_role_id_school_id_key` |

The predicate is `EXISTS (SELECT 1 FROM <parent> p WHERE p.id = <child>.<fk> AND p.tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid)`
— `ADR-032 §D6`'s inner expression reused **verbatim**, never restated. `USING` and `WITH CHECK` are identical **by
construction**: one `predicate` variable injected twice into one `format()`.

**Three corrections to the record, each re-measured against `pg_constraint` rather than relayed.**

1. **FIVE derive by FK, not six.** `outbox_event` holds **no** foreign key — polymorphic `aggregate_type` +
   `aggregate_id`, unconstrained. There is no path to predicate on and none was invented. It stays fail-closed, both
   its absent grant *and* its absent policy are **asserted by name**, and it is recorded as **`PF-185`**. Measured
   cost of deferring: **zero features** — `outboxEvent.` has no caller anywhere in `apps/**` or `packages/**`.
2. **No index needed creating.** R-11's precondition was already discharged for all five (table above); the slice
   **asserts** it instead of adding it.
3. **`user_role`'s tenant path is `user_profile_id`, never `role_id`.** The second FK leads to `role`, which carries
   no `tenant_id` — a dead end a transposed tuple would route into, which the migration's apply-time guards refuse.

**Two decisions the finding did not anticipate, and both are load-bearing.**

- **The obvious census formula is vacuous.** `RLS_ON == TENANT_COLS + DERIVED_POLICIED` passes on the exact defect it
  exists to catch (a sixth derived table shipped with no policy keeps both sides at 49). The agreement is therefore
  against **`DERIVED_EXPECTED`**, computed from `pg_constraint` *structure* — so a sixth raises the expectation while
  `RLS_ON` does not, and the gate goes red (`ADR-042 §D3`). `AC-5b` closes the one-level-deep hole by **set equality**
  against a named six-table residue, a *partition* check rather than a subtraction list.
- **`ON DELETE CASCADE` defeats append-only, and the slice says so rather than smoothing it over.** All five FKs are
  `CASCADE`; PostgreSQL runs RI actions as the referencing table's owner with RLS off, so `app_user` — holding
  `DELETE` on `grade` — removes `grade_revision` rows through the parent despite the child's `SELECT, INSERT` grant.
  The cascade **cannot cross a tenant** (the parent must be visible first), so it is tenant-safe and audit-unsafe.
  Recorded as **`PF-186`**, not fixed here.

**Deliberate divergence from this slice's own story spec, recorded rather than silent.**
`stories/S-E01-2c.md` §AC-4/§AC-12 prescribes `DELETE` for three of the five and a "closed set of exactly **three**"
privilege strings. `ADR-042 §D5` re-measured the call sites, found **zero** delete callers for any of the five
(`imports.service.ts` `rollback()` re-classifies with `update`; it removes no rows) and ruled **no `DELETE` for any of
the five**, a closed set of **two**. The migration, the ADR and the checker constant all agree on two.
**Read the story against `ADR-042 §D5`, which is the record; the story text has not been annotated.**

**NOT delivered, and the distinction is the point of the epic.**

- **The application is still not RLS-isolated.** Same sentence as after `S-E01-2b`, unchanged: owner connection, no
  `FORCE`, zero `withTenant` call sites. What remains is the **cutover**.
- **`outbox_event` carries no policy** (`PF-185`), and the grant must not be widened to silence a future
  `permission denied`. **⚠️ Dated state — true on 2026-08-13, no longer true.** `S-E01-2d` (2026-08-14, `ADR-044`)
  gave it a **denormalised** `tenant_id` and the ordinary policy of the 44. The sentence is kept as the state this
  slice left behind, not deleted — and note that the closure did **not** come from widening the grant, which is the
  branch this bullet was written to forbid: the policy landed **first** and is proven to deny before the grant exists.
- **`PF-183` is discharged for the five, and its residue is named** — `PF-185` and `PF-186`.

**⚠️ Conditions a human owns before this merges.**

1. **The checker's green is not established by this run's gate.** The gate ran `pnpm typecheck` (13/13 exit 0) and
   `git diff --check` only. One reviewer reports `node scripts/rls-isolation-check.js` exiting 0 with 97 assertions;
   the escalation panel records the opposite — *"964 lines of new checker are landing whose green nobody has
   observed"* — and `OPEN.md`'s `PF-183` row still says the executed proof *"has not run yet"*. **Those three
   statements cannot all be true.** Run it from the main checkout against the local PostgreSQL, with an operator
   watching (it creates and drops a scratch database), and confirm `RLS_ON = POLICIES = GRANTED` derived as **44 + 5**
   before anyone closes `PF-183`. Two of the new fixture chains are deep (`grade_revision` ≈ 11 rows/tenant); a
   fixture FK violation there surfaces as `ToolingUnavailable`, **not** as a security failure.
2. **The three foreign-INSERT `WITH CHECK` proofs attribute on a session-global regex.** `rls-isolation-check.js:1398`
   (`school`) and `:1428` (the loop over `branding`, `announcement_receipt`) both decide PASS on
   `/violates row-level security policy/i` tested against the **whole** `psql` session's stderr, under
   `onErrorStop: false`. The `school` rejection earlier in the same run satisfies that regex permanently, so a
   `branding` or `announcement_receipt` INSERT that fails for **any other reason** (23502, 23503, 23505, or a `25P02`
   aborted transaction) still records "REJECTED by `WITH CHECK`". The positive controls keep the security *property*
   honest; the hole is in the **proof**, on the slice whose entire claim is "proven by execution". One-line repair per
   site: match the table PostgreSQL already names —
   `new RegExp('violates row-level security policy for table "' + child + '"', 'i')`.
3. **The `has_app_user = false` branch of the migration is unexercised** — the checker creates the role *before* the
   scratch database, so the guard is always true. On a cluster where `app_user` post-dates the migration, the five
   policies land, the five GRANTs are skipped with a `RAISE NOTICE`, and `_prisma_migrations` records the migration as
   applied. This is the same condition `S-E01-2b` left open, now covering 49 tables instead of 44.
4. **`SET lock_timeout = '5s'` at `migration.sql:316` is session-scoped, not `SET LOCAL`.** `prisma migrate deploy`
   applies the whole ledger on one connection, so every migration appended after this one inherits the 5 s bound.

**Recorded, not fixed** (doc drift this slice leaves behind, all cheap): `NEXT.md:36-41` still says all **six** derive
by FK and still names `outbox_event` — the migration header at `:221` claims that prose was *"corrigée sur place"* and
it was not; `OPEN.md`'s `PF-183` row lands stale in the same commit that refutes it; `stories/S-E01-2c.md` §AC-4 still
prescribes the superseded three-privilege set; `prisma.service.ts:245`'s `withTenant` doc block still says all six
derived tables *"restent NON protégées"*, which is now false for five of them; and `ADR-042:157` claims the four
reference tables are asserted un-granted **by name** when only `outbox_event` actually is — the rest rest on the
aggregate count.

## `S-E01-2d` — the last table, what it decided, and the one path that has never run

**Delivered.** `apps/api/prisma/migrations/20260814120000_outbox_event_tenant_scope/migration.sql` gives
`outbox_event` a **denormalised** `tenant_id` and the ordinary `tenant_isolation` policy of the 44. The order inside
the migration is the argument: `ADD COLUMN` nullable → guarded backfill → `SET NOT NULL` →
`outbox_event_tenant_id_fkey` (`ON DELETE CASCADE ON UPDATE CASCADE`, the name Prisma itself emits so `migrate diff`
does not red) → the `(tenant_id, status, created_at)` index **verified before** RLS is enabled (R-11) →
`ENABLE ROW LEVEL SECURITY` + the policy, predicate reused **verbatim**, `USING` ≡ `WITH CHECK`, `FOR ALL TO PUBLIC` →
`GRANT SELECT, INSERT, UPDATE` guarded on `pg_roles`, with **no `DELETE`** and `OUTBOX_DELETE = 0` asserted.
`schema.prisma` gains `OutboxEvent.tenantId`, the `Tenant` relation, `@@index([tenantId, status, createdAt])`, and
keeps `@@index([status, createdAt])`. Ships **`ADR-044`**, which discharges `ADR-042 §D7`.

**Four decisions, each measured rather than inherited.**

1. **Denormalisation, not an invented FK path.** `aggregate_type`/`aggregate_id` are polymorphic and unconstrained —
   `0_baseline` gives the table a primary key and nothing else. There is no path to predicate on, so `ADR-042 §D7`'s
   deferral is discharged **on its own terms** instead of reversed by fabricating one.
2. **One migration, not the expand/contract two `PF-185` sketched.** Expand/contract exists to protect **live
   writers**; `outboxEvent.` has **zero** callers anywhere in `apps/**` or `packages/**`, so a split would only leave a
   security discriminant nullable in production for a deploy cycle. `ADR-044 §D2` writes down when the split becomes
   mandatory again — the day a producer exists.
3. **The backfill refuses to guess and refuses to delete.** It assigns only on a single-tenant database; otherwise it
   `RAISE EXCEPTION`s with the exact orphan count and hands the call to an operator. Deleting is silent data loss;
   "assign to the first tenant" is the fiction `ADR-042` refused.
4. **The census moved with no literal edited.** `TENANT_COLS` is read from `information_schema.columns`,
   `DERIVED_EXPECTED` from `pg_constraint`, so `44 + 5` became `45 + 5` and `RLS_ON == POLICIES == GRANTED == 50`
   followed from the catalog. This is the **first real exercise** of the form `ADR-042 §D3` was built for; the earlier
   slices could only assert it *would* behave so.

**The asymmetry, stated so nobody reads a policy count as equal protection.** For the five FK-derived tables of
`S-E01-2c` the tenant is derived from a path the **database** enforces. Here `tenant_id` is the *only* thing
attributing a row, and it is whatever the writer put there — a row carrying tenant A's `tenant_id` and tenant B's
`aggregate_id` is legal and invisible to PostgreSQL. Outbox isolation is enforced **at the write site**; the policy
constrains the discriminant, not the payload. `ADR-044` says this in its own words (*"l'attribution n'est pas
re-dérivable"*), and no `CHECK` can close it while the reference is polymorphic.

**⚠️ Three conditions a human owns before this merges.**

1. **The backfill has never executed a meaningful line, anywhere — and that is the one path touching pre-existing
   data.** The checker applies the whole ledger to a **fresh** scratch database and inserts fixtures **after**
   (`scripts/rls-isolation-check.js:1498`), so when this migration runs `tenant` = 0 rows and `outbox_event` = 0 rows:
   the `IF tenant_count = 1` branch is skipped, `orphans = 0`, the `RAISE` is skipped. The real local `pilotage`
   database has `tenants=0, outbox_rows=0` and has never had this migration applied. So the header's explicit operator
   promise — *"fait ÉCHOUER le `migrate deploy` avec le compte exact ; un opérateur tranche, pas la migration"* — is
   backed solely by `expect(OUTBOX_MIGRATION_CODE).toMatch(/RAISE\s+EXCEPTION/i)`: a grep over a string, on the slice
   whose whole doctrine is *proven by execution*. Add **`AC-BACKFILL`** with its own scratch database (apply
   `migrationFiles().slice(0, -1)`, seed, then apply this migration alone), failing loudly rather than skipping
   (DNC-10):
   **case A** — mono-tenant + 1 pre-existing row → migration SUCCEEDS and the row carries **that tenant's id**, with
   `attnotnull = true` (nothing today proves it writes the *right* value rather than merely not crashing);
   **case B** — two tenants + 1 orphan → `migrate` FAILS with the count and `ADR-044 §D2` in stderr, **and the DDL did
   not half-apply** (no policy, `relrowsecurity = false`, `tenant_id` not `NOT NULL`), which is what turns "an operator
   decides" into a verified state and proves a failed deploy is re-runnable rather than wedged.
   Cheap once that harness exists: **case C** — zero tenants + 1 orphan must also fail (that is the current shape of
   the local DB); and a **replay** case, the only execution of the `IF NOT EXISTS` / `DROP POLICY IF EXISTS`
   replayability claim, which is likewise grep-only today.
2. **The one mutation this design newly enables is not proven.** `GRANT UPDATE` is **table-level**, never
   column-level, so the same grant the relay needs for `status`/`sent_at`/`attempts` also lets the application role
   write `tenant_id` — and `tenant_id` is the only attribution the row has, with no FK path and no corroborating child
   row to reconcile against, so a cross-tenant reassignment would be permanent and undetectable. The explicit
   `WITH CHECK` (byte-identical to `USING`) rejects it, and the catalog-wide `WITH_CHECK_NULL = 0` / `QUAL_MISMATCH = 0`
   assertions now cover this table automatically. But the executed proof covers foreign **INSERT** and foreign
   **UPDATE** only. Mirror `rls-isolation-check.js:886` as **`OUTBOX_CROSS_UPDATE_ACCEPTED`** inside a savepoint, with
   an OWNER-side confirmation that A's row still carries `tenant_id = A`. It must land **before `S-E01-1`** flips the
   connection to `app_user`, which is the moment the control stops being inert.
3. **This slice was implemented against a story spec that does not exist.**
   `docs/spec/features/v3-e01/stories/S-E01-2d.md` is absent — `docs/spec/features/v3-e01/stories/` holds only
   `S-E01-2b.md` and `S-E01-2c.md`. The ACs the reviews cite (AC-7 privileges, AC-8 cascade FK) are reconstructible
   only from `ADR-042 §D7` and the `PF-185` row in `OPEN.md`. The implementation is right; the *contract* it was
   measured against was never written, and a no-op or an over-claim justified against an absent spec is unverifiable.
   That gap belongs to the planning phase and must not repeat on `S-E01-1`.

**The gate's own PASS was vacuous, and the record must not be read as `S-E01-2c`'s was.** `pnpm typecheck` reported
`13 successful, 13 cached — FULL TURBO` in 1.281 s: every package was a cache replay, because the diff was written
into the **main checkout** while the gate measured the session worktree (the known bidirectional worktree-path
hazard). `S-E01-2c` recorded a genuine cache **miss** that compiled its new spec; this run did not. The compile was
then forced by hand — `tsc --noEmit` → 0 and `tsc --noEmit -p prisma/tsconfig.json` → 0 in `apps/api` — and the
generated client was inspected directly (`OutboxEvent.tenantId` present, mtime after the schema edit), so `P-05` is
closed by observation rather than by a green nobody produced.

**Recorded, not fixed** (none blocking, all named): the four RLS-rejection assertions at
`scripts/rls-isolation-check.js:1591`, `:1621` (×2) and `:1649` test `/violates row-level security policy/i` against
the **same** `proof.stderr`, so the `school` violation raised earlier in the run satisfies the outbox branch — the
decisive direction is safe (the acceptance marker's absence plus an owner-side count), but the assertion is weaker
than its wording; one regex per site naming the table PostgreSQL already names. `ADR-044 §D3` justifies `SELECT` and
`UPDATE` by "the relay must read what it has to publish", but an outbox relay is inherently **cross-tenant** and this
policy returns **zero rows, forever, silently** to a context-free `app_user` after the cutover — so two of the three
privileges rest on a relay design that has not been chosen (owner-run vs per-tenant GUC loop); the retained
`(status, created_at)` index hedges one way and the new `(tenant_id, status, created_at)` index the other.
`ON DELETE CASCADE` on `tenant → outbox_event` destroys **undelivered** events when a tenant is closed, and an
undelivered RGPD-erasure event is exactly the one that still has meaning after the tenant is gone — no tenant-delete
path exists in code today, so this is a note for whoever writes the first producer. Finally: a `RAISE` in the backfill
marks the migration **failed** in `_prisma_migrations` and blocks subsequent `migrate deploy` until
`prisma migrate resolve` — a runbook line, so an operator hitting the fail-loud branch does not read it as corruption.

## `S-E01-3` — what it proves, what it refuses to claim, and the three thresholds a human owns

**Delivered.** `scripts/tenant-adversarial-check.js` seeds **two real tenants** on a disposable scratch database,
applies the whole migration ledger, connects as the non-owner `app_user`, and then does the thing no previous slice
did: it **enumerates the tables from the live catalog of that database** rather than from a list in the file — 45 by
`tenant_id` column + 5 by FK path = **50** — and runs `SELECT`, `INSERT`, `UPDATE`, `DELETE` against each, under GUC =
A and GUC = B, with the **positive control asserted first**. 675 assertions, 4 named limits, 0 failures, exit 0,
three consecutive runs byte-identical modulo the generated scratch name.

> **Annotated by `S-E01-1b`, which merged next and moved every number in this section.** The census is now
> **45 + 7 = 52**, the derivation is **transitive**, and `UNCOVERED_EXPECTED` holds two names instead of none. The
> paragraph below on the rebase is what predicted this — it happened again, in the same shape, one slice later, and
> the same repair applied: **the disagreement was fixed at the layer that caused it, not at the assertion.** Details
> under `S-E01-1b — the rebase, the second time`.

**Four shapes carry the whole value, and each closes a false green this programme has actually met.**

1. **The expected outcome per `(table, verb)` is read from `role_table_grants`.** Without it, a `42501` from a
   **missing** privilege scores as a denial — the audit-log carve-out (`SELECT, INSERT` only) would make
   `audit_log` look maximally isolated for the wrong reason. With it, a **widened** grant also fails, so the append-only
   split is now guarded in both directions rather than one.
2. **`COVERED`/`UNCOVERED` is a set-equality partition**, against an empty `UNCOVERED_EXPECTED` with a
   `MIN_COVERED_TABLES = 40` floor. A table a future migration adds lands in `UNCOVERED` and turns the stage red
   instead of being silently unmeasured. **This ratchet is the suite's headline property and it is the one thing not
   proven by execution** — see condition 4 below.
3. **Fail-before/pass-after is EXECUTED, not asserted.** `MUTANT_KILLED` disables RLS on `public.school` inside a `DO`
   block guarded **server-side** by `current_database() !~ '^tenant_adversarial_'`, watches the foreign-row probe go
   `0 → 1`, restores, and watches it return to `0`. A textual claim that the suite "would catch" a broken policy is
   what `PF-02` was; this is the executed form of the same sentence.
4. **A table with no seeded row for the second tenant is named `UNCOVERED`, never counted as three green denials on an
   empty table.** Emptiness is the cheapest way to be green about nothing.

**What it deliberately does NOT claim, printed on the GREEN path as four `[LIMIT]` lines.** The banner refuses the
word *isolated* unqualified. `PrismaService.withTenant` has **0 production callers out of 722 Prisma call sites**;
the **owner bypass** is asserted as a **present** leak on two tables, with an inverted assertion that goes RED the day
`FORCE` lands; and production code reaches **three** tables ungranted to `app_user` (`role` ×7, `permission` ×3,
`tenant` ×2), which become `42501` on the AuthZ path at the **first request after the cutover**. That honesty is the
best part of the diff, and it is the reason this row closes `VAL-02`’s DATABASE half without touching `PF-02` half (a).

> **Annotated: the third limit is GONE, and the way it went is the point.** `S-E01-1b` granted those three tables
> `SELECT` (`ADR-046 §D5`) and the block **re-measured itself** — `AC-9 CUTOVER READINESS: no production Prisma call
> site reaches a table ungranted to app_user — checked 0 ungranted table(s)`. Nobody edited the block: the ungranted
> set is read from `information_schema.role_table_grants` on the live database, so a `[LIMIT]` written against a
> measurement turned into an `[OK]` the moment the measurement changed. `PF-189` is closed on that evidence. The
> **other three limits stand**, `withTenant` at 0/722 included.

**The rebase is the durable lesson, and it belongs in this file more than the suite does.** The branch was first
measured at `51b4634` — **before `S-E01-2d` (`e53f2d9`) merged** — and its first evidence line (*"661 assertions,
44 + 5 = 49"*) was true of a tree that no longer existed. On the merged ledger `outbox_event` carries a `tenant_id`,
so the live-catalog census returned it, `PLAN` did not attempt it, and **three named assertions were red**. Review
caught it; no run did, because the run that would have caught it was never taken on the merged tree. The repair was
made at the schema layer rather than patched: `outbox_event` joined `PLAN` as the 45th ordinary tenant-bearing table,
the privilege matrix takes its `INSERT|SELECT|UPDATE` from **`ADR-044 §D3` by name** instead of the `FULL_DML`
default (so the withheld `DELETE` is asserted), and the old fail-closed probe was **deleted** — after `ADR-044` a
`permission denied` there would be a MISSING GRANT, the exact reading this suite exists to refuse. **An evidence line
is only true of the tree it was measured on.**

**⚠️ Four conditions a human owns before this merges.**

1. **`AC-9 CUTOVER READINESS` is guarded by bare zero-thresholds, in the one block whose purpose is to stop a false
   "safe to cut over" reading.** `readiness.withTenantCallers === 0` emits `[LIMIT]`; anything else emits an
   affirmative green line. So the **first** `.withTenant(` call site added anywhere flips the block from a named limit
   to a claim of readiness while 721 of 722 call sites still set no GUC — `PF-02`'s own failure mode, reproduced
   inside the machine-readable block built to prevent it, and inconsistent with the file's own `MIN_COVERED_TABLES`
   floor discipline. `readiness.prismaCallSites` is computed and printed but **never asserted**, so a regex that stops
   matching call sites degrades the denominator silently. Express `AC-9` as a **ratio with a floor**, or hard-pin it
   as a `[LIMIT]` only `S-E01-1` may discharge. Do not let it self-clear.

   > **✅ Discharged, and the resolution is NOT the one this paragraph proposed.** Run 54 replaced the zero-threshold
   > with a **wall** rather than a *ratio with a floor* — a floor is a knob, and a knob here is a bypass flag wearing a
   > different hat (`DNC-10`). `S-E01-1d (b)` then fixed the remaining half of the sentence: the **unit**. The old input
   > counted the string `.withTenant(`, i.e. scope OPENINGS, and four openings in `calendar.controller.ts` cover six
   > call sites — so it under-reported by construction, which is why the text above reads
   > `readiness.withTenantCallers === 0`. It is now `scopedCallSites` (sites **attributed** to a brace-matched callback
   > range) `+ enumeratedCallSites` (sites named in `ENUMERATED_OUTSIDE_SCOPE`, **each with its reason**)
   > `=== prismaCallSites`. Measured on 2026-08-15: **6 scoped + 113 enumerated / 794 across 226 files** — a truthful
   > `[LIMIT]`, which is the deliverable; a green there would have been the finding. `ADR-048 §D6`.
2. **Every could-not-run condition exits `2` (`not_isolated`), never `1` (`tooling_unavailable`).** Teardown and
   precondition problems call `fail()`, so they land in the same `failures` array as isolation breaches, and
   `report(failures.length === 0 ? 'isolated' : 'not_isolated')` then prints *"NOT PROVEN — cross-tenant access was
   not refused as required"*. A leftover `app_user` backend after the bounded 5 s quiesce poll, a refused
   `DROP DATABASE`/`DROP ROLE`, a migration that will not apply, or a schema below the floor all page as a **tenancy
   breach**. This contradicts `AC-9`'s three distinguishable codes and `FR-11`'s promise that the drop reports its own
   verdict. One `toolingFailures[]` accumulator fixes it.
3. **The new `ci-gate.sh` trigger's `\.env` alternative is dead by construction, and half the comment leans on it.**
   `.env` is gitignored, and `CHANGED` is built from `git diff --name-only` + `git status --porcelain`, neither of
   which lists ignored paths — so that arm can never fire. Real coverage of the `S-E01-1` cutover diff rests
   **entirely** on `apps/api/src/shared/prisma/`, and the tracked files that actually carry a deployable
   `DATABASE_URL` — `infra/docker-compose.yml` and `.env.example` — are **not** in the regex. A cutover done the
   deployment way (flip the DSN in compose, no `prisma.service.ts` edit) prints `skip_stage` and the gate passes green
   on precisely the diff this suite was built to protect. Note also that the `ci.yml` half runs unconditionally and is
   unaffected — but GitHub Actions has been billing-locked since 2026-07-28, so `ci-gate.sh` is the only wiring that
   actually executes today.
4. **The census ratchet — property (2) above — is the one claim not proven by execution.** `notAttempted` is a single
   `filter`, its correctness argued in prose inside a label string and pinned textually by a `toContain` in the guard
   spec. Invert it and every tenant-bearing table added by every future migration escapes this suite **silently and
   permanently** while 675 assertions stay green about a schema the suite no longer covers. The fix is an `AC-8b`
   census mutant in the block that already owns `guardedMutation()`: create a throwaway tenant-bearing table, re-run
   the census SQL, assert it appears in `notAttempted`, drop it. ~0.3 s on a 20 s suite, exactly reversible, no new
   flag.

**Recorded, not fixed** (none blocking, all named): `APPEND_ONLY_TABLES` is re-declared locally although the sibling
exports the identical literal — the drift `ADR-042 §D3` forbids, in the one file that argues for `require()`-ing
constants rather than re-typing them; the AC-8 success message names `CTX_A_FOREIGN_school` while the probe's label is
`MUT_FOREIGN_school`, and the wrong name propagated into `ADR-045` and both ledgers; two fixture slots collide
(`student3` and `outboxEvent` both `65`), harmless today but breaking the file's own one-slot-per-row invariant;
`PSQL_TIMEOUT_MS` equals the 300 s stage budget, so the script's own named timeout diagnosis can never be reached
under `ci-gate.sh`; `CREATE ROLE`/`DROP ROLE` interpolate the role name as an unquoted identifier (carried verbatim
from the merged sibling, so a replicated pre-existing pattern rather than a regression); `ADR-045 §D1`'s concurrency
guarantee covers the scratch **database** names but not the cluster-wide **role**, which both scripts create and drop
under the same guard. Finally: `.gitattributes` pins `*.ts`/`*.sh`/`*.yml` to `eol=lf` but **not `*.js`** — a
repo-wide renormalisation is the real repair, deliberately not taken here.
## `S-E01-1b` — the reference surface: what landed, and what it deliberately did **not**

**Run 56, 2026-08-14.** Ships `apps/api/prisma/migrations/20260814180000_role_reference_surface_rls/`, `ADR-046`,
two `schema.prisma` relation fields plus one index, and the harness/spec work that proves all of it.
**This slice does not perform the cutover.** `DATABASE_URL` is untouched, the application still connects as the table
owner, `FORCE ROW LEVEL SECURITY` is still absent, and no runtime module under `apps/api/src` changed behaviour.

**What was blocking, in the code's own words.** `20260813120000_tenant_rls_policies` §LES GRANTS: *« Le jeu de GRANTs
est DÉLIBÉRÉMENT INCOMPLET pour la bascule … la première jointure d'autorisation échouerait. »* Measured, as
`app_user`, against the full ledger without this migration: `ERROR: permission denied for table role`.

**Three premises of that sentence were re-measured, and three were wrong or stale.**

1. **`user_role` is no longer ungranted** — `S-E01-2c` made it one of the five derived tables; it holds
   `SELECT, INSERT, UPDATE`. Verified in that migration's tuple, not inferred from the prose.
2. **`role` was mis-classified as globally scoped — `PF-191`.** `role.school_id` → `school.tenant_id NOT NULL`. A bare
   `SELECT` grant would have been a cross-tenant read at the second of the cutover.
3. **`role`'s foreign key is not "nullable" — there is none.** `pg_constraint` returns zero `contype='f'` rows for
   `role`, and `schema.prisma` declared no `@relation`. That absence is precisely what hid (2) from the structural
   derivation, and the harness had already written the remedy down: *"the day ADR-015 custom roles add
   `role_school_id_fkey`, `role` correctly ENTERS the derived set."*

And a fourth, from the story's own AC-3: **the by-slug `tenant` read the exclusion was built around no longer
exists.** After `S-E01-1a` there is no by-slug `tenant` read anywhere in `apps/api/src`. So the "preferred"
`SECURITY DEFINER` lookup function would have shipped with **zero callers** — a standing privilege-escalation surface
added for a problem already solved. It was **not written** (`ADR-046 §D4`), and the plain `id = <GUC>` policy closes
the enumeration oracle by execution: `NOCTX_TENANTS|0`.

**The finding this slice created for itself, and closed before shipping it.** Once `role` becomes tenant-derived,
`role_permission` is the **two-level** residue that a one-level derivation cannot see — and the story as written put it
in the granted-but-unpolicied surface. Executed, as `app_user` under `GUC = tenant A`, against a `role_permission` row
belonging to tenant B's custom role: **`A_SEES_B_ROLEPERM|1`** — tenant B's custom-role ids *and their full privilege
composition*. It is closed by its own two-hop policy, written out in full rather than leaning on `role`'s policy
(`ADR-042 §D1` clause 3 applied one level deeper), and by making the derivation **transitively closed** on both sides
— a recursive CTE in the checker, a fixpoint in the hermetic spec. `ADR-042 §D3` is annotated in place.

**The census agreement moved without a literal being edited**, which was the load-bearing acceptance criterion:

```
BEFORE   TENANT_COLS|45   DERIVED|5 (…, user_role)              RLS_ON|50
AFTER    TENANT_COLS|45   DERIVED|7 (… role, role_permission)   AUTODISC|tenant   RLS_ON|53
```

**The mutation check earned its place.** Three predicate defects were injected and the harness re-run on each. Two went
red immediately. **The third — deleting `AND s.tenant_id = <GUC>` from `role`'s predicate, a real cross-tenant defect —
left the harness entirely green, exit 0.** Not from a missing assertion: every visibility assertion runs as `app_user`,
and there the `school` sub-query is *already* filtered by `school`'s own policy, so the clause is genuinely dead code
for that role. It is the **owner** — migrations, seeds, and the whole application today — for whom it is the only thing
working. `ADR-042 §D1` clause 3 said so in prose; this run turned it into an executable assertion that reads the
**installed** predicate back with `pg_get_expr` and evaluates it as the owner. Re-run: **3 injected, 3 killed.**

**NOT delivered, and named rather than left silent.**

- **The application is still not RLS-isolated.** Same sentence as after `S-E01-2b`, `2c` and `2d`. What remains is the
  cutover — and it now has **two named blockers instead of an unnamed one**: `PF-193` (`roles.controller.ts` writes
  `role` / `role_permission`, and this slice grants `SELECT` only) and `PF-185` (`register.controller.ts` upserts
  `tenant` by slug). Both refusals are **executed**, in a separate `psql` process, so they cannot be discovered under
  cutover pressure.
- **The `role` policy isolates a shape the product cannot currently create.** `roles.controller.ts` never sets
  `schoolId`, so every role it makes is a *system* role and falls in the `IS NULL` branch. Named in `ADR-046 §D3` as
  `PF-08` / `ADR-015 D8.6` territory; fixing it would be a product-behaviour change disguised as a migration. The
  forbidden repair — making `school_id IS NULL` **deny** — would hide every seeded role and lock all four portals out.
- **With no tenant context, `app_user` reads every system role and every `permission` row.** Intended (global
  reference data), recorded, and paired with the control that makes it meaningful: `NOCTX_SCOPED_ROLE|0`.
- **`ON DELETE CASCADE` changes what deleting a school does** — its custom roles now go with it, where they were
  previously orphaned. Chosen deliberately (an orphan would be invisible to *every* tenant, i.e. a wrong answer rather
  than a denial), executed rather than asserted, and live risk is zero: `role` holds no rows.

### `S-E01-1b` — the rebase, the second time, and why the repair went in the derivation and not in the assertion

**This slice was measured on `e53f2d9` and `S-E01-3` (`fd11481`, `ADR-045`) merged underneath it.** Everything above
was therefore true of a tree that no longer existed — the same sentence `S-E01-3` wrote about itself one slice
earlier, in this same file, about its own stale base. Two runs in a row, so it is a property of the routine and not
of a slice: **parallel tracks allocate against `main` and measure against `main`, and the thing that breaks is the
consumer neither of them can see.**

**What actually broke, and it was not a count.** `S-E01-3` shipped `scripts/tenant-adversarial-check.js`, which
`require()`s eight constants from `scripts/rls-isolation-check.js` *precisely so the two cannot disagree* — and then
carried its **own, hand-written, ONE-LEVEL** census SQL for the FK-derived set. That second query agreed with the
imported `DERIVED_TABLES` for exactly as long as no derived table had a derived child of its own. `role_permission`
is that child. So the moment this slice closed the derivation **transitively**, the constant said 7 and the query
said 6, and **four independent set-equality assertions went red** — the derived set, the residue, the privilege
matrix, and the `COVERED`/`UNCOVERED` partition — in a suite this branch had never run.

**The repair is the part worth keeping.** The cheap fix was to patch the four literals. What landed instead:
`DERIVED_SET_SQL` and `AUTO_DISCRIMINANT_SQL` are now **exported by the sibling and imported**, exactly like the
constants beside them, so the derivation has **one** definition rather than two. `ADR-042 §D3` forbade two literals
for one set; this is the same rule one layer down — two *queries* about one catalog fact — and it had to be paid for
before it was seen. The privilege matrix gained the reference surface as **named groups**
(`AUTO_DISCRIMINANT_PRIVILEGES`, `REFERENCE_PRIVILEGES`, both imported), never by relaxing the equality to a superset
check, which is the locally cheapest repair and the one that would delete the only barrier to
`GRANT … ON ALL TABLES IN SCHEMA public`.

**`role` and `role_permission` are NAMED in `UNCOVERED_EXPECTED`, and that is a decision, not a shortcut.** Every
table in that suite's `PLAN` is driven on four verbs, and its INSERT branch is a **hard failure** when the grant is
missing — deliberately, because a table it cannot write is a table whose denials are vacuous. `ADR-046 §D5` grants
these two `SELECT` and nothing else. Seeding them into `PLAN` would have meant relaxing that branch: a real
protection traded for a coverage number. They are proven **by execution** in the sibling instead, cross-tenant read
included. `ADR-045`'s own `Consequence` clause prescribes exactly this move, so it was used rather than amended.

**Measured after the rebase, on the merged tree** — the only tree whose measurement is worth anything:
`node scripts/tenant-adversarial-check.js` → **exit 0**, twice, `45 tenant-bearing + 7 FK-derived = 52`,
`RESIDUE = permission`, `AUTODISC = tenant`, `COVERED = 50` against a floor of 40, privilege matrix equal by set on
all 54 granted tables, three named `[LIMIT]` lines and no fourth.

## `S-E01-1c` — the write surface: what the database now refuses, and the one write it still accepts

**Delivered.** `apps/api/prisma/migrations/20260814210000_role_write_surface_rls/migration.sql` grants `app_user`
`INSERT, UPDATE, DELETE` on `role` and `INSERT, DELETE` on `role_permission` — and, in the same migration, makes a
**SYSTEM** role unwritable by anything below the handler. Six policies, one family name, three commands, two tables,
all `AS RESTRICTIVE … TO PUBLIC`:

```sql
CREATE POLICY system_role_write_guard_delete ON public.role
  AS RESTRICTIVE FOR DELETE TO PUBLIC USING (role.is_system = false);
```

and on `role_permission` the parent hop written out in full
(`EXISTS (SELECT 1 FROM public.role r WHERE r.id = role_permission.role_id AND r.is_system = false)`) rather than
leaning on `role`'s own policy — because the owner connection runs under no policy at all, so leaning would have been
a promise, not a guard. Ships **`ADR-047`**.

**Four decisions, each argued from a composition rule rather than from taste.**

1. **`AS RESTRICTIVE`, and this is the whole slice.** Permissive policies for a command are **OR**-ed. `role` already
   carries the permissive `tenant_isolation … FOR ALL`, so a *second permissive* policy with a narrower predicate
   narrows **nothing** — it is a guard that does nothing, silently. `WRITE_GUARD_PERMISSIVE == 0` is therefore the
   single most load-bearing assertion in the diff, and it is executed.
2. **Divergent `USING`/`WITH CHECK` on the one `FOR ALL` policy was considered and rejected by behaviour, not by
   style.** It refuses the `INSERT` of a system role and the `UPDATE` of one — and **cannot refuse `DELETE`**, because
   PostgreSQL consults `USING` only. Deleting a system role, and deleting its `role_permission` rows, would both be
   accepted. That is the entire finding, so the cheap shape is out (`ADR-047 §D3`).
3. **Not a per-command split of `tenant_isolation` either.** A `FOR SELECT` or `FOR DELETE` policy has
   `polwithcheck IS NULL` **by construction**, so `WITH_CHECK_NULL == 0` and `QUAL_MISMATCH == 0` would go red — and
   each has a locally cheap repair that deletes a real protection. The `tenant_isolation` object is **not touched at
   all**; the effective write predicate is `tenant_isolation`'s predicate **AND** the guard, composed by the engine
   instead of by string concatenation. `SELECT` gains no restrictive policy, so reads are bit-for-bit yesterday's.
4. **`FOR UPDATE` ships on `role_permission` although no `UPDATE` is granted.** There is no `rolePermission.update*`
   call site anywhere in `apps/api/src` or `apps/worker/src` — measured, and it is why the grant is three verbs and
   not four. The guard is nevertheless complete **by command**, so widening the grant later cannot open a hole in one
   line. The reverse — a grant with no matching guard — is how this class of defect gets in.

**`ADR-042 §D5` is amended, not relaxed.** `DERIVED_DELETE == 0` (*"a privilege with no caller is pure blast radius"*)
becomes a **set equality in both directions** against a named `DERIVED_DELETE_ALLOWED = ['role','role_permission']`,
each name carrying its call site. A third derived table acquiring `DELETE` still fails the gate, with its name
printed — which is what the original assertion was for.

**Two harness defects fixed on the way, and neither is cosmetic.** The `SHARED_ROLE` fixture never set `is_system`,
so **every** "a SYSTEM role is refused" assertion in the sibling checker was vacuous. And `cutoverReadiness` anchored
its scan on `\bprisma\.`, which cannot see a single `tx.` call site — all five `PF-193` writes are `tx.` calls. That
second one is **`TOOL-32`**, closed here: `AC-9 CUTOVER READINESS` aggregated `privilege_type` per table but tested
only table-level reachability, so a table granted `SELECT` and *written* by production code **passed**.

**The harness also falsified the brief that commissioned it, and no id was spent.** `PF-195`/`PF-196` were
pre-allocated on the premise that the 44 tenant-scoped tables hold `SELECT, INSERT` only. The checker measured
`20260813120000:480` and found `UPDATE` and `DELETE` there, so the premise is false and the findings were **not
written**. `S-E01-1c.md` §8 still asserts the false premise and is the file a traceability matrix would be written
from — read it against `AC-11`'s executed line, which is the record.

**NOT delivered, and the distinction is again the point of the epic.** The application still connects as `pilotage`,
the table owner, exempt from every policy while `FORCE ROW LEVEL SECURITY` is absent. `DATABASE_URL` is untouched, no
runtime module changed, and `withTenant` still has zero production call sites. `tenant` and `permission` stay
`SELECT`-only **by decision** (`ADR-047 §D6`): granting `INSERT` on `tenant` would make the application role able to
**mint** tenants, which is `PF-185` made permanent, and §D1's narrowing argument does not transfer to a capability
that has no policy to bound it.

**⚠️ Five conditions a human owns before this merges.**

1. **`PF-194` — the cross-tenant CUSTOM-role write, accepted, and proven accepted by execution.** The six guards
   constrain `is_system` and **nothing else**; they add zero tenant predicate on the write path. `role`'s permissive
   predicate is `school_id IS NULL OR <school in tenant>`, and `roles.controller.ts:154` **never sets `schoolId`** —
   so *every role the product can create* takes the `IS NULL` branch, which is admitted for **every** tenant. After
   the cutover, tenant A may `UPDATE` or `DELETE` tenant B's custom role and rewrite its `role_permission` set. The
   harness executes exactly that and asserts it **SUCCEEDS** (`W_PF194_UPDATE`, `W_PF194_DELETE_ROWS`,
   `OWNER_PF194_ROLE_GONE`, `OWNER_PF194_USER_ROLE_GONE`), which is the right disposition — a limit proven is a fact,
   a limit written in a comment is a hope. It is **not** a regression (today's owner connection does the same under
   no predicate at all) and it is **not fixable here** (the fixes are `role.tenant_id`, refused in `ADR-047 §D7`, or
   making the controller set `schoolId`, which is `PF-08` / `ADR-015 D8.6` product territory). **But it must be
   GREEN-inverted before `S-E01-1` flips `DATABASE_URL`**: add the assertion that the cross-tenant `UPDATE`/`DELETE`
   is *refused*, with an owner-side read-back (`OWNER_XT_ROLE_UNCHANGED`, `OWNER_XT_USER_ROLE_ALIVE`). Today it would
   fail by design; at the cutover it stops being a documented deferral and becomes a live cross-tenant write
   primitive on the authorization surface itself. Note the amplification, also executed: `user_role_role_id_fkey` is
   `ON DELETE CASCADE` and RI triggers run with row security **off**, so the `DELETE` silently revokes tenant B
   users' role assignments even though `user_role` grants no `DELETE`.
2. **`user_role.role_id` is the same escalation one table over, and it is named nowhere in this diff.** `app_user`
   already holds `SELECT, INSERT, UPDATE` on `user_role`, whose policy path is `user_profile_id → user_profile.tenant_id`
   only — `role_id` is deliberately **not** on the path (`ADR-042 §D2` / `ADR-046 §D2` refused it, because routing
   through it would leak system-role assignments cross-tenant). So after the cutover a single
   `INSERT INTO user_role (user_profile_id, role_id) VALUES (<my own user>, <a super_admin system role>)` passes every
   policy in the database, and the only thing between that and a self-granted `super_admin` is
   `users.service.ts:125` (`isLadderRole` → `assertMayConferRealmRole`) — *exactly* the "layer a handler can forget"
   that `ADR-047 §D2` says the database must not depend on. Composed with this diff's two grants there is a second
   path with no system row touched at all: `INSERT` a custom role (`is_system = false`, guard passes) → `INSERT`
   `role_permission` rows for **any** `permission` id (the guard checks only the parent's `is_system`;
   `assertWithinCeiling` is application-layer and has no database counterpart) → `INSERT` a `user_role` binding it to
   your own profile. **`ADR-047 §D2` should be amended to say plainly that the database bounds WHICH ROLE may be
   written, not WHICH PERMISSIONS a writable role may carry**, and the composed path needs a finding id before
   `S-E01-1`.
3. **Two `ADR-047` passages describe a guard that was not built.** §D3 clause 3 states the migration *"asserts that
   the installed `pg_get_expr(polqual)` on `role` and `role_permission` is byte-identical to what `20260814180000`
   installed"*, and §D5 lists a `TENANT_ISOLATION_UNCHANGED` census row. Neither exists: `migration.sql:426-433`
   asserts only that a policy **named** `tenant_isolation` is **present**, and the string
   `TENANT_ISOLATION_UNCHANGED` appears nowhere in `scripts/rls-isolation-check.js`. What shipped instead is the
   weaker, real pair `TENANT_ISOLATION_IS_SYSTEM == 0` + `TENANT_ISOLATION_INTACT == 2`. The implementing agent
   measured the reason (`pg_get_expr` re-renders `current_setting('…'::text, true)`, so a byte-comparison against the
   sibling's source text would fail on a **correct** policy) — but the ADR, which is the record future slices read,
   was never amended. Real mitigation exists (the diff does not touch the sibling migration, and `AC-2` evaluates the
   installed predicate owner-side), so this is a **documentation overclaim**, not a hole. Fix it by amending §D3/§D5
   in place, the way §D4 amends `ADR-042 §D5` — an ADR that describes a guard the code does not have is how the next
   reviewer stops checking.
4. **The DELETE half of §D3 is asserted from `pg_policy` shape, not from execution.** §D3 rejects the cheap shape by
   naming exactly two behaviours it cannot refuse: deleting a system role, **and** deleting a system role's
   `role_permission` rows. The harness executes the **second** (`:1669`); it never executes the first —
   `SHARED_ROLE`, the fixture's `is_system = true` role, is the target of no `DELETE` by `app_user` anywhere in the
   file. Add one probe beside the `(e)` case, with the owner read-backs that already exist (`OWNER_SYSTEM_ROLE_UNCHANGED`,
   `OWNER_SYSTEM_ROLEPERM`) — they currently have no attempted delete upstream of them to be evidence *of*. This is
   the evidence class the harness's own comment distrusts: `S-E01-1b` measured a real cross-tenant defect that left
   the whole harness green.
5. **`UNCOVERED_EXPECTED = ['role','role_permission']` is now justified by a reason this diff falsified.** The
   docblock at `scripts/tenant-adversarial-check.js:261` still says `role` is granted *"`SELECT` AND NOTHING ELSE"*
   and that *"the INSERT branch below is a HARD FAIL when the grant is missing"*, and
   `tenant-adversarial-gate.spec.ts:678` still hard-asserts `PLAN.some(p => p.table === table) === false` for both.
   After this migration both tables hold `INSERT`. So the adversarial four-verb cross-tenant suite structurally
   excludes exactly the two tables that just acquired write privileges — the two where `PF-194` lives. Either move
   them into `PLAN` (accepting a recorded `PF-194` expectation rather than a denial), or rewrite the justification so
   the exclusion is a **recorded decision** rather than an inherited one.

**Recorded, not fixed** (none blocking, all named): the story spec `stories/S-E01-1c.md:214-217,338` names the
policies `system_role_immutable_*` while the migration, `ADR-047`, `WRITE_GUARD_PREFIX` and the gate ratchet all ship
`system_role_write_guard_*` — the rename is the right one (it keeps the `polname = 'tenant_isolation'` census filter
untouched) but the spec now instructs a reader to capture a policy by a name that returns zero rows. `AC-14`'s
`G-DNC/DNC-10` ratchet (*"no `IS NULL OR` anywhere in this migration"*) is asserted **per file** and passes
literally, on the first migration that makes the sibling's `role.school_id IS NULL OR …` branch reach
`INSERT`/`UPDATE`/`DELETE` rather than `SELECT` — a per-file green standing in for a property that is composed across
files, and the exact mechanism of `PF-194`. The `R-11` leading-index precheck (`:396`, inherited verbatim from
`20260814180000:494`) filters neither `indisvalid` nor `indpred IS NULL`, so a partial or `INVALID` index satisfies
the one guard in a migration that refuses on every other precondition. The classifier in
`tenant-adversarial-check.js:2020` runs over **raw** file text with no comment stripping, which is why a `//`-comment
in `user-sync.service.ts:119` prints a permanent phantom `[LIMIT] … service (1)`; the dangerous variant is a
commented-out `prisma.<real model>.<verb>` manufacturing a phantom cutover blocker in a report whose whole value is
that every `[LIMIT]` is real. `AC-9`'s affirmative *"the receiver set is closed BY MEASUREMENT"* over-claims: the
scan sees `$transaction(async (ident)` only, not the non-`async` form and not `PrismaService.withTenant(id, async
(client) => …)` — and `withTenant` is precisely the API `AC-9`'s own verdict demands every call site adopt before the
cutover. `PF-197` (P2) is recorded and not fixed: two boot-time `CREATE UNIQUE INDEX` statements through
`$executeRawUnsafe` (`guardianship-claim-index.bootstrap.ts`, `booking-index.bootstrap.ts`) raise
`must be owner of relation` as a non-owner and are both wrapped in a `try/catch` that downgrades to `logger.warn`, so
after the cutover the `ADR-022` open-claim idempotency guard and the booking index **silently** stop being ensured.
Finally, `apps/api/prisma/seed.ts` and `seed-demo.ts` sit **outside** the enumerator's two roots
(`tenant-adversarial-check.js:1973`, an unnamed inline literal) and perform four of the exact statements these six
policies exist to refuse — including a `rolePermission.deleteMany` under a system parent, which is refused
**silently**, 0 rows, no error. Harmless today (the seeds run as owner) and invisible to the block whose whole purpose
is to enumerate every remaining write blocker.

## Merge conditions and inherited obligations

Three things the verify panel and the test architect established that a human must carry forward.
**Obligations 2 and 3 are discharged by `S-E01-2b`. Obligation 1 is NOT — it survives into `S-E01-1`.**
Annotations are inline below rather than deletions, so the reasoning stays readable.

1. **`ADR-032` §D3 overstates its own proof.** The read-back proves the value **round-tripped**, not that it was
   *applied*: `set_config(..., true)` run outside a transaction block warns, does not stick, **and still returns the
   value you passed**. What rules that case out is the separate assertion that the root client's log is empty. D3
   needs a one-line correction before the RLS story inherits "D3 is proven" and skips the check.
   > **⚠️ STILL OPEN after `S-E01-2b` (2026-08-13).** The amendment adds §D5–§D8 and annotates §Deferred item 1/2,
   > but **§D3's wording is untouched**. It carries into `S-E01-1`. One-line edit; the risk is unchanged — a later
   > slice reads "D3 is proven" and drops the empty-root-client-log assertion that is what actually rules the
   > outside-a-transaction case out.
2. **`TENANT_GUC` cannot reach the artefact it is meant to guard.** ADR-032 §D1 says the constant exists so the future
   policy predicate references the same string — but that predicate will live in a `.sql` migration, which cannot
   import a TypeScript constant. Close it in `S-E01-2b` by extending the ratchet over
   `apps/api/prisma/migrations/**/*.sql`, or by generating the policy SQL from the constant.
   > **✅ Discharged by `S-E01-2b`** via the first branch. `prisma.service.spec.ts` gains the `AC-10` block: it walks
   > every `apps/api/prisma/migrations/**/*.sql`, strips comments, and asserts the executable corpus contains
   > `current_setting('${TENANT_GUC}', true)` — **interpolating** the constant instead of retyping the string, so a
   > rename that misses the SQL turns the spec red. It carries a non-vacuity floor (the corpus must not be empty),
   > pins the full `nullif(…)::uuid = tenant_id` form, bans the fail-open `IS NULL OR` shape, and asserts `FORCE ROW
   > LEVEL SECURITY` is absent so its absence stays a recorded decision rather than an accident.
3. **`fn` receives the transaction client typed as full `PrismaClient`** (`prisma.service.ts:152/158/221`). A first
   caller that closes over the injected `PrismaService` instead of using `tx` runs on a different pooled connection
   with no GUC, and the types give zero signal. Prisma 5.22 exports `Prisma.TransactionClient` for exactly this — it
   drops `$transaction`/`$connect`, making both that mistake and a nested transaction compile errors. **Narrow it in
   the story that lands the first call site, before that call site is written.** With zero callers it breaks nothing.
   > **✅ Discharged by `S-E01-2b`.** `withTenant` now takes `fn: (tx: Prisma.TransactionClient) => Promise<T>`, and
   > `TenantTransactionRunner<TTx extends TenantRawClient = TenantRawClient>` is parameterised so `runWithTenant`
   > hands `fn` the client's exact type. The `fn(tx as unknown as PrismaClient)` cast is **deleted, not relocated**.
   > `Prisma` is imported with a `type` specifier so no client runtime enters the DB-free spec. Landed at zero call
   > sites, exactly as this obligation asked.

## `S-E01-1d` — the seam, and the proof that ~~has never run green~~ **RAN GREEN TWICE AT LAND**

**Delivered.** The cutover stops being an *event* and becomes a *seam*. `AppRolePrismaService` **composes**
`PrismaService` (never extends it), is provided by the already-`@Global()` `PrismaModule`, and is injected in exactly
one place — `TenantScopeService`. `calendar.module.ts` wires nothing new, so no module can reach the second client
except through the seam; that is AC-4's structural proof and it is a grep, not an argument. `calendar.controller.ts`'s
four handlers become the first production callers of a seam (`runWithTenant`, `TenantTransactionRunner`,
`assertTenantId`) that already shipped with `S-E01-2b` — this slice invents no convention, it supplies the caller the
seam never had.

**Defence in depth, verified line by line, not assumed.** Every converted handler **keeps** its application filter and
its guard. The GUC is transaction-local (`set_config(..., true)`), so nothing leaks onto a reused pooled connection.
`list`'s parent branch was refactored (`scopeForUser` hoisted out of the scope) and is **semantically identical**:
`studentIds === null` and `[]` both still land on `classSectionIds = []` → the `school_wide` fallback, so G-PORTAL
parent visibility is preserved and no child's visibility widens.

**`§D9` is the decision worth carrying forward.** Mapping `P2025 → NotFoundException` while *keeping* the application
`if` closes an existence oracle that the hardening itself would otherwise have opened: a 500-vs-404 split would have
distinguished "exists in another tenant" from "does not exist", which the pre-story code could not do. The general
rule — **when a database refusal replaces an application refusal, the two must be indistinguishable from outside** —
is the reusable part.

**⚠️ Four conditions a human owns before this merges.** — **THREE WERE DISCHARGED AT LAND BY THE ROUTINE, 2026-08-15.
Read the annotations under each; the text of each condition is left exactly as the sprint wrote it, because a
condition that is silently deleted once satisfied teaches the next run nothing about why it existed.**

> **This is the run-51 pattern paying out again, and it is the point of the split.** The sprint could not take these
> measurements — agents never build (`GUARDRAILS §4`) and never run jest — so it did the honest thing: it wrote down
> exactly what it had not proven, and set a *minimum bar* for whoever could. **The routine then took that bar
> literally**, from the main checkout, and three of the four conditions fell. Condition 4 is a genuine P1 and is now a
> traced finding rather than a paragraph.

1. **`AC-1` is UNMET: the executed proof has never executed green.** `scripts/tenant-scope-check.js` drives the
   **compiled** seam, agents never build (GUARDRAILS §4), and only its `DNC-08` refusal path has run — exit 1, naming
   `pnpm build`, which is the correct refusal but is not the transcript `AC-1` asks for. Everything downstream of the
   artefact guard has run **zero times**: the `INSERT` fixtures against the real DDL, the `P2025` from
   `tx.calendarEvent.update`, `probe.privileges`' key shape, `appRoleVerdict` returning `enforcing`, the `PF-203`
   arming check, and the **AC-4 teardown** — which is precisely the `TOOL-27`/`TOOL-31` hazard this repo has already
   been bitten by twice. The stage is wired **blocking** into `ci-gate.sh --full` and `ci.yml` with no
   `continue-on-error`, and it does DDL (`CREATE DATABASE`, `migrate deploy`, `CREATE ROLE`/`DROP ROLE`) on the
   operator's live cluster. **Minimum bar:** `pnpm build`, then `node scripts/tenant-scope-check.js` **twice** (the
   second run is what proves the teardown left the cluster clean), banner quoted; then out of band
   `SELECT datname FROM pg_database WHERE datname LIKE 'tenant_scope_%'` → 0 rows and `app_user` in its pre-run state.
   The alternative honest landing is to ship the script **without** the two gate wirings and carry the transcript in
   the follow-up — but that is a decision about the gate's contract, so it belongs to the operator.

   > ### ✅ DISCHARGED 2026-08-15 — the bar was met exactly as written, and the alternative landing was not needed.
   >
   > `pnpm --filter @pilotage/api build` → **exit 0**, verified by **artefact mtime** (`dist/main.js`,
   > `dist/shared/prisma/tenant-scope.js`, `dist/shared/prisma/app-role-prisma.service.js` all rewritten at 11:16–11:17)
   > rather than by an exit code. Then `node scripts/tenant-scope-check.js` **twice**, both **exit 0**:
   >
   > ```
   > TENANT SCOPE: PROVEN — the compiled seam is refused by PostgreSQL for a non-owner role
   >   ✓ AC-2.1 current_user (app_user) is NOT the table owner (pilotage) — true
   >   ✓ AC-2.1 the role does NOT carry BYPASSRLS — false
   >   ✓ AC-2.1 appRoleVerdict — the SAME function production boots on — qualifies this connection as ENFORCING
   >   ✓ PF-203 ROW LEVEL SECURITY is ENABLED on public.calendar_event / public.enrollment — true, policies present
   >   ✓ AC-2.2 POSITIVE CONTROL — tenant A READS / UPDATES (1 row) / CREATES its own calendar_event
   >   ✓ AC-2.3 DENIAL — tenant B's calendar_event is INVISIBLE to findUnique BY PRIMARY KEY — null
   >   ✓ AC-2.3 DENIAL — updateMany / deleteMany by primary key affect ZERO rows — 0 / 0
   >   ✓ AC-2.3 DENIAL — a unique `update` RAISES, asserted on the Prisma error code — P2025
   >   ✓ AC-2.3 …and tenant B's row is still there, UNCHANGED, read back by the OWNER
   >   ✓ AC-2.4 NO-SCOPE CONTROL — the same client OUTSIDE any scope sees ZERO rows — 0
   >   ✓ AC-4 the app_user client was disconnected DETERMINISTICALLY, before the drop
   >   ✓ AC-4 no session remains attached to the scratch database (verified from a SEPARATE connection) — 0
   > ```
   >
   > **Every path the condition listed as having run zero times has now run twice**: the `INSERT` fixtures against the
   > real DDL, the `P2025` from `tx.calendarEvent.update`, `probe.privileges`' key shape, `appRoleVerdict` returning
   > `enforcing`, the `PF-203` arming check, and the AC-4 teardown. **`TOOL-27`/`TOOL-31` did not recur** — the
   > deterministic disconnect before the drop held on both runs, which is the specific thing the second run exists to
   > prove.
   >
   > **Out-of-band verification, from a connection independent of the script that asserts its own cleanup:**
   > `tenant_scope_%` → `(none)`; the wider pattern `^(tenant_scope|tenant_adv|rls_isolation|schema_drift|restore_drill)`
   > → `(none)`; `app_user` in its pre-run state (`bypassrls=false login=true super=false`); and the live `pilotage`
   > database **untouched** — `_prisma_migrations = 2`, `pg_policies = 0`, exactly as before the run.
2. **`apps/api/.env.example` ships `DATABASE_URL_APP` UNCOMMENTED, and `ADR-048 §D5(2)`'s premise for that is
   falsified by this repo's own migration.** §D5(2) keeps it declared on the reasoning that a fresh checkout applies
   the full ledger and therefore lands in `enforced`. But `20260813120000_tenant_rls_policies` **never creates
   `app_user`** — it guards every GRANT behind `has_app_user` and exits 0 with a `RAISE NOTICE` when the role is
   absent. So `cp .env.example .env && prisma migrate deploy` on a clean cluster yields no `app_user` → `$connect()`
   throws → `refused_unusable` → **503 on the calendar in all four portals**, on a module that works today. The
   ledger already knows the answer and disagrees with itself: both `ADR-048`'s `PF-202` row and `OPEN.md` describe the
   remedy as *"the **commented-out** `.env.example` entry"*. **Fix is one `#`, plus deleting the false premise clause
   in §D5(2).** The refusal design itself is correct and must not be weakened.

   > ### ✅ DISCHARGED 2026-08-15 — fixed exactly as prescribed, and not one character further.
   > `apps/api/.env.example:71` now ships **commented out**, carrying the measured reason: the RLS migration guards
   > every GRANT behind `has_app_user` and **never creates the role**, so `cp .env.example .env && prisma migrate
   > deploy` on a clean cluster produces no `app_user`, `$connect()` throws, and the calendar 503s in all four portals
   > — on a module that works today. Commented out, that same fresh checkout lands in `degraded_no_app_url`: the
   > pre-story behaviour, named, gauge 0, nothing broken. `ADR-048 §D5(2)`'s false premise clause is corrected in
   > place. **The refusal design is untouched** — the fix moves the *default*, never the *semantics*, which is what
   > the condition asked for and the only version of this fix that is not `DNC-10`.
3. **Two P1 security deferrals are justified by an acceptance criterion that was never written.** `ADR-048` and
   `OPEN.md` both defer `PF-202`'s third remedy and `PF-203`'s runtime half on the grounds that
   *"`S-E01-1d (b)` AC-14 forbids editing the seam this half"*. **There is no AC-14** —
   [`stories/S-E01-1d-b.md`](./stories/S-E01-1d-b.md) ends at **AC-13** (verified: zero occurrences of `AC-14` in that
   file). Either add AC-14 to the story, or the deferral has no basis and `PF-203`'s fourth failure family belongs in
   `appRoleVerdict` now.

   > ### ✅ DISCHARGED 2026-08-15 — the first branch was taken, because the constraint was real all along.
   > **`AC-14` is now written** into [`stories/S-E01-1d-b.md`](./stories/S-E01-1d-b.md). It was the operating
   > constraint from the first line of this half's brief — *"DO NOT re-implement it, DO NOT rewrite it, DO NOT
   > 'improve' it"* — and the two deferrals were therefore **substantively justified and merely mis-cited**. Deleting
   > them would have been the dishonest repair: it would have moved a P1 fix into the diff whose whole purpose is to
   > prove the seam it would have edited.
   >
   > **And the AC is verified rather than asserted:** `git diff 6504887 --` over the six frozen files
   > (`tenant-scope.ts`, `app-role-prisma.service.ts`, `tenant-scope.service.ts`, `prisma.module.ts`,
   > `prisma.service.ts`, `calendar.controller.ts`) returns **zero hunks**, and the single permitted exception
   > `tenant-scope.spec.ts` carries **+6/−1**, exactly the §3.3 edit. `PF-202`'s third remedy and `PF-203`'s runtime
   > half stay **carried open with a named owner** — the next slice entitled to edit the seam.
4. **A pre-existing hole the conversion argument walked past, and it reaches the parent portal.**
   `calendar_event`'s scope FKs (`cycle`, `gradeLevel`, `classSection`, `academicYear`) are **mono-column**
   (`schema.prisma:707-711`), and `createEvent`/`updateEvent` validate scope *coherence* but never *ownership*. RLS
   does **not** close it: PostgreSQL's referential-integrity checks run outside row security, so `tenant_isolation`'s
   `WITH CHECK` sees only `calendar_event.tenant_id` and a foreign `cycleId` inserts. On the
   `degraded_no_app_url` path — i.e. **every deployment today** — the `include` at `calendar.controller.ts:242-246`
   then renders **another tenant's** cycle/level/class name, and a `cycle_scope` event satisfies
   `calendarVisibilityWhere`'s non-`class_section_scope` branch, so **every parent of tenant A sees it**. Pre-existing,
   **not introduced here** — but this slice converted this module on a "relational closure" argument and missed it.
   The fix is local and does not widen the slice: a `findFirst({ where: { id, tenantId } })` on each supplied id,
   **inside the scope**, before the `create`, and the same on `update`.

   > ### 🛑 NOT DISCHARGED — deliberately. It is now `PF-204` (P1), a traced finding with a named fix direction.
   > **This is the one condition the routine did NOT take, and the reason is the same `AC-14` that justifies the other
   > deferrals:** the fix edits `calendar.controller.ts`, which this half freezes. Smuggling a P1 tenancy fix into the
   > diff that exists to *prove* the seam would corrupt the evidence — the transcript in condition 1 is only evidence
   > about `6504887` because the subject did not move. **Recording it is the win available here**, and the finding is
   > sharper than the paragraph was: it names the structural reason RLS cannot close it (PostgreSQL evaluates
   > referential integrity **outside** row security, so `WITH CHECK` sees only `calendar_event.tenant_id` and a foreign
   > `cycleId` inserts under a perfectly correct policy), and it names the portal the leak surfaces on. **It is
   > pre-existing and inert-by-nobody's-design** — it reaches the parent portal on `degraded_no_app_url`, i.e. on every
   > deployment today. It should be the first thing the next slice takes.

## `S-E01-4a` — what landed, and what a human owns

**The ledger disagreed with this slice, and the disagreement is recorded rather than quietly resolved.** The row above
read `⛔ blocked on decision D-02` and `docs/daily-improvement-v3/epics/V3-E01-tenant-isolation.md:12,:57` still lists
`D-02` (*student Keycloak client*) as an open operator decision. **The operator override in run 60's brief IS that
decision**, taken in the direction `ADR-021` had already written down as its named alternative. The rows were stale
from the moment this merged, not wrong on purpose.

**Delivered.** A portal's OIDC client id is now a function of the portal alone. There is one accessor
(`apps/web/src/lib/keycloak-clients.ts`), it is import-free by construction so a gate can transpile it, and it never
reads a secret — the secret stays in `auth.ts`, server-side. The `student → parent` alias is **deleted**: a repo-wide
grep finds no surviving `CLIENT_PORTAL_OVERRIDE` and no `portal === 'student' ? 'parent'` literal. The realm export
gains the fourth confidential client **and** the `student` realm role, and the production provisioner stops binding
two portals to one client and stops writing a cross-portal callback wildcard.

**Four things a human owns, none of them fixed here.**

1. **The slice is INCOMPLETE against its own AC-6/AC-7, and that is its most important limit.** No
   `scripts/keycloak-client-check.js` exists and `scripts/ci-gate.sh` gained no stage, so the invariant *"a client id
   is a function of the portal alone"* is currently held **by construction and by comment**, with **no ratchet**. A
   future change that re-adds a `portal-${portal === 'student' ? 'parent' : portal}` literal, or adds `/student/*` to
   `portal-parent`'s `redirectUris` as the cheap fix for a broken login, lands **green**. `apps/web` has no unit
   runner (`PF-129`/`PF-133`), so the honest home is the `scripts/<name>-check.js` + `ci-gate.sh` stage that already
   covers `apps/web` source — this is stated in `ADR-050 §D5` as *specified, not yet built*, rather than left as a
   dangling promise. **This is `S-E01-4b`, and it should be taken before anything else re-enters this file.**
   **→ CONSUMED 2026-08-15 by `S-E01-4b` (run 62): the ratchet EXISTS** (`scripts/keycloak-client-check.js` + an unconditional TIER-1 `ci-gate.sh` stage, `ADR-052`). The residue of this item is narrower and is stated in § [`S-E01-4b`](#s-e01-4b--the-ratchet-and-the-half-that-never-ran): the ratchet has **no executable negative control of its own** (`PF-225`), and `apps/web/src/auth.ts` is asserted by the api spec but not by the new unconditional stage.
2. **The rollback documented in `.env.example` and `ADR-050 §D3` does not work as written, on two independent counts.**
   `clientCreds` reads the secret from `KEYCLOAK_<PORTAL>_CLIENT_SECRET` and otherwise **derives**
   `change-me-${clientId}`; the old code fell through to the *resolved* client's secret var. So
   `KEYCLOAK_STUDENT_CLIENT_ID=portal-parent` alone yields `client_id=portal-parent` paired with the literal
   `change-me-portal-parent` — **not** the real `KEYCLOAK_PARENT_CLIENT_SECRET` that `.env:32-33` and
   `infra/docker-compose.yml:513` actually configure — so on any deployment whose parent secret was rotated off the
   placeholder the escape hatch swaps `invalid_client` for `unauthorized_client` and leaves the portal just as dead.
   Second count: `infra/docker-compose.yml` was deliberately **not** edited (`AC-5` excludes it — a compose edit
   changes what a container boots with, and this slice must not move the deployment), so on the containerised
   Hostinger stack neither `KEYCLOAK_STUDENT_CLIENT_ID` nor `KEYCLOAK_STUDENT_CLIENT_SECRET` reaches the `web`
   container at all and the operator's `.env` cannot express the rollback. **The fallback is a PAIR, and on Docker it
   currently requires a compose edit — say so before deploying.**
3. **`VAL-04` is NOT discharged, and the limit is stated in `AC-9`'s own words.** The Docker engine on this host is
   down (`TOOL-19`), so no live Keycloak ran. Everything proven is about the **artefact** (`realm-export.json`,
   `kc-prod-redirects.mjs`) and the **code** — legitimate, because the export is the file that provisions the realm —
   but it is **not** the claim *"a real Keycloak accepted this redirect"*. Five things a live run must still prove:
   the amended export imports and materialises `portal-student`; `signIn('keycloak-student')` completes the
   authorization-code round trip; the minted token carries **`azp: "portal-student"`** (the security half, and the
   only assertion that distinguishes this fix from the forbidden one); the `reset-credentials` link is accepted; and
   the **running** Hostinger realm no longer holds the `/api/auth/callback/*` wildcard after the corrected provisioner
   runs (`PF-209`).
4. **Two copies of the rule survive, one of them inside the file this slice edited.**
   `PortalLoginForm.tsx:159` still calls `signIn(\`keycloak-${accent}\`)` while `auth.ts:94` now registers
   `portalProviderId(portal)` — the producer was de-duplicated and the consumer was not, so changing
   `PROVIDER_ID_PREFIX` (the exact scenario the new module exists to make safe) breaks sign-in on **all four**
   portals, and the AC-4 ratchet as specified scans `portal-` literals and would not see a `keycloak-` one. The
   second copy is `apps/api/src/modules/identity/invite.controller.ts:55-59` (`PF-211`), which carries no `student`
   entry and honours no env override. Also: `resetClientId` is typed **optional** with a silent
   `?? portalClientId(accent)` fallback, which types at a new address exactly the login/reset divergence `§D3`
   refuses — all four pages already pass it, so making it required costs nothing.

## `S-E01-1e` — the SECOND module, and the counter that moved the WRONG WAY until it was repaired

**Landed 2026-08-15 (run 61).** Closes `PF-217`, settles `PF-199`, records `PF-218` / `PF-219` / `ADR-051`,
advances `PF-02` half (a). **No SQL, no `schema.prisma` change** — `G-MIGRATION` is genuinely untriggered, so
`scripts/restore-drill-baseline.json` is untouched and `PF-80` never armed.

### What landed

`lessons` is the second production module inside the tenant seam: five handlers, `this.scope.run(...)`
**lexically** in each, `tx` inside, identity resolved **outside** by necessity. The attribution is **re-derived,
never edited as a literal**:

```
BEFORE  13 scoped + 111 enumerated / 800
AFTER   24 scoped + 120 enumerated / 803     → 659 sites would return ZERO ROWS after the cutover
```

> **These two lines are a MEASUREMENT OF THIS RUN and are kept as such — they are not the current state.** The
> denominator has since moved (`S-E01-1f` added probe call sites; the corpus measured **816** at `a022301`) and the
> numerator moved with `S-E01-1g` to **`36 scoped + 120 enumerated / 816`**. Read the live figure from
> `node scripts/tenant-adversarial-check.js`, never from a historical block.

**The application is still NOT ready to cut over, and the suite says so as a named LIMIT rather than a ratio.**

### The finding that matters more than the movement

Until this slice the coverage counter was **receiver-blind**. `PRISMA_CALL_SITE_RE` matched `prisma.`,
`this.prisma.` and `tx.` identically and `covers()` was purely **positional**, so

```ts
this.scope.run(id, async (tx) => { await this.prisma.grade.findMany(); })
```

counted as **scoped** — the statement running on the **owner** connection, which escapes its own policies, while the
counter credited it to the callback. **A half-converted handler produced a HIGHER scoped count than a correct one:
the metric moved in the wrong direction exactly when the code was wrong.** `SCOPE_SAFE_RECEIVERS = ['tx']` and
`classifyCallSite` — a **pure** function with four outcomes including `owner-inside-scope` — close it, and the order
carries the property: the receiver test runs **before** the enumeration test, so a covered site can never be
laundered into the enumerated column by an allow-listed file (`ADR-051 §D1`).

### `PF-199`, settled as two kinds rather than one list

`kind` is mandatory. **`surface`** = a whole-tree property true of every statement by construction (boot,
`apps/worker/src/**`); **`bootstrap`** = identity/context resolution, where every statement carries its **own**
reason and the declared set is compared for **equality in both directions** against the same matcher that produces
the arithmetic — unlisted fails, **dead** fails, reasonless fails. A `surface` entry naming a single module file is
refused outright. **No ratio floor** (`DNC-10`). The `PF-199` set was recorded as 3 files / 11 statements; it is
**4 files / 21 statements** — `teacher-profile.service.ts` resolves `teacherProfileId` and **writes while doing
so**, measured at **7** sites, not the 6 predicted.

### Two things the routine had to finish, and one it had to repair

The sprint's session died mid-implementation, so three items were completed by the orchestrator and are marked as
such rather than attributed to the sprint: **`ADR-051` was never written** (the shipped code already cited
`ADR-051 §D2`, i.e. a dangling citation — `TOOL-30`'s disease); the ledger updates; and **one failing test**. That
failure is worth keeping in the record because it is the new guard biting on **pre-existing** debt: the anti-vacuity
assertion refused three `calendar_event` entries whose reasons were `create` / `update` / `remove` — the handler
name and nothing more, 6 characters, inherited from `S-E01-5`. They were **repaired, not baselined**.

### What this slice does NOT claim

- **`lessons` is PARTIALLY converted.** The notification fan-out cannot be reached from the controller
  (`PF-218`): `NotificationsService` closes over its own `PrismaService` and takes no `tx`, so it stays on the
  **owner** connection. Keeping it outside was deliberate — inside, it would enqueue e-mail jobs **before commit**
  and fan O(guardians) statements into a 5 s budget.
- **The executed denial proof is at TABLE level, not handler level.** `lesson_entry` is covered by the adversarial
  suite's catalog-enumerated proof against real PostgreSQL as `app_user` (exit 0). The controller conversion itself
  is proven by 36 source/double-level assertions. Both are real; they are not the same claim.
- **`analytics.service.ts` still reads `lesson_entry` on the owner connection.** "The lessons module is scoped" is
  not "lesson data is scoped." Two modules is the slice.
- Intra-tenant ABAC gaps in `lessons` (an unfiltered `GET /lessons` returns every published lesson in the tenant to
  any `lessons.read` holder; the `isStaff` role **union** shows drafts to a teacher-who-is-also-a-parent) are
  **pre-existing and untouched**. RLS does not close them — same tenant.

## `S-E01-4b` — the ratchet, and the half that never ran

**Landed 2026-08-15 (run 62).** Ratchets `PF-18`, ships **`ADR-052`**, records `PF-221`–`PF-227`.
**No `schema.prisma`, no migration, no SQL, no Prisma query, no runtime file in `apps/web`, `apps/api` or
`apps/worker`** — `G-MIGRATION`, `G-TENANT`, `G-AUDIT` and `G-TRUTH` are genuinely untriggered, so
`scripts/restore-drill-baseline.json` is untouched and `P-05` never armed. The primary gate is **G-AUTHZ**, and
**G-PORTAL is 4/4**: admin, teacher, parent *and* student are asserted, because checking only the student portal
would leave three portals unratcheted.

### What landed, and why it is built the way it is

`S-E01-4a` deleted the `student → parent` alias, but the invariant *"a client id is a function of the portal alone"*
was held **by construction and by comment**, with no ratchet. The reason was structural, and it was re-measured at
land: `scripts/ci-gate.sh`'s `GATE_MACHINERY` trigger names `scripts/`, `.github/`, `infra/` and
`apps/api/src/shared/quality/`, and **`apps/web/src/lib/keycloak-clients.ts` matches none of them** — so
`keycloak-client-identity-gate.spec.ts`, the only executable assertion that `PF-18` stays fixed, was **skipped on
precisely the diff that can reintroduce `PF-18`**: an edit to the accessor and nothing else. `apps/web` has no unit
runner, so the honest home was a standalone `scripts/*-check.js` invoked by `ci-gate.sh` directly — the only
placement that escapes the hole, and the reason this is a `.js` script rather than a fifth spec file.

Three decisions carry the design:

1. **The gate EXECUTES the accessor; it does not parse it (`ADR-052 §D1`).** `PF-18`'s actual shape was an alias
   **inside the function body**. The house convention — lift declarations with `require('typescript')`, as
   `csv-escape-check.js` and `audit-write-check.js` do — reproduces `portal-<id>` from the untouched prefix constant
   and stays **green over a restored `BROKEN_SECURITY`**. The rule is *behaviour*, not a literal. The departure is
   bounded: the module is asserted **inert** (no import outside `./portals`, no `require`, no `process.env`)
   *before* `vm.runInNewContext`, and that inertness is not a new demand — the module is already in the Edge
   middleware bundle.
2. **Derivation alone is blind, so the assertion is a BIJECTION (`§D2`).** If both sides come from the same accessor
   an accessor regression moves them together: with `student → parent` restored, "does portal *p*'s client exist?"
   finds `portal-parent` twice and passes. Portal ↔ client one-to-one, plus a vacuity floor, is what bites.
3. **The wildcard rule was NARROWED, and the brief was overruled on a measurement (`§D3`).** The brief asked for
   *"no wildcard anywhere in a redirect URI"*; parsing `infra/keycloak/realm-export.json` shows **all four** clients
   carry `<origin>/<own portal>/*` today. That checker goes red on `main` on day one and the only route back to green
   is deleting the portal-root wildcard from four clients, i.e. breaking SSO everywhere — the exact
   *adjust-the-code-to-satisfy-a-misread-assertion* failure the project has already paid for. **`W-1`** no `*`
   anywhere in an `/api/auth/callback/` URI · **`W-2`** the only `*` is at the end of a client's **own** portal root ·
   **`W-3`** no client carries another portal's segment. Together they are strictly stronger than "no wildcard", and
   `W-3` is what makes the forbidden repair (`/student/*` on `portal-parent`) red **by name**.

The stage is **unconditional TIER-1** — measured 1.542 / 1.563 / 1.563 s, no Docker, no database, no build, the same
class as its unconditional neighbours `audit-write-check` and `csv-escape-check` — mirrored into
`.github/workflows/ci.yml` in the same diff, with **no** skip flag, **no** env override and **no** `continue-on-error`
(`DNC-10`).

### Four things a human owns, none of them fixed here

1. **`VAL-04` is NOT discharged, and this slice executed none of its five points.** Measured at land, not assumed:
   `timeout 60 docker info` → **exit 1**, *"failed to connect to the docker API at
   `npipe:////./pipe/dockerDesktopLinuxEngine` … The system cannot find the file specified"*; `timeout 30 docker ps`
   → exit 1. So no realm was imported, no token was minted, no `azp` was read back from an admin API. Recorded in
   `ADR-052 §Evidence` in the `AC-11` shape. **`scripts/keycloak-live-probe.js` (449 lines) ships written and never
   executed** — legitimate as an unwired probe (`§D5`, with `restore-drill.js` and `trace-emission-probe.js` as
   precedent), but it is unexecuted code, and **its blast-radius guard is a hostname comparison**: `assertLoopback()`
   accepts any `localhost` / `127.0.0.1` / `::1` URL, which an SSH tunnel to the VPS satisfies while pointing at
   production — and the probe then *plants* `${BASE}/api/auth/callback/*` on `portal-parent` and `portal-student` and
   **never removes it** (`PF-227`). Before it is ever run it must prove the realm **disposable**, not merely
   loopback. **`VAL-04` points 2 and 4 need a browser and are not closed under any outcome** (`AC-12`).
2. **`AC-9` is unmet, and the story and the ADR now contradict each other inside one diff.** The story's §0(c) and
   `AC-9` re-scope `PF-222` onto `infra/docker-compose.yml` and require two lines there; **that file is not in the
   diff**. `ADR-052 §D7` calls the gap *harmless* on the strength of `auth.ts`'s `change-me-${clientId}` fallback —
   true of the **default** path only. There is **no `env_file:`** in `infra/docker-compose.yml`, so an operator who
   rotates the student secret in `.env` (which `.env.example:63` instructs) has it silently dropped and **student
   login fails with `invalid_client` while the other three portals keep working**: `PF-18`'s exact shape at a fourth
   address. A human picks one document; `PF-222` stays **`open`** until then.
3. **The ratchet does not yet ratchet ITSELF, and this was measured rather than argued.** With `wildcardProblems()`
   gutted to `return []` — disabling W-1, W-2 and W-3, the gate's primary security content — the check still exits
   **0** and the appended spec still passes **20/20**. Five of the seven new `it()` blocks are `readFileSync` +
   `toContain` over source text; **none** executes `auditRealm` / `auditAccessor` / `auditProvisioner` against a
   mutated input. The four AC-5 negative controls exist as one-time transcripts in `ADR-052 §Evidence`, not as tests.
   **`PF-225`** names the minimum fix: in-memory mutation controls driven through `auditRealm(rule, realm)` (a
   positive control first, then M1/M2/M4/M5), plus an injectable source seam on `deriveRule()` so the accessor-alias
   control — `PF-18` itself — can be re-run instead of remaining prose.
4. **The gate's coverage is narrower than its PASS banner claims (`PF-226`).** `auditRealm` asserts the three flags a
   portal client must hold but nothing it must **not**: a client with `enabled: false`, or with
   `implicitFlowEnabled: true` under the permitted `/<portal>/*` wildcard, passes. `uriPath()` keeps only
   `pathname`, so scheme/host/port are invisible to the closure rules and a foreign-origin redirect URI passes.
   `auditInfraCoverage()` walks `infra/` **non-recursively** and only for `.mjs`/`.js`, so `infra/docker-compose.yml`
   — the very third list this story was written to fix — can never be seen by it, in either direction. Each is a
   *narrower-than-advertised* claim, not a regression: nothing that passed before fails now.

### Non-blocking drift recorded, not widened

`.github/workflows/ci.yml` and `keycloak-client-identity-gate.spec.ts` both cite `ci-gate.sh:330` for
`GATE_MACHINERY`; this diff moved it to **`:362`**, and only `ci-gate.sh`'s own comment says so — three artefacts
written in one diff, one anchor, two numbers, which is `TOOL-30`'s disease in miniature. `run_stage 120 "keycloak
client identity (4 portals, 4 clients)"` hard-codes a count inside the one design that refuses hard-coded counts.
`deriveRule()` is called in the spec's `describe` body, so a `GateError` there fails collection instead of producing
one named failing test. `KEYCLOAK_${portal.toUpperCase()}_CLIENT_ID` is the one production rule the gate re-types
rather than derives — it degrades loudly, so it is acceptable, but the file's thesis is "zero literals" and this is
one.

## `S-E01-1f` — the write path closed, the read path one third done

**Landed 2026-08-15 (run 63).** Closes **`PF-208`**, ships **`ADR-053`**, records **`PF-228`**–**`PF-233`**.
**No `schema.prisma`, no migration, no SQL, no `apps/web` file** — `G-MIGRATION` is genuinely untriggered, so
`scripts/restore-drill-baseline.json` is untouched and `P-05` never armed. The primary gates are **G-TENANT** and
**G-AUTHZ**; **G-TRUTH** is triggered too, and that is the part a reviewer should read twice.

### What landed, and why it is built the way it is

`S-E01-5` proved `calendar_event`'s mono-column scope FKs owned before the write and its escalation panel named the
twin it could not fix in the same diff. This is that twin, and it is **worse than the original**: in `calendar` a
foreign scope FK rendered another tenant's *name*; in `announcements` it materialises `announcement_receipt` rows
**and `Notification` rows** addressed at another tenant's profiles — a cross-tenant **write**, not a rendered label.

Four decisions carry it:

1. **The probe is the same shape, deliberately (`ADR-053 §D1`).** Five fields (`cycleId`, `gradeLevelId`,
   `classSectionId`, `studentId`, `userProfileId`), each **supplied** one proven by
   `findFirst({ where: { id, tenantId } })` — `findFirst` and not `findUnique`, because `findUnique` cannot carry the
   non-unique `tenantId` and would apply the composite predicate *after* fetching the foreign row. The `switch` is
   closed by a `const exhaustive: never`, the refusal is **byte-identical** for *« belongs to another tenant »* and
   *« never existed »* — indistinguishable **by construction** rather than by careful wording (`ADR-048 §D9`) — and
   the probes run **after** the pure refusals (`validateScope`, `assertScopeCoherence`) and the role refusal
   (`assertTeacherScope`), so a body that was going to be refused anyway costs no query and reveals nothing.
2. **The guarantee lives in the SERVICE, and that is not belt-and-braces (`§D4`).** `computeRecipients` gains five
   tenant predicates plus a bounded final `resolveWithinTenant`. It is *required* because `publishInternal`
   recomputes recipients from the **stored** ids and never re-enters the controller probe (`PF-230`) — the
   controller alone would leave the publish path unguarded.
3. **The second converting module is what earns the abstraction (`§D2`, superseding `ADR-049 §D5`).**
   `assertSingleScopeId`, `scopeOwnershipPlan`, `unknownScopeRef` and `ScopeIdCarrier` move into
   `apps/api/src/shared/prisma/scope-fk.ts`, generic over the field union, with **no compatibility re-export** left
   in `calendar.controller.ts` — one rule, one address. Three things are deliberately **not** extracted: the field
   lists (module-local), the `findFirst` loop (written **in line** in each handler, because
   `tenant-adversarial-check.js`'s coverage counter is **lexical** — `PF-200`), and a generic
   `assertOwnedByTenant(tx, modelName, …)`, refused again.
4. **A new refusal class ships with it, and it is stated as one (`§D3`).** `assertScopeCoherence` 400s a body whose
   declared scope does not explain the ids it carries. This refuses bodies that were previously **accepted**,
   including entirely intra-tenant ones — so the story's original *"contract: none"* line is wrong and `ADR-053 §D3`
   carries the corrected statement. It was measured against both shipped writers first
   (`AnnouncementComposer.tsx:279-281`, `TeacherMessageComposer.tsx:277-279`, plus the two preview URL builders):
   each sends exactly one id under a conditional spread, `individual_user`/`individual_student` have **no** shipped
   writer, so **no shipped caller breaks**.

### The severity correction, which is half the deliverable

`PF-208`'s recorded blast radius — *"writes an `announcement_receipt` and a notification into another tenant's user
feed"* — was **wrong in both directions**, and the row, `NEXT.md`'s two repeats and `ADR-053` now agree on the
measured version:

- It does **not** render in the victim's feed. Every victim-side read filters on the victim's own tenant.
- It **is** (a) an **integrity** defect — invisible **dark** cross-tenant rows — and (b) a **disclosure to the
  attacker**: `stats.total`, `readRate`, `_count.recipients` and the raw `userProfileId` list form a cross-tenant
  **cardinality-and-existence oracle**.
- Names and e-mails are **not** leaked **by the receipt path**. Read that sentence exactly that narrowly — see
  condition (2) below, which is the reason it is scoped rather than absolute.
- **Four** branches leaked, not the one recorded: `class_section_scope` enumerated the victim tenant's guardians,
  teachers and linked students in bulk.

### Four things a human owns, none of them fixed here

1. **The read path is one third done, and the two projections now DISAGREE.** `getOne` filters `allReceipts`
   against the tenant-filtered profile lookup, so `stats.total` / `readRate` / `unread` / the rendered roster stop
   counting cross-tenant rows. `list()` does not: `_count: { select: { recipients: true } }` at `:200` (admin) and
   `:217` (`mine=true`) still counts them, and `announcement_receipt` has no `tenant_id`. For a poisoned row the
   list card and the detail page report **different numbers for the same announcement**, with no explanation
   available to the admin — and the oracle survives on the endpoint both `/admin/communications` and the teacher
   messaging page call **by default**. `PF-230` owns the retroactive half; this specific asymmetry is why the
   PR must not be read as *« the oracle is closed »*.
2. **The scope-relation `include`s are not tenant-filtered.** `list` (`:195-201`, `:212-218`, and the **parent**
   branch `:234-243`) and `getOne` (`:465-470`) resolve `cycle{name}`, `gradeLevel{name}`, `classSection{name}` and
   `student{id,firstName,lastName}` through the announcement's own mono-column FKs, with no tenant predicate —
   Prisma cannot take a `where` on a to-one relation. For a row poisoned during the `PF-208` window that renders
   **another tenant's pupil first and last name** into the admin *and* parent portals. This is the `PF-204` shape one
   table over; the fix is to drop the four includes and resolve the labels with tenant-scoped batch lookups (the
   shape already used for profiles), mapping unowned → `null`.
3. **The retroactive census has never been run against PROD.** Locally it is `0 tenants / 0 announcements` — clean,
   and therefore uninformative. Run it on `pilotage.srv861861.hstgr.cloud` before reading `PF-208: closed` as a
   statement about stored data: `select count(*) from announcement a join student s on s.id = a.student_id and
   s.tenant_id <> a.tenant_id;` and the same for `class_section` / `grade_level` / `cycle`, plus
   `user_profile_id not null` with no same-tenant `user_profile`.
4. **`getOne`'s new filter is the most behaviour-changing hunk in the diff and has no assertion.** It re-derives
   `stats.total`, `stats.read`, `stats.unread`, `readRate`, `medianMinutesToRead` and the whole `recipients[]`
   roster, and its correctness rests on a profile lookup that carries `tenantId` but **no `status` filter and no
   `take`**. The day someone adds `status: 'active'` — entirely plausible on a profile lookup — every receipt
   belonging to a deactivated user silently leaves the denominator and `readRate` silently inflates, with nothing
   going red. Same for the hard-deleted-profile case the code comment concedes but nothing measures. This is the
   *protection-true-only-by-derivation* shape the slice's own `grade_level_scope` test exists to lock down, left
   unlocked here.

### Also recorded rather than rounded off

**`assertTeacherScope` enforces the teaching footprint for `class_section_scope` only** (`PF-233`): for
`grade_level_scope`, `cycle_scope` and `individual_student` it enforces nothing beyond the tenant, so the admin-only
`school_wide` refusal one line above is bypassable by a teacher naming any cycle of their own school — and the same
gap is reachable read-only through `preview-recipients` for roster enumeration. Its own `teacherProfile.findFirst`
carries no `tenantId`, safe today only **by derivation** (`userProfileId` is `@unique` and it is the caller's own
profile). **The probes prove `tenant_id`, never `school_id`**, although the handler holds `schoolId` and persists it.
**The 40-line ownership `switch` is now duplicated verbatim twice in one file** (`create`, `previewRecipients`) —
correct and deliberate per `PF-200`, but the only thing preventing the two `where` clauses from diverging is a
string-counting assertion. **`scripts/keycloak-live-probe.js` rides along outside `S-E01-1f §7`'s declared file set**
— a genuine fix (deriving the parent fixture password from `realm-export.json` instead of a hard-coded 9-char
literal that could never satisfy the realm's `length(12)` policy), untestable in this environment, and it changes a
gate script: a human should merge it knowingly, not discover it. **`PF-228` was allocated twice inside this one
diff** and resolved **by meaning** per the recorded parallel-runs rule — the id cited from the script keeps `228`,
the story's enumeration renumbered to `PF-229`.

## `S-E01-1g` — the THIRD module enters the scope PARTIALLY, and this time the counter moved by exactly what was converted

### What landed

`announcements` is the third production module inside the tenant seam, and it is the first to enter it **partially by
design**: **five** whole handlers — `unreadCount`, `create`, `update`, `publish`, `markRead` — run inside
`this.scope.run(tenantId, async (tx) => …)`, **twelve** call sites rebound from `this.prisma.X` to `tx.X`. Four
handlers (`list`, `getOne`, `previewRecipients`, `remove`), two private methods (`publishInternal`,
`assertTeacherScope`) and the whole of `announcements.service.ts` stay on the owner connection, **each carrying a
docblock that names its mechanism** rather than its inconvenience. `announcements.module.ts` is **byte-unchanged**,
deliberately: `PrismaModule` is `@Global()` and exports `TenantScopeService`, so wiring anything would be re-adding a
global.

Attribution **re-derived by the script, never edited as a literal**:

```
BEFORE  24 scoped + 120 enumerated / 816     (verb-aware: 165 satisfied, 2 not)
AFTER   36 scoped + 120 enumerated / 816     → 660 sites would return ZERO ROWS after the cutover
                                             (verb-aware: 165 satisfied, 2 not — unchanged)
```

**`+12` is exactly the number of sites converted**, and that identity is the result worth reading: it means there is
**no `owner-inside-scope` residue at all** — the `PF-217` trap that made `S-E01-1e`'s counter move the *wrong* way was
avoided **by construction** (the unit of work was the handler, never the statement), not caught in review. `enumerated`
is unmoved at **120** — nothing was laundered into `ENUMERATED_OUTSIDE_SCOPE`, and none of the six excluded paths was
added to it, because that list carries **structural** reasons and not pending work (`ADR-048 §D6`). The denominator is
unmoved at **816**: no call site was added or removed. The two unsatisfied verb-aware pairs are still the pre-existing
`tenant/INSERT` and `tenant/UPDATE` of `identity/register.controller.ts:365`.

**The application is still NOT ready to cut over**, and the suite still says so as a named `[LIMIT]` rather than a
ratio — `DNC-10` was respected and the readiness counter gained **no floor**, which `PROGRESS.md` itself had asked
for and `S-E01-1f §5` had already refused (a floor is `DNC-10`'s knob wearing a different hat).

### The decision that had to become an ADR, and why on this diff

`ADR-054` exists because a rule stated **three times in three files** is no longer a local comment. `calendar`
excluded `CalendarSeedService` (`PF-198`), `lessons` excluded `NotificationsService` (`PF-218`), and this slice
excludes `AnnouncementRecipientsService` — and the third occurrence is the one that generalises: **a handler converts
only if every statement it provokes is LEXICALLY inside the callback; a collaborator that closes over its own
`PrismaService` is EXCLUDED, never threaded a `tx`.** `GUARDRAILS §2` makes a new cross-cutting decision without an
ADR a blocking finding, and the controller header says so in the source, not only in `docs/`.

The refusal is **measured**, which is what separates it from the two earlier ones: `AnnouncementRecipientsService`
opens no `$transaction`, so a `Prisma.TransactionClient` parameter **would compile** (unlike `CalendarSeedService`).
It is refused anyway because it would move the counter by **zero** — the file opens no scope, so all ten of its sites
stay `uncovered` whatever the receiver is named — while adding **five** tables to a closure that is walked
**globally** at boot. Cost real, gain nil, blast radius maximal. Recorded as **`PF-235`**.

### The half of the boot-probe rule the first two modules never had to write

`APP_ROLE_REQUIRED_PRIVILEGES` gains six rows (`announcement` SELECT/INSERT/UPDATE, `announcement_receipt`
SELECT/UPDATE, `student` SELECT), with four existing `why` strings **extended, never duplicated**. What it
deliberately does **not** gain is the part that needed deciding: `appRoleVerdict` walks this list **globally**, so an
**over**-declared entry returns `refused_unusable` and 503s **calendar and lessons too**, not only the module that
declared it. `announcement_receipt`'s granted set is **closed** on `SELECT, INSERT, UPDATE` (`ADR-042 §D5`), so
declaring `DELETE` there would have taken down three modules at boot for a privilege the schema deliberately
withholds — the `S-E01-5` hazard **inverted**. `announcement`/`DELETE` is absent for the same fail-closed reason:
`remove` was **excluded** rather than converted, because the `ON DELETE CASCADE` into `announcement_receipt`
(`0_baseline/migration.sql:1737`) is **expected** to pass through the RI trigger and is **proven nowhere in this
repository** (`ADR-054 §D4`). `notification`, `user_role` and `role` are absent because the only handlers that reach
them are excluded — an entry no `tx` receiver exercises certifies a closure nobody checks, which is `PF-219`'s shape.

### The named limits — read the closure exactly as wide as it is

- **`announcements` is PARTIALLY converted.** Not "converted", not "isolated", not "closed" (`DNC-06`). The module's
  own child table `announcement_receipt` is still **written** entirely outside any scope, by `materialiseReceipts`.
- **The application still connects as the table OWNER**, which escapes its own policies for want of
  `FORCE ROW LEVEL SECURITY`. On `degraded_no_app_url` — every deployment today — **the explicit `tenantId` predicate
  is doing ALL the work and RLS is not doubling it.**
- **`PF-02` half (a) ADVANCES from 24/816 to 36/816. It does NOT close.** The global `DATABASE_URL` flip is still
  `S-E01-1`, on unchanged blockers.
- **`list` and `getOne` were refused on `G-TRUTH`, not on budget alone** — and this is the residue most likely to be
  misread as laziness. `list`'s `_count: { select: { recipients: true } }` counts **raw** `announcement_receipt` rows
  including the dark cross-tenant rows `PF-230` owns, while `getOne` resolves its receipts against an already
  tenant-filtered profile lookup. The two numbers **legitimately diverge today**; moving the `_count` under the
  FK-derived policy would silently reconcile a real divergence and change a number rendered on `/admin/announcements`
  without one line of `apps/web` changing. That is a product decision and it needs its own diff and its own
  before/after fixture.
- **`PF-236` is new and its divergence is new with this diff:** the four copies of the `switch (ref.field)` ownership
  dispatch used to be identical; `create`'s copy now takes `tx` while `previewRecipients`' copy keeps `this.prisma`,
  so **two copies inside the same file now differ in the one property the counter classifies on**. `AC-7` was cut
  first, as a `NICE` item.

### Evidence

`pnpm typecheck` **13/13 exit 0** (`@pilotage/api` a genuine cache **miss**, `tsc --noEmit` and
`tsc --noEmit -p prisma/tsconfig.json` both clean); `git diff --check` exit 0;
`node scripts/tenant-adversarial-check.js` → **`36 scoped + 120 enumerated / 816`, 228 source files**.
**No `schema.prisma`, no migration** — `G-MIGRATION` untriggered, `P-05` disarmed, `PF-80` never armed. **No
`apps/web` and no `apps/worker` file** (`touchesUi: false`, `touchesWorker: false`).
`announcements-scope-ownership.spec.ts` grows by **483 lines** (existing assertions untouched) carrying the frame
proof — including its **negative** half, which is the half that proves something: `ensureUser`/`forUser` see
`undefined` (`PF-199`), `assertTeacherScope` refuses **before** any scope opens, and `previewRecipients` opens **no**
scope at all — and the closure-coupling ratchet with its inverse guard.

> **⚠️ THE PARAGRAPH THAT USED TO SIT HERE SAID THOSE ASSERTIONS HAD NEVER BEEN RUN. THEY HAVE NOW BEEN RUN,
> 2026-08-22 — and the first execution found a RED that the writing role could not have seen.**
>
> The 2026-08-16 commit was left as `wip` on a local branch, **never pushed, never gated, never executed**.
> This run salvaged it from `89b77a2` — no rebase was needed, its merge-base *is* `a022301`, still the tip —
> and ran what the writing role is forbidden to run (`GUARDRAILS §4` reserves jest for the test-architect):
>
> ```
> pnpm --filter @pilotage/api exec jest src/modules/announcements
> → 1 failed, 57 passed / 58        (before the repair)
> → 2 suites, 58 passed / 58        (after)
> ```
>
> **The single failure was `DNC-06 — la source dit que la connexion est celle du PROPRIÉTAIRE`, and it was a
> TRUE red, not a flake.** The slice rewrote `announcements.service.ts`’s `DNC-06` docblock to stay true of the
> partially-converted module, and in reflowing it the phrase `FORCE ROW LEVEL SECURITY` ended up **wrapped
> across two comment lines** (`faute de `FORCE` / `ROW LEVEL SECURITY``). The assertion is `toContain`, so a
> line break inside the phrase deletes it as far as the ratchet is concerned. **Repaired by reflowing the
> docblock so the phrase is contiguous again — the assertion was NOT relaxed by one character**, which is the
> whole point of a ratchet that pins a sentence rather than a symbol. `announcements.controller.ts` was
> byte-unaffected and already carried the phrase intact at `:190` and `:801`.
>
> **Recorded as `PF-237` (P3):** a prose ratchet asserting a multi-word phrase with `toContain` is silently
> broken by ordinary comment reflow and nothing warns the author. Making the matcher whitespace-insensitive on
> the **assertion** side is cheap — but that is a change to a ratchet, and it belongs in its own diff, not in
> the diff whose red it just caught.
>
> **Mutation-tested rather than trusted** — a frame proof can pass vacuously. Reverting ONE converted site,
> `tx.announcementReceipt.count` → `this.prisma.announcementReceipt.count` inside `unreadCount`’s callback,
> turns the suite **RED (1 failed / 58)**. The file was restored and its **sha256 verified identical**
> (`7f119074fb2906b6…9418eb`) before anything was staged.
>
> **The counter was re-derived, not inherited.** `node scripts/tenant-adversarial-check.js` ran on `main` at
> the start of this run — **`24 scoped + 120 enumerated / 816`** — and again on this tree —
> **`36 scoped + 120 enumerated / 816`**. `+12`, matching the slice’s claim exactly, measured six days later by
> a different role. Verb-aware residual unchanged at `165 satisfied, 2 not`; denominator unmoved at 816.
>
> **The boot-probe closure was checked against the real grant matrix, not against the story.** All six new rows
> land inside the closed sets the script printed for `app_user`: `announcement=DELETE|INSERT|SELECT|UPDATE`,
> `announcement_receipt=INSERT|SELECT|UPDATE` (**no DELETE — and none was declared**), `student` carrying
> `SELECT`. No over-declaration, so `appRoleVerdict` cannot 503 `calendar` and `lessons` on this diff
> (`ADR-054 §D3`).

## Next slice

> **⚠️ POINTER MOVED 2026-08-16 by `S-E01-1g` (this run) — the THIRD module is in the scope, PARTIALLY.**
>
> **What landed.** `announcements` converts **five whole handlers** (`unreadCount`, `create`, `update`, `publish`,
> `markRead`), **twelve** call sites, and the readiness attribution moves **`24 scoped + 120 enumerated / 816` →
> `36 scoped + 120 enumerated / 816`** — `+12`, i.e. exactly the sites converted, with **no `owner-inside-scope`
> residue**, `enumerated` unmoved at 120, denominator unmoved at 816, verb-aware still `165 satisfied, 2 not`.
> `APP_ROLE_REQUIRED_PRIVILEGES` gains six rows and four extended `why` strings; `announcements.module.ts` is
> byte-unchanged **by design**. Ships **`ADR-054`** — the criterion that produces the partition (`§D1`), the measured
> refusal to thread a `tx` into `AnnouncementRecipientsService` (`§D2`), the **global** blast radius of an
> over-declared boot-probe row (`§D3`), the `remove`/cascade ruling (`§D4`) and the mandatory owner/no-`FORCE`
> sentence (`§D5`). **Closes `PF-232`** on its conversion half; records **`PF-235`** and **`PF-236`**.
>
> **What did NOT land, and it is the half a reader will assume.** `list`, `getOne`, `previewRecipients` and `remove`
> are **not** converted, nor is any of `announcements.service.ts` — each for a mechanism written at its own
> definition site (`G-TRUTH` on the rendered projections, the excluded collaborator sitting mid-handler, the
> **unproven** `announcement_receipt` cascade). **`PF-02` did not close** — half (a) advanced from 24 to 36 of 816.
> The application still connects as the **owner** and escapes its own policies for want of
> `FORCE ROW LEVEL SECURITY`, so the explicit `tenantId` predicate is doing **ALL** the work (`DNC-06`).
>
> **Two corrections to the block below, both measured rather than inherited.** (1) Its *"`24 scoped + 120 enumerated
> / 803`"* denominator was **already stale when it was written**: `S-E01-1f` added its own probe call sites, and the
> corpus measured **816** at `a022301`, not 803. Read the denominator from the script, never from a paragraph.
> (2) Its *"`shared/prisma/tenant-scope.ts` … **byte-unchanged**"* was true of `S-E01-1f` and is **false of the tree
> from this slice onward** (`+80` lines) — `OPEN.md`'s `PF-232` row carried the same sentence as its *evidence* and
> has been corrected there too.
>
> **→ The next slice is `PF-235`** — the `AnnouncementRecipientsService` seam, which is what unblocks
> `previewRecipients` and `publishInternal` — or **`PF-219`**, deriving the boot-probe closure **once, corpus-wide**,
> now that a third module has been extended by hand and the **over**-declaration half of the rule is written down.
> `PF-236` (the diverged dispatch) is cheap and should not be left to fork a fifth copy. `S-E01-1` (the global
> `DATABASE_URL` flip) still comes **after** all of it.

> **⚠️ POINTER MOVED 2026-08-15 by `S-E01-1f` (run 63) — and read the move exactly as wide as it is.** *(Superseded
> 2026-08-16 by the `S-E01-1g` block above; two of its numbers are corrected there.)*
>
> **What landed.** `announcements` scope-FK **ownership** (`ADR-053`), closing **`PF-208`** at both ends: `create`
> and `preview-recipients` each prove every **supplied** scope id owned before the write (five sequential
> `findFirst({ where: { id, tenantId } })`, a `switch` **CLOSED** by a `never`, a refusal byte-identical for
> *"other tenant"* and *"does not exist"*), and `computeRecipients` is made **structurally incapable** of returning a
> foreign `userProfileId` — five tenant predicates plus a bounded final re-derivation, which is required because
> `publishInternal` recomputes from the **stored** ids and never re-enters the probe (`PF-230`). The pure plan
> helpers (`assertSingleScopeId`, `scopeOwnershipPlan`, `unknownScopeRef`, `ScopeIdCarrier`) moved out of
> `calendar.controller.ts` into `shared/prisma/scope-fk.ts`; calendar consumes the shared copy, **no re-export**.
> The **field lists stay module-local** and the `findFirst` loop stays written **in line** (`PF-200`).
>
> **What did NOT land, and it is the half a reader will assume:** `announcements` is **NOT** converted to
> `withTenant` and gained **no** `APP_ROLE_REQUIRED_PRIVILEGES` entries (`AC-6`/`AC-7` cut from the bottom, recorded
> as **`PF-232`**). `shared/prisma/tenant-scope.ts` and `announcements.module.ts` are **byte-unchanged**, so the
> ~~**`24 scoped + 120 enumerated / 803`**~~ attribution is exactly where `S-E01-1e` left it. **`PF-02` did not move.**
> **⚠️ Two corrections, 2026-08-16 (`S-E01-1g`): the denominator was `816`, not `803`, already at the moment this
> block was written — this slice's own probes added call sites, and the script measured 816 at `a022301`. And
> `tenant-scope.ts` is byte-unchanged **as of `S-E01-1f` only**: `S-E01-1g` adds `+80` lines to it and moves the
> attribution to `36 scoped + 120 enumerated / 816`. `announcements.module.ts` is still byte-unchanged, and stays so
> by design.**
> Every statement in this module still runs on the connection that **owns** the tables, which escapes its own
> policies for want of `FORCE ROW LEVEL SECURITY` — the explicit `tenantId` predicate is doing **ALL** the work here,
> RLS is not doubling it (`DNC-06`).
>
> **The severity correction this slice was obliged to write down.** `PF-208`'s recorded blast radius — *"writes an
> `announcement_receipt` and a notification into another tenant's user feed"* — was **wrong in both directions**. It
> does **not** render in the victim's feed (every victim-side read filters on the victim's own tenant). It **is**
> (a) an **integrity** defect (invisible *dark* cross-tenant rows) and (b) a **disclosure to the attacker** —
> `stats.total`, `readRate`, `_count.recipients` and the raw `userProfileId` list are a cross-tenant
> **cardinality-and-existence oracle**. Names and e-mails are **not** leaked. And **four** branches leaked, not the
> one recorded: `class_section_scope` enumerated the victim tenant's guardians + teachers + linked students in bulk.
>
> **→ The next slice is `S-E01-1f'` — the CONVERSION half of this module** (`AC-6`/`AC-7`, `PF-232`), or
> **`PF-229`** — build the systematic detector the extraction just made possible, since both cheap heuristics were
> *measured* to fail in opposite directions and there are **11 controllers / 27 bare scope-FK DTO fields** left.
> `S-E01-1` (the global `DATABASE_URL` flip) still comes **after** all of it, on unchanged blockers.

> **⚠️ POINTER RE-READ 2026-08-15 by `S-E01-4b` (run 62), and it is UNCHANGED — for the same reason as `S-E01-4a`.**
>
> `S-E01-4b` is the identity-side gate slice `S-E01-4a` left specified-but-unbuilt. It touches **no** `apps/api`
> runtime file (its single `apps/api` edit is under `src/shared/quality/`, i.e. gate machinery), no Prisma query, no
> `schema.prisma`, no migration and no raw SQL, so it converts no module, opens no call site into the tenant scope,
> and leaves the ~~`24 scoped + 120 enumerated / 803`~~ attribution and `PF-199` exactly where `S-E01-1e` left them.
> *(Counter superseded 2026-08-16 by `S-E01-1g`: **`36 scoped + 120 enumerated / 816`**. The statement that this
> slice moved nothing is unaffected — only the figures it quoted have moved on.)*
> **→ The next slice is still `S-E01-1f` — convert a THIRD module, and derive the boot-probe closure ONCE
> (`PF-219`).**
>
> What `S-E01-4b` REMOVES from the queue is itself: the *"take `S-E01-4b` before anything else re-enters this file"*
> instruction in § `S-E01-4a` is **consumed**. What it ADDS behind `S-E01-1f`, in the order a human should take them:
> **`PF-225`** first — the ratchet has **no executable negative control of its own** and stays green with its
> wildcard rules gutted, which is `PF-18`'s own failure mode (a rule at an address where nothing checks it) rebuilt
> inside the checker written to prevent it; then **`PF-222`/`AC-9`** (two lines in `infra/docker-compose.yml`, and a
> human must first settle the story-vs-`ADR-052 §D7` contradiction); then **`PF-227`** (the live probe plants a
> callback wildcard behind a hostname check and never removes it — fix before it is ever run); then `VAL-04`'s live
> half once a Docker engine exists, then **`PF-226`**, **`PF-210`**, **`PF-209`**'s production remediation and
> `PF-211`–`PF-214`.

> **⚠️ POINTER CONSUMED 2026-08-15 by `S-E01-1e` (run 61). Everything below this block is HISTORY.**
>
> `S-E01-1e` is the slice every note under this heading pointed at, and it has landed: the second module is
> converted, `PF-199` is settled as a two-kind statement-ratcheted allow-list (`ADR-051`), and the attribution moved
> `13 + 111 / 800` → **`24 + 120 / 803`** on a counter that was **repaired first**.
>
> **→ The next slice is `S-E01-1f` — convert a THIRD module, and derive the boot-probe closure ONCE (`PF-219`).**
> Take `PF-219` *with* the third module rather than before it: the closure is now one hand-maintained list **plus**
> one derivation spec **per converted module**, and a third module makes that three of each. Derive it corpus-wide
> from every `tx.<model>.<verb>(` inside every attributed scope range, include-targets closed relationally, and the
> per-module specs collapse into one. A missing entry does not fail the boot probe — it certifies `enforcing: true`
> over a closure nobody checked, and then every request of that module answers 42501 on all its portals.
>
> **`S-E01-1` — the global `DATABASE_URL` flip — stays AFTER it**, and its blockers are unchanged and now
> *measured* rather than believed: **659 / 803** call sites would return zero rows; `tenant` needs `INSERT` and
> `UPDATE` that `app_user` does not hold (`register.controller.ts:365`, `PF-185`); and **9** raw-SQL sites carry no
> model or verb, so no grant matrix can see them (`PF-197`), two of which soft-fail into a `logger.warn`.
>
> **Operator precondition, unchanged (`PF-202`, `ADR-048 §D5`):** apply the RLS ledger to a database, **then**
> declare `DATABASE_URL_APP` against it — never the reverse. This checkout is still on the wrong side of that line.
>
> Also queued behind it, from this run: **`PF-218`** (the notification seam needs a `tx`-accepting entry point) and
> ~~the `announcements` controller **`PF-208`** — the same `ADR-049` shape, a **cross-tenant WRITE**, now the third
> instance found by hand and still the sharpest unfixed one.~~ **`PF-208` CLOSED 2026-08-15 by `S-E01-1f` /
> `ADR-053` — see the pointer block at the top of this section, including the two-part severity correction: the
> rows are dark data plus an attacker-side cardinality oracle, they are NOT rendered in the victim's feed, and four
> branches leaked rather than one. `PF-218` is unchanged and still open.**

> **POINTER RE-READ 2026-08-15 by `S-E01-4a` (run 60), and it is UNCHANGED — for the same reason as `S-E01-5`.**
>
> `S-E01-4a` is an **operator-inserted** slice: the run's brief took decision `D-02`, which is what unblocked the row
> at `S-E01-4`. It touches **no** `apps/api` file, no Prisma query, no `schema.prisma`, no migration and no raw SQL,
> so it converts no module, opens no call site into the tenant scope, and leaves the `6 scoped + 113 enumerated / 794`
> attribution and the bootstrap allow-list question (`PF-199`) **exactly** where they were.
> **→ The next slice is still `S-E01-1e`.**
>
> What `S-E01-4a` adds to the queue behind it, in the order a human should take them:
> **`S-E01-4b`** first — the executable gate (`AC-6`/`AC-7`, `scripts/keycloak-client-check.js` + a `ci-gate.sh`
> TIER-1 stage) and `VAL-04` against a running Keycloak; without it the invariant this slice just established has no
> ratchet and the next regression lands green. Then `PF-210` (a student can hold the new `student` realm role —
> nobody can, yet), `PF-209`'s **production** remediation (the running Hostinger realm keeps the callback wildcard
> until an operator re-runs the corrected provisioner), and `PF-211`–`PF-214`.

> **POINTER RE-READ 2026-08-15 by `S-E01-5`, and it is UNCHANGED — which is itself the correction.**
>
> `S-E01-5`'s own §0 (b) was written on the premise that this section still pointed at `S-E01-1` (the global
> `DATABASE_URL` cutover) and instructed its implementer to *"rewrite the final `## Next slice` section so the next
> run does not re-read a consumed pointer"*. **That premise was already false when the story was written**: the
> pointer had been corrected earlier the same day by `S-E01-1d (b)` and reads `S-E01-1e` — see the note immediately
> below. Rewriting it on the story's instruction would have *re-staled* a fresh pointer, so it was not rewritten, and
> the disagreement is recorded here instead of being silently resolved either way.
>
> **`S-E01-5` does not consume the `S-E01-1e` pointer and does not move it.** It is an operator-inserted P1 leak fix
> in one controller: it converts no module, opens no new call site into the seam, touches neither `DATABASE_URL` nor
> `schema.prisma`, and therefore leaves the 6 / 794 attribution and the bootstrap allow-list question (`PF-199`)
> exactly where they were. **→ The next slice is still `S-E01-1e`.** What `S-E01-5` adds to the queue behind it is
> `PF-205` (the composite-FK migration, which also owns the retroactive census) and `PF-206`.

> **⚠️ POINTER CORRECTED 2026-08-15 by `S-E01-1d (b)` — read this before the paragraphs below it.**
>
> **The pointer that stood here (`S-E01-1`, the whole cutover) was CONSUMED IN PART and is one slice out of date.**
> `S-E01-1d` and `S-E01-1d (b)` landed the thing every paragraph below assumed did not exist yet: `withTenant` has
> production callers, one module is converted, and the seam is **proven by execution** against PostgreSQL as a
> non-owner role. `docs/daily-improvement-v3/NEXT.md` is stale in the same way — it recommends *"a first call site,
> then a ratchet, then the flip"*; the first call site exists and the ratchet is the wall in
> `tenant-adversarial-check.js`. Both are refuted by the gate's own docblock at `tenant-adversarial-check.js:1914`.
>
> **→ The next slice is `S-E01-1e` — convert a SECOND module, and settle the bootstrap allow-list (`PF-199`).**
> It is the smallest step that moves 6 / 794 and it is the one that turns a per-module migration into a *pattern*: the
> second module is where the seam's ergonomics are actually judged, and `PF-199` (identity resolution cannot sit inside
> the scope it resolves) must be answered as a **named allow-list** before any module whose handlers touch the
> identity seam can convert. `S-E01-1` — the global `DATABASE_URL` flip — stays **after** it and stays blocked on
> `PF-185` (`register.controller.ts:365`) and `PF-197` (six raw-SQL sites).
>
> **Operator precondition, and it applies before either of them (`PF-202`, `ADR-048 §D5`):** the rollout order is
> **apply the RLS ledger to a database, THEN declare `DATABASE_URL_APP` against it** — never the reverse. This
> checkout's own `.env:19-20` is currently on the wrong side of that line: the live `pilotage` database has 2
> migrations and 0 policies, so booting the API today puts the calendar module into `refused_unusable` and answers
> **503 in all four portals**. Unsetting the variable returns it to `degraded_no_app_url` — working, honest, gauge 0.

*(Historical, kept because the reasoning still holds where it is not superseded.)*

**→ `S-E01-1` — the identity seam, and the connection cutover that makes the shipped policies protect the application
instead of a test role.**

*(Updated 2026-08-13 by `S-E01-2c`. The pointer is **unchanged** — `S-E01-2c` did not consume it. What changed is
that prerequisite 4 below, "decide the six unprotected tables", is now **discharged for five of them** and is no
longer `S-E01-1`'s to decide under cutover pressure, which was the whole reason `PF-183` asked for it to be settled
first.)*

*(Updated again 2026-08-14 by `S-E01-2d`. The pointer is **still unchanged** — `S-E01-2d` did not consume it either.
What changed is that prerequisite 4 is now discharged for the **sixth** table as well: `outbox_event` carries a
denormalised `tenant_id`, the ordinary policy and a `SELECT, INSERT, UPDATE` grant (`ADR-044`), so **policy coverage
is complete** and `S-E01-1` inherits **one** grant question instead of two — the reference data
`tenant`/`permission`/`role`/`role_permission`. Two things move **onto** its plate in exchange, both listed in
§ `S-E01-2d`: the `OUTBOX_CROSS_UPDATE_ACCEPTED` proof must land **before** the connection flips, because that is the
moment the `WITH CHECK` guarding the outbox discriminant stops being inert; and the relay's connection identity —
owner, or per-tenant GUC loop — must be **decided**, because a context-free `app_user` drains zero rows forever and
silently.)*

*(Updated again 2026-08-14 by `S-E01-1c`. **The pointer is STILL `S-E01-1` — `S-E01-1c` did not consume it either.**
What changed is step 3's grant question, which was the last named blocker on the authorization surface:
`role` now holds `INSERT, UPDATE, DELETE` and `role_permission` holds `INSERT, DELETE`, each under six
`AS RESTRICTIVE` per-command guards that make a SYSTEM role unwritable **by the database** (`ADR-047`), so the admin
portal's custom-role editor has a write path after the flip and `PF-193` closes. What survives into `S-E01-1` is
**two** reference tables, both refused here on purpose (`ADR-047 §D6`): `tenant` stays `SELECT`-only because granting
`INSERT` would let the application role **mint** tenants — `PF-185` made permanent — and `permission` stays
`SELECT`-only with no policy, measured genuinely global. **Three things move ONTO the cutover's plate in exchange,
all listed in § `S-E01-1c`:** `PF-194` (the cross-tenant CUSTOM-role write, proven ACCEPTED by execution) must be
inverted to a GREEN refusal **before** `DATABASE_URL` flips, not after; the composed `user_role.role_id`
self-escalation path needs a finding id and a decision, because it is strictly larger than the one closed here and is
named in no document; and `PF-197`'s two boot-time `CREATE UNIQUE INDEX` statements must stop soft-failing, since as
a non-owner they downgrade to `logger.warn` and the `ADR-022` idempotency guard silently stops being ensured.)*

`S-E01-2b` closed the four prerequisites this section used to list: the predicate is shipped and mutation-proven
(`missing_ok` + `nullif` + `::uuid`), the fail-open `IS NULL OR` form is banned by a ratchet, `fn` is narrowed, and
`FORCE ROW LEVEL SECURITY` turned out **not** to be the answer — the owner-bypass trap closes when the application
stops connecting as owner, not when the owner is forced (`ADR-032` §D5). Only prerequisite 4 (an index on every tenant
predicate, R-11, with a p95 benchmark before/after) is untaken, and it becomes load-bearing exactly at the cutover,
because that is the moment the predicate first runs on a real query path.

**`S-E01-1a` (2026-08-14) took step 1 in part and changed the shape of what is left.** The `demo` fallback is gone
from `ensureUser`; what the cutover still lacks is not a *refusal* but a *claim*. Two consequences for the ordering
below: the `pending` `UserStatus` is an enum change (`schema.prisma:31-35` has only `active|suspended|deleted`), so it
carries `G-MIGRATION` and stays here; and the remaining `demo` upsert lives in `register.controller.ts`, where it
forks on `D-02` and is recorded as `PF-185` rather than deleted by analogy.

The slice, in the order it must be done:

1. ~~**Resolve the tenant explicitly.**~~ **Half taken by `S-E01-1a`** — `ensureUser` resolves or refuses, and mints
   nothing. What remains under this number: the `pending` `UserStatus` enum (a migration), and the decision on
   `PF-185` (public registration) which is what actually *mints* a trusted claim. Case must still be normalised at the
   **source of the claim**, never in `assertTenantId`.
2. **Write the first real `withTenant` call site** on the request path. The narrowed type is already in place, so a
   caller that closes over the injected service instead of `tx` is now a compile error.
3. **Flip `DATABASE_URL` to `app_user`** and prove the four portals still work. The grant set is **deliberately
   incomplete** — role/permission/tenant tables were left out of this migration — so completing it is part of this
   slice, not a surprise at cutover. **Pre-flight, on every long-lived cluster:** `app_user` must exist *before* the
   RLS migration is applied, must not be superuser, must not carry `BYPASSRLS`, and must not inherit `pilotage`.
   Otherwise the `has_app_user` guard skips all 44 GRANTs while `_prisma_migrations` records the migration as applied.
4. ~~**Decide the six unprotected tables**~~ — **discharged for five by `S-E01-2c` (`ADR-042`), 2026-08-13.**
   `grade_revision`, `announcement_receipt`, `branding`, `import_row` and `user_role` now carry an FK-path
   `tenant_isolation` policy **and** a per-table grant, so the cutover meets them already decided rather than deciding
   them under pressure. ~~**What survives into this slice is one table and one grant question:** `outbox_event` holds no
   FK, stays fail-closed and **must not be granted** to silence a `permission denied` (`PF-185`, `ADR-042 §D7`)~~ —
   **and the sixth is discharged too, by `S-E01-2d` (`ADR-044`), 2026-08-14**: `outbox_event` has a denormalised
   `tenant_id`, the ordinary policy, and a `SELECT, INSERT, UPDATE` grant. Read the forbidden branch and what actually
   happened side by side — the grant did **not** arrive to silence a `permission denied`; the **policy landed first**
   and is proven to deny before any privilege exists. ~~**What survives into this slice is one grant question:** the
   grant set is still incomplete for `tenant`, `permission`, `role` and `role_permission`, which `ADR-042 §D4`
   names as reference data outside the derived set — that call belongs here.~~ — **`role` and `role_permission` are
   discharged too, by `S-E01-1b` (READ, `ADR-046`) and `S-E01-1c` (WRITE, `ADR-047`), 2026-08-14.** What survives is
   **`tenant` and `permission`**, and neither is an open question any more — both are **decided as `SELECT`-only**
   (`ADR-047 §D6`), so what this slice inherits is not a call to make but a consequence to handle: `PF-185`'s
   `tenant.upsert` in `register.controller.ts` has **no write path** after the flip, on purpose. Carry `S-E01-2c`'s
   own merge conditions too: the `has_app_user = false` branch is still unexercised, now across **53** tables.
5. **Correct `ADR-032` §D3's overstatement** (obligation 1 above) — one line, and it must not be inherited a third
   time.
6. **Prove the outbox discriminant before the connection flips, and decide who drains it** (`S-E01-2d`, §
   `S-E01-2d` conditions 2 and the recorded relay note). `GRANT UPDATE` is table-level, so `app_user` can rewrite
   `outbox_event.tenant_id` — the only attribution the row has. The `WITH CHECK` rejects it, but nothing executes that
   case yet; add `OUTBOX_CROSS_UPDATE_ACCEPTED` to `scripts/rls-isolation-check.js` **before** step 3, not after. And
   settle the relay's connection identity in the same breath: a context-free `app_user` sees **zero** pending events
   under the policy, silently and forever, which is the failure shape this programme has repeatedly ruled worse than a
   loud one.
7. **Invert `PF-194` from an accepted `[LIMIT]` into a GREEN refusal, and do it BEFORE step 3** (`S-E01-1c`,
   `ADR-047` §The residual). Today `scripts/rls-isolation-check.js:1690-1697` proves by execution that `app_user`
   under tenant A can `UPDATE` and `DELETE` tenant B's custom role — correct as a record, and correct **not** to land
   red, because the app connects as owner and the assertion would fail by design. The moment `DATABASE_URL` points at
   `app_user`, that stops being a documented deferral and becomes a live cross-tenant write primitive **on the
   authorization surface itself**, amplified by `user_role_role_id_fkey`'s `ON DELETE CASCADE` (RI triggers run with
   row security off, so the delete silently revokes assignments in a tenant the caller cannot see). The fix is a
   product decision — `PF-08` / `ADR-015 D8.6`: make `roles.controller.ts:154` set `schoolId`, which collapses the
   `school_id IS NULL` branch for product-created roles — not another policy. **In the same breath, allocate an id
   for the `user_role.role_id` self-escalation path** (§ `S-E01-1c` condition 2): it needs no system row, passes every
   policy in the database, and is guarded only by `users.service.ts:125`.

> **⚠️ STORY-ID COLLISION, recorded 2026-08-14 (run 56) — the `S-E01-1b` named just below is NOT the `S-E01-1b`
> that shipped.** This paragraph allocated `S-E01-1b` to the *demo-identity / `status`-enforcement* detour. Run 56 was
> handed `S-E01-1b` by **operator override** for a different story — the connection cutover's **reference surface**
> (see the row in *Slice status* and the section
> [`S-E01-1b` — the reference surface](#s-e01-1b--the-reference-surface-what-landed-and-what-it-deliberately-did-not))
> — and the SLICE wins per the override rule. This is the `TOOL-30` shape one level down: an id allocated twice by two
> actors that could not see each other. **The detour described below is neither cancelled nor done**; it needs a new
> id when it is picked up. It is recorded rather than silently renumbered, because renumbering by pattern is exactly
> what `TOOL-30` says not to do.

**Recommended before `S-E01-1`, and new on 2026-08-14 (id superseded — see the note above): the demo identities stop
being a standing credential, and `status` starts being enforced.** It is small, it is entirely inside the seam `S-E01-1a` just touched,
and it retires three of that slice's four residuals in one pass: (a) remove the `credentials` block from
`infra/keycloak/realm-export.json` and extend `seed-keycloak-users.ts`'s `DEMO_USERS` to cover `admin@` / `teacher@` /
`parent@pilotage.local`, which both rotates the repo-literal password to `KEYCLOAK_DEMO_PASSWORD` and gives those
three the `updateMany({tenantId,email},{authProviderId})` re-bind the `@voltaire.fr` accounts already have — that is
residual 1 and residual 3 together, using a mechanism that exists rather than inventing one; (b) gate adoption on
`payload.email_verified === true` and on `status: 'active'`, both refusing through the same message and code so no new
enumeration oracle appears — residual 2. It carries no migration and no cutover, so it can land while `S-E01-1`'s
enum/GRANT work is still being scoped. **`S-E01-1` remains the critical path**; this is a one-run detour that stops the
`S-E01-1a` residuals from being inherited by the cutover, which is the moment they stop being latent.

~~**Then `S-E01-3`, and it is unblocked for the first time.**~~ **✅ Landed 2026-08-14 (`ADR-045`), and the paragraph
that stood here was wrong on its own terms — kept struck rather than deleted, because the correction is the useful
part.** It said what `S-E01-3` still owed was "the same adversarial shape **through the application's own query
paths**". That work does not exist to be done: the suite measured it and `PrismaService.withTenant` has **0
production call sites out of 722** Prisma call sites, so there are no application query paths to run an adversarial
suite through. What actually remained was **BREADTH** — `rls-isolation-check.js` proved denial on `school` and the
five FK-derived tables; `S-E01-3` proves it on **all 50**, four verbs, both directions, with the expected outcome per
`(table, verb)` read from `role_table_grants` and one mutant killed by execution. The application-path proof the old
paragraph described **is** the cutover, `S-E01-1`, and it can only be written after step (2) above lands the first
call site. `VAL-02`’s DATABASE half is closed (the application half is owned by `S-E01-1`); `S-E01-4` stays blocked on `D-02`.

~~**The pointer is therefore unchanged: `S-E01-1b`, then `S-E01-1`.**~~ **Superseded the same day: the `S-E01-1b`
that shipped is the *reference surface* story, not the detour this paragraph meant (see the collision note above), and
it **consumed the pointer**. The pointer is now `S-E01-1` — the detour keeps its place in the queue but needs a new
id.** `S-E01-3` was the one `V3-E01` slice that could
land without touching the identity seam or the connection, so it took itself off the board and consumed nothing.
What it hands forward is **measurement instead of intention**, and three items above become concrete because of it:
step (3)'s "the grant set is deliberately incomplete" is now a **counted** list of three tables production code
already reaches (`role` ×7, `permission` ×3, `tenant` ×2), each a `42501` on the AuthZ path at the first request
after the flip; the owner bypass is asserted as a **present leak** whose assertion goes RED the day `FORCE` lands, so
the cutover cannot quietly leave the app connecting as `pilotage`; and `AC-9 CUTOVER READINESS` must be converted
from a zero-threshold to a **ratio with a floor before step (2) is written**, because the first `withTenant` call
site would otherwise flip that block from a named limit into an affirmative claim of readiness.
