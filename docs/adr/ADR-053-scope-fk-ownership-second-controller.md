# ADR-053 — The scope-FK ownership check earns its abstraction at module two: the pure half moves to `shared/prisma/scope-fk.ts`, the probe loop stays written in line, and the declared scope must explain every id it carries

- **Status**: `accepted` — the five ownership probes, their position, the extraction boundary, the new scope-coherence
  refusal, and the service-side chokepoint are decided. What this ADR does **not** decide: converting `announcements`
  to `withTenant` (cut — `PF-232`), the composite-FK structural fix (`PF-205`, and it is **unavailable** on
  `user_profile_id`, see §D6), and any repair of rows already written (`PF-230`).
- **Date**: 2026-08-15
- **Story**: `S-E01-1f` (epic `V3-E01`), closing `PF-208`, recording `PF-229` … `PF-233`.
- **Relates to**: `ADR-002` (multi-tenancy) · `ADR-032 §D5–§D8` (the owner escapes its own policies) ·
  `ADR-042 §D1` (the explicit `AND tenant_id = …` is kept even when redundant) and `§D6` (referential integrity runs
  **outside** row security) · `ADR-048 §D9` (hardening a write must not create an existence oracle) ·
  **`ADR-049`** (the same defect on `calendar_event`; this ADR is that decision applied to a second controller, and it
  **supersedes `ADR-049 §D5`** — see §D2) · `ADR-051 §D3` (which promoted `isSuppliedScopeId` to the shared file this
  ADR extends) · `ADR-015` (permission model).
- **Number**: `053`. Allocated against `main` plus every open pull request (`TOOL-30` anti-recurrence): `052` is the
  highest on `main`, and no open PR claims an ADR.
- **Supersedes**: `ADR-049 §D5` ("the check is a private method of `CalendarController`, explicitly per model"). That
  section said in its own words that *"the second converting module is what earns the abstraction"*. This is the
  second module. §D2 below records what was earned and — more importantly — **what deliberately was not**.

---

## Context — the same mechanism, a worse column, and a recorded blast radius that was wrong

`announcement` carries **five** mono-column foreign keys that name a scope (`cycleId`, `gradeLevelId`,
`classSectionId`, `studentId`, `userProfileId`, declared as bare `@IsOptional() @IsUUID()` at
`announcements.controller.ts:130-134`). `validateScope` (`:889`) checked only that the field **required** by the
declared scope was **present**; nothing anywhere proved that any of the five ids belonged to the caller's tenant.

The mechanism is `ADR-049`'s verbatim: PostgreSQL evaluates referential integrity **outside** row security, so
`tenant_isolation`'s `WITH CHECK` sees `announcement.tenant_id` and nothing else, and the constraint validating
`class_section_id` runs as the **owner** of `class_section` with policies off. A foreign id inserts cleanly under a
perfectly correct policy.

**One thing here is worse than in the calendar, and it changes what remedies exist.** `announcement.user_profile_id`
has **no foreign key at all** — it is a bare `@db.Uuid` column. Not even existence is guaranteed, and `PF-205`'s
composite-FK remedy (`@@unique([id, tenantId])` + a composite FK) is therefore **not available on that column
without a schema change**. The application predicate is the only control that can exist there today. Recorded as
`PF-231`; it is a migration, so `G-MIGRATION`, so not this diff.

### The recorded severity of `PF-208` was wrong in **both** directions, and this is the corrected statement

`OPEN.md`'s row said the publish *"writes an `announcement_receipt` **and a notification** into another tenant's user
feed."* **Measured at `bc4e590`, it does not render in the victim's feed.** Every victim-side read path filters on the
*victim's* tenant while the injected rows carry the *attacker's* `tenantId`: `list`'s non-staff branch
(`announcements.controller.ts:139-148`), `unreadCount` (`:194-200`), and the notification feed
(`notifications.controller.ts:40-45`) all pass `tenantId: me.tenantId`; the write itself (`:604-616`) stamps
`tenantId: a.tenantId` — the **attacker's** — beside the **victim's** `userProfileId`.

