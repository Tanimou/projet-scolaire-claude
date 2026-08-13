# TOOL-17(b) — a tolerated skip must never make a rule PASS

> **Epic** `V3-E02` — Quality-gate integrity.
> **Slice** the three residuals `TOOL-17` recorded and did not fix.
> **Gates** `G-DNC` only. **Risk** `P1`. **Touches** test infrastructure + one shared CJS helper. No production code.
>
> **Ledger status.** `docs/spec/features/v3-e02/PROGRESS.md:2345` and `:2496` both name `TOOL-17(b)` as the next
> slice, in the same order used here. The ledger AGREES with this brief; nothing in it had to be overridden.

---

## 0. Read this first, then read one file

Read **`scripts/lib/walk-read.js` in full** before editing anything. Its docblock is the design record of `TOOL-17`.
Keep its voice and **extend** it; do not rewrite it. Everything else you need is in this document.

You do **not** need `bmad/roadmap.md`, `project-context.md`, or the epic `spec.md` to implement this.

### The one sentence this slice is about

`TOOL-17` shipped `scripts/lib/walk-read.js`: the single seam that turns a **walked** path into contents, tolerating
exactly one thing — a path that `walk()` listed and that is **CONFIRMED absent** when re-checked. The tolerance is
correct. What it opened is a `DNC-08` leak at three addresses, and all three are the same sentence:

> **A file that was skipped must never satisfy a rule.**

`DNC-08` — *an unclassifiable state must never be reported as a PASS* — is the rule this slice enforces. Do not
reproduce it while fixing it: **if you cannot tell whether a rule was checked, the answer is RED, never green.**

---

## 1. Residual 1 — the FR-4 named-path leak (the dangerous one)

### The defect

The five converted specs build their corpus `Map` through the tolerant seam, then read **named** (hard-coded literal)
paths back out of it with `MAP.get('<literal>') ?? ''`. If that named file was skipped by the tolerance, the accessor
yields `''` — and **every negative assertion downstream passes vacuously**. An empty string contains nothing, matches
no `toMatch`, and satisfies every `.not.` in the file forever.

### Measured on HEAD (2026-08-13) — verified, not inherited

`MAP.get(…) ?? ''` sites, counted with `\.get\([^)]*\)\s*\?\?\s*''`:

| Spec (under `apps/api/src/shared/quality/`) | sites | corpus map |
|---|---:|---|
| `audit-vocabulary-gate.spec.ts` | 20 | `CONSUMER_SOURCES` |
| `audit-provenance-gate.spec.ts` | 19 | `EXECUTABLE` |
| `trust-proxy-dnc10-gate.spec.ts` | 8 | `EXECUTABLE` |
| `portal-landing-gate.spec.ts` | 1 | `EXECUTABLE_SRC` |
| `open-redirect-gate.spec.ts` | 0 | — |
| **total** | **48** | |

Worked examples of the leak, all in `audit-provenance-gate.spec.ts`:

- `:492-494` — `expect(declaresRolePrecedenceOrdering(EXECUTABLE.get('…/analytics.controller.ts') ?? '')).toBe(false)`
  → `''` has no bracket groups, so the matcher returns `false` and the rule "passes".
- `:627` — `expect(source()).not.toContain(needle)` over `EXECUTABLE.get(PROVENANCE_REL) ?? ''`.
- `:785` — `expect(EXECUTABLE.get(PROVENANCE_REL) ?? '').not.toContain('SYSTEM_AUDIT_PROVENANCE')`.
- `:840-841` — `main` `.not.toMatch(/set\(\s*['"]trust proxy['"]/)`.
- `:936` — `main` `.not.toMatch(/\$\{[^}]*AUDIT_FORWARD_TOKEN[^}]*\}/)`.

`walk-read.js`'s own docblock already states the governing rule:

> *"Every fixed, named path … keeps its bare `readFileSync` and keeps failing at load."*

These 48 sites violate it by reading a **named** path out of a **tolerant** map.

### One measured correction to the brief — read this before you code

The brief this story was written from asserted that *every* one of the 48 keys is a hard-coded string literal. **That
is true for 47 of the 48 and false for one.** Measured:

- `portal-landing-gate.spec.ts:520` — `const source = EXECUTABLE_SRC.get(path) ?? ''` where `path` iterates
  `withLabel`, which is built at `:511-514` from `[...EXECUTABLE_SRC.entries()]`. The key is **map-derived**, so it is
  *always present* and the `?? ''` there is dead defensive noise, not a leak.
