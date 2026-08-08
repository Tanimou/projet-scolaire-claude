import { type KeycloakJwtPayload } from '../auth/jwt.strategy';

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
 *  • `deriveAuditProvenance` returns `ipAddress`/`userAgent` `null` even when
 *    handed a request-shaped object carrying both — the executable form of
 *    `ADR-036` D4/D5 and the thing that catches a premature `S-E04-3`;
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

  it('T-5 / ADR-036 D4 — ipAddress and userAgent stay null even when the 2nd argument carries both', () => {
    // The honest form of AC-6: this is the test that catches a premature
    // S-E04-3 ("we were in there anyway"). The second parameter is DELIBERATELY
    // unread until the forwarding chain exists and ADR-036's hop count is
    // applied at a seam we control. A stored proxy address is a wrong value that
    // looks right; the null is the decision executing.
    const req = {
      ip: '203.0.113.7',
      headers: { 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64)', 'x-forwarded-for': '1.2.3.4' },
    };

    expect(deriveAuditProvenance(jwtWith(['school_admin']), req)).toEqual({
      actorRole: 'school_admin',
      portal: 'admin',
      ipAddress: null,
      userAgent: null,
    });
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
