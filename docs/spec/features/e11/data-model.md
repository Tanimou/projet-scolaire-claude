# E11 — Data model (Prisma migration plan)

> Minimal **additive** schema. Reuse `ImportBatch` / `ImportRow` and their enums as the substrate; add only
> what async execution, reconciliation classification, and a OneRoster source genuinely require. No
> rename/removal of any existing column or enum value. Verified against
> `apps/api/prisma/schema.prisma` (lines 61–95 enums, 667–710 models). No `db push` in this run — each
> schema slice carries its own additive `db push` as an operator pre-req (the E7/E8/E9 precedent).

## 0. What already exists (reuse, do not duplicate)

```prisma
enum ImportType { students classes subjects teachers parents enrollments grades attendance }
enum ImportStatus { uploaded validating validated applying applied failed rolled_back }
enum ImportMode { all_or_nothing skip_invalid }
enum ImportRowStatus { pending valid invalid applied skipped rolled_back }

model ImportBatch { id tenantId schoolId type fileName rawCsv status mode summary(Json)
                    triggeredBy startedAt validatedAt appliedAt rolledBackAt errorMessage … rows[] }
model ImportRow   { id batchId rowIndex status payload(Json) errors(Json?)
                    createdEntityId createdEntityType createdAt }
```

The `summary` Json on `ImportBatch` and `payload`/`errors` Json on `ImportRow` are **flexible carriers** —
several E11 needs ride them with **zero schema change** (e.g. the live progress counter, the reconciliation
roll-up). Only structural needs (a new status value, a per-row reconciliation class we want to **query**,
the OneRoster source config) take real columns.

## 1. S1 — async execution (additive, minimal)

### 1.1 `ImportStatus` — add `queued`
The batch sits between `validated` (admin clicked apply) and `applying` (worker picked it up):

```prisma
enum ImportStatus {
  uploaded
  validating
  validated
  queued        // NEW — enqueued to QUEUE_IMPORTS, awaiting the worker
  applying
  applied
  failed
  rolled_back
}
```

> Adding an enum value is additive (existing rows keep their value; the FE status maps add one key). The
> batch-detail status map already covers every other value (`apps/web/.../imports/[id]/page.tsx`).

### 1.2 Live progress — **no schema change**
Write the running counter into the existing `summary` Json (`{ processedRows, totalToApply, applied,
skipped }`). The UI already reads `summary` for KPI cards. A mid-run poll reads the latest counter. No
column needed.

> **Alternative considered & rejected:** a dedicated `processedRows Int` column. Rejected — `summary` Json
> already carries the counts the UI renders; a column adds a migration for ephemeral data.

## 2. S2 — reconciliation classification (additive)

### 2.1 `ReconciliationClass` enum (NEW) + `ImportRow.reconciliation`
We want to **filter/aggregate** rows by class in the health panel (the existing rows table already filters by
`status`), so it earns a queryable column rather than living only in Json:

```prisma
enum ReconciliationClass {
  created
  updated
  unchanged
  conflict
  skipped
}

model ImportRow {
  // … existing fields unchanged …
  reconciliation  ReconciliationClass? @map("reconciliation")   // NEW — null until applied
  conflictFields  Json?                @map("conflict_fields")   // NEW — [{ field, current, source }] when class=conflict
  @@index([batchId, reconciliation])                            // NEW — health-panel facet
}
```

- `reconciliation` is **nullable** (rows pre-apply, or invalid rows, have none). It is set by the worker when
  a row is applied, classifying the upsert outcome.
- `conflictFields` carries the source-vs-current diff for `conflict` rows so the drawer renders without a
  second query. Empty/absent for non-conflict rows.
- The batch-level roll-up (`{ created, updated, unchanged, conflict, skipped }`) rides the existing
  `summary` Json — **no batch column added**.

> **Note:** `ImportRowStatus` (`applied`/`skipped`/…) and `ReconciliationClass` are **orthogonal**: status
> answers *did the pipeline process this row*; reconciliation answers *what did the upsert do*. An `applied`
> row carries `created|updated|unchanged`; a `skipped` row carries `skipped`; a row blocked on `conflict`
> stays `valid` with `reconciliation=conflict` until resolved. Keeping them separate avoids overloading the
> existing status enum the wizard/rollback already depend on.

## 3. S3 — OneRoster source (additive model)

