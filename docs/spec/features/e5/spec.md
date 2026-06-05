# E5 — Advanced Notifications (dispatcher + digest + prefs)

> **Status:** in-progress (spec run) · **Size:** ~M · **Tier:** 2 (MVP pillars / R8)
> **Audit:** ~70%. The platform already has the `Notification` + `NotificationPreference`
> models, the topbar bell + `/notifications` feed, a per-kind channel-gated **email
> dispatcher that works end-to-end** (worker `notifications-email` processor →
> branded template → `MailerService`/Maildev), and one digest precedent (the E1-S4
> weekly parent digest cron). The gaps the roadmap names are: **fight notification
> fatigue** (no cross-kind grouping / cadence control) and a **dedicated
> parent/teacher preferences UI** (today only `/admin/settings` has a panel).

## Vision

Give every parent and teacher **one coherent promise: "no fatigue, full control."**
Today notifications are real but binary — each kind is in-app-on / email-off, fires
instantly, one row per event. A parent whose child has a rough week can get five
emails in an afternoon (an alert, two published grades, a teacher message, an
announcement). That is exactly the *information overload* the cahier de charges warns
against — the dashboard's job is to **turn information into action**, not to flood an
inbox until the parent mutes everything and misses the alert that mattered.

E5 unifies the notification stack under a single user-facing control: a **per-kind
notification cadence** — **Instant · Daily digest · Off** — backed by one additive
`NotificationPreference.cadence` field. The dispatcher (already built), the
digest/grouping worker, and the preferences UI all express *that one model* instead of
three disconnected toggles. A parent picks "Daily digest" for routine kinds (grades,
announcements) and keeps "Instant" for the things that need a same-day reaction
(alerts, messages) — and the platform respects it everywhere, in-app and by email.

E5 is deliberately **scoped around what already ships**: S1 is a *verify & harden*
baseline over the existing dispatcher (no re-implementation), and the net-new ambition
lives in S2 (cross-kind digest & cadence) and S3 (the dedicated prefs UI).

## Users & why

- **Parent — the core user.** Wants the alerts and messages that need a reaction
  *now*, and everything else **bundled into one calm daily summary** instead of a
  drip of emails. Wants to set this for themselves in a place they can find (not buried
  in an admin-only settings page). The cahier's anti-overload, "kind & non-stigmatising"
  tone applies to the *cadence of delivery*, not just the wording of each alert.
- **Teacher.** Same fatigue problem from the other side: parent messages + flagged-grade
  follow-ups + announcements. Wants instant for messages, digest for the rest, and a mute
  for a kind they never act on. Today the teacher portal has **no** notification settings
  surface at all.
- **Admin / school.** Benefits indirectly: parents who aren't drowning keep email opt-in
  on, so the alert email that matters actually gets read. No admin action is required by
  E5 (the admin `/admin/settings` panel keeps working unchanged).

## Concrete scenarios

1. **Calm daily digest (S2 — the headline).** A parent sets **Grades** and
   **Announcements** to *Daily digest* and leaves **Alerts** and **Messages** on
   *Instant*. Over a school day three grades are published and one announcement goes out
   — they generate **no email** at publish time. The next morning (configurable send
   window) the parent receives **one** grouped email: "3 nouvelles notes · 1 annonce",
   each item linking back into the app. A new low-average **alert** the same day still
   arrives **instantly** because its cadence is Instant. The parent reads four pieces of
   information from one calm message + one urgent one — not five separate pings.

2. **Self-service preferences (S3).** A parent opens **`/parent/settings/notifications`**
   (a real parent-portal page, not the admin panel). For each kind they see a friendly
   row — label, plain-language description, a **cadence selector (Instant / Daily digest /
   Off)** and the channel switches (in-app, email; push shown "bientôt"). They flip
   Grades to *Daily digest*, mute *System*, and keep *Alerts* Instant. The change
   round-trips through the same `NotificationPreference` rows the dispatcher reads, so it
   takes effect on the very next event. A teacher gets the **same** surface at
   **`/teacher/settings/notifications`**.

