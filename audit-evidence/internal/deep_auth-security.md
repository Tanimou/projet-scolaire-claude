# Deep audit — domain `auth-security`

Scope: `apps/api/src/shared/{auth,prisma,keycloak,storage,queue}`, `apps/api/src/modules/{identity,schools}`,
`apps/web/src/{auth.ts,middleware.ts}`, `apps/web/src/app/admin/{roles,users,audit,settings,establishment,schools}`,
`apps/api/prisma/schema.prisma`.

Live stack probed read-only: `pilotage_api` (healthy, OpenAPI 150 paths), `pilotage_web`, `pilotage_postgres`,
`pilotage_keycloak`. No DB writes performed. Date of pass: 2026-08-01.

Already-confirmed findings from the previous pass are NOT re-reported (audit page `humanizeResourceType` server/client
violation, empty `pg_policies` vs ADR-002, `$executeRawUnsafe` tenant interpolation, stale web image 404s, 0 Storybook
stories, duplicate `<h1>`). Where I found **more of the same class**, it is flagged `[SAME-CLASS +]`.

---

## 1. API surface — endpoint inventory (live OpenAPI)

| Method | Path | Guard chain | Service impl |
|---|---|---|---|
| GET | `/api/v1/me` | JwtAuthGuard + PermissionsGuard, **no** `@RequiresPermission` | real |
| GET | `/api/v1/me/display-preferences` | `profile.read.self` | real |
| PATCH | `/api/v1/me/display-preferences` | `profile.write.self` | real |
| GET | `/api/v1/users` | `users.read` | real (no pagination/filter/search) |
| POST | `/api/v1/users/invite` | `users.write` | real (non-atomic, see D-08) |
| POST | `/api/v1/users/{id}/roles` | `roles.assign` | real (no audit, see D-06) |
| DELETE | `/api/v1/users/roles/{userRoleId}` | `roles.assign` | real, **no UI caller** |
| GET | `/api/v1/roles` | `roles.read` | real, **not tenant-scoped** (D-01) |
| GET | `/api/v1/roles/permissions/catalog` | `roles.read` | real, reads DB (drifted, D-05) |
| POST | `/api/v1/roles` | `roles.write` | real, **priv-esc** (D-03) |
| PATCH | `/api/v1/roles/{id}` | `roles.write` | real, **not tenant-scoped** (D-01) |
| DELETE | `/api/v1/roles/{id}` | `roles.write` | real, **not tenant-scoped** (D-01) |
| POST | `/api/v1/auth/register-parent` | **none — public** | real, **unthrottled** (D-04) |
| GET | `/api/v1/schools` | `schools.read` | real |
| POST | `/api/v1/schools` | `schools.write` | real, **no audit row** |
| PATCH | `/api/v1/schools/{id}` | `schools.write` | real, **no audit row**, no UI |
| DELETE | `/api/v1/schools/{id}` | `schools.write` | real (soft-close), **no audit row**, no UI |
| POST | `/api/v1/schools/{id}/switch` | `schools.read` | real |
| GET | `/api/v1/analytics/audit` | `audit.read` | real (D-14, D-15) |
| GET | `/api/v1/analytics/audit-facets` | `audit.read` | real |

DTO validation: global `ValidationPipe({transform, whitelist, forbidNonWhitelisted})` — `apps/api/src/main.ts:20-26`.
`class-validator` DTOs present on roles/invite/register/schools/me. **No** `ParseUUIDPipe` on any `@Param('id')` in the
domain → a malformed id reaches Prisma and surfaces as 500 instead of 400
(`roles.controller.ts:147,198`, `users.controller.ts:38,49`, `schools.controller.ts:135,161,180`).

`apps/api/src/modules/identity/dto.ts:1` — `// Placeholder DTOs — wired with class-validator in Phase 1` + `export {}`.
Dead file, still imported by nothing. **placeholder/mock**.

---

## 2. Defects (file:line)

### D-01 — Custom roles are global across tenants (cross-tenant read + write + delete)
`apps/api/prisma/schema.prisma:892-906` — `model Role` has **no `tenantId`**, only optional `schoolId`.
`apps/api/src/modules/identity/roles.controller.ts:106` admits it: `// we don't have a tenant_id on Role yet — Phase 2 will add it`.

Consequences, all reachable today:
- `roles.controller.ts:69` `list()` → `prisma.role.findMany()` with **no where clause**. Every admin of every tenant sees
  every other tenant's custom roles and their full permission sets.
- `roles.controller.ts:154` `update()` → `findUnique({where:{id}})`, **no tenant check**. Tenant A's admin can PATCH
  tenant B's role (rename it, rewrite its permission set).
- `roles.controller.ts:201` `remove()` → same, **no tenant check**. Cross-tenant delete.
- `roles.controller.ts:107` slug-uniqueness is checked globally (`{slug, schoolId: null}`) → tenant B cannot create a role
  whose slug tenant A already took (cross-tenant namespace squatting / enumeration oracle).
- `users.service.ts:48` `assignRole()` validates the *user*'s tenant (line 46) but **not the role's** — a foreign-tenant
  role id can be attached to a local user.
- `invite.controller.ts:139` `role.findFirst({where:{slug}})` — same, unscoped.

