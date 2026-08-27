# ADR-080 — A page window is ONE parse, and a bounded page may never wear the label of a total

- **Status** Accepted (architecture ruling, `S-E03-9`)
- **Date** 2026-08-27
- **Story** `S-E03-9` — one page window, one cap, one place; and a negative limit stops silently inverting the
  result set (operator override; `docs/spec/features/v3-e03/PROGRESS.md` pointed elsewhere — see §8)
- **Epic** `V3-E03` — Canonical truth and query contracts (layer L0)
- **Advances, does NOT close** `PF-50` — *"/admin/assignments renders 290 rows unpaginated; unread counts fetch
  every message; parent dashboard fans out per child"* (audit A2 App. K.4). The **A1 limb** (the unpaginated
  assignments list and its four derived KPIs) is closed here. The **A2 limb** (row transfer where an aggregate
  would do, `messaging.service.ts`) and the **A3 limb** (the bounded-but-still-2N parent dashboard fan-out) are
  untouched by design and recorded below. A closure row would be the `closed ≠ fixed` error of run 93.
- **Raises** `PF-419` (messaging `listConversations` transfers every `(conversationId, createdAt)` tuple of the
  page's threads with no `take`) · `PF-420` (parent dashboard issues 2N round trips of a heavy aggregate under
  `FAMILY_OVERVIEW_MAX`) · `PF-421` (`AFFECTATIONS ACTIVES` counts **all** assignments — no `active` predicate
  exists on `TeachingAssignment` and none is applied; the label has been false since it was written, independently
  of pagination) · `PF-422` (`GET /subjects` and `GET /classes` are themselves unbounded `findMany`, so the
  set-difference KPI has an unbounded *second* operand) · `PF-423` (`parseInt(x, 10)` accepts junk suffixes and
  mis-reads exponent notation — `'1e9'` parses to `1`, `'50abc'` to `50`, `'5.9'` to `5` — at every one of the
  nine sites; a caller asking for a billion rows silently gets one)
- **Related** `ADR-079 §D3` (two questions split by *name*, and the illegal sum forbidden in the type system —
  this ADR reuses that mechanism verbatim for page-size vs total) · `ADR-078 §D1` (the home ruling for a pure
  cross-app derivation) · `ADR-070` (canonical academic-year resolution — same three-file shape) ·
  `ADR-067 §D6` (one-way-ratchet house style) · `ADR-064` (request-input metatype erasure) · `ADR-002`
  (tenant scoping) · `DNC-01` (KPI/ledger divergence) · `GUARDRAILS.md` §2, §4

---

## Verdict

**CONCERNS — proceed, under the rulings below.** No schema change, no migration, no new dependency, no new HTTP
style, no new package, no permission or guard metadata change. Four rulings are genuinely new architecture and are
why this ADR is mandatory; four concerns are blocking-grade and are listed in §6.

The single most important sentence in this ADR: **bounding `GET /teaching-assignments` without §D4 would
manufacture a worse truth defect than the one PF-50 names.** See §D4.

---

## D1 — HOME: the canonical resolver is a **zod schema factory** in `packages/contracts/src/pagination/`

The brief frames the messaging zod schema as "a NINTH shape — inspect it and decide whether it converts". Measured,
the ruling inverts: **`ConversationInboxQuerySchema` is not a ninth divergence, it is the only site already
correct**, and it is the seed of the canonical module rather than a conversion target.

`packages/contracts/src/dto/conversation.ts:105-110`:

    limit:  z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).default(0),

Check it against AC-1 line by line: clamps below (`min(1)` **rejects**, it does not coerce) · rejects zero ·
rejects a negative limit · rejects a negative offset · carries a per-endpoint `default` and `max` · pure · no Nest,
no Prisma · unit-testable. It satisfies **every clause of AC-1 already**. The other eight sites are the
divergence; this one is the target.

Therefore the canonical module is a **factory** that emits exactly that shape with caller-supplied numbers:

    packages/contracts/src/pagination/page-window.ts   ← the factory + branded types (NEW)
    packages/contracts/src/pagination/index.ts         ← re-export (NEW)
    packages/contracts/src/index.ts                    ← add `export * from './pagination';` (EDIT, additive)

**Why `packages/contracts` and not `apps/api/src/shared/`.** This is not a free choice; the repo has ruled it
twice and the rule is mechanical:

| Layer | Rule | Precedent |
|---|---|---|
| Pure derivation — no Prisma, no Nest, unit-testable | `packages/contracts/src/<domain>/` | `calendar/window.ts` (ADR-078 §D1), `roster/class-roster-size.ts` (ADR-079) |
| The Prisma-facing adapter that turns the contract into a query | `apps/api/src/shared/<domain>/prisma-<domain>-reader.ts` | `shared/roster/prisma-roster-reader.ts`, `shared/academic-year/prisma-academic-year-reader.ts` |
| The executable spec | `apps/api/src/shared/<domain>/<name>.spec.ts` | `shared/roster/class-roster-size.spec.ts` |
| The ratchet | `apps/api/src/shared/quality/<name>-derivation-gate.spec.ts` | `class-roster-size-derivation-gate.spec.ts` |

A page window is a **request contract**, the most literally on-contract thing in the repo: it is the meaning of a
query string, shared between the client that writes it and the server that reads it. `apps/web` pins `limit=` in
**twenty-plus** URLs across **three** portals (`admin/alerts` `limit=100`, `admin/students/[id]` `guardians?limit=200`,
`parent/lessons` `limit=200`, `teacher/documents` `lessons?mine=true&limit=500`, `components/notifications` `limit=100`,
…). Several sit **exactly on the cap** they are about to be validated against. Putting the caps anywhere `apps/web`
cannot reach would leave the client's literals and the server's caps as a **paired hand-maintained list** — the
exact silent-drift shape the repo has already been burned by. `contracts` is the only home reachable from both
(`transpilePackages` lists `@pilotage/contracts`) **and** unit-testable (`apps/api/jest.config.js` maps the
specifier to SOURCE).

**No second home is invented.** `apps/api/src/shared/pagination/` gets the spec file only, per the table above.

**Rejected alternative** — a hand-rolled pure `resolvePageWindow(raw, {def, max}): {ok, take, skip} | {ok:false}`
returning a discriminated result. It is a *new* validation idiom whose Nest boundary (`if (!r.ok) throw new
BadRequestException(...)`) would have to be re-hand-written at nine call sites — reintroducing, in the error path,
precisely the duplication the slice exists to remove. `safeParse` + `BadRequestException(issues.map(i => i.message))`
is already the house form at `messaging.controller.ts:126-129`, `:155-158`, `:194-197`. **Reuse it.**

## D2 — SHAPE: `pageWindow({ def, max })` returns a zod object, and `take`/`skip` are BRANDED

Two questions currently share the type `number` and the ADR-079 mechanism is imported wholesale to split them:

- `PageSize` — *how many rows this request may carry.* A window.
- `ResultTotal` — *how many rows the filtered set holds.* A truth.

Both are `number & { readonly [BRAND]: true }`. **`PageSize` is not assignable where `ResultTotal` is expected**,
so `total: data.length` stops compiling inside `apps/api`. This is `ADR-079 §D3` applied to a second pair, not a
new decision — which is precisely why it is cheap.

Prisma takes plain numbers, so the reader unwraps at the query boundary and nowhere else, exactly as
`prisma-roster-reader.ts` does.

## D3 — CONVERSION: eight sites convert, one site is the seed, zero sites are exempt

| Site | Today | After | Default / max |
|---|---|---|---|
| `alerts.controller.ts:124-136` | `DefaultValuePipe`+`ParseIntPipe` then clamp | `pageWindow({def:50,max:200})` | 50 / 200 — **unchanged** |
| `analytics.controller.ts:277-278` | `Math.min(parseInt‖50, 200)` — **inverts** | idem | 50 / 200 — **unchanged** |
| `students.controller.ts:233-234` | idem — **inverts** | idem | 50 / 200 — **unchanged** |
| `guardians.controller.ts:105` | idem — **inverts** | idem | 50 / 200 — **unchanged** |
| `lessons.controller.ts:370` | `Math.min(parseInt‖100, 500)` — **inverts** | `pageWindow({def:100,max:500})` | 100 / 500 — **unchanged** |
| `notifications.controller.ts:39` | `Math.min(100, Math.max(1, …))` | `pageWindow({def:20,max:100})` | 20 / 100 — **unchanged** |
| `teaching/teachers.controller.ts:335` | idem | `pageWindow({def:50,max:100})` | 50 / 100 — **unchanged** |
| `attendance.controller.ts:325-328` | `Number.isFinite` then clamp | `pageWindow({def:200,max:500})` | 200 / 500 — **unchanged** |
| `messaging.controller.ts:126/155/194` | zod, already correct | **re-expressed through the factory** | 50 / 200 — **unchanged** |

**Not one observable default or cap moves.** AC-2 is satisfied by table, not by prose.

