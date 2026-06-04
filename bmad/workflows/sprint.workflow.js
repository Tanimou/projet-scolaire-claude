// =============================================================================
// Daily-Improvement v4 — one BMAD sprint, as a Claude Workflow (EPIC-AWARE)
// -----------------------------------------------------------------------------
// Invoked by the `daily-improvement-v2` routine AFTER it has put the main
// checkout on a fresh feature branch. Drives the BMAD phases with up to 5–6
// agents in parallel, edits code IN THE CHECKOUT, returns a structured result.
// The routine then does git commit/push/PR — this workflow NEVER builds/pushes.
//
//   Workflow({ scriptPath: "bmad/workflows/sprint.workflow.js",
//              args: { worktree: "<abs path>", mode?, epic?, slice?, hint? } })
//
// AMBITION (v4): the routine builds MEDIUM-TO-LARGE features, not just polish.
// Ambition comes from SEQUENCING — Victor (Product Strategist) reads
// bmad/roadmap.md, picks one epic, and the routine ships it ONE VERTICAL SLICE
// per run. Two run shapes, chosen by Intake:
//   • epic-spec : the epic has no spec yet → write docs/spec/features/<id>/*
//                 (spec.md, plan.md, data-model.md, contracts/openapi.yaml,
//                 tasks.md, quickstart.md, PROGRESS.md). Docs-only → no build.
//   • epic-slice / polish : implement ONE vertical slice (DB+API+UI+worker) as
//                 today (Plan → Implement → Verify → Fix → Escalate → Land).
//
// RESOURCE BUDGET (do not compromise CPU/RAM/disk):
//   • ≤ 6 agents in parallel (runtime also caps at cpu-2).
//   • Only ONE agent (Murat) ever runs `pnpm typecheck`. No agent ever builds.
//   • Implement agents work on DISJOINT seams (web vs api/worker vs ui).
// Guardrail: every agent reads bmad/project-context.md + bmad/agents.md +
// bmad/roadmap.md first.
// =============================================================================

export const meta = {
  name: 'daily-improvement-v4-sprint',
  description: 'Run one BMAD sprint — epic-spec OR one vertical slice of a roadmap epic — with up to 6 parallel agents; PR-only, no builds',
  phases: [
    { title: 'Intake' },
    { title: 'Plan' },
    { title: 'Spec' },
    { title: 'Implement' },
    { title: 'Verify' },
    { title: 'Escalate' },
    { title: 'Land' },
  ],
}

const WT = (args && args.worktree) || 'C:/Users/HP/Downloads/pilotage-scolaire-claude'
const HINT = (args && args.hint) || ''
const ARG_MODE = (args && args.mode) || 'auto'
const ARG_EPIC = (args && args.epic) || ''
const ARG_SLICE = (args && args.slice) || ''
const GUARD = `ALWAYS read ${WT}/bmad/project-context.md, ${WT}/bmad/agents.md and ${WT}/bmad/roadmap.md FIRST and obey them as hard constraints. Work ONLY inside ${WT}. NEVER run any build/rebuild (pnpm build, next build, docker build/compose build, infra/pilotage.sh update|rebuild|reset). Do NOT run 'pnpm typecheck' (only the test-architect agent runs it, to protect CPU/RAM). NEVER touch unrelated areas or remove working features.`

const INTAKE_SCHEMA = {
  type: 'object',
  required: ['mode', 'intent'],
  properties: {
    mode: { type: 'string', description: 'epic-spec | epic-slice | polish' },
    epic: { type: 'string', description: 'roadmap epic id, e.g. E1 (empty for polish)' },
    epicTitle: { type: 'string' },
    slice: { type: 'string', description: 'the specific slice id/title for epic-slice (e.g. "S1 — parent ack/resolve")' },
    intent: { type: 'string', description: 'one compressed, contradiction-free sentence describing THIS run' },
    visionaryIdea: { type: 'string', description: 'optional net-new UX idea Victor proposes for this epic' },
    lowRisk: { type: 'boolean' },
    rationale: { type: 'string' },
  },
}

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
    touchesWorker: { type: 'boolean' },
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

