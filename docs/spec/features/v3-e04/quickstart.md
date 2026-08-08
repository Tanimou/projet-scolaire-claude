# V3-E04 — Quickstart (run, seed, measure, test)

> **What this file is.** The operator's half of the spec-kit: how to bring `/admin/audit` and the audit write paths up
> locally, how to **re-measure** every number `PROGRESS.md` records (so a later run can falsify them rather than trust
> them), and how to run each slice's stated test. Every command below was read off the shipped
> `package.json` / `scripts/` / `infra/docker-compose.yml` of this repository — none is invented.
>
> **Two standing prohibitions apply to every command on this page.** No agent runs a build
> (`pnpm build`, `next build`, `docker build`, `docker compose build`, `infra/pilotage.sh update|rebuild|reset`), and
> only the test-architect runs `pnpm typecheck`. Both are `bmad/project-context.md` §4/§4a rules, not preferences.

---

## 0. Prerequisites

| Thing | Value | Why it bites |
|---|---|---|
| Node | **22** (`.nvmrc`) | Workspace packages are consumed as **TS source**; Node ≥ 23's native ESM loader rejects their folder barrels, so `pnpm dev` will not start. `scripts/dev.sh` detects this and tells you to use the full Docker stack instead. |
| pnpm | **9.12.3** | Pinned by the monorepo. |
| Docker | running | Infra only (Postgres/Redis/Keycloak/MinIO/Maildev/Jaeger). |
| Working root | `C:\Users\HP\Downloads\pilotage-scolaire-claude` | Not `E:`. See the memory note — the project was repatriated 2026-06-02. |

Copy `.env.example` → `.env` if you have not already. The values this epic cares about:

```
DATABASE_URL=postgresql://pilotage:pilotage@localhost:5433/pilotage?schema=public
KEYCLOAK_URL=http://localhost:8180
KEYCLOAK_REALM=pilotage-scolaire
```

Note the host port is **5433**, not 5432 (`infra/docker-compose.yml`, service `pilotage_postgres`).

---

## 1. Bring the stack up

**Hybrid (recommended — infra in Docker, apps local with hot reload):**

```bash
bash scripts/dev.sh              # infra up + schema sync + seed if empty + pnpm dev
bash scripts/dev.sh --infra      # infra only, don't start the app
bash scripts/dev.sh --no-seed    # skip the demo seed
bash scripts/dev.sh --reset      # wipe DB volumes first (fresh data)
```

Or, equivalently, from the root scripts: `pnpm dev:start` / `pnpm dev:infra` / `pnpm dev:reset`.

**Infra alone, without the launcher:**

```bash
pnpm docker:up      # docker compose --env-file .env -f infra/docker-compose.yml up -d
pnpm docker:down    # stop, keep data
pnpm docker:reset   # stop AND wipe volumes
```

**Ports once up:** web **3100** (`next dev --port 3100`, *not* 3000) · api **4000** under the global prefix
**`/api/v1`** (`apps/api/src/main.ts:96`; `healthz`, `readyz`, `version`, `metrics` and `/` are excluded) · Postgres
**5433** · Keycloak **8180**.

---

## 2. Seed

```bash
pnpm --filter @pilotage/api prisma:seed          # base tenant/roles/permissions
pnpm --filter @pilotage/api prisma:seed:demo     # the voltaire-demo dataset — this is the one that writes audit rows
```

`prisma/seed-demo.ts` is where the **54 audit rows** come from:

- `:298` — `auditLog.deleteMany({ where: { tenantId: T } })`, so a re-seed is idempotent for this table;
- `:1096` — the named entries, which carry **French display strings in structural columns**
  (`action: 'Export'`, `resourceType: 'Résultats'`) — this is `M-14`, and `S-E04-4` corrects the **seed**, never the
  existing rows;
- `:1114` — 50 generic rows built from `['Création','Mise à jour','Validation','Suppression','Export']` ×
  `['Élève','Professeur','Classe','Évaluation','Note','Inscription']`, `actorRole` hard-coded `'school_admin'`,
  `portal` hard-coded `'admin'`;
- `:1447` — the one row that already uses canonical machine codes
  (`action: 'student.account_linked'`, `resourceType: 'student'`).

> **`S-E04-4` acceptance depends on this asymmetry surviving.** After you correct the seed, a **freshly seeded**
> database will contain only canonical codes — and the legacy-rendering path (`vocabulary: "unknown"` + the
> « format hérité » marker) will then have **no fixture to exercise it**. Write that case against an explicitly
> inserted French row in the test, not against the seed. A correction that makes the problem vanish locally is not a
> demonstration that the problem is handled; `spec.md` §6 rules the 54 hosted rows are never rewritten, so the
> rendering path is permanent even when your local database is clean.

