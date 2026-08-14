# ADR-043 — The identity seam RESOLVES a tenant, it never MINTS one: a login is not a provisioning event

- **Status**: accepted — decided by `S-E01-1a`, executed by the same slice for the `ensureUser` half only.
- **Date**: 2026-08-14
- **Slice**: `S-E01-1a` (V3-E01, finding `PF-01` half (a))
- **Relates to**: `ADR-002` (tenancy is carried by `tenant_id` on every row) · `ADR-004` (one Keycloak realm,
  N clients) · `ADR-015` (RBAC + ABAC) · `ADR-032` (tenant enforcement at the **persistence** layer) ·
  `ADR-040` (grantor-relative role ladder)
- **Supersedes**: nothing. It **reverses a documented behaviour** that had no ADR — the lazy-provisioning
  contract written in prose at `apps/api/src/modules/identity/invite.controller.ts:130-136`
  (*« `ensureUser` creates the `UserProfile` LAZILY, on FIRST LOGIN. Every realm identity that has never
  logged in is profile-less BY DESIGN »*). That paragraph described the runtime accurately. After this ADR it
  describes history, and the slice amends it in place rather than deleting it.

## Numbering — and the sentence in `ADR-032` that will otherwise stop a reader

`ADR-032:126` read, as written, **« No `ADR-042` exists and none is intended »**. That sentence is **scoped to
the RLS half of tenant enforcement**: its own clause continues *« — the migration, its guard spec and its
checker cite `ADR-032 §D5`–`§D8` »*. It refuses a *second ADR for the tenant-enforcement seam*; it does not
reserve the integer.

**This ADR was drafted as `042` and renumbered to `043` at land, and the reason is worth keeping.** `ls
docs/adr/` topped out at `ADR-041`, and `029/030/031/033/034` are reserved in
`docs/daily-improvement-v3/architecture-impact.md` §4, so `042` genuinely *looked* like the next free number
from this branch. It was not: **`S-E01-2c` / `PF-183` had already claimed `042`** for FK-path tenant isolation
in **open PR #245**, which is invisible from `main` because the PR is held for review. Two ADRs, one integer,
and nothing in the toolchain would have said so — the collision surfaces in the ledger, not in the compiler.
`043` is the first number free of both.

Two consequences were taken rather than noted. `ADR-032`'s clause is **annotated in place** (not rewritten) so
a reader meeting it first learns who holds `042` and who holds `043`. And
`rls-isolation-gate.spec.ts`'s negative control — which was anchored on `042`, the then-next-free number, and
would have turned `main` red the moment *either* slice landed — is re-anchored on `000`, reserved by
construction. **A negative control must not double as a number reservation.**

This ADR is deliberately **not** an amendment to `ADR-032`. `ADR-032` is the *persistence-layer* decision and
says so explicitly in *What this ADR does not claim*: *« A well-formed UUID is a **shape**, not an
**entitlement**. This helper cannot tell tenant A's id from tenant B's; resolution and authorisation live in
the identity seam, which is another track's code. »* This file is that identity seam. Folding it into
`ADR-032` would merge the two halves that sentence was written to keep apart.

## Context — measured on this checkout, not assumed

1. **`ensureUser` is the tenant origin of the entire API.** `grep -rn "ensureUser" apps/api/src` → **242 lines
   across 50 files**. The shape is uniform: `const me = await this.users.ensureUser(jwt)` followed by scoping
   on `me.tenantId`. Whatever it returns **is** the tenancy of the request. `apps/worker/src` returns **0**
   references, so the seam is API-only.
2. **It minted tenancy from a constant.** `user-sync.service.ts:9` `const DEMO_TENANT_SLUG = 'demo'`, used at
   `:38-56`: when no profile matched by `authProviderId` and none matched by `email`, the service **upserted a
   `demo` `Tenant` into existence** and created a `UserProfile` inside it with `status: active`.
