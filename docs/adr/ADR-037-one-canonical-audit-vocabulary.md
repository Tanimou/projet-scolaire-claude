# ADR-037 — One canonical audit vocabulary, declared once, in `packages/contracts`

- **Status**: Accepted
- **Date**: 2026-08-09
- **Slice**: S-E04-4 (epic V3-E04 — audit trail and governance surfaces)
- **Finding**: PF-32 (vocabulary half) · **Gates**: G-TRUTH, G-PORTAL, G-DNC · **DNC**: DNC-08, DNC-09
- **Supersedes nothing.** Extends ADR-002 (tenant scoping), ADR-003 (four portals), ADR-036 (audit
  provenance). Transcribes the ruling already recorded in
  `docs/spec/features/v3-e04/data-model.md` §2.3–§2.4 (D-12…D-17); it invents nothing beyond it.
- **Amended by `S-E04-11`** (2026-08-10) — **D6** (the `audit_csv` column list is append-only, indices 0..9
  frozen) and **D7** (the CSV formula-injection neutraliser), which together **scope D4's « verbatim »**.
  See the amendment at the end of this file. `S-E04-11` is this file's first amender and sets the
  reservation the original header omitted: **a later amender reserves D8 onward.**
- **Amended by `S-E05-1`** (2026-08-10) — **D8** (the CSV formula-injection neutraliser has ONE home,
  `packages/contracts/src/security/csv-injection.ts`, and the single-home property is held by
  `scripts/csv-escape-check.js` rather than by review), which **relocates and widens D7 without changing
  its content**. D8 also corrects one claim `S-E04-11` made in passing, and draws the
  presentation-vs-transport boundary that keeps two `apps/api` CSV writers deliberately un-neutralised.
  See the second amendment at the end of this file. `S-E05-1` takes **D8** and reserves **D9 onward**.

---

## Context — three populations, three vocabularies, no agreement

`audit_log.action` and `audit_log.resource_type` are `text` columns, and by 2026-08 three populations
disagreed about what belongs in them:

| Population | What it writes | Where |
|---|---|---|
| The 54 pre-V3 rows | **French display strings** in structural columns — `Suppression`, `Élève`, `Résultats` | `apps/api/prisma/seed-demo.ts` STEP 13 |
| The API + `imports-core` call sites | **machine codes** — `role.delete`, `user_profile`, `calendar_event` | `apps/api/src`, `packages/imports-core/src` |
| The admin label map | 13 `resource_type` keys, **7 of which nobody writes**, and missing `calendar_event` | `apps/web/src/app/admin/audit/audit-labels.ts` |

`analytics.service.ts` then matched a **fourth** set straddling both:
`action: { in: ['delete', 'Suppression', 'Révision', 'revise'] }` — of which exactly **one** string can match
any row that exists — and `action: { contains: 'Export' }`, a substring match over a free-text column.

A governance surface that shows a DPO an interpretation it cannot justify is worse than one that shows
nothing. This ADR records the five decisions taken to end that.

---

## D1 — The vocabulary lives in a NEW `packages/contracts/src/audit/` module, not in `enums/index.ts`

`packages/contracts/src/enums/index.ts` is a flat list of value sets: no labels, no resolution behaviour.
The audit vocabulary is a *code → French label* mapping **plus** classification behaviour **plus** a
frozen legacy-alias table. Appending it there is how `PORTALS` came to be read as "the list of portals"
by a login DTO *and* by an audit facet — two different questions sharing one array (see D2).

```
packages/contracts/src/audit/
  vocabulary.ts  — AUDIT_RESOURCE_TYPES, AUDIT_ACTIONS, AUDIT_ACTION_FAMILIES, AUDIT_PORTALS,
                   AUDIT_CRITICAL_ACTIONS, AUDIT_EXPORT_ACTIONS, AUDIT_LOGIN_ACTIONS,
                   LEGACY_AUDIT_*_ALIASES
  labels.ts      — classifyAuditAction / classifyAuditResourceType / classifyAuditPortal,
                   LEGACY_FORMAT_MARKER, UNKNOWN_FORMAT_MARKER
  index.ts       — re-export barrel only; it declares nothing
```

