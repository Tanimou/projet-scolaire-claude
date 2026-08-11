# ADR-035 — The audit row is written inside the mutation's transaction, through one typed seam

- **Status**: Accepted
- **Date**: 2026-08-09
- **Slice**: S-E04-6 (epic V3-E04 — audit trail and governance surfaces)
- **Finding**: PF-31 *(missing-row / transactionality half)* · **Gates**: G-AUDIT (primary), G-TENANT,
  G-AUTHZ, G-DNC · **DNC**: DNC-10
- **Supersedes nothing.** Extends ADR-002 (tenant scoping), ADR-015 (permission model),
  ADR-036 (audit provenance) and ADR-037 (audit vocabulary). Transcribes the ruling already recorded in
  `docs/spec/features/v3-e04/plan.md` §5; it invents nothing beyond it.
- **Number re-checked against `docs/adr/` on 2026-08-09, immediately before this file was created.** The
  directory held `001`–`004`, `013`–`028`, `036`, `037`. `035` was free and is this epic's standing
  reservation (`architecture-impact.md` §4, renumbered from `028` by PF-110).
- **Scope of this file, and what S-E04-8 appends.** The reservation names three subjects: *audit
  in-transaction*, *chain genesis*, and *the accepted pre-V3 gap*. **Only the first is decided here.**
  `data-model.md` §4 says the whole ADR lands "avec la slice chaîne" — that line is now stale:
  `PROGRESS.md` §144–146 has it right, `S-E04-6` writes the file and `S-E04-8` **amends** it with **D15
  onward** (genesis, field list, hash function, serialisation, A-01). Nothing below constrains those.
  **Reservation corrected by `S-E04-7`.** This line originally reserved *D-8…D-11 and D-18…D-20* for
  `S-E04-8`, while the shipped file already contained **D8, D9 and D10**, written by `S-E04-6` — the
  reservation was violated before it was ever read. `S-E04-7` is the first amender and therefore uses
  **D11–D14** and moves the reservation clear of them, so the next amendment cannot land on a collision.
  **Reservation corrected again by `S-E04-9`.** `D15` was claimed three times — by the reservation above, by
  `PROGRESS.md:1715` (the carried `revokeRole` record owed to `S-E04-9`), and by this slice. The amender that
  lands defines the allocation: `S-E04-9` takes **D15–D17**, the carried `revokeRole` / `isSchoolUpdateNoOp`
  documentation correction takes **D18**, and **`S-E04-8` reserves D19 onward**.

---

## Context — an audit row that can be absent is not an audit trail

Measured on this branch (2026-08-09):

| Population | Count | What it means |
|---|---|---|
| `tx.auditLog.create` inside a `$transaction` | 6 | the row and the mutation commit or roll back together |
| `this.prisma.auditLog.create` outside one | 20+ | the mutation can commit and the row can fail, or vice versa |
| Privileged families writing **no row at all** | 3 | role grant/revoke, every `modules/schools/` mutation, every `modules/enrollments/` mutation |

`identity/roles.controller.ts` `create()` is the exhibit: `prisma.role.create(...)` then a **separate**
`prisma.auditLog.create(...)`. A crash, a connection reset or a `@db.Inet` cast failure between the two
leaves a role that exists and was never recorded as having been minted. Nobody is alerted; the trail simply
has a hole shaped exactly like the event a DPO would come looking for.

Pilotage handles children's data. GUARDRAILS §1 makes append-only audit non-negotiable, and an audit trail
whose completeness depends on nothing going wrong between two statements does not satisfy that. The three
families that write nothing are worse still: for role grants — the single highest-privilege mutation in the
product — the trail is not incomplete, it is empty.

---

## D1 — One seam, whose first parameter cannot be the root client

`plan.md` §5 specifies the signature and states its reason as follows: *« Because the first parameter is a
transaction client, `writeAudit(this.prisma, …)` is a type error. »*

**That reason, as written, is false, and the slice must not ship on it.**
`Prisma.TransactionClient` is `Omit<PrismaClient, ITXClientDenyList>`. `Omit` **removes** members; it does
not forbid them. TypeScript is structural and does not apply excess-property checking to anything but a
fresh object literal, so a `PrismaClient` — which has every remaining member and some more — is **assignable
to** `Omit<PrismaClient, …>`. `writeAudit(this.prisma, …)` would compile cleanly, and the invariant this
epic's primary gate rests on would be a review convention wearing a type's clothes. That is the exact
failure shape V3-E04 is named after: a guard that is green because it cannot fire.

The parameter order is kept — it is the right shape and it matches the four existing
`Prisma.TransactionClient` sites in this repo (`child-claims.service.ts:717`,
`academic-years.controller.ts:280`, `calendar-seed.service.ts:260`, `imports-core/handler.types.ts:29`) —
but the type is **branded so the deny-list becomes load-bearing**:

```ts
// apps/api/src/shared/audit/write-audit.ts

/**
 * A transaction client, and *provably not* the root client.
 *
 * `$transaction?: never` is the whole mechanism: `Prisma.TransactionClient` omits the
 * key, so it is absent and the optional member is satisfied; `PrismaClient` (and
 * `PrismaService extends PrismaClient`) declares it as a method, which is not
 * assignable to `never`. Do not "simplify" this back to a bare
 * `Prisma.TransactionClient` — see the paragraph above for what that silently allows.
 */
export type AuditTransactionClient = Prisma.TransactionClient & { readonly $transaction?: never };

export async function writeAudit(
  tx: AuditTransactionClient,
  input: AuditWriteInput,
): Promise<void>;
```

**And the brand is proven, not asserted.** The generated Prisma client is not present in a fresh checkout
(the `prisma generate` RED gate), so no reviewer can confirm this by reading. The slice therefore ships a
deliberate negative type test in `write-audit.spec.ts`:

```ts
// @ts-expect-error — ADR-035 D1: the root client must NOT satisfy AuditTransactionClient.
await writeAudit(prisma, input);
```

A `@ts-expect-error` on a line that *does* compile is itself a compile error, so the single `pnpm typecheck`
run the test-architect performs decides the question in both directions. If it turns out the brand does not
bite, that is a **red gate and a design change**, not a comment to soften.

