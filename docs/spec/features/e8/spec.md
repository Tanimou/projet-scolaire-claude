# E8 — Student Portal

> **Status:** in-progress (spec run) · **Size:** ~M · **Tier:** 3 (Scale & new surfaces)
> **Why now:** E1–E7 are all shipped (E7-S6 landed in #137 — engine, messaging, exports,
> notifications, analytics snapshots and the remediation loop are all complete). The highest-priority
> not-yet-started epic is **E8 — Student Portal** (roadmap Tier 3, status `proposed`, ranked above the
> Tier-4 fillers E9–E11). It is the cahier's explicitly named future surface — *"Portail élève"* — and
> the realm already reserves a **`student`** role for it (ADR-004: *"Rôles realm: … `student` (futur)"*;
> ADR-015: *"`student` (futur) — Voit son propre dossier"*). This epic activates that reserved role.
> **Audit:** student portal ~0% — there is **no** `/student` route group, **no** `student` realm-role
> wiring, **no** student ABAC scope, and no student-self read path. Everything a learner needs to *see*
> already exists as data (grades, assessments, attendance, announcements, the E6 trend, the E7 plan) —
> it is surfaced today only to **parents** (guardianship-walled) and **teachers/admins**. E8 adds a
> **fourth, read-only audience**: the student, seeing **only their own** dossier.

## Vision

Today the platform answers the cahier's five questions for the **parent**. The **learner themselves**
— the person whose grades, effort and progress the whole platform is about — has **no way in**. A
13-year-old who wants to know *"which subjects do I need to work on, what's my next assessment, am I
improving?"* has to ask a parent to open the parent portal. The cahier names a *Portail élève* as a
future surface precisely to close that gap: give the student a **calm, read-only, non-stigmatising**
view of **their own** record, and — the E8 visionary step — make it **actionable for the learner**, not
a passive gradebook mirror.

