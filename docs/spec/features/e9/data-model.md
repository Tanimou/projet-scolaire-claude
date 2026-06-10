# E9 — Data model & Prisma migration plan

> Authoritative schema record for E9. **Reuses the existing `Guardianship` backbone** (status
> `pending`/`active`/`revoked` + `approvedBy`/`approvedAt`/`revokedAt`, verified at `schema.prisma`
> lines 505–529) and the E1/E2 notification spine. **Exactly one additive schema change**, landing in
> **S1** via `prisma db push` (no SQL `migrations/` folder — the project convention, ADR-014 +
> project-context §4). Additive, nullable, safe on existing rows; **no column on any existing model
> changes type or nullability**, no value is removed from any enum.

## 0. What already exists (reused, NOT added)

Verified in `apps/api/prisma/schema.prisma` and `permissions.constants.ts`:

| Existing artifact | Where | Role in E9 |
|---|---|---|
| `enum GuardianshipStatus { pending active revoked }` | schema:128 | the claim lifecycle states — **reused as-is** (no value added) |
| `Guardianship.status @default(active)` | schema:514 | E9 creates rows with `status: 'pending'` (the parent-claim path); the admin-link path keeps `active` |
| `Guardianship.approvedBy / approvedAt / revokedAt` | schema:515–517 | stamped on approve / reject — **reused** |
| `@@unique([guardianId, studentId])` | schema:525 | idempotency anchor: one claim per (parent, child) |
| `@@index([studentId, status])` | schema:527 | already supports status-filtered reads |
| `enum EnrollmentStatus { pending … }` | schema:134 | referenced backbone (same onboarding family); **not modified** by E9 |
| `enum NotificationKind { … enrollment_status … }` | schema:1215 | the status-change notification kind — **reused**, no new kind |
| `permission guardianships.approve` | permissions.constants:40 | admin approval authority — **already seeded** (school/super admin, lines 168/220/254); **no new permission** |
| `AuditLog` (append-only) | schema:1067 | the claim status history — **no new history table** |

## 1. The one additive schema change (S1) — the `GuardianshipClaim` provenance row

E9 needs a **provenance row** that records *how the parent described the child*, *what the matcher
decided*, and *the request's own lifecycle* — separate from the `Guardianship` (the access link) it
**drives**. This is the request→link pattern the platform already uses (E1-S3 `MeetingRequest` drives a
real action; E2-S4 `ConversationReport`). Two shapes were weighed; **Option B — a dedicated
`GuardianshipClaim` model — is CHOSEN** and is what `contracts/openapi.yaml` + `ux.md` are written
against. Option A (additive columns on `Guardianship`) is recorded as the rejected alternative.

### Option B (CHOSEN) — a dedicated `GuardianshipClaim` model

