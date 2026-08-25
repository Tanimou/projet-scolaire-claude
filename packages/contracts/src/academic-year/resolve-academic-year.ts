/**
 * S-E03-4 / PF-15 / ADR-070 — LA résolution canonique de l'année scolaire active.
 *
 * CE QUE CE MODULE REMPLACE
 * -------------------------
 * Neuf résolutions écrites à la main, qui divergeaient sur QUATRE axes :
 *   (a) PORTÉE TENANT   — `school-context.service.ts:32` filtrait par `schoolId`
 *                         SEUL, sans `tenantId` ; les huit autres non.
 *   (b) DÉTERMINISME    — quatre sites appelaient `findFirst` SANS `orderBy` :
 *                         avec deux années actives, Postgres est libre de rendre
 *                         n'importe quelle ligne, et deux portails lisant le
 *                         MÊME tenant peuvent légitimement diverger (PF-04).
 *   (c) ABSENCE         — « année la plus récente quel que soit le statut » vs
 *                         « résultat vide » vs « null » : trois traitements du
 *                         même fait.
 *   (d) MULTIPLICITÉ    — un site suppose PLUSIEURS années actives, huit une
 *                         seule. Rien, ni au schéma ni au code, ne garantit
 *                         « au plus une année active par école » (PF-328).
 *
 * POURQUOI IL EST ICI, ET POURQUOI IL N'IMPORTE PAS PRISMA
 * -------------------------------------------------------
 * `apps/api` ET `apps/worker` portent chacun des sites à convertir, et
 * `apps/worker/tsconfig.json` fixe `rootDir: ./src` — rien sous `apps/api` n'est
 * importable depuis le worker. Le seul foyer commun déjà construit dans les deux
 * Dockerfiles et déjà mappé vers la SOURCE dans les deux configs jest est
 * `@pilotage/contracts`. Mais ce paquet est le contrat de types partagé, il est
 * aussi consommé par `apps/web`, et GUARDRAILS §2 interdit de le déstabiliser :
 * il n'aura donc JAMAIS `@prisma/client` en dépendance.
 *
 * D'où le PORT STRUCTUREL `AcademicYearReader` : ce module construit le `where`
 * et le `orderBy`, un adaptateur de trois lignes côté application les passe au
 * vrai `PrismaClient`. `packages/contracts/package.json` ne gagne aucune
 * dépendance. Les adaptateurs :
 *   • `apps/api/src/shared/academic-year/prisma-academic-year-reader.ts`
 *   • `apps/worker/src/shared/academic-year/prisma-academic-year-reader.ts`
 *
 * L'ORDRE TOTAL — ET POURQUOI `startDate desc` SEUL N'EN EST PAS UN
 * -----------------------------------------------------------------
 * `orderBy: { startDate: 'desc' }` N'EST PAS un ordre total : deux années
 * actives partageant la même `startDate` laissent Postgres libre de rendre l'une
 * OU l'autre, d'un appel à l'autre, sans que rien ne soit « cassé ». Le seul
 * garde-fou existant est `@@unique([schoolId, name])` — il ne dit RIEN sur
 * `startDate`. Le départage se fait donc sur `id`, qui est la clé primaire, donc
 * unique, donc l'ordre `[{ startDate: 'desc' }, { id: 'desc' }]` est TOTAL.
 * Cet ordre s'applique à TOUTES les requêtes que ce module émet, y compris celle
 * du repli — sinon le déterminisme n'est corrigé qu'à moitié.
 *
 * L'ABSENCE EST UNE DÉCISION DE L'APPELANT (ADR-070)
 * -------------------------------------------------
 * `onAbsent` est REQUIS et sans valeur par défaut. Réduction honnête : l'arbre
 * montre trois *significations* de l'absence, mais deux d'entre elles
 * (« résultat vide » et « null ») sont le MÊME comportement du résolveur —
 * rendre `null` — et ne diffèrent que par ce que l'appelant en fait ensuite.
 * Il y a donc DEUX politiques, pas trois.
 *
 * LA VÉTUSTÉ EST EXPOSÉE, JAMAIS CHOISIE (PF-15)
 * ----------------------------------------------
 * Mesuré le 2026-08-25 : l'année `active` des DEUX tenants est terminée (l'une
 * depuis sept semaines, l'autre depuis plus de deux ans). Un résolveur qui rend
 * silencieusement une année vieille de deux ans n'a pas fermé PF-15. Chaque
 * résolution porte donc `isStale`, `staleByDays`, `containsReferenceDate` et
 * `activeCount`.
 *
 * Mais RIEN ici ne SÉLECTIONNE sur `containsReferenceDate` : sur les données
 * mesurées, aucune année ne contient la date du jour pour aucun des deux
 * tenants ; préférer « l'année qui contient la date » viderait les quatre
 * portails. C'est rapporté, jamais choisi.
 *
 * `containsReferenceDate` est INCLUSIF AUX DEUX BORNES, exactement comme le
 * prédicat frère `apps/api/src/modules/calendar/calendar-seed.service.ts:86`
 * (`resolveAcademicYearId`), dont la spec assied `2026-07-05 → ay-a` et
 * `2026-07-06 → null`. Écrire des bornes exclusives ici livrerait une sémantique
 * de plus au lieu d'en retirer neuf. Leur convergence est enregistrée (PF-332).
 *
 * LA DATE DE RÉFÉRENCE EST INJECTÉE
 * ---------------------------------
 * Aucun `new Date(`, aucun `Date.now(` dans ce fichier. Une valeur par défaut
 * serait une horloge, la branche de vétusté deviendrait intestable, et
 * `hermetic-spec-writers-gate.spec.ts` existe.
 *
 * CE QUE CE MODULE NE FAIT PAS
 * ----------------------------
 * Il ne crée aucun invariant en base. « Au plus une année active par école » et
 * « l'année active contient aujourd'hui » ÉCHOUENT tous deux sur les données
 * existantes ; les poser exigerait un expand/contract et une décision de
 * données. Enregistré (PF-328), délibérément différé.
 */

