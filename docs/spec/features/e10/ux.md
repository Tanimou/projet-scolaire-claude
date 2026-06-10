# E10 — UX (Sally lens: premium, colorful, mobile-first, WCAG 2.2 AA, kind)

> **What E10 is, from a UX angle.** E10 ships **no new user-facing feature** — it is a *quality bar*:
> an authenticated Playwright E2E harness (R10) that drives the real product journeys, plus an
> axe-core WCAG 2.2 AA remediation sweep (R9) across the **authenticated** screens E1–E9 already
> shipped. So "UX" here is not a new screen to design — it is **(a)** the precise definition of the
> journeys the harness must be able to *walk* (the information→action flow, screen by screen, state
> by state), **(b)** the a11y bar every authenticated screen must clear and how violations are
> remediated **without regressing the premium/colorful look**, and **(c)** the loading / empty /
> error / focus states the tests assert as the user-visible contract. The deliverable surface that a
> human *sees* is the **CI quality report** (Playwright HTML + axe summary), which is itself a UX
> artifact — it must be legible and actionable, not a wall of stack traces.
>
> **North-star tie-in.** The first journey E10 protects is the cahier's defining promise made literal:
> *grade publish → explainable parent alert → next action*. Turning that journey into a one-line,
> always-green regression test means the alert→action core promise can **never silently break again**.
> That is the visionary spine: a **reusable, portal-aware authenticated-session fixture**
> (admin/teacher/parent/student) seeded from the demo tenant, so every future epic ships with a
> one-line end-to-end journey test — E10 becomes a *permanent regression net*, not a one-off QA pass.

---

## 1. UX principles for a quality-bar epic

- **Test the user's reality, not the DOM's.** Every E2E assertion is written against the
  **accessible** surface — `getByRole`, `getByLabel`, `getByText` — never brittle CSS/test-id
  selectors where a role exists. This is deliberate: a test that can only find an element by role is a
  test that *proves the element is accessible*. The E2E suite and the a11y sweep reinforce each other.
- **Remediate a11y without flattening the design.** The product is intentionally premium, colorful,
  animated. Fixing contrast/focus/target-size must **preserve** that — adjust an OKLCH token's
  lightness, add a visible focus ring, enlarge a hit area; **never** strip colour, kill an animation,
  or replace a rich component with a grey box. A fix that makes the product duller is a regression,
  not a fix. (See §5 for the remediation playbook.)
- **Kind, non-stigmatising — even in failure UI.** The journeys the harness walks pass through the
  child-data surfaces (alerts, recommendations, the parent dashboard). The a11y sweep must check that
  the kind, factual, non-blaming tone holds in **every state the test visits** — an empty state, a
  loading skeleton, an error banner — never a red "error" framing for a child who is simply
  struggling, never a peer comparison by name. The test is also a tone guard.
- **Mobile-first is a measured budget, not a vibe.** The parent journey is asserted at the **390×844**
  viewport (the `Pixel`/mobile project), and the parent dashboard's <2 s budget is encoded as an
  explicit Playwright timing assertion on first-contentful render of the five-questions surface. A
  journey that only passes on desktop is a failing journey.
- **The CI report is the deliverable.** On failure, a human opens the Playwright HTML report and the
  axe summary. Both must be **scannable**: per-journey trace + screenshot + video on first retry
  (already configured), and the axe output grouped by `rule → impact → page → node` with the offending
  selector and the WCAG SC number, so the fix is obvious without re-running locally.

---

## 2. The journeys the harness must walk (UX flow definitions)

> Each journey is defined here as a **user-visible flow** — the screens, the actions, and the
> observable outcome the E2E test asserts. The Playwright spec is a thin transcription of these. Each
> step names the **accessible handle** (role/label/text) so the test stays role-first.

### J1 — Grade publish → explainable parent alert → next action  *(S1, the core promise)*

The single most important regression net. Spans **teacher → (engine) → parent**, two authenticated
sessions in one test via the per-portal fixture.

1. **Teacher session** (`teacher` fixture). Land on the gradebook (`/teacher/...` gradebook).
   Publish a grade low enough to trip an alert rule (`LOW_SUBJECT_AVG` / `REPEATED_FAILURE`). Handle:
   the "Publier" action by role; a `role=status` confirmation toast. *Observable: the grade row shows
   as published.*
