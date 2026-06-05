# E3 — Progress log

> One row per slice. The routine updates this on Land (tick `tasks.md`, this file, and the roadmap
> E3 entry). Status legend: `not-started` ▸ `in-progress` ▸ `shipped` ▸ `blocked`.

**Epic status:** `in-progress` (spec-kit landed; **S1 shipped**). Next run → **epic-slice S2** (7th
rule = `IMPROVEMENT`, a non-stigmatising positive signal — mirror of `NEGATIVE_TREND`, inverted).

**Audit baseline (2026-06-05):** alert engine **58%** — 5/7 rules live
(`LOW_SUBJECT_AVG`, `HIGH_ABSENCE`, `REPEATED_FAILURE`, `NEGATIVE_TREND`, `MISSING_ASSESSMENT`) in
**both** api + worker; 15-min cron with in-app fan-out; admin can toggle rules but not tune
thresholds via UI; cron path is **in-app only** (no email). `TEACHER_COMMENT_FLAG` +
`BEHAVIOR_ALERT` are reserved enum codes but **unwired stubs** in both `RULE_FN` maps; no backing
data model for either.

| Slice | Title | Status | PR | Notes |
|---|---|---|---|---|
| Spec | E3 epic-spec kit | **shipped** | _(this run)_ | spec/plan/data-model/contracts/tasks/quickstart/PROGRESS authored; docs only, no code. |
| S1 | `TEACHER_COMMENT_FLAG` flag + dual evaluator | **shipped** | _(this run — needs human review)_ | additive `Grade` flag fields `isFlagged`/`flaggedAt`/`flaggedBy`/`flagNote` (`db push`) + `@@index([tenantId, isFlagged])`; `PATCH /grades/:id/flag` (ownership ABAC, 404-before-403, idempotent, append-only `grade.flag`/`grade.unflag`); byte-parity `evaluateTeacherCommentFlag` in api + worker `RULE_FN`; teacher gradebook flag toggle; "non implémenté" badge removed on `/admin/alerts`. **Engine 6/7.** `[schema][auth]` P1. |
| S2 | 7th rule = `IMPROVEMENT` (positive signal) + evaluator | not-started | — | mirror of `NEGATIVE_TREND`, inverted; `severity: low`; no new data (RGPD minimal). `BEHAVIOR_ALERT` left reserved-but-unwired (spec §6). |
| S3 | Admin rule-config UI (threshold/severity/period/notify) | not-started | — | over the existing `PATCH /alerts/rules/:code`; no new endpoint. `[web]`. |
| S4 | Email on the cron path (parity with API path) | not-started | — | reuse `notifications-email` (no new queue/template); honor `NotificationPreference(alert, emailEnabled)`. `[worker]`. |

## Key decisions (carried into implementation)
1. **7th rule = `IMPROVEMENT`, not `BEHAVIOR_ALERT`.** Wiring `BEHAVIOR_ALERT` needs a net-new
   disciplinary-data model + capture surface (none exists), is stigmatising, and breaks RGPD
   minimal-data. `IMPROVEMENT` reuses existing published grades, balances the engine's tone, and
   answers the cahier's "which subjects are improving?". `BEHAVIOR_ALERT` stays reserved-but-unwired.
2. **Only schema change in the epic = S1's additive `Grade` flag field** (`isFlagged`/`flaggedAt`/
   `flaggedBy`/optional `flagNote`). Everything else is behavioural/UI. `db push`, no SQL migrations.
3. **byte-parity evaluators** stay duplicated across api + worker (the established convention) — no
   `@pilotage/alerts-core` extraction in E3.
4. **S4 prefers reusing the existing `notifications-email` queue producer** (no new queue/template).
   Only a direct-`MailerService` fallback would require **ADR-020** (see `plan.md` §ADR).
5. **No event-driven re-eval** in E3 — the 15-min cron + "Evaluate now" path stays the trigger.

## Open questions / follow-ups (not blocking)
- Whether S2 adds `IMPROVEMENT` as an 8th enum value (preferred, additive) or re-purposes the
  `BEHAVIOR_ALERT` slot — decided at S2 implementation, recorded in `stories/S2-*.md`.
- Whether S1's optional reason reuses `Grade.comment` or adds `flagNote` — implementer's call,
  recorded in `stories/S1-*.md`. Either way: no new messaging surface (spec §6).
