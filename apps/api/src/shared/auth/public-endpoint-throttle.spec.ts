import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  PublicEndpointFixedWindowThrottle,
  REGISTRATION_MAX_KEYS,
  REGISTRATION_TIER1_MAX,
  REGISTRATION_TIER2_MAX,
  REGISTRATION_WINDOW_MS,
  registrationIdentityKey,
  registrationThrottle,
  resetPublicEndpointThrottle,
} from './public-endpoint-throttle';

/**
 * S-E05-7 — the limiter half (`PF-46`, the unthrottled third · gates G-AUTHZ,
 * G-DNC · `ADR-038`).
 *
 * WHY EVERY CASE BELOW FAILS AGAINST THE PRE-FIX TREE
 * ---------------------------------------------------
 * Measured, not asserted: before this slice `apps/api/src` contained no limiter
 * guarding any public endpoint, no `@nestjs/throttler` dependency, and this file's
 * subject — `public-endpoint-throttle.ts` — did not exist. Every case here fails
 * at MODULE LOAD pre-fix, which is the strongest form of "fails before". The
 * cases that carry real information are therefore the ones that would fail
 * against a *plausible but wrong* limiter, and each is written to name which
 * wrong implementation it kills:
 *
 *   • `(b)` kills a per-key lazy expiry — the shape the brief's own wording
 *     invites — which leaves a busy window's stale keys in the map forever, trips
 *     the fail-closed capacity floor, and turns the product's only self-service
 *     signup path off until the process restarts. No attacker required.
 *   • `(c)` kills "insert the identity key, then check the global ceiling", which
 *     lets a rotating-address flood create exactly one key per admission-slot and
 *     reach the same permanent outage by a second route.
 *   • `(d)` kills "count attempts, not admissions", under which an attacker
 *     hammering ONE address exhausts the endpoint-wide ceiling and locks out
 *     everyone.
 *   • `(e)` kills LRU eviction, which would let an attacker flush their own
 *     counter by rotating addresses.
 *   • `(g)` kills a log line per refused request — the same unbounded per-request
 *     write the slice removes, in a different sink.
 *
 * NOT CLAIMED HERE: the HTTP shape (`register-throttle.guard.spec.ts`) and the
 * composed guard→handler amplification bound
 * (`register-throttle.supertest.spec.ts`). Reading a decision object is not
 * evidence about a route.
 */

const EMAIL = 'parent@exemple.fr';

/** A fresh instance per case, wired with the SHIPPED constants — never re-declared. */
function throttle(): PublicEndpointFixedWindowThrottle {
  return new PublicEndpointFixedWindowThrottle(
    REGISTRATION_WINDOW_MS,
    REGISTRATION_TIER1_MAX,
    REGISTRATION_TIER2_MAX,
    REGISTRATION_MAX_KEYS,
  );
}

const keyFor = (n: number): string => registrationIdentityKey(`p${n}@exemple.fr`) as string;

/* ================================================================== *
 * (a) — the two tiers, and the constants they are stated over
 * ================================================================== */