**The honest severity is two things, and both must be stated wherever this defect is described:**

- **(a) INTEGRITY.** Tenant-mismatched rows are written into `announcement_receipt` and `notification`, referencing a
  `userProfileId` belonging to another tenant. They are real, persistent and **invisible to the victim** — *dark
  data*. They become live the instant any read path stops filtering on the reader's own tenant.
- **(b) DISCLOSURE, RENDERED TO THE ATTACKER.** `getOne` (`:415-440`) returns `stats.total`, `readRate`, and
  `_count.recipients` (`:115`/`:132`), plus the **raw `userProfileId` UUID list** at `:433-438`. Because the attacker
  owns the announcement, they read all of it. So the attacker learns the **cardinality** of a foreign class's
  guardian + teacher + linked-student set, and can **confirm that a foreign profile id exists**. That is a
  cross-tenant counting-and-existence oracle.

**Do not overclaim: there is no PII leak.** The profile lookup at `:361-363` **is** tenant-filtered
(`tenantId: me.tenantId`), so a foreign recipient renders as `userProfile: null` — names and e-mails are correctly
suppressed. **Do not underclaim either:** the cardinality oracle is real and is larger than a single id.

### `PF-208` also recorded the **smallest** of four leaking branches

`PF-208` named `individual_user` (`announcements.service.ts:43-44` at `bc4e590`: the supplied id returned **verbatim**
as the recipient set). Measured, **four** branches leaked, because five queries in that file carried no tenant
predicate at all — `guardianship`, `student`, `teachingAssignment`, `enrollment`, plus the verbatim pass-through:

| Branch | Why it leaked |
|---|---|
| `individual_user` | the supplied id **is** the recipient set, never confronted with the database |
| `individual_student` | `guardiansOfStudents` / `studentsOwnProfiles` untenanted |
| `class_section_scope` | the id is handed straight to `recipientsForClassSections` — a single foreign class id enumerates the **victim tenant's guardians + teachers + linked students in bulk** |
| `grade_level_scope` / `cycle_scope` | protected only **incidentally**, because their `classSection.findMany` *is* tenanted and yields an empty list. That protection is accidental, not designed, and disappears the moment anyone reorders the code. |

---

## Decision

### D1 — every supplied scope id is proven owned, sequentially, in a CLOSED switch, before the write

`create` (`announcements.controller.ts:616`) issues one probe per **supplied** id, on the five-field plan:

```ts
owned = await this.prisma.classSection.findFirst({ where: { id: ref.id, tenantId }, select: { id: true } });
```

Six properties, each load-bearing and each asserted by the spec:

1. **`findFirst`, never `findUnique`.** *"Belongs to another tenant"* and *"does not exist"* take the **same**
   `→ null` branch and produce the **byte-identical** French 400 from `unknownScopeRef`. Distinguishing them would
   itself be a cross-tenant existence oracle (`ADR-048 §D9`).
2. **`tenantId` EXPLICIT in every `where`.** `ADR-042 §D1`'s rule, and here it is not redundancy at all — see the
   named limit below.
3. **Sequential `await`, never `Promise.all`.** The shape must stay valid the day it enters an interactive
   transaction, which is **one** connection.
4. **`isSuppliedScopeId`, never key presence.** `@IsOptional()` lets `null` through despite `?: string`, and
   `findFirst({ where: { id: undefined, tenantId } })` makes Prisma **omit the filter**, returning the first row of
   the tenant and passing the check **vacuously**. That mutant is killed by an explicit negative control in the spec.
5. **The `switch` is CLOSED** with `default: { const exhaustive: never = ref.field; throw unknownScopeRef(exhaustive); }`
   — a sixth field does not compile, and if one reached runtime it **refuses** (fail closed).
