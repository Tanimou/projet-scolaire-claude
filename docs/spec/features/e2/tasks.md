# E2 — Vertical-slice backlog (ORDERED)

> Each slice = ONE capability a parent/teacher can now *do*, demoable end-to-end (DB + API +
> UI + worker as needed), landing as ONE PR + ONE build. The routine implements them **top to
> bottom**, one per run. On Land: tick here, update [`PROGRESS.md`](./PROGRESS.md), and the
> roadmap E2 entry. When all ship → epic `status: shipped`, advance to E3.
>
> A self-contained `story` spec (John, BMAD PM) is authored under `stories/S<n>-*.md` on each
> slice run (mirrors E1's `stories/` backfill).

---

## [ ] S1 — Conversation models + ABAC core + create/send (the spine) · `[schema][auth]` · ~M

**Capability:** a parent can open a thread with one of *their child's current teachers* and send
the first message; the teacher is notified. The dual-wall ABAC (guardianship ∩ teaching) is the
load-bearing deliverable.

- **DB (`[schema]`):** add `Conversation`, `ConversationParticipant`, `ConversationMessage` +
  `ConversationStatus` / `ConversationParticipantRole` enums + the additive `message`
  `NotificationKind` value + the §6 back-relations (`UserProfile`, `Student`, `Subject`,
  `AlertInstance`) to `apps/api/prisma/schema.prisma`. **No SQL `migrations/` folder** (`db push`).
- **API:** new `messaging` module — `POST /api/v1/conversations` (create-or-reuse, idempotent on
  `@@unique`, ABAC at create), `POST /api/v1/conversations/:id/messages` (send, **ABAC re-checked**,
  teaching-wall lapse → `read_only` 403), `GET /api/v1/messaging/eligible-teachers?studentId=`
  (server-filtered compose list). `messaging.read`/`messaging.write` permissions (seed; parent +
  teacher). Reuse `StudentAccessService` (guardianship) + new `isTeacherOfStudent` (teaching).
  In-app notify the teacher on create/send via `NotificationsService.createMany`.
- **Notifications:** add the `message` kind to the in-app fan-out (no new queue, no email yet).
- **UI (minimal proof so the slice is demoable):** a thin parent compose entry (pick eligible
  teacher → type → send) — full inbox/thread UI is S2. (If time-boxed, S1 may ship the parent
  compose only; S2 builds the inbox around it.)
- **Tests (Murat):** create ABAC (403 non-guardian, 403 teacher-not-teaching, 404 cross-tenant);
  idempotent create-or-reuse; send re-check + read_only lapse; tenant isolation. P1.
- **AC:** spec §5 AC1, AC2, AC3 (alert seed not yet wired — `alertId` accepted + validated though),
  AC7, AC8, AC9.

## [x] S2 — Parent messages surface + alert-seeded threads · `[auth]` · ~M  ✅ shipped (needs human review)

**Capability:** a parent has a real `/parent/messages` inbox (list + thread view + compose) AND
the E1 alert CTA opens an **alert-seeded** thread (the visionary hook).

- **API:** `GET /api/v1/conversations` (parent inbox, aggregate, unread counts),
  `GET /api/v1/conversations/:id`, `GET /api/v1/conversations/:id/messages` (paged),
  `PATCH /api/v1/conversations/:id/read`. Wire the `alertId` seed end-to-end on create:
  re-check guardianship on the alert + student match; expose `alertContext` on the thread DTO.
- **UI:** `apps/web/src/app/parent/messages/` — inbox list (unread badges, `@pilotage/ui`,
  `EmptyState`), thread view, compose; **rewire the E1-S2 "En parler à l'enseignant" CTA**
  (`AlertNextSteps`) to open the alert-seeded conversation (Scenario B). Parent nav entry + unread
  badge. Mobile-first, WCAG 2.2 AA.
- **Tests:** inbox aggregate (no N+1), alert-seed access guard (AC3), unread/read-receipt math.
- **AC:** spec §5 AC3 (fully), AC4, plus the alert→conversation continuity.

## [ ] S3 — Teacher inbox (separated from announcements) + reply · `[auth]` · ~M

**Capability:** a teacher sees parent conversations in `/teacher/messages` (kept distinct from
`Announcement`s), opens a thread (with the alert context if seeded), replies, marks-read;
read-receipts show on both sides.

- **API:** the same `GET /conversations` serves the teacher (role-aware: `teacherId = me`);
  reply uses `POST /conversations/:id/messages` (ABAC re-check). Notify the parent on reply.
- **UI:** `apps/web/src/app/teacher/messages/` — inbox separated from the announcements surface,
  thread reply, mark-read, read-receipt indicators; teacher nav entry + unread badge.
- **Tests:** teacher inbox scoping (sees only own threads, not other teachers'); reply ABAC;
  read-only thread is reply-disabled.
- **AC:** spec §5 AC5.

## [x] S4 — Moderation / safety + optional email channel · `[schema][auth]` · ~M  ✅ shipped (needs human review)

**Capability:** either party can report a thread; an admin has read-only oversight of reported
threads; sends are rate-limited; copy is non-stigmatising; an opt-in email channel notifies on
new messages.

- **DB (`[schema]`):** add `ConversationReport` + `ConversationReportStatus` enum + back-relation
  on `UserProfile`/`Conversation`. `db push`.
- **API:** `POST /conversations/:id/report` (participant, idempotent open), `GET
  /conversations/reports` (admin oversight, `messaging.moderate` — admin only). Send **rate-limit**
  (per-sender window). Admin moderation read writes an append-only audit row.
- **Worker:** optional email on new message — **reuse** the existing notification-email
  template/processor, honor `NotificationPreference(message, emailEnabled)`, opt-in OFF by default
  (RGPD). No new queue.
- **UI:** report control on a thread (both portals); admin `/admin/...` moderation oversight list;
  email opt-in row in the shared `PreferencesPanel` (mirror the `weekly_digest` row).
- **Tests:** report idempotency; admin-only oversight scoping; rate-limit boundary; email honors
  prefs + opt-in default OFF.
- **AC:** spec §5 AC6, plus the audit invariants (AC7) for report/moderation.

---

## Cross-slice invariants (every slice)
- `tenant_id` on every model + `where: { tenantId }` on every query; cross-tenant id → 404.
- Append-only audit rows on create / report / moderation-read; messages immutable.
- Reuse `@pilotage/ui`, `NotificationsService`, `StudentAccessService`, `packages/contracts`.
- No client N+1 (aggregate endpoints). No new BullMQ queue. No websocket/SSE without **ADR-019**
  (see [`plan.md`](./plan.md) §5) — the MVP uses polling / revalidation.
- `pnpm typecheck` green (Murat); `prisma generate` + `db push` is the documented pre-merge step.