describe('(a) the two ceilings hold, and the relation between them is the memory proof', () => {
  it('AC-3b — the key capacity is STRICTLY greater than the global ceiling', () => {
    // Asserted as a RELATION rather than as two numbers: the whole
    // unreachable-by-construction argument is `size ≤ TIER2_MAX < MAX_KEYS`, and
    // a later edit that made them equal would silently re-open the outage `(b)`
    // and `(c)` exist to prevent.
    expect(REGISTRATION_MAX_KEYS).toBeGreaterThan(REGISTRATION_TIER2_MAX);
    expect(REGISTRATION_TIER2_MAX).toBeGreaterThan(REGISTRATION_TIER1_MAX);
  });

  it('AC-2 — the (TIER1_MAX + 1)th admission for the SAME address is refused', () => {
    const t = throttle();
    const key = registrationIdentityKey(EMAIL);

    for (let i = 0; i < REGISTRATION_TIER1_MAX; i += 1) {
      expect(t.admit(key, 0).admitted).toBe(true);
    }
    const refused = t.admit(key, 0);
    expect(refused.admitted).toBe(false);
    expect(refused.tier).toBe('identity');
  });

  it('AC-3 — TIER2_MAX + 1 requests with DIFFERENT addresses still trip, so rotation buys nothing', () => {
    // The case that proves the rotating-key evasion is closed: tier 1 never fires
    // here (one admission per address), so only the endpoint-wide ceiling can.
    const t = throttle();
    for (let i = 0; i < REGISTRATION_TIER2_MAX; i += 1) {
      expect(t.admit(keyFor(i), 0).admitted).toBe(true);
    }
    const refused = t.admit(keyFor(REGISTRATION_TIER2_MAX), 0);
    expect(refused.admitted).toBe(false);
    expect(refused.tier).toBe('global');
  });

  it('PM-7 — a fumbling parent still gets an account: 3 refused attempts then a 4th are all admitted', () => {
    // Guards run before the pipes, so a 400 (weak password) or a 409 spends
    // tier-1 budget. This pins the sizing decision as a CASE: if someone lowers
    // `REGISTRATION_TIER1_MAX` to 3, this goes red and they read why.
    const t = throttle();
    const key = registrationIdentityKey(EMAIL);
    for (let attempt = 0; attempt < 4; attempt += 1) {
      expect(t.admit(key, 0).admitted).toBe(true);
    }
  });
});

/* ================================================================== *
 * (b) — PM-1 · the sweep happens BEFORE the capacity test
 * ================================================================== */

describe('(b) PM-1 — a busy window does not leave the endpoint refusing forever', () => {
  it('AC-1a/AC-1b — after an idle window the map is empty and a FRESH address is admitted', () => {
    // The case a per-key lazy expiry passes only by accident and the brief's own
    // "case 3" (advance the clock for a PREVIOUSLY SEEN key) cannot detect: the
    // key asked about here was never in the map, so only a whole-map sweep
    // performed before the capacity test can make it admissible.
    const t = throttle();
    for (let i = 0; i < REGISTRATION_TIER2_MAX; i += 1) {
      expect(t.admit(keyFor(i), 0).admitted).toBe(true);
    }
    expect(t.trackedKeyCount()).toBe(REGISTRATION_TIER2_MAX);

    const decision = t.admit(keyFor(9999), REGISTRATION_WINDOW_MS);

    expect(decision.admitted).toBe(true);
    expect(t.trackedKeyCount()).toBe(1);
  });

  it('AC-5 — a previously REFUSED key is admitted again once the window rolls', () => {
    const t = throttle();
    const key = registrationIdentityKey(EMAIL);
    for (let i = 0; i < REGISTRATION_TIER1_MAX; i += 1) t.admit(key, 0);
    expect(t.admit(key, 0).admitted).toBe(false);

    // Injected clock, never `jest.useFakeTimers`: a window expiry that can only
    // be tested by waiting is a window expiry nobody tests.
    expect(t.admit(key, REGISTRATION_WINDOW_MS).admitted).toBe(true);
  });

  it('PM-9 — the fixed-window boundary admits up to 2× the ceiling across a rollover, by design', () => {
    // A DOCUMENTING case, not a defect report: pinned so the behaviour is chosen
    // rather than discovered. A sliding window is deliberately not built.
    const t = throttle();
    const last = REGISTRATION_WINDOW_MS - 1;
    let admitted = 0;
    for (let i = 0; i < REGISTRATION_TIER2_MAX; i += 1) {
      if (t.admit(keyFor(i), last).admitted) admitted += 1;
    }
    for (let i = 0; i < REGISTRATION_TIER2_MAX; i += 1) {
      if (t.admit(keyFor(1000 + i), REGISTRATION_WINDOW_MS).admitted) admitted += 1;
    }
    expect(admitted).toBe(REGISTRATION_TIER2_MAX * 2);
  });
});

