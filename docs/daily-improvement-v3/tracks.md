# Parallel tracks — seam ownership

V3 runs up to **three tracks concurrently**. This file is the contract that makes that safe: **two tracks may never
edit the same code.** A run picks a story only if every file it will touch lies inside its own track's seam.

Throughput before parallel tracks: **4.6 story PRs/day** (an hourly tick against 1–3 h runs meant ~19 of 24 ticks
skipped on the lock). The serialization existed because V2's agents edited one shared checkout. V3 gives each track its
own persistent worktree instead, so the single-writer guarantee is preserved **per track** rather than globally.

## The tracks

| Track | Owns (epics) | Seam — paths this track alone may edit |
|---|---|---|
| **a — foundation** | `V3-E01` tenancy · `V3-E03` canonical truth | `apps/api/prisma/**` · `apps/api/src/shared/prisma/**` · `apps/api/src/modules/analytics/**` · `apps/api/src/modules/school-structure/**` |
| **b — authz & audit** | `V3-E05` authZ hardening · `V3-E04` audit trail | `apps/api/src/shared/auth/**` · `apps/api/src/modules/identity/**` · `apps/api/src/modules/audit/**` · guards, DTOs and permission code in other modules |
| **c — surface** | `V3-E06` hygiene · web-side stories of `V3-E07`/`V3-E11` | `apps/web/**` · `packages/ui/**` · `packages/design-tokens/**` |

Each track has a **persistent worktree** at `../pilotage-worktrees/v3-track-<id>/`, created once and reused every run
so `node_modules` and the Turbo cache stay warm (one `pnpm install` costs ~7 min, and only on first use). **Exactly
three** — the count is bounded and never grows, unlike the per-session worktrees that accumulated to 23 before.

> **Why not `.claude/worktrees/`?** Because jest cannot find a single test there. Its `<rootDir>` substitution escapes
> a leading-dot path segment — the glob becomes `…pilotage-scolaire-claude\.claude/worktrees/…` — and micromatch reads
> `\.` as an escaped literal dot rather than a separator, so the pattern points at a directory that does not exist.
> Measured: **0 of 71** spec files matched under `.claude/worktrees/`, **72 of 72** in a plain path. Every run in a
> dot-path worktree would have reported "no tests found" forever, and the gate would have been red for a reason that
> has nothing to do with the code.

## Shared paths — claim before touching

`docs/**`, `scripts/**`, `bmad/**` and `infra/**` belong to no track. A story that must change them:

- **`docs/daily-improvement-v3/traceability/**`** — never edited directly. Write your inbox file (see below).
- **anything else shared** — say so in the PR body and keep the change minimal. If two tracks land conflicting shared
  edits, the second PR fails its rebase and is held for review. That is the intended outcome, not a bug.

## The ledger inbox — why concurrent runs do not conflict

If three runs edited `traceability/OPEN.md`, they would collide on the same lines of the same file every single merge.
So **runs never edit OPEN.md**. Each run appends exactly one file it alone owns:

```
docs/daily-improvement-v3/traceability/inbox/<branch-name>.md
```

Different files cannot conflict in git. `scripts/v3-reconcile-ledger.js` — run under a short exclusive lock by
`routine-lock.sh gate` — folds those files into `OPEN.md` / `CLOSED-<layer>.md` and deletes them.

### Inbox format

```markdown
## PF-123
status: closed
layer: L0
row: | PF-123 short title | V3-E05 | S-E05-3 | `closed` | test id | evidence |
```

`status` ∈ `open` · `in-progress` · `blocked` · `closed` · `closed-by-other-work`. `layer` is required when closing.

**Closing moves a row** out of `OPEN.md` into the archive — it is never deleted. If the reconciler cannot place a block
unambiguously it leaves the ledger untouched for that block and reports it. A ledger that silently mis-files a finding
is worse than one that asks for help.

## Guarantees this preserves

| Guarantee | How |
|---|---|
| No two runs edit the same code | fixed seam ownership above |
| No two runs edit the same checkout | one persistent worktree per track |
| No ledger merge conflicts | per-run inbox files + exclusive reconcile |
| Bounded disk | exactly 3 track worktrees, reused; never accumulating |
| Bounded CPU/RAM | `MAX_BUILDS=2` semaphore — at most two `pnpm build` at once |
| A failed track cannot spin | a track with its own PR still open is skipped next tick |
| Gates unchanged | every run still runs the **full** `ci-gate.sh` and produces its `G-*` evidence |

## ⚠ V2 must stay disabled

V3 no longer shares V2's `write.lock` — it is deliberately multi-writer now. Enabling V2 alongside would put V2's
single-writer session and V3's track sessions in the same repository with no common lock.

## Tuning

| Env | Default | Meaning |
|---|---|---|
| `ROUTINE_TRACKS` | `a b c` | track ids; drop to `a b` to halve load, add `d` to scale up |
| `ROUTINE_MAX_BUILDS` | `2` | concurrent `pnpm build` |
| `ROUTINE_MAX_INFLIGHT` | `4` | global cap on open routine PRs |
| `ROUTINE_STALE_MIN` | `90` | reclaim a track claim after this many minutes without a heartbeat |

Start with two tracks if the machine feels loaded; the coordinator handles any subset.