3. **Dispatcher baseline holds (S1).** A parent who has email **on + Instant** for the
   `alert` kind gets the branded alert email within seconds of the alert being raised
   (cron path *and* API path), rendered by the shared `notifications-email` template,
   delivered via Maildev in dev / SMTP in prod, retried with backoff on transient SMTP
   failure, and **never** double-sent for the same source event. A parent who opted out
   gets in-app only. This already works — S1 *proves* it with a targeted test + a
   documented verification, and hardens any gap found (see S1 below).

4. **Mute the noise (S3 + S2).** A teacher sets **Announcements** email to *Off*. They then
   receive announcement **emails** neither per-event **nor** in the daily digest — the kind's
   email is muted while their channel choice is preserved (un-muting later restores it). The
   in-app bell still reflects announcements per the in-app switch, so muting email never
   hides information inside the app — it only stops the inbox noise.

## Functional requirements

**FR-1 — One cadence model, three values.** Each `(user, kind)` has an **email cadence**:
`instant` (email per-event as today), `daily_digest` (suppress the per-event email;
include the event in the next daily digest), or `off` (mute this kind's email, preserving
the channel choice). Cadence is **additive** on `NotificationPreference` (`cadence` enum,
default `instant`) — it does **not** replace the existing `inAppEnabled` / `emailEnabled` /
`pushEnabled` channel switches; it **governs email frequency only** and composes with them
(see FR-2). The in-app bell remains governed by `inAppEnabled`, unchanged.

**FR-2 — Cadence × channel composition (deterministic).** Cadence controls the **email**
channel only; the in-app row is governed by `inAppEnabled` exactly as today. For a given
event of kind *k* addressed to user *u*, the **email** decision is layered in this
precedence (matching `data-model.md` §1.2):
- `emailEnabled = false` → **no email**, cadence irrelevant (unchanged from today).
- `emailEnabled = true` + `cadence = off` → **muted**: no email, but the channel boolean
  stays on so the user can un-mute without losing their choice (a soft per-kind snooze).
- `emailEnabled = true` + `cadence = instant` → **email now** (today's path; the default).
- `emailEnabled = true` + `cadence = daily_digest` → **skip the per-event email**; the
  event becomes eligible for the next daily digest.

The in-app row is **always** written per `inAppEnabled` (so the bell stays a live feed)
**except** the one digest-source edge case in FR-4. The S3 UI collapses the two email
"no-email" states (`emailEnabled = false` and `cadence = off`) into a single user-facing
**Off** affordance while preserving the richer state server-side (see S3 story).

**FR-3 — Existing dispatcher is the delivery substrate (no re-implementation).** All
email delivery continues to flow through the **existing** `notifications-email` BullMQ
queue → worker processor → `renderNotificationEmail` template → `MailerService`. E5 adds
**no** new queue and **no** new per-event email template. The daily digest reuses the
established **cron + composite-email** pattern already proven by the E1-S4 weekly digest
(`apps/worker/.../parent-digest/*`).

**FR-4 — Daily digest, cross-kind & grouped.** A worker cron, on a configurable daily
send window, gathers each user's `daily_digest`-cadence, `emailEnabled` events since their
last digest (the durable source is the user's **`Notification` rows** for those kinds in
the day window), **groups them by kind** ("3 nouvelles notes · 1 annonce · 1 alerte"),
renders **one** composite email per user, and sends it via the existing mailer. Idempotent
per `(user, day)` with **no new table** (a `Notification` sent-marker row, exactly like the
weekly digest). An empty digest sends **nothing**. **Digest-source edge case:** if a user
sets a kind to `cadence = daily_digest` while `inAppEnabled = false`, `createMany` still
writes a hidden in-app row (`readAt` pre-set, so it never rings the bell) so the cron has a
durable source — this is the **only** exception to FR-2's "in-app per `inAppEnabled`" rule
(see `data-model.md` §3.3; the S2 story records the final shape).

**FR-5 — Generalises, does not duplicate, the weekly digest.** The existing E1-S4
`weekly_digest` (a *fixed-content* parent summary: trend, new alerts, upcoming
assessments) stays as-is and is **out of scope to rewrite**. E5's daily digest is the
*cross-kind notification-grouping* mechanism (it bundles whatever notification kinds the
user put on `daily_digest`). The two coexist; the prefs UI presents them clearly (the
weekly digest remains its own email-only "summary" row; cadence applies to the per-event
kinds).

**FR-6 — Dedicated prefs UI on both portals.** A real **parent** page
(`/parent/settings/notifications`) and **teacher** page
(`/teacher/settings/notifications`) let each user manage **their own** preferences:
per-kind **cadence selector** + channel switches + an explicit **mute** (cadence Off).
Built from `@pilotage/ui` primitives, premium / responsive / WCAG-AA, French
conversational copy, non-stigmatising. Reuses the **existing** `GET/PATCH
/notifications/preferences` endpoints (extended additively with `cadence`), so the admin
`PreferencesPanel` keeps working unchanged.

**FR-7 — Self-scoped & safe.** Every read/write is the **caller's own** preferences
(`profile.read.self` / `profile.write.self`, exactly as today) — a user can never read
or change another user's settings. Tenant + RLS on every query. Every digest send and
every preference change respects tenant boundaries; the digest resolves recipients
per-tenant. Children's data in the digest stays minimal (kind + count + link; no grade
values beyond what the per-event notification already carried).

