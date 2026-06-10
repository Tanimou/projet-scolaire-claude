# E8 — Slice backlog (tasks)

> The shippable vertical slices for **E8 — Student Portal**. Each slice = one PR + one build, demoable
> end-to-end. Ship **in order** (S1 → S3). Per-slice self-contained `story` specs land in
> [`stories/`](./stories/) on each slice's run. See [`spec.md`](./spec.md) for vision/AC,
> [`plan.md`](./plan.md) for architecture, [`data-model.md`](./data-model.md) for the one link + the
> student-self ABAC + the permission family, [`ux.md`](./ux.md) for the screens/states,
> [`contracts/openapi.yaml`](./contracts/openapi.yaml) for the API surface,
> [`quickstart.md`](./quickstart.md) for the manual demo.

**Status legend:** `[ ]` not started · `[~]` in progress · `[x]` shipped.

> **Slice arc:** **S1** stands up the security foundation — **activate** the `student` role, add the one
> additive `Student.userProfileId` link (the only schema step), the thin read-only `*.read.self`
> permission family, the **deny-by-default student-self ABAC** + **ADR-021**, the auth routing to
> `/student/*`, the `/student/me` activation gate, and the first read **"Mes notes"** (`/student/grades`).
> **S2** adds **"Mes prochaines évaluations" + "Mon assiduité"**, each re-scoping an existing aggregate
> behind the *same* proven wall. **S3** ships **les annonces** + the visionary **"Mon objectif"**
> dashboard (E6 trend + E7 remediation progress re-framed second-person + next assessments).
>
> **Authoritative names:** the schema change (the **only** one) lives in [`data-model.md`](./data-model.md) §1
> (`Student.userProfileId String? @unique`, the `Guardian` precedent — verified absent from `model Student`
> today). The permission family is in [`data-model.md`](./data-model.md) §5 (`grades.read.self` /
> `assessments.read.self` / `attendance.read.self` / `announcements.read.self` / `analytics.read.self`,
> student-only). The ADR is **`docs/adr/ADR-021-student-role-and-self-abac.md`**, authored on S1.

---

## [x] S1 — Student role + self-ABAC + auth wiring + "Mes notes" → ADR-021 · `[schema][auth]` · P1 · ~M · **shipped**

**Goal:** the security foundation — the `student` role is activated, a login resolves to **exactly one**
`Student` (the additive link), the **student-self ABAC denies by default** (`[ownId]`/`[]`, never `null`,
never a peer), a `student` login is routed to `/student/*`, and the first read-only surface **"Mes notes"**
lists the caller's own **published** grades by subject. **This is the ADR-021 slice** (role activation +
the student-self ABAC + the OIDC-client-reuse decision). Demoable by logging in as a linked student and
reading *only* their own grades — and proving any other `studentId` (and an unlinked login) returns no
peer data.

**Scope (schema + api + web):**
- **Schema (`db push`, the ONLY E8 schema step):** add the additive optional `Student.userProfileId
  String? @unique @db.Uuid` (`onDelete: SetNull`) + the `UserProfile.studentAccount Student?
  @relation("StudentAccount")` back-relation ([`data-model.md`](./data-model.md) §1). **Verified absent
  from `model Student` today** (the existing `*.userProfileId @unique` is on `Guardian`). No existing
  column changes shape; safe on existing rows (null link until provisioned). `prisma generate`.
- **Permissions (seed delta):** add the five read-only `*.read.self` permissions to `PERMISSIONS` +
  `REALM_ROLE_PERMISSIONS.student` in `permissions.constants.ts` + `seed.ts`/`seed-demo.ts`
  ([`data-model.md`](./data-model.md) §5): `grades.read.self`, `assessments.read.self`,
  `attendance.read.self`, `announcements.read.self`, `analytics.read.self`. **Student gets ZERO write
  permissions** (`remediation.book`/`messaging.write`/`grades.*` write are NEVER granted).
- **ABAC (`StudentAccessService`, the preferred (A) branch — or a dedicated `StudentSelfService`, §2.3):**
  add the `student` branch — resolve `student.findFirst({ where: { tenantId, userProfileId: me.id } })` →
  `studentIds = self ? [self.id] : []` (**never `null`, never a peer id**)
  ([`data-model.md`](./data-model.md) §2). The existing parent/teacher/admin branches are **unchanged**.
- **Auth routing (web):** a `student`-role login is routed to `/student/*` (not `/parent/*`); the existing
  three-portal routing is unchanged. **No new OIDC client** — the student reuses `portal-parent` (the
  ADR-021 decision; a 4th `portal-student` client is the recorded alternative).
- **API:** `GET /student/me` (the activation gate + header identity — `{ student | null, activated }`) +
  `GET /student/grades` (the caller's **published** grades grouped by subject; `studentId`
  **server-resolved**, never a path param; `canAccessStudent(ownStudentId)` before the read; tenant-scoped;
  one aggregate, no N+1). *(Module placement is the implementer's call — a new `StudentPortalController`
  composing existing producers is recommended; see [`plan.md`](./plan.md) §2.)*
