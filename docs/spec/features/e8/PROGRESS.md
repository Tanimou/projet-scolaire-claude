# E8 — Progress

> Epic: **E8 — Student Portal** · Tier 3 (Scale & new surfaces) · Size ~M
> Spec-kit run: **2026-06-10** (docs-only; no code, no schema, no build). Roadmap status: `proposed`
> → promoted to **in-progress** (spec authored on this run). **Next slice → E8-S1.**

## Slice status

| Slice | Title | Tags | Risk | Status | PR |
|---|---|---|---|---|---|
| S1 | Student role + self-ABAC + auth wiring + "Mes notes" → **ADR-021** | `[schema][auth]` | P1 | 🟢 shipped — green (all blockers reconciled; build 7/7; auto-merged) | this run |
| S2 | "À venir" + "Mon assiduité" | `[auth][rgpd][abac]` | P1 | 🟢 shipped — green (build 7/7, typecheck 11/11, spec 6/6) | this run |
| S3 | Announcements + "Mon objectif" actionable student dashboard (E6 trend + E7 progress) | `[web][a11y][analytics]` | P2 | 🟢 shipped — green | this run |

## What landed this run (spec run)

- `docs/spec/features/e8/` spec-kit authored: `spec.md`, `plan.md`, `data-model.md`, `ux.md`,
  `contracts/openapi.yaml`, `tasks.md`, `quickstart.md`, this `PROGRESS.md`. **Docs only** — no code, no
  schema, no migration, no build.
- Roadmap: **E8 promoted `proposed` → `in-progress`** (`bmad/roadmap.md`, reconciled on land).

## Key locked decisions (the spec's spine)

- **A fourth, read-only audience — the learner.** E8 surfaces the cahier's *Portail élève*: a student
  sees **only their own** dossier (grades, upcoming assessments, attendance, announcements) + an
  actionable **"Mon objectif"** dashboard. **No student write of any kind** (no booking, no messaging
  initiation, no flag/ack/revise — read-only).
- **Activate the reserved `student` Keycloak realm-role.** ADR-004/ADR-015 already declare `student`
  "(futur)"; E8 *activates* it (realm export + JWT read + role guard + a thin read-only default
  permission set). The student **reuses the `portal-parent` OIDC client** in S1 (a dedicated
  `portal-student` client is a recorded ADR-021 alternative, not an S1 requirement).
- **The student-self ABAC wall — deny-by-default, self-only, NEVER peer comparison.** A `student`
  caller's student scope is **exactly `[ownStudentId]` or `[]`** — **never `null`** (the admin/teacher
  "unrestricted" sentinel). Self is resolved **server-side** from `Student.userProfileId === me.id`;
  there is **no `:studentId`** path param on any `/student/*` route (a client-supplied id is ignored).
  No student read returns a peer's data, a roster, or a ranking.
- **The peer-comparison wall lives in the PAYLOAD SHAPE, not just the UI.** The student dashboard DTO is
  a **narrowed projection** of the parent dashboard response that **structurally lacks**
  `studentRank` / `classAverage` / `classRankTotal` (the E4 `ParentExportJobDto` narrowing precedent) —
  so no peer-relative figure can leak even if the UI is wrong.
- **The one new architectural decision = student role activation + student-self ABAC + client/permission
  posture** → **`docs/adr/ADR-021-student-role-and-self-abac.md`**, authored on the **S1** implementation
  run (the slice that wires the role + the wall + the first read). ADR number **021** = next free after
  `ADR-020` (verify the index at authoring time, per the E6/E7 precedent).

## Schema posture (Winston — authoritative; reconciled this run)

- **Exactly ONE additive schema change in S1: the `Student.userProfileId String? @unique` account
  link** (`onDelete: SetNull`, mirroring `Guardian.userProfileId`) + the `UserProfile` back-relation.
  Additive, nullable, via `db push` (no SQL `migrations/` folder) — safe on existing rows (null link
  until provisioned), no backfill. **S1 is `[schema][auth]`.** S2/S3 add **no** schema.
- **Reconciliation note (this run).** An early draft of `data-model.md`/`plan.md`/`contracts` briefly
  claimed `Student.userProfileId` *already exists* and that E8 was zero-schema. That was a **verification
  error** — the live `model Student` (lines ~430–468 of `apps/api/prisma/schema.prisma`) carries
  `email String?` but **no** `userProfileId`; the `userProfileId @unique` at line ~475 is on **`Guardian`**
  (model starts line 471), the *parent's* link. All kit files were corrected: **E8-S1 adds the
  `Student.userProfileId` link.** `data-model.md` §1 is the authoritative schema record.
