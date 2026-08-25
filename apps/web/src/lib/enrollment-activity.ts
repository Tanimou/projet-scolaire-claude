import type { EnrollmentActivityProjection } from '@pilotage/contracts';
import {
  enrollmentAccentColor,
  enrollmentScopeLabel,
  type EnrollmentActivityState,
} from '@pilotage/ui';

/**
 * `enrollment-activity` — **l'UNIQUE adaptateur web de « cet enfant est-il
 * inscrit ? »** (S-E03-3, `PF-12`, `ADR-072`).
 *
 * ## Le défaut que ce module supprime
 *
 * Six surfaces parent re-dérivaient la même question, chacune à sa façon, à
 * partir de trois charges utiles filtrées différemment :
 *
 * | Site | Dérivation supprimée |
 * |---|---|
 * | `parent/dashboard/page.tsx:267` | `student.enrollments[0]?.classSection` |
 * | `parent/children/[id]/page.tsx:184` | `.find(e => e.status === 'active') ?? enrollments[0]` |
 * | `parent/children/page.tsx:186` | `.find(e => e.academicYear.status === 'active')` |
 * | `parent/settings/page.tsx:377` | idem `children/page.tsx` |
 * | `parent/children/[id]/report/page.tsx:166` | idem `children/[id]/page.tsx` |
 * | `parent/messages/new/page.tsx:37` | idem `children/page.tsx` |
 *
 * Trois d'entre elles étaient **factuellement fausses en permanence**, pas
 * seulement selon les données : `children/page.tsx`, `settings/page.tsx` et
 * `messages/new/page.tsx` déclaraient `academicYear: { status: string }` alors
 * que la projection serveur qui les alimente (`GET /students`) ne sélectionnait
 * que `{ id, name }`. `e.academicYear.status === 'active'` comparait donc
 * `undefined === 'active'` — **toujours faux, pour tout enfant** : les KPI
 * « CLASSES ACTIVES » et « CYCLES SUIVIS » étaient structurellement à `0`, le
 * sélecteur du compose n'a jamais affiché la moindre classe, et chaque carte
 * portait le libellé binaire stigmatisant que cette tranche supprime. C'est
 * `DNC-06` à l'état pur (l'interface promet ce que le runtime ne livre pas)
 * doublé de `DNC-01` (un KPI en désaccord avec les badges de sa propre page).
 *
 * Une quatrième — `children/[id]/page.tsx` — retombait sur `?? enrollments[0]`
 * au-dessus d'une charge utile **sans filtre de statut**, ce qui affichait une
 * inscription `graduated` derrière un badge vert « Inscription active ».
 *
 * ## Ce que ce module fait — et surtout ce qu'il ne fait PAS
 *
 * Il ne décide **rien**. Le verdict est pris **côté serveur**, une seule fois,
 * par `selectActiveEnrollment` (`packages/contracts/src/enrollment/`,
 * `ADR-072`), qui résout l'année canonique **à travers**
 * `resolveActiveAcademicYear` (`ADR-070`) et jamais autour. Le serveur pose ce
 * verdict dans un champ explicite, `enrollmentActivity`, présent sur `B1`
 * (`parent-dashboard`), `B3` (`GET /students`) et `B4` (`GET /students/:id`).
 * Ce module se contente de le **traduire en props**.
 *
 * C'est délibéré, et c'est une contrainte d'architecture :
 *
 * 1. `packages/contracts` se construit en **CJS** (`main → dist/index.js`,
 *    GUARDRAILS §2) : le typecheck lit la source, le runtime lit `dist/`.
 *    Exécuter `selectActiveEnrollment()` depuis `apps/web` échouerait en
 *    `undefined is not a function` tant que `dist/enrollment/` n'existe pas,
 *    avec un typecheck et un cliquet verts. Le seul import de ce module vers
 *    `@pilotage/contracts` est donc **`import type`**, effacé à la compilation.
 *    Le portail consomme des **données**, jamais du code du paquet.
 * 2. Un composant qui recevrait le **tableau** des inscriptions devrait à
 *    nouveau choisir une ligne : ce serait une septième dérivation, simplement
 *    déplacée. `EnrollmentStatusBadge` (`@pilotage/ui`) rend cette forme de
 *    props inexprimable ; ce module reste du même côté de la règle.
 *
 * ## Le seul tableau que ce module accepte, et pourquoi il ne décide rien
 *
 * `EnrollmentActivityProjection` ne porte **pas** les attributs décoratifs dont
 * la liste d'enfants a besoin (identifiant de classe, nom et couleur du cycle),
 * parce qu'`ADR-062 §D3` interdit d'exporter une forme de `select`/`include`
 * partagée entre modules (→ `PF-276`) : chaque projection reste locale.
 * `enrollmentDecor()` récupère ces attributs sur la ligne **que le serveur a
 * déjà choisie**, en la retrouvant par la clé que la projection publie
 * (`academicYearId` + `classSectionName`). Le verdict est une **entrée** de
 * cette fonction : il lui est structurellement impossible de le modifier, et
 * elle ne teste aucun statut. C'est une jointure d'affichage, pas une décision.
 *
 * ## Vocabulaire canonique
 *
 * Les quatre états, leur ton, leur icône et la phrase de portée
 * (`ADR-041 §D3`) sont définis **une seule fois**, dans
 * `packages/ui/src/components/EnrollmentStatusBadge.tsx`. Ce module ne
 * re-formule aucun libellé français : il appelle `enrollmentScopeLabel()` et
 * `enrollmentAccentColor()` du design-system. `defaultToneForStatus()` mappe
 * `graduated → success` et n'est donc sur aucun chemin d'activité — l'utiliser
 * reproduirait `PF-12` à l'intérieur de son propre correctif.
 *
 * ## Résiduels hérités, nommés ici pour qu'ils ne soient pas oubliés
 *
 * - `PF-328` (via `ADR-070`) : aucune contrainte de base n'impose « au plus une
 *   année active » ; l'année canonique est choisie **déterministiquement**,
 *   pas **correctement**.
 * - `PF-364` (`ADR-072 §R-7`) : `Enrollment.endedAt` en désaccord avec
 *   `status === 'active'` est *rapporté* (`endedAtDisagreement`), jamais
 *   *sélectionné* dessus — l'effective-dating d'`ADR-041 §D2` n'est acquitté
 *   qu'en intention.
 * - `PF-363` (axe 7, volet web) : les six pages serveur parent restent sur leur
 *   `safe()` local et ne passent pas par `read-result.ts`. Une lecture ratée de
 *   `GET /students` rend donc encore « Aucun enfant rattaché ». Décision
 *   explicite d'`AC-7` : ne pas migrer à moitié dans cette tranche.
 *   Fichiers concernés : `children/page.tsx`, `dashboard/page.tsx`,
 *   `children/[id]/page.tsx`, `children/[id]/report/page.tsx`,
 *   `settings/page.tsx`, `messages/new/page.tsx`.
 * - `PF-357` : le bandeau de revendication (`ChildClaimsStatusStrip.tsx`)
 *   répond depuis `GuardianshipClaim` et peut contredire, sur la même page,
 *   le badge corrigé ici.
 */