// === Phase 0 — Intake & Roadmap · Victor + Mary · 1 agent =====================
phase('Intake')
const intake = await agent(
  `${GUARD}\nYou are VICTOR (Product Strategist) working with MARY (Analyst). Decide what this run builds, biased toward MEDIUM-TO-LARGE features — not polish.
Read ${WT}/bmad/roadmap.md (the epic backlog + status), and if an epic is in progress its ${WT}/docs/spec/features/<id>/PROGRESS.md and tasks.md. Also skim PLAN.md, docs/spec/REDESIGN-PROGRESS.md, recent git log and open PRs (gh pr list).
${ARG_MODE !== 'auto' ? `Operator override: mode=${ARG_MODE} epic=${ARG_EPIC} slice=${ARG_SLICE}. Honor it unless clearly unsafe.` : ''}
${HINT ? 'Operator hint: ' + HINT : ''}
Decide the run MODE:
  • epic-spec  — the chosen epic has NO docs/spec/features/<id>/spec.md yet → THIS run writes its spec-kit (docs only, no code).
  • epic-slice — spec exists AND tasks.md has an unstarted slice → ship the NEXT vertical slice (DB+API+UI+worker for ONE capability, one PR).
  • polish     — no epic slice is ready, or a quick high-value fix is clearly better.
Bias: epic-slice ≫ epic-spec ≫ polish. Pick the current epic = highest-priority 'in-progress' else 'next' else promote a 'proposed'. The current focus pointer at the top of roadmap.md wins ties.
As Victor, you may also surface ONE net-new UX idea that makes the product incontournable (alert→action, weekly parent digest, remediation tracker) — only if it fits the chosen epic.
Return mode, epic (id+title), the specific slice (for epic-slice), and a single compressed contradiction-free intent for THIS run.`,
  { label: 'victor:intake', phase: 'Intake', schema: INTAKE_SCHEMA }
)

const mode = intake && intake.mode ? String(intake.mode) : 'polish'
const epicId = (intake && intake.epic) || ARG_EPIC || ''
const epicDir = epicId ? `${WT}/docs/spec/features/${epicId.toLowerCase()}` : ''

// =============================================================================
// BRANCH A — EPIC-SPEC: write the spec-kit folder (docs only, NO build)
// =============================================================================
if (mode === 'epic-spec') {
  phase('Plan')
  const [prd, arch, ux] = await parallel([
    () => agent(
      `${GUARD}\nYou are JOHN (PM). Author the PRODUCT SPEC for epic ${epicId} "${intake.epicTitle || ''}" from the roadmap + cahier de charges. Cover: vision & the parent value, target users, concrete scenarios, FUNCTIONAL REQUIREMENTS, explicit ACCEPTANCE CRITERIA, NON-GOALS, and a sliced delivery plan (an ordered list of thin VERTICAL slices, each demoable end-to-end and shippable in one PR). Keep each slice ≤ a day of focused work.\n\nINTAKE:\n${JSON.stringify(intake)}`,
      { label: 'john:prd', phase: 'Plan' }
    ),
    () => agent(
      `${GUARD}\nYou are WINSTON (Architect). For epic ${epicId}: produce the DATA MODEL (new/changed Prisma models, relations, constraints, tenant_id + indexes, a non-destructive migration plan) AND the API CONTRACTS (REST endpoints under /api/v1, payloads, errors, RBAC/ABAC per endpoint). Flag any NEW architectural decision that needs a docs/adr/ ADR. Respect existing conventions (aggregate endpoints, packages/contracts, RLS).\n\nINTAKE:\n${JSON.stringify(intake)}`,
      { label: 'winston:datamodel', phase: 'Plan' }
    ),
    () => agent(
      `${GUARD}\nYou are SALLY (UX). For epic ${epicId}: define the premium, colorful, mobile-first (parent <2 s), WCAG 2.2 AA UX — key screens/states, the information→action flow, empty/loading/error states, and reuse of @pilotage/ui. Non-stigmatising, kind tone.\n\nINTAKE:\n${JSON.stringify(intake)}`,
      { label: 'sally:ux', phase: 'Plan' }
    ),
  ])

  phase('Spec')
  const specWrite = await agent(
    `${GUARD}\nYou are PAIGE (scribe) writing the BMAD spec-kit for epic ${epicId} into ${epicDir}/ . Create these files from the inputs below (create the directory):
  - spec.md         (John's vision/users/scenarios/acceptance/non-goals)
  - plan.md         (technical approach, modules touched, dependencies, risks)
  - data-model.md   (Winston's Prisma models/relations/constraints + migration plan)
  - contracts/openapi.yaml  (Winston's endpoints/payloads/errors/permissions — valid YAML)
  - tasks.md        (the ORDERED vertical-slice backlog: S1, S2, … each with a checkbox, scope DB/API/UI/worker, and acceptance — this is what later runs implement)
  - quickstart.md   (how to run/seed/test this feature locally)
  - PROGRESS.md     (status table: each slice + state 'todo', plus a "next slice" pointer = S1)
Write real, specific content (no placeholders). Make the edits now. Then return the list of files written.\n\nPRD:\n${prd}\n\nARCHITECTURE (data model + contracts):\n${arch}\n\nUX:\n${ux}`,
    { label: 'paige:spec-write', phase: 'Spec' }
  )

  phase('Land')
  const specBrief = await agent(
    `${GUARD}\nYou are PAIGE (tech writer). Write a concise PR body for the new spec-kit of epic ${epicId}: what the epic delivers and why (parent value), the sliced delivery plan (list S1…Sn), any new ADR proposed, and that this PR is DOCS-ONLY (no code, no build). End by stating the next run will implement slice S1.\n\nFILES:\n${specWrite}`,
    { label: 'paige:spec-pr', phase: 'Land' }
  )

  return {
    landed: true,
    docsOnly: true, // ← the routine SKIPS the build for a docs-only spec run
    mode,
    epic: epicId,
    intake,
    artifacts: { prd, arch, ux },
    files: specWrite,
    prBrief: specBrief,
  }
}

