// =============================================================================
// Daily-Improvement v2 — one BMAD sprint, as a Claude Workflow
// -----------------------------------------------------------------------------
// Invoked by the `daily-improvement-v2` routine AFTER it has created a fresh
// worktree off origin/main. Drives the BMAD phases with up to 5–6 agents in
// parallel, edits code IN THE WORKTREE, and returns a structured result. The
// routine then does git commit/push/PR — this workflow NEVER builds, NEVER
// pushes.
//
//   Workflow({ scriptPath: "bmad/workflows/sprint.workflow.js",
//              args: { worktree: "<abs path>", hint: "<optional sprint hint>" } })
//
// RESOURCE BUDGET (do not compromise CPU/RAM/disk):
//   • Concurrency is capped at ≤ 6 agents (the runtime also caps at cpu-2).
//   • Only ONE agent (Murat) ever runs `pnpm typecheck` — the single heavy local
//     command. Every other agent is read/review/light-edit. No builds, ever.
//   • Implement agents work on DISJOINT file sets (web vs api/worker vs ui) so
//     they never edit the same file and there is one checkout, not many.
//
// Guardrail: every agent reads bmad/project-context.md + bmad/agents.md first.
// =============================================================================

export const meta = {
  name: 'daily-improvement-v2-sprint',
  description: 'Run one BMAD sprint (intake → plan+harden → implement → verify → land) with up to 6 parallel agents; PR-only, no builds',
  phases: [
    { title: 'Intake' },
    { title: 'Plan' },
    { title: 'Implement' },
    { title: 'Verify' },
    { title: 'Escalate' },
    { title: 'Land' },
  ],
}

const WT = (args && args.worktree) || 'C:/Users/HP/Downloads/pilotage-scolaire-claude'
const HINT = (args && args.hint) || ''
const GUARD = `ALWAYS read ${WT}/bmad/project-context.md and ${WT}/bmad/agents.md FIRST and obey them as hard constraints. Work ONLY inside ${WT}. NEVER run any build/rebuild (pnpm build, next build, docker build/compose build, infra/pilotage.sh update|rebuild|reset). Do NOT run 'pnpm typecheck' (only the test-architect agent runs it, to protect CPU/RAM). NEVER touch unrelated areas or remove working features.`

const SPEC_SCHEMA = {
  type: 'object',
  required: ['title', 'portal', 'acceptanceCriteria', 'files', 'readiness'],
  properties: {
    title: { type: 'string' },
    portal: { type: 'string', description: 'admin | teacher | parent | platform' },
    intent: { type: 'string', description: 'one compressed, contradiction-free sentence' },
    functionalRequirements: { type: 'array', items: { type: 'string' } },
    acceptanceCriteria: { type: 'array', items: { type: 'string' } },
    files: { type: 'array', items: { type: 'string' } },
    contract: { type: 'string', description: 'shared packages/contracts types, if any' },
    touchesUi: { type: 'boolean' },
    touchesBackend: { type: 'boolean' },
    riskTier: { type: 'string', description: 'P0 | P1 | P2 | P3' },
    tags: { type: 'array', items: { type: 'string' } },
    readiness: { type: 'string', description: 'PASS | CONCERNS | FAIL' },
  },
}

const FINDINGS_SCHEMA = {
  type: 'object',
  required: ['confirmed'],
  properties: {
    confirmed: {
      type: 'array',
      items: {
        type: 'object',
        required: ['severity', 'where', 'claim'],
        properties: {
          severity: { type: 'string', description: 'blocker | major | minor' },
          where: { type: 'string', description: 'file:line' },
          claim: { type: 'string' },
          fix: { type: 'string' },
        },
      },
    },
    falsePositivesDropped: { type: 'number' },
  },
}

const GATE_SCHEMA = {
  type: 'object',
  required: ['typecheck', 'riskTier'],
  properties: {
    typecheck: { type: 'string', description: 'pass | fail' },
    typecheckErrors: { type: 'string' },
    riskTier: { type: 'string', description: 'P0 | P1 | P2 | P3' },
    tags: { type: 'array', items: { type: 'string' } },
    needsHumanReview: { type: 'boolean' },
    suggestedTest: { type: 'string' },
  },
}