- **No second table, no new enum, no new metric, no new BullMQ queue, no new datastore, no second
  Keycloak realm, no new HTTP style.** Beyond the one link, the only DB-adjacent change is the
  permission-seed delta (rows in `permission`/`role_permission`, not a migration).

## Reuse map (what E8 does NOT rebuild)

- The `student` realm-role (reserved, ADR-004/015) — **activated**, not invented.
- `StudentAccessService` — **+ a student-self branch** (fails-closed singleton, never `null`).
- The parent grade / `parentUpcoming` / attendance / announcement-scope producers — **re-scoped to a
  self-resolved `studentId`**, behind the wall.
- E6 `student_subject_snapshot` trend (snapshot-first / live fall-through) — the dashboard trend; **no
  new metric**.
- E7 `RemediationService.remediationProgress` — the kind second-person "ton soutien en {matière}" line;
  read-only (the student never books).
- The `/admin|/teacher|/parent` route-group + AppShell (ADR-003) — a **fourth `/student/*` peer**.
- `@pilotage/ui` + `packages/contracts` — reuse-first; **no `packages/ui` change anticipated**.

## Risk notes for the implementation runs

- **S1 is the load-bearing, `[auth]`-tagged slice** → escalation-panel territory (architect + security +
  test-architect): the **deny-by-default, self-only, never-`null`** invariant must be proven by a
  targeted test before merge (self resolves only own id; unlinked → no data; any peer id → 403/404; a
  `student` token on a parent/teacher/admin endpoint → deny). Sentinel reviews S1 specifically for the
  wall.
- **RGPD / safeguarding** is the throughline: a minor self-serving sees **less** than the parent (no
  `medicalNotes`/guardian-private fields), **never** a peer-relative figure (enforced in the DTO shape),
  read-only. The strictest data posture the platform has — the subject of the data is reading it.
- **Provisioning** (setting `Student.userProfileId`) is seed/import in the MVP — **no provisioning UI**
  in S1–S3 (recorded follow-on; overlaps E9 enrollment self-service). An unlinked account degrades to a
  kind activation gate, never a leak.
