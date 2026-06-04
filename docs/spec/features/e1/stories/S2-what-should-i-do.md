# E1-S2 — "What should I do?" panel on the parent alert

> **Self-contained story spec.** A developer must be able to implement this slice
> from this file alone — no other context required. Author: John (BMAD PM).
> Epic: **E1 — Parent Alert Action Loop**. Slice: **S2**. Mode: epic-slice.
> Predecessor: **S1 shipped** (PR #103 — parent ack/resolve/dismiss via guardianship ABAC).

---

## 1. Intent (one sentence)

Turn each parent alert's single static recommendation line into a concrete, explainable
**"Que puis-je faire ?"** panel offering **2–3 actionable next steps** — *renforcer la matière*
(deep-link to the child's subject view), *en parler à l'enseignant* (records a lightweight,
append-only "meeting-request intent" because E2 messaging isn't built yet), and *suivre la
progression* (deep-link to the subject's grades) — reusing the existing `AlertActions` /
recommendations surface, guardianship ABAC, `@pilotage/ui` primitives, and the append-only audit
log, with the S2-bundled route/copy/contrast hardening called out in the roadmap focus pointer.

## 2. Why (ties to the cahier de charges)

The cahier's defining promise is **"turn information into action"**: *every alert is explainable
and leads to a next step (contact the teacher, reinforce a subject, find tutoring)*. After S1 a
parent can ack/resolve/dismiss, but the **recommendation is still passive prose** — it tells them
*what is wrong*, not *what to do next*. S2 closes the "→ action" half of the loop with explicit,
clickable steps. It is deliberately **thin**: the full `MeetingRequest` record + teacher/admin
action-center surfacing is **S3** (do NOT build it here). S2 only records the *intent* on the
existing append-only `AuditLog`, so it ships with **no schema change** and **no new model**.

## 3. Scope flags

- `touchesUi` = **true** (the panel + the page wiring; the bulk of this slice).
- `touchesBackend` = **true** (ONE small endpoint: record the meeting-request intent).
- `touchesWorker` = **false** (no worker job; notifications/dispatch are S3/S4).

## 4. Users & primary scenario

**Actor:** an authenticated **parent** viewing `/parent/recommendations?studentId=<child>` (or the
3 alert cards on `/parent/dashboard` / `/parent/children/[id]`). They have an **active
Guardianship** on the child (the same ABAC gate S1 uses).

**Scenario (happy path):**
1. Parent opens Recommandations. Each alert card already shows title, body, the explainable
   metadata (rule code chip, subject chip, detected date) and — when present — the recommendation
   sentence in the amber "Lightbulb" box.
2. Below the recommendation box, a new **"Que puis-je faire ?"** panel lists **2–3 next-step
   chips/links** derived deterministically from the alert (see §6 mapping). Steps are *kind,
   factual, non-stigmatising*.
3. Parent clicks **« Renforcer {matière} »** → navigates to the child's subject grades view
   (`/parent/grades?studentId=<id>&subjectId=<subjectId>` — the grades page filters on the subject
   *UUID*, not its code), or to `/parent/subjects?studentId=<id>` when the alert has no subject.
4. Parent clicks **« En parler à l'enseignant »** → a lightweight server action POSTs a
   **meeting-request intent**; on success the button shows an inline confirmation
   (« Demande enregistrée — l'équipe sera informée ») and is disabled. No navigation, no page
   reload of the whole list. The intent is written to the append-only `AuditLog` (no new table).
5. Parent clicks **« Suivre la progression »** (when the alert is subject-scoped) → deep-links to
   the subject grades view focused on the trend.

## 5. Explainability requirement (hard)

The panel must keep the alert **explainable** — it states *why* each step is suggested, tying back
to the alert's rule + subject + threshold/trend. Reuse the data already on the `AlertItem`
(`code`, `severity`, `subjectName`, `subjectCode`, `body`, `recommendation`). Do **not** fetch the
raw `AlertInstance.context` JSON to the client (it is "kept for audit/debug — not displayed" per
the Prisma schema comment). The "why" line is composed from the fields already on the DTO.

## 6. Deterministic step mapping (no AI, pure function)

Implement a **pure helper** `deriveAlertActions(alert: AlertItem): AlertNextStep[]` in
`apps/web/src/app/parent/recommendations/alert-next-steps.ts`. Each `AlertNextStep` is one of:

```ts
type AlertNextStep =
  | { kind: 'link'; id: string; label: string; href: string; rationale: string; icon: IconName }
  | { kind: 'intent'; id: string; label: string; rationale: string; icon: IconName };
```

Mapping rules (by `alert.code`), capped at **3 steps**, ordered most-actionable first:

| code | steps |
|---|---|
| `LOW_SUBJECT_AVG`, `NEGATIVE_TREND`, `REPEATED_FAILURE` | (1) **link** « Renforcer {subjectName} » → `/parent/grades?studentId={studentId}&subjectId={subjectId}` *(falls back to `/parent/subjects?studentId={studentId}` when subjectId is null)*; (2) **intent** « En parler à l'enseignant »; (3) **link** « Suivre la progression » → `/parent/grades?studentId={studentId}&subjectId={subjectId}` *(omit if no subject)* |
| `MISSING_ASSESSMENT` | (1) **link** « Voir les évaluations à venir » → `/parent/upcoming?studentId={studentId}`; (2) **intent** « En parler à l'enseignant » |
| `HIGH_ABSENCE` | (1) **link** « Consulter l'assiduité » → `/parent/attendance?studentId={studentId}`; (2) **intent** « En parler à l'enseignant » |
| `TEACHER_COMMENT_FLAG`, `BEHAVIOR_ALERT` | (1) **intent** « En parler à l'enseignant »; (2) **link** « Voir les commentaires » → `/parent/comments?studentId={studentId}` |

- **`studentId` is required** by the helper. The recommendations page currently does NOT carry
  `studentId` on each `AlertItem` from the API DTO mapper. **Add `studentId` to the web `AlertItem`
  type** (`apps/web/src/app/parent/recommendations/types.ts`) and read it from the DTO — the API
  already returns `studentId` on `AlertInstanceDto` (see `alerts.service.ts#toDto`). The page passes
  `activeStudentId` into render anyway, so you may thread that instead of widening the type — pick
  ONE approach and keep it consistent. (Threading `activeStudentId` from the page is the lower-risk
  choice and avoids touching the DTO contract.)
- `rationale` is a short FR sentence, e.g. for `LOW_SUBJECT_AVG`: « La moyenne en {subjectName} est
  sous le seuil — un travail ciblé peut aider. » Keep it factual and kind; never compare to peers
  by name.
- The helper is **pure & unit-testable** (no React, no fetch) — this is the single most valuable
  targeted test (see §10).

## 7. The "talk to the teacher" intent — backend (the only API change)

Because **E2 messaging does not exist yet**, the CTA records an **intent**, not a message. Reuse
the append-only `AuditLog` — **no new Prisma model, no migration** (mirrors S1's decision that "the
append-only `AuditLog` row **is** the status history").

**New endpoint** on the existing `AlertsController`
(`apps/api/src/modules/alerts/alerts.controller.ts`), in the **Parent: scoped lifecycle** section:

```
POST /api/v1/alerts/:id/meeting-intent
@RequiresPermission('profile.read.self')      // same gate as the S1 parent lifecycle routes
```

- Authorize **exactly like the S1 parent routes**: call the existing private
  `authorizeParentAlertAction(jwt, id)` helper — it resolves the alert's in-tenant `studentId`
  (404 if cross-tenant/unknown), runs `StudentAccessService.canAccessStudent` guardianship ABAC
  (403 if not the child's guardian), and returns `{ tenantId, userProfileId, actorRole, portal }`.
  **Reuse it verbatim — do not write a second authorization path.**
- Then call a **new service method** `AlertsService.recordMeetingIntent(args)` that writes ONE
  append-only audit row via the **existing** inline `prisma.auditLog.create` convention (the same
  one `writeAuditEntry` uses — there is no shared `AuditService`):
  - `action: 'alert.meeting_intent'`
  - `resourceType: 'alert_instance'`, `resourceId: <alertId>`
  - `actorId`, `actorRole`, `portal` from the authorize result
  - `after`: `{ studentId, alertCode, subjectId }` JSON (the intent payload; `before` left unset)
  - `hash`/`prevHash` left unset (matches every other call site)
- **Idempotency / abuse guard:** before writing, check whether a row with the same
  `(tenantId, resourceType='alert_instance', resourceId=alertId, action='alert.meeting_intent',
  actorId)` already exists. If so, **return the existing intent (no duplicate row)** — a parent
  double-clicking or revisiting must not spam the trail. Return shape:
  `{ ok: true, alreadyRequested: boolean, requestedAt: string }`.
- The endpoint **must NOT** mutate the alert's `status` (intent ≠ resolve). The alert stays
  open/acknowledged.
- This audit row is the seed the **S3** teacher/admin action-center + `MeetingRequest` model will
  consume — do not build that consumer here.

**Contract** (shared type optional): you may add a `MeetingIntentResponse` to
`packages/contracts` if you want it typed end-to-end, but a local web type is acceptable for this
thin slice (S1's parent lifecycle actions used local `ApiResult` typing, not a new contract).

## 8. The panel — frontend

- **New component** `apps/web/src/app/parent/recommendations/AlertNextSteps.tsx` (`'use client'`),
  rendered by `page.tsx` **inside each alert card**, between the recommendation box and the existing
  `<AlertActions>` group. It receives the alert + `studentId` and calls `deriveAlertActions`.
- **Reuse `@pilotage/ui` first.** Use `Button` (variants `outline`/`secondary`/`ghost`, `size="sm"`,
  `min-h-9` like `AlertActions`) and `next/link` for the `kind:'link'` steps. Do **not** invent a new
  shared primitive unless the same pattern is needed elsewhere — if you do, it goes in `packages/ui`
  (DS Guardian territory), never inline app markup masquerading as a primitive.
- **The intent step** uses a `useTransition` + server action exactly like `AlertActions` does:
  - New server action `requestMeetingIntentAction(id)` in
    `apps/web/src/app/parent/recommendations/actions.ts` (sibling to the S1 ack/resolve/dismiss
    actions), hitting `POST /api/v1/alerts/{id}/meeting-intent` via the shared `api()` client and
    returning the shared `ApiResult` shape (`apiResultFromError` on failure).
  - On success: replace the button with an inline, `aria-live="polite"` confirmation
    « Demande enregistrée — l'équipe en sera informée. » and disable re-submit. If the response says
    `alreadyRequested`, show « Demande déjà enregistrée. » instead. **Do NOT** `revalidatePath` the
    whole list (it would collapse/scroll-reset the page); local state is sufficient since the alert's
    status is unchanged. (Contrast with the S1 actions which DO revalidate because they change
    status / remove the card.)
  - On error: inline `aria-live` rose message, same pattern as `AlertActions`.
- **Panel header:** a small label « Que puis-je faire ? » with a `lucide-react` `Compass` (or
  `ListChecks`) icon. Each step shows its `label` (the action) and its `rationale` (the "why",
  smaller, muted but **contrast-compliant** — see §9).
- **Empty case:** every alert code maps to ≥1 step, so the panel always renders ≥1 step. If
  `deriveAlertActions` ever returns `[]` (defensive), render nothing (no empty panel chrome).

## 9. S2-bundled hardening (from the roadmap focus pointer — do these in THIS PR)

The roadmap says: *"Next: S2 — but first the S2-bundled route/copy/contrast hardening noted there."*
Bundle these small fixes:

- **Route correctness:** verify every deep-link target above actually exists as a parent route
  (`/parent/grades`, `/parent/subjects`, `/parent/upcoming`, `/parent/attendance`,
  `/parent/comments`) and accepts `?studentId=`. If a target route does **not** exist, **fall back
  to a route that does** (e.g. `/parent/children/{studentId}`) rather than shipping a 404 link — and
  note the substitution in the PR. (Glob shows `/parent/subjects` and `/parent/children/[id]` exist;
  confirm `/parent/grades`, `/parent/upcoming`, `/parent/attendance`, `/parent/comments` before
  relying on them.)
- **Copy:** keep all new strings FR, factual, kind, non-stigmatising. No imperatives that blame the
  child ("votre enfant échoue"); prefer supportive framing ("un travail ciblé peut aider").
- **Contrast (WCAG 2.2 AA):** the `rationale` muted text must meet **4.5:1** against its card
  background. The alert cards use `bg-sky-50` / `bg-amber-50` / `bg-rose-50`. `text-slate-500` on
  `*-50` backgrounds is borderline — use **`text-slate-600`** (or `slate-700`) for rationale text on
  these tinted cards, matching the body text already at `text-slate-700`. Action buttons inherit
  `@pilotage/ui` `Button` contrast (already AA). Target size ≥ 44px is satisfied by `min-h-9`
  (36px) — bump intent/link controls to **`min-h-11`** (44px) OR ensure ≥24px with spacing per
  WCAG 2.2 SC 2.5.8 minimum; prefer 44px for the primary intent CTA.

## 10. Acceptance criteria (testable)

1. On `/parent/recommendations`, **each** alert card renders a **"Que puis-je faire ?"** panel with
   **1–3 next-step controls** appropriate to its `code` per the §6 table, placed between the
   recommendation box and the `AlertActions` group.
2. A subject-scoped alert (`LOW_SUBJECT_AVG`/`NEGATIVE_TREND`/`REPEATED_FAILURE`) shows a
   **« Renforcer {subjectName} »** link to `/parent/grades?studentId=<id>&subjectId=<subjectId>`
   (the grades page filters on the subject UUID, not its code); when the alert has no `subjectId`,
   that link falls back to `/parent/subjects?studentId=<id>` (never a broken/ignored subject query).
3. Clicking **« En parler à l'enseignant »** POSTs `/api/v1/alerts/:id/meeting-intent`, and on
   success the control is replaced by a non-blocking, `aria-live` confirmation and disabled; the
   alert's **status is unchanged** (still in the list).
4. The intent endpoint is **guardianship-ABAC scoped**: a parent acting on **another tenant's**
   alert id gets **404**; a parent acting on a **child they do not guard** gets **403** — identical
   behavior to the S1 lifecycle routes (reuses `authorizeParentAlertAction`).
5. The intent write is **append-only & idempotent**: one `AuditLog` row with
   `action='alert.meeting_intent'`, `resourceType='alert_instance'`, `resourceId=<alertId>`,
   `after={studentId,alertCode,subjectId}`; a **second** intent by the same actor on the same alert
   creates **no duplicate row** and returns `alreadyRequested: true`.
6. `deriveAlertActions` is a **pure function** with unit coverage proving the §6 mapping for each of
   the 7 codes, the subject-null fallback, and the ≤3 cap.
7. **No schema change / no migration** is introduced (intent rides on `AuditLog`; status reuses
   `AlertInstance`). No new Prisma model.
8. **A11y/contrast:** rationale text meets 4.5:1 on the tinted alert cards (use `text-slate-600`+),
   the panel is a labelled `role="group"` (`aria-label` referencing the alert title, like
   `AlertActions`), all controls are keyboard-reachable with visible focus, and the intent CTA hits
   the 44px target.
9. **Reuse:** the panel is built from `@pilotage/ui` `Button` + `next/link`; no new shared primitive
   added unless it lands in `packages/ui`; no client-side N+1 (the helper is pure, no fetch).
10. `pnpm typecheck` passes (the Murat gate). No `git diff --check` whitespace errors.

## 11. Non-goals (explicitly out of THIS slice)

- ❌ A real `MeetingRequest` Prisma model / table (that is **S3**).
- ❌ Surfacing the intent in a teacher/admin **action center** or notifying anyone (S3 + worker).
- ❌ Any email/push notification (S4 / E5).
- ❌ Opening real messaging / E2 conversations (E2).
- ❌ Changing the alert lifecycle (ack/resolve/dismiss) behavior from S1.
- ❌ Tutoring/booking deep-links (E7).
- ❌ Editing the admin alerts surface or the cron evaluator.

## 12. Files (expected touch set — keep disjoint per the agent split)

**Frontend (`apps/web`):**
- `src/app/parent/recommendations/alert-next-steps.ts` — **new**, pure helper + types + unit test
  sibling `alert-next-steps.spec.ts` (or `.test.ts` per the repo's web test convention).
- `src/app/parent/recommendations/AlertNextSteps.tsx` — **new** client component (the panel).
- `src/app/parent/recommendations/actions.ts` — **edit**: add `requestMeetingIntentAction`.
- `src/app/parent/recommendations/page.tsx` — **edit**: render `<AlertNextSteps>` in each card,
  thread `activeStudentId`.
- `src/app/parent/recommendations/types.ts` — **edit only if** you choose to widen `AlertItem` with
  `studentId` (otherwise thread `activeStudentId` from the page and leave the type untouched).

**Backend (`apps/api`):**
- `src/modules/alerts/alerts.controller.ts` — **edit**: add `POST :id/meeting-intent` reusing
  `authorizeParentAlertAction`.
- `src/modules/alerts/alerts.service.ts` — **edit**: add `recordMeetingIntent` (idempotent
  `auditLog.create`).
- `src/modules/alerts/alerts.service.spec.ts` — **edit**: cover idempotency + payload shape (the
  targeted BE test).

**Contracts (optional):** `packages/contracts` — only if typing the response end-to-end.

## 13. Risk tier & escalation

- **Risk tier: P1** — touches an **`[auth]`/ABAC** path (parent-scoped, guardianship) and writes to
  the **append-only audit** trail. Per the agent rules this is **never silently auto-merged**: it
  triggers the escalation panel (architect + security + test-architect) and is flagged
  *needs human review*. Sentinel must confirm the endpoint reuses `authorizeParentAlertAction`
  (tenant + ABAC) and that the audit write is append-only and idempotent.
- No schema/migration ⇒ no `[schema]` tag; the `[auth]` tag is the gating one.

## 14. Pre-mortem (failure modes → extra criteria, already folded into §10)

- *"It shipped broken deep-links (404)."* → §9 route-correctness check + §10 AC2 fallback.
- *"A parent spammed the audit trail."* → §7 idempotency guard + §10 AC5.
- *"It silently leaked cross-tenant by trusting the client studentId."* → reuse
  `authorizeParentAlertAction` (resolves studentId server-side) + §10 AC4.
- *"The intent endpoint accidentally resolved the alert."* → §7 "must NOT mutate status" + §10 AC3.
- *"Rationale text failed contrast on tinted cards."* → §9 contrast fix + §10 AC8.
- *"Clicking the intent revalidated the page and scrolled the parent away."* → §8 local-state-only,
  no `revalidatePath`.
