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

# Stage 0 — the runtime everything below runs on. `engines.node` said `>=20.0.0`
# while the API cannot start below Node 20.19/22.12 at all: `jose@6` is ESM-only
# and `jwks-rsa@4` require()s it from CommonJS, on the boot path via AuthModule
# (PF-73). Nothing ever checked that claim, and `.nvmrc`/`ci.yml` pinned a
# floating `22`, whose declared meaning includes the window where boot is
# impossible. Measured when this stage was written: **35** installed dependencies
# contradicted the declared range, not the one the finding named. It runs first
# and costs ~2 s, because a gate running on an unsupported runtime has validated
# nothing below it. Kept in step with .github/workflows/ci.yml — the two must not
# drift (S-E02-2 AC-4).
run_stage "runtime engines" node scripts/runtime-engines-check.js

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

# Stage 8 — web artefact. The boot check covers the two Nest applications; it
# cannot cover apps/web, which has no module graph to construct, so the third
# artefact of a three-artefact deployment had no build-output assertion at all.
# Measured before this stage existed: with apps/web/.next deleted in its
# entirety, `node scripts/boot-check.js` still returned exit 0, and no other
# stage above reads .next. That is R-25 — "a build reports success while emitting
# nothing" — at the one address the R-25 mitigation did not reach. It also holds
# the release gate's web third to being dynamic (S-E02-10 / R-05). Reads the
# build's .next/, so it runs after the build and is skipped with it.
if [ "${QUICK}" -eq 0 ]; then
  run_stage "web artefact (build output + route inventory)" node scripts/web-artifact-check.js
else
  echo ""
  echo "⏭  web artefact check skipped (--quick — it reads the build's .next/)"
fi

# Stage 9 — observability. `infra/docker-compose.yml` has declared an `obs`
# profile (Prometheus/Grafana/Loki) since it was written, and A2 §13 recorded it
# as "configuration optional rather than proven active" (PF-56). Measured before
# this stage existed, it was worse than optional: all THREE of the profile's
# bind-mount sources were absent from the repository, so Prometheus would have
# received a directory where it expects its config file — and no application
# registered a single metric, so a working Prometheus would have scraped
# nothing. This stage reads the profile the way the other gates read their
# declarations: scrape targets must name real services on the ports they really
# listen on, scraped paths must be routes the applications really BOOT (checked
# against the same booted route table as stage 7), dashboards must query metrics
# the applications really register (read from the built registries), and nginx
# must not publish /metrics. Reads dist/, so it runs after the build.
if [ "${QUICK}" -eq 0 ]; then
  run_stage "observability (profile + scrape coherence)" node scripts/observability-check.js
else
  echo ""
  echo "⏭  observability check skipped (--quick — it reads the build's dist/)"
fi

# Stage 10 — tracing. The traces half of PF-56, separated from stage 9 rather
# than half-built. `infra/docker-compose.yml` declared a `jaeger` service and
# handed applications an OTLP endpoint since the `obs` profile was written;
# measured at run 15, a grep for `opentelemetry|otel` over all three
# applications' source returned ZERO hits. A collector was deployed, an address
# supplied, and nothing emitted a span. This stage does what stage 9 does for
# metrics and one thing more: it SPAWNS a child Node process, serves a real
# request over a real socket, and fails if no span comes out — because the
# defect being closed is precisely "everything configured, nothing emitted".
# It also holds the load order, which is the sharp part: OpenTelemetry patches
# modules as they load, so a SDK started after ./app.module patches nothing,
# throws nothing, and yields an application that merely looks instrumented.
# Reads dist/, so it runs after the build.
if [ "${QUICK}" -eq 0 ]; then
  run_stage "tracing (load order + real span emission)" node scripts/tracing-check.js
else
  echo ""
  echo "⏭  tracing check skipped (--quick — it reads the build's dist/)"
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
