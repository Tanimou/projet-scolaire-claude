# Daily Improvement v2 — BMAD-augmented, Workflow-orchestrated

> **Base = the original `daily-improvement` routine** (mission, product
> priorities, UI/UX & feature mandates, sprint discipline, **lightweight-only
> verification / NO builds**, conventional-commit PR, summary-as-context).
> **Augmentation = the BMAD method** (named-agent phases, gated transitions,
> self-contained-story context engineering, adversarial review, plan hardening,
> risk-tier routing) **executed with the Claude Workflow feature** (up to 5–6
> parallel agents). Nothing in the base is dropped — only made more robust.
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

Every run picks **one coherent improvement** and carries it through these phases.
The Workflow runs **up to 5–6 agents in parallel** (the runtime also caps at
`cpu-2`); the fresh worktree is the shared working tree; the PR is the only thing
that touches `origin/main`.

> **Resource budget (never compromise CPU/RAM/disk).** Wider parallelism stays
> safe because the extra agents are **API-bound reviewers / light editors**, not
> compilers: **only ONE agent (Murat, the test-architect) ever runs
> `pnpm typecheck`** — the single heavy local command — and **no agent ever
> builds**. The ≤3 implement agents edit **disjoint file sets** (`apps/web` vs
> `apps/api`+`apps/worker` vs `packages/ui`), so there is one checkout and zero
> edit conflicts. Memory/disk stay flat regardless of agent count.

### Phase 0 — Intake & Backlog · *Mary (Analyst)* · 1 agent
Read `PLAN.md`, `docs/spec/REDESIGN-PROGRESS.md`, ADRs, recent `git log`, open PRs
(`gh pr list`), the previous run's summary, and `bmad/project-context.md §5`.
Produce: a prioritized backlog and **ONE** sprint, with a **compressed,
contradiction-free intent** (BMAD Quick-Dev step 1). Route to the smallest safe
path: trivial polish → light spec; risky/multi-file → full spec + gate.

### Phase 1 — Plan & harden the spec · *John + Winston + Sally + Critic + Murat* · ≤ 5 agents (parallel)
- **John (PM)** writes a **self-contained `story` spec**: goal, functional
  requirements, **acceptance criteria**, impacted portal(s), exact files/modules,
  the `touchesUi`/`touchesBackend` flags that fan out the implement phase, and
  the contract (`packages/contracts` types) the FE/BE share.
- **Winston (Architect)** rules on ADR/convention compliance and returns a
  readiness verdict **PASS / CONCERNS / FAIL**; any *new* architectural decision
  must come with a new ADR or be dropped.
- **Sally (UX)** — only for UI sprints — checks premium/colorful/responsive/a11y.
- **Critic (pre-mortem)** runs a **pre-mortem** + **inversion** pass ("assume
  this shipped and broke prod — why?"); each failure mode it surfaces is appended
  to the spec as an acceptance criterion / targeted test.
- **Murat (Test Architect, early)** pre-assesses **P0–P3 risk** and names the
  single most valuable targeted test, so Implement already knows the risk tier.
- **Gate:** if the verdict is **FAIL**, re-scope (diagnose at the right layer —
  usually the intent or the spec) and re-enter; do not implement on a FAIL.

### Phase 2 — Implement · *Amelia FE + Amelia BE + DS Guardian* · ≤ 3 agents (parallel along disjoint seams)
Each dev agent implements **from the story spec alone** (context engineering),
inside the worktree, on a **non-overlapping file set** so there are no edit
conflicts and a single checkout suffices:
- **Amelia (FE)** → `apps/web` only (Next.js routes, server/client components).
- **Amelia (BE)** → `apps/api` + `apps/worker` only (NestJS/Prisma), coordinated
  with FE through `packages/contracts`.
- **DS Guardian** → `packages/ui` only — reusable component changes, no app markup.
FE/BE/DS are spawned **conditionally** (`touchesUi`/`touchesBackend`/component
need), so a trivial sprint runs just one dev agent. Atomic, scoped to the sprint,
**never touches unrelated areas, never removes working features.** Reuse
`@pilotage/ui`; preserve auth/tenant/audit on the backend.

### Phase 3 — Verify · *Quinn + Sentinel + Edge Hunter + A11y + Drift + Murat* · ≤ 6 agents (parallel) — **NO builds**
Six **distinct lenses** on the diff, run concurrently. Only Murat touches the
local toolchain — everyone else reads the diff.
- **Quinn (adversarial)** — must-find-issues review of the diff → findings list,
  then a **triage** grades each by confidence/severity (drop false positives).
- **Sentinel (security)** — auth, `tenant_id` scoping, ABAC, append-only audit.
- **Edge Hunter** — exhaustive branch/boundary/null/empty-state coverage gaps.
- **A11y** — WCAG 2.2 AA (contrast, focus order, keyboard, aria, target size),
  only when the sprint touched UI.
- **Drift** — off-convention paths, undocumented architectural decisions, UI
  primitives not reused from `@pilotage/ui`, client-side N+1 / waterfalls.
- **Murat (Test Architect, gate)** — the **only** `pnpm typecheck` run +
  `git diff --check`; confirms the **P0–P3 tag** + `[auth][schema][security]…`,
  decides targeted testing, and returns the go/no-go + human-review flag.

### Phase 4 — Fix · *Amelia* (loop)
Fix confirmed findings. On a failed check, **diagnose at the right layer**
(intent → Mary / spec → John / code → Amelia) and regenerate from there — never
blind-retry. Record a one-line graded evidence note for the next run.

### Phase 5 — Escalate (high-risk only) · *party-mode panel* · ≤ 3 agents (parallel)
**Only** when Murat tags the sprint **P0/P1** or `[auth]/[schema]/[security]`:
convene a BMAD **party-mode** panel — *Winston (architect) + Sentinel (security) +
Murat (test-architect)* — that must reach **consensus** that the change is safe.
Any dissent forces either a Phase-4 fix or a "needs human review — do not
auto-merge" stamp on the PR. Low-risk sprints skip this phase entirely.

### Phase 6 — Land (PR, no build) · *Amelia + Paige*
Conventional commit (`feat(parent): …`, `polish(admin): …`, `ui(teacher): …`),
push branch **`ci/YYYY-MM-DD-short-feature`**, open a PR whose body is a
**Checkpoint-Preview**: 1-line intent, scope metrics, concern-grouped walkthrough,
the tagged high-risk spots, and 2–5 manual things to try. **No force-push.**
Risk-tier `[auth]/[security]` PRs are flagged "needs human review — do not auto-merge."

### Phase 7 — Summary & memory · *Paige*
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