/* ================================================================== *
 * (c)(d) — the ORDER of the two checks is load-bearing
 * ================================================================== */

describe('(c)(d) — tier 2 is evaluated first, and only ADMISSIONS are counted', () => {
  it('AC-3a/PM-3 — a flood of distinct addresses never creates more keys than the ceiling', () => {
    const t = throttle();
    const refusals: string[] = [];
    for (let i = 0; i < REGISTRATION_TIER2_MAX + 50; i += 1) {
      const decision = t.admit(keyFor(i), 0);
      if (!decision.admitted) refusals.push(decision.tier as string);
    }

    expect(t.trackedKeyCount()).toBe(REGISTRATION_TIER2_MAX);
    expect(t.trackedKeyCount()).toBeLessThan(REGISTRATION_MAX_KEYS);
    expect(refusals).toHaveLength(50);
    // Every refusal is the GLOBAL ceiling — never the saturation floor. A
    // saturation-flavoured refusal here would mean the capacity test is reachable
    // from ordinary traffic, i.e. the outage.
    expect(new Set(refusals)).toEqual(new Set(['global']));
  });

  it('AC-4/PM-3a — hammering ONE address does not consume anyone else’s budget', () => {
    // Counters count admissions. If a tier-1 refusal also incremented the global
    // counter, the 200 refusals below would exhaust the endpoint-wide ceiling and
    // lock out every other registrant — a per-identity bound converted into a
    // global outage.
    const t = throttle();
    const attacker = registrationIdentityKey('attacker@exemple.fr');
    for (let i = 0; i < REGISTRATION_TIER1_MAX + 200; i += 1) t.admit(attacker, 0);

    let admittedOthers = 0;
    for (let i = 0; i < REGISTRATION_TIER2_MAX; i += 1) {
      if (t.admit(keyFor(i), 0).admitted) admittedOthers += 1;
    }
    // The attacker's own admissions (TIER1_MAX) are the only global budget spent.
    expect(admittedOthers).toBe(REGISTRATION_TIER2_MAX - REGISTRATION_TIER1_MAX);
  });

  it('AC-7/AC-3c — a keyless request is admitted, counts against tier 2, and creates NO key', () => {
    const t = throttle();
    const bodies: unknown[] = [undefined, null, 42, {}, 'not-an-object', { email: 42 }, { email: '   ' }];
    for (const body of bodies) {
      const key = registrationIdentityKey((body as { email?: unknown } | undefined)?.email);
      expect(key).toBeNull();
      expect(t.admit(key, 0).admitted).toBe(true);
    }
    // Keyless traffic is never free (it still spends tier 2) and is never a route
    // to saturation (it inserts nothing).
    expect(t.trackedKeyCount()).toBe(0);
    for (let i = 0; i < REGISTRATION_TIER2_MAX - bodies.length; i += 1) t.admit(null, 0);
    expect(t.admit(null, 0).admitted).toBe(false);
  });
});

/* ================================================================== *
 * (e) — saturation fails CLOSED and never evicts
 * ================================================================== */

describe('(e) FR5 — the capacity floor refuses rather than evicting', () => {
  // Driven on a deliberately mis-sized instance, because the SHIPPED sizing makes
  // this state unreachable — which is the property `(c)` asserts. A branch nobody
  // can drive is a branch nobody has checked, so it is driven here explicitly.
  const tiny = (): PublicEndpointFixedWindowThrottle =>
    new PublicEndpointFixedWindowThrottle(REGISTRATION_WINDOW_MS, 5, 100, 2);

  it('refuses a NEW key at capacity, and the existing counters survive intact', () => {
    const t = tiny();
    expect(t.admit(keyFor(1), 0).admitted).toBe(true);
    expect(t.admit(keyFor(2), 0).admitted).toBe(true);

    const refused = t.admit(keyFor(3), 0);
    expect(refused.admitted).toBe(false);
    expect(refused.tier).toBe('saturated');
    expect(t.trackedKeyCount()).toBe(2);

    // NOT an LRU: the third key did not push the first one out, so an attacker
    // cannot flush their own counter by rotating addresses.
    expect(t.admit(keyFor(1), 0).admitted).toBe(true);
    expect(t.trackedKeyCount()).toBe(2);
  });
});

