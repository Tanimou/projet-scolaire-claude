# ADR-052 — The per-portal OIDC client ratchet DERIVES its expectation by executing the production accessor, fires unconditionally in the fast tier, and leaves VAL-04's live half unexecuted

- **Status**: `accepted` — **flipped from `proposed` at land, 2026-08-15, by the tech writer**, together with the
  §D4 amendment and the filled §Evidence below. It was written by the Architect in Phase 1 of `S-E01-4b` so the
  implementing agents would not re-decide the derivation mechanism ad hoc. A cited-but-absent — or, worse, a
  cited-but-*contradicted* — ADR is the `TOOL-30` disease, and run 61 already shipped one dangling `ADR-051`
  citation. **Two things in the original text were falsified by what actually shipped, and both are corrected in
  place rather than left for a reader to discover from the code: §D4's trigger (the stage shipped unconditional)
  and the title's claim about `VAL-04` (its live half never ran).**
- **Date**: 2026-08-15
- **Story**: `S-E01-4b` (epic `V3-E01`), completing `ADR-050` §D5 and §D6, **advancing but NOT discharging** `VAL-04`,
  recording `PF-221`, `PF-222`, `PF-223`, `PF-224` (all four now carry rows in
  `docs/daily-improvement-v3/traceability/OPEN.md`; before land they were cited here and in the probe and existed in
  no ledger).
- **Relates to**: `ADR-050` (per-portal OIDC client identity — this ADR builds only its *ratchet* and its *live
  proof*; every invariant is ADR-050's) · `ADR-004` (1 realm / N clients) · `ADR-027` (a gate that cannot run must
  FAIL, never skip) · `ADR-039` (hermetic spec writers) · `ADR-045` (a blocking stage is wired only after a measured
  determinism bar).
- **Number**: `052`. `051` is the highest on `main` (measured this run: `docs/` names `PF-220`, `TOOL-34`, `ADR-051`
  as high-water marks; the open PRs are Dependabot bumps claiming no ADR and no finding id).

---

## Context — what ADR-050 left open, and why the obvious ratchet is blind

`ADR-050` §D5 already decided **where** the ratchet lives (`scripts/<name>-check.js` + a `ci-gate.sh` TIER-1 stage,
because `apps/web` has no unit runner) and recorded it as *not yet shipped*. That part needs no new decision. Three
things do.

**1. A gate that reads the accessor's constants cannot see the defect it exists for.** The invariant is
"a client id is a function of the portal alone". The cheapest derivation — parse
`apps/web/src/lib/keycloak-clients.ts` with `require('typescript')` and lift `CLIENT_ID_PREFIX = 'portal-'`, the way
`scripts/csv-escape-check.js` and `scripts/audit-write-check.js` lift declarations — reproduces `portal-<id>` from the
prefix and passes. But `PF-18`'s actual shape was an alias **inside the function body**
(`student → parent`). Reintroduce it as `` return `portal-${ALIAS[portal] ?? portal}` `` and the prefix constant is
untouched, the derived expectation is untouched, the export is untouched, and the gate is **green over a restored
`BROKEN_SECURITY`**. Parsing is the house convention and it is the wrong tool here: the rule is *behaviour*, not a
literal.

**2. Derivation makes a check blind in a second, subtler way.** If both sides of the comparison are derived from the
same accessor, an accessor regression moves them **together**. With `student → parent` restored, a check that asks
only "does portal *p*'s client exist in the export?" finds `portal-parent` for both `parent` and `student` and passes.
Deriving is still right — a re-typed expectation is the second hand-maintained list `PF-18` *was* — but derivation
alone is not sufficient. What makes it bite is asserting a **bijection**.

**3. The stage the brief specifies would land in the wrong tier.** `scripts/ci-gate.sh:207` defines
`CODE_RE='^(apps/|packages/|scripts/|prisma/|package\.json|…)'` and `:209` wraps every tier-2 stage in it.
`infra/keycloak/realm-export.json` matches **none** of it. A stage placed inside that block would not run on a diff
that edits only the realm export — the hole in a new costume.