Live evidence: `SELECT count(*) FROM tenant` → **2**; `SELECT ... FROM role` → 3 rows, all `school_id = NULL`.
Classification: **defective** (multi-tenancy breach).

### D-02 — `PermissionsGuard` hits the DB on every guarded request, no cache
`apps/api/src/shared/auth/permissions.guard.ts:28` → `users.effectivePermissions()` →
`user-sync.service.ts:71-79` runs a `userProfile.findUnique` with a **3-level nested include**
(`userRoles → role → rolePermissions → permission`) on *every single guarded request*.
Additionally most controllers then call `ensureUser(jwt)` again (`users.controller.ts:33`, `roles.controller.ts:105`,
`schools.controller.ts:91`, `me.controller.ts:69`), a **second** round-trip for the same row.
So a plain `GET /api/v1/users` costs ≥3 queries before any business query. ADR-015 explicitly required
"cacher avec Redis (TTL court)" — not implemented. Classification: **exists-but-incomplete** (N+1 / hot-path).

### D-03 — Privilege escalation: an admin can mint a role carrying permissions they do not hold
`roles.controller.ts:110-116` (create) and `:169-177` (update) validate only that the requested codes *exist* in the
`permission` table. There is **no** "you may not grant what you don't have" check against the caller's effective set.
Combined with `roles.assign` (`users.controller.ts:38`), a `school_admin` can self-grant permissions absent from
`REALM_ROLE_PERMISSIONS.school_admin` — e.g. `grades.write`, `grades.revise`, `attendance.write`, `lessons.write`,
`assessments.delete`, `enrollments.delete`, `guardianships.write`, `students.delete`, `parents.delete`
(`permissions.constants.ts:144-220` vs `:5-133`). Classification: **defective** (privilege escalation).

### D-04 — `POST /auth/register-parent` is public, unthrottled, and self-verifies email
`apps/api/src/modules/identity/register.controller.ts:63-126`.
- No guard, no CAPTCHA, **no rate limiting** — `grep -rn "Throttler" apps/api/src` returns **zero** hits; `@nestjs/throttler`
  is not a dependency. Each POST creates a real Keycloak user (`:94`) + a `user_profile` row (`:112`).
- `:99` `emailVerified: true` and `:101` `requiredActions: []` — the comment at `:91-93` calls it a "Phase 1C dev tradeoff"
  and says production should flip it. It is still `true` on the production image.
- `:79-83` returns `409` **with the email echoed back** → user-enumeration oracle on an unauthenticated endpoint.
- `:106-110` hardcodes `DEMO_TENANT_SLUG = 'demo'` — every self-registered parent, in any deployment, lands in the
  `demo` tenant regardless of which school they belong to.
Classification: **defective** (abuse surface + multi-tenancy).

### D-05 — Permission catalog drift: 18 codes granted by role but ungrantable by the role builder
`permissions.constants.ts` defines **89** codes. `apps/api/prisma/seed.ts` seeds **68**. The live `permission` table
holds **71**. `GET /roles/permissions/catalog` (`roles.controller.ts:90`) reads the **table**, so the role builder can
never offer, and `POST /roles` rejects with `400 Permissions inconnues` (`:113-116`), these 18:

```
alerts.read            alerts.write           analytics.read.self    announcements.read.self
assessments.read.self  attendance.read.self   exports.execute.parent exports.execute.teacher
grades.read.self       guardianships.claim    meeting_requests.read  meeting_requests.write
messaging.moderate     messaging.read         messaging.write        remediation.book
remediation.manage     remediation.read
```

`messaging.*`, `alerts.*`, `meeting_requests.*`, `remediation.manage` **are** granted to `school_admin` through
`REALM_ROLE_PERMISSIONS` (`permissions.constants.ts:198-216`), so the platform enforces permissions that its own
admin UI cannot express. Live DB also lacks the `student` and any `super_admin` role row that `seed.ts:185-193`
now creates → the running database was seeded from an older `seed.ts` and never re-seeded.
Classification: **defective** (source-of-truth drift, code-level *and* data-level).

### D-06 — Role grant/revoke writes no audit row (ADR-015 mandates it)
`apps/api/src/modules/identity/users.service.ts:43-78` — `assignRole()` and `revokeRole()` contain **zero**
`auditLog.create`. ADR-015 Action Item 5: "Audit log obligatoire sur changements `user_role`".
By contrast `roles.controller.ts` audits create/update/delete of the *role*, and `invite.controller.ts:150` audits the
invite. So the single most security-relevant mutation in the product — granting a permission set to a human — is the
one that leaves no trace. Classification: **defective**.

### D-07 — Audit actor role is hardcoded to `school_admin`
`invite.controller.ts:154`, `roles.controller.ts:135`, `:185`, `:219` all write `actorRole: 'school_admin'` literally,
regardless of the caller's real realm roles. A `super_admin` deleting a role is logged as a `school_admin`.
Live evidence: `SELECT count(*) FILTER (WHERE actor_role='school_admin') FROM audit_log` → **54 of 63 rows**.
Note `analytics.controller.ts:293-298` (snapshot rebuild) derives `actorRole` correctly from the JWT — so the correct
pattern exists in the codebase and was simply not applied here. Classification: **defective** (falsified audit trail).

