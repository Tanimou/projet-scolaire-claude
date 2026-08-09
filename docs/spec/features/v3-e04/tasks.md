# V3-E04 — Slice backlog (`S-E04-1` … `S-E04-8`)

> **Story contract** — the shape of `docs/daily-improvement-v3/stories/sprint-01.md`. Each slice is sized for **one
> autonomous run** (≤ a day of focused work), lands as **one PR**, is **demoable end-to-end**, and carries: `epic`,
> `finding`, `gates`, `dnc`, `blockedBy`, `requiresDecision`, preconditions, implementation notes, acceptance
> criteria, its stated test, and an explicit **out of scope** list.
>
> **Ordering is not negotiable** (`plan.md` §2): the decision work is first, the hash chain is last. A chain over
> wrong provenance is worse than no chain, because a verified chain is believed.
>
> **T-0, before any slice writes code.** Move `sanitiseInetOrNull`, `truncateUserAgent` and `MAX_USER_AGENT_LENGTH`
> out of `apps/api/src/modules/calendar/calendar-seed.service.ts` (a **feature** module) and
> `deriveAlertActorProvenance` out of `apps/api/src/modules/alerts/alert-provenance.ts` into
> `apps/api/src/shared/audit/`. This is `S-E04-1`'s first task, inherited verbatim from
> `docs/spec/features/v3-e06/PROGRESS.md:371`, and it is first **so that a second copy is never written**.

| Slice | Title | Tags | Size | `G-MIGRATION` |
|---|---|---|---|---|
| `S-E04-1` | Shared audit provenance: one home, one decision, one real actor role | `[api][audit][adr]` | M | no |
| `S-E04-2` | `/admin/audit` is measured under authentication; `/admin/reports` stops being a dead link | `[web][nav]` | S | no |
| `S-E04-3` | The operator's real IP and User-Agent reach the API — or the field stays blank | `[web][api][infra]` | M | no |
| `S-E04-4` | One canonical audit vocabulary, declared once, in `packages/contracts` | `[contracts][web][api][seed]` | M | no |
| `S-E04-5` | The KPIs share the table's scope, and the `to` filter includes its own day | `[schema][api][web][truth]` | M | **YES** — `Tenant.timezone` |
| `S-E04-6` | Five privileged families write their audit row **in the same transaction** | `[api][audit]` | M | no |
| `S-E04-7` | The remaining call sites move onto the seam, and a blocking gate keeps them there | `[api][gate]` | M | no |
| `S-E04-8` | The hash chain from a declared genesis, its verification, and the documented gap | `[schema][api][web][gate]` | M–L | **YES** |

---

## [x] S-E04-1 — Shared audit provenance: one home, one decision, one real actor role  ·  **shipped 2026-08-08**

| | |
|---|---|
| **Epic** V3-E04 · **Finding** `PF-31` *(actor-role half)* · **Gates** G-AUDIT *(partial)*, G-AUTHZ, G-DNC |
| **blockedBy** — · **requiresDecision** — · **Size** M · **`G-MIGRATION` does not trigger** |
| **dnc** DNC-10 (no off switch), DNC-08 (any check added must fail rather than skip) |

**Why.** `actorRole` is a string literal `'school_admin'` at **8 of 28** call sites (measured 2026-08-08:
`identity/invite.controller.ts:155`, `identity/roles.controller.ts:135`, `:185`, `:219`,
`imports/imports.service.ts:440`, `integrations/integrations.service.ts:639`,
`school-structure/academic-years.controller.ts:266`, `school-structure/subjects.controller.ts:227`). A `super_admin`
who mints a role is recorded as a `school_admin`. And the sanitisers that ~20 sites will need live inside a **feature**
module, so the next author will copy them.

**Preconditions to verify first (Step 2).**
1. Perform the authenticated render of `/admin/audit` and **record the verdict** — this costs minutes, needs no code,
   and it is `S-E04-2`'s headline. If the page crashes, say so here and let `S-E04-2` fix it; do not fix it in this PR.
2. Re-confirm the eight literal sites are still exactly eight (`grep -rn "actorRole: 'school_admin'" apps/api/src`).
3. Re-check `docs/adr/` for the next free ADR number (`plan.md` §7). `ADR-001…028` exist; `ADR-029…035` are reserved
   in `architecture-impact.md` §4, and `ADR-035` is **this epic's** reservation.

**Implementation notes.**
1. **T-0 first.** Create `apps/api/src/shared/audit/`; move the four helpers there; update the two feature modules to
   import from it; **delete** the originals (do not re-export a shim — a shim is how a second copy survives).
2. Add `deriveAuditProvenance(jwt, req)` in the new home, returning `{ actorRole, portal, ipAddress, userAgent }`.
   `ipAddress` / `userAgent` remain **null** in this slice — `S-E04-3` makes them real. Say so in the function's
   docblock so nobody reads a null as a bug.
