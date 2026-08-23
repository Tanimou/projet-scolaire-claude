# ADR-064 — A request body is a CLASS or a shared Zod schema, and a privileged write picks its fields

- **Status** Accepted
- **Date** 2026-08-23 (run 74)
- **Story** `S-E05-13` — [`docs/spec/features/v3-e05/stories/S-E05-13.md`](../spec/features/v3-e05/stories/S-E05-13.md)
- **Epic** `V3-E05` — AuthN/AuthZ hardening and permission integrity (layer L0)
- **Advances** `PF-51` — **on its FIRST CLAUSE ONLY** (unvalidated PATCH bodies), at the two sites named by the
  census (`cycles.controller.ts` `updateGradeLevel`, `academic-years.controller.ts` `updateTerm`), and the
  whole-tree ratchet is what keeps *that clause* closed. **`PF-51` is NOT closed and must not be flipped.** The
  row names three clauses — PATCH bodies / **query params** / **enum** — and this ratchet keys on `@Body()`
  metatypes, so it *structurally cannot* hold the other two. Both surviving remainders are named in
  `OPEN.md`: the notification-kind clause, and the three unvalidated query params of `GET /enrollments`
  (`enrollments.controller.ts:122` — `classSectionId`, `studentId`, `academicYearId`), which are also the
  handler `PF-283` is open against. `S-E05-13.md` §header and `OPEN.md:73` both say so; this line used to read
  “Closes”, and it was corrected at the land pass because the commit subject is generated from it
- **Raises** `PF-284` (P2) · `PF-285` (P2) · `PF-286` (P3) · `PF-287` (P2 — added at the land pass: the
  **field-pick rule of §D2 is not ratchet-enforced**, and two `data: body` mass-assignments survive at
  `cycles.controller.ts:132` and `subjects.controller.ts:168`, both on defence 1 alone)
