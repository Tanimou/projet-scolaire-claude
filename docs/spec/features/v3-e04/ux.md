# V3-E04 — UX (Sally lens: premium, colorful, kind, WCAG 2.2 AA)

> **Epic.** *Audit trail and governance surfaces* — L0 · M · depends on `V3-E02` (`code-complete`),
> blocks `V3-E03` and `V3-E11`. Closes `PF-14`, `PF-31`, `PF-32`. Primary gate **G-AUDIT**.
> Contract: [`docs/daily-improvement-v3/epics/V3-E02-E06-layer0.md` § V3-E04](../../../daily-improvement-v3/epics/V3-E02-E06-layer0.md).
>
> **Posture of this file (house rule, from `v3-e06/PROGRESS.md` and `v3-e02/PROGRESS.md`).**
> Every quantity below is either **measured this run against the running local Docker stack** and marked
> `[measured]`, **computed deterministically** from a hex value in the shipped source and marked `[computed]`,
> or explicitly marked **`[UNMEASURED]`**. Nothing here claims a gate is met — §14 states how each UX
> criterion **will be evidenced**. No browser was driven for this spec: `apps/web` has no unit runner
> (Playwright only) and a live probe of `/admin/audit` returns `307 → /admin/login`, so **every rendering
> claim in this file is read from source, not observed**. That limitation is the subject of §4 D-1.

---

## 0. What this file is, and what it deliberately is not

**Is.** The UX contract for the epic's two surfaces: the existing `/admin/audit` page (four files,
922 lines, all read this run) and the dead `/admin/reports` navigation entry. It defines the key screens
and their states, the information → action flow, the honest rendering rules for provenance and for the
vocabulary split, the `@pilotage/ui` reuse ledger, and the WCAG 2.2 AA bar with the contrast values
already computed.

**Is not.** It is not `spec.md` (John), not `data-model.md` / `contracts/openapi.yaml` (Winston), not
`tasks.md`. Where a UX decision forces a data or contract decision — and in this epic it does, twice, in
§6 and §7 — this file states the **UX requirement** and names the file that must carry the decision. It
does not make the ADR ruling.

**Note on the standing NFR.** *"Mobile-first, parent < 2 s"* governs the **parent dashboard**. `V3-E04`
has **no parent surface today** (audit data is admin-only, and §1's transparency panel is explicitly a
horizon, not a scope). The applicable bars here are therefore: (a) the admin surface stays fully usable
down to 320 CSS px (SC 1.4.10 Reflow), (b) the audit page must not become slower than it is — it already
issues 2 parallel fetches with `cache: 'no-store'` under `force-dynamic`, and §5.2's per-KPI scope work
must not turn 4 counts into 8 round trips, and (c) **G-PORTAL** applies in full, because the vocabulary
declaration lands in `packages/contracts`, which all four portals import.

---

## 1. Who these surfaces serve

| Role | The job to be done | What "done" feels like |
|---|---|---|
| **Auditor / DPO** (primary) | *"Prove to me who changed this child's record, when, from where — and prove nothing was removed."* | A filtered view whose numbers agree with its own table; a diff they can read; a chain verdict they can trust because its gaps are named. |
| **Direction / chef d'établissement** | *"Did anything unusual happen this week?"* | Four KPIs whose scope is written on them, and a period filter that includes today. |
| **Operator / support** | *"Reproduce what this admin did before the incident."* | Exact timestamps, real actor role, a resource id they can copy. |
| **Parent** *(horizon, not this epic)* | *"Who looked at my child's data?"* | Not built here. See the note below. |

**The transparency horizon, stated so §6 is not read as gold-plating.** The cahier's RGPD posture
(minimal access, append-only audit, factual and non-stigmatising tone) implies an eventual parent-facing
*droit d'accès* surface — « Qui a consulté les données de mon enfant » — derived from these same rows,
scoped to one child, showing actor **names** and never actor **IPs**. `V3-E04` does **not** build it: it
needs a guardianship-scoped read endpoint, per-role G-AUTHZ negative tests, and a product decision about
which action types are parent-visible at all (a role revoke is not a parent's business; a grade publish
on their child is). What `V3-E04` owes it costs nothing extra **this** epic and is §6: declare the audit
vocabulary once, in `packages/contracts`, with the human label attached to the **code**. Declared that
way, the parent panel is later one endpoint and one page. Declared the current way — display strings
frozen into structural columns, plus a label map inside an admin client component — it is a second
vocabulary and a second drift.

---

## 2. Principles (the through-line)

1. **A blank is kinder than a lie.** *« Une provenance absente, jamais une provenance fausse. »* The
   audit surface must never render a value it cannot vouch for as though it could. This is the principle
   the current `ipAddress` capture **inverts** (§7), and it is why the hash chain must be built *after*
   the writer is correct, never before.
2. **Every number carries its own scope.** A count sitting next to a table must state whether it counts
   the same rows as the table. Today three of four do not, and nothing on screen says so (§5.2). This is
   **G-TRUTH** applied to a KPI strip.
3. **Governance is calm, never alarming.** This page reports on colleagues. Red is reserved for *the
   chain does not verify* and for genuine failure. A deletion is `rose`, factual, never accusatory.
   No copy implies wrongdoing; no copy names a person in a warning.
4. **Explainable, not just displayed.** A row answers *who / what / when / where / from what to what*.
   Where one of the five is unknown, it says **unknown** and says **why** — not `—`.
5. **The keyboard is a first-class actor.** An audit page whose diff drawer only opens on a mouse click
   (measured: §4 D-2) does not have a working diff drawer. AC-1 is not met until it opens from the
   keyboard.
6. **Reuse first.** `@pilotage/ui` already ships every primitive this epic needs (§13). The one new
   thing worth building is a **shared provenance/vocabulary rendering module in `apps/web`** — and even
   that is app-level, not `packages/ui`.

---

## 3. Surface map