/**
 * Ce qu'un appelant décide de faire quand AUCUNE année active n'existe.
 *
 * • `nullWhenNoActiveYear`   — rendre `null`. Ce que font huit des neuf sites,
 *                              qui le traduisent ensuite chacun à leur façon
 *                              (résultat vide, `null`, export à zéro ligne).
 * • `mostRecentOfAnyStatus`  — replier sur l'année la plus récente QUEL QUE SOIT
 *                              son statut, avec le MÊME ordre total. Un seul
 *                              appelant : `analytics.service.ts:2386`.
 */
export type AcademicYearAbsencePolicy = 'nullWhenNoActiveYear' | 'mostRecentOfAnyStatus';

/** La ligne `academic_year` telle que ce module a besoin de la lire. */
export interface AcademicYearRecord {
  id: string;
  schoolId: string;
  name: string;
  startDate: Date;
  endDate: Date;
  /** `string` et non un enum : ce paquet ne dépend pas de `@prisma/client`. */
  status: string;
}

/**
 * Le `where` que ce module construit. `tenantId` est REQUIS ici, pas seulement
 * dans les options publiques : c'est le type qui rend la fuite de
 * `school-context.service.ts:32` inexprimable.
 */
export interface AcademicYearWhere {
  tenantId: string;
  schoolId?: string;
  status?: 'active';
}

/** L'ordre total. Un tableau — deux objets séparés ne se départagent pas. */
export type AcademicYearOrderBy = Array<{ startDate: 'desc' } | { id: 'desc' }>;

export interface AcademicYearFindManyArgs {
  where: AcademicYearWhere;
  orderBy: AcademicYearOrderBy;
}

/**
 * Le PORT. Une seule méthode, structurellement satisfaite par le délégué
 * `prisma.academicYear` via un adaptateur d'application. Aucun import de
 * `@prisma/client` ici : `apps/web` consomme aussi ce paquet.
 */
export interface AcademicYearReader {
  findMany(args: AcademicYearFindManyArgs): Promise<AcademicYearRecord[]>;
}

export interface ResolveActiveAcademicYearOptions {
  /** REQUIS. Jamais optionnel, jamais déduit. */
  tenantId: string;
  schoolId?: string;
  /** REQUIS, injecté. Voir « la date de référence est injectée » plus haut. */
  referenceDate: Date;
  /** REQUIS, sans valeur par défaut. Voir ADR-070. */
  onAbsent: AcademicYearAbsencePolicy;
}

export interface ListActiveAcademicYearsOptions {
  tenantId: string;
  schoolId?: string;
  referenceDate: Date;
}

export interface ResolvedAcademicYear {
  id: string;
  schoolId: string;
  name: string;
  startDate: Date;
  endDate: Date;
  status: string;
  /** `true` ⇔ rendu par la politique `mostRecentOfAnyStatus`. */
  viaFallback: boolean;
  /** `startDate <= referenceDate <= endDate`, INCLUSIF aux deux bornes. */
  containsReferenceDate: boolean;
  /** `endDate < referenceDate`. `endDate === referenceDate` n'est PAS vétuste. */
  isStale: boolean;
  /** Jours pleins écoulés depuis `endDate`. `0` quand non vétuste. */
  staleByDays: number;
  /**
   * Nombre d'années ACTIVES vues par la requête primaire. `> 1` prouve que
   * l'invariant « au plus une année active » n'existe pas (PF-328) ; `0` sur une
   * résolution `viaFallback`.
   */
  activeCount: number;
}