The measured hole this slice exists to close is confirmed, not assumed: `ci-gate.sh:330` defines
`GATE_MACHINERY='^(scripts/|\.github/|infra/|apps/api/src/shared/quality/)'` and `:331-336` runs the full api ratchet
only on a match, else `--skip src/shared/quality/`. `apps/web/src/lib/keycloak-clients.ts` and `apps/web/src/auth.ts`
match neither, so `apps/api/src/shared/quality/keycloak-client-identity-gate.spec.ts` — the only executable statement
of ADR-050's invariants — **does not run on a fast-tier PR that edits the accessor itself**.

---

## Decision

### §D1 — the check EXECUTES the production accessor; it does not parse it

`scripts/keycloak-client-check.js` obtains `portalClientId`, `portalProviderId`, `portalCallbackPath`,
`portalLegacyCallbackPath` and `PORTAL_IDS` by **transpiling and evaluating** the two production modules
(`apps/web/src/lib/keycloak-clients.ts`, `apps/web/src/lib/portals.ts`) with the root `typescript` devDependency
(`ts.transpileModule`, CommonJS target) inside a `node:vm` context whose `require` shim resolves **exactly one**
specifier, `./portals`. Any other specifier is a hard failure.

This is a deliberate departure from the `csv-escape-check.js` / `audit-write-check.js` convention of *parse, never
execute*, and §Context 1 is the measured reason. It is only admissible because the two modules are **contractually
inert** — no import beyond the `PortalId` type, no `process.env` read (env is a *parameter* of
`resolvePortalClientId`, ADR-050 §D2), no side effect, no secret — and the check **asserts that inertness before it
evaluates**: an import list beyond `./portals`, or a `process.env` reference, is a FAILURE, not a reason to fall back
to grepping. The inertness ADR-050 §D2 already requires for edge-safety is what makes the module safe to run inside a
gate; if a future edit breaks it, this gate is the first thing that says so.

### §D2 — the assertion is a BIJECTION portal ↔ client, plus a vacuity floor

Three rules, in this order, because only their conjunction survives §Context 2:

- **injective** — two portals resolving to the same client id is a FAILURE (this is what an in-body alias trips);
- **total** — every portal's client exists in the export, with all three of its redirect URIs
  (`/<portal>/*`, `/api/auth/callback/keycloak-<portal>`, the legacy `/api/auth/callback/<portal>`), each derived;
- **closed** — no `portal-*` client in the export is left unclaimed by a portal, and **no client of any kind**
  (`api-backend` included, which carries no `redirectUris` at all and must not crash the walk) registers a URI
  belonging to another portal. The last rule is `ADR-050`'s forbidden repair, refused **by name**.

**Vacuity floor (`DNC-08`).** The check carries the four portal ids `admin`, `teacher`, `parent`, `student` as a
declared **floor** and fails if the accessor's domain no longer covers them. This is the one literal it is allowed to
hold and it is not a second copy of the rule: deleting `'student'` from `PORTAL_IDS` would otherwise shrink the
check's domain to three portals and pass over a deleted portal. Precedent and the same reasoning:
`MIN_SANCTIONED_ESCAPERS` in `scripts/csv-escape-check.js`.

### §D3 — the wildcard rule is scoped to the callback segment, NOT to every URI

`ADR-050` §D4 forbids a wildcard **under `/api/auth/callback/`**, and forbids a wildcard whose prefix reaches another
portal's paths (`/*`, `/api/auth/callback/*`). It does **not** forbid `http://localhost:3000/<portal>/*`, which every
one of the four clients carries at `HEAD` (measured) and which is what makes SSO and the `reset-credentials` return
work. A check written as "no wildcard anywhere in a redirect URI" is **red on `HEAD`**, and the only ways back to
green are to weaken the check or to strip the realm — both worse than the defect. Stated here because the brief's
`AC-1` says "NO wildcard anywhere" and that phrasing, taken literally, is measurably wrong.

### §D4 — the stage sits in TIER 1, above `CODE_RE`, and it fires UNCONDITIONALLY (amended at land)

