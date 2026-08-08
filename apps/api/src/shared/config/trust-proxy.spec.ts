import {
  InvalidConfigError,
  MAX_TRUST_PROXY_HOPS,
  TRUST_PROXY_HOPS_ENV,
  applyTrustProxy,
  parseTrustProxyHops,
  resolveTrustProxyHops,
} from './trust-proxy';

/**
 * S-E04-3 / AC-5, AC-6, AC-8 (DNC-10) — the hop count refuses, strictly, and
 * cannot be relaxed.
 *
 * The inversion that shapes this file: *how would someone turn `trust proxy`
 * back on?* Not with a `SKIP_*` variable — with `TRUST_PROXY_HOPS=99`, or with
 * one of the values Express itself accepts (`true`, `'*'`, `'loopback'`,
 * `'10.0.0.0/8'`), or by relying on `Number()` to coerce `'2.0'` / `'1e1'` /
 * `'0x2'` / `''`. Every one of those is a table row below, and each must throw.
 */

describe('parseTrustProxyHops — accepts a bounded decimal integer literal and NOTHING else', () => {
  const ACCEPTED: [string, number][] = [
    ['0', 0],
    ['1', 1],
    ['2', 2],
    // A trim is the ONE tolerance: compose and .env files pick up trailing
    // whitespace, and refusing that would punish the operator for their editor
    // rather than for a wrong decision.
    ['  2  ', 2],
    ['2\n', 2],
  ];

  it.each(ACCEPTED)('parseTrustProxyHops(%j) → %i', (raw, expected) => {
    expect(parseTrustProxyHops(raw)).toBe(expected);
  });

  const REFUSED: [string, string][] = [
    // ---- the Number() coercions ADR-036 D3 names, one by one ----------------
    ['', "'' would coerce to 0 — a pin that looks valid and means 'the operator forgot'"],
    ['   ', 'whitespace only'],
    ['2.0', 'Number() accepts it; a hop count is not a float'],
    ['+2', 'Number() accepts an explicit sign'],
    ['-1', 'negative hops describe no topology'],
    ['1e1', 'exponential notation coerces to 10'],
    ['0x2', 'hexadecimal coerces to 2'],
    ['0b10', 'binary coerces to 2'],
    // ---- the Express values that MEAN blanket trust (ADR-036 D1) -----------
    ['true', 'the refused blanket form, spelled as a string'],
    ['*', 'the refused blanket form, spelled as a wildcard'],
    ['loopback', 'a valid Express trust value, and not a hop count'],
    ['10.0.0.0/8', 'a valid Express trust value, and not a hop count'],
    // ---- the bound: a deep count IS blanket trust on every real chain ------
    ['3', 'deeper than any topology this repository defines'],
    ['99', 'operationally identical to trust proxy: true'],
    // ---- plain garbage -----------------------------------------------------
    ['two', 'not a number at all'],
    ['2 hops', 'a number with a suffix — parseInt would have taken the 2'],
    ['2,0', 'decimal comma'],
  ];

  it.each(REFUSED)('refuses %j (%s)', (raw) => {
    expect(() => parseTrustProxyHops(raw)).toThrow(InvalidConfigError);
  });

  it('refuses `undefined` — there is no fallback literal anywhere', () => {
    expect(() => parseTrustProxyHops(undefined)).toThrow(InvalidConfigError);
  });

  it('the maximum is the deepest topology this repository defines', () => {
    // Guard of the guard: raising MAX without re-deriving N (ADR-036 D7) would
    // silently re-open the padding hole the bound exists to close.
    expect(MAX_TRUST_PROXY_HOPS).toBe(2);
    expect(parseTrustProxyHops(String(MAX_TRUST_PROXY_HOPS))).toBe(MAX_TRUST_PROXY_HOPS);
    expect(() => parseTrustProxyHops(String(MAX_TRUST_PROXY_HOPS + 1))).toThrow(InvalidConfigError);
  });

  it('names the KEY and the SHAPE, and never echoes the value (config-preflight.ts leak rule)', () => {
    // The message reaches stdout, the collected logs and the trace pipeline
    // (S-E02-14). `TRUST_PROXY_HOPS` sits in the same environment record as the
    // Keycloak admin password; a module that echoed one value would echo any.
    const secretish = 'sup3rSecretLookingValue';
    try {
      parseTrustProxyHops(secretish);
      throw new Error('expected a throw');
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidConfigError);
      const message = (err as Error).message;
      expect(message).toContain(TRUST_PROXY_HOPS_ENV);
      expect(message).not.toContain(secretish);
      expect(message).toMatch(/caractères non numériques/);
    }
  });

  it('is NOT MissingConfigError — an absent key and a malformed key are different errors', () => {
    // Reusing the absent-key message would tell an operator to declare a
    // variable they have already declared.
    const err = (() => {
      try {
        parseTrustProxyHops('nope');
      } catch (e) {
        return e as Error;
      }
      return null;
    })();
    expect(err?.name).toBe('InvalidConfigError');
  });
});

