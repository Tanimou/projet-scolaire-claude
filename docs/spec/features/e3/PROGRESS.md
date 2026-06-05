# E3 — Progress log

> One row per slice. The routine updates this on Land (tick `tasks.md`, this file, and the roadmap
> E3 entry). Status legend: `not-started` ▸ `in-progress` ▸ `shipped` ▸ `blocked`.

**Epic status:** `shipped` (spec-kit landed; **S1 + S2 + S3 + S4 all shipped — engine 7/7 wired,
admin rule-config UI live, and the cron path now emails at parity with the API path**). All four
slices have landed; advance to **E4 — Async Exports & Bulletins**.

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
| S2 | 7th rule = `IMPROVEMENT` (positive signal) + evaluator | **shipped** | _(this run — needs human review)_ | additive `IMPROVEMENT` `AlertRuleCode` enum value (`db push`) threaded through schema + contracts `ALERT_RULE_CODE` + api/worker `RULE_FN`/`RULE_CODES`/`RULE_DEFAULTS` + all FE `Record<AlertCode,…>` maps + i18n EN/FR; byte-parity `evaluateImprovement` (md5 `a897bd58…`) in api + worker — inverted `NEGATIVE_TREND`, fires only on `lastHalfAvg − firstHalfAvg ≥ delta`, defaults 1.5 pts / 3 evals, defensive param clamp (delta>0, window≥2), reads only published grades. `severity: low`, auto-seeds `enabled: false` per tenant. Code-aware **emerald celebration lane** on `/parent/recommendations` (keys on `code === 'IMPROVEMENT'`, not the `low` bucket; PartyPopper/TrendingUp + `StatusBadge tone="success"`) + emerald rule chip on `/admin/alerts`. **Engine 7/7 wired.** `[schema][alert-engine]` P1. |
| S3 | Admin rule-config UI (threshold/severity/period/notify) | **shipped** | _(this run — needs human review)_ | per-rule "Configurer" `FormDrawer` (`RuleConfigEditor.tsx`) over the existing `PATCH /alerts/rules/:code` via new `updateRuleConfigAction` — toggle `enabled`, pick `severity` (role=radiogroup, roving tabindex; **locked to `low` for `IMPROVEMENT`** to preserve the non-stigmatising contract), edit each rule's numeric params with client validation (`validateField`) mirroring the evaluator clamps (UX guard only — server still authoritative). `RULE_PARAM_FIELDS`/`SEVERITY_OPTIONS`/`POSITIVE_RULE_CODES` descriptors in `types.ts` mirror api `RULE_DEFAULTS` key-for-key; editor submits the **COMPLETE** parameters object (server replaces JSONB wholesale, no deep-merge → partial would drop siblings). **No new endpoint, no schema, no migration, no auth surface** (`PATCH` gated server-side by `@RequiresPermission('alerts.write')` + `ParseEnumPipe(RULE_CODES)` + JWT tenant/school scoping). Also hardened the **shared `packages/ui` Drawer** primitive: WCAG 2.1.2 focus-trap (Tab/Shift+Tab cycle) + 2.4.3 focus restore-to-trigger on close, keyed on `[open]` only (`onCloseRef`) so controlled inputs stay typeable across **all** Drawer/FormDrawer consumers (audit/enrollments/calendar). RED typecheck gate (2× TS18048 in `Drawer.tsx` + 2× TS2345 in `RuleConfigEditor.tsx`, all `noUncheckedIndexedAccess` narrowing) fixed in-flight. `[ui][a11y][shared-primitive]` P1. |
| S4 | Email on the cron path (parity with API path) | **shipped** | _(this run — needs human review)_ | The worker cron evaluator now **enqueues the same `notifications-email` BullMQ job** the API producer enqueues (path A from `plan.md` §ADR — **no ADR needed**, reuses the established producer/consumer pattern; no new queue, no new template). After creating an `AlertInstance` + in-app `Notification`, `notifyGuardiansOfAlert` resolves the **freshly source-deduped** recipients and calls new `dispatchAlertEmails`: gated by `NotificationPreference(alert, emailEnabled=true)` (default OFF / RGPD), tenant-scoped pref + `userProfile` lookups (no cross-tenant recipient), `kind:'alert'` job with the same `attempts:3` / exponential backoff / `removeOnComplete|Fail` opts as the API's `dispatchEmails`. Email is **strictly additive + best-effort** (a Redis/SMTP hiccup is swallowed; in-app fan-out + the `AlertInstance` are untouched). `AlertsCronModule` now imports `QueueModule` to `@InjectQueue(QUEUE_NOTIFICATIONS_EMAIL)`. The **"SCOPE — IN-APP ONLY" asymmetry comment removed**. No double-send (alert deduped 7 days + recipients source-deduped). `[worker]` P1. |

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
