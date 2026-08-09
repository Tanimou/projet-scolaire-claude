import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

/**
 * S-E04-7 — guard for the audit-write ratchet (`scripts/audit-write-check.js`).
 *
 * WHY THIS FILE EXISTS SEPARATELY FROM THE SCRIPT
 * -----------------------------------------------
 * The script's exit code is the gate. This file is what makes the gate
 * *trustworthy*: it drives the script's pure core in BOTH directions, proves
 * each of its five rules can independently go RED, proves it FAILS when it
 * cannot run (DNC-08) rather than passing over nothing, proves nothing can turn
 * it off (DNC-10), and proves it is still wired into both harnesses.
 *
 * The bar the contract sets: *"a gate you did not watch fail is not a gate"* —
 * and a gate watched failing on one of its five rules is one rule tested and
 * four asserted. Every rule below has its own driven mutation.
 *
 * THE MEASUREMENT THIS SLICE STANDS ON, WITH ITS ROOT
 * ---------------------------------------------------
 * Walk root `apps/api/src` + `apps/worker/src` + `packages/imports-core/src`,
 * production `.ts`, excluding `*.spec.ts` and the seam: **27** direct audit
 * writes across **16** files before this slice — 25 / 15 files in `apps/api/src`,
 * 0 in `apps/worker/src`, 2 in `packages/imports-core/src`. S-E04-7 converts 10
 * and baselines 17, and the arithmetic `27 = 10 + 17` is asserted below against
 * the committed baseline rather than left in a PR description.
 *
 * LEDGER DISAGREEMENTS, RECORDED
 * ------------------------------
 *  • `docs/spec/features/v3-e04/tasks.md` § S-E04-7 AC-1 says **30**. Stale — it
 *    is the pre-`S-E04-6` figure.
 *  • `ADR-035` D9 says *"27 sites across 15 files"* and attributes all of them to
 *    `apps/api`. The count is right; the file count is 16 and two of the sites
 *    are in `packages/imports-core`.
 *  • `NEXT.md`'s "27 in `apps/api`" is 25 in `apps/api/src` plus 2 elsewhere —
 *    the root was dropped, which is the reporting habit this slice exists to fix.
 */

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..', '..');
const SCRIPT_PATH = join(REPO_ROOT, 'scripts', 'audit-write-check.js');
const BASELINE_PATH = join(REPO_ROOT, 'scripts', 'audit-write-baseline.json');
const GATE_PATH = join(REPO_ROOT, 'scripts', 'ci-gate.sh');
const WORKFLOW_PATH = join(REPO_ROOT, '.github', 'workflows', 'ci.yml');
const FINDINGS_INDEX_PATH = join(REPO_ROOT, 'docs', 'daily-improvement-v3', 'audit-findings-index.md');

/* eslint-disable @typescript-eslint/no-require-imports */
// Unguarded on purpose (DNC-08): if the script disappears this suite must fail
// at LOAD rather than degrade into "nothing to check, therefore pass".
const gate = require(SCRIPT_PATH) as {
  WALK_ROOTS: string[];
  SEAM_REL: string;
  BASELINE_REL: string;
  FINDINGS_INDEX_REL: string;
  BASELINE_CLASSES: Set<string>;
  MIN_WRITE_AUDIT_CALLS: number;
  loadTypeScript: () => any;
  isProductionSource: (name: string) => boolean;
  walkRoot: (absolute: string) => string[];
  extractFromSource: (
    ts: any,
    relPath: string,
    source: string,
  ) => {
    creates: Array<{ file: string; symbol: string; line: number; receiver: string }>;
    writeAuditCalls: Array<{
      file: string;
      symbol: string;
      line: number;
      firstArgument: string;
      transactional: { ok: boolean; how: string };
      inlineLiteral: boolean;
      secondArgument: string;
      insideTry: boolean;
    }>;
  };
  keySites: (sites: any[]) => Array<{ key: string; file: string; line: number }>;
  declaredFindingIds: (markdown: string) => Set<string>;
  evaluateAuditWrites: (input: {
    creates: any[];
    writeAuditCalls: any[];
    baseline: any;
    findingIds: Set<string>;
  }) => { problems: string[]; stats: Record<string, number>; keyed: any[] };
};
const ts = gate.loadTypeScript();
/* eslint-enable @typescript-eslint/no-require-imports */

/** Extract from a synthetic source; the file name is fictional and that is fine. */
function extract(source: string, relPath = 'apps/api/src/fixture.ts') {
  return gate.extractFromSource(ts, relPath, source);
}

/**
 * TypeScript comments blanked, offsets preserved.
 *
 * Reused from `link-integrity-check.js` — the same helper `write-audit.spec.ts`
 * and `audit-vocabulary-gate.spec.ts` already require, for the same reason: an
 * assertion about what the CODE says must not be satisfiable, or falsifiable, by
 * a comment. This slice walks straight into that: the doc comment explaining why
 * `actor: 'parent' | 'admin'` was deleted necessarily contains the string
 * `actor: 'parent' | 'admin'`.
 */
/* eslint-disable-next-line @typescript-eslint/no-require-imports */
const { stripCommentsPreservingLines: stripTsComments } = require(
  join(REPO_ROOT, 'scripts', 'link-integrity-check.js'),
) as { stripCommentsPreservingLines: (source: string) => string };

/** The declared-shape baseline row used by the positive cases below. */
const OK_ROW = { class: 'best-effort-post-commit', finding: 'PF-31', reason: 'stated' };
const REAL_FINDINGS = new Set(['PF-31', 'PF-121']);

function evaluate(
  creates: unknown[],
  writeAuditCalls: unknown[],
  sites: Record<string, unknown> = {},
  findingIds: Set<string> = REAL_FINDINGS,
) {
  return gate.evaluateAuditWrites({
    creates: creates as never[],
    writeAuditCalls: writeAuditCalls as never[],
    baseline: { sites },
    findingIds,
  });
}