Belt and braces: `S-E04-7`'s `scripts/audit-write-check.js` already owes a rule that fails on *« any
`writeAudit` call not given a transaction client »*. D1 is the compile-time half; that ratchet is the
textual half. Neither replaces the other.

**Rejected: a Nest interceptor.** The ruling recorded at `modules/calendar/calendar.controller.ts` and
restated in `shared/audit/provenance.ts` stands — *« Aucun intercepteur partagé n'est construit »*. An
interceptor cannot see the transaction the handler opened, cannot know the `before` state, and is a place a
future author forgets to apply. `shared/audit/` stays a **plain-function area** with no Nest module, like
`shared/config/` and `shared/release/`; adding a module here would force ~26 feature modules to import it,
which is itself a new cross-cutting decision nobody asked for.

**Rejected: a Prisma `$extends` / middleware that audits every write.** It would invent an actor it cannot
observe, and would write rows for reads-turned-writes nobody classified. ADR-037's vocabulary is a
*declared* list; a middleware would have to guess codes.

---

## D2 — Audit failure fails the mutation. This is deliberate, and it is a real availability trade

AC-2's second direction is not a test artefact, it is the decision: if `writeAudit` throws, the enclosing
transaction rolls back and the privileged mutation **does not persist**. A role grant that could not be
recorded does not happen.

The cost is stated rather than discovered later: **the audit write is now on the critical path of five
privileged families.** A malformed value that Postgres rejects — the historical example is a non-`inet`
string reaching the `@db.Inet` column — would take down role grants, not just their logging.

The mitigation is structural, and it is why D3 exists.

---

## D3 — Provenance is sanitised **before** the transaction opens; `writeAudit` normalises nothing

`writeAudit` performs exactly one statement: the insert. It does not read a header, does not read
`process.env`, does not call `Intl`, does not trim, truncate or validate an address. Everything that can
reject a value runs **outside** the transaction, in the seams that already exist:

- `extractAuditClientHints(req)` (`shared/audit/client-hints.ts`, S-E04-3) — the one place a header or
  socket address is read, and where `sanitiseInetOrNull` / `truncateUserAgent` run.
- `deriveAuditProvenance(jwt, hints)` (`shared/audit/provenance.ts`, S-E04-1) — the one place a realm role
  becomes an `actorRole` and a `portal`. It **never throws**, by construction.

This is the same reasoning `provenance.ts` already records for the import path: *« Comme la ligne d'audit
est écrite DANS la même transaction que l'import, un cast raté ferait rouler en arrière un import
parfaitement valide : l'hygiène deviendrait un mode de panne pour l'écriture qu'elle est censée tracer. »*
D2 makes that hypothetical real for five more families, so D3 is not optional hygiene — it is what keeps
D2's blast radius at "a bug in the sanitiser" rather than "any unusual user-agent".

**Consequence for reviewers:** a future `writeAudit` that starts validating its input is a regression, not
a hardening. Validation belongs at the extraction seam.

---

## D4 — Provenance is carried into the service, not re-derived there

Services do not see the request. Controllers extract hints and derive provenance, then pass an
`AuditProvenance` down — exactly as `imports.service` and `integrations.service` already widen their
`actor` parameter with `AuditActorProvenance`. The four fields are **non-optional** in the input type, so a
caller that forgets one is a compile error rather than a silently null provenance at runtime.

`identity/users.service.ts` (`assignRole`, `revokeRole`) therefore widens its signature; `users.controller.ts`
does the plumbing. No service reads `@Req()`.

---

## D5 — Non-transactional mutations become transactional; the notification fan-out stays outside

Four of the touched handlers had no transaction at all (`schools.controller` create/update/remove,
`enrollments.controller` create/update/remove) and one used the **array** form
(`enrollments.controller` `transfer`, `$transaction([...])`), which admits no second statement. All become
the interactive callback form.

**What must NOT move inside:** `notifyGuardiansOfEnrollment` and the assessment publish fan-out. They issue
their own queries, they deliberately swallow their errors, and they are best-effort by design. Inside the
transaction they would hold it open for the duration of a fan-out and their swallowed failure would become
invisible; worse, under D2 a notification bug would start rolling back enrollments. The boundary is:
**mutation + audit inside; notification after commit.**

---

## D6 — `resourceType`/`action` come from `@pilotage/contracts/audit`, and the vocabulary gate learns the new seam

ADR-037 made `packages/contracts/src/audit/vocabulary.ts` the single declaration. Every code this slice
writes is added there — none is invented locally.

There is a mechanical consequence that is easy to miss and that this ADR records so the next slice does not
re-discover it. `audit-vocabulary-gate.spec.ts` derives the *written* set with a TypeScript AST walk that
recognises `…auditLog.create({ data: { action, resourceType } })` and then resolves **forwarders** — helpers
that relay an `action` into a seam — **scoped to the declaring file**, because all six known forwarders are
`private` methods of one class.

`writeAudit` breaks that assumption: it is an **exported, cross-file** forwarder. Left alone, the gate would
register it as a forwarder, find no call sites in `write-audit.ts`, lose every code routed through it, and
then the *reverse* completeness direction would demand that the corresponding real labels be **deleted**.
So the gate is amended in the same diff, in two ways:

1. forwarder resolution for the shared seam is **repo-wide** (the "private method" rationale explicitly does
   not apply to it), and `apps/api/src/shared/audit/write-audit.ts#writeAudit` joins the pinned forwarder list;
2. the call convention becomes part of the contract: **`writeAudit` is called with an inline object literal.**
   Passing a pre-built variable makes the code invisible to the extractor. A named assertion pins one code
   per new family, in the style of V-1's "five hard literal shapes".

Also amended, and this one is a hard red if missed: V-1's `the 7 keys nobody writes are gone, by name`
asserts `enrollment` is **neither declared nor written**. It was an orphan label in S-E04-4 because nothing
wrote it. This slice makes it real. The assertion is narrowed to the codes that are still orphans, with the
reason written down — not deleted.

