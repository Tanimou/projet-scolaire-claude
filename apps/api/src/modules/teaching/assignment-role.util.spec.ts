import { resolveRoleSync } from './assignment-role.util';

/**
 * Tests de la logique de synchronisation/rétrogradation de rôle.
 * Invariant métier : role === 'principal' ⇔ isMainTeacher === true,
 * et un seul principal par classe (la rétrogradation des autres est testée
 * indirectement : dès qu'une affectation devient principal, isMainTeacher=true
 * déclenche le updateMany côté contrôleur).
 */
describe('resolveRoleSync', () => {
  const current = { role: 'subject_teacher' as const, isMainTeacher: false };

  describe('depuis le champ role', () => {
    it('role=principal force isMainTeacher=true', () => {
      expect(resolveRoleSync({ role: 'principal', current })).toEqual({
        role: 'principal',
        isMainTeacher: true,
      });
    });

    it('role=assistant force isMainTeacher=false', () => {
      expect(resolveRoleSync({ role: 'assistant', current })).toEqual({
        role: 'assistant',
        isMainTeacher: false,
      });
    });

    it('role=subject_teacher force isMainTeacher=false', () => {
      expect(resolveRoleSync({ role: 'subject_teacher', current })).toEqual({
        role: 'subject_teacher',
        isMainTeacher: false,
      });
    });

    it('role=principal a la priorité sur isMainTeacher=false fourni en même temps', () => {
      // role fait foi : principal ⇒ isMainTeacher=true même si le booléen dit false.
      expect(resolveRoleSync({ role: 'principal', isMainTeacher: false, current })).toEqual({
        role: 'principal',
        isMainTeacher: true,
      });
    });

    it('role=assistant a la priorité sur isMainTeacher=true fourni en même temps', () => {
      expect(resolveRoleSync({ role: 'assistant', isMainTeacher: true, current })).toEqual({
        role: 'assistant',
        isMainTeacher: false,
      });
    });
  });

  describe('depuis le champ isMainTeacher (compat. ascendante)', () => {
    it('isMainTeacher=true promeut en principal', () => {
      expect(resolveRoleSync({ isMainTeacher: true, current })).toEqual({
        role: 'principal',
        isMainTeacher: true,
      });
    });

    it('isMainTeacher=false rétrograde un principal courant en subject_teacher', () => {
      expect(
        resolveRoleSync({
          isMainTeacher: false,
          current: { role: 'principal', isMainTeacher: true },
        }),
      ).toEqual({ role: 'subject_teacher', isMainTeacher: false });
    });

    it('isMainTeacher=false conserve un rôle non-principal (assistant)', () => {
      expect(
        resolveRoleSync({
          isMainTeacher: false,
          current: { role: 'assistant', isMainTeacher: false },
        }),
      ).toEqual({ role: 'assistant', isMainTeacher: false });
    });
  });

  describe('aucun changement', () => {
    it('retourne undefined quand ni role ni isMainTeacher ne sont fournis', () => {
      expect(resolveRoleSync({ current })).toBeUndefined();
    });

    it("retourne undefined même si l'état courant est principal (rien à écrire)", () => {
      expect(
        resolveRoleSync({ current: { role: 'principal', isMainTeacher: true } }),
      ).toBeUndefined();
    });
  });

  describe('cohérence de l’invariant role ⇔ isMainTeacher', () => {
    it('toute sortie respecte principal ⇔ isMainTeacher', () => {
      const cases: Array<Parameters<typeof resolveRoleSync>[0]> = [
        { role: 'principal', current },
        { role: 'assistant', current },
        { role: 'subject_teacher', current },
        { isMainTeacher: true, current },
        { isMainTeacher: false, current: { role: 'principal', isMainTeacher: true } },
      ];
      for (const input of cases) {
        const out = resolveRoleSync(input);
        if (!out) continue;
        expect(out.isMainTeacher).toBe(out.role === 'principal');
      }
    });
  });
});
