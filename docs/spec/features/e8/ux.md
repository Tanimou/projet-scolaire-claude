# E8 — UX spec (the `/student` portal)

> Companion to [`spec.md`](./spec.md) / [`plan.md`](./plan.md) / [`data-model.md`](./data-model.md) /
> [`contracts/openapi.yaml`](./contracts/openapi.yaml) / [`tasks.md`](./tasks.md).
> The screens, states and copy for the **fourth portal** — `/student/*` — a calm, premium, mobile-first,
> WCAG 2.2 AA, **read-only**, **first-person**, **never-comparative** learner surface. Reuse `@pilotage/ui`
> first; no `packages/ui` change anticipated. Per-portal `data-portal="student"` theming (ADR-003 /
> design-tokens), distinct enough to feel like the learner's own space, consistent with the platform.

## 0. Design principles (the non-negotiables)

1. **First-person, kind, forward-looking.** Copy speaks to the learner (*"Tu progresses en maths"*, *"À
   consolider — voici sur quoi te concentrer"*), never a verdict (**never** "échec / nul / mauvais /
   dernier / en retard / redoublement"). A struggling subject is an **opportunity framed with a next
   step**, not a failure.
2. **Zero peer comparison, ever.** No rank, no class average framed against the student, no "tu es 18e",
   no leaderboard, no other child's name or data — on **any** screen. This is an RGPD/safeguarding wall,
   enforced in the **payload shape** (the student DTOs structurally lack `studentRank`/`classAverage`/
   `classRankTotal`), so the UI *cannot* render what it never receives.
3. **Read-only.** No buttons that write — no book, no ack, no flag, no message-compose, no self-justify.
   The student *sees*; the parent/teacher/admin *act*. Every interactive element is navigation, filter,
   or expand/collapse — never a mutation.
4. **Calm at a glance, mobile-first.** A 13-year-old on a phone gets the answer to *"where am I, what's
   coming, what's improving"* in seconds. The dashboard is the hero; the detail views are one tap away.
5. **Kind empty states, never a dead end / never a leak.** An unlinked account, a subject with no
   grades yet, no upcoming assessment, no remediation plan — each is a warm explainer, never an error,
   never another student's data.

## 1. The portal shell (`/student`, S1)

- A fourth AppShell peer (ADR-003 route-group pattern), `data-portal="student"`. Sidebar/bottom-nav
  items (mobile-first): **Mon objectif** (dashboard, S3) · **Mes notes** (S1) · **À venir** (S2) ·
  **Mon assiduité** (S2) · **Annonces** (S3). The header shows the student's own name + class
  (`/student/me`), no avatar-of-others, no school-wide switcher.
- **Routing:** a `student`-role login lands on `/student` (the dashboard once S3 ships; "Mes notes"
  until then). A `student` token can never reach `/admin|/teacher|/parent` (guard + deny-by-default).
- **Activation gate (scenario 7).** If `/student/me` returns `activated: false` (no linked `Student`),
  the whole portal shows **one** kind full-page state: *"Ton espace élève n'est pas encore activé.
  Rapproche-toi de ton établissement pour le configurer."* — no nav into empty data, never a 500.

## 2. "Mes notes" (`/student/grades`, S1)

- **Layout:** subjects as cards/sections (reuse the parent grade-by-subject shape), each showing the
  student's **own** subject average (own figure only — **no** class average beside it) + the list of
  **published** grades (value/scale, coefficient, assessment, date, teacher comment). Draft/unpublished
  grades are never shown.
- **Term filter:** an optional `termId` segmented control (reuse the existing pattern); default = active
  year.
- **Copy / states:** a subject with no published grade yet → *"Pas encore de note publiée en {matière}."*
  A teacher comment is shown verbatim, kindly framed (it is the teacher's words, not a system verdict).
- **A11y:** semantic headings per subject; the comment is associated to its grade (`aria-describedby`);
  ≥4.5:1; keyboard-navigable; ≥44px targets.

## 3. "À venir" (`/student/upcoming`, S2)

- **Layout:** a soonest-first list of the student's own upcoming assessments — subject, date (absolute
  + kind relative *"dans 3 jours"*), coefficient, term. Reuses the `parent-upcoming` aggregate resolved
  to self.
- **Framing:** action-for-the-learner — *"Prépare : Histoire, vendredi (coef. 2)"*. Never alarmist.
- **Empty state:** *"Rien de prévu pour l'instant — profite-en pour consolider."*
- **A11y:** each item a list row with an accessible date; relative-time is decorative (`aria-hidden`)
  beside the absolute date.

## 4. "Mon assiduité" (`/student/attendance`, S2)

- **Layout:** a small **own-only** summary (présences / absences / retards / justifiés — the student's
  own counts, **no** class comparison) + a factual recent-records list (date, status, justified?).
- **Framing:** factual and kind, **never disciplinary** — *"3 absences ce trimestre, dont 2 justifiées"*,
  never *"mauvais comportement"* / *"sanction"*. No discipline file, no behaviour score.
- **Empty state:** *"Assiduité complète — rien à signaler."*
- **A11y:** status conveyed by icon **+ text** (not colour alone); the summary is a labelled group.

## 5. "Annonces" (`/student/announcements`, S3)

- **Layout:** newest-first cards (title, body, priority chip, pinned indicator, published date,
  read/unread) for announcements that **reach the student** (school / their class / personal scope).
  Staff-only or other-class announcements are never present (filtered server-side).
- **Read state:** unread is visually marked; **reading is passive** (E8 is read-only — if a receipt
  mark-read is wired it is an existing benign side-effect, not a new student action surface; the spec's
  read-only default leaves mark-read out and shows read-state from the existing receipt only).
- **Empty state:** *"Aucune annonce pour le moment."*

## 6. "Mon objectif" — the dashboard (`/student/dashboard`, S3, the hero)

The visionary surface. A calm, forward-looking, first-person summary that makes the data **actionable
for the learner**, composing three blocks (each best-effort, each degrades to nothing):

- **Block A — Mon évolution par matière (E6 trend).** Per-subject, the student's **own** trend with a
  kind direction word + icon: *"Maths : en progrès (+1,8 pt)"* · *"Français : à consolider"* · *"Anglais :
  stable"*. **No** rank, **no** class average, **no** "tu es Xe". `direction ∈ {up, flat, down, unknown}`
  drives an encouraging icon+word (the *down* case is **"à consolider"**, never "en baisse/en échec").
  Optional E6 `freshness` chip ("à jour", reused) — quiet, never a loading gate.
- **Block B — À préparer (next assessments).** A bounded preview of the soonest upcoming assessments
  (deep-link to "À venir") — *"Prochaine éval : Histoire, vendredi."*
- **Block C — Ton soutien (E7 remediation, when a plan exists).** For each E7 `RemediationPlan`, a kind
  second-person line reusing the E7 progress producer: *"Ton soutien en maths : 2 séances faites,
  prochaine mardi · +1,2 pt depuis le début."* When the E3 `IMPROVEMENT` threshold holds, it lights the
  **emerald celebration lane** (reused from E3): *"Ton soutien en maths porte ses fruits 🎉."* Never
  *"échec"*; when there is no plan, the block is simply absent (the student never books — read-only).
- **States:** all three blocks best-effort — a snapshot/remediation throw degrades that block to nothing
  (the `freshness?`/`remediation?` posture), never blocks the dashboard; **<2 s** budget (reads the
  snapshot + producers the parent dashboard already uses). No-data → a warm *"Tes premières tendances
  apparaîtront dès que tes notes seront publiées."*
- **A11y (S3, the `[a11y]` slice):** `role="status"` + `aria-live="polite"` **only** on a status
  transition (e.g. the improvement emerald), **not** on every relative-time tick (a static `aria-label`
  carries the state word so the polite region never re-announces the tick — the E6-S4 `FreshnessChip`
  precedent); icon **+ text** for every direction (not colour alone); ≥4.5:1; `prefers-reduced-motion`
  on any animation; mobile-first; first-person kind FR copy throughout.

## 7. Copy bank (kind, non-stigmatising, first-person)

| Situation | ✅ Use | ❌ Never |
|---|---|---|
| Subject trending down | "à consolider — voici sur quoi te concentrer" | "en échec", "en baisse", "mauvais" |
| Subject trending up | "en progrès (+X pt)", "tu progresses" | (rank), "meilleur que la classe" |
| Remediation working | "ton soutien porte ses fruits 🎉" | "rattrapage", "tu étais en retard" |
| Attendance | "3 absences, dont 2 justifiées" | "comportement", "sanction" |
| Unlinked account | "ton espace n'est pas encore activé" | a 404/500, blank screen |
| No data yet | "tes tendances apparaîtront dès tes premières notes" | an error, an empty grid |
| Any peer framing | — (never rendered; absent from the payload) | "tu es 18e", "moyenne de classe : X" |

## 8. Theming & responsiveness

- `data-portal="student"` OKLCH token set (design-tokens) — a warm, encouraging palette distinct from
  the admin/teacher/parent portals, ≥4.5:1 on every text/background pair.
- Mobile-first (the primary student device): bottom-nav on narrow, sidebar on wide; the dashboard hero
  stacks; touch targets ≥44px; no horizontal scroll.
- Reuse `@pilotage/ui` (Badge, Card/Section, SubjectChip, SectionHeader, the E6 `FreshnessChip`, the E7
  progress-strip framing) — **no `packages/ui` change anticipated** (if a genuinely new shared primitive
  is needed, DS Guardian owns it under `packages/ui`, not app-level markup).
