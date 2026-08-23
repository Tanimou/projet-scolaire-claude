# ADR-068 — The notification fan-out is tenant-scoped by construction, not by convention

- **Status:** accepted
- **Date:** 2026-08-23
- **Story:** `S-E05-4` (epic `V3-E05`, layer L0)
- **Closes:** `PF-11`
- **Records:** `PF-320`, `PF-321`, `PF-322`
- **Supersedes nothing.** Applies `ADR-002` ("every query scoped by `tenant_id`"), `ADR-063 §D2`
  (make the dangerous call unrepresentable) and `ADR-065 §D5` (the absent-key fail-open) to the
  notification seam.

---

## 1. Context — what was measured, not what was assumed

`PF-11` reads, in the round-5 audit index: *"Notification fan-out dedup query is not tenant-scoped"*,
classified `BROKEN_SECURITY`. It had sat `open` with an empty Evidence column since the register was
written.

It still reproduced on 2026-08-23, exactly as described. `NotificationsService.createMany`
(`apps/api/src/modules/notifications/notifications.service.ts`) built its source-dedup query as an
`OR` over `(userProfileId, sourceType, sourceId)` triples with **no `tenantId` anywhere in the
`where`** — while the docblock directly above it claimed the dedup happened *"within the same
tenant"*.

A parse of both applications puts that in proportion, and the proportion is the interesting part:

| Site | Model | Tenant in the filter? |
|---|---|---|
| `notifications.service.ts` dedup | `Notification` | **no** |
| `notifications.service.ts` list / count / markRead / markAllRead / markReadBySource | `Notification` | yes ×5 |
| `alerts-evaluator.service.ts:213` (worker) | `Notification` | yes |
| `notifications-digest-cron.service.ts:179, :196` | `Notification` | yes ×2 |
| `parent-digest-cron.service.ts:150` | `Notification` | yes |
| `remediation-sweep-cron.service.ts:143` | `Notification` | yes |

**It was the only one.** The worker's own comment says its dedup *"mirrors
NotificationsService.createMany"* — and it does, except in the one respect that matters. So this was
never a design position anybody argued for; it is a single site that drifted and a docblock that
covered for it.

### 1.1 The severity, stated honestly rather than inherited from the label

Every branch of that `OR` also constrained `userProfileId`, and a `UserProfile` row belongs to
exactly one tenant. So the query could not *return* another tenant's notification for a *different*
recipient: the realistic blast radius was narrower than `BROKEN_SECURITY` suggests on first reading.

What it could do, and what makes it worth closing rather than reclassifying:

1. **It is unbounded by construction.** The only thing keeping it correct was the global uniqueness
   of `UserProfile.id`. Nothing in the query said so, no test asserted it, and any future model in
   which a profile identifier is reused across tenants — or any repair that keys the dedup on a
   *student* or a *source* rather than a profile — turns a latent hole into a live one silently.
2. **It contradicts `ADR-002` and the `GUARDRAILS` tenancy rule at a site those documents claim to
   cover**, which erodes the value of every place they are honoured.
3. **RLS (`PF-02`, still `in-progress`) is being built on the premise that application queries are
   already tenant-keyed.** An unkeyed query is exactly the thing that will make the RLS rollout
   report a false green.

A finding whose exploitability depends on an invariant nobody wrote down is a finding, and the fix
costs one key.

### 1.2 What the same pass found next door, and why it is in the same slice

`preferences.service.ts` carries the *softer* form of the identical defect on **four** batch
resolvers — `disabledInAppKeys`, `emailEnabledKeys`, `instantEmailKeys`, `inAppPlan`. Three declared
`tenantId?: string` and spread it in as `...(tenantId ? { tenantId } : {})`; the fourth
(`disabledInAppKeys`) had **no tenant parameter at all**.

