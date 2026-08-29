# V3-E03 — Canonical truth and query contracts

**Layer** L0 · **Size** XL · **Depends on** V3-E02, V3-E01, V3-E05, V3-E04 · **Blocks** V3-E07, V3-E09, V3-E11 → all of L1+
**Owns** PF-04, PF-05, PF-12, PF-15, PF-20, PF-24, PF-36, PF-40, PF-50 · **Gates** G-TRUTH, G-PORTAL (this slice also G-TENANT, G-DNC)
**Decisions** D-09 (canonical KPI definitions — `resolved` 2026-08-13, `ADR-041`)

**Status (2026-08-29)** `in-progress` — **FOURTEEN slices landed, and there was none before 2026-08-25.**

`S-E03-10b` (run 97, 2026-08-29 — **`PF-380`, `PF-382`, `PF-383` and `PF-386` claimed `closed` on remedies that are
IN THE DIFF; `PF-24` ADVANCED and explicitly NOT closed**, `ADR-083`; the terminal-key convention gets its retention
bound, its ADR and its status predicate back. `S-E03-10` fixed `PF-24` by giving every settled row a per-row
`terminalCoalesceKey` — and in doing so deleted the table's only ceiling, because
`@@unique([tenantId, coalesceKey, status])` **was** both the bug and the bound. Measured this run: **one**
`snapshotRecomputeTrigger.delete*` in the entire repository, and it is a race-case drop, not retention. A new
`sweepTerminalTriggers()` runs every 10th tick, deletes at most 500 rows shared across tenants, keys every query on
one `tenantId`, and **re-asserts the full predicate at write time** because terminal-ness flips under
`reviveFailedTriggers`. **Two things this slice got RIGHT by measuring instead of assuming**, and both are worth
copying: the three `expectedStatus` values were **read at their call sites**, not inferred by symmetry; and the
terminal settle was deliberately left unguarded after measuring that the predicate would be a **regression** there
(a recompute outliving `STALE_PROCESSING_MIN` would settle zero rows and pin `recomputing: true` forever). **NEEDS
HUMAN REVIEW, and the two conditions are not cosmetic:** the sweep's own tenant enumeration is an unbounded,
unindexed read of the very population it exists to bound (`PF-451`), and **no test drives `tick()`**, so the line
that wires the sweep in is unmeasured. Records **`PF-451`…`PF-456`**. **Zero live probes** — Docker down a
**seventh** consecutive run. See § `S-E03-10b`).

> **Third ledger correction, 2026-08-28 (`S-E03-11` land pass) — the count, not the rows.** This line read
> *"ELEVEN slices landed"* while the **Slice status** table below already carried **twelve** rows
> (`S-E03-4`, `2`, `3`, `3b`, `3c`, `5`, `3d`, `6`, `8`, `10`, `7`, `9`). `bmad/roadmap.md` read *"12 slices
> landed"* and was right. Same class as the two corrections recorded further down, one axis over: the rows were
> maintained, the **prose count above them was not**, and the two files disagreed by one for a full run. Corrected
> here to **thirteen** (twelve + `S-E03-11`) rather than silently bumped by one, so the discrepancy is on the record.

`S-E03-11` (run 95, 2026-08-28 — **`PF-50` and `PF-427` both ADVANCED, neither closed**, `ADR-081`; the page
envelope becomes a CONTRACT and the client stops ASSERTING the shape it reads. `api<T>()` ended in
`return (await res.json()) as T` — an **assertion**, never a check — so a paginated response contract was
hand-written twice, once in the server's `return` and once in the page's `interface`. Measured: **211 `api<…>(`
call sites over 117 files**, **ten** of them hand-declaring a `data` + `total` envelope. Run 94 had already
committed and repaired exactly that defect **inside one run** — `totals` emitted, `summary` read, both halves
typechecking green, four KPIs rendering `—`. One `pageEnvelope()` factory now lives in
`packages/contracts/src/pagination/page-envelope.ts` beside `pageWindow`; two API emitters **declare** their
return shape and four admin readers **parse** it, raising a `ResponseShapeError` that **names the offending key**
instead of rendering a wrong number. Records **`PF-428`…`PF-433`**. **NEEDS HUMAN REVIEW, and the first landing
condition is not a code fix:** `packages/contracts` must be **rebuilt** before the app runs, or all four converted
pages throw at module load while every gate stays green. **Zero live probes** — Docker down a **sixth**
consecutive run. See § `S-E03-11`).

`S-E03-9` (run 94 — **`PF-50` ADVANCED and explicitly NOT closed**, `ADR-080`; one page window, one cap, one
place, and a negative `limit` stops silently inverting the result set. Thirteen hand-rolled
`parseInt`/`Math.min`/`ParseIntPipe` window parsers — **five defaults, four caps, three incompatible answers to an
invalid input** — become one `pageWindow({ def, max })` factory in `packages/contracts/src/pagination/`, and
`GET /teaching-assignments`, the epic's last unbounded `findMany` with four nested `include`s, gains
`take`/`skip`/`total` plus **server-side** KPI aggregates and a named-scope coverage block, so the admin
assignments page stops deriving a whole-SET claim from one page's array (`PF-421`). `PF-422` and `PF-423` fixed in
the same slice. **The residual is NAMED, not hidden:** `PF-426` — 151 of 210 `findMany` call sites still carry no
`take`, frozen by a ratchet spec that fails on 152. **NEEDS HUMAN REVIEW: this is a breaking change** — over-cap
`limit` now returns **400** instead of clamping — and the slice ships **one RED test of its own** plus **zero live
probes**. See § `S-E03-9`).

`S-E03-10` (run 89, merged 2026-08-27 after a conflict resolution — `PF-24` **advanced and NOT closed**:
the snapshot drain can now reach a terminal state on the *second* recompute of a scope, so `recomputing`
can stop pinning true. **Nothing has been executed against Postgres** (Docker was down for the whole run),
the slice ships **no story spec and no ADR** (`PF-386`/`PF-387`), and the fix removes the table’s only —
accidental — retention bound (`PF-380`). Renumbered from `S-E03-6`, which run 91 took for `PF-20`).