- Every other loop-variable key IS literal-derived, each verified: `G3_EXCLUSIONS` (`audit-provenance:102`),
  `WRITE_SITES` (`:724-733`), `CONSUMERS` (`:764-773`), `SINGLE_DECLARATION_EXCLUSIONS`
  (`audit-vocabulary:1076`), `PRE_FIX_SOURCE.from` (`audit-vocabulary:1113`), the local `quoting` array
  (`trust-proxy:212-215`), and the `[TRUST_PROXY_REL, MAIN_REL]` / `PRE_FIX_SOURCES`-style `const … _REL` literals.

**Consequence:** the repair is identical at all 48 sites — the map-derived one simply can never take the throw branch,
which is a *proof that the throw is reachable only via the skip path*, not an exception to carve out. Do not special-case
it. Do note it in the code comment so a reviewer does not re-derive this.

### Required shape

Export a helper from `scripts/lib/walk-read.js` that makes a named read **total by throwing**:

```js
/**
 * Serve a NAMED (fixed, hard-coded) path out of a corpus Map built by the
 * tolerant seam — by THROWING when the key is absent, never by yielding ''.
 *
 * @param {string} label the reading site, for the message
 * @param {Map<string, string>} map the corpus
 * @returns {(key: string) => string}
 */
function namedReader(label, map) { … }
```

The thrown error must be **named and greppable** and must **carry the key**. Required message shape (exact tokens
`DNC-08 (TOOL-17b)` and the key; wording around them is yours):

```
DNC-08 (TOOL-17b) — <label>: named path '<key>' is absent from the corpus.
A named path is never tolerated: it was skipped by the walk/read tolerance, or never walked.
Refusing to serve '' — a vacuous PASS is not a PASS.
```

Then, in each of the four specs, build one accessor per corpus map near the map's construction and **replace every
`MAP.get(X) ?? ''` with `accessor(X)`**. Prefer this over editing 48 assertions.

**Intended, not a regression:** if a named file is legitimately deleted by a future slice, that spec now goes RED at
the assertion naming the file, instead of passing vacuously. That is the whole point.

### Do NOT

- **(a)** change any assertion's meaning — the accessor returns exactly what the map holds;
- **(b)** add a `?? ''` anywhere, in any spelling (`|| ''`, `?? ""`, `String(x ?? '')` all count);
- **(c)** delete the pre-existing `expect(x).not.toBe('')` guards that some sites already carry
  (`audit-provenance-gate.spec.ts:585`, `:603`, `:836`, `:848`; `audit-vocabulary-gate.spec.ts:1180`, `:1336`).
  They are the precedent this repair generalises. They become redundant but harmless; deleting them costs a reviewer
  the trail.
- **(d)** convert the computed `require(join(REPO_ROOT, 'scripts','lib','walk-read.js'))` into a static import. It
  must stay computed (it would otherwise enter the TypeScript program and `apps/api/dist`) and it must stay
  **unguarded** (a missing module must still fail the suite at LOAD).

---

## 2. Residual 2 — the cap is the wrong size for a small corpus

### The defect

`MAX_VANISHED_FILES = 5` (`scripts/lib/walk-read.js:127`) is a **flat** budget. `portal-landing-gate.spec.ts:217`
applies it to `VANISHED_WEB_TESTS`, whose corpus `WEB_TEST_FILES` is `apps/web/tests` — **measured 10 files on HEAD**.
So **half the corpus may vanish and the gate still passes**, while its only list floor is
`expect(WEB_TEST_FILES.length).toBeGreaterThanOrEqual(1)` (`:215`).

### Required shape

Export a **proportional** bound from `scripts/lib/walk-read.js`, e.g.

```js
const VANISHED_FRACTION = 0.02;                       // 2 % of the walked list
function maxVanishedFor(n) {
  return Math.min(MAX_VANISHED_FILES, Math.max(1, Math.ceil(n * VANISHED_FRACTION)));
}
```

Two constraints, both taken from `walk-read.js`'s own docblock, both **non-negotiable**:

1. **It must NEVER evaluate to 0 for a non-empty corpus.** `expect(skipped).toBe(0)` merely relocates the flake from
   load time to assert time, which is the defect this module exists to remove.
2. **`MAX_VANISHED_FILES` stays exported and stays the ceiling for large corpora**, so the existing large-corpus
   assertions do not change meaning.

Resulting table (with `0.02` — any formula meeting the pinned boundaries in §4 AC-6 is acceptable):

