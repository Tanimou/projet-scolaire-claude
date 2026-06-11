# E11 — UX (Sally lens: premium, colorful, kind, WCAG 2.2 AA)

> E11 is an **admin** epic — its surfaces live in `/admin`, are **desktop-primary but fully responsive**, and
> turn two scary operations (a bulk apply that used to freeze the page; a roster sync that could duplicate
> children) into **calm, live, reviewable, reversible** events. The cahier's *information → action* promise,
> applied to onboarding & interop. Reuse-first on `@pilotage/ui`; no new portal, no new token ramp, no
> parent/teacher/student UI change.
>
> **Note on "mobile-first / parent <2 s":** that NFR governs the *parent dashboard*. E11 has **no parent
> surface**, so the <2 s parent budget is N/A here. The relevant performance bar is *the admin never waits on
> a frozen request* (AC-2) — the whole point of moving apply to the worker. Admin surfaces still respond
> instantly (the apply call returns in <300 ms with `queued`; progress is polled), and remain responsive down
> to phone width.

## 0. Principles (the through-line)

- **Calm, never frozen.** The old apply held the request open for tens of seconds behind a spinner. The new
  apply returns instantly with `queued`; the admin watches a **live progress strip** that ticks upward. A
  reload mid-run shows accurate intermediate state. Waiting is *visible and reassuring*, never a dead spinner.
- **Explainable, never a black box.** Every applied row is classified `created / updated / unchanged /
  conflict / skipped` and is **drillable** to *what changed and from where*. The admin reviews a sync the way
  they'd review a diff — not by trusting a count.
- **Kind & non-stigmatising — even for machines.** A `conflict` is *amber, "à examiner"*, with a calm
  side-by-side and a choice — **never** red "ERREUR", never a blaming tone. Destructive red is reserved for a
  genuine pipeline **failure** only. A re-sync that changed nothing says a warm *"Tout est déjà à jour"*, not
  "0 results".
- **Reversible.** The 24h rollback is offered identically on imports and syncs. The admin is never one
  irreversible click from corrupting a roster.
- **Children's data is sacred.** A `conflict` on a protected field (name, birth date) **blocks** auto-apply
  of that row — a human must choose, and the choice is audited. No silent overwrite, ever.

## 1. Surface map

| Surface | Route | Slice | Primary job |
|---|---|---|---|
| Import wizard (type → upload → validate) | `/admin/imports/new` | (exists) | unchanged — still sync, small & cheap |
| **Batch detail + live progress** | `/admin/imports/[id]` | S1 | watch the async apply calmly; rollback |
| **"Import & sync health" panel** | `/admin/imports/[id]` (section) | S2 | review created/updated/unchanged/conflict/skipped + drill-down |
| **Conflict resolution drawer** | `/admin/imports/[id]` (drawer) | S2/S4 | keep-current / take-source, audited |
| **Integrations → OneRoster** | `/admin/integrations` (+ `/oneroster`) | S3 | connect a source, run a sync |
| **Sync run = a batch** | `/admin/imports/[id]` (origin=oneroster) | S4 | the sync result IS a health panel |

The genius of the design: **a OneRoster sync produces an `ImportBatch`**, so S3/S4 inherit the S1/S2 batch
surfaces — one health panel, one rollback, one reconciliation engine. The OneRoster screens are thin (connect
+ trigger); the heavy UX is the shared batch detail.

## 2. S1 — Async apply, live progress (the calm spine)

**Trigger.** On `/admin/imports/[id]` for a `validated` batch, the existing **`ApplyControls`** (mode picker
+ Appliquer) stays. On click → the call returns ~instantly; the batch flips to **`queued`**, then `applying`.

**Live progress strip** (new, between the KPI cards and the rows table):
- A `ProgressBar` (reuse `@pilotage/ui`) driven by `summary.processedRows / summary.totalToApply`, with a
  count caption *"382 / 2 000 lignes appliquées…"*.
