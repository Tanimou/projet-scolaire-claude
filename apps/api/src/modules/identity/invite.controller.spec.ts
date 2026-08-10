import 'reflect-metadata';

import { ConflictException, InternalServerErrorException, Logger } from '@nestjs/common';

import { AUDIT_WRITE_FAILED_MESSAGE } from '../../shared/audit/write-audit';
import type { KeycloakJwtPayload } from '../../shared/auth/jwt.strategy';
import { PERMISSIONS_META_KEY } from '../../shared/auth/requires-permission.decorator';
import type { UserSyncService } from '../../shared/auth/user-sync.service';
import type { KeycloakAdminService } from '../../shared/keycloak/keycloak-admin.service';
import type { PrismaService } from '../../shared/prisma/prisma.service';

import { InviteController } from './invite.controller';

/**
 * S-E04-9 — the invite path stops trading an account for an audit row
 * (`PF-163`, P1 · gates G-AUDIT, G-TENANT, G-AUTHZ, G-DNC · `ADR-035` D15-D17).
 *
 * THE ARTEFACT THAT WAS MISSING
 * -----------------------------
 * `invite.controller.ts` had **no spec at all** while carrying the highest-
 * privilege mutation in the product. S-E04-7 wrapped steps 5-7 in a transaction
 * and, correctly, left every Keycloak call outside it — but steps 3-4 already
 * created an enabled identity and mailed its activation link, and neither is
 * reversible. `ADR-035` D2 makes an audit-insert failure fatal, so a rollback
 * left an enabled `school_admin` with **no `UserProfile`**; on first login
 * `UserSyncService.ensureUser` self-provisions that identity into the demo
 * tenant with realm-derived permissions. That is the ADR-002 breach.
 *
 * THE FAKE STAGES, THEN COMMITS
 * -----------------------------
 * Copied from `apps/api/src/modules/schools/schools.controller.spec.ts:48-117`
 * rather than invented: writes made inside the callback land in `staged` and are
 * moved to `committed` **only if the callback resolves**. A fake that let writes
 * land regardless would prove nothing about rollback — the whole point of cases
 * (ii) and (iii) is that the profile is observably NOT persisted.
 *
 * WHY EACH CASE FAILS AGAINST THE PRE-FIX CONTROLLER
 * --------------------------------------------------
 * The routine's bar is "fails before, passes after", and only the test-architect
 * runs the toolchain — so the pre-fix failure is made DERIVABLE BY READING and
 * is written above each case. The load-bearing trick: cases (ii), (iii) and (iv)
 * assert on `keycloak.deleteUser`, a method that **did not exist** on
 * `KeycloakAdminService` before this slice (the file held only
 * `findUserByEmail`, `createUser`, `assignRealmRoles`, `setUserPassword`,
 * `setRequiredActions`, `sendExecuteActionsEmail`, `configureSmtp`,
 * `resetCredentialsUrl`). A pre-fix controller cannot call it, so those counts
 * are structurally 0 and the assertions cannot pass by accident.
 *
 * THE ADOPTION BRANCH IS *WITHDRAWN*, AND (vi)/(vii) ARE ITS GUARD
 * ---------------------------------------------------------------
 * An earlier draft of this slice let the handler ADOPT a Keycloak identity that
 * had no local `UserProfile`, on the premise that such a state is "produced by
 * exactly this bug". It is not: `UserSyncService.ensureUser` creates the profile
 * LAZILY at first login, so every never-logged-in realm identity matches — and
 * `infra/keycloak/realm-export.json` ships three (`admin@` / `teacher@` /
 * `parent@pilotage.local`) with no row in `seed-demo.ts`. Under ADR-004's single
 * realm, any `users.write` holder in any tenant could have adopted them:
 * password overwritten, a realm role added, and the identity bound for good to
 * the adopter's tenant through the globally unique `authProviderId`. Cases (vi)
 * and (vii) below are the regression guard that keeps that door shut.
 */

const TENANT = 'tenant-1';
const ACTOR = 'actor-profile-1';
const EMAIL = 'directrice@college-x.fr';
const KC_NEW = 'kc-created-by-this-request';
const KC_EXISTING = 'kc-identity-that-already-exists';
/** The realm's seeded, never-logged-in admin — profile-less by design. */
const SEEDED_REALM_ADMIN = 'admin@pilotage.local';

function jwt(roles: string[]): KeycloakJwtPayload {
  return { sub: 'kc-actor', realm_access: { roles } } as unknown as KeycloakJwtPayload;
}

const BASE_BODY = {
  email: EMAIL,
  firstName: 'Awa',
  lastName: 'Diop',
  realmRole: 'school_admin' as 'school_admin' | 'teacher' | 'parent',
};
const BODY = BASE_BODY as never;

