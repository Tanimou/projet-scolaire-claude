# ADR-026 — Compose refuses rather than defaults, and a port is written once

- **Status:** accepted
- **Date:** 2026-08-07
- **Story:** `S-E02-16` · **Finding:** `PF-86` (re-scoped), `PF-89` (discovered) · **Risk:** `R-26`
- **Supersedes nothing.** Extends the fail-fast principle established by `S-E06-1` / `PF-54`
  (`assertRequiredConfig`) from application configuration to *stack* configuration.

## Context

Docker Compose resolves `.env` from the **project directory** — the directory of the compose file,
`infra/` — and not from the caller's working directory. `infra/.env` does not exist in this
repository. Every port lives in the **root** `.env`, beside the `DATABASE_URL` that prisma, the
seed scripts and every host-side tool read.

So the command written in `infra/docker-compose.yml`'s own header, and the command written in the
V3 routine's `SKILL.md` Step −1, both resolved *none* of those variables and fell silently through
to the `${VAR:-default}` defaults. Two commands that look identical produced two different stacks,
and the difference was invisible until something outside a container tried to connect. Run 19 hit
exactly that: Postgres was recreated without its `5433:5432` mapping and every host-side prisma
command failed `P1001`.

`PF-86` recorded this as `TECH_DEBT` — "a defect in how the system is described to be run".
**Measuring it produced a functional break, and the proof needs no reference to any untracked
file.** Inside `infra/docker-compose.yml` alone, before this change:

| declaration | value |
|---|---|
| `KC_HOSTNAME` | `http://localhost:8180` *(hard-coded)* |
| `KEYCLOAK_PUBLIC_URL` | `http://localhost:8180` *(hard-coded — and the api uses it as the **expected token issuer**)* |
| `keycloak.ports` | `${KEYCLOAK_PORT:-8080}:8080` |
| web `NEXT_PUBLIC_KEYCLOAK_URL` | `http://localhost:${KEYCLOAK_PORT:-8080}` |

On the documented path Keycloak published on host **8080**, announced its issuer as **8180**, sent
the browser to **8080**, and the api rejected the resulting token for a wrong issuer. **Login was
broken by construction**, and appeared to work only because one machine's gitignored `.env`
happened to say `8180` — on a code path where compose never read it.

Two further instances of the same class were found while fixing it:

- `--profile seed` alone was an **invalid project** (`service seed depends on undefined service
  api`), because `seed` depended on `api`, which lives in profile `app`. The documented seed
  command could not run. *(Recorded in `PF-86`.)*
- `--profile prod` alone was **also** an invalid project (`service nginx depends on undefined
  service web`) — found by the new gate on its first execution, not by reading. Recorded as
  **`PF-89`**.

## Decision

### 1. A published host port carries no default. Compose **refuses**.

Every `ports:` entry that interpolates a variable uses `${VAR:?message}`, never `${VAR:-default}`
and never a bare `${VAR}`. Thirteen variables are affected.

A refusal in the operator's terminal is a control. A default is a second, undocumented stack that
nobody chose and nobody can see. This is the same argument `S-E06-1` made about `?? 'admin'`: *a
default nobody wrote down is the defect, so the fix is a declaration, not a better default.*

The message names the remedy (`--env-file .env`) and the finding, because a refusal the reader
cannot act on has moved the defect rather than closed it.

**Consequence, accepted deliberately:** `cp .env.example .env` becomes a required installation
step rather than a suggestion, and `.env.example` must declare all thirteen. That is the point —
the file that describes the stack is now the file that produces it.

### 2. A host port is written exactly once.

No browser-facing value hard-codes a port the file also publishes through a variable.
`KEYCLOAK_PUBLIC_URL`, `KC_HOSTNAME` and both `NEXT_PUBLIC_KEYCLOAK_URL` occurrences derive from
`${KEYCLOAK_PORT}`; `WEB_PUBLIC_URL` derives from `${WEB_PORT}`.

Rule 1 alone would **not** have prevented the login break: with `--env-file .env` supplied and
`KEYCLOAK_PORT=9999`, the issuer would still have said `8180`. A port written in two places
diverges eventually; it is now written in one.

