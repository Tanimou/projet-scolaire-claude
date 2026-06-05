# E5-S2 — Cross-kind daily digest & cadence

> **Self-contained story spec.** A developer implements this slice from THIS file
> alone — no other context required. Mode: `epic-slice`. Epic: **E5 — Advanced
> Notifications**. Slice **S2** of S1→S3. `[schema][worker]` · **P1** · ~M.
> **touchesUi: false · touchesBackend: true · touchesWorker: true.**
>
> **Reuse-first.** This slice adds **one** additive schema field, wires a cadence
> gate into the **existing** email dispatcher, exposes `cadence` on the existing
> prefs DTOs/contracts, and adds **one new worker cron module** that is a
> *structural mirror* of `apps/worker/src/modules/parent-digest/*`. **NO new BullMQ
> queue. NO new table. NO new per-event email template. NO new NotificationKind. NO
> new permission. NO new endpoint. NO ADR.** If you are tempted toward a second
> queue / a `digest_item` table / direct-SMTP-from-API / WebSocket — STOP: those are
> explicit non-goals and would require an ADR (see `plan.md` §5).

---

## 1. Context — what already exists (ground truth; read before coding)

The instant-email path is **already wired end-to-end** (verified + hardened in S1).
S2 plugs a cadence gate into it and adds a daily grouping cron.

- **Schema (ALREADY APPLIED in this worktree — verify, do not re-add):**
  `apps/api/prisma/schema.prisma` already contains, at ~L1209–1249:
  - `enum NotificationCadence { instant daily_digest off }`
  - `model NotificationPreference { … cadence NotificationCadence @default(instant) @map("cadence") … }`
  - `@@index([tenantId, cadence, emailEnabled])`

  The schema edit is **done** but `prisma generate` + `prisma db push` must be run by
  the orchestrator (agents never build). Everything **downstream** of the schema is
  NOT done yet: contracts, API DTO/service gate, and the worker cron. **That is the
  work of this slice.**

- **Producer (API):** `NotificationsService.createMany(...)` →
  private `dispatchEmails(...)` in
  `apps/api/src/modules/notifications/notifications.service.ts`. `createMany`
  source-dedups, applies the in-app gate via `preferences.disabledInAppKeys(...)`,
  inserts in-app rows, then calls `dispatchEmails(deduped)` (best-effort, swallows
  failures). `dispatchEmails` resolves the tenant from `items[0].tenantId`, asks
  `preferences.emailEnabledKeys(pairs, tenantId)` for opted-in keys, loads
  `userProfile` rows, and `emailQueue.addBulk(jobs)` with
  `{ attempts: 3, backoff: { type:'exponential', delay:5_000 }, removeOnComplete, removeOnFail }`.

- **Preferences service:** `NotificationPreferencesService` in
  `apps/api/src/modules/notifications/preferences.service.ts` —
  `NOTIFICATION_KINDS`, `NOTIFICATION_KIND_LABEL`, `NOTIFICATION_KIND_DESCRIPTION`,
  `PreferenceDto`, `UpdatePreferenceArgs`, `listForUser`, `update`,
  `disabledInAppKeys`, `emailEnabledKeys`, `isEnabled`. Missing row ⇒ defaults
  (in-app on, email off, push off → now also **cadence instant**).

- **Prefs controller / DTO:** `apps/api/src/modules/notifications/preferences.controller.ts`
  — `UpdatePreferenceDto { inAppEnabled? emailEnabled? pushEnabled? }`,
  `GET /notifications/preferences` (`profile.read.self`),
  `PATCH /notifications/preferences/:kind` (`profile.write.self`). Identity is the
  caller's own (`users.ensureUser(jwt)` → `me.id` / `me.tenantId`); a `userProfileId`
  is **never** read from the request.