```prisma
/// E9 — a parent's self-service request to be attached to a child. The provenance
/// + lifecycle record that DRIVES a Guardianship (the request→link pattern, the
/// E1-S3 MeetingRequest precedent). The claim is the request; the Guardianship is
/// the access grant. A claim is created on EVERY parent submit (matched or not);
/// only a matched claim also drives a `pending` Guardianship.
model GuardianshipClaim {
  id              String                  @id @default(uuid()) @db.Uuid
  tenantId        String                  @map("tenant_id") @db.Uuid
  schoolId        String                  @map("school_id") @db.Uuid
  guardianId      String                  @map("guardian_id") @db.Uuid       // the requesting parent (server-derived)
  // What the parent typed (the audit/non-leak evidence; never echoed on a no-match):
  claimedFirstName   String               @map("claimed_first_name")
  claimedLastName    String               @map("claimed_last_name")
  claimedDob         DateTime?            @map("claimed_dob") @db.Date
  claimedExternalRef String?             @map("claimed_external_ref")
  relationship    GuardianRelationship                                       // reused enum
  // The matcher decision + the driven link (null on a no-match — the wrinkle Option B solves cleanly):
  matchedStudentId String?                @map("matched_student_id") @db.Uuid // set ONLY on a confident match
  guardianshipId  String?                @unique @map("guardianship_id") @db.Uuid // the pending/active link it drives
  status          GuardianshipClaimStatus @default(submitted)                // the claim's OWN lifecycle
  decisionReason  String?                @map("decision_reason")             // admin's kind reject reason
  decidedBy       String?                @map("decided_by") @db.Uuid         // admin who approved/rejected
  decidedAt       DateTime?              @map("decided_at") @db.Timestamptz(6)
  createdAt       DateTime               @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt       DateTime               @updatedAt @map("updated_at") @db.Timestamptz(6)

  guardian     Guardian      @relation(fields: [guardianId], references: [id], onDelete: Cascade)
  student      Student?      @relation("ClaimMatchedStudent", fields: [matchedStudentId], references: [id], onDelete: SetNull)
  guardianship Guardianship? @relation(fields: [guardianshipId], references: [id], onDelete: SetNull)

  // Idempotency: at most ONE open (submitted) claim per (guardian, matched child).
  // A partial unique on (guardianId, matchedStudentId) WHERE status='submitted'
  // is applied as a raw partial index (the ADR-020/E7-S2 BookingIndexBootstrap
  // idiom) since Prisma can't express a partial @@unique; see §2.
  @@index([tenantId, status])           // the admin pending-queue read
  @@index([guardianId, status])         // the parent's own-claims read
  @@map("guardianship_claim")
}

// ── E9 — additive enum (net-new type; no existing enum touched) ──
enum GuardianshipClaimStatus {
  submitted      // pending admin review (the queue). Drives a `pending` Guardianship on a match.
  approved       // admin approved → the driven Guardianship is now `active` (access granted).
  rejected       // admin rejected (decisionReason set). The parent may re-submit corrected details.
  match_failed   // deny-by-default no/ambiguous match — NO Guardianship driven, never leaked to the parent.
  withdrawn      // the parent cancelled a still-`submitted` claim.
}
```

Back-relations added (additive arrays only — **no column on an existing model changes**):
`Guardian.claims GuardianshipClaim[]`, `Student.claims GuardianshipClaim[] @relation("ClaimMatchedStudent")`,
`Guardianship.claim GuardianshipClaim?`.

**Why this is safe / additive:**
- **One net-new table + one net-new enum** — no existing model's column changes type/nullability; existing
  rows are untouched; the only relation edits are additive back-relation arrays. `db push` is safe on
  populated data, idempotent.
- **No value is added to/removed from** `GuardianshipStatus`, `EnrollmentStatus`, `NotificationKind`, or
  any existing enum.
- The admin-initiated `POST /guardians/guardianships` path is **byte-unchanged** — it never creates a
  `GuardianshipClaim` (AC-8).
- The matched claim **drives** a `pending` `Guardianship` (the existing model, `status: 'pending'`); the
  unmatched/ambiguous claim simply has `matchedStudentId = null` + `guardianshipId = null` + `status =
  match_failed` — **no `Guardianship` orphan, no FK gymnastics** (the clean solution to the §3 wrinkle).

### Option A (REJECTED) — additive nullable columns on `Guardianship`

Stuffing `claimSource`/`claimed*`/`matchDecision`/`rejectionReason` onto `Guardianship` directly. **Rejected
because:** the unmatched case has **no `studentId`** to satisfy the `Guardianship.studentId` FK, forcing an
awkward audit-log-only side channel (a second representation of "a claim happened"); and it overloads the
access-link row with request metadata that is null for 99% of rows (every admin-created link). Option B
keeps the **request** (`GuardianshipClaim`) and the **access link** (`Guardianship`) cleanly separated —
exactly the E1-S3 `MeetingRequest`→action separation — so the unmatched claim is a first-class row and the
`Guardianship` stays a pure access link. The dual-table concern (two lifecycles) is bounded: the claim's
`status` is the *request* lifecycle; the `Guardianship.status` is the *access* lifecycle; the approve verb
advances both **in one transaction** (§2), so they cannot drift.

## 2. The claim → guardianship state map (two coupled rows, one transaction)

The `GuardianshipClaim` is the **request**; the `Guardianship` is the **access link** it drives. Each verb
advances both atomically:

```
 parent submit (match)        admin approve                  parent re-submit
        │                          │                              │
        ▼                          ▼                              │
  CLAIM: submitted ──approve──▶ approved        CLAIM: rejected ──┘──▶ submitted (reuse the row)
  LINK:  pending    ───────────▶ active ← ACCESS GRANTED          LINK:  revoked  ───▶ pending
        │
        ├── admin reject(reason) ──▶ CLAIM: rejected ;  LINK: revoked (decisionReason on the claim)
        ├── parent withdraw       ──▶ CLAIM: withdrawn ; LINK: revoked
        └── (no/ambiguous match)  ──▶ CLAIM: match_failed ; LINK: none (no Guardianship driven)
```

- **CLAIM `submitted`** ⇒ **LINK `pending`** — awaiting admin validation. The ABAC wall requires `active`,
  so **no access** yet.
- **CLAIM `approved`** ⇒ **LINK `active`** (`approvedBy`/`approvedAt` stamped) — **this transition is the
  access grant**; the parent's guardianship-ABAC wall now resolves the child. Advanced in **one
  `$transaction`** (claim + link), from-status-guarded (`updateMany ... where status='pending'`) so a
  concurrent double-approve is a deterministic no-op (ADR-020 idiom).
- **CLAIM `rejected`** ⇒ **LINK `revoked`** (`decisionReason` on the claim, `revokedAt` on the link),
  grants nothing. The parent may **re-submit** → the same claim row goes `rejected → submitted`, its driven
  link `revoked → pending` (the `createGuardianship` `revoked`-reuse idiom, lines 270–285, generalised).
- **CLAIM `match_failed`** ⇒ **no `Guardianship`** (deny-by-default; never leaked).
- **CLAIM `withdrawn`** ⇒ **LINK `revoked`** (the parent cancelled a still-`submitted` claim).

> **`GuardianshipStatus` is unchanged** — E9 reuses `pending`/`active`/`revoked` exactly; the *request*
> states (`match_failed`/`withdrawn`) live on the new `GuardianshipClaimStatus`, not on the access enum.
> No existing enum gains a value.

## 3. The unmatched case + the non-leak response invariant