export type { EnrollmentActivityState };

/** Toute charge utile serveur portant le verdict canonique (`B1`, `B3`, `B4`). */
export interface CarriesEnrollmentActivity {
  enrollmentActivity?: EnrollmentActivityProjection | null;
}

/**
 * Une ligne d'inscription telle que `B3`/`B4` la renvoient encore, pour ses
 * attributs **décoratifs** uniquement. Ni statut, ni ordre : rien qui puisse
 * servir à re-décider quoi que ce soit.
 */
export interface EnrollmentDecorRow {
  academicYearId: string;
  classSection: {
    id: string;
    name: string;
    gradeLevel?: {
      name?: string;
      cycle?: { name: string; color: string | null } | null;
    } | null;
  };
}

export interface EnrollmentDisplay {
  /** Le verdict, augmenté de `unavailable` quand la charge utile ne le portait pas. */
  state: EnrollmentActivityState;
  /** Nom de classe — non-`null` **uniquement** sur `active`. */
  classLabel: string | null;
  /** Nom de l'année : l'année canonique sur `active`, la dernière connue sinon. */
  academicYearLabel: string | null;
  /** Statut BRUT de la dernière inscription connue (`graduated`, …), hors `active`. */
  lastStatus: string | null;
  /** Phrase de portée `ADR-041 §D3`, toujours non vide, toujours rendue dans le DOM. */
  scopeLabel: string;
  gradeLevelName: string | null;
}

/** Attributs d'affichage absents de la projection (`ADR-062 §D3`). */
export interface EnrollmentDecor {
  classSectionId: string | null;
  cycleName: string | null;
  /** Jamais `#3B82F6` : le bleu de marque se lit « normal, l'enfant est en classe ». */
  accentColor: string;
}

const UNAVAILABLE: EnrollmentDisplay = {
  state: 'unavailable',
  classLabel: null,
  academicYearLabel: null,
  lastStatus: null,
  scopeLabel: enrollmentScopeLabel('unavailable') ?? '',
  gradeLevelName: null,
};

