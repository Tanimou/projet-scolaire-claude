# BMAD Agent Roster — mapped to the Daily-Improvement v2 pipeline

The v2 pipeline runs as a **Claude Workflow** (`bmad/workflows/sprint.workflow.js`)
that spawns these BMAD-style named agents, **never more than 3–4 in parallel**.
Each agent owns exactly one artifact and reads `bmad/project-context.md` first
(the consistency guardrail). This mirrors BMAD-METHOD's six core agents plus its
Test-Architect, adapted to an autonomous, PR-only continuous-improvement loop.

| # | BMAD persona | Pipeline role | Phase | Owns / outputs |
|---|---|---|---|---|
| 1 | **Mary** — Analyst | **Backlog & Intake** | 0 — Analysis | prioritized backlog, ONE picked sprint, a *compressed, contradiction-free* intent |
| 2 | **John** — Product Manager | **Spec author** | 1 — Planning | a self-contained `story` spec: goal, FRs, acceptance criteria, portals, files to touch |
| 3 | **Winston** — Architect | **Consistency guardian** | 1 — Solutioning | ADR/convention compliance ruling; flags any new architectural decision → requires an ADR; PASS/CONCERNS/FAIL readiness verdict |
| 4 | **Sally** — UX (optional) | **UX critic** | 1 — Planning | premium/colorful/responsive/a11y review of the planned UI; only when the sprint touches UI |
| 5 | **Amelia (FE)** — Developer | **Frontend dev** | 2 — Implement | Next.js/`@pilotage/ui` changes in the worktree |
| 6 | **Amelia (BE)** — Developer | **Backend dev** | 2 — Implement | NestJS/Prisma changes; coordinates with FE through `packages/contracts` |
| 7 | **Quinn** — Reviewer | **Adversarial reviewer** | 3 — Verify | "must-find-issues" pass on the diff → `{severity, file:line, claim, fix}` list |
| 8 | **Sentinel** — Security | **Tenant/AuthZ reviewer** | 3 — Verify | auth, `tenant_id` scoping, ABAC (`StudentAccessService`), append-only audit |
| 9 | **Murat** — Test Architect | **Risk & gate** | 3/Merge | P0–P3 risk tag (`[auth][schema][security][billing][public-api]`), targeted-test decision, go/no-go |
| 10 | **Paige** — Tech Writer | **Summary & memory** | 6 — Land | Checkpoint-Preview PR description + run summary that becomes next-run context |

## Operating rules (BMAD quality mechanisms, distilled)

- **Context engineering** — the Phase-1 `story` spec is *complete and self-contained*: the dev agents implement from it alone, so parallel agents stay aligned. (BMAD: "each document becomes context for the next phase.")
- **Adversarial review + triage** — Quinn must find problems, but a triage step grades each finding by confidence/severity *before* it blocks the PR (BMAD warns the skeptic produces false positives — never let it stall the loop on imagined issues).
- **Diagnose at the right layer** — on a failed check, decide whether the *intent* (Mary), the *spec* (John), or the *code* (Amelia) was wrong and re-enter at that layer. Do **not** blind-retry the same implementation (that is how loops thrash). Persist a graded evidence note (forensic discipline) so later runs don't re-walk dead ends.
- **Plan hardening** — before implementing, run a **pre-mortem** ("assume this change broke production — why?") and an **inversion** pass on the spec; surfaced failure modes become extra acceptance criteria / targeted tests.
- **Risk-tier routing** — a diff tagged `[auth]`/`[schema]`/`[security]` is **P0/P1**: it gets the security reviewer + extra scrutiny and is flagged in the PR for human review, never silently auto-merged.
- **Parallelism cap** — at most 3–4 agents run concurrently (the Workflow `parallel()`/`pipeline()` enforces this); the worktree is the shared isolation boundary; the PR is the single serialization point.
