# Daily Improvement v2/v3 — BMAD-augmented, Workflow-orchestrated, build-aware

> **Base = the original `daily-improvement` routine** (mission, product
> priorities, UI/UX & feature mandates, sprint discipline, conventional-commit
> PR, summary-as-context).
> **Augmentation = the BMAD method** (named-agent phases, gated transitions,
> self-contained-story context engineering, adversarial review, plan hardening,
> risk-tier routing) **executed with the Claude Workflow feature** (up to 5–6
> parallel agents). Nothing in the base is dropped — only made more robust.
> **v3 adds** a bounded local **build verification** and a hard **concurrency +
> disk guard** (see "Concurrency" below and project-context §4b).
>
> Read `bmad/project-context.md` and `bmad/agents.md` before running.

## How to run it

- **Scheduled / manual:** the local scheduled task **`daily-improvement-v2`**
  (`~/.claude/scheduled-tasks/daily-improvement-v2/SKILL.md`) — trigger via
  **Run now** or let it fire on its **hourly cron**. It is the runnable entry point.
- **What it does:** ① acquires the **concurrency gate** (`bmad/scripts/routine-lock.sh gate`);
  ② on a feature branch **in the main checkout**, invokes the Workflow
  `bmad/workflows/sprint.workflow.js` to drive one BMAD sprint; ③ runs **one
  `pnpm build`** (Turbo affected) while holding the lock; ④ lands a PR + summary;
  ⑤ releases the lock. **Docker/infra rebuilds are still NOT run** — you (the
  human) batch those once via `bash scripts/dev.sh` / `scripts/deploy-prod.sh`
  after reviewing/merging the PRs.

## Ambition (v4 — epic-driven, vertical-slice delivery)

The routine must ship **medium-to-large, meaningful features** that move the product toward the cahier de charges vision (a parent dashboard that **turns information into action**) — not only refinements. It does this **without** giant PRs or breaking the safety model: ambition comes from **sequencing**.

- **One epic at a time.** `bmad/roadmap.md` holds the prioritized backlog of medium-to-large **epics** (e.g. complete alert engine, parent↔teacher messaging, remediation/tutoring loop, async exports & bulletins, advanced notifications, student portal). Victor (the Product Strategist) picks the current epic and the next slice.
- **Spec-kit once per epic.** The epic's first run is an **epic-spec run**: it writes `docs/spec/features/<epic-id>/` (`spec.md`, `plan.md`, `data-model.md`, `contracts/openapi.yaml`, `tasks.md`, `quickstart.md`, `PROGRESS.md`). Docs-only → no build, lands as a cheap PR. This is the BMAD/spec-kit backbone from the cahier §12.
- **Then one vertical slice per run.** Each subsequent **epic-slice run** implements the next item in `tasks.md` as a **vertical slice** — DB migration + API endpoint(s) + UI (+ worker) for ONE real capability — landing as a single reviewable PR (medium-sized, not a tweak). The run updates `PROGRESS.md` and ticks the slice in `roadmap.md`.
- **Run modes** (Victor decides in Intake):

  | Mode | When | Output | Build? |
  |---|---|---|---|
  | **epic-spec** | current epic has no `spec.md` | the spec-kit folder | no (docs) |
  | **epic-slice** | epic spec exists + slices remain | one vertical slice → PR | yes (1×) |
  | **polish** | no epic slice ready, or a quick high-value fix | the old small-improvement behavior | yes (1×) |

  **Bias: prefer epic-slice ≫ epic-spec ≫ polish.** Polish is the fallback, not the habit.
- **Slice sizing.** A slice is "one thing a user can now *do*", demoable end-to-end, that still fits one PR + one build + the ≤2-in-flight throttle. If a slice is too big for one PR, split it in `tasks.md` and ship the first half. Never widen a PR to "finish the feature" — sequence it.
- **Experiment.** Victor is explicitly licensed to propose net-new UX that makes the platform *incontournable* (alert→action: message the teacher / request a meeting / find tutoring straight from an alert; a weekly parent digest email; a remediation tracker; a teacher "class radar"). New cross-cutting ideas still need an ADR (Winston) before they land.

## Concurrency (v3 — why builds can't pile up)

