import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

/**
 * S-E03-4 / PF-15 / ADR-070 — LE CLIQUET : aucune LECTURE Prisma du modèle
 * `academicYear` ne filtre sur `status: 'active'` hors du résolveur canonique.
 *
 * LA RÈGLE, EN UNE LIGNE
 * ----------------------
 * Un appel `<expr>.academicYear.<opération de LECTURE>({ where: … })` dont le
 * `where` contraint le statut à `active` est un contrevenant, sauf s'il est écrit
 * dans le module qui DÉCLARE `resolveActiveAcademicYear`.
 *
 * POURQUOI « LECTURE » ET PAS « REQUÊTE » — le premier jet tombait dans le piège
 * ------------------------------------------------------------------------------
 * `academic-years.controller.ts:133` et `:177` portent ceci :
 *
 *     where: { schoolId, status: AcademicYearStatus.active },
 *     data:  { status: AcademicYearStatus.closed },
 *
 * C'est la transition « clore l'année active précédente » — la SEULE application
 * de l'invariant « une seule année active » qui existe dans le produit. Une règle
 * énoncée sur « toute requête » l'attrape, et au moment du gate il ne resterait
 * que les trois sorties que la story interdit : une allowlist, une conversion
 * hors périmètre, ou relâcher la règle jusqu'à ce qu'elle passe (R-30).
 *
 * La règle est donc énoncée sur les opérations de LECTURE. Un site qui filtre
 * `status: 'active'` ET ÉCRIT `status` est une transition d'état, catégorie
 * différente, reconnue PAR CONSTRUCTION — les verbes d'écriture ne sont pas dans
 * `READ_OPERATIONS`, il n'y a aucun nom en exception. Écrit ici noir sur blanc
 * pour que le prochain auteur ne « simplifie » pas la règle en la remettant dans
 * le piège.
 *
 * L'INVENTAIRE EST DÉRIVÉ PAR MARCHE, JAMAIS ÉNUMÉRÉ (ADR-064 §D1a)
 * -----------------------------------------------------------------
 * Aucune liste jumelle de chemins écrite à la main : ce dépôt a déjà payé cette
 * facture (deux listes tenues à la main ⇒ dérive silencieuse ⇒ 503 sur quatre
 * portails). Les fichiers viennent d'une marche de TROIS racines.
 *
 * LES TROIS RACINES, ET POURQUOI `packages/` EN FAIT PARTIE
 * ---------------------------------------------------------
 * Le précédent maison (`enum-route-input-gate.spec.ts`) code en dur
 * `API_SRC = apps/api/src`. Copier cette racine-là ici livrerait un cliquet VERT
 * au-dessus du pire site de la tranche : `packages/imports-core/src/caches.ts:53`
 * résolvait l'année active par `schoolId` SEUL — sans `tenantId`, sans `orderBy` —
 * et son résultat n'était pas seulement rapporté, il était ÉCRIT dans les lignes
 * `class_section` et `enrollment` créées par l'import. On marche donc
 * `apps/api/src`, `apps/worker/src` ET `packages/<paquet>/src`, avec un plancher de
 * vacuité PAR RACINE : un plancher global resterait satisfait par `apps/api`
 * seul pendant que `packages/` disparaîtrait de la marche en silence.
 *
 * LE FOYER DU RÉSOLVEUR EST RECONNU PAR CONSTRUCTION
 * --------------------------------------------------
 * Le seul site légitime n'est pas nommé dans une exception : c'est le fichier qui
 * DÉCLARE `resolveActiveAcademicYear`, trouvé par la même marche. Le cliquet
 * exige qu'il y en ait EXACTEMENT UN — zéro foyer signifierait que le résolveur
 * a disparu et que le cliquet est devenu décoratif ; deux signifieraient que la
 * canonicalisation a déjà re-divergé.
 *
 * `MANUAL_ALLOWLIST` existe, est nommée, et EXPÉDIE VIDE — et une assertion le
 * vérifie. Aucune variable d'environnement, aucun `NODE_ENV`, aucun `SKIP_*` /
 * `ALLOW_*` (DNC-10). Les deux helpers requis le sont sans garde : s'ils
 * s'évaporent, cette suite doit mourir au CHARGEMENT plutôt que dégénérer en
 * « rien à vérifier » (DNC-08).
 *
 * LES FIXTURES N'EMBARQUENT AUCUN NOM DE MODÈLE RÉEL (PF-295)
 * -----------------------------------------------------------
 * `body-metatype-gate.spec.ts:761,765` enregistre la collision : un motif écrit
 * en toutes lettres dans une fixture devient un faux positif pour le grep du
 * relecteur suivant, et la concaténation seule ne la ferme pas — la chaîne existe
 * toujours. Le classifieur reçoit donc le nom du modèle EN PARAMÈTRE, et les
 * fixtures emploient `fixtureYear`, qui n'existe nulle part dans le produit.
 *
 * LE CONTRÔLE NÉGATIF N'EST PAS DÉCORATIF
 * ---------------------------------------
 * Sans un cas qui doit PASSER, un comparateur toujours-rouge satisfait tous les
 * cas rouges et le cliquet ne prouve rien (run 45 / TOOL-13). Les deux contrôles
 * sont donc présents : des fixtures contrevenantes qui DOIVENT être signalées, et
 * des fixtures légitimes — dont la vraie transition d'état et les vrais
 * adaptateurs du produit — qui DOIVENT passer.
 *
 * CE QUE LE CLIQUET NE PROUVE PAS
 * -------------------------------
 * 1. Il prouve une FORME : plus aucune lecture ne filtre `status: 'active'` hors
 *    du résolveur. Il ne prouve pas que l'ordre du résolveur est le BON ordre, ni
 *    que Postgres l'honore. Cela est porté ailleurs, et de façon exécutée : les
 *    tests unitaires de
 *    `apps/api/src/shared/academic-year/resolve-academic-year.spec.ts` et la
 *    sonde SQL contre la pile vivante.
 *
 * 2. IL NE COUVRE PAS LA FAMILLE RELATIONNELLE, et c'est délibéré. Neuf sites de
 *    production contraignent l'année par une JOINTURE — `where: { …,
 *    academicYear: { status: 'active' } }` sur `enrollment` / `classSection` /
 *    `teachingAssignment` (`alerts.service.ts:753`, `messaging.service.ts:101`
 *    et `:157`, les trois services de remédiation, `attendance.controller.ts:239`,
 *    `meeting-requests.service.ts:38`, `report-card-pdf.generator.ts:44`). Ce
 *    n'est PAS la même question : ces sites ne RÉSOLVENT pas une année, ils
 *    filtrent des lignes « appartenant à une année active », et ils tolèrent la
 *    multiplicité — les rabattre sur un résolveur mono-année CHANGERAIT leur
 *    résultat dès qu'une école porte deux années actives. Les convertir est une
 *    tranche à part avec sa propre décision de sémantique ; les faire tomber sous
 *    CETTE règle n'offrirait que les trois sorties interdites. La famille est
 *    donc hors portée, ENREGISTRÉE comme finding, et un test plus bas assied
 *    qu'elle existe toujours — pour qu'on ne puisse pas la déclarer fermée par
 *    inadvertance.
 *
 * LIMITE CONNUE, R-1 : LE CHEMIN DE GATE
 * --------------------------------------
 * `scripts/ci-gate.sh:396` ne fait tourner la suite complète que quand le diff
 * touche `GATE_MACHINERY` (`^(scripts/|\.github/|infra/|apps/api/src/shared/quality/)`).
 * Ce fichier en fait partie, donc le cliquet tourne sur CETTE PR. Une PR future
 * qui ne toucherait QUE `packages/**` ou `apps/worker/**` prendrait la branche
 * `--skip src/shared/quality/` et ce cliquet ne s'exécuterait pas sur elle.
 * Résidu réel, enregistré (PF-333), pas un trou que ce fichier ferme seul.
 * NB — `PF-333` et NON `PF-330` : `PF-330` désigne le coût par requête de
 * `SchoolContextService`. Séparés PAR LE SENS au land du run 80 (`TOOL-30`).
 */

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..', '..');
const API_SRC = join(REPO_ROOT, 'apps', 'api', 'src');
const WORKER_SRC = join(REPO_ROOT, 'apps', 'worker', 'src');
const PACKAGES_DIR = join(REPO_ROOT, 'packages');
const WALK_READ_PATH = join(REPO_ROOT, 'scripts', 'lib', 'walk-read.js');

