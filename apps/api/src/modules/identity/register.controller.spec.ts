import 'reflect-metadata';

import { BadRequestException, ConflictException, InternalServerErrorException, Logger } from '@nestjs/common';

import {
  type ClientHintsRequest,
  configureAuditClientHints,
  resetAuditClientHintsPolicy,
} from '../../shared/audit/client-hints';
import { AUDIT_WRITE_FAILED_MESSAGE } from '../../shared/audit/write-audit';
import type { KeycloakAdminService } from '../../shared/keycloak/keycloak-admin.service';
import type { PrismaService } from '../../shared/prisma/prisma.service';

import { RegisterController } from './register.controller';

/**
 * S-E05-11 — `POST /auth/register-parent` becomes atomic, compensated and
 * audited (`PF-166`, P1 · gates G-AUDIT, G-TENANT, G-DNC · `ADR-035` amendment).
 *
 * THE ARTEFACT THAT WAS MISSING
 * -----------------------------
 * `register.controller.ts` had **no spec at all** while carrying the ONE
 * unauthenticated account-creation path in the product. It performed four
 * uncoordinated writes — `keycloak.createUser`, `keycloak.setUserPassword`,
 * `tenant.upsert`, `userProfile.create` — with no `$transaction` and no
 * compensation, so a failure at the last one left an ENABLED, profile-less
 * Keycloak identity (the orphan class `PF-163` named at the sibling address).
 * Independently, it wrote **no audit row on any path**.
 *
 * WHY EACH CASE FAILS AGAINST THE PRE-FIX CONTROLLER — AND THE TRICK THAT IS NO
 * LONGER AVAILABLE
 * -----------------------------------------------------------------------------
 * `invite.controller.spec.ts:41-48` derives its "fails before, passes after" from
 * `keycloak.deleteUser` NOT EXISTING before `S-E04-9`. It exists now, so that
 * argument cannot be reused, and copying its sentence would be a claim this tree
 * falsifies. The pre-fix absence here is different and is measured on the file
 * itself: at `HEAD` before this slice the controller contained **no `$transaction`
 * call and no `deleteUser` call at all** (`grep -c` = 0 for both), and **no
 * `auditLog` write of any kind**. Therefore, pre-fix:
 *   • (a) fails — `auditRows()` is 0, and `prisma.$transaction` is never called;
 *   • (a2) fails for the same reason;
 *   • (b)(c)(e) fail — `deleteUser` is never called, and (c)'s audit fault is
 *     unreachable because no audit row is ever written;
 *   • (d) is structurally unreachable — no compensation is invoked, so no
 *     compensation can fail;
 *   • (f) fails — there is no row to serialise.
 * Only (g) and the tenancy half of (h) pass pre-fix: they are the CONTROLS that
 * prove this slice did not change what a caller can observe.
 *
 * THE FAKE STAGES, THEN COMMITS — AND WHAT THAT DOES *NOT* PROVE
 * -------------------------------------------------------------
 * Reused from `invite.controller.spec.ts:99-168` rather than invented: writes made
 * inside the callback land in `staged` and move to `committed` only if the
 * callback resolves. Stated honestly, as that spec does: this proves the FAKE
 * discards `staged`, not that PostgreSQL rolls back. The claims these cases really
 * establish are the ones that matter here — the handler routes every local write
 * through ONE transaction client, propagates the failure instead of swallowing it,
 * and compensates the Keycloak identity it created. Rollback itself is Prisma's
 * contract, not this file's.
 */

const TENANT = 'tenant-demo-1';
const PROFILE_ID = 'profile-created-by-this-request';
const EMAIL = 'parent@exemple.fr';
const KC_NEW = 'kc-created-by-this-request';
const KC_EXISTING = 'kc-identity-that-already-exists';
const PASSWORD = 'Motdepasse-2026!';

/** A browser-shaped request: hints ARE wired, so both fields come back non-null. */
const CLIENT_IP = '203.0.113.7';
const BROWSER_UA = 'Mozilla/5.0 (X11; Linux x86_64) TestAgent/1.0';
/** The relay-shaped one: what `registerParentAction`'s server-side fetch presents. */
const RELAY_IP = '172.18.0.5';
const RELAY_UA = 'undici';

