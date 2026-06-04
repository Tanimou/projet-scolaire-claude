# E1-S4 — Weekly parent digest (opt-in)

> **Self-contained story spec.** A developer must be able to implement this slice
> from this file alone — no other context required. Author: John (BMAD PM).
> Epic: **E1 — Parent Alert Action Loop**. Slice: **S4** (final slice of E1).
> Mode: epic-slice.
> Predecessors: **S1 shipped** (PR #103 — parent ack/resolve/dismiss via guardianship
> ABAC), **S2 shipped** (the "Que puis-je faire ?" panel + idempotent
> `alert.meeting_intent` audit row), **S3 shipped** (the queryable `MeetingRequest`
> model + teacher/admin action center).
>
> **This is a `[schema]`-light slice** (one new `NotificationKind` enum value, no new
> table) **plus a new scheduled worker job**. It closes the E1 loop on the *push*
> side: instead of waiting for the parent to open the dashboard, the platform
> **proactively emails** each opted-in guardian a once-a-week, one-screen summary
> that re-states where their child stands and **what to do next** — the cahier's
> "turn information into action", delivered to the inbox.

---

## 1. Intent (one sentence)

Ship an **opt-in weekly parent digest**: a scheduled worker job that, once a week,
emails each guardian who has enabled the `weekly_digest` email channel a single-screen
French summary of each of their children (global average + week-over-week trend, new
alerts raised this week, upcoming assessments in the next 7 days, and the single most
important recommended next action), honoring per-user `NotificationPreference`, with a
parent-facing preference toggle and a thin aggregate API the worker can reuse — landing
DB (one enum value) + API (digest aggregate + preference plumbing) + worker (scheduled
job + email template) + UI (preference toggle) as one PR.

## 2. Why (ties to the cahier de charges)

The cahier's defining promise is **"turn information into action"**, and its north-star
is a parent dashboard that answers five questions in <2 s: *where is my child overall,
which subjects struggle, which improve, which assessments are coming, what should I do.*
S1–S3 made alerts **actionable** when the parent is already in the app. But most parents
do **not** log in weekly. The weekly digest is the **engagement loop**: it brings the
five answers to the parent's inbox on a predictable cadence, with a CTA back into the
exact surface that lets them act. It is explicitly listed as net-new "incontournable"
UX in `bmad/agents.md` (Victor: *"weekly parent digest"*) and as E1-S4 in the roadmap.
It must be **opt-in** (email is off by default — RGPD-minimal, no unsolicited mail about
a child's data), **kind / non-stigmatising** (factual, never compares the child to named
peers), and **idempotent** (a given guardian gets at most one digest per week, even if
the job re-ticks).

## 3. Scope flags

- `touchesUi` = **true** — the parent preference toggle for the new `weekly_digest`
  kind (it surfaces automatically in the existing `PreferencesPanel` once the backend
  returns the kind; the only UI work is labels/description + an explanatory blurb).
- `touchesBackend` = **true** — one new `NotificationKind` enum value (`weekly_digest`);
  the `NOTIFICATION_KINDS` / label / description arrays; a new **aggregate** that
  computes a guardian's per-child digest payload (reused by the worker via the shared
  DB); a small `digest-email.types.ts` mirror for the BullMQ payload.
- `touchesWorker` = **true** — a new **scheduled digest job** (setInterval cron mirror of
  `AlertsCronService`) that, per tenant, resolves opted-in guardians, builds each
  guardian's payload, dedups against an already-sent marker, renders the digest email,
  and sends it via the existing `MailerService`. **No new BullMQ queue is required** —
  the worker computes + sends inline (mirrors the alerts cron, which writes directly).

## 4. Users & primary scenarios

**Actor — Parent / Guardian** (authenticated, holds at least one **active Guardianship**;
has set the `weekly_digest` **email** channel to *on* in Réglages › Notifications).

**Scenario A — opt-in (UI):**
1. Parent opens `/parent/settings` › **Notifications**. The preference table now lists a
   new row **« Récapitulatif hebdomadaire »** with the email toggle (in-app column is
   not meaningful for a digest — see §8 for how it renders).