// =============================================================================
// BRANCH B — EPIC-SLICE / POLISH: implement ONE vertical slice (build = 1×)
// =============================================================================
phase('Plan')
const sliceCtx = `MODE: ${mode}\nEPIC: ${epicId} ${intake && intake.epicTitle ? '— ' + intake.epicTitle : ''}\nSLICE: ${(intake && intake.slice) || ARG_SLICE || '(polish — no epic slice)'}\nINTENT: ${intake && intake.intent}\nFor epic-slice runs, read ${epicDir}/spec.md, tasks.md and PROGRESS.md and implement ONLY the next slice — a thin VERTICAL slice (DB + API + UI + worker as needed) that is demoable end-to-end and fits ONE PR.`
const [spec, archRuling, uxNotes, preMortem, testDesign] = await parallel([
  () => agent(
    `${GUARD}\nYou are JOHN, the BMAD PM. Author a SELF-CONTAINED story spec for THIS slice — a developer must be able to implement it with no other context. Set touchesUi / touchesBackend / touchesWorker honestly. Keep it to ONE shippable vertical slice (do NOT try to build the whole epic).\n\n${sliceCtx}`,
    { label: 'john:spec', phase: 'Plan', schema: SPEC_SCHEMA }
  ),
  () => agent(
    `${GUARD}\nYou are WINSTON, the BMAD Architect. Judge this slice against the ADRs + conventions. Return PASS / CONCERNS / FAIL, list any NEW architectural decision (must reuse a documented convention OR ship a new docs/adr/ ADR), and the exact module/file boundaries. For schema changes: ensure tenant_id + RLS + a non-destructive migration.\n\n${sliceCtx}`,
    { label: 'winston:arch', phase: 'Plan' }
  ),
  () => agent(
    `${GUARD}\nYou are SALLY, the BMAD UX designer. If this slice touches UI, return concrete premium/colorful/responsive/accessible (WCAG 2.2 AA), mobile-first requirements (layout, states, transitions, lucide icons, density, empty/loading/error). If purely backend reply "N/A — backend slice".\n\n${sliceCtx}`,
    { label: 'sally:ux', phase: 'Plan' }
  ),
  () => agent(
    `${GUARD}\nYou are the BMAD plan-hardening critic. Run a PRE-MORTEM ("assume this slice shipped and broke production — why?") and an INVERSION pass. Return the failure modes that MUST become extra acceptance criteria / targeted tests (auth/tenant leaks, missing publication checks, N+1, migration risk).\n\n${sliceCtx}`,
    { label: 'critic:premortem', phase: 'Plan' }
  ),
  () => agent(
    `${GUARD}\nYou are MURAT, the BMAD Test Architect (planning hat). Pre-assess this slice's risk tier (P0–P3) + content tags ([auth][schema][security][public-api][ui]) and name the single most valuable targeted test (NO E2E, NO builds).\n\n${sliceCtx}`,
    { label: 'murat:test-design', phase: 'Plan' }
  ),
])