/** Le nom du modèle Prisma jugé. INJECTÉ dans le classifieur (PF-295). */
const MODEL_NAME = 'academicYear';

/** Le nom de la fonction qui DÉFINIT le foyer légitime. */
const RESOLVER_FUNCTION = 'resolveActiveAcademicYear';

/**
 * Les opérations de LECTURE. Tout ce qui n'est pas là — `update`, `updateMany`,
 * `upsert`, `create`, `delete`, `deleteMany` — est une écriture, donc une
 * transition d'état, donc hors de la règle PAR CONSTRUCTION.
 */
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

/** La valeur d'enum jugée. */
const ACTIVE = 'active';

/* eslint-disable @typescript-eslint/no-require-imports */
// Non gardés, exprès (DNC-08).
const walkRead = require(WALK_READ_PATH) as {
  maxVanishedFor: (n: number) => number;
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
 * LA MARCHE — trois racines, plancher PAR RACINE
 * ================================================================== */

/**
 * Les `*.spec.ts` sont HORS corpus, et pour une raison de fond : une spec n'émet
 * aucune requête de production. Elle porte des FAKES (`academicYear: { findMany:
 * jest.fn() }`) et des fixtures délibérément contrevenantes — dont celles de ce
 * fichier. Les juger produirait un auto-rouge que l'on « corrigerait » par une
 * exclusion, c'est-à-dire par une allowlist déguisée.
 */
function walkTs(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== 'dist' && entry.name !== '__fixtures__') {
        walkTs(path, out);
      }
    } else if (
      entry.name.endsWith('.ts') &&
      !entry.name.endsWith('.d.ts') &&
      !entry.name.endsWith('.spec.ts')
    ) {
      out.push(path);
    }
  }
  return out;
}