/* ================================================================== *
 * (f) — AC-8 · no plaintext address anywhere in the state
 * ================================================================== */

describe('(f) AC-8 — the key is a digest, normalised, and never the address', () => {
  it('is a sha256 hex digest of the trimmed + lowercased address', () => {
    const key = registrationIdentityKey('  PARENT@Exemple.FR ');
    expect(key).toBe(registrationIdentityKey(EMAIL));
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(key).not.toContain('parent');
    expect(key).not.toContain('@');
  });

  it('answers null for every shape that is not a usable address', () => {
    for (const value of [undefined, null, 42, {}, [], '', '   ', true]) {
      expect(registrationIdentityKey(value)).toBeNull();
    }
  });

  it('no plaintext address survives in the serialised limiter state', () => {
    const t = throttle();
    t.admit(registrationIdentityKey(EMAIL), 0);
    // Written against the obvious wrong implementation — a `Map<email, count>`.
    expect(JSON.stringify(t)).not.toContain(EMAIL);
    expect(JSON.stringify(t)).not.toContain('exemple.fr');
  });
});

/* ================================================================== *
 * (g) — PM-5 · refusal signalling is aggregated, not per request
 * ================================================================== */

describe('(g) PM-5 — the transition into refusing is signalled ONCE per window', () => {
  it('flags only the first refusal of each tier, and re-arms after the window rolls', () => {
    const t = throttle();
    const key = registrationIdentityKey(EMAIL);
    for (let i = 0; i < REGISTRATION_TIER1_MAX; i += 1) t.admit(key, 0);

    const flags = Array.from({ length: 25 }, () => t.admit(key, 0).firstRefusalOfWindow);
    expect(flags.filter(Boolean)).toHaveLength(1);
    expect(flags[0]).toBe(true);

    // A new window is a new incident and must be reportable again.
    for (let i = 0; i < REGISTRATION_TIER1_MAX; i += 1) t.admit(key, REGISTRATION_WINDOW_MS);
    expect(t.admit(key, REGISTRATION_WINDOW_MS).firstRefusalOfWindow).toBe(true);
  });
});

/* ================================================================== *
 * (h) — test isolation
 * ================================================================== */

describe('(h) — the shipped singleton can be reset, so no suite inherits another’s counters', () => {
  afterEach(() => resetPublicEndpointThrottle());

  it('reset clears both tiers and the key map', () => {
    const key = registrationIdentityKey(EMAIL);
    for (let i = 0; i < REGISTRATION_TIER1_MAX; i += 1) registrationThrottle.admit(key, 0);
    expect(registrationThrottle.admit(key, 0).admitted).toBe(false);
    expect(registrationThrottle.trackedKeyCount()).toBe(1);

    resetPublicEndpointThrottle();

    expect(registrationThrottle.trackedKeyCount()).toBe(0);
    expect(registrationThrottle.admit(key, 0).admitted).toBe(true);
  });
});

/* ================================================================== *
 * (i) — AC-9 · G-DNC / DNC-10, asserted structurally on the sources
 * ================================================================== */

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..', '..');
const SCRIPT_PATH = join(REPO_ROOT, 'scripts', 'link-integrity-check.js');
const LIMITER_PATH = join(REPO_ROOT, 'apps', 'api', 'src', 'shared', 'auth', 'public-endpoint-throttle.ts');
const GUARD_PATH = join(REPO_ROOT, 'apps', 'api', 'src', 'shared', 'auth', 'register-throttle.guard.ts');

/* eslint-disable @typescript-eslint/no-require-imports */
// Unguarded on purpose (DNC-08), following `shared/quality/audit-provenance-gate.spec.ts:113-120`:
// if the stripper disappears this suite must fail at LOAD rather than degrade
// into "nothing to check, therefore pass".
const { stripCommentsPreservingLines } = require(SCRIPT_PATH) as {
  stripCommentsPreservingLines: (source: string) => string;
};
/* eslint-enable @typescript-eslint/no-require-imports */

