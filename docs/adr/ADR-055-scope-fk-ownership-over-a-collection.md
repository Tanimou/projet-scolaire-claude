# ADR-055 — A collection body does not get a probe per entry: the scope-FK ownership check becomes SET-shaped, and it keys on the SCHOOL the read surface already keys on

- **Status**: `accepted` — the probe shape, its predicate, the field named on a set miss and the accepted narrowing
  are decided. What this ADR does **not** decide is the composite-unique structural fix on `subject_coefficient`,
  which is recorded as `PF-239` and is a migration.
- **Date**: 2026-08-22
- **Story**: `S-E05-3` (epic `V3-E05`), closing `PF-10` on its reachable write path, recording `PF-238`, `PF-239`,
  `PF-240` and — at the routine's land pass, from the escalation panel's blocking merge condition — `PF-241`, the
  read/write predicate asymmetry now pinned by the round-trip block described in `stories/S-E05-3.md` §12.
- **Relates to**: `ADR-049 §D1` (the explicit `tenantId` predicate), `§D2` (the 400 and its indiscernability),
  `§D4` (the statement bound that became a rule) and `§D5` (no dynamic dispatch by model name) · `ADR-053 §D1`
  (the closed per-model switch) and `§D2` (only the PURE half is shared) · `ADR-054 §D2` (the recorded refusal to
  thread a tenant scope into a module for a probe's sake) · `ADR-042 §D6` (referential integrity runs outside row
  security) · `ADR-032 §D5` (the owner escapes its own policies) · `ADR-002` (multi-tenancy).
- **Number**: `055`. Allocated against `main` **plus every open pull request** (`TOOL-30` anti-recurrence): `054` is
  the highest on `main`, and all six open PRs (`#165`, `#166`, `#167`, `#168`, `#181`, `#190`) are Dependabot bumps
  claiming no ADR and no finding id.
- **Amends**: nothing. It **extends** `ADR-049 §D4`'s published per-handler statement table to a handler whose body
  is a collection, and the invariant that table was replaced by is what decides §D1 below.

---

## Context — the same leak, on a shape the two previous rulings did not cover

`SubjectCoefficient` is unique on `@@unique([gradeLevelId, subjectId])` (`schema.prisma:448`). **The unique key
carries no tenant column and no school column.** `upsertCoefficients`
(`subjects.controller.ts`, `@Put('coefficients/matrix')`) upserts on exactly that key from ids supplied in the
request body, validated as `@IsUUID()` and nothing more. Three consequences, and all three are live:

1. **The UPDATE branch rewrites another tenant's row.** A caller in tenant A naming tenant B's
   `(gradeLevelId, subjectId)` pair overwrites B's coefficient. Coefficients re-weight the global average of every
   pupil taught that subject, so this is a silent, retroactive corruption of another tenant's parent dashboard —
   the north star surface — with no audit row on the victim's side.
2. **The CREATE branch stamps a lying tenant column.** A foreign pair with no row yet inserts one with
   `tenantId: me.tenantId` while both its foreign keys point into another tenant's `grade_level` / `subject`. The
   FK constraints resolve because PostgreSQL evaluates referential integrity **outside** row security
   (`ADR-042 §D6`, `ADR-049 §Context`), so a perfectly correct `tenant_isolation` policy admits it. This is the
   `PF-208` "dark row" shape a second time.
3. **The best-effort recompute enqueue propagates it.** `[...new Set(body.entries.map((e) => e.subjectId))]` upserts
   `snapshot_recompute_trigger` rows under the caller's tenant carrying a foreign `subjectId` — a third dark row,
   on a table the worker fans out from. Refusing the request **before the transaction opens its write loop** closes
   all three by construction; a second filter at the enqueue site would be a second hand-kept list, which is the
   defect this epic exists to stop repeating.

**Two structural differences from `ADR-049` (calendar) and `ADR-053` (announcements), and each forces a decision.**

- **The body is a COLLECTION, not a scope.** Calendar and announcements carry *at most one* scope id per request
  (`ADR-049 §D3`). Here a normal matrix save is 6 subjects × 5 grade levels = **30 entries**, i.e. up to 60 ids.