The module is **pure**: no Prisma, no Nest, no `node:*`, no new dependency. It is consumed on both sides
of the Next 15 server/client boundary and by CJS Node.

Wired **both** ways, because one without the other breaks a consumer: `export * from './audit'` in
`src/index.ts`, and an `"./audit"` entry in the `exports` map mirroring `./enums`. All four consumers
import the **bare** specifier `@pilotage/contracts` — that is the only form used anywhere in the repo
today; the subpath entry exists for parity, not because anything relies on it.

**Three consumers, not two.** The third is
`apps/worker/src/modules/exports/generators/audit-csv.generator.ts` — the file a DPO hands to a
regulator. A web+API fix would have left the regulator-facing artefact drifting.

**The descriptor carries no `parentVisible` field.** `data-model.md` §2.3 marks it "réservé — aucun code
ne le lit dans cet épic". A field with no reader is dead weight in a contract and invites a second,
contradictory reading later. The parent transparency panel is out of scope; when it lands it adds the
field with its reader in the same commit.

---

## D2 — `AUDIT_PORTALS` has FOUR members; `PORTALS` in `enums/index.ts` is deliberately NOT widened

`packages/contracts/src/enums/index.ts:3` declares `PORTALS = ['admin', 'teacher', 'parent']`, and
`packages/contracts/src/dto/auth.ts:10` consumes it as `portal: z.enum(PORTALS)` — **for login**.
Adding `'student'` there would silently make `student` a legal login portal. That is a real authorisation
change, it is out of scope, and it is not what "the audit vocabulary must cover four portals" asks for.

So the audit vocabulary declares its own four-valued `AUDIT_PORTALS` with French labels
(`Admin` / `Professeur` / `Parent` / `Élève`). The non-widening is **tested, not assumed**:
`audit-vocabulary-gate.spec.ts` V-6 asserts `PORTALS` is still exactly three and that `dto/auth.ts` still
validates login against it.

There are now **three** live portal declarations in the repository, and this is stated plainly rather
than quietly tolerated:

| Declaration | Members | Purpose | May it import the others? |
|---|---|---|---|
| `packages/contracts/src/enums/index.ts` `PORTALS` | 3 | **login authority** (`dto/auth.ts`) | — |
| `apps/web/src/lib/portals.ts` `PORTAL_IDS` | 4 | Edge-runtime routing; **deliberately import-free** (its own docblock forbids importing contracts: Edge bundle, CJS `dist/`) | **No.** Drift is caught by a static guard, never by a runtime import |
| `packages/contracts/src/audit/vocabulary.ts` `AUDIT_PORTALS` | 4 + labels | audit display vocabulary | — |

**PF-101 owns the reconciliation.** This slice does not attempt it.

**Measured and deliberately not fixed:** no writer emits `portal: 'student'` today —
`deriveAuditProvenance` (`apps/api/src/shared/audit/provenance.ts`) maps three realm roles to three
portals. The label exists and renders; **no writer was fabricated** to make the fourth portal reachable.

---

## D3 — A Prisma enum for `action` / `resource_type` is REFUSED

`action` and `resource_type` stay `text`. Reasons, in order of weight:

1. **The 54 legacy rows carry values no enum would contain.** An enum migration either fails on them or
   requires rewriting them — and rewriting an append-only audit trail inside the epic that installs
   tamper-evidence over it is self-defeating (D4).
2. **An enum makes adding an audit code a migration.** The vocabulary grows with every audited feature;
   a schema change per code guarantees the next author writes an undeclared string instead.
3. **The completeness property we actually want is not "the column is constrained" but "every written
   code has a label, and every label has a writer".** That is checked in both directions by an AST
   extractor over the sources (`audit-vocabulary-gate.spec.ts` V-1), which an enum would not give.

**Consequence:** G-MIGRATION does not trigger for this slice. `schema.prisma` is untouched and there is
no migration.

---

## D4 — The legacy rows are NEVER updated; they are MARKED, and an unknown code is returned verbatim

**No `UPDATE`, no `DELETE`, no backfill on `audit_log`.** The trail is append-only; correcting it would
destroy the property the epic exists to establish.