/**
 * The matchers, declared ONCE so the rules and the positive control below cannot
 * drift apart — the precedent at `audit-provenance-gate.spec.ts:149-153`.
 *
 * Three spellings of the same read, because a bare `/process\.env/` misses two of
 * them and a gate that cannot fail is not a gate.
 */
const ENVIRONMENT_READS: readonly RegExp[] = [
  /process\s*\.\s*env/,
  /process\s*\[\s*['"`]env['"`]\s*\]/,
  /(?:const|let|var)\s*\{[^}]*\benv\b[^}]*\}\s*=\s*process\b/,
  /\bNODE_ENV\b/,
];

/** The off-switch vocabulary DNC-10 forbids on a security bound. */
const OFF_SWITCH_TOKENS: readonly RegExp[] = [
  /\bSKIP_[A-Z0-9_]+/,
  /\bALLOW_[A-Z0-9_]+/,
  /\bBYPASS_[A-Z0-9_]+/,
  /\bFORCE_[A-Z0-9_]+/,
  /\bDISABLE[A-Z0-9_]*/i,
];

const SOURCES: ReadonlyArray<[string, string]> = [
  ['public-endpoint-throttle.ts', LIMITER_PATH],
  ['register-throttle.guard.ts', GUARD_PATH],
];

describe('(i) AC-9 / G-DNC — neither source reads the environment or ships an off switch', () => {
  // G-1 FIRST, mirroring `audit-provenance-gate.spec.ts:254`: a gate that read an
  // empty string satisfies every `not.toMatch` below forever.
  it('G-1 — the gate is not vacuous: both files exist and carry a real implementation', () => {
    for (const [name, path] of SOURCES) {
      expect(existsSync(path)).toBe(true);
      expect(readFileSync(path, 'utf8').length).toBeGreaterThan(2000);
      expect(name).toMatch(/\.ts$/);
    }
    expect(typeof stripCommentsPreservingLines).toBe('function');
  });

  it('G-1 — the matchers really fire, on a synthetic source rather than on a real one', () => {
    // A positive control on a FIXTURE, never on this file's own text: the spec
    // necessarily contains the forbidden strings as its own input, which is
    // exactly the `PF-83` trap the stripper exists for.
    const fixture = [
      'const a = process.env.SOMETHING;',
      "const b = process['env'];",
      'const { env } = process;',
      'if (NODE_ENV === "test") {}',
      'const c = SKIP_THROTTLE;',
      'const d = ALLOW_ANONYMOUS;',
      'const e = BYPASS_LIMIT;',
      'const f = FORCE_OPEN;',
      'const g = DISABLE_GUARD;',
    ].join('\n');
    for (const pattern of [...ENVIRONMENT_READS, ...OFF_SWITCH_TOKENS]) {
      expect(fixture).toMatch(pattern);
    }
  });

  it.each(SOURCES)('%s reads no environment value and carries no off switch', (_name, path) => {
    // Comment-stripped first (`PF-83`): both files EXPLAIN at length that they
    // read nothing from the environment, and a raw grep would go red on the
    // documentation of the rule it is enforcing.
    const executable = stripCommentsPreservingLines(readFileSync(path, 'utf8'));
    expect(executable.length).toBeGreaterThan(500);
    for (const pattern of [...ENVIRONMENT_READS, ...OFF_SWITCH_TOKENS]) {
      expect(executable).not.toMatch(pattern);
    }
  });

  it('the guard never returns a falsy verdict — Nest would turn that into a 403, not a 429', () => {
    const executable = stripCommentsPreservingLines(readFileSync(GUARD_PATH, 'utf8'));
    expect(executable).not.toMatch(/return\s+false/);
    expect(executable).toMatch(/HttpStatus\.TOO_MANY_REQUESTS/);
  });
});