Hourly fires + slow builds + a shared checkout could spawn many stuck building
sessions and fill disk C:. The gate prevents it (full detail in project-context §4b):
**single writer** (one `write.lock`; each run uses a feature branch in the main
checkout, never a worktree, so build artifacts aren't duplicated), **exactly one
`pnpm build` per run**, **≤ 2 in-flight routine PRs** (a 3rd tick skips), and
**auto-cleanup** of merged/closed routine branches+worktrees every run. A crashed
lock self-heals after 60 min. Knobs: `ROUTINE_MAX_INFLIGHT`, `ROUTINE_STALE_MIN`,
`ROUTINE_BUILD_WAIT`.

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

### Phase 0 — Intake & Roadmap · *Victor (Strategist) + Mary (Analyst)* · 1 agent
Read `bmad/roadmap.md`, the in-flight epic's `docs/spec/features/<epic>/PROGRESS.md`
(if any), `bmad/project-context.md §5`, `docs/spec/REDESIGN-PROGRESS.md`, ADRs,
recent `git log`, open PRs (`gh pr list`) and the previous run's summary.
**Victor** picks the current **epic** + decides the **mode**:
- no `spec.md` for the top epic → **epic-spec** (this run writes the spec-kit);
- spec exists + `tasks.md` has unstarted slices → **epic-slice** (pick the next slice);
- nothing epic-ready → **polish** (a quick high-value fix).
Bias **epic-slice ≫ epic-spec ≫ polish.** **Mary** compresses the pick into a
**contradiction-free intent** (BMAD Quick-Dev step 1) scoped to ONE shippable
slice that fits one PR + one build. Output the chosen `mode`, `epic`, `slice`.

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

### Phase 5b — Build verification (v3) · *orchestrator session, NOT an agent*
After the Workflow returns (and typecheck passed), the **lock-holding orchestrator
session** runs **exactly one** `pnpm build` (Turbo, **affected** packages, warm
cache) — the single heavy command, protected by the `write.lock` so no two runs
build at once. On failure: diagnose at the right layer, fix, rebuild **once**; if
still failing, open the PR prefixed "⚠️ build failing — needs human review" with
the error excerpt. **No docker/infra rebuild here** — that stays the human's batch.

### Phase 6 — Land (PR, then auto-merge when green) · *Amelia + Paige*
Conventional commit (`feat(parent): …`, `polish(admin): …`, `ui(teacher): …`),
push branch **`ci/YYYY-MM-DD-short-feature`**, open a PR whose body is a
**Checkpoint-Preview**: 1-line intent, scope metrics, concern-grouped walkthrough,
the tagged high-risk spots, **the build result**, and 2–5 manual things to try.
**No force-push.**

**Auto-land (so the routine never stalls while the human is away):** the
orchestrator session **auto-merges EVERY green PR to `main`** (squash), regardless
of risk tier (operator preference 2026-06-04):
- **green** (typecheck+build pass, no blockers) → **squash-merge** now
  (`gh pr merge --squash --delete-branch`). High-risk green PRs are merged too, just
  title-prefixed `[high-risk]` (+ escalation-panel notes) so they're easy to spot.
- **NOT green** (typecheck/build failed, or an unresolved blocker) → leave the PR
  **open**, flagged "build/typecheck failing — needs human review." Broken code
  never lands on `main`.

Auto-merge to `main` is **not** auto-deploy — the human still runs the rebuild, and
a green change has already passed typecheck + build + the 6-lens review — so `main`
always builds. Every auto-landed change is a one-commit squash → trivial revert.
The `≤ 2 in-flight` throttle now counts only **held (failed)** PRs, so the loop
essentially never waits.

### Phase 7 — Summary & memory · *Paige*
Emit the base routine's required summary (sprint title, portals, what/why, files,
checks run, screenshots if app running, worktree created/cleaned, commit hash,
PR link, remaining risks, **recommended next sprint**). Treat it as context for
the next run. Update `docs/spec/REDESIGN-PROGRESS.md` if a redesign item advanced.

## Start steps (v3 — gate-first, single writer in the main checkout)

1. **Gate first:** `bash bmad/scripts/routine-lock.sh gate` (runtime copy:
   `~/.claude/scheduled-tasks/daily-improvement-v2/routine-lock.sh`). It cleans
   merged/closed routine branches+worktrees, checks the ≤2 in-flight cap,
   acquires the single `write.lock`, ensures a clean up-to-date `main`, and prints
   `GATE=OK|FULL|BUSY`. If not `OK` → **stop**, do nothing else.
2. On `GATE=OK`, create the sprint branch **in the main checkout** (no worktree):
   `git checkout -b ci/YYYY-MM-DD-short-feature`. Invoke the Workflow with
   `args.worktree` = the main checkout path. Build once (Phase 5b). Land the PR.
3. **Always release:** `git checkout main` + `bash …/routine-lock.sh release`
   (on the happy path and on every abort). The legacy worktree flow below is
   retired — v3 never creates a worktree.

<details><summary>Legacy worktree steps (pre-v3, retained for reference)</summary>

1. `cd C:\Users\HP\Downloads\pilotage-scolaire-claude` · `git fetch --all --prune`.
2. `git worktree list`; clean **clean+merged** `ci/*` worktrees under
   `.claude/worktrees/` (never a dirty one — `git status` first; keep ≤ 5;
   `git worktree prune` after). Delete merged local `ci/*` branches.
3. Create a fresh worktree off latest `origin/main`:
   branch `ci/YYYY-MM-DD-short-feature`, folder
   `.claude/worktrees/ci-YYYY-MM-DD-short-feature`. Do all coding there.

</details>

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
