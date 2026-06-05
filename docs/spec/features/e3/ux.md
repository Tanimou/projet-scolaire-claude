# E3 — UX spec (Sally)

> **Owner:** Sally (UX). Companion to [`spec.md`](./spec.md) (vision/scenarios/AC),
> [`plan.md`](./plan.md) (architecture), [`tasks.md`](./tasks.md) (slice backlog). This file is the
> **UX contract** for every E3 surface: key screens & states, the information→action flow,
> empty/loading/error states, `@pilotage/ui` reuse, and the WCAG 2.2 AA / mobile-first bar.
>
> **Non-negotiables (cahier + project-context §2/§4):** premium · colorful · responsive · animated ·
> **WCAG 2.2 AA** · **mobile-first (parent dashboard <2 s)** · **kind, factual, non-stigmatising
> tone**. Reuse `@pilotage/ui` first; server components fetch, `'use client'` only where interaction
> demands it (the flag toggle, the config panel, existing action buttons).

## 0. Information → action flow (the spine every screen obeys)

The cahier's promise is *turn information into action*. Each E3 surface presents **information →
why → next step**, never a dead-end:

| Surface | Information | Why (explainability) | Action |
|---|---|---|---|
| Teacher gradebook (S1) | the published grade | — | flag/unflag as *« à signaler »* (kind, reversible) |
| Parent recommendations — concern (S1) | *« Signalement enseignant en {matière} »* | the teacher's reason | E1 next-steps → talk to the teacher (E2 thread) |
| Parent recommendations — win (S2) | *« Belle progression en {matière} 🎉 »* | +{rise} pts /20 over 3 grades | deep-link to the subject → keep the momentum; *« Masquer »* |
| Admin rule card (S3) | current config + open-instance count + dry-run "≈ N concerned" | which students it would touch | *« Configurer »* → edit & save |
| Parent email (S4) | the explainable alert (rule+subject+threshold+trend) | same body as in-app | deep link back into the dashboard |

## 1. `@pilotage/ui` reuse map (reuse-first; new only if it raises consistency)

| Need | Reuse (existing primitive) | New (app-level only — never `packages/ui` unless DS Guardian agrees) |
|---|---|---|
| Severity / status pills | `StatusBadge` (tones `info`/`success`/`warning`/`danger`) | — |
| Admin KPI tiles | `KpiCard` | — |
| Empty / error states | `EmptyState`, the server `safe()` wrapper pattern | — |
| Teacher flag control | `IconButton`/`button` + `Popover`/`Tooltip` (if present) | thin `GradeFlagToggle` client wrapper in `apps/web` |
| Admin config editor | `Dialog`/`Sheet`, `Switch`, `Input`, `Button`, `FormField`, `Select`/`Tabs` | `RuleConfigPanel` (app-level composition); a shared **severity segmented control** ONLY if missing |
| Parent "win" card | the existing recommendation card + `StatusBadge` `success` + `lucide` `Sparkles`/`TrendingUp` | a **`success` variant/prop on the existing card** — prefer over a brand-new component |

## 2. Key screens & states

### 2.1 Teacher gradebook flag (S1) — `'use client'` `GradeFlagToggle`
- **States:** `unflagged` (quiet **outline** `Flag` icon, neutral — *not* a red "report") → `flagging`
  (popover open: optional one-line reason + **Confirmer** with spinner) → `flagged` (filled icon,
  subtle amber tint, tooltip *« Signalé le {date} »*) → `error` (optimistic revert + kind toast,
  retry). The row stays usable throughout (optimistic, reconciled with the `PATCH` result).
- **Microcopy (kind):** affordance *« Signaler à l'équipe »*; popover helper *« Un signalement attire
  l'attention de la direction et de la famille sur cette évaluation. À utiliser avec bienveillance. »*;
  filled-state action *« Retirer le signalement »*. **Never** "report a bad grade".
- **Idempotency in UI:** double-clicking the flag does not double-submit; the toggle reflects the
  server's single source of truth.

### 2.2 Parent recommendations surface (S1 concern + S2 win)
- **Warnings (existing + S1 concern):** keep the red/amber stack + the E1 `AlertNextSteps` panel
  (ack / resolve / dismiss / talk-to-teacher). The S1 concern card is a normal warning-toned alert.