- **The controller is SCHOOL-scoped, not tenant-scoped.** Every sibling handler in this file derives its rows from
  `const { schoolId } = await this.ctx.forTenant(me.tenantId)` — `list`, `create` (`tx.gradeLevel.findMany({ where:
  { schoolId } })`) and the GET this write answers, `coefficientMatrix` (`subjectCoefficient.findMany({ where: {
  subject: { schoolId } } })`). And `SchoolContextService` states plainly that **a tenant may own several schools**
  (Phase 2D multi-school; `forTenant` resolves *one* of them per request).

---

## Decision

### D1 — the probe is SET-shaped: ONE `findMany` per referenced model over the DISTINCT id set, and the refusal is a set difference

```ts
const gradeLevelIds = [...new Set(body.entries.map((e) => e.gradeLevelId))];
const owned = await tx.gradeLevel.findMany({
  where: { id: { in: gradeLevelIds }, tenantId: me.tenantId, schoolId },
  select: { id: true },
});
```

…and the same, once, for `subject`. Two statements, whatever the body's length.

**This is not an optimisation; it is `ADR-049 §D4` applied literally.** That ADR replaced a measured numeric bound
with an invariant, quoted here verbatim because it decides this slice on its own:

> **The number of statements inside a tenant scope must be bounded by the SCHEMA, never by the REQUEST.**

