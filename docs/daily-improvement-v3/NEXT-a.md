# NEXT — track **a** (foundation) — written by run 40 (`S-E01-2`), 2026-08-11

> Read this at Step 1. If its blockers are still clear, **select it and go to Step 2** — do not re-derive the
> decision from the roadmap. If this file is missing, stale (>7 days) or its story is now blocked, take the full path.
>
> **This is the first `NEXT-<track>.md` this repository has ever had.** `NEXT.md` (unsuffixed) is run 39's file and
> names `S-E05-2`, a **track b/c** story on the CSV seam — it is **not** track a's next story and must not be read as
> one. Track a owns `apps/api/prisma/**`, `apps/api/src/shared/prisma/**`, `apps/api/src/modules/analytics/**` and
> `apps/api/src/modules/school-structure/**` (`tracks.md`), i.e. epics **`V3-E01`** (tenancy) and **`V3-E03`**
> (canonical truth).

---

## ✅ Closed by run 43 — a code PR can reach `GATE: PASS` again

**`TOOL-06` is closed** (`ci/2026-08-12-v3-a-gate-unbounded-stages`), with `TOOL-07` and `TOOL-08` found while
closing it. Plan on auto-merge again. What follows is run 40's diagnosis, kept because it was right in every
particular and because it explains what the gate did *not* do for the eight PRs before this one:

`scripts/ci-gate.sh:47` documents `run_stage <timeout_seconds> <name> <command...>`, but seven calls
(`:102 :118 :142 :165 :198 :230 :235`) pass only `<name>`. `timeout` then reads the stage **name** as its interval:

```
▶ node
timeout: invalid time interval 'runtime engines'
✗ node
```

Measured this run: `timeout --foreground "runtime engines" echo hi` → **rc=125**, and the real gate printed that
banner **seven times** before reaching its dispatcher. Because `run_stage` appends every non-zero stage to `FAILED[]`
and the summary exits 1 whenever `FAILED[]` is non-empty, **every code-change gate reports `GATE: FAIL` regardless of
the diff.** It goes unnoticed on docs-only runs only because the docs-only `exit 0` fires *before* the summary, so the
seven failures are discarded unread.

What is actually lost in fast mode (as opposed to merely duplicated) is **three** stages, not one:
**runtime engines** and **compose invocation** exist lower down but only inside the `--full` branch, and
**csv escapers** has no second call anywhere — so `#215`'s blocking CSV ratchet has still never executed.
`production artefacts`, `audit writes` and `prisma generate` do have working fast-tier counterparts, and
`schema drift` has a working, skip-aware one (`⏭ schema drift (no prisma change)`), so **the gate does not need a
database** despite what the comment at `:218` claims.

**What run 43 changed.** The seven calls were a pre-`#214` stage list the rewrite left sitting *above* the tiers it
introduced, so they ran unconditionally before the dispatcher. Excised. Six had working counterparts and lost no
coverage; **`csv escapers` had none**, so it moved into TIER 1 and `#215`'s ratchet has now executed for the first
time. `run_stage` refuses a non-numeric timeout and exits 64 rather than filing a 125 as an ordinary stage failure,
so this class cannot return silently. Each check script is now referenced exactly once.

**Two things run 40 could not see from where it stood**, both found by measuring the anchors rather than reading them:

- `TOOL-07` — **three** gate meta-tests were *red on `main`* (`boot`, `web artefact`, `link integrity`: they anchor on
  `run_stage "build"`, which `#214`'s timeout argument stopped matching) and **two more could not fail** (`audit
  writes`, `csv escapers`: they hunt for a `${QUICK}` guard that `#214` renamed to `$MODE`, find nothing, and conclude
  "not inside a guard" wherever the stage is wired). Nobody saw the three reds because the api ratchet runs with
  `--skip src/shared/quality/` unless the diff touches gate machinery — and `#220`/`#221`/`#222` did not.
- `TOOL-08` — in the live tier `prisma generate` ran **before** `schema drift`, inverting `S-E02-11` AC-6. The
  meta-test guarding that order anchored on a literal matching only the dead block, where the order did hold. It was
  reading a stage that exited 125 without running anything.

**The lesson worth carrying, and it is not about this gate:** every one of these passed review because the assertion
*named* the right thing. `indexOf('run_stage "build"')` reads as an ordering check and is one, right up until the
string moves. Before trusting any meta-test that anchors on source text, evaluate its anchors against the file as
shipped — it takes one `node -e` and it is the difference between a ratchet and a sentence about one.

---

## ▶ Next story → `S-E01-2b` — the RLS half, and the first caller that gives it meaning

