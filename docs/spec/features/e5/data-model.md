# E5 — Data model & migration plan (Architect: Winston)

> Companion to [`spec.md`](./spec.md) / [`plan.md`](./plan.md) / [`contracts/openapi.yaml`](./contracts/openapi.yaml).
> E5 "Advanced Notifications" is **mostly behavioural + UI** on top of an **already-built email
> dispatcher**. The **only schema change in the whole epic is S2's single additive
> `NotificationPreference.cadence` enum column** (plus its enum type). Everything else reuses the
> existing `Notification` / `NotificationPreference` models and the `notifications-email` queue.
>
> **Migration convention (repo-wide, verified):** `prisma db push`, **no SQL `migrations/` folder**
> (`apps/api/prisma/migrations/` does not exist — same as E1-S3, E2-S1, E2-S4, E3-S1, E3-S2). Schema is
> additive + defaulted ⇒ safe on existing rows, **no backfill**, zero-downtime (expand-only).

---

## 0. What already exists (NO change needed) — S1 is a verify/harden baseline

The audit (2026-06-05) confirms the **email dispatcher is effectively built**; S1 does **not**
re-implement it. The following are in place and untouched by E5:

| Asset | Location | Role |
|---|---|---|
| `model Notification` | `schema.prisma` (`@@map("notification")`) | per-recipient in-app row; `sourceType`/`sourceId` dedup; `readAt`. **Used as the digest sent-marker** (E1-S4 precedent). |
| `model NotificationPreference` | `schema.prisma` (`@@map("notification_preference")`) | per-`(userProfileId, kind)` channel gates: `inAppEnabled` (def true), `emailEnabled` (def false), `pushEnabled` (def false). **S2 adds ONE column here.** |
| `enum NotificationKind` | `schema.prisma` | `announcement, alert, grade_published, enrollment_status, lesson_published, system, weekly_digest, message`. **No new value in E5.** |
| `enum NotificationSeverity` | `schema.prisma` | `info, success, warning, danger`. unchanged. |
| `NotificationsService.createMany` + `dispatchEmails` | `apps/api/.../notifications.service.ts` | source-dedup → in-app gate (`disabledInAppKeys`) → **email gate** (`emailEnabledKeys`) → `emailQueue.addBulk`. The dispatcher core. |
| `NotificationPreferencesService` | `apps/api/.../preferences.service.ts` | `disabledInAppKeys`, `emailEnabledKeys`, `listForUser`, `update`, `isEnabled`. |
| `QUEUE_NOTIFICATIONS_EMAIL` | api + worker `shared/queue/queue.module.ts` | the `notifications-email` BullMQ queue (registered both sides). |
| `NotificationsEmailProcessor` + `renderNotificationEmail` | `apps/worker/.../notifications-email/*` | consumes the queue, renders the branded template, sends via `MailerService` (Maildev in dev). |
| `MailerService` | `apps/worker/.../shared/mail/mailer.service.ts` | pooled nodemailer transport (`MAIL_HOST`/`MAIL_PORT`/`MAIL_FROM`). |
| Weekly digest cron + aggregate | `apps/worker/.../parent-digest/*` | E1-S4: `ParentDigestCronService` (Mon 07h UTC window), `DigestAggregateService.buildChildDigest`, `renderDigestEmail`, ISO-week idempotency marker. **S2 generalises this, does NOT duplicate it.** |
| `GET/PATCH /notifications/preferences[/:kind]` | `apps/api/.../preferences.controller.ts` | `profile.read.self` / `profile.write.self`; the channel-toggle contract S3's UI already drives. |
| `PreferencesPanel` + `preferences-actions.ts` | `apps/web/src/app/admin/settings/*` | the shared channel-grid UI + server actions, mounted on **admin** settings today; also reachable from `/teacher/settings` + `/parent/settings` pages. **S3 extends this, no rewrite.** |

> **S1 = ZERO schema change, ZERO new model.** S1 is a *verification + hardening* slice (idempotency
> on the email path, bounce/failure handling posture, config/env documentation, a parity test that
> the gate runs). It produces no `data-model` delta. The single epic-wide schema change is S2's below.

---

## 1. S2 — the ONLY schema change: `NotificationPreference.cadence` (additive)

