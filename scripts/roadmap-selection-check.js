#!/usr/bin/env node
/**
 * roadmap-selection-check.js — makes RULE 0 mechanically checkable.
 *
 * WHY THIS EXISTS, AND WHY IT IS NOT IN `routine-lock.sh`
 * ------------------------------------------------------
 * RULE 0 ("the roadmap comes first") was added 2026-08-13 and did not work. Measured over the full V3 window
 * (2026-08-02 → 2026-08-23, 77 runs): 119 findings closed, of which **13** were roadmap findings — 0.17 per run
 * against 1.38 self-generated closures per run. The rule failed structurally, not through negligence:
 *
 *   - it asked the run to *report* the ratio at **Step 8**, after the work was chosen, done and merged, when the
 *     number can no longer change anything;
 *   - it asked each run to re-derive the previous run's ratio from PR titles — slow, silently skippable, and
 *     leaving no artefact, so "never two consecutive tooling-only runs" was never checkable by anybody.
 *
 * A rule enforced only by a retrospective report is a measurement, not a gate.
 *
 * **This checker is deliberately NOT part of `routine-lock.sh`.** The lock is a mutex; a policy check inside a
 * mutex is a policy check that can wedge every future run. `routine-lock.sh` is shared with V2 and is the single
 * thing standing between the routine and a corrupted checkout — it stays boring. If this script throws, the
 * worst case is one run without a RULE 0 verdict. If the lock throws, nothing runs again.
 *
 * THE LEDGER LIVES OUTSIDE THE CHECKOUT — ON PURPOSE
 * --------------------------------------------------
 * `~/.claude/scheduled-tasks/daily-improvement-v3/state/selection-log.jsonl` must be writable while another run
 * holds the write lock, must survive branch switches, and must survive the gate's salvage-stash (which has eaten
 * uncommitted work before). An in-repo ledger would satisfy none of those. The CHECKER is versioned; the LEDGER
 * is not, and that asymmetry is the decision (ADR-069).
 *
 * USAGE
 *   node scripts/roadmap-selection-check.js                 # verdict for the run about to select. Exit 1 = MUST pick roadmap.
 *   node scripts/roadmap-selection-check.js --last          # print the last entry, exit 0
 *   node scripts/roadmap-selection-check.js --append '<json>'  # append one validated entry
 *   node scripts/roadmap-selection-check.js --stats         # roadmap/tooling ratio across the whole ledger
 *
 * `SELECTION_LOG` overrides the ledger path (used by the spec; NOT a bypass — it changes which ledger is read,
 * never the verdict for a given ledger).
 *
 * There is deliberately NO skip/override/NODE_ENV flag (DNC-10). A rule with an escape hatch is a suggestion.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/**
 * Resolved PER CALL, not frozen at import.
 *
 * This started as a module-level `const` and that was a real defect, caught by the spec rather than by reading:
 * an env-dependent value captured at import time cannot be redirected by any caller that has already loaded the
 * module — and under jest, `delete require.cache[id]` does not clear jest's own module registry, so every
 * redirected-ledger case silently read the OPERATOR'S REAL LEDGER and returned its verdict. Four assertions that
 * each expected a refusal all got a pass, for the same reason, and the fix belongs here rather than in test
 * gymnastics: a checker whose target cannot be redirected is a checker that cannot be tested.
 */
function ledgerPath() {
  return (
    process.env.SELECTION_LOG ||
    path.join(os.homedir(), '.claude', 'scheduled-tasks', 'daily-improvement-v3', 'state', 'selection-log.jsonl')
  );
}

/**
 * A ROADMAP finding is an id named in the `Closes` column of an epic row in roadmap.md — `PF-01…PF-57`, `LG-xx`,
 * `VAL-xx`. Everything else (`PF-58+`, `TOOL-xx`) is self-discovered and is NOT roadmap work.
 *
 * The `0?` is load-bearing and was a real bug caught by running this script rather than reading it: the audit
 * writes the first nine as ZERO-PADDED (`PF-01`…`PF-09`), and a `[0-9]` branch matches the `0` and then chokes on
 * the second digit, so `PF-09` — a `BROKEN_SECURITY` privilege-escalation finding — was rejected as "not a roadmap
 * id". The upper bound still has to exclude `PF-58+`, so `5[0-7]` cannot become `5[0-9]`.
 */
const ROADMAP_ID = /^(PF-(?:0?[1-9]|[1-4][0-9]|5[0-7])|LG-\d+|VAL-\d+)$/;

function readEntries() {
  if (!fs.existsSync(ledgerPath())) return null; // absent ledger is a state, not an error — see verdict()
  return fs
    .readFileSync(ledgerPath(), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '')
    .map((l, i) => {
      try {
        return JSON.parse(l);
      } catch {
        throw new Error(`ledger line ${i + 1} is not valid JSON — the ledger is append-only, never hand-edited`);
      }
    });
}

/**
 * Validates one entry. `roadmap` must AGREE with `roadmapIds`, because the whole ledger is worthless if a run can
 * write `roadmap: true` with an empty id list.
 */
