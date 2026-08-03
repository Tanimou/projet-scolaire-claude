import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * PF-71 regression guard — the lint warning count must stay ratcheted, and the
 * autofix that breaks NestJS DI must stay disabled where it applies.
 *
 * THE TWO THINGS THIS PROTECTS
 * ----------------------------
 * 1. **The ceiling.** `S-E02-7` turned the `lint` stage on and revealed 996
 *    warnings. `S-E02-8` cut them to 44. Warnings do not fail a build, so
 *    without an enforced ceiling the number simply drifts back up — which is
 *    how it got to 996 in the first place.
 *
 * 2. **The trap.** 243 of those 996 were
 *    `@typescript-eslint/consistent-type-imports` in `apps/api` and
 *    `apps/worker`. Both extend `@pilotage/tsconfig/node.json`, the only shared
 *    tsconfig setting `emitDecoratorMetadata`. Running the rule's autofix there
 *    rewrites constructor-parameter imports to `import type`, which erases the
 *    runtime `require()` and makes TypeScript emit `design:paramtypes` as
 *    `[Object, Object, …]` — Nest can then no longer resolve the provider at
 *    boot.
 *
 *    Measured on `analytics.service.ts` (2026-08-03), before → after one
 *    `eslint --fix`:
 *      [PrismaService, GradesService, RemediationService]  →  [Object, Object, Object]
 *    `tsc --noEmit` returned **exit 0** on the broken file and `nest build`
 *    succeeded. Nothing in this repository detects it (PF-67), which is why the
 *    protection has to be a configuration assertion rather than a test that
 *    waits for something to go red.
 *
 * WHAT THIS GUARD CANNOT PROVE
 * ----------------------------
 * It asserts on configuration and does not run ESLint, so it cannot prove the
 * workspace is within its ceilings — `node scripts/lint-ratchet.js` does that,
 * and its exit code is the evidence a PR reports. Same honest limitation as
 * `lint-gate.spec.ts` and the module-wiring guards.
 */

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..', '..');
const WORKSPACE_DIRS = ['apps', 'packages'];
const BASELINE_PATH = join(REPO_ROOT, 'scripts', 'lint-warning-baseline.json');
const RATCHET_PATH = join(REPO_ROOT, 'scripts', 'lint-ratchet.js');

interface WorkspacePackage {
  name: string;
  dir: string;
  relDir: string;
  manifest: { name?: string; scripts?: Record<string, string> };
}

function listWorkspacePackages(): WorkspacePackage[] {
  const found: WorkspacePackage[] = [];
  for (const group of WORKSPACE_DIRS) {
    const groupDir = join(REPO_ROOT, group);
    if (!existsSync(groupDir)) continue;
    for (const entry of readdirSync(groupDir)) {
      const dir = join(groupDir, entry);
      const manifestPath = join(dir, 'package.json');
      if (!statSync(dir).isDirectory() || !existsSync(manifestPath)) continue;
      found.push({
        name: entry,
        dir,
        relDir: `${group}/${entry}`,
        manifest: JSON.parse(readFileSync(manifestPath, 'utf8')),
      });
    }
  }
  return found;
}

/**
 * Strip JSONC comments without touching string contents.
 *
 * A naive `.replace(/\/\*[\s\S]*?\*\//g, '')` corrupts every tsconfig in this
 * repo: `"paths": { "@/*": ["src/*"] }` contains `/*`, so the regex treats the
 * path alias as the start of a block comment and eats the rest of the object.
 * That silently produced "no package emits decorator metadata", which would have
 * made the assertions below pass vacuously.
 */
function stripJsonComments(input: string): string {
  let out = '';
  let inString = false;
  let escaped = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    const next = input[i + 1];

    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === '/' && next === '/') {
      while (i < input.length && input[i] !== '\n') i++;
      out += '\n';
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < input.length && !(input[i] === '*' && input[i + 1] === '/')) i++;
      i++;
      continue;
    }
    out += ch;
  }
  // Trailing commas are legal in tsconfig but not in JSON.
  return out.replace(/,(\s*[}\]])/g, '$1');
}

