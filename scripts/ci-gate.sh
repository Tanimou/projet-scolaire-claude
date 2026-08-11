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
# the billing lock. Kept in step with it — the two must not drift (S-E02-2 AC-4).
# When Actions returns, ci.yml should call THIS script — `ci-gate.sh` on
# pull_request, `--full` on main — so there is one list of stages rather than two
# lists that can disagree.

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

# Stage 0b — production artefacts (string scan). Four surfaces of the hosted
# deployment told real users to look for their activation email in
# `http://localhost:1080` — a Maildev container that exists only in a
# developer's compose stack (PF-17) — and the Keycloak admin client resolved its
# credentials with `?? 'admin'` while compose declared neither variable, so the
# hosted API really did authenticate as admin/admin (PF-54). Both were found by
# reading; nothing executed. This stage is what turns "someone noticed" into
# "the gate refuses".
#
# It runs HERE, second, on purpose: it reads source only, so it needs no
# install, no generated Prisma client and no build — it costs ~1 s and fails on
# the diff rather than ten minutes later. That also makes it the one late-added
# stage that still runs under `--quick`. Kept in step with
# .github/workflows/ci.yml — the two must not drift (S-E02-2 AC-4).
run_stage "production artefacts (string scan)" node scripts/production-artefact-check.js

# Stage 0c — compose invocation. The routine's target IS the local Docker stack
# (SKILL Step -1), so "the documented command starts the documented stack" is a
# release property, not a documentation nicety. It was false: compose resolves
# `.env` from the compose file's directory (`infra/`), `infra/.env` does not
# exist, and every port lived in the ROOT .env — so the documented invocation
# fell through to `${VAR:-default}` and started a different stack, silently.
#
# Measured when this stage was written, the finding was understated. Inside
# infra/docker-compose.yml alone, KC_HOSTNAME and KEYCLOAK_PUBLIC_URL hard-coded
# `localhost:8180` (the api uses the latter as the EXPECTED TOKEN ISSUER) while
# `keycloak.ports` defaulted to 8080 and the web was sent to 8080. On the
# documented path Keycloak announced an issuer reachable on no port and the api
# rejected every token: login was broken by construction, and "worked" only
# because one machine's gitignored .env said 8180 on a path where compose never
# read it.
#
# Like every other stage here it reads the parsed artefact rather than grepping
# for expected shapes, so a new service inherits the rules. Beyond that it RUNS
# `docker compose config` in both directions and asserts the refusal actually
# happens; where docker is absent it says so rather than passing vacuously.
# Source-only, so it runs early and under `--quick`. Kept in step with
# .github/workflows/ci.yml — the two must not drift (S-E02-2 AC-4).
run_stage "compose invocation (documented command = documented stack)" node scripts/compose-invocation-check.js

# Stage 0d — audit writes (S-E04-7, gates G-AUDIT / G-DNC, ADR-035 D11-D14).
#
# PF-31 stayed open across two epics because each fix closed sites while nothing
# stopped the next one being written the old way. This stage is the ratchet:
# every audit write under apps/api/src + apps/worker/src +
# packages/imports-core/src is either behind writeAudit(tx, {…}) inside a
# transaction, or carries a reviewed baseline row with a class, a reason, and a
# finding id that RESOLVES against docs/daily-improvement-v3/audit-findings-index.md
# — resolves, not merely matches PF-nnn, which is the S-E06-5 defect measured and
# turned into a check. It also fails any writeAudit call given a non-transactional
# first argument, a non-literal second argument, or sitting inside a try block.
#
# The walk root is stated because a gate rooted at apps/api alone would be blind
# to the two audit writes in packages/imports-core/src/engine.ts — S-E06-5 (a
# package bundled into every portal but outside the gate's walk root) recurring at
# a second address.
#
# It reads SOURCE only — no build, no database, no generated client — so it runs
# here, early, and it sits deliberately OUTSIDE every --quick guard: a documented
# flag that skips the audit gate is a DNC-10 hole with a house-style alibi.
# Kept in step with .github/workflows/ci.yml — the two must not drift (S-E02-2 AC-4).
run_stage "audit writes (every audit row through the seam, or baselined with an owner)" node scripts/audit-write-check.js

