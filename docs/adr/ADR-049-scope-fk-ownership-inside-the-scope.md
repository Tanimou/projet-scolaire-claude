# ADR-049 — A foreign key is not isolated by the policy on the row that holds it: scope FKs are checked for OWNERSHIP, inside the scope, and the statement bound becomes a rule instead of a number

- **Status**: `accepted` — the ownership check, its position, its HTTP status, the mutual-exclusivity rule and the
  amended transaction budget are decided. What this ADR does **not** decide is the composite-foreign-key structural
  fix, which is recorded as `PF-205` and is a migration.
- **Date**: 2026-08-15
- **Story**: `S-E01-5` (epic `V3-E01`), closing `PF-204`, recording `PF-205` and `PF-206`.
- **Relates to**: `ADR-002` (multi-tenancy) · `ADR-032 §D5–§D8` (tenant enforcement; the owner bypasses its own
  policies) · `ADR-042 §D1` (the explicit `AND p.tenant_id = …` is kept even when redundant) and `§D6` (referential
  integrity runs **outside** row security) · `ADR-048 §D3` (the measured statement budget — **amended here**) and
  `§D9` (hardening a write must not create an existence oracle) · `ADR-015` (permission model).
- **Number**: `049`. Allocated against `main` **plus every open pull request** (`TOOL-30` anti-recurrence): `048` is
  the highest on `main`, and all six open PRs are Dependabot bumps claiming no ADR and no finding id.
- **Amends**: `ADR-048 §D3`. The amendment is written into that file as an inline note as well as here; the two must
  not be allowed to disagree, which is the failure `PF-116`/`PF-117` recorded on a different ledger.

---

## Context — the defect, and why the policy that looks correct does not cover it

`calendar_event` holds four **mono-column** foreign keys that name a scope (`schema.prisma:700-711`):
`academicYearId`, `cycleId`, `gradeLevelId`, `classSectionId`. `createEvent`
(`calendar.controller.ts:428-484`) and `update` (`:260-310`) validate scope **coherence** — that the id kind supplied
matches the declared scope kind — and never validate **ownership** — that the id belongs to the caller's tenant.

**RLS does not close this, and the reason is structural rather than a gap in the policy.** PostgreSQL evaluates
referential-integrity checks **outside** row security. `tenant_isolation`'s `WITH CHECK` on `calendar_event` sees
`calendar_event.tenant_id` and nothing else; the FK constraint that validates `cycle_id` runs as the owner of
`cycle`, with row security off. **A foreign `cycleId` therefore inserts cleanly under a perfectly correct policy.**
This is the same mechanism `ADR-042 §D6` already recorded from the other direction — there, a parent `DELETE`
cascades into a child the application role cannot delete; here, a child `INSERT` references a parent the application
role cannot read. Both are the same sentence: **referential integrity is not subject to RLS.** `§D6` wrote it down
as an *audit* hazard and stopped; this ADR records that it is also an *isolation* hazard, and that the isolation half
is the reachable one.

The consequence is a cross-tenant **read on the parent portal**, and it is live today:

1. `POST /api/v1/calendar/events` with `scope: 'cycle_scope'` and a `cycleId` belonging to tenant B, sent by an
   administrator of tenant A. Every check in the handler passes: coherence agrees (`cycle_scope` + `cycleId`), the
   row's own `tenant_id` is A's, and the FK resolves because the FK does not consult the GUC.
2. `calendarVisibilityWhere`'s parent branch (`calendar.controller.ts:85-86`) admits any event that is **not**
   `class_section_scope`, so the row is visible to **every parent of tenant A**.
3. `list`'s `include` (`:242-246`) renders `cycle.name` — **tenant B's name**, in tenant A's parent portal.

On the `degraded_no_app_url` path — *i.e.* every deployment today (`ADR-048 §D5`, and `.env.example` ships the
variable commented out) — nothing else is in the way.

**All four referenced models carry a `tenantId` column** (verified in `schema.prisma`), so the ownership check is
expressible without a schema change. That is the whole reason this slice can land ahead of the structural fix.

