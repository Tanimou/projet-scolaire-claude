# E5 — Quickstart (manual demo per slice)

> How to **see each E5 slice working** with the stack already running (never rebuild just to verify —
> project-context §4). Email lands in **Maildev** in dev. Demo login (full data):
> `mme.dupont@voltaire.fr` / `Demo!2024Pilotage`; simple per-portal:
> `parent@pilotage.local` / `teacher@pilotage.local` / `Changeme123!`.
>
> **Endpoints** are under `/api/v1`. **Web** runs on **`http://localhost:3100`** (not 3000).
> **Maildev** UI is the dev SMTP inbox (default `http://localhost:1080`; confirm the port in your
> compose/env). The dispatcher + digest send through `MailerService` → Maildev.

## Prerequisites (already running — do NOT rebuild)

- API (`apps/api`, :4000), worker (`apps/worker`), web (`apps/web`, :3100), Postgres, Redis, Maildev —
  all up via the existing dev stack. If the stack is **not** running, the user batches the rebuild;
  agents never build (§4).
- A parent account with at least one **active-guardianship** child that has published grades (for the
  alert/grade/digest content). The `voltaire-demo` data satisfies this.

---

## S1 — Verify & harden the email dispatcher

**Goal:** prove an opted-in recipient receives the branded instant email end-to-end.

1. **Opt in to email** for a kind that is easy to trigger. As the parent, open `/parent/settings` →
   **Notifications**, turn **Email** on for **Alertes** (and/or **Notes publiées**). (Pre-S3 you can
   also `PATCH /api/v1/notifications/preferences/alert` with `{"emailEnabled": true}` directly.)
2. **Trigger an event:**
   - *Alert path:* have a teacher flag a grade or wait for / trigger the alert evaluation (admin
     `/admin/alerts` → "Évaluer maintenant", or the 15-min cron). A raised alert for the child fans
     out via `createMany` → `dispatchEmails`.
   - *Grade path:* publish a grade for the child.
3. **Observe Maildev:** a branded `notifications-email` message arrives for the parent, with the
   explainable body + a deep link back into the dashboard. **Latency is seconds** (queue + worker).
4. **Negative checks (the hardening):**
   - A parent with **Email off** for that kind receives **in-app only** (nothing in Maildev).
   - A recipient with **no email address** is **skipped** (logged, no crash, others still send).
   - Re-running the same source event does **not** produce a second email (source-dedup).

**Targeted test (no SMTP, no build):** the `dispatchEmails` / processor unit spec asserts: opt-in →
one job with correct render input; email-off → zero jobs; duplicate source → no second job. Run via
the unit runner; gated by `pnpm typecheck` (Murat).

---

## S2 — Cross-kind daily digest & cadence

**Goal:** prove instant vs. daily-digest cadence, and the one grouped email.

1. **Set cadence** (pre-S3, via API; post-S3, via the UI):
   - `PATCH /api/v1/notifications/preferences/grade_published` → `{"emailEnabled": true, "cadence":
     "daily_digest"}`
   - `PATCH /api/v1/notifications/preferences/announcement` → `{"emailEnabled": true, "cadence":
     "daily_digest"}`
   - Keep `alert` on `{"emailEnabled": true, "cadence": "instant"}`.
2. **Generate a day's worth of events:** publish 2–3 grades + post 1 announcement (the
   `daily_digest` kinds) and raise 1 alert (the `instant` kind), all for the parent's child.
3. **Observe Maildev immediately:** **only the alert** email arrives at event time (instant). The
   grades + announcement produce **no per-event email** (suppressed by `daily_digest`); their in-app
   rows still appear in the bell.
4. **Force the daily window:** set `DIGEST_DAILY_SEND_HOUR` to the current UTC hour (and let the
   hourly check tick), per the env override (mirrors the weekly digest's `DIGEST_SEND_*`). Then:
   - **One grouped email** arrives: *"🔔 Votre résumé du jour — 2 nouvelles notes · 1 annonce"*,
     grouped by kind (one section per kind, count + up to 3 sample titles + one deep link per group),
     sky-blue branded to distinguish it from the violet weekly digest.
5. **Idempotency + empty checks:**
   - Re-run the same window the same day → **no second digest** (the `(user, day)` sent-marker).
   - A user with **no** `daily_digest` events that day → **no email** (empty digest sends nothing).

**Targeted test:** the cadence truth-table unit spec (off/instant/daily_digest × emailEnabled) +
a daily-cron idempotency spec (second run same day → zero emails), mirroring
`parent-digest-cron.spec.ts`.

**DB note (pre-merge, not run by agents):** S2 adds the `NotificationCadence` enum + `cadence` column
via `prisma generate` + `prisma db push` (additive, default `instant`, no backfill).

---

## S3 — Dedicated parent/teacher notification-preferences UI

**Goal:** prove the self-service cadence + channel + mute control on both portals.

1. **Parent:** open `/parent/settings` → **Notifications**. Each kind row shows a **cadence selector**
   (Instant / Résumé quotidien / Off) + channel switches (In-app / Email; Push "Bientôt"). Flip
   **Notes publiées** to **Résumé quotidien**, mute **Messages système** (Off), keep **Alertes** on
   Instant. Each change saves optimistically with a kind confirmation.
2. **Teacher:** open `/teacher/settings` → **Notifications** — the **same** panel. Set **Annonces** to
   Résumé quotidien, **Messagerie** to Instant.
3. **Reload** → the choices persist (read back from `GET /notifications/preferences`).
4. **Disabled-with-hint:** turn **Email off** for a kind → its cadence selector is disabled with the
   hint *"Activez l'email pour choisir la fréquence"*.
5. **Behaviour check:** the cadence you set drives S2 — a `daily_digest` kind no longer emails
   instantly; the daily digest groups it.

**Accessibility spot-check (with the app running):**
- Tab to a cadence selector → it is a **radiogroup**; **arrow keys** move between Instant / Résumé
  quotidien / Off; **Enter/Space** selects; focus ring is visible; targets ≥ 24 px.
- Each option reads **icon + text** (not colour-alone); switches expose `aria-checked` + a descriptive
  label.
- Screenshots (if verifying): desktop **1680×944** + mobile **390×844**; no horizontal scroll, rows
  stack on mobile, ≥ 44 px touch targets.

---

## Cross-slice sanity

- **Defaults unchanged:** a user who never opens the screen keeps in-app on / email off / cadence
  instant — **zero behaviour change**.
- **Tenancy:** every email/digest/pref operation is tenant-scoped; a user only ever sees/edits **their
  own** preferences.
- **Tone:** all copy factual, kind, non-stigmatising, French; no notification names or compares
  another child.