6. **Ordering, and it is a requirement.** The probes run **after** the role/scope refusals (`assertTeacherScope`) and
   **before** `announcement.create`. A caller learns nothing about a body they were never allowed to send.

**NAMED LIMIT (DNC-06), and it must be repeated wherever this module is described.** `announcements` is **not**
converted to `withTenant`. These probes run on the connection that **owns** the tables, which escapes its own
policies for want of `FORCE ROW LEVEL SECURITY`. **The explicit `tenantId` predicate is therefore doing ALL of the
work; RLS is not doubling it.** Do not write that this module is "isolated" or "converted".

### D2 — the PURE half is extracted; the FIELD LISTS and the PROBE LOOP deliberately are not

`ScopeIdCarrier`, `assertSingleScopeId`, `scopeOwnershipPlan` and `unknownScopeRef` move from
`calendar.controller.ts` into **`apps/api/src/shared/prisma/scope-fk.ts`**, beside `isSuppliedScopeId` (promoted there
by `ADR-051 §D3`), generic over `F extends string`. Calendar imports the shared copy; its spec updates the **import
path only**, assertions unchanged. **There is no compatibility re-export** — two addresses for one rule is exactly
what an extraction exists to prevent.

This is the precedent `S-E01-1e` set when it moved `mapWriteRefusal` out of the same controller: *a second
hand-written copy at module two **is** the drift, not its risk.* `announcements` would have been the **third**
hand-written copy.

**Three things stay unshared, and each refusal is a decision rather than laziness:**

- **The field list.** Calendar keeps `SCOPE_ID_FIELDS` / `CREATE_OWNED_SCOPE_FIELDS` (four fields); announcements
  keeps `ANNOUNCEMENT_SCOPE_FIELDS` (`:69-75`, five). Widening one shared closed union per new module would make it a
  **third hand-maintained list** — the disease this epic is fighting (`PF-219`).
- **The `findFirst` loop.** It stays written **in line** in each handler, never behind a `this.<method>()`.
  This is not superstition: `classifyCallSite` (`scripts/tenant-adversarial-check.js:1898`) is **lexical** and does
  not follow `this` (`PF-200`). A probe hidden behind a shared method would count **not covered** while looking
  converted — or worse, run on the **owner** connection while a counter credits it to a callback.
- **The impure half generally.** `ADR-049 §D5`'s refusal of a generic `assertOwnedByTenant(tx, modelName, id, tenantId)`
  — dynamic dispatch by **string** over the Prisma client — **still stands.** `scope-fk.ts` contains no Prisma
  import, no database access and no dispatch: it carries only the predicates that decide *what must be proven*.

### D3 — the declared scope must explain EVERY id the body carries

New refusal, `assertScopeCoherence` (`:111`): given `body.scope`, exactly one field may be supplied
(`SCOPE_REQUIRED_FIELD`, `:95`), and any **other** supplied scope id is a **400** naming the offending fields.

**This is a new refusal class: bodies that were previously accepted now fail.** It is deliberate. `create` persisted
all five ids unconditionally, so a `class_section_scope` announcement could carry a `userProfileId` that **no
declared scope explains** — `PF-206`'s shape, on a column with no constraint at all (§Context). It also caps the
ownership plan at **one** probe per request.

**Measured against every shipped caller before deciding.** Both composers — `AnnouncementComposer.tsx:279-281` and
`TeacherMessageComposer.tsx:277-279` — send **exactly one** id, key omitted otherwise (conditional spread). **No
shipped caller is broken.** Defined on **truthiness**, never key presence, for the same reason as §D1.4.

Both this and `validateScope` are **pure**: they run before any database access, so a body they refuse costs zero
queries and reveals nothing.

### D4 — `computeRecipients` is the CHOKEPOINT; the controller probe is the belt, not the substitute

