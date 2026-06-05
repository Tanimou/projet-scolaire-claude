# E3-S4 — Email on the cron path (parity with the API path) · story spec

> **Self-contained story** (John, BMAD PM). A developer implements THIS slice from this file
> alone. Epic: **E3 — Complete the Alert Engine**. Predecessors **S1** (`TEACHER_COMMENT_FLAG`),
> **S2** (`IMPROVEMENT`), **S3** (admin rule-config UI) are all **shipped — engine is 7/7 wired,
> admin can tune rules, cron rings the in-app bell**. This slice is the **last E3 slice**: it makes
> the worker cron path **email** opted-in guardians, removing the documented "IN-APP ONLY"
> asymmetry. **Worker-only** — no DB, no UI, no new API endpoint.
>
> `touchesUi: false` · `touchesBackend: false` · `touchesWorker: true`
> Portal: **parent** (the recipient) · Risk tier: **P1** · Tags: `[worker]`

---

## 1. Capability (what now happens, end-to-end)

Today the 15-minute alert cron (`apps/worker`) creates an `AlertInstance` **and** an in-app
`Notification` per active guardian, but it **never emails** — the email channel is owned by the API
path only (`NotificationsService.dispatchEmails`, used by the manual "Évaluer maintenant" button).
The worker code says so explicitly:

> `apps/worker/src/modules/alerts-cron/alerts-evaluator.service.ts` →
> `SCOPE — IN-APP ONLY. … replicating that plumbing in the worker is deliberately deferred to a
> follow-up. … This asymmetry is intentional and tracked.`

**This slice removes that asymmetry.** After the cron creates a new `AlertInstance` and fans out the
in-app `Notification` rows, it ALSO enqueues — onto the **same existing `notifications-email`
BullMQ queue** the API producer already uses — one email job per guardian who has **opted in** to
email for the `alert` notification kind (`NotificationPreference(kind='alert', emailEnabled=true)`).
Email defaults **OFF** (RGPD opt-in), so for almost everyone nothing changes; the few parents who
turned email on now receive the cron-detected alert by email too, with **identical** content,
template, retry/backoff, and dedup semantics to the API path.

A parent who opted into email alerts now gets the email **regardless of which path raised the
alert** (cron or "Evaluate now") — the cahier's notification promise ("parent email on alerts").

---

## 2. Decision: shape (A) — worker enqueues the same job. No ADR.

`plan.md` §ADR offers two shapes. **This slice ships shape (A)** (preferred): the worker
**enqueues the same `notifications-email` job** the API producer enqueues. It reuses the established
producer/consumer pattern → **no new architectural decision, no ADR-020, no new queue, no new
template.** (Shape (B) — a direct `MailerService.send` from the cron — is explicitly **rejected**
here: it would create a *second* alert-email code path that bypasses the shared template/retry and
would require ADR-020. Do NOT use shape (B).)

Why (A) is clean and already 90% wired:
- The worker's `QueueModule` **already registers** the `notifications-email` queue
  (`apps/worker/src/shared/queue/queue.module.ts`, `QUEUE_NOTIFICATIONS_EMAIL = 'notifications-email'`)
  — today only *consumed* by `NotificationsEmailProcessor`. Making the cron a **producer** on the
  same queue is additive.
- The job payload type **already exists** in the worker, hand-mirrored from the API:
  `apps/worker/src/modules/notifications-email/notification-email.types.ts` → `NotificationEmailJob`.
  Reuse it as-is; do **not** add a new type.
- The consumer (`NotificationsEmailProcessor`) renders + sends; it "never has to consult preferences
  — it just sends" (its own docstring). So the **producer is the preference gate** — exactly mirror
  the API producer's gate (§4).

---

## 3. Exact target file & the comment to remove

**File:** `apps/worker/src/modules/alerts-cron/alerts-evaluator.service.ts`

The in-app fan-out lives in the private method `notifyGuardiansOfAlert(args)` (returns the count of
in-app rows). The email dispatch is **the worker mirror of the API's `dispatchEmails`**.

