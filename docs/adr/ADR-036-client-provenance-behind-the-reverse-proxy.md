# ADR-036 — Client provenance behind the reverse proxy: a pinned hop count, blanket `X-Forwarded-For` refused, null rather than wrong

- **Status:** accepted
- **Date:** 2026-08-08
- **Story:** `S-E04-1` (writes this decision) · **Implemented by:** `S-E04-3` (builds the forwarding)
- **Epic:** `V3-E04` · **Finding:** `PF-31` *(provenance half)* · **Risk:** `R-26` *(magic number)*, `A-01`
- **Supersedes nothing.** Extends the refuse-rather-than-default principle of `ADR-026` (stack
  configuration) and `S-E06-1` / `PF-54` (`assertRequiredConfig`) to a value that is a property of the
  **deployment topology**, not of the source tree.
- **Number check:** `docs/adr/` held `ADR-001`…`ADR-028` when this file was created (verified
  2026-08-08). `ADR-029`…`ADR-035` are reserved in `docs/daily-improvement-v3/architecture-impact.md`
  §4; `ADR-035` is `V3-E04`'s in-transaction/chain ADR and is **not** this one. `ADR-036` was free. Per
  the precedence rule `S-E02-18` installed (`PF-110`), `docs/adr/` is the register of record.

## Context

