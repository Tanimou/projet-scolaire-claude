# E3 — Quickstart (manual demo & verification)

> How to demo each slice end-to-end and what "done" looks like. App runs hybrid: infra in Docker,
> web local at `http://localhost:3100`, API at `:4000`. **Never rebuild the stack just to verify**
> — screenshots only if it is already running (project-context §4).
>
> Demo logins (project-context §6): admin `mme.dupont@voltaire.fr` / `Demo!2024Pilotage`
> (full `voltaire-demo` data) · simple `admin|teacher|parent@pilotage.local` / `Changeme123!`.

## Prerequisites (all slices)
- At least one `AlertRule` **enabled** for the tenant (admin → `/admin/alerts` → Règles → toggle).
- Active academic year + published grades for a student with an **active guardian** (the
  `voltaire-demo` seed has these). The evaluator only reads **published** grades.
- Trigger a pass either via the cron (every 15 min) or the **"Lancer l'évaluation"** button on
  `/admin/alerts` (instant).

## S1 — Teacher grade-flag → `TEACHER_COMMENT_FLAG` alert
1. **As a teacher**, open the gradebook for a class with published grades; on a grade row, toggle
   **« Signaler »** (optionally add a short reason).
2. Verify `PATCH /api/v1/grades/:id/flag` returns `{ isFlagged: true, flaggedAt, flaggedBy }` and an
   append-only `AuditLog` row `grade.flag` exists.
3. **As admin**, enable the `TEACHER_COMMENT_FLAG` rule and click **Lancer l'évaluation**.
4. **As the parent** of that student, open the bell / `/parent/recommendations`: a
   *"Signalement enseignant en {matière}"* alert is present, explainable, with a "talk to the
   teacher" recommendation. Unflagging + re-evaluating stops new instances (existing open one is
   resolvable via the E1 lifecycle).
5. Negative checks: a teacher who does **not** own the grade → `403`; a foreign-tenant grade id →
   `404`; flagging twice → one audit row, no re-stamp.

## S2 — `IMPROVEMENT` celebratory alert
1. Seed/enter a student's grades in one subject so the running average **rises ≥ +1.5 /20** over the
   last 3 published evaluations (e.g. 8 → 11 → 13 /20).
2. **As admin**, enable the `IMPROVEMENT` rule → **Lancer l'évaluation**.
3. **As the parent**, the bell shows a **green / encouraging** *"Progrès en {matière} 🎉"* alert
   (severity *low*), with the actual point gain and a "félicitez votre enfant" recommendation,
   deep-linking to the subject. No other child is named.
4. Negative checks: a flat or **falling** series produces **nothing**; fewer than 3 published grades
   produces nothing; the alert is deduped within 7 days.

## S3 — Admin rule-config UI
1. **As admin**, `/admin/alerts` → Règles → **« Configurer »** on a rule.
2. Edit a threshold (e.g. `LOW_SUBJECT_AVG.threshold` 10 → 12), the **severity**, the period
   (`HIGH_ABSENCE.windowDays`), toggle **enabled**, and save.
3. Verify the values round-trip (reload shows the new values) and the **next** evaluation pass uses
   them (e.g. raising the low-average threshold surfaces more/fewer alerts as expected).
4. The "UI seulement" badge is **gone** for the now-7 implemented rules. A parent/teacher token
   calling the PATCH → `403`.

## S4 — Email on the cron path
1. **As a parent**, in settings → preferences, opt **in** to email for the **alert** kind
   (`NotificationPreference(alert, emailEnabled=true)`).
2. Let the **cron** (or "Lancer l'évaluation" then wait for the cron parity path) raise a new alert
   for that parent's child.
3. Verify an email is delivered (Maildev / `notifications-email` processor logs) reusing the shared
   alert email template, and that a parent who did **not** opt in gets **in-app only**.
4. Confirm **no new BullMQ queue** appears and the `alerts-evaluator.service.ts` "in-app only"
   comment is removed.

## Definition of done (per slice)
- `pnpm typecheck` green (Murat); `git diff --check` clean.
- For S1: `prisma generate` + `db push` applied; the additive `Grade` flag fields exist.
- All AC for the slice (see [`tasks.md`](./tasks.md)) pass; byte-parity evaluator pair verified for
  S1/S2; audit + tenant invariants hold; copy is explainable + non-stigmatising.
