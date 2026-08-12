import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

/**
 * S-E05-1 — guard for the CSV-escaper ratchet (`scripts/csv-escape-check.js`).
 *
 * WHY THIS FILE EXISTS SEPARATELY FROM THE SCRIPT
 * -----------------------------------------------
 * The script's exit code is the gate. This file is what makes the gate
 * *trustworthy*: it drives the pure core in BOTH directions, proves each of its
 * five rules can independently go RED, proves it FAILS when it cannot run
 * (DNC-08) rather than passing over nothing, proves nothing can turn it off
 * (DNC-10), and proves it is still wired into both harnesses.
 *
 * *"An assertion about a gate that cannot fail is not an assertion"* (`R-30`).
 * Every rule below has its own driven mutation, and §6 runs the REAL script over
 * a REAL probe file so the red is observed rather than argued.
 *
 * WHY IT LIVES IN `apps/api`, NOT `apps/worker`
 * ---------------------------------------------
 * `docs/spec/features/v3-e05/stories/S-E05-1.md` §5 T-4 says to place this
 * "under `apps/worker/src/` (mirroring how `audit-write-gate.spec.ts` drives
 * `scripts/audit-write-check.js`)" — and then instructs the implementer to
 * **verify that precedent's actual location before choosing yours, and follow
 * it**. Verified: `audit-write-gate.spec.ts` lives at
 * `apps/api/src/shared/quality/`, not in `apps/worker`. The parenthetical was
 * wrong and the instruction was right, so this file sits beside its precedent.
 * Both runners are inside `scripts/test-ratchet.js`, both jest configs map
 * `@pilotage/contracts` to SOURCE, and the gate under test is repo-wide rather
 * than worker-specific — so nothing about the evidence changes with the address.
 *
 * WHAT THIS SLICE MEASURED, WITH ITS ROOT
 * ---------------------------------------
 * Walk root `apps/web/src` + `apps/worker/src` + `apps/api/src` +
 * `packages/contracts/src` + `packages/ui/src` + `packages/imports-core/src`,
 * production `.ts` AND `.tsx`, excluding specs: **4** CSV escapers after
 * `S-E05-1` — the 2 sanctioned ones, and the 2 `apps/api` transport-CSV sites
 * that are named exclusions.
 *
 * LEDGER DISAGREEMENT, RECORDED
 * -----------------------------
 * `audit-findings-index.md`'s `PF-168` row says the real count of `csvEscape`
 * copies is **2**. Measured at `8e52da0` it was **3**, and counting the two
 * `escapeCell` copies on the parent portal the real number of CSV escapers was
 * **5**. The finding undercounted itself because it grepped for the NAME
 * `csvEscape` — which is precisely why rule A of this gate matches on SHAPE as
 * well as on name, and why that widening is asserted below rather than left as a
 * private improvement.
 */

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..', '..');
const SCRIPT_PATH = join(REPO_ROOT, 'scripts', 'csv-escape-check.js');
const GATE_PATH = join(REPO_ROOT, 'scripts', 'ci-gate.sh');
const WORKFLOW_PATH = join(REPO_ROOT, '.github', 'workflows', 'ci.yml');
const PREDICATE_PATH = join(REPO_ROOT, 'packages', 'contracts', 'src', 'security', 'csv-injection.ts');

/* eslint-disable @typescript-eslint/no-require-imports */
// Unguarded on purpose (DNC-08): if the script disappears this suite must fail
// at LOAD rather than degrade into "nothing to check, therefore pass".
const gate = require(SCRIPT_PATH) as {
  WALK_ROOTS: string[];
  PREDICATE_REL: string;
  SECURITY_INDEX_REL: string;
  REQUIRED_PREDICATE_EXPORTS: string[];
  CONTRACTS_SPECIFIER: string;
  SHARED_FUNCTION: string;
  SANCTIONED: Record<string, string>;
  EXCLUDED: Record<string, string>;
  MIN_SANCTIONED_ESCAPERS: number;
  ESCAPER_NAME: RegExp;
  TRIGGER_CHARACTERS: string[];
  loadTypeScript: () => any;
  isProductionSource: (name: string) => boolean;
  walkRoot: (absolute: string) => string[];
  extractFromSource: (
    ts: any,
    relPath: string,
    source: string,
  ) => {
    escapers: Array<{
      file: string;
      symbol: string;
      line: number;
      key: string;
      detectedBy: string;
      callsShared: boolean;
    }>;
    triggerLiterals: Array<{ file: string; line: number; how: string }>;
    importsShared: boolean;
    reExportsPredicate: boolean;
    exportedNames: Set<string>;
  };
  evaluateCsvEscapers: (input: {
    escapers: unknown[];
    triggerLiterals: unknown[];
    sanctioned?: Record<string, string>;
    excluded?: Record<string, string>;
  }) => { problems: string[]; stats: Record<string, number> };
};
const ts = gate.loadTypeScript();
/* eslint-enable @typescript-eslint/no-require-imports */

/** Extract from a synthetic source; the file name is fictional and that is fine. */
function extract(source: string, relPath = 'apps/web/src/fixture.ts') {
  return gate.extractFromSource(ts, relPath, source);
}

