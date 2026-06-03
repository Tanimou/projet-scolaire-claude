# Daily Improvement v2 — BMAD-augmented, Workflow-orchestrated

> **Base = the original `daily-improvement` routine** (mission, product
> priorities, UI/UX & feature mandates, sprint discipline, **lightweight-only
> verification / NO builds**, conventional-commit PR, summary-as-context).
> **Augmentation = the BMAD method** (named-agent phases, gated transitions,
> self-contained-story context engineering, adversarial review, plan hardening,
> risk-tier routing) **executed with the Claude Workflow feature** (3–4 parallel
> agents). Nothing in the base is dropped — only made more robust.
>
> Read `bmad/project-context.md` and `bmad/agents.md` before running.

## How to run it

- **Scheduled / manual:** the local scheduled task **`daily-improvement-v2`**
  (`~/.claude/scheduled-tasks/daily-improvement-v2/SKILL.md`) — trigger via
  **Run now** or let it fire on its cron. It is the runnable entry point.
- **What it does:** invokes the Workflow script `bmad/workflows/sprint.workflow.js`
  to drive one BMAD sprint, then lands a PR and a summary. **It never builds** —
  you (the human) run the rebuild once, in one shot, via `bash scripts/dev.sh`
  (or `infra/pilotage.sh update`) after reviewing/merging the batched PRs.

## The pipeline (BMAD phases → Workflow stages)

Every run picks **one coherent improvement** and carries it through 6 phases.
The Workflow caps concurrency at **≤ 4 agents**; the fresh worktree is the shared
working tree; the PR is the only thing that touches `origin/main`.

### Phase 0 — Intake & Backlog · *Mary (Analyst)* · 1 agent
Read `PLAN.md`, `docs/spec/REDESIGN-PROGRESS.md`, ADRs, recent `git log`, open PRs
(`gh pr list`), the previous run's summary, and `bmad/project-context.md §5`.
Produce: a prioritized backlog and **ONE** sprint, with a **compressed,
contradiction-free intent** (BMAD Quick-Dev step 1). Route to the smallest safe
path: trivial polish → light spec; risky/multi-file → full spec + gate.

### Phase 1 — Plan & harden the spec · *John + Winston (+ Sally if UI)* · ≤ 3 agents (parallel)
- **John (PM)** writes a **self-contained `story` spec**: goal, functional
  requirements, **acceptance criteria**, impacted portal(s), exact files/modules,
  and the contract (`packages/contracts` types) the FE/BE share.
- **Winston (Architect)** rules on ADR/convention compliance and returns a
  readiness verdict **PASS / CONCERNS / FAIL**; any *new* architectural decision
  must come with a new ADR or be dropped.
- **Sally (UX)** — only for UI sprints — checks premium/colorful/responsive/a11y.
- **Plan hardening:** a **pre-mortem** + **inversion** pass on the spec; the
  failure modes it surfaces are appended as acceptance criteria / targeted tests.
- **Gate:** if the verdict is **FAIL**, re-scope (diagnose at the right layer —
  usually the intent or the spec) and re-enter; do not implement on a FAIL.

### Phase 2 — Implement · *Amelia FE + Amelia BE* · ≤ 3 agents (parallel along seams)
Each dev agent implements **from the story spec alone** (context engineering),
inside the worktree, coordinated through `packages/contracts`. Atomic, scoped to
the sprint, **never touches unrelated areas, never removes working features.**
Reuse `@pilotage/ui`; preserve auth/tenant/audit on the backend.

### Phase 3 — Verify · *Quinn + Sentinel + Murat* · ≤ 3 agents (parallel) — **NO builds**
- **Objective:** `pnpm typecheck` + `git diff --check` + targeted unit tests for
  changed behavior only. (Builds/Docker forbidden — see project-context §4.)
- **Quinn (adversarial)** — must-find-issues review of the diff → findings list,
  then a **triage** grades each by confidence/severity (drop false positives).
- **Sentinel (security)** — auth, `tenant_id` scoping, ABAC, append-only audit.
- **Murat (Test Architect)** — **P0–P3 risk tag** + `[auth][schema][security]…`
  tags; decides how much targeted testing is needed and the go/no-go.

### Phase 4 — Fix · *Amelia* (loop)
Fix confirmed findings. On a failed check, **diagnose at the right layer**
(intent → Mary / spec → John / code → Amelia) and regenerate from there — never
blind-retry. Record a one-line graded evidence note for the next run.

### Phase 5 — Land (PR, no build) · *Amelia + Paige*
Conventional commit (`feat(parent): …`, `polish(admin): …`, `ui(teacher): …`),
push branch **`ci/YYYY-MM-DD-short-feature`**, open a PR whose body is a
**Checkpoint-Preview**: 1-line intent, scope metrics, concern-grouped walkthrough,
the tagged high-risk spots, and 2–5 manual things to try. **No force-push.**
Risk-tier `[auth]/[security]` PRs are flagged "needs human review — do not auto-merge."

### Phase 6 — Summary & memory · *Paige*
Emit the base routine's required summary (sprint title, portals, what/why, files,
checks run, screenshots if app running, worktree created/cleaned, commit hash,
PR link, remaining risks, **recommended next sprint**). Treat it as context for
the next run. Update `docs/spec/REDESIGN-PROGRESS.md` if a redesign item advanced.

## Start & worktree steps (preserved from the base, reconciled)

1. `cd C:\Users\HP\Downloads\pilotage-scolaire-claude` · `git fetch --all --prune`.
2. `git worktree list`; clean **clean+merged** `ci/*` worktrees under
   `.claude/worktrees/` (never a dirty one — `git status` first; keep ≤ 5;
   `git worktree prune` after). Delete merged local `ci/*` branches.
3. Create a fresh worktree off latest `origin/main`:
   branch `ci/YYYY-MM-DD-short-feature`, folder
   `.claude/worktrees/ci-YYYY-MM-DD-short-feature`. Do all coding there.

## Relation to the real BMAD toolkit (optional)

This integration **adopts BMAD-METHOD's methodology** (the same phases, named
agents, gates, context engineering and review mechanisms) and runs it through the
Claude Workflow feature — the right fit for an *autonomous* loop. If you also want
BMAD's **interactive** `/bmad-*` slash commands in Claude Code, install the real
toolkit (additive, does not conflict):
```
npx bmad-method install --yes --modules bmm --tools claude-code   # creates _bmad/ + .claude/skills/bmad-*
# then, once:  /bmad-generate-project-context   (regenerate the guardrail from the live codebase)
```
Our `bmad/project-context.md` is the hand-authored equivalent of BMAD's
`_bmad-output/project-context.md`; keep them in sync if you install the toolkit.
