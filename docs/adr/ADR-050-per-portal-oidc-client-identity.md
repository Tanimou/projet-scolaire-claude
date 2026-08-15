# ADR-050 — A portal's OIDC client id is a function of the portal alone: the fourth client exists, the alias is deleted, and the wildcard that hid the collapse is refused

- **Status**: `accepted` — the fourth confidential client, the single shared accessor, the deletion (not the emptying)
  of the alias map, and the refusal of the cross-portal callback wildcard are decided. What this ADR does **not**
  decide is the student *identity* provisioning story (`PF-210`), the invite path (`PF-211`), or anything a live
  Keycloak must confirm (`VAL-04`, §D6).
- **Date**: 2026-08-15
- **Story**: `S-E01-4a` (epic `V3-E01`), closing `PF-18`, recording `PF-209`–`PF-214`.
- **Relates to**: `ADR-004` (1 realm / N clients — this restores the per-portal invariant for the **fourth** portal) ·
  `ADR-003` (portals as route prefixes) · `ADR-015` (permission model — authorization still rests on the realm role,
  never on `client_id`).
- **Amends in place**: `ADR-021` §Decision *"Reuse the `portal-parent` OIDC client (no fourth client)"*,
  §Rejected alternatives (the *"A fourth Keycloak OIDC client (`portal-student`)"* bullet) and §Consequences. Those
  three anchors carry an inline `superseded by ADR-050` note; the two files must not be allowed to disagree.
- **Number**: `050`. `049` is the highest on `main`; the open pull requests are Dependabot bumps claiming no ADR and
  no finding id (`TOOL-30` anti-recurrence check).

---

## Context — what reuse actually cost, which is not what ADR-021 predicted

`ADR-021` decided the student portal would **reuse** the `portal-parent` confidential client, with a
`KEYCLOAK_STUDENT_CLIENT_ID` env escape hatch, and named the accepted cost precisely: *per-portal login telemetry is
deferred for the student audience only*. That trade was reasoned and the reasoning it rested on is **still true** —
authorization is gated by the `student` realm role and the portal+role middleware, never by `client_id`.

The audit found a corollary ADR-021 did not anticipate, and it is not about telemetry:

1. **The redirect registration became unstatable.** NextAuth emits `/api/auth/callback/keycloak-student` for the
   student provider and the reset flow returns to `/student/login`. `portal-parent` registers neither
   (`realm-export.json`), so on the artefact that provisions the realm, student SSO and student password reset are
   both refused `invalid_redirect_uri`.
2. **Every attempt to state it widened a *different* client.** On the Hostinger deployment,
   `infra/kc-prod-redirects.mjs` bound `'portal-parent': ['parent', 'student']` and PUT
   `${BASE}/api/auth/callback/*` onto **every** portal client. Student login "worked" — through a cross-portal
   wildcard nobody wrote down, which simultaneously made `portal-admin` a valid target for the parent callback and
   vice versa (`PF-209`). Production was not broken; production was fixed by exactly the shape this ADR forbids.
3. **The security half was never deferred, only invisible.** A student's token carried `azp: portal-parent`. **No
   audience or `azp` check can distinguish a student from a parent.** That is why the audit graded `PF-18`
   `BROKEN_SECURITY` and not `BROKEN_LINK`.
4. **The rule had two copies inside `apps/web` and they had already diverged.** `auth.ts` honoured the
   `KEYCLOAK_STUDENT_CLIENT_ID` override; `PortalLoginForm.tsx` carried a second hard-coded
   `portal-${portal === 'student' ? 'parent' : portal}` literal and did not. An operator who took the documented
   escape hatch got a login on the new client and a password-reset link still pointing at the old one, **silently**.

---

## Decision

### §D1 — every portal gets its own confidential client

`infra/keycloak/realm-export.json` declares `portal-student` alongside `portal-admin`, `portal-teacher` and
`portal-parent`, derived field-for-field from `portal-parent` (same flags, same `pkce.code.challenge.method`, no
`protocolMappers` — because none of its siblings has one), with the student redirect URIs and
`secret: "change-me-portal-student"`. `roles.realm` gains `student`, which `auth.ts`'s
`REALM_ROLES_FOR_PORTAL.student` has required since E8-S1 and which no export ever declared (`PF-210`).

The invariant: **a client id is a function of the portal alone.** `azp`/`aud` must be able to distinguish four
audiences. ADR-021's argument — that authorization rests on the realm role — remains correct and is **not** what is
overturned here; what is overturned is the corollary that reuse was therefore free.

Correspondingly, `infra/kc-prod-redirects.mjs` binds **exactly one** portal segment per client and *refuses to
provision* (exit 1) if that ever stops being true, rather than trusting the literal to stay correct.