// --- Phase 0 — Intake & Backlog · Mary · 1 agent -----------------------------
phase('Intake')
const intake = await agent(
  `${GUARD}\nYou are MARY, the BMAD Analyst. Build the sprint backlog and pick ONE.
Read: ${WT}/PLAN.md, ${WT}/docs/spec/REDESIGN-PROGRESS.md, the ADRs in ${WT}/docs/adr, recent git log, open PRs (gh pr list if available), the previous run summary, and project-context §5.
${HINT ? 'Operator hint for this run: ' + HINT : ''}
Return: a short prioritized backlog, the ONE chosen sprint, a single compressed contradiction-free intent sentence, and whether it is low-risk (light spec) or risky/multi-file (full spec + gate). One coherent, finishable improvement only.`,
  { label: 'mary:intake', phase: 'Intake' }
)

// --- Phase 1 — Plan & harden · up to 5 parallel (all read-only = light) ------
phase('Plan')
const [spec, archRuling, uxNotes, preMortem, testDesign] = await parallel([
  () => agent(
    `${GUARD}\nYou are JOHN, the BMAD PM. From this intake author a SELF-CONTAINED story spec a developer can implement with no other context (set touchesUi / touchesBackend honestly).\n\nINTAKE:\n${intake}`,
    { label: 'john:spec', phase: 'Plan', schema: SPEC_SCHEMA }
  ),
  () => agent(
    `${GUARD}\nYou are WINSTON, the BMAD Architect. Judge the sprint against the ADRs + conventions in project-context. Return PASS / CONCERNS / FAIL, list any NEW architectural decision it would introduce (must reuse a documented convention OR ship a new docs/adr/ ADR), and the exact module/file boundaries it must respect.\n\nINTAKE:\n${intake}`,
    { label: 'winston:arch', phase: 'Plan' }
  ),
  () => agent(
    `${GUARD}\nYou are SALLY, the BMAD UX designer. If this touches UI, return concrete premium/colorful/responsive/accessible (WCAG 2.2 AA) requirements (layout hierarchy, states, transitions, lucide icons, density). If purely backend reply "N/A — backend sprint".\n\nINTAKE:\n${intake}`,
    { label: 'sally:ux', phase: 'Plan' }
  ),
  () => agent(
    `${GUARD}\nYou are the BMAD plan-hardening critic (advanced-elicitation). Run a PRE-MORTEM ("assume this shipped and broke production — why?") and an INVERSION pass on the chosen sprint. Return a tight list of the failure modes that MUST become extra acceptance criteria / targeted tests.\n\nINTAKE:\n${intake}`,
    { label: 'critic:premortem', phase: 'Plan' }
  ),
  () => agent(
    `${GUARD}\nYou are MURAT, the BMAD Test Architect (planning hat). Pre-assess the sprint's risk tier (P0–P3) and content tags ([auth][schema][security][public-api][ui]) and name the single most valuable targeted unit/integration test it should add (NO E2E, NO builds). Keep it short.\n\nINTAKE:\n${intake}`,
    { label: 'murat:test-design', phase: 'Plan' }
  ),
])

// Gate: do not implement on FAIL.
if (spec && String(spec.readiness).toUpperCase() === 'FAIL') {
  return { landed: false, reason: 'Readiness gate = FAIL — re-scope at the intent/spec layer next run', intake, spec, archRuling, uxNotes, preMortem }
}

