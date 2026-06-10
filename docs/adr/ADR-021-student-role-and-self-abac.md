# ADR-021 — Student role + deny-by-default self-ABAC (the fourth audience)

- **Status:** Accepted
- **Date:** 2026-06-10
- **Epic / Slice:** E8 — Student Portal · S1 (student realm-role + self-ABAC + "Mes notes")
- **Deciders:** Winston (Architect), Critic (Pre-mortem), Murat (Test-Architect)
- **Supersedes / relates:** ADR-004 (1 realm / 3 OIDC clients — extended here to a fourth
  *audience* WITHOUT a fourth client), ADR-015 (RBAC + ABAC + custom roles — the `student`
  realm-role was reserved there as "(futur)"; this ADR activates it and pins its permission set).

## Context

E8-S1 introduces the platform's **fourth audience**: the learner, seeing ONLY their own
dossier. ADR-015 reserved a `student` realm-role "(futur)" and ADR-004 reserved the realm role
likewise; neither was ever wired. S1 activates it end-to-end (Keycloak realm-role → NextAuth
portal → middleware → API self-ABAC → "Mes notes"), and a prior automated pass shipped it RED
with three blockers. This ADR ratifies the fixes and pins the load-bearing invariants so a later
slice cannot regress them by accident.

Four correctness keys had to be nailed before the audience could be opened:

1. **No path param, ever.** A student must never be able to address a peer. The studentId is
   **server-resolved** from the caller's own account link; no `/student/:studentId` route exists.
2. **An account ↔ Student link** that mirrors an already-shipped precedent, is purely additive,
   and degrades safely when the account is deleted.
3. **A permission set narrow enough to be self-only**, yet complete enough that the shell chrome
   (school branding) does not crash — the actual S1 blocker.
4. **A DTO posture that structurally cannot carry peer-relative data** — the peer-comparison wall
   lives in the *type*, not the UI.

## Decision

### The `student` realm-role as the fourth audience (not a fourth client)

`student` is activated as a Keycloak **realm-role**, the 4th entry in the portal map. Its role set
is **DISJOINT** from the other three (`apps/web/src/auth.ts`, and `student` is never added to
admin/teacher/parent): a `student` token can never satisfy `/admin|/teacher|/parent`, and an
admin/teacher/parent token can never be routed into `/student` (**INV-1**, enforced in both
NextAuth and `middleware.ts`). Authorization is gated by this **realm-role**, never by `client_id`.

### Additive account link — `Student.userProfileId @unique` (the Guardian precedent)

The learner's Keycloak account is linked to their `Student` row via an **additive** column:

```prisma
userProfileId String?      @unique @map("user_profile_id") @db.Uuid
userProfile   UserProfile? @relation(fields: [userProfileId], references: [id], onDelete: SetNull)
```

This is a **verbatim copy of the shipped `Guardian.userProfileId` precedent**: nullable (most
students have no portal account yet), `@unique` (one account ↔ at most one student),
`onDelete: SetNull` (deleting the account **unlinks**, never cascade-deletes the academic record).
It adds no required column, no backfill, no breaking change to any existing read path — a pure
schema addition (applied via `prisma db push` in the batched infra step).

### Deny-by-default student-self ABAC

The Student-aggregate ABAC (`student-access.service.ts`) gains a `student` branch that is
**deny-by-default**:

- The caller's own studentId is resolved **server-side** from `Student.userProfileId === me.id`,
  tenant-scoped.
- It returns **`[ownId]`** (exactly one id, the caller's own) or **`[]`** (account not yet
  linked → the *kind* unlinked-account gate, a clean empty result, never a 500, never another
  student). It returns **neither `null` nor a peer** — `null` ("no restriction") is reserved for
  admin/teacher and is structurally unreachable on the student path.
- **No `:studentId` path param** exists on any `/student/*` route; a client-supplied id is
  ignored. The scope is the *only* source of the id (**INV-2**).

`GET /student/me` is the activation gate (`activated:true` + header, or `activated:false` + null
when unlinked). `GET /student/grades` ("Mes notes") returns one aggregate of the caller's own
published grades — no client N+1, no path param; `canAccessStudent(ownId)` runs first as a
defence-in-depth assertion of the wall.

### Permission set — five `*.read.self` + `profile.read.self` + the `branding.read` grant

The `student` realm-role is pinned to a **read-only, self-scoped** set:
`grades.read.self`, `assessments.read.self`, `attendance.read.self`, `announcements.read.self`,
`analytics.read.self` (the five `*.read.self` narrowings), plus `profile.read.self`. No write
permission of any kind.

**The S1 blocker and its fix — grant `branding.read` (read only):** every `/student/*` page
crashed because `AppShellRoot` eagerly calls `fetchBranding()` (`GET /branding/me`, guarded by
`branding.read`), and a student — lacking that permission — got a **403** that `fetchBranding`
**re-threw**, taking down the whole shell. The fix has **two independent, both-required** parts:

- **(a) Grant `student` the `branding.read` permission.** This is RGPD-safe and consistent:
  branding is **school identity** (logo / name / colors) — the SAME chrome every admin, teacher,
  and parent of that school already sees (all three carry `branding.read`). It is **school-scoped,
  not student-scoped**, and carries **zero peer data**. Granting a *read* of shared school chrome
  does not widen the read-only self-scoped posture. It is a **read** grant only — it must NOT pull
  `branding.write` along.
- **(b) Harden `fetchBranding` to treat 403 as "no custom branding" (return null), not just
  401/404.** Defense-in-depth: cosmetic chrome must NEVER be able to crash a shell, for any
  audience, regardless of permission state.