Every query in `announcements.service.ts` gains an explicit `tenantId` (`guardianship`, `student`,
`teachingAssignment`, `enrollment`), `individual_user` replaces its verbatim pass-through with a tenant-filtered
`userProfile.findFirst`, and a final `resolveWithinTenant` (`:151`) re-derives the returned set through
`userProfile.findMany({ where: { id: { in: [...ids] }, tenantId } })`.

**The final resolution is not redundant with the per-query predicates, and this is the argument for keeping it:**
`guardian.userProfileId` and `student.userProfileId` are **bare UUID columns**, and `guardians.controller.ts:167`
writes `userProfileId: body.userProfileId` with no ownership check whatsoever (separate module, separate finding —
`PF-231`). A perfectly intra-tenant `guardianship` can therefore point at a **foreign** profile. Filtering the joins
is then not enough — it is the **returned value** that must be proven. The bounded re-derivation makes
*"`computeRecipients` cannot return an id outside the announcement's tenant"* **true by construction**, whatever the
hygiene of the upstream columns. It deliberately does **not** filter on `status`: that would be a behaviour change
(`E8-S3`), not a tenancy fix.

**Defence in depth here is not belt-and-braces theatre — it is required**, because AC-1 guards **one entry point** and
`computeRecipients` is also reached from `publishInternal` (`:803`), which recomputes recipients from the **stored**
ids and never re-enters the probe (`PF-230`), and from `previewRecipients` (`:325`).

### D5 — the preview gets the same probes, and §0.3's measurement is recorded rather than repeated

1. `previewRecipients` runs the **same five probes, in the same order** (after the role refusals, before any roster
   read), with the **byte-identical** refusal. An endpoint that fires four untenanted queries against foreign ids is
   an existence-and-load surface even when it returns no count.
2. **The commissioning brief's premise was FALSE, measured, and this ADR records the correction rather than the
   claim.** `GET /announcements/preview-recipients` did **not** leak a cross-tenant count: `count` is
   `profiles.length` from a lookup that **is** tenant-filtered, so a foreign scope returned `0` — **byte-identical**
   to the early-return for an empty scope. There was no observable difference and therefore no oracle. **But that
   safety was ACCIDENTAL**: a refactor swapping `profiles.length` for `ids.length` would have created exactly the
   oracle the brief described. The probes make it **intentional**, and a test freezes it.
3. **The preview's real hole was intra-tenant and horizontal, and it is CLOSED.** `previewRecipients` refused a
   teacher only for `school_wide` / `individual_user` and carried none of `create`'s teaching-assignment check — so a
   teacher could read the size and role breakdown of **any class in their own school, including classes they do not
   teach**, while the docblock at `:216-219` claimed the composer *"can't be used to enumerate the school via the
   preview"*. The check is now factored into `assertTeacherScope` (`:857`) — moved word for word, same messages, same
   order, same `tenantId` on the assignment lookup — and called by **both** handlers. **The docblock became true
   because the code changed, not because the prose was softened** (`DNC-06`).

**The footprint check's reach, stated honestly so nobody reads AC-1 as closing the teacher boundary:**
`assertTeacherScope` covers only `class_section_scope`. A teacher may still target **any** student
(`individual_student`) or **any** grade level / cycle **of their own tenant**. The ownership probes prove the
**tenant**, never the **footprint**. Recorded as `PF-233`.

### D6 — what is NOT decided here

- **`announcements` is NOT converted to `withTenant`** and gains **no** `APP_ROLE_REQUIRED_PRIVILEGES` entries.
  `AC-6` and `AC-7` were **cut from the bottom**, as the story's own priority rule directs, and the cut is recorded as
  `PF-232` rather than silently dropped. `shared/prisma/tenant-scope.ts` and `announcements.module.ts` are
  **byte-unchanged**. This matters in the safe direction: a boot-probe closure entry added for a module that never
  opens a scope would certify a closure nobody exercises, and a half-converted handler moves the cutover counter the
  **wrong** way (`PF-217`).
