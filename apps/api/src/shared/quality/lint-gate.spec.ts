import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * PF-70 regression guard — the `lint` stage of `scripts/ci-gate.sh` must stay
 * runnable.
 *
 * WHAT WENT WRONG, AND WHY NOTHING CAUGHT IT
 * ------------------------------------------
 * ESLint was bumped to v9, which stopped reading `.eslintrc.*`. No package in
 * the workspace had a flat `eslint.config.js`, so `eslint` exited 2 with
 * "couldn't find an eslint.config file" everywhere. Four lint tasks still
 * printed ✓ — replayed from turbo cache entries created *before* the bump — and
 * `apps/web` genuinely exited 0 only because `next lint` silently forces
 * eslintrc mode. Runs 5, 6 and 7 of the Daily Improvement routine each declared
 * their change green while citing typecheck, the test ratchet and the build,
 * and never naming stage 2.
 *
 * WHAT THIS GUARD CAN AND CANNOT PROVE
 * ------------------------------------
 * It asserts on *configuration*, so it proves the gate is wired and cannot
 * silently revert to a shape that skips packages. It does **not** run ESLint,
 * so it cannot prove the workspace is lint-clean — that is what
 * `bash scripts/ci-gate.sh` does, and its result is the evidence a PR reports.
 * The same honest limitation as the module-wiring guards (PF-67).
 */

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..', '..');
const WORKSPACE_DIRS = ['apps', 'packages'];

interface WorkspacePackage {
  name: string;
  dir: string;
  relDir: string;
  manifest: {
    name?: string;
    scripts?: Record<string, string>;
    devDependencies?: Record<string, string>;
    dependencies?: Record<string, string>;
  };
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
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      found.push({ name: manifest.name ?? entry, dir, relDir: `${group}/${entry}`, manifest });
    }
  }
  return found;
}

const packages = listWorkspacePackages();
const lintable = packages.filter((p) => typeof p.manifest.scripts?.lint === 'string');

describe('lint gate (PF-70)', () => {
  it('finds the workspace packages at all', () => {
    // Guards the guard: a broken REPO_ROOT would make every assertion below
    // pass vacuously over an empty list.
    expect(packages.length).toBeGreaterThanOrEqual(8);
    expect(lintable.length).toBeGreaterThanOrEqual(8);
  });

  it.each(lintable.map((p) => [p.name, p] as const))(
    '%s has a flat eslint.config.js next to its package.json',
    (_name, pkg) => {
      const candidates = ['eslint.config.js', 'eslint.config.mjs', 'eslint.config.cjs'];
      const present = candidates.filter((f) => existsSync(join(pkg.dir, f)));
      expect(present.length).toBeGreaterThan(0);
    },
  );

  it.each(packages.map((p) => [p.name, p] as const))(
    '%s carries no .eslintrc.* file',
    (_name, pkg) => {
      // ESLint 9 ignores these silently. Leaving one behind is how a package
      // ends up believing it is linted by rules that never load.
      const stale = readdirSync(pkg.dir).filter((f) => f.startsWith('.eslintrc'));
      expect(stale).toEqual([]);
    },
  );

  it('has no .eslintrc.* at the repository root either', () => {
    const stale = readdirSync(REPO_ROOT).filter((f) => f.startsWith('.eslintrc'));
    expect(stale).toEqual([]);
  });

  it('uses the ESLint CLI everywhere — never the deprecated `next lint`', () => {
    // `next lint` is removed in Next 16 and was the sole reason apps/web
    // appeared to pass while every other package exited 2.
    const usingNextLint = lintable
      .filter((p) => /(^|\s)next\s+lint(\s|$)/.test(p.manifest.scripts!.lint!))
      .map((p) => p.name);
    expect(usingNextLint).toEqual([]);
  });

  it('the shared config exposes only flat entrypoints', () => {
    const dir = join(REPO_ROOT, 'packages', 'eslint-config');
    for (const entry of ['base.js', 'node.js', 'react.js', 'index.js']) {
      // A computed path cannot be a static import, and the point of this
      // assertion is to load the real file the way ESLint will.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const exported = require(join(dir, entry));
      expect(Array.isArray(exported)).toBe(true);
      expect(exported.length).toBeGreaterThan(0);
    }
  });

  it('ci-gate.sh still runs the lint stage', () => {
    const gate = readFileSync(join(REPO_ROOT, 'scripts', 'ci-gate.sh'), 'utf8');
    // `run_stage` now takes a timeout as its first argument — every stage is
    // bounded so the gate cannot hang. The invariant this guards is unchanged:
    // the lint stage still runs, and still runs `pnpm lint`.
    expect(gate).toMatch(/run_stage\s+\d+\s+"lint"\s+pnpm\s+lint/);
  });
});

describe('api prisma/ is inside both gates (PF-69)', () => {
  const apiManifest = JSON.parse(
    readFileSync(join(REPO_ROOT, 'apps', 'api', 'package.json'), 'utf8'),
  ) as { scripts: Record<string, string> };

  it('lints the whole package, not just {src,test}', () => {
    // The old glob was `eslint "{src,test}/**/*.ts"`, which excluded the ~2 900
    // lines under prisma/ — including the seed chain behind PF-17.
    expect(apiManifest.scripts.lint).toBe('eslint .');
  });

  it('typechecks prisma/ as well as src/', () => {
    expect(apiManifest.scripts.typecheck).toContain('-p prisma/tsconfig.json');
  });

  it('the prisma tsconfig actually includes the seed scripts', () => {
    const cfg = JSON.parse(
      readFileSync(join(REPO_ROOT, 'apps', 'api', 'prisma', 'tsconfig.json'), 'utf8'),
    ) as { include?: string[] };
    expect(cfg.include).toBeDefined();
    expect(cfg.include!.some((glob) => glob.includes('**/*.ts'))).toBe(true);
  });
});
