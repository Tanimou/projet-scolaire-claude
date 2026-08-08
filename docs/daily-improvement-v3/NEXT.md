# NEXT — written by run 30 (`S-E04-2`), 2026-08-08

> Read this at Step 1. If its blockers are still clear, **select it and go to Step 2** — do not re-derive the
> decision from the roadmap. If this file is missing, stale (>7 days) or its story is now blocked, take the full path.

## ▶ Next story → `S-E04-3`

| | |
|---|---|
| **Story** | `S-E04-3` — The operator's real IP and User-Agent reach the API — or the field stays blank |
| **Epic** | `V3-E04` — Audit trail and governance surfaces |
| **Layer** | **L0** |
| **Size** | M · `[api][web][infra]` |
| **Gates** | `G-AUDIT` *(partial)*, `G-AUTHZ`, `G-DNC` *(DNC-10)* |
| **`G-MIGRATION`** | does **not** trigger |
| **blockedBy** | **nothing** — `S-E04-1` shipped `ADR-036`, which was its only blocker |
| **Contract** | `docs/spec/features/v3-e04/tasks.md` § `S-E04-3` — read it verbatim, it is the contract |

### Why this one

Selection rule 3 takes the first story in the epic whose `blockedBy` is empty. `S-E04-2` shipped, so the backlog's
two live candidates are `S-E04-3` (blocked by `S-E04-1` ✅) and `S-E04-4` (blocked by `S-E04-2` ✅). `S-E04-3` is
ordered first, and it also **gates more**: `S-E04-6` and `S-E04-8` both list it in `blockedBy`, while `S-E04-4` gates
only `S-E04-5`. Taking `S-E04-3` unblocks three slices instead of one.

### What `S-E04-3` must not get wrong

`ADR-036` already pins the hop count (`N = 2` prod / `N = 0` local) — do **not** re-litigate it. The trap the
contract names twice is that an **honest blank beats a plausible value**: the chain is
browser → Next server action → the `apps/web` server-side `fetch` (which forwards only `Accept`, `Content-Type`,
`Authorization`) → nginx → API, so today's stored value is the **web container's own address, identical for every
actor forever**, and `sanitiseInetOrNull` cannot catch it because a proxy IP *is* a valid inet. If the topology
cannot be confirmed, `AC-8` is satisfied by `null` plus a UI that says so — never by a value that looks right.
Forward from **one** seam in `apps/web` (the shared api-client / server-action fetch helper), never per call site.

### Two things run 30 hands it directly

1. **`PF-124` is on its path.** The admin login page's « Mot de passe oublié ? » link carries
   `redirect_uri=http://localhost:**3100**/admin/login` while the stack serves `:3000`. Owner is `V3-E05`, so
   `S-E04-3` should **not** fix it — but it is the same `apps/web` env-drift family, and whoever opens that seam
   will see it.
2. **Expect a slow login.** `PF-125`: the credentials round-trip took ~30 s locally against a ~1 s Keycloak. Budget
   for it; do not read it as a hang.

---

## ⚠️ Read this before trusting any `/admin/audit` screenshot

**`S-E04-2` fixed the render crash in source, and the running `web` container does NOT have the fix.** The rebuild
failed on `PF-126` (below), so `pilotage_web` still serves the image built 34 h earlier. Anyone loading
`http://localhost:3000/admin/audit` today will still get **HTTP 500 / digest `2236692779`** — that is the **old
bundle**, not a regression and not a failed fix. The source-level fix is in `main`:
`apps/web/src/app/admin/audit/audit-labels.ts`.

**This is the one `pending-verification` item this run leaves.** It is discharged by the second render, which needs a
working `web` image.

---

## 🔴 SWEEP CANDIDATE — but it is blocked on `PF-126`, so read this first

Appendix A says a sweep is due when pending evidence accumulates. **Do not schedule one until `PF-126` is fixed**: a
sweep's whole mechanism is one `docker compose build` + `--force-recreate`, and that build is exactly what is broken.
A sweep run today would burn ~10 minutes and discharge nothing.

**`PF-126` in one line:** `docker compose build web` fails after 571 s at
`next/font error: Failed to fetch \`Inter\` from Google Fonts` — **and the two obvious explanations are already
falsified**: the host fetches that URL with `200`, and so does a bare `docker run --rm alpine`. So do not re-test
connectivity; the fault is specific to the BuildKit stage. Fix direction is `next/font/local` (vendor the font, make
the build hermetic), which is a `V3-E02` gate/build concern and a visual decision — not something to bolt onto an
audit slice.

---

## Findings raised by run 30 and still open

| Finding | Owner | One line |
|---|---|---|
| `PF-124` | `V3-E05` | admin login « Mot de passe oublié ? » `redirect_uri` points at `:3100`; the stack serves `:3000` |
| `PF-125` | `V3-E05` | credentials login ~30 s locally vs ~1 s for a direct Keycloak grant — measurement, **no diagnosis offered** |
| `PF-126` | `V3-E02` | the `web` image cannot be rebuilt: `next build` needs Google Fonts at build time; blocks every sweep |
| `PF-127` | `V3-E02` | the link gate only checks published→emitted, never emitted→published, so an orphaned page is green by construction (`PF-119` was invisible to it the whole time) |

## Still open from run 29 — untouched, and `S-E04-2` was not their owner

`PF-121`, `PF-122`, `PF-123` all belong to `S-E04-7`. `S-E04-2` looked at the read side it was handed (the
`where: { portal: { not: null } }` facet vs the exact-match filter at `analytics.service.ts:3246`, which leaves a
`null`-portal row offered by **no** filter value) and **deliberately did not touch it** — it is `S-E04-4`/`S-E04-5`
scope, and editing the audit read path was out of scope for a slice whose contract is a render verdict plus a
navigation entry. `PF-123`'s rows remain unreachable by any filtered review.

---

cleanup-pending: C:\Users\HP\Downloads\pilotage-scolaire-claude\.claude\worktrees\stoic-allen-b8284b

> Step 0.5 D: run 30 executed inside that worktree and could not delete the ground it stood on. Apply the three
> Step 0.5 C tests (not mine · clean · merged or no open PR) and remove it, then clear this line.
>
> **Two other directories, and they need different handling — do not treat them alike:**
>
> 1. `…\.claude\worktrees\inspiring-mclaren-a76c8e` — run 30 **did** discharge run 29's handoff at the git level:
>    it is deregistered (`git worktree list` no longer shows it) and its branch is merged. But
>    `git worktree remove --force` and `Remove-Item -Recurse -Force` both failed with **Permission denied / file in
>    use** — a process outside this session holds a handle on it. Nothing in git points at it any more, so it is
>    **inert leftover bytes**, not a worktree. Delete the directory when the holding process is gone; no git command
>    is needed.
> 2. `…\.claude\worktrees\youthful-chaum-6aad5c` is **dirty** (a large set of staged deletions under `docs/`). The
>    hard rule forbids removing a dirty worktree — a human decides what that work was. Leave it. Run 29 said this
>    and it is still true.
