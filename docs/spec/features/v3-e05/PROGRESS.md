# V3-E05 — AuthN/AuthZ hardening and permission integrity

**Layer** L0 · **Size** L · **Depends on** — (may run in parallel with `V3-E03`; disjoint seams: guards/DTOs vs read projections) · **Blocks** nothing
**Owns** PF-07, PF-08, PF-09, PF-10, PF-11, PF-25, PF-26, PF-46, PF-51, PF-52, PF-53, **PF-102**, VAL-07 · **Gates** G-AUTHZ, G-TENANT, G-PORTAL, G-DNC
**Status (2026-08-10)** `in-progress` — **two slices have landed**: `S-E05-12` (2026-08-07) and **`S-E05-1` — one CSV
neutraliser, lifted into `@pilotage/contracts`** (2026-08-10, closes `PF-168`). `S-E05-2` … `S-E05-11` and `S-E05-13`
still exist as **rows in
[`docs/daily-improvement-v3/traceability-matrix.md`](../../../daily-improvement-v3/traceability-matrix.md) only** —
`docs/daily-improvement-v3/stories/sprint-01.md` enumerates no story for them, so none is implementable without an
authoring run first.

> **⚠️ `S-E05-1` was a COLLIDING id, and the collision was resolved in favour of the operator override.** This epic's
> matrix already carried an unenumerated `S-E05-1` — *"Global custom roles are cross-tenant (`PF-08`) + `VAL-07`"*. The
> `2026-08-10` operator override named `S-E05-1` as **the CSV neutraliser slice**, and per the routine's own rule the
> override wins outright. Nothing was overwritten: the `PF-08` row had never been enumerated or implemented. It is
> **renumbered `S-E05-13`** below and in `traceability-matrix.md` — `S-E05-12` was the highest id in use, so `13` is the
> next genuinely free one. Recorded rather than silently absorbed, because two ids meaning two things is exactly how a
> later run implements the wrong slice.

**Next slice → `PF-173` — make the CSV escaper unbypassable, not merely unique.** `S-E05-1` shipped a **count-based**
ratchet: all five of its rules are conditioned on an escaper *existing*, so a surface that hand-joins user data (or
calls `csvRow`, a bare `cells.join(CSV_SEPARATOR)`) declares nothing and passes while shipping the exact defect
`PF-168` names — and one such site is live today at
`apps/web/src/app/teacher/reports/_components/ExportReportButton.tsx:68`. Two epics ago this codebase solved the
identical shape with a **branded type** (`ADR-035`, `write-audit.ts`, `64f64dd` — *« a brand that makes it a type error
to leave it »*); `csvEscape`/`csvFixed1` returning a branded `CsvCell` accepted only by `csvRow`/`buildCsv` does the
same here, across seven call sites and no runtime change. Bundle with it the `node:vm` spec that **executes**
`apps/web/src/lib/csv.ts` — nothing does today.

**`PF-169` remains the epic's most-owed item**, ranked behind `PF-173` only because it is larger. `S-E05-1`
deliberately did **not** take it (see the slice row below): the `;`+CRLF vs `,`+LF contradiction needs a **versioned,
announced** format change with the consumer census `ADR-037` D6 defines, not a drive-by inside a security fix. It is
named in a code comment in `apps/web/src/lib/csv.ts`, in `packages/contracts/src/security/csv-injection.ts` and in
`ADR-037` D8 so it cannot be inherited silently.

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
| **S-E05-1** | One CSV neutraliser, lifted into `@pilotage/contracts`, so the web exports stop shipping executable free text | ⚠️ done — **needs human review** (`[security]` tag) | 2026-08-10 | spec: [`stories/S-E05-1.md`](./stories/S-E05-1.md) · **`PF-168` closed**; **`PF-169` deliberately NOT taken** and left open with its reason recorded in code and in `ADR-037` D8 · decision: **`ADR-037` D8** · ratchet: `scripts/csv-escape-check.js` (`ci-gate.sh` stage 0d-bis + `ci.yml` lint job), driven by `apps/api/src/shared/quality/csv-escape-gate.spec.ts` · **count correction on the record:** `PF-168` said 2 `csvEscape` copies; the measured number was **3**, and **5** counting the two `escapeCell` copies its grep could not see · **raises `PF-173`** (the ratchet enforces uniqueness, not coverage) · **three** behaviour deltas, the third found at land |
| S-E05-13 | Global custom roles are cross-tenant (`PF-08`) + `VAL-07` | ⬜ unenumerated | — | matrix row only — no story in `sprint-01`. **Renumbered from `S-E05-1`** on 2026-08-10 (id collision, see the header note); never enumerated or implemented under either id |
| S-E05-2 | Privilege minting (`PF-09`) | ⬜ unenumerated | — | matrix row only |
| S-E05-3 | Coefficient-matrix foreign-tenant write (`PF-10`) | ⬜ unenumerated | — | matrix row only |
| S-E05-4 | Notification dedup is not tenant-scoped (`PF-11`) | ⬜ unenumerated | — | matrix row only |
| S-E05-5 | Attendance reads without ABAC (`PF-07`) | ⬜ unenumerated | — | matrix row only |
| S-E05-6 | Unvalidated PATCH / query params / enum (`PF-51`) | ⬜ unenumerated | — | matrix row only; `S-E06-6` fixed **one DTO** of this family |
| S-E05-7 | Public unthrottled registration (`PF-46`) | ⬜ unenumerated | — | matrix row only |
| S-E05-8 | Wrong password reported as "MFA required" (`PF-25`) | ⬜ unenumerated | — | matrix row only |
| S-E05-9 | Logout / `session.error` / nine phantom auth routes (`PF-26`, `PF-91`) | ⬜ unenumerated | — | matrix row only; `PF-91` is inventoried in `scripts/link-integrity-baseline.json` by `S-E06-3` |
| S-E05-10 | Unused `hasPermission`, `users.suspend` unimplemented (`PF-52`) | ⬜ unenumerated | — | matrix row only |
| S-E05-11 | Non-atomic invite/permission rewrite, catalogue drift (`PF-53`) | ⬜ unenumerated | — | matrix row only |