- **Weekly digest cron precedent (MIRROR THIS EXACTLY):**
  `apps/worker/src/modules/parent-digest/*` —
  `ParentDigestCronService` (`OnApplicationBootstrap` + `setInterval`,
  `CHECK_INTERVAL_MS`/`STARTUP_DELAY_MS`/`SEND_DOW`/`SEND_HOUR` env, `inSendWindow`,
  re-entrancy `running` guard, `tenantsWithOptIns` → per-tenant `runTenant` →
  per-user loop, idempotent `(user, week)` sent-marker via
  `Notification(kind=weekly_digest, sourceType=weekly_digest, sourceId=<deterministic UUID>, readAt=now)`),
  `iso-week.ts` (`deterministicUuid`, `digestMarkerId`, FR date helpers),
  `digest-email.template.ts` (`renderDigestEmail` — branded, table-based, inline-styled,
  plain-text fallback), `parent-digest.module.ts` (imports `MailModule`; Prisma is global),
  and `parent-digest-cron.spec.ts` (the test harness pattern to copy).
  **Worker app wiring:** `apps/worker/src/app.module.ts` imports `ParentDigestModule`.

- **Mailer:** `apps/worker/src/shared/mail/mailer.service.ts` (`MailerService.send({ to, subject, html, text })`),
  from `apps/worker/src/shared/mail/mail.module.ts` (`MailModule`).

- **Both API and worker share ONE Prisma client** generated from
  `apps/api/prisma/schema.prisma` (worker has no own prisma dir; it imports
  `@prisma/client`). After `prisma generate`, `NotificationCadence` + the `cadence`
  field are available to the worker too.

- **Contracts:** `packages/contracts/src/enums/index.ts` has
  `NOTIFICATION_CHANNEL` and an aspirational `NOTIFICATION_FREQUENCY = ['instant','daily','weekly','never']`
  but **no `NOTIFICATION_CADENCE`** and **no `NOTIFICATION_KIND`**. Notification
  enums are NOT currently mirrored in contracts (the API uses `@prisma/client` types).

---

## 2. Goal (one sentence)

Ship the per-kind email **cadence** end-to-end: expose the (already-in-schema)
`cadence` field on the prefs DTOs + `packages/contracts`, wire the FR-2 cadence gate
into `createMany`/`dispatchEmails` (off → suppress all email; daily_digest →
suppress the per-event email + keep a durable in-app source row; instant → today's
path unchanged), and add a `notifications-digest` worker cron (structural mirror of
`parent-digest/*`) that groups each opted-in user's day-window `daily_digest`
notifications **by kind** into one composite branded email per `(user, day)`,
idempotent via a sent-marker `Notification` row — **no new queue/table/template**.

Default `cadence = instant` ⇒ **zero behaviour change** until a user opts in.

---

## 3. The cadence truth table (FR-2 — implement exactly)

For one event of kind *k* to user *u*, with `pref` (missing ⇒ `{ inAppEnabled:true, emailEnabled:false, cadence:instant }`):

| cadence | in-app row written? | per-event email enqueued? | bundled into daily digest? |
|---|---|---|---|
| `instant` | iff `inAppEnabled` | iff `emailEnabled` | never |
| `daily_digest` | iff `inAppEnabled` **OR** `emailEnabled` (see §6.3 edge: write hidden `readAt=now` source row when `inAppEnabled=false` but `emailEnabled=true`) | **never** (suppressed) | iff `emailEnabled` |
| `off` | **never** (off wins over `inAppEnabled`) | **never** | **never** |

**Authoritative reconciliation:** `off` is the **strongest** value — it suppresses
**every** channel for that kind (in-app + email + digest). It is NOT an email-only
mute. (Matches `spec.md` FR-2 / scenario 4 / AC-2 and `data-model.md` §1.2.)

---

## 4. Files to change / add

### Backend (API) — `apps/api/`

1. **`prisma/schema.prisma`** — **already edited** (enum + field + index present).
   No further schema edit; the orchestrator runs `prisma generate` + `prisma db push`.

2. **`src/modules/notifications/preferences.service.ts`**
   - Add `cadence: NotificationCadence` to `PreferenceDto`.
   - Add `cadence?: NotificationCadence` to `UpdatePreferenceArgs`.
   - In `listForUser`: return `cadence: r?.cadence ?? 'instant'`.
   - In `update`: merge `cadence: args.patch.cadence ?? existing?.cadence ?? 'instant'`
     into the `create`/`update` payload and the returned DTO.
   - Add a batch helper for the gate (mirror `emailEnabledKeys`):
     ```ts
     /** Returns a Map `${userProfileId}|${kind}` → cadence (only for rows that
      *  exist; callers default the absent keys to 'instant'). One query, tenant-scoped. */
     async cadenceFor(
       pairs: ReadonlyArray<{ userProfileId: string; kind: NotificationKind }>,
       tenantId?: string,
     ): Promise<Map<string, NotificationCadence>>
     ```
     (Query `notificationPreference.findMany` over the deduped pairs, `select { userProfileId, kind, cadence }`,
     tenant-scoped when `tenantId` passed — same shape as `emailEnabledKeys`.)