- **Predecessors** `ADR-063` (`S-E05-14`, PR #266) which advanced `PF-51` on **one** path parameter and never
  claimed it closed
- **Related** `ADR-002` (multi-tenancy — a cross-tenant write is forbidden unconditionally) · `ADR-015`
  (permission model) · `GUARDRAILS.md` §1 (children's data, minimal access, non-negotiable) ·
  `hermetic-spec-writers-gate.spec.ts` (parse, never grep) · `boot-gate.spec.ts:26-33` (why 41 controllers
  are not imported under jest) · `TOOL-17` / `scripts/lib/walk-read.js` (the shared walk seam)

---

## Context — the pipe was not lenient, it was SKIPPED

`packages/tsconfig/node.json` sets `emitDecoratorMetadata: true`, so `tsc` writes each decorated handler's
parameter types into `design:paramtypes`. **A class survives that emission as itself. A type EXPRESSION does
not.** The shipped build artefact said so before this slice —
`apps/api/dist/modules/school-structure/cycles.controller.js` carried:

```
createGradeLevel → __metadata('design:paramtypes', [String, GradeLevelDto, Object])
updateGradeLevel → __metadata('design:paramtypes', [String, Object,        Object])
```

Nest's `ValidationPipe.toValidate()` returns `false` when the metatype is `Object` and hands the body back
**raw**. The global pipe configured at `apps/api/src/main.ts:141-145`
(`{ transform, whitelist, forbidNonWhitelisted }`) was therefore **not applied at all** on that route. This is
the load-bearing distinction, and it is the one a reader is most likely to get wrong: the route was not
validating loosely, it was not validating. `whitelist` never stripped a key, `forbidNonWhitelisted` never
raised a 400, and the raw body travelled on to `prisma.gradeLevel.update({ data: body })`.

`Partial<T>` is not alone in this. An `interface`, a `type` alias, a union, `unknown`, `any`, `Pick<>`,
`Omit<>`, `Record<>` and an inline object literal **all** erase to `Object`. A rule phrased as "no
`Partial<>` in a `@Body()`" would leave the door open one keyword over.

Two validation styles already run side by side in this repo, and the second is legitimate: take the raw body
and validate it with a Zod schema from `@pilotage/contracts` — a contract **shared with the web app**, which
the class-validator route does not offer. Those handlers erase to `Object` *by construction* and are not the
defect.

---

## D1 — Decision: the metatype rule

**Every `@Body()` parameter in `apps/api` is annotated with a bare identifier that resolves to a `class`
declaration reachable from that file — or the handler validates the raw body with a Zod schema imported as a
VALUE from `@pilotage/contracts`. Nothing else is permitted.**

Enforced by `apps/api/src/shared/quality/body-metatype-gate.spec.ts` over the whole controller tree.

The rule is **positive** (require a class) rather than negative (forbid `Partial<`), because the erasure set
is open-ended. It is checked by **parsing**, never by text scan: a grep is beaten by an occurrence inside a
string literal — the gate spec's own fixtures contain several — and the only way to re-green a grep that
trips on its own fixtures is to weaken it.

### D1a — The Zod exemption is DERIVED, never enumerated

An `Object` metatype is accepted **only** when its own method body reaches a `.parse(…)` / `.safeParse(…)`
whose receiver is a symbol imported as a value from `@pilotage/contracts`. An `import type` cannot earn it —
it does not survive compilation, so it cannot be the receiver of a call at runtime.

Naming the sanctioned handlers one by one would be the twin-list drift this repo has already paid for
(`academic_year.SELECT`, run 59: the required closure and the probe's hard-coded `VALUES` drifted apart and
four portals 503'd). A list also gives a future author a one-line way to green a genuine `Partial<T>`: add a
name. Derived, a fifth Zod handler passes on its own, and a `Partial<T>` never passes.

`DERIVED_ZOD_EXCEPTIONS` pins the **count** (4 today: 3 in `messaging`, 1 in `analytics`). That is not a twin
list — it is the guard against the derivation going vacant, the failure mode `lint-ratchet.spec.ts` recorded
where a broken predicate produced "nothing matches" and the suite went green proving nothing.

`MANUAL_ALLOWLIST` exists, has the shape `{ file, method, param, reason }`, and **ships empty**. It is a
test-level exception, never a runtime bypass (DNC-10): no wildcards, no path regexes, no environment
variables. A non-empty allowlist at land is a review-blocking finding.

### D1b — Consequence, recorded because it will surprise someone: a `@Body()` may not be a package import

The classifier rejects any type whose import specifier does not start with `.`
(`body-metatype-gate.spec.ts:297-299`), with the reason *"hors de l'arbre analysé, impossible de prouver que
c'est une classe"*. So **a controller may not annotate a `@Body()` with a DTO class imported from
`@pilotage/contracts` or any other non-relative module**, even if that DTO really is a class.

This is deliberate and it is a real restriction. Layer A parses source and follows **relative** imports only;
it cannot resolve into a package's build output, and a gate that guessed would be a gate that green-lights an
erased type. The two sanctioned styles are therefore: a class declared locally or reached by a relative
import, or the derived Zod exemption above. A shared contract crossing the package boundary goes through
Zod — which is the style that already exists for exactly that reason.

### D1c — Why two layers, and why the gate does not boot the app

- **Layer A — source census over the whole tree.** Parses every `apps/api/src/**/*.controller.ts` through the
  shared `scripts/lib/walk-read.js` seam. Text-level, so it sees all 41 controllers without loading one.
- **Layer B — reflection on the two repaired controllers**, plus a **positive control** on a site that was
  already correct (`CyclesController.create` → `CreateCycleDto`).

Neither replaces the other. Layer A gives breadth; Layer B proves Layer A models the real mechanism rather
than a theory of it. The positive control is what keeps the whole of Layer B honest: without it, the block
goes green the moment decorator metadata stops being emitted — after a switch to `@swc/jest` without
`decoratorMetadata: true`, say — and nobody would connect that change to this file.

Layer B does **not** import all 41 controllers. `boot-gate.spec.ts:26-33` records the measured reason:
importing broadly under ts-jest pulls `AuthModule → JwtStrategy → jwks-rsa → jose`, and `jose@6` is ESM-only,
so the CommonJS runtime dies at load, before the first assertion. A per-file `try/catch` would convert that
death into a silent skip, which is the hole itself (DNC-08).

The `@Body()` slot code is **calibrated, never hard-coded**. `RouteParamtypes` is not re-exported from
`@nestjs/common`, and writing `3` would bind these specs to a Nest 10 internal. More importantly,
`@CurrentJwt() jwt: KeycloakJwtPayload` reflects a **legitimate** `Object` on nearly every handler in these
files: an index bug would either denounce a healthy site or wave the real one through. The slot is read, not
counted.

---

## D2 — Decision: a privileged Prisma write emits an EXPLICIT field pick

**A handler that writes to Prisma constructs its `data` argument field by field. `data: body` — and any
spread of a request body into `data` — is forbidden on a privileged mutation.**

`updateGradeLevel` previously handed the raw body to Prisma. That is full mass assignment:
`GradeLevelUncheckedUpdateInput` accepts raw scalar FKs, and `schema.prisma:385-406` declares `tenantId`,
`schoolId` and `cycleId` as writable `@db.Uuid` scalars. The `findUnique` guard above it reads the row's
**current** tenant; it cannot see the **incoming** body, so it never stood between a caller and a
cross-tenant write. Each escape differs, and the blast radius is wider than `tenantId`:

| Field | What an attacker gets | Why nothing below caught it |
|---|---|---|
| `tenantId` | the row is orphaned into an arbitrary tenant, which need not exist | no relation, no FK, and `grade_level` carries **no RLS policy** (checked across `apps/api/prisma/migrations/**/*.sql`) |
| `schoolId` | the row keeps tenant A's `tenantId` yet **re-lists inside tenant B**, because `list()` filters on `where: { schoolId }` alone | the value is a valid FK to a real `School`. A cross-tenant READ leak reached through a WRITE |
| `cycleId` | the level moves under a foreign cycle, stranding the `SubjectCoefficient` rows `createGradeLevel` auto-created, which still carry the OLD `tenantId` | valid FK |

`ADR-002` forbids a cross-tenant write unconditionally. `grade_levels.write` is held by `super_admin` and
`school_admin` only (`permissions.constants.ts:151`) — no parent, teacher or student reached this. That is
**not** a mitigation: a tenant-bounded admin escaping their own tenant is precisely what the tenant boundary
exists to stop.

### D2a — Why BOTH defences ship, and why neither is redundant

Defence 1 (the class annotation) lives entirely in the **annotation**. It survives exactly as long as nobody
re-annotates the parameter: one edit back to `Partial<T>`, `unknown` or `any` and it is gone, silently, with
no error anywhere and no change to the method body.

Defence 2 (the field pick) is a property of **the call site**. It holds even when defence 1 has been
regressed.

That asymmetry is the entire reason both ship, and it dictates how they are proved. A status code cannot tell
them apart — a 400 is green whether or not the field pick exists — so **no test here asserts a status code**.
Each defence gets its own oracle, and each must be able to fail alone:

- defence 1 is driven through the **real** `ValidationPipe`, constructed with the literal options from
  `main.ts:141-145`, on the metatype **read out of the route metadata** — never on a class re-imported by
  hand, because what must be proved is that the ROUTE declares a class, not that a class exists somewhere in
  the file;
- defence 2 calls the method **directly**, which short-circuits Nest's pipe phase — i.e. simulates exactly a
  regression of defence 1 — and asserts on the ARGUMENT handed to `prisma.gradeLevel.update`.

Defence 2's assertion is on **the whole key set**, not on one key. `expect(data.tenantId).toBeUndefined()` is
green on the `{ tenantId: undefined }` that a `data: body` spread produces — green, that is, on the defect
itself — and it is blind to the `schoolId` leak above.

The fake Prisma in those tests is deliberately **non-filtering**: it records arguments and returns fixtures
without applying them. A double that filtered by tenant on its own would turn these tests green without the
code carrying any clause at all — it would prove the false.

---

## D3 — What was NOT tightened, on purpose

`UpdateGradeLevelDto` and `UpdateTermDto` copy their bounds **verbatim** from the POST DTOs. Nothing is
narrowed. A PATCH that refuses what its own POST accepts is a new inconsistency, not a hardening —
specifically, `TermDto.orderIndex` carries `@IsInt()` alone, so the PATCH does not gain a `@Min`.

An empty `{}` body still traverses an all-`@IsOptional()` DTO, reaches `prisma.update` with every field
`undefined`, and returns 200. That was already true before this slice. It is pinned by a test precisely
because it is the kind of thing a later reviewer "fixes" into a 400 and breaks a caller.

Response shapes are unchanged (G-TRUTH). The slice changes what is **accepted**, never what is **returned**.

`ParseUUIDPipe` was mounted on six path parameters that reach `@db.Uuid` columns. The story named five; the
sixth (`POST academic-years/:id/terms`) is the same defect on the sibling route, and leaving it out would
create an asymmetry inside the file being repaired. This is a genuine contract change for the four routes
with real first-party callers (`actions.ts:61/:71` and `:68/:78`): their error surface moves from Prisma
P2023 → 500 to a 400 from the pipe. It is stated rather than assumed invisible — all four callers already
send real uuids, so no portal breaks.

---

## D4 — Recorded, not fixed

| Id | Finding | Priority |
|---|---|---|
| `PF-284` | a one-sided PATCH does not trigger `assertDateOrder`: it runs only when BOTH dates are present, so an `endDate` earlier than the STORED `startDate` is accepted. `@IsDateString()` cannot see it — a per-field validator has no access to stored state. Closing it needs a read-then-compare in the handler | P2 |
| `PF-285` | these privileged mutations write **no audit row**, while their `academic-years` siblings relay through `writeAudit` | P2 |
| `PF-286` | the four Zod handlers never traverse the global pipe, so `whitelist`/`forbidNonWhitelisted` do not apply there: an unknown key is silently **stripped** by Zod instead of refused with a 400. A real asymmetry between the two sanctioned styles, measured by this ratchet, not this slice's to close | P3 |

---

## Consequences

**Positive.** A third `Partial<T>` added next month fails the gate on its first commit, with nobody editing
the gate. The rule is stated positively, so the whole erasure family is covered rather than one keyword. The
Zod style stays legitimate without a hand-maintained roster. Privileged writes carry a defence that survives
an annotation regression.

**Negative, and accepted.** A `@Body()` may not be annotated with a class imported from a package (D1b), so a
contract shared across the package boundary must go through Zod. Layer A parses every controller on each run
of that spec — bounded and cheap, but not free. `DERIVED_ZOD_EXCEPTIONS` must be revised **knowingly** when a
fifth Zod handler lands; that is the point of pinning it.

**Neutral.** No migration. No schema change. No new dependency: `typescript` is already a root devDependency
and two sibling scripts already `require` it.
