# Sprint 01 stories — release safety and hygiene

**Sprint goal.** Make releases reversible and stop the product advertising that it is a demo. These two epics
(`V3-E02`, `V3-E06`) are the only L0 work with **no upstream dependency**, so they are what the routine can start on
day one.

**Story contract.** Each story is sized for one autonomous run and carries enough context that an agent can implement it
without re-reading the four audit reports. Fields: `id`, `epic`, `finding`, `gates`, `dnc`, `blockedBy`,
`requiresDecision` / `requiresCredential` / `requiresLegalReview`, `preconditions`, `implementation notes`,
`acceptance criteria`, `test`, `out of scope`.

---

## S-E02-0 — Land the V3 substrate on `main` · `closed` 2026-08-02

| | |
|---|---|
| **Epic** | V3-E02 · **Finding** PF-58 · **Gates** G-DNC |
| **blockedBy** | — · **requiresDecision** — · **Size** S · **docsOnly** |

**Why.** The four audits, the 17 planning documents and the 40 evidence files were authored only as *untracked* files
inside the disposable worktree `.claude/worktrees/youthful-chaum-6aad5c`. None of it was ever committed, so `main` had
none of it. Routine Step 1 reads five files that did not exist — **V3 could not perform a single run.** The in-repo
`routine/` copies had also drifted behind the installed `SKILL.md`.

**Acceptance criteria.**
1. The four audits are tracked at the repo root.
2. `docs/daily-improvement-v3/` is tracked in full (17 files).
3. `audit-evidence/` is tracked in full (40 files, including the screenshots the audits cite).
4. `routine/daily-improvement-v3.md` and `routine/routine-lock.sh` are **byte-identical** to the installed artefacts
   under `~/.claude/scheduled-tasks/daily-improvement-v3/`, so drift is detectable with `diff`.
5. Every one of routine Step 1's six reads resolves against `main`.

**Test.** None — `docsOnly`, no executable surface. Evidence is the tracked file set plus a clean `diff` against the
installed routine.

**Out of scope.** Any product change. This story only makes the routine runnable.

---

## S-E02-1 — Baseline migration from the hosted schema, and stop `db push`

| | |
|---|---|
| **Epic** | V3-E02 · **Finding** PF-03, VAL-10 · **Gates** G-MIGRATION |
| **blockedBy** | — · **requiresDecision** — · **Size** M |

**Why.** Production startup runs `prisma db push --accept-data-loss` against a database with **no migration history**.
No one can prove which schema transition produced the hosted database, or roll one back. This is the single change that
makes every later schema fix survivable.

**Preconditions to verify first (Step 2 of the routine).**
- Confirm the compose/migrator still invokes `db push --accept-data-loss`.
- Confirm `prisma/migrations/` is absent or empty.
- Capture the **hosted** schema (not `schema.prisma`) — they are known to differ; A2 App. C.4 records the hosted
  database as pre-E11 while the source is newer.

**Implementation notes.**
1. Introspect the **hosted** database and generate a baseline migration that reproduces it exactly.
2. Mark the baseline as already-applied on the hosted database (`migrate resolve --applied`), so no destructive
   replay occurs.
3. Replace `db push` in every non-development profile with `migrate deploy`.
4. Add a startup preflight that fails loudly if `migrate status` is not clean.
5. Leave `schema.prisma` alone in this story — reconciling source-vs-hosted drift is `S-E02-5`.

**Acceptance criteria.**
1. `prisma migrate status` reports clean against the hosted database.
2. No non-development code path invokes `db push`.
3. A deploy with a pending, unapplied migration **fails preflight** rather than mutating the schema.
4. The baseline migration file is committed and reviewable.
5. The running schema version is reported by a health/manifest field (VAL-10).

**Test.** Restore a snapshot into a scratch database; apply the baseline; assert schema equality with the source
snapshot. Negative: introduce a pending migration and assert the preflight blocks.

**Out of scope.** Any schema *change*. This story only establishes the ledger.

---

## S-E02-2 — Make CI actually run (clean install, generate, gate)

| | |
|---|---|
| **Epic** | V3-E02 · **Finding** PF-55, VAL-01 · **Gates** — |
| **blockedBy** | — · **Size** M |

