# V3-E05 — AuthN/AuthZ hardening and permission integrity

**Layer** L0 · **Size** L · **Depends on** — (may run in parallel with `V3-E03`; disjoint seams: guards/DTOs vs read projections) · **Blocks** nothing
**Owns** PF-07, PF-08, PF-09, PF-10, PF-11, PF-25, PF-26, PF-46, PF-51, PF-52, PF-53, **PF-102**, VAL-07 · **Gates** G-AUTHZ, G-TENANT, G-PORTAL, G-DNC
**Status (2026-08-11)** `in-progress` — **two slices landed**: `S-E05-12` (2026-08-07) and **`S-E05-2` (this run)**.
`S-E05-2` was authored and implemented in the same run: its story
[`stories/S-E05-2.md`](./stories/S-E05-2.md) **is** the authoring pass this file used to say was missing. The remaining
nine (`S-E05-1`, `S-E05-3` … `S-E05-11`) still exist as **rows in
[`docs/daily-improvement-v3/traceability-matrix.md`](../../../daily-improvement-v3/traceability-matrix.md) only** —
`docs/daily-improvement-v3/stories/sprint-01.md` enumerates no `S-E05-*` story, so none of them is implementable
without an authoring pass of its own.
**Next slice → `S-E05-2b` — the `realmRole` invite channel, the fifth grant path this slice deliberately left open.**
See "Next run" below.

*(Corrected 2026-08-11, `S-E05-2` land pass. Lines 5-12 used to read "`S-E05-12` … is the only one with a written
story" and "**Next slice → not in this epic** … nothing in this epic is enumerated". Both were falsified by the diff
that carries this edit — `S-E05-2.md` §0.4 names the contradiction and overrides it rather than obeying it. Named here
rather than silently overwritten: a status line the next autonomous run reads at Step 1 is exactly the kind of stale
truth that makes it skip work that is ready.)*

> **Why there is no `spec.md` here.** Same posture as
> [`docs/spec/features/v3-e02/PROGRESS.md`](../v3-e02/PROGRESS.md) and
> [`docs/spec/features/v3-e06/PROGRESS.md`](../v3-e06/PROGRESS.md): V3 stories are authored **pre-sliced**, carrying
> acceptance criteria, a stated test and an explicit out-of-scope list — they already hold what a `spec.md` + `tasks.md`
> pair would. The epic contract lives in
> [`docs/daily-improvement-v3/roadmap.md`](../../../daily-improvement-v3/roadmap.md) (§`V3-E05`). This file is the
> epic's status ledger; per-slice specs live in `stories/`.
>
> *(This file was created by the `S-E05-12` land pass, 2026-08-07. `S-E05-12.md` §0.1 justified shipping without it by
> citing `v3-e06` as precedent for "`PROGRESS.md` + `stories/`" — which **includes** the file it was omitting. Named
> here rather than quietly fixed, because a self-refuting justification in a story header is exactly the kind of claim
> the next autonomous run reads at Step 1 and believes.)*

**Objective.** The authentication and authorisation surfaces stop being trusted by assertion. Every wall this epic owns
is either proven by an executed test or recorded, with an owner, as not proven.

## Slice status

| Story | Title | State | Run | Evidence |
|---|---|---|---|---|
| **S-E05-12** | The post-authentication redirect target becomes same-origin-only, on all four portal login forms | ⚠️ done — **needs human review** | 2026-08-07 | spec: [`stories/S-E05-12.md`](./stories/S-E05-12.md) · **`PF-102` closed**, `PF-103`'s `PORTAL_LANDING`-declared-twice note retired, no new finding raised · evidence below |
| S-E05-1 | Global custom roles are cross-tenant (`PF-08`) + `VAL-07` | ⬜ unenumerated | — | matrix row only — no story in `sprint-01` |
| **S-E05-2** | **The privilege ceiling: no grantor may mint, rewrite or assign a permission they do not themselves hold** (`PF-09`, `PF-156`) | ⚠️ done — **needs human review** | 2026-08-11 | spec: [`stories/S-E05-2.md`](./stories/S-E05-2.md) · **`PF-09` narrowed to 4 of 5 grant channels, NOT closed** (the `realmRole` invite channel stays open — see evidence below) · `PF-156` closed with its `isSystem` remedy **declined and argued** · `ADR-015` gains its first `D<n>` amendment; `ADR-035`'s "we do not change who may grant what" posture marked SUPERSEDED · raises the `S-E05-2b` residual set · evidence below |
| S-E05-3 | Coefficient-matrix foreign-tenant write (`PF-10`) | ⬜ unenumerated | — | matrix row only |
| S-E05-4 | Notification dedup is not tenant-scoped (`PF-11`) | ⬜ unenumerated | — | matrix row only |
| S-E05-5 | Attendance reads without ABAC (`PF-07`) | ⬜ unenumerated | — | matrix row only |
| S-E05-6 | Unvalidated PATCH / query params / enum (`PF-51`) | ⬜ unenumerated | — | matrix row only; `S-E06-6` fixed **one DTO** of this family |
| S-E05-7 | Public unthrottled registration (`PF-46`) | ⬜ unenumerated | — | matrix row only |
| S-E05-8 | Wrong password reported as "MFA required" (`PF-25`) | ⬜ unenumerated | — | matrix row only |
| S-E05-9 | Logout / `session.error` / nine phantom auth routes (`PF-26`, `PF-91`) | ⬜ unenumerated | — | matrix row only; `PF-91` is inventoried in `scripts/link-integrity-baseline.json` by `S-E06-3` |
| S-E05-10 | Unused `hasPermission`, `users.suspend` unimplemented (`PF-52`) | ⬜ unenumerated | — | matrix row only |
| S-E05-11 | Non-atomic invite/permission rewrite, catalogue drift (`PF-53`) | ⬜ unenumerated | — | matrix row only |

