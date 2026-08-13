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
# three source-only scanners that cost about a second each. Everything that needs
# a build, a database or Docker moved behind --full, which is run before a
# release and by the verification sweep — not on every PR.
#
# Nothing was deleted — `--full` is the old gate, stage for stage.
#
# The rewrite that introduced these tiers left the OLD stage list in place above
# them, and all seven of its calls passed the stage name where run_stage expects
# a timeout. `timeout` read the name as its interval and exited 125 before the
# command ran, every one landed in FAILED[], and the summary exits non-zero
# whenever FAILED[] is non-empty — so **every code-change gate reported
# `GATE: FAIL` regardless of the diff**, while docs-only runs returned PASS
# because their `exit 0` fires before the summary and discarded the seven
# failures unread. That block is now excised, run_stage refuses a non-numeric
# timeout outright, and `csv escapers` — the one stage whose ONLY call site was
# a broken one — moved into tier 1 (TOOL-06).
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
  # An omitted timeout is an AUTHORING error, and it used to be a silent one.
  # `timeout` read the stage NAME as its interval, exited 125 before running the
  # command, and run_stage filed that under FAILED[] as an ordinary stage
  # failure — so the gate reported `GATE: FAIL` on a diff it had never examined.
  # Seven call sites did this from #214 until this commit (TOOL-06), and the
  # banner said `▶ node` rather than the stage name (the name was in $limit and
  # $2 held the command), which is why 39 runs read the output and saw nothing.
  # Refuse to start instead: a mis-declared stage is a broken gate, not a red diff.
  case "$limit" in
    ''|*[!0-9]*)
      echo "ci-gate: stage '${name}' was declared without a numeric timeout." >&2
      echo "         run_stage <timeout_seconds> <name> <command...>  — got '${limit}'." >&2
      exit 64 ;;
  esac
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
# components, so a .ts-only walk would certify a surface it could not see.
# Two apps/api transport-CSV sites (stored and re-parsed, never opened in a
# spreadsheet) are named exclusions, and a STALE exclusion is itself a failure.
#
# THIS IS THE ONLY CALL SITE, and until this commit it was the broken one: the
# ratchet #215 landed as blocking had never executed once (TOOL-06). Rule C is
# also the only executed evidence that the WEB half of S-E05-1 is wired at all
# (apps/web has no unit runner, PF-129/PF-133). Source-only, ~1s, and outside
# every skip — a flag that skips it is a DNC-10 hole with a house-style alibi.
# Kept in step with .github/workflows/ci.yml — the two must not drift (S-E02-2 AC-4).
run_stage 120 "csv escapers (one neutraliser, two escapers)" node scripts/csv-escape-check.js

# ---------------------------------------------------------------------------
# TIER 2 — the code stages. Run when code changed.
# ---------------------------------------------------------------------------
CODE_RE='^(apps/|packages/|scripts/|prisma/|package\.json|pnpm-lock\.yaml|turbo\.json|tsconfig)'