**FR-8 — Backward compatible by default.** A user with **no** override row, or a row
without an explicit cadence, behaves **exactly as today** (`cadence = instant`). No
existing notification path changes behaviour until a user deliberately picks a non-default
cadence. The `weekly_digest` opt-in, the messaging email (E2-S4), and the alert email
(E3-S4) all keep working with zero change required.

## Acceptance criteria (epic-level)

- **AC-1 (cadence field, additive).** `NotificationPreference` gains a `cadence`
  enum (`instant` | `daily_digest` | `off`, default `instant`) via `prisma db push`
  (repo convention — no SQL `migrations/` folder). Additive + defaulted ⇒ safe on
  existing rows, **no backfill**. No other column changes; the `@@unique([userProfileId,
  kind])` and tenant index are unchanged.
- **AC-2 (composition is exact).** The `createMany` / `dispatchEmails` path honours
  FR-2's email-precedence: `emailEnabled=false` → no email; `cadence=off` → muted (no
  email, boolean preserved); `cadence=daily_digest` → no per-event email, event becomes
  digest-eligible; `cadence=instant` → byte-for-byte today's email path. The in-app row is
  written per `inAppEnabled`, unchanged, except the FR-4 digest-source edge case. A unit
  test pins every row of the email truth table (and the edge case).