---

## 3. Log in and reach the surface

Demo admin (full `voltaire-demo` data):

```
mme.dupont@voltaire.fr / Demo!2024Pilotage
```

Simple per-portal accounts: `admin|teacher|parent@pilotage.local` / `Changeme123!`.

Then open **http://localhost:3100/admin/audit**.

> **This is `S-E04-2`'s headline, and it is the one thing the spec run could not settle.** `PF-14` claims a
> server/client boundary crash. It **did not reproduce statically**, and an unauthenticated probe returns
> `307 → /admin/login`, so the authenticated render has never been observed. When you load this page, **record the
> verdict either way** — in the PR and in `PROGRESS.md` — and include the **browser console**, so a hydration warning
> is not mistaken for a render failure and vice versa. Do not close `PF-14` in either direction without that evidence.

Files behind the page: `apps/web/src/app/admin/audit/page.tsx`, `AuditTable.tsx`, `AuditPageFilters.tsx`,
`AuditDetailDrawer.tsx`, `actions.ts`.

---

## 4. Call the endpoints directly

Both audit endpoints sit on the analytics controller and require the **existing** `audit.read` permission
(`apps/api/src/modules/analytics/analytics.controller.ts:226`, `:256`;
`apps/api/src/shared/auth/permissions.constants.ts:107`). This epic adds **no new permission** — the chain-verification
endpoint in `contracts/openapi.yaml` reuses `audit.read`.

Get a token from Keycloak, then:

```bash
TOKEN=$(curl -s -X POST \
  "http://localhost:8180/realms/pilotage-scolaire/protocol/openid-connect/token" \
  -d grant_type=password -d client_id=portal-admin \
  -d client_secret="$KEYCLOAK_ADMIN_CLIENT_SECRET" \
  -d username='mme.dupont@voltaire.fr' -d password='Demo!2024Pilotage' \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).access_token))")

curl -s -H "Authorization: Bearer $TOKEN" \
  'http://localhost:4000/api/v1/analytics/audit?from=2026-08-01&to=2026-08-08&page=1&pageSize=20' | head -c 2000

curl -s -H "Authorization: Bearer $TOKEN" \
  'http://localhost:4000/api/v1/analytics/audit-facets' | head -c 2000
```

**Reproduce the `to`-boundary defect (`M-17`, `AC-4`) from the API, before touching code:**

```bash
# Write an audited action now, then filter with to = today.
# analytics.service.ts:3251 applies `lte: new Date(to)`, so `to=YYYY-MM-DD` becomes T00:00:00Z
# and every row written later that day is dropped. The row you just made will be missing.
curl -s -H "Authorization: Bearer $TOKEN" \
  "http://localhost:4000/api/v1/analytics/audit?to=$(date +%F)" | head -c 600
```

**Reproduce the KPI-scope defect (`M-18`, `AC-4`):** compare `kpis` against `total` on the *same* filtered request.
`analytics.service.ts:3310-3331` computes all four KPIs on a `where` containing **only `tenantId`**, so the cards do
not move when you change the filter. The invariant `S-E04-5` installs is `kpis.eventsInRange.value === total`; today
that equality is false by construction, which is the cheapest way to see the bug.

---

## 5. Measure the database directly

Everything in `PROGRESS.md`'s measurement table is reproducible with `psql` inside the container. **Re-run these at the
start of each slice** rather than trusting the table — that is the point of writing them down.

```bash
PSQL='docker exec -i pilotage_postgres psql -U pilotage -d pilotage -t -A'

# M-1  rows in audit_log
$PSQL -c "select count(*) from audit_log;"

# M-2  the chain has never existed: hash / prev_hash written by nobody
$PSQL -c "select count(hash), count(prev_hash) from audit_log;"

# M-3  provenance is empty
$PSQL -c "select count(ip_address), count(user_agent) from audit_log;"

# M-4  actor_role distribution
$PSQL -c "select actor_role, count(*) from audit_log group by 1 order by 2 desc;"

# M-14 the legacy vocabulary: French display strings in structural columns
$PSQL -c "select distinct resource_type from audit_log order by 1;"
$PSQL -c "select distinct action from audit_log order by 1;"

# M-16 adminLogins is structurally always 0 — no call site writes a login row
$PSQL -c "select count(*) from audit_log where action ilike '%login%' or resource_type ilike '%session%';"

# M-21 Tenant.timezone does not exist (S-E04-5 adds it); only School.timezone does
$PSQL -c "select column_name from information_schema.columns where table_name='tenant' order by 1;"
$PSQL -c "select column_name from information_schema.columns where table_name='school' and column_name='timezone';"

# M-25 AuditLog has no FK to Tenant (PF-96 — stated, not fixed) and one index only
$PSQL -c "select conname, contype from pg_constraint where conrelid='audit_log'::regclass;"
$PSQL -c "select indexname from pg_indexes where tablename='audit_log';"
```