---

## S-E05-2 — evidence (2026-08-11)

### What the slice changed

**One new predicate, four grant paths, zero new endpoints.** `apps/api/src/shared/auth/privilege-ceiling.ts` (NEW,
180 L) holds a pure `exceedsGrantor(grantorSet, requested): string[]` and its throwing wrapper
`assertWithinCeiling`. No `@Injectable`, no Nest module, no Prisma import, no barrel, no env read, arity pinned at 2 —
the same seam shape as `shared/audit/provenance.ts` (`ADR-035` D4). The grantor's set is derived **at the controller**
from `UserSyncService.effectivePermissions(jwt.sub, jwt.realm_access?.roles ?? [])` — the identical seam
`PermissionsGuard:27-28` reads — and never re-unioned inside a service.

| Grant path | Where the ceiling runs |
|---|---|
| `roles.controller.create()` | after the `Permissions inconnues` 400, **before** `$transaction` |
| `roles.controller.update()` | after the `isSystem` refusal, **before** `$transaction`; the catalogue check is **hoisted out of the transaction** so one unknown code answers **400 from both handlers** instead of 400/403 |
| `users.service.assignRole()` | before the idempotent early-return **and** before `$transaction`; `grantorPermissions` is a **required** 6th parameter, so an omission is a compile error and never a silently empty (then "conveniently" defaulted) set |
| `invite.controller` `customRoleSlug` | resolved in `invite()` step 1b, **before** the Keycloak identity exists, so a refusal needs no compensation |

Every refusal precedes its transaction, so it writes no entity row and no audit row; `writeAudit` is untouched and
rule B of `scripts/audit-write-check.js` stays green. The 403 body is byte-shape-identical to the one
`permissions.guard.ts:31-35` already emits (`{ message, required, missing }`), and `message` stays a plain string
because `RoleBuilderForm.tsx:236` renders it directly as a React child.

Fail-closed was inspected, not assumed: `undefined`/empty grantor denies **everything**; an unknown code is denied
because the predicate never consults the catalogue; a non-array `requested` returns an opaque sentinel. The single
permit-on-empty (`requested === []`) is stated and pinned by test. There is **no `super_admin` role-name special
case** — `super_admin` is spared *structurally*, by `REALM_ROLE_PERMISSIONS.super_admin` already being the whole
catalogue. An `if (roles.includes('super_admin')) return []` would be a bypass wearing a role name.

### What executed

| Check | Result |
|---|---|
| `pnpm typecheck` (Murat, **once**) | **13 successful / 13 total**, exit 0. `@pilotage/api` was a **cache miss that executed** — the new files were really compiled |
| `git diff --check` and `git diff --check HEAD` | **exit 0**, clean, both |
| `tsc --noEmit` on `apps/api` directly (panel, bypassing turbo) | **green**. Run because `pnpm typecheck` first reported `FULL TURBO` replaying logs from sibling worktrees; `privilege-ceiling.ts` was untracked, so the input hash had never seen it. **Anyone re-running this gate must bypass the cache** |
| The five affected specs (panel) | **154 pass / 1 fail** — the failure is `audit-write-gate.spec.ts:995`, **inherited red on `main`** from the `ci-gate.sh` perf rewrite (`c141997`/`2bd1a25`), not this diff. Neither `ci-gate.sh` nor `ci.yml` is touched here |
| Mutation kill test (panel) | `exceedsGrantor` → `return []` killed **exactly 10 negatives, one per call site**, invite path included, positives green. This is what makes the coverage real rather than presence-shaped |
| Ratchet proven able to fail (panel) | a throwaway `__ratchet-probe.ts` with an unceilinged `userRole.create` turned the new **G-AUTHZ** gate red **and named the file**; probe deleted, tree verified clean |

**One gate row is NOT green and is not claimed as such.** `roles.controller.spec.ts` failed `apps/api#typecheck` on a
`noUncheckedIndexedAccess` widening at `:407` and was corrected (a literal-keyed `Record<'create'|'update', object>`
replacing an index-signature cast). The typecheck was re-run and is green. **No jest run has been observed on the
corrected file** — the earlier "4 suites / 79 tests" line predates that block, and `ts-jest` runs with diagnostics on,
so it could not have passed as written. `npx jest src/modules/identity/roles.controller.spec.ts` is a manual check in
the PR body, and it is the one piece of this slice's evidence that is asserted rather than executed.