- **AC-3 (digest groups & is idempotent).** The daily-digest cron sends **one** grouped
  email per eligible user per day, grouped by kind with counts and deep links; re-running
  the same day sends **nothing** (sent-marker `Notification` row, no new table); an empty
  set sends nothing; a per-user failure never aborts the tenant loop (mirrors the weekly
  digest's resilience). **No new BullMQ queue, no new per-event template.**
- **AC-4 (dedicated UI, self-scoped).** `/parent/settings/notifications` and
  `/teacher/settings/notifications` render every kind with a cadence selector + channel
  switches + mute, persist via `PATCH /notifications/preferences/:kind` (now accepting
  `cadence`), and reflect the change on reload. A user can only ever read/write their own
  prefs (`profile.*.self`); no cross-user access. WCAG-AA: the cadence selector is a
  keyboard-operable radio group with visible focus + 44px targets.
- **AC-5 (dispatcher baseline verified — S1).** A documented verification + a targeted
  test prove the existing email dispatcher works end-to-end (queue→template→Maildev),
  honours prefs, retries with backoff, and never double-sends for one source event. Any
  concrete defect found in that audit is fixed within S1 (additive/minimal). No new queue,
  no new template, no schema change in S1.
- **AC-6 (RGPD / tone / tenancy).** Tenant + RLS + `profile.*.self` on every operation;
  the digest carries minimal child data (counts + links, not grade values beyond the
  per-event notification's own body); all copy is factual, kind, non-stigmatising,
  French; an append-only `AuditLog` row is written where the established convention
  already writes one (preference change follows the existing notifications-module
  convention; the digest send writes its sent-marker, not a new audit table).
- **AC-7 (no new architectural decision).** E5 reuses the established producer/consumer
  email pattern, the cron + composite-email digest pattern, the `NotificationPreference`
  model, and `@pilotage/ui`. The only schema change is the additive `cadence` enum/field.
  If any slice is forced into a new cross-cutting pattern (e.g. a second queue), it lands
  **with a new `docs/adr/` ADR** (Winston gate). None is anticipated.

## Non-goals

- **No web push / SMS / mobile-push delivery.** `pushEnabled` stays a "bientôt" placeholder;
  E5 ships **in-app + email** cadence only. (Push is a later epic.)
- **No real-time / WebSocket** notification stream (same ADR-019 deferral as messaging).
- **No rewrite of the E1-S4 weekly parent digest** (fixed-content summary) and **no
  rewrite of the existing per-event email template** — both are reused as-is.
- **No new BullMQ queue and no new per-event email template.** The daily digest reuses
  the cron + composite-email pattern; per-event emails keep the existing
  `notifications-email` queue/template.
- **No per-kind custom send windows / per-user time-zone scheduling** beyond a single
  configurable daily window (env-driven, like the weekly digest's `DIGEST_SEND_*`).
  Per-user TZ is a future refinement.
- **No quiet-hours, no snooze, no per-thread mute** (a kind-level mute via cadence Off is
  the E5 granularity). No notification *categories* beyond the existing `NotificationKind`
  values.
- **No admin-managed, org-wide notification policy** (E5 is per-user self-service; the
  admin panel keeps its existing scope).

## Slices (ship in order; each ≤ a day, one PR, demoable end-to-end)

- **S1 — Verify & harden the email dispatcher (baseline).** *(worker/api — verify-first;
  `[worker]` low risk)* Prove the already-built end-to-end email path
  (queue→`notifications-email` processor→`renderNotificationEmail`→`MailerService`/Maildev),
  honouring per-kind `emailEnabled`, with retry/backoff and source-dedup (no double-send).
  Add the single most valuable targeted test and a documented `quickstart` verification;
  fix any concrete gap found (additive/minimal, no schema). Establishes the trustworthy
  substrate S2/S3 build on. **No new queue, template, or schema.**

- **S2 — Cross-kind daily digest & cadence.** *(schema + api + worker; `[schema][worker]`
  P1)* Add the additive `NotificationPreference.cadence` enum/field (`instant` |
  `daily_digest` | `off`, default `instant`) + wire FR-2 composition into the existing
  `createMany`/`dispatchEmails` gate (off suppresses all; daily_digest suppresses
  per-event email but keeps the in-app row; instant unchanged). Add a **daily-digest
  worker cron** that groups each eligible user's undelivered `daily_digest` kinds into one
  composite email (reusing the weekly-digest cron + composite-template pattern), idempotent
  per `(user, day)` via a sent-marker `Notification` row — **no new table, no new queue**.

- **S3 — Dedicated parent/teacher notification-preferences UI.** *(web; `[web][a11y]`)*
  Real parent (`/parent/settings/notifications`) and teacher
  (`/teacher/settings/notifications`) pages: per-kind **cadence selector (Instant / Daily
  digest / Off)** + channel switches + mute, built from `@pilotage/ui`, WCAG-AA,
  non-stigmatising French copy. Reuses the existing self-scoped `GET/PATCH
  /notifications/preferences` (extended additively with `cadence` in S2). The admin
  `PreferencesPanel` is left working unchanged; the parent/teacher surfaces are the net-new
  value.

See [`tasks.md`](./tasks.md) for the slice backlog, [`plan.md`](./plan.md) for the
architecture, [`data-model.md`](./data-model.md) for the one additive field,
[`contracts/openapi.yaml`](./contracts/openapi.yaml) for the API delta, and
[`quickstart.md`](./quickstart.md) for the manual demo per slice. Per-slice self-contained
specs live in `stories/` (written on each slice's run).
