# E5 — Technical plan (Architect: Winston)

> How E5 is built **inside the existing conventions** (project-context §2–3). Companion to
> [`spec.md`](./spec.md), [`data-model.md`](./data-model.md),
> [`contracts/openapi.yaml`](./contracts/openapi.yaml). Hard rule: a **new architectural
> decision ⇒ a new `docs/adr/` ADR** (Winston gate). E5 is anticipated to need **no** new
> ADR — it reuses four already-shipped patterns; the one risk is flagged in §5.

## 0. What already exists (verified in the current tree — DO NOT re-implement)

| Capability | Where | E5 stance |
|---|---|---|
| **End-to-end email dispatcher** | `apps/worker/src/modules/notifications-email/{notifications-email.processor.ts, notification-email.template.ts, notification-email.types.ts}` | **reuse as the substrate** (S1 verifies/hardens it) |
| Email queue (producer→consumer) | `QUEUE_NOTIFICATIONS_EMAIL` (`apps/api/.../shared/queue/queue.module.ts`); producer `NotificationsService.dispatchEmails` (`apps/api/.../notifications/notifications.service.ts`) | reuse — **no new queue** |
| Branded per-event template | `renderNotificationEmail` (worker) | reuse — **no new per-event template** |
| Mailer / Maildev | `apps/worker/src/shared/mail/mailer.service.ts` | reuse for digest + per-event |
| Per-kind channel gate | `NotificationPreferencesService.{disabledInAppKeys, emailEnabledKeys}` + `NotificationPreference(inApp/email/push Enabled)` | **extend additively** with `cadence` |
| Self-scoped prefs API | `GET /notifications/preferences`, `PATCH /notifications/preferences/:kind` (`profile.{read,write}.self`) | reuse — extend DTO with `cadence` |
| Admin prefs UI | `apps/web/src/app/admin/settings/PreferencesPanel.tsx` | **leave unchanged**; parent/teacher get their own pages |
| **Digest cron precedent** | `apps/worker/src/modules/parent-digest/*` (E1-S4 weekly digest: cron + composite-email + `Notification` sent-marker idempotency, no new queue/table) | **mirror this exact pattern** for the daily cross-kind digest |

**Key grounding facts (verified in code):**
- The dispatcher is **already wired end-to-end**: `dispatchEmails` enqueues
  `notifications-email` jobs (attempts: 3, exponential backoff) gated on
  `emailEnabledKeys`; the worker processor renders the branded template and sends via
  `MailerService`. The roadmap's "email **queue stub**" line is **stale** — S1 is a
  *verify/harden*, not a build.
- `createMany` already (a) source-dedups by `(userProfileId, sourceType, sourceId)`, (b)
  drops in-app rows for `inAppEnabled=false`, and (c) calls `dispatchEmails` on the full
  deduped set INDEPENDENTLY of the in-app gate. **`dispatchEmails` is the exact seam where
  FR-2 email cadence plugs in** (S2): after the `emailEnabledKeys` gate, branch on
  `cadence` (`off` → skip; `daily_digest` → skip the instant enqueue; `instant` → enqueue
  as today). Cadence governs the **email** branch only — the in-app gate (b) is unchanged
  except the FR-4 digest-source edge case.
- The weekly-digest cron (`ParentDigestCronService`) already proves: a plain `setInterval`
  cron with a day/hour send window, per-tenant resolution of `NotificationPreference`
  opt-ins, per-guardian composite email, and `(user, period)` idempotency via a
  `Notification(kind=…, readAt set)` sent-marker — **no new queue, no new table.** The
  daily digest is structurally the same with a different grouping payload.
- `NotificationKind` is an additive enum (`announcement, alert, grade_published,
  enrollment_status, lesson_published, system, message, weekly_digest`). **No new kind is
  needed** for E5 — cadence is a property of the existing kinds.

## 1. Where the code lives (grounded in the current tree)

