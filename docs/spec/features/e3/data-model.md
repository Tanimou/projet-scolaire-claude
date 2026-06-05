# E3 — Data model & migration plan (Architect: Winston)

> Companion to [`spec.md`](./spec.md) / [`plan.md`](./plan.md). E3 is **almost entirely
> behavioural** (wiring evaluators that already have reserved enum codes) — the **only schema change
> in the whole epic is S1's additive grade-flag field**. Convention: **`prisma db push`, no SQL
> `migrations/` folder** (repo-wide — verified: `apps/api/prisma/migrations/` does not exist).

## 0. What already exists (no change needed)

- **`enum AlertRuleCode`** (schema.prisma) and **`ALERT_RULE_CODE`** (`packages/contracts`) already
  list **all 7** codes incl. `TEACHER_COMMENT_FLAG` + `BEHAVIOR_ALERT`. → **no enum migration.**
- **`AlertRule`** (`parameters Json`, `severity`, `enabled`, `@@unique([tenantId, schoolId, code])`)
  fully supports S3's threshold/severity/period editing **as-is**. → **no model change for S3.**
- **`AlertInstance`** carries `code`, `severity`, `title`, `body`, `recommendation`, `context Json`,
  the 7-day dedup, and the E1 lifecycle columns → both new rules persist through it unchanged.
- **`RULE_DEFAULTS`** already has entries for both new codes. S2 keeps/uses the `IMPROVEMENT` slot
  (re-purposing the reserved 7th — see §3); S1 uses the `TEACHER_COMMENT_FLAG` slot.