/** A sanctioned-shaped escaper record, so a rule-A case tests only rule A. */
const SANCTIONED_KEYS = Object.keys(gate.SANCTIONED);
const WEB_KEY = 'apps/web/src/lib/csv.ts#csvEscape';
const WORKER_KEY = 'apps/worker/src/modules/exports/generators/audit-csv.generator.ts#csvEscape';

function sanctionedRecord(key: string, overrides: Record<string, unknown> = {}) {
  return {
    file: key.split('#')[0],
    symbol: 'csvEscape',
    line: 1,
    key,
    detectedBy: 'name+shape',
    callsShared: true,
    fileImportsShared: true,
    ...overrides,
  };
}

/** Both sanctioned escapers, clean — the floor of a GREEN evaluation. */
const CLEAN_PAIR = [sanctionedRecord(WEB_KEY), sanctionedRecord(WORKER_KEY)];

/**
 * Drives the reconciler with the real SANCTIONED set and an EMPTY excluded set.
 *
 * The empty exclusion set is deliberate, and it is the same discipline
 * `audit-write-gate.spec.ts` applies with its `CLEAN_CALL`: the two real
 * exclusions live in `apps/api`, which a synthetic escaper list does not
 * contain, so leaving them in would make every rule-A/B/C case *also* emit two
 * rule-D staleness problems — and a test asserting "1 problem" would then be
 * asserting three rules at once. Rule D against the real exclusions is driven
 * separately, in §5.
 */
function evaluate(escapers: unknown[], triggerLiterals: unknown[] = []) {
  return gate.evaluateCsvEscapers({ escapers, triggerLiterals, excluded: {} });
}

/* ================================================================== *
 * 0 — the module contract (the family's idiom, pinned)
 * ================================================================== */

describe('the module contract', () => {
  it('the script exists and requiring it has NO side effect — main() is guarded', () => {
    expect(existsSync(SCRIPT_PATH)).toBe(true);
    const probe = spawnSync(
      process.execPath,
      ['-e', `require(${JSON.stringify(SCRIPT_PATH)}); process.exit(0);`],
      { encoding: 'utf8' },
    );
    expect(probe.status).toBe(0);
    expect(probe.stdout).not.toContain('CSV ESCAPE CHECK');
    expect(readFileSync(SCRIPT_PATH, 'utf8')).toContain('if (require.main === module) main();');
  });

  it('exports the pure core, so every rule can be driven without a bypass flag existing', () => {
    for (const name of [
      'extractFromSource',
      'evaluateCsvEscapers',
      'walkRoot',
      'loadTypeScript',
      'isProductionSource',
    ] as const) {
      expect(typeof gate[name]).toBe('function');
    }
  });

  it('the walk root is DECLARED as data and spans all six source trees', () => {
    expect(gate.WALK_ROOTS).toEqual([
      'apps/web/src',
      'apps/worker/src',
      'apps/api/src',
      'packages/contracts/src',
      'packages/ui/src',
      'packages/imports-core/src',
    ]);
  });

  it('parses with the TypeScript compiler, never with a regex', () => {
    // Measured reason, not taste: four files in this repo QUOTE the trigger
    // array in prose to explain it (the script header, csv-injection.ts's doc
    // comment, apps/web/src/lib/csv.ts's doc comment, ADR-037 D7). A regex gate
    // would report rule-B violations at lines holding no code, and the pressure
    // would then be to weaken rule B rather than to fix anything (R-30).
    expect(readFileSync(SCRIPT_PATH, 'utf8')).toContain("require('typescript')");
    expect(typeof ts.createSourceFile).toBe('function');
  });

  it('there is NO baseline file, and that is a decision — the ceiling is two rows', () => {
    const source = readFileSync(SCRIPT_PATH, 'utf8');
    expect(SANCTIONED_KEYS).toHaveLength(2);
    expect(existsSync(join(REPO_ROOT, 'scripts', 'csv-escape-baseline.json'))).toBe(false);
    expect(source).toContain('no baseline file');
  });
});

/* ================================================================== *
 * 1 — the walk: .tsx is in, and that is the point
 * ================================================================== */

describe('the walk root includes .tsx — the S-E06-5 lesson at a third address', () => {
  it('accepts .ts AND .tsx, and rejects specs and declaration files', () => {
    // THREE of the five copies S-E05-1 deleted lived in .tsx components
    // (AlertsExportButton, parent/grades/GradesExport, parent/attendance/
    // AttendanceExport). A .ts-only walk would be blind to the exact defect
    // being closed while printing PASS.
    expect(gate.isProductionSource('csv.ts')).toBe(true);
    expect(gate.isProductionSource('AlertsExportButton.tsx')).toBe(true);
    expect(gate.isProductionSource('csv.spec.ts')).toBe(false);
    expect(gate.isProductionSource('Button.spec.tsx')).toBe(false);
    expect(gate.isProductionSource('generated.d.ts')).toBe(false);
  });

  it('really parses TSX — a component body is not a syntax error', () => {
    const result = extract(
      `
      export function Row() {
        const escapeCell = (v: string) => (/[",;\\r\\n]/.test(v) ? \`"\${v.replace(/"/g, '""')}"\` : v);
        return <div>{escapeCell('x')}</div>;
      }
      `,
      'apps/web/src/app/parent/grades/GradesExport.tsx',
    );
    // If TSX were parsed as TS the `<div>` would be read as a type assertion and
    // the declaration below it would be lost — a silently-empty result.
    expect(result.escapers.map((e) => e.symbol)).toEqual(['escapeCell']);
  });
});

