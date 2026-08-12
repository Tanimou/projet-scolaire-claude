# NEXT — track **b** (authz & audit) · written by run 40 (`S-E05-11`), 2026-08-12

> Read this at Step 1. If its blockers are still clear, **select it and go to Step 2** — do not re-derive the decision
> from the roadmap. If this file is missing, stale (>7 days) or its story is now blocked, take the full path.
>
> Track b's seam (`tracks.md`): `apps/api/src/shared/auth/**` · `apps/api/src/modules/identity/**` ·
> `apps/api/src/modules/audit/**` · guards, DTOs and permission code in other `apps/api` modules.

## ▶ Next story → `S-E05-7` — throttle the public registration funnel (`PF-46`)

| | |
|---|---|
| **Story** | resolve **`PF-46`** — `POST /auth/register-parent` is unauthenticated **and unthrottled** |
| **Epic** | `V3-E05` |
| **Layer** | **L0** |
| **Size** | **M** |
| **Gates** | `G-AUTHZ`, `G-AUDIT`, `G-DNC` · **`G-MIGRATION` does not trigger** unless you choose a DB-backed counter — prefer one that does not, since `prisma/**` is **track a's seam** |
| **blockedBy** | **nothing** — but read the amplification note below before scoping |

**Why this one, and why now rather than later.** `S-E05-11` (this run) just made every *failed* registration cost strictly
more: the handler now performs `createUser` + `setUserPassword`, and on a rolled-back transaction a compensating
`deleteUser`, so an anonymous caller can drive **three Keycloak admin round-trips per request** on an endpoint with no
rate limit at all. That is not a defect introduced by `S-E05-11` — fail-closed with compensation is the correct shape,
and the alternative was leaving orphans — but it **raises `PF-46`'s priority from hygiene to the obvious next move**, and
the amplification is registered in the `ADR-035` `S-E05-11` amendment rather than left to be discovered under load. The
same endpoint is also the enumeration surface: step 2's 409 and the new `P2002` 409 are now deliberately
indistinguishable, which closes the oracle but does nothing about the *rate* at which it can be probed.

**Both halves are in your seam.** The endpoint is `apps/api/src/modules/identity/register.controller.ts`; a guard or
interceptor belongs under `apps/api/src/shared/auth/**`. Prefer an in-process limiter over a schema change — a DB-backed
counter would put you in **track a's** `prisma/**` seam and trigger `G-MIGRATION` for what is an authz concern.

**Watch the conventions this module already fixed in place.** `writeAudit` must stay **one unconditional statement with
an inline object literal** (`ADR-035` D1) — `scripts/audit-write-check.js` and the vocabulary gate resolve `action` and
`resourceType` from the call-site AST. Use an early return above it, never an `if` around it. And **DNC-10**: a rate
limit configured by `process.env` with an "off" value is an off switch; if a limit must be tunable, make absence mean
*the strictest setting*, never *disabled*.

**Second candidate if `PF-46` turns out to be scoped elsewhere:** `PF-175` (P2) — pre-ceiling escalated grants pass the
new ceiling unconditionally; the detection query is recorded in `S-E05-2`'s notes but has **never been run**. It is
squarely in your seam, needs no decision, and is a genuine "prove the fix is complete" slice.

**Still blocked, do not select:** `S-E05-2b` / `PF-09` residual and `PF-178` both need **`D-12`** (a human product call
in `open-decisions.md`). `PF-153` needs `ADR-013`; until it lands, the unfiltered role lookup at `users.service.ts:85`
**must stay unfiltered** and its docblock at `:67-72` must stay. `PF-174` and `PF-129`'s fix are **`apps/web` = track
c's seam** — not yours.

---

## What `S-E05-11` shipped, so you do not re-derive it

**`PF-166` closed.** `POST /auth/register-parent` — the product's ONE unauthenticated account-creation path — now writes
its `tenant.upsert`, its `userProfile.create` and one new `user.register` audit row inside a **single** `$transaction`
extracted into `persistRegisteredParent`, with both Keycloak calls outside and before it and a `.catch()` compensation
deleting the identity this request created. That is `S-E04-7` + `S-E04-9` applied at their last address; nothing was
invented.

- **The method extraction is required, not stylistic.** Rule B of `scripts/audit-write-check.js` reddens on a `try`
  anywhere among a `writeAudit` call's AST ancestors, **function boundaries included** — so the transaction cannot live
  in the same function as the compensation's `catch`.
- **`after` is an explicit allow-list, never a spread.** `RegisterParentDto` carries a plaintext `password`, and this row
  is rendered on `/admin/audit` **and** exported by `audit-csv.generator.ts`. A `{ ...body }` would have written a
  credential into an append-only exportable governance table in the very slice whose justification is governance.
- **One vocabulary entry**, `{ code: 'user.register', label: 'Auto-inscription d’un parent' }`, deliberately **not**
  `critical: true`: `AUDIT_CRITICAL_ACTIONS` feeds `/admin/audit`'s "Modifications critiques" counter, and routine public
  signup traffic would drown the `role.*` events that counter exists to surface.
- **Two observable deltas, stated not absorbed.** (1) `P2002` on `userProfile.create` now returns the **same 409** as the
  pre-existing-identity branch rather than a raw-Prisma 500 — necessary once the compensation removes the identity that
  used to make the retry 409 by itself, and it removes a driver leak that doubled as an enumeration oracle. (2)
  Fail-closed on a public funnel means `audit_log` unavailable ⇒ **no parent can register**. Both are in the `ADR-035`
  `S-E05-11` amendment.