**The visionary spine of E5** is one user-facing promise — a per-kind **notification cadence**
(`instant` / `daily-digest` / `off`) — that the dispatcher (S1), the digest worker (S2) and the prefs
UI (S3) all express. Today the channel is a boolean (`emailEnabled`). E5 makes the **email frequency**
a first-class, additive enum on the existing per-`(user, kind)` row. **No new table** — cadence is an
attribute of the preference that already exists.

### 1.1 New enum type

```prisma
/// Per-(user, kind) notification CADENCE (E5-S2). The primary delivery control;
/// it composes with the channel booleans (see §1.2 truth table, spec FR-2):
/// - instant       → today's behaviour: deliver per-event on each enabled channel
///                   (in-app iff inAppEnabled; email iff emailEnabled). The default.
/// - daily_digest  → suppress per-event EMAIL; the in-app row is still written iff
///                   inAppEnabled (bell stays a live feed); the event is digest-eligible
///                   iff emailEnabled (the daily cron sends one grouped email/day).
/// - off           → the strongest setting: NO in-app row, NO email, NOT in the digest
///                   — "off wins" over the channel switches for that kind.
enum NotificationCadence {
  instant
  daily_digest
  off
}
```

### 1.2 Additive column on the existing model

```prisma
model NotificationPreference {
  id            String              @id @default(uuid()) @db.Uuid
  tenantId      String              @map("tenant_id") @db.Uuid
  userProfileId String              @map("user_profile_id") @db.Uuid
  kind          NotificationKind
  inAppEnabled  Boolean             @default(true) @map("in_app_enabled")
  emailEnabled  Boolean             @default(false) @map("email_enabled")
  pushEnabled   Boolean             @default(false) @map("push_enabled")
  // --- E5-S2: per-kind email cadence (additive, defaulted) ---
  cadence       NotificationCadence @default(instant) @map("cadence")
  updatedAt     DateTime            @updatedAt @map("updated_at") @db.Timestamptz(6)

  userProfile UserProfile @relation(fields: [userProfileId], references: [id], onDelete: Cascade)

  @@unique([userProfileId, kind])
  @@index([tenantId])
  // E5-S2: lets the daily-digest cron resolve "who wants a grouped email of kind K"
  // cheaply, tenant-first, without scanning every preference row.
  @@index([tenantId, cadence, emailEnabled])
  @@map("notification_preference")
}
```

**Decisions / rationale**

- **Default `instant` = today's exact behaviour.** Every existing row (and every missing row, which
  resolves to defaults in `listForUser`) keeps delivering per-event exactly as today. The change is
  *invisible* until a user opts a kind into `daily_digest` or `off`. Strictly additive, no behavioural
  regression (spec FR-8 / AC-1).
- **Cadence is the PRIMARY control; it composes with the channel booleans (spec FR-2).** The exact
  per-`(user, kind, channel)` truth table the dispatcher gate codifies (§3):

  | cadence | in-app row | per-event email | in daily digest |
  |---|---|---|---|
  | `instant` | iff `inAppEnabled` | iff `emailEnabled` | never |
  | `daily_digest` | iff `inAppEnabled` (bell stays live) | **never** (suppressed) | iff `emailEnabled` |
  | `off` | **never** | **never** | **never** ("off wins") |

  > **Reconciliation note (vs an earlier draft):** `off` is the **strongest** setting — it suppresses
  > **all** channels for that kind (in-app + email + digest), per spec.md FR-2 / scenario 4 / AC-2. It
  > is **not** an email-only mute. The S3 UI may render `emailEnabled=false` as "Off" for the *email*
  > column, but the cadence `off` value itself means "off everywhere for this kind".

- **Why an enum, not `weekly`/`quiet_hours`/a free interval?** The cahier's ask is *anti-fatigue*, and
  the aspirational `notification_preference.frequency instant/daily/weekly/never` in the repo
  `docs/spec/data-model.md` §15 maps cleanly onto three actionable choices. `weekly` is **already
  served** by the existing `weekly_digest` *kind* (E1-S4) — folding a weekly cadence into every kind
  would duplicate that machinery. So E5 ships **instant / daily_digest / off** and keeps the weekly
  parent summary as its own kind. (If a future slice wants `weekly` per-kind, the enum is additive.)
  `quiet_hours` is explicitly a **non-goal** (spec §Non-goals) — deferred.