> **⚠️ AMENDED 2026-08-15 AT LAND. Read this box before the paragraph under it.** As originally decided, §D4 gave the
> stage its own trigger, `KEYCLOAK_IDENTITY_RE`, quoted below. **The stage that shipped has NO trigger: it runs on
> every invocation of `scripts/ci-gate.sh`, like its unconditional neighbours `audit-write-check` and
> `csv-escape-check`.** The trigger is therefore **REJECTED, not merely unimplemented** — do not "restore" it.
>
> **Why the shipped choice, stated against §D4's own trigger and not against a straw man.** Three reasons, in order
> of weight. (1) **A trigger is a skip surface, and this stage is cheap enough not to need one**: measured on this
> host at land, `node scripts/keycloak-client-check.js` completes in **1.542 / 1.563 / 1.563 s**, no Docker, no
> database, no build — the same order as the unconditional stages already beside it. (2) **A trigger is one more
> hand-maintained list of paths that must stay in step with a derivation whose whole thesis is "no hand-maintained
> lists"**; `KEYCLOAK_IDENTITY_RE` enumerates six path shapes, and the fifth file that can regress `PF-18` would have
> to be remembered into it. (3) The failure mode §D4 was written to avoid — "a stage copied onto the trigger above
> would not run on the very diff it protects" — is *removed*, not merely reduced, by having no trigger at all.
>
> **The `scripts/ci-gate.sh` comment at the stage argues the same conclusion from the wrong premise** (it defends
> unconditional placement against a *tier-2* stage that §D4 never proposed). The comment is wrong about what it is
> refuting; the decision it defends is the one recorded here. If you touch that comment, make it argue against
> `KEYCLOAK_IDENTITY_RE`, which is the alternative that actually existed.
>
> The **REJECTED** trigger, kept for the record so nobody re-derives it as new:
> ```
> KEYCLOAK_IDENTITY_RE='^(infra/keycloak/|infra/kc-[^/]*\.mjs$|apps/web/src/lib/keycloak-clients\.ts$|apps/web/src/lib/portals\.ts$|apps/web/src/auth\.ts$|scripts/keycloak-client-check\.js$)'
> ```

One `run_stage` in `scripts/ci-gate.sh`, **above** the `if changed_match "$CODE_RE"` block. Cite that block by its
identifier (`CODE_RE`, `GATE_MACHINERY`) and never by line number: this diff itself moved `GATE_MACHINERY` by +32
lines, and three artefacts written in the same diff ended up quoting two different numbers for one anchor.

`portals.ts` is inside the derivation for the same reason it is in the floor: it owns the domain the whole derivation
ranges over. The precedent for a stage that names the *identity seam* rather than inheriting a neighbour's trigger is
`ci-gate.sh`'s `tenant adversarial` stage, which was widened past `^apps/api/prisma/` for exactly this failure mode.
This ADR takes that lesson one step further: no trigger at all cannot be copied wrong.

No `--full`, no environment variable, no `--update`, no skip branch, no `continue-on-error` (`DNC-10`). The stage
is Docker-free and database-free, which is what entitles it to the fast tier (`ci-gate.sh:361` records that the fast
tier is deliberately Docker-free).

**`.github/workflows/ci.yml` gains the mirrored step in the same diff.** `ci.yml` re-lists stages and never invokes
`ci-gate.sh`, so a stage added only to the shell script never runs in CI; nineteen quality specs assert the two do not
drift (`S-E02-2` AC-4). This is not optional polish — it is the second half of the stage.

### §D5 — the live half is EVIDENCE, not a gate stage, and it runs against a standalone container

`VAL-04` points 1, 3 and 5 are discharged by a one-shot probe under `scripts/`, **not wired into any gate**.
Precedent: `scripts/restore-drill.js` and `scripts/trace-emission-probe.js` live in `scripts/` and appear in no stage
list. Three reasons, and the third is decisive: the fast tier is Docker-free by contract; a blocking stage requiring a
live Keycloak would be a flaky blocking stage, which `ci-gate.sh` itself calls worse than no stage; and the probe
**mutates a realm** (it creates and deletes an ephemeral user) — a merge gate must never mutate a running service.

