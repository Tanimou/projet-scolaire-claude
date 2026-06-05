# E5 — UX spec (Sally)

> **Owner:** Sally (UX). Companion to [`spec.md`](./spec.md) (vision/scenarios/AC),
> [`plan.md`](./plan.md) (architecture), [`data-model.md`](./data-model.md) (the one additive
> `cadence` field), [`contracts/openapi.yaml`](./contracts/openapi.yaml) (the API delta),
> [`tasks.md`](./tasks.md) (slice backlog). This file is the **UX contract** for every E5 surface:
> key screens & states, the information→action flow, empty/loading/error states, `@pilotage/ui`
> reuse, and the WCAG 2.2 AA / mobile-first bar.
>
> **Non-negotiables (cahier + project-context §2/§4):** premium · colorful · responsive · animated ·
> **WCAG 2.2 AA** · **mobile-first (parent dashboard <2 s)** · **kind, factual, non-stigmatising
> tone**. Reuse `@pilotage/ui` first; server components fetch, `'use client'` only where interaction
> demands it (the cadence selector + channel switches). FR conversational copy.

## 0. The one promise the UX must make legible: **"no fatigue, full control"**

E5's visionary spine is **one per-kind control** — *how often we reach you* — not three disconnected
toggles. The UI's whole job is to make that promise feel **calm and in the parent's hands**. Every
E5 surface presents **information → why → action**, never a dead-end:

| Surface | Information | Why (explainability) | Action |
|---|---|---|---|
| Parent/teacher prefs row (S3) | this kind's current cadence + channels | plain-language *"ce que vous recevez et à quelle fréquence"* | pick **Instant / Résumé quotidien / Off**; flip channels; mute |
| Daily-digest email (S2) | *"Votre résumé du jour — 3 notes · 1 alerte"* | grouped per kind (+ per child), same explainable bodies | deep links back into the dashboard |
| Instant email (S1) | the single explainable alert/grade/message | the existing per-event body | deep link back into the app |
| Prefs page reassurance banner (S3) | *"Vous gardez le contrôle"* | defaults preserve current behaviour | nothing to do unless they want to change |

**Tone rule (cahier mandate, applied to delivery):** cadence is framed as *"à quelle fréquence nous
vous contactons"* — **never** as a judgement on the child ("trop d'alertes" is forbidden copy). A
parent muting a kind is a calm, reversible choice, not an admission that something is wrong.

## 1. `@pilotage/ui` reuse map (reuse-first; new only if it raises consistency)

| Need | Reuse (existing primitive / pattern) | New (app-level only — never `packages/ui` unless DS Guardian agrees) |
|---|---|---|
| Settings page scaffold | `PortalShell`, `PageHeader`, `Tabs`/`TabsList`/`TabsTrigger`/`TabsContent` (already wrap parent/teacher settings) | — (mount the panel in the existing **Notifications** tab) |
| Channel switches (in-app / email / push) | the **shared `PreferencesPanel`** (`apps/web/src/app/admin/settings/PreferencesPanel.tsx`) + `preferences-actions.ts` server actions — already reused by `/parent/settings` + `/teacher/settings` | **extend** `PreferencesPanel` (cadence-aware), **do not fork** |
| Cadence selector (Instant / Résumé quotidien / Off) | a **labelled radiogroup / segmented control** — reuse the E3-S3 severity segmented-control pattern (roving tabindex) if a shared primitive exists | thin **`CadenceSelect`** app-level composition if no shared segmented control; promote to `packages/ui` only with DS Guardian sign-off |
| Empty / informational states | `EmptyState`, the existing reassurance `section` pattern on `/parent/settings` | — |
| Icons | `lucide-react`: `Bell` (in-app), `Mail` (email), `Smartphone` (push, muted), `Zap`/`BellRing` (instant), `CalendarClock` (daily digest), `BellOff`/`MoonStar` (off/mute), `Sparkles` (win in digest) | — |
| Digest email | the E1-S4 composite-email template pattern (`renderDigestEmail`) + the branded `renderNotificationEmail` shell | a **daily-digest composite template** (worker-side, generalises the weekly one) — not a UI component |

## 2. Key screens & states

### 2.1 Parent/teacher notification-preferences panel (S3) — the headline surface

**Where:** the **Notifications** surface on `/parent/settings` and `/teacher/settings`. Both pages
already mount the shared `PreferencesPanel` in a Notifications **tab** (see
`apps/web/src/app/parent/settings/page.tsx`); `plan.md` alternatively proposes dedicated
`/{parent,teacher}/settings/notifications` sub-pages. **Either is acceptable** — both keep the shared
`PreferencesPanel` + server actions and the parent reassurance banner — so the exact mount is the S3
story's call (UX preference: the lower-churn option that reuses the existing tab + banner). The UX
contract below holds for whichever mount ships. S3 **extends** the shared panel (cadence-aware), it
does **not** fork it.