function browserRequest(): ClientHintsRequest {
  return { ip: CLIENT_IP, headers: { 'user-agent': BROWSER_UA } };
}

/**
 * The HAIRPIN shape, and the reason it is a case rather than a comment (`PF-129`).
 * `apps/web/src/app/parent/register/actions.ts` is `'use server'` and sends a bare
 * `fetch` with no `x-pilotage-*` headers and no `x-forwarded-for`. Under the
 * production hop count the chain is shorter than N, so `ADR-036` D4's short-chain
 * rule fires and the address is honestly `null`.
 */
function relayRequest(): ClientHintsRequest {
  return { ip: RELAY_IP, headers: { 'user-agent': RELAY_UA } };
}

const BASE_BODY = {
  email: EMAIL,
  firstName: 'Awa',
  lastName: 'Diop',
  password: PASSWORD,
  phone: '+221770000000',
  acceptTerms: true,
  acceptPrivacy: true,
  marketingOptIn: true,
};
const BODY = BASE_BODY as never;

/** Byte-identical to the string the handler has always thrown (AC-8). */
const REFUSAL = `Un compte existe déjà avec ${EMAIL}. Connectez-vous, ou récupérez votre mot de passe.`;
const TERMS_REFUSAL = 'Vous devez accepter les CGU et la politique de confidentialité.';
const PASSWORD_REFUSAL =
  'Le mot de passe doit contenir au moins une majuscule, une minuscule, un chiffre et un caractère spécial.';

type Row = Record<string, unknown>;
type Staged = { kind: 'tenant' | 'profile' | 'audit'; row: Row };

function makeDb(
  options: {
    /** What `findUserByEmail` answers — `null` is the nominal fresh registration. */
    keycloakUser?: { id: string; email: string } | null;
    faults?: { profile?: unknown; audit?: Error; deleteUser?: Error };
  } = {},
) {
  const { keycloakUser = null, faults = {} } = options;

  const committed: Staged[] = [];
  let staged: Staged[] = [];

  /** Every Keycloak call bumps this, so "no Keycloak call inside the tx" is measurable. */
  let keycloakCalls = 0;
  let keycloakCallsInsideTransaction = 0;
  const count = <T>(value: T): T => {
    keycloakCalls += 1;
    return value;
  };

  const tx = {
    tenant: {
      upsert: jest.fn(async ({ where }: { where: Row }) => {
        const row: Row = { id: TENANT, slug: (where as { slug?: string }).slug };
        staged.push({ kind: 'tenant', row });
        return row;
      }),
    },
    userProfile: {
      create: jest.fn(async ({ data }: { data: Row }) => {
        if (faults.profile) throw faults.profile;
        const row: Row = { id: PROFILE_ID, ...data };
        staged.push({ kind: 'profile', row });
        return row;
      }),
    },
    auditLog: {
      create: jest.fn(async ({ data }: { data: Row }) => {
        if (faults.audit) throw faults.audit;
        staged.push({ kind: 'audit', row: data });
        return { id: 'audit-1', ...data };
      }),
    },
  };

  const prisma = {
    // Present on the ROOT client too, so that a regression which moved either
    // local write back OUTSIDE the transaction would be observable rather than
    // crash the suite with "cannot read property of undefined".
    tenant: { upsert: jest.fn() },
    userProfile: { create: jest.fn() },
    $transaction: jest.fn(async (cb: (t: typeof tx) => Promise<unknown>) => {
      const before = keycloakCalls;
      staged = [];
      try {
        const out = await cb(tx);
        committed.push(...staged);
        staged = [];
        return out;
      } catch (err) {
        staged = [];
        throw err;
      } finally {
        keycloakCallsInsideTransaction += keycloakCalls - before;
      }
    }),
  };

  // Every mock declares its real parameter list: `mock.calls[0]` is read for the
  // created-payload assertions, and a zero-arity `jest.fn()` would type that
  // tuple as `[]` — the assertion would not compile rather than fail honestly.
  const keycloak = {
    findUserByEmail: jest.fn(async (_email: string) => count(keycloakUser)),
    createUser: jest.fn(async (_payload: Record<string, unknown>) => count(KC_NEW)),
    setUserPassword: jest.fn(
      async (_userId: string, _password: string, _temporary?: boolean) => count(undefined),
    ),
    deleteUser: jest.fn(async (_userId: string) => {
      count(undefined);
      if (faults.deleteUser) throw faults.deleteUser;
    }),
  };

  const controller = new RegisterController(
    prisma as unknown as PrismaService,
    keycloak as unknown as KeycloakAdminService,
  );

  return {
    controller,
    prisma,
    keycloak,
    tx,
    tenants: () => committed.filter((c) => c.kind === 'tenant').map((c) => c.row),
    profiles: () => committed.filter((c) => c.kind === 'profile').map((c) => c.row),
    auditRows: () => committed.filter((c) => c.kind === 'audit').map((c) => c.row),
    keycloakCallsInsideTransaction: () => keycloakCallsInsideTransaction,
  };
}

