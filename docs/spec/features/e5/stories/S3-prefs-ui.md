# E5-S3 — Dedicated parent/teacher notification-preferences UI (cadence + channels + mute)

> Self-contained `story` spec for the S3 slice. Companion to [`../spec.md`](../spec.md) (AC-4),
> [`../ux.md`](../ux.md) §2.1/§4, [`../tasks.md`](../tasks.md) S3, [`../data-model.md`](../data-model.md)
> §1.2. **Scope:** `apps/web` only. **No schema, no new endpoint, no new permission, no panel fork.**

## What shipped

A **cadence-aware** extension of the **shared** `PreferencesPanel`
(`apps/web/src/app/admin/settings/PreferencesPanel.tsx`) — the one panel already mounted in the
**Notifications** tab of `/admin/settings`, `/parent/settings`, and `/teacher/settings`. Extending the
shared panel (rather than forking or adding sub-pages) surfaces the new control on **both**
`/parent/settings` and `/teacher/settings` with the lowest churn, keeps the admin panel + parent
reassurance banner working, and reuses the existing optimistic server-action plumbing.

### 1. `CadenceSelect` — per-kind email-frequency radiogroup (the primary control)

A keyboard-accessible 3-option segmented control per **per-event** kind, reusing the **E3-S3 severity
segmented-control pattern** (`apps/web/src/app/admin/alerts/RuleConfigEditor.tsx`):

- `role="radiogroup"` labelled by the per-kind "Fréquence email" label; three `role="radio"` options —
  **Instant** (`Zap`) · **Résumé quotidien** (`CalendarClock`) · **Off** (`BellOff`).
- **Roving tabindex** (only the selected option is tabbable); `ArrowLeft/Right/Up/Down` move + select
  (focus follows selection via option refs); `Enter`/`Space` select; visible `focus-visible` ring.
- **Icon + text** on every option (never colour-alone, WCAG SC 1.4.1); **≥44 px** targets
  (`min-h-[44px]`, SC 2.5.8); `transition` gated by `motion-reduce:` (SC 2.3.3 honoured).
- Persists via the existing `PATCH /notifications/preferences/:kind` (now accepting `cadence` since
  S2) through `updatePreferenceAction(kind, { cadence })`; optimistic with **per-control revert** on
  error (the changed cadence reverts to its prior value only; the inline `role="alert"` banner shows
  the kind error copy).

### 2. Cadence × email composition (made legible, server state preserved)

- Cadence governs the **email** channel only. When **Email is off** the radiogroup is
  `aria-disabled` + visually quiet, with a **programmatic hint** *"Activez l'email pour choisir la
  fréquence"* (`aria-describedby`) — never silently ignored.
- The user-facing **Off** is the `cadence='off'` option; flipping the **Email** switch off does **not**
  rewrite cadence (server state preserved — a reversible soft snooze per FR-2 / data-model §1.2). The
  panel always shows both the cadence and the channel truthfully; In-app and cadence stay independent
  (bell can stay Instant while email is Résumé quotidien).
- A `daily_digest` + email-on row shows a calm sky-blue *"Résumé quotidien · un email par jour"* badge
  (analogue of the weekly digest's violet *"Activé · prochain envoi lundi"* idiom).

### 3. "Tout mettre en sourdine" header mute

A single header `<button aria-pressed>` that sets **every per-event kind** to `cadence='off'` in one
round-trip (`setCadenceForKindsAction`), with the inverse **"Tout réactiver"** (→ `instant`) when all
are already muted. Same partial-failure reconciliation as the existing bulk-channel action (keep landed
kinds, revert the rest). Channel booleans are untouched (reversible). The **weekly-digest row is
excluded** from the mute (it is its own email-only summary, exactly as it is excluded from the in-app
bulk toggle today).

### 4. Server actions (`apps/web/src/app/admin/settings/preferences-actions.ts`)

- `NotificationCadenceCode` type + `cadence?` added to `UpdatePreferencePatch` (mirrors the contract
  `NOTIFICATION_CADENCE` 1:1).
- New `setCadenceForKindsAction(kinds, cadence)` — bulk cadence PATCH with the same `Promise.allSettled`
  + `succeededKinds` reconciliation contract as `setChannelForKindsAction`. Revalidates all three
  settings paths.

## Decisions (autonomous — no AskUserQuestion)

1. **Extend the shared panel in the existing Notifications tab** (not new `/settings/notifications`
   sub-pages). `ux.md` §2.1 explicitly prefers the lower-churn option that reuses the existing tab +
   reassurance banner; `plan.md`'s sub-page alternative is also acceptable but adds routes/churn for no
   AC gain. One mount, both portals, admin unchanged.
2. **Cadence lives on every per-event kind, including admin's view.** The panel is shared, and `cadence`
   already arrives in the server snapshot (S2). The admin panel therefore also gains the selector — this
   is **additive and non-breaking** (the spec's "admin panel keeps working unchanged" is about not
   regressing it; gaining the same self-scoped control is fine and consistent). Self-scoped throughout —
   every PATCH is the caller's own `profile.*.self`.
3. **`cadence` is optional on `PreferenceRow`** + normalised to `instant` on seed, so the client is
   resilient if a payload ever omits it (defence-in-depth; the server always sends it).
4. **Off badge wording is window-agnostic** (*"un email par jour"*, not "ce soir") since the digest send
   hour is env-configurable (`DIGEST_DAILY_SEND_HOUR`, default 18h UTC) — the hint stays truthful
   regardless of the configured window.

## Acceptance (AC-4 + ux S3) — satisfied

- ✅ Both `/parent/settings` and `/teacher/settings` render every kind with cadence + channels + mute;
  changes persist via `PATCH /notifications/preferences/:kind` and survive reload (server-rendered
  snapshot). Self-scoped (`profile.*.self`) — no cross-user access (unchanged endpoint).
- ✅ WCAG 2.2 AA: cadence is a keyboard radiogroup (arrow keys, Enter/Space, roving tabindex, visible
  focus, ≥44 px), icon+text not colour-alone, `prefers-reduced-motion` honoured, ≥4.5:1 text contrast
  (blue-700-on-blue-50 selected, slate-600 idle).
- ✅ Admin panel + parent reassurance banner keep working; the weekly-digest row stays distinct and is
  excluded from the cadence mute.
- ✅ **No schema change, no new endpoint, no new permission, no panel fork.**

## Out of scope

Admin-imposed cadence policy, push/SMS controls, per-user scheduling/quiet-hours (E5 non-goals).
