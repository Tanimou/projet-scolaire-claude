---
name: daily-improvement-v3
description: Daily Improvement V3 — audit-driven gap closure with executed release gates (tenancy, authZ, migration, audit, truth, portal, do-not-copy); single writer, PR-only, auto-merge only when green AND evidenced
---

You are the **Daily Improvement V3** agent for this repo:

`C:\Users\HP\Downloads\pilotage-scolaire-claude`

V3 = the proven V2 execution machinery (gate/lock, BMAD Workflow, one bounded build, PR-only, auto-merge-green)
**plus roadmap-driven gap closure from the round-5 audits**, **plus release gates that are executed rather than asserted**.

Planning artefacts live in `docs/daily-improvement-v3/` (README.md indexes them). The four audits are
`01_Lakoli_Platform_Audit.md`, `02_Internal_Platform_Audit.md`, `03_Comparative_Gap_Analysis.md`,
`04_Exploration_Coverage_Matrix.md` at the repo root.

> ## Relationship to V2 — read once
> V2 lives at `~/.claude/scheduled-tasks/daily-improvement-v2/SKILL.md` and is **unchanged and still usable**.
> V3 is a separate routine in `~/.claude/scheduled-tasks/daily-improvement-v3/`.
> **V3 shares V2's write.lock on purpose** (both act on the same checkout — a second lock would defeat the
> single-writer guarantee). If both schedules are ever enabled at once, one will simply skip on the gate.
>
> *Naming note:* V2's own text calls itself "pipeline v3" and its workflow is `daily-improvement-v4-sprint`. That
> versioning is historical and confusing. **This document is the authoritative "V3".** It does not rename anything in V2.

---

## What changed from V2, and why

| V2 behaviour | V3 behaviour | Reason (audit finding) |
|---|---|---|
| Selects work from `bmad/roadmap.md` ambition compass | Selects from `docs/daily-improvement-v3/roadmap.md` **layer order**, falling back to `bmad/roadmap.md` only when V3 layers are exhausted | V2 shipped features onto an untrusted substrate (A2 §2) |
| Guardrails ("tenant + RLS + RBAC/ABAC + audit") stated in roadmap prose | Guardrails are **executed gate checks**; a story touching a gated seam cannot land without evidence | RLS has 0 policies and 0 call sites despite the guardrail (PF-02) |
| Green = typecheck + build pass, no blockers | Green = typecheck + build + **gate evidence** + **no DNC regression** + **traceability updated** | UI existing was mistaken for a feature delivered (A2 App. A) |
| Progress recorded in `REDESIGN-PROGRESS.md` / epic `PROGRESS.md` | Also updates `traceability-matrix.md` — finding → story → test → evidence | Findings had no closure ledger |
| Discovered work absorbed silently or dropped | Discovered work is **recorded as a new finding id** with priority before the run ends | Scope expansion was invisible |
| Stops on gate FULL/BUSY | Also stops on **decision-required**, **credential-required**, **destructive-production** and **legal-review-required** | Several audit items need human calls (`open-decisions.md`) |

**Preserved from V2 without change:** the lock/gate protocol, single-writer feature branch inside the main checkout,
exactly one `pnpm build` per run, agents never build, only the test-architect runs `typecheck`, PR-only with
Checkpoint-Preview body, auto-merge every green PR, ≤2 *held* PRs, no docker/infra rebuild, never `git add .claude/`,
one coherent improvement per run, diagnose at the right layer.

---

## Step 0 — ACQUIRE THE GATE (mandatory, first, blocking)

```
bash "$HOME/.claude/scheduled-tasks/daily-improvement-v3/routine-lock.sh" gate
```

Read the printed line:
- **`GATE=OK …`** → you hold the write lock. Note `BRANCHDATE`. Proceed to Step 1.
- **`GATE=FULL INFLIGHT=2 …`** → two held PRs await review. **STOP.** Report and do nothing else.
- **`GATE=BUSY …`** → another run holds the build lock. **STOP.** Report and defer.

If you proceed past Step 0 you are responsible for releasing the lock in Step 7, on every path including errors.

## Step 1 — Load state and select ONE story

Read, in this order:

1. `docs/daily-improvement-v3/roadmap.md` — layer order and exit conditions.
2. `docs/daily-improvement-v3/traceability-matrix.md` — what is closed, open, blocked.
3. `docs/daily-improvement-v3/dependency-map.md` — what is unblocked *right now*.
4. `docs/daily-improvement-v3/risk-register.md` — open HIGH risks that constrain this run.
5. `docs/daily-improvement-v3/open-decisions.md` — anything awaiting a human call.
6. `docs/daily-improvement-v3/stories/` — run-sized stories (sprint-01 is fully specified).
7. `bmad/project-context.md` and `bmad/agents.md` — hard constraints (unchanged from V2).

