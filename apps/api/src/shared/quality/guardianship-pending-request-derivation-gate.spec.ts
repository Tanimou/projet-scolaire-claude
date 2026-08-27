import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

/**
 * S-E03-5 / PF-20 / PF-373 / ADR-075 — LE CLIQUET : plus aucune surface ne
 * RE-DÉRIVE « cette demande de rattachement attend-elle une décision admin ? ».
 *
 * LE DÉFAUT QUE CE CLIQUET REND INEXPRIMABLE
 * -------------------------------------------
 * Mesuré le 2026-08-26, la même question était posée SIX fois, sur deux
 * applications, et deux des six réponses étaient structurellement fausses :
 *
 *   • `analytics.service.ts:2472` — le KPI « Demandes en attente » du tableau
 *     de bord admin, `count({ where: { tenantId, status: 'pending' } })` ;
 *   • `:2932` — la liste d'aperçu du centre d'action, même littéral ;
 *   • `:3028` — le compte affiché AU-DESSUS de cette liste, même littéral ;
 *   • `:3322` — la courbe sous le KPI, qui jetait `schoolId` en silence ;
 *   • `admin/enrollments/page.tsx` — la file où le CTA « Examiner » envoie,
 *     qui déclarait À LA MAIN une forme de `Guardianship` alors que l'endpoint
 *     appelé rendait des `Guardian` : ses cinq onglets comparaient donc
 *     `undefined` à un littéral, TOUJOURS FAUX, pour tout tenant, depuis
 *     toujours ;
 *   • `admin/guardians/page.tsx` — un sixième comptage, côté client, sur une
 *     charge utile tronquée.
 *
 * L'admin lisait « 28 demandes en attente », cliquait « Examiner », et
 * atterrissait sur une file vide qui lui expliquait que les parents n'avaient
 * rien soumis. C'est `PF-20` mot pour mot, et c'est `DNC-01` (le KPI contredit
 * le registre) et `DNC-06` (un onglet qui ne peut structurellement rien
 * montrer) sur le même écran.
 *
 * LES TROIS RÈGLES, UNE LIGNE CHACUNE
 * ------------------------------------
 * Hors du module qui DÉCLARE `guardianshipPendingRequestWhere`, est un
 * contrevenant :
 *
 *   R-A — une LECTURE Prisma du modèle `guardianship` dont le `where` épelle
 *         `status: 'pending'` en littéral.
 *
 *   R-B — une relation `guardianships: { where: … }` qui l'épelle. C'EST
 *         L'ANGLE MORT DE R-A, ET IL EST MESURÉ : R-A ne voit que les appels
 *         `<expr>.guardianship.<op>()`, alors que la majorité des lectures de
 *         ce dépôt passent par la relation, depuis `student` ou `guardian`.
 *         Le cliquet frère l'a démontré au run 85 en rendant un fichier à son
 *         état d'avant : R-A n'avait rien vu du `where` de relation quatorze
 *         lignes plus haut. Écrit ici plutôt que redécouvert.
 *
 *   R-C — un fichier de PRODUCTION hors `packages/contracts` qui re-déclare une
 *         union de littéraux dont l'ensemble des membres ÉGALE l'énum
 *         `GuardianshipStatus`. C'est la classe que `PF-371` nomme : « un
 *         MIROIR FE écrit à la main d'un contrat livré, sans rien qui tienne
 *         les deux en phase ». `api<T>()` castant sans valider, un miroir faux
 *         est INVISIBLE au compilateur — c'est exactement comme cela que la
 *         file `/admin/enrollments` a pu décrire une `Guardianship` tout en
 *         recevant des `Guardian` pendant toute la vie du produit.
 *
 * R-C EST DÉRIVÉE, JAMAIS ÉCRITE EN LITTÉRAL
 * -------------------------------------------
 * L'ensemble comparé est LU dans `apps/api/prisma/schema.prisma`. Écrire
 * `['pending','active','revoked']` ici créerait une SECONDE liste à tenir à la
 * main en face de l'énum — précisément le couple que ce dépôt a déjà payé une
 * fois (la course `academic_year.SELECT`, run 59, qui a coûté un 503 sur quatre
 * portails). Un quatrième membre ajouté à l'énum change donc la règle tout
 * seul, sans qu'aucun humain n'ait à s'en souvenir.
 *
 * LES ÉCRITURES SONT EXEMPTÉES PAR CONSTRUCTION, ET C'EST DIT ICI
 * ---------------------------------------------------------------
 * `child-claims.service.ts` porte `status: 'pending'` dans trois `updateMany`
 * (`:630`, `:788`, `:890`) et dans deux `data:` de création (`:256`, `:268`).
 * Les premiers sont des gardes d'état-DE-DÉPART sur une mutation — de la
 * concurrence optimiste, « ne bouge cette ligne QUE SI elle est encore en
 * attente » — et les seconds sont des transitions d'état. Aucun n'est une
 * lecture de population.
 *
 * Une règle énoncée sur « toute requête » les attraperait tous les cinq, et il
 * ne resterait alors que les trois sorties interdites
 * (`academic-year-resolution-gate.spec.ts:20-32`) : relâcher la règle, allowlister
 * les fichiers, ou convertir hors périmètre. Les verbes d'écriture ne sont donc
 * pas dans `READ_OPERATIONS` : la catégorie est reconnue PAR CONSTRUCTION, et
 * AUCUN nom de fichier n'apparaît en exception. C'est la différence entre une
 * exemption qui se relit et une exemption qui s'oublie.
 *
 * `'pending'` EST POLYSÉMIQUE — LA RÈGLE EST ANCRÉE SUR LE MODÈLE
 * ---------------------------------------------------------------
 * La chaîne nue apparaît sur `Enrollment`, `ExportJob`, `ImportBatch`,
 * `SnapshotRecomputeTrigger` et `migration-state.ts`. Une règle indexée sur la
 * chaîne serait du bruit, donc serait relâchée dans le mois. R-A et R-B sont
 * ancrées sur le NOM DU MODÈLE et sur le NOM DE LA RELATION, tous deux
 * INJECTÉS en constantes (`PF-295`) pour qu'un motif écrit en toutes lettres ne
 * devienne pas un faux positif du grep du relecteur suivant.
 *
 * CE QUE CE CLIQUET NE PROUVE PAS
 * -------------------------------
 * 1. Il prouve une FORME. Que la portée retenue (tenant + école, sur l'axe
 *    `student`) soit la BONNE est porté par les tests de comportement
 *    (`pending-request-agreement.spec.ts` : un fixture, trois lectures, une
 *    seule valeur) et par les tests unitaires du module contractuel.
 *
 * 2. IL NE FERMAIT PAS `PF-20` — `S-E03-6` a fermé l'autre moitié. Ce cliquet
 *    ferme la moitié « demandes » ; la moitié « 4 alerts vs 0 rules » vivait
 *    dans `admin/alerts/page.tsx` et dans le KPI « Alertes configurées », qui
 *    valait `DEFAULT_ALERT_RULES.length` — une constante de QUATRE entrées en
 *    face d'un enum qui en porte HUIT, jamais lue en base. Corrigée par
 *    `S-E03-6` (`alert-rule-population.ts`, `ADR-077`) et gelée par
 *    `alert-rule-catalogue-gate.spec.ts`. Le test de résidu en bas de CE
 *    fichier a été RETOURNÉ en test de fermeture, comme il le demandait
 *    lui-même. `PF-20` est fermé sur ses deux moitiés.
 *
 * 3. LIMITE CONNUE, la même que ses frères : `scripts/ci-gate.sh` ne fait
 *    tourner la suite complète que quand le diff touche `GATE_MACHINERY`. Ce
 *    fichier en fait partie, donc le cliquet tourne sur CETTE PR ; une PR
 *    future ne touchant que `packages/**` ne l'exécuterait pas (`PF-333`).
 */

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..', '..');
const API_SRC = join(REPO_ROOT, 'apps', 'api', 'src');
const WORKER_SRC = join(REPO_ROOT, 'apps', 'worker', 'src');
const WEB_SRC = join(REPO_ROOT, 'apps', 'web', 'src');
const PACKAGES_DIR = join(REPO_ROOT, 'packages');
const WALK_READ_PATH = join(REPO_ROOT, 'scripts', 'lib', 'walk-read.js');
const SCHEMA_PATH = join(REPO_ROOT, 'apps', 'api', 'prisma', 'schema.prisma');

