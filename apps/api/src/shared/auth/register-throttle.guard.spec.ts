import 'reflect-metadata';

import { type ExecutionContext, HttpException, HttpStatus, Logger } from '@nestjs/common';

import {
  REGISTRATION_TIER1_MAX,
  REGISTRATION_TIER2_MAX,
  registrationIdentityKey,
  resetPublicEndpointThrottle,
} from './public-endpoint-throttle';
import { REGISTRATION_THROTTLED_MESSAGE, RegisterThrottleGuard } from './register-throttle.guard';

/**
 * S-E05-7 — the HTTP half of the admission bound (`PF-46` · gates G-AUTHZ, G-DNC).
 *
 * WHAT THIS FILE EVIDENCES, AND WHAT IT DELIBERATELY DOES NOT
 * ----------------------------------------------------------
 * It evidences the SHAPE of the refusal: the status, the body the parent's browser
 * will render, the indistinguishability of the three refusal reasons, the
 * defensive raw-body read, and the aggregated log line. It does NOT evidence that
 * the guard is wired to the route or that a refusal spares a Keycloak call —
 * calling a guard by hand and then not calling the controller would assert a
 * tautology, which is the `S-E02-18`/`S-E02-19` failure mode recorded at
 * `shared/audit/client-hints.supertest.spec.ts:29-35`. That claim is made over
 * Nest's real pipeline in `register-throttle.supertest.spec.ts`.
 *
 * THE CLOCK IS PINNED, NOT FAKED
 * ------------------------------
 * `Date.now` is stubbed to one fixed instant so no case can straddle a window
 * rollover and go green (or red) for a reason nobody chose. That is a stubbed
 * clock, not `jest.useFakeTimers` and not a real timer: nothing here waits.
 */

const NOW = 1_770_000_000_000;

function contextFor(body: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ body }) }),
  } as unknown as ExecutionContext;
}

function bodyFor(email: string): Record<string, unknown> {
  return { email, firstName: 'Awa', lastName: 'Diop', password: 'Motdepasse-2026!' };
}

let guard: RegisterThrottleGuard;
let warnings: string[];

function refusalOf(body: unknown): HttpException {
  try {
    guard.canActivate(contextFor(body));
  } catch (err) {
    return err as HttpException;
  }
  throw new Error('expected the guard to refuse, and it admitted');
}

beforeEach(() => {
  resetPublicEndpointThrottle();
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
  warnings = [];
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(((...args: unknown[]) => {
    warnings.push(String(args[0]));
  }) as never);
  guard = new RegisterThrottleGuard();
});

afterEach(() => {
  jest.restoreAllMocks();
  resetPublicEndpointThrottle();
});

/* ================================================================== *
 * (a) — AC-4 · the control case: nothing observable changes under the caps
 * ================================================================== */

describe('(a) AC-4 — a request under both caps is admitted, unchanged', () => {
  it('returns true and logs nothing', () => {
    expect(guard.canActivate(contextFor(bodyFor('parent@exemple.fr')))).toBe(true);
    expect(warnings).toHaveLength(0);
  });
});

/* ================================================================== *
 * (b) — PM-6 · it THROWS 429; it never returns false
 * ================================================================== */

