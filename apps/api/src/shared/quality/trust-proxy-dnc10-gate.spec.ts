import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

/**
 * S-E04-3 / AC-5, AC-7, AC-12 (DNC-10) — the hop count has ONE home, ONE shape,
 * and no way out.
 *
 * WHY A SEPARATE FILE FROM `audit-provenance-gate.spec.ts`
 * -------------------------------------------------------
 * That file guards *who acted and through which portal*; this one guards *how
 * the transport is trusted*. They are different invariants with different
 * owners, and `S-E04-1` spent a whole slice collapsing rules that had grown two
 * homes — so a rule stated here is not restated there.
 *
 * WHAT IS ACTUALLY BEING PREVENTED (the inversion, written down)
 * -------------------------------------------------------------
 * Nobody re-enables blanket proxy trust by adding `SKIP_TRUST_PROXY=1`. They do
 * it in one of three ways, and each has a rule below:
 *
 *  1. **`app.set('trust proxy', true)` / `'*'` / `'loopback'`** — the Express
 *     values that mean « believe the leftmost `X-Forwarded-For` entry from any
 *     caller ». `ADR-036` D1 refuses them in writing; here they are refused by
 *     test, over the whole of `apps/api/src`.
 *  2. **A literal.** `app.set('trust proxy', 2)` is right in production and
 *     silently wrong locally, where `N = 0`. The value must always be the
 *     parsed key, never a number written in source.
 *  3. **A deep count.** `TRUST_PROXY_HOPS=99` is operationally identical to
 *     `true` on every real chain. Bounded by `MAX_TRUST_PROXY_HOPS`, whose
 *     behavioural table lives in `shared/config/trust-proxy.spec.ts`; what is
 *     asserted here is that the bound EXISTS and is applied.
 *
 * Each rule ships with a **companion showing it can go RED**: a guard that has
 * never been shown red is a guard we hope works (`PF-109`, `S-E02-18`).
 *
 * The declaration half is asserted too — a required key that is declared nowhere
 * does not fail safe, it fails to boot, and `compose-invocation-gate.spec.ts`
 * only checks `${VAR:?}` forms against `.env.example`. Here the four declaration
 * sites are checked against each other by name.
 */

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..', '..');
const SCRIPT_PATH = join(REPO_ROOT, 'scripts', 'link-integrity-check.js');
const API_SRC = join(REPO_ROOT, 'apps', 'api', 'src');
const WALK_READ_PATH = join(REPO_ROOT, 'scripts', 'lib', 'walk-read.js');

/* eslint-disable @typescript-eslint/no-require-imports */
// Unguarded on purpose (DNC-08): if the stripper disappears, this suite must
// fail at LOAD rather than degrade into "nothing to check, therefore pass".
const { stripCommentsPreservingLines } = require(SCRIPT_PATH) as {
  stripCommentsPreservingLines: (source: string) => string;
};
/**
 * TOOL-17 — the shared walk-then-read seam. Unguarded for the SAME reason: a
 * MISSING MODULE is a different seam from a VANISHING WALKED FILE, and only the
 * second one is tolerated. See `scripts/lib/walk-read.js` for the four-step
 * tolerance and why it is not a blanket catch.
 */
const { mapWalkedFiles, warnSkipped, MAX_VANISHED_FILES } = require(WALK_READ_PATH) as {
  mapWalkedFiles: (
    paths: string[],
    build: (path: string, source: string) => [string, string],
  ) => { entries: [string, string][]; skipped: string[] };
  warnSkipped: (label: string, skipped: string[]) => boolean;
  MAX_VANISHED_FILES: number;
};
/* eslint-enable @typescript-eslint/no-require-imports */

function walk(root: string): string[] {
  const files: string[] = [];
  if (!existsSync(root)) return files;
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (['node_modules', '.turbo', 'dist', 'coverage'].includes(entry.name)) continue;
        stack.push(join(current, entry.name));
      } else if (entry.name.endsWith('.ts')) {
        files.push(join(current, entry.name));
      }
    }
  }
  return files.sort();
}