---

## D7 — PF-96 is **stated, not changed**: `AuditLog` has no foreign key to `Tenant`

`AuditLog.tenantId` is a bare `String @db.Uuid` with an index and **no relation** to `Tenant`
(`schema.prisma:1233-1252`). Audit rows therefore outlive their tenant, and no database constraint prevents
a row carrying a `tenantId` that no longer resolves.

**This slice does not add the relation, and that is the decision, not an omission.** Adding
`tenant Tenant @relation(...)` gives the relation a default referential action; a reflex `onDelete: Cascade`
would let deleting a tenant **erase its own audit history**, which is the exact opposite of what an
append-only governance trail is for. `onDelete: Restrict` is defensible but turns tenant deletion into an
operation that can never complete, which is a retention-policy decision this epic explicitly does not own
(`tasks.md` § *Out of scope*, D-08-adjacent).

What is required instead, and what this slice does deliver: **`tenantId` is non-optional in
`AuditWriteInput`** and is always the tenant resolved from the authenticated caller
(`UserSyncService.ensureUser(jwt).tenantId`), never a value taken from a path parameter or a body. Tenant
correctness is enforced at the writer, in code and in tests, rather than by a constraint that does not
exist. PF-96 stays **open**, owner: whichever slice takes retention.

`G-MIGRATION` does not trigger in this slice: no column, no constraint, no index, no `schema.prisma` edit.

---

## D8 — DNC-10: there is no off switch, and nothing switchable is in scope

`write-audit.ts` reads no `process.env`, no `ConfigService`, no feature flag, no `NODE_ENV`, and compares no
tenant id or e-mail against a demo string. There is no `AUDIT_DISABLED`, no `SKIP_AUDIT`, no `try/catch`
that downgrades a failed audit write to a warning — a swallowed audit failure *is* a bypass, and it is the
one D2 exists to forbid. The absence is asserted in the negative by a test, the way `ADR-036` D-DNC10 and
`trust-proxy-dnc10-gate.spec.ts` already do for the provenance seam.

---

## D9 — What this ADR does **not** claim

- **AC-2's finance clause is vacuous today.** There is no finance module: 26 modules under
  `apps/api/src/modules`, none of them finance (`ADR-018` defers it). The criterion is **not ticked**. It is
  armed by `S-E04-7`'s `scripts/audit-write-check.js`, whose walk root is declared to include the module
  before it exists, so it is covered by default rather than by someone remembering.
- **`school.close` does not cover every closure.** `UpdateSchoolDto` exposes `status?: SchoolStatus`
  (`schools.controller.ts:78`) and `SchoolStatus` is exactly `active | closed`, so
  `PATCH /schools/:id { status: 'closed' }` closes a school through `update()` — bypassing `DELETE`'s
  students / academic-years refusal — and is filed as `school.update`. Re-opening has no code at all. Both
  codes are `critical`, so the « Modifications critiques » count is unaffected; the **attribution** is wrong,
  and an auditor filtering on « Fermeture d'un établissement » will not see closures made this way. The
  bypass is pre-existing; the *fidelity* gap is created here, because this is the slice that declares
  `school.close` to be THE closure code. Registered as **`PF-155`**. The fix is to choose the action from the
  observed transition inside the transaction (`next.status !== school.status && next.status === 'closed'` →
  `school.close`), or to drop `status` from `UpdateSchoolDto` — with a test, since
  `schools.controller.spec.ts` exercises `update` only with a name change.
- **The remaining direct `auditLog.create` call sites** stay as they are (`S-E04-7`). Measured on this branch
  after the change: **27 sites across 15 files** still bypass the seam, `identity/roles.controller.ts`
  included — the very shape this ADR's Context cites as its motivation. (The figure read "~18" while this
  slice was being planned; it is restated here from the post-change count, because a number a later slice
  will be measured against must not be a pre-change estimate.) Five families move; the class stays open until
  a ratchet closes it. Converting sites by hand without a gate is how PF-31 stayed open for two epics.
- **The hash chain** (`S-E04-8`) — genesis, field list, hash function, serialisation. This file will be
  amended, not replaced.
- **Two authorisation defects found while reading and deliberately not fixed here**, because each is a
  distinct decision that would need its own ADR and would widen this diff past one coherent improvement:
  - `users.service.assignRole` never checks that the *role* belongs to the caller's tenant, and **this slice
    does not close it** — registered as **`PF-153`**, owner `V3-E05` / `ADR-013`. *(This bullet previously
    read "the new path this slice adds **must close it**". It did not, and the shipped code says so at
    `users.service.ts:63-72`: the role lookup is deliberately left unfiltered. An ADR is the register of
    record; recording a check that does not exist is worse than recording the gap, because the next slice
    reads it as done. Corrected in the `S-E04-6` land pass rather than silently — `R-30`.)* The reason the
    code's ruling is the right one: `Role` has no `tenantId` (`schema.prisma:900`); its tenancy runs
    `schoolId → School.tenantId`, and `schoolId: null` means **global**. Adding a tenant filter to a global
    catalogue inside an audit slice would be a visibility change dressed as a fix. **The hole is latent, not
    live:** `roles.controller.ts:120` creates every custom role with `schoolId: null`, so there is nothing
    cross-tenant to grant today. It becomes live the moment `ADR-013`'s school-scoped roles land — at which
    point `GET /roles` (`roles.controller.ts:70`, unfiltered, returns every role with its full permission-code
    set) is a cross-tenant catalogue disclosure and `POST /users/:id/roles` is a cross-tenant grant. The fix,
    when it is taken, is `role.schoolId === null || role.school.tenantId === tenantId` **plus** the
    foreign-role G-TENANT negative — `users.service.spec.ts:214-246` today has negatives for a foreign
    `userId` and a foreign `userRoleId`, and none for a foreign role.
  - Anyone holding `roles.assign` can grant **any** role, including one more privileged than their own.
    That is privilege escalation and it is older than this slice. This slice makes it **visible** — the
    grant now writes a row naming the granted role — and registers the finding. It does not change who may
    grant what: doing so silently, inside an audit slice, is exactly the kind of undocumented authorisation
    change ADR-015 exists to prevent. `UserSyncService.effectivePermissions`
    (`shared/auth/user-sync.service.ts:80-84`) unions every non-revoked assignment with no ceiling, so the
    escalation is a self-grant on one request. Registered as **`PF-156`**; the eventual fix is a superset
    check on the grantor's `effectivePermissions` plus an explicit refusal of `isSystem` roles for
    non-`super_admin` grantors.

    > **SUPERSEDED BY `S-E05-2` (2026-08-11) — see the `S-E05-2` amendment in
    > `ADR-015-permissions-rbac-abac.md`.** The bullet above is now false in both halves.
    > (a) The superset check **shipped**: `shared/auth/privilege-ceiling.ts` refuses, before any
    > transaction opens, every role creation, permission rewrite, role assignment and invite-time
    > custom-role grant whose codes are not a subset of the grantor's effective set. `PF-09` and
    > `PF-156` are **closed**. (b) The `isSystem` half was **deliberately NOT taken** (ADR-015
    > `S-E05-2` D4): measured, it would refuse `school_admin → school_admin` — which the ceiling
    > permits and which is an ordinary operation — and it is role-shaped where the live exploit is
    > permission-shaped (custom roles are created `isSystem: false`, so the ban never touches it).
    > `PF-153` and the unfiltered `GET /roles` in the bullet above stay **open and unchanged**.

