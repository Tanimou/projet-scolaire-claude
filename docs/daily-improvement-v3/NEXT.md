# NEXT — written by run 35 (`S-E04-7`), 2026-08-09

> Read this at Step 1. If its blockers are still clear, **select it and go to Step 2** — do not re-derive the
> decision from the roadmap. If this file is missing, stale (>7 days) or its story is now blocked, take the full path.

## ▶ Next story → `S-E04-9` *(new — resolve `PF-163` before the chain is built over it)*

| | |
|---|---|
| **Story** | `S-E04-9` — The invite path stops trading an account for an audit row *(story file to be written; the contract is `PF-163`'s row in `OPEN.md`, which states both acceptable resolutions)* |
| **Epic** | `V3-E04` — Audit trail and governance surfaces |
| **Layer** | **L0** |
| **Size** | **S** if you take resolution (b), **M** if you take (a) |
| **Gates** | `G-AUDIT`, `G-TENANT`, `G-DNC` · **`G-MIGRATION` does not trigger** |
| **blockedBy** | **nothing** |

### Why this and not `S-E04-8`, when `S-E04-8`'s blockers are now all satisfied

`S-E04-8`'s `blockedBy` (`S-E04-3`, `S-E04-6`, `S-E04-7`) **is** fully discharged, and the panel recommended it next.
The routine is overriding that recommendation deliberately, and the reason is the epic's own ruling rather than a
preference: **`plan.md` §2 says the chain goes last because a chain computed over provenance that is not yet true is a
cryptographically verifiable record of falsehoods.** `PF-163` is a **P1** in which a rolled-back audit write can now
leave an enabled Keycloak identity with no `UserProfile`, whose next login self-provisions it into `DEMO_TENANT_SLUG`
with realm-derived permissions — the `ADR-002` invariant, broken. Chaining over that is precisely the shape the ruling
forbids. Routine triage also says it plainly: **a discovered P1 becomes a story in the current layer, now.**

**This is one run's judgement call, made because the routine may not ask.** If you disagree, `S-E04-8` is selectable
the moment `PF-163` is either fixed or consciously accepted in `open-decisions.md` — but do not simply skip past it.

### The cheap resolution is real, and it is (b)

`PF-163`'s row states both. **(b) is mechanical and honest**: drop `invite.controller.ts` back out of the sweep,
baseline it under `best-effort-post-commit` with `PF-163` as its owning finding, and move the arithmetic from
**10 + 17 = 27** to **9 + 18 = 27** in `scripts/audit-write-baseline.json`'s `$doc` and in
`audit-write-gate.spec.ts:577`/`:584`/`:612-621`. **⚠️ It is blocked on `TOOL-01`** (below): the check resolves finding
ids against `audit-findings-index.md`, which stops at `PF-133`, so a baseline row owned by `PF-163` **will be refused
by the gate** until the index is extended. Extend the index first — that ordering is the whole point of recording it.

**(a) compensates instead**: delete or disable the freshly created `kcUserId` when the transaction aborts, and/or let
step 1 repair a Keycloak account that has no local profile. Better product behaviour, more work, and it changes an
identity path — so if you take it, take it as its own slice and do not fold it into a baseline edit.

Either way, the artefact that would have caught this is missing and should land with the fix: there is **no
`invite.controller.spec.ts`**. It needs a fake `$transaction` that **stages then commits**, so that a callback throw is
*observably* not persisted — the AC-10 evidence for this site today is a regex over the controller's source text
(`audit-write-gate.spec.ts:1067-1068`), which is why three panels found it and no test did.

### Do `TOOL-01` first — it is five minutes and it gates the next two stories

`audit-findings-index.md` declares **133** ids (highest `PF-133`). The ledger cites **26** it does not:
`PF-134`…`PF-146`, `PF-148`…`PF-150`, `PF-153`…`PF-162`. Nothing is broken today — all 17 baseline rows cite `PF-31`
or `PF-121`, both declared, and `scripts/audit-write-check.js` genuinely reads the index (`:151`, `:459`) rather than
matching a shape. But the register is now the binding constraint on the mechanism it feeds. Append the 26.

---

## What `S-E04-7` shipped, so you do not re-derive it

**The arithmetic, and it is the headline: 27 = 10 converted + 17 baselined, 0 unaccounted for.** Walk root stated in
every artefact: `apps/api/src` + `apps/worker/src` + `packages/imports-core/src`, production `.ts`, excluding
`*.spec.ts` and the seam itself. **The contract's AC-1 "30" and run 34's "27 in `apps/api`" are both wrong** — the true
split is 25 in `apps/api/src` across 15 files + 2 in `packages/imports-core/src` + 0 in `apps/worker/src`. `ADR-035`
D9's file count and root were off the same way. Re-measure and state your root; do not inherit a number.

- **`scripts/audit-write-check.js` is the durable half** and is a **blocking** stage in **both** harnesses
  (`scripts/ci-gate.sh`, `.github/workflows/ci.yml`). Executed verdict:
  `AUDIT WRITE CHECK: PASS — 38 audit writes over apps/api/src + apps/worker/src + packages/imports-core/src:
  21 through the seam inside a transaction, 17 baselined with a reason and a resolving finding id, 0 unaccounted for`.
  One-way ratchet: it goes red on a new site, a moved site, a non-transactional first argument, a non-literal payload,
  a `try` around a seam call, **and on a stale baseline row**.
- **`PF-162` closed — and it would have shipped inert without a measurement nobody asked for.** Both vocabulary tables
  were `: readonly Entry[] = [ … ] as const`, and **the annotation wins**: `(typeof X)[number]['code']` resolved to
  `string`, so typing the seam against it would have produced a named type forbidding nothing. Both are now
  `as const satisfies readonly Entry[]`. Pinned in both directions by `@ts-expect-error` controls **plus** a positive
  control. `ADR-035` **D14**. **Do not "tidy" the `satisfies` back to an annotation.**
- **`PF-122` closed by deleting the wrong parameter, not by laundering it.** The `actor: 'parent' | 'admin'` argument
  is gone; provenance is derived at both controllers above the transaction. Routing `actorRole: 'admin'` — a value no
  Keycloak realm issues — through the canonical seam would have made a known-wrong provenance authoritative.
- **`PF-164`'s code half was applied by the routine at land** (three forwarders now take `AuditTransactionClient`).
  **Its durable half is not done:** `TRANSACTION_CLIENT_TYPE_NAMES` (`audit-write-check.js:276`) still whitelists the
  bare name, so a *new* unbranded forwarder still passes rule B, and no `@ts-expect-error` proves the fix can go red.
  Narrowing is blocked on `remediation.controller.ts`'s baselined forwarders, which legitimately use the bare type.
- **`PF-121` is not closed — it is now ratcheted**, baselined under `cross-package-seam`. A path SKIP was refused
  deliberately: a skip is invisible, a baseline row is reviewed and one-way. Note the gate distinguishes **off-seam**
  debt from **un-transacted** debt; these two are the former.
- **Untouched on purpose, and still registered:** `PF-156` (P1, self-grant escalation) and `PF-153` — `roles.controller.ts`
  was swept and **who may grant what did not move** (`ADR-015`). `PF-149` was not carried: this diff enters no timezone
  path, and saying so beats ticking it. **Do not reintroduce a timezone fallback** — fail-closed is the design.
- **`PF-150`'s id collision is still unresolved.** `PROGRESS.md` uses `PF-150` for a different finding. Renumber in
  both files at once or not at all.

## ⚠️ The PR was NOT auto-merged, and the reason is evidence, not a red gate

The full gate's verdict line is in the PR body. The block is the **test panel's CONCERNS**: four `[auth]`-adjacent
conversions evidence fail-closed rollback **by regex over source text, not by an executed test**, and that gap is
exactly how `PF-163` reached three review panels without a single failing assertion. Two other named items —
`--help` exits 0 without measuring anything (not a live bypass: neither harness passes flags), and the AC-3 probe
writes `apps/api/src/shared/quality/__audit_write_probe.ts` and relies on `afterEach` to remove it, so a SIGINT
mid-run leaves the tree dirty and the next `ci-gate` red for an unrelated reason.

## Container-state facts that will otherwise waste your Step 2

1. **`pilotage_api` was NOT rebuilt this run** — unchanged from runs 32–34. It serves none of `S-E04-5`, `S-E04-6` or
   `S-E04-7`. Every claim above is evidenced by unit test, by the check script's own executed run, and by the full
   gate — **not** by the running API. Live write paths need one rationed rebuild of `api` only.
2. **The database is still ahead of the API container** (`tenant.timezone`). Safe, additive, expand phase as designed.
   `S-E04-7` added **no** schema change.
3. **`pilotage_web` still serves an image from 2026-08-07.**
4. **`PF-126` still blocks every `web` image rebuild** (`next build` in BuildKit cannot fetch `Inter`). Both obvious
   explanations are already falsified. **Do not re-test connectivity.** Fix direction is `next/font/local`; owner `V3-E02`.
5. **A sweep is still not schedulable**, for the same reason runs 30–35 gave: its mechanism is one
   `docker compose build` + `--force-recreate`, and the `web` half of that is what is broken.

## Still open from earlier runs, untouched by run 35

`PF-142`, `PF-146` (`V3-E02`) · `PF-145` **P1** (`V3-E05`) · `PF-124`…`PF-127` · `PF-148` (a11y) ·
`PF-136`, `PF-140` **P1**, `PF-141`, `PF-154`, `PF-155`, `PF-157`, `PF-158`, `PF-159`, `PF-160` — all still pointed at
`V3-E04` and none carried this run; the diff was at its reviewable ceiling on the seam+ratchet axis alone.
`PF-123`'s write half is **still open** at `assessments.controller.ts` for every site except `assessment.publish`.

`PF-129` and `PF-133` remain the **same missing artefact**: no web-side quality gate and no web unit runner
(`apps/web` has Playwright only — also `PF-100`'s blocker and part of `VAL-08`). Build them together.

---

cleanup-pending: C:\Users\HP\Downloads\pilotage-scolaire-claude\.claude\worktrees\clever-haibt-fff645

> Step 0.5 D: run 35 executed inside that worktree and could not delete the ground it stood on. Apply the three
> Step 0.5 C tests (not mine · clean · merged or no open PR) and remove it, then clear this line.
>
> **Run 34's handoff (`vigorous-cannon-d1d65a`) is discharged at the git level**, along with `dazzling-agnesi-18e92e`,
> `heuristic-colden-be6224`, `sweet-euler-fdad66` and `sweet-lichterman-b7c1b7` — all five were clean and merged, all
> five deregistered. `git worktree list` now shows only the main checkout, the unrelated `.codex` one, and this run's.
> As in runs 31–34, **every one reported *"Permission denied"* on the directory delete**: inert leftover bytes, not
> worktrees. No git command is needed — delete them when the holding process is gone. Same for the nine directories
> run 34 listed.
>
> Unchanged and still requiring a human, said now by runs 29–35: `laughing-wing-54e738` is unregistered but **not
> empty** (~1.4 MB) — unreachable *and* unattributable, so it is not deleted. `youthful-chaum-6aad5c` is **dirty**
> (staged deletions under `docs/`); the hard rule forbids removing it.
>
> **Remote `ci/*` branch deletion stays denied by the permission classifier** (`git push origin --delete`), for the
> fourth run running. All 38 merged remote `ci/*` branches back no open PR and are safe to delete whenever the
> permission allows. Local deletion is permitted; only the remote push is not.
