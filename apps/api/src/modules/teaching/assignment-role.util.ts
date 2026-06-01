import { type AssignmentRole } from '@pilotage/contracts';

/**
 * Normalise le couple (role, isMainTeacher) pour qu'il reste cohérent dans les
 * deux sens, en partant des deux entrées optionnelles du DTO et d'un état courant.
 *
 * Règle métier : `role === 'principal'` ⇔ `isMainTeacher === true`.
 *   - si `role` est fourni : il fait foi (principal ⇒ isMainTeacher=true ; sinon false) ;
 *   - sinon si `isMainTeacher` est fourni : true ⇒ principal, false ⇒ on rétrograde
 *     un éventuel `principal` courant en `subject_teacher` (les autres rôles inchangés) ;
 *   - sinon : aucun changement demandé.
 *
 * Retourne `undefined` quand rien n'est à écrire (ni `role` ni `isMainTeacher` fournis).
 */
export function resolveRoleSync(input: {
  role?: AssignmentRole;
  isMainTeacher?: boolean;
  current: { role: AssignmentRole; isMainTeacher: boolean };
}): { role: AssignmentRole; isMainTeacher: boolean } | undefined {
  const { role, isMainTeacher, current } = input;
  if (role !== undefined) {
    return role === 'principal'
      ? { role: 'principal', isMainTeacher: true }
      : { role, isMainTeacher: false };
  }
  if (isMainTeacher !== undefined) {
    if (isMainTeacher) return { role: 'principal', isMainTeacher: true };
    // On retire le rôle principal : retombe sur subject_teacher (rôle neutre).
    return {
      role: current.role === 'principal' ? 'subject_teacher' : current.role,
      isMainTeacher: false,
    };
  }
  return undefined;
}