**A standalone `quay.io/keycloak/keycloak:26.0 start-dev --import-realm` container, with
`infra/keycloak` bind-mounted read-only at `/opt/keycloak/data/import`, is the evidence host** — not the compose
stack. Derived, not preferred: compose's `keycloak` `depends_on: postgres`, whose published `${POSTGRES_PORT}`
collides with the native `postgresql-x64-15` service already listening on 5432, and the only ways out are to edit
`infra/docker-compose.yml` — which `ADR-050` explicitly rejected as "a compose edit changes what a container boots
with, and this slice must not move the deployment" — or to mutate untracked `.env`. The standalone container needs
neither, is disposable, and imports the *same* file through the *same* `--import-realm` code path, which is exactly
what `AC-5`–`AC-7` claim. Its admin credentials must be measured against the image, not copied from compose:
Keycloak 26 prefers `KC_BOOTSTRAP_ADMIN_USERNAME`/`KC_BOOTSTRAP_ADMIN_PASSWORD` where compose still sets the older
`KEYCLOAK_ADMIN`/`KEYCLOAK_ADMIN_PASSWORD`.

Every assertion is **read back from the running realm's admin API**, never from the file. The ephemeral student exists
only in the local realm and is deleted; `realm-export.json` gains no demo student (`PF-210`, `ADR-021`'s provisioning
story, out of scope).

### §D6 — `VAL-04` point 5 is re-scoped away from Hostinger, and the proof must plant the wildcard first

`VAL-04` point 5 reads "the **running** Hostinger realm no longer holds the `/api/auth/callback/*` wildcard". The
Hostinger VPS is an **audit fixture, never a target** (SKILL Step -1): no HTTP request, no deploy, no admin call. The
claim is therefore re-scoped to **"the corrected provisioner removes the wildcard from a real realm"**, proven
locally, and the residual — that the Hostinger realm is *believed* to still carry `PF-209`'s wildcard and that only an
operator can run the provisioner there — stays open and named.

The proof is only a proof if it can fail. Run against a freshly imported realm with
`PUBLIC_BASE_URL=http://localhost:3000`, `infra/kc-prod-redirects.mjs` is a **fixed point**: it writes back the three
URIs the export already declares, and "no wildcard afterwards" would be a statement about a no-op. So the probe
**first PUTs `${BASE}/api/auth/callback/*` onto the portal clients through the admin API — reproducing what the old
script emitted (`PF-209`) — reads it back to prove the realm is in the defective state, then runs the corrected
provisioner, then reads back its absence.** Fail-before / pass-after, executed, in the same shape `AC-4` demands of
the artefact controls.

### §D7 — `PF-221` and `PF-222` are recorded, and neither is fixed by editing a tracked file

- **`PF-221`** — local `.env` sets `KEYCLOAK_PORT=8180` and `KEYCLOAK_URL=http://localhost:8080`, and port 8080 on
  this host answers as EnterpriseDB. Tracked `.env.example:43` already reads `http://localhost:8180`, and
  `infra/docker-compose.yml` derives the URL from `${KEYCLOAK_PORT}` (`PF-86`). **The tracked tree is correct**; the
  desync is untracked operator state.
- **`PF-222`** — the brief reports no `KEYCLOAK_STUDENT_CLIENT_ID`/`_SECRET` and asks for `.env.example` to be fixed.
  Measured: `.env.example:56-63` already declares **both**, with `ADR-050` §D3's French rollout note. **There is
  nothing to fix there, and editing it to "close" the finding would be fabricated closure.** The genuine tracked
  residual is `infra/docker-compose.yml`, which passes `KEYCLOAK_{ADMIN,TEACHER,PARENT}_CLIENT_ID` to `web` and no
  student equivalent — deliberately deferred by `ADR-050`'s rejected alternatives, harmless because `auth.ts:81`
  derives the dev secret as `change-me-${clientId}`, and it stays deferred here for the same reason.