**Two facts measured on the admin UI, because they decide the blast radius rather than decorate it.**
`CalendarManager.tsx:429-442` builds its `<select>` options from the tenant's own grade levels and classes and has
**no cycle selector at all** — so `cycle_scope`, the scope that reaches every parent, is **unreachable from the UI**
and only a hand-crafted request produces it. And the same submit handler sends `gradeLevelId` / `classSectionId`
with exactly one of them non-`null`, which is what makes §D3's mutual-exclusivity rule a *no-op for the product* and
a *hardening for the API*.

---

## Decision

### D1 — the ownership check runs INSIDE the tenant scope, and it carries its own explicit `tenantId` predicate

Every supplied scope id is verified against the caller's tenant with a single-row probe issued on the scope's
transaction client, **before** the write:

```ts
const owned = await tx.cycle.findFirst({ where: { id, tenantId }, select: { id: true } });
```

Two properties, and both are load-bearing:

**The explicit `tenantId` in the `where` is what makes the check correct, in all three connection states.** It is
kept even where RLS makes it redundant, for the reason `ADR-042 §D1` already gives verbatim: executed as `app_user`
the parent's own `tenant_isolation` policy is doing the work and the clause adds nothing; executed as the **owner**
— `degraded_no_app_url`, which is every deployment today, and the owner escapes its own policies (`ADR-032 §D5`) —
the clause is the *only* thing doing the work. A check that relied on RLS alone would be correct exactly for the
posture it happens to be proven against and silently open for the one that is actually deployed.

**Running it inside the scope is what makes it also enforced by PostgreSQL, and what makes it atomic with the
write.** Running it outside — on the owner connection, where the rest of the pure validation legitimately lives —
would validate against a connection that can see **every** tenant. That is not a weaker check; it is the bug itself,
re-implemented as a check. It would additionally make the process hold an owner connection *and* an application
connection for the life of the transaction, which is the corollary `ADR-048 §D3` states as a rule.

**Sequential `await`, never `Promise.all`.** An interactive transaction is one connection; concurrent statements on
the same transaction client are not a supported shape and buy nothing here (at most two probes).

**Ordering, and it is a requirement rather than a preference.** In `update`, the ownership checks run **after** the
existing `event.tenantId` guard, never before: the caller is told nothing about the body until they have proven they
own the row named in the path. In `create`, all pure validation (coherence, §D3's mutual exclusivity, the
`startsAt > endsAt` bound) stays **outside** the scope, so a request a pure check already refuses never opens a
transaction. `ADR-048 §D3`'s *"late scope, early close"* is preserved exactly; what changes is only the claim that
*all* validation is pure (§D4).

### D2 — the refusal is **400**, and the two cases it covers are indistinguishable by construction

