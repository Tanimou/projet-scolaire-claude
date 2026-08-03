# Risk Register

Reviewed by the V3 routine at Step 1 and updated at Step 6. A `HIGH` risk with no accepted mitigation **blocks its
owning layer** from being declared complete (`roadmap.md` §10).

**Scoring:** Likelihood × Impact, each Low/Medium/High. Severity is the worse of the two, escalated one level when the
risk concerns children's data or money.

---

## 1. Open risks

| ID | Risk | L | I | Sev | Owning epic | Mitigation | Status |
|---|---|---|---|---|---|---|---|
| **R-01** | **A tenancy fix migrates hosted data incorrectly and is unrecoverable**, because there is no migration history and prod runs `db push --accept-data-loss` | M | H | **CRITICAL** | V3-E02 → V3-E01 | Sequence E02 before E01; require a timed restore rehearsal (VAL-03) before any tenancy migration; expand/contract only; no destructive column drops in the same release. **Partially delivered 2026-08-02 (S-E02-1):** the migration ledger exists, no executable path runs `db push`, and the expand/contract + rollback plan is written down (`docs/runbooks/baseline-hosted-database.md` §5–6). **Still open** because the *hosted* database is not yet baselined (operator action) and VAL-03 remains blocked on **D-01** | open |
| **R-02** | **Cross-tenant data exposure persists undetected** because the fix is applied at the application layer only and a later query forgets the predicate | M | H | **CRITICAL** | V3-E01 | Database-enforced RLS *plus* application predicate; two-tenant adversarial suite (VAL-02) runs in CI on every PR, not once — **currently inert, see R-21 / PF-59** | open |
| **R-03** | **Canonicalising queries changes numbers users already rely on**, and the change is read as a new bug | H | M | **HIGH** | V3-E03 | Publish a KPI definition per metric with scope + freshness; ship a reconciliation console showing old vs new; announce before switching | open |
| **R-04** | **The routine marks a feature complete because its UI renders**, repeating the audit's central error | M | H | **HIGH** | routine | G-TRUTH + G-PORTAL gates; A2 Appendix A classification required in every PR; `OP` demands execution *and* read-back | mitigated by design |
| **R-05** | **Hosted images and schema drift from `main` again**, so V3 fixes are audited but not running | H | H | **CRITICAL** | V3-E02 | Immutable build/schema manifest per release; VAL-10 records running SHA + schema version; deploy gate compares them. **Impact raised M→H on 2026-08-02: this risk has already materialised.** The local Docker image (built 2026-06-06) carries `controllers: [AssessmentsController, GradesController]` in `dist/modules/grades/grades.module.js`, yet **no ref in the repository** has contained that line since 2026-06-01 — the running artefact was built from an uncommitted working tree. The consequence was not cosmetic: local behaviour looked healthy while the same routes returned 404 in production for seven weeks (`PF-62`), so manual testing could not have caught it. S-E02-1's `/version` manifest exposes the running SHA but **nothing compares it to the expected one** — that missing comparison is the live half of this risk. **Mitigation delivered 2026-08-03 (S-E02-6):** the comparison now exists between two independent sources (`GIT_SHA` baked at build time vs `EXPECTED_GIT_SHA` injected at deploy time); a drifted, dirty or unstamped artefact refuses to serve in production and fails `scripts/release-gate.sh`, which `deploy-prod.sh` runs after the healthcheck; `deploy-prod.sh` refuses a dirty working tree, which is the exact root cause of the materialisation. Step 2 also found the manifest was **inert** as shipped — the SHA was never stamped by anything and `/version` was unroutable behind nginx (`PF-68`). **Not yet `mitigated`:** the gate has never run against the *hosted* deployment, because that deployment predates `/version` — the hosted host returns 404 on it today, which is this risk still live. It downgrades on the first deploy that passes the gate | **materialised — mitigation shipped, unproven on hosted** |
| **R-06** | **Finance is built on mutable balances** and reproduces Lakoli's KPI/ledger divergence (DNC-01) | M | H | **HIGH** | V3-E15 | Immutable ledger entries only; every dashboard total derived with drill-down; reconciliation test with partial/over/duplicate/reversed cases | open |
| **R-07** | **A gate is weakened to let a story land** when evidence is hard to produce | M | H | **HIGH** | routine | Step 6 STOP condition #5 makes gate-weakening a stop, not a judgement call; deferred evidence must name a tracking finding id | mitigated by design |
| **R-08** | **Parent/child linkage repair changes who can see a child**, causing either lost access or wrongful access | M | H | **HIGH** | V3-E03 | Effective-dated link model with explicit historical states; ABAC tests for both directions; no silent widening | open |
| **R-09** | **Attendance atomicity fix invalidates existing rates**, and historical reports change retroactively | M | M | MEDIUM | V3-E09 | Recompute is explicit and versioned; label affected periods; do not silently rewrite published artefacts | open |
| **R-10** | **Audit backfill is impossible** for historical rows (no IP/UA/hash ever written), leaving a permanent gap | H | M | MEDIUM | V3-E04 | Do not fabricate history; start the chain at a declared genesis row and document the pre-V3 gap explicitly | open |
| **R-11** | **RLS degrades query performance** on large tenants once enabled | M | M | MEDIUM | V3-E01 | Benchmark before/after on the largest seeded tenant; index tenant predicates; treat as a release criterion not an afterthought |
| **R-12** | **Removing the demo seed breaks the hosted demo** that stakeholders use | H | L | MEDIUM | V3-E02/E06 | Keep an explicit, opt-in, clearly-labelled demo tenant provisioned by a separate command — never by production startup. **Delivered 2026-08-03 (S-E02-4):** the seed is now opt-in (`deploy-prod.sh --seed`) and gated on two independent signals, but the demo is **preserved, not deleted** — `DEPLOY_ENV=demo` + `ALLOW_SEED=provision-demo-data` reprovisions it, and the allowed path was **executed** to prove the guard is not a blanket refusal (the script crosses the guard and fails on the DB connection instead). Runbook: `docs/runbooks/provision-demo-tenant.md` | mitigated |
| **R-13** | **Legal pages are published without legal review**, creating a worse liability than the current 404 | M | M | MEDIUM | V3-E06 | Ship a holding page that states the policy is being finalised and gives a contact route; do not invent policy text (D-08) | open |
| **R-14** | **The four-portal check becomes a checkbox** rather than a real verification | M | M | MEDIUM | routine | G-PORTAL requires naming what was observed per portal, not asserting "4/4" | mitigated by design |
| **R-15** | **Scope silently expands** as capability epics discover foundation defects | H | M | MEDIUM | routine | dependency-map §5: no back-edges into L0; discovered defects become new finding ids scheduled at their own layer | mitigated by design |
| **R-16** | **V2 and V3 run on the same tick** and contend for the checkout | M | H | **HIGH** | routine | V3's lock wrapper delegates to V2's script, so both share one `write.lock`; additionally, operator must disable the V2 schedule before enabling V3 | mitigated by design |
| **R-23** | **A gate stage is permanently red and the runs report around it.** Observed 2026-08-03: `ci-gate.sh`'s `lint` stage has failed since it was written (ESLint v9 flat-config missing everywhere, `PF-70`), 4 of its 13 tasks are green only from turbo cache predating the version bump, and runs 5, 6 and 7 each declared their change green while citing typecheck/ratchet/build and never naming stage 2 | **H** | H | **CRITICAL** | routine / V3-E02 | A run must report the gate's **verdict line**, not a selection of its stages: if `ci-gate.sh` prints `GATE: FAIL`, the PR body says so and names the failing stage even when the cause is pre-existing. A cached green is not an executed green — when a stage's result decides a merge, re-run the suspicious task without cache before citing it. **Instance closed 2026-08-03 (`S-E02-7`):** the `lint` stage now executes in all 13 turbo tasks and exits 0, proven with `--force` so nothing could report a stale ✓, and proven to still **fail** on a deliberate error probe. Step 2 found the risk had been *understated* — not 4 cached-green tasks but **7 of 8 packages exiting 2**, with the single green one (`apps/web`) passing only through the deprecated `next lint`. A committed guard (`lint-gate.spec.ts`, 26/26) now fails if a package loses its flat config, if a `.eslintrc*` returns, or if a script reverts to `next lint`. **Risk stays `open` for the general case:** the guard protects *this* stage, and nothing yet forces a run to report the other five | open — instance closed, discipline still unenforced |
| **R-22** | **"CI is down" is read as "the gate cannot exist"**, so stories that are locally executable are parked as blocked. Observed: the 2026-08-02 run recorded `S-E02-2` as ⛔ blocked by `PF-59` when the suites were runnable all along on the machine the routine already uses — and the first execution found a seven-week-old production P0 (`PF-62`) | **H** | H | **CRITICAL** | routine | `PF-59` blocks the *hosted runner*, not the *gate*. Before marking any story blocked on CI, check whether its evidence can be produced in the run's one permitted build slot; `scripts/ci-gate.sh` exists precisely so that check is one command. A story is only CI-blocked if its evidence genuinely requires hosted infrastructure | open |
| **R-21** | **Gate evidence silently reverts to assertion** because no CI runner exists (`PF-59`: Actions account-locked for billing). Every mitigation in this register that says "runs in CI" — R-02 above in particular — is currently inert, and a run could record a gate as satisfied on the strength of a test that was written but never executed | **H** | H | **CRITICAL** | routine / V3-E02 | Until billing is restored: a gate whose evidence is a CI test must be recorded as `evidence: deferred — PF-59` and the PR left open, never merged as green on an unexecuted test. Where a test can be run locally in the one permitted build slot, run it and say so explicitly. Restoring Actions billing is the actual fix and is an owner action | open |
| **R-17** | **Capability work starts before the market decision**, building Ivorian-specific modules for an EU-shaped product (or vice versa) | M | H | **HIGH** | V3-E18 | D-04 is a hard STOP condition; L4 epics cannot be selected while D-04 is unresolved | open |
| **R-18** | **Provider integration is built against an unavailable sandbox**, producing untestable code | M | M | MEDIUM | V3-E16/E17 | Credential-required is a STOP condition; provider adapter behind an interface with a deterministic fake for tests | open |
| **R-19** | **Accessibility regressions accumulate** because WCAG is never actually run | H | M | MEDIUM | V3-E02 | Put the existing axe/Playwright assets into CI as a gate (VAL-01/VAL-08); nested-interactive-control lint rule | open |
| **R-20** | **The audit's own snapshot goes stale** and V3 fixes findings that no longer reproduce | M | L | LOW | routine | Step 2 requires re-confirming reproduction before implementing; non-reproducing findings close as `closed-by-other-work` | mitigated by design |

