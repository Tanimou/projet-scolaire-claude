# ADR-051 — A file-level excuse is not a statement-level reason: the bootstrap allow-list splits into two kinds, and an owner receiver inside a scope stops counting as scoped

- **Status**: `accepted` — the two enumeration kinds, the mandatory `kind` field, the set-equality ratchet on the
  statement-level kind, and the receiver-aware call-site classification are decided and shipped. What this ADR does
  **not** decide is the corpus-wide derivation of the boot-probe closure, which is recorded as `PF-219` and is a
  separate slice.
- **Date**: 2026-08-15
- **Story**: `S-E01-1e` (epic `V3-E01`), settling `PF-199`, closing `PF-217`, recording `PF-218` and `PF-219`,
  advancing `PF-02` half (a).
- **Relates to**: `ADR-032 §D5–§D8` (tenant enforcement; the owner bypasses its own policies) · `ADR-042 §D4`
  (`tenant` is deliberately outside RLS so the identity seam can read it by slug) · `ADR-046 §D1` ·
  `ADR-048` (two connections; the per-module migration) and `§D3` (the measured statement budget) ·
  `ADR-049 §D1` (scope FKs are checked for ownership **inside** the scope) · `ADR-035` (no ambient interceptor).
- **Number**: `051`. Allocated against `main` **plus every open pull request** (`TOOL-30` anti-recurrence): `050` is
  the highest on `main`, and all six open PRs are Dependabot bumps claiming no ADR and no finding id.
- **Naming note for future readers.** The story `S-E01-1e` §5.2 called the two layers `structural` and `identity`.
  What shipped calls them **`surface`** and **`bootstrap`**. They are the same two ideas in the same order; the
  implementation's names are authoritative because they are what the code and the gate assert on. The divergence is
  recorded here rather than silently reconciled, because a reader arriving from the story would otherwise conclude
  the layer split was not implemented — which is exactly the conclusion this routine drew for one measurement before
  re-reading the source.

---

## Context — two defects that both fail in the SILENT direction

### 1. The allow-list excused files, not statements

`PF-199` records a structural fact: identity and context resolution **cannot** run inside the scope it resolves.
`ensureUser` reads `user_profile` — one of the 44 policied tables — from the Keycloak `sub` in order to **produce**
the `tenantId` a scope would need. It produces the key; it cannot consume it. `forTenant` and `scopeForUser` are the
same ordering constraint one layer down. These statements therefore stay on the owner connection **by necessity**,
and `scripts/tenant-adversarial-check.js` enumerated them so that `scoped + enumerated === total` could hold.

Every entry in that enumeration was a **file glob** carrying **one** reason. For a boot file that is sound: *"this
runs before any request exists"* is true of every statement in it **by construction**. For an identity-resolution
file it is not. `user-sync.service.ts` was excused for the five statements it held the day the entry was written, and
would equally excuse a sixth, unrelated `notification.create` added to it next month — **with no diff to the
enumeration at all**. The allow-list would still read green, the arithmetic would still close, and a statement nobody
reasoned about would be sitting outside every tenant scope. That is the manufactured green the enumeration exists to
refuse, reproduced one level down.

### 2. The coverage counter was receiver-blind, and moved the wrong way

`PRISMA_CALL_SITE_RE` matches `prisma.`, `this.prisma.` and `tx.` identically, and `covers()` is purely
**positional**. So a handler written

```ts
this.scope.run(id, async (tx) => { await this.prisma.grade.findMany(); })
```

counted as **scoped**. The hard rule *"inside the callback use `tx`, never `this.prisma`"* — the dangerous inverse of
`PF-200` — was unenforced by the only mechanism that reports the number.

This is worse than a missing check. The statement runs on the **owner** connection, which escapes its own policies,
while the counter credits it to the callback. **A half-converted handler produces a HIGHER scoped count than a
correct one**, so the metric moves in the wrong direction exactly when the code is wrong. `lessons` is the module
where this was most tempting: `notifyOnLessonPublished` and the ownership helper both hold `this.prisma`.

---

## Decision

### §D1 — An owner receiver inside a scope is UNCOVERED, and is reported by name

`SCOPE_SAFE_RECEIVERS` is `['tx']`, frozen. Call-site attribution becomes a **pure** function of
`(receiver, { covered, enumerated })` with four outcomes: `scoped`, `owner-inside-scope`, `enumerated`, `uncovered`.

**Order carries the property.** The owner-receiver test runs **before** the enumeration test, so a scope-covered
`this.prisma.` site can never be laundered into the enumerated column by a file that happens to be allow-listed.
`owner-inside-scope` is never silently folded into either column: it is named.

Being a pure function is deliberate — the gate spec drives all four outcomes without a repository scan, so the
classifier's contract is tested rather than inferred from a corpus that happens to contain an example.

### §D2 — `kind` is mandatory, and there are exactly two

Every enumeration entry declares a `kind`. There is no default, because a default is what a new entry would inherit
without anyone choosing it.

