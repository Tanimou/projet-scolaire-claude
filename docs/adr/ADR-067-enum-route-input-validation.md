# ADR-067 — Enum-typed route inputs are narrowed on the parameter, from the NARROWEST list that already exists

- **Status** Accepted (architecture ruling, `S-E05-17` planning phase — run 77)
- **Date** 2026-08-23
- **Story** `S-E05-17` — [`docs/spec/features/v3-e05/stories/S-E05-17.md`](../spec/features/v3-e05/stories/S-E05-17.md)
- **Epic** `V3-E05` — AuthN/AuthZ hardening and permission integrity (layer L0)
- **Closes** `PF-314` (P2 `[correctness][ux]`) — `PATCH /api/v1/notifications/preferences/remediation` returned
  **200** and wrote a row `GET /notifications/preferences` never returns · `PF-315` (P1 `[truth][security]`) —
  an invalid `?status` on `GET /api/v1/alerts/instances` returned the **FULL UNFILTERED list** under a 200
- **Closes (clause)** `PF-51` — **clause 3 of 3, the enum clause.** With clause 1 (`ADR-064`, run 74) and
  clause 2 (`ADR-065`, run 75) already closed, `PF-51` flips `in-progress` → `closed`. **The flip is earned by
  the RATCHET (§D6), not by the three pipes** — three pipes close three sites; only a derived, repo-wide gate
  closes a class. Had §D6 landed weakened, the row would have stayed `in-progress`
- **Advances (not closed)** `PF-291` — no global Prisma exception filter. Two more measured instances
  (notification `kind` → `PrismaClientValidationError` → bare 500; calendar `?type` → 500)