- **No FK, no relation pair added.** It is a scalar enum column on an existing model — no new
  `onDelete`, no new join.
- **Index `@@index([tenantId, cadence, emailEnabled])`** keeps the daily-digest recipient resolver
  (`where: { tenantId, cadence: 'daily_digest', emailEnabled: true }`) tenant-first and cheap, mirroring
  the digest cron's existing `tenantsWithOptIns` pattern.

### 1.3 NO new model for grouping — the digest reuses `Notification` rows as the source

S2's **daily-digest worker** does **not** add a `notification_digest` / `digest_item` table. It groups
**already-persisted `Notification` rows** (the in-app feed is the durable record of what happened that
day) into one grouped email per `(user, day)`. This mirrors E1-S4 exactly:

- **Source of truth for "what to group":** `Notification` rows for the recipient in the day window
  whose `kind` has `cadence=daily_digest` for that user. (The in-app row already exists for every
  event the user is interested in — `createMany` writes it unless the user turned the *in-app* channel
  off. See §3.3 for the in-app-off edge case and its resolution.)
- **Idempotency marker (no new table):** a `Notification(kind=system, sourceType='daily_digest',
  sourceId=<deterministic day UUID>, readAt=now)` row is the per-`(user, day)` sent-marker — written
  only **after** a successful send, checked before send. Identical mechanism to E1-S4's
  `digestMarkerId` / `isoWeekKey`, generalised to a **day** key (`dailyDigestMarkerId(tenantId,
  userProfileId, dayKey)`). `readAt` pre-set so it never rings the bell. **`system` kind reused** (no
  new `NotificationKind` value): the marker is an internal bookkeeping row, never surfaced.

> **Ruling:** introducing a `notification_digest` table would be a *new persistence pattern* for
> something the `Notification` table already records. Reusing the in-app rows + a sent-marker is the
> documented E1-S4 convention → **no new model, no ADR.** (See plan.md §ADR-watch for the one decision
> that *could* trip an ADR and why it does not.)

---

## 2. S3 — prefs UI: **NO schema change**

S3 is a dedicated **parent/teacher notification-preferences surface** (channels + cadence + mute) on
the new pages `/parent/settings/notifications` and `/teacher/settings/notifications` (per spec FR-6 /
plan §1). All state it reads/writes already lives on `NotificationPreference` (incl. the S2 `cadence`
column). It calls the **existing** `GET /notifications/preferences` + `PATCH
/notifications/preferences/:kind` (extended in S2 to accept `cadence` — see contracts), plus reuses the
shared `PreferencesPanel` / `preferences-actions.ts` (the admin `/admin/settings` panel stays unchanged).
**Zero DB work.**

- New typed input: the PATCH body gains an optional `cadence` field (additive to the existing
  `inAppEnabled/emailEnabled/pushEnabled` DTO) — a **contract** change, not a schema change.
- No new permission: stays on `profile.read.self` / `profile.write.self` (a user edits their OWN
  preferences only — self-scoped by `ensureUser(jwt)`, never a `userProfileId` from the client).

---

## 3. Dispatcher gating logic (behavioural spec — no schema impact, S1 hardens / S2 extends)

The single coherent composition gate the three slices share. It spans **both** seams of the existing
`createMany`: (a) the in-app insert and (b) `dispatchEmails`. Pseudocode **after** S2, implementing the
§1.2 truth table (`off` is strongest — it suppresses every channel):

```
for each item (userProfileId, kind, …):
  pref = preference(userProfileId, kind)             // missing ⇒ defaults (instant, inApp on, email off)

  // (a) IN-APP insert seam (createMany):
  if pref.cadence == 'off':            skip in-app row    // off wins (NEW in S2)
  else if not pref.inAppEnabled:       skip in-app row    // existing disabledInAppKeys gate
  else if cadence == 'daily_digest' && not inAppEnabled:  // see §3.3 hidden-source-row resolution
       write in-app row readAt=now (digest source only)
  else:                                write in-app row   // today's path

  // (b) EMAIL seam (dispatchEmails):
  if not pref.emailEnabled:            skip email          // channel off → no email (unchanged)
  else switch pref.cadence:                                // NEW in S2
    case 'off':          skip email                        // off wins
    case 'instant':      enqueue notifications-email        // today's path (default)
    case 'daily_digest': skip per-event email; daily cron groups it
```

