# ADR-073 — The parent attachment surface projects from `Guardianship` (the fact); `GuardianshipClaim` is provenance only

- **Status** Accepted (architecture ruling, `S-E03-3b` — run 83)
- **Date** 2026-08-25
- **Story** `S-E03-3b` — the parent claim panel must project from the FACT, with `GuardianshipClaim` as provenance only
- **Epic** `V3-E03` — Canonical truth and query contracts (layer L0)
- **Closes** `PF-357` (axis 5 of `PF-12`) and therefore, with `ADR-072`'s three axes, **`PF-12` itself** — subject to
  §D11, which states the one axis that must be re-checked before the ledger row is written `closed`
- **Raises** `PF-367` (the 422 "no parent profile" false denial) · `PF-368` (a claim-less `revoked` link is
  unrepresentable and silently dropped) · `PF-369` (`claim-types.ts` is a hand-kept mirror of a shipped contract) ·
  `PF-370` (`packages/contracts` gains a **third** sibling definition module — `ADR-041 §D4`'s registry deviation
  deepens; supersedes nothing, extends `PF-365`)
- **Related** `ADR-022` (enrollment self-service child claim — **the no-oracle wall this ADR must not breach**) ·
  `ADR-072 §A3` (the server answers, the portal consumes a verdict; `import type` only from `packages/contracts`) ·
  `ADR-072 §A1`/`§A2` (contracts modules take no Prisma dependency; sibling modules need not be symmetric) ·
  `ADR-071 §D5` (a failed read is never rendered as a domain fact — `read()` / `ErrorState`, and **do not write a
  61st `safe()`**) · `ADR-067 §D6` and `ADR-072 §A5` (one-way-ratchet house style) · `ADR-041 §D3`/`§D4` ·
  `ADR-002` (tenant scoping) · `GUARDRAILS.md` §2, §4, §5

---

## Verdict

**CONCERNS — proceed, under the rulings below.**

No schema change, no migration, no new dependency, no new package, no new guard, no permission touched.
`G-MIGRATION` is correctly **not** triggered; `schema.prisma` must not be opened, so
`scripts/restore-drill-baseline.json` owes no entry (`PF-80` not armed). `G-AUDIT` correctly not triggered
(read-only).

Four things here are genuine architecture and are why this ADR is mandatory rather than optional:

1. a **two-source union projection** replacing a single-table read on a surface whose entire design purpose is an
   anti-enumeration wall (§D3, §D4, §D5) — this is the ruling that decides whether the slice is a fix or a
   vulnerability;
2. a **response-shape change to a shipped contract**, with a deploy-skew failure mode that reproduces the very bug
   being fixed (§D6);
3. a **third sibling definition module** in `packages/contracts` (§D2, `PF-370`);
4. a **prop-shape ruling** that makes the defective render structurally inexpressible rather than merely absent
   (§D8).

The CONCERNS, not a FAIL, are: the surface is walled by `ADR-022` and a careless union re-opens that wall by two
distinct mechanisms neither the brief nor `PROGRESS.md` names (§D3, §D4); and the honest closure of `PF-12` depends
on one relation this slice deliberately does not own (§D11).

---

## Context — measured 2026-08-25 on the running local stack, not derived from source

`docker exec pilotage_postgres psql -U pilotage -d pilotage`:

```
 status  | count | with_approved_at | with_revoked_at
---------+-------+------------------+-----------------
 pending |    28 |                0 |               0
 active  |  2460 |                0 |               0
guardianship_claim: 0 rows
```

Three facts in that table change the design, and two of them contradict the plausible implementation:

- **C-1 — the reproduction rate is 100 %.** Zero claims against 2488 links: *every* parent on this data reaches
  `claims.length === 0` (`ChildClaimsStatusStrip.tsx:120`) and is told they have attached no child, directly beneath
  the children list that just rendered those children (`page.tsx:357`). This is not an edge case.
- **C-2 — 28 `pending` links exist with zero claims.** They were therefore **not** created by `submitClaim`. A
  `pending` link is consequently *not* proof of a claim, and any projection that treats "pending" as "your request
  is being reviewed" will say that to 28 parents who submitted nothing.
- **C-3 — `approved_at` and `revoked_at` are NULL on all 2488 rows, `active` ones included.** There is **no column
  in the data that says a link was ever granted.** §D4 depends on this: the discriminator a reviewer would reach
  for does not exist, and building on it would be a paired-list drift of the kind that already cost this repo a 503
  on four portals.