E8 introduces a **fourth portal audience**: the **student**. A new Keycloak `student` realm-role
(already reserved in ADR-004) and a **student-self ABAC** rule (*"a student may read their own dossier
and nothing else — never another student, never a peer comparison"*) gate a small set of **read-only**
views that **reuse the existing aggregate endpoints**, resolving the target student **from the
learner's own identity** (`Student.userProfileId === me.id`), never from a client-supplied id. The
student sees: **my grades**, **upcoming assessments**, **my attendance**, **announcements addressed to
me/my class/my school** — exactly the parent's read surface, narrowed to self and stripped of any
parent-only action (no ack/resolve of alerts, no booking, no messaging-initiation).

**The visionary step — "Mon objectif", an actionable learner dashboard (S3).** Rather than a passive
mirror of the gradebook, the student dashboard surfaces the learner's **own E6 per-subject trend** and,
where an **E7 `RemediationPlan`** exists, a **kind "ton soutien en {matière}" progress line** plus the
**upcoming assessments to prepare**. It answers, for the learner: *"where am I, which subject is moving,
what's coming, and (if support is organised) is it helping?"* — reusing the same snapshot reads the
parent dashboard uses, with **zero peer comparison** (RGPD / non-stigmatising). The student never sees
a rank, a class average framed against them by name, or another child's data. The framing is
encouraging and first-person: *"Tu progresses en mathématiques (+1,8 pt ce trimestre)"*, *"Prochaine
éval : Histoire, vendredi"*, *"Ton soutien en maths : 2 séances faites"*.

**The learner value, in one sentence.** A student finally has a **direct, private, kind window into
their own progress** — what's improving, what's coming, what support is in place — that turns the
platform's information into action *for the person it's about*, never stigmatising, never comparative.

## Users & why

- **Student — the new core user of this surface.** Gets a **read-only, self-scoped** view of their own
  dossier: grades, upcoming assessments, attendance, announcements, and the "Mon objectif" dashboard
  (own trend + own remediation progress + what to prepare). They can only ever see **their own** record
  (student-self ABAC). No writes, no actions that belong to a parent/teacher/admin.
- **Parent — unchanged, complementary.** The parent portal is untouched. E8 does **not** move any
  parent capability to the student; it adds a *parallel, narrower* audience. A parent still owns the
  action loop (ack alerts, book remediation, message teachers); the student only *sees* progress.
- **Teacher / admin — unchanged.** No new teacher/admin capability. The admin **provisions** the
  student account (links a `Student` to a `student`-role `UserProfile`) through existing user/enrollment
  tooling — E8 does not build a new provisioning UI in S1–S3 (it documents the seam; see Non-goals).
- **The platform itself.** E8 is the **first surface to expose data to the subject of that data**, so
  it is the strictest RGPD test the platform has faced: the student-self ABAC is **deny-by-default**,
  reads are server-derived from identity, and *no view ever discloses another student's data or a
  peer-relative position*. It reuses every existing aggregate (no new metric, no new heavy read) and
  lays the read-only learner substrate later surfaces (student self-service, OneRoster student sync) can
  build on.

## Concrete scenarios

1. **A student signs in and sees their own grades (the headline, S1).** A learner logs into the new
   `/student` portal with their `student`-role account. The home view resolves their `Student` record
   **from their own `UserProfile` id** (never a path param) and shows **"Mes notes"** — their published
   grades by subject with the teacher's comment, exactly the data the parent sees for this child, but
   reached through the student's own identity. They cannot type or guess another student's id — there is
   no id to supply, and the ABAC denies any student but self.

2. **Upcoming assessments to prepare (S2).** The student opens **"À venir"** and sees every assessment
   scheduled in the next weeks for **their own class** — subject, date, coefficient — ordered soonest
   first. It reuses the exact `parent-upcoming` aggregate, resolved to self. The learner now knows what
   to revise.

3. **My attendance (S2).** The student opens **"Mon assiduité"** and sees their own attendance record
   (present / absent / late, justified or not) — their own data only, framed factually and kindly, never
   compared to classmates.

4. **Announcements addressed to me (S3).** The student sees school/class/personal announcements
   relevant to them (the same scope resolution the parent receipt uses, narrowed to the student's own
   class + person), newest first. No announcement meant for staff or other classes leaks.

5. **"Mon objectif" — the actionable dashboard (the payoff, S3).** The student opens the home
   dashboard. It shows, first-person and kind: their **per-subject trend** from the E6 snapshot (*"Tu
   progresses en maths : +1,8 pt"*, *"Le français demande de l'attention en ce moment"* — never a rank,
   never "tu es 18e"), the **next assessments to prepare**, and — where a parent has organised support
   via an **E7 `RemediationPlan`** — a kind **"Ton soutien en {matière}"** progress line (*"2 séances
   faites, prochaine mardi"*). It reuses the E6 snapshot trend + the E7 plan/progress reads. **Zero peer
   comparison.**

6. **The deny-by-default wall (the security-sensitive path).** A student (or a tampered client) issues a
   request for another student's dossier — supplies a foreign `studentId`, or replays a parent endpoint.
   Every student read **ignores any client-supplied student id** and resolves self from identity; a
   `student`-role token hitting a parent/teacher/admin endpoint is denied (it lacks the permission and
   the guardianship/teaching wall). Result: **a student can read their own dossier and nothing else** —
   never another student, never a peer comparison. This is the path the **ADR-021** student-ABAC
   decision pins.

7. **A student with no account yet (graceful).** Not every `Student` has a linked `UserProfile`. E8 does
   not auto-create accounts; provisioning is an admin action through existing tooling. A `student`-role
   user whose `UserProfile` has no linked `Student` gets a kind empty state (*"Ton dossier n'est pas
   encore activé — contacte ton établissement"*), never a 500, never another student's data.

## Functional requirements

**FR-1 — A `student` Keycloak realm-role, activated.** E8 activates the **already-reserved**
`student` realm-role (ADR-004/ADR-015). The role is wired through the realm export, the JWT
`realm_access.roles` read path, the NestJS role guard, and a default permission set
(`REALM_ROLE_PERMISSIONS.student`). **No new client** is added in S1 (the student reuses the
`portal-parent` OIDC client initially — documented as an ADR-021 decision point; a dedicated
`portal-student` client is a recorded future option, not an S1 requirement).

**FR-2 — Student-self ABAC (deny-by-default, self-only, never peer comparison).** A new resolution path
(`StudentSelfAccessService` or an additive branch on `StudentAccessService`) resolves the **single**
`Student` whose `userProfileId === me.id` within the caller's tenant. A `student`-role caller's student
scope is **exactly that one id** — never `null` (unrestricted), never another id. Every student read is
**server-derived from identity**; any client-supplied student id is **ignored** (not "validated" —
ignored). No student endpoint ever returns another student's data or a peer-relative figure.

**FR-3 — A thin, role-narrowed student permission family (E4/E7 house style).** Add read-only,
student-scoped permissions in the established `<resource>.<action>.<audience>` style — e.g.
`grades.read.self`, `assessments.read.self`, `attendance.read.self`, `announcements.read.self`,
`analytics.read.self` (final names locked in `data-model.md` §5) — granted **only** to the `student`
realm-role. They never widen an existing permission and are never granted to parent/teacher/admin.

**FR-4 — Read-only "Mes notes" (S1).** A `/student` view of the learner's **own published grades** by
subject with teacher comment, reusing the existing parent grade/dashboard aggregate logic, resolved to
self. Read-only — no flag, no revise, no ack.

**FR-5 — Read-only "À venir" upcoming assessments (S2).** The learner's own upcoming assessments for
their own class (subject, date, coefficient), reusing the `parent-upcoming` aggregate resolved to self.

**FR-6 — Read-only "Mon assiduité" attendance (S2).** The learner's own attendance records (status,
justification), self-scoped, factual and kind, never compared to classmates.

**FR-7 — Read-only "Annonces" (S3).** Announcements relevant to the student (school / their class /
personal scope), reusing the existing announcement scope-resolution narrowed to the student's own class
+ person; no staff-only or other-class announcement leaks.

**FR-8 — "Mon objectif" actionable student dashboard (S3, the visionary spine).** A first-person, kind
dashboard composing: the student's **own E6 per-subject trend** (snapshot-first, live fall-through —
reused, no new metric), the **next assessments to prepare** (FR-5), and — where an **E7
`RemediationPlan`** exists for the student — a kind **"ton soutien en {matière}"** progress line reusing
the E7 progress read. **Zero peer comparison**: no rank, no class average framed against the student, no
other child's data; encouraging, RGPD-minimal copy.

**FR-9 — Aggregate endpoints, no client N+1.** Every student read is an **aggregate endpoint** under
`/api/v1/student/*` (or reuses an existing aggregate with a self-resolved id), assembling its full
payload server-side — the project-context §2 convention, ADR-drift-safe.

**FR-10 — Append-only audit + tenant scope on every read path.** Student reads are tenant-scoped
(server-derived `tenantId`) and, where the existing surface audits a sensitive read, the student path
audits the same (a student reading their own dossier is a logged, RGPD-traceable access). No student
read can cross tenants or schools.

## Acceptance criteria

- **AC-1 (role + auth wiring, S1).** The `student` realm-role is activated end-to-end: present in the
  realm export, read from the JWT, accepted by the role guard, and carries a default
  `REALM_ROLE_PERMISSIONS.student` set. A `student`-role user can authenticate to the `/student` portal
  and reach **only** student endpoints. *(ADR-021 lands this slice.)*
- **AC-2 (student-self ABAC, S1).** A `student`-role caller's student scope resolves to **exactly** the
  one `Student` with `userProfileId === me.id` (tenant-scoped). A request supplying a **foreign**
  `studentId` returns the caller's **own** data (the supplied id is ignored), never the foreign student.
  A `student`-role token on a parent/teacher/admin endpoint is **denied** (missing permission + wall).
- **AC-3 (my grades, S1).** A student sees their own published grades by subject + teacher comment;
  byte-equivalent to the parent's read for that child, resolved to self; read-only (no write verb
  reachable). A student with **no linked `Student`** gets a kind empty state, not an error.
