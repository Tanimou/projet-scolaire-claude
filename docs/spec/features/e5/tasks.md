# E5 — Slice backlog (tasks)

> The shippable vertical slices for **E5 — Advanced Notifications**. Each slice = one PR + one build,
> demoable end-to-end. Ship **in order** (S1 → S2 → S3). Per-slice self-contained `story` specs land
> in [`stories/`](./stories/) on each slice's run. See [`spec.md`](./spec.md) for AC,
> [`plan.md`](./plan.md) for architecture, [`data-model.md`](./data-model.md) for the one additive
> field, [`contracts/openapi.yaml`](./contracts/openapi.yaml) for the API delta, [`ux.md`](./ux.md)
> for the UX contract, [`quickstart.md`](./quickstart.md) for the manual demo.

**Status legend:** `[ ]` not started · `[~]` in progress · `[x]` shipped.

---

## [ ] S1 — Verify & harden the email dispatcher (baseline) · `[worker]` · P2 · ~S

**Goal:** prove the **already-built** end-to-end email path is trustworthy, and harden any gap —
**without re-implementing it**. (Roadmap's "email queue stub" line is stale; the dispatcher is wired.)

**Scope (api + worker, verify-first):**
- Add the **single most valuable targeted test** (Murat-picked): a `dispatchEmails` / processor unit
  spec — opt-in (`emailEnabled`, default `cadence=instant`) → exactly one `notifications-email` job
  enqueued with correct render input; `emailEnabled=false` → zero jobs; duplicate source → no second
  job (no double-send).
- Harden edges (additive/minimal, only where a defect is found): missing/empty recipient email → skip
  (logged, never throws — already partly handled in `dispatchEmails`); locale fallback `fr-FR`;
  best-effort isolation (SMTP/Redis failure never breaks the in-app insert); retry/backoff posture
  confirmed (attempts 3, exponential).
- Document the manual end-to-end proof in [`quickstart.md`](./quickstart.md) (opt-in → trigger →
  Maildev).

**Acceptance:**
- The targeted test passes under `pnpm typecheck` + the unit runner; no double-send for one source
  event; missing-email never throws; an enqueue/send failure is invisible to the caller (in-app
  unaffected).
- **No new queue, no new template, NO schema change** in S1.

**Out of scope:** cadence, digest grouping, any UI, push/SMS.

---

## [ ] S2 — Cross-kind daily digest & cadence · `[schema][worker]` · P1 · ~M

**Goal:** the net-new anti-fatigue engine — the **only** schema change of the epic plus the daily
digest cron, expressing the per-kind cadence promise end-to-end.

**Scope (schema + api + worker):**
- **Schema (`db push`):** additive `enum NotificationCadence { instant daily_digest off }` + a
  `cadence NotificationCadence @default(instant)` column on `NotificationPreference` +
  `@@index([tenantId, cadence, emailEnabled])`. No SQL `migrations/` folder. No backfill. (See
  `data-model.md` §1.)
- **Contracts:** add `NotificationCadence` to `packages/contracts` notification types.
- **API:** return `cadence` in `PreferenceDto` (`listForUser`); accept optional `cadence` in
  `UpdatePreferenceDto` (validated `@IsEnum`); apply the **FR-2 cadence gate** in `dispatchEmails`
  (off → suppress; daily_digest → suppress instant email, mark digest-eligible; instant → today's
  path); resolve the in-app-off + daily_digest edge (`data-model.md` §3.3) so the daily cron has a
  durable source.
- **Worker:** a **new** `notifications-digest` cron module (structural mirror of `parent-digest/*`):
  hourly check + daily send-window gate (`DIGEST_DAILY_SEND_HOUR`, default 18h UTC) + re-entrancy
  guard; per-tenant → per-user resolution of `daily_digest` + `emailEnabled` opt-ins; group each
  user's day-window `daily_digest` notifications **by kind** (+ per child where relevant); render one
  composite branded email (generalises `renderDigestEmail`); send via the **existing** `MailerService`;
  idempotent `(user, day)` via a `Notification(kind=system, sourceType='daily_digest', sourceId=<day
  UUID>, readAt=now)` sent-marker. **No new queue, no new table.**

**Acceptance (folds spec AC-1/2/3/6/7 + ux S2):**
- Cadence truth table honoured (unit-pinned): off / instant / daily_digest × emailEnabled — emit |
  suppress | digest-eligible.
- One grouped email per eligible user per day, grouped by kind (+ per child), wins (`IMPROVEMENT`)
  celebrated; **empty set → no email**; re-run same day → **nothing** (marker); a per-user failure
  never aborts the tenant loop; tenant-scoped throughout.
- Defaults preserve today's behaviour (existing rows resolve to `instant`); weekly digest untouched.
- Email a11y: icon+text severities, plain-text alternative, single clear deep link per group.
- **No new BullMQ queue, no new per-event template, no new table; no ADR** (stays within the
  `plan.md` §5 tripwire).

**Out of scope:** the prefs UI control (S3), push/SMS, per-user timezones/quiet-hours, custom windows.

---

## [ ] S3 — Dedicated parent/teacher notification-preferences UI · `[web][a11y]` · P2 · ~M

**Goal:** the self-service control that turns the S2 cadence engine into a felt promise — for parents
and teachers, in their own portal.

**Scope (`apps/web` only):**
- Surface a **portal-native** notification-preferences panel on **both** `/parent/settings` and
  `/teacher/settings` (the exact mount — extend the existing **Notifications** tab vs. a dedicated
  `/settings/notifications` sub-page — is the S3 story's call; either keeps the shared panel + server
  actions). Per kind: **cadence selector** (Instant / Résumé quotidien / Off) + channel switches
  (In-app / Email; Push disabled "Bientôt") + a header **"Tout mettre en sourdine"** mute.
- **Extend** the shared `PreferencesPanel` (cadence-aware) — do **not** fork it; add a `CadenceSelect`
  (radiogroup, roving tabindex) reusing the E3-S3 severity segmented-control pattern. Persist via the
  existing `PATCH /notifications/preferences/:kind` (now accepting `cadence`); optimistic with
  per-control error revert.
- Cadence selector **disabled-with-hint** when Email is off (*"Activez l'email pour choisir la
  fréquence"*); collapse `cadence=off` and `emailEnabled=false` into one calm **Off** affordance for
  the user while preserving server state.

**Acceptance (folds spec AC-4 + ux S3):**
- Both portals render every kind with cadence + channels + mute; changes persist and survive reload;
  a user can only read/write **their own** prefs (`profile.*.self`).
- WCAG 2.2 AA: cadence selector is a keyboard radiogroup (arrow keys, Enter/Space, visible focus,
  ≥24 px), icon+text (not colour-alone), ≥44 px touch targets, mobile-first, `prefers-reduced-motion`
  honoured; 4.5:1 contrast.
- The admin `PreferencesPanel` and the parent reassurance banner keep working unchanged; the
  weekly-digest row stays distinct and is excluded from the cadence mute.
- **No schema change, no new endpoint, no new permission.**

**Out of scope:** admin-imposed cadence policy, push/SMS controls, per-user scheduling.

---

## Cross-slice invariants (every slice)

- Tenant + RLS + `profile.*.self` on every operation; no cross-user/cross-tenant access.
- Email stays opt-in / default-OFF (RGPD); cadence default `instant` ⇒ zero behaviour change until a
  user opts in.
- Reuse-first: existing queue/processor/template, `MailerService`, `createMany`/prefs service, the
  E1-S4 digest pattern, `@pilotage/ui`, `packages/contracts`.
- Kind, factual, non-stigmatising French copy; no notification names or compares another child.
- `pnpm typecheck` (Murat, once/slice); no `git diff --check` errors; **any new architectural
  decision → a new `docs/adr/` ADR** (Winston gate — none anticipated; `plan.md` §5 tripwire).
