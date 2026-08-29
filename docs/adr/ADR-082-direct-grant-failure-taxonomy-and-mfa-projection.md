# ADR-082 — A direct-grant failure has ONE taxonomy, and an MFA field must say whether it is a policy or a fact

- **Status** Accepted (architecture ruling, `S-E05-8`)
- **Date** 2026-08-28
- **Story** `S-E05-8` — `docs/spec/features/v3-e05/stories/S-E05-8.md` (a wrong password stops announcing an MFA
  fact, and `mfaEnabled` stops being a hard-coded lie)
- **Epic** `V3-E05` — AuthN/AuthZ hardening and permission integrity (layer L0)
- **Closes as a CLASS** `PF-25` **half (a)** — *"wrong password → « MFA required »"*. The substring-classification
  class is frozen for `apps/web/src` by the ratchet's R1/R2, with fixture-pinned negative controls proving both
  rules can go red.
- **Advances, does NOT close** `PF-25` **half (b)** — *"`mfaEnabled` hard-coded"*. The false literal is removed and
  `mfaRequired` is derived from one rule, but **no account fact is measured**. Writing `closed` against half (b)
  would be exactly the `closed ≠ fixed` error of run 93.
- **Raises** `PF-443` (measuring whether an account holds an OTP credential needs a Keycloak Admin round trip on
  `/me`'s hot path — its own slice) · `PF-444` (**premise P-1 is unverified**: whether Keycloak's ROPC returns
  `Account is not fully set up` only *after* the password validates; discharge is `scripts/keycloak-live-probe.js`
  STEP 6 mint C, shipped **NOT EXECUTED**) · `PF-445` (`admin/settings/page.tsx` called teacher MFA
  *"Recommandé"* while `invite.controller.ts` **enforces** it — a DNC-06 shape, corrected in-slice, prose only) ·
  `PF-446` (`mfaRequired` is a **policy projection**, not an account fact, and the two can diverge today for any
  identity provisioned outside `invite.controller`)
- **Related** `ADR-004` (Keycloak, 1 realm / N clients — the home of the `CONFIGURE_TOTP` required action this ADR
  projects) · `ADR-079 §D3` and `ADR-080 §D1` (two questions split by **name** so an illegal conflation is
  unwritable — reused verbatim here for *policy* vs *fact*) · `ADR-078 §D1` (pure cross-app derivation living in
  `packages/contracts`) · `ADR-067 §D6` (one-way-ratchet house style) · `ADR-015` (permission model) · `DNC-06`
  (documentation promising deeper behaviour than the runtime delivers) · `GUARDRAILS.md` §2, §4

---

## Verdict

**CONCERNS — proceed, under the rulings below.** No schema change, no migration, no new dependency, no new HTTP
style, no new package, no permission or guard metadata change, no new success path. Three rulings are genuinely new
cross-cutting architecture and are why this ADR is mandatory under `GUARDRAILS.md` §2:

1. a **shared `security/` failure taxonomy** consumed across `apps/web` **and** `apps/api`;
2. a **nullable-unknown contract field semantic** (`mfaEnabled: null` means *never measured*, not *false*);
3. an **`mfaRequired` policy projection** derived with zero I/O from one declaration.

The single most important sentence in this ADR: **the fix is not "classify better", it is "stop claiming to know
something Keycloak never told us"** — every ruling below is downstream of that.

---

## D1 — The direct-grant failure taxonomy: ONE closed union, declared once, in `packages/contracts/src/security/`

**Home.** `packages/contracts/src/security/direct-grant-failure.ts`, re-exported by `security/index.ts`, which
`src/index.ts:10` already re-exports. `tsconfig.build.json` includes `src/**/*`, so the module emits to
`dist/security/direct-grant-failure.js` with no build-config change.

**The union is closed and has exactly three members:**

    'credentials-or-otp-rejected' | 'account-setup-pending' | 'unclassified'

**Why the first member wears its ambiguity in its name.** Keycloak's `password` (Resource Owner Password
Credentials) grant answers a wrong password and a wrong-or-missing TOTP **identically**:
`401 / invalid_grant / "Invalid user credentials"`. No observable field separates them. The defect `PF-25` half (a)
names is precisely the code that pretended otherwise: `apps/web/src/auth.ts` (on `HEAD`, before this slice) tested
`description.includes('credential')` **before** the `401`/`invalid_grant` branch — and the measured string
`"Invalid user credentials"` *contains* `credential`, so **every typo was classified as « OTP requis »**. A member
named `otp_required` cannot exist honestly; it is **deleted**, not renamed.

