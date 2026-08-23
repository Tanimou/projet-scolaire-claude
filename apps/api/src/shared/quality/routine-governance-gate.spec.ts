/**
 * routine-governance-gate.spec.ts — two gates over the ROUTINE ITSELF (S-ROUTINE-1, ADR-069).
 *
 * §1 — THE ROUTINE DOC MUST NOT DRIFT FROM THE INSTALLED SKILL
 * ------------------------------------------------------------
 * The V3 routine exists twice: the INSTALLED copy the scheduled task actually executes
 * (`~/.claude/scheduled-tasks/daily-improvement-v3/SKILL.md`, outside any repo, unversioned) and the TRACKED copy
 * (`docs/daily-improvement-v3/routine/daily-improvement-v3.md`). Only the tracked one has history and review.
 *
 * Measured 2026-08-23: the tracked copy was **143 lines behind** and contained **zero** occurrences of "RULE 0" —
 * the roadmap-first rule added 2026-08-13 was never mirrored, so the versioned record of the routine had not
 * mentioned its single most important rule for eleven days. This is a known recurrence (`PF-58` recorded the same
 * drift once already), which is why it now gets a gate instead of another reminder.
 *
 * WHY THIS GATE SKIPS INSTEAD OF FAILING WHEN THE SKILL IS ABSENT. The installed copy lives in a home directory
 * that exists on exactly one machine. In CI, in a fresh clone, or for any other contributor, there is nothing to
 * compare against — and a gate that fails there would be failing for the absence of a private file, not for drift.
 * It therefore reports INACTIVE, loudly and by name, in the house style already used by the skip-count ratchet
 * (`✓ test-ratchet[api]: … ratchet INACTIVE`). Silence would be the bug; a qualified green is not.
 *
 * §2 — RULE 0's LEDGER VALIDATOR MUST ACTUALLY DISCRIMINATE
 * ---------------------------------------------------------
 * `scripts/roadmap-selection-check.js` is what makes RULE 0 checkable rather than merely reported. Its whole value
 * is the boundary between a ROADMAP id (`PF-01…57`, `LG-xx`, `VAL-xx`) and a self-discovered one (`PF-58+`,
 * `TOOL-xx`) — if that boundary is wrong in either direction the ledger lies, and the rule it enforces is worse
 * than nothing because it looks enforced.
 *
 * The `PF-09` case below is not hypothetical padding of a test: the first version of the regex rejected it, and it
 * was caught by RUNNING the script rather than reading it. `PF-09` is `BROKEN_SECURITY` (privilege escalation), so
 * the bug would have silently excluded a live L0 security finding from counting as roadmap work.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const checker = require('../../../../../scripts/roadmap-selection-check.js');

const REPO_ROOT = join(__dirname, '..', '..', '..', '..', '..');
const TRACKED_DOC = join(REPO_ROOT, 'docs', 'daily-improvement-v3', 'routine', 'daily-improvement-v3.md');
const INSTALLED_SKILL = join(homedir(), '.claude', 'scheduled-tasks', 'daily-improvement-v3', 'SKILL.md');

/** Line endings are not drift. Everything else is. */
const normalise = (s: string) => s.replace(/\r\n/g, '\n').replace(/\s+$/, '');

