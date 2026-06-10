# E8 — Architecture & plan (Architect: Winston)

> Companion to [`spec.md`](./spec.md) / [`data-model.md`](./data-model.md) / [`ux.md`](./ux.md) /
> [`contracts/openapi.yaml`](./contracts/openapi.yaml) / [`tasks.md`](./tasks.md).
> E8 "Student Portal" opens the cahier's future **Portail élève**: a net-new, **read-only** learner
> surface (`/student/*`) for *my* grades, *my* upcoming assessments, *my* attendance, the announcements
> that reach me, and a forward-looking **"Mon objectif"** dashboard. It is sliced thin (~M, 3 slices) and
> built on **maximum reuse** of the reads E1–E7 already produce. It is **additive, reversible, and
> non-destructive**: its **only** schema change is **one additive optional FK** — the student↔account link
> `Student.userProfileId String? @unique` (the `Guardian.userProfileId` precedent; see
> [`data-model.md`](./data-model.md) §1, the authoritative schema record). The three existing portals are
> untouched; there is **no student write path** anywhere.
>
> **Reconciliation note (Winston, verified against the live schema — read before S1).** A parallel
> planning pass briefly asserted that `Student.userProfileId` *already exists* and that E8 needs **zero**
> schema change. **That is incorrect — verified against the live model.** `apps/api/prisma/schema.prisma`
> `model Student` (the `@@map("student")` block) carries **no** `userProfileId` column; the only
> `*.userProfileId @unique` in that schema is on **`model Guardian`** (line ~475 — the *parent's* link,
> not the student's). E8 therefore **does** add exactly one additive optional FK in S1
> (`Student.userProfileId String? @unique`, `onDelete: SetNull`, mirroring `Guardian`).
> [`data-model.md`](./data-model.md) §1 is the authoritative schema record; this plan defers to it. The
> S1 implementer **must add the column** (additive `db push`) — do not skip it on the mistaken belief it
> already exists, or the student-self ABAC will resolve over a non-existent field.

---

## 1. Where this fits (reuse map)

| Concern | Reuse (do NOT reinvent) | E8 addition |
|---|---|---|
| Auth: realm roles | the `student` role is **already reserved** in ADR-004 / ADR-015 ("(futur)") + recognised by the Keycloak realm | **activate** it in the NestJS guards + the Next.js auth routing (no new realm, no new role *model*) |
| Auth: OIDC client | ADR-004's "1 realm, 3 clients" (`portal-admin`/`portal-teacher`/`portal-parent`) | **reuse `portal-parent`** for the student login (the recommended ADR-021 decision); the role, not a 4th client, distinguishes the surface — a 4th client is the recorded alternative |
| Identity link | `Guardian.userProfileId String? @unique` + `onDelete: SetNull` (the *parent's* proven auth↔domain join) | an **additive optional `Student.userProfileId @unique`** FK — the exact same precedent (verified: `model Student` carries no such column today); the **one E8 schema change**; the wall resolves self via `userProfileId === me.id` |
| Student ABAC | `StudentAccessService.scopeForUser` (the parent guardianship-array branch; the admin/teacher `null`=unrestricted branch) | a **new `student` branch** resolving to **`[ownStudentId]`** (via `userProfileId === me.id`) or **`[]`** — a fails-closed singleton, never `null`, never a peer |
| "Mes notes" read | the parent grade-read shape (published grades for a child, grouped by subject) | the **same shape re-scoped to self** behind the student-self wall (published-only, no draft) |
| "Mes prochaines évaluations" | `analytics.parentUpcoming({ tenantId, studentId })` (E-prior parent upcoming-assessments feed) | **re-scoped to self** behind the wall — same producer, the self `studentId` |
| "Mon assiduité" | the existing attendance summary read for a child | **re-scoped to self**, framed factually/kindly (no disciplinary verdict, no peer compare) |
| Announcements | the existing `Announcement` scope resolution (school / grade-level / class / addressed-to) | **re-scoped to self** behind the wall — a read-only consumer of the existing broadcast |
| "Mon objectif" trend | the E6 `student_subject_snapshot` per-subject trend (snapshot-first + live fall-through; the same fast read the parent dashboard uses) | composed into the student dashboard, **re-framed second-person**, no new metric/scan |
| "Mon objectif" remediation line | the E7 `RemediationService.remediationProgress({ tenantId, studentId })` producer + the E3 `IMPROVEMENT` emerald lane | the **same producer, self-scoped**, re-framed *"ton soutien en {matière}"* — read-only (a student never books) |
| Portal routing | ADR-003 "three portals via Next.js route prefixes" (`/admin`/`/teacher`/`/parent`) | a **fourth prefix `/student/*`** — the same route-group pattern, server-component-first |
| Aggregate-endpoint convention | dashboards read pre-aggregated `/api/v1/*`, no client N+1 (project-context §2) | the student reads + dashboard are **aggregate endpoints**, not client N+1 |
| Permission model | RBAC + ABAC + custom roles (ADR-015); the E4 `exports.execute.parent` role-narrowed house style | a **thin read-only `student` permission grant** (FR-10) — necessary-but-not-sufficient; the wall narrows to self |
| Migration convention | `prisma db push`, **no SQL `migrations/` folder** (verified across E1-S3…E7-S1) | the one additive `Student.userProfileId` link lands via `db push` in S1 (additive nullable FK; the only schema-bearing step); the seed permission delta is rows, not a migration |
| `@pilotage/ui` + contracts | the design system + `packages/contracts` shared types | the student surfaces reuse them; new DTOs are additive in `packages/contracts` |

> **Ruling — E8 is a reuse-dense, read-only extension with exactly ONE genuinely new architectural
> problem: a new login identity + the student-self ABAC** (§4 / ADR-021). Every read it surfaces already
> exists for the parent/admin; E8 re-scopes those reads to *self* behind a new, fails-closed wall and a
> new route prefix. There is **no new write path, no new metric, no new queue, no new datastore.**

---

## 2. The spine — identity + the wall + the first read (S1)

The load-bearing object is the **student identity link + the fails-closed self-ABAC**. Its resolution:

```
student logs in (portal-parent OIDC client, realm role = "student")
  └─ auth routing sees realm role "student" → routes to /student/* (not /parent/*)
       └─ NestJS guard: JwtAuthGuard + PermissionsGuard (thin student read perms)
            └─ StudentAccessService.scopeForUser(me, jwt):
                 roles.includes('student')
                   → find Student where userProfileId === me.id
                   → linked?   studentIds = [ownStudentId]     (self only)
                   → unlinked? studentIds = []                  (NO data — fails CLOSED)
                   (never null = unrestricted, never another id)
            └─ canAccessStudent(ownStudentId) BEFORE every read
       └─ GET /student/grades  → published grades for ownStudentId, grouped by subject (aggregate, no N+1)
```

**S1 ships the identity + the wall + ONE read** (`/student/grades`), so the **security-sensitive
foundation is proven before any breadth is added**. The wall is the thing that must be exactly right;
S2/S3 then add surfaces that all sit behind the *same* proven wall. The **single schema step** (the
additive `Student.userProfileId @unique` link — verified absent from `model Student` today, see
data-model §1) lands once in S1; the seed permission delta is rows, not a migration.

```
apps/api/src/modules/students/
  student-access.service.ts        # + the new `student` branch (fails-closed singleton)
apps/api/src/modules/student-portal/   # NEW thin module (or fold reads into existing controllers, see §3)
  student-portal.module.ts
  student-portal.controller.ts     # GET /student/* aggregate reads — student-self wall on every route
  student-portal.service.ts        # composes existing producers (grades / upcoming / attendance / announcements / dashboard)
apps/web/src/app/student/          # NEW route group (4th prefix, ADR-003 pattern)
  layout.tsx · dashboard/ · grades/ · upcoming/ · attendance/ · announcements/
```

> **Module placement (S1 implementer's call, recorded).** Two acceptable shapes: (a) a **new
> `StudentPortalController`/`Service`** under `/student/*` that *composes* the existing analytics/grade/
> attendance/announcement services (recommended — keeps the student wall in one obvious place, the
> aggregate-endpoint convention intact, and the existing controllers untouched); or (b) add `student`-
> walled routes to each existing controller. Prefer (a): one student-self wall, one obvious audit
> surface, zero edits to the proven parent/admin controllers. Either way **every** student route runs
> `canAccessStudent(ownStudentId)` before returning data.

---

## 3. Read paths — aggregate, snapshot-aware, student-self-walled

All E8 reads are **aggregate endpoints** under `/api/v1/student/*` (project-context §2, ADR-drift-safe),
each assembling its full payload server-side, **behind the student-self wall**:

- `GET /student/grades` (S1) — the caller's **published** grades grouped by subject (assessment, date,
  coefficient, mark, comment). Reuses the parent grade-read shape, self-scoped, published-only.
- `GET /student/upcoming` (S2) — the caller's upcoming assessments (subject, date, term, coefficient).
  **Reuses `analytics.parentUpcoming({ tenantId, studentId=ownId })`** verbatim.
- `GET /student/attendance` (S2) — the caller's attendance summary (present/absence/lateness/justified),
  factual framing. Reuses the existing attendance read, self-scoped.
- `GET /student/announcements` (S2) — the announcements scoped to the caller (school/grade-level/class/
  addressed). Reuses the existing `Announcement` scope resolution, self-scoped.
- `GET /student/dashboard` (S3) — **one aggregate** composing the E6 per-subject trend (snapshot-first,
  live fall-through) + the next assessments (S2 producer) + (when an E7 `RemediationPlan` exists) the
  **second-person** `remediationProgress` line. **No new metric, no new class scan** — it reads the
  snapshot the existing producers already serve, holding the **<2 s** bar. Best-effort composition (a
  remediation/snapshot throw degrades to the calm/empty state — the established `freshness?`/`remediation?`
  posture), never blocks the dashboard.

All reads keep the **aggregate-endpoint convention** (no client N+1) and the **server-derived tenant /
school context** (`SchoolContextService.forUser`, never client-supplied). **No student `studentId` is
ever read from the request** — it is resolved server-side from `userProfileId === me.id` (the wall), so a
malicious `?studentId=` is structurally ignored, not merely rejected.

---

## 4. The ONE new architectural decision — student role activation + student-self ABAC (S1 → ADR-021)

**The problem.** Three things are genuinely new and cross-cutting: (1) a **new login identity** (a
`student`-role user must resolve to *exactly one* `Student` record — today no FK joins a `UserProfile` to
a `Student`); (2) a **new ABAC shape** (the student-self scope is a *fails-closed singleton* — unlike the
parent's guarded-array or the admin/teacher's unrestricted `null`); (3) a **new OIDC surface decision**
(does the student login reuse `portal-parent` or get a 4th client?). These set precedent for every future
learner surface → **`docs/adr/ADR-021-student-role-and-self-abac.md`** (Winston gate), authored on **S1**
(the first slice that activates the role + adds the wall). **ADR number: 021 — the highest ADR on disk is
`ADR-020-booking-availability-concurrency.md`, so 021 is the next free filesystem number** (verify against
the index at authoring time, per the E6/E7 reconciliation precedent).

**Recommended decision (the ADR's accepted option) — activate the reserved role, reuse the parent client,
add one additive link, fail closed. Five recorded sub-decisions:**

1. **Activate the reserved `student` realm role** (ADR-004/015 already declare it "(futur)") rather than
   create a custom app role. The role exists in the realm by design; E8 wires the guards + auth routing to
   honour it. *(Rejected: a custom `student` role in the `role` table — unnecessary, the realm role is the
   documented intent.)*
2. **Reuse the `portal-parent` OIDC client** for the student login. ADR-004's "1 realm, 3 clients" stands;
   the student authenticates on the parent client and is distinguished by their **realm role**, which the
   auth routing reads to send them to `/student/*` (not `/parent/*`). *(Recorded alternative: a 4th client
   `portal-student` — viable if a reviewer wants per-portal client_id telemetry/MFA policy for students;
   if chosen, it is a realm-config change + an auth-routing update, no schema impact. The recommended path
   avoids realm churn for the MVP.)*
3. **The identity link is an additive optional `Student.userProfileId String? @unique` FK**
   (`onDelete: SetNull`), **mirroring** the `Guardian.userProfileId String? @unique` precedent. The live
   `model Student` carries **no** such column today (Winston verified directly against
   `apps/api/prisma/schema.prisma` — the `userProfileId @unique` nearby is on `Guardian`, not `Student`),
   so **S1 adds it** via `db push`. A student then resolves to *the* student row whose `userProfileId` is
   their own profile id. *(Rejected: a join table — overkill for a 1:1; reusing an existing field — none
   exists on `Student`.)*
4. **The student-self ABAC is a fails-closed singleton.** `scopeForUser` returns `[ownStudentId]` when
   linked, **`[]`** when unlinked — **never `null`** (which means *unrestricted* and is the
   admin/teacher branch). This is the **inverse** of the existing parent/teacher fallthrough posture: an
   unrecognised/unlinked student gets **no** data, not a permissive default. The load-bearing guarantee:
   a `student` role can only ever resolve *its own* id.
5. **The permission grant is necessary-but-not-sufficient.** Whatever read permissions `student` is
   granted (FR-10), the **student-self ABAC is what narrows them to self** — a permission alone must never
   grant peer access. *(Rejected: granting `students.read` *without* a self-wall — that would read the
   roster; the wall is mandatory on every student route.)*

**Alternatives the ADR weighs and rejects (recorded, not chosen):** a second Keycloak realm for students
(isolation overkill, breaks SSO, ADR-004 already rejected multi-realm); a custom app role
(realm role is the documented intent); a permissive default for an unlinked student (a security
anti-pattern — must fail closed); exposing a student write path in the MVP (a separate epic with its own
ABAC + audit). **No second BullMQ queue, no new datastore, no new HTTP style** — none are needed.

> **Why this is the right altitude for the ADR.** It is a *cross-cutting identity + authorization
> decision* (a new login role, a new ABAC shape, an OIDC-surface choice) — exactly the kind of thing
> project-context §3 says must land with an ADR, and the kind of precedent any future learner surface
> (LTI/OneRoster student context, student messaging) will build on. It is the **only** E8 tripwire.

---

## 5. ADR posture & tripwires (Winston gate)

**E8 introduces exactly ONE new architectural decision → ADR-021 (student role activation + student-self
ABAC + OIDC-client reuse), authored on the S1 implementation run** (it documents a decision being made,
not the spec). ADR number reconciled against the index: the highest ADR file on disk is **ADR-020**
(booking-availability-concurrency, E7-S2), so **021 is the next free filesystem number** — confirmed.

Everything else stays inside documented conventions and trips **no other** ADR:
- **Realm/client model (ADR-004)** — *using* the reserved `student` role + the existing `portal-parent`
  client is honouring ADR-004, not a new decision (ADR-021 records the activation + the client-reuse
  choice as a consequence of ADR-004, and updates ADR-004's "(futur)" note). ✅
- **Permission model (ADR-015)** — a thin role-narrowed read grant for `student` + the new ABAC branch
  is *using* ADR-015's 3-layer model (ADR-015 already reserves the `student` role row). ✅
- **Portals via route prefixes (ADR-003)** — `/student/*` is a fourth prefix in the documented pattern,
  not a new routing decision. ✅
- **Tenancy (ADR-002 intent / ADR-019 reality)** — every student read is tenant-scoped via explicit
  `where: { tenantId }` (the prevailing application-layer isolation; no fabricated RLS DDL). ✅
- **`db push` migration convention** — one additive nullable FK, no existing column changed. ✅
- **Aggregate-endpoint convention** — every student read is an aggregate, no client N+1. ✅

**Tripwires that would require a SECOND, separate decision (and are therefore non-goals):**
1. **Any student write / self-service** (profile self-edit, grade appeal, booking, messaging, attendance
   self-justify) — a future epic with its own ABAC + audit + write-path design.
2. **A second BullMQ queue / a new datastore / real-time push** — the portal is read-only on the normal
   fetch cadence (ADR-019 deferral); no background work is added.
3. **A new analytics metric / chart** — the dashboard reuses the E6 trend + the E7 producer; it invents
   nothing.
4. **Exposing medical/guardian-private data to the student** — the read is data-minimised (excludes
   `medicalNotes` et al.); widening it would be a separate RGPD decision (and is forbidden).
5. **An LTI/OneRoster student-context integration** — the parked E11; E8 ships no standards integration.
6. **A 4th OIDC client `portal-student`** — only if a reviewer explicitly chooses it (recorded as the
   ADR-021 alternative); the recommended path reuses `portal-parent`.

---

## 6. Risk & sequencing

- **Authorization-surface risk (highest, and front-loaded into S1).** A student reading a *peer's* data
  is the one path that can be *catastrophically* wrong (children's data, RGPD). Mitigation: the
  **fails-closed singleton** student-self ABAC (`[ownId]` or `[]`, never `null`, never a param-supplied
  id), `canAccessStudent(ownStudentId)` **before** every read, the `studentId` resolved **server-side**
  (a request `?studentId=` is structurally ignored), and a **targeted test** (a student resolves only
  self; an unlinked student resolves to no data; any other id → 403/404) is the gate on S1 landing.
  Sentinel reviews S1 specifically for the wall. The whole epic sits behind this one wall, proven first.
- **Identity-provisioning risk.** A `student` login with no `Student` link must degrade kindly, never
  leak, never crash. Mitigation: the wall fails **closed** (no link → `[]` → no data → kind empty state,
  scenario 7); provisioning (setting `userProfileId`) is via seed/import for the MVP (no UI in scope), a
  recorded follow-up.
- **RGPD / data-minimisation risk.** A minor self-serving must see *less* than the parent, never more.
  Mitigation: the student read **excludes** `medicalNotes` and guardian-private fields by construction
  (AC-6); the dashboard never compares to a named peer (the cahier mandate); the portal is strictly
  read-only (no new audit surface, nothing for a student to mutate).
- **Measurement-honesty risk (S3).** The "Mon objectif" dashboard must show a *truthful* trend and a
  *truthful* remediation delta. Mitigation: it reads the **E6 snapshot** trend (snapshot-first, live
  fall-through — never a wrong number) and the **E7 `remediationProgress`** producer (the same figures the
  parent sees), re-framed second-person; it is encouraging but never overstates, and frames a struggling
  subject as *"à consolider"*, never *"en échec"*.
- **Scope risk (it's ~M).** Mitigation: three thin slices, each independently demoable + revertible; S1
  (identity + wall + "Mes notes") already delivers visible value (a learner reads their own grades) and
  proves the security foundation before any breadth (S2) or the visionary dashboard (S3) is added.
- **Reversibility.** The only schema change is one additive nullable FK; the `/student/*` route group and
  the student permission grants are additive; the three existing portals are untouched. Dropping the link
  column + the route group returns the platform to its pre-E8 behaviour with zero data loss.
