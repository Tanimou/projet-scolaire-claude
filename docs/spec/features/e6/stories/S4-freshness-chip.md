# E6-S4 — Freshness chip (the visionary trust signal)

> **Self-contained story spec.** A developer implements this slice from THIS file
> alone — no other context required. Mode: `epic-slice`. Epic: **E6 — Analytics
> Snapshots & pre-computation**. Slice **S4** of S1→S5. `[web][a11y]` · **P2** · ~S.
> **touchesUi: true · touchesBackend: false · touchesWorker: false.**
>
> **The one-line intent.** Ship a calm, mobile-first **`FreshnessChip`** (in
> `apps/web`, `'use client'` for the chip alone) that renders the already-shipped
> additive `freshness { source, computedAt, recomputing }` envelope — three states
> (Fresh "À jour il y a Xs" / Recomputing "Recalcul en cours…" / Neutral-or-omitted
> live) — on the **parent dashboard first**, then the same idiom on
> `/teacher/reports` and `/admin/analytics`. Reuse `@pilotage/ui` `Badge` styling
> and the existing FR relative-time formatter; a light `setInterval` relative-time
> tick is the **only** client interactivity. WCAG 2.2 AA: icon+text (not
> colour-alone), `role="status"` + `aria-live="polite"` announcing **only** the
> recomputing↔fresh transition (the relative-time tick stays silent), ≥4.5:1
> contrast, `prefers-reduced-motion` honoured, ≥44 px if interactive. Degrades to
> **no chip** when `freshness` is absent. Kind, non-stigmatising FR copy (no
> "obsolète/erreur/cache"). **No schema, no new endpoint, no permission, no new
> BullMQ queue** — purely renders the existing payload field.
>
> **Reuse-first / STOP-list.** If you are tempted toward any of these, STOP — they
> are explicit non-goals and each would break the slice or its scope:
> - **any backend change** — the `freshness` envelope is ALREADY on the wire
>   (S2 added it to `ParentDashboardResponse`; S3 added it to `TeacherReportsResponse`
>   + the drill-down `DrilldownResponse`). S4 is `apps/web`-only; touch **no**
>   `apps/api` / `apps/worker` / `packages/contracts` schema/service/controller;
> - **a new endpoint, controller, permission, or fetch** — the chip reads the
>   `freshness` field already present in the dashboard's existing aggregate payload;
>   **no extra round-trip**, no client fetch on first paint;
> - **making the dashboards client components** — they STAY server components;
>   ONLY the small `FreshnessChip` leaf is `'use client'` (for its relative-time tick);
> - **promoting `FreshnessChip` into `packages/ui`** — it is an **app-level**
>   composition over the existing `Badge` styling; do NOT add a `packages/ui`
>   component (no DS Guardian sign-off this slice — §6 records this as a deliberate
>   app-level call);
> - **a websocket / real-time auto-refresh** of an open dashboard (ADR-019 deferral —
>   a reload reflects the newer state; the only live update is the relative-time tick);
> - **a loading gate / spinner that blocks the page** — the chip is metadata ABOUT
>   the already-rendered data, NEVER a screen in front of it;
> - **alarm words** in copy — `obsolète`, `périmé`, `erreur`, `cache`, `données
>   peut-être incorrectes` are FORBIDDEN (see §5 tone);
> - **naming or comparing another child** — the chip is purely "how current is this
>   view", never about a pupil.

---

## 1. Context — what already exists (do not rebuild)

