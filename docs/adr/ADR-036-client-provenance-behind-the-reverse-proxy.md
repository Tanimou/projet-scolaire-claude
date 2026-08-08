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

### D9 — The forwarder declares itself with a shared token, and the asymmetry is the whole argument

*Added 2026-08-08 by `S-E04-3`, the implementing story, per this ADR's own instruction to record
rather than comment. This is a genuinely new cross-cutting trust primitive: until now the only
credential crossing the app boundary was the Keycloak-issued JWT (`ADR-004`). It is amended into this
ADR rather than minted as a separate one, because the subject matter is identical — client provenance
behind the reverse proxy — and splitting one decision across two registers is the drift `PF-110`'s
precedence rule exists to prevent.*

`apps/web` attaches three headers to every API call it makes on an operator's behalf:
`x-pilotage-client-ip`, `x-pilotage-client-user-agent`, `x-pilotage-forward-token`. The API's single
extraction seam (`apps/api/src/shared/audit/client-hints.ts`) applies one rule, in this order:

1. **Any** pilotage header present ⇒ a forwarder claims to be in the path. Then, and only then: if a
   token is configured **and** the presented token matches it under a constant-time comparison of
   sha256 digests, the forwarded pair is taken. Otherwise **both** fields are `null`. On this branch
   the seam never consults `req.ip` **or `x-real-ip`** — the second is named explicitly because nginx
   sets it on every request including the production web→api hairpin, so an `x-real-ip` fallback would
   store the relay's address through the very seam written to prevent that (`D4`).
2. No pilotage header ⇒ nobody claims anything, so the address is `req.ip` under the pinned `N` and
   the user-agent is the request's own.

**Why this is not the blanket trust `D1` refuses.** An absent or wrong token can only make provenance
**more null, never less**. It relaxes no check, grants no access, resolves no tenant and derives no
role, and it cannot cause a value to be recorded that would otherwise be blank. `D1`'s refused design
is the opposite: it lets any caller **choose** the recorded value.

**The residual, stated in both halves rather than hidden.**
- *Outsider.* A caller can send a garbage token to force **its own** row to `null` — a downgrade to
  honest-unknown, the safe direction, visible to an auditor as an absence rather than as evidence.
- *Insider.* Anyone who can read the web container's environment can mint the token and forge an
  arbitrary provenance. The asymmetry above is true for an outsider and **not** true for an insider
  with environment access: this reinstates `D1`'s refused property, now gated on secret custody rather
  than absent. It is accepted because the alternative — blanket `X-Forwarded-For` — is forgeable by
  *everyone*, and because the production topology makes the exposure concrete: `NEXT_PUBLIC_API_URL`
  is `${PUBLIC_BASE_URL}`, so the web→api call hairpins through the public edge and the header pair is
  therefore accepted from the internet. The token is the only thing between an outsider and a forged
  row. Stated, not discovered.

**Shape constraints that are load-bearing, not cosmetic.**
- **Hyphens, never underscores.** nginx drops headers containing underscores by default
  (`underscores_in_headers off`), so `x_pilotage_client_ip` would be silently stripped and every
  production row would blank with no error anywhere. `infra/nginx/conf.d/pilotage.conf` needs **no
  edit**: `location /api/` sets only `Host` / `X-Real-IP` / `X-Forwarded-For` / `X-Forwarded-Proto`
  and passes all other client headers through unchanged.
- **`AUDIT_FORWARD_TOKEN` is OPTIONAL**, and that asymmetry against `TRUST_PROXY_HOPS` is deliberate.
  A wrong hop count is *silently wrong*; an absent token is *fail-safe*. Requiring it would stop an
  operator who has not yet distributed the secret from booting at all — the exact pressure that
  produced `PF-54`'s `?? 'admin'`. Compose therefore carries `${TRUST_PROXY_HOPS:?…}` (refusing) and
  `${AUDIT_FORWARD_TOKEN:-}` (permissive-empty). Getting these two forms the wrong way round inverts
  both decisions.