**Source-side measurements** (these are the ones a gate will later enforce):

```bash
# M-5  30 write sites monorepo-wide — note the walk root is NOT apps/api/src alone
grep -rn "auditLog.create" apps/api/src apps/worker/src packages/imports-core/src | wc -l
grep -rn "auditLog.create" packages/imports-core/src     # engine.ts:197 and :288

# M-6  8 sites hard-code the actor role
grep -rn "actorRole: 'school_admin'" apps/api/src

# M-7  9 sites hard-code the portal
grep -rn "portal: 'admin'" apps/api/src

# M-8  6 of 28 write inside a transaction
grep -rn "tx.auditLog.create" apps/api/src | wc -l

# M-19 no trust proxy anywhere; main.ts is a bare NestFactory.create
grep -rn "trust proxy\|trustProxy" apps/api/src infra/

# M-20 RLS exists NOWHERE, 0_baseline included — despite ADR-002 declaring it
grep -rniE "ROW LEVEL SECURITY|CREATE POLICY" apps/api/prisma/ infra/ scripts/

# M-24 the third vocabulary consumer, easily missed
grep -rn "action" apps/worker/src/modules/exports/generators/audit-csv.generator.ts | head
```

> **`M-5` is the trap this epic inherits.** Two audit writes live in `packages/imports-core`, which both the API and
> the worker consume. A gate rooted at `apps/api/src` would report a **false count** and pass over them — the same
> shape as `S-E06-5`'s `packages/ui` blind spot. `S-E04-7`'s `scripts/audit-write-check.js` must walk
> `apps/api/src` **+** `apps/worker/src` **+** `packages/imports-core/src`.

---

## 6. Run the tests

**API unit tests** (Jest, `apps/api/jest.config.js`) — pattern-scoped, never the whole suite:

```bash
pnpm --filter @pilotage/api test -- audit
pnpm --filter @pilotage/api test -- analytics
pnpm --filter @pilotage/api test -- <the-new-spec-name>
```

