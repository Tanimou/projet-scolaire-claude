# E5-S1 — Verify & harden the email dispatcher (baseline)

> **Self-contained story spec.** A developer implements this slice from THIS file
> alone. Mode: `epic-slice`. Epic: **E5 — Advanced Notifications**. Slice **S1** of S1→S3.
> `[worker]` · **P2** · ~S. **touchesUi: false · touchesBackend: true (test-only) ·
> touchesWorker: true (test-only).**
>
> **Reuse-first, verify-first.** The end-to-end email path is **already wired** (the
> roadmap's "queue stub" line is stale). This slice does **not** re-implement it — it
> *proves* it with the single highest-value targeted test, asserts the few real
> behaviours that are currently untested, and fixes a concrete defect **only if** the
> audit finds one. **NO new queue, NO new template, NO schema change, NO migration,
> NO UI.**

---

## 1. Context — the path as it exists today (ground truth, read before coding)

The instant-email path is producer → queue → consumer → SMTP:

1. **Producer (API)** — `NotificationsService.createMany(...)` →
   private `dispatchEmails(...)` in
   `apps/api/src/modules/notifications/notifications.service.ts` (lines ~176–234).
   It: source-dedups (already done upstream in `createMany`), asks
   `NotificationPreferencesService.emailEnabledKeys(...)` for the
   `${userProfileId}|${kind}` keys that **explicitly** opted into email (default
   **off**), loads `userProfile` rows (`id, email, firstName, lastName, locale`),
   builds one `NotificationEmailJob` per recipient **with a usable email**, and
   `emailQueue.addBulk(jobs)` onto the `notifications-email` queue with
   `{ attempts: 3, backoff: { type: 'exponential', delay: 5_000 }, removeOnComplete,
   removeOnFail }`. The whole method is wrapped in `try/catch` — **any** failure
   (Redis, prisma) is logged and swallowed so the in-app insert the caller depends on
   is never affected.
2. **Queue** — `QUEUE_NOTIFICATIONS_EMAIL = 'notifications-email'`
   (`apps/api/src/shared/queue/queue.module.ts`, mirrored in
   `apps/worker/src/shared/queue/queue.module.ts`).
3. **Consumer (worker)** — `NotificationsEmailProcessor.process(job)` in
   `apps/worker/src/modules/notifications-email/notifications-email.processor.ts`:
   reads `WEB_PUBLIC_URL` (default `http://localhost:3000`), calls
   `renderNotificationEmail(job.data, { webBaseUrl })`, then
   `mailer.send({ to, subject, html, text })`, logs, returns `{ sent: true }`.
4. **Template** — `renderNotificationEmail(...)`
   (`apps/worker/.../notification-email.template.ts`) — already specced in
   `notification-email.template.spec.ts` (subject, link-absolutise, HTML-escape,
   plain-text, severity accent). **Do not re-test the template.**
5. **Mailer** — `MailerService.send(...)`
   (`apps/worker/src/shared/mail/mailer.service.ts`) — thin nodemailer wrapper →
   Maildev (`MAIL_HOST`/`MAIL_PORT`, dev `maildev:1025`).

**Payload contract** — `NotificationEmailJob` (API
`notifications/notification-email.types.ts`, hand-mirrored in worker
`notifications-email/notification-email.types.ts`): `tenantId, to, recipientName,
locale, kind, severity, title, body, link, sourceType, sourceId`.

### 1.1 What is ALREADY tested (do NOT duplicate)

`apps/api/src/modules/notifications/notifications.service.spec.ts` already pins, on
the **producer** side:
- email default off → **zero** jobs enqueued;
- only explicitly-opted-in `${user}|${kind}` recipients get a job;
- in-app-off + email-on recipient still gets the email (channels independent);
- an `addBulk` failure never breaks the in-app insert (`created` still correct);
- source-dedup runs before preference gating.

`notification-email.template.spec.ts` already pins subject/link/escape/text/severity.

The cron-path producer parity is pinned in
`apps/worker/src/modules/alerts-cron/alerts-evaluator.notify.spec.ts` (opt-in gate,
job shape, `attempts:3`, empty-email skip, name-fallback, error swallow).

### 1.2 The real gaps (what this slice adds)

1. **The worker consumer has ZERO test coverage.** `notifications-email.processor.ts`
   — the component that actually renders + invokes the mailer and whose throw/return
   behaviour drives BullMQ retry — is **completely untested**. This is the single
   most-valuable missing test and the headline deliverable of S1.
2. **Producer edges asserted by the intent but NOT yet pinned in the API spec:**
   - a recipient with a **missing/empty** `email` is **skipped** without throwing
     (the `if (!p?.email) return null` branch — the cron spec covers it, the API
     `dispatchEmails` spec does not);
   - **`fr-FR` locale fallback** when `userProfile.locale` is `null`
     (`locale: p.locale ?? 'fr-FR'` — currently unasserted);
   - the **retry/backoff posture** on the enqueued job
     (`attempts: 3`, `backoff exponential 5000ms`) — currently unasserted on the API
     producer (only on the cron producer).

---

## 2. Intent (one sentence)

Prove the already-built notification email path is trustworthy by adding the highest-
value targeted worker-processor test plus the missing producer-edge assertions
(missing/empty recipient skipped without throwing, `fr-FR` locale fallback, retry/
backoff posture, best-effort SMTP/Redis isolation, no double-send), fixing a concrete
gap only if found — with no new queue, template, schema, or UI.

---

## 3. Functional requirements (this slice)

- **FR-S1-1 — Worker processor unit spec (headline, new file).** Add
  `apps/worker/src/modules/notifications-email/notifications-email.processor.spec.ts`.
  Instantiate the processor directly with a mocked `MailerService`
  (`new NotificationsEmailProcessor(mailer as never)`), exactly the dependency-
  injection-free style used by `alerts-evaluator.notify.spec.ts`. Assert:
  - **happy path:** `process(job)` calls `renderNotificationEmail` (real, not mocked —
    it is pure) and forwards its `{ subject, html, text }` plus `data.to` into
    `mailer.send`, and resolves `{ sent: true }`. Verify `mailer.send` is called once
    with `to === job.data.to` and a non-empty `subject`/`html`/`text`.
  - **link absolutisation uses `WEB_PUBLIC_URL`:** set `process.env.WEB_PUBLIC_URL`
    to a known base in the test, assert the sent `html`/`text` contains
    `<base>/parent/...`; restore the env afterwards. (Confirms the processor passes
    the configured base through, not the hardcoded fallback.)
  - **default base fallback:** with `WEB_PUBLIC_URL` unset, the call still succeeds
    (default `http://localhost:3000`) and does not throw.
  - **failure surfaces (retry posture):** when `mailer.send` rejects, `process(job)`
    **rejects** (does NOT swallow). This is correct and required — the processor must
    let BullMQ see the failure so the producer's `attempts: 3` / exponential backoff
    actually engages. (Swallowing here would silently drop mail.) A one-line comment
    in the spec records *why* the consumer rethrows while the producer swallows.
- **FR-S1-2 — Producer edge assertions (extend the existing API spec, do NOT fork).**
  In `apps/api/src/modules/notifications/notifications.service.spec.ts`, add cases to
  the existing `email channel (R8.2)` describe block:
  - **missing/empty email skipped, never throws:** an opted-in recipient whose
    `userProfile.email` is `''`/absent produces **no** job, the call resolves
    normally, and a *second* opted-in recipient **with** an email **still** gets their
    job (one bad recipient never drops the batch). Drive this by making the mocked
    `userProfile.findMany` return a row with `email: ''` for one id.
  - **`fr-FR` locale fallback:** an opted-in recipient whose profile `locale` is
    `null` yields a job whose `data.locale === 'fr-FR'`.
  - **retry/backoff posture:** the enqueued job's `opts` matches
    `{ attempts: 3, backoff: { type: 'exponential', delay: 5000 } }`.
  (The existing `makeService()` harness already mocks `userProfile.findMany` and the
  email queue; extend its `findMany` mock to honour per-id overrides, or add a
  focused local harness in the new cases — do not break the existing cases.)
- **FR-S1-3 — Quickstart already documents the manual proof.** The manual Maildev
  walkthrough is already written in `docs/spec/features/e5/quickstart.md` §S1
  (opt-in → trigger alert/grade → observe branded email; negative checks: email-off →
  in-app only, no email; missing-email skipped; re-run → no second email). **No edit
  required** unless the audit finds the steps materially wrong; if a wording fix is
  needed keep it minimal.
- **FR-S1-4 — Fix only a concrete defect.** If, and only if, writing the tests
  surfaces a real defect (e.g. the processor throws on a `null` body before reaching
  the mailer, or a recipient with a missing email is *not* actually skipped), apply
  the **smallest additive** fix in the production file and pin it with the test.
  Document the defect + fix in §7 below and in `PROGRESS.md`. If the audit finds the
  path already correct (the expected outcome), ship the tests with **zero production
  change** and state that explicitly — a green verify is a valid, valuable result.

---

## 4. Out of scope (hard non-goals for S1)

- The `cadence` field / enum, digest grouping, the digest cron — **all S2**.
- Any UI / `PreferencesPanel` change — **all S3**.
- Push / SMS / WebSocket. Any **new** queue, template, table, column, migration,
  endpoint, or permission. Re-testing the template or the cron producer (already
  covered). Rewriting `MailerService` or the transport.

---

## 5. Files (exact)

**New (test-only):**
- `apps/worker/src/modules/notifications-email/notifications-email.processor.spec.ts`
  — FR-S1-1 (the headline new test).

**Edit (test-only, additive):**
- `apps/api/src/modules/notifications/notifications.service.spec.ts` — FR-S1-2
  (add cases to the existing `email channel (R8.2)` describe; keep all existing cases
  passing).

**Production code — touch ONLY if FR-S1-4 finds a concrete defect:**
- `apps/worker/src/modules/notifications-email/notifications-email.processor.ts`
  and/or `apps/api/src/modules/notifications/notifications.service.ts` — smallest
  additive fix, pinned by the test. (Expected: no change.)

**Docs (on land):**
- `docs/spec/features/e5/PROGRESS.md` — tick S1, record the audit verdict
  (defect-found vs. clean) and the worker-processor coverage gap now closed.
- `docs/spec/features/e5/quickstart.md` — only if a step is materially wrong (FR-S1-3).

> **Worktree discipline (memory `project_workflow_worktree_path_bug`):** ensure edits
> land in the worktree checkout, not the main repo, before the PR.

---

## 6. Acceptance criteria

- **AC-1 (worker processor proven).** The new processor spec passes: happy path calls
  `mailer.send` once with the rendered `{subject,html,text}` + correct `to` and
  resolves `{ sent: true }`; `WEB_PUBLIC_URL` is honoured for link absolutisation
  (and env restored); a `mailer.send` rejection makes `process` **reject** (so BullMQ
  retry engages) — with a comment explaining the deliberate rethrow.
- **AC-2 (producer edges pinned).** The API `dispatchEmails` spec now asserts:
  missing/empty-email recipient is skipped without throwing AND a co-batched valid
  recipient still receives their job; `null` locale → `fr-FR`; job `opts` =
  `{ attempts: 3, backoff:{ type:'exponential', delay:5000 } }`.
- **AC-3 (no double-send / best-effort, already-true, now pinned in S1 scope).** The
  existing assertions (email-off → zero jobs; source-dedup; `addBulk` failure leaves
  `created` correct) remain green; no double-send for one source event. (No new code
  needed — S1 confirms.)
- **AC-4 (no scope creep).** `git diff --stat` shows **only** the two spec files
  (plus PROGRESS/quickstart docs), unless FR-S1-4 fired — then exactly one production
  file with a minimal additive fix + its rationale in §7. **Zero** schema/migration,
  zero new queue/template, zero new file outside §5, zero UI change.
- **AC-5 (gate).** `pnpm typecheck` is green (Murat, once); `git diff --check` clean.
  Targeted runners pass:
  `pnpm --filter @pilotage/worker test -- notifications-email.processor` and
  `pnpm --filter @pilotage/api test -- notifications.service`.
- **AC-6 (RGPD/tone/tenancy unchanged).** No new data is read or persisted; tenant +
  `profile.*.self` posture is untouched (S1 is test-only); the dispatcher keeps
  carrying only the snapshot fields it already carries.

---

## 7. Pre-mortem / failure modes (became acceptance above)

- **"The test re-implements what's already covered."** Mitigated by §1.1 — the
  producer happy-paths are explicitly NOT re-tested; the *new* value is the untested
  **worker consumer** + the three unasserted producer edges.
- **"We made the processor swallow errors to look robust."** Wrong — swallowing in the
  consumer silently drops mail and defeats `attempts: 3`. AC-1 mandates the processor
  **rethrows**; only the *producer* `dispatchEmails` swallows (to protect the in-app
  insert). The spec comment must state this asymmetry.
- **"Env bleed from `WEB_PUBLIC_URL`."** The processor spec must save/restore
  `process.env.WEB_PUBLIC_URL` (and any set var) in `afterEach` to avoid cross-test
  contamination.
- **"Scope crept into S2/S3."** AC-4 caps the diff at two spec files (+docs). A
  `cadence`/digest/UI change here is a blocking finding.

**Audit verdict (filled on implement):** _defect-found → tenant-scoping gap_ (Winston
CONCERNS). The API producer's two lookups were **id-only**, asymmetric vs the worker cron
sibling and ADR-002. Fixed minimally (smallest additive change), pinned by a new assertion:

- `apps/api/src/modules/notifications/notifications.service.ts` `dispatchEmails` —
  `userProfile.findMany` `where` was `{ id: { in } }`, now `{ tenantId, id: { in } }`;
  the batch tenant is `items[0].tenantId` (every fan-out batch is single-tenant — all
  `CreateNotificationArgs` carry `tenantId` and producers loop per tenant). It is also
  passed to `emailEnabledKeys` as a 2nd arg.
- `apps/api/src/modules/notifications/preferences.service.ts` `emailEnabledKeys` — now
  accepts an optional `tenantId` and adds it to the `findMany` `where` (the `OR`-of-pairs
  query was tenant-unscoped). Optional so no other caller breaks; the dispatcher always
  passes it.

Defence-in-depth, not an exploited leak (IDs already originate tenant-scoped from the
producer) — hence CONCERNS not FAIL. Pinned by the new
`dispatchEmails — E5-S1 producer edges › scopes the profile + preference lookups by
tenantId` case.

**Known v1 limitation (documented, NOT fixed in S1):** the email-only path (in-app off +
email on) can double-send if a producer fires twice for the same source, because email
dedup relies on the in-app row existing — the existing `dispatchEmails` comment already
records this. Accepted for v1 (producers are one-shot per event; alert-eval dedups within
7 days). Left to a future slice if it ever bites. Template localisation is likewise an
S2/out-of-scope non-goal — S1 asserts the `locale` field fallback only, never adds
locale-branching rendering.

---

## 8. Notes for the implementer

- Mirror the **no-Nest-context** unit style of
  `apps/worker/src/modules/alerts-cron/alerts-evaluator.notify.spec.ts`: build the
  class by hand with `new`, pass a `jest.fn()`-backed mock for the single dependency
  (`MailerService.send`). No `Test.createTestingModule`, no DB, no Redis.
- `renderNotificationEmail` is **pure** — call the real implementation in the
  processor spec (matches how `notification-email.template.spec.ts` exercises it); only
  `MailerService.send` is mocked.
- Reuse the existing `job(over)` factory shape from
  `notification-email.template.spec.ts` for the `NotificationEmailJob` fixture (copy a
  minimal local factory; do not export across packages).