Resolution has **three** states, not two:

| `vocabulary` | Condition | Rendering |
|---|---|---|
| `canonical` | the code is declared | French label, **no marker** |
| `legacy` | the value is in the frozen alias table (the 5 French actions + 8 French resource types the 54 rows carry) | value **as written** + « Format hérité » |
| `unknown` | neither | value **verbatim** + « Code non répertorié » |

Three rather than two, because « Format hérité » asserts *this predates the vocabulary*. A code a
developer adds next month and forgets to declare is not historic; marking it so would hand a DPO an
invented provenance — the exact class of error this epic removes. `unknown` is the state the completeness
guard goes **red** on, not a bucket to file the problem in.

**Behaviour change, deliberate.** `humanizeResourceType` used to de-underscore and capitalise an
unrecognised code (`calendar_event` → « Calendar event »). That fallback is **removed**: a guessed label
is indistinguishable from a canonical one, and it is precisely what hid `calendar_event`'s absence from
the map for as long as it did. `classifyAudit*` now returns `label === code`, verbatim, and the **marker**
carries the "we do not know this" signal.

**DNC-08 posture, applied to data.** An unclassifiable value is never dropped from a facet list, never
relabelled into a generic bucket (`Inconnu` / `Autre` / `N/A` appear in none of the three consumers),
never swallowed by a `try/catch` around a resolver (the resolvers are total functions and cannot throw),
and appears — visibly `unknown` — in the CSV a regulator reads.

**DNC-09, same section because it is the same posture.** « Connexions admin » counted
`action: { contains: 'login' }`. No call site writes any authentication action and no legacy row contains
the substring, so the card could only ever read `0`. Pointing it at an empty `AUDIT_LOGIN_ACTIONS` would
convert a broken card into a *canonically* broken one. The query is therefore **skipped**, the KPI is
`number | null`, and the page renders « Non instrumenté ». Instrumenting login is a new privileged write
path and belongs to a later slice. Removing that query also removed the last `portal: 'admin'` literal in
`apps/api/src`; `audit-provenance-gate.spec.ts`'s corresponding case was **inverted in the same diff**
with the reason written in, never deleted or skipped.

**The seed keeps exactly three French rows**, in a named `legacyFormatFixtureRows` block. Without them a
fresh machine cannot demonstrate the « format hérité » rendering (AC-4) or the legacy KPI alias matching
(DNC-09) at all. They are a fixture, not a template; the gate asserts there is no fourth.

---

## D5 — `packages/contracts` stays CJS-built, and `contracts/dist` is a build prerequisite of both apps

`packages/contracts` builds to CJS (`main → dist/index.js`, GUARDRAILS §2). `apps/api` and `apps/worker`
**value-import** the audit resolvers at runtime — the worker generator does so at module load, so a
missing or stale `dist/` fails at boot rather than halfway through a regulator's export.

Two consequences, stated so neither is discovered later:

1. **Landing prerequisite.** `pnpm --filter @pilotage/contracts build` must run before the apps run. CI is
   covered by `turbo.json`'s `test: { dependsOn: ["^build"] }`; the local routine is covered by the
   orchestrator's single lock-held `pnpm build`. No agent builds.
2. **Tests read the SOURCE, not `dist/`.** `scripts/test-ratchet.js` spawns jest directly with
   `cwd: appDir`, bypassing turbo, and `dist/` is git-ignored. Both `apps/api/jest.config.js` and
   `apps/worker/jest.config.js` therefore map `^@pilotage/contracts$` to
   `packages/contracts/src/index.ts`. Without that mapping a spec exercising a symbol added to contracts
   in the same commit reads `undefined` from a dist built before it: green typecheck, `TypeError` at
   runtime, and the tempting misdiagnosis is "the new export is wrong". Runtime consumers keep the
   package specifier.

---

## Consequences

**Positive.** One declaration, three consumers, no local copies — enforced by a guard stated over the
*shape* of a code→label association rather than over an identifier name (a name-based guard is what
`S-E06-5` measured as useless). Completeness is checked in **both** directions by an AST extractor that
re-derives the written set from source on every run, so a new audit code without a label is a red test,
and a label nobody writes is also a red test.