- **The envelope is on the wire.** The shared contract type is
  `SnapshotFreshness` (`packages/contracts/src/dto/snapshot.ts`):
  ```ts
  {
    source: 'snapshot' | 'live';
    computedAt: string;        // ISO 8601; for a live result, "now"
    recomputing: boolean;      // open recompute trigger for the scope, or served live
    gradeCount?: number;       // optional sample size
    sourceEventId?: string | null;
    revision?: number;
  }
  ```
  - **Parent** (`GET /api/v1/analytics/parent-dashboard/:studentId`): S2 added
    `freshness?: SnapshotFreshness` to `ParentDashboardResponse`. On a snapshot hit
    it carries the served row's real `computedAt`/`sourceEventId`/`revision`/`gradeCount`
    + `source:'snapshot'`; on fall-through `source:'live'`, `recomputing:true`.
  - **Teacher** (`GET /api/v1/analytics/teacher-reports`): S3 added the additive
    `freshness?` to `TeacherReportsResponse` — served **live** (`source:'live'`),
    `recomputing` set by an open-trigger probe over every class scope.
  - **Admin** (`GET /api/v1/analytics/school-performance-drilldown`): S3 added the
    additive `freshness?` to the drill-down `DrilldownResponse` — same `source:'live'`
    + open-trigger `recomputing` probe.
  - **All three are additive/optional.** Older clients ignore them. That is exactly
    what lets S4 render a chip on each surface without any backend change.

- **`@pilotage/ui` primitives to reuse (imported from `@pilotage/ui`):**
  - **`Badge`** (`packages/ui/src/components/Badge.tsx`) — a CVA rounded pill:
    `inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold`,
    variants `neutral | brand | success | warning | danger | outline`. Use
    `variant="success"` for Fresh (calm emerald: `bg-success-100 text-success-700`,
    ≥4.5:1) and `variant="neutral"` for Recomputing/Neutral. You MAY pass extra
    `className` for the sky tint on Recomputing if `neutral` reads too flat — but
    prefer the existing variants for token consistency; **never** `danger`/`warning`.
  - **`formatRelativeTime`** (`packages/ui/src/lib/format.ts`, exported from
    `@pilotage/ui`) — `(input: string|Date|null, now?: Date) => string`, returns
    `"à l'instant"` (<60 s), `"il y a N min"`, `"il y a N heures"`, `"il y a N jours"`,
    else a short date. **Note the <60 s case:** it returns `"à l'instant"`, NOT
    "il y a Xs" — see §3.3 for how the chip label handles the sub-minute window.

- **lucide-react icons** (already a dependency): `CheckCircle2` (Fresh), `RefreshCw`
  (Recomputing). Both already imported across the app.

---

## 2. Files to touch (exhaustive)