- **`NotificationPreference(kind, emailEnabled)`** + the `alert` `NotificationKind` already exist →
  S4 needs **no schema change** (it reuses the `alert` kind's email opt-in).
- Worker **`MailerService`** + the **`notifications-email`** template/processor already exist
  (parent-digest + API paths use them) → S4 reuses, no new table/queue/template.

## 1. S1 — the ONLY schema change: a teacher flag on `Grade` (additive)

`TEACHER_COMMENT_FLAG` needs a backing signal. `Grade` already has a `comment String?` the teacher
owns; E3 adds a **minimal boolean flag + provenance** so the evaluator can read "this published
grade was explicitly flagged by its teacher as concerning". **Additive, nullable/defaulted — no
backfill, no breaking change.**

```prisma
/// One grade per (assessment × student). (existing — only the flag fields are NEW)
model Grade {
  // ... all existing fields unchanged ...

  // --- E3-S1: teacher "concern" flag feeding TEACHER_COMMENT_FLAG ---
  isFlagged   Boolean   @default(false) @map("is_flagged")
  flaggedAt   DateTime? @map("flagged_at") @db.Timestamptz(6)
  flaggedBy   String?   @map("flagged_by") @db.Uuid   // UserProfile id of the teacher who flagged
  flagNote    String?   @map("flag_note")             // OPTIONAL short reason; reuse `comment` if preferred — no new free-text surface

  // existing relations unchanged ...

  // Partial-style index to scan only flagged published grades cheaply per tenant.
  @@index([tenantId, isFlagged])
  @@map("grade")
}
```

**Notes / decisions**
- `flaggedBy` is a **plain `String? @db.Uuid`** (UserProfile id), **not** a hard FK, to match the
  lightweight provenance style used elsewhere (e.g. `AlertInstance.acknowledgedBy`,
  `Grade.enteredBy`) and avoid a new relation pair. The teacher who flagged is captured for audit.
- `flagNote` is **optional** and may be **omitted entirely** in favour of reusing the existing
  `Grade.comment` — implementer's call. The spec's non-goal stands: **no new free-text messaging
  surface**; the flag is a boolean signal, the note is at most a short reason.
- The flag is only meaningful on a **published** grade; the evaluator filters `status: 'published'`
  + `isFlagged: true` (and unflag sets `isFlagged=false`, clearing the signal).
- **Audit:** the flag/unflag endpoint writes an append-only `AuditLog` row (`grade.flag` /
  `grade.unflag`, `resourceType: 'grade'`, `resourceId: gradeId`) — no `grade_flag_history` table
  (the audit row *is* the history, mirroring E1's alert-status decision).

### S1 evaluator read shape (no schema impact)
`evaluateTeacherCommentFlag(ctx)` does **one** `grade.findMany`:
```
where: {
  tenantId, status: 'published', isFlagged: true,
  assessment: { teachingAssignment: {
    academicYearId: ctx.academicYearId,
    ...(schoolId ? { classSection: { gradeLevel: { cycle: { schoolId } } } } : {}),
  } },
}
include: { assessment.teachingAssignment.{subject, classSection}, student }
```
→ one `DetectedAlert` per flagged grade: `title` "Signalement enseignant en {matière}", `body` the
concern (flagNote/comment, sanitised), `recommendation` "Échangez avec l'enseignant·e" (deep-links to
E2 messaging), `context` `{ gradeId, subjectCode, flaggedBy, flaggedAt }`. Dedup key reuses the
standard `(rule, student, subjectId)` 7-day window. `subjectId`/`classSectionId` from the assignment.

## 2. S2 — `IMPROVEMENT` rule: **no schema change**

Reads the **same published grades** as `NEGATIVE_TREND` (its structural twin), groups by
`(student, subject)`, splits the trailing `windowAssessments` window into two halves, and fires when
`lastHalfAvg − firstHalfAvg ≥ delta` (the **inverse** comparison). Persists through the existing
`AlertInstance` path. `RULE_DEFAULTS.IMPROVEMENT` parameters: `{ delta: 1.5, windowAssessments: 3 }`,
`severity: 'low'`. **Zero new tables/columns; zero new data collection** (RGPD minimal — the headline
reason this rule, not `BEHAVIOR_ALERT`, is the 7th).

> **`RULE_DEFAULTS` / `RULE_CODES` edit (types only, not schema):** today the reserved 7th code is
> `BEHAVIOR_ALERT`. S2 introduces the **`IMPROVEMENT`** evaluator. Two implementation options, both
> additive at the **enum** level only (the Prisma `AlertRuleCode` enum is additive):
> - **(preferred) add `IMPROVEMENT` as an 8th reserved code** alongside `BEHAVIOR_ALERT` (which
>   stays unwired) → cleanest semantics, `IMPROVEMENT` ≠ a disciplinary alert. Requires adding
>   `IMPROVEMENT` to the `AlertRuleCode` enum (additive `db push`) + `ALERT_RULE_CODE` +
>   `RULE_CODES`/`RULE_DEFAULTS`.
> - **(alt) re-purpose the `BEHAVIOR_ALERT` slot** to mean `IMPROVEMENT` in `RULE_DEFAULTS` only,
>   leaving the enum untouched → zero schema change, but a confusing code name.
>
> **Ruling: prefer adding `IMPROVEMENT`** (clear naming wins; the enum add is additive and safe).
> This is the one place S2 touches the enum; it is **not** an architectural decision (a routine
> additive enum value), so **no ADR**. The S2 story records which option shipped.

## 3. S3 — admin rule-config: **no schema change**

Everything edited (enabled / severity / `parameters`) already lives on `AlertRule` and is written by
the existing `PATCH /alerts/rules/:code` → `AlertsService.updateRule`. S3 is **UI + an optional
shared validation contract** in `packages/contracts` (per-rule parameter shapes) — no DB work.

## 4. S4 — cron email: **no schema change**

Reuses `NotificationPreference(kind: 'alert', emailEnabled: true)` and the `notifications-email`
template/processor. See `plan.md` §ADR for the dispatch-shape decision (prefer: worker enqueues the
same job; fallback `MailerService` direct ⇒ ADR-020).

## 5. Index / RLS / tenancy checklist

- New `Grade.isFlagged` fields inherit the model's existing `tenant_id` + RLS policy (no new RLS
  policy needed — same table).
- New index `@@index([tenantId, isFlagged])` keeps the flagged-grade scan tenant-first and cheap.
- No new table ⇒ no new RLS policy, no new tenant-scoping surface, across the whole epic except the
  one additive field.

## 6. Migration steps (per slice)
- **S1:** edit `schema.prisma` (the 4 additive `Grade` fields + index) → `prisma generate` →
  `prisma db push`. Additive + defaulted ⇒ safe on existing rows, no backfill.
- **S2 (preferred option):** additive `IMPROVEMENT` enum value → `prisma generate` + `db push`;
  otherwise (alt option) no schema step.
- **S3, S4:** no schema step.
