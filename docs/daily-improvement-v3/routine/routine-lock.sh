#!/usr/bin/env bash
# =============================================================================
# Daily Improvement V3 — lock wrapper
# -----------------------------------------------------------------------------
# V3 deliberately DOES NOT create its own write.lock.
#
# Both routines operate on the SAME main checkout
# (C:\Users\HP\Downloads\pilotage-scolaire-claude). A second, independent lock
# would defeat the single-writer guarantee that V2's guard exists to provide:
# two runs could each hold "their own" lock and clobber each other's branch and
# .git state — exactly the pile-up V2's guard was written to prevent.
#
# So V3 delegates verbatim to V2's routine-lock.sh, which means:
#   * one machine-wide write.lock shared by V2 and V3;
#   * one shared in-flight PR cap across both routines (they both use ci/*);
#   * one shared stale-reaper.
#
# V3 keeps only its own run log, so the two routines' histories stay readable.
#
# V2's script is NOT modified by this wrapper.
#
# Usage (identical surface to V2):
#   routine-lock.sh gate | heartbeat | release | cleanup | status
# =============================================================================
set -uo pipefail

V2_LOCK="$HOME/.claude/scheduled-tasks/daily-improvement-v2/routine-lock.sh"
V3_STATE="$HOME/.claude/scheduled-tasks/daily-improvement-v3/state"
V3_LOG="$V3_STATE/runs.log"

if [ ! -x "$V2_LOCK" ]; then
  echo "GATE=ERROR reason=v2-lock-script-missing path=$V2_LOCK" >&2
  echo "Daily Improvement V3 requires the V2 lock script to be present and executable." >&2
  exit 1
fi

mkdir -p "$V3_STATE"

ACTION="${1:-status}"

# Record V3's own view of the run, then delegate. The shared lock lives in V2's
# state dir on purpose (see header).
printf '%s v3 %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$ACTION" >> "$V3_LOG" 2>/dev/null || true

exec "$V2_LOCK" "$@"