// Gate: do not implement on FAIL.
if (spec && String(spec.readiness).toUpperCase() === 'FAIL') {
  return { landed: false, mode, epic: epicId, reason: 'Readiness gate = FAIL — re-scope at the intent/spec/slice layer next run', intake, spec, archRuling, uxNotes, preMortem }
}

// --- Phase 2 — Implement · disjoint seams, up to 3 parallel ------------------
phase('Implement')
const specStr = JSON.stringify(spec, null, 2)
const sharedCtx = `STORY SPEC (one vertical slice):\n${specStr}\n\nARCHITECT RULING:\n${archRuling}\n\nUX REQUIREMENTS:\n${uxNotes}\n\nPRE-MORTEM failure modes (treat as acceptance criteria):\n${preMortem}\n\n${sliceCtx}`
const implTasks = []
if (!spec || spec.touchesUi !== false) {
  implTasks.push(() => agent(
    `${GUARD}\nYou are AMELIA (frontend). Implement ONLY the frontend part of this slice under ${WT}/apps/web (Next.js App Router, @pilotage/ui, Tailwind v4, lucide-react, recharts). Reuse shared components; premium/responsive/accessible; read aggregate endpoints (no client N+1). Coordinate types via packages/contracts. Edit ONLY files under apps/web (+ packages/contracts types if needed). Make the edits now. Return the files changed + a 2-line note.\n\n${sharedCtx}`,
    { label: 'amelia:frontend', phase: 'Implement' }
  ))
}
if (spec && (spec.touchesBackend || spec.touchesWorker)) {
  implTasks.push(() => agent(
    `${GUARD}\nYou are AMELIA (backend). Implement ONLY the backend part under ${WT}/apps/api (+ ${WT}/apps/worker if the slice needs async jobs/recompute/notifications/exports). PRESERVE auth, tenant_id scoping, ABAC, append-only audit. If you change the schema, update prisma/schema.prisma + packages/contracts types and add a non-destructive migration — do NOT run migrations or builds. Edit ONLY files under apps/api / apps/worker / packages/contracts. Make the edits now. Return the files changed + a 2-line note.\n\n${sharedCtx}`,
    { label: 'amelia:backend', phase: 'Implement' }
  ))
}
if (!spec || spec.touchesUi !== false) {
  implTasks.push(() => agent(
    `${GUARD}\nYou are the DESIGN-SYSTEM GUARDIAN. If this slice needs a shared-UI change, make it ONLY under ${WT}/packages/ui (a new/updated reusable component, consistent with CVA + tokens). Do NOT duplicate app-level markup here. If no shared-UI change is needed, reply "N/A — no packages/ui change" and edit nothing.\n\n${sharedCtx}`,
    { label: 'ds-guardian', phase: 'Implement' }
  ))
}
const implResults = await parallel(implTasks)