| corpus `n` | cap | note |
|---:|---:|---|
| 1 | 1 | never 0 |
| 10 (`apps/web/tests`) | **1** | was 5 — the defect |
| 108 (`apps/**` specs) | 3 | |
| 210 (`apps/api/src`) | 5 | ceiling reached |
| ≥ 250 | 5 | `MAX_VANISHED_FILES` |

### Every site that must adopt it — measured, not assumed

Apply the scaled cap at **all** of these. This list was measured on HEAD; re-measure before you finish, and if you
find a site not listed here, convert it and say so.

| # | Site | Compared list | Kind |
|---|---|---|---|
| 1 | `apps/api/src/shared/quality/audit-provenance-gate.spec.ts:292` | `API_FILES` | cap |
| 2 | `apps/api/src/shared/quality/trust-proxy-dnc10-gate.spec.ts:155` | `API_FILES` | cap |
| 3 | `apps/api/src/shared/quality/audit-vocabulary-gate.spec.ts:673` | `WRITER_FILES` | cap |
| 4 | `apps/api/src/shared/quality/audit-vocabulary-gate.spec.ts:675` | `CONSUMER_FILES` | cap |
| 5 | `apps/api/src/shared/quality/audit-vocabulary-gate.spec.ts:1937` | in-test PF-149 `files` | cap |
| 6 | `apps/api/src/shared/quality/portal-landing-gate.spec.ts:216` | `WEB_SRC_FILES` | cap |
| 7 | `apps/api/src/shared/quality/portal-landing-gate.spec.ts:217` | **`WEB_TEST_FILES` (n≈10)** | cap — the defect |
| 8 | `apps/api/src/shared/quality/open-redirect-gate.spec.ts:403` | `WEB_SRC_FILES` | cap |
| 9 | `apps/api/src/shared/quality/hermetic-spec-writers-gate.spec.ts:383` | `SPEC_FILES` | cap |
| 10 | `apps/api/src/shared/quality/hermetic-spec-writers-gate.spec.ts:388` | `MIN_SPEC_FILES - MAX_VANISHED_FILES` | **subtraction**, not a comparison — use the same scaled value so the map floor tightens with it |
| 11 | `apps/api/src/shared/quality/walk-read-gate.spec.ts:513` | `apiFiles` (dogfooding scan) | cap |
| 12 | *(new, from Residual 3)* `apps/api/src/shared/audit/write-audit.spec.ts` AC-9 loop | `PRODUCTION_FILES` | cap |

Leave `walk-read-gate.spec.ts:441-442` (`MAX_VANISHED_FILES > 0`, `<= 10`) unchanged — those assert the **constant**,
which still exists and is still the ceiling.

**Keep the accounting identity `map.size + skipped.length === list.length` exactly as it is at every site.** It is the
load-bearing half; the cap only transports the list floor onto the map.

---

## 3. Residual 3 — the sixth victim

`apps/api/src/shared/audit/write-audit.spec.ts:416`, inside the **AC-9** test:

```ts
for (const file of PRODUCTION_FILES) {
  if (repoRel(file) === SELF_REL) continue;
  const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.ES2022, true);
```

`PRODUCTION_FILES` is built by `walk(API_SRC, …)` at `:72`. That bare `readFileSync` on a **walked** path is the ninth-
plus-one site of the same race. Route it through the seam.

### The difference from the other five — preserve it

This read is inside an `it()`, **not at module scope**. Today a vanish fails the **test**, not the **suite load**. That
is a milder failure mode and the conversion must not change what the test *concludes*, only stop it being flaky.

- **Keep** the existing vacuity guard `expect(calls).toBeGreaterThanOrEqual(10)` — it is what stops a skipped corpus
  reading as `offenders === []`.
- **Add** the accounting identity and the scaled cap alongside it, in the same `it()`.
- The suite already `require`s `typescript`; add the computed, unguarded
  `require(join(REPO_ROOT, 'scripts','lib','walk-read.js'))` in the same style as the other six specs.

### The named reads in the same file must NOT change

`:312`, `:327`, `:351`, `:360`, `:370` read **fixed** paths (`SELF_PATH`, `join(REPO_ROOT, 'packages','contracts','src','audit','vocabulary.ts')`,
`join(__dirname, 'write-audit.spec.ts')`). They **keep their bare `readFileSync`** — this is the same named-vs-walked
distinction as Residual 1, at the other end. Verified: `:416` is the *only* walked read in this file.

---

## 4. Acceptance criteria

