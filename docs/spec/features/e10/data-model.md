# E10 — Data model & migration plan (Architect: Winston)

> Authoritative data record for **E10 — Quality bar: authenticated E2E (R10) + WCAG 2.2 AA (R9)**.
>
> **Headline ruling: E10 changes NO production Prisma schema.** It is a *quality / test-harness*
> epic, not a feature epic. There is **zero new model, zero new column, zero new enum value, zero
> migration, zero `prisma db push`** in any slice. The "data model" of E10 is the **test-fixture
> data model**: (1) which already-seeded demo entities the authenticated journeys assert against,
> (2) the per-portal **authenticated-session artifacts** (Playwright `storageState`) the fixtures
> produce, and (3) the **a11y / E2E result artifacts** the run emits. The one genuine *architectural*
> decision — adding a test-runner + CI E2E/a11y layer to the toolchain — is captured in
> **`docs/adr/ADR-023-authenticated-e2e-and-a11y-layer.md`** (authored on the **S1** run), not in `schema.prisma`.
>
> Companion files: [`spec.md`](./spec.md) · [`plan.md`](./plan.md) · [`contracts/`](./contracts) ·
> [`ux.md`](./ux.md) · [`tasks.md`](./tasks.md) · [`quickstart.md`](./quickstart.md) ·
> [`PROGRESS.md`](./PROGRESS.md).

---

## 0. Why E10 has no Prisma delta (the load-bearing invariant)

E10 hardens the **already-shipped** surface of E1–E9. It must not change behaviour, so it must not
change data. Verified against the live tree:

| Asset E10 leans on | Where (verified) | E10 role | Touched? |
|---|---|---|---|
| Playwright runner | `apps/web/playwright.config.ts` | the E2E + a11y runner — **already present** (R0 baseline) | extended, **not** added |
| `@axe-core/playwright` ^4.11 | `apps/web/package.json` (devDep) | the WCAG scanner — **already a dependency** | reused |
| `@playwright/test` ^1.60 | `apps/web/package.json` (devDep) | test framework | reused |
| Smoke + a11y spot-check | `apps/web/tests/e2e/smoke.spec.ts` | the **unauthenticated** baseline (3 login pages, `@smoke`/`@a11y`) | extended with the **authenticated** layer |
| NextAuth Credentials → Keycloak ROPC | `apps/web/src/auth.ts` (`directGrantLogin`, `credentialsProvider`) | how a fixture logs in (POST `{email,password,portal}` → session cookie) | **driven**, not changed |
| Demo tenant `voltaire-demo` + journeys' data | `apps/api/prisma/seed-demo*.ts` | the **fixture corpus** the journeys assert against | **read-only**; never mutated destructively |
| Demo credentials | project-context §6 | the login identities the fixtures use | reused as-is |

**No model in `apps/api/prisma/schema.prisma` is created, altered, or dropped by any E10 slice.**
A reviewer who finds a `db push`, a new `model`, a new `enum` value, or a `migrations/` SQL file in an
E10 PR should treat it as **out of scope / a blocking finding** — E10 is allowed to add *test files,
fixture code, config, scripts, a CI workflow, and one ADR* only.

---

## 1. The fixture data model (what authenticated tests need, not what they create)

The journeys are **read-mostly assertions over the demo seed**, plus a small set of **idempotent,
self-undoing writes** through the real product API (never raw SQL, never schema). The "data model"
here is the contract between the seed and the tests: the minimal set of demo entities each journey
must be able to find, by **stable, semantic locators** (role/label/text), not by hard-coded UUIDs.

### 1.1 Identities (the authenticated actors)

E10 reuses the project's existing demo logins (project-context §6) — **no new user is seeded**:

| Portal | Identity (env-overridable) | Realm role | Used by journey |
|---|---|---|---|
| `admin` | `mme.dupont@voltaire.fr` / `Demo!2024Pilotage` (full `voltaire-demo`) | `school_admin` | J3 (child-claim approval), a11y sweep |
| `teacher` | `teacher@pilotage.local` / `Changeme123!` (or a `voltaire-demo` teacher) | `teacher` | J1 (grade publish), J2 (messaging), a11y sweep |
| `parent` | `parent@pilotage.local` / `Changeme123!` (or a `voltaire-demo` guardian) | `parent` | J1 (alert), J2 (messaging), J3 (claim), a11y sweep |
| `student` | demo student (if the `student` realm-role/user is activated) | `student` | a11y sweep only (later slice; deferred if the role is not yet activated in `realm-export.json`) |