Option B makes the unmatched case a **first-class row**: a no/ambiguous match creates a
`GuardianshipClaim` with `status = 'match_failed'`, `matchedStudentId = null`, `guardianshipId = null` —
**no `Guardianship` is driven**, so the `Guardianship.studentId` FK is never strained. The admin queue can
still surface match-failed claims ("a parent tried to claim a child we couldn't match — here's what they
typed") and handle them manually (create the `Student`, then approve), while the parent learns nothing
beyond "not found". The asymmetry the non-leak contract needs falls out of the data model, not a side
channel.

**The non-leak response invariant (the security core — FR-2/AC-2).** This is the one cross-artifact point
that MUST be reconciled, because `ux.md`'s "no-match" copy could be read as a leak. The locked PM ruling:

- The parent response on a match (`outcome=submitted`) and on a no/ambiguous match (`outcome=not_found`)
  is **the same JSON shape** (`ChildClaimStatus` in `contracts/openapi.yaml`), with `child=null`,
  `claimId=null`, `status=null` on a no-match. The endpoint is **rate-limited per guardian** (429 past the
  cap).
- **What the parent MAY learn:** "we couldn't find a child matching what you entered — check the details
  and retry, or contact the school." (a binary found/not-found, behind a rate limit).
- **What the parent must NEVER learn (the hard wall):** that a child with *some* of those details exists,
  a near-match, which field was wrong, a roster count, or any `Student` field they didn't supply. The
  matcher's `outcome` distinguishes only **exact-confident-match vs not** — never a partial/fuzzy signal.
  A name-only claim (no DOB, no externalRef) **always** resolves to `not_found` regardless of the roster
  (so surname-fishing yields nothing).
- **Why a binary found/not-found is acceptable (the intake's "never leaks a non-match"):** "never leaks"
  means *never reveals a non-matching child's existence or attributes* — telling the parent their own
  fully-specified claim didn't resolve (DOB **and** name **and**, ideally, ref all supplied) discloses
  nothing about any *other* child, and is gated by the rate limit. The kind UX (a retry path) and the
  security wall (no near-match, no field hint, no enumeration) are both satisfied. Sentinel pins the
  shape-equality + rate-limit on the S1 verify pass; if Sentinel rules even the binary signal too loose,
  the fallback is the **fully-uniform** "Demande envoyée" for both outcomes (the stricter reading) — the
  implementation flag is recorded in `tasks.md` T-S1.7.

## 4. The deny-by-default matcher contract (S1)

Pure, deterministic, school-scoped. Locked rule (tune thresholds in S1 implementation, but the
**contract** is fixed here):

```
matchClaim(claim, { tenantId, schoolId }) -> { outcome: 'matched'|'no_match'|'ambiguous', studentId? }

1. externalRef path (highest confidence):
   if claim.externalRef is provided:
     find Student where tenantId, schoolId, externalRef == claim.externalRef
     - exactly 1  -> { matched, studentId }
     - 0          -> fall through to name+DOB
     - (externalRef is @@unique([schoolId, externalRef]) so >1 is impossible)

2. name + DOB path:
   require claim.birthDate (DOB is mandatory for a name match — name alone is too weak / leaky)
   find Student where tenantId, schoolId,
        lastName  ~= claim.lastName  (case-insensitive, trimmed/accent-folded),
        firstName ~= claim.firstName (case-insensitive, trimmed/accent-folded),
        birthDate == claim.birthDate
     - exactly 1  -> { matched, studentId }
     - 0          -> { no_match }
     - >1         -> { ambiguous }   (admin disambiguates; the parent sees the SAME not_found shape)

3. otherwise (e.g. name only, no DOB / no ref) -> { no_match }
```

The controller maps the matcher outcome to the `GuardianshipClaim`:
`matched → status=submitted` + drives a `pending` Guardianship + `outcome=submitted`;
`no_match`/`ambiguous → status=match_failed`, no Guardianship, `outcome=not_found` (the shape-identical,
rate-limited, near-match-free response of §3).

- **DOB is mandatory** for a name-based match (a name-only match would let a parent fish by surname). The
  `externalRef` path may match without DOB because the school issued that reference privately.
- **The matcher only *suggests*** the candidate to the admin — it **never auto-approves** (Non-goal). A
  `matched` claim still drives a **`pending`** Guardianship; the human validates.
- **School-scoped** (`schoolId` from the parent's own context) — a parent can never match a child in
  another school, even within the same tenant.
- **No fuzzy/Levenshtein matching in S1** — exact (trimmed, case-insensitive) only, to keep the
  false-positive surface zero. Fuzzy suggestion is a recorded future option, never an auto-grant.

## 5. Permissions (one new, parent-narrowed — the `exports.execute.parent` house style)

| Permission | Status | Used by |
|---|---|---|
| `guardianships.claim` | **NEW**, parent-only — granted to the **parent** realm-role ONLY (never admin/teacher), the E4 `exports.execute.parent` / E8 `*.read.self` role-narrowed precedent | `POST /parent/child-claims`, `POST …/{id}/withdraw` |
| `guardianships.read` | existing | `GET /parent/child-claims` (self-scoped), `GET /admin/child-claims` (the admin queue read, tenant-scoped) |
| `guardianships.approve` | **existing**, seeded to school/super admin (permissions.constants:40, 168/220/254) | `POST /admin/child-claims/{id}/approve`, `POST …/{id}/reject` |

> **Exactly one new permission** — a thin, **parent-only** `guardianships.claim` (resource
> `guardianship`, action `claim`), added to `permissions.constants.ts` + both seeds, granted **only** to
> the parent realm-role. This mirrors the established role-narrowed house style (E4
> `exports.execute.parent`, E7 `remediation.book`, E8 `*.read.self`): a parent-initiated write gets its
> own distinct permission rather than overloading an admin one, so the parent claim surface can never be
> reached by an admin/teacher token and the matrix stays auditable. **No admin permission is added** — the
> approval queue rides the already-seeded `guardianships.approve`. The parent path is *additionally*
> walled by server-derived `Guardian` ownership (`Guardian.userProfileId === me.id`) so a parent can only
> ever claim as themselves and see only their own claims (the permission gates the *route*; ownership gates
> the *row*). Adding the permission constant is **not** a schema change (it is a TS constant + a seed row),
> so S1 stays a single-`db push` slice.

## 6. Audit verbs (append-only — the status history)

> **Verb naming locked here (authoritative).** The kit uses `guardianship.claim_submitted` for the parent
> submit. (Winston's `plan.md` §3 uses the synonym `claim_requested` in prose — S1 implements the **table
> below**; treat `claim_requested` as the same verb.) All four are **new `AuditLog.action` strings**, not
> schema.

| Verb (`AuditLog.action`) | When | `resourceType` | `before` → `after` |
|---|---|---|---|
| `guardianship.claim_submitted` | parent submits a claim that **matched** (claim `submitted`, link `pending`) | `guardianship_claim` | `null` → `{ status:'submitted', claimedFirstName, claimedLastName, claimedDob, claimedExternalRef, matchedStudentId, guardianshipId }` |
| `guardianship.claim_match_failed` | parent submits a claim that **did not match** (claim `match_failed`, no link) | `guardianship_claim` | `null` → `{ status:'match_failed', claimedFirstName, claimedLastName, claimedDob, claimedExternalRef }` |
| `guardianship.claim_approved` | admin approves a `submitted` claim | `guardianship_claim` | `{ status:'submitted', guardianship:'pending' }` → `{ status:'approved', guardianship:'active', decidedBy, decidedAt }` |
| `guardianship.claim_rejected` | admin rejects a `submitted` claim | `guardianship_claim` | `{ status:'submitted', guardianship:'pending' }` → `{ status:'rejected', guardianship:'revoked', decisionReason }` |
| `guardianship.claim_resubmitted` | parent re-submits a `rejected` claim | `guardianship_claim` | `{ status:'rejected' }` → `{ status:'submitted', guardianship:'pending' }` |
| `guardianship.claim_withdrawn` | parent withdraws a still-`submitted` claim | `guardianship_claim` | `{ status:'submitted' }` → `{ status:'withdrawn', guardianship:'revoked' }` |

`actorId` = the acting `UserProfile` (parent for submit/re-submit/withdraw, admin for approve/reject);
`tenantId` server-derived; `portal` = `parent` or `admin`. The append-only log is the *audit trail*; the
`GuardianshipClaim.status` is the *queryable* state. **No separate `claim_status_history` table** (E1-S1
precedent: the log carries the transition history).

> **Notification reconciliation.** `contracts/openapi.yaml` describes the parent notification on
> approve/reject as `kind=guardianship` — **there is no `guardianship` `NotificationKind`** in the schema,
> and the intake/spec forbid a new kind. **Authoritative ruling (PM):** the notification reuses the
> existing **`enrollment_status` `NotificationKind`** (schema:1215 — semantically "a status changed on your
> child's enrollment/attachment"), via `NotificationsService.createMany`, **no new kind, no new queue**.
> Read every `kind=guardianship` in the contract prose as `kind=enrollment_status`. (Recorded in `tasks.md`
> T-S3.5 as a must-fix-on-implementation contract note.)

## 7. Migration plan

- **S1:** `prisma db push` creates the **one new `guardianship_claim` table** + the **one new
  `GuardianshipClaimStatus` enum** + the additive back-relation arrays on `Guardian`/`Student`/
  `Guardianship`, **plus** the raw partial unique index `guardianship_claim_open_unique ON guardianship_claim
  (guardian_id, matched_student_id) WHERE status = 'submitted'` applied idempotently on API boot (the
  E7-S2 `BookingIndexBootstrap` idiom — Prisma can't express a partial `@@unique`). **No SQL migration
  folder** (project convention). Existing rows untouched; `db push` is idempotent. **This is the only
  schema step in the entire epic.**
- **S2 / S3:** **no schema change** — reads + the approve/reject/re-submit/withdraw transitions operate
  entirely on the S1 table + the existing `Guardianship`/`AuditLog`/`Notification` tables.
- **Operator note:** like E7/E8, the additive `db push` must be applied to dev/prod by an operator before
  `/parent/children` (claim) + `/admin/child-claims` are functional. Until then the parent form returns a
  graceful "indisponible" state and the admin queue is empty (no crash).