A foreign id and a non-existent id take the **identical** `findFirst → null` branch and produce the **byte-identical**
`BadRequestException` message. The response therefore cannot distinguish *"exists but belongs to another tenant"*
from *"does not exist"* — which is the deciding question, because that distinction is itself a cross-tenant existence
oracle (`ADR-048 §D9`'s rule, applied to a refusal the application owns rather than one the database raises).

**The one-sentence justification `AC-3` asks for:** the ids arrive in the request **body**, where every other refusal
in these two handlers is already a 400 carrying a French message (`calendar.controller.ts:436,440,443,446,282`), so
400 keeps one status for *"your body is unusable"* and routes both cases through one branch; a 404 on
`POST /calendar/events` would additionally read as *route not found*, and would collide with `update`'s existing 404
for a foreign **event** id, making two unrelated refusal families confusable.

**Why that collision is not itself an oracle**, stated because the question is the reasonable one to ask: each
family is internally uniform. The path-id family answers 404 for both *absent* and *other tenant* (the guard at
`:277`, unchanged by this slice); the body-id family answers 400 for both. A caller learns about the existence of
rows they already own and nothing else.

**Copy contract.** `CalendarManager.tsx` renders `res.error` **verbatim** to an administrator, so the message is
French, names the field, and never echoes a role, a tenant, a table or a Postgres string.

### D3 — at most ONE scope id per request body, in `create` **and** in `update`

`cycleId`, `gradeLevelId` and `classSectionId` are mutually exclusive: at most one may be supplied **non-null and
non-empty**. This is enforced as a pure check, outside the scope, in both write handlers.

**It closes a real coherence hole, independently of the statement budget it also buys.** When `body.scope` is
`undefined`, `finalScope` is *inferred* from the first non-null id in a fixed priority order
(`calendar.controller.ts:449-457`: class section, then grade level, then cycle). A caller supplying **both**
`classSectionId` **and** `cycleId` gets `class_section_scope` — and the `cycleId` **rides along, persisted, never
coherence-checked**, because the three coherence guards at `:439-447` each test `body.X && body.scope && …` and
`body.scope` is absent. That row then holds a scope id that no declared scope explains, and (before this slice) no
tenant check ever saw. Mutual exclusivity makes the inference total instead of merely first-match, and it should
land on its own merits.

**No product behaviour changes.** The admin UI sends exactly one non-`null` scope id by construction (§Context), and
`null` — the clear-this-field value the UI sends for the unselected scope — is deliberately **not** counted, so
`PATCH { gradeLevelId: null, classSectionId: '<uuid>' }` (move an event from a level to a class) stays legal.

### D4 — `ADR-048 §D3`'s bound is amended: the number moves from **2 to 3**, and the number is replaced by a rule

This is the design tension the story required to be resolved out loud rather than silently, so it is recorded with
its measurement and its argument.

`ADR-048 §D3` published a **measured** per-handler table bounded at *"≤ 2 statements inside the scope"*, under the
rule *"late scope, early close"* and the sentence *"all validation is pure and happens outside"*. **Ownership
validation is not pure.** It needs the database, and §D1 shows it must run inside the scope. So this slice adds
statements inside the scope, and pretending otherwise — or quietly editing the 2 — is not available.

**The amended table, measured on this design, not assumed:**

| Handler | Statements inside the scope | Delta | Note |
|---|---|---|---|
| `list` (`:229`) | **1**, or **2** on the parent branch | — | unchanged; the read path is not touched at all |
| `update` (`:273`) | **2**, or **3** when a scope id is supplied | +1 | guard `findUnique` → ≤ 1 ownership probe → `update` |
| `remove` (`:318`) | **2** | — | unchanged |
| `create` (`:461`) | **1**, **2**, or **3** | +2 | ≤ 1 scope-id probe + ≤ 1 `academicYearId` probe → `create` |

New maximum **3**, up from 2, on the two **write** handlers only, and only when the body names a scope id.
`set_config` is still not counted; it is the seam's own statement.

**Why 2 could not be preserved, both escapes named and refused.** Batching the two remaining probes into one
statement requires either (i) `tx.$queryRaw` with a `UNION ALL` of `EXISTS` — which puts a hand-written SQL surface
inside a **security** check, hard-codes physical table names so a Prisma `@@map` rename breaks it in silence, and
grows the raw-SQL population `PF-197` names as a cutover blocker — or (ii) `@@unique([id, tenantId])` plus a
`connect` on the compound key, which is the structural fix, is a **migration**, and is out of scope by this story's
own `G-MIGRATION` constraint. Neither is worth the number. §D3 already cut the worst case from four probes to two.

**Why 3 is accepted.** The added statements are single-row probes on a primary key (`where: { id, tenantId }`,
`select: { id: true }`) — index-backed by construction, the same argument `ADR-042 §Context` makes for the FK-path
policy's parent probe. They fire only on `POST` / `PATCH` of calendar events, which `calendar.write` restricts to
`super_admin` and `school_admin` (`permissions.constants.ts`; teacher and parent hold `calendar.read` alone, student
holds neither) — an administrator-only, low-frequency path on the lowest-traffic converted module. No **read** path
gains a statement. The interactive transaction's 5 s timeout (`prisma.service.ts:276-282`) has ample headroom for
three index probes.

**The rule that replaces the number, and it is stricter than what it replaces in the direction that matters.**
`≤ 2` was a *measurement* of what four handlers happened to need; it carried no principle, which is exactly why it
could not survive contact with the first non-pure validation. The invariant is:

> **The number of statements inside a tenant scope must be bounded by the SCHEMA, never by the REQUEST.**

For a converted handler the bound is *(one guard read, if it has a path id)* + *(one probe per tenant-bearing
foreign key it may write, after mutual exclusivity collapses the alternatives)* + *(its own write)* — a constant
derivable from the table definition. A handler that writes `for (const id of body.ids) await tx.x.findFirst(…)` is a
**violation even at count 2 today**, because a caller can make it 500 tomorrow; under the old numeric bound it would
have passed review. The published per-handler table stays, as the audit trail of the constant; the invariant is what
the next converting module must satisfy.

### D5 — the check is a private method of `CalendarController`, explicitly per model

It is **not** promoted into `shared/prisma/`. A generic `assertOwnedByTenant(tx, modelName, id, tenantId)` taking a
model as a **string** is dynamic dispatch over the Prisma client: it defeats the compile-time typing that
`Prisma.TransactionClient` exists to provide, and it is precisely the ambient, reachable-without-registering surface
`ADR-048 §D4` and `ADR-035` refuse. One module is converted; generalising a security helper from one call site is
premature, and the second converting module is what earns the abstraction. The per-model form is four short typed
branches and it is greppable, which is the property that matters when someone asks *"where is ownership checked?"*.

`apps/api/src/shared/prisma/**` is **not edited by this slice** — the seam's open halves (`PF-202`'s remedy string,
`PF-203`'s `relrowsecurity` arming) belong to the next slice that may edit it, and reaching into it here would be
the *"improve it while you are in there"* move the `S-E01-1d` split exists to prevent.

### D6 — the structural fix is named, priced, and deliberately second (`PF-205`)

The shape that makes this leak **impossible** rather than **checked** is the `ADR-042` FK-path pattern applied to
the FK itself: `@@unique([id, tenantId])` on `Cycle`, `GradeLevel`, `ClassSection` and `AcademicYear`, plus composite
foreign keys from `calendar_event` on `(cycleId, tenantId)`, `(gradeLevelId, tenantId)`, `(classSectionId, tenantId)`
and `(academicYearId, tenantId)`. The database then refuses the foreign reference, with no application code in the
path, on every connection including the owner's.

It is **not** this slice, and the reason is not squeamishness: it is a migration with a wide blast radius (four new
unique indexes, four FK replacements, a `restore-drill-baseline.json` entry per `PF-80`, and the `G-MIGRATION` gate),
and **a P1 leak that is live on the parent portal today should not wait on it.** The application check lands first
and stays afterwards — defence in depth, and the only guard on any deployment whose ledger is not applied. Recorded
as **`PF-205`, P2**.

**What `PF-205` also owns, and what this slice therefore does NOT claim: existing rows.** The check is **preventive,
not retroactive.** A `calendar_event` row already carrying a foreign scope id keeps rendering the foreign name in
tenant A's parent portal after this slice lands. That is not an oversight left dangling — adding the composite
foreign key *forces* the audit, because PostgreSQL validates existing rows when the constraint is created. The
migration and the backfill audit are the same act, which is a further argument for `PF-205` being the correct
eventual shape rather than a nicety.

### D7 — not decided here

`PF-200`, `PF-201`, `PF-202`, `PF-203` each have a named owner and are untouched. `PF-194` remains an accepted
`[LIMIT]`. `FORCE ROW LEVEL SECURITY` stays absent. **No schema change, no migration, no counter in
`scripts/tenant-scope-check.js`** — `G-MIGRATION` is not triggered and must not become triggered; a design that needs
it has chosen §D6 and must stop and re-scope.

**Same-tenant / other-school ids are not addressed and that is deliberate.** The isolation boundary is the **tenant**
(`ADR-002`); a `cycleId` belonging to the caller's tenant but a different `school` is a data-quality question, not a
tenancy leak, and folding it in here would widen a P1 fix into a school-structure story.

---

## Consequences

**What this does NOT say.** It does not make `calendar_event` structurally isolated — §D6 does that, and §D6 is not
this slice. It does not clean existing rows. It does not change the read path: `list` is byte-unchanged, `include`
still renders whatever the stored ids point at, and a pre-existing foreign row still leaks until `PF-205` lands.

**Positive.** The P1 leak is closed at the write on every deployment, in all three connection states, because the
check does not depend on RLS being enforced. A second coherence hole (§D3, the both-ids-and-no-scope inference) is
closed as a side effect. `ADR-048 §D3`'s bound acquires a principle, so the next converting module has a rule to
satisfy instead of a number to not exceed.

**Negative / accepted.** The two write handlers each gain up to one round trip inside an already-open transaction
(§D4). Mutual exclusivity is a **breaking change for an API caller** that supplied two scope ids at once — a
combination that produced an unexplained, never-validated stored id, so refusing it is the point; the admin UI is
unaffected. The check is per-model and will be four near-identical branches until a second module earns the
abstraction (§D5).

**Rollback.** Delete the private ownership method, its two call sites and the mutual-exclusivity guard. No schema
change, no migration to undo, no contract change, no UI change.

**Open, by name.**

| Finding | Priority | What it is |
|---|---|---|
| `PF-205` | P2 | **New.** The structural fix: `@@unique([id, tenantId])` on the four scope parents + composite FKs from `calendar_event`, which makes the foreign reference **impossible** rather than checked (`ADR-042`'s FK-path pattern applied to the FK). A migration with a wide blast radius, therefore second. **It also owns the retroactive half** — existing rows carrying a foreign scope id are not cleaned by `S-E01-5`, and creating the composite constraint validates them, so the migration *is* the backfill audit. |
| `PF-206` | P2 | **New, and it is a `DNC-06` shape in a file this slice edits.** `UpdateCalendarEventDto` accepts `academicYearId` (inherited from `CreateCalendarEventDto`) and the admin UI **sends it on every save** (`CalendarManager.tsx:439`), but `update`'s `data` block (`calendar.controller.ts:288-304`) **never writes it**. An administrator who changes an existing event's school year sees the drawer close and the list refresh with the year **unchanged**, silently. This ADR does **not** fix it, and the reason is that both repairs are behaviour changes needing their own slice: persisting it means `update` must ownership-check it too (a fourth branch, +1 statement, and §D4's table would move again), and rejecting it is a contract change for the shipped UI. **Consequence for `AC-2`, stated so nobody reads the omission as an oversight:** `update` validates ownership of the ids it **writes**; `academicYearId` is not among them, so it is not probed there. The asymmetry with `create` is a symptom of `PF-206`, not of the check. |

## Evidence expected of the implementation

- One negative test **per scope id** (`AC-4`), red before the fix and green after, stated in the spec header with
  *how* the red was confirmed. The house convention already exists and needs no new pattern: instantiate
  `CalendarController` with fake services (10+ specs do this — `register.controller.spec.ts`,
  `schools.controller.spec.ts`, `roles.controller.spec.ts`, …), with a fake `TenantScopeService.run` that hands the
  callback an in-memory `tx` honouring `where.tenantId`. **Before the fix the controller never calls
  `cycle.findFirst` at all** and the fake `calendarEvent.create` records the foreign id — that is the shape of the
  red, and it is an absence, so the test must assert the **refusal**, not the probe.
- Companion cases the negatives do not cover on their own: mutual exclusivity red (`{classSectionId, cycleId}`
  refused) **and** its non-regression green (`{gradeLevelId: null, classSectionId: '<uuid>'}` accepted); the
  ordering property (`PATCH` on a foreign **event** id answers 404 without ever probing the body); and the
  indistinguishability of the two 400 branches (foreign id and absent id produce the **same** message string).
- `pnpm --filter @pilotage/api exec jest` — and never a path containing a dot-directory, where jest finds zero tests.
- `git diff --stat` showing `apps/api/prisma/**` untouched.