3. Replace the eight literals with the derived value. Nothing else changes at those sites.
   **Same family, same slice:** `portal:` is hard-coded `'admin'` at **9** sites. A `teacher` acting through the
   teacher portal is recorded as having acted in `admin`, which corrupts the `portal` facet and every KPI stated over
   it. Derive it alongside `actorRole` — it is the same JWT read, and splitting it across two slices means touching
   the same nine files twice.
4. Write **`ADR-036` — client provenance behind the reverse proxy** (`plan.md` §3): the pinned hop count and the
   topology it was derived from; the **written refusal** of blanket `X-Forwarded-For` trust with the reason (it makes
   the audit IP client-forgeable, strictly worse than blank); the null-rather-than-wrong rule; and a named way to
   re-derive `N` if the topology changes.
5. Add a guard asserting the helpers are declared **exactly once** — a check on the *invariant*, not on the identifier
   name. `S-E06-5` measured what the weaker form buys: `PORTAL_LANDING`'s guard passed over a fifth copy because the
   copy carried a different name.

**Acceptance criteria.**
1. `sanitiseInetOrNull`, `truncateUserAgent`, `MAX_USER_AGENT_LENGTH` and the actor-role derivation are declared in
   `apps/api/src/shared/audit/` and **nowhere else**; a test fails if a second declaration appears *(AC-6)*.
2. Zero occurrences of `actorRole: 'school_admin'` and zero of a hard-coded `portal: 'admin'` remain in
   `apps/api/src` outside tests.
3. A `super_admin` performing a role create writes `actorRole: 'super_admin'` — proven by a test driving the real
   controller with a `super_admin` JWT, and shown able to fail by restoring the literal.
4. `ADR-036` exists, carries a **pinned hop count** and the written refusal of blanket XFF trust *(AC-7)*.
5. The ADR states that the API cannot see the client's IP or UA until `apps/web` forwards them, and names `S-E04-3`
   as the owner.
6. No environment variable, flag or string comparison can change what `deriveAuditProvenance` returns *(DNC-10)*.

**Test.** A provenance spec driving the **real** controllers (not the helpers in isolation — `S-E06-6`'s recorded
weakness was 23 tests that called the service directly while the controller boundary went unasserted) with
`super_admin`, `school_admin` and `teacher` JWTs; a single-declaration guard; a negative control proving each
assertion can go red.

> **Shipped 2026-08-08.** Evidence in `PROGRESS.md` § `S-E04-1`. Five things this contract said that measurement
> changed, all recorded there rather than quietly satisfied: (i) **precondition 1** (the authenticated `/admin/audit`
> render) was **not performed** — it is `S-E04-2`'s headline and needs a running stack, and this contract itself says
> not to fix the page here; (ii) the derivation existed **four** times, not once — two anonymous inline copies
> (`analytics.controller`, `grades.controller`) were collapsed too, because AC-1 is unsatisfiable while they live;
> (iii) `enqueueRebuild` **does** have a JWT on its only call path, so no `system` provenance constant was invented;
> (iv) the `parent` → `portal: 'admin'` branch of the `grades` ternary is **unreachable** through the handler
> (`assertCanWrite` refuses a parent), so the collapse removes a **latent** wrong value, not an observed one — the
> parent-portal correction is proven at `ParentExportsController`, where a parent genuinely acts; and (v) **`AC-1` as
> written here is FALSE and is narrowed, not ticked.** *"Exactly one file in `apps/api/src` decides an actor role"*
> fails on three sites this contract's own `M-6` classified as already-correct — `child-claims.service.ts:722-729`
> parametrises **both** fields (`PF-122`, and it writes `actorRole: 'admin'`, not a realm role),
> `assessments.controller.ts:290` writes **neither** (`PF-123`), and `packages/imports-core` keeps its literals
> (`PF-121`). All three are invisible to the new gate by construction. The honest claim is *"the 8 `actorRole` literals
> and the 9 `portal: 'admin'` write literals are collapsed onto one derivation, plus two anonymous inline copies"*.
> `S-E04-7` owns the column-level rule that would close it.

**Out of scope.** Making IP/UA real (`S-E04-3`). Transactionality (`S-E04-6`). The vocabulary (`S-E04-4`).

~~Touching the 20 call sites that already derive `actorRole` correctly.~~ **Corrected 2026-08-08:** that count came
from `M-6`, which measured *literals* and read "takes `actorRole` from an argument" as "derives it from the JWT".
Three of those sites do not (`PF-121`, `PF-122`, `PF-123`). Struck rather than deleted, because the next slice reads
this line as settled scope.

---

## [ ] S-E04-2 — `/admin/audit` is measured under authentication; `/admin/reports` stops being a dead link

| | |
|---|---|
| **Epic** V3-E04 · **Finding** `PF-14` · **Gates** G-PORTAL *(admin only, stated)*, G-DNC |
| **blockedBy** — *(may run before or after `S-E04-1`; must run before `S-E04-4`/`S-E04-5` edit the page)* · **Size** S |
| **dnc** DNC-09 (no surface promising more than the runtime delivers) |