- **AC-4 (upcoming + attendance, S2).** A student sees their own upcoming assessments (subject / date /
  coefficient, soonest first) and their own attendance (status / justification); both self-scoped, no
  other-student leak, no peer comparison.
- **AC-5 (announcements, S3).** A student sees only announcements relevant to them (school / their class
  / personal); no staff-only or other-class announcement is disclosed.
- **AC-6 ("Mon objectif" dashboard, S3).** The dashboard composes the student's own E6 trend + next
  assessments + (where present) the E7 remediation progress line, first-person and kind, holding the
  <2 s budget by reusing the snapshot reads. **No rank, no class average framed against the student, no
  other child's data, no peer comparison anywhere.**
- **AC-7 (RGPD / non-stigmatising, every slice).** No view discloses another student's data or a
  peer-relative position; copy is encouraging and factual (no "échec / nul / dernier / classement"); the
  student-self ABAC is deny-by-default; reads are tenant-scoped and server-derived from identity;
  sensitive reads are audited.
- **AC-8 (no regression).** No parent/teacher/admin capability is moved, loosened, or removed; the
  parent action loop is untouched; no existing permission is widened; the **only** schema touch is the one
  **additive** `Student.userProfileId` link in S1 (see `data-model.md` §1 — the authoritative schema
  record; verified absent from `model Student` today, so S1 is a `[schema][auth]` slice).