function validate(entry) {
  const problems = [];
  for (const k of ['run', 'date', 'story', 'roadmapIds', 'roadmap', 'justification']) {
    if (entry[k] === undefined) problems.push(`missing "${k}"`);
  }
  if (Array.isArray(entry.roadmapIds)) {
    const bad = entry.roadmapIds.filter((i) => !ROADMAP_ID.test(i));
    if (bad.length) problems.push(`not roadmap ids (PF-01..57 / LG-xx / VAL-xx): ${bad.join(', ')}`);
    const claims = entry.roadmapIds.length > 0;
    if (entry.roadmap !== claims) {
      problems.push(`"roadmap": ${entry.roadmap} disagrees with roadmapIds (${entry.roadmapIds.length} ids)`);
    }
  }
  if (entry.roadmap === false && !String(entry.justification || '').trim()) {
    problems.push('a non-roadmap run MUST carry a justification naming the roadmap story it unblocks');
  }
  return problems;
}

function verdict() {
  const entries = readEntries();

  if (entries === null) {
    // Fail SAFE, toward roadmap work. An absent ledger most often means a fresh machine or a lost state dir —
    // and the cheapest wrong answer is "do roadmap work", never "tooling is fine".
    console.log('RULE0: MUST-SELECT-ROADMAP — no ledger at ' + ledgerPath());
    console.log('  An absent ledger is treated as "previous run was NOT roadmap". Create it by appending this');
    console.log('  run\'s entry at Step 1. This fails safe toward the roadmap by design.');
    return 1;
  }
  if (entries.length === 0) {
    console.log('RULE0: MUST-SELECT-ROADMAP — ledger is empty.');
    return 1;
  }

  const last = entries[entries.length - 1];
  const problems = validate(last);
  if (problems.length) {
    console.log(`RULE0: LEDGER-INVALID — last entry (run ${last.run ?? '?'}) is malformed:`);
    problems.forEach((p) => console.log(`  - ${p}`));
    console.log('  Refusing to give a verdict from an entry that cannot be trusted. Append a corrected entry.');
    return 1;
  }

  if (last.roadmap === true) {
    console.log(`RULE0: OK — run ${last.run} was roadmap work (${last.roadmapIds.join(', ')}).`);
    console.log('  This run may select tooling ONLY under clause 5 (it must BLOCK a named roadmap story).');
    return 0;
  }

  console.log(`RULE0: MUST-SELECT-ROADMAP — run ${last.run} closed no roadmap finding.`);
  console.log(`  Its justification was: ${last.justification}`);
  console.log('  Clause 4: two consecutive tooling-only runs are forbidden outright, whatever their merit.');
  console.log('  Select a ROADMAP finding, or demonstrate story by story in the run log that every unblocked');
  console.log('  candidate is genuinely blocked. "Another epic was already in progress" is not a demonstration.');
  return 1;
}

function stats() {
  const entries = readEntries() || [];
  const road = entries.filter((e) => e.roadmap === true).length;
  const tool = entries.length - road;
  const ids = new Set(entries.flatMap((e) => e.roadmapIds || []));
  console.log(`ledger entries: ${entries.length}`);
  console.log(`  roadmap runs: ${road}`);
  console.log(`  tooling runs: ${tool}`);
  console.log(`  distinct roadmap ids touched: ${ids.size}${ids.size ? ' — ' + [...ids].join(', ') : ''}`);
  let worst = 0;
  let cur = 0;
  for (const e of entries) {
    cur = e.roadmap === true ? 0 : cur + 1;
    worst = Math.max(worst, cur);
  }
  console.log(`  longest consecutive tooling-only streak: ${worst}${worst >= 2 ? '  ← RULE 0 clause 4 violation' : ''}`);
  return worst >= 2 ? 1 : 0;
}

function append(raw) {
  let entry;
  try {
    entry = JSON.parse(raw);
  } catch (e) {
    console.error(`REFUSED: --append needs valid JSON (${e.message})`);
    return 2;
  }
  const problems = validate(entry);
  if (problems.length) {
    console.error('REFUSED: entry is invalid —');
    problems.forEach((p) => console.error(`  - ${p}`));
    return 2;
  }
  fs.mkdirSync(path.dirname(ledgerPath()), { recursive: true });
  fs.appendFileSync(ledgerPath(), JSON.stringify(entry) + '\n', 'utf8');
  console.log(`appended run ${entry.run} (roadmap=${entry.roadmap}) to ${ledgerPath()}`);
  return 0;
}

// The CLI runs ONLY when invoked directly. Without this guard `require()` would execute the whole command line —
// and the `process.exit()` below would make the exports unreachable, so the spec could not import anything and a
// reader importing this module would silently kill their own process.
if (require.main === module) {
  const argv = process.argv.slice(2);
  let code;
  if (argv[0] === '--append') code = append(argv[1] ?? '');
  else if (argv[0] === '--last') {
    const e = readEntries();
    console.log(e && e.length ? JSON.stringify(e[e.length - 1], null, 1) : 'no entries');
    code = 0;
  } else if (argv[0] === '--stats') code = stats();
  else code = verdict();

  process.exit(code);
}

module.exports = { validate, verdict, stats, append, readEntries, ROADMAP_ID, ledgerPath };