### D-08 — Invite flow is non-atomic; failures leave orphans
`invite.controller.ts:95-135`:
- `:95` creates the Keycloak user. `:110` sends the email. If the email throws, `:119` returns `400` **but the Keycloak
  user is kept and no `user_profile` row is created** → an orphan identity invisible to `/admin/users` that can still
  attempt a login.
- If `:126` `userProfile.create` throws (e.g. duplicate email in the local table), the Keycloak user is again orphaned;
  there is no compensating delete.
- `:138-147` silently ignores an unknown `customRoleSlug` (`if (role)` with no else) — the admin is told the invite
  succeeded and the business role was never attached.
Classification: **defective**.

### D-09 — Wrong password is misreported as "MFA required" on every portal
`apps/web/src/auth.ts:198-212`. The OTP heuristic runs **first** and matches on `desc.includes('credential')`:

```ts
if (desc.includes('otp') || desc.includes('totp') ||
    desc.includes('credential') || desc.includes('verification')) {
  throw new CredentialsLoginError('otp_required');
}
if (res.status === 401 || body?.error === 'invalid_grant') { ... invalid_credentials ... }
```

Keycloak's direct-grant error for a bad password is `error_description: "Invalid user credentials"` — it **contains
"credential"**, so the `invalid_credentials` branch on `:209` is unreachable for the ordinary wrong-password case.
Live confirmation of the string shape (bad client secret, same code path):
`401 {"error":"unauthorized_client","error_description":"Invalid client or Invalid client credentials"}`.
Effect: `PortalLoginForm.tsx:106-112` reveals the TOTP panel and prints
*"Authentification à deux facteurs requise"* to a user who simply mistyped their password — on admin, teacher,
parent and student login. Conversely `"Account is not fully set up"` (invited user with pending required actions)
matches nothing and falls through to *"Email ou mot de passe incorrect"*. Classification: **defective** (high UX/support impact).

### D-10 — Logout does not end the Keycloak session (no RP-initiated logout)
`components/shell/TopbarUserMenu.tsx:67` and the dead `components/UserMenu.tsx:73` call
`signOut({callbackUrl})` only. There is **no** call to Keycloak's `end_session_endpoint` anywhere
(`grep -rn "end_session" apps/web/src` → 0 hits) and no `id_token_hint` is retained in the NextAuth token
(`auth.ts:293-315` stores `access_token`/`refresh_token` only).
Result: after "Se déconnecter", the Keycloak SSO cookie survives; clicking *"Se connecter via SSO Keycloak"*
(`PortalLoginForm.tsx:277-285`) re-authenticates silently with no credentials. `onSsoLogin` passes
`{prompt:'login'}` as the *third* argument to `signIn` (`PortalLoginForm.tsx:136`), which NextAuth treats as
authorization params — the mitigation is at best accidental and does not apply to a direct URL re-entry.
Classification: **defective** (shared-workstation session leak).

### D-11 — Middleware never checks `session.error`; dead sessions keep browsing
`apps/web/src/middleware.ts:87` gates only on `session?.user`. `auth.ts:324/346/356` set
`token.error = 'NoRefreshToken' | 'RefreshFailed' | 'RefreshException'` and `:364` propagates it to the session, but
nothing reads it. A user whose Keycloak refresh has failed keeps rendering admin pages until a server component
happens to hit the API and eat the 401 redirect in `api-client.ts:65-68`. Pages that wrap calls in `safe()`
(audit, establishment, settings) never redirect at all — they render as "empty". Classification: **defective**.

### D-12 — Middleware declares 9 auth routes that do not exist (live 404)
`apps/web/src/middleware.ts:29-42` lists `/admin/forgot-password`, `/admin/reset-password`, `/admin/accept-invite`,
`/teacher/forgot-password`, `/teacher/reset-password`, `/teacher/accept-invite`, `/parent/forgot-password`,
`/parent/reset-password`, `/parent/verify-email`. None has a `page.tsx`. Probed live against `pilotage_web`:

```
/admin/forgot-password  -> 404      /teacher/forgot-password -> 404
/admin/reset-password   -> 404      /parent/verify-email     -> 404
/admin/accept-invite    -> 404      /parent/reset-password   -> 404
/admin/login            -> 200      /admin/register          -> 200
```

The real "Mot de passe oublié" link bypasses the app entirely and points at Keycloak
(`PortalLoginForm.tsx:32-40`), so the middleware entries are pure dead configuration. There is **no in-app
accept-invite landing** at all, even though `invite.controller.ts:108` redirects the invited user to
`/admin/dashboard` after the Keycloak action — the invitee lands on a dashboard with no onboarding.
Classification: **placeholder/mock** (dead config) + missing accept-invite surface.

`[SAME-CLASS +]` `/student/login` also returned **404** live despite existing in source — same stale-image class as the
already-confirmed `child-claims`/`integrations`/`remediation` 404s.

### D-13 — User-menu links to routes that do not exist
`components/shell/TopbarUserMenu.tsx:45` → `/${portal}/profile`. `app/admin/profile`, `app/teacher/profile`,
`app/parent/profile` **do not exist** → "Mon profil" 404s on three portals. The file's own comment at `:33-35`
says the student entries were removed "so the menu never links to a 404" — the same bug was left in place for the
other three. `:58` → `/help`; `app/help` does not exist → "Centre d'aide" 404s on all four portals.
`components/shell/sidebar-items.ts:175` → `/admin/reports`; `app/admin/reports/page.tsx` does not exist
(only missing href out of the 63 sidebar links).
Classification: **visible-but-non-functional**.