# Stage 0d-bis — CSV escapers (S-E05-1, gates G-TRUTH / G-PORTAL / G-DNC, ADR-037 D8).
#
# PF-168 is one security predicate answered differently by different files: at
# HEAD, "is this cell dangerous?" had FIVE implementations, and the same
# operator-entered `profession` string escaped three different ways depending on
# which export button emitted it. S-E05-1 lifted the predicate into
# packages/contracts/src/security/csv-injection.ts and deleted the copies. This
# stage is what stops the sixth one — PF-168 was itself raised against a slice
# that had already "fixed" this once, which is the whole argument for a ratchet
# rather than another sweep.
#
# It fails on: a CSV escaper anywhere under the walk root outside the two
# sanctioned ones (detected by NAME *or* by SHAPE — an RFC-4180 quote-doubling
# body — because two of the five deleted copies were called `escapeCell`, so a
# name-only rule would be blind to exactly the defect being closed); the trigger
# set re-assembled outside the shared module; or a sanctioned escaper that stops
# importing and calling neutraliseCsvCell.
#
# The walk root includes .tsx, deliberately: three of the five copies lived in
# components, so a .ts-only walk would certify a surface it could not see —
# S-E06-5 at a third address. Two apps/api transport-CSV sites (stored and
# re-parsed, never opened in a spreadsheet) are named exclusions, and a STALE
# exclusion is itself a failure, so those two source comments stay true.
#
# There is no baseline file: after S-E05-1 the correct count is two and two is
# the ceiling, so a "row to add" would be the off switch. It reads SOURCE only —
# no build, no database, no generated client, ~1 s — so it runs here, early, and
# OUTSIDE every --quick guard. Rule C is the ONLY executed evidence that the WEB
# half of S-E05-1 is wired at all (apps/web has no unit runner, PF-129/PF-133),
# and a documented flag that skips it is a DNC-10 hole with a house-style alibi.
# Kept in step with .github/workflows/ci.yml — the two must not drift (S-E02-2 AC-4).
run_stage "csv escapers (one neutraliser, two escapers)" node scripts/csv-escape-check.js

# Stage 0e — schema drift. Editing apps/api/prisma/schema.prisma WITHOUT writing
# a migration passed every stage in this file. Stage 1 below runs `prisma
# generate`, which happily generates a client for a schema no migration produces;
# lint, typecheck, build and boot then all validate against that fiction, and
# `infra/docker/migrate-entrypoint.sh` runs `migrate deploy` and only `migrate
# deploy`, so the edit reaches no database ever. That is `db push`'s failure mode
# arriving through the front door.
#
# It therefore runs BEFORE `prisma generate`, deliberately: the ledger must be
# refused before a client is generated against a schema nothing can build.
#
# It creates a disposable scratch database, applies apps/api/prisma/migrations to
# it, diffs THAT DATABASE against the datamodel, and drops it on every exit path.
# NOT a text diff over the migrations directory: measured on this repository
# unchanged, `migrate diff --from-migrations …` returns exit 2 and reports all
# five PostgreSQL extensions as "[+] Added extensions" although 0_baseline creates
# every one of them — a gate built that way is permanently red on correct code.
#
# PRECONDITION, NEW WITH THIS STAGE: `bash scripts/ci-gate.sh` now requires a
# reachable PostgreSQL, under --quick too (it reads prisma/ and a database, never
# dist/ or .next/, so skipping it under --quick would be the omission DNC-08
# forbids). With the local stack down this stage FAILS rather than skipping, and
# the remedy is to start the database, never to edit code:
#   docker compose --env-file .env -f infra/docker-compose.yml up -d postgres
# That precondition contradicts ADR-025 D1 and therefore ships with its own
# decision record — docs/adr/ADR-027-schema-drift-gate-needs-a-database.md — which
# draws the distinction that keeps both coherent: the operator drill needs a
# SEEDED database (a state CI cannot have), this stage needs an EMPTY PostgreSQL
# SERVER (a capability ci.yml's build job already provisions).
# Kept in step with .github/workflows/ci.yml — they must not drift (S-E02-2 AC-4).
run_stage "schema drift (the migration ledger reproduces schema.prisma)" node scripts/schema-drift-check.js

# Stage 1 — Prisma client. Everything downstream (typecheck, tests, build) fails
# with unresolvable types if the generated client is missing, which is precisely
# how the audited worktree reported "tests cannot run".
run_stage "prisma generate" pnpm --filter @pilotage/api prisma generate

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
  # 20 of the api app's 71 specs live in src/shared/quality/ and assert on the
  # gate machinery itself — scripts/*.js, this file, ci.yml, infra/. They are
  # also the slowest by a wide margin (180s, 122s, 93s…), and they were the
  # difference between a 7-minute gate and a 48-minute one.
  #
  # A diff that touches none of those files cannot change their verdict, so it
  # does not run them. A diff that DOES touch gate machinery runs every one —
  # which is the only case where they can tell you anything. The ratchet holds
  # their baseline entries out of the drift comparison and says so out loud, so
  # a skipped test is never mistaken for a passing one.
  GATE_MACHINERY='^(scripts/|\.github/|infra/|apps/api/src/shared/quality/)'
  if changed_match "$GATE_MACHINERY"; then
    run_stage 2400 "test:api (ratchet)" node scripts/test-ratchet.js api
  else
    run_stage 1200 "test:api (ratchet, product specs)" \
      node scripts/test-ratchet.js api --skip src/shared/quality/
  fi
  run_stage 1200 "test:worker (ratchet)" node scripts/test-ratchet.js worker
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
