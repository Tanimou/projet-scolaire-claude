# E3-S3 — Admin rule-config UI (threshold / severity / period / notify) · story spec

> **Self-contained story** (John, BMAD PM). A developer implements THIS slice from this file
> alone. Epic: **E3 — Complete the Alert Engine**. Predecessors **S1** (`TEACHER_COMMENT_FLAG`)
> and **S2** (`IMPROVEMENT`) are **shipped — engine is 7/7 wired**. This slice is **frontend-only
> over an existing API** (plus an OPTIONAL shared validation schema in `packages/contracts`).
>
> `touchesUi: true` · `touchesBackend: false` · `touchesWorker: false`
> Portal: **admin** · Risk tier: **P2** · Tags: `[web]`

---

## 1. Capability (what an admin can now *do*)

On `/admin/alerts` → **Règles** tab, each rule card gains a **« Configurer »** button. Clicking it
opens a slide-in editor (`FormDrawer` from `@pilotage/ui`) that lets a school-admin edit, **per
school**, for that single rule:

- **enabled** (on/off),
- **severity** (`low` / `medium` / `high`),
- the rule's **typed threshold / period parameters** (different fields per rule code).

Saving persists through the **EXISTING** `PATCH /api/v1/alerts/rules/:code` endpoint (no new
endpoint, no schema change, no migration). The next evaluation pass (15-min cron or the existing
"Évaluer maintenant" button) uses the new values immediately — the evaluators already read
`rule.parameters` defensively and clamp server-side.

This completes the cahier's **admin-configurable thresholds** requirement (R6) — today the admin
can only *toggle* a rule (`AlertRuleToggle`), not tune what counts as "low", "too many absences",
etc.

---

## 2. The existing API contract (do NOT change it — consume it)

### `GET /api/v1/alerts/rules` (perm `alerts.read`) — already wired in `page.tsx`
Returns `{ data: AlertRule[] }` where each rule is
(`apps/web/src/app/admin/alerts/types.ts` → `AlertRule`):

```ts
{ id: string | null; code: AlertRuleCode; label: string; description: string;
  enabled: boolean; severity: 'low'|'medium'|'high';
  parameters: Record<string, unknown>; openInstances: number }
```

### `PATCH /api/v1/alerts/rules/:code` (perm `alerts.write`) — the persistence target
Server DTO is `UpdateAlertRuleDto` (`apps/api/src/modules/alerts/alerts.types.ts`):

```ts
class UpdateAlertRuleDto {
  enabled?: boolean;
  severity?: 'low' | 'medium' | 'high';     // @IsEnum(['low','medium','high'])
  parameters?: Record<string, unknown>;     // @IsObject() — replaces the whole JSONB blob
}
```

`:code` is validated by `ParseEnumPipe(RULE_CODES)` → an unknown code returns **400**. The body
fields are all optional and **partial-merged** server-side: `enabled`/`severity` are set only when
present; `parameters` (when present) **replaces** the entire `parameters` JSONB. The service
(`AlertsService.updateRule`) returns the updated `AlertRuleDto`. The rule row is auto-seeded
per-tenant/school by `ensureRules` before update, so a `null`-id rule (never persisted) still
PATCHes cleanly. **Authorization** = `alerts.write` (school-admin / super-admin only) — a
parent/teacher token gets **403** on the write. Send `parameters` as the **full** object for that
rule (merge client-side from current values; the endpoint overwrites the blob, it does not
deep-merge keys).