## Slices (ship in order; each ≤ a day, one PR, demoable end-to-end)

> Three thin vertical slices. **S1** stands up the **identity + the wall + the first read**: activate the
> `student` role, add the one additive `Student.userProfileId` link (the only schema step), the thin
> read-only `*.read.self` permission family, the **deny-by-default student-self ABAC** + ADR-021, the auth
> routing to `/student/*`, the `/student/me` activation gate, and **"Mes notes"** (`/student/grades`).
> **S2** adds **"Mes prochaines évaluations" + "Mon assiduité"**, each re-scoping an existing aggregate
> behind the *same* proven wall. **S3** ships **les annonces** + the visionary **"Mon objectif"** dashboard
> (E6 trend + E7 remediation progress re-framed second-person + next assessments). The whole schema delta
> (one link column) lands once in S1. See [`tasks.md`](./tasks.md) for the authoritative backlog +
> per-slice AC.

- **S1 — Student role + self-ABAC + auth wiring + "Mes notes" read.** *(schema + api + web;
  `[schema][auth]` P1)* The additive optional `Student.userProfileId @unique` link (the only E8 schema
  step, `db push`, the `Guardian` precedent — verified absent from `model Student` today) + the
  `UserProfile` back-relation; **activate** the `student` realm role in the auth routing + the guards; the
  five read-only `*.read.self` permissions granted to `student` only (zero write perms); the
  **deny-by-default student-self branch** in `StudentAccessService` (resolves to `[ownStudentId]` via
  `userProfileId === me.id`, or `[]` when unlinked — **never `null`, never a peer**); route a `student`
  login to `/student/*`; `GET /student/me` (activation gate) + `GET /student/grades` ("Mes notes" —
  published grades by subject, behind the wall, one aggregate, no N+1); the provisioning link write audited
  (`student.account_linked`). **Lands with `docs/adr/ADR-021-student-role-and-self-abac.md`** (Winston
  gate — role activation + OIDC-client reuse + the student-self ABAC). *(This is the FR-1/FR-2/AC-1/AC-2
  tripwire slice.)*

- **S2 — "Mes prochaines évaluations" + "Mon assiduité".** *(api + web; `[auth]` P2)* Two read-only
  student surfaces, each **re-scoping an existing aggregate** behind the student-self wall:
  `/student/upcoming` (the `parent-upcoming` assessments read, self-resolved, `assessments.read.self`),
  `/student/attendance` (the attendance summary, self-resolved, factual/kind framing,
  `attendance.read.self`). Reuses `@pilotage/ui`; kind, non-stigmatising FR copy; no peer data, no
  disciplinary framing. **No schema change.**

