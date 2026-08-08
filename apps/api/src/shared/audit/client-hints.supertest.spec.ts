import 'reflect-metadata';

import { Controller, Get, Req } from '@nestjs/common';
import { type NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { TRUST_PROXY_HOPS_ENV, applyTrustProxy } from '../config/trust-proxy';

import {
  type AuditClientHints,
  type ClientHintsRequest,
  PILOTAGE_CLIENT_IP_HEADER,
  PILOTAGE_CLIENT_USER_AGENT_HEADER,
  PILOTAGE_FORWARD_TOKEN_HEADER,
  configureAuditClientHints,
  extractAuditClientHints,
  resetAuditClientHintsPolicy,
} from './client-hints';

/**
 * S-E04-3 / AC-14 — the contract-mandated supertest cases, driven through the
 * **pinned configuration**: (a) no `X-Forwarded-For`, (b) a legitimate proxy
 * chain of depth `N`, (c) a **forged** client `X-Forwarded-For`.
 *
 * WHY THE HARNESS CALLS `applyTrustProxy` AND NEVER `app.set` ITSELF
 * -----------------------------------------------------------------
 * A spec that wrote `app.set('trust proxy', 2)` inline would prove a property of
 * the test, not of `main.ts`. That is the `S-E02-18` / `S-E02-19` lesson arriving
 * early — a gate stated over a re-implementation of the artefact rather than over
 * the artefact. So the hop count travels the exact path it travels in production:
 * an environment record → `applyTrustProxy` (the one exported applier, the one
 * `main.ts` calls) → Express. The only thing this file supplies is the value of
 * the environment variable, which is what an environment declaration is.
 *
 * WHAT THIS FILE DOES AND DOES NOT EVIDENCE
 * ----------------------------------------
 * It evidences the RESOLUTION rule end-to-end over real HTTP: what
 * `extractAuditClientHints` returns for a request that actually traversed
 * Express's `trust proxy` machinery. It does **not** evidence the stored row —
 * that is `G-AUDIT`'s database read-back, and reading a response is explicitly
 * not evidence about a stored value. The two claims are kept separate on purpose.
 */

@Controller('probe')
class ProbeController {
  @Get()
  hints(@Req() req: ClientHintsRequest): AuditClientHints {
    return extractAuditClientHints(req);
  }
}

const TOKEN = 'supertest-forward-token-value';
const CLIENT = '92.184.7.14';
const EDGE = '10.0.0.5';
const FORGED = '6.6.6.6';

async function bootProbe(env: Record<string, string | undefined>, forwardToken?: string) {
  const moduleRef = await Test.createTestingModule({ controllers: [ProbeController] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  // The ONE applier — same function, same argument shape as `main.ts`.
  const hops = applyTrustProxy(app, env);
  configureAuditClientHints({ trustedHops: hops, forwardToken });
  await app.init();
  return app;
}

describe('AC-14 — the pinned hop count, over real HTTP (N = 2, the production topology)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await bootProbe({ [TRUST_PROXY_HOPS_ENV]: '2' }, TOKEN);
  });

  afterAll(async () => {
    await app.close();
    resetAuditClientHintsPolicy();
  });

  it('(a) NO X-Forwarded-For at all → null, and specifically NOT the socket peer', async () => {
    // Under N = 2 a request with no chain reached the api without traversing the
    // two proxies the pin describes. Its socket peer is real but it is not the
    // operator, so ADR-036 D4 applies: null rather than wrong.
    const res = await request(app.getHttpServer()).get('/probe').set('user-agent', 'probe/1');
    expect(res.status).toBe(200);
    expect(res.body.ipAddress).toBeNull();
    expect(res.body.ipAddress).not.toBe('127.0.0.1');
    expect(res.body.ipAddress).not.toBe('::1');
    expect(res.body.userAgent).toBe('probe/1');
  });

  it('(b) a LEGITIMATE chain of depth N → the address the edge recorded', async () => {
    const res = await request(app.getHttpServer())
      .get('/probe')
      .set('x-forwarded-for', `${CLIENT}, ${EDGE}`)
      .set('user-agent', 'probe/1');
    expect(res.status).toBe(200);
    expect(res.body.ipAddress).toBe(CLIENT);
  });

  it('(c) AC-2 — a FORGED entry beyond hop N does NOT change the recorded address', async () => {
    // The caller injects a leading entry; it sits beyond the two trusted hops,
    // so Express discards it. This is the property ADR-036 D1 refused blanket
    // trust for LACKING, asserted by sending one rather than by asserting it.
    const res = await request(app.getHttpServer())
      .get('/probe')
      .set('x-forwarded-for', `${FORGED}, ${CLIENT}, ${EDGE}`);
    expect(res.status).toBe(200);
    expect(res.body.ipAddress).not.toBe(FORGED);
    expect(res.body.ipAddress).toBe(CLIENT);
  });

  it('AC-7 / PM-2 — the SHORT chain, which Express does NOT handle, is null', () => {
    // The dangerous half the contract's AC-2 does not reach: with a 1-entry
    // chain against N = 2, proxyaddr PADS and returns the leftmost — forged —
    // entry with full confidence. The seam counts the depth and refuses.
    return request(app.getHttpServer())
      .get('/probe')
      .set('x-forwarded-for', FORGED)
      .expect(200)
      .expect((res) => {
        expect(res.body.ipAddress).toBeNull();
        expect(res.body.ipAddress).not.toBe(FORGED);
      });
  });

  it('AC-1 — two requests from two different client addresses produce TWO DIFFERENT values', async () => {
    const first = await request(app.getHttpServer())
      .get('/probe')
      .set('x-forwarded-for', `${CLIENT}, ${EDGE}`);
    const second = await request(app.getHttpServer())
      .get('/probe')
      .set('x-forwarded-for', `203.0.113.99, ${EDGE}`);
    expect(first.body.ipAddress).toBe(CLIENT);
    expect(second.body.ipAddress).toBe('203.0.113.99');
    expect(first.body.ipAddress).not.toBe(second.body.ipAddress);
  });

  it('AC-9 — a forged X-Forwarded-For CANNOT be laundered through the pilotage headers', async () => {
    // The headers are present, the token is wrong: both fields blank, and the
    // socket peer is NOT substituted. Asserted in the negative, because
    // `=== null` alone would pass if the seam returned the relay's address by
    // another name.
    const res = await request(app.getHttpServer())
      .get('/probe')
      .set(PILOTAGE_FORWARD_TOKEN_HEADER, 'not-the-token')
      .set(PILOTAGE_CLIENT_IP_HEADER, FORGED)
      .set(PILOTAGE_CLIENT_USER_AGENT_HEADER, 'forged/1')
      .set('x-real-ip', '10.0.0.5')
      .set('x-forwarded-for', `${CLIENT}, ${EDGE}`);
    expect(res.body).toEqual({ ipAddress: null, userAgent: null });
    expect(res.body.ipAddress).not.toBe('10.0.0.5');
    expect(res.body.ipAddress).not.toBe(CLIENT);
  });

  it('a VALID token yields the forwarded pair, and only then', async () => {
    const res = await request(app.getHttpServer())
      .get('/probe')
      .set(PILOTAGE_FORWARD_TOKEN_HEADER, TOKEN)
      .set(PILOTAGE_CLIENT_IP_HEADER, CLIENT)
      .set(PILOTAGE_CLIENT_USER_AGENT_HEADER, 'Mozilla/5.0 (Windows NT 10.0)');
    expect(res.body).toEqual({
      ipAddress: CLIENT,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0)',
    });
  });
});