/** A rule-B/C-clean writeAudit call, so a case testing rule A tests only rule A. */
const CLEAN_CALL = {
  file: 'apps/api/src/x.ts',
  symbol: 'handler',
  line: 1,
  firstArgument: 'tx',
  transactional: { ok: true, how: '$transaction callback parameter' },
  inlineLiteral: true,
  secondArgument: 'ObjectLiteralExpression',
  insideTry: false,
};

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
    // If main() ran on require, the walk output would be on stdout.
    expect(probe.stdout).not.toContain('AUDIT WRITE CHECK');
    expect(readFileSync(SCRIPT_PATH, 'utf8')).toContain('if (require.main === module) main();');
  });

  it('exports the pure core, so every rule can be driven without a bypass flag existing', () => {
    for (const name of [
      'extractFromSource',
      'evaluateAuditWrites',
      'keySites',
      'declaredFindingIds',
      'walkRoot',
      'loadTypeScript',
    ] as const) {
      expect(typeof gate[name]).toBe('function');
    }
  });

  it('the walk root is DECLARED as data and is the three-root one, not apps/api alone', () => {
    // The S-E06-5 lesson, asserted rather than trusted: a gate rooted at the API
    // would be blind to packages/imports-core/src/engine.ts's two audit writes.
    expect(gate.WALK_ROOTS).toEqual(['apps/api/src', 'apps/worker/src', 'packages/imports-core/src']);
  });

  it('parses with the TypeScript compiler, never with a regex', () => {
    const source = readFileSync(SCRIPT_PATH, 'utf8');
    expect(source).toContain("require('typescript')");
    expect(ts).toBeTruthy();
    expect(typeof ts.createSourceFile).toBe('function');
  });
});

/* ================================================================== *
 * 1 — the extractor: comments are not code (the measured false positive)
 * ================================================================== */

describe('the extractor', () => {
  it('a JSDoc mention of prisma.auditLog.create yields ZERO sites; the same text as code yields one', () => {
    // Measured on this branch: grep returns 29 hits for 27 sites, because
    // alerts.service.ts:606 and child-claims.service.ts:710 mention the call
    // inside a doc comment. A regex gate reports two violations at lines holding
    // no code, and neither is baselineable in any honest sense.
    const commented = `
      /**
       * Uses the established inline \`prisma.auditLog.create\` convention.
       */
      export async function noop(): Promise<void> {}
    `;
    expect(extract(commented).creates).toHaveLength(0);

    const real = `
      export async function real(prisma: any): Promise<void> {
        await prisma.auditLog.create({ data: {} });
      }
    `;
    expect(extract(real).creates).toHaveLength(1);
  });

  it('distinguishes tx.auditLog.create from this.prisma.auditLog.create — different debts', () => {
    const source = `
      export async function both(prisma: any): Promise<void> {
        await prisma.$transaction(async (tx: any) => {
          await tx.auditLog.create({ data: {} });
        });
        await this.prisma.auditLog.create({ data: {} });
      }
    `;
    const receivers = extract(source).creates.map((c) => c.receiver);
    expect(receivers).toContain('tx');
    expect(receivers).toContain('this.prisma');
  });

  it('excludes *.spec.ts and *.d.ts from the walk, and includes production .ts', () => {
    expect(gate.isProductionSource('alerts.service.ts')).toBe(true);
    expect(gate.isProductionSource('alerts.service.spec.ts')).toBe(false);
    expect(gate.isProductionSource('generated.d.ts')).toBe(false);
    expect(gate.isProductionSource('page.tsx')).toBe(false);
  });
});

/* ================================================================== *
 * 2 — site keys are path#symbol, never path:line
 * ================================================================== */

describe('site keys', () => {
  it('are keyed on the enclosing symbol, and a line change does NOT change the key', () => {
    // link-integrity-check.js states the rule for its own baseline and it is
    // sharper here: remediation.controller.ts and messaging.service.ts churn, and
    // a line-keyed row silently un-baselines its site on any edit above it.
    const before = extract(`
      export class S {
        async handler(tx: any) { await tx.auditLog.create({ data: {} }); }
      }
    `);
    const after = extract(`
      // a comment added above
      // and another



      export class S {
        async handler(tx: any) { await tx.auditLog.create({ data: {} }); }
      }
    `);
    const keyOf = (r: ReturnType<typeof extract>) => gate.keySites(r.creates)[0]!.key;
    expect(keyOf(before)).toBe('apps/api/src/fixture.ts#handler');
    expect(keyOf(after)).toBe(keyOf(before));
    expect(keyOf(before)).not.toMatch(/:\d+$/);
  });

  it('an arrow callback resolves to the METHOD that opened the transaction, not to nothing', () => {
    const result = extract(`
      export class S {
        async doIt(prisma: any) {
          await prisma.$transaction(async (tx: any) => {
            await tx.auditLog.create({ data: {} });
          });
        }
      }
    `);
    expect(gate.keySites(result.creates)[0]!.key).toBe('apps/api/src/fixture.ts#doIt');
  });

  it('two writes in ONE symbol get ordinals, so one row can never silently cover two sites', () => {
    const result = extract(`
      export class S {
        async twice(tx: any) {
          await tx.auditLog.create({ data: { a: 1 } });
          await tx.auditLog.create({ data: { b: 2 } });
        }
      }
    `);
    expect(gate.keySites(result.creates).map((s) => s.key)).toEqual([
      'apps/api/src/fixture.ts#twice#1',
      'apps/api/src/fixture.ts#twice#2',
    ]);
  });
});

/* ================================================================== *
 * 3 (AC-8) — each of rules A–E goes red INDEPENDENTLY, driven
 * ================================================================== */

