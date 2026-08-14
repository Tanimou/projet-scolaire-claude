# V3-E01 — Tenant isolation and identity resolution

**Layer** L0 · **Size** L · **Depends on** `V3-E02` (reviewed migrations + restore rehearsal must exist first —
satisfied: `S-E02-3` done 2026-08-07) · **Blocks** `V3-E03`, and transitively every layer above
**Closes** PF-01, PF-02, PF-18, VAL-02, VAL-04 · **Gates** G-TENANT, G-AUTHZ, G-MIGRATION · **DNC** DNC-10
**Epic brief** [`docs/daily-improvement-v3/epics/V3-E01-tenant-isolation.md`](../../../daily-improvement-v3/epics/V3-E01-tenant-isolation.md)

**Status (2026-08-14)** `in-progress` — **three partial slices landed**: `S-E01-2` (one of its three thirds),
`S-E01-2b` (the policies, proven to refuse for a real non-owner role — but **not** the connection cutover), and
`S-E01-1a` (the identity seam stops inventing a tenant — `PF-01` half (a); half (b) forks out as `PF-185`). The epic
is **not** `shipped`, and two sentences must not be misread:

1. **After `S-E01-2b`, the running application is still not RLS-isolated.** It connects as `pilotage`, the table
   owner; `FORCE ROW LEVEL SECURITY` is deliberately absent; the remaining step is a **connection cutover**, which
   belongs to `S-E01-1`.
