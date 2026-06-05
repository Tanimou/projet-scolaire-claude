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

**Current focus →** `E1 — Parent Alert Action Loop` is **shipped** (S1–S4 all landed; S1 in [PR #103](https://github.com/Tanimou/projet-scolaire-claude/pull/103) — parent ack/resolve/dismiss via guardianship ABAC; **S2** = the "What should I do?" panel with deterministic deep-link next-steps + an append-only, idempotent `alert.meeting_intent` CTA; **S3** = the `MeetingRequest` model promoting that intent into a queryable, role-scoped teacher/admin action center + in-app assignee notification; **S4** = the opt-in weekly parent digest worker cron + email-only `NotificationPreference`). **Next epic → `E2 — Parent ↔ Teacher Messaging`** is now **specced** (epic-spec kit landed at `docs/spec/features/e2/` — spec/plan/data-model/contracts/tasks/quickstart/PROGRESS); the next run should ship **E2-S1** (`epic-slice`: `Conversation` + `ConversationParticipant` + `ConversationMessage` models, dual-wall ABAC = guardianship ∩ teaching-assignment, create/send spine). The codebase was already past the roadmap's "epic-spec first" assumption for E1 (admin lifecycle endpoints + parent read shipped), so the E1 runs were **epic-slices**, not a spec run; the `docs/spec/features/e1/` spec-kit was backfilled one story per slice. **E2-S1 through E2-S4 are now shipped → `E2` is `shipped` (all 4 slices landed; S4 = moderation/safety: report + admin oversight + send rate-limit + opt-in email reusing the existing notification-email pipeline). Next epic → `E3 — Complete the Alert Engine` (the highest-priority `proposed` epic; its spec-kit is not yet written → the next run is an `epic-spec` run for E3).**

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

### E3 — Complete the Alert Engine (7 rules + admin config + email) · `proposed` · ~M
**Audit:** 58% — 5/7 rules live (`LOW_SUBJECT_AVG`, `HIGH_ABSENCE`, `REPEATED_FAILURE`,
`NEGATIVE_TREND`, `MISSING_ASSESSMENT`); cron every 15 min with in-app fan-out.
- [ ] **S1** — `TEACHER_COMMENT_FLAG` rule: teacher can flag a grade/comment as concerning
  (small `TeacherComment`/flag field) → evaluator in **both** api + worker (byte-parity). *(schema+rules)*
- [ ] **S2** — 7th rule (e.g. `BEHAVIOR_ALERT` or `IMPROVEMENT` positive signal) + evaluator.
- [ ] **S3** — Admin **rule-config UI**: thresholds, severity, period, notify on/off, per-school
  (API exists, UI partial). *(web)*
- [ ] **S4** — **Email on the cron path**: cron-raised alerts email guardians honoring prefs
  (today only in-app bell) — share the dispatcher with the API path. *(worker)*

### E4 — Async Exports & Bulletins — wire the UI · `proposed` · ~S-M (high ROI)
**Audit:** exports backend is **100% done** (`ExportJob` + worker + 5 XLSX/PDF generators + S3 +
audit). Only the **frontend is unwired** ("Available soon").
- [ ] **S1** — Admin `/admin/exports`: real "generate" buttons → `ExportJob` + job-status polling +
  signed download links. *(web)*
- [ ] **S2** — **Parent term-summary PDF**: one-click "download my child's report" → `report_card_pdf`
  job → download, audited. The cahier's "synthèse parent PDF par enfant et période." *(web + small api)*
- [ ] **S3** — Teacher class grade-grid export from the gradebook. *(web)*

### E5 — Advanced Notifications (dispatcher + digest + prefs) · `proposed` · ~M
**Audit:** 70% — `Notification`+`NotificationPreference` models, bell, email **queue stub**.
- [ ] **S1** — Finish the **email dispatcher** end-to-end (worker consumes the queue, renders
  templates, honors prefs, MinIO/Maildev). *(worker)*
- [ ] **S2** — **Digest & grouping** to fight notification fatigue (the cahier's explicit ask). *(worker+api)*
- [ ] **S3** — Parent/teacher **notification preferences UI** (channels, frequency, mute). *(web)*

---

## Tier 3 — Scale & new surfaces

### E6 — Analytics Snapshots & pre-computation · `proposed` · ~M
**Why:** a **non-functional requirement** — parent dashboard <2 s at scale. Today analytics are
computed live (40%). Add materialized `student_subject_snapshot` / `student_global_snapshot` /
class distributions, recomputed by the worker on `GradePublished`/`GradeRevised`/coefficient change,
read by the dashboards. (ERD + §6.1 of the cahier.)

### E7 — Remediation & Tutoring loop · `proposed` · ~L
**Why:** closes alert → diagnosis → **resource**: turn a recommendation into a real booking.
New models (Tutor, Availability, Booking, RemediationPlan), catalogue + booking UI, alert deep-link.
The most ambitious epic — spec it carefully, slice thin.

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
