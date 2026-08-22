# ADR-057 — A module's privilege closure is **relation-deep**, not root-table-deep; and the scope opening belongs to the **helper**, not to its seven callers

- **Status**: `accepted`. Two things are decided here: (1) the `(table, privilege)` closure a converting module owes
  `APP_ROLE_REQUIRED_PRIVILEGES` is computed over every relation its `select` **traverses**, not over the root tables
  of its `findMany`s; (2) a Prisma statement shared by N handlers opens its **own** scope inside the shared helper
  rather than being inlined N times at the call sites. What this ADR does **not** decide: converting
  `AnalyticsService.parentUpcoming`, `RemediationService.remediationProgress` or `StudentAccessService`
  (each is its own slice), deriving the boot-probe closure mechanically (`PF-219`), or the global `DATABASE_URL`
  cutover (`S-E01-1`).
- **Date**: 2026-08-22
- **Story**: `S-E01-1i` (epic `V3-E01`), advancing **`PF-02` half (a)** from `36` to `47` attributed call sites,
  recording `PF-246`.
- **Relates to**: `ADR-021` (the student-self ABAC wall this module sits behind) · `ADR-032 §D5–§D8` (the application
  connects as the table **owner** and escapes its own policies) · `ADR-048 §D3` (the statement budget of an
  interactive transaction) and **`§D6`** (`ENUMERATED_OUTSIDE_SCOPE` is a list of **structural reasons**, not of
  pending work) · `ADR-049 §D4` (the budget amendment) · `ADR-051 §D1` (`SCOPE_SAFE_RECEIVERS` and
  `classifyCallSite`) · **`ADR-054`** (a collaborator that closes over its own `PrismaService` is EXCLUDED, never
  threaded a `tx` — this module is the fourth application of that criterion and the first that leaves the converting
  class with **no** `PrismaService` at all) · `ADR-056` (the tenant scope is a property of the **running stack**).
- **Number**: `057`. Allocated against `main` plus every open pull request (`TOOL-30` anti-recurrence): `056` is the
  highest on `main`, and no open PR claims an ADR (the six open PRs are all dependabot bumps).
- **Supersedes**: nothing. It amends nothing in place.

---

## Context

`student-portal` is the fourth module to enter the tenant scope, after `calendar` (`S-E01-1d`), `lessons`
(`S-E01-1e`) and `announcements` (`S-E01-1g`). It was sized in `NEXT.md` by run 66 as **11 call sites and three new
grants**. The call-site count was exactly right. The grant count was not, and the way it was wrong is the first
decision below.

It is also the first module whose Prisma statements live in a **service** rather than a controller, and whose
identity resolution (`resolveSelf`) is called by **seven** handlers. That shape forced the second decision.

---

## D1 — The privilege closure is computed over every relation a `select` TRAVERSES

**Decision.** When a module declares its `(table, privilege)` requirements in `APP_ROLE_REQUIRED_PRIVILEGES`, the
closure is taken over the tables its queries actually **read**, which includes every relation reached by a nested
`select` / `include` — not only the root delegate of each statement.

**Why, measured rather than reasoned.** Run 66's brief named three new grants: `grade.SELECT`,
`attendance_record.SELECT`, `student_subject_snapshot.SELECT`. Those are the three roots. But `/student/grades`
descends

```
grade -> assessment -> term
grade -> assessment -> teachingAssignment -> subject
```

and `subjectTrends`' live fall-through re-traverses `grade -> assessment`. Under RLS a traversed relation is a
**read**: Prisma issues its own query against it, and without the privilege that query raises `42501`. `assessment`
and `term` are therefore due, and they were absent from the sizing. The module needs **five** new pairs, not three.

**Why this matters beyond an off-by-two.** The failure mode is not a compile error and not a test failure. It is a
`42501` raised at request time, on the exact deployment where the scope is *working* — because a deployment where the
scope is degraded runs on the owner and never reaches the check. A privilege closure that under-counts is invisible
until enforcement is real, which is precisely when it is most expensive. Both missing pairs were verified **held** by
`app_user` on the stack's own database *before* being declared, not after: a declared-but-absent entry makes
`appRoleVerdict` refuse and the process boots into `refused_unusable`.

**The residual, stated.** This closure was computed **by reading the queries**, which is the same hand-maintained
method `PF-219` already names as the thing to mechanise. This slice makes `PF-219` more valuable and does not close
it: four modules' worth of hand-derived pairs now exist, and the fifth module will be the one that finally pays for
deriving them from the same matcher that produces the coverage arithmetic. The finding is recorded, not silently
absorbed (`PF-246`).

---

## D2 — A statement shared by N handlers opens its own scope inside the shared helper