**Negative / accepted.**

- The extractor is ~200 lines of TypeScript AST walking in a spec file. It is the price of not testing a
  hand-written list against itself (PF-105: `A ≡ A` proves nothing). It carries its own vacuity floor,
  its own `asc`/`desc` negative control with a positive half, and a closed list of the four open-parameter
  forwarder helpers.
- `remediation.booking_*` is **computed** (`` `remediation.booking_${dto.toStatus}` ``) and no AST walk
  can enumerate it. It is declared as a **family** with its members listed explicitly and the computing
  site named; the guard asserts the declared members cover `TEACHER_BOOKING_TRANSITION` ∪
  `{created, cancelled}`. Family members are the **only** codes exempt from the reverse completeness
  direction.
- Two named, reasoned exclusions from the single-declaration guard: the declaration itself, and
  `apps/web/src/app/admin/roles/RoleBuilderForm.tsx`, whose permission-domain label map collides with the
  audit vocabulary on four school nouns by accident. Both are asserted to actually trip the matcher, so
  neither exclusion is decorative.
- Three portal declarations remain (D2). PF-101 owns the reconciliation.

**Not claimed by this slice.** The audit read path (`S-E04-7`, PF-121/122/123 — read while writing the
extractor, deliberately not fixed). The parent transparency panel. A login writer. A `portal: 'student'`
writer. DOM-level proof that the marker renders — that is Playwright's, and this slice's web evidence is
behavioural at the label-resolution layer and textual at the component layer, stated as such.

---

## S-E04-11 amendment — the regulator's file has a shape contract, and one stated exception to « verbatim »

> **Amendment, not a new file.** `tasks.md` cross-slice ruling #9 (`:509`) allocates exactly three ADRs to
> this epic — `ADR-036` (provenance), `ADR-037` (vocabulary), `ADR-035` (in-transaction) — and `S-E04-11` is
> not a fourth. Creating an `ADR-038` here would itself be the ADR-drift finding this epic exists to remove.
> Two decisions land below, numbered **D6–D7**. `ADR-037` carries no forward reservation, so `S-E04-11` is
> its first amender and sets one: **a later amender of this file reserves D8 onward.**
>
> **Why these two need a home outside the generator.** Both were shipped as comments inside
> `apps/worker/src/modules/exports/generators/audit-csv.generator.ts`, and both are cross-cutting: D6 binds
> anyone who ever adds a column to the DPO export, and D7 **qualifies D4 above**, which is the decision an
> API, web or import author reads when they ask what the audit surfaces do with a value they do not
> recognise. A rule that lives only in the file it governs is invisible to exactly the population that has
> to obey it, and D4 currently reads as an unconditional promise the shipped generator no longer keeps.

### D6 — The `audit_csv` column list is APPEND-ONLY; indices 0..9 are frozen

The header of the file a DPO hands to a regulator is:

```
0 created_at · 1 actor_id · 2 portal · 3 action · 4 action_label · 5 resource_type ·
6 resource_type_label · 7 vocabulary · 8 resource_id · 9 ip_address       ← FROZEN (v1)
10 action_vocabulary · 11 resource_type_vocabulary                        ← APPENDED (v2, S-E04-11)
```

**The decision.** Positions 0..9 are the contract. A new column is **appended at the end**. Removing or
reordering a column is a **versioned, announced format change** with its own consumer census — not a commit.

**Why this is a decision and not housekeeping.** `S-E04-4` — this ADR's own slice — inserted `action_label`,
`resource_type_label` and `vocabulary` *mid*-header and pushed `resource_id` and `ip_address` from indices
5-6 to 8-9. No acceptance criterion asked for the move, no consumer was surveyed, and an index-keyed
downstream parser breaks **in silence**: it does not error, it reports the wrong column's value. The
exact-string header pin that already existed did not stop it, because the author edited the code and the pin
in the same commit. That is registered as **PF-140 (i)**, and D6 is the rule whose absence made it possible.

