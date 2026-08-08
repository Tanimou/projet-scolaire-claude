# V3-E04 — Audit trail and governance surfaces

> **Layer** L0 · **Size** M · **Depends on** `V3-E02` (`code-complete` 2026-08-08) · **Blocks** `V3-E03`, `V3-E11`
> **Closes** `PF-14`, `PF-31`, `PF-32` · **Gate** `G-AUDIT` (primary), with `G-TRUTH`, `G-TENANT`, `G-AUTHZ`,
> `G-PORTAL`, `G-MIGRATION`, `G-DNC` triggered per slice · **Risks** `R-10` (accepted), `A-01` (permanent)
> **Epic contract** `docs/daily-improvement-v3/epics/V3-E02-E06-layer0.md` §`V3-E04`
> **Spec run** 2026-08-08 — docs only. No code, no schema, no script was edited by this run.

---

## 0. Read this first — what this spec measured, and what it refuses to claim

The epic contract for `V3-E04` was written from the audits (`A2 §5.6`, `App. B.5`, `App. C.2`). Before writing this
spec, the routine measured the **running local Docker stack** and the **current source tree**. Six of the contract's
statements are now sharper, one is **wider than written**, and one is **not settled in either direction**. The whole
point of this section is that the next agent implements against the measurement, not against the audit's wording.