2. Parent flips the **Email** switch on → `PATCH /api/v1/notifications/preferences/weekly_digest`
   persists `{ emailEnabled: true }` (reuses the existing preference endpoint verbatim).

**Scenario B — delivery (worker, happy path):**
1. Once a week (default Monday 07:00 server-local, configurable — see §7), the worker's
   digest cron ticks. For each tenant it finds guardians with an **explicit
   `weekly_digest` email-enabled** `NotificationPreference` row.
2. For each such guardian, for each of their **active-guardianship** children, it builds
   a one-child summary: global weighted average (this period) + the **delta vs the
   previous computed week**, the count + titles of alerts **raised in the last 7 days**,
   the next up-to-3 **upcoming assessments** (scheduled in the next 7 days), and **one**
   recommended next action (derived from the most severe open alert, or a positive
   "tout va bien" line when there are none).
3. It renders ONE branded French email summarizing **all** the guardian's children
   (one card per child, max ~one screen) with a CTA button to `/parent/dashboard`, and
   sends it via SMTP (Maildev in dev) through the existing `MailerService`.
4. It records a **sent marker** so the same guardian is **not** emailed twice for the
   same ISO week (idempotency — see §6c).

**Scenario C — opted-out / no data:**
- A guardian with **no** `weekly_digest` email-enabled row gets **no** email (email
  default is off; this is the opt-in guarantee).
- A guardian whose children have **no** grades / alerts / upcoming assessments this week
  still gets a digest **only if** opted in, but the email degrades gracefully to a
  "rien de nouveau cette semaine" state (we do **not** suppress it — predictable cadence
  is the point; a parent who opted in expects the weekly touch). *If the team prefers to
  suppress fully-empty digests to cut noise, that is an acceptable variation — note it in
  the PR; the default in this spec is "always send to opted-in guardians".*

## 5. The schema change (`[schema]` — one enum value, NO new table)

`apps/api/prisma/schema.prisma` — add **one value** to the existing `NotificationKind`
enum:

```prisma
enum NotificationKind {
  announcement
  alert
  grade_published
  enrollment_status
  lesson_published
  system
  weekly_digest   // E1-S4 — opt-in weekly parent digest (email channel)
}
```

- **No new table.** The digest reuses the existing `NotificationPreference`
  (`@@unique([userProfileId, kind])`) row keyed on `kind = weekly_digest`,
  `emailEnabled` for opt-in. The "already sent this week" marker is also stored
  **without a new table** — see §6c (reuse the existing `Notification` row as the marker,
  keyed `kind=weekly_digest`, `sourceType='weekly_digest'`, `sourceId=<ISO-week>`).
- **`db push`, not a SQL migration.** This repo has **no** `prisma/migrations/` folder —
  the schema file is the source of truth applied via `prisma db push` (same convention as
  S3). Deliverable = the schema edit only; do **not** scaffold a migrations folder.
- **Both apps share this schema.** The worker reads `apps/api/prisma/schema.prisma` via
  its own `PrismaService` against the same DB — no second schema to edit. After the edit,
  the operator must `prisma generate` + `prisma db push` (a required pre-merge step,
  same as S3 — call it out in the PR; the typecheck gate only passes after `generate`).

## 6. Backend — preference plumbing + digest aggregate + idempotency marker

### 6a. Register the new kind (`apps/api/src/modules/notifications/preferences.service.ts`)
Add `weekly_digest` to the three existing arrays/maps so it surfaces in the prefs API/UI:
- `NOTIFICATION_KINDS` → append `'weekly_digest'`.
- `NOTIFICATION_KIND_LABEL['weekly_digest']` = `'Récapitulatif hebdomadaire'`.
- `NOTIFICATION_KIND_DESCRIPTION['weekly_digest']` =
  `"Un email une fois par semaine : moyenne, nouvelles alertes, évaluations à venir et action conseillée pour chaque enfant."`
No controller change — `GET/PATCH /api/v1/notifications/preferences/:kind` already serves
the full kind list and accepts any `NotificationKind`. **This is the entire UI-visible
backend surface for the toggle** (the existing `emailEnabledKeys` batch helper already
reads it).