**How it is enforced — twice, with two different failure messages**
(`audit-csv.generator.spec.ts:113-176`): `FROZEN_PREFIX_V1` pins positions 0..9 *and* `resource_id`/
`ip_address` by index with the reason attached (`:150-160`); a separate assertion pins the full column set
(`:162-165`); a third pins that every data row is exactly as wide as its header (`:167-176`), because the row
builder is a **second** list and PF-140 (i) was a header and a row edited together. « You moved a column »
and « you added a column » must not look like one failure.

**One consequence accepted rather than smuggled.** Column 7 `vocabulary` is `weakerVocabulary(action,
resource_type)` and is therefore fully derivable from the two appended per-axis columns. It is **kept**:
removing it would move `resource_id`/`ip_address` a second time — committing PF-140 (i) inside the fix for
PF-140 (i). Its retirement is a follow-up that needs the versioned, announced change D6 describes.

### D7 — A cell that a spreadsheet would execute is force-quoted and prefixed with exactly one apostrophe

**The decision.** In the audit CSV export, a cell whose **first character** is `=`, `+`, `-`, `@`, a tab or a
carriage return is emitted **force-quoted AND prefixed with a single `'`** (the OWASP CSV-injection form).
`\r` additionally joins the quote-trigger set so a bare carriage return can never split a record.

**Recovery rule, stated so a downstream parser is not left guessing:** strip the surrounding quotes, then
strip **exactly one** leading apostrophe. Nothing else was changed, and nothing was removed.

**Why the export and not the writer.** The generator returns a UTF-8 BOM (`audit-csv.generator.ts:213-218`,
kept deliberately so French Excel does not render « Évaluation » as « Ã‰valuation »), which is precisely what
makes the artefact *the document French Excel opens as a spreadsheet*. The stored row is data; the exported
file is a program the moment a cell begins with `=`. Neutralising on write would mutate an append-only trail
— forbidden by D4 — so the transform belongs at the export boundary and nowhere else.

**Why an apostrophe and not a leading tab**, the other standard mitigation: a tab is itself in the trigger
set, so prefixing one produces a cell the escaper must consider dangerous again. `'` is not a trigger, so
one pass suffices and the function never recurses — pinned at `spec.ts:392-406`. (Full `csvEscape`
idempotence is not a property any RFC-4180 escaper has: `csvEscape('a,b')` is `"a,b"` and re-escaping that
legitimately doubles the quotes. Round-tripping is the parser's job; what must hold is that the
**neutraliser** is not re-applied.)

**Uniform across every column, never a per-column allowlist.** An allowlist is what drifts the day
`audit_log.user_agent` — a raw client header, `schema.prisma:1245`, one column away from this export — joins
the file. ~~`csvEscape` is not duplicated anywhere: it is exported from the audit generator and the four other
export generators emit XLSX or PDF, so there is no second escaper to drift. A future CSV generator reuses
this one rather than copying it.~~

> **⚠️ That struck-through sentence was FALSE when it was written, and it is the reason `PF-168` exists.** It
> surveyed only the *export generators*. Measured at `8e52da0` the repository held **three** `csvEscape`
> declarations and **five** distinct CSV escapers: `apps/web/src/lib/csv.ts` (which neutralised nothing at
> all), a private copy in `AlertsExportButton.tsx`, two `escapeCell` copies on the parent portal, and this
> one. Corrected here rather than quietly overwritten, because *"there is no second escaper to drift"* is
> exactly the kind of claim a later run reads and stops checking (`R-30`). **See D8**, which relocates this
> decision to `packages/contracts/src/security/csv-injection.ts` and replaces the survey with an executable
> ratchet — `scripts/csv-escape-check.js` — so the property is measured on every run instead of asserted once.

**The record separator stays `\n` and the delimiter stays `,`.** Promoting to CRLF « because RFC 4180 says
so » would move every byte offset in the file — the silent byte change this slice exists to stop
(`spec.ts:423-426`).

### D4 is SCOPED, not overturned — « verbatim » now means « verbatim modulo the D7 neutraliser »

D4 above says an unknown code is *« value **verbatim** + « Code non répertorié » »*, and the generator's own
docblock says *« the record is reproduced, never interpreted »*. Both remain true, with **one stated
exception**, and it is stated because a silent one would be the defect this epic exists to close:

| Cell | What the export emits |
|---|---|
| does **not** begin with `=` `+` `-` `@` TAB CR | **byte-identical to before D7** — `Évaluation`, `Résultats`, `role.delete`, `10.0.0.1`, an ISO timestamp, an empty cell (asserted cell-by-cell on the real fixture, `spec.ts:429-468`) |
| begins with one of them | force-quoted, one leading `'`, **payload intact and recoverable** (`spec.ts:354-390`) |

**Nothing is ever dropped, bucketed or relabelled** — DNC-08 holds unchanged: the transform is *additive and
reversible*, which is the property that lets it coexist with an append-only trail. « Verbatim » in D4 is a
promise about *content*, not about the quoting layer; D7 is the only thing between the stored bytes and the
file, and it is now written down in the document D4 lives in.

### What this amendment deliberately does NOT change

- **No `packages/contracts` change, no vocabulary change.** `classifyAuditAction` /
  `classifyAuditResourceType` / the three-state `vocabulary` resolution of D4 are untouched; the two appended
  columns are the **same** resolvers' per-axis output, read where `weakerVocabulary` used to collapse them,
  with no local copy (D1's single-declaration property is preserved, and the vocabulary gate's
  `'action', 'action_label',` adjacency requirement survives because the new columns are appended).
- **No schema, no migration, no SQL** — D3's consequence still holds for this slice.
- **The BOM stays.** It is context for D7, not a defect (removing it would not make the file safe; it would
  make it unreadable in the tool a DPO actually opens).
- **No ADR is claimed for the two error mappings that ship in the same diff.** `UnknownTimezoneError` →
  `InternalServerErrorException({ code: 'TENANT_TIMEZONE_UNUSABLE' })` on the API read path and →
  `UnrecoverableError` in the worker generator use a **Nest built-in** and a **BullMQ built-in**
  respectively. No exception filter is added (`apps/api/src` contains zero `*.filter.ts` and this slice does
  not add the first for two call sites), no new transport, no new cross-cutting pattern — so the ADR rule is
  checked and returns *no new decision*, which is recorded here rather than left for a reviewer to re-derive.
  The fail-closed posture itself is `S-E04-5`'s and is **not** weakened: no fallback to the server zone
  exists on either path.

---

## S-E05-1 amendment — the neutraliser is ONE function at ONE address, and a gate keeps it there

> **Amendment, not a new file.** `S-E04-11` set this file's forward reservation (*« a later amender
> reserves D8 onward »*) and `S-E05-1` takes it. The alternative — an `ADR-038` for « where the CSV
> neutraliser lives » — would split ONE decision across two documents, which is exactly how D4 and D7
> nearly drifted apart in the first place. D7 already owns the *content* of this decision; D8 changes its
> **address and its reach**, and says who enforces it. One decision, one home, next number.
>
> **Why it needs a home outside the code at all.** GUARDRAILS §2 makes an undocumented *new cross-cutting
> pattern* a blocking finding, and this is one: a security predicate lifted into `packages/contracts` and
> consumed by three runtimes. Six shipped source files already cite « ADR-037 D8 » as their authority
> (`packages/contracts/src/security/csv-injection.ts`, `apps/web/src/lib/csv.ts`,
> `apps/worker/.../audit-csv.generator.ts` ×2, `apps/api/.../imports.service.ts`,
> `apps/api/.../oneroster.adapter.ts`). Until this section existed, every one of those citations pointed
> at nothing.

### D8 — The CSV neutraliser has ONE home, `@pilotage/contracts`; the DIALECT stays per-surface

**The decision, in four parts.**

**(i) One home.** `neutraliseCsvCell`, `CSV_INJECTION_TRIGGERS` and `CSV_NEUTRALISER` are declared exactly
once, in `packages/contracts/src/security/csv-injection.ts`, re-exported through `security/index.ts` →
`src/index.ts`. Every CSV writer in the monorepo that produces a file **a human opens in a spreadsheet**
consumes them from there. The module is pure and import-free — no `zod`, no `node:*` — because it runs in a
browser bundle, in a Node worker, and inside a `require()`-based gate script.