**Per-kind row layout (mobile-first):**
- **Left (flex-1):** kind label (bold) + plain-language description (the existing
  `NOTIFICATION_KIND_DESCRIPTION` copy). On the digest row, the existing violet accent + `CalendarClock`
  chip is kept (the weekly digest stays its own row, unchanged).
- **Right — two grouped controls:**
  1. **Cadence selector** (`CadenceSelect`): a 3-option segmented control — **Instant** (`Zap`) ·
     **Résumé quotidien** (`CalendarClock`) · **Off** (`BellOff`). The selected option is filled with
     the portal accent; the others are quiet outlines. This is the **primary** control.
  2. **Channel switches:** the existing In-app / Email / Push switches (Push disabled + "Bientôt"
     chip, unchanged).
- **Composition the UI makes legible (mirrors `data-model.md` §1.2 + §3.3):**
  - Cadence governs **email frequency**; it is meaningful only when **Email is on**. When Email is
    **off**, the cadence selector is shown **disabled with a hint** *"Activez l'email pour choisir la
    fréquence"* (never silently ignored). When the user collapses to **Off** via cadence, the UI keeps
    `emailEnabled` as-is server-side (a reversible snooze) but presents a single calm **Off** state.
  - The **In-app** switch and cadence are independent: a parent can keep the bell live (`Instant`
    in-app) while choosing `Résumé quotidien` for email — the panel shows both truthfully.

**States:**
- `idle` → each row reflects the server snapshot (`GET /notifications/preferences`, now incl. `cadence`).
- `saving` (optimistic): the changed control updates immediately; a small inline spinner on that
  control only; the rest of the panel stays interactive but the in-flight control is busy-locked
  (reuse the existing `busy` cell pattern in `PreferencesPanel`).
- `saved`: a brief, kind confirmation — reuse the existing optimistic pattern (no toast spam; the
  control simply settles into its new state). The digest row keeps its existing *"Activé · prochain
  envoi lundi"* badge idiom; the **daily** cadence shows an analogous *"Résumé quotidien · prochain
  envoi ce soir"* micro-hint.
- `error` (per `data-model`/AC): optimistic **revert of that control only** + a kind inline message
  *"Le réglage n'a pas pu être enregistré, réessayez."* (the existing `error` banner in
  `PreferencesPanel`); nothing else is lost; bulk partial-failure keeps the same per-kind reconcile the
  panel already does.

**Global mute affordance:** a single **"Tout mettre en sourdine"** action in the panel header (sets
every per-event kind to cadence `Off`), with an inverse **"Tout réactiver"** — reusing the existing
bulk-channel header control idiom (count + bulk toggle), so the panel gains a cadence column total
(*"4/7 instantané"*) alongside the channel totals it already shows. The weekly-digest row is excluded
from the cadence mute (it is its own email-only summary), exactly as it is excluded from the in-app
bulk today.

### 2.2 Daily-digest email (S2) — the anti-fatigue payoff

- **Subject:** kind, scannable, French, **never alarming**: *"Votre résumé Pilotage — {date}"*. If the
  day's set is purely positive (only `IMPROVEMENT`/grade wins), the subject leans encouraging
  (*"Bonne nouvelle aujourd'hui"*), reusing E3's win framing.