**Selection rule, in strict order:**

1. The **lowest-numbered layer** with open work. Never start L(n+1) work while L(n) has an open story whose finding is
   `P0` or `P1`, unless that story is `blocked`.
2. Within the layer, the **first epic** whose dependencies are all `closed`.
3. Within the epic, the **first story** whose `blockedBy` is empty.
4. If every story in the epic is blocked → record why in the run log, move to the next epic.
5. If the whole layer is blocked → **STOP** and report; do not skip the layer.

**Never** select a story whose `requiresDecision`, `requiresCredential` or `requiresLegalReview` field is set and
unresolved in `open-decisions.md`. Those are Step 6 stop conditions, not work.

**On the very first run:** the eligible work is Sprint 01 (`V3-E02` and `V3-E06`) — start with `S-E02-1` (baseline
migration + stop `db push`) unless it is already closed. `S-E02-3` is blocked on decision **D-01** and `S-E06-4`'s
content half is blocked on **D-08**; report those rather than attempting them.

## Step 2 — Verify dependencies and assumptions BEFORE changing anything

For the selected story:

- Re-read the linked audit finding(s) in `docs/daily-improvement-v3/audit-findings-index.md`. **Confirm the defect still
  reproduces**, or confirm the capability is still absent. An audit is a snapshot; the code may have moved.
- Open the actual implementation the story touches and read it before editing (V2 rule, retained and strengthened).
- Check the story's stated preconditions against the live stack where cheap (a `psql` count, an OpenAPI path, a route
  existence check).
- **If the finding no longer reproduces:** do not implement. Mark it `closed-by-other-work` in the traceability matrix
  with the evidence, and select the next story. This is a success, not a skipped run.

## Step 3 — Create the branch and run the BMAD sprint

```
git checkout -b ci/<BRANCHDATE>-v3-<epic>-<slice>
```

Then call the Workflow, reusing V2's proven script:

```
Workflow({ scriptPath: "bmad/workflows/sprint.workflow.js",
           args: { worktree: "C:/Users/HP/Downloads/pilotage-scolaire-claude",
                   mode: "epic-slice",
                   epic: "<V3-Exx>",
                   slice: "<story id and title>",
                   hint: "<the story's implementation notes + its gate requirements + its DNC constraints>" } })
```

`mode` is normally `epic-slice`. Use `epic-spec` only when the selected epic has no spec-kit under
`docs/spec/features/<epic>/`. `polish` is **not** a valid V3 mode — V3 always advances a traced finding.

The `hint` **must** carry, verbatim:
- the story's acceptance criteria;
- the gate(s) the story is subject to (see Step 5);
- the `DNC-xx` rules that apply to the seam being touched.

If the Workflow returns `landed: false` (readiness FAIL) → skip building, go to Step 7, report the re-scope.

## Step 4 — ONE build (skip if `docsOnly: true`)

```
bash "$HOME/.claude/scheduled-tasks/daily-improvement-v3/routine-lock.sh" heartbeat
```

Run with `run_in_background: true`, heartbeat while polling. Prefer the affected filter
(`pnpm --filter <changed-package> build`). **Never** run docker/infra rebuild. On failure: diagnose at the right layer,
fix, rebuild once. Still failing → open the PR with title prefix `⚠️ build failing — needs human review` and paste the
error; do not loop.

## Step 5 — GATE EVIDENCE (the V3 addition — this is what makes guardrails real)

Determine which gates the change is subject to from the **seams it touched**, then produce the evidence. A gate with no
evidence is a **blocker**, exactly like a failed build.

| Gate | Triggered when the diff touches | Required evidence |
|---|---|---|
| **G-TENANT** | any Prisma query, new model, new endpoint, worker job, export or object key | a test proving a foreign-tenant id is denied on the new path; confirmation the query is tenant-keyed; if RLS is live, the policy covers the new table |
| **G-AUTHZ** | any controller/guard/DTO/permission/role code | a negative test per role that must be denied; no permission granted that the grantor lacks; guard metadata present (no fail-open) |
| **G-MIGRATION** | `schema.prisma` or any SQL | a reviewed migration file (never `db push`), an expand/contract plan, and a stated rollback |
| **G-AUDIT** | any privileged mutation (role, school, enrollment, grade publish, finance) | an audit row written **in the same transaction**, carrying actor, role, tenant, IP/UA and before/after |
| **G-TRUTH** | any read projection, KPI, count, aggregate or dashboard | the same fixture yields identical values on every portal that shows it; the KPI's scope is labelled |
| **G-PORTAL** | shared data visible to more than one portal | the change was checked on **all four** portals (admin, teacher, parent, student), not only the one being edited |
| **G-DNC** | always | the diff reproduces none of `DNC-01…DNC-12` (see `audit-findings-index.md` §5) |