### The load-bearing correction: the gate that could never have caught the next PF-09

`audit-write-gate.spec.ts` previously ratcheted `expect(roles).not.toContain('effectivePermissions')` — a deliberate
"this slice changed no authorisation" invariant from `S-E04-9`. The product has now reversed that posture, so the
ratchet was **amended, not deleted**, and the reversal is recorded in place in `ADR-035` rather than rewritten away.

The replacement's first draft still enumerated the three fixed files **by hand**, which is green by construction: it
protects the doors already closed and can never redden for the change that reintroduces the defect — a **fifth grant
path in a file the list does not name**. It now *discovers* its surface by walking the gate's own `WALK_ROOTS` for the
privilege-**creating** verbs (`userRole.create|upsert`, `rolePermission.create`, and the nested
`rolePermissions: { create` form) and requires each match to import the ceiling. Revoke (`updateMany`) is excluded
deliberately — a ceiling on *removing* privilege would trap an admin with a role they cannot revoke. It fails when the
walk finds fewer than 3 sites (DNC-08: never pass over an empty set), and the `UNCEILINGED` allowlist is empty, so an
exemption becomes a signed decision.

### `PF-09` is NARROWED, not closed — and that is the merge condition

Three independent reviewers reached the same finding, so it is recorded as the epic's status, not as a note:
`POST /users/invite` is gated only on `users.write` (weaker than `roles.assign`), `body.realmRole` accepts `teacher`
via `@IsEnum`, `REALM_ROLE_PERMISSIONS.teacher` carries `grades.revise` / `grades.write` / `attendance.write` /
`lessons.write` — none of which `school_admin` holds — and `body.email` is attacker-controlled. So the exact
escalation this slice closes on `customRoleSlug` survives verbatim on `realmRole`, one email of friction later.

That is left open **by decision**, and the decision is defensible: applying a subset ceiling there would refuse
"invite a teacher", the product's primary onboarding flow, and realm-role provisioning is a **delegation** question
(a grantor may provision at or below their own level), not a subset question. It is recorded in `ADR-015` D8.1 and in
the code at `invite.controller.ts:206-214`.

What is **not** defensible is the label. `ADR-035`'s superseding note and the `ADR-015` amendment front-matter both
book `PF-09` as *fermé*, unqualified. **The traceability matrix must record `PF-09` as narrowed (4 of 5 channels) with
the realm-role residual allocated a real finding id**, or a future auditor reading only `ADR-035` inherits a false
all-clear on a P0 `BROKEN_SECURITY` row. That correction is a land-pass task and is called out in the PR body.

### The product regression this slice ships, and the FE half it cannot fix

Measured against `seed.ts`'s `ROLE_PERMISSIONS` (the rows the ceiling actually reads), a `school_admin` can no longer
assign the seeded **`teacher`** (5 exceeding codes), **`parent`** (3) or **`student`** (5) roles. `school_admin` →
`school_admin` (0 exceeding) still works. This is structural, not a bug: the role-narrowed permission families
(`*.read.self`, `*.parent`, `*.teacher`) exist precisely so no admin holds them, so a subset test will always refuse
cross-audience grants.

The backend fails **closed**, which is right. The front end swallows it, which is not:
`apps/web/src/app/admin/users/actions.ts:7-10` has no `catch` and returns `void`, and
`apps/web/src/app/admin/users/UsersTable.tsx:30-39` is `try … finally` with no `catch` — so the new 403 lands as an
unhandled rejection: spinner stops, menu closes, no message, `router.refresh()` never runs. `UsersTable.tsx:115` also
still offers all four seeded roles from an unfiltered `GET /roles`, three of which now always fail. Contrast
`admin/roles/actions.ts:24-31,44-50`, which *does* catch `ApiError` and surface `body.message`, so the identical 403
on role create/update is shown correctly.

`apps/web` is outside this track's owned paths, so this is raised as a **blocking FE-track finding**, not absorbed:
align `assignRoleAction` with `admin/roles/actions.ts`, render `missing`, and filter the dropdown against the
caller's effective set. Recorded in `ADR-015` D8.7.

### Gates — every row answered, none blank