/** Les `src` de TOUS les paquets de l'espace de travail — découverts, pas listés. */
function walkPackages(): string[] {
  const out: string[] = [];
  if (!existsSync(PACKAGES_DIR)) return out;
  for (const entry of readdirSync(PACKAGES_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    walkTs(join(PACKAGES_DIR, entry.name, 'src'), out);
  }
  return out;
}

const API_FILES = walkTs(API_SRC).sort();
const WORKER_FILES = walkTs(WORKER_SRC).sort();
const PACKAGE_FILES = walkPackages().sort();
const ALL_FILES = [...API_FILES, ...WORKER_FILES, ...PACKAGE_FILES];

const rel = (absolute: string) => relative(REPO_ROOT, absolute).split(sep).join('/');

/**
 * Planchers PAR RACINE, jamais des égalités (convention maison : tout plancher
 * est `>=`). Mesurés sur cet arbre : 169 / 60 / 46 fichiers `.ts` hors specs.
 * Ils existent pour une seule raison — une marche devenue VACANTE est verte sans
 * rien prouver, et un plancher GLOBAL resterait satisfait par `apps/api` seul
 * pendant que `packages/` disparaîtrait.
 */
const MIN_API_FILES = 150;
const MIN_WORKER_FILES = 50;
const MIN_PACKAGE_FILES = 38;

/**
 * Plancher de RECONNAISSANCE : le nombre de sites `academicYear.*` que la marche
 * doit encore VOIR. Zéro contravention sur zéro reconnaissance ne prouve rien.
 * Mesuré après conversion : 22 sites subsistent (contrôleurs d'années scolaires,
 * lectures d'appartenance, `previousYear`, adaptateurs…).
 */
const MIN_MODEL_CALL_SITES = 15;

/* ================================================================== *
 * LE CLASSIFIEUR — le nom du modèle est INJECTÉ (PF-295)
 * ================================================================== */

type ModelCall = {
  /** L'opération appelée (`findFirst`, `updateMany`, …). */
  operation: string;
  line: number;
  /** `true` ⇔ opération de lecture. */
  isRead: boolean;
  /** `true` ⇔ le `where` contraint le statut à `active`. */
  filtersActive: boolean;
  /** `true` ⇔ le bloc `data` écrit `status` : c'est une TRANSITION. */
  writesStatus: boolean;
};

/** `status: 'active'` ou `status: <Quelquechose>.active`, à n'importe quelle profondeur. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function constrainsStatusToActive(node: any, active: string): boolean {
  let found = false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const visit = (n: any) => {
    if (found) return;
    if (ts.isPropertyAssignment(n)) {
      const key = ts.isIdentifier(n.name) || ts.isStringLiteral(n.name) ? n.name.text : undefined;
      if (key === 'status') {
        const value = n.initializer;
        if (ts.isStringLiteral(value) && value.text === active) {
          found = true;
          return;
        }
        if (ts.isPropertyAccessExpression(value) && value.name.text === active) {
          found = true;
          return;
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

/** Le membre `key` d'un littéral d'objet, s'il y en a un. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function memberOf(objectLiteral: any, key: string): any {
  if (!objectLiteral || !ts.isObjectLiteralExpression(objectLiteral)) return undefined;
  for (const prop of objectLiteral.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    const name =
      ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name) ? prop.name.text : undefined;
    if (name === key) return prop.initializer;
  }
  return undefined;
}

/**
 * Recense, pour UN fichier, chaque appel `<expr>.<modelName>.<op>(…)`.
 *
 * `modelName` et `active` sont des PARAMÈTRES : c'est ce qui permet aux fixtures
 * d'employer un modèle synthétique absent du produit (PF-295).
 */
function classify(path: string, source: string, modelName: string, active: string): ModelCall[] {
  const sf = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const out: ModelCall[] = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const visit = (node: any) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const operationAccess = node.expression;
      const receiver = operationAccess.expression;
      if (ts.isPropertyAccessExpression(receiver) && receiver.name.text === modelName) {
        const operation = operationAccess.name.text as string;
        const args = node.arguments[0];
        const where = memberOf(args, 'where');
        const data = memberOf(args, 'data');
        out.push({
          operation,
          line: (sf.getLineAndCharacterOfPosition(node.getStart(sf)).line as number) + 1,
          isRead: READ_OPERATIONS.has(operation),
          filtersActive: where !== undefined && constrainsStatusToActive(where, active),
          writesStatus: data !== undefined && memberOf(data, 'status') !== undefined,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** Le fichier DÉCLARE-t-il la fonction résolveur ? Reconnaissance par construction. */
function declaresResolver(path: string, source: string, functionName: string): boolean {
  const sf = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  let found = false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const visit = (n: any) => {
    if (found) return;
    if (ts.isFunctionDeclaration(n) && n.name && n.name.text === functionName) {
      found = true;
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return found;
}

/* ================================================================== *
 * L'EXÉCUTION SUR L'ARBRE RÉEL
 * ================================================================== */

type FileFacts = { source: string; calls: ModelCall[]; isResolverHome: boolean };

const { entries, skipped } = walkRead.mapWalkedFiles<FileFacts>(ALL_FILES, (path, source) => [
  rel(path),
  {
    source,
    calls: classify(path, source, MODEL_NAME, ACTIVE),
    isResolverHome: declaresResolver(path, source, RESOLVER_FUNCTION),
  },
]);
const CLASSIFIED = new Map(entries);
walkRead.warnSkipped('academic-year-resolution-gate', skipped);

const RESOLVER_HOMES = [...CLASSIFIED.entries()]
  .filter(([, facts]) => facts.isResolverHome)
  .map(([file]) => file);

type Site = ModelCall & { file: string };

const MODEL_CALL_SITES: Site[] = [...CLASSIFIED.entries()].flatMap(([file, facts]) =>
  facts.calls.map((call) => ({ ...call, file })),
);

/**
 * L'allowlist manuelle. Elle existe, elle est nommée, et elle EXPÉDIE VIDE — une
 * assertion le vérifie plus bas. Le foyer légitime est DÉRIVÉ (le fichier qui
 * déclare le résolveur), jamais énuméré.
 */
const MANUAL_ALLOWLIST: ReadonlyArray<{ file: string; line: number }> = [];

const OFFENDERS: Site[] = MODEL_CALL_SITES.filter(
  (site) =>
    site.isRead &&
    site.filtersActive &&
    !RESOLVER_HOMES.includes(site.file) &&
    !MANUAL_ALLOWLIST.some((a) => a.file === site.file && a.line === site.line),
);

const describeSite = (s: Site) =>
  `${s.file}:${s.line} — ${MODEL_NAME}.${s.operation}() filtre status:'${ACTIVE}' ` +
  `hors du résolveur canonique (${RESOLVER_FUNCTION})`;

/* ================================================================== *
 * LE CORPUS EST BIEN LE CORPUS — les garde-fous de vacuité
 * ================================================================== */

describe('la dérivation n’est pas vacante', () => {
  it('a marché `apps/api/src` — plancher PAR RACINE', () => {
    expect(API_FILES.length).toBeGreaterThanOrEqual(MIN_API_FILES);
  });

  it('a marché `apps/worker/src` — deux des sites convertis y vivent', () => {
    expect(WORKER_FILES.length).toBeGreaterThanOrEqual(MIN_WORKER_FILES);
  });

  it('a marché `packages/*/src` — la racine que le précédent maison OUBLIE', () => {
    // Un plancher GLOBAL serait satisfait par `apps/api` seul pendant que cette
    // racine disparaîtrait : c'est exactement là que vivait le pire site.
    expect(PACKAGE_FILES.length).toBeGreaterThanOrEqual(MIN_PACKAGE_FILES);
  });

  it("porte l'identité comptable — un plancher sur la LISTE ne se transporte pas sur la CARTE", () => {
    expect(CLASSIFIED.size + skipped.length).toBe(ALL_FILES.length);
  });

  it("n'a pas perdu plus que le budget calibré sur la taille du corpus", () => {
    expect(skipped.length).toBeLessThanOrEqual(walkRead.maxVanishedFor(ALL_FILES.length));
  });

  it('a RECONNU des sites `academicYear.*` — zéro contravention sur zéro reconnaissance ne prouve rien', () => {
    expect(MODEL_CALL_SITES.length).toBeGreaterThanOrEqual(MIN_MODEL_CALL_SITES);
  });

  it('a trouvé EXACTEMENT UN foyer de résolveur, reconnu par construction', () => {
    // Zéro ⇒ le résolveur a disparu et le cliquet est devenu décoratif.
    // Deux ⇒ la canonicalisation a déjà re-divergé.
    expect(RESOLVER_HOMES).toHaveLength(1);
    expect(RESOLVER_HOMES[0]).toBe('packages/contracts/src/academic-year/resolve-academic-year.ts');
  });

  it('voit encore la TRANSITION d’état — sinon le bras « écriture » n’est pas exercé', () => {
    // `academic-years.controller.ts` clôt l'année active précédente : un `where`
    // sur `status: active` ACCOMPAGNÉ d'une écriture de `status`. Si ce site
    // disparaissait du corpus, l'exclusion par construction ne serait plus testée
    // sur du code réel, seulement sur des fixtures.
    const transitions = MODEL_CALL_SITES.filter(
      (s) => !s.isRead && s.filtersActive && s.writesStatus,
    );
    expect(transitions.length).toBeGreaterThanOrEqual(1);
  });
});

/* ================================================================== *
 * LE CLIQUET LUI-MÊME
 * ================================================================== */

describe('AC-7 — aucune LECTURE de `academicYear` ne filtre `status: active` hors du résolveur', () => {
  it('zéro contrevenant sur les trois racines', () => {
    // Le message porte le SITE (`file:line`), jamais un simple compte.
    expect(OFFENDERS.map(describeSite)).toEqual([]);
  });

  it("l'allowlist manuelle expédie VIDE — le foyer légitime est DÉRIVÉ, pas énuméré", () => {
    expect(MANUAL_ALLOWLIST).toEqual([]);
  });

  it('les neuf sites convertis n’émettent plus aucune lecture `status: active`', () => {
    const converted = [
      'apps/api/src/modules/alerts/alerts.service.ts',
      'apps/api/src/modules/analytics/analytics.service.ts',
      'apps/api/src/modules/analytics/school-performance-drilldown.service.ts',
      'apps/api/src/modules/school-structure/school-context.service.ts',
      'apps/api/src/modules/school-structure/subjects.controller.ts',
      'apps/worker/src/modules/alerts-cron/alerts-evaluator.service.ts',
      'apps/worker/src/modules/exports/generators/enrollment-xlsx.generator.ts',
      'packages/imports-core/src/caches.ts',
    ];
    // Cette liste ne pilote AUCUNE exemption : elle ne fait que refuser un vert
    // obtenu parce que la marche aurait cessé de voir ces fichiers.
    for (const file of converted) {
      expect(CLASSIFIED.has(file)).toBe(true);
      expect(
        MODEL_CALL_SITES.filter((s) => s.file === file && s.isRead && s.filtersActive),
      ).toEqual([]);
    }
  });

  it('la famille RELATIONNELLE existe toujours et reste HORS portée — résidu mesuré, pas oublié', () => {
    // Dérivé du corpus, jamais énuméré. Une expression régulière suffit ICI et
    // seulement ici : ce n'est pas le verdict du cliquet, c'est la mesure d'un
    // RÉSIDU. Si un jour ce compte tombait à zéro, la famille aurait été
    // convertie et ce test devrait être retiré AVEC la ligne du registre — pas
    // « corrigé » en abaissant le plancher.
    // Les sources viennent de la CARTE (donc du seuil tolérant TOOL-17), jamais
    // d'un `readFileSync` nu sur une liste marchée : ce serait la course que
    // `scripts/lib/walk-read.js` existe pour absorber.
    const relationalFilter = new RegExp(`${MODEL_NAME}:\\s*\\{[^}]*status:\\s*'${ACTIVE}'`);
    const family = [...CLASSIFIED.entries()]
      .filter(([, facts]) => relationalFilter.test(facts.source))
      .map(([file]) => file);
    expect(family.length).toBeGreaterThanOrEqual(5);
  });

  it('aucun `SKIP_*` / `ALLOW_*` / `NODE_ENV` ne peut désarmer ce cliquet (DNC-10)', () => {
    const SELF = readFileSync(join(__dirname, 'academic-year-resolution-gate.spec.ts'), 'utf8');
    // Un `SKIP_…` ou un `ALLOW_…` ne peut désarmer quoi que ce soit qu'en étant
    // LU dans l'environnement : c'est donc la LECTURE qu'on interdit, pas les
    // noms — qui, eux, apparaissent en prose juste au-dessus et dans le titre de
    // ce test. Les motifs sont CONCATÉNÉS : écrits en toutes lettres ils
    // s'apparieraient eux-mêmes, exactement la collision que
    // `body-metatype-gate.spec.ts:761` a déjà enregistrée (PF-295).
    for (const needle of ['pro' + 'cess.env', "require('node:pro" + "cess')"]) {
      expect(SELF).not.toContain(needle);
    }
  });
});

/* ================================================================== *
 * ROUGE-AVANT / VERT-APRÈS, sur fixtures — modèle SYNTHÉTIQUE (PF-295)
 * ================================================================== */

const FIXTURE_MODEL = 'fixtureYear';
const FIXTURE_PATH = join(API_SRC, 'modules', '__fixture', 'fixture.service.ts');

/** Toute source de fixture est CONCATÉNÉE, jamais écrite en un littéral unique. */
const fixture = (...lines: string[]) => [...lines, ''].join('\n');

const runFixture = (source: string) => classify(FIXTURE_PATH, source, FIXTURE_MODEL, ACTIVE);
const onlyCall = (calls: ModelCall[]): ModelCall => {
  expect(calls).toHaveLength(1);
  return calls[0] as ModelCall;
};
const isOffending = (call: ModelCall) => call.isRead && call.filtersActive;

describe('CONTRÔLE NÉGATIF — les formes contrevenantes DOIVENT être signalées', () => {
  it('la forme `school-context` : `findFirst` par école seule, statut actif en littéral', () => {
    const call = onlyCall(
      runFixture(
        fixture(
          'export async function ctx(prisma: Db, schoolId: string) {',
          `  return prisma.${FIXTURE_MODEL}.findFirst({`,
          `    where: { schoolId, status: '${ACTIVE}' },`,
          "    orderBy: { startDate: 'desc' },",
          '  });',
          '}',
        ),
      ),
    );
    expect(isOffending(call)).toBe(true);
  });

  it('la forme ENUM : `status: FixtureStatus.active` est aussi une contrainte', () => {
    // Une règle indexée sur le seul littéral de chaîne serait verte ici, c'est-à-
    // dire verte sur les deux sites `updateMany` du contrôleur d'années.
    const call = onlyCall(
      runFixture(
        fixture(
          'export async function ctx(prisma: Db, tenantId: string) {',
          `  return prisma.${FIXTURE_MODEL}.findMany({`,
          `    where: { tenantId, status: FixtureStatus.${ACTIVE} },`,
          '  });',
          '}',
        ),
      ),
    );
    expect(isOffending(call)).toBe(true);
  });

  it('la forme IMBRIQUÉE : la contrainte cachée dans un `AND` est trouvée', () => {
    const call = onlyCall(
      runFixture(
        fixture(
          'export async function ctx(prisma: Db, tenantId: string) {',
          `  return prisma.${FIXTURE_MODEL}.count({`,
          `    where: { AND: [{ tenantId }, { status: '${ACTIVE}' }] },`,
          '  });',
          '}',
        ),
      ),
    );
    expect(isOffending(call)).toBe(true);
  });
});

describe('CONTRÔLE POSITIF — sans lui, un comparateur toujours-rouge « prouverait » tout', () => {
  it('une lecture SANS contrainte de statut passe — `previousYear`, les listings', () => {
    const call = onlyCall(
      runFixture(
        fixture(
          'export async function ctx(prisma: Db, tenantId: string) {',
          `  return prisma.${FIXTURE_MODEL}.findMany({`,
          '    where: { tenantId },',
          "    orderBy: { startDate: 'desc' },",
          '  });',
          '}',
        ),
      ),
    );
    expect(isOffending(call)).toBe(false);
  });

  it('la TRANSITION d’état passe PAR CONSTRUCTION — filtre `active`, écrit `status`', () => {
    // Le cas réel le plus dur de la règle : `academic-years.controller.ts:133`
    // est la SEULE application de « une seule année active » dans le produit.
    // S'il basculait en contrevenant, la seule « réparation » disponible serait
    // une allowlist ou un relâchement de la règle (R-30).
    const call = onlyCall(
      runFixture(
        fixture(
          'export async function close(tx: Db, schoolId: string) {',
          `  return tx.${FIXTURE_MODEL}.updateMany({`,
          `    where: { schoolId, status: FixtureStatus.${ACTIVE} },`,
          '    data: { status: FixtureStatus.closed },',
          '  });',
          '}',
        ),
      ),
    );
    expect(call.isRead).toBe(false);
    expect(call.filtersActive).toBe(true);
    expect(call.writesStatus).toBe(true);
    expect(isOffending(call)).toBe(false);
  });

  it('une lecture d’APPARTENANCE sur un id fourni passe — `snapshot-ops`, `calendar.controller`', () => {
    const call = onlyCall(
      runFixture(
        fixture(
          'export async function owned(tx: Db, id: string, tenantId: string) {',
          `  return tx.${FIXTURE_MODEL}.findFirst({ where: { id, tenantId }, select: { id: true } });`,
          '}',
        ),
      ),
    );
    expect(isOffending(call)).toBe(false);
  });

  it('un `status` écrit à la CRÉATION, sans `where`, n’est pas une lecture filtrée', () => {
    const call = onlyCall(
      runFixture(
        fixture(
          'export async function create(tx: Db, schoolId: string) {',
          `  return tx.${FIXTURE_MODEL}.create({ data: { schoolId, status: '${ACTIVE}' } });`,
          '}',
        ),
      ),
    );
    expect(isOffending(call)).toBe(false);
  });

  it('LE MODULE RÉEL DU RÉSOLVEUR passe par le MÊME classifieur, sans exemption', () => {
    // Contrôle positif sur du code de production, pas sur une fixture : le
    // module canonique est lu depuis l'arbre et jugé par la règle elle-même.
    const home = RESOLVER_HOMES[0] as string;
    const facts = CLASSIFIED.get(home);
    expect(facts).toBeDefined();
    expect(facts!.calls.filter((c) => c.isRead && c.filtersActive)).toEqual([]);
  });

  it('LES DEUX ADAPTATEURS RÉELS passent — ils transmettent un `where` opaque', () => {
    for (const adapter of [
      'apps/api/src/shared/academic-year/prisma-academic-year-reader.ts',
      'apps/worker/src/shared/academic-year/prisma-academic-year-reader.ts',
    ]) {
      const facts = CLASSIFIED.get(adapter);
      expect(facts).toBeDefined();
      // Ils APPELLENT bien le modèle — sinon ce contrôle serait vide de sens…
      expect(facts!.calls.length).toBeGreaterThanOrEqual(1);
      // …et aucun de leurs appels ne porte de contrainte de statut écrite en dur.
      expect(facts!.calls.filter((c) => c.isRead && c.filtersActive)).toEqual([]);
    }
  });
});