`AuditLog` has an `ipAddress` (`@db.Inet`) and a `userAgent` column. `/admin/audit` renders the first
in monospace as *where the administrator acted from*. Both are **0 / 54 populated** — the columns have
never carried a value, and the one call site that writes them (`S-E06-6`'s calendar seed) writes what
Express hands it.

What Express hands it, measured on this checkout:

| Fact | Evidence |
|---|---|
| `apps/api` sets no `trust proxy` | `grep -rn "trust proxy\|trustProxy" apps/ infra/ packages/ scripts/` → **0 hits**. `apps/api/src/main.ts:37` is a bare `NestFactory.create(AppModule, { bufferLogs: true })` |
| So `req.ip` is the **socket peer**, never the browser | Express default: `trust proxy` unset ⇒ `req.ip` = the TCP peer, and `X-Forwarded-For` is ignored |
| `apps/web`'s single server-side fetch seam forwards **three** headers | `apps/web/src/lib/api-client.ts:43-48` — `Accept`, `Content-Type`, `Authorization`. No `X-Forwarded-For`, no `User-Agent` |
| So `userAgent` is `null` on every UI-driven write | undici sends no `User-Agent` of the operator's browser; the operator's browser is not the caller |

The consequence is not a missing value. It is a **wrong** value that looks right: a stored address that
is identical for every actor forever, rendered to an auditor as the place a person was sitting.
`sanitiseInetOrNull` cannot catch it, because a proxy address *is* a valid `inet`.

### The measured topology

The hop depth is **not one number**. It differs between the two deployments this repository defines,
and that fact is the reason this ADR exists rather than a constant.

**Production** (`scripts/deploy-prod.sh` → `--profile app --profile prod`, `infra/docker-compose.yml`
\+ `infra/docker-compose.prod.yml`):

```
browser ──▶ Traefik (host, TLS, entrypoint `websecure`) ──▶ nginx (container :80) ──▶ api (:4000)
              hop 2                                           hop 1                    socket peer
```

- **hop 1 — nginx**, in-repo and verified: `infra/nginx/conf.d/pilotage.conf:109` sets
  `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;` on `location /api/` (and at seven
  further locations).
- **hop 2 — Traefik**, evidenced by `infra/docker-compose.prod.yml`'s nginx labels
  (`traefik.enable=true`, `traefik.http.routers.pilotage.rule=Host(...)`,
  `entrypoints=websecure`, `loadbalancer.server.port=80`) and by the external `root_web` network the
  service joins. **Traefik's own configuration lives on the VPS at `/root/docker-compose.yml`, outside
  this repository** — see *What this ADR does not establish*.

**Development / local** (`--profile app`): `nginx` carries `profiles: ["prod"]`
(`infra/docker-compose.yml:539`), so **it does not run**. The api is published directly
(`${API_PORT}:4000`), and `apps/web` reaches it at `http://api:4000`
(`infra/docker-compose.yml:450`) — no reverse proxy in the path at all, and no `X-Forwarded-For`
header of any kind.

### The second path, which no hop count can fix

In **production**, `NEXT_PUBLIC_API_URL` is `${PUBLIC_BASE_URL}` — the public origin. The Next.js
server-side fetch therefore **hairpins back out** through Traefik and nginx. The API receives a
correctly-formed, correctly-depth `X-Forwarded-For` whose leftmost entry is the **web container**,
because the web container *is* the client of that request. Setting `trust proxy` to the right number
resolves that chain perfectly, and yields the wrong answer with full confidence.

**This is the non-negotiable consequence of this ADR:** fixing `trust proxy` alone changes nothing on
the UI-driven path. The operator's address and user-agent do not exist anywhere in the API process
until `apps/web` forwards them explicitly. `S-E04-3` owns that forwarding.

## Decision

### D1 — The blanket trust is refused, in writing, with its reason

`app.set('trust proxy', true)` is **refused**. It instructs Express to believe the leftmost entry of
`X-Forwarded-For` from any caller, so any client — including one bypassing the browser entirely — can
send `X-Forwarded-For: 1.2.3.4` and choose what the governance trail records about it.

A forgeable provenance in an audit trail is **strictly worse than a blank one**, and the asymmetry is
the whole argument: a blank field is read as *unknown*, which is true; a forged field is read as
*evidence*, which is false, and it is read that way precisely when someone is looking for evidence.
The same reasoning orders this epic (`plan.md` §2) and will govern the hash chain: *a verified record
of falsehoods is worse than an honest gap, because a verified record is believed.*

`app.set('trust proxy', true)` and the string forms that mean the same thing (`'*'`) must appear
nowhere in `apps/api`.

### D2 — The pinned hop count

> **Pinned value: `N = 2` for the production topology (Traefik → nginx → api).**
> **Pinned value: `N = 0` for the local `--profile app` topology (no proxy in the path).**

`N` counts the reverse proxies between the API socket and the client that are under our control and
known to append to `X-Forwarded-For`. With `N = 2`, Express discards the two rightmost entries as
trusted infrastructure and resolves `req.ip` to the address Traefik recorded; every entry a caller
injected sits **beyond** hop `N` and is discarded, which is the property `D1` was refused for lacking.

### D3 — `N` is a deployment property, and it refuses rather than defaults

Because `N` measurably differs between the two topologies this repository defines, a source literal
would be wrong in one of them. When `S-E04-3` applies it, `N` **must** be read from a declared
configuration key that **refuses to start when it is absent** — the `ADR-026` shape
(`${VAR:?…}` in compose) and the `assertRequiredConfig` shape (`PF-54`) already established here.

Specifically forbidden: `Number(process.env.TRUST_PROXY_HOPS ?? 2)`. A silent default is how `PF-54`
shipped an `admin`/`admin` credential and how `S-E06-6` shipped a stale academic year — a fallback that
is right on the author's machine and wrong on the deployment nobody re-reads. Here it would be worse
than either, because the failure is silent, permanent, and renders as evidence.

### D4 — Null rather than wrong

Where the hop count cannot resolve an address that is trustworthy under `D2`/`D3` — a shorter chain
than `N`, an unparseable header, an absent header, a value that is not a valid `inet` — the stored
value is **`null`**, never a best guess and never the socket peer.

> *« Une provenance absente, jamais une provenance fausse. »*

The UI states the absence rather than rendering an empty cell (`ux.md`; « provenance non disponible »).
`sanitiseInetOrNull` and `truncateUserAgent` (now in `apps/api/src/shared/audit/`) implement the last
mile of this rule and already carry it in their docblocks.

### D5 — The derivation seam takes hints, not a request

`deriveAuditProvenance` accepts the caller's JWT and an **already-extracted** `{ ipAddress, userAgent }`
pair. It does **not** accept an Express `Request`, and it reads no header, no `req.ip`, no
`process.env`, no `NODE_ENV`.

This is a structural choice, not a stylistic one. If the function received a request it would put
`req.ip` in scope at the one place every audit write funnels through, and the next author would wire it
in — that is option (a), the one this ADR refuses. Keeping the request out means the hop-count decision
can be made in exactly **one** place (`S-E04-3`'s extraction seam) rather than at every call site, and
it makes `DNC-10` a property of the function's *shape*: there is no switch to find because there is
nothing switchable in scope. The precedent is `S-E06-6`'s `SeedFrenchHolidaysArgs`, which already takes
pre-sanitised `ipAddress` / `userAgent` for a related reason (a failed `inet` cast must not roll back
the transaction it was auditing).

Until `S-E04-3` lands, callers pass nothing and both fields are `null`. That null is the decision
above, executing — **it is not a stub and not a defect.**

**What `S-E04-1` actually shipped, recorded here so the ADR matches the code** (completed by the
implementing story, per its §3 instruction to verify-and-correct rather than re-author): the signature
is `deriveAuditProvenance(jwt: KeycloakJwtPayload, _req?: unknown)`. The second parameter is typed
`unknown` and is **unread** — the leading underscore is the repo's ESLint `argsIgnorePattern`
(`packages/eslint-config/base.js:87-90`), and
`apps/api/src/shared/quality/audit-provenance-gate.spec.ts` G-6 asserts the function body contains no
`req.ip`, no header read, no `process.env` and no reference to `_req` at all. So the *property* `D5`
exists for — nothing switchable is in scope — holds today by absence rather than by a narrow type.
`S-E04-3` narrows `unknown` to the `AuditClientHints` shape above at the moment it has something to
put in it; that is a one-line change at one declaration, and no call site re-signs. The parameter is
kept rather than omitted precisely so the nine call sites this ADR governs are written once.

### D6 — `portal` is an attribution, not an observation

`portal` is derived from the actor's highest-precedence realm role (`super_admin`/`school_admin` →
`admin`, `teacher` → `teacher`, `parent` → `parent`). This is a large improvement on the literal
`'admin'` it replaces, and it is still **not a measurement of the surface the request came through**: a
`school_admin` calling a teacher-portal endpoint records `admin`.

The truthful source would be the token's `azp` claim — Keycloak issues three portal clients plus a
service client (`portal-admin`, `portal-teacher`, `portal-parent`, `api-backend`;
`infra/keycloak/realm-export.json:43,61,79,97`, per `ADR-004`). It is **deliberately not adopted here**:
`azp` is optional in the payload type, no test in this repository drives a real token, and an absent
`azp` would need the role mapping as a fallback anyway — so adopting it now would add a second source of
truth without removing the first. Recorded so the limitation is a stated posture rather than an
unnoticed gap; `S-E04-3` is the natural place to revisit it, since it is already making provenance real.

### D7 — How to re-derive `N` (so it does not become a magic number — `R-26`)

Re-run this on any change to `infra/nginx/conf.d/pilotage.conf`, `infra/docker-compose.prod.yml`,
`infra/docker-compose.yml` (the `nginx.profiles` key) or the host's Traefik:

1. **Is nginx in the path for this deployment?** Read `nginx.profiles` in `infra/docker-compose.yml`
   and the profiles the deploy actually passes (`scripts/deploy-prod.sh`). Absent ⇒ it contributes 0.
2. **Does nginx append?** Confirm `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;` is
   present on the `location` block serving `/api/`. Present ⇒ **+1**.
3. **What sits in front of nginx?** A `traefik.http.routers.*` label on the `nginx` service means
   Traefik terminates and forwards ⇒ **+1**. Repeat for any further proxy (a CDN, a load balancer)
   that both terminates and appends.
4. `N` = the sum. Record the new value **in this ADR**, in `D2`, with the date and the evidence — not
   in a comment beside the code.
5. **Then verify it empirically, because steps 1–4 are a claim and only a header is an observation.**
   Issue a request from a known client address to a known endpoint and read the `X-Forwarded-For` the
   API actually received. If the observed depth disagrees with the derived `N`, the observation wins
   and `D4` applies until the disagreement is understood.

### D8 — The unrecognised-role fallback records a Keycloak-internal role, and that is a *kept* decision

When the caller holds none of the four realm roles, `deriveAuditProvenance` returns
`{ actorRole: realmRoles[0] ?? null, portal: null }` — so an operator whose token carries only
`offline_access` / `uma_authorization` is attributed **`offline_access`**, and
`apps/api/src/modules/alerts/alerts.controller.spec.ts` has pinned exactly that since `S-E06-6`.

Recorded rather than silently inherited by the nine privileged write sites `S-E04-1` moves onto this
seam, because it sits in tension with `D4`: Keycloak does not promise a stable order for
`realm_access.roles`, so the stored string is *arbitrary* rather than *absent*. It is **kept
unchanged** for two reasons. First, `portal` is already `null` on that branch, so the row is not
mistaken for a portal action — the misleading half of the field pair is already honest. Second, the
alternative (`actorRole: null`) discards the one piece of evidence available about an unexpected
caller, and an unexpected caller reaching a privileged write is exactly the row an auditor most wants
to see something in. What `D4` forbids is a **plausible-looking** value; a raw Keycloak role name is
visibly not a portal role, so it reads as the anomaly it is.

If a later slice disagrees, the change is one line plus the one asserting spec — but it must be made
here, in writing, not as a refactor.

## What this ADR does **not** establish

- **Traefik's own forwarded-headers configuration.** It runs from `/root/docker-compose.yml` on the
  VPS, outside this repository, and was not read. `N = 2` is pinned on the *deployment shape* — two
  terminating proxies, evidenced above — **not** on Traefik's source. If that Traefik does not
  overwrite `X-Forwarded-For` arriving from an untrusted source, a caller can inject a leading entry
  that `N = 2` will faithfully resolve and store.
  **This is the decisive reason the field stays `null` until `S-E04-3` forwards it from a seam we
  control**, and it is why `D3` requires a refusing configuration key rather than a literal: an
  operator who changes the edge must be forced to restate `N`.
- **Any claim that the audit IP is correct today.** It is not written at all. `S-E04-1` writes this
  decision and the derivation seam; nothing in it makes `ipAddress` or `userAgent` non-null.
- **`trust proxy` being set anywhere.** `S-E04-1` sets it nowhere. `apps/api/src/main.ts` is unchanged
  by the story that ships this ADR.
- **A retention or legal-hold posture** for provenance data (`D-08`-adjacent; `R-13` forbids this
  routine authoring policy text).

## Consequences

**Good.**

- The precedent exists **before** the ~20 call sites inherit it, which was the whole point of ordering
  the decision first (`plan.md` §2). A later author who reaches for `req.ip` has a written refusal to
  read rather than a convention to guess at.
- `null` is now a *specified* value with a stated meaning, so a reviewer reading a blank
  `ipAddress` learns the correct thing from it.
- `D5` makes the provenance helper pure, so `DNC-10` is testable as an absence — no env read, no
  header read, no string comparison — rather than as a promise.

**Costs, accepted.**

- Two `N` values for two topologies is more to carry than one constant. The alternative — one literal —
  is silently wrong in one of them, which `D3` exists to prevent.
- `S-E04-3` is a genuinely wider diff (`apps/web`, `infra/nginx`, `apps/api` in one review) because
  this ADR refuses the one-line version of the fix. That is the intended trade.
- Provenance stays blank on `/admin/audit` until `S-E04-3` lands. Stated in-product, not hidden.