| Surface | Route | Exists? | What changes |
|---|---|---|---|
| **Journal d'audit** | `/admin/audit` | ✅ 4 files, 922 L | Every section below is touched: KPI scope labels, inclusive `to`, vocabulary rendering, provenance honesty, keyboard operability, timestamps. |
| **Diff drawer** | `/admin/audit` (drawer) | ✅ `AuditDetailDrawer.tsx` | Keyboard-openable; provenance block rewritten (§7); legacy-row marker (§6). |
| **Chain verification** | `/admin/audit` (new panel) | ❌ | New, and **last** (§14 slice order). Renders a genesis-anchored verdict *and* the documented pre-V3 gap. |
| **CSV export** | `/admin/audit` (header action) | ✅ `actions.ts` | Must inherit the same inclusive `to` and the same vocabulary as the table, or the export contradicts the screen. |
| **« Rapports »** | `/admin/reports` | ❌ **dead link** | §8 — a recommendation with measured evidence. |
| **Parent transparency panel** | — | ❌ | **Out of scope.** Horizon only (§1). |

---

## 4. The measured UX defects, mapped to acceptance criteria

Each row is a defect a user can feel. Evidence is from this run's Step-2 measurement against the running
local stack, or from reading the shipped source this run.

| id | Defect | Evidence | AC | UX consequence |
|---|---|---|---|---|
| **D-1** | **Does `/admin/audit` still crash? OPEN.** `page.tsx` is a server component with `force-dynamic`, wraps both fetches in a `safe()` `ApiError` swallower, and imports `humanizePortal` / `humanizeResourceType` as **values** from a `'use client'` module — legal in Next 15, but it pulls them into the client bundle. `PF-14`'s boundary crash **did not reproduce statically**. A live probe returned `307 → /admin/login?callbackUrl=%2Fadmin%2Faudit`, so the authenticated render was **never observed**. | source + live probe `[measured]` | AC-1 | Treat as an **open measurement**, not a closed question in either direction. Settle it by an authenticated render (§14 S1). |
| **D-2** | **The diff drawer cannot be opened from a keyboard.** `AuditTable.tsx:93` is `<tr onClick={…} className="cursor-pointer …">` with **no `tabIndex`, no `role="button"`, no `onKeyDown`**. There is no other affordance: the chevron cell at `:151` is a `<span>`, not a button. | source `[measured]` | AC-1 | **SC 2.1.1 Keyboard (A) failure.** For a keyboard or screen-reader auditor, before/after — the whole point of the page — is unreachable. AC-1's *"the diff drawer works"* is false for them today. |
| **D-3** | **The column says « Date & heure » and renders no heure.** `formatDateLong` (`packages/ui/src/lib/format.ts:65`) emits `toLocaleDateString(fr, {day, month, year})` — date only. Both the table (`AuditTable.tsx:99`) and the drawer (`AuditDetailDrawer.tsx:86`) use it. | source `[measured]` | AC-1, AC-4 | Two actions on the same day are indistinguishable and un-orderable. An auditor cannot verify the `to`-filter fix by eye, because the boundary they are checking is invisible. |
| **D-4** | **The `to` filter drops the selected day.** `analytics.service.ts:3251` → `lte: new Date(to)`, so `to=2026-08-08` becomes `2026-08-08T00:00:00Z`. | source `[measured]` | AC-4 | « Aujourd'hui » returns **zero rows** for everything that happened today — the single most likely first click on this page. |
| **D-5** | **Three of four KPIs ignore every filter.** `analytics.service.ts:3310-3326` computes all four with a `where` that uses `tenantId` only — `from`/`to`/`action`/`resourceType`/`portal`/`actorId` are dropped. `today` is genuinely all-time-today by design; the other three are silently all-time. | source `[measured]` | AC-4 | Filter to one week and the cards do not move. The table says 3, the card says 9. **The user is never told which one to believe.** |
| **D-6** | **« CONNEXIONS ADMIN » is structurally always 0.** Measured 0 `[measured]`; **no call site in the entire API writes any login audit row** `[measured]`. | live DB + call-site census | AC-4 | A card that can only ever read `0` teaches the reader that the page is broken, and then they stop reading the other three. |
| **D-7** | **The vocabulary split — the biggest finding of the run.** The 54 live rows carry **French display strings in the structural columns**: `resource_type ∈ {Professeur, Note, Classe, Élève, Inscription, Évaluation, Résultats, Année scolaire}` (8 values), `action ∈ {Création, Mise à jour, Suppression, Validation, Export}` (5 values) `[measured]`. The 28 real API call sites write **machine codes** (`resourceType: 'role'`, `action: 'role.create'`) `[measured]`. `RESOURCE_TYPE_LABELS` (`AuditPageFilters.tsx:21-35`) maps **13 machine codes** and covers **0 of the 8** resource types that exist in the database `[measured]`. | live DB + source | AC-1, AC-4, **G-TRUTH**, **G-PORTAL** | The facet dropdown offers French strings that fall through the label map unchanged; the machine codes the API writes will render as `Role`, `Grade`, `Calendar event` — English, among French labels (`resourceType: 'calendar_event'` is the already-recorded instance). And `criticalChanges` matches `['delete','Suppression','Révision','revise']` — a set **straddling both vocabularies**, which measured **9** by hitting French `Suppression` while matching **no machine code at all**, and whose `Révision`/`revise` members match nothing in either `[measured]`. `sensitiveExports` measured **7** `[measured]`. |
| **D-8** | **`actorRole` is a literal on 8 of 28 call sites.** `identity/invite.controller.ts:155`, `identity/roles.controller.ts:135` `:185` `:219`, `imports/imports.service.ts:440`, `integrations/integrations.service.ts:639`, `school-structure/academic-years.controller.ts:266`, `school-structure/subjects.controller.ts:227` `[measured]`. The other 20 already take `actorRole` from args. Live rows: `school_admin` on 53 of 54, `teacher` on 1 `[measured]`. | census | AC-3 | The drawer renders `actorRole` under the actor's name as fact. On those 8 paths a `super_admin` is displayed as a `school_admin`. **State `PF-31` precisely — 8 sites, not "all" — rather than repeating the audit's blanket claim.** |
| **D-9** | **Provenance is blank on every row, and the fix that looks obvious is worse than blank.** `count(ip_address) = 0`, `count(user_agent) = 0` over 54 rows `[measured]`. See §7 — this is the epic's opening decision. | live DB | AC-3 | The table reserves a « Portail · IP » column and the drawer an InfoCard hint for a value that is always absent. |
| **D-10** | **The chain has never existed.** `count(hash) = 0`, `count(prev_hash) = 0` over 54 rows; **no call site anywhere writes `hash` or `prevHash`**; `alerts.service.ts:607` carries a comment saying they are *"left unset, matching every other"* site `[measured]`. | live DB + census | AC-3 | Nothing to render yet — and per **risk A-01** backfill of the 54 pre-V3 rows is **impossible**. §5.6 specifies how the gap is *shown*, never fabricated. |
| **D-11** | **Transactionality is broken at the measured site.** `identity/roles.controller.ts` `create()` does `prisma.role.create(...)` then a **separate** `prisma.auditLog.create(...)` with no `$transaction` `[measured]`. | source | AC-2 | The role can exist unaudited. No UI can fix this; the UX consequence is that the page is trusted for a completeness it does not have — which is why §5.6's chain panel must not overstate. |
| **D-12** | **`/admin/reports` is a dead navigation entry.** No `apps/web/src/app/admin/reports` directory; linked from `sidebar-items.ts:175`; already inventoried in `scripts/link-integrity-baseline.json`. Live probe: `307 → /admin/login?callbackUrl=%2Fadmin%2Freports` — the middleware intercepts, so the **404 is reached only after login** `[measured]`. | source + probe | AC-5 | The worst shape of a dead link: the user authenticates *in order to* reach it, then gets a 404. §8. |
| **D-13** | **Small-text contrast fails on the forensic details.** `text-slate-400` (`#94a3b8`) is used for the relative time, the truncated `resourceId`, the IP address and the `—` placeholders, at 10–11 px. **`[computed]` 2.56:1 on white, 2.45:1 on `slate-50`** — SC 1.4.3 requires 4.5:1. The focus ring `focus-visible:ring-blue-400/40`: `blue-400` **`[computed]` 2.54:1 at full opacity**, and at 40 % alpha over white it is necessarily lower — SC 1.4.11 requires 3:1. | computed from shipped hex | — | Exactly the values an auditor squints at are the least legible on the page. |
| **D-14** | **Three smaller source-read defects, listed so they are not rediscovered.** (a) `AuditTable.tsx:152` uses `group-hover:` classes but **no ancestor carries `group`** — the chevron affordance never lights. (b) `<th>` elements at `:79-85` have no `scope="col"`. (c) the `aria-live="polite"` region at `:165` is **mounted at the same moment its content appears**, so it may not announce at all — the same shape already recorded against `S-E06-6`'s scope region. | source `[measured]` | AC-1 | Small, cheap, and each one is a real assistive-technology gap. |