describe('§1 routine doc ↔ installed SKILL.md', () => {
  it('the tracked routine doc exists and is not a stub', () => {
    expect(existsSync(TRACKED_DOC)).toBe(true);
    expect(readFileSync(TRACKED_DOC, 'utf8').length).toBeGreaterThan(5000);
  });

  it('the tracked routine doc carries RULE 0 — the rule that governs every selection', () => {
    // Guards the SPECIFIC regression measured on 2026-08-23: the tracked copy had zero mentions of RULE 0 while
    // the installed copy had governed 60+ runs with it. This assertion holds even when §1's comparison is INACTIVE,
    // because it reads only the tracked file — so a fresh clone still catches the worst case.
    const doc = readFileSync(TRACKED_DOC, 'utf8');
    expect(doc).toContain('RULE 0');
    expect(doc).toContain('selection-log.jsonl');
  });

  it('does not drift from the installed SKILL.md (INACTIVE where the installed copy is absent)', () => {
    if (!existsSync(INSTALLED_SKILL)) {
      // eslint-disable-next-line no-console
      console.log(
        `✓ routine-doc-sync: INACTIVE — no installed SKILL.md at ${INSTALLED_SKILL}. ` +
          'Drift cannot be measured from this machine; the tracked-copy assertions above still ran.',
      );
      return;
    }
    const tracked = normalise(readFileSync(TRACKED_DOC, 'utf8'));
    const installed = normalise(readFileSync(INSTALLED_SKILL, 'utf8'));
    if (tracked !== installed) {
      const t = tracked.split('\n');
      const i = installed.split('\n');
      const firstDiff = t.findIndex((line, n) => line !== i[n]);
      throw new Error(
        `The tracked routine doc has drifted from the installed SKILL.md.\n` +
          `  tracked  : ${TRACKED_DOC} (${t.length} lines)\n` +
          `  installed: ${INSTALLED_SKILL} (${i.length} lines)\n` +
          `  first difference at line ${firstDiff + 1}:\n` +
          `    tracked  : ${JSON.stringify(t[firstDiff])}\n` +
          `    installed: ${JSON.stringify(i[firstDiff])}\n` +
          `  Fix by copying the installed copy over the tracked one — the installed copy is what actually runs.`,
      );
    }
  });
});

/**
 * §3 — EVERY ROADMAP FINDING MUST HAVE A LEDGER ROW
 *
 * A finding named in an epic's `Closes` column but absent from every ledger file is invisible to run selection and
 * can never be picked up. Measured 2026-08-23: `PF-09` (`BROKEN_SECURITY`, privilege escalation) and `VAL-01` had
 * no row. `PF-09` turned out to be **already closed** by `S-E05-2` — so the gap did not merely hide work to do, it
 * hid work already DONE and under-reported roadmap progress.
 *
 * THE PARSING RULE IS THE POINT, AND IT IS WHY THIS GATE EXISTS RATHER THAN A CHECKLIST. §3 of `OPEN.md` uses a
 * different, 5-column schema whose first cell holds a COMMA-SEPARATED LIST of ids
 * (`| PF-47, LG-12, LG-27, PF-33, PF-41 | V3-E12 | … |`). A reasonable-looking parser that expects one leading id
 * per row silently reports all 23 of those as untriaged — which is exactly what happened during this slice's own
 * analysis, and it nearly produced 23 duplicate rows. The ledger has two schemas; any tool that counts it must
 * read the whole first cell. This gate encodes that rule once so nobody re-derives it wrongly.
 */
