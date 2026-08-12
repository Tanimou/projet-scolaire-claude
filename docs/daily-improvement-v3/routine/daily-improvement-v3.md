---
name: daily-improvement-v3
description: Daily Improvement V3 — audit-driven gap closure with executed release gates; SINGLE WRITER (shares V2's write.lock), hourly, PR-only, auto-merge only when green AND evidenced
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

## Step −1 — THE RUNTIME TARGET (mandatory, read before Step 0)

> **This section overrides anything later in this document that contradicts it, and it overrides V2.**
> Added 2026-08-04 by operator instruction, after run 18 spent effort reasoning about a host that is not a
> deployment target.

### The target is the LOCAL Docker stack. Full stop.

Every gate, every piece of evidence, every "does it actually run" question is answered against the **local Docker
containers** defined by `infra/docker-compose.yml` (plus profiles), on this machine.

### `pilotage.srv861861.hstgr.cloud` is NOT production. It is an audit fixture.

The Hostinger VPS exists because the round-5 audits needed a running instance to explore. It is **not** a production
deployment, it has no users, and **it is not a target of this routine**.

- **Never** deploy to it, never run `scripts/deploy-prod.sh`, never SSH to it, never send it an HTTP request.
- **Never** raise a finding whose severity depends on it being live — "the hosted deployment is insecure" is not a
  finding about a fixture. Where audit findings describe hosted behaviour, treat that as **evidence of what the code
  does**, not as an incident.
- `infra/docker-compose.prod.yml`, `.env.prod*` and `scripts/deploy-prod.sh` are still **code under review** — a defect
  in them is a real defect, because they describe how the system would be deployed. But its severity is
  "the deployment description is wrong", never "production is compromised".
- Findings already written in the hosted register keep their ids. Re-scope severity when touched; do not delete history.

### Rebuilding and recreating local containers is PERMITTED and EXPECTED

This is a **deliberate reversal** of a V2 rule, not a restoration of one. V2 §"Never rebuild" says docker rebuilds
*"stay the human's batched step"*. That is now false for V3: the operator has delegated it. Say so plainly in the run
log the first time it matters, so nobody reads V2 and thinks this document drifted.

When the local stack is stale, wrong, or simply unknown, **rebuild it and recreate the containers**:

```
docker compose --env-file .env -f infra/docker-compose.yml build <service>
docker compose --env-file .env -f infra/docker-compose.yml up -d --force-recreate <service>
docker compose --env-file .env -f infra/docker-compose.yml --profile obs up -d   # when evidence needs it
```

> **`--env-file .env` was missing from these three lines until run 20, and that is `PF-86`.** Compose resolves `.env`
> from the compose file's directory (`infra/`), not the caller's cwd, and `infra/.env` does not exist — so the three
> commands *this document* gave the routine started a stack on the compose defaults rather than on the ports the root
> `.env` declares. Run 19 was bitten by exactly this: Postgres came back without its `5433:5432` mapping and every
> host-side prisma command failed `P1001`. `S-E02-16` removed the defaults, so those commands now **refuse** instead of
> silently doing the wrong thing, and `scripts/compose-invocation-check.js` polices this file's own command lines.
>
> **Operator action:** `~/.claude/scheduled-tasks/daily-improvement-v3/SKILL.md` Step −1 carries the same three lines
> and lives outside this checkout, so the routine cannot fix it. Mirror the `--env-file .env` there.

Rules that still bind:

1. **Rebuild only when the run needs it as evidence** — because a gate must run against the artefact, because the
   containers predate the code, or because the story cannot be evidenced otherwise. Not as a reflex, and not "to be
   safe".
2. **Say what you rebuilt and why** in the run log and the PR body. A rebuild is a fact about the evidence, so it
   belongs beside the evidence.
3. **It does not consume the `pnpm build` budget.** `pnpm build` stays at exactly one per run; docker rebuilds are
   counted and reported separately, not rationed.
4. **Local data is expendable.** Recreating a container, resetting the local database, re-running a seed, wiping a
   local volume are all **allowed without asking**. There is no live data anywhere in this routine's reach.
5. **Leave the stack running and healthy**, or say explicitly that you did not. A run that leaves the local stack
   broken has damaged the next run's evidence base.

### The consequence you are most likely to under-use

A large amount of recorded evidence says **`deferred — needs a deployment we cannot touch`**: the release gate "has
never run against a real deployment", observability is "proven coherent, never *ingested*", the migration baseline is
"an operator action", the restore drill is "blocked on D-01", Next.js "is not actually booted".

**Most of that was blocked on hosted access, and hosted access was never the point.** Those items are now
**executable locally**. At Step 1, when a candidate story or a residual says *deferred / operator / hosted*, ask first
whether a local rebuild answers it. Converting a deferred evidence line into an executed one is a legitimate,
high-value slice — it is exactly V3's premise (gates executed, not asserted) applied to the routine's own backlog.

---

## What changed from V2, and why

| V2 behaviour | V3 behaviour | Reason (audit finding) |
|---|---|---|
| Selects work from `bmad/roadmap.md` ambition compass | Selects from `docs/daily-improvement-v3/roadmap.md` **layer order**, falling back to `bmad/roadmap.md` only when V3 layers are exhausted | V2 shipped features onto an untrusted substrate (A2 §2) |
| Guardrails ("tenant + RLS + RBAC/ABAC + audit") stated in roadmap prose | Guardrails are **executed gate checks**; a story touching a gated seam cannot land without evidence | RLS has 0 policies and 0 call sites despite the guardrail (PF-02) |
| Green = typecheck + build pass, no blockers | Green = typecheck + build + **gate evidence** + **no DNC regression** + **traceability updated** | UI existing was mistaken for a feature delivered (A2 App. A) |
| Progress recorded in `REDESIGN-PROGRESS.md` / epic `PROGRESS.md` | Also updates `traceability-matrix.md` — finding → story → test → evidence | Findings had no closure ledger |
| Discovered work absorbed silently or dropped | Discovered work is **recorded as a new finding id** with priority before the run ends | Scope expansion was invisible |
| Stops on gate FULL/BUSY | Also stops on **decision-required**, **credential-required** and **legal-review-required** | Several audit items need human calls (`open-decisions.md`) |
| Never rebuilds docker; the human batches it | **Rebuilds and recreates local containers whenever the evidence needs it** (Step −1) | Run 18: gates could not be executed against a running artefact, so evidence stalled at `deferred` |
| "Production" meant the hosted VPS | **There is no production.** The target is the local Docker stack; the VPS is an audit fixture (Step −1) | Operator instruction 2026-08-04 — run 18 reasoned about a host that is not a deployment target |

**Preserved from V2 without change:** the lock/gate protocol, single-writer feature branch inside the main checkout,
exactly one `pnpm build` per run, agents never build, only the test-architect runs `typecheck`, PR-only with
Checkpoint-Preview body, auto-merge every green PR, ≤2 *held* PRs, never `git add .claude/`, one coherent improvement
per run, diagnose at the right layer.

**Deliberately NOT preserved from V2:** the no-docker-rebuild rule (see **Step −1**). V2 keeps it; V3 does not. Both
documents are correct about themselves — do not "fix" either to match the other.

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

## Step 4 — ONE `pnpm build`, plus any docker rebuild the evidence needs (skip if `docsOnly: true`)

```
bash "$HOME/.claude/scheduled-tasks/daily-improvement-v3/routine-lock.sh" heartbeat
```

Run with `run_in_background: true`, heartbeat while polling. Prefer the affected filter
(`pnpm --filter <changed-package> build`). On failure: diagnose at the right layer, fix, rebuild once. Still failing →
open the PR with title prefix `⚠️ build failing — needs human review` and paste the error; do not loop.

**Heartbeat during Step 3 as well, not only here** (`PF-77` / `R-27`): Step 3 has run over an hour in every run since
run 9, `STALE_MIN` is 60 minutes, and on run 15 a concurrent tick reaped the lock mid-implementation and reset the
working tree. Do not rely on remembering — start a background loop that beats every ~15 minutes and stops when the lock
is released. Run 18 did this and the lock held across a 71-minute sprint.

### Docker rebuild — permitted, budgeted separately, reported

Per **Step −1**, rebuild and recreate local containers whenever the run's evidence needs a running artefact. This is
**not** rationed by the one-`pnpm build` rule and does not compete with it. Do it when:

- a gate must observe a running service (a real scrape, a real span ingested, a booted Next.js, an endpoint answering);
- the containers predate the code under test (check before trusting any "it works locally" claim — that was `R-05`);
- the story's evidence is otherwise stuck at `deferred`.

Report, in the PR body and the run log: **what** was rebuilt, **why** the evidence needed it, and **what state the
stack was left in**. A rebuild that is not reported is an unrecorded change to the next run's evidence base.

## Step 4b — Verify the stack you just built (only if you rebuilt)

A rebuild is worthless as evidence if you do not then look at the thing you built. Confirm the containers are up and
healthy, and that the service under test answers. If the rebuild left the stack broken and you cannot fix it in this
run, **say so explicitly in the report** — a silently broken local stack is the failure mode this step exists to
prevent, because the next run will read its own gates as green against nothing.

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

**Run `scripts/ci-gate.sh` — no flags — before deciding, and report its verdict line**, not the stages you happened
to watch pass (**R-23**). No-flags is the fast tier and is what every PR runs; **never add `--full`**, which adds the
build and six artefact scans and takes about 48 minutes. `--full` belongs to the verification sweep and the
pre-release run. Runs 17 and 18 both had a sprint return `landed: true` on a tree the full gate failed
(`PF-80`): the editing agent cannot see the blast radius of a shared edit from the directory it is working in. Also
beware the shell: `bash scripts/ci-gate.sh | tail` reports **`tail`'s** exit code, so read the printed
`GATE: PASS` / `GATE: FAIL` line rather than `$?`.

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
2. The story needs a **third-party credential or provider sandbox** that does not exist locally (payment provider,
   SMS gateway). A credential the local stack can supply — a Keycloak admin, a database password, a MinIO key — is
   **not** a stop: set it in the local stack and continue.
3. The story requires **legal review** (payroll statutory rules, sensitive/health data, retention policy).
4. Closing the finding would require **weakening a gate**.
5. The audit finding's precondition has changed so much that the story is now wrong — re-scope, do not force.

> **The old condition 3 — "destructive production action" — is deleted.** There is no production (Step −1). Resetting
> the local database, wiping a local volume, deleting local rows, re-seeding and recreating containers are all
> **ordinary work**, not stops. If you find yourself writing "blocked: this would require a destructive action on
> hosted data", you have mis-scoped the story — the target is local, and local data is expendable.
>
> This deletion is the single largest unblocking in this document: `VAL-03` (restore rehearsal), the hosted-database
> baseline, and the "never run against a real deployment" residuals on the release gate were all parked behind it.

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
- **Exactly one `pnpm build` per run.** Agents never build. **Docker rebuilds are separate, permitted, and unrationed**
  when the evidence needs a running artefact (Step −1 / Step 4) — report each one and leave the stack healthy.
- **The target is the local Docker stack.** `pilotage.srv861861.hstgr.cloud` is an audit fixture: never deploy to it,
  never call it, never raise a finding whose severity assumes it is live (Step −1).
- **Local data is expendable.** Reset, wipe, re-seed and recreate freely. There is no production to protect.
- **Single writer**; feature branch in the main checkout; never a worktree; never `git add .claude/`.
- **Never overwrite or modify V2.** V3 owns only `daily-improvement-v3/` paths and `docs/daily-improvement-v3/`.
- **Four portals.** Any change to shared data is checked on admin, teacher, parent *and* student.
- Be fully transparent: report failed validations, deferred evidence and residual risk explicitly.