Read from the tree, and both are load-bearing:

- **C-4 — a `pending` link is created by `submitClaim` ONLY on a match** (`child-claims.service.ts:244-254`). The
  *existence* of a link is therefore the matcher's verdict. Today the panel cannot leak it because it reads only
  `guardianshipClaim` and maps `match_failed` to the same chip as `submitted` on purpose
  (`ChildClaimsStatusStrip.tsx:41-42`). A union that projects links removes exactly that protection unless §D3 is
  enforced.
- **C-5 — `withdraw()` sets the claim to `withdrawn` and NULLs `guardianshipId`, while flipping the link to
  `revoked`** (`child-claims.service.ts:378-393`). So the state "`revoked` link with no claim" is precisely **the
  residue of a matched probe that was withdrawn**. Combined with C-3, this is §D4.
- **C-6 — `Guardianship` carries no `schoolId`** (`schema.prisma:567-593`), unlike `GuardianshipClaim` (`:610`).
  The school axis is *inexpressible* on the fact table. `PF-356` is therefore not fixable here and must not be
  faked.

---

## Decisions

### D1 — the union is built in the API; the portal consumes a verdict and cannot re-derive one

`ADR-072 §A3`, applied verbatim. `listForGuardian` is replaced by a projection that reads **both** relations
server-side and emits a resolved row. The component receives rows and renders them; it computes no state, joins no
tables, and holds no claim state client-side (`DNC-07`).

**Rename:** the service method becomes `listAttachmentsForGuardian`. The **HTTP route does not change** —
`GET /api/v1/parent/child-claims` stays. Renaming a live route for a naming nicety is a new HTTP decision requiring
a backward-compat redirect, buys nothing, and `GUARDRAILS §5` allows one coherent improvement per run. The now
slightly-narrow route name is recorded here so it reads as a decision, not an oversight.

### D2 — the vocabulary is stated once, in `packages/contracts/src/guardianship/`

`AC-3` requires the vocabulary in ONE module consumed by both sides. The house address is the sibling family
`ADR-070` opened and `ADR-072` extended: a domain folder under `packages/contracts/src/`, importing **no**
`@prisma/client` (`ADR-072 §A1`; the package builds to CJS and is consumed by `apps/web`, `GUARDRAILS §2`).

The module declares, and nothing else declares:

| export | why it is here |
|---|---|
| `GUARDIANSHIP_STATUS = ['pending','active','revoked'] as const` | mirrors the Prisma enum. **Exactly three values — verified against the live database.** Do not add a fourth |
| `isLiveGuardianship(status)` → `status === 'active'` | the single guardianship predicate. `PF-358`'s three admin sites may consume it **later**; this slice does **not** touch them |
| `ParentAttachmentState` + `resolveParentAttachmentState(link, claim)` | the pure `(linkStatus \| null, claimStatus \| null) → state` mapping. §D3 constrains it |
| `ParentAttachmentRowSchema` / `ParentAttachmentRow` | the row DTO (§D6) |

**The web app imports this module with `import type` ONLY** (`ADR-072 §A3`). The *server* emits the resolved
`state` string in the payload; the component maps `state → { label, tone, Icon }` — a presentation table, not a
predicate. Executing `resolveParentAttachmentState` from `apps/web` would fail at runtime with a green typecheck
until `dist/guardianship/` existed. A reviewer will be tempted to import the function into the component to honour
"one module"; that reading is **wrong** and this paragraph is why.

This makes three sibling modules where `ADR-041 §D4` asked for one registry. `ADR-072 §A6` deferred convergence
until "a third definition lands, or the `V3-E03` epic-spec run decides its shape — whichever comes first." **The
third has now landed.** The deviation is therefore no longer merely inherited: it is escalated as **`PF-370`**, and
the epic-spec run — still owed, now four slices old — must decide the registry's shape.

### D3 — THE WALL: a caller's own claim must project IDENTICALLY whether or not it matched

This is the ruling that decides whether the slice is a fix or a vulnerability, and neither the brief's `AC-6` nor
`PROGRESS.md` states it. `AC-6` says *"listing the caller's own active links reveals nothing `GET /students` does
not already return"* — **true for `active` links, false for `pending` ones**, because per C-4 a `pending` link
exists **only** when the matcher matched.