**Measured, and it corrects the brief:** only the **four** `Math.min(parseInt(x,10) ‖ d, max)` sites invert.
`alerts`, `notifications`, `teachers` and `attendance` all carry a `Math.max(…, 1)` and already clamp below.
Reproduced with node:

    Math.min(parseInt('-5',10)||50, 200)          →  -5      // Prisma: take from the END, reversed
    Math.min(parseInt('0',10) ||50, 200)          →  50      // 0 silently becomes the default
    parseInt('-3',10)||0                          →  -3      // negative skip → Prisma runtime error → 500
    Number.isFinite-guarded attendance, '-5'       →   1      // already correct
    Math.min(100,Math.max(1,parseInt('-5',10)||20))→   1      // already correct

**Two behaviour changes that are NOT default/cap changes and are declared here anyway**, because AC-2's spirit is
"no silent observable change":

1. **`parseInt` junk-tolerance ends** (`PF-423`). `'1e9'` parsed to `1`; `'50abc'` to `50`; `'5.9'` to `5`. Under
   `z.coerce.number().int()` all three become **400**. A caller who was accidentally relying on `?limit=1e9`
   returning one row now gets an error instead of a wrong answer. This is a strict improvement and it is
   caller-visible.
2. **`?limit=` repeated** (`?limit=5&limit=6`) arrives as an array; `Number([…])` is `NaN` → **400**, where the
   old idiom took the first-ish value. Also an improvement, also caller-visible.

Neither is authorization-relevant. Tenant scoping is untouched at all nine sites — the `where` clauses are not
edited.

## D4 — THE TRUTH HALF, and it is where this slice can do net harm

`apps/web/src/app/admin/assignments/page.tsx:39-43` derives **four** KPIs from the fetched array:

    totalAssignments      = assignments.length
    teachersAssigned      = new Set(assignments.map(a => a.teacherProfile.id)).size
    classesCovered        = new Set(assignments.map(a => a.classSection.id)).size
    subjectsWithoutTeacher = subjects.filter(s => !assignedSubjectIds.has(s.id)).length

After AC-4 that array is a **page**. Three of the four then become the page size wearing a truth's label — the
`PF-20` (length of a constant) and `PF-40` (count over a sliced list) defect, for the third time.

**The fourth is worse, and this is the blocking one.** `subjectsWithoutTeacher` is a set difference whose *other*
operand, `GET /subjects`, is itself an unbounded `findMany` (`subjects.controller.ts:110`, `PF-422`). Bounding only
the assignments side makes the difference **monotonically wrong in the alarming direction**: with a default page of
50 over ~290 rows, nearly every subject would be reported *sans enseignant*. A KPI that under-reports is a bug; a
KPI that manufactures a staffing crisis on a school's dashboard is a **north-star violation** — GUARDRAILS §1
requires every figure to be explainable and lead to a next step, and this one would lead every admin to the wrong
next step.

**Ruling: all four figures are server-side aggregates over the whole filtered set, and `subjectsWithoutTeacher` is
MANDATORY, not "may need its own aggregate".**

    GET /teaching-assignments
      → { data, total, limit, offset,
          totals:   { assignments, teachers, classes, subjectsWithoutTeacher },
          coverage: { scope: 'establishment',
                      classSectionIdsWithPrincipal, classSectionIdsWithAssistant, subjectIdsWithTeacher } }

**The block is named `totals`, and that name is binding on both halves.** The story's `contract` block drafted it as
`summary: { total, distinctTeachers, distinctClasses, assignedSubjectIds }`; the API followed this ADR and the admin
page followed the story, so the page read a key the API never emitted and all four KPI cards rendered `—` on every
successful response while build and typecheck stayed green. One name, `totals`, both sides, same commit.

**`coverage` is a second block with a DIFFERENT scope, and that is deliberate.** `totals` answers *about the
currently filtered set*; `coverage` answers *about the establishment* (`tenantId` + academic year, never the
filters), because the panel it feeds asserts « Portée : tout l'établissement ». `subjectIdsWithTeacher` lives here,
not in `totals`, for exactly that reason — and because the panel **names** the uncovered subjects, which the
`subjectsWithoutTeacher` scalar cannot do. The scalar and the id list are not redundant: they answer two questions
over two scopes, and the `scope` field makes the second one unmislabelable.

- Response shape is **additive** — `{ data }` is preserved, so no existing caller breaks. G-AUTHZ: no permission
  metadata changes, `@RequiresPermission('teaching_assignments.read')` is kept verbatim; the only new response
  code is the intended **400** of AC-3.
- Envelope `{ data, total, limit, offset }` is the house form already shipped at `students.controller.ts:349`.
  **Reuse it; do not invent a `meta` or `pagination` sub-object.**
