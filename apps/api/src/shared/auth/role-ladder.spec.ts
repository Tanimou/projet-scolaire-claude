import { ForbiddenException } from '@nestjs/common';

import { REALM_ROLE_PERMISSIONS } from './permissions.constants';
import {
  LADDER_SELF_GRANT_MESSAGE,
  REALM_ROLE_LADDER,
  assertMayConferRealmRole,
  grantorRank,
  isLadderRole,
  rankOf,
} from './role-ladder';

/**
 * ADR-040 / S-E05-2b — the delegation ladder.
 *
 * No database, no Nest context: these are pure predicates, which is the whole
 * point of putting the decision in one module. Every case below is a security
 * assertion, so each states what an attacker gets if it regresses.
 */

const ADMIN = 'admin-user-id';
const SUBJECT = 'subject-user-id';

describe('the ladder is the seeded role set, and nothing else', () => {
  it('ranks exactly the five seeded realm roles, in ascending authority', () => {
    expect([...REALM_ROLE_LADDER]).toEqual(['student', 'parent', 'teacher', 'school_admin', 'super_admin']);
  });

  it('covers every key of REALM_ROLE_PERMISSIONS — a seeded role added without a rung is a RED test, not a silent refusal', () => {
    // Without this, adding a sixth seeded role would fail closed in production
    // with no warning at development time. The ladder must be kept in step by a
    // failing test rather than by an incident.
    expect([...REALM_ROLE_LADDER].sort()).toEqual(Object.keys(REALM_ROLE_PERMISSIONS).sort());
  });

  it('rankOf is ascending, and an unknown slug is undefined rather than 0', () => {
    expect(rankOf('student')).toBe(0);
    expect(rankOf('super_admin')).toBe(4);
    expect(rankOf('school_admin')).toBeGreaterThan(rankOf('teacher') as number);
    // The dangerous confusion: `undefined` must NOT be falsy-collapsed to rung 0,
    // which would make every unknown role grantable by anybody above student.
    expect(rankOf('offline_access')).toBeUndefined();
    expect(rankOf('')).toBeUndefined();
    expect(rankOf(null)).toBeUndefined();
    expect(rankOf(undefined)).toBeUndefined();
    expect(isLadderRole('teacher')).toBe(true);
    expect(isLadderRole('custom-role')).toBe(false);
  });
});

describe('grantorRank — the HIGHEST rung held, ignoring token noise', () => {
  it('takes the highest, not the first', () => {
    expect(grantorRank(['teacher', 'school_admin'])).toBe(rankOf('school_admin'));
    expect(grantorRank(['school_admin', 'teacher'])).toBe(rankOf('school_admin'));
  });

  it('ignores unrankable entries rather than refusing on them', () => {
    // Keycloak tokens carry `offline_access`, `uma_authorization`, etc. Those are
    // noise in the token, not a grant request.
    expect(grantorRank(['offline_access', 'teacher', 'uma_authorization'])).toBe(rankOf('teacher'));
  });

  it('is undefined when nothing rankable is held, or the claim is absent/malformed', () => {
    expect(grantorRank([])).toBeUndefined();
    expect(grantorRank(['offline_access'])).toBeUndefined();
    expect(grantorRank(undefined)).toBeUndefined();
    expect(grantorRank('school_admin' as unknown as string[])).toBeUndefined();
  });
});

describe('AC-1 — the path PF-178 broke: an admin can onboard', () => {
  it.each(['teacher', 'parent', 'student'])('school_admin may confer %s', (target) => {
    expect(() => assertMayConferRealmRole(['school_admin'], target, ADMIN, SUBJECT)).not.toThrow();
  });

  it('super_admin may confer school_admin', () => {
    expect(() => assertMayConferRealmRole(['super_admin'], 'school_admin', ADMIN, SUBJECT)).not.toThrow();
  });
});