> **Important:** because `parameters` is replace-not-merge, the editor MUST submit the complete
> parameter object for the rule (all the rule's keys), not just the changed key — otherwise unsent
> keys are dropped from the JSONB.

---

## 3. Per-rule parameter shapes (the typed fields per code)

Source of truth = `RULE_DEFAULTS` in `apps/api/src/modules/alerts/alerts.types.ts` (mirror it; do
NOT re-derive). The 7 wired rules and their editable params:

| Code | Severity default | Parameters (key: default) | Field label (FR) | Field kind / range |
|---|---|---|---|---|
| `LOW_SUBJECT_AVG` | high | `threshold: 10` | Seuil de moyenne (/20) | number 0–20, step 0.5 |
| `NEGATIVE_TREND` | medium | `delta: 1.5`, `windowAssessments: 3` | Baisse min. (pts), Nb. évaluations | number 0.5–20 step 0.5 · integer 2–10 |
| `REPEATED_FAILURE` | high | `threshold: 10`, `consecutive: 3` | Seuil d'échec (/20), Échecs consécutifs | number 0–20 step 0.5 · integer 2–10 |
| `MISSING_ASSESSMENT` | medium | `count: 1`, `windowDays: 30` | Nb. évaluations manquées, Fenêtre (jours) | integer 1–20 · integer 1–365 |
| `HIGH_ABSENCE` | medium | `count: 5`, `windowDays: 30` | Nb. d'absences, Fenêtre (jours) | integer 1–60 · integer 1–365 |
| `TEACHER_COMMENT_FLAG` | medium | `{}` (no params) | — | only enabled + severity editable |
| `IMPROVEMENT` | low | `delta: 1.5`, `windowAssessments: 3` | Hausse min. (pts), Nb. évaluations | number 0.5–20 step 0.5 · integer 2–10 |

`BEHAVIOR_ALERT` is **reserved-but-unwired** (spec §6 non-goal). It already shows the "UI seulement"
badge today (`RULE_IMPLEMENTED` in `page.tsx` omits it). For `BEHAVIOR_ALERT` the editor MAY be
disabled or simply not offered — it is **not** part of "the now-7 implemented rules"; do not remove
its badge. For a rule whose live `parameters` object has keys not in this table, render those keys
read-only (defensive) rather than dropping them on save.

---

## 4. OPTIONAL — shared per-rule validation schema in `packages/contracts`

Add a **UX-guard** schema (not a security boundary — the server already clamps). If added it lives
at `packages/contracts/src/dto/alert-rule-params.ts`, is exported from `src/dto/index.ts`, and is
**imported by the web app only** (FE-side). Suggested shape (Zod, per the `ALERT_RULE_CODE` enum):

```ts
// packages/contracts/src/dto/alert-rule-params.ts
import { z } from 'zod';
export const AlertRuleParamSchemas = {
  LOW_SUBJECT_AVG:    z.object({ threshold: z.number().min(0).max(20) }),
  NEGATIVE_TREND:     z.object({ delta: z.number().min(0.5).max(20), windowAssessments: z.number().int().min(2).max(10) }),
  REPEATED_FAILURE:   z.object({ threshold: z.number().min(0).max(20), consecutive: z.number().int().min(2).max(10) }),
  MISSING_ASSESSMENT: z.object({ count: z.number().int().min(1).max(20), windowDays: z.number().int().min(1).max(365) }),
  HIGH_ABSENCE:       z.object({ count: z.number().int().min(1).max(60), windowDays: z.number().int().min(1).max(365) }),
  TEACHER_COMMENT_FLAG: z.object({}),
  IMPROVEMENT:        z.object({ delta: z.number().min(0.5).max(20), windowAssessments: z.number().int().min(2).max(10) }),
} as const;
```

`packages/contracts` is **built to CJS** (`dist/`, `main → dist/index.js`); a new file must be
re-exported through `src/dto/index.ts` → `src/index.ts`. If you prefer to keep the slice to a
single workspace, an equivalent FE-local table in `apps/web/src/app/admin/alerts/` is acceptable —
**either is fine**, but if you touch `packages/contracts` you must rebuild it (the orchestrator runs
the single `pnpm build`, not you). **Recommendation: keep it FE-local** to stay single-workspace
(web only) and avoid a contracts rebuild, unless the reviewer prefers the shared schema; document
the choice in this story on land.

---

## 5. Implementation plan (files — all under `apps/web/src/app/admin/alerts/`)

1. **`actions.ts`** — add a server action:
   ```ts
   export async function updateRuleConfigAction(
     code: AlertRuleCode,
     patch: { enabled?: boolean; severity?: 'low'|'medium'|'high'; parameters?: Record<string, unknown> },
   ): Promise<ActionResult> {
     const res = await callApi(`/api/v1/alerts/rules/${code}`, 'PATCH', patch);
     if (res.ok) revalidatePath('/admin/alerts');
     return res;
   }
   ```
   Reuse the existing `callApi` helper + `ActionResult` + `AlertRuleCode` union already in this
   file. (Keep `toggleRuleAction` as-is, or have the toggle delegate to the new action — optional.)

2. **`RuleConfigEditor.tsx`** (NEW `'use client'`) — the per-rule editor:
   - Props: the full `AlertRule` (current `enabled`, `severity`, `parameters`).
   - A trigger **« Configurer »** button (gear/`Settings2` lucide icon) rendered on the rule card.
   - Opens `FormDrawer` from `@pilotage/ui` (`open`, `onClose`, `title`, `onSubmit`, `busy`,
     `disabledSubmit`, `submitLabel="Enregistrer"`).
   - Body: an **enabled** switch (reuse the visual pattern of `AlertRuleToggle`), a **severity**
     `<select>` (`SEVERITY_LABEL` for option text from `types.ts`), and **number `Input`s**
     (`@pilotage/ui` `Input`, `type="number"`, `min`/`max`/`step` per §3) for the rule's params,
     keyed off the rule `code`. Use a `Record<AlertRuleCode, ParamFieldSpec[]>` map for the field
     definitions so the body renders generically.
   - **Client-side validation (UX guard):** clamp/validate against §3 ranges (or the §4 schema).
     Out-of-range or empty → disable Save + show an inline field hint. This is UX only.
   - **On submit:** build the **complete** `parameters` object for that rule (all its keys), call
     `updateRuleConfigAction(code, { enabled, severity, parameters })` inside `useTransition`.
     - **Optimistic-or-revalidate:** on `res.ok` → close the drawer; the action's
       `revalidatePath('/admin/alerts')` re-fetches `GET /alerts/rules` so the card's parameter
       line + severity badge + toggle reflect the new values (revalidate path is sufficient — no
       manual optimistic state needed beyond the in-drawer form state).
     - **On `!res.ok`:** keep the drawer open, surface `res.error` as an **error message**. The
       codebase has **no toast system today** (verified: no `sonner`/`useToast`); the established
       pattern is an **inline error** (`text-rose-600`, see `AlertInstanceActions`/`AlertRuleToggle`).
       Render an accessible inline alert (`role="alert"`, `aria-live="assertive"`) inside the drawer
       footer area. (A real toast is acceptable only if you also add the toast primitive to
       `@pilotage/ui` — out of scope for this slice; **prefer the inline alert**.)

3. **`page.tsx`** — render `<RuleConfigEditor rule={rule} />` on each rule card (in the
   `rules.map(...)` block, near the existing `<AlertRuleToggle>`), passing the full `rule`. Keep the
   existing toggle OR let the editor own enable/disable — if both remain, ensure they don't fight
   (the editor revalidates, the toggle is optimistic; simplest is to keep the toggle for quick
   on/off and add the editor for full config). The `formatParameters(rule.parameters)` line and the
   "UI seulement" badge logic stay as-is.

4. **(OPTIONAL) `packages/contracts/src/dto/alert-rule-params.ts`** + re-export — only if you choose
   the shared-schema route (§4).

**Do NOT touch:** `apps/api/**`, `apps/worker/**`, `schema.prisma`, any evaluator. This slice is
FE-only (plus the optional contracts file).

---

## 6. Acceptance criteria (this slice)

1. **Editor opens per rule.** Each of the 7 wired rule cards on `/admin/alerts` → Règles shows a
   **« Configurer »** affordance that opens a `FormDrawer` (`@pilotage/ui`) titled with the rule
   label, pre-filled with the rule's current `enabled`, `severity`, and `parameters`.
2. **Typed params per code.** The drawer renders the correct numeric fields for the rule code per
   §3 (e.g. only `threshold` for `LOW_SUBJECT_AVG`; `delta` + `windowAssessments` for
   `NEGATIVE_TREND`/`IMPROVEMENT`; `count` + `windowDays` for `HIGH_ABSENCE`/`MISSING_ASSESSMENT`;
   `threshold` + `consecutive` for `REPEATED_FAILURE`; no param fields for `TEACHER_COMMENT_FLAG`).
3. **Round-trips through the existing PATCH.** Saving sends the FULL parameter object (+ optional
   `enabled`/`severity`) to `PATCH /api/v1/alerts/rules/:code`; after `revalidatePath`, the card
   reflects the new values; reloading the page shows them persisted. **No new endpoint, no schema,
   no migration.**
4. **Severity + enabled persist** independently and round-trip.
5. **Client-side validation guard.** Empty / out-of-range numeric input disables Save and shows an
   inline hint (UX only — the server still clamps; this is not a security boundary).
6. **Admin-only.** A parent/teacher token hitting the write gets **403** (unchanged server behavior;
   the editor is only reachable from the admin portal). The action surfaces the 403 message inline
   without crashing.
7. **Error path.** On a failed PATCH the drawer stays open and shows an accessible inline error
   (`role="alert"`); no silent failure, no broken optimistic state.
8. **Mobile-first WCAG 2.2 AA.** Drawer usable at 390×844; all inputs have associated `<label>`s;
   focus is trapped in the drawer and returns to the trigger on close (FormDrawer/Drawer provides
   this — verify); interactive targets ≥ 24×24 CSS px; the « Configurer » button and switch have
   discernible accessible names; color is not the only signal for severity/validation.
9. **Reuse-first / no ADR.** `@pilotage/ui` (`FormDrawer`, `Input`, `Button`), existing `actions.ts`
   `callApi`, existing `types.ts` maps; no new architectural decision (no new endpoint, no new
   state lib, no new HTTP style) → **no `docs/adr/`** entry needed.
10. **Gates.** `pnpm typecheck` green (Murat); `git diff --check` clean; if `packages/contracts` is
    touched it is re-exported correctly (orchestrator builds it once). No unrelated churn.

---

## 7. Test ideas (Murat — pick the single most valuable)

- **Param round-trip:** edit `LOW_SUBJECT_AVG.threshold` 10 → 12, save, assert the PATCH body
  carries `parameters: { threshold: 12 }` (full object) and the card re-renders `threshold: 12`.
- **Replace-not-merge guard:** for a 2-param rule (`HIGH_ABSENCE`), changing only `count` still
  sends both `count` + `windowDays` (no dropped key).
- **Severity persists** across reload.
- **Validation:** out-of-range (`threshold: 25`) disables Save client-side.
- **Admin-only:** parent/teacher token → 403 on `PATCH /alerts/rules/:code` (server-side, unchanged)
  and the editor renders the error inline.

---

## 8. Non-goals (this slice)

- ❌ New endpoint / schema / migration (the PATCH already exists).
- ❌ Wiring `BEHAVIOR_ALERT` (stays reserved-but-unwired; its "UI seulement" badge stays).
- ❌ A toast/notification primitive in `@pilotage/ui` (use the existing inline-error pattern).
- ❌ Server-side validation changes (evaluators already clamp; the contracts schema, if added, is a
  FE UX guard only).
- ❌ Touching `apps/api` / `apps/worker` / evaluators / the 15-min cron.
- ❌ S4 (cron-path email) — separate slice.