- **S3 — "Les annonces" + "Mon objectif": the actionable student dashboard (the visionary spine).**
  *(api + web; `[web][a11y][analytics]` P2)* `/student/announcements` (the receipt-scoped announcement
  read, self-resolved, `announcements.read.self`) + `/student/dashboard` ("Mon objectif",
  `analytics.read.self`) — **one aggregate** behind the wall composing the E6 per-subject trend
  (snapshot-first, live fall-through) + the next assessments (S2) + (when an E7 `RemediationPlan` exists)
  the **second-person** remediation progress line (reusing the E7 `remediationProgress` producer + the E3
  `IMPROVEMENT` emerald lane on an upturn). The payload **structurally lacks** every peer-relative field
  (the E4 narrowed-DTO precedent). Forward-looking, non-stigmatising (*"à consolider — voici sur quoi te
  concentrer"*, never *"en échec"*), never names/compares another child, holds **<2 s**. Additive;
  degrades kindly with no plan / no snapshot. **No schema change.**

## Non-goals (explicit)

- **No student writes of any kind.** No grade flag/revise, no alert ack/resolve/dismiss, no remediation
  **booking** (E7 booking stays parent-only — `remediation.book` is never granted to `student`), no
  messaging **initiation** (E2 dual-wall is parent↔teacher; a student is not a conversation participant
  in E8). The student portal is **read-only** in E8.
- **No peer comparison, ever.** No rank surfaced to the student, no class-average framed against the
  student by name, no leaderboard, no "you vs the class" — this is a hard RGPD/non-stigmatising wall,
  not a polish item.
- **No new account-provisioning UI in S1–S3.** Linking a `Student` to a `student`-role `UserProfile` is
  done by seed/import over the **new additive** `Student.userProfileId` link (added in S1); E8 documents
  the seam but does not build a new admin provisioning screen (recorded as a follow-on / E9 enrollment
  self-service overlap).
- **No dedicated `portal-student` OIDC client in S1.** The student reuses the existing `portal-parent`
  client initially (ADR-021 decision point); a dedicated client + MFA posture is a recorded future
  option, not an S1 requirement.
- **No new metric, no new heavy read, no second BullMQ queue, no new datastore, no new HTTP style.**
  Every student read reuses an existing aggregate (E6 snapshot trend, E7 plan progress, parent grade /
  upcoming / attendance / announcement logic) resolved to self.
- **No student-to-student anything, no public/social surface, no notifications-to-student channel** in
  E8 (a future "your grade was published" student notification is a recorded option, not in scope).
- **Exactly ONE additive schema change.** S1 adds the `Student.userProfileId String? @unique` link
  (verified absent from `model Student` today — the existing `*.userProfileId @unique` is on `Guardian`,
  not `Student`; see `data-model.md` §1). It is additive, nullable, `SetNull`, via `db push` — no SQL
  `migrations/` folder, safe on existing rows. **No further schema change** in S2/S3.

## Dependencies & reuse

- **ADR-004 / ADR-015** — the `student` realm-role is already *reserved*; E8 *activates* it. The
  permission model's 3-layer RBAC+ABAC+custom-role design already accommodates a new realm-role + a new
  ABAC wall. **ADR-021** records the activation decision (the wall semantics + the client choice).
- **`Student.userProfileId String? @unique`** — the student↔account link is **added additively in S1**
  (mirroring `Guardian.userProfileId`, the parent's link at schema line ~475 — which is **not** on
  `Student`); the student-self wall resolves self from it. **One additive `db push`; see `data-model.md` §1.**
- **The parent aggregate endpoints** (`analytics/parent-dashboard/:studentId`, `parent-upcoming`,
  `parent-comments`, attendance reads, the announcement scope resolution) — E8's student reads **reuse
  the same producer logic**, resolved to a self-derived `studentId` instead of a guardianship-walled
  path param.
- **E6 `student_subject_snapshot`** — the per-subject trend the "Mon objectif" dashboard reads
  (snapshot-first, live fall-through); **no new metric.**
- **E7 `RemediationPlan` + the progress read** — the kind "ton soutien en {matière}" line on the
  dashboard; reused read-only (the student never books).
- **`@pilotage/ui` + `packages/contracts` + the `/admin|/teacher|/parent` route-group + AppShell
  pattern (ADR-003)** — the `/student` route group is a fourth peer, premium/responsive/WCAG-AA.
