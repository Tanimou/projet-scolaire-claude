#!/usr/bin/env bash
# =============================================================================
# routine-lock.sh — concurrency + disk guard for the Daily-Improvement v2/v3
# scheduled routine. Coordinates INDEPENDENT scheduled Claude sessions (which
# share one repo checkout) so that:
#   • at most ONE session ever writes/builds at a time   (write.lock, cap 1)
#   • at most MAX_INFLIGHT routine PRs are open at once   (disk + review guard)
#   • merged/closed routine branches+worktrees are cleaned every run
#   • a crashed run's lock is reclaimed after STALE_MIN and its checkout salvaged
#
# WHY a single write lock: the BMAD workflow agents edit the MAIN checkout (not
# an isolated worktree), so two concurrent writers would clobber each other and
# race .git. We therefore run each sprint on a feature branch IN the main
# checkout, serialized by write.lock — which also reuses the warm Turbo build
# cache and never duplicates .next/dist across worktrees (bounds disk C:).
#
# State lives OUTSIDE the repo (survives any `git checkout`) at:
#   ~/.claude/scheduled-tasks/daily-improvement-v2/state
#
# Usage (called by the SKILL on each run):
#   routine-lock.sh gate        # cleanup + capacity check + ACQUIRE write.lock
#                               #  -> prints GATE=OK|FULL|BUSY and BRANCHDATE; exit 0/10/20
#   routine-lock.sh heartbeat   # refresh write.lock heartbeat (call between phases)
#   routine-lock.sh release     # release write.lock (after PR pushed, or on abort)
#   routine-lock.sh cleanup     # remove merged/closed ci/* branches + worktrees
#   routine-lock.sh status      # human-readable state dump
# =============================================================================
set -uo pipefail

REPO="${ROUTINE_REPO:-/c/Users/HP/Downloads/pilotage-scolaire-claude}"
STATE="${ROUTINE_STATE:-$HOME/.claude/scheduled-tasks/daily-improvement-v2/state}"
WLOCK="$STATE/write.lock"
LOG="$STATE/runs.log"

MAX_INFLIGHT="${ROUTINE_MAX_INFLIGHT:-2}"   # max open routine PRs (incl. the one being made)
STALE_MIN="${ROUTINE_STALE_MIN:-60}"        # reclaim write.lock if heartbeat older than this
BUILD_WAIT_SEC="${ROUTINE_BUILD_WAIT:-90}"  # bounded wait for write.lock before deferring

mkdir -p "$STATE/slots" 2>/dev/null
now() { date +%s; }
stamp() { date '+%Y-%m-%d %H:%M:%S'; }
logline() { echo "$(stamp) | $*" >> "$LOG"; }

have_gh() { command -v gh >/dev/null 2>&1; }

# PR state for a branch: prints OPEN|MERGED|CLOSED|"" (empty = no PR / gh unavailable)
pr_state() {
  local br="$1"
  have_gh || { echo ""; return; }
  gh -R Tanimou/projet-scolaire-claude pr list --head "$br" --state all \
     --json state --jq '.[0].state' 2>/dev/null | tr -d '\r'
}

# worktree path checked out at branch $1 (empty if none)
worktree_of() {
  local br="$1" line wt=""
  while IFS= read -r line; do
    case "$line" in
      worktree\ *) wt="${line#worktree }";;
      branch\ refs/heads/"$br") echo "$wt"; return;;
    esac
  done < <(git -C "$REPO" worktree list --porcelain 2>/dev/null)
}

# Remove merged/closed routine branches and any linked worktrees.
cleanup() {
  git -C "$REPO" fetch --prune --quiet origin 2>/dev/null
  local br st wt removed=0
  while IFS= read -r br; do
    [ -n "$br" ] || continue
    st="$(pr_state "$br")"
    if [ "$st" = "MERGED" ] || [ "$st" = "CLOSED" ]; then
      wt="$(worktree_of "$br")"
      if [ -n "$wt" ] && [ "$wt" != "$REPO" ]; then
        if [ -z "$(git -C "$wt" status --porcelain 2>/dev/null)" ]; then
          git -C "$REPO" worktree remove --force "$wt" 2>/dev/null \
            && logline "cleanup: removed worktree $wt ($br, PR $st)"
        else
          logline "cleanup: KEPT dirty worktree $wt ($br) — manual check"
          continue
        fi
      fi
      git -C "$REPO" branch -D "$br" 2>/dev/null \
        && { logline "cleanup: deleted branch $br (PR $st)"; removed=$((removed+1)); }
    fi
  done < <(git -C "$REPO" for-each-ref --format='%(refname:short)' refs/heads/ci/ 2>/dev/null)
  git -C "$REPO" worktree prune 2>/dev/null
  echo "$removed"
}