/**
 * Traduit le champ canonique en props d'affichage. **C'est la seule fonction du
 * portail parent autorisée à produire un état d'inscription**, et elle ne
 * regarde jamais un tableau de lignes : elle lit le verdict déjà posé.
 *
 * Un champ absent (`undefined`) n'est **pas** « aucune inscription » : c'est
 * `unavailable`. Confondre les deux, ce serait `PF-05` transposé à ce champ —
 * affirmer un fait scolaire à partir d'une donnée qu'on n'a pas reçue.
 */
export function resolveEnrollmentActivity(
  carrier: CarriesEnrollmentActivity | null | undefined,
): EnrollmentDisplay {
  const projection = carrier?.enrollmentActivity;
  if (!projection) return UNAVAILABLE;

  if (projection.state === 'active') {
    const classLabel = projection.classSectionName;
    const academicYearLabel = projection.academicYearName;
    return {
      state: 'active',
      classLabel,
      academicYearLabel,
      lastStatus: null,
      // La phrase riche du design-system (« 2nde A · 2025-2026 ») ; le
      // `scopeLabel` grossier du serveur (« Année 2025-2026 ») sert de repli
      // quand la projection n'a ni classe ni année à nommer. Aucune des deux
      // n'est ré-écrite ici.
      scopeLabel:
        enrollmentScopeLabel('active', { classLabel, academicYearLabel }) ??
        projection.scopeLabel,
      gradeLevelName: projection.gradeLevelName,
    };
  }

  if (projection.state === 'out_of_scope') {
    const last = projection.lastKnown;
    return {
      state: 'out_of_scope',
      // `null` volontaire : « Classe de 3ème B » sur un enfant sorti de l'année
      // en cours est précisément le mensonge que la tranche supprime.
      classLabel: null,
      academicYearLabel: last?.academicYearName ?? null,
      lastStatus: last?.status ?? null,
      scopeLabel:
        enrollmentScopeLabel('out_of_scope', {
          classLabel: last?.classSectionName ?? null,
          academicYearLabel: last?.academicYearName ?? null,
          lastStatus: last?.status ?? null,
        }) ?? projection.scopeLabel,
      gradeLevelName: null,
    };
  }

  return {
    state: 'none',
    classLabel: null,
    academicYearLabel: null,
    lastStatus: null,
    scopeLabel: enrollmentScopeLabel('none') ?? projection.scopeLabel,
    gradeLevelName: null,
  };
}

/**
 * Attributs décoratifs de la ligne **que le serveur a retenue**.
 *
 * `rows` est le jeu candidat que `B3`/`B4` renvoient déjà ; la ligne est
 * retrouvée par la clé publiée par la projection, **jamais** par un test de
 * statut ni par un index `[0]`. Si rien ne correspond — cas normal quand la
 * dernière inscription connue est `graduated` et sort donc du jeu candidat —
 * on rend l'accent neutre plutôt que d'inventer une couleur.
 */
export function enrollmentDecor(
  carrier: CarriesEnrollmentActivity | null | undefined,
  rows: readonly EnrollmentDecorRow[] | undefined,
): EnrollmentDecor {
  const projection = carrier?.enrollmentActivity;
  const neutral: EnrollmentDecor = {
    classSectionId: null,
    cycleName: null,
    accentColor: enrollmentAccentColor(projection?.state ?? 'unavailable', null),
  };
  if (!projection || !rows) return neutral;

  const key =
    projection.state === 'active'
      ? { yearId: projection.academicYearId, className: projection.classSectionName }
      : projection.state === 'out_of_scope'
        ? {
            yearId: projection.lastKnown?.academicYearId ?? null,
            className: projection.lastKnown?.classSectionName ?? null,
          }
        : { yearId: null, className: null };

  if (!key.yearId || !key.className) return neutral;

  const row = rows.find(
    (r) => r.academicYearId === key.yearId && r.classSection.name === key.className,
  );
  if (!row) return neutral;

  const cycle = row.classSection.gradeLevel?.cycle ?? null;
  return {
    classSectionId: row.classSection.id,
    cycleName: cycle?.name ?? null,
    accentColor: enrollmentAccentColor(projection.state, cycle?.color ?? null),
  };
}

/**
 * Le prédicat des compteurs. Énoncé **une fois** pour que le KPI
 * « CLASSES ACTIVES » et le badge de la carte juste en dessous ne puissent pas
 * être en désaccord (`DNC-01` — c'est exactement le désaccord que `PF-12`
 * décrit, et le reproduire à l'intérieur du correctif serait la faute).
 */
export function isActivelyEnrolled(display: EnrollmentDisplay): boolean {
  return display.state === 'active';
}