2. **Engine.** The alert is raised on publish (synchronous producer path, not the cron) so the test is
   deterministic — it does **not** wait on the 15-min cron. (Test-design note for `plan.md`/`tasks.md`:
   the harness must use the publish-time producer, or seed a pre-published low grade, so J1 never
   depends on a background timer.)
3. **Parent session** (`parent` fixture, same demo tenant, the guardian of that child). Land on
   `/parent/dashboard`. *Observable: the bell shows an unread count; the dashboard answers the five
   questions; the struggling subject is visibly flagged.*
4. **Explainability.** Open `/parent/recommendations` (or the alert from the bell). *Observable: the
   alert states **rule + subject + threshold + trend** in kind language* — assert the explanation text
   is present and names the subject, never just "alerte".
5. **Action.** Open the **"Que puis-je faire ?"** `AlertNextSteps` panel. *Observable: a concrete next
   step is offered (reinforce subject deep-link / contact teacher CTA / find tutoring).* Assert at
   least one actionable control by role.
6. **Act.** Acknowledge or take the meeting-intent / messaging CTA. *Observable: the alert reflects the
   parent's action (status chip changes; bell retracts on resolve/dismiss).*

**Acceptance (UX):** a parent, starting from a freshly published grade, can *see why* and *do
something* — and the test proves the whole chain end-to-end at the mobile viewport.

### J2 — Parent claims a child  *(S2, reuses E9)*

`parent` fixture. `/parent/children` → **"Rattacher mon enfant"** drawer → fill the claim form (the
E9 uniform-shape form) → submit → assert the **identical no-leak confirmation** ("Demande envoyée…")
→ `GET /parent/child-claims` status surface shows a `submitted` / "En cours de validation" chip. The
test must assert the **no-leak invariant as a UX contract**: the confirmation never echoes a matched
child's name (J2's a11y/tone assertion doubles as the security-UX regression guard). Optionally a
second leg with the `admin` fixture approves the claim and the parent's status flips to "Validé".

### J3 — Parent ↔ teacher messaging  *(S2, reuses E2)*

`parent` fixture → `/parent/messages` → open/create a thread with a teacher *currently* teaching the
child → compose + send (assert append + `role=status` confirmation). Then the `teacher` fixture →
`/teacher/conversations` → the thread appears in the parent-conversations inbox (separated from
announcements) → reply → mark-read. *Observable: the dual-wall holds (the test only ever opens a
thread the ABAC permits) and the message round-trips.*

### J0 — Smoke a11y scan  *(S1, the baseline net)*

Already partially present (`smoke.spec.ts` scans the 3 public login pages). S1 extends the smoke scan
to the **first authenticated screen of each portal** behind the fixtures — `/admin/...`,
`/teacher/...`, `/parent/dashboard`, `/student/dashboard` — asserting **zero critical/serious** axe
violations as the entry bar, before the full AA sweep lands in a later slice.

---

## 3. Slice → UX scope map

| Slice | UX deliverable (what a human can see / what the test proves) |
|---|---|
| **S1** | Playwright auth-session fixtures (4 portals) + **J1** (the core promise journey) walked end-to-end at mobile + **J0** smoke a11y on the first authenticated screen of each portal. The CI quality report becomes the visible artifact. (`docs/adr/ADR-023` records the test-runner + CI E2E layer.) |
| **S2** | **J2** (parent child-claim, E9) + **J3** (parent↔teacher messaging, E2) journeys + the **cross-portal axe-core AA sweep** over the authenticated screens, with the resulting violation list triaged and remediated (per §5). |

---

## 4. WCAG 2.2 AA bar — what every authenticated screen must clear

The sweep runs axe-core with tags `wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa`. The product is
already largely compliant (the design system, the E3-S3 hardened `Drawer` focus-trap, the
`role=status` live regions, the icon+text status chips were all built to this bar). The sweep's job is
to **catch the gaps that slipped in** and hold the line. The bar, by criterion:

- **1.4.3 Contrast (Minimum) — AA.** Body/label text ≥ **4.5:1**, large text ≥ **3:1**, against its
  actual background on every portal token ramp (parent / teacher / admin / the E8 violet student
  ramp). The colourful OKLCH palette must clear this *while staying colourful* — fix by nudging token
  lightness, not by desaturating.