**Why.** `PF-14` claims a server/client boundary crash. It **did not reproduce statically** (`spec.md` §0): the page is
a server component with `force-dynamic`, both fetches wrapped in a `safe()` `ApiError` swallower; the only smell is
that `humanizePortal` / `humanizeResourceType` are imported as **values** from a `'use client'` module, which is legal
in Next 15 but pulls them into the client bundle. The live probe 307s to login, so **the authenticated render has
never been observed**. Separately, `/admin/reports` is confirmed dead: no route directory, linked from
`sidebar-items.ts:175`, already inventoried at `scripts/link-integrity-baseline.json:20` with owner `V3-E04`.

**Implementation notes.**
1. Log in to the local stack as `mme.dupont@voltaire.fr` and load `/admin/audit`. **Record the verdict in the PR
   either way** — including the console, so a hydration error is not mistaken for a render.
2. If it crashes: fix it minimally (most likely by extracting `humanize*` into a non-`'use client'` module) and prove
   the fix by a second render. If it does **not** crash: say so, and narrow `PF-14` to its `/admin/reports` half
   rather than closing it silently in the wrong direction.
3. **Repoint and rename** the sidebar entry to `{ key: 'analytics', icon: BarChart3, label: 'Analytique',
   href: '/admin/analytics' }` (`spec.md` §5.3, `ux.md` §8). This satisfies `AC-5` *and* closes a second defect the
   criterion did not know about: `/admin/analytics` exists, is titled « Analytique des performances », and has **no
   sidebar entry at all** — it is orphaned under the very icon the dead entry carries. The label must match the
   destination's own `PageHeader` title, or the menu lies in a new way. **Fallback if the repoint is contested:**
   remove the entry (satisfies `AC-5` literally, leaves the page orphaned). **Building a reports page is refused.**
4. **Retire** the `/admin/reports` row from `scripts/link-integrity-baseline.json` — the ratchet lowers by one. Do not
   edit its reason and leave it in place.

**Acceptance criteria.**
1. An authenticated render of `/admin/audit` is **performed and recorded**, with its verdict, in the PR and in
   `PROGRESS.md` *(AC-1, render half)*.
2. `/admin/reports` is referenced by no navigation surface; `grep -rn "/admin/reports" apps/web/src` returns nothing
   outside tests *(AC-5)*.
3. `node scripts/link-integrity-check.js` passes with the row **retired** from the baseline, not re-reasoned and not
   silenced. **Read the verdict line, not `$?`** (`R-23`).
4. If the repoint option is taken: the menu label equals the destination page's own `PageHeader` title, and
   `/admin/analytics` is reachable from the sidebar for the first time.
5. No new route, no invented copy, no « en cours de finalisation » *(DNC-09)*.
6. Recorded plainly: the link gate is **static** — it proves the route emits, never that the page renders for an
   authenticated admin. Do not read its green as covering AC-1.

**Test.** The link-integrity gate (executed, verdict line reported per `R-23`), plus a case proving the gate would go
red if the sidebar entry came back. The render itself is manual evidence — label it as such; `apps/web` has no unit
runner, only Playwright.

**Out of scope.** Building an admin reports surface (that is a `V3-E03` capability behind `D-09`). Any KPI or filter
change (`S-E04-5`). Any vocabulary change (`S-E04-4`).

---

## [ ] S-E04-3 — The operator's real IP and User-Agent reach the API — or the field stays blank

| | |
|---|---|
| **Epic** V3-E04 · **Finding** `PF-31` *(provenance half)* · **Gates** G-AUDIT *(partial)*, G-AUTHZ, G-DNC |
| **blockedBy** **`S-E04-1`** *(the ADR must exist first)* · **Size** M · **`G-MIGRATION` does not trigger** |
| **dnc** DNC-10 |

**Why.** Even with `trust proxy` pinned, the API can never see the operator: the chain is
browser → Next server action → the `apps/web` server-side `fetch` (**forwards only `Accept`, `Content-Type`,
`Authorization`**) → nginx → API. So the stored value is the **web container's address, identical for every actor
forever**, and `userAgent` is null on every UI-driven write because undici sends none. `sanitiseInetOrNull` cannot
catch it — a proxy IP *is* a valid inet.

**Implementation notes.**
1. Apply the ADR's pinned hop count in `apps/api/src/main.ts` (today a bare `NestFactory.create` at `:37`).
2. Forward the real client IP and User-Agent from **one** seam in `apps/web` (the shared api-client / server-action
   fetch helper) — never per call site, or the next surface forgets.
3. Confirm `infra/nginx` propagates the header the pinned count expects, and that the count matches
   Traefik → nginx → api as deployed. **If the topology cannot be confirmed, the field stays null and the slice says
   so** — `AC-8` is satisfied by an honest blank, never by a plausible value.
4. Render « provenance non disponible » on `/admin/audit` where `ipAddress` is null, rather than an empty cell.

**Acceptance criteria.**
1. Two audited actions from two different client addresses produce **two different** `ip_address` values *(AC-3)*.
2. A request carrying a forged `X-Forwarded-For` beyond hop `N` does **not** change the recorded address — proven by a
   test that sends one.