---

## D10 — Three behaviour changes this slice makes, recorded here rather than discovered in review

Each is defensible and each is pinned by a test. They are written down because an audit slice that quietly
changes an API response, or the code an event is filed under, is the shape this epic exists to remove.

1. **`revokeRole` is now idempotent.** It was an unconditional `update` that moved `revokedAt` forward on an
   already-revoked assignment. It is now guarded on `revokedAt: null` and returns `current` early — the
   record minus the joined `userProfile`/`role`. Without the guard a retry would answer *« quand ce privilège
   a-t-il été retiré ? »* with the retry's clock, and — now that the path is audited — would emit a second
   `role.revoke` for a revocation that had already happened. Same shape as `assignRole`'s pre-existing
   idempotent return. **Known limit, registered as `PF-157`:** both guards are a read *before* `$transaction`
   opens, so two concurrent calls still pass both. `@@unique([userProfileId, roleId, schoolId])` cannot back
   them up because `schoolId` is written `null` and PostgreSQL treats NULLs as distinct. The in-scope fix is a
   conditional `updateMany({ where: { id, revokedAt: null } })` inside the transaction; the partial unique
   index is a schema change and is out of scope here.
2. **The no-op rule is applied to roles and *not* to the other three families.** `assignRole`/`revokeRole`
   deliberately write no row when nothing changed. `school.update`, `enrollment.status_change` and
   `enrollment.cancel` on an already-`dropped` enrollment **do** write one for an identical-value request.
   Two of those three are `critical: true`, so a double-clicked control inflates « Modifications critiques »
   with non-events — the KPI this epic spent `S-E04-4` and `S-E04-5` making honest. Registered as **`PF-158`**;
   the fix mirrors the role guard and belongs with `S-E04-7`.
3. **`enrollment.transfer` files the row under `closed.id`, not `opened.id`.** The story's §2.3(c) specified
   `opened.id`. The code's reasoning is better and is kept: the operator acted on the enrollment they
   transferred *out of*, and `after` carries both ids. The **story** is the document that is wrong here, not
   the code — recorded so `S-E04-7`'s sweep does not "correct" it back.

---

## S-E04-7 amendment — the sweep, the ratchet, and the vocabulary as a compile-time invariant

> **Amendment, not a new file.** `tasks.md` cross-slice ruling #9 allocates exactly three ADRs to this epic
> and `S-E04-7` is not one of them; creating an `ADR-038` here would itself be the ADR-drift finding this
> epic exists to remove. Four decisions land below, numbered **D11–D14**.
>
> **Numbering defect corrected in the same edit.** The header above reserves *"D-8…D-11 and D-18…D-20"* for
> `S-E04-8`, while the shipped file already contains **D8, D9 and D10** written by `S-E04-6`. The
> reservation was violated before it was read. `S-E04-7` is the first amender and therefore fixes it:
> **`S-E04-8` reserves D15 onward.** One line, and it stops the next amendment landing on a collision.

### The measurement, with its root — because a number without its root is the defect

Walk root `apps/api/src` + `apps/worker/src` + `packages/imports-core/src`, production `.ts`, excluding
`*.spec.ts` and the seam itself, re-measured on `ci/2026-08-09-v3-e04-s7` (HEAD `64f64dd`):

| Root | Sites | Files |
|---|---|---|
| `apps/api/src` | 25 | 15 |
| `apps/worker/src` | **0** | — |
| `packages/imports-core/src` | 2 | 1 |
| **Total** | **27** | **16** |

`S-E04-7` converts **10** and baselines **17**. `27 = 10 + 17`, and `scripts/audit-write-check.js` asserts
that arithmetic by construction rather than in a PR description.

**Three ledger rows are wrong and are corrected here rather than inherited:** `tasks.md` § S-E04-7 AC-1 says
**30** (stale — the pre-`S-E04-6` figure); **D9 above** says *"27 sites across 15 files"* and attributes all
of them to `apps/api` (the count is right, the file count is 16, and two sites are in
`packages/imports-core`); `NEXT.md`'s "27 in `apps/api`" is 25 in `apps/api/src` plus 2 elsewhere.

### D11 — The gate's walk root is three roots, declared as data, and printed on every run

`scripts/audit-write-check.js` walks `apps/api/src` + `apps/worker/src` + `packages/imports-core/src`.

**Why not `apps/api/src` alone**, which is where 25 of the 27 sites live: `packages/imports-core/src/engine.ts`
writes two audit rows, and a gate rooted at the API would report green over them forever. That is `S-E06-5`
precisely — `packages/ui` was bundled into every portal and sat outside that gate's walk root, so the gate
certified a surface it could not see. The root is a constant in the script, asserted by the guard spec, and
printed in the verdict line, so the finance module (`S-E04-6` note 2) is covered by **default** when it
appears rather than by someone remembering.