---

## 5. `/admin/audit` — screen specification

Layout stays the proven admin recipe: `PortalShell` → `PageHeader` → KPI grid → filter strip →
table card → footnote. Nothing about the composition changes; every section's **honesty** does.

### 5.1 Header

Keep `PageHeader` with the breadcrumb and the append-only subtitle — the copy is already right.

Two changes:

- The « Exporter en CSV » control is a hand-rolled `<button>` with bespoke classes. Replace with the
  `Button` primitive (`@pilotage/ui`) so it inherits the focus treatment §11 requires. Its hidden
  `from`/`to` inputs must be the **same** values the table used, and the export must apply the same
  inclusive `to` (D-4) — an export whose row count differs from the screen's is a G-TRUTH defect of its
  own.
- Add a **scope line** under the subtitle stating the period actually applied, resolved server-side:
  *« Période affichée : du 1 août au 8 août 2026 inclus »* — or, with no filter, *« Toutes les entrées »*.
  This is where the inclusive-day fix becomes *visible* rather than merely correct.

### 5.2 The KPI strip — every card states its own scope (G-TRUTH)

Four `KpiCard`s stay; the grid stays `1 / sm:2 / xl:4`. What changes:

| Card | Today | Required |
|---|---|---|
| **ACTIONS AUJOURD'HUI** | all-time-today, correct by definition | keep. Sub-label: *« Aujourd'hui · établissement entier »* — say the scope even when it is right, so all four cards read the same way. |
| **MODIFICATIONS CRITIQUES** | all-time, dual-vocabulary matcher (D-7) | Must count **the filtered set** and say so: *« Sur la période filtrée »*. The matcher must be the canonical action codes from §6 — never a hand-written string list. |
| **EXPORTS SENSIBLES** | all-time `contains 'Export'` | Same: filtered, canonical codes, scope sub-label. |
| **CONNEXIONS ADMIN** | structurally always `0` (D-6) | **Two honest options, and the choice belongs in `spec.md`.** (a) *Make it true* — emit a login audit row, and the card becomes real. (b) *Remove the card* and rebalance the grid to three. **What is forbidden is keeping a card that can only display `0`.** UX preference: (a), because « qui s'est connecté » is genuinely the second question a DPO asks — but (a) is a new write path on the auth flow and may not fit this epic's size. If (b), state the removal in `PROGRESS.md` as a removal, not a silent grid change. |

**Rendering rule for the scope label.** It is a real element, not a tooltip: tooltips are invisible to
touch, to keyboard, and to anyone in a hurry. Put it in `KpiCard`'s existing `children` slot — the
component already renders that region (used today for *« Sur l'ensemble de l'établissement »*), so **no
`packages/ui` change is needed**.

**Empty-filter parity rule (testable, and §14 makes it an AC).** With no filter applied, a filtered KPI
and its all-time counterpart must return the **same** number over the same fixture. That equivalence is
what makes "filtered" a claim rather than a label.

### 5.3 Filter strip

`FilterBar` + `SearchInput` + three `SelectFilter`s + the date row + the active-chip row — all keep.

- **Inclusive `to` (D-4).** The label « Au » becomes **« Jusqu'au (inclus) »**, and the active chip
  becomes *« Jusqu'au 8 août inclus »*. The word *inclus* is the user-visible half of AC-4; without it
  the fix is invisible and the next reader re-reports the bug.
- **`QuickRangeButton` must survive the fix.** It computes `to` from `new Date().toISOString()` — a
  **UTC** day, while the operator reads a Paris day. Whatever inclusive-boundary rule the API adopts,
  the quick ranges must produce the same day the user sees. Cross-check `« Aujourd'hui »` explicitly:
  it is the click most likely to return an empty page today.