if changed_match "$CODE_RE"; then
  # Schema drift runs BEFORE `prisma generate`, and the order is correctness
  # rather than style (S-E02-11 AC-6): `prisma generate` will happily generate a
  # client for a schema no migration produces, and lint, typecheck, build and
  # boot then all validate against that fiction while
  # infra/docker/migrate-entrypoint.sh runs `migrate deploy` and only `migrate
  # deploy` — so the edit reaches no database, ever. That is `db push`'s failure
  # mode arriving through the front door, and the ledger has to be refused before
  # a client is generated against it.
  #
  # Until this commit that ordering held only in the dead pre-#214 block excised
  # above (TOOL-06); down here the two stages had been the other way round since
  # the rewrite, and the meta-test kept reading the dead lines and passing.
  #
  # It needs a live PostgreSQL, and it is only meaningful when prisma changed. It
  # creates a disposable scratch database, applies apps/api/prisma/migrations to
  # it, diffs THAT DATABASE against the datamodel, and drops it on every exit
  # path — NOT a text diff over the migrations directory, which returns exit 2 on
  # this repository unchanged and reports all five PostgreSQL extensions as
  # "[+] Added extensions" although 0_baseline creates every one of them. With
  # the database down it FAILS rather than skipping, and the remedy is to start
  # it, never to edit code — the decision record is
  # docs/adr/ADR-027-schema-drift-gate-needs-a-database.md, which names the cost
  # this stage accepts (R-23) and why it does not overturn ADR-025 D1:
  #   docker compose --env-file .env -f infra/docker-compose.yml up -d postgres
  #
  # RESTORED, not added (TOOL-14, run 44). This line and the ADR filename above
  # are load-bearing: S-E02-11 AC-5 and AC-15 assert that this stage names its
  # decision record BY FILENAME and carries the sibling stages' anti-drift note
  # WITHIN 1400 characters of the invocation — so the note stays adjacent to the
  # `run_stage` below, not at the top of this block. #223's excision of the dead
  # pre-#214 block took both out with it and the two meta-tests went red on main,
  # unseen, because #223's own api ratchet timed out at this very stage list
  # before it could report them. This run is the first whose full ratchet
  # finished (347s), which is how they surfaced at all. Comments only: no stage,
  # no bound and no command changed.
  #
  # Kept in step with .github/workflows/ci.yml — the two must not drift (S-E02-2 AC-4).
  if changed_match '^apps/api/prisma/'; then
    run_stage 90 "schema drift" node scripts/schema-drift-check.js
    # S-E01-2b — the RLS half, and it is not redundant with the stage above.
    #
    # `prisma migrate diff` CANNOT SEE POLICIES: measured, with ENABLE ROW LEVEL
    # SECURITY, CREATE POLICY tenant_isolation and the app_user GRANTs installed,
    # the drift diff returns "No difference detected", exit 0, byte-identical to
    # the clean baseline. So the stage above can never observe a policy dropped
    # out of band, nor a 45th tenant_id table shipped without one. This stage is
    # the ONLY thing that can, and it proves it by EXECUTION: scratch database,
    # full ledger applied, connected AS THE NON-OWNER ROLE app_user, rows
    # appearing and disappearing as the tenant GUC changes.
    #
    # It FAILS and never skips when PostgreSQL, the client set, or the role is
    # unreachable (DNC-08, ADR-027) — the remedy is to start PostgreSQL, never to
    # edit code. 600 s covers create + migrate deploy + the adversarial run + drop
    # on a cold cluster; the local measured wall time is ~15 s.
    #
    # Kept in step with .github/workflows/ci.yml — the two must not drift
    # (S-E02-2 AC-4).
    run_stage 600 "rls isolation" node scripts/rls-isolation-check.js
  else
    skip_stage "schema drift" "no prisma change"
    skip_stage "rls isolation" "no prisma change"
  fi

  # Then the client: without it typecheck/tests fail on unresolvable types.
  run_stage 300 "prisma generate" bash -c prisma_generate

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
  # `engines.node` said `>=20.0.0` while the API cannot start below Node
  # 20.19/22.12 at all: `jose@6` is ESM-only and `jwks-rsa@4` require()s it from
  # CommonJS, on the boot path via AuthModule (PF-73). Measured when this stage
  # was written, **35** installed dependencies contradicted the declared range.
  # Source-only and ~2s, so it is a candidate for tier 1 — recorded as TOOL-08
  # rather than promoted here, because widening the fast tier is a decision about
  # the gate's contract, not a side effect of repairing it.
  run_stage 120 "runtime engines" node scripts/runtime-engines-check.js
  # The documented command must start the documented stack. It did not: compose
  # resolves `.env` from the compose file's directory (`infra/`), `infra/.env`
  # does not exist, and every port lived in the ROOT .env — so the documented
  # invocation fell through to `${VAR:-default}` and started a different stack,
  # silently. Keycloak announced an issuer reachable on no port and the api
  # rejected every token: login was broken by construction (PF-86).
  # It stays in --full because it RUNS `docker compose config` in both
  # directions; the fast tier is deliberately Docker-free.
  run_stage 120 "compose invocation" node scripts/compose-invocation-check.js
  run_stage 600 "lint:warnings (ratchet)" node scripts/lint-ratchet.js
  run_stage 1800 "build" pnpm build
  run_stage 300 "boot (module graph + route table)" node scripts/boot-check.js
  run_stage 180 "web artefact" node scripts/web-artifact-check.js
  run_stage 300 "observability" node scripts/observability-check.js
  run_stage 300 "tracing" node scripts/tracing-check.js
  run_stage 180 "csp" node scripts/csp-check.js
  # Reads the emitted route manifest, so it runs after the build and only here.
  # Kept in step with .github/workflows/ci.yml — the two must not drift (S-E02-2 AC-4).
  # (This note was absent from the whole --full block, and the meta-test asserting
  # it sits within 1400 characters of the call has been red on main since #214
  # moved the stage down here — TOOL-07's fourth sibling, found the same way.)
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
