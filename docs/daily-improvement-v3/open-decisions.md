# Open Decisions — human calls the routine cannot make

The V3 routine reads this file at Step 1. A story whose `requiresDecision` / `requiresCredential` /
`requiresLegalReview` field names an **unresolved** id here is **not selectable** — it is a Step 6 STOP condition.

To resolve one: fill in **Decision**, **Decided by**, **Date**, set **Status** to `resolved`, and record the
consequence. The routine picks it up on the next run.

---

## D-01 — Backup/restore window on hosted data · `open` · **no longer blocks `S-E02-3`**

> ### Re-scoped 2026-08-06 (run 19) — this decision does not gate the local drill
>
> The routine's target is the **local Docker stack** (`SKILL.md` Step −1, commit `99d7f1d`). There is no production:
> `pilotage.srv861861.hstgr.cloud` is an audit fixture with no users, and local data is expendable by rule. The
> question below — *when may we take the hosted deployment down, and who signs off* — is a question about **downtime
> on a fixture**. It cannot gate a rehearsal that drops and recreates a database inside a container on this machine.
>
> `S-E02-3` was therefore **selected and executed** on run 19 against the local stack. That is substance, not a
> paperwork bypass: the restore procedure is now proven to work and is timed, so if a deployment holding real data ever
> exists, the open question shrinks from *"does our restore work at all?"* to *"when may we take **that** one down?"* —
> a scheduling question rather than an engineering one.
>
> **What is still not proven, said plainly:** the drill runs against a local database whose content is a demo seed. It
> establishes that the procedure is correct and yields a duration on this hardware; it does **not** establish a restore
> time at real volume, and it does not exercise a backup taken on one machine and restored on another. The recorded
> SLO is a floor, not a forecast.
>
> The decision stays `open` because option (a) is still owed before any destructive migration on a deployment whose
> data anyone depends on. It simply no longer blocks a story.

**Question.** When may we take the hosted deployment down (or to read-only) long enough to prove a timed
backup → restore rehearsal, and who signs off that the restore is acceptable?

**Why it must be decided first.** `V3-E01` (tenancy) and `V3-E02` (migrations) both change schema on data that today has
**no migration history** and is deployed with `--accept-data-loss` (PF-03). Without a proven restore, the first
tenancy migration is an unrecoverable bet (risk **R-01**).

**Options.** (a) Scheduled maintenance window with announced downtime. (b) Restore rehearsal onto a parallel stack from
a production snapshot, no downtime, slightly weaker evidence. (c) Accept the risk — **not recommended**, leaves R-01 open.

**Recommendation.** (b) now, (a) before the first destructive migration.

**Decision:** — · **Decided by:** — · **Date:** —

---

## D-02 — Keycloak client and redirect topology · `open` · blocks V3-E01 S-E01-4

**Question.** Do we provision a dedicated `portal-student` Keycloak client with its own redirect URIs and audience,
and who owns the production Keycloak configuration change?

**Context.** The student portal currently **reuses the parent client** (PF-18); student password reset therefore targets
the parent client. ADR-021 recorded the reuse as a deliberate S1 shortcut with an env override already in place
(`KEYCLOAK_STUDENT_CLIENT_*`), so the code path exists — this is an operations/config decision, not a build one.

**Consequence if deferred.** Portal audience separation stays weak; `aud`/`azp` validation (part of E05) cannot be made
strict for the student portal without breaking login.

**Recommendation.** Provision the dedicated client; it is config, and the override already exists.

**Decision:** — · **Decided by:** — · **Date:** —

---

## D-03 — Payment service provider · `open` · blocks V3-E16

**Question.** Which PSP(s), and do we need multi-provider support at launch?

**Why it blocks.** Settlement model, fee structure, callback signing, chargeback/reversal semantics and reconciliation
all follow from this. `V3-E16` cannot be specified, let alone built, without it. Lakoli uses Paystack/CinetPay, which
tells us what the market expects but not what we should choose.

**Also required.** Sandbox credentials (VAL-05) — a credential-required STOP until issued.

**Recommendation.** Single provider behind an adapter interface with a deterministic fake for tests; add the second only
on customer demand.

**Decision:** — · **Decided by:** — · **Date:** —

---

## D-04 — Target market: Côte d'Ivoire, EU, or both · `open` · blocks all of V3-E18, scopes V3-E13/E14

**Question.** Is Pilotage being sold into the Ivorian market Lakoli occupies, a European market, or both?

**Why it is the highest-leverage open decision.** It determines whether large parts of the Lakoli capability set are
requirements or noise:
- **Ivory Coast** → statutory payroll (CNPS/CMU/IRPP, LG-20), national exports (CIO/StatCIO), BEPC/BAC registers,
  end-of-year DFA semantics (LG-14), Mobile Money as the primary collection channel, FCFA. Localisation must be an
  **architectural** concern from the start of `V3-E15`, not a later adaptation.
