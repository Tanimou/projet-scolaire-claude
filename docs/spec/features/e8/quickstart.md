# E8 — Quickstart (manual demo per slice)

> How to exercise **E8 — Student Portal** by hand once each slice ships. Companion to
> [`spec.md`](./spec.md) / [`tasks.md`](./tasks.md) / [`contracts/openapi.yaml`](./contracts/openapi.yaml).
> App runs hybrid (infra in Docker + web local on **:3100**; API on **:4000**). Demo data =
> `voltaire-demo`. **Do not rebuild the stack for this** (screenshots only if the app is already up).

## 0. Prerequisites (one-time, S1)

E8 needs a **provisioned student account**: a `UserProfile` with the **`student`** realm-role whose id is
set on a `Student.userProfileId` (the additive link S1 adds). For the MVP there is **no provisioning UI**
(Non-goal) — provision via seed/import:

- Ensure `seed-demo.ts` (or a manual `db` step) creates a `student`-role Keycloak user and links one
  `voltaire-demo` pupil: `Student.userProfileId = <that user's UserProfile id>`.
- Suggested demo login (align with `seed-demo.ts` when S1 lands): `eleve@pilotage.local` /
  `Changeme123!` (a `student`-role user linked to a demo pupil). An **unlinked** `student` user is also
  useful to demo the activation gate (scenario 7).

> If infra is down (the recurring E7 note), the additive `Student.userProfileId db push` + the seed must
> be applied by an operator before the portal is functional — until then `/student/me` returns
> `activated:false` for everyone and the portal shows the kind activation gate (never a crash).

## 1. S1 — Student role + self-ABAC + auth wiring + "Mes notes"

1. **Log in as a linked student** at `http://localhost:3100` → you land on `/student` ("Mes notes" until
   S3 adds the dashboard). The header shows **your own** name + class (`/student/me`).
2. **Read your own grades.** "Mes notes" lists **your** published grades by subject + the teacher
   comment. Confirm: only **published** grades (no drafts), only **your** subjects, **no class average**
   beside your own.
3. **Prove the wall (the security demo).**
   - `GET /api/v1/student/grades` with your student bearer → 200, **your** grades.
   - Try to reach a parent/teacher/admin endpoint with the student token (e.g.
     `GET /api/v1/analytics/parent-dashboard/<any-studentId>`) → **403/deny** (missing permission + the
     wall).
   - There is **no `:studentId`** on any `/student/*` route — confirm a tampered `?studentId=<foreign>`
     has nowhere to bind and returns **your own** data (the id is ignored, not honoured).
4. **Unlinked-account gate.** Log in as a `student` user with **no** linked `Student` → the portal shows
   the kind activation explainer (*"ton espace n'est pas encore activé"*), **never** another student's
   data, never a 500.
5. **ADR check.** `docs/adr/ADR-021-student-role-and-self-abac.md` exists and records the role
   activation, the `portal-parent` client reuse, the additive link, and the fails-closed self-ABAC.

**Expected:** a student reads **only** their own published grades; any other student/endpoint is denied;
the wall fails closed; ADR-021 is present.

## 2. S2 — "À venir" + "Mon assiduité"

1. **À venir** (`/student/upcoming`) → your own upcoming assessments, soonest first (subject, date,
   coefficient). Confirm it matches what the parent sees for you (same `parent-upcoming` producer,
   self-resolved).
2. **Mon assiduité** (`/student/attendance`) → your own attendance summary + records (present/absent/
   late/justified), factual and kind — **no** disciplinary framing, **no** class comparison.
3. **Re-prove the wall** on each: no `:studentId` to supply; a student token cannot read another
   student's upcoming/attendance (403/deny).

**Expected:** two read-only surfaces, each your own data only, behind the same proven S1 wall, no peer
data, no schema change.

## 3. S3 — "Les annonces" + "Mon objectif" dashboard

0. **Annonces** (`/student/announcements`) → only announcements that reach you (school / your class /
   personal). Confirm a staff-only or other-class announcement is **absent**; the wall holds (no
   `:studentId` to supply).

1. **Open `/student/dashboard`** → the calm, first-person hero:
   - **Block A (E6 trend):** per-subject direction + your own delta (*"Maths : en progrès (+1,8 pt)"* ·
     *"Français : à consolider"*). Confirm **no rank, no class average, no peer**.
   - **Block B (à préparer):** the next assessments to prepare (deep-link to "À venir").
   - **Block C (ton soutien, E7):** if a demo `RemediationPlan` exists for the pupil, a kind
     second-person line (*"Ton soutien en maths : 2 séances faites, prochaine mardi · +1,2 pt"*); on an
     upturn it lights the **emerald** E3 `IMPROVEMENT` lane. No plan → the block is simply absent.
2. **<2 s + degrade.** The dashboard holds the <2 s budget (reads the existing snapshot/producers); kill
   a sub-read (or use a pupil with no snapshot) → that block degrades to a warm empty state, the
   dashboard still renders (best-effort, never blocks).
3. **RGPD/safeguarding sweep.** Walk every E8 screen and confirm: **no** rank, **no** class average
   framed against you, **no** other child's name/data, **no** "échec/mauvais/dernier/leaderboard", **no**
   write button. Copy is first-person and kind throughout.

**Expected:** an actionable, non-stigmatising learner dashboard reusing the E6 trend + E7 progress +
next assessments, zero peer comparison, <2 s, degrades kindly — the visionary payoff.

## 4. Cross-slice acceptance sweep (RGPD wall)

- Every `/student/*` read is **server-resolved to self** (no `:studentId`), **fails closed** (unlinked →
  no data), **tenant-scoped**, **read-only**, and **excludes** medical/guardian-private fields.
- **No student payload contains** `studentRank` / `classAverage` / `classRankTotal` (inspect the JSON —
  the wall is in the shape, AC-7).
- The three existing portals (`/admin|/teacher|/parent`) are **unchanged**; no existing permission is
  widened; the only schema change is the additive `Student.userProfileId` link.
