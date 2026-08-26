# ADR-073 — The parent attachment surface projects from `Guardianship` (the fact); `GuardianshipClaim` is provenance only

- **Status** Accepted (architecture ruling, `S-E03-3b` — run 83)
- **Date** 2026-08-25
- **Story** `S-E03-3b` — the parent claim panel must project from the FACT, with `GuardianshipClaim` as provenance only
- **Epic** `V3-E03` — Canonical truth and query contracts (layer L0)
- **Closes** `PF-357` (axis 5 of `PF-12`). **`PF-12` itself stays `open` / advanced** — `§D11`’s re-check was
  run at the review pass and FAILED: the guardianship predicate still has five hand-written homes (four of them
  parent-facing), so the axis `PF-12` names is narrowed, not removed. See `§D11` for the measurement
- **Raises** `PF-367` (the `canWithdraw` affordance discriminates matched from unmatched) · `PF-368` (three enum
  literal lists in `packages/contracts/src/enums/index.ts` contradict `schema.prisma`) · `PF-369` (`withdraw()`
  nulls `guardianshipId` and destroys provenance) · `PF-370` (`packages/contracts` gains a **third** sibling
  definition module — `ADR-041 §D4`'s registry deviation deepens; supersedes nothing, extends `PF-365`) ·
  `PF-371` (`claim-types.ts` is a hand-kept FE mirror of a shipped contract with no mechanism keeping the two in
  step). **This line is the canonical allocation — see §R, which reconciles it against the draft ids used in
  `§D4` / `§D7a` / the FE file list below.**
- **Related** `ADR-022` (enrollment self-service child claim — **the no-oracle wall this ADR must not breach**) ·
  `ADR-072 §A3` (the server answers, the portal consumes a verdict; `import type` only from `packages/contracts`) ·
  `ADR-072 §A1`/`§A2` (contracts modules take no Prisma dependency; sibling modules need not be symmetric) ·
  `ADR-071 §D5` (a failed read is never rendered as a domain fact — `read()` / `ErrorState`, and **do not write a
  61st `safe()`**) · `ADR-067 §D6` and `ADR-072 §A5` (one-way-ratchet house style) · `ADR-041 §D3`/`§D4` ·
  `ADR-002` (tenant scoping) · `GUARDRAILS.md` §2, §4, §5

---

## Verdict

**CONCERNS — proceed, under the rulings below.**

> ⚠ **READ `§R` BEFORE `§D1`–`§D11`.** This ADR was drafted in the same planning pass as the story
> `docs/spec/features/v3-e03/stories/S-E03-3b.md`, and the two drafts diverged on the state vocabulary, the
> envelope key, the row-identity shape, the DTO strategy and the finding-id allocation. **`§R` records which
> side won on each axis, with the measurement that settled it.** Where `§R` and a `§D` disagree, `§R` is the
> ruling and the `§D` paragraph is retained for its reasoning only. The story's `§3` is the implementable
> design.

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
recorded as ~~a finding of its own~~ — **SUPERSEDED by `§R.1`: the story's `§3.2` step 3 recovers the withdrawn
claim as provenance, so the residue is not nameable and a genuinely admin-created revoked link IS projected as
`ended`. No id is owed; the paragraph below is retained only for the reasoning that made step 3 mandatory** —
fix direction *(moot)*: *give `Guardianship` an explicit grant/revoke provenance (or backfill
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
It is the same class as `AC-5` and closes with it — **fixed here**, by the story's `§4` row 3, because the fix is
the same table row. **No id is allocated for it (`§R.2`)**; an item this slice genuinely closes earns a statement,
not a ledger row. `§R.2` also carries the measurement this paragraph is missing: `isAccessDenied` covers 403 and
404 **only**, so the 422 needs its own explicit term in the condition or it renders as a retryable failure.

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

**Re-checked at the review pass of run 83 — the answer is `advanced`, and the ledger says so.**
Measured by reading every non-spec `Guardianship.status` predicate under `apps/api/src` and `apps/worker/src`:

- `isLiveGuardianship` **was never created** — this slice shipped `mayProjectChildIdentity` /
  `isNameableForGuardian`, which answer *may this caller be shown this child*, not *is this link live*.
- Four **parent-facing** sites still spell the predicate by hand, and all four spell it `status: 'active'`:
  `students/student-access.service.ts:111` and `:192` (the parent ABAC wall itself),
  `apps/worker/.../parent-digest-cron.service.ts:171` and `.../digest-aggregate.service.ts:60`.

They **agree**, so no contradiction is live on the parent portal today — which is why `PF-357` closes. But
`§D11`’s test is about the predicate having ONE home, and it does not: five hand-written sites for one
question is the shape `PF-12` names. **`PF-12` is therefore recorded `open` / advanced**, with the remaining
axis stated in its own row, and it is not this slice’s to widen (`GUARDRAILS §5`: one coherent improvement).

---

## §R — Reconciliation with the story (authoritative; written at the implementation pass)

This ADR and `S-E03-3b.md` were drafted in parallel and shipped contradicting each other. Nothing below
re-opens a design question: each row states which document governs, and **the measurement that settled it**.
Where a `§D` paragraph conflicts with this table, this table is the ruling.

### R.1 — Design axes: the story's `§3` governs

| Axis | ADR draft | **Governs** | Why |
|---|---|---|---|
| State vocabulary | `pending_review` / `pending_link` (`§D3`) | **story `§3.3`** — the five members `linked · requested · request_rejected · request_withdrawn · ended` | The story's table is a *total* function of `(linkStatus \| null, claimStatus \| null)` with an exhaustive-`never` assertion (T-9). `§D3`'s two-name sketch never enumerated the 24 pairs |
| Envelope key | `{ attachments: [...] }` (`§D6.4`) | **story `§3.5`** — `{ links: [...] }` | Either satisfies `§D6.5`; one key must be picked and the story's is the one the tests, the ratchet and the FE mirror are written against |
| Method name | `listAttachmentsForGuardian` (`§D1`) | **story `§5`** — `listChildLinksForGuardian` | Cosmetic; the story's name is the one the ratchet `R3` and the controller call site cite. `§D1`'s substantive ruling — **the HTTP route does not change** — stands unaltered |
| Row identity | two nullable fields, never one opaque `id` (`§D6.2`) | **story `§3.1`/`§3.5`** — one `id` **plus** a separate nullable `claimId` | `§D6.2`'s hazard is real (a link id posted to `/parent/child-claims/:id/withdraw` is a 404) and is **already closed** by the story: `claimId` is its own field and `canWithdraw` is server-computed, so the component never posts `id`. The two-field sketch solved the same hazard twice |
| A claim-less `revoked` link | **not projected** (`§D4`) | **story `§3.3` row 5 + `§3.2` step 3** — projected as `ended` | `§D4` assumed provenance is joined by `guardianshipId` alone, so a withdrawn probe's residue would look admin-created. The story's step-3 fallback (`matchedStudentId === link.studentId`, `[createdAt desc, id desc]`) **re-attaches** that withdrawn claim, so the residue resolves to `request_withdrawn` with `child: null`, not to a nameable `ended` row. With provenance recovered, projecting a genuinely admin-created revoked link is honest and is not an oracle — no caller action produced it. **Overturned in part at the review pass (`§R.6`):** step 3 stands and is still load-bearing (story FM-1, T-3), so a withdrawn/rejected residue keeps its provenance and is projected. But a *genuinely* admin-created `revoked` or `pending` link has no provenance and, under the corrected `§D5`, no nameable identity either — so `§D4` is RESTORED for it: it is **not projected**. `§D4`'s accepted-loss paragraph stands as written; the id it allocated stays withdrawn, since the review pass fixed the axis rather than recording it |
| Child identity | `active` links only (`§D5`) | **`§D5` — and the story `§3.4` as drafted was a LEAK.** Overturned at the review pass of the same run; see `§R.6` | The draft row reasoned that `§D5` is *contained* in `§3.4`. The containment is the other way round: `§D5` is the strict predicate, `§3.4` was the wide one, and a wide predicate cannot be justified by containing a narrow one. `§3.4`'s `provenance === null` disjunct was gated on no link status at all, and **2460 of 2460 live links carry zero claims**, so it fired for `revoked` and `pending` links as the normal case. The predicate is `link !== null && link.status === 'active'` |
| DTO strategy | additive; `dto/child-claim.ts` read-only (`§D6.1`) | **story `§5`** — replace `ChildClaimStatusRowSchema` / `ChildClaimListResponseSchema` | **`§D6.1`'s premise is false, and it was measured.** It claims `ChildClaimStatusRow` "is also imported by `apps/web/src/app/admin/child-claims/types.ts`". `grep -rn "ChildClaimListResponse\|ChildClaimStatusRow" apps packages` (excluding `dist/`) returns **17 hits across 5 files, none of them under `apps/web/src/app/admin/`**. The real cross-portal dependency is a *different* symbol — see `R.3` |

### R.2 — The 422 is FIXED by this slice, and no id is allocated for it

`§D7a` allocated a finding to the `resolveGuardian` 422 false denial. **Verified: the story's `§4` row 3 fixes
it** — the 422 routes to `ReadErrorState variant="denied", retryable={false}`, which is neither the empty state
nor a claim about the family. Per the operator's instruction, an item genuinely fixed by this slice earns a
statement, not an id. **`§D7a` is retained as the rationale for `§4` row 3; the id it allocated is withdrawn.**

**One measurement `§D7a` did not make, and the implementer needs it:**
`isAccessDenied` (`apps/web/src/lib/read-result.ts:75-77`) is **exactly** `status === 403 || status === 404`.
**It does not cover 422.** A `§4` row 3 written as `isAccessDenied(result) ? denied : failure` therefore sends
the 422 to `variant="failure"` **with a retry button that can never succeed**. The 422 needs its own explicit
term in the condition. Do **not** widen `isAccessDenied` itself — it is consumed by other parent pages
(`ADR-071 §D5`) and changing its meaning is a change to those pages.

### R.3 — The real cross-portal constraint on `claim-types.ts`

`apps/web/src/app/admin/child-claims/types.ts:17-20` imports `ChildClaimRelationship` and `ChildClaimStatus`
**from `@/app/parent/children/claim-types`**. The admin queue's vocabulary is therefore sourced from a
*parent-portal* FE mirror.

- **Safe to delete** (story `§5`): `ChildClaimStatusRow` (`:63-76`) and `ChildClaimListResponse` (`:78-80`) —
  no other file imports either.
- **Must survive, or the admin queue stops compiling**: `CHILD_CLAIM_RELATIONSHIP` / `ChildClaimRelationship`
  (`:15-23`) and `CHILD_CLAIM_STATUS` / `ChildClaimStatus` (`:25-33`), plus `ChildClaimRequestInput`,
  `ChildClaimSubmitResponse` and `ClaimUnavailable`, which the submit drawer and server actions use.

This is `PF-371`'s substance and it is worse than "a mirror with no sync mechanism": the mirror is also a
*cross-portal* dependency. Recorded, not fixed.

### R.4 — An accepted residual on the no-oracle wall, deliberately not given an id

`§D3.3` requires `createdAt`/`updatedAt` to come from the **claim**, never the link, so a matched `submitted`
row and a `match_failed` row cannot be told apart by a timestamp source. The story's `§3.6` instead takes
`createdAt` from **the fact when a link exists**, and T-5 erases `createdAt`/`updatedAt` before its deep-equal.

**Ruled: the story governs, and the residual is accepted.** `submitClaim` writes the link and the claim inside
one transaction, so the two timestamps differ by microseconds and neither is observable against a reference the
caller holds — the row carries exactly one `createdAt`, not both. This is a theoretical discriminator, not an
exploitable one. It is named here so a later reader does not mistake T-5's erasure list for an oversight. **No
id is allocated** — the operator's allocation for this run is closed at `PF-371`. A future slice that widens the
wall's test to timestamps should start from this paragraph.

### R.6 — The REVIEW pass overturned `§R.1`’s child-identity row: `§D5` governs, and `§D4` is restored for the unnameable case

Written at the review pass of the same run, on a measurement, and it reverses a row of `§R.1` rather than
re-opening a design question.

**What `§R.1` shipped.** `mayProjectChildIdentity = link !== null && (link.status === 'active' || provenance === null || provenance.status === 'approved')`.

**Why it is wrong.** Only the first disjunct is gated on the link being live. `StudentAccessService`
(`apps/api/src/modules/students/student-access.service.ts:111` and `:192`) scopes a parent to
`status: 'active'` guardianships **only**, so `GET /students` and every downstream ABAC check deny exactly the
students the other two disjuncts named. And the second disjunct is not an edge: **2460 of 2460 live links
carry zero claims** (this ADR’s own Context measurement), so `provenance === null` is the ordinary shape of
the data, not the exception. The consequences, both first-party:

- `DELETE /api/v1/guardians/guardianships/:id` (`guardians.controller.ts:348`) is the admin’s custody-removal
  off-switch. It flips `status` to `revoked` and creates no claim. After it ran, the panel returned the
  child’s real `firstName`/`lastName` **and internal `studentId`** to the guardian just de-authorised.
- A `pending` admin-created link (28 live) named a child to a guardian the school has **not yet** authorised.

Pre-slice, `listForGuardian` read `GuardianshipClaim` alone and returned nothing for these rows, so this was
**new** disclosure of children’s data shipped inside a correctness fix — against `GUARDRAILS §1`.

**The ruling.** `§D5` governs verbatim: identity is projected for `status === 'active'` and for nothing else,
`studentId` included. `§R.1`’s justification (“`§D5` is *contained* in `§3.4`’s first disjunct”) inverts the
direction of containment — a wide predicate is not justified by containing a narrow one.

**And a corollary that `§R.1` did not see.** Gating the predicate alone was not sufficient: the projection’s
`displayName` fallback re-read `link.student` whenever `child` was `null` **and** there was no provenance, so
the same name went out by a second path. A link that is not `active` with no claim behind it therefore has no
name this caller may read at all, and is **not projected** — which is `§D4` restored, for its own reason. The
rule is stated once, as `isNameableForGuardian`, beside the predicate it composes.

**Not a lost capability.** The pre-slice panel rendered nothing for these rows, and the children list above it
is `active`-only too, so the two surfaces still agree — which is all `PF-357` asks.

**The tripwire.** This ADR's own *Verification* item 4 — *"an `approved` claim over a `revoked` link reads
neither \"Validé\" nor the child's name"* — was **failing** in the implemented diff, and story T-2 asserted its
negation. An ADR that states its acceptance in one place and has it contradicted in another is the `DNC-01`
shape this epic keeps catching itself in; the acceptance was right and the implementation was wrong.

**Evidence:** `child-claims.service.spec.ts` T-2 (revoked + `approved` claim → `child: null`), T-8 (⊆ against
the **active** subset, plus a whole-payload assertion that no non-active child’s name or id appears), T-8b
(revoked, no claim → not projected), T-8c (pending, no claim → not projected), T-8d (revoked **with** a claim
→ still projected, named from `claimed*`).

### R.5 — Unchanged and still binding

`§D2` (the vocabulary lives in one `packages/contracts` module, imported by the web app with `import type` only,
never executed there) · `§D3`'s *analysis* of the wall and the rows-2-and-6 collapse it demands · `§D6.5` (a
payload missing the envelope key is a **failed** read, never an empty one) · `§D7`'s outcome table minus the
422 row's id · `§D8` (the prop shape carries the rule; `claims: [] + available?: boolean` is deleted) · `§D9`
(one emptiness copy) · `§D10` (G-TENANT, the ratchet's house properties, the `⊆`-not-equality G-TRUTH
assertion) · `§D11` (the `PF-358` re-check before the ledger row is written `closed`).

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
  The runtime const lists stay FE-local — **out of scope**, recorded as **`PF-371`** (`§R.1`, `§R.3`). **`§R.3`
  is binding on this file:** `CHILD_CLAIM_RELATIONSHIP` / `ChildClaimRelationship` and `CHILD_CLAIM_STATUS` /
  `ChildClaimStatus` are imported by `apps/web/src/app/admin/child-claims/types.ts:17-20` and **must survive**;
  only `ChildClaimStatusRow` and `ChildClaimListResponse` may be deleted
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

**Negative, accepted.** ~~A claim-less `revoked` link disappears from the panel~~ — **withdrawn by `§R.1`: it is
projected as `ended`, because `§3.2` step 3 recovers the withdrawn probe's provenance and makes the residue
`child: null` instead of invisible.** `packages/contracts` grows a third definition module while
`ADR-041 §D4`'s registry still does not exist (§D2, `PF-370`). The response shape of a live endpoint changes, with
one consumer and a fail-loud guard (§D6). `PF-358`'s three admin sites remain divergent on the very column this
slice canonicalises (§D11).

**Neutral.** No migration, no schema change, no new dependency, no new package, no route change, no permission
change, `packages/contracts` CJS pin untouched (`GUARDRAILS §2`).

---

## Verification this ADR expects (Evidence Tier B + one ratchet, non-downgradable)

1. **RED-BEFORE, evidenced by execution.** A guardian with one `active` `Guardianship` and **zero** claims: assert
   the projection is non-empty. Run it against the pre-diff code, paste the failure, then restore.
2. **The wall test of §D3** — this is the story's **T-5**: `toEqual` between the matched (`submitted` + `pending`
   link) and unmatched (`match_failed`, no link) fixtures, modulo the identifier/timestamp erasure list in
   story `§6`. A label-only assertion does **not** discharge this. Both rows must read `state: 'requested'`
   (story `§3.3` rows 2 and 6), `child: null` and `decisionReason: null`; only `canWithdraw` may differ, and
   that difference is `PF-367`, recorded not fixed.
