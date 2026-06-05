# E5 — PROGRESS

> **Epic:** E5 — Advanced Notifications (dispatcher + digest + prefs) · Tier 2 (R8) · ~M.
> **This run = epic-spec** (docs only — no code, no schema, no build/typecheck). The spec-kit is
> written; slices ship one PR per run from [`tasks.md`](./tasks.md).

| Slice | State | PR | Notes |
|---|---|---|---|
| **Spec-kit** | **written** (this run) | — | `spec.md` (John) · `data-model.md` + `plan.md` + `contracts/openapi.yaml` (Winston) · `ux.md` (Sally) · `tasks.md` · `quickstart.md` · `PROGRESS.md`. Docs-only; no schema/API/UI/worker code. |
| **S1 — Verify & harden the email dispatcher** | **shipped** | — | `[worker][test]` P2. New worker `notifications-email.processor.spec.ts` (the consumer had ZERO coverage) + extended API `notifications.service.spec.ts` producer edges (empty-recipient skip, null→`fr-FR` locale, `{attempts:3, backoff exponential 5000}` opts) + **one concrete hardening fix**: tenant-scoped `userProfile.findMany`/`emailEnabledKeys` on the API path (was id-only, asymmetric vs the worker cron sibling — ADR-002). **No new queue/template, NO schema.** |
| **S2 — Cross-kind daily digest & cadence** | **shipped** | — | `[schema][worker]` P1. Additive `enum NotificationCadence { instant daily_digest off }` + `cadence @default(instant)` + `@@index([tenantId, cadence, emailEnabled])` (`db push`, the **only** schema change). `NOTIFICATION_CADENCE` const+type in contracts. API: `cadence` on `PreferenceDto`/`UpdatePreferenceArgs` + validated `@IsIn(NOTIFICATION_CADENCE)` on the PATCH DTO + FR-2 gate via new `instantEmailKeys` (email seam) + `inAppPlan` (in-app seam: off→skip row, daily_digest+inApp-off+email-on→hidden `readAt=now` source row). NEW `apps/worker/.../notifications-digest/*` cron (mirror of `parent-digest/*`): 18h-UTC daily window, per-tenant→per-user, group day-window rows **by kind**, one composite branded email via `MailerService`, `(user, day)` sent-marker `Notification(kind=system, sourceType='daily_digest', readAt=now)`. **No new queue/table/template/kind/permission/endpoint/ADR.** Tests: extended `notifications.service.spec.ts` (truth table on both seams) + new worker `notifications-digest-cron.spec.ts` (11) + `daily-digest-email.template.spec.ts` (7) — 18 worker tests green locally. |
| **S3 — Parent/teacher prefs UI** | not started | — | `[web][a11y]` P2. Cadence selector + channels + mute on `/parent/settings` + `/teacher/settings`; **extend** the shared `PreferencesPanel`. **No schema/endpoint/permission.** |

## Spec-run decisions (autonomous — no AskUserQuestion)

1. **Scoped around the already-built dispatcher.** The 2026-06-05 audit confirms the email path is
   wired end-to-end (worker `notifications-email` processor + branded `renderNotificationEmail`
   template + `MailerService`/Maildev + per-kind `NotificationPreference` channel gating in
   `createMany`/`dispatchEmails`). The roadmap's "email **queue stub**" line is **stale** → **S1 is a
   verify/harden baseline, not a re-implementation.** Net-new ambition lives in S2 + S3.

2. **One coherent cadence model (the visionary spine).** S1–S3 unify under a single user-facing
   promise — a per-kind **notification cadence** (`instant` / `daily_digest` / `off`) — backed by
   **one additive `NotificationPreference.cadence` field**. The dispatcher, the digest worker, and the
   prefs UI all read that one field, not three disconnected toggles.

3. **`cadence` is orthogonal to `emailEnabled`, default `instant`.** Strictly additive + defaulted ⇒
   **zero behaviour change** for any existing row until a user opts into a digest/off. `cadence=off`
   is a reversible *soft mute* that preserves the channel boolean; the S3 UI collapses `cadence=off`
   and `emailEnabled=false` into one calm **Off** affordance while preserving the richer server state.

