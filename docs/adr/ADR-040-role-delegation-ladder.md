# ADR-040 — A grantor-relative realm-role ladder, with no self-grant

- **Status**: Accepted
- **Date**: 2026-08-13
- **Slice**: resolves `D-12` (epic V3-E05 — AuthN/AuthZ hardening), unblocks `S-E05-2b`
- **Finding**: `PF-178` (the blocked onboarding path) · `PF-09` (residual: the fifth grant channel)
- **Gates**: G-AUTHZ, G-AUDIT, G-DNC · **DNC**: DNC-08, DNC-10
- **Extends** `ADR-015` (delegation), the privilege ceiling shipped by `S-E05-2`. **Supersedes nothing.**

## Context

`S-E05-2` closed `PF-156` (vertical privilege escalation) with a **grantor-relative permission ceiling**: no grantor
may confer a permission they do not themselves hold. The ceiling is correct and deliberately strict, and its measured
consequence is that a `school_admin` (75 permission codes) can assign **none** of the four other seeded system roles,
because each exceeds those 75 codes somewhere:

| Role | Codes | Exceeds `school_admin` by |
|---|---|---|
| `super_admin` | 89 | 14 — **the point of the finding** |
| `teacher` | 34 | 6 (`grades.write`, `grades.revise`, `attendance.write`, `lessons.write`, `lessons.delete`, `exports.execute.teacher`) |
| `parent` | 20 | 3 (`guardianships.claim`, `exports.execute.parent`, `remediation.book`) |
| `student` | 7 | 5 (the five `*.read.self`) |

So the product currently has **no legitimate path for an administrator to onboard a teacher**, while the unceilinged
`POST /users/invite` `realmRole` channel still works — the workaround and the vulnerability are the same door
(`PF-09`'s residual).

## Decision

**D1 — Adopt option (b): a grantor-relative realm-role ladder, ordered by identity level, not by permission set.**

```
super_admin  >  school_admin  >  teacher  >  parent  >  student
```

A grantor may confer a realm role **strictly below their own rung**. `school_admin → teacher | parent | student` is
permitted; `teacher → school_admin` is refused; `school_admin → school_admin` is refused (only a `super_admin` mints
an admin).

**D2 — The permission ceiling is NOT weakened. It is scoped.** The ceiling continues to govern *custom-role* and
*direct-permission* grants unchanged. The ladder governs **seeded realm roles only**. These are two different acts and
conflating them is what produced `PF-156`: conferring the *identity* "teacher" on another person is not the same event
as awarding oneself the *capability* `grades.revise`.

**D3 — No self-grant, at any rung.** A grantor may never confer a role on their own principal, whatever the ladder
says. **This is the rule that makes D1 safe** and it is not optional: without it a `school_admin` grants themselves
`teacher`, re-authenticates, and holds `grades.revise` — the exact escalation `S-E05-2` closed, reached by a longer
path. The check is on the subject id, before the ladder is consulted.

**D4 — The ladder is data, declared once, beside the permission constants.** One ordered list in
`permissions.constants.ts`, exported as a rank function. A role absent from the ladder is **unrankable and therefore
ungrantable** — fail-closed, never "assume lowest" (`DNC-08`: an unclassifiable state is never a pass).

**D5 — The fifth channel is ceilinged by the same rule.** `POST /users/invite`'s `realmRole` parameter passes through
the identical ladder check, which is what closes `PF-09`'s residual. One decision function, both call sites; a grant
path that does not consult it is a defect by construction.

**D6 — Every grant writes an audit row in the same transaction as the grant**, carrying grantor, grantor rung, subject,
conferred role and outcome — refusals included. `G-AUDIT` triggers because this is a privileged mutation. A refused
escalation attempt is precisely the event a school needs to be able to read later.

## Consequences

- Admin onboarding of teachers, parents and students works again, through a bounded path.
- `PF-09`'s residual closes with it; the invite channel stops being an unceilinged bypass.
- A `school_admin` still cannot escalate themselves — D3 blocks self-grant, D2 keeps the permission ceiling over custom
  roles, and the ladder refuses their own rung and above.
- **Accepted, and stated plainly:** a `school_admin` can name a teacher, and that teacher then holds six codes the
  admin does not. That is the bounded exception this ADR chooses. It is bounded by *who* may be named (strictly below),
  by *whom they may not be* (never oneself), and by *what is recorded* (an audit row either way). Any option that grants
  privileges to another party has this shape; option (c) — widening `school_admin`'s own codes — was rejected because it
  gives the escalation to the admin *themselves*, which is strictly worse.
- **Not decided here:** whether a school may customise the ladder per tenant. Out of scope; the ladder ships as a
  product-level constant. Raise a finding if a customer needs otherwise.

## Alternatives rejected

- **(a) Explicit assignable-roles grant per role.** More expressive, and a defensible future migration, but it needs a
  new `role.assignableRoles` relation, a management surface, and a seeding story — for a first delegation model whose
  requirement is entirely captured by a five-rung order. Rejected as premature, not as wrong.
- **(c) Widen `REALM_ROLE_PERMISSIONS.school_admin` to a superset.** Rejected on sight, and already rejected by the
  routine: it hands every administrator `grades.revise` in order to let them *name* a teacher. That is the escalation
  with extra steps.