| Gate | Triggers? | Why |
|---|---|---|
| **G-AUTHZ** | **YES — primary** | Four grant paths, one predicate; the mutation kill (10/10 negatives, one per site) is what proves the negatives measure *this* guard and not an older `isSystem`/cross-tenant one; the new directory-walking ratchet was driven red by a probe |
| **G-DNC** | **YES (always)** | DNC-10 intact — no env read, no options bag, no bypass flag, `assertWithinCeiling.length === 2` asserted. DNC-08 — the ratchet refuses to pass over an empty walk (floor of 3 sites) |
| **G-AUDIT** | **YES** | Every refusal precedes its `$transaction`, so no partial write and no orphan audit row; `writeAudit` untouched, `audit-write-check.js` rule B green. **Residual**: a refusal writes no audit row and only an actor-less `logger.warn` (D8.3) |
| **G-TENANT** | **YES — verified, not assumed** | Net-restrictive everywhere; no new cross-tenant read. `PF-153` (the role lookup unfiltered by tenant) is untouched and explicitly still open, marked in-place at `users.service.ts` |
| **G-MIGRATION** | **NO** | `schema.prisma` untouched, no migration, no new dependency |
| **G-TRUTH** | **NO** | No KPI, read projection or dashboard figure |
| **G-PORTAL** | **NO** | Backend-only; the FE consequence is raised as a finding, not implemented here |

### Not claimed by `S-E05-2` — queued with an owner, not silenced

| What is NOT claimed | Detail | Owner |
|---|---|---|
| **`PF-09` is closed** | The `realmRole` invite channel is unceilinged and reproduces the escalation. `ADR-015` D8.1 states it honestly; `ADR-035`'s note and the amendment front-matter do not. Matrix must say **narrowed** | `S-E05-2b` |
| **Grants that escalated BEFORE this slice are evicted** | The ceiling compares against `effectivePermissions`, which unions custom-role permissions — so an actor already holding a `PF-09`-minted role passes it *unconditionally* and can keep minting. Detection query, not a migration: non-system roles carrying any code outside `REALM_ROLE_PERMISSIONS.school_admin`. **Run it before calling `PF-09` anything at the deployment level** | `S-E05-2b` (D8.2) |
| **A refused escalation is attributable** | No audit row (correct — nothing happened, and a `writeAudit` outside a transaction breaks `ADR-035` D1), and the compensating `logger.warn` lives *inside* the predicate, so it carries no `jwt.sub`, no tenant, no IP — even though `deriveAuditProvenance` has already produced them at all four call sites. The fix needs **no** signature change: catch at the call site, log there, rethrow. Worse under D5 — ordinary refused `teacher` assignments will dominate the same warn stream, so it is not alertable as written | `S-E05-2b` (D8.3) |
| **The ceiling constrains narrowing, revoking or deleting** | It is one-directional by design: any subset passes, so a `roles.write` holder can strip or wipe a role that carries codes above their own ceiling — and then cannot restore it (403). `revokeRole` and `remove()` gained no ceiling. Accepted as *désescalade* in D3; the **irreversibility** is not recorded there and should be | `V3-E05` follow-up |
| **`update()` checks the ceiling on a rename** | When `body.permissionCodes` is absent no check runs — correct (a rename grants nothing) and currently unreachable from the shipped UI (`RoleBuilderForm.tsx:132-135` always sends the field). Dormant and documented | scope note |
| **The invite hoist preserves every prior behaviour** | D7 says the unresolvable-slug no-op is "préservé verbatim". True for a slug that never resolved; **not** for one that resolves and is then deleted before the transaction — that used to be a silent no-op and is now an FK violation → rollback → Keycloak compensation → 500. Window is tiny (`remove()` refuses to delete an assigned role) and the direction is fail-closed, but D7's list is missing it | `V3-E05` follow-up |
| **A duplicated permission code reaches the ceiling** | Both handlers compare `resolved.length !== body.permissionCodes.length`, so `['x','x']` answers **400 `Permissions inconnues` with `missing: []`** — naming no code at all. Pre-existing in `create()`, copied verbatim into the new `update()` block. Consequence: `exceedsGrantor`'s de-duplication is unreachable from any HTTP call site and is only unit-asserted | `V3-E05` follow-up |
| **The story spec matches the code** | `S-E05-2.md` §2.3/§5 T-18/§9 still say "do not move" the `update()` catalogue check and pin an unknown code to **403**; the code hoists it and answers **400**. The divergence is right and better argued than the spec — but the two artefacts disagree, which is the `PF-164` shape this slice's own gate amendment exists to prevent. Reconcile the story, do not re-litigate the code | land pass / `S-E05-2b` |
| **`PF-153`** | Role lookup unfiltered by tenant — untouched, still open, marked in place | `V3-E05` |
| **A browser rendered anything** | No Playwright, no driven navigation, and `apps/web` is not edited. The D5 regression is proven by permission arithmetic and by reading the FE call sites, not by clicking | `VAL-08` |

---

## Next run

**`S-E05-2b` — close the fifth grant channel and make the refusal attributable.** It is the direct residual of this
slice and the only item on the list that is a live escalation path rather than a documentation or ergonomics debt.
Three things, one PR:

1. **The `realmRole` invite channel.** Not a subset ceiling (that refuses "invite a teacher") but a **grantor-relative
   ladder**: a grantor may provision a realm role at or below their own. Permits `school_admin → teacher|parent`,
   refuses `teacher → school_admin`. That is the §2.4 option-2 delegation decision and it needs its own `ADR-015`
   decision entry, so it is a slice and not a patch.