| Concern | Path | E5 touch |
|---|---|---|
| `NotificationPreference` model | `apps/api/prisma/schema.prisma` (~L1212) | **S2:** additive `cadence` enum + field (+ enum `NotificationCadence`) |
| Channel gate + DTO | `apps/api/src/modules/notifications/preferences.service.ts` | S2: read/return `cadence`; add `digestEligibleKeys` helper; S3 labels |
| Prefs controller/DTO | `apps/api/src/modules/notifications/preferences.controller.ts` | S2: accept `cadence` in `UpdatePreferenceDto` (validated enum) |
| Fan-out composition | `apps/api/src/modules/notifications/notifications.service.ts` (`createMany`, `dispatchEmails`) | S2: apply FR-2 (off / daily_digest / instant) before in-app insert + email enqueue |
| Shared enums/types | `packages/contracts/src/enums/index.ts` | S2: add `NOTIFICATION_CADENCE` const + type (mirrors `NotificationKind` style) |
| Email dispatcher (verify) | `apps/worker/src/modules/notifications-email/*` | **S1:** targeted test + harden only; no behaviour change unless a defect is found |
| Daily-digest cron (new) | `apps/worker/src/modules/notifications-digest/*` (NEW module, mirrors `parent-digest/*`) | **S2:** cron + grouping aggregate + composite template + sent-marker |
| Parent prefs page (new) | `apps/web/src/app/parent/settings/notifications/*` | **S3** |
| Teacher prefs page (new) | `apps/web/src/app/teacher/settings/notifications/*` | **S3** |
| Reusable prefs panel | `apps/web/src/app/admin/settings/PreferencesPanel.tsx` (+ `preferences-actions.ts`) | S3: extract/reuse the cadence-aware row component; **admin page unchanged in behaviour** |

## 2. Slice → layer matrix

| Slice | DB | API | Worker | Web | Risk tag |
|---|---|---|---|---|---|
| **S1** verify/harden dispatcher | none | (verify gate); fix only if a defect found | targeted test + harden `notifications-email` | none | `[worker]` (low) |
| **S2** cadence + daily digest | additive `cadence` enum + field + `@@index([tenantId, cadence, emailEnabled])` | `cadence` in DTO/gate + FR-2 email composition + digest recipient resolver | NEW `notifications-digest` cron (mirror parent-digest) | none | `[schema][worker]` P1 |
| **S3** parent/teacher prefs UI | none | (reuse extended endpoints) | none | parent + teacher `/settings/notifications` pages | `[web][a11y]` |

## 3. Cross-cutting conventions honored

- **Multi-tenant + RLS (ADR-002):** the `cadence` field is on the already-tenant-scoped
  `NotificationPreference`; the digest cron resolves recipients per-tenant
  (`where: { tenantId, … }`), exactly like the weekly digest. No new tenant surface.
- **RBAC/ABAC (ADR-015):** prefs read/write stay **`profile.read.self` / `profile.write.self`**
  — a user only ever touches their own rows (the controller derives `userProfileId` from
  the JWT via `UserSyncService.ensureUser`, never from input). The digest only emails a
  user about **their own** in-tenant notifications. No new permission is introduced.
- **Append-only audit:** preference writes follow the **existing** notifications-module
  convention (the module does not currently write a dedicated audit row per toggle; E5 does
  not regress or newly require one — if a reviewer wants one, it is the standard inline
  `prisma.auditLog.create`, additive). The digest send writes its `Notification`
  sent-marker (the established idempotency record), not a new audit table.
- **Aggregate endpoints / no client N+1:** the prefs pages read the single
  `GET /notifications/preferences` aggregate (full kind list, defaults merged) — one fetch,
  no per-kind round-trip. Each toggle/cadence change is a single `PATCH`.
- **Reuse `@pilotage/ui`:** the cadence selector is a radio-group / segmented control built
  from existing primitives; the row layout reuses the admin `PreferencesPanel` structure.
  A new shared component lands **only** if it raises consistency (DS Guardian call).
- **Digest pattern parity:** the new `notifications-digest` cron is a **structural mirror**
  of `ParentDigestCronService` (same `setInterval` + send-window + re-entrancy guard +
  per-tenant loop + `(user, day)` sent-marker idempotency) — a reviewer diffs the pair.