- **The `demo` tenant upsert was deliberately left alone** (`PF-165`'s territory) — but its new cost is now written down
  in the docblock: unconditional, executed by every registration, and inside an interactive transaction it holds a row
  lock on the single `demo` tenant row for the transaction's duration, so concurrent signups serialise and a burst can
  hit Prisma's 5 s P2028, each failure paying a compensating `deleteUser`. The cheap hedge (`findUnique` first) is a
  behaviour change and belongs to `PF-165`.

## Findings this run

| Id | Pri | What |
|---|---|---|
| **`PF-129`** | **P1** ⬆ | **Escalated latent → LIVE by this slice**, exactly as its own text predicted. `apps/web/.../parent/register/actions.ts` never calls `clientProvenanceHeaders`, so the new audit row records a null (prod) or web-container (local) address. **API side is already correct** — the fix is `apps/web`, **track c's**. |
| **`TOOL-06`** | **P0** ⬆ | **`ci-gate.sh` can never print `GATE: PASS`, for any diff, in any track.** Was P1. Read this before your gate run — see below. |
| **`TOOL-07`** | **P1** | **The background heartbeat loop outlives its session and pins a track forever.** Read this before Step 3 — see below. |

## 🛑 READ BEFORE YOUR GATE RUN — `TOOL-06` is now P0, and it will fail your PR too

**Do not go hunting in your own diff when the gate says FAIL.** Seven `run_stage` calls
(`scripts/ci-gate.sh:102,118,142,165,198,230,235`) omit the timeout argument, so `timeout` receives the stage *label* as
its interval and exits 125 before the command runs — `timeout: invalid time interval 'runtime engines'`, and six more.
They run **unconditionally, before the `── ci-gate (fast) ──` header**, so **every** invocation ends
`GATE: FAIL (7 stage(s))` however clean the tree.

Run 40 measured it on exactly such a tree: `production artefacts ✓ · audit writes ✓ · prisma generate ✓ · typecheck ✓ ·
lint ✓ (0 errors) · test:api 1021/1032 no drift ✓ · test:worker 293/300 no drift ✓`, and still `GATE: FAIL`.

**What to do:** run the gate, read the `✗` names. If they are exactly those seven, your diff is not the cause — say so in
the PR, paste the summary block, and **still leave the PR open and flagged** (AUTO-LAND keys on the printed line,
`R-23`, not on your judgement). **Do not fix it inside a story PR:** `scripts/` matches `GATE_MACHINERY` (`:322`), so
your diff would escalate `test:api` to the 2400 s whole-suite stage `TOOL-04` proves cannot finish.

Two corrections to `TOOL-06`'s own text, since you will read it: only **four** of the broken calls have duplicates that
run on a normal PR; `runtime engines` and `compose invocation` duplicate **only under `--full`**; and `csv escapers`
(`scripts/csv-escape-check.js`, the ratchet holding `PF-168` closed) has **no duplicate at all** and has therefore never
executed in CI.

## 🛑 READ BEFORE STEP 3 — `TOOL-07`, and it cost this run 22 hours

Step 3 prescribes a detached `while :; do … heartbeat; sleep 900; done`. **Nothing enforces Step 7 when the session never
reaches it.** This run's session was suspended for ~22 h after its sprint returned `landed: true`; the loop kept
refreshing track b's claim throughout, so `STALE_MIN=90` could never fire. `state/runs.log` shows
`GATE=BUSY all tracks claimed or blocked` at 08:40, 08:59, 09:00 (×3) and 09:07 on 2026-08-12 — **six consecutive ticks
lost** — until a cleanup at 09:34 committed the stranded tree to `salvage/2026-08-12-v3-b-E04-register-atomicity` and
released the claim by hand.

The heartbeat is an **anti-safety device in its current form**: it turns "this session died" from self-healing into
manual intervention, precisely in the case the reaper exists for. **What this run did instead, and recommends: skip the
background loop and call `routine-lock.sh heartbeat b` from your own tool calls at checkpoints.** It costs one cheap
command per checkpoint and cannot outlive you.

## ⚠️ Facts for your next run

1. **The sprint's escalation panel can fail on account limits and still return `landed: true`.** Four agents
   (`panel:security`, `panel:test`, `panel:architect`, `paige:pr`) died with *"You've hit your weekly limit"* on this
   run. `landed: true` means the implementing agents finished — **it is not a review**. This run reviewed the diff by
   hand and said so in the PR; do the same rather than treating the flag as a verdict.
2. **`TOOL-04` did not bite this run, and here is the rule.** The gate escalates to the whole api suite only when the
   diff matches `^(scripts/|\.github/|infra/|apps/api/src/shared/quality/)`. A diff confined to `apps/api/src/modules/`,
   `packages/contracts/` and `docs/` takes the 1200 s `--skip src/shared/quality/` stage instead. **Check your diff
   against that regex before you budget for the gate.**
3. **`origin/main` did not move for ~22 h** (still `c8ee4f3` at land). With tracks a and c also running, do not assume
   that; `git fetch` before you rebase-or-not.
4. **`packages/contracts/**` is unowned by any track.** One additive vocabulary line was safe here; a larger change
   there should be announced in the PR body per `tracks.md`.

---

cleanup-pending: `C:\Users\HP\Downloads\pilotage-scolaire-claude\.claude\worktrees\` residue — see run 38's `NEXT.md`
for the full list and the three tests to apply. Unchanged and untouched by runs 39 and 40. Additionally, this run left
`salvage/2026-08-12-v3-b-E04-register-atomicity` and `ci/2026-08-11-v3-b-E04-register-atomicity` in the track-b worktree
as backup pointers; both are safe to delete once this run's PR is merged.