3. Where no trustworthy address can be derived, `ipAddress` is `null` and the UI states it; **no value is ever the
   proxy's** *(AC-8)*.
4. `user_agent` is populated on a UI-driven audited write, truncated by the shared sanitiser.
5. No environment variable relaxes the hop count at runtime *(DNC-10)*.

**Test.** A supertest-level test driving the API through the pinned configuration with (a) no XFF, (b) a legitimate
proxy chain, (c) a forged client XFF, asserting the recorded value in all three; plus an executed end-to-end write
from the local stack whose row is read back from the database — the claim is about the **stored** value, so reading
the response is not evidence.

**Out of scope.** Chain hashing. Transactionality. Backfilling the 54 rows (`A-01` — impossible).

---

## [ ] S-E04-4 — One canonical audit vocabulary, declared once, in `packages/contracts`

| | |
|---|---|
| **Epic** V3-E04 · **Finding** `PF-32` *(vocabulary half — newly measured, in no audit)* · **Gates** G-TRUTH, G-PORTAL, G-DNC |
| **blockedBy** `S-E04-2` *(do not edit the page before its render verdict exists)* · **Size** M · **`G-MIGRATION` does not trigger — deliberately** |
| **dnc** DNC-09, DNC-08 *(an unclassifiable code must stay visible, never be dropped)* · **ADR** `ADR-037` |

**Why.** Three populations disagree about what an `action` and a `resource_type` are (`spec.md` §1.3(d)): the 54 live
rows carry **French display strings** in structural columns; the **30** call sites write **20 distinct machine codes**;
`AuditPageFilters.tsx:21-35` maps **13 keys**, of which **7 are written by nobody**, only **6** intersect what is
written — leaving **14 written codes with no label** — and which cover **0 of the 8** resource types that exist in the
database. `criticalChanges` matches a set straddling both vocabularies and measured **9** by hitting the French
`Suppression` while matching no machine code at all. `resourceType: 'calendar_event'` is absent from the map
(`v3-e06/PROGRESS.md:378`). `PORTAL_LABELS` and `packages/contracts`' `PORTALS` are **both 3-valued** while
`apps/web/src/app/student/` exists.

**Implementation notes.**
1. Declare `AUDIT_RESOURCE_TYPES`, `AUDIT_ACTIONS`, `AUDIT_CRITICAL_ACTIONS`, `AUDIT_EXPORT_ACTIONS` and the fourth
   portal in a new `packages/contracts/src/audit/` module (`plan.md` §4) — **not** appended to `src/enums/index.ts`.
   The French **label is attached to the code**. Ship **`ADR-037`** with it.
2. **Delete** `RESOURCE_TYPE_LABELS` and `PORTAL_LABELS` from `AuditPageFilters.tsx`; derive both from contracts.
   **Three consumers, not two** — the third is `apps/worker/.../exports/generators/audit-csv.generator.ts:16`, which
   exports `action` **raw**. A two-consumer fix leaves the CSV export drifting, and the CSV export is what a DPO hands
   to a regulator.
3. Correct the **seed** so a fresh local seed writes canonical codes.
4. **Do not rewrite the 54 legacy rows** (`spec.md` §6). An unrecognised value is returned **as-is** with
   `vocabulary: "unknown"` and `label` equal to the raw code, and rendered with an explicit « format hérité » marker.
   **It is never dropped from a facet list** — what cannot be classified must stay visible (`DNC-08`'s posture applied
   to data rather than to a check).
5. Completeness is checked **in both directions**: every code an API call site writes has a label, and every label
   corresponds to a code something writes. One-directional checking is how `calendar_event` went missing.
6. `packages/contracts` is built to CJS (`dist/`) — remember it is consumed at runtime by Node, per
   `bmad/project-context.md` §1.

**Acceptance criteria.**
1. Exactly one declaration of the audit vocabulary exists, in `packages/contracts/src/audit/`; a guard fails on a
   second declaration of two or more audit labels anywhere else; **`ADR-037`** records the decision *(AC-9)*.
2. The `resourceType` facet renders French labels for **all 20** codes something writes, **including
   `calendar_event`**, and the **7 keys nobody writes** are gone from the map.
3. `portal` covers **four** portals; a row carrying `portal: 'student'` renders a French label *(G-PORTAL)*.
4. A legacy French row renders with an explicit « format hérité » marker and is **not** relabelled, hidden, or
   updated in the database *(AC-9)*.
5. `G-PORTAL` evidence names all four portals checked, not the one being edited.
6. All **three** consumers (web label map, API KPI predicates, worker `audit-csv` generator) read the one
   declaration; none holds a local copy.