> **⚠️ RECORDED AT LAND — this §D7 and the story's `AC-9` contradict each other, and the CODE follows §D7.**
> `docs/spec/features/v3-e01/stories/S-E01-4b.md` §0(c) re-scopes `PF-222` **onto** `infra/docker-compose.yml` and
> `AC-9` requires two lines to be added there. **`infra/docker-compose.yml` is not in this diff at all**, so `AC-9`
> is **unmet**, not "decided otherwise". The disagreement is left visible instead of being resolved by an agent,
> because the two documents disagree on a *fact about risk*, not on a style:
>
> - §D7 calls the gap **harmless** on the strength of the `change-me-${clientId}` fallback. That is true of the
>   **default** path only. There is **no `env_file:`** anywhere in `infra/docker-compose.yml`, so only explicitly
>   declared keys reach the container: an operator who rotates the student secret in `.env` — which `.env.example:63`
>   explicitly instructs — has it silently dropped, `auth.ts` falls back to `change-me-portal-student`, and **student
>   login fails with `invalid_client` while admin, teacher and parent keep working**. That is `PF-18`'s exact
>   shape — one portal silently different from the other three — at a fourth address.
>
> **A human decides**: either `AC-9` is implemented (two lines, in the shape of their three siblings) or §D7's
> "harmless" is rewritten to state the rotation failure mode above. Until then `PF-222` is **`open`**, not closed,
> and its OPEN.md row says so.

---

## Rejected alternatives

- **Parse the accessor's constants instead of executing it.** §Context 1: an in-body alias — the actual `PF-18`
  shape — leaves every constant untouched. The gate would be decoration.
- **Generate a JSON of the portal→client map and have the check read it.** A generated artefact is stale the moment it
  is not regenerated, i.e. it is the second hand-maintained list wearing a build step. Regenerating it inside the
  gate is §D1 with extra parts.
- **Move the accessor to plain `.js` so `require()` just works.** It would strip `PortalId` from the signature — the
  union is what makes a cross-portal argument a type error — or push the types into a `.d.ts` sidecar, which is a
  second hand-maintained list at a new address.
- **Widen `GATE_MACHINERY` to include the two `apps/web` files.** It would buy a 2400 s full api ratchet on any
  `auth.ts` edit to run one spec, and would still leave the realm export uncovered on a fast-tier PR. §D4's tier-1
  stage is ~1 s and fires on both.
- **Wire the live probe into `--full`.** §D5: it mutates a realm and depends on a container, and `--full` is what a
  release runs. Evidence, not a gate.
- **Override the compose postgres host port for the evidence run.** §D5: `.env` is untracked (invisible to the next
  operator) and `infra/docker-compose.yml` is a deployment change `ADR-050` already refused.
- **Add a demo student to `realm-export.json` so `AC-6` has an identity.** `PF-210`/`ADR-021`; minting a learner
  decides a password policy, a tenant and a `Student.userProfileId` link. The ephemeral admin-API user is evidence and
  leaves no artefact.

## Consequences

- **+** The `PF-18` defect can no longer land green on a fast-tier PR: the stage has **no** trigger to miss it
  (§D4 as amended), and the check runs in ~1.5 s with no Docker, no database and no build.
- **+** The invariant is stated once, in the production accessor, and read by execution — the login seam, the reset
  seam, the realm export, the provisioner and the gate cannot disagree without something going red.
- **+** `VAL-04` moves from "asserted about a file" to "read back from a running realm", including the `azp` claim,
  which is the only assertion distinguishing this fix from the forbidden repair.
- **−** A gate that *executes* repository TypeScript is a sharper tool than the parsing convention around it. The
  inertness assertion in §D1 is what bounds it, and it is itself an assertion that can go red — which is the point.