---

## S-E05-1 — evidence (2026-08-10)

### What the slice changed

**One new module, five deleted escapers, one new ratchet, one ADR amendment.**

- **`packages/contracts/src/security/csv-injection.ts` (NEW).** `CSV_INJECTION_TRIGGERS`, `CSV_NEUTRALISER` and
  `neutraliseCsvCell(value) → { text, neutralised }`, declared **once** and re-exported through `security/index.ts` →
  `src/index.ts`. Pure and import-free — no `zod`, no `node:*` — because it runs in a browser bundle, in a Node worker
  and inside a `require()`-based gate script. **No class and no `instanceof`**: contracts resolves `types → src`,
  `default → dist` (CJS, `ADR-037` D5, `dist/` git-ignored), so a spec and a runtime hold two different module objects;
  a plain function returning an object literal cannot disagree with itself across that seam. The address is **not
  novel** — `security/csp.ts` is already a pure security function at it, shared between the edge middleware and a gate.
- **Five escapers deleted, two remain.** `apps/web/src/lib/csv.ts#csvEscape` (web dialect: quote set keeps `;`, join
  `;` + CRLF + BOM) and `apps/worker/.../audit-csv.generator.ts#csvEscape` (worker dialect: quote set `[",\n\r]`,
  join `,` + LF, both frozen by `ADR-037` D4/D6). The three private copies in `AlertsExportButton.tsx`,
  `parent/grades/GradesExport.tsx` and `parent/attendance/AttendanceExport.tsx` are gone.
- **`scripts/csv-escape-check.js` (NEW) + both harnesses.** `ci-gate.sh` **stage 0d-bis** (between the audit-write
  stage and schema drift, **outside every `--quick` guard**) and its own step in `ci.yml`'s lint job — `ci.yml`
  re-lists stages individually and never calls `ci-gate.sh`, which was verified rather than assumed.
- **`docs/adr/ADR-037` D8**, taken under the forward reservation `S-E04-11` left (« a later amender reserves D8
  onward »), with the header-table pointer, D9+ re-reserved, and D7's false sentence **struck through in place**.

### The measurement that mattered: `PF-168`'s own count was wrong, and the gate is built around why

`PF-168` recorded *« the sprint reported 3× `csvEscape`; the real count is 2 »*. Measured at `8e52da0`: **3**
`csvEscape` declarations and **5** distinct CSV escapers, because two were named `escapeCell`. The finding grepped for
the **name**. That blind spot is the design input for the ratchet, not a footnote:

- rule A matches by **shape** (a body that tests a `"`-bearing character class **and** performs the RFC-4180
  `.replace(/"/g, '""')`) as well as by name;
- the walk root includes **`.tsx`** — three of the five copies lived in components, and a `.ts`-only walk would have
  certified a surface it could not see;
- rule B catches the trigger set assembled anywhere else, i.e. a copy that simply avoided the name;
- rule D makes a **stale exclusion** a failure, so the two `apps/api` transport-CSV comments stay true or CI goes red;
- rule E: no env var, no `--update`. On a two-row ceiling an « update the ceiling » flag *is* the off switch.

The gate is AST-parsed rather than grepped for a concrete reason: four files quote the trigger array **in prose**, so a
regex gate would false-red and the pressure would be to weaken rule B.

### What executed

