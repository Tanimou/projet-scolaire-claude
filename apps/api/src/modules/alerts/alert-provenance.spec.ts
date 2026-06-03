import { deriveAlertActorProvenance } from './alert-provenance';
import { type KeycloakJwtPayload } from '../../shared/auth/jwt.strategy';

function jwtWith(roles: string[] | undefined): KeycloakJwtPayload {
  return {
    sub: 'user-1',
    ...(roles === undefined ? {} : { realm_access: { roles } }),
  };
}

describe('deriveAlertActorProvenance', () => {
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