3. **§D4 as reconciled by §R.1** — this is the story's **T-3**: a `revoked` link whose withdrawn claim carries
   `guardianshipId: null, matchedStudentId: S` yields **exactly one** row, `state: 'request_withdrawn'`,
   **`child: null`**, naming only the parent's own typed name. A second row, or a non-null `child`, is FM-1
   shipping — the leak sold as the fix.
4. **§D5 / `AC-3`** — an `approved` claim over a `revoked` link reads neither "Validé" nor the child's name.
   **This item was FAILING in the implemented diff and is the tripwire that caught `§R.1`'s error** (`§R.6`):
   story T-2 asserted the exact opposite — `child` equal to the real student — because the draft `§3.4` had an
   `approved` disjunct. Corrected; T-2 now asserts `child: null` and that the payload carries no `studentId`.
5. **G-TENANT** — a foreign-tenant guardian id yields zero rows.
6. **G-TRUTH** — the ⊆ assertion of §D10, against the **`active` SUBSET** of the caller's guardianships and not
   the whole set (⊆-against-all-links passes while the panel leaks — `§R.6`), with the `PF-356` reason for `⊆`
   rather than equality written in the test, plus a whole-payload assertion that no non-active child's name or
   id appears anywhere in the response.
7. **The one-way ratchet** of §D10, with its floor, its passing negative control and its allowlist asserted empty.
8. **No live ROPC probe.** The realm is 100 % confidential; every such probe in run 77 returned 401. Jest against
   fixtures, per the story.
9. `pnpm typecheck` green, run **once**, by the test-architect only. Read the **last** `GATE:` line — never grep
   for it (`tenant-scope-deployment-check.js:261` prints a bare `GATE: PASS` around line 84).

*(Written 2026-08-25, `S-E03-3b` planning pass — Winston, BMAD Architect.)*
