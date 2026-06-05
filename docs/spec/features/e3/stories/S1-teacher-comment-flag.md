# E3-S1 — `TEACHER_COMMENT_FLAG`: teacher grade-flag + dual byte-parity evaluator

> **Self-contained story spec** (John, BMAD PM). A developer implements **this slice alone** from
> this file. Parent epic: [`../spec.md`](../spec.md) · slice backlog: [`../tasks.md`](../tasks.md) ·
> data model: [`../data-model.md`](../data-model.md). **One vertical slice, one PR.** Risk tier **P1**,
> tags `[schema][auth]`.

## 0. One-sentence intent
Let a teacher flag a **published** grade as *« à signaler »* and have the `TEACHER_COMMENT_FLAG` rule
raise **one explainable guardian alert** on the next evaluation pass — taking the alert engine from
**5/7 → 6/7 rules live**.

`touchesUi: true` · `touchesBackend: true` · `touchesWorker: true`

---

## 1. Scope — exactly what ships in this PR

A thin DB → API → worker → UI slice:

1. **DB (additive, `db push`, no SQL migration):** 4 new nullable/defaulted fields + 1 index on
   `Grade`.
2. **API:** idempotent ownership-ABAC `PATCH /api/v1/grades/:id/flag` + append-only audit; a new
   `evaluateTeacherCommentFlag` evaluator registered in `AlertsService.RULE_FN`.
3. **Worker:** **byte-parity** copy of the evaluator registered in the worker `RULE_FN`.
4. **UI:** a flag toggle on each **published** gradebook cell (teacher portal); remove the
   "UI seulement" badge for `TEACHER_COMMENT_FLAG` on `/admin/alerts`.

**Out of scope (do NOT do here):** the `IMPROVEMENT`/7th rule (S2), the admin rule-config editor
(S3), the cron-email path (S4), any new free-text messaging surface, any event-driven re-eval, any
new BullMQ queue/email template, any change to the 5 live rules or the 7-day dedup. See `../spec.md` §6.

---

## 2. DB change — `Grade` flag fields (the ONLY schema change in S1)

Edit `apps/api/prisma/schema.prisma`, `model Grade` (currently lines ~856–879). Add **inside** the
model, after `comment` / before the relations:

```prisma
  // --- E3-S1: teacher "concern" flag feeding TEACHER_COMMENT_FLAG ---
  isFlagged   Boolean   @default(false) @map("is_flagged")
  flaggedAt   DateTime? @map("flagged_at") @db.Timestamptz(6)
  flaggedBy   String?   @map("flagged_by") @db.Uuid   // UserProfile id of the flagging teacher (lightweight provenance, NOT a FK — matches Grade.enteredBy / AlertInstance.acknowledgedBy)
  flagNote    String?   @map("flag_note")             // OPTIONAL short reason; no new messaging surface
```

And add the index alongside the existing `@@index` lines (keep `@@map("grade")` last):

```prisma
  @@index([tenantId, isFlagged])
```

**Pre-merge step (documented, not run by implement agents):** `pnpm --filter @pilotage/api exec
prisma generate` then `prisma db push`. Additive + defaulted ⇒ safe on existing rows, no backfill.

**Decisions (locked):**
- `flaggedBy` is `String? @db.Uuid` (no relation pair) — provenance for audit only.
- `flagNote` is **optional**; the controller accepts an optional `note` and stores it. Reusing
  `Grade.comment` is allowed but the explicit `flagNote` keeps the concern separate from the
  teacher's pedagogical comment — **ship `flagNote`**.
- The flag is only meaningful on a **published** grade (see §3, §4).

---

## 3. API — `PATCH /api/v1/grades/:id/flag`

Add ONE endpoint to the **existing** `GradesController`
(`apps/api/src/modules/grades/grades.controller.ts`). Reuse the controller's existing
`assertCanWrite(teacherProfileId, me, jwt)` ownership helper (lines ~296–307) — it is exactly the
ABAC this needs (super/school admin pass; a teacher passes only on their own assignment).

