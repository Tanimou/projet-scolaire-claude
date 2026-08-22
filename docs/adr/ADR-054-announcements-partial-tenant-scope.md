# ADR-054 — A handler enters the tenant scope only if EVERY statement it provokes is lexically inside the callback; a collaborator that closes over its own `PrismaService` is EXCLUDED, never threaded a `tx`

- **Status**: `accepted` — the partition criterion, the refusal to thread a `tx` into `AnnouncementRecipientsService`,
  the global blast radius of the boot-probe closure, and the cascade ruling on `remove` are decided. What this ADR
  does **not** decide: converting the remaining four handlers of `announcements` (`list`, `getOne`,
  `previewRecipients`, `remove`), converting `announcements.service.ts` (`PF-235`), converting `NotificationsService`
  (`PF-218`), any repair of rows already written (`PF-230`), and the global `DATABASE_URL` cutover (`S-E01-1`).
- **Date**: 2026-08-16
- **Story**: `S-E01-1g` (epic `V3-E01`), **closing `PF-232`**, advancing **`PF-02` half (a)** from `24` to `36`
  attributed call sites, recording `PF-235` and `PF-236`.
- **Relates to**: `ADR-002` (multi-tenancy) · `ADR-032 §D5–§D8` (the application connects as the table **owner** and
  escapes its own policies) · `ADR-042 §D1` (the explicit `AND tenant_id = …` is kept even when redundant) and
  **`§D5`** (the derived tables' privilege set is **closed**, with no `DELETE`) · `ADR-048 §D3` (the statement budget
  of an interactive transaction), **`§D5`** (the three connection states, `refused_unusable` **refuses** rather than
  falls back) and **`§D6`** (`ENUMERATED_OUTSIDE_SCOPE` is a list of **structural reasons**, not of pending work) ·
  `ADR-049` / **`ADR-053 §D1`** (the scope-FK ownership probes this module already carries) · `ADR-051 §D1`
  (`SCOPE_SAFE_RECEIVERS`, and `classifyCallSite`'s four outcomes).
- **Number**: `054`. Allocated against `main` plus every open pull request (`TOOL-30` anti-recurrence): `053` is the
  highest on `main`, and no open PR claims an ADR.
- **Supersedes**: nothing, and it amends nothing in place. It **discharges the first half of `ADR-053 §D6`**'s
  *"`announcements` is NOT converted to `withTenant`"* — partially, by exactly five handlers, which is why §D5 below
  is mandatory rather than decorative.

---

## Context — why this is an ADR and not a third code comment

Two modules before this one refused to call a collaborator from inside a tenant-scope callback, each recording the
refusal **locally**, in the handler it inconvenienced:

| Occurrence | Where | Collaborator | Recorded as |
|---|---|---|---|
| 1 | `calendar.controller.ts:464` | `CalendarSeedService` — opens its **own** `$transaction` (it would not even compile inside a `Prisma.TransactionClient`) | `PF-198`, `ADR-048 §D6` |
| 2 | `lessons.controller.ts:166` | `NotificationsService` — closes over its own `PrismaService`, no `tx` entry point | `PF-218`, `ADR-051` |
| 3 | **here** | `AnnouncementRecipientsService` (`announcements.service.ts:52`) — closes over its own `PrismaService`; a `tx` parameter **would** compile | this ADR |

A rule stated three times in three files, each time as *"why this one handler is awkward"*, is no longer a local
comment: it is the criterion that **produces the partition** of every module still to be converted. `GUARDRAILS §2`
makes exactly that a blocking finding unless it lands with an ADR. This is that ADR, and the controller's own header
(`announcements.controller.ts:162-186`) says so in the source rather than only here.

**What landed, measured, not asserted.** Five whole handlers — `unreadCount`, `create`, `update`, `publish`,
`markRead` — run inside `this.scope.run(tenantId, async (tx) => …)`, twelve call sites rebound from `this.prisma.X`
to `tx.X`. Four handlers and two private methods stay on the owner connection, each carrying a docblock that names
its **mechanism**. `node scripts/tenant-adversarial-check.js` moves from

```
BEFORE  24 scoped + 120 enumerated / 816     (verb-aware: 165 satisfied, 2 not)
AFTER   36 scoped + 120 enumerated / 816     (verb-aware: 165 satisfied, 2 not)
```

`+12` is exactly the number of sites converted — no `owner-inside-scope` residue — `enumerated` is unmoved at `120`
(nothing was laundered into the allow-list), the denominator is unmoved at `816` (no call site added or removed), and
the two unsatisfied verb-aware pairs are the pre-existing `tenant/INSERT` and `tenant/UPDATE` of
`identity/register.controller.ts:365`.

---

## Decision

### D1 — the partition criterion: a handler converts only if EVERY statement it provokes is LEXICALLY inside the callback

> This is the section `announcements.controller.ts:185` and `announcements.service.ts:53` cite.

A handler may be wrapped in `this.scope.run(...)` **only when every statement its execution causes is written inside
the callback body**. Anything reached through an injected collaborator that holds its own `PrismaService` breaks the
criterion on the **dangerous** side, and the danger is not stylistic:

1. **It runs on the OWNER connection while the application connection holds an interactive transaction open.** Two
   connections are retained per request against a documented `connection_limit=5`, and the statements that escaped
   are precisely the ones a reader will believe were protected.
2. **The `Prisma.TransactionClient` typing cannot see it.** The type binds the callback **body**, never its callees;
   a service method call type-checks perfectly.
3. **The counter cannot see it either — and it can be made to lie in the favourable direction.**
   `classifyCallSite` (`scripts/tenant-adversarial-check.js:1898-1901`) is **lexical** and does not follow `this`
   (`PF-200`). Its four outcomes are `scoped` / `owner-inside-scope` / `enumerated` / `uncovered`, and
   `SCOPE_SAFE_RECEIVERS = ['tx']`.

The criterion has two corollaries, both load-bearing and both exercised by this diff:

- **The unit of work is the HANDLER, never the statement.** A `this.prisma.*` statement whose byte offset falls
  inside a scope callback classifies as `owner-inside-scope` — counted **uncovered** and **named** — so a
  half-converted handler moves the readiness counter the **wrong way while looking converted** (`PF-217`,
  `ADR-051 §D1`). `getOne` is the live instance here: its auto-mark-as-read `update` hides inside the non-admin
  early-return branch, so its five sites convert together or not at all. They did not convert.
- **A probe loop stays written IN LINE inside each callback.** A dispatch that *returns a delegate* the in-line loop
  then calls is acceptable; a resolver that *performs the query* on the caller's behalf attributes the site to the
  resolver's location, not the handler's (`ADR-053 §D2`, `PF-200`).

**What the criterion does NOT license.** It is a rule for deciding *which handlers convert*, never a licence to
**split a transaction** so that a scope fits. `calendar.controller.ts:464` already refused that trade and
`ADR-035`'s half that still binds here says the same: a scope that needs two transactions to exist is an exclusion,
not a design. (`G-AUDIT` is **measured not triggered** for this module — `grep -c audit` returns `0` across
`announcements.controller.ts`, `announcements.service.ts` and `announcements.module.ts` — so `ADR-035` is vacuous
here in its other half and may not be cited to justify a split.)

**Excluded by this criterion in `announcements`, each with its mechanism written at its own definition site:**

| Not converted | Mechanism |
|---|---|
| `previewRecipients` (`:325-457`) | the excluded collaborator sits **in the middle** of the handler — five probes before `computeRecipients`, the profile lookup after. All three repairs are refused: convert-all is false coverage, convert-half is `owner-inside-scope`, split-in-two is two snapshots on a **reporting** path |
| `publishInternal` (`:803-837`) | `AnnouncementRecipientsService` **and** `NotificationsService` (`PF-218`), plus the three reasons `S-E01-1f §3` already ruled on: notifying **before commit**, `O(guardians)` statements inside a 5 s budget, and a silent issue on the owner connection |
| `list` (`:180-273`) | **`G-TRUTH`** — `_count: { select: { recipients: true } }` counts **raw** `announcement_receipt` rows, including the dark cross-tenant rows `PF-230` owns, while `getOne` resolves receipts against an already tenant-filtered profile lookup (`:559`). The two numbers legitimately **diverge** today; moving this `_count` under the FK-derived policy would silently reconcile a real divergence and change a number rendered on `/admin/announcements` with no `apps/web` line changed. Plus: the admin branch has **no `take`** at all |
| `getOne` (`:461-612`) | the same `G-TRUTH` argument on `stats.total` / `readRate` / `recipients[]`, plus a budget one: up to 500 receipts then a `userProfile.findMany` over up to 500 ids with a nested `userRoles.role` include, inside a 5 s interactive transaction |
| `remove` (`:792-801`) | §D4 |
| `assertTeacherScope` (`:857-887`) | it is a **role refusal** and runs *before* the scope opens, by design — a refused request must cost no transaction. Moving it inside would put a `this.prisma` receiver inside a callback in a **different** method, i.e. corollary 1's failure |
| all of `announcements.service.ts` (10 sites) | §D2 |

**None of these is added to `ENUMERATED_OUTSIDE_SCOPE`.** That list carries **structural** reasons — shapes that
*cannot* be scoped — not paths that have not been (`ADR-048 §D6`). They count **uncovered**, visibly, in the
denominator, which is the honest place for them.

### D2 — the measured refusal to thread a `tx` into `AnnouncementRecipientsService`

> This is the section `announcements.controller.ts:438` and `announcements.service.ts:53` cite.

`AnnouncementRecipientsService` is `constructor(private readonly prisma: PrismaService) {}`
(`announcements.service.ts:52`). It differs from `CalendarSeedService` in one measured respect: it opens **no**
`$transaction`, so a `Prisma.TransactionClient` parameter threaded through `computeRecipients`, the five private
helpers and `materialiseReceipts` **would compile**. It is refused anyway, on three measurements rather than on
taste:

1. **It moves the counter by ZERO.** The service file contains no `scope.run(`, so `covered` is `false` for every
   one of its ten call sites and `classifyCallSite` returns `uncovered` **whatever the receiver is named**. A
   whole-service refactor for a metric delta of `0` is not a corner of another story; it is its own slice.
2. **It adds FIVE tables to a closure that is checked GLOBALLY at boot** — `guardianship`, `enrollment`, `student`,
   `teaching_assignment` and `announcement_receipt`/`INSERT` — roughly doubling this slice's closure surface. See
   §D3 for why that is not a small cost.
3. **Called from inside a callback it would emit on the OWNER connection** while the application connection holds
   the transaction — §D1's mechanism, with the additional property that the resulting coverage would be **false**
   rather than merely absent. An uncovered site is visible in the total; a falsely covered one is not.

**Cost real, gain nil, blast radius maximal.** Recorded as **`PF-235` (P2)**, carrying the per-handler ledger so the
next run starts from data instead of re-measuring.

The same reasoning, one step further out, is why `notification` gains **no** closure entry: it is reached only from
`publishInternal`, which is excluded — and an entry for a table no `tx` receiver reaches certifies a closure nobody
exercises, which is `PF-219`'s shape and the failure this slice must not commit while fixing `PF-232`.

### D3 — the boot-probe closure is GLOBAL: an OVER-declared entry is as destructive as a missing one, with the same blast radius

`APP_ROLE_REQUIRED_PRIVILEGES` (`apps/api/src/shared/prisma/tenant-scope.ts:146+`) is walked by `appRoleVerdict` **at
boot**, once, for the whole process. The two previous converting modules only had to learn half of the rule; this one
had to write the other half.

- **Missing entry** → the probe certifies `enforcing: true` over a closure nobody checked, and every request of the
  affected module answers `42501` on all four portals. Already drifted once: `academic_year`, `S-E01-5`, `PF-207`.
- **Over-declared entry** → `appRoleVerdict` returns `refused_unusable`, `transactionRunnerOrNull()` throws, and the
  **503 lands on `calendar` and `lessons` too**, not only on the module that declared it. This list is **global**,
  not per module.

The over-declaration hazard is concentrated on the FK-**derived** tables, whose granted privilege set is **closed**:
`announcement_receipt` holds `SELECT, INSERT, UPDATE` and **no `DELETE`**
(`20260813180000_tenant_rls_derived_policies/migration.sql:371`, `ADR-042 §D5`). Declaring
`announcement_receipt`/`DELETE` would 503 three modules for a privilege the schema deliberately withholds — the
`S-E01-5` boot-probe hazard **inverted**.

**Therefore every row this slice adds is exercised by a converted call site of the SAME diff**, and the rows it does
**not** add are a decision, written where the decision was made:

| Added (exercised by a converted site) | Deliberately absent | Why absent |
|---|---|---|
| `announcement` `SELECT`, `INSERT`, `UPDATE` | `announcement`/`DELETE` | `remove` is not converted — §D4 |
| `announcement_receipt` `SELECT`, `UPDATE` | `announcement_receipt`/`DELETE` | `app_user` does not hold it; the entry would 503 the app at boot |
| `student` `SELECT` | `announcement_receipt`/`INSERT` | granted, but written only by `materialiseReceipts`, outside every scope |
| (`user_profile`, `class_section`, `cycle`, `grade_level` — existing rows whose `why` was **extended**, never duplicated) | `user_role`, `role`, `notification` | reached only by `getOne`, `previewRecipients`, `publishInternal` — all three excluded by §D1 |

A second row for the same `(table, privilege)` pair is forbidden: a hand-maintained list growing a second copy of
itself is the disease this epic fights (`PF-219`, still open — the real cure is corpus-wide derivation, and it is
**not** in this diff).

### D4 — `remove` is NOT converted, because the `announcement` → `announcement_receipt` cascade is EXPECTED, not PROVEN

`announcement.delete` fires `ON DELETE CASCADE` into `announcement_receipt`
(`0_baseline/migration.sql:1737`), on which `app_user` holds **no `DELETE`** (§D3).

PostgreSQL executes referential actions through an RI trigger, with the privileges of the **constraint owner**, and RI
checks are not subject to row security — so the cascade is **expected** to succeed without a child `DELETE` grant.
**Expected is not proven, and nothing in this repository proves it.** If the assumption is wrong, every announcement
deletion raises `42501` after the cutover.

The ruling is therefore: **exclude the handler rather than declare the privilege.** `remove` keeps its two statements
on the owner connection and `announcement`/`DELETE` is **not** added to the closure. The proof this needs is an
executed one and it belongs to the `scripts/rls-isolation-check.js` harness — a slice that can run SQL — not to a
call-site conversion diff. Two independent reviewers asked *"prove it or exclude it"*; this is the exclusion,
recorded rather than deferred silently.

Note the direction of the risk: excluding costs coverage (two uncovered sites, visible in the denominator);
declaring costs **availability across three modules** on a guess. Fail-closed wins.

### D5 — the sentence that must appear wherever this module is described (DNC-06)

**The application still connects as the table OWNER, which escapes its own policies for want of
`FORCE ROW LEVEL SECURITY`. On `degraded_no_app_url` — every deployment today — the explicit `tenantId` predicate is
doing ALL of the work, and RLS is not doubling it.**

Three consequences of that sentence, none of which may be softened:

- **`announcements` is PARTIALLY converted.** Not "converted", not "isolated", not "closed". Five handlers of eleven;
  the module's own child table `announcement_receipt` is still written **entirely outside** any scope, by
  `materialiseReceipts`.
- **`PF-02` is NOT closed.** This slice advances half (a) from `24/816` to `36/816`. The global `DATABASE_URL` flip
  is still `S-E01-1`, on unchanged blockers.
- **`PF-208`'s closure is unaffected and unextended.** The ownership probes of `ADR-053 §D1` are what keep a foreign
  scope id out; the conversion does not add and does not remove a single guard. Every rebound statement kept its
  `if (!a || a.tenantId !== me.tenantId) throw new NotFoundException()` **byte-for-byte** (`ADR-042 §D1`: defence in
  depth, and today it is the only thing working).

`DNC-10` is also live and was respected: the readiness counter gains **no ratio floor**, no bypass flag, no
allow-listed id and no env knob. `PROGRESS.md` asked for a floor; a floor is `DNC-10`'s knob wearing a different hat,
`S-E01-1f §5` already refused it, and this slice refuses it again — asserted in source by the spec.

---

## Consequences

**Positive.** A third module is measurably inside the tenant seam and the counter moved by exactly the number of
sites converted, which is the first time in this epic that a conversion produced **no** `owner-inside-scope`
residue — the AC-2/`PF-217` trap was avoided by construction rather than caught in review. `PF-232`, the recorded cut
of `S-E01-1f`, is closed on its conversion half. The rule that decides *what can be converted at all* is written once,
at an address every future module can cite, instead of a fourth time as a local apology. The boot-probe closure gains
the **over**-declaration half of its own rule, which no previous slice had had to state, and the closure-coupling
ratchet in the spec now derives `(table, privilege)` from the controller's real `tx.<model>.<verb>(` sites — so a
future probe added without a closure line turns a named assertion red instead of 503-ing three modules at boot.

**Negative / accepted.** `announcements` is **partially** converted, and a partial conversion is a state a reader can
misread — which is why §D5 is mandatory prose in the controller header, in the service header and in this ADR. Six
call sites of `getOne` and `list` that a reader would expect to be scoped are not, for `G-TRUTH` reasons that are
real but that leave two projections (`_count.recipients` vs `getOne`'s resolved receipts) legitimately disagreeing
until `PF-230` cleans the dark rows. `remove` — a write — stays on the owner connection on an **unproven** cascade
assumption. The four excluded handlers keep the `switch (ref.field)` dispatch on `this.prisma` while `create`'s copy
now takes `tx`, so the two copies inside the same file **diverge in their receiver** (`PF-236`, new, and the
divergence is new with this diff).

**Rollback.** Delete the `TenantScopeService` injection, unwrap the five `this.scope.run(...)` callbacks and rebind
their twelve `tx.` receivers to `this.prisma.`, remove the six `announcements` rows from
`APP_ROLE_REQUIRED_PRIVILEGES` and revert the four extended `why` strings. No schema change, no migration, no
contract change, no `apps/web` change (`touchesUi: false`), no `apps/worker` change. `announcements.module.ts` is
**byte-unchanged** by design — `PrismaModule` is `@Global()` and exports `TenantScopeService`, so a wiring edit would
be re-adding a global.

**Open, by name.**

| Finding | Priority | What it is |
|---|---|---|
| `PF-235` | P2 | **New.** `AnnouncementRecipientsService` closes over its own `PrismaService`, so `computeRecipients` / `materialiseReceipts` cannot enter a tenant scope. Threading a `Prisma.TransactionClient` **would compile** — unlike `CalendarSeedService` — but moves the counter by **zero** (the file opens no scope, so its ten sites stay `uncovered` whatever the receiver is named) while adding **five** tables to a globally-probed boot closure. It needs its own slice; §D2 carries the measurement. |
| `PF-236` | P2 | **New, and the divergence is new with this diff.** The `switch (ref.field)` ownership dispatch exists **four** times (`announcements.controller.ts:475` and `:821`, `calendar.controller.ts:360` and `:588`). Until now all four were identical; converting `create` gives its copy a `tx` receiver while `previewRecipients`' copy keeps `this.prisma`, so two copies **inside the same file** now differ in the one thing that matters. `AC-7` was cut (`NICE`, cut first). The fix is a `(field → delegate)` resolver taking the client as a parameter — and the `findFirst` loop must stay **lexically** in each callback (§D1 corollary 2), or the sites re-attribute to the resolver. |
| `PF-232` | — | **CLOSED by this ADR's slice, on its conversion half.** Five of eleven handlers, twelve sites, `24 → 36`. Its residue is **not** dropped: `list`, `getOne`, `previewRecipients` and `remove` are named in §D1's table with their mechanisms, and `announcements.service.ts` is `PF-235`. |
| `PF-219` | P2 | **Unchanged and still open.** This slice extended the hand-maintained closure **by hand** for the third time and added the over-declaration half of its rule. The cure is corpus-wide derivation; a fourth hand-maintained list wearing a new name is the disease, not the cure. |
| `PF-218`, `PF-230`, `PF-233` | P2/P3 | **Unchanged.** The notification fan-out, the retroactive dark rows, and the teacher **footprint** (ownership proves the tenant, never the footprint). |

## Evidence

`apps/api/src/modules/announcements/announcements-scope-ownership.spec.ts` (**extended**, +483 lines, existing
assertions untouched) carries the proofs, in two families:

1. **The frame proof.** The fake `TenantScopeService` installs the **real** `AsyncLocalStorage` frame through
   `runInTenantScope`, and every fake model method records `currentTenantScopeFrame()?.tenantId`. One case per
   converted handler asserts that **every** recorded statement saw a frame carrying `me.tenantId` — and the negative
   half, which is the half that proves something: `ensureUser` / `forUser` see **`undefined`** (`PF-199`),
   `assertTeacherScope` refuses **before** any scope opens (`G-AUTHZ`: the order **is** the property), and
   `previewRecipients` — the named exclusion — opens **no** scope at all, every statement seeing `undefined`. Two
   `G-AUTHZ` cases prove the guards survived rebinding: another tenant's announcement still 404s and writes nothing,
   and a non-author non-admin is still refused **inside** the already-open scope.
2. **The closure-coupling ratchet.** The spec reads `announcements.controller.ts` as text, extracts every
   `tx.<model>.<verb>(` site, maps verb → privilege with a **closed** table (an unknown verb **fails**, it is not
   ignored) and model → table with the `@@map` camel→snake convention, then asserts `APP_ROLE_REQUIRED_PRIVILEGES`
   covers every derived pair, with a non-empty-corpus guard so it cannot pass vacuously. The **inverse** guard is the
   §D3/§D4 ratchet, and it runs in both directions: the **declared** closure must not carry
   `announcement_receipt`/`DELETE` (`app_user` does not hold it) nor `notification`/`INSERT` (no scope reaches it),
   and the **derived** set must contain **no** `.DELETE` pair at all, no `notification` and no `user_role` — so a
   helpful future edit can undo neither §D3's refusals nor §D4's. Plus source assertions for
   `DNC-06` (the module is called **partially** converted, never "isolated"), for `AC-3` (each unconverted handler
   carries an exclusion docblock), for `C-1` (`announcements.module.ts` wires nothing) and for `DNC-10` (no ratio
   floor on the readiness counter).

**Named honestly, per `AC-8`: these assertions have NOT been executed in this role.** `GUARDRAILS §4` reserves the
toolchain for the test-architect. What ran on this diff is `pnpm typecheck` (**13/13 exit 0**, `@pilotage/api` a
genuine cache **miss** compiling both `tsc --noEmit` projects), `git diff --check` (exit 0), and
`node scripts/tenant-adversarial-check.js` (**`36 scoped + 120 enumerated / 816`, 228 source files, verb-aware
`165 satisfied, 2 not`**). Every case named above is unexecuted until the gate runs
`pnpm --filter @pilotage/api exec jest src/modules/announcements` — and never under a path containing a
dot-directory, where jest finds zero tests.
