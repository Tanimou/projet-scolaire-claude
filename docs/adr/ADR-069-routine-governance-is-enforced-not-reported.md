# ADR-069 — Routine governance is ENFORCED at selection time, not reported at the end

- **Status:** accepted
- **Date:** 2026-08-23 (run 79, `S-ROUTINE-1`)
- **Supersedes:** nothing. **Amends:** the RULE 0 added 2026-08-13.
- **Related:** `ADR-064`/`ADR-065`/`ADR-067` (the `PF-51` clauses), PR #227 (single-writer revert), `PF-58`

## Verdict

RULE 0 asked each run to *report* its roadmap-to-tooling ratio in **Step 8** and to *re-derive* the previous run's
ratio from PR titles. Over 77 runs that produced **13 roadmap closures out of 119** — 11%. The rule was not ignored;
it was **unenforceable by construction**. This ADR moves the check to **selection time**, gives it a durable
artefact, and grades the evidence bar by risk so cheap findings stay cheap.

## Context — measured, not asserted

Full V3 window, 2026-08-02 → 2026-08-23, **77 runs / 22 days**:

| | |
|---|---|
| Findings closed | **119** |
| …of which ROADMAP (`PF-01…57`, `LG-xx`, `VAL-xx`) | **13** — 0.17 per run |
| …of which self-discovered (`PF-58+`, `TOOL-xx`) | **106** — 1.38 per run |
| Roadmap completion | **15/87 = 17.2%** *(corrected — see §D5)* |
| Self-discovered backlog | 245 raised, 91 closed, **154 open** (+23 `TOOL`) = **2.4×** the open roadmap backlog |

Three specific defects in RULE 0 v1:

1. **Step 8 is too late.** A ratio reported after the work is chosen, done and merged cannot change the choice.
2. **No artefact.** Re-deriving the previous run's ratio from PR titles is slow, silently skippable, and leaves
   nothing behind — so clause 4 ("never two consecutive tooling-only runs") was never checkable by anybody.
3. **It policed the smaller half.** Clause 3 covered only `TOOL-xx`, but **91 of the 106** non-roadmap closures were
   `PF-58+`.

## §D1 — The ledger lives outside the checkout; the checker lives inside it

`selection-log.jsonl` is written at **Step 1, before the sprint**, and sits in
`~/.claude/scheduled-tasks/daily-improvement-v3/state/`.

**Why outside:** it must be writable while another run holds the write lock, must survive branch switches, and must
survive the gate's salvage-stash — which has eaten uncommitted work before. An in-repo ledger satisfies none of
those.

**Why the checker is inside:** `scripts/roadmap-selection-check.js` is versioned, reviewable and covered by
`routine-governance-gate.spec.ts`. The asymmetry is the decision: *state* outside, *policy* inside.

**Rejected:** an in-repo ledger (unwritable under the lock — the exact case this run hit). **Rejected:** keeping the
ledger only in prose (that is v1).

## §D2 — The check is NOT inside `routine-lock.sh`

The lock is a mutex. A policy check inside a mutex is a policy check that can **wedge every future run**, and
`routine-lock.sh` is shared with V2. The asymmetry of harm is decisive: if the checker throws, one run lacks a
verdict; if the lock throws, nothing runs again. `routine-lock.sh` stays boring, and this run did not touch a byte
of it.

## §D3 — Evidence tiers A/B/C

Cost per finding had drifted to one setting: maximum. `S-E05-17` shipped a derived allowlist, a repo-wide ratchet,
an executed live probe and a multi-section ADR **for a missing enum guard**. Right for an authorization seam;
disproportionate for a stale link, and unaffordable at 0.17 roadmap findings per run.

- **A** — authZ/authN, tenancy, RLS, audit, migrations, finance, or any change to a response code or permission:
  full rigour. **Not gradeable downward**, even for a one-line diff.
- **B** — correctness, resilience, pagination, N+1: red-before/green-after test + triggered gates. No ratchet, no
  ADR unless a real judgement was made.
- **C** — dead links, copy, docs drift: one measurement. No ratchet, no ADR, no story file.

**A ratchet stays mandatory whenever a finding is closed as a CLASS rather than a site.** The tier governs ceremony,
never the honesty of a closure claim. If the ratchet is unaffordable, close the site and leave the class open — and
say so.

## §D4 — One extra lane, for docs only

`scripts/docs-lane-lock.sh` is a second, independent mutex. It does not touch `routine-lock.sh` or `write.lock`,
adds exactly one lane, and **enforces** (does not request) that the lane writes only under `docs/`.

This is not a re-run of S3. That coordinator replaced the single write lock with three tracks, all three wedged, and
`GATE=BUSY` logged zero throughput for hours until PR #227 reverted it. The failure was structural — N tracks
multiply the ways to stall. Here the build lane is untouched and single-writer; only work that provably cannot build
gets its own lane.

**Honest limit:** two writers in one checkout can still collide on a *file*, and `OPEN.md` is written by both lanes.
Hence the `conflicts` subcommand, which refuses while the implementation lane has uncommitted `docs/` changes. The
lock keeps docs work off the build lane's critical path; it does not make concurrent edits to one file safe.

## §D5 — Two corrections this slice had to make to its own analysis

**(a) "25 untriaged findings" was wrong — the real number is 2.** §3 of `OPEN.md` uses a *different, 5-column*
schema whose first cell holds a comma-separated LIST of ids (`| PF-47, LG-12, LG-27, PF-33, PF-41 | V3-E12 | … |`).
A parser expecting one leading id per row reports all 23 of those as untriaged. That is what the run-77 report did,
and acting on it would have written 23 duplicate rows. The ledger has **two schemas**; any tool that counts it must
read the whole first cell. `routine-governance-gate.spec.ts` §3 now encodes that rule, with an explicit non-vacuity
assertion that the parser can see grouped rows — without which the coverage result would be meaningless rather than
merely wrong.

**(b) Roadmap progress was UNDER-reported, not over-reported.** The two genuinely missing rows were `VAL-01` and
`PF-09`. `PF-09` (`BROKEN_SECURITY`, privilege escalation) was **already closed** by `S-E05-2`: `privilege-ceiling.ts`
implements `assertWithinCeiling`, both grant sites call it, and it has its own spec. The gap did not hide work to
do — it hid work already **done**. Corrected completion: **15/87 → 16/87** once `PF-09`'s row exists.

The general lesson, and the reason both corrections are recorded rather than quietly fixed: **a measurement that
drives a decision must itself be verified before the decision.** Both errors were caught by executing a check, not
by reading one.

## Consequences

- A run that would be the second consecutive tooling-only run is refused at Step 1, with a named reason.
- Progress counts stop depending on a parser that only understands one of the ledger's two schemas.
- Cheap findings get cheap evidence; Tier A is unchanged and non-negotiable.
- One more file must stay in sync (`SKILL.md` ↔ the tracked routine doc) — now gated, because it had already drifted
  143 lines and 11 days with zero mentions of RULE 0.