**Test.** A contracts-level completeness test in both directions (codes ↔ labels), driven off the **actual** set of
`action:` / `resourceType:` literals reachable in `apps/api/src` **and `packages/imports-core/src`** rather than off a
hand-written list — the independence is what makes the comparison real (`PF-105`'s lesson: `A ≡ A` proves nothing).
Plus a legacy-row rendering case.

**Out of scope.** Any `UPDATE`/`DELETE` on `audit_log`. A Prisma enum for `action`/`resourceType` (`data-model.md`
§2 — refused, with reasons). The parent transparency panel (`spec.md` §5.2).

---

## [x] S-E04-5 — The KPIs share the table's scope, and the `to` filter includes its own day

> **Shipped 2026-08-09, needing human review (NOT auto-merged).** 9 of 11 acceptance criteria evidenced,
> **AC-9 partially** (the derivation ships and is gated; the `KpiCard` `state`/`scope` props it was written for are
> **not wired** — `PF-144`) and **AC-3's rendered half NOT OBSERVED** (`PF-135`, no browser was driven). Decisions
> `D-E04-5-1` / `D-E04-5-2` are recorded in the story §3, in `openapi.yaml` and in `data-model.md` §3.6/D-22.
> Implementation note 6 (`excludesLegacyRows`) is **vacuous by measurement** and was deliberately not shipped — the
> table is in `PROGRESS.md` § `S-E04-5`. New findings raised: `PF-144`…`PF-152`. Evidence: `PROGRESS.md` § `S-E04-5`.

| | |
|---|---|
| **Epic** V3-E04 · **Finding** `PF-32` *(filter + KPI halves)* · **Gates** **G-MIGRATION**, G-TRUTH, G-TENANT, G-DNC |
| **blockedBy** **`S-E04-4`** *(a KPI stated over an undeclared vocabulary is the `criticalChanges` defect again)* · **Size** M |
| **dnc** DNC-09 (no card that can only read 0) |

> **`G-MIGRATION` triggers here, and this was not obvious.** A day-inclusive `to` is meaningless without a declared
> timezone, and **`Tenant` has no `timezone` column** — measured: only `School.timezone` exists (default
> `Europe/Paris`), and `Tenant` carries `settings Json`. Computing the boundary in the *server's* zone would make two
> admins in different zones see different counts for the same filter, which is the very `G-TRUTH` defect this slice
> closes. So the slice adds `Tenant.timezone` (additive, defaulted) — a **reviewed** migration file under
> `apps/api/prisma/migrations`, never `db push`, with a stated rollback and `scripts/schema-drift-check.js` green
> (`ADR-027`). Note the migrations directory currently holds **`0_baseline` only**.

**Why.** `analytics.service.ts:3251` applies `lte: new Date(to)`, so `to=2026-08-08` becomes `T00:00:00Z` and every row
later that day is dropped. `:3310-3326` computes all four KPIs with a `where` containing **only `tenantId`** — three
all-time counts beside a filtered table, silently disagreeing with it. `adminLogins` measured **0** and is
**structurally always zero**: no call site in the API writes a login audit row.

**Implementation notes.**
1. `to` becomes day-inclusive: `createdAt < startOfNextDay(to)` computed in the **tenant's** timezone (the new
   `Tenant.timezone`, default `Europe/Paris`). The resolved zone is **returned** in the response and **never accepted
   from the client** — a client-supplied zone would let two admins obtain two different counts for one filter.
2. All four KPIs are computed over the **same `where`** as `data`/`total`, and `kpis.eventsInRange.value === total` is
   asserted by a test. That equality is the anti-drift invariant.
3. Each KPI carries `{ value, scope, label }` (`contracts/openapi.yaml` → `KpiValue`) and the card renders the scope.
4. `criticalChanges` / `sensitiveExports` read `AUDIT_CRITICAL_ACTIONS` / `AUDIT_EXPORT_ACTIONS` from
   `packages/contracts`, never an inline string array.
5. **Remove the `adminLogins` card** and replace it with « Acteurs distincts ». State the removal and its reason
   in-product and in `PROGRESS.md`; name `V3-E05` (which owns `PF-26`, the session lifecycle) as the owner of real
   login/session auditing. Do **not** invent a "first authenticated request" heuristic — that is not a login.
6. Where a KPI's definition cannot match the 54 legacy rows, set `excludesLegacyRows` and **label the under-count on
   the card**.

**Acceptance criteria.**
1. Filtering `to = today` returns rows written later today; a test pins the boundary at **23:59:59 in the tenant's
   timezone** *(AC-4)*, and is shown able to fail by restoring `lte: new Date(to)`.
2. All four KPIs are computed over the table's `where`; `kpis.eventsInRange.value === total` for the same request
   *(AC-4)*.
3. Every KPI carries and renders its scope *(G-TRUTH)*.
4. No card can display a structurally impossible value; `adminLogins` is gone with its reason stated *(AC-10)*.
5. One fixture yields identical values across two runs and across the card / table pair *(G-TRUTH)*.

**Test.** A KPI unit test **per definition**, each shown able to fail by mutating its predicate; a boundary test on
`to` (last second of the selected day, and the first second of the next); a tenant-scoping negative
(foreign-tenant rows never counted — `G-TENANT`).