- **Facet labels.** `resourceTypeOptions` are labelled through `humanizeResourceType`, which covers
  **0 of the 8 live values** (D-7). After §6, options are built from the canonical enum, and a value not
  in it renders through the legacy path of §6.3 — visibly legacy, never silently unlabelled.
- **Reset.** Keep « Réinitialiser ». Its 3.5 px icon + text button must reach the 24 × 24 CSS px target
  floor (SC 2.5.8) — see §11.

### 5.4 The table

Structure is right; three things must change.

**(a) Make the row keyboard-operable (D-2).** The row is the control. Two acceptable shapes:

- *Preferred:* keep `<tr>` semantics and put a real `<button>` in the last cell — `aria-label={\`Voir le
  détail de ${action} sur ${ressource} du ${date}\`}` — while the row keeps its `onClick` as a mouse
  convenience. The button is focusable, has an accessible name, and is announced in the row's context.
  The chevron `<span>` becomes that button (and finally gets the missing `group` class, D-14a).
- *Acceptable:* `<tr tabIndex={0} role="button">` + `onKeyDown` for Enter/Space. Cheaper, but it puts a
  `button` role on a `row` and loses the table's own navigation semantics. Prefer the first.

Either way: visible focus ring meeting §11, and focus **returns to the trigger** on drawer close — the
shared `Drawer` already restores focus to its trigger (hardened in `E3-S3`), which is the reuse argument.

**(b) Show the time (D-3).** « Date & heure » must render date **and** time — `8 août 2026, 14:32:07`
(seconds matter: audit rows in the same second are the interesting case) — with `formatRelativeTime`
kept as the secondary line. Do **not** change `formatDateLong`'s behaviour in `packages/ui`: it is used
across the product and this is an audit-local need. Either add a sibling formatter in `packages/ui/src/lib/format.ts`
(a genuinely shared need — a `formatDateTimeLong`) or format locally in the audit module. **Winston
rules**; UX only requires that the time be visible in the table *and* the drawer.

**(c) Row density and the mobile card (SC 1.4.10).** Seven columns cannot reflow to 320 px. Today the
table is wrapped in `overflow-x-auto`, which technically satisfies Reflow for a data table — but a
horizontally scrolling forensic table on a phone is not usable. Required:

- `< md` — render each entry as a **card**, not a table row: line 1 action badge + resource chip;
  line 2 actor + role; line 3 timestamp + portal; line 4 the provenance line of §7. The card is a
  `<button>` opening the same drawer. This reuses the pattern already shipped elsewhere in `/admin`.
- `≥ md` — the table, unchanged in shape, with `overflow-x-auto` retained as the safety net.
- The horizontal scroller must keep its own `overflow-x: auto` and the page body must never scroll
  horizontally.

**(d) `scope="col"` on every `<th>`** (D-14b), and a `<caption class="sr-only">` naming the table and its
current filter scope — so a screen-reader user knows *which* rows they are in without re-reading the
filter strip.

### 5.5 The diff drawer

`DetailDrawer` (over the focus-trapped `Drawer`) stays. Changes:

- **Timestamp** gains the time (D-3), and the `id` stays monospace and copyable.
- **The provenance block is rewritten** per §7. Today `InfoCard(icon=Globe2, label="Portail",
  value=humanizePortal(portal), hint=ipAddress)` renders the IP as a quiet hint under the portal —
  i.e. *"where the admin acted from"*. That framing is exactly what §7 forbids.
- **Legacy marker.** A row written in the pre-canonical French vocabulary carries a small neutral
  `Badge` — *« Entrée historique »* — with one line of explanation (§12). Not a warning colour: these
  rows are not suspect, they are older than the vocabulary.
- **Before / After panels** keep their rose/emerald framing — this is the one place where colour
  carries real semantics and it works. Two additions: (i) an `<h4>`-level heading per panel so the
  drawer's heading outline is navigable; (ii) the « Copier JSON » button must have an accessible name
  that survives the `Copié ✓` swap — use a stable `aria-label` and let the visible text change, or the
  button loses its name mid-interaction (the `S-E06-6` `'…'` shape).
- **Empty `before`** on a creation is `—` today. Say it: *« Aucune valeur antérieure — création »*. A
  `—` in a forensic panel is ambiguous between *nothing changed*, *not recorded* and *created*.

### 5.6 The chain-verification panel (new — and **last**, per §14)

A panel above the table, only once the chain exists. Three states, and the third is the one that makes
this honest:

| State | Visual | Copy intent |
|---|---|---|
| **Vérifiée** | emerald `StatusBadge` + count | *« Chaîne vérifiée sur N entrées, depuis l'entrée d'origine du {date}. »* |
| **Rompue** | rose `StatusBadge`, `ErrorState` tone | Names the **first** row where verification fails, links to it. This is the one place red is correct. |
| **Non vérifiable** | slate/neutral | *« Vérification impossible : {raison}. »* **Never green.** Per **DNC-08**, a check that cannot run must **fail**, never skip — the UI must have no state in which an unrun verification looks like a passed one. |

**The genesis gap (risk A-01) is a permanent, first-class element of this panel, not a footnote.**
Backfill for the 54 pre-V3 rows is impossible `[measured]`. The panel therefore always shows two facts
side by side: *chain verified from the genesis row of {date}* and *{N} entries predate the chain and
carry no hash — this is documented, not a fault*. Fabricating hashes for those rows to make the panel
uniformly green would be the single worst thing this epic could ship.

**DNC-10 rule, stated as UX because it is user-visible:** no environment variable may turn the audit
writer off, and therefore no UI state may exist that means *"auditing is currently disabled"*.

### 5.7 Footnote

Keep the append-only note verbatim — it is good, accurate copy. One correction: *« RGPD requests
(oubli) »* mixes English into an otherwise French sentence; *« demandes d'effacement (RGPD) »*.

---

## 6. The vocabulary — declared once, rendered everywhere (G-TRUTH + G-PORTAL)

This is D-7, and it is the half of `PF-32` that is bigger than its written contract. It is a UX section
because it is a *rendering* problem with a *data* cause.