2. **Attribution.** Move the `logger.warn` from inside the predicate to the four call sites, where `jwt.sub`,
   `me.tenantId` and the provenance hints are already in hand. Predicate stays at arity 2.
3. **The label.** Record `PF-09` as narrowed in the matrix, allocate the realm-role residual a finding id, and correct
   the unqualified "closed" in `ADR-035`.

**Second candidate — the FE companion to D5**, on the `apps/web` track: catch `ApiError` in `assignRoleAction`, render
`missing`, filter the role dropdown against the caller's effective set. It ships no new capability, but until it lands
an admin's "assign teacher" click does nothing at all with no explanation.

**Third — the `S-E05-12` gate-coverage consolidation** (six residuals, entirely test-side) is unchanged in priority.

---

## S-E05-12 — evidence (2026-08-07)

### What the slice changed

Three files of production consequence, one of which is a spec:

- **`apps/web/src/lib/safe-callback-url.ts` (NEW, 100 L, 5 executable).** One pure, **import-free**, edge-safe
  `safeCallbackUrl(raw, fallback)`. Five-clause **allow-list**, no normalisation of any kind: the bytes validated are
  the bytes navigated, so no future normalisation step can open a gap between the check and the use. Same rationale and
  same shape as its neighbour `lib/portals.ts` (`S-E06-5`) — no new architectural decision, **no ADR owed**.
- **`apps/web/src/components/PortalLoginForm.tsx` (+11 / −13).** The read site (`:74`) is now
  `safeCallbackUrl(params.get('callbackUrl'), PORTAL_LANDING[accent])`. Validated **once, at the read**, so **both**
  sinks inherit one safe binding — `router.push` on the credentials branch and `signIn(…, { callbackUrl })` on the SSO
  one. A per-sink guard is a rule a third sink can forget. The local `DEFAULT_LANDING` map is **deleted**, retiring the
  fifth surviving copy of the four portal landing paths onto the single `PORTAL_LANDING`.
- **`apps/api/src/shared/quality/open-redirect-gate.spec.ts` (NEW, 971 L).** The executable guard. It lives beside 16
  sibling gates, three of which already assert on `apps/web` (`web-artifact-gate`, `web-observability-gate`,
  `portal-landing-gate`), because `apps/web` has no jest project and `ci-gate.sh` only runs `test-ratchet.js api|worker`.

**All four portals, one component.** `admin|teacher|parent|student/login/page.tsx` all render `PortalLoginForm`, so the
fix is four portals wide with no portal-conditional branch (**G-PORTAL**).

### What executed

| Check | Result |
|---|---|
| `pnpm typecheck` (Murat, **once**, main checkout) | **exit 0**, *"Tasks: 13 successful, 13 total"*, 3m36s. `@pilotage/web` **and** `@pilotage/api` both `cache miss, executing` — the three changed/new files were really compiled by `tsc`, not replayed from the Turbo cache |
| `git diff --check` | **exit 0**, clean. Re-run with `git add -N` on the two untracked source files so their whitespace was actually inspected, then `git reset` to leave the tree as found. Only output is the benign *"CRLF will be replaced by LF"* advisory |
| `npx jest src/shared/quality/open-redirect-gate.spec.ts portal-landing-gate.spec.ts` | **214/214 PASS**, 44.9 s — the new gate **and** the neighbour it moves from 6 to 7 `PORTAL_LANDING` consumers |
| The 37-row accept/reject matrix | **29 reject + 8 accept**, each driven through both the expectation **and** a differential origin oracle (`new URL(result, 'https://pilotage.example/parent/login').origin`). **0 failures, 0 leaks** |
| Whole-tree structural scan | **366 files** (floor 300) · **55** `router.push\|replace` call sites (floor 40) · **32** files reading `useSearchParams` · bare-identifier sink inventory = **exactly 3** · **offenders `[]`** |
| Parser-differential probe (Sentinel, independent) | 29 hostile inputs — `/<TAB>//evil`, `/<CR><LF>/evil`, `/<NUL>/x`, `/%5cevil`, `/%2f%2fevil`, `/..//evil`, `/@evil`, U+3000 / U+FEFF / U+200B variants, `/./\evil` — resolved against Node's WHATWG `URL`. **0 leaks** |
| Fails-before / passes-after, two ways | (i) a fixture reproducing the pre-slice `PortalLoginForm` lines **is reported as an offender** by the same scan that walks the tree, and the current file is not; (ii) the **briefed** rule fails on **exactly** R25/R26/R27 |
| Clause necessity | `noC0` → `[R25,R26,R27]` · `noSecond` → `[R5,R6,R7,R8]` · `noFirst` → `[R1..R4, R11..R14]`. Every clause has at least one input only it rejects — no dead clause |

### The load-bearing result: the fix the ledger recommended is itself exploitable