/** Resolve a tsconfig `extends` chain far enough to answer one boolean. */
function inheritsDecoratorMetadata(pkgDir: string): boolean {
  let current: string | null = join(pkgDir, 'tsconfig.json');
  const seen = new Set<string>();

  while (current && existsSync(current) && !seen.has(current)) {
    seen.add(current);
    const raw = stripJsonComments(readFileSync(current, 'utf8'));
    let config: { extends?: string; compilerOptions?: { emitDecoratorMetadata?: boolean } };
    try {
      config = JSON.parse(raw);
    } catch {
      return false;
    }
    if (config.compilerOptions?.emitDecoratorMetadata === true) return true;
    if (!config.extends) return false;

    // Workspace aliases (`@pilotage/tsconfig/node.json`) map to packages/tsconfig.
    current = config.extends.startsWith('.')
      ? resolve(dirname(current), config.extends)
      : join(REPO_ROOT, 'packages', config.extends.replace(/^@pilotage\//, ''));
    if (!current.endsWith('.json')) current += '.json';
  }
  return false;
}

function dirname(p: string): string {
  return p.replace(/[\\/][^\\/]*$/, '');
}

const packages = listWorkspacePackages();
const lintable = packages.filter((p) => typeof p.manifest.scripts?.lint === 'string');
const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as {
  packages: Record<string, { maxWarnings: number; note?: string }>;
};

describe('lint warning ratchet (PF-71)', () => {
  it('finds the packages it is meant to govern', () => {
    // A discovery bug that silently found nothing would make every assertion
    // below vacuously pass — the exact failure mode PF-70 was made of.
    expect(lintable.length).toBeGreaterThanOrEqual(8);
  });

  it('the ratchet script and its baseline both exist', () => {
    expect(existsSync(RATCHET_PATH)).toBe(true);
    expect(existsSync(BASELINE_PATH)).toBe(true);
  });

  it.each(lintable.map((p) => p.relDir))('%s has a warning ceiling', (relDir) => {
    const entry = baseline.packages[relDir];
    expect(entry).toBeDefined();
    // Optional chaining rather than `entry!`: `toBeDefined()` is not a type
    // guard, and both assertions still fail correctly when the entry is missing
    // (`typeof undefined !== 'number'`, and `-1 >= 0` is false).
    expect(typeof entry?.maxWarnings).toBe('number');
    expect(entry?.maxWarnings ?? -1).toBeGreaterThanOrEqual(0);
  });

  it('every non-zero ceiling names its debt instead of carrying a TODO', () => {
    const unexplained = Object.entries(baseline.packages)
      .filter(([, e]) => e.maxWarnings > 0)
      .filter(([, e]) => !e.note || /^TODO/i.test(e.note))
      .map(([id]) => id);
    expect(unexplained).toEqual([]);
  });

  it('carries no ceiling for a package that is not lintable', () => {
    const stale = Object.keys(baseline.packages).filter(
      (id) => !lintable.some((p) => p.relDir === id)
    );
    expect(stale).toEqual([]);
  });

  it('holds the total at or below the level S-E02-8 established', () => {
    // 996 before the cut, 44 after. This is a backstop against someone raising
    // several ceilings at once: the ratchet blocks per-package drift, this
    // blocks a coordinated retreat.
    const total = Object.values(baseline.packages).reduce((sum, e) => sum + e.maxWarnings, 0);
    expect(total).toBeLessThanOrEqual(44);
  });

  it('the gate and the CI workflow both run the ratchet, so they cannot drift', () => {
    const gate = readFileSync(join(REPO_ROOT, 'scripts', 'ci-gate.sh'), 'utf8');
    const workflow = readFileSync(join(REPO_ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
    expect(gate).toContain('scripts/lint-ratchet.js');
    expect(workflow).toContain('scripts/lint-ratchet.js');
  });
});

describe('consistent-type-imports vs emitDecoratorMetadata (PF-71 / PF-67)', () => {
  const decoratorPackages = lintable.filter((p) => inheritsDecoratorMetadata(p.dir));

  it('identifies the packages that emit decorator metadata', () => {
    // If this ever returns nothing, the assertions below stop protecting
    // anything. `apps/api` and `apps/worker` extend @pilotage/tsconfig/node.json.
    expect(decoratorPackages.map((p) => p.relDir).sort()).toEqual(['apps/api', 'apps/worker']);
  });

  it.each(['apps/api', 'apps/worker'])(
    '%s disables consistent-type-imports, because its autofix erases Nest DI metadata',
    (relDir) => {
      const config = readFileSync(join(REPO_ROOT, relDir, 'eslint.config.js'), 'utf8');
      expect(config).toContain('decorator-metadata');
    }
  );

  it('the shared layer turns the rule off rather than merely downgrading it', () => {
    const layer = readFileSync(
      join(REPO_ROOT, 'packages', 'eslint-config', 'decorator-metadata.js'),
      'utf8'
    );
    expect(layer).toMatch(/'@typescript-eslint\/consistent-type-imports':\s*'off'/);
  });

  it('the layer records why, so a future reader does not "fix" the warnings back', () => {
    const layer = readFileSync(
      join(REPO_ROOT, 'packages', 'eslint-config', 'decorator-metadata.js'),
      'utf8'
    );
    expect(layer).toContain('design:paramtypes');
    expect(layer).toContain('emitDecoratorMetadata');
  });

  it('no package outside the decorator set carries the exemption', () => {
    // The exemption costs real signal. It must track `emitDecoratorMetadata`,
    // not "is a Nest-looking package" — packages/imports-core consumes the same
    // `node` preset but extends base.json, and its type imports are fixed
    // normally.
    const wronglyExempt = lintable
      .filter((p) => !inheritsDecoratorMetadata(p.dir))
      .filter((p) => {
        const configPath = join(p.dir, 'eslint.config.js');
        return existsSync(configPath) && readFileSync(configPath, 'utf8').includes('decorator-metadata');
      })
      .map((p) => p.relDir);
    expect(wronglyExempt).toEqual([]);
  });
});
