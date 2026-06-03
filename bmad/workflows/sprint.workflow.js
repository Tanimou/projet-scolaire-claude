// =============================================================================
// Daily-Improvement v2 — one BMAD sprint, as a Claude Workflow
// -----------------------------------------------------------------------------
// Invoked by the `daily-improvement-v2` routine AFTER it has created a fresh
// worktree off origin/main. This script drives the BMAD phases with at most
// 3–4 agents in parallel, edits code IN THE WORKTREE, and returns a structured
// result (spec, confirmed findings, changed files, PR brief, summary). The
// routine then does git commit/push/PR — this workflow NEVER builds and NEVER
// pushes.
//
//   Workflow({ scriptPath: "bmad/workflows/sprint.workflow.js",
//              args: { worktree: "<abs path>", hint: "<optional sprint hint>" } })
//
// Guardrail: every agent must read bmad/project-context.md first.
// =============================================================================

export const meta = {
  name: 'daily-improvement-v2-sprint',
  description: 'Run one BMAD sprint (intake → plan+harden → implement → verify) in a worktree; PR-only, no builds',
  phases: [
    { title: 'Intake' },
    { title: 'Plan' },
    { title: 'Implement' },
    { title: 'Verify' },
    { title: 'Land' },
  ],
}

const WT = (args && args.worktree) || 'C:/Users/HP/Downloads/pilotage-scolaire-claude'
const HINT = (args && args.hint) || ''
const GUARD = `ALWAYS read ${WT}/bmad/project-context.md and ${WT}/bmad/agents.md FIRST and obey them as hard constraints. Work ONLY inside ${WT}. NEVER run any build/rebuild (pnpm build, next build, docker build/compose build, infra/pilotage.sh update|rebuild|reset). NEVER touch unrelated areas or remove working features.`

const SPEC_SCHEMA = {
  type: 'object',
  required: ['title', 'portal', 'acceptanceCriteria', 'files', 'readiness'],
  properties: {
    title: { type: 'string' },
    portal: { type: 'string', description: 'admin | teacher | parent | platform' },
    intent: { type: 'string', description: 'one compressed, contradiction-free sentence' },
    functionalRequirements: { type: 'array', items: { type: 'string' } },
    acceptanceCriteria: { type: 'array', items: { type: 'string' } },
    files: { type: 'array', items: { type: 'string' }, description: 'exact files/modules to touch' },
    contract: { type: 'string', description: 'shared packages/contracts types, if any' },
    riskTier: { type: 'string', description: 'P0 | P1 | P2 | P3' },
    tags: { type: 'array', items: { type: 'string' }, description: '[auth][schema][security][public-api][ui]…' },
    readiness: { type: 'string', description: 'PASS | CONCERNS | FAIL' },
    preMortemFailureModes: { type: 'array', items: { type: 'string' } },
  },
}