**`'surface'` — a whole-tree property.** The reason is true of every statement in the tree by construction (*"the
worker has no request tenant: a job carries its tenant in its payload"*, *"boot runs before any request exists"*).
Enumerating statement by statement here would be ceremony, not evidence. Reserved for boot globs and
`apps/worker/src/**`.

> **A `surface` entry naming a single `.ts` file under `apps/api/src/modules/**` FAILS.** That is precisely the
> discretion a converting module would otherwise use to hide behind the coarser kind, and it is refused by
> construction rather than by review.

**`'bootstrap'` — identity and context resolution.** The reason is a property of a **specific statement**, so every
statement is named with its **own** reason. No shared boilerplate string.

### §D3 — The `bootstrap` kind is ratcheted by SET EQUALITY, in both directions

For every `bootstrap` file, the declared entry set is compared against the set the scanner observes **using the same
matcher that produces the coverage arithmetic** — not a second, parallel implementation, because two hand-maintained
lists drifting apart is this repository's most frequently recorded defect.

| condition | verdict |
|---|---|
| a statement in the file with **no** entry | **FAIL** — `unlisted`. The hole the glob layer left open. |
| an entry matching **no** statement | **FAIL** — `dead`. How a stale literal is caught. |
| an entry with an empty or missing reason | **FAIL** — `unreasoned`. The pre-existing branch, extended to this kind. |

Keys are `(glob, model.verb)` and **never `file:line`**. Line keys drift on every reflow and then get "repaired" by
an `--update` mode — which is the run-45 baseline-mutation hazard and a knob wearing a different hat.

### §D4 — No ratio floor. Ever.

`scoped + enumerated === total` stays the top-level verdict. There is **no** minimum ratio, no tolerance, no
percentage target. A floor is a knob, and a knob here is a bypass flag wearing a different hat (`DNC-10`). This is
recorded verbatim in the ledger and is not open for re-litigation.

The corollary matters as much: when the wall is not reached, the shortfall is **reported as a named LIMIT** and the
run says *"the application is not ready to cut over"*. A green there would be the finding, not the win.

### §D5 — `teacher-profile.service.ts` is an identity resolver, and was missing from the list

The `PF-199` set was recorded as three files (11 statements). It is **four** files. `TeacherProfileService` resolves
`teacherProfileId` from a user profile and **writes while doing so** (`teacher_profile.upsert`, provisioning on first
sight). Inside a scope it would issue on the **owner** connection while the app connection holds an open interactive
transaction — the dangerous inverse of `PF-200`, invisible to any compile-time guard.

**This entry increases the `enumerated` term, and an increase in `enumerated` is arithmetically indistinguishable
from a manufactured green.** It is therefore justified on the measurement rather than on the convenience: the service
closes over its own injected `PrismaService`, cannot accept a `tx`, and resolves an identity. The before/after
enumerated counts are reported explicitly in the PR so the movement is auditable, and the measured site count is
**7**, not the 6 the story predicted — the measurement wins.

### §D6 — Auto-provisioning must not sit on a refusal path

Hoisting ownership resolution ahead of the existence guard changes **who gets provisioned**. `ensureForUser`
performs four statements including an `upsert`; calling it before the `findUnique` guard would make every refused
request — including an administrator's — provision a `teacher_profile` row. That is an **unaudited write on a refusal
path**.

So the module gains a read-only `findForUser`, used by `resolveOwnershipContext` on the guard paths, while
`ensureForUser` stays exactly where automatic provisioning is the intended product behaviour: the `mine=true` branch
of `list`. The privileged-role short-circuit runs **first**, and that ordering is a **security** property, not a
performance shortcut.

---

## Consequences

- The reported attribution moves for a **real** reason and can no longer be inflated by a half-converted handler.
  Measured on this slice: `13 scoped + 111 enumerated / 800` → **`24 scoped + 120 enumerated / 803`**, with **659**
  call sites that would return zero rows after the cutover. The application is **not** ready to cut over, and the
  suite says so as a named limit.
- Adding a statement to an identity-resolution file is now a **failing** change until it is named and reasoned. That
  is intended friction: it is the only moment at which someone is in a position to say why the statement cannot sit
  inside a scope.
- The two kinds are not symmetric and must not be made so. Collapsing `surface` into statement entries would mean
  hand-authoring ~100 literals — the same two-hand-maintained-lists defect, reproduced inside its own fix.
- `PF-219` remains open: `APP_ROLE_REQUIRED_PRIVILEGES` and the per-module derivation specs are still one
  hand-maintained set **per converted module**. The second module is what proves it does not scale. It should be
  derived once, corpus-wide, from every `tx.<model>.<verb>(` inside every attributed scope range.

## Evidence expected of the implementation

1. The classifier's four outcomes driven directly as a pure function, including `owner-inside-scope`, with a mutant
   that places `this.prisma.` inside a `scope.run` callback and asserts it is **not** counted as scoped.
2. A mutant that adds an unlisted statement to a `bootstrap` file, and a mutant that deletes a reason — each must
   make the verdict non-affirmative.
3. A `surface` entry naming a single module file must be refused.
4. The before/after verdict lines reported **verbatim**, never edited as literals.
