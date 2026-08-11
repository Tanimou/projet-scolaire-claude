# V3-E01 — Tenant isolation and identity resolution

**Layer** L0 · **Size** L · **Depends on** `V3-E02` (reviewed migrations + restore rehearsal must exist first —
satisfied: `S-E02-3` done 2026-08-07) · **Blocks** `V3-E03`, and transitively every layer above
**Closes** PF-01, PF-02, PF-18, VAL-02, VAL-04 · **Gates** G-TENANT, G-AUTHZ, G-MIGRATION · **DNC** DNC-10
**Epic brief** [`docs/daily-improvement-v3/epics/V3-E01-tenant-isolation.md`](../../../daily-improvement-v3/epics/V3-E01-tenant-isolation.md)

**Status (2026-08-11)** `in-progress` — **one partial slice landed**: `S-E01-2`, and only **one of its three thirds**.

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
| **S-E01-1** | Explicit tenant resolution, `pending` state, remove the `demo` fallback | ⬜ not started | — | `PF-01` open. No story written; bullet only in `sprint-plan.md`. **This is the slice that mints the first real tenant claim**, so it is the natural owner of the first `withTenant` call site |
| **S-E01-2** | RLS policies + real `withTenant` call sites + **parameterised GUC** | 🟡 **partial — the parameterisation third only** | 2026-08-11 | 57/57 jest in `apps/api/src/shared/prisma/prisma.service.spec.ts` (no DB, no `DATABASE_URL`, no generated client), `pnpm typecheck` 13/13 exit 0, `git diff --check` exit 0. Ships **`ADR-032`**; annotates `ADR-002`. Closes **`PF-02` half (b)**; **half (a) stays open**; records **`PF-179`**. See the section below |
| **S-E01-2b** | The RLS half: policies, `FORCE ROW LEVEL SECURITY`, the NULL-context decision, and the **first real call site** | ⬜ **next** | — | The two thirds `S-E01-2` did not deliver, plus the four hard prerequisites `ADR-032` records. See [Next slice](#next-slice) |
| **S-E01-3** | Two-tenant adversarial suite in CI (VAL-02) | ⬜ not started | — | `VAL-02` open. Cannot fail-before/pass-after until `S-E01-2b` gives it something to defeat |
| **S-E01-4** | Student Keycloak client split | ⛔ blocked on decision **D-02** | — | `PF-18`, `VAL-04` open |

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

## Merge conditions and inherited obligations

Three things the verify panel and the test architect established that a human must carry forward. None is fixed here.

1. **`ADR-032` §D3 overstates its own proof.** The read-back proves the value **round-tripped**, not that it was
   *applied*: `set_config(..., true)` run outside a transaction block warns, does not stick, **and still returns the
   value you passed**. What rules that case out is the separate assertion that the root client's log is empty. D3
   needs a one-line correction before the RLS story inherits "D3 is proven" and skips the check.
2. **`TENANT_GUC` cannot reach the artefact it is meant to guard.** ADR-032 §D1 says the constant exists so the future
   policy predicate references the same string — but that predicate will live in a `.sql` migration, which cannot
   import a TypeScript constant. Close it in `S-E01-2b` by extending the ratchet over
   `apps/api/prisma/migrations/**/*.sql`, or by generating the policy SQL from the constant.
3. **`fn` receives the transaction client typed as full `PrismaClient`** (`prisma.service.ts:152/158/221`). A first
   caller that closes over the injected `PrismaService` instead of using `tx` runs on a different pooled connection
   with no GUC, and the types give zero signal. Prisma 5.22 exports `Prisma.TransactionClient` for exactly this — it
   drops `$transaction`/`$connect`, making both that mistake and a nested transaction compile errors. **Narrow it in
   the story that lands the first call site, before that call site is written.** With zero callers it breaks nothing.

## Next slice

**→ `S-E01-2b` — the RLS half, and the first caller that gives it meaning.**

It is not "add the policies". `ADR-032` § Deferred already names two ways this ships green and protects nothing, and
the escalation panel added a third and a fourth. All four are acceptance criteria, not notes:

1. **`FORCE ROW LEVEL SECURITY`, or the whole thing is theatre.** The application role owns the tables under the
   current Prisma setup, and a table owner **bypasses RLS**. Policies present, tests green, isolation nil. The denial
   test must run as the role the API actually connects with.
2. **`current_setting('app.current_tenant_id', true)` — the `missing_ok` second argument is mandatory.** Without it,
   every connection that never went through `withTenant` — migrations, seeds, health checks, every BullMQ job — raises
   `42704` (and `22P02` on an empty string) from day one. And the obvious repair,
   `current_setting(...) IS NULL OR tenant_id = ...`, **fails open for the entire application**. Decide deliberately
   that NULL context means *see nothing*.
3. **Cast, never compare as text.** The GUC holds `text`; PostgreSQL renders `uuid` lowercase. `assertTenantId`
   deliberately preserves case (folding it would break the D3 read-back), so a predicate written
   `tenant_id::text = current_setting(...)` silently matches **zero rows** for an upper- or mixed-case tenant id —
   fail-closed, but invisible: the dashboard is simply empty and the investigation starts in the analytics layer.
   Write `current_setting('app.current_tenant_id', true)::uuid = tenant_id`. The identity seam (`S-E01-1`) must
   normalise case at the **source of the claim**, never in this helper.
4. **An index on every tenant predicate before RLS is enabled** (risk R-11), and a p95 benchmark on the largest
   seeded tenant before/after.

Plus obligation 3 above — narrow `fn` to `Prisma.TransactionClient` **before** writing the first call site — and the
open question of ordering with `S-E01-1`: the identity seam is what mints a trusted tenant claim, so if `S-E01-2b` is
picked first it must borrow one call site and say so, rather than invent a resolution rule that `S-E01-1` will then
contradict.

**Not the next slice, and why.** `S-E01-3` (the two-tenant adversarial suite) cannot honour its own
fail-before/pass-after criterion until there is a policy to defeat. `S-E01-4` stays blocked on `D-02`.