**Contracts** (`S-E04-4`'s completeness test lives here):

```bash
pnpm --filter @pilotage/contracts test
```

Remember `packages/contracts` is **built to CJS** (`dist/`, `main → dist/index.js`) because Node loads it at runtime —
`bmad/project-context.md` §1. A new `src/audit/` module must be exported from the package barrel, and consumers get it
only after the package is built. **Agents do not build**; if a consumer cannot resolve the new export, say so in the PR
rather than running `pnpm build`.

**Web** has **no unit runner** — Playwright only. So every UI, contrast and a11y statement in `ux.md` is read from
source or computed, and the `/admin/audit` render evidence in `S-E04-2` is **manual**. Label it as manual; do not dress
it up as a test.

```bash
pnpm --filter @pilotage/web test:e2e:smoke     # only if the stack is already running
```

---

## 7. Run the gates

The house pattern is a `scripts/*-check.js` wired into **both** `scripts/ci-gate.sh` and `.github/workflows/ci.yml`.

```bash
node scripts/link-integrity-check.js      # S-E04-2 — /admin/reports retirement
node scripts/schema-drift-check.js        # S-E04-5 and S-E04-8 — needs a live PostgreSQL
node scripts/audit-write-check.js         # S-E04-7 — does not exist yet; this slice ships it
bash  scripts/ci-gate.sh --quick          # all stages except the build
```

Two standing rules when you report a gate:

- **`R-23` — read the verdict line, not `$?`.** Several checks in this repo print `PASS`/`PROBLEM` lines and a
  non-obvious exit status. Quote the line.
- **`DNC-08` — a check that cannot run must FAIL.** "Nothing to check" is never a pass. `S-E04-7` and `S-E04-8` both
  carry an acceptance criterion that this is proven with a *driven* unreadable-input case, not asserted.

**CI note:** GitHub Actions is locked for billing (nothing has started since 2026-07-28). A red check is **not**
evidence that the diff is broken — read the check-run annotation before debugging.

---

## 8. Schema changes (`S-E04-5` and `S-E04-8` only)

`G-MIGRATION` triggers in **two** slices, not one. Both follow the same route, and it is not `db push`.

```bash
# Author a REVIEWED migration file under apps/api/prisma/migrations/ .
# The directory currently holds 0_baseline ONLY.
pnpm --filter @pilotage/api prisma:migrate:dev --name <slice_specific_name>
pnpm --filter @pilotage/api prisma:generate
node scripts/schema-drift-check.js        # ADR-027 — the ledger must reproduce schema.prisma
```

- **Never `prisma db push`.** `S-E02-5`'s drift gate replays the ledger against `schema.prisma`; a pushed change has no
  ledger entry and turns the gate red at the next run.
- **Expect a RED typecheck immediately after any additive schema edit** until `prisma generate` has run. This is the
  known `prisma-generate RED gate` — it is a **mechanical** step, not a signal to re-scope the slice.
- Every migration states its **rollback** in the file header. `S-E04-8`'s rollback explicitly does **not** delete the
  genesis row.
- `hash` / `prev_hash` stay **nullable, permanently** (`A-01`): pre-genesis rows exist and cannot be backfilled, so
  `NOT NULL` is unreachable. Put *nullable means pre-genesis* in the model comment or the next reader will "tidy" it.

---

## 9. Per-slice quickstart

| Slice | Bring up | The one command that shows you the problem | Evidence to capture |
|---|---|---|---|
| `S-E04-1` | source only | `grep -rn "actorRole: 'school_admin'" apps/api/src` → **8** | 8 → 0; a `super_admin` role-create writing `actorRole: 'super_admin'`, shown able to fail |
| `S-E04-2` | full stack + login | load `/admin/audit` authenticated | the render verdict **either way**, with console; `link-integrity-check.js` verdict line with the row retired |
| `S-E04-3` | full stack | write an audited action from two different clients, read `ip_address` back **from the database** | two distinct addresses; a forged `X-Forwarded-For` changing nothing |
| `S-E04-4` | seed + contracts | `select distinct resource_type from audit_log` vs `RESOURCE_TYPE_LABELS` (intersection: **0**) | both-direction completeness; a legacy French row rendering with « format hérité » |
| `S-E04-5` | full stack | filter `to = today` and watch today's rows disappear | boundary pinned at 23:59:59 **in the tenant's timezone**; `kpis.eventsInRange.value === total` |
| `S-E04-6` | api + db | make a mutation fail inside its transaction | **both** directions, **per family**: neither row exists / mutation does not persist |
| `S-E04-7` | source + gate | `node scripts/audit-write-check.js` (after you write it) | the gate shown **able to fail**, and shown to **fail when it cannot run** |
| `S-E04-8` | full stack + db | `select count(hash) from audit_log` → **0** | `verified` / `broken` + `firstBreakAt` / `unverifiable`, all **driven against a real database**; a concurrency test |

---

## 10. Traps worth knowing before you start

1. **The response is not the evidence.** `S-E04-3` and `S-E04-8` make claims about the **stored** value. Read the row
   back out of PostgreSQL; a 200 with a plausible body proves nothing about what was persisted.
2. **`safe()` turns an error into an empty table.** `/admin/audit` wraps both fetches in an `ApiError` swallower, so
   *"we could not read the audit log"* currently renders as *"no audit entries"*. When a filter returns nothing, verify
   against the database before concluding the filter works.
3. **The diff drawer is not keyboard-reachable.** `AuditTable.tsx:93` is a `<tr onClick>` with no `tabIndex`, no
   `role` and no `onKeyDown`. `AC-1`'s "the diff drawer works" is already false for a keyboard auditor — a WCAG 2.1.1
   (A) failure sitting inside the epic's own acceptance criterion (`ux.md`).
4. **The column says « Date & heure » and renders no heure.** `formatDateLong` (`packages/ui/src/lib/format.ts:65`) is
   date-only. You cannot verify `S-E04-5`'s `to`-boundary fix by eye until the time is visible.
5. **A re-seed hides the legacy-vocabulary problem** (see §2). Test against an explicitly inserted French row.
6. **Do not write "RLS protects the audit rows" anywhere.** `M-20`: zero occurrences repo-wide, `0_baseline` included,
   despite `ADR-002` declaring it. Tenant scoping in this epic is **application-level only**; `ADR-032` / `V3-E01`
   owns the gap.
7. **Re-check the ADR number immediately before creating the file.** `docs/adr/` is the register of record (the
   precedence rule `S-E02-18` installed to close `PF-110`); `architecture-impact.md` §4 is a wish list that reserves
   `029`…`035`. Taking "first free file" would re-create `PF-110` exactly.
8. **No NUL bytes in any file you write.** `PF-95` recurred twice during this epic's own spec run — a raw `U+0000`
   makes git classify the file **binary**, so it reaches human review as *"Binary file not shown"* and `grep` skips it.
   Write the spelled-out form, never an escape a tool might expand back into the byte.
