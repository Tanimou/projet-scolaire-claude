#!/usr/bin/env bash
#
# docs-lane-lock.sh — a SECOND, INDEPENDENT mutex for docs-only work (S-ROUTINE-1, ADR-069 §D4).
#
# WHY A SEPARATE SCRIPT AND A SEPARATE LOCK FILE
# ----------------------------------------------
# The routine is single-writer by design and that is not up for renegotiation: an earlier attempt (S3, 2026-08-12)
# replaced the single `write.lock` with a three-track coordinator, all three tracks wedged, and from 18:09 onward
# every tick logged `GATE=BUSY` with zero throughput for hours. It was reverted in PR #227. The lesson recorded
# there is structural: with one lock a dead run blocks one slot and the stale reaper frees it; with N tracks a dead
# run blocks a track and the ways to stall multiply faster than the throughput.
#
# So this does NOT touch `routine-lock.sh`, does NOT touch `write.lock`, and does NOT make the implementation lane
# parallel. It adds ONE narrowly-scoped lane whose work provably cannot collide with a build:
#
#   * It may write ONLY under `docs/` — enforced below, not merely requested.
#   * It never builds, never runs the sprint Workflow, never touches `apps/`, `packages/`, `scripts/`, `infra/`
#     or `prisma/`.
#   * It has its OWN lock directory, so acquiring it can neither block nor be blocked by the write lock.
#
# The measured problem it addresses: 25 roadmap findings appeared to lack ledger rows and the triage work to fix
# that is pure docs — yet it could not run, because the only mutex in the system is held for 1–2.5 h by whichever
# run is building. Spec, story and triage work should not queue behind a `pnpm build`.
#
# HONEST LIMIT, STATED UP FRONT. Two writers in one checkout can still collide on a FILE even when neither is
# building — `OPEN.md` is the obvious candidate, since both lanes write it. This lock serialises the docs lane
# against ITSELF and keeps it off the build lane's critical path; it does not make concurrent edits to the same
# file safe. Hence the `--paths` guard below and the rule that the docs lane never touches a file the current
# implementation branch has modified (checked by `conflicts`).
#
# Commands:  acquire | heartbeat | release | status | guard <path>... | conflicts
set -euo pipefail

STATE="${DOCS_LANE_STATE:-$HOME/.claude/scheduled-tasks/daily-improvement-v3/state}"
DLOCK="$STATE/docs-lane.lock"
STALE_MIN="${DOCS_LANE_STALE_MIN:-45}"
REPO="${DOCS_LANE_REPO:-C:/Users/HP/Downloads/pilotage-scolaire-claude}"

now() { date +%s; }

lock_fresh() {
  [ -d "$DLOCK" ] || return 1
  local hb; hb="$(cat "$DLOCK/heartbeat" 2>/dev/null || echo 0)"
  [ $(( $(now) - hb )) -le $(( STALE_MIN * 60 )) ]
}

case "${1:-}" in
  acquire)
    mkdir -p "$STATE"
    if lock_fresh; then
      echo "DOCS_LANE=BUSY since=$(cat "$DLOCK/started" 2>/dev/null) hb_age_s=$(( $(now) - $(cat "$DLOCK/heartbeat" 2>/dev/null || now) ))"
      exit 0
    fi
    rm -rf "$DLOCK" 2>/dev/null || true
    if mkdir "$DLOCK" 2>/dev/null; then
      now > "$DLOCK/started"; now > "$DLOCK/heartbeat"; echo "$$" > "$DLOCK/pid"
      echo "DOCS_LANE=OK started=$(cat "$DLOCK/started")"
    else
      echo "DOCS_LANE=BUSY (raced on mkdir)"
    fi
    ;;

  heartbeat)
    [ -d "$DLOCK" ] && now > "$DLOCK/heartbeat" && echo "docs-lane heartbeat ok" || echo "no docs-lane lock held"
    ;;

  release)
    rm -rf "$DLOCK" 2>/dev/null || true
    echo "docs-lane released"
    ;;

  status)
    echo "STATE=$STATE  STALE_MIN=$STALE_MIN"
    if lock_fresh; then
      echo "docs-lane.lock=HELD since=$(cat "$DLOCK/started" 2>/dev/null) hb_age_s=$(( $(now) - $(cat "$DLOCK/heartbeat" 2>/dev/null || now) ))"
    else
      echo "docs-lane.lock=free"
    fi
    ;;

  # ENFORCEMENT, not a request. Refuses any path outside docs/. The docs lane's whole safety argument is that it
  # cannot touch code, so the claim is checked rather than trusted.
  guard)
    shift
    bad=0
    for p in "$@"; do
      case "$p" in
        docs/*) ;;
        *) echo "REFUSED: '$p' is outside docs/ — the docs lane may not write it."; bad=1 ;;
      esac
    done
    [ "$bad" -eq 0 ] && echo "docs-lane guard: all ${#} path(s) are under docs/"
    exit "$bad"
    ;;

  # Refuses to proceed when the implementation lane has uncommitted changes to a docs file the docs lane would
  # touch. This is the collision the separate mutex does NOT prevent, so it is checked explicitly.
  conflicts)
    cd "$REPO" || { echo "REFUSED: cannot cd to $REPO"; exit 2; }
    dirty="$(git status --porcelain -- docs/ 2>/dev/null | awk '{print $NF}')"
    if [ -n "$dirty" ]; then
      echo "DOCS_LANE=CONFLICT — the implementation lane has uncommitted docs changes:"
      echo "$dirty" | sed 's/^/  /'
      echo "  The docs lane must wait: a second writer on these files would be lost at the next stash or checkout."
      exit 1
    fi
    echo "DOCS_LANE=CLEAR — no uncommitted docs/ changes in the checkout"
    ;;

  *)
    echo "usage: docs-lane-lock.sh {acquire|heartbeat|release|status|guard <path>...|conflicts}"
    exit 64
    ;;
esac