- **Provisioning audit:** the admin/seed setting of `Student.userProfileId` writes one append-only
  `student.account_linked` `AuditLog` row (children's-data governance). *(No provisioning UI in scope —
  seed/import for the MVP; see Non-goals.)*
- **Web:** the **`/student`** route group scaffold (`layout.tsx` + AppShell, ADR-003 fourth prefix) + the
  **`/student/grades`** page ("Mes notes" — published grades by subject, reuse-first on `@pilotage/ui`) +
  a kind empty/explainer state for an **unlinked** student (`/student/me` `activated: false` — never a
  leak, never a crash).

**Acceptance (folds spec AC-1/2/3/7/8):**
- The link lands additive via `db push` (`Student.userProfileId @unique`, `SetNull`, mirroring `Guardian`);
  the only existing-model edits are this nullable FK + the `UserProfile` back-relation; no column changed.
- The `student` ABAC resolves **only self** when linked, **`[]`** when unlinked (**never `null`, never a
  peer**); `canAccessStudent` is true only for the own id; the `studentId` is server-resolved (no path
  param); a client-supplied id is **ignored**, not validated. A targeted test pins: self / unlinked-no-data
  / no-peer-leak. The student dashboard/grades payloads **structurally lack** any peer-relative field.
- `/student/grades` returns the caller's **published** grades by subject (no draft/unpublished), behind
  the wall, tenant-scoped, no N+1; a `student` login is routed to `/student/*`; the five `*.read.self`
  permissions are granted to `student` only.
- The student read **excludes** `medicalNotes`/discipline/draft grades/guardian-private fields (RGPD); the
  portal is read-only (no student write endpoint); the provisioning link write is audited.
- **Lands with `docs/adr/ADR-021-student-role-and-self-abac.md`** (Winston gate) recording the role
  activation, the `portal-parent` client reuse (vs. a 4th client), the `Student.userProfileId` link, the
  deny-by-default self-ABAC, and the permission-narrowing rationale; updates the ADR-004/015 "(futur)"
  notes.

**Out of scope:** upcoming/attendance (S2), announcements + the dashboard (S3), any student write, any
provisioning UI, a 4th OIDC client (unless the reviewer chooses it in ADR-021).

---

## [x] S2 — "Mes prochaines évaluations" + "Mon assiduité" · `[auth]` · P2 · ~S-M · **shipped**

**Goal:** breadth — two more read-only student surfaces, each **re-scoping an existing aggregate** behind
the *same* S1 wall. No new security surface (the wall is proven in S1); pure read re-scoping + UI.

**Scope (api + web; no schema):**
- `GET /student/upcoming` — **reuses `AnalyticsService.parentUpcoming({ tenantId, studentId: ownId })`**
  verbatim (upcoming assessments: subject, date, term, coefficient), self-resolved behind the wall.
  `assessments.read.self`.
- `GET /student/attendance` — the caller's attendance summary + recent records (present/absence/lateness/
  justified), factual/kind framing (never a disciplinary verdict, never a peer compare), self-resolved
  behind the wall. `attendance.read.self`.
- **Web:** `/student/upcoming`, `/student/attendance` pages, reuse-first on `@pilotage/ui`; kind,
  non-stigmatising FR copy.

**Acceptance (folds spec AC-4/6):**
- Each surface returns the caller's **own** data only (upcoming / attendance), re-scoping the existing
  aggregate behind the wall; another `studentId` is ignored (server-resolved); tenant-scoped, no N+1.
- Kind, factual, non-stigmatising copy; no peer comparison; no disciplinary framing; read-only; no medical/
  guardian-private field exposed. **No schema change, no new permission beyond the S1-seeded set.**

**Out of scope:** announcements + the "Mon objectif" dashboard (S3).

---

## [x] S3 — "Les annonces" + "Mon objectif": the actionable student dashboard (the visionary spine) · `[web][a11y][analytics]` · P2 · ~M · **shipped**

**Goal:** the payoff — the announcements that reach the student + a forward-looking, non-stigmatising
dashboard that makes the information **actionable for the learner**, reusing the E6 trend + the E7
remediation producer (second-person) + the next assessments.

**Scope (api + web; no schema):**
- `GET /student/announcements` — the **receipt-scoped** announcement read (school/grade-level/class/
  personal), self-resolved behind the wall (+ the existing self-scoped mark-read, the one mutation a
  student may make on their own receipt). `announcements.read.self`.