| | |
|---|---|
| **Story** | `S-E01-2b` *(no story file; the contract is `PF-02`'s row in `OPEN.md` + `docs/spec/features/v3-e01/PROGRESS.md`)* |
| **Epic** | `V3-E01` |
| **Layer** | **L0** |
| **Size** | **L** — and it is the first track-a story that **cannot be completed inside track a's seam** |
| **Gates** | `G-TENANT`, `G-MIGRATION` *(a real reviewed migration, never `db push`)*, `G-DNC` |
| **blockedBy** | **partially — see "the seam problem" below** |

### What run 40 left, stated precisely

`S-E01-2` closed **`PF-02` half (b)** only. The tenant value now travels as a **bound parameter** —
`SELECT set_config('app.current_tenant_id', $1, true) AS applied` through a tagged `$queryRaw` — a non-canonical-UUID
id is **refused before `$transaction` opens**, and the value `set_config` returns is **read back** and compared before
`fn` runs. `PF-02`'s row stays **`in-progress`**.

**Half (a) — "RLS claimed, not implemented" — is untouched and still fully true.** Re-measured on this tree at land:
**zero** `ENABLE ROW LEVEL SECURITY`, **zero** `CREATE POLICY` anywhere including `0_baseline`, and **zero**
production call sites for `withTenant`. The runtime blast radius of run 40 is therefore **exactly zero**: an
injection sink removed from a seam nobody calls, guarding a database with no policies. That is the correct *order*
(never turn on RLS while the GUC is string-interpolated), not a completed epic.

### The seam problem — read this before selecting

A policy predicate is worthless without callers, and **the callers are not track a's to write**: the request path
lives in `apps/api/src/shared/auth/**` and the job path in the worker — **track b's seam**. So `S-E01-2b` splits, and
only the first half is selectable by track a alone:

- **selectable now (track a):** the migration that enables RLS + writes the policies, the indexes R-11 requires, and
  the p95 benchmark. All of it under `apps/api/prisma/**`.
- **needs track b (or a cross-track hand-off recorded in `open-decisions.md`):** the middleware/interceptor that
  actually calls `withTenant`, and the worker-side equivalent.

**If you enable RLS with no callers, every query returns zero rows and the application is dead.** So the migration
half must ship behind something that cannot bite: policies written but the tables not yet `FORCE`d, or the whole
group gated. Say which you chose and why, in the migration's own header comment (the `20260809120000_tenant_timezone`
precedent).

### Four prerequisites that are acceptance criteria, not notes

Each one is a way this story ships green while protecting nothing. They come from run 40's review panel and from
`ADR-032`'s "traps" section — read that section first.

1. **`FORCE ROW LEVEL SECURITY`.** The application role **owns** the tables under the current Prisma setup, and a
   table owner **bypasses RLS entirely**. Policies + green tests + **zero isolation** is the default outcome. The
   denial test must connect as the role the API actually uses — note `.env` already defines a second
   `DATABASE_URL_APP` for `app_user`, which is the `ADR-002` role split, unused so far.
2. **`current_setting('app.current_tenant_id', true)`** — with the `missing_ok` second argument. Without it, every
   connection that never went through `withTenant` (migrations, seeds, health checks, every BullMQ job) raises
   `42704` on day one; and the obvious repair, `… IS NULL OR tenant_id = …`, **fails open for the whole
   application**.
3. **Cast, never compare as text.** The GUC holds `text`, PostgreSQL renders `uuid` lowercase, and `assertTenantId`
   preserves case on purpose — so a text predicate silently returns **zero rows** for a mixed-case tenant id.
4. **An index on every tenant predicate before enabling RLS** (risk R-11), with a before/after p95 benchmark on the
   largest seeded tenant.

Plus one carried over from run 40's own residuals, cheap and worth doing first: **narrow `fn` to
`Prisma.TransactionClient`** rather than `PrismaClient`, *before* the first call site is written. As typed today, a
caller that closes over the injected service instead of `tx` runs on a different pooled connection with **no GUC**,
and the types say nothing.

### Run 40's three declared merge conditions — inherit them, do not re-discover them

1. **`ADR-032` §D3 overstates its proof.** The read-back proves the value *round-tripped*, not that it was
   *applied* — `set_config(..., true)` outside a transaction block warns, does not stick, and still returns what you
   passed. Correct the wording rather than the code.
2. **`TENANT_GUC` cannot reach the artefact it guards.** The future policy predicate lives in a `.sql` migration,
   which cannot import a TypeScript constant. A drift between the helper's GUC name and the policy's would be
   invisible until an integration test exists, and its symptom is the worst possible one: everything works, nothing
   is isolated. Decide the mechanism (generated SQL fragment, or a check script comparing the two strings) **in this
   story**.
3. The `fn` typing above.

---

## Alternatives if `S-E01-2b` is blocked when you arrive

In selection order, both **inside track a's seam**:

- **`S-E03-1` / `PF-04`** — incompatible counts across portals (`apps/api/src/modules/analytics/**`). `G-TRUTH` +
  `G-PORTAL` on four portals. Note the dependency map makes **`E01 → E03`** a hard edge: canonicalising reads while
  identities can still land in the wrong tenant freezes the wrong scope. Taking an E03 story before E01 closes is a
  deliberate deviation and must be argued in the PR body, not assumed.
- **A verification sweep** (Appendix A) — `PF-56`'s row carries several `emitted, not ingested` claims, and nothing
  in the fast gate has run the six artefact scanners since the `#214` rewrite. If `≥3` pending-verification items are
  outstanding when you arrive, sweep instead of taking a story.

## State of the world at the end of run 40

- **Docker CLI unresponsive** (`docker ps` hung past 120 s); the project Postgres on **5433 refuses connections**.
  Something else is listening on 5432 — do not mistake it for the stack. No rebuild was attempted, no container
  started. Nothing in run 40 needed a database; `S-E01-2b` **will**.
- **Disk: 29 GB free on `C:` (94 % used)** — unchanged from run 39, still human-owned, no longer an emergency.
- `PF-179` was allocated this run for the two constant-DDL `$executeRawUnsafe` survivors outside track a's seam.
  Per `TOOL-05`, **re-check the register for your own id after your final fetch** — id allocation is a race between
  concurrent tracks and it has already been lost twice.
