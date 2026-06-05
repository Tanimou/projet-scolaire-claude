# E3 — Technical plan (Architect: Winston)

> How E3 is built **inside the existing conventions** (project-context §2–3). Companion to
> [`spec.md`](./spec.md), [`data-model.md`](./data-model.md), [`contracts/openapi.yaml`](./contracts/openapi.yaml).
> Hard rule: a **new architectural decision ⇒ a new `docs/adr/` ADR** (Winston gate). One candidate
> ADR is flagged in §ADR below.

## 1. Where the code lives (grounded in the current tree)

| Concern | Path | E3 touch |
|---|---|---|
| API evaluator + `RULE_FN` map | `apps/api/src/modules/alerts/alerts.service.ts` | S1, S2: register the two new evaluators |
| API rule evaluators | `apps/api/src/modules/alerts/rules/*.rule.ts` | S1, S2: add `teacher-comment-flag.rule.ts`, `improvement.rule.ts` |
| Evaluator contract | `apps/api/src/modules/alerts/rules/rule-context.ts` | reuse unchanged (`RuleContext`, `DetectedAlert`) |
| Worker evaluator + `RULE_FN` map | `apps/worker/src/modules/alerts-cron/alerts-evaluator.service.ts` | S1, S2: register byte-parity evaluators; S4: email dispatch |
| Worker rule evaluators (mirror) | `apps/worker/src/modules/alerts-rules/*.rule.ts` | S1, S2: byte-parity copies |
| Worker cron driver | `apps/worker/src/modules/alerts-cron/alerts-cron.service.ts` | unchanged (15-min `setInterval`) |
| Worker mailer (already used by digest) | `apps/worker/src/shared/mail/mailer.service.ts` + `apps/worker/src/modules/notifications-email/*` | S4: reuse for cron-path email |
| Grade model + teacher write path | `apps/api/prisma/schema.prisma` (`Grade`), `apps/api/src/modules/grades/grades.controller.ts` | S1: additive flag field + flag/unflag endpoint |
| Rule defaults + DTOs | `apps/api/src/modules/alerts/alerts.types.ts` (`RULE_CODES`, `RULE_DEFAULTS`, `UpdateAlertRuleDto`) | S2: keep `IMPROVEMENT` default; S3: per-param validation if added |
| Shared enums / types | `packages/contracts/src/enums/index.ts` (`ALERT_RULE_CODE`) | already has both codes — **no enum change needed** |
| Admin alerts UI | `apps/web/src/app/admin/alerts/*` (`page.tsx`, `AlertRuleToggle.tsx`, `types.ts`, `actions.ts`) | S3: rule-config editor; S1/S2: drop "UI seulement" badge |
| Notification email pref gate | `apps/api/.../notifications/preferences.service.ts` (`emailEnabledKeys`) | S4 reuses the same `NotificationPreference(alert, emailEnabled)` semantics |

**Key grounding facts (verified in code):**
- The `AlertRuleCode` Prisma enum **and** `packages/contracts` `ALERT_RULE_CODE` **already list all
  7 codes** including `TEACHER_COMMENT_FLAG` + `BEHAVIOR_ALERT`. `RULE_DEFAULTS` already has entries
  for both. **No enum migration is required** for E3 — only the additive S1 grade-flag field is a
  schema change.
- `RULE_FN` (api) and the worker mirror each map **5** codes; the comment explicitly marks the other
  two as "stubs — wired in subsequent iterations". E3 is those iterations.
- The worker **already has a `MailerService`** (parent-digest cron uses it) and **already reads
  `NotificationPreference(... emailEnabled:true)`** — so S4 has two viable shapes (see §ADR).
- `NEGATIVE_TREND` is the exact structural template for `IMPROVEMENT` (same single `grade.findMany`,
  same two-half split, inverted comparison + defensive clamp). Mirror it.
- There is **no disciplinary/behaviour model** anywhere in `schema.prisma` (confirmed) → wiring
  `BEHAVIOR_ALERT` is out of scope; `IMPROVEMENT` is the 7th rule.

## 2. Slice → layer matrix

| Slice | DB | API | Worker | Web | Risk tag |
|---|---|---|---|---|---|
| **S1** TEACHER_COMMENT_FLAG | additive `Grade` flag field (+1 audit action) | flag/unflag endpoint + evaluator + `RULE_FN` | byte-parity evaluator + `RULE_FN` | teacher flag toggle; drop badge | `[schema][auth]` |
| **S2** IMPROVEMENT (7th rule) | none | evaluator + `RULE_FN` | byte-parity evaluator + `RULE_FN` | drop badge; celebratory styling on recommendations | `[rules]` |
| **S3** admin rule-config UI | none | (reuse `PATCH`); optional shared param contract | none | rule-config editor over existing endpoint | `[web]` |
| **S4** email on cron path | none | (reuse pref gate / queue producer) | dispatch email reusing `notifications-email` | none (prefs UI already shipped E1-S4/E2-S4) | `[worker]` |