### §D2 — the client id is computed server-side and passed as one prop; `NEXT_PUBLIC_*` is rejected

`apps/web/src/lib/keycloak-clients.ts` is the single module composing a `portal-` client id. It is modelled on
`apps/web/src/lib/portals.ts`: import-free apart from the `PortalId` type, edge-safe, and **`process.env`-free** — the
env is a *parameter* of `resolvePortalClientId`, never read from inside. Both seams call it: `auth.ts` (login, ROPC,
refresh) and the four `login/page.tsx` **server** components, which pass `resetClientId` into the `'use client'`
`PortalLoginForm`.

`NEXT_PUBLIC_KEYCLOAK_*_CLIENT_ID` was rejected: Next inlines those at **build time**, so a value set at deploy time
lands in the bundle as `undefined` — a divergence with a nicer shape than the one being deleted — and it would mean
four new public variables to keep in step with four private ones, for no benefit, since the reset URL needs only the
client id.

**The client secret never enters the shared module and never reaches the browser.** It stays a server-side
`process.env['KEYCLOAK_<PORTAL>_CLIENT_SECRET']` read inside `auth.ts`, whose dev fallback is *derived* from the
resolved id (`change-me-<client id>`) — the same literal the export ships — rather than being a second hand-maintained
list.

### §D3 — the alias map is deleted, not emptied

`CLIENT_PORTAL_OVERRIDE = { student: 'parent' }` is **removed, mechanism included**. An emptied
`Record<Portal, Portal>` still *types a cross-portal entry as legal*: it is `PF-18` waiting at a new address, and a
future portal can fall into it silently. The legitimate need it served — an operator promoting a portal to a different
client — is fully served by `KEYCLOAK_<PORTAL>_CLIENT_ID`, which resolves to an **operator-chosen id, never to another
portal's**.

**Rollout consequence, stated because it is the highest risk of the slice.** `realm-export.json` provisions a realm at
**first import only**. On an already-provisioned realm (Hostinger), `portal-student` does **not** appear on deploy, and
once `auth.ts` stops aliasing, student login moves from "works via the wildcard" to **`invalid_client`**. The operator
must create `portal-student` (or re-import the realm) **before or with** the deploy. An operator who cannot yet do so
can set `KEYCLOAK_STUDENT_CLIENT_ID=portal-parent` in `.env` and get today's behaviour back **as configuration —
deliberate and visible**, which is strictly better than an invisible alias in code. `.env.example` says exactly this,
in French, next to the two new variables.

### §D4 — the cross-portal callback wildcard is refused

A `redirectUris` entry that wildcards the `/api/auth/callback/` segment makes **every** portal client a valid target
for **every** portal's callback. At the realm, that is indistinguishable from the defect this ADR closes.
`kc-prod-redirects.mjs` therefore emits the two exact callback paths per portal —
`/api/auth/callback/keycloak-<portal>` (the live provider id) and the legacy `/api/auth/callback/<portal>` (`PF-214`) —
instead of `${BASE}/api/auth/callback/*`. It also no longer treats a missing client as a benign skip: an absent
`portal-student` is counted as a failure, because "skipped" is how the previous run of this script left the student
portal unprovisioned and said nothing (`DNC-08`).

### §D5 — the executable gate lives in `scripts/`, not in `apps/web`

`apps/web` has **no unit runner**: its `package.json` declares `test:e2e` (Playwright) and nothing else, and that
runner's `webServer` starts `pnpm dev`, which agents may not run. `scripts/ci-gate.sh:199` already records this
(`PF-129`/`PF-133`). The house discharge is a `scripts/<name>-check.js` wired into `ci-gate.sh` TIER 1 — exactly how
`csv-escape-check.js` already covers `apps/web` source. The deviation from the brief's letter is named here rather
than silently relocated. **Status: not yet shipped.** `scripts/keycloak-client-check.js` and its `ci-gate.sh` stage
remain open work for the next slice (`S-E01-4a` AC-6/AC-7); until it exists, the invariants above are enforced by
construction (one accessor, one client per portal, an exit-1 refusal in the provisioner) but not ratcheted.

### §D6 — the honest limit

The Docker engine on this host is DOWN (`TOOL-19`), so **no live Keycloak can be started** and **`VAL-04` (production
Keycloak client / redirect / audience review) CANNOT be discharged against a running server**. Everything decided above
is evidence about the **artefact** (`infra/keycloak/realm-export.json`, `infra/kc-prod-redirects.mjs`) and about the
**code** — legitimate, since the export is the file that provisions the realm — but it is **NOT** the same claim as
"a real Keycloak accepted this redirect".