- **−** The live half is evidence, not a ratchet: nothing re-runs it, so a realm that drifts after this run drifts
  unwatched. Recorded rather than solved; a `--full` stage remains possible once the container lifecycle is cheap
  and deterministic (`ADR-045`'s bar).
- **−** `VAL-04` point 5 is discharged locally, not on Hostinger. Named in §D6, not smoothed over.

## Evidence

**Filled at land, 2026-08-15. Every line below is either something this run produced, or an explicit `deferred`
record. Nothing here is a reconstructed transcript.**

### Executed — the ratchet half (AC-1..AC-4, and the gate it is wired into)

- `node scripts/keycloak-client-check.js` on the clean tree → **`GATE: PASS`, exit 0**, wall time **1.542 s /
  1.563 s / 1.563 s** over three consecutive runs. Banner: *4 portals, 4 distinct confidential clients, 12 redirect
  URIs matched BY PATH*.
- `pnpm typecheck` (the single run this sprint is entitled to, by the test-architect) → **13/13 tasks successful**,
  exit 0, with `@pilotage/api` a genuine cache **miss** that compiled the changed spec fresh and clean.
- `git diff --check` → exit 0. The then-untracked files were additionally checked with `--check --no-index`; only
  benign `LF → CRLF` normalisation warnings.
- `jest apps/api/src/shared/quality/keycloak-client-identity-gate.spec.ts` → **20/20 pass, 6.0 s**. The cross-package
  `require()` of a repo-root `scripts/*.js` from jest resolves; `require('typescript')` resolves from `scripts/`
  because `typescript@^5.6.3` is a **root** devDependency and is hoisted under pnpm.
- Placement asserted structurally, not by eye: the stage lands above `CODE_RE`, which lands above `MODE = full`, and
  the spec asserts that ordering.

### Executed — the four AC-5 negative controls, ONCE, by hand, in memory

All four were driven through `auditRealm(rule, realm)` on an in-memory clone of the export and all four went **RED**;
control M2 (`/student/*` added to `portal-parent`) is refused **by name** as the *forbidden repair named by ADR-050*.
The positive control (unmutated export) returns zero problems, so the gate is not red-on-everything.

> ⚠️ **These four controls are transcripts, not tests, and that is the sharpest limit of this ADR.** A reviewer
> measured it by execution at land: with `wildcardProblems()` gutted to `return []` — disabling W-1, W-2 **and** W-3,
> the primary security content of the gate — `node scripts/keycloak-client-check.js` still exits **0** and the spec
> still reports **20/20 pass**. Five of the seven new `it()` blocks are source-text greps; none executes
> `auditRealm` / `auditAccessor` / `auditProvisioner` against a mutated input. **The ratchet ratchets the realm; it
> does not yet ratchet itself.** Tracked as **`PF-225`**, with the minimum test named there.

### `evidence: deferred` — the live half (AC-6, AC-7, AC-8 · `VAL-04` points 1, 3, 5)

```
evidence: deferred — no live Keycloak was reachable on this host. Measured at land, not assumed:
`timeout 60 docker info` → exit 1, "failed to connect to the docker API at
npipe:////./pipe/dockerDesktopLinuxEngine ... The system cannot find the file specified";
`timeout 30 docker ps` → exit 1. The engine is not running, so no realm was imported, no token
was minted, and no admin API was read back — tracked as VAL-04 (which stays `open`) and PF-223
— tracked as TOOL-19 for the host condition itself
```

`scripts/keycloak-live-probe.js` (449 lines) **was written and has never been executed**. It is wired into no stage
list, which is correct (§D5) — but it is also unexecuted code shipping under this ADR, and its destructive guard is
weaker than its intent. Tracked as **`PF-227`**.

### `VAL-04`'s residue, named rather than rounded off (AC-12)

`VAL-04` has five points. This slice executes **none of them live**. Points **1, 3 and 5-as-re-scoped** are deferred
with the measured reason above. Points **2** (`signIn('keycloak-student')` completing the authorization-code round
trip) and **4** (the `reset-credentials` link being accepted) **need a browser and are NOT closed by this slice under
any outcome**. `VAL-04` stays `open`. The title of this ADR was amended at land for the same reason: it originally
claimed to discharge `VAL-04`.

### Not executed, and not owed

No Prisma query, no `schema.prisma`, no migration, no SQL — so `scripts/restore-drill-baseline.json` is untouched and
the `prisma generate` RED trap (`P-05`) is disarmed by construction, both verified by the absence of any hunk under
`apps/api/prisma/`.
