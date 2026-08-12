import 'reflect-metadata';

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { ValidationPipe } from '@nestjs/common';
import { type NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { RegisterController } from '../../modules/identity/register.controller';
import { configureAuditClientHints, resetAuditClientHintsPolicy } from '../audit/client-hints';
import { KeycloakAdminService } from '../keycloak/keycloak-admin.service';
import { PrismaService } from '../prisma/prisma.service';

import {
  REGISTRATION_TIER1_MAX,
  REGISTRATION_TIER2_MAX,
  resetPublicEndpointThrottle,
} from './public-endpoint-throttle';
import { REGISTRATION_THROTTLED_MESSAGE, RegisterThrottleGuard } from './register-throttle.guard';

/**
 * S-E05-7 / AC-13 — THE mandatory evidence case: the amplification bound, proven
 * over Nest's real request pipeline (`PF-46`, the unthrottled third · G-AUTHZ).
 *
 * WHY THIS FILE EXISTS INSTEAD OF MORE CASES IN `register.controller.spec.ts`
 * --------------------------------------------------------------------------
 * That spec drives the handler by DIRECT METHOD CALL (`new RegisterController(...)`
 * at :195, then `db.controller.registerParent(BODY, …)` at :249 and twelve other
 * lines). A `CanActivate` registered with `@UseGuards` is never invoked on a
 * direct method call. Written there, "the (N+1)th request is 429 and `createUser`
 * was not called" degenerates into: call the guard by hand, then don't call the
 * controller, then assert the controller didn't call Keycloak — a tautology that
 * passes against the PRE-FIX tree. That is exactly the `S-E02-18`/`S-E02-19`
 * failure mode written down at `shared/audit/client-hints.supertest.spec.ts:29-35`:
 * a gate stated over a re-implementation of the artefact rather than over the
 * artefact.
 *
 * So the harness is the one this repo already uses for that reason —
 * `Test.createTestingModule` + `supertest`, both already in
 * `apps/api/package.json` (`@nestjs/testing@^10.4.13`, `supertest@^7.0.0`), and
 * already collected by `apps/api/jest.config.js:7`. NO new dependency: the
 * NestJS v10 pin (GUARDRAILS §3) is not touched.
 *
 * The `ValidationPipe` is configured exactly as `main.ts:140-146` configures it,
 * so the case also exercises the ordering that makes the defensive raw-body read
 * mandatory: Nest runs guards BEFORE pipes.
 *
 * WHAT IS ASSERTED, AND WHY THE STATUS CODE ALONE WOULD NOT DO
 * -----------------------------------------------------------
 * A refusal that still reached Keycloak would be a 429 too. So every refusal case
 * asserts the Keycloak fake's CALL COUNT is unchanged across the refused request —
 * that count is the amplification bound, and the status code is only its symptom.
 */

const PASSWORD = 'Motdepasse-2026!';
const NOW = 1_770_000_000_000;

function bodyFor(email: string): Record<string, unknown> {
  return {
    email,
    firstName: 'Awa',
    lastName: 'Diop',
    password: PASSWORD,
    phone: '+221770000000',
    acceptTerms: true,
    acceptPrivacy: true,
    marketingOptIn: false,
  };
}

type Row = Record<string, unknown>;

function makeHarness() {
  const auditRows: Row[] = [];
  const profiles: Row[] = [];

  const tx = {
    tenant: {
      upsert: jest.fn(async () => ({ id: 'tenant-demo-1', slug: 'demo' })),
    },
    userProfile: {
      create: jest.fn(async ({ data }: { data: Row }) => {
        const row: Row = { id: `profile-${profiles.length + 1}`, ...data };
        profiles.push(row);
        return row;
      }),
    },
    auditLog: {
      create: jest.fn(async ({ data }: { data: Row }) => {
        auditRows.push(data);
        return { id: `audit-${auditRows.length}`, ...data };
      }),
    },
  };

  const prisma = {
    $transaction: jest.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx)),
  };

  let created = 0;
  const keycloak = {
    findUserByEmail: jest.fn(async (_email: string) => null),
    createUser: jest.fn(async (_payload: Record<string, unknown>) => {
      created += 1;
      return `kc-${created}`;
    }),
    setUserPassword: jest.fn(async (_id: string, _password: string, _temporary?: boolean) => undefined),
    deleteUser: jest.fn(async (_id: string) => undefined),
  };

  return { prisma, keycloak, auditRows, profiles };
}

let app: NestExpressApplication;
let harness: ReturnType<typeof makeHarness>;

async function boot() {
  harness = makeHarness();
  const moduleRef = await Test.createTestingModule({
    controllers: [RegisterController],
    providers: [
      { provide: PrismaService, useValue: harness.prisma },
      { provide: KeycloakAdminService, useValue: harness.keycloak },
    ],
  }).compile();

  const created = moduleRef.createNestApplication<NestExpressApplication>();
  // Byte-for-byte the configuration `main.ts:140-146` applies.
  created.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
  await created.init();
  return created;
}

const post = (email: string) =>
  request(app.getHttpServer()).post('/auth/register-parent').send(bodyFor(email));

beforeEach(async () => {
  resetPublicEndpointThrottle();
  resetAuditClientHintsPolicy();
  configureAuditClientHints({ trustedHops: 0 });
  // One pinned instant, so no case can straddle a window rollover and go green
  // (or red) for a reason nobody chose. A stubbed clock — not a fake timer, and
  // nothing here waits.
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
  app = await boot();
});

afterEach(async () => {
  await app.close();
  jest.restoreAllMocks();
  resetPublicEndpointThrottle();
  resetAuditClientHintsPolicy();
});

/* ================================================================== *
 * (a) — AC-13 · THE amplification bound, over the real pipeline
 * ================================================================== */