`S-E03-7` (run 93 — **claims `PF-36` as the CLASS of derivations converted**, `ADR-079`; « combien d’élèves dans
cette classe » cesse d’avoir quatre réponses, et la somme d’effectifs cesse d’être présentable comme un nombre
d’élèves. **`PF-410`, `PF-412` et `PF-418` fermées ; `PF-409`, `PF-411`, `PF-413`…`PF-417` enregistrées ;
`PF-361` annotée, id conservé.** La tranche avait posé sa revendication `PF-36` comme CONDITIONNELLE et **la
passe de land a levé les conditions plutôt que de les reporter** : `PF-412` est corrigée pour de bon (la ligne
affirmait un remède absent du diff), l’éventail de lignes que la tranche avait introduit est revenu à des
agrégats SQL (`PF-418`), et le septième nombre changé — le `studentCount` par cycle d’`admin/dashboard` — est
déclaré. **Ce qui reste vrai et n’est PAS revendiqué : les 43 / 46 / 48 et 25 / 26 de l’audit ne sont pas
re-mesurés** — Docker à l’arrêt, `enrollment = 0` en local — et l’accord `AC-4` est prouvé sur l’axe de la
dé-duplication seulement, la fixture étant mono-année (`PF-413` porte l’axe de l’année). Voir § `S-E03-7`).
`S-E03-8` (run 92 — **claims `PF-40`**, `ADR-078`; the school calendar stops counting the same events four
different ways, and a counter stops changing after page load. **The claim is CONDITIONAL and the condition is
written down:** the escalation panel returned **NO-GO** on three executed RED tests inside the slice's *own*
gates, none at baseline, and `OPEN.md` is untouched. See § `S-E03-8` — and note that for two of the three the
cheapest way to green would silently re-open `PF-406`).
`S-E03-6` (run 91 — **`PF-20` CLOSED entire**, the epic's second roadmap finding and the first closed *whole*,
with `PF-378` and `PF-63`; `ADR-077`; « Alertes configurées » stopped being the length of a constant that had
itself already drifted, four codes against the enum's eight. Raises `PF-398`).
`S-E03-3d` (run 89 — **`PF-356` and `PF-363` CLOSED**, `PF-12` **advanced a FOURTH time and still NOT closed**
because axes 8 (`PF-359`) and 9 (`PF-360`) stand, `ADR-076`; the parent list and the parent detail page now
return the same population of children, and a failed `/students` read stopped being a claim about the family).
`S-E03-5` (run 86 — **`PF-373` CLOSED**, `PF-20` **advanced and NOT closed** because its « alertes » half is
alive at two mechanisms (`PF-378`), `PF-371` advanced, `ADR-075`; the admin « Demandes » queue now reads the
population it claims to read, and the KPI above it changed value on purpose — tenant-wide → school).
`S-E03-3c` (run 85 — **`PF-358` CLOSED**, `PF-12` advanced a third time and still not closed, `ADR-074`; the
guardianship predicate now has exactly ONE home). Roadmap findings owned by this epic: **2 closed of 9**
(`PF-15` on one axis of two; `PF-20` entire, run 91), **`PF-40` claimed by `S-E03-8` and not yet merged**, with
`PF-04`, `PF-05`, `PF-12` and `PF-36` advanced-not-closed — so the standing
`V3-E03` directive (four of nine before another epic may be chosen freely) **still binds**. The four earlier
slices: `S-E03-4` (run 80 — `PF-15` closed on ONE AXIS OF TWO with `PF-328`
as the named residual, `PF-04`/`PF-36` advanced not closed, `ADR-070`). `S-E03-2` (run 81 — **`PF-288` CLOSED as
a class**, `PF-05` **advanced not closed**, `ADR-071`). `S-E03-3` (run 82 — `PF-12` **advanced not closed**:
three of nine measured axes removed, `PF-357` — the audit's own third clause — untouched, `ADR-072`).
`S-E03-3b` (run 83 — **`PF-357` CLOSED**, `PF-12` **advanced again and still not closed** because `ADR-073
§D11`'s own re-check failed, `ADR-073`). All four were flagged ⚠️ P1 at the sprint pass; the first three nonetheless auto-merged green (PRs #273, #274, #275 — #275 prefixed `[high-risk]`), which is what the routine's gate decision actually does with a P1 slice whose gates carry evidence. Corrected at run 84: the earlier wording claimed 'none auto-merged', and `gh pr list` contradicts it.

> *Numbering correction, run 81:* the entries below originally dated `S-E03-4` to "run 79". The selection log
> (`scheduled-tasks/daily-improvement-v3/state/selection-log.jsonl`) records `S-ROUTINE-1` as run 79, `S-E03-4`
> as run 80 and `S-E03-2` as run 81. The `OPEN.md` rows already say run 80; this file was the outlier.

---

## 0. Read this before anything else — this epic has no spec-kit

**`V3-E03` has never had an `epic-spec` run.** When `S-E03-4` was authored on 2026-08-25, `docs/spec/features/`
contained `v3-e01`, `v3-e02`, `v3-e04`, `v3-e05`, `v3-e06` and **no `v3-e03`** — no `spec.md`, no `tasks.md`, no
`data-model.md`, no `contracts/openapi.yaml`, and no `PROGRESS.md`. **This file is the epic's second written
artefact**, after the story itself; it was created *by* `S-E03-4` precisely so the next slice has a ledger to read.

Three consequences a later run must not rediscover:

1. **There is no enumerated slice backlog, so there is no denominator.** `S-E05`'s ledger says "12 of 12" and its
   own PROGRESS file explains at length why that number is "numerically true and semantically false". `V3-E03`
   starts clean: it says **"1 slice landed"** and nothing else. Do not write "1 of 9" — nine is the count of
   *findings the epic owns*, not of slices, and the mapping is not 1:1 (`S-E03-4` alone touches three of them).
2. **Slice ids come from `docs/daily-improvement-v3/traceability/OPEN.md`, not from a `tasks.md`.** `S-E03-4` is
   named there (`OPEN.md:117` — `PF-15 stale active academic year | V3-E03 | S-E03-4 | open`). The ids `S-E03-1`,
   `S-E03-2`, `S-E03-3`, `S-E03-5`… existed as matrix rows only *(all three have since been authored and landed — runs 81, 82 and 86, joined by `S-E03-6` at run 91, `S-E03-8` at run 92 and `S-E03-7` at run 93; only `S-E03-1` still has not)* and are **not implementable without an authoring
   pass of their own** — the same posture the `V3-E05` ledger records for its six unenumerated rows.
3. **An `epic-spec` run for `V3-E03` is still owed and is still the highest-leverage thing available for this
   epic.** `S-E03-4` deliberately did not do it: writing a spec-kit is an `epic-spec` run, not a slice, and
   conflating the two is how a P1 tenancy diff turns into a 4 000-line PR nobody can review.

**Why the epic sat at 0/9 for 22 days.** It is the largest epic in L0 (XL) and it was blocked on `D-09` until
2026-08-13 (`ADR-041`). After `D-09` resolved, nothing scheduled it: 78 runs closed 119 findings and 13 of them were
roadmap findings. `S-ROUTINE-1` (2026-08-23, `ADR-069`) made `RULE 0` enforceable **at selection time**; `S-E03-4`
is the first roadmap slice selected under that ledger, and it is the first `V3-E03` slice ever.

---

## Slice status

| Slice | Finding(s) | State |
|---|---|---|
| **`S-E03-4`** — canonical academic-year resolution | `PF-15` (one axis of two), advances `PF-04` / `PF-36`; raises `PF-327`…`PF-330` | ⚠️ **2026-08-25, run 80 — landed needing human review (NOT auto-merged), P1 `[tenancy][truth]`** |
| **`S-E03-2`** — the parent grades read becomes ONE guarded contract, and a failed read stops rendering as "no grades published" | **closes `PF-288`** (class, both remaining sites); **advances `PF-05`** — NOT closed; raises `PF-335`…`PF-353` | ⚠️ **2026-08-25, run 81 — landed needing human review (NOT auto-merged), P1 `[authz][truth]`** |
| **`S-E03-3`** — "is this child actively enrolled" becomes ONE derivation, and the parent surfaces stop each answering it differently | **advances `PF-12`** — NOT closed (3 of 9 measured axes); raises `PF-356`…`PF-365` | ⚠️ **2026-08-25, run 82 — landed needing human review (NOT auto-merged), P1 `[truth]`** |
| **`S-E03-3b`** — the parent attachment panel projects from the FACT (`Guardianship`), with `GuardianshipClaim` as provenance only | **closes `PF-357`**; **advances `PF-12`** — still NOT closed (`ADR-073 §D11` re-check failed); raises `PF-367`…`PF-371` | ⚠️ **2026-08-26, run 84 — landed needing human review (NOT auto-merged), P1 `[truth][security]`** |
| **`S-E03-3c`** — ONE guardianship liveness predicate, and a delete guard whose own remedy could never unblock it | **closes `PF-358`**; **advances `PF-12`** — still NOT closed; raises `PF-372`…`PF-376` | ⚠️ **2026-08-26, run 85 — landed needing human review, P1 `[truth]`** |
| **`S-E03-5`** — « combien de demandes de rattachement attendent l’admin, et la page où j’atterris dit-elle la même chose » becomes ONE derivation | **closes `PF-373`**; **advances `PF-20`** — NOT closed (the « alertes » half is `PF-378`) and **advances `PF-371`**; raises `PF-377`…`PF-379` | ⚠️ **2026-08-26, run 86 — landed needing human review, P1 `[truth]`** |
| **`S-E03-3d`** — the parent LIST stops disagreeing with the parent DETAIL page, and a FAILED read stops being an emptiness claim about the family | **closes `PF-356`** (axis 4) and **`PF-363`** (axis 7); **advances `PF-12`** a fourth time — still NOT closed (axes 8/9 = `PF-359`/`PF-360`); raises `PF-389`…`PF-393` **plus `PF-396`/`PF-397` cited in shipped source with no ledger row — see the landing conditions** | ⚠️ **2026-08-27, run 89 — landed needing human review (NOT auto-merged), P1 `[authz][truth]`** |
| **`S-E03-6`** — « Alertes configurées » stops being the length of a constant, and that constant had already drifted (4 codes against the enum's 8) | **closes `PF-20`** (entire — the epic's second finding and its first closed *whole*), **`PF-378`**, **`PF-63`**; `ADR-077` rules « configured » = the rules **enabled in this school**, a persisted collection, with the KPI going 4 → 0 as an owned consequence; raises `PF-398` | ⚠️ **2026-08-27, run 91 — landed needing human review, P1 `[truth]` (PR #281)** |
| **`S-E03-8`** — the school calendar stops counting the same events four different ways, and a counter stops changing after page load | **claims `PF-40`** (A1 divergent month predicate per portal · A2 KPI band ignoring the active filter · A3 a truncated `.length` rendered as a total · A4 the clock read *during render* of server-rendered client components); `ADR-078` rules D1–D4 + the `FreshnessChip` non-transfer test; **`PF-406` volet 1 found by the panel and fixed in-slice** (the anchor was carrying the *process* zone, UTC in the shipped container, against a `Europe/Paris` school); raises `PF-399`…`PF-406` | ⚠️ **2026-08-27, run 92 — NEEDS HUMAN REVIEW, do NOT auto-merge. Panel verdict NO-GO: three executed RED tests in the slice's own gates, none at baseline; `OPEN.md` untouched. Conditions in § `S-E03-8`** |
| **`S-E03-10`** — a snapshot recompute trigger can reach a terminal state on the **second** recompute of a scope | **advances `PF-24`** — NOT closed (no executed proof against Postgres); raises `PF-380`…`PF-388` | ⚠️ **2026-08-26, run 89 — needs human review, P1 `[truth][worker][schema-adjacent]`. NOT auto-merge: `PF-380` is a blocking merge condition.** (`PF-381`, the test-architect's NO-GO, was raised AND closed inside the run: the mechanism evidence it prescribed was built at the land pass, a fourth conflict site — the claim — was found and fixed there, and the test excess is back to zero.) |
| **`S-E03-7`** — une classe n'a qu'UN effectif : « combien d'élèves dans cette classe » cesse d'avoir quatre réponses, et la somme d'effectifs cesse d'être présentable comme un nombre d'élèves | **claims `PF-36`** as the CLASS of derivations converted; **closes `PF-410`** (structure header counted tenant-wide) and **`PF-412`** (count without `tenantId`); **annotates `PF-361`** (id preserved, live-database re-measurement); raises `PF-409`, `PF-411`, `PF-413`, `PF-414`, `PF-415`; `ADR-079` | ⚠️ **2026-08-27, run 93 — NEEDS HUMAN REVIEW, do NOT auto-merge. P0 `[truth][tenant][contracts][cross-portal]`.** Landing conditions in § `S-E03-7`: the `PF-36` and `PF-362` rows of `OPEN.md` are still `open`, and the `PF-412` row asserts a remedy that is not in the diff |
| **`S-E03-9`** — one page window, one cap, one place; and a negative limit stops silently inverting the result set | **advances `PF-50`** — explicitly **NOT closed** (`AC-7`, named residual = `PF-426`); **fixes `PF-421`, `PF-422`, `PF-423`** in-slice; raises `PF-419`, `PF-420`, `PF-424`, `PF-425`, `PF-426`; `ADR-080` | ⚠️ **2026-08-27, run 94 — DONE, needs human review, do NOT auto-merge. P1 `[api-contract][truth][breaking-change]`** (re-tiered from P2 at the gate: thirteen endpoints now **reject** an over-cap `limit` instead of clamping it). Story `docs/daily-improvement-v3/stories/S-E03-9.md`; ADR `docs/adr/ADR-080-canonical-page-window.md`; canon `packages/contracts/src/pagination/page-window.ts`; ratchet `apps/api/src/shared/quality/page-window-derivation-gate.spec.ts` (`CENSUS_CEILING = 151`). **Evidence tier B — no live probe was possible** (Docker down for a fifth consecutive run, local DB empty): `pnpm typecheck` 13/13 green **only after** the two halves were consolidated into one checkout, the ratchet spec passes, and `page-window.spec.ts` still has **one RED test** (`AC-8 / G-TENANT` hard-codes SEVEN reads; the handler now issues EIGHT, all tenant-keyed). Landing conditions in § `S-E03-9`. |
| **`S-E03-11`** — the page envelope becomes a CONTRACT, and the client stops ASSERTING the shape it reads | **advances `PF-50`** and **advances `PF-427`** (`S-E03-9`'s own named residual) — **neither closed**; raises `PF-428`…`PF-433`; `ADR-081` | ⚠️ **2026-08-28, run 95 — DONE, needs human review, do NOT auto-merge. P1 `[api-contract][truth][admin-portal]`** (re-tiered from the story's P2 at the panel: the client half turns four tolerant casts into **throwing** validation on live admin reads). Story `docs/daily-improvement-v3/stories/S-E03-11.md`; ADR `docs/adr/ADR-081-canonical-page-envelope.md`; canon `packages/contracts/src/pagination/page-envelope.ts`; ratchet `apps/api/src/shared/quality/page-envelope-boundary-gate.spec.ts` (`R1_CEILING = 1`, `R2_CEILING = 6`). **Evidence tier B — no live probe was possible** (Docker down a **sixth** consecutive run, local DB empty). Landing conditions in § `S-E03-11`; the first of them — `pnpm --filter @pilotage/contracts build` — is a **merge precondition**, not an optimisation. **Slice id renumbered `S-E03-10` → `S-E03-11` at the land pass**: `S-E03-10` was already taken by the run-89 snapshot slice, and the collision had been stamped into fourteen shipped docblocks |
| **`S-E03-10b`** — the terminal-key convention gets its retention bound, its ADR, and the status predicate `requeueCanonical` had dropped | **closes `PF-380`** (the retention bound), **`PF-382`** (the dropped status predicate), **`PF-383`** (`lastError` retained through fail → retry → success), **`PF-386`** (the missing ADR + the stale `schema.prisma` comment); **advances `PF-24`** — still **NOT closed**, the executed-against-Postgres half is untouched; raises `PF-451`…`PF-456`; `ADR-083` | ⚠️ **2026-08-29, run 97 — NEEDS HUMAN REVIEW, do NOT auto-merge. P1 `[worker][data-retention][rgpd][destructive-delete]`.** No migration, no contracts change, no `apps/web` file, `schema.prisma` **comment only**. Story `docs/spec/features/v3-e03/stories/S-E03-10b.md`; ADR `docs/adr/ADR-083-snapshot-trigger-terminal-key-and-retention.md`. **Evidence tier B** — `pnpm typecheck` 13/13 exit 0, twelve new jest cases with real anti-vacuity controls, **zero live probes** (Docker down a seventh consecutive run, local DB empty). Landing conditions in § `S-E03-10b`: `PF-451` (the sweep's own enumeration is unbounded and fails silently), the missing `tick()` wiring test, and `OPEN.md` untouched |
| **`S-E03-2b`** — une note de ZÉRO est une note : le prédicat de valeur cesse de dépendre d'un invariant que rien n'énonce | **advances `PF-05`** — un résidu sur trois LEVÉ (il en reste deux, tous deux du ressort de `S-E03-3`) ; **`PF-339` FALSIFIÉE** par exécution, pas corrigée ; raises `PF-463`, `PF-464` ; `ADR-084` | **2026-08-29, run 99 — MERGED.** Palier **B**, cliquet obligatoire malgré le tier (fermeture réclamée comme CLASSE). `pnpm typecheck` vert ; `grade-zero-value.spec.ts` **8/8 vert après / 3 rouges avant** sur le fichier de production réel restauré ; `scripts/grade-zero-value-probe.js` **`PROBE: PASS — 5/5`** contre le Postgres du conteneur (420 notes, transaction annulée). Aucune image reconstruite (disque hôte à 5,1 Go) — la sonde n'exerce donc pas le code applicatif modifié, et c'est pourquoi la moitié comportementale est portée par jest. Axe faible nommé : seul `schoolPerformance` est couvert en comportement ; les trois sites de `parentDashboard` le sont comme CLASSE par le cliquet |
| `S-E03-1` | — | **matrix row only** — no story authored. (`S-E03-3` left this row at run 82, `S-E03-5` at run 86, `S-E03-6` at run 91, `S-E03-8` at run 92, `S-E03-7` at run 93 and **`S-E03-9` at run 94**: all six were authored, so the habit is holding. `PF-50` moved off this row at run 94 — it is `S-E03-9`'s, not `S-E03-1`'s.) |

---

## S-E03-4 — evidence (run 80, 2026-08-25)

Story: [`docs/daily-improvement-v3/stories/S-E03-4.md`](../../../daily-improvement-v3/stories/S-E03-4.md).
ADR: [`docs/adr/ADR-070-canonical-academic-year-resolution.md`](../../../adr/ADR-070-canonical-academic-year-resolution.md).

### What was actually wrong

`academic_year` was resolved **nine times by hand across seven files**, and the nine resolutions disagreed on
**four axes**:

| axis | the disagreement |
|---|---|
| **tenancy** | `school-context.service.ts:32` filtered on `schoolId` **alone** — no `tenantId` — in the service every authenticated request transits. `packages/imports-core/src/caches.ts:53` did the same, on the import **write** path. |
| **ordering** | four of the nine had **no `orderBy` at all**; the other five had `startDate desc`, which is not a total order. |
| **absence** | **three** different behaviours: `null`; a silent fallback to the most recent year of *any* status; and a fallback of `activeStudents` to the unscoped `totalStudents`. |
| **multiplicity** | `subjects.controller.ts:381` assumed *many* active years (`findMany`); the other eight assumed exactly one. |

Measured on the running stack (2026-08-25, `docker exec pilotage_postgres psql -U pilotage -d pilotage`):
`academic_year` holds **4 rows across 2 tenants**, each school has **exactly one** `active` year, and **both**
tenants' active year has already **ended** — `2025-2026` on 2026-07-05 (51 days) and `2023–2024` on 2024-07-05
(more than two years). No code path noticed. That is `PF-15` reproducing, and it is one measured mechanism of
`PF-04` (one dataset, incompatible counts across portals) and `PF-36` (teacher counts 43/46/48, a class 25/26).

### What the fix is, and why it has the shape it has

- **One module, framework-free**: `packages/contracts/src/academic-year/resolve-academic-year.ts` exports
  `resolveActiveAcademicYear` and `listActiveAcademicYears`. It imports **neither `@prisma/client` nor
  `@nestjs/*`** and adds **no dependency** to `packages/contracts/package.json` — the CJS pin of `GUARDRAILS §2` is
  untouched. Prisma reaches it through a **structural port** (`AcademicYearReader`), with a thin adapter per app.
- **`tenantId` is required by the TYPE**, not by convention: it sits on `ResolveActiveAcademicYearOptions`,
  `ListActiveAcademicYearsOptions` **and** the internal `AcademicYearWhere`, `buildWhere` puts it in every query
  **including the fallback branch**, and `requireTenantId` refuses the empty string at runtime. An unscoped
  active-year resolution is no longer merely forbidden — it is **unexpressible**.
- **The adapter is duplicated on purpose** (`apps/api/src/shared/academic-year/` and
  `apps/worker/src/shared/academic-year/`), forced by `apps/worker/tsconfig.json`'s `rootDir: ./src`. What is
  duplicated is a **wire**, not a decision (`ADR-070 §D2`). Unifying it requires changing `rootDir` first, which is
  its own ADR.
- **Twelve call sites converted, not nine.** The three extra are the callers of `buildImportCaches`
  (`imports.service.ts:515`, `integrations.service.ts:270`, `imports.processor.ts:205`), forced by hoisting the
  resolution out of `packages/imports-core/src/caches.ts`. That site is the **only one where the defect was
  PERSISTED**: `ImportCaches.activeAcademicYearId` is written into new `class_section` and `enrollment` rows by
  `handlers/classes.handler.ts` and `handlers/enrollments.handler.ts`, so a wrong resolution there corrupts data
  rather than misreporting a count. It was hoisted rather than converted in place because adding
  `@pilotage/contracts` to that package means a `package.json` + lockfile + **two production Dockerfile** edits
  that no agent in this run is allowed to build and verify.
- **Staleness is reported, never selected on**: `isStale`, `staleByDays`, `containsReferenceDate`, `activeCount`
  ride on `ResolvedAcademicYear`, and the two low-frequency alerts sites log one structured WARN.
  `SchoolContextService` deliberately logs **nothing** — one warning per authenticated request is noise, not
  signal.
- **No response shape changed.** Every consumer reads `.id` only (`activeYear?.id ?? null`); `forTenant` still
  returns `{ tenantId, schoolId, activeAcademicYearId }`. The richer `ResolvedAcademicYear` never reaches a
  response body.

### The honesty clause on site 6 — read it before quoting the closure

`school-context.service.ts` was **not** a demonstrated cross-tenant leak. `forTenant` derives `schoolId` either
from `resolveDefaultSchoolId(tenantId)` or from an explicit id it first validates with
`school.findFirst({ where: { id: schoolId, tenantId } })`, so the academic-year query was *transitively* safe — by
an invariant held two calls away, in a different method. The closure is claimed **on construction, not on a live
leak**. RLS did not cover the gap and could not: the whole path runs on `PrismaService`, the **owner** connection,
where row security is bypassed (`current_user = pilotage`, verified on the stack).

### Evidence, executed

| check | result |
|---|---|
| `pnpm typecheck` | **13 successful / 13 total**, `TYPECHECK_EXIT=0` |
| `git diff --check` | exit 0 (two informational CRLF warnings only) |
| `academic-year-resolution-gate.spec.ts` (the ratchet) | **PASS**, 22 cases, negative **and** positive controls, floors hold |
| `school-context-tenant-scope.spec.ts` (new, 7 cases) | **7/7 PASS**, **red-before evidenced by execution** |
| `resolve-academic-year.spec.ts` (30 cases) | PASS after two **test-side** defects were fixed |
| converted-site specs (analytics drilldown, subjects, imports, integrations, worker) | PASS |
| `analytics.service.spec.ts` — 7 pre-existing failures | **already in `scripts/known-test-failures.json` on `origin/main`, `"Owner: V3-E03"`** — not this PR's regression, but this **epic's** debt |

**The typecheck was RED when the escalation panel ran**, at 42 errors, all in one new file and all from one root
cause: the literal `*/` inside a prose token closed the ratchet spec's `/** … */` header at line 48 col 56, so
lines 48–115 were parsed as TypeScript. Test-only, one token, fixed, re-run green. Worth recording because the
background-task notification claimed "exit code 0" — that was a trailing `echo | tee`, not the gate. **Read the
last `GATE:`/`TYPECHECK_EXIT` line, never a notification.**

**Red-before is evidenced, not asserted.** `school-context-tenant-scope.spec.ts` was written against the *caller*
axis that neither the resolver spec nor the ratchet covers — *does a caller pass the right tenant?* — because
`tenantId: string` happily accepts the empty string, the school id, or another tenant's id. Site 6 was patched back
to `findFirst({ where: { schoolId, status: 'active' } })`, the suite ran **5 failed / 2 passed** (the seeded
drifted row returned the other tenant's year), and the file was then restored.

### The ratchet — and what it does not prove

`apps/api/src/shared/quality/academic-year-resolution-gate.spec.ts` (653 lines) derives its inventory by walking
three roots — including `packages/<paquet>/src`, the root the house precedent hardcodes away and the root where the
worst site lived. It recognises the resolver's home **by construction** (asserted to be exactly one file), separates
read from write **structurally** so the `academic-years.controller` state transition passes without a named
exception, carries per-root anti-vacuity floors measured at **170/61/48 against 150/50/38**, uses a synthetic
`fixtureYear` model, and ships `MANUAL_ALLOWLIST` **empty and asserted empty**. No `SKIP_*`, no `NODE_ENV` escape.

**It proves a SHAPE, not correctness.** Specifically it holds the **resolution** class shut (`status: 'active'`
filters outside the resolver) and **not** the **tenancy** class: a read re-introduced as
`academicYear.findFirst({ where: { schoolId } })` — no status literal — is green today, and
`academic-years.controller.ts:109` is exactly that shape right now (recorded as `PF-327`). Correctness is the
executed unit suite and the probe, not the gate.

### Merge conditions a human owns — none fixed here

1. **The story's P1 STOP condition was never measured as a committed artefact.**
   `scripts/academic-year-resolution-probe.js` **does not exist** (AC-9 unmet). The panel measured **0 drift, 4
   rows, 2 tenants, exactly 1 active year per school** via ad-hoc `docker exec` on the **local** stack. Re-run
   `SELECT count(*) FROM academic_year ay JOIN school s ON s.id = ay.school_id WHERE ay.tenant_id IS DISTINCT FROM
   s.tenant_id;` against the **Hostinger prod** DB before merge — non-zero means those schools silently lose their
   active year on all four portals and their imports start refusing, and **no schema constraint carries the local
   `0` to prod** (`AcademicYear.tenantId` has no FK and no composite FK to `school(tenant_id, id)`).
2. **The ledger side is entirely unwritten** (AC-12 unmet). `traceability/OPEN.md`, `CLOSED-L0.md`, `RUN-LOG.md`
   and `audit-findings-index.md` are unmodified. `PF-327`…`PF-330` are cited from **production comments** and exist
   in **no ledger file** — the exact id-collision failure mode this repo has already been bitten by (`PF-185`,
   `PF-186`, `TOOL-27` each named two findings in 2026-08-14). **Allocate against open PRs, not just `main`.**
3. **`PF-329` and `PF-330` are each used with two or three different meanings inside this diff.** `PF-330` means
   the unordered-fallback determinism note, the `ci-gate.sh` `GATE_MACHINERY` residual, **and** the
   `SchoolContextService` per-request cost. Renumber **by MEANING**, never by pattern-replace.
4. **`buildImportCaches` still issues five tenant-less sibling reads** — `gradeLevel`, `subject`, `classSection`,
   `student`, `guardian`, all scoped by school alone, on the same owner connection, feeding matching/dedup on the
   import **write** path — while the new header comment asserts the hoist *"closes the tenancy defect at the three
   callers"*. `ADR-070` sets the standard itself (it refuses "correct by accident of its caller" at
   `school-context.service.ts`); apply it to the five or soften the claim and give the gap an id.
5. **`@pilotage/imports-core` is not jest-mapped to source**, unlike `@pilotage/contracts` (mapped in both
   `apps/api/jest.config.js:19` and `apps/worker/jest.config.js:12`). The one package whose signature this diff
   **breaks** resolves through a gitignored `dist/` at test time *and* at runtime. **Landing prerequisite:
   `pnpm --filter @pilotage/imports-core build` via `exec` before any worker start** — a stale `dist` runs the old
   two-argument function, which ignores the passed year and re-resolves it school-only, with typecheck and the
   ratchet both green.

### Recorded, not blocking

- `school-performance-drilldown.service.ts:152` — `term.findMany({ where: { academicYearId } })`, **no `tenantId`**,
  directly below the converted resolution. Currently **unreachable** (`analytics.controller.ts:107` exposes no
  `@Query('academicYearId')`); it becomes a live cross-tenant read the day someone adds that param. Same shape at
  `analytics.service.ts:3817`.
- `alerts.service.ts:909`, `alerts-evaluator.service.ts:83`, `enrollment-xlsx.generator.ts:27` keep
  `...(schoolId ? { schoolId } : {})`. Without `schoolId` the resolution spans **every school in the tenant**, and
  the new total order makes a wrong-school pick **stable** rather than random. Within-tenant, pre-existing, now
  deterministic.
- The resolver replaced `findFirst` (implicit `LIMIT 1`, five sites also had `select: { id: true }`) with an
  unbounded `findMany`. `activeCount` is the only consumer of the full set; `take: 2` would preserve the
  multiplicity signal exactly.
- `startDate`/`endDate` are `@db.Date` (UTC midnight) while every call site injects `new Date()` (wall clock), so
  `isStale` fires on the year's **final day** with `staleByDays: 0`. Log noise only.
- Both tenants are already stale, so the new WARN fires on **every** alerts evaluation from day one. By design
  (`PF-15` exposes, never selects), but expect a permanently hot warn line, not an anomaly signal.

### `PF-15` closes on ONE AXIS OF TWO — do not let the row read plain `closed`

The **resolution** axis closes: canonical, tenant-keyed, totally ordered, staleness reported. The **data** axis does
not: both tenants' active year is still in the past, and **no invariant forbids it** (`AcademicYear` has only
`@@unique([schoolId, name])`). The residual is **`PF-328`**, deliberately deferred — the two natural invariants
(*at most one `active` year per school*, *the active year contains today*) **fail on the existing data**, so they
need an expand/contract migration **and** a product decision about what "active" means for the two violating rows.
G-MIGRATION was correctly **not** triggered, so `scripts/restore-drill-baseline.json` owes no entry (`PF-80` not
armed).

`PF-04` and `PF-36` are **advanced, not closed**: one measured mechanism of each is removed. `PF-329` — the parent
dashboard's enrolment-derived year — is a **tenth** mechanism on an axis this slice does not touch, and naming it is
what keeps `PF-04`'s eventual closure honest.

---

## S-E03-2 — evidence (run 81, 2026-08-25)

Story: [`docs/daily-improvement-v3/stories/S-E03-2.md`](../../../daily-improvement-v3/stories/S-E03-2.md).
ADR: [`docs/adr/ADR-071-student-read-authorisation-and-failed-reads.md`](../../../adr/ADR-071-student-read-authorisation-and-failed-reads.md).

**Selected as an operator override.** The `Next slice` pointer this file carried nominated `PF-329`; the SLICE
argument named `S-E03-2` / `PF-05` and wins outright (`selection-log.jsonl` run 81). `PF-329` stays open and
unclaimed, and the pointer below now points somewhere else again — read the reasoning, not the id.

### What was actually wrong — two defects that meet on one page

**(a) Authorisation.** The parent's "my child's grades" read was guarded by **private copies** of the student ABAC,
not by `StudentAccessService`. Twelve non-spec `guardianship.find*` sites exist; **four** are authorisation:

| site | teacher branch, pre-diff | this slice |
|---|---|---|
| `students/student-access.service.ts:112` | UNION, bounded (`ADR-066`) | **the home** |
| `attendance/attendance.controller.ts:637` | bounded (`teacherOfStudentWhere`) | allowlisted, reason inline |
| `grades/grades.controller.ts:466` | **UNRESTRICTED** — the verbatim `PF-288` fail-open `S-E05-16` closed at the service | **deleted** |
| `lessons/lessons.controller.ts:367` | **absent entirely** — only `roles.includes('parent')` | **converted** |

The lessons site is the worse of the two: every other holder of `lessons.read` — teacher, school_admin — read an
arbitrary student's lesson feed with **no check at all**.

**(b) Truth.** When either read on `/parent/grades` failed, `safe()` returned `null`, `?? []` turned it into an
empty array, and the parent was shown **"Aucune note publiée"** — a positive, school-wide claim manufactured out of
a 403. `PF-05` also reproduces on today's seed by a mechanism the audit never named: `parent@pilotage.local` holds
**two** active guardianships (Jade Brun, 1 published grade; Chloé Moreau, 0), `/api/v1/students` orders by
`lastName, firstName`, and `/parent/grades` defaults to `children[0]` while `/parent/dashboard` loops over **all**
children. Change a name and the grades page says "no grades published" while the dashboard shows 11.2 — **no API
divergence required**. That is `PF-335`.

### What the fix is, and why it has the shape it has

- **One service, wired by `imports:` not `providers:`.** `GradesModule` and `LessonsModule` gain
  `imports: [StudentsModule]` (`ADR-071 §D1`). `StudentsModule` already `exports` the service, and its closure is
  acyclic — `Students → {Auth, SchoolStructure, Teaching}`, `Teaching → {Auth, SchoolStructure}`,
  `SchoolStructure → {Auth}` — verified by reading the graph, because a missing edge here is a Nest **bootstrap**
  failure: a total API outage, not a red test.
- **The lessons decision is hoisted ABOVE `this.scope.run(...)`** (`§D2`). The service reads on the **owner**
  connection; calling it inside the scope holds two connections for the whole interactive transaction and makes a
  403 abort a transaction it never needed. The `tx.enrollment.findMany` that follows stays **inside** — it is data,
  not authorisation.
- **The grades 404-before-403 ordering is deliberately FROZEN.** The pre-existing `findUnique` + `tenantId` check
  produces the 404; the ABAC produces the 403. Hoisting authorisation above it would have converted the 404 into a
  cross-tenant **existence oracle**.
- **Honest failure rendering, by reuse.** `apps/web/src/lib/read-result.ts` (`read()`, `ReadResult`,
  `isAccessDenied`) sits on the existing `ApiResult` + `apiResultFromError`, and `NEXT_REDIRECT` is re-thrown
  **first** so an expired parent session never prints the Next digest into the UI (`PF-174`). A `'use client'`
  `ReadErrorState` wrapper carries the retry. **Two** reads converted, not a 61st `safe()` — 58 remain (`PF-336`).
- **The earned empty state names the child** (`AC-4b`, `PF-335`'s fix): *"Aucune note publiée pour `<Prénom Nom>`"*,
  from the already-loaded `children` array, no extra fetch. A sentence with no subject is read as a claim about the
  school.
- **`AC-5` took its STOP branch, and that is the correct outcome, not a shortfall.** The canonical
  `published-grades.where.ts` could not be adopted at **both** call sites, and §7 mandates *"ship neither and
  report"* — so it ships **nowhere**, and neither `analytics.service.ts` nor `grades.service.ts` is touched. The
  substitute, `parent-grade-projection-agreement.spec.ts`, captures both projections' `where` clauses **out of live
  production code** via a Prisma abort sentinel rather than re-typing them. A hand-copied comparison would have been
  the two-hand-kept-lists drift that produced a 503 on four portals.

### The ratchet — and what it does not prove

`apps/api/src/shared/quality/student-authz-locality-gate.spec.ts` (745 lines) states its rule over **authorisation
resolution**, never over `guardianship` queries. The obvious model-name rule flags **eight innocents**: the fan-outs
and admin listings bind `guardian: { userProfileId: { not: null } }` — *every guardian with an account* — where an
authorisation binds `guardian: { userProfileId: <caller> }`. The discriminator is **two signals in one body**: an
identity binding **and** a `realm_access` read.

Inventory derived by walk over three roots; home recognised **by construction** (asserted exactly one); synthetic
fixture model; per-root anti-vacuity floors; real-code negative controls (a fan-out **and** the digest cron); no
`SKIP_*` / `ALLOW_*` / `NODE_ENV`; `MANUAL_ALLOWLIST` asserted to contain **exactly** `attendance.controller.ts`
with its reason inline; and a self-scan forbidding `process.env`.

**It is narrower than its own docblock claims, and the gap is recorded as `PF-349`.** Two rewrites of the very shape
it polices pass it: `guardian: { userProfileId: { equals: me.id } }` (an object-literal value is classified
`fan-out` unconditionally), and `const where = {…}; findFirst({ where })` (only `PropertyAssignment` is walked, so a
shorthand yields zero bindings). Neither is disclosed in the "CE QUE LE CLIQUET NE PROUVE PAS" list. It also cannot
see the class `PF-341` belongs to at all — a filter with **no** authorisation reads no `guardianship` and no
`realm_access`, so it is invisible by construction.

### Evidence, executed

| check | result |
|---|---|
| `pnpm typecheck` | **13 successful / 13 total** — **RED at exit 2** when the escalation panel ran (see below) |
| `git diff --check` | exit 0, tracked **and** vs `main`; 0 trailing-whitespace lines across the 9 new files |
| `grades-read-abac.spec.ts`, `lessons-read-abac.spec.ts` | authored this run; 404-before-403 pinned at `grades-read-abac.spec.ts:242` |
| `lessons-scope-ownership.spec.ts` (pre-existing, rewired) | in-scope budget 3 → **2**; new `scopeAtOwnerAbacRead === [undefined]` |
| `parent-grade-projection-agreement.spec.ts` | both `where` clauses captured from production via abort sentinel |
| `student-authz-locality-gate.spec.ts` (the ratchet) | floors hold, negative controls on real code, allowlist asserted exactly one |
| **`scripts/parent-grades-contract-probe.js`** | **WRITTEN AND EXECUTED at the land pass — `AC-9` MET, Tier-A evidence item 4 MET.** `PROBE: PASS — 6/6` in `--expect-prefix` mode against the pre-slice image, then `PROBE: PASS — 6/6` in POST-FIX mode against the image rebuilt and recreated at land. See §"The Tier-A live probe, executed" below |
| `AC-13` (a browser driven against the stack) | **NOT OBSERVED** — third consecutive slice |

**The typecheck was RED when the panel ran, and the reason generalises.** The slice appended a constructor parameter
to `GradesController` (4 → 5) and `LessonsController` (5 → 6). **Two legacy harnesses this diff never opened** —
`lessons-scope-ownership.spec.ts:258` and `provenance-callsites.spec.ts:616` — construct those controllers
**positionally**, so they stopped compiling. Every *new* spec in the slice passes the argument correctly, and every
new spec uses `new Controller(...)` rather than Nest DI — which is simultaneously why the arity broke silently and
why the container wiring is proven by **prose** ("CYCLE-LIBRE, vérifié ce run") rather than by execution.

**The fix pass did not stop at the arity, and that matters.** Two assertions in `lessons-scope-ownership.spec.ts`
were **factually wrong** post-hoist, not merely uncompilable: they pinned `guardianship.findFirst` *inside*
`scope.run` and a 3-statement budget. A permissive double would have made them green while declaring an
authorisation the suite does not observe. The harness was instead rewired onto the **real** `StudentAccessService`
over the owner-connection double, so the 403 control still denies **for the real reason**
(`studentIds: []`), and a new assertion pins the invariant the hoist actually buys — one nothing anywhere pinned.
Likewise `parent-grade-projection-agreement.spec.ts:355` asserted "A émet ZÉRO requête" while `parentDashboard`
carries a **second**, unconditional `grade.findMany` at `analytics.service.ts:1096`; rewritten to assert **identity
rather than absence**.

### The Tier-A live probe, executed at the land pass (`AC-9` — closed, `PF-343`)

**Written and run by the land pass rather than inherited**, because Tier A is not gradeable downward and because
letting probe debt become a slice is exactly how `S-E03-4`'s probe was inherited. Both halves ran against the local
Docker stack; the API image was **rebuilt and the container recreated** between them (SKILL Step -1), and nothing
else in the stack was touched.

| | pre-slice image (built 14:40, no bind mounts) | image rebuilt + recreated at land |
|---|---|---|
| P1 unbound teacher reads an arbitrary child **transcript** | **200** — the fail-open, on the wire | **403** |
| P1b same teacher reads that child's **stats** | **200** | **403** |
| P2 parent reads their own guarded child | 200 | 200 — unchanged |
| P3a/P3b the two projections, same child, same breath | 200, counts agree (1 = 1) | 200, counts agree (1 = 1) |
| P4 same teacher reads that child's **lesson feed** | **200** | **403** |
| verdict | `PROBE: PASS — 6/6` (`--expect-prefix`) | `PROBE: PASS — 6/6` |

**`PF-288` is therefore observed, not inferred.** A provisioned teacher holding **zero** `TeachingAssignment` read
a child's full transcript, that child's statistics and that child's lesson feed from the running system.

**The first execution was a FALSE GREEN, and that is recorded as `PF-354`.** In POST-FIX mode every teacher
expectation answered 403 — exactly what the fix should produce. It was not the fix: `teacher@pilotage.local` had no
`UserProfile`, so `ensureUser` refused with `403 ACCOUNT_NOT_PROVISIONED` **before the request reached
`assertCanReadStudent`**, while the container still ran the pre-slice image. The probe now carries
`assertReached()`, which treats that code as **INCONCLUSIVE** — never a pass — and aborts naming the fixture work.
A probe that cannot separate the wall under test from a wall upstream is not evidence.

**What P3 still does NOT prove** (`§LIMIT` in the probe): it compares counts for ONE child on ONE seed, and the
dashboard projection is a strict SUBSET of the grades feed, so agreement means "the four divergence axes did not
bite on this child", never "the projections are one query". **`PF-05` stays `advanced`.**

**Local fixtures created by the land pass** (local data is expendable, SKILL Step -1): a `user_profile` for
`teacher@pilotage.local` in tenant `53fe06f3…` — deliberately with **no** `TeacherProfile` and **no** assignment,
which is the whole point — and a guardianship linking `parent@pilotage.local` to a child that has a published
grade. The probe **discovers** both rather than creating them, and says so when they are absent.

### Merge conditions a human owns

1. ~~**The Tier-A live probe does not exist.**~~ **DISCHARGED at the land pass — see the section above.** Original
   text retained for the record: **The Tier-A live probe does not exist.** `scripts/parent-grades-contract-probe.js` is named in `FR11`, in
   `AC-9`, and in `ADR-071 §Verification` item 4 as *non-downgradable* — and it is absent from the tree.
   `apps/web/tests/e2e/journeys/parent-grades-read-truth.spec.ts:28` **explicitly forwards** the S1/S3/S4
   failure-state proof to it, correctly refusing to fake a server-component failure with `page.route()`. `apps/web`
   has **no unit runner**. Net: `ReadErrorState`, both failure branches of `parent/grades/page.tsx`, and the
   `denied`-vs-`failure` split have **never been rendered by anything**. This is `landed: true ≠ ran: true` — run
   77 reproduced verbatim. Either write and execute the probe (mint tokens with the derived `secretOf`/`passwordOf`
   recipe from `scripts/keycloak-live-probe.js:252/:268`, **never a literal**, `PF-228`), or downgrade the claim in
   writing to *"mechanism proven, deployment not"* and re-point the e2e docblock at something that exists. Recorded
   as `PF-343`.
2. **`?classSectionId=` is the unguarded sibling of the parameter this slice walled.** `lessons.controller.ts` fires
   the new wall only `if (studentId)`; three lines above,
   `if (classSectionId) where.teachingAssignment = { classSectionId }` has **no ABAC whatsoever**. A parent drops
   `studentId`, passes any section id — handed to them verbatim by their own child's response
   `include: { classSection: { select: { id, name } } }` — and reads that class's published lesson feed. Pre-existing;
   this slice makes it load-bearing and then claims in production that the change *"supprime la possibilité même
   d'un appelant oublié"*, true of one branch of two. `PF-341`, and the next slice.
3. **The failure copy asserts a domain fact.** On a failed `/api/v1/students` read the page renders *"Vos enfants
   sont bien rattachés à votre compte — c'est l'affichage qui a échoué."* On a 403 — revoked guardianship, the exact
   case `isAccessDenied` routes down this branch — that is probably **false**, and it is shown to a parent. Same
   defect class as `PF-05`, opposite sign; flagged independently by four review lenses. The branch also passes
   `retryable={!isAccessDenied(...)}` while its description still says *"Réessayez dans un instant"*, so a denied
   parent is told to retry with no control to retry with. `PF-346`.
4. **`?? []` was dropped in the `safe()` → `read()` conversion.** `childrenRead.data.data` and `gradesRead.data.data`
   assume a body: `api()` returns `undefined` on HTTP 204, so a 200 with an empty or `null` body now throws inside
   the server component and lands on the generic `/parent/error.tsx`, where the pre-diff code rendered the honest
   empty state. `PF-347`.
5. **`assertCanReadStudent` survives as a two-line delegate**, where `AC-1` said *"DELETED outright, not delegated
   from"*. The rule content is genuinely gone — no Prisma read, no role branch — so this is not a fail-open, but a
   future grep for the removed guard still finds the name, and the ratchet cannot see it (it opens no `guardianship`
   read and reads no `realm_access`). Either inline it at both call sites or amend `AC-1`; do not leave the AC and
   the code disagreeing silently.

### Recorded, not blocking

- **The teacher wall now 403s for `pending` and `transferred_in` enrolments.** `student-access.service.ts:191`
  resolves taught students through `enrollment.findMany({ where: { status: 'active' } })`, and this slice extends
  that wall to three more routes. `pending` is the normal state during pre-rentrée enrolment. `ADR-071 §D1` prices
  only *"teachers lose non-taught access"*. `PF-350`.
- **A custom role holding `lessons.read` without a realm role is now a hard 403** on `/api/v1/lessons?studentId=`:
  `PermissionsGuard` resolves `effectivePermissions(sub, realmRoles)` (`ADR-013`/`ADR-015`), the guard passes, and
  `scopeForUser` falls to *no role with student access*. Deliberate and tested — and a second live-portal
  regression class absent from the ADR's release note. `PF-348`.
- **`ErrorState` gained a `children` slot with zero consumers**, documented as *"how a server component injects a
  client control"* — while the app solved the same need the opposite way, with the `ReadErrorState` client wrapper
  and `onRetry`. Two sanctioned mechanisms for one need, one dead on arrival, in a shared DS component, with a
  docblock that prescribes the pattern the only new call site does not use. `PF-351`.
- **The two new failure branches skip a heading level** (`h1` from `PageHeader` → `h3` from `ErrorState`), on
  branches where that `h3` carries the entire meaning of the screen. Pre-existing across all four portals; this
  diff adds two instances on a P0 parent surface. `PF-345` — **renumbered by MEANING** from the `PF-337` the DS
  lane had allocated to it, which `ADR-071:17` had already given to *three permissions for one datum*.
- **The new *Réinitialiser les filtres* CTA renders white on `--parent-500` at 3.79:1**, below the 4.5:1 required
  for 14 px bold. Only the 600/700 end of `--accent-gradient` clears it (5.12:1 / 6.57:1). This also **falsifies the
  assertion in `packages/design-tokens/src/tokens.css:66-69`** that the 500/600/700 ramp keeps white text ≥ 4.5:1 —
  measured, `--parent-500` is 3.79:1 and `--teacher-500` is 3.31:1; the claim holds from 600 down. Pattern is
  pre-existing (`parent/messages:114`, `parent/settings:358`); this is the third instance. `PF-352`.
- **`ADR-071 §D3` describes an artefact this PR does not contain** — the shared `teaching-wall.where.ts`-shaped
  predicate, with four non-negotiable properties. `AC-5` correctly refused to half-ship it, but the ADR text was not
  reconciled, so the next reader looks for the module and does not find it. Same row: `apps/web/src/lib/read-result.ts`
  is a new cross-cutting front-end convention that `§D5`'s reuse table does not name, and it value-imports
  `apiResultFromError` from `@/lib/api-client` — a **server** module whose own docblock warns that a value-import
  from a `'use client'` file breaks `next build` (`PF-133`). `read-result.ts` carries no such warning and exports
  `isAccessDenied`, which a client component would naturally reach for. `PF-353`.
- The `AC-4b` empty state still **contains** the literal substring *"Aucune note publiée"* (now suffixed with the
  child's name). `FR11-P4` specifies the probe assert the failure HTML does **not** contain that phrase; a naive
  substring probe will therefore also trip on the legitimate empty state. The shipped Playwright spec already works
  around this by keying on `role="status"` vs `role="alert"`. Key the probe the same way.

### `PF-05` is ADVANCED, never `closed` — and `PF-288` IS closed

`PF-288` closes as a **class**, not a handler: both remaining private copies are gone and a derived ratchet holds
the shape shut.

`PF-05` does **not** close, per `AC-7` and `ADR-071 §D8`. The count divergence between projections A and B is
**undemonstrated on the seed**; six projections remain six (`PF-337` names the three permissions for one datum,
`PF-338` the two the student portal holds that disagree with each other); and `PF-339` — `analytics.service.ts:977`
`if (!g.value) continue` — still deletes a legitimate grade of **zero** from every A-backed surface including the
north-star dashboard. Closing `PF-05` here would be the KPI/ledger divergence `DNC-01` forbids.

`G-MIGRATION` was correctly **not** triggered — no `schema.prisma` edit — so `scripts/restore-drill-baseline.json`
owes no entry (`PF-80` not armed).

---

## ~~Next slice → `PF-341`~~ — SUPERSEDED at run 82, and **not on merit**. Read this box first

> **Run 82 selected `S-E03-3` / `PF-12` instead, and the reason is procedural, not a re-ranking.**
> `PF-341` is a **`PF-58+` id**, and under **`RULE 0` clause 5** (`ADR-069` — enforced at selection time by
> `scripts/roadmap-selection-check.js` and written to `selection-log.jsonl` **before** the sprint) a `PF-58+` slice is
> selectable only when it **blocks a named roadmap story**. `PF-341` blocks none. **It is therefore barred, not
> outranked.** Everything written below about its severity still stands: it remains **open, unclaimed and correctly
> ranked first among non-roadmap work**, and it is a live parent-facing read leak. Do not read its displacement as a
> judgement about its merit. `PF-12`, by contrast, is a roadmap finding owned by `V3-E03`, and run 81 had already
> ranked it *"next but one"* for the reason the `S-E03-3` bullet below gives.
>
> The current pointer is at the **end of this file**: `Next slice → PF-357`.

`lessons.controller.ts` now refuses an unauthorised `?studentId=`. Three lines above it,
`if (classSectionId) where.teachingAssignment = { classSectionId }` has **no ABAC at all**. A parent holding
`lessons.read` bypasses the new wall by **omitting the parameter it guards**: drop `studentId`, pass any section id
— handed to them verbatim by their own child's response `include: { classSection: { select: { id, name } } }` — and
read that class's published lesson feed: teacher names, subjects, homework, dates. `PF-340` confirms the two filters
never intersect, so there is no accidental containment.

Three reasons it ranks first:

1. **This slice made it load-bearing** and then wrote in production that the change *"supprime la possibilité même
   d'un appelant oublié"* — true of one branch of two. A closure claim standing beside a naked sibling is the
   `DNC-06` pattern.
2. **It is the cheapest slice on the board.** The guard, the service and the ratchet all now exist; it is one call
   and one spec. The only real design question is what a *parent* may pass — presumably only a section their child
   is enrolled in — and `StudentAccessService` already resolves that set.
3. **The ratchet cannot catch this class.** It keys on `guardianship` reads bound to caller identity, so a filter
   with *no* authorisation reads no `guardianship` and no `realm_access` and is invisible by construction. It needs
   a slice, not a gate.

It ranks ahead of:

- ~~**`PF-343`**~~ **DISCHARGED at the land pass of run 81** — `scripts/parent-grades-contract-probe.js` was
  written and executed, both halves, and the API image rebuilt between them. It did **not** become a slice. What it
  produced instead is a new open class, **`PF-354`**: every authorisation probe in `scripts/` asserts on a bare
  status code, and 401/403/404 are each reachable from several layers — so a probe that asserts a status is
  asserting a coincidence until it also asserts the discriminating body code.
- **`S-E03-3` / `PF-12`** — the A-and-B predicate unification that `AC-5` deliberately refused to half-ship. Bigger,
  and now **cheaper than it was**: `parent-grade-projection-agreement.spec.ts` already captures both `where` clauses
  out of live production code and names the divergence axes, so the red-before harness it needs is written. Next but
  one.
- **`PF-329`** — the parent dashboard's tenth academic-year mechanism, the pointer `S-E03-4` set here. Still open,
  still unclaimed. `S-E03-2` was an operator override, not a re-ranking of `PF-329`; do not read its displacement as
  a judgement.
- **`PF-346`** — the failure copy that asserts guardianship as a fact. A one-string change on a P0 parent surface
  that contradicts this slice's own `AC-4`. Fold it into this PR's merge if a human is in the file anyway.
- **`PF-328`** — the expand/contract migration and the product decision about what "active" means. Unchanged from
  `S-E03-4`'s ranking: bigger, needs a ruling, and `G-MIGRATION` makes it a different class of slice.

### Two structural gaps this epic keeps paying for

**No test executes the Nest module graph.** Three docblocks in this diff (`students.module.ts`, `grades.module.ts`,
`lessons.module.ts`) each state that a missing `imports: [StudentsModule]` fails Nest **at bootstrap** — *"une panne
TOTALE de l'API, pas un test rouge"* — and then rest on a hand-written prose claim (*"CYCLE-LIBRE, vérifié ce
run"*) as the only evidence. Every new spec here uses `new Controller(...)` positionally, which bypasses DI
entirely, which is both why the wiring is unproven **and** why two legacy harnesses broke on arity without anyone
noticing until the gate. One `apps/api/src/shared/quality/module-graph-bootstrap.spec.ts` asserting
`await Test.createTestingModule({ imports: [AppModule] }).compile()` resolves — Prisma and Keycloak overridden by
doubles — converts a total-outage failure mode from prose into an executed check, and covers every future module
that gains a dependency. **This is the single highest-value test this epic is missing.**

**`apps/web` still has no unit runner**, so every front-end truth claim in this epic is argued from reading. That is
what made `PF-343` possible: a shipped spec could forward its proof obligation to a file that does not exist, and
nothing failed. `V3-E06`'s ledger already nominates a unit runner over `apps/web/src/lib` as the cheapest slice on
that board; `read-result.ts` (77 new lines, zero tests, and the module 58 remaining `safe()` pages are meant to
migrate onto) is now a second reason.

**Still owed for `V3-E03`, unchanged since `S-E03-4`:** an **`epic-spec` run**, so this epic finally has a
`spec.md`, a `tasks.md` and a denominator. Two slices have now landed against a backlog nobody has enumerated.

*(Written 2026-08-25, `S-E03-2` land pass, run 81. Later slices: annotate, do not delete.)*

---

## S-E03-3 — evidence (run 82, 2026-08-25)

Story: [`docs/spec/features/v3-e03/stories/S-E03-3.md`](./stories/S-E03-3.md) (planning copy under
`docs/daily-improvement-v3/stories/`).
ADR: [`docs/adr/ADR-072-canonical-active-enrollment.md`](../../../adr/ADR-072-canonical-active-enrollment.md).

**What landed.** Nine hand-written derivations of *"is this child actively enrolled"* — six parent surfaces, three
admin — reading five differently-filtered server projections, collapse to **one** contract module,
`packages/contracts/src/enrollment/`. The server posts the verdict in an explicit field (`enrollmentActivity`, and
the flat pair `enrollmentActivityState` / `enrollmentScopeLabel` on the meeting-request row); the portal consumes a
verdict and is handed no rows to choose among. A one-way ratchet
(`apps/api/src/shared/quality/enrollment-activity-derivation-gate.spec.ts`) makes a second re-derivation
inexpressible on the parent portal (RULE A) and pins a decreasing ceiling everywhere else (RULE B) — the two-rule
scope is `ADR-072 §A5`, and it exists because a single zero-tolerance rule would have forced one of the three exits
`academic-year-resolution-gate.spec.ts:20-32` forbids.

**Three of the removed derivations were false at all times, not merely divergent.** `children/page.tsx`,
`settings/page.tsx` and `messages/new/page.tsx` each declared `academicYear: { status: string }` while the projection
feeding them (`GET /students`) selected only `{ id, name }`. `e.academicYear.status === 'active'` therefore compared
`undefined === 'active'` for **every** child, so the « CLASSES ACTIVES » / « CYCLES SUIVIS » counters were
structurally `0` and the compose selector never listed a class. `DNC-06` doubled with `DNC-01`.

### Three land-pass corrections, all three worth keeping

1. **`ADR-072` did not exist, and 44 source sites already cited it.** The slice shipped a new
   `packages/contracts` module, a new ratchet class and a new response field on five endpoints, with every
   *"see `ADR-072 §3` / `§A2` / `§A6` / `§R-7`"* comment dangling. `GUARDRAILS §2` makes that a blocking finding, and
   the story's own AC list made the ADR mandatory. Written at land, with the sections the source already cites.
2. **None of `PF-356`…`PF-363` was declared**, while production source already cited six of them — `TOOL-01`
   exactly. Worse, the code's implicit allocation was **shifted by one** against the story's §7 table and reused one
   id for two residuals. Reconciled in one direction only — the ledger's table is authoritative, the source was
   corrected to it, **by meaning, file by file**, never by pattern-replace. Two ids were allocated at land for
   meanings the table did not carry: **`PF-364`** (`endedAt` reported, never selected on) and **`PF-365`**
   (`ADR-041 §D4`'s single registry does not exist).
3. **The fallback reappeared inside its own fix, on a surface the slice had just converted.** The meeting-request
   projection shipped `shownEnrollment = activity.enrollment ?? activity.lastKnown` — literally the
   `?? enrollments[0]` shape the contract's own docblock calls *"not a precaution: it WAS the bug"* — so a child who
   graduated in 2023-2024 would have rendered `3ème B` as a bare chip on the teacher and admin action-centre rows.
   The two fields that would have made it legible were on the DTO and **absent from the web mirror and from every
   render**. Fixed both ways at land: the class is emitted only when it is a current enrolment (matching the web
   adapter's deliberate `classLabel: null` on `out_of_scope`), and `MeetingRequestList.tsx` renders the scope line
   beside the child's name whenever the state is not `active`. The contracts Zod DTO gained the same two fields, so
   *"field names mirror the `MeetingRequestDto` schema"* is true again rather than aspirational.

### `PF-12` is ADVANCED, never `closed`

Axes 1, 2 and 3 are removed. **Axis 5 — `PF-357`, the claim panel answering from `GuardianshipClaim` — is the
audit's own third clause and is untouched**, so the panel can still print *"Vous n'avez pas encore rattaché
d'enfant"* beside a listed child, on the same page as the badge this slice made canonical. Also open: `PF-356`
(axis 4), `PF-358` (axis 6), `PF-359` (axis 8), `PF-360` (axis 9), `PF-363` (axis 7). Inherited and not solved:
`PF-328` and `PF-361`. Open by construction: `PF-362` and `PF-365`. A row marked `closed` here would be the
`DNC-06` pattern the two preceding slices each caught themselves committing.

`G-MIGRATION` was correctly **not** triggered — no `schema.prisma` edit — so `scripts/restore-drill-baseline.json`
owes no entry (`PF-80` not armed).

---

## ~~Next slice → `PF-357`~~ — **DELIVERED at run 84 by `S-E03-3b`.** Kept for its reasoning; the live pointer is at the end of this file

`S-E03-3` made the enrolment badge canonical and left, on the **same page**, a panel that answers a different
question from a different table: `ChildClaimsStatusStrip.tsx:120-136` projects from `GuardianshipClaim`, so an
admin-created link — which produces no claim row — prints *"Vous n'avez pas encore rattaché d'enfant"* (`:127`)
next to a child the list has just rendered. The inverse holds too: an approved claim whose `Guardianship` was later
revoked still reads *"Validé"*.

Three reasons it ranks first:

1. **It is the only remaining clause of the finding the epic owns.** `PF-12`'s row cannot close while it stands, and
   this slice is what turns `advanced` into `closed` — the highest-value single move on this board.
2. **This slice made it more visible, not less.** A canonical, correctly-scoped badge sitting beside a panel that
   contradicts it is a sharper contradiction than the four mutually-inconsistent badges it replaced.
3. **The shape is already decided.** `ADR-072`'s form applies directly: project from `Guardianship` (the fact) with
   `GuardianshipClaim` as provenance, state the predicate once, and let the panel consume a verdict. `PF-358`
   (`Guardianship.status` predicated three ways, `_count` unfiltered) is the same relation and should be folded in —
   they are one guardianship predicate, not two.

It ranks ahead of:

- **`PF-356`** (axis 4, `schoolId` asymmetry) — **P1 and genuinely worse in a multi-school tenant**, where the list
  is empty while the detail page renders fully and the worker still emails about the child. It ranks second only
  because its seam is `SchoolContextService`, so it is a wider slice with a semantic decision inside it, not because
  it is smaller.
- **`PF-341`** — still barred by `RULE 0` clause 5, still first among non-roadmap work. See the superseded pointer
  box above.
- **`PF-328` / `PF-361`** — the expand/contract migration plus the product decision about what "active" means for
  rows that already violate both candidate invariants. `G-MIGRATION` makes it a different class of slice.

**Still owed for `V3-E03`, unchanged since `S-E03-4` and now three slices old:** an **`epic-spec` run**, so this epic
finally has a `spec.md`, a `tasks.md` and a denominator.

*(Written 2026-08-25, `S-E03-3` land pass, run 82. Later slices: annotate, do not delete.)*

---

## S-E03-3b — evidence (run 83, 2026-08-26)

**Story** `docs/spec/features/v3-e03/stories/S-E03-3b.md` · **ADR** `ADR-073` · **Closes** `PF-357` ·
**Advances** `PF-12` (still `open`) · **Raises** `PF-367` · `PF-368` · `PF-369` · `PF-370` · `PF-371`.

### What was actually wrong

Measured on the local stack, 2026-08-26: **2460 `active` guardianships, 28 `pending`, 2459 distinct guardians
holding an active link — and 0 `GuardianshipClaim` rows.** `GET /api/v1/parent/child-claims` read the *claim*
table alone, so for every parent in the data the page listed their children and then, three centimetres lower,
stated *« Vous n'avez pas encore rattaché d'enfant »*. That is `PF-12`'s own third clause, and `DNC-01` in its
purest form. The inverse also held: an `approved` claim whose `Guardianship` had since been revoked still
rendered a green *« Validé »* badge.

### What the fix is

The panel projects from `Guardianship` (the FACT) unioned with `GuardianshipClaim` (its PROVENANCE), keyed by
the CHILD rather than by the record. The five-member vocabulary, the total derivation over all 4 × 6
`(linkStatus, claimStatus)` pairs, the identity predicate and the total order all live once in
`packages/contracts/src/guardianship/child-link.ts`; the portal is handed decided verdicts and no raw
`GuardianshipClaimStatus` at all, so *« Validé »-over-a-revoked-link* is **inexpressible**, not merely fixed.

### The review pass overturned the story's own §3.4 — read this before quoting the closure

The slice as implemented shipped `mayProjectChildIdentity = link !== null && (link.status === 'active' ||
provenance === null || provenance.status === 'approved')`. **Only the first disjunct was gated on the link
being live**, and with 2460 of 2460 links carrying zero claims, `provenance === null` was the ordinary case.
The panel therefore returned the child's real name **and internal `studentId`** for `revoked` links — i.e. to
the guardian `DELETE /guardians/guardianships/:id` had just de-authorised — and for `pending` links, to a
guardian not yet authorised. `StudentAccessService` (`student-access.service.ts:111`) authorises `active`
guardianships only, so these were children the platform denies the same caller everywhere else on the same
page. Pre-slice the panel returned nothing at all for these rows, so it was **new** disclosure of children's
data shipped inside a correctness fix.

Corrected before landing (`ADR-073 §R.6`, restoring `§D5` and, for the unnameable case, `§D4`):

- `mayProjectChildIdentity = link !== null && link.status === 'active'`;
- a **second path** existed and had to be closed too — `displayName`'s last fallback re-read `link.student`
  whenever `child` was null and there was no provenance, so gating the predicate alone still leaked. A link
  that is not `active` with no claim behind it has no name this caller may read and is now **not projected at
  all** (`isNameableForGuardian`); the fallback that used to read `link.student` throws.
- Guarded by **T-2** (revoked + `approved` claim → `child: null`), **T-8** (⊆ against the `active` SUBSET, not
  the whole Guardianship set, plus a whole-payload assertion), **T-8b** / **T-8c** (claim-less revoked and
  pending → not projected) and **T-8d** (revoked *with* a claim → still projected, named from `claimed*`).

The lesson, and it is the paired-lists lesson again: `§R.1` justified widening the predicate by saying the
architect's narrow rule was *contained* in the wide one. Containment runs the other way — a wide predicate is
never justified by containing a narrow one.

### `PF-12` is ADVANCED, never `closed` — and `PF-357` IS closed

`PF-357` closes: the panel now reads the fact, and the emptiness sentence has one guarded home which is true
when it renders. **`PF-12` does not.** `ADR-073 §D11` set the re-check condition itself — *if any parent-facing
surface still predicates `Guardianship.status` outside one shared predicate, the row is `advanced`* — and the
re-check FAILED at the review pass: the slice never created `isLiveGuardianship`, and four parent-facing sites
still spell the predicate by hand (`student-access.service.ts:111` and `:192`,
`apps/worker/.../parent-digest-cron.service.ts:171`, `.../digest-aggregate.service.ts:60`). They all agree on
`'active'`, so nothing contradicts today — but one question with five hand-written homes is exactly the shape
`PF-12` names. `PF-356`, `PF-358`, `PF-359`, `PF-360` and `PF-363` also remain open under it.

---

## ~~Next slice → `PF-356`~~ — **DELIVERED at run 89 by `S-E03-3d`** (`ADR-076`), paired with `PF-363` by operator override. Kept unedited as the record of why it was ranked first; the live pointer is at the END of this file

Ranked successor now that `PF-357` is delivered, and it was already second on the previous pointer's own list.
`GET /students` applies `schoolId` from `SchoolContextService.forUser` (*"the school in the tenant with the
most students"*), while `StudentAccessService` and `AnalyticsService.parentDashboard` ignore school entirely.
In a multi-school tenant the **list is empty while the detail page renders fully**, and
`apps/worker/src/modules/parent-digest/parent-digest-cron.service.ts:168-175` emails about a child the portal
denies exists. It also reaches into `ADR-072`: keyed on `forUser` instead of on the school that owns the rows,
two projections resolve two canonical years and reproduce `PF-12` on a fresh axis (`ADR-072 §R-4`).

It is a wider slice than `S-E03-3b` — the seam is `SchoolContextService` and there is a semantic decision
inside it (is the parent scope school-agnostic, or does every parent path apply the same school resolution?) —
so it wants its own `epic-spec`-style decision, not an improvised one.

**A cheaper, strictly-contained alternative if the board wants a short run:** `PF-358` + the `PF-12` residual
`ADR-073 §D11` names — give the guardianship predicate ONE home the way `ADR-072` gave the enrolment predicate
one, apply it at the five hand-written sites, and filter `_count.guardianships` so a child stops displaying
*"2 responsables"* when one of them has been removed. That is the move that turns `PF-12` from `advanced` into
`closed`.

**Still owed for `V3-E03`, unchanged since `S-E03-4` and now four slices old:** an **`epic-spec` run**, so this
epic finally has a `spec.md`, a `tasks.md` and a denominator.

*(Written 2026-08-26, `S-E03-3b` review/land pass, run 84. Later slices: annotate, do not delete.)*

---

## `S-E03-3c` — ONE guardianship liveness predicate (run 85, 2026-08-26)

**`PF-358` CLOSED · `PF-12` advanced a third time, still NOT closed · `PF-372`..`PF-376` recorded · `ADR-074`**

This run took the *"cheaper, strictly-contained alternative"* the previous section names, and it is worth
saying plainly that **the previous section was right about the move and wrong about its size**: it estimated
"the five hand-written sites"; the re-measurement found **~20 production read sites, three spellings and a
fourth form with no predicate at all**.

### What was actually wrong, measured 2026-08-26

`status: 'active'` ×12 · `status: { not: 'revoked' }` ×2 · **unfiltered `_count` ×3**. The first two are *not
the same question* — one asks « does this adult guard this child NOW », the other « is this link ON THE
BOOKS » — and both are legitimate. The defect was that neither had a name, so the choice was made site by
site, and the third form was indistinguishable from an oversight.

Two contradictions were live:

1. **`GET /guardians` contradicted itself on one object** — unfiltered `_count.guardianships` above a
   `{ not: 'revoked' }` array. « 2 rattachements » over a list showing one.
2. **`DELETE /guardians/:id` was unfinishable.** It refused while `_count.guardianships > 0`, unfiltered,
   replying *« Révoquez d'abord les rattachements »* — but revoking sets `revoked`, which that count kept
   counting. **The remedy the error prescribes could never lift it.** This is the concrete, user-visible defect
   of the slice, and it is pinned red-before / green-after.

### What landed

`packages/contracts/src/guardianship/link-liveness.ts` — two named scopes (LIVE, ON-THE-BOOKS) plus a declared
all-states marker; ON-THE-BOOKS **derived** by subtracting the terminal state, never written, with a ratchet
test comparing the contract vocabulary to the Prisma enum **parsed out of `schema.prisma`**. Twenty-odd sites
converted across `apps/api` and `apps/worker`. `ParentGuardianshipLinkStatus` (ADR-073) stops being a fourth
hand-written copy and aliases the canonical union.

**No authorization changed** — the ABAC assertions were **strengthened**, not relaxed: each now writes the
expected scope out in full *and* confronts it with the product predicate, so widening LIVE fails the test on
the parent boundary.

### Three things worth carrying

1. **The residual note that ordered this work was wrong on two of its five sites** (`PF-374`): both were
   `Enrollment.status`, not `Guardianship.status`. A run that had executed it literally would have converted
   two enrolment sites onto a guardianship predicate. **A residual note is a lead, never a measurement.**
2. **The ratchet had a blind spot, and the RED proof is what found it.** R-A only sees `prisma.guardianship.*`
   calls; the *majority* of this slice's sites are relations read from `student`/`guardian`. R-C was added.
   Final red-before proof: **11 offenders across three rules**. A ratchet that is never red proves nothing.
3. **Fake Prisma clients that emulate one `where` syntax manufacture false RED on the security seam**
   (`PF-376`). Six ABAC tests reported a `ForbiddenException` *that does not exist in the product*, purely
   because their doubles compared `row.status === where.status`. The dangerous twin — a double that
   over-matches — would manufacture false GREEN there.

### Why `PF-12` still is not `closed`

Its own text named the closing condition (*"the guardianship predicate has more than one home"*) and that
condition **is now met**. But applying to itself the discipline that caught `PF-374`, the honest verdict is
that `PF-12` names a **class**, and four measured axes remain: `PF-356`, `PF-359`, `PF-360`, `PF-363`. Closing
it on the strength of one satisfied clause would be the `DNC-06` pattern every preceding slice caught itself
committing. **The remaining move is `PF-363` + `PF-356` in one slice** — both parent-portal read projections,
both `G-TRUTH`+`G-PORTAL`, and together the last axes with a live user-visible consequence.

**Still owed for `V3-E03`, unchanged and now five slices old:** an **`epic-spec` run**, so this epic finally has
a `spec.md`, a `tasks.md` and a denominator. `PF-365`/`PF-370` (the registry convergence) are explicitly
waiting on it, and `link-liveness.ts` makes the sibling family four modules wide.

*(Written 2026-08-26, `S-E03-3c` land pass, run 85. Later slices: annotate, do not delete.)*

---

## `S-E03-5` — ONE derivation for « which attachment requests await a decision » (run 86, 2026-08-26)

**`PF-373` CLOSED · `PF-20` advanced, NOT closed · `PF-371` advanced · `PF-377`..`PF-379` recorded · `ADR-075`**

Story: [`stories/S-E03-5.md`](./stories/S-E03-5.md).
ADR: [`docs/adr/ADR-075-canonical-pending-attachment-request.md`](../../../adr/ADR-075-canonical-pending-attachment-request.md).

### What was actually wrong, measured 2026-08-26

The admin read « Demandes en attente : 28 » on the dashboard, clicked « Examiner », and landed on
*« Aucune demande dans cet onglet — les demandes apparaîtront ici dès que des parents les soumettront »* —
not a zero, but an **explanation** of a zero. The mechanism was structural, not arithmetic:

| Surface | What it asked the server for | What the server returned |
|---|---|---|
| KPI (`analytics.service.ts`) | `guardianship.count({ tenantId, status: 'pending' })` — **tenant-wide** | a number |
| `/admin/enrollments` | `GET /api/v1/guardians` | **`Guardian`** rows — a model with neither `status` nor `notes` |

The page hand-declared a `Guardianship` shape and `api<T>()` cast without validating, so its five tabs
compared `undefined` to a status literal. **Always false, for every tenant, since the page was written.**
Three defects rode the same path: `includePending=true` sent to an endpoint that never declares it
(`guardians.controller.ts:93-99`, silently accepted, never read → `PF-379`); five tab badges derived from a
truncated page’s `.length`; and a local `safe()` collapsing `null` and `[]`, so a 403/404/500 rendered as
« Aucune demande ».

### What landed

- **`link-liveness.ts` §2.7** — a THIRD named scope on the same column (`GUARDIANSHIP_AWAITING_DECISION_STATUSES`,
  `guardianshipRequestQueueWhere()`, `guardianshipPendingRequestWhere()`, `isGuardianshipAwaitingDecision()`),
  in the existing module rather than a fifth sibling (`PF-365`/`PF-370`). Both scope keys are **required**, so
  the `...(schoolId ? … : {})` fail-open of `ADR-065 §D5` is a `TS2345` rather than a convention.
- **`GET /api/v1/guardians/guardianships/pending-requests`** (`ADR-075 §D1`) — `Guardianship` rows, server
  pagination, a `total` counted on the same `where`, and a `totalsByStatus` `groupBy` so badges never count a
  page. Guarded by `parents.read`, **not** the briefed `guardianships.read` (`ADR-075 §D4`: that code is granted
  to `teacher` and `parent`, and this route returns parent email/phone — using it would have widened an
  authorisation inside a TIER-B slice).
- **Scope moved tenant-wide → school** on the `student` axis (`ADR-075 §D2`). **The KPI changes value for
  multi-school tenants.** That is the point, not a side effect.
- **`sparkline()`** lost `statusFilter` (zero callers after conversion) and gained a **required** `schoolId`
  (all nine callers already passed it). Its `guardianship` branch had been throwing `schoolId` away behind two
  `as never` casts while its three siblings applied it (`ADR-075 §D3`).
- **`read()` + `ReadErrorState`** on the queue; three hand-written `'pending' | 'active' | 'revoked'` FE mirrors
  replaced by the imported `GuardianshipLinkStatus` (`PF-371` advanced).

### What the run learned by being wrong

1. **The ADR was cited by nineteen production sites before it existed.** Every decision was argued — inside the
   file that made it, therefore unreviewable from anywhere else. `GUARDRAILS §2` treats that as blocking, and it
   was the right call: `ADR-075` was written at the land pass, from the code, not from the intent.
2. **A scope string copied by hand is a verification that lies.** `§D5` makes the equality of three scope labels
   the visual proof that the three surfaces count one population — and the page’s copy differed from the
   contract by **one apostrophe** (`'` U+0027 vs `’` U+2019). The check was broken before it was ever used. The
   page now **imports** `GUARDIANSHIP_SCOPE_LABEL.awaitingDecision`. This is `PF-371` occurring inside the slice
   that claimed to push `PF-371` back.
3. **A residual is inverted, not deleted.** Run 85’s anti-vacuity test asserted that `analytics.service.ts`
   still carried `status: 'pending'`, with the note *« this test will fail the day it disappears — that is the
   signal to update `PF-373`, not to delete this test »*. It was inverted in place
   (`guardianship-liveness-derivation-gate.spec.ts:609`).

### Why `PF-20` still is not `closed`

It has a second half — « 4 alerts vs 0 rules » — and that half is alive at **two** mechanisms recorded as
`PF-378`: the server KPI is `AnalyticsService.DEFAULT_ALERT_RULES.length` (`analytics.service.ts:2899-2900`), a
constant’s length no database read can contradict; and `admin/alerts/page.tsx` renders a failed read as
*« Aucune règle configurée »* while deriving two KPI from a `limit=100` page whose `total` is already served.
A residual test in the new ratchet **asserts that half still exists**, so `PF-20` cannot be closed by
inadvertence. **The remaining move is `PF-378` in one slice** — its remedy (`read()`, `ReadErrorState`, the
served `total` values) is already in the repository and was applied to `/admin/enrollments` by this slice.

**Still owed for `V3-E03`, unchanged and now six slices old:** an **`epic-spec` run**. `PF-365`/`PF-370` (the
registry convergence) wait on it explicitly, and `link-liveness.ts` is now the widest of the four sibling
modules.

*(Written 2026-08-26, `S-E03-5` land pass, run 86. Later slices: annotate, do not delete.)*

### Annotation — run 88, 2026-08-26 : ce qui précède a été ÉCRIT par le run 86, et VÉRIFIÉ par le run 88

Le run 86 a rédigé toute la section ci-dessus **au pass de land, avant de mourir**. Il n'a jamais exécuté
une seule preuve : il a acquis le lock à 11:27 et s'est arrêté à 12:48 sur `You've hit your session limit`,
sans `git commit`, sans `typecheck`, sans `build`, sans gate. Tout ce que la section affirme était donc,
jusqu'à ce run, **une intention non mesurée** — exactement la forme que
`feedback_landed_is_not_ran` nomme.

**Ce que le run 88 a récupéré.** Un tick de 19:15 avait sauvé les 16 fichiers **suivis** dans `51b5524`,
mais le reaper stashe **sans `-u`** : les cinq livrables **non suivis** lui étaient invisibles — dont la
story (39 Ko), l'ADR (19 Ko) et **les deux artefacts de preuve**. `PROGRESS.md` référençait donc par chemin
deux fichiers qu'un `git clean` aurait effacés. Ils ont été committés **en premier**, avant toute
vérification, pour qu'une seconde interruption ne puisse pas répéter la perte (`3333c3f`).

**Ce que le run 88 a exécuté** — sur `C:\Users\HP\Downloads\pilotage-scolaire-claude`, arbre committé :

| Preuve | Commande | Résultat |
|---|---|---|
| Typecheck | `pnpm typecheck` avec `TURBO_FORCE=true` | **13/13, `0 cached`, 1 m 34 s** |
| Suites de la tranche | `jest pending-request-agreement · guardianship-pending-request-derivation-gate · guardianship-liveness-derivation-gate` | **3 suites, 69/69** |
| **ROUGE AVANT** *(le cliquet n'est pas vide)* | `git checkout origin/main -- analytics.service.ts admin/enrollments/page.tsx` puis le cliquet | **2 échecs / 27 passes** — `R-A/R-B` sur le littéral `status: 'pending'` d'`analytics.service.ts`, `R-C` sur le miroir d'union de `page.tsx:27` |
| **VERT APRÈS** | l'arbre de la tranche restauré, même cliquet | **29/29** |
| Build | `pnpm build` *(l'unique du run)* | **8/8, exit 0, 7 m 44 s** |
| Gate | `bash scripts/ci-gate.sh` **deux fois** | **`GATE: PASS (fast)`** aux deux passes, exit 0 |

> **Le premier `TURBO_FORCE` n'était pas une précaution de style.** Le `pnpm typecheck` initial a rendu
> *13/13 successful, 13 cached, `FULL TURBO`, 844 ms* — un vert obtenu **sans exécuter tsc une seule fois**,
> sur un arbre que personne n'avait jamais typé. C'est la forme la plus discrète du faux vert : le verdict
> est exact, la mesure est absente. Un cache hit n'est pas une vérification.
>
> **De même, la ligne 84 de la sortie du gate imprime un `GATE: PASS` nu** (`PF-325`,
> `tenant-scope-deployment-check.js:261`) 1206 lignes avant le vrai verdict. Les deux passes ont été lues
> à la **dernière** ligne `GATE:`, jamais par grep.

**Ce qui n'a PAS été fait, et pourquoi.** Aucune sonde live : Docker Desktop refuse toujours de démarrer sur
cette machine (constat du run 86, revérifié), et la base locale `pilotage` sur 5432 a ses 55 tables mais
**zéro ligne**. Aucune preuve exécutée contre la pile n'est donc revendiquée ici — ni par le run 86, ni par
celui-ci. La tranche est **TIER B** (`S-E03-5` §Tiers) : correction de justesse sur une lecture, pas une
couture d'autorisation, donc la sonde live n'est pas requise — mais l'absence est déclarée plutôt que tue.

*(Écrit 2026-08-26, run 88, pass de vérification et de land. Tranches suivantes : annoter, ne pas supprimer.)*

---

## `S-E03-10` — a snapshot trigger can reach a terminal state on the SECOND recompute (run 88, 2026-08-26)

**Slice id** `S-E03-10` · **Finding** `PF-24` — **advanced, NOT closed** · **Gates** G-TRUTH
**Diff** 5 files, +246 / −30 · **No migration, no `schema.prisma` change, no `apps/web` file, no new endpoint**
**Read the four caveats below before quoting any of this as done — two of them were resolved at the land pass of
this same run, and the annotations say which.**

### What was actually wrong

`snapshot_recompute_trigger` carries `@@unique([tenantId, coalesceKey, status])` (`apps/api/prisma/schema.prisma:1944`).
That unique is what makes the **pending** slot coalescing — one live row per scope, a burst of dirties folds into
one. Applied to a **terminal** status it means the opposite: at most one `done` row and one `failed` row per
`(tenant, scope)`, for the lifetime of the table. `coalesceKey` is a pure function of `(tenantId, reason, scope)`
(`packages/contracts/src/dto/snapshot.ts:73-88`), and the drain marked completion with
`updateMany({ where: { id, tenantId }, data: { status: 'done' } })` — **without mangling the key**.

So the **second recompute of any scope** raised P2002. Unconditional, not a race. The row stayed `processing`,
and `computeSnapshotFreshness` derives `recomputing` from `status IN ('pending','processing')`
(`analytics.service.ts:1408-1413`, `:4212-4223`, `school-performance-drilldown.service.ts:243-253`), so
`recomputing` pinned **true forever** on **four portals** — measured, not assumed:
`admin/analytics/page.tsx:94`, `parent/dashboard/page.tsx:500`, `student/dashboard/page.tsx:112`,
`teacher/reports/page.tsx:422`. The student portal is a first-class portal under `ADR-003` and was missing from
the sprint's own impact list (`PF-388`).

The failure write had the **same** defect from both sides, and its P2002 escaped `drainTenant` into the
per-tenant catch, silently abandoning the rest of that tenant's batch for the tick.

### What landed

- `packages/contracts/src/dto/snapshot.ts` — `terminalCoalesceKey(key, triggerId)` and `canonicalCoalesceKey(key)`
  beside the canonical formula. Separator `#terminal:` is unrepresentable in a canonical key (tenant uuid +
  snake_case literal reason + five uuid-or-`-` fields joined with `|`), so nothing user-controlled reaches it.
  Re-exported through `apps/worker/.../snapshot-keys.ts` — **one formula on both sides of the queue**, the same
  discipline as `ADR-070`/`072`/`074`.
- `settleTrigger` — `done`/`failed` take a key suffixed with the row's own primary key. **Collision-free by
  construction, not by retry.**
- `requeueCanonical` — everything going back to `pending` takes the canonical key *back*, otherwise the API
  enqueue stops folding onto it and the queue grows one uncoalesced row per dirty. The one legitimate collision —
  a live pending row already covering the scope — drops the redundant row instead of leaving it wedged.
- `reclaimStaleProcessing` and `reviveFailedTriggers` became per-row loops for the same reason: a single
  `updateMany` is atomic, so ONE colliding row aborted the reclaim/revive of **every other row**, wedging crash
  recovery deployment-wide. `SNAPSHOT_STALE_RECLAIM_TAKE` (200) gives the now-looping reclaim the explicit
  per-tick bound every other sweep already had.

### The four caveats — `landed: true`, not `ran: true`

1. **`PF-380` — the broken constraint was also the table's only retention bound, and removing it uncaps the
   table.** Before: one `done` + one `failed` per scope, forever. After: **one permanent row per recompute, per
   scope, forever**, and `grade_published`/`grade_revised` scopes are **per student**. The schema comment at
   `schema.prisma:1927` asserts these rows are *"routinely aged out"* — grepped: the only delete on this table in
   the entire repository is the new redundant-row drop. A per-child grading-activity ledger outside audit-log
   governance is a `GUARDRAILS §1` data-minimisation defect. **This is the blocking merge condition.**
2. ~~**`PF-381` — the test-architect returned NO-GO.**~~ **RESOLVED at the land pass of this same run.** Both new
   reds were stale harness mocks omitting `coalesceKey`, which the production `select` reads — a harness artefact,
   not a production NPE (`coalesceKey` is non-nullable). Both repaired; `npx jest snapshot` in `apps/worker` is now
   **45 tests, 40 passed, 5 failed — all five the baselined `PF-65` rows, 0 excess**. `reviveFailedTriggers` is
   exercised again, and its test now also asserts the canonical restore.
3. ~~**The five new tests are pure string algebra on the two helpers.**~~ **RESOLVED at the land pass.**
   `snapshot-trigger-conflict.spec.ts` supplies the missing mechanism evidence: an in-memory
   `snapshot_recompute_trigger` that genuinely **enforces** `@@unique([tenantId, coalesceKey, status])` and raises
   a Prisma-shaped `P2002`, validating every candidate row of an `updateMany` before mutating any so Prisma's
   all-or-nothing statement semantics — the thing that made "one bad row aborts the sweep" possible — are
   reproduced rather than assumed. **The positive control is the first test in the file**, so nothing after it can
   be vacuous. Seven cases: `AC-1` (two successive recomputes of one scope both reach `done`), `AC-1b` (a legacy
   canonical-keyed `done` row does not wedge the next recompute — nothing migrates those rows), `AC-2a/b/c` (one
   conflicting row never aborts a pass), `AC-3` (a revived row returns under the canonical key). **Each was proven
   RED against a re-introduced defect, and the reds DISCRIMINATE between sites:** removing the terminal-key
   mangling reddens three of the seven; removing the claim guard reddens `AC-2a` and nothing else.
   **A FOURTH conflict site was found here and fixed: the CLAIM `pending → processing`.** The sprint made the three
   settles collision-safe and left the claim alone — but `processing` must keep the CANONICAL key (the row is still
   the live one for its scope), so claiming a pending row while an EARLIER row for the same scope is still
   `processing` raises P2002, in exactly the window the fix's own comments describe. That call sits *before* the
   `try`, so its P2002 escaped `drainTenant` and abandoned the rest of the tenant's batch — the same blast radius
   the settle fix had just closed. A colliding claim has by definition lost the race, so it is now treated exactly
   as `claim.count === 0` already was.
4. **No story spec, no ADR** (`PF-387`, `PF-386`). Every sibling slice shipped one (`ADR-070`…`075`); a
   canonical-vs-terminal key convention on a shared contracts key format consumed by both API and worker is
   exactly the cross-cutting decision `GUARDRAILS §2` makes blocking.

### Why `PF-24` is not `closed`

The consumer half of the finding's title was **stale before this run** — `SnapshotDrainCronService` has existed
since `E6-S1`. What was true is that it could never **complete**. That is now fixed *by construction*, but
"by construction" is a claim about the code, and the row closes on a claim about the **stack**: a scope
recomputed twice ends `done` twice, and `recomputing` returns to false. Docker Desktop is still down on this
machine and the local `pilotage` database has its 55 tables and **zero rows**, so that proof was not available
and is **not claimed**. `PF-24` stays `open`, marked advanced, with the closure condition written into its
`OPEN.md` row.

## Next slice → `S-E03-10b` — `PF-380` + `PF-381`, in one slice

Not a new capability: the two conditions this slice's own escalation panel attached to it. They belong together
because they are the same missing thing — an executed proof against a bounded table.

1. **`PF-380`** — a `take`-bounded terminal-row retention sweep (`status IN ('done','failed') AND processed_at <
   now() - TTL`), same shape as `FAILED_REVIVE_TAKE`; the `@@index([tenantId, status, enqueuedAt])` already
   supports it. Plus `settleTrigger(trigger, 'done', { lastError: null })` — today a 500-char exception message
   survives forever on a `done` row (`PF-383`).
2. ~~**`PF-381`**~~ — **done at run 89's land pass, not deferred to `6b`**: `snapshot-trigger-conflict.spec.ts`,
   the positive control, the two repaired harnesses, 0 excess. What `6b` still owes on this axis is the part a
   fake cannot supply — **the same scenario executed against a real Postgres**, which is also the only thing
   standing between `PF-24` and `closed`.

Then `PF-382` (restore the status predicate `requeueCanonical` dropped) — a one-line `where` addition that can
ride along. **`PF-378`** (the « alertes » half of `PF-20`) remains the ranked successor *after* that, unchanged
from run 86's pointer.

**Still owed for `V3-E03`, unchanged and now seven slices old:** an **`epic-spec` run**. Two slices have now
shipped without a story file at all (`PF-387`), which is the same gap widening.

*(Written 2026-08-26, `S-E03-10` land pass, run 89. Later slices: annotate, do not delete.)*
## `S-E03-3d` — the parent LIST and the parent DETAIL page return the same children, and a FAILED read stops being an emptiness claim (run 89, 2026-08-27)

**Selected by the ledger, not by override on the axis.** The pointer this file carried nominated `PF-356` and
described the defect down to the worker line number. The operator override **paired** it with `PF-363`, and the
pairing is safe for a structural reason worth keeping: axis 4 is **one `apps/api` handler**, axis 7 is
**thirteen `apps/web` server pages** — disjoint file sets, so the FE and BE implement agents could not collide
(`GUARDRAILS §4`).

### What was actually wrong, measured 2026-08-26

**Axis 4 — `PF-356`.** `GET /api/v1/students` built its `where` as
`{ tenantId, schoolId, ...(scope.studentIds === null ? {} : { id: { in } }) }`. The `schoolId` came from
`SchoolContextService.forUser` — *"the school of this tenant carrying the most students"*, ties broken by
`createdAt asc`. That is a value **that moves when a THIRD school enrols pupils**, and it was being intersected
with `StudentAccessService.scopeForUser`, which already returns a **tenant-keyed, authoritative** id set and
whose school parameter has been `_schoolId`, underscore-prefixed and genuinely unread, for its whole life.

The consequence is not a leak, and the diff says so rather than dressing it up: the intersection **never refused
an illegitimate row.** It **deleted legitimate ones.** In a multi-school tenant a parent's list came back empty
while `GET /api/v1/students/:id` rendered the same child in full, in the same tenant, at the same second — and
`apps/worker/.../parent-digest-cron.service.ts:168-175`, which resolves its population from `guardianship` and
**never consults `SchoolContextService`**, kept emailing about the child the portal denied existed. The worker
is the *witness* to the contradiction, not a *site* of it; it was correctly not edited.

**Axis 7 — `PF-363`.** `safe()` mapped a failing `/students` call to `[]`, and the pages rendered `[]` as
*« Aucun enfant rattaché »* — a claim about the family, manufactured out of our own outage. `OPEN.md:157`
recorded the population as **six** pages and named two `parent/children/[id]` **detail** reads that are not in
the population at all. Correcting that count was a deliverable (`AC-5`): the derived number is **thirteen list
readers**, of which two were already converted.

### What landed

- **`apps/api/src/modules/students/student-scope-where.ts`** (new). The composition leaves the handler and
  becomes a **disjunction**, not a subtraction: the `null` sentinel — **admins only**, `super_admin` /
  `school_admin`, with every other principal falling to `[]` — keeps `{ tenantId, schoolId }`
  **byte-identical to `main`**; an explicit id set gets `{ tenantId, id: { in } }` with **no school key**.
  `tenantId` is present on **both** branches, and that clause **is** the tenancy wall on this path, because the
  whole read runs on `PrismaService`, the owner connection, where RLS is bypassed. The `=== null`
  discrimination is preserved **explicitly** — never `?.length`, never truthiness (`PF-288` / `ADR-065 §D5`) —
  so `[]` still produces `id: { in: [] }`, the **refusal**.
- **`apps/web/src/lib/parent-children.ts`** + **`apps/web/src/components/parent/ChildrenReadError.tsx`** (new).
  ONE reader, ONE failure render, thirteen pages. **No `?? []` and no `|| []` anywhere on the path.** The
  failure component renders fixed strings only — it never surfaces a host, a route, a status or the error
  object to a parent — and it flips `role="status"` → `role="alert"` **by construction** rather than by a second
  boolean that could disagree with the first.
- **`apps/api/src/shared/quality/student-school-scope-gate.spec.ts`** (new, 692 lines). An AST-derived one-way
  ratchet (`ts.createSourceFile`, not regex over text) over three roots, with **per-root** anti-vacuity floors,
  five RED-BEFORE cases, four positive controls, a `MANUAL_ALLOWLIST` that is **empty and asserted empty**, and
  a self-scan forbidding any `SKIP_*` / `ALLOW_*` / `NODE_ENV` disarm (`DNC-10`).
- **`ADR-076`**, and the story `docs/spec/features/v3-e03/stories/S-E03-3d.md`.

### The three things this slice got right that are worth copying

1. **It corrected the comment it falsified, in the same diff.** `students.controller.ts` carried *"en pratique
   la liste est déjà scopée à une école, donc c'est UNE requête"*. That was true **only because** the `where`
   carried `schoolId`. Rather than leave a now-false sentence sitting above a loop, the diff rewrites it, states
   the new bound (**K ≤ the number of DISTINCT schools among the ≤ 200 rows of the page, never the number of
   rows**), records the batching as a residue instead of fixing it inside a truth slice, and **asserts the bound
   in a test** so it cannot drift in silence.
2. **It removed a lying KPI tile instead of zeroing it.** On `/parent/calendar`, the « Évaluations à venir »
   tile is **withdrawn** when the children read fails. A rendered `0` would have been the same lie one line
   lower.
3. **It declared what it could not measure.** No live probe ran — Docker Desktop refuses to start on this
   machine and local `pilotage@5432` holds 0 students. `ADR-076` says so in its verification section instead of
   inheriting a paragraph. `landed: true ≠ ran: true`.

### Why `PF-12` still is not `closed` — a fourth time

Axes 8 (`PF-359`) and 9 (`PF-360`) stand, and **both are blocked on rulings, not on effort**: `PF-359` waits on
the semantic ruling for the section-anchored relational family (`PF-362`), and `PF-360` waits on the product
decision of whether `Student.status` gates parent visibility at all. Improvising either inside a truth slice is
precisely what the three preceding slices refused to do. `PF-12` is **advanced**, never `closed`.

### The landing conditions this run did NOT close — read them before merging

They were enumerated in the PR body and **the land pass (run 90) closed every one of them** — recorded here so a
later slice does not re-derive the reasoning. (1) `OPEN.md` was untouched by the sprint; the land pass added the
closure rows for `PF-356` / `PF-363`, `PF-12`'s fourth ADVANCED mark, and rows for every id below. (2) The
id collision was real and is **resolved by SENSE, never by position**, exactly as
`project_parallel_runs_collide_on_ids` prescribes — three planning agents had allocated `PF-389`…`PF-392` to
different findings:

| Id | Finding it now denotes | What the land pass did |
|---|---|---|
| `PF-389` | `calendar.controller.ts` reproduces axis 4 via `forTenant` | kept — the one id all three agents agreed on |
| `PF-390` | `?unenrolled=true` still keyed on `forUser`'s academic year | **absorbed `PF-396`**, which was the SAME finding under a second id |
| `PF-391` | the converted pages keep a local `safe()` for their OTHER reads | kept (story §10 + `settings/page.tsx:119`) |
| `PF-392` | `safe<T>` duplicated across ~61 server pages, no ratchet | kept (story §10) |
| `PF-393` | `OPEN.md:157` understated `PF-363`'s population | kept |
| **`PF-394`** | `scopeForUser` / `canAccessStudent` carry a DEAD `schoolId` param at ~25 sites | **new id** — had been double-booked onto `PF-391` |
| **`PF-395`** | `parent/grades/page.tsx` is the 15th `/students` caller, off the shared reader | **new id** — had been double-booked onto `PF-392` |
| `PF-397` | `canonicalYearBySchool` does K sequential resolutions | kept — **frozen by `expect(CTRL_SRC).toContain('PF-397')`**, so renumbering it would have gone red |

**`PF-396` is deliberately retired, not reused.** It named the same defect as `PF-390`; leaving a hole in the
numbering is cheaper than a second id for one finding, and reusing it later would resurrect the ambiguity.

*(Written 2026-08-27, `S-E03-3d` land pass, run 90. Later slices: annotate, do not delete.)*

---

## Next slice → `PF-378` — the « alertes » half of `PF-20`, i.e. the only remaining move that CLOSES a roadmap finding

**Why this and not another `PF-12` axis.** After seven slices this epic has **closed one of its nine** roadmap
findings. `PF-12` **cannot** close next run: its two surviving axes are both blocked on semantic rulings (above).
`PF-20` **can**, and its remaining half is already fully diagnosed at two mechanisms:

1. **Server.** `analytics.service.ts:2899-2900` sets the « Alertes configurées » KPI to
   `AnalyticsService.DEFAULT_ALERT_RULES.length` — *a constant's length*. No database read can contradict it,
   which is the real engine of « 4 alertes vs 0 règles »: the number never consults the data.
2. **Page.** `admin/alerts/page.tsx:108-109` keeps a local `safe()`, `:136` turns a failed read into `[]` and
   `:256` renders that as *« Aucune règle configurée »* — `PF-346`'s exact shape — while `:146`/`:149` derive
   `enabledRules` / `highOpen` from a `limit=100` page whose `total` is used **two lines above** at `:147`.

**Both remedies are already in the repository and have each shipped twice** (`read()` + `ReadErrorState`,
`ADR-071`; the served-`total` discipline, `ADR-075` — applied to `/admin/enrollments` by `S-E03-5` itself), so
the slice is small. Better: the ratchet `S-E03-5` shipped **already asserts this half still exists**, so it goes
RED **on purpose** the moment the fix lands — the cheapest red-before this epic will ever get.

**The one decision to write down is not technical:** is « configured rules » a **constant** or a **persisted
collection**? Answer it in the ADR. A slice that routes the page through `read()` and leaves the KPI as an array
length has fixed the *rendering* of the contradiction and kept its *source*.

**A cheaper, strictly-contained alternative:** `PF-395` + `PF-397` — convert the fifteenth `/api/v1/students`
caller (`parent/grades/page.tsx`, correct in *policy* but off the shared reader, so `ADR-076`'s own
*"la lecture est UNE"* is one file short of true), and batch `canonicalYearBySchool`. Neither closes a roadmap
finding; both remove a declared residue.

**Still owed for `V3-E03`, unchanged and now SEVEN slices old:** an **`epic-spec` run**. There are now **four**
sibling contract modules — `academic-year/`, `enrollment/`, `guardianship/link-liveness.ts`,
`students/student-scope-where.ts` — converging on a registry (`PF-365` / `PF-370`) that nobody has been allowed
to design, because designing it is an epic-spec decision and this epic has never had one.

*(Written 2026-08-27, `S-E03-3d` land pass, run 90. Later slices: annotate, do not delete.)*

---

## `S-E03-6` (run 91, 2026-08-27) — « Alertes configurées » cesse d'être la longueur d'une constante, et `PF-20` ferme

**Constatation de feuille de route FERMÉE : `PF-20`.** C'est la **deuxième** des neuf de cet épic
(après `PF-15`, fermée sur un axe), et la première fermée *entière* depuis l'ouverture de `V3-E03`.
Fermées avec elle : `PF-378` (les deux mécanismes de la moitié « alertes ») et `PF-63` (sept tests
au baseline). Ouverte : `PF-398`.

### Ce que la mesure a trouvé, et que le registre n'avait pas

Le registre décrivait « un KPI qui vaut la longueur d'une constante ». C'est vrai, et **incomplet
sur la moitié la plus intéressante** : cette constante était une **seconde liste tenue à la main du
catalogue des règles, et elle avait déjà dérivé** — **quatre** codes contre les **huit** de l'énum
`AlertRuleCode`. Manquaient `REPEATED_FAILURE`, `MISSING_ASSESSMENT`, `TEACHER_COMMENT_FLAG` et
`IMPROVEMENT`.

Le tableau de bord n'affichait donc pas seulement un nombre que la base ne pouvait pas contredire :
il affichait un nombre **faux**. Et rien ne pouvait le signaler, puisque les deux listes ne se
rencontraient nulle part dans le code — la forme exacte de `project_paired_lists_drift`, qui a déjà
coûté un 503 sur quatre portails au run 59.

Le docblock de la constante disait *« until R6 introduces the `AlertRule` model »*. **R6 l'a
introduit.** Le substitut a survécu à sa propre date de péremption.

### La décision, écrite dans `ADR-077` parce qu'elle n'est pas technique

« Configurées » = **les règles ACTIVÉES dans cette école**, une collection persistée — le schéma
tranche (`AlertRule.enabled @default(false)`, `@@unique([tenantId, schoolId, code])`), et
`/admin/alerts` comptait déjà cette population-là. **Conséquence assumée : le KPI passe de « 4 » à
« 0 »** sur tout établissement n'ayant activé aucune règle. Plus petit, et vrai.

L'invariant qui autorise cette projection de lecture à ne rien écrire est démontré, pas supposé :
`ensureRules` ne matérialise qu'à la première ouverture de la page, donc compter les règles
*activées* rend `0` **avant comme après** matérialisation — par construction, pas par chance.

### Les trois choses que cette tranche a apprises sur ses propres outils

1. **Un cliquet doit juger du CODE, pas de la prose.** La première exécution a rougi sur le
   commentaire qui *explique* le correctif. Un cliquet qui rougit sur sa propre explication se fait
   relâcher dans le mois, **et pour une bonne raison** — la pire façon de perdre une règle. Le
   nouveau cliquet **retire les commentaires avant de juger** ; son erreur possible est le faux
   négatif, jamais le faux positif, et un contrôle positif prouve qu'il voit encore.

2. **Le rouge-avant de `S-E03-5` a fonctionné exactement comme prévu**, et sa consigne
   (*« fermer PF-20, et non supprimer ce test »*) a été suivie : l'assertion est **retournée**, pas
   retirée. Sa forme, en revanche, était fragile — elle visait l'identifiant nu sur la source brute.
   Elle vise désormais la déclaration.

3. **`PF-63` n'était pas un élargissement opportuniste.** Les quatre nouveaux tests de comportement
   appellent `adminDashboard`, qui échouait déjà pour une autre cause : **sans ce correctif,
   l'évidence de `PF-20` était inexécutable.** La cause était dans la fixture — un mock servant une
   seule forme de ligne à deux lectures du même délégué — et le baseline désignait déjà `V3-E03`
   comme propriétaire.

### Ce que cette tranche NE ferme pas, énoncé plutôt que découvert plus tard

`PF-398` — **sept fichiers `apps/web`** récrivent le catalogue en union de littéraux, sans lien de
compilation avec l'énum, alors que `ALERT_RULE_CODE` existe dans `@pilotage/contracts` et que le web
l'importe déjà ailleurs. `R-A` s'arrête donc avant `apps/web`, **et la restriction est écrite dans le
cliquet** : une portée rétrécie sans trace se relit plus tard comme « tout est couvert ». Un test
dédié *chiffre* la dette pour qu'elle ne se lise pas comme « rien à signaler ».

`PF-377` reste ouverte : la même CLASSE (un `count` dérivé d'un `.length` borné) aux deux centres
d'action non-admin.

---

## ~~Next slice → l'`epic-spec`…~~ — POINTEUR SUPERSÉDÉ au run 92, et **non sur le fond**

> **Annoté le 2026-08-27, passe de land de `S-E03-8`** (convention de ce fichier : annoter, ne pas supprimer).
> Ce pointeur n'a **pas** été exécuté et n'a **pas** été jugé faux : l'opérateur a désigné `S-E03-8` / `PF-40`
> pour le run 92, et cette désignation l'emporte sur une note résiduelle (`PF-374`). Son argument reste
> **entièrement valable et s'est même renforcé** — il y a désormais **sept** modules contractuels frères, pas
> cinq, et `S-E03-8` a dû en créer **deux** (`calendar/window.ts` *et* `school-time/anchor.ts`, séparés parce que
> le module canonique n'a pas le droit d'importer `Intl`). Le pointeur vivant est à la fin de ce fichier.

**Pourquoi c'est enfin le bon moment, et non « encore une fois ».** Il y a désormais **cinq** modules
contractuels frères qui convergent visiblement vers un registre — `academic-year/`, `enrollment/`,
`guardianship/link-liveness.ts`, `students/student-scope-where.ts` et, depuis cette tranche,
`alerts/alert-rule-population.ts`. Chacun a été conçu isolément, chacun redécouvre les mêmes
questions (où vit la clause de portée, comment le catalogue est dérivé, qui a le droit de compter),
et **personne n'a jamais eu le droit de dessiner le tout** parce que c'est une décision d'`epic-spec`.
`PF-365` / `PF-370` portent ce travail depuis cinq runs.

**L'état chiffré de l'épic après huit tranches : 2 fermées sur 9** (`PF-15` sur un axe, `PF-20`
entière). Les sept restantes se répartissent en deux familles que la spec devrait séparer
explicitement :

- **bloquées sur des ARBITRAGES sémantiques, pas sur de l'effort** — `PF-12` (deux axes survivants),
  `PF-04` (« quel axe définit l'année d'un parent », `PF-329`) ;
- **jamais commencées et sans story** — `PF-24` (la file de snapshots sans consommateur), `PF-40`,
  `PF-50`, `PF-36`, `PF-05`.

**Si une tranche d'implémentation est préférée malgré tout**, la moins chère qui ferme une
constatation est **`PF-24`** : elle est intacte, elle n'attend aucun arbitrage, et la branche
`ci/2026-08-26-v3-e03-snapshot-terminal-conflict` suggère qu'un run l'a déjà approchée — **la lire
avant de recommencer** (`project_midrun_merge_hazard`).

**Alternative strictement contenue :** `PF-398` (les sept fichiers web du catalogue) — ne ferme
aucune constatation de feuille de route, mais retire une dette que cette tranche vient de mesurer et
de geler, et le remède est déjà dans le dépôt (`ALERT_RULE_CODE`).

*(Écrit le 2026-08-27, passe de land de `S-E03-6`, run 91. Tranches ultérieures : annoter, ne pas supprimer.)*

---

## `S-E03-8` (run 92, 2026-08-27) — le calendrier scolaire cesse de compter les mêmes événements de quatre façons

Story : [`stories/S-E03-8.md`](./stories/S-E03-8.md) · ADR :
[`ADR-078`](../../../adr/ADR-078-canonical-calendar-window.md) · **Constatation VISÉE : `PF-40`.**

> **Statut de la fermeture : REVENDIQUÉE, PAS ACQUISE.** Le panel d'escalade a rendu **NO-GO**. Trois tests
> **exécutés et rouges** vivent dans les cliquets que cette tranche vient elle-même d'écrire, et **aucun n'est au
> baseline** `scripts/known-test-failures.json`. `PF-40` ne se lit comme fermée qu'après les conditions ci-dessous.

### Ce que la mesure a trouvé, et que le registre nommait mal

`PF-40` est enregistrée comme *« async contradictory interim KPIs »*. **Rien ici n'est asynchrone** : les
événements arrivent en une seule prop déjà résolue côté serveur. Le mot « interim » de l'audit désignait en
réalité le patch d'hydratation React. Les quatre mécanismes sont **structurels et permanents** :

| # | mécanisme | ce qu'un utilisateur voyait |
|---|---|---|
| **A1** | Le même `GET /api/v1/calendar/events` recevait **deux questions différentes** : l'admin gardait sur `startsAt ∈ [début, fin)` et **ne lisait jamais `endsAt`** ; parent et teacher gardaient sur le **chevauchement**. | Un congé du 28 octobre au 10 novembre est « de novembre » pour un parent et un enseignant, et **n'est pas de novembre** pour l'admin qui l'a saisi. C'est le *« totals differ by role »* de l'audit, mot pour mot. |
| **A2** | La bande de KPI comptait la population **non filtrée** pendant que l'en-tête de grille juste à côté **obéissait** au filtre actif. | Deux nombres, un écran, le même mot, deux populations. |
| **A3** | Un compte dérivé du `.length` d'une liste **tronquée**, sur deux surfaces. | Un total qui est en fait un plafond. |
| **A4** | `new Date()` / `Date.now()` lus **pendant le rendu** de composants `'use client'` que Next rend d'abord côté serveur. | Chaque compteur était calculé une fois sur l'horloge du conteneur, une seconde fois sur celle du navigateur, et React patchait le nœud de texte en silence. |

### Le remède, et pourquoi il a cette forme

**Un foyer** : `packages/contracts/src/calendar/window.ts` — **zéro import**, arithmétique en millisecondes
absolus. **Une ancre** : `CalendarAnchor` (`{ nowMs, tzOffsetMinutes }`, plat et sérialisable) résolue **une
seule fois** dans les cinq pages serveur `force-dynamic` et traversant la frontière en prop. Le résolveur vit
**hors** du module canonique (`packages/contracts/src/school-time/anchor.ts`) parce qu'il a besoin d'`Intl`, que
R4 interdit dans le foyer.

`ADR-078` tranche quatre arbitrages qui, sans lui, n'auraient existé que dans des commentaires : **D1** le
domicile (et le coût de bundle qu'il assume), **D2** le chevauchement sur intervalle **semi-ouvert** avec la
conséquence écrite noir sur blanc que *les compteurs mensuels ne forment PAS une partition*, **D3** le fuseau,
**D4** la bande de KPI qui obéit au filtre **et le nomme**.

### `PF-406` — ce que le panel a trouvé, et pourquoi c'est la leçon durable de cette tranche

La première version dérivait `tzOffsetMinutes` de `now.getTimezoneOffset()` — le fuseau du **processus**. Le
conteneur `web` livré est en UTC (`node:22-alpine`, aucun `TZ` posé nulle part) alors que l'école est à
`Europe/Paris` : **toutes les bornes glissaient d'une heure**. Un congé « toute la journée » persisté à
`…T23:00:00Z` par le navigateur d'un admin parisien retombait **la veille** sur les trois portails, et un férié
isolé du 1er novembre chevauchait octobre **et** novembre.

**La leçon n'est pas « un bug a été corrigé ».** Avant la tranche, l'hydratation corrigeait la valeur en silence
avec l'horloge du visiteur ; la tranche retire cette correction et **aurait donc GELÉ l'erreur**. Et le défaut
était **conforme à la spec** — `S-E03-8.md §D3` disait littéralement *« décalage civil du **serveur** »*. Le
fuseau du serveur est une lecture **ambiante** exactement comme celle du navigateur : déplacer le défaut de l'un
vers l'autre n'a jamais été un correctif. Le dépôt avait déjà la bonne règle écrite (`S-E04-5` / `audit/window.ts`
— le fuseau vient de `Tenant.timezone`, il est **renvoyé**, et il ne se devine jamais) ; D3 n'était simplement pas
allé la chercher. **La correction est donc au niveau de la SPEC, pas du code** — la ligne est corrigée en place
avec un bloc `CORRECTION DE SPEC (PF-406)`.

Le résolveur ambiant est **supprimé**, pas déprécié : `resolveCalendarAnchorInZone(now, timeZone)` exige un
identifiant IANA explicite, et R4 interdit désormais `getTimezoneOffset` dans le module canonique. À noter, et à
ne pas enjoliver : **le défaut passait R4** — l'accesseur n'était pas dans l'ensemble. C'est une revue humaine qui
l'a attrapé, pas le cliquet.

### Les conditions de land — à traiter AVANT de lire `PF-40` comme fermée

1. **Trois rouges exécutés, à passer au vert PAR LE MÉCANISME, jamais par l'assertion.** Deux sont les contrôles
   `PF-406` de `calendar-window.spec.ts` : le bouton `underTz` est **inerte sous jest** (chaque fichier de test
   reçoit sa propre copie de `process.env`, le cache de fuseau de V8 n'est jamais invalidé), donc les deux
   assertions « identique sous trois fuseaux » au-dessus **comparaient trois fois le même fuseau** et passaient à
   vide ; les deux rouges sont précisément les **contrôles négatifs qui n'ont pas pu tirer** (`-0` contre `0`).
   **`toBe(-0)`, `Math.abs()` ou retirer le contrôle négatif rendraient le vert en rouvrant `PF-406` en silence.**
   Le remplacement est déjà rédigé par le test-architect : sceller les lectures ambiantes et **prouver le scellé**
   avec le résolveur retiré en contrôle positif. Le troisième rouge est le cas `EXCLUSIONS` du cliquet sur
   `apps/web/src/lib/school-calendar-anchor.ts` — et là aussi le remède le moins cher est le mauvais : déclarer
   « ce n'est pas une surface calendrier » **la provenance d'ancre des cinq pages portail** serait un mensonge que
   le cliquet se mettrait ensuite à défendre. **Le gouverner**, pas l'exclure.
2. **`OPEN.md` est INTACT.** `PF-40` y lit toujours `open`, sans colonne de preuve, et `PF-399`…`PF-406` n'ont
   aucune ligne alors que la source livrée cite déjà `PF-403`, `PF-404`, `PF-405` et `PF-406` par id. Un résidu
   déclaré uniquement dans le source d'un cliquet est un résidu **introuvable**.
3. **Deux commentaires livrés affirment plus que le code ne fait**, la classe même que cette tranche corrige trois
   fichiers plus loin dans `EnrollmentsPageTabs.tsx` : `teacher/dashboard/page.tsx:130` dit que le mini-calendrier
   des évaluations partage l'ancre — il ne la reçoit pas, il est `'use client'`, il lit `new Date()` au rendu, et
   le cliquet du **même diff** le déclare en dette `PF-403` ; et le docblock de `packages/ui/MiniCalendar.tsx`
   énonce un contrat d'appelant que **ses deux appelants vivants violent**.
4. **`pnpm --filter @pilotage/contracts build` reste un pré-requis de land** (`apps/web` résout
   `@pilotage/contracts` par `exports["."].default → ./dist/index.js`). Il a tourné dans le graphe de tâches du
   `pnpm typecheck`, donc `dist/` porte les nouveaux exports et ne porte plus celui qui a été retiré.

### Ce que cette tranche NE ferme pas, énoncé plutôt que découvert plus tard

`PF-399` (la bande `sections` de `parent/calendar` compte hors filtre — décision de produit, pas de dérivation,
**et la tranche l'a tout de même re-libellée alors que la story la déclarait hors périmètre**) · `PF-400` (le
`cast` non validé d'`api-client.ts`, fermable seulement en touchant un DTO, qu'`AC-9` interdit) · `PF-401` (le
barrel racine `@pilotage/contracts` entre dans le bundle navigateur, désormais **sur des routes parent** et plus
seulement admin — **personne n'a mesuré le delta First Load JS, aucun agent n'ayant le droit de builder**) ·
`PF-402` (le décalage est figé à l'instant de l'ancre : dérive DST, et **rien d'autre**) · `PF-403` (`CalendarPanel`
non migré) · `PF-404` (R3 ne franchit pas une frontière de composant) · `PF-405` (`toLocale*` sans `timeZone` —
`toLocaleDateString`/`toLocaleString`/`toDateString` échappent au cliquet, et **deux sites vivants subsistent dans
le corpus gouverné**, dont un rendu en SSR dans `CalendarManager`) · **`PF-406` volet 2** (`SCHOOL_TIMEZONE` est un
réglage de **déploiement**, pas de **locataire** ; `ADR-002` admet deux écoles dans deux fuseaux, la source correcte
est `Tenant.timezone` renvoyée par une lecture portail, et l'exposer est une tranche **backend** — le code est
écrit pour qu'un seul fichier change ce jour-là).

---

## Passe de land, run 92 — les quatre conditions ci-dessus sont LEVÉES, et voici comment

*(Écrit par l'orchestrateur après avoir EXÉCUTÉ les livrables de la tranche plutôt que lu son `landed: true`.
La section précédente est conservée telle quelle : elle est le constat honnête du sprint sur son propre travail,
et l'effacer effacerait la raison pour laquelle ce qui suit était nécessaire.)*

**Condition 1 — les trois rouges. Levée PAR LE MÉCANISME, jamais par l'assertion.**
Le sprint avait raison sur le diagnostic et la consigne. `landed: true` cachait `3 failed / 53 passed`.

* **Les deux contrôles `PF-406`.** Le sprint a nommé la cause (`underTz` inerte sous jest) ; la passe de land
  l'a **mesurée des deux côtés, à forme d'appel identique** : dans `node -e`, poser
  `process.env.TZ = 'Pacific/Kiritimati'` puis lire `-now.getTimezoneOffset()` rend **840** ; dans le worker
  jest, la même séquence rend **-0**, exactement comme sous `'UTC'`. Le contrôle négatif comparait donc une
  valeur avec elle-même, et ne rougissait que par l'accident `Object.is(-0, 0)`. **Remplacé, pas assoupli** :
  `underTz` stube désormais `Date.prototype.getTimezoneOffset`, et le cliquet `R4` — qui interdit au module
  canonique tout `Intl`, tout import, tout `new Date(` d'arité ≠ 1 et tout `getTimezoneOffset` — **prouve que
  c'est l'UNIQUE canal** par lequel le fuseau du processus peut atteindre le code sous test. La simulation est
  donc fidèle dans n'importe quel runner. Un test **MÉTA** a été ajouté : il assure que le mécanisme du helper
  fonctionne encore (`UTC → 0`, `Kiritimati → -840`, `Midway → 660`), pour que ce bloc ne puisse pas
  redevenir vacueux en silence. La classe est enregistrée en **`PF-407`** : rien n'empêche la prochaine spec de
  saisir le même mécanisme inerte, et le `grep` de `process.env.TZ` sur tout le corpus n'a **pas** été fait.
* **Le rouge `EXCLUSIONS`.** Le sprint a écrit *« le gouverner, pas l'exclure »*, et **la première correction de
  la passe de land a été la mauvaise** : `apps/web/src/lib/school-calendar-anchor.ts` avait été inscrit dans la
  table des exclusions. Corrigé après relecture de l'argument du sprint, qui est le bon : ce module est la
  provenance d'ancre des cinq pages portail, et l'exclure aurait été un mensonge que le cliquet se serait
  ensuite mis à défendre. La dérivation de `CORPUS` a donc été **élargie à `CalendarAnchor`** et le fichier
  ajouté au `CORPUS_FLOOR`. Cela ne coûte aucun faux positif, pour une raison structurelle et non chanceuse :
  `R2` ne juge que les fichiers CLIENT, et ce module n'a pas de directive `'use client'`.

**Condition 2 — `OPEN.md`. Levée.** `PF-40` est archivée dans `CLOSED-L0.md` avec ses quatre mécanismes et son
rouge-avant exécuté ; `PF-406` y est archivée avec elle ; `PF-399`, `PF-400`, `PF-401`, `PF-402`, `PF-403`,
`PF-404`, `PF-405`, plus `PF-407` et `PF-408` nés à la passe de land, ont chacun leur ligne dans le registre
ouvert.

**Condition 3 — les deux commentaires qui sur-affirment. Levée, et elle a produit une constatation.**
`teacher/dashboard/page.tsx` disait que le panneau « Vie de l'école » et le mini-calendrier des évaluations se
partageaient l'ancre : vérifié ligne à ligne, `CalendarPanel` (:313) ne la reçoit pas, seul `SchoolEventsPanel`
(:318) la reçoit. Le commentaire dit désormais qui la reçoit et qui ne la reçoit pas, et nomme `PF-403`. Le
docblock de `packages/ui/MiniCalendar.tsx` énonçait un contrat d'appelant au présent ; ses **deux** appelants
vivants le violent. En les nommant, il est apparu que le second — `parent/dashboard/_components/UpcomingPanel.tsx`
— **n'était couvert par aucun id** : le cliquet ne pouvait pas le voir, sa règle `EXCLUSIONS` filtrant sur un
nom de fichier contenant *« calendar »*. C'est **`PF-408`**, et le trou est dans la portée du détecteur, pas
dans la diligence de quiconque.

**Condition 4 — le build de `@pilotage/contracts`.** Satisfaite : `pnpm typecheck` (13/13, **0 en cache** sous
`TURBO_FORCE`) puis l'unique `pnpm build` du run (8/8, sortie 0) ont tous deux traversé le graphe de tâches.

### Preuve EXÉCUTÉE à la passe de land, et ce qu'elle ne couvre pas

* `57/57` sur les deux specs de la tranche, après correction — contre `53/57` telles que livrées.
* **Un rouge-avant GÉNUINE, pas reconstruit** : `PortalCalendarView.tsx` ramené seul à `origin/main` fait rougir
  **cinq** tests du cliquet — `R1` (prédicat propre), `R2` (horloge du visiteur), `R2b` (plafond d'accesseurs
  ambiants), `R3` (total tronqué) et le contrôle de falsifiabilité — puis le fichier restauré rend `57/57`.
  Les quatre mécanismes `A1`–`A4` sont donc détectés par le cliquet, un par un.
* `scripts/ci-gate.sh` **deux fois**, verdicts identiques, lus sur la **DERNIÈRE** ligne `GATE:` — `GATE: PASS
  (fast)` en ligne 1327. La ligne 84 portait bien le leurre `GATE: PASS` nu de `PF-325` : le piège est toujours
  armé et se déclencherait sur n'importe quel `grep` du verdict.
* **Aucune sonde live, et aucune n'est revendiquée.** Docker Desktop refuse de démarrer pour le **quatrième** run
  consécutif, et `pilotage@5432` répond avec `calendar_event=0, school=0, student=0, tenant=0`. Les magnitudes
  14/36 et 37/39 de l'audit **n'ont pas été re-dérivées** — seuls les mécanismes le sont, par la source et par
  des tests exécutables. `apps/web` n'ayant aucun runner unitaire, la preuve comportementale vit dans
  `apps/api/src/shared/quality/` contre `@pilotage/contracts` : c'est une contrainte du dépôt, pas un choix.

---

## ~~Next slice → terminer `S-E03-8`, puis l'`epic-spec`~~ — POINTEUR SUPERSÉDÉ au run 93 par un OVERRIDE opérateur, et **non sur le fond**

Ce pointeur rangeait `PF-36` parmi les constatations « jamais commencées » et recommandait `S-E03-8` puis
l'`epic-spec`. L'override du run 93 a désigné `S-E03-7` / `PF-36`. **L'override gagne** — c'est écrit dans
`S-E03-7.md` §0.1 — mais les deux arguments ci-dessous restent vrais et n'ont PAS été traités : les conditions de
land de `S-E03-8` et l'`epic-spec`, désormais **en retard de DIX tranches**. Le pointeur vivant est à la FIN de ce
fichier. Bloc conservé inédit ci-dessous comme trace de son raisonnement.

## Next slice → terminer `S-E03-8`, puis l'`epic-spec` (en retard de NEUF tranches)

**1. Les conditions de land de `S-E03-8` d'abord, et ce n'est pas de la cosmétique.** Les trois rouges, `OPEN.md`,
et les deux commentaires qui sur-affirment. Trois des quatre sont des minutes de travail ; le premier demande
d'appliquer le remplacement déjà rédigé plutôt que le raccourci qui rendrait le vert en rouvrant `PF-406`.

**2. Puis l'`epic-spec`, dont l'argument s'est renforcé au run 92.** Il y a maintenant **sept** modules
contractuels frères — `academic-year/`, `enrollment/`, `guardianship/link-liveness.ts`,
`students/student-scope-where.ts`, `alerts/alert-rule-population.ts` et, depuis cette tranche, `calendar/window.ts`
**et** `school-time/anchor.ts`. Que la huitième story ait dû **inventer un second domicile** dans son propre §D1,
parce que le foyer canonique n'a pas le droit d'importer `Intl`, est exactement la forme d'une décision qui
appartient à un spec-kit. `PF-365` / `PF-370` attendent depuis six runs.

**3. Chiffres de l'épic après neuf tranches : 2 fermées sur 9** (`PF-15` sur un axe, `PF-20` entière), **`PF-40`
revendiquée sous conditions**. Les six restantes se répartissent toujours en deux familles que la spec devrait
séparer : bloquées sur des **arbitrages sémantiques** (`PF-12` deux axes survivants, `PF-04`) ; **jamais
commencées** (`PF-24`, `PF-50`, `PF-36`, `PF-05`).

**4. Si une tranche d'implémentation est préférée malgré tout**, `PF-24` reste la moins chère qui ferme une
constatation — mais **lire `ci/2026-08-26-v3-e03-snapshot-terminal-conflict` avant de commencer**
(`project_midrun_merge_hazard`). Alternative strictement contenue : `PF-405`, dont la tranche vient de mesurer les
deux sites vivants et dont le mécanisme de cliquet est déjà construit.

*(Écrit le 2026-08-27, passe de land de `S-E03-8`, run 92. Tranches ultérieures : annoter, ne pas supprimer.)*

---

## `S-E03-7` (run 93, 2026-08-27) — une classe n'a qu'UN effectif, et la somme d'effectifs cesse d'être présentable comme un nombre d'élèves

Story : [`docs/spec/features/v3-e03/stories/S-E03-7.md`](./stories/S-E03-7.md).
ADR : [`docs/adr/ADR-079-canonical-class-roster-size.md`](../../../adr/ADR-079-canonical-class-roster-size.md).
Branche : `ci/2026-08-27-v3-e03-roster-size-canonical`. **Sélection : OVERRIDE opérateur** — le pointeur de ce
fichier nommait autre chose (§0.1 de la story).

### Ce qui était faux

« Combien d'élèves dans cette classe ? » avait **quatre** réponses vivantes, et **deux d'entre elles vivaient dans
le même endpoint** :

| forme | population | où |
|---|---|---|
| **V-A** `_count: { enrollments: true }` | **les SIX** valeurs d'`EnrollmentStatus` | `classes.controller.ts:171` (détail) · `assessments.controller.ts:123` |
| **V-B** `_count: { enrollments: { where: { status: 'active' } } }` | `active` seule | ~13 sites, 4 fichiers |
| **V-C** `new Set(rows.map(e => e.studentId)).size` | élèves distincts, année épinglée | `teachers.controller.ts` (`GET /teachers/:id/load`) |
| **V-D** somme d'une `Map<classSectionId, size>` | classes dé-dupliquées, **élèves non dé-dupliqués** | `apps/web/.../teacher/settings/page.tsx` (client) |

`GET /classes` comptait `active`, `GET /classes/:id` comptait **tous les statuts** : la même classe s'affichait
**25 dans la liste et 26 dans le détail**. C'est, à la lettre, le *« one class alternates between 25 and 26 »* de
l'audit (`02_Internal_Platform_Audit.md:140`). L'écart 43 / 46 / 48 est la même chaîne, un cran plus haut : le
tableau de bord enseignant **sommait** des effectifs par affectation (l'enseignant physique-chimie voyait sa classe
deux fois) là où `/load` dé-dupliquait les élèves.

**Docker était à l'arrêt et `pilotage@5432` rend `enrollment = 0` : aucun des chiffres 43 / 46 / 48 / 25 / 26 n'a
été re-mesuré, et aucun n'est revendiqué.** Ce qui est mesuré, c'est la SOURCE — et la chaîne de populations est
monotone, donc elle IMPOSE l'ordre des magnitudes sans données. C'est le tier de preuve B, dit comme tel.

### Le remède, et pourquoi il a cette forme

- **Un foyer, hors `@prisma/client`** : `packages/contracts/src/roster/class-roster-size.ts` (564 l.), frère de
  `academic-year/`, `enrollment/`, `guardianship/`, `calendar/`, `school-time/`. L'adaptateur Prisma
  (`apps/api/src/shared/roster/prisma-roster-reader.ts`, 33 l., `Pick<PrismaClient, 'enrollment'>`) **ne prend
  aucune décision de portée** : il transmet le `where` construit par le contrat, verbatim.
- **Le TYPE fait le travail, pas le commentaire.** `ClassRosterSize`, `DistinctStudentCount` et
  `SummedRosterSizes` sont *branded* : présenter une somme d'effectifs comme un nombre d'élèves est **inexprimable**
  côté serveur (`AC-2`, prouvé par `@ts-expect-error`). `DistinctStudentsWhere.tenantId: string` est **requis par le
  type** plus un garde runtime : une lecture directe sans tenant est inexprimable (`PF-412`).
- **Une année déclarée, jamais supposée.** Chaque appel passe un `RosterYearScope` — soit `{ academicYearId }`, soit
  le marqueur explicite `ROSTER_YEAR_IMPLIED_BY_SECTION`. Ce marqueur existe parce que **rien dans la base ne lie
  `Enrollment.academicYearId` à `ClassSection.academicYearId`** (`PF-409`, mesuré sur `pg_constraint`) : la tranche
  ne corrige pas ce trou, elle l'empêche d'être silencieux.
- **Les gardes d'ÉCRITURE ne sont pas converties** (`AC-9`) : `attendance.controller.ts:533`,
  `grades.controller.ts:138`, `enrollments.controller.ts:726` / `:936`, `students.controller.ts:546` sont
  **ÉPINGLÉES avec la raison écrite**. La seule garde convertie (`classes.controller.ts` `@Delete`) l'est en
  **forme uniquement** : `seated === ['active']`, verdict identique.
- **Les renommages sont l'acte honnête.** `studentCount → distinctStudentCount`, `totalStudents →
  totalEnrolments`, `ÉLÈVES → EFFECTIF`, `Élèves suivis → Inscriptions`. Un `number` ne peut pas dire à quelle
  question il répond ; son nom le peut.
- **Le cliquet** : `apps/api/src/shared/quality/class-roster-size-derivation-gate.spec.ts` (1 140 l.) — corpus
  dérivé par MARCHE (jamais énuméré), `MANUAL_ALLOWLIST` vide et une assertion qui le prouve, aucun `SKIP_*` /
  `ALLOW_*` / `NODE_ENV` (`DNC-10`), et un **contrôle POSITIF** qui assied que les sites `ADR-072` ancrés sur
  l'ÉLÈVE PASSENT — sans lui, le cliquet exigerait de casser `ADR-072`.

### Preuve exécutée

| contrôle | résultat |
|---|---|
| `pnpm typecheck` (une fois, ~1 m 45) | **13/13 vert**, `grep -c "error TS"` = **0** (57 au premier passage — voir « la variance ») |
| `git diff HEAD --check` / `--cached --check` | exit 0 |
| 4 suites de la story + la suite de conformité ajoutée au gate | **112 / 112** |
| cliquet voisin `enrollment-activity-derivation-gate.spec.ts` (`AC-6`) | **37 passés** — le plancher `ADR-072` survit |
| `students-aggregate-active-share.spec.ts` (écrite au gate, **contrôle ROUGE exécuté puis arbre restauré**) | l'ancienne dérivation rendait **« 133,3 % des 3 élèves … »** ; 6 tests verts sur la nouvelle |

**La variance — la leçon durable de cette tranche.** Le module typait toutes les listes de filtres en `readonly` ;
Prisma 5.22 déclare `EnumEnrollmentStatusFilter.in?: EnrollmentStatus[]` **mutable**. Résultat : **57 erreurs TS**
sur 5 fichiers et 3 portails, dont ~40 en cascade (l'inférence de payload s'effondre dès que le littéral `include`
est rejeté). **Aucune des trois specs neuves ne pouvait le voir** : `ts-jest` transpile sans vérifier les types —
`landed ≠ typechecked`. Corrigé **en UN endroit**, à la frontière du contrat (copie mutable fraîche par appel,
listes sources `as const` intactes), **jamais par un `as` par site d'appel**, et **aucun `as unknown as` n'a été
ajouté**. Enregistré ici parce que c'est une lacune de barre de preuve, pas un défaut de code.

### `AC-7` — les nombres qui CHANGENT

Six énumérés par la story (détail `_count` 26→25 · % de saisie `teacher/assessments` · en-tête `admin/structure` ·
`studentCount` par matière du tableau de bord enseignant · roll-up par cycle · `activePct`). **Un SEPTIÈME a été
trouvé en revue et n'est PAS dans l'énumération : `activeStudents`**, la grande valeur de la carte « ÉLÈVES ACTIFS »
de `/admin/students`, qui change pour **deux** causes indépendantes (lignes → têtes, et tenant → école). Par la
règle de la story elle-même — *« un changement de valeur non listé est un échec de la tranche »* — c'est une
condition de land, pas une surprise.

### Constatations

| id | état |
|---|---|
| **`PF-36`** | **revendiquée comme la CLASSE des dérivations converties** (`ADR-079` §D7) — **la ligne `OPEN.md:119` est encore `open` et n'a pas été mise à jour** |
| **`PF-410`** | **fermée** — l'en-tête `/admin/school/structure` comptait tout le tenant sous un arbre entièrement clé par école |
| **`PF-412`** | **enregistrée fermée, et elle ne l'est PAS** — voir conditions ci-dessous |
| `PF-361` | **annotée, id conservé** (re-mesure sur la base vivante : `pg_indexes` rend 5 index sur `enrollment`, aucun partiel) |
| `PF-409`, `PF-411`, `PF-413`, `PF-414`, `PF-415` | **enregistrées, non corrigées** (RECORD, DON'T FIX) |
| `PF-416`, `PF-417` | contraste de gradients de matières : 13 des 16 passent désormais, **3 résiduels mesurés** |
| **`PF-362`** | `AC-10` la déclarait fermée par §3 D2 ; **la ligne `OPEN.md:171` est encore `open`** |

### Conditions de land — écrites pour ne pas être re-découvertes

1. **`PF-412` est enregistrée `closed` et ne l'est pas.** `apps/api/src/modules/school-structure/classes.controller.ts:355`
   est byte-identique à `main` : `this.prisma.enrollment.count({ where: { classSectionId: id } })` — **aucun
   `tenantId`**. Le `_count` au-dessus a bien été converti, mais vers `rosterCountArg`, qui par son propre docblock
   **ne peut pas porter de tenant**. Le risque de fuite réel est nul (`cls.tenantId !== me.tenantId` lève en
   amont), mais **une ligne `[security][tenant]` quitte le backlog sur la foi d'un remède absent, et rien ne la
   re-détectera jamais**. Corriger le site, ou rouvrir la ligne et dire ce qui a réellement été livré.
2. **`PF-36` et `PF-362` : les lignes `OPEN.md` contredisent l'ADR.** `PF-36` reste `open` avec la mention *« no
   teacher count has been re-measured across portals »* pendant que `ADR-079` la déclare fermée comme classe.
   Trancher : soit la ligne dit « fermée comme la classe convertie, contre-mesure de portail non faite », soit
   l'ADR retire la revendication.
3. **`activeStudents` — le septième nombre**, à ajouter à `AC-7` avec son avant/après et son sens, et à documenter
   sur le champ côté FE (le docblock ajouté ne documente que `activePct`).
4. **Trois `COUNT` devenus des `findMany` non bornés** sur des chemins admin chauds (`structure.controller.ts:148`,
   `analytics.service.ts:3571`, `:2827`). Correct sur le fond, invisible sur une base vide, **O(élèves) lignes
   matérialisées par requête** en production. Les deux qui ne veulent qu'un scalaire doivent passer par
   `groupBy({ by: ['studentId'] }).length` — la dérivation reste identique, la dé-duplication redescend dans
   Postgres.
5. **`teacher/assessments` : numérateur et dénominateur comptent désormais des populations différentes.** Le
   dénominateur est passé à `seated` ; le numérateur `_count.grades` compte **toutes** les notes, y compris celles
   d'élèves depuis `dropped`. `fullyGraded` peut donc virer au vert avec 22 élèves notés sur 24 assis.
6. **`ADR-079` §D1 a été réécrit au gate** : il enregistrait — et REJETAIT explicitement — l'option qui a été
   livrée. Corrigé, avec l'argument de partition (`ADR-072` = ancré ÉLÈVE → état ; `ADR-079` = ancré SECTION →
   nombre) remonté du docblock vers le registre architectural.
7. **`PF-409`…`PF-412` désignaient deux jeux de faits différents** entre l'ADR et la source. Renumérotés **par le
   SENS** (l'allocation de la source gagne : sept ids sont déjà gravés dans des docblocks livrés), avec un **§7a**
   qui enregistre la renumérotation elle-même. Les lignes `OPEN.md` existent désormais et arbitrent.
8. **`AC-4` est prouvé sur une fixture MONO-ANNÉE.** Les deux surfaces déclarées « d'accord » lisent avec des
   portées d'année différentes (`ROSTER_YEAR_IMPLIED_BY_SECTION` contre `{ academicYearId }`) ; la fixture ne peut
   pas exhiber la divergence que `PF-409` dit que rien n'empêche. La décision conservatrice est défendable ; la
   phrase « les deux s'accordent désormais » est plus forte que la preuve.
9. **Accessibilité, deux lignes NEUVES** : la sous-ligne de portée 10 px `text-slate-400` est à **2,56 : 1**
   (3 sites) — la maison a déjà la réponse une couche plus loin (`KpiCard.tsx:263`, `text-xs text-slate-600`,
   7,4 : 1) ; et `focus-visible:outline-white` sur `SubjectKpiCard` est peint **hors** de la carte, sur
   `--surface-page`, à **1,09 : 1** (SC 2.4.11).

*(Écrit le 2026-08-27, passe de land de `S-E03-7`, run 93. Tranches ultérieures : annoter, ne pas supprimer.)*

---

## Next slice → **lever les conditions de land de `S-E03-7` et de `S-E03-8`**, puis l'`epic-spec` (en retard de DIX tranches)

**1. Les conditions d'abord, et une seule d'entre elles est vraiment urgente.** Sur les neuf ci-dessus, **la n° 1
est la seule qu'aucun gate, aucun typecheck et aucune exécution ultérieure ne rattrapera jamais** : une ligne de
traçabilité `[security][tenant]` marquée `closed` sur un remède absent. C'est, d'un cran au-dessus, exactement le
défaut que la tranche corrige — un nombre (ici : un état de ligne) qui prétend répondre à une question à laquelle
il ne répond pas. Les n° 2, 3 et 6 sont des minutes ; les n° 4, 5 et 9 sont de petites tranches propres.

**2. La tranche la moins chère qui ferme quelque chose : `PF-24`.** Inchangé depuis le run 92 — mais **lire
`ci/2026-08-26-v3-e03-snapshot-terminal-conflict` avant de commencer** (`project_midrun_merge_hazard`).

**3. Candidate strictement contenue, et elle vient d'être outillée : `PF-417`.** Poser dans
`apps/api/src/shared/quality/` le cliquet qui assied
`subjectColor(code).onGradientContrast >= WCAG_AA_NORMAL_TEXT` pour tout code hors du résiduel enregistré. La
dérivation de contraste existe déjà (`packages/ui/src/lib/subject-color.ts`, mesurée et non tenue à la main) ; il
ne manque que la barrière, et sans elle la prochaine matière ajoutée peut ré-arriver à 1,5 : 1.

**4. Puis l'`epic-spec`, dont l'argument s'est encore renforcé.** Il y a maintenant **huit** modules contractuels
frères, et la huitième story a dû **arbitrer son propre foyer dans son §D1** — puis se faire corriger au gate parce
que l'ADR enregistrait l'option rejetée. Deux runs de suite, une tranche d'implémentation a payé le prix d'un
spec-kit absent. `PF-365` / `PF-370` attendent depuis sept runs.

**5. Chiffres de l'épic après dix tranches : 2 fermées sur 9 fermement** (`PF-15` sur un axe, `PF-20` entière),
**`PF-40` revendiquée sous conditions (run 92)** et **`PF-36` revendiquée sous conditions (run 93)**. Les cinq
restantes : bloquées sur des **arbitrages sémantiques** (`PF-12` deux axes survivants, `PF-04`) ; **jamais
commencées** (`PF-24`, `PF-50`, `PF-05`).

> **Annotation run 94 (`S-E03-9`) — ce pointeur est périmé sur un point.** `PF-50` n'est plus « jamais
> commencée » : la tranche `S-E03-9` l'attaque (spec écrite le 2026-08-27). Elle ne la FERME pas, et le §11 de la
> story dit pourquoi en toutes lettres. Le reste du pointeur tient. **La sélection de ce run est un OVERRIDE
> opérateur, pas un suivi de ce pointeur** — la story `S-E03-9` le dit dans son §0.

---

## `S-E03-9` — LIVRÉE (run 94, 2026-08-27) — ⚠️ revue humaine requise

**Statut : implémentée et livrée dans ce même run.** Fichier de story :
`docs/daily-improvement-v3/stories/S-E03-9.md`. Section de planification conservée telle quelle ci-dessous ;
**la passe de land est annotée à la fin de cette section** (« Annotation de land »), pas fondue dedans.

### Ce qui est mesuré, et ce qui ne l'est pas

**Aucune sonde live. Aucune n'était possible** : Docker Desktop refuse de démarrer pour le **cinquième run
consécutif** et la base locale `pilotage@5432` est vide (`enrollment = 0`). Tous les chiffres ci-dessous sont
**mesurés en source** ou **exécutés dans un `node` nu**. La tranche est en **palier de preuve B** et la story
interdit explicitement d'écrire « vérifié contre la pile ».

**Le défaut, mesuré.** Une fenêtre de pagination est analysée **neuf fois, dans neuf fichiers**. Huit sont des
expressions `parseInt`/`Math.min` écrites à la main ; la neuvième
(`packages/contracts/src/dto/conversation.ts:105-108`) est un schéma Zod **déjà correct**, et c'est la seule.
Les neuf divergent sur **cinq défauts** (20 / 50 / 100 / 200), **quatre plafonds** (100 / 200 / 500 / aucun) et —
l'axe que l'audit n'avait pas nommé — **trois réponses incompatibles à une entrée invalide** (`PF-422`).

Table exécutée dans `node` (reproduite intégralement au §2.2 de la story) :

| entrée | analytics / students / guardians / lessons | alerts / notifications / teachers / attendance |
|---|---|---|
| `?limit=-5` | **`take: -5`** → Prisma prend **par la FIN, à l'envers** | `1` (borné en bas) |
| `?limit=0` | le **défaut** (50 ou 100) | `1` ou le défaut, selon le site |
| `?limit=1e3` | **`1`** (`parseInt` s'arrête à `e`) | **`1`** |
| `?limit=abc` | le **défaut**, en silence | `alerts` : **400** ; les trois autres : le défaut |
| `?offset=-5` | analytics / students : **`skip: -5`** → erreur runtime Prisma (500) | borné ou absent |

Ce n'est **PAS** une rupture d'autorisation : `tenantId` est sur chacun de ces `where` et la tranche n'en touche
aucun. La story l'écrit explicitement pour que la revue ne perde pas le vrai défaut dans ce débat.

**L'endpoint non borné.** `apps/api/src/modules/teaching/teaching-assignments.controller.ts:55-89` est un
`findMany` **sans `take`, sans `skip`, sans `total`**, avec **quatre `include` imbriqués** (l'audit A2 App. K.4 y
mesurait 290 lignes).

**Le piège de vérité, et il est plus grave que ce que le brief annonçait.** `admin/assignments/page.tsx:39-43`
dérive **quatre KPI** du tableau reçu. Mais `AssignmentsManager.tsx:455-490` en dérive en plus une **affirmation
d'ENSEMBLE** — « *Couverture complète. Toutes les classes actives ont un professeur principal…* ». Un KPI trop bas
est faux ; **un panneau de couverture piloté par une page INVENTE des alertes de classe sans professeur
principal**, et la boucle alerte→action est la promesse centrale du produit. C'est `DNC-01` appliqué à un
**ensemble** et non à un compte : `PF-421`, mis dans le périmètre par l'`AC-5b`.

### Recensement, mesuré par cette story (et il ne concorde pas avec le brief)

```
files scanned: 174
findMany call sites (non-spec): 213
  with take:  57
  WITHOUT take: 156
```

Le brief annonçait **158 sur 216**. Cette story mesure **156 sur 213**, script inclus verbatim au §5.6, et
l'`AC-6(b)` ordonne à l'agent d'implémentation de **re-mesurer** plutôt que d'adopter l'un ou l'autre chiffre. Le
gel du cliquet se fait sur le nombre **post-diff** (attendu : **155**) et non pré-diff — un durcissement délibéré
par rapport au brief, à consigner dans `ADR-080 §D6`.

### Deux corrections de fait apportées au brief

1. `apps/api/src/modules/teachers/teachers.controller.ts` **n'existe pas**. Le vrai chemin est
   `apps/api/src/modules/teaching/teachers.controller.ts` — le module qui porte déjà
   `teaching-assignments.controller.ts`.
2. La neuvième forme (le schéma Zod de messagerie) n'est **pas** un contrevenant : c'est la **seule implémentation
   correcte du contrat présente dans l'arbre**. La story ne la « convertit » donc pas, elle la **ré-exprime** sur
   le canon (`.extend()`), pour que la référence devienne un **usage** du canon et non un **doublon**. C'est aussi
   l'argument n° 1 du foyer choisi (`packages/contracts/src/pagination/page-window.ts`) : le canon est la généralisation
   d'un frère `contracts` existant, pas un foyer neuf.

### Ce qui est déclaré HORS périmètre, comme des RAISONS et non comme des chemins en attente

`PF-419` (transfert de tuples dans `messaging.service.ts:679-686` — le remède est un `lateral join` SQL brut, donc
un **motif d'architecture nouveau** avec son propre ADR), `PF-420` (éventail 2N du dashboard parent — exige un
nouvel endpoint agrégat `/batch`), `PF-424` (filtres client), `PF-425` (`/classes` et `/subjects` lus entiers),
`PF-426` (les 155 `findMany` restants). Ce sont les cinq raisons pour lesquelles `PF-50` est **avancée et NON
fermée** : écrire `closed` ici serait exactement l'erreur `closed ≠ fixed` consignée au run 93.

*(Écrit le 2026-08-27, run 94, passe de planification. Tranches ultérieures : annoter, ne pas supprimer.)*

### Annotation de land (run 94, 2026-08-27) — ce qui a changé entre la planification et la livraison

**1. Le chiffre du recensement a bougé, et c'est le CLIQUET qui fait foi.** La section de planification annonce
155 / 213 ; la mesure post-diff exécutée par le cliquet est **151 sur 210 appels, 174 fichiers**
(`page-window-derivation-gate.spec.ts`, `CENSUS_CEILING = 151`). Les lignes `OPEN.md` de `PF-50` et `PF-426`
citent encore 155 / 156 sur 213 : **elles sont périmées et doivent être ré-alignées sur la constante du cliquet**,
qui est la définition exécutable. C'est, en petit, la dérive « deux listes tenues à la main » que la tranche
existe pour supprimer — consignée ici plutôt que corrigée en silence.

**2. Le foyer n'est pas celui que la story avait nommé.** La story écrivait
`packages/contracts/src/pagination/page-window.ts` ; le module a été posé à
`packages/contracts/src/pagination/page-window.ts`, exporté depuis `src/index.ts`. Le chemin livré est le **bon**
(convention des frères `src/calendar`, `src/school-time`, `src/roster` — `ADR-078 §D1`, `ADR-079`) et `ADR-080
§D1` en décide explicitement. **Le texte de l'`AC-1` est périmé, pas l'implémentation.**

**3. La tranche a livré son propre défaut, et il a été rattrapé au gate, pas par un test.** Les deux moitiés ont
été écrites dans DEUX checkouts (BE + contracts + UI dans le dépôt principal, `apps/web` dans
`.claude/worktrees/practical-heyrovsky-b95dad`). Chacune typecheckait au vert **contre sa propre forme écrite à la
main** : l'API émettait `totals`, la page lisait `summary`. Résultat sur l'arbre fusionné : les quatre KPI à `—`
et le panneau de couverture définitivement « indisponible ». Réconcilié en faveur de `totals` (le nom de
l'`ADR-080 §D4`), avec `coverage.subjectIdsWithTeacher` ajouté comme **huitième agrégat tenant-clé** parce que le
panneau NOMME les matières et qu'un scalaire ne peut pas produire des noms. **`api<T>()` reste un cast non
validé : rien n'empêche structurellement la récidive**, et le test de forme de réponse prescrit par le
test-architect n'a **pas** été écrit.

**4. Un test de la tranche est ROUGE sur l'arbre livré.**
`apps/api/src/shared/pagination/page-window.spec.ts:505` (`AC-8 / G-TENANT`) attend **sept** lectures ; le
handler en émet **huit**. Les huit portent `tenantId` — ce n'est pas une fuite, c'est la preuve que la suite n'a
pas été relancée après le huitième agrégat. **Le remède est de DÉRIVER le compte** des mocks, jamais de passer le
littéral à `8`.

**5. Zéro preuve live.** Docker à l'arrêt pour le cinquième run consécutif, base locale vide. Palier de preuve
**B** : mécanisme prouvé en `node` nu et par typecheck, **déploiement non prouvé**. Aucune phrase de cette section
ne doit être lue comme « vérifié contre la pile ».

*(Écrit le 2026-08-27, run 94, passe de land. Tranches ultérieures : annoter, ne pas supprimer.)*

---

## ~~Next slice → **lever les trois conditions de land de `S-E03-9`**, puis l'`epic-spec` (en retard de ONZE tranches)~~ — **point 1 LIVRÉ au run 95 par `S-E03-11`** (`ADR-081`). Les points 2 à 5 sont intacts et tiennent toujours. Conservé tel quel ; **le pointeur vivant est à la FIN de ce fichier**

**1. La condition la plus urgente n'est pas le test rouge, c'est le cast non validé.** `AC-5a` / `AC-5b` sont
« corrigées mais non prouvées » : le contrat de réponse de `GET /teaching-assignments` est écrit **deux fois à la
main** — une fois dans le `return` du contrôleur, une fois dans
`apps/web/src/app/admin/teaching-assignments/types.ts` — et `api<T>()` caste sans valider. Le défaut vient d'être
commis puis réparé **dans le même run** ; rien dans l'arbre n'empêche le suivant. La tranche est petite et bien
définie : porter la forme de réponse dans `packages/contracts` (à côté de `pageWindow`), la faire importer par le
contrôleur ET par `types.ts`, et asserter l'égalité des clés dans un spec. **Ne pas la ré-écrire comme une
deuxième liste de clés recopiée** — ce serait la dérive de listes appariées reproduite pour la troisième fois dans
la même tranche.

**2. Puis le test rouge et les deux lignes `OPEN.md` périmées** — minutes, pas une tranche : dériver le compte de
lectures de l'`AC-8`, et ré-aligner `PF-50` / `PF-426` sur `CENSUS_CEILING = 151` sur 210 (+ corriger le chemin
`dto/` → `pagination/` dans les trois artefacts qui le citent).

**3. Candidate strictement contenue, et elle ferme un trou que cette tranche a laissé ouvert : borner `offset`.**
`pageWindow` plafonne `limit` et **pas** `offset` (`z.coerce.number().int().min(0)`, sans `.max()`), et le module
est désormais canonique pour treize endpoints dont `GET /api/v1/analytics/audit`. `?offset=1e21` est accepté et
part vers Prisma. Ce n'est **pas** une régression (les `parseInt` remplacés n'avaient pas de plafond non plus),
mais c'est maintenant le seul endroit où le trou peut être fermé **une fois**.

**4. Puis l'`epic-spec`, dont l'argument se renforce d'un cran de plus.** Il y a maintenant **neuf** modules
contractuels frères, et la neuvième story a dû, comme la huitième, **arbitrer son propre foyer dans son §D1** —
puis voir son propre `AC-1` devenir périmé parce que l'arbitrage a gagné contre le texte. Trois runs de suite, une
tranche d'implémentation a payé le prix d'un spec-kit absent. `PF-365` / `PF-370` attendent depuis huit runs.

**5. Chiffres de l'épic après onze tranches : 2 fermées sur 9 fermement** (`PF-15` sur un axe, `PF-20` entière),
**`PF-40` et `PF-36` revendiquées sous conditions** (runs 92 et 93), **`PF-50` avancée avec un résidu NOMMÉ**
(`PF-426`, run 94). Les quatre restantes : bloquées sur des **arbitrages sémantiques** (`PF-12` deux axes
survivants, `PF-04`) ; **jamais commencées** (`PF-24` — mais voir `ci/2026-08-26-v3-e03-snapshot-terminal-conflict`
avant de démarrer —, `PF-05`).

---

## `S-E03-11` — l'enveloppe de page devient un CONTRAT, et le client cesse d'AFFIRMER la forme qu'il lit (run 95, 2026-08-28) — ⚠️ revue humaine requise

**Statut : implémentée et livrée dans ce même run.** Story `docs/daily-improvement-v3/stories/S-E03-11.md` ;
ADR `docs/adr/ADR-081-canonical-page-envelope.md`. **Portée : 19 fichiers, +2710 / −47.** Aucune migration, aucun
changement de `schema.prisma`, aucun octet de payload modifié, aucun `where` / `take` / `skip` déplacé, aucune
surface d'autorisation ni d'audit touchée.

### Ce qui était faux, mesuré sur l'arbre le 2026-08-28

`apps/web/src/lib/api-client.ts:124` finissait sur `return (await res.json()) as T`. Ce `as T` est une
**affirmation**, jamais une vérification : `T` est ce que le site d'appel a écrit à la main, et **rien dans le
processus ne le compare à ce que le serveur envoie réellement**. Recensement exécuté (382 fichiers parcourus) :
**211 sites `api<…>(` sur 117 fichiers**, dont **dix** déclarent à la main une enveloppe `data` + `total` — le
brief en annonçait quatre, et la story corrige le chiffre au lieu de l'absorber.

**Ce n'est pas un risque théorique : le run 94 a commis puis réparé ce défaut exact à l'intérieur d'un seul run.**
Les deux moitiés de `S-E03-9` ont été écrites dans deux checkouts ; l'API émettait `totals`, la page lisait
`summary` ; **les deux typecheckaient au vert** et l'arbre fusionné rendait les quatre KPI à `—` avec un panneau de
couverture définitivement « indisponible ». C'est `PF-427`, et sa ligne `OPEN.md:337` porte l'ordre que cette
tranche exécute : *« Do NOT close this by adding one assertion to one page. »*

### Le remède, et pourquoi il a cette forme

Une fabrique `pageEnvelope()` dans `packages/contracts/src/pagination/page-envelope.ts`, **à côté de
`pageWindow`** (`ADR-081 §D1` : `apps/web` importe déjà `@pilotage/contracts` en valeur à une vingtaine
d'endroits, et les trois paquets épinglent `zod ^3.23.8`). Deux faces d'un seul objet : le serveur **déclare** sa
forme de retour, le client la **parse**.

- **Deux émetteurs déclarent** : `teaching-assignments.controller.ts` et `analytics.service.ts` (`AuditListResult`
  re-basée sur `PageEnvelope<AuditListRow>`). Renommer `totals` en `summary` *dans `apps/api`* ne compile plus.
- **Quatre lecteurs analysent** : `/admin/audit`, `/admin/exports`, `/admin/students`, `/admin/assignments`, via un
  `apiEnvelope()` **additif** posé à côté d'`api()` — les 205 autres sites d'appel sont intacts et le diff reste
  relisable.
- **`.passthrough()` est le choix load-bearing du schéma.** Un `z.object({ data, total })` nu aurait **retiré**
  `kpis` / `filters` à l'exécution, tous types au vert — un défaut pire que celui qu'on corrige, et sur la surface
  d'audit RGPD.
- **`ResponseShapeError` n'étend délibérément PAS `ApiError`.** Les cinq copies locales de `safe()` re-lèvent tout
  ce qui n'est pas une `ApiError`, donc une rupture de contrat atteint `app/admin/error.tsx` **au lieu d'être
  blanchie en « lecture indisponible »**. C'est `G-TRUTH` : mieux vaut une page en erreur qu'un nombre faux
  présenté comme vrai.
- **`requiredKey<T>()` existe parce que `z.unknown().isOptional()` vaut `true`** — une clé déclarée `z.unknown()`
  aurait laissé le défaut du run 94 traverser le contrat intact.
- **La fuite de PII a été anticipée structurellement** : `responseShapeIssues()` ne projette que `path` / `code` /
  `expected` (les trois dérivés du **schéma**, jamais de la réponse), la `ZodError` n'est pas attachée à l'erreur,
  et la chaîne de requête est retirée du libellé d'endpoint. Vérifié maillon par maillon par la lentille sécurité.

### Preuve, et son palier

**Palier B. Aucune sonde live, et aucune n'était possible** — Docker Desktop refuse de démarrer pour le
**sixième run consécutif**, `pilotage@5432` est vide. Tout est mesuré en source ou exécuté dans un `node` nu.

- `apps/api/src/shared/pagination/page-envelope.spec.ts` (398 l.) — la preuve rouge-avant / vert-après de la
  fabrique : le payload exact du run 94 est rejeté, et le schéma **NOMME** la clé fautive.
- `apps/api/src/shared/quality/page-envelope-boundary-gate.spec.ts` (544 l.) — le cliquet à sens unique :
  `R1_CEILING = 1` (déclarations nommées `data`+`total` dans `apps/web/src`), `R2_CEILING = 6` (transtypages
  `api<{ data … total … }>` en ligne), quatre planchers d'anti-vacuité, **allowlist vide**, et deux fixtures
  `__fixtures__/page-envelope/` qui prouvent que le classifieur mord indépendamment de l'arbre vivant.
- `pnpm --filter @pilotage/api run typecheck` **exit 0** après le correctif d'une ligne du gate
  (`audit-kpis.spec.ts:253`, `Array<{id}>` → `ReadonlyArray<{id}>` : le `readonly` de `PageEnvelope.data` porte la
  garantie `G-DNC` et ne devait pas être retiré). `@pilotage/contracts` et `@pilotage/web` étaient déjà verts.

### `PF-50` et `PF-427` sont AVANCÉES, aucune n'est fermée

`PF-50` : quatre lecteurs convertis sur ~150 que le §SEQUENCING de la story anticipe. `PF-427` : `data` et `total`
sont désormais réellement communs, **mais les clés d'EXTENSION restent deux listes écrites à la main dans deux
paquets** — `totals` / `coverage` / `limit` / `offset` côté assignments, `kpis` / `filters` côté audit. C'est
exactement là que vivait le défaut du run 94. Le progrès est réel (un `undefined` silencieux devient une erreur
runtime nommée) mais **c'est un garde-fou d'exécution, pas la clôture à la compilation** que la prose des
docblocks laisse entendre côté client.

### Conditions de land — écrites pour ne pas être re-découvertes

1. **`pnpm --filter @pilotage/contracts build` — condition de MERGE, pas une optimisation.** Le paquet résout
   `types → ./src/index.ts` mais `main → ./dist/index.js`, et `dist/pagination/` ne contient aujourd'hui que
   `page-window.*`. Les quatre pages importent `pageEnvelope` / `requiredKey` / `unvalidatedItem` **en valeur** :
   tant que le build n'a pas tourné, `/admin/audit`, `/admin/students`, `/admin/exports` et `/admin/assignments`
   lèvent au chargement du module — **pendant que le typecheck reste vert**, parce que les types viennent de la
   source et le runtime du `dist`. C'est la classe même de défaut que la tranche ferme, reproduite un étage plus
   bas, et aucun gate de l'arbre ne peut la voir. Cette tranche n'avait pas le droit de construire (`GUARDRAILS §4`).
2. **`OPEN.md` est INTACT, et c'est la moitié manquante des critères d'acceptation.** `PF-50` et `PF-427` ne sont
   pas écrites `ADVANCED` (la ligne `PF-427:337` dit encore *« no story yet »* et *« a response-shape test was
   prescribed and was not written »* — les deux sont désormais fausses), et `PF-428`…`PF-433` n'ont **aucune
   ligne** : les six findings que la tranche existe pour ENREGISTRER ne vivent que dans un `const` TypeScript. Le
   `routine-governance-gate` ne rattrapera pas ça (il n'exige des lignes que pour `PF-01`…`57`). C'est la forme
   `project_held_pr_causes_duplicate_work` : le run suivant lit `PF-427` comme intacte et ré-implémente la tranche.
3. **`PF-428`…`PF-433` désignent des choses différentes dans TROIS fichiers livrés** — la story `§11`,
   `PAGE_ENVELOPE_DEFINITION.inheritedFindings` dans `page-envelope.ts`, et le cliquet. `ADR-081 §D6` enregistre la
   divergence au lieu de la trancher en silence. **Trancher sur le registre de la story avant d'écrire `OPEN.md`,
   et renuméroter PAR LE SENS, jamais par motif** — les ids sont déjà cités depuis des docblocks de production
   (`project_parallel_runs_collide_on_ids`).
4. **Le test que la tranche n'a pas écrit, et que trois lentilles ont réclamé indépendamment.** Rien ne prouve que
   les **octets** qu'un endpoint émet satisfont le schéma qu'une page parse : le spec prouve la *fabrique*, le
   cliquet prouve un *recensement de source*, et `apps/web` n'a aucun runner unitaire. Un test d'aller-retour fil
   dans `apps/api` (`JSON.parse(JSON.stringify(res))` contre la trame canonique — le round-trip compte, il efface
   la marque `ResultTotal` et exerce donc la valeur non typée que le navigateur reçoit) plus un contrôle négatif
   sur une clé renommée fermerait l'axe qui a réellement cassé. **Avec lui, l'assertion
   `ResponseShapeError instanceof ApiError === false` ET son contrôle positif** : ce prédicat est la charnière de
   tout le routage d'erreur et il n'est aujourd'hui garanti que par de la prose. S'il cède un jour, une rupture de
   contrat redevient `null` et les quatre pages affichent « Indisponible » — visuellement identique au défaut du
   run 94, et pire que lui.
5. **La garantie « aucune valeur de réponse dans le diagnostic » n'a pas de test qui l'exerce.**
   `page-envelope.spec.ts:161` assère sur des `issue.path` bruts — or un `path` zod est une liste de noms de clés,
   il ne peut **jamais** contenir une valeur : l'assertion est vraie à vide et passerait même si
   `responseShapeIssues()` n'existait pas. L'amélioration évidente du run suivant — *« rendons le diagnostic plus
   utile, ajoutons ce qu'on a reçu »* — est **une ligne** (`received: issue.received`) qui rouvre toute la classe
   et laisse tous les tests verts. Poser l'invariant au niveau source dans le cliquet, avec une sentinelle PII
   nichée en `data.0.guardians.0.email`.
6. **`requiredKey()` laisse passer `null`.** Le refinement teste `v !== undefined` seulement : un serveur qui émet
   `totals: null` ou `kpis: null` (la forme que produit un `?? null` défensif ou un sous-agrégat échoué) traverse
   le contrat au **vert**, et la page meurt au rendu sur `resp.totals.assignments` avec un `TypeError` qui ne nomme
   aucune clé et ne porte aucun chemin de requête. Correctif : `v !== undefined && v !== null`.
7. **`.passthrough()` affaiblit la vérification à la COMPILATION côté client.** `z.infer` d'un objet passthrough
   porte `& { [k: string]: unknown }` (vérifié dans `zod@3.25.76`, `v3/types.d.ts:507,521`). `TeachingAssignmentsResponse`
   et `ExportsListResp`, jadis des `interface` exactes, gagnent donc une signature d'index : `resp.summary` compile
   en `unknown` là où c'était une erreur. Le parse runtime rattrape le vrai défaut, donc le net reste positif —
   mais **c'est un échange, pas un gain pur, et rien dans le diff ne le dit**. Piste : exporter le type depuis la
   forme déclarée plutôt que depuis l'inférence brute.
8. **Deux planchers du cliquet sont épinglés sur des classes de défauts que la feuille de route s'engage à réduire
   à zéro.** `MIN_API_TYPED_CALL_SITES = 190` contre 205 mesurés (≈16 conversions de plus le rougissent) et
   surtout `MIN_BARE_DATA_CASTS = 50` contre 88 — or ce compte **EST** `PF-431` : le réduire rougit le plancher par
   construction. Un cliquet à sens unique dont les planchers sont franchis par la feuille de route qu'il séquence
   cliquette dans le mauvais sens. La compétence du classifieur est déjà prouvée par les fixtures : déplacer le
   témoin dans une fixture et supprimer le plancher.
9. **L'interlock R1 assère que TOUT délégataire vit sous `apps/web/src/app/admin/`.** Son domaine n'est pas les
   quatre fichiers convertis, c'est tout fichier qui adoptera jamais le contrat. La tranche suivante visée est
   `PF-429` = `apps/web/src/lib/parent-children.ts` — **pas sous `app/admin/`, et sur une surface de données
   enfant**. L'adopter rougit le gate, et le seul « correctif » disponible est d'affaiblir l'assertion. Aggravant :
   la détection est un `source.includes('pageEnvelope(')`, donc un simple commentaire mentionnant la fabrique
   ailleurs suffit à rougir un gate de correction.
10. **Le libellé d'endpoint ne retire que la chaîne de requête, pas les identifiants de CHEMIN.** Les deux
    docstrings justifient le retrait par *« une chaîne de requête porte des valeurs de filtre qui peuvent désigner
    un enfant »* — mais `/api/v1/students/<uuid>/…` en désigne un tout aussi directement, et la valeur part dans un
    `console.error` serveur. **Pas une fuite aujourd'hui** (les quatre endpoints convertis sont des collections
    sans identifiant de chemin, vérifié) ; latente dès la première conversion par ressource, et cet helper est
    explicitement conçu comme le point d'entrée des ~150 suivantes.
11. **`zod` entre dans le bundle client de `AssignmentsManager`.** Ce n'est **pas** `PF-133` — `@pilotage/contracts`
    est isomorphe et le module server-only reste `api-client.ts`, et les imports sont bien `import type` — mais
    `admin/teaching-assignments/types.ts` exporte désormais des **valeurs** à côté d'un composant `'use client'`.
    Personne n'a mesuré la taille. Le prochain `import {}` non-`type` depuis ce fichier tire zod dans le graphe.
12. **L'id de tranche a été renuméroté `S-E03-10` → `S-E03-11` à la passe de land.** `S-E03-10` était déjà pris par
    la tranche snapshot du run 89 (`PROGRESS.md:110`, `OPEN.md`, `bmad/roadmap.md`), et la collision avait été
    gravée dans **quatorze docblocks livrés** plus le nom du fichier de story. Renumérotée dans les seuls fichiers
    de cette tranche ; les vingt-et-une occurrences de l'ancienne `S-E03-10` dans `OPEN.md`, `roadmap.md` et
    ci-dessus sont intactes et continuent de désigner la tranche snapshot.

*(Écrit le 2026-08-28, run 95, passe de land. Tranches ultérieures : annoter, ne pas supprimer.)*

### Ce que la passe de land a RÉELLEMENT fait de ces onze conditions

**Six corrigées, cinq enregistrées.** Le partage n'est pas arbitraire : ont été CORRIGÉES les conditions qui
auraient soit cassé une page en production, soit **bloqué la tranche suivante**. Ont été ENREGISTRÉES celles qui
demandent une tranche à part entière (`RULE 0` clause 6, RECORD-DON'T-FIX).

| nº | Verdict | Ce qui a été fait |
|---|---|---|
| 1 | ✅ **CORRIGÉE, preuve exécutée** | `pnpm build` a produit `dist/pagination/page-envelope.{js,d.ts}`. La vérification ne s'arrête PAS à l'existence du fichier — ce serait exactement la classe de défaut de cette tranche : `require('./packages/contracts/dist/index.js')` rend `pageEnvelope`, `requiredKey`, `unvalidatedItem`, `pageWindow`, `resultTotal` **tous `function`**, la fabrique s'exécute, et le **passthrough survit à la compilation** (`{extra:'kept'}` préservé). C'était la condition de MERGE. |
| 2 | ✅ **CORRIGÉE** | `OPEN.md` : `PF-427` passe `open` → `in-progress` **AVANCÉE, NON FERMÉE**, et ses deux clauses devenues FAUSSES sont corrigées (il y a une story ; le test de forme A été écrit). `PF-50` gagne sa seconde avancée. **Quinze lignes** écrites. |
| 3 | ✅ **CORRIGÉE, arbitrée PAR LE SENS** | Les ids désignaient bien deux choses selon le fichier. Règle retenue : garder l'id que la **source livrée** cite le plus. `PF-428` = les six transtypages en ligne (cliquet ×3 + story) ; `PF-430` = le second type écrit à la main du handler d'audit (`analytics.service.ts:212` + story) ; `PF-429`/`PF-431`/`PF-432`/`PF-433` inchangés. Les sens qui perdaient leur place reçoivent des ids NEUFS : **`PF-439`** (`users.controller` `total: items.length`), **`PF-440`** (~9 autres émetteurs), **`PF-441`** (`/users`+alertes sans type de retour déclaré), **`PF-442`** (le « rouge hérité du run 94 »). `page-envelope.ts` corrigé en conséquence. **⚠ `PF-442` a ensuite été MESURÉ FAUX et la ligne est inversée** : `page-window.spec.ts` rend **48/48**, dont le cas `AC-8 / G-TENANT` nommé, et les deux passes de gate donnent **0 excédent** (les 4 lignes de base sont `PF-64`). La réclamation était vraie quand le run 94 l'a ÉCRITE et fausse quand la story l'a CITÉE — le même run l'avait corrigée dans la foulée, en DÉRIVANT le compte des mocks (`page-window.spec.ts:500-512`). Troisième fois que cette maison paie un verdict hérité plutôt que mesuré (`PF-374`, `PF-388`). |
| 4 | ⚠️ **PARTIELLE — et la moitié non faite est nommée** | Le test d'aller-retour FIL (`JSON.parse(JSON.stringify(res))`) n'a **pas** été écrit : c'est une tranche de test à part, et le prétendre fait serait `landed ≠ ran`. Il reste la meilleure prochaine amélioration de preuve de cette classe. |
| 5 | ✅ **CORRIGÉE, avec contrôle positif** | L'assertion PII était **vraie à vide** — un `issue.path` zod est une liste de NOMS DE CLÉS et ne peut jamais porter une valeur. Le piège est réel et **mesuré** : `zod@3` met la VALEUR BRUTE dans `issue.received` pour `invalid_literal`/`invalid_enum_value`, et l'enveloppe assignments porte exactement un tel littéral (`coverage.scope`). Invariant réécrit en « la projection ne porte QUE trois clés », précédé d'un **contrôle positif** prouvant que la sentinelle est atteignable dans l'issue brute. **Rouge-avant exécuté** : ajouter `received:` rougit exactement ce test. `PF-438`. |
| 6 | ✅ **CORRIGÉE, rouge-avant exécuté** | `requiredKey()` acceptait `null`. Mesuré des deux côtés avant correction ; corrigé en `v !== undefined && v !== null` ; test ajouté ; **revenir au garde d'origine rougit exactement ce test** (1 échec / 24 succès) et le restaurer rend 25/25. `PF-434`. |
| 7 | 📝 **ENREGISTRÉE** | Le `.passthrough()` affaiblit bien la vérification à la COMPILATION côté client (signature d'index). C'est un ÉCHANGE, pas un gain pur, et cela reste vrai. Non corrigé : dériver le type depuis la forme déclarée est une tranche de contrat. |
| 8 | ✅ **CORRIGÉE** | Deux planchers rougissaient **quand la feuille de route avançait** — dont un posé sur `PF-431` lui-même. Témoin d'anti-vacuité **déplacé dans la fixture** (et renforcé : il assère aussi que le classifieur DISCRIMINE, R2 restant à 2 et non 3), puis planchers retirés. Le recensement est désormais **publié, pas planché**. `PF-435`. |
| 9 | ✅ **CORRIGÉE — P1, parce qu'elle bloquait l'épic** | L'interverrouillage exigeait que **tout** délégataire vive sous `app/admin/`. La tranche suivante visée (`PF-429`, `lib/parent-children.ts`) l'aurait fait rougir en faisant précisément le travail prévu. Séparé en deux tests : un plancher de délégation (R1 ne peut pas être satisfait par une SUPPRESSION) et un **ensemble fermé** nommant les quatre fichiers de cette tranche. `PF-436` ; la détection par sous-chaîne subsiste, enregistrée en `PF-437`. |
| 10 | 📝 **ENREGISTRÉE** | Le libellé d'endpoint ne retire que la chaîne de requête, pas les identifiants de CHEMIN. **Pas une fuite aujourd'hui** (les quatre endpoints convertis sont des collections sans id de chemin) ; latente dès la première conversion par ressource. |
| 11 | 📝 **ENREGISTRÉE** | `zod` dans le graphe client d'`AssignmentsManager`. Les imports sont bien `import type`, donc ce n'est pas `PF-133` ; personne n'a mesuré la taille et cette passe ne le prétend pas. |

**Ce que la passe de land N'A PAS fait, dit franchement.** Aucune sonde vivante : Docker Desktop refuse de démarrer
pour le **sixième** run consécutif (sondé à ce run, pas hérité) et `pilotage@5432` est vide. Les magnitudes de
l'audit ne sont pas re-dérivées ; seuls les MÉCANISMES sont prouvés, dans un `node` nu et dans jest.

**La leçon durable de ce run, parce qu'elle se répète.** Pour le **quatrième run consécutif**, la tranche a rendu
`landed: true` **en nommant elle-même ce qui n'allait pas dans sa propre livraison** — et pour la quatrième fois,
ses notes valaient davantage que son diff. Deux de ses onze conditions (nº 8 et nº 9) décrivaient un cliquet qui
**punissait le travail qu'il séquence** : les corriger n'a rien changé au produit et a débloqué la tranche
suivante. Traiter le résultat du sprint comme une HYPOTHÈSE et la passe de land comme l'EXPÉRIENCE reste la bonne
lecture (`feedback_landed_is_not_ran`).

*(Écrit le 2026-08-28, run 95, passe de land.)*

---

## ~~Next slice → **lever les conditions de land de `S-E03-11`**~~ — **POINTEUR SUPERSÉDÉ au run 97 par un OVERRIDE opérateur** qui a désigné `S-E03-10b`, et **non sur le fond**. Les points 3, 4, 5 et 6 ci-dessous sont intacts et tiennent toujours. **Le pointeur vivant est à la FIN de ce fichier.**

**1. D'abord, et ce n'est pas une tranche : reconstruire `packages/contracts`.** Condition n° 1 ci-dessus. Tant
qu'elle n'est pas levée, la valeur de la tranche est **non prouvée** et quatre pages admin sont mortes au
chargement. Aucun vert de gate ne doit être lu comme une preuve du contraire.

**2. Puis `OPEN.md`, et c'est la seule chose qu'aucun gate ne rattrapera.** Conditions n° 2 et n° 3 : écrire
`PF-50` / `PF-427` en `in-progress — ADVANCED, NOT CLOSED` en nommant cette story et ses deux gates, puis créer
`PF-428`…`PF-433` **après** avoir tranché la divergence de numérotation sur le registre de la story. Sans ça, le
run suivant ré-implémente cette tranche.

**3. La tranche la moins chère qui prouve quelque chose : le test d'aller-retour fil.** Condition n° 4, plus les
deux assertions de charnière (`instanceof ApiError === false` + contrôle positif) et un contrôle positif sur les
quatre formes réelles copiées des `return` des contrôleurs. `/admin/students` est le seul lecteur converti **non**
enveloppé dans `safe()` : un scalaire faux y est un 500 immédiat, pas une carte dégradée.

**4. Candidate strictement contenue, et elle ferme un trou que cette tranche a laissé ouvert : `requiredKey()`
accepte `null`.** Condition n° 6, une ligne, et l'`isOptional()` reste `false`.

**5. La tranche suivante qui compte vraiment, et elle est sur une surface ENFANT : `PF-429`.**
`apps/web/src/lib/parent-children.ts:44` déclare `total?` **optionnel** côté portail parent alors que l'API l'envoie
toujours — une seconde liste écrite à la main sur la route `/students`, lue par le portail parent. Attention : la
convertir rougit l'interlock R1 (condition n° 9), qu'il faut donc corriger **dans la même tranche**.

**6. Puis l'`epic-spec`.** Il y a maintenant **dix** modules contractuels frères, et la dixième story a dû, comme
la huitième et la neuvième, **arbitrer son propre foyer dans son `§D1`**. Trois runs de suite. `PF-365` / `PF-370`
attendent depuis neuf runs.

**7. Chiffres de l'épic après treize tranches : 2 fermées sur 9 fermement** (`PF-15` sur un axe, `PF-20` entière),
**`PF-40` et `PF-36` revendiquées sous conditions** (runs 92 et 93), **`PF-50` avancée DEUX fois avec un résidu
nommé à chaque fois** (`PF-426` au run 94, `PF-427` au run 95 — et `PF-427` est elle-même avancée, non fermée).
Les quatre restantes : bloquées sur des **arbitrages sémantiques** (`PF-12` deux axes survivants, `PF-04`) ;
~~**jamais commencées** (`PF-24` — voir `ci/2026-08-26-v3-e03-snapshot-terminal-conflict` avant de démarrer —,
`PF-05`)~~.

> **Correction, run 97 (`S-E03-10b`, condition `§0` de la story).** *« `PF-24` jamais commencée »* était **faux au
> moment où cette ligne a été écrite** : `S-E03-10` avait livré au run 89 (`terminalCoalesceKey` /
> `canonicalCoalesceKey` dans `packages/contracts/src/dto/snapshot.ts`, les quatre sites de conflit du drain, sept
> cas de spec), et `OPEN.md:118` était à jour pendant que ce fichier ne l'était pas. `S-E03-10b` (run 97) l'avance
> une seconde fois. **`PF-24` reste `open`** et il ne lui reste **qu'une** condition : une preuve **EXÉCUTÉE contre
> Postgres** qu'un scope recalculé deux fois finit `done` deux fois et que `recomputing` redevient `false`. Docker
> est mort depuis sept runs ; tant qu'il l'est, cette condition n'est levable par aucune tranche. **`PF-05`, elle,
> n'est toujours pas commencée.**

---

## `S-E03-10b` — the terminal-key convention gets its retention bound, its ADR, and its status predicate back (run 97, 2026-08-29)

**Selected by operator designation**, not by the pointer above. The debt is `S-E03-10`'s own: that slice attached
`PF-380` to its merge as a **blocking** condition and then merged without it.

### What was actually wrong, measured in source on 2026-08-29

1. **`PF-380` — the constraint that was the bug was also the only bound.** Before run 89,
   `@@unique([tenantId, coalesceKey, status])` held terminal rows at one `done` + one `failed` per scope **for the
   lifetime of the table**. `S-E03-10` gave terminal rows a per-row key to let a second recompute complete — and
   removed the ceiling in the same stroke. The absence was re-measured this run, not inherited:
   `grep -rn "snapshotRecomputeTrigger.delete" --include=*.ts apps/ packages/` returns **exactly one** hit, and it is
   `requeueCanonical`'s redundant-row drop — a race case, not retention. `pruneOrphanSnapshots` deletes in the three
   snapshot tables and **never** in this one, so a hard-deleted pupil's scope ids survive there indefinitely,
   invisible to every erasure path. Not a leak and not an exploit: a **retention-limitation / minimisation** defect
   against `GUARDRAILS §1`, on rows that live **outside** `audit_log` governance.
2. **`PF-382` — `requeueCanonical` lost a predicate its callers carried.** The run-89 rewrite from `updateMany` to a
   per-row loop dropped the status filter both call sites had (`status: 'processing'` on the reclaim,
   `status: 'failed'` on the revive). A row that settled between its caller's `findMany` and this write was
   **resurrected** to `pending` with the canonical key restored — spurious work, and a `FreshnessChip` announcing a
   recompute that is not happening.
3. **`PF-383` — `lastError` survived success.** `settleTrigger(trigger, 'done')` passed `extra = {}`, so a row that
   failed, retried and then **succeeded** kept `(err as Error).message.slice(0, 500)`: raw Prisma text that can quote
   a pupil's name. Combined with (1), that is permanent retention of raw error text. `G-AUDIT`.
4. **`PF-386` — a cross-cutting key convention with no ADR.** `TERMINAL_COALESCE_SEPARATOR` lives in
   `packages/contracts` and is consumed by `apps/api` at enqueue and `apps/worker` at drain. `GUARDRAILS §2` makes
   that a blocking class; every sibling slice shipped one (`ADR-070`…`ADR-081`), this one had shipped a line of
   `OPEN.md`. The `schema.prisma` comment still asserted the invariant **without** the terminal exception and still
   claimed rows were *"routinely aged out"* — false until AC-1 landed.

### What landed

- **`sweepTerminalTriggers()`** (`snapshot-drain-cron.service.ts`): every `TERMINAL_SWEEP_EVERY_TICKS` (10) ticks,
  at most `TERMINAL_SWEEP_TAKE` (500) rows shared across tenants, `SNAPSHOT_TERMINAL_RETENTION_DAYS` (30) TTL.
  Per-tenant select **and** per-tenant `deleteMany`; the delete **re-asserts the whole predicate** rather than
  trusting ids, because `reviveFailedTriggers` can flip a selected `failed` row back to `pending` in the same tick.
  Sequenced **before** `tenantsWithPending()` on purpose: that is the one call in the tick not wrapped in `safe()`,
  so anything after it is skipped whenever the scan throws.
- **`positiveKnob()`** — the three new knobs clamp to their documented default instead of failing silently
  (`0` → a cutoff at `now`; non-numeric → `NaN` → `new Date(NaN)` → a Prisma throw `safe()` swallows).
- **`expectedStatus` on `requeueCanonical`**, at the three call sites the story names, each value **read at its call
  site** rather than inferred. It also guards the P2002 fallback `deleteMany`, previously the one write in this file
  able to remove the live `pending` row holding the canonical slot. `logger.debug` → `logger.warn`: work being
  discarded had zero signal on the surface an operator reads.
- **`settleTrigger(…, 'done', { lastError: null })`**; `attempts` deliberately NOT cleared (that is `PF-384`'s
  territory, `§7` record-don't-fix).
- **`ADR-083`** + the corrected `schema.prisma` `///` comment. Comment only: **no migration, no field, no index**,
  so `PF-80` is not armed and `restore-drill-baseline.json` gains nothing.
- **Twelve new jest cases** in `snapshot-trigger-conflict.spec.ts`, with real negative controls: a `pending`/
  `processing` row is never deleted however ancient (G-TRUTH), a `processedAt: null` row is never deleted, every
  `deleteMany` names one tenant and only ids selected under it (G-TENANT), the budget bounds the delete, a
  `RETENTION_DAYS` of 0 falls back to 30, and a `flipAfterFindMany` hook that **reports whether the race actually
  fired** rather than asserting into a vacuum.

### The two things this slice got right by MEASURING, and they are the transferable lesson

- **The three `expectedStatus` values were read, not assumed.** Symmetry would have been wrong.
- **The terminal settle was left unguarded — after measuring that the "obvious" symmetric fix is a regression.**
  A recompute outliving `STALE_PROCESSING_MIN` (15 min) has its row returned to `pending` by
  `reclaimStaleProcessing`; a status predicate on the terminal write would then settle **zero** rows, so `done` is
  never recorded, `status IN ('pending','processing')` stays true and `recomputing` pins **true forever** on the
  parent dashboard while the fan-out is redone every tick — and on the park path `attempts` would never persist, so
  `MAX_ATTEMPTS` becomes unreachable and the retry loop unbounded. The story's `§7` had fenced this off as
  record-don't-fix; an intermediate revision had guarded it anyway, and the fix pass **reverted** it. The unguarded
  terminal settle is now documented in the docblock and owed a finding row.

### Landing conditions — written so they are not re-discovered

1. **`PF-451`, and it is the one that matters: the sweep's FIRST statement is an unbounded, unindexed scan of
   exactly the population the sweep exists to bound.** `findMany({ where: { status: { in: TERMINAL_STATUSES } },
   select: { tenantId }, distinct: ['tenantId'] })` carries no `take` and no tenant key; `status` is not a leading
   column of either index and Postgres 15 (`ADR-014`) has no index skip scan; `nativeDistinct` is not enabled on
   `@prisma/client ^5.22`, so the `distinct` dedupes **after** the rows are materialised. On the aged table
   `ADR-083 §D2` explicitly plans for, that is a multi-second seq scan plus a large transient allocation every ~10
   minutes for the whole convergence period — to delete at most 500 rows. And it is wrapped in `safe()`, so it fails
   **silently**: retention stops, the table keeps growing, the next sweep is worse. The docblock claims the sweep
   "copies `pruneOrphanSnapshots`"; at the entry point it does not — the orphan prune derives its tenant set from a
   **`take`-bounded sample** and never issues an unbounded query. **The in-slice fix needs no migration**: one
   bounded candidate read (`{ status IN TERMINAL, processedAt < cutoff }, select: { id, tenantId }, take: TAKE`),
   grouped by `tenantId` in memory, one `deleteMany` per group — `G-TENANT` stays structural and the re-assertion
   survives. `ADR-083 §D5` currently concedes only that `processed_at` *"still filters in-heap"*, which understates
   a read that has no bound at all.
2. **Nothing exercises `tick()`.** All nine retention cases enter through
   `service as unknown as { sweepTerminalTriggers() }`. `grep` for `.tick(` across `apps/worker/src/**/*.spec.ts`
   finds only the two digest crons. So the suite stays green if the wiring `if` is deleted, moved below
   `tenantsWithPending()`, or gated by a cadence that never opens — and `SNAPSHOT_TERMINAL_SWEEP_EVERY_TICKS` is the
   one knob whose clamp is unmeasured, while `positiveKnob`'s own docblock names `tickCount % 0 === NaN` as a silent
   never-fires failure. `PF-380` is the P1 blocking condition of this slice and its remedy is currently asserted
   only in prose. That is `landed ≠ ran`, verbatim.
3. **`OPEN.md` is untouched, and two of its statements are now measurably false.** `PF-380`/`382`/`383`/`386` are
   still `open` against remedies that ARE in the diff; `PF-451`…`PF-456` live only in `ADR-083`'s front matter.
   Worse, `OPEN.md:190` asserts that `grade_published` / `grade_revised` scopes are **per student** — measured false
   at `grades.controller.ts:554-573` and `assessments.controller.ts`, which enqueue from the teaching assignment
   (class × subject × term) with **no `studentId`**; only the admin `manual_rebuild` can set one. The RGPD framing of
   `PF-380` survives, the growth model does not. And `OPEN.md:196` still points `PF-386` at `ADR-076`, taken by
   `S-E03-3d` at run 90. This is the `project_held_pr_causes_duplicate_work` shape and no gate catches it.
4. **`PF-385` is reproduced in new code without being recorded there.** `TERMINAL_SWEEP_TAKE` is ONE budget spent in
   tenant-enumeration order with no `orderBy`, so a tenant with a large over-TTL backlog consumes it every sweep and
   the tenants behind it are never swept. The story itself names *"son `take` est global, pas par tenant"* as a
   defect of `reclaimStaleProcessing` and rules the new method out of `PF-385`'s scope — then reproduces the
   property. Also `budget -= ids.length` charges **candidates**, not `removed.count`: harmless in direction
   (under-deletes) but the budget stops meaning what its name says, and a revive interleave can silently evaporate
   most of a pass. The docblock's *"It also cannot starve"* answers a different starvation and reads as a general
   claim.
5. **`ADR-083 §D2`'s justification for the 30-day default is mechanically wrong**, in the ADR and in the code
   docblock. *"A `failed` row that has survived 30 days has survived ~720 revive passes"* cannot happen:
   `requeueCanonical` stamps `processedAt: new Date()` on every requeue and the terminal settle stamps it again, so
   a revive **resets the clock the TTL reads**. A `failed` row with a 30-day-old `processedAt` is one
   `reviveFailedTriggers` has **never reached** — revive starvation, not a dead row. The default stays conservative
   (`orderBy: processedAt asc`, 100/tick, plus `backfillLaggingTenants` re-enqueuing anything that actually lags),
   so this is a **rationale** defect, not a safety one — but it is the only argument offered for the number and it
   should not stand in an ADR uncorrected. Its practical consequence: the sweep mostly reaps `done` rows, which are
   the genuinely unbounded class anyway.
6. **Terminal rows with `processedAt: null` are outside the sweep by construction.** `processedAt: { lt: cutoff }`
   excludes `NULL` by SQL three-valued logic — which test (4) correctly pins as REQUIRED — so any pre-`E6-S5` legacy
   row that settled without a claim stamp is retained forever. The schema comment claims the table is now bounded
   without naming the exception. **Documentation, not code**: do not add an `OR … null` clause. Measure the residue
   with a bounded `count()` before deciding anything.
7. **Accepted and declared, no action.** `getRecomputeStatus`'s `failed` count and `recent` feed change for tenants
   dormant longer than the TTL (`ADR-083 §D4`), verified against `snapshot-ops.service.ts:38-80`; **no `apps/web`
   file reads that endpoint**, so there is an API-visible change and no UI change. That reading was done in source,
   per `PF-388`'s lesson that a no-op ruling must be measured.
8. **Five hand-written status literals now partition a four-value enum across two apps.** The worker's new
   `TERMINAL_STATUSES = ['done','failed']` is the exact complement of four `['pending','processing']` literals
   (three in `apps/api`, one in the worker), with nothing linking them — the sweep's safety invariant is enforced by
   a literal that must stay the complement of literals in another application. Known paired-lists drift class; the
   natural home is `packages/contracts`, beside `snapshotCoalesceKey`, which both apps already import.

**What this pass did NOT do, said plainly.** No live probe, and none was possible: Docker down a **seventh**
consecutive run, `pilotage@5432` empty. Jest was **not executed** by the fix pass (resource budget); `pnpm typecheck`
is 13/13 exit 0 and `git diff --check` is clean both ways. `PF-24`'s one remaining condition — an executed proof
against Postgres — is therefore untouched, and is **not** claimed.

*(Written 2026-08-29, run 97, land pass. Later slices: annotate, do not delete.)*

---

## Next slice → **`S-E03-10c` — make the retention sweep's OWN read bounded, and PROVE the sweep is reached**

**1. First, and it is not a slice: `OPEN.md`.** Condition 3 above. Carry `PF-380`/`382`/`383`/`386` to `closed`
citing the diff lines, keep `PF-24` `open` with its one named condition, add `PF-451`…`PF-456`, **and correct the two
false statements** the `PF-380` row carries (per-student scopes; *"the existing index already supports it"*). File
the unguarded terminal settle as a new finding — `§7` of the story required it to be recorded, and it is documented
in code but nowhere in the matrix. Nothing later catches any of this.

**2. `PF-451` — the sweep's own enumeration.** Condition 1. It is the difference between a retention control and a
retention control that disables itself on the first aged table it meets. Fixable **in-slice, without a migration**,
by adopting the shape `pruneOrphanSnapshots` already uses; the composite `@@index([tenantId, status, processedAt])`
rides the first migration that touches this table and must **not** open one here.

**3. The `tick()` wiring test.** Condition 2. One case, existing harness, ~20 lines: seed one aged terminal row, make
`tenantsWithPending()` throw, drive `service.tick()` twice at `SNAPSHOT_TERMINAL_SWEEP_EVERY_TICKS=2`, assert the row
survives tick 1 and is gone after tick 2. Non-vacuous in both directions — a hardcoded always-run fails the first
assertion, a never-run fails the second — and it is the only assertion that can see the wiring line being moved.
Pair it with the same 9-then-10 shape at `EVERY_TICKS=0` through the existing `sweepWithEnv` isolate-modules helper,
which is the one clamp nothing measures.

**4. Then the two rationale corrections**, cheap and worth doing in the same pass: `§D2`'s revive-count argument
(condition 5) and the *"cannot starve"* sentence (condition 4).

**5. Then the `epic-spec`, now THIRTEEN slices late.** `docs/spec/features/v3-e03/` still has no `spec.md` and no
`tasks.md` (`PF-387`); `PF-365` / `PF-370` have waited ten runs. Eleven stories in a row have had to arbitrate their
own home in their own `§D1`.

**6. Epic figures after fourteen slices: 3 closed of 9 firmly** (`PF-15` on one axis, `PF-20` entire, `PF-40`
entire), `PF-36` claimed under conditions, **`PF-50` advanced twice with a named residual each time**, **`PF-24`
advanced twice and blocked on one thing only — a live Postgres**. Docker has been down for seven consecutive runs;
until it is up, `PF-24` is not closable by any slice, and saying so is cheaper than another run discovering it.
`PF-05` is still not started; `PF-12` (two surviving axes) and `PF-04` remain blocked on semantic rulings.

*(Same caveat as every pointer in this file: a recommendation, not an order of mission. An operator designation
outranks it — one did at run 97.)*


---

## `S-E03-2b` — une note de ZÉRO est une note, et `PF-339` est FALSIFIÉE par exécution (run 99, 2026-08-29)

**Findings :** `PF-05` *(avancée — un résidu sur trois levé)* · `PF-339` *(**falsifiée**)* · `PF-463`, `PF-464` *(relevées)*
**ADR :** `ADR-084` · **Palier de preuve : B** *(correction de forme, aucun changement de comportement sur les
données d'aujourd'hui — mais le cliquet est **obligatoire quand même**, parce que la fermeture est réclamée comme
CLASSE, pas comme quatre sites)*

### Ce qui a été tranché

Le registre portait `PF-339` en **P1** : *« `if (!g.value) continue` supprime une note légitime de ZÉRO de toutes
les surfaces adossées à A »*. **C'est faux, et ça l'a toujours été.** `Grade.value` est `Decimal?`, Prisma rend un
`Prisma.Decimal`, tout objet est vrai, donc `!Decimal(0)` vaut `false`.

Trois runs avaient **lu** cette ligne. Ce run l'a **exécutée**, parce que c'était le premier depuis huit runs avec
un Postgres vivant. `scripts/grade-zero-value-probe.js` → **`PROBE: PASS — 5/5`** contre
`database=pilotage server=172.18.0.10` (le conteneur ; `localhost:5432` est l'autre base, native Windows), sur
**420 notes réelles**, transaction **annulée** et 3/3 lignes vérifiées intactes après coup.

### Pourquoi le code a changé malgré la falsification

Le zéro survivait **par accident**, sur un invariant que rien n'énonçait — que la valeur atteint la boucle non
convertie — alors que **le même fichier fait déjà `Number(g.value)` aux lignes 834 et 1297**. C'est la forme
d'`ADR-068 §1.1`. Le fichier portait en outre **deux idiomes pour un seul test** : quatre sites `!g.value`, quatre
sites `g.value === null || g.value === undefined`. Les quatre fautifs adoptent le prédicat de leurs frères — la
règle du dossier d'accueil, pas un idiome de plus.

Trois des quatre sont dans **`parentDashboard`**, c'est-à-dire **la projection A elle-même**, celle dont `PF-05`
parle. Le quatrième porte le KPI `overall` de `/admin`.

### Le chiffre qui justifie le tier

Sur la fixture minimale — un **0** et un **20** :

| | vérité | avec `!g.value` sur une valeur numérisée |
|---|---|---|
| `sampleSize` | 2 | 1 |
| `successRate` | 50 % | **100 %** |
| `overall` | 50 % | **100 %** |

Le prédicat n'abîme pas le KPI, il l'**invente** — et il retire la seule note qui devrait faire *baisser* un taux
de réussite, des **deux** côtés de la fraction. `DNC-01`.

### Preuve, et son axe faible dit franchement

- **RED avant / GREEN après, exécuté dans les deux sens** sur la même commande : `8/8` vert sur l'arbre corrigé ;
  **`3 failed, 5 passed`** après restauration du prédicat d'origine dans le fichier de production réel — dont
  `overall` à `100` au lieu de `50`. *(Piège rappelé : `jest … | tail` rend le code de sortie de `tail`. Le
  verdict se lit dans la sortie, jamais dans `$?`.)*
- **Cliquet de classe** : scan de `apps/api/src` + `apps/worker/src`, corpus **dérivé** de `git ls-files`, sur du
  code **décommenté** (`PF-366` : sans ça il rougirait sur le commentaire qui cite la forme interdite). Trois
  contrôles de non-vacuité, dont le plus fort — **il rougit sur le fichier de production réel reconstitué
  d'avant la tranche** (≥ 4 occurrences).
- **Axe faible, nommé :** la moitié comportementale ne couvre que `schoolPerformance`, la plus petite des deux
  méthodes. Les **trois sites de `parentDashboard` sont couverts comme CLASSE par le cliquet, pas comme
  comportement.** Dit plutôt que laissé à supposer.

### Ce qui n'a PAS été fait

**Aucune reconstruction d'image** : disque hôte à **5,1 Go libres**, et sous ~5 Go un build casse la pile — une
pile cassée coûte plus cher qu'un rebuild non fait. La sonde tourne donc contre l'image en place via `docker cp` +
`docker exec` : elle exerce le client Prisma et le schéma, **pas** le code applicatif modifié. C'est précisément
pourquoi la moitié comportementale est portée par jest. La pile est laissée **debout et saine**, comme trouvée.

### Deux défauts relevés en passant, non corrigés (RULE 0 clause 6)

- **`PF-463`** — `schoolPerformance` accumule `sumOnTwenty` par cycle et **ne le rend jamais**. Soit une moyenne
  qui devait être exposée et dont l'appelant n'a jamais été câblé, soit du résidu. **Ne pas « corriger » en
  exposant le champ** : une moyenne que rien n'a jamais rendue n'a jamais été confrontée aux moyennes des autres
  portails, et c'est exactement `DNC-01`.
- **`PF-464`** — un résidu de `PF-05` a survécu **quatre runs** à la chose qu'il nommait : la ligne affirmait
  *« `AC-9` UNMET, la sonde n'existe pas »* pendant que la ligne `PF-343`, quatre rangs plus bas **dans le même
  fichier**, la portait `closed`, écrite et exécutée. Deux lignes d'un même fichier en désaccord sur un fait, et
  la périmée était sur **l'entrée de sélection**. Corrigé en ligne ; la dérive de classe est enregistrée.

### État de l'épique après quinze tranches

**4 fermées sur 9** (`PF-15` sur un axe, `PF-20`, `PF-40`, `PF-24`) — le seuil de la directive permanente est
atteint. `PF-05` reste `open` avec **deux** résidus au lieu de trois : la divergence de comptage A/B toujours non
démontrée sur la seed, et six projections toujours six. **Les deux appellent la même tranche : `S-E03-3`**,
l'unification réelle des deux requêtes. `PF-36` reste réclamée sous conditions, `PF-50` avancée deux fois avec un
résidu nommé, `PF-12` et `PF-04` bloquées sur des arbitrages sémantiques.

*(Écrit le 2026-08-29, run 99, passe de land. Tranches ultérieures : annoter, ne pas supprimer.)*

---

## Next slice → **`S-E03-3` — unifier les deux projections « les notes de cet enfant », et fermer `PF-05`**

Ce n'est plus un choix entre plusieurs candidats : **les deux résidus survivants de `PF-05` sont le même
travail.** La divergence A/B non démontrée et « six projections restent six » se lèvent ensemble, ou pas.

1. **La spec de convergence existe déjà et attend** — `parent-grade-projection-agreement.spec.ts` épingle la
   divergence **axe par axe** et dit explicitement que ses cas d'axe doivent être **RETIRÉS** quand `S-E03-3`
   atterrit, jamais « corrigés » en abaissant une assertion. C'est un plan de tranche déjà écrit.
2. **`AC-5` de `S-E03-2` avait pris sa branche STOP** : `published-grades.where.ts` n'a pu être adopté ni à A ni
   à B, donc il n'a été livré **nulle part**. Reprendre par là : le `where` canonique est le pivot.
3. **Démontrer la divergence de comptage sur la seed pendant que Docker est debout.** 420 notes réelles sont
   disponibles ; le compte A et le compte B pour un même enfant se mesurent en une sonde. **Ne pas hériter d'un
   « deferred — needs Docker » :** sonder au Step 1, l'état change d'un run à l'autre.
4. **Puis l'`epic-spec`, en retard de QUATORZE tranches** — `docs/spec/features/v3-e03/` n'a toujours ni
   `spec.md` ni `tasks.md` (`PF-387`), et `PF-365` / `PF-370` attendent depuis onze runs.

*(Comme tout pointeur de ce fichier : une recommandation, pas un ordre de mission. Une désignation opérateur la
surclasse.)*

---

## `S-E03-3` — les deux projections parent deviennent DEUX PORTÉES NOMMÉES, et le résidu (i) tombe par MESURE (run 102, 2026-08-29)

**Findings :** `PF-05` *(avancée — résidu (i) DÉCHARGÉ, résidu (ii) avancé ; **NON fermée**)* · `PF-471`, `PF-472` *(relevées)*
**ADR :** `ADR-086` · **Palier de preuve : B** *(refactor à sémantique constante sur deux sites ; pas de
cliquet, parce que la fermeture est réclamée comme DEUX SITES et non comme une CLASSE)*

### Ce que trois runs cherchaient, et pourquoi ils ne pouvaient pas le trouver

Le résidu (i) de `PF-05` — *« la divergence de comptage A/B est non démontrée sur la seed »* — a survécu
quatre runs. Il n'était pas en attente d'effort : **il est indémontrable.** La seed porte **420 notes pour
420 élèves distincts — exactement une note chacun**, **zéro** absence, **zéro** `draft`, et **une seule**
année scolaire pour la totalité des 2463 inscriptions et des 16 évaluations. Les quatre axes de divergence
sont **structurellement inexerçables**.

Et le zéro a été prouvé non vide : le **contrôle négatif** injecte une absence et une note d'une autre
année dans une transaction, re-mesure avec la même arithmétique, et **annule** — `b=3, a=1, axe_absence=1,
axe_année=1`, puis état vérifié identique après `ROLLBACK`. La sonde discrimine. Le zéro est un fait sur la
**seed**, pas sur l'instrument. C'est `PF-471`, et c'est un fait sur la capacité de preuve de **tout**
l'épique, pas sur cette tranche.

### La prémisse du run 81 était fausse, et c'est pour ça qu'`AC-5` avait calé

`AC-5` voulait UN `where` canonique pour les deux projections et a pris sa branche STOP — livré nulle
part. La raison : **les deux répondent à deux questions différentes.** A note (donc écarte les absences et
se fenêtre sur l'année) ; B relève (donc garde tout). Et B garde les absences **délibérément** :
`GradeRow.tsx:87` leur affiche un badge « Abs », `page.tsx:321` offre un filtre `performance === 'absent'`.
Converger aurait supprimé une fonctionnalité vivante. Le contrôle qui manquait était de **lire ce que la
page fait des lignes** avant de vouloir unifier la requête.

La tranche livre donc **deux portées nommées** plutôt qu'une fusion : `scoringWindowGradesWhere` et
`gradeRecordWhere`, dérivées d'une seule `PUBLISHED_GRADE_STATUSES`, adoptées **aux deux sites de
production**. La divergence devient **déclarée au lieu qu'accidentelle** — deux littéraux recopiés
pouvaient dériver en silence, c'était `DNC-01` dans sa forme la plus banale.

### La preuve, et son axe faible

`49/49` sur les deux specs, `188/188` en régression sur `modules/grades` + `modules/analytics`, typecheck
`13/13`. **Le contrôle qui compte :** une dérive d'UNE ligne (`where.isAbsent = false`) injectée dans le
contrat rend **6 tests rouges**, dont `parent-grade-projection-agreement.spec.ts` — qui capture les clauses
**depuis la production** en exécutant le vrai code. La spec voit donc bien le site, pas une copie.

**Axe faible, nommé :** aucun test d'intégration ne distingue A de B et aucun ne le peut (`PF-471`).
L'équivalence est prouvée au niveau du `where`, jamais au niveau d'une réponse HTTP.

### Relevé en passant, NON corrigé (RULE 0 clause 6)

**`PF-472`** — `teaching_assignment` est UNIQUE sur `(teacher_profile_id, class_section_id, subject_id)`
**sans** `academic_year_id`. Le même enseignant ne peut donc pas enseigner la même matière à la même classe
sur deux années : la continuité inter-années est **inexprimable**. Découvert parce que le contrôle négatif
n'arrivait pas à insérer sa propre fixture. C'est très probablement **la cause de `PF-471`** (la seed n'a
qu'une année parce que le schéma ne permet pas la seconde), et ça sape le fenêtrage par année sur lequel
l'épique est bâti. Le remède est une migration expand/contract — `G-MIGRATION`, sa propre tranche.

### État de l'épique après seize tranches

**4 fermées sur 9** (`PF-15` sur un axe, `PF-20`, `PF-40`, `PF-24`) — inchangé. `PF-05` reste `open` sur
**un** résidu au lieu de deux : « six projections restent six » (`PF-337`, `PF-338`). `PF-36` réclamée sous
conditions, `PF-50` avancée deux fois, `PF-12` et `PF-04` bloquées sur des arbitrages sémantiques.

## Next slice → **`PF-472`, puis l'`epic-spec`**

1. **`PF-472` d'abord**, parce qu'il débloque la preuve du reste : tant qu'une seconde année scolaire est
   inexprimable, `PF-471` ne se lève pas, et tant que `PF-471` tient, **aucune** revendication d'accord
   entre projections ne sera prouvable autrement que par des doubles jest. Migration expand/contract,
   rollback énoncé, entrée obligatoire dans `scripts/restore-drill-baseline.json`.
2. **Puis l'`epic-spec`, en retard de QUINZE tranches** — `docs/spec/features/v3-e03/` n'a toujours ni
   `spec.md` ni `tasks.md` (`PF-387`), et `PF-365` / `PF-370` attendent depuis douze runs.

*(Comme tout pointeur de ce fichier : une recommandation, pas un ordre de mission.)*

---

## `S-E03-13` — l'année d'une affectation se lit sur sa SECTION, et `PF-472` tombe par EXÉCUTION (run 103, 2026-08-29)

**Findings :** `PF-36`, `PF-04` *(avancées — **NON fermées**)* · `PF-472` **FALSIFIÉE** · `PF-473`, `PF-474` *(relevées)*
**ADR :** `ADR-087` · **Palier de preuve : B** *(conversion à sémantique constante sur huit sites,
mesurée identique avant bascule ; pas de cliquet, parce que la fermeture est réclamée comme HUIT SITES et
non comme une CLASSE)*

### Le pointeur du run 102 était faux, et c'est la mesure qui l'a dit

Le run 102 désignait `PF-472` comme la tranche débloquante : la clé d'unicité
`(teacher_profile_id, class_section_id, subject_id)`, sans `academic_year_id`, rendrait « la continuité
inter-années inexprimable ». **Contrôle exécuté contre le Postgres du conteneur, transaction annulée : les
deux insertions passent.** `ClassSection` est elle-même épinglée à une année
(`@@unique([academicYearId, gradeLevelId, name])`), donc « la même classe » sur deux années sont **deux
lignes**, deux `classSectionId`, et la clé ne les oppose jamais. Le run 102 avait réutilisé la MÊME section
au lieu de créer celle de l'année suivante : la collision qu'il a rencontrée était sa propre fixture.

Conséquence à ne pas hériter : **`PF-471` n'est pas causée par le schéma.** La seconde année est
exprimable ; la seed mono-année a une autre cause, encore inconnue.

### Ce que la même sonde a trouvé, et qui est le vrai défaut

`TeachingAssignment` porte **deux** axes d'année — sa colonne `academic_year_id` et celle de sa section —
et **aucune clé étrangère composite** ne les lie. La base **accepte** une ligne dont les deux se
contredisent (`INSERT 0 1`, puis `ROLLBACK`, dérive revenue à 0). `teaching-wall.where.ts` l'affirmait déjà
en prose depuis `ADR-063 §D1` ; personne ne l'avait exécuté.

Huit lectures de production filtraient sur l'axe COLONNE — dont
`teachers.controller.ts:434`, `GET /teachers/:id/load`, qui est **la VARIANTE C de l'audit, le « 43 » de
`PF-36`**. Elles dérivent désormais toutes l'année de la SECTION, par un prédicat nommé unique,
`assignmentYearScopeWhere`.

### L'ordre de la preuve, qui est le seul ordre honnête

**Mesurer d'abord.** Les deux axes ont été comptés par année sur la base du conteneur **avant** toute
conversion : 286 contre 286 affectations, 186 contre 186 enseignants distincts, delta **0** sur les quatre
années. La bascule est donc à sémantique constante sur les données réelles, et corrigée dès qu'une dérive
existerait.

`8/8` sur la spec neuve, `185/185` en régression sur `modules/teaching` + `modules/analytics`, typecheck
`10/10` projets. **Le contrôle qui compte :** une ligne remise à `academicYearId: activeAcademicYearId`
sur `teachers.controller.ts:434` rend ROUGE le test `GET /teachers/:id/load`, et lui seul — la spec exécute
les vrais contrôleurs et lit les `where` de la production, elle ne relit pas un littéral.

**Axe faible, nommé :** aucune assertion HTTP, pour la raison de `PF-471` — une seule année est peuplée,
donc aucun test d'intégration ne peut distinguer les deux axes sur les données livrées.

### Relevé en passant, NON corrigé (RULE 0 clause 6)

- **`PF-473`** — la clé étrangère composite absente. Faire converger les lectures retire la divergence des
  NOMBRES ; seule la contrainte retire celle des DONNÉES. `G-MIGRATION`, expand/contract, entrée obligatoire
  dans `scripts/restore-drill-baseline.json`. **`enrollment` porte la forme identique** et doit être tranché
  dans la même tranche.
- **`PF-474`** — ~15 lectures IMBRIQUÉES restent sur l'axe colonne (18 occurrences / 12 fichiers, dont 3
  specs), dans `analytics/`, `alerts/rules/` et `grades/`. Séquencer **après** `PF-473`, qui peut les rendre
  inutiles.

### État de l'épique après dix-sept tranches

**4 fermées sur 9** (`PF-15` sur un axe, `PF-20`, `PF-40`, `PF-24`) — inchangé. `PF-36` avancée une seconde
fois (un mécanisme de divergence retiré par construction, les comptes toujours pas re-mesurés). `PF-04`
avancée sur le substrat de son résidu (iii), pas sur (iii). `PF-05` inchangée, `PF-12` et `PF-50` inchangées.

## Next slice → **`PF-473`**, puis l'`epic-spec`

1. **`PF-473`** — la clé étrangère composite `(class_section_id, academic_year_id)` → `class_section(id,
   academic_year_id)`, qui exige d'abord `UNIQUE (id, academic_year_id)` sur `class_section`. Dérive
   actuelle **0** sur `teaching_assignment` ET `enrollment` : la contrainte est posable sans backfill, ce
   qui ne sera plus vrai indéfiniment. Trancher `enrollment` dans la même tranche.
2. **Puis l'`epic-spec`, en retard de SEIZE tranches** — `docs/spec/features/v3-e03/` n'a toujours ni
   `spec.md` ni `tasks.md` (`PF-387`), et `PF-365` / `PF-370` attendent depuis treize runs.

*(Comme tout pointeur de ce fichier : une recommandation, pas un ordre de mission.)*

### Addendum au land (run 103) — le gate a mesuré le MAUVAIS ARBRE, et c'est `PF-475`

La première passe de `scripts/ci-gate.sh` a rendu `GATE: FAIL (3 stage(s))` — `prisma generate`,
`typecheck`, `test:api (ratchet)`. **Aucun des trois ne porte sur ce diff.** Le reaper de verrou périmé a
fait `git checkout main` **pendant** la passe (`runs.log` : `18:42:49 reaped` → `18:42:55 salvaged` →
`18:44:21` un second run acquiert), si bien que le gate a typé un arbre d'où les fichiers neufs de la
tranche avaient disparu. L'empreinte est explicite : `error TS6053: File '…/assignment-year-axis.spec.ts'
not found` — un fichier **présent dans le commit testé**. `prisma generate` rejoué à la main ensuite :
**exit 0**.

**Ce run ne détient plus le verrou** (réquisitionné à 18:42). Il n'a donc **pas** relancé de passe de gate —
deux écrivains dans un même checkout est la seule condition d'arrêt inconditionnelle — et il n'a **pas**
appelé `release`, qui libérerait le verrou d'un AUTRE run.

**Preuve retenue à la place, toute exécutée sur la branche, arbre intact :** typecheck `10/10` projets,
build `@pilotage/api` exit 0, `prisma generate` exit 0, et **318 tests verts** — `8/8` (spec neuve, avec son
contrôle rouge discriminant), `185/185` (`modules/teaching` + `modules/analytics`), `125/125`
(`modules/alerts`, module adjacent au site `analytics.service.ts:2015`).

**Résidu énoncé :** aucune passe de gate PROPRE sur cette branche. L'étage `test:api (ratchet)` n'a pas été
rejoué après diagnostic, faute de verrou. C'est `PF-475`, et c'est la raison — pas une omission.

---

## `S-E03-14` — l'axe d'année ferme comme une CLASSE, et il est MESURÉ sur la pile qui tourne (run 104, 2026-08-29)

**Findings :** `PF-36` avancée (3ᵉ fois) · `PF-476`, `PF-477`, `PF-478` levées · `PF-63` constatée déjà close
**ADR :** `ADR-088` · **Palier de preuve :** B (+ cliquet, parce que la fermeture est revendiquée comme une CLASSE)

### Ce que la tranche corrige, en une phrase

`S-E03-13` (run 103) a converti huit lectures d'affectations vers l'axe SECTION et les a prouvées par huit tests
nommant chacun son endpoint. **Une neuvième existait** — `analytics.service.ts` / `teacherReports` /
`GET /analytics/teacher-reports` — et une suite qui énumère des sites **ne peut pas, par construction, échouer
sur le site qu'elle a omis**.

### Le défaut, observé et non déduit

Avec une affectation dont la colonne `academic_year_id` contredit celle de sa propre section — que la base
**accepte**, faute de clé étrangère composite (`PF-473`) — `/teachers/me/assignments` et
`/analytics/teacher-reports` renvoyaient **des ensembles de classes différents au même enseignant**. Deux
surfaces d'un même portail en désaccord sur « quelles classes j'enseigne cette année ».

### Ce qui a été EXÉCUTÉ

| Preuve | Résultat |
|---|---|
| Contrôle de divergence en base (`BEGIN … ROLLBACK`, conteneur) | cumul **58** vs distinct **57** après injection d'un élève bi-section ; 2463 inscriptions retrouvées après annulation |
| Mesure de la graine, quatre dérivations | **57 / 57 / 57 / 57** — la graine ne discrimine RIEN (`PF-478`) |
| Contrôle ROUGE du cliquet, contre la vraie source d'avant-correctif restaurée depuis l'index git | R1 nomme **exactement** `analytics.service.ts:4199 (findMany)`, rien d'autre |
| Contrôle ROUGE de la spec behavioural, même méthode | 1 échec sur 3, sur l'assertion d'axe |
| Cliquet, arbre corrigé | **13/13** |
| Spec behavioural, arbre corrigé | **3/3** |
| Recensement R2 (plafond forcé à 0, liste LUE) | **6** sites, nommés |
| Sonde HTTP live, jetons Keycloak réels | voir ci-dessous |

### Le fait le plus important de ce run, et il est désagréable

**L'image `pilotage-scolaire-api` qui répondait sur `localhost:4000` datait du 2026-08-25 — quatre jours AVANT la
fusion de `S-E03-13`** (2026-08-29 19:18), tout en affichant `Up 16 hours (healthy)`. *Healthy* est un signal de
vivacité et ne dit **rien** du commit qu'il y a dedans. La première passe de la sonde a rendu un résultat que ni
l'ancien ni le nouveau code n'expliquait ; la lecture honnête n'était pas « le code est faux » mais **« l'artefact
n'est pas le code »**, et cela n'a été attrapé que parce que la sonde portait un **contrôle POSITIF** dont l'échec
était lisible. Levé en `PF-476`. `landed: true` n'est pas `deployed: true`.

### Deux corrections apportées au registre lui-même

- **`PF-63` était déjà close** (run 91, `S-E03-6`) : la ligne `PF-36` l'a portée comme bloqueur pendant **treize
  runs**. « Fermer `PF-36` suppose de fermer `PF-63` d'abord » est périmé.
- **Le plafond R2 a d'abord été écrit à `14`**, chiffre repris de la prose de `PF-474` sans être confronté à
  l'arbre. Mesuré : **6**. Un plafond au-dessus de la population réelle aurait laissé passer huit récidives en
  silence. **Un plafond se mesure.**

### Ce qui n'est PAS fait, dit plutôt que glosé

- `PF-36` **reste `open`**. Les valeurs littérales 43/46/48 et 25/26 de l'audit ne sont **pas présentes dans la
  graine et ne peuvent pas l'être** (toutes les inscriptions sont `active`, aucun élève bi-section) ; fabriquer des
  données pour les faire réapparaître serait inventer la preuve.
- Les ~15 lectures **imbriquées** (`PF-474`) ne sont pas converties : ce sont des gardes d'appartenance, donc un
  rayon Tier A dans une tranche Tier B. Elles sont **comptées, jamais exemptées**.
- Le cliquet ne lit que les `where` de **premier niveau** — limite **déclarée à l'écriture**, `PF-477`.
- La clé étrangère composite (`PF-473`) n'est pas posée : la convergence retire la divergence des **nombres**,
  jamais celle des **données**.

### Passe de LAND — ce que la reconstruction a révélé, et la correction d'une phrase de cette page

**La sonde live est PASSÉE, sur une pile reconstruite et vérifiée.** Les deux surfaces rendent le même ensemble
de **deux** classes, **la ligne dérivée comprise** (`assignments=true reports=true`) — or un filtre d'axe COLONNE
*perdrait* cette ligne. Instrument bilatéral : `PASS` en mode accord, `FAIL (1)` en `--expect-divergence`, zéro
ligne de fixture restante dans les deux cas.

**⚠ Correction d'une phrase écrite plus haut dans ce fichier, et de `ADR-088 §2` :** l'état *divergent*
— axe section sur `/teachers/me/assignments` ET axe colonne sur `/analytics/teacher-reports` — **n'a jamais été
observé sur un artefact qui tourne.** Aucune image n'a été construite depuis cet état : il n'a existé dans `main`
qu'entre la fusion de `S-E03-13` et ce correctif. La première passe de sonde, contre l'image périmée, a vu les
**deux** surfaces sur l'axe colonne : elles s'accordaient, à la **mauvaise** valeur. La divergence est donc
établie par le **contrôle ROUGE unitaire**, pas par une observation live. Le dire autrement serait revendiquer
une preuve non produite.

**`PF-479` (P0) — découverte en reconstruisant, et prouvée par exécution.** L'image api neuve a REFUSÉ de
démarrer contre la base qu'un migrator « réussi » venait de quitter :

| Conteneur | Ce qu'il a dit | Sortie |
|---|---|---|
| `pilotage_migrator` (image d'avant le run 101) | « **7 migrations found** … No pending migrations to apply … migrations appliquées » | **0** — donc `service_completed_successfully` |
| `pilotage_api` (image construite ce run) | « Preflight migrations ÉCHEC : **8 livrées, 7 appliquées** » | refus de démarrer |

Migrator **reconstruit**, même commande, même base : « **8 migrations found** … Applying migration
`20260829120000_academic_year_one_active_per_school` … All migrations have been successfully applied. » Le
diagnostic est donc confirmé **par exécution** et non par lecture : la seule variable changée est l'âge de
l'image. La migration du run 101 n'avait **jamais** été appliquée à la base locale — `landed` n'est pas
`applied`.

**Ce qui a rendu la dérive visible** est `assertMigrationsClean` (`migration-preflight.ts:54`) : le refus de
démarrer de l'API. Sans lui, l'API aurait tourné sur un schéma incomplet et toute sonde l'aurait cru sain.

### État de la pile laissé derrière ce run

`api` **healthy** sur l'image `462d0019b3b5` (construite ce run), `migrator` reconstruit et sorti en succès avec
les 8 migrations appliquées, les dix autres conteneurs inchangés et sains. La base porte **2463** inscriptions,
inchangées : la fixture de la sonde a été retirée et le compte re-vérifié à **0** ligne résiduelle.

### Verdict du gate

`bash scripts/ci-gate.sh` (rapide, sans drapeau) → **`GATE: PASS (fast)`**, 822 s, **11 étages verts**, 2 sautés
(`schema drift` et `rls isolation`, aucun changement prisma). Lu sur la **DERNIÈRE** ligne `GATE:` (1395) : la
ligne 84 porte un `GATE: PASS` nu qui est le leurre de `PF-325`.