**Remove** (or rewrite) the now-false "SCOPE — IN-APP ONLY … This asymmetry is intentional and
tracked." paragraph in that method's docstring — AC requires it gone once email ships. Replace it
with a one-line note that email is dispatched via the shared `notifications-email` queue, gated by
`NotificationPreference(alert, emailEnabled)`, default OFF.

---

## 4. The API path this MUST byte-match (the gate + the job)

Mirror **`NotificationsService.dispatchEmails`** in
`apps/api/src/modules/notifications/notifications.service.ts`. The worker version differs ONLY in
that the worker has no `NotificationPreferencesService`/`UserProfile` helper injected — it queries
Prisma directly (same way `notifyGuardiansOfAlert` already does its own guardianship query).

### 4a. The opt-in gate (mirror `emailEnabledKeys`)
Email defaults **OFF**. A guardian is emailed for an alert **iff** they have an explicit
`NotificationPreference` row with `kind = 'alert'` AND `emailEnabled = true`, scoped to the tenant.
Implement as a single query over the in-app recipients you already resolved:

```ts
const optedIn = await this.prisma.notificationPreference.findMany({
  where: {
    tenantId: args.tenantId,
    kind: 'alert',
    emailEnabled: true,
    userProfileId: { in: recipients }, // the guardian userProfileIds from notifyGuardiansOfAlert
  },
  select: { userProfileId: true },
});
const optedInIds = new Set(optedIn.map((r) => r.userProfileId));
```

(Reads the **same** `NotificationPreference(alert, emailEnabled)` rows the API gate reads — the
opt-in toggle already ships in the shared `PreferencesPanel`, E1-S4/E2-S4; **no UI work here**.)

### 4b. Resolve recipient profiles → email address (mirror the API's `userProfile.findMany`)
```ts
const profiles = await this.prisma.userProfile.findMany({
  where: { id: { in: [...optedInIds] } },
  select: { id: true, email: true, firstName: true, lastName: true, locale: true },
});
```
Skip any profile with no `email`.

### 4c. Build the job — use the existing `NotificationEmailJob` shape, identical field mapping
Import `NotificationEmailJob` from
`../notifications-email/notification-email.types` and `QUEUE_NOTIFICATIONS_EMAIL` from
`../../shared/queue/queue.module`. Map fields **exactly** like the API producer (the alert is
`kind: 'alert'`):

```ts
const data: NotificationEmailJob = {
  tenantId: args.tenantId,
  to: p.email,
  recipientName: [p.firstName, p.lastName].filter(Boolean).join(' ').trim() || p.email,
  locale: p.locale ?? 'fr-FR',
  kind: 'alert',
  severity: severityMap[args.severity], // SAME low->info / medium->warning / high->danger map already in this file
  title: args.title,
  body: args.body,
  link: `/parent/recommendations?studentId=${args.studentId}`, // SAME deep link as the in-app row
  sourceType: 'alert_instance',
  sourceId: args.alertId,
};
```
**Reuse the `severityMap` already defined in `notifyGuardiansOfAlert`** — hoist it to a module-level
const if needed so both the in-app insert and the email job share one definition (no duplicate map).

### 4d. Enqueue with the SAME job opts (identical retry/backoff)
Mirror the API producer's `addBulk` opts **exactly** so retry/backoff/cleanup are identical:
```ts
await this.emailQueue.addBulk(
  jobs.map((data) => ({
    name: 'alert',
    data,
    opts: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5_000 } as const,
      removeOnComplete: { count: 200, age: 24 * 3600 },
      removeOnFail: { count: 100, age: 7 * 24 * 3600 },
    },
  })),
);
```

---

## 5. Wiring (DI) — two small additions

1. **`AlertsCronModule`** (`apps/worker/src/modules/alerts-cron/alerts-cron.module.ts`) must
   `imports: [QueueModule]` so `@InjectQueue` resolves (exactly like
   `ExportsModule`/`NotificationsEmailModule` do). Import `QueueModule` from
   `'../../shared/queue/queue.module'`.