describe('the LOCAL topology (N = 0) — the same applier, a different declared value', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await bootProbe({ [TRUST_PROXY_HOPS_ENV]: '0' }, TOKEN);
  });

  afterAll(async () => {
    await app.close();
    resetAuditClientHintsPolicy();
  });

  it('records the socket peer when nothing claims to relay — no proxy is in the path', async () => {
    const res = await request(app.getHttpServer()).get('/probe').set('user-agent', 'probe/1');
    expect(res.status).toBe(200);
    // Loopback, normalised out of its IPv4-mapped IPv6 spelling (AC-17).
    expect(['127.0.0.1', '::1']).toContain(res.body.ipAddress);
    expect(res.body.ipAddress).not.toMatch(/^::ffff:/);
  });

  it('AC-5 — a forged X-Forwarded-For is IGNORED under N = 0, whatever it claims', async () => {
    const res = await request(app.getHttpServer()).get('/probe').set('x-forwarded-for', FORGED);
    expect(res.body.ipAddress).not.toBe(FORGED);
    expect(['127.0.0.1', '::1']).toContain(res.body.ipAddress);
  });

  it('AC-5 / DNC-10 — no environment value flips the applied configuration at runtime', async () => {
    const saboteurs = {
      SKIP_TRUST_PROXY: '1',
      ALLOW_PROXY_TRUST: 'true',
      TRUST_PROXY: 'true',
      NODE_ENV: 'development',
    } as const;
    const previous = new Map<string, string | undefined>();
    for (const [key, value] of Object.entries(saboteurs)) {
      previous.set(key, process.env[key]);
      process.env[key] = value;
    }
    try {
      const res = await request(app.getHttpServer()).get('/probe').set('x-forwarded-for', FORGED);
      expect(res.body.ipAddress).not.toBe(FORGED);
    } finally {
      for (const [key, value] of previous) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});