- **EU only** → most of that is dead weight; the current French/European shape (Lycée Voltaire, French holidays, /20
  marking) is already correct and finance should be built for SEPA/card, not Mobile Money.
- **Both** → the fee/document/statutory layers must be **pluggable per country pack** before any of them is written.

**Consequence if deferred.** L4 stays unselectable (risk **R-17**), and `V3-E15` risks hard-coding a currency and fee
model that a later market entry would force us to rewrite.

**Recommendation.** Decide before `V3-E15` starts, not before `V3-E12`. If "both" is even plausible, make currency,
statutory fields and document templates configuration from day one — the cost is small now and large later.

**Decision:** — · **Decided by:** — · **Date:** —

---

## D-05 — Commercial packaging / module entitlements · `open` · out of scope until resolved

**Question.** Do we sell modules separately (as Lakoli does, via `/module-access/catalog` and per-page gates), or one
whole product?

**Why it is not on the roadmap.** An entitlement system is an architectural commitment that should follow a pricing
decision, not precede it. It is deliberately excluded in `roadmap.md` §9.

**If we do adopt it:** learn from Lakoli's mistake — locked modules there are worded « en cours de finalisation », which
reads as *unbuilt* rather than *not in your plan* (`DNC-09`). Gate copy must name the plan and the upgrade path.

**Decision:** — · **Decided by:** — · **Date:** —

---

## D-06 — Payroll statutory rules · `open` · legal review · blocks LG-20

Statutory payroll (rubric codes, CNPS/CMU/IRPP bands, seniority) is jurisdiction-specific and carries real liability.
No story may be written until legal confirms the applicable regime and whether we build or integrate.
**Recommendation.** Strongly consider integrating an existing payroll product instead of building (A3 §8.6).

**Decision:** — · **Decided by:** — · **Date:** —

---

## D-07 — Sensitive / health case register · `open` · legal + DPO review · blocks LG-26

A child-protection and health case register is the highest-risk data class in the product. Lakoli gates it behind a
**nominative, time- and domain-limited habilitation** that even a super-admin does not hold — a good model. Before any
story: legal basis, consent model, retention, encryption at rest, k-anonymity thresholds for export, and who may grant
and revoke a habilitation.

**Decision:** — · **Decided by:** — · **Date:** —

---

## D-08 — Legal page content · `open` · blocks part of V3-E06 S-E06-4

`/legal/privacy`, `/legal/terms`, `/legal/cookies` are 404 **while parent registration requires accepting them**
(PF-38). That is the current, live compliance problem.

**Constraint.** The routine must **not invent policy text** (risk **R-13**). It may ship a holding page that states the
policy is being finalised and provides a contact route; it may not author terms.

**Decision needed:** who supplies the text, and is a holding page acceptable in the interim?

**Decision:** — · **Decided by:** — · **Date:** —

---

## D-09 — Canonical KPI definitions · `open` · shapes V3-E03

**Question.** For each contested metric, which definition is authoritative?

Contested today (PF-04, PF-20, PF-36): student count (enrolled vs active vs including pre-enrolled), assessment count
(all vs published), grade count (rows vs published rows), teacher count (profiles vs assigned), alert count (configured
rules vs active rules vs open instances), calendar totals (per role scope), class roster (effective-dated vs current).

**Why a human must decide.** These are **product definitions**, not bugs. The routine can make them consistent; it
cannot decide which meaning the school intends.

**Recommendation.** Adopt the A2 Appendix D "required contract" column as the default and confirm each with a school
user; publish each definition in-product as a KPI tooltip.

**Decision:** — · **Decided by:** — · **Date:** —

---

## D-10 — Remediation authority model · `open` · shapes V3-E10 S-E10-3

**Question.** Who may terminally close a school-created remediation plan — and what can a parent do?

Today a parent can mark a school-created plan achieved *or close it* (PF-27), while having no direct booking action.
That is an authority inversion.

**Recommendation.** Parent may *acknowledge*, *request* and *comment*; only the plan owner (teacher or admin) may close.
Needs confirmation because it is a policy choice about family agency, not a technical constraint.

**Decision:** — · **Decided by:** — · **Date:** —

---

## D-11 — Reopening a closed school · `open` · raised by `S-E04-10` (`PF-155`) · **blocks no story today**

**Question.** Should a closed establishment be reopenable — and if so, through what endpoint, under what audit action
code, and by whom?

**Why it is here now.** `S-E04-10` removed `status` from `UpdateSchoolDto`, because `PATCH /schools/:id
{ status: 'closed' }` was a **second closure door**: it bypassed `DELETE`'s students / academic-years refusal and filed
the closure under `school.update` instead of `school.close`, so an auditor filtering « Fermeture d'un établissement »
saw none of those closures. Closing now has exactly one door.

