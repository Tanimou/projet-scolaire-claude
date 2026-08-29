import { existsSync, readdirSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

/**
 * S-E03-14 / `PF-36` / `ADR-088` — LE CLIQUET : l'année d'une affectation se lit
 * sur sa SECTION, et cette affirmation devient DÉRIVÉE au lieu d'être une liste
 * tenue à la main.
 *
 * POURQUOI CE FICHIER EXISTE, ET CE QU'IL CORRIGE DANS LA TRANCHE PRÉCÉDENTE
 * --------------------------------------------------------------------------
 * `S-E03-13` (run 103, `ADR-087`) a converti HUIT lectures d'affectations de
 * l'axe COLONNE (`teaching_assignment.academic_year_id`) vers l'axe SECTION
 * (`class_section.academic_year_id`), et a prouvé chacune par un test
 * BEHAVIOURAL nommant son endpoint — `assignment-year-axis.spec.ts`. Huit tests,
 * huit sites, énumérés à la main.
 *
 * Une NEUVIÈME lecture existait et n'a pas été vue : `analytics.service.ts`,
 * `teacherReports`, `GET /analytics/teacher-reports`. Ce n'est pas une
 * étourderie, c'est le mode de défaillance connu de la maison — « deux listes à
 * la main = dérive silencieuse » (run 59) : une suite qui énumère des sites ne
 * peut pas, par construction, échouer sur le site qu'elle a omis. Le remède est
 * de DÉRIVER l'ensemble des sites depuis les sources plutôt que de le recopier.
 *
 * LA CONSÉQUENCE ÉTAIT VISIBLE PAR HTTP, pas seulement en théorie : mesurée
 * contre la pile locale par `scripts/teacher-year-axis-agreement-probe.js`,
 * avec une ligne d'affectation dont la colonne contredit sa propre section (que
 * la base ACCEPTE, faute de clé étrangère composite — `PF-473`),
 * `/teacher/reports` et `/teacher/dashboard` renvoyaient des ENSEMBLES DE
 * CLASSES DIFFÉRENTS au même enseignant. Deux surfaces d'un portail en
 * désaccord sur « quelles classes j'enseigne cette année » : c'est la forme
 * exacte de `PF-36`.
 *
 * LES DEUX RÈGLES
 * ---------------
 *   R1 — TOLÉRANCE ZÉRO. Une lecture d'affectations PORTÉE PAR UN ENSEIGNANT
 *        (son `where` nomme `teacherProfileId`) ne peut pas filtrer l'année sur
 *        la COLONNE. Elle passe par `assignmentYearScopeWhere()`. C'est la
 *        famille que `PF-36` gouverne : « les classes de CET enseignant cette
 *        année », la question dont deux portails donnaient deux réponses.
 *
 *   R2 — PLAFOND DÉCROISSANT sur le RESTE de la classe : les lectures
 *        d'affectations appariées à une INSCRIPTION
 *        (`academicYearId: enrollment.academicYearId`), dans la messagerie, la
 *        remédiation, les leçons, les annonces et l'assiduité. Elles sont
 *        `PF-474`, elles sont COMPTÉES, elles ne sont pas exemptées.
 *
 * POURQUOI R2 EST UN PLAFOND ET NON UNE TOLÉRANCE ZÉRO — ET POURQUOI CE N'EST
 * PAS UN CONFORT
 * ---------------------------------------------------------------------------
 * Ces sites ne sont pas des affichages : ce sont des GARDES D'APPARTENANCE. Ils
 * décident si un enseignant peut écrire à un parent, proposer une remédiation,
 * publier un devoir. Les convertir change la population d'un mur d'autorisation
 * — une modification d'AUTHZ déguisée en correction de comptage, exactement ce
 * que `class-roster-size-derivation-gate.spec.ts` refuse de faire pour
 * `student-access.service.ts` et pour la même raison. Cette tranche est une
 * tranche de VÉRITÉ (Tier B) ; élargir son rayon d'explosion à l'autorisation
 * la rendrait Tier A et non prouvable dans un run. Les sites restent donc
 * VISIBLES dans un plafond, pour que personne ne puisse lire la classe comme
 * fermée.
 *
 * ⚠ LE PLAFOND EST UN PLAFOND, JAMAIS UN PLANCHER
 * ------------------------------------------------
 * Leçon du run 95, et elle est structurelle : un cliquet ne doit JAMAIS épingler
 * un plancher sur une classe que la feuille de route fait RÉTRÉCIR. Le nombre de
 * sites R2 est destiné à tomber à zéro quand `PF-474` sera traitée ; un plancher
 * l'empêcherait, et la tranche qui le ferait tomber serait punie pour avoir fait
 * ce qu'il fallait. L'ANTI-VACUITÉ est donc portée par des FIXTURES — des
 * sources synthétiques que le classifieur doit reconnaître — et jamais par un
 * comptage de sites de production.
 *
 * CE QUE CE CLIQUET NE PROUVE PAS
 * -------------------------------
 * Il prouve une FORME dans les sources. Que les deux surfaces s'ACCORDENT sur la
 * pile qui tourne est porté, et de façon EXÉCUTÉE, par
 * `scripts/teacher-year-axis-agreement-probe.js`. Que la dérive soit
 * INEXPRIMABLE en base demande la clé étrangère composite, qui est `PF-473` et
 * n'est pas posée. Trois affirmations, trois mécanismes ; les confondre serait
 * `DNC-06`.
 */

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..', '..');
const API_SRC = join(REPO_ROOT, 'apps', 'api', 'src');
const WORKER_SRC = join(REPO_ROOT, 'apps', 'worker', 'src');
const PACKAGES_DIR = join(REPO_ROOT, 'packages');
const WALK_READ_PATH = join(REPO_ROOT, 'scripts', 'lib', 'walk-read.js');

/** Les noms jugés — INJECTÉS, jamais écrits en dur dans le classifieur (`PF-295`). */
const NAMES = {
  model: 'teachingAssignment',
  columnAxis: 'academicYearId',
  teacherOwner: 'teacherProfileId',
  sectionOwner: 'classSection',
} as const;

/** La fonction qui DÉFINIT l'axe légitime, et son foyer attendu. */
const HOME_FUNCTION = 'assignmentYearScopeWhere';
const EXPECTED_HOME = 'apps/api/src/modules/teaching/assignment-year-scope.ts';

const READ_OPERATIONS: ReadonlySet<string> = new Set([
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'findUnique',
  'findUniqueOrThrow',
  'count',
  'aggregate',
  'groupBy',
]);

/* eslint-disable @typescript-eslint/no-require-imports */
// Non gardés, exprès (`DNC-08`) : si ces helpers s'évaporent, cette suite doit
// mourir au CHARGEMENT plutôt que dégénérer en « rien à vérifier ».
const walkRead = require(WALK_READ_PATH) as {
  mapWalkedFiles: <V>(
    paths: string[],
    build: (path: string, source: string) => [string, V],
  ) => { entries: [string, V][]; skipped: string[] };
  warnSkipped: (label: string, skipped: string[]) => boolean;
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ts = require('typescript') as any;
/* eslint-enable @typescript-eslint/no-require-imports */

/* ================================================================== *
 * LA MARCHE
 * ================================================================== */

/**
 * Les specs sont HORS corpus : elles portent des fixtures délibérément
 * contrevenantes — dont celles de ce fichier. Les juger produirait un auto-rouge
 * qu'on « corrigerait » par une exclusion, donc une allowlist déguisée.
 */
function walkSources(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (
        entry.name !== 'node_modules' &&
        entry.name !== 'dist' &&
        entry.name !== '.next' &&
        entry.name !== '__fixtures__'
      ) {
        walkSources(path, out);
      }
      continue;
    }
    const name = entry.name;
    const isSource = name.endsWith('.ts') || name.endsWith('.tsx');
    const isExcluded =
      name.endsWith('.d.ts') ||
      name.endsWith('.spec.ts') ||
      name.endsWith('.spec.tsx') ||
      name.endsWith('.test.ts') ||
      name.endsWith('.test.tsx');
    if (isSource && !isExcluded) out.push(path);
  }
  return out;
}

