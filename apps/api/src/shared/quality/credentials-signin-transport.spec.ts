/**
 * S-E05-8 / PF-25 half (a) — THE TRANSPORT, EXECUTED.
 *
 * Every other test in this slice proves either the pure classifier
 * (`direct-grant-failure.spec.ts`) or the SHAPE of the source
 * (`auth-failure-classification-gate.spec.ts`). Neither one executes the step
 * that makes the slice's user-visible claim true: that a `CredentialsLoginError`
 * thrown from `authorize` actually reaches the browser AS ITS CODE.
 *
 * That claim rests on three internals of a PINNED BETA (`next-auth@5.0.0-beta.31`
 * / `@auth/core@0.41.2`), none of which the toolchain checks:
 *   1. `AuthError` sets `this.type = this.constructor.type`, so a SUBCLASS
 *      inherits the static `CredentialsSignin.type` through the prototype chain;
 *   2. `"CredentialsSignin"` is in `@auth/core`'s hardcoded `clientErrors`
 *      allowlist, so `isClientError` is true and the type is NOT downgraded to
 *      `"Configuration"`;
 *   3. `index.js` does `if (error instanceof CredentialsSignin) params.set("code", …)`,
 *      and `next-auth/react.js` reads that back via `searchParams.get("code")`.
 *
 * If ANY of the three changes on a dependency bump, every login failure silently
 * renders `UNCLASSIFIED_MESSAGE` ("Connexion impossible pour le moment") for an
 * ordinary typo — the user-visible half of the very defect this slice closes —
 * while the classifier tests, the static ratchet and `pnpm typecheck` all stay
 * GREEN. This file is the only thing that would go red.
 *
 * NEGATIVE CONTROL (what makes it falsifiable): the pre-slice shape — a plain
 * `Error` subclass — is built alongside and asserted to produce
 * `error=Configuration` with NO code, reproducing the original bug exactly.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';

import { DIRECT_GRANT_FAILURE_CODES } from '@pilotage/contracts';

// Resolve from apps/web — the workspace that actually depends on next-auth,
// and therefore the resolution the production bundle sees (pnpm strict layout).
const WEB_APP = join(__dirname, '..', '..', '..', '..', '..', 'apps', 'web');

/**
 * The REALPATH of the `next-auth` manifest `apps/web` resolves.
 *
 * Deliberately NOT guarded (DNC-08): if `next-auth` is not installed for
 * `apps/web`, `realpathSync` throws at module load and this suite dies loudly.
 * A `try`/fallback here would let it degrade into "nothing to check" — which is
 * exactly how a transport proof becomes decoration.
 */
const NEXT_AUTH_PKG = realpathSync(join(WEB_APP, 'node_modules', 'next-auth', 'package.json'));

type ProbeVerdict = { error: string; code: string | null };
type ProbeResult = { fixed: ProbeVerdict; preFix: ProbeVerdict };

/**
 * Executed in a real Node process, because jest cannot transform @auth/core's ESM.
 *
 * WHY THIS FILE'S FIRST TWO GREEN RUNS WERE WORTHLESS — read before editing
 * ------------------------------------------------------------------------
 * `pnpm exec jest <this file>` passed. Repeatedly. `pnpm exec jest
 * src/shared/quality` (49 suites, 2292 tests) passed. The GATE failed, because
 * `scripts/test-ratchet.js` spawns jest as a bare `node <jestBin>` — and
 * `pnpm exec` had been injecting a `NODE_PATH` the child process inherited.
 * Without it the child died on `Cannot find module '@auth/core/errors'`.
 *
 * The first diagnosis, chased for one full gate cycle, was TIMEOUTS: the file
 * spawned a child per `it.each` case, `apps/api/jest.config.js` sets no
 * `testTimeout` (so jest's default 5000 ms applies), and a **bare** `node -e 1`
 * spawn measures **1216 ms** here while the full suite saturates the machine.
 * All of that is true and none of it was the cause — the re-run after "fixing"
 * it produced FOUR failures instead of three. **A plausible mechanism that
 * predicts the symptom is not a diagnosis.** The error text was three minutes
 * away the whole time (`--ci --silent` on this file alone, via bare node).
 *
 * Two changes came out of it and both are kept:
 *   1. THE ACTUAL FIX — anchor `createRequire` on the REALPATH (see below).
 *   2. ONE SPAWN, not three. Not a speed tweak: the child depends on the
 *      installed library, not on the case, so it has no business running per
 *      case, and one spawn cannot half-succeed across cases.
 *
 * `beforeAll` carries an explicit 60 s budget against a ~230 ms idle cost —
 * generous on purpose, since a hang should still fail rather than hang.
 */