The address is **not novel, and that is the argument for it**: `packages/contracts/src/security/csp.ts` is
already a pure, import-free security function shared between `apps/web`'s edge middleware and a gate
script. `csv-injection.ts` is the same species at the same address. It declares **no class and no
`instanceof`**: `packages/contracts` ships CJS (`main → dist/index.js`, D5) and `dist/` is git-ignored, so a
spec resolving `src/` and a runtime resolving `dist/` hold two different module objects. A plain function
returning a plain object literal cannot disagree with itself across that seam; a class would.

**(ii) The DIALECT is deliberately NOT shared, and `PF-169` stays OPEN.** The separator, the BOM and the
record terminator remain per-surface: the web exports quote on `[",;\n\r]` and join with `;` + CRLF, the
regulator-facing audit export quotes on `[",\n\r]` and joins with `,` + LF. **Both cite French Excel and
both cannot be right** — that is `PF-169`, and it is **not taken here**. Two reasons, and the second is the
load-bearing one:

- Folding the two quote sets into one union would force-quote every worker cell containing a `;` — a
  `user_agent` header, say — and silently rewrite the regulator's file.
- Changing a delimiter rewrites **every byte offset** in a file downstream parsers key on. D6 already
  classes that as a **versioned, announced format change** with its own consumer census. A security fix is
  not the place to smuggle one in.

So the split is: the **security-bearing** part (the trigger set, the neutralising character, and the
decision of when to apply them) is shared and singular; the **dialect** is local and duplicated on purpose.
`PF-169` remains open against the dialect half and is named in a code comment in `apps/web/src/lib/csv.ts`,
so the contradiction is not silently inherited by the next reader.

**(iii) The single-home property is held by `scripts/csv-escape-check.js`, NOT by review.** This is the
half that makes D8 a decision rather than a wish. `PF-168` was raised against a slice that had *already*
fixed CSV injection once — that fix was correct, and the class stayed open, because nothing stopped the next
file from declaring its own escaper the following week. A sweep without a ratchet is a sweep that has to be
done again.

The gate runs as `ci-gate.sh` stage 0d-bis and as its own step in `.github/workflows/ci.yml`'s lint job,
**outside every `--quick` guard**. It fails on:

| Rule | Decision |
|---|---|
| **A** | Any CSV escaper under the walk root outside the two sanctioned ones. Detected by **name** (`csvEscape`, `escapeCsv`, `escapeCell`, `cellEscape`) **or by shape** — a body that both tests a character class containing `"` and performs the RFC-4180 quote-doubling `.replace(/"/g, '""')`. There is **no baseline file**: the correct count is 2, and 2 is the ceiling. |
| **B** | The trigger set assembled anywhere but `csv-injection.ts` — an array holding `@` plus two further triggers, or a `^`-anchored character class carrying both `=` and `@`. This catches a copy that simply avoided the *name*. |
| **C** | A sanctioned escaper that stops **importing** `neutraliseCsvCell` from `@pilotage/contracts`, or stops **calling** it. |
| **D** | Vacuity and staleness (DNC-08): a sanctioned or excluded entry matching zero declarations, fewer than two sanctioned escapers, an absent walk root, a root matching zero files, an unresolvable `typescript`, an absent predicate, a predicate missing an export, or a barrel that does not re-export it — each FAILS naming which. |
| **E** | No off switch (DNC-10): no environment variable is read, the only flag is `--help`, and there is deliberately **no `--update`** — on a two-row ceiling, an « update the ceiling » flag *is* the off switch. |

Two properties of that gate are decisions in their own right, and are recorded here rather than left inside
the script:

- **The walk root includes `.tsx`.** Three of the five copies `S-E05-1` deleted lived in components
  (`AlertsExportButton.tsx`, `parent/grades/GradesExport.tsx`, `parent/attendance/AttendanceExport.tsx`). A
  `.ts`-only walk would have certified a surface it could not see — the `S-E06-5` shape (`packages/ui`
  bundled into every portal but sitting outside its gate's walk root) recurring at a third address.
- **Rule A matches on SHAPE, not only on name.** Two of those five copies were called `escapeCell`, which
  is precisely why `PF-168`'s own count was wrong: it grepped for `csvEscape`. A name-only rule would
  inherit the finding's blind spot, and would go quiet the moment someone renamed a function.

Because `apps/web` has **no unit runner** (`PF-129`/`PF-133`) and `packages/contracts` has no spec files,
rule C is the **only executed evidence** that the web half of this slice is wired at all. That is stated
plainly so no later reader mistakes it for a stronger claim: no browser downloaded a file, no spreadsheet
was opened, and no web unit test exists.

**(iv) PRESENTATION CSV, never TRANSPORT CSV — with two named exclusions.** The neutraliser belongs on a
file **a human opens in a spreadsheet**. It must **not** be applied to CSV that is stored and later
re-parsed, where an apostrophe would be written into source data. Two `apps/api` sites are therefore
excluded **by name** in the gate, each with the reason in the gate and the same reason in the source:

- `apps/api/src/modules/integrations/oneroster.adapter.ts#rowsToCsv` — the body it produces is stored as
  `ImportBatch.rawCsv` and **re-parsed** by the rollback and preview surfaces. Neutralising it would corrupt
  the import.
- `apps/api/src/modules/imports/imports.service.ts#template` — the downloadable import template. Every cell
  is a dev-authored constant (headers + a sample row), so there is no injection surface, and it is a
  template the admin fills in and **re-uploads**.

A **stale** exclusion is itself a gate failure, so those two source comments stay true or the build goes
red. `apps/api` is otherwise a **non-consumer** of the neutraliser: it ships no presentation CSV.

### D8 corrects one `S-E04-11` claim, on the record

`PF-168` states that the real count of `csvEscape` copies is **two**, and reads the second copy —
`apps/web/src/app/admin/alerts/AlertsExportButton.tsx` — as **« already correct »**. Measured at `8e52da0`,
both halves of that are wrong, and the correction is written here because `R-30`
(`feedback_false_red_evidence`) is exactly the failure of a later run believing a recorded claim:

- The count of `csvEscape` declarations was **three**, not two; counting the two `escapeCell` copies on the
  parent portal, the number of distinct CSV escapers was **five**.
- Copy (b) was correct about the **neutralisation** and not about the **force-quoting**: it prefixed the
  apostrophe and then tested the *original* quote regex, so `=1+1` was emitted as `'=1+1` **unquoted**.
  Aligning it changes its output — `"'=1+1"` now — which is an intended behaviour delta, not a regression.

**One further consequence accepted rather than smuggled.** D7's *« uniform across every column, never a
per-column allowlist »* now reaches the web exports, where it is visible: a guardian phone
`+33 6 12 34 56 78` exports as `"'+33 6 12 34 56 78"` and renders in Excel as text. That is the stated trade
— an allowlist is what drifts the day a new free-text column joins the export. Numeric cells are **not**
affected: the values built by `csvFixed1` are passed to `csvRow` without going through `csvEscape`, so a
negative average does not acquire an apostrophe.

### What this amendment deliberately does NOT change

- **No dialect byte changes.** `CSV_SEPARATOR` stays `';'`, `CSV_BOM` stays, the web CRLF join stays, and
  the audit export's `,` + LF and its D6-frozen column indices stay. `PF-169` owns the reconciliation.
- **D7 is relocated, not overturned.** The behaviour is the worker's, byte for byte; the existing
  regression block in `audit-csv.generator.spec.ts` passes unchanged, which is the proof.
- **No schema, no migration, no SQL; no endpoint, no guard, no DTO.** G-TENANT, G-AUTHZ and G-MIGRATION do
  not trigger for this slice.
- **No new `package.json#exports` subpath.** The symbols reach consumers through the existing `.` condition;
  adding a `./security` subpath that no consumer needs would be an unbudgeted decision.
- **No unit runner is added** to `apps/web` or `packages/contracts` — that is `PF-129`/`PF-133`'s own slice,
  and claiming a web unit test here would be the false-evidence failure this section just finished
  correcting.