The attack is two API calls: submit a probe name+DOB, then `GET /parent/child-claims`. If the panel's answer
differs between "matched" and "did not match", the roster is enumerable — which is the entire reason
`UNIFORM_RECEIVED` and the `match_failed`→`submitted` chip collapse exist (`ADR-022`).

**The rule.** For every row whose provenance is a claim of the caller, the projection must be a function that is
**deep-equal, modulo the row's own identifiers**, between:

- `claim.status = 'submitted'` with a `pending` `Guardianship`, and
- `claim.status = 'match_failed'` with no `Guardianship`.

Enforced by construction, not by review:

1. **`state` collapses.** Both resolve to the single state `pending_review`. No second state, no sub-label, no
   tone difference, no icon difference.
2. **No link-derived field survives except the collapsed state.** `child` is `null` (§D5), no `studentId`, no
   link timestamps.
3. **`createdAt` / `updatedAt` come from the CLAIM, never from the link.** Two different timestamp sources
   discriminate the two cases by a millisecond. The sort key comes from the claim for the same reason.
4. **Row count is identical.** Dedupe on `GuardianshipClaim.guardianshipId` (`@unique`, `schema.prisma:620`) so a
   matched claim and its driven link are one row, never two. `AC-2`'s union is
   `(every Guardianship of the caller) ∪ (every GuardianshipClaim of the caller not already represented by its
   Guardianship)` — with `guardianshipId` as the join key and §D4's exclusion applied first.
5. **The displayed name is the parent's own typed `claimedFirstName`/`claimedLastName` in both cases.**

**The test is `expect(matchedRow).toEqual({ ...unmatchedRow, claimId: matchedRow.claimId })` — not two assertions
that each row says "En cours de validation".** An assertion on the label proves the label; the wall is about every
observable field.

Corollary for the 28 measured claim-less `pending` links (C-2): they are admin-created, carry no claimed name, and
resolve to a state of their own (`pending_link`) that **may** name the child, because no caller action produced
them and the caller cannot confuse them with their own submission. That branch is keyed on *claim presence*, which
the caller always knows, so it is not an oracle.

### D4 — a `revoked` link with NO claim is NOT projected, and `approvedAt` cannot be used to decide otherwise

Per C-5, "`revoked` link, no claim" is exactly what a **withdrawn matched probe** leaves behind. Projecting it —
with or without the child's name — re-opens the wall through a three-step: submit, withdraw, read. A row appearing
at all is the oracle; the name is merely the aggravation.

The obvious defence — "project it only if it was once granted, i.e. `approvedAt != null`" — **is not available**:
C-3 measured `approved_at` NULL on all 2488 rows, `active` ones included. No column in the data distinguishes a
link that was once real from a probe residue. Building the rule on that column would be a predicate that is
*locally plausible and globally false*, which is the `PF-12` shape this epic exists to remove.

**Ruled:** a `revoked` `Guardianship` is projected **only through its own claim**. Its claim row (`withdrawn`,
`rejected`) carries the parent's own typed name and leaks nothing. A claim-less `revoked` link is history — neither
a live fact nor an in-flight request — and is out of this surface.

Accepted consequence, stated so it is not later read as a regression: an **admin-revoked, admin-created** link
vanishes from the panel rather than reading "lien retiré". That is a real, if minor, loss of honesty, and it is
recorded as **`PF-368`** — fix direction: *give `Guardianship` an explicit grant/revoke provenance (or backfill
`approvedAt`) so "was once granted" is expressible; then project revoked-but-granted links with a neutral history
state.* It is **not** solved here with a column that does not exist.

### D5 — child identity is projected ONLY for `status === 'active'`

Today's `linkActive` predicate (`child-claims.service.ts:333`) is preserved **verbatim**, and `studentId` — which
powers the `/parent/children/:id` deep link (`ChildClaimsStatusStrip.tsx:202`) — is part of child identity and
obeys the same rule. Never on `pending`, never on `revoked`.

`AC-3` is then satisfiable without a second predicate: an `approved` claim over a `revoked` or `pending` link
resolves its state from the **link**, so it cannot read "Validé", and `child` is `null`, so it cannot name the
child either. Both halves of that failure close with one rule.

### D6 — the DTO is NEW and ADDITIVE; identity is explicitly discriminated; a shape mismatch is a FAILED read