/** Le foyer déclarant, DÉRIVÉ plus bas et vérifié — jamais une allowlist. */
const PREDICATE_HOME = 'packages/contracts/src/guardianship/link-liveness.ts';

/** La racine exemptée de R-C : c'est là que le vocabulaire est CENSÉ vivre. */
const CONTRACT_ROOT = 'packages/contracts/src/';

/** Le nom du modèle Prisma jugé. INJECTÉ dans le classifieur (PF-295). */
const MODEL_NAME = 'guardianship';

/** Le nom de la relation, pour R-B. INJECTÉ pour la même raison. */
const RELATION_NAME = 'guardianships';

/** La fonction qui DÉFINIT le foyer légitime. */
const PREDICATE_FUNCTION = 'guardianshipPendingRequestWhere';

/** L'énum Prisma dont R-C dérive son ensemble de comparaison. */
const STATUS_ENUM_NAME = 'GuardianshipStatus';

/** La valeur jugée : « attend une décision ». */
const AWAITING_VALUE = 'pending';

/**
 * Les opérations de LECTURE. Tout ce qui n'est pas là — `update`, `updateMany`,
 * `upsert`, `create`, `delete`, `deleteMany` — est une écriture, donc une
 * transition d'état, donc hors de R-A PAR CONSTRUCTION (voir le docblock).
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

/* eslint-disable @typescript-eslint/no-require-imports */
// Non gardés, exprès (DNC-08) : s'ils s'évaporent, cette suite doit mourir au
// CHARGEMENT plutôt que dégénérer en « rien à vérifier ».
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
 * L'ENSEMBLE DE R-C, LU DANS `schema.prisma` — DÉRIVÉ, JAMAIS ÉCRIT
 * ================================================================== */