- **Body (grouped, information→why→action):** one branded composite (generalises `renderDigestEmail`):
  a greeting → **per-kind groups** with a count and a short list (*"📚 3 nouvelles notes"*, *"⚠️ 1
  alerte — moyenne en baisse en Maths"*, *"📣 1 annonce"*), **grouped per child** where a kind is
  child-scoped, each line a **deep link** back into the app. Wins (`IMPROVEMENT`) get the emerald
  `Sparkles` celebration lane, never buried under warnings.
- **Empty digest sends nothing** (AC-3) — there is **no** "rien aujourd'hui" email (that would itself
  be fatigue).
- **Accessibility (email):** sane reading order, text-first subject, sufficient contrast, a single
  clear primary deep link per group; no color-only meaning (every severity pairs an icon + text label);
  a plain-text alternative is rendered (the template already returns `{ html, text }`).

### 2.3 Instant email (S1) — unchanged surface, hardened path

- No visual redesign: S1 keeps the existing branded `renderNotificationEmail`. The UX deliverable for
  S1 is **trust**: the email arrives reliably (retry/backoff), is never double-sent for one source
  event, falls back to `fr-FR` on missing locale, and is **silently skipped** (never a broken/blank
  send) when a recipient has no email. **All S1 failures are invisible to the user** — the in-app
  notification already landed.

## 3. Empty / loading / error states (every surface)

- **Loading:** the settings page is server-rendered (`Promise.all` fetch, existing `safe()` wrapper);
  the panel renders from the server snapshot — no client loading spinner on first paint (mobile-first
  <2 s). The cadence selector hydrates with the server value, no flash.
- **Empty (kind, never guilt-inducing):**
  - *Prefs API unavailable* → reuse the existing `safe()` → `[]` fallback; the panel shows a calm
    *"Préférences momentanément indisponibles, réessayez."* (do not block the rest of the settings
    page).
  - *No daily-digest events that day* → **no email at all** (§2.2), and the prefs row simply reads
    *"Aucun résumé en attente"* as a quiet hint, **not** a "0 notifications" deficit box.
- **Error:**
  - Cadence/channel save fails → optimistic revert of that control + the existing inline error line.
  - Email/digest enqueue or send failure (S1/S2) → **invisible to the user** (best-effort, logged);
    the in-app feed is unaffected; the daily marker is **not** written on failure so the next eligible
    tick retries.

## 4. Accessibility — WCAG 2.2 AA (hard bar)

- **Not colour-alone (SC 1.4.1):** the cadence selector pairs **icon + text** for each option
  (Instant/Résumé quotidien/Off), never colour alone; channel state is conveyed by `aria-checked` +
  visible label, not just the blue fill. Digest-email severities pair icon + text.
- **Cadence selector = a real radiogroup (SC 4.1.2):** `role="radiogroup"` with an accessible group
  label (the kind name), three `role="radio"` options, **roving tabindex** (arrow-key navigation,
  `Enter`/`Space` to select), visible focus ring, **≥ 24×24 px** targets (SC 2.5.8) — reuse the E3-S3
  severity segmented-control pattern that already does this.
- **Channel switches:** keep the existing `role="switch"` + `aria-checked` + descriptive `aria-label`
  (*"Email pour Alertes"*); disabled Push exposes its "bientôt" reason via `title`/`aria-label`; the
  cadence-disabled-when-email-off state sets `aria-disabled` + a programmatic hint (not just visual
  dimming).
- **Focus & keyboard:** every control reachable and operable by keyboard; bulk "Tout mettre en
  sourdine" is a real `<button>` with an accessible name reflecting the resulting state; focus never
  trapped.
- **Targets & mobile:** rows stack vertically on mobile; controls ≥ 44 px touch target; no horizontal
  scroll; the segmented control wraps gracefully under the label on narrow screens.
- **Motion:** any control settle/confirm animation respects `prefers-reduced-motion`.
- **Contrast:** the selected cadence fill and all text hit **4.5:1**; the violet digest accent and
  emerald win lane meet text contrast (never rely on the tint alone).

## 5. Tone (the cahier's mandate, applied to *delivery*)

- Cadence labels are about **us reaching the parent**, not about the child: **Instant** =
  *"Immédiatement"*, **Résumé quotidien** = *"Une fois par jour"*, **Off** = *"Ne pas m'envoyer
  d'email pour cela"*. Helper copy: *"Choisissez à quelle fréquence nous vous prévenons. Vous gardez
  le contrôle, et vous pouvez changer à tout moment."*
- **Mute is reversible and blame-free** — never *"désactiver les alertes de votre enfant"*; instead
  *"mettre cette catégorie en pause"*.
- The daily digest is framed as a **kindness** (*"un résumé calme, une fois par jour"*), the antidote
  to inbox flooding — directly the cahier's anti-fatigue ask.
- **No notification copy ever names or compares another child** (carried from E1–E3). Digest win
  subjects stay encouraging; concern lines stay factual (rule + subject + threshold), never
  stigmatising.

## 6. Per-slice UX acceptance (folds into `tasks.md` AC)

- **S1 (worker/api, no UI change):** the instant email path is trustworthy — no double-send, locale
  fallback, missing-email skip, retry/backoff; **all failures invisible** to the user. No visual
  regression to the existing branded email.
- **S2 (digest email + the cadence gate):** the daily digest is **one grouped email** per eligible
  user per day, grouped by kind (+ per child), wins celebrated, empty set → no email, kind/encouraging
  subject; email a11y (icon+text, plain-text alt, single clear link). No UI page yet — the prefs
  *control* for cadence ships in S3, but the additive `cadence` field + gate land in S2.
- **S3 (the prefs panel):** the extended `PreferencesPanel` exposes per-kind **cadence selector**
  (radiogroup, roving tabindex, ≥24 px, icon+text) + channel switches + **Tout mettre en sourdine**,
  optimistic with per-control error revert; cadence disabled-with-hint when email off; mobile-first
  + WCAG 2.2 AA; calm non-stigmatising French copy; the admin panel and the parent reassurance banner
  stay working unchanged; surfaced on **both** `/parent/settings` and `/teacher/settings`.