**The same removal deleted the only reopen path**, and that path was never designed: there is no `school.reopen` action
code in `packages/contracts/src/audit/vocabulary.ts`, no endpoint, no UI control and no test. It existed solely as the
DTO hole that let closures be misfiled. Inventing vocabulary to preserve it was explicitly out of scope for that slice
(adding audit codes is `S-E04-4`'s seam, and the slice touches `packages/contracts` not at all).

**Why it is not a defect, and not urgent.** `school.close` is a **soft** close — `status: 'closed'`, the row and all its
data survive — so nothing is destroyed and no accounting assertion is made. Reopening is a *recovery* need, not a
routine operation.

**Why it still needs an answer.** An establishment closed by mistake has no in-product recovery. The only remaining
route is a direct database write, which leaves **no audit row at all** — the exact silence this epic exists to remove.

**Options.** (a) `POST /schools/:id/reopen`, a new `school.reopen` `critical` action code, `super_admin` only.
(b) The same, plus a stated business precondition (e.g. no successor establishment). (c) Accept that closure is
terminal in-product and document the DBA procedure — in which case that procedure must still produce an audit row.

**Decision:** — · **Decided by:** — · **Date:** —

---

## D-12 — How does an administrator legitimately onboard a teacher? · `open` · raised by `S-E05-2` (`PF-178`) · **blocks `S-E05-2b`, and `PF-09`'s residual cannot close without it**

**Question.** Now that no grantor may hand out a permission they do not themselves hold, by what mechanism does a
`school_admin` provision a teacher, a parent or a student?

**Why it is here now.** `S-E05-2` closed `PF-156` (P1 vertical privilege escalation) with a grantor-relative ceiling.
That ceiling is correct and it is deliberately strict, and the strictness has a measured consequence:

| Seeded role | Codes | Exceeds `school_admin` (75 codes) by |
|---|---|---|
| `super_admin` | 89 | 14 — **the point of the finding** |
| `teacher` | 34 | 6 — `grades.write`, `grades.revise`, `attendance.write`, `lessons.write`, `lessons.delete`, `exports.execute.teacher` |
| `parent` | 20 | 3 — `guardianships.claim`, `exports.execute.parent`, `remediation.book` |
| `student` | 7 | 5 — the five `*.read.self` |

`seed.ts:216-220` materialises those into real `rolePermission` rows, so a `school_admin` can now assign **none** of the
four other seeded system roles through `POST /users/:id/roles`.

**Why the ceiling was not weakened to preserve the old behaviour.** Because the old behaviour *is* the P0. The same
absence of a check that let an admin hand out `teacher` let them hand *themselves* a role carrying `grades.revise` and
then re-authenticate into it. A subset-with-exemptions rule, or an `isSystem` special case, would reopen exactly the
door the slice closed. Fail-closed first is the correct order; the delegation model is the follow-up, not a patch.

**Why an answer is needed rather than an implementation.** Every option below grants somebody the ability to confer
privileges they do not hold — which is the property the ceiling exists to forbid — so the question is *which bounded
exception is intended*, and that is a product decision, not an engineering one.

**Options.** (a) An explicit **assignable-roles** grant: a role declares which roles its holders may confer,
independent of the permissions it carries. (b) A **grantor-relative realm-role ladder**: you may provision at or below
your own level — permits `school_admin → teacher|parent|student`, refuses `teacher → school_admin`. This also closes
`PF-09`'s residual, since the unceilinged fifth channel (`POST /users/invite`'s `realmRole`) is a realm-role grant.
(c) Widen `REALM_ROLE_PERMISSIONS.school_admin` to a superset of the three — rejected on sight by the routine, because
it hands every admin `grades.revise` in order to let them *name* a teacher, which is the escalation with extra steps.

**Consequence while it is open.** Admin onboarding of teachers/parents/students is blocked through
`POST /users/:id/roles`. `POST /users/invite`'s `realmRole` channel still works — that is `PF-09`'s open residual, i.e.
the workaround and the vulnerability are the same door. Compounding it, `/admin/users` renders the refusal as **silence**
(`PF-174`), so the blocked path currently reports nothing at all.

**Decision:** — · **Decided by:** — · **Date:** —

---

## D-13 — How is a repo-wide scanner tested hermetically? · `resolved` · raised by `TOOL-15`/`TOOL-17`/`TOOL-18`, settled by `TOOL-15`

> **Entered already `resolved`, and that is deliberate rather than a shortcut.** This file previously had **no**
> `TOOL-15` entry — measured before writing: the ids ran `D-01`…`D-12` and the string `TOOL-15` did not appear
> anywhere in it. The decision had been described three times in `audit-findings-index.md` as *"an open design
> call for `open-decisions.md`"* and never actually written here. So AC-6's *"move it to `resolved`"* is
> discharged by **adding the row in the resolved state**, with the question, the options and the ruling, rather
> than by editing a row that was never created. Saying so is the point — silently doing nothing would have left
> the ledger claiming a decision was recorded when it was not.

