# ADR-056 — The tenant scope is a property of the DEPLOYMENT, and it must be declared

- **Status:** accepted
- **Date:** 2026-08-22
- **Story:** `S-E01-1h`
- **Findings:** closes `PF-242`; advances `PF-02` (half (a), the deployment half); records `PF-243`, `PF-244`
- **Supersedes nothing.** Extends `ADR-032` §D5–§D8 (the connection cutover) and `ADR-046` §D1.

## Context

Three runs converted three modules to `TenantScopeService.run(...)` — `calendar` (`S-E01-1d`),
`lessons` (`S-E01-1e`), `announcements` (`S-E01-1g`, partial). Each proved its seam by execution:
`scripts/tenant-scope-check.js` builds a **scratch** database from the migration ledger, connects as
`app_user`, and demonstrates that PostgreSQL refuses the foreign tenant.

Those proofs are true. They were also the only place the mechanism had ever run.

On 2026-08-22, measured on the stack this routine declares as its runtime target (Step −1):

```
docker exec pilotage_api sh -c 'echo "APP=$DATABASE_URL_APP"'   →  APP=
```

`AppRolePrismaService` opens its second, RLS-bearing connection **only when `DATABASE_URL_APP` is
declared**. The variable lived in `.env.example` and in **no** service of
`infra/docker-compose.yml`. So the api sat in the named state `degraded_no_app_url`, the gauge
`pilotage_tenant_scope_enforced` read 0, and all 36 converted call sites executed on the **owner**
connection — `pilotage`, measured `rolbypassrls = true`.

A second fact, measured the same way and compounding the first: the stack's database had **2 of 7**
migrations applied, so the RLS policies and the `app_user` grants did not exist on it at all
(`app_user` held **0** table privileges).

**A hypothesis worth recording because it was FALSIFIED.** The api printed *"Preflight migrations OK —
2 appliquée(s)"* while the repository shipped seven, which reads like a preflight that checks
applied-and-clean rather than applied-vs-shipped. It is not. `migration-state.ts:120` computes
`pending = shipped.filter(m => !applied.includes(m))` and has a dedicated `pending` status; it reads
`prisma/migrations` **from disk**. The preflight was right — the *image* shipped two migrations,
because it predated the other five. No finding is spent on the preflight.

What is true, and is `PF-243`, is one layer up: the machinery that would have caught the stale image
was **unarmed**. `GET /version` answers `buildSha: "unknown"`, `verdict: "unverified"` — in its own
words, *"EXPECTED_GIT_SHA non déclaré : la version qui tourne n'est comparée à rien"* (`R-05`). So an
image nine days behind the ledger served an api that truthfully reported `migrations: clean`, and
nothing in the stack was in a position to contradict it.

The seam was built, proven, and never turned on.

## Decision

### §D1 — `DATABASE_URL_APP` is declared on the `api` service, not on the shared anchor

It goes in the `api` service's own `environment:` block rather than the `x-app-env` anchor, following
the precedent `OTEL_EXPORTER_OTLP_ENDPOINT` set: **only a service that consumes a capability should be
declared to have it.**

- `migrator` must **not** hold it. The migrator creates the objects and issues the `GRANT`s; a role
  cannot grant itself privileges it does not hold, and `app_user` owns nothing by design.
- `worker` must **not** hold it. The worker has no request tenant — its 99 call sites are enumerated
  *outside* any scope by `tenant-adversarial-check.js`, because a job carries its tenant in its
  payload. Declaring the URL there would announce a capability no statement exercises, which is the
  same objection `ADR-054` §D3 makes to an over-declared grant.

### §D2 — the address is the compose-network address, and that is load-bearing

`postgresql://app_user:app_user@postgres:5432/pilotage`, never the `localhost:5433` that
`.env.example` ships for host-side tooling. This is not tidiness. `AppRolePrismaService` **degrades
rather than crashes** on a URL it cannot use — correctly, because a deployment that cannot open the
second connection must still serve — so a wrong address produces *exactly the same observable* as no
address: a healthy stack with the gauge at 0.

### §D3 — the declaration is RATCHETED, in the fast tier, and it refuses four shapes

`scripts/tenant-scope-deployment-check.js` + `apps/api/src/shared/quality/tenant-scope-deployment-gate.spec.ts`.

It is **tier 1** (source-only, no Docker, no database), unlike its neighbour
`compose-invocation-check.js` which is `--full` because it shells out to `docker compose config`. That
placement is the decision: the diff that reintroduces this regression is a **compose edit**, and a
compose edit does not schedule a `--full` run. A gate that only ran in `--full` would not have caught
the thing it exists to catch.