3. **`src/modules/notifications/notifications.service.ts`**
   - **In-app seam (`createMany`):** after the existing `disabledInAppKeys` filter,
     fold in cadence so the §3 in-app column is honoured. Concretely, fetch the
     batch cadence (`preferences.cadenceFor(pairs, tenantId)`; the batch is
     single-tenant — `items[0].tenantId`) and adjust `toInsert`:
     - `cadence === 'off'` → **drop** the in-app row (off wins, even if `inAppEnabled`).
     - `cadence === 'daily_digest'` **and** in-app was dropped by `disabledInAppKeys`
       (i.e. `inAppEnabled=false`) **and** that pair is email-opted-in → **re-add** the
       row but force `readAt: new Date()` so it is a hidden digest-source row (never
       rings the bell). See §6.3 — this is the only exception to "in-app per `inAppEnabled`".
     - else → unchanged.
     Keep the change surgical and well-commented; do NOT regress the existing
     dedup/in-app logic. Existing rows (cadence `instant`) take the unchanged path.
   - **Email seam (`dispatchEmails`):** after the `emailEnabledKeys` gate produces
     `toEmail`, fetch cadence for those pairs and **partition**:
     - `cadence === 'off'` → skip (no per-event email).
     - `cadence === 'daily_digest'` → skip the per-event email (the cron sends it).
     - `cadence === 'instant'` (or missing) → enqueue exactly as today (byte-for-byte
       the current job shape + opts; do NOT touch the job payload or opts).
   - Both seams must default a missing cadence key to `'instant'`.

4. **`src/modules/notifications/preferences.controller.ts`**
   - `UpdatePreferenceDto` gains `@IsOptional() @IsEnum(...) cadence?: NotificationCadence`.
     Validate against the enum — accept only `instant | daily_digest | off`. Import the
     enum from `@prisma/client` (or validate against the contracts const array with
     `@IsIn(NOTIFICATION_CADENCE)`). A rejected value → 400 (class-validator default).

5. **`src/modules/notifications/notifications.service.spec.ts`** — extend (do NOT
   rewrite) to pin the §3 truth table on **both** seams (see §7 Tests).

### Contracts — `packages/contracts/`

6. **`src/enums/index.ts`** — add, next to `NOTIFICATION_FREQUENCY`:
   ```ts
   export const NOTIFICATION_CADENCE = ['instant', 'daily_digest', 'off'] as const;
   export type NotificationCadence = (typeof NOTIFICATION_CADENCE)[number];
   ```
   (Mirrors the existing `as const` + indexed-type convention. This is the additive
   contract surface the S3 UI + the PATCH DTO consume.) **Do not** rename or remove
   the existing `NOTIFICATION_FREQUENCY`/`NOTIFICATION_CHANNEL` consts. The worker
   reads `Notification` rows directly so it needs no contract type (confirm in §8).

### Worker — `apps/worker/src/modules/notifications-digest/` (NEW module)

7. **`daily-key.ts`** — pure helpers (mirror `parent-digest/iso-week.ts`):
   - `dayKey(now: Date): string` → `"YYYY-MM-DD"` in **UTC**.
   - `deterministicUuid(seed)` — copy from `iso-week.ts` (or import it; copying keeps
     the modules independent, matching the parent-digest precedent of self-contained helpers).
   - `dailyDigestMarkerId({ tenantId, userProfileId, dayKey })` →
     `deterministicUuid(`daily_digest|${tenantId}|${userProfileId}|${dayKey}`)`.
   - `dayWindowUtc(now)` → `{ start, end }` = `[00:00:00.000Z, next 00:00:00.000Z)` of `now`'s UTC day.
   - `frDayLabel(now)` → e.g. `"5 juin 2026"` (reuse the FR month array).

