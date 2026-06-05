# E6 — UX spec (Sally)

> **Owner:** Sally (UX). Companion to [`spec.md`](./spec.md) (vision/scenarios/AC),
> [`plan.md`](./plan.md) (architecture), [`data-model.md`](./data-model.md) (the 3 snapshot tables +
> the dirty-queue), [`contracts/openapi.yaml`](./contracts/openapi.yaml) (the additive `freshness`
> delta), [`tasks.md`](./tasks.md) (slice backlog). This file is the **UX contract** for every E6
> surface: key screens & states, the information→reassurance flow, empty/loading/error states,
> `@pilotage/ui` reuse, and the WCAG 2.2 AA / mobile-first (<2 s) bar.
>
> **Non-negotiables (cahier + project-context §2/§4):** premium · colorful · responsive · animated ·
> **WCAG 2.2 AA** · **mobile-first (parent dashboard <2 s)** · **kind, factual, non-stigmatising
> tone**. Reuse `@pilotage/ui` first; server components fetch, `'use client'` only where interaction
> demands it (the freshness chip's relative-time tick + the polite "recalcul" transition). FR
> conversational copy.

## 0. The one promise the UX must make legible: **"vous voyez les dernières notes publiées"**

E6 is, under the hood, a performance optimisation — pre-computed snapshots instead of a live scan. A
naive UX would make that **invisible**. The cahier's defining promise is *explainability* and
*trust* with children's data, so E6's UX turns the optimisation into a **visible trust signal**: a
small **freshness chip** on each dashboard that says, calmly, *"these numbers are the latest
published grades"* — and, when a teacher has just published something, *"we're folding it in right
now."* The parent never wonders *"is this cached? is it stale?"* — the chip answers it, kindly,
before they ask.

Every E6 surface follows **information → reassurance**, never a dead-end or an alarm:

| Surface | Information | Reassurance (the trust signal) | (No) action |
|---|---|---|---|
| Parent dashboard chip (S4, over the S2 snapshot read) | the child's averages/ranks/trend (unchanged data) | *"À jour il y a 3 min"* — you're seeing the latest published grades | none needed — it's just-current |
| …just after a publish | same data (served live via fallback) | *"Recalcul en cours…"* — a new grade is being folded in | none — it settles on its own |
| Teacher reports chip (S4, over the S3 snapshot read) | class distribution / per-class averages | same freshness idiom, scoped to the class | none |
| Admin analytics chip (S4, over the S3 snapshot read) | school-performance drill-down | same idiom, school-scoped | none (a later admin "Recalculer" is out of scope) |

**Tone rule (cahier mandate, applied to a *system status* surface):** the chip is **reassurance, not
warning**. *"Recalcul en cours"* is framed as the platform **working for you** (we're keeping your
view current), **never** as *"données obsolètes" / "erreur" / "données peut-être fausses."* It is the
same kindness the alert copy uses: factual, calm, never anxiety-inducing. The chip **never** names or
compares another child, and **never** implies the parent must do anything.

## 1. `@pilotage/ui` reuse map (reuse-first; new only if it raises consistency)

| Need | Reuse (existing primitive / pattern) | New (app-level only — never `packages/ui` unless DS Guardian agrees) |
|---|---|---|
| Dashboard scaffold | `PortalShell`, `PageHeader`, the existing parent/teacher/admin dashboard layouts — **unchanged** | — (the chip mounts in the existing dashboard header / hero area) |
| **Freshness chip** | the existing `Badge` / chip styling used across dashboards (status pills, the digest "Activé" badge idiom, the alert severity chips) — a small rounded pill, icon + text | a thin app-level **`FreshnessChip`** composition (relative-time + state) if no shared status-pill primitive fits; promote to `packages/ui` only with DS Guardian sign-off |
| Relative time ("il y a 3 min") | the existing relative-time formatting used in audit/activity feeds (reuse the same FR formatter) | — |
| "Recalcul en cours" motion | a subtle pulse/shimmer reusing the existing skeleton/loading shimmer tokens; **respects `prefers-reduced-motion`** | — |
| Icons | `lucide-react`: `CheckCircle2` / `Sparkles` (fresh), `RefreshCw` / `Loader2` (recomputing, spins only if motion allowed), `Clock` (relative-time prefix) | — |
| Colour | the design-tokens OKLCH palette per portal — **fresh = a calm success/emerald tint**, **recomputing = a neutral/sky "working" tint** (never red/danger) | — |
| Empty / first-load | the dashboards' existing empty states — **unchanged** (E6 never adds an empty state; a missing snapshot falls through to the live render, which already has its states) | — |

## 2. Key screens & states

### 2.1 The freshness chip (S4 — over the S2 parent read, then S3 teacher/admin reads) — the headline surface

**Where:** a single, small chip in the dashboard header / hero area, near the page title or the
"global performance" block — **secondary**, never competing with the child's data. Shipped in **S4**,
on `/parent/dashboard` first (over the S2 snapshot read — the <2 s NFR that matters most), then the
same idiom on `/teacher/reports` and `/admin/analytics` (over the S3 reads). It is **additive** — it
sits beside the existing
content, changes no existing layout, and is driven entirely by the additive `freshness` field in the
already-fetched aggregate payload (no extra fetch on first paint).

**Anatomy (mobile-first):**
- A compact pill: **icon + short label**. ≥ 44 px touch target (it may carry a tooltip/popover with
  the precise timestamp), text ≥ 4.5:1 contrast on its tint.
- It **wraps under** the title on narrow screens; never causes horizontal scroll; never pushes the
  child's averages below the fold.

**The three states (driven by `freshness = { source, recomputing, computedAt, sampleSize? }` — the
authoritative shape in [`contracts/openapi.yaml`](./contracts/openapi.yaml)):**

| State | When | Visual | Copy (FR, kind) |
|---|---|---|---|
| **Fresh** (snapshot served) | `source='snapshot'` & `recomputing=false` | calm emerald pill, `CheckCircle2`, no motion | *"À jour il y a {Xs/Xmin}"* (relative, from `computedAt`) — optionally *"(N notes)"* from `sampleSize` |
| **Recomputing** (live fallback while a trigger is open / snapshot older than newest grade) | `recomputing=true` (typically `source='live'`) | neutral-sky pill, `RefreshCw` (spins iff motion allowed) | *"Recalcul en cours…"* |
| **Neutral / live** (no snapshot yet, e.g. brand-new tenant) | `source='live'`, `recomputing=false` | quiet neutral pill **or omitted** (implementer's call — prefer omitting to avoid noise) | *"À jour"* or nothing |

- **Fresh → relative time** updates on the client (a light `setInterval` re-render of the label only,
  or recompute on focus) so *"il y a 12 s"* becomes *"il y a 1 min"* without a refetch. This is the
  **only** client interactivity the chip needs (`'use client'` for the chip alone; the dashboard stays
  a server component).
- **Recomputing → Fresh** transition: when the next dashboard fetch (navigation, pull-to-refresh, or a
  light optional poll) returns a fresh snapshot, the chip settles to **Fresh** with a gentle
  cross-fade (motion-reduce: instant swap). **No spinner blocks the page** — the data is always shown
  (the live fallback already rendered real numbers); the chip alone reflects the catch-up.
- **The chip is never a gate.** The dashboard renders its full content in **both** the fresh and the
  recomputing state — the chip is metadata *about* that content, never a loading screen in front of it.

### 2.2 The hover/press detail (progressive disclosure, optional)

On hover (desktop) / press (mobile), the chip may reveal a one-line popover with the precise
timestamp and a plain-language explainer — reinforcing the cahier's explainability:
- Fresh: *"Calculé le 5 juin à 15 h 08, à partir des dernières notes publiées."*
- Recomputing: *"Une note vient d'être publiée — vos moyennes se mettent à jour. Vous voyez déjà les
  chiffres les plus récents."* (note the reassurance: the live fallback **is** showing the latest.)

This is a `Tooltip`/`Popover` from `@pilotage/ui`; keyboard-reachable (focusable chip → popover on
focus/Enter), dismissible with `Esc`, never trapping focus.

## 3. Empty / loading / error states (every surface)

E6's golden rule for states: **the chip is the only new UI; it must never degrade the dashboard.**

- **First paint (mobile-first <2 s):** the dashboard is server-rendered from the aggregate payload
  exactly as today; the chip hydrates from the `freshness` field already in that payload — **no client
  loading spinner for the chip on first paint**, no extra round-trip, no layout shift (reserve the
  chip's space).
- **No snapshot yet (new tenant / scope never computed):** the endpoint falls through to the live
  computation → the dashboard shows **real, correct numbers** (today's behaviour); the chip is
  **Neutral/live** or omitted. There is **no** "données indisponibles" state — a missing snapshot is
  invisible to the user by design (the live fallback covers it).
- **Recompute backlog / worker down:** snapshots go stale → the endpoint keeps serving **live**
  (correct, just not pre-computed) and the chip shows **Recomputing** (honest). The dashboard is
  **never** blocked, never errors, never shows stale-as-fresh. A worker outage degrades *latency*,
  never *correctness* or *availability* (matches FR-6 / data-model §4).
- **Freshness field absent** (older API, or an endpoint not yet rewired): the chip **renders nothing**
  (the field is additive/optional) — graceful, no error, the dashboard is unchanged. This is what lets
  S2 ship the parent chip before S3 wires teacher/admin.
- **Error:** there is **no E6-specific error state** — E6 adds no failing path to the read (the
  fallback guarantees a result). Any pre-existing dashboard error state is untouched.

## 4. Accessibility — WCAG 2.2 AA (hard bar)

- **Not colour-alone (SC 1.4.1):** each chip state pairs an **icon + text label** (`CheckCircle2` +
  "À jour…", `RefreshCw` + "Recalcul en cours…") — the meaning never rides the emerald/sky tint alone.
- **Status, announced politely (SC 4.1.3 Status Messages):** the chip container is `role="status"`
  with `aria-live="polite"` so the **Recomputing → Fresh** transition is announced to screen readers
  *without* stealing focus or interrupting. The relative-time tick (*"il y a 12 s" → "il y a 1 min"*)
  must **not** spam announcements — only the **state** change (recomputing↔fresh) is live; the
  relative-time label updates `aria-hidden`/silently (or the accessible name carries an absolute time
  to avoid churn).
- **Contrast (SC 1.4.3):** chip text ≥ 4.5:1 on its tint in both portals/themes; the icon is decorative
  (text carries the meaning) so it needs only 3:1 but we hold 4.5:1 anyway.
- **Focus & keyboard (SC 2.1.1 / 2.4.7):** if the chip exposes a tooltip/popover it is a real
  focusable control with a visible focus ring; popover opens on focus/Enter, closes on `Esc`, no focus
  trap. A purely informational chip (no popover) is fine as non-interactive text+icon.
- **Target size (SC 2.5.8):** any interactive chip (with popover) is ≥ 24×24 px (we target ≥ 44 px on
  touch).
- **Motion (SC 2.3.3 / `prefers-reduced-motion`):** the `RefreshCw` spin and the cross-fade are
  **disabled** under reduced-motion — the state still reads via icon + text (no information lost).
- **Mobile:** the chip wraps gracefully, never forces horizontal scroll, never overlaps the child's
  data; relative-time stays legible at 390 px.

## 5. Tone (the cahier's mandate, applied to a *system-status* signal)

- The chip speaks about **the platform keeping the parent's view current**, never about the child:
  **Fresh** = *"À jour il y a {X}"*, **Recomputing** = *"Recalcul en cours…"*. Helper/popover copy:
  *"Vous voyez les dernières notes publiées."* / *"Une note vient d'être publiée, vos moyennes se
  mettent à jour."*
- **No alarm words.** Forbidden copy: *"obsolète"*, *"périmé"*, *"erreur"*, *"données peut-être
  incorrectes"*, *"cache"*. The state is either **current** or **catching up** — both positive framings.
- **Non-stigmatising, carried from E1–E5:** the chip **never** names or compares another child, never
  surfaces a grade value itself, never implies fault or required action. It is purely *"how current is
  this view"* — a reassurance, full stop.
- **Calm by default:** when everything is fresh (the overwhelming majority of the time), the chip is a
  quiet, low-contrast *"À jour"* — present but never shouting. It earns attention only in the brief
  recompute window, and even then it reassures rather than alerts.

## 6. Per-slice UX acceptance (folds into `tasks.md` AC)

> The freshness chip is its own slice (**S4**); S2/S3 only flip the read source behind the unchanged UI.
> The chip's UX contract (§1–§5) is satisfied **in S4**, then holds on every surface it later appears on.

- **S1 (schema + recompute spine — NO UI):** no user-visible UX change whatsoever (snapshots are
  written, never read). The UX deliverable for S1 is **invisibility** — a parent on the dashboard
  during S1 sees **exactly today's behaviour**, no chip, no regression. (FR-8.)
- **S2 (parent dashboard reads snapshots — NO new UI):** `/parent/dashboard` is served from snapshot
  (with the live fallback) and stays **< 2 s on mobile** with **identical numbers** (snapshot == live);
  the existing UI renders **unchanged** — the additive `freshness` field is present in the payload but
  **not yet rendered** (the chip is S4). UX deliverable: a faster dashboard with zero visible change and
  zero regression to any existing parent-dashboard state.
- **S3 (admin & teacher reads — NO new UI):** `/teacher/reports`, `/admin/analytics` and the
  school-performance drill-down read snapshots (distribution + KPI) with the live fallback; the existing
  charts/layouts render **unchanged** (faster, same numbers). The `freshness` field is present, rendered
  in S4. No regression to any existing teacher/admin analytics state.
- **S4 (the freshness chip — the headline UI):** the `FreshnessChip` (§1–§5) ships on the parent +
  admin (+ teacher) dashboards from the additive `freshness` field — Fresh (*"à jour il y a Xs"*) /
  Recomputing (*"recalcul en cours…"*) / Neutral — beside the existing content, changing no existing
  layout, **never a loading gate**. WCAG-AA: icon+text (not colour-alone), `role="status"` +
  `aria-live="polite"` on the recomputing↔fresh transition (relative-time tick stays silent), ≥4.5:1,
  `prefers-reduced-motion`, ≥44 px if interactive; mobile-first; non-stigmatising, reassuring FR copy;
  degrades to **no chip** when `freshness` is absent (older payload / un-rewired surface).
- **S5 (operability — NO user-facing UI):** the rebuild/sweep hardening is invisible to parents/teachers;
  if an admin `manual_rebuild` control is ever surfaced (out of the core scope), it reuses an existing
  `@pilotage/ui` button + a confirm pattern and writes one append-only audit row — but no parent/teacher
  surface changes. The chip simply reflects "recalcul en cours" honestly during a rebuild.