| Check | Result |
|---|---|
| `pnpm typecheck` (Murat, **once**, main checkout) | **exit 0**, 13/13 Turbo tasks, 2m04s. `@pilotage/api` a genuine **cache miss**, so the new spec really compiled. `csv-injection.ts` resolves through the CJS build for both the worker and the `'use client'` web bundles |
| `node scripts/csv-escape-check.js` | **PASS, exit 0** — 4 escapers over 6 roots: 2 sanctioned (`apps/web/src/lib/csv.ts:58`, `audit-csv.generator.ts:287`), both **importing and calling** `neutraliseCsvCell`; 2 named `apps/api` exclusions; 0 unaccounted. Grep-verified independently; watched **red both ways** with a real `.tsx` probe |
| `npx jest src/shared/quality/csv-escape-gate.spec.ts` (api) | **54/54 PASS**, 42 s. Rules A–E each driven red **independently**, DNC-08 driven 8 ways against a real scratch tree, DNC-10 asserted in the negative |
| `npx jest audit-csv.generator.spec.ts` (worker) | **RED at gate time — 1 failed / 72 passed**, and the failing assertion was the **claim**, not the code. Corrected at land; see the delta section below |
| `git diff --check` | **exit 0**. The three CRLF lines are `core.autocrlf` advisories, not errors |
| `ADR-037` `### D8` | present |

### Three behaviour deltas — all intended, all stated here rather than discovered

1. **A guardian phone `+33 6 12 34 56 78`** exports as `"'+33 6 12 34 56 78"`. Accepted, not accidental: uniform beats
   an allowlist (`ADR-037` D7). `-` is a trigger and a leading `+` is one too.