function readPrismaEnum(name: string): string[] {
  const schema = readFileSync(SCHEMA_PATH, 'utf8');
  const block = schema.match(new RegExp(`enum ${name} \\{([^}]*)\\}`));
  if (!block) throw new Error(`enum ${name} introuvable dans schema.prisma`);
  return block[1]!
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('//'));
}

const PRISMA_STATUS_MEMBERS = readPrismaEnum(STATUS_ENUM_NAME);

/* ================================================================== *
 * LA MARCHE — quatre racines, plancher PAR RACINE
 * ================================================================== */

/**
 * Les `*.spec.ts(x)` sont HORS corpus : une spec n'émet aucune requête de
 * production, elle porte des fakes et des fixtures délibérément contrevenantes
 * — dont celles de ce fichier. Les juger produirait un auto-rouge que l'on
 * « corrigerait » par une exclusion, c'est-à-dire par une allowlist déguisée.
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
      (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) &&
      !entry.name.endsWith('.d.ts') &&
      !entry.name.endsWith('.spec.ts') &&
      !entry.name.endsWith('.spec.tsx') &&
      !entry.name.endsWith('.test.ts') &&
      !entry.name.endsWith('.test.tsx')
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
const WEB_FILES = walkTs(WEB_SRC).sort();
const PACKAGE_FILES = walkPackages().sort();
const ALL_FILES = [...API_FILES, ...WORKER_FILES, ...WEB_FILES, ...PACKAGE_FILES];

const rel = (absolute: string) => relative(REPO_ROOT, absolute).split(sep).join('/');

/**
 * Planchers PAR RACINE, jamais des égalités (convention maison : tout plancher
 * est `>=`). Un plancher GLOBAL resterait satisfait par `apps/api` seul pendant
 * que `apps/web` — où vivent les TROIS contrevenants de R-C — disparaîtrait de
 * la marche en silence. C'est le mode d'échec exact que l'inversion du
 * pré-mortem a nommé : « un cliquet calqué sans élargir la marche rendra vert
 * sans avoir regardé le front ».
 */
const MIN_API_FILES = 150;
const MIN_WORKER_FILES = 50;
const MIN_WEB_FILES = 300;
const MIN_PACKAGE_FILES = 38;

/**
 * Plancher de RECONNAISSANCE : le nombre de sites `guardianship.*` que la
 * marche doit encore VOIR. Zéro contravention sur zéro reconnaissance ne prouve
 * rien — c'est le mode d'échec que ce plancher existe pour rendre impossible.
 */
const MIN_MODEL_CALL_SITES = 10;