**Decision.** `resolveSelf` — the `student.findFirst` that resolves the caller's own dossier and precedes all seven
reads — opens its **own** tenant scope. It is not inlined into its callers, and its callers do not wrap it.

**Why, and the number is the argument.** The attribution counter (`tenant-adversarial-check.js`) classifies **textual
call sites**, not invocations, and it is purely positional: a statement counts `scoped` when its byte index falls
inside a brace-matched `this.scope.run(` callback. Inlining `resolveSelf` at its seven call sites would therefore
have moved the ratio like this:

| shape | scoped | corpus total | uncovered |
|---|---|---|---|
| before | 36 | 818 | 662 |
| inlined ×7 | 51 | **824** | 653 |
| **helper opens its own scope** | **47** | **818** | **651** |

The inlined shape shows a *higher* numerator and a *worse* corpus: it improves coverage by growing the denominator.
That is metric inflation, and it is the same species of defect as the one `SCOPE_SAFE_RECEIVERS` was created to stop
(`ADR-051 §D1`) — a number that moves in the right direction for the wrong reason. One site, opening its own scope,
called seven times, is the shape where the numerator moves and the denominator does not.

**Nesting is safe if it ever happens.** `TenantScopeService.run` on the **same** tenant reuses the active frame and
opens no second transaction. No caller in this file nests today — each calls `resolveSelf` before its own scope — but
the property is what makes adding an eighth handler harmless rather than a trap.

---

## D3 — Two sequential scopes per handler, because the ABAC wall must sit between them

**Decision.** Each read handler runs `resolveSelf` (scope 1) → `canAccessStudent` (**outside any scope**) → its own
read (scope 2). Two short, sequential, never-nested transactions.

**Why not one scope.** `StudentAccessService` is in the bootstrap allow-list (`PF-199`): it *resolves the ABAC scope
itself*, and it closes over its own `PrismaService`. Called from inside a scope it would emit on the **owner**
connection while the process already holds an open interactive transaction on the **application** connection — two
connections for one HTTP request, the dangerous inverse of `PF-200`, and invisible to the attribution counter because
the counter is lexical. A single scope spanning the handler would necessarily straddle that call.

**Why not reorder so one scope suffices.** Running the wall *after* the read would let one scope cover both
statements, and nothing would leak (the wall still throws before any payload is returned). It is rejected anyway: it
inverts a security order that `ADR-021` states as *the wall runs before the read*, to buy a transaction. A cheaper
transaction is not worth a weaker invariant that the next reader has to re-derive.

**Budget.** Every scope in this module holds **one** statement, except `markAnnouncementRead`'s, which holds two
(`findUnique` + `update`, deliberately in the same transaction so the guard and the write cannot be separated by a
concurrent delete). `ADR-049 §D4`'s budget of three is not approached and **is not amended** — saying so explicitly,
because a slice that silently re-amends a budget is exactly how `ADR-048 §D3` came to be false.

---

## D4 — The converting class keeps NO reference to the owner client

**Decision.** `StudentPortalService` no longer injects `PrismaService`. All eleven of its statements go through
`TenantScopeService`, so the class **cannot** reach the owner connection.

**Why this is a decision and not a consequence.** The three modules converted before this one each kept a `prisma`
for a path that stayed outside (`calendar`'s seed service, `lessons`' notification fan-out, `announcements`'
recipients service). Keeping the injection is convenient and it is also how a converted module quietly acquires a
twelfth, unconverted statement six weeks later. Where every statement converts, the injection goes, and the
constructor becomes the shortest proof available: a producer that is never handed the owner client cannot use it,
whatever a future reviewer misses.

The three excluded collaborators are called **through their own services**, which keep their own clients. Their reads
therefore remain on the owner connection and count **uncovered** in the attribution. They are deliberately **not**
added to `ENUMERATED_OUTSIDE_SCOPE`: their only available reason would be *"not converted yet"*, and per
`ADR-048 §D6` that list holds structural reasons, not pending work.

---

## Consequences

- `PF-02` half (a) advances `36 → 47` attributed call sites of `818`; `651` remain uncovered. `PF-02` stays
  `in-progress`, and the cutover stays blocked.
- `APP_ROLE_REQUIRED_PRIVILEGES` grows `25 → 30` pairs. The boot probe's blast radius is global: a pair declared here
  and missing on a deployment refuses the **whole** application's second connection, not this module's.
- `/student/*` is the first surface whose every read is enforced by PostgreSQL on a deployment that declares
  `DATABASE_URL_APP` — which, since `ADR-056`, the local stack does.
- `PF-246` is recorded: the boot-probe closure is still derived by hand, and it has now been under-counted once.