That spread is the absent-key fail-open `ADR-065 §D5` names and forbids: Prisma drops an `undefined`
key from a `where`, so an omitted argument does not narrow the query — it **widens it to every
tenant**, silently. The docblocks asserted the opposite (*"`tenantId` is optional but the dispatcher
always passes it, so the lookup is tenant-scoped"*), which is a statement about today's callers
dressed up as a statement about the code.

These resolvers **are** the notification fan-out — they are what `createMany` consults between the
dedup and the insert. Fixing the dedup and leaving them is fixing one half of one path.

---

## 2. Decisions

### D1 — The dedup filter carries the tenant **per item**, not pinned from `items[0]`

The obvious repair is `where: { tenantId: items[0]!.tenantId, OR: [...] }`. It is rejected.

Pinning the first item's tenant produces a query that is correct **only because** callers happen to
loop per tenant — the very convention that had just been shown to be unwritten and unchecked. The
implemented shape puts each item's own tenant on its own `OR` branch:

```ts
OR: sourceKeys.map((k) => ({
  tenantId: k.tenantId,
  userProfileId: k.userProfileId,
  sourceType: k.sourceType,
  sourceId: k.sourceId,
}))
```

This is correct for **any** batch, including one nobody has written yet. The dedup key computed on
the JavaScript side is realigned to match — `dedupKey(tenantId, userProfileId, sourceType, sourceId)`,
tenant first — because a query narrowed on the database side and a `Set` keyed the old way would
simply move the bug into memory.

### D2 — A mixed-tenant batch is **refused**, and the refusal is what makes the derivation legitimate

D1 fixes the dedup, and it does **not** fix the preference gates. Those resolve once per batch and
take a single `tenantId`, derived positionally — `deduped[0]!.tenantId` for the in-app plan,
`items[0]!.tenantId` for the email dispatch. On a mixed batch, tenant A's toggles would be resolved
for tenant B's recipients, and the wrong notifications would be delivered or suppressed with no error
anywhere.

So `createMany` now calls `assertSingleTenantBatch(items)` on entry, before any query, and both gates
use its return value. All **eight** production producers were read before this was written
(`alerts.service.ts` ×2, `announcements.controller.ts`, `child-claims.service.ts` ×2,
`enrollments.controller.ts`, `assessments.controller.ts`, `lessons.controller.ts`) and every one sets
a single scalar tenant for the whole batch — so this is a hardening with **no behaviour change on any
live path**, which is precisely when an invariant is cheap to install.

**Why throw rather than filter or split.** Filtering the foreign items would make a producer bug
invisible — the caller would see a plausible `created` count and never learn it had fanned out to the
wrong audience. Splitting into per-tenant batches would be silently *doing* what the caller got
wrong, and would make `createMany` responsible for a scheduling decision its callers already own.
Every caller either wraps `createMany` in `try/catch` or sits inside one, so a mixed batch degrades
to *"no notification, plus a logged error"* — never to a wrong-tenant delivery. This is `DNC-08`
applied to a producer: an unclassifiable state must not be reported as success.

### D3 — `tenantId` becomes **required** on all four preference resolvers, and the spread becomes a plain key

`tenantId?: string` plus `...(tenantId ? { tenantId } : {})` is replaced by `tenantId: string` plus
`tenantId,`. `disabledInAppKeys`, which had no such parameter, gains one.

This is `ADR-063 §D2`'s posture — the unscoped call becomes *unrepresentable* rather than merely
discouraged, and `ADR-002` is enforced by the type checker instead of by a docblock. Both production
callers already passed the argument, so nothing at a call site changes.

`disabledInAppKeys` deserves a sentence of its own: it has **zero** production callers today
(superseded by `inAppPlan`), which is exactly why its missing tenant parameter was invisible. The next
caller would have inherited a cross-tenant read. Adding the parameter now costs nothing; discovering
it later costs an incident.

### D4 — The rule gets a ratchet, parsed rather than grepped

`apps/api/src/shared/quality/notification-tenant-scope-gate.spec.ts`. A defect removed without a
ratchet comes back, and this one had already returned in a second form (D3) before anybody noticed
the first.

Three properties, each chosen against a failure this repository has already paid for:

- **The model set is derived from `schema.prisma`** — every `model` beginning with `Notification`
  that declares a `tenantId` scalar — not a hand-written pair of names. Two hand-maintained lists
  drift; `project_paired_lists_drift` is the ledger entry for the last time they did.
- **The corpus is parsed with `typescript`, never text-scanned.** This file's own negative-control
  fixtures contain the offending shapes as string literals; a text scan would flag them, and the only
  way to green it again would be to weaken it (`R-30`).
- **The one exemption is structural, not an allowlist** (`DNC-10`). Two worker crons legitimately read
  across tenants to *enumerate* them (`select: { tenantId: true }` + `distinct: ['tenantId']`). They
  are recognised by that shape — a read that returns tenant identifiers and no tenant-owned column —
  and a query that starts reading a second column loses the exemption automatically. The gate asserts
  there are exactly two and names both.

### D5 — The gate declares its ceiling instead of hiding it

`findUnique` / `findUniqueOrThrow` / `update` / `delete` / `upsert` take a **unique selector**, and
`NotificationPreference`'s unique is `@@unique([userProfileId, kind])` — no tenant in it. Prisma
*refuses* a `tenantId` there, so requiring one would be a rule the type system cannot satisfy.

Rather than pretend those sites are covered, the gate **counts** them and asserts the count (3: two
`findUnique`, one `upsert`). If the number moves, someone added a unique-selector read to this seam
and owes it a tenant assertion. The two that exist today are recorded as findings, not fixed here —
see §4.

---

## 3. Evidence — executed, with the commands that produced it

**Before / after on the same gate, on the same machine, minutes apart.** The two service files were
replaced by their `origin/main` versions (`git checkout origin/main -- <paths>`) and the gate re-run:

```
BEFORE (origin/main)                                     Tests: 2 failed, 19 passed, 21 total
  apps/api/src/modules/notifications/notifications.service.ts:108  notification.findMany
      — 1 OR branch(es) carry no tenantId
  apps/api/src/modules/notifications/preferences.service.ts:203    notificationPreference.findMany
  apps/api/src/modules/notifications/preferences.service.ts:241    notificationPreference.findMany
  apps/api/src/modules/notifications/preferences.service.ts:273    notificationPreference.findMany
  apps/api/src/modules/notifications/preferences.service.ts:315    notificationPreference.findMany

AFTER  (this branch)                                     Tests: 21 passed, 21 total
  OFFENDERS = []
```

The four `preferences.service.ts` hits are the conditional spread: it is not a static `tenantId` key,
so the classifier does not credit it — which is the correct verdict, because at runtime it is not one
either whenever the argument is omitted.

**Behavioural specs.** `apps/api/src/modules/notifications/notifications.service.spec.ts` gains ten
cases (`pnpm --filter @pilotage/api exec jest src/modules/notifications/` — **51/51 green**,
2 suites). The two that carry the finding:

- *"does NOT let a foreign tenant's identical (user, source) row suppress the insert"* — a `t2` row
  with the same `(userProfileId, sourceType, sourceId)` no longer swallows the `t1` notification.
- *"refuses a mixed-tenant batch BEFORE any query runs"* — asserts on the **queries not issued**, not
  only on the thrown message, because a filter-instead-of-throw implementation would satisfy a message
  assertion alone.

One pre-existing fixture had to change: the dedup test's mock row carried no `tenantId`. That is not
collateral damage, it is the measurement — the fixture was under-specified precisely because the
query was.

---

## 4. What this ADR does not do, said plainly

- **`PF-320`** — `NotificationPreferencesService.update` reads by `userProfileId_kind` and never
  compares the row's `tenantId` to the caller's, then `upsert`s with `create: { tenantId: args.tenantId }`.
  Today the controller derives both from the same principal so they cannot diverge; nothing enforces
  that. Needs a post-read assertion or a compound unique — a schema change, hence a separate slice.
- **`PF-321`** — `NotificationPreferencesService.isEnabled` takes **no** tenant at all and reads any
  user's preference by `(userProfileId, kind)`. Zero production callers today (`"used by future
  dispatchers"`), which is the same invisibility that hid `disabledInAppKeys`. Fix it before it has a
  caller, or delete it.
- **`PF-322`** — the gate covers the `Notification*` seam only. The systemic form (every
  tenant-bearing model, every filter query) is `PF-291`'s job; generalising the classifier here would
  need either a large allowlist or would land red, and both are worse than a narrow gate that states
  its edge.
- **No RLS policy is added.** `PF-02` remains `in-progress` and this change is application-layer
  defence, which is the layer `ADR-002` governs.
- **`G-PORTAL`, honestly:** the in-app bell is admin / teacher / parent. `apps/web/src/app/student/`
  has **no** notification settings route (`PF-57`, pre-existing) — so the true figure is **3/4, not
  4/4**. "No student surface exists" is the accurate statement; "student unaffected" is not.