# Count routine branches whose PR is OPEN (in-flight awaiting merge).
count_inflight() {
  local br st n=0
  while IFS= read -r br; do
    [ -n "$br" ] || continue
    st="$(pr_state "$br")"
    [ "$st" = "OPEN" ] && n=$((n+1))
  done < <(git -C "$REPO" for-each-ref --format='%(refname:short)' refs/heads/ci/ 2>/dev/null)
  echo "$n"
}

lock_fresh() {  # 0 if write.lock exists and heartbeat is fresh
  [ -d "$WLOCK" ] || return 1
  local hb; hb="$(cat "$WLOCK/heartbeat" 2>/dev/null || echo 0)"
  [ $(( $(now) - hb )) -le $(( STALE_MIN * 60 )) ]
}

acquire_write() {  # 0 acquired, 2 timed out (someone else building)
  local waited=0
  while : ; do
    if mkdir "$WLOCK" 2>/dev/null; then
      now > "$WLOCK/started"; now > "$WLOCK/heartbeat"; echo "$$" > "$WLOCK/pid"
      return 0
    fi
    if ! lock_fresh; then
      logline "reaped stale write.lock (pid $(cat "$WLOCK/pid" 2>/dev/null))"
      rm -rf "$WLOCK"; continue
    fi
    [ "$waited" -ge "$BUILD_WAIT_SEC" ] && return 2
    sleep 15; waited=$((waited+15))
  done
}

ensure_clean_main() {  # after acquiring the lock, guarantee a clean main checkout
  local cur; cur="$(git -C "$REPO" rev-parse --abbrev-ref HEAD 2>/dev/null)"
  if [ "$cur" != "main" ] || [ -n "$(git -C "$REPO" status --porcelain --untracked-files=no 2>/dev/null)" ]; then
    git -C "$REPO" stash push -m "routine-salvage-$(now)" 2>/dev/null \
      && logline "salvaged crashed-run tracked changes to a stash"
    git -C "$REPO" checkout main 2>/dev/null || git -C "$REPO" checkout -f main
  fi
  git -C "$REPO" pull --ff-only --quiet 2>/dev/null || true
}

case "${1:-status}" in
  gate)
    rm=$(cleanup)
    inflight=$(count_inflight)
    if [ "$inflight" -ge "$MAX_INFLIGHT" ]; then
      logline "GATE=FULL inflight=$inflight max=$MAX_INFLIGHT (cleaned=$rm) — skipping tick"
      echo "GATE=FULL INFLIGHT=$inflight MAX=$MAX_INFLIGHT CLEANED=$rm"
      exit 10
    fi
    if acquire_write; then
      ensure_clean_main
      logline "GATE=OK acquired write.lock inflight=$inflight (cleaned=$rm)"
      echo "GATE=OK INFLIGHT=$inflight MAX=$MAX_INFLIGHT CLEANED=$rm BRANCHDATE=$(date +%Y-%m-%d)"
      exit 0
    else
      logline "GATE=BUSY write.lock held by an active build — deferring tick"
      echo "GATE=BUSY REASON=another-session-is-building"
      exit 20
    fi
    ;;
  heartbeat) [ -d "$WLOCK" ] && now > "$WLOCK/heartbeat" && echo "heartbeat ok" || echo "no lock held";;
  release)
    if [ -d "$WLOCK" ]; then rm -rf "$WLOCK"; logline "released write.lock"; echo "released"; else echo "no lock"; fi
    ;;
  cleanup) echo "cleaned $(cleanup) merged/closed routine branch(es)";;
  status)
    echo "REPO=$REPO"
    echo "STATE=$STATE"
    echo "MAX_INFLIGHT=$MAX_INFLIGHT STALE_MIN=$STALE_MIN BUILD_WAIT_SEC=$BUILD_WAIT_SEC"
    if [ -d "$WLOCK" ]; then
      echo -n "write.lock=HELD since=$(cat "$WLOCK/started" 2>/dev/null) hb_age_s="
      echo $(( $(now) - $(cat "$WLOCK/heartbeat" 2>/dev/null || now) ))
    else echo "write.lock=free"; fi
    echo "inflight_open_PRs=$(count_inflight)"
    echo "--- ci/* branches ---"
    git -C "$REPO" for-each-ref --format='%(refname:short)' refs/heads/ci/ 2>/dev/null | while read -r b; do
      echo "  $b  PR=$(pr_state "$b")  worktree=$(worktree_of "$b")"
    done
    ;;
  *) echo "usage: routine-lock.sh {gate|heartbeat|release|cleanup|status}"; exit 64;;
esac