- **1.4.11 Non-text Contrast — AA.** Interactive boundaries, focus rings, the segmented-control /
  radiogroup borders, chart series strokes ≥ **3:1**.
- **1.4.1 Use of Color — A.** Every status/severity is **text + icon + colour**, never colour alone
  (alert severity, claim status, attendance status, the freshness chip, the trend deltas). This is
  already the house rule — the test enforces it doesn't regress.
- **2.4.7 Focus Visible — AA** and **2.4.11/2.4.12 Focus Not Obscured — new in WCAG 2.2 AA.** Every
  interactive control shows a visible focus indicator, and a focused element is **not hidden behind**
  sticky headers, the AppShell top bar, drawers, or toasts. (2.4.11 is a *net-new 2.2 criterion* — a
  likely finding around the sticky portal header and the `Drawer`.)
- **2.5.8 Target Size (Minimum) — new in WCAG 2.2 AA.** Interactive targets ≥ **24×24 px** (the
  product already aims for the stronger 44px on touch surfaces; keep it). Watch icon-only buttons
  (the bell, close ✕, table row actions, the freshness chip's controls).
- **3.3.7 Redundant Entry / 3.3.8 Accessible Authentication — new in WCAG 2.2 AA.** The login flow
  must not block paste into the password field and must not force re-entry of info already given. (The
  E2E auth fixture exercises login, so this is naturally co-tested.)
- **1.3.1 Info & Relationships / 4.1.2 Name, Role, Value.** Every form control has a programmatic
  label (the smoke tests already use `getByLabel`); custom widgets (the `CadenceSelect` radiogroup,
  the severity segmented control, the cards-as-table on mobile) expose correct roles/names.
- **2.1.1 Keyboard / 2.1.2 No Keyboard Trap.** Full keyboard operability; the `Drawer`/`FormDrawer`
  focus-trap (Tab/Shift+Tab cycle + Esc + focus-restore-to-trigger) is already shipped — the sweep
  asserts it across all consumers.
- **4.1.3 Status Messages — AA.** Async results announce via `role=status` / `aria-live=polite`
  without stealing focus (the freshness chip, toast confirmations, optimistic table updates already do
  this — hold the line).

**Severity gate.** S1's smoke bar is **zero critical + serious**. S2's full sweep produces a triaged
list; **critical + serious are blocking** (must be remediated in-slice or split into a follow-up
slice with a tracked exception in `PROGRESS.md`); **moderate + minor** are recorded as a punch-list
and fixed opportunistically — never silently ignored, never allowed to block the loop indefinitely.

---

## 5. Remediation playbook — fix a11y without losing the premium look

When the sweep flags a violation, remediate at the **right layer**, reuse-first:

1. **Contrast miss on a token** → adjust the OKLCH **lightness/chroma of the design token** in
   `packages/design-tokens` (the fix lands once and propagates to every portal). Prefer a token nudge
   over a one-off override. Stay colourful — raise contrast by darkening/lightening, not by greying.
2. **Missing/obscured focus ring** → fix in the shared `@pilotage/ui` primitive (the focus-ring
   utility, the `Drawer`, the `Button`/`IconButton`) so it propagates — the E3-S3 `Drawer` hardening
   is the precedent. App-level markup changes only when the issue is genuinely local.
3. **Target too small** → enlarge the hit area on the shared primitive (padding / min-size), keeping
   the visual icon size; don't bloat the layout.
4. **Missing name/role** → add the `aria-label`/`role` on the shared component, or the programmatic
   label association on the form field. Never add a redundant visible label that breaks the design —
   use `aria-label` / `aria-labelledby` / visually-hidden text.
5. **Color-only signal** → add the icon + text companion (the house pattern), don't remove the colour.

**Hard rule:** a remediation PR must not regress a screenshot's richness. If a fix would visibly dull
a surface, escalate it as a design decision rather than shipping the dull version. **Reuse
`@pilotage/ui` / `packages/design-tokens` first** — a fix in the shared layer is worth ten app-level
patches.

---

## 6. Loading / empty / error / focus states the harness asserts

The E2E journeys must remain green across the **non-happy** states too — a test that only walks the
sunny path is a brittle net. The states the harness encodes as the user-visible contract:

| Surface (in a journey) | Loading | Empty | Error / edge | Focus & a11y assertion |
|---|---|---|---|---|
| **Login (fixture setup)** | submit spinner; button busy | (n/a) | bad creds → kind inline error, no crash; paste-into-password allowed (3.3.8) | label-associated fields; focus lands on first field; visible focus ring |
| **Parent dashboard (J1)** | skeleton tiles, **no layout shift** | "no active child yet" → the kind "Rattacher mon enfant" CTA (E9 empty state) | aggregate slow/miss → snapshot fall-through, **never an error** (E6 posture); degrade kindly | five-questions surface reaches FCP within the <2 s assertion at 390×844; bell count announced |
| **Recommendations / alert (J1)** | skeleton cards | "Aucune alerte — tout va bien 🌿" calm positive, never a void | alert load fails → kind banner, dashboard stays usable | the explanation text is reachable by role; `AlertNextSteps` opens with focus trapped, Esc restores focus to trigger |
| **Messaging (J3)** | thread skeleton | "Aucune conversation" + compose CTA | send fails / rate-limited (429) → calm inline retry, the draft is preserved | composer labelled; new message announced via `role=status`; wall-blocked thread is `read_only` (no compose control rendered) |
| **Child-claim (J2)** | submit spinner (server-side match) | "Vous n'avez pas encore rattaché d'enfant" + CTA | `429` calm retry; backend-not-migrated → graceful "indisponible" degrade, **no crash** | **the confirmation is byte-identical for match vs no-match** (no-leak UX contract, asserted); neutral/info panel, never `role=alert` danger |
| **Admin queue (J2 optional leg)** | skeleton table/cards | "Aucune demande de rattachement en attente." | kind banner; queue stays usable | reject reason required + `aria-describedby`; row actions ≥ target size; result announced |

---

## 7. Responsiveness, performance & viewports the suite encodes

- **Two Playwright projects minimum:** `chromium` desktop (1280×720 default) **and** a **mobile**
  project (390×844, the parent-onboarding-on-a-phone reality). The **parent journey (J1, J2) runs on
  the mobile project**; admin-heavy legs run on desktop. A journey green only on desktop is incomplete.
- **The <2 s parent budget is a test, not a hope.** J1 asserts the five-questions parent-dashboard
  surface is interactive within the budget at the mobile viewport (a Playwright timing/`waitForLoadState`
  + visibility assertion on the dashboard's primary content). This makes the E6 snapshot work and the
  <2 s NFR *continuously verified*.
- **No horizontal scroll, ≥44px touch targets, native inputs** on the parent surfaces the journeys
  visit — co-verified by the mobile project plus the axe target-size check.
- **Locale `fr-FR`** (already set in the config) so the role/label selectors match the shipped FR copy
  and the journeys read the real product language.

---

## 8. The CI quality report as a UX artifact

The human-facing output of E10 is the **report**, and it must be designed:

- **Playwright HTML report** — per-journey trace + screenshot + video on first retry (already
  configured); journeys named by their user story ("J1 — grade publish → parent alert → action") so a
  failure reads as *a broken promise*, not a cryptic spec id.
- **axe-core summary** — grouped `rule → impact → page → offending node (selector) → WCAG SC`, so a
  reviewer triages by severity in seconds and the fix layer (token / shared primitive / app markup) is
  obvious. Emitted as a CI artifact alongside the HTML report.
- **Green = the core promise is intact.** The report's top line is the J1 status. When J1 is green, the
  alert→action loop demonstrably works end-to-end — that single signal is the epic's reason to exist.

---

## 9. Reuse-first inventory (no new app UI in E10)

E10 adds **no new product screens**. The journeys walk surfaces E1–E9 already shipped; the a11y sweep
remediates them in place. The only net-new artifacts are **test code** (the fixtures + specs under
`apps/web/tests/e2e/`), **CI wiring**, **`docs/adr/ADR-023`**, and **targeted a11y fixes** that land
in `packages/design-tokens` / `packages/ui` (shared, propagating) before any app-level patch. Honour
the existing `@pilotage/ui`, `packages/contracts`, aggregate-endpoint, tenant/ABAC/audit conventions —
this epic *protects* them, it must not bend them.
