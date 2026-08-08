# Traceability Matrix — index

> **The ledger is partitioned.** It grew from 15 KB to 281 KB in six days and was read in full at the start of every
> run, so each run paid for every run before it. Partitioned 2026-08-08 by the throughput change (S1). Nothing was deleted — every row lives in exactly one file.

| Read this | When |
|---|---|
| [`traceability/OPEN.md`](traceability/OPEN.md) | **Every run.** Open, in-progress, blocked and deferred rows — the only selection input |
| [`traceability/CLOSED-L0.md`](traceability/CLOSED-L0.md) … [`CLOSED-VAL.md`](traceability/CLOSED-VAL.md) | On demand, for audit. Append-only; never read during selection |
| [`traceability/RUN-LOG.md`](traceability/RUN-LOG.md) | On demand, for history |
| §"Do-not-copy" below | **Every run** — G-DNC is checked on every diff |

**Rules that did not change.** A finding still may not be `closed` without a named artefact as evidence. A layer still
may not close while it holds an open finding. `deferred-with-reason` now requires an entry in
[`open-decisions.md`](open-decisions.md) — it is a human call, not an agent's.

# Traceability Matrix

Bidirectional chain, maintained by the V3 routine on every run:

```
Audit finding → requirement → epic → story → implementation → test → validation evidence
```

**Status vocabulary:** `open` · `in-progress` · `closed` · `closed-by-other-work` · `blocked` · `deferred-with-reason`.
A finding may only move to `closed` when the **Evidence** column names a reproducible artefact (a test id, a fixture
run, a migration file, a PR number) — never a claim.

**Routine obligation.** Step 6 of `routine/daily-improvement-v3.md` requires this file to be updated in the same commit
as the change. A PR that touches a finding without updating its row is **not green**.

---

## 4. Do-not-copy compliance ledger

Checked by gate **G-DNC** on every run. A story that reproduces one of these is **not green**.

| Rule | Applies to epics | Status |
|---|---|---|
| DNC-01 KPI/ledger divergence | V3-E15, V3-E16, V3-E03 | `enforced` |
| DNC-02 future-dated attendance | V3-E09 | `enforced` |
| DNC-03 date drift on save | V3-E08, V3-E09, V3-E18 | `enforced` |
| DNC-04 pre-enrollment silos | V3-E12 | `enforced` |
| DNC-05 HR→teacher deadlock | V3-E18 | `enforced` |
| DNC-06 guide/runtime mismatch | V3-E13 | `enforced` |
| DNC-07 client-side comms state | V3-E17 | `enforced` |
| DNC-08 automation as release gate | routine itself | `enforced` |
| DNC-09 "coming soon" gating ambiguity | V3-E06 | `enforced` |
| DNC-10 hard-coded bypass | V3-E01, V3-E05 | `enforced` |
| DNC-11 refused applicant in official output | V3-E12, V3-E13 | `enforced` |
| DNC-12 irreversible-close contradiction | V3-E16 | `enforced` |

## 5. Closure summary

**Recounted programmatically on 2026-08-07 (run 20, re-derived run 22)** by parsing this file's own rows, rather than adjusted by hand
each run. The previous table had drifted: it read `L0 60 mapped / 19 closed` while section 1 already contained 29
closed rows. Hand-maintained counters in a file this size go stale silently, which is the same failure mode as every
`R-26` instance below them — so the numbers below name their counting rule and can be re-derived.

> **Run 22 re-derivation, and one honest caveat about the rule.** The L0 line above is re-derived by the same
> parse (a status token in the fourth column of a section-1 row): **85 rows, 33 closed, 47 open, 4 in-progress,
> 1 blocked** — +4 rows and +3 closed since run 20, from the six ids runs 21 and 22 raised (`PF-91`…`PF-96`) net of
> `PF-19` and `PF-29` moving `open` → `closed`. The **L1 line is left untouched deliberately**: the re-derivation
> reads 17 status-bearing rows there against the 20 the table claims, so the two counting rules disagree about L1 and
> the discrepancy is named rather than silently resolved in favour of whichever number this run happened to compute.

| Layer | Rows in section | Closed | Open | In progress | Blocked |
|---|---|---|---|---|---|
| L0 | 109 *(106 distinct — `PF-03` and `PF-67` each carry two rows by design: a half and a widening, and `PF-104` briefly carried two findings until `S-E02-18` renumbered one to `PF-112`; +`PF-119`, `PF-120` run 28; +`PF-121`, `PF-122`, `PF-123` run 29)* | 45 *(+`PF-120`)* | 55 *(+`PF-119`; +`PF-121`, `PF-122`, `PF-123` run 29; −`PF-14`, `PF-31`, `PF-32`, moved to `in-progress` by run 28)* | 8 *(+`PF-14`, `PF-31`, `PF-32` — specced and re-measured by run 28, `PF-31` **partially implemented** by run 29 at the 8 + 9 literal sites)* | 1 *(PF-59)* |
| L1 | 20 *(17 + PF-62, PF-64, PF-66)* | 1 *(PF-62)* | 19 | 0 | 0 |
| L2 | 12 | 0 | 12 | 0 | 0 |
| L3 | 8 | 0 | 8 | 0 | 0 |
| L4 | 10 | 0 | 10 | 0 | 0 |

> **The L0 figures above were COUNTED on 2026-08-08 (run 26), not incremented.** They had read `85 / 33 / 47 / 4 / 1`
> for several runs while rows were added and closed beneath them — a roll-up nobody recomputes is a number that
> eventually lies, which is the `R-26` shape landing on this file's own summary. L1–L4 keep their stated convention (a
> finding whose row sits physically in the L0 section is still counted against its owning layer), so they are left as
> written rather than silently re-derived under a different rule.

**No cross-layer total is given, deliberately.** Five findings are listed in two sections on purpose — `PF-62` was
found by an L0 story and is owned by L1; `PF-64` and `PF-66` sit in section 1's "found by running the tests" block but
map to `V3-E10` / `V3-E11`. Any single total therefore either double-counts them or hides the dual ownership that
makes the register useful. Adding them up produced the number that was wrong before.

Six findings were added by the 2026-08-02 (run 5) execution of the test suites — `PF-62` (production P0, closed same
run), `PF-63`…`PF-66` (18 red tests, baselined) and `PF-67` (wiring guards assert on source, not on a booted route
table). **The register growing is the routine working**, not scope creep: none of these were visible until something
was actually run. Runs 15–20 continued that pattern — `PF-77`…`PF-90` were all found by executing something, and four
of them (`PF-83`, `PF-84`, `PF-89`, `PF-90`) were found *by the gate or the fix written in the same run*.

`PF-58` is `closed`: PR [#170](https://github.com/Tanimou/projet-scolaire-claude/pull/170) merged as `81c6e15`.

`PF-59` is `blocked`, not `open`: no code change can resolve an account-level billing lock. It leaves the register
only when the repo owner restores Actions billing; until then treat every CI-derived gate as `evidence: deferred`.

*(12 `DNC` rules and 10 `VAL` obligations are tracked separately above; several `VAL` items are also mapped to L0
stories, so the totals here count each finding once at its owning layer.)*

Baseline recorded 2026-08-02, before the first V3 run.