- **Distinct counts use `prisma.teachingAssignment.groupBy`, never `$queryRaw`.** Raw SQL would step outside the
  tenant-scope deployment gate's reach. `groupBy(['teacherProfileId'])` carries the same `where: { tenantId, …filters }`
  as the page query, and its **cardinality is the answer**, not a page — it has no `take` and needs none.
  A reviewer must not read `groupBy(...).length` as a DNC-01 violation, and the docblock must say so, in
  `ADR-079 §D3`'s vocabulary: this is a **head count**, not the length of a window.
- **G-TENANT: every one of the four aggregates carries `tenantId`.** An aggregate is a read like any other.
- Each KPI states its scope in the label or subtitle, per AC-5.

**G-PORTAL, measured, not assumed.** `GET /api/v1/teaching-assignments` has **exactly one** reader in `apps/web`:
`admin/assignments/page.tsx:29`. `admin/teaching-assignments/page.tsx` is a `redirect()` stub;
`teaching-assignments/actions.ts` is POST/PATCH/DELETE only; `TeacherAssignmentsPanel.tsx` receives its rows from
`GET /teachers/:id`, a different endpoint. The teacher, parent and student portals do **not** read it. G-PORTAL is
satisfied by walk, and the walk is reproducible: `grep -rn "v1/teaching-assignments" apps/web/src`.

## D5 — THE RATCHET (AC-6), and the census definition is the whole of it

Home `apps/api/src/shared/quality/page-window-derivation-gate.spec.ts`, shape taken from
`class-roster-size-derivation-gate.spec.ts` — **declining ceiling, residuals RECORDED, never allowlisted.**

- **R1 — no new hand-rolled parse.** Detector derived from the *idioms*, never from the nine paths:
  `parseInt(` within N chars of an identifier matching `/limit|offset|take|skip|page.?size/i`, and
  `DefaultValuePipe` paired with `ParseIntPipe` on a `@Query('limit'|'offset')`. **Tolerance zero outside
  `packages/contracts/src/pagination/`.**
- **R2 — the `findMany`-without-`take` census, as a declining ceiling.** ⚠ **Measure it in the gate's own code and
  freeze that number.** My independent walk of `apps/api/src` counts **301** `findMany` call sites, **244** without
  a `take`, of which **88** are inside `*.spec.ts` → **156** in production code. The brief says *158 of 216*. The
  numerator agrees within noise; **the denominator does not**, which proves the census is definition-sensitive
  (specs in or out? nested `findMany` inside an `include`? `_count`? the worker app?). A ceiling whose definition
  lives in prose is unfalsifiable. **The definition must be the executable code, the number must come from running
  it, and the docblock must state the four inclusion decisions in one line each.**
- **R3 — the web-side truth rule.** `.length` / `new Set(` over a variable bound from a `/teaching-assignments`
  response, in `apps/web/src/app/admin/assignments/page.tsx`. This is the `r3-paired-total` /
  `r3-truncated-total` family from `__fixtures__/calendar-window/` — **reuse those rule names.**
- **R4 — anti-vacuity floor.** The detector must find ≥ 1 `parseInt`-shaped hit somewhere in the tree and the
  census must be > 0, or the gate fails as vacuous.
- **R5 — falsifiability control.** `__fixtures__/page-window/` gets a `pre-fix-*.ts.txt` copy of a converted site
  and a `clean-surface.ts.txt`; the detector must go **red** on the first and **green** on the second, asserted in
  the same file. Precedent: `__fixtures__/calendar-window/` (9 fixtures) and `__fixtures__/pre-fix/`.

`PF-407`'s lesson applies generally even though `process.env.TZ` is not reached here: **each ratchet test must be
demonstrated capable of failing.** R5 is that demonstration; do not ship the gate without it.

## D6 — What is NOT done, and why (AC-7)

- **A2 / `PF-419`** — `messaging.service.ts:675-695` is already one grouped pass bounded by page size; the residual
  is row transfer where an aggregate would do. Recorded, not repaired: it is a *query-efficiency* change inside a
  service this slice does not otherwise touch, and mixing it in would put an unmeasurable performance claim inside
  a correctness diff.
- **A3 / `PF-420`** — `parent/dashboard/page.tsx:277-295` is capped at `FAMILY_OVERVIEW_MAX` (8) and parallelised.
  Removing the 2N fan-out needs a **new aggregate endpoint**, which is a slice, not a line.
