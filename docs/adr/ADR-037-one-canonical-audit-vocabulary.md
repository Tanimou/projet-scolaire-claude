# ADR-037 — One canonical audit vocabulary, declared once, in `packages/contracts`

- **Status**: Accepted
- **Date**: 2026-08-09
- **Slice**: S-E04-4 (epic V3-E04 — audit trail and governance surfaces)
- **Finding**: PF-32 (vocabulary half) · **Gates**: G-TRUTH, G-PORTAL, G-DNC · **DNC**: DNC-08, DNC-09
- **Supersedes nothing.** Extends ADR-002 (tenant scoping), ADR-003 (four portals), ADR-036 (audit
  provenance). Transcribes the ruling already recorded in
  `docs/spec/features/v3-e04/data-model.md` §2.3–§2.4 (D-12…D-17); it invents nothing beyond it.

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
