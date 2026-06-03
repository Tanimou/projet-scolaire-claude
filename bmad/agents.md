# BMAD Agent Roster — mapped to the Daily-Improvement v2 pipeline

The v2 pipeline runs as a **Claude Workflow** (`bmad/workflows/sprint.workflow.js`)
that spawns these BMAD-style named agents, **up to 5–6 in parallel** (the runtime
also caps at `cpu-2`). Each agent owns exactly one artifact and reads
`bmad/project-context.md` first (the consistency guardrail). This mirrors
BMAD-METHOD's six core agents plus its Test-Architect, adapted to an autonomous,
PR-only continuous-improvement loop.

> **Resource budget (do not compromise CPU/RAM/disk).** Running 5–6 agents is
> cheap because they are API-bound *reviewers / light editors* — **only ONE
> agent (Murat) ever runs `pnpm typecheck`**, the single heavy local command,
> and **no agent ever builds**. Implement agents work on **disjoint file sets**
> (web vs api/worker vs ui), so there is one checkout and zero edit conflicts.

| # | BMAD persona | Pipeline role | Phase (parallel width) | Owns / outputs |
|---|---|---|---|---|
| 1 | **Mary** — Analyst | **Backlog & Intake** | 0 — Analysis (1) | prioritized backlog, ONE picked sprint, a *compressed, contradiction-free* intent |
| 2 | **John** — Product Manager | **Spec author** | 1 — Planning (≤5) | a self-contained `story` spec: goal, FRs, acceptance criteria, portals, files, `touchesUi/touchesBackend` |
| 3 | **Winston** — Architect | **Consistency guardian** | 1 — Planning (≤5) | ADR/convention ruling; flags any new architectural decision → requires an ADR; PASS/CONCERNS/FAIL readiness verdict |
| 4 | **Sally** — UX (optional) | **UX critic** | 1 — Planning (≤5) | premium/colorful/responsive/a11y requirements; only when the sprint touches UI |
| 5 | **Critic** — Pre-mortem | **Plan hardener** | 1 — Planning (≤5) | pre-mortem + inversion → failure modes that become extra acceptance criteria |
| 6 | **Murat (plan)** — Test Architect | **Test design** | 1 — Planning (≤5) | early P0–P3 risk pre-assessment + the single most valuable targeted test |
| 7 | **Amelia (FE)** — Developer | **Frontend dev** | 2 — Implement (≤3, disjoint) | Next.js/`@pilotage/ui` changes under `apps/web` |
| 8 | **Amelia (BE)** — Developer | **Backend dev** | 2 — Implement (≤3, disjoint) | NestJS/Prisma changes under `apps/api`/`apps/worker`; coordinates via `packages/contracts` |
| 9 | **DS Guardian** — Designer/Dev | **Shared-UI guardian** | 2 — Implement (≤3, disjoint) | reusable component changes under `packages/ui` only (no app-level markup) |
| 10 | **Quinn** — Reviewer | **Adversarial reviewer** | 3 — Verify (≤6) | "must-find-issues" + triage → confirmed `{severity, file:line, claim, fix}` list |
| 11 | **Sentinel** — Security | **Tenant/AuthZ reviewer** | 3 — Verify (≤6) | auth, `tenant_id` scoping, ABAC (`StudentAccessService`), append-only audit |
| 12 | **Edge Hunter** — Reviewer | **Edge-case hunter** | 3 — Verify (≤6) | exhaustive branching-path / boundary coverage gaps |
| 13 | **A11y** — Reviewer | **Accessibility** | 3 — Verify (≤6) | WCAG 2.2 AA gaps (contrast, focus, keyboard, aria, target size) when UI changes |
| 14 | **Drift** — Reviewer | **Consistency/ADR-drift** | 3 — Verify (≤6) | off-convention paths, undocumented architectural decisions, non-reused UI primitives, client N+1 |
| 15 | **Murat (gate)** — Test Architect | **Risk & gate** | 3 — Verify (≤6) | the ONLY `pnpm typecheck` run + `git diff --check`; P0–P3 tag; go/no-go + human-review flag |
| 16 | **Panel** — party-mode | **Escalation** | 5 — Escalate (≤3) | architect + security + test-architect consensus, **only** for P0/P1 / `[auth][schema][security]` changes |
| 17 | **Paige** — Tech Writer | **Summary & memory** | 6 — Land (1) | Checkpoint-Preview PR description + run summary that becomes next-run context |

## Operating rules (BMAD quality mechanisms, distilled)

- **Context engineering** — the Phase-1 `story` spec is *complete and self-contained*: the dev agents implement from it alone, so parallel agents stay aligned. (BMAD: "each document becomes context for the next phase.")
- **Adversarial review + triage** — Quinn must find problems, but a triage step grades each finding by confidence/severity *before* it blocks the PR (BMAD warns the skeptic produces false positives — never let it stall the loop on imagined issues).
- **Diagnose at the right layer** — on a failed check, decide whether the *intent* (Mary), the *spec* (John), or the *code* (Amelia) was wrong and re-enter at that layer. Do **not** blind-retry the same implementation (that is how loops thrash). Persist a graded evidence note (forensic discipline) so later runs don't re-walk dead ends.
- **Plan hardening** — before implementing, run a **pre-mortem** ("assume this change broke production — why?") and an **inversion** pass on the spec; surfaced failure modes become extra acceptance criteria / targeted tests.
- **Multi-lens verification** — Verify runs up to 6 reviewers in parallel (adversarial, security, edge-case hunter, accessibility, ADR-drift, and the typecheck gate), each a distinct *lens* so coverage is broad, not redundant.
- **Risk-tier routing + escalation panel** — a diff tagged `[auth]`/`[schema]`/`[security]` or P0/P1 is **never silently auto-merged**: it triggers a BMAD *party-mode* escalation panel (architect + security + test-architect, ≤3) and is flagged "needs human review" in the PR.
- **Parallelism cap** — at most **5–6 agents** run concurrently (the Workflow `parallel()` plus the runtime `cpu-2` cap enforce this); the main checkout is the shared write boundary; the PR is the single serialization point.
- **Build & concurrency (v3)** — **agents never build.** The single `pnpm build` (Turbo affected) is run **once** by the lock-holding orchestrator session after the Workflow, guarded by a machine-wide `write.lock` (`scripts/routine-lock.sh`) so overlapping hourly runs can't pile up builds or fill disk C:. Each run is a feature branch **in the main checkout** (single writer, no duplicated worktrees), capped at **≤ 2 in-flight PRs**, with merged branches/worktrees auto-deleted next run. Detail: `project-context.md` §4b.