**One exclusion, stated rather than left implicit:** `apps/api/prisma/seed-demo.ts` writes audit rows and is
outside the walk root. A seed is not a mutation path and `S-E02-4` keeps it out of production. An unstated
exclusion is the `S-E06-5` shape whatever its merits.

### D12 — Baselining is honest; a fake conversion is not. Three classes, and a finding that RESOLVES

A site that cannot honestly convert carries a reviewed row in `scripts/audit-write-baseline.json` with a
**class**, a **reason**, and a **finding id**. Three classes are declared:

| Class | Count | What it means |
|---|---|---|
| `best-effort-post-commit` | 15 | the site swallows its audit failure **by design** and says so in its own comment. Converting it means deleting its catch, which flips the handler to fail-closed — D2's *"real availability trade"*, applied to fifteen more handlers. A semantic change, not a sweep. |
| `cross-package-seam` | 2 | the write lives in a package that **cannot** import the seam. `@pilotage/imports-core` is a dependency **of** `apps/api`; importing `apps/api/src/shared/audit/write-audit.ts` would invert it, and `write-audit.ts` imports `@nestjs/common` so the seam cannot move into a Nest-free package either (`PF-160`). Structural and permanent until the seam is repackaged. |
| `no-actor-in-scope` | **0** | declared and deliberately empty, so the next such site lands in a named class instead of inventing one. |

**A path skip for `packages/imports-core` was refused.** A skip is invisible; a baseline row is reviewed and
ratcheted. The difference between those two is the entire lesson of this epic.

**The finding id is RESOLVED against `docs/daily-improvement-v3/audit-findings-index.md`, never shape-matched.**
`S-E06-5` measured three live rows in `link-integrity-baseline.json` citing ids that existed nowhere, because
that gate validated `PF-\d+`. The check reads the register's declared row openers and refuses an id that is
not among them — driven in both directions by the guard spec (a fabricated `PF-99999` must turn it red; a real
id must not).

**Consequence recorded rather than worked around:** the register holds `PF-01`…`PF-133`. The ids this epic's
`traceability/OPEN.md` uses — `PF-136`, `PF-140`, `PF-141`, `PF-149`, `PF-150`, `PF-154`…`PF-162` — resolve
nowhere yet. The baseline therefore cites only `PF-31` and `PF-121`, both of which resolve. Making the
resolver accept either register *"to be safe"* was refused: a resolver that cannot fail is the defect
`S-E06-5` measured, reintroduced by the fix written to delete it.

### D13 — The ratchet is blocking in both harnesses, outside every `--quick` guard, and has no off switch

`node scripts/audit-write-check.js` is stage **0d** of `scripts/ci-gate.sh` and a step in the **lint** job of
`.github/workflows/ci.yml`, both with zero arguments. It reads source only — no build, no database, no
generated Prisma client.

**It sits OUTSIDE every `QUICK` guard, deliberately.** Stages 7–12 of `ci-gate.sh` are inside
`if [ "${QUICK}" -eq 0 ]` because they read build output; wired there by copy-paste this stage would be a
blocking gate that the routine's most-used invocation never runs — a DNC-10 hole with a house-style alibi.
It goes in the **lint** job rather than the build job for the same class of reason: the build job needs
Postgres and a build, and `PF-126` makes it the least reliable place in the harness.

**Five rules, each independently provable red** (`audit-write-gate.spec.ts` drives one mutation per rule):
(A) an `auditLog.create` under the walk root that is not baselined; (B) a `writeAudit` first argument that is
not bound by a transaction — and, restated over the whole walk root, a `writeAudit` call inside a `try` block;
(C) a `writeAudit` second argument that is not an inline object literal, because
`audit-vocabulary-gate.spec.ts` resolves the codes from the call-site AST; (D) the one-way ratchet — a new
site, a stale row, or an ambiguous key; (E) an unresolvable finding id.

**DNC-08**: the parser, the seam, the register, the baseline, each walk root, and the number of `.ts` files
walked in each root are all *inputs*, and an absent or unreadable one exits non-zero **naming which**. The
failing condition is **zero files walked in a root, never zero writes found** — `apps/worker/src` legitimately
holds zero audit writes today, and a rule keyed on "zero matches" would be permanently red on correct code.

**DNC-10**: no `process.env` read anywhere; exactly two flags, `--help` and `--update`; an unrecognised
argument exits non-zero rather than being ignored. `--update` refuses to write while any rule-B or rule-C
violation is present, and writes new rows with an **empty** class/reason/finding so the gate stays red until a
human supplies all three. That refusal is what keeps `--update` from being the off switch.

**Site keys are `path#symbol`, never `path:line`.** `remediation.controller.ts` and `messaging.service.ts` are
exactly the churning files; a line-keyed row silently un-baselines its site — or starts covering a different
one — on any edit above it.

### D14 — PF-162: D6 stops being a convention and becomes a compile error

`AuditWriteInput.action` is `AuditActionCode` and `.resourceType` is `AuditResourceTypeCode`, both derived
from the tables in `packages/contracts/src/audit/vocabulary.ts`. An undeclared code is now a **type error at
the call site**, which is what D6 (*"the code written is a code declared"*) always asserted and never enforced.

**The blocking prerequisite, measured:** both tables were declared
`export const X: readonly Entry[] = [ … ] as const`. **The annotation wins** — the array's declared element
type is the interface, so `(typeof X)[number]['code']` resolved to `string` and the `as const` bought nothing.
PF-162 implemented over that declaration would have shipped green and inert: a named type that forbade
nothing. Both are now `as const satisfies readonly Entry[]`, which keeps the same compile-time check on every
row **and** keeps the literal types. `write-audit.spec.ts` carries `@ts-expect-error` controls that go red in
**both** directions, so a future widening back to `string` is a failing typecheck rather than a silent loss.

Two consequences, written down rather than discovered:

1. **The legacy French aliases are deliberately outside the unions.** A writer emitting one is now a compile
   error — correct, and the enforcement of `ADR-037` D4: legacy rows are never rewritten and nothing new may
   be written in that vocabulary.