### D-14 — Audit `to` date filter silently drops the selected end day
`analytics.service.ts` `auditList`, the `createdAt` block: `lte: new Date(to)` where `to` arrives as a date-only string
(`AuditPageFilters.tsx:174-179` uses `<input type="date">`, and `QuickRangeButton.apply()` at `:234-238` produces
`toISOString().slice(0,10)`). `new Date('2026-08-01')` is midnight UTC, so every entry written *during* the end day is
excluded. The "Aujourd'hui" quick range (`days=0` → `from == to == today`) therefore returns **zero rows** whenever the
day has any entries. Classification: **defective** (off-by-one).

### D-15 — Three of the four audit KPIs are structurally wrong
`analytics.service.ts` `auditList` KPI block:
- `criticalChanges` uses `action: { in: ['delete','Suppression','Révision','revise'] }` — an **exact** match. The audit
  table stores a mixed taxonomy: live `SELECT action, count(*) FROM audit_log GROUP BY 1` returns French labels
  (`Création` 19, `Validation` 10, `Mise à jour` 9, `Suppression` 9, `Export` 7) **and** dotted codes
  (`assessment.publish` 5, `conversation.create`, `alert.resolve`, `alert.acknowledge`, `meeting_request.resolve`).
  `role.delete` / `role.update` / `user.invite` written by this domain's controllers can never match the `in` list.
- `adminLogins` counts `action contains 'login'` — **nothing in the codebase ever writes a login audit row**
  (`grep -rn "action: 'login" apps/api/src` → 0; the live action list contains no login). The
  "CONNEXIONS ADMIN" card is permanently `0`. Authentication events are entirely unaudited.
- The actor-name lookup is wrapped in `.catch(() => [])`, so a DB error silently degrades every row's actor to `null`.
Classification: **visible-but-non-functional** (KPIs) + **missing** (login auditing).

### D-16 — Audit `ip_address` / `user_agent` / `hash` / `prev_hash` are never written
`schema.prisma:1236-1239` defines all four. 57 `auditLog.create` call sites across the API; **none** sets any of them
(`grep -rn "ipAddress\|prevHash" apps/api/src` finds only the analytics *read* path at
`analytics.service.ts:3226,3300` and a comment at `alerts.service.ts:607`).
Live: `count(*) FILTER (WHERE ip_address IS NOT NULL)` = **0**, `user_agent` = **0**, `hash` = **0**, over 63 rows.
The UI promises all of it: `AuditTable.tsx:84` column header *"Portail · IP"*, `AuditTable.tsx:146-148` IP cell,
`AuditDetailDrawer.tsx:140-149` "User Agent" section, `AuditTable.tsx:179` hint text *"(avant / après, IP, user agent)"*,
and `audit/page.tsx:200` claims the log is *"append-only"* — the tamper-evident `hash`/`prevHash` chain that would
back that claim is unpopulated. Classification: **visible-but-non-functional** + **placeholder/mock** (integrity chain).

### D-17 — `assignRole` in the users table swallows every error (unhandled rejection)
`apps/web/src/app/admin/users/UsersTable.tsx:30-39`:

```tsx
const assignRole = async (userId, roleId) => {
  setBusy(userId); setOpenMenu(null);
  try { await assignRoleAction(userId, roleId); router.refresh(); }
  finally { setBusy(null); }        // <- no catch
};
```

`assignRoleAction` (`users/actions.ts:7-10`) does **not** convert errors to a Result — it lets `ApiError` propagate.
The `onClick={() => assignRole(...)}` at `:122` never attaches a `.catch`, so a 403/409/500 becomes an unhandled
promise rejection: the spinner stops, the menu closes, nothing changes, and the admin gets **no feedback whatsoever**.
Contrast `DeleteRoleButton.tsx:16-21` and `SchoolsManager.tsx:30-33`, which do surface errors.
Classification: **defective**.

### D-18 — Role revocation is backend-only; the action is imported but never called
`UsersTable.tsx:7` imports `revokeRoleAction`; it appears **nowhere else in the file** (dead import).
`DELETE /api/v1/users/roles/{userRoleId}` exists and works. The role chips at `:75-83` have no remove affordance.
An admin can grant a role and can never take it back from the UI. Classification: **backend-only** + dead code.

### D-19 — The users table shows the wrong "Statut"
`UsersTable.tsx:87-99` labels the column *"Statut"* but renders `authLinked` ("Authentifié" / "Jamais connecté").
The real `status` field (`suspended`/`archived`) is fetched (`users/page.tsx:19`, `users.service.ts:35`) and used for
the KPI *"COMPTES DÉSACTIVÉS"* (`users/page.tsx:42,71-73`) — but a suspended user still renders as **"Authentifié"**
in green. The KPI and the table contradict each other on the same screen. Classification: **defective**.

### D-20 — `users.suspend` permission exists, is granted, and has no implementation anywhere
`permissions.constants.ts:31` (catalog), `:167` (granted to `school_admin`), `seed.ts:31,93`. No endpoint, no service
method, no UI control references it (`grep -rn "users.suspend"` returns only those 5 catalog/grant lines).
Same for `parents.delete`, `students.delete` in this domain's UI surface. Classification: **placeholder/mock**.