What a live run must still prove, and nothing here proves: (1) a real Keycloak imports the amended export and
materialises `portal-student` with its four flags and three redirect URIs; (2) `signIn('keycloak-student')` completes
the authorization-code round trip; (3) the minted token carries `azp: "portal-student"` — the security half, and the
only assertion that distinguishes this fix from the forbidden one; (4) the `reset-credentials` link is accepted;
(5) the **running** Hostinger realm no longer holds the `/api/auth/callback/*` wildcard after the corrected
provisioner runs (`PF-209`).

---

## Rejected alternatives

- **Add `/student/*` and `/api/auth/callback/keycloak-student` to `portal-parent`'s redirect list.** This is the
  wrong fix and the reason the gate must name it: the symptom disappears, `azp` stays collapsed, and a green light
  sits over an unfixed `BROKEN_SECURITY`. It is also what production had already done, twice over (`PF-209`).
- **Keep the alias map but empty it.** §D3 — an empty `Record<Portal, Portal>` still types the defect as legal.
- **Read `KEYCLOAK_STUDENT_CLIENT_ID` inside the shared module.** The module is reachable from a `'use client'`
  component; `process.env` there is either inlined at build time or `undefined`. Passing `env` as a parameter keeps
  the module edge-safe and lets a gate drive the *production accessor* under fixture envs instead of re-typing the
  rule.
- **Put the module in `packages/contracts`.** That package builds to CJS and is shared with the api/worker runtimes,
  neither of which has any use for a Next route or an OIDC client id — and its own `PORTALS` still declares three
  portals (`PF-101`). Same reasoning as `portals.ts`.
- **Invent a demo student in the realm export.** Minting a learner identity means deciding a password, a tenant and a
  `Student.userProfileId` link — that is ADR-021's provisioning story, recorded as `PF-210`, not this one.
- **Edit `infra/docker-compose.yml` to add `KEYCLOAK_STUDENT_CLIENT_ID`/`_SECRET`.** A compose edit changes what a
  container boots with, and this slice must not move the deployment. It is safe to defer precisely because `auth.ts`'s
  secret fallback is *derived* (`change-me-portal-student`) and matches the export's literal; recorded in the rollout
  note.

## Consequences

- **+** Four audiences, four clients: `azp`/`aud` can finally distinguish a student token from a parent token, which
  is the security half of `PF-18` and the only part that was never merely cosmetic.
- **+** One accessor, so the login seam and the reset-link seam **cannot** diverge under the documented env override —
  the divergence was real, not hypothetical.
- **+** The production provisioner refuses the two-portals-one-client shape instead of re-asserting it on every run.
- **−** A **deploy-ordering hazard**: an existing realm needs `portal-student` created before the app half lands, or
  student login returns `invalid_client`. Mitigated as configuration (§D3), not hidden.
- **−** A freshly imported realm still cannot log a student in, for a **second and independent** reason: the `student`
  realm role now exists but **no identity holds it** (`PF-210`). The reason is now *named* rather than masked by the
  client defect.
- **−** The rule is still written outside `apps/web` in two more places: `infra/kc-fix-redirects.mjs`'s hard-coded
  three-client list (`PF-214`) and `apps/api`'s `PORTAL_CLIENT_ID` / `InviteUserDto.realmRole` enum (`PF-211`).
  Both are out of this slice's file set and both are recorded with owners.
- **Honest limitation:** see §D5 — the ratchet that would keep all of this from regressing
  (`scripts/keycloak-client-check.js`) is specified and not yet built.

## Evidence

- `apps/web/src/lib/keycloak-clients.ts` — `portalClientId`, `portalProviderId`, `portalCallbackPath`,
  `portalLegacyCallbackPath`, `portalResetRedirectPath`, `PORTAL_CLIENT_IDS`, `resolvePortalClientId(portal, env)`;
  no alias map, no `process.env` read, no secret.
- `apps/web/src/auth.ts` — `CLIENT_PORTAL_OVERRIDE` deleted; `clientCreds` calls `resolvePortalClientId`;
  `PORTAL_FROM_PROVIDER` derived from `portalProviderId`; the secret read stays local.
- `apps/web/src/components/PortalLoginForm.tsx` + the four `app/<portal>/login/page.tsx` — the hard-coded literal
  deleted, `resetClientId` computed server-side and passed as a prop.
- `infra/keycloak/realm-export.json` — `portal-student` client + `student` realm role.
- `infra/kc-prod-redirects.mjs` — one portal per client, exact callback paths, exit-1 on a multi-portal binding,
  missing client counted as a failure.
- `.env.example` — `KEYCLOAK_STUDENT_CLIENT_ID` / `_SECRET` + the French rollout note.
- `docs/adr/ADR-021-student-role-and-self-abac.md` — amended in place at three anchors.