function walkPackages(): string[] {
  const out: string[] = [];
  if (!existsSync(PACKAGES_DIR)) return out;
  for (const entry of readdirSync(PACKAGES_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    walkSources(join(PACKAGES_DIR, entry.name, 'src'), out);
  }
  return out;
}

const API_FILES = walkSources(API_SRC).sort();
const WORKER_FILES = walkSources(WORKER_SRC).sort();
const PACKAGE_FILES = walkPackages().sort();
const ALL_FILES = [...API_FILES, ...WORKER_FILES, ...PACKAGE_FILES];

const rel = (absolute: string) => relative(REPO_ROOT, absolute).split(sep).join('/');

/**
 * Planchers PAR RACINE. Ce sont des planchers de MARCHE — « la marche a bien
 * regardé l'arbre » — et non des planchers de CONTRAVENTION : ils ne suivent
 * aucune classe que la feuille de route fait rétrécir. Mesurés sur cet arbre.
 */
const MIN_API_FILES = 150;
const MIN_WORKER_FILES = 50;
const MIN_PACKAGE_FILES = 100;

/* ================================================================== *
 * LE CLASSIFIEUR — tous les noms sont INJECTÉS
 * ================================================================== */

type Site = {
  readonly file: string;
  readonly line: number;
  readonly operation: string;
  /** le `where` nomme-t-il un enseignant ? (famille R1) */
  readonly teacherScoped: boolean;
  /** le `where` pose-t-il l'année sur la COLONNE de l'affectation ? */
  readonly columnAxis: boolean;
  /** le `where` délègue-t-il au foyer canonique ? */
  readonly delegates: boolean;
};

/** Le nom de modèle atteint par `prisma.X.` / `tx.X.` — quelle que soit la racine. */
function readModelName(expression: unknown, names: typeof NAMES): string | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const node = expression as any;
  if (!node || !ts.isPropertyAccessExpression(node)) return null;
  const object = node.expression;
  if (!object || !ts.isPropertyAccessExpression(object)) return null;
  return object.name?.escapedText === names.model ? names.model : null;
}

