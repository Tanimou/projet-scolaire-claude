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
  `PROGRESS.md` §144–146 has it right, `S-E04-6` writes the file and `S-E04-8` **amends** it with D-8…D-11
  and D-18…D-20 (genesis, field list, hash function, serialisation, A-01). Nothing below constrains those.

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