## 3. Cross-cutting conventions honored

- **Multi-tenant + RLS (ADR-002):** every new query carries `where: { tenantId }`; the flag field is
  on the already-tenant-scoped `Grade`; email recipients are resolved per-tenant.
- **RBAC/ABAC (ADR-015):** teacher flag write gated by grade ownership (the teacher entered/teaches
  it) — reuse the same authorization the grade revise/batch endpoints use; admin config keeps
  `alerts.write`; parent reads keep `StudentAccessService`.
- **Append-only audit:** flag/unflag writes one `AuditLog` row each (`grade.flag` / `grade.unflag`),
  using the established inline `prisma.auditLog.create` convention (no `AuditService`), `hash`/
  `prevHash` unset like every other call site.
- **Aggregate endpoints / no client N+1:** S3 reuses the existing `GET /alerts/rules` aggregate; no
  new per-row fetch. The flag toggle is a single mutation.
- **Reuse `@pilotage/ui`:** the rule-config editor is built from existing primitives (inputs,
  `StatusBadge`, dialog/sheet, `Select`) — no new shared component unless it raises consistency.
- **byte-parity evaluators:** the two new rule files are **identical** in `apps/api/.../rules/` and
  `apps/worker/.../alerts-rules/` (same convention as the live five) — a reviewer diffs the pair.

## 4. Risks & mitigations (feeds Critic / Murat)

| Risk | Mitigation |
|---|---|
| Evaluator drift between api + worker copies | byte-parity requirement is an AC; reviewer diffs the two files; targeted unit test runs the same fixture through both. |
| `IMPROVEMENT` firing as noise (every minor uptick) | same defensive clamp as `NEGATIVE_TREND` (`delta > 0`, `window ≥ 2`, partial window never fires); `severity: low`; deduped 7 days. |
| Flag alert never clearing after unflag | evaluator only reads currently-flagged grades; existing resolve/dismiss E1 lifecycle handles the open instance; dedup prevents re-spam. |
| Cron email double-send (in-app off, email on) | reuse the documented `dispatchEmails` dedup caveat; the alert is already deduped within 7 days, so the cron emails at most once per new instance. |
| Admin sets a nonsensical threshold | evaluators clamp invalid/NaN params to defaults (already true for the live rules); S3 validation gives typed inputs + ranges as a UX guard, not a security boundary. |
| Worker email path diverges from API delivery semantics | S4 **reuses** the same `notifications-email` template + job contract; see §ADR for the dispatch-shape decision. |

## 5. ADR §ADR — candidate architectural decision (Winston gate)

**Candidate ADR-020 — "Worker-side email dispatch for cron-raised alerts."**
The API path emails via `NotificationsService.dispatchEmails` → it **enqueues** `notifications-email`
BullMQ jobs that the worker's `notifications-email` processor consumes. The worker cron path has
**two ways** to email and they differ architecturally:

- **(A) Worker enqueues the same `notifications-email` jobs** (mirror the API producer): the cron,
  after creating an `AlertInstance` + in-app `Notification`, resolves opted-in guardians
  (`NotificationPreference(alert, emailEnabled)`) and **adds jobs to the existing queue**. Pro:
  identical delivery semantics, one processor, one retry/backoff policy, no direct SMTP in the
  cron pass. This is the **preferred** shape (zero new template, no new queue, byte-aligned with the
  API path) and is likely **NOT a new architectural decision** — it reuses the established producer/
  consumer pattern, so it may need **no ADR**.
- **(B) Worker sends directly via `MailerService`** (as the parent-digest cron already does):
  simpler call-graph, but it **bypasses the `notifications-email` template/retry** and creates a
  *second* alert-email code path. This **would** be a new cross-cutting pattern → **requires
  ADR-020** if chosen.

**Ruling:** prefer **(A)**; if (A) is adopted, **no ADR** is needed (reuse of an existing pattern).
Only if the implementer must choose **(B)** (e.g. the worker cannot reach the queue producer
cleanly) does **ADR-020** become mandatory. The S4 slice spec records which shape shipped. Either
way, the §6 acceptance rule stands: **no new BullMQ queue, no new email template.**

No other E3 work introduces a new HTTP style, state lib, off-convention path, or cross-cutting
pattern → no other ADR is anticipated. (The additive `Grade` flag field is a routine schema change,
not an architectural decision.)

## 6. Pre-merge steps (documented, not run by agents)

- S1 schema change: `prisma generate` + `prisma db push` (repo convention — **no SQL `migrations/`
  folder**), then the single `pnpm build` by the orchestrator.
- Murat runs `pnpm typecheck` once per slice (the only heavy local gate).
- UI screenshots only if the app is already running at `http://localhost:3100`.