2. **A computed family cannot satisfy a closed union by construction.** `remediation.controller.ts` builds
   a `remediation.booking_` code from a runtime transition. `AUDIT_ACTION_FAMILIES` and the vocabulary gate
   cover that case; the two halves are complementary and neither replaces the other. That is one reason
   `remediation.controller.ts` is baselined rather than converted here.

### What this amendment deliberately does NOT change

- **Who may grant a role.** `roles.controller.ts` moves its three audit writes onto the seam and inside the
  transaction, and changes **not one line** of authorisation. `PF-156` (any `roles.assign` holder can
  self-grant any role) and `PF-153` (role lookup unfiltered by tenant) stay registered and open. ADR-015
  exists to stop an authorisation change riding in on another slice, and this is the slice it was written for.
  > **`PF-156` SUPERSEDED BY `S-E05-2` (2026-08-11)** — the privilege ceiling shipped as its own slice, in
  > the ADR-015 amendment, exactly as this paragraph asked. `PF-153` is untouched and stays open.
- **`PF-149`** — nothing in this diff touches a timezone path. `UnknownTimezoneError` stays uncaught, which is
  the design; it remains pointed at a later slice.
- **`PF-150`'s id collision** — `traceability/OPEN.md` and `PROGRESS.md` use the id for two different
  findings. Renumbering must be atomic across both files; this slice cites the id nowhere, so the collision is
  recorded and left rather than half-fixed.
- **The chain.** `hash` / `prev_hash` are still written by no call site. `S-E04-8` owns it, and this
  amendment's D11–D14 constrain nothing about it.

### One latent defect this sweep exposed, fixed in the same diff

`audit-vocabulary-gate.spec.ts`'s Phase B registered a forwarder under `sourceFile.fileName`, which
`ts.createSourceFile` **normalises** — on Windows the map key built by `join()` carries backslashes while
`fileName` carries forward slashes, so the next pass's `sources.get(...)` returned `undefined` and the
forwarder resolved to **nothing, silently**. It was latent because every forwarder used to be registered in
Phase A, which passes the map key. This slice creates the first **two-hop** chains (call site → private
`audit` helper → `writeAudit`), whose second hop is registered from inside Phase B — and ten real action codes
(`academic_year.*`, `guardianship.claim_*`, `import.sync.pull`, `integration.roster_source.created`) dropped
out of the written set, after which the gate's reverse-completeness direction demanded their real French
labels be **deleted**. Exactly the failure D6 exists to pre-empt, arriving through a path separator. The
resolution now iterates map **entries**, and the ten codes are pinned by name.

---

## S-E04-9 amendment — a rollback that leaves an account behind is not a rollback