2. **`AlertsEvaluatorService`** constructor injects the queue alongside the existing `PrismaService`:
   ```ts
   constructor(
     private readonly prisma: PrismaService,
     @InjectQueue(QUEUE_NOTIFICATIONS_EMAIL)
     private readonly emailQueue: Queue<NotificationEmailJob>,
   ) {}
   ```
   Imports: `import { InjectQueue } from '@nestjs/bullmq';` and `import { Queue } from 'bullmq';`
   (both already used by the API producer — same versions).

   ⚠️ **The existing unit test `alerts-evaluator.notify.spec.ts` constructs the service with ONE
   arg**: `new AlertsEvaluatorService(prisma as never)`. Adding a second required constructor param
   breaks that test's compile/instantiation. **You MUST update that test** to pass a queue stub
   (e.g. `{ addBulk: jest.fn() }`) as the second arg in its `callNotify` helper — keep all its
   existing assertions intact (they cover the in-app path, which is unchanged). Do **not** make the
   queue optional just to dodge the test; DI should inject it for real.

---

## 6. Where to call the email dispatch (ordering + best-effort)

In `notifyGuardiansOfAlert`, **after** the in-app `notification.createMany` succeeds (or even if it
returns 0 — an email-only opt-in is valid: in-app off, email on), dispatch the email for the
opted-in subset. Keep it **best-effort and isolated** in its own `try/catch` so an enqueue failure
**never** rolls back the already-committed `AlertInstance`/`Notification` nor aborts the evaluation
loop (this matches the file's existing "best-effort" contract and the API producer's
"email is a side channel" contract). Suggested structure:

- Resolve `recipients` (guardian userProfileIds) — already computed for the in-app insert; reuse the
  same list (do NOT re-derive a different recipient set, so in-app and email address the same
  guardians, just gated differently).
- Run the §4 gate + build + enqueue inside a nested `try/catch` that logs and swallows.
- The method's return value (in-app count, telemetry only) is unchanged; optionally log
  `emailed=<n>` for parity with the existing log line.

**Recipient parity is mandatory:** the email recipient set is **the in-app recipient set ∩ opted-in
to email** — never a wider set. No guardian outside the student's active `Guardianship` is ever
emailed (the gate query is `userProfileId: { in: recipients }`, and `recipients` already came from
the active-guardianship query in `notifyGuardiansOfAlert`).

---

## 7. Invariants (carried from E3 cross-slice + cahier)

- **Tenant isolation:** every new query carries `tenantId: args.tenantId`; the pref gate filters
  `tenantId`; recipients come from the per-tenant guardianship query. **No cross-tenant recipient.**
- **RGPD default-OFF opt-in:** no row / `emailEnabled=false` → in-app only, exactly as today. Only
  an explicit `emailEnabled=true` row triggers an email. No new data is collected.