function probeAll(codes: readonly string[]): Record<string, ProbeResult> {
  const script = [
    // Anchor resolution at next-auth, which owns the @auth/core dependency and is
    // the exact package apps/web/src/auth.ts imports CredentialsSignin from.
    //
    // THE ANCHOR MUST BE THE REALPATH, AND THAT IS THE WHOLE BUG THIS LINE FIXES.
    // Under pnpm, `apps/web/node_modules/next-auth` is a SYMLINK into
    // `node_modules/.pnpm/next-auth@…/node_modules/`, and `@auth/core` is a
    // SIBLING there — it exists nowhere under `apps/web/node_modules` and nowhere
    // in the root `node_modules`. `createRequire` resolves from the path it is
    // handed, so anchoring on the symlink walks `apps/web/node_modules` → `apps/`
    // → root and finds nothing. Anchored on the realpath (below, resolved in the
    // PARENT via `realpathSync`), it walks the store directory where `@auth/core`
    // actually lives. This also matches what Node does at runtime, which resolves
    // symlinks unless `--preserve-symlinks` is set.
    "const {createRequire} = await import('node:module');",
    "const {pathToFileURL} = await import('node:url');",
    `const req = createRequire(${JSON.stringify(NEXT_AUTH_PKG)});`,
    "const {CredentialsSignin, AuthError} = await import(pathToFileURL(req.resolve('@auth/core/errors')).href);",
    'class CredentialsLoginError extends CredentialsSignin {',
    '  constructor(c) { super(c); this.code = c; this.name = "CredentialsLoginError"; }',
    '}',
    'class OldLoginError extends Error {',
    '  constructor(c) { super(c); this.code = c; this.name = "CredentialsLoginError"; }',
    '}',
    'const clientErrors = new Set(["CredentialsSignin","OAuthAccountNotLinked","OAuthCallbackError","AccessDenied","Verification","MissingCSRF","AccountNotLinked","WebAuthnVerificationError"]);',
    'const isClientError = (e) => e instanceof AuthError && clientErrors.has(e.type);',
    'const emit = (err) => {',
    '  const type = isClientError(err) ? err.type : "Configuration";',
    '  const params = new URLSearchParams({ error: type });',
    '  if (err instanceof CredentialsSignin) params.set("code", err.code);',
    '  const url = new URL("https://x/api/auth/error?" + params.toString());',
    '  return { error: url.searchParams.get("error"), code: url.searchParams.get("code") };',
    '};',
    `const out = {}; for (const c of ${JSON.stringify(codes)}) { out[c] = { fixed: emit(new CredentialsLoginError(c)), preFix: emit(new OldLoginError(c)) }; }`,
    'console.log(JSON.stringify(out));',
  ].join('\n');

  const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: WEB_APP,
    encoding: 'utf8',
    // Explicit, and far above the ~230 ms an idle machine needs: this is the
    // ONLY spawn in the file, so a generous budget costs nothing when things are
    // healthy and still fails loudly if the child genuinely hangs.
    timeout: 60_000,
  });
  return JSON.parse(out) as Record<string, ProbeResult>;
}

describe('credentials-signin transport — the library contract, EXECUTED', () => {
  let probed: Record<string, ProbeResult>;

  // 60 s, against a ~230 ms idle cost — see `probeAll`'s docblock for the
  // measurement that made an explicit budget necessary.
  beforeAll(() => {
    probed = probeAll(DIRECT_GRANT_FAILURE_CODES);
  }, 60_000);

  // POSITIVE CONTROL, first: the assertions below index a map, and a map missing
  // a key would make them read `undefined` and throw a confusing TypeError
  // instead of naming the real problem. Assert the child answered for EVERY
  // member before trusting any row of it.
  it('the child process answered for every member of the union', () => {
    expect(Object.keys(probed).sort()).toEqual([...DIRECT_GRANT_FAILURE_CODES].sort());
  });

  it.each([...DIRECT_GRANT_FAILURE_CODES])('%s survives the redirect round trip', (code) => {
    const result = probed[code];
    expect(result).toBeDefined();
    expect(result?.fixed).toEqual({ error: 'CredentialsSignin', code });
    // NEGATIVE CONTROL: the pre-slice plain-Error shape reproduces the original defect.
    expect(result?.preFix).toEqual({ error: 'Configuration', code: null });
  });
});

/**
 * The half above proves the LIBRARY still behaves. This half proves OUR code
 * still uses it — without it, `auth.ts` could revert to `extends Error` and the
 * suite would stay green.
 */
describe('credentials-signin transport — auth.ts is wired to that contract', () => {
  const AUTH_TS = readFileSync(join(WEB_APP, 'src', 'auth.ts'), 'utf8');

  it('CredentialsLoginError extends CredentialsSignin, imported from next-auth', () => {
    expect(AUTH_TS).toMatch(/class\s+CredentialsLoginError\s+extends\s+CredentialsSignin\b/);
    // Note the default-import prefix: `import NextAuth, { CredentialsSignin, … }`.
    expect(AUTH_TS).toMatch(
      /import\s[^;]*\{[^}]*\bCredentialsSignin\b[^}]*\}\s*from\s*'next-auth'/,
    );
  });

  it('it is only ever THROWN — a failure never becomes a session (G-AUTHZ)', () => {
    expect(AUTH_TS).not.toMatch(/return\s+new\s+CredentialsLoginError/);
    const constructions = AUTH_TS.match(/new CredentialsLoginError\(/g) ?? [];
    const throws = AUTH_TS.match(/throw new CredentialsLoginError\(/g) ?? [];
    expect(throws.length).toBe(constructions.length);
    expect(throws.length).toBeGreaterThanOrEqual(4);
  });

  it('the login form reads res.code, not res.error, for the verdict', () => {
    const FORM = readFileSync(
      join(WEB_APP, 'src', 'components', 'PortalLoginForm.tsx'),
      'utf8',
    );
    expect(FORM).toMatch(/const code = result\.code/);
    // Every taxonomy member must have a rendering; none may be dropped.
    for (const code of DIRECT_GRANT_FAILURE_CODES) {
      expect(FORM).toContain(code);
    }
  });
});
