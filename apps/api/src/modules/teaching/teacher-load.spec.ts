/**
 * Tests unitaires du calcul de charge enseignant.
 *
 * La logique métier testée ici est celle de `GET /teachers/:id/load` :
 *   - uniqueStudents  = nb d'élèves distincts (dédoublonnés) dans les classes
 *                       de l'enseignant (Enrollment actifs, année active)
 *   - loadPct         = uniqueStudents / totalStudents × 100 (1 décimale)
 *
 * On isole le calcul via des fonctions pures extraites de la logique métier
 * du contrôleur pour ne pas dépendre du contexte NestJS/Prisma.
 */

// ---------------------------------------------------------------------------
// Fonctions pures mimant la logique du contrôleur
// (dupliquées ici pour isolation totale du test, sans import du module NestJS)
// ---------------------------------------------------------------------------

/**
 * Dédoublonne les studentIds d'une liste d'inscriptions et retourne le compte.
 *
 * Remarque : un élève peut être inscrit dans plusieurs classes (e.g. sport + classe
 * ordinaire). Le dédoublonnage est indispensable pour ne pas le compter deux fois.
 */
function countUniqueStudents(enrollments: Array<{ studentId: string }>): number {
  return new Set(enrollments.map((e) => e.studentId)).size;
}

/**
 * Calcule le pourcentage de charge de l'enseignant.
 * Retourne 0 si totalStudents vaut 0 (évite la division par zéro).
 * Arrondi à 1 décimale.
 */
function computeLoadPct(uniqueStudents: number, totalStudents: number): number {
  if (totalStudents === 0) return 0;
  return Math.round((uniqueStudents / totalStudents) * 1000) / 10;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('countUniqueStudents — dédoublonnage des élèves', () => {
  it('retourne 0 quand la liste est vide', () => {
    expect(countUniqueStudents([])).toBe(0);
  });

  it('compte correctement des élèves tous distincts', () => {
    const enrollments = [
      { studentId: 's1' },
      { studentId: 's2' },
      { studentId: 's3' },
    ];
    expect(countUniqueStudents(enrollments)).toBe(3);
  });

  it('dédoublonne un élève inscrit dans plusieurs classes', () => {
    // s1 est dans deux classes (math + physique), ne doit être compté qu'une fois
    const enrollments = [
      { studentId: 's1' },
      { studentId: 's1' }, // doublon volontaire
      { studentId: 's2' },
    ];
    expect(countUniqueStudents(enrollments)).toBe(2);
  });

  it('retourne 1 quand tous les élèves sont identiques', () => {
    const enrollments = [
      { studentId: 's1' },
      { studentId: 's1' },
      { studentId: 's1' },
    ];
    expect(countUniqueStudents(enrollments)).toBe(1);
  });
});

describe('computeLoadPct — calcul du pourcentage de charge', () => {
  it('retourne 0 quand totalStudents vaut 0 (pas de division par zéro)', () => {
    expect(computeLoadPct(0, 0)).toBe(0);
    expect(computeLoadPct(5, 0)).toBe(0);
  });

  it('retourne 0 quand l'enseignant ne suit aucun élève', () => {
    expect(computeLoadPct(0, 100)).toBe(0);
  });

  it('retourne 100 quand l'enseignant suit tous les élèves', () => {
    expect(computeLoadPct(200, 200)).toBe(100);
  });

  it('calcule correctement un pourcentage courant (10/200 = 5 %)', () => {
    expect(computeLoadPct(10, 200)).toBe(5);
  });

  it('arrondit à 1 décimale (1/3 ≈ 33,3 %)', () => {
    // 1/3 = 0,3333... → 33,3 %
    const result = computeLoadPct(1, 3);
    expect(result).toBe(33.3);
  });

  it('calcule correctement un pourcentage < 5 % (seuil « faible »)', () => {
    // 4/200 = 2 % → faible
    expect(computeLoadPct(4, 200)).toBe(2);
  });

  it('calcule correctement un pourcentage entre 5 % et 15 % (seuil « normale »)', () => {
    // 20/200 = 10 % → normale
    expect(computeLoadPct(20, 200)).toBe(10);
  });

  it('calcule correctement un pourcentage > 15 % (seuil « surcharge »)', () => {
    // 40/200 = 20 % → surcharge
    expect(computeLoadPct(40, 200)).toBe(20);
  });

  it('produit une valeur à 1 décimale même sur un ratio non entier', () => {
    // 7/300 = 0,02333... → 2,3 %
    const result = computeLoadPct(7, 300);
    expect(result).toBe(2.3);
  });
});