describe('AC-2 — strictly below: at or above the grantor rung is refused', () => {
  it('teacher may NOT confer school_admin — the vertical escalation PF-156 closed', () => {
    expect(() => assertMayConferRealmRole(['teacher'], 'school_admin', ADMIN, SUBJECT)).toThrow(ForbiddenException);
  });

  it('school_admin may NOT confer school_admin — no lateral self-cloning; only a super_admin mints an admin', () => {
    expect(() => assertMayConferRealmRole(['school_admin'], 'school_admin', ADMIN, SUBJECT)).toThrow(
      ForbiddenException,
    );
  });

  it('school_admin may NOT confer super_admin', () => {
    expect(() => assertMayConferRealmRole(['school_admin'], 'super_admin', ADMIN, SUBJECT)).toThrow(
      ForbiddenException,
    );
  });

  it('a student may confer nothing at all', () => {
    for (const target of REALM_ROLE_LADDER) {
      expect(() => assertMayConferRealmRole(['student'], target, ADMIN, SUBJECT)).toThrow(ForbiddenException);
    }
  });
});

describe('AC-3 — NO SELF-GRANT, at any rung. This is the rule that makes the ladder safe', () => {
  // Without it: a school_admin grants themselves `teacher`, re-authenticates, and
  // holds grades.revise — exactly the escalation S-E05-2 closed, by a longer path.
  it.each(['student', 'parent', 'teacher'])('school_admin may NOT grant %s to THEMSELVES', (target) => {
    expect(() => assertMayConferRealmRole(['school_admin'], target, ADMIN, ADMIN)).toThrow(ForbiddenException);
  });

  it('a super_admin — who outranks everyone — may not self-grant either', () => {
    // The one principal with the most to gain, and the one the rank check alone
    // would have permitted.
    expect(() => assertMayConferRealmRole(['super_admin'], 'school_admin', ADMIN, ADMIN)).toThrow(ForbiddenException);
  });

  it('the self-grant refusal is checked BEFORE the rank comparison, and says so', () => {
    // Order matters: a rank-first implementation would return the rank message for
    // a self-grant below one's rung, hiding the more serious event in the logs.
    try {
      assertMayConferRealmRole(['super_admin'], 'teacher', ADMIN, ADMIN);
      throw new Error('expected a refusal');
    } catch (error) {
      expect((error as ForbiddenException).getResponse()).toMatchObject({
        message: LADDER_SELF_GRANT_MESSAGE,
      });
    }
  });
});

describe('AC-4 — an unclassifiable state is never a pass (DNC-08)', () => {
  it('an unranked target is UNGRANTABLE, even by a super_admin', () => {
    expect(() => assertMayConferRealmRole(['super_admin'], 'auditor', ADMIN, SUBJECT)).toThrow(ForbiddenException);
  });

  it('a grantor holding no rankable role is refused, not treated as rung 0', () => {
    expect(() => assertMayConferRealmRole(['offline_access'], 'student', ADMIN, SUBJECT)).toThrow(ForbiddenException);
    expect(() => assertMayConferRealmRole([], 'student', ADMIN, SUBJECT)).toThrow(ForbiddenException);
    expect(() => assertMayConferRealmRole(undefined, 'student', ADMIN, SUBJECT)).toThrow(ForbiddenException);
  });

  it('the refusal body keeps the { message, required, missing } shape the web client renders', () => {
    // privilege-ceiling.ts:147-152 — `message` MUST stay a string: the admin role
    // editor renders it directly as a React child.
    try {
      assertMayConferRealmRole(['teacher'], 'school_admin', ADMIN, SUBJECT);
      throw new Error('expected a refusal');
    } catch (error) {
      const body = (error as ForbiddenException).getResponse() as Record<string, unknown>;
      expect(typeof body.message).toBe('string');
      expect(Array.isArray(body.required)).toBe(true);
      expect(Array.isArray(body.missing)).toBe(true);
    }
  });
});