> **Resolution rule (locked).** Credentials are read from env first
> (`E2E_<PORTAL>_EMAIL` / `E2E_<PORTAL>_PASSWORD`), falling back to the simple per-portal
> `*@pilotage.local` / `Changeme123!` set, then to the rich `voltaire-demo` admin. A journey that
> needs the *rich* `voltaire-demo` graph (J1 grade→alert→class-context) MUST use a `voltaire-demo`
> teacher + the guardian of a `voltaire-demo` student; the simple `*.local` users back the smoke/a11y
> layer where data depth is irrelevant. The exact mapping lives in `tests/e2e/fixtures/users.ts`
> (S1), keyed off the seed so it self-documents.

### 1.2 The authenticated-session artifact (`storageState`) — the visionary reusable fixture

The core deliverable. Each portal gets **one Playwright `storageState` JSON** — the serialized
browser context (the `next-auth.session-token` / `authjs.session-token` cookie produced by a real
ROPC login through the product's own login form) — created **once per run** by a setup project and
**reused** by every authenticated test as `test.use({ storageState })`. This is the
"one-line end-to-end journey test" spine the visionary idea names.

```
tests/e2e/
  fixtures/
    users.ts               # PortalUser map (env-overridable; section 1.1)
    auth.setup.ts          # setup project: log each portal in once -> write storageState
    portal-fixtures.ts     # test.extend: adminPage / teacherPage / parentPage / studentPage
  .auth/                   # gitignored; storageState JSON written by auth.setup.ts (NOT committed)
    admin.json  teacher.json  parent.json  student.json
  journeys/
    grade-publish-to-parent-alert.spec.ts     # J1 (S1)
    parent-child-claim.spec.ts                # J3 (later slice)
    parent-teacher-messaging.spec.ts          # J2 (later slice)
  a11y/
    authenticated-a11y.spec.ts                # cross-portal axe-core AA sweep (later slice)
  smoke.spec.ts            # existing unauthenticated baseline (unchanged)
```

**`storageState` is a runtime artifact, not source.** It contains a live session token, so it is:
- **gitignored** (`tests/e2e/.auth/` added to `.gitignore`) — never committed (it would be a secret +
  it expires);
- **regenerated every run** by the `setup` project, which runs **before** all other projects via
  Playwright `dependencies`;
- **per-portal**, so a test never has to know how login works — it declares the portal it needs and
  inherits an authenticated page.

```ts
// shape produced by auth.setup.ts (Playwright StorageState — illustrative, not a DB type)
type PortalStorageState = {
  cookies: Array<{ name: string; value: string; domain: string; path: string;
                   expires: number; httpOnly: boolean; secure: boolean; sameSite: 'Lax'|'Strict'|'None' }>;
  origins: Array<{ origin: string; localStorage: Array<{ name: string; value: string }> }>;
};
```

The login path the setup uses is the **product's real `/api/v1`-adjacent NextAuth credentials flow**
(POST to the NextAuth credentials endpoint with `{ email, password, portal }`, the same call
`apps/web/src/auth.ts:credentialsProvider` handles) — so the fixture exercises the genuine auth
stack (Keycloak ROPC) end-to-end, never a mock. See `contracts/auth-fixture.contract.md`.

### 1.3 Journey fixture corpora (semantic, not UUID-bound)

Each journey depends on a **shape** of demo data, asserted via accessible locators so a reseed with
different UUIDs/names does not break the test. The required shapes (the "fixture data model"):

| Journey | Required demo shape (read) | Idempotent write (if any) | Cleanup |
|---|---|---|---|
| **J1 — grade publish → parent explainable alert** (S1) | a `voltaire-demo` teacher owning >=1 class+subject with >=1 enrolled student who has a guardian login; an assessment to grade | teacher **publishes a grade** that crosses an alert threshold (e.g. a low mark feeding `LOW_SUBJECT_AVG`) via the real gradebook UI | none required (publishing a grade is the demoable act; the alert is read on the parent side). A teardown helper MAY revise/delete the test grade, but the journey is designed to be **re-runnable without cleanup** (grade publish is idempotent-ish per assessment) |
| **J2 — parent ↔ teacher messaging** (later) | the same parent↔teacher↔student triad satisfying the E2 dual-wall (guardianship ∩ teaching-assignment) | parent **opens/sends a message**; teacher **replies** (real E2 endpoints) | append-only by design; messages accumulate harmlessly. Test asserts its own just-sent message text (unique per run via a timestamp/nonce) |
| **J3 — parent child-claim → admin approval** (later) | an *unclaimed* `voltaire-demo` student whose name+DOB the parent can submit; the admin queue | parent **submits a claim** (E9 `POST /parent/child-claims`); admin **approves** it (E9 admin verb) | the claim/guardianship is real state. To stay re-runnable, J3 uses a **dedicated throwaway claimant** or **withdraws/rejects** at teardown, OR asserts only the *queue appearance + approve transition* on a fresh nonce-named claim. The exact strategy is pinned in the J3 slice's story spec |

> **Determinism rule.** Every authenticated assertion targets **role/label/text** locators
> (`getByRole`, `getByLabel`, `getByText`) — the project's `@pilotage/ui` is accessible by mandate
> (ADR-016 / WCAG-AA), so semantic locators are stable and *also* exercise a11y. **No
> `data-testid` proliferation, no UUID literals, no XPath.** A test that cannot find a stable
> accessible locator is surfacing a real a11y gap (feed it back to the R9 sweep).

### 1.4 A11y scan scope (the WCAG 2.2 AA data the sweep produces)

The a11y layer produces **violation reports**, not persisted data. Scope grows by slice:

- **S1 (smoke a11y):** the existing 3 login pages (already covered) **plus** one authenticated
  landing per available portal (admin dashboard, teacher dashboard, parent dashboard) — a *spot
  check*, asserting **zero `critical`/`serious`** axe violations under tags
  `['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']`.
- **Later slice (full sweep):** an enumerated route list per portal (the high-traffic authenticated
  pages: dashboards, recommendations/alerts, messages, settings, the admin queues), each scanned;
  AA violations remediated in `apps/web` / `packages/ui` until the suite is green. WCAG 2.2-specific
  success criteria explicitly in scope: **2.4.11 Focus Not Obscured**, **2.5.7 Dragging Movements**,
  **2.5.8 Target Size (Minimum, 24x24)** — the three new AA SCs in 2.2.

The axe tag set is the only "schema-like" knob and lives in a shared helper
(`tests/e2e/a11y/axe.ts`) so every scan uses the same WCAG 2.2 AA baseline (see
`contracts/a11y-scan.contract.md`).

---

## 2. Migration plan

**There is no database migration in E10 — any slice, ever.**

| Slice | Schema change | `db push` | New model/enum/column | Migration SQL |
|---|---|---|---|---|
| S1 (Playwright auth fixtures + J1 + smoke a11y + ADR-023) | **none** | **no** | **none** | **none** |
| Later (child-claim + messaging journeys) | **none** | **no** | **none** | **none** |
| Later (cross-portal axe AA sweep + remediation) | **none** | **no** | **none** | **none** |

What *does* change, by layer (for the dev agents, not the DBA):

- **`apps/web` (test harness, the bulk):** new files under `tests/e2e/` (section 1.2 tree);
  `playwright.config.ts` gains a `setup` project + `dependencies` + authenticated projects;
  `package.json` gains scripts (`test:e2e:auth`, `test:e2e:a11y`, `test:e2e:ci`). **No app source
  change in S1**; later a11y slices edit `apps/web` page/component markup + possibly `packages/ui`
  to fix AA violations.
- **`.gitignore`:** add `apps/web/tests/e2e/.auth/` and the Playwright report/output dirs.
- **CI (the new architectural layer → ADR-023):** a CI workflow (or the lock-holder's documented manual
  step) that boots the stack, runs `auth.setup`, then the authenticated E2E + a11y projects. **The
  routine itself never runs Playwright** (project-context §4 — the heavy gate is Murat's single
  `pnpm typecheck`; E2E is a CI/operator concern, exactly the ADR-023 boundary).

**Operator / infra note (gates demoability, not merge).** The authenticated journeys require a
**running stack** (web `:3100` + api `:4000` + Keycloak + a seeded `voltaire-demo`) and, for the
student a11y scan, the **`student` realm-role + demo user activated** in
`infra/keycloak/realm-export.json` (the E8 pending operator step). When the stack is not running,
the authenticated suite is **skipped, not failed** (a `test.skip` guard probing reachability), so the
PR's typecheck/build gate stays green and the suite never becomes a flaky blocker. This skip-when-down
posture is the data-model's only "fall-through" and mirrors the E6 snapshot "a miss is never an error"
discipline.

---

## 3. Tenant, RGPD & audit posture (a quality epic still obeys the guardrails)

- **Tenant isolation:** every authenticated fixture logs in as a real `voltaire-demo` user, so every
  read/write the journey makes is already `tenant_id`-scoped by the product's own RLS/ABAC
  (ADR-002/015) — the tests **assert** isolation (e.g. a parent never sees another child) rather than
  bypassing it. **No test ever opens a raw DB connection or crosses a tenant.**
- **No real PII in artifacts:** `storageState` holds a session token (a secret, hence gitignored), not
  PII. Screenshots/videos are `only-on-failure`/`retain-on-failure` (existing config) and contain only
  **demo** (`voltaire-demo`) data — never production data. Trace/report dirs are gitignored.
- **Append-only audit unchanged:** journeys that write (publish a grade, send a message, submit/approve
  a claim) go through the product API, so the existing append-only `AuditLog` rows are written by the
  real code path — E10 adds no audit and removes none.
- **Deny-by-default still holds:** J3 relies on the E9 non-enumerating matcher; the test asserts the
  *uniform* parent response (no leak), turning the security invariant into a regression check.

---

## 4. The one new architectural decision → ADR-023 (data-model's ADR tripwire)

Adding a **test-runner + CI E2E/a11y layer** that (a) performs **real authenticated logins** to mint
reusable per-portal sessions, (b) drives **cross-cutting end-to-end journeys** through the live stack,
and (c) gates on **automated WCAG 2.2 AA** scans is a **new cross-cutting pattern** (a new quality
gate + a new CI stage + a new "fixtures log in for real" convention). Per project-context §3 it must
land **with a new ADR**: **`docs/adr/ADR-023-authenticated-e2e-and-a11y-layer.md`** (next free number
after ADR-022), authored on **S1**. The ADR pins:

1. **Runner = Playwright** (already in-repo) with a **`setup`-project storageState** auth model
   (rejected alternatives: per-test login = slow/flaky; committed fixtures = secret leak + staleness;
   API-token injection that skips the real login = doesn't exercise the auth stack).
2. **Auth via the product's real NextAuth-credentials/Keycloak-ROPC flow** (no mocked auth) — the
   fixture *is* the regression test for login.
3. **a11y gate = `@axe-core/playwright`** at **WCAG 2.2 AA** (`wcag2a/aa`, `wcag21a/aa`, `wcag22aa`),
   failing on `critical`/`serious` (the existing smoke threshold, extended to authenticated pages).
4. **E2E runs in CI / by the operator, NOT in the hourly routine** (project-context §4: agents never
   run E2E; only Murat runs the one heavy local gate). The authenticated suite **skips when the stack
   is unreachable** (never a false-red).
5. **Semantic-locator mandate** (role/label/text, no `data-testid` sprawl, no UUID literals) — ties
   E2E stability to the a11y mandate so the two reinforce each other.

> **ADR number reconciliation:** the index reaches `ADR-022` (E9). `ADR-023` is the next free number.
> If a concurrent epic claims `ADR-023` first, take the next free integer and update this section +
> `plan.md` + `tasks.md` on the S1 run (the same "reconcile the number" discipline E6 used for ADR-019).