async function failureOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error('expected the handler to reject, and it resolved');
}

let loggedErrors: unknown[][];

beforeEach(() => {
  // A suite must never inherit another suite's global hint policy and pass for
  // the wrong reason (`client-hints.ts:191`). Each case states the configuration
  // it is proving.
  resetAuditClientHintsPolicy();
  loggedErrors = [];
  jest.spyOn(Logger.prototype, 'error').mockImplementation(((...args: unknown[]) => {
    loggedErrors.push(args);
  }) as never);
});

afterEach(() => {
  resetAuditClientHintsPolicy();
  jest.restoreAllMocks();
});

/* ================================================================== *
 * (a) — G-AUDIT: exactly one row, in the one transaction
 * ================================================================== */

describe('(a) AC-3/AC-4/AC-5 — the nominal registration commits the profile AND its audit row', () => {
  it('writes ONE `user.register` row whose actor and subject are the created profile', async () => {
    // The local topology: no proxy in front, so `req.ip` is the caller's own.
    configureAuditClientHints({ trustedHops: 0 });
    const db = makeDb();

    const result = await db.controller.registerParent(BODY, browserRequest());

    expect(db.profiles()).toHaveLength(1);
    expect(db.auditRows()).toHaveLength(1);

    const row = db.auditRows()[0]!;
    expect(row).toMatchObject({
      tenantId: TENANT,
      action: 'user.register',
      resourceType: 'user_profile',
      actorRole: 'parent',
      ipAddress: CLIENT_IP,
      userAgent: BROWSER_UA,
    });
    // AC-4 — the portal comes from the canonical mapper, never from a literal or
    // a ternary at this site.
    expect(row.portal).toBe('parent');
    // AC-5 — self-registration is the one mutation where actor and subject
    // coincide, and `resourceId` is a bare uuid (never a composite).
    expect(row.actorId).toBe(PROFILE_ID);
    expect(row.resourceId).toBe(PROFILE_ID);
    expect(row.actorId).toBe(row.resourceId);
    expect(String(row.resourceId)).not.toContain(':');
    // G-AUDIT after-state.
    expect(row.after).toMatchObject({
      email: EMAIL,
      realmRole: 'parent',
      selfRegistered: true,
      marketingOptIn: true,
    });

    expect(result).toEqual({ ok: true, email: EMAIL });
    expect(db.keycloak.deleteUser).not.toHaveBeenCalled();
  });

  it('opens the transaction exactly once, and makes NO Keycloak call inside it (AC-2)', async () => {
    configureAuditClientHints({ trustedHops: 0 });
    const db = makeDb();

    await db.controller.registerParent(BODY, browserRequest());

    expect(db.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(db.keycloakCallsInsideTransaction()).toBe(0);
    // Both Keycloak calls happened, and BEFORE the transaction.
    expect(db.keycloak.createUser).toHaveBeenCalledTimes(1);
    expect(db.keycloak.setUserPassword).toHaveBeenCalledTimes(1);
    expect(db.keycloak.createUser.mock.calls[0]![0]).toMatchObject({ realmRoles: ['parent'] });
    // Neither local write may reach the ROOT client — that is what "in ONE
    // transaction" means, and it is the half a staging fake can actually prove.
    expect(db.prisma.tenant.upsert).not.toHaveBeenCalled();
    expect(db.prisma.userProfile.create).not.toHaveBeenCalled();
  });
});

/* ================================================================== *
 * (a2) — PF-129: the hairpin null is STRUCTURAL and KNOWN
 * ================================================================== */

describe('(a2) PF-129 — under the production hop count the relay yields a null address, by design', () => {
  // Pinned as a case so the null is a recorded property rather than something a
  // later reader discovers and files as a regression. The seam is correct; the
  // forwarding half is missing on the `apps/web` side and is out of this seam.
  it('records `ipAddress: null` and never the relay address', async () => {
    configureAuditClientHints({ trustedHops: 2 });
    const db = makeDb();

    await db.controller.registerParent(BODY, relayRequest());

    const row = db.auditRows()[0]!;
    expect(row.ipAddress).toBeNull();
    expect(row.ipAddress).not.toBe(RELAY_IP);
    // The user-agent is still the immediate caller's own header — honest, and
    // honestly `undici` rather than a browser.
    expect(row.userAgent).toBe(RELAY_UA);
    // A null address never degrades the actor cell: `AuditTable.tsx:186` falls
    // back to `actorRole`, which the mapper filled.
    expect(row.actorRole).toBe('parent');
  });
});

/* ================================================================== *
 * (b)(c) — AC-6: a rollback compensates the identity it just created
 * ================================================================== */

describe('(b)(c) AC-6 — a rollback deletes the Keycloak identity THIS request created', () => {
  it('(b) profile create throws → nothing committed, deleteUser once, original cause re-thrown', async () => {
    configureAuditClientHints({ trustedHops: 0 });
    const original = new Error('connection terminated unexpectedly');
    const db = makeDb({ faults: { profile: original } });

    const err = await failureOf(db.controller.registerParent(BODY, browserRequest()));

    expect(db.profiles()).toHaveLength(0);
    expect(db.auditRows()).toHaveLength(0);
    expect(db.tenants()).toHaveLength(0);
    expect(db.keycloak.deleteUser).toHaveBeenCalledTimes(1);
    expect(db.keycloak.deleteUser).toHaveBeenCalledWith(KC_NEW);
    expect(err).toBe(original);
  });

  it('(c) ADR-035 D2 — an AUDIT failure also rolls back and compensates: no account survives unaudited', async () => {
    // The fail-closed proof, and the reason this slice exists. If the audit row
    // cannot be written, the account must not exist.
    configureAuditClientHints({ trustedHops: 0 });
    const audit = new Error('insert into audit_log failed');
    const db = makeDb({ faults: { audit } });

    const err = (await failureOf(db.controller.registerParent(BODY, browserRequest()))) as
      InternalServerErrorException & { cause?: unknown };

    expect(db.profiles()).toHaveLength(0);
    expect(db.auditRows()).toHaveLength(0);
    expect(db.keycloak.deleteUser).toHaveBeenCalledTimes(1);
    expect(db.keycloak.deleteUser).toHaveBeenCalledWith(KC_NEW);
    // NON-MASKING: the caller gets the error the SEAM raised (`write-audit.ts:165`
    // wraps the driver error precisely so the operator reads a sentence),
    // re-thrown by the compensation UNCHANGED — and « L'opération a été annulée »
    // is now literally true, which is the acceptance check.
    expect(err).toBeInstanceOf(InternalServerErrorException);
    expect(err.message).toBe(AUDIT_WRITE_FAILED_MESSAGE);
    expect(err.cause).toBe(audit);
    // Silent success, loud failure: a successful rollback says nothing about the
    // Keycloak account it cleaned up.
    expect(err.message).not.toContain(KC_NEW);
  });
});

/* ================================================================== *
 * (d) — AC-6: a failed compensation is loud, never silent
 * ================================================================== */

describe('(d) AC-6 — when the compensating delete itself fails, the orphan is named', () => {
  it('puts the orphan id IN the message, keeps the original cause, and logs all three', async () => {
    // A PROFILE fault rather than an audit fault, deliberately: the seam wraps its
    // own failure, so `cause` would then be the wrapper. Here the original error
    // travels by identity and `toBe` can assert it.
    configureAuditClientHints({ trustedHops: 0 });
    const original = new Error('deadlock detected');
    const db = makeDb({
      faults: { profile: original, deleteUser: new Error('Keycloak deleteUser: HTTP 503') },
    });

    const err = (await failureOf(db.controller.registerParent(BODY, browserRequest()))) as
      InternalServerErrorException & { cause?: unknown };

    expect(err).toBeInstanceOf(InternalServerErrorException);
    const responseBody = err.getResponse() as { message: string; kcUserId: string };
    // `actions.ts:41-45` keeps ONLY `body.message`, so the id has to be IN the
    // string — a sibling field alone would never reach the registrant's screen.
    expect(responseBody.message).toContain(KC_NEW);
    expect(responseBody.message).toMatch(/support/);
    expect(responseBody.kcUserId).toBe(KC_NEW);
    expect(err.cause).toBe(original);

    expect(loggedErrors).toHaveLength(1);
    expect(String(loggedErrors[0]![0])).toContain(KC_NEW);
    expect(String(loggedErrors[0]![0])).toContain('deadlock detected');
    expect(String(loggedErrors[0]![0])).toContain('HTTP 503');
  });
});

/* ================================================================== *
 * (e) — the P2002 branch, named rather than discovered
 * ================================================================== */

describe('(e) — a local unique-constraint conflict yields the SAME 409, and no driver detail', () => {
  // Reachable when a `UserProfile` already exists for this email while no
  // Keycloak identity does (a `seed-demo.ts` row, or a past partial failure of
  // this very handler). Pre-slice it returned a raw Prisma 500 AND the Keycloak
  // identity survived, so the retry hit the step-2 409. With compensation in
  // place the identity no longer survives, so without this mapping the same
  // request would 500 forever — and keep leaking driver detail plus an existence
  // oracle to an anonymous caller on an unthrottled endpoint (`PF-46`).
  it('P2002 → nothing committed, one deleteUser, and the byte-identical conflict copy', async () => {
    configureAuditClientHints({ trustedHops: 0 });
    const prismaConflict = {
      code: 'P2002',
      message: 'Invalid `prisma.userProfile.create()` invocation: Unique constraint failed',
    };
    const db = makeDb({ faults: { profile: prismaConflict } });

    const err = (await failureOf(db.controller.registerParent(BODY, browserRequest()))) as ConflictException;

    expect(err).toBeInstanceOf(ConflictException);
    expect(err.getStatus()).toBe(409);
    expect(err.message).toBe(REFUSAL);
    // No driver detail reaches an anonymous caller, and the two conflict paths
    // are indistinguishable — so the branch leaks no existence bit either.
    expect(err.message).not.toContain('prisma');
    expect(err.message).not.toContain('Invalid `');
    expect(db.profiles()).toHaveLength(0);
    expect(db.auditRows()).toHaveLength(0);
    expect(db.keycloak.deleteUser).toHaveBeenCalledTimes(1);
    expect(db.keycloak.deleteUser).toHaveBeenCalledWith(KC_NEW);
  });
});

/* ================================================================== *
 * (f) — the audit row must never carry the credential it was created to protect
 * ================================================================== */

describe('(f) AC-9 / RGPD — the committed audit row contains no password and no consent noise', () => {
  // Written to FAIL against an `after: { ...body }` implementation, which is the
  // obvious thing to type and would write a plaintext credential into an
  // append-only table that `audit-csv.generator.ts` exports.
  it('serialises with no password value, no `password` key, and no acceptTerms/acceptPrivacy', async () => {
    configureAuditClientHints({ trustedHops: 0 });
    const db = makeDb();

    await db.controller.registerParent(BODY, browserRequest());

    const serialised = JSON.stringify(db.auditRows()[0]);
    expect(serialised).not.toContain(PASSWORD);
    expect(serialised).not.toContain('password');
    expect(serialised).not.toContain('acceptTerms');
    expect(serialised).not.toContain('acceptPrivacy');
    // Data minimisation: the phone number is personal data and the row is
    // exportable, so it stays on the profile and out of the trace.
    expect(serialised).not.toContain('+221770000000');
  });
});

/* ================================================================== *
 * (g) — AC-8: the caller-observable surface is UNCHANGED
 * ================================================================== */

describe('(g) AC-8 — the two 400 branches, the 409 and the response body are byte-identical', () => {
  // Pinned as CASES rather than asserted by reading a diff: "byte-identical" is
  // exactly the claim a reviewer confirms and a later refactor quietly breaks.
  it('refusing the CGU / privacy policy still yields the same 400, and touches nothing', async () => {
    const db = makeDb();

    const err = (await failureOf(
      db.controller.registerParent({ ...BASE_BODY, acceptPrivacy: false } as never, browserRequest()),
    )) as BadRequestException;

    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.message).toBe(TERMS_REFUSAL);
    expect(db.keycloak.findUserByEmail).not.toHaveBeenCalled();
    expect(db.keycloak.createUser).not.toHaveBeenCalled();
    expect(db.prisma.$transaction).not.toHaveBeenCalled();
    expect(db.keycloak.deleteUser).not.toHaveBeenCalled();
  });

  it('a password missing a character class still yields the same 400', async () => {
    const db = makeDb();

    const err = (await failureOf(
      db.controller.registerParent({ ...BASE_BODY, password: 'motdepassefaible' } as never, browserRequest()),
    )) as BadRequestException;

    expect(err.message).toBe(PASSWORD_REFUSAL);
    expect(db.keycloak.createUser).not.toHaveBeenCalled();
    expect(db.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('an existing Keycloak identity still yields the same 409 — no user created, no transaction', async () => {
    const db = makeDb({ keycloakUser: { id: KC_EXISTING, email: EMAIL } });

    const err = (await failureOf(db.controller.registerParent(BODY, browserRequest()))) as ConflictException;

    expect(err).toBeInstanceOf(ConflictException);
    expect(err.message).toBe(REFUSAL);
    expect(db.keycloak.createUser).not.toHaveBeenCalled();
    expect(db.keycloak.setUserPassword).not.toHaveBeenCalled();
    // Nothing was created, so there is nothing to compensate — the cheapest
    // possible refusal, and the compensation must never fire after it.
    expect(db.keycloak.deleteUser).not.toHaveBeenCalled();
    expect(db.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('the success body is still exactly `{ ok: true, email }` — not widened', async () => {
    configureAuditClientHints({ trustedHops: 0 });
    const db = makeDb();

    const result = await db.controller.registerParent(BODY, browserRequest());

    expect(Object.keys(result).sort()).toEqual(['email', 'ok']);
    expect(result).toEqual({ ok: true, email: EMAIL });
  });
});

/* ================================================================== *
 * (h) — G-TENANT
 * ================================================================== */

describe('(h) G-TENANT — tenancy is resolved inside the transaction and cannot be caller-influenced', () => {
  it('the profile AND the audit row both carry the id the in-transaction upsert returned', async () => {
    configureAuditClientHints({ trustedHops: 0 });
    const db = makeDb();

    // `RegisterParentDto` declares no tenant field of any kind; these extra
    // properties are what an attacker would send anyway, and they must be inert.
    await db.controller.registerParent(
      { ...BASE_BODY, tenantId: 'attacker-tenant', tenantSlug: 'autre-ecole', slug: 'autre-ecole' } as never,
      browserRequest(),
    );

    expect(db.tx.tenant.upsert).toHaveBeenCalledTimes(1);
    expect(db.tx.tenant.upsert.mock.calls[0]![0]).toMatchObject({ where: { slug: 'demo' } });
    expect(db.profiles()[0]).toMatchObject({ tenantId: TENANT, authProviderId: KC_NEW });
    expect(db.auditRows()[0]).toMatchObject({ tenantId: TENANT });
    // `AuditLog` has no foreign key to `Tenant` or to `UserProfile` (`ADR-035`
    // D7), so this identity is guaranteed by the ORDERING inside the transaction
    // and by nothing else — which is why it is asserted rather than assumed.
    expect(db.auditRows()[0]!.tenantId).toBe(db.profiles()[0]!.tenantId);
  });
});