/**
 * Les propriétés de premier niveau d'un `where`, EN SUIVANT les spreads.
 *
 * Le suivi des spreads n'est pas cosmétique : la forme précise qui a survécu à
 * `S-E03-13` est un spread conditionnel,
 * `...(academicYearId ? { academicYearId } : {})`. Un classifieur qui ne
 * regarderait que les propriétés écrites en clair passerait exactement à côté du
 * site que ce cliquet existe pour attraper — et sortirait vert.
 *
 * Renvoie aussi les IDENTIFIANTS appelés en tête de spread, pour reconnaître la
 * DÉLÉGATION (`...assignmentYearScopeWhere(year)`).
 */
function whereShape(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  whereNode: any,
): { keys: Set<string>; calls: Set<string> } {
  const keys = new Set<string>();
  const calls = new Set<string>();
  const visit = (node: unknown, depth: number): void => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const n = node as any;
    if (!n || depth > 6) return;
    if (ts.isObjectLiteralExpression(n)) {
      for (const prop of n.properties) {
        if (ts.isSpreadAssignment(prop)) {
          visit(prop.expression, depth + 1);
          continue;
        }
        const name = prop.name;
        if (name && (ts.isIdentifier(name) || ts.isStringLiteral(name))) {
          keys.add(String(name.escapedText ?? name.text));
        }
      }
      return;
    }
    if (ts.isConditionalExpression(n)) {
      visit(n.whenTrue, depth + 1);
      visit(n.whenFalse, depth + 1);
      return;
    }
    if (ts.isParenthesizedExpression(n)) {
      visit(n.expression, depth + 1);
      return;
    }
    if (ts.isCallExpression(n)) {
      const callee = n.expression;
      if (callee && ts.isIdentifier(callee)) calls.add(String(callee.escapedText));
      return;
    }
    if (ts.isIdentifier(n)) {
      // `...spread` d'une variable : on ne peut pas la résoudre ici. Le site
      // est reconnu mais ni contrevenant ni délégant — et c'est déclaré comme
      // la limite du classifieur dans le docblock du test correspondant.
      calls.add(String(n.escapedText));
    }
  };
  visit(whereNode, 0);
  return { keys, calls };
}