type Row = Record<string, unknown>;
type Staged = { kind: 'profile' | 'userRole' | 'audit'; row: Row };

function makeDb(
  options: {
    /** What `findUserByEmail` answers — `null` is the nominal fresh invite. */
    keycloakUser?: { id: string; email: string } | null;
    faults?: { profile?: Error; audit?: Error; deleteUser?: Error };
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
    userProfile: {
      create: jest.fn(async ({ data }: { data: Row }) => {
        if (faults.profile) throw faults.profile;
        const row: Row = { id: 'profile-1', ...data };
        staged.push({ kind: 'profile', row });
        return row;
      }),
    },
    // Present even though no case sets `customRoleSlug`: omitting it would make a
    // future custom-role case fail for the wrong reason, and a green-by-accident
    // spec is the failure this epic is named after.
    role: { findFirst: jest.fn().mockResolvedValue(null) },
    userRole: {
      create: jest.fn(async ({ data }: { data: Row }) => {
        staged.push({ kind: 'userRole', row: data });
        return { id: 'user-role-1', ...data };
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

  // `findUnique` / `count` are mocked so that a re-introduced identity probe
  // would be OBSERVABLE rather than crash: case (vii) asserts neither is called.
  const prisma = {
    userProfile: {
      findUnique: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(0),
    },
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
    assignRealmRoles: jest.fn(async (_userId: string, _roles: string[]) => count(undefined)),
    setUserPassword: jest.fn(
      async (_userId: string, _password: string, _temporary?: boolean) => count(undefined),
    ),
    setRequiredActions: jest.fn(async (_userId: string, _actions: string[]) => count(undefined)),
    sendExecuteActionsEmail: jest.fn(
      async (_userId: string, _actions: string[], _clientId?: string, _redirectUri?: string) =>
        count(undefined),
    ),
    deleteUser: jest.fn(async (_userId: string) => {
      count(undefined);
      if (faults.deleteUser) throw faults.deleteUser;
    }),
  };

  const users = {
    ensureUser: jest.fn().mockResolvedValue({ id: ACTOR, tenantId: TENANT }),
  };

  const controller = new InviteController(
    prisma as unknown as PrismaService,
    users as unknown as UserSyncService,
    keycloak as unknown as KeycloakAdminService,
  );

  return {
    controller,
    prisma,
    keycloak,
    users,
    tx,
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

const REFUSAL = `Un utilisateur existe déjà avec l'email ${EMAIL}. Il peut se connecter directement.`;

let loggedErrors: unknown[][];

beforeEach(() => {
  loggedErrors = [];
  jest.spyOn(Logger.prototype, 'error').mockImplementation(((...args: unknown[]) => {
    loggedErrors.push(args);
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

/* ================================================================== *
 * (i) — the happy path, unchanged
 * ================================================================== */

describe('(i) AC-7 / G-AUDIT — the nominal invite writes the profile AND its audit row', () => {
  // Pre-fix: this case PASSES against the old controller. It is the control that
  // proves the compensation did not break the path it protects — the only case
  // here allowed to pass before the fix.
  it('commits one profile and one row, and echoes the created kcUserId', async () => {
    const db = makeDb();

    const result = await db.controller.invite(BODY, jwt(['school_admin']));

    expect(db.profiles()).toHaveLength(1);
    expect(db.auditRows()).toHaveLength(1);
    expect(db.auditRows()[0]).toMatchObject({
      tenantId: TENANT,
      actorId: ACTOR,
      actorRole: 'school_admin',
      portal: 'admin',
      action: 'user.invite',
      resourceType: 'user_profile',
      resourceId: 'profile-1',
    });
    expect(db.auditRows()[0]!.after).toMatchObject({
      email: EMAIL,
      realmRole: 'school_admin',
    });
    // G-TENANT — `UserProfile.tenantId` carries the scoping and it is the
    // CALLER's, never a body value and never derived from the Keycloak payload.
    expect(db.profiles()[0]).toMatchObject({ tenantId: TENANT, authProviderId: KC_NEW });
    expect(result).toMatchObject({ ok: true, kcUserId: KC_NEW, emailSentTo: EMAIL });
    expect(db.keycloak.deleteUser).not.toHaveBeenCalled();
  });

  it('opens the transaction at most once, and makes no Keycloak call inside it', async () => {
    // The invariant S-E04-7 established. Compensation is added AROUND the
    // transaction precisely so this stays true: an HTTP round-trip inside an
    // interactive transaction is how a 5 s Prisma timeout becomes an incident.
    const db = makeDb();
    await db.controller.invite(BODY, jwt(['school_admin']));

    expect(db.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(db.keycloakCallsInsideTransaction()).toBe(0);
  });

  it('ADR-004 — a parent invite arms UPDATE_PASSWORD only; admin/teacher also get TOTP', async () => {
    const parentDb = makeDb();
    await parentDb.controller.invite({ ...BASE_BODY, realmRole: 'parent' } as never, jwt(['school_admin']));
    expect(parentDb.keycloak.createUser.mock.calls[0]![0]).toMatchObject({
      realmRoles: ['parent'],
      requiredActions: ['UPDATE_PASSWORD'],
    });

    const adminDb = makeDb();
    await adminDb.controller.invite(BODY, jwt(['school_admin']));
    expect(adminDb.keycloak.createUser.mock.calls[0]![0]).toMatchObject({
      realmRoles: ['school_admin'],
      requiredActions: ['UPDATE_PASSWORD', 'CONFIGURE_TOTP'],
    });
  });
});

/* ================================================================== *
 * (ii) / (iii) — AC-1: the rollback no longer leaves an account behind
 * ================================================================== */

describe('(ii)(iii) AC-1 — a rollback compensates the identity it just created', () => {
  // Pre-fix: `keycloak.deleteUser` did not exist on the service, so the pre-fix
  // controller cannot have called it — the expectation is structurally 0 before
  // the fix. The `profiles()` assertion also fails pre-fix for a second, weaker
  // reason only if a non-staging fake were used; with this fake it holds either
  // way, which is why the deleteUser count is the load-bearing half.
  it('(ii) audit write throws → nothing persisted, and the Keycloak user is deleted', async () => {
    const audit = new Error('insert into audit_log failed');
    const db = makeDb({ faults: { audit } });

    const err = (await failureOf(db.controller.invite(BODY, jwt(['school_admin'])))) as
      InternalServerErrorException & { cause?: unknown };

    expect(db.profiles()).toHaveLength(0);
    expect(db.auditRows()).toHaveLength(0);
    expect(db.keycloak.deleteUser).toHaveBeenCalledTimes(1);
    expect(db.keycloak.deleteUser).toHaveBeenCalledWith(KC_NEW);
    // AC-1 — non-masking. The error the caller gets is the one the SEAM raised
    // (`write-audit.ts:165` wraps the driver error precisely so the operator
    // reads a sentence), re-thrown by the compensation UNCHANGED: same class,
    // same message, same `cause`. And that sentence — « L'opération a été
    // annulée … » — is now literally true, which is the acceptance check.
    expect(err).toBeInstanceOf(InternalServerErrorException);
    expect(err.message).toBe(AUDIT_WRITE_FAILED_MESSAGE);
    expect(err.cause).toBe(audit);
    // Silent success, loud failure: a successful rollback says nothing about the
    // Keycloak account it cleaned up.
    expect(err.message).not.toContain(KC_NEW);
  });

  it('(iii) profile create throws → same compensation, original cause re-thrown', async () => {
    const profile = new Error('P2002 unique constraint');
    const db = makeDb({ faults: { profile } });

    const err = await failureOf(db.controller.invite(BODY, jwt(['school_admin'])));

    expect(db.profiles()).toHaveLength(0);
    expect(db.keycloak.deleteUser).toHaveBeenCalledWith(KC_NEW);
    expect(err).toBe(profile);
    expect(err).not.toBeInstanceOf(InternalServerErrorException);
  });
});

/* ================================================================== *
 * (iv) — AC-2: a failed compensation is loud, never silent
 * ================================================================== */

describe('(iv) AC-2 — when the compensation itself fails, the orphan is named', () => {
  // Pre-fix: no compensation existed, so no such error could be raised and
  // `Logger.error` was never called from this handler. Both assertions are
  // unreachable before the fix.
  it('names the orphaned kcUserId in the MESSAGE, carries the cause, and logs it', async () => {
    // A PROFILE fault rather than an audit fault, deliberately: the seam wraps
    // its own failure, so `cause` would then be the wrapper. Here the original
    // error travels by identity and `toBe` can assert it.
    const original = new Error('P2002 unique constraint on user_profile');
    const db = makeDb({
      faults: { profile: original, deleteUser: new Error('Keycloak deleteUser: HTTP 503') },
    });

    const err = (await failureOf(db.controller.invite(BODY, jwt(['school_admin'])))) as
      InternalServerErrorException & { cause?: unknown };

    expect(err).toBeInstanceOf(InternalServerErrorException);
    const body = err.getResponse() as { message: string; kcUserId: string };
    // `actions.ts:26-34` keeps ONLY `body.message`, so the id has to be IN the
    // string — a sibling field alone would never reach the admin's screen.
    expect(body.message).toContain(KC_NEW);
    expect(body.message).toMatch(/administrateur de plateforme/);
    expect(body.kcUserId).toBe(KC_NEW);
    // AC-1 still governs the information even when AC-2 governs the message.
    expect(err.cause).toBe(original);
    expect(loggedErrors).toHaveLength(1);
    expect(String(loggedErrors[0]![0])).toContain(KC_NEW);
    expect(String(loggedErrors[0]![0])).toContain('P2002 unique constraint on user_profile');
    expect(String(loggedErrors[0]![0])).toContain('HTTP 503');
  });
});

/* ================================================================== *
 * (v)(vi)(vii) — the refusal, and the adoption door that stays shut
 * ================================================================== */

describe('(v)(vi)(vii) — an existing Keycloak identity is refused, always, identically', () => {
  it('(v) a Keycloak account for this email → 409, no user created, no transaction', async () => {
    const db = makeDb({ keycloakUser: { id: KC_EXISTING, email: EMAIL } });

    const err = await failureOf(db.controller.invite(BODY, jwt(['school_admin'])));

    expect(err).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).message).toBe(REFUSAL);
    expect(db.keycloak.createUser).not.toHaveBeenCalled();
    expect(db.keycloak.deleteUser).not.toHaveBeenCalled();
    expect(db.prisma.$transaction).not.toHaveBeenCalled();
  });

  // THE SECURITY REGRESSION GUARD. This case is what fails the moment anyone
  // re-introduces the withdrawn adoption branch: a Keycloak identity with NO
  // local profile is precisely the shape a never-logged-in realm account has —
  // `UserSyncService.ensureUser` creates profiles LAZILY at first login, and
  // `realm-export.json` ships `admin@pilotage.local` in exactly that state. The
  // `prisma` fake answers "no profile anywhere" here, which is the state an
  // adopting controller would treat as green.
  it('(vi) G-TENANT — a profile-LESS seeded realm account is NOT adoptable', async () => {
    const db = makeDb({ keycloakUser: { id: KC_EXISTING, email: SEEDED_REALM_ADMIN } });

    const err = await failureOf(db.controller.invite(BODY, jwt(['school_admin'])));

    expect(err).toBeInstanceOf(ConflictException);
    // Nothing about that identity was touched: no role added, no credential
    // overwritten, no required action replaced, no profile bound to my tenant.
    expect(db.keycloak.assignRealmRoles).not.toHaveBeenCalled();
    expect(db.keycloak.setUserPassword).not.toHaveBeenCalled();
    expect(db.keycloak.setRequiredActions).not.toHaveBeenCalled();
    expect(db.keycloak.sendExecuteActionsEmail).not.toHaveBeenCalled();
    expect(db.prisma.$transaction).not.toHaveBeenCalled();
    expect(db.profiles()).toHaveLength(0);
  });

  // AC-5's no-oracle requirement, now met STRUCTURALLY rather than by keeping two
  // literals in sync: there is a single refusal branch, so the caller cannot tell
  // "profile in my tenant" from "profile in another tenant" from "no profile
  // anywhere" — not by message, not by status, and not by timing-visible extra
  // queries, because no local read is issued at all.
  it('(vii) AC-5 — the refusal issues NO local lookup, so it leaks no existence bit', async () => {
    const db = makeDb({ keycloakUser: { id: KC_EXISTING, email: EMAIL } });

    const err = (await failureOf(db.controller.invite(BODY, jwt(['school_admin'])))) as ConflictException;

    expect(err.getStatus()).toBe(409);
    expect(err.message).toBe(REFUSAL);
    // The untenanted `userProfile.count({ where: { email } })` probe an adoption
    // branch needs is absent — the only untenanted read this handler ever had.
    expect(db.prisma.userProfile.count).not.toHaveBeenCalled();
    expect(db.prisma.userProfile.findUnique).not.toHaveBeenCalled();
  });
});

/* ================================================================== *
 * G-AUTHZ — who may invite did not change
 * ================================================================== */

describe('G-AUTHZ — the guard metadata on invite() is untouched', () => {
  // A local assertion, deliberately NOT a second copy of the canonical table at
  // `provenance-callsites.spec.ts:649-655`. Forking that table would be the
  // drift this epic exists to remove; one negative here is the cheap half.
  it('still requires exactly ["users.write"]', () => {
    expect(Reflect.getMetadata(PERMISSIONS_META_KEY, InviteController.prototype.invite)).toEqual([
      'users.write',
    ]);
  });
});