const VERDICT_SCHEMA = {
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

// --- Phase 0 — Intake & Backlog (Mary, 1 agent) ------------------------------
phase('Intake')
const intake = await agent(
  `${GUARD}\nYou are MARY, the BMAD Analyst. Build the sprint backlog and pick ONE.
Read: ${WT}/PLAN.md, ${WT}/docs/spec/REDESIGN-PROGRESS.md, the ADRs in ${WT}/docs/adr, recent git log, open PRs (gh pr list if available), and project-context §5.
${HINT ? 'Operator hint for this run: ' + HINT : ''}
Return: (a) a short prioritized backlog, (b) the ONE chosen sprint, (c) a single compressed, contradiction-free intent sentence, (d) whether it is low-risk (→ light spec) or risky/multi-file (→ full spec + gate). Keep it to one coherent, finishable improvement.`,
  { label: 'mary:intake', phase: 'Intake' }
)

// --- Phase 1 — Plan & harden (John + Winston + Sally, ≤3 parallel) -----------
phase('Plan')
const [spec, archRuling, uxNotes] = await parallel([
  () => agent(
    `${GUARD}\nYou are JOHN, the BMAD PM. From this intake, author a SELF-CONTAINED story spec that a developer can implement with no other context. Run a PRE-MORTEM ("assume this shipped and broke production — why?") and an INVERSION pass and fold the failure modes into acceptanceCriteria.\n\nINTAKE:\n${intake}`,
    { label: 'john:spec', phase: 'Plan', schema: SPEC_SCHEMA }
  ),
  () => agent(
    `${GUARD}\nYou are WINSTON, the BMAD Architect. Judge the chosen sprint (from the intake below) against the ADRs and conventions in project-context. Return a readiness verdict PASS / CONCERNS / FAIL, list any NEW architectural decision it would introduce (which must instead reuse a documented convention OR ship with a new docs/adr/ ADR), and the exact module/file boundaries it must respect.\n\nINTAKE:\n${intake}`,
    { label: 'winston:arch', phase: 'Plan' }
  ),
  () => agent(
    `${GUARD}\nYou are SALLY, the BMAD UX designer. If this sprint touches UI, return concrete premium/colorful/responsive/accessible (WCAG 2.2 AA) requirements (layout hierarchy, states, transitions, lucide icons, density). If it is purely backend, reply "N/A — backend sprint".\n\nINTAKE:\n${intake}`,
    { label: 'sally:ux', phase: 'Plan' }
  ),
])

// Gate: do not implement on FAIL.
if (spec && String(spec.readiness).toUpperCase() === 'FAIL') {
  return {
    landed: false,
    reason: 'Readiness gate = FAIL — re-scope at the intent/spec layer next run',
    intake, spec, archRuling, uxNotes,
  }
}

// --- Phase 2 — Implement (Amelia FE + Amelia BE, ≤2 parallel along seams) -----
phase('Implement')
const specStr = JSON.stringify(spec, null, 2)
const sharedCtx = `STORY SPEC:\n${specStr}\n\nARCHITECT RULING:\n${archRuling}\n\nUX REQUIREMENTS:\n${uxNotes}`
const [feResult, beResult] = await parallel([
  () => agent(
    `${GUARD}\nYou are AMELIA (frontend). Implement ONLY the frontend part of this story in ${WT} (Next.js App Router, @pilotage/ui, Tailwind v4, lucide-react, recharts). Reuse shared components; keep it premium/responsive/accessible. Coordinate types via packages/contracts. Make the edits now with Edit/Write. Return the list of files you changed and a 2-line note of what you did.\n\n${sharedCtx}`,
    { label: 'amelia:frontend', phase: 'Implement' }
  ),
  () => agent(
    `${GUARD}\nYou are AMELIA (backend). Implement ONLY the backend part of this story in ${WT} (NestJS module, Prisma, Zod/class-validator). PRESERVE auth, tenant_id scoping, ABAC, append-only audit. If you change the schema, update prisma/schema.prisma + the shared packages/contracts types — do NOT run migrations or builds. Make the edits now with Edit/Write. Return the list of files you changed and a 2-line note. If this is a pure-frontend sprint, reply "N/A — no backend changes".\n\n${sharedCtx}`,
    { label: 'amelia:backend', phase: 'Implement' }
  ),
])

// --- Phase 3 — Verify (Quinn + Sentinel + Murat, ≤3 parallel) — NO builds ----
phase('Verify')
const diffCtx = `STORY SPEC:\n${specStr}\n\nFRONTEND CHANGES:\n${feResult}\n\nBACKEND CHANGES:\n${beResult}`
const [adversarial, security, riskGate] = await parallel([
  () => agent(
    `${GUARD}\nYou are QUINN, the BMAD adversarial reviewer. Inspect the actual diff in ${WT} (git diff). You MUST hunt for real defects and omissions (missing edge cases, broken states, regressions, unmet acceptance criteria). THEN triage: keep only findings you are genuinely confident are real; DROP imagined/speculative ones (report how many you dropped). Return the confirmed findings only.\n\n${diffCtx}`,
    { label: 'quinn:adversarial', phase: 'Verify', schema: VERDICT_SCHEMA }
  ),
  () => agent(
    `${GUARD}\nYou are SENTINEL, the security/tenant reviewer. Review the diff in ${WT} for: missing tenant_id scoping (cross-tenant leak), broken auth/ABAC (StudentAccessService), missing input validation, audit gaps, secrets. Return confirmed security findings only (same shape: severity/where/claim/fix).\n\n${diffCtx}`,
    { label: 'sentinel:security', phase: 'Verify', schema: VERDICT_SCHEMA }
  ),
  () => agent(
    `${GUARD}\nYou are MURAT, the Test Architect. (1) Run the objective gate in ${WT}: 'pnpm typecheck' and 'git diff --check' (NO builds) and report pass/fail with any errors. (2) Assign a P0–P3 risk tier and content tags ([auth][schema][security][public-api][ui]). (3) Say what targeted unit test (if any) the change warrants and whether it should be flagged for human review (P0/P1 → yes). Return a short structured verdict.`,
    { label: 'murat:gate', phase: 'Verify' }
  ),
])

const confirmed = []
  .concat((adversarial && adversarial.confirmed) || [])
  .concat((security && security.confirmed) || [])
const blockers = confirmed.filter((f) => String(f.severity).toLowerCase() === 'blocker')

// --- Phase 4/5 — Fix blockers, then produce the landing brief (Amelia + Paige)
phase('Land')
let fixNote = 'no blockers'
if (blockers.length) {
  fixNote = await agent(
    `${GUARD}\nYou are AMELIA. Fix ONLY these confirmed blockers in ${WT}, then re-run 'pnpm typecheck'. If a fix reveals the spec/intent was wrong, say so (diagnose at the right layer) instead of patching symptoms. Return what you fixed.\n\nBLOCKERS:\n${JSON.stringify(blockers, null, 2)}`,
    { label: 'amelia:fix', phase: 'Land' }
  )
}

const prBrief = await agent(
  `${GUARD}\nYou are PAIGE, the tech writer. Write a Checkpoint-Preview PR body for the change in ${WT} (git diff): (1) one-line intent, (2) scope metrics (files/modules/lines/boundary crossings), (3) walkthrough grouped by CONCERN (not git order), (4) the 2–5 highest-blast-radius spots with risk tags, (5) 2–5 concrete manual things a reviewer should try (e.g. a UI action on http://localhost:3100, an API call). Then a one-paragraph run summary and a recommended NEXT sprint. If Murat flagged P0/P1, start the body with "⚠️ Needs human review — do not auto-merge".\n\nVERIFY RESULTS:\nMurat: ${riskGate}\nConfirmed findings: ${JSON.stringify(confirmed, null, 2)}\nFix: ${fixNote}`,
  { label: 'paige:pr', phase: 'Land' }
)

return {
  landed: true,
  intake,
  spec,
  architectRuling: archRuling,
  uxNotes,
  changes: { frontend: feResult, backend: beResult },
  verify: { adversarial, security, riskGate, confirmedFindings: confirmed, blockers, fixNote },
  prBrief,
}