- `GET /student/dashboard` — **one aggregate** behind the wall composing: (a) the **E6 per-subject trend**
  (snapshot-first, live fall-through; the same fast read the parent dashboard uses — no new metric, no new
  class scan); (b) the **next assessments to prepare** (the S2 upcoming producer); (c) — when an E7
  `RemediationPlan` exists for this student — the **second-person** progress line reusing the E7
  `RemediationService.remediationProgress({ tenantId, studentId: ownId })` producer (trend delta vs the
  plan baseline, session counts, next session). **Narrowed payload shape** — structurally lacks
  `studentRank`/`classAverage`/`classRankTotal` (the peer-comparison wall is in the DTO shape, the E4
  `ParentExportJobDto` narrowing precedent). Best-effort composition (a snapshot/remediation throw degrades
  to the calm/empty state — the `freshness?`/`remediation?` posture), never blocks the dashboard.
  `analytics.read.self`.
- **Web:** the `/student/announcements` + `/student/dashboard` pages — a calm, forward-looking summary:
  per-subject trend (*"français : en progrès · maths : à consolider"*, never *"en échec"*), the next
  assessments, and the kind **"ton soutien en {matière}"** line (reusing the E3 `IMPROVEMENT` emerald lane
  on an upturn), reuse-first on `@pilotage/ui` (no `packages/ui` change unless DS Guardian agrees).

**Acceptance (folds spec AC-5/6 + ux S3):**
- `/student/announcements` returns the announcements addressed to the caller (newest first), self-scoped,
  no staff-only/other-class leak; the dashboard composes, in one aggregate behind the wall, the E6 trend +
  the next assessments + (when a plan exists) the second-person remediation line (reusing the E7 producer +
  the E3 emerald lane); the payload **structurally lacks** every peer-relative field.
- It is forward-looking and non-stigmatising (*"à consolider — voici sur quoi te concentrer"*, never *"en
  échec"*); it **never** names/compares another child; it holds **<2 s** (reads the existing snapshot/
  producers); degrades kindly with no plan / no snapshot.
- WCAG 2.2 AA: icon+text (not colour-alone), `role="status"`/`aria-live="polite"` only where a status
  transitions (not on every relative-time tick), ≥4.5:1, `prefers-reduced-motion`; mobile-first; kind FR
  copy (no "échec/mauvais/leaderboard"); never names/compares a peer. **No schema, no new permission.**

**Out of scope:** any student write beyond the existing self-scoped announcement mark-read, a provisioning
UI, real-time/push, LTI/OneRoster (all non-goals).

---

## Cross-slice invariants (every slice)

- Tenant + RLS-intent on every E8 read; **the student-self ABAC wall runs before any read** with the
  `studentId` **server-resolved** (`userProfileId === me.id`), **never** request-supplied; the scope is
  **deny-by-default** (`[ownId]`/`[]`, never `null`). The student payloads **structurally lack** every
  peer-relative field (rank / class average / class size). **No student read ever returns peer data, a
  roster, or a ranking.** No endpoint loosens an existing permission.
- **Read-only — no student write/mutation endpoint of any kind** beyond the existing self-scoped
  announcement receipt mark-read (no self-edit, no booking, no messaging, no appeal, no attendance
  self-justify). The `student` role carries **zero** write permissions (`remediation.book` is **never**
  granted to `student`).
- **RGPD / data-minimisation:** the student read **excludes** `medicalNotes`/discipline/draft grades/
  guardian-private fields — the portal exposes a **subset** of what the parent sees of that child, never
  more. No new sensitive data category (only the one account link).
- **Append-only audit** on the provisioning link write (`student.account_linked`); reads follow the
  existing surfaces' audit posture (best-effort where a sensitive parent read is logged); login/auth rides
  the existing auth audit. Audit never blocks a read.
- Reuse-first: the `Guardian.userProfileId` link precedent (the one schema change), the existing analytics/
  grade/attendance/announcement producers (re-scoped to self), the E6 snapshot trend (snapshot-first, live
  fall-through), the E7 `remediationProgress` producer (second-person), the E3 `IMPROVEMENT` emerald lane,
  the E4 `ParentExportJobDto` narrowed-DTO precedent (the peer-comparison wall in the payload shape), the
  ADR-003 route-prefix pattern (the fourth `/student/*` prefix), the aggregate-endpoint convention,
  `@pilotage/ui`, `packages/contracts`. **No new datastore, no new HTTP style, no second BullMQ queue, no
  new analytics metric, no second Keycloak realm, no change to the existing three portals.**
- Kind, factual, **non-stigmatising** FR copy on every student surface (no "échec/mauvais/redoublement/en
  retard/classement/leaderboard"); never compares the learner to a named peer; a struggling subject is
  framed as *"à consolider — voici sur quoi te concentrer"*, never a verdict.
- `pnpm typecheck` (Murat, once/slice); no `git diff --check` errors; **the one new architectural decision
  (student role activation + student-self ABAC) lands with
  `docs/adr/ADR-021-student-role-and-self-abac.md` on S1** (Winston gate); any *other* new decision → its
  own ADR (none anticipated; `plan.md` §5).