**Request DTO** (add next to the other DTO classes at the top of the controller):
```ts
class FlagGradeDto {
  @IsBoolean() flagged!: boolean;
  @IsOptional() @IsString() @MaxLength(280) note?: string;
}
```

**Handler shape** (mirror the existing `revise` handler's load + ABAC + `$transaction`):
```ts
@Patch(':id/flag')
@RequiresPermission('grades.write')
async flag(
  @Param('id') id: string,
  @Body() body: FlagGradeDto,
  @CurrentJwt() jwt: KeycloakJwtPayload,
) {
  const me = await this.users.ensureUser(jwt);
  const grade = await this.prisma.grade.findUnique({
    where: { id },
    include: { assessment: true },
  });
  // Cross-tenant id → 404 (never leak existence). Same guard as `revise`.
  if (!grade || grade.tenantId !== me.tenantId) throw new NotFoundException();
  // Ownership ABAC: non-owner teacher → 403 (assertCanWrite throws ForbiddenException).
  await this.assertCanWrite(grade.assessment.teacherProfileId, me, jwt);
  // Flag is only meaningful on a published/revised grade — a draft is not visible to parents,
  // so flagging it is a no-op the rule would never read. Reject with 400.
  if (grade.status === 'draft') {
    throw new BadRequestException(
      'Seules les notes publiées peuvent être signalées.',
    );
  }

  const alreadyFlagged = grade.isFlagged;
  const willFlag = body.flagged;

  // Idempotent: flag→flag or unflag→unflag is a no-op (no re-stamp, no duplicate audit row).
  if (alreadyFlagged === willFlag) {
    return { id: grade.id, isFlagged: grade.isFlagged };
  }

  const updated = await this.prisma.grade.update({
    where: { id: grade.id },
    data: willFlag
      ? { isFlagged: true, flaggedAt: new Date(), flaggedBy: me.id, flagNote: body.note?.trim() || null }
      : { isFlagged: false, flaggedAt: null, flaggedBy: null, flagNote: null },
    select: { id: true, isFlagged: true },
  });

  // Append-only audit (inline prisma.auditLog.create — the established convention, see
  // AlertsService.writeAuditEntry). Best-effort: a write failure is logged, never rolls back.
  try {
    await this.prisma.auditLog.create({
      data: {
        tenantId: me.tenantId,
        actorId: me.id,
        actorRole: jwt.realm_access?.roles?.find((r) => ['teacher','school_admin','super_admin'].includes(r)) ?? null,
        portal: 'teacher',
        action: willFlag ? 'grade.flag' : 'grade.unflag',
        resourceType: 'grade',
        resourceId: grade.id,
        after: { isFlagged: willFlag, note: willFlag ? (body.note?.trim() || null) : null } as Prisma.InputJsonValue,
      },
    });
  } catch (err) {
    // log + swallow (mirror writeAuditEntry); never fail the flag write
  }

  return updated;
}
```

Add the imports the handler needs: `Patch` from `@nestjs/common`, `Prisma` from `@prisma/client`
(the controller currently has neither). `IsBoolean`, `IsString`, `IsOptional`, `MaxLength` are
already imported.

**Invariants:**
- Cross-tenant grade id → **404**; non-owner teacher → **403**; draft grade → **400**.
- **Idempotent**: a redundant flag/unflag returns 200 and writes **no** audit row.
- Exactly **one** append-only `AuditLog` row per real transition (`grade.flag` / `grade.unflag`),
  `resourceType: 'grade'`, `resourceId: gradeId`, tenant-scoped.
- Permission stays `grades.write` (the existing teacher write permission).

### Evaluator — `evaluateTeacherCommentFlag`

Create `apps/api/src/modules/alerts/rules/teacher-comment-flag.rule.ts`. Use the
`RuleContext`/`DetectedAlert` contract (`./rule-context`). Structure it like
`missing-assessment.rule.ts` (single `grade.findMany`, group, emit), but with **one alert per flagged
grade** (no aggregation needed — the teacher already chose what to flag):

```ts
import type { DetectedAlert, RuleContext } from './rule-context';

/**
 * TEACHER_COMMENT_FLAG — fires once per grade a teacher has explicitly flagged
 * « à signaler ». Reads ONLY flagged + published grades, tenant-scoped, in the
 * active academic year. No parameters (the teacher's flag IS the signal). One
 * explainable DetectedAlert per flagged grade; the standard 7-day
 * (rule, student, subject) dedup at the evaluator caller prevents re-pinging.
 */
export async function evaluateTeacherCommentFlag(ctx: RuleContext): Promise<DetectedAlert[]> {
  if (!ctx.academicYearId) return [];
  const grades = await ctx.prisma.grade.findMany({
    where: {
      tenantId: ctx.tenantId,
      status: 'published',
      isFlagged: true,
      assessment: {
        teachingAssignment: {
          academicYearId: ctx.academicYearId,
          ...(ctx.schoolId
            ? { classSection: { gradeLevel: { cycle: { schoolId: ctx.schoolId } } } }
            : {}),
        },
      },
    },
    include: {
      assessment: {
        include: {
          teachingAssignment: {
            include: {
              subject: { select: { id: true, name: true, code: true } },
              classSection: { select: { id: true, name: true } },
            },
          },
        },
      },
    },
    orderBy: [{ flaggedAt: 'asc' }, { createdAt: 'asc' }],
    take: 100_000,
  });

  const out: DetectedAlert[] = [];
  for (const g of grades) {
    const subj = g.assessment.teachingAssignment.subject;
    const cs = g.assessment.teachingAssignment.classSection;
    const note = (g.flagNote ?? '').trim();
    out.push({
      studentId: g.studentId,
      subjectId: subj.id,
      classSectionId: cs.id,
      title: `Signalement enseignant en ${subj.name}`,
      body: note
        ? `L'enseignant·e a signalé l'évaluation « ${g.assessment.title} » en ${subj.name} : ${note}`
        : `L'enseignant·e a signalé l'évaluation « ${g.assessment.title} » en ${subj.name} comme méritant votre attention.`,
      recommendation:
        "Échangez avec l'enseignant·e de la matière pour comprendre le signalement et convenir d'un appui si besoin.",
      context: {
        gradeId: g.id,
        subjectCode: subj.code,
        flaggedBy: g.flaggedBy,
        flaggedAt: g.flaggedAt?.toISOString() ?? null,
      },
    });
  }
  return out;
}
```

Register it in `AlertsService.RULE_FN`
(`apps/api/src/modules/alerts/alerts.service.ts`, the `RULE_FN` map ~line 42):
```ts
import { evaluateTeacherCommentFlag } from './rules/teacher-comment-flag.rule';
// ...
TEACHER_COMMENT_FLAG: evaluateTeacherCommentFlag,
```
Update the trailing stub comment so only `BEHAVIOR_ALERT` remains listed as unwired.

**Dedup is unchanged:** the existing `evaluateAll` loop dedups on `(ruleId, studentId, subjectId,
7-day window, status in [open,acknowledged])`. Because the dedup key is `(rule, student, subject)`,
two flagged grades for the **same student in the same subject** within 7 days collapse to one open
alert — acceptable and matches the existing rules' behaviour. Do not change the dedup logic.

---

## 4. Worker — byte-parity evaluator

Create `apps/worker/src/modules/alerts-rules/teacher-comment-flag.rule.ts` as a **byte-identical**
copy of the API rule body (same import-from-`./rule-context`, same logic) — the established
duplication convention (a reviewer diffs the pair; they must be identical). Register it in the worker
`RULE_FN` (`apps/worker/src/modules/alerts-cron/alerts-evaluator.service.ts`, the `RULE_FN` map
~line 24):
```ts
import { evaluateTeacherCommentFlag } from '../alerts-rules/teacher-comment-flag.rule';
// ...
TEACHER_COMMENT_FLAG: evaluateTeacherCommentFlag,
```
The worker dedup loop is identical to the API's (same `(ruleId, studentId, subjectId, since)` guard)
— no change.

---

## 5. UI — teacher gradebook flag toggle + admin badge removal

### 5a. Teacher gradebook (`apps/web`)
The gradebook cell already exposes the grade `id`, `status`, and `comment` per cell
(`apps/web/src/app/teacher/classes/[id]/grades/Gradebook.tsx`, the `<td>` at lines ~174–214 and the
`gradebookForAssignment` row shape in `apps/api/.../grades.service.ts` ~lines 234–239).

1. **Expose the flag in the gradebook payload.** In `grades.service.ts`
   `gradebookForAssignment`, add `isFlagged: g.isFlagged` (and optionally `flagNote: g.flagNote`) to
   the per-cell object returned at ~lines 234–239. Reflect the new field in the `GradebookData`
   type in `apps/web/src/app/teacher/classes/[id]/grades/page.tsx`.
2. **Add a flag toggle** to each **published/revised** cell (only — a draft cell shows no toggle,
   matching the API's 400). Render a small ghost button using a `lucide-react` icon
   (`Flag` filled when `isFlagged`, outline when not) under the `abs.` label. On click, call a new
   server action `flagGrade({ gradeId, flagged })` → `PATCH /api/v1/grades/:id/flag`, then
   `router.refresh()`. Show a busy spinner; on error surface the existing `setError` banner.
   Optimistic toggle is acceptable but must revalidate.
3. **New server action** in `apps/web/src/app/teacher/classes/[id]/grades/actions.ts`:
   ```ts
   export async function flagGrade(payload: { gradeId: string; flagged: boolean; note?: string }): Promise<Result> {
     try {
       const data = await api(`/api/v1/grades/${payload.gradeId}/flag`, {
         method: 'PATCH',
         body: { flagged: payload.flagged, ...(payload.note ? { note: payload.note } : {}) },
       });
       return { ok: true, data };
     } catch (err) { return toError(err); }
   }
   ```
   (`Result`/`toError` already exist in that file.)
4. **Reuse `@pilotage/ui` first.** Use existing primitives/icon-button styling; no new shared
   component unless it improves consistency. WCAG 2.2 AA: the toggle needs an accessible label
   (`aria-pressed`, `title="Signaler / Retirer le signalement"`), ≥24px target, visible focus ring.
   Mobile-first (the gradebook already scrolls horizontally).

### 5b. Admin `/admin/alerts` badge
In `apps/web/src/app/admin/alerts/page.tsx`, the `RULE_IMPLEMENTED` map (~lines 70–74) currently
lists only 3 codes. **Add `TEACHER_COMMENT_FLAG: true`** so the "UI seulement / non implémenté" badge
disappears for it.
> Note: `NEGATIVE_TREND` and `MISSING_ASSESSMENT` are *also* live in `RULE_FN` but absent from this
> map — a pre-existing display inconsistency. S1 **only** adds `TEACHER_COMMENT_FLAG` (its scoped
> deliverable); fixing the other two is out of this slice's scope (flag it, don't fix it here).

---

## 6. Acceptance criteria (this slice)

1. **6/7 rules live.** `TEACHER_COMMENT_FLAG` maps to a real evaluator in **both**
   `apps/api/.../alerts.service.ts` and `apps/worker/.../alerts-evaluator.service.ts`; the two rule
   files are **byte-identical**; only `BEHAVIOR_ALERT` remains a stub.
2. **Teacher can flag/unflag a published grade they own** via `PATCH /api/v1/grades/:id/flag`.
   Non-owner teacher → **403**; cross-tenant grade id → **404**; draft grade → **400**.
3. **Idempotent + audited:** a redundant flag/unflag is a 200 no-op writing **no** audit row; every
   real transition writes exactly **one** append-only `AuditLog` row (`grade.flag` / `grade.unflag`),
   tenant-scoped.
4. **Evaluator reads only flagged + published grades**, tenant-scoped, active-year-scoped; emits one
   explainable `DetectedAlert` per flagged grade (rule + subject + the teacher's concern +
   "échangez avec l'enseignant·e" action); never comparative / never names another child.
5. **Dedup unchanged:** the existing 7-day `(rule, student, subject)` window is reused as-is; no new
   alert for an already-open flag alert on the same (student, subject) within the window.
6. **UI:** a teacher sees a flag toggle on published gradebook cells and can flag/unflag with
   feedback; the `/admin/alerts` "UI seulement" badge is gone for `TEACHER_COMMENT_FLAG`.
7. **Tenant + RLS invariants:** the new `Grade` fields inherit the table's existing `tenant_id`/RLS;
   no new cross-tenant surface; `db push` is additive/safe (no backfill).
8. **Gates:** `pnpm typecheck` passes (Murat); no `git diff --check` errors; `prisma generate` +
   `db push` documented as the pre-merge step. No new ADR required (additive field + an evaluator on
   the existing contract — no new architectural decision).

---

## 7. Pre-mortem → extra acceptance criteria (Critic / Edge Hunter)

- **A teacher unflags after an alert is already raised.** Unflag must NOT retroactively close the
  open `AlertInstance` (that is the parent's E1 lifecycle). Unflag only clears `isFlagged` so **future**
  passes stop re-detecting; the existing open alert stays until ack/resolve/dismiss. (No code needed —
  this is the natural behaviour; assert it in a test.)
- **Two flagged grades, same student + subject, same week.** Dedup collapses them to one open alert
  (by design). Acceptance: no duplicate alert; the second flagged grade does not create a second open
  instance within the window.
- **`flaggedBy` references a teacher later deleted.** It is a plain UUID (no FK), so a stale id never
  breaks the read; the alert body uses subject + note, not the teacher's name → no crash, no leak.
- **Flag a grade whose assessment is later unpublished/deleted.** The evaluator filters
  `status: 'published'` on the **grade**, so an unpublished/cascade-deleted grade simply stops being
  read — no orphan alert.
- **Note injection / length.** `note` is capped at 280 chars and trimmed; it is rendered as text
  (React escapes it) — no HTML injection. Empty/whitespace note → the "comme méritant votre attention"
  fallback body.
- **Idempotent double-click** (the parent UX hazard from E1): the `alreadyFlagged === willFlag`
  short-circuit guarantees one audit row even under rapid repeat clicks.

## 8. Targeted test (Murat — the single most valuable test)
A `grades.controller` (or service) spec asserting the **flag ABAC + idempotency + audit** quartet in
one file: (a) non-owner teacher → 403, (b) cross-tenant id → 404, (c) draft → 400, (d) flag then
flag-again → single audit row + 200 no-op, (e) flag then unflag → two audit rows, `isFlagged=false`.
Plus a `teacher-comment-flag.rule` spec: only flagged+published+in-tenant+in-year grades produce a
`DetectedAlert`; a draft-flagged or other-tenant grade produces none. **P1.**

## 9. Files touched (expected)
- `apps/api/prisma/schema.prisma` — 4 `Grade` fields + `@@index([tenantId, isFlagged])`.
- `apps/api/src/modules/grades/grades.controller.ts` — `FlagGradeDto` + `PATCH :id/flag` + imports.
- `apps/api/src/modules/grades/grades.service.ts` — expose `isFlagged` (+`flagNote`) in gradebook cell.
- `apps/api/src/modules/alerts/rules/teacher-comment-flag.rule.ts` — **new** evaluator.
- `apps/api/src/modules/alerts/alerts.service.ts` — register in `RULE_FN` + import + comment.
- `apps/worker/src/modules/alerts-rules/teacher-comment-flag.rule.ts` — **new** byte-parity copy.
- `apps/worker/src/modules/alerts-cron/alerts-evaluator.service.ts` — register in `RULE_FN` + import.
- `apps/web/src/app/teacher/classes/[id]/grades/Gradebook.tsx` — flag toggle on published cells.
- `apps/web/src/app/teacher/classes/[id]/grades/actions.ts` — `flagGrade` server action.
- `apps/web/src/app/teacher/classes/[id]/grades/page.tsx` — `GradebookData` cell type +`isFlagged`.
- `apps/web/src/app/admin/alerts/page.tsx` — `RULE_IMPLEMENTED.TEACHER_COMMENT_FLAG = true`.
- *(tests)* `apps/api/src/modules/grades/*.spec.ts` + `apps/api/src/modules/alerts/rules/teacher-comment-flag.rule.spec.ts`.
