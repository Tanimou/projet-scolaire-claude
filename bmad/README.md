# BMAD integration — Daily Improvement (v4: epic-driven)

This folder makes the autonomous continuous-improvement routine **robust** by
overlaying the [BMAD Method](https://docs.bmad-method.org/) (named-agent phases,
gated transitions, self-contained-story context engineering, adversarial review,
plan hardening, risk-tier routing) on top of the original `daily-improvement`
routine — and runs it with the Claude **Workflow** feature (**up to 5–6 parallel
agents**, capped by the runtime at `cpu-2`). Wider parallelism stays light on the
machine: only the test-architect runs `pnpm typecheck`, no agent builds, and the
implement agents edit disjoint file sets (`apps/web` / `apps/api` / `packages/ui`).

**v4 ambition:** the routine now ships **medium-to-large, meaningful features**, not
just polish — by **sequencing**. Victor (Product Strategist) reads
[`roadmap.md`](./roadmap.md), picks one **epic**, writes its spec-kit once
(`docs/spec/features/<epic>/`), then ships it **one vertical slice per run**
(DB + API + UI + worker → one reviewable PR). Same safe PR size, far bigger value.

| File | What it is |
|---|---|
| [`roadmap.md`](./roadmap.md) | **The ambition compass.** Prioritized backlog of medium-to-large **epics** (from the cahier de charges + codebase audit). Victor picks the current epic + next slice from here each run. |
| [`project-context.md`](./project-context.md) | **The guardrail.** North star, stack, conventions, ADRs, quality gates, spec-kit convention. Every agent reads it first so parallel agents never diverge. |
| [`agents.md`](./agents.md) | The BMAD named-agent roster (Victor/Mary/John/Winston/Sally/Critic/Amelia/DS-Guardian/Quinn/Sentinel/Edge-Hunter/A11y/Drift/Murat/Paige) mapped to the pipeline. |
| [`daily-improvement-v2.md`](./daily-improvement-v2.md) | The full pipeline spec: base routine + BMAD phases + **Ambition (epic-driven, vertical slices)** + Concurrency + Workflow orchestration. |
| [`workflows/sprint.workflow.js`](./workflows/sprint.workflow.js) | The runnable epic-aware Workflow: Intake (Victor) decides mode → **epic-spec** (write the spec-kit, docs-only) OR **epic-slice/polish** (plan → implement → verify → escalate → land). PR-only, **no builds**. |

## How to run (v3 — build-aware, concurrency-gated)

Trigger the local scheduled task **`daily-improvement-v2`** (Run now, or its
**hourly cron**). Each run: ① acquires the **gate** (`scripts/routine-lock.sh`)
so only **one writer builds at a time** and at most **2 routine PRs** are in
flight; ② works on a feature branch **in the main checkout** (no worktree → no
duplicated build artifacts → bounded disk); ③ runs the 5–6 agent
`workflows/sprint.workflow.js`; ④ runs **one** `pnpm build` (Turbo affected)
while holding the lock; ⑤ opens **one PR + a summary**, **auto-merges it to `main`
when green** (typecheck+build pass, no blockers — any risk tier; only red PRs are
held open), and releases the lock. Auto-merge ≠ auto-deploy.
**Docker/infra rebuilds are still yours** — batch them via `bash scripts/dev.sh`
after reviewing/merging the PRs. See `daily-improvement-v2.md` → *Concurrency* and
`project-context.md` §4b.

| File | What it is |
|---|---|
| [`scripts/routine-lock.sh`](./scripts/routine-lock.sh) | The concurrency + disk guard (single writer, ≤2 in-flight PRs, auto-cleanup of merged branches/worktrees). **Runtime-authoritative copy lives outside the repo** at `~/.claude/scheduled-tasks/daily-improvement-v2/routine-lock.sh` (must run before any `git checkout`); this is a review mirror — keep them in sync. |

> Optional: to also get BMAD's interactive `/bmad-*` slash commands in Claude
> Code, run `npx bmad-method install --yes --modules bmm --tools claude-code`
> (additive). Keep `project-context.md` in sync with the generated one.