It refuses four shapes, not one:

| # | shape | why it is not merely "wrong" |
|---|---|---|
| 1 | absent / empty | what shipped — `degraded_no_app_url`, gauge 0 |
| 2 | host-only address (`localhost`, `127.0.0.1`) | does not resolve in the network; degrades identically |
| 3 | database or host disagreeing with `DATABASE_URL` | two addresses for one database is how `PF-86` happened |
| 4 | **the owner role** | the only shape that reads as **enforced** while isolating nothing |

Shape 4 is why the checker does more than test for presence. The owner carries `BYPASSRLS`; pointing
the "app" connection at it would make the probe pass, the gauge read **1**, and the isolation be zero.
A gate asserting only "declared" would go green on the one configuration worse than the bug.

### §D4 — what this does NOT claim

It does not claim the running stack is enforcing. Enforcement is a property of a **process**, not of a
file. The checker reads the compose file as text and never inspects a container — deliberately, because
a probe that answers from whatever happens to be running locally is exactly the defect `TOOL-36` names.
The running-stack claim is made separately, by execution, and is recorded below as evidence rather than
as a checker.

### §D5 — this ADVANCES `PF-02`; it does not close it

The source-side counter is **unchanged** by this slice, re-derived on this tree:

```
36 scoped + 120 enumerated / 816      (identical to main)
```

That is the honest arithmetic. What changed is that the 36 already-converted sites now **actually
execute under RLS on the target**, where before they executed on a `BYPASSRLS` owner. The other 660
still do not, and the application still cannot cut `DATABASE_URL` over. `PF-02`'s closure condition
(`ADR-032` §D5–§D8) is untouched.

## Evidence (executed 2026-08-22, on the local stack — never the VPS)

Rebuilt `migrator` and `api` (the images predated the RLS migrations — `R-05`), recreated both.

| claim | before | after |
|---|---|---|
| migrations applied to the stack database | **2** / 7 | **7** / 7 |
| `app_user` table privileges | **0** | **199** |
| tables with RLS enabled | **0** | **53** |
| policies | **0** | **59** |
| declared 25-privilege closure held | n/a | **25 / 25**, set-compared against `information_schema` |
| `AppRolePrismaService` state | `degraded_no_app_url` | **`enforced`** |
| `pilotage_tenant_scope_enforced` | 0 | **1** |
| api routes mounted / errors | — | 229 / **0** |

The denial itself, on the stack's own database — with the positive control first, because a proof that
shows only absence is green for the wrong reason:

| connection | `app.current_tenant_id` | `count(*) from calendar_event` |
|---|---|---|
| owner `pilotage` | tenant **B** (foreign) | **17** ← the hole, and what the api used to be |
| `app_user` | tenant **A** (own) | **17** ← positive control: rows APPEAR |
| `app_user` | tenant **B** (foreign) | **0** ← DENIED |
| `app_user` | none | **0** |

The gate was mutation-tested rather than trusted: gutting the owner-role refusal killed 2 specs,
gutting the absent-variable refusal killed 3. The checker was restored and its **sha256 verified
identical**. Fail-before was replayed against the real pre-slice compose file from git history —
1 problem on `main`, 0 on this tree.

## Consequences

- The local stack now enforces the tenant scope. This is the first time any deployment has.
- The next module conversion changes runtime behaviour on the stack, where previously it changed only
  a counter. Conversions become testable end-to-end.
- Two findings are recorded and deliberately **not** fixed here:
  - **`PF-243` (P2)** — the local stack cannot detect that its image predates the repository.
    `infra/docker-compose.yml` passes `GIT_SHA: ${GIT_SHA:-}` at build and
    `EXPECTED_GIT_SHA: ${EXPECTED_GIT_SHA:-}` at run, both empty on the documented path, so
    `GET /version` returns `buildSha: "unknown"` / `verdict: "unverified"`. The `R-05` machinery
    exists and is simply not armed; that is why a five-migrations-behind image could serve for nine
    days while reporting `migrations: clean` — which it truthfully was, for the ledger *it* shipped.
    Fixing it is a decision about where the sha comes from locally, not a two-line edit.
  - **`PF-244` (P3)** — `.env.example:37` ships `DATABASE_URL_APP` on `localhost:5433` while the root
    `.env` and the stack both use `5432`. Host-side tooling that copies the example connects nowhere,
    and — being the degrade-silently path — says nothing when it does.