### D-21 — The custom-role feature cannot actually narrow or grant portal access
`middleware.ts:5-13` gates `/admin/*` on realm roles `super_admin | school_admin` only. Custom roles live purely in the
app DB (`Role` table) and are invisible to Keycloak (ADR-004 says so explicitly). Therefore:
- A user without the `school_admin` **realm** role cannot reach `/admin/*` no matter which custom admin-portal role
  they hold → the "comptable / surveillant / infirmier" use case pitched at `roles/page.tsx:122` and
  `roles/new/page.tsx:32-34` is unreachable.
- A user *with* `school_admin` already carries 70 permissions, so an additive custom role can only *add* to an
  already-near-total set — it can never restrict.
The `portal` radio in `RoleBuilderForm.tsx:191-214` therefore has **no runtime effect** beyond a badge colour.
Classification: **visible-but-non-functional** (feature is decorative in its stated use case).

### D-22 — ADR-015 layers 3 and 4 are unimplemented
`grep -rn "AuthorizeStudentAccess\|AuthorizeTeachingAssignment\|SameTenant\|SameSchool\|@Roles" apps/api/src` → **0 hits**.
`find apps/api/src -name "*.guard.ts" -o -name "*.decorator.ts"` returns exactly four files, all `@RequiresPermission`
plumbing. ADR-015 specifies five decorators and a Postgres-RLS layer 4. Tenant/school coherence is instead hand-written
per controller and is missing wherever the author forgot (see D-01). Classification: **exists-but-incomplete**.

### D-23 — Hardcoded credential fallbacks
- `keycloak-admin.service.ts:45-46` — `KEYCLOAK_ADMIN_USER ?? 'admin'`, `KEYCLOAK_ADMIN_PASSWORD ?? 'admin'`, used at
  `:53-61` against the **master** realm with `grant_type=password`. If the env var is missing the service silently tries
  `admin`/`admin` instead of failing fast.
- `apps/web/src/auth.ts:85` — client secret falls back to the literal `change-me-portal-${clientPortal}`. A misconfigured
  deploy therefore attempts OIDC with a guessable secret rather than erroring.
- `s3.service.ts:26-27` — `S3_ACCESS_KEY ?? 'minio'`, `S3_SECRET_KEY ?? 'miniominio'`.
Classification: **defective** (fail-open configuration).

### D-24 — JWT strategy does not validate audience / authorized party
`shared/auth/jwt.strategy.ts:35-46` sets `issuer` and `algorithms` but **no `audience`**, and `validate()` at `:49-52`
checks only `payload.sub`. The `azp` claim is declared on the payload interface (`:15`) and never read.
Any token minted by any client of the realm (`portal-parent`, `account`, …) is accepted by the API on equal footing
with a `portal-admin` token. Authorization still rests on realm roles, so this is hardening rather than an open door —
but ADR-004's stated benefit ("distinction du portail d'origine dans tokens/logs") is not realised.
Classification: **exists-but-incomplete**.

### D-25 — Zero tests on the entire authN/authZ layer
`find apps/api/src/shared apps/api/src/modules/identity apps/api/src/modules/schools -name "*.spec.ts"` → **empty**.
No spec for `PermissionsGuard`, `JwtStrategy`, `UserSyncService.effectivePermissions`, `KeycloakAdminService`,
`RolesController`, `UsersService`, `SchoolsController`, `middleware.ts`, or `auth.ts`. By contrast `alerts`,
`messaging`, `imports`, `child-claims` and `analytics` each ship multiple spec files. The security kernel is the least
tested code in the repo. Classification: **missing** (test coverage).

### D-26 — `mfaEnabled` is hardcoded `false`
`apps/api/src/modules/identity/me.controller.ts:85` → `mfaEnabled: false`. Typed and consumed as truth by
`apps/web/src/lib/me.ts:13`. Keycloak knows the real TOTP state (`KeycloakAdminService` could read it); nothing asks.
Classification: **placeholder/mock**.

### D-27 — `hasPermission()` exists and is never used — zero client-side permission gating
`apps/web/src/lib/me.ts:52-53` defines `hasPermission(me, code)`. `grep -rn "hasPermission"` across `apps/web/src`
returns only that definition. No page, table, button or menu item in the domain is conditioned on the caller's
effective permissions. Every destructive control renders for everyone; enforcement is 100% server-side and, per D-17,
frequently swallowed on the way back. Classification: **missing**.

### D-28 — Dead code inventory (domain)
| File:line | What |
|---|---|
| `apps/web/src/components/UserMenu.tsx` (whole file, 84 lines) | superseded by `@pilotage/ui` UserMenu via `TopbarUserMenu`; zero importers |
| `apps/web/src/app/admin/roles/actions.ts:67` | `createRoleAndRedirect` — exported server action, zero callers |
| `apps/web/src/app/admin/users/UsersTable.tsx:7` | `revokeRoleAction` imported, never called (D-18) |
| `apps/api/src/modules/identity/dto.ts` | placeholder module, `export {}` |
| `apps/api/src/shared/keycloak/keycloak-admin.service.ts:225-228` | `resetCredentialsUrl` — never called; duplicated client-side at `PortalLoginForm.tsx:32-40` |
| `apps/api/src/shared/keycloak/keycloak-admin.service.ts:161-167` | `setRequiredActions` — never called |
| `apps/api/src/shared/prisma/prisma.service.ts:27-32` | `withTenant` — 1 reference (its own definition) — *previously confirmed* |