- **No double-send:** the `AlertInstance` is already deduped within 7 days `(rule, student,
  subject?)` (unchanged) and the in-app `Notification` is source-deduped `(alert_instance, alertId,
  userProfileId)` — so a re-tick that finds the existing instance never re-creates it and therefore
  never re-enters this email path. (Caveat, inherited & accepted from the API producer's docstring:
  an email-only recipient — in-app off, email on — relies on the **instance** dedup, which holds
  here because email is only dispatched on a *freshly created* instance, inside the `if (recent)
  continue;` guard's else branch. Do not move the email dispatch outside the new-instance block.)
- **In-app fan-out unchanged:** the existing in-app behavior, severity map, source-dedup, and
  best-effort error swallowing are **untouched** — email is strictly **additive**.
- **No new queue, no new template, no new schema, no UI, no new endpoint, no event-driven re-eval,
  no `BEHAVIOR_ALERT`** (spec §6 non-goals). Reuse `notifications-email` + `NotificationEmailJob`.
- **Explainability preserved:** the email carries the same explainable `title`/`body` + the
  `/parent/recommendations` deep link as the in-app alert; never comparative.

---

## 8. Acceptance criteria (this slice)

1. **Email iff opted in.** A cron-detected NEW alert enqueues exactly one `notifications-email` job
   (`name: 'alert'`, `kind: 'alert'`) onto the existing `notifications-email` queue **for each
   guardian with `NotificationPreference(tenantId, kind='alert', emailEnabled=true)`** and a non-null
   email — and **zero** jobs for guardians with no row or `emailEnabled=false`.
2. **Reuse only.** No new BullMQ queue, no new email template, no new job type — the job uses the
   existing `NotificationEmailJob` shape and the existing `QUEUE_NOTIFICATIONS_EMAIL`; opts
   (`attempts/backoff/removeOnComplete/removeOnFail`) byte-match the API producer.
3. **In-app unchanged.** The in-app `Notification` fan-out, severity map, source-dedup, and
   best-effort error handling are unchanged; all existing assertions in
   `alerts-evaluator.notify.spec.ts` still pass (with the constructor updated to take a queue stub).
4. **Tenant-scoped, no leak.** The pref gate and recipient resolution are `tenantId`-scoped; a
   guardian in another tenant is never emailed; the email recipient set ⊆ the in-app recipient set.
5. **Best-effort.** An `addBulk`/Prisma failure in the email path is caught, logged, and swallowed —
   it never rolls back the `AlertInstance`/`Notification` nor aborts the per-tenant evaluation loop.
6. **No double-send.** Email is dispatched only inside the freshly-created-instance branch (after the
   7-day-dedup `if (recent) continue;` guard), so a re-tick on an existing open alert emails nothing.
7. **Asymmetry comment gone.** The "SCOPE — IN-APP ONLY … asymmetry is intentional and tracked"
   docstring in `alerts-evaluator.service.ts` is removed/rewritten to reflect that email now ships.
8. **Gates.** `pnpm typecheck` green (Murat); no `git diff --check` errors. No `db push` /
   `prisma generate` needed (no schema change). No ADR needed (shape (A), reuse).

---

## 9. Targeted test (Murat, P1) — extend `alerts-evaluator.notify.spec.ts`

Reuse the existing hand-rolled Prisma mock pattern; add a queue stub. New cases (unit, no Nest/DB):

- **opted-in → enqueued:** two guardians, one with `NotificationPreference(alert, emailEnabled=true)`
  → `emailQueue.addBulk` called once with **one** job, `name: 'alert'`, `data.to` = that guardian's
  email, `data.kind: 'alert'`, `data.link` = `/parent/recommendations?studentId=…`,
  `data.sourceId` = alertId. Mock `notificationPreference.findMany` to return the opted-in id,
  `userProfile.findMany` to return that profile's email.
- **default OFF → no email:** no preference rows → `addBulk` NOT called (or called with zero jobs);
  in-app insert still happens (existing assertions unchanged).
- **opted-in but no email address:** profile `email: null` → no job for that recipient.
- **best-effort:** `emailQueue.addBulk` rejects → method still resolves (returns the in-app count),
  error swallowed, loop not aborted.
- **tenant scope:** assert the `notificationPreference.findMany` call was made with
  `where.tenantId === 'tenant-1'` and `where.kind === 'alert'` and `where.emailEnabled === true`.

Keep every existing assertion in the spec green (in-app path is unchanged).

---

## 10. Out of scope (do NOT do)

- ❌ A direct `MailerService.send` from the cron (shape (B)) — rejected; would need ADR-020.
- ❌ A new BullMQ queue, a new email template, or a new job type.
- ❌ Any schema change, migration, `db push`, or `prisma generate`.
- ❌ Any UI work — the email opt-in toggle already ships in the shared `PreferencesPanel`.
- ❌ Touching the in-app fan-out logic, the severity map values, the dedup window, or any of the 7
  rule evaluators.
- ❌ Push / SMS channels (E5). Event-driven re-eval (out of E3).