2. **`admin/alerts`' `=1+1`** was emitted **bare** as `'=1+1` — the old private copy prefixed the cell and then tested
   the **original** against its quote regex. It now emits `"'=1+1"`. `PF-168` called that copy « already correct »;
   that holds for the neutralisation and **not** for the force-quoting.
3. **The two parent exports gain comma-quoting — found at LAND, not at implementation.** The deleted `escapeCell`
   quoted on `/[";\r\n]/`, with **no comma**; the shared `csvEscape` quotes on `/[",;\n\r]/`. `Note /20`
   (`scoreOn20`, a French decimal `"15,0"`) and `Coefficient` therefore now ship `"15,0"` / `"1,5"`, so **every row of
   the parent grades export changes bytes**, and any comma-bearing `Justification` / `Commentaire` on attendance does
   the same. It parses identically under `;`. **The implementation shipped a comment asserting the opposite** — « they
   stay byte-identical » — in `GradesExport.tsx` and a matching false « the quote set is the one this file already
   used » in `AttendanceExport.tsx`. Both comments are corrected in this diff and the delta is pinned by a named test
   case. Recorded this way because a false sentence inside a security module is what the next editor trusts instead of
   re-measuring.

### `main` was red at the gate, and the assertion was what was wrong (`R-30`)

`audit-csv.generator.spec.ts` asserted `escapeWebDialect('a,b') === 'a,b'` under the name *« a `,` quotes in the worker
and does NOT quote on the web »*. `/[",;\n\r]/` is a class of **five** characters — the leading `",` was read as one
token — and the web has quoted on a comma at `HEAD` too. **`apps/web/src/lib/csv.ts` was not touched to satisfy it.**
The correction is not cosmetic: the two dialects are **not symmetric opposites**, the web set is a strict **superset**
of the worker's differing only in `;`, and that is exactly why `ADR-037` D8 forbids the union in the worker direction
while forbidding the reverse for a different reason (`Martin; Dupont` would unquote and break the record). The test
name, the assertion and the surrounding comment now say *superset*.

### Gates — every row answered, none blank

| Gate | Triggers? | Why |
|---|---|---|
| **G-TRUTH** | **YES — primary** | The single-home property is held by an executed ratchet with no baseline and no `--update`, watched red both ways. **What it does NOT hold is recorded as `PF-173`**, not implied away |
| **G-DNC** | **YES (always)** | DNC-10 asserted in the negative (no env var, no `--update`, only `--help`); DNC-08 vacuity and staleness driven 8 ways; DNC-06 sweep on `S-E04-11.md`, `v3-e04/PROGRESS.md` and D7's own false sentence |
| **G-TENANT** | **NO** | Verified, not assumed: zero Prisma queries, zero `where`, zero `tenantId`, zero `StudentAccessService` path. The diff renders rows the caller was already authorised to see |
| **G-AUTHZ** | **NO** | No guard, no permission, no role, no DTO |
| **G-AUDIT** | **NO** | No privileged mutation and no `AuditLog` write. The worker's audit **export** is touched, and its bytes are proven unchanged (`csvEscape('Mozilla/5.0 (… NT 10.0; Win64; x64)')` is asserted to stay bare) |
| **G-MIGRATION** | **NO** | `schema.prisma` untouched |
| **G-PORTAL** | **NO** | Three portals' export surfaces are touched, but by one shared escaper with no portal-conditional branch |

### Not claimed by `S-E05-1`

| What is NOT claimed | Detail | Owner |
|---|---|---|
| **The ratchet closes *duplication*, and is blind to *omission*** | All five rules are conditioned on an escaper **existing**. A surface that hand-joins user data — or calls `csvRow`, a bare `cells.join(CSV_SEPARATOR)` typed `Array<string \| number>` — declares no escaper, assembles no trigger set and **passes every rule while shipping the exact defect `PF-168` names**. The live instance is `teacher/reports/_components/ExportReportButton.tsx:68`, `` lines.push(`Année;${academicYear?.name ?? ''}`) ``: tenant-authored text, no escape, no quoting, and Excel evaluates a formula in **any** column. Pre-existing; the slice's own header claimed the surface was covered, and that claim is **narrowed at land** in `apps/web/src/lib/csv.ts` and in the gate's sanctioned-entry reason. **The repo already owns the stronger mechanism**: `ADR-035` / `write-audit.ts` (`64f64dd`, *« a brand that makes it a type error to leave it »*) solved this shape with a branded type. `csvEscape`/`csvFixed1` returning a branded `CsvCell` that `csvRow`/`buildCsv` alone accept would convert « we count escapers » into « you cannot emit an unescaped cell » — and would retire rule C's status as the only executed evidence for the web half | **`PF-173`** |
| **`PF-169` — the dialect** | Declined on purpose, in three places so it cannot be inherited silently. See the epic header | `PF-169`, this epic |
| **Nothing executes `apps/web/src/lib/csv.ts`** | `apps/web` has Playwright only (`PF-129`/`PF-133`), and the worker spec's `escapeWebDialect` is a hand-written **mirror** that never imports the real file — a mirror that **drifted from it inside this same commit**, which is the proof it is not evidence. Rule C proves an import and a call exist; it cannot see what is composed, so the mutation this slice exists to close (test the quote regex against the **original** `v` rather than the neutralised `text` — exactly what the `admin/alerts` copy did) would pass every rule, typecheck and test here. The test-architect specified a `node:vm` spec that transpiles and executes the real module from the api jest project (one import, no top-level DOM access, `typescript` already `require`d by the sibling gate spec). **Not written in this slice** | next `V3-E05` slice |
| **No browser and no spreadsheet** | No export button was clicked and no `.csv` was opened in Excel or LibreOffice. The three byte deltas are proven by assertion over the escaper, not by a rendered file | `VAL-08` |
| **`ci.yml`'s stage is aspirational until billing clears** | The step is added in step with `ci-gate.sh` per `S-E02-2` AC-4, but with GitHub Actions billing-locked since 2026-07-28 (`PF-113`) the only **executing** enforcement is `ci-gate.sh`. The « blocking » language in both comments is a statement of intent | `PF-113` |
| **A leading *space* is not a trigger** | `' =1+1'` — Excel with « trim spaces » on import, and Google Sheets on paste, both strip it and evaluate. This is `HEAD` behaviour carried over byte-for-byte, so it is not a regression; the shared module is now the single place where adding it costs one character | next `V3-E05` slice |
| **An *embedded* tab is neither neutralised nor quoted** | Only the **first** character is inspected, and `[",;\n\r]` has no `\t`, so an embedded tab splits a cell on paste. Pre-existing on both surfaces, unchanged here | next `V3-E05` slice |
| **`apps/web` now pulls the `@pilotage/contracts` CJS barrel into seven client bundles** for one 6-line function; `__exportStar` defeats tree-shaking. **31 web files already do this**, so it is precedent rather than regression — but D8's « no `./security` subpath » call makes it permanent, and two of the seven are parent-portal routes under the **<2 s** north star. **Cost unmeasured** | next `V3-E05` slice |
| **`evaluateCsvEscapers` reads a field its own extractor never sets** | `scripts/csv-escape-check.js` — `escaper.fileImportsShared` is attached only in `main()`, so piping the exported extractor straight into the exported reconciler yields a spurious rule-C problem. The spec dodges it with hand-built records. Cosmetic; the exported core's contract should include the field | next `V3-E05` slice |
| **The barrel chain is checked at two of three links** | The gate verifies `security/index.ts` re-exports `./csv-injection`, never that `src/index.ts` re-exports `./security`. It holds today (`packages/contracts/src/index.ts:7`); a third DNC-08 assertion would close it | next `V3-E05` slice |
| **`node scripts/test-ratchet.js worker\|api` was not run** | CPU budget. The new spec passes standalone, so no `known-test-failures.json` entry is owed — but the **whole** worker suite was last driven before the land-pass correction to `audit-csv.generator.spec.ts` | run-scope note |

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

## Next run

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