4. **Digest reuses the E1-S4 pattern, no new table/queue.** The daily cross-kind digest is a
   **structural sibling** of `ParentDigestCronService` (cron + send-window + re-entrancy guard +
   per-tenant/per-user loop), grouping **existing `Notification` rows** and idempotent per `(user,
   day)` via a `Notification(kind=system, sourceType='daily_digest', readAt=now)` sent-marker. The
   E1-S4 **weekly** digest stays its own `weekly_digest` kind, untouched.

5. **In-app-off + daily_digest edge (P1, Critic-flagged).** When a kind is on `daily_digest`,
   `createMany` still writes a hidden (`readAt=now`) in-app row even if `inAppEnabled=false`, so the
   daily cron has a durable source (a separate `digest_item` table was **rejected** — new persistence
   for data the `Notification` row already holds). The S2 implementer records the final choice in the
   S2 story. (See `data-model.md` §3.3.)

6. **No new ADR anticipated; one tripwire.** Every mechanism reuses a documented pattern. **If** S2 is
   pushed toward a **second BullMQ queue**, a **new digest table**, a **direct-SMTP-from-API** path, or
   **real-time/WebSocket** delivery, it must stop and land a `docs/adr/` ADR — and those are explicit
   **non-goals** (spec §Non-goals, `plan.md` §5).

7. **Push / SMS stay reserved stubs.** `pushEnabled` remains a "Bientôt" placeholder (no delivery);
   cadence applies to **in-app + email** only. A real push transport is a future epic (would need its
   own ADR).

## Open items for the slice runs (carry forward)

- **S3 mount point (defer to the S3 story):** `plan.md` proposes new `/parent/settings/notifications`
  + `/teacher/settings/notifications` sub-pages; `ux.md` proposes extending the existing **Notifications
  tab** on `/parent/settings` + `/teacher/settings`. **Both keep the shared `PreferencesPanel` + server
  actions and satisfy the AC.** The S3 implementer picks one (prefer the lower-churn option that reuses
  the existing tab + reassurance banner) and records it in the S3 story. Not a blocker for S1/S2.
- **Worker module name:** `plan.md` uses `apps/worker/src/modules/notifications-digest/*`; treat that
  as the authoritative path for the S2 cron (a sibling of `parent-digest/*`).
- **Contracts surface:** S2 adds `NotificationCadence` to `packages/contracts`; confirm whether the
  worker's hand-mirrored `NotificationEmailJob` needs it (the digest reads rows directly, so likely
  not — confirm in the S2 story).

## S1 run decisions (autonomous — no AskUserQuestion)

- **Net-new test value, not re-assertion.** The opt-in/off/dedup/enqueue-failure trio was already
  pinned in `notifications.service.spec.ts`; S1 adds only the un-pinned edges (empty-recipient skip
  with a co-batched valid recipient still served, null→`fr-FR` job locale, exact retry/backoff opts)
  plus a brand-new worker-consumer spec (`notifications-email.processor.spec.ts` — zero coverage
  before this run).
- **Consumer rethrow vs producer swallow (recorded in both specs).** The processor RE-THROWS on a
  `mailer.send` failure so BullMQ `attempts:3` exponential-5s backoff re-delivers; the API producer
  SWALLOWS enqueue failures so the in-app insert the caller depends on is never broken. The asymmetry
  is deliberate and documented.
- **FR-S1-4 fired (smallest additive fix).** The audit surfaced one concrete gap: the API
  `dispatchEmails` `userProfile.findMany` and `emailEnabledKeys` were **id-only**, not tenant-scoped,
  diverging from the worker cron sibling (`dispatchAlertEmails`) and ADR-002. Fixed minimally: derive
  the batch tenant (every fan-out batch is single-tenant) and pass it to both queries; pinned by a new
  assertion. Defence-in-depth (IDs already originate tenant-scoped from the producer) — not an
  exploited cross-tenant leak.
