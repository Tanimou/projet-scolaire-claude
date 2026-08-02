# Risk Register

Reviewed by the V3 routine at Step 1 and updated at Step 6. A `HIGH` risk with no accepted mitigation **blocks its
owning layer** from being declared complete (`roadmap.md` §10).

**Scoring:** Likelihood × Impact, each Low/Medium/High. Severity is the worse of the two, escalated one level when the
risk concerns children's data or money.

---

## 1. Open risks

| ID | Risk | L | I | Sev | Owning epic | Mitigation | Status |
|---|---|---|---|---|---|---|---|
| **R-01** | **A tenancy fix migrates hosted data incorrectly and is unrecoverable**, because there is no migration history and prod runs `db push --accept-data-loss` | M | H | **CRITICAL** | V3-E02 → V3-E01 | Sequence E02 before E01; require a timed restore rehearsal (VAL-03) before any tenancy migration; expand/contract only; no destructive column drops in the same release | open |
| **R-02** | **Cross-tenant data exposure persists undetected** because the fix is applied at the application layer only and a later query forgets the predicate | M | H | **CRITICAL** | V3-E01 | Database-enforced RLS *plus* application predicate; two-tenant adversarial suite (VAL-02) runs in CI on every PR, not once | open |
| **R-03** | **Canonicalising queries changes numbers users already rely on**, and the change is read as a new bug | H | M | **HIGH** | V3-E03 | Publish a KPI definition per metric with scope + freshness; ship a reconciliation console showing old vs new; announce before switching | open |
| **R-04** | **The routine marks a feature complete because its UI renders**, repeating the audit's central error | M | H | **HIGH** | routine | G-TRUTH + G-PORTAL gates; A2 Appendix A classification required in every PR; `OP` demands execution *and* read-back | mitigated by design |
| **R-05** | **Hosted images and schema drift from `main` again**, so V3 fixes are audited but not running | H | M | **HIGH** | V3-E02 | Immutable build/schema manifest per release; VAL-10 records running SHA + schema version; deploy gate compares them | open |
| **R-06** | **Finance is built on mutable balances** and reproduces Lakoli's KPI/ledger divergence (DNC-01) | M | H | **HIGH** | V3-E15 | Immutable ledger entries only; every dashboard total derived with drill-down; reconciliation test with partial/over/duplicate/reversed cases | open |
| **R-07** | **A gate is weakened to let a story land** when evidence is hard to produce | M | H | **HIGH** | routine | Step 6 STOP condition #5 makes gate-weakening a stop, not a judgement call; deferred evidence must name a tracking finding id | mitigated by design |
| **R-08** | **Parent/child linkage repair changes who can see a child**, causing either lost access or wrongful access | M | H | **HIGH** | V3-E03 | Effective-dated link model with explicit historical states; ABAC tests for both directions; no silent widening | open |
| **R-09** | **Attendance atomicity fix invalidates existing rates**, and historical reports change retroactively | M | M | MEDIUM | V3-E09 | Recompute is explicit and versioned; label affected periods; do not silently rewrite published artefacts | open |
| **R-10** | **Audit backfill is impossible** for historical rows (no IP/UA/hash ever written), leaving a permanent gap | H | M | MEDIUM | V3-E04 | Do not fabricate history; start the chain at a declared genesis row and document the pre-V3 gap explicitly | open |
| **R-11** | **RLS degrades query performance** on large tenants once enabled | M | M | MEDIUM | V3-E01 | Benchmark before/after on the largest seeded tenant; index tenant predicates; treat as a release criterion not an afterthought |
| **R-12** | **Removing the demo seed breaks the hosted demo** that stakeholders use | H | L | MEDIUM | V3-E02/E06 | Keep an explicit, opt-in, clearly-labelled demo tenant provisioned by a separate command — never by production startup | open |
| **R-13** | **Legal pages are published without legal review**, creating a worse liability than the current 404 | M | M | MEDIUM | V3-E06 | Ship a holding page that states the policy is being finalised and gives a contact route; do not invent policy text (D-08) | open |
| **R-14** | **The four-portal check becomes a checkbox** rather than a real verification | M | M | MEDIUM | routine | G-PORTAL requires naming what was observed per portal, not asserting "4/4" | mitigated by design |
| **R-15** | **Scope silently expands** as capability epics discover foundation defects | H | M | MEDIUM | routine | dependency-map §5: no back-edges into L0; discovered defects become new finding ids scheduled at their own layer | mitigated by design |
| **R-16** | **V2 and V3 run on the same tick** and contend for the checkout | M | H | **HIGH** | routine | V3's lock wrapper delegates to V2's script, so both share one `write.lock`; additionally, operator must disable the V2 schedule before enabling V3 | mitigated by design |
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