Every AC is a *test that exists and passes*, in `apps/api/src/shared/quality/walk-read-gate.spec.ts` (17 cases today)
unless stated otherwise. **For each residual, show it RED and show it GREEN** — the green control is the whole
difficulty (run 47's lesson).

**AC-1 — `namedReader` refuses to serve an absent key.**
Given a corpus map built over a scratch tree where one file was skipped, the accessor for the skipped key **throws**,
and the message contains (i) the token `DNC-08`, (ii) the label, (iii) the **exact key**. Asserted with
`expect(() => …).toThrow(/…/)` naming the key, not merely `toThrow()`.

**AC-2 — `namedReader` is transparent on a present key.**
Returns the map's value **byte-for-byte** (`toBe`, not `toContain`) for a key that is present.

**AC-3 — the green control: the throw is reachable ONLY via the skip path.**
A map built over the **same** scratch tree with **no** skips serves **every** named key without throwing. This is the
case that proves AC-1 is a defect detector and not a change of behaviour.

**AC-4 — no `?? ''` survives on a corpus map.**
The four specs of §1 contain **zero** `MAP.get(…) ?? ''` sites. Asserted by AC-8's parsed rule, not by a text scan.

**AC-5 — the seam's own vacuity floor is unchanged.**
`map.size + skipped.length === list.length` still holds and is still asserted at all twelve sites of §2.

**AC-6 — the scaled cap: pin the BOUNDARIES, not the formula.**
Assert numbers on `maxVanishedFor(n)`:
- `maxVanishedFor(10)` is **strictly less than** `MAX_VANISHED_FILES` *and* `>= 1` (the `apps/web/tests` case);
- `maxVanishedFor(300)` `toBe(MAX_VANISHED_FILES)` exactly, and so does any `n >= 300`;
- `maxVanishedFor(1)` `toBeGreaterThanOrEqual(1)` — **never 0**;
- monotonic non-decreasing across a sampled ladder (`1, 10, 50, 108, 210, 300, 1000`);
- never exceeds `MAX_VANISHED_FILES` for any sampled `n`.
Do **not** assert the constant `0.02` or the shape of the expression.

**AC-7 — Residual 3 is converted and still concludes the same thing.**
`write-audit.spec.ts` AC-9 reads `PRODUCTION_FILES` through the seam; `expect(calls).toBeGreaterThanOrEqual(10)`
survives verbatim; the identity and scaled cap are asserted in the same `it()`; the five named reads at `:312/:327/
:351/:360/:370` still use bare `readFileSync` (assert this, so a future over-eager conversion goes red).

**AC-8 — a ratchet, PARSED WITH THE TYPESCRIPT COMPILER, NEVER GREPPED.**
Two rules over every `*.spec.ts` under `apps/**`:
- **R2 (required)** — no spec serves a named path out of a tolerant map: **no** `BinaryExpression` with
  `QuestionQuestionToken` whose left is a `CallExpression` on a `.get(…)` property access and whose right is an empty
  string literal. Also flag the `||` spelling.
- **R1 (required if tractable, see §6)** — no spec reads a **walk-derived** path with a bare `readFileSync`.
  Definition, stated so a compiler can decide it: a binding is *walk-derived* when its initialiser or any assignment is
  a call to a **locally-declared** function that transitively calls `readdirSync`; a `readFileSync(x, …)` is a
  violation when `x` is bound by a `for…of`, a `.map`/`.filter`/`.forEach` callback parameter, or an element access
  over such a binding.

The classifier **must be a pure `(source: string) => Violation[]`**, so it can be driven over **synthetic** sources.
Required cases:
- a synthetic source containing the violation is flagged (**RED half**, proven in-run);
- a synthetic source with the *converted* shape is **not** flagged (**GREEN control**);
- the real corpus under `apps/**` yields `[]`, over a corpus with a **floor** (`>= 100` spec files measured today:
  108) so "no violations" can never mean "nothing was read";
- the corpus read itself goes through the tolerant seam with the identity + scaled cap (dogfooding).

**Why parsed and not grepped:** `walk-read-gate.spec.ts` and this story's own fixtures contain these very spellings
**inside string literals**. A text matcher flags them, and the only way to make a text matcher green again is to weaken
it — which is `R-30` exactly. `hermetic-spec-writers-gate.spec.ts` already states and carries this doctrine
(`require('typescript')` is a root devDependency; no new dependency).

**AC-9 — the docblock is extended, not rewritten.**
`scripts/lib/walk-read.js`'s header keeps its structure and voice, gains a section for the named-path rule and the
proportional cap, and its **RESIDUALS** section is updated: the three closed here are struck through with the reason,
and any *newly discovered* residual is added with evidence.

**AC-10 — hermeticity.**
No probe file is planted anywhere in the shared checkout. Every fixture is a `mkdtempSync(tmpdir())` scratch tree.
`hermetic-spec-writers-gate.spec.ts` must stay green (it will fail you otherwise — `TOOL-15`/`TOOL-18` closed exactly
this in run 47).

---

## 5. Files

**Edit**

| Path | What |
|---|---|
| `scripts/lib/walk-read.js` | `namedReader`, `maxVanishedFor` (+ `VANISHED_FRACTION`), exports, docblock (AC-9) |
| `apps/api/src/shared/quality/audit-provenance-gate.spec.ts` | 19 accessor conversions; cap at `:292` |
| `apps/api/src/shared/quality/audit-vocabulary-gate.spec.ts` | 20 accessor conversions; caps at `:673`, `:675`, `:1937` |
| `apps/api/src/shared/quality/trust-proxy-dnc10-gate.spec.ts` | 8 accessor conversions; cap at `:155` |
| `apps/api/src/shared/quality/portal-landing-gate.spec.ts` | 1 accessor conversion; caps at `:216`, `:217` |
| `apps/api/src/shared/quality/open-redirect-gate.spec.ts` | cap at `:403` (0 accessor sites) |
| `apps/api/src/shared/quality/hermetic-spec-writers-gate.spec.ts` | scaled cap at `:383`, scaled subtraction at `:388` |
| `apps/api/src/shared/audit/write-audit.spec.ts` | Residual 3: seam at `:416`, identity + cap, `require` block |
| `apps/api/src/shared/quality/walk-read-gate.spec.ts` | AC-1…AC-3, AC-6, AC-8 cases; scaled cap at `:513` |
| `docs/spec/features/v3-e02/PROGRESS.md` | slice entry, evidence, next-slice pointer |
| `docs/daily-improvement-v3/traceability/OPEN.md` | close `TOOL-17`'s three residuals |

**Do not create** any new file under `apps/api/src/**` for the helper — it must stay at `scripts/lib/walk-read.js`
(blast radius: no walk root in this repo includes `scripts/`; a `.ts` helper under `apps/api/src/shared/quality/` would
be an input to the very gates it fixes *and* would ship test infrastructure inside `apps/api/dist`).

---

## 6. Scope, non-goals, and the honest escape hatch

- **Non-goal:** touching any `walk()` body. The `readdirSync`-ENOENT-on-a-vanishing-**directory** residual stays open
  and stays recorded — it is a different seam and nothing in this repo writes a probe directory.
- **Non-goal:** any production code, Prisma schema, controller, DTO or route. If you find yourself editing one, stop.
- **Non-goal:** turning any floor into an exact count. Floors stay `>=`.
- **The escape hatch, and it is a success not a miss:**
  - if **R1** of AC-8 proves too large for one slice, **say so, skip R1, and ship R2** — a grep is never an acceptable
    substitute. Record R1 as a named residual with the reason and the measured cost;
  - if any residual **does not reproduce** on the tree you have, **do not implement it** — report that with the
    evidence instead. §1's brief already contained one measured-false claim (§1, `portal-landing:520`); assume there
    may be another.

## 7. Gates

`G-DNC` only, and `DNC-08` is the whole story. `G-TENANT`, `G-AUTHZ`, `G-MIGRATION`, `G-AUDIT`, `G-TRUTH` and
`G-PORTAL` do **not** trigger and are **not** claimed: no Prisma query, no `schema.prisma` or SQL, no controller,
guard or DTO, no privileged mutation, no read projection or KPI, nothing rendered in any portal.

## 8. Hard constraints (repeated because they are cheap to forget)

- **Never** run `pnpm build`, `next build`, `docker build`, `docker compose`, or `infra/pilotage.sh update|rebuild|reset`.
  This host's Docker **engine is wedged** (`TOOL-19`) — `docker ps` never answers. Nothing here needs it.
- **Only the test-architect** runs `pnpm typecheck`.
- **Never** `git add .claude/`.
- **No new dependency** (the NestJS v10 pin breaks by accident that way). `typescript` is already a root devDependency.
- **No probe file** in the shared checkout — `mkdtempSync(tmpdir())` only.
- Write markdown with the Write tool or `node -e '…'` in **single** quotes: backticks inside `node -e "…"` execute.
