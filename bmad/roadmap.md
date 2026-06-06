# Product Roadmap — medium-to-large epics

> **What this file is.** The **ambition compass** for the Daily-Improvement routine.
> It is the prioritized backlog of **medium-to-large, meaningful epics** derived from
> the cahier de charges (`~/Downloads/rapport_pilotage_scolaire_detaille.pdf`) and the
> 2026-06-04 codebase audit. The routine builds the platform toward the cahier's core
> promise — **a parent dashboard that turns information into action** — one epic at a
> time, **one vertical slice per run**. This is NOT a polish list; polish is the fallback.
>
> **How Victor (Product Strategist) uses it each run:**
> 1. Pick the **current epic** = the highest-priority epic whose `status` is `in-progress`,
>    else the highest `next`, else promote a `proposed` one.
> 2. Choose the **mode**: no `docs/spec/features/<id>/spec.md` yet → **epic-spec** (write the
>    spec-kit this run); spec exists + unstarted slices in its `tasks.md` → **epic-slice**
>    (ship the next slice); nothing epic-ready → **polish**.
> 3. A **slice** = one capability a parent/teacher can now *do*, demoable end-to-end
>    (DB + API + UI + worker), fitting ONE PR + ONE build. If too big, split in `tasks.md`.
> 4. On Land: tick the slice here, update `docs/spec/features/<id>/PROGRESS.md`, set the
>    epic `status`. When all slices ship → `status: shipped`, advance to the next epic.
>
> **Status legend:** `in-progress` ▸ `next` ▸ `proposed` ▸ `shipped` ▸ `parked`.
> Keep entries short; the detailed spec lives in each epic's `docs/spec/features/<id>/`.

