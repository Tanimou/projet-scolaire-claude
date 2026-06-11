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

**Current focus →** `E1 — Parent Alert Action Loop` is **shipped** (S1–S4 all landed; S1 in [PR #103](https://github.com/Tanimou/projet-scolaire-claude/pull/103) — parent ack/resolve/dismiss via guardianship ABAC; **S2** = the "What should I do?" panel with deterministic deep-link next-steps + an append-only, idempotent `alert.meeting_intent` CTA; **S3** = the `MeetingRequest` model promoting that intent into a queryable, role-scoped teacher/admin action center + in-app assignee notification; **S4** = the opt-in weekly parent digest worker cron + email-only `NotificationPreference`). **Next epic → `E2 — Parent ↔ Teacher Messaging`** is now **specced** (epic-spec kit landed at `docs/spec/features/e2/` — spec/plan/data-model/contracts/tasks/quickstart/PROGRESS); the next run should ship **E2-S1** (`epic-slice`: `Conversation` + `ConversationParticipant` + `ConversationMessage` models, dual-wall ABAC = guardianship ∩ teaching-assignment, create/send spine). The codebase was already past the roadmap's "epic-spec first" assumption for E1 (admin lifecycle endpoints + parent read shipped), so the E1 runs were **epic-slices**, not a spec run; the `docs/spec/features/e1/` spec-kit was backfilled one story per slice. **E2-S1 through E2-S4 are now shipped → `E2` is `shipped` (all 4 slices landed; S4 = moderation/safety: report + admin oversight + send rate-limit + opt-in email reusing the existing notification-email pipeline). Next epic → `E3 — Complete the Alert Engine` is now **in-progress** (spec-kit landed at `docs/spec/features/e3/`; **S1 + S2 shipped** — S1 `TEACHER_COMMENT_FLAG` grade-flag + dual byte-parity evaluator; **S2 `IMPROVEMENT`** = the 7th rule, a non-stigmatising positive signal mirroring `NEGATIVE_TREND` inverted, with a code-aware emerald celebration lane on the parent recommendations surface — **engine now 7/7 rules wired** (`BEHAVIOR_ALERT` stays reserved-but-unwired by design); **S3 shipped** = admin rule-config UI (per-rule "Configurer" `FormDrawer` over the existing `PATCH /alerts/rules/:code` — enabled/severity/numeric-params, complete-object wholesale PATCH, no new endpoint/schema; also hardened the shared `Drawer` primitive with a WCAG focus-trap + focus-restore-to-trigger); **S4 shipped** = email on the cron path — the worker evaluator enqueues the SAME `notifications-email` job the API producer enqueues (path A, no ADR, no new queue/template), gated by `NotificationPreference(alert, emailEnabled)` (default OFF/RGPD), tenant-scoped, freshly-deduped recipients, best-effort, removing the "in-app only" asymmetry. **`E3` is now `shipped` (all 4 slices landed). Next epic → `E4 — Async Exports & Bulletins`** is now **in-progress** (exports backend 100% done, FE being wired slice-by-slice; **S2 shipped** = the parent term-summary bulletin PDF on a NEW parent-permitted surface — `exports.execute.parent` (NEVER admin `exports.execute`), guardianship ABAC at enqueue, server-derived `classSectionId` from the child's own active enrollment, additive single-`studentId` generator narrowing, and a parent-narrowed `ParentExportJobDto` (top-level `termId`/`studentId`, no `errorMessage`/`fileUrl`) so the poll/download flow is contract-truthful; no schema change. **Note: the branch/slice label is desynced** — branch reads `e4-s1` but the diff ships **S2** — reconcile on land. **E4-S3 is now shipped** = teacher class grade-grid export from the gradebook — a NEW teacher-permitted surface (`exports.execute.teacher`, NEVER admin/parent), teaching-assignment ABAC at enqueue, server-derived `classSectionId`, reusing the `grades_xlsx` generator unchanged + the proven enqueue→poll→signed-download client pattern; no worker/queue/schema change. **`E4` is now `shipped` (S1 pre-epic + S2 + S3 all landed). Next epic → `E5 — Advanced Notifications`** is now **specced** (epic-spec kit landed at `docs/spec/features/e5/` — spec/plan/data-model/contracts/ux/tasks/quickstart/PROGRESS). The audit found the email dispatcher already wired end-to-end (the old "queue stub" line was stale), so the kit scopes **S1 as verify/harden** (not rebuild) and concentrates net-new ambition in **S2** (cross-kind daily digest + the one additive `NotificationPreference.cadence` field, the only schema change) and **S3** (dedicated parent/teacher prefs UI). Visionary spine = one per-kind **notification cadence** (`instant`/`daily_digest`/`off`) unifying dispatcher + digest + prefs UI; zero new queue/table/permission/`NotificationKind`; one ADR tripwire (a 2nd BullMQ queue) is a non-goal. **E5-S1 is now shipped** (`epic-slice`: verify/harden the email dispatcher — net-new worker-consumer spec + producer-edge API tests + a tenant-scoping hardening fix on `dispatchEmails`, no schema). **E5-S2 is now shipped** (`epic-slice` — P1 `[schema][worker]`: the one additive `NotificationCadence`/`cadence @default(instant)` schema change + `@@index([tenantId, cadence, emailEnabled])`, the platform-wide dispatcher rewritten onto the cadence-aware `inAppPlan`/`instantEmailKeys` gates, the matching `cadence:'instant'` filter on the worker alert-cron email path, and the net-new tenant-scoped, idempotent `notifications-digest` daily-digest cron mirroring `parent-digest/*`). **E5-S3 is now shipped** (`epic-slice` — P2 `[web][a11y][notifications][ui]`: the dedicated parent/teacher notification-preferences UI — a keyboard `CadenceSelect` radiogroup per per-event kind reusing the E3-S3 severity segmented-control pattern, a header "Tout mettre en sourdine" bulk-mute via the new `setCadenceForKindsAction` + inverse "Tout réactiver", cadence disabled-with-hint when email off, surfaced on both `/parent/settings` + `/teacher/settings` via the shared `PreferencesPanel` — no schema/endpoint/permission, no panel fork). **`E5` is now `shipped` (all 3 slices landed). **`E6` is now `in-progress` (epic-spec kit landed this run at `docs/spec/features/e6/`, docs-only): 3 materialised tenant-scoped read models (`student_subject_snapshot`/`student_global_snapshot`/`class_subject_distribution` — the draft's `school_kpi_snapshot` was dropped, servable from the class roll-up) + a durable `snapshot_recompute_trigger` dirty-queue drained by a cron poll (structural sibling of `alerts-cron`/`notifications-digest`, **no 2nd BullMQ queue**), enqueued best-effort on `GradePublished`/`GradeRevised`/coefficient change; reads stay byte-identical behind the existing `/api/v1/analytics/*` aggregate endpoints, **snapshot-first with fall-through-to-live** (a miss is never an error); visionary spine = a `freshness { source, computedAt, recomputing }` dashboard chip; one ADR tripwire on the S1 run (reconcile the number — `ADR-019` is taken). Next slice → `E6-S1` (`epic-slice`: snapshot+dirty-queue schema + worker recompute/drain spine + snapshot-first read switch on one aggregate endpoint, behind fall-through). **E6-S1 is now shipped** ([PR #125](https://github.com/Tanimou/projet-scolaire-claude/pull/125) — snapshot+dirty-queue schema + worker recompute/drain spine + best-effort publish trigger; zero read-path wiring; `ADR-019-analytics-snapshots`). **E6-S2 is now shipped** (`epic-slice` — P2 `[api][analytics][snapshot]`, needs human review): the parent dashboard's class-context (`classAverage`/`studentRank`/`classSize` + global `studentRank`/`classRankTotal`) now reads **snapshot-first** via `resolveParentClassContext` over the materialised `StudentGlobalSnapshot`/`StudentSubjectSnapshot`/`ClassSubjectDistribution` point-reads — collapsing the O(class × grades) live `grade.findMany` (the <2 s NFR win); the original live block is extracted **verbatim** into `computeParentClassContextLive` as the byte-identical fall-through (any snapshot miss/throw or open recompute trigger → live, never an error; all-or-nothing freshness gate). Additive optional `ParentDashboardResponse.freshness?: SnapshotFreshness` (reuses the S1 contract type; S4 wires the chip). Tenant-scoped on every snapshot/trigger query; ABAC + server-derived class scope unchanged; no schema/endpoint/controller/`@pilotage/ui` change. Next slice → `E6-S3` (`epic-slice`: admin & teacher snapshot reads + the `GradeRevised`/coefficient-change enqueue seams).** **E6-S4 is now shipped** (`epic-slice` — P2 `[web][a11y][analytics][ui]`): the visionary freshness chip — a new app-level `'use client'` `FreshnessChip` (`apps/web/src/components/freshness/FreshnessChip.tsx`) composed over the existing `@pilotage/ui` `Badge` + `formatRelativeTime` (reuse-first, no `packages/ui` change), rendering the three states (Recomputing → spinning "Recalcul en cours…" neutral; Fresh → success "À jour" + aria-hidden "il y a Xs" + optional "· N notes"; live → quiet neutral "À jour") **purely** from the additive `freshness` field, degrading to **no chip** when absent. Mounted on `/parent/dashboard` (S2 snapshot read), `/teacher/reports` + `/admin/analytics` (S3 live-served reads), each page adding the additive optional `freshness?` shape to its local response type. The only client interactivity is a ~30 s relative-time `setInterval` (cleared on unmount); the static `aria-label` (state word) keeps the `role=status`/`aria-live=polite` region from re-announcing the tick (aria-hidden suffix); `motion-reduce` spinner; kind FR copy. **apps/web only — no schema/endpoint/permission/contract/`@pilotage/ui` change.** Two known limitations recorded for S5/polish (Fresh-state hydration width not reserved → minor CLS; the reload-only live announcement on server-rendered surfaces). Next slice → `E6-S5` (`epic-slice` `[worker]`: idempotent full rebuild + sweep hardening — convergence after a missed event / fresh tenant, optional admin rebuild/status surface).**))).** **Current focus (2026-06-11) → `E7` reconciled to `shipped` (all six slices S1–S6 landed; S6 = loop hardening in [#137](https://github.com/Tanimou/projet-scolaire-claude/pull/137) — the roadmap head/body had stale "in-progress / next slice → S5" pointers, now corrected). `E8`/`E9`/`E10` are also `shipped`. The only non-shipped, non-parked epic left is `E11 — Standards interop (OneRoster/LTI) + async imports`, which this run **specced** (epic-spec kit landed at `docs/spec/features/e11/` — spec/plan/data-model/contracts/ux/tasks/quickstart/PROGRESS; docs-only). Visionary spine = move the in-request bulk apply (today a 60 s request-held `$transaction`) onto a **3rd BullMQ queue** drained by the worker reusing the existing `applyRow`/`rollbackRow` engine byte-for-byte, plus a reusable **"Import & sync health"** reconciliation panel (created/updated/unchanged/conflict/skipped + 24h rollback) and a OneRoster CSV-bundle roster-sync surface; permission reuses the admin-held `integrations.write` (no new perm); one ADR tripwire → `ADR-024-async-import-sync-and-idempotent-reconciliation` on the **S1** run. **E11-S1 is now shipped** (`epic-slice` `[schema][worker][async]` P1, **needs human review — RED gate, NOT auto-merged**): async spine + 3rd `imports` BullMQ queue + worker `ImportsProcessor` + enqueue-on-apply via a from-status-guarded claim + the relocated shared `@pilotage/imports-core` engine (one apply impl, API+worker, no fork) + crash-safe per-row RESUME + `ImportStatus += queued` + ADR-024. RED gate = `pnpm install` was never run for the new workspace package (its deps are unlinked → typecheck fails); the api/worker sites typecheck GREEN — mechanical install+build fix, not a redesign. **E11-S2 is now shipped** (`epic-slice` `[schema][api][web][a11y][rgpd]` P1, **GREEN — auto-merged**): reconciliation classification (`ReconciliationClass {created updated unchanged conflict skipped}` + `ImportRow.reconciliation`/`conflictFields`) + the non-stigmatising "Bilan d'import & synchronisation" panel. The externalRef match is no longer a hard reject → an idempotent match path (unchanged / `updated` non-protected-only / `conflict` = protected-field disagreement recorded but NEVER written = the FR4 RGPD wall); the load-bearing fix = the **rollback now compensates ONLY rows this import CREATED**, so the advertised 24h rollback can no longer cascade-delete a pre-existing matched child's record. RED gate (fixed in-flight) = the stale-Prisma-client pattern (`prisma generate` un-run after the additive schema) → 13/13 GREEN. **The two verify-panel blocker/safety items were resolved in the land pass:** the ADR-024 `## Reconciliation classification` amendment landed WITH the slice (the cited "§reconciliation" now resolves), and the matched-row rollback-exclusion P0 guard now has its dedicated `imports-engine.spec.ts` test (an `updated`/`unchanged` row is flipped `rolled_back` WITHOUT `rollbackRow` firing) → no open blocker at merge. Carried to S-hardening (non-blocking): the `all_or_nothing` shift (a worker-discovered `conflict` leaves a row unapplied yet the batch finalizes `applied` — deferred to S4 arbitration) + minor a11y polish (`role=status`, `th scope=col`, `updated`-row `conflictFields`, guardians classification). **E11-S3 is now shipped** (`epic-slice` `[schema][api][web][integration]` P2): OneRoster source connect + pull + map-to-`ImportBatch`, CSV bundle first, on the EXISTING admin-held `integrations.write` (no new permission). Additive `db push` = `ImportOrigin`/`RosterSourceKind`/`RosterSyncStatus` enums + the tenant+school-scoped `RosterSource` model (opaque `credentialRef`, never returned) + `ImportBatch.origin`/`rosterSourceId`. A new `IntegrationsModule` (`POST/GET /api/v1/integrations/oneroster` + `:id`, `:id/sync`); the pure `oneroster.adapter.ts` maps a OneRoster v1.1 **CSV bundle** (`users`/`classes`/`enrollments` — **roster identity + enrollment ONLY**, RGPD-minimal, no birthDate/grades/medical, `sourcedId`→`externalRef` as the idempotency anchor) onto the EXISTING `ImportRow` shape per `ImportType`, reusing each handler's `validateRow` byte-for-byte (no forked validation) to produce one **`validated` `ImportBatch(origin=oneroster)`** per type — so a sync **inherits S1's async apply + S2's reconciliation panel for free** (the worker reads neither new column). `MAX_ROWS` (5000)/empty → `failed` pull, never a corrupt apply. FE = a new `/admin/integrations` surface (connect FormDrawer + "Synchroniser" → lands on the produced batch's health/detail page), a OneRoster origin badge on the batch header, a new "Intégrations" sidebar item, degrading kindly to "indisponible" pre-migration. ADR-024 carries an `## OneRoster source connect + pull + map (E11-S3 — amendment)` section; Murat P0 = `oneroster.adapter.spec.ts` (mapped rows pass the SAME `validateRow`; sourcedId→externalRef; RGPD-min; non-student/soft-deleted skipped). **Operator pre-req (gates demoability, not merge):** the additive `prisma db push` + `prisma generate`. **E11-S4 is now shipped** (`epic-slice` `[api][worker][web]` P2, **no schema** — **`E11` is now `shipped`, all 4 slices landed; the only non-parked epic backlog is now empty → E12 finance is the next, parked, explicit-go epic**): closes the interop loop with **zero new execution/reconciliation code** — an `origin=oneroster` batch applies through the S1 async worker + S2 reconciliation classification exactly like a CSV import. Net-new = **admin conflict arbitration** (`POST /api/v1/imports/:id/conflicts/:rowId/resolve` `{decision: keep_current | take_source}` on the existing `imports.execute` — no new permission; a single in-request `$transaction` via the handler's new optional `resolveConflict` + the shared `resolveRowConflict` engine wrapper, no fork; `keep_current` writes nothing → `unchanged`, `take_source` is the ONLY protected-field overwrite path → `updated`, both flipping the row `conflict → applied` with `createdEntityId = the PRE-EXISTING entity` so the S2 rollback-safety invariant keeps it out of the delete set; from-status-guarded `updateMany` makes a concurrent double-resolve a clean 400; append-only `import.conflict.resolve` audit; `summary.byClass` adjusted) + proven **re-run convergence** (0 created on the 2nd sync, no duplicate child/teacher/class — externalRef anchor + S1 RESUME) + the **non-destructive SIS-delete** posture (a student absent from a new pull is left intact, never auto-deleted; `status=tobedeleted` skipped by the adapter) + the **24h rollback reused** from S1 (provenance-aware "Annuler cette synchronisation" copy). FE = the `ConflictResolver.tsx` island (amber "à arbitrer" strip + focus-trapped `FormDrawer` per row with a side-by-side source-vs-current table + keyboard `radiogroup` Garder-l'actuel-default/Prendre-la-source + `role=status` toast + the `resolveImportConflict` action), replacing the S2 static "Voir les arbitrages" link; rollback block/button origin-aware. ADR-024 carries an `## Idempotent sync apply + conflict resolution + 24h rollback (E11-S4 — amendment)` section; the `all_or_nothing`-with-conflicts carry-over is resolved (intended). Tests = S4 cases in `apps/worker/.../imports-engine.spec.ts`. **No schema, no new permission, no contract change.** **Operator pre-req (carried from S1/S2/S3, gates demoability not merge):** the additive `prisma db push` + `prisma generate` + `pnpm build` (`@pilotage/imports-core/dist`) + a worker running the `imports` queue. E12 stays `parked` (finance — explicit go required).**

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

> **E7 update (this run): E7-S4 is now shipped** (`epic-slice` — P2 `[auth][api][web][remediation][abac]`,
> needs human review): the **teacher capacity-management + booking-transition** surface. A new
> ownership-walled `TeacherRemediationService` (590L) + 4 routes on `RemediationController`
> (`GET /remediation/teacher`, `POST` + `PATCH /remediation/teacher/availabilities[/:id]`,
> `PATCH /remediation/teacher/bookings/:id/transition`) let a teacher publish/edit the availability of
> their OWN auto-derived `Tutor` and move their pupils' bookings through `confirm | decline | completed |
> no_show | proposed_alternative`. **Every route rides `remediation.read` + the E2 ownership wall** (no new
> permission): publish resolves `teacherProfile.findFirst(userProfileId === me)` (no profile → 403) then
> re-walls the `subjectId` against a *current* active-year teaching assignment; slot-edit + transition
> re-scope to the caller's own tutor (404-before-403). The **booking-transition flip is concurrency-safe**:
> a from-status-guarded `updateMany` (the ADR-020 idiom) makes a concurrent double-transition a deterministic
> **409**, never a silent last-writer-wins double-flip. `no_show` maps onto `declined` + an "Absent·e" note
> (the `BookingStatus` enum carries no `no_show` value) so the seat frees with **no schema change**; the
> distinction is preserved in the append-only `remediation.booking_no_show` audit row. Append-only audit +
> best-effort parent `NotificationsService.createMany` (kind `remediation`, no new queue) on every write; one
> grouped Booking query for live seat counts (no N+1). FE = the **"Mes créneaux de soutien"** teacher surface
> (server-component `page.tsx` over the ONE aggregate, `PublishSlotDrawer`, `BookingsTable` inbox with a
> `role=status` live region, a "Soutien scolaire" sidebar item), reuse-first on `@pilotage/ui` (no
> `packages/ui` change). **No schema, no new permission, no new ADR, no second queue.** **Pending (human/infra):**
> the S1/S2 `prisma db push` for the E7 tables is still unapplied (infra was down) — until then the teacher
> surface reads an empty null-tutor shell and publishing fails at the DB.
>
> **E7-S5 is now shipped** (`epic-slice` — P1 `[auth][api][abac][remediation][rgpd]`, needs human review):
> the **admin catalogue curation & oversight** surface. A new tenant-scoped `AdminRemediationService` (619L)
> + 6 routes on `RemediationController` (`GET /remediation/admin/tutors[?subjectId=]` + `/admin/overview`,
> `POST /remediation/tutors`, `PATCH /remediation/tutors/:id`, `POST/PATCH /remediation/tutors/:tutorId/
> availabilities[/:id]`), **ALL gated by `@RequiresPermission('remediation.manage')`** (the S1-seeded
> admin-only authority — a parent/teacher with `remediation.read|book` gets 403; no new permission). A school
> admin creates/approves(`published:true`)/retires(`published:false`, soft + history-preserving) tutors
> (teacher-linked or external/peer) and publishes/edits their slots for ANY tutor. **Tenant-scoped on every
> read/write** (server-derived `me.tenantId` → cross-tenant 404). **The FM-1 catalogue-trust wall holds:** a
> teacher tutor's `subjectIds` are constrained to subjects the linked teacher CURRENTLY teaches (active-year
> `teachingAssignment`); an all-untaught selection → 422. **FM-8 idempotency:** creating a teacher tutor who
> already has one REUSES the S4 auto-derived row. The admin slot path reuses the SAME `resolveNextSessionAt`
> key + capacity-floor guard as the teacher/booking paths (ADR-020 → lower capacity below active bookings →
> 422). **The `/admin/overview` is RGPD-clean — AGGREGATE COUNTS ONLY** (`groupBy`/`count`, no `studentId`/
> `studentName`/per-child row). Append-only `remediation.{tutor,availability}_{created,updated}` audit on every
> curation write (the tutor verb carries `published` before/after). FE = `/admin/remediation` (server-component
> `page.tsx` over 4 parallel reads + `RemediationCatalogueManager` + `'use server'` actions + `slot-format`),
> reuse-first on `@pilotage/ui` (no `packages/ui` change), new "Soutien scolaire" admin sidebar item.
> **No schema change** (reuses the S1/S2/S4 models entirely), no new ADR, no second queue. **In-flight RED-gate
> fix:** 3 typecheck errors (a contract pre-parse/post-parse DTO-optionality mismatch on `createTutor` + 2
> `noUncheckedIndexedAccess` spec dereferences) were resolved before land (`pnpm typecheck` → 11/11 GREEN).
> **Pending (human/infra):** the S1/S2 `prisma db push` for the E7 tables is STILL unapplied (infra was down
> across S1→S4) — this slice adds zero schema but the whole catalogue is non-functional until an operator
> applies the pending additive E7 migration to dev/prod. Next slice → **E7-S6** (`epic-slice` `[auth]` P2-P3:
> loop hardening — notifications + cancellation + completion + uptake sweep, plus the S5-deferred fixes:
> FM-8 retire audit, slot `createdBy` provenance, overview published-only `tutorCount`, `?subjectId=`
> `ParseUUIDPipe`). No schema change.

### E7 — Remediation & Tutoring loop · `shipped` · ~L
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
index (no model shape change). **E7-S3 is now shipped** (`epic-slice` — P1
`[web][a11y][api][analytics][remediation]`, needs human review): the visionary measured-improvement
payoff — the parent-dashboard **progress strip**. The new
`RemediationService.remediationProgress({ tenantId, studentId })` producer returns one entry per OPEN
plan (ONE open-plan `findMany` + ONE grouped `booking.findMany` over all plans, no N+1, + the SHARED
snapshot-first/live `readSubjectAverage` reader per subject), with `trendDelta = round(current −
baseline, 2)` ONLY when both non-null (PM-4: a null baseline never fabricates a `current − 0` positive)
and `improved = trendDelta >= IMPROVEMENT_DELTA_THRESHOLD` (the SINGLE shared `1.5` value-export reusing
the E3 rule default — strip and alert engine speak the same number). **Byte-parity refactor:**
`captureSubjectBaseline` is now a thin wrapper over the extracted `readSubjectAverage`, so the baseline
anchor and the current measure share ONE code path and can't diverge. `AnalyticsModule` imports
`RemediationModule` (one-way edge, no DI cycle); `AnalyticsService` injects `RemediationService` and
composes the additive optional `ParentDashboardResponse.remediation?` **best-effort** (a throw → `[]`,
never errors the <2 s dashboard — the `freshness?` posture), riding the SAME aggregate (no client
round-trip). FE = a new server-component `RemediationProgressStrip` (reuse-only `@pilotage/ui` `Badge`/
`SectionHeader`/`SubjectChip`, no `packages/ui` change), four kind payoff states (`en attente` /
`+X pts` / E3 emerald `Le soutien porte ses fruits 🎉` / `les premiers effets prennent quelques
semaines` — never "échec"), absolute FR next-session label, deep-links to `/parent/remediation/[planId]`,
degrades to nothing when absent/empty. Tenant + ABAC unchanged (the dashboard's already-resolved
`tenantId`/`studentId`, every internal query re-scopes). **No schema, no endpoint, no permission, no new
ADR** (additive optional field, reuse-first, no new architectural decision). Tests: 9 producer cases in
`remediation.service.spec.ts`; the 3 stale `new AnalyticsService(...)` call sites updated for the new
3rd `remediation` constructor param (in-flight RED-gate fix). **Pending (human/infra):** rebuild
`packages/contracts/dist` (the runtime `IMPROVEMENT_DELTA_THRESHOLD` value import) via the single
post-Workflow `pnpm build`; the S1/S2 `prisma db push` still pending (until applied the producer returns
`[]` → no strip, never errors); and the missing consumer-seam test on the Analytics→Remediation best-effort
wiring (recommended for S4/hardening). **`E7` is now `shipped` — all six slices landed (S1–S6): S4
teacher capacity + booking transitions ([#135](https://github.com/Tanimou/projet-scolaire-claude/pull/135)),
S5 admin catalogue curation & oversight ([#136](https://github.com/Tanimou/projet-scolaire-claude/pull/136)),
S6 loop hardening = kind+reversible plan-completion verb + curation-notify parity + auto-suggest sweep, no
schema ([#137](https://github.com/Tanimou/projet-scolaire-claude/pull/137)).** See the **E7 update** note above
for the S4/S5 detail. **Operator pre-req (gates demoability, not merge):** the additive S1/S2 `prisma db push`
for the E7 tables + the partial-unique booking index are still pending an infra apply.

### E8 — Student Portal · `shipped` · ~M
**Why:** the cahier's future "Portail élève." Activates the **reserved** Keycloak `student` role
(ADR-004/015 "(futur)") + read-only student views (my grades, assessments, attendance, announcements)
with a **deny-by-default student-self ABAC** (never a peer). Net-new, read-only learner surface.
**Spec-kit:** ✅ landed `docs/spec/features/e8/` (this run, epic-spec, docs-only): spec/plan/data-model/
contracts(openapi)/ux/tasks/quickstart/PROGRESS. Locked decisions: a **fourth, read-only audience** (the
learner, seeing **only their own** dossier) reusing the existing aggregate producers re-scoped to *self*;
the **one schema change** = an additive optional `Student.userProfileId String? @unique` link (the
`Guardian.userProfileId` precedent — **verified absent from `model Student` today**, so S1 is
`[schema][auth]`); a thin role-narrowed read-only permission family (`grades.read.self` /
`assessments.read.self` / `attendance.read.self` / `announcements.read.self` / `analytics.read.self`,
student-only, **zero writes**); the visionary spine = the **"Mon objectif"** actionable dashboard (E6
per-subject trend snapshot-first + the E7 `remediationProgress` line re-framed second-person + next
assessments, never a peer comparison, RGPD-minimal). **The one new architectural decision = the `student`
role activation + the student-self ABAC** (deny-by-default singleton `[ownId]`/`[]`, never `null`; the
peer-comparison wall in the payload shape; the `portal-parent` OIDC client reused, a 4th client the
recorded alternative) → **`docs/adr/ADR-021-student-role-and-self-abac.md`** on the **S1** run (ADR-021 is
the next free number after ADR-020). Hard non-goals: no student write/self-service (no booking —
`remediation.book` never granted to `student`), no peer data/roster/ranking, no second realm, no new
metric, no medical/guardian-private exposure, no provisioning UI, no real-time/second queue, no LTI.
**Slice order:** S1 student role + self-ABAC + auth wiring + `/student/me` + "Mes notes" (→ ADR-021) ·
S2 "Mes prochaines évaluations" + "Mon assiduité" · S3 announcements + the "Mon objectif" dashboard.
**E8-S1 shipped — `epic-slice`, P1 `[schema][auth][security][rgpd][abac]`, GREEN (build 7/7,
auto-merged after a follow-up reconciliation pass).** The fourth, read-only `/student/*` portal: a DISJOINT `student`
realm-role (INV-1) routed through `auth.ts` (4th provider; ADR-021 `portal-parent` OIDC-client reuse, a
4th client the recorded alternative) + `middleware.ts` (deny-by-default + `PORTAL_LANDING.student =
/student/grades`); the deny-by-default **student-self ABAC** (`student-access.service.ts` — scope is
EXACTLY `[ownId]` or `[]`, **never `null`**, never a peer; self resolved server-side from
`Student.userProfileId === me.id`, no `:studentId` path param → IDOR structurally removed); the additive
`Student.userProfileId String? @unique` link (`onDelete: SetNull`, `Guardian.userProfileId` precedent);
the `*.read.self` permission family (student-only, ZERO writes) + both seeds; the `student-portal` module
(`GET /student/me` activation gate, `GET /student/grades`); the **RGPD non-stigmatising wall in the
PAYLOAD SHAPE** (DTOs structurally lack `studentRank`/`classAverage`/`classRankTotal`/`classSize`, only
published/revised grades, no medical/guardian-private fields); the violet `student` design-token ramp +
`/student/login` + `/student/grades` + activation-gate FE; and `docs/adr/ADR-021-student-role-and-self-abac.md`.
**Blockers reconciled in the green-fix pass:** (1) both checkouts consolidated onto ONE branch
(worktree-path bug); (2) `prisma generate` cleared the 2 stale-client TS2353 errors; (3) the FE↔contract
`StudentGradeRow` mismatch fixed by conforming the FE to the canonical FLAT shape + adding two flat,
RGPD-safe learner-own scalars (`kind`, `status`) so the card stays complete; (4) `ADR-021` landed
(Winston-ratified); (5) the AppShell branding 403 crash fixed (grant `student` `branding.read` +
harden `fetchBranding` to degrade on 403); (6) the `/student/dashboard` login 404 fixed with a
portal-aware landing map. **Operator step (not a code blocker):** activate the `student` realm-role +
demo user in `infra/keycloak/realm-export.json` and run the additive `db push`. **E8-S2 shipped** (this run — `epic-slice`,
P1 `[auth][api][web][rgpd][abac]`, GREEN: build 7/7, typecheck 11/11, spec 6/6): two read-only
student-portal surfaces behind the proven S1 student-self wall, **no schema / no new permission / no new
ADR**. `GET /student/upcoming` (`assessments.read.self`) reuses `AnalyticsService.parentUpcoming` **verbatim**
re-scoped to the self-resolved `studentId`, projected into the narrowed peer-free `StudentUpcomingResponse`.
`GET /student/attendance` (`attendance.read.self`) reads the caller's own bounded (`take:100`)
`attendanceRecord.findMany` + the `{total,present,absent,absentExcused,late,leftEarly}` summary reduce →
`StudentAttendanceResponse`, **RGPD-minimised in the payload shape** (NO `recordedBy`/`justifiedBy`/staff-
`comment` actor metadata — only status/justification/date/subject/class). Both run `resolveSelf`
(server-derived `userProfileId === me.id`, no `:studentId` path param → IDOR structurally absent) →
`canAccessStudent(ownId)` defence-in-depth → `ForbiddenException` rather than leak; tenant-scoped; unlinked →
kind empty payload. `AnalyticsModule` wired into `StudentPortalModule`; new `student-portal.service.spec.ts`
(6 cases). FE: `/student/upcoming` (grouped soonest-first) + `/student/attendance` (calm factual summary
strip + non-stigmatising status badges) reusing `@pilotage/ui` + `PortalShell portal="student"`; two new
`studentSidebarItems` ("À venir", "Mon assiduité"). **Recovery note:** the BMAD Workflow's implement/verify
agents all hit the daily session limit (only intake + the S2 story spec landed); the lock-holding session
implemented the slice directly from the story spec, then ran the single build + typecheck + targeted spec.
**Operator step unchanged:** activate the `student` realm-role + demo user and run the additive S1
`prisma db push`. **E8-S3 is now shipped** (`epic-slice` — P1 `[auth][abac][rgpd][api][web][student-portal][announcements]`,
needs human review): the final slice — **"Les annonces"** + the visionary **"Mon objectif"** student dashboard.
`GET /student/announcements` (`announcements.read.self`) returns the caller's OWN `AnnouncementReceipt` rows for
published/non-expired/tenant-scoped announcements (pinned-first), narrowed to the peer-free `StudentAnnouncementRow`
(NO roster / read-stats / author email); `POST /student/announcements/:id/read` is the ONE student mutation —
idempotent receipt `readAt` flip keyed on `(announcementId, me.id)` (IDOR structurally absent; 404-no-leak when no
receipt); `GET /student/dashboard` (`analytics.read.self`) composes "Mon objectif" best-effort from a SELF-ONLY
`StudentSubjectSnapshot` trend read (snapshot-first + single-aggregate live fall-through, NEVER `parentDashboard`
nor the O(class) scan — architect P0-2), the next-3 `parentUpcoming` re-scoped to self, and the E7
`remediationProgress` line reused verbatim. `StudentDashboardResponse` **structurally lacks** every peer-relative
field (type-level wall, asserted no-peer-key). The §5 FR-S3-7 design gap is closed: `computeRecipients` now
additively unions each enrolled+linked student's OWN `UserProfile` into the class/grade/cycle/individual scopes
(guarded `userProfileId != null`, guardians/teachers unchanged, no back-fill → publish-time-only semantics). FE:
`/student/dashboard` (`SubjectTrendCard` + next-3 preview + second-person `StudentSupportStrip` reusing the E3
emerald IMPROVEMENT lane) + `/student/announcements` (`StudentAnnouncementCard` + self-scoped mark-read
`'use server'` action), reuse-first on `@pilotage/ui` (no `packages/ui` change); `PORTAL_LANDING.student`
re-pointed to `/student/dashboard`. Wall on every read: `resolveSelf` → `canAccessStudent(ownId)` →
`ForbiddenException`; tenant-scoped. New `announcements.service.spec.ts` (3 cases) + extended
`student-portal.service.spec.ts`. **No schema, no new permission (S1-seeded `announcements.read.self` +
`analytics.read.self` cover it), no new ADR, no second queue.** **`E8` is now `shipped` (all 3 slices landed).**
**Operator pre-req unchanged (gates demoability, not merge):** apply the additive S1 `Student.userProfileId`
`prisma db push` + activate the `student` realm-role/demo user. **Next epic → resume `E7 — Remediation &
Tutoring loop` (`in-progress`; S6 loop-hardening was the next open slice), else promote the highest Tier-4
filler (E9 enrollment self-service / E10 quality bar).**

---

## Tier 4 — Foundation, quality & interop (interleave as filler)

- **E9 — Enrollment self-service UI** · `shipped` · ~S — parent child-claim form + admin approval
  page (backend 90% ready). Completes the cahier's parent→admin validation workflow. **Both slices landed
  (S1 parent claim+match+pending, S2 admin approval queue + atomic grant/reject + notify + UIs).**
  **Spec-kit:** ✅ landed `docs/spec/features/e9/` (2026-06-10, epic-spec, docs-only): spec/plan/data-model/
  contracts(openapi)/ux/tasks/quickstart/PROGRESS + `stories/S1-…`. Locked decisions: reuse the existing
  `Guardianship.status` (pending/active/revoked) + `approvedBy`/`approvedAt` backbone (verified in
  `schema.prisma`); the **one additive schema** = a new `GuardianshipClaim` model + `GuardianshipClaimStatus`
  enum + a boot-applied partial-unique open-claim index (E7-S2 `BookingIndexBootstrap` idiom), **no new
  datastore/queue/`NotificationKind`** (approve/reject reuse `enrollment_status`); a **deny-by-default,
  non-enumerating** server-side matcher (exact `externalRef` else name + mandatory DOB, exactly-one candidate
  → `pending` link; shape-identical no-leak response + rate-limit; child name surfaces only post-approval);
  one new parent-only `guardianships.claim` permission (admin rides existing `guardianships.approve`); the one
  new architectural decision (claim→link lifecycle + non-leak match + open-claim concurrency) →
  **`docs/adr/ADR-022`** authored on the **S1** run. **Two thin slices:** S1 parent claim+match+pending (→
  ADR-022, `[schema][auth]`) · S2 admin approval queue + atomic `pending→active` grant.
  - [x] **S1** — parent self-service child-claim + deny-by-default match + `pending` link. **Shipped**
    (`epic-slice` — P1 `[schema][auth][abac][rgpd]`, **needs human review — RED gate fixed in-flight**): the
    one additive `GuardianshipClaim` model + `GuardianshipClaimStatus` enum + additive back-relations on
    `Guardian`/`Student`/`Guardianship` (no existing column/enum value changed) + the boot-applied
    partial-unique open-claim index (`guardianship-claim-index.bootstrap.ts`, the E7-S2
    `BookingIndexBootstrap` idiom); the new parent-only `guardianships.claim` permission (`permissions.constants.ts`
    line 261 + both seeds — admin/teacher/student get 403); a parent-walled `child-claims` module
    (`POST /parent/child-claims` server-derived `Guardian`/tenant/school + a **pure deny-by-default matcher**
    `claim-match.ts` — exact `externalRef` else name+mandatory-DOB, exactly-one candidate, no fuzzy, never
    cross-school — driving a **`pending` Guardianship, NEVER `active`**; **byte-identical `UNIFORM_RECEIVED`**
    across matched/no-match/ambiguous; per-guardian rate-limit; `GET` self-scoped list; `POST :id/withdraw`
    404-before-403, double-withdraw no-op), append-only audit, P2002-race collapse; the
    `packages/contracts/src/dto/child-claim.ts` DTO; the parent FE (`ChildClaimDrawer` +
    `ChildClaimsStatusStrip` on `/parent/children`, graceful "indisponible" degrade when the additive
    `db push` is still pending); `docs/adr/ADR-022-enrollment-self-service-child-claim.md`. RED gate fixed
    in-flight: the 8 stale-Prisma-client TS2551/TS7006 errors cleared by `prisma generate` (the E7-S5/E8-S1
    stale-client pattern — no source edit). **Operator pre-req (gates demoability, not merge):** the additive
    `guardianship_claim` `prisma db push`. *(schema [schema][auth][abac][rgpd] tag)*
  - [x] **S2** — admin approval queue + atomic `pending→active` grant + approve/reject notify + UIs.
    **Shipped** (`epic-slice` — P2 `[auth][abac]`, needs human review): the NEW admin-only
    `admin-child-claims.controller.ts` (`@Controller('admin/child-claims')`, **walled entirely by
    `guardianships.approve`** — NOT bare `guardianships.read` which parent+teacher hold, closing the
    pre-mortem FM-1 PII leak; server-derived `me.tenantId`/`me.id`; `ParseUUIDPipe`; `?status` defaults to
    `submitted`, enum-validated → 400). Three additive `ChildClaimsService` methods: `listQueueForAdmin`
    (ONE tenant-scoped aggregate `findMany`, oldest-first FIFO, no N+1, derived `matchMethod`),
    `approveClaim` (404-before-403 → idempotent re-approve no-op 200 → 409 on non-submitted/match-failed →
    ONE `$transaction`: from-status-guarded link `pending→active` +`approvedBy/At` (`count===0` → ADR-020
    deterministic 409 loser), claim `submitted→approved` +`decidedBy/At`, append-only
    `guardianship.claim_approved` audit — **this single transition IS the access grant**), `rejectClaim`
    (required reason, link `pending→revoked`, claim `submitted→rejected` +`decisionReason`,
    `guardianship.claim_rejected` audit, grants nothing, re-submit stays open). The `audit()` helper
    parametrised `actor:'parent'|'admin'` (admin decisions log `actorRole/portal:'admin'`). Best-effort
    `notifyParentOfDecision` runs AFTER commit, try/catch-swallowed (reuses `enrollment_status` kind —
    NO `guardianship` kind; `sourceType='guardianship_claim_{approved,rejected}'`; approve→child deep-link,
    reject→re-submit) — a notify/Redis failure NEVER rolls back the decision (FM-7/FM-8). 4 additive
    contract schemas (`AdminChildClaimRow`/`…QueueResponse`/`RejectChildClaimRequest`/`ApproveChildClaimResponse`).
    FE = `/admin/child-claims` (server-component `page.tsx` `force-dynamic` + `safe()` empty-state degrade,
    `KpiCard`, `ChildClaimsQueue` evidence-card island with optimistic approve + reason-required reject
    `FormDrawer` over the hardened Drawer focus-trap + `role=status` live region, `actions.ts`, FE-local
    `types.ts`) + a new "Demandes de rattachement" admin sidebar item (`UserPlus`). The S1 parent strip
    already renders approved/rejected (verified, no parent FE change). S2 P0 spec suite added.
    **No schema change, no new permission, no new ADR, no second queue, no new `NotificationKind`** (reuses
    ADR-020/ADR-022). **`E9` is now `shipped` (both slices landed).** **Operator pre-req (gates demoability,
    not merge):** the additive `guardianship_claim` `prisma db push` + `packages/contracts/dist` rebuild.
- **E10 — Quality bar: authenticated E2E + WCAG 2.2 AA** · `shipped` · ~M — Playwright journeys
  (grade publish → parent alert; parent claims child; messaging) + an axe-core WCAG-2.2-AA sweep over the
  authenticated pages. Maps to R9/R10. **All four slices (S1–S4) landed → `shipped`.** **Spec-kit:** ✅ landed `docs/spec/features/e10/` (2026-06-10,
  epic-spec, docs-only): spec/plan/data-model/contracts(openapi + auth-fixture/journeys/a11y-scan
  notes)/ux/tasks/quickstart/PROGRESS. Locked decisions: E10 extends the **existing** Playwright harness
  (`apps/web/playwright.config.ts` + `tests/e2e/smoke.spec.ts` + `@axe-core/playwright`, all on disk) for
  **authenticated** journeys + an authenticated WCAG-2.2-AA axe sweep — the public smoke spec stays
  unchanged; **zero production schema/endpoint/permission/`NotificationKind`/queue change** in any slice;
  the visionary spine = a reusable portal-aware authenticated-session fixture (admin/teacher/parent/student,
  auth-once-per-role → cached gitignored `storageState`, seeded from the `voltaire-demo` tenant) so every
  future epic appends a one-line end-to-end journey (a permanent regression net, not a one-off QA pass);
  tests skip-when-stack-down (never a false-red); the one new architectural decision (a CI-runnable
  authenticated E2E + a11y test layer) → **`docs/adr/ADR-023-authenticated-e2e-and-a11y-layer.md`** authored
  on the **S1** run (ADR-022 confirmed last on disk → 023 is next-free). **Four thin slices:** S1 auth-session
  fixture + journey #1 (grade publish → parent explainable alert) + first authenticated axe AA scan (→ ADR-023)
  · S2 journey #2 (parent child-claim → admin approval, E9) · S3 journey #3 (parent ↔ teacher messaging, E2,
  dual-wall round-trip) · S4 cross-portal WCAG 2.2 AA sweep + remediation (on land → E10 `shipped`). Hard
  non-goals: no new product capability/endpoint/schema/permission/queue; no CI-provider pipeline standup
  (recorded follow-on); no build/rebuild in the E2E path; no new seed or real children's data;
  no visual-diff/perf/cross-browser/AAA/manual-audit; no widening of any ABAC/tenant/portal wall.
  **E10-S1 is now shipped** (`epic-slice` — P2 `[test][a11y][e2e]`, needs human review): the load-bearing
  spine — a reusable portal-aware authenticated-session fixture (`apps/web/tests/e2e/fixtures/users.ts`
  env-overridable demo-seed table + `auth.setup.ts` setup project logging in once per role via the REAL
  `/{portal}/login` form, asserting landing URL + `expectedRole`, transport-only skip-when-down +
  `fixtures/portal-fixtures.ts` per-role `adminPage`/`teacherPage`/`parentPage`/`studentPage` contexts
  over the cached git-ignored `.auth/{role}.json`); the first critical journey
  `journeys/grade-to-alert.spec.ts` (`@journey`) that **guards the cahier's promise** — FAILS unless the
  first parent alert carries rule (CODE_LABEL pill) + subject/title + a non-empty body + the E1 "Que
  puis-je faire ?" CTA (information→action, not a 200); the first authenticated WCAG-2.2-AA axe scan
  `a11y/authenticated.a11y.spec.ts` (`@a11y`) of `/parent/dashboard` (critical/serious hard-fail) **plus a
  sanity-injection test proving the gate bites** (no false green); `playwright.config.ts` gains a `setup`
  project + a `setup`-dependent authenticated project running ONLY `journeys/**`+`a11y/**` while the public
  `chromium` project IGNORES them (PM-7 isolation, smoke runs once logged-out); `package.json`
  `test:e2e:a11y`+`test:e2e:journey` scripts; `.gitignore` ignores the live-session `.auth/` (AC-8); and
  **`docs/adr/ADR-023-authenticated-e2e-and-a11y-layer.md`** (Accepted, 023 re-verified next-free after
  022). **No schema/endpoint/permission/`NotificationKind`/queue change; no build in the E2E path; no WCAG
  remediation needed in this slice's authored markup.** **Merge evidence required (Murat gate):** one
  non-vacuous authenticated run against the booted `:3100` stack — `test:e2e:journey` PASSES (not skipped)
  + `test:e2e:a11y` PASSES incl. the sanity-injection — since the typecheck gate can't exercise a
  browser suite.
  **E10-S2 is now shipped** (`epic-slice` — P2 `[test][e2e]`): the cross-portal parent↔admin journey
  `tests/e2e/journeys/child-claim-approval.spec.ts` (`@journey`) driving BOTH the S1 `parentPage` **and**
  `adminPage` fixtures in one spec — parent submits an E9-S1 `ChildClaimDrawer` claim on `/parent/children`
  (calm "Demande envoyée"/"déjà rattaché·e" ack, never `role=alert`) → admin opportunistically + idempotently
  approves a pending row on `/admin/child-claims` → parent reloads and the **atomic approve = access**
  invariant is asserted **structurally** through the real ABAC wall (approved ⇒ ≥1 accessible child dossier
  whose `Voir le profil`/`Voir le dossier` route is navigated and resolves, not a bounce-to-login; a pending
  row stays the neutral "En cours de validation"). Re-runnable on a stable seed (run-stamped surname,
  assert-the-invariant-not-a-virgin-pre-state); `test.skip`s calmly when the E9 backend is not migrated.
  `ACTIVE_PORTALS` extended to `['parent','admin']` (the setup now also authenticates the rich `voltaire-demo`
  admin `mme.dupont@voltaire.fr` / `guardianships.approve`). **No schema/endpoint/permission/fixture/ADR;
  reuses the S1 fixture spine + ADR-023 entirely; `.auth/` stays git-ignored; `webServer` stays `next dev`;
  no build in any path.** Known limit (recorded follow-on for S3/S4): a run-stamped no-match claim persists as
  `match_failed` and never enters the `submitted`-only admin queue, so on a clean seed the approve branch is a
  calm no-op and the headline assertion leans on the seed-linked guardianship; a negative-wall assertion (an
  ILLEGITIMATE parent↔child pair is DENIED the access link) is the recommended complement.
  **E10-S3 is now shipped** (`epic-slice` — P2 `[test][e2e][a11y][web][messaging][abac]`): the cross-portal
  parent↔teacher journey `tests/e2e/journeys/parent-teacher-messaging.spec.ts` (`@journey`) driving BOTH the
  S1 `parentPage` **and** `teacherPage` fixtures in one spec — parent opens `/parent/messages/new`, the
  server-filtered eligible-teacher list (`ComposeForm` → `/messaging/eligible-teachers`) RESOLVING a selectable
  teacher IS the guardianship ∩ teaching POSITIVE-wall, sends a **run-stamped** message and lands in the
  created/reused thread → teacher opens `/teacher/conversations`, finds the row by run-stamp, **replies** with its
  own run-stamped text (the `TeacherThreadReply` composer, mark-read on mount) → parent reloads and sees the reply,
  closing the round-trip both directions through the real wall. The **NEGATIVE wall** is asserted structurally with
  no new seed: the compose surface offers NO free-text teacher entry (a bounded picker fed only by the eligible
  list) and renders the calm "Aucun enseignant à contacter" empty-state with no picker when no current teacher
  exists — an illegitimate pair is denied at the affordance. Re-runnable on the stable `voltaire-demo` seed
  (presence-only assertions on base36 run-stamps; E2 create-or-reuse appends). `ACTIVE_PORTALS` extended to
  `['parent','admin','teacher']` (the setup now also authenticates the rich `voltaire-demo` teacher
  `teacher.demo@voltaire.fr`, env-overridable via `E2E_TEACHER_*`). PM pairing guard: if the chosen eligible
  teacher ≠ the logged-in teacher session on a given seed, the teacher-side leg `test.skip`s AFTER proving the
  parent-side send + both walls (seed mismatch is not a false red); no-child / no-teacher / not-migrated stacks
  skip gracefully too. **No schema/endpoint/permission/fixture/ADR; reuses the S1 fixture spine + ADR-023 entirely;
  the E2 surfaces are asserted, not modified; `.auth/` stays git-ignored; `webServer` stays `next dev`; no build in
  any path.**
  **E10-S4 is now shipped** (`epic-slice` — P2 `[a11y][test][ui]`): the R9 payoff — the cross-portal WCAG
  2.2 AA sweep `tests/e2e/a11y/cross-portal.a11y.spec.ts` (`@a11y`), a **data-driven** (`SWEEP_TARGETS`
  table, one row per page) axe-core WCAG-2.2-AA scan (`wcag2a wcag2aa wcag21a wcag21aa wcag22aa`, incl.
  **SC 2.5.8 target-size**) over ONE representative authenticated page **per portal**, each riding its S1
  role-session fixture: parent `/parent/dashboard` + `/parent/recommendations`; teacher `/teacher/grades`
  (gradebook) + `/teacher/conversations`; admin `/admin/analytics` + `/admin/child-claims` (one queue);
  student `/student/dashboard`. Each test is independent, asserts no bounce-to-`/login`, waits for the
  stable `PortalShell` `PageHeader` heading, then asserts **zero critical/serious** (moderate/minor =
  opportunistic punch-list). `ACTIVE_PORTALS` extended to `['parent','admin','teacher','student']` so the
  E8 demo-learner session is authenticated for the student sweep; `auth.setup.ts` gives the
  **operator-activated** `student` portal — and only it — a **soft-skip** when not yet provisioned (E8/
  ADR-021: db push + realm-role + demo learner), so the student page `test.skip`s cleanly while every other
  portal keeps the loud-fail (a rejected demo login IS a regression). `test:e2e:a11y` (unchanged grep) now
  spans **public + authenticated parent + cross-portal** in one selection — the **standing a11y gate** —
  documented in `quickstart.md` (three-layer table + the one-row extension recipe + the student
  operator-activation note). Remediation is reuse-first on what the live sweep surfaces; the swept E1/E2/E6/
  E8 + gradebook surfaces were A11y-reviewed to the bar in their own epics and carry **no
  statically-identifiable critical/serious** (non-colour-alone `StatusBadge`, `role="group"`/`aria-label`
  action groups, `aria-hidden` icons + text labels, ≥36px controls, `aria-live` regions, semantic
  headings), so no speculative rewrite of working components was made (a confirmed-violation-first posture —
  never regress a working feature without a real hit). **No schema/endpoint/permission/`NotificationKind`/
  queue/new ADR; reuses the S1 fixture spine + ADR-023 entirely; `.auth/` stays git-ignored; `webServer`
  stays `next dev`; no build in any path.** **Merge evidence (Murat gate):** one non-vacuous authenticated
  run against the booted `:3100` stack — `test:e2e:a11y` PASSES across the cross-portal pages (browser suite
  the typecheck gate can't exercise). **On land → E10 is `shipped`; the next run promotes E11 (interop).**
- **E11 — Standards interop (OneRoster/LTI) + async imports** · `shipped` · ~M — move bulk import
  to the worker (today blocking in-request) + OneRoster roster sync. Interoperability per the cahier.
  **All 4 slices landed (S1 async spine+ADR · S2 reconciliation panel · S3 OneRoster connect+pull+map ·
  S4 idempotent sync apply + conflict arbitration + 24h rollback + re-run convergence) → `E11` is `shipped`.**
  **Spec-kit:** ✅ landed `docs/spec/features/e11/` (this run, epic-spec, docs-only): spec/plan/data-model/
  contracts(openapi)/ux/tasks/quickstart/PROGRESS. Grounded in the verified codebase: bulk import (ADR-017)
  already works but runs **synchronously in the HTTP request** — `ImportsService.apply()` is a single
  `prisma.$transaction(…, { timeout: 60_000 })` on the API thread (a 5 000-row apply holds the request open
  for tens of seconds, dies on a gateway timeout); **zero OneRoster/LTI code exists** today. Locked decisions:
  move the validated batch onto a **3rd BullMQ queue** (`imports`; today only `exports`+`notifications-email`)
  drained by the worker reusing the existing `applyRow`/`rollbackRow` handler contract **byte-for-byte** (one
  apply engine, no fork); a from-status-guarded **crash-safe status machine** (no double-apply) + `sourcedId`/
  `externalRef` **upsert-by-stable-key** idempotency; the visionary spine = a reusable **"Import & sync health"
  reconciliation panel** (created/updated/unchanged/conflict/skipped + per-row drill-down + the existing 24h
  rollback — onboarding/interop as a calm, auditable, reversible event). **Permission reuse:** the existing
  admin-held `integrations.write` (no new permission; CSV import keeps `imports.execute`). **Hard non-goals:**
  LTI is **banner-only** (no 1.3 launch/runtime/grade-passback), OneRoster **CSV-bundle first** (REST a stretch),
  **poll not SSE**, no second datastore/Saga, no auto-delete on SIS removal (soft "à vérifier" conflict). **The
  one new architectural decision (async import/sync execution + idempotent reconciliation) → `docs/adr/ADR-024-
  async-import-sync-and-idempotent-reconciliation.md`** authored on the **S1** run (ADR-023 confirmed last on
  disk → 024 next-free). **4 vertical slices (in `docs/spec/features/e11/tasks.md`):** S1 async spine + 3rd queue
  + worker processor + enqueue-on-apply + ADR-024 (`ImportStatus += queued`) · S2 reconciliation classification
  + the health panel (`ReconciliationClass`) · S3 OneRoster connect+pull+map-to-`ImportBatch` (`RosterSource`+
  `ImportOrigin`) · S4 idempotent sync apply + conflicts + 24h rollback + re-run convergence (no schema). Each
  schema slice carries an additive `db push` operator pre-req (E7/E8/E9 precedent). **E11-S1 is now shipped**
  (`epic-slice` — P1 `[schema][worker][async]`, **needs human review — RED gate, NOT auto-merged**): the async
  spine. The apply engine + 5 handlers + `applyRow`/`rollbackRow` + caches are **relocated** into a NEW
  `packages/imports-core` workspace package (`main → dist`, the `@pilotage/contracts` precedent), so the API
  (validate) and worker (apply) share ONE byte-for-byte implementation (the API `handlers/index.ts` +
  `handler.types.ts` become thin re-exports — no forked engine). `ImportsService.apply()`/`rollback()` flip the
  batch `validated → queued` / `applied → queued` via a from-status-guarded `updateMany` then enqueue on the
  **third `imports` BullMQ queue** (registered in both producer + consumer, mirroring `exports` 1:1); the
  enqueue-failure path reverts the claim (never a stuck `queued`), the 24h rollback window is checked *at
  enqueue*. The worker `ImportsProcessor` (sibling of `ExportsProcessor`) claims `queued|applying → applying`,
  runs the relocated engine in one atomic `$transaction`, and the per-row RESUME skips already-`applied` rows
  with a `createdEntityId` (no double-apply under redelivery). New `ImportStatusPoller` (`router.refresh()` on
  a 2.5 s interval, stops on terminal status — the E6-S4 discipline) keeps the detail page live across the
  async transition. `ImportStatus += queued` (additive); every worker query re-scopes on the payload `tenantId`
  (ADR-002 defence-in-depth); `docs/adr/ADR-024-async-import-sync-and-idempotent-reconciliation.md` (Accepted).
  **RED gate (why NOT auto-merged):** `pnpm install` was never run after adding the `@pilotage/imports-core`
  workspace package, so its `@prisma/client`/`@pilotage/tsconfig` deps are unlinked → `pnpm typecheck` fails
  (3 error classes, one root cause); the api/worker consumption sites typecheck GREEN. **Operator pre-req:**
  `pnpm install` → `pnpm build` (produce `packages/imports-core/dist`), `prisma db push` (`queued` enum), a
  worker with the `imports` queue registered. **Known follow-ups (recorded for S-hardening):** the stale-
  `applying` reclaim is an UNCONDITIONAL re-admit, not the `claimedAt < now - IMPORTS_APPLY_STALE_MIN` lease
  ADR/FR6 cite (dead-worker safe; blocked-but-recovering worker is the gap); the enqueue-time
  `revalidatePath('/admin/classes'|'/admin/subjects'|'/admin/dashboard')` is dead at enqueue (nothing written
  yet) and never re-fires on async completion → downstream lists stale until next navigation. **E11-S2 is now
  shipped** (`epic-slice` — P1 `[schema][api][web][a11y][rgpd]`, **GREEN — auto-merged**): reconciliation
  classification + the "Import &
  sync health" panel. Additive `db push`: `enum ReconciliationClass {created updated unchanged conflict
  skipped}` + `ImportRow.reconciliation`/`conflictFields` + `@@index([batchId, reconciliation])`. The
  externalRef match is **no longer a hard `invalid` reject** — `studentsHandler.applyRow` (in the relocated
  `@pilotage/imports-core`) takes an idempotent **match path**: identical identity → `unchanged` (no write);
  a **protected-field** (firstName/lastName/birthDate) disagreement → `conflict` recorded in `conflictFields`
  with **NO write** (the FR4 RGPD no-silent-overwrite wall); an email/notes-only diff → `updated` (writes
  exactly those non-protected fields). The engine rolls a `byClass` tally into the existing `summary` Json +
  `import.apply` audit `after` (no new column/audit action; `applied`/`skipped` byte-identical), and a RESUME
  re-tallies an already-`applied` row from its stored class (FM-2/FM-10). FE = the **non-stigmatising**
  "Bilan d'import & synchronisation" panel (5 KPI cards, `conflict`/`skipped` = amber "À examiner", destructive
  red reserved) + a `?reconciliation=` row facet deep-linking the conflict filter + a per-row source-vs-current
  `ConflictDiff`, all degrading to **no panel** pre-migration (null = neutral zeros). **The load-bearing safety
  fix (the one that makes this shippable):** because matched `updated`/`unchanged` rows now carry
  `createdEntityId = a PRE-EXISTING student`, the rollback engine was rewritten to compensate **ONLY rows this
  import actually created** (`reconciliation == null` legacy/byte-parity OR `=== created`); matched rows are
  flipped to `rolled_back` for bookkeeping but the entity is **never `deleteMany`'d** — closing an irreversible
  cascade-delete of a real child's enrollments/grades/guardianships that the advertised 24h rollback would
  otherwise trigger after an idempotent re-import. The worker now carries `reconciliation` into BOTH the apply
  (re-tally) and rollback (the exclusion data) `engineRows` maps. **RED gate (fixed in-flight):** 8 typecheck
  errors, all the stale-Prisma-client pattern (schema added the enum/columns but `prisma generate` was never
  run) + one `ReconciliationTally` JSON-assignability fix (an index signature on the interface) → `pnpm
  typecheck` 13/13 GREEN. **Operator pre-req (gates demoability, not merge):** `prisma generate` + the additive
  `prisma db push` (enum + 2 columns + index), then `pnpm build` (`packages/imports-core/dist`). **Resolved in
  the land pass (no open blocker at merge):** (1) **ADR drift — FIXED** — ADR-024 now carries a
  `## Reconciliation classification (E11-S2 — amendment)` section (the 5-class taxonomy, the externalRef-first
  idempotency anchor, the protected-field `{firstName,lastName,birthDate}` allow-list + no-silent-overwrite
  wall, the `byClass` roll-up, the rollback delete-only-what-we-created invariant, the `all_or_nothing` shift),
  so the cited "§reconciliation" reference resolves (project-context §3 met). (2) **Rollback safety test —
  ADDED** — `imports-engine.spec.ts` now pins the P0 guard ("SAFETY … rollback compensates ONLY rows this
  import CREATED"): an `updated`/`unchanged` row is flipped to `rolled_back` WITHOUT `rollbackRow` being
  invoked, only `created`/legacy-null rows are compensated. **Carried to S-hardening (non-blocking):** (3) With
  matching introduced, `all_or_nothing` no longer guarantees true all-or-nothing — a `conflict` is discovered
  only in the worker, leaves the row unapplied, yet the batch finalizes `applied` (intended: deferred to S4
  arbitration; confirm the semantic shift is acceptable). (4) Minor copy/a11y polish (panel missing
  `role=status`; rows-table `th` missing `scope=col`; `updated` rows carry no `conflictFields` so the FE diff
  branch is dead for them; guardians still default to `created`). **E11-S3 is now shipped**
  (`epic-slice` — P2 `[schema][api][web][integration]`, **needs human review — RED gate (Prisma-generate),
  NOT auto-merged**): OneRoster source connect + pull + map-to-`ImportBatch`, CSV bundle first, on the EXISTING
  admin-held `integrations.write` (no new permission). Additive `db push` = `ImportOrigin`/`RosterSourceKind`/
  `RosterSyncStatus` enums + the tenant+school-scoped `RosterSource` model (opaque `credentialRef`, never
  returned — the DTO exposes `hasCredential: boolean`) + `ImportBatch.origin`/`rosterSourceId`. A new
  `IntegrationsModule` (`POST/GET /api/v1/integrations/oneroster` + `:id`, `:id/sync`); the pure
  `oneroster.adapter.ts` maps a OneRoster v1.1 **CSV bundle** (`users`/`classes`/`enrollments` — **roster
  identity + enrollment ONLY**, RGPD-minimal: no birthDate/grades/medical, `sourcedId`→`externalRef` as the
  idempotency anchor) onto the EXISTING `ImportRow` shape per `ImportType`, reusing each handler's `validateRow`
  byte-for-byte (no forked validation) to produce one **`validated` `ImportBatch(origin=oneroster)`** per type —
  so a sync **inherits S1's async apply + S2's reconciliation panel for free** (the worker reads neither new
  column). `MAX_ROWS` (5000)/empty → `failed` pull, never a corrupt apply. FE = a new `/admin/integrations`
  surface (connect FormDrawer + "Synchroniser" → lands on the produced batch's health/detail page), a OneRoster
  origin badge on the batch header, a new "Intégrations" sidebar item, degrading kindly to "indisponible"
  pre-migration. ADR-024 carries an `## OneRoster source connect + pull + map (E11-S3 — amendment)` section;
  Murat P0 = `oneroster.adapter.spec.ts`. **RED gate (fixed in-flight by Murat):** 13 typecheck errors, all the
  stale-Prisma-client pattern (the additive enums/model/columns were in `schema.prisma` but `prisma generate`
  was never run) → `pnpm exec prisma generate` in `apps/api` → `@pilotage/api#typecheck` 13/13 GREEN, no source
  edits needed. **Operator pre-req (gates demoability, not merge):** the additive `prisma db push` (3 enums +
  `RosterSource` + 2 `ImportBatch` columns) + `prisma generate`. **Verify-panel follow-ups carried to S4
  (non-blocking, all within-tenant — no cross-tenant leak):** (a) `requireSource` returns **403 not the
  spec-mandated 404** on a cross-tenant id (a `findUnique`-by-id existence oracle over the UUID space — FR5/AC-6
  want `findFirst({id, tenantId})` → 404); (b) `sync` derives `schoolId` from the actor's **active school**
  (`forTenant`) not `source.schoolId`, so a multi-school tenant can mis-file a school-A roster into a school-B
  batch (FR10); (c) `MAX_ROWS` is enforced **per-type** not across the combined mapped count (12k combined
  passes); (d) the enrollments-batch placeholder-UUID linkage on a first combined pull (re-resolve at apply or
  ship students-only in v1); (e) the connect audit action is `import.sync.connect` not the spec's
  `integration.roster_source.created`. **E11-S4 is now shipped** (`epic-slice` `[api][worker][web]` P2,
  **no schema** → **`E11` is `shipped`, all 4 slices landed**): the `origin=oneroster` batch applies through the
  S1 async worker + S2 reconciliation classification with **zero new execution code**; net-new = admin conflict
  arbitration (`POST /imports/:id/conflicts/:rowId/resolve` keep-current/take-source on the existing
  `imports.execute`, in-request `$transaction` via the handler's optional `resolveConflict` + shared
  `resolveRowConflict` wrapper, `take_source` the only audited protected-field overwrite, matched row kept out of
  the rollback delete set, append-only `import.conflict.resolve` audit) + proven re-run convergence (0 created on
  the 2nd sync) + the non-destructive SIS-delete posture (absent student left intact, `tobedeleted` skipped) +
  24h rollback reused from S1 (provenance-aware copy). FE `ConflictResolver.tsx` island (amber strip +
  focus-trapped `FormDrawer` + keyboard radiogroup + `role=status` toast). ADR-024 carries the S4 amendment
  section. The S3 follow-ups (a–e above) remain recorded as hardening — not in S4's scope. E12 is the next epic,
  parked.
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