2. **After `S-E01-1a`, the tenancy of a request is resolved rather than invented — but a subject with no profile is
   still admitted through `@RequiresPermission`.** `permissions.guard.ts:28` unions realm-role permissions without
   requiring a `UserProfile`, so the refusal only bites where the handler body calls `ensureUser`. That is `PF-165`
   half (b), its own slice, and it is the reason `S-E01-1a` closes half of a finding and not a gate.

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
| **S-E01-1** | Explicit tenant resolution, `pending` state, remove the `demo` fallback — **plus the `app_user` connection cutover** | ⬜ **next, RE-SCOPED 2026-08-14** — steps 1 partially taken by `S-E01-1a` | — | `PF-01` half (a) is taken by `S-E01-1a`; what remains under this id is **steps 2–5** of [Next slice](#next-slice): the first real `withTenant` call site, the `DATABASE_URL` → `app_user` cutover with the missing GRANTs, the decision on the six FK-derived tables (`PF-183`, held PR #245), and the `ADR-032` §D3 one-line correction. The `pending` `UserStatus` is an **enum change** (`schema.prisma:31-35` has only `active|suspended|deleted`), so it carries `G-MIGRATION` and belongs here, not in `1a`. **This is still the slice that mints the first real tenant claim** — but note the *source* of that claim forks on `D-02` (`PF-185`) |
| **S-E01-2** | RLS policies + real `withTenant` call sites + **parameterised GUC** | 🟡 **partial — the parameterisation third only** | 2026-08-11 | 57/57 jest in `apps/api/src/shared/prisma/prisma.service.spec.ts` (no DB, no `DATABASE_URL`, no generated client), `pnpm typecheck` 13/13 exit 0, `git diff --check` exit 0. Ships **`ADR-032`**; annotates `ADR-002`. Closes **`PF-02` half (b)**; **half (a) stays open**; records **`PF-179`**. See the section below |
| **S-E01-2b** | The RLS half: 44 policies, the `nullif` NULL-context decision, the append-only grant split, and the `Prisma.TransactionClient` narrowing — **without** `FORCE` and **without** a call site, both on purpose | 🟡 **partial — the policy half, proven; not the cutover** | 2026-08-13 | `node scripts/rls-isolation-check.js` → **`RLS ISOLATION: PROVEN for the non-owner role`, exit 0** against the real local PostgreSQL (44/44 RLS enabled, 44/44 `tenant_isolation` policies, connected as `app_user` owning 0 tables without `BYPASSRLS`, positive control first, executed rollback). `pnpm typecheck` **13/13 exit 0**; `git diff --check` exit 0. **5 mutants injected into the migration, 5 killed.** Ships `ADR-032` §D5–§D8. **`PF-02` half (a) closes only PARTIALLY.** See the section below |
| **S-E01-2c** | The tenant-**DERIVED** half: 5 FK-path `EXISTS` policies, a derived set computed from `pg_constraint` rather than listed, a per-table grant with **no `DELETE` anywhere**, and `outbox_event` deferred by name | 🟡 **partial — the five FK-derivable tables; `outbox_event` deferred, and still not the cutover** | 2026-08-13 | `apps/api/prisma/migrations/20260813180000_tenant_rls_derived_policies/migration.sql` (hand-reviewed, `schema.prisma` untouched so the `prisma generate` RED trap stays disarmed); `scripts/rls-isolation-check.js` extended from 44 to **44 + 5**, with `DERIVED_EXPECTED` derived from `pg_constraint` and an `AC-5b` **set-equality** residue check; `rls-isolation-gate.spec.ts` +450 lines. `pnpm typecheck` **13/13 exit 0** (`@pilotage/api` a genuine cache **miss** that compiled the new spec); `git diff --check` exit 0, extended by `--no-index` over the three untracked files. Ships **`ADR-042`** (extends `ADR-032`, supersedes nothing); annotates `ADR-032` in two places **in place**. Advances `PF-02` half (a); records **`PF-185`** (`outbox_event`) and **`PF-186`** (`ON DELETE CASCADE` vs append-only). **⚠️ The checker's own green is NOT established by this run's gate** — see the section below |
| **S-E01-3** | Two-tenant adversarial suite in CI (VAL-02) | ⬜ not started — **unblocked** | — | `VAL-02` open. **`S-E01-2b` gave it something to defeat**, so its fail-before/pass-after criterion is satisfiable for the first time. Partly pre-empted: the gate already runs a two-tenant adversarial proof through `psql`; what remains is the same shape **through the application's own query paths** |
| **S-E01-4** | Student Keycloak client split | ⛔ blocked on decision **D-02** | — | `PF-18`, `VAL-04` open |

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
  `permission denied`.
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

## Next slice

**→ `S-E01-1` — the identity seam, and the connection cutover that makes the shipped policies protect the application
instead of a test role.**

*(Updated 2026-08-13 by `S-E01-2c`. The pointer is **unchanged** — `S-E01-2c` did not consume it. What changed is
that prerequisite 4 below, "decide the six unprotected tables", is now **discharged for five of them** and is no
longer `S-E01-1`'s to decide under cutover pressure, which was the whole reason `PF-183` asked for it to be settled
first.)*

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
   them under pressure. **What survives into this slice is one table and one grant question:** `outbox_event` holds no
   FK, stays fail-closed and **must not be granted** to silence a `permission denied` (`PF-185`, `ADR-042 §D7`); and
   the grant set is still incomplete for `tenant`, `permission`, `role` and `role_permission`, which `ADR-042 §D4`
   names as reference data outside the derived set — that call belongs here. Carry `S-E01-2c`'s own merge conditions
   too: the `has_app_user = false` branch is still unexercised, now across 49 tables.
5. **Correct `ADR-032` §D3's overstatement** (obligation 1 above) — one line, and it must not be inherited a third
   time.

**Recommended before `S-E01-1`, and new on 2026-08-14: `S-E01-1b` — the demo identities stop being a standing
credential, and `status` starts being enforced.** It is small, it is entirely inside the seam `S-E01-1a` just touched,
and it retires three of that slice's four residuals in one pass: (a) remove the `credentials` block from
`infra/keycloak/realm-export.json` and extend `seed-keycloak-users.ts`'s `DEMO_USERS` to cover `admin@` / `teacher@` /
`parent@pilotage.local`, which both rotates the repo-literal password to `KEYCLOAK_DEMO_PASSWORD` and gives those
three the `updateMany({tenantId,email},{authProviderId})` re-bind the `@voltaire.fr` accounts already have — that is
residual 1 and residual 3 together, using a mechanism that exists rather than inventing one; (b) gate adoption on
`payload.email_verified === true` and on `status: 'active'`, both refusing through the same message and code so no new
enumeration oracle appears — residual 2. It carries no migration and no cutover, so it can land while `S-E01-1`'s
enum/GRANT work is still being scoped. **`S-E01-1` remains the critical path**; this is a one-run detour that stops the
`S-E01-1a` residuals from being inherited by the cutover, which is the moment they stop being latent.

**Then `S-E01-3`, and it is unblocked for the first time.** The two-tenant adversarial suite now has a policy to
defeat, so its fail-before/pass-after criterion is satisfiable. Note it is *partly pre-empted*:
`scripts/rls-isolation-check.js` already runs a two-tenant adversarial proof at the `psql` level. What `S-E01-3` still
owes is the same adversarial shape **through the application's own query paths** — the thing that would catch a
repository bypassing `withTenant`, which no `psql` proof can see. `S-E01-4` stays blocked on `D-02`.
