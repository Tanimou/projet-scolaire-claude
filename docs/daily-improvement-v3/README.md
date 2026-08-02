# Daily Improvement V3 — planning artefacts

This folder turns the round-5 audits into an executable roadmap and a new autonomous routine.
**Daily Improvement V2 is unchanged and still usable** — V3 is additive.

## How to navigate

Read in this order the first time:

| # | File | What it answers |
|---|---|---|
| 1 | [`product-strategy.md`](product-strategy.md) | What are we trying to become, what do we copy from Lakoli, what do we refuse? |
| 2 | [`audit-findings-index.md`](audit-findings-index.md) | **The backbone.** Every finding with an id, class, work-type, source and owning epic |
| 3 | [`roadmap.md`](roadmap.md) | The five layers, why the order is a dependency order, and what "layer complete" means |
| 4 | [`dependency-map.md`](dependency-map.md) | What is unblocked right now, and why each edge exists |
| 5 | [`architecture-impact.md`](architecture-impact.md) | The five structural changes and the ADRs they require |
| 6 | [`risk-register.md`](risk-register.md) | What could go wrong, scored, with mitigations mapped to gates |
| 7 | [`open-decisions.md`](open-decisions.md) | The 10 human calls the routine cannot make — several are hard STOPs |
| 8 | [`traceability-matrix.md`](traceability-matrix.md) | Finding → epic → story → test → evidence, updated every run |
| 9 | [`epics/`](epics/) | Implementation-ready epics |
| 10 | [`sprints/sprint-plan.md`](sprints/sprint-plan.md) | Sprint grouping and gate sequencing |
| 11 | [`stories/`](stories/) | Run-sized stories |
| 12 | [`routine/`](routine/) | **The Daily Improvement V3 routine itself** |

## Epic index

| Layer | Epic | File |
|---|---|---|
| L0 | V3-E01 Tenant isolation and identity | [`epics/V3-E01-tenant-isolation.md`](epics/V3-E01-tenant-isolation.md) |
| L0 | V3-E02 … V3-E06 (database lifecycle · canonical truth · audit · authZ · hygiene) | [`epics/V3-E02-E06-layer0.md`](epics/V3-E02-E06-layer0.md) |
| L1 | V3-E07 … V3-E11 (assignment identity · grades/lessons · attendance · alerts · communication) | [`epics/V3-E07-E11-layer1.md`](epics/V3-E07-E11-layer1.md) |
| L2–L4 | V3-E12 … V3-E18 (admissions · documents · year transition · finance · delivery · breadth) | [`epics/V3-E12-E18-layers2-4.md`](epics/V3-E12-E18-layers2-4.md) |

`V3-E01` is written at full template depth and is the **exemplar** the other epic entries follow.

## Where the routine lives

| Artefact | In-repo (version-controlled) | Installed (executable) |
|---|---|---|
| Routine | [`routine/daily-improvement-v3.md`](routine/daily-improvement-v3.md) | `~/.claude/scheduled-tasks/daily-improvement-v3/SKILL.md` |
| Lock wrapper | [`routine/routine-lock.sh`](routine/routine-lock.sh) | `~/.claude/scheduled-tasks/daily-improvement-v3/routine-lock.sh` |

**The lock is shared with V2 on purpose.** Both routines operate on the same main checkout, so V3's wrapper delegates to
V2's `routine-lock.sh`. A second independent lock would defeat the single-writer guarantee the guard exists to provide.

> ⚠️ **Do not schedule V2 and V3 on the same tick.** They share the lock, so one would simply skip — but that wastes a
> run and confuses the logs. Disable the V2 schedule before enabling V3, or give V3 a non-overlapping cron.

## What V3 adds to V2, in one table

| | V2 | V3 |
|---|---|---|
| Work selection | `bmad/roadmap.md` ambition compass | V3 layer order + dependency eligibility, falling back to `bmad/roadmap.md` |
| Guardrails | Stated in roadmap prose | **Executed gate checks** (G-TENANT, G-AUTHZ, G-MIGRATION, G-AUDIT, G-TRUTH, G-PORTAL, G-DNC) |
| Definition of green | typecheck + build + no blockers | + gate evidence + no `DNC` regression + traceability updated |
| Completion evidence | Sprint summary | Finding closed in `traceability-matrix.md` with a named artefact |
| Discovered work | Absorbed or dropped | Recorded as a new finding id with priority before the run ends |
| Stop conditions | Gate FULL / BUSY | + decision-required · credential-required · destructive-production · legal-review-required · gate-weakening |
| Modes | `epic-spec` · `epic-slice` · `polish` | `epic-spec` · `epic-slice` (**no `polish`** — every run advances a traced finding) |

**Preserved unchanged from V2:** gate/lock protocol, single-writer feature branch in the main checkout, exactly one
`pnpm build` per run, agents never build, only the test-architect runs typecheck, disjoint implementation seams, PR-only
with Checkpoint-Preview body, auto-merge every green PR, ≤2 held PRs, no docker/infra rebuild, never `git add .claude/`,
one coherent improvement per run, never widen a PR to finish a feature, diagnose at the right layer.

## The one-sentence rationale

`bmad/roadmap.md` already required *"tenant + RLS + RBAC/ABAC + append-only audit on every backend change"* — and the
audits found **zero** RLS policies, a constant `demo` tenant fallback, role mutations that write no audit row, and two
attendance endpoints with no ABAC at all. **V2 shipped against a guardrail that was text; V3 makes it a gate.**

## Current state

Baseline recorded 2026-08-02, before the first V3 run: **89 findings mapped, 0 closed.**

After run 1 (2026-08-02, story `S-E02-0`): **90 mapped, 0 closed, 1 in-progress.** That run discovered **PF-58** — this
substrate was authored but never committed, so `main` had none of it and the routine's Step 1 could not execute. The fix
is committed on `ci/2026-08-02-v3-substrate-landing` but the push was blocked, so it is **not yet on `main`**; `PF-58`
closes when that PR merges. The run log lives at the foot of [`traceability-matrix.md`](traceability-matrix.md).

Sprint 01 is fully story-specified. Sprint 02+ story specs are produced by the routine in `epic-spec` mode against the
epic files, using the established `docs/spec/features/<epic>/` layout.

Ten decisions in [`open-decisions.md`](open-decisions.md) are open; **D-01** (restore window) and **D-08** (legal text)
block parts of Sprint 01, and **D-04** (target market) blocks all of Layer 4 and scopes Layer 3.