### 3. A profile activates its own dependencies.

Compose refuses the **entire** project — it does not degrade it — when an enabled service depends
on a service no active profile enables. `migrator` therefore carries `["app", "seed", "prod"]`, and
`api` / `worker` / `web` carry `["app", "prod"]`.

`worker` gaining `prod` goes one step beyond bare validity (nothing in `prod` depends on it) and is
deliberate: the profile claims to start "le mode prod", and a prod stack without its background
worker is not that stack. That is the same defect as `PF-86` — a documented command starting
something other than what it announces — at an address the validity rule alone would not reach.

### 4. `.env.example` describes the stack the rest of the repository already assumes.

It said `POSTGRES_PORT=5432` / `KEYCLOAK_PORT=8080` while `apps/api/.env.example`, the seed
scripts, the restore runbook and the drill all said `5433` / `8180`. The repository described two
incompatible local stacks and did not say which was real. It now says `5433` / `8180`, the majority
and the working one, and the host-side `KEYCLOAK_URL` / `NEXT_PUBLIC_KEYCLOAK_URL` follow.

### 5. `infra/pilotage.sh` refuses instead of falling back.

Its `compose()` wrapper used `--env-file` only *if* the root `.env` existed and silently omitted it
otherwise. That is `PF-86` one layer up: "fall back gracefully" meant "start a different stack and
say nothing". It now fails with the remedy named.

## Alternatives considered

**Create `infra/.env`.** Would work, and is what compose's resolution rules invite. Rejected: it
duplicates the port declarations into a second file that can drift from the root `.env` — the exact
failure mode of decision 2, relocated. It also puts a `.env` beside a tracked directory, inviting
someone to commit it.

**Pass `--project-directory ..` instead.** Correct but not enforceable: it is another flag every
invocation must remember, and forgetting it is silent again. `${VAR:?}` makes forgetting loud, and
loud is the property being bought.

**Keep the defaults but document them harder.** This is what the repository already did — the
compose header, `DEPLOYMENT.md` and the drill runbook all described the intended stack. Documenting
an invariant nobody executes is `R-26`, whose recurrence is the reason V3 exists.

**Fix only the `--env-file` half.** Would have left the issuer contradiction, which is the half that
actually breaks login, and which no amount of correct invocation repairs.

## Consequences

- The documented command now starts the documented stack, and the wrong command refuses by name.
- `scripts/compose-invocation-check.js` is stage 0c of `scripts/ci-gate.sh` and a step of
  `.github/workflows/ci.yml`. It evaluates the **parsed** compose file rather than grepping for
  expected shapes, so a service added tomorrow inherits every rule without anyone remembering.
- Where a `docker` binary exists it additionally **executes** `docker compose config` in both
  directions and asserts the refusal really happens. Where docker is absent it says so on stdout;
  it never downgrades silently to a vacuous pass.
- Thirteen variables are now mandatory. An existing `.env` missing `WORKER_HTTP_PORT`, `HTTP_PORT`
  or `HTTPS_PORT` — none of which were ever declared in `.env.example` — will stop compose until
  they are added. This is a one-time, self-describing break, and it is the cost of the guarantee.

## What this does **not** establish

- It does not prove any *hosted* deployment is coherent. `infra/docker-compose.prod.yml` is
  deliberately out of the gate's C5 scope: it is driven by `scripts/deploy-prod.sh` with its own
  `--env-file .env.prod`, and per `SKILL.md` Step −1 the hosted host is an audit fixture, not a
  deployment target. Its own port coherence is unexamined and remains so.
- It does not prove a full login **flow** works end to end. What was executed is narrower and
  stated as such: the derived values resolve to the published ports, and the running Keycloak's
  discovery document reports `issuer: http://localhost:8180/realms/pilotage-scolaire` — the port
  that is in fact published. An authenticated browser journey belongs to `V3-E05`.
- The C3 rule catches a hard-coded port that **no service publishes as a literal**. A value
  hard-coding a port that some *other* service happens to publish literally would pass. Tightening
  that needs per-service host identity, which the compose file does not carry.