/* ================================================================== *
 * 2 (AC-7) — rule A goes red, by NAME and by SHAPE
 * ================================================================== */

describe('AC-7 — rule A: no fourth escaper', () => {
  it('RED on an unsanctioned csvEscape, and the message names the rule and the file', () => {
    const rogue = {
      file: 'apps/web/src/app/admin/x/XExport.tsx',
      symbol: 'csvEscape',
      line: 12,
      key: 'apps/web/src/app/admin/x/XExport.tsx#csvEscape',
      detectedBy: 'name',
      callsShared: false,
      fileImportsShared: false,
    };
    const { problems } = evaluate([...CLEAN_PAIR, rogue]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('RULE A (a fourth CSV escaper)');
    expect(problems[0]).toContain('apps/web/src/app/admin/x/XExport.tsx:12');
    expect(problems[0]).toContain('2 is the ceiling');
  });

  it('GREEN on exactly the two sanctioned escapers — the control', () => {
    expect(evaluate(CLEAN_PAIR).problems).toEqual([]);
  });

  it('detects a copy by NAME — including `escapeCell`, which FR-5 as written would miss', () => {
    // The widening is the finding turned into a rule. PF-168 reported "2 copies"
    // because it grepped for `csvEscape`; two further copies were called
    // `escapeCell`. A gate built to the story's literal regex would inherit the
    // finding's own blind spot.
    for (const name of ['csvEscape', 'escapeCsv', 'csv_escape', 'escapeCell', 'cellEscape']) {
      expect(gate.ESCAPER_NAME.test(name)).toBe(true);
    }
    for (const name of ['escape', 'escapeHtml', 'cellRenderer', 'csvRow']) {
      expect(gate.ESCAPER_NAME.test(name)).toBe(false);
    }
  });

  it('detects a copy by SHAPE even when it is called something innocuous', () => {
    // The failure mode a name-only rule invites the moment it is documented:
    // rename the function and the gate goes quiet.
    const result = extract(`
      export function sanitiseValue(v: string): string {
        return /[",;\\n\\r]/.test(v) ? \`"\${v.replace(/"/g, '""')}"\` : v;
      }
    `);
    expect(result.escapers).toHaveLength(1);
    expect(result.escapers[0]!.detectedBy).toBe('shape');
    expect(result.escapers[0]!.symbol).toBe('sanitiseValue');
  });

  it('does NOT fire on `.replace(/"/g, \'&quot;\')` — the three e-mail templates are not escapers', () => {
    // Measured: apps/worker's digest/notification templates HTML-escape quotes.
    // The conjunction (a `"`-bearing character class AND the quote DOUBLING) is
    // what separates an RFC-4180 escaper from ordinary sanitisation. Without
    // this the gate would be permanently red on correct code, and the pressure
    // would be to delete the rule (R-30).
    const result = extract(`
      export function escapeHtml(v: string): string {
        return v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/[<>]/g, '');
      }
    `);
    expect(result.escapers).toEqual([]);
  });

  it('attributes the shape to the INNERMOST declaration, so one copy is never two rows', () => {
    // Measured while building this gate: descending through function boundaries
    // reported FOUR escapers in apps/api instead of two — the arrow, and again
    // the method that merely contains it. One copy would then need two exclusion
    // rows, and deleting the arrow would leave one of them permanently stale.
    const result = extract(
      `
      export function rowsToCsv(headers: string[]): string {
        const escape = (v: string) => (/[",\\n\\r]/.test(v) ? \`"\${v.replace(/"/g, '""')}"\` : v);
        return headers.map(escape).join(',');
      }
      `,
      'apps/api/src/modules/integrations/oneroster.adapter.ts',
    );
    expect(result.escapers).toHaveLength(1);
    expect(result.escapers[0]!.key).toBe('apps/api/src/modules/integrations/oneroster.adapter.ts#escape');
  });
});

/* ================================================================== *
 * 3 (AC-7) — rule B: the predicate may be assembled in ONE file
 * ================================================================== */

describe('AC-7 — rule B: no re-inlined trigger predicate', () => {
  it('RED on a trigger ARRAY outside the shared module — the copy that avoided the name', () => {
    const result = extract(`
      const TRIGGERS = ['=', '+', '-', '@'];
      export function guard(v: string) { return TRIGGERS.includes(v.charAt(0)); }
    `);
    expect(result.triggerLiterals).toHaveLength(1);
    const { problems } = evaluate(CLEAN_PAIR, result.triggerLiterals);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('RULE B (the trigger predicate, re-inlined)');
    expect(problems[0]).toContain('Import CSV_INJECTION_TRIGGERS instead');
  });

  it('RED on a ^-anchored character class carrying both = and @', () => {
    const result = extract(`
      export const isFormula = (v: string) => /^[=+\\-@\\t\\r]/.test(v);
    `);
    expect(result.triggerLiterals).toHaveLength(1);
    expect(result.triggerLiterals[0]!.how).toContain("both '=' and '@'");
  });

  it('does NOT fire on an ordinary e-mail check — `includes("@")` is not the predicate', () => {
    // apps/web/src/app/parent/register/ParentRegisterForm.tsx:50 does exactly
    // this. A rule that reported it would be red on correct code from day one.
    const result = extract(`
      export const looksLikeEmail = (v: string) => v.includes('@') && v.includes('.');
    `);
    expect(result.triggerLiterals).toEqual([]);
  });

  it('does NOT fire on the web dialect regex — `/[",;\\n\\r]/` carries no @', () => {
    const result = extract(`
      export const needsQuote = (v: string) => /[",;\\n\\r]/.test(v);
    `);
    expect(result.triggerLiterals).toEqual([]);
  });

  it('the shared module itself may assemble it — asserted against the REAL file', () => {
    // The exemption is applied by PATH in main(), so the extractor still reports
    // the literal and the CLI is what forgives it. Both halves are pinned: the
    // real predicate file really does contain the array (otherwise rule B would
    // be guarding nothing), and the CLI really does exempt only that path.
    const real = extract(readFileSync(PREDICATE_PATH, 'utf8'), gate.PREDICATE_REL);
    expect(real.triggerLiterals.length).toBeGreaterThan(0);
    expect(readFileSync(SCRIPT_PATH, 'utf8')).toContain('if (relPath !== PREDICATE_REL) triggerLiterals.push');
  });
});

/* ================================================================== *
 * 4 (AC-7, §8.1) — rule C: the WEB half's only executed evidence
 * ================================================================== */

describe('AC-7 / §8.1 — rule C: the sanctioned escapers really consume the shared module', () => {
  it('RED when a sanctioned escaper stops CALLING neutraliseCsvCell', () => {
    const { problems } = evaluate([sanctionedRecord(WEB_KEY, { callsShared: false }), sanctionedRecord(WORKER_KEY)]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('RULE C (sanctioned escaper does not call neutraliseCsvCell)');
    expect(problems[0]).toContain('it would be SILENT');
  });

  it('RED when the sanctioned FILE stops IMPORTING it — a call to a local shim is not wiring', () => {
    const { problems } = evaluate([
      sanctionedRecord(WEB_KEY, { fileImportsShared: false }),
      sanctionedRecord(WORKER_KEY),
    ]);
    expect(problems.join()).toContain('does not import neutraliseCsvCell from @pilotage/contracts');
    expect(problems.join()).toContain('apps/web has no unit runner');
  });

  it('the extractor sees the import and the call on the REAL web module', () => {
    // §8.1 of the story: this is the ONLY executed proof that the web half of
    // S-E05-1 is wired, because apps/web has no unit runner (PF-129/PF-133). It
    // is asserted here against the real file rather than described in a PR.
    const webSource = readFileSync(join(REPO_ROOT, 'apps', 'web', 'src', 'lib', 'csv.ts'), 'utf8');
    const result = extract(webSource, 'apps/web/src/lib/csv.ts');
    expect(result.importsShared).toBe(true);
    const escaper = result.escapers.find((e) => e.key === WEB_KEY);
    expect(escaper).toBeDefined();
    expect(escaper!.callsShared).toBe(true);
  });

  it('§8.2 — the deletion is MEASURED, not asserted: AlertsExportButton declares no escaper', () => {
    const alerts = readFileSync(
      join(REPO_ROOT, 'apps', 'web', 'src', 'app', 'admin', 'alerts', 'AlertsExportButton.tsx'),
      'utf8',
    );
    const result = extract(alerts, 'apps/web/src/app/admin/alerts/AlertsExportButton.tsx');
    expect(result.escapers).toEqual([]);
    // And it reaches csvEscape through @/lib/csv, NOT by re-assembling the
    // escaper from the shared parts — which would be a fourth copy in disguise.
    expect(alerts).toContain("from '@/lib/csv'");
    expect(result.importsShared).toBe(false);
  });
});

/* ================================================================== *
 * 5 (AC-7, DNC-08) — rule D: one-way, and vacuity-guarded
 * ================================================================== */

describe('AC-7 / DNC-08 — rule D: the ratchet only turns one way', () => {
  it('a sanctioned entry matching ZERO declarations is RED (stale), not a harmless leftover', () => {
    const { problems } = evaluate([sanctionedRecord(WEB_KEY)]);
    expect(problems.join()).toContain('RULE D (stale sanctioned entry)');
    expect(problems.join()).toContain(WORKER_KEY);
    // …and the vacuity floor fires too: one escaper is below the floor of two.
    expect(problems.join()).toContain('vacuity floor');
  });

  it('a stale EXCLUSION is RED — which is what keeps the two apps/api comments TRUE', () => {
    // Both excluded files carry a shipped comment asserting that this script
    // "excludes this site by name". Without this rule that claim would be
    // unfalsifiable prose; with it, renaming or deleting either declaration
    // turns the gate red instead of silently making the comment a lie.
    const { problems } = gate.evaluateCsvEscapers({
      escapers: CLEAN_PAIR,
      triggerLiterals: [],
      excluded: { 'apps/api/src/gone.ts#escape': 'a site that no longer exists' },
    });
    expect(problems.join()).toContain('RULE D (stale exclusion)');
    expect(problems.join()).toContain('excludes this site by name');
  });

  it('the vacuity floor fires when the matcher breaks and finds NOTHING', () => {
    const { problems } = gate.evaluateCsvEscapers({ escapers: [], triggerLiterals: [], excluded: {} });
    expect(problems.join()).toContain('found 0 sanctioned escaper');
    expect(problems.join()).toContain('"found nothing" is never a pass');
    expect(gate.MIN_SANCTIONED_ESCAPERS).toBe(2);
  });

  it('the two named exclusions are the apps/api TRANSPORT sites, and each says WHY', () => {
    expect(Object.keys(gate.EXCLUDED).sort()).toEqual([
      'apps/api/src/modules/imports/imports.service.ts#escape',
      'apps/api/src/modules/integrations/oneroster.adapter.ts#escape',
    ]);
    // ADR-037 D8's distinction: the neutraliser belongs on PRESENTATION CSV.
    // Neither of these bodies is ever opened in a spreadsheet.
    for (const reason of Object.values(gate.EXCLUDED)) {
      expect(reason.length).toBeGreaterThan(80);
      expect(reason).toMatch(/RE-?PARSED|RE-?UPLOADS/i);
    }
  });
});

/* ================================================================== *
 * 6 (AC-7) — SHOWN able to fail, on the REAL script, driven
 * ================================================================== */

describe('AC-7 — the REAL repository is green, and a real fourth copy turns it RED', () => {
  const run = spawnSync(process.execPath, [SCRIPT_PATH], { cwd: REPO_ROOT, encoding: 'utf8' });

  it('exits 0 and prints its verdict line, naming the walk root', () => {
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('CSV ESCAPE CHECK: PASS');
    expect(run.stdout).toContain('apps/web/src + apps/worker/src + apps/api/src');
  });

  it('prints exactly ONE verdict line, and lists both sanctioned escapers on PASS', () => {
    expect((run.stdout.match(/CSV ESCAPE CHECK: (PASS|FAIL)/g) ?? []).length).toBe(1);
    for (const key of SANCTIONED_KEYS) expect(run.stdout).toContain(key);
    for (const key of Object.keys(gate.EXCLUDED)) expect(run.stdout).toContain(key);
  });

  it('reports the .tsx file count per root — a count is never separable from its tree', () => {
    expect(run.stdout).toMatch(/apps\/web\/src … \d+ files \(\d+ \.tsx\)/);
  });

  describe('a deliberately-added fourth copy, in a .tsx file', () => {
    const probe = join(REPO_ROOT, 'apps', 'web', 'src', 'lib', '__csv_escape_probe.tsx');

    afterEach(() => {
      // The probe NEVER survives the test. A gate whose failure is still in the
      // tree is a broken build, and `git status` must be clean afterwards.
      if (existsSync(probe)) rmSync(probe);
    });

    it('exits non-zero naming rule A and the file, and the tree is green again after', () => {
      writeFileSync(
        probe,
        [
          '// Temporary AC-7 probe. Removed in afterEach — never committed.',
          'export function escapeCell(v: string): string {',
          '  return /[",;\\n\\r]/.test(v) ? `"${v.replace(/"/g, \'""\')}"` : v;',
          '}',
          '',
        ].join('\n'),
        'utf8',
      );
      const red = spawnSync(process.execPath, [SCRIPT_PATH], { cwd: REPO_ROOT, encoding: 'utf8' });
      expect(red.status).toBe(1);
      expect(red.stderr).toContain('CSV ESCAPE CHECK: FAIL');
      expect(red.stderr).toContain('RULE A (a fourth CSV escaper)');
      expect(red.stderr).toContain('__csv_escape_probe.tsx');

      rmSync(probe);
      const green = spawnSync(process.execPath, [SCRIPT_PATH], { cwd: REPO_ROOT, encoding: 'utf8' });
      expect(green.status).toBe(0);
    });
  });
});

/* ================================================================== *
 * 7 (DNC-08) — the check FAILS when it cannot run, naming which
 * ================================================================== */

describe('DNC-08 — a check that cannot run must FAIL, and say what it could not read', () => {
  /**
   * Driven with a portable technique, not with `chmod`.
   *
   * This repository is developed on Windows and a permissions-based
   * unreadability case is unreliable here. The script is copied into a scratch
   * tree and its inputs are supplied ONE AT A TIME: each step asserts that the
   * run fails NAMING the input that is still missing. Every case is a real
   * execution of the real file, and every message is the real message. The
   * technique is `audit-write-gate.spec.ts`'s, reused deliberately.
   */
  const scratch = mkdtempSync(join(tmpdir(), 'csv-escape-dnc08-'));
  const scriptCopy = join(scratch, 'scripts', 'csv-escape-check.js');

  const write = (relPath: string, contents: string) => {
    const target = join(scratch, ...relPath.split('/'));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, contents, 'utf8');
  };
  const run = () => spawnSync(process.execPath, [scriptCopy], { cwd: scratch, encoding: 'utf8' });

  beforeAll(() => {
    mkdirSync(join(scratch, 'scripts'), { recursive: true });
    writeFileSync(scriptCopy, readFileSync(SCRIPT_PATH, 'utf8'), 'utf8');
  });

  afterAll(() => rmSync(scratch, { recursive: true, force: true }));

  it('1. the PARSER is an input: an unresolvable `typescript` fails, naming it', () => {
    const red = run();
    expect(red.status).toBe(1);
    expect(red.stderr).toContain('DNC-08');
    expect(red.stderr).toContain('typescript');
  });

  it('2. with the parser resolvable, an absent PREDICATE fails, naming it', () => {
    write('node_modules/typescript/package.json', JSON.stringify({ name: 'typescript', main: 'index.js' }));
    write(
      'node_modules/typescript/index.js',
      `module.exports = require(${JSON.stringify(require.resolve('typescript'))});\n`,
    );
    const red = run();
    expect(red.status).toBe(1);
    expect(red.stderr).toContain('packages/contracts/src/security/csv-injection.ts does not exist');
    expect(red.stderr).toContain('every escaper is a copy');
  });

  it('3. a predicate missing one of its three exports fails, NAMING which', () => {
    // A consumer importing a symbol the module no longer exports is a red
    // typecheck — but a gate that never checked would still print PASS over it,
    // and this gate is the only executed evidence for the web half.
    write(
      'packages/contracts/src/security/csv-injection.ts',
      "export const CSV_NEUTRALISER = \"'\";\nexport function neutraliseCsvCell(v: string) { return v; }\n",
    );
    const red = run();
    expect(red.status).toBe(1);
    expect(red.stderr).toContain('does not export CSV_INJECTION_TRIGGERS');
  });

  it('4. a security barrel that does not re-export the predicate fails — unreachable is not wired', () => {
    write(
      'packages/contracts/src/security/csv-injection.ts',
      [
        "export const CSV_INJECTION_TRIGGERS: readonly string[] = ['='];",
        "export const CSV_NEUTRALISER = \"'\";",
        'export function neutraliseCsvCell(v: string) { return v; }',
        '',
      ].join('\n'),
    );
    let red = run();
    expect(red.status).toBe(1);
    expect(red.stderr).toContain('packages/contracts/src/security/index.ts does not exist');

    write('packages/contracts/src/security/index.ts', "export * from './csp';\n");
    red = run();
    expect(red.status).toBe(1);
    expect(red.stderr).toContain("does not re-export './csv-injection'");
    expect(red.stderr).toContain('rule C could never be satisfied');
  });

  it('5. an absent WALK ROOT fails, naming which root', () => {
    write('packages/contracts/src/security/index.ts', "export * from './csv-injection';\n");
    const red = run();
    expect(red.status).toBe(1);
    expect(red.stderr).toContain('declared walk root apps/web/src does not exist');
    expect(red.stderr).toContain('The root is data, not a guess');
  });

  it('6. a walk root with ZERO source files fails — the walk is broken, not the repo', () => {
    for (const root of gate.WALK_ROOTS) mkdirSync(join(scratch, ...root.split('/')), { recursive: true });
    const red = run();
    expect(red.status).toBe(1);
    expect(red.stderr).toContain('matched ZERO source files');
  });

  it('7. a tree with source files but NO sanctioned escaper fails on the vacuity floor', () => {
    write('apps/web/src/x.ts', 'export const x = 1;\n');
    for (const root of gate.WALK_ROOTS) write(`${root}/placeholder.ts`, 'export const p = 1;\n');
    const red = run();
    expect(red.status).toBe(1);
    expect(red.stderr).toContain('vacuity floor');
    expect(red.stderr).toContain('"found nothing" is never a pass');
  });

  it('8. an UNPARSEABLE source yields no phantom findings, and the CLI names a real throw', () => {
    const result = extract('export class {{{ unterminated');
    // The TS parser is error-tolerant, so the honest guarantee is this one: a
    // broken file produces no phantom escaper, and a genuine throw is reported
    // as a named DNC-08 failure rather than a silently skipped file.
    expect(result.escapers).toEqual([]);
    expect(readFileSync(SCRIPT_PATH, 'utf8')).toContain('could not be parsed');
  });
});

/* ================================================================== *
 * 8 (DNC-10) — asserted in the NEGATIVE
 * ================================================================== */

describe('DNC-10 — there is no way to turn this gate off', () => {
  const source = readFileSync(SCRIPT_PATH, 'utf8');

  it('reads NO environment variable at all', () => {
    for (const token of ['process.env', 'ConfigService', 'dotenv']) {
      expect(source).not.toContain(token);
    }
  });

  it('there is NO --update, deliberately — on a two-row ceiling that IS the off switch', () => {
    // Asserted over what the script INSPECTS, not over prose: the header names
    // --skip/--force/--update precisely in order to say they do not exist, and a
    // guard a comment can turn green is a guard that gets deleted (PF-83).
    const inspected = (source.match(/argv\.includes\('[^']+'\)/g) ?? []).sort();
    expect(inspected).toEqual(["argv.includes('--help')"]);
    // …and the help text says so out loud, so the absence is documented too.
    expect(source).toContain('no --update');
  });

  it('an unknown argument EXITS NON-ZERO — silently ignoring one is how --skip-csv is born', () => {
    const red = spawnSync(process.execPath, [SCRIPT_PATH, '--nope'], { cwd: REPO_ROOT, encoding: 'utf8' });
    expect(red.status).toBe(1);
    expect(red.stderr).toContain('unknown argument');
    expect(red.stderr).toContain('the only flag is --help');
  });

  it('EXECUTES to the same verdict with every plausible escape variable set', () => {
    const env = {
      ...process.env,
      SKIP_CSV_CHECK: '1',
      SKIP_CSV_ESCAPE_CHECK: '1',
      ALLOW_CSV_ESCAPERS: '1',
      CI: 'false',
      NODE_ENV: 'production',
    };
    const run = spawnSync(process.execPath, [SCRIPT_PATH], { cwd: REPO_ROOT, encoding: 'utf8', env });
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('CSV ESCAPE CHECK: PASS');
  });
});

/* ================================================================== *
 * 9 (AC-7) — wired into BOTH harnesses, and it cannot drift
 * ================================================================== */

/**
 * Asserted against what the runner EXECUTES, not what the file SAYS.
 *
 * `boot-gate.spec.ts:75` states the reason and it applies verbatim here: this
 * slice's new stage names `csv-escape-check.js` in prose directly above the
 * runner line, so a naive `indexOf` guard reads the comment and can go green on
 * the wrong text. That is PF-83. Offsets are preserved so positions still name
 * the real file.
 */
function stripComments(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      const at = line.indexOf('#');
      return at === -1 ? line : line.slice(0, at) + ' '.repeat(line.length - at);
    })
    .join('\n');
}

describe('AC-7 — the stage is wired into both harnesses and cannot drift', () => {
  const gateSh = stripComments(readFileSync(GATE_PATH, 'utf8'));
  const workflow = stripComments(readFileSync(WORKFLOW_PATH, 'utf8'));

  it('scripts/ci-gate.sh runs it', () => {
    expect(gateSh).toContain('node scripts/csv-escape-check.js');
  });

  it('.github/workflows/ci.yml runs it — ci.yml re-lists stages, it does not call ci-gate.sh', () => {
    // Verified at implementation time (FR-5's "check, state which, and say so"):
    // ci.yml lists runtime-engines, production-artefact, compose-invocation,
    // audit-write, lint-ratchet, schema-drift, boot, csp… individually. It never
    // invokes ci-gate.sh, so a stage added only there would never run in CI.
    expect(workflow).toContain('node scripts/csv-escape-check.js');
    expect(workflow).not.toContain('bash scripts/ci-gate.sh');
  });

  it('a commented-out invocation does NOT count as wiring (PF-83)', () => {
    expect(stripComments('# run_stage "x" node scripts/csv-escape-check.js')).not.toContain('csv-escape-check.js');
    expect(stripComments('run_stage "x" node scripts/csv-escape-check.js')).toContain('csv-escape-check.js');
  });

  it('ci-gate.sh runs it OUTSIDE the --full branch — rule C is the web half\'s only evidence', () => {
    // This stage has exactly ONE call site, and until TOOL-06 was closed that
    // call site omitted its timeout: `timeout` read the stage name as its
    // interval and exited 125, so the blocking ratchet #215 landed had never
    // executed once. It now sits in tier 1, which every PR runs.
    //
    // The detector below used to look for `QUICK`, a flag #214 replaced with
    // `$MODE`. Finding nothing, it concluded "not inside a guard" and passed
    // wherever the stage was wired — including nowhere.
    const lines = gateSh.split('\n');
    const stageAt = lines.findIndex((line) => line.includes('node scripts/csv-escape-check.js'));
    expect(stageAt).toBeGreaterThan(-1);
    // The guard must exist, or this test is vacuous again.
    expect(gateSh).toContain('if [ "$MODE" = full ]');

    let depth = 0;
    const fullDepths: number[] = [];
    for (let i = 0; i < stageAt; i += 1) {
      const line = lines[i] ?? '';
      if (/^\s*if\s/.test(line)) {
        depth += 1;
        if (line.includes('"$MODE" = full')) fullDepths.push(depth);
      }
      if (/^\s*fi\s*$/.test(line)) {
        if (fullDepths.includes(depth)) fullDepths.splice(fullDepths.indexOf(depth), 1);
        depth -= 1;
      }
    }
    expect(fullDepths.length > 0).toBe(false);
  });

  it('every run_stage call in ci-gate.sh declares a numeric timeout (TOOL-06)', () => {
    // The ratchet for the defect this file's own stage was the casualty of. Seven
    // call sites passed the stage NAME where run_stage expects seconds; `timeout`
    // exited 125 before the command ran, every one landed in FAILED[], and the
    // summary exits non-zero whenever FAILED[] is non-empty — so every
    // code-change gate reported GATE: FAIL on a diff it had never examined, while
    // docs-only runs returned PASS because their `exit 0` fires first.
    const calls = gateSh
      .split('\n')
      .map((line, i) => ({ line: line.trim(), n: i + 1 }))
      .filter(({ line }) => /^run_stage\s/.test(line));
    expect(calls.length).toBeGreaterThan(5);
    const unbounded = calls.filter(({ line }) => !/^run_stage\s+\d+\s/.test(line));
    expect(unbounded.map(({ line, n }) => `${n}: ${line}`)).toEqual([]);
  });

  it('ci-gate.sh runs it between the audit-write stage and the schema-drift stage', () => {
    const auditAt = gateSh.indexOf('node scripts/audit-write-check.js');
    const stageAt = gateSh.indexOf('node scripts/csv-escape-check.js');
    const driftAt = gateSh.indexOf('node scripts/schema-drift-check.js');
    const buildAt = gateSh.indexOf('pnpm build');
    expect(auditAt).toBeGreaterThan(-1);
    expect(stageAt).toBeGreaterThan(auditAt);
    expect(stageAt).toBeLessThan(driftAt);
    // It reads source, not build output.
    expect(stageAt).toBeLessThan(buildAt);
  });

  it('ci.yml runs it in the LINT job, before `prisma generate` — not in the build job', () => {
    // The build job needs Postgres and a build, and PF-126 makes it the least
    // reliable place in the harness. This stage needs neither.
    const lintAt = workflow.indexOf('  lint:');
    const typecheckAt = workflow.indexOf('  typecheck:');
    const stageAt = workflow.indexOf('node scripts/csv-escape-check.js');
    expect(lintAt).toBeGreaterThan(-1);
    expect(stageAt).toBeGreaterThan(lintAt);
    expect(stageAt).toBeLessThan(typecheckAt);
  });

  it('neither call site passes ANY argument — a caller-chosen input is a bypass renamed', () => {
    for (const text of [gateSh, workflow]) {
      const at = text.indexOf('node scripts/csv-escape-check.js');
      const rest = text.slice(at + 'node scripts/csv-escape-check.js'.length).split('\n')[0] ?? '';
      expect(rest.trim()).toBe('');
    }
  });

  it('both files carry the anti-drift note the sibling stages carry (S-E02-2 AC-4)', () => {
    // Read from the RAW files: the note IS a comment, so the stripped text
    // cannot contain it.
    const rawGate = readFileSync(GATE_PATH, 'utf8');
    const rawWorkflow = readFileSync(WORKFLOW_PATH, 'utf8');
    // ci-gate.sh names its own stage as a heading ("Stage 0d-bis"); ci.yml
    // back-references it in lower case ("…ci-gate.sh stage 0d-bis"). Both
    // spellings are asserted as they are actually written, so this guard cannot
    // pass on the wrong file.
    expect(rawGate).toContain('Stage 0d-bis');
    expect(rawWorkflow).toContain('stage 0d-bis');
    expect(rawGate.slice(rawGate.indexOf('Stage 0d-bis'))).toContain('the two must not drift');
    expect(rawWorkflow.slice(rawWorkflow.indexOf('stage 0d-bis'))).toContain('must not drift');
  });

  it('it is a BLOCKING step — no continue-on-error anywhere near it in ci.yml', () => {
    const raw = readFileSync(WORKFLOW_PATH, 'utf8');
    const at = raw.indexOf('node scripts/csv-escape-check.js');
    const window = raw.slice(Math.max(0, at - 400), at + 400);
    expect(window).not.toContain('continue-on-error');
  });
});

/* ================================================================== *
 * 10 — ADR-037 D8 exists, because six shipped files cite it
 * ================================================================== */

describe('ADR-037 D8 — the decision the code points at must exist', () => {
  const adr = readFileSync(
    join(REPO_ROOT, 'docs', 'adr', 'ADR-037-one-canonical-audit-vocabulary.md'),
    'utf8',
  );

  it('the ADR carries a D8 section', () => {
    // GUARDRAILS §2: a new cross-cutting pattern landing without its ADR is a
    // blocking finding. Six source files cite "ADR-037 D8" as their authority,
    // so a missing D8 makes every one of those citations dangle.
    expect(adr).toMatch(/^### D8 —/m);
  });

  it('D8 records the four points FR-7 names', () => {
    const d8 = adr.slice(adr.search(/^### D8 —/m));
    expect(d8.length).toBeGreaterThan(500);
    // (i) one home for the neutraliser
    expect(d8).toContain('packages/contracts/src/security/csv-injection.ts');
    // (ii) the dialect stays per-surface, PF-169 stays open
    expect(d8).toContain('PF-169');
    // (iii) the invariant is held by a gate, not by review
    expect(d8).toContain('scripts/csv-escape-check.js');
    // (iv) the S-E04-11 "copy (b) already correct" claim is corrected
    expect(d8).toContain('already correct');
  });

  it('the header table points at D8, the way the S-E04-11 amendment did for D6-D7', () => {
    const header = adr.slice(0, adr.indexOf('## Context'));
    expect(header).toContain('D8');
    expect(header).toContain('S-E05-1');
  });
});