`ChildClaimStatusRow` requires `id`, `claimedFirstName`, `claimedLastName` — none of which a link-only row has —
and it is also imported by `apps/web/src/app/admin/child-claims/types.ts`. Do **not** mutate it in place.

1. **A new `ParentAttachmentRowSchema` beside it**, in the §D2 module. `ChildClaimStatusRowSchema` stays where it
   is, unchanged, for the admin queue.
2. **Identity is two nullable fields — `claimId: string | null` and `guardianshipId: string | null`, at least one
   non-null — never one opaque `id`.** The withdraw server action posts to `/parent/child-claims/:id/withdraw`
   (`claim-actions.ts:84`); a link id arriving there is a 404 at best. Withdraw is offered **only** on a row with
   `claimId != null` and state `pending_review` with a claim of status `submitted`.
3. **The server emits the name it is willing to show.** The component must not reconstruct a display name from two
   nullable pairs, and today's non-null assertion `c.child!.firstName` (`:167`) must not survive into a union type.
4. **Envelope key.** The response becomes `{ attachments: [...] }`. `claims` is **not** kept as an alias — two keys
   is two sources of truth. The single measured consumer is `page.tsx:90`.
5. **The deploy-skew hazard is closed by construction, not by a dual key.** An old FE doing `resp.claims ?? []`
   against a new API renders `[]` — *the exact bug being fixed*. Therefore: **a payload missing `attachments` is a
   FAILED read (UNKNOWN), never an empty one.** That is §D7's rule applied to the shape, not a new principle.

### D7 — a failed read is UNKNOWN, never EMPTY. Reuse `read()`; do not write a 61st `safe()`

`ADR-071 §D5` shipped the mechanism and `AC-5` requires it. `apps/web/src/lib/read-result.ts` exists (`read()`,
`ReadResult`, `isAccessDenied`) and delegates to `apiResultFromError`, which re-throws `NEXT_REDIRECT` **first** —
the reason it must be reused rather than re-written (`PF-174`, already lived).

`fetchClaims` (`page.tsx:84-100`) is deleted. The mapping, exhaustively:

| outcome | render |
|---|---|
| `{ok:true}`, rows non-empty | the list |
| `{ok:true}`, rows empty | the `EmptyState` — **the only case that may claim emptiness** (§D8) |
| `{ok:true}` but no `attachments` key | treated as `{ok:false}` (§D6.5) |
| 404 / 501 / 503 | the existing calm "indisponible" banner (`available:false` path preserved) |
| **422** | its own state, carrying the API's own sentence (§D7a) |
| 403 | `ErrorState`, `role="alert"`. **Never** the `EmptyState` |
| 5xx / network / unknown | `ErrorState` with retry |

**§D7a — a second, independent false denial, not named by the brief.** `resolveGuardian`
(`child-claims.controller.ts:70-74`) throws `UnprocessableEntityException` — *"Votre compte n'est pas rattaché à un
profil parent. Contactez l'établissement."* — when the caller holds no `Guardian` row. Today that 422 falls into
`if (err instanceof ApiError) return { claims: [], available: true }` and the parent is told **"Vous n'avez pas
encore rattaché d'enfant"**: an actionable account-provisioning problem rendered as a statement about their family.
It is the same class as `AC-5` and closes with it. Recorded as **`PF-367`** and fixed here because the fix is the
same table row.

### D8 — the prop shape is the rule: `claims: [] + available?: boolean` is deleted

`ADR-072 §A3` ruled that a presentational component handed rows would have to choose among them, so the prop shape
carries the rule. Same here, and it is what makes `AC-4` **structural** rather than a promise.

`ChildClaimsStatusStripProps` becomes a **discriminated union**, e.g.
`{ kind: 'ok'; rows: ParentAttachmentRow[] } | { kind: 'unavailable' } | { kind: 'no-parent-profile'; message: string } | { kind: 'error'; canRetry: boolean }`.

With that prop, `claims.length === 0 → EmptyState` is **inexpressible**, because there is no longer a prop that is
simultaneously "the empty list" and "the failure". The current `available?: boolean` **defaulting to `true`**
(`:74`) is the same defect in miniature: an omitted prop silently asserts availability.

### D9 — `AC-4`: do NOT split the empty-state copy, and this is a real judgement call

