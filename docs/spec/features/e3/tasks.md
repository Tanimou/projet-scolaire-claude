# E3 — Vertical-slice backlog (ORDERED)

> Each slice = ONE capability a teacher/admin/parent can now *do*, demoable end-to-end (DB + API +
> UI + worker as needed), landing as ONE PR + ONE build, **≤ a day of focused work**. The routine
> implements them **top to bottom**, one per run. On Land: tick here, update
> [`PROGRESS.md`](./PROGRESS.md), and the roadmap E3 entry. When all ship → epic `status: shipped`,
> advance to E4.
>
> A self-contained `story` spec (John, BMAD PM) is authored under `stories/S<n>-*.md` on each slice
> run (mirrors E1/E2's `stories/`).

---

## [ ] S1 — `TEACHER_COMMENT_FLAG`: teacher grade-flag + dual evaluator · `[schema][auth]` · ~M

**Capability:** a teacher flags a published grade as *« à signaler »*; on the next evaluation pass
the `TEACHER_COMMENT_FLAG` rule raises one explainable alert to the guardian. **The engine goes 6/7.**

- **DB (`[schema]`):** additive `Grade` fields `isFlagged Boolean @default(false)`, `flaggedAt`,
  `flaggedBy String? @db.Uuid`, optional `flagNote` (or reuse `comment`) + `@@index([tenantId,
  isFlagged])`. `prisma db push` (no SQL `migrations/`). See [`data-model.md`](./data-model.md) §1.
- **API:** `PATCH /api/v1/grades/:id/flag` (`{ flagged, note? }`) on the existing grades controller —
  ownership ABAC (caller entered/teaches the grade) → 403 non-owner, 404 cross-tenant; idempotent;
  append-only `AuditLog` (`grade.flag` / `grade.unflag`). Add `evaluateTeacherCommentFlag` to
  `apps/api/.../alerts/rules/` and register it in `AlertsService.RULE_FN`.
- **Worker:** **byte-parity** `teacher-comment-flag.rule.ts` under `apps/worker/.../alerts-rules/`,
  register in the worker `RULE_FN`. (Reviewer diffs the api/worker pair.)
- **UI:** a flag toggle on the teacher gradebook grade row (`@pilotage/ui`); **remove the "UI
  seulement / non implémenté" badge** for `TEACHER_COMMENT_FLAG` on `/admin/alerts`.
- **Tests (Murat):** flag ABAC (403 non-owner, 404 cross-tenant), idempotent flag/unflag + single
  audit row, evaluator reads only flagged+published grades, tenant isolation, dedup window. P1.
- **AC:** spec §5 AC1 (partial — one of two), AC2, AC6, AC7, AC8, AC9.

## [ ] S2 — 7th rule = `IMPROVEMENT` (non-stigmatising positive signal) + dual evaluator · `[rules]` · ~S-M

**Capability:** when a child *recovers* ≥ +1.5 pts over 3 consecutive published grades in a subject,
a **green, celebratory** alert appears in the parent's bell. **The engine goes 7/7** and the bell
becomes a warning **and** an encouragement channel (the cahier's "which subjects are improving?").

- **DB:** none (reads existing published grades). Add `IMPROVEMENT` to the `AlertRuleCode` enum
  (preferred — additive `db push`) + `ALERT_RULE_CODE` + `RULE_CODES`/`RULE_DEFAULTS`
  (`{ delta: 1.5, windowAssessments: 3 }`, `severity: 'low'`); OR re-purpose the `BEHAVIOR_ALERT`
  slot (no schema). See [`data-model.md`](./data-model.md) §2. `BEHAVIOR_ALERT` stays unwired.
- **API:** `evaluateImprovement` (mirror of `negative-trend.rule.ts`, **inverted** comparison +
  same defensive clamp) in `apps/api/.../alerts/rules/`; register in `RULE_FN`. Celebratory copy,
  recommendation "Félicitez votre enfant…", deep-link to the subject view; never comparative.
- **Worker:** byte-parity `improvement.rule.ts` + worker `RULE_FN`.
- **UI:** drop the "UI seulement" badge for the 7th rule; **green / encouraging styling** for `low`/
  improvement alerts on the parent recommendations surface (distinct from warning tones).
- **Tests:** fires only on a genuine upward trend; flat/falling series → nothing; partial window →
  nothing; clamp on bad params; severity low; dedup. Same fixture through api + worker. P2.
- **AC:** spec §5 AC1 (complete — 7/7), AC3, AC6, AC8, AC9.

## [ ] S3 — Admin rule-config UI (threshold / severity / period / notify) · `[web]` · ~M

**Capability:** an admin edits a rule's **thresholds, severity, period, and enabled** state per
school through a real editor — over the **existing** `PATCH /alerts/rules/:code` (no new endpoint).

- **DB / API:** none new — reuse `GET /alerts/rules` + `PATCH /alerts/rules/:code`. OPTIONAL: a
  shared per-rule parameter validation schema in `packages/contracts` (typed inputs + ranges) used
  FE-side as a UX guard (evaluators already clamp server-side — not a security boundary).
- **UI:** extend `apps/web/src/app/admin/alerts/*` — a per-rule **« Configurer »** editor (dialog/
  sheet from `@pilotage/ui`) with typed fields per code (e.g. `threshold` for `LOW_SUBJECT_AVG`,
  `delta`+`windowAssessments` for `NEGATIVE_TREND`/`IMPROVEMENT`, `count`+`windowDays` for
  `HIGH_ABSENCE`), a severity selector, an enable toggle, and a save action (`actions.ts`). Mobile-
  first, WCAG 2.2 AA. Optimistic-or-revalidate, error toast on failure.
- **Tests:** params round-trip through PATCH; severity change persists; invalid input blocked client-
  side; admin-only (parent/teacher token → 403 on the write). P2.
- **AC:** spec §5 AC4, AC8, AC9.

## [ ] S4 — Email on the cron path (parity with the API path) · `[worker]` · ~S-M

**Capability:** a cron-detected alert **emails** each guardian who opted in
(`NotificationPreference(alert, emailEnabled)`), removing today's "in-app only" asymmetry — same
template, same prefs, no new queue.

- **DB / UI:** none (the email opt-in row already ships via the shared `PreferencesPanel` — E1-S4/
  E2-S4). 
- **Worker:** after creating an `AlertInstance` + in-app `Notification`, resolve opted-in guardians
  and dispatch email **reusing the `notifications-email` template/processor**. **Preferred:** the
  worker **enqueues the same `notifications-email` job** the API producer enqueues (no new queue, no
  template, identical retry/backoff) — likely **no ADR**. **Fallback only:** direct `MailerService`
  send (as parent-digest does) ⇒ **ADR-020** (see [`plan.md`](./plan.md) §ADR). Remove the
  "SCOPE — IN-APP ONLY" asymmetry comment in `alerts-evaluator.service.ts` once delivered.
- **Tests:** email sent iff `NotificationPreference(alert, emailEnabled=true)`; default OFF → in-app
  only; no cross-tenant recipient; no double-send (alert already deduped 7 days); in-app fan-out
  unchanged. P1.
- **AC:** spec §5 AC5, AC6, AC7, AC8, AC9.

---

## Cross-slice invariants (every slice)
- `tenant_id` on every model + `where: { tenantId }` on every query; cross-tenant id → 404.
- Append-only audit rows on the flag/unflag write; admin config keeps its existing audit/permission
  path; no email leaks across tenants.
- **byte-parity** evaluators in `apps/api/.../alerts/rules/` and `apps/worker/.../alerts-rules/`
  (reviewer diffs the pair) until a `@pilotage/alerts-core` package exists (out of E3).
- Reuse the existing `RuleContext`/`DetectedAlert` contract, `AlertInstance` persistence + 7-day
  dedup, `NotificationsService.createMany` fan-out, the `notifications-email` pipeline,
  `@pilotage/ui`, and `packages/contracts` for shared types.
- Every new alert is **explainable** (rule + subject + threshold + trend/flag + action) and **never
  comparative** (no other child named).
- **No new BullMQ queue, no new email template, no event-driven re-eval, no `BEHAVIOR_ALERT`
  disciplinary model** (spec §6 non-goals).
- `pnpm typecheck` green (Murat); `prisma generate` + `db push` is the documented pre-merge step for
  S1's additive field (and S2's enum value if the preferred option ships).