```prisma
enum RosterSourceKind {
  oneroster_csv     // a uploaded OneRoster v1.1 CSV bundle (zip of students/classes/enrollments)
  oneroster_rest    // a REST base-url + bearer key (optional stretch in S3)
}

enum RosterSyncStatus {
  idle
  pulling
  mapped            // pulled + mapped into an ImportBatch, awaiting apply
  failed
}

model RosterSource {
  id          String           @id @default(uuid()) @db.Uuid
  tenantId    String           @map("tenant_id") @db.Uuid
  schoolId    String           @map("school_id") @db.Uuid
  kind        RosterSourceKind
  label       String                                    // admin-given name, e.g. "District OneRoster 2026"
  baseUrl     String?          @map("base_url")          // rest only
  // SECRET HANDLING: never store a raw key in plaintext. Store an encrypted/opaque ref
  // (reuse the platform's secret strategy) or a vault key id. Audited, never returned to the client.
  credentialRef String?        @map("credential_ref")
  status      RosterSyncStatus @default(idle)
  lastSyncAt  DateTime?        @map("last_sync_at") @db.Timestamptz(6)
  lastBatchId String?          @map("last_batch_id") @db.Uuid   // the most recent ImportBatch produced
  createdBy   String?          @map("created_by") @db.Uuid
  createdAt   DateTime         @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt   DateTime         @updatedAt @map("updated_at") @db.Timestamptz(6)

  school      School           @relation(fields: [schoolId], references: [id], onDelete: Cascade)

  @@index([tenantId, schoolId])
  @@map("roster_source")
}
```

- **Tenant + school scoped**, admin-only (`integrations.write`).
- The credential is **never** stored or returned in plaintext (RGPD/security): store an opaque
  `credentialRef`, resolve it server-side at pull time only. Sentinel must confirm this on the S3 slice.
- A sync **produces an `ImportBatch`** (`origin = oneroster`, see §4), so the whole apply/reconcile/rollback
  machinery is reused — `RosterSource` is config + provenance, not a parallel pipeline.

## 4. S3 — `ImportBatch.origin` (additive, provenance)

To distinguish a human CSV upload from a OneRoster-pulled batch (for the health panel header + filtering),
add a nullable origin discriminator:

```prisma
enum ImportOrigin {
  csv_upload        // the existing admin wizard path (default for existing rows)
  oneroster         // produced by a RosterSource sync
}

model ImportBatch {
  // … existing fields unchanged …
  origin        ImportOrigin? @default(csv_upload) @map("origin")        // NEW — null/csv_upload for existing rows
  rosterSourceId String?      @map("roster_source_id") @db.Uuid          // NEW — set when origin=oneroster
}
```

> Nullable + defaulted ⇒ every existing batch reads as `csv_upload`, zero behaviour change. `rawCsv` already
> exists to carry the (mapped) CSV body, so a OneRoster batch can reuse the exact storage shape.

## 5. Migration / rollout per slice

| Slice | Schema change | Apply |
|---|---|---|
| S1 | `ImportStatus += queued` | additive `db push`; FE status map adds one key |
| S2 | `ReconciliationClass` enum + `ImportRow.reconciliation` + `conflictFields` + index | additive `db push` |
| S3 | `RosterSourceKind`/`RosterSyncStatus`/`ImportOrigin` enums + `RosterSource` model + `ImportBatch.origin`/`rosterSourceId` | additive `db push` |
| S4 | none (reuses S1–S3) | — |

All additive (new enum values, new nullable columns, new model). No destructive migration. Each slice's
`db push` is an **operator pre-req** that gates demoability, not merge (the E7/E8/E9 precedent — the routine
can't run infra). FE surfaces degrade kindly when the additive schema is not yet applied (graceful
"indisponible", never a crash).

## 6. Tenancy & audit (non-negotiable)

- `RosterSource`, `ImportBatch`, `ImportRow` all carry/inherit `tenantId`; every query re-scopes (ADR-002
  RLS + explicit `where tenantId`). A OneRoster pull writes only into the calling tenant's school.
- Append-only `AuditLog` rows: `import.apply` / `import.rollback` (existing) + new
  `import.sync.pull` / `import.sync.apply` / `import.conflict.resolve` (S3/S4). Actor, tenant, before/after.
- No raw credential, no other-tenant roster, no child PII ever leaves the reconciliation panel.