**Out of scope.** Litigating what a metric *means* (`D-09` / `V3-E03`). Implementing login auditing. Claiming
`ADR-034` — `architecture-impact.md` §4 reserves the *canonical* KPI envelope for `V3-E03`; the envelope here is
**minimal and local**, offered as an input to that decision. Any schema change beyond the additive `Tenant.timezone`.

---

## [x] S-E04-6 — Five privileged families write their audit row in the same transaction  ·  **shipped 2026-08-09**

> **Shipped.** Evidence in `PROGRESS.md` § `S-E04-6`; decisions in `docs/adr/ADR-035-audit-in-transaction.md`.
> Three corrections made by measurement rather than assumption, all recorded rather than back-edited into the
> notes below: **(a)** implementation note 1 is **wrong as written** — typing the first parameter
> `Prisma.TransactionClient` does **not** make `writeAudit(this.prisma, …)` a type error (`Omit` removes members,
> it does not forbid them; TypeScript is structural). The shipped `AuditTransactionClient` re-adds the two
> deny-listed members as optional `never`, which does, and a `@ts-expect-error` control pins it in the typecheck
> gate. **(b)** note 2's finance clause: measured **26** modules under `apps/api/src/modules`, none finance —
> `AC-4` recorded **vacuous, NOT ticked**. **(c)** the "~18 remaining non-transactional sites" measured **27
> across 15 files** after the change; `S-E04-7` owns them, plus the pinned-inventory allow-list gate.

| | |
|---|---|
| **Epic** V3-E04 · **Finding** `PF-31` *(missing-row half)* · **Gates** **G-AUDIT (primary)**, G-TENANT, G-AUTHZ, G-DNC |
| **blockedBy** `S-E04-1`, `S-E04-3` *(provenance must be true before it is recorded at 5 more families)* · **Size** M |
| **dnc** DNC-10 |

**Why (measured 2026-08-08).** **6 of 28** audit call sites use `tx.auditLog.create` inside a `$transaction`; the other
**22** call `this.prisma.auditLog.create` outside one. `roles.controller.ts create()` does `prisma.role.create(...)`
then a **separate** `prisma.auditLog.create(...)` — the role can exist unaudited. And three of `AC-2`'s five families
write **no row at all**: role grant/revoke (`identity/users.service.ts:57`, `:74`; `users.controller.ts` has no
`auditLog.create`), school mutations (`apps/api/src/modules/schools/` — **zero** `auditLog` references), enrollment
decisions (`apps/api/src/modules/enrollments/` — **zero**).

**Implementation notes.**
1. Add `writeAudit(tx: Prisma.TransactionClient, input: AuditWriteInput)` to `shared/audit/`. The first parameter
   being a transaction client makes `writeAudit(this.prisma, …)` a **type error** — the invariant becomes
   compile-time, not a review convention (`plan.md` §5).
2. Cover the five `AC-2` families:
   - **role grant/revoke** — new rows, inside the grant's transaction;
   - **school mutation** — new rows;
   - **enrollment decision** — new rows;
   - **grade publish** — already transactional at `assessments.controller.ts:290`; move it onto the shared seam;
   - **finance** — **there is no finance module in `apps/api/src/modules`** (26 modules, none of them finance;
     `ADR-018` defers it). State this plainly rather than ticking `AC-2`; `S-E04-7`'s gate arms the criterion for the
     module that does not yet exist.