### 6.1 The rule

**Display text must never live in a structural column.** The canonical audit vocabulary — resource types
and action codes — is declared **once, in `packages/contracts`**, as codes with human labels attached to
the code. The label map in `AuditPageFilters.tsx` is then **derived**, not authored; the facet dropdown,
the table chip, the drawer heading, the CSV export and the KPI matchers all read the same source.

Consequences the UX depends on:
- A resource type added tomorrow (`calendar_event` is the standing instance) cannot render in English
  among French labels, because there is one place to add it and it is a compile-visible one.
- `criticalChanges` stops being a hand-written string list straddling two vocabularies (D-7) and becomes
  a named subset of the declared action codes.
- The parent panel of §1 later inherits the French labels for free.

**G-PORTAL check, mandatory:** the declaration lands in `packages/contracts`, which is imported by
`admin`, `teacher`, `parent` **and** `student`. Verify all four still build and that nothing in the
non-admin portals accidentally gains an audit-vocabulary import. Audit data stays admin-only in this
epic.

### 6.2 The 54 existing rows must be handled explicitly

Three options, in decreasing UX preference. **The decision belongs in `data-model.md` / `plan.md`; this
file requires only that it be made explicitly and never silently.**

1. **Migrate** — a reviewed migration under `apps/api/prisma/migrations` (never `db push`), expand/contract,
   with a stated rollback, mapping the 8 French `resource_type` values and 5 French `action` values onto
   canonical codes. Cleanest end state; **triggers G-MIGRATION in full**.
2. **Declare legacy and render honestly** — leave the rows, add a legacy branch in the renderer, mark
   them in the UI (§5.5). No migration; the split persists in the data forever.
3. **Do nothing** — **rejected.** It leaves a facet dropdown that offers strings the label map cannot
   label and a KPI that counts across two vocabularies.

Whichever is chosen, the **seed** must be corrected to write canonical codes, or the split is recreated
on the next reseed.

### 6.3 The legacy rendering path