// --- Phase 3 — Verify · up to 6 parallel; ONLY Murat runs typecheck ----------
phase('Verify')
const diffCtx = `STORY SPEC:\n${specStr}\n\nCHANGES:\n${JSON.stringify(implResults, null, 2)}`
const [adversarial, security, edgeCases, a11y, drift, gate] = await parallel([
  () => agent(
    `${GUARD}\nYou are QUINN, the adversarial reviewer. Inspect the diff in ${WT} (git diff). You MUST hunt for real defects + omissions (missing cases, broken states, regressions, unmet acceptance criteria). THEN triage: keep only findings you are confident are real; DROP speculative ones (report the count). Return confirmed findings only.\n\n${diffCtx}`,
    { label: 'quinn:adversarial', phase: 'Verify', schema: FINDINGS_SCHEMA }
  ),
  () => agent(
    `${GUARD}\nYou are SENTINEL, the security/tenant reviewer. Review the diff for: missing tenant_id scoping (cross-tenant leak), broken auth/ABAC (StudentAccessService, guardianship, teaching_assignment), missing validation, audit gaps, secrets, a parent reading unpublished/unauthorized data. Return confirmed security findings only.\n\n${diffCtx}`,
    { label: 'sentinel:security', phase: 'Verify', schema: FINDINGS_SCHEMA }
  ),
  () => agent(
    `${GUARD}\nYou are the EDGE-CASE HUNTER. Exhaustively walk the branching paths the diff introduces (empty/null, pagination bounds, large inputs, concurrent edits, error/loading states, i18n, migration on existing data). Return confirmed edge-case gaps only.\n\n${diffCtx}`,
    { label: 'edge-hunter', phase: 'Verify', schema: FINDINGS_SCHEMA }
  ),
  () => agent(
    `${GUARD}\nYou are the ACCESSIBILITY reviewer (WCAG 2.2 AA). If the diff touches UI, check contrast, focus order/visible focus, keyboard ops, aria/labels, target size, motion-reduce, mobile. Return confirmed a11y gaps only. If no UI change, return an empty confirmed list.\n\n${diffCtx}`,
    { label: 'a11y', phase: 'Verify', schema: FINDINGS_SCHEMA }
  ),
  () => agent(
    `${GUARD}\nYou are the CONSISTENCY/ADR-DRIFT reviewer. Flag anything in the diff that diverges from project-context/ADRs: off-convention file paths, a new HTTP/state pattern, N+1 from the client instead of an aggregate endpoint, a non-reused UI primitive, an undocumented architectural decision, a slice that quietly grew beyond ONE vertical slice. Return confirmed drift findings only.\n\n${diffCtx}`,
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
    `${GUARD.replace("Do NOT run 'pnpm typecheck'", 'You MAY run pnpm typecheck to confirm your fix')}\nYou are AMELIA. Fix ONLY these confirmed blockers / typecheck errors in ${WT}, then re-run 'pnpm typecheck' ONCE to confirm. If a fix reveals the spec/intent/slice was wrong, say so (diagnose at the right layer) instead of patching symptoms. Return what you fixed.\n\nTYPECHECK: ${gate && gate.typecheckErrors}\nBLOCKERS:\n${JSON.stringify(blockers, null, 2)}`,
    { label: 'amelia:fix', phase: 'Verify' }
  )
}

// --- Phase 5 — Escalation panel (party-mode) — ONLY for high-risk, ≤3 --------
phase('Escalate')
let panel = 'not needed (not high-risk)'
if (highRisk) {
  const votes = await parallel([
    () => agent(`${GUARD}\nYou are WINSTON (architect). High-risk change (${gate.riskTier} ${(gate.tags || []).join(' ')}). Inspect the diff in ${WT}; is it architecturally sound and consistent? Verdict + the one thing that most needs human attention.`, { label: 'panel:architect', phase: 'Escalate' }),
    () => agent(`${GUARD}\nYou are SENTINEL (security). High-risk change. Re-inspect the diff in ${WT} for the worst plausible security/tenant/child-data failure and whether it is handled. Verdict + the one must-check.`, { label: 'panel:security', phase: 'Escalate' }),
    () => agent(`${GUARD}\nYou are MURAT (test architect). High-risk change. What is the minimum test evidence required before a human merges this? Verdict + the test to add.`, { label: 'panel:test', phase: 'Escalate' }),
  ])
  panel = votes.filter(Boolean).join('\n---\n')
}

// --- Phase 6 — Land brief (Paige) — also advance roadmap/PROGRESS ------------
phase('Land')
const prBrief = await agent(
  `${GUARD}\nYou are PAIGE, the tech writer. (1) UPDATE roadmap tracking: tick this slice in ${WT}/bmad/roadmap.md and, for an epic-slice run, update ${epicDir}/PROGRESS.md (mark the slice done, point "next slice" to the following one; if it was the last slice, set the epic status to 'shipped'). Make those edits now. (2) Then write a Checkpoint-Preview PR body for the change in ${WT} (git diff): one-line intent, the epic+slice this advances, scope metrics, walkthrough grouped by CONCERN, the 2–5 highest-blast-radius spots with risk tags, and 2–5 concrete manual checks (a UI action on http://localhost:3000, an API call). Then a one-paragraph summary + the recommended NEXT slice. ${highRisk ? 'START the body with "⚠️ Needs human review — do not auto-merge" and fold in the escalation panel notes.' : ''}\n\nMODE: ${mode}  EPIC: ${epicId}\nGATE: ${JSON.stringify(gate)}\nESCALATION PANEL:\n${panel}\nCONFIRMED FINDINGS: ${JSON.stringify(confirmed, null, 2)}\nFIX: ${fixNote}`,
  { label: 'paige:pr', phase: 'Land' }
)

return {
  landed: true,
  docsOnly: false,
  mode,
  epic: epicId,
  slice: (intake && intake.slice) || ARG_SLICE || '',
  intake, spec, architectRuling: archRuling, uxNotes, preMortem, testDesign,
  changes: implResults,
  verify: { gate, confirmedFindings: confirmed, blockers, typecheckFailed, highRisk, fixNote, panel },
  prBrief,
}