- **Permission-naming decision point (recorded, S1 implementer's call):** a dedicated `*.read.self`
  family (data-model §5 / contracts) vs. granting the existing broad read permissions to `student`
  narrowed by the wall (tasks.md S1). Both are recorded as acceptable in the kit; the choice is captured
  in ADR-021. The wall narrows to self **either way**.

## Reconciliation done this run (the kit is now internally consistent)

Parallel Phase-1 planning agents converged on the **same capabilities**; the two cosmetic label
divergences they left have been **reconciled in this spec run** (the E7-PROGRESS reconciliation
discipline) so the kit ships internally consistent. Nothing about scope changed:

1. **ADR filename — RESOLVED.** **Canonical → `docs/adr/ADR-021-student-role-and-self-abac.md`** (the form
   already used by `plan.md` / `tasks.md` / `quickstart.md` / `contracts/openapi.yaml` / this file — 6 of
   the 8 kit files; the more descriptive, conjunction-preserving phrasing). The two minority occurrences in
   `data-model.md` (the `…-student-role-self-abac` variant) were rewritten to this single filename this
   run, so **every kit file now names the same ADR**. The S1 implementer re-verifies `021` is the next free
   number against `docs/adr/` at authoring time (the highest on disk is `ADR-020`; verified this run).
2. **Announcement slice — RESOLVED → ships in S3.** Announcements (`GET /student/announcements`,
   `announcements.read.self`) are placed in **S3** beside "Mon objectif" uniformly across `spec.md` /
   `data-model.md` / `plan.md` / `tasks.md` / `ux.md` / `contracts/openapi.yaml` (the `[S3]` tag) and the
   slice table above — keeping **S2** a clean "upcoming + attendance" read pair and **S3** the full
   read-the-school-to-me + actionable-dashboard slice. The capability is identical (a receipt-scoped read;
   the additive recipient rule so the student's own `UserProfile` gets a receipt when a scope reaches them).
   Either grouping is one PR + one build — the placement is a label, not a scope change.

## What landed this run (E8-S1 — `epic-slice`, GREEN, auto-merged)

The S1 capability was implemented end-to-end and, after a follow-up reconciliation pass, landed
**GREEN** (build 7/7, `@pilotage/web` compiles) as ONE consolidated PR. The initial automated run
shipped it **split across two checkouts** (the documented worktree-path bug, `MEMORY.md`) with a RED
gate; the reconciliation pass consolidated both halves onto one branch and fixed every blocker (see
"Blockers reconciled" below).

- **FE / DS / contracts (this worktree):** the fourth `/student/*` portal — `auth.ts` (4th provider +
  `student` realm-role mapping INV-1 + ADR-021 `portal-parent` OIDC-client reuse), `middleware.ts`
  (`/student/*` deny-by-default + `PORTAL_LANDING.student = /student/grades`), `student` design-token
  ramp (violet hue 292, ≥4.5:1), `studentSidebarItems` ("Mes notes" only), the `/student/login` +
  `/student/grades` + activation-gate surfaces, and `packages/contracts/src/dto/student.ts`.
- **BE / schema / ADR (uncommitted in the MAIN checkout — the worktree-path bug):** the additive
  `Student.userProfileId String? @unique` link, the `student` self-ABAC branch in
  `student-access.service.ts` (+ its 6-case spec), the `student-portal` NestJS module
  (`GET /student/me`, `GET /student/grades`), the `*.read.self` permission family + both seeds,
  `app.module` registration, and **`docs/adr/ADR-021-student-role-and-self-abac.md`**.

## Blockers reconciled (the green-fix pass)

1. **Vertical-slice split (worktree-path bug)** — both halves consolidated onto one branch; DB+API+UI+ADR
   land as ONE PR.
2. **Prisma client stale → 2 TS2353 errors** — resolved via `prisma generate` (the `Student.userProfileId`
   field is now in the client). The additive `db push` itself stays the operator's batched infra step.
3. **FE ↔ contract shape mismatch** — the FE was conformed to the **canonical FLAT** `StudentGradeRow`
   (`subjectName`/`subjectColor`/`maxScore`/`coefficient`/`termId`/`termName`/`scheduledAt`). Two flat,
   RGPD-safe learner-own scalars were added to the contract + BE so the card stays complete-as-designed:
   `kind` (assessment-type chip) + `status:'published'|'revised'` ("Note révisée" badge). No nesting.
4. **ADR-021 landed** — `docs/adr/ADR-021-student-role-and-self-abac.md` is in the diff (Winston-ratified).
5. **AppShell branding crash** — every `/student/*` page 500'd because `student` lacked `branding.read` and
   `fetchBranding` re-threw the 403. Fixed two ways: granted `student` the read-only `branding.read`
   (shared school-identity chrome, RGPD-safe — see ADR-021) **and** hardened `fetchBranding` to degrade to
   null on 403 (cosmetic chrome must never crash a shell).
6. **Login 404** — a fresh student login defaulted to `/student/dashboard` (none exists); now a portal-aware
   landing map sends `student → /student/grades`.

**Remaining operator step (not a code blocker):** activate the `student` Keycloak realm-role + a demo user
in `infra/keycloak/realm-export.json`, and run the additive `prisma db push`, before the portal is reachable
end-to-end at runtime.

## What landed (E8-S2, this run — GREEN: build 7/7, typecheck 11/11, spec 6/6)

Two read-only student-portal surfaces behind the proven S1 student-self wall, **no schema / no new
permission / no new ADR**:
- `GET /student/upcoming` (`assessments.read.self`) — reuses `AnalyticsService.parentUpcoming` **verbatim**,
  re-scoped to the self-resolved `studentId`, projected into the narrowed peer-free `StudentUpcomingResponse`;
  unlinked → `{ classSectionName:null, gradeLevelName:null, data:[] }`.
- `GET /student/attendance` (`attendance.read.self`) — the caller's own bounded (`take:100`)
  `attendanceRecord.findMany` + the `{total,present,absent,absentExcused,late,leftEarly}` summary reduce,
  mapped to `StudentAttendanceResponse`. **RGPD minimisation in the payload shape:** NO
  `recordedBy`/`justifiedBy`/staff-`comment` actor metadata — only status/justification/date/subject/class.
- Wall on every read: `resolveSelf` (server-derived `userProfileId === me.id`, no `:studentId` path param)
  → `canAccessStudent(ownId)` defence-in-depth → `ForbiddenException` rather than leak. Tenant-scoped.
- `AnalyticsModule` wired into `StudentPortalModule`; new `student-portal.service.spec.ts` (6 cases).
- FE: `/student/upcoming` (grouped soonest-first) + `/student/attendance` (calm factual summary strip +
  non-stigmatising status badges) pages; two new `studentSidebarItems`.

> **Recovery note:** the BMAD Workflow's implement/verify agents all hit the daily session limit (only the
> intake + the S2 story spec landed before the cap); the lock-holding session implemented the slice directly
> from the story spec and ran the single build + typecheck + targeted spec.

## What landed (E8-S3, this run — the final E8 slice)

Two read-only student surfaces behind the proven S1/S2 student-self wall + the additive student-receipt
rule. **No schema, no new permission (the S1-seeded `announcements.read.self` + `analytics.read.self`
already cover it), no new ADR, no second queue, no new metric.**

- **`GET /student/announcements`** (`announcements.read.self`) — the caller's OWN `AnnouncementReceipt`
  rows for published, non-expired, tenant-scoped announcements, newest + pinned-first. Mirrors the parent
  receipt projection but NARROWED to the peer-free `StudentAnnouncementRow` (NO recipient roster, NO
  read-stats, NO author email — only title/body/scope/priority/`audienceLabel`/`authorRoleHint`/`readAt`).
  Unlinked / no-receipt → `{ data: [] }`.
- **`POST /student/announcements/:id/read`** (`announcements.read.self`) — the ONE student mutation:
  flips the caller's OWN receipt `readAt` (idempotent), keyed on `(announcementId, me.id)` so it can only
  ever touch the caller's own receipt (`:id` is an announcement id, not a student id → no IDOR); 404 when
  no receipt (never reveals existence).
- **`GET /student/dashboard`** (`analytics.read.self`) — "Mon objectif", ONE aggregate composing
  best-effort (each block in its own try/catch → `[]`, the endpoint always 200s): **(a)** a SELF-ONLY
  per-subject trend read DIRECTLY from `StudentSubjectSnapshot` (year-row, `termId=null`) with a single
  grade-based live fall-through — **NOT** `parentDashboard` (the architect P0-2 binding constraint: the
  parent producer computes `classAverage`/`studentRank`/`classSize` via an O(class) scan; the student
  path runs none of it); **(b)** the next-3 upcoming from `parentUpcoming` re-scoped to self; **(c)** the
  E7 `RemediationService.remediationProgress` line reused verbatim (already peer-free), re-framed
  second-person in the UI. The `StudentDashboardResponse` DTO **structurally lacks** every peer-relative
  field — a contract/type-level wall, proven by a no-peer-key assertion in the spec.
- **The §5 design gap (FR-S3-7) closed:** `AnnouncementRecipientsService.computeRecipients` now additively
  unions each enrolled+linked student's OWN `UserProfile` into `class_section_scope`/`grade_level_scope`/
  `cycle_scope`/`individual_student` (via a new `studentsOwnProfiles` helper, guarded by
  `userProfileId != null`) so a student actually receives receipts. Strictly additive — guardians/teachers
  receive exactly what they did before; an unlinked or non-class student materialises nothing new. **No
  back-fill** — only announcements published AFTER this change materialise student receipts (documented
  MVP limitation). Pinned by a new `announcements.service.spec.ts` (3 regression cases).
- **FE:** `/student/dashboard` ("Mon objectif" hero — `SubjectTrendCard` Block A with icon+text trend
  directions, the next-3 "À préparer" preview Block B, the second-person `StudentSupportStrip` Block C
  reusing the E3 emerald IMPROVEMENT lane, the optional `FreshnessChip`) + `/student/announcements`
  (`StudentAnnouncementCard` with the violet unread accent + the self-scoped mark-read `'use server'`
  action + a `role=status` live region only on the read transition). Two new `studentSidebarItems`
  ("Mon objectif" first / "Annonces" last); `PORTAL_LANDING.student` re-pointed to `/student/dashboard`
  (the hero) — `/student/grades` stays valid. Reuse-first on `@pilotage/ui` — **no `packages/ui` change**.
- **Wall on every read:** `resolveSelf` (server-derived `userProfileId === me.id`, no `:studentId` path
  param) → `canAccessStudent(ownId)` defence-in-depth → `ForbiddenException`. Tenant-scoped. Extended
  `student-portal.service.spec.ts` (announcements narrowing/self-scope, mark-read idempotency+404,
  dashboard composition + best-effort degrade + the peer-field-absence assertion + snapshot live
  fall-through + unlinked).

> **Note on inputs:** this run reconciled a divergence between the story spec (§6 said reuse
> `parentDashboard` + project peer fields out) and the architect ruling + pre-mortem (P0-2 binding: NEVER
> call `parentDashboard` — it ships the peer fields + the O(class) scan). The architect ruling won: the
> dashboard trend is a purpose-built self-only snapshot reader; `RemediationService` is injected directly
> (DI-safe — `RemediationModule` exports it, no edge back to student-portal). The contracts use the more
> constraining `trend: 'up'|'flat'|'down'|'unknown'` direction enum rather than a raw delta.

## Epic status

**E8 — Student Portal is now COMPLETE — all 3 slices shipped.** Operator pre-req unchanged: activate the
`student` Keycloak realm-role + a demo user in `infra/keycloak/realm-export.json` and run the additive S1
`prisma db push` (`Student.userProfileId`) before the portal is reachable end-to-end at runtime.

## Next action

Advance to the next epic per `bmad/roadmap.md` (E8 done → the next `in-progress`/`next` epic; E7
remediation loop or a Tier-4 filler).