**The matching rule this ADR establishes, binding on every future edit of the table:** *never anchor on a needle
that is a proper substring of another expected phrase.* Anchor on the **whole measured phrase**. The two live
predicates are **disjoint by construction** (rule (2) is only reached when rule (1)'s phrase is absent), so
permuting rule order changes no verdict — the property whose absence *was* the defect.

**Provenance is recorded per-string, at two different grades, and they are not blended:**

| String | Grade | Source |
|---|---|---|
| `Invalid user credentials` | **MEASURED** | run 63 (2026-08-15), disposable Keycloak 26.0 importing `infra/keycloak/realm-export.json`; verbatim at `docs/daily-improvement-v3/traceability/CLOSED-L0.md:123` |
| `Account is not fully set up` | **asserted in-repo, never observed** | `apps/api/src/modules/identity/register.controller.ts:241` documents it. Discharge: `scripts/keycloak-live-probe.js` STEP 6 — **NOT EXECUTED** (Docker down, 7th consecutive run) |

Presenting the second as equal to the first would launder folklore into measurement. **`unclassified` is a member,
not a fallback onto a confident one**: Keycloak being unreachable must never read as "wrong password" (failure is
**closed** — an unrecognised input degrades to `unclassified`, never upward).

**Account lockout is a NAMED residual, not an oversight.** The realm locks after 5 attempts; a disabled account
answers `invalid_grant` with an `"Account is disabled"`-family phrase, which carries no rule-(1) anchor and
therefore lands on `credentials-or-otp-rejected` — deliberately. Without measurement, a distinct `locked` member
would be an invented oracle. Same probe discharges it.

**Form constraint — why this module imports nothing, not even `zod`.** `apps/web/src/middleware.ts` already
value-imports from this directory (`buildWebCsp`, `generateCspNonce`) and runs on the **edge** runtime;
`apps/web/src/auth.ts`, the consumer, is pulled into that same bundle. A module that failed to load there would
break **every route of all four portals**, not one page. So, exactly as `csp.ts`, `csv-injection.ts` and
`branding-css.ts`: zero dependencies, **no class, no `instanceof`** — the CJS `src`/`dist` seam makes class
identity unreliable across the package boundary, while a string union is always reliable.

**Consequence for deployment, stated because it is easy to miss:** `@pilotage/contracts` resolves `main → dist/index.js`
(`GUARDRAILS.md` §2). `auth.ts` now **value**-imports `classifyDirectGrantFailure`, so the orchestrator's single
`pnpm build` must precede any deploy. `packages/contracts/dist/` holding the new files on a dev checkout is **not**
evidence that a deployed image holds them.

**Rejected alternative — an error subclass carrying a `kind`.** Rejected on the edge-bundle and CJS-seam grounds
above, and because `@auth/core` already owns the one class that matters on this path (see §D4).

---

## D2 — One MFA rule, one declaration; and `mfaEnabled` / `mfaRequired` are split by NAME because they are different kinds of claim

**Home.** `packages/contracts/src/security/mfa-enrolment-policy.ts` declares
`MFA_ENROLLED_REALM_ROLES = ['school_admin', 'teacher']` **once for the whole repo**, plus two predicates over it:
`isMfaEnrolledRealmRole` (one role — the `invite.controller.ts` shape) and `mfaRequiredByInvitePolicy` (a role
list — the `me.controller.ts` shape). The second is defined **in terms of** the first, so the two consumers share a
**predicate**, not merely a list.

**Why a module and not a copied literal.** On `HEAD` the rule lived as a literal at exactly one site
(`invite.controller.ts`, `body.realmRole === 'school_admin' || body.realmRole === 'teacher'`). Deriving
`mfaRequired` in `me.controller.ts` by **retyping** that literal would have created the second copy — the routine's
`project_paired_lists_drift` failure mode — and the slice that claims to close a drift would have founded one. Both
sites now read this file; the ratchet (R4) freezes that no third declaration appears.
`invite.controller`'s behaviour is **byte-identical**: same two roles, same `CONFIGURE_TOTP`, none gained, none lost.

**`super_admin` is recorded, not silently "fixed".** It is absent from the set on purpose: the invite channel
admits only `school_admin | teacher | parent` (`@IsEnum`), and a `super_admin` is provisioned elsewhere **without**
`CONFIGURE_TOTP`. Adding it would make `/me` assert `mfaRequired: true` for accounts under no such obligation — a
*new* lie, the very disease being treated. The gap (the platform's most privileged role is enrolled nowhere) is a
recorded residual whose remedy is a Keycloak provisioning change, unprobeable while Docker is down.

**Domain is `string`, not `RealmRole`.** `me.controller.ts` reads `jwt.realm_access?.roles ?? []` — arbitrary,
unvalidated strings from a token. Typing the input as `RealmRole` would force a type assertion at the call site,
i.e. one more unmeasured claim. The predicate is **total** over `string`; an unknown role is not enrolled.

**THE SPLIT — the ruling this ADR most needs future readers to keep.** Two fields, two kinds of claim, and the
names must make conflating them unwritable (the `ADR-079 §D3` mechanism):

| Field | Kind | Value today | Meaning |
|---|---|---|---|
| `mfaEnabled: boolean \| null` | **account fact, measured** | **always `null`** | `null` = **never measured**. It is **not** a synonym for `false`. |
| `mfaRequired: boolean` | **policy projection, zero I/O** | derived from the caller's own token | "the invite policy enrols this role in `CONFIGURE_TOTP`" — **never** "this user configured MFA". |

On `HEAD`, `mfaEnabled` was the literal `false`, which made the settings pages' "MFA actif" block unreachable for
**everyone** while asserting a device fact nobody had observed. Measuring it truthfully requires a Keycloak Admin
round trip (`GET /users/{id}/credentials`) on `/me` — read `no-store` on nearly every page load of every portal —
i.e. an N+1 against Keycloak plus a new failure mode for `/me`. Deliberately not done here: **`PF-443`**.

**Binding consumer rule:** a renderer must branch on **three** states (`=== true` / `=== false` / `=== null`) and
must **never read this field for truthiness**. `null` is falsy, so `{mfaEnabled && …}` shows "MFA actif" to nobody;
were the field ever to become a textual sentinel, the same expression would show it to everybody. Ratchet R3 freezes
that **no boolean literal** is assigned to either key anywhere under `apps/api/src`.

**`mfaRequired` triggers neither `G-TENANT` nor `G-AUDIT`, and the reason is structural, not a waiver:** it is
derived with zero I/O from claims the caller already presented — no query added, no row read, no network call.

**Recorded divergence (`PF-446`), because the projection is honest only if its limits are written down.**
`register.controller.ts:255` creates identities with `requiredActions: []`, and `keycloak-admin.service.ts:226` can
set required actions on any user at any time. A `school_admin` or `teacher` provisioned by any path other than
`invite.controller` therefore holds the role **without** `CONFIGURE_TOTP`, and `/me` will report `mfaRequired: true`
of an account under no such obligation. Naming, JSDoc and UI copy (« Obligatoire **pour votre rôle** ») are chosen
so the field cannot be misread as an account fact — but the divergence is real and closing it needs the same admin
round trip as `PF-443`.

**Contract twins.** `packages/contracts/src/dto/auth.ts` (`MeResponseSchema`) and `apps/web/src/lib/me.ts` are two
hand-kept copies of one shape; they change **in the same commit**, with the same nullability and the same documented
meaning. Recorded honestly: nothing calls `.parse()` on that schema today, so holding them together is **hygiene,
not an executed constraint** — and that hole is exactly how `preferences` had already drifted (returned by the
controller since `S-E04-*`, undeclared in the schema; declared now rather than hand-synchronised a third time).

---

## D3 — Premise **P-1** is stated as a premise, and the disclosure delta is written BOTH ways

`account-setup-pending` renders a message distinct from the credentials-rejected one. That is only non-enumerating
if:

> **P-1** — Keycloak answers `"Account is not fully set up"` **only after the password has validated**; a wrong
> password short-circuits to `"Invalid user credentials"` first.

**P-1 is reasoned from grant semantics. It is NOT measured.** Its discharge is a single observation:
`scripts/keycloak-live-probe.js` **STEP 6, mint C** — a *wrong* password against a user with `CONFIGURE_TOTP`
pending. The probe ships **NOT EXECUTED** (Docker Desktop refuses to start). Per `feedback_landed_is_not_ran`, an
un-run proof proves nothing: **the distinct message is `UNPROVEN`, not verified-safe.** It is recorded as
**`PF-444`**, not absorbed.

**The disclosure delta, stated in both directions (`G-AUTHZ`):**

- **Strictly less:** a wrong password stops announcing an MFA fact about a stranger's account before any credential
  is proven.
- **Strictly more, premise-conditioned:** `account-setup-pending` reveals that an address belongs to an account
  with a pending required action. Under **P-1**, only to a caller who already proved the password.

**Pre-decided contingency, one line wide, if P-1 is falsified:** collapse `SETUP_PENDING_MESSAGE` onto
`CREDENTIALS_REJECTED_MESSAGE` in `apps/web/src/components/PortalLoginForm.tsx` (documented at the constant). The
**taxonomy keeps the distinction** either way — the tests, the ratchet, and the future slice that actually measures
MFA all need it. Rendering is what collapses; truth is not deleted to hide it.

No third fact about a caller is revealed.

---

## D4 — `CredentialsLoginError` extends `CredentialsSignin`: this is the TRANSPORT, not decoration

The classification is worthless if it cannot reach the browser. `@auth/core` wraps a non-`AuthError` thrown from
`authorize` in a `CallbackRouteError`, which is **not** on its client-safe list — so the browser received
`?error=Configuration` **with no `code` at all**, and every arm of the login form's handler missed. Users read
« Connexion impossible : Configuration » whatever had actually happened.

Extending `CredentialsSignin` is what puts `this.code` on the redirect URL (`@auth/core/index.js`:
`if (error instanceof CredentialsSignin) params.set('code', …)`), which `signIn(…, { redirect: false })` surfaces as
`res.code` — what `PortalLoginForm` reads. Because the base class already declares `code: string`, the parameter
property carries `override` under `noImplicitOverride`; `CredentialsLoginCode` (`DirectGrantFailureCode | 'wrong_portal'`)
is assignable to `string`, and adding `readonly` while overriding a mutable property is permitted.

**Nothing here is more permissive.** The class is only ever **thrown**, never returned, so no failure can become a
session. Every change is inside the *failure* branch of `directGrantLogin`: no new success path, no change to token
issuance, no change to the realm-role portal check, no change to `wrong_portal`, no guard weakened in `apps/api`.

**`wrong_portal` is deliberately OUTSIDE the `DirectGrantFailureCode` union** and is added only at the `apps/web`
type level. It is decided **after** a successful mint, from decoded realm-role claims — admitting it to the union
would make that function's *input* contract a lie.

---

## D5 — The ratchet is the enforcement, and its floors count FIXTURES

`apps/api/src/shared/quality/auth-failure-classification-gate.spec.ts` freezes the six rules (R1 shape-based
substring classification in `apps/web/src`, zero tolerance · R2 the owning file imports the canonical classifier ·
R3 no boolean literal at either MFA key under `apps/api/src` · R4 exactly one declaration of the enrolled-role list ·
R5/R6 one closed union, one declaration). Each rule goes **red independently** against its own
`__fixtures__/direct-grant-failure/*.txt` and **silent** against `clean-surface.ts.txt`.

Two house rules are honoured explicitly, because both have bitten this routine:

- **Anti-vacuity floors count FIXTURE offenders (`>= 4`), never live-tree offenders**
  (`feedback_ratchet_floors_must_not_track_shrinkable_classes`: never floor a ratchet on a count the roadmap is
  meant to drive to zero).
- **The export assertion targets the export SURFACE, not a filename**, with a **negative control** — a symbol
  deliberately not exported must read `undefined` on the same loaded module object, so a green cannot come from an
  empty stub. When `dist/` is absent, the conditional half **reports the reason** instead of passing silently.

---

## D6 — What this ADR does NOT authorise

- No measurement of any account MFA fact (`PF-443`), and therefore **no `closed` on `PF-25` half (b)**.
- No new union member for account lockout, or for anything else, without a **measured** phrase behind it.
- No third declaration of the enrolled-role list, and no boolean literal at `mfaEnabled` / `mfaRequired`.
- No reading of `mfaEnabled` by truthiness anywhere, in any portal.
- No claim that the `account-setup-pending` message is safe until **P-1** is measured (`PF-444`).

**If the implementation deviates from §D1 or §D2, this ADR is wrong and must be edited in the same commit** — an
ADR recording a home the implementer did not use is worse than no ADR, because it reads as authoritative
(`ADR-080 §9`).

---

## D7 — Numbering, checked rather than assumed

`docs/adr/` ends at **`ADR-080`** on `main`. **`ADR-081` is claimed by open PR #285**
(`ci/2026-08-28-v3-e03-page-envelope-contract`, verified against `gh pr list` on 2026-08-28), and `PF-428`…`PF-442`
are claimed by the same PR — invisible to an allocator that reads `main`
(`project_parallel_runs_collide_on_ids`). So **`ADR-082` is the next free number** and new findings start at
**`PF-443`** (highest id present on `main`: `PF-427`). If a collision surfaces at rebase, renumber **by meaning**,
never by pattern — these ids are cited from production docblocks.
