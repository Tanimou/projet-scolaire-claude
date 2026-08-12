# NEXT — track **b** (authz & audit) · written by run 41 (`S-E05-7`), 2026-08-12

> Read this at Step 1. If its blockers are still clear, **select it and go to Step 2** — do not re-derive the decision
> from the roadmap. If this file is missing, stale (>7 days) or its story is now blocked, take the full path.
>
> Track b's seam (`tracks.md`): `apps/api/src/shared/auth/**` · `apps/api/src/modules/identity/**` ·
> `apps/api/src/modules/audit/**` · guards, DTOs and permission code in other `apps/api` modules.

## ▶ Next story → `S-E05-2b` — the fifth grant path (`PF-09` residual)

| | |
|---|---|
| **Story** | close the **`realmRole` invite channel** — the one grant path `S-E05-2`'s privilege ceiling does **not** cover |
| **Epic** | `V3-E05` |
| **Layer** | **L0** |
| **Size** | **M** |
| **Gates** | `G-AUTHZ`, `G-AUDIT`, `G-DNC` |
| **blockedBy** | ⚠️ **`D-12`, a human product call in `open-decisions.md`** — read the caveat below before selecting |

**Why it ranks first.** It is the epic's only remaining **live escalation path**. `S-E05-2` (run 39) put a privilege
ceiling on four of five grant channels — `roles.controller` create + update, `users.service.assignRole`, and
`invite.controller`'s `customRoleSlug` — and left `realmRole` invite provisioning unceilinged **by decision**, because a
naive subset ceiling there would refuse an ordinary "invite a teacher". So the escalation `S-E05-2` closed reproduces
**one email later**, and `PF-09` is recorded as *narrowed to 4 of 5 channels, not closed*.

**⚠️ Check the blocker before you commit to it.** The shape `S-E05-2` recommends is a **grantor-relative ladder**
(provision at or below your own level) rather than a subset ceiling, and that is the §2.4 option-2 delegation question
which needs its own `ADR-015` entry — i.e. it plausibly still needs **`D-12`**. **Read `open-decisions.md` first.** If
`D-12` is still unresolved, this story is **not selectable** (Step 1: never select a story with an unresolved
`requiresDecision`) — take the alternative below instead and say so in your report.

## Alternative if `D-12` is still open → `PF-175`

`PF-175` (P2) — pre-ceiling escalated grants pass the new ceiling **unconditionally**. The detection query is recorded
in `S-E05-2`'s notes and, as of this run, **has still never been run**. Squarely in your seam, needs no decision, and it
is a genuine "prove the fix is complete" slice: `S-E05-2` bounded what can be granted *from now on* and grandfathered
whatever was already granted. This was already flagged as run 40's second candidate and was not taken then either.

## Do NOT select

- **`PF-181`** (the throttled parent faces a disabled submit button) and **`PF-174`** / **`PF-129`**'s fix — all
  `apps/web` = **track c's seam**.
- **`PF-182`(b)** — the edge `limit_req` companion lives in `infra/nginx/**`, which belongs to no track; it needs an
  operator, not this routine.
- **`PF-153`** — needs `ADR-013`. Until it lands, the unfiltered role lookup at `users.service.ts:85` **must stay
  unfiltered** and its docblock at `:67-72` must stay.
- **`PF-178`** — needs `D-12` as well.

---

## What `S-E05-7` shipped, so you do not re-derive it

**`PF-46` NARROWED (not closed).** `POST /auth/register-parent` — the product's one public mutation — now refuses above
a two-tier fixed-window admission bound applied with `@UseGuards` on **that handler only**.

- **The design decision that matters is what it does *not* key on.** This endpoint has exactly one caller repo-wide and
  it is a Next.js **server action** issuing a container-to-container `fetch`, so `req.ip` is the **web container's
  egress address — one constant value shared by every registrant on earth**. A per-IP limiter would have been a
  self-DoS, not a weak bound. Nothing in `public-endpoint-throttle.ts` reads a request address or a forwarding header.
- **Tier 1** = 5 admissions per window per `sha256` digest of the submitted email — an enumeration-**rate** bound. The
  key is caller-chosen and therefore **rotatable**; it is *not* a security bound, and the docblock says so.
  **Tier 2** = 30 admissions per window endpoint-wide — the amplification bound, and the one that actually holds.
- **Counters count admissions, not attempts**, and tier 2 is evaluated **first**. This is not a detail: if refusals fed
  the global counter, an attacker hammering one address would exhaust the endpoint-wide ceiling and convert a
  per-identity bound into a global outage.
- **The window is epoch-aligned and the sweep is a whole-map clear**, done on the first line of `admit`. Per-key lazy
  expiry was rejected for a measured reason — it only shrinks for keys touched again, so one busy window leaves the map
  permanently full, the capacity test trips, and a fail-closed limiter turns signup off forever with no attacker.
- **No dependency added** (a bump is how the **NestJS v10 pin** breaks by accident), **no `prisma/**` change** (that is
  track a), and `register.controller.ts` differs from `HEAD` by **+7 lines** — so `ADR-035` D1's one-statement
  `writeAudit` and the `persistRegisteredParent` / `compensateOrphanedKeycloakUser` split are untouched.
- **All three refusal reasons return the byte-identical 429 with no `Retry-After`.** Making a per-address refusal
  distinguishable from a global one would have rebuilt the enumeration oracle `S-E05-11` had just closed at the two 409
  branches. The tier lives in a `Logger.warn` emitted **once per tier per window**, and nowhere else.
- **No `auditLog` row per refusal, deliberately** — a refused request performs no mutation, so `G-AUDIT` does not
  trigger, and a DB write per blocked anonymous request would rebuild the exact amplification the guard removes, one
  table over. The docblock argues this so the next author does not "fix" it.
- **Ships `ADR-038`** (in-process admission bounds on pre-auth endpoints), against the story's own §5 "no ADR" — because
  D2's **single-replica invariant** is a claim an `infra/` editor can silently break, and an ADR is where they meet it.

**Two corrections this run made to the sprint's own output**, both docblock honesty, both verified before editing:
the guard claimed *"every French string on the API side is straight"* (**false** — 30 files under `apps/api/src` use
`’`, including the sibling message at `write-audit.ts:129-130`), and the throttle's RGPD justification overstated what
an **unsalted** digest of a low-entropy identifier buys. Both now state the accurate claim.

**Unratified, and a human should look:** the shipped constants (`60 s · 5 · 30 · MAX_KEYS = 2×TIER2`) differ from the
story's own §1.4 draft (`10 min · 3 · 60 · =`). The shipped values were kept — their sizing argument is written against
a real scenario (a 200-parent onboarding evening ≈ 3.3 admissions/min, so 30/min leaves ~9× burst headroom) and tier 1
is sized for a **fumbling parent**, since guards run before the pipes and every 400 spends tier-1 budget. Every spec
references the constants **symbolically**, so no gate can go red for the numbers either way.