### 6b. The digest aggregate (the reusable computation)
Add a **pure-ish, tenant-scoped** computation that, given `{ tenantId, studentId,
now }`, returns a `ChildDigest` payload. Put it where the worker can reuse it **against
the shared DB without importing the API app**. Two acceptable placements (pick one,
document it):
- **(Preferred)** a small self-contained service **in the worker**:
  `apps/worker/src/modules/parent-digest/digest-aggregate.service.ts`, computing
  everything via the worker's own `PrismaService` (the worker already has all the models).
  This keeps the worker independent (mirrors how `AlertsEvaluatorService` duplicates the
  rule logic worker-side) and avoids a cross-app HTTP call from a cron.
- **(Alternative)** an API method `AnalyticsService.parentDigest(...)` + a small
  internal/aggregate endpoint the worker fetches over HTTP. **Reject this** unless there
  is a strong reason — a worker cron hitting the API over HTTP per guardian is an N+1
  network pattern and adds an auth surface; prefer the in-worker Prisma computation.

`ChildDigest` shape (TypeScript, also mirrored into the email payload type — §6e):

```ts
interface ChildDigest {
  studentId: string;
  childName: string;            // "Prénom Nom"
  className: string | null;     // active class section name, or null
  globalAverage: number | null; // weighted /20 this period, null if no grades
  trendDelta: number | null;    // globalAverage − previousWeekAverage (signed), null if N/A
  newAlertsCount: number;       // AlertInstance.detectedAt in [now-7d, now]
  newAlertTitles: string[];     // up to 3 titles of those alerts (kind/non-stigmatising)
  upcoming: Array<{ title: string; subjectName: string | null; scheduledAt: string }>; // ≤3, next 7d
  recommendation: string;       // ONE next action (from most-severe open alert, else positive line)
}
```