**Why.** 50 spec files exist (32 API, 12 worker, 6 web/Playwright) but **none could be executed** in the audited
worktree: Jest absent, API typecheck cannot resolve Jest types, worker cannot resolve a workspace tsconfig, web cannot
resolve Next/React/generated `.next` route types. Their presence is therefore not evidence of passing.

**Implementation notes.**
1. CI job: clean lockfile install → `prisma generate` → `next build`-time type generation → lint → typecheck → unit →
   integration → Playwright → axe.
2. Fix the workspace/tsconfig resolution errors the audit named, rather than skipping those packages.
3. Gate merges on the result. Report per-suite pass counts in the PR.
4. Do **not** silence failing tests to make the gate green — a genuinely failing suite is a finding; record it.

**Acceptance criteria.**
1. CI runs all six stages from a clean install and fails the build on any failure.
2. Every currently-existing spec file is either executed or explicitly listed as skipped **with a reason and a finding
   id**.
3. Local `pnpm typecheck` succeeds in each app.
4. The routine's Step 4 build result and the CI result agree.

**Test.** The CI run itself is the evidence. Add a deliberately failing test on a branch to prove the gate blocks.

**Out of scope.** Writing new tests for uncovered domains (that belongs to each domain's epic).

---

## S-E02-3 — Timed backup → restore rehearsal

| | |
|---|---|
| **Epic** | V3-E02 · **Finding** VAL-03 · **Gates** G-MIGRATION |
| **blockedBy** | S-E02-1 · **requiresDecision** **D-01** · **Size** S |

> **STOP condition.** D-01 (backup/restore window) is unresolved. The routine must **not** start this story; it should
> report that D-01 blocks it and select the next eligible story.

**Why.** Risk R-01: the first tenancy migration is an unrecoverable bet without a proven restore.

**Acceptance criteria.** A restore into a scratch stack completes, is timed, and the restored data is verified against a
checksum/row-count manifest · the duration is recorded as a baseline SLO · sign-off is captured in `open-decisions.md`.

---

## S-E02-4 — Seed cannot run in production; demo tenant becomes explicit

| | |
|---|---|
| **Epic** | V3-E02 · **Finding** PF-03 (seed half), R-12 · **Gates** G-MIGRATION |
| **blockedBy** | S-E02-1 · **Size** S |

**Why.** Production compose deliberately runs demo seed logic outside `NODE_ENV=production`, and the hosted deployment
visibly contains seed records and internal author labels (A2 §12; PF-17).

**Implementation notes.** Seed becomes a separately-invoked command that **refuses to run** unless an explicit
`ALLOW_SEED` flag and a non-production profile are both present. Keep a deliberately-labelled demo tenant provisionable
on demand (R-12: stakeholders rely on the demo — do not simply delete it).

**Acceptance criteria.** An attempted seed under the production profile **refuses and exits non-zero** · the hosted
demo remains reproducible via the explicit command · no seed author label is reachable from a production build.

**Test.** Invoke seed with the production profile and assert refusal.

---

## S-E06-1 — Purge development artefacts from production builds

| | |
|---|---|
| **Epic** | V3-E06 · **Finding** PF-17, PF-54 · **Gates** G-AUTHZ |
| **blockedBy** | — · **Size** S |

**Why.** Hosted admin and teacher registration pages ship **Maildev `localhost` instructions**; hard-coded credential
fallbacks and development URLs ship in production-facing code.

**Implementation notes.** Remove the dev-only copy from the registration surfaces; move any fallback credential to
required configuration that fails fast when absent; add a **CI string scan** over the production bundle for
`localhost`, `maildev`, seed author labels and known dev URLs.

**Acceptance criteria.** None of the scanned strings appears in a production build · the scan runs in CI and fails the
build on a hit · absent required configuration fails fast at startup with a clear message rather than falling back.

**Test.** CI scan (evidence) + a startup test asserting fail-fast on missing config.

**Out of scope.** CSP (that is `S-E06-2`).

---

## S-E06-2 — Enable CSP and sanitise branding injection

| | |
|---|---|
| **Epic** | V3-E06 · **Finding** PF-45 · **Gates** G-AUTHZ |
| **blockedBy** | — · **Size** M |

**Why.** Helmet is enabled but its **content security policy is explicitly disabled**, and tenant-controlled branding
values are injected unvalidated into a server-rendered `<style>` block — a stored CSS-injection path in a multi-tenant
product.

**Implementation notes.** Validate/whitelist branding values (colour formats, lengths, no `}` or `<`) at write time
*and* escape at render time; adopt a nonce- or hash-based CSP; roll out report-only first, review violations, then
enforce.

**Acceptance criteria.** CSP header present and enforcing · a branding value containing CSS/HTML control characters is
rejected at write and neutralised at render · no console CSP violation on any of the four portals' main journeys.

**Test.** Injection fixture (`}` + `<script>` + `expression(`) asserted rejected and escaped; CSP header assertion per
portal; report-only violation log reviewed before enforcing.

---

## S-E06-3 — Fix `/admin/classes/new` and add a route/link crawl gate

| | |
|---|---|
| **Epic** | V3-E06 · **Finding** PF-19, PF-39 · **Gates** — |
| **blockedBy** | — · **Size** M |

**Why.** `/admin/classes/new` is linked prominently from the classes page and **crashes**, because it falls through to
the `[id]` dynamic route. The same class of defect produces teacher/parent profile 404s and a teacher class-messaging
404. Navigation quality is not currently a build invariant.

**Implementation notes.** Implement the create route as a real page (or change the link to the correct affordance);
then add an **authenticated link crawl per role** to CI that asserts zero internal 404s and zero error boundaries. This
gate is what stops the class of defect, not the single fix.

**Acceptance criteria.** `/admin/classes/new` renders a working create form · the crawl runs for admin, teacher, parent
and student · the crawl fails CI on any internal 404 or error boundary · every currently-known dead link is either fixed
or removed from navigation.

**Test.** The crawl itself; plus an E2E creating a class through the new route and asserting it appears in the list.

---

## S-E06-4 — Legal, help and contact routes exist before consent is requested

| | |
|---|---|
| **Epic** | V3-E06 · **Finding** PF-38 · **Gates** — |
| **blockedBy** | — · **requiresDecision** **D-08** · **Size** S |

> **Partial STOP.** The routine may ship **holding pages**; it may **not author policy text** (risk R-13). If D-08 is
> unresolved, implement the holding pages and leave the content task open.

**Why.** `/legal/privacy`, `/legal/terms`, `/legal/cookies`, `/pricing`, `/contact` and `/help` all return **404 while
parent registration requires accepting the terms and privacy policy**. That is a live consent problem, not cosmetics.

**Acceptance criteria.** Every route referenced by a consent checkbox resolves · the holding page states the policy is
being finalised and gives a contact route · registration links resolve to the correct locale · no invented policy text.

---

## S-E06-6 — Confirmation and explicit scope for bulk/irreversible controls

| | |
|---|---|
| **Epic** | V3-E06 · **Finding** PF-29 · **Gates** G-AUDIT |
| **blockedBy** | — · **Size** S |

**Why.** The calendar "import French holidays" control executed **immediately, with no confirmation**, during the audit
itself — writing 22 rows into the stale active academic year. The audit's own residue disclosure records it. Any control
that writes in bulk must state its scope and ask.

**Implementation notes.** Confirmation dialog naming the exact target (year, count, scope); explicit year selection
rather than implicit active-year; idempotency so a second import does not duplicate; an audit row for the bulk write.

**Acceptance criteria.** No bulk-write control fires without an explicit confirmation naming its scope · the target year
is chosen, not assumed · re-running produces no duplicates · the action writes an audit row with actor and count.

**Test.** Click-without-confirm asserted to write nothing; double-import asserted idempotent; audit row asserted.

---

## Sprint 01 exit criteria

- `prisma migrate status` clean; no `db push` outside development; preflight blocks unapplied migrations.
- CI runs six stages from a clean install and gates merges.
- No dev artefact, hard-coded credential or dev URL in a production build (CI-enforced).
- CSP enforcing; branding injection neutralised.
- Zero internal 404s on an authenticated per-role crawl (CI-enforced).
- Consent-referenced routes resolve.
- Bulk controls confirm, scope and audit.
- `traceability-matrix.md` updated for every finding touched; D-01 and D-08 escalated if still open.