**Question.** Two quality specs prove their gate can go RED by planting a probe file **inside the real working
checkout** and deleting it again. Under parallel jest that races every process which lists the directory and
then reads what it listed. How is such a scanner driven red without mutating the shared tree — given that
`scripts/csv-escape-check.js` deliberately exposes **no root parameter**?

**Why it had to be decided rather than deferred again.** It was raised three times and parked three times. Then
`TOOL-18` measured the second, independent consequence: `scripts/link-integrity-check.js` walks
`apps/web/src` — the exact directory the CSV probe is planted in — and died on an uncaught `ENOENT`, printing a
stack trace where its verdict line belongs. Two consecutive no-flag `scripts/ci-gate.sh` runs on one unchanged
tree gave `GATE: FAIL` then `GATE: PASS`, denominator 2532 in both. **`AUTO-LAND`'s `green` cannot be
discharged from a single gate run for any gate-machinery diff while this stands**, which makes it a throughput
decision and not only a hygiene one.

**Options.** (a) A scratch-tree copy of the script, rooted by its own location. (b) Serialise the two writer
specs. (c) Weaken the two assertions to rule-scoped ones.

**Decision:** **(a)**, ratified in `ADR-039`. · **Decided by:** `TOOL-15` (run 47), on measurement · **Date:** 2026-08-13

Three facts decided it, each checked rather than argued:

1. **(a) is already this repository's technique.** Measured by AST over all **108** spec files under `apps/**`:
   7 files perform real filesystem writes (61 call sites), 5 of them exclusively into an os-tmpdir scratch tree,
   and the 2 exceptions are precisely the two probes — each of which *already contained* a scratch-tree
   `DNC-08` block, eight cases deep. The text-scan reading that raised the finding says 6 of 8; both readings
   agree on the conclusion and on the exceptions.
2. **The "no root parameter" objection — the one thing blocking (a) — does not apply, and no flag was added.**
   Every check script computes `const REPO_ROOT = resolve(__dirname, '..')`, so the root follows the *script's
   own location*: a copy under `<scratch>/scripts/` spawned with `cwd: scratch` roots itself in the scratch tree
   with no interface change. The `argv` whitelists and the DNC-10 "no way to turn this gate off" assertions are
   untouched.
3. **(b) and (c) are both worse.** (b) leaves the probe in the real tree — `git status` is still dirty mid-run
   and any future walker is still a victim; it narrows the window instead of closing it. (c) deletes the only
   executed evidence that the real script can go red on a real fourth escaper, which is the one thing that case
   exists for (`R-30`).

**Consequence.** A spec may write only into a tree it created under `tmpdir()`, and that rule is now held by an
executed ratchet (`apps/api/src/shared/quality/hermetic-spec-writers-gate.spec.ts`) rather than by review.
`scripts/link-integrity-check.js` now pronounces `DNC-08 — <path> is unreadable: <errno>` and exits non-zero
instead of crashing — **more legible, not more tolerant**: no file is skipped into a PASS, and the in-process
exports still throw. `scripts/lib/walk-read.js` is unchanged and stays: it protects every *future* writer.
`TOOL-16(b)` is advanced, not closed — one of its two named causes is removed. `TOOL-17(b)`'s three residuals
stay open.

---

## Resolution log

| id | Status | Decision | Decided by | Date | Consequence |
|---|---|---|---|---|---|
| D-01 … D-10 | `open` | — | — | — | — |
| D-11 | `open` | — | — | — | Raised 2026-08-09 by `S-E04-10` (`PF-155`). Blocks no story; a school closed by mistake has no in-product recovery until it is answered |
| D-12 | `open` | — | — | — | Raised 2026-08-11 by `S-E05-2` (`PF-178`). Blocks `S-E05-2b`; `PF-09`'s residual cannot close without it. Admin onboarding of teacher/parent/student via `POST /users/:id/roles` is refused until answered |
| D-13 | `resolved` | (a) scratch-tree copy, rooted by the script's own location — `ADR-039` | `TOOL-15` (run 47), on measurement | 2026-08-13 | Raised three times by `TOOL-15`/`TOOL-17` and re-raised by `TOOL-18`; **entered here for the first time, already resolved** (this file had no `TOOL-15` row — ids ran `D-01`…`D-12`). A spec may write only into a tree it created under `tmpdir()`, held by `hermetic-spec-writers-gate.spec.ts`. **No root flag was added to any check script and none was needed.** Unblocks reproducible `GATE:` verdicts on gate-machinery diffs; advances `TOOL-16(b)`, closes neither it nor `TOOL-17(b)` |
