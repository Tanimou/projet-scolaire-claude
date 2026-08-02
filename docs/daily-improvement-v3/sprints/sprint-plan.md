# Sprint plan

**Cadence.** The routine ships **one vertical slice per run** (the V2 discipline that works). A "sprint" here is a
grouping of stories with a shared goal and exit criterion — not a time box the routine must respect. The routine's
selection rule is `roadmap.md` layer order + `dependency-map.md` eligibility; this file exists so a human can see the
shape and so `PROGRESS.md` files have something to reconcile against.

**Rule.** A sprint may not open while a previous sprint has an **unblocked** P0/P1 story still open.

---

## Sprint 01 — Release safety and hygiene · `V3-E02`, `V3-E06`

Stories: `stories/sprint-01.md` (S-E02-1..4, S-E06-1..4, S-E06-6).
**Why first:** the only L0 work with no upstream dependency, and the prerequisite for every schema change after it.
**Exit:** migration ledger established, CI gating, no dev artefacts, CSP on, zero internal 404s, bulk controls confirm.
**Escalations expected:** D-01 (restore window), D-08 (legal text).

## Sprint 02 — Identity boundary · `V3-E01`, `V3-E05` (roles slice)

Stories: `stories/sprint-02.md`.
- S-E01-1 explicit tenant resolution, `pending` state, remove `demo` fallback
- S-E01-2 RLS policies + real `withTenant` call sites + parameterised GUC
- S-E01-3 two-tenant adversarial suite in CI (VAL-02)
- S-E01-4 student Keycloak client split (**blocked on D-02**)
- S-E05-1 tenant-key `Role` and every role query (closes the cross-tenant role hole)

**Exit:** an unmapped identity reaches no data; `pg_policies` non-empty; a tenant-A admin gets identical safe denials
for every tenant-B id; adversarial suite fails-before/passes-after and runs on every PR.
**Risk gate:** R-01 must be `mitigated` (i.e. S-E02-3 done) before S-E01-2 touches data.

## Sprint 03 — Authorisation integrity · `V3-E05` (remainder)

S-E05-2 grant-subset · S-E05-3 foreign-tenant bulk writes · S-E05-4 tenant-scoped dedup · S-E05-5 attendance ABAC ·
S-E05-6 validation on unvalidated paths · S-E05-7 registration rate-limit/verify · S-E05-8 auth error semantics ·
S-E05-9 session lifecycle · S-E05-10 client gating / `users.suspend` · S-E05-11 atomic invite + catalogue reconciliation.

**Exit:** every row of the A2 Appendix E threat table has a negative test.
**Note:** ships as several disjoint slices so each is independently revertible.

## Sprint 04 — Accountability · `V3-E04`

S-E04-1 audit page crash + reports route · S-E04-2 audit rows in-transaction for every privileged mutation, real actor
role, IP/UA, hash chain from genesis · S-E04-3 date filter + KPI correctness.
**Exit:** a rollback test proves mutation and audit row live or die together; chain verifies.
**Accepted gap:** pre-V3 history cannot be backfilled (A-01) — documented, never fabricated.

## Sprint 05–07 — Canonical truth · `V3-E03`

The largest epic; expect several sprints. Sequence:
1. **05a** Definitions (D-09) + reconciliation console + KPI scope/freshness envelope.
2. **05b** Canonical projections: enrollment, guardian↔child link, class roster.
3. **06a** Published assessment/grade projection → **closes PF-05** (the parent-grades-zero defect).
4. **06b** Academic-year context + stale-year flagging; alert instance and announcement audience projections.
5. **07a** Snapshot drain (PF-24) — implement the consumer or remove the claim.
6. **07b** Pagination/fan-out hotspots (PF-50); async loading states (PF-40).

**Exit (gate G2):** a fixed fixture yields identical values on all four portals for every shared metric.

## Sprint 08 — Teacher journey · `V3-E07`, `V3-E08` (start)

S-E07-1 typed identifiers + gradebook routes · S-E08-1 field round-trip (DOB) · S-E08-2 lesson edit · S-E08-3 lesson
defaults Draft.
**Exit:** dashboard → gradebook → create assessment → batch grade → publish completes end to end.

## Sprint 09 — Pedagogical integrity · `V3-E08` (finish), `V3-E09`

S-E08-4 lesson visa · S-E08-5 batch grades set-based + revision accuracy · S-E08-6 calendar scope/year · S-E08-7 remove
fabricated metrics · S-E09-1 attendance atomicity · S-E09-2 scope/history labelling and trend validity.
**Exit (gate G3, part 1):** no silent partial write anywhere in the pedagogy domain.

## Sprint 10 — Intervention loop · `V3-E10`, `V3-E11`

S-E10-1..4 alert provenance, bounds parity, exact totals, remediation authority (D-10), honest labels ·
S-E11-1..3 audience resolver, class messaging, reachable moderation.
**Exit (gate G3 complete + G4):** preview = fan-out = receipts; every alert carries rule, version and evidence.

## Sprint 11+ — Layers 2–4

Not scheduled in detail. `V3-E12` opens only when L1 is closed; `V3-E15` opens only when **D-04** is resolved;
`V3-E16` opens only when **D-03** is resolved and sandbox credentials exist; `V3-E18` stories may not be written at all
until their individual promotion criteria are met.

---

## Sequencing summary

| Sprint | Epics | Gate reached | Blocking decisions |
|---|---|---|---|
| 01 | E02, E06 | G1 (partial) | D-01, D-08 |
| 02 | E01, E05 (roles) | G0 (partial) | D-02 |
| 03 | E05 | **G0** | — |
| 04 | E04 | **G5** | — |
| 05–07 | E03 | **G2** | D-09 |
| 08 | E07, E08 | — | — |
| 09 | E08, E09 | G3 (part) | — |
| 10 | E10, E11 | **G3**, **G4** | D-10 |
| 11+ | E12 … E18 | G6, G7 | D-03, D-04, D-06, D-07 |

Gates are defined in `03_Comparative_Gap_Analysis.md` Appendix D and enforced by the routine per
`routine/daily-improvement-v3.md` §5.

## Capacity note

Story sizes (S/M/L) are relative effort for **one autonomous run**, not hours. An `L` story that cannot land in one run
must be split before it is selected — the routine never widens a PR to finish a feature (inherited V2 rule).
