# E7 — UX spec (Sally)

> **Owner:** Sally (UX). Companion to [`spec.md`](./spec.md) (vision/scenarios/AC),
> [`plan.md`](./plan.md) (architecture), [`data-model.md`](./data-model.md) (the 4 models + the booking
> concurrency invariant), [`contracts/openapi.yaml`](./contracts/openapi.yaml) (the API surface),
> [`tasks.md`](./tasks.md) (slice backlog). This file is the **UX contract** for every E7 surface: key
> screens & states, the **information → action → measured-improvement** flow, empty/loading/error
> states, `@pilotage/ui` reuse, and the WCAG 2.2 AA / mobile-first (parent <2 s) bar.
>
> **Non-negotiables (cahier + project-context §2/§4):** premium · colorful · responsive · animated ·
> **WCAG 2.2 AA** · **mobile-first (parent dashboard <2 s)** · **kind, factual, non-stigmatising tone**.
> Reuse `@pilotage/ui` first; server components fetch, `'use client'` only where interaction demands it
> (the booking action, the cancellation confirm, the relative-time tick on "prochaine séance"). FR
> conversational copy.

## 0. The one promise the UX must make legible: **"votre action a un effet, et vous le voyez"**

E1 made an alert *actionable* (ack / what-should-I-do / ask for a meeting). E2 gave a *channel* to the
teacher. E3 made the diagnosis *explainable* and even *celebrated* progress (`IMPROVEMENT`). E6 made it
all *fast*. E7 adds the missing rung: **the recommendation becomes a real, bookable resource, and the
parent watches it work.** The UX's single job is to make that arc — **alert → diagnosis → resource →
measured improvement** — feel like one continuous, encouraging motion, never a form-filling chore and
**never** a verdict on the child.

Every E7 surface follows **information → action → reassurance**, never a dead-end, never an alarm:

| Surface | Information | Action | Reassurance / payoff |
|---|---|---|---|
| Alert "Que puis-je faire ?" (E1-S2 panel, S1) | the diagnosed subject + rule | **"Trouver un soutien en {matière}"** → promote to a plan | a tracked plan exists now — *"on s'en occupe"* |
| Plan page `/parent/remediation/[planId]` (S1 catalogue · S2 book) | the plan target + the filtered catalogue | browse resources, **réserver** a slot | a session is booked — *"prochaine séance jeudi 17 h"* |
| Dashboard **progress strip** (S3) | target subject · sessions · next session | (none — it's a status) | the **trend delta**: *"en attente"* → *"+1,8 pts depuis le début du soutien"* |
| …on an upturn (S3 + E3 tie-in) | same | (none) | the **emerald `IMPROVEMENT` lane**: *"le soutien porte ses fruits 🎉"* |
| Teacher "Mes créneaux de soutien" (S4) | who has booked my slots | publish availability · confirm/mark completed/no-show | scheduled, lightweight support |
| Admin `/admin/remediation` (S5 curate · S6 oversee) | catalogue + aggregate plan/booking activity | publish/approve tutors · school resources | a trustworthy, within-school catalogue |

**Tone rule (cahier mandate, applied to a remediation surface — the hardest tone in the product).**
Remediation is intrinsically about a *deficit*, so the copy must work twice as hard to be kind:
- **Frame it as support being organised**, never as the child failing: *"Soutien en cours — Maths"*,
  not *"Maths en échec"*. *"On met en place un accompagnement"*, not *"votre enfant a besoin d'aide
  parce qu'il est en difficulté"*.
- **Celebrate the action and the movement**, not the gap. The progress delta is framed as *progress*
  (*"+1,8 pts depuis le début du soutien"*), and a flat/negative delta is framed gently and patiently
  (*"les premiers effets prennent quelques semaines"*), **never** as *"le soutien ne marche pas"*.
- **Never name or compare another child**, never show a raw failing grade as a verdict on the strip,
  never imply fault or blame. The strip is *"voici le plan et le mouvement"*, full stop.
- Forbidden copy anywhere in E7: *"échec"*, *"mauvais"*, *"redoublement"*, *"en retard"* (as a label),
  *"problème"*, any leaderboard/ranking-against-named-peers framing, any *"il faut"* / blame phrasing.

## 1. `@pilotage/ui` reuse map (reuse-first; new only if it raises consistency)

| Need | Reuse (existing primitive / pattern) | New (app-level only — never `packages/ui` unless DS Guardian agrees) |
|---|---|---|
| Alert action row ("Trouver un soutien…") | the E1-S2 `AlertNextSteps.tsx` step-row pattern (icon chip + label + helper + `ChevronRight`) — **add one derived step**, do not redesign the panel | the `deriveAlertActions` addition is pure logic, not a new component |
| Plan page scaffold | `PageHeader`, `Card`, `SectionHeader`, `SubjectChip`, `Breadcrumb`, the parent route layout | a thin `/parent/remediation/[planId]` page composing existing primitives |
| Catalogue list (tutor + resource cards) | `Card` + `Avatar`/`AvatarNameCell` (tutor) + `Badge`/`SubjectChip` (subject/modality) + `EmptyState` | a `RemediationResourceCard` composition if no existing card fits the (tutor + subject + slots) shape |
| Availability slots | `DateCard` / `MiniCalendar` / `PreferredDate` (existing date rendering) + `Button` ("Réserver") | a compact `SlotList` (date-grouped buttons) — app-level |
| Booking confirm | `ConfirmDialog` (the existing confirm pattern) — *"Confirmer la réservation de jeudi 17 h ?"* | — |
| Booking success / "déjà réservé" | inline `aria-live` confirmation (the E1 `AlertNextSteps` success pattern) + `Badge` for state | — |
| **Progress strip** (the headline) | `Card` / `KpiCard` / `SubjectKpiCard` + `Badge` + `Sparkline` (the trend) + the E3 emerald `IMPROVEMENT` lane styling already on `/parent/recommendations` | a thin app-level **`RemediationProgressStrip`** if no `KpiCard` variant fits; promote to `packages/ui` only with DS Guardian sign-off |
| Trend delta | the E6 `student_subject_snapshot.trendDelta` already on the dashboard + the existing `Sparkline` / `formatRelativeTime` | — |
| Cancellation | `ConfirmDialog` + the append-only "annulé" `StatusBadge` | — |
| Teacher capacity surface | `DataTable` (bookings list) + `FormDrawer` (publish a slot) + `RowActions` (honoured/no-show) | — |
| Admin curation | `DataTable` + `FormDrawer` + `StatusBadge` (approved/active) + `FilterBar` | — |
| Empty / loading / error | `EmptyState`, `LoadingState`, `ErrorState` (existing) | — (E7 must never invent a new error state; see §3) |
| Icons | `lucide-react`: `GraduationCap`/`UsersRound` (tutor), `CalendarPlus`/`CalendarClock` (book/slot), `Target` (objective), `TrendingUp`/`Sparkles` (improvement), `CheckCircle2` (booked/achieved), `XCircle` (cancel) | — |
| Colour | the design-tokens OKLCH palette per portal — **plan/support = a calm supportive blue/violet**, **improvement = the E3 emerald lane**, **never red/danger for a child's situation** | — |

## 2. Key screens & states

### 2.1 The alert entry action (S1) — over the E1-S2 "Que puis-je faire ?" panel

**Where:** inside the existing `AlertNextSteps` panel on `/parent/recommendations`, as **one additional
derived step** (via `deriveAlertActions`), for subject-scoped alert codes (`LOW_SUBJECT_AVG`,
`NEGATIVE_TREND`, `REPEATED_FAILURE`, `MISSING_ASSESSMENT`, and `TEACHER_COMMENT_FLAG` when a subject is
known). It sits **alongside** — never replacing — the existing *"Renforcer {matière}"* deep-link, the
*"Écrire à l'enseignant·e"* CTA, and the *"Demander un rendez-vous"* intent.

**Anatomy:** the same step-row idiom as E1 — a leading icon chip (`GraduationCap`, calm violet/blue
tint), a self-describing label **"Trouver un soutien en {matière}"** (WCAG 2.4.4 — never "cliquez ici"),
a one-line kind helper *"Voir les intervenants disponibles et organiser un accompagnement."*, a trailing
`ChevronRight`. ≥ 44 px target, visible focus ring, `motion-safe` hover lift (reuses the E1 row classes
verbatim).

**Behaviour:** tapping it **promotes** (idempotently) the alert into a `RemediationPlan` and navigates to
`/parent/remediation/[planId]`. Promotion is a server action behind guardianship ABAC; re-tapping a
plan that already exists simply re-opens it (no duplicate, no error). When the alert has **no** subject
(`subjectId` null), the step is **omitted** (never a broken link) — the E1/E2 actions remain.

### 2.2 The plan page `/parent/remediation/[planId]` (S1 browse catalogue, S2 book) — the resource surface

**Layout (mobile-first, single column → two-column on `sm+`):**
1. **Plan header** — `PageHeader` with the child's name + `SubjectChip` (the target subject) + a calm
   *"Soutien en cours"* `StatusBadge`. A one-line target/objective: *"Objectif : retrouver une moyenne
   stable en Mathématiques."* (kind, no threshold-as-verdict). A `Breadcrumb` back to the alert.
2. **The catalogue** — a list of `RemediationResourceCard`s, **filtered to this subject + bookable by
   this parent** (within-tenant, teaching-wall-passing for teacher tutors). Each card: tutor identity
   (`AvatarNameCell` for a teacher, a name + "intervenant" badge for external), the modality
   (`Badge`: présentiel / à distance), a short kind description, and the resource's **next open slots**
   (a `SlotList` of date-grouped **"Réserver"** buttons — S2).
3. **The existing escape hatches** — the E1/E2 CTAs (*"Écrire à l'enseignant·e"*, *"Demander un
   rendez-vous"*) are **kept** at the bottom, so the plan page is never a dead-end even with an empty
   catalogue (scenario 7).

**The booking flow (S2):** tapping **"Réserver"** on a slot opens a `ConfirmDialog` — *"Réserver le
soutien en Maths avec M. Diallo, mardi 17 h ?"* — with a single confirm. On success: an inline
`aria-live="polite"` confirmation (*"Séance réservée — mardi 17 h. L'intervenant a été prévenu."*) and
the slot collapses into a *"Réservé"* `Badge`. On the **"déjà réservé"** concurrency case (FR-9): a kind
inline message *"Ce créneau vient d'être réservé — voici les prochains disponibles."* and the `SlotList`
refreshes; **never a 500, never a double-book**.

### 2.3 The dashboard progress strip (S3) — the measured-improvement payoff (headline surface)

**Where:** a calm strip on `/parent/dashboard`, near the global-performance hero — **secondary**, never
competing with the child's overall data, one strip per **active** plan (typically 1; if several, a
compact stacked list, most-recent first, capped to avoid clutter).

**Anatomy (mobile-first):** a `Card`/`KpiCard`-style strip:
- **Left:** `Target` icon chip + *"Soutien en cours · {matière}"* + the objective line.
- **Middle:** sessions — *"{n} séance(s) · prochaine {jour} {heure}"* (or *"aucune séance planifiée —
  réserver"* linking to the plan page). A small `Sparkline` of the subject trend when available.
- **Right (the payoff):** the **trend delta vs the plan baseline**, read from the E6
  `student_subject_snapshot.trendDelta` (snapshot-first, live fall-through):
  - **before any new grade:** *"en attente des prochaines notes"* (neutral, patient — never "no
    progress").
  - **positive delta:** *"+{X} pts depuis le début du soutien"* on a kind blue/emerald tint.
  - **crossed the `IMPROVEMENT` threshold:** the **E3 emerald celebration lane** is reused —
    *"Le soutien porte ses fruits — {matière} progresse 🎉"* (same lane the parent already knows from
    `/parent/recommendations`).
  - **flat / slightly negative:** gentle + patient — *"les premiers effets prennent quelques
    semaines"* — **never** *"le soutien ne marche pas"*.

The strip is **additive** — it sits beside existing content, changes no existing layout, degrades to
**nothing** when there is no active plan, and reads the snapshot the dashboard already loads (no extra
class-wide scan → the <2 s NFR holds). It is **never a loading gate**: the dashboard renders fully with
or without the strip data; a missing trend just shows the *"en attente"* copy.

### 2.4 Teacher "Mes créneaux de soutien" (S4) & admin `/admin/remediation` (S5 curate · S6 oversee)

- **Teacher:** a `DataTable` of upcoming bookings (who, when, subject) with `RowActions`
  (*"Honoré"* / *"Absent"*), and a `FormDrawer` to **publish a slot** (date, time, capacity, subject,
  modality). Ownership-scoped — a teacher sees only their own tutor's slots/bookings, only their pupils.
  Kind copy: *"Proposez un créneau d'aide"*, not *"obligations"*.
- **Admin:** a `DataTable` catalogue (tutors + resources) with `StatusBadge` (approved/active),
  `FormDrawer` to add/approve/retire, a `FilterBar` by subject, and a **school-scoped aggregate
  overview** (counts of active plans/bookings per subject — *which subjects need support capacity*) with
  **no child-by-name comparison**. RGPD-clean.

## 3. Empty / loading / error states (every surface)

E7's golden rule for states: **never a dead-end, never a verdict, always a kind fallback to the
already-shipped E1/E2 actions.**

- **First paint (mobile-first <2 s):** the dashboard + the strip are server-rendered from the existing
  aggregate payload; the strip's data is additive in that payload — **no extra round-trip on first
  paint**, no layout shift (reserve the strip's space). The plan page server-fetches the plan +
  catalogue.
- **Empty catalogue (no resource for the subject — scenario 7):** **never** a dead-end. The plan page
  shows a kind `EmptyState`: *"Aucun intervenant n'est encore référencé pour {matière}."* + the
  **preserved E1/E2 CTAs** (*"Écrire à l'enseignant·e"*, *"Demander un rendez-vous"*). The plan still
  exists and still tracks the trend, so the loop is never broken by a sparse catalogue.
- **No active plan (the common case on the dashboard):** the progress strip renders **nothing** (additive,
  optional) — the dashboard is exactly today's, no regression. No "vous n'avez pas de plan" nag.
- **Slot just taken (concurrency):** a kind inline *"ce créneau vient d'être réservé — voici d'autres
  horaires"*, the `SlotList` refreshes; **never a 500**, never an over-book (FR-9 guarantees one winner).
- **Booking pending / submitting:** the confirm button shows `aria-busy` + a `Loader2` + *"Réservation
  en cours…"* (the E1 `useTransition` pattern); the page is never blocked.
- **Loading the catalogue:** the existing `LoadingState` skeleton; never a blank flash.
- **Error (network / server):** the existing `ErrorState` with a kind retry — *"La réservation n'a pas
  pu aboutir, réessayez."* — never a stack trace, never an alarming tone. The dashboard strip degrades
  to *"en attente"* rather than erroring.
- **Trend not yet computable (plan too fresh, no new grades):** *"en attente des prochaines notes"* — a
  **neutral, patient** state, not an error, not "no progress".

## 4. Accessibility — WCAG 2.2 AA (hard bar)

- **Not colour-alone (SC 1.4.1):** every state pairs an **icon + text label** — booked
  (`CheckCircle2` + "Réservé"), improvement (`TrendingUp`/`Sparkles` + "en progrès"), cancelled
  (`XCircle` + "Annulé"). The supportive-blue / emerald tints never carry meaning alone.
- **Status, announced politely (SC 4.1.3):** booking success, the "déjà réservé" message, and the
  progress-strip improvement transition use `role="status"` + `aria-live="polite"` (the E1 pattern) — the
  screen reader is informed without focus theft. The relative-time tick on "prochaine séance" updates
  **silently** (aria-hidden / absolute time in the accessible name) so it never spams announcements.
- **Names, links, buttons self-describing (SC 2.4.4 / 2.5.3):** *"Trouver un soutien en Maths"*,
  *"Réserver mardi 17 h avec M. Diallo"* — never "cliquez ici" / "réserver" with no context; the
  accessible name carries the slot + tutor.
- **Focus & keyboard (SC 2.1.1 / 2.4.7):** the booking `ConfirmDialog` traps focus while open, restores
  to the trigger on close, dismisses on `Esc` (reuse the hardened E3-S3 `Drawer`/`ConfirmDialog` focus
  behaviour). The `SlotList` buttons are real, focusable, in DOM order.
- **Contrast (SC 1.4.3):** all strip/catalogue text ≥ 4.5:1 on its tint in both portals/themes; the
  emerald improvement lane reuses the E3 contrast-checked tokens.
- **Target size (SC 2.5.8):** every "Réserver" / action control ≥ 44 px on touch (≥ 24 px minimum).
- **Motion (SC 2.3.3 / `prefers-reduced-motion`):** the success/celebration animation + any sparkline
  draw-in are **disabled** under reduced-motion — the state still reads via icon + text.
- **Mobile:** the catalogue cards + the strip wrap gracefully, never force horizontal scroll at 390 px,
  never push the child's dashboard data below the fold.

## 5. Tone (the cahier's mandate, applied to the most sensitive surface in the product)

- The whole loop speaks about **support being organised and progress being made**, never about a child
  failing: *"Soutien en cours"*, *"on met en place un accompagnement"*, *"prochaine séance"*, *"le
  soutien porte ses fruits"*.
- **The trend delta is always framed as movement**, patiently: positive → celebrated; flat → *"les
  premiers effets prennent quelques semaines"*; never *"ça ne marche pas"*, never a red verdict.
- **Non-stigmatising, carried from E1–E6:** never name/compare another child, never show a raw deficit
  grade as a verdict on the strip, never imply fault, never a leaderboard. The strip is purely *"here's
  the plan and the movement"*.
- **Booking copy is warm and concrete:** *"Séance réservée — mardi 17 h. L'intervenant a été prévenu."*
  / *"Ce créneau vient d'être réservé — voici d'autres horaires."* — kind even in the failure case.
- **Calm by default:** when a plan is quietly progressing, the strip is a low-key, encouraging status —
  it earns a celebratory moment only when the `IMPROVEMENT` threshold is crossed, and even then it
  reassures (*"le soutien porte ses fruits"*) rather than shouts.

## 6. Per-slice UX acceptance (folds into `tasks.md` AC)

> **Slice order is authoritative in [`tasks.md`](./tasks.md):** S1 plan-promotion + alert deep-link +
> **read-only catalogue** · S2 availability + booking (ADR-020) · S3 progress strip · S4 teacher capacity
> · S5 admin curation · S6 hardening (notifications + cancellation + completion + uptake overview).

- **S1 (plan promotion + alert deep-link + read-only catalogue):** the *"Trouver un soutien en {matière}"*
  action appears in the E1-S2 panel for subject-scoped alerts only, is self-describing, ≥44 px, omitted on
  a null subject (no broken link), and promotes-then-navigates to a `/parent/remediation/[planId]` plan
  page showing the **subject-filtered, published** catalogue (`RemediationResourceCard` over tutors + their
  slots) with the kind **empty-state fallback to the E1/E2 CTAs**. The existing alert actions are
  **unchanged**. **Browse only — no booking UI yet.** WCAG-AA; kind copy.
- **S2 (availability + booking — the ADR-020 slice):** the plan page's slots gain **"Réserver"** → a
  focus-trapped `ConfirmDialog`, an `aria-live` confirmation + a "Réservé" badge, and the kind
  **"déjà réservé"** concurrency case (deterministic 409, no 500, no over-book). ≥44 px, keyboard-complete,
  `prefers-reduced-motion`. Kind FR copy.
- **S3 (progress strip — the payoff):** the dashboard renders a calm, non-stigmatising strip per active
  plan — target subject, sessions + next session, and the **trend delta vs the plan baseline** (from the
  E6 snapshot `subjectEvolution`, live fall-through) with the *"en attente"* → *"+X pts"* → **E3 emerald
  `IMPROVEMENT` lane** progression. Additive (no plan → no strip), never a loading gate, holds <2 s.
  WCAG-AA: icon+text, `role="status"`+`aria-live` on the improvement transition (relative-time tick
  silent), ≥4.5:1, `prefers-reduced-motion`; never names/compares another child.
- **S4 (teacher capacity):** a teacher publishes slots via `FormDrawer`, sees their bookings in a
  `DataTable`, and transitions them (confirm / completed / no-show / decline / propose-alternative) via
  `RowActions` — ownership-scoped, kind copy ("proposez un créneau", not "obligation"). WCAG-AA.
- **S5 (admin curation):** an admin curates the catalogue (`DataTable` + `FormDrawer` + `StatusBadge` +
  `FilterBar`), publishing/approving tutors + slots, RGPD-clean. WCAG-AA.
- **S6 (hardening — notifications + cancellation + completion + uptake overview):** booking/cancellation
  notifications reuse the existing dispatcher; **cancellation** uses a `ConfirmDialog` (frees the slot,
  "Annulé" badge); **plan completion** is a kindly celebratory state (*"Objectif atteint — bravo 🎉"*),
  never a cold "closed"; the admin **uptake overview** is school-scoped + aggregate (**no child-by-name
  comparison**). WCAG-AA, RGPD-clean; non-stigmatising throughout.