/* ================================================================== *
 * LES CLASSIFIEURS — noms INJECTÉS (PF-295)
 * ================================================================== */

type ModelCall = {
  operation: string;
  line: number;
  isRead: boolean;
  /** `true` ⇔ le `where` épelle `status: 'pending'`. */
  spellsAwaiting: boolean;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parse(path: string, source: string): any {
  return ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
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
 * `status: 'pending'` ou `status: <X>.pending`, à n'importe quelle profondeur.
 *
 * ⚠ `status: { in: [...] }` — la forme que rend le prédicat canonique — n'est
 * PAS un littéral au sens de cette règle et passe donc, ce qui est le point :
 * la règle interdit d'épeler la valeur, pas de filtrer sur le statut.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function spellsStatusLiteral(node: any, value: string): boolean {
  let found = false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const visit = (n: any) => {
    if (found) return;
    if (ts.isPropertyAssignment(n)) {
      const key = ts.isIdentifier(n.name) || ts.isStringLiteral(n.name) ? n.name.text : undefined;
      if (key === 'status') {
        const v = n.initializer;
        if (ts.isStringLiteral(v) && v.text === value) {
          found = true;
          return;
        }
        if (ts.isPropertyAccessExpression(v) && v.name.text === value) {
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

/** R-A : recense chaque appel `<expr>.<modelName>.<op>(…)`. */
function classifyCalls(path: string, source: string, modelName: string): ModelCall[] {
  const sf = parse(path, source);
  const out: ModelCall[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const visit = (node: any) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const operationAccess = node.expression;
      const receiver = operationAccess.expression;
      if (ts.isPropertyAccessExpression(receiver) && receiver.name.text === modelName) {
        const operation = operationAccess.name.text as string;
        const where = memberOf(node.arguments[0], 'where');
        out.push({
          operation,
          line: (sf.getLineAndCharacterOfPosition(node.getStart(sf)).line as number) + 1,
          isRead: READ_OPERATIONS.has(operation),
          spellsAwaiting: where !== undefined && spellsStatusLiteral(where, AWAITING_VALUE),
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** R-B : recense chaque `<relation>: { where: … }` qui épelle la valeur. */
function classifyRelationWheres(path: string, source: string, relation: string): number[] {
  const sf = parse(path, source);
  const out: number[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const visit = (node: any) => {
    if (ts.isPropertyAssignment(node)) {
      const key =
        ts.isIdentifier(node.name) || ts.isStringLiteral(node.name) ? node.name.text : undefined;
      if (key === relation && ts.isObjectLiteralExpression(node.initializer)) {
        const where = memberOf(node.initializer, 'where');
        if (where !== undefined && spellsStatusLiteral(where, AWAITING_VALUE)) {
          out.push((sf.getLineAndCharacterOfPosition(node.getStart(sf)).line as number) + 1);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/**
 * R-C : recense chaque UNION DE LITTÉRAUX DE CHAÎNE dont l'ensemble des membres
 * ÉGALE `members` — l'énum lue dans `schema.prisma`.
 *
 * L'égalité est d'ENSEMBLE (taille + membres), pas d'ordre : `'active' |
 * 'pending' | 'revoked'` est le même miroir que `'pending' | 'active' |
 * 'revoked'`, et un auteur qui réordonnerait pour passer aurait trouvé une
 * sortie que la règle n'aurait pas voulu lui donner.
 */
function classifyStatusUnions(path: string, source: string, members: string[]): number[] {
  const sf = parse(path, source);
  const wanted = [...members].sort().join('|');
  const out: number[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const visit = (node: any) => {
    if (ts.isUnionTypeNode(node)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const texts: string[] = node.types.map((t: any) =>
        ts.isLiteralTypeNode(t) && ts.isStringLiteral(t.literal) ? (t.literal.text as string) : '',
      );
      if (texts.length > 0 && texts.every((t) => t.length > 0)) {
        if ([...texts].sort().join('|') === wanted) {
          out.push((sf.getLineAndCharacterOfPosition(node.getStart(sf)).line as number) + 1);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** Le fichier DÉCLARE-t-il le prédicat ? Reconnaissance par construction. */
function declaresPredicate(path: string, source: string, functionName: string): boolean {
  const sf = parse(path, source);
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

type FileFacts = {
  source: string;
  calls: ModelCall[];
  relationWheres: number[];
  statusUnions: number[];
  isPredicateHome: boolean;
};

const { entries, skipped } = walkRead.mapWalkedFiles<FileFacts>(ALL_FILES, (path, source) => [
  rel(path),
  {
    source,
    calls: classifyCalls(path, source, MODEL_NAME),
    relationWheres: classifyRelationWheres(path, source, RELATION_NAME),
    statusUnions: classifyStatusUnions(path, source, PRISMA_STATUS_MEMBERS),
    isPredicateHome: declaresPredicate(path, source, PREDICATE_FUNCTION),
  },
]);
const CLASSIFIED = new Map(entries);
walkRead.warnSkipped('guardianship-pending-request-derivation-gate', skipped);

const PREDICATE_HOMES = [...CLASSIFIED.entries()]
  .filter(([, facts]) => facts.isPredicateHome)
  .map(([file]) => file);

type Site = ModelCall & { file: string };

const MODEL_CALL_SITES: Site[] = [...CLASSIFIED.entries()].flatMap(([file, facts]) =>
  facts.calls.map((call) => ({ ...call, file })),
);

/**
 * L'allowlist manuelle. Elle existe, elle est nommée, et elle EXPÉDIE VIDE —
 * une assertion le vérifie plus bas. Le foyer légitime est DÉRIVÉ (le fichier
 * qui déclare le prédicat), jamais énuméré.
 */
const MANUAL_ALLOWLIST: ReadonlyArray<{ file: string; line: number }> = [];

const allowed = (file: string, line: number) =>
  MANUAL_ALLOWLIST.some((a) => a.file === file && a.line === line);

const OFFENDERS_A: Site[] = MODEL_CALL_SITES.filter(
  (site) =>
    site.isRead &&
    site.spellsAwaiting &&
    !PREDICATE_HOMES.includes(site.file) &&
    !allowed(site.file, site.line),
);

const OFFENDERS_B: ReadonlyArray<{ file: string; line: number }> = [...CLASSIFIED.entries()]
  .filter(([file]) => !PREDICATE_HOMES.includes(file))
  .flatMap(([file, facts]) => facts.relationWheres.map((line) => ({ file, line })))
  .filter((s) => !allowed(s.file, s.line));

const OFFENDERS_C: ReadonlyArray<{ file: string; line: number }> = [...CLASSIFIED.entries()]
  .filter(([file]) => !file.startsWith(CONTRACT_ROOT))
  .flatMap(([file, facts]) => facts.statusUnions.map((line) => ({ file, line })))
  .filter((s) => !allowed(s.file, s.line));

const describeA = (s: Site) =>
  `${s.file}:${s.line} — ${MODEL_NAME}.${s.operation}() épelle le statut en littéral ` +
  `(status:'${AWAITING_VALUE}') au lieu d'importer ${PREDICATE_FUNCTION}()`;

const describeB = (s: { file: string; line: number }) =>
  `${s.file}:${s.line} — la relation ${RELATION_NAME} porte un \`where\` qui épelle ` +
  `status:'${AWAITING_VALUE}' au lieu d'importer ${PREDICATE_FUNCTION}()`;

const describeC = (s: { file: string; line: number }) =>
  `${s.file}:${s.line} — union de littéraux ÉGALE à l'énum ${STATUS_ENUM_NAME} : c'est un ` +
  `miroir écrit à la main d'un contrat livré (PF-371). Importer GuardianshipLinkStatus ` +
  `depuis @pilotage/contracts.`;

/* ================================================================== *
 * LE CORPUS EST BIEN LE CORPUS — les garde-fous de vacuité
 * ================================================================== */

describe('la dérivation « en attente d’une décision » n’est pas vacante', () => {
  it('a marché `apps/api/src` — plancher PAR RACINE', () => {
    expect(API_FILES.length).toBeGreaterThanOrEqual(MIN_API_FILES);
  });

  it('a marché `apps/worker/src`', () => {
    expect(WORKER_FILES.length).toBeGreaterThanOrEqual(MIN_WORKER_FILES);
  });

  it('a marché `apps/web/src` — la racine des TROIS contrevenants de R-C', () => {
    // Sans cette marche, le cliquet serait vert sans avoir regardé le front,
    // c'est-à-dire vert sur la moitié du défaut qu'il est censé fermer.
    expect(WEB_FILES.length).toBeGreaterThanOrEqual(MIN_WEB_FILES);
  });

  it('a marché `packages/*/src` — la racine qui PORTE le prédicat', () => {
    expect(PACKAGE_FILES.length).toBeGreaterThanOrEqual(MIN_PACKAGE_FILES);
  });

  it('voit encore de vrais sites `guardianship.*` — zéro sur zéro ne prouve rien', () => {
    expect(MODEL_CALL_SITES.length).toBeGreaterThanOrEqual(MIN_MODEL_CALL_SITES);
  });

  it('a lu une énum `GuardianshipStatus` NON VIDE dans `schema.prisma`', () => {
    // R-C compare à un ensemble DÉRIVÉ. Si la lecture rendait le vide, la règle
    // deviendrait « aucune union n'égale l'ensemble vide » — vraie toujours.
    expect(PRISMA_STATUS_MEMBERS.length).toBeGreaterThanOrEqual(2);
  });

  it('a trouvé EXACTEMENT UN foyer déclarant le prédicat', () => {
    // Zéro ⇒ le prédicat a disparu et le cliquet est décoratif.
    // Deux ⇒ la canonicalisation a déjà re-divergé.
    expect(PREDICATE_HOMES).toHaveLength(1);
    expect(PREDICATE_HOMES[0]).toBe(PREDICATE_HOME);
  });

  it('n’a pas sauté de fichier', () => {
    expect(skipped.length).toBeLessThanOrEqual(walkRead.maxVanishedFor(ALL_FILES.length));
  });
});

/* ================================================================== *
 * LE CONTRÔLE NÉGATIF — sans lui, un comparateur toujours-vert passe
 * ================================================================== */

describe('le classifieur discrimine (contrôle négatif — TOOL-13 / run 45)', () => {
  // Les fixtures emploient un modèle SYNTHÉTIQUE absent du produit (PF-295) :
  // un motif écrit en toutes lettres deviendrait un faux positif pour le grep
  // du relecteur suivant.
  const FIXTURE_MODEL = 'fixtureLink';
  const FIXTURE_RELATION = 'fixtureLinks';
  const FIXTURE_ENUM = ['alpha', 'beta', 'gamma'];

  it('R-A SIGNALE une LECTURE qui épelle la valeur en littéral', () => {
    const src = `const r = await db.${FIXTURE_MODEL}.count({ where: { tenantId, status: '${AWAITING_VALUE}' } });`;
    const calls = classifyCalls('fixture.ts', src, FIXTURE_MODEL);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.isRead).toBe(true);
    expect(calls[0]!.spellsAwaiting).toBe(true);
  });

  it('R-A LAISSE PASSER une lecture qui importe le prédicat', () => {
    const src = `const r = await db.${FIXTURE_MODEL}.count({ where: ${PREDICATE_FUNCTION}({ tenantId, schoolId }) });`;
    const calls = classifyCalls('fixture.ts', src, FIXTURE_MODEL);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.spellsAwaiting).toBe(false);
  });

  it('R-A LAISSE PASSER un `updateMany` qui garde l’état de DÉPART — l’exemption par construction', () => {
    // C'est la forme exacte de `child-claims.service.ts:630/:788/:890` : de la
    // concurrence optimiste, pas une lecture de population. Aucun nom de
    // fichier n'est nécessaire pour l'exempter.
    const src = `await db.${FIXTURE_MODEL}.updateMany({ where: { id, status: '${AWAITING_VALUE}' }, data: { status: 'active' } });`;
    const calls = classifyCalls('fixture.ts', src, FIXTURE_MODEL);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.isRead).toBe(false);
    // La valeur EST bien vue — c'est l'opération, pas l'aveuglement, qui exempte.
    expect(calls[0]!.spellsAwaiting).toBe(true);
  });

  it('R-A LAISSE PASSER un `create` qui POSE la valeur dans `data`', () => {
    const src = `await db.${FIXTURE_MODEL}.create({ data: { tenantId, status: '${AWAITING_VALUE}' } });`;
    const calls = classifyCalls('fixture.ts', src, FIXTURE_MODEL);
    expect(calls[0]!.isRead).toBe(false);
  });

  it('R-B SIGNALE une relation dont le `where` épelle la valeur', () => {
    const src = `const r = await db.owner.findMany({ include: { ${FIXTURE_RELATION}: { where: { status: '${AWAITING_VALUE}' } } } });`;
    expect(classifyRelationWheres('fixture.ts', src, FIXTURE_RELATION)).toHaveLength(1);
  });

  it('R-B LAISSE PASSER une relation dont le `where` importe le prédicat', () => {
    const src = `const r = await db.owner.findMany({ include: { ${FIXTURE_RELATION}: { where: ${PREDICATE_FUNCTION}(scope) } } });`;
    expect(classifyRelationWheres('fixture.ts', src, FIXTURE_RELATION)).toHaveLength(0);
  });

  it('R-C SIGNALE une union de littéraux ÉGALE à l’énum', () => {
    const src = `type Fixture = { status: '${FIXTURE_ENUM.join("' | '")}' };`;
    expect(classifyStatusUnions('fixture.ts', src, FIXTURE_ENUM)).toHaveLength(1);
  });

  it('R-C SIGNALE la même union RÉORDONNÉE — l’égalité est d’ENSEMBLE', () => {
    const reordered = [...FIXTURE_ENUM].reverse();
    const src = `type Fixture = '${reordered.join("' | '")}';`;
    expect(classifyStatusUnions('fixture.ts', src, FIXTURE_ENUM)).toHaveLength(1);
  });

  it('R-C LAISSE PASSER une union PLUS PETITE — ce n’est pas un miroir de l’énum', () => {
    const src = `type Fixture = '${FIXTURE_ENUM[0]}' | '${FIXTURE_ENUM[1]}';`;
    expect(classifyStatusUnions('fixture.ts', src, FIXTURE_ENUM)).toHaveLength(0);
  });

  it('R-C LAISSE PASSER une union MIXTE (littéraux + type nommé)', () => {
    const src = `type Fixture = '${FIXTURE_ENUM[0]}' | SomeNamedType;`;
    expect(classifyStatusUnions('fixture.ts', src, FIXTURE_ENUM)).toHaveLength(0);
  });

  it('R-C LAISSE PASSER l’import du type contractuel — la sortie voulue', () => {
    const src = `import type { GuardianshipLinkStatus } from '@pilotage/contracts';\ntype Fixture = { status: GuardianshipLinkStatus };`;
    expect(classifyStatusUnions('fixture.ts', src, FIXTURE_ENUM)).toHaveLength(0);
  });

  it('les classifieurs lisent le TSX — sans quoi `apps/web` serait muet', () => {
    const src = `export function C() { return <div />; }\ntype Fixture = '${FIXTURE_ENUM.join("' | '")}';`;
    expect(classifyStatusUnions('fixture.tsx', src, FIXTURE_ENUM)).toHaveLength(1);
  });

  it('l’allowlist manuelle expédie VIDE', () => {
    expect(MANUAL_ALLOWLIST).toHaveLength(0);
  });
});

/* ================================================================== *
 * LES TROIS RÈGLES, SUR L'ARBRE RÉEL
 * ================================================================== */

describe('R-A — aucune LECTURE n’épelle « en attente » en littéral', () => {
  it('zéro contrevenant hors du foyer du prédicat', () => {
    expect(OFFENDERS_A.map(describeA)).toEqual([]);
  });
});

describe('R-B — aucune relation `guardianships` n’épelle « en attente »', () => {
  it('zéro contrevenant ancré sur la relation', () => {
    expect(OFFENDERS_B.map(describeB)).toEqual([]);
  });
});

describe('R-C — aucun miroir du vocabulaire écrit à la main', () => {
  it('zéro union de littéraux égale à l’énum, hors `packages/contracts`', () => {
    expect(OFFENDERS_C.map(describeC)).toEqual([]);
  });
});

/* ================================================================== *
 * LE FOYER EST BIEN LE FOYER — ce qu'il doit contenir, et ne pas contenir
 * ================================================================== */

describe('le foyer déclarant tient ses promesses', () => {
  const home = () => readFileSync(join(REPO_ROOT, ...PREDICATE_HOME.split('/')), 'utf8');

  it('n’importe PAS Prisma (GUARDRAILS §2)', () => {
    // Une IMPORTATION, pas une occurrence de la chaîne : le docblock CITE
    // `@prisma/client` pour expliquer pourquoi il n'en dépendra jamais.
    expect(home()).not.toMatch(/^\s*import\s[^\n]*'@prisma\/client'/m);
    expect(home()).not.toMatch(/require\(\s*'@prisma\/client'\s*\)/);
  });

  it('la portée « en attente » est une liste POSITIVE, pas une soustraction', () => {
    // L'asymétrie voulue (§2.7) : un quatrième membre ajouté à l'énum ne doit
    // pas devenir « du travail en attente » — donc entrer dans le KPI d'un
    // directeur — par le seul fait d'avoir été ajouté.
    expect(home()).toMatch(/GUARDIANSHIP_AWAITING_DECISION_STATUSES[^=]*=\s*\[/);
  });

  it('le constructeur porte la portée COMPLÈTE — tenant ET école', () => {
    // Le mode d'échec qu'il ferme : un site qui n'épellerait que la moitié de
    // la portée, et un KPI qui redeviendrait plus large que sa file.
    const src = home();
    expect(src).toContain('tenantId: scope.tenantId');
    expect(src).toContain('student: { schoolId: scope.schoolId }');
  });

  it('aucune clé de portée n’est posée par un spread conditionnel (ADR-065 §D5)', () => {
    // `...(x ? { x } : {})` sur un paramètre de PORTÉE est un fail-open :
    // Prisma laisse tomber une clé `undefined` et la requête S'ÉLARGIT.
    expect(home()).not.toMatch(/\.\.\.\(\s*scope\.\w+\s*\?/);
  });
});

/* ================================================================== *
 * CE QUE CE CLIQUET NE FERME PAS, ASSIS EXPLICITEMENT
 * ================================================================== */

describe('les résidus sont assis — pour qu’on ne les déclare pas fermés', () => {
  it('la moitié « alertes » de PF-20 est FERMÉE (S-E03-6) — et ne peut pas rouvrir', () => {
    // CE TEST ÉTAIT LE ROUGE-AVANT, ÉCRIT PAR `S-E03-5` UN RUN PLUS TÔT.
    //
    // Il affirmait `toContain('DEFAULT_ALERT_RULES.length')` pour ASSEOIR le
    // résidu, et son propre commentaire disait : « Ce test échouera le jour où
    // ce KPI deviendra une lecture — ce qui est le signal de fermer PF-20, et
    // non de supprimer ce test. » Ce jour est `S-E03-6`. L'assertion est donc
    // RETOURNÉE, pas retirée : le fichier garde une phrase sur ce KPI, et cette
    // phrase interdit maintenant le retour en arrière.
    //
    // La constante comptait QUATRE codes quand l'enum en porte HUIT : ce n'était
    // pas seulement un nombre invérifiable, c'était un nombre FAUX, et la
    // seconde liste tenue à la main l'avait rendu faux en silence.
    const analytics = CLASSIFIED.get('apps/api/src/modules/analytics/analytics.service.ts');
    expect(analytics).toBeDefined();

    // R-1 — la DÉCLARATION de la constante n'existe plus.
    //
    // Le motif vise la déclaration, pas le nom nu : `CLASSIFIED` porte la
    // source BRUTE, commentaires compris, et le correctif a laissé au-dessus du
    // KPI une phrase qui CITE la constante pour expliquer sa disparition. Une
    // assertion sur le nom nu rougirait donc sur sa propre explication, et le
    // réflexe suivant serait d'effacer la phrase — c'est-à-dire la seule trace
    // lisible du défaut. La version rigoureuse, qui RETIRE les commentaires
    // avant de juger, vit dans `alert-rule-catalogue-gate.spec.ts`.
    expect(analytics!.source).not.toMatch(/static\s+DEFAULT_ALERT_RULES/);

    // R-2 — et le KPI passe par LA dérivation partagée. Sans cette moitié, R-1
    // serait satisfaite en renommant simplement la constante.
    expect(analytics!.source).toContain('countEnabledAlertRules');

    // R-3 — anti-vacuité. Si le classifieur cessait un jour de lire ce fichier,
    // R-1 passerait sur une chaîne vide et le cliquet deviendrait décoratif.
    expect(analytics!.source.length).toBeGreaterThan(10_000);
    expect(analytics!.source).toContain('adminDashboard');
  });
});