> **Amendment, not a new file.** `tasks.md` cross-slice ruling #9 allocates exactly three ADRs to this epic
> and `S-E04-9` is not one of them; creating an `ADR-038` here would itself be the ADR-drift finding this
> epic exists to remove. Three decisions land below, numbered **D15–D17**. The subject *is* D2's blast
> radius: D2 wrote that *"the cost is stated rather than discovered later"*, and this slice is the discovery
> that at one site the cost was understated.
>
> **Numbering, ruled — D15 was claimed three times and no claimant had landed.** The header reserves
> *"D15 onward"* for `S-E04-8` (chain); `PROGRESS.md`'s *"What is owed"* table (`:1715`) assigns `ADR-035 D15`
> to `S-E04-9` for the carried `revokeRole` `updateMany` / no-op record; and this slice needs decision
> numbers of its own. Per the `S-E04-7` precedent (*the amender that lands defines the allocation*):
> **this slice takes D15–D17**, the carried `revokeRole` / `isSchoolUpdateNoOp` documentation correction
> takes **D18**, and **`S-E04-8` reserves D19 onward**.
>
> **Scope disagreement, recorded rather than silently discharged.** `PROGRESS.md:1715-1720` also loads
> `S-E04-9` with three `S-E04-10` carry-overs (`enrollment.cancel`'s `before.endReason`,
> `isSchoolUpdateNoOp` defaulting to `true`, `schools.controller.spec.ts` S-5's hand-copied pipe literal).
> The operator slice is single-seam and excludes all four. They are **dropped from this slice, not
> resolved** — they must be re-pointed at a later slice rather than left believed-done.

### The measurement — what S-E04-7 left reachable at this one site

`S-E04-7` wrapped `invite.controller.ts` steps 5-7 (profile · optional custom role · audit row) in one
`$transaction` and, correctly, kept every Keycloak call outside it. But steps 3-4 had **already** created an
enabled realm identity and mailed its activation link, and neither is reversible. D2 makes an audit-insert
failure fatal, so a rollback left an **enabled `school_admin` with no `UserProfile`** — and step 1 then
refused every retry with *« Un utilisateur existe déjà … Il peut se connecter directement »*, advice that
**completes** the failure: on first login `UserSyncService.ensureUser` finds no profile, self-provisions one
under `DEMO_TENANT_SLUG`, and derives permissions from `REALM_ROLE_PERMISSIONS`. The invitee lands in the
wrong tenant with admin powers. That is the ADR-002 invariant, reached through a DB fault —
availability-triggered, not attacker-triggered, and registered as **`PF-163` (P1)**.

**D9 is MARKED stale here, not rewritten** (the `S-E04-7` precedent: a decision records what was true when
it was taken). D9 lists the invite path’s remaining gaps as `PF-153` / `PF-156`; it does not say that D2’s
fail-closed rule is reachable at a site with a committed, irreversible external side effect. D15 below is
that correction.

Resolution **(a) COMPENSATE** was taken. Resolution (b) — baselining `invite.controller.ts` back out under
`best-effort-post-commit` — was refused: it only narrows the trigger from *"profile OR role OR audit write
fails"* to *"profile OR role fails"*, leaves the escalation path fully reachable, and trades away the
fail-closed guarantee `S-E04-7` had just established at this site. `scripts/audit-write-baseline.json` and
its `27 = 10 + 17` arithmetic are untouched.

### D15 — a non-transactional external side effect gets a compensating action, and the compensation never masks the cause

Keycloak has no transaction to join. The boundary is therefore restated: **mutation and audit inside the
transaction; the compensating delete after the rollback, outside it.** Mechanically:

```ts
const profile = await this.persistInvitedProfile({ … }).catch(async (cause: unknown): Promise<never> => {
  if (createdKeycloakUser) await this.compensateOrphanedKeycloakUser(kcUserId, cause);
  throw cause;
});
```

**`.catch()` and a private method, not a `try` — this is load-bearing, not taste.**
`scripts/audit-write-check.js:265-274` (`insideTryBlock`) walks the **entire** ancestor chain of every
`writeAudit` node with no function-boundary stop. The obvious shape —
`try { await this.prisma.$transaction(async (tx) => { … writeAudit(tx, {…}) … }) } catch { … }` — puts the
call lexically inside a `try`, rule B fires (`:569`), and stage 0d of `ci-gate.sh` plus the lint job both go
red without one character of `writeAudit` changing. Two independent guards are used rather than one: the
transaction body lives in its own method (`persistInvitedProfile`, which contains no `try`), **and** the call
site uses a `.catch()` continuation. Rule B still resolves `tx` correctly, because `transactionBindingOf`
(`:306-330`) binds on the arrow function whose `parent` is the `…$transaction(…)` `CallExpression`, and
appending `.catch()` does not change that parent.

**Two outcomes, both loud.**

| Outcome | What the caller gets |
|---|---|
| compensation succeeds | `throw cause` — the ORIGINAL error, same class, same message. For the dominant case that is `AUDIT_WRITE_FAILED_MESSAGE` (`write-audit.ts:129`), which is now literally **true**: nothing survives. |
| compensation fails | `Logger.error` carrying the orphan id and the original cause, then an `InternalServerErrorException({ message, kcUserId }, { cause })`. |

The failure copy names the orphan **inside the message string**, not only in a sibling field.
`apps/web/src/app/admin/users/invite/actions.ts:26-34` reads **only** `body.message` and discards every other
key, and `InviteForm.tsx:293-301` renders that one string raw in a `role="alert"` block — so the pre-existing
`BadRequestException({ message, kcUserId })` at `:126-129` already loses its id in the UI today. The
structured field is kept for logs and machines; the sentence is what a human reads. It carries no support
address: `SUPPORT_EMAIL` lives in `apps/web/src/lib/support-contact.ts` precisely because four hard-coded
copies drifted (PF-17 / PF-54), and a fifth on the API side would be that defect again.

**`deleteUser`, and the one exception in it.** `KeycloakAdminService` gains exactly **one** method —
`DELETE /admin/realms/{realm}/users/{id}` through the existing private `adminFetch`, `Promise<void>`,
`InternalServerErrorException(\`Keycloak deleteUser: HTTP ${status}\`)`, no body parsed (204 has none). The
stated exception is **`404` returns without throwing**: already gone is the desired state, and a
compensation that manufactures a phantom orphan — sending an operator hunting an id that no longer exists —
is worse than one that is idempotent. No `disableUser` fallback: `getToken` authenticates as the master-realm
admin, so `DELETE` is available, and a fallback would add a third failure state and a second untested path.

**Three things recorded rather than left implicit:**

1. **`deleteUser` itself is unit-untested.** No spec in this repository mocks `global.fetch` (grepped: zero
   hits), and inventing the first fetch-mocking harness on a compensation slice would be a new test
   convention riding in. The controller spec injects a fake `KeycloakAdminService`, which is the house
   pattern. The gap is named here rather than papered over.
2. **The compensation is not bounded by a timeout.** No call in `KeycloakAdminService` sets an
   `AbortSignal`, so a hung Keycloak stretches the admin's spinner and can, in the worst case, cost them the
   original error. Retrofitting one call only would be off-convention (AC-3 says follow the file's
   conventions exactly); it is a follow-up on the **service as a whole**, not a patch here.
3. **The original error is re-thrown unmapped.** A `P2002` on `user_profile` still surfaces as a raw driver
   error. Mapping it to a French `ConflictException` would be a strictly better message and would contradict
   AC-1's *"the original cause remains the reported one"*; the pre-checks in D16 make that race the only way
   to reach it. Registered, not fixed.
4. **`register.controller.ts:94-123` is the second instance of the same shape** — an unauthenticated public
   endpoint that creates a Keycloak identity, sets a caller-chosen **permanent** password, and only then
   creates the profile, outside any transaction. It is deliberately **not** changed here, and it is one of
   the reasons D16 refuses to adopt a pre-existing identity at all.
5. **The SMTP-failure branch is still uncompensated, and therefore still leaves an orphan.** Its message —
   *« Utilisateur créé dans Keycloak mais l'envoi de l'email a échoué… »* — is accurate, and deleting the
   account there would make it false, so the branch is unchanged. The consequence, now that D16 withdraws the
   repair path, is that an SMTP outage still produces a profile-less identity and the retry is still refused.
   That is a **different trigger** (mail-server availability, not the audit rollback PF-163 named) and closing
   it means changing user-facing copy under `apps/web`. Carried, not absorbed.

### D16 — the conflict check stays a refusal: "no local profile" is NOT evidence of an orphan

**This decision reverses a draft of this same slice.** That draft turned step 1's dead end into a *repair
path*: when `findUserByEmail` found an identity and two local reads found no `UserProfile` anywhere, the
handler adopted the identity — added the realm role, overwrote the password, replaced the required actions,
mailed the activation link, and bound `authProviderId` to `me.tenantId`. Three independent reviewers raised
it as a blocker on the same ground, and the ground holds. **The adoption branch is withdrawn; step 1 is
byte-identical to its pre-slice behaviour.**

**Why the premise was false.** AC-4 asserted that *"a Keycloak account with no local `UserProfile` is a state
produced by exactly this bug"*. It is a state produced by **normal operation**:

| Fact | Where |
|---|---|
| `UserProfile` rows are created **lazily, on first login** — never at provisioning time | `user-sync.service.ts:23-56` |
| Three enabled realm identities ship with **no** profile: `admin@` / `teacher@` / `parent@pilotage.local` | `infra/keycloak/realm-export.json`; absent from `apps/api/prisma/seed-demo.ts` |
| **One realm holds every tenant**, so those identities are reachable from any tenant | ADR-004 |

So the probe matched *every never-onboarded account*, not the orphan PF-163 makes. Composed with
`@RequiresPermission('users.write')` — held by `school_admin` (`permissions.constants.ts:166`) — the draft
handed any school admin, in **any** tenant, a primitive that: destroyed an existing identity's credential,
**added** a realm role to it, replaced its required actions, mailed its owner an activation link, and — since
`authProviderId` is `@unique` **globally** (`schema.prisma:838`) — bound that identity **permanently** to the
adopter's tenant. Cross-tenant identity capture plus credential denial-of-service, reached through the very
door this slice opened. `G-TENANT`'s guarantee *"adopting an identity adopts no tenant"* was true of the DB
row and false of the realm identity.

The draft's own justification only analysed the **attacker-pre-registers** direction (hence the credential
reset). The inverse — **reset-as-a-weapon against a legitimate identity** — was never analysed. A safety
argument that enumerates one producer of a state and concludes about all of them is the defect, independent
of the code.