- **Win (S2 `IMPROVEMENT`) — the visionary surface:** a **distinct green "win" card**, placed so a
  parent's first glance lands on encouragement (above/aside the warnings, not buried in the red
  stack). Green ring, `Sparkles`/`TrendingUp`, the actual point gain, subject **deep link**, and a
  friendly **dismiss-only** *« Masquer »* (a win needs no "Résoudre"/"handle"). Bell tone for this
  code = `success` (UI-only `low → success` map; the model severity stays `low`).
- **Mobile-first (<2 s):** the surface is server-rendered (aggregate endpoint, no client N+1); the
  win lane is a single extra card, not a second fetch. Cards stack vertically on mobile; tap targets
  ≥ 44 px; no horizontal scroll.

### 2.3 Admin `/admin/alerts` → Règles (S3) — `RuleConfigPanel`
- Each rule card gains a **« Configurer »** action → a side `Sheet`/`Dialog` with typed fields:
  *Seuil* (number), *Sévérité* (segmented low/medium/high), *Période (jours)* / *Fenêtre
  (évaluations)* per code, and a **Notifier la famille** switch. A **live preview** *« ≈ 12 élèves
  concernés aujourd'hui »* (`aria-live="polite"`) + the existing open-instance count show the blast
  radius **before** Save.
- The today's **"UI seulement" amber chip** is **removed** for the now-wired rules
  (`TEACHER_COMMENT_FLAG`, `IMPROVEMENT`) and **kept, relabelled *« à venir »*** for the parked
  `BEHAVIOR_ALERT`.

## 3. Empty / loading / error states (every surface)

- **Loading:** server-rendered skeletons (existing pattern). The S3 preview count shows a `…`
  placeholder until the dry-run resolves and **never blocks Save**.
- **Empty (kind, never guilt-inducing):**
  - *No flags on a row* → just the outline affordance (no empty state needed).
  - *No `IMPROVEMENT` wins* → the green lane is **absent**, **not** a "vous avez 0 réussite" box (a
    win is a bonus, never a deficit surface).
  - *No open instances for a rule* → the card shows the existing *« Aucune alerte ouverte »*.
- **Error:**
  - Flag write fails → optimistic revert + *« Le signalement n'a pas pu être enregistré, réessayez. »*
  - Config save 400 → inline field errors, the panel stays open, nothing lost.
  - Email enqueue failure (S4) → **invisible to the user** (best-effort, logged); the in-app alert
    already landed.

## 4. Accessibility — WCAG 2.2 AA (hard bar)

- **Not colour-alone (SC 1.4.1):** severity/status always pair an **icon + text label** with the
  tone. The green "win" must hit **4.5:1** text contrast — never rely on `success` green alone.
- **Flag toggle:** a real `<button>` whose accessible name reflects state (*« Signaler »* /
  *« Retirer le signalement, signalé le {date} »*), `aria-pressed`, **≥ 24×24 px** target
  (SC 2.5.8), visible focus ring; the popover traps focus and closes on `Esc`.
- **Config panel:** focus moves in on open and returns to the trigger on close; `FormField` + label
  association; the severity control is a labelled radiogroup; the preview count is `aria-live`;
  Save/Cancel fully keyboard-reachable.
- **Animation:** respect `prefers-reduced-motion` for the win-card entrance and any toast.
- **Email (S4):** the templated alert email keeps a sane reading order, a text-first subject, and a
  single clear deep link (no colour-only meaning).

## 5. Tone (the cahier's mandate, applied)

- Teacher flag = *« Signaler à l'équipe » / « Point d'attention »*, framed as raising attention
  **with care** — never "signaler une mauvaise note".
- Improvement = **celebratory** (*« Belle progression 🎉 »*) and dismiss-only.
- **No alert ever names or compares another child.** `IMPROVEMENT` email subject lines are
  encouraging (*« Bonne nouvelle : progression en {matière} »*), never the warning template (S4).

## 6. Per-slice UX acceptance (folds into `tasks.md` AC)

- **S1:** flag toggle states (unflagged/flagging/flagged/error) + kind microcopy; `aria-pressed` +
  ≥24 px target + keyboard popover; badge dropped on the admin rule card.
- **S2:** green win card (icon+text, 4.5:1), dismiss-only, subject deep link, `low→success` bell tone;
  no "0 wins" empty box; reduced-motion respected.
- **S3:** `RuleConfigPanel` keyboard + focus management, labelled fields, `aria-live` preview,
  inline 400 errors, mobile-first; "UI seulement" removed for wired rules, "à venir" for parked.
- **S4:** no UI regressions; email is opt-in/default-OFF, kind copy for the win; failures invisible.
</content>
</invoke>
