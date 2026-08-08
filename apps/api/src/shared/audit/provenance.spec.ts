import { type KeycloakJwtPayload } from '../auth/jwt.strategy';

import { NO_CLIENT_HINTS } from './client-hints';
import {
  MAX_USER_AGENT_LENGTH,
  deriveAlertActorProvenance,
  deriveAuditProvenance,
  sanitiseInetOrNull,
  truncateUserAgent,
} from './provenance';

/**
 * S-E04-1 — pure-function cases for the shared provenance home.
 *
 * The role/portal cases below MOVED here verbatim from
 * `modules/alerts/alert-provenance.spec.ts` (deleted with its subject): this
 * slice changes *where* the derivation lives, not *what it does*, so the
 * behaviour that was pinned before the move is still pinned after it.
 *
 * What is NEW here is the part the move made necessary:
 *  • `deriveAuditProvenance` PASSES THROUGH the already-extracted hints and
 *    invents nothing — `S-E04-3` narrowed the second parameter from `unknown` to
 *    `AuditClientHints`, so the case that used to assert « null even when handed
 *    a request carrying both » is now restated over the invariant that survived:
 *    the function reads no header itself, so a raw request-shaped object yields
 *    NOTHING, while an extracted pair is carried verbatim;
 *  • `deriveAlertActorProvenance` AGREES with `deriveAuditProvenance` on every
 *    role and on the fallback — the delegation is asserted, not assumed. A
 *    re-implementation inside the delegate would be a second declaration.
 *
 * The controller-boundary assertions (who actually reaches `auditLog.create`)
 * are in `provenance-callsites.spec.ts`; a helper's return value is not evidence
 * that a handler uses it — that was `S-E06-6`'s recorded weakness.
 */

function jwtWith(roles: string[] | undefined): KeycloakJwtPayload {
  return {
    sub: 'user-1',
    ...(roles === undefined ? {} : { realm_access: { roles } }),
  } as unknown as KeycloakJwtPayload;
}

const ALL_ROLE_CASES: [string[] | undefined, string | null, string | null][] = [
  [['super_admin'], 'super_admin', 'admin'],
  [['school_admin'], 'school_admin', 'admin'],
  [['teacher'], 'teacher', 'teacher'],
  [['parent'], 'parent', 'parent'],
  [['school_admin', 'super_admin'], 'super_admin', 'admin'],
  [['teacher', 'super_admin'], 'super_admin', 'admin'],
  [['offline_access', 'uma_authorization'], 'offline_access', null],
  [[], null, null],
  [undefined, null, null],
];

describe('deriveAlertActorProvenance (moved verbatim from modules/alerts)', () => {
  it('AC1 — school_admin maps to actorRole school_admin / portal admin', () => {
    expect(deriveAlertActorProvenance(jwtWith(['school_admin']))).toEqual({
      actorRole: 'school_admin',
      portal: 'admin',
    });
  });

  it('AC2 — teacher maps to actorRole teacher / portal teacher', () => {
    expect(deriveAlertActorProvenance(jwtWith(['teacher']))).toEqual({
      actorRole: 'teacher',
      portal: 'teacher',
    });
  });

  it('parent maps to actorRole parent / portal parent', () => {
    expect(deriveAlertActorProvenance(jwtWith(['parent']))).toEqual({
      actorRole: 'parent',
      portal: 'parent',
    });
  });

  it('AC3 — super_admin wins by precedence even alongside school_admin', () => {
    expect(deriveAlertActorProvenance(jwtWith(['school_admin', 'super_admin']))).toEqual({
      actorRole: 'super_admin',
      portal: 'admin',
    });
  });

  it('precedence is independent of array order (teacher before super_admin)', () => {
    expect(deriveAlertActorProvenance(jwtWith(['teacher', 'super_admin']))).toEqual({
      actorRole: 'super_admin',
      portal: 'admin',
    });
  });

  it('AC4 — only unknown roles → first role string, null portal', () => {
    expect(deriveAlertActorProvenance(jwtWith(['offline_access', 'uma_authorization']))).toEqual({
      actorRole: 'offline_access',
      portal: null,
    });
  });

  it('AC4 — empty roles array → null actorRole and null portal', () => {
    expect(deriveAlertActorProvenance(jwtWith([]))).toEqual({
      actorRole: null,
      portal: null,
    });
  });

  it('AC4 — missing realm_access → null actorRole and null portal (never throws)', () => {
    expect(deriveAlertActorProvenance(jwtWith(undefined))).toEqual({
      actorRole: null,
      portal: null,
    });
  });
});