describe('resolveTrustProxyHops / applyTrustProxy — the ONE applier main.ts uses', () => {
  it('reads exactly the declared key', () => {
    expect(resolveTrustProxyHops({ [TRUST_PROXY_HOPS_ENV]: '2' })).toBe(2);
    expect(resolveTrustProxyHops({ [TRUST_PROXY_HOPS_ENV]: '0' })).toBe(0);
  });

  it('sets `trust proxy` to the parsed NUMBER, exactly once, and returns it', () => {
    const calls: [string, unknown][] = [];
    const app = {
      set(setting: string, value: unknown) {
        calls.push([setting, value]);
        return app;
      },
    };
    const hops = applyTrustProxy(app, { [TRUST_PROXY_HOPS_ENV]: '2' });
    expect(hops).toBe(2);
    expect(calls).toEqual([['trust proxy', 2]]);
    // Never the blanket forms — asserted on the VALUE that reached Express, not
    // only on the source text (ADR-036 D1).
    expect(calls[0]?.[1]).not.toBe(true);
    expect(calls[0]?.[1]).not.toBe('*');
  });

  it('does NOT call app.set when the value is unusable — a bad pin never becomes a live setting', () => {
    const calls: unknown[] = [];
    const app = { set: (...args: unknown[]) => calls.push(args) };
    expect(() => applyTrustProxy(app, { [TRUST_PROXY_HOPS_ENV]: '99' })).toThrow(InvalidConfigError);
    expect(calls).toEqual([]);
  });
});

describe('DNC-10 — no environment value relaxes the hop count', () => {
  const SABOTEURS: Record<string, string> = {
    SKIP_TRUST_PROXY: '1',
    ALLOW_PROXY_TRUST: 'true',
    BYPASS_TRUST_PROXY: '1',
    FORCE_TRUST_PROXY: 'true',
    TRUST_PROXY: 'true',
    TRUST_PROXY_HOPS_OVERRIDE: '99',
    NODE_ENV: 'development',
  };

  it('none of them makes an absent key parse, on either path', () => {
    const previous = new Map<string, string | undefined>();
    for (const [key, value] of Object.entries(SABOTEURS)) {
      previous.set(key, process.env[key]);
      process.env[key] = value;
    }
    try {
      // Both paths: planted in the examined source AND on process.env itself.
      expect(() => resolveTrustProxyHops({ ...SABOTEURS })).toThrow(InvalidConfigError);
      expect(() => parseTrustProxyHops(undefined)).toThrow(InvalidConfigError);
    } finally {
      for (const [key, value] of previous) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it.each(['development', 'test', 'production'])(
    'NODE_ENV=%s changes nothing about what is accepted',
    (nodeEnv) => {
      const previous = process.env.NODE_ENV;
      process.env.NODE_ENV = nodeEnv;
      try {
        expect(() => parseTrustProxyHops('true')).toThrow(InvalidConfigError);
        expect(() => parseTrustProxyHops('99')).toThrow(InvalidConfigError);
        expect(parseTrustProxyHops('2')).toBe(2);
      } finally {
        if (previous === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = previous;
      }
    },
  );

  it('COMPANION — the same assertions go RED against a fixture that DOES coerce', () => {
    // A guard that has never been shown red is a guard we hope works (PF-109 /
    // S-E02-18). This is the forbidden shape ADR-036 D3 names verbatim,
    // implemented here as a local function so the control exercises the
    // BEHAVIOUR the real parser refuses, not a string about it.
    const forbidden = (raw: string | undefined): number => Number(raw ?? '2');

    // Every one of these is a case the shipped parser refuses and the forbidden
    // shape silently accepts — so the table above is proven non-vacuous.
    expect(forbidden(undefined)).toBe(2); // the `??` fallback literal
    expect(forbidden('')).toBe(0); // '' → 0, the catastrophic case
    expect(forbidden('2.0')).toBe(2);
    expect(forbidden('0x2')).toBe(2);
    expect(forbidden('1e1')).toBe(10);
    expect(forbidden('99')).toBe(99);
    expect(forbidden(' 2 ')).toBe(2);

    for (const raw of [undefined, '', '2.0', '0x2', '1e1', '99']) {
      expect(() => parseTrustProxyHops(raw)).toThrow(InvalidConfigError);
    }
  });
});