## 2. Risks explicitly accepted (for now)

| ID | Risk | Why accepted | Revisit when |
|---|---|---|---|
| **A-01** | Pre-V3 audit history has no IP/UA/hash chain | Cannot be reconstructed; fabricating it would be worse than the gap | Never — documented permanently |
| **A-02** | Lakoli's teacher workspace and sensitive-follow-up behaviour remain unvalidated | Blocked by role; not required to build our own | If a competitive claim depends on it |
| **A-03** | Orientation/Conformity depth is unknown beyond the shipped client | `IMPLEMENTED_BUT_GATED`; not on our roadmap until D-04 | D-04 resolves toward Côte d'Ivoire |
| **A-04** | Synthetic audit residue remains in both systems | Recoverable demo data; documented in both audits | Before any production cutover |
| **A-05** | 22 French holidays were written to Pilotage's stale active year by an unconfirmed control | Recoverable; reversing needs explicit authorisation | Fixed as part of PF-15 / PF-29 |

## 3. Risk-to-gate mapping

| Gate | Risks it exists to control |
|---|---|
| G-TENANT | R-02, R-08, R-11 |
| G-AUTHZ | R-02, R-08 |
| G-MIGRATION | R-01, R-05, R-12 |
| G-AUDIT | R-10 |
| G-TRUTH | R-03, R-04, R-06, R-09 |
| G-PORTAL | R-04, R-14 |
| G-DNC | R-06, and the whole `DNC` register |

## 4. Review cadence

- **Every run:** the routine reads this file and refuses to select a story whose owning epic has an open `CRITICAL`
  risk with no mitigation in `status: mitigated|accepted`.
- **Every layer completion:** full re-score.
- **On any new P0 finding:** add a risk row in the same commit.