8. **`digest-group.types.ts`** — worker-local payload types (mirror
   `parent-digest/digest-email.types.ts`; **no contract type** — see §8):
   ```ts
   export interface DigestKindGroup {
     kind: NotificationKind;        // from @prisma/client
     label: string;                 // FR display label for the kind
     count: number;                 // number of notifications of this kind in the window
     items: { title: string; link: string | null; severity: NotificationSeverity }[]; // up to N (e.g. 5) for preview
   }
   export interface DailyDigestRenderInput {
     recipientName: string;
     dayLabel: string;              // "5 juin 2026"
     groups: DigestKindGroup[];     // grouped BY kind, in NOTIFICATION_KINDS order
     totalCount: number;
   }
   ```

9. **`digest-email.template.ts`** — `renderDailyDigest(input, { webBaseUrl }):
   { subject, html, text }`. Branded, table-based, inline-styled, plain-text fallback
   — **structurally a sibling of** `parent-digest/digest-email.template.ts` (reuse the
   `esc`, `absoluteLink` helper shapes). Requirements:
   - Subject groups the counts, e.g. `"📬 Votre résumé du jour — 3 notes · 1 annonce"`
     (singular/plural aware; total in the header).
   - One section per kind group: kind label + count, then up to ~5 item rows
     (`title` + a single deep link per item via `absoluteLink(webBaseUrl, item.link)`,
     `link` may be null → no anchor). **Severity shown with icon+text, never colour
     alone** (a11y AC). **`IMPROVEMENT`/success items get a kind, celebratory emerald
     accent** (positive, non-stigmatising) — but never compare a child by name to peers.
   - A footer "Vous recevez ce résumé quotidien car certaines notifications sont
     réglées sur « Résumé quotidien ». Gérez vos préférences dans Réglages ›
     Notifications" with a settings link.
   - Pure + deterministic (unit-testable without SMTP).

10. **`digest-cron.service.ts`** — `NotificationsDigestCronService`, a **structural
    mirror** of `ParentDigestCronService`:
    - `OnApplicationBootstrap` + `setInterval`; env:
      `DIGEST_DAILY_CHECK_INTERVAL_MS` (default `60*60*1000`),
      `DIGEST_DAILY_STARTUP_DELAY_MS` (default `50_000` — stagger AFTER the weekly
      cron's `45_000` so the two don't fire the first tick together),
      `DIGEST_DAILY_SEND_HOUR` (default `18`, UTC). Send window = `now.getUTCHours() === SEND_HOUR`
      (daily — no DOW gate, unlike the weekly cron).
    - `running` re-entrancy guard; `tick(now = new Date())` returns early outside the window.
    - `tenantsWithOptIns()`: `notificationPreference.findMany({ where: { cadence: 'daily_digest', emailEnabled: true }, select: { tenantId:true }, distinct:['tenantId'] })`.
    - `runTenant({ tenantId, now })`:
      1. `const { start, end } = dayWindowUtc(now)`.
      2. Load opted-in prefs for the tenant:
         `findMany({ where:{ tenantId, cadence:'daily_digest', emailEnabled:true },
          select:{ userProfileId, kind, userProfile:{ select:{ id, email, firstName, lastName } } } })`.
      3. Group prefs **per user** → `{ profile, kinds: NotificationKind[] }`.
      4. Per user (best-effort, one failure never aborts the tenant loop):
         - skip if `!profile.email`.
         - idempotency: `markerId = dailyDigestMarkerId({ tenantId, userProfileId: profile.id, dayKey: dayKey(now) })`;
           `notification.findFirst({ where:{ tenantId, userProfileId: profile.id, kind:'system', sourceType:'daily_digest', sourceId: markerId }, select:{ id:true } })` → if present, skip.
         - gather source rows:
           `notification.findMany({ where:{ tenantId, userProfileId: profile.id,
             kind:{ in: kinds }, createdAt:{ gte:start, lt:end },
             sourceType:{ not:'daily_digest' } },  // never include the marker itself
             select:{ kind, title, link, severity }, orderBy:{ createdAt:'desc' } })`.
           **If empty → skip (write NO marker, send NOTHING).**
         - group by kind (in `NOTIFICATION_KINDS` order), build `DailyDigestRenderInput`,
           `renderDailyDigest(...)`, `mailer.send(...)`.
         - **only after a successful send**, write the marker:
           `notification.create({ data:{ tenantId, userProfileId: profile.id, kind:'system',
             severity:'info', title:`Résumé quotidien — ${frDayLabel(now)}`, body:null,
             link:'/parent/dashboard', sourceType:'daily_digest', sourceId: markerId, readAt: now } })`.
      5. Return `{ sent, skipped }`.
    - Logging parity with the weekly cron (`logger.log`/`warn`/`error`, tick summary).