| # | File | Change |
|---|---|---|
| 1 | `apps/web/src/components/freshness/FreshnessChip.tsx` **(new)** | The `'use client'` chip component (the whole slice's logic). |
| 2 | `apps/web/src/app/parent/dashboard/page.tsx` | Add optional `freshness?` to the local `ParentDashboardResponse` interface; mount `<FreshnessChip freshness={dashboard?.freshness} />` in the dashboard header/hero area. |
| 3 | `apps/web/src/app/teacher/reports/page.tsx` | Add optional `freshness?` to the local `TeacherReportsResponse` interface; mount the chip next to the `PageHeader`. |
| 4 | `apps/web/src/app/admin/analytics/page.tsx` (+ `apps/web/src/app/admin/analytics/PerformanceDrilldown.tsx` if `DrilldownResponse` is declared there) | Add optional `freshness?` to the `DrilldownResponse` interface; mount the chip next to the `PageHeader`. |

> Each page declares its OWN local response interface (the web app does not import
> the contract types here). Add `freshness?: { source: 'snapshot' | 'live'; computedAt: string; recomputing: boolean; gradeCount?: number }`
> to each (a minimal structural mirror of `SnapshotFreshness` is fine — you do NOT
> need to import from `@pilotage/contracts`). Keep it OPTIONAL so an un-rewired
> surface / older payload type-checks and renders no chip.

**No other files.** No `packages/ui`, no `apps/api`, no `apps/worker`, no
`packages/contracts`, no schema, no i18n key change (FR copy is inline, matching the
app convention for these dashboards).

---

## 3. The `FreshnessChip` component (the whole slice)

`apps/web/src/components/freshness/FreshnessChip.tsx` — `'use client'`.

### 3.1 Props

```ts
interface FreshnessChipProps {
  freshness?: {
    source: 'snapshot' | 'live';
    computedAt: string;
    recomputing: boolean;
    gradeCount?: number;
  } | null;
  className?: string;
}
```

### 3.2 State derivation (pure, from the field — no fetch)

| State | Condition | Variant / icon | Label (FR) |
|---|---|---|---|
| **(omit)** | `!freshness` | render `null` | — |
| **Recomputing** | `freshness.recomputing === true` | `neutral` Badge, `RefreshCw` (spins iff motion allowed) | `Recalcul en cours…` |
| **Fresh** | `source === 'snapshot' && recomputing === false` | `success` Badge, `CheckCircle2` | `À jour il y a {rel}` (+ optional ` · {n} notes`) |
| **Neutral / live** | `source === 'live' && recomputing === false` | `neutral` Badge, `CheckCircle2` — **or omit** (implementer's call; prefer omitting to avoid noise) | `À jour` (or nothing) |

- **Decision order matters:** check `recomputing` FIRST (a snapshot may exist but a
  newer grade is being folded in → still "Recalcul en cours"), then `snapshot` fresh,
  then live-neutral.
- **Recommended:** for `source === 'live' && !recomputing`, render the quiet neutral
  "À jour" chip (legible, low-contrast) — it is calm and reassuring on a new tenant;
  omitting is also acceptable. Do NOT render anything alarming.

### 3.3 The relative-time label + the live tick (the ONLY client interactivity)

- The Fresh label reads `À jour il y a {rel}` where `{rel}` is derived from
  `freshness.computedAt`:
  - Reuse **`formatRelativeTime(computedAt, now)`** from `@pilotage/ui` for the
    ≥60 s buckets ("il y a 1 min", "il y a 2 heures", …). Because that helper returns
    `"à l'instant"` for the sub-minute window, render the Fresh label as
    **`À jour ${rel}`** where, for `< 60 s`, `rel` is a thin local
    `"il y a ${sec} s"` (seconds count) and for `≥ 60 s`, `rel = formatRelativeTime(...)`.
    Net copy examples: *"À jour il y a 12 s"* → *"À jour il y a 1 min"* → *"À jour il y a 2 heures"*.
    (Keeping the sub-minute "il y a Xs" matches the intent's *"À jour il y a Xs"*; the
    minute-and-up buckets reuse the shared formatter verbatim — one formatter, one
    seconds shim.)
  - Implement the seconds shim inline in the chip (≤5 lines); do NOT modify
    `packages/ui`'s `formatRelativeTime`.
- **Live tick:** a `useState(() => new Date())` "now" + a `useEffect` `setInterval`
  that bumps `now` every **30 s** (so "il y a 12 s" → "il y a 42 s" → "il y a 1 min"
  rolls forward without a refetch). Clear the interval on unmount. This re-renders
  **only the label** — no refetch, no network. This is the sole reason the chip is
  `'use client'`.
- **Hydration safety:** initialise `now` lazily (`useState(() => new Date())`) and
  guard against an SSR/client mismatch — render a stable first-paint label (e.g. the
  server already has `computedAt`; compute the label on the client after mount via a
  `mounted` flag, OR accept a tiny post-hydration label correction). Prefer a
  `mounted` flag so the server renders the static absolute-ish label and the client
  swaps to the ticking relative one — avoids a React hydration warning.

### 3.4 Optional sample size

If `freshness.gradeCount` is a positive number, you MAY append ` · {n} notes` to the
Fresh label (*"À jour il y a 3 min · 24 notes"*). Singular/plural: `note`/`notes`.
Keep it optional and unobtrusive; omit when `gradeCount` is undefined/0.

---

## 4. Accessibility — WCAG 2.2 AA (hard bar — these are acceptance criteria)

1. **Not colour-alone (SC 1.4.1):** every state pairs an **icon + text label**
   (`CheckCircle2` + "À jour…", `RefreshCw` + "Recalcul en cours…"). The meaning
   never rides the emerald/neutral tint alone.
2. **Status, announced politely (SC 4.1.3):** the chip's outer element is
   `role="status"` with `aria-live="polite"`. **Only the state change
   (recomputing↔fresh) is announced** — the relative-time tick ("il y a 12 s" → "il y
   a 1 min") must NOT spam the screen reader. Achieve this by giving the **accessible
   name a stable, non-ticking value**: put the *state* text in the live region and
   keep the ticking relative-time `aria-hidden="true"` (or carry an absolute
   `computedAt` in a `title`/visually-hidden span so the announced name doesn't churn
   every 30 s). Concretely: the live region announces "À jour" / "Recalcul en cours",
   while the "il y a 12 s" suffix span is `aria-hidden`.
3. **Contrast (SC 1.4.3):** chip text ≥ 4.5:1 on its tint (the `success-700` on
   `success-100` and `ink-700` on `ink-100` tokens already satisfy this — do not
   override to a lighter shade). Icon is decorative (text carries meaning).
4. **Reduced motion (SC 2.3.3 / `prefers-reduced-motion`):** the `RefreshCw` spin is
   **disabled** under reduced motion — use the Tailwind `motion-reduce:animate-none`
   utility on the spin (e.g. `className="animate-spin motion-reduce:animate-none"`).
   Under reduced motion the state still reads via icon + text (no information lost).
   Any cross-fade on the recomputing→fresh swap is also `motion-reduce`-gated (or just
   an instant swap — a transition is optional).
5. **Target size (SC 2.5.8):** the chip is **informational text+icon by default
   (non-interactive)** — no popover required this slice. IF you add an optional
   tooltip/popover (progressive disclosure, see ux.md §2.2 — NOT required for S4), it
   must be a real focusable control (≥44 px touch target, visible focus ring, opens on
   focus/Enter, closes on `Esc`, no focus trap). **Recommended: ship the chip as
   non-interactive informational text+icon** and defer the popover — it keeps the
   slice thin and a11y-clean.
6. **Mobile-first:** the chip **wraps under** the title on narrow screens (390 px),
   never forces horizontal scroll, never overlaps or pushes the child's data below the
   fold. Reserve its space so there is no layout shift on hydration.

---

## 5. Tone & copy (the cahier's kindness mandate, applied to a system-status signal)

- The chip speaks about **the platform keeping the view current**, never about the
  child. **Fresh** = *"À jour il y a {X}"*. **Recomputing** = *"Recalcul en cours…"*.
  **Neutral/live** = *"À jour"* (or nothing).
- **FORBIDDEN copy** (hard fail): *"obsolète"*, *"périmé"*, *"erreur"*, *"données peut-être
  incorrectes"*, *"cache"*, *"stale"*, any red/danger framing. The state is either
  **current** or **catching up** — both positive.
- **Non-stigmatising:** the chip NEVER names or compares another child, never surfaces
  a grade value, never implies fault or required action. It is purely "how current is
  this view".
- **Calm by default:** when fresh (the overwhelming majority of the time) the chip is a
  quiet, low-contrast pill — present, never shouting. It earns attention only in the
  brief recompute window, and even then it reassures.

---

## 6. Placement per surface

- **Parent** (`apps/web/src/app/parent/dashboard/page.tsx`): mount
  `<FreshnessChip freshness={dashboard?.freshness} />` in the dashboard header / hero
  area — near the page title or the "Performance globale" block — **secondary**, beside
  the existing content, changing no layout. `dashboard` is the already-resolved
  `activeEntry?.dashboard` object (the `freshness` field is on it). This is the headline
  surface (the S2 snapshot read → real "À jour il y a Xs"/"Recalcul en cours").
- **Teacher** (`apps/web/src/app/teacher/reports/page.tsx`): mount the chip next to the
  `PageHeader` (e.g. in the header's action slot or just under the subtitle), reading
  the top-level `data.freshness`. The S3 read serves live, so the chip typically shows
  the neutral "À jour" / "Recalcul en cours" during a recompute.
- **Admin** (`apps/web/src/app/admin/analytics/page.tsx`): mount the chip next to the
  `PageHeader`, reading the drill-down payload's `freshness`. Same idiom.
- **Degrades to no chip** when `freshness` is absent on any of these (older payload /
  not-yet-rewired surface) — the `!freshness → null` guard covers it.

> **app-level vs `packages/ui` decision (recorded):** `FreshnessChip` is an
> **app-level** composition over the existing `@pilotage/ui` `Badge` + `formatRelativeTime`
> — it is NOT promoted to `packages/ui` this slice (no DS Guardian sign-off; it is a
> thin, app-specific status pill with client-tick logic). If a second consumer outside
> these three dashboards ever needs it, promote it then with sign-off.

---

## 7. Acceptance criteria (folds spec AC-5 + ux §S4 + tasks S4)

- **AC-S4-1 (three states from the additive field).** On each of the three surfaces,
  the chip renders: **Fresh** *"À jour il y a {Xs/Xmin}"* when
  `source==='snapshot' && !recomputing`; **Recomputing** *"Recalcul en cours…"* when
  `recomputing===true`; **Neutral** *"À jour"* (or nothing) when
  `source==='live' && !recomputing`. The state is derived purely from the
  already-fetched `freshness` field — **no extra fetch**, no loading gate; the
  dashboard's full content renders in every state.
- **AC-S4-2 (degrades to no chip).** When `freshness` is `undefined`/`null` (older
  payload or un-rewired surface), the chip renders **nothing** — no error, no empty
  box, dashboard unchanged.
- **AC-S4-3 (relative-time tick, client-only).** The Fresh label updates on the client
  (a `setInterval`, ≥ every 30 s) so "il y a 12 s" rolls to "il y a 1 min" **without a
  refetch**; this is the ONLY client interactivity; the dashboards stay server
  components; the interval is cleared on unmount; no hydration warning.
- **AC-S4-4 (WCAG 2.2 AA).** icon+text (not colour-alone); `role="status"` +
  `aria-live="polite"` announcing **only** the recomputing↔fresh transition (the
  relative-time tick is silent / `aria-hidden`); ≥4.5:1 contrast; `RefreshCw` spin
  `motion-reduce:animate-none`; mobile-first wrap at 390 px (no horizontal scroll, no
  layout shift); if any interactive control is added it is ≥44 px + keyboard-reachable +
  `Esc`-dismissible (recommended: ship non-interactive).
- **AC-S4-5 (kind copy).** No "obsolète/périmé/erreur/cache/stale", no red/danger
  framing, never names/compares another child, never implies required action. Fresh and
  Recomputing are both positive framings.
- **AC-S4-6 (no backend / scope drift).** No schema, no new endpoint, no permission, no
  new BullMQ queue, no `packages/ui` change, no `apps/api`/`apps/worker` change, no
  `packages/contracts` change. `apps/web`-only: one new chip component + the three
  page-level interface additions + three mounts.

---

## 8. Manual demo (quickstart)

1. Log in as parent (`parent@pilotage.local` / `Changeme123!`, or the demo `voltaire`
   parent). Open `/parent/dashboard`. The chip shows **"À jour il y a {Xs}"** (snapshot
   fresh) beside the header; wait 1 min → it rolls to "il y a 1 min" without reload.
2. As a teacher of that child's class, publish (or revise) an assessment → a recompute
   trigger opens for the scope. Reload the parent dashboard → the chip shows **"Recalcul
   en cours…"** (the `RefreshCw` icon spins unless reduced-motion is on). After the
   worker drains the trigger, reload → it settles back to **"À jour il y a {Xs}"**.
3. Open `/teacher/reports` and `/admin/analytics` → the same chip idiom appears beside
   each `PageHeader` (neutral "À jour" / "Recalcul en cours" per the live S3 reads).
4. With a screen reader on: only the **state** change is announced ("À jour" ↔ "Recalcul
   en cours"), never every relative-time tick. With `prefers-reduced-motion: reduce` the
   `RefreshCw` does not spin but the text still reads "Recalcul en cours".

---

## 9. Out of scope (this slice)

- Real-time / websocket auto-refresh of an open dashboard (a reload reflects the newer
  state — ADR-019 deferral). The only live update is the relative-time tick.
- Promoting `FreshnessChip` to `packages/ui`.
- The optional hover/press popover with the precise timestamp (ux.md §2.2) — may be
  added later; ship the chip non-interactive.
- Any backend / contract / schema / worker change — the envelope is already on the wire.
- S5 operability (rebuild/sweep hardening) — separate slice.