## 4. Risks & mitigations (feeds Critic / Murat)

| Risk | Mitigation |
|---|---|
| **Cadence composition regression** silently changes today's instant behaviour | FR-2 is a 3×channel truth table pinned by a unit test; `cadence` defaults to `instant`, so every existing row is byte-for-byte unchanged until a user opts in (AC-8/FR-8). |
| **Double delivery** — per-event email AND digest for the same event | `daily_digest` cadence **suppresses the per-event email** at `dispatchEmails`; the digest only gathers events with no per-event email sent. The digest's `(user, day)` sent-marker prevents a second digest the same day. |
| **Digest emails an event the user already saw instantly** | the digest gathers only `daily_digest`-cadence kinds; instant kinds are never in the digest set (cadence is the partition key). |
| Digest cron double-send on overlapping ticks | re-entrancy `running` guard + `(user, day)` sent-marker written only **after** a successful send (mirrors weekly digest) → a crashed send leaves no marker and retries next eligible tick. |
| `weekly_digest` vs daily digest confusion (two "digests") | they are orthogonal: `weekly_digest` is a fixed-content email-only **kind** (its own pref row); cadence is a property of the **per-event** kinds. The prefs UI renders the weekly row distinctly (existing violet "summary" styling) and the cadence selector only on per-event kinds. Documented in `data-model.md` §2. |
| Prefs page leaks another user's settings | controller derives identity from JWT (`ensureUser`), `profile.*.self` perms, `where: { userProfileId: me.id }` — no id is ever read from the request body/path for identity. |
| `cadence` enum value reaching the PATCH that the gate doesn't understand | DTO validates against the `NotificationCadence` enum (class-validator `@IsIn`/`@IsEnum`); the gate treats any unknown value as `instant` (safe default). |
| Push column mistaken as deliverable | `pushEnabled` stays a "bientôt" placeholder in the UI (as today); cadence applies to in-app + email only. |

## 5. ADR §ADR — candidate architectural decisions (Winston gate)

**No new ADR is anticipated.** Each E5 mechanism reuses an established pattern:
- the email dispatcher (existing producer/consumer queue + template),
- the daily digest (the **existing** cron + composite-email + sent-marker pattern from
  E1-S4 — a *second instance* of a documented pattern, not a new one),
- the `NotificationPreference` model (one additive enum field — a routine schema change,
  not an architectural decision),
- the self-scoped prefs endpoints + `@pilotage/ui`.

**The one tripwire:** if S2 cannot cleanly suppress the per-event email for `daily_digest`
cadence and the implementer is tempted to introduce a **second BullMQ queue** (a separate
"digest queue") or a **direct-SMTP-from-API** path, that **would** be a new cross-cutting
pattern → it must land **with an ADR** *and* is explicitly a **non-goal** (spec §Non-goals,
AC-3/AC-7). The intended shape — worker cron mirrors `ParentDigestCronService` and sends
via the **existing** `MailerService` (as the weekly digest already does) — needs **no
ADR** and **no new queue**. The S2 story records the shape that shipped.

## 6. Pre-merge steps (documented, not run by agents)

- **S2 schema change:** edit `schema.prisma` (additive `NotificationCadence` enum + the
  `cadence` field with `@default(instant)` on `NotificationPreference`) → `prisma generate`
  → `prisma db push` (repo convention — **no SQL `migrations/` folder**). Additive +
  defaulted ⇒ safe on existing rows, **no backfill**.
- **Murat** runs `pnpm typecheck` **once** per slice (the only heavy local gate);
  `git diff --check` clean.
- **S1/S2 worker:** the single most valuable targeted test runs the dispatcher / digest
  composition through fixtures (no SMTP, no build) — see `quickstart.md` + each story.
- UI screenshots (S3) **only if the app is already running** at `http://localhost:3100`
  (desktop 1680×944 + mobile 390×844). Never rebuild the stack just to verify.