`AC-4` invites distinguishing "no link at all" from "links exist but no request was ever made", while warning not to
trade a wrong denial for a new ambiguity.

**Ruled: one copy, unchanged.** Once §D3's union lands, *"links exist but no request was ever made"* **is not a
zero-state** — a link produces a row. The only surviving zero-state is genuinely "neither a link nor a claim", for
which today's sentence — *"Vous n'avez pas encore rattaché d'enfant"* — is **true**. Adding a second empty copy
would invent a distinction the data can no longer express, i.e. `DNC-06` in the copy layer. `AC-4` asked for this
to be written down if the answer was "one"; it is one.

New copy IS owed — for the failure states of §D7, which today have none.

### D10 — the ratchet, and G-TENANT

**G-TENANT.** The new `guardianship.findMany` is keyed on `tenantId` **and** `guardianId`, both server-derived from
the caller's resolved `Guardian` (`resolveGuardian`), never from a param. Both are non-optional **in the type** —
`ADR-070 §D3` / `ADR-072 §A3`: a tenant-less read is inexpressible, not merely forbidden. Never
`...(x ? { x } : {})` in a `where` (`ADR-065 §D5`: Prisma strips `undefined` and the query silently widens). A
foreign-tenant negative test is required. Per C-6 there is no `schoolId` on `Guardianship`; do not invent one —
`PF-356` stays open.

**The one-way ratchet**, in `apps/api/src/shared/quality/` (`apps/web` has no unit runner). Rule, in one line:

> The function that answers `GET /parent/child-claims` must issue a **`guardianship`** read in its own body. A
> parent-facing attachment projection whose emptiness can be decided by `guardianshipClaim` alone is a
> contravention.

House properties, all inherited, none negotiable (`ADR-064 §D1a`, `ADR-067 §D6`, `ADR-072 §A5`):

- **Inventory derived by walk**, never a hand-typed path list.
- **Home recognised by construction** — the file declaring the projection, asserted to be **exactly one**. Zero
  means it vanished and the ratchet is decorative; two means re-divergence already happened.
- **Negative control with a PASSING fixture** as well as failing ones — without it an always-red comparator
  satisfies every red case and proves nothing (run 45 / `TOOL-13`).
- **Fixtures name no real model** (`body-metatype-gate.spec.ts:761`); pass the model name as a parameter.
- **Anti-vacuity floor** measured per walked root, asserted below the measured count.
- **`MANUAL_ALLOWLIST` ships empty with an assertion that it is empty.** No `SKIP_*`, no `ALLOW_*`, no `NODE_ENV`
  (`DNC-10`).
- If any `.tsx` root is walked, parse with `ScriptKind.TSX` — parsed as `.ts` it can succeed silently on an empty
  tree, giving a vacuous ratchet (`ADR-072 §A5`).

**G-TRUTH, and the exact assertion.** For one guardian: `{ children returned by GET /students }` **⊆**
`{ rows whose state is 'active' }`. Assert **⊆, not equality** — `GET /students` applies a `schoolId` filter that
`Guardianship` cannot express (C-6, `PF-356`), so an equality assertion would go red for a defect this slice does
not own. Naming that in the test is the difference between a gate and a trap.

### D11 — before writing `closed`, re-check the one axis this slice does not own

`PF-12` closes on the strength of `ADR-072`'s axes 1–3 plus this slice's axis 5. **`PF-358` (axis 6) is out of
scope by operator instruction and must stay out.** It is on the same column: `students.controller.ts:247` filters
`status:'active'`, `:257`'s `_count.guardianships` is **unfiltered and counts revoked links**, and `:279` predicates
a third way. This slice *creates* `isLiveGuardianship` and *does not apply it there*.

That is acceptable — those are **admin** surfaces, and `PF-12` is a statement about the **parent** portal — but the
ledger row must say so in the same words, or the next reader will believe the guardianship predicate was unified.
If, at the land pass, any *parent-facing* surface still predicates `Guardianship.status` outside
`isLiveGuardianship`, the row is `advanced`, not `closed`.

---

## Module / file boundaries — exact, and disjoint by owner

**Amelia-BE** (`apps/api` + `packages/contracts`; contracts is assigned to BE per the `ADR-072` precedent):

