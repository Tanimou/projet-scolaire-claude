# E3 — Complete the Alert Engine (7 rules + admin config + email) · spec

> **Epic spec-kit.** Written on E3's **epic-spec run** (BMAD spec-driven). Author: John (PM)
> + Winston (Architect — `data-model.md` + `contracts/openapi.yaml`). Implemented **one vertical
> slice per run** from [`tasks.md`](./tasks.md). Predecessors: **E1 — Parent Alert Action Loop**
> (`shipped`) and **E2 — Parent ↔ Teacher Messaging** (`shipped`).
>
> **Status: `proposed` → in-progress on S1.** The alert engine is the **cahier's beating heart** —
> "turn information into action" starts with the alert that *raises* the action. Today **5 of the
> 7 reserved rules are live**; this epic finishes the remaining two, hands admins real
> threshold/severity control, and makes the **cron path email** parents (today it only rings the
> in-app bell).

---

## 1. Vision (one paragraph)

The alert engine is what makes Pilotage **decision-oriented** instead of a passive gradebook: it
watches every published grade and absence, and — when a rule trips — it raises an **explainable,
kind, actionable** alert that drives the parent's next step (E1) and, increasingly, a conversation
(E2). Today the engine is **58% complete**: 5 of 7 rules evaluate in both the API and the worker,
a 15-minute cron fans out in-app notifications, and an admin screen lists the rules — but **two
rule codes are unwired stubs**, the admin can only toggle rules (not tune their thresholds), and
**cron-detected alerts never reach a parent's inbox by email**. E3 closes all three gaps. The
headline move is a deliberate **rebalancing of the engine's tone**: instead of bolting on a
seventh *negative* rule, S2 ships a **non-stigmatising positive signal — `IMPROVEMENT`** — that
fires when a child *recovers* in a subject, turning the alert bell into **both a warning and an
encouragement channel**. A parent who opens the bell now sees not only "watch this" but
"celebrate this" — directly answering the cahier's dashboard question *"which subjects are
improving?"* and reinforcing the platform's explicitly-required factual, encouraging voice.

## 2. Why (ties to the cahier de charges)