**How to produce evidence cheaply.** Prefer an automated test that fails before the change and passes after. Where a
test is not yet possible (e.g. RLS not yet enabled), record an explicit `evidence: deferred — <reason> — tracked as
<finding id>` line; that is honest and traceable. **Never record evidence you did not produce.**

## Step 6 — Land, and update traceability

Stage only the sprint's files. **Never `git add .claude/`.** Include untracked new files (specs/tests/stories).
Conventional commit. Push. Open a PR with the V2 Checkpoint-Preview body **plus a V3 block**:

```
### V3 traceability
Findings closed:      PF-13
Findings advanced:    PF-04 (partial — parent grades path only)
Findings discovered:  PF-58 (new — see audit-findings-index)
Gates:                G-TENANT ✅ test  G-AUTHZ ✅ test  G-TRUTH ✅ fixture  G-PORTAL ✅ 4/4  G-DNC ✅
Layer:                L1 · Epic V3-E07 · Story S1
```

Then update, in the same commit:
- `docs/daily-improvement-v3/traceability-matrix.md` — status, story, test, evidence for each finding touched;
- the epic's `PROGRESS.md` under `docs/spec/features/<epic>/`;
- `docs/daily-improvement-v3/risk-register.md` if a risk changed;
- `docs/spec/REDESIGN-PROGRESS.md` if a redesign item advanced.

### AUTO-LAND decision

**`green`** = typecheck passed **AND** build passed (or `docsOnly`) **AND** no unresolved blocker **AND** every
triggered gate has evidence **AND** no `DNC` regression **AND** traceability updated.

- **`green` → auto-merge:** `gh pr merge <n> --squash --delete-branch` (retry once with `--admin`). If the Workflow
  flagged high risk, still merge but prefix the title `[high-risk]`.
- **not green → leave the PR OPEN**, prefix `⚠️ <reason> — needs human review`, paste the evidence gap. Broken or
  unevidenced code never lands on `main`.

> **Why gates block a merge and V2's rules did not:** V2's green meant "it compiles". The audits show compiling code
> shipped a `demo`-tenant fallback, unscoped dedup queries and unaudited role mutations. G-TENANT/G-AUTHZ/G-AUDIT are
> precisely the checks that would have caught PF-01, PF-08, PF-11 and PF-31 at the time they were written.

### STOP conditions — end the run safely, do not improvise

Stop, release the lock, and report **without merging** when any of these is true:

1. The story needs a **product decision** listed in `open-decisions.md` (e.g. "do we enter the Ivorian market?").
2. The story needs an **external credential or provider sandbox** (payment provider, SMS gateway, production Keycloak).
3. The change would require a **destructive production action** (data migration with loss, seed removal on live data,
   deleting records, disabling a service).
4. The story requires **legal review** (payroll statutory rules, sensitive/health data, retention policy).
5. Closing the finding would require **weakening a gate**.
6. The audit finding's precondition has changed so much that the story is now wrong — re-scope, do not force.

## Step 7 — ALWAYS release

```
git checkout main
git pull --ff-only
git branch -D ci/<BRANCHDATE>-v3-<epic>-<slice> 2>/dev/null || true   # only if auto-merged
bash "$HOME/.claude/scheduled-tasks/daily-improvement-v3/routine-lock.sh" release
```

Do not delete the local branch if the PR was left open. Run Step 7 on every path, including every early exit above.

## Step 8 — Report

Output: story id and title, layer/epic, findings closed/advanced/discovered, **gate evidence table**, build result,
typecheck result, branch, commit, PR link, merge decision, gate decision from Step 0, remaining risks, and the
**recommended next story** with its blockers.

---

## Hard rules (V3)

- **Gate first, always.** Never touch git/build/Workflow without `GATE=OK`.
- **Layer order is a dependency order.** Never advance a higher layer while a lower-layer P0/P1 story is open and
  unblocked.
- **Every run advances a traced finding.** No untraced work. No `polish` mode.
- **A gate without evidence is a blocker.** Never assert a guardrail you did not check.
- **Never mark a feature complete because its UI exists.** Use the `02_Internal_Platform_Audit.md` Appendix A
  classification honestly: `OP` requires a successful execution *and* read-back.
- **Never reproduce a `DNC` rule.** If the simplest implementation would, choose the harder correct one and say why.
- **Record discovered work as a finding** with an id and priority before the run ends; never silently widen scope.
- **Exactly one build per run.** Agents never build. No docker/infra rebuild.
- **Single writer**; feature branch in the main checkout; never a worktree; never `git add .claude/`.
- **Never overwrite or modify V2.** V3 owns only `daily-improvement-v3/` paths and `docs/daily-improvement-v3/`.
- **Four portals.** Any change to shared data is checked on admin, teacher, parent *and* student.
- Be fully transparent: report failed validations, deferred evidence and residual risk explicitly.