- **Never `NEXT_PUBLIC_*`.** Next inlines those into the browser bundle, which would publish the
  secret to every visitor.
- **The token is never authentication.** It is read from configuration in exactly one place
  (`main.ts`), held only as a digest, never logged, never echoed, never attached to a span. A request
  carrying a valid token and no valid `Bearer` is still `401`, and the seam is structurally
  unreachable from the guard chain (no file under `shared/auth/`, no `*.guard.ts`, no `*.strategy.ts`
  imports it).
- **Rotation is a silent all-null window.** Updating the api before the web blanks every row until
  both restart — the safe direction, and invisible, so the API logs once at boot whether a token is
  configured (never its value).

### D10 — What `S-E04-3` shipped, and two corrections to this ADR's own text

*Added 2026-08-08 by `S-E04-3`.*

- **The configuration key.** `TRUST_PROXY_HOPS`, added to `REQUIRED_ENV` so an absent key is named at
  boot by the same one-shot message as the three Keycloak keys, and parsed by `parseTrustProxyHops`
  (`apps/api/src/shared/config/trust-proxy.ts`): `/^\d+$/` after a trim, **bounded** by
  `MAX_TRUST_PROXY_HOPS = 2`, throwing `InvalidConfigError` by name and by *shape* — never the value.
  `D3`'s forbidden `Number(process.env.TRUST_PROXY_HOPS ?? 2)` appears nowhere, in any spelling.
  The bound is part of the decision, not tidiness: `TRUST_PROXY_HOPS=99` is operationally identical to
  `trust proxy: true` on every real chain, so an unbounded strict parse would ship the blanket trust
  `D1` refuses, through the key `D3` required.
- **The SECOND configuration key, and why there are two.** `WEB_TRUST_PROXY_HOPS` counts the relays in
  front of **Next**, not in front of the API. It is a distinct key rather than a reuse of
  `TRUST_PROXY_HOPS` because the two paths are not the same depth, and because in production
  `NEXT_PUBLIC_API_URL` is the *public* origin (`infra/docker-compose.prod.yml`) — the web seams call
  the API back out through Traefik → nginx, so the two counts are independent facts about two chains.
  One shared literal would have been silently correct in one of them and silently wrong in the other,
  which is `D3`'s argument applied a second time. Values: `W = 0` local (`--profile app`: nginx carries
  `profiles: ["prod"]`, so no L7 relay is in front of Next and every observed `x-forwarded-for` is
  client-written and discarded), `W = 2` prod (Traefik → nginx → web; `location /` does set
  `X-Forwarded-For`). Bounded by `MAX_WEB_TRUST_PROXY_HOPS = 2` for `D1`'s reason: nobody disables this
  with a `SKIP_*`, they write `99`.
- **The web reader warns and falls back to `0` where the API refuses to boot — a deliberate deviation
  from `D3`, and the declaration form is what pays for it.** A throw in `webTrustProxyHops()` would
  happen while *rendering a request*, so the whole page would 500; the API's throw happens at boot. The
  fallback is the safe direction (`0` = trust no hop = an honest blank, never a relay address), so it
  cannot record a wrong value — but it is **invisible**, and that is the failure mode `S-E04-3` actually
  shipped: the key was declared in **exactly one file, the source that reads it**, so
  `x-pilotage-client-ip` was never emitted in any containerised deployment, `AuditLog.ipAddress` stayed
  `NULL` on every UI-driven write, and the only signal was a single `console.warn`. A feature delivered
  inert is not caught by any gate that watches for wrongness. The correction is therefore *not* to make
  the reader throw: the key is declared in the **refusing** `${WEB_TRUST_PROXY_HOPS:?…}` form on the
  `web` service of **both** compose files, plus `.env.example` (`0`) and `.env.prod.example` (`2`), so
  the failure lands in the operator's terminal at the compose command, where it costs nothing. It is
  declared on the `web` **service**, never on the shared `x-app-env` anchor, where it would also reach
  `migrator` and `seed` — services that render no page and can claim no client. Parity is held by
  `apps/api/src/shared/quality/trust-proxy-dnc10-gate.spec.ts`, whose rule is stated as *« declared in
  a file other than the one that reads it »* — the shape of the defect, not the instance.