### Reuse the `portal-parent` OIDC client (no fourth client)

The student portal **reuses the existing `portal-parent` Keycloak OIDC client** rather than
provisioning a 4th. ADR-004 establishes that `client_id` identifies the *portal of origin* in
tokens/logs while the *realm role* gates authorization — and S1 authorization rests entirely on
the `student` realm-role + the portal+role middleware, never on `client_id`. Reuse is expressed in
`auth.ts` with an explicit env escape hatch so promotion to a dedicated `portal-student` client is
a **config-only** change (no code), should a later slice need per-client telemetry.

### Flat, RGPD-narrowed DTO posture

`StudentGradeRow` (`packages/contracts/src/dto/student.ts`) is **flat** and **structurally lacks
every peer-relative field** — no `studentRank`, `classAverage`, `classRankTotal`, or `classSize`
(the E4 `ParentExportJobDto` narrowing precedent baked into the type, so the peer-comparison wall
lives in the *shape*, not the UI). The FE — built against a NESTED shape — is **conformed to the
flat contract**. Two **flat scalar** fields are added so the "Mes notes" card stays
complete-as-designed: `kind: string` (the assessment-type chip) and
`status: 'published' | 'revised'` (the "Note révisée" badge). Both are the **learner's OWN
assessment attributes** — zero peer-relative data, RGPD-safe — and they are added as flat scalars,
**no nesting reintroduced**. The student header stays a minimal allow-list (id + name + class
label) and never carries `medicalNotes` / `address` / `phone` / `birthDate` / `email` / `photoUrl`.
`status` is `enum(['published','revised'])` — `draft` is **not representable**, and the backend
query filters `status IN ('published','revised')` so an unpublished grade is structurally
unservable, not merely unrendered.

## Rejected alternatives

- **A fourth Keycloak OIDC client (`portal-student`)** — extra realm-config surface for no
  authorization benefit (the realm-role already gates access). Kept as an opt-in env override
  rather than a default. **Accepted cost:** student logins are not distinguishable from parent
  logins by `client_id` in Keycloak logs until that override is flipped (the per-portal-origin
  telemetry ADR-004 lists as a benefit is lost *for the student audience only*); recorded here so
  a later forensics/audit need can enable it as config, not code.
- **A `:studentId` path param with an ownership guard** — one bug in the guard exposes a peer. The
  server-resolved-only scope makes a peer **unaddressable**, not merely *guarded*.
- **Reusing the `parent` realm-role for students** — would let a student reach `/parent` surfaces
  (and inherit `remediation.book`, `messaging.write`, `exports.execute.parent`). A disjoint
  `student` role is the wall (INV-1).
- **Withholding `branding.read` and instead special-casing the student shell to skip branding** —
  forks the shell per audience and still leaves the 403 re-throw latent for any other future
  audience. Granting the shared *read* + hardening `fetchBranding` fixes the class of bug, not the
  instance.
- **Re-nesting the grade DTO to match the FE** — would smuggle a sub-object that could later grow a
  peer-relative field. The flat scalars (`kind`, `status`) keep the wall in the shape.

## Consequences

- **+** A genuinely self-only fourth audience: no path param, server-resolved id, `[ownId]`/`[]`
  never a peer; additive non-breaking schema link with safe `SetNull` unlink; read-only permission
  set; peer-comparison wall enforced by the DTO type; no new OIDC client, no new infra.
- **−** `branding.read` is now held by all four audiences — acceptable because it is a read of
  shared, non-peer school chrome, but it means "every authenticated user can read school identity"
  is now a platform-wide invariant to honor (do not later attach student-specific data to the
  branding payload).
- **−** Student logins share the `portal-parent` `client_id` until the env override is set —
  per-audience login telemetry is deferred, not free. Reversible as config.
- **Honest limitation:** the `student` self-ABAC trusts `Student.userProfileId` as the sole link.
  An incorrect link (wrong account ↔ wrong student) would expose the *wrong* dossier to *one*
  student — never a broad leak, but the provisioning path that sets `userProfileId` MUST be
  treated as security-sensitive (audited, admin-only) in the slice that introduces it. S1 writes
  an append-only `student.account_linked` audit row whenever the link is set.

## Evidence

- `auth.ts` — `student` realm-role disjoint from the other portals (INV-1) + the `portal-parent`
  client reuse with a `KEYCLOAK_STUDENT_CLIENT_*` env override.
- `middleware.ts` — `/student/*` requires the `student` role; a fresh student login lands on
  `/student/grades` (no `/student/dashboard` in S1).
- `student-access.service.ts` — the `student` branch resolves own studentId → `[ownId]` / `[]`,
  never `null`, never a peer; no path param consumed. Pinned by
  `student-access.service.spec.ts` (linked → `[ownId]`; unlinked → `[]`; peer denied; tenant +
  caller-own scoping).
- `permissions.constants.ts` — `student` pinned to the five `*.read.self` + `profile.read.self` +
  `branding.read` (read only).
- `apps/web/src/lib/me.ts` — `fetchBranding` returns null on 401/404/**403** (hardened).
- `packages/contracts/src/dto/student.ts` — flat `StudentGradeRow` with `kind`/`status` scalars,
  structurally no `studentRank`/`classAverage`/`classRankTotal`/`classSize`; `status` enum admits
  no `draft`.
- `schema.prisma` model `Student` — additive `userProfileId String? @unique`, `onDelete: SetNull`
  (the `Guardian` precedent).