Computation rules (all `tenantId`-scoped, all best-effort — never throw out of the loop):
- **Global average + trend:** reuse the grades query shape from
  `AnalyticsService.parentDashboard` (published/revised, `isAbsent=false`, joined to the
  active `academicYearId` via `assessment.teachingAssignment.academicYearId`), apply the
  same **coefficient resolver** (`SubjectCoefficient` by `gradeLevelId`, else the
  subject's `defaultCoefficient`, with `coefficientOverride` winning) to get a weighted
  `/20`. For the trend, compute the same weighted average **as of 7 days ago** (grades
  with `gradedAt`/`createdAt` ≤ `now-7d`) and set `trendDelta = current − previous`
  (round to 1 decimal). If either side has no grades → `trendDelta = null` and the email
  shows "—" (never invent a trend). **Do not over-engineer**: a simple two-snapshot
  weighted mean is sufficient; reuse the existing resolver logic, do not build a new
  analytics subsystem.
- **New alerts this week:** `prisma.alertInstance.count` + a `findMany(take:3)` where
  `{ tenantId, studentId, detectedAt: { gte: now-7d } }` ordered `severity desc,
  detectedAt desc`. Titles are the alert `title` field (already kind/explainable).
- **Upcoming assessments (next 7d):** `prisma.assessment.findMany` where the assessment
  belongs to the **student's class** (`teachingAssignment.classSectionId =
  <active classSection>`), `scheduledAt` in `(now, now+7d]`, `isPublished=false` or any
  (an upcoming assessment is not yet graded) — order `scheduledAt asc`, `take:3`, join
  `teachingAssignment.subject` for `subjectName`. Resolve the student's active
  classSection via the active `Enrollment` (status active, current academic year); if
  none, `upcoming = []`.
- **Recommendation (the "action" half):** if there is ≥1 **open** alert, take the most
  severe one's `recommendation` field (fallback to its `title`) — this is the same
  explainable next-step text the dashboard shows. If there are **no** open alerts, use a
  positive, non-stigmatising line, e.g. `"Aucune alerte cette semaine — continuez à
  suivre la progression dans le tableau de bord."` Always non-empty.

### 6c. Idempotency marker — "sent this week", NO new table
The job must email a guardian **at most once per ISO week**, even across re-ticks,
restarts, or overlapping runs. Reuse the **existing `Notification` table** as the marker
(no schema cost):
- Compute `weekKey = <ISO-year>-W<ISO-week>` (e.g. `2026-W23`) from `now`.
- **Before** sending to a guardian, check for an existing row:
  `prisma.notification.findFirst({ where: { tenantId, userProfileId, kind: 'weekly_digest',
  sourceType: 'weekly_digest', sourceId: weekKey } })`. If found → **skip** (already sent
  this week).
- **After** a successful send, create that marker row (`kind: 'weekly_digest'`,
  `severity: 'info'`, `title: 'Récapitulatif hebdomadaire envoyé'`,
  `body: '<n> enfant(s)'`, `link: '/parent/dashboard'`, `sourceType: 'weekly_digest'`,
  `sourceId: weekKey`, `readAt: new Date()` so it does **not** ring the bell — the digest
  is an email, the in-app marker is bookkeeping, not a notification the parent must read).
  Marking it read on insert keeps the topbar bell count honest.
- **Race safety:** two concurrent ticks could both pass the `findFirst` then both insert.
  Acceptable for v1 (worst case = a duplicate email, the cron is single-instance via
  `running` re-entrancy guard like `AlertsCronService`). If stronger safety is wanted, an
  optional `@@unique([tenantId, userProfileId, kind, sourceId])` partial-style guard on
  `Notification` is a follow-up — **do NOT add it in this slice** (it would touch the hot
  notifications insert path; out of scope).

### 6d. Guardian + opt-in resolution (worker side)
Mirror `AlertsEvaluatorService.notifyGuardiansOfAlert`'s guardianship query, but invert
to find **opted-in** guardians per tenant:
- Tenants to process = tenants that have **at least one** `NotificationPreference` row
  with `kind='weekly_digest'` and `emailEnabled=true` (one `findMany(distinct:['tenantId'])`).
- Per tenant, load those opted-in `(userProfileId, email, firstName, lastName, locale)`
  via `UserProfile` join (need the email to send). Skip any with a null/blank email.
- Per opted-in guardian, resolve their **active-guardianship** students:
  `prisma.guardianship.findMany({ where: { tenantId, status: 'active',
  guardian: { userProfileId: <gid> } }, include: { student: ... } })`. (A guardian links
  to students via `Guardian.userProfileId` — confirm the exact relation in
  `notifyGuardiansOfAlert` and reuse it verbatim.) De-dup students.
- Build one `ChildDigest` per student (§6b), assemble the guardian's email (§7), check +
  write the §6c marker, send. **Every per-guardian and per-student step is wrapped in
  try/catch + `logger.error`** so one bad child/guardian never aborts the tenant loop or
  the whole tick (same discipline as the alerts cron).

### 6e. Shared payload type (worker-local)
Add `apps/worker/src/modules/parent-digest/digest-email.types.ts` exporting the render
input (`{ to, recipientName, locale, weekLabel, children: ChildDigest[],
webBaseUrl-not-needed-here }`). This mirrors the `notification-email.types.ts` pattern
(worker-local type, no cross-package import). A `packages/contracts` type is **optional**
and **not required** (the digest is computed + rendered entirely worker-side; nothing in
the API or web consumes the shape).

## 7. Worker — the scheduled digest job + email template (`touchesWorker`)

### 7a. New module `apps/worker/src/modules/parent-digest/`
Mirror `alerts-cron`:
- `parent-digest.module.ts` — `@Module({ providers: [DigestAggregateService,
  ParentDigestCronService] })`, imported into `apps/worker/src/app.module.ts` (add it to
  the `imports` array next to `AlertsCronModule`).
- `parent-digest-cron.service.ts` — `implements OnApplicationBootstrap, OnModuleDestroy`,
  a **setInterval** cron exactly like `AlertsCronService` (NOT BullMQ — the work is
  idempotent + tolerant of skips, and needs the current `now()`):
  - **Schedule:** check on an interval (default hourly:
    `DIGEST_CHECK_INTERVAL_MS ?? 60*60*1000`, startup delay `DIGEST_STARTUP_DELAY_MS ??
    60_000`); on each tick, **only run the digest** when the current server-local time
    matches the configured send window — default **Monday, hour 07** (`DIGEST_SEND_DOW ??
    1` for Monday, `DIGEST_SEND_HOUR ?? 7`). The §6c week-marker makes this safe: even if
    several hourly ticks fall inside the send hour, each guardian is emailed at most once
    per ISO week. (This "check hourly, gate on dow+hour, dedup on week" pattern avoids a
    real cron lib and matches the repo's setInterval convention.)
  - Re-entrancy guard (`running` boolean) + `OnModuleDestroy` clears the timer — copy
    from `AlertsCronService`.
  - Per-tenant loop → per-guardian loop → build payload → marker check → render → send →
    write marker, with the best-effort try/catch discipline. Log a one-line summary per
    tick (`tenants, guardians considered, emails sent, skipped (already sent)`).
- `digest-aggregate.service.ts` — §6b computation.
- `digest-email.template.ts` — §7b renderer (pure + unit-testable, mirrors
  `notification-email.template.ts`).

### 7b. The digest email template (`digest-email.template.ts`)
A **pure, deterministic** `renderDigestEmail(input, { webBaseUrl }): { subject, html,
text }` mirroring `notification-email.template.ts` (inline-styled, table-based,
email-client-safe, French, escaped user strings via the same `esc` helper — copy it):
- **Subject:** `📊 Récapitulatif hebdomadaire — <semaine du JJ/MM>` (one child) or with the
  child count for several.
- **Header:** branded bar + "Bonjour <prénom>," + a one-line intro ("Voici le suivi de la
  semaine pour vos enfants.").
- **One card per child** (max ~one screen, so cap at the guardian's children; if many,
  it's fine — one compact card each): child name + class chip; the **global average /20**
  with a **trend pill** (▲ green / ▼ rose / — slate using the `trendDelta` sign, mirroring
  the `SEVERITY_COLOR` inline-color approach — never compare to peers, only to the child's
  own prior week); a **"X nouvelle(s) alerte(s) cette semaine"** line listing up to 3
  titles (or "Aucune nouvelle alerte" in green); an **"Évaluations à venir"** mini-list
  (≤3, date + subject) or "Pas d'évaluation prévue"; and a highlighted **"À faire :
  <recommendation>"** action line.
- **One CTA button** → absolutised `/parent/dashboard` (reuse the `absoluteLink` helper).
- **Footer:** the same opt-out reassurance as `notification-email.template.ts` —
  "Vous recevez cet email car vous avez activé le récapitulatif hebdomadaire. Gérez vos
  préférences dans Réglages › Notifications." (RGPD-kind, explains why + how to stop).
- **Tone guardrail:** factual, kind, non-stigmatising. No child is compared by name to a
  peer; the only comparison shown is the child vs. their own previous week.

### 7c. No new queue / no new dependency
- **No new BullMQ queue** — the cron renders + sends inline via `MailerService` (already
  wired through `MailModule`; ensure the new module imports `MailModule` and
  `PrismaModule`, both already global/available — check `mail.module.ts` export and the
  worker's module graph; `PrismaModule` is global). Do **not** route through the
  `notifications-email` queue (that queue's payload is per-notification; the digest is a
  multi-child composite — sending inline is simpler and correct).
- **No new npm dependency.** ISO-week can be computed with a tiny pure helper (≤10 lines)
  — do not add `date-fns`/`luxon`.

## 8. Frontend — the preference toggle (minimal)

The heavy lifting is already done: `PreferencesPanel` (used by `/parent/settings` ›
Notifications, `apps/web/src/app/parent/settings/page.tsx`) renders **whatever kinds the
backend returns**, with In-app / Email / Push switches. Once §6a adds `weekly_digest` to
`NOTIFICATION_KINDS`, the row **appears automatically** with the label/description. So the
FE work is small and mostly cosmetic:
- **Confirm the new row renders** with the correct French label/description (server-driven
  — no FE code change strictly required for it to appear).
- **In-app column for a digest:** the digest is an **email-only** concept. The simplest
  correct behavior is to leave the In-app toggle functional but irrelevant (a `weekly_digest`
  in-app notification is never produced except the silent §6c marker, which is pre-read).
  **Preferred polish:** in `PreferencesPanel.tsx`, when `row.kind === 'weekly_digest'`,
  render the In-app cell as a muted "—" / "n/a" (like the Push "Bientôt" treatment) so a
  parent isn't misled into thinking the digest shows in the bell. Keep this a tiny,
  self-contained branch; do **not** refactor the panel. If time-boxed, skipping this polish
  is acceptable (the email toggle is the load-bearing control).
- **Explanatory blurb:** optionally extend the existing "Pourquoi activer les
  notifications ?" card on the parent settings notifications tab with a line about the
  weekly digest ("Recevez chaque semaine un récapitulatif par email…"). Optional.
- **Reuse `@pilotage/ui` first.** No new shared primitive. The toggle UI already exists.
- **A11y (WCAG 2.2 AA):** the new switch inherits the existing `role="switch"` +
  `aria-checked` + `aria-label` pattern — verify the `aria-label` reads sensibly
  ("Email pour Récapitulatif hebdomadaire"). If you add the "—" in-app cell, give it
  `aria-label`/`title` ("Non applicable au récapitulatif") and ≥4.5:1 contrast (use
  `text-slate-500`, not `text-slate-400`).

## 9. Acceptance criteria (testable)

1. **Schema (enum-only):** `NotificationKind` gains exactly one value `weekly_digest`;
   **no** new table and **no** `prisma/migrations/` folder are created (repo uses
   `db push`). Prisma validates and the worker's generated client sees the value.
2. **Preference surfaces:** `GET /api/v1/notifications/preferences` returns a
   `weekly_digest` row (label « Récapitulatif hebdomadaire », a non-empty description,
   `emailEnabled` defaulting to **false**); `PATCH /api/v1/notifications/preferences/weekly_digest`
   with `{ emailEnabled: true }` persists via the **unchanged** controller/service.
3. **Opt-in gate (the RGPD guarantee):** the digest job emails a guardian **only if**
   they have an explicit `weekly_digest` `NotificationPreference` with `emailEnabled=true`;
   a guardian with no such row (default off) receives **no** email. Pinned by a worker
   test: opted-in guardian → one `MailerService.send`; opted-out guardian → zero sends.
4. **Per-child payload correctness:** for an opted-in guardian, the built `ChildDigest`
   has: a weighted `/20` global average (or `null` with no grades); a signed `trendDelta`
   (or `null` when either week lacks grades); `newAlertsCount` = alerts with
   `detectedAt ≥ now-7d` (with ≤3 titles); `upcoming` = ≤3 assessments scheduled in
   `(now, now+7d]` for the child's active class; a non-empty `recommendation` (most-severe
   open alert's recommendation, else a positive line). All queries are `tenantId`-scoped.
5. **Weekly idempotency:** running the digest job **twice in the same ISO week** emails
   each opted-in guardian **once** (the second tick finds the `sourceType='weekly_digest',
   sourceId=<weekKey>` marker and skips). The marker row is created with `readAt` set
   (does **not** increment the topbar bell). Pinned by a worker test.
6. **Schedule gating:** the cron checks on an interval but only sends inside the
   configured day-of-week + hour window (default Monday 07h), and the env knobs
   (`DIGEST_CHECK_INTERVAL_MS`, `DIGEST_STARTUP_DELAY_MS`, `DIGEST_SEND_DOW`,
   `DIGEST_SEND_HOUR`) override the defaults. Re-entrancy guard prevents overlapping ticks.
7. **Resilience (best-effort):** a failure building one child's payload, or one guardian's
   send, is caught + logged and does **not** abort the tenant loop or the tick; a send
   failure does **not** write the §6c marker (so the next eligible tick retries that
   guardian — markers are written only after a successful send).
8. **Email content:** the rendered digest is valid French, inline-styled/table-based
   (email-client-safe), escapes user-provided strings, shows one card per child with
   average + own-prior-week trend (never a peer comparison), new-alert titles, upcoming
   assessments, the "À faire" action line, a CTA to `/parent/dashboard`, and an opt-out
   footer. A pure-function template test asserts subject + presence of each section + the
   absolute CTA URL.
9. **Tenant + audit invariants:** every digest query is `tenantId`-scoped; the job never
   crosses tenants; no existing append-only audit row is mutated. (The digest itself is a
   read + email + one bookkeeping `Notification` insert — no audit semantics needed beyond
   the marker.)
10. **UI:** `/parent/settings` › Notifications shows the « Récapitulatif hebdomadaire »
    row with a working Email toggle; the (optional) in-app "—" treatment, if added, is
    accessible (≥4.5:1, labelled). No new shared primitive; `@pilotage/ui` reused.
11. **No new architectural decision without an ADR.** A scheduled worker job + reusing
    `NotificationPreference` + reusing the `Notification` row as a week-marker are all
    consistent with existing patterns (ADR-001 modular monolith, the alerts-cron
    precedent, R8 notifications) → **no new ADR**; confirm with Winston. **No** new queue,
    **no** new dependency, **no** new table.
12. `pnpm typecheck` passes (the Murat gate) **after** the operator runs `prisma generate`
    + `prisma db push` (a required pre-merge step — the schema edit is committed but the
    regenerated client is not in the diff, same as S3). No `git diff --check` whitespace
    errors. No client N+1 (the worker batches per tenant).

## 10. Non-goals (explicitly out of THIS slice)

- ❌ A configurable per-user **frequency / day / hour** (daily, fortnightly, "choose your
  day") — the digest is a fixed weekly cadence in S4; per-user scheduling is a follow-up.
- ❌ **Push** delivery of the digest (push is "Bientôt" platform-wide; email only here).
- ❌ A **teacher / admin** digest (this slice is parent-only; staff digests are future).
- ❌ A **new BullMQ queue** or **new worker dependency** (`date-fns`/`luxon`); compute +
  send inline, ISO-week via a tiny pure helper.
- ❌ A **new table** (no `digest_send_log`; the existing `Notification` row is the marker).
- ❌ A **rich charts / per-subject breakdown** in the email — the digest is a one-screen
  summary (global average + trend + new alerts + upcoming + one action), not the dashboard.
- ❌ An **in-app "digest preview" page** (the parent already has the live dashboard; the
  digest is a push channel, not a new surface).
- ❌ Changing the S1/S2/S3 alert lifecycle, deep-link derivation, or `MeetingRequest`.
- ❌ Wiring the **cron-path alert email** (that asymmetry is E3/E5 territory — the digest
  does its own sending and does not touch `notifyGuardiansOfAlert`).
- ❌ A **localised** (non-French) template — French only, consistent with the existing
  notification email (locale field is passed through but only `fr-FR` is rendered).

## 11. Files (expected touch set — keep disjoint per the agent split)

**Backend (`apps/api`):**
- `prisma/schema.prisma` — **edit**: add `weekly_digest` to `NotificationKind`. `[schema]` tag.
- `src/modules/notifications/preferences.service.ts` — **edit**: add `weekly_digest` to
  `NOTIFICATION_KINDS`, `NOTIFICATION_KIND_LABEL`, `NOTIFICATION_KIND_DESCRIPTION`.

**Worker (`apps/worker`):**
- `src/modules/parent-digest/parent-digest.module.ts` — **new**: the module.
- `src/modules/parent-digest/parent-digest-cron.service.ts` — **new**: setInterval cron
  (dow+hour gate, re-entrancy guard, per-tenant→per-guardian loop, marker dedup, send).
- `src/modules/parent-digest/digest-aggregate.service.ts` — **new**: builds `ChildDigest`
  (global average + trend + new alerts + upcoming + recommendation), all `tenantId`-scoped.
- `src/modules/parent-digest/digest-email.template.ts` — **new**: pure
  `renderDigestEmail(...)` (mirrors `notification-email.template.ts`).
- `src/modules/parent-digest/digest-email.types.ts` — **new**: worker-local payload type
  + `ChildDigest`.
- `src/modules/parent-digest/digest-email.template.spec.ts` — **new**: pure template test
  (subject, sections, absolute CTA URL, escaping).
- `src/modules/parent-digest/parent-digest-cron.spec.ts` (or `digest-aggregate.spec.ts`)
  — **new**: opt-in gate (opted-in → send, opted-out → no send) + weekly idempotency
  (second tick skips) + best-effort (one failure doesn't abort the loop). The single most
  valuable targeted test per the Murat plan-phase rule.
- `src/app.module.ts` — **edit**: import `ParentDigestModule`.

**Frontend (`apps/web`):**
- `src/app/admin/settings/PreferencesPanel.tsx` — **edit (optional polish)**: render the
  In-app cell as a muted "—" when `row.kind === 'weekly_digest'` (accessible). The row
  itself appears with **no** FE change once the backend lists the kind.
- `src/app/parent/settings/page.tsx` — **optional**: extend the "Pourquoi activer les
  notifications ?" card with a weekly-digest line. Optional.

**Contracts:** none required (digest is computed + rendered worker-side; nothing shared).

## 12. Risk tier & escalation

- **Risk tier: P1** — carries a `[schema]` change (a new `NotificationKind` enum value —
  low-risk additive, but it is a Prisma schema + `db push` step) **and** it sends **email
  containing a child's academic data** (RGPD-sensitive), so it is **never silently
  auto-merged**: it triggers the escalation panel (architect + security + test-architect)
  and is flagged *needs human review*. Sentinel must confirm:
  (a) the digest is **strictly opt-in** — no email without an explicit `weekly_digest`
  `emailEnabled=true` row (AC3);
  (b) every query is `tenantId`-scoped and the per-child data only reaches the **guardian
  with an active guardianship** on that child (reuse the `notifyGuardiansOfAlert`
  guardianship query — no cross-tenant / non-guardian leak);
  (c) the email is non-stigmatising (child vs. own prior week only, never named-peer
  comparison) and carries the opt-out footer;
  (d) the week-marker is read-stamped so it never inflates the bell count, and no
  append-only audit row is mutated.
  Winston must confirm the scheduled job + enum value + `Notification`-as-marker introduce
  **no** new architectural decision (consistent with ADR-001 + the alerts-cron precedent +
  R8 notifications) → **no** new ADR.
- **Operator pre-merge step (carried from S3):** the committed schema edit needs
  `prisma generate` + `prisma db push` before typecheck is green; the regenerated client
  is intentionally not in the diff. Call this out in the PR description.

## 13. Pre-mortem (failure modes → folded into §9)

- *"We emailed a parent who never opted in (RGPD breach)."* → §6a default off + §6d gate on
  `emailEnabled=true` + §9 AC3 (opted-out → zero sends, pinned by test).
- *"A re-tick / restart double-emailed every guardian."* → §6c week-marker + §9 AC5
  (second tick skips) + the re-entrancy guard.
- *"A send failure left a marker, so the parent never got that week's digest."* → §6c +
  §9 AC7 (marker written **only after** a successful send).
- *"One child with no grades / no class threw and killed the whole tenant's run."* → §6b/§6d
  best-effort try/catch + §9 AC4/AC7 (graceful nulls, one failure never aborts the loop).
- *"The trend lied (showed a delta with no prior data, or compared to peers)."* → §6b
  `trendDelta=null` when either week lacks grades + §7b own-prior-week-only + §9 AC4/AC8.
- *"Someone added a new queue / `date-fns` / a `digest_send_log` table and blew scope."* →
  §10 non-goals + §6c (reuse `Notification`) + §7c (no new queue/dep) + §9 AC11.
- *"The cron fired at the wrong time / every hour."* → §7a dow+hour gate + week-marker +
  §9 AC6 (gated send, env-overridable, idempotent).
- *"The schema change broke Prisma validate / the worker client didn't see the value."* →
  §5 enum-only + `db push` + §9 AC1/AC12 (typecheck gate after generate).