const repoRel = (file: string): string => relative(REPO_ROOT, file).split(sep).join('/');
const API_FILES = walk(API_SRC);
// TOOL-17: routed through the shared seam. A file listed by `walk()` above and
// deleted before its read (a sibling spec's probe) no longer crashes this suite
// at LOAD; every other errno still throws, unwrapped.
const { entries: EXECUTABLE_ENTRIES, skipped: VANISHED_API_FILES } = mapWalkedFiles(
  API_FILES,
  (file, source) => [repoRel(file), stripCommentsPreservingLines(source)],
);
warnSkipped('trust-proxy-dnc10-gate / apps/api/src', VANISHED_API_FILES);
const EXECUTABLE = new Map<string, string>(EXECUTABLE_ENTRIES);
/**
 * Specs are excluded from the source rules on purpose and bounded the same way
 * `audit-provenance-gate.spec.ts` bounds its own exclusions: the two specs that
 * legitimately spell the forbidden shapes (as their own inputs) are asserted to
 * TRIP the matchers below, so the exclusion is load-bearing rather than
 * decorative — and no production file may import a `*.spec.ts`.
 */
const PRODUCTION = [...EXECUTABLE].filter(([path]) => !path.endsWith('.spec.ts'));

const TRUST_PROXY_REL = 'apps/api/src/shared/config/trust-proxy.ts';
const MAIN_REL = 'apps/api/src/main.ts';

/* ================================================================== *
 * The matchers — declared once, so the rules and their companions
 * CANNOT drift apart.
 * ================================================================== */

/** `app.set('trust proxy', true | '*' | 'loopback' | <cidr>)` — ADR-036 D1. */
export function declaresBlanketProxyTrust(source: string): boolean {
  return /trust\s?proxy['"]\s*,\s*(?:true|['"](?:\*|loopback|linklocal|uniquelocal|\d[\d.]*\/\d+)['"])/.test(
    source,
  );
}

