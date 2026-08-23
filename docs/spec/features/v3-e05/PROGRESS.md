# V3-E05 — AuthN/AuthZ hardening and permission integrity

**Layer** L0 · **Size** L · **Depends on** — (may run in parallel with `V3-E03`; disjoint seams: guards/DTOs vs read projections) · **Blocks** nothing
**Owns** PF-07, PF-08, PF-09, PF-10, PF-11, PF-25, PF-26, PF-46, PF-51, PF-52, PF-53, **PF-102**, VAL-07 · **Gates** G-AUTHZ, G-TENANT, G-PORTAL, G-DNC
**Status (2026-08-23)** `in-progress` — **ten slices landed**: `S-E05-12` (2026-08-07), `S-E05-2` (2026-08-11),
`S-E05-11` (2026-08-12, `db2473b` / #222), `S-E05-7` (2026-08-12), **`S-E05-2c` (2026-08-12, #229)**, **`S-E05-3` (2026-08-22)**, **`S-E05-5` (2026-08-23, #264)**, **`S-E05-6` (2026-08-23, #265)** and **`S-E05-14` (2026-08-23, #266 — `PF-278` + `PF-280`, `ADR-063`)** and **`S-E05-13` (2026-08-23, this PR — `PF-51` **advanced**, not closed, `ADR-064`)**. Each was authored and implemented in the same
run: the story under [`stories/`](./stories/) **is** the authoring pass this file used to say was missing. The
remaining four (`S-E05-1`, `S-E05-4`, `S-E05-8` … `S-E05-10`) still exist as **rows in
[`docs/daily-improvement-v3/traceability-matrix.md`](../../../daily-improvement-v3/traceability-matrix.md) only** —
`docs/daily-improvement-v3/stories/sprint-01.md` enumerates no `S-E05-*` story, so none of them is implementable
without an authoring pass of its own. *(**`S-E05-13` left this list on 2026-08-23**: the renumbered `PF-51`
placeholder was authored and implemented in the same run, the `S-E05-2` posture, under operator override. It is
the first of the six matrix-row-only allocations to be discharged.)*
**Next slice → `S-E05-2b` — the `realmRole` invite channel, the fifth grant path `S-E05-2` deliberately left open.**
*(Annotated 2026-08-23, `S-E05-5` land pass — **not** deleted. `S-E05-5` was scheduled over this pointer by operator
override, exactly as `S-E05-7` and `S-E05-3` were before it. An override **schedules over** a recommendation without
refuting it: `S-E05-2b` is still open, still unclaimed, and still the standing recommendation of the `S-E05-2` land
pass. The queue behind it now also carries **`PF-269`** — the attendance roster payload, the WHAT axis `S-E05-5`
deliberately did not narrow — and **`PF-267`**, the ownership check `justify` still lacks.)*
*(Annotated again 2026-08-23, `S-E05-6` land pass — **not** deleted, for the fifth time and the same reason:
`S-E05-6` was scheduled over this pointer by operator override, and an override schedules over a recommendation
without refuting it. `S-E05-2b` is still open, still unclaimed, still the epic's only **live escalation path**.
**One item leaves the queue and a bigger one joins it.** `PF-269` — named in the annotation directly above as the
WHAT axis `S-E05-5` did not narrow — is **closed by this PR**; note that the same annotation's `photoUrl`
prescription is **refuted** by `ADR-062 §D1`, on measurement. What joins the queue is **`PF-278`**, and it ranks
ahead of `PF-267`: `GET /api/v1/enrollments/roster/:classSectionId` (`enrollments.controller.ts:540`) is the same
defect this slice just closed — `include: { student: true }` on a class roster — but guarded only by
`enrollments.read`, **which `parent` holds**, with a tenant check and no ABAC at all. Wider audience, no 403, same
handler name, one module over. Ranking after this run: **`PF-278` → `PF-267` → `PF-277` → `S-E05-2b`**.)*
*(Annotated a THIRD time 2026-08-23, `S-E05-14` land pass — **not** deleted, for the sixth time and the same
reason: `S-E05-14` was scheduled over this pointer by operator override, and an override **schedules over** a
recommendation without refuting it. `S-E05-2b` is still open, still unclaimed, still the epic's only live
escalation path. **The header pointer at line 13 is contradicted by this file’s own "Next run" section and by
`OPEN.md`, and has been since run 71; it is out of date, not an instruction.** `PF-278` — ranked first by the
annotation directly above — is **closed by this PR**, on **both axes of its handler** and *not* as an exposure
class: the same peer enumeration survives one handler over at `enrollments.controller.ts:122` and joins the queue
as **`PF-283`** (`ADR-063 §D6`). Ranking after this run: **`PF-283` → `PF-267` → `PF-277` → `PF-279` →
`S-E05-2b`** — `PF-283` leads because it is the only P1 in the queue and it is the residue this slice knowingly
left. `PF-281` (`findForUser` ignores `TeacherProfile.active`) and `PF-282` (`ADR-060` is missing from
`docs/adr/`) also join, at P2 and P3.)*
*(Annotated a FOURTH time 2026-08-23, `S-E05-13` land pass — **not** deleted, for the seventh time and the same
reason. `S-E05-2b` is still open, still unclaimed, still the epic’s only live escalation path. **This run is the
first of the seven that does NOT discharge the item the previous annotation ranked first**: `PF-283` was ranked
first by the annotation directly above and is **still open, still unclaimed, still the only P1 in the queue** —
`S-E05-13` was scheduled over it and its own story says so in §0.1. Nothing in this run may be read as progress on
`PF-283`. What joins the queue is **`PF-287`**, and it ranks *second*: `ADR-064` establishes two rules and the
ratchet enforces only one of them, so the two surviving `data: body` mass-assignments —
`cycles.controller.ts:132` (twelve lines above the handler this slice repaired, **same file**) and
`subjects.controller.ts:168` — run on **defence 1 alone**, the posture this slice’s own docblock argues at length
is insufficient. Ranking after this run: **`PF-283` → `PF-287` → `PF-284` → `PF-267` → `PF-277` → `PF-279` →
`S-E05-2b`**. Also joining: `PF-284` (P2, a one-sided date PATCH still inverts a term’s stored order),
`PF-285` (P2, **six** privileged structural mutations write no audit row) and `PF-286` (P3, the four Zod
handlers never traverse the global pipe, so unknown keys are silently stripped rather than refused).)*
Still open, still unclaimed: `S-E05-7` was scheduled over it by operator override, not instead of it. See "Next run"
below, and § `S-E05-7` → "Next run" for the ranking as it stands after this slice.

> **OPERATIVE NEXT SLICE (2026-08-23, `S-E05-14` land pass) → `S-E05-15` — `PF-283`: the enrollments LIST path gets
> the wall `roster` just got.** The `Next slice →` line above is the *standing pointer* and is preserved by
> convention (six overrides have now scheduled over it without refuting it); **this** line is the *ranking*, and
> where the two disagree this is the one the next run should read. `S-E05-15` is **not yet authored** — no story
> file exists under [`stories/`](./stories/) — and it must open with its own consumer census, because unlike
> `roster` the **path** is consumed (`apps/web/src/app/admin/students/actions.ts:55`). Scope it to **both**
> unscoped query axes (`?classSectionId=` **and** `?studentId=`) and to the
> `classSection: { include: { gradeLevel: true } }` payload, or the ledger will read clean while the live half of
> the exposure `PF-278`/`PF-280` name is still on the wire.
>
> **Census correction, taken at land and not inherited.** Three artefacts of this run — the `PF-283` row as first
> written, `ADR-063 §D6`, and the escalation panel — state that this path "is consumed, unlike `roster`". That is
> true of the **path** and false of the **handler**. `grep -rn "api/v1/enrollments" apps/web/src` returns three
> hits and **all three are mutations**: `actions.ts:55` `POST /api/v1/enrollments`, `:74` `POST /:id/transfer`,
> `:92` `PATCH /:id`. **No first-party caller issues the `GET`.** So `S-E05-15` may take the *same* treatment
> `roster` just took — wall **and** projection — with no compatibility census owed. The correction runs in the
> slice's favour, which is exactly why it would have been easy to carry the wrong version forward.
>
> **Still operative after the `S-E05-13` land pass (2026-08-23).** `S-E05-13` was scheduled over this block by
> operator override and **did not touch `PF-283`**: no query parameter of `GET /enrollments` was validated, no
> ABAC was added there, and the `classSection` payload is unchanged. `S-E05-15` remains **unauthored and
> unclaimed**, and it remains the ranking. What `S-E05-13` adds *behind* it is **`PF-287`** — see the fourth
> annotation on the standing pointer above.

*(Corrected 2026-08-11, `S-E05-2` land pass. Lines 5-12 used to read "`S-E05-12` … is the only one with a written
story" and "**Next slice → not in this epic** … nothing in this epic is enumerated". Both were falsified by the diff
that carries this edit — `S-E05-2.md` §0.4 names the contradiction and overrides it rather than obeying it. Named here
rather than silently overwritten: a status line the next autonomous run reads at Step 1 is exactly the kind of stale
truth that makes it skip work that is ready.)*

*(Corrected again 2026-08-12, `S-E05-7` land pass. The block above said **two** slices landed and left `S-E05-11`
marked `⬜ unenumerated` in the table below — a row already falsified by `HEAD` at the time it was read, since
`db2473b` (#222) shipped `S-E05-11` on 2026-08-12. `S-E05-7.md` §0.1 named both stale rows in advance and this pass
discharges that instruction. The count is now **four**, and the `Next slice` pointer is annotated rather than deleted:
it was a recommendation from the `S-E05-2` land pass, never an instruction, and it survives this run untouched.)*

*(Corrected a third time 2026-08-22, `S-E05-3` land pass. Two lines above were falsified by the diff that carries this
edit: the count read **five**, and the sentence at line 8 listed `S-E05-3` among the rows that "still exist as rows in
`traceability-matrix.md` only". `S-E05-3.md` §0.1 named both in advance and this pass discharges that instruction. The
slice-status row below moves from `⬜ unenumerated` to `⚠️ done`. The `Next slice` pointer is annotated, not deleted —
`S-E05-3` ran on an operator override, which schedules over a recommendation without refuting it — and the queue behind
it gains **`PF-240`**, the remediation sweep for the rows `PF-10` already wrote.)*

*(Corrected a fourth time 2026-08-23, `S-E05-5` land pass. Three things above were falsified by the diff that carries
this edit: the count read **six**; line 8 listed `S-E05-5` among the rows that "still exist as rows in
`traceability-matrix.md` only"; and the slice-status row below read `⬜ unenumerated · matrix row only`. `S-E05-5.md`
§0.1 named the first in advance — it argued that the brief undercounted at "5 of 12" and that **this file was right**
about the count — and this pass discharges that instruction by moving it to seven. The `Next slice` pointer is
annotated rather than deleted, on the same terms as the three corrections above it.)*

*(Corrected a fifth time 2026-08-23, `S-E05-6` land pass. Two things above were falsified by the diff that carries
this edit: the count read **seven**, and line 8 listed `S-E05-6` among the rows that "still exist as rows in
`traceability-matrix.md` only" — it is the slice this PR ships. The slice-status row below moves from
`⬜ unenumerated` to `⚠️ done`.)*

*(**ID COLLISION, ARBITRATED 2026-08-23 by the `S-E05-6` land pass — read this before citing `S-E05-6` or
`S-E05-13`.** The id `S-E05-6` had **two** allocations. The older one is a *matrix-row-only* placeholder for
"unvalidated PATCH / query params / enum (`PF-51`)": it has no story file, is enumerated in no sprint, and is cited
from **no** source file. The newer one is the attendance-roster-payload slice shipped by this PR, and it is already
written into **four sites of shipped source** — `apps/api/src/modules/attendance/attendance.controller.ts:41`,
`attendance-read-abac.spec.ts` (×3), the story filename `stories/S-E05-6.md`, and `ADR-062`'s header. The rule from
the `PF-185`/`PF-186` collision of runs 53/54 applies: **renumber by MEANING, and renumber the allocation that is not
quoted from production code.** The `PF-51` placeholder therefore becomes **`S-E05-13`** — the next free id — in this
file, in `docs/daily-improvement-v3/traceability/OPEN.md` and in `docs/daily-improvement-v3/sprints/sprint-plan.md`.
Its subject is unchanged; only its label moved. **The escalation panel of this run recommended the opposite
direction** (renumber the new slice to `S-E05-13` and leave `PF-51` alone); it is recorded here rather than
silently overridden, and the reason it was not followed is that the alternative renames four citations inside
`apps/api` on a P1 diff whose typecheck gate has already run — churn in shipped source to protect a placeholder.
A human may reverse this call; if they do, the four source citations move with it.)*
> **Why there is no `spec.md` here.** Same posture as
> [`docs/spec/features/v3-e02/PROGRESS.md`](../v3-e02/PROGRESS.md) and
> [`docs/spec/features/v3-e06/PROGRESS.md`](../v3-e06/PROGRESS.md): V3 stories are authored **pre-sliced**, carrying
> acceptance criteria, a stated test and an explicit out-of-scope list — they already hold what a `spec.md` + `tasks.md`
> pair would. The epic contract lives in
> [`docs/daily-improvement-v3/roadmap.md`](../../../daily-improvement-v3/roadmap.md) (§`V3-E05`). This file is the
> epic's status ledger; per-slice specs live in `stories/`.
>
> *(This file was created by the `S-E05-12` land pass, 2026-08-07. `S-E05-12.md` §0.1 justified shipping without it by
> citing `v3-e06` as precedent for "`PROGRESS.md` + `stories/`" — which **includes** the file it was omitting. Named
> here rather than quietly fixed, because a self-refuting justification in a story header is exactly the kind of claim
> the next autonomous run reads at Step 1 and believes.)*

**Objective.** The authentication and authorisation surfaces stop being trusted by assertion. Every wall this epic owns
is either proven by an executed test or recorded, with an owner, as not proven.

## Slice status

| Story | Title | State | Run | Evidence |
|---|---|---|---|---|
| **S-E05-12** | The post-authentication redirect target becomes same-origin-only, on all four portal login forms | ⚠️ done — **needs human review** | 2026-08-07 | spec: [`stories/S-E05-12.md`](./stories/S-E05-12.md) · **`PF-102` closed**, `PF-103`'s `PORTAL_LANDING`-declared-twice note retired, no new finding raised · evidence below |
| S-E05-1 | Global custom roles are cross-tenant (`PF-08`) + `VAL-07` | ⬜ unenumerated | — | matrix row only — no story in `sprint-01` |
| **S-E05-2** | **The privilege ceiling: no grantor may mint, rewrite or assign a permission they do not themselves hold** (`PF-09`, `PF-156`) | ⚠️ done — **needs human review** | 2026-08-11 | spec: [`stories/S-E05-2.md`](./stories/S-E05-2.md) · **`PF-09` narrowed to 4 of 5 grant channels, NOT closed** (the `realmRole` invite channel stays open — see evidence below) · `PF-156` closed with its `isSystem` remedy **declined and argued** · `ADR-015` gains its first `D<n>` amendment; `ADR-035`'s "we do not change who may grant what" posture marked SUPERSEDED · raises the `S-E05-2b` residual set · evidence below |
| **S-E05-2c** | **The detection sweep for pre-ceiling escalated grants** (`PF-175`) | ⚠️ done — **needs human review** | 2026-08-12 | landed as **#229** · spec: [`stories/S-E05-2c.md`](./stories/S-E05-2c.md) · **`PF-175` NARROWED, not closed** — the detector exists and is proven, but has **never been executed against a database** · evidence below |
| **S-E05-3** | **The coefficient matrix stops accepting foreign-tenant identifiers** (`PF-10`) | ⚠️ done — **needs human review** | 2026-08-22 | spec: [`stories/S-E05-3.md`](./stories/S-E05-3.md) · **`PF-10` closed on its REACHABLE write path** — the composite key stays tenant-blind (`PF-239`) and the rows the defect already wrote are neither detected nor repaired (`PF-240`) · new **`ADR-055`** (scope-FK ownership over a COLLECTION) · also records **`PF-238`** (no cap on `entries[]`) · evidence below |
| S-E05-4 | Notification dedup is not tenant-scoped (`PF-11`) | ⬜ unenumerated | — | matrix row only |
| **S-E05-5** | **The attendance READ paths gain the ABAC their WRITE paths already have** (`PF-07`) | ⚠️ done — **needs human review** | 2026-08-23 | spec: [`stories/S-E05-5.md`](./stories/S-E05-5.md) · **`PF-07` closed on the WHO axis ONLY** — four handlers (not the audit’s two) gain teacher/privileged ABAC via exported pure decision functions; the **WHAT** axis (`include: { student: true }` still returning `medicalNotes`/`address`/`notes`/`customFields`) is carried forward as **`PF-269`**, and the row may not read `closed` without that sentence · new **`ADR-061`** (§D0 supersedes the audit sentence — the exposed audience included **`parent`**, not only `teacher`; §D1 the teaching wall constrains the **active academic year** on both halves; §D3 ownership reads the denormalised `classSession.teacherProfileId`, the same bit the WRITE trusts; §D4 404 before 403; §D7 the parent branch stays byte-identical and `parent` deliberately precedes `privileged`) · also records **`PF-264`…`PF-274`** · test: `apps/api/src/modules/attendance/attendance-read-abac.spec.ts` — **written, not executed by its author** |
| **S-E05-6** | **The attendance roster payload stops being MAXIMAL** (`PF-269`, `PF-274`) | ⚠️ done — **needs human review** | 2026-08-23 | spec: [`stories/S-E05-6.md`](./stories/S-E05-6.md) · **`PF-269` closed** — the three `include: { student: true }` sites in `attendance.controller.ts` (`sessionDetail` ×2, `roster`) become one module-local `ATTENDANCE_ROSTER_STUDENT_SELECT = { id, firstName, lastName, externalRef }` · **`PF-274` closed** (`role="alert"` on the teacher error banner — a `V3-E06` row deliberately folded into this `V3-E05` slice, because the banner is the surface `S-E05-5`'s new 403 lands on) · **`PF-07` loses its `AC-21` qualifier and reads closed on BOTH axes** for the first time · new **`ADR-062`** (§D1 `photoUrl` REFUSED against two standing written recommendations, on measurement — the list composes an initials avatar; §D1.1 the design-system durability clause — a future `AvatarNameCell` adoption must pass no `src`; §D2 `externalRef` RETAINED, asymmetry deliberate; §D3 the first-of-kind `*_SELECT` constant is sanctioned as module-local **only**, the cross-module `StudentSummary` extraction refused) · also records **`PF-275`**…**`PF-278`** · test: `apps/api/src/modules/attendance/attendance-read-abac.spec.ts` — **74/74 executed green, and the ratchet proven by TWO mutations** (revert the three sites → 5 red; add `photoUrl` → closure assertion red) |
| **S-E05-13** | **The two `Partial<T>` request bodies stop erasing to `Object`, and the grade-level PATCH stops mass-assigning into Prisma** (`PF-51`) | ⚠️ done — **needs human review** | 2026-08-23 | spec: [`stories/S-E05-13.md`](./stories/S-E05-13.md) · **`PF-51` `in-progress`, explicitly NOT closed** — the row covers three clauses (PATCH bodies / query params / enum) and this slice closes the **first** only; the three unvalidated query params of `GET /enrollments` (`enrollments.controller.ts:122`) and the notification-kind clause both stay open, and `OPEN.md:73`’s standing instruction *“Do NOT flip this row on the strength of one parameter”* still holds · new **`ADR-064`** (§D1 a `@Body()` is a **class** — the metatype rule, ratchet-enforced across all 41 controllers; §D1a the derived Zod exemption as the single sanctioned second style, `MANUAL_ALLOWLIST` empty; §D1b the accepted negative — a controller may **not** annotate `@Body()` with a DTO imported from `@pilotage/contracts` or any non-relative module, because the classifier cannot prove it is a class; §D2 a privileged write **picks its fields**, never `data: body`, with the per-field blast-radius table; §D2a why both defences ship and why no test asserts a status code) · also records **`PF-284`**…**`PF-287`** · tests: `apps/api/src/modules/school-structure/grade-level-mass-assignment.spec.ts` (574 l) + `apps/api/src/shared/quality/body-metatype-gate.spec.ts` (849 l) — **written un-executed by their author, then EXECUTED at the land pass** — `npx jest --runInBand` gives **38/38** and **33/33** (71 green). A green run only proves half, so both defences were also proven **RED BY MUTATION** and the mutations reverted: deleting `forbidNonWhitelisted` from `main.ts` fails exactly the 6 hostile-key refusals, and restoring `data: body` fails exactly the 2 AC-4 assertions that read `Object.keys()` of the Prisma argument. The land pass also **fixed a twin-list defect the sprint raised against itself**: `GLOBAL_PIPE_OPTIONS` was a hand-transcribed copy of `main.ts:141-145`, so the first mutation above would have stayed green — it now DERIVES the options by reading `main.ts` and throws rather than defaulting if it cannot. The ratchet’s census (41 controllers / 77 `@Body()` / 4 sanctioned / 0 offenders) is now carried by an executed jest run, not only by a standalone classifier · evidence below |
| **S-E05-7** | **The public registration funnel gains an admission bound: two tiers, one fixed window, in process** (`PF-46`, throttling third) | ⚠️ done — **needs human review** | 2026-08-12 | spec: [`stories/S-E05-7.md`](./stories/S-E05-7.md) · **`PF-46` NARROWED, not closed** — the `emailVerified` third (R-3) stays open · new **`ADR-038`** (in-process admission bounds on pre-auth endpoints) — shipped *against* the story's own §5 "no new ADR", on Winston's ruling · raises **R-1** (the global ceiling is itself a DoS lever, real fix `infra/nginx/`) and **R-2** (per-process counters, `ADR-038` D2) · **the shipped constants diverge from the story's §1.4 and a human must ratify the numbers** · evidence below |
| S-E05-8 | Wrong password reported as "MFA required" (`PF-25`) | ⬜ unenumerated | — | matrix row only |
| S-E05-9 | Logout / `session.error` / nine phantom auth routes (`PF-26`, `PF-91`) | ⬜ unenumerated | — | matrix row only; `PF-91` is inventoried in `scripts/link-integrity-baseline.json` by `S-E06-3` |
| S-E05-10 | Unused `hasPermission`, `users.suspend` unimplemented (`PF-52`) | ⬜ unenumerated | — | matrix row only |
| **S-E05-11** | **The public registration path becomes atomic, compensated and audited** (`PF-166`) | ⚠️ done — **needs human review** | 2026-08-12 | landed as commit `db2473b` (#222). **`PF-166` closed.** *(Row corrected by the `S-E05-7` land pass: it read `⬜ unenumerated · matrix row only` while the code was already on `main`. Note the **subject changed**: the matrix row this line inherited names "non-atomic invite/permission rewrite, catalogue drift (`PF-53`)", which is a **different finding** — `PF-53` is still open and still unenumerated.)* |

---

## S-E05-6 — evidence (this PR, 2026-08-23)

### What was actually wrong

`S-E05-5` (#264) closed `PF-07` on the **WHO** axis and said so in its own row: the payload was untouched and carried
forward as `PF-269`. Three deep reads in `apps/api/src/modules/attendance/attendance.controller.ts` still asked for
`include: { student: true }` — the **whole `Student` row** as declared in `schema.prisma`: `medicalNotes`, `address`
(Json), `notes`, `customFields` (Json), `birthDate`, `email`, `phone`, `gender`, `nationality`, `photoUrl`, plus
`tenantId`/`schoolId`/`userProfileId` — for **every actively enrolled child of the class**, on every attendance-taking
page load.

What makes this a slice and not a residual is the *change of character* `S-E05-5` produced. Before it, the maximal
payload was one symptom of an unauthorised read. After it, the read is correctly authorised and the payload is a
**sanctioned capability that exceeds the relation authorising it** — a teacher legitimately entitled to mark this
class receives every child's medical notes and home address as a side effect. `GUARDRAILS.md` §1 calls minimal access
non-negotiable and `medicalNotes` is special-category data about a minor.

### What the fix is, and why it has the shape it has

One module-local, **non-exported** `ATTENDANCE_ROSTER_STUDENT_SELECT = { id, firstName, lastName, externalRef }`,
applied at all three sites. Three decisions carry the slice, all recorded in **`ADR-062`**:

1. **`photoUrl` is REFUSED, against two standing written recommendations.** `NEXT.md` (run 71) and `PF-269`'s own
   remediation sentence both prescribed `{ id, firstName, lastName, externalRef, photoUrl }`. The teacher list
   composes an **initials** avatar (`AttendanceManager.tsx:220`) and `photoUrl` appears in no teacher attendance file,
   so shipping a URL that resolves to a photograph of every child in the class — inside the slice whose whole thesis
   is payload minimisation — would contradict the slice on its own terms. A written recommendation is not an
   instruction, and a measurement outranks it. **`ADR-062 §D1.1`** makes the refusal durable against the one path
   that would reopen it silently: `packages/ui`'s `AvatarNameCell` takes `src?: string | null`, so a future adoption
   in `AttendanceManager` compiles perfectly with `src={row.student.photoUrl}` and matches every other adoption site.
   The rule is *adopt the component, not the prop*.
2. **`externalRef` is RETAINED** — establishment-issued matricule, not a personal attribute; the only homonym
   disambiguator in a class list; already declared non-optionally by the consumer's own type
   (`AttendanceManager.tsx:12`); and the exact four-field shape the gradebook roster already returns
   (`grades/assessments.controller.ts:157`). The asymmetry with the `photoUrl` refusal **is the point**: minimality is
   judged per field on sensitivity × use, never by field count. Recorded honestly — no JSX renders it today.
3. **No cross-module projection is extracted.** `ATTENDANCE_ROSTER_STUDENT_SELECT` is the first named `*_SELECT`
   constant anywhere in `apps/api`, which is exactly why `ADR-062 §D3` had to sanction it explicitly rather than let
   it arrive as an unannounced convention. What §D3 sanctions is narrow: a module-local, non-exported constant for a
   projection reused by more than one read **in one file**. What it refuses is a shared exported `StudentSummary` —
   the 20+ existing declarations *disagree* on whether `id` and `externalRef` are present, so consolidating them is a
   decision about what a student summary **is**, not a rename. Recorded as `PF-276`.

The contract neither widened nor narrowed: `AttendanceManager.tsx:12` already declared exactly these four fields, so
the backend had been over-delivering against a contract the frontend never asked for. That is why the FE half of the
slice is a single attribute — `role="alert"` on the error banner, closing `PF-274` — and not a refactor.

### Evidence

- `pnpm typecheck` — **13/13 successful**, with `@pilotage/api` **and** `@pilotage/web` both genuine cache **misses**
  (recompiled, not replayed). `git diff --check` exit 0.
- `npx jest attendance-read-abac.spec.ts` — **74/74 green, 75 s**. The 66 pre-existing `S-E05-5` assertions are
  **unedited** and still green, which is what freezes the ABAC this slice sits behind.
- **The ratchet is proven by mutation, not by a green run.** Reverting all three sites to `student: true` fails
  exactly the 5 projection tests; adding `photoUrl: true` to the constant fails the closure assertion. So `ADR-062
  §D1` is enforced by a test and not only by a comment, and the tree was byte-restored after both mutations.
- A **read-only SQL probe against the live engine**: the narrow select emits **exactly 4 columns** where the wide one
  emitted **20**; `medical_notes`, `photo_url`, `address`, `notes`, `custom_fields` are never read from disk.

### Merge conditions, none fixed here

1. **The payload assertion is on the REQUESTED projection, not the returned body** (`PF-275`). `makeDb()` records
   `select`/`include` without applying them, so every current assertion would stay green if Prisma silently ignored
   the `select`. The spec file says so in its own header, which is the honest posture — but `AC-4` as written asked
   for payload evidence and the implementation redefined the gate in a comment. The SQL probe above closes the gap at
   a **strictly stronger** layer, as a one-off, **not** as a standing guard.
2. **The SQL probe ran against a database holding 0 `student` rows.** Stack up ≠ data present. It discharges the
   *mechanism*, never the *deployment* — the standing project rule that a proof executed against a scratch base is
   not a proof about the target.
3. **`AC-8` is enforced only inside the two handlers the new tests call.** Adding `include: { student: true }` to
   `justify` or `batch` — same file — reopens `PF-269` at the exact spot it was just closed, with the suite fully
   green. The defect is source-level, so the ratchet must be too; the file-level source assertion is prescribed in
   the PR body and is the single highest-value follow-up test.

### Next run

**`PF-278` outranks everything else this epic carries.** `GET /api/v1/enrollments/roster/:classSectionId`
(`enrollments.controller.ts:540`) is guarded by `enrollments.read`, **which `parent` holds**
(`permissions.constants.ts:259`), carries **only** a tenant check — no ABAC, no ownership — takes `classSectionId` as
a free parameter, and returns `include: { student: true }`. It is the defect this slice just closed, with a **wider**
audience and **without** the 403 that protects the attendance version, on a handler with the same NAME one module
over. Then `PF-267` (`justify` still has no ownership check on a WRITE), then `PF-277` (the three residual
`student: true` sites: `grades.service.ts:196`, `guardians.controller.ts:133`, and the worker's
`grades-xlsx`/`report-card-pdf`). `S-E05-2b` remains the epic's standing pointer, scheduled over a fourth time and
not refuted.

---

## S-E05-3 — evidence (this PR, 2026-08-22)

### What was actually wrong

`SubjectCoefficient` is `@@unique([gradeLevelId, subjectId])` — a key with **no tenant column and no school column** —
and `PUT /api/v1/subjects/coefficients/matrix` upserted directly onto it from `body.entries[]`, whose only gate was
`@IsUUID()`. A caller in tenant A naming tenant B’s couple took one of two branches, both live:

- `update` — **B’s own coefficient row was rewritten**, silently changing the weighted average, and therefore the
  alert rules, of every pupil of tenant B;
- `create` — a row stamped `tenantId: A` whose two FKs point into B’s school: a row whose tenant column **lies about
  its own content**, the `PF-208` shape.

This is the product’s core promise (an explainable alert on a child) being re-weighted from another tenant. It is the
reason the slice is tiered **P1 `[security][tenancy]`** and is not auto-merged.

### What the fix is, and why it has the shape it has

Ownership of **both** scope FKs is proven on `tx`, in the same transaction, before the first write. Three decisions
carry the slice, all recorded in **`ADR-055`**:

1. **Two probes, not two per entry.** `ADR-053 §D1`’s per-reference `findFirst` switch, transcribed here, would emit
   **60 statements for a 30-entry matrix** — a statement count bounded by the REQUEST, which `ADR-049 §D4` names as a
   violation. The new pure planner `distinctScopeIdPlan` (`shared/prisma/scope-fk.ts`) returns one `{ field, ids }` per
   **declared field**, so the cost is **2 probes for any body size**. It imports no Prisma and dispatches on no model
   name (`ADR-049 §D5` intact); the two `findMany` stay **lexically inline** on `tx`, because
   `tenant-adversarial-check.js`’s attribution does not traverse `this` (`PF-200`).
2. **The predicate is a conjunction**, `{ id: { in }, tenantId: me.tenantId, schoolId }`. `tenantId` stays explicit
   because the application connects as table OWNER and escapes its own RLS policies (`ADR-032 §D5`); `schoolId` is added
   because a tenant may own several schools while the sibling GET renders exactly one. The two columns are denormalised
   side by side with no constraint linking them — the conjunction is what fails **closed** when they disagree.
3. **Deduplication is case-insensitive, and that is measured.** `@IsUUID()` accepts an uppercase uuid that Postgres
   compares case-insensitively and returns lowercased. A case-sensitive key would make `owned.length !== ids.length`
   count two ids where the database returns one row, and **refuse a legitimate save**. The emitted value keeps the
   spelling received first; only the dedup key is lowercased.

The refusal reuses `unknownScopeRef(field)` **verbatim**: foreign and merely-unknown ids take the same branch and
produce a byte-identical 400 (`ADR-049 §D2` — distinguishing them would be a cross-tenant existence oracle). Because
the probes precede every write, a refusal rolls back to **zero coefficients, zero audit rows, zero recompute
triggers**, and the post-commit recompute enqueue closes **by construction** — it is a sibling of the transaction,
never reached on refusal — rather than by a second filter that would read as a security control while being dead code.

### Evidence, executed

- `pnpm typecheck` — **13 successful / 13 total** (`@pilotage/api` the one cache miss, compiled clean).
- `npx jest subjects-coefficient-scope-ownership.spec.ts provenance-callsites.spec.ts` — **2 suites, 72/72 passed** (69/69 as the sprint shipped it, +3 for `AC-14`, the round-trip block the escalation panel required at the land pass — see `stories/S-E05-3.md` §12).
- `git diff --check` — **exit 0**.
- The new suite carries a **negative control** (the pre-fix query reaching the victim), a **vacuous-path control**
  (an empty id refuses instead of shortening the set) and a **false-positive control** (an uppercase uuid that really
  belongs to the caller is accepted). Its fake database **throws on an unrecognised Prisma operator** instead of
  returning `[]`, which is what stops a misread `where` from passing vacuously.
- The three `provenance-callsites.spec.ts` doubles were **extended, never weakened**: the added `findMany` doubles
  return exactly the ids those cases already send, so provenance is still measured on the same happy path.

### `PF-10` is closed on its REACHABLE path — read what that excludes

| Residual | Id | Why it is not this slice |
|---|---|---|
| The rows the defect already wrote are neither detected nor repaired, and the `update` branch never rewrites their lying `tenant_id` | **`PF-240`** | Same shape as `PF-175`/`S-E05-2c`: a read-only detector is its own slice, and a repair is its own risk tier. The detection query is in `OPEN.md`. |
| `@@unique([gradeLevelId, subjectId])` is still tenant-blind, so ownership is *checked*, not *impossible* | **`PF-239`** | A migration — `G-MIGRATION`, plus a `scripts/restore-drill-baseline.json` entry per `PF-80`. |
| `BulkCoefficientDto.entries` has no `@ArrayMaxSize`, and the `in` arrays inherit that | **`PF-238`** | Pre-existing; the write loop, not the two probes, is the budget risk inside a 5 s interactive transaction. |

**Named and accepted (`ADR-055 §D3`):** the scope is the **school**, not the tenant. A grade level belonging to another
school of the **same** tenant is now refused, and `forTenant` resolves the default school by live student count — if
that default flips between the GET and the PUT, a legitimate save is refused. Refusal, never corruption; the inverse
choice would leave an inter-school leak open inside a tenant. **Second accepted change:** a tenant with **no school**
now receives a `NotFoundException` (404) from `forTenant` on a PUT that previously proceeded.

**DNC-06 limit, stated:** nothing proven for this slice touches PostgreSQL. The suite proves the **shape** of the
queries and the behaviour of the handler, not the behaviour of RLS.

### Merge conditions a human owns (none fixed here)

1. **The round-trip case is missing.** Every accepted id in the suite is a hand-declared constant, so nothing proves
   that the matrix the sibling GET *renders* is accepted verbatim by the PUT. The GET filters `schoolId` +
   `active: true`; the PUT probes `tenantId` + `schoolId`. A row whose two denormalised columns disagree is **rendered
   and then refused**, and `SubjectsManager.tsx` sends the whole dirty set in one PUT — so one bad axis id means the
   matrix becomes unsavable, all-or-nothing, for an admin who did nothing wrong.
2. **`PF-240` must be counted in production before merge.** The local database holds **zero** coefficient rows, so the
   local clean result proves nothing.
3. **The 404 for a school-less tenant surfaces an English developer string** (`No school for tenant`) verbatim in the
   French admin banner, while every other refusal on this handler is French UI copy.

### Next run

`S-E05-2b` (the `realmRole` invite channel) still ranks first in this epic — it is the only **live escalation path**
left, and `S-E05-3` was scheduled over that pointer by override, not instead of it. **`PF-240` ranks immediately
behind it**, and it should be sequenced exactly like `S-E05-2c`: a read-only detector with three exit codes first, a
repair only once a human has seen the count.

---

## S-E05-2c — evidence (landed 2026-08-12 as #229; this section written 2026-08-13)

### What the slice changed

`PF-175` existed only as a **prose SQL string in a ledger row that had never been executed**. The slice turned it into
a tested, repeatable detector: `apps/api/src/shared/auth/legacy-escalation-sweep.ts` (pure, fail-closed, imports
neither Prisma nor Nest — it *returns a value*, it does not refuse a request), a read-only CLI
(`legacy-escalation-sweep.cli.ts`, one `findMany`, no mutating verb), 49 tests, and one `package.json` script line.
`privilege-ceiling.ts`, `user-sync.service.ts` and the four grant call sites are **untouched**.

```bash
pnpm --filter @pilotage/api sweep:legacy-escalation
```

**Three exit codes, not two** — `0` clean · `1` findings · `2` inconclusive. The third exists so a wedged database or
a baseline that failed to derive can never be read as « propre », nor as an escalation.

### Why the finding is NARROWED and not closed

A detector that has never been run detects nothing. **The sweep has still not been executed against any database.**
The run that should have discharged that (2026-08-13) could not: the local Docker daemon was wedged — Docker Desktop
processes alive since 2026-08-08 while the daemon answered nothing and the Compose Postgres refused on its mapped
port — and the three V3 track worktrees were removed mid-run by the S3 revert (#227). This is the whole residual, and
it belongs to a verification sweep with a healthy stack, not to a new slice.

### Two corrections this section makes to the ledger

1. **The SQL recorded on `PF-175`'s row was invalid and could never have run.** It names `r."isSystem"` and
   `rp."roleId"`; the physical columns are `is_system` and `role_id` (`@map`, `schema.prisma:906/917`), so it dies on
   « column r.isSystem does not exist » — an *error* that a reader would have scored as a *finding*. It was also
   shaped wrong: the permission **code** lives on `Permission`, not on `role_permission`, so `count(rp.*)` yields
   nothing to compare against the baseline. The row now says so, so nobody restores it.
2. **The row's « no test: the condition is data, not code » is superseded.** The *condition* is data; the *detector*
   is code, and it is now tested.

### What a red report does and does not mean

`school_admin` is **not** a superset of `teacher`, so a legitimate teacher-shaped custom role carrying `grades.revise`
**will** be reported. That is correct fail-closed behaviour for a detector, and it is why the report's own text says a
finding is a candidate for human triage rather than proof of `PF-09` exploitation: `role` carries no grant provenance
(`grantedBy` is on `user_role`), so a legitimate grant is indistinguishable from an artefact. **Revocation is a human
decision** — the CLI has no revocation path and is not to be given one.

### Residual risk

- The sweep is **unrun** (above). Until it is, `PF-175` stays `open`.
- `S-E05-2b` — the fifth grant path, the `realmRole` invite channel — remains this epic's live escalation path and is
  still blocked on **`D-12`**, an unanswered product decision in `open-decisions.md`. Nothing in this slice touches it.

---

## S-E05-7 — evidence (2026-08-12)

### What the slice changed

**One decorator in the handler, two new pure files beside it.** `register.controller.ts` differs from `HEAD` by
**+7 lines and nothing else** — the `UseGuards` import, the guard import, a comment block and the decorator on
`registerParent`. §8.3 of the story required exactly that, and it holds: `writeAudit` stays one unconditional
statement with an inline object literal (`ADR-035` D1), `persistRegisteredParent` and
`compensateOrphanedKeycloakUser` stay separate methods, and the `emailVerified` docblock is byte-for-byte unchanged.

| File | Shape |
|---|---|
| `apps/api/src/shared/auth/public-endpoint-throttle.ts` (NEW, 335 L) | the decision core: `PublicEndpointFixedWindowThrottle.admit(key, now = clock())` over an **epoch-aligned** `Math.floor(now / windowMs)` window. No I/O, no Nest, no timers, no env read, injected clock, arity-bounded. Exports the four constants, the class, the `registrationThrottle` singleton, `registrationIdentityKey` and a `reset()` for tests |
| `apps/api/src/shared/auth/register-throttle.guard.ts` (NEW, 150 L) | the HTTP adapter: a `CanActivate` that reads the raw body **defensively** (it runs before the pipes, so the body is `unknown`), calls the limiter, **throws** `HttpException(…, 429)` rather than returning `false` (a falsy `canActivate` is a **403**, which is the wrong refusal and the wrong copy), and logs once per tier per window |
| three specs (916 L total) | `public-endpoint-throttle.spec.ts` (the pure core, injected clock), `register-throttle.guard.spec.ts` (the adapter), `register-throttle.supertest.spec.ts` (the real Nest pipeline, `createUser` call-count assertions) |
| `docs/adr/ADR-038-…md` (NEW, 66 L) | D1 in-process rather than DB-backed · D2 the **single-replica invariant** · D3 keyed on the submitted email, never on `req.ip` · D4 the accepted availability trade |

**Why not `req.ip`.** Measured, not assumed: `POST /auth/register-parent` has exactly **one caller repo-wide** and it
is a Next.js server action issuing a container-to-container `fetch` (`NEXT_PUBLIC_API_URL: http://api:4000`). `req.ip`
is therefore the **web container's egress address — one constant address shared by every registrant on earth**. A
per-IP limiter here is not a weak bound, it is a self-DoS. The story called this out and the implementation obeys it.

**Why no `@nestjs/throttler`.** `apps/api/package.json` and the lockfile are untouched: a dependency bump is precisely
how the **NestJS v10 pin** (GUARDRAILS §3) gets broken by accident. `@nestjs/testing` and `supertest` were already
declared, so the supertest spec adds no dependency either.

### What executed

| Check | Result |
|---|---|
| `pnpm typecheck` (Murat, **once**) | **13 successful / 13 total**, 12 cached, **1 executed** — and the cache miss was `@pilotage/api`, i.e. the package holding the entire diff was compiled fresh rather than replayed. Not a stale-cache green |
| `git diff --check` | **exit 0**, clean, with `git add -N` so the untracked new files were really inspected. Only the benign LF→CRLF advisory on the two new `.md` files |
| `npx tsc --noEmit` in `apps/api` (independent re-run) | **exit 0** (tsc 5.9.3) |

### The residuals — named, owned, not papered over

| id | What | Owner |
|---|---|---|
| **R-1** | **The global ceiling is itself a DoS lever, and it is cheap.** The guard runs **before** the `ValidationPipe`, so an anonymous `curl -d '{}'` loop spends tier-2 budget while reaching **zero** Keycloak calls: the availability cost is paid without the amplification benefit ever being at stake. `ADR-038` D4 accepts the trade in principle; it does not state this sharpened form. The real fix is an upstream edge limiter (`limit_req` in `infra/nginx/`), **out of seam** | orchestrator → new finding against `infra/**` |
| **R-2** | **Per-process state.** The ceiling multiplies by the replica count and resets on deploy. `ADR-038` D2 records the single-replica invariant but nothing **enforces** it; the diff itself demonstrates the idiom that would (`register-throttle.supertest.spec.ts` reads `identity.module.ts` and asserts `not.toContain('APP_GUARD')`) | `V3-E05` follow-up |
| **R-3** | **`PF-46` stays open** on its `emailVerified` third. Deliberately out of scope: flipping it needs Keycloak realm SMTP wiring in `infra/**` and it changes the login funnel (a parent could no longer log in immediately after submitting) — a product decision, not a hardening one | `V3-E05` / product |
| **R-4** | **The shipped constants are not the story's.** `60_000 / 5 / 30 / 2×TIER2` against §1.4's `10 min / 3 / 60 / =TIER2`. Every spec references the constants **symbolically**, so all ~30 cases stay green at any values and **no gate can see the divergence**. Each change is argued in a source docblock and defensible; the decision was still re-taken silently. The story is annotated (§0.5) rather than overwritten — **a human ratifies the numbers, or reverts them** | human reviewer, before merge |
| **R-5** | **The digest is unsalted.** `registrationIdentityKey` is `sha256(normalisedEmail)` and 48 bits of it reach `Logger.warn`. Literally true that no plaintext is stored or logged — but an email is a low-entropy, fully enumerable input, so an unsalted digest is **pseudonymised** personal data, not anonymised, and the docblock claims more than that. One-line fix (a module-level `randomBytes(32)` salt) with **zero test churn**, because every spec computes its expectation through `registrationIdentityKey` itself | `V3-E05` follow-up / this PR if the reviewer asks |
| **R-6** | **A 429 is unrecoverable at the glass.** `ParentRegisterForm.tsx` sets `status='error'` on any failure and never returns to `'idle'`, while `canSubmit` requires `'idle'` — so the throttle message renders above a permanently disabled submit button, and the only recovery is a reload that discards both password fields. Latent for 400/409 (the user must change their input anyway); **load-bearing for 429**, the first refusal in this funnel whose only prescribed remedy is to retry the identical payload. One line, in **track c's** seam | track c (`apps/web`) |

### Next run

1. **The R-4 ratification** is a merge condition, not a slice: revert to `3 / 60 / 10 min`, or keep `5 / 30 / 60 s`
   and let the story's §0.5 annotation stand as the record.
2. **`S-E05-2b`** — unchanged in priority and still the epic's only live escalation path (the `realmRole` invite
   channel, refusal attribution, the `PF-09` label). See § `S-E05-2` → "Next run".
3. **The R-1 companion in `infra/nginx/`** — a `limit_req` zone on `location /api/v1/auth/register-parent`. It is
   the only thing that makes the in-process bound survive contact with a determined caller, and it is the one
   residual that a human, not the routine, has to schedule (different seam, different track).

---

## S-E05-2 — evidence (2026-08-11)

### What the slice changed

**One new predicate, four grant paths, zero new endpoints.** `apps/api/src/shared/auth/privilege-ceiling.ts` (NEW,
180 L) holds a pure `exceedsGrantor(grantorSet, requested): string[]` and its throwing wrapper
`assertWithinCeiling`. No `@Injectable`, no Nest module, no Prisma import, no barrel, no env read, arity pinned at 2 —
the same seam shape as `shared/audit/provenance.ts` (`ADR-035` D4). The grantor's set is derived **at the controller**
from `UserSyncService.effectivePermissions(jwt.sub, jwt.realm_access?.roles ?? [])` — the identical seam
`PermissionsGuard:27-28` reads — and never re-unioned inside a service.

| Grant path | Where the ceiling runs |
|---|---|
| `roles.controller.create()` | after the `Permissions inconnues` 400, **before** `$transaction` |
| `roles.controller.update()` | after the `isSystem` refusal, **before** `$transaction`; the catalogue check is **hoisted out of the transaction** so one unknown code answers **400 from both handlers** instead of 400/403 |
| `users.service.assignRole()` | before the idempotent early-return **and** before `$transaction`; `grantorPermissions` is a **required** 6th parameter, so an omission is a compile error and never a silently empty (then "conveniently" defaulted) set |
| `invite.controller` `customRoleSlug` | resolved in `invite()` step 1b, **before** the Keycloak identity exists, so a refusal needs no compensation |

Every refusal precedes its transaction, so it writes no entity row and no audit row; `writeAudit` is untouched and
rule B of `scripts/audit-write-check.js` stays green. The 403 body is byte-shape-identical to the one
`permissions.guard.ts:31-35` already emits (`{ message, required, missing }`), and `message` stays a plain string
because `RoleBuilderForm.tsx:236` renders it directly as a React child.

Fail-closed was inspected, not assumed: `undefined`/empty grantor denies **everything**; an unknown code is denied
because the predicate never consults the catalogue; a non-array `requested` returns an opaque sentinel. The single
permit-on-empty (`requested === []`) is stated and pinned by test. There is **no `super_admin` role-name special
case** — `super_admin` is spared *structurally*, by `REALM_ROLE_PERMISSIONS.super_admin` already being the whole
catalogue. An `if (roles.includes('super_admin')) return []` would be a bypass wearing a role name.

### What executed

| Check | Result |
|---|---|
| `pnpm typecheck` (Murat, **once**) | **13 successful / 13 total**, exit 0. `@pilotage/api` was a **cache miss that executed** — the new files were really compiled |
| `git diff --check` and `git diff --check HEAD` | **exit 0**, clean, both |
| `tsc --noEmit` on `apps/api` directly (panel, bypassing turbo) | **green**. Run because `pnpm typecheck` first reported `FULL TURBO` replaying logs from sibling worktrees; `privilege-ceiling.ts` was untracked, so the input hash had never seen it. **Anyone re-running this gate must bypass the cache** |
| The five affected specs (panel) | **154 pass / 1 fail** — the failure is `audit-write-gate.spec.ts:995`, **inherited red on `main`** from the `ci-gate.sh` perf rewrite (`c141997`/`2bd1a25`), not this diff. Neither `ci-gate.sh` nor `ci.yml` is touched here |
| Mutation kill test (panel) | `exceedsGrantor` → `return []` killed **exactly 10 negatives, one per call site**, invite path included, positives green. This is what makes the coverage real rather than presence-shaped |
| Ratchet proven able to fail (panel) | a throwaway `__ratchet-probe.ts` with an unceilinged `userRole.create` turned the new **G-AUTHZ** gate red **and named the file**; probe deleted, tree verified clean |

**One gate row is NOT green and is not claimed as such.** `roles.controller.spec.ts` failed `apps/api#typecheck` on a
`noUncheckedIndexedAccess` widening at `:407` and was corrected (a literal-keyed `Record<'create'|'update', object>`
replacing an index-signature cast). The typecheck was re-run and is green. **No jest run has been observed on the
corrected file** — the earlier "4 suites / 79 tests" line predates that block, and `ts-jest` runs with diagnostics on,
so it could not have passed as written. `npx jest src/modules/identity/roles.controller.spec.ts` is a manual check in
the PR body, and it is the one piece of this slice's evidence that is asserted rather than executed.

### The load-bearing correction: the gate that could never have caught the next PF-09

`audit-write-gate.spec.ts` previously ratcheted `expect(roles).not.toContain('effectivePermissions')` — a deliberate
"this slice changed no authorisation" invariant from `S-E04-9`. The product has now reversed that posture, so the
ratchet was **amended, not deleted**, and the reversal is recorded in place in `ADR-035` rather than rewritten away.

The replacement's first draft still enumerated the three fixed files **by hand**, which is green by construction: it
protects the doors already closed and can never redden for the change that reintroduces the defect — a **fifth grant
path in a file the list does not name**. It now *discovers* its surface by walking the gate's own `WALK_ROOTS` for the
privilege-**creating** verbs (`userRole.create|upsert`, `rolePermission.create`, and the nested
`rolePermissions: { create` form) and requires each match to import the ceiling. Revoke (`updateMany`) is excluded
deliberately — a ceiling on *removing* privilege would trap an admin with a role they cannot revoke. It fails when the
walk finds fewer than 3 sites (DNC-08: never pass over an empty set), and the `UNCEILINGED` allowlist is empty, so an
exemption becomes a signed decision.

### `PF-09` is NARROWED, not closed — and that is the merge condition

Three independent reviewers reached the same finding, so it is recorded as the epic's status, not as a note:
`POST /users/invite` is gated only on `users.write` (weaker than `roles.assign`), `body.realmRole` accepts `teacher`
via `@IsEnum`, `REALM_ROLE_PERMISSIONS.teacher` carries `grades.revise` / `grades.write` / `attendance.write` /
`lessons.write` — none of which `school_admin` holds — and `body.email` is attacker-controlled. So the exact
escalation this slice closes on `customRoleSlug` survives verbatim on `realmRole`, one email of friction later.

That is left open **by decision**, and the decision is defensible: applying a subset ceiling there would refuse
"invite a teacher", the product's primary onboarding flow, and realm-role provisioning is a **delegation** question
(a grantor may provision at or below their own level), not a subset question. It is recorded in `ADR-015` D8.1 and in
the code at `invite.controller.ts:206-214`.

What is **not** defensible is the label. `ADR-035`'s superseding note and the `ADR-015` amendment front-matter both
book `PF-09` as *fermé*, unqualified. **The traceability matrix must record `PF-09` as narrowed (4 of 5 channels) with
the realm-role residual allocated a real finding id**, or a future auditor reading only `ADR-035` inherits a false
all-clear on a P0 `BROKEN_SECURITY` row. That correction is a land-pass task and is called out in the PR body.

### The product regression this slice ships, and the FE half it cannot fix

Measured against `seed.ts`'s `ROLE_PERMISSIONS` (the rows the ceiling actually reads), a `school_admin` can no longer
assign the seeded **`teacher`** (5 exceeding codes), **`parent`** (3) or **`student`** (5) roles. `school_admin` →
`school_admin` (0 exceeding) still works. This is structural, not a bug: the role-narrowed permission families
(`*.read.self`, `*.parent`, `*.teacher`) exist precisely so no admin holds them, so a subset test will always refuse
cross-audience grants.

The backend fails **closed**, which is right. The front end swallows it, which is not:
`apps/web/src/app/admin/users/actions.ts:7-10` has no `catch` and returns `void`, and
`apps/web/src/app/admin/users/UsersTable.tsx:30-39` is `try … finally` with no `catch` — so the new 403 lands as an
unhandled rejection: spinner stops, menu closes, no message, `router.refresh()` never runs. `UsersTable.tsx:115` also
still offers all four seeded roles from an unfiltered `GET /roles`, three of which now always fail. Contrast
`admin/roles/actions.ts:24-31,44-50`, which *does* catch `ApiError` and surface `body.message`, so the identical 403
on role create/update is shown correctly.

`apps/web` is outside this track's owned paths, so this is raised as a **blocking FE-track finding**, not absorbed:
align `assignRoleAction` with `admin/roles/actions.ts`, render `missing`, and filter the dropdown against the
caller's effective set. Recorded in `ADR-015` D8.7.

### Gates — every row answered, none blank

| Gate | Triggers? | Why |
|---|---|---|
| **G-AUTHZ** | **YES — primary** | Four grant paths, one predicate; the mutation kill (10/10 negatives, one per site) is what proves the negatives measure *this* guard and not an older `isSystem`/cross-tenant one; the new directory-walking ratchet was driven red by a probe |
| **G-DNC** | **YES (always)** | DNC-10 intact — no env read, no options bag, no bypass flag, `assertWithinCeiling.length === 2` asserted. DNC-08 — the ratchet refuses to pass over an empty walk (floor of 3 sites) |
| **G-AUDIT** | **YES** | Every refusal precedes its `$transaction`, so no partial write and no orphan audit row; `writeAudit` untouched, `audit-write-check.js` rule B green. **Residual**: a refusal writes no audit row and only an actor-less `logger.warn` (D8.3) |
| **G-TENANT** | **YES — verified, not assumed** | Net-restrictive everywhere; no new cross-tenant read. `PF-153` (the role lookup unfiltered by tenant) is untouched and explicitly still open, marked in-place at `users.service.ts` |
| **G-MIGRATION** | **NO** | `schema.prisma` untouched, no migration, no new dependency |
| **G-TRUTH** | **NO** | No KPI, read projection or dashboard figure |
| **G-PORTAL** | **NO** | Backend-only; the FE consequence is raised as a finding, not implemented here |

### Not claimed by `S-E05-2` — queued with an owner, not silenced

| What is NOT claimed | Detail | Owner |
|---|---|---|
| **`PF-09` is closed** | The `realmRole` invite channel is unceilinged and reproduces the escalation. `ADR-015` D8.1 states it honestly; `ADR-035`'s note and the amendment front-matter do not. Matrix must say **narrowed** | `S-E05-2b` |
| **Grants that escalated BEFORE this slice are evicted** | The ceiling compares against `effectivePermissions`, which unions custom-role permissions — so an actor already holding a `PF-09`-minted role passes it *unconditionally* and can keep minting. Detection query, not a migration: non-system roles carrying any code outside `REALM_ROLE_PERMISSIONS.school_admin`. **Run it before calling `PF-09` anything at the deployment level** | `S-E05-2b` (D8.2) |
| **A refused escalation is attributable** | No audit row (correct — nothing happened, and a `writeAudit` outside a transaction breaks `ADR-035` D1), and the compensating `logger.warn` lives *inside* the predicate, so it carries no `jwt.sub`, no tenant, no IP — even though `deriveAuditProvenance` has already produced them at all four call sites. The fix needs **no** signature change: catch at the call site, log there, rethrow. Worse under D5 — ordinary refused `teacher` assignments will dominate the same warn stream, so it is not alertable as written | `S-E05-2b` (D8.3) |
| **The ceiling constrains narrowing, revoking or deleting** | It is one-directional by design: any subset passes, so a `roles.write` holder can strip or wipe a role that carries codes above their own ceiling — and then cannot restore it (403). `revokeRole` and `remove()` gained no ceiling. Accepted as *désescalade* in D3; the **irreversibility** is not recorded there and should be | `V3-E05` follow-up |
| **`update()` checks the ceiling on a rename** | When `body.permissionCodes` is absent no check runs — correct (a rename grants nothing) and currently unreachable from the shipped UI (`RoleBuilderForm.tsx:132-135` always sends the field). Dormant and documented | scope note |
| **The invite hoist preserves every prior behaviour** | D7 says the unresolvable-slug no-op is "préservé verbatim". True for a slug that never resolved; **not** for one that resolves and is then deleted before the transaction — that used to be a silent no-op and is now an FK violation → rollback → Keycloak compensation → 500. Window is tiny (`remove()` refuses to delete an assigned role) and the direction is fail-closed, but D7's list is missing it | `V3-E05` follow-up |
| **A duplicated permission code reaches the ceiling** | Both handlers compare `resolved.length !== body.permissionCodes.length`, so `['x','x']` answers **400 `Permissions inconnues` with `missing: []`** — naming no code at all. Pre-existing in `create()`, copied verbatim into the new `update()` block. Consequence: `exceedsGrantor`'s de-duplication is unreachable from any HTTP call site and is only unit-asserted | `V3-E05` follow-up |
| **The story spec matches the code** | `S-E05-2.md` §2.3/§5 T-18/§9 still say "do not move" the `update()` catalogue check and pin an unknown code to **403**; the code hoists it and answers **400**. The divergence is right and better argued than the spec — but the two artefacts disagree, which is the `PF-164` shape this slice's own gate amendment exists to prevent. Reconcile the story, do not re-litigate the code | land pass / `S-E05-2b` |
| **`PF-153`** | Role lookup unfiltered by tenant — untouched, still open, marked in place | `V3-E05` |
| **A browser rendered anything** | No Playwright, no driven navigation, and `apps/web` is not edited. The D5 regression is proven by permission arithmetic and by reading the FE call sites, not by clicking | `VAL-08` |

---

## Next run

**`S-E05-2b` — close the fifth grant channel and make the refusal attributable.** It is the direct residual of this
slice and the only item on the list that is a live escalation path rather than a documentation or ergonomics debt.
Three things, one PR:

1. **The `realmRole` invite channel.** Not a subset ceiling (that refuses "invite a teacher") but a **grantor-relative
   ladder**: a grantor may provision a realm role at or below their own. Permits `school_admin → teacher|parent`,
   refuses `teacher → school_admin`. That is the §2.4 option-2 delegation decision and it needs its own `ADR-015`
   decision entry, so it is a slice and not a patch.
2. **Attribution.** Move the `logger.warn` from inside the predicate to the four call sites, where `jwt.sub`,
   `me.tenantId` and the provenance hints are already in hand. Predicate stays at arity 2.
3. **The label.** Record `PF-09` as narrowed in the matrix, allocate the realm-role residual a finding id, and correct
   the unqualified "closed" in `ADR-035`.

**Second candidate — the FE companion to D5**, on the `apps/web` track: catch `ApiError` in `assignRoleAction`, render
`missing`, filter the role dropdown against the caller's effective set. It ships no new capability, but until it lands
an admin's "assign teacher" click does nothing at all with no explanation.

**Third — the `S-E05-12` gate-coverage consolidation** (six residuals, entirely test-side) is unchanged in priority.

---

## S-E05-12 — evidence (2026-08-07)

### What the slice changed

Three files of production consequence, one of which is a spec:

- **`apps/web/src/lib/safe-callback-url.ts` (NEW, 100 L, 5 executable).** One pure, **import-free**, edge-safe
  `safeCallbackUrl(raw, fallback)`. Five-clause **allow-list**, no normalisation of any kind: the bytes validated are
  the bytes navigated, so no future normalisation step can open a gap between the check and the use. Same rationale and
  same shape as its neighbour `lib/portals.ts` (`S-E06-5`) — no new architectural decision, **no ADR owed**.
- **`apps/web/src/components/PortalLoginForm.tsx` (+11 / −13).** The read site (`:74`) is now
  `safeCallbackUrl(params.get('callbackUrl'), PORTAL_LANDING[accent])`. Validated **once, at the read**, so **both**
  sinks inherit one safe binding — `router.push` on the credentials branch and `signIn(…, { callbackUrl })` on the SSO
  one. A per-sink guard is a rule a third sink can forget. The local `DEFAULT_LANDING` map is **deleted**, retiring the
  fifth surviving copy of the four portal landing paths onto the single `PORTAL_LANDING`.
- **`apps/api/src/shared/quality/open-redirect-gate.spec.ts` (NEW, 971 L).** The executable guard. It lives beside 16
  sibling gates, three of which already assert on `apps/web` (`web-artifact-gate`, `web-observability-gate`,
  `portal-landing-gate`), because `apps/web` has no jest project and `ci-gate.sh` only runs `test-ratchet.js api|worker`.

**All four portals, one component.** `admin|teacher|parent|student/login/page.tsx` all render `PortalLoginForm`, so the
fix is four portals wide with no portal-conditional branch (**G-PORTAL**).

### What executed

| Check | Result |
|---|---|
| `pnpm typecheck` (Murat, **once**, main checkout) | **exit 0**, *"Tasks: 13 successful, 13 total"*, 3m36s. `@pilotage/web` **and** `@pilotage/api` both `cache miss, executing` — the three changed/new files were really compiled by `tsc`, not replayed from the Turbo cache |
| `git diff --check` | **exit 0**, clean. Re-run with `git add -N` on the two untracked source files so their whitespace was actually inspected, then `git reset` to leave the tree as found. Only output is the benign *"CRLF will be replaced by LF"* advisory |
| `npx jest src/shared/quality/open-redirect-gate.spec.ts portal-landing-gate.spec.ts` | **214/214 PASS**, 44.9 s — the new gate **and** the neighbour it moves from 6 to 7 `PORTAL_LANDING` consumers |
| The 37-row accept/reject matrix | **29 reject + 8 accept**, each driven through both the expectation **and** a differential origin oracle (`new URL(result, 'https://pilotage.example/parent/login').origin`). **0 failures, 0 leaks** |
| Whole-tree structural scan | **366 files** (floor 300) · **55** `router.push\|replace` call sites (floor 40) · **32** files reading `useSearchParams` · bare-identifier sink inventory = **exactly 3** · **offenders `[]`** |
| Parser-differential probe (Sentinel, independent) | 29 hostile inputs — `/<TAB>//evil`, `/<CR><LF>/evil`, `/<NUL>/x`, `/%5cevil`, `/%2f%2fevil`, `/..//evil`, `/@evil`, U+3000 / U+FEFF / U+200B variants, `/./\evil` — resolved against Node's WHATWG `URL`. **0 leaks** |
| Fails-before / passes-after, two ways | (i) a fixture reproducing the pre-slice `PortalLoginForm` lines **is reported as an offender** by the same scan that walks the tree, and the current file is not; (ii) the **briefed** rule fails on **exactly** R25/R26/R27 |
| Clause necessity | `noC0` → `[R25,R26,R27]` · `noSecond` → `[R5,R6,R7,R8]` · `noFirst` → `[R1..R4, R11..R14]`. Every clause has at least one input only it rejects — no dead clause |

### The load-bearing result: the fix the ledger recommended is itself exploitable

`audit-findings-index.md` proposed `raw.startsWith('/') && raw[1] !== '/' && raw[1] !== '\\'`. Measured against the
WHATWG parser with base `https://pilotage.example/parent/login`, **four inputs pass that rule and still navigate
off-origin**: `/<TAB>/evil.example`, `/<LF>/evil.example`, `/<CR>/evil.example` (all → `https://evil.example/`) and
`/<CR><LF>/evil` (→ `https://evil/`). Cause: the parser removes tab/LF/CR from **anywhere** in the string *before*
parsing, so `/<TAB>/evil.example` becomes `//evil.example` **after** the check has already passed it. The shipped rule
adds a fifth clause — **C0 rejected anywhere, not at position 1** — stated as "anywhere" on purpose, because a rule whose
safety depends on *where* the byte sits breaks the next time normalisation order changes. Both the briefed rule and its
three holes are pinned by test, so a future "simplification" of that clause says exactly what it lost.

The consequence for the ledger is why this land pass touches four tracking files rather than two: the recommendation
`audit-findings-index.md` carried was the **exploitable** expression, and the next autonomous run reads that file at
Step 1. It is corrected in the same commit.

### §7.3 — the one adjacent site, measured then recorded, **not** fixed

`NotificationListItem.tsx:56,59` pushes `link`, which is the same **sink** class as `PF-102` but a different **source**
(a `Notification` row field, not `searchParams`). Traced through the API before the PR was opened: **every** writer
composes a server-side literal or a literal template carrying a server-derived id — `alerts.service.ts:518,802`,
`announcements.controller.ts:612`, `child-claims.service.ts:679,695`, `enrollments.controller.ts:102`,
`assessments.controller.ts:345`, `lessons.controller.ts:129`, `messaging.service.ts:589` (→ `portalLink`, literal at
`:408,539`), `remediation.controller.ts:340,476,663,979,1074,1085`, `alerts-evaluator.service.ts:232`,
`remediation-sweep-cron.service.ts:163`, `notifications-digest-cron.service.ts:244,290`,
`parent-digest-cron.service.ts:221` — and **no** DTO, Zod schema or contract type accepts a `link` field on any request.
Latent, not live. **No finding was opened for it**: a finding without a defect is noise. *(This sentence used to name `PF-104`, the id then pre-allocated for this hypothetical. It was never taken for it — `PF-104` is run 24's stalled-job finding, and the readiness/lint one below is now `PF-112`. Annotated on 2026-08-08 by `S-E02-18` rather than rewritten, because a shipped ledger records what was believed at the time.)*. The measurement is pinned as a test
so it becomes false the day a request-supplied `link` appears.

### Gates — every row answered, none blank

| Gate | Triggers? | Why |
|---|---|---|
| **G-AUTHZ** | **YES — primary** | The executed 37-row matrix with the origin oracle; fails-before/passes-after two ways; the structural scan proven in **both** directions |
| **G-PORTAL** | **YES** | One shared component, four login routes proven to render it, no portal-conditional branch |
| **G-DNC** | **YES (always)** | DNC-10 tested structurally **and** by execution with six bypass env vars set singly and together; `safeCallbackUrl.length === 2` asserted on the executed function, so an options argument cannot hide from arity |
| **G-TENANT** | **NO** | Verified, not assumed: zero Prisma queries, zero `where`, zero `tenantId`, zero `StudentAccessService` path. The diff cannot leak a child's record because it never reads one |
| **G-MIGRATION** | **NO** | `schema.prisma` untouched; no migration added |
| **G-AUDIT** | **NO** | No privileged mutation, no `AuditLog` write, no endpoint |
| **G-TRUTH** | **NO** | No KPI, count, read projection or dashboard figure |

---

## Not claimed by `S-E05-12` — queued with an owner, not silenced

| What is NOT claimed | Detail | Owner |
|---|---|---|
| **`/api/auth/signin/*?callbackUrl=` is a SECOND, public entrance into this flow that this diff does not cover** | `middleware.ts:34` lists `/api/auth` in `PUBLIC_PREFIXES`; `auth.ts` declares **no `pages:` override and no `redirect` callback**, so next-auth's own signin page is live and its only same-origin clamp compares against a `baseUrl` derived from headers — with `auth.ts:291` `trustHost: true` and `infra/nginx/conf.d/pilotage.conf:43,52,67` (`listen 80 default_server; server_name _;` + `proxy_set_header Host $host`) that reference origin is **client-supplied on that path**. Not the same one-click chain `PF-102` was (a victim's browser will not forge its own `Host`) — it is the cache-poisoning / absolute-link class. The spec **records** the `trustHost` dependency and deliberately declines to assert it, because a gate that reddens on an improvement is a gate people delete. **Verify before calling the finding closed at the deployment level** (see the manual checks in the PR body); if it emits an off-origin `Location`, the fix is `pages: { signIn: '/<portal>/login' }` or pinning `server_name` at nginx, **not** another string rule | new finding, `V3-E05` |
| **The AC-5(c) regression scan is blind to PF-102 *minus the variable*** | `SINK` anchors on a **bare identifier** as the whole first argument, so `router.push(params.get('callbackUrl') ?? '/parent/dashboard')` — the same defect, inline — passes the gate. Driven against the shipped predicate: control CAUGHT, inline-read MISSED, one-hop alias MISSED, destructured read MISSED, server-component `searchParams.next` → `redirect()` MISSED; and the inline shape resolves to origin `https://evil.example`. The header **claims** the scan "closes the shape PF-102 actually is", and the inline read *is* that shape. A gate naming an invariant it does not hold is worse than no gate | next `V3-E05` slice |
| **The same `SINK` regex misses the two-argument and semicolon-free spellings** | Measured against the shipped regex: `router.push(callbackUrl, { scroll: false })` MISS, `router.replace(callbackUrl, { scroll: false })` MISS, the prettier-wrapped multi-line + trailing-comma form MISS, `location.assign(x)` without `window.` MISS, `window.location = x` MISS, `permanentRedirect(x)` MISS, `href = x` without `;` MISS. `push(href, options)` is a documented App Router API, so it is the shape a future contributor is most likely to write. **No such site exists in the tree today** (12 push/replace sites, none with a second argument), so this is a future-bypass hole, not a present miss — and the header's stated limits ("lexical", "single-file", "no cross-file dataflow") do **not** disclose it | next `V3-E05` slice |
| **`signIn(provider, { callbackUrl: <tainted> })` is not in the sink vocabulary** | The story itself names it as one of the two consumption points (FR-3), and the AC-3 assertion on it is the one **grep** left in an otherwise-executed suite (`expect(source).toContain('{ callbackUrl }')`) — a shorthand rename or a reformat passes the string check while the sink stops sharing the binding | next `V3-E05` slice |
| **A repeated `?callbackUrl=` is NOT a clause-1 fallback, and the module says it is** | `safe-callback-url.ts:76` states clause 1 rejects *"a repeated query parameter"*. Measured: `new URLSearchParams('callbackUrl=/parent/dashboard&callbackUrl=https://evil.example').get('callbackUrl')` returns the **string** `'/parent/dashboard'`, not `null` — `.get()` yields the first occurrence, so a repeated parameter never reaches clause 1. **Not a vulnerability** (the attacker-first ordering is rejected by clauses 2–5, both orderings land same-origin), but a false sentence inside a security module's own header is what a future editor trusts instead of re-measuring, and the 37-row matrix has no row for it | next `V3-E05` slice |
| **The exact-set sink inventory is a ratchet with no baseline file** | `open-redirect-gate.spec.ts:715-731` pins the inventory to three hard-coded rows across 366 files, and `:947-958` pins "exactly ONE file matches `useSearchParams` ∧ `router.push` ∧ `signIn(`" while `ParentRegisterForm.tsx` already matches two of the three. Every other ratchet in this repo externalises its ceiling with a reason **and** an owning finding per row (`link-integrity-baseline.json`, `web-route-baseline.json`); this one does not. A legitimate future `router.push(href)` reddens a P1 security gate with no documented escape but editing the spec | next `V3-E05` slice |
| **`packages/ui/src` is bundled into every portal and is NOT scanned** | The walk root is `apps/web/src`. `packages/ui` is consumed as **raw TS source** (project-context §1), so it compiles into all four portal bundles. Measured: 70 files, exactly one redirect sink (`Pagination.tsx:83`, pathname-rooted and safe today), 0 bare-identifier sinks, 0 offenders — extending the walk would keep the gate green, but it would also change the ≥300-file floor and the exact-set inventory, so it is deliberately not done here. The DNC-08 limits paragraph does not currently name the package boundary | next `V3-E05` slice |
| **`PF-103(d)` is retired as an instance, not as a class** | The finding asked to widen P-2 to *"no file outside `lib/portals.ts` contains two or more of the four literal landing paths"*. This diff deletes `DEFAULT_LANDING` and adds a `not.toContain` scoped to `PortalLoginForm.tsx` only. A sixth copy under a different identifier in a different file still passes both gates — the guard still measures the **name**, not the invariant | next `V3-E06` follow-up |
| **`PF-103` (a)(b)(c) are untouched** | The `'}'` JSX-comment mis-read, the tautological anti-drop invariant and the unbounded cross-product in `scripts/link-integrity-check.js`'s lexer remain open, in a **blocking** CI stage — and this security gate now `require`s that lexer's `stripCommentsPreservingLines`, so a stripper regression moves a security inventory. The unguarded `require` is the right call for DNC-08; the coupling is the note | next `V3-E06` follow-up |
| **No browser rendered any login page** | `apps/web` has no jest project and no Playwright test was written or run, so *"the redirect lands same-origin in a real browser"* is proven by a WHATWG-`URL` oracle in Node, not by a driven navigation. That crawl is `VAL-08` / R10 | `VAL-08` |
| ~~**`bash scripts/ci-gate.sh` was not run**~~ — **DISCHARGED by the routine (run 24)** | The sprint was right to leave this open and right not to claim it. Executed twice. **Pass 1: `GATE: FAIL (7 stage(s))`** — and all seven reduce to **one** root cause plus two load artefacts. `no-control-regex` is an ESLint **error** in this repository and `next build` runs ESLint, so the three control-character regexes this slice introduced (`safe-callback-url.ts:67`, `open-redirect-gate.spec.ts:554,556`) did not warn — they failed `lint`, `lint:warnings` and **`@pilotage/web#build`**, and with no `.next` emitted, `web artefact` and `link integrity` fell over behind it. One rule violation, four red stages. A fourth, separate problem: the new imports tripped `import/order`, putting `apps/web` at **35 against a ceiling of 34**. `boot` and `tracing` also failed, both on **timeouts** (`180s`, `ETIMEDOUT`) behind a 19-minute build; re-run standalone on the byte-identical tree they returned `BOOT CHECK: PASS` (229 routes, unchanged) and `TRACING CHECK: PASS` — so they were machine load, not this diff. That was **measured, not assumed**, because "it was probably flaky" is how a real defect gets waved through. **Pass 2: `GATE: PASS`, exit 0, every stage.** The fixes are at the right layer and none is a gate weakening: the C0 test became a code-unit scan in **both** files (an `eslint-disable-next-line` was the other option and was rejected — the rationale is in `safe-callback-url.ts`; the 37-row matrix still returning **214/214** afterwards is what proves the two forms equivalent, so the rewrite is falsifiable rather than merely plausible), and the import was **reordered**, not re-baselined — `lint-ratchet: 44 warning(s) total · 44 allowed · no drift`, ceiling untouched (the `S-E06-6` precedent) | ✅ done |
| **The sprint returned `landed: true` on a tree whose `lint` was red** | Recorded as **`PF-112`** rather than shrugged at *(filed as `PF-104`; renumbered 2026-08-08 by `S-E02-18` — that id was already run 24's stalled-job finding)*. Readiness runs `typecheck` (13/13) and the two targeted suites, and **neither can see a lint error** — so an agent cannot know it has broken the web build, and `typecheck` green reads as "safe to land" when it is not. Same family as **`PF-80`** (`landed: true` on a tree the full gate failed), different missing stage: that one wants `test-ratchet.js` in readiness, this one wants `lint-ratchet.js`. Both are additions to `bmad/workflows/sprint.workflow.js`, which is the routine's own file — so it belongs in a routine slice, not this one | `PF-112` *(was `PF-104`)* |
| **`PF-102` is closed in code, not on the deployment** | Nothing here rebuilds or redeploys anything. Per `SKILL.md` Step −1 the hosted VPS is an audit fixture rather than a deployment target, so this is a statement about scope, not an outstanding operator errand: the **local** stack is the target, and it was left up and healthy | scope note |

---

## ~~Next run~~ — as written by the `S-E05-12` land pass (2026-08-07), **SUPERSEDED**

> **Superseded 2026-08-11 by the `S-E05-2` land pass.** The live pointer is the "Next run" section above. Both of this
> section's candidates are spent: `V3-E04`'s `epic-spec` run landed (run 28) and the epic is `in-progress` with 10 of
> 11 slices shipped, and its opening premise — *"nothing in this epic is enumerated"* — was falsified by `S-E05-2`,
> which authored and shipped its own story in one run. Kept struck rather than deleted, because a reader who stops at
> the prose would re-write a shipped spec-kit. Original text follows.

> **⚠️ Rewritten 2026-08-10 by the `S-E05-1` land pass — the section below is the `S-E05-12`-era text, kept struck
> through rather than deleted.** It opened *« Not a `V3-E05` slice — nothing in this epic is enumerated »* and then
> listed a `V3-E04` `epic-spec` run as candidate 1. Both are now **stale**: the `V3-E04` kit was written at run 28 and
> ten of its eleven slices have shipped, and `V3-E05` **has** had a slice enumerated and landed since — this one, by a
> 2026-08-10 operator override. Named rather than quietly overwritten, because this is exactly the paragraph the next
> autonomous run reads at Step 1.

**The current recommendation, in order.**

1. **`S-E04-8`** — the hash chain from a declared genesis. It is the register-of-record pick
   (`docs/daily-improvement-v3/NEXT.md`, `bmad/roadmap.md`) and shipping it moves `V3-E04` to `shipped`. Unchanged by
   this run: run 39 was an **operator override**, not a re-sequencing.
2. **A `V3-E05` follow-up that makes the CSV escaper unbypassable — `PF-173`.** Brand `csvEscape`/`csvFixed1` to
   return a `CsvCell` and let `csvRow`/`buildCsv` accept only `CsvCell[]`, wrapping the one live unescaped site
   (`teacher/reports/_components/ExportReportButton.tsx:68`) on the way through. Seven call sites, no runtime change,
   and it converts the count-based ratchet this slice shipped into the type-based one `ADR-035` already established
   for the audit seam. Bundle with it the `node:vm` spec that **executes** `apps/web/src/lib/csv.ts` — today nothing
   does, and the mirror in the worker spec drifted from the real file inside a single commit.
3. **`PF-169`** — the dialect reconciliation. This epic's most-owed item, but it is a **versioned, announced format
   change** with the consumer census `ADR-037` D6 defines, so it ranks behind the two above rather than being taken as
   a drive-by.

The `S-E05-12` gate-coverage consolidation (`SINK` vocabulary, inline query read, `packages/ui` walk root) is
unchanged in priority and now ranks fourth.

<details>
<summary><em>Struck-through `S-E05-12`-era text, 2026-08-07 — retained for provenance</em></summary>

~~**Not a `V3-E05` slice — nothing in this epic is enumerated.**~~ Two candidates, in order:

1. **`V3-E04` — a `sprint-02` authoring / `epic-spec` run** (audit trail and governance surfaces: `PF-14`, `PF-31`,
   `PF-32`). This is what the V3 roadmap's own sequencing rule prefers (`V3-E04` depends on `V3-E02`, which is
   `code-complete`, and it *unlocks evidence for everything after it*), and `S-E06-6` made the case concrete: it wrote
   the first `AuditLog.ipAddress` in the codebase and derived `actorRole` from the JWT on **one** handler while ~20
   others still hard-code `'school_admin'`. Its first slice is that shared provenance interceptor, and it must **open
   with the `trust proxy` decision** — behind Traefik→nginx, `req.ip` is the proxy, and blanket XFF trust makes the
   field client-forgeable, which is strictly worse than blank. There is no `docs/spec/features/v3-e04/` yet, so that run
   is **`epic-spec`**, not `epic-slice`.
2. **A `V3-E05` follow-up slice** consolidating the six "not claimed" gate rows above into one change: widen the `SINK`
   vocabulary (two-argument push, `signIn(…, { callbackUrl })`, `location.*` without the `window.` prefix,
   semicolon-free `href =`), catch the **inline** query read at the sink, move the exact-set inventory into a reviewed
   JSON with a reason and an owning finding per row (the `link-integrity-baseline.json` precedent), and correct the
   repeated-parameter sentence in `safe-callback-url.ts:76`. Cheap, entirely test-side, no production change — but it
   hardens a gate rather than shipping a capability, so it ranks second.

The third option, a **`V3-E06` follow-up** (resolve a baseline row's finding id against `audit-findings-index.md`
instead of a regex; clear `PF-103` a/b/c), is unchanged in priority by this slice.

</details>

---

## `S-E05-14` — the enrollments roster gains the ABAC and the projection the attendance roster already had

**Landed 2026-08-23 (run 73).** Closes `PF-278` (P1) and `PF-280` (P1, raised and closed in the same commit).
Advances `PF-51` — **partial, ONE site**, never claimed closed. Decision record: `ADR-063`.

### What changed

`GET /api/v1/enrollments/roster/:classSectionId` (`apps/api/src/modules/enrollments/enrollments.controller.ts`)
carried a tenant comparison and nothing else, while `enrollments.read` is held by `school_admin`, `teacher` **and
`parent`**. Any authenticated parent of the establishment could enumerate any class section by id and read
`medicalNotes`, `address`, `phone`, `email` and `birthDate` for every child in it, plus the class's admin-only
`internalNotes`. The handler is now four steps: `ParseUUIDPipe` → `select`-only guard read (404) → ownership
verdict (403) → projected payload. Privileged callers (`super_admin`/`school_admin`) pass; a teacher passes iff a
`TeachingAssignment` row exists on that `classSectionId`; **everyone else, `parent` included, gets 403**.

### The three things worth carrying forward

1. **`ADR-061 §D1`’s academic-year coupling was deliberately NOT copied, and that is the one decision a reviewer
   will read as an oversight.** `ADR-061`’s wall is *student*-keyed, where the year is free on both sides; this one
   is *section*-keyed, and `ClassSection` is itself year-pinned (`academicYearId` non-null,
   `@@unique([academicYearId, gradeLevelId, name])`), so the path parameter already supplies the year. Copying the
   clause would have 403’d teachers who genuinely teach the class — `TeachingAssignment.academicYearId` has no
   composite FK to `ClassSection.academicYearId`, so the two can diverge in data — and with **zero consumers**
   nobody would ever have reported it. `ADR-063 §D1`, pinned by a fixture whose assignment carries a lapsed year.
2. **The fail-open this slice could have shipped is a Prisma semantics trap, not a logic slip.** Prisma **drops
   `undefined` keys from a `where`**, so `teacherProfileId: tp?.id` with a null profile would have matched *the
   section's first assignment belonging to anyone* and **granted** the caller. Two mechanisms guard it: the pure
   comparator checks the null first and independently, and the exported `teacherOfSectionWhere` builder types
   `teacherProfileId` as non-optional so the dangerous call is unrepresentable. `ADR-063 §D2`; the spec asserts the
   assignment query was never *issued*, which is the only assertion that can tell the two apart.
3. **`PF-278` is closed on a HANDLER, not on a CLASS — and the PR says so.** `GET /enrollments?classSectionId=<id>`
   (`:122`, same controller, same permission, same parent grant) has no ABAC either. Its student projection is
   already `ADR-062`-shaped so the medical-data leak is not there, but peer identity enumeration survives.
   Recorded as `PF-283`; it is consumed (`apps/web/src/app/admin/students/actions.ts:55`) so it needs its own
   census and its own slice. Claiming the class closed would have been a `DNC-06` violation at story level.

### What was NOT executed

No agent in this run ran jest, `pnpm typecheck` or any build (CPU budget: only the test-architect runs the chain).
What actually ran is the schema read, the permission-catalogue read, and the **consumer census**:
`grep -rn "enrollments/roster" apps/ packages/` → exit 1, **zero first-party callers** across admin, teacher,
parent and student. The census is the G-PORTAL evidence; four asserted ticks would not have been. The `role`-table
count in the `PF-268` docblock is **cited** from `attendance.controller.ts:133`, not re-measured — copying it as a
fresh observation would have fabricated evidence.

### Next run

**`PF-283` outranks everything else this epic carries**, for the same reason `PF-278` did last run and with one
difference: it is the residue this slice knowingly left, and it is named in `ADR-063 §D6` rather than discovered.
Then `PF-267` (`justify` still has no ownership check on a WRITE), then `PF-277` (the residual `student: true`
sites), then `PF-279` (the file-level source ratchet in `attendance`). `S-E05-2b` remains the epic’s standing
pointer, scheduled over a sixth time and not refuted. New this run: `PF-281` (P2, `findForUser` ignores
`TeacherProfile.active` — cross-cutting, it silently tightens four already-landed handlers) and `PF-282` (P3,
`ADR-060` is missing from `docs/adr/`).

**Id-collision note.** Three agents allocated `PF-280` to three different subjects in the same planning pass. It
was arbitrated **by meaning**, not by date (the `PF-185`/`PF-186` rule from runs 53/54), and the arbitration table
is recorded in `ADR-063` § "Id arbitration": `PF-280` = the roster `ClassSection` payload (closed here, because
the story spec is the operator override and names it), `PF-281` = `findForUser`/`active`, `PF-282` = the missing
`ADR-060`, `PF-283` = the list-path peer enumeration.

### `PF-282` — corrected at the land pass of `S-E05-14` (2026-08-23)

`PF-282` was raised as *« `ADR-060` is absent from `docs/adr/` »* and it was **true when measured**: `ADR-060` was
authored by `S-E01-1l`, which was sitting in **held** PR `#263`, so a run reading `main` genuinely saw a gap in the
citation namespace. `#263` merged mid-run (`825a009`) and the rebase brought the file in. The row is moved to
`CLOSED-L0.md` as `closed-by-other-work` rather than deleted.

**The mechanism is worth keeping**, because it is the documentation-side twin of `PF-231`/`PF-232`: a held PR does not
update `main`, so the next run measures a hole that is already fixed in flight and spends a finding id on it. The
cheap defence is the one this run used by accident — **re-measure every raised finding after the rebase**, not only
the one being closed.

---

## S-E05-13 — evidence (this PR, 2026-08-23)

### What was actually wrong

`PATCH /api/v1/cycles/grade-levels/:levelId` accepted an **entirely unvalidated** request body and handed it
straight to `prisma.gradeLevel.update({ where: { id }, data: body })`.

The mechanism was **read off the shipped build artefact**, not inferred.
`apps/api/dist/modules/school-structure/cycles.controller.js` carried, verbatim:

```js
// createGradeLevel — the CONTROL: a real class survives erasure
__metadata("design:paramtypes", [String, GradeLevelDto, Object]),
// updateGradeLevel — the defect
__metadata("design:paramtypes", [String, Object,        Object]),
```

Four measured links: `packages/tsconfig/node.json` sets `emitDecoratorMetadata: true` → `Partial<T>` is a mapped
**type** with no runtime value, so the compiler emits `Object` → `Object` is in `ValidationPipe.toValidate()`’s own
skip list, so the pipe returns the body **raw** → the global
`new ValidationPipe({ transform, whitelist, forbidNonWhitelisted })` at `apps/api/src/main.ts:141-145` was
**SKIPPED, not lenient**. That distinction is the whole finding: a reader auditing `main.ts` would have concluded the
route was protected.

`model GradeLevel` (`schema.prisma:385-406`, read, never edited) declares `tenantId`, `schoolId` and `cycleId` as
writable `@db.Uuid` scalars, `GradeLevelUncheckedUpdateInput` accepts raw scalar FKs, and `grade_level` carries **no
RLS policy** (checked across `apps/api/prisma/migrations/**/*.sql`). So `PATCH {"tenantId":"<foreign-uuid>"}` from a
`school_admin` **pushed the row out of their own tenant**. `ADR-002` forbids that unconditionally. The `findUnique`
guard three lines above reads the row’s **current** tenant and is structurally blind to the incoming body — it never
stood between a caller and the write.

The blast radius is wider than `tenantId`, and each escape differs in kind:

- **`tenantId`** — no relation, no FK, no RLS. An arbitrary uuid orphans the row into a tenant that need not exist.
- **`schoolId`** — an FK to `School`, so a school owned by tenant B is **FK-valid**. The row keeps tenant A’s
  `tenantId` yet re-lists inside tenant B, because `list()` filters `where: { schoolId }` with no `tenantId`. **A
  cross-tenant READ leak reached through a WRITE** — invisible to any assertion that only watches `tenantId`.
- **`cycleId`** — re-parents the level under a foreign cycle, stranding the `SubjectCoefficient` rows
  `createGradeLevel` auto-created, which still carry the old `tenantId`.

`updateTerm` is reported as the **lesser** site and deliberately not conflated with it: it was **already**
field-picking, so no tenancy escape was ever reachable there. What was real is that nothing type-checked the body at
all and `new Date('pas-une-date')` reached Prisma as a 500 where the caller deserved a 400.

### What the fix is, and why it has the shape it has

**Two independent defences, and the asymmetry between them is the design.** Recorded in **`ADR-064`**:

1. **Defence 1 — the annotation.** `UpdateGradeLevelDto` and `UpdateTermDto` are real classes declared inline beside
   their POST siblings, with bounds **copied verbatim** — `UpdateTermDto.orderIndex` carries `@IsInt()` and
   deliberately **no `@Min`**, because `TermDto` has none and a PATCH that refuses what its own POST accepts is a new
   inconsistency smuggled in under cover of a hardening slice. Defence 1 restores the global pipe and nothing else
   had to change for an unknown key to become a 400. It lives entirely in the annotation and **dies silently** on one
   edit back to `Partial<>`, `unknown` or `any`.
2. **Defence 2 — the field pick.** `data: { code, name, orderIndex }` with `?? undefined`. This is a property of the
   **call site**, not of a decorator, so it holds even if defence 1 is regressed.

A status code cannot tell the two apart, so **no test asserts one**: the pipe test drives a real `ValidationPipe`,
and the mass-assignment test calls the handler **directly** — bypassing the pipe phase exactly as a regression would
— and asserts on `Object.keys(...).sort()` of the argument handed to a deliberately **non-filtering** Prisma double.
`expect(data.tenantId).toBeUndefined()` would have been green on the defect; the key-set oracle is not.

**The durable half is a derived ratchet.** `apps/api/src/shared/quality/body-metatype-gate.spec.ts` parses all **41**
controllers with the TypeScript compiler API (parse, never grep — the `hermetic-spec-writers-gate` doctrine), finds
all **77** `@Body()` parameters, and asserts that none erases to `Object`. The single sanctioned second style is
**derived, not listed**: a body `.parse()`/`.safeParse()`d by a schema **value-imported** from `@pilotage/contracts`
— **4** such handlers today (`messaging.controller.ts:83/:225/:248`, `analytics.controller.ts:326`), and
`MANUAL_ALLOWLIST` ships **empty**. `ParseUUIDPipe` lands on six path params.

### What this slice deliberately did NOT do

- **`PF-51` is `advanced`, never `closed`.** The row names three clauses — PATCH bodies, query params, enum. This
  slice closes the first. The ratchet keys on `@Body()` metatypes and therefore **structurally cannot** hold the
  other two closed. `OPEN.md:73`’s standing instruction — *“Do NOT flip this row on the strength of one
  parameter”* — is obeyed, and **both** surviving remainders are named there: the notification-kind clause **and**
  the three unvalidated query params of `GET /enrollments` (`enrollments.controller.ts:122`).
- **`PF-283` was not touched.** It was ranked first by the previous land pass and it stays first.
- **`PF-287` — the field-pick rule is not ratchet-enforced.** `ADR-064` states two rules; the gate enforces one.
  Two `data: body` mass-assignments survive: `cycles.controller.ts:132` (`CyclesController.update`, **twelve lines
  above** the handler this slice repaired) and `subjects.controller.ts:168`. Both are safe **today** only because
  their DTO is a real class — defence 1 alone, the exact posture this slice’s own docblock argues is insufficient.
- **`PF-284`** (a one-sided date PATCH skips `assertDateOrder`, which runs only when *both* dates are present, so a
  term’s stored order can still be inverted — `@IsDateString()` provably cannot close it, because it validates each
  field in isolation and never sees the row already loaded), **`PF-285`** (**six** privileged structural mutations
  write no audit row: `createTerm`/`updateTerm`/`deleteTerm` and all three grade-level handlers — `cycles.controller.ts`
  does not even import `writeAudit`), **`PF-286`** (the four Zod handlers never traverse the global pipe, so unknown
  keys are silently **stripped**, not refused).

### Evidence, and its named limits (DNC-06)

- `pnpm typecheck` **13/13 tasks successful, 0 errors**; `git diff --check` exit 0.
- The gate’s first pass returned **34 errors, all 34 inside the two new spec files**, none in the production
  controllers. Two fixes are load-bearing rather than cosmetic. (a) An `expect(site).toBeDefined()` sitting
  immediately above an indexed read was neither a TypeScript guard **nor** a runtime one: the worst failure of a
  ratchet — the classifier stops recognising anything and greens the entire tree — would have surfaced as
  `Cannot read properties of undefined` instead of its own message. All eleven sites now route through an
  `onlySite()` that throws with the count it actually saw. (b) `PERMISSION_SITES` was annotated
  `{ prototype: Record<string, object> }`, an annotation satisfiable **only** by adding an index signature to
  `CyclesController`/`AcademicYearsController` — deforming production code to please its test. The annotation was
  fixed; the controllers were not.
- **Neither new suite has ever been executed.** The census figures (41 controllers / 77 `@Body()` / 4 sanctioned / 0
  offenders) were re-derived by running the ratchet’s own classifier standalone against the repo’s `typescript`.
  That is evidence for the **classifier**, not for jest.
- **No HTTP request was issued and no browser was driven.** No `where` or `data` object built here has reached the
  PostgreSQL query engine.

### Merge conditions — none of them fixed here

1. **Execute both suites**, and prove **defence 2 by mutation**: revert `data:` to `data: body` and watch AC-4 go
   red. Defence 1 has eight fixture-driven red proofs; defence 2 — the half that survives a regression — has none.
2. **`GLOBAL_PIPE_OPTIONS` is a hand-transcribed twin** of the literal at `main.ts:141-145`, labelled “RECOPIÉES”.
   Delete `forbidNonWhitelisted` from `main.ts` and **every assertion in this PR stays green while production stops
   refusing `{"tenantId":…}`** — and at that moment the only surviving defence is a field pick that exists at exactly
   one call site. This is the paired-list drift this repo has already paid for. Derive the options from `main.ts`
   (the gate spec already has `typescript` loaded) instead of transcribing them.
3. **The `Partial<` census no longer returns zero.** `grep -rn "@Body() [a-zA-Z]*: Partial<" apps/api/src` now
   returns **2 hits**, both of them the ratchet’s own **fixture string literals**. AC-1 asked for exit 1. This is the
   same string-literal collision `hermetic-spec-writers-gate.spec.ts:26-34` already documents for `rmSync`; build the
   fixture from a concatenation, or restate AC-1 as `--include=*.controller.ts`, and **re-measure** rather than
   letting the PR body claim it.

### Next run

**`PF-283` still outranks everything this epic carries**, unchanged and undischarged — this run was scheduled over
it, not instead of it. Then **`PF-287`**, which ranks second and not lower because it is the only entry whose price
*rises with every slice that lands*: each new controller inherits a rule that is written down in `ADR-064` and
enforced on one axis of two. Then `PF-284`, `PF-267`, `PF-277`, `PF-279`, and `S-E05-2b` as the standing pointer.

**Id-allocation note.** This run took **`ADR-064`** and **`PF-284`** … **`PF-287`**. The escalation panel and two
reviewers referred to the surviving-`data: body` finding as *“PF-289”*; that label is cited from **no** source file
and **no** ledger row, and `PF-287`/`PF-288` were unallocated, so it is recorded here as **`PF-287`** — contiguous
allocation, arbitrated the same way the `PF-185`/`PF-186` collision was. **The next run allocates from `PF-288` and
`ADR-065`**, after re-checking open PRs.