- The cahier specifies **7 explainable alert rules** as a core MVP pillar (R6). The codebase
  already **reserves all 7 codes** (`AlertRuleCode` enum, `RULE_CODES`, `RULE_DEFAULTS`) but
  `AlertsService.RULE_FN` (and the worker's mirror) leave `TEACHER_COMMENT_FLAG` and
  `BEHAVIOR_ALERT` as **explicit stubs** — the engine is literally 5/7. E3 makes it 7/7.
- **Every alert must be explainable** — rule + subject + threshold + trend + suggested action. The
  two new rules ship with the same explainable body + recommendation contract as the live five.
- **Admin-configurable thresholds** are a cahier requirement (per-school tuning of what counts as
  "low", "too many absences", etc.). The `PATCH /alerts/rules/:code` endpoint + `parameters` JSONB
  already exist; the **threshold/severity editing UI is partial** ("UI seulement" badge, toggle
  only). E3-S3 finishes it.
- **Email the parent** — the cahier's notification promise is *"parent email on published grades /
  alerts / absences"*. The API "Evaluate now" path already emails (via `NotificationsService`),
  but the **worker cron path is in-app only** (documented asymmetry in `alerts-evaluator.service.ts`).
  E3-S4 removes the asymmetry so a parent who opted in is emailed regardless of *which* path raised
  the alert.
- **Non-stigmatising, kind tone** is non-negotiable (children's data). The visionary `IMPROVEMENT`
  rule (S2) is the clearest expression of that principle in the whole engine — a green, celebratory
  alert — and it ships **without collecting any new disciplinary/behavioural data** (it reads the
  same published grades the other rules read), which is also the **RGPD minimal-data** choice.

## 3. Users & roles

| Actor | Auth | Can do |
|---|---|---|
| **Teacher** | realm role `teacher`, owns the grade (`Grade.enteredBy` / teaches the assignment) | **Flag / unflag** a published grade as *concerning* (S1) — a lightweight, explicit teacher signal that feeds `TEACHER_COMMENT_FLAG`. No new free-text; the flag rides the grade the teacher already owns. |
| **Parent** | authenticated, holds an **active `Guardianship`** on the child | Receives the new alerts **in-app** (bell) and, if opted in, **by email** (S4). Sees the celebratory `IMPROVEMENT` win (S2) and the teacher-flag concern (S1) on the existing recommendations surface, each explainable + actionable via the E1 loop. |
| **School-admin / super-admin** | realm role `school_admin` / `super_admin`, holds `alerts.write` | **Tune every rule**: enable/disable, set severity, edit thresholds/periods, and toggle notification — per-school — through a real config UI (S3), over the existing `AlertRule` endpoints. |

**ABAC / tenancy invariant (unchanged across the epic).** Every rule evaluator, every flag write,
and every email dispatch is **`tenant_id`-scoped** (RLS, ADR-002); parent reads stay behind
`StudentAccessService` guardianship (E1); teacher flag writes are gated by ownership of the grade's
teaching assignment; admin config writes keep the existing `alerts.write` permission. No new
cross-tenant surface is introduced.

## 4. Primary scenarios

**Scenario A — Teacher flags a concerning grade → parent alerted (S1).**
1. A teacher, entering or reviewing grades in the gradebook, marks one published grade as
   *« à signaler »* (a flag toggle on the grade row — the teacher already owns this grade).
2. On the next evaluation pass (cron or "Evaluate now"), the `TEACHER_COMMENT_FLAG` evaluator
   (live in **both** api + worker, byte-parity) picks up flagged grades for students with an
   enabled rule and raises **one explainable alert** ("Signalement enseignant en {matière}",
   body = the teacher's concern context, recommendation = contact the teacher).
3. The guardian is notified in-app (and by email if opted in — S4). The teacher can **unflag**;
   the open alert is deduped and can be resolved/dismissed via the E1 lifecycle.

**Scenario B — A child recovers → a celebratory `IMPROVEMENT` alert (S2, the visionary hook).**
1. A student's running average in a subject **rises by ≥ `delta` points (default +1.5 /20)** across
   the last `windowAssessments` (default 3) consecutive **published** grades.
2. The `IMPROVEMENT` evaluator (byte-parity api + worker, the mirror image of `NEGATIVE_TREND`)
   raises a **`severity: low`, green, encouraging** alert: *"Progrès en {matière} 🎉 — +{drop} pts
   sur les 3 dernières évaluations"*, recommendation = *"Félicitez votre enfant et encouragez à
   maintenir l'effort"*, deep-linking to the subject view.
3. The parent's bell now carries a **win**, not only warnings. The alert is explainable (rule +
   subject + threshold + the actual point gain) and never compares the child to peers.

**Scenario C — Admin tunes a rule per-school (S3).**
1. An admin opens `/admin/alerts` → Règles → a rule card now has an **« Configurer »** affordance.
2. They edit the **threshold/period parameters** (typed per rule code), the **severity**, and the
   **enabled** flag, then save → `PATCH /api/v1/alerts/rules/:code` (existing endpoint) persists to
   the `parameters` JSONB + `severity` columns, scoped to their school.
3. The next evaluation pass uses the new values immediately (evaluators read `rule.parameters`
   defensively, already clamped). The "UI seulement" badge is gone for the now-implemented rules.

**Scenario D — Cron-raised alert emails the guardian (S4).**
1. The 15-minute cron detects a new alert for a student whose guardian has **opted in** to email
   for the `alert` notification kind (`NotificationPreference(alert, emailEnabled=true)`).
2. The worker dispatches the email **reusing the shared `notifications-email` template/processor**
   (the same one the API path and E1-S4 digest use), honoring the preference; opt-out / default-off
   guardians get in-app only, exactly as today.
3. No new BullMQ queue, no new email template — the cron path and the API path now have **identical
   delivery semantics**.

## 5. Acceptance criteria (epic-level — sliced in `tasks.md`)

1. **7/7 rules evaluate.** After E3, `RULE_FN` in **both** `apps/api/.../alerts.service.ts` and
   `apps/worker/.../alerts-evaluator.service.ts` maps **all seven** `AlertRuleCode` values to a
   real evaluator (no stubs). The two new evaluators are **byte-parity** across api + worker (the
   established duplication convention until a `@pilotage/alerts-core` package exists) and produce
   the same `DetectedAlert` shape (explainable `title`/`body`/`recommendation`/`context`).
2. **`TEACHER_COMMENT_FLAG` is backed by a real, minimal teacher write surface (S1).** A teacher can
   flag/unflag a grade they own; the flag is **additive** to `schema.prisma` (a small field/relation
   on `Grade` — see [`data-model.md`](./data-model.md), `db push`, no SQL `migrations/` folder); the
   evaluator reads only flagged, **published** grades and respects `tenant_id` + the active academic
   year; a non-owner teacher flagging → **403**; cross-tenant grade id → **404**.
3. **The 7th rule is the non-stigmatising `IMPROVEMENT` positive signal (S2).** It reuses the
   existing published-grade data (no new disciplinary/behavioural data collected — RGPD minimal),
   fires **only on a genuine upward trend** (`lastHalfAvg − firstHalfAvg ≥ delta`, the inverse of
   `NEGATIVE_TREND`, with the same defensive parameter clamping), defaults to `severity: low`, and
   its copy is **celebratory and never comparative**. *(Decision: `BEHAVIOR_ALERT` would require a
   net-new disciplinary-data model + teacher capture surface — heavier, stigmatising, and against
   minimal-data; E3 ships `IMPROVEMENT` instead. The `BEHAVIOR_ALERT` enum code is **left reserved
   but unwired**, documented as a deliberate non-goal — see §6 + `plan.md` §ADR.)*
4. **Admin rule-config UI complete (S3).** For every rule code the admin can edit **enabled +
   severity + the rule's typed threshold/period parameters** and save over the existing
   `PATCH /alerts/rules/:code`; values round-trip and take effect on the next pass; the per-rule
   "UI seulement / non implémenté" badge is removed for the now-7 implemented rules. No new endpoint
   is required (the API already exists); if a per-parameter validation contract is added it lives in
   `packages/contracts` and is shared FE/BE.
5. **Cron path emails honoring prefs (S4).** A cron-detected alert emails each guardian who has
   `NotificationPreference(alert, emailEnabled=true)`, **reusing** the shared `notifications-email`
   processor/template (no new queue, no new template), default OFF (RGPD). In-app fan-out is
   unchanged; email is strictly additive. The "in-app only" asymmetry note in
   `alerts-evaluator.service.ts` is removed once delivered.
6. **Explainability preserved.** Every alert the two new rules raise states **rule + subject +
   threshold + trend/flag + suggested action**, and never names another child or compares to peers.
7. **Tenant + audit invariants** on every backend change: every query `tenant_id`-scoped; the teacher
   flag toggle writes an **append-only `AuditLog`** row (`grade.flag` / `grade.unflag`); admin rule
   edits keep their existing audit/permission path; no email leaks across tenants; the alert
   dedup-window logic (7 days, `(rule, student, subject?)`) is reused unchanged for both new rules.
8. **Reuse-first.** `@pilotage/ui` primitives for the config UI; the existing `RuleContext` /
   `DetectedAlert` evaluator contract; the existing `NotificationsService.createMany` fan-out + the
   shared `notifications-email` pipeline; `packages/contracts` for any shared rule-parameter type;
   the existing admin `/admin/alerts` page (extend, don't replace).
9. **Gates.** `pnpm typecheck` passes (Murat); no `git diff --check` errors; `prisma generate` +
   `db push` is the documented pre-merge step for S1's additive field; **any new architectural
   decision → a new `docs/adr/` ADR** (one candidate flagged in `plan.md` §ADR — the worker email
   dispatch path).

## 6. Non-goals (explicitly out of E3)

- ❌ **`BEHAVIOR_ALERT` as a negative disciplinary rule.** Wiring it would require a **new
  disciplinary-incident model + a teacher capture surface** (no such data exists in the schema
  today) — heavier than a slice, stigmatising, and against RGPD minimal-data. E3 ships the
  positive `IMPROVEMENT` rule as the 7th instead; the `BEHAVIOR_ALERT` code stays **reserved but
  unwired** (a future epic may revisit it with a proper consent + data-governance design). See
  `plan.md` §ADR.
- ❌ **Free-text teacher concern messages on the flag.** S1's flag is a **boolean signal** on a grade
  the teacher already owns (optionally reusing the grade's existing `comment`), **not** a new
  messaging surface — parent↔teacher conversation is E2's job, and the alert's recommendation
  deep-links into it.
- ❌ **Event-driven (real-time) re-evaluation** on `grade.publish` / `attendance.batch`. The engine
  stays on the existing 15-min cron + "Evaluate now" button; an outbox/queue trigger is a separate
  architectural change (noted in the code as future work) — **out of E3**.
- ❌ **A new BullMQ queue or a new email template for S4.** Email reuse is mandatory; introducing a
  bespoke alert-email queue/template is explicitly disallowed.
- ❌ **`@pilotage/alerts-core` extraction.** The api/worker evaluator duplication (byte-parity)
  stays as-is; folding both into a shared package is deferred (the code comment already commits to
  "once a third caller appears") — **out of E3** to keep slices thin.
- ❌ **Push / SMS channels.** S4 adds **email** on the cron path only; push/SMS remain stubs (E5).
- ❌ **Reworking the 5 live rules' logic or the dedup window.** E3 only *adds* rules + config + email;
  it does not change `LOW_SUBJECT_AVG`, `HIGH_ABSENCE`, `REPEATED_FAILURE`, `NEGATIVE_TREND`,
  `MISSING_ASSESSMENT`, or the 7-day dedup behavior.
- ❌ **Analytics pre-computation / snapshots** for the new rules (E6 territory) — the evaluators read
  live grade data like their siblings.