/** `app.set('trust proxy', 2)` — a deployment property written into the source. */
export function declaresHopCountLiteral(source: string): boolean {
  return /\.set\(\s*['"]trust\s?proxy['"]\s*,\s*\d/.test(source);
}

/**
 * `Number(process.env.TRUST_PROXY_HOPS ?? 2)` and every `??` / `||` fallback
 * variant of it — `ADR-036` D3's specifically-forbidden shape.
 *
 * Scoped to the hop count on purpose. A blanket ban on `Number(process.env…)`
 * would redden on `main.ts:120`'s `Number(process.env.PORT ?? 4000)`, which is a
 * perfectly good default for a value whose wrongness is immediately visible.
 * The hop count is different precisely because its wrongness is *silent*, so
 * the rule is stated about it and not about coercion in general — a rule that
 * reddened on unrelated correct code would be `PF-83` in the gate itself.
 */
export function declaresCoercedHopCount(source: string): boolean {
  return (
    /(?:Number|parseInt)\(\s*[^)\n]*TRUST_PROXY_HOPS/.test(source) ||
    /TRUST_PROXY_HOPS[^\n]*(?:\?\?|\|\|)/.test(source)
  );
}

describe('G-1 — this guard is not vacuous', () => {
  it('walked apps/api/src and found a real application', () => {
    expect(API_FILES.length).toBeGreaterThanOrEqual(200);
    expect(PRODUCTION.length).toBeGreaterThanOrEqual(150);
    // TOOL-17 accounting. The two floors above are asserted on the WALK LIST, and
    // a tolerated skip shrinks the MAP, not the list — so on their own they would
    // still pass over a corpus that had silently emptied. These two lines carry
    // the floors onto the read map: nothing is lost except a confirmed-vanished
    // file, and at most `MAX_VANISHED_FILES` of those. Deliberately NOT
    // `toBe(0)` — that would move the flake from LOAD to assert time.
    expect(EXECUTABLE.size + VANISHED_API_FILES.length).toBe(API_FILES.length);
    expect(VANISHED_API_FILES.length).toBeLessThanOrEqual(MAX_VANISHED_FILES);
  });

  it('the file it exists to guard is present and non-trivial', () => {
    expect((EXECUTABLE.get(TRUST_PROXY_REL) ?? '').length).toBeGreaterThan(500);
    expect((EXECUTABLE.get(MAIN_REL) ?? '').length).toBeGreaterThan(500);
  });

  it('no production file imports a *.spec.ts — an excluded file configures nothing real', () => {
    const offenders = PRODUCTION.filter(([, s]) =>
      /(?:from|require\()\s*['"][^'"]*\.spec['"]/.test(s),
    ).map(([path]) => path);
    expect(offenders).toEqual([]);
  });
});

describe('AC-7 / ADR-036 D1 — the blanket forms appear NOWHERE in apps/api', () => {
  it('no production file declares blanket proxy trust', () => {
    const offenders = PRODUCTION.filter(([, s]) => declaresBlanketProxyTrust(s)).map(([p]) => p);
    expect(offenders).toEqual([]);
  });

  it('no production file passes a hop-count LITERAL to app.set', () => {
    const offenders = PRODUCTION.filter(([, s]) => declaresHopCountLiteral(s)).map(([p]) => p);
    expect(offenders).toEqual([]);
  });

  it('no production file coerces the hop count out of the environment', () => {
    const offenders = PRODUCTION.filter(([, s]) => declaresCoercedHopCount(s)).map(([p]) => p);
    expect(offenders).toEqual([]);
  });

  it('COMPANION — every matcher above FIRES on the shape it forbids', () => {
    // Without this block the three rules above are satisfied by a matcher that
    // matches nothing, forever, silently.
    expect(declaresBlanketProxyTrust("app.set('trust proxy', true);")).toBe(true);
    expect(declaresBlanketProxyTrust('app.set("trust proxy", "*");')).toBe(true);
    expect(declaresBlanketProxyTrust("app.set('trust proxy', 'loopback');")).toBe(true);
    expect(declaresBlanketProxyTrust("app.set('trust proxy', '10.0.0.0/8');")).toBe(true);
    expect(declaresHopCountLiteral("app.set('trust proxy', 2);")).toBe(true);
    expect(declaresHopCountLiteral('app.set("trust proxy", 0);')).toBe(true);
    expect(declaresCoercedHopCount('const n = Number(process.env.TRUST_PROXY_HOPS ?? 2);')).toBe(true);
    expect(declaresCoercedHopCount("const n = process.env.TRUST_PROXY_HOPS || '2';")).toBe(true);
    expect(declaresCoercedHopCount('parseInt(process.env.TRUST_PROXY_HOPS, 10)')).toBe(true);

    // …and NONE of them fires on the shipped form, which passes a parsed
    // variable that came from a refusing key. A rule that reddened on the fix
    // would be PF-83 inside the file written to prevent it.
    const shipped = "const hops = resolveTrustProxyHops(env);\n  app.set('trust proxy', hops);";
    expect(declaresBlanketProxyTrust(shipped)).toBe(false);
    expect(declaresHopCountLiteral(shipped)).toBe(false);
    expect(declaresCoercedHopCount(shipped)).toBe(false);
  });

  it('the two specs that legitimately quote the forbidden shapes really DO trip the matchers', () => {
    // Bounds the spec exclusion: if these stopped tripping, the exclusion would
    // be protecting nothing and the matchers themselves would be suspect.
    const quoting = [
      'apps/api/src/shared/quality/trust-proxy-dnc10-gate.spec.ts',
      'apps/api/src/shared/config/trust-proxy.spec.ts',
    ];
    for (const path of quoting) {
      expect(EXECUTABLE.has(path)).toBe(true);
    }
    expect(declaresBlanketProxyTrust(EXECUTABLE.get(quoting[0] as string) ?? '')).toBe(true);
  });
});

describe('AC-6 — `trust proxy` is applied exactly once, from a refusing key', () => {
  it('exactly ONE production file calls app.set(\'trust proxy\', …)', () => {
    const setters = PRODUCTION.filter(([, s]) => /\.set\(\s*['"]trust\s?proxy['"]/.test(s)).map(
      ([p]) => p,
    );
    expect(setters).toEqual([TRUST_PROXY_REL]);
  });

  it('main.ts delegates — it holds no hop count of its own', () => {
    const main = EXECUTABLE.get(MAIN_REL) ?? '';
    expect(main).toMatch(/applyTrustProxy\(app, process\.env\)/);
    expect((main.match(/applyTrustProxy\(/g) ?? []).length).toBe(1);
    expect(declaresHopCountLiteral(main)).toBe(false);
    expect(declaresBlanketProxyTrust(main)).toBe(false);
  });

  it('the parser is strict AND bounded — an unbounded count is `true` by another name', () => {
    const parser = EXECUTABLE.get(TRUST_PROXY_REL) ?? '';
    expect(parser).toMatch(/\/\^\\d\+\$\//);
    expect(parser).toMatch(/const MAX_TRUST_PROXY_HOPS = \d+;/);
    expect(parser).toMatch(/hops > MAX_TRUST_PROXY_HOPS/);
    // Refuses rather than clamps: a clamp would accept 99 and silently store 2,
    // hiding an operator error behind a plausible configuration.
    expect(parser).not.toMatch(/Math\.min|Math\.max|clamp/);
  });

  it('no escape hatch exists in either file — DNC-10 as an ABSENCE', () => {
    for (const path of [TRUST_PROXY_REL, MAIN_REL]) {
      const source = EXECUTABLE.get(path) ?? '';
      for (const needle of ['SKIP_', 'ALLOW_', 'BYPASS_', 'FORCE_TRUST', 'TRUST_PROXY_OVERRIDE']) {
        expect(source).not.toContain(needle);
      }
    }
    // NODE_ENV is read in main.ts (Swagger + CSP, S-E06-2) but must never gate
    // the hop count — so the rule is stated where it can be absolute.
    expect(EXECUTABLE.get(TRUST_PROXY_REL) ?? '').not.toContain('NODE_ENV');
    expect(EXECUTABLE.get(TRUST_PROXY_REL) ?? '').not.toContain('process.env');
  });
});

describe('AC-6 — the key is DECLARED everywhere the API boots', () => {
  const read = (rel: string): string => {
    const path = join(REPO_ROOT, rel);
    // Unguarded on purpose: a missing declaration file must fail loudly here
    // rather than let this suite pass on an empty string.
    return readFileSync(path, 'utf8');
  };

  // The lookbehind is load-bearing since S-E04-3 shipped `WEB_TRUST_PROXY_HOPS`
  // into the same two files: without it, an unanchored `TRUST_PROXY_HOPS:` match
  // is satisfied by the WEB declaration, and the API key could be deleted from
  // both compose files with this block still green.
  const API_REFUSING = /(?<![A-Z_])TRUST_PROXY_HOPS:\s*\$\{TRUST_PROXY_HOPS:\?/;

  it('infra/docker-compose.yml declares it on the shared app-env anchor, in the REFUSING form', () => {
    const compose = read('infra/docker-compose.yml');
    expect(compose).toMatch(API_REFUSING);
  });

  it('infra/docker-compose.prod.yml declares it on the api service, in the REFUSING form', () => {
    expect(read('infra/docker-compose.prod.yml')).toMatch(API_REFUSING);
  });

  it.each(['.env.example', '.env.prod.example', 'apps/api/.env.example'])(
    '%s declares TRUST_PROXY_HOPS with a value',
    (rel) => {
      expect(read(rel)).toMatch(/^TRUST_PROXY_HOPS=\d+\s*$/m);
    },
  );

  it('the two topologies carry the two values ADR-036 D2 pinned', () => {
    // The whole reason the key exists: one literal would be silently wrong in
    // one of them. If these two ever agree, the key has stopped earning itself.
    expect(read('.env.example')).toMatch(/^TRUST_PROXY_HOPS=0\s*$/m);
    expect(read('.env.prod.example')).toMatch(/^TRUST_PROXY_HOPS=2\s*$/m);
  });

  it('AUDIT_FORWARD_TOKEN is declared PERMISSIVE, never refusing — the asymmetry is the decision', () => {
    // ADR-036 D9. Refusing on the token would stop an operator who has not yet
    // distributed the secret from booting at all — the pressure that produced
    // PF-54's `?? 'admin'`. Its absence is fail-safe; the hop count's is not.
    const compose = read('infra/docker-compose.yml');
    expect(compose).toMatch(/AUDIT_FORWARD_TOKEN:\s*\$\{AUDIT_FORWARD_TOKEN:-\}/);
    expect(compose).not.toMatch(/AUDIT_FORWARD_TOKEN:\s*\$\{AUDIT_FORWARD_TOKEN:\?/);
  });

  // ---------------------------------------------------------------------------
  // The WEB half of the same decision (ADR-036 D10).
  //
  // Why this block exists at all: `WEB_TRUST_PROXY_HOPS` shipped declared in
  // EXACTLY ONE file — the source that reads it. Its reader falls back to `0`
  // (safe: a blank, never a relay address), so nothing failed, nothing crashed,
  // and no test went red — `x-pilotage-client-ip` was simply never emitted in any
  // containerised deployment and `AuditLog.ipAddress` stayed NULL forever. That
  // is why the assertion below is stated as « declared somewhere OTHER than the
  // file that reads it »: it is the shape of the defect, not the instance.
  //
  // It lives in the API suite, beside its twin, on purpose. The two keys only
  // make sense read together — the whole reason there are two is that the two
  // paths have different depths — and splitting the parity check across two
  // packages is how one half drifts unnoticed.
  // ---------------------------------------------------------------------------
  const WEB_KEY = 'WEB_TRUST_PROXY_HOPS';

  it('is declared in a file OTHER than the one that reads it — the S-E04-3 defect, as a rule', () => {
    const declarations = [
      'infra/docker-compose.yml',
      'infra/docker-compose.prod.yml',
      '.env.example',
      '.env.prod.example',
    ].filter((rel) => read(rel).includes(WEB_KEY));
    expect(declarations).toHaveLength(4);
  });

  it('both compose files declare the WEB key on the web service, in the REFUSING form', () => {
    // Refusing even though the reader is permissive, and BECAUSE it is: the
    // fallback to `0` is the safe direction but an invisible one, so the failure
    // is moved to the one place it costs nothing — the operator's terminal, at
    // the compose command — rather than a `console.warn` nobody reads.
    const refusing = new RegExp(`${WEB_KEY}:\\s*\\$\\{${WEB_KEY}:\\?`);
    expect(read('infra/docker-compose.yml')).toMatch(refusing);
    expect(read('infra/docker-compose.prod.yml')).toMatch(refusing);
  });

  it('the two topologies carry two DIFFERENT web hop counts — 0 local, 2 prod', () => {
    // Same argument as the API key two tests up: if these ever agree, one literal
    // would have done, and the key has stopped earning itself.
    expect(read('.env.example')).toMatch(new RegExp(`^${WEB_KEY}=0\\s*$`, 'm'));
    expect(read('.env.prod.example')).toMatch(new RegExp(`^${WEB_KEY}=2\\s*$`, 'm'));
  });

  it('the WEB key is NOT the API key under another name — neither may satisfy the other', () => {
    // `apps/api` must never read the web count, and the web count must never be
    // spelled onto the shared `x-app-env` anchor, where it would reach `migrator`
    // and `seed` — services that render no page and can claim no client.
    const compose = read('infra/docker-compose.yml');
    const anchor = compose.slice(
      compose.indexOf('x-app-env:'),
      compose.indexOf('\nservices:'),
    );
    expect(anchor).toContain('TRUST_PROXY_HOPS:');
    expect(anchor).not.toContain(WEB_KEY);
  });

  it('no .env template carries a real-looking forward token — placeholders only', () => {
    for (const rel of ['.env.example', '.env.prod.example', 'apps/api/.env.example']) {
      const line = read(rel)
        .split(/\r?\n/)
        .find((l) => l.startsWith('AUDIT_FORWARD_TOKEN='));
      if (line === undefined) continue;
      expect(line).toMatch(/^AUDIT_FORWARD_TOKEN=(|__CHANGE_ME__.*|change-me.*)$/);
    }
  });
});