3. **The `demo` tenant is an artefact of this code, not of the seed.** `seed-demo.ts:260-263` seeds
   `slug: 'voltaire-demo'`. The string `demo` appears as a tenant slug in no seed. Every `demo` tenant on a
   developer machine was created by a login.
4. **Profile-less realm identities are shipped, enabled, and reachable.**
   `infra/keycloak/realm-export.json:106-135` ships `admin@`, `teacher@` and `parent@pilotage.local`, all
   `enabled: true`; the seed contains matching rows for none of them. `ADR-004` puts every tenant in **one**
   realm, so any realm identity is reachable from any tenant.
5. **The seam had never been tested.** `apps/api/src/shared/auth/` contained six `*.spec.ts` files and no
   `user-sync.service.spec.ts`.

Net: **any authenticated realm identity that had never logged in silently became an `active` member of a
`demo` tenant that the login itself created**, carrying its realm-role permissions. That is `PF-01`, and it is
the reason `ADR-002`'s *« every query is scoped by `tenant_id` »* was structurally unfalsifiable — the scope
was whatever the seam had just invented.

## Decision

### D1 — resolution only: the seam reads tenancy, it never writes it

`UserSyncService.ensureUser` performs **lookups and one adoption update**, and nothing else. It contains
**zero `tenant.*` calls of any kind**. A login may discover which tenant a subject already belongs to; it may
never decide.