describe('§3 roadmap coverage — no finding without a row', () => {
  const D = join(REPO_ROOT, 'docs', 'daily-improvement-v3');
  const LEDGERS = ['OPEN.md', 'CLOSED-L0.md', 'CLOSED-L1.md', 'CLOSED-L2-4.md', 'CLOSED-VAL.md'];
  const ID = /(PF-\d+|LG-\d+|VAL-\d+)/g;

  const roadmapIds = () => {
    const out = new Set<string>();
    for (const line of readFileSync(join(D, 'roadmap.md'), 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\|\s*\*\*(V3-E\d+)\*\*\s*\|([^|]*)\|([^|]*)\|/);
      if (m) (m[3].match(ID) || []).forEach((i) => out.add(i));
    }
    return out;
  };

  /** Reads the WHOLE first cell — grouped rows are rows. */
  const ledgerIds = () => {
    const out = new Set<string>();
    for (const f of LEDGERS) {
      const p = join(D, 'traceability', f);
      if (!existsSync(p)) continue;
      for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
        if (!line.startsWith('|')) continue;
        ((line.split('|')[1] || '').match(ID) || []).forEach((i) => out.add(i));
      }
    }
    return out;
  };

  it('the roadmap names a non-trivial number of findings (anti-vacuity)', () => {
    // Without this, a roadmap.md whose table stopped parsing would make the coverage check pass over an empty set.
    expect(roadmapIds().size).toBeGreaterThanOrEqual(80);
  });

  it('the ledger parser sees grouped rows — the 5-column schema in OPEN.md §3', () => {
    // Non-vacuity for the PARSER itself: these five ids exist only inside a comma-separated first cell. If this
    // assertion ever fails, the coverage result below is meaningless rather than merely wrong.
    const seen = ledgerIds();
    for (const id of ['PF-47', 'LG-12', 'LG-27', 'PF-33', 'PF-41']) expect(seen.has(id)).toBe(true);
  });

  it('every roadmap finding has a row in some ledger file', () => {
    const seen = ledgerIds();
    const missing = [...roadmapIds()].filter((i) => !seen.has(i)).sort();
    if (missing.length) {
      throw new Error(
        `${missing.length} roadmap finding(s) have NO ledger row and are therefore invisible to run selection:\n` +
          `  ${missing.join(', ')}\n` +
          `  Add a row to docs/daily-improvement-v3/traceability/ (OPEN.md, or a CLOSED-*.md if already done).\n` +
          `  Note: a finding can be absent AND already closed — PF-09 was, and the gap under-reported progress.`,
      );
    }
    expect(missing).toEqual([]);
  });
});