- **`PF-421`** — the `AFFECTATIONS ACTIVES` label. There is no `active` predicate on `TeachingAssignment`; the
  label has been false since it was written, *independently of pagination*. Fixing the word is a product decision
  (rename the label, or add the predicate); recorded, deferred.
- **`PF-422`** — `GET /subjects` / `GET /classes` unbounded. D4 makes them harmless *for this KPI* by moving the
  set difference server-side, but the endpoints stay unbounded.
- **156 (or 158) `findMany` sites still carry no `take`.** The ceiling makes the class visible and shrinking. It
  exempts nobody. **`PF-50` is ADVANCED, NOT CLOSED**, and the traceability row must say so in those words with
  the residual named.

## D7 — No migration, no schema edit, no `prisma generate`

This slice writes no `schema.prisma` change, therefore needs no migration and no
`scripts/restore-drill-baseline.json` entry, and must not run `prisma generate`. **If the implementer finds
themselves writing a migration, stop — the design has drifted.**

---

## §6 — The four blocking concerns (why this is CONCERNS, not PASS)

1. **`subjectsWithoutTeacher` must be a server aggregate.** Treating AC-5's "may need its own aggregate" as
   optional turns this slice net-harmful. See §D4. **Blocking.**
2. **`packages/contracts` resolves to CJS `dist/` at runtime, and `dist/` is not rebuilt by the test runner.**
   `apps/api/jest.config.js` maps the specifier to SOURCE for tests; `package.json` `main` points at
   `./dist/index.js` for runtime. A new export added to contracts in this commit is therefore **green in jest,
   green in typecheck, and `undefined` at API boot** until `pnpm --filter @pilotage/contracts build` runs. That is
   the `landed ≠ ran` trap of run 93 in a new costume. **`@pilotage/contracts` build is a landing prerequisite and
   must be named as one in the story's evidence section.** Agents must not run it (GUARDRAILS §4) — the
   lock-holding orchestrator does. Corollary: controllers import the **package specifier**, never a relative path
   across the package boundary.
3. **The census definition must be executable code, not prose.** My count and the brief's disagree on the
   denominator (301/244/156 vs 216/158). See §D5 R2. **Blocking** — an unfalsifiable ceiling is worse than none.
4. **The `parseInt` → `z.coerce` acceptance change must be declared** (`PF-423`). It is not a default or cap
   change, so AC-2's letter does not catch it, but it is caller-visible. See §D3.

## §8 — The ledger, checked rather than assumed

**The ledger does NOT disagree, and saying so matters more than claiming a conflict.** Checked at authoring time:

- `docs/daily-improvement-v3/traceability/OPEN.md:121` already carries
  `| PF-50 unpaginated/fan-out hotspots | V3-E03 | S-E03-9 | open | — | — | G-TRUTH |`. The slice id is
  pre-allocated there, which is the documented source of slice ids for this epic
  (`PROGRESS.md` §2: *"Slice ids come from `OPEN.md`, not from a `tasks.md`"*).
- `docs/spec/features/v3-e03/PROGRESS.md` has **no authored story section** for `S-E03-9` — expected, since a slice
  authors its own section — and its closing tally lists `PF-50` among the findings *« jamais commencées »*. That is
  consistent with this slice, not in conflict with it.
- The only trailing `Next slice →` pointer in that file is a superseded one from run 82. It nominates nothing that
  competes with `S-E03-9`.

So the operator override is **confirmed by the ledger**, not merely privileged over it. The `OPEN.md:121` row must
be updated in place — status `open` → **`advanced`**, not `closed` (see the `Advances, does NOT close` header and
§D6).

## §9 — A standing warning from the previous slice, aimed at whoever implements this one

`PROGRESS.md` records, of the eighth contract module: *"la huitième story a dû arbitrer son propre foyer dans son
§D1 — puis se faire corriger au gate parce que l'ADR enregistrait l'option rejetée."* An ADR that documents the
home the implementer did **not** use is worse than no ADR, because it is a false record that reads as authoritative.

**Therefore: if the implementation deviates from §D1 or §D2, this ADR is wrong and must be edited in the same
commit — not left standing.** §D1 records `packages/contracts/src/pagination/` as the chosen home and the
hand-rolled discriminated-result resolver as the **rejected** alternative. If that inverts, invert this section too.

This is also the ninth contract sibling in a row to have adjudicated its own home in its own §D1. The recurring
cost is real and `PROGRESS.md` §4 names the fix: **`V3-E03` still has never had an `epic-spec` run.** This ADR
does not attempt one — a spec-kit is an `epic-spec` run, not a slice — but it adds the ninth data point to the
argument for scheduling one.