// --- Phase 2 — Implement · disjoint seams, up to 3 parallel ------------------
phase('Implement')
const specStr = JSON.stringify(spec, null, 2)
const sharedCtx = `STORY SPEC:\n${specStr}\n\nARCHITECT RULING:\n${archRuling}\n\nUX REQUIREMENTS:\n${uxNotes}\n\nPRE-MORTEM failure modes (treat as acceptance criteria):\n${preMortem}`
const implTasks = []
if (!spec || spec.touchesUi !== false) {
  implTasks.push(() => agent(
    `${GUARD}\nYou are AMELIA (frontend). Implement ONLY the frontend part of this story under ${WT}/apps/web (Next.js App Router, @pilotage/ui, Tailwind v4, lucide-react, recharts). Reuse shared components; premium/responsive/accessible. Coordinate types via packages/contracts. Edit ONLY files under apps/web (+ packages/contracts types if needed). Make the edits now. Return the list of files you changed + a 2-line note.\n\n${sharedCtx}`,
    { label: 'amelia:frontend', phase: 'Implement' }
  ))
}
if (spec && spec.touchesBackend) {
  implTasks.push(() => agent(
    `${GUARD}\nYou are AMELIA (backend). Implement ONLY the backend part under ${WT}/apps/api (+ apps/worker if needed). PRESERVE auth, tenant_id scoping, ABAC, append-only audit. If you change the schema, update prisma/schema.prisma + packages/contracts types — do NOT run migrations or builds. Edit ONLY files under apps/api / apps/worker / packages/contracts. Make the edits now. Return the files changed + a 2-line note.\n\n${sharedCtx}`,
    { label: 'amelia:backend', phase: 'Implement' }
  ))
}
if (!spec || spec.touchesUi !== false) {
  implTasks.push(() => agent(
    `${GUARD}\nYou are the DESIGN-SYSTEM GUARDIAN. If this sprint needs a shared-UI change, make it ONLY under ${WT}/packages/ui (a new/updated reusable component, consistent with CVA + tokens). Do NOT duplicate app-level markup here. If no shared-UI change is needed, reply "N/A — no packages/ui change" and edit nothing.\n\n${sharedCtx}`,
    { label: 'ds-guardian', phase: 'Implement' }
  ))
}
const implResults = await parallel(implTasks)
const feResult = implResults[0] || 'N/A'
const beResult = (spec && spec.touchesBackend) ? (implResults[1] || 'N/A') : 'N/A — no backend changes'

// --- Phase 3 — Verify · up to 6 parallel; ONLY Murat runs typecheck ----------
phase('Verify')
const diffCtx = `STORY SPEC:\n${specStr}\n\nCHANGES:\n${JSON.stringify(implResults, null, 2)}`
const [adversarial, security, edgeCases, a11y, drift, gate] = await parallel([
  () => agent(
    `${GUARD}\nYou are QUINN, the adversarial reviewer. Inspect the diff in ${WT} (git diff). You MUST hunt for real defects + omissions (missing cases, broken states, regressions, unmet acceptance criteria). THEN triage: keep only findings you are confident are real; DROP speculative ones (report the count). Return confirmed findings only.\n\n${diffCtx}`,
    { label: 'quinn:adversarial', phase: 'Verify', schema: FINDINGS_SCHEMA }
  ),
  () => agent(
    `${GUARD}\nYou are SENTINEL, the security/tenant reviewer. Review the diff for: missing tenant_id scoping (cross-tenant leak), broken auth/ABAC (StudentAccessService), missing validation, audit gaps, secrets. Return confirmed security findings only.\n\n${diffCtx}`,
    { label: 'sentinel:security', phase: 'Verify', schema: FINDINGS_SCHEMA }
  ),
  () => agent(
    `${GUARD}\nYou are the EDGE-CASE HUNTER (BMAD). Exhaustively walk the branching paths the diff introduces (empty/null, pagination bounds, large inputs, concurrent edits, error/loading states, i18n). Return confirmed edge-case gaps only (same shape).\n\n${diffCtx}`,
    { label: 'edge-hunter', phase: 'Verify', schema: FINDINGS_SCHEMA }
  ),
  () => agent(
    `${GUARD}\nYou are the ACCESSIBILITY reviewer (WCAG 2.2 AA). If the diff touches UI, check contrast, focus order/visible focus, keyboard ops, aria/labels, target size, motion-reduce. Return confirmed a11y gaps only. If no UI change, return an empty confirmed list.\n\n${diffCtx}`,
    { label: 'a11y', phase: 'Verify', schema: FINDINGS_SCHEMA }
  ),
  () => agent(
    `${GUARD}\nYou are the CONSISTENCY/ADR-DRIFT reviewer. Flag anything in the diff that diverges from project-context/ADRs: off-convention file paths, a new HTTP/state pattern, N+1 from the client instead of an aggregate endpoint, a non-reused UI primitive, an undocumented architectural decision. Return confirmed drift findings only.\n\n${diffCtx}`,
    { label: 'consistency-drift', phase: 'Verify', schema: FINDINGS_SCHEMA }
  ),
  () => agent(
    `${GUARD.replace("Do NOT run 'pnpm typecheck'", 'You MAY run pnpm typecheck (you are the only agent allowed to)')}\nYou are MURAT, the Test Architect (gate hat). In ${WT}: run 'pnpm typecheck' ONCE and 'git diff --check' (NO builds, NO other heavy commands) and report pass/fail + errors. Assign the final P0–P3 risk tier + tags, set needsHumanReview=true for P0/P1 or [auth]/[schema]/[security], and name the single targeted test to add (if any).`,
    { label: 'murat:gate', phase: 'Verify', schema: GATE_SCHEMA }
  ),
])