**Why the marker fix is not taken here either.** The sound version of adoption needs *positive* evidence that
this flow minted the identity: a Keycloak attribute stamped at `createUser` time (e.g.
`pilotageInvitePending: [tenantId]`), read back and matched against `me.tenantId`. It cannot be written in
this slice: the deployment runs **Keycloak 26** (`infra/docker-compose.yml:184`), whose declarative user
profile **disables unmanaged attributes by default**, and `realm-export.json` declares no `components` — so
the attribute would be dropped on write and never read back, and adoption would silently never fire. Making
it work means a realm-configuration change plus an operator re-import, which is a deploy-surface change, not
a controller change. The local alternative — an invite-intent row keyed on `(tenantId, email)`, written
before the irreversible Keycloak call and consumed by the repair — is a **schema change**, and `G-MIGRATION`
does not trigger in this slice. **Re-pointed at a later slice with the right fan-out; not silently dropped.**

**Nothing of PF-163 is lost by the withdrawal.** The escalation path is closed by the *stronger* half of the
fix: D15's compensation **deletes** the orphan, so the dead end never forms; and when the delete itself fails,
the admin is handed the id and told to have it cleaned up (AC-2). Repairing an orphan was only ever the
second-best remedy for a state the compensation now prevents.

**`findUserByEmail` returns `users[0] ?? null`.** Refusing on an arbitrary first match is the pre-existing,
conservative behaviour and stays. It is *acting* on an arbitrary first match that would have been the new
exposure — which is now no longer reachable.

### D17 — the refusal is uniform, and it is uniform *structurally*

There is **one** refusal branch and **one** `throw` of **one** `ConflictException`, built by a single
module-level function. Indistinguishability is therefore a property of the control flow, not of two literals
kept in sync: a same-tenant profile, a foreign-tenant profile and a never-onboarded realm identity all yield
the same status and the same string.

**The one-bit existence residual of the draft is GONE, not merely documented.** The draft returned 200 for a
"repairable" address and 409 for a taken one, which disclosed *"a Keycloak identity exists here and no
profile claims it"*. With adoption withdrawn, the handler issues **no local read at all** on the refusal path
— neither the `authProviderId` `findUnique` nor the untenanted `userProfile.count({ where: { email } })` — so
the only untenanted query the slice would have introduced does not exist. `invite.controller.spec.ts` case
(vii) pins that: both Prisma mocks must be uncalled.

The tenant field that carries the scoping is **`UserProfile.tenantId`, always `me.tenantId` from
`UserSyncService.ensureUser(jwt)`** — never a body or path value, never derived from the Keycloak payload
(D7's rule). A comment at the create says exactly this.

### What this amendment deliberately does NOT change

- **The email-failure branch.** It still keeps the account and still says so. Compensating there would make
  its own advice false, and its message is accurate: the temporary password is real and the account usable.
  Decided in a comment at the site, not by silence — and its residual is item 5 of D15.
- **`writeAudit` at the audit call.** One unconditional statement, inline object literal, transaction client
  first, no `try` (AC-7). It moved *file-internally* into `persistInvitedProfile`; the shape is what is
  pinned, and `scripts/audit-write-baseline.json` is unaffected because this file holds no `auditLog.create`
  site. The action stays **`user.invite`**, the resource type **`user_profile`**, and the `after:` payload
  keeps **exactly** its four pre-existing keys: the draft's `repairedExistingKeycloakUser` key went out with
  the branch it described, so no audit-vocabulary surface changes here at all.
- **Who may invite.** `@RequiresPermission('users.write')` is unchanged, and
  `provenance-callsites.spec.ts:654` stays green and unedited.
- **`user-sync.service.ts`.** Its demo-tenant self-provisioning is the *amplifier* of PF-163, not its
  trigger. Changing it is a first-login authorisation change across four portals and is registered
  separately.
- **`PF-156` / `PF-153`.** Untouched and still open (V3-E05).
- **No schema change.** G-MIGRATION does not trigger. The invite-intent table a sound repair path would need
  is exactly such a change, which is why D16 **defers the repair path** rather than improvising a marker.

### One finding this slice exposed and did NOT take

`invite.controller.ts` step 6 grants a custom DB role from `tx.role.findFirst({ where: { slug } })`. `Role`
has **no `tenantId`** (only `schoolId String?`, `@@unique([schoolId, slug])`), so the first matching row
across all schools and tenants wins — and when nothing matches the block is a **silent no-op** that still
returns `ok: true` while the audit row records `customRoleSlug: X` as though it had been granted. Tenant-
keying it needs a join through `School`; recording `customRoleGranted` in `after` would be cheap but is a
second added key beyond the one this slice is permitted. **Registered as a new finding, deliberately not
closed here.** `traceability/OPEN.md:55`'s note that `customRoleSlug` is silently lost on the PF-163 path
stays open with it.