describe('AC-8 — rule A: auditLog.create outside the seam', () => {
  const site = { file: 'apps/api/src/a.ts', symbol: 'h', line: 9, receiver: 'this.prisma' };

  it('RED when the site is not baselined, and the message names the rule and the file', () => {
    const { problems } = evaluate([site], [CLEAN_CALL]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('RULE A');
    expect(problems[0]).toContain('apps/api/src/a.ts:9');
    expect(problems[0]).toContain('auditLog.create outside shared/audit');
  });

  it('GREEN when it is baselined with a class, a reason and a resolving finding', () => {
    const { problems, stats } = evaluate([site], [CLEAN_CALL], { 'apps/api/src/a.ts#h': OK_ROW });
    expect(problems).toEqual([]);
    expect(stats.baselined).toBe(1);
  });

  it('RED again if the row loses its reason, or its class', () => {
    expect(
      evaluate([site], [CLEAN_CALL], { 'apps/api/src/a.ts#h': { ...OK_ROW, reason: '' } }).problems.join(),
    ).toContain('unreasoned');
    expect(
      evaluate([site], [CLEAN_CALL], { 'apps/api/src/a.ts#h': { ...OK_ROW, class: 'made-up' } }).problems.join(),
    ).toContain('unclassed');
  });
});

describe('AC-8 — rule B: writeAudit must be given a transaction client', () => {
  // `!` because every fixture below contains exactly one `writeAudit(...)`; under
  // `noUncheckedIndexedAccess` the index is `T | undefined` and each `expect` would
  // otherwise read a possibly-undefined member. An empty array here means the
  // extractor stopped seeing calls at all — the assertion that follows fails loudly
  // on the undefined, which is the signal we want, not a silenced one.
  const analyse = (body: string) => extract(body).writeAuditCalls[0]!;

  it('ACCEPTS an identifier bound by a $transaction callback parameter', () => {
    const call = analyse(`
      export class S {
        async h(prisma: any) {
          await prisma.$transaction(async (tx) => {
            await writeAudit(tx, { action: 'role.create' });
          });
        }
      }
    `);
    expect(call.transactional.ok).toBe(true);
    expect(call.transactional.how).toContain('$transaction callback parameter');
  });

  it('ACCEPTS a parameter declared AuditTransactionClient — the forwarder shape', () => {
    // Not a loosening. remediation.controller.ts relays through four private
    // helpers that take `tx` as a parameter with no lexical $transaction in
    // scope; a rule demanding lexical enclosure would report five CORRECT sites
    // red, and the pressure would then be to weaken the rule (R-30).
    const call = analyse(`
      async function forward(tx: AuditTransactionClient) {
        await writeAudit(tx, { action: 'role.create' });
      }
    `);
    expect(call.transactional.ok).toBe(true);
    expect(call.transactional.how).toContain('AuditTransactionClient');
  });

  it('REJECTS a member expression — writeAudit(this.prisma, …)', () => {
    const call = analyse(`
      export class S {
        async h() { await writeAudit(this.prisma, { action: 'role.create' }); }
      }
    `);
    expect(call.transactional.ok).toBe(false);
    expect(call.transactional.how).toContain('member expression');
    const { problems } = evaluate([], [{ ...CLEAN_CALL, ...call }]);
    expect(problems.join()).toContain('RULE B (writeAudit without transaction client)');
  });

  it('REJECTS an unbound identifier', () => {
    const call = analyse(`
      const somewhere: any = null;
      export async function h() { await writeAudit(somewhere, { action: 'role.create' }); }
    `);
    expect(call.transactional.ok).toBe(false);
    expect(call.transactional.how).toContain('not bound by any enclosing transaction');
  });

  it('REJECTS an ALIAS — `const tx = this.prisma` is bound by no parameter, and that is measured', () => {
    // The verdict on this shape is a decision, so it is driven rather than
    // reasoned about, and the header states the limit it does NOT cover.
    const call = analyse(`
      export class S {
        async h() {
          const tx = this.prisma;
          await writeAudit(tx, { action: 'role.create' });
        }
      }
    `);
    expect(call.transactional.ok).toBe(false);
    expect(evaluate([], [{ ...CLEAN_CALL, ...call }]).problems.join()).toContain('RULE B');
  });

  it('the STATED LIMIT is written in the header: this rule cannot decide assignability', () => {
    // A helper declaring `tx: Prisma.TransactionClient` is accepted here even if
    // some caller hands it a full client. Deciding THAT is the compile-time
    // brand's job (ADR-035 D1, write-audit.spec.ts:223), and neither half
    // replaces the other. Written down rather than discovered in review.
    const header = readFileSync(SCRIPT_PATH, 'utf8');
    expect(header).toContain('WHAT RULE B PROVES, AND WHAT IT DOES NOT');
    expect(header).toContain('COMPILE-TIME brand');
    expect(header).toContain('Neither half replaces the');
  });

  it('a writeAudit call inside a try block is RED — a swallow is a DNC-10 bypass renamed', () => {
    const call = analyse(`
      export class S {
        async h(prisma: any) {
          await prisma.$transaction(async (tx) => {
            try {
              await writeAudit(tx, { action: 'role.create' });
            } catch { /* swallow */ }
          });
        }
      }
    `);
    expect(call.insideTry).toBe(true);
    expect(evaluate([], [call]).problems.join()).toContain('inside a try block');
  });

  it('a call in the CATCH block is not reported as being in the try block', () => {
    const call = analyse(`
      export class S {
        async h(prisma: any) {
          await prisma.$transaction(async (tx) => {
            try { await other(); } catch { await writeAudit(tx, { action: 'role.create' }); }
          });
        }
      }
    `);
    expect(call.insideTry).toBe(false);
  });
});

describe('AC-8 — rule C: the second argument must be an inline object literal', () => {
  it('REJECTS a pre-built variable, and the message says WHY it matters', () => {
    const call = extract(`
      export class S {
        async h(prisma: any) {
          await prisma.$transaction(async (tx) => {
            const input = { action: 'role.create' };
            await writeAudit(tx, input);
          });
        }
      }
    `).writeAuditCalls[0]!;
    expect(call.inlineLiteral).toBe(false);
    const joined = evaluate([], [call]).problems.join();
    expect(joined).toContain('RULE C');
    expect(joined).toContain('audit-vocabulary-gate.spec.ts');
  });

  it('ACCEPTS an inline literal', () => {
    const call = extract(`
      export class S {
        async h(prisma: any) {
          await prisma.$transaction(async (tx) => {
            await writeAudit(tx, { action: 'role.create', resourceType: 'role' });
          });
        }
      }
    `).writeAuditCalls[0]!;
    expect(call.inlineLiteral).toBe(true);
    expect(evaluate([], [call]).problems).toEqual([]);
  });
});

describe('AC-8 — rule D: the ratchet only turns one way', () => {
  it('a baseline row matching ZERO sites is RED (stale), not a harmless leftover', () => {
    const { problems } = evaluate([], [CLEAN_CALL], { 'apps/api/src/gone.ts#h': OK_ROW });
    expect(problems.join()).toContain('RULE D (stale baseline row)');
    expect(problems.join()).toContain('the ratchet only turns one way');
  });

  it('ambiguity is IMPOSSIBLE by construction, and the reconciler still refuses it if it happens', () => {
    // Two writes in one symbol get ordinals, so two sites can never share a key —
    // asserted here over an adversarial input rather than assumed from the
    // ordinal test above. The reconciler nonetheless carries an explicit
    // ambiguity refusal: a keying change that reintroduced collisions would
    // otherwise make ONE reviewed row silently cover TWO sites, which is the
    // quietest way a ratchet stops ratcheting.
    const duplicate = { file: 'apps/api/src/a.ts', symbol: 'h', line: 1, receiver: 'tx' };
    const keys = gate.keySites([duplicate, { ...duplicate, line: 1 }]).map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual(['apps/api/src/a.ts#h#1', 'apps/api/src/a.ts#h#2']);

    // …and each of the two now needs its OWN reviewed row: the single old row is
    // stale and BOTH new keys are unbaselined. Three failures, never one silent pass.
    const { problems } = gate.evaluateAuditWrites({
      creates: [duplicate, { ...duplicate, line: 1 }] as never[],
      writeAuditCalls: [CLEAN_CALL] as never[],
      baseline: { sites: { 'apps/api/src/a.ts#h': OK_ROW } },
      findingIds: REAL_FINDINGS,
    });
    expect(problems).toHaveLength(3);
    expect(problems.filter((p) => p.startsWith('RULE A'))).toHaveLength(2);
    expect(problems.filter((p) => p.includes('RULE D (stale baseline row)'))).toHaveLength(1);
    expect(readFileSync(SCRIPT_PATH, 'utf8')).toContain('RULE D (ambiguous key)');
  });

  it('a NEW site is red even when every other site is baselined — the whole point', () => {
    const known = { file: 'apps/api/src/a.ts', symbol: 'h', line: 1, receiver: 'tx' };
    const fresh = { file: 'apps/api/src/b.ts', symbol: 'new', line: 2, receiver: 'this.prisma' };
    const { problems } = evaluate([known, fresh], [CLEAN_CALL], { 'apps/api/src/a.ts#h': OK_ROW });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('apps/api/src/b.ts');
  });
});

describe('AC-7 / AC-8 — rule E: the finding id is RESOLVED, not shape-matched', () => {
  const site = { file: 'apps/api/src/a.ts', symbol: 'h', line: 1, receiver: 'tx' };

  it('a FABRICATED id shaped like a real one (PF-99999) turns the check RED', () => {
    // The S-E06-5 defect, driven: link-integrity-check.js validated the SHAPE
    // `PF-\\d+` and three live rows cited ids that existed nowhere.
    const { problems } = evaluate([site], [CLEAN_CALL], {
      'apps/api/src/a.ts#h': { ...OK_ROW, finding: 'PF-99999' },
    });
    expect(problems.join()).toContain('RULE E (unresolvable finding)');
    expect(problems.join()).toContain('PF-99999');
    expect(problems.join()).toContain('The shape PF-nnn is not enough');
  });

  it('a REAL id resolves and the same input is GREEN — the control', () => {
    expect(evaluate([site], [CLEAN_CALL], { 'apps/api/src/a.ts#h': OK_ROW }).problems).toEqual([]);
  });

  it('an ABSENT finding is red too — "unowned" and "unresolvable" are different messages', () => {
    const { problems } = evaluate([site], [CLEAN_CALL], {
      'apps/api/src/a.ts#h': { ...OK_ROW, finding: '' },
    });
    expect(problems.join()).toContain('RULE E (unowned baseline row)');
  });

  it('the resolver reads DECLARED rows, not every PF-nnn mentioned in prose', () => {
    // A finding referenced inside another row's narrative is not a finding the
    // register HOLDS. A resolver that could not tell them apart would be the
    // regex it replaced, one indirection out.
    const ids = gate.declaredFindingIds(
      ['| **PF-07** | a real row | X |', 'prose mentioning PF-4242 in a sentence', '| PF-08 | another row | Y |'].join(
        '\n',
      ),
    );
    expect([...ids].sort()).toEqual(['PF-07', 'PF-08']);
    expect(ids.has('PF-4242')).toBe(false);
  });

  it('against the REAL register: PF-31 and PF-121 resolve, PF-99999 does not', () => {
    const ids = gate.declaredFindingIds(readFileSync(FINDINGS_INDEX_PATH, 'utf8'));
    expect(ids.size).toBeGreaterThan(100);
    expect(ids.has('PF-31')).toBe(true);
    expect(ids.has('PF-121')).toBe(true);
    expect(ids.has('PF-99999')).toBe(false);
    // Recorded, because it is the reason this baseline cites only PF-31/PF-121:
    // the ids the epic's OPEN.md uses do not exist in the register yet.
    expect(ids.has('PF-162')).toBe(false);
  });
});

/* ================================================================== *
 * 4 (AC-1) — the committed baseline, and the landing arithmetic
 * ================================================================== */

describe('AC-1 — scripts/audit-write-baseline.json', () => {
  const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as {
    walkRoots: string[];
    sites: Record<string, { class: string; finding: string; reason: string }>;
  };
  const rows = Object.entries(baseline.sites);

  it('records the walk root beside its numbers — a number without its root is the S-E06-5 defect', () => {
    expect(baseline.walkRoots).toEqual(gate.WALK_ROOTS);
    expect(readFileSync(BASELINE_PATH, 'utf8')).toContain('27 = 10 + 17');
  });

  it('holds exactly 17 rows: 27 measured sites = 10 converted + 17 baselined', () => {
    expect(rows).toHaveLength(17);
  });

  it('the classes are 15 best-effort-post-commit, 2 cross-package-seam, 0 no-actor-in-scope', () => {
    const byClass = new Map<string, number>();
    for (const [, row] of rows) byClass.set(row.class, (byClass.get(row.class) ?? 0) + 1);
    expect(byClass.get('best-effort-post-commit')).toBe(15);
    expect(byClass.get('cross-package-seam')).toBe(2);
    expect(byClass.get('no-actor-in-scope')).toBeUndefined();
    // Declared and empty on purpose, so the next such site lands in a named class.
    expect(gate.BASELINE_CLASSES.has('no-actor-in-scope')).toBe(true);
  });

  it('every row carries a class, a reason, and a finding that resolves against the REAL register', () => {
    const ids = gate.declaredFindingIds(readFileSync(FINDINGS_INDEX_PATH, 'utf8'));
    for (const [key, row] of rows) {
      expect(gate.BASELINE_CLASSES.has(row.class)).toBe(true);
      expect(row.reason.trim().length).toBeGreaterThan(20);
      expect(ids.has(row.finding)).toBe(true);
      expect(key).not.toMatch(/:\d+$/);
      expect(key).toContain('#');
    }
  });

  it('the two imports-core rows are classed cross-package-seam and say WHY, not "cannot convert"', () => {
    const engine = rows.filter(([key]) => key.startsWith('packages/imports-core/'));
    expect(engine).toHaveLength(2);
    for (const [, row] of engine) {
      expect(row.class).toBe('cross-package-seam');
      expect(row.finding).toBe('PF-121');
      expect(row.reason).toMatch(/depend/);
    }
  });

  it('does NOT baseline any site this slice converted — they are fixed, not tolerated', () => {
    for (const key of Object.keys(baseline.sites)) {
      expect(key).not.toContain('identity/roles.controller.ts');
      expect(key).not.toContain('identity/invite.controller.ts');
      expect(key).not.toContain('integrations/integrations.service.ts');
      expect(key).not.toContain('child-claims/child-claims.service.ts');
      expect(key).not.toContain('calendar/calendar-seed.service.ts');
      expect(key).not.toContain('school-structure/');
      expect(key).not.toContain('imports/imports.service.ts');
    }
  });
});

/* ================================================================== *
 * 5 (AC-1, again — against the REAL tree)
 * ================================================================== */

describe('AC-1 — the real repository reconciles, and the run is the evidence', () => {
  const run = spawnSync(process.execPath, [SCRIPT_PATH], { cwd: REPO_ROOT, encoding: 'utf8' });

  it('exits 0 and prints its verdict line, naming the walk root', () => {
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('AUDIT WRITE CHECK: PASS');
    expect(run.stdout).toContain('apps/api/src + apps/worker/src + packages/imports-core/src');
  });

  it('prints exactly ONE verdict line', () => {
    const verdicts = (run.stdout.match(/AUDIT WRITE CHECK: (PASS|FAIL)/g) ?? []).length;
    expect(verdicts).toBe(1);
  });

  it('reports each root, INCLUDING the one with zero writes — zero writes is a PASS, not a skip', () => {
    // apps/worker/src holds no audit write at all today. A DNC-08 rule that
    // failed on "zero matched writes in a root" would be permanently red on
    // correct code; the failing condition is zero FILES walked, never zero hits.
    expect(run.stdout).toMatch(/apps\/worker\/src … \d+ files · 0 direct audit writes/);
    expect(run.stdout).toMatch(/packages\/imports-core\/src … \d+ files · 2 direct audit writes/);
  });

  it('lists every baselined site with its owning finding, on PASS as well as FAIL', () => {
    expect(run.stdout).toContain('baselined audit writes');
    expect(run.stdout).toContain('cross-package-seam (2)');
    expect(run.stdout).toContain('no-actor-in-scope (0 — declared and empty)');
  });

  it('finds MORE writeAudit call sites than the vacuity floor', () => {
    const calls = gate.WALK_ROOTS.flatMap((root) => gate.walkRoot(join(REPO_ROOT, ...root.split('/'))))
      .filter((file) => !file.endsWith(join('shared', 'audit', 'write-audit.ts')))
      .flatMap((file) => extract(readFileSync(file, 'utf8'), file).writeAuditCalls);
    expect(calls.length).toBeGreaterThanOrEqual(gate.MIN_WRITE_AUDIT_CALLS);
    // …and every one of them is transactional and inline-literal. This is AC-1's
    // "behind writeAudit inside a transaction" half, measured rather than claimed.
    for (const call of calls) {
      expect(call.transactional.ok).toBe(true);
      expect(call.inlineLiteral).toBe(true);
      expect(call.insideTry).toBe(false);
    }
  });
});

/* ================================================================== *
 * 6 (AC-3) — SHOWN able to fail, on the real script, driven
 * ================================================================== */

describe('AC-3 — a deliberately-added non-transactional write turns the real script RED', () => {
  const probe = join(REPO_ROOT, 'apps', 'api', 'src', 'shared', 'quality', '__audit_write_probe.ts');

  afterEach(() => {
    // The probe NEVER survives the test. A gate whose failure is still in the
    // tree is a broken build, and `git status` must be clean afterwards.
    if (existsSync(probe)) rmSync(probe);
  });

  it('exits non-zero, names the rule, names the file, and the tree is clean again', () => {
    writeFileSync(
      probe,
      [
        '// Temporary AC-3 probe. Removed in afterEach — never committed.',
        'export async function auditWriteProbe(prisma: { auditLog: { create: (a: unknown) => Promise<void> } }) {',
        '  await prisma.auditLog.create({ data: {} });',
        '}',
        '',
      ].join('\n'),
      'utf8',
    );
    const red = spawnSync(process.execPath, [SCRIPT_PATH], { cwd: REPO_ROOT, encoding: 'utf8' });
    expect(red.status).toBe(1);
    expect(red.stderr).toContain('AUDIT WRITE CHECK: FAIL');
    expect(red.stderr).toContain('RULE A (auditLog.create outside shared/audit)');
    expect(red.stderr).toContain('__audit_write_probe.ts');

    rmSync(probe);
    const green = spawnSync(process.execPath, [SCRIPT_PATH], { cwd: REPO_ROOT, encoding: 'utf8' });
    expect(green.status).toBe(0);
  });
});

/* ================================================================== *
 * 7 (AC-4, DNC-08) — the check FAILS when it cannot run, naming which
 * ================================================================== */

describe('AC-4 / DNC-08 — a check that cannot run must FAIL, and say what it could not read', () => {
  /**
   * Driven with a portable technique, not with `chmod`.
   *
   * This repository is developed on Windows and a permissions-based
   * unreadability case is unreliable here. Instead the script is copied into a
   * scratch tree and its inputs are supplied ONE AT A TIME: each step asserts
   * that the run fails NAMING the input that is still missing. Every case is a
   * real execution of the real file, and every message is the real message.
   */
  const scratch = mkdtempSync(join(tmpdir(), 'audit-write-dnc08-'));
  const scriptCopy = join(scratch, 'scripts', 'audit-write-check.js');

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

  it('2. with the parser resolvable, an absent SEAM fails, naming the seam', () => {
    // A shim so `require('typescript')` resolves inside the scratch tree.
    write('node_modules/typescript/package.json', JSON.stringify({ name: 'typescript', main: 'index.js' }));
    write(
      'node_modules/typescript/index.js',
      `module.exports = require(${JSON.stringify(require.resolve('typescript'))});\n`,
    );
    const red = run();
    expect(red.status).toBe(1);
    expect(red.stderr).toContain('apps/api/src/shared/audit/write-audit.ts');
  });

  it('3. an absent FINDINGS REGISTER fails, naming it — rule E cannot resolve anything', () => {
    write('apps/api/src/shared/audit/write-audit.ts', 'export const seam = 1;\n');
    const red = run();
    expect(red.status).toBe(1);
    expect(red.stderr).toContain('docs/daily-improvement-v3/audit-findings-index.md');
  });

  it('4. a findings register yielding ZERO ids fails — the vacuity guard, and the S-E06-5 lesson', () => {
    write('docs/daily-improvement-v3/audit-findings-index.md', '# no rows here\n\njust prose about PF-31.\n');
    const red = run();
    expect(red.status).toBe(1);
    expect(red.stderr).toContain('ZERO declared finding ids');
    expect(red.stderr).toContain('never a pass');
  });

  it('5. an absent BASELINE fails, naming it and naming --update', () => {
    write('docs/daily-improvement-v3/audit-findings-index.md', '| **PF-31** | a real row | X |\n');
    const red = run();
    expect(red.status).toBe(1);
    expect(red.stderr).toContain('scripts/audit-write-baseline.json');
    expect(red.stderr).toContain('--update');
  });

  it('6. a MALFORMED baseline fails as invalid JSON — never "empty, therefore nothing to check"', () => {
    write('scripts/audit-write-baseline.json', '{ "sites": { oops }');
    const red = run();
    expect(red.status).toBe(1);
    expect(red.stderr).toContain('not valid JSON');
  });

  it('7. an absent WALK ROOT fails, naming which root', () => {
    write('scripts/audit-write-baseline.json', JSON.stringify({ sites: {} }));
    const red = run();
    expect(red.status).toBe(1);
    expect(red.stderr).toContain('declared walk root apps/worker/src does not exist');
  });

  it('8. a walk root with ZERO production .ts files fails — the walk is broken, not the repo', () => {
    mkdirSync(join(scratch, 'apps', 'worker', 'src'), { recursive: true });
    mkdirSync(join(scratch, 'packages', 'imports-core', 'src'), { recursive: true });
    const red = run();
    expect(red.status).toBe(1);
    expect(red.stderr).toContain('matched ZERO production .ts files');
  });

  it('9. and an UNPARSEABLE source is a failure, not a silently-skipped file', () => {
    // Driven through the exported extractor, because a syntactically broken file
    // is exactly what a partial write or a merge conflict leaves behind.
    const broken = 'export class {{{ unterminated';
    const result = extract(broken);
    // The TS parser is error-tolerant, so the guarantee this gate makes is the
    // honest one: a broken file yields no phantom findings, and the CLI reports
    // a genuine throw as a named DNC-08 failure rather than skipping the file.
    expect(result.creates).toEqual([]);
    expect(readFileSync(SCRIPT_PATH, 'utf8')).toContain('could not be parsed');
  });
});

/* ================================================================== *
 * 8 (AC-5, DNC-10) — asserted in the NEGATIVE
 * ================================================================== */

describe('AC-5 / DNC-10 — there is no way to turn this gate off', () => {
  const source = readFileSync(SCRIPT_PATH, 'utf8');

  it('reads NO environment variable at all', () => {
    expect(source).not.toContain('process.env');
  });

  it('the argv whitelist is EXACTLY --help and --update; no other flag is even read', () => {
    // Asserted over what the script INSPECTS, not over prose: the help text and
    // this file's own header both name --skip and --force in order to say they
    // do not exist, and a guard a comment can turn red is a guard that gets
    // deleted (PF-83, one address over).
    const inspected = (source.match(/argv\.includes\('[^']+'\)/g) ?? []).sort();
    expect(inspected).toEqual(["argv.includes('--help')", "argv.includes('--update')"]);
    // …and nothing anywhere reads an environment variable or a global config.
    for (const token of ['process.env', 'ConfigService', 'dotenv']) {
      expect(source).not.toContain(token);
    }
  });

  it('knows exactly two flags — --help and --update — and an unknown argument EXITS NON-ZERO', () => {
    const red = spawnSync(process.execPath, [SCRIPT_PATH, '--nope'], { cwd: REPO_ROOT, encoding: 'utf8' });
    expect(red.status).toBe(1);
    expect(red.stderr).toContain('unknown argument');
    // Silently ignoring an unrecognised flag is how `--skip-audit` becomes a
    // thing that "already works".
  });

  it('EXECUTES to the same verdict with every plausible escape variable set', () => {
    const env = {
      ...process.env,
      SKIP_AUDIT_CHECK: '1',
      SKIP_AUDIT_WRITE_CHECK: '1',
      ALLOW_AUDIT_WRITES: '1',
      ALLOW_DIRECT_AUDIT: '1',
      CI: 'false',
      NODE_ENV: 'production',
    };
    const run = spawnSync(process.execPath, [SCRIPT_PATH], { cwd: REPO_ROOT, encoding: 'utf8', env });
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('AUDIT WRITE CHECK: PASS');
  });

  it('--update REFUSES to write while a rule-B or rule-C violation is present', () => {
    // link-integrity-check.js:1625 sets the precedent and the reason is the same:
    // without the refusal, one command converts a brand-new non-transactional
    // write into a baselined row and the "one-way ratchet" is a rubber band.
    expect(source).toContain('refusing to write the baseline while a rule-B or rule-C violation is present');
    expect(source).toContain('is never baselineable');
  });

  it('--update writes new rows EMPTY, so the gate stays red until a human fills them in', () => {
    expect(source).toContain("class: (before && before.class) || ''");
    expect(source).toContain('The gate stays RED');
  });
});

/* ================================================================== *
 * 9 (AC-2) — wired into BOTH harnesses, and it cannot drift
 * ================================================================== */

/**
 * Asserted against what the runner EXECUTES, not what the file SAYS.
 *
 * `boot-gate.spec.ts:75` states the reason and it applies verbatim here: the new
 * stage's comment names `audit-write-check.js` in prose directly above the runner
 * line, so a naive `indexOf` guard reads the comment and can go red (or green) on
 * the wrong text. That is PF-83, and this slice walks straight into it without
 * this helper. Offsets are preserved so positions still name the real file.
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

describe('AC-2 — the stage is wired into both harnesses and cannot drift', () => {
  const gateSh = stripComments(readFileSync(GATE_PATH, 'utf8'));
  const workflow = stripComments(readFileSync(WORKFLOW_PATH, 'utf8'));

  it('scripts/ci-gate.sh runs it', () => {
    expect(gateSh).toContain('node scripts/audit-write-check.js');
  });

  it('.github/workflows/ci.yml runs it', () => {
    expect(workflow).toContain('node scripts/audit-write-check.js');
  });

  it('a commented-out invocation does NOT count as wiring (PF-83)', () => {
    expect(stripComments('# run_stage "x" node scripts/audit-write-check.js')).not.toContain(
      'audit-write-check.js',
    );
    expect(stripComments('run_stage "x" node scripts/audit-write-check.js')).toContain('audit-write-check.js');
  });

  it('blanking comments preserves byte offsets, so failure messages still name a real position', () => {
    const raw = 'abc # def\nghi';
    expect(stripComments(raw)).toHaveLength(raw.length);
  });

  it('ci-gate.sh runs it OUTSIDE every --quick guard — a documented flag that skips it is a DNC-10 hole', () => {
    // Stages 7-12 sit inside `if [ "${QUICK}" -eq 0 ]` because they read build
    // output. This one reads SOURCE only. Wired by copy-paste it would land in
    // the block the routine's fast path skips: a blocking gate the most-used
    // invocation does not run, with a house-style alibi.
    const lines = gateSh.split('\n');
    const stageAt = lines.findIndex((line) => line.includes('node scripts/audit-write-check.js'));
    expect(stageAt).toBeGreaterThan(-1);

    let depth = 0;
    let insideQuickGuard = false;
    const quickDepths: number[] = [];
    for (let i = 0; i < stageAt; i += 1) {
      const line = lines[i] ?? '';
      if (/^\s*if\s/.test(line)) {
        depth += 1;
        if (line.includes('QUICK')) quickDepths.push(depth);
      }
      if (/^\s*fi\s*$/.test(line)) {
        if (quickDepths.includes(depth)) quickDepths.splice(quickDepths.indexOf(depth), 1);
        depth -= 1;
      }
    }
    insideQuickGuard = quickDepths.length > 0;
    expect(insideQuickGuard).toBe(false);
  });

  it('ci-gate.sh runs it BEFORE the build stage — it reads source, not build output', () => {
    const stageAt = gateSh.indexOf('node scripts/audit-write-check.js');
    const buildAt = gateSh.indexOf('pnpm build');
    expect(stageAt).toBeGreaterThan(-1);
    expect(buildAt).toBeGreaterThan(-1);
    expect(stageAt).toBeLessThan(buildAt);
  });

  it('ci.yml runs it in the LINT job, before `prisma generate` — not in the build job', () => {
    // The build job needs Postgres and a build, and PF-126 makes it the least
    // reliable place in the harness. This stage needs neither.
    const lintAt = workflow.indexOf('  lint:');
    const typecheckAt = workflow.indexOf('  typecheck:');
    const stageAt = workflow.indexOf('node scripts/audit-write-check.js');
    expect(lintAt).toBeGreaterThan(-1);
    expect(stageAt).toBeGreaterThan(lintAt);
    expect(stageAt).toBeLessThan(typecheckAt);
    expect(workflow.indexOf('pnpm --filter @pilotage/api prisma generate')).toBeGreaterThan(stageAt);
  });

  it('neither call site passes ANY argument — a caller-chosen input is a bypass renamed', () => {
    for (const text of [gateSh, workflow]) {
      const at = text.indexOf('node scripts/audit-write-check.js');
      const rest = text.slice(at + 'node scripts/audit-write-check.js'.length).split('\n')[0] ?? '';
      expect(rest.trim()).toBe('');
    }
  });

  it('both files carry the anti-drift note the sibling stages carry (S-E02-2 AC-4)', () => {
    // Read from the RAW files: the note IS a comment, so the stripped text
    // cannot contain it.
    expect(readFileSync(GATE_PATH, 'utf8')).toContain('the two must not drift');
    expect(readFileSync(WORKFLOW_PATH, 'utf8')).toContain('the two must not drift');
  });

  it('it is a BLOCKING step — no continue-on-error anywhere near it in ci.yml', () => {
    const raw = readFileSync(WORKFLOW_PATH, 'utf8');
    const at = raw.indexOf('node scripts/audit-write-check.js');
    const window = raw.slice(Math.max(0, at - 400), at + 400);
    expect(window).not.toContain('continue-on-error');
  });
});

/* ================================================================== *
 * 10 (AC-9, AC-12) — the negatives this slice must be able to prove
 * ================================================================== */

describe('AC-9 — child-claims records the real actor role, and grants nothing new', () => {
  const servicePath = join(REPO_ROOT, 'apps', 'api', 'src', 'modules', 'child-claims', 'child-claims.service.ts');
  const adminPath = join(
    REPO_ROOT,
    'apps',
    'api',
    'src',
    'modules',
    'child-claims',
    'admin-child-claims.controller.ts',
  );
  // Comments are stripped before every assertion below: this slice's own doc
  // comments QUOTE the deleted `actor: 'parent' | 'admin'` parameter in order to
  // explain why it is gone, and a guard that a comment can turn red is a guard
  // that gets deleted (PF-83).
  const service = stripTsComments(readFileSync(servicePath, 'utf8'));
  const admin = stripTsComments(readFileSync(adminPath, 'utf8'));

  it('the literal actorRole/portal pair is GONE from the audit helper (PF-122 write half)', () => {
    // `admin` is not a Keycloak realm role — an administrator authenticates as
    // `school_admin`. Routing that literal through the canonical seam unchanged
    // would have given a known-wrong provenance the seam's authority.
    expect(service).not.toContain("actorRole: actor");
    expect(service).not.toContain("actor: 'parent' | 'admin'");
    expect(service).toContain('provenance: AuditProvenance');
  });

  it('the value comes from deriveAuditProvenance(jwt, …) at the controller, ABOVE the transaction', () => {
    expect(admin).toContain('deriveAuditProvenance(jwt, extractAuditClientHints(req))');
    // S-E06-6's ordering rule: AuditLog.ipAddress is @db.Inet, so a failed cast
    // inside the transaction would roll back the decision the row exists to trace.
    const deriveAt = admin.indexOf('deriveAuditProvenance');
    const serviceCallAt = admin.indexOf('this.service.approveClaim');
    expect(deriveAt).toBeLessThan(serviceCallAt);
  });

  it('who may approve or reject is UNCHANGED — the permission is byte-identical', () => {
    const decorators = admin.match(/@RequiresPermission\('[^']+'\)/g) ?? [];
    expect(decorators.filter((d) => d.includes('guardianships.approve'))).toHaveLength(3);
    expect(new Set(decorators)).toEqual(new Set(["@RequiresPermission('guardianships.approve')"]));
  });
});

describe('AC-12 — the gates that must NOT trigger, asserted in the negative', () => {
  it('G-AUTHZ: roles.controller.ts changes no permission decorator and no role lookup', () => {
    const roles = readFileSync(
      join(REPO_ROOT, 'apps', 'api', 'src', 'modules', 'identity', 'roles.controller.ts'),
      'utf8',
    );
    // PF-156 (any roles.assign holder can self-grant) and PF-153 (role lookup
    // unfiltered by tenant) are REGISTERED and deliberately NOT fixed here.
    // ADR-015 exists to stop an authorisation change riding in on another slice.
    const decorators = roles.match(/@RequiresPermission\('[^']+'\)/g) ?? [];
    expect(new Set(decorators)).toEqual(
      new Set(["@RequiresPermission('roles.read')", "@RequiresPermission('roles.write')"]),
    );
    expect(roles).not.toContain('effectivePermissions');
  });

  it('roles.controller.ts writes all three audit rows through the seam, inside a transaction', () => {
    const roles = readFileSync(
      join(REPO_ROOT, 'apps', 'api', 'src', 'modules', 'identity', 'roles.controller.ts'),
      'utf8',
    );
    expect(roles).not.toContain('auditLog.create');
    for (const action of ['role.create', 'role.update', 'role.delete']) {
      expect(roles).toContain(`action: '${action}'`);
    }
    expect((roles.match(/writeAudit\(tx, \{/g) ?? []).length).toBe(3);
    expect((roles.match(/\$transaction\(async \(tx\)/g) ?? []).length).toBe(3);
  });

  it('G-MIGRATION does not trigger: this gate reads no schema and writes no SQL', () => {
    const source = readFileSync(SCRIPT_PATH, 'utf8');
    expect(source).not.toContain('schema.prisma');
    expect(source).not.toContain('migrations');
  });
});
