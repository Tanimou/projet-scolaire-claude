# V3-E02 — Versioned database lifecycle and release integrity

**Layer** L0 · **Closes** PF-03, PF-55, PF-56, VAL-01, VAL-03, VAL-10 (+ PF-58, PF-59, PF-60, PF-61 discovered in flight)
**Spec** the story contracts in `docs/daily-improvement-v3/stories/sprint-01.md` are the spec-kit for this epic.

> **Why there is no `spec.md` here.** The V3 stories are authored pre-sliced with acceptance criteria, a stated test
> and an explicit out-of-scope list — they already carry what a `spec.md` + `tasks.md` pair would. Spending a run on
> `epic-spec` while a P0 (`PF-03`) was open would have been ceremony. This file is the epic's status ledger.

## Slice status

| Story | Title | State | Run | Evidence |
|---|---|---|---|---|
| **S-E02-0** | Land the V3 substrate on `main` | ✅ done | 2026-08-02 | PR #170 → `81c6e15` |
| **S-E02-1** | Baseline migration; stop `db push`; preflight; schema manifest | 🟡 partial | 2026-08-02 | baseline applied to scratch DB, `migrate diff --exit-code` = 0, `migrate status` clean, entrypoint refusal exercised, 10/10 jest |
| **S-E02-2** | Make CI actually run | 🟢 done *(local gate)* | 2026-08-02 | suites executed for the first time — **568/588 passing**; 18 failures all baselined with owning finding ids; ratchet proven to block in **both** directions; **surfaced and fixed a live production P0 (`PF-62`)** |
| **S-E02-3** | Timed backup → restore rehearsal | ⛔ blocked | — | blocked by decision **D-01** |
| **S-E02-4** | Seed cannot run in production | ⬜ todo | — | unblocked once S-E02-1's hosted half is signed off |
| **S-E02-5** | Reconcile source ↔ hosted schema drift | ⬜ todo | — | *(implied by S-E02-1; needs hosted access)* |

## S-E02-2 — what "done" means here, and what it does not

**The previous run recorded this story as ⛔ blocked by `PF-59`. That was the wrong read**, and correcting it is the
main lesson of the 2026-08-02 run: `PF-59` locks the *hosted runner*, not the *gate*. The suites were always
executable on the machine the routine already runs on. Treating "CI is down" as "the gate cannot exist" is what let a
production P0 sit undetected for seven weeks.

**Delivered and executed:**

- `scripts/test-ratchet.js` — runs a suite, compares against `scripts/known-test-failures.json`, and fails on a new
  failure *or* on a baseline entry that starts passing (the list may only shrink). Both directions were exercised
  live, not asserted.
- `scripts/ci-gate.sh` — the six CI stages in CI's own order, runnable locally; every stage runs even after one fails,
  so a single run reports every problem.
- `scripts/known-test-failures.json` — 18 entries, each with a cause and an owning finding (`PF-63`…`PF-66`).
- `.github/workflows/ci.yml` — `prisma generate` added before `lint` (it `dependsOn: ^build`, which needs the client);
  `pnpm test --if-present` (a pnpm flag that turbo does not accept, and an invitation to treat a missing script as a
  pass) replaced by the two ratchet invocations.

**Not delivered — stated plainly:**

- The **hosted** gate. `ci.yml` is repaired but has not executed and cannot until `PF-59` is resolved by the account
  owner. Its correctness is reviewed, not proven.
- **Playwright and axe stages** (`VAL-08`). Wiring a job that cannot be run would be asserting a gate rather than
  executing one, which is the failure mode V3 exists to end — so they are left explicitly open instead.
- **Merge gating.** Nothing mechanically blocks a merge yet; the ratchet is only as binding as the routine that runs it.

## What remains on S-E02-1

The **code path** is done and evidenced. What is not done is the **hosted** side, which needs production credentials
and an operator:

1. Run the drift check in `docs/runbooks/baseline-hosted-database.md` §1.
2. If it is **not** empty → that is the S-E02-5 drift; do **not** baseline.
3. If it is empty → `prisma migrate resolve --applied 0_baseline`, then `migrate status`.

Until step 3 runs, the hosted migrator will **refuse to deploy** — deliberately. That refusal is the fix working, not
a regression: it is what stops an unreviewed schema mutation.

## Next slice

**S-E02-4** (seed hardening) — the only E02 story that is neither blocked by an external decision nor by PF-59.

Two follow-ons now compete with it, both raised by this run and both arguably ahead of it:

1. **`PF-63`/`PF-65`** — 12 of the 18 baselined failures sit on the analytics/snapshot path (`V3-E03`), which is the
   epic that owns `PF-04`'s cross-portal count contradiction. Those red tests are very likely *already describing*
   that bug. Triaging them may be the cheapest entry into E03 that exists.
2. **`PF-67`** — module-wiring guards assert on source text, so they cannot catch a controller that is registered but
   fails DI at boot. `PF-62` was caught only because the deletion was textual.