const confirmed = []
  .concat((adversarial && adversarial.confirmed) || [])
  .concat((security && security.confirmed) || [])
  .concat((edgeCases && edgeCases.confirmed) || [])
  .concat((a11y && a11y.confirmed) || [])
  .concat((drift && drift.confirmed) || [])
const blockers = confirmed.filter((f) => String(f.severity).toLowerCase() === 'blocker')
const typecheckFailed = gate && String(gate.typecheck).toLowerCase() === 'fail'
const highRisk = gate && (gate.needsHumanReview || ['P0', 'P1'].includes(String(gate.riskTier)))

// --- Phase 4 — Fix blockers / typecheck (Amelia, sequential) -----------------
let fixNote = 'no blockers'
if (blockers.length || typecheckFailed) {
  fixNote = await agent(
    `${GUARD.replace("Do NOT run 'pnpm typecheck'", 'You MAY run pnpm typecheck to confirm your fix')}\nYou are AMELIA. Fix ONLY these confirmed blockers / typecheck errors in ${WT}, then re-run 'pnpm typecheck' ONCE to confirm. If a fix reveals the spec/intent was wrong, say so (diagnose at the right layer) instead of patching symptoms. Return what you fixed.\n\nTYPECHECK: ${gate && gate.typecheckErrors}\nBLOCKERS:\n${JSON.stringify(blockers, null, 2)}`,
    { label: 'amelia:fix', phase: 'Verify' }
  )
}

// --- Phase 5 — Escalation panel (party-mode) — ONLY for high-risk, ≤3 --------
phase('Escalate')
let panel = 'not needed (not high-risk)'
if (highRisk) {
  const votes = await parallel([
    () => agent(`${GUARD}\nYou are WINSTON (architect). High-risk change (${gate.riskTier} ${(gate.tags || []).join(' ')}). Inspect the diff in ${WT}; is it architecturally sound and consistent? Give a verdict + the one thing that most needs human attention.`, { label: 'panel:architect', phase: 'Escalate' }),
    () => agent(`${GUARD}\nYou are SENTINEL (security). High-risk change. Re-inspect the diff in ${WT} for the worst plausible security/tenant failure and whether it is handled. Verdict + the one must-check.`, { label: 'panel:security', phase: 'Escalate' }),
    () => agent(`${GUARD}\nYou are MURAT (test architect). High-risk change. What is the minimum test evidence required before a human should merge this? Verdict + the test to add.`, { label: 'panel:test', phase: 'Escalate' }),
  ])
  panel = votes.filter(Boolean).join('\n---\n')
}

// --- Phase 6 — Land brief (Paige) -------------------------------------------
phase('Land')
const prBrief = await agent(
  `${GUARD}\nYou are PAIGE, the tech writer. Write a Checkpoint-Preview PR body for the change in ${WT} (git diff): (1) one-line intent, (2) scope metrics (files/modules/lines/boundary crossings), (3) walkthrough grouped by CONCERN (not git order), (4) the 2–5 highest-blast-radius spots with risk tags, (5) 2–5 concrete manual checks (a UI action on http://localhost:3100, an API call). Then a one-paragraph summary + a recommended NEXT sprint. ${highRisk ? 'START the body with "⚠️ Needs human review — do not auto-merge" and fold in the escalation panel notes.' : ''}\n\nGATE: ${JSON.stringify(gate)}\nESCALATION PANEL:\n${panel}\nCONFIRMED FINDINGS: ${JSON.stringify(confirmed, null, 2)}\nFIX: ${fixNote}`,
  { label: 'paige:pr', phase: 'Land' }
)

return {
  landed: true,
  intake, spec, architectRuling: archRuling, uxNotes, preMortem, testDesign,
  changes: implResults,
  verify: { gate, confirmedFindings: confirmed, blockers, typecheckFailed, highRisk, fixNote, panel },
  prBrief,
}