If option 2 (or during option 1's expand phase), the renderer needs a deterministic fallback: a value not
in the canonical enum renders **as written**, with the `« Entrée historique »` marker of §5.5, and is
**excluded from canonical KPI matchers** — or included, but then the KPI's scope label says so. What is
forbidden is a matcher that silently spans both, which is precisely what produces today's `9`.

---

## 7. Provenance — the decision this epic opens with

**Inherited verbatim and unresolved** from `docs/spec/features/v3-e06/PROGRESS.md:370`.

**The measured situation.** `grep 'trust proxy|trustProxy'` over `apps/api/src` + `infra/` → **0 hits**;
`apps/api/src/main.ts:37` is a bare `NestFactory.create`, so Express `req.ip` is the **socket peer**. The
real chain is *browser → Next server action → the `apps/web` server-side `fetch` (which forwards only
Accept / Content-Type / Authorization) → nginx → API*. So the value stored would be the **web
container's** address — identical for every actor, forever — and `userAgent` is `null` on every
UI-driven write because undici sends none. `sanitiseInetOrNull` cannot catch this: **a proxy IP is a
valid inet.** Live rows confirm the end state: `ip_address` and `user_agent` populated on **0 of 54**
`[measured]`.

**Why this is a UX section.** The table renders IP in monospace under the portal badge and the drawer
renders it as the portal card's hint — both framings say *"where the admin acted from"*. Storing the
proxy address would make that sentence **false on every row**, which inverts the service's own stated
principle. And blanket `X-Forwarded-For` trust is **strictly worse than blank**: it makes the audit IP
**client-forgeable**, so a forged value would render with exactly the same authority as a real one.

**What the UX requires — three rules, and none of them is deferrable:**

1. **An ADR must carry a pinned hop count** against the real Traefik → nginx → api topology. The routine
   must **not** enable blanket XFF trust. *(Numbering cross-check for Winston, because this collided
   once already as `PF-110`: `docs/adr/` is the register of record and holds `ADR-001`…`ADR-028`;
   `architecture-impact.md` §4 reserves `029` → V3-E07, `030` → V3-E11, `031` → V3-E15, `032` → V3-E01,
   `033` → V3-E02, `034` → V3-E03, and **`035` → V3-E04 "audit in-transaction, chain genesis, and the
   accepted pre-V3 gap"**. The trust-proxy/provenance decision is a **different** decision from the one
   `035` reserves, so it needs its own number — the first unreserved is **`036`**. Winston rules; this
   file only flags the collision so it is not made twice.)*
2. **The Next server action must forward the real client IP and User-Agent explicitly**, or the API can
   never see them, and every rule above is moot. State this in `plan.md` as a required task, not an
   assumption.
3. **The renderer must distinguish three states and never collapse them:**

| State | Table | Drawer | Copy |
|---|---|---|---|
| **Real client provenance** | monospace IP + short UA | full UA block | *« Depuis 92.184.x.x · Chrome sur Windows »* |
| **Not recorded** (the 54 legacy rows, and any path not yet forwarding) | `—` in `slate-500`, not `slate-400` (D-13) | explicit line | *« Provenance non enregistrée pour cette entrée. »* |
| **Recorded but not attributable** (a proxy-only value, if the hop count cannot resolve one) | neutral badge, **never an IP string** | explicit line | *« Provenance non attribuable (requête relayée). »* |

The third row is the one that keeps the principle: rather than print a proxy address that *looks* like
an operator's, the surface says it cannot attribute it. **A blank is kinder than a lie**, and it is also
the only rendering that stays true if the hop count is later found wrong.

---

## 8. `/admin/reports` — recommendation (AC-5)

**Measured.** No `apps/web/src/app/admin/reports` directory. Linked from `sidebar-items.ts:175`
(`{ key: 'reports', icon: BarChart3, label: 'Rapports', href: '/admin/reports' }`). Inventoried in
`scripts/link-integrity-baseline.json`. Live: `307 → /admin/login?callbackUrl=%2Fadmin%2Freports` — the
**404 is only reached after the user logs in** `[measured]`.

**Three further measurements that decide this:**

1. **`/admin/exports` is titled « Exports & Rapports »** (`page.tsx:394`) `[measured]`.
2. **`/admin/analytics` exists** and is titled « Analytique des performances » (`page.tsx:92`)
   `[measured]`.
3. **`/admin/analytics` has NO sidebar entry at all.** It is linked only from
   `admin/dashboard/page.tsx:331` and `admin/classes/[id]/page.tsx:213` — and the dashboard link uses
   the **`BarChart3`** icon, the same icon the dead « Rapports » entry carries `[measured]`.

**Reading.** The admin menu contains a « Rapports » entry pointing at nothing, while a real analytics
page sits unreachable from the menu, under the same icon. « Rapports » is a **third name** for a job two
live pages already do.

**Recommendation, in preference order:**

- **Preferred — repoint and rename.** Change the entry to `{ key: 'analytics', icon: BarChart3, label:
  'Analytique', href: '/admin/analytics' }`. This satisfies AC-5 ("either works or the entry is gone —
  no dead link") *and* fixes a second navigation defect the AC did not know about: an orphaned page.
  Cost: one line + a `link-integrity-baseline.json` row retired. The label must match the destination's
  own `PageHeader` title — « Analytique », not « Rapports » — or the menu lies in a new way.
- **Acceptable — remove the entry.** Cheapest; satisfies AC-5 literally; leaves `/admin/analytics`
  orphaned.
- **Rejected — build a third reporting page.** Nothing in the epic contract or the cahier asks for one,
  and the admin already has two. Building it would be the most expensive way to satisfy the cheapest AC,
  and it would create the drift `PF-101` describes.

**Either way, this is the epic's `link-integrity-check.js` moment:** the baseline row must be
**retired**, not re-reasoned, and the change must be visible to the link gate rather than only to a
human. Note the gate reads links **statically**, so it can confirm the target route emits — it cannot
confirm the page renders for an authenticated admin. Say so; do not read a green gate as covering it.

---

## 9. States — every surface, every state

| Surface | Loading | Empty | Error | Degraded / partial |
|---|---|---|---|---|
| **KPI strip** | Skeleton cards, same footprint (no CLS) | n/a — a zero is a real answer, shown as `0` with its scope label | If the KPI call fails while the table succeeds, cards show `—` + *« Indicateurs indisponibles »*. **Never `0`** — `0` is a claim. | If a card's scope cannot be applied, that card shows all-time **and says so**. |
| **Filters** | `SearchInput` keeps its value; the existing `aria-live` *« Mise à jour… »* stays and moves into a `role="status"` region | n/a | Facet fetch failing today yields silently empty dropdowns (`safe()` swallows `ApiError`). Add *« Filtres partiellement indisponibles »* — a dropdown with no options currently looks like *"this tenant has no data"*. | Free-text `action` search keeps working when facets are down. |
| **Table** | `LoadingState` inside the card, same rounded shell | **Three distinct empties, never one.** (i) no filter, no data → *« Aucune action enregistrée pour l'instant. »* + the append-only reassurance (today's copy, keep). (ii) filtered, no match → *« Aucune entrée sur cette période. »* + a **« Réinitialiser les filtres »** action inside the `EmptyState` (it has an `action` prop — reuse it). (iii) filtered to a period **before the genesis row** → *« Cette période précède le début du journal ({date}). »* — the one empty that is not a dead end. | `ErrorState` with retry, inside the card shell — not a blank page. Today `safe()` converts an `ApiError` into an **empty table**, which renders "no audit entries" when the truth is "we could not read the audit log". **That is the single most dangerous state on this page** and it must be split: `null` (error) ≠ `[]` (empty). | Rows render while the chain panel is still verifying. |
| **Diff drawer** | n/a (data is already in hand) | `before` null on a creation → §5.5 copy | If `before`/`after` cannot be serialised, the panel says so rather than rendering `[object Object]` | Legacy-vocabulary row → `« Entrée historique »` marker |
| **Chain panel** | *« Vérification en cours… »*, `role="status"` | n/a | **Non vérifiable ≠ vérifiée** (§5.6, DNC-08) | Genesis gap always shown |
| **CSV export** | Button `busy` state that keeps its accessible name | Exporting an empty filtered set must warn before producing a 0-row file | Failure surfaces a `role="alert"` message; never a silent no-op | Export inherits the table's exact filter, inclusive `to` included |

---

## 10. Responsive & performance

- **Breakpoints.** `< md` card list (§5.4c) · `md–xl` table, KPI grid `sm:2` · `≥ xl` KPI grid `4`.
- **320 px floor.** Verify the sticky filter strip and the KPI grid at 320 CSS px — the `S-E06-5` record
  contains a measured instance of a header row that fit at 375 px and clipped at 320 px, so an
  operator's 390 × 844 pass will not catch it. `[UNMEASURED here]` — §14 makes it an evidence item.
- **The drawer on mobile.** `size="xl"` on a 390 px viewport must become a full-height sheet, and the
  two `lg:grid-cols-2` diff panels stack. Verify the `Drawer` focus trap still returns focus correctly
  when the sheet is full-screen.
- **Performance bar.** Not the parent < 2 s NFR (§0). The bar is: adding per-KPI scope must not turn 4
  counts into 8 round trips — filtered and all-time counts for the same card should be resolved in the
  same query pass where the data model allows. The page already runs 2 parallel fetches; keep it at 2.
- **`prefers-reduced-motion`.** Any new pending/verifying indicator must respect it (the shipped
  `FreshnessChip` precedent uses `motion-reduce`).

---

## 11. WCAG 2.2 AA — the bar for this epic

**Blocking (a real user cannot complete a real task):**

| SC | Issue | Fix |
|---|---|---|
| **2.1.1 Keyboard (A)** | D-2 — the diff drawer opens only on a mouse click | §5.4a |
| **4.1.2 Name, Role, Value (A)** | The clickable `<tr>` has no role and no accessible name; « Copier JSON » loses its name on swap | §5.4a, §5.5 |
| **1.4.3 Contrast (AA)** | D-13 — `slate-400` at 10–11 px, **`[computed]` 2.56:1 on white / 2.45:1 on `slate-50`** vs 4.5:1 required | Move forensic small text to `slate-500` — **`[computed]` 4.76:1 on white, 4.55:1 on `slate-50`**, both passing. Do **not** rely on `slate-500` at 10 px on any darker fill without re-measuring. |
| **1.4.11 Non-text Contrast (AA)** | `ring-blue-400/40` focus ring — `blue-400` is **`[computed]` 2.54:1 at full opacity**, lower at 40 % | Full-opacity ring at a tone measured ≥ 3:1 against both `white` and `slate-50`. The `S-E06-5` record contains the same `/40` finding, so this is a known repo-wide shape — fix it here for the audit surface, do not silently widen scope. |

**Required (and cheap):**

- **2.4.11 Focus Not Obscured (AA, new in 2.2)** — the filter strip sits above the table; when a row's
  focus moves under a sticky element the focused row must not be hidden. Check with the mobile card list
  too.
- **2.5.8 Target Size Minimum (AA, new in 2.2)** — 24 × 24 CSS px floor. Audit today: the `FilterChip`
  clear buttons (`h-3 w-3` icon in `p-0.5`), the `QuickRangeButton`s (`py-1`, `text-[11px]`) and the
  chevron cell are all candidates for failure. `[UNMEASURED]` — measure rendered boxes, do not eyeball
  the classes.
- **1.3.1 Info and Relationships (A)** — `scope="col"` on every `<th>` (D-14b) + an `sr-only` `<caption>`
  naming the current filter scope.
- **4.1.3 Status Messages (AA)** — the `aria-live` region must exist **before** its content (D-14c);
  the filter's *« Mise à jour… »*, the chain verdict and the copy-confirmation all belong in
  `role="status"` regions that are mounted at page load.
- **1.4.10 Reflow (AA)** — §10.
- **3.3.2 Labels or Instructions (A)** — « Jusqu'au (inclus) » is both a UX fix and a labelling fix.
- **Focus restore** — the `Drawer` primitive already restores focus to its trigger (`E3-S3`). Reuse it;
  do not re-implement.

**Not claimed.** No axe run, no screen-reader pass, no browser. `apps/web` has no unit runner and the
`VAL-08` Playwright/axe harness is not this epic's. Every a11y item above is **read from source or
computed from a hex value** — §14 states how each will be evidenced.

---

## 12. Copy deck (FR — factual, kind, non-stigmatising)

The register: this page reports on colleagues' actions to a DPO. Neutral, precise, never insinuating.
No exclamation marks, no « attention », no personalised warnings.

| Context | Copy |
|---|---|
| Page subtitle | *Toutes les actions sensibles sur l'établissement, append-only et traçables.* (keep — it is already right) |
| Period scope line | *Période affichée : du {date} au {date} inclus.* / *Toutes les entrées.* |
| KPI scope sub-labels | *Aujourd'hui · établissement entier* · *Sur la période filtrée* · *Sur la période filtrée* |
| Date filter label | *Jusqu'au (inclus)* |
| Active chip | *Jusqu'au 8 août inclus* |
| Empty — no data | *Aucune action enregistrée pour l'instant. Les actions sensibles apparaîtront ici. Une fois écrites, elles sont append-only et ne peuvent être ni modifiées ni supprimées.* |
| Empty — filtered | *Aucune entrée ne correspond à ces filtres.* + action **Réinitialiser les filtres** |
| Empty — before genesis | *Cette période précède le début du journal vérifié ({date}). Les entrées antérieures existent et restent consultables, mais ne font pas partie de la chaîne.* |
| Read error (≠ empty) | *Le journal n'a pas pu être lu. Réessayez dans quelques instants.* |
| KPI unavailable | *Indicateurs indisponibles pour le moment.* |
| Facets unavailable | *Filtres partiellement indisponibles — la recherche par action reste utilisable.* |
| Provenance — not recorded | *Provenance non enregistrée pour cette entrée.* |
| Provenance — not attributable | *Provenance non attribuable (requête relayée).* |
| Legacy row marker | *Entrée historique* — tooltip/aria: *Enregistrée avant l'unification du vocabulaire d'audit. Son libellé est affiché tel qu'il a été écrit.* |
| Chain — verified | *Chaîne vérifiée sur {N} entrées, depuis l'entrée d'origine du {date}.* |
| Chain — gap (permanent) | *{N} entrées antérieures au {date} ne portent pas d'empreinte. Cet écart est documenté et volontairement non comblé — une empreinte reconstituée après coup ne prouverait rien.* |
| Chain — broken | *La vérification s'arrête à l'entrée du {date}. Consultez cette entrée.* |
| Chain — unverifiable | *Vérification impossible : {raison}.* (never green) |
| Creation, no prior value | *Aucune valeur antérieure — création.* |
| Footnote (corrected) | *Le journal d'audit est append-only : une entrée ne peut être ni modifiée ni supprimée. Pour les demandes d'effacement (RGPD), seules les colonnes contenant des données personnelles peuvent être pseudonymisées.* |

**Copy rules.** Never « erreur » for a deletion — a deletion is a legitimate action. Never name a person
in a warning-toned string. Never « bientôt disponible » (**DNC-09**). Never a French label inside a
structural value (§6) — French belongs on the label, attached to the code.

---

## 13. `@pilotage/ui` reuse ledger

**Reused unchanged** — `PortalShell` · `PageHeader` · `KpiCard` (its `children` slot carries the scope
label — **no component change**) · `FilterBar` · `SearchInput` · `SelectFilter` · `Pagination` ·
`StatusBadge` · `Badge` · `DetailDrawer` / `Drawer` (focus trap + focus restore already hardened in
`E3-S3`) · `EmptyState` (including its `action` prop, currently unused here) · `ErrorState` ·
`LoadingState` · `Button` (replacing the hand-rolled export button) · `formatRelativeTime`.

**Possible small `packages/ui` additions — Winston/DS Guardian rule, not this file:**
- a `formatDateTimeLong` sibling in `packages/ui/src/lib/format.ts` (D-3). Genuinely shared; the audit
  page is simply the first surface that needs seconds. If it is judged audit-local, format locally —
  but do **not** change `formatDateLong`'s existing behaviour, which the whole product depends on.

**New, and app-level only (`apps/web`, not `packages/ui`):**
- a small audit **rendering module** holding the vocabulary label lookup (derived from
  `packages/contracts`, §6), the three-state provenance renderer (§7) and the legacy-row predicate.
  App-level because it encodes audit semantics, not visual primitives.

**Explicitly not built:** no new chart, no new table primitive, no new drawer, no new token ramp, no
`packages/ui` change for the mobile card (compose existing primitives).

---

## 14. UX acceptance criteria, per recommended slice

Slice order follows the intake's non-negotiable sequencing: **decisions and the correct writer first,
the chain last.** A chain computed over a literal `actorRole`, a proxy `ipAddress` and a null
`userAgent` would be a cryptographically verifiable record of falsehoods — worse than the honest blank
the epic's own principle demands.

| Slice (indicative — `tasks.md` owns the numbering) | UX acceptance criteria | Gates it touches | How it will be evidenced |
|---|---|---|---|
| **S1 — shared provenance foundation + the ADR** (move `sanitiseInetOrNull` / `truncateUserAgent` / `MAX_USER_AGENT_LENGTH` out of `modules/calendar/` into `apps/api/src/shared/audit/` **first**, so a second copy is never written; resolve the trust-proxy ADR; replace the 8 literal `actorRole` sites) | U1. The drawer renders the three provenance states of §7 and **never** an IP it cannot attribute. U2. Actor role shown is the caller's real role on all 8 corrected sites. U3. `/admin/audit` is confirmed to render **for an authenticated admin** — this is where D-1 is settled, in either direction, and recorded as a measurement. | G-AUDIT, G-AUTHZ, G-DNC | Authenticated render (demo login) + a screenshot at 1680 × 944 and 390 × 844, *only if the app is already running*; unit coverage on the role derivation. **Not** an axe run. |
| **S2 — the vocabulary declaration** (canonical enum in `packages/contracts`; label map derived; seed corrected; the 54 legacy rows handled by an explicit decision) | U4. Every facet option renders a French label from the declared source. U5. No English label appears among French ones (`calendar_event` is the standing probe). U6. A legacy row is visibly marked, never silently unlabelled. | **G-TRUTH**, **G-PORTAL**, G-MIGRATION *(if option 1 of §6.2)* | Render the 8 live `resource_type` and 5 live `action` values through the new renderer and assert every one resolves; build all four portals. State plainly whether G-MIGRATION triggers. |
| **S3 — filters and KPIs** (inclusive `to`; filtered KPIs with scope labels; the `adminLogins` decision) | U7. Selecting today's date returns today's rows, and the UI says *inclus*. U8. Every KPI card displays its scope. U9. **Parity:** with no filter applied, each filtered KPI equals its all-time counterpart on the same fixture. U10. No card can display a structurally impossible value. | **G-TRUTH**, G-TENANT | KPI unit tests over a fixture, including the parity assertion of U9 and a boundary case at `23:59:59` local; the `« Aujourd'hui »` quick-range cross-check of §5.3. |
| **S4 — accessibility and responsiveness of the surface** (keyboard row activation, time in the timestamp, contrast, target size, `scope`/caption, live-region mounting, mobile card list) | U11. The diff drawer opens from the keyboard and focus returns to the trigger. U12. Every forensic small-text token meets 4.5:1. U13. Every interactive target ≥ 24 × 24 CSS px. U14. Usable at 320 CSS px with no horizontal body scroll. | — | Contrast **recomputed** for the tokens actually shipped (the method that produced §11's values); target sizes measured on rendered boxes; a 320/390/1680 pass *only if the app is already running*. **No axe run and no screen-reader pass is claimed** — that is `VAL-08`. |
| **S5 — `/admin/reports`** (§8) | U15. No dead navigation entry remains, and the menu label matches its destination's own page title. | link-integrity gate | The `link-integrity-baseline.json` row is **retired**, not re-reasoned. Note the gate is static: it proves the route emits, not that the page renders authenticated. |
| **S6 — the hash chain, genesis, and the chain panel** (**last**) | U16. The panel shows a verdict **and** the genesis gap, always, together. U17. There is no UI state in which an unrun verification looks like a passed one (**DNC-08**). U18. No fabricated hash for any pre-V3 row (**risk A-01**). | G-AUDIT, **G-MIGRATION**, G-DNC | Chain verification driven against a fixture including the genesis boundary; a negative case where verification cannot run, asserted to render *non vérifiable*, never green. |

---

## 15. What this UX spec does NOT claim

- **No browser was driven.** Every rendering, layout and a11y statement is read from source or computed
  from a hex value. `/admin/audit` was probed live and returned `307 → /admin/login`, so the
  authenticated render was **not observed** — D-1 is open in both directions and S1 settles it.
- **No axe scan, no screen-reader pass, no keyboard walkthrough.** `apps/web` has no unit runner
  (Playwright only) and the authenticated a11y harness is `VAL-08`'s. §11 is a **bar to meet**, not a
  result.
- **Contrast values are computed, not sampled.** They are exact for the flat hex values in the shipped
  classes. Values behind an alpha modifier (`/40`, `/60`, `/30`) are stated only as *necessarily lower
  than* the flat value — the composited numbers are `[UNMEASURED]`.
- **Target sizes (SC 2.5.8) are flagged as candidates, not as failures.** They were reasoned from
  Tailwind classes, not measured on rendered boxes.
- **No gate is asserted met.** G-AUDIT, G-TENANT, G-AUTHZ, G-TRUTH, G-PORTAL, G-MIGRATION and G-DNC each
  have an *evidence route* in §14 and nothing more.
- **This file makes no data, schema, contract or ADR decision.** §6.2 (migrate vs declare legacy),
  §5.2's `adminLogins` question, §7's hop count and ADR number, and §5.4b's formatter placement are all
  named here with a UX preference and handed to `spec.md` / `data-model.md` / `plan.md` / an ADR.
- **`PF-31` is 8 call sites, not all of them.** 28 `prisma.auditLog.create` sites across 16 files; 8
  hard-code `actorRole: 'school_admin'`; the other 20 already take it from args `[measured]`. Say the
  measured number, not the audit's blanket claim.
- **The parent transparency panel of §1 is a horizon, not scope.** Nothing in this epic builds a
  parent-facing audit surface.