3. Write **`ADR-035`** (this epic's existing reservation): audit in-transaction, and the posture on `PF-96`
   (`AuditLog` has no FK to `Tenant`) — **stated, not changed**. Re-check `docs/adr/` for collisions first
   (`plan.md` §7).

**Acceptance criteria.**
1. For each of the four **existing** families: the mutation is made to fail inside its transaction and **neither** the
   entity row nor the audit row exists *(AC-2, G-AUDIT)*.
2. Inverted, per family: `writeAudit` is made to fail and the mutation does **not** persist.
3. Every row written carries actor, real role, tenant, and IP/UA per `S-E04-3`'s rule (real or honestly null).
4. The finance clause of `AC-2` is recorded as **vacuous today**, with the reason, and armed by `S-E04-7`.
5. `ADR-035` exists and states the `PF-96` posture without changing the relation.

**Test.** The rollback test in **both** directions, **per family** — a test proving only direction (i) proves nothing
about a writer placed after a `commit`. Plus a `G-TENANT` negative per new query and a `G-AUTHZ` negative per role
that must be denied on any new path.

**Out of scope.** The remaining ~18 non-transactional sites (`S-E04-7`). The chain (`S-E04-8`). Changing the
`AuditLog → Tenant` relation (`spec.md` §5.4). Retention policy (out of scope for the epic — `D-08`-adjacent).

---

## [ ] S-E04-7 — The remaining call sites move onto the seam, and a blocking gate keeps them there

| | |
|---|---|
| **Epic** V3-E04 · **Finding** `PF-31` *(sweep + durable half)* · **Gates** G-AUDIT, G-DNC |
| **blockedBy** **`S-E04-6`** · **Size** M · **`G-MIGRATION` does not trigger** |
| **dnc** DNC-08 (a check that cannot run must FAIL), DNC-10 |

**Why.** Closing five families by hand leaves the class open. `S-E06-6` advanced `PF-31` on **one** handler of ~20 and
the finding stayed open for two epics; a sweep without a ratchet repeats that. The house pattern is a
`scripts/*-check.js` wired into **both** `scripts/ci-gate.sh` and `.github/workflows/ci.yml`.

**Implementation notes.**
1. Move the remaining `auditLog.create` sites onto `writeAudit(tx, …)`. Where a site genuinely cannot be transactional
   (a best-effort post-commit notice — e.g. `grades.controller.ts:338`, whose comment says a write failure is
   swallowed and never rolls back the flag), **baseline it with an owning finding id and a reason**; do not silently
   convert semantics.
2. Ship `scripts/audit-write-check.js`: fails on any `auditLog.create` reached outside `shared/audit`, and on any
   `writeAudit` call not given a transaction client. Reviewed baseline, **one-way ratchet**.
   **Its walk root is `apps/api/src` + `apps/worker/src` + `packages/imports-core/src`, not `apps/api/src` alone.**
   Two audit writes live at `packages/imports-core/src/engine.ts:197` and `:288` (both correctly transactional today),
   and a gate rooted only at the API would be blind to them — the `S-E06-5` lesson (`packages/ui` bundled into every
   portal but outside the gate's walk root) recurring at a second address. The finance module does not exist yet
   (`S-E04-6` note 2); the walk root must be stated so that when it does, it is covered by default rather than by
   someone remembering.
3. The baseline resolves each row's finding id against `docs/daily-improvement-v3/audit-findings-index.md`, **not**
   against a regex — `S-E06-5` measured three live rows citing ids that existed nowhere because
   `link-integrity-check.js` validated the id's *shape*.
4. **`DNC-08`:** if the check cannot read what it needs (missing file, unparseable tree), it **exits non-zero and says
   which**. No skip, no "nothing to check" pass.
5. **`DNC-10`:** no `--skip`, no `--force`, no `SKIP_*` / `ALLOW_*` env var. Follow `ADR-025` / `ADR-027`, which
   litigated this shape already.

**Acceptance criteria.**
1. Every `auditLog.create` across the **whole walk root** (`apps/api/src`, `apps/worker/src`,
   `packages/imports-core/src` — **30** sites measured today) is either behind `writeAudit` inside a transaction, or
   baselined with a reason and an owning finding id *(AC-11)*.
2. `node scripts/audit-write-check.js` is a **blocking** stage in both harnesses, and its verdict line is reported.
3. The check is **shown able to fail**: a deliberately-added non-transactional write turns it red, and the run is
   recorded.
4. The check **fails** when it cannot run *(AC-12, DNC-08)*, proven by a driven unreadable-input case.
5. No flag or environment variable can bypass it *(DNC-10)*, asserted in the negative.

**Test.** The gate's own guard spec (the `observability-gate.spec.ts` / `link-integrity-gate.spec.ts` shape): positive,
negative, and a proof that each rule can go red; plus the executed run of the real script on the real repository, with
its verdict line quoted.

**Out of scope.** The chain. Any behaviour change at a site beyond where its audit write happens.

---

## [ ] S-E04-8 — The hash chain from a declared genesis, its verification, and the documented gap

| | |
|---|---|
| **Epic** V3-E04 · **Finding** `PF-31` *(chain half)* · **Gates** **G-MIGRATION**, G-AUDIT, G-AUTHZ, G-TENANT, G-DNC |
| **blockedBy** **`S-E04-3`, `S-E04-6`, `S-E04-7`** — non-negotiable · **Size** M–L |
| **requiresDecision** — · **dnc** DNC-08 *(the sharpest in the epic)*, DNC-10 |

**Why.** `hash` and `prev_hash` exist as nullable columns and are written by **no call site anywhere** — measured 0 of
54 rows, and `alerts.service.ts:607` carries a comment saying they are "left unset, matching every other" site. **The
chain has never existed.** An append-only table with no chain is append-only by convention, and convention is what an
audit exists to stop relying on.

**Why last.** A chain over an `actorRole` that is a literal, an `ipAddress` that is the web container's and a
`userAgent` that is null would be a cryptographically verifiable record of falsehoods — worse than the honest blank,
because a verified chain is believed (`plan.md` §2).

**Implementation notes.**
1. **First task: choose the serialisation mechanism and justify it** (`data-model.md` §3). Two concurrent audit writes
   must not read the same `prevHash`. Candidates: per-tenant advisory lock (no schema change; interacts with the long
   `imports` apply transaction — **measure it**), `isolationLevel: 'Serializable'` (**zero occurrences in
   `apps/api`** — a new idiom needing a retry policy that does not exist), or a monotonic `chainSeq` (**schema
   change**). Do not ship a chain whose ordering under concurrency is unstated.
2. Declare the hash function and the **versioned field list** in `ADR-035` (amendment — the `ADR-024` pattern, used
   four times in this repo). Changing either later invalidates every prior verification.
3. Write **one genesis row per tenant** with `prevHash = null` (or a declared constant) and a recorded `createdAt`.
4. `GET /analytics/audit/chain-verification` on the **existing** `audit.read` permission (no new permission), per
   `contracts/openapi.yaml`. It returns `preGenesisRowCount` on **every** call — the gap is part of the response, not
   a footnote.
5. Render the gap **in-product** on `/admin/audit`: *« N lignes antérieures à la genèse ne sont pas chaînées »*.
   `A-01` is permanent; the gap must be visible where the trail is read, not only in a markdown file.
6. **The migration** (the only one in this epic): expand/contract, reviewed file under `apps/api/prisma/migrations`,
   **never `db push`**, stated rollback, `scripts/schema-drift-check.js` green (`ADR-027`). `hash`/`prevHash` stay
   **nullable** — making them `NOT NULL` is impossible while pre-genesis rows exist, and they exist permanently. Write
   *nullable means pre-genesis* into the model comment, or the next reader will "tidy" it.
7. Wire chain verification into the gate harnesses. **`DNC-08` is the controlling constraint:** a verifier that cannot
   read the rows exits non-zero naming why. "Nothing to verify" is **never** a pass.

**Acceptance criteria.**
1. Every audit row written from the genesis forward carries `hash` and `prev_hash` *(AC-3)*.
2. Verification reports `verified` on an untampered chain and `broken` with `firstBreakAt` when a chained row is
   deleted or altered — both **driven against a real database**, not asserted.
3. Verification reports `unverifiable` with a reason when it cannot run, and the CLI form **exits non-zero**
   *(AC-12, DNC-08)*, proven by a driven case.
4. `preGenesisRowCount` is returned on every call and rendered on `/admin/audit`; the pre-V3 gap is stated, never
   fabricated *(A-01, R-10)*.
5. Concurrency: two simultaneous audited mutations produce two distinct, correctly-ordered chain links — proven by a
   driven concurrent test, not by reasoning.
6. The migration is a reviewed file; `schema-drift-check.js` is green; the rollback is stated in the migration header,
   and it explicitly does **not** delete the genesis row *(G-MIGRATION)*.
7. No flag or environment variable disables the chain writer or the verifier *(DNC-10)*, asserted in the negative.

**Test.** Chain verification driven against the real local database in four states (untampered, altered row, deleted
row, unreadable); a concurrency test; a migration up/down on a scratch database; a `G-AUTHZ` negative per role on the
new endpoint, **including `student`**.

**Out of scope.** Backfilling pre-genesis rows (`A-01` — impossible; fabricating is worse than the gap). Retention or
legal-hold (`D-08`-adjacent, `R-13`). Changing the `AuditLog → Tenant` relation (`PF-96` — posture stated, relation
untouched). The parent transparency panel.

---

## Cross-slice rulings (PM decisions — read before implementing)

| # | Ruling | Where argued |
|---|---|---|
| 1 | The 54 legacy French rows are **never rewritten**. The seed is corrected; the rows are rendered honestly | `spec.md` §6 |
| 2 | `/admin/reports` is **removed**, not built | `spec.md` §5.3 |
| 3 | `adminLogins` is **removed** with its reason stated, not quietly kept at 0 | `AC-10`, `S-E04-5` |
| 4 | `action` / `resourceType` stay free-form `String` in the database; the vocabulary is a **contract** | `data-model.md` §2 |
| 5 | Blanket `X-Forwarded-For` trust is **refused in writing**; null beats wrong | `plan.md` §3, `AC-8` |
| 6 | The chain is **last**; the decision work is **first** | `plan.md` §2 |
| 7 | `PF-96` is **referenced with a stated posture**, not fixed | `spec.md` §5.4 |
| 8 | `AC-2`'s finance clause is **vacuous today** and is armed by a gate rather than ticked | `S-E04-6` note 2 |
| 9 | Three ADRs, one per decision-bearing slice: `ADR-036` (provenance), `ADR-037` (vocabulary), `ADR-035` (in-transaction + genesis + gap). Re-check `docs/adr/` before creating each file | `plan.md` §7 |
| 10 | `G-MIGRATION` triggers in **two** slices, not one — `S-E04-5` (`Tenant.timezone`) and `S-E04-8` (chain ordering) | `S-E04-5` note, `data-model.md` |
| 11 | The epic never writes "RLS protects the audit rows". RLS exists **nowhere** in the repository; scoping is application-level, and `ADR-032` / `V3-E01` owns the gap | `spec.md` §8 |

## Out of scope for the whole epic (recorded — see `spec.md` §5)

Retention / legal-hold policy · the parent transparency panel · building `/admin/reports` · fixing `PF-96` ·
backfilling pre-V3 rows · a new BullMQ queue, portal or permission · litigating contested KPI definitions (`D-09`) ·
any `UPDATE` or `DELETE` on `audit_log`.
