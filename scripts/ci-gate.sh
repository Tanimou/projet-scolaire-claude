#!/usr/bin/env bash
#
# ci-gate.sh — the merge gate.
#
# GitHub Actions has started no job since 2026-07-28 (account locked for billing,
# PF-59), so this script IS the gate: the Daily Improvement routine runs it and
# reports its verdict on the PR.
#
#   bash scripts/ci-gate.sh           # FAST — what every PR runs (default)
#   bash scripts/ci-gate.sh --full    # everything, incl. build + artefact scans
#   bash scripts/ci-gate.sh --quick   # alias of default, kept for older callers
#
# WHY FAST IS THE DEFAULT
# -----------------------
# The gate had 19 stages and took the better part of an hour. Six of them
# (boot, web artefact, observability, tracing, csp, link integrity) read dist/
# and .next/, so each one forced a full `pnpm build` — the build was not one
# slow stage, it was the price of admission for a third of the list.
#
# The default now runs what catches a broken change: types, lint, tests, and the
# two source-only scanners that cost about a second each. Everything that needs a
# build, a database or Docker moved behind --full, which is run before a release
# and by the verification sweep — not on every PR.
#
# Nothing was deleted — `--full` is the old gate, stage for stage.
#
# .github/workflows/ci.yml still lists its own jobs, and has started none since
# the billing lock. The old rule was "keep the two lists identical" (S-E02-2
# AC-4); with two tiers here that rule no longer expresses anything useful. When
# Actions returns, ci.yml should call THIS script — `ci-gate.sh` on pull_request,
# `--full` on main — so there is one list of stages instead of two that drift.

set -uo pipefail
cd "$(dirname "$0")/.."

MODE=fast
case "${1:-}" in
  --full)  MODE=full ;;
  --quick) MODE=fast ;;
  "")      MODE=fast ;;
  *) echo "usage: ci-gate.sh [--full|--quick]"; exit 64 ;;
esac

FAILED=(); PASSED=(); SKIPPED=()
t0=$(date +%s)

# run_stage <timeout_seconds> <name> <command...>
#
# Every stage is bounded. A gate that hangs is worse than a slow one: it burns a
# track's claim, blocks a merge and reports nothing. Measured while writing this
# file — `schema drift` waited forever on a Docker daemon that was not answering,
# and the run sat at 0.9s of CPU for ten minutes looking exactly like work.
run_stage() {
  local limit="$1" name="$2"; shift 2
  local s=$(date +%s)
  echo ""
  echo "▶ ${name}"
  if timeout --foreground "$limit" "$@"; then
    PASSED+=("${name} ($(( $(date +%s) - s ))s)"); echo "✓ ${name}"
  else
    local rc=$?
    if [ "$rc" -eq 124 ]; then
      FAILED+=("${name} — TIMED OUT after ${limit}s"); echo "✗ ${name} — timed out after ${limit}s"
    else
      FAILED+=("${name}"); echo "✗ ${name}"
    fi
  fi
}
skip_stage() { SKIPPED+=("$1 — $2"); echo "⏭  $1 ($2)"; }

# Generate the Prisma client, and prove it landed.
#
# This stage used to run `pnpm --filter @pilotage/api prisma generate`, which is
# not a generate at all: there is no "prisma" script in that package, so pnpm
# printed "None of the selected packages has a prisma script" and exited 0. The
# stage was green while producing nothing. It went unnoticed because the main
# checkout already held a client from some earlier real invocation — a fresh
# worktree has none, and every downstream stage then fails on
# `Module '"@prisma/client"' has no exported member 'PrismaClient'`.
# `exec` runs the binary, and the artefact check is what stops it lying again.
prisma_generate() {
  pnpm --filter @pilotage/api exec prisma generate || return 1
  local c
  c="$(find node_modules/.pnpm -maxdepth 5 -path '*.prisma/client*' -name 'index.d.ts' -print -quit 2>/dev/null)"
  [ -n "$c" ] && return 0
  echo "prisma generate reported success but emitted no client — refusing to pass."
  return 1
}
# exported so `timeout` can run it: timeout execs a command, not a shell function.
export -f prisma_generate

# ---------------------------------------------------------------------------
# Preflight — one clear message instead of a cascade.
# ---------------------------------------------------------------------------
# A worktree with no dependency set failed 14 stages in a row and reported
# "GATE: FAIL (14 stages)", which reads like fourteen problems and is one.
if [ ! -d node_modules/.pnpm ]; then
  echo "GATE: FAIL — dependencies are not installed in this worktree."
  echo "  run: pnpm install --frozen-lockfile"
  exit 1
fi

# ---------------------------------------------------------------------------
# What changed — lets the gate skip work the diff cannot possibly have broken.
# ---------------------------------------------------------------------------
# "no changes" and "I could not work out the base" both produce an empty list and
# must NOT be treated alike: the first has nothing to check, the second has to
# check everything. Conflating them ran every stage on an unchanged main checkout.
BASE="$(git merge-base origin/main HEAD 2>/dev/null || true)"
if [ -n "$BASE" ]; then
  COMMITTED="$(git diff --name-only "$BASE"...HEAD 2>/dev/null || true)"; KNOWN=1
else
  COMMITTED=""; KNOWN=0   # unknown ⇒ run everything, never less
fi

