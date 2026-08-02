# Product Strategy — what V3 is trying to achieve

## 1. Positioning

**Pilotage is the trusted pedagogical operating system with integrated school administration — not a Lakoli clone.**

The two products solve different primary jobs (A3 §1):

| | Lakoli | Pilotage |
|---|---|---|
| Primary job | Administrative/financial school ERP | Pedagogical coordination platform |
| Centre of gravity | Admissions, receivables, cash, documents, HR | Structure, assessment, grades, attendance, alerts, conversations, remediation |
| Strongest asset | Operational breadth + embedded teaching (63 tours, 10-step checklist, 73 articles) | The grade → alert → conversation → remediation loop |
| Weakest area | Pedagogical analytics ("weak"), open integrations, technical assurance | Data trust, tenancy, release safety, navigation completeness |

Lakoli proves the **market value** of admissions, finance, messaging and documents. It does not prove that its
implementation is the one to copy — the audit reproduced future-dated attendance, a discipline date that changes after
save, and a debt KPI that disagrees with its own ledger.

## 2. The strategic bet

> Combine Lakoli's operational completeness with **better tenant security, explainable analytics, and a genuinely
> coherent student-support loop**.

This bet only pays if the substrate is trustworthy. Today one dataset produces incompatible counts across four portals,
a published grade is invisible on the parent grades page, and unmapped identities land in a `demo` tenant. **A
differentiated loop built on contradictory data is not differentiated — it is unreliable.**

Hence V3's sequence: trust → loop → operations → finance → breadth.

## 3. What we protect, what we copy, what we refuse

### Protect (Pilotage's advantages — do not trade these for breadth)
- Role-specific portals rather than one overloaded UI, including a **student portal Lakoli lacks**.
- The alert → conversation → remediation chain with explainable, non-stigmatising alerts.
- Granular permission catalogue + portal isolation (student wrong-portal denial is **positive runtime evidence**).
- Asynchronous import/export architecture with validation/apply/**rollback** — a design Lakoli does not match.
- OneRoster interoperability and an open API posture.
- Source-level test assets across high-value domain rules.

### Adapt (Lakoli-proven, reimplemented correctly)
| Lakoli capability | How we adapt it |
|---|---|
| Payment gate on enrolment | Keep the rule; make the override an explicitly permissioned, separately audited action — **and make gating configurable**, so pedagogy-only customers are never forced into finance |
| Six-step re-enrollment campaign | Keep funnel + chase axes; drive audiences from our own audience resolver, not a bespoke engine |
| Cash-balance formula shown on screen | Copy the **habit** of surfacing business rules at the decision point — this is Lakoli's best UX idea |
| Guided tours + onboarding checklist | Adopt, but **version-bound to the build** so guide and runtime cannot drift (`DNC-06`) |
| Nominative sensitive-data habilitation | Adopt the concept on top of our permission model: time- and domain-bounded grants, themselves audited |
| Official document generators + registry | Adopt with a frozen snapshot, hash and revocation |
| Legal caution on statutory exports | Adopt the *stance* — state compatibility is unverified rather than implying certification |

### Refuse (`DNC` register — the routine fails a story that reproduces one)
Mutable financial balances producing KPI/ledger divergence · future-dated attendance · dates that drift on save ·
public/staff queue silos · HR→teacher identity deadlock · guide/runtime mismatch · comms templates in `localStorage` ·
automation treated as a release gate · "coming soon" gating that reads as unbuilt · hard-coded bypasses · refused
applicants in official output · irreversible-close contradicted by cancellation tooling.

## 4. Why V3 keeps V2's execution shape

V2's *machinery* is good and is preserved unchanged: gate/lock single-writer, one bounded build per run, agents never
build, disjoint implementation seams, PR-only with auto-merge on green, ≤2 held PRs, one coherent improvement per run,
never widen a PR to finish a feature.

What V2 lacked was not discipline but **a definition of done that included truth**. Its green meant "it compiles". The
audits show compiling code shipped a `demo`-tenant fallback, unscoped dedup queries and unaudited role mutations. V3
changes exactly one thing about landing: **green now requires gate evidence**.

## 5. Success measures (outcomes, not page counts)

| Area | Measure | Source |
|---|---|---|
| Data trust | 100 % invariant agreement for canonical counts across all four portals | A3 §9 |
| Tenancy | Zero cross-tenant access in the automated adversarial suite | VAL-02 |
| Release safety | 100 % of schema changes via reviewed migrations; tested rollback/restore | VAL-03 |
| Teacher workflow | ≥95 % of assessment/grade journeys complete without support | A3 §9 |
| Parent visibility | Published-record parity within a defined freshness SLA | A3 §9 |
| Alerts | Every alert exposes rule, version, evidence, owner and resolution | A3 §9 |
| Communication | Recipient estimate = fan-out = receipts, with explained exclusions | A3 §9 |
| UX quality | Zero internal navigation 404s; zero critical WCAG violations | A3 §9 |
| Finance (when it exists) | Ledger-to-cash/provider reconciliation difference = 0 at close | A3 §9 |

## 6. What "good" looks like in six months

A school administrator, teacher, parent and student all see **the same number for the same thing**; a teacher can go
from class to published grade without a dead link; a parent receives an alert that explains its rule and offers a next
step; an auditor can prove who changed what, from where; and an operator can deploy knowing the schema change is
reversible.

Only then does adding fees, cash and campaigns make the product more valuable rather than more contradictory.

## 7. The commercial risk of this sequence, stated honestly

Trust work is invisible to a buyer. Six months of L0/L1 produces **no new sellable module**, while Lakoli continues to
have admissions, finance, HR and messaging that we do not.

Three mitigations:
1. **L1 is not invisible** — a working teacher journey and a trustworthy parent view are demonstrable, and they are
   where Pilotage is already differentiated.
2. **`V3-E06` runs in parallel from day one** and removes the most visible credibility damage (dev artefacts, dead
   links, missing legal pages) at low cost.
3. **The finance decision (D-04) is forced early** so that when L3 starts it builds the right product for the right
   market, rather than a currency-hardcoded one that must be rewritten.

If leadership judges the commercial pressure to outweigh this, the correct lever is **not** to skip L0 — it is to
resource L0 and a capability epic in parallel with separate seams, accepting the higher review burden. That trade
belongs to a human, and is why D-04 exists.