- **Raises** `PF-316` (record-only, web third copy) · `PF-317` (the `remediation` channel dispatches with no
  user-facing preference) · `PF-318` (the admin calendar page lacks its teacher sibling's `safe()` wrapper) ·
  residual `R-1` (the gate's own execution path)
- **Predecessors** `ADR-064` (`S-E05-13`, clause 1 — the metatype-erasure mechanism this ADR reuses verbatim) ·
  `ADR-065` (`S-E05-15`, clause 2 — `ParseUUIDPipe({ optional: true })`, and the pinned-pipe verification
  method of its §D4) · `ADR-066` (`S-E05-16`, clause 3 partially, on `GET /api/v1/students`)
- **Related** `ADR-015` (permission model — guard metadata is untouched here) · `ADR-002` (tenant scoping —
  no new query path) · `ADR-052 §D5` (the precedent for a live probe wired into NO gate stage) ·
  `GUARDRAILS.md` §2, §5

---

## Verdict

**CONCERNS — proceeded, under the rulings below.** Three sites, one class. No schema change, no migration, no
new HTTP style, no new dependency. Two of the decisions change observable behaviour on a live route (§D2, §D3)
and both are deliberate; one (§D1) creates the file's only non-mirroring contract constant and therefore carries
a mandatory warning comment.

---

## Context — measured, not derived from source

Executed against the running local stack on 2026-08-23 (Keycloak ROPC via `portal-admin`, API on `:4000`):

```
PATCH /api/v1/notifications/preferences/alert          -> 200  (control)
PATCH /api/v1/notifications/preferences/not_a_kind     -> 500  {"statusCode":500,"message":"Internal server error"}
PATCH /api/v1/notifications/preferences/remediation    -> 200  writes a row GET /preferences NEVER returns
GET   /api/v1/calendar/events                          -> 200  (control)
GET   /api/v1/calendar/events?type=not_a_type          -> 500
GET   /api/v1/calendar/events?type=                    -> 200  (empty string is falsy today)
GET   /api/v1/alerts/instances?status=open&limit=5     -> 200  (control, filtered)
GET   /api/v1/alerts/instances?status=not_a_status     -> 200  FULL UNFILTERED LIST
```

The mechanism at SITE 1 is the one `ADR-064` documents for clause 1: the parameter was annotated `string`, so
`ValidationPipe.toValidate()` returned `false` and the global pipe was **SKIPPED, not lenient**. At SITE 2 the
`CalendarEventType` annotation is **erased at runtime** — there was no validator at all. At SITE 3 the guard
existed but its failure mode was to drop the filter.

---

## §D0 — Which enum source a given pipe takes (the spine)

Three sites, three different sources, would read as incoherence unless a rule resolves them. The rule:

> **A pipe's allowlist is the set the route ACTUALLY accepts, taken from the NARROWEST already-existing
> declaration of that set — never a new one.**

| Site | Accepted set vs the Prisma enum | Cross-package consumer? | Source chosen |
|---|---|---|---|
| notifications `:kind` | **⊊** — 8 of 9 (§D1) | yes (the web copy, `PF-316`) | a **contracts** constant, bound at the API through `ReadonlyArray<NotificationKind>` |
| calendar `?type` | **=** — all 7 | **no** (verified: no caller sends `type`) | the **Prisma runtime enum object** |
| alerts `?status` | **=** — all 4 | yes, and a contracts constant **already exists and is already the web's source** | the **contracts** constant, bound through `ReadonlyArray<AlertStatus>` |

**Corollary, stated so a later reader does not "fix" it: do NOT create `CALENDAR_EVENT_TYPE` in contracts.**
No web caller sends `type`, so it would be a brand-new twin list bought for nothing. Happily,
`calendar.controller.ts` already value-imports `CalendarEventType`, so that site needed no import change at all.

**Rejected alternative — "one style everywhere, always the contracts constant."** Symmetrical, and wrong: it
would mint `CALENDAR_EVENT_TYPE` with no consumer, i.e. a fourth hand-written list in a repository that has
already paid three times for exactly that (`project_paired_lists_drift`).

**Binding sub-ruling.** A contracts `as const` has **zero** compile-time link to Prisma. Consuming
`ALERT_STATUS` without binding it would move the twin list one file over, not close it: add a fifth
`AlertStatus` value and the filter silently 400s a legitimate value with nothing red. Every array-shaped
allowlist fed to a pipe is therefore bound at its use site through `ReadonlyArray<PrismaEnum>` —
`alerts.controller.ts` (`ALERT_STATUSES`) and `preferences.service.ts` (`NOTIFICATION_KINDS`). The precedent is
two lines away: `alerts.types.ts` already declares `RULE_CODES: ReadonlyArray<AlertRuleCode>`.

---

## §D1 — The accepted set is the EXPOSED set (8), not the Prisma enum (9)

`remediation` is a valid `NotificationKind` that `NOTIFICATION_KINDS` never contained, and
`listForUser` maps over `NOTIFICATION_KINDS`. So `GET /notifications/preferences` never returns it, and the
measured 200 on `PATCH .../remediation` wrote a row **the user can neither see nor unset**. That is `PF-314`.

**Decision.** The pipe's allowlist is the exposed 8, and `remediation` is refused with 400.

**Argued against the evidence that cuts the other way, because it is real.** The comment that justified the
omission — *"the booking notifications arrive in S2, so this kind is intentionally NOT in NOTIFICATION_KINDS
yet"* — **is falsified by shipped code**: `remediation.controller.ts` creates `kind: 'remediation'`
notifications at six sites, `remediation-sweep-cron.service.ts` declares the kind worker-side, and
`notifications.service.ts` gates email through the preference rows. Users already receive this channel. So
AC-2 is **not** a neutral tightening: after it, the channel is permanently on with no opt-out on any portal, on
children's data.

It is still the right call for one slice, for one reason: the 200 was never an opt-out. It wrote a row that no
surface renders and no request can clear — a control that only *looked* like one. Closing it stops the system
pretending. The real gap is recorded as **`PF-317`** and is not this slice's to fix; the fix is to EXPOSE the
kind (contract + UI row), never to widen the pipe alone. The stale comment is **corrected in this diff** rather
than carried verbatim to the contracts file — moving a false comment propagates it.

**Consequences that must not be lost.**
1. `NOTIFICATION_KIND` is the only constant in `packages/contracts/src/enums/index.ts` that is **not** a 1:1
   Prisma mirror, and it sits directly beside constants documented as mirrors. Without a header comment the
   predictable "fix" is a future author adding `remediation` to make it match — silently re-opening `PF-314`
   with no test red. A type cannot express *"deliberately not exhaustive"*, so **the comment is mandatory**, and
   it names `PF-314` and `listForUser`.
2. `ReadonlyArray<NotificationKind>` only proves one direction (contract ⊆ Prisma). It does **not** catch a
   Prisma value added and forgotten — which is exactly how `remediation` arrived. The other direction is
   therefore derived and executed: `WITHHELD_NOTIFICATION_KINDS` subtracts the exposed list from
   `NOTIFICATION_KIND_LABEL` (which TypeScript keeps exhaustive over the Prisma enum), and a spec pins it to
   exactly `['remediation']`. A tenth Prisma value turns that spec red and forces a decision.
3. The exposed list's **order** is the settings-page render order. The spec pins the ordered 8-tuple, not
   membership: a `Set`-based assertion would pass while the UI silently reordered.

**Rejected alternative — validate against the 9-value Prisma enum.** One line shorter, and it preserves
`PF-314`: the invisible row keeps being writable.

---

## §D2 — `?type=` (present but empty) becomes 400, where it returned 200

`ParseEnumPipe`'s `{ optional: true }` skips **`undefined`/`null` only** (`isNil`); an empty string is not nil,
reaches `isEnum('')` and fails. Verified against the pinned `@nestjs/common@10.4.22` source, per `ADR-065 §D4`.

**Decision.** Ship the 400. Add **no** normalisation layer to preserve the old 200 — that would be a new
bespoke seam in exchange for a behaviour no caller relies on.

**Blast radius, measured rather than asserted.** No caller anywhere in `apps/web`, `apps/worker` or `e2e` sends
`type` at all, and the reason is stronger than a grep: the admin calendar's type filter is **entirely
client-side** — `CalendarManager.tsx` holds `useState<CalendarEventType | 'all'>('all')` and filters an
already-fetched array; the `<select>` never reaches the network. All five real call sites
(`admin/calendar`, `parent/calendar`, `parent/dashboard`, `teacher/calendar`, `teacher/dashboard`) fetch
`/api/v1/calendar/events` bare. `?type=` is unreachable from every current surface.

**FORWARD REQUIREMENT — the sentence that stops this becoming a future incident.** When the type filter is
moved server-side (it will be, the moment the event list needs pagination), the `'all'` sentinel **must
translate to OMITTING the parameter, never to `type=''`**. A `<select>` whose "Tous les types" option carries
`value=""` is the single most natural way to write that component, and it is exactly the shape that now
returns 400.

**Rejected alternative — treat `''` as absent inside the controller.** It preserves today's 200 and buys a
permanent special case that every future reader must discover; and it is precisely the `PF-304` shape.

---

## §D3 — A 400 replaces a SILENTLY WIDENED read projection

SITE 3 is not a validation gap, it is a **truth defect**. `statusRaw` failing the hand-written check fell
through to `undefined`, i.e. **no filter** — so the admin saw resolved and dismissed alerts under an
"Ouvertes" heading, in a 200.

**Decision.** Invalid `?status` is 400. The four valid statuses and the absent case are unchanged, and that is
proven by a before/after comparison on the **valid** path over the same fixture, not only by a 400 on the
invalid one (G-TRUTH).

**The worst case after the change, said out loud.** `admin/alerts/page.tsx` issues four fixed parallel fetches,
each wrapped in `safe(...)` with a `?? []` fallback and no error banner, so a hypothetical 400 renders as an
**empty tab, silently**. That is the correct outcome and strictly better than the defect it replaces:
**today's bug is a wrong-data screen; after the fix the worst case is a no-data screen.** For a
non-stigmatising alerting product, showing nothing beats showing four dismissed alerts labelled open. Counts
derive from `openResp?.total ?? openRows.length`, so tiles degrade with the rows — no split-brain.

The page already declares `status?: string` in `AlertsSearchParams` without forwarding it; the moment someone
wires that up, an invalid status becomes a silently empty list. That is on the `PF-315` row.

**Rejected alternative — keep falling back to "no filter" but log a warning.** It keeps a wrong-data screen and
moves the evidence somewhere nobody reads.

---

## §D4 — The 400 body is FRENCH, because it is rendered verbatim to an end user

`ParseEnumPipe`'s default message is `Validation failed (enum string is expected)`.
`apps/web/src/lib/api-client.ts` documents that **`ApiError` bodies are returned as-is**, and
`PreferencesPanel.tsx` renders that string raw inside a `role="alert"` banner, concatenated with
*"— le réglage n'a pas pu être enregistré, réessayez."*

Shipping §D1 without a message override therefore puts an English sentence in a French UI **next to advice that
is actively false** — a 400 on an invalid enum never succeeds on retry, so the banner instructs a dead loop.

**Decision.** SITE 1's pipe takes an `exceptionFactory` returning `BadRequestException('Type de notification
inconnu.')`. Status stays **400**, so the probe matrix is unchanged; only the message moves.

Wording constraints, each load-bearing: **no value echo** (interpolating `kind` would be a reflected-input path
into a `role="alert"` region), **no enumeration of the 8 valid kinds** (API-shaped detail on a screen where the
user never chose the value — the kind comes from a hard-coded union in `preferences-actions.ts`), and no
"réessayez" implication — it reads as terminal, which is what a 400 is. The factory returns a **plain constant
string**: no `NODE_ENV` branch, no interpolation (DNC-10).

SITES 2 and 3 are read paths with no such banner, so a French factory there is consistency, not correctness,
and is not added in this slice.

---

## §D5 — Landing prerequisites, and what the probe does NOT prove

`scripts/enum-route-input-probe.js` is committed and is deliberately wired into **no** `ci-gate.sh` stage. It
needs a live stack and it **mutates** (the control row is a PATCH). Precedent: `ADR-052 §D5` —
`keycloak-live-probe.js`, `restore-drill.js`, `trace-emission-probe.js`. It guards **both** `KEYCLOAK_URL` and
`API_URL` for loopback (its predecessor guards only the first, because it only speaks to Keycloak), takes
credentials from env with no defaults, prints no token/password/secret, and makes its control PATCH
**value-preserving** — it reads the current row and writes the same four fields back, then verifies the row is
unchanged.

**Two hard landing prerequisites, in order, and the probe is meaningless without both.**

1. **`pnpm --filter @pilotage/contracts build`.** `packages/contracts` resolves `types → ./src/index.ts` but
   `default → ./dist/index.js`. The new `NOTIFICATION_KIND` export therefore typechecks green with no build
   (and jest maps the specifier to `src`), while the **running container** resolves `dist/index.js` and gets
   `undefined`. `new ParseEnumPipe(undefined)` throws *at route construction* — a **bootstrap failure across
   four portals, with nothing red in CI**. The executed tripwire is
   `preferences-kind-pipe.spec.ts`'s assertion that the constant is a non-empty, ordered 8-tuple.
2. **The API image must be re-created.** `pilotage_api` runs a built image with no source bind-mount, so a
   probe run before the rebuild faithfully reports the **pre-change** matrix and exits non-zero. That run is the
   probe's own negative control — it proves the probe MEASURES rather than passing by tautology — and it must
   never be presented as the green evidence. The green matrix is recorded with the **image age** beside it;
   without that, it is `project_proof_on_scratch_is_not_the_target`.

---

## §D6 — The ratchet is what closes the CLASS, and its rule is annotation-first

The first draft of the rule was *"a `@Param`/`@Query` value cast to an enum-ish type without a validating pipe"*.
That rule is **blind to SITE 2**, which has no cast anywhere — it would have been green on a full regression of
one of the three sites it exists for. The rule is therefore **two-armed**:

> A `@Param(...)` / `@Query(...)` parameter whose **declared type** names an enum-ish type, **or** whose
> identifier appears in an `… as <Enum>` assertion in its handler, must be narrowed **either** by a pipe on that
> same parameter **or** by a membership guard whose operand is a list BOUND to the enum type.

**"Enum-ish" is DERIVED, never enumerated** (`ADR-064 §D1a`): the inventory is parsed from the `enum X { … }`
declarations of `apps/api/prisma/schema.prisma` (49) plus the `type X = (typeof Y)[number]` aliases of
`packages/contracts/src/enums/index.ts` (13). Writing `NotificationKind | CalendarEventType | AlertStatus` would
be the twin list this whole ADR argues against, and would hand the next author a one-line green.

**The guard arm exists because two correct siblings would otherwise go red**, and every escape from that is
prohibited: an allowlist is a forbidden weakening *and* a fourth hand-written list; converting them exceeds the
stated diff boundary; loosening until they pass is `R-30`. So they pass **by construction**: the `.includes(…)`
operand must be an identifier that is either (i) imported as a value from another module
(`admin-child-claims.controller.ts` — `GUARDIANSHIP_CLAIM_STATUS` from contracts) or (ii) a module-level `const`
whose declared type names an enum (`meeting-requests.controller.ts` —
`MEETING_REQUEST_STATUSES: MeetingRequestStatus[]`). **A measured correction to the planning brief:** that
second list is *file-local and hand-written*, not derived from a shared constant as the brief and the ruling
both stated — it qualifies because it is **type-bound**, which is the property that actually matters. An inline
array literal — exactly `['open', 'acknowledged', 'resolved', 'dismissed']`, the pre-slice alerts site — never
qualifies. **The negative-control fixture is the shape of those two siblings**, not a trivially clean
controller: without a case that must PASS, an always-fail comparator satisfies every red case (run 45 /
`TOOL-13`).

`@nestjs/common` symbols are excluded from allowlist candidacy. Without that, `@Query('s', new
DefaultValuePipe('a'))` — which validates nothing — would "name" `DefaultValuePipe` and pass. One package, one
written reason, not a disguised exception list.

**Run over the real corpus before being committed** (41 controllers, 10 enum-bound parameters): it named
**exactly** the three sites before the fix and **zero** after. Printed, not asserted in prose.

**PF-295 is not re-instantiated.** The classifier receives its enum inventory **as a parameter**, so fixtures use
a synthetic name (`FixtureStatus`) that exists nowhere in the product. Concatenation alone would not have
closed it — the string would still be there. `MANUAL_ALLOWLIST` ships empty. No `NODE_ENV` / `SKIP_*` /
`ALLOW_*` anywhere (DNC-10).

**Residual `R-1`, recorded rather than hidden.** `ci-gate.sh` runs the full `test-ratchet.js api` only when the
diff matches `GATE_MACHINERY` (`^(scripts/|\.github/|infra/|apps/api/src/shared/quality/)`). This file matches,
so the ratchet runs on **this** PR — but a future controller-only PR takes the `--skip src/shared/quality/`
branch and would not execute it. Stated in the spec's docblock.

---

## §D7 — What this slice deliberately does not touch

- **`AC-1`'s claim is scoped honestly.** Nest orders guards → pipes → handler, and `permissions.guard.ts`
  performs a database read (`effectivePermissions`) **before** any pipe. The claim is *"400 in the pipe phase,
  before the handler body and before `ensureUser`"* — never *"before any database read"*, which a later reader
  would correctly falsify and then distrust the rest. The useful consequence is banked as a test: a caller
  lacking `profile.write.self` gets **403, not 400**, so the pipe cannot enumerate valid kinds for an
  unauthorized session.
- **G-TENANT holds, with its caveat written down.** `calendar.controller.ts` still builds
  `where = { tenantId, schoolId }` from the single `tenantId` expression before the pipe result is consulted,
  and the preferences `upsert` still passes `tenantId` in its `create`. The `upsert`/`findUnique` `where` keys
  on the `userProfileId_kind` compound and carries **no** `tenantId` — pre-existing, safe because
  `userProfileId` is tenant-bound, unchanged by this diff, and explicitly **not** this slice's to fix.
- **G-PORTAL is reported with the REAL numbers.** Notification preferences: **3/4** (admin/teacher/parent) —
  `apps/web/src/app/student/` has no `settings/` route (`PF-57`, pre-existing). Calendar: **3/4, not 4/4** —
  the planning brief's *"calendar IS on all four"* is **stale**; there is no `student/calendar/` route and no
  `calendar/events` fetch anywhere under the student portal (its nearest surface, `upcoming/`, uses
  `/api/v1/student/upcoming`). Alerts instances: admin-only, 1/1. "No student surface exists" is the honest
  statement; "student unaffected" is not.
- **Guard metadata is byte-identical.** Every `@RequiresPermission` on the three touched handlers is unchanged.
  This slice narrows inputs only.
- **`meeting-requests.controller.ts` and `admin-child-claims.controller.ts` are untouched**, and
  `calendar.controller.ts`'s live teacher fail-open (`ADR-066 §D5` — `teacher` folded into `isPrivileged`
  before `scopeForUser`) is **out of scope**, ~20 lines from an edit this slice makes. Said here so the omission
  is not read as an oversight.