describe('(b) PM-6/AC-1 — the refusal is a 429 whose body a parent can read', () => {
  it('throws HttpException(429) with `message` as a top-level STRING', () => {
    const body = bodyFor('parent@exemple.fr');
    for (let i = 0; i < REGISTRATION_TIER1_MAX; i += 1) guard.canActivate(contextFor(body));

    const err = refusalOf(body);

    expect(err).toBeInstanceOf(HttpException);
    expect(err.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    expect(err.getStatus()).toBe(429);
    // `actions.ts:39-42` joins an ARRAY with " · " (a class-validator artefact
    // that looks broken in a prose banner) and falls through to the raw
    // "HTTP 429" when the message is nested — so the string shape is the
    // user-visible contract, asserted rather than assumed.
    expect(typeof err.getResponse()).toBe('string');
    expect(err.getResponse()).toBe(REGISTRATION_THROTTLED_MESSAGE);
    expect(Array.isArray(err.getResponse())).toBe(false);
    expect(err.message).toBe(REGISTRATION_THROTTLED_MESSAGE);
  });

  it('the copy is the one a locked-out INNOCENT parent can act on', () => {
    // The tier-2 victim did nothing wrong, so the sentence is checked as UI copy,
    // not only as a constant: impersonal, no number to leak the limit, no jargon,
    // and short enough to stay above the first field at 375 px.
    expect(REGISTRATION_THROTTLED_MESSAGE.length).toBeLessThanOrEqual(110);
    expect(REGISTRATION_THROTTLED_MESSAGE).not.toMatch(/\d/);
    expect(REGISTRATION_THROTTLED_MESSAGE).not.toMatch(/vous avez|rate limit|quota|throttle/i);
    // `\bIP\b` and not `/ip/i`: « inscription » contains the letters, and a
    // careless jargon check that went red on the copy it is protecting would be
    // removed by the next author rather than fixed.
    expect(REGISTRATION_THROTTLED_MESSAGE).not.toMatch(/\bIP\b/);
    expect(REGISTRATION_THROTTLED_MESSAGE).not.toContain('’');
    expect(REGISTRATION_THROTTLED_MESSAGE).toMatch(/réessayer/);
  });
});

/* ================================================================== *
 * (c) — AC-6 · no tier is distinguishable by an anonymous caller
 * ================================================================== */

describe('(c) AC-6/PM-10 — the identity refusal and the global refusal are byte-identical', () => {
  it('same status, same message, and no header on one that is absent on the other', () => {
    // Tier 1, on a fresh limiter.
    const one = bodyFor('cible@exemple.fr');
    for (let i = 0; i < REGISTRATION_TIER1_MAX; i += 1) guard.canActivate(contextFor(one));
    const identity = refusalOf(one);

    // Tier 2, on a fresh limiter and reached with DIFFERENT addresses, so tier 1
    // never fires and only the endpoint-wide ceiling can be what refused.
    resetPublicEndpointThrottle();
    for (let i = 0; i < REGISTRATION_TIER2_MAX; i += 1) {
      guard.canActivate(contextFor(bodyFor(`p${i}@exemple.fr`)));
    }
    const global = refusalOf(bodyFor('legitime@exemple.fr'));

    expect(global.getStatus()).toBe(identity.getStatus());
    expect(global.getResponse()).toBe(identity.getResponse());
    // Asserted in the negative too: a `Retry-After` derived from a per-address
    // bucket would itself be the oracle, so neither refusal carries one.
    expect((identity as { headers?: unknown }).headers).toBeUndefined();
    expect((global as { headers?: unknown }).headers).toBeUndefined();
  });
});

/* ================================================================== *
 * (d) — AC-7 · guards run before the pipes, so the body is whatever arrived
 * ================================================================== */

describe('(d) AC-7 — a malformed or absent body never throws, and still costs tier-2 budget', () => {
  it.each([
    ['undefined body', undefined],
    ['null body', null],
    ['empty object', {}],
    ['numeric email', { email: 42 }],
    ['array email', { email: ['a@b.fr'] }],
    ['blank email', { email: '   ' }],
    ['non-object body', 'not-an-object'],
    ['symbol body', Symbol('absent')],
  ])('%s is admitted rather than crashing the endpoint', (_label, body) => {
    // A limiter that 500s on garbage input is worse than no limiter, and garbage
    // input is precisely what a flood sends.
    expect(guard.canActivate(contextFor(body))).toBe(true);
  });

  it('keyless traffic is not free: it exhausts the endpoint-wide ceiling', () => {
    for (let i = 0; i < REGISTRATION_TIER2_MAX; i += 1) {
      expect(guard.canActivate(contextFor({}))).toBe(true);
    }
    expect(refusalOf({}).getStatus()).toBe(429);
  });

  it('survives a request object that has no body property at all', () => {
    const context = {
      switchToHttp: () => ({ getRequest: () => ({}) }),
    } as unknown as ExecutionContext;
    expect(guard.canActivate(context)).toBe(true);
  });
});

/* ================================================================== *
 * (e) — AC-8 / PM-5 · the signal is aggregated and carries no address
 * ================================================================== */

describe('(e) AC-8/PM-5 — one warning per window, digest prefix only, never the address', () => {
  it('logs once across 30 consecutive refusals and never the plaintext address', () => {
    const email = 'parent@exemple.fr';
    const body = bodyFor(email);
    for (let i = 0; i < REGISTRATION_TIER1_MAX; i += 1) guard.canActivate(contextFor(body));

    for (let i = 0; i < 30; i += 1) refusalOf(body);

    // A line per refused request would be an unbounded synchronous write per
    // request — the same defect class as an audit row per refusal, in the log sink.
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('tier=identity');
    expect(warnings[0]).toContain((registrationIdentityKey(email) as string).slice(0, 12));
    expect(warnings[0]).not.toContain(email);
    expect(warnings[0]).not.toContain('exemple.fr');
  });

  it('names the ENDPOINT-WIDE tier when the global ceiling engages, so an operator can alert on it', () => {
    for (let i = 0; i < REGISTRATION_TIER2_MAX; i += 1) {
      guard.canActivate(contextFor(bodyFor(`p${i}@exemple.fr`)));
    }
    refusalOf(bodyFor('legitime@exemple.fr'));
    refusalOf(bodyFor('autre@exemple.fr'));

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('tier=global');
    expect(warnings[0]).toContain('/auth/register-parent');
  });
});
