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
| **S-E02-2** | Make CI actually run | ⛔ blocked | — | blocked by **PF-59** (Actions account-locked for billing) — no runner exists to make green |
| **S-E02-3** | Timed backup → restore rehearsal | ⛔ blocked | — | blocked by decision **D-01** |
| **S-E02-4** | Seed cannot run in production | ⬜ todo | — | unblocked once S-E02-1's hosted half is signed off |
| **S-E02-5** | Reconcile source ↔ hosted schema drift | ⬜ todo | — | *(implied by S-E02-1; needs hosted access)* |

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