/** Les sites de lecture d'affectations d'UNE source. Les noms sont injectés. */
export function classifyAssignmentReads(
  source: string,
  fileLabel: string,
  names: typeof NAMES,
  homeFunction: string,
): Site[] {
  const sourceFile = ts.createSourceFile(
    fileLabel,
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    fileLabel.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const sites: Site[] = [];

  const visit = (node: unknown): void => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const n = node as any;
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
      const operation = String(n.expression.name?.escapedText ?? '');
      if (READ_OPERATIONS.has(operation) && readModelName(n.expression, names) === names.model) {
        const arg = n.arguments?.[0];
        let teacherScoped = false;
        let columnAxis = false;
        let delegates = false;
        if (arg && ts.isObjectLiteralExpression(arg)) {
          for (const prop of arg.properties) {
            const name = prop.name;
            const key = name && ts.isIdentifier(name) ? String(name.escapedText) : null;
            if (key !== 'where') continue;
            const shape = whereShape(
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (prop as any).initializer,
            );
            teacherScoped = shape.keys.has(names.teacherOwner);
            columnAxis = shape.keys.has(names.columnAxis);
            delegates = shape.calls.has(homeFunction);
          }
        }
        const { line } = sourceFile.getLineAndCharacterOfPosition(n.getStart(sourceFile));
        sites.push({
          file: fileLabel,
          line: line + 1,
          operation,
          teacherScoped,
          columnAxis,
          delegates,
        });
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sourceFile);
  return sites;
}

const walked = walkRead.mapWalkedFiles<Site[]>(ALL_FILES, (path, source) => [
  rel(path),
  classifyAssignmentReads(source, rel(path), NAMES, HOME_FUNCTION),
]);
const SITES: Site[] = walked.entries.flatMap(([, sites]) => sites);

/**
 * `MANUAL_ALLOWLIST` existe, est NOMMÉE, et EXPÉDIE VIDE — une assertion le
 * vérifie. Aucune variable d'environnement, aucun `SKIP_*` / `ALLOW_*`
 * (`DNC-10`).
 */
const MANUAL_ALLOWLIST: readonly string[] = [];

/* ================================================================== *
 * LES FIXTURES D'ANTI-VACUITÉ — synthétiques, jamais des sites réels
 * ================================================================== */

const FIXTURE_VIOLATION = `
  const rows = await this.prisma.teachingAssignment.findMany({
    where: { tenantId, teacherProfileId, ...(academicYearId ? { academicYearId } : {}) },
  });
`;

const FIXTURE_DELEGATED = `
  const rows = await this.prisma.teachingAssignment.findMany({
    where: { tenantId, teacherProfileId, ...assignmentYearScopeWhere(academicYearId) },
  });
`;

const FIXTURE_PLAIN_VIOLATION = `
  const rows = await tx.teachingAssignment.findFirst({
    where: { tenantId, teacherProfileId, academicYearId },
  });
`;

const FIXTURE_ENROLMENT_PAIRED = `
  const a = await this.prisma.teachingAssignment.findFirst({
    where: { tenantId, classSectionId: e.classSectionId, academicYearId: e.academicYearId },
  });
`;

const classifyFixture = (src: string, label: string) =>
  classifyAssignmentReads(src, label, NAMES, HOME_FUNCTION);

/**
 * LA construction reconnue dans une fixture — et son absence est une PANNE, pas
 * un `undefined`.
 *
 * Écrit ainsi plutôt qu'avec `!` ou `?.` pour une raison de fond : si le
 * classifieur cessait un jour de reconnaître ces formes, `site?.columnAxis`
 * rendrait `undefined`, l'assertion lirait « faux » et le cliquet deviendrait
 * AVEUGLE en passant pour un simple test rouge. Ici il meurt en le disant.
 */
function onlySite(source: string, label: string): Site {
  const sites = classifyFixture(source, label);
  const site = sites[0];
  if (!site) {
    throw new Error(
      `le classifieur n'a RECONNU aucune lecture d'affectations dans la fixture « ${label} ». ` +
        `Ce n'est pas un test qui échoue : c'est le cliquet devenu aveugle.`,
    );
  }
  return site;
}

/* ================================================================== *
 * LES TESTS
 * ================================================================== */

describe('la marche a bien regardé l’arbre', () => {
  it('ne tait aucun fichier illisible', () => {
    expect(walkRead.warnSkipped('assignment-year-axis-derivation-gate', walked.skipped)).toBe(false);
  });

  it('atteint chaque racine (planchers de MARCHE, pas de contravention)', () => {
    expect(API_FILES.length).toBeGreaterThanOrEqual(MIN_API_FILES);
    expect(WORKER_FILES.length).toBeGreaterThanOrEqual(MIN_WORKER_FILES);
    expect(PACKAGE_FILES.length).toBeGreaterThanOrEqual(MIN_PACKAGE_FILES);
  });

  it('le foyer canonique existe, et il est UNIQUE', () => {
    const homes = walked.entries
      .map(([file]) => file)
      .filter((file) => file === EXPECTED_HOME);
    expect(homes).toEqual([EXPECTED_HOME]);
  });

  it('l’allowlist manuelle expédie VIDE', () => {
    expect(MANUAL_ALLOWLIST).toEqual([]);
  });
});

describe('ANTI-VACUITÉ — le classifieur reconnaît ce qu’il prétend juger', () => {
  it('attrape le spread CONDITIONNEL, la forme même qui a survécu à S-E03-13', () => {
    const site = onlySite(FIXTURE_VIOLATION, 'fixture-conditional.ts');
    expect(site.teacherScoped).toBe(true);
    expect(site.columnAxis).toBe(true);
    expect(site.delegates).toBe(false);
  });

  it('attrape aussi la forme NUE (`academicYearId` écrit en clair)', () => {
    const site = onlySite(FIXTURE_PLAIN_VIOLATION, 'fixture-plain.ts');
    expect(site.teacherScoped).toBe(true);
    expect(site.columnAxis).toBe(true);
  });

  it('n’accuse PAS une lecture qui délègue au foyer — le contrôle NÉGATIF', () => {
    const site = onlySite(FIXTURE_DELEGATED, 'fixture-delegated.ts');
    expect(site.teacherScoped).toBe(true);
    expect(site.columnAxis).toBe(false);
    expect(site.delegates).toBe(true);
  });

  it('distingue la famille APPARIÉE À UNE INSCRIPTION (R2) de la famille enseignant (R1)', () => {
    const site = onlySite(FIXTURE_ENROLMENT_PAIRED, 'fixture-paired.ts');
    expect(site.columnAxis).toBe(true);
    expect(site.teacherScoped).toBe(false);
  });

  it('voit encore de vraies lectures d’affectations dans les sources', () => {
    // Plancher de RECONNAISSANCE, pas de contravention : zéro contravention sur
    // zéro reconnaissance ne prouverait rien.
    expect(SITES.length).toBeGreaterThanOrEqual(20);
  });

  it('voit encore la famille ENSEIGNANT, celle que R1 gouverne', () => {
    expect(SITES.filter((s) => s.teacherScoped).length).toBeGreaterThanOrEqual(5);
  });
});

describe('R1 — une lecture d’affectations portée par un ENSEIGNANT ne filtre jamais sur la colonne', () => {
  it('TOLÉRANCE ZÉRO', () => {
    const offenders = SITES.filter((s) => s.teacherScoped && s.columnAxis).map(
      (s) => `${s.file}:${s.line} (${s.operation})`,
    );
    expect(offenders).toEqual([]);
  });
});

describe('R2 — le RESTE de la classe est compté, jamais exempté (PF-474)', () => {
  /**
   * PLAFOND, jamais plancher (run 95). Il doit BAISSER quand `PF-474` sera
   * traitée ; le faire baisser est un succès, et rien ici ne le punit.
   *
   * MESURÉ, pas estimé : la valeur a été obtenue en forçant le plafond à 0 et
   * en LISANT la liste que ce test imprime — six sites, nommés dans `ADR-088` :
   * `alerts.service.ts:771` et `:787`, `messaging.service.ts:108` et `:166`,
   * `remediation.service.ts:931`, `snapshot-drain-cron.service.ts:1011`.
   * Le premier jet portait `14`, un chiffre repris de la prose de `PF-474` et
   * jamais confronté à l'arbre. Un plafond au-dessus de la population réelle
   * est un cliquet DÉCORATIF : il aurait laissé passer huit récidives en
   * silence. Un plafond se mesure, il ne se devine pas.
   *
   * ⚠ LIMITE DÉCLARÉE, et c'est pourquoi ce nombre n'est pas celui de `PF-474`.
   * Ce classifieur ne lit que le `where` de PREMIER NIVEAU d'une lecture
   * d'affectations. Les filtres d'affectation NICHÉS dans une relation
   * (`classSection: { teachingAssignments: { some: { academicYearId } } }`)
   * lui échappent par construction. `PF-474` en dénombre ~15 au total ; ce
   * plafond en gouverne 6. La différence n'est pas une exemption, c'est une
   * portée — et elle est écrite ici pour que personne ne lise « 6 » comme
   * « il n'en reste que 6 ».
   */
  const R2_CEILING = 6;

  it('ne dépasse pas le plafond', () => {
    const paired = SITES.filter((s) => !s.teacherScoped && s.columnAxis).map(
      (s) => `${s.file}:${s.line}`,
    );
    if (paired.length > R2_CEILING) {
      throw new Error(
        `R2: ${paired.length} lectures d'affectations sur l'axe COLONNE (plafond ${R2_CEILING}).\n` +
          `Une NOUVELLE est apparue. Dériver l'année de la SECTION via ${HOME_FUNCTION}().\n` +
          paired.join('\n'),
      );
    }
    expect(paired.length).toBeLessThanOrEqual(R2_CEILING);
  });

  it('le plafond n’est pas devenu vide en silence — la famille reste VISIBLE', () => {
    // Anti-vacuité par FIXTURE plutôt que par plancher de production : si la
    // famille tombe à zéro c'est une VICTOIRE, et ce test doit alors être
    // supprimé avec `PF-474`, pas « réparé ».
    const paired = onlySite(FIXTURE_ENROLMENT_PAIRED, 'fixture-paired.ts');
    expect(paired.columnAxis).toBe(true);
    expect(paired.teacherScoped).toBe(false);
  });
});