describe('(a) AC-13/AC-1 — the (TIER1_MAX + 1)th request for one address is refused BEFORE Keycloak', () => {
  it('429s, and `createUser` was called exactly TIER1_MAX times — not TIER1_MAX + 1', async () => {
    const email = 'parent@exemple.fr';

    for (let i = 0; i < REGISTRATION_TIER1_MAX; i += 1) {
      const res = await post(email);
      expect(res.status).toBe(201);
    }
    const before = {
      find: harness.keycloak.findUserByEmail.mock.calls.length,
      create: harness.keycloak.createUser.mock.calls.length,
      password: harness.keycloak.setUserPassword.mock.calls.length,
    };

    const refused = await post(email);

    expect(refused.status).toBe(429);
    // The parent-visible body: `message` is a top-level STRING (`actions.ts:39-42`).
    expect(refused.body).toEqual({ statusCode: 429, message: REGISTRATION_THROTTLED_MESSAGE });
    expect(typeof refused.body.message).toBe('string');

    // THE assertion. A refusal that still reached Keycloak would be a 429 too.
    expect(harness.keycloak.createUser.mock.calls.length).toBe(REGISTRATION_TIER1_MAX);
    expect(harness.keycloak.createUser.mock.calls.length).toBe(before.create);
    expect(harness.keycloak.findUserByEmail.mock.calls.length).toBe(before.find);
    expect(harness.keycloak.setUserPassword.mock.calls.length).toBe(before.password);
    // The refusal is above the handler entirely: no transaction, no compensation.
    expect(harness.keycloak.deleteUser).not.toHaveBeenCalled();
    expect(harness.prisma.$transaction.mock.calls.length).toBe(REGISTRATION_TIER1_MAX);
  });
});

/* ================================================================== *
 * (b) — AC-3 · the rotating-address route is closed too
 * ================================================================== */

describe('(b) AC-3 — TIER2_MAX + 1 requests with DIFFERENT addresses still stop at the ceiling', () => {
  it('the last one 429s although tier 1 never fired, and Keycloak sees no extra call', async () => {
    for (let i = 0; i < REGISTRATION_TIER2_MAX; i += 1) {
      const res = await post(`p${i}@exemple.fr`);
      expect(res.status).toBe(201);
    }
    const create = harness.keycloak.createUser.mock.calls.length;
    expect(create).toBe(REGISTRATION_TIER2_MAX);

    const refused = await post('un-de-plus@exemple.fr');

    expect(refused.status).toBe(429);
    expect(refused.body.message).toBe(REGISTRATION_THROTTLED_MESSAGE);
    expect(harness.keycloak.createUser.mock.calls.length).toBe(create);
  });
});

/* ================================================================== *
 * (c) — AC-4 / AC-10 · the controls, which pass against the pre-fix tree
 * ================================================================== */

describe('(c) AC-4/AC-10 — under the caps nothing observable changed', () => {
  it('the happy path still answers `{ ok: true, email }` and writes exactly ONE `user.register` row', async () => {
    const email = 'parent@exemple.fr';

    const res = await post(email);

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ ok: true, email });
    expect(harness.auditRows).toHaveLength(1);
    expect(harness.auditRows[0]).toMatchObject({
      action: 'user.register',
      resourceType: 'user_profile',
      tenantId: 'tenant-demo-1',
      actorRole: 'parent',
    });
    expect(harness.auditRows[0]!.after).toMatchObject({
      email,
      realmRole: 'parent',
      selfRegistered: true,
    });
    // The credential never reaches the append-only, exportable table.
    expect(JSON.stringify(harness.auditRows[0])).not.toContain(PASSWORD);
  });

  it('AC-7 — a body the ValidationPipe rejects is still a 400, never a guard crash', async () => {
    // Guards run BEFORE pipes, so this request reaches the guard with an
    // unvalidated body and must pass through it untouched to be refused by the
    // pipe. A guard that threw on a malformed body would turn every 400 into a 500.
    const res = await request(app.getHttpServer())
      .post('/auth/register-parent')
      .send({ email: 42, acceptTerms: 'oui' });

    expect(res.status).toBe(400);
    expect(harness.keycloak.createUser).not.toHaveBeenCalled();
  });
});

/* ================================================================== *
 * (d) — AC-11 · the wiring itself, asserted rather than reviewed
 * ================================================================== */

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..', '..');
const API_SRC = join(REPO_ROOT, 'apps', 'api', 'src');

describe('(d) AC-11/AC-12 — the guard is on THIS handler only, and nothing global was introduced', () => {
  it('`registerParent` carries RegisterThrottleGuard in its own guard metadata', () => {
    const guards = Reflect.getMetadata(
      '__guards__',
      RegisterController.prototype.registerParent,
    ) as unknown[] | undefined;

    expect(guards).toBeDefined();
    expect(guards).toContain(RegisterThrottleGuard);
  });

  it('no APP_GUARD is registered anywhere, and the identity module gained no provider', () => {
    // A global guard would silently change every other endpoint — a cross-cutting
    // architectural change (GUARDRAILS §2). Asserted on the two files that would
    // have to carry it.
    for (const rel of [
      ['app.module.ts'],
      ['modules', 'identity', 'identity.module.ts'],
    ]) {
      const source = readFileSync(join(API_SRC, ...rel), 'utf8');
      expect(source).not.toContain('APP_GUARD');
    }
    const identityModule = readFileSync(join(API_SRC, 'modules', 'identity', 'identity.module.ts'), 'utf8');
    // The guard has no constructor dependencies, so Nest instantiates it from the
    // decorator alone — no provider entry, and this file is untouched by the slice.
    expect(identityModule).not.toContain('RegisterThrottleGuard');
  });
});