- A `StatusBadge` that walks `queued` (neutral, "En file d'attente") → `applying` (info/blue, "Application en
  cours…", animated dot) → `applied` (success) | `failed` (danger).
- The whole strip is a **`role="status"` `aria-live="polite"`** region so a screen reader hears progress
  milestones (not every tick — announce on phase change + completion, see §7).
- Polling: the page is already `force-dynamic` + `cache:'no-store'`; add a client poll (e.g. every 2–3 s)
  **only while `queued|applying`**, stopping on a terminal status. No SSE/WebSocket (non-goal).

**Timeline** (existing `Timeline`) gains a `queued` entry between "Validation terminée" and "Application en
cours" so the lifecycle reads honestly.

**Copy (FR, calm):**
| State | Copy |
|---|---|
| queued | En file d'attente — l'application va démarrer dans un instant. |
| applying | Application en cours — {n} / {total} lignes traitées. Vous pouvez quitter cette page, le traitement continue. |
| applied | Import appliqué — {created} créées · {updated} mises à jour · {skipped} ignorées. |
| failed | L'application s'est interrompue. Aucune donnée partielle conservée — vous pouvez relancer. |

> The *"vous pouvez quitter cette page"* line is the key reassurance: the work is on the worker, not the
> browser. This is the felt difference from the old frozen apply.

## 3. S2 — "Import & sync health" reconciliation panel (the visionary payoff)

A new section on the batch detail, shown once the batch is `applied` (or `mapped`/dry-run for a sync plan).
It **re-buckets** the rows by reconciliation class — reusing the existing `KpiCard` + rows-table + facet
pattern (`apps/web/.../imports/[id]/page.tsx` already does this for valid/invalid).

**Five calm KPI cards** (reuse `KpiCard` with semantic tones):
- **Créées** `created` — emerald, `Sparkles`/`Plus` icon. *"{n} nouvelles entités"*
- **Mises à jour** `updated` — blue, `RefreshCw` icon. *"{n} entités modifiées"*
- **Inchangées** `unchanged` — slate/neutral, `Check` icon. *"{n} déjà à jour"*
- **À examiner** `conflict` — amber/warning, `AlertTriangle` icon. *"{n} à arbitrer"* (only shown when > 0)
- **Ignorées** `skipped` — amber/neutral, `MinusCircle` icon. *"{n} ignorées"*

**Per-row drill-down.** Each card links to the rows table filtered by class (`?reconciliation=updated` etc. —
the existing `RowsFilters` pattern extended with a reconciliation facet). An `updated`/`conflict` row expands
to a **source-vs-current diff** (a compact `<dl>` of `{ field, current → source }`), so the admin sees
*exactly* what the upsert did — the "diff review" mental model.

**Empty / all-unchanged celebration.** If a re-sync produced only `unchanged`, the panel shows a warm hero:
*"Tout est déjà à jour 🎉 — rien à appliquer, votre roster est synchronisé."* (success tone, not an empty
"0"). This is the idempotency win made *felt* — re-running is safe and pleasant, never noise.

## 4. S2/S4 — Conflict resolution drawer (children's-data guardrail)

When `conflict > 0`, a calm **amber** `ActionStrip` invites *"Examiner les {n} arbitrages"*. Each conflict row
opens a **`FormDrawer`** (reuse the E3-S3 **hardened** `Drawer` — focus-trap + restore-to-trigger):

- Header: *"Arbitrer — {entité}"* (e.g. *"Léa Martin"*).
- A side-by-side table per conflicting field: **Valeur actuelle** | **Valeur de la source** (OneRoster), the
  differing cells subtly highlighted.
- Two clear choices as a **radiogroup** (roving tabindex, ≥44px): **Garder l'actuel** (default, safe) ·
  **Prendre la source**. A short hint: *"Ce choix sera enregistré dans le journal d'audit."*
  *(Canonical button labels — matches `quickstart.md` §5.)*
- Submit → `POST …/conflicts/{rowId}/resolve` → the row re-classifies (`unchanged` or `updated`), the drawer
  closes, a `role=status` toast confirms *"Arbitrage enregistré."*

**Never auto-resolve a protected-field conflict.** The drawer is the *only* path; the apply leaves the row in
`conflict` until a human decides. Tone stays neutral throughout — a conflict is a *question*, not an error the
admin caused.

## 5. S3 — Integrations → OneRoster (connect + trigger)

**Entry.** A new **"Intégrations"** admin sidebar item (or a card on an existing admin settings hub), gated by
`integrations.write` (already admin-held — no new permission). Page `/admin/integrations` lists `RosterSource`
rows.

**Connect a source** (a `FormDrawer`):
- **Type** — `OneRoster (CSV)` (default, file bundle) · `OneRoster (REST)` (base-url + clé).
- **Nom** — *"District OneRoster 2026"* (a friendly label).
- CSV: a drop-zone (reuse the wizard's drop-zone pattern) for the `.zip`/`.csv` bundle.
- REST: `URL de base` + `Clé d'API` (the key field is **write-only** — masked, never re-displayed; a calm
  hint *"La clé est chiffrée et n'est jamais réaffichée."*).
- A reassurance line: *"Pilotage lit votre roster — il n'écrit jamais dans votre système source."*

**Source card** (each connected source):
- Label · type chip · **dernière synchro** (relative time) · status `StatusBadge`
  (`idle`/`pulling`/`mapped`/`failed`).
- Primary **Synchroniser** button · a secondary **Aperçu (sans appliquer)** = `dryRun=true` (pull + classify,
  no write — show the *plan* before committing). The plan opens as a health panel in preview mode.

**Copy (FR, kind):**
| State | Copy |
|---|---|
| Connect reassurance | Pilotage lit votre roster pour le garder à jour — il n'écrit jamais dans votre système source. |
| Key reassurance | La clé est chiffrée et n'est jamais réaffichée. Pour la changer, saisissez-en une nouvelle. |
| Sync started | Synchronisation lancée — vous pouvez suivre l'avancement sur la page du lot. |
| Dry-run plan | Aperçu : {created} à créer · {updated} à mettre à jour · {unchanged} déjà à jour · {conflict} à arbitrer. Rien n'a encore été appliqué. |
| Source unreachable | La source n'a pas pu être contactée. Vérifiez l'URL et la clé, puis réessayez. |

## 6. S4 — The sync IS a batch (loop closed)

Triggering a sync (non-dry-run) creates a `oneroster`-origin `ImportBatch`, enqueues it, and routes the admin
to `/admin/imports/[id]` — **the same** live-progress + health-panel + rollback surface as an import. The only
visual difference: a **"Source : OneRoster — {label}"** provenance chip in the `PageHeader` subtitle, and the
rollback copy reads *"Annuler cette synchronisation"*. Re-syncing tomorrow lands a new batch that converges to
`unchanged` — the admin *sees* the idempotency and trusts it.

## 7. Accessibility (WCAG 2.2 AA)

- **Live regions.** The progress strip + the resolution toast are `role="status" aria-live="polite"`. To
  avoid chatter, the strip announces on **phase change + completion**, not every poll tick (a static
  `aria-label` carrying the phase word; the numeric tick is `aria-hidden`), reusing the E6-S4 `FreshnessChip`
  discipline.
- **Status is text + icon, never colour alone.** Every reconciliation/`StatusBadge` carries a label + an icon
  (`created→Plus`, `updated→RefreshCw`, `unchanged→Check`, `conflict→AlertTriangle`, `skipped→MinusCircle`).
- **Contrast & targets.** ≥4.5:1 on the `admin` OKLCH ramp; all controls ≥44px (SC 2.5.8 target-size — E10's
  bar); the diff highlight is not the *only* signal (a "modifié" tag accompanies it).
- **Drawers.** The conflict drawer reuses the **hardened** `Drawer` (focus-trap 2.1.2 + focus-restore 2.4.3,
  shipped in E3-S3). The radiogroup is keyboard-operable (arrows/Enter/Space, roving tabindex — the E3-S3 /
  E5-S3 segmented-control pattern).
- **No motion trap.** The progress spinner/animated dot respects `motion-reduce`.
- **Tables.** The rows + diff tables have proper `<th scope>`; the facet links are real `<a>`/buttons.

## 8. States matrix (loading / empty / error / success — every surface)

| Surface | Loading | Empty | Error / edge | Success |
|---|---|---|---|---|
| Apply (S1) | apply button → instant `queued` (NO long spinner) | (n/a) | `failed` → calm "interrompu, aucune donnée partielle, relancez" | live strip → "Import appliqué — {created}/{updated}/{skipped}" |
| Live progress strip | skeleton bar until first poll | (n/a while running) | poll fails → "Mise à jour de l'avancement indisponible" (keep last value, no crash) | bar to 100% → terminal badge |
| Health panel (S2) | KPI skeletons | re-sync all-unchanged → warm "Tout est déjà à jour 🎉" | — | 5 KPI cards + drillable rows |
| Conflict drawer | submit spinner | (n/a) | "Adopter la source" with a missing source value disabled w/ hint | toast "Arbitrage enregistré" + row re-classifies |
| OneRoster list (S3) | skeleton cards | "Aucune source connectée — Connecter OneRoster" CTA | source `failed` → amber card "non contactée, réessayer" | source cards w/ Synchroniser |
| Connect drawer (S3) | submit spinner | (n/a — a form) | bundle malformed → kind inline "fichier OneRoster non reconnu" | source created, card appears |
| Sync (S4) | trigger → instant route to batch page | (n/a) | unreachable → kind banner, source stays `idle` | routed to the batch health panel |
| **Backend not migrated** (operator pre-req) | — | OneRoster page shows a graceful "L'interopérabilité n'est pas encore activée — contactez votre administrateur."; import detail unaffected | **no crash** — degrade until additive `db push` applied | — |

## 9. Responsiveness & reuse

- **Desktop-primary, responsive.** Batch detail + health panel: KPI cards `grid` → stack on narrow; rows
  `Table` on wide → stacked `Card` rows on narrow (the existing import-detail responsive pattern). The
  conflict + connect drawers are full-height on mobile.
- **Reuse-first.** `PageHeader`, `KpiCard`, `StatusBadge`, `ProgressBar`, `Timeline`, `EmptyState`,
  `Pagination`, `Drawer`/`FormDrawer`, `SectionHeader` — all existing `@pilotage/ui`. The wizard drop-zone is
  reused for the CSV-bundle upload. **No new `@pilotage/ui` component is needed**; if S2's diff row proves
  reusable, it can graduate to a shared primitive (DS Guardian's call), otherwise it stays app-level.
- **Colour map (admin OKLCH ramp, semantic tokens):** created→success-emerald, updated→info-blue,
  unchanged→neutral-slate, conflict/skipped→warning-amber, failure→error-red (**only** genuine failure).
  Colourful and premium, but every status also carries text+icon.

## 10. Copy bank (FR, kind — consolidated)

| Key | Copy |
|---|---|
| Apply enqueued | En file d'attente — l'application démarre dans un instant. |
| Applying (reassure) | Application en cours… vous pouvez quitter cette page, le traitement continue. |
| Applied summary | Import appliqué — {created} créées · {updated} mises à jour · {unchanged} inchangées · {skipped} ignorées. |
| Failed (no blame) | L'application s'est interrompue. Aucune donnée partielle n'a été conservée — vous pouvez relancer. |
| All unchanged (re-sync) | Tout est déjà à jour — votre roster est synchronisé, rien à appliquer. |
| Conflict invite | {n} ligne(s) à arbitrer — la source et vos données diffèrent sur un champ protégé. |
| Conflict choice hint | Choisissez la valeur à conserver. Ce choix est enregistré dans le journal d'audit. |
| Conflict resolved | Arbitrage enregistré. |
| OneRoster read-only reassure | Pilotage lit votre roster — il n'écrit jamais dans votre système source. |
| Dry-run plan | Aperçu — rien n'a encore été appliqué : {created} à créer · {updated} à mettre à jour · {conflict} à arbitrer. |
| Rollback (sync) | Annuler cette synchronisation — toutes les entités créées seront supprimées (sous 24 h). |
| Not yet activated | L'interopérabilité n'est pas encore activée. Contactez votre administrateur. |
