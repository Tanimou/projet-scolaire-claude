# E3-S2 — 7th rule = `IMPROVEMENT` (non-stigmatising positive signal) + dual byte-parity evaluator

> **Self-contained story spec** (John, BMAD PM). A developer implements **this slice alone** from
> this file. Parent epic: [`../spec.md`](../spec.md) · slice backlog: [`../tasks.md`](../tasks.md) ·
> data model: [`../data-model.md`](../data-model.md) · progress: [`../PROGRESS.md`](../PROGRESS.md).
> **One vertical slice, one PR, one build.** Risk tier **P2**, tags `[schema][rules]` (the schema
> change is an **additive enum value only** — no new table, no new column).

## 0. One-sentence intent
Add the **7th alert rule `IMPROVEMENT`** — a non-stigmatising, celebratory positive signal that fires
when a child *recovers* ≥ +1.5 pts /20 across 3 consecutive **published** grades in a subject — as the
**inverted mirror of `NEGATIVE_TREND`**, byte-parity across api + worker, taking the engine from
**6/7 → 7/7 rules live** and turning the parent's alert bell into **both a warning and an
encouragement channel** (the cahier's *"which subjects are improving?"*).

`touchesUi: true` · `touchesBackend: true` · `touchesWorker: true`

---

## 1. Scope — exactly what ships in this PR

A thin DB(enum) → API → worker → UI slice:

1. **DB (additive enum value, `prisma db push`, no SQL migration):** add `IMPROVEMENT` to the
   `AlertRuleCode` Prisma enum. No new table, no new column, no data migration. (`BEHAVIOR_ALERT`
   stays in the enum, **reserved-but-unwired** — do not touch it.)
2. **Contracts / enums:** add `IMPROVEMENT` to `ALERT_RULE_CODE` (contracts) + `RULE_CODES` and a
   `RULE_DEFAULTS.IMPROVEMENT` entry (`{ delta: 1.5, windowAssessments: 3 }`, `severity: 'low'`).
3. **API:** new `evaluateImprovement` evaluator (inverted mirror of `negative-trend.rule.ts`, same
   defensive clamp, celebratory + never-comparative copy) registered in `AlertsService.RULE_FN`.
4. **Worker:** **byte-parity** copy `improvement.rule.ts` registered in the worker `RULE_FN`.
5. **UI:** drop the "UI seulement" badge for `IMPROVEMENT` on `/admin/alerts`; green/encouraging
   styling for `low`-severity / improvement alerts on the parent **recommendations** surface
   (distinct from the existing warning tones). Add `IMPROVEMENT` to the FE alert-code unions/maps so
   it renders correctly everywhere it is referenced.

**Out of scope (do NOT do):** any new BullMQ queue · any new email template · event-driven re-eval ·
wiring `BEHAVIOR_ALERT` · a `@pilotage/alerts-core` extraction · reworking the 5 live rules or the
7-day dedup · the admin rule-config editor (that is S3) · email on the cron path (that is S4).

---

## 2. Why (cahier ties)
- The cahier requires **7 explainable alert rules**; the engine reserves all codes but only 6 evaluate
  after S1. This slice makes it **7/7**.
- The cahier's dashboard must answer *"which subjects are improving?"* — today nothing surfaces a
  **positive** signal. `IMPROVEMENT` is that answer, delivered through the existing alert pipeline.
- **Non-stigmatising, kind tone** is non-negotiable (children's data). `IMPROVEMENT` reads the **same
  published grades** the other rules read — **no new disciplinary/behavioural data** is collected
  (RGPD minimal-data) — and its copy is celebratory and **never comparative** (no other child named).

---

## 3. The rule — precise behaviour (the inverted mirror of `NEGATIVE_TREND`)

Reference implementation to mirror: `apps/api/src/modules/alerts/rules/negative-trend.rule.ts`
(identical to its worker twin `apps/worker/src/modules/alerts-rules/negative-trend.rule.ts`).
`evaluateImprovement` is that file with the **comparison inverted** and the **copy/context renamed**.
Everything else — the single `grade.findMany` shape, the `(student, subject)` grouping, the
chronological `orderBy`, the `/20` normalisation, the two-half split, the partial-window guard,
the defensive parameter clamp — is **identical**.

**Parameters (from `rule.parameters`, defensively clamped exactly as `NEGATIVE_TREND`):**
- `delta` — `Number(params.delta ?? 1.5)`; keep iff `Number.isFinite && > 0`, else fall back to `1.5`.
  (A 0/negative delta would fire on a flat or falling series — clamp protects the "real upward move"
  guarantee.)
- `windowAssessments` — `Number(params.windowAssessments ?? 3)`; keep `Math.floor` iff
  `Number.isFinite && >= 2`, else `3`. (Window of 1 can't form two non-empty halves.)
- `if (!ctx.academicYearId) return [];` — unchanged guard.

**Query — byte-identical to `NEGATIVE_TREND`:** same `grade.findMany` with
`where: { tenantId: ctx.tenantId, status: 'published', isAbsent: false, value: { not: null }, assessment: { teachingAssignment: { academicYearId: ctx.academicYearId, ...(ctx.schoolId ? school filter : {}) } } }`,
same `include`, same `orderBy: [{ assessment: { scheduledAt: 'asc' } }, { createdAt: 'asc' }]`,
same `take: 100_000`. `tenantId` stays at the **top level** of the `where` (the evaluator runs on a
plain prisma client with no RLS session — esp. in the worker). **Do not** add a second query.

**Grouping + halves — identical:** group by `${studentId}|${subjectId}`, preserve order, normalise
each grade to `/20` (`(value / maxScore) * 20`, skip `maxScore === 0`), take the last
`windowAssessments` (`tail`); `if (tail.length < windowAssessments) continue;` (partial window never
fires). Split symmetrically: `half = Math.floor(tail.length / 2)`,
`firstHalf = tail.slice(0, half)`, `lastHalf = tail.slice(tail.length - half)`.

**The ONE inverted line (this is the whole behavioural difference):**
```
const gain = lastHalfAvg - firstHalfAvg;          // was: const drop = firstHalfAvg - lastHalfAvg;
if (gain < delta) continue;                        // fire ONLY on a real upward move
```
A flat or **falling** series produces nothing; a genuine rise of ≥ `delta` fires.

**Emitted `DetectedAlert` (celebratory, explainable, never comparative):**
```ts
out.push({
  studentId,
  subjectId: first.subjectId,
  classSectionId: first.classSectionId,
  title: `Progrès en ${first.subjectName} 🎉`,
  body: `Progression de +${gain.toFixed(1)} pts /20 sur les ${windowAssessments} dernières évaluations en ${first.subjectName} (de ${firstHalfAvg.toFixed(1)} à ${lastHalfAvg.toFixed(1)} /20).`,
  recommendation:
    "Félicitez votre enfant et encouragez-le·la à maintenir l'effort dans cette matière.",
  context: {
    subjectCode: first.subjectCode,
    delta,
    windowAssessments,
    firstHalfAvg: Number(firstHalfAvg.toFixed(2)),
    lastHalfAvg: Number(lastHalfAvg.toFixed(2)),
    gain: Number(gain.toFixed(2)),
    windowValues: tail.map((e) => Number(e.value20.toFixed(2))),
  },
});
```
Keep the file's header doc-comment, adapted (rename "downward"→"upward", "Baisse"→"Progression").
The deep-link to the subject view is supplied by the existing parent `deriveAlertActions`
`reinforce-subject` step keyed on `subjectId`/`subjectCode` — **no FE deep-link wiring is needed in
this slice** beyond ensuring `IMPROVEMENT` flows through the recommendations page (see §5).

---

## 4. Backend wiring (api + worker) — file-by-file

**`apps/api/prisma/schema.prisma`** — add one enum value (after `BEHAVIOR_ALERT`, alphabetical/append
is fine — order is cosmetic):
```prisma
enum AlertRuleCode {
  LOW_SUBJECT_AVG
  NEGATIVE_TREND
  REPEATED_FAILURE
  MISSING_ASSESSMENT
  HIGH_ABSENCE
  TEACHER_COMMENT_FLAG
  BEHAVIOR_ALERT
  IMPROVEMENT          // E3-S2 — non-stigmatising positive signal (mirror of NEGATIVE_TREND)
}
```
Then `pnpm --filter @pilotage/api prisma generate` + `prisma db push` (the documented pre-merge step;
**agents do not run it** — it is part of the orchestrator's land step). Additive enum value = no data
migration.

**`packages/contracts/src/enums/index.ts`** — append `'IMPROVEMENT'` to the `ALERT_RULE_CODE` tuple
(after `'BEHAVIOR_ALERT'`). This is the shared source; `AlertRuleCode` type comes from `@prisma/client`
so the enum and the tuple must agree.

**`apps/api/src/modules/alerts/alerts.types.ts`** —
- append `'IMPROVEMENT'` to `RULE_CODES`;
- add `RULE_DEFAULTS.IMPROVEMENT`:
```ts
IMPROVEMENT: {
  label: 'Progrès remarquable',
  description: 'Progression de >= 1.5 pts sur 3 évaluations consécutives (signal positif)',
  severity: 'low',
  parameters: { delta: 1.5, windowAssessments: 3 },
},
```
`RULE_DEFAULTS` is typed `Record<AlertRuleCode, …>`, so the new enum value **forces** this entry — TS
will fail to compile without it (good).

**`apps/api/src/modules/alerts/rules/improvement.rule.ts`** (NEW) — `evaluateImprovement` per §3.

**`apps/api/src/modules/alerts/alerts.service.ts`** — `import { evaluateImprovement } from './rules/improvement.rule';`
and add `IMPROVEMENT: evaluateImprovement,` to `RULE_FN`.

**`apps/worker/src/modules/alerts-rules/improvement.rule.ts`** (NEW) — **byte-parity** copy (the
reviewer diffs the api/worker pair: the two files must be byte-identical, same as the existing
`negative-trend.rule.ts` twins).

**`apps/worker/src/modules/alerts-cron/alerts-evaluator.service.ts`** —
`import { evaluateImprovement } from '../alerts-rules/improvement.rule';` and add
`IMPROVEMENT: evaluateImprovement,` to the worker `RULE_FN`.

> **Persistence/dedup/fan-out — reuse unchanged.** `AlertInstance` persistence, the **7-day
> `(rule, student, subjectId)` dedup window**, and `NotificationsService.createMany` in-app fan-out
> are shared and require **no change**. The `IMPROVEMENT` alert dedups per (student, subject) per 7
> days like every sibling. The rule only **enabled when the admin enables it** (rules materialise
> `enabled=false`; this slice does not auto-enable it).

---

## 5. Frontend — file-by-file

The FE has several `Record<AlertRuleCode, …>` / `Record<AlertCode, …>` maps and `AlertCode` unions
that must learn the new code or **TS will fail to compile**. Add `IMPROVEMENT` everywhere the existing
6 codes appear:

**`apps/web/src/app/admin/alerts/actions.ts`** — add `| 'IMPROVEMENT'` to the `AlertRuleCode` union.

**`apps/web/src/app/admin/alerts/types.ts`** — add `IMPROVEMENT: 'Progrès remarquable'` to `RULE_LABEL`.

**`apps/web/src/app/admin/alerts/page.tsx`** —
- add `IMPROVEMENT: Sparkles` (or `TrendingUp` from lucide — import it) to `RULE_ICON`;
- add `IMPROVEMENT: true` to `RULE_IMPLEMENTED` (this **removes the "UI seulement" badge** for the
  7th rule — the badge renders iff `!RULE_IMPLEMENTED[rule.code]`).

**`apps/web/src/app/parent/recommendations/types.ts`** — add `'IMPROVEMENT'` to the `AlertCode`
union/tuple (mirror wherever `BEHAVIOR_ALERT` appears).

**`apps/web/src/app/parent/recommendations/page.tsx`** —
- add `'IMPROVEMENT'` to `VALID_CODES`;
- add `IMPROVEMENT: 'Progrès'` (or 'Progrès remarquable') to `CODE_LABEL`;
- add `IMPROVEMENT: TrendingUp` (import from lucide-react) to `CODE_ICON`;
- **Green / encouraging styling for the positive signal.** Today severity drives the card tone
  (`SEVERITY_CARD_CLS`/`SEVERITY_ICON_CLS`), and `IMPROVEMENT` is `severity: low` → currently `sky`.
  Make improvement alerts visually **celebratory (emerald/green)**, distinct from the neutral `low`
  (sky) warnings. **Code-aware override, not a severity remap** (so other `low` alerts stay sky):
  when `a.code === 'IMPROVEMENT'`, apply emerald classes for the card ring/bg and the icon chip, e.g.
  `bg-emerald-50 ring-emerald-200` for the card and `bg-emerald-100 text-emerald-700` for the icon,
  and render the `CODE_LABEL` chip in an encouraging green tone. Keep the existing
  `Lightbulb`-recommendation block but it now reads as a "celebrate" cue (the copy already says
  *"Félicitez votre enfant…"*). Do **not** change the severity-grouping headers (the alert still sorts
  under "Sévérité faible") — only the per-card accent and icon turn green for `IMPROVEMENT`.

> **Reuse-first / a11y:** use `@pilotage/ui` primitives already on the page (`SubjectChip`,
> `StatusBadge`, `KpiCard`). Green must keep WCAG 2.2 AA contrast (emerald-700/800 text on
> emerald-50 — the same contrast discipline the rose/amber tones already use). The emoji 🎉 in the
> title is decorative; it must not be the only signal — the green accent + "Progrès" label carry the
> meaning for screen readers. Mobile-first: the card layout is unchanged, only colors differ.

No new endpoint, no new component file is required on the FE (extend the existing recommendations
page + its maps). The parent alert read-path (`GET /api/v1/alerts/parent/:studentId`) already returns
any `AlertInstance` regardless of code, so `IMPROVEMENT` instances surface automatically once the rule
is enabled and a pass runs.

---

## 6. Acceptance criteria (this slice)

1. **7/7 rules evaluate.** Both `RULE_FN` maps (api `alerts.service.ts` + worker
   `alerts-evaluator.service.ts`) map **`IMPROVEMENT` → `evaluateImprovement`**; no `AlertRuleCode`
   value is left unmapped except the deliberately-reserved `BEHAVIOR_ALERT`. *(spec AC1 — complete)*
2. **Byte-parity evaluators.** `apps/api/.../rules/improvement.rule.ts` and
   `apps/worker/.../alerts-rules/improvement.rule.ts` are **byte-identical** (reviewer diffs the pair).
3. **Fires only on a genuine upward trend.** A series whose `lastHalfAvg − firstHalfAvg ≥ delta` fires
   exactly one alert per (student, subject); a **flat** series fires nothing; a **falling** series
   fires nothing (and must NOT raise `IMPROVEMENT` — it is the `NEGATIVE_TREND`'s job, untouched); a
   **partial window** (fewer than `windowAssessments` published grades) fires nothing. *(spec AC3)*
4. **Defensive clamp.** `delta ≤ 0` / non-finite → fallback `1.5`; `windowAssessments < 2` /
   non-finite → fallback `3` — identical to `NEGATIVE_TREND`, so a misconfigured rule can never fire on
   a non-rising series. *(spec AC3)*
5. **`severity: low`, celebratory, non-comparative copy.** Default severity is `low`; title/body/
   recommendation are encouraging ("Progrès…", "Félicitez votre enfant…"), state **rule + subject +
   threshold (delta) + the actual point gain**, and **never name another child or compare to peers**.
   *(spec AC3, AC6)*
6. **RGPD minimal-data.** No new table, no new column, no new disciplinary/behavioural data — the rule
   reads the same published grades the live rules read. Only an **additive enum value** ships. *(spec
   §6, AC3)*
7. **Dedup unchanged.** The shared 7-day `(rule, student, subjectId)` window dedups `IMPROVEMENT` like
   every sibling; no change to dedup logic. *(spec AC7)*
8. **Tenant isolation.** `tenantId` stays at the top level of the `grade.where`; an evaluation pass for
   tenant A never reads tenant B's grades. *(spec AC7)*
9. **Admin UI.** On `/admin/alerts` → Règles, the `IMPROVEMENT` card shows a label + `low` severity
   badge + the `delta`/`windowAssessments` params and **no "UI seulement" badge** (it is implemented).
   *(spec AC8)*
10. **Parent UI.** When an `IMPROVEMENT` alert exists for the selected child, the recommendations page
    renders it with **green/encouraging styling** distinct from warning tones, the "Progrès" label, a
    `TrendingUp`/celebratory icon, the subject chip, and the "Félicitez…" recommendation. *(spec AC8)*
11. **Gates.** `pnpm typecheck` passes (Murat) — the new enum value forces the `RULE_DEFAULTS` entry
    and every FE `Record<AlertCode, …>` map to be exhaustive; `git diff --check` clean; `prisma
    generate` + `db push` is the documented pre-merge step for the enum. *(spec AC9)*

---

## 7. Pre-mortem → extra acceptance criteria (plan hardening)

- **"It fired on a falling series."** → Guard against a copy-paste that keeps `firstHalfAvg − lastHalfAvg`.
  AC3 explicitly requires a **falling-series fixture → no `IMPROVEMENT`**. The inverted line is the
  single behavioural diff; the reviewer must confirm `gain = lastHalfAvg - firstHalfAvg` and
  `if (gain < delta) continue;`.
- **"The two evaluator copies drifted."** → byte-parity is AC2; ship them identical in the same PR.
- **"TS compile broke because a `Record<AlertCode,…>` map missed the new code."** → §5 lists every map;
  the exhaustiveness is enforced by TS. Search the web app for the 6 existing codes and add the 7th to
  **each** occurrence (admin actions/types/page, parent types/page; check `RecommendationsFilters` if it
  enumerates codes).
- **"A `low`-severity warning turned green too."** → The green is a **code-aware** override on
  `IMPROVEMENT`, not a severity remap; other `low` alerts (e.g. a low-threshold `LOW_SUBJECT_AVG`) keep
  sky. AC10 requires the distinction.
- **"Emoji-only signal fails a11y."** → AC10 + §5 a11y note: green accent + "Progrès" label carry
  meaning; 🎉 is decorative.

---

## 8. Test plan (Murat, P2 — the single most valuable targeted test)
A **shared fixture run through both evaluators** (api + worker) asserting identical `DetectedAlert[]`:
- rising series (`+2 pts` over 3 grades, default params) → exactly one alert, `title` contains the
  subject, `context.gain >= delta`, `severity` resolves to `low`;
- flat series → `[]`; falling series → `[]`; 2-grade (partial) window → `[]`;
- `delta: 0` param → clamps to `1.5` → does not fire on a flat series;
- tenant-B grades absent from a tenant-A pass.
Mirror the structure of `apps/api/src/modules/alerts/rules/low-subject-avg.rule.spec.ts` /
`high-absence.rule.spec.ts`. (Do not add a worker-side spec if the byte-parity diff + the api spec
cover it — keep the slice thin; the reviewer's pair-diff is the worker guarantee.)

---

## 9. Land checklist
- [ ] `IMPROVEMENT` added to: Prisma enum · contracts `ALERT_RULE_CODE` · `RULE_CODES` ·
  `RULE_DEFAULTS` (`{delta:1.5, windowAssessments:3}`, `severity:'low'`).
- [ ] `evaluateImprovement` shipped in **both** rule dirs, **byte-identical**, registered in **both**
  `RULE_FN`.
- [ ] "UI seulement" badge gone for `IMPROVEMENT` on `/admin/alerts`; green styling on the parent
  recommendations card.
- [ ] All FE `AlertCode`/`AlertRuleCode` maps exhaustive (TS green).
- [ ] `BEHAVIOR_ALERT` untouched (still reserved-but-unwired).
- [ ] No new queue / template / event trigger / behaviour change to the 5 live rules or dedup.
- [ ] On Land: tick `tasks.md` S2, update `PROGRESS.md` (engine **7/7**), update the roadmap E3 entry.