11. **`notifications-digest.module.ts`** — `imports:[MailModule]`,
    `providers:[NotificationsDigestCronService]` (Prisma is global). Mirror
    `parent-digest.module.ts`.

12. **`digest-cron.spec.ts`** — copy the `parent-digest-cron.spec.ts` harness shape;
    cover the cases in §7.

13. **`apps/worker/src/app.module.ts`** — add `NotificationsDigestModule` to `imports`
    (next to `ParentDigestModule`).

### Worker email-job types — **NO change** (confirmed §8).

---

## 5. The kind label map (reuse, don't re-derive)

The worker has no access to the API's `NOTIFICATION_KIND_LABEL`. Define a small
FR label map in `digest-email.template.ts` (or `digest-group.types.ts`) **identical
in spirit** to `preferences.service.ts`'s map (e.g. `grade_published → 'Notes publiées'`,
`announcement → 'Annonces'`, `alert → 'Alertes'`, `message → 'Messagerie'`,
`lesson_published → 'Cahier de texte'`, `enrollment_status → 'Inscriptions'`,
`system → 'Système'`). Exclude `weekly_digest` from the digest (it is its own
email-only summary kind and is never set to a per-event cadence in practice; if it
appears in `kinds`, skip it — the daily digest groups **per-event** kinds only,
per `spec.md` FR-5).

---

## 6. Critical decisions (record-of-shape; do not deviate without an ADR)

1. **No new queue/table/template/kind/permission/endpoint/ADR.** The digest reuses
   `MailerService`, groups existing `Notification` rows, and marks idempotency with a
   `Notification(kind=system, sourceType='daily_digest', readAt=now)` row — exactly the
   E1-S4 pattern, generalised from ISO-week to UTC-day. (`spec.md` AC-3/AC-7, `plan.md` §5.)

2. **`cadence` default `instant` ⇒ zero behaviour change.** Every existing row and
   every missing row resolves to `instant`; both seams treat a missing cadence key as
   `instant`. The weekly digest (`parent-digest/*`) is **untouched**.

3. **In-app-off + daily_digest edge (P1, Critic-flagged) — RESOLVED as the hidden
   source row.** When a kind is `daily_digest` and `emailEnabled=true` but
   `inAppEnabled=false`, `createMany` **still writes** the in-app row with
   `readAt=now` (hidden — never rings the bell) so the daily cron has a durable
   source. A separate `digest_item` table was **rejected** (new persistence for data
   the `Notification` row already holds). This is the **only** exception to FR-2's
   "in-app per `inAppEnabled`". (`data-model.md` §3.3.) If `daily_digest` but
   `emailEnabled=false`: nothing is digest-eligible, so behave per `inAppEnabled`
   normally (no hidden row needed).

4. **`off` is strongest** (suppresses in-app + email + digest). The S3 UI may later
   render `emailEnabled=false` as "Off" for the email column, but the cadence value
   `off` means off-everywhere for that kind. (`data-model.md` §1.2.)

5. **Send window = hourly check, daily 18h UTC** (env `DIGEST_DAILY_SEND_HOUR`).
   No DOW gate. Stagger the startup delay after the weekly cron.

6. **Digest groups only `daily_digest`-cadence kinds.** Instant kinds are never in
   the digest set (cadence is the partition key) — so a user never gets both an
   instant email and a digest line for the same event.

---

## 7. Tests (Murat-picked; the gate runs `pnpm typecheck` once)

