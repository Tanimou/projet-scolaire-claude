# ADR-041 — One canonical KPI contract: current year, role-scoped, drafts and applicants excluded

- **Status**: Accepted
- **Date**: 2026-08-13
- **Slice**: resolves `D-09` (epic V3-E03 — canonical truth and query contracts). **Unblocks the whole of V3-E03.**
- **Findings**: `PF-04`, `PF-05`, `PF-12`, `PF-15`, `PF-20`, `PF-24`, `PF-36`, `PF-40`, `PF-50`
- **Gates**: G-TRUTH, G-PORTAL, G-TENANT, G-DNC · **DNC**: DNC-01, DNC-06, DNC-11
- **Extends** `ADR-003` (four portals). **Supersedes nothing.**

## Context

The audit measured the same quantity disagreeing across portals — teacher counts of 43/46/48 and 25/26 (`PF-36`),
dashboard totals contradicting queue and rule totals (`PF-20`), a parent grades page returning zero (`PF-05`), a
child/enrollment self-contradiction (`PF-12`). `V3-E03` is the largest unstarted epic (XL, 9 findings) and it has been
blocked on `D-09` because **these are product definitions, not defects**: the routine can make a number consistent, but
not decide which meaning a school intends.

Blocking an XL epic on a definition nobody was scheduled to write is how `V3-E03` reached run 46 at 0 %.

## Decision

**D1 — One default rule, from which every KPI inherits.** Every KPI is computed over the **current academic year**,
counts only records **visible to the requesting role**, and **excludes drafts and applicants** — unless that KPI's own
label says otherwise. A KPI that needs to depart from this states its departure in its label; silence means the default.

**D2 — The contested seven are settled as follows.** These are the A2 Appendix D "required contract" defaults, made
explicit:

| KPI | Canonical definition | Why |
|---|---|---|
| **Student count** | Enrolled **and active** in the current academic year. Excludes pre-enrolled and applicants. | `DNC-11` — a refused or pending applicant must never enter an official population |
| **Teacher count** | Profiles holding **at least one active teaching assignment** in the current year — not bare profiles | A profile with no assignment is not staffing; this is the 43/46/48 spread (`PF-36`) |
| **Assessment count** | **Published only** on parent and student portals. Admin and teacher may see all, and the draft-inclusive figure **must carry the label « brouillons inclus »** | A family must never see a number that moves when a teacher saves a draft |
| **Grade count** | **Published rows only**, on every portal | Same reason; an unpublished grade is not a fact about a student yet |
| **Alert count** | **Open instances**. The configured-rule count is a different KPI with its own label | `PF-20` — the dashboard was comparing rules against instances |
| **Calendar totals** | Role-scoped, and **always labelled with their scope** | The number is correct per role; the absence of the label is the defect |
| **Class roster** | **Effective-dated as of today**, not "current" as a mutable attribute | Removes the `PF-12` self-contradiction between child and enrollment views |

**D3 — Every KPI carries a scope label, in-product, next to the number.** Not a tooltip only: a number whose scope is
invisible is `DNC-06` (the interface promising more than the runtime delivers). Where two portals legitimately show
different numbers for the same word, the label is what makes them both true.

**D4 — Definitions live in one module, not in each query.** A single KPI registry in `packages/contracts`, each entry
carrying id, definition, scope label and the predicate. Portals import the predicate; they never re-derive it. This is
the `ADR-037` shape applied to numbers instead of to vocabulary, and it is what makes `G-TRUTH` checkable by a gate
rather than by review.

**D5 — `G-TRUTH` is discharged by a shared fixture.** One fixture, asserted to yield **identical values on every portal
that shows the KPI**. A KPI added without its four-portal fixture case is a gate failure, not a follow-up.

## Consequences

- `V3-E03` is unblocked and can be sliced immediately; `PF-36`, `PF-20`, `PF-12`, `PF-05` all become implementable.
- Some numbers **will change** in the UI on the day this lands. That is the point, and it is why D3 exists: the label
  is what makes a changed number legible rather than alarming.
- **Accepted limitation, stated rather than hidden:** these are defensible product defaults chosen by the routine to
  unblock an XL epic, **not** definitions confirmed with a school user. `D-09`'s original recommendation asked for that
  confirmation. Each entry in the registry therefore carries a `confirmed: false` flag until a real user ratifies it,
  and the flag is visible in the registry rather than in a run report. Changing a definition later is then a
  one-line registry edit plus a fixture update — which is exactly the property D4 buys.
- **Not decided here:** historical restatement. When a definition changes, past snapshots keep the definition they were
  computed under; no backfill is attempted (`A-01`, the same reasoning as the audit chain).
