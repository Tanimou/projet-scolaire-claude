# BMAD integration — Daily Improvement v2

This folder makes the autonomous continuous-improvement routine **robust** by
overlaying the [BMAD Method](https://docs.bmad-method.org/) (named-agent phases,
gated transitions, self-contained-story context engineering, adversarial review,
plan hardening, risk-tier routing) on top of the original `daily-improvement`
routine — and runs it with the Claude **Workflow** feature (3–4 parallel agents).

| File | What it is |
|---|---|
| [`project-context.md`](./project-context.md) | **The guardrail.** Stack, conventions, ADRs, quality gates. Every agent reads it first so parallel agents never diverge. (= BMAD's `_bmad-output/project-context.md`.) |
| [`agents.md`](./agents.md) | The BMAD named-agent roster (Mary/John/Winston/Sally/Amelia/Quinn/Sentinel/Murat/Paige) mapped to the pipeline. |
| [`daily-improvement-v2.md`](./daily-improvement-v2.md) | The full v2 pipeline spec: base routine + BMAD phases + Workflow orchestration. |
| [`workflows/sprint.workflow.js`](./workflows/sprint.workflow.js) | The runnable Claude Workflow that drives one BMAD sprint (intake → plan+harden → implement → verify → land). PR-only, **no builds**. |

## How to run

Trigger the local scheduled task **`daily-improvement-v2`** (Run now, or its cron).
It creates a fresh worktree, runs `workflows/sprint.workflow.js`, and lands **one
PR + a summary**. It never builds — **you** run the rebuild once, in one shot,
via `bash scripts/dev.sh` after reviewing/merging the batched PRs.

> Optional: to also get BMAD's interactive `/bmad-*` slash commands in Claude
> Code, run `npx bmad-method install --yes --modules bmm --tools claude-code`
> (additive). Keep `project-context.md` in sync with the generated one.
