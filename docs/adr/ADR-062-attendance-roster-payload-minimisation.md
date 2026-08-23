# ADR-062 — The attendance roster payload stops being MAXIMAL, and the projection is refused a photograph

- **Status** Accepted
- **Date** 2026-08-23 (run 72)
- **Story** `S-E05-6` — [`docs/spec/features/v3-e05/stories/S-E05-6.md`](../spec/features/v3-e05/stories/S-E05-6.md)
- **Epic** `V3-E05` — AuthN/AuthZ hardening and permission integrity (layer L0)
- **Closes** `PF-269` (P1) · `PF-274` (P2) · **completes `PF-07`** on the WHAT axis, lifting the `AC-21`
  qualifier `ADR-061 §D6` attached to it · **Raises** `PF-275` · `PF-276` · `PF-277`
- **Predecessor** `ADR-061` (`S-E05-5`, PR #264) — the WHO axis of the same finding
- **Related** `ADR-061 §D6` (the carried-forward WHAT axis, and the sentence this ADR refutes) ·
  `ADR-061 §D1` / `PF-270` (why a cross-module seam is blocked on a prior decision) ·
  `GUARDRAILS.md` §1 (children's data, minimal access, non-negotiable)

---

## Context

`ADR-061` narrowed **who** may read four attendance handlers. It narrowed **nothing** about **what**
they return. Three Prisma reads in
`apps/api/src/modules/attendance/attendance.controller.ts` still carried `include: { student: true }`:

| # | Handler | Route | Expression |
|---|---|---|---|
| 1 | `sessionDetail` | `GET /class-sessions/:id` | `classSection.enrollments[].student` |
| 2 | `sessionDetail` | `GET /class-sessions/:id` | `attendanceRecords[].student` |
| 3 | `roster` | `GET /class-sessions/:id/roster` | `enrollments[].student` |

`student: true` is the **whole `Student` row** — `medicalNotes`, `address` (Json), `notes`,
`customFields` (Json), `birthDate`, `email`, `phone`, `gender`, `nationality`, `photoUrl`, `status`,
`userProfileId`, `schoolId`, `tenantId`, timestamps — for **every actively enrolled child of the
class**, on every attendance-taking page load, to the *owning* subject teacher. That is RGPD
special-category data about minors, delivered to a caller who asked to mark a register.

The change itself is small and uncontestable: adopt the house `select` form (already present in this
very file — `overview`, `:882` after this diff, `:855` before it — and at twenty-plus sites across
`announcements`, `guardians`,
`child-claims`, `enrollments`, `analytics`). **What is contestable — and what this ADR exists for —
are the three judgement calls the story makes on the way.**

## Decision

Introduce **one module-local, non-exported** projection constant,
`ATTENDANCE_ROSTER_STUDENT_SELECT = { id, firstName, lastName, externalRef }`, and use it at all
three sites. No handler signature, route, permission code, guard, refusal order or `where` clause
changes; `ADR-061`'s ABAC is frozen to the byte and its spec passes with **no edit to any existing
assertion**.

The three decisions below are the reason this file exists. Each one is a place where a later reader
would otherwise reasonably conclude the slice was careless.

---

## D1 — `photoUrl` is REFUSED, against two standing written recommendations

Two documents in this repository recommend a five-field projection **including `photoUrl`**:

- `docs/daily-improvement-v3/NEXT.md:75` (run 71): *« `select: { id, firstName, lastName,
  externalRef, photoUrl }` »*
- `docs/daily-improvement-v3/traceability/OPEN.md` — the `PF-269` row, which still reads *"An
  attendance roster needs `{ id, firstName, lastName, externalRef, photoUrl }`"*, a sentence
  inherited verbatim from `ADR-061 §D6`.

**Both are refuted by measurement, and the recommendation is not implemented.**

- The teacher attendance list renders an **initials avatar**, composed in the page itself:
  `AttendanceManager.tsx:220` emits `firstName[0]?.toUpperCase()` + `lastName[0]?.toUpperCase()`
  inside a `<span class="grid h-9 w-9 place-items-center rounded-full …">`. There is no `<img>`, no
  `Avatar`, no `src`.
- `grep -rn photoUrl apps/web/src` returns **zero** hits in any teacher attendance file.
- The consumer's own declared type (`AttendanceManager.tsx:12`) is
  `{ id, firstName, lastName, externalRef }` — **four fields, no `photoUrl`**.

Shipping a URL that resolves to a **photograph of a named child**, for every child in the class, on
every page load, inside the slice whose entire thesis is payload minimisation, would contradict the
story on its own terms. A projection is minimal against what the consumer *renders*, not against
what a reviewer imagined it might one day render.

**This ADR therefore supersedes the `photoUrl` half of `ADR-061 §D6`.** The `PF-269` row's sentence
is corrected at closure; the rest of that section stands.

### D1.1 — The durability clause, and it is a DESIGN-SYSTEM clause

The refusal above is one line of JSX away from being undone, and the mechanism is a *reuse* of
`@pilotage/ui`, i.e. exactly the thing `GUARDRAILS.md` §2 tells the next agent to prefer.

`packages/ui/src/components/AvatarNameCell.tsx` is the house avatar-plus-name cell used by every
admin table (Élèves, Enseignants, Parents, Affectations, Inscriptions). Its first prop is
`src?: string | null` — *"Image src (optional, falls back to initials)"* — and it forwards `src`
straight to `<Avatar>`.

**A future adoption of `AvatarNameCell` in `AttendanceManager` must pass `firstName`/`lastName` and
NO `src`.** Passing `src={row.student.photoUrl}` compiles, looks like an improvement, matches every
other adoption site in the codebase, and **silently re-opens `PF-269`** — because the field it needs
does not exist in the payload, so the fix would be to widen
`ATTENDANCE_ROSTER_STUDENT_SELECT`, and the maximal payload returns through the front door with a
design-system justification.

The fallback is not a degradation: `AvatarNameCell` with no `src` renders precisely the initials the
page renders today. **The rule is: adopt the component, not the prop.**

## D2 — `externalRef` is RETAINED, against a strict-minimum reading

A strict "minimum for what is rendered" reading would drop `externalRef` too: the page reads it at
the **type** level only (`AttendanceManager.tsx:12`) and never in JSX. It is retained anyway, and the
reason is stated so a later minimiser does not treat it as an oversight:

1. It is the school's own pupil identifier (the *matricule*) — an **establishment-issued key**, not a
   personal attribute. It carries none of the sensitivity that motivates the slice: it is not
   special-category data, not contact data, not a home address, not a photograph.
2. It is the only **homonym disambiguator** in a class list. A register that cannot distinguish two
   children sharing a name is a correctness defect in the register itself.
3. The consumer's declared contract already carries it, and `AC-9` forbids widening or narrowing
   `RosterRow`. Dropping it server-side would leave the FE type promising a field the API stopped
   sending — a `DNC-06`-shaped divergence created *by* the minimisation.
4. The nearest analogue in the codebase — the gradebook roster,
   `grades/assessments.controller.ts:157` — already returns **exactly this four-field shape**.
   Diverging from it would make two neighbouring rosters disagree about what a student summary is,
   for no measured gain.

**The asymmetry between D1 and D2 is the point.** `photoUrl` is excluded because it is sensitive
*and* unused; `externalRef` is retained because it is non-sensitive *and* structurally load-bearing.
Minimality is judged per field against sensitivity × use, never by field count.

## D3 — NO cross-module projection is extracted, and the first-of-kind constant is deliberate

`ATTENDANCE_ROSTER_STUDENT_SELECT` is the **first named `*_SELECT` constant anywhere in `apps/api`**
— `grep -rn "_SELECT = {" apps/api/src` returns exactly this one hit. Twenty-plus sites, including
the `assessments.controller.ts:157` precedent this story cites, **inline** the same object literal.
A first-of-kind convention is a new architectural decision, so it is sanctioned here rather than
smuggled in.

**What is sanctioned, precisely:** a **module-local, non-exported `const` naming a projection reused
by more than one read in the same file.** Three sites in one file, one of them nested two relations
deep, is past the threshold where copy-paste stops being honest — the failure mode is a future edit
narrowing two of the three and leaving the third maximal, which is unreviewable by eye and is exactly
how `PF-269` outlives its own fix. The constant makes divergence impossible to express.

**What is explicitly NOT sanctioned:** a shared, exported `StudentSummary` projection across modules.
The twenty-plus existing declarations **disagree** on whether `id` and `externalRef` are present, so
consolidating them is not a rename — it is a decision about what a student summary *is*, taken across
`guardians`, `grades`, `enrollments`, `analytics`, `announcements` and `child-claims` at once. It has
`PF-270`'s shape one layer down (`ADR-061 §D1` already blocked the analogous authorization-predicate
consolidation on a prior decision), and doing it inside a payload-minimisation slice would make the
diff unreviewable and destroy the evidence for both changes. → **`PF-276`**.

The constant's docblock says so in the file itself: *« Module-local et NON exportée : cette tranche
n'introduit AUCUNE projection partagée entre modules (`ADR-062 §D3`) »*. The citation and this
section are the same claim, checked from both ends.

## D4 — `orderBy` survives the nested `select`, and that is asserted, not assumed

`roster` sorts with `orderBy: { student: { lastName: 'asc' } }` on the `enrollments` relation. Prisma
evaluates a relation `orderBy` independently of that relation's `select`, so the ordering is
untouched by the narrowing — but a teacher marks a register by reading **down** a list, and a
silently reshuffled class list is a data-entry hazard, not a cosmetic regression. `AC-5` pins both
`orderBy` and `where` on the recorded query arguments so a future "tidy-up" of the projection cannot
take the sort with it.

---

## Consequences

**Positive.** The owning teacher stops receiving every child's medical notes, home address, free-text
notes, `customFields`, date of birth, email and phone on every attendance-taking page load.
`sessionDetail` — which has **zero first-party consumers** (§1.4 census: `grep -rn "class-sessions"
apps/web/src` returns four hits, all `teacher/`, and only `roster` is called) — is narrowed on the
same terms rather than left alone, because it is an authenticated endpoint that emits the same rows.
`PF-07` closes on both axes; `PF-274` (`role="alert"` on the teacher error banner, WCAG 2.2 AA
§4.1.3) closes with it, because `ADR-061` made that banner reachable on a new refusal path and it is
the FE half of the same defect family.

**Negative / accepted.** Three residual `include: { student: true }` sites survive elsewhere in
`apps/api` — `guardians.controller.ts:133`, `grades.service.ts:196`,
`enrollments.controller.ts:540` — measured, not fixed: the story's file set is
`attendance.controller.ts` plus one attribute of `AttendanceManager.tsx`, and each of those three has
a different consumer census to run. → **`PF-277`**. The `photoUrl` refusal is durable only as long as
D1.1 is honoured. The first-of-kind `*_SELECT` convention now exists and will be copied.

**What the test proves, and what it does NOT.** The new `describe` in
`attendance-read-abac.spec.ts` asserts the projection the handlers **request** — the `select`
arguments emitted to Prisma — key by key, plus the *cardinality* of `student` nodes in the recorded
tree (2 for `sessionDetail`, 1 for `roster`), so a site left at `student: true` cannot pass by
absence. The bridge from requested projection to wire payload is Prisma's documented `select`
semantics; the query engine is not under test here, matching the file's own header. It **cannot**
assert the returned payload: `makeDb()` **records** `select`/`include` without ever **applying**
them, so an assertion like `expect(out.roster[0].student.medicalNotes).toBeUndefined()` would be
**red against a perfectly correct implementation** and would invite either "fixing" the controller or
shrinking the fixture — both wrong. → **`PF-275`**. The shared `studentRow()` fixture therefore stays
wide *on purpose* (it still seeds `medicalNotes`), and the block's last `it` **pins** it as a negative
witness, because an unpinned witness degrades in silence and would turn the whole block green against
a **reverted** diff.

**Not proven by this slice, stated plainly.** No jest, no `pnpm typecheck` and no build were run by
the implementing agent (budget: only the test-architect runs the chain). Nothing here is claimed for
`pilotage.srv861861.hstgr.cloud`, which was not contacted.

## Findings raised

`PF-275` (P2) — the ABAC harness records `select`/`include` without applying them, so no spec in this
file can assert a returned payload; the wide fixture is a load-bearing negative witness ·
`PF-276` (P2) — twenty-plus divergent inline student projections across six modules, no shared
`StudentSummary`, and the modules disagree on `id`/`externalRef` ·
`PF-277` (P2) — three surviving `include: { student: true }` sites outside `attendance`
(`guardians.controller.ts:133`, `grades.service.ts:196`, `enrollments.controller.ts:540`).

Recorded in [`traceability/OPEN.md`](../daily-improvement-v3/traceability/OPEN.md) and
[`audit-findings-index.md`](../daily-improvement-v3/audit-findings-index.md).