- `packages/contracts/src/guardianship/{index.ts, parent-attachment.ts}` — **new** (§D2, §D6)
- `packages/contracts/src/index.ts` — one added `export *` line
- `packages/contracts/src/dto/child-claim.ts` — **read-only**; `ChildClaimStatusRowSchema` is not modified
- `apps/api/src/modules/child-claims/child-claims.service.ts` — `listForGuardian` → `listAttachmentsForGuardian`
  (§D1, §D3, §D4, §D5). **No other function in this file is touched**
- `apps/api/src/modules/child-claims/child-claims.controller.ts` — the one call site at `:113`
- `apps/api/src/modules/child-claims/child-claims.service.spec.ts` — extend; the existing FR-5 no-oracle test at
  `:261` must keep passing **unchanged in intent**
- `apps/api/src/shared/quality/<name>.spec.ts` — the ratchet (§D10)

**Amelia-FE** (`apps/web`):

- `apps/web/src/app/parent/children/page.tsx` — delete `fetchClaims`, adopt `read()` (§D7), pass the union prop
- `apps/web/src/app/parent/children/claim-types.ts` — the row type becomes
  `import type { ParentAttachmentRow } from '@pilotage/contracts'` (already the house pattern in ~15 web files).
  The runtime const lists stay FE-local — **out of scope**, recorded as **`PF-369`**
- `apps/web/src/components/parent/ChildClaimsStatusStrip.tsx` — union prop, state→chip table, failure renders
  (§D8). **`STATUS_CHIP`'s `match_failed`≡`submitted` collapse is preserved by §D3, not deleted**
- `apps/web/src/app/parent/children/claim-actions.ts` — read-only unless the withdraw guard needs the `claimId`
  narrowing of §D6.2

**Do not open:** `prisma/schema.prisma` · `apps/api/src/modules/students/students.controller.ts` (`PF-358`) ·
`apps/api/src/modules/guardians/guardians.controller.ts` · `school-context.service.ts` (`PF-356`) ·
`apps/web/src/app/admin/child-claims/**` · `StudentAccessService` · any guard or permission.

---

## Consequences

**Positive.** Every parent on the measured data stops being told they have attached no child while their children
are listed above the sentence. One guardianship predicate exists, in one place, ready for `PF-358` to consume. A
failed, denied or unprovisioned read stops being rendered as a family fact — three states that today all say the
same false thing. The defective render is deleted from the type system rather than from the code path.

**Negative, accepted.** A claim-less `revoked` link disappears from the panel (§D4, `PF-368`) — a small loss of
honesty taken deliberately over a wall breach. `packages/contracts` grows a third definition module while
`ADR-041 §D4`'s registry still does not exist (§D2, `PF-370`). The response shape of a live endpoint changes, with
one consumer and a fail-loud guard (§D6). `PF-358`'s three admin sites remain divergent on the very column this
slice canonicalises (§D11).

**Neutral.** No migration, no schema change, no new dependency, no new package, no route change, no permission
change, `packages/contracts` CJS pin untouched (`GUARDRAILS §2`).

---

## Verification this ADR expects (Evidence Tier B + one ratchet, non-downgradable)

1. **RED-BEFORE, evidenced by execution.** A guardian with one `active` `Guardianship` and **zero** claims: assert
   the projection is non-empty. Run it against the pre-diff code, paste the failure, then restore.
2. **The wall test of §D3** — `toEqual` between the matched and unmatched fixtures, modulo `claimId`. A
   label-only assertion does **not** discharge this.
3. **§D4** — a `revoked` link with no claim yields no row; the withdrawn claim over that same link yields exactly
   one row, naming only the parent's own typed name.
4. **§D5 / `AC-3`** — an `approved` claim over a `revoked` link reads neither "Validé" nor the child's name.
5. **G-TENANT** — a foreign-tenant guardian id yields zero rows.
6. **G-TRUTH** — the ⊆ assertion of §D10, with the `PF-356` reason for `⊆` written in the test.
7. **The one-way ratchet** of §D10, with its floor, its passing negative control and its allowlist asserted empty.
8. **No live ROPC probe.** The realm is 100 % confidential; every such probe in run 77 returned 401. Jest against
   fixtures, per the story.
9. `pnpm typecheck` green, run **once**, by the test-architect only. Read the **last** `GATE:` line — never grep
   for it (`tenant-scope-deployment-check.js:261` prints a bare `GATE: PASS` around line 84).

*(Written 2026-08-25, `S-E03-3b` planning pass — Winston, BMAD Architect.)*