- **Template localisation stays an S2/out-of-scope non-goal.** The `locale` field is plumbed onto the
  job; `renderNotificationEmail` is FR-only by design — S1 asserts the field fallback only, it does NOT
  add locale-branching rendering.

## S2 run decisions (autonomous — no AskUserQuestion)

1. **Cleaner gate shape than the story's suggested `cadenceFor` Map.** Rather than fetch a cadence Map
   and post-filter on top of the legacy `disabledInAppKeys`/`emailEnabledKeys`, the dispatcher now
   drives two cadence-aware batch resolvers that fold the FR-2 truth table into a single query each:
   `instantEmailKeys(pairs, tenantId)` (email seam — `emailEnabled && cadence==='instant'`) and
   `inAppPlan(pairs, tenantId)` (in-app seam — returns `{skip, hiddenSource}`). Same byte-for-byte
   outcomes as the truth table; fewer passes; the legacy `disabledInAppKeys`/`emailEnabledKeys` stay on
   the service (untouched, still used elsewhere). Pure implementation-shape choice — no AC/§6 deviation.

2. **Hidden-source row gated on `emailEnabled` (matches data-model §3.3 exactly).** `inAppPlan` only
   emits a hidden `readAt=now` row when `cadence='daily_digest' && inAppEnabled=false && emailEnabled=true`.
   A `daily_digest`-without-email pair is **not** digest-eligible, so it falls through to a normal skip
   (no orphan hidden row). The cron's recipient resolver filters `emailEnabled=true` anyway, so the
   hidden row is always reachable.

3. **`off` = strongest (no in-app + no email + no digest)** — implemented in `inAppPlan` (off → `skip`)
   and `instantEmailKeys` (off excluded). Matches the contract/data-model reconciliation note.

4. **Marker reuses `kind=system`, no new kind.** `(user, day)` idempotency rides
   `Notification(kind=system, sourceType='daily_digest', sourceId=dailyDigestMarkerId(...), readAt=now)`,
   written only after a successful send (a crash leaves no marker → next tick retries). `daily-key.ts`
   generalises `iso-week.ts`'s `deterministicUuid` to a UTC-**day** key (self-contained copy, mirroring
   the parent-digest precedent of independent helper modules).

5. **Worker reads `Notification` rows directly — no contract/job-type change.** `NotificationEmailJob`
   is untouched; the cron groups existing in-app rows worker-side, so only `NOTIFICATION_CADENCE` (+type)
   is added to `packages/contracts` (the PATCH DTO + the future S3 UI consume it). Confirmed §8 of the story.

6. **Grouping/template.** `groupByKind` folds day-window rows into per-kind groups (count + up to 3 sample
   titles + freshest deep link / kind-level fallback), sorted by count desc then kind. `renderDailyDigestEmail`
   is a structural sibling of `renderDigestEmail` (branded, table-based, inline-styled, plain-text fallback,
   per-kind pill = emoji+text+colour so it is never colour-alone — WCAG 1.4.1). Sky-blue accent distinguishes
   the daily digest from the weekly digest's violet.

7. **Schema applied in-tree; `prisma generate` + `db push` are orchestrator pre-merge steps** (agents never
   build). The API spec references `NotificationCadence` via `@prisma/client`, so it runs green only after
   generate (Murat's gate). The worker specs need only `NotificationKind` (already generated) → green now (18/18).

## Next action

S2 shipped. Run **E5-S3** (`epic-slice`, `[web][a11y]`): the dedicated parent/teacher
notification-preferences UI — per-kind **cadence selector** (Instant / Résumé quotidien / Off) + channel
switches + mute on `/parent/settings` + `/teacher/settings`, **extending** the shared `PreferencesPanel`
(cadence-aware), reusing the existing self-scoped `GET/PATCH /notifications/preferences` (now returning +
accepting `cadence`). No schema/endpoint/permission.