- **One applier, one seam.** `applyTrustProxy(app, env)` is called by `main.ts` **and by the supertest
  harness**, so the test proves the artefact that ships rather than a re-implementation of it.
- **`D4` gained a case Express cannot express.** A numeric `trust proxy: N` **pads**: given a chain
  *shorter* than `N`, `proxyaddr` runs out of trusted hops and returns the leftmost — caller-chosen —
  entry with full confidence. `D4` already ruled that a shorter chain yields `null`; the seam now
  counts the observed chain depth to enforce it. The forged-beyond-`N` case and the
  forged-short-chain case are different failures and only the first is handled by Express.
- **`PF-128` — this ADR's Context table was incomplete.** It named `apps/web/src/lib/api-client.ts` as
  *the* server-side seam. `apps/web` has **two**: the second is
  `apps/web/src/app/api/proxy/[...path]/route.ts`, the route handler through which client components
  (including every teacher- and parent-portal one) reach the API. A one-seam fix would have left every
  client-component-driven audited write blank forever, silently, while the change claimed provenance
  was real. Both seams forward, through one shared helper. Measured, then the document corrected —
  not inherited (`R-30`).
- **`D6` revisited, and `azp` is still NOT adopted.** `S-E04-3` was named as the natural place to
  revisit it; it was, and the answer is no. This slice makes the *client* provenance real — an
  observation of the transport — while `azp` is an observation of the OIDC client; adopting it in the
  same diff would couple two unrelated corrections and would still need the role mapping as its
  fallback. `portal` remains an attribution, stated.
- **`D7` step 2 is wrong as written and is corrected here.** It says "the `location` block serving
  `/api/`". There are **two**: `infra/nginx/conf.d/pilotage.conf`'s `location /api/` sets
  `X-Forwarded-For`, and `location /api/v1/notifications/stream` sets **no** forwarded headers at all
  (only `Connection`, buffering and timeout), so the chain on that path is one hop shallower. SSE is a
  read and writes no audit row today, so no stored value is affected — but the re-derivation procedure
  must read **every** `location` matching `/api/`, not one.
- **`D7` step 5, the empirical half, is owned by the implementing PR**, not by this file: whether
  Next.js 15 populates `x-forwarded-for` on the incoming request in this stack is a claim until a
  header is observed. Where no valid client address can be read, nothing is forwarded, the API stores
  `null`, and `/admin/audit` says so. An honest blank satisfies `AC-8`; a plausible value does not.

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
  *(**Corrected 2026-08-08 by `S-E04-1`'s implementing story.** This bullet was true of `S-E04-1` and
  is false as of `S-E04-3`, which forwards both fields from `apps/web` and stores them. It is left
  standing with its correction rather than deleted, because the next reader needs to know the claim
  existed and when it stopped being true — `D7` step 4's instruction to record rather than overwrite.
  See `D9` and `D10` below for what actually shipped.)*
- **`trust proxy` being set anywhere.** `S-E04-1` sets it nowhere. `apps/api/src/main.ts` is unchanged
  by the story that ships this ADR.
  *(**Corrected 2026-08-08.** Also false as of `S-E04-3`: `apps/api/src/main.ts` now calls
  `applyTrustProxy(app, process.env)` exactly once, and `apps/api/src/shared/config/trust-proxy.ts` is
  the only file in `apps/api` that calls `app.set('trust proxy', …)`. `audit-provenance-gate.spec.ts`'s
  `AC-11` case, which used to assert this absence, was **inverted rather than deleted** — it now
  asserts the presence of the delegating call and the absence of any literal, `true` or `'*'`.)*
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
