# ADR-081 — A page envelope is ONE shape, declared once, VERIFIED by the client and DECLARED by the server

- **Status** Accepted (architecture ruling, `S-E03-11`)
- **Date** 2026-08-28
- **Story** `S-E03-11` — the page envelope becomes a CONTRACT, and the client stops ASSERTING the shape it reads
  (`docs/daily-improvement-v3/stories/S-E03-11.md`)
- **Epic** `V3-E03` — Canonical truth and query contracts (layer L0), twelfth slice
- **Advances, does NOT close** `PF-50` (unpaginated / fan-out hotspots) through its named residual **`PF-427`**
  (*"`api<T>()` is an unvalidated cast, so a server payload and the page that reads it can disagree silently while
  BOTH sides typecheck green"*). Eleven envelope reads were measured; four convert. A `closed` row here would be
  the `closed ≠ fixed` error recorded at run 93.
- **Raises** `PF-428` … `PF-433` (see §D6)
- **Related** `ADR-080` (canonical page **window** — this ADR is its response-side sibling and reuses its
  `ResultTotal` brand rather than redeclaring one) · `ADR-079 §D3` (two questions split by *name*, the illegal sum
  forbidden in the type system) · `ADR-078 §D1` (the home ruling for a pure cross-app derivation) ·
  `ADR-071` / `PF-05` (a failed read is never rendered as a fact about the school) · `ADR-041 §D4` (registry
  entry) · `ADR-067 §D6` (one-way-ratchet house style) · `DNC-01` (a page length may not wear the label of a
  total) · `DNC-08` (a zero rendered without having read) · `DNC-10` (no env-var escape hatch in a gate) ·
  `GUARDRAILS.md` §1 (children's data), §2 (ADR rule), §4 (no agent builds)

---

## Verdict

**Accepted — with the deviations of §D5 and the open class of §D6 stated rather than smoothed over.**

No schema change, no migration, no new dependency, no new package, no permission or guard metadata change, and —
deliberately — **no byte of any response payload changes**. What changes is only what each side *declares* and
what the client *checks*.

Four things in this slice are genuinely new architecture, which is why GUARDRAILS §2 makes this ADR mandatory:

1. a canonical **response**-shape contract homed in `packages/contracts` (§D1);
2. a **second HTTP entry point**, `apiEnvelope()`, that PARSES where `api()` ASSERTS (§D2, §D3);
3. a new error class, `ResponseShapeError`, deliberately **outside** the `ApiError` hierarchy, with a propagation
   contract that the rest of the portal already depends on without knowing it (§D3);
4. `unvalidatedItem<T>()` / `requiredKey<T>()` — typed-but-unvalidated members added to the *shared* contracts
   package (§D3).

The single most important sentence in this ADR: **a naïve implementation of this slice would have broken
`/admin/audit` in the exact way the slice exists to prevent** — see §D3.

---

## D1 — HOME: the envelope lives in `packages/contracts/src/pagination/`, not `apps/api/src/shared/`

A page envelope is a **response contract**. Its meaning is shared between the server that writes it and the client
that reads it. Putting it where `apps/web` cannot read it would leave the two halves as **two hand-maintained
lists** — the drift this house has already measured and named (`project_paired_lists_drift`), and precisely the
defect §D2 recounts.

Measured, not assumed:

- `apps/web/src` imports `@pilotage/contracts` in **66 places across 51 files**;
- `apps/web`, `packages/contracts` and `apps/api` all pin **`zod ^3.23.8`**, so one schema value is readable by
  both sides;
- the module is **pure** — no `new Date(`, no `Date.now(`, no `process.env`, no Nest import, no Prisma import —
  which is what makes `packages/contracts` a legal home at all.

The house rule therefore stands unchanged, and this is its fourth application after `ADR-078 §D1`, `ADR-079` and
`ADR-080 §D1`:

> **pure derivation → `packages/contracts/src/<domain>/` ; Prisma adapter → `apps/api/src/shared/<domain>/`.**

Files:

    packages/contracts/src/pagination/page-envelope.ts   ← the factory + the server-facing type (NEW)
    packages/contracts/src/pagination/index.ts           ← one re-export line (EDIT, additive)

`packages/contracts/src/index.ts:14` already re-exports `./pagination`, so no root-barrel edit was needed.

**Operational consequence, and it is a hard precondition rather than a code defect.** `packages/contracts` builds
to CJS (`main → dist/index.js`) while `types → ./src/index.ts` (GUARDRAILS §2 forbids reverting that). TypeScript
therefore resolves the new contract **from source** and typecheck goes green *before* `dist/` contains a single
line of it. Four admin pages now import `pageEnvelope` / `requiredKey` / `unvalidatedItem` as **values**. Until
the orchestrator's single `pnpm build` runs, those imports are undefined at runtime. **This slice's value is
unproven until that build runs** — it is the same "both halves typed green" class the slice exists to close,
reproduced one layer down, and it is stated here so no reader mistakes a green typecheck for a working page.

---

## D2 — TWO FACES, because a brand cannot cross the wire

`page-window.ts` already says it in prose: *"la marque ne survit pas au fil"* — `JSON.parse` returns bare
`number`s. This module does not pretend otherwise. It declares **both faces in one file**, which is what stops
them becoming two lists:

| Face | Symbol | `total` is | Read by |
|---|---|---|---|
| Wire | `pageEnvelope(item)` — a zod factory | a bare `number` (`z.number().int().nonnegative()`) | the client, which **parses** |
| Server | `interface PageEnvelope<TItem>` | `ResultTotal`, **imported** from `./page-window` | the handler, which **declares** |

`ResultTotal` is imported and never redeclared. That is the G-DNC half of the slice: **`total: data.length` does
not compile** in a handler, and the only paths to the field are `resultTotal(count)` or `distinctGroupCount()`
(`ADR-080 §D2`, mechanism inherited from `ADR-079 §D3`).

The two faces are joined by a **compile-time bridge** (`PageEnvelopeBridge`): the parsed wire type and the
*unbranded* projection of `PageEnvelope<T>` must remain mutually assignable. Editing one face and forgetting the
other **fails to compile in `packages/contracts`**, before a single call site has been read. It is written as two
one-directional assertions rather than one mutual constraint, because the mutual form is circular and TypeScript
rejects it (TS2313).

**The defect this closes, measured and not hypothesised.** In run 94 the API emitted `totals` while
`/admin/assignments` read `summary`. **Both halves typechecked GREEN**, because `api<T>()` ends with
`return (await res.json()) as T` — `T` is what the call site wrote by hand, and nothing compared it to what the
server sends. The four KPIs would have rendered as em dashes and the coverage panel as permanently unavailable —
i.e. run 94 would have shipped a truth defect *worse* than the one `PF-50` names, in the act of closing it. A
human comparing two files caught it. No test did.

The server side is now annotated on both handlers named by the story:

- `teaching-assignments.controller.ts:189` `list(…)` gains
  `Promise<TeachingAssignmentsListEnvelope>` — `PageEnvelope<unknown>` extended with `limit`, `offset`, `totals`,
  `coverage`. Renaming `totals` to `summary` **here no longer compiles**. That is AC-4's negative experiment, and
  it is the point of the annotation.
- `analytics.service.ts:193` `AuditListResult` stops being an independent transcription and is **re-expressed** as
  `PageEnvelope<AuditListRow> & { kpis; filters }`. This is a **re-homing**, not an addition: `auditList()` already
  declared `Promise<AuditListResult>`, so the real defect there was never a *missing* type but a **second
  hand-written one** (recorded as `PF-430`). Its construction site now goes through `resultTotal(count)`.

**Item type on the server handler is `unknown`, deliberately.** Freezing the four nested Prisma `include`
payloads into a declared contract would turn every relation change into a declared contract break while protecting
nothing — no TypeScript consumer reads that row type; `apps/web` writes its own. The **frame** is the contract.

---

## D3 — THE STRIP HAZARD: the obvious implementation breaks the page it is fixing

**This is the section a future reader will need most.**

A zod `z.object` **strips unknown keys by default.** Parsing the audit payload through a bare
`z.object({ data, total })` would **delete `kpis` and `filters` at runtime while every type stayed green** — four
amber "Indisponible" KPI cards on `/admin/audit`, visually indistinguishable from an API outage, on the exact page
whose extra keys are the reason `AuditResponse` had extra keys at all.

Executed in a bare node process against the installed zod (3.25.76) — **red-before / green-after, not a
hypothesis**:

    z.object({data,total}).parse(auditPayload)                 → {"data":…,"total":2}                  ← kpis GONE
    z.object({data,total}).passthrough().parse(auditPayload)   → …,"kpis":…,"filters":…,"surprise":true
    …passthrough().extend({kpis,filters}).parse(auditPayload)  → idem — `.extend()` PRESERVES passthrough
                                                                 (`ext._def.unknownKeys === 'passthrough'`)

**Ruling: the frame is `.passthrough()`, and `.extend()` inherits it.** Verified rather than assumed, because an
`.extend()` that reset the unknown-key policy would have reintroduced the hazard through the exact door
extensibility opens. Key-set equality is asserted over the **whole envelope**, including a key the schema does not
know about — a test that listed the keys it expected would have been a third hand-maintained list, i.e. this slice
repeating its own defect.

Passthrough is **not** a relaxation: **presence of declared keys is still enforced**, which is exactly how the
run-94 rename becomes a rejection (`safeParse` → `issues[0].path === ['totals']`, verified).

### D3.1 — THE ITEM IS NOT THE CONTRACT — THE FRAME IS

Deep-parsing every row would turn any mis-transcribed nullability into a **dead page**. `/admin/audit` is the
append-only RGPD surface, and it renders correctly today rows whose client-side type has never been confronted
with the server. So the contract covers the **frame** — `data` is an array, `total` is an integer ≥ 0, declared
keys are present — and `unvalidatedItem<T>()` exists to **type** a row without **verifying** it. A caller who
wants deep validation simply passes their own item schema: the factory does not forbid it, it does not impose it.

`data` carries **no minimum**. A `.min(1)` here would kill `/admin/students` for a school with no enrolled
pupil — DNC-08 dressed up as validation.

### D3.2 — `requiredKey<T>()` exists because `z.unknown()` is OPTIONAL

Measured against the installed zod, not assumed:

    z.custom().isOptional()   → true
    z.unknown().isOptional()  → true

A key whose schema is "optional" in zod's sense is an **optional key of the object**. So with a bare
`z.custom()` extension:

    frame.extend({ totals: z.custom(), coverage: z.custom() })
         .safeParse({ data: [], total: 0, summary: {}, coverage: {} })
      → success: TRUE                                        ← `totals` ABSENT, ACCEPTED

That is: **the run-94 rename would have survived the contract written to catch it.** `requiredKey<T>()` adds a
`.refine` rejecting `undefined`, which makes `isOptional()` false and the key mandatory:

    …extend({ totals: requiredKey(), … }).safeParse(samePayload)
      → success: FALSE, issues[0].path === ['totals']

It verifies **presence only** — nothing about the value (§D3.1). **Do not "simplify" it to `z.unknown()`.**

### D3.3 — `ResponseShapeError` is deliberately NOT an `ApiError`

Five of the seven envelope-reading files still carry the local copy of `safe()` that `PF-05` named:

    catch (err) { if (err instanceof ApiError) return null; throw err; }

Had a parse failure been an `ApiError`, those `safe()` copies would have **swallowed it into `null`**, and the page
would then have rendered its "reading unavailable" state — amber KPI cards, em dashes. That is **a contract break
disguised as an API outage**: a failure presented as a fact about the school, the deception `PF-05`, `ADR-071` and
G-TRUTH exist to forbid, and *visually identical to the run-94 near-miss the slice claims to close*.

Because `safe()` **re-throws** anything that is not an `ApiError`, a distinct class propagates to the portal's
**existing** error boundary (`apps/web/src/app/admin/error.tsx`). That choice — and only that choice — is what
makes it safe to leave the five `safe()` copies alone, which this slice's scope discipline requires (converting
them to `read()` belongs to the `PF-05` class).

Three further properties, all required by AC-3:

- **Named** — a stable, written `name = 'ResponseShapeError'`, never `constructor.name` (minification renames it).
- **Diagnosable without leaking** — the message carries the **route template** (`/api/v1/analytics/audit`, never
  the query string, whose filter values can designate a child) and the **zod issue paths, codes and expected
  types**, all three of which come from **our schema**, never from the response. zod's `received` — which can
  carry a payload fragment such as a guardian's email on `data.3.guardians.0.email` — has **no field to live in**;
  it is structurally absent from `ResponseShapeIssue`. GUARDRAILS §1: this platform handles children's data, and a
  shape error is not a licence to log a payload.
- **Never a silent fallback** — no `?? []`, no `catch { return empty }`. An envelope quietly replaced by an empty
  one is DNC-08.

**The price, declared rather than hidden.** `PortalErrorState` says *"the problem may be temporary — try again in
a moment"*, which is **false** for a contract break: retrying cannot succeed. And in production Next masks a
server-component error message and forwards only a `digest`, so the per-key detail never reaches the browser —
which is why the detail goes to the **server log**, where it is actually readable. Both are real; neither is fixed
here, because fixing them would mean inventing an error UI, which AC-3 forbids ("the *existing* error surface").
They are recorded.

**Per-page error path, stated (AC-3 requires it):**

| Page | Call site | Path a `ResponseShapeError` takes |
|---|---|---|
| `/admin/audit` | inside `safe(...)` | re-thrown by `safe()` → `app/admin/error.tsx` |
| `/admin/exports` | inside `safe(...)` | re-thrown by `safe()` → `app/admin/error.tsx` |
| `/admin/assignments` | inside `safe(...)` | re-thrown by `safe()` → `app/admin/error.tsx` |
| `/admin/students` | **not** wrapped in `safe()` | propagates directly → `app/admin/error.tsx` |

### D3.4 — `apiEnvelope()` is additive; `api()` does not change

`api()`'s signature is untouched for the other ~205 typed call sites: converting them is not this slice and would
produce an unreviewable diff. `apiEnvelope(schema, path, init)` fetches through the same machinery and then
**parses**.

The **204 case is handled explicitly**, not by accident: `api()` returns `undefined as T` on 204, and
`schema.safeParse(undefined)` yields a single empty-path issue — the least diagnosable message for the most
mundane case. It is named instead.

**PF-133 checked, not assumed.** `api-client.ts` is a **server module** (`next/headers`, `@/auth`), so a
`'use client'` file must never import a *value* from it. All four converted call sites are server components. The
schemas live in `packages/contracts` (isomorphic), and `response-shape-error.ts` is a leaf module importing only a
zod **type** — so `AssignmentsManager.tsx` (`'use client'`) continues to import types only.

---

## D4 — SEQUENCING: the boundary is fixed now, while the class is eleven

`PF-50`'s other named residual is **`PF-426`**: *151 of 210 `findMany` call sites in `apps/api/src` carry no
`take`*, frozen by `page-window-derivation-gate.spec.ts` and meant to shrink slice by slice.

**Burning down a `PF-426` site IS the act of converting a bare array return into a `data`+`total` envelope.** So
every future `PF-426` slice **manufactures a new occurrence of `PF-427`**. Fixing the boundary now, while the
class is eleven, is what makes the remaining ~150 conversions safe. Fixing it later means fixing ~150
hand-written copies — and run 94 has already demonstrated, **on a sample of one**, that the per-conversion failure
rate is not zero.

That is the whole argument for doing this before, not after.

---

## D5 — THE CENSUS (AC-5), and why BOTH ratchet rules ship as ceilings

The ratchet is `apps/api/src/shared/quality/page-envelope-boundary-gate.spec.ts`. It lives under `apps/api`
because **`apps/web` has no unit-test runner at all** (only Playwright) — the house rule for every cross-cutting
gate. It **walks files from disk** and imports nothing from `apps/web`, which keeps it clear of the
`rootDir`/TS6059 trap.

### The four inclusion decisions are CODE, not prose

The lesson of `ADR-080 §6.3`, where a prose census produced three different denominators. The brief said the class
was **four** and that **198** `api<…>` call sites existed; the walker measured **eleven** and **208**. Two
different denominators prove a prose census is unfalsifiable, so the definition **is the code**:

1. **Root** — `apps/web/src` only for R1/R2. `packages/` is walked only for R3. `apps/api` declares its envelopes
   in server TypeScript, governed by `PageEnvelope`, not by this ratchet.
2. **Exclusions** — `*.spec.*`, `*.test.*`, `*.d.ts`, `__fixtures__`. A ratchet that reddens on every new test is
   relaxed within two runs.
3. **Unit** — for R2, one `api<…>(` **call expression**. Not a textual occurrence: `grep 'api<'` counts comments
   and returns 211 where the classifier returns 208.
4. **"Envelope"** — a type text carrying **both** a `data` member and a `total` member, **optional included**
   (`total?` is `parent-children.ts`'s form; excluding it would have erased the only non-admin occurrence).

### ⚠ AC-5 SPECIFIED R1 AS TOLERANCE ZERO. IT SHIPS AS A CEILING OF 1.

**This is a deviation from the acceptance criterion, and it is recorded here because a code comment is not where a
deviation from a written AC belongs.**

`page-envelope-boundary-gate.spec.ts:143` ships `R1_CEILING = 1`, not `0`. The reason is that **the brief's
premise was falsified by measurement**: AC-5 assumed four named declarations, all admin, and that "no other portal
reads this shape". The walker found **five**, and the fifth is
**`apps/web/src/lib/parent-children.ts:44` — a PARENT-portal envelope**, read by roughly a dozen parent pages,
whose `total?` is *optional* while the API always sends it. Converting it would touch the parent dashboard's hot
path (< 2 s, GUARDRAILS §1) and is not in this slice.

It is **counted, never allowlisted** — the convention of `class-roster-size-derivation-gate.spec.ts:33-44` — and
recorded as a finding (§D6). Freezing R1 at zero would have required either an out-of-scope conversion on the
parent hot path or an allowlist, and `academic-year-resolution-gate.spec.ts:20-32` names and **forbids** both
exits.

**R2 ships as a ceiling of 6** for the same reason: five inline casts in `admin/alerts/page.tsx`
(`:119,126,133,140,150`) and one in `admin/users/page.tsx:38`. Tolerance zero on day one would have demanded six
out-of-scope conversions or an allowlist — the same two forbidden exits.

### A ceiling alone is not enough, and that is the point

A ceiling of 5 would stay satisfied if one converted four sites and wrote four **new** ones elsewhere. Each rule
therefore also carries a **closed path set**: any residual must be one of the already-censused files. A fresh
declaration reddens **even at constant count**. That is what *"no NEW hand-written shape"* means, and it is the
part that makes the ratchet one-way.

### Frozen numbers, and the tree they were frozen on

Measured **after** the `apps/web` half landed in the same checkout, as AC-5 requires — never on the backend half
alone:

| Rule / floor | Pre-diff | Post-diff (frozen) |
|---|---|---|
| R1 named declarations | 5 | **1** (`R1_CEILING`, closed set = `lib/parent-children.ts`) |
| R2 inline `api<{…data…total…}>` casts | 6 | **6** (closed set = `admin/alerts`, `admin/users`) |
| R3 declaring home | 1 | **1** (path equality on `packages/contracts/src/pagination/page-envelope.ts`) |
| files walked in `apps/web/src` | 382 | floor **300** |
| typed `api<…>(` call sites | 208 | 205, floor **190** |
| bare `{ data }` casts (no `total`) | 88 | floor **50** |
| `apps/web` files delegating to the contract | 0 | **4**, floor 4 |

**Anti-vacuity floors are mandatory and plural.** A walker that finds nothing must go **RED**, not green. The
delegation floor is the one that matters most: without it, simply *deleting* the four declarations would satisfy
R1. The `api<…>` floor makes "0 envelope casts" distinguishable from "0 `api` calls seen". The bare-`{data}`
floor proves the type-argument classifier works independently of the census it freezes. Every floor is `>=` with
a stated margin, never an equality at the measurement.

**Falsifiability is demonstrated, not claimed.** The fixtures under `__fixtures__/page-envelope/` run through the
**same** classifier as the tree: the ratchet is asserted to redden on `pre-fix-reintroduced-envelope` (both forms
of the defect in one file) and to stay green on `clean-surface`. A ratchet nobody has watched turn red is a
ratchet nobody knows is wired up.

**`MANUAL_ALLOWLIST` exists, is named, and ships EMPTY** — an assertion checks it. No environment variable, no
`NODE_ENV`, no `SKIP_*` / `ALLOW_*` (DNC-10). The required helpers are imported without guards: if they
evaporate, the suite must die at load rather than degenerate into "nothing to check" (DNC-08).

---

## D6 — What is DELIBERATELY left open

**Nothing below is fixed by this slice. Each is named so a later reading does not mistake this ADR for the closure
of the class.**

| Id | P | Left open |
|---|---|---|
| `PF-427` | P2 | **The envelope class itself. ADVANCED, NOT CLOSED.** Eleven reads measured, four converted; seven remain. |
| `PF-428` | P2 | **Six envelope reads still go through an inline `api<{ data …; total … }>` cast** — `admin/alerts/page.tsx:119,126,133,140,150`, `admin/users/page.tsx:38`. Frozen by R2 at 6, decreasing. Counted, never allowlisted. |
| `PF-429` | P2 | **88 inline `api<{ data: X[] }>` bare-list casts** across admin, teacher and parent — the unvalidated-cast class one shape down: no `total` to disagree about, same "server renamed a key, client renders nothing" failure mode. No ratchet rule this slice; naming it is the point. |
| `PF-430` | P3 | **The brief's claim that "the envelope handlers declare NO return type at all" is false for the audit handler.** `analytics.service.ts:3813` already declared `Promise<AuditListResult>`. The real defect there was a **second** hand-written type, not a missing one — subtler and better camouflaged. Recorded so a later slice does not re-derive it. |
| `PF-431` | P2 | **`GET /api/v1/users` and the alerts list endpoints return `data`+`total` with no declared server return type** — the API-side twin of `PF-428`. Converting the six client casts without this would leave the same two-lists problem one layer down. |
| `PF-432` | P3 | **`pageWindow` caps `limit` but not `offset`** (`min(0)`, no `.max()`), and the module is now canonical for thirteen endpoints. `?offset=1e21` is accepted and reaches Prisma. Not a regression, but this is now the single place the hole can be closed once. |
| `PF-433` | P3 | **INHERITED, UNVERIFIED, NOT THIS SLICE'S — but do not let it be blamed on this slice.** Run 94's land pass recorded `apps/api/src/shared/pagination/page-window.spec.ts:505` as RED on the delivered tree: the `AC-8 / G-TENANT` assertion expects seven reads, the handler emits eight; all eight carry `tenantId`, so it is a suite not re-run, not a leak. The remedy is to **derive** the read count from the mocks — **never** to change the literal to `8`. |

Also left open, by design:

- **The ~205 non-envelope `api<…>` call sites, and the fact that `api()` itself still ASSERTS.** Its signature is
  unchanged. `apiEnvelope()` sits beside it; nothing forces migration yet, and forcing it in one diff would make
  the change unreviewable.
- **`parent-children.ts`'s optional `total?`** — the same `/students` route is read in two hand-written shapes by
  two portals. Parent hot path, out of scope (§D5).
- **`PortalErrorState`'s "try again in a moment"**, false for a contract break, and Next's production masking of
  server-component error messages (§D3.3).

### ⚠ Numbering divergence, stated rather than smoothed over

The register above is the story's (`S-E03-11 §11`), and is the one `OPEN.md` must be written from. **Two shipped
docblocks disagree with it and with each other**, and must be reconciled before the land pass writes `OPEN.md`:

- `packages/contracts/src/pagination/page-envelope.ts` (`PAGE_ENVELOPE_DEFINITION.inheritedFindings` and the
  comment above it) assigns `PF-428` to `users.controller.ts:40` (`total: items.length`), `PF-429` to
  `parent-children.ts`, `PF-430` to "~9 other API-side emitters", `PF-431` to the 88 bare casts, and `PF-433` to
  `analytics.service.ts:3961`;
- `apps/api/src/shared/quality/page-envelope-boundary-gate.spec.ts` agrees with the story on `PF-428` (the six
  inline casts) but assigns `PF-429` to `parent-children.ts`.

Three lists of the same findings under three numberings is `project_paired_lists_drift` reproduced in the very
slice that exists to remove it. **Reconcile onto the story's register; do not invent a fourth.**

---

## D7 — No migration, no schema edit, no `prisma generate`, no payload change

Nothing in this slice touches `schema.prisma`, no query moves, and **not one `where`, `take` or `skip` changes**.
`PF-426`'s 151 sites are untouched. The API sends exactly what it sent before; only its *declared type* and the
client's *checking* change. A byte-level change to any response payload would be a **defect** in this slice, not a
feature of it.

---

## §8 — Evidence, graded honestly

**Tier B.** Red-before / green-after executable spec (`apps/api/src/shared/pagination/page-envelope.spec.ts`) +
the triggered gates (G-TRUTH, G-PORTAL, G-DNC) + a one-way ratchet + this ADR.

**G-AUTHZ and G-TENANT are NOT triggered**, by design — no permission, no guard, no `tenant_id` predicate, no
response code moves. Saying so is better than claiming evidence nobody produced.

**NO LIVE PROBE WAS RUN, AND NONE MAY BE CLAIMED.** Docker Desktop has failed to start for the **sixth**
consecutive run and local `pilotage@5432` is **empty** (0 tenants / 0 schools / 0 students). Every zod behaviour
quoted in §D3 was executed **in a bare node process**. That is proof of **mechanism**, never proof of
**deployment** (`project_proof_on_scratch_is_not_the_target`). No line of this ADR may be read as "verified against
the running stack."

Add to that the §D1 build precondition: until `packages/contracts` is rebuilt, the four converted pages import
values that do not exist in `dist/`. **The mechanism is proven; the deployment is not.**