- **S1 hardening** touches only the existing `instant` email branch + the queue/processor: idempotency,
  retry/backoff posture, failure logging — **no new field, no behaviour change unless a defect is found.**
- **S2** adds the `cadence` switch on **both** seams above **and** the daily-digest cron that drains the
  `daily_digest`-marked events.
- **3.1 Recipient resolution for the daily cron** (mirrors `ParentDigestCronService.tenantsWithOptIns`):
  ```
  tenants  = NotificationPreference.distinct(tenantId) where cadence=daily_digest, emailEnabled=true
  per tenant: users = distinct userProfileId with ≥1 such pref
  per user:  kinds = the kinds that user set to daily_digest (+ emailEnabled)
             events = Notification rows (tenant, user, kind in kinds, createdAt in day window)
             if events.empty: skip
             if dayMarker(user, day) exists: skip   // idempotent
             render one grouped email (group BY kind), send, write marker
  ```
- **3.2 Send window** reuses the E1-S4 env pattern: `DIGEST_DAILY_SEND_HOUR` (default e.g. 18h UTC),
  hourly check tick, re-entrancy guard, best-effort per-user (one failure never aborts the loop). The
  daily cron is **structural parity** with `ParentDigestCronService` (a sibling module, not a fork of
  it).
- **3.3 In-app-off edge case (explicit).** A user could set `inAppEnabled=false` (no `Notification`
  row written) **and** `cadence=daily_digest` for the same kind — then the daily cron's source set is
  empty and they'd silently get nothing. **Resolution (chosen):** when a kind has
  `cadence=daily_digest`, `createMany` **still writes the in-app row** even if `inAppEnabled=false`,
  marking it `readAt=now` (a hidden "digest-source" row that never rings the bell) so the daily cron
  has a durable source. *Alternative considered:* keep a separate `notification_digest_item` table —
  **rejected** (new table for data the `Notification` row already holds). This edge case + its
  resolution is a P1 acceptance criterion (Critic pre-mortem; see plan.md). Implementer documents the
  final choice in the S2 story.

---

## 4. Index / RLS / tenancy checklist

- `NotificationPreference.cadence` inherits the model's existing `tenant_id` + RLS policy (same table —
  **no new RLS policy**). Every dispatcher/cron query is already `tenantId`-scoped (verified in
  `dispatchEmails`, `tenantsWithOptIns`, `runTenant`).
- New `@@index([tenantId, cadence, emailEnabled])` is tenant-first (ADR-002 convention) and keeps the
  daily recipient resolver from scanning the whole table.
- The daily-digest sent-marker rides the **existing** `Notification` table → its existing RLS +
  `@@index([userProfileId, readAt, createdAt])` / `@@index([tenantId, kind, createdAt])` already cover
  the marker lookup (`tenantId, userProfileId, kind=system, sourceType, sourceId`). No new index needed
  for the marker.
- No new table across the whole epic ⇒ no new RLS policy, no new tenant-scoping surface, except the one
  additive enum column.

## 5. Migration steps (per slice)

- **S1:** **no schema step.** Hardening of existing dispatcher + config docs + a parity test.
- **S2:** edit `schema.prisma` — add `enum NotificationCadence` + the `cadence` column +
  `@@index([tenantId, cadence, emailEnabled])` → `prisma generate` → `prisma db push`. Additive +
  `@default(instant)` ⇒ safe on existing rows, **no backfill** (existing rows resolve to `instant` =
  current behaviour). Add `cadence` to `packages/contracts` notification types + the worker's
  hand-mirrored `NotificationEmailJob`/preference types if surfaced there.
- **S3:** **no schema step.** Extends the existing PATCH DTO (`cadence?`) — a contract change only.

## 6. Contract surface (see `contracts/openapi.yaml`)

E5 adds **no new endpoint**. It extends two existing ones:
- `GET /notifications/preferences` → each `PreferenceDto` gains `cadence` (+ S3 reads it).
- `PATCH /notifications/preferences/:kind` → `UpdatePreferenceDto` gains optional `cadence`.

No new path, no new permission, no new queue, no new model relation. The full delta + reused-endpoint
context is in `contracts/openapi.yaml`.