| Contract says | Measured 2026-08-08 | Consequence for this spec |
|---|---|---|
| "`/admin/audit` crashes (server/client boundary)" | **NOT reproduced statically, and NOT observed authenticated.** `apps/web/src/app/admin/audit/page.tsx` is a server component with `export const dynamic = 'force-dynamic'`, both fetches wrapped in a `safe()` `ApiError` swallower, importing `humanizePortal` / `humanizeResourceType` as **values** from `AuditPageFilters.tsx` (`'use client'`) — legal in Next 15, but it pulls those into the client bundle. A live probe of `http://localhost:3000/admin/audit` returned a **307 to `/admin/login`** (the middleware intercepts before the page renders), so the authenticated render was **never observed** | **OPEN MEASUREMENT.** `S-E04-2` settles it by an authenticated render and records the verdict. This spec claims neither "it crashes" nor "it is fine" |
| "`/admin/reports` is 404" | Confirmed and **already inventoried**: no `apps/web/src/app/admin/reports` directory exists (38 route directories under `admin/`, none named `reports`); the link is emitted from `apps/web/src/components/shell/sidebar-items.ts:175`; `scripts/link-integrity-baseline.json:20` already carries the row with owner `V3-E04`. Middleware intercepts first, so an unauthenticated probe 307s to login and the 404 is reached only post-login | `S-E04-2`. The ruling is **remove the entry**, not build a page — see §5 Non-goals |
| "actor role is hard-coded `school_admin`" | **True at 8 of 28 call sites**, not all. Exactly eight literals: `identity/invite.controller.ts:155`, `identity/roles.controller.ts:135`, `:185`, `:219`, `imports/imports.service.ts:440`, `integrations/integrations.service.ts:639`, `school-structure/academic-years.controller.ts:266`, `school-structure/subjects.controller.ts:227`. The other 20 already take `actorRole` from arguments | `S-E04-1` fixes the eight. Say "eight", never "every" |
| "role and school mutations write no audit row at all" | **Confirmed, and the mechanism is narrower than the wording.** `roles.controller.ts` *does* audit role **create/update/delete**. What is unaudited is **role grant/revoke** (`identity/users.service.ts:57` `userRole.create`, `:74` `userRole.update`; `users.controller.ts` contains no `auditLog.create` at all) and **every school mutation** (`apps/api/src/modules/schools/` contains **zero** `auditLog` references). `apps/api/src/modules/enrollments/` likewise contains **zero** — enrollment decisions are unaudited too | `S-E04-6` |
| "`ip_address` / `user_agent` / `hash` / `prev_hash` are never populated" | **Confirmed against the live database.** `select count(*), count(hash), count(prev_hash), count(ip_address), count(user_agent) from audit_log` → **54 \| 0 \| 0 \| 0 \| 0**. No call site anywhere writes `hash` or `prevHash`; `alerts.service.ts:607` carries a comment saying they are "left unset, matching every other" site. **The chain has never existed** | `S-E04-8` (chain), `S-E04-3` (IP/UA) |
| "fix the end-date filter and the three structurally wrong KPIs" | **Wider than written — four distinct defects plus a vocabulary split.** See §1.3. This is the single most important correction in this spec: an implementer who reads only the contract will under-scope `PF-32` by roughly a third | `S-E04-4` + `S-E04-5` |
| *(not in the contract)* | **The audit write is not transactional at the measured site**, and the shape generalises: **6 of 28** call sites in `apps/api/src` use `tx.auditLog.create` inside a `$transaction`; the other **22** call `this.prisma.auditLog.create` outside one. `roles.controller.ts create()` does `prisma.role.create(...)` and then a **separate** `prisma.auditLog.create(...)` — the role can exist unaudited; `update()` *does* open a `$transaction` and writes the audit row **outside** it, which is the same defect wearing a transaction as camouflage. That is the `AC-2` defect, reproduced | `S-E04-6`, `S-E04-7` |
| *(not in the contract)* | **Two further audit write sites live outside `apps/api/src`** — `packages/imports-core/src/engine.ts:197` and `:288`, both `tx.auditLog.create` (correctly inside the transaction). So the monorepo total is **30**, not 28. Any sweep or ratchet whose walk root is `apps/api/src` is blind to them — the `S-E06-5` lesson (`packages/ui` bundled into every portal but outside the gate's root) at a second address | `S-E04-7` |

**Numbers in this document.** Every quantity is either (a) measured against the running local stack or the source tree
on 2026-08-08 and labelled as such, or (b) explicitly marked *unmeasured*. Nothing is inferred from an audit report and
presented as a measurement.

---

## 1. Vision — and the parent value

### 1.1 The promise

Pilotage handles children's data. The cahier de charges' governance posture is not decoration: minimal access, an
**append-only** audit, and a factual, non-stigmatising tone. `ADR-015` (RBAC + ABAC + custom roles) *mandates* an audit
row on privileged mutation. Today the product has an audit **table**, an audit **page**, and an audit **permission** —
and, measured, a trail that cannot answer the three questions a DPO or a head teacher will ask:

1. **Who did this?** — the actor's *role* is a string literal at eight sites, so a `super_admin` who mints a role is
   recorded as a `school_admin`.
2. **From where?** — `ip_address` is null on all 54 rows, and the one handler that *does* capture it
   (`S-E06-6`'s calendar seed) records the **web container's** address, because there is no `trust proxy` anywhere in
   `apps/api` and the browser's address never reaches the API at all.
3. **Has anything been removed?** — `hash` / `prev_hash` are null on all 54 rows. An append-only table with no chain is
   append-only by *convention*, and convention is exactly what an audit exists to stop relying on.

`V3-E04` makes privileged action **accountable**: the row is written in the same transaction as the change it
describes, it carries a true actor, a true tenant and a true provenance, and — from a **declared genesis** forward —
it is chained, so a deletion is detectable.

### 1.2 The parent value — « Qui a consulté les données de mon enfant »

This epic is admin-facing. Its parent value is **deferred but designed for**, and naming it is what decides one
otherwise-arbitrary technical choice in `S-E04-4`.

The cahier's RGPD posture already implies a *droit d'accès* surface: a parent should be able to see, in plain French,
that *Mme Dupont a publié une note le 12 mars* and that *un export du bulletin de votre enfant a été généré le 3 avril* —
the same facts the admin audit table shows, filtered to one child, with actor **names** but never actor **IPs**.

**This epic does not build it** (see §5 Non-goals). What it owes that surface is exactly one thing, and it costs
nothing this run: the canonical audit vocabulary is declared in **`packages/contracts`**, with the human French label
attached to the machine **code** — not frozen into the database's structural columns, and not living in an admin-local
client component. Declared that way, the parent panel is later *a read endpoint and a page*. Declared the way it is
today, it is *a second label map and a second vocabulary drift*.

That is the whole idea: make a future transparency surface cheap by refusing, once, to put display text in a
structural column.

### 1.3 What `PF-32` actually is (measured — read before scoping)

`PF-32` is written as "the end-date filter and three structurally wrong KPIs". It measures as **four** defects and a
**fifth, larger** one that reaches into `packages/contracts`, the seed, the live rows and the label map.

**(a) The `to` filter drops its own day.** `analytics.service.ts:3251` — `lte: new Date(to)`. `to=2026-08-08` becomes
`2026-08-08T00:00:00Z`, so every row later that day is silently excluded. A governance filter that quietly omits today
is worse than one that errors.

**(b) All four KPIs ignore every user filter.** `analytics.service.ts:3310-3326` computes the four counts with a `where`
containing only `tenantId` — `from`, `to`, `action`, `resourceType`, `portal` and `actorId` are all absent. So three
all-time counts sit beside a filtered table and **silently disagree with it**. This is a `G-TRUTH` defect of the exact
shape `V3-E03` exists to end.

**(c) `adminLogins` is structurally always zero.** Measured 0, and **no call site in the entire API writes any login
audit row** — grep over every `auditLog.create` window yields 17 distinct literal actions, none of them a login. The
card « CONNEXIONS ADMIN — Sessions ouvertes » can never display anything but `0`. A KPI that can only be zero is not a
wrong number; it is a false statement rendered as a number.

**(d) The vocabulary split — newly measured, in no audit.** Three populations disagree about what an `action` and a
`resource_type` *are*:

| Population | `resource_type` values | `action` values |
|---|---|---|
| The **54 live rows** (seed-authored) | French **display strings**: `Professeur`, `Note`, `Classe`, `Élève`, `Inscription`, `Évaluation`, `Résultats`, `Année scolaire` (8) | French display strings: `Création`, `Mise à jour`, `Suppression`, `Validation`, `Export` (5) |
| The **30 call sites** (28 in `apps/api/src` + 2 in `packages/imports-core`) | **20 distinct** machine codes: `academic_year`, `alert_instance`, `assessment`, `booking`, `calendar_event`, `conversation`, `conversation_report`, `export_job`, `grade`, `guardianship_claim`, `import_row`, `meeting_request`, `remediation_plan`, `role`, `roster_source`, `snapshot_recompute_trigger`, `subject_coefficient`, `tutor`, `tutor_availability`, `user_profile` | machine codes: `role.create`, `assessment.publish`, `export.bulletin.request`, … |
| `AuditPageFilters.tsx:21-35` `RESOURCE_TYPE_LABELS` | **13 keys**, of which **7 are written by no call site at all** (`announcement`, `class_section`, `enrollment`, `enrollment_request`, `import_batch`, `student`, `teacher_profile`) and only **6** intersect what is written — leaving **14 written codes with no label**, and covering **0 of the 8** resource types that actually exist in the database | *(no action label map at all)* |
| `apps/worker/.../exports/generators/audit-csv.generator.ts:16` | *(a third consumer, easy to miss)* — reads `auditLog` and exports the `action` column **raw**, so the export inherits whichever vocabulary the row happens to carry | — |

Consequences, all measured: the facet dropdown offers French strings that fall through the label map unchanged; the
`criticalChanges` KPI matches `['delete', 'Suppression', 'Révision', 'revise']` — a set **straddling both
vocabularies**, which measured **9** by hitting the French `Suppression` while matching **no machine code at all**, and
whose `Révision` / `revise` members match nothing in either; `sensitiveExports` measured **7**.

Two further coverage holes fall out of the same read, both relevant to `G-PORTAL`:

- `PORTAL_LABELS` (`AuditPageFilters.tsx:37-41`) declares **three** portals. `packages/contracts/src/enums/index.ts:3`
  declares `PORTALS = ['admin','teacher','parent']` — also three. **`apps/web/src/app/student/` exists** (ADR-021), so
  an audit row carrying `portal: 'student'` renders as a raw lowercase string among French labels.
- `resourceType: 'calendar_event'` is absent from `RESOURCE_TYPE_LABELS` — the residual recorded at
  `docs/spec/features/v3-e06/PROGRESS.md:378` and inherited by this epic.

**Ruling.** One canonical audit vocabulary is **declared in `packages/contracts`**, the seed is corrected to write it,
and the label map is **derived** from it. The 54 pre-existing French rows are handled **explicitly** — see §4 `AC-9`
and the append-only ruling in §6 — never silently.

---

## 2. Target users and jobs-to-be-done

| Who | Job | What they need that does not exist today |
|---|---|---|
| **Auditor / DPO** (primary) | prove that a privileged action happened, by whom, when, from where, and that nothing was removed | a row that cannot exist without its mutation; a real actor role; a real provenance; a verifiable chain from a declared genesis; an honest statement of the pre-V3 gap |
| **Direction / head teacher** | answer "who changed this child's enrollment / this grade / this person's rights?" without an engineer | filters that include the day they selected; KPIs that agree with the table below them; French labels derived from one vocabulary |
| **School administrator** | act with confidence that their actions are recorded fairly and their own role is recorded correctly | `actorRole` derived from the caller's JWT, not a literal; no dead navigation entry advertising a governance surface that 404s |
| **Operator** | investigate an incident | provenance that distinguishes two operators; an IP field that is either the real client or **blank**, never the proxy |
| **Parent** *(deferred — §5)* | see who touched their child's data | the contracts-level vocabulary this epic declares, so the surface is later a read endpoint and a page |

---

## 3. Scenarios (end-to-end, demoable)

Each maps to a slice in `tasks.md`. Each is demoable against the **local** stack (`admin mme.dupont@voltaire.fr`).

**SC-1 — A super admin mints a role, and the trail says so.** *(S-E04-1)*
A `super_admin` creates a custom role. `/admin/audit` records `actorRole: super_admin` — not the literal
`school_admin` the code writes today at `roles.controller.ts:135`.

**SC-2 — The governance menu stops lying.** *(S-E04-2)*
An admin opens the sidebar. « Rapports » is gone (or resolves). « Audit » opens a page that **renders**, with filters,
KPIs and the diff drawer working — verified by an authenticated render, not by reading the file.

**SC-3 — Two operators are distinguishable.** *(S-E04-3)*
Two admins on two machines each perform an audited action. Their rows carry **different** `ip_address` values and a
real `user_agent` — or, if the pinned hop count cannot resolve a trustworthy client address, **both are blank**, and
the page says « provenance non disponible ». Never the web container's address for both.

**SC-4 — A French audit page over machine-coded data.** *(S-E04-4)*
The `resourceType` dropdown offers « Rôles », « Notes », « Évaluations », « Événement du calendrier » … and filtering by
one returns rows. A row written before the vocabulary landed is shown with an explicit « format hérité » marker, not
silently mislabelled.

**SC-5 — The cards agree with the table.** *(S-E04-5)*
An admin filters to a single day — **today**. The table shows N rows (including rows written this afternoon), and the
« Événements » card reads exactly N. Every card states its scope.

**SC-6 — A failed mutation leaves no trail, and a trail implies its mutation.** *(S-E04-6 — the `G-AUDIT` flagship)*
A role grant is made to fail inside its transaction. Neither the `user_role` row **nor** the `audit_log` row exists.
Inverted: the audit insert is made to fail; the grant does not happen either.

**SC-7 — A new unaudited mutation cannot be merged.** *(S-E04-7)*
A developer adds a `prisma.auditLog.create` outside a transaction. A blocking check names the file and the line.

**SC-8 — The chain verifies, and the gap is stated.** *(S-E04-8)*
An admin runs chain verification. It reports **verified from genesis**, and states in the same breath that **54 rows
predate the genesis and carry no chain — permanently, by decision `A-01`**. Deleting a chained row makes verification
fail and name the break.

---

## 4. Acceptance criteria (epic level)

`AC-1` … `AC-5` are the epic contract's, **verbatim**. `AC-6` … `AC-12` are added by this spec, because the measurement
found scope the contract does not cover. Each names the slice that owns it. **None is claimed met by this document.**

| id | Criterion | Owner slice |
|---|---|---|
| **AC-1** | `/admin/audit` renders; filters, KPIs and the diff drawer work | `S-E04-2` (render), `S-E04-4`/`S-E04-5` (filters, KPIs) |
| **AC-2** | Role grant/revoke, school mutation, enrollment decision, grade publish and every finance action write an audit row in the same transaction as the change — proven by a rollback test that leaves neither | `S-E04-6` |
| **AC-3** | Actor role is the caller's real role; tenant, IP and UA are populated; chain verifies from genesis | `S-E04-1` (role), `S-E04-3` (IP/UA), `S-E04-8` (chain) |
| **AC-4** | The `to` filter includes the selected day; all four KPIs are correct by definition | `S-E04-5` |
| **AC-5** | `/admin/reports` either works or the navigation entry is gone — no dead link | `S-E04-2` |
| **AC-6** | The audit-provenance helpers (`sanitiseInetOrNull`, `truncateUserAgent`, `MAX_USER_AGENT_LENGTH`, actor-role derivation) live in **one** shared home under `apps/api/src/shared/audit/`, and a check proves no second copy exists | `S-E04-1` |
| **AC-7** | The `trust proxy` posture is settled by a **written ADR** carrying a **pinned hop count** against the real Traefik → nginx → api topology; blanket `X-Forwarded-For` trust is refused in writing, with the reason | `S-E04-1` |
| **AC-8** | Where a trustworthy client address cannot be derived, `ipAddress` is **null** and the UI says so — the principle *« une provenance absente, jamais une provenance fausse »* holds in **both** directions (malformed **and** wrong) | `S-E04-1`, `S-E04-3` |
| **AC-9** | Exactly one audit vocabulary is declared in `packages/contracts/src/audit/` (`ADR-037`); **all three** consumers derive from it — the web label map (the local `RESOURCE_TYPE_LABELS` is deleted, not extended), the API KPI predicates, and the worker's `audit-csv` generator; the seed writes codes; the 54 legacy French rows are returned with `vocabulary: "unknown"` and their raw value, and are **never rewritten** | `S-E04-4` |
| **AC-10** | `adminLogins` is either backed by a real login audit row or **removed with the reason stated in-product and in the ledger** — it is not left as a card that can only read `0` (`DNC-09`) | `S-E04-5` |
| **AC-11** | Every audit write goes through the shared seam and inside a transaction; a **blocking** check fails on a new `auditLog.create` that does neither, and the check is shown able to fail | `S-E04-7` |
| **AC-12** | Chain verification **fails** when it cannot run (`DNC-08` — never a skip, never a pass); no environment variable, flag or string comparison can disable the audit writer or the verifier (`DNC-10`) | `S-E04-8` |

---

## 5. Non-goals (hard)

1. **Retention and legal-hold policy.** Out of scope by the epic contract — it needs D-08-adjacent legal input, and
   risk `R-13` forbids this routine authoring policy text. This includes *how long* an audit row lives and *who may
   ever remove one*.
2. **The parent transparency panel « Qui a consulté les données de mon enfant ».** Named in §1.2 as the reason the
   vocabulary lands in `packages/contracts`, and **not built here**. It needs a guardianship-scoped read endpoint, its
   own `G-AUTHZ` negative tests per role, and a product decision about which action types are parent-visible at all
   (a role revoke is not a parent's business; a grade publish on their child is). Audit data stays **admin-only** in
   this epic.
3. **Building `/admin/reports`.** Rejected. Three further measurements (`ux.md` §8) turn this from a
   remove-or-build question into an easy one: `/admin/exports` is already titled « Exports & Rapports »;
   `/admin/analytics` exists and is titled « Analytique des performances »; and **`/admin/analytics` has no sidebar
   entry at all** — it is reachable only from two in-page links, one of which uses the **same `BarChart3` icon** the
   dead « Rapports » entry carries. So the admin menu advertises a third name for a job two live pages already do,
   while a real page sits orphaned under that icon.
   **The ruling is therefore *repoint and rename*, not *remove*:** the entry becomes
   `{ key: 'analytics', label: 'Analytique', href: '/admin/analytics' }`. It satisfies `AC-5` and closes a second
   navigation defect the criterion did not know about, for one line. The label must match the destination's own
   `PageHeader` title, or the menu lies in a new way. **Removing the entry outright is the acceptable fallback**
   (it satisfies `AC-5` literally and leaves `/admin/analytics` orphaned); **building a third reporting page is
   refused** — nothing in the epic contract or the cahier asks for one, and it would be `DNC-09`. If a distinct
   reports surface is ever wanted, it is a `V3-E03` capability behind decision `D-09`, not a link-hygiene fix.
4. **Fixing `PF-96`** (`AuditLog` has no `@relation` to `Tenant`, so audit rows outlive their tenant — measured:
   deleting two tenants cascaded away all 44 of their `calendar_event` rows and left all 6 of their `audit_log` rows).
   This epic **references** it and the `S-E04-8` ADR **states the posture as an open item**; it does not change the
   relation. A reflex `onDelete: Cascade` would let a tenant deletion erase its own audit history — the opposite of
   what this epic is for.
5. **Backfilling the 54 pre-V3 rows** with IP, UA or chain values. Impossible, and fabricating them would be worse than
   the gap. Risk `A-01`, permanently accepted; risk `R-10`, accepted and documented.
6. **A second BullMQ queue, a new portal, a new permission.** `audit.read` already exists and already guards both
   endpoints. Any new endpoint reuses it (see `plan.md` §7).
7. **Changing what a KPI *means* beyond removing a structurally impossible one.** Contested metric definitions are
   `D-09` / `V3-E03`. This epic makes the four audit KPIs *agree with their own table* and *state their scope*; it does
   not litigate which definition a school intends.
8. **Rewriting history to make a number look right.** See §6.

---

## 6. The append-only ruling (a product decision this spec makes, not defers)

The 54 legacy rows carry French display strings in `action` and `resource_type`. The tempting fix is a data migration
that maps the 13 French values onto canonical codes — the mapping is total and unambiguous.

**Refused.** `AuditLog` is append-only. An `UPDATE` over audit rows to make a KPI count correctly is precisely the
class of act this epic exists to make detectable, and doing it *in the epic that installs the hash chain* would be
incoherent. It would also be undetectable afterwards: the rows are pre-genesis, so no chain covers them.

**The ruling, therefore:**

- the **seed** is corrected so a fresh local seed writes canonical codes (`S-E04-4`);
- the existing rows are **left exactly as they are**;
- the audit page renders an unrecognised code by **falling through to the raw value with an explicit « format hérité »
  marker** — honest, not silently mislabelled;
- the KPI definitions in `S-E04-5` are stated over the **canonical** vocabulary, and the resulting under-count of
  legacy rows is **labelled on the card**, not hidden.

This is deliberately the less flattering option. A local re-seed would make the problem disappear on this machine, and
that is exactly why the decision must not depend on it.

---

## 7. Reuse map (verified on disk, 2026-08-08 — build on this, do not duplicate)

| Exists | Where | Use it for |
|---|---|---|
| `AuditLog` model | `apps/api/prisma/schema.prisma:1225-1244` — `hash`, `prevHash` nullable and **unused**; `@@index([tenantId, createdAt])`; **no `@relation` to `Tenant`** (`PF-96`) | the chain lands in the existing nullable columns; only the index/constraint work is additive |
| `GET /api/v1/analytics/audit` + `/audit-facets` | `analytics.controller.ts:225`, `:255` — both `@RequiresPermission('audit.read')`, `tenantId` **server-derived** from `me.tenantId`, `limit` capped at 200 | extend; do not add a parallel controller |
| `deriveAlertActorProvenance(jwt)` | `apps/api/src/modules/alerts/alert-provenance.ts:33` — already used by 6 call sites | **promote** to `shared/audit/`, do not re-implement |
| `sanitiseInetOrNull` / `truncateUserAgent` / `MAX_USER_AGENT_LENGTH` | `apps/api/src/modules/calendar/calendar-seed.service.ts:11,25,33` — in a **feature** module | **move first** (`tasks.md` T-0), so a second copy is never written |
| The in-transaction audit idiom | `tx.auditLog.create` at `calendar-seed.service.ts:237`, `child-claims.service.ts:724`, `assessments.controller.ts:290`, `imports.service.ts:436`, `academic-years.controller.ts:262`, `subjects.controller.ts:223` (**6 of 28**) | the pattern the other 22 sites adopt |
| `packages/contracts` | already the home of `PORTALS`, `REALM_ROLES`, `RESULT_STATUS`… ; built to CJS (`dist/`), so Node loads it at runtime (`project-context.md` §1) | the canonical audit vocabulary — in a new `src/audit/` module per `ADR-037`, not appended to `src/enums/index.ts` |
| `apps/worker/.../exports/generators/audit-csv.generator.ts` | the **third** consumer of the vocabulary, exporting `action` raw | must derive its labels from the same declaration — a two-consumer fix leaves the export drifting |
| `scripts/*-check.js` + `scripts/ci-gate.sh` + `.github/workflows/ci.yml` | the established ratchet family (`production-artefact-check`, `link-integrity-check`, `observability-check`, `schema-drift-check`) | the `S-E04-7` writer gate and the `S-E04-8` chain gate |
| `scripts/link-integrity-baseline.json:20` | the `/admin/reports` row, owner already `V3-E04` | `S-E04-2` **retires** the row rather than editing its reason |

---

## 8. Gates — how each will be evidenced (never "is met")

| Gate | Triggered by | How this epic will evidence it |
|---|---|---|
| **G-AUDIT** *(primary)* | every slice from `S-E04-6` on | a **rollback test**: the mutation is made to fail inside its transaction and **neither** row exists; and inverted, the audit insert is made to fail and the mutation does not persist. Per family, not once |
| **G-TRUTH** | `S-E04-4`, `S-E04-5` | one fixture; every KPI's scope **labelled** (all-time vs filtered) and identical for the same fixture; a unit test per KPI definition, each shown able to fail |
| **G-TENANT** | every slice touching a query | every new/edited query tenant-keyed; a foreign-tenant id denied on any new path. **Two things must be said plainly rather than implied.** (i) **`PF-96`**: `AuditLog` has no FK to `Tenant`, so the tenant-keyed *query* is the only wall — referenced, not fixed. (ii) **RLS does not exist anywhere in the repository** — measured: **0 occurrences** of `ENABLE ROW LEVEL SECURITY` / `CREATE POLICY`, including in `0_baseline/migration.sql`, although `ADR-002` declares it. This epic's tenant scoping is **application-level only**; `ADR-032` / `V3-E01` owns that work. **Never write "RLS protects the audit rows"** |
| **G-AUTHZ** | `S-E04-1`, `S-E04-2`, `S-E04-8` | `audit.read` is already required on both endpoints; any **new** endpoint (chain verification) needs a negative test **per role that must be denied**, including `student` |
| **G-PORTAL** | `S-E04-4` | the vocabulary lands in `packages/contracts` and is therefore visible to **all four** portals. Check admin, teacher, parent **and student** — `PORTALS` and `PORTAL_LABELS` are both 3-valued today while `apps/web/src/app/student/` exists |
| **G-MIGRATION** | **`S-E04-5` and `S-E04-8`** — stated per slice in `tasks.md`, including the six slices where it does **not** trigger | a **reviewed** migration file under `apps/api/prisma/migrations`, never `db push`, expand/contract shape, stated rollback, and `scripts/schema-drift-check.js` green (`ADR-027`). `S-E04-5` triggers it because the day-inclusive `to` boundary must be computed in a declared timezone and **`Tenant` has no `timezone` column** — only `School.timezone` (default `Europe/Paris`) exists. `S-E04-8` triggers it for the chain's ordering guarantee |
| **G-DNC** | always | none of `DNC-01…DNC-12` reproduced. Sharpest: **`DNC-08`** — a chain check that cannot run must **FAIL**, never skip; **`DNC-10`** — no env var, flag or string comparison may turn the audit writer or the verifier off; **`DNC-09`** — no card, page or label promising a capability the runtime lacks |

---

## 9. Definition of done (epic)

1. `PF-14`, `PF-31`, `PF-32` `closed` in `docs/daily-improvement-v3/traceability-matrix.md`, each with executed
   evidence — or **explicitly `partial`** with the residual named and owned.
2. `G-AUDIT` evidenced by a rollback test per privileged family, not asserted.
3. `R-10` accepted and documented; `A-01` recorded as permanent; the genesis gap stated **in-product**, not only in a
   markdown file.
4. **Three** ADRs written, one per slice that carries a decision: **`ADR-036`** — client provenance behind the proxy
   (`S-E04-1`); **`ADR-037`** — the audit vocabulary lives in `packages/contracts`, not a Postgres enum, with the
   French label attached to the code (`S-E04-4`); **`ADR-035`** — audit in-transaction, chain genesis and the accepted
   pre-V3 gap (`S-E04-6`, amended by `S-E04-8`; the reservation already held for `V3-E04`). See `plan.md` §7 for the
   numbering rule and the obligation to re-check `docs/adr/` first.
5. `PF-96` referenced with a stated posture; the `/admin/reports` baseline row retired; the `calendar_event` label
   residual from `v3-e06` closed.
6. This epic's `PROGRESS.md` carries a **"Not claimed"** table, per house posture — naming what was measured and what
   was not.