Each exported-but-unused **server action** is also a live RPC endpoint reachable by any authenticated session.

### D-29 — Dev-only URLs shipped in the production admin UI
`apps/web/src/app/admin/users/invite/InviteForm.tsx:104` renders *"Vous pouvez le suivre via Maildev
(http://localhost:1080)"* in the success panel, and `:273` renders a live `<a href="http://localhost:1080">` link.
Unconditional — no `NODE_ENV` guard. Classification: **defective** (dev leakage).

### D-30 — Non-atomic permission rewrite + write-loop in role update
`roles.controller.ts:174-177` inside the transaction: `rolePermission.deleteMany` then a **per-permission
`create` in a `for` loop** — N round-trips where one `createMany` would do (a 70-permission role = 71 statements).
Additionally the audit row at `:181-193` is written **outside** the transaction, so a crash between the two leaves the
permission set changed with no audit entry — and `before` only records `{name}`, never the previous permission set,
so the audit cannot answer "what permissions did this role have yesterday".

### D-31 — Silent-error-as-empty-state on three pages
`audit/page.tsx:40-47` + `:83-88`, `establishment/page.tsx:75-82`, `settings/page.tsx:24-31` all define
`safe()` which converts **any** `ApiError` (403, 404, 500) to `null`, then render the "empty" branch.
On `/admin/audit` a permission-denied or API-down condition is indistinguishable from "no audit entries yet"
(`audit/page.tsx:174-184` prints *"Les actions sensibles seront enregistrées ici"* with four zeroed KPIs).
On `/admin/establishment` every field degrades to `—`. Classification: **defective** (error state absent).

### D-32 — Schools mutations produce no audit trail
`schools.controller.ts:113` (create), `:135` (update), `:161` (delete/soft-close), `:180` (switch active) —
**no `auditLog.create` in the entire controller**, while the comment at `:175` justifies the soft-close as
"to preserve audit trail". Renaming or closing an établissement leaves no record. Classification: **defective**.

---

## 3. Control-level inventory per page

### `/admin/users` — `app/admin/users/page.tsx` + `UsersTable.tsx`
- **KPI cards (4)**: Utilisateurs actifs, Invitations envoyées, Comptes désactivés, Rôles configurés
  (`page.tsx:65-76`) — all computed client-of-server from the full list.
- **Table columns (4)**: Utilisateur (avatar+initials+email), Rôles assignés, **Statut** (wrong field — D-19), Action.
- **Filters / search / sort / pagination / bulk actions**: **none**. `UsersService.list()` returns *every* user of the
  tenant unpaginated (live `user_profile` = 190 rows).
- **Actions**: `Inviter un utilisateur` → `/admin/users/invite`; per-row `Assigner un rôle` dropdown
  (`UsersTable.tsx:102-132`) listing **all** roles with no portal filtering, already-assigned entries disabled.
- **Modals/drawers**: none (a plain absolute-positioned menu with a `fixed inset-0` click-catcher, no focus trap,
  no `Escape` handler, no `aria-expanded`).
- **Empty state**: yes (`:137-143`). **Loading**: per-row spinner only. **Error state**: **none** (D-17).
- **Guards**: server `users.read` / `roles.assign`; client — none.
- Aside panel: "Rôles système" list + link card to `/admin/roles`.

### `/admin/users/invite` — `page.tsx` + `InviteForm.tsx`
- **Form fields**: Prénom*, Nom*, Email professionnel* (`type=email`, `required`), Rôle principal radio-cards
  (Administrateur / Professeur / Parent — **no Élève**, though the student portal ships), optional custom business
  role radio list filtered by portal (`:65-69`).
- **Validation**: HTML `required` only client-side; real validation server-side (`InviteUserDto`, `invite.controller.ts:23-47`).
- **States**: `idle | sending | sent | error`; success panel `:95-109` then `setTimeout(2500)` redirect with no cleanup.
- **Preview panel**: "Ce qui va se passer" 4–5 steps, MFA step conditional on role (`:251-253`).
- Dev URL leakage — D-29.

### `/admin/roles` — `page.tsx`, `RoleBuilderForm.tsx`, `DeleteRoleButton.tsx`, `actions.ts`
- **KPI cards (4)**: Rôles système, Rôles personnalisés, Rôles admin, Permissions totales.
- **Sections**: system roles grid (read-only) + custom roles grid with a proper **empty state** (`:87-100`).
- **Per-card actions**: `Voir` (system → `/[id]` → 307 → `/[id]/edit` → amber "not editable" banner) /
  `Éditer` (custom); `Supprimer` (custom only) with `window.confirm` + `window.alert` error surfacing
  (`DeleteRoleButton.tsx:14,19`) — native dialogs, no design-system modal.
- **Role builder form** (`RoleBuilderForm.tsx`): Nom*, Slug* (auto-sanitised `[a-z0-9_]`, max 40, **disabled in edit**),
  Description (textarea), Portail radio (3 options, **disabled in edit**, no runtime effect — D-21),
  permission matrix grouped by `resourceType` with a **search filter** (`:260-267`), per-group
  "Tout sélectionner / Tout décocher" (`:289-295`), live "Récapitulatif" counters (`:219-231`).
- **Client validation** (`:118-120`): name ≥2, slug ≥2, ≥1 permission. **Error banner** `:235-237`. **Saving state** `:243`.
- **Empty filter state**: `:332-336`.
- **Gaps**: `RESOURCE_LABEL` (`:13-47`) is missing `alert`, `meeting_request`, `conversation`, `remediation`,
  `class_session` → those groups render their raw snake_case type (they are also absent from the DB catalog — D-05).
  No "you cannot grant what you lack" guard (D-03). No confirm-on-permission-downgrade.
- **Guards**: server `roles.read` / `roles.write`; client — none.

### `/admin/audit` — `page.tsx`, `AuditPageFilters.tsx`, `AuditTable.tsx`, `AuditDetailDrawer.tsx`, `actions.ts`
- **KPI cards (4)**: Actions aujourd'hui, Modifications critiques (broken — D-15), Exports sensibles,
  Connexions admin (always 0 — D-15).
- **Filters**: free-text action search; `resourceType`, `portal`, `actorId` select-filters populated from
  `/audit-facets`; `from` / `to` date inputs; quick ranges Aujourd'hui / 7 j / 30 j / 90 j; "Réinitialiser";
  active-filter chips with individual clear (`:189-220`). URL-state driven via `router.push`.
- **Table columns (6+1)**: Date & heure (absolute + relative), Utilisateur (name + role), Action (icon + tone badge),
  Ressource (humanised + truncated id), Détails, Portail · IP (**IP always empty** — D-16), chevron.
- **Sort**: fixed `createdAt desc`, not user-controllable. **Bulk actions**: none. **Row action**: click → drawer.
- **Drawer** (`AuditDetailDrawer.tsx`): actor card, portal card, resource type+id, Détail, User Agent
  (**always absent** — D-16), and Avant/Après JSON panels with "Copier JSON" (`:227-235`).
- **Export**: `Exporter en CSV` → `exportAuditAction` enqueues `kind:'audit_csv'` then **redirects to `/admin/exports`
  swallowing any error** (`actions.ts:20-24`, comment admits it).
- **Pagination**: `Pagination` component, `PAGE_SIZE = 20`, API caps `take` at 200.
- **Empty state**: yes, filter-aware (`:174-184`) — but doubles as the error state (D-31).
- **Guards**: server `audit.read` on both endpoints; client — none.
- Page still 500s on render per the previously-confirmed client/server boundary violation at `page.tsx:16,92,97`.

### `/admin/settings` — `page.tsx`, `PreferencesPanel.tsx`, `DisplayPreferencesPanel.tsx`
- **7 tabs**: Général, Identité visuelle, Notation, Notifications, Sécurité, Données & confidentialité, Exports.
- **Only "Notifications" is functional.** `PreferencesPanel.tsx` (551 lines): per-kind × per-channel toggle matrix
  (`role="switch"` buttons at `:389-409`), per-column bulk "tout activer/désactiver" (`:283-291`), header
  "Tout mettre en sourdine / Tout réactiver" cadence bulk (`:215-234`), per-kind cadence radio group
  (`:498-539`, `instant | daily_digest | off`), muted "—" placeholder for inapplicable cells (`:373`).
  Optimistic with per-kind partial-failure reconciliation (`preferences-actions.ts:76-104,118-145`).
- **The other 6 tabs are hardcoded literal strings** with no data source and no controls
  (`page.tsx:81-84, 100-102, 118-121, 139-148, 165-169, 187-190, 206-209`). The **Sécurité** tab asserts
  *"MFA pour admins : Obligatoire"*, *"Verrouillage automatique : 5 tentatives"*, *"Durée session : 8 h"*,
  *"Longueur min. mot de passe : 12 caractères"* — none of it is read from Keycloak; the realm is never queried.
  The **Données & confidentialité** tab asserts retention periods (5 ans / 10 ans) with no retention job in the repo.
  Classification: **placeholder/mock** — the page's own footer (`:221-225`) concedes this.
- **`DisplayPreferencesPanel` is not mounted on the admin settings page.** It lives in
  `app/admin/settings/DisplayPreferencesPanel.tsx`, its server action revalidates `/admin/settings`
  (`display-prefs-actions.ts:20`), and it is rendered **only** by `parent/settings/page.tsx:189` and
  `teacher/settings/page.tsx:176`. Admins have no densité / accent / date-format / grade-format control although
  `GET|PATCH /api/v1/me/display-preferences` fully supports them. Classification: **frontend-only asymmetry /
  backend-only for admins**.

### `/admin/establishment` — `page.tsx`
- **KPI cards (4)**: Établissement, Année en cours, Langue & fuseau, Pays.
- **6 tabs**: Général (read-only, defers to `/admin/schools`), Adresse & localisation (**read-only — the empty state at
  `:299-309` literally instructs the admin to use the API**, while `PATCH /schools/:id` accepts a structured `address`),
  Hiérarchie & cycles (read-only + a **static** `STANDARD_CYCLES` reference block, `:88-124`),
  Identité visuelle (**the only editable surface** — `BrandingForm`), Notation (**fully hardcoded**: "/ 20", "10 / 20",
  "1" — `:507-509`), Année active (read-only).
- **Empty states**: address (`:299-309`), cycles (`:363-373`), branding load failure (`:492-494`), no active year (`:543-552`).
- **Error state**: none — `safe()` degrades everything to `—` (D-31).
- `:376-377` sorts `schoolCycles` **in place**, mutating the array derived from the fetched payload.
- **Guards**: server per underlying endpoint; client — none.

### `/admin/schools` — `page.tsx`, `SchoolsManager.tsx`, `actions.ts`
- **Cards grid**, one per school: name, code, country, status pill, Élèves / Années counters, "Active" badge.
- **Actions**: `Nouvelle école` (inline form: Nom, Code, Pays ISO-2 only — **no timezone / locale / address**, all of
  which the API accepts), `Définir comme école active` per non-active card.
- **Validation**: client `!name.trim() || !code.trim()` only; server requires `name ≥ 2`, `schoolCode ≥ 2`,
  `country` exactly 2 → a 1-char name 400s with no client hint.
- **Error state**: yes, single banner (`:52`). **Empty state**: **none** — zero schools renders a bare grid.
- **Loading**: a single global `busy` flag disables **every** card's button at once (`:22,138`).
- **Missing**: no edit, no archive/close, no delete, no search/filter/sort, no pagination, no confirmation on switch —
  `PATCH /schools/:id` and `DELETE /schools/:id` are **backend-only**.
- `SchoolsManager.tsx:8` imports a type from the server page module (`import type { SchoolItem } from './page'`) —
  type-only so erased at build, but a fragile client↔server-module coupling of the same class as the confirmed audit bug.

---

## 4. Classification summary

**Fully operational**
JWT verification via JWKS with issuer pinning + split public/internal issuer (`jwt.strategy.ts`);
`@RequiresPermission` metadata → `PermissionsGuard` AND-semantics; global `ValidationPipe` (whitelist +
forbidNonWhitelisted) + helmet + CORS allow-list (`main.ts:14-26`); portal↔realm-role routing in `middleware.ts`
with disjoint student set; NextAuth ROPC + OIDC dual login with silent refresh (`auth.ts:317-358`);
role CRUD create/update/delete with server-side system-role protection and in-use-check
(`roles.controller.ts:156,206,207-211`); schools list/create/switch-active; notification preferences panel
(matrix + bulk + cadence + partial-failure reconciliation); audit list/facets/filters/pagination/drawer;
Keycloak invite (user creation + realm-role grant + execute-actions email); parent self-registration happy path;
`me` provisioning-on-first-call; display-preferences API + panel (on teacher/parent).

**Exists-but-incomplete**
`PermissionsGuard` DB hit per request, no cache (D-02); JWT audience/`azp` unvalidated (D-24);
ADR-015 ABAC decorators + `@Roles` absent (D-22); audit `before` payloads record only `{name}` (D-30);
users list unpaginated/unfiltered; role builder catalog missing 5 resource labels.

**Visible-but-non-functional**
Audit IP / User-Agent columns and drawer section (D-16); "Modifications critiques" and "Connexions admin" KPIs (D-15);
"Mon profil", "Centre d'aide", "Rapports" nav entries (D-13); role `portal` selector (D-21);
establishment Adresse / Notation / Général / Année tabs (read-only shells).

**Backend-only**
`DELETE /users/roles/:id` (revoke) — no UI (D-18); `PATCH|DELETE /schools/:id` — no UI;
school `timezone`/`locale`/`address` create+update fields — no UI;
`GET|PATCH /me/display-preferences` for the **admin** portal — no UI (panel exists but is not mounted).

**Frontend-only**
None found — every rendered control in this domain has a real endpoint behind it, when it has one at all.

**Placeholder / mock**
`identity/dto.ts`; `mfaEnabled: false` (D-26); settings tabs Général/Branding/Notation/Sécurité/Données/Exports (6 of 7);
establishment "Notation" tab; audit `hash`/`prevHash` integrity chain; `users.suspend` permission (D-20);
middleware's 9 non-existent auth routes (D-12); `resetCredentialsUrl` + `setRequiredActions` + `withTenant` +
`createRoleAndRedirect` + `components/UserMenu.tsx` (D-28).

**Defective**
D-01 cross-tenant roles · D-03 privilege escalation · D-04 public unthrottled registration · D-05 catalog drift ·
D-06 unaudited role grants · D-07 falsified `actorRole` · D-08 non-atomic invite · D-09 wrong-password→MFA
misclassification · D-10 no RP-initiated logout · D-11 `session.error` ignored · D-14 audit `to` off-by-one ·
D-17 swallowed assign-role errors · D-19 wrong Statut column · D-23 hardcoded credential fallbacks ·
D-29 Maildev URL in prod UI · D-30 non-atomic permission rewrite · D-31 error-as-empty-state ·
D-32 unaudited schools mutations.

**Missing**
Login/logout audit events; role-change audit (D-06); client-side permission gating (D-27); accept-invite landing page;
`/{portal}/profile` and `/help` pages; `/admin/reports`; any test whatsoever on the auth layer (D-25);
rate limiting on the public registration endpoint; user suspend/reactivate; user edit; role revoke UI;
school edit/archive UI; RLS policies (previously confirmed).