**API — extend `notifications.service.spec.ts`** (pin the §3 truth table on both seams):
- `cadence=instant` (or no pref) + `emailEnabled=true` → exactly one `notifications-email`
  job (byte-for-byte today's path) **and** the in-app row is written.
- `cadence=daily_digest` + `emailEnabled=true` → **zero** email jobs; the in-app row IS
  written (digest source).
- `cadence=daily_digest` + `emailEnabled=true` + `inAppEnabled=false` → **zero** email
  jobs **and** a hidden in-app row written with `readAt` set (§6.3 edge).
- `cadence=off` → **zero** email jobs **and** **no** in-app row (off wins).
- `emailEnabled=false` (any cadence) → zero email jobs (channel off; unchanged).
- A co-batched `instant` recipient still gets their email when another recipient is `off`/`digest`.

**Worker — `digest-cron.spec.ts`** (copy the `parent-digest-cron.spec.ts` harness):
- sends one grouped email in the window + writes a `kind=system, sourceType='daily_digest', readAt=now`
  marker with `sourceId === dailyDigestMarkerId(...)`.
- groups by kind: a user with 3 `grade_published` + 1 `announcement` in-window →
  one email, two groups, correct counts.
- empty source set → **no send, no marker**.
- idempotency: running twice the same UTC day → one send (marker present second time);
  a pre-existing marker → zero sends.
- outside the send hour → no send.
- no-email profile → skipped, never crashes.
- a send failure does NOT write the marker (next tick retries).
- re-entrancy guard: an in-flight tick makes a concurrent tick a no-op.

**Template — `digest-email.template.spec.ts`** (mirror the parent-digest template spec):
- deterministic subject with grouped counts; one section per kind; deep links absolutised;
  null-link item renders without an anchor; severity shown with icon+text (not colour alone);
  plain-text fallback present.

---

## 8. Open items resolved for this slice

- **Worker `NotificationEmailJob` needs NO `cadence`.** The cron reads `Notification`
  rows directly (it does not flow through the per-event email job), so the worker's
  hand-mirrored `notification-email.types.ts` is **unchanged**. (`PROGRESS.md` "Contracts surface" item.)
- **Worker module path is authoritative:** `apps/worker/src/modules/notifications-digest/*`
  (sibling of `parent-digest/*`), per `plan.md` §1.
- **Contracts:** only `NOTIFICATION_CADENCE` (+ type) is added; no `NOTIFICATION_KIND`
  mirror is introduced (out of scope; the API keeps `@prisma/client` types).

---

## 9. Acceptance criteria (this slice)

- **AC-S2-1 (schema, additive).** `NotificationPreference.cadence`
  (`instant | daily_digest | off`, default `instant`) + the enum + `@@index([tenantId,
  cadence, emailEnabled])` exist via `db push` (already in `schema.prisma`); existing
  rows resolve to `instant` with **no backfill** and **no behaviour change**.
- **AC-S2-2 (cadence truth table, unit-pinned).** `createMany`/`dispatchEmails` honour
  §3 on **both** seams: `off` → no in-app + no email + no digest; `daily_digest` → in-app
  per the §6.3 rule + no per-event email + digest-eligible; `instant` → byte-for-byte
  today's path; `emailEnabled=false` → no email. A co-batched `instant` recipient is
  unaffected by another's `off`/`digest`.
- **AC-S2-3 (digest groups & is idempotent).** The `notifications-digest` cron sends
  **one** grouped-by-kind email per eligible user per UTC day, with counts + one deep
  link per item; re-running the same day sends **nothing** (`(user, day)` marker);
  empty set → nothing; a per-user failure never aborts the tenant loop; tenant-scoped
  throughout. **No new queue, no new table, no new per-event template.**
- **AC-S2-4 (contracts).** `NOTIFICATION_CADENCE` const + type added to
  `packages/contracts/src/enums/index.ts`; existing consts untouched.
- **AC-S2-5 (DTO).** `GET /notifications/preferences` returns `cadence` per kind;
  `PATCH /notifications/preferences/:kind` accepts an optional validated `cadence`;
  an invalid value → 400. Stays on `profile.read.self` / `profile.write.self`,
  caller's own rows only (no `userProfileId` from the request).
- **AC-S2-6 (RGPD / tone / tenancy).** Every query tenant-scoped (RLS); the digest
  carries minimal child data (kind + count + title/link already in the `Notification`
  row — no extra grade values); copy is factual, kind, non-stigmatising French; the
  digest send writes its sent-marker (the established idempotency record), no new audit table.
- **AC-S2-7 (no new architectural decision).** Reuses the producer/consumer email
  pattern, the cron + composite-email digest pattern, `NotificationPreference`, and
  `@pilotage/ui`-agnostic worker rendering. The only schema change is the additive
  `cadence` enum/field. No ADR.

## 10. Out of scope

- The prefs UI cadence control (**S3**), push/SMS, per-user time-zones / quiet-hours /
  custom send windows, any rewrite of the weekly parent digest or the per-event email
  template, any second BullMQ queue or new table.