describe('§2 RULE 0 ledger validator', () => {
  describe('the roadmap-id boundary', () => {
    const roadmap = ['PF-01', 'PF-09', 'PF-9', 'PF-11', 'PF-40', 'PF-51', 'PF-57', 'LG-01', 'LG-29', 'VAL-01', 'VAL-10'];
    const notRoadmap = ['PF-58', 'PF-59', 'PF-291', 'PF-320', 'TOOL-13', 'TOOL-41', 'PF-00', 'PF-', 'nonsense'];

    it.each(roadmap)('accepts %s as a roadmap id', (id) => {
      expect(checker.ROADMAP_ID.test(id)).toBe(true);
    });

    // The NEGATIVE half is the one that matters: without it, a validator that accepts everything passes the
    // positive cases and the ledger silently counts `TOOL-41` as roadmap progress.
    it.each(notRoadmap)('rejects %s as NOT roadmap work', (id) => {
      expect(checker.ROADMAP_ID.test(id)).toBe(false);
    });

    it('PF-57 and PF-58 fall on opposite sides — the audit-set boundary itself', () => {
      expect(checker.ROADMAP_ID.test('PF-57')).toBe(true);
      expect(checker.ROADMAP_ID.test('PF-58')).toBe(false);
    });
  });

  describe('entry validation', () => {
    const good = {
      run: 79,
      date: '2026-08-23',
      story: 'S-X',
      roadmapIds: ['PF-11'],
      roadmap: true,
      justification: 'x',
    };

    it('accepts a well-formed roadmap entry (the negative control)', () => {
      expect(checker.validate(good)).toEqual([]);
    });

    it('refuses "roadmap: true" with an empty id list — the lie the ledger exists to prevent', () => {
      const problems = checker.validate({ ...good, roadmapIds: [], roadmap: true });
      expect(problems.join(' ')).toMatch(/disagrees with roadmapIds/);
    });

    it('refuses "roadmap: false" while claiming roadmap ids', () => {
      expect(checker.validate({ ...good, roadmap: false }).join(' ')).toMatch(/disagrees with roadmapIds/);
    });

    it('refuses a self-discovered id smuggled into roadmapIds', () => {
      expect(checker.validate({ ...good, roadmapIds: ['PF-320'] }).join(' ')).toMatch(/not roadmap ids/);
    });

    it('refuses a tooling run with no justification naming what it unblocks', () => {
      const problems = checker.validate({ ...good, roadmapIds: [], roadmap: false, justification: '   ' });
      expect(problems.join(' ')).toMatch(/MUST carry a justification/);
    });

    it('accepts a tooling run that DOES justify itself', () => {
      expect(
        checker.validate({ ...good, roadmapIds: [], roadmap: false, justification: 'unblocks S-E03-1' }),
      ).toEqual([]);
    });

    it.each(['run', 'date', 'story', 'roadmapIds', 'roadmap', 'justification'])(
      'refuses an entry missing "%s"',
      (key) => {
        const entry: Record<string, unknown> = { ...good };
        delete entry[key];
        expect(checker.validate(entry).join(' ')).toContain(`missing "${key}"`);
      },
    );
  });

  describe('the verdict, driven through a real ledger file', () => {
    let dir: string;
    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'rule0-'));
    });
    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    const runVerdict = (lines: string[] | null) => {
      const p = join(dir, 'ledger.jsonl');
      if (lines) writeFileSync(p, lines.join('\n') + '\n', 'utf8');
      const prev = process.env.SELECTION_LOG;
      process.env.SELECTION_LOG = p;
      // No module-cache gymnastics: the script resolves its ledger path PER CALL. The first draft of this helper
      // deleted `require.cache` between cases, which does NOT clear jest's own registry — so all four refusal
      // cases silently read the operator's real ledger and returned its pass. The script was fixed rather than
      // the test; a checker whose target cannot be redirected is a checker that cannot be tested.
      const log: string[] = [];
      const spy = jest.spyOn(console, 'log').mockImplementation((...a) => void log.push(a.join(' ')));
      try {
        return { code: checker.verdict(), out: log.join('\n') };
      } finally {
        spy.mockRestore();
        if (prev === undefined) delete process.env.SELECTION_LOG;
        else process.env.SELECTION_LOG = prev;
      }
    };

    it('an ABSENT ledger fails safe TOWARD roadmap work, it does not pass', () => {
      const { code, out } = runVerdict(null);
      expect(code).toBe(1);
      expect(out).toContain('MUST-SELECT-ROADMAP');
    });

    it('a previous ROADMAP run permits this run to choose freely', () => {
      const { code, out } = runVerdict([
        JSON.stringify({ run: 1, date: 'd', story: 's', roadmapIds: ['PF-11'], roadmap: true, justification: 'j' }),
      ]);
      expect(code).toBe(0);
      expect(out).toContain('RULE0: OK');
    });

    it('a previous TOOLING run FORCES roadmap work — clause 4, the whole point', () => {
      const { code, out } = runVerdict([
        JSON.stringify({ run: 1, date: 'd', story: 's', roadmapIds: [], roadmap: false, justification: 'unblocks X' }),
      ]);
      expect(code).toBe(1);
      expect(out).toContain('MUST-SELECT-ROADMAP');
      // Case-insensitive on purpose: the refusal must CITE the clause, but the prose capitalises it at the start
      // of a sentence. Asserting the exact casing would couple this gate to sentence position, not to meaning.
      expect(out).toMatch(/clause 4/i);
    });

    it('reads the LAST entry, not the first — a stale green cannot mask a fresh tooling run', () => {
      const { code } = runVerdict([
        JSON.stringify({ run: 1, date: 'd', story: 's', roadmapIds: ['PF-11'], roadmap: true, justification: 'j' }),
        JSON.stringify({ run: 2, date: 'd', story: 's', roadmapIds: [], roadmap: false, justification: 'unblocks X' }),
      ]);
      expect(code).toBe(1);
    });

    it('refuses to rule on a malformed last entry rather than guessing', () => {
      const { code, out } = runVerdict([
        JSON.stringify({ run: 1, date: 'd', story: 's', roadmapIds: [], roadmap: true, justification: 'j' }),
      ]);
      expect(code).toBe(1);
      expect(out).toContain('LEDGER-INVALID');
    });
  });
});