- **No schema change.** `G-MIGRATION` is not triggered and must not become triggered. `apps/api/prisma/**` is
  untouched. A design that needs a migration has chosen `PF-231` and must stop and re-scope.
- **No repair of rows already written.** The fix is **preventive, not retroactive**: an `announcement` row already
  carrying a foreign scope id keeps recomputing foreign recipients at every re-publish until `PF-230` is done.
  A data-repair migration is a different risk tier.
- **`PF-218` still blocks the notification fan-out.** `NotificationsService` closes over its own injected
  `PrismaService` and exposes no `tx`-accepting entry point. Untouched here.
- **`PF-02` is NOT closed and the module class is NOT shut.** `PF-208` was the **second** instance of this shape found
  **by hand** in two runs. Nothing yet looks for it systematically — that is `PF-229`.

---

## Consequences

**Positive.** The `PF-208` P1 is closed at **both** ends — the write refuses an unowned id, and the recipient
computation is structurally incapable of returning a foreign profile — on every deployment and in all three
connection states, because neither depends on RLS being enforced. All **four** leaking branches are closed, not the
one the ledger named. A coherence hole (`PF-206`'s shape on an unconstrained column) closes as a side effect. The
preview's accidental safety becomes intentional, and its false docblock becomes true. The scope-FK ownership pattern
now has **one** implementation of its pure half, which — per `S-E01-1f §4` — is the **enabling** step for a machine
detector: once the shared plan is the only sanctioned route from a DTO scope-FK to a persisted id, *"is this field
proven owned?"* collapses from an undecidable data-flow question into **list membership**.

**Negative / accepted.** `create` and `previewRecipients` each gain **at most one** probe (§D3 caps the plan at one
supplied id) — a single-row, index-backed lookup on an administrator/teacher-only write path. `assertScopeCoherence`
is a **breaking change for an API caller** that supplied two scope ids at once; that combination produced an
unexplained, never-validated stored id, so refusing it is the point, and neither shipped composer does it. The module
still runs entirely on the owner connection (§D1's named limit). The teacher footprint tightening on the preview is a
**behaviour change for teachers**, and it is the intended one.

**Rollback.** Delete `assertScopeCoherence` and its two call sites, delete the two probe loops, revert the five
service predicates and `resolveWithinTenant`, revert the `assertTeacherScope` call in `previewRecipients`, and move
the four helpers back into `calendar.controller.ts`. No schema change, no migration, no contract change, no
`apps/web` change (`touchesUi: false`).

**Open, by name.**

| Finding | Priority | What it is |
|---|---|---|
| `PF-229` | P2 | **New.** The scope-FK ownership class has **no systematic detector**, and the two cheap heuristics were *measured* to fail in **both** directions: file-level (*"does the file contain a `findFirst` with `id` + `tenantId`?"*) marked **announcements covered** — a false green on the very defect this ADR fixes, because the teacher branch is such a probe for a different field; field-level (*"does `body.<field>` appear inside a tenant-qualified `find*`?"*) marked **all four calendar fields bare** — a false red on the module that already fixed it, because calendar's ids arrive as `ref.id` through the plan. **11 controllers / 27 bare `@IsUUID()` scope-FK DTO fields** were enumerated (`S-E01-1f §4` carries the table); it is a **candidate** list, not a defect list — `enrollments` and `guardians` were spot-checked and *do* guard by fetch-then-compare. A detector becomes possible only once the shared plan (§D2) is the mandated route. |
| `PF-230` | P2 | **New.** `POST /:id/publish` → `publishInternal` (`:803`) recomputes recipients from the **stored** ids and never re-enters the ownership probe, so a row written **before** this fix keeps producing foreign recipients on every re-publish. §D4's chokepoint makes that produce an **empty** set rather than a leak, which is why this is P2 and not P1 — but the poisoned `announcement.*_id` columns, and the `announcement_receipt` / `notification` rows already written, are **not cleaned**. Owns the retroactive half. |
| `PF-231` | P2 | **New, and it is why `PF-205`'s remedy does not transfer.** `announcement.user_profile_id` is a bare `@db.Uuid` column with **no foreign key at all** — not even existence is guaranteed — so `@@unique([id, tenantId])` + a composite FK cannot be applied without first creating the FK. The same shape exists on `guardian.user_profile_id` and `student.user_profile_id`, and `guardians.controller.ts:167` writes the latter with **no** ownership check (different module — record, do not fix). Migration ⇒ `G-MIGRATION` ⇒ a `scripts/restore-drill-baseline.json` entry (`PF-80`). |
| `PF-232` | P2 | **New — the recorded CUT.** `AC-6` (convert `announcements` to `withTenant`; `announcements.controller.ts` holds 23 `this.prisma.*` sites and `announcements.service.ts` 8) and `AC-7` (the `APP_ROLE_REQUIRED_PRIVILEGES` entries for the 12 tables this module touches) were cut from the bottom per the story's own priority rule, so the cutover-readiness counter is **unmoved** by this slice. Cut, not dropped: the P1 security fix and its honest description (`AC-1`…`AC-4`) were the mandatory half, and a half-converted handler moves the counter the **wrong** way (`PF-217`). |
| `PF-233` | P3 | **New.** `assertTeacherScope` constrains a teacher only on `class_section_scope`. A teacher may still target **any** `individual_student`, and **any** grade level or cycle, within their own tenant. The ownership probes prove the **tenant**, never the **footprint** — do not describe §D1 as closing the teacher boundary. |

**Id allocation note (`project_parallel_runs_collide_on_ids`).** `S-E01-1f` published *"next free finding: `PF-228`"*.
`PF-228` was consumed **inside this same diff** by an unrelated repair in `scripts/keycloak-live-probe.js` (a
hard-coded 9-character `'parent123'` fixture password replaced by a derivation from `realm-export.json`, whose
`passwordPolicy` demands length 12 — the literal could never have matched, and it produced a RED about itself). That
id is cited **from a script**, so it keeps `PF-228`; the story's enumeration finding was renumbered **by meaning** to
`PF-229`, and `PF-230` (already cited from `announcements.service.ts:41`) is unchanged.

## Evidence

`apps/api/src/modules/announcements/announcements-scope-ownership.spec.ts` (**new**, 734 lines) carries the proofs:
one **empty-set** case per leaking branch (`individual_user`, `individual_student`, `class_section_scope`,
`grade_level_scope`, `cycle_scope`) each with a **non-regression green** beside it; the five-field probe sweep and its
five-field green; the byte-identical-refusal comparison; the ordering property (role refusal before probe); the
`assertScopeCoherence` cases including truthiness-not-key-presence; the preview's before/after measurement of §D5.2;
and source assertions for `DNC-10` (no bypass flag, no allow-listed id, no env knob), the closed `switch`es, the
sequential probes, the in-line loops (`PF-200`) and the `DNC-06` owner-connection sentence.

The suite opens with a deliberate **negative control**: the same fake database is driven with the query **as it stood
at `bc4e590`** (no `tenantId`) and shown to return the **victim's** rows — which is what proves the emptiness observed
afterwards comes from the predicate and not from an inert mock. The fake database filters on the `where` it is given
and **throws loudly** on an operator it does not know, so a misread `where` cannot produce an accidental green.

**Named honestly, per `AC-8`: these assertions have NOT been executed in this role.** `GUARDRAILS §4` reserves the
toolchain for the test-architect; what ran on this diff is `pnpm typecheck` (exit 0, `@pilotage/api:typecheck` a real
cache **miss**) and `git diff --check` (exit 0). **Every case named above is unexecuted until the gate runs
`pnpm --filter @pilotage/api exec jest src/modules/announcements src/modules/calendar` — and never under a path
containing a dot-directory, where jest finds zero tests.** Do not read the list above as a passing suite.