The two provisioning paths that remain are the two that already hold a real tenant and write it explicitly:
`invite.controller.ts` (`persistInvitedProfile`, tenant = the inviting admin's) and `register.controller.ts`
(public registration — see *What this ADR does not claim*).

### D2 — an authenticated subject with no provisioned profile is REFUSED, fail-closed

Both lookups missing is not a cache miss to be repaired; it is the answer. The seam throws
`UnprovisionedUserError` and returns nothing. **Refuse, never sanitise, never default** — the same discipline
`ADR-032 §D2` established one layer down, applied here because the failure mode is identical: a seam that
"repairs" a missing tenant produces a silently *wrong* tenant, which is strictly worse than a crash.

The branch that used to succeed is **deleted, not guarded**. There is therefore no fail-open leg to reason
about at this seam: the default is refusal because no other default exists.

### D3 — `403`, not `401`, and the argument is measured rather than doctrinal

*For `401`:* the subject is not a known user; `401` confirms less.

*For `403`, which is what ships:* three reasons, the third of which is decisive and is a measurement.

- **It is true.** `JwtAuthGuard` / `jwt.strategy.ts` already verified signature and issuer, and already spends
  the one `401` in this seam on a missing `sub` (`jwt.strategy.ts:60`). The token *is* valid. A second `401`
  asserts *"your credentials are missing or invalid"*, which is false.
- **RFC 9110 pairs `401` with `WWW-Authenticate`**, which every client reads as *refresh and retry*. A
  refreshed token cannot conjure a `UserProfile`.
- **Measured on the client, and this is the load-bearing reason.** `apps/web/src/lib/api-client.ts:111-113`
  intercepts **401 before any caller sees it** and issues
  `redirect('/{portal}/login?error=session_expired')`. The portal shell `AppShellRoot.tsx:86` — reached by all
  four portals through `PortalShell.tsx:30` — calls `fetchMe()` on every page. So `401` would put exactly the
  identities this decision refuses into an **infinite login → shell → 401 → login loop**, captioned with a
  false claim that their session expired. (`fetchMe`'s own `401 → null` branch at `lib/me.ts:34` never runs on
  the server path, for the same reason.) `403` propagates as one terminal `ApiError` instead of a loop.

The information-leak objection is accepted and judged negligible: the caller already holds a realm token the
realm accepted, so it has already learned that much.

### D4 — the message names a next step and names no internals

One exported message constant, French, factual and non-stigmatising (GUARDRAILS §1) — **shipped wording**:
*« Votre compte n'est rattaché à aucun établissement. Contactez l'administrateur de votre établissement pour
activer votre accès. »*

> **Amended at land, 2026-08-14.** This clause originally quoted the sentence ending at *« …de votre
> établissement. »*, and `S-E01-1a.md` FR-5 still does. The shipped constant carries the trailing *« pour
> activer votre accès »*, added during implementation because the north star is **information → action** and a
> refusal naming no next step is the shape this project refuses everywhere else. The **quote** is corrected
> here rather than the code: an ADR that misquotes the constant it accepts is precisely the drift the ADR rule
> exists to prevent.

The module also exports `UNPROVISIONED_USER_CODE` (D4b) and the `UnprovisionedUserError` class, so "one
constant" describes the **user-visible surface**, not the export count.

### D4b — the machine discriminant, and the wire convention it establishes

`code: 'ACCOUNT_NOT_PROVISIONED'` travels in the exception body alongside `message`, so a client branches on a
stable token instead of pattern-matching a French phrase that will change. **This is a new shape for this
codebase and is therefore decided here rather than assumed:** the six existing object-body throws
(`permissions.guard.ts:31`, `privilege-ceiling.ts:175`, `role-ladder.ts:139/150/164/177`) carry
`{ message, required, missing }` and no `code`. The convention: `{ statusCode, message, code }`, `code` being a
`SCREAMING_SNAKE` machine token that is part of the wire contract and may not be renamed without a version
note. **It is not yet declared in `packages/contracts` and has no consumer** — `ACCOUNT_NOT_PROVISIONED`
appears nowhere under `apps/web/src`, so today it is a contract with one end. Declaring the union in
`packages/contracts` and branching on it in the web is the UI half recorded as `PF-186` (c).

It must not reveal whether an account, an email or a tenant exists locally, and must not name `UserProfile`,
`Tenant`, a slug or a subject id. The refusal is logged with the **`sub` only** — no email, no
`preferred_username`, no name (RGPD minimisation). A refusal must be neither silent nor a data leak.

### D5 — no audit row on refusal, and the reason is structural

`AuditLog.tenantId` is **required** (`schema.prisma:1235`, non-optional; `actorId` is the optional one). A
refused subject has no tenant, so writing the row would force this code to **invent a tenant id in order to
record that it refused to invent a tenant id** — the defect re-entered through the door marked
*observability*. Second reason: the seam is reachable by any holder of any valid realm token, so an audit
write here is an append-only table an outsider can inflate at will, against a hash chain `S-E01-2b` has just
made rewrite-proof on purpose. Provisioning **successes** stay audited where they happen, in the same
transaction (`ADR-035`), unchanged.

### D6 — no bypass, in any shape (DNC-10)

No `ALLOW_AUTO_PROVISION`, no `AUTO_PROVISION_TENANT`, no `NODE_ENV !== 'production'` leg, no `SKIP_*`, no
options bag. If a local developer needs a profile, **the seed provides it** — the three realm identities are
seeded into the real `voltaire-demo` tenant. A bypass flag is this defect wearing a different hat, and it is
held out by a ratchet test asserting the file reads no `process.env`, not by this sentence.

### D7 — adoption by **self-authentication** is kept; adoption by **third-party action** stays refused

The surviving `email` branch adopts an existing profile on first login. `S-E04-9` **withdrew** an outwardly
identical adoption from
`invite.controller.ts` (see its `:130-136` note). These are not in contradiction, and the distinction must be
written down before someone "harmonises" them:

- **Invite adoption** let a `users.write` holder in an arbitrary tenant bind *someone else's* realm identity —
  `authProviderId` is globally unique (`schema.prisma:838`), so the binding is permanent — plus a password
  overwrite and a realm-role grant. The actor and the subject were different people.
- **Login adoption** binds the identity **to the row that already carries that subject's own email**, on the
  strength of a token the subject itself presented. The actor and the subject are the same person, and the
  tenant is the pre-existing row's, never a new one.

Seeded profiles carry **no `authProviderId`** — the realm export declares no user `id`s (Keycloak mints them
at import time, per cluster) and `seed-keycloak-users.ts:108-113,211-214` discovers them at runtime. So D7 is
not a convenience: it is the mechanism by which every seeded account reaches its profile.

**D7b — the shipped branch has TWO refusal legs the first draft of this clause did not sanction.**
*(Amended at land, 2026-08-14. The paragraph above originally described `findFirst({ where: { email } })` →
`update({ authProviderId: sub })`. That is **not** what ships, and the divergence is recorded rather than
tolerated: `user-sync.service.spec.ts` asserts the source contains **no `findFirst` at all**, so a future run
implementing this ADR literally would turn its own gate red.)*

What ships is `findMany({ where: { email }, take: 2 })`, then:

1. `candidates.length > 1` → **refuse** (`ambiguous-email`). `findFirst` returns an *arbitrary* row in
   unspecified order, so deleting the creation branch without this would have replaced tenancy-by-constant
   with **tenancy-by-arbitrary-row** — the same `G-TENANT` violation plus non-determinism. `take: 2` is
   sufficient: the question is "ambiguous?", not "how many?".
2. exactly one candidate whose `authProviderId` is `null` (or already `=== sub`) → **adopt**.
3. exactly one candidate already bound to a *different* subject → **refuse**
   (`email-bound-to-another-subject`). The previous code did an **unconditional** `update`, so a realm subject
   presenting a victim's email string overwrote a live binding — permanently, since `authProviderId` is
   globally unique (`schema.prisma:838`) — and the legitimate holder, now missing their own `findUnique`, was
   silently re-provisioned into an invented tenant. That is closed.

All three refusals emit the **same** message, status and code; only the server log distinguishes them, so no
enumeration oracle is created. **Known limitation of leg 3:** the guarantee is read-time only — between the
`findMany` and the `update`, a concurrent request can bind the same row and this one overwrites it. It needs
two realm subjects sharing an email, which the realm's unique-email policy normally prevents. The correct
shape is a conditional `updateMany({ where: { id, authProviderId: null } })` refusing on a zero count; it is
**not** shipped here and is recorded under `PF-186` (b).

## What this ADR does **not** claim

**It does not claim that an unprovisioned identity is refused by the application.** It is refused by *this
seam*, and the seam is a call, not a guard.

- **`PermissionsGuard` still grants from realm roles alone.** `permissions.guard.ts:28` calls
  `effectivePermissions(jwt.sub, realmRoles)`, which unions `REALM_ROLE_PERMISSIONS[r]` for every realm role
  on the token (`user-sync.service.ts:64-87`); the profile lookup only ever **adds** custom-role permissions
  and never gates the realm-role ones. An unprovisioned `admin@pilotage.local` therefore still passes
  `@RequiresPermission('users.write')` with a full `school_admin` permission set, and meets the refusal only
  if the handler body happens to call `ensureUser`.
- **That is a convention observed by 242 call sites, not an invariant.** Measured per file, five controllers
  declare more `@RequiresPermission` handlers than they have `ensureUser` calls — `remediation` 21/20,
  `alerts` 12/9, `imports` 8/6, `roles` 5/3, `child-claims` 3/1 — so roughly a dozen permission-gated handlers
  remain reachable by an unprovisioned identity after this slice.
- This is the **second half of `PF-165`** (*"permissions derived from realm roles rather than from the
  profile"*), which is why `PF-165` must **not** be retired when `PF-01` half (a) closes. The structurally
  correct repair is to move the requirement into the guard layer — refuse before the handler, once, for all
  50 controllers — which changes refusal semantics across the whole API and is therefore its own slice, not a
  widening of this one.

**It does not claim that tenant resolution is correct where it survives.** *(Amended at land, 2026-08-14 —
this paragraph previously concluded that "this slice replaces tenancy-by-constant with
tenancy-by-arbitrary-row in the one branch it preserves." That was written against the `findFirst` draft and
is **false against the shipped code**, which refuses exactly that case. The correction is the point of D7b;
the paragraph is rewritten rather than deleted so the earlier reasoning stays auditable.)*

The `email` branch this ADR keeps (D7/D7b) is **not** scoped by tenant, while `email` is `@db.Citext` and
unique only *per tenant* (`schema.prisma:879`, `@@unique([tenantId, email])`). With a second tenant holding
the same address — reachable by construction under `ADR-004` — the branch **refuses** rather than selecting a
row. So the open question is no longer *"which arbitrary row did it take?"* but *"which tenant should it
adopt?"*, and that is undecidable without a discriminant, which is precisely what the epic does not yet have
(`D-02`). Stated plainly so it is not lost: **this slice replaces tenancy-by-constant with a fail-closed
placeholder over an unanswered question.** Today the question is latent — one seeded tenant means "wrong
tenant" has no second value to be wrong about — and the day it stops being latent, the symptom is a refused
login, not a cross-tenant read.

Two further properties of the same branch are open and need **no** decision, which is why they are proposed as
a small follow-up (`S-E01-1b`) rather than parked behind `D-02`: `payload.email_verified` is parsed in
`jwt.strategy.ts:12` and **never read**, and `UserProfile.status` is consulted **nowhere** in the auth seam —
so a `suspended` or soft-`deleted` profile still resolves, can still be bound to a fresh subject, and a
soft-deleted duplicate counts toward the ambiguity test that then refuses the legitimate holder. One matching
row is being treated as proof of identity. All of this is **`PF-186`**, whose ledger row
(`docs/daily-improvement-v3/traceability/OPEN.md`) is the single definition this ADR, `user-sync.service.ts`
and its spec all point at.

**It does not claim public registration is fixed.** `register.controller.ts:60,366-369` still upserts the same
`demo` tenant. An anonymous registrant has no discriminant to resolve from, and inventing a rule there would
pre-empt the seam meant to define it. Recorded as `PF-185`, forked three ways (school selection · a `pending`
tenant-less profile, which needs a `UserStatus` enum value and therefore `G-MIGRATION` · a Keycloak claim,
which is `S-E01-4`, blocked on `D-02`). **`PF-01` therefore stays open**, at `in-progress`, with half (a)
closed here.

## Consequences

**Easier.** The tenancy of a request is now a value the system was given, not one it made up, so every
`me.tenantId` downstream means something. `ADR-002`'s scoping claim becomes falsifiable for the first time.
The seam has a spec.

**Harder — and deliberately.** Every account must be provisioned before it can be used. A Keycloak user
created by hand no longer works; it must arrive through `invite.controller.ts`. Local development requires
`pnpm prisma:seed:demo`, and a developer who skips it is refused correctly, with a seed console line that says
so. This is the intended cost, and it is the same trade `ADR-032` §Consequences records one layer down.

**Unchanged.** No schema change, no migration, no new dependency, no new HTTP mechanism —
`UnprovisionedUserError` extends `ForbiddenException`, so Nest maps it to the wire with no exception filter
and no cross-cutting machinery. `G-MIGRATION` does not trigger.

## Evidence

`apps/api/src/shared/auth/user-sync.service.spec.ts` (new; no database, no generated client, no
`DATABASE_URL`). The fake Prisma client **records every call** so the assertions are about writes, not only
about the thrown error — a `403` that still created a row would pass a thrown-error-only test.

Asserted: an unmatched `sub` **and** unmatched `email` is refused with `UnprovisionedUserError` while
`tenant.upsert`, `tenant.create` and `userProfile.create` are each called **0 times** (D1, D2); a subject with
a provisioned profile resolves and returns **the profile's own** `tenantId`, compared against a value that is
not the fixture default — the positive control, without which the negative test is green on a service that
refuses everything; the `email` branch still adopts, still stamps `authProviderId`, and still creates nothing
(D7). Plus a source-reading ratchet over `apps/api/src/shared/auth/user-sync.service.ts`: no
`DEMO_TENANT_SLUG`, no `tenant.` call, no `process.env` read (D6), with a non-vacuity floor so a rename cannot
make it pass by scanning nothing.