**Current focus →** `E1 — Parent Alert Action Loop` is **shipped** (S1–S4 all landed; S1 in [PR #103](https://github.com/Tanimou/projet-scolaire-claude/pull/103) — parent ack/resolve/dismiss via guardianship ABAC; **S2** = the "What should I do?" panel with deterministic deep-link next-steps + an append-only, idempotent `alert.meeting_intent` CTA; **S3** = the `MeetingRequest` model promoting that intent into a queryable, role-scoped teacher/admin action center + in-app assignee notification; **S4** = the opt-in weekly parent digest worker cron + email-only `NotificationPreference`). **Next epic → `E2 — Parent ↔ Teacher Messaging`** is now **specced** (epic-spec kit landed at `docs/spec/features/e2/` — spec/plan/data-model/contracts/tasks/quickstart/PROGRESS); the next run should ship **E2-S1** (`epic-slice`: `Conversation` + `ConversationParticipant` + `ConversationMessage` models, dual-wall ABAC = guardianship ∩ teaching-assignment, create/send spine). The codebase was already past the roadmap's "epic-spec first" assumption for E1 (admin lifecycle endpoints + parent read shipped), so the E1 runs were **epic-slices**, not a spec run; the `docs/spec/features/e1/` spec-kit was backfilled one story per slice. **E2-S1 through E2-S4 are now shipped → `E2` is `shipped` (all 4 slices landed; S4 = moderation/safety: report + admin oversight + send rate-limit + opt-in email reusing the existing notification-email pipeline). Next epic → `E3 — Complete the Alert Engine` is now **in-progress** (spec-kit landed at `docs/spec/features/e3/`; **S1 + S2 shipped** — S1 `TEACHER_COMMENT_FLAG` grade-flag + dual byte-parity evaluator; **S2 `IMPROVEMENT`** = the 7th rule, a non-stigmatising positive signal mirroring `NEGATIVE_TREND` inverted, with a code-aware emerald celebration lane on the parent recommendations surface — **engine now 7/7 rules wired** (`BEHAVIOR_ALERT` stays reserved-but-unwired by design); **S3 shipped** = admin rule-config UI (per-rule "Configurer" `FormDrawer` over the existing `PATCH /alerts/rules/:code` — enabled/severity/numeric-params, complete-object wholesale PATCH, no new endpoint/schema; also hardened the shared `Drawer` primitive with a WCAG focus-trap + focus-restore-to-trigger); **S4 shipped** = email on the cron path — the worker evaluator enqueues the SAME `notifications-email` job the API producer enqueues (path A, no ADR, no new queue/template), gated by `NotificationPreference(alert, emailEnabled)` (default OFF/RGPD), tenant-scoped, freshly-deduped recipients, best-effort, removing the "in-app only" asymmetry. **`E3` is now `shipped` (all 4 slices landed). Next epic → `E4 — Async Exports & Bulletins`** is now **in-progress** (exports backend 100% done, FE being wired slice-by-slice; **S2 shipped** = the parent term-summary bulletin PDF on a NEW parent-permitted surface — `exports.execute.parent` (NEVER admin `exports.execute`), guardianship ABAC at enqueue, server-derived `classSectionId` from the child's own active enrollment, additive single-`studentId` generator narrowing, and a parent-narrowed `ParentExportJobDto` (top-level `termId`/`studentId`, no `errorMessage`/`fileUrl`) so the poll/download flow is contract-truthful; no schema change. **Note: the branch/slice label is desynced** — branch reads `e4-s1` but the diff ships **S2** — reconcile on land. **E4-S3 is now shipped** = teacher class grade-grid export from the gradebook — a NEW teacher-permitted surface (`exports.execute.teacher`, NEVER admin/parent), teaching-assignment ABAC at enqueue, server-derived `classSectionId`, reusing the `grades_xlsx` generator unchanged + the proven enqueue→poll→signed-download client pattern; no worker/queue/schema change. **`E4` is now `shipped` (S1 pre-epic + S2 + S3 all landed). Next epic → `E5 — Advanced Notifications`** is now **specced** (epic-spec kit landed at `docs/spec/features/e5/` — spec/plan/data-model/contracts/ux/tasks/quickstart/PROGRESS). The audit found the email dispatcher already wired end-to-end (the old "queue stub" line was stale), so the kit scopes **S1 as verify/harden** (not rebuild) and concentrates net-new ambition in **S2** (cross-kind daily digest + the one additive `NotificationPreference.cadence` field, the only schema change) and **S3** (dedicated parent/teacher prefs UI). Visionary spine = one per-kind **notification cadence** (`instant`/`daily_digest`/`off`) unifying dispatcher + digest + prefs UI; zero new queue/table/permission/`NotificationKind`; one ADR tripwire (a 2nd BullMQ queue) is a non-goal. **E5-S1 is now shipped** (`epic-slice`: verify/harden the email dispatcher — net-new worker-consumer spec + producer-edge API tests + a tenant-scoping hardening fix on `dispatchEmails`, no schema). **E5-S2 is now shipped** (`epic-slice` — P1 `[schema][worker]`: the one additive `NotificationCadence`/`cadence @default(instant)` schema change + `@@index([tenantId, cadence, emailEnabled])`, the platform-wide dispatcher rewritten onto the cadence-aware `inAppPlan`/`instantEmailKeys` gates, the matching `cadence:'instant'` filter on the worker alert-cron email path, and the net-new tenant-scoped, idempotent `notifications-digest` daily-digest cron mirroring `parent-digest/*`). **E5-S3 is now shipped** (`epic-slice` — P2 `[web][a11y][notifications][ui]`: the dedicated parent/teacher notification-preferences UI — a keyboard `CadenceSelect` radiogroup per per-event kind reusing the E3-S3 severity segmented-control pattern, a header "Tout mettre en sourdine" bulk-mute via the new `setCadenceForKindsAction` + inverse "Tout réactiver", cadence disabled-with-hint when email off, surfaced on both `/parent/settings` + `/teacher/settings` via the shared `PreferencesPanel` — no schema/endpoint/permission, no panel fork). **`E5` is now `shipped` (all 3 slices landed). **`E6` is now `in-progress` (epic-spec kit landed this run at `docs/spec/features/e6/`, docs-only): 3 materialised tenant-scoped read models (`student_subject_snapshot`/`student_global_snapshot`/`class_subject_distribution` — the draft's `school_kpi_snapshot` was dropped, servable from the class roll-up) + a durable `snapshot_recompute_trigger` dirty-queue drained by a cron poll (structural sibling of `alerts-cron`/`notifications-digest`, **no 2nd BullMQ queue**), enqueued best-effort on `GradePublished`/`GradeRevised`/coefficient change; reads stay byte-identical behind the existing `/api/v1/analytics/*` aggregate endpoints, **snapshot-first with fall-through-to-live** (a miss is never an error); visionary spine = a `freshness { source, computedAt, recomputing }` dashboard chip; one ADR tripwire on the S1 run (reconcile the number — `ADR-019` is taken). Next slice → `E6-S1` (`epic-slice`: snapshot+dirty-queue schema + worker recompute/drain spine + snapshot-first read switch on one aggregate endpoint, behind fall-through). **E6-S1 is now shipped** ([PR #125](https://github.com/Tanimou/projet-scolaire-claude/pull/125) — snapshot+dirty-queue schema + worker recompute/drain spine + best-effort publish trigger; zero read-path wiring; `ADR-019-analytics-snapshots`). **E6-S2 is now shipped** (`epic-slice` — P2 `[api][analytics][snapshot]`, needs human review): the parent dashboard's class-context (`classAverage`/`studentRank`/`classSize` + global `studentRank`/`classRankTotal`) now reads **snapshot-first** via `resolveParentClassContext` over the materialised `StudentGlobalSnapshot`/`StudentSubjectSnapshot`/`ClassSubjectDistribution` point-reads — collapsing the O(class × grades) live `grade.findMany` (the <2 s NFR win); the original live block is extracted **verbatim** into `computeParentClassContextLive` as the byte-identical fall-through (any snapshot miss/throw or open recompute trigger → live, never an error; all-or-nothing freshness gate). Additive optional `ParentDashboardResponse.freshness?: SnapshotFreshness` (reuses the S1 contract type; S4 wires the chip). Tenant-scoped on every snapshot/trigger query; ABAC + server-derived class scope unchanged; no schema/endpoint/controller/`@pilotage/ui` change. Next slice → `E6-S3` (`epic-slice`: admin & teacher snapshot reads + the `GradeRevised`/coefficient-change enqueue seams).** **E6-S4 is now shipped** (`epic-slice` — P2 `[web][a11y][analytics][ui]`): the visionary freshness chip — a new app-level `'use client'` `FreshnessChip` (`apps/web/src/components/freshness/FreshnessChip.tsx`) composed over the existing `@pilotage/ui` `Badge` + `formatRelativeTime` (reuse-first, no `packages/ui` change), rendering the three states (Recomputing → spinning "Recalcul en cours…" neutral; Fresh → success "À jour" + aria-hidden "il y a Xs" + optional "· N notes"; live → quiet neutral "À jour") **purely** from the additive `freshness` field, degrading to **no chip** when absent. Mounted on `/parent/dashboard` (S2 snapshot read), `/teacher/reports` + `/admin/analytics` (S3 live-served reads), each page adding the additive optional `freshness?` shape to its local response type. The only client interactivity is a ~30 s relative-time `setInterval` (cleared on unmount); the static `aria-label` (state word) keeps the `role=status`/`aria-live=polite` region from re-announcing the tick (aria-hidden suffix); `motion-reduce` spinner; kind FR copy. **apps/web only — no schema/endpoint/permission/contract/`@pilotage/ui` change.** Two known limitations recorded for S5/polish (Fresh-state hydration width not reserved → minor CLS; the reload-only live announcement on server-rendered surfaces). Next slice → `E6-S5` (`epic-slice` `[worker]`: idempotent full rebuild + sweep hardening — convergence after a missed event / fresh tenant, optional admin rebuild/status surface).**))).**

---

## Tier 1 — Close the core loop (information → action)

### E1 — Parent Alert Action Loop · `shipped` · ~M
**Why (incontournable):** the cahier's defining promise. Today parents *see* explainable
alerts but are **read-only** — they cannot act. This makes the dashboard actually actionable.
**Audit:** action loop ~65% (info visible, downstream actions missing). No schema change needed
(reuse `AlertInstance.status`), so low risk, high value.
**Vertical slices (ship in order):**
- [x] **S1** — Parent can **acknowledge / mark-handled / dismiss** an alert: parent-scoped
  ABAC endpoints (`PATCH /api/v1/alerts/:id/ack|resolve|dismiss` guarded by guardianship),
  status + audit (the append-only `AuditLog` row **is** the status history — no
  `alert_status_history` table was added), action buttons on the recommendations surface,
  bell retraction on resolve/dismiss. Shipped in [PR #103](https://github.com/Tanimou/projet-scolaire-claude/pull/103). *(api + web; [auth] tag)*
- [x] **S2** — **"What should I do?"** panel on the alert: expand recommendation into concrete
  next steps (reinforce subject → deep-link to the subject view; talk to teacher → CTA that
  opens E2 messaging once available, else a "request meeting" intent record). Shipped:
  `POST /api/v1/alerts/:id/meeting-intent` (guardianship ABAC, append-only idempotent
  `alert.meeting_intent` audit row, status-neutral) + pure `deriveAlertActions` deep-link
  derivation + the `AlertNextSteps` panel. *(web + small api; [auth] tag)*
- [x] **S3** — **Request a meeting / callback** intent: the S2 `alert.meeting_intent` audit row is
  promoted into a queryable `MeetingRequest` Prisma model (`@@unique([tenantId, alertId, requestedBy])`
  idempotency, server-resolved assignee), surfaced in role-scoped teacher/admin action-center pages
  (`GET /meeting-requests` + `PATCH /meeting-requests/:id/resolve` on dedicated `meeting_requests.read|write`
  permissions) + an in-app assignee notification. *(api + web; [schema][auth] tag — first migration of the epic)*
- [x] **S4** — **Weekly parent digest** (opt-in): worker job emails each guardian a 1-screen
  weekly summary (global trend, new alerts, upcoming assessments, recommended action), honoring
  `NotificationPreference`. Net-new UX that drives weekly engagement. Shipped (needs human review):
  additive `weekly_digest` `NotificationKind` (no new table — idempotency marker rides
  `Notification.sourceId`), email-only opt-in wired through the shared `PreferencesPanel`, and a new
  `apps/worker/src/modules/parent-digest/*` cron (structural parity with `AlertsCronService`).
  *(worker + api + prefs UI; [schema][auth] tag)*

### E2 — Parent ↔ Teacher Messaging (Conversations) · `shipped` · ~M-L
**Why:** unblocks parent→teacher contact (today only teacher→family announcements exist). The
natural target of E1's "message the teacher" action. Prepares the future Messagerie module.
**Audit:** messaging ~25%; no `Conversation` model yet.
**Spec-kit:** ✅ landed `docs/spec/features/e2/` (this run, epic-spec). Key decisions: dual-wall ABAC
(guardianship ∩ teaching-assignment, re-checked at create AND every send → lapsed teaching flips
thread to `read_only`); optional `Conversation.alertId` seed (alert-seeded threads, never widens
access); idempotent `@@unique([tenantId, parentId, teacherId, studentId])`; append-only messages;
reuse `NotificationsService.createMany` (no new queue); `messaging.read|write|moderate` perms;
real-time deferred (ADR-019 tripwire). **S1 + S2 shipped; next slice → S3.**
**Vertical slices (refined in `docs/spec/features/e2/tasks.md`):**
- [x] **S1** — `Conversation` + `ConversationParticipant` + `ConversationMessage` Prisma models
  (participants, thread, read receipts) + dual-wall ABAC: a parent may only open a thread with a
  teacher **currently** teaching their child (via `teaching_assignment` ∩ `guardianship`),
  re-checked at create AND every send (lapsed teaching → thread `read_only`). Parent-only create at
  the controller, `messaging.read|write` perms, append-only audit, idempotent
  `@@unique([tenantId, parentId, teacherId, studentId])`, additive `message` `NotificationKind`,
  parent compose surface. Shipped (needs human review — P1 `[schema][auth]`). *(schema [schema][auth] tag)*
- [x] **S2** — Parent `/parent/messages`: thread list + thread view + compose, notification on new
  message. Shipped (needs human review): 4 aggregate read/state endpoints (`GET /conversations`
  inbox + `:id` + `:id/messages` paged + `PATCH :id/read`), `alertContext` seed exposed end-to-end
  (re-checked, strict subset, null on mismatch), inbox/thread/`/new` UI, and the E1 `AlertNextSteps`
  CTA rewired to the alert-seeded thread (E1 `MeetingRequest` intent preserved). No schema. *(api + web)*
- [x] **S3** — Teacher inbox: parent conversations separated from announcements; reply + mark-read.
  Shipped (needs human review): a teacher `/teacher/conversations` inbox + thread view (paged history,
  reply composer, mark-read, alert-context header) that are thin clients over the already-walled S1/S2
  endpoints (`GET /conversations`, `:id`, `:id/messages`, `PATCH :id/read`, `POST :id/messages`); two
  in-app notification deep-links retargeted `/teacher/messages` → `/teacher/conversations`; a distinct
  "Conversations parents" sidebar item. No schema, no new endpoint, no controller/permission change —
  the teacher-side wall is the existing S2 participant + `teacherId = me` scoping (unchanged). *(api + web)*
- [x] **S4** — Moderation/safety: report, admin oversight, rate-limit, non-stigmatising guardrails;
  optional email channel. Shipped (needs human review): `ConversationReport` model + enum (`db push`);
  participant-scoped idempotent `POST /conversations/:id/report` (append-only `conversation.report`
  audit) + **admin-only** `GET /conversations/reports` (new `messaging.moderate` perm, school/super
  admin ONLY, append-only `conversation.moderation_read` audit); per-sender send rate-limit (≤20/60 s,
  counted on existing message rows → 429, no new table/queue); shared non-stigmatising
  `ReportThreadDialog` on both portals + admin `/admin/conversations` oversight page; **opt-in email
  on new message reusing the existing `notifications-email` processor** via `createMany.dispatchEmails`
  + `NotificationPreference(message, emailEnabled)` (default OFF, RGPD) — **zero worker code added**,
  no new BullMQ queue, no websocket. *(schema [schema][auth] tag)*

---

## Tier 2 — Complete the MVP pillars (R6/R7/R8)

### E3 — Complete the Alert Engine (7 rules + admin config + email) · `shipped` · ~M
**Audit:** 58% baseline (5/7 rules) → **100%**. **S1–S4 all shipped → all 7 rule slots wired** in both
api + worker (`LOW_SUBJECT_AVG`, `HIGH_ABSENCE`, `REPEATED_FAILURE`, `NEGATIVE_TREND`,
`MISSING_ASSESSMENT`, `TEACHER_COMMENT_FLAG`, `IMPROVEMENT`; `BEHAVIOR_ALERT` reserved-but-unwired by
design); cron every 15 min with in-app fan-out **AND** opt-in email (S4); admin rule-config UI live
(S3). **Epic complete → next epic: E4 — Async Exports & Bulletins.**
- [x] **S1** — `TEACHER_COMMENT_FLAG` rule: teacher can flag a grade/comment as concerning
  (additive `Grade` flag fields `isFlagged`/`flaggedAt`/`flaggedBy`/`flagNote` via `db push` +
  `@@index([tenantId, isFlagged])`) → `PATCH /grades/:id/flag` (ownership ABAC, 404-before-403,
  idempotent, append-only `grade.flag`/`grade.unflag`) → byte-parity `evaluateTeacherCommentFlag`
  evaluator in **both** api + worker. Teacher gradebook flag toggle; "non implémenté" badge removed
  on `/admin/alerts`. **Engine now 6/7.** Shipped (needs human review — P1 `[schema][auth]`). *(schema+rules)*
- [x] **S2** — 7th rule = `IMPROVEMENT` (positive signal) + evaluator: additive `IMPROVEMENT`
  `AlertRuleCode` enum value threaded through `schema.prisma` + contracts (`ALERT_RULE_CODE`) +
  api/worker `RULE_FN`/`RULE_DEFAULTS` + all FE `Record<AlertCode,…>` maps + i18n EN/FR; byte-parity
  `evaluateImprovement` in **both** api + worker (inverted `NEGATIVE_TREND`: fires only when
  `lastHalfAvg − firstHalfAvg ≥ delta` over the trailing window, defaults 1.5 pts / 3 evals,
  defensive param clamp); `severity: low`, reads only published grades (RGPD minimal-data), auto-seeds
  `enabled: false` per tenant. Code-aware **emerald celebration lane** on `/parent/recommendations`
  (override keys on `code === 'IMPROVEMENT'`, not the `low` bucket) + emerald rule chip on
  `/admin/alerts`. **Engine 7/7 wired** (`BEHAVIOR_ALERT` reserved-but-unwired by design). Shipped
  (needs human review — P1 `[schema][alert-engine]`). *(schema+rules)*
- [x] **S3** — Admin **rule-config UI**: per-rule "Configurer" `FormDrawer` over the existing
  `PATCH /alerts/rules/:code` — toggle `enabled`, pick `severity` (radiogroup, roving tabindex;
  locked to `low` for `IMPROVEMENT`), edit each rule's numeric params with client validation that
  mirrors the evaluator clamps. Submits the **COMPLETE** parameter object (server replaces the JSONB
  wholesale, no deep-merge). **No new endpoint, no schema, no migration.** Also hardened the shared
  `packages/ui` `Drawer` primitive: WCAG 2.1.2 focus-trap (Tab/Shift+Tab cycle) + 2.4.3 focus
  restore-to-trigger on close, keyed on `[open]` only (onClose held in a ref) so controlled inputs
  stay typeable across all Drawer/FormDrawer consumers. Shipped (needs human review — P1
  `[ui][a11y][shared-primitive]`; RED typecheck gate fixed in-flight). *(web + packages/ui)*
- [x] **S4** — **Email on the cron path**: cron-raised alerts email guardians honoring prefs
  (was in-app only) — shares the dispatcher with the API path. Shipped (needs human review): the
  worker evaluator now **enqueues the same `notifications-email` BullMQ job** the API producer enqueues
  (path A — no ADR; no new queue/template). `dispatchAlertEmails` gates on
  `NotificationPreference(alert, emailEnabled=true)` (default OFF / RGPD), tenant-scoped, runs only on
  the freshly source-deduped recipients (no double-send), with the API's exact retry/backoff opts;
  strictly additive + best-effort (a Redis/SMTP failure never touches the in-app fan-out). The
  "in-app only" asymmetry comment is removed. *(worker)* `[worker]` P1.

### E4 — Async Exports & Bulletins — wire the UI · `shipped` · ~S-M (high ROI)
**Audit:** exports backend is **100% done** (`ExportJob` + worker + 5 XLSX/PDF generators + S3 +
audit). Only the **frontend is unwired** ("Available soon").
- [ ] **S1** — Admin `/admin/exports`: real "generate" buttons → `ExportJob` + job-status polling +
  signed download links. *(web)*
- [x] **S2** — **Parent term-summary PDF**: one-click "download my child's report" → `report_card_pdf`
  job → download, audited. The cahier's "synthèse parent PDF par enfant et période." Shipped (needs
  human review — P1 `[auth][parent][exports][abac][rgpd]`): a NEW parent-permitted surface
  (`POST/GET /api/v1/parent/exports*` on the distinct `exports.execute.parent` permission — NEVER the
  admin `exports.execute`), guardianship ABAC re-checked at enqueue, server-derived (never
  client-supplied) `classSectionId` from the child's own active enrollment, additive single-`studentId`
  narrowing in the worker generator, and a parent-narrowed `ParentExportJobDto` (top-level
  `termId`/`studentId`, no `errorMessage`/`fileUrl`) so the poll/download flow is contract-truthful.
  No schema change. *(web + api + worker)*
- [x] **S3** — Teacher class grade-grid export from the gradebook. Shipped (needs
  human review — P1 `[auth][public-api][ui]`): a NEW teacher-permitted surface
  (`POST/GET /api/v1/teacher/exports*` on the distinct `exports.execute.teacher`
  permission — NEVER admin `exports.execute` nor parent `exports.execute.parent`),
  teaching-assignment ABAC re-checked at enqueue (caller must own the
  `teachingAssignmentId`; 404-before-403), server-derived `classSectionId` from the
  OWNED assignment (never client-supplied), reusing the existing `grades_xlsx`
  generator UNCHANGED + the proven enqueue→poll→signed-download client pattern
  (`GradeGridExportButton` in the gradebook header). Narrow `TeacherExportJobDto`
  (top-level `classSectionId`/`termId`), append-only `export.grade_grid.request`
  audit, own-job re-scoping on read/download. No worker/queue/schema change.
  **E4 now complete — all slices shipped.** *(web + small api)*

### E5 — Advanced Notifications (dispatcher + digest + prefs) · `shipped` · ~M
**Audit:** 70% — `Notification`+`NotificationPreference` models, bell, email dispatcher. **The
2026-06-05 audit found the email path is already wired end-to-end** (worker `notifications-email`
processor + branded `renderNotificationEmail` template + `MailerService`/Maildev + per-kind
`NotificationPreference` channel gating in `createMany`/`dispatchEmails`) — the roadmap's earlier
"queue stub" line was **stale**.
**Spec-kit:** ✅ landed `docs/spec/features/e5/` (epic-spec run, docs-only): spec/plan/data-model/
contracts(openapi)/ux/tasks/quickstart/PROGRESS. Visionary spine = one per-kind **notification
cadence** (`instant` / `daily_digest` / `off`) backed by **one additive
`NotificationPreference.cadence` field** (default `instant` ⇒ zero behaviour change), unifying the
dispatcher, digest worker, and prefs UI under a single "no fatigue, full control" model. **Zero new
queue / table / permission / `NotificationKind`; one ADR tripwire = a second BullMQ queue (a non-goal).
Next slice → S3.**
- [x] **S1** — **Verify & harden** the already-built email dispatcher end-to-end. Shipped (needs
  human review — P2 `[worker][test]`): a **net-new** worker-consumer spec
  (`notifications-email.processor.spec.ts` — the consumer had ZERO coverage; pins the happy path, the
  WEB_PUBLIC_URL link-absolutisation seam + default-base fallback, and the deliberate consumer-rethrow
  vs producer-swallow asymmetry) + extended API `notifications.service.spec.ts` producer edges
  (empty-recipient skip with a co-batched valid recipient still served, null→`fr-FR` job locale, exact
  `{attempts:3, backoff exponential 5000}` opts) + **one concrete hardening fix**: tenant-scoped
  `userProfile.findMany` + `emailEnabledKeys(pairs, tenantId?)` on the API `dispatchEmails` path (was
  id-only, asymmetric vs the worker cron sibling `dispatchAlertEmails` — ADR-002 defence-in-depth).
  No new queue/template, **no schema**. *(api + worker)*
- [x] **S2** — **Cross-kind daily digest & cadence** to fight notification fatigue (the cahier's
  explicit ask). Shipped (needs human review — P1 `[schema][worker]`): additive `enum NotificationCadence
  { instant daily_digest off }` + `NotificationPreference.cadence @default(instant)` +
  `@@index([tenantId, cadence, emailEnabled])` (`db push`, the only schema change ⇒ existing rows backfill
  to `instant`, zero behaviour change); `NOTIFICATION_CADENCE` const+type mirrored in `packages/contracts`
  + `@IsIn`-validated on the PATCH DTO. The platform-wide per-event dispatcher (`createMany`/`dispatchEmails`)
  now routes through two cadence-aware preference gates — `inAppPlan` (off→skip, `daily_digest`+inApp-off+email-on
  → hidden `readAt=now` durable digest-source row) + `instantEmailKeys` (email only when `emailEnabled &&
  cadence='instant'`) — and the worker alert-cron email path gets the matching `cadence:'instant'` filter (no
  double-delivery vs the digest). NEW `apps/worker/.../notifications-digest/*` cron (structural sibling of the
  E1-S4 `parent-digest/*`): 18h-UTC daily window, per-tenant→per-user, day-window rows grouped by kind, one
  composite branded email, idempotent `(user, day)` sent-marker `Notification(kind=system,
  sourceType='daily_digest', readAt=now)` written only post-send. **No new queue/table/template/kind/permission/
  endpoint/ADR.** *(schema+worker+api; `[schema][worker]` P1)*
- [x] **S3** — Dedicated parent/teacher **notification preferences UI** (cadence selector + channels +
  mute) on `/parent/settings` + `/teacher/settings`, extending the shared `PreferencesPanel`. Shipped
  (needs human review — P2 `[web][a11y][notifications][ui]`): a keyboard `CadenceSelect` radiogroup
  (Instant / Résumé quotidien / Off) per per-event kind reusing the E3-S3 severity segmented-control
  pattern (roving tabindex, arrow/Enter/Space, ≥44px, icon+text, `motion-reduce`); cadence
  disabled-with-hint (`aria-disabled` + `aria-describedby`) when email off; a header "Tout mettre en
  sourdine" bulk-mute via the new `setCadenceForKindsAction` (weekly digest excluded, channels
  untouched/reversible) + inverse "Tout réactiver"; persisted via the existing self-scoped
  `PATCH /notifications/preferences/:kind` (cadence-accepting since S2), optimistic with per-control
  revert. Surfaced on both `/parent/settings` + `/teacher/settings` via the shared-panel mount; no
  panel fork. **No schema/endpoint/permission.** **E5 now complete — all slices shipped.** *(web;
  `[web][a11y]`)*

---

## Tier 3 — Scale & new surfaces

### E6 — Analytics Snapshots & pre-computation · `shipped` · ~M
**Why:** a **non-functional requirement** — parent dashboard <2 s at scale. Today analytics are
computed live (40%). Add materialized `student_subject_snapshot` / `student_global_snapshot` /
class distributions, recomputed by the worker on `GradePublished`/`GradeRevised`/coefficient change,
read by the dashboards. (ERD + §6.1 of the cahier.)
**Spec-kit:** ✅ landed `docs/spec/features/e6/` (this run, epic-spec, docs-only): spec/plan/data-model/
contracts(openapi)/ux/tasks/quickstart/PROGRESS. Locked decisions: **3 materialised, tenant-scoped read
models** (`student_subject_snapshot`, `student_global_snapshot`, `class_subject_distribution` — disposable
caches over `Grade`; the draft's `school_kpi_snapshot` was dropped, servable from the class roll-up) + a
**durable `snapshot_recompute_trigger` dirty-queue drained by a cron poll** (structural sibling of
`alerts-cron`/`notifications-digest`, enqueued best-effort on `GradePublished`/`GradeRevised`/coefficient
change — **no second BullMQ queue**); reads stay **byte-identical** behind the existing `/api/v1/analytics/*`
aggregate endpoints, **snapshot-first with fall-through-to-live** (a miss is never an error). Visionary spine =
a `freshness { source, computedAt, recomputing }` dashboard chip ("à jour il y a Xs / recalcul en cours") —
zero new queue/permission. One ADR tripwire (durable dirty-queue + materialised cache + fall-through) to be
authored on the S1 run (reconcile the ADR number against the index — data-model proposes `ADR-019`, already
used for a real-time deferral, so take the next free number; **S1 shipped `ADR-019-analytics-snapshots`**).
**Slices S1→S5 in `tasks.md`; ALL shipped → `E6` is `shipped`.** **S5 shipped** (`[worker][api]` P2):
operability hardening — idempotent read-compare-write full rebuild (re-run on unchanged grades → no-op,
no `revision` bump, byte-parity with live), precise stale detection (`computedAt < lastGradeAt` OR
`revision < SNAPSHOT_REVISION_FLOOR` operator knob, replacing the S1 zero-snapshot-only rule → a dropped
enqueue on a POPULATED class now self-heals within one sweep), claim-time stale-`processing` reclaim (PM-C
`processedAt`-keyed, no double-recompute), failed-row revival after a back-off (`FAILED_RETRY_AFTER_MIN`,
attempts reset), bounded tenant-scoped orphan-snapshot prune (hard-delete-only, coarser cadence, no audit),
`manual_rebuild` routing through the existing drain (class-scoped / coefficient fan-out / bounded
whole-tenant fan-out), structured per-tick count logging referencing `analytics.SnapshotRecomputed`, and an
optional additive admin surface (`GET /analytics/snapshots/recompute-status` + `POST /analytics/snapshots/
rebuild`, reusing `schools.read`, in-tenant scope-id validation, idempotent coalesce, one append-only
`analytics.snapshot_rebuild` audit row). No schema change beyond S1, no second BullMQ queue, no new
permission, no new shared contract enum/event (additive controller-local DTOs only), no UI, no new ADR
(within ADR-019). **S4 shipped** = the visionary freshness chip — a new app-level
`'use client'` `FreshnessChip` (`apps/web/src/components/freshness/FreshnessChip.tsx`) over the
existing `@pilotage/ui` `Badge` + `formatRelativeTime` (no `packages/ui` change), three states
(Recomputing / Fresh "À jour il y a Xs · N notes" / quiet neutral-live) derived purely from the
additive `freshness` field, degrade-to-no-chip when absent, mounted on `/parent/dashboard` +
`/teacher/reports` + `/admin/analytics`; only the ~30 s relative-time tick is client; static
`aria-label` so the polite region never re-announces the tick; apps/web only, no
schema/endpoint/permission/contract change. **S2 shipped** = the parent dashboard reads snapshot-first (`resolveParentClassContext` over the
3 materialised read models, byte-identical fall-through-to-live via the verbatim-extracted
`computeParentClassContextLive`, additive optional `freshness` envelope; tenant-scoped, ABAC unchanged,
no schema/endpoint/controller change). **S3 shipped** (`[api][worker]`) = the two remaining
recompute-trigger enqueue seams + the worker fan-out + the additive `freshness` on teacher-reports &
drill-down: **GradeRevised** enqueues a tenant-scoped coalesced `grade_revised` trigger on BOTH the
single `POST :id/revise` and the `batch` revise path (after commit, best-effort, never blocks);
**coefficient change** (`upsertCoefficients`) enqueues one class-LESS `coefficient_changed` trigger per
distinct changed subject × active year, which the **worker fans out** to every ClassSection teaching the
subject in the year (re-derived from `teachingAssignment`, no `gradeLevelId` column needed → no schema
change), recomputing each class slice to refresh the re-weighted global. **Honest read-switch call:** the
teacher-reports/drill-down/schoolPerformance figures are served **live** (not snapshot) — the only
candidate snapshot grain (`ClassSubjectDistribution`, a class-wide round2 grade-population aggregate)
cannot byte-reproduce the teacher's per-assignment round1 figures nor the drill-down's student-population
counts (PM-1/2/3/4, architect C-2); FR1/FR2/FR3 explicitly authorise falling through to live where parity
can't hold. The trigger-driven `freshness` (open-trigger probe over every class scope) is the visible win
the S4 chip renders. No schema/endpoint/permission/queue/contract change.

### E7 — Remediation & Tutoring loop · `in-progress` · ~L
**Why:** closes alert → diagnosis → **resource** → **measured improvement**: turn a recommendation into a
real, bookable tutoring resource, then watch the child improve on the parent dashboard.
New models (`Tutor`, `TutorAvailability`, `RemediationPlan`, `Booking`), an admin-curated catalogue +
booking UI, the E1-S2 alert deep-link ("Trouver un soutien en {matière}"), and a kind, non-stigmatising
progress strip reading the E6 trend + tying into E3's `IMPROVEMENT` lane. The most ambitious epic —
specced carefully, sliced thin.
**Spec-kit:** ✅ landed `docs/spec/features/e7/` (this run, epic-spec, docs-only): spec/plan/data-model/
contracts(openapi)/ux/tasks/quickstart/PROGRESS. Locked decisions: the loop reuses E1 (alert-promotion +
`deriveAlertActions`), E2 (teaching wall), E3 (`IMPROVEMENT` emerald lane), E6 (`student_subject_snapshot`
trend, snapshot-first + live fall-through); **four+ additive models** (`Tutor` teacher-linked-or-external
— **no new Keycloak role**; `TutorAvailability` = a dated slot with finite **capacity**; `RemediationPlan`
= alert-seeded/idempotent/baseline-capturing; `Booking` = a parent's append-only claim on one slot unit);
**three role-narrowed permissions** (`remediation.read|manage|book`, the E4 house style); the visionary
spine = the dashboard **progress strip** (trend delta vs baseline, kind framing, E3 tie-in). **The one new
architectural decision = booking/availability concurrency** (never over-book a capacity-limited slot under
concurrent writes) → **`docs/adr/ADR-020-booking-availability-concurrency.md`** on the **booking slice
(S2)** (DB-level guard: a partial unique on active bookings for capacity-1 + a transactional capacity
check for capacity-N, deterministic 409; no distributed lock / Redis / second BullMQ queue / denormalised
counter). Hard non-goals: **no payments/PSP/price** (ADR-018/E12 parked — `costKind` is a label only), no
open/cross-school marketplace, no new login / no student booking (E8), no calendar sync, no recurring
bookings, no real-time push, no second queue, no new datastore. **Slice order (all 8 kit files
reconciled):** S1 schema + alert→`RemediationPlan` promotion + read-only catalogue · S2 availability +
booking (ADR-020) · S3 progress strip · S4 teacher capacity · S5 admin curation · S6 hardening
(notifications + cancellation + completion + uptake overview). **S1 shipped** (`epic-slice` — P1
`[schema][auth]`, needs human review): the 4 additive `db push` models (`Tutor`/`TutorAvailability`/
`RemediationPlan`/`Booking`) + 6 enums (strictly additive — existing models only gain back-relation
arrays, zero column changed; open-plan `@@unique([tenantId, studentId, subjectId, status])` +
`@@unique([availabilityId, sessionAt, planId])` idempotency guards), the 3 role-narrowed permissions
(`remediation.read` parent+teacher+admin / `remediation.manage` admin / `remediation.book` parent) in
`permissions.constants.ts` + both seeds, the parent-walled `RemediationModule` (`POST /remediation/plans`
= guardianship-ABAC-before-write + idempotent open-plan reuse + P2002-race collapse + server-derived
student/subject from the alert + baseline snapshot-first/live-fall-through + append-only
`remediation.plan_created` audit only on fresh promote; `GET /plans` + `/plans/:id` 404-before-403;
read-only `GET /catalogue?subjectId=` published+tenant+subject-filtered, no N+1), the
`deriveRemediationAction` CTA ("Trouver un soutien en {matière}") on the E1-S2 `AlertNextSteps` panel +
the `/parent/remediation/[planId]` plan page (reuse-first, never a dead-end), and a 7-test
`remediation.service.spec.ts`. **No booking write path → no over-booking surface → no ADR this slice**
(ADR-020 lands with the S2 booking verb). **`prisma db push` is pending** (infra was down this run) — a
human must apply the additive schema before `/remediation/*` is functional. **E7-S2 is now shipped**
(`epic-slice` — P1 `[schema][auth][concurrency]`, needs human review): the load-bearing concurrency
slice — the parent **booking** verb (`POST /remediation/bookings`, `remediation.book`; flow ORDER:
plan 404 → guardianship ABAC before write (404-before-403) → plan-open 422 → availability load +
published re-validate → E2 teaching-wall 403 on a teacher-linked tutor → capacity-guarded insert),
**never over-books** under concurrency via the ADR-020 two-tier guard (a raw partial-unique index
`booking_active_instance_unique … WHERE status IN ('requested','confirmed')` for capacity-1, applied
idempotently on API boot by `BookingIndexBootstrap` + a `$transaction` `SELECT … FOR UPDATE`
count-then-insert for capacity-N), with **server-canonicalised `sessionAt`** (the pure
`session-instance.ts` resolver → 422 on a slot mismatch / past instance, never a 500) so the
capacity-guard key is byte-identical across concurrent requests, deterministic **409** "ce créneau
vient d'être réservé" (vs idempotent-200 re-tap, distinguished by `P2002` target), append-only parent
**cancel** that atomically frees the seat (cancellable-status-guarded `updateMany`, double-cancel
safe no-op), best-effort tutor+parent `NotificationsService.createMany` (kind `remediation`, no new
queue) + append-only `remediation.booking_created`/`booking_cancelled` audit, the catalogue enriched
with `nextSessionAt`/`remainingSeats`/`myBookingId` in ONE grouped Booking query (no N+1), the E2
teaching wall **inlined** into `RemediationService` (no circular MessagingModule dep),
**`docs/adr/ADR-020-booking-availability-concurrency.md`** (Accepted — the guard, idempotency-vs-capacity
separation, deterministic-409 contract, rejected alternatives: distributed lock / Redis SETNX / 2nd
BullMQ queue / denormalised counter), and a targeted two-concurrent-books `booking.service.spec.ts`
proving exactly-one-succeeds (never a 500, exactly one active row). The ONLY schema step is the partial
index (no model shape change). **Next slice → S3** (`epic-slice` `[web][a11y]`: the parent remediation
progress strip — measured improvement vs the plan baseline from the E6 snapshot).

### E8 — Student Portal · `proposed` · ~M
**Why:** the cahier's future "Portail élève." New Keycloak `student` role + read-only student views
(my grades, assessments, attendance, announcements) with student ABAC. Net-new surface.

---

## Tier 4 — Foundation, quality & interop (interleave as filler)

- **E9 — Enrollment self-service UI** · `proposed` · ~S — parent child-claim form + admin approval
  page (backend 90% ready). Completes the cahier's parent→admin validation workflow.
- **E10 — Quality bar: authenticated E2E + WCAG 2.2 AA** · `proposed` · ongoing — Playwright journeys
  (grade publish → parent alert; parent claims child; messaging) + fix axe-core violations on
  authenticated pages. Maps to R9/R10.
- **E11 — Standards interop (OneRoster/LTI) + async imports** · `proposed` · ~M — move bulk import
  to the worker (today blocking in-request) + OneRoster roster sync. Interoperability per the cahier.
- **E12 — Finance prep (isolated)** · `parked` · ~L — keep the domain isolated (ADR-018), never store
  card data, PSP later. Out of MVP; do not start without explicit go.

---

## Guardrails for every epic (from the cahier de charges)
- **Parent dashboard is the core**; answer the five questions in <2 s; mobile-first.
- **Explainable, kind, non-stigmatising** — every alert states rule + subject + threshold + trend +
  suggested action; never compare a child by name to peers.
- **Tenant + RLS + RBAC/ABAC + append-only audit** on every backend change (children's data).
- **Reuse `@pilotage/ui`**, aggregate endpoints (no client N+1), `packages/contracts` for shared types.
- A new architectural decision ⇒ a new `docs/adr/` ADR (Winston gate).