const MS_PER_DAY = 86_400_000;

/**
 * L'ordre total, reconstruit à chaque requête plutôt que partagé — un tableau
 * de module serait mutable par n'importe quel appelant.
 */
function totalOrder(): AcademicYearOrderBy {
  return [{ startDate: 'desc' }, { id: 'desc' }];
}

/**
 * Le type suffit au compilateur ; ce garde-fou attrape le seul cas qu'il ne voit
 * pas — un `tenantId` vide arrivé d'un `as string` ou d'un JSON non validé. Sans
 * invariant en base disponible dans cette tranche (PF-328), c'est la dernière
 * barrière avant une lecture inter-tenant.
 */
function requireTenantId(tenantId: string): void {
  if (typeof tenantId !== 'string' || tenantId.length === 0) {
    throw new Error(
      'resolveActiveAcademicYear: `tenantId` est requis et non vide — ' +
        'une résolution non scopée au tenant est exactement le défaut que ce module ferme (PF-15).',
    );
  }
}

/** `tenantId` figure dans CHAQUE `where`, y compris celui du repli. */
function buildWhere(
  options: { tenantId: string; schoolId?: string },
  status?: 'active',
): AcademicYearWhere {
  const where: AcademicYearWhere = { tenantId: options.tenantId };
  if (options.schoolId !== undefined) where.schoolId = options.schoolId;
  if (status !== undefined) where.status = status;
  return where;
}

function decorate(
  row: AcademicYearRecord,
  referenceDate: Date,
  activeCount: number,
  viaFallback: boolean,
): ResolvedAcademicYear {
  const reference = referenceDate.getTime();
  const start = row.startDate.getTime();
  const end = row.endDate.getTime();
  const isStale = end < reference;

  return {
    id: row.id,
    schoolId: row.schoolId,
    name: row.name,
    startDate: row.startDate,
    endDate: row.endDate,
    status: row.status,
    viaFallback,
    containsReferenceDate: start <= reference && reference <= end,
    isStale,
    staleByDays: isStale ? Math.floor((reference - end) / MS_PER_DAY) : 0,
    activeCount,
  };
}

/**
 * Résout L'année scolaire active d'un (tenant, école).
 *
 * Nombre de requêtes — c'est une propriété, pas un détail : UNE requête sur le
 * chemin nominal, DEUX au maximum (et seulement sous `mostRecentOfAnyStatus`
 * quand aucune année active n'existe). Les appelants qui hissent la résolution
 * hors d'une boucle (`alerts.service.ts`, `alerts-evaluator.service.ts`) gardent
 * donc exactement leur coût actuel : jamais de N+1.
 */
export async function resolveActiveAcademicYear(
  reader: AcademicYearReader,
  options: ResolveActiveAcademicYearOptions,
): Promise<ResolvedAcademicYear | null> {
  requireTenantId(options.tenantId);

  const active = await reader.findMany({
    where: buildWhere(options, 'active'),
    orderBy: totalOrder(),
  });

  const chosen = active[0];
  if (chosen !== undefined) {
    return decorate(chosen, options.referenceDate, active.length, false);
  }

  if (options.onAbsent === 'nullWhenNoActiveYear') return null;

  // Repli : même ordre TOTAL, même `tenantId`. Un repli non ordonné laisserait
  // le déterminisme cassé sur la moitié du chemin. (La citation « PF-330 » qui
  // figurait ici renvoyait à une numérotation de PRÉ-MORTEM, pas au registre :
  // retirée au land du run 80 — `PF-330` y désigne le coût par requête de
  // `SchoolContextService`, et un id ne doit signifier qu'une chose.)
  const anyStatus = await reader.findMany({
    where: buildWhere(options),
    orderBy: totalOrder(),
  });

  const fallback = anyStatus[0];
  if (fallback === undefined) return null;

  return decorate(fallback, options.referenceDate, 0, true);
}

/**
 * Rend TOUTES les années actives du (tenant, école), dans l'ordre total.
 *
 * Existe pour le seul site qui suppose la multiplicité —
 * `subjects.controller.ts:381`, le fan-out de recompute d'un changement de
 * coefficient. L'écraser en une seule année arrêterait silencieusement les
 * recomputes des autres années actives. Ce site est donc CONVERTI, pas exempté :
 * le cliquet n'a besoin d'aucune allowlist.
 */
export async function listActiveAcademicYears(
  reader: AcademicYearReader,
  options: ListActiveAcademicYearsOptions,
): Promise<ResolvedAcademicYear[]> {
  requireTenantId(options.tenantId);

  const rows = await reader.findMany({
    where: buildWhere(options, 'active'),
    orderBy: totalOrder(),
  });

  return rows.map((row) => decorate(row, options.referenceDate, rows.length, false));
}
