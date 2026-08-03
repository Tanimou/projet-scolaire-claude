#!/usr/bin/env bash
#
# ci-gate.sh — run the merge gate locally, the same stages and the same order as
# .github/workflows/ci.yml.
#
# WHY A LOCAL RUNNER EXISTS
# -------------------------
# V3's premise is that guardrails are "executed rather than asserted". GitHub
# Actions has not started a single job since 2026-07-28 — the account is locked
# for billing (PF-59) — so a workflow file proves nothing today. Until billing is
# restored this script IS the gate: the Daily Improvement routine runs it, and its
# result is what the PR reports.
#
# It is deliberately the same command list as ci.yml so the two cannot drift into
# disagreeing (S-E02-2 acceptance criterion 4). When Actions comes back, ci.yml
# calls this script rather than re-listing the stages.
#
# Usage:
#   bash scripts/ci-gate.sh            # all stages
#   bash scripts/ci-gate.sh --quick    # skip the build stage (slowest)
#
# Exit code is non-zero if ANY stage fails. Every stage runs even after an earlier
# one fails, so one run reports every problem instead of one problem per run.

set -uo pipefail

cd "$(dirname "$0")/.."

QUICK=0
[ "${1:-}" = "--quick" ] && QUICK=1

FAILED_STAGES=()
PASSED_STAGES=()

run_stage() {
  local name="$1"
  shift
  echo ""
  echo "──────────────────────────────────────────────────────────────"
  echo "▶ ${name}"
  echo "──────────────────────────────────────────────────────────────"
  if "$@"; then
    PASSED_STAGES+=("${name}")
    echo "✓ ${name}"
  else
    FAILED_STAGES+=("${name}")
    echo "✗ ${name}"
  fi
}

# Stage 1 — Prisma client. Everything downstream (typecheck, tests, build) fails
# with unresolvable types if the generated client is missing, which is precisely
# how the audited worktree reported "tests cannot run".
run_stage "prisma generate" pnpm --filter @pilotage/api prisma generate

# Stage 2 — lint. `pnpm lint` fails on ESLint *errors* only; warnings never fail a
# build, which is exactly how 996 of them accumulated unseen once the stage was
# finally able to run (PF-71). The ratchet is what makes the warning count
# binding — it fails on any increase, and equally on a ceiling left too high
# after a fix, so the number can only ever go down. See scripts/lint-ratchet.js.
run_stage "lint" pnpm lint
run_stage "lint:warnings (ratchet)" node scripts/lint-ratchet.js

# Stage 3 — typecheck (all workspaces, via turbo)
run_stage "typecheck" pnpm typecheck

# Stage 4/5 — unit tests, through the ratchet rather than raw jest, so that the
# 20 pre-existing failures are tolerated-but-tracked while any NEW failure fails
# the gate. See scripts/test-ratchet.js for why this is not "silencing".
run_stage "test:api (ratchet)" node scripts/test-ratchet.js api
run_stage "test:worker (ratchet)" node scripts/test-ratchet.js worker

# Stage 6 — build
if [ "${QUICK}" -eq 0 ]; then
  run_stage "build" pnpm build
else
  echo ""
  echo "⏭  build skipped (--quick)"
fi

# Stage 7 — boot. Every stage above proves the code *compiles*; not one of them
# starts the application. That gap shipped a seven-week production 404 (PF-62 — a
# controller silently unmounted) and very nearly shipped a DI break that
# typecheck, build and ESLint all called green (R-24 — `import type` erasing the
# emitted `design:paramtypes`). This stage constructs the real module graph from
# the built artefact and compares the booted route table against a reviewed
# baseline. It runs AFTER the build, and is skipped with it, because it reads
# dist/. See scripts/boot-check.js.
if [ "${QUICK}" -eq 0 ]; then
  run_stage "boot (module graph + route table)" node scripts/boot-check.js
else
  echo ""
  echo "⏭  boot check skipped (--quick — it reads the build's dist/)"
fi

echo ""
echo "══════════════════════════════════════════════════════════════"
echo "  CI GATE SUMMARY"
echo "══════════════════════════════════════════════════════════════"
for s in "${PASSED_STAGES[@]:-}"; do [ -n "$s" ] && echo "  ✓ ${s}"; done
for s in "${FAILED_STAGES[@]:-}"; do [ -n "$s" ] && echo "  ✗ ${s}"; done

if [ "${#FAILED_STAGES[@]}" -gt 0 ]; then
  echo ""
  echo "GATE: FAIL (${#FAILED_STAGES[@]} stage(s))"
  exit 1
fi

echo ""
echo "GATE: PASS"