# The working tree counts too, and it is not an optimisation: the routine starts
# this gate BEFORE it commits (SKILL Step 6), so a committed-only diff would be
# empty and the gate would report PASS over a tree full of uncommitted code.
# Untracked files count as well — a brand-new source file is a change.
WORKING="$(git status --porcelain --no-renames 2>/dev/null | cut -c4- || true)"
CHANGED="$(printf '%s\n%s\n' "$COMMITTED" "$WORKING" | grep -v '^[[:space:]]*$' | sort -u || true)"

changed_match() { [ "$KNOWN" -eq 0 ] && return 0; echo "$CHANGED" | grep -qE "$1"; }

if [ "$KNOWN" -eq 1 ] && [ -z "$CHANGED" ]; then
  echo "GATE: PASS (nothing to gate — no committed or working-tree change against origin/main)"
  exit 0
fi

# Docs-only changes cannot break types, tests or a build. This is the single
# biggest win in practice: a large share of routine PRs are docs + ledger.
if [ -n "$CHANGED" ] && ! echo "$CHANGED" | grep -qvE '^(docs/|bmad/|\.claude/|[0-9]{2}_.*\.md$|.*\.md$)'; then
  echo ""
  echo "docs-only change — no code stage can be affected."
  echo "$CHANGED" | sed 's/^/  /'
  echo ""
  echo "GATE: PASS (docs-only, $(( $(date +%s) - t0 ))s)"
  exit 0
fi

echo "── ci-gate (${MODE}) ─────────────────────────────────────────"
[ -n "$CHANGED" ] && echo "$(echo "$CHANGED" | wc -l) changed file(s)"

# ---------------------------------------------------------------------------
# TIER 1 — source-only. Seconds, no install-time cost, no build, no database.
# ---------------------------------------------------------------------------

# Hosted pages told real users to check http://localhost:1080 for their
# activation mail, and the Keycloak admin client fell back to admin/admin
# (PF-17, PF-54). Pure string scan over source; ~1s.
run_stage 120 "production artefacts" node scripts/production-artefact-check.js

# Every audit row goes through writeAudit(tx, …) in a transaction, or carries a
# reviewed baseline with an owning finding (PF-31, G-AUDIT). Source-only; ~1s.
# Deliberately outside every skip: a flag that skips the audit gate is a DNC-10
# hole with a house-style alibi.
run_stage 120 "audit writes" node scripts/audit-write-check.js

# ---------------------------------------------------------------------------
# TIER 2 — the code stages. Run when code changed.
# ---------------------------------------------------------------------------
CODE_RE='^(apps/|packages/|scripts/|prisma/|package\.json|pnpm-lock\.yaml|turbo\.json|tsconfig)'

if changed_match "$CODE_RE"; then
  # Prisma client first: without it typecheck/tests fail on unresolvable types.
  run_stage 300 "prisma generate" bash -c prisma_generate

  # Schema drift needs a live PostgreSQL. Only meaningful when prisma changed,
  # and it says so rather than passing vacuously when the database is down.
  if changed_match '^apps/api/prisma/'; then
    run_stage 90 "schema drift" node scripts/schema-drift-check.js
  else
    skip_stage "schema drift" "no prisma change"
  fi

  run_stage 900 "typecheck" pnpm typecheck
  run_stage 600 "lint" pnpm lint
  run_stage 900 "test:api (ratchet)" node scripts/test-ratchet.js api
  run_stage 900 "test:worker (ratchet)" node scripts/test-ratchet.js worker
else
  skip_stage "code stages" "no code change"
fi

# ---------------------------------------------------------------------------
# TIER 3 — --full only. Everything here needs a build, Docker or a database.
# ---------------------------------------------------------------------------
if [ "$MODE" = full ]; then
  run_stage 120 "runtime engines" node scripts/runtime-engines-check.js
  run_stage 120 "compose invocation" node scripts/compose-invocation-check.js
  run_stage 600 "lint:warnings (ratchet)" node scripts/lint-ratchet.js
  run_stage 1800 "build" pnpm build
  run_stage 300 "boot (module graph + route table)" node scripts/boot-check.js
  run_stage 180 "web artefact" node scripts/web-artifact-check.js
  run_stage 300 "observability" node scripts/observability-check.js
  run_stage 300 "tracing" node scripts/tracing-check.js
  run_stage 180 "csp" node scripts/csp-check.js
  run_stage 180 "link integrity" node scripts/link-integrity-check.js
else
  echo ""
  echo "⏭  build + artefact scans (boot, web, observability, tracing, csp, links)"
  echo "   these need a build; they run in --full, before a release and in the"
  echo "   verification sweep."
fi

# ---------------------------------------------------------------------------
echo ""
echo "── summary (${MODE}, $(( $(date +%s) - t0 ))s) ───────────────"
for s in "${PASSED[@]:-}";  do [ -n "$s" ] && echo "  ✓ ${s}"; done
for s in "${SKIPPED[@]:-}"; do [ -n "$s" ] && echo "  ⏭ ${s}"; done
for s in "${FAILED[@]:-}";  do [ -n "$s" ] && echo "  ✗ ${s}"; done

if [ "${#FAILED[@]}" -gt 0 ]; then
  echo ""
  echo "GATE: FAIL (${#FAILED[@]} stage(s))"
  exit 1
fi

echo ""
echo "GATE: PASS (${MODE})"