describe('deriveAuditProvenance — the canonical derivation', () => {
  it.each(ALL_ROLE_CASES)(
    'roles %p → actorRole %p / portal %p',
    (roles, actorRole, portal) => {
      expect(deriveAuditProvenance(jwtWith(roles))).toEqual({
        actorRole,
        portal,
        ipAddress: null,
        userAgent: null,
      });
    },
  );

  it('deriveAlertActorProvenance DELEGATES — it agrees on every case, including the fallback', () => {
    for (const [roles] of ALL_ROLE_CASES) {
      const jwt = jwtWith(roles);
      const canonical = deriveAuditProvenance(jwt);
      expect(deriveAlertActorProvenance(jwt)).toEqual({
        actorRole: canonical.actorRole,
        portal: canonical.portal,
      });
    }
  });

  it('S-E04-3 — carries the already-extracted hints VERBATIM, on both branches', () => {
    const hints = { ipAddress: '92.184.7.14', userAgent: 'Mozilla/5.0 (Windows NT 10.0)' };
    expect(deriveAuditProvenance(jwtWith(['school_admin']), hints)).toEqual({
      actorRole: 'school_admin',
      portal: 'admin',
      ...hints,
    });
    // The unrecognised-role branch too — a value must not be dropped by the
    // branch that already loses the portal (ADR-036 D8).
    expect(deriveAuditProvenance(jwtWith(['offline_access']), hints)).toEqual({
      actorRole: 'offline_access',
      portal: null,
      ...hints,
    });
  });

  it('ADR-036 D5 — it reads NO header of its own: a raw request yields nothing', () => {
    // This is what `S-E04-1`'s « null even when handed a request » case was
    // really protecting, and it survives the narrowing intact. The extraction
    // moved to `client-hints.ts`; the purity did not move with it. If this
    // function ever grew a header read, THIS case would go green on the wrong
    // value — so it asserts the null explicitly rather than by omission.
    const req = {
      ip: '203.0.113.7',
      headers: { 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64)', 'x-forwarded-for': '1.2.3.4' },
    } as unknown as { ipAddress: string | null; userAgent: string | null };

    expect(deriveAuditProvenance(jwtWith(['school_admin']), req)).toEqual({
      actorRole: 'school_admin',
      portal: 'admin',
      ipAddress: null,
      userAgent: null,
    });
  });

  it('S-E04-3 — a PARTIAL capture is carried as-is; the two fields are independent', () => {
    // A row where only one value survived the sanitiser is legal and must not be
    // collapsed to « nothing »: `/admin/audit` renders each field separately.
    expect(
      deriveAuditProvenance(jwtWith(['teacher']), { ipAddress: null, userAgent: 'curl/8.5' }),
    ).toEqual({ actorRole: 'teacher', portal: 'teacher', ipAddress: null, userAgent: 'curl/8.5' });
    expect(
      deriveAuditProvenance(jwtWith(['teacher']), { ipAddress: '2001:db8::1', userAgent: null }),
    ).toEqual({
      actorRole: 'teacher',
      portal: 'teacher',
      ipAddress: '2001:db8::1',
      userAgent: null,
    });
  });

  it('omitting the hints still yields an honest blank — never an invented value', () => {
    expect(deriveAuditProvenance(jwtWith(['school_admin']))).toEqual({
      actorRole: 'school_admin',
      portal: 'admin',
      ipAddress: null,
      userAgent: null,
    });
    expect(deriveAuditProvenance(jwtWith(['school_admin']), NO_CLIENT_HINTS)).toEqual(
      deriveAuditProvenance(jwtWith(['school_admin'])),
    );
  });

  it('never throws on a malformed payload — the audit write is best-effort', () => {
    expect(() => deriveAuditProvenance({} as unknown as KeycloakJwtPayload)).not.toThrow();
    expect(deriveAuditProvenance({} as unknown as KeycloakJwtPayload)).toEqual({
      actorRole: null,
      portal: null,
      ipAddress: null,
      userAgent: null,
    });
  });
});

describe('sanitiseInetOrNull / truncateUserAgent (moved verbatim from modules/calendar)', () => {
  it.each([
    ['203.0.113.7', '203.0.113.7'],
    ['  203.0.113.7  ', '203.0.113.7'],
    ['2001:db8::1', '2001:db8::1'],
    ['203.0.113.7, 70.41.3.18', null],
    ['not-an-ip', null],
    ['', null],
    ['   ', null],
  ])('sanitiseInetOrNull(%p) → %p', (raw, expected) => {
    expect(sanitiseInetOrNull(raw)).toBe(expected);
  });

  it.each([[undefined], [null]])('sanitiseInetOrNull(%p) → null', (raw) => {
    expect(sanitiseInetOrNull(raw)).toBeNull();
  });

  it('truncateUserAgent trims, nulls the empty, and caps at MAX_USER_AGENT_LENGTH', () => {
    expect(truncateUserAgent('  Mozilla/5.0  ')).toBe('Mozilla/5.0');
    expect(truncateUserAgent('   ')).toBeNull();
    expect(truncateUserAgent(undefined)).toBeNull();
    expect(truncateUserAgent(null)).toBeNull();
    expect(truncateUserAgent('x'.repeat(MAX_USER_AGENT_LENGTH + 50))).toHaveLength(
      MAX_USER_AGENT_LENGTH,
    );
  });
});