…and it names the violating shape by example: *"A handler that writes `for (const id of body.ids) await
tx.x.findFirst(…)` is a **violation even at count 2 today**, because a caller can make it 500 tomorrow."*
Transcribing `ADR-053 §D1`'s per-ref `findFirst` switch onto a 30-entry body would emit **60** probes and be exactly
that shape. The set probe restores the constant: **2 probes = 2 tenant-bearing foreign-key columns on
`subject_coefficient`**, derivable from the table definition and from nothing else.

**What does not change.** The switch stays **closed and per model**: `tx.gradeLevel` and `tx.subject` are written
literally, in the handler, and no model is ever named by a string. `ADR-049 §D5`'s refusal of a generic
`assertOwnedByTenant(tx, modelName, …)` is intact — set-shaping the probe removes statements, not typing. The
IMPURE half stays **lexically inline** in the handler (`PF-200`: `tenant-adversarial-check.js` attribution does not
traverse `this`, so a probe behind a shared method counts as NOT COVERED while looking converted). Only a pure
planner — text in, `{ field, ids }` out, no Prisma import, no database, no dispatch — may live in
`shared/prisma/scope-fk.ts` under `ADR-053 §D2`.

**Amended statement table for `upsertCoefficients`:** `2` constant probes + `N` upserts + `1` audit write. The `N`
is request-bounded and is a **pre-existing** violation of the invariant above; it is recorded as `PF-238` rather
than fixed here, because `AC-4` requires the happy path byte-identical and a cap is a behaviour change of its own.
Recording it is the point: this ADR must not be readable as blessing the loop it sits in front of.

### D2 — the predicate is a CONJUNCTION of `tenantId` AND `schoolId`, and the school half is what is new

`ADR-049 §D1` specifies `where: { id, tenantId }` and gives the reason the explicit tenant clause is load-bearing:
executed as `app_user` the policy does the work and the clause is redundant; executed as the **owner** —
`degraded_no_app_url`, which is every deployment today, and the owner escapes its own policies (`ADR-032 §D5`) —
**the clause is the only thing doing the work.** That clause is kept verbatim.

`schoolId` is added, and adding it is this ADR's new ruling:

1. **It matches the read the write answers.** `coefficientMatrix` renders exactly the subjects and grade levels of
   `ctx.forTenant(me.tenantId).schoolId`. A probe on `tenantId` alone would accept ids the matrix never displayed.
2. **A tenant may own several schools.** Under a tenant-only probe, a same-tenant id from a *sibling* school passes
   and writes a coefficient into a school the caller is not currently in — not a tenant breach, but a silent data
   defect on the same table, discovered by nobody.
3. **Conjunction, never disjunction.** `grade_level.tenant_id` and `subject.tenant_id` are denormalised beside
   `school_id` with no constraint tying the two to agree. Requiring both means a row whose denormalisation has
   drifted is **refused**, not accepted by whichever column happens to be right. Fail-closed on inconsistent data is
   the only safe reading of two columns that can disagree.
4. **It is index-backed.** Both models carry `@@index([tenantId, schoolId])`, so the conjunction plus an `id IN (…)`
   is a covered lookup, not a scan.

### D3 — the accepted consequence: the refusal is NARROWER than the tenant, and that is the correct direction

An administrator of a multi-school tenant who switches active school between loading the matrix and saving it
receives the 400 instead of writing into the school they just left. This is a real behaviour, named rather than
discovered: `ctx.forTenant` is the single definition of *"the school this request runs in"*, and **a write must not
outrun the read that produced it.** The alternative — accepting any id of the tenant — trades a visible, recoverable
refusal for an invisible, unrecoverable mis-write. `AC-7`'s false-positive control exists to prove the ordinary
same-school save is untouched.

### D4 — the refusal reuses `unknownScopeRef(field)` unchanged, and the field named on a set miss is DETERMINISTIC

A foreign id and an unknown id take the **same** branch (absent from the returned set) and therefore produce the
**same** message, byte for byte — `ADR-049 §D2`'s indiscernability, preserved by construction, because
distinguishing them would itself be a cross-tenant existence oracle (`ADR-048 §D9`).

The set probe adds one question the single-id form never had: *which field does the message name when the miss is a
set difference?* The rule: **the declared field order decides** — `gradeLevelId` before `subjectId` — and the
message names the field only. Never the id, never a count of misses, never a tenant, a school, a table or a
Postgres string. `apps/web/src/app/admin/subjects/actions.ts` surfaces `body.message` verbatim to the
administrator, so the message is UI copy and is held to that bar.

**No second message is written.** The vocabulary of `unknownScopeRef` ("périmètre") was authored for calendar and
announcement scopes and reads slightly wide for a coefficient cell; that is accepted. A module-local variant would
be a **third** hand-kept copy of a security message, which is the failure mode `ADR-053 §D2` extracted these
helpers to end.

### D5 — what is NOT decided here

- **No tenant scope.** This module is not converted to `TenantScopeService` / `this.scope.run(...)`. `ADR-054 §D2`
  is the recorded refusal of exactly this reflex; the probe gains nothing from it and the conversion is `V3-E01`'s
  `PF-02` work. Verified against the counter rather than assumed: `subjects.controller.ts` is not in
  `tenant-adversarial-check.js`'s out-of-scope enumeration, so its statements are counted `uncovered` and the two
  new probes move a `limit` verdict's number, never a set-equality ratchet.
- **No migration** (`G-MIGRATION` not triggered). The shape that makes this leak *impossible* rather than *checked*
  is `PF-205`'s composite key applied here — `@@unique([tenantId, gradeLevelId, subjectId])`, or a composite FK path
  per `ADR-042` — and it is recorded as **`PF-239`**, deliberately second, for the same reason `ADR-049 §D6` gives:
  the application predicate lands today and the structural fix lands when a migration slice can carry it.
- **No cap on `entries[]`** — recorded as **`PF-238`** (`BulkCoefficientDto` has no `@ArrayMaxSize`, and the write
  loop is bounded by the request inside a transaction with a 5 s interactive timeout).
- **The sibling writers are untouched.** `cycles.controller.ts:151` and `subjects.controller.ts:132` derive their
  ids from `schoolId` queries and cannot carry a caller-supplied foreign id;
  `packages/imports-core/src/handlers/subjects.handler.ts:75` runs on the import pipeline's own context. Only
  `upsertCoefficients` accepts ids from the body, and only it is changed.

---

## Consequences

**Good.** The last caller-supplied-id write path on `subject_coefficient` refuses foreign and unknown ids
identically, before any row, any audit row and any recompute trigger exists. The probe cost is constant in the body
size, so the fix cannot be undone by a larger matrix. The refusal is greppable in one place per model, in the
handler, where "where is ownership checked?" is answered by reading the handler.

**Bad.** The check is still an *application* predicate, not a constraint: it is correct only while every write path
runs through this handler. `PF-239` is the constraint, and until it lands, a future writer of this table inherits
nothing.

**Accepted.** A same-tenant, other-school id is now refused (§D3). Two statements are added to a transaction that
already carries a request-bounded loop (`PF-238`); the loop, not the probes, is the budget risk, and it is recorded
rather than smuggled.

**Limit, stated (DNC-06).** Nothing proven for this slice touches PostgreSQL. The specs prove the **shape** of the
emitted queries and the handler's behaviour, not the behaviour of RLS. The application connects as the **owner** of
its tables, which escapes its own policies for want of `FORCE ROW LEVEL SECURITY`: the explicit `tenantId` +
`schoolId` predicate does **all** of the work, and RLS does not double it.