`audit-findings-index.md` proposed `raw.startsWith('/') && raw[1] !== '/' && raw[1] !== '\\'`. Measured against the
WHATWG parser with base `https://pilotage.example/parent/login`, **four inputs pass that rule and still navigate
off-origin**: `/<TAB>/evil.example`, `/<LF>/evil.example`, `/<CR>/evil.example` (all → `https://evil.example/`) and
`/<CR><LF>/evil` (→ `https://evil/`). Cause: the parser removes tab/LF/CR from **anywhere** in the string *before*
parsing, so `/<TAB>/evil.example` becomes `//evil.example` **after** the check has already passed it. The shipped rule
adds a fifth clause — **C0 rejected anywhere, not at position 1** — stated as "anywhere" on purpose, because a rule whose
safety depends on *where* the byte sits breaks the next time normalisation order changes. Both the briefed rule and its
three holes are pinned by test, so a future "simplification" of that clause says exactly what it lost.

The consequence for the ledger is why this land pass touches four tracking files rather than two: the recommendation
`audit-findings-index.md` carried was the **exploitable** expression, and the next autonomous run reads that file at
Step 1. It is corrected in the same commit.

### §7.3 — the one adjacent site, measured then recorded, **not** fixed

`NotificationListItem.tsx:56,59` pushes `link`, which is the same **sink** class as `PF-102` but a different **source**
(a `Notification` row field, not `searchParams`). Traced through the API before the PR was opened: **every** writer
composes a server-side literal or a literal template carrying a server-derived id — `alerts.service.ts:518,802`,
`announcements.controller.ts:612`, `child-claims.service.ts:679,695`, `enrollments.controller.ts:102`,
`assessments.controller.ts:345`, `lessons.controller.ts:129`, `messaging.service.ts:589` (→ `portalLink`, literal at
`:408,539`), `remediation.controller.ts:340,476,663,979,1074,1085`, `alerts-evaluator.service.ts:232`,
`remediation-sweep-cron.service.ts:163`, `notifications-digest-cron.service.ts:244,290`,
`parent-digest-cron.service.ts:221` — and **no** DTO, Zod schema or contract type accepts a `link` field on any request.
Latent, not live. **No finding was opened for it**: a finding without a defect is noise. *(This sentence used to name `PF-104`, the id then pre-allocated for this hypothetical. It was never taken for it — `PF-104` is run 24's stalled-job finding, and the readiness/lint one below is now `PF-112`. Annotated on 2026-08-08 by `S-E02-18` rather than rewritten, because a shipped ledger records what was believed at the time.)*. The measurement is pinned as a test
so it becomes false the day a request-supplied `link` appears.

### Gates — every row answered, none blank

| Gate | Triggers? | Why |
|---|---|---|
| **G-AUTHZ** | **YES — primary** | The executed 37-row matrix with the origin oracle; fails-before/passes-after two ways; the structural scan proven in **both** directions |
| **G-PORTAL** | **YES** | One shared component, four login routes proven to render it, no portal-conditional branch |
| **G-DNC** | **YES (always)** | DNC-10 tested structurally **and** by execution with six bypass env vars set singly and together; `safeCallbackUrl.length === 2` asserted on the executed function, so an options argument cannot hide from arity |
| **G-TENANT** | **NO** | Verified, not assumed: zero Prisma queries, zero `where`, zero `tenantId`, zero `StudentAccessService` path. The diff cannot leak a child's record because it never reads one |
| **G-MIGRATION** | **NO** | `schema.prisma` untouched; no migration added |
| **G-AUDIT** | **NO** | No privileged mutation, no `AuditLog` write, no endpoint |
| **G-TRUTH** | **NO** | No KPI, count, read projection or dashboard figure |

---

## Not claimed by `S-E05-12` — queued with an owner, not silenced

| What is NOT claimed | Detail | Owner |
|---|---|---|
| **`/api/auth/signin/*?callbackUrl=` is a SECOND, public entrance into this flow that this diff does not cover** | `middleware.ts:34` lists `/api/auth` in `PUBLIC_PREFIXES`; `auth.ts` declares **no `pages:` override and no `redirect` callback**, so next-auth's own signin page is live and its only same-origin clamp compares against a `baseUrl` derived from headers — with `auth.ts:291` `trustHost: true` and `infra/nginx/conf.d/pilotage.conf:43,52,67` (`listen 80 default_server; server_name _;` + `proxy_set_header Host $host`) that reference origin is **client-supplied on that path**. Not the same one-click chain `PF-102` was (a victim's browser will not forge its own `Host`) — it is the cache-poisoning / absolute-link class. The spec **records** the `trustHost` dependency and deliberately declines to assert it, because a gate that reddens on an improvement is a gate people delete. **Verify before calling the finding closed at the deployment level** (see the manual checks in the PR body); if it emits an off-origin `Location`, the fix is `pages: { signIn: '/<portal>/login' }` or pinning `server_name` at nginx, **not** another string rule | new finding, `V3-E05` |
| **The AC-5(c) regression scan is blind to PF-102 *minus the variable*** | `SINK` anchors on a **bare identifier** as the whole first argument, so `router.push(params.get('callbackUrl') ?? '/parent/dashboard')` — the same defect, inline — passes the gate. Driven against the shipped predicate: control CAUGHT, inline-read MISSED, one-hop alias MISSED, destructured read MISSED, server-component `searchParams.next` → `redirect()` MISSED; and the inline shape resolves to origin `https://evil.example`. The header **claims** the scan "closes the shape PF-102 actually is", and the inline read *is* that shape. A gate naming an invariant it does not hold is worse than no gate | next `V3-E05` slice |
| **The same `SINK` regex misses the two-argument and semicolon-free spellings** | Measured against the shipped regex: `router.push(callbackUrl, { scroll: false })` MISS, `router.replace(callbackUrl, { scroll: false })` MISS, the prettier-wrapped multi-line + trailing-comma form MISS, `location.assign(x)` without `window.` MISS, `window.location = x` MISS, `permanentRedirect(x)` MISS, `href = x` without `;` MISS. `push(href, options)` is a documented App Router API, so it is the shape a future contributor is most likely to write. **No such site exists in the tree today** (12 push/replace sites, none with a second argument), so this is a future-bypass hole, not a present miss — and the header's stated limits ("lexical", "single-file", "no cross-file dataflow") do **not** disclose it | next `V3-E05` slice |
| **`signIn(provider, { callbackUrl: <tainted> })` is not in the sink vocabulary** | The story itself names it as one of the two consumption points (FR-3), and the AC-3 assertion on it is the one **grep** left in an otherwise-executed suite (`expect(source).toContain('{ callbackUrl }')`) — a shorthand rename or a reformat passes the string check while the sink stops sharing the binding | next `V3-E05` slice |
| **A repeated `?callbackUrl=` is NOT a clause-1 fallback, and the module says it is** | `safe-callback-url.ts:76` states clause 1 rejects *"a repeated query parameter"*. Measured: `new URLSearchParams('callbackUrl=/parent/dashboard&callbackUrl=https://evil.example').get('callbackUrl')` returns the **string** `'/parent/dashboard'`, not `null` — `.get()` yields the first occurrence, so a repeated parameter never reaches clause 1. **Not a vulnerability** (the attacker-first ordering is rejected by clauses 2–5, both orderings land same-origin), but a false sentence inside a security module's own header is what a future editor trusts instead of re-measuring, and the 37-row matrix has no row for it | next `V3-E05` slice |
| **The exact-set sink inventory is a ratchet with no baseline file** | `open-redirect-gate.spec.ts:715-731` pins the inventory to three hard-coded rows across 366 files, and `:947-958` pins "exactly ONE file matches `useSearchParams` ∧ `router.push` ∧ `signIn(`" while `ParentRegisterForm.tsx` already matches two of the three. Every other ratchet in this repo externalises its ceiling with a reason **and** an owning finding per row (`link-integrity-baseline.json`, `web-route-baseline.json`); this one does not. A legitimate future `router.push(href)` reddens a P1 security gate with no documented escape but editing the spec | next `V3-E05` slice |
| **`packages/ui/src` is bundled into every portal and is NOT scanned** | The walk root is `apps/web/src`. `packages/ui` is consumed as **raw TS source** (project-context §1), so it compiles into all four portal bundles. Measured: 70 files, exactly one redirect sink (`Pagination.tsx:83`, pathname-rooted and safe today), 0 bare-identifier sinks, 0 offenders — extending the walk would keep the gate green, but it would also change the ≥300-file floor and the exact-set inventory, so it is deliberately not done here. The DNC-08 limits paragraph does not currently name the package boundary | next `V3-E05` slice |
| **`PF-103(d)` is retired as an instance, not as a class** | The finding asked to widen P-2 to *"no file outside `lib/portals.ts` contains two or more of the four literal landing paths"*. This diff deletes `DEFAULT_LANDING` and adds a `not.toContain` scoped to `PortalLoginForm.tsx` only. A sixth copy under a different identifier in a different file still passes both gates — the guard still measures the **name**, not the invariant | next `V3-E06` follow-up |
| **`PF-103` (a)(b)(c) are untouched** | The `'}'` JSX-comment mis-read, the tautological anti-drop invariant and the unbounded cross-product in `scripts/link-integrity-check.js`'s lexer remain open, in a **blocking** CI stage — and this security gate now `require`s that lexer's `stripCommentsPreservingLines`, so a stripper regression moves a security inventory. The unguarded `require` is the right call for DNC-08; the coupling is the note | next `V3-E06` follow-up |
| **No browser rendered any login page** | `apps/web` has no jest project and no Playwright test was written or run, so *"the redirect lands same-origin in a real browser"* is proven by a WHATWG-`URL` oracle in Node, not by a driven navigation. That crawl is `VAL-08` / R10 | `VAL-08` |
| ~~**`bash scripts/ci-gate.sh` was not run**~~ — **DISCHARGED by the routine (run 24)** | The sprint was right to leave this open and right not to claim it. Executed twice. **Pass 1: `GATE: FAIL (7 stage(s))`** — and all seven reduce to **one** root cause plus two load artefacts. `no-control-regex` is an ESLint **error** in this repository and `next build` runs ESLint, so the three control-character regexes this slice introduced (`safe-callback-url.ts:67`, `open-redirect-gate.spec.ts:554,556`) did not warn — they failed `lint`, `lint:warnings` and **`@pilotage/web#build`**, and with no `.next` emitted, `web artefact` and `link integrity` fell over behind it. One rule violation, four red stages. A fourth, separate problem: the new imports tripped `import/order`, putting `apps/web` at **35 against a ceiling of 34**. `boot` and `tracing` also failed, both on **timeouts** (`180s`, `ETIMEDOUT`) behind a 19-minute build; re-run standalone on the byte-identical tree they returned `BOOT CHECK: PASS` (229 routes, unchanged) and `TRACING CHECK: PASS` — so they were machine load, not this diff. That was **measured, not assumed**, because "it was probably flaky" is how a real defect gets waved through. **Pass 2: `GATE: PASS`, exit 0, every stage.** The fixes are at the right layer and none is a gate weakening: the C0 test became a code-unit scan in **both** files (an `eslint-disable-next-line` was the other option and was rejected — the rationale is in `safe-callback-url.ts`; the 37-row matrix still returning **214/214** afterwards is what proves the two forms equivalent, so the rewrite is falsifiable rather than merely plausible), and the import was **reordered**, not re-baselined — `lint-ratchet: 44 warning(s) total · 44 allowed · no drift`, ceiling untouched (the `S-E06-6` precedent) | ✅ done |
| **The sprint returned `landed: true` on a tree whose `lint` was red** | Recorded as **`PF-112`** rather than shrugged at *(filed as `PF-104`; renumbered 2026-08-08 by `S-E02-18` — that id was already run 24's stalled-job finding)*. Readiness runs `typecheck` (13/13) and the two targeted suites, and **neither can see a lint error** — so an agent cannot know it has broken the web build, and `typecheck` green reads as "safe to land" when it is not. Same family as **`PF-80`** (`landed: true` on a tree the full gate failed), different missing stage: that one wants `test-ratchet.js` in readiness, this one wants `lint-ratchet.js`. Both are additions to `bmad/workflows/sprint.workflow.js`, which is the routine's own file — so it belongs in a routine slice, not this one | `PF-112` *(was `PF-104`)* |
| **`PF-102` is closed in code, not on the deployment** | Nothing here rebuilds or redeploys anything. Per `SKILL.md` Step −1 the hosted VPS is an audit fixture rather than a deployment target, so this is a statement about scope, not an outstanding operator errand: the **local** stack is the target, and it was left up and healthy | scope note |

---

## ~~Next run~~ — as written by the `S-E05-12` land pass (2026-08-07), **SUPERSEDED**

> **Superseded 2026-08-11 by the `S-E05-2` land pass.** The live pointer is the "Next run" section above. Both of this
> section's candidates are spent: `V3-E04`'s `epic-spec` run landed (run 28) and the epic is `in-progress` with 10 of
> 11 slices shipped, and its opening premise — *"nothing in this epic is enumerated"* — was falsified by `S-E05-2`,
> which authored and shipped its own story in one run. Kept struck rather than deleted, because a reader who stops at
> the prose would re-write a shipped spec-kit. Original text follows.

**Not a `V3-E05` slice — nothing in this epic is enumerated.** Two candidates, in order:

1. **`V3-E04` — a `sprint-02` authoring / `epic-spec` run** (audit trail and governance surfaces: `PF-14`, `PF-31`,
   `PF-32`). This is what the V3 roadmap's own sequencing rule prefers (`V3-E04` depends on `V3-E02`, which is
   `code-complete`, and it *unlocks evidence for everything after it*), and `S-E06-6` made the case concrete: it wrote
   the first `AuditLog.ipAddress` in the codebase and derived `actorRole` from the JWT on **one** handler while ~20
   others still hard-code `'school_admin'`. Its first slice is that shared provenance interceptor, and it must **open
   with the `trust proxy` decision** — behind Traefik→nginx, `req.ip` is the proxy, and blanket XFF trust makes the
   field client-forgeable, which is strictly worse than blank. There is no `docs/spec/features/v3-e04/` yet, so that run
   is **`epic-spec`**, not `epic-slice`.
2. **A `V3-E05` follow-up slice** consolidating the six "not claimed" gate rows above into one change: widen the `SINK`
   vocabulary (two-argument push, `signIn(…, { callbackUrl })`, `location.*` without the `window.` prefix,
   semicolon-free `href =`), catch the **inline** query read at the sink, move the exact-set inventory into a reviewed
   JSON with a reason and an owning finding per row (the `link-integrity-baseline.json` precedent), and correct the
   repeated-parameter sentence in `safe-callback-url.ts:76`. Cheap, entirely test-side, no production change — but it
   hardens a gate rather than shipping a capability, so it ranks second.

The third option, a **`V3-E06` follow-up** (resolve a baseline row's finding id against `audit-findings-index.md`
instead of a regex; clear `PF-103` a/b/c), is unchanged in priority by this slice.
