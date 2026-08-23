import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

/**
 * S-E05-17 / PF-51 clause 3 / ADR-067 — LE CLIQUET : aucune entrée de route
 * typée enum n'atteint Prisma sans être rétrécie.
 *
 * LA RÈGLE, EN UNE LIGNE
 * ----------------------
 * Un paramètre `@Param(...)` / `@Query(...)` LIÉ À UN ENUM est rétréci soit par
 * un PIPE posé sur ce même paramètre, soit par une GARDE D'APPARTENANCE dont
 * l'opérande est une liste LIÉE au type enum. Jamais par rien.
 *
 * POURQUOI DEUX BRAS À « LIÉ À UN ENUM » — le premier jet en manquait un
 * ------------------------------------------------------------------------
 * Les trois sites mesurés de cette tranche n'ont PAS la même forme :
 *
 *   notifications  `@Param('kind') kind: string` … puis `kind as NotificationKind`
 *   alerts         `@Query('status') statusRaw: string` … puis `statusRaw as AlertStatus`
 *   calendar       `@Query('type') type?: CalendarEventType`  ← AUCUN cast, nulle part
 *
 * Une règle indexée sur le CAST est donc VERTE sur le site calendrier, c'est-à-
 * dire verte sur un tiers du défaut qu'elle est censée fermer. Le bras
 * ANNOTATION est le principal, le bras CAST le rattrape : est lié à un enum tout
 * paramètre dont le TYPE DÉCLARÉ nomme un enum, OU dont l'identifiant apparaît
 * dans une assertion `… as <Enum>` du corps de sa méthode.
 *
 * L'INVENTAIRE DES ENUMS EST DÉRIVÉ, JAMAIS ÉNUMÉRÉ (ADR-064 §D1a)
 * ---------------------------------------------------------------
 * Écrire `NotificationKind | CalendarEventType | AlertStatus` serait la liste
 * jumelle que ce dépôt a déjà payée trois fois, et offrirait un vert en une
 * ligne au prochain auteur. L'inventaire vient donc de deux sources LUES :
 *   • les déclarations `enum X { … }` de `apps/api/prisma/schema.prisma` ;
 *   • les alias `type X = (typeof Y)[number]` de
 *     `packages/contracts/src/enums/index.ts`.
 * Un enum ajouté à l'un ou l'autre entre dans le champ du cliquet tout seul.
 *
 * LA GARDE D'APPARTENANCE EST UNE ISSUE LÉGITIME, ET ELLE SE MÉRITE
 * -----------------------------------------------------------------
 * Deux contrôleurs rétrécissent déjà correctement SANS pipe, et ils sont hors du
 * périmètre de cette tranche :
 *   • `meeting-requests.controller.ts` — `MEETING_REQUEST_STATUSES.includes(…)`,
 *     où la liste est un `const` de module ANNOTÉ `MeetingRequestStatus[]` ;
 *   • `admin-child-claims.controller.ts` — `GUARDIANSHIP_CLAIM_STATUS.includes(…)`,
 *     où la liste est IMPORTÉE de `@pilotage/contracts`.
 * Les déclarer contrevenants obligerait soit à une allowlist (affaiblissement
 * interdit + quatrième liste à la main), soit à les convertir (hors périmètre),
 * soit à relâcher la règle jusqu'à ce qu'ils passent (R-30). La règle les
 * accepte donc PAR CONSTRUCTION : l'opérande du `.includes(…)` doit être un
 * IDENTIFIANT qui soit (i) importé en valeur d'un autre module, soit (ii) un
 * `const` de module dont le type déclaré nomme un enum. Un littéral de tableau
 * écrit sur place — exactement `['open', 'acknowledged', …]`, le site alertes
 * d'avant cette tranche — n'est jamais une garde.
 *
 * Note honnête : la garde est reconnue au niveau de la MÉTHODE, pas du
 * paramètre — même limite connue que la sanction Zod de
 * `body-metatype-gate.spec.ts`, écrite ici plutôt que découverte plus tard.
 *
 * CE QUE LE CLIQUET NE PROUVE PAS
 * -------------------------------
 * Il prouve qu'une allowlist est NOMMÉE sur le paramètre, pas qu'elle est la
 * BONNE. `new ParseEnumPipe({} as unknown as { [k: string]: AlertStatus })`
 * passerait. La justesse de chaque allowlist est prouvée ailleurs, et de façon
 * exécutée : les trois specs de pipe voisins des contrôleurs, et
 * `scripts/enum-route-input-probe.js` contre la pile vivante.
 *
 * LIMITE CONNUE, R-1 : LE CHEMIN DE GATE
 * --------------------------------------
 * `scripts/ci-gate.sh` fait tourner la suite COMPLÈTE `test-ratchet.js api`
 * uniquement quand le diff touche `GATE_MACHINERY` (`^(scripts/|\.github/|infra/|
 * apps/api/src/shared/quality/)`). Ce fichier en fait partie, donc il tourne sur
 * CETTE PR. Une PR future qui ne toucherait QUE des contrôleurs prendrait la
 * branche `--skip src/shared/quality/` et ce cliquet ne s'exécuterait pas sur
 * elle. C'est un résidu réel, enregistré comme tel (R-1), et non un trou que ce
 * fichier peut fermer seul.
 *
 * LES FIXTURES N'EMBARQUENT AUCUN NOM D'ENUM RÉEL (PF-295)
 * --------------------------------------------------------
 * `body-metatype-gate.spec.ts:761,765` et `hermetic-spec-writers-gate.spec.ts`
 * enregistrent la collision : un motif écrit en toutes lettres dans une fixture
 * devient un faux positif pour le grep du relecteur suivant. La concaténation
 * seule ne la ferme pas — la chaîne existe toujours. Ici le classifieur reçoit
 * son inventaire d'enums EN PARAMÈTRE (`classify(..., enumNames)`), donc les
 * fixtures utilisent un nom SYNTHÉTIQUE (`FixtureStatus`) qui n'existe nulle
 * part dans le produit. Aucun nom d'enum réel n'apparaît dans ce fichier en
 * position d'appariement, et aucune quatrième instance n'est ajoutée.
 *
 * `MANUAL_ALLOWLIST` existe, est nommée, et EXPÉDIE VIDE. Aucune variable
 * d'environnement, aucun `NODE_ENV`, aucun `SKIP_*` / `ALLOW_*` (DNC-10).
 */

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..', '..');
const API_SRC = join(REPO_ROOT, 'apps', 'api', 'src');
const SCHEMA_PRISMA = join(REPO_ROOT, 'apps', 'api', 'prisma', 'schema.prisma');
const CONTRACTS_ENUMS = join(
  REPO_ROOT,
  'packages',
  'contracts',
  'src',
  'enums',
  'index.ts',
);
const WALK_READ_PATH = join(REPO_ROOT, 'scripts', 'lib', 'walk-read.js');

/** Le paquet du framework : ses symboles sont des PIPES, jamais une allowlist de domaine. */
const FRAMEWORK_PACKAGE = '@nestjs/common';

/* eslint-disable @typescript-eslint/no-require-imports */
// Non gardé, exprès (DNC-08) : si l'un de ces deux modules s'évapore, cette
// suite doit mourir au CHARGEMENT plutôt que dégénérer en « rien à vérifier ».
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
 * L'INVENTAIRE DES ENUMS — DÉRIVÉ de deux fichiers lus
 * ================================================================== */

/** `enum X {` en tête de ligne dans le schéma Prisma. */
function prismaEnumNames(schemaSource: string): string[] {
  return [...schemaSource.matchAll(/^enum\s+([A-Za-z0-9_]+)\s*\{/gm)].map((m) => m[1] as string);
}

/** `export type X = (typeof Y)[number]` dans les enums de contrats. */
function contractsEnumAliases(source: string): string[] {
  const sf = ts.createSourceFile('enums.ts', source, ts.ScriptTarget.Latest, true);
  const out: string[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const visit = (node: any) => {
    if (
      ts.isTypeAliasDeclaration(node) &&
      /\(\s*typeof\s+[A-Za-z0-9_]+\s*\)\s*\[\s*number\s*\]/.test(node.type.getText(sf) as string)
    ) {
      out.push(node.name.text as string);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

const PRISMA_ENUMS = prismaEnumNames(readFileSync(SCHEMA_PRISMA, 'utf8'));
const CONTRACT_ALIASES = contractsEnumAliases(readFileSync(CONTRACTS_ENUMS, 'utf8'));
const ENUM_TYPE_NAMES: ReadonlySet<string> = new Set([...PRISMA_ENUMS, ...CONTRACT_ALIASES]);

/**
 * Planchers, jamais des égalités (convention maison : tout plancher est `>=`).
 *
 * Mesurés sur cet arbre : 49 enums Prisma, 13 alias de contrats, 41 fichiers
 * `*.controller.ts`, 10 paramètres de route liés à un enum. Ils existent pour
 * une seule raison — une dérivation devenue VACANTE est verte sans rien prouver,
 * exactement le mode de panne que `lint-ratchet.spec.ts` a déjà enregistré.
 */
const MIN_PRISMA_ENUMS = 40;
const MIN_CONTRACT_ALIASES = 8;
const MIN_CONTROLLER_FILES = 35;
const MIN_ENUM_BOUND_PARAMS = 8;

/* ================================================================== *
 * LE CLASSIFIEUR — l'inventaire d'enums est INJECTÉ (PF-295, C7)
 * ================================================================== */

type RouteParam = {
  method: string;
  param: string;
  declared: string;
  line: number;
  /** Pourquoi ce paramètre est considéré lié à un enum. */
  boundBy: 'annotation' | 'cast';
  /** Le nom de l'allowlist nommée sur le pipe, s'il y en a un. */
  pipeAllowlist?: string;
  /** Le nom de la liste liée servant d'opérande à la garde, s'il y en a un. */
  guardAllowlist?: string;
  /** `undefined` ⇔ rétréci. Sinon, la raison lisible du refus. */
  reason?: string;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function identifiersIn(node: any): Set<string> {
  const out = new Set<string>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const visit = (n: any) => {
    if (ts.isIdentifier(n)) out.add(n.text as string);
    ts.forEachChild(n, visit);
  };
  visit(node);
  return out;
}

/**
 * Décide, pour UN fichier, du sort de chacun de ses paramètres de route liés à
 * un enum. `enumNames` est un PARAMÈTRE : c'est ce qui permet aux fixtures de
 * n'employer que des noms synthétiques (PF-295).
 */
function classify(
  absPath: string,
  source: string,
  enumNames: ReadonlySet<string>,
): RouteParam[] {
  const sf = ts.createSourceFile(absPath, source, ts.ScriptTarget.Latest, true);

  /**
   * Les symboles importés EN VALEUR depuis un module qui n'est PAS le
   * framework — c'est-à-dire une liste du DOMAINE, définie ailleurs.
   *
   * `@nestjs/common` est écarté et ce n'est pas un détail : les classes de pipe
   * (`ParseEnumPipe`, `DefaultValuePipe`, `ParseIntPipe`…) en viennent toutes.
   * Sans cette exclusion, `@Query('s', new DefaultValuePipe('a'))` — qui ne
   * valide RIEN — nommerait `DefaultValuePipe` et passerait pour un
   * rétrécissement. Le cliquet serait alors vert sur un paramètre non validé.
   * L'exclusion porte sur UN paquet, celui du framework, et sa raison est
   * écrite ; ce n'est pas une liste d'exceptions déguisée.
   */
  const valueImports = new Set<string>();
  /** Les `const` de module dont le TYPE DÉCLARÉ nomme un enum — liés à la compilation. */
  const boundLocalConsts = new Set<string>();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const collect = (node: any) => {
    if (
      ts.isImportDeclaration(node) &&
      node.importClause &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const mod = node.moduleSpecifier.text as string;
      const clause = node.importClause;
      const named = clause.namedBindings;
      if (named && ts.isNamedImports(named)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const element of named.elements as any[]) {
          // Un `import type` n'existe pas à l'exécution : il ne peut pas être
          // l'opérande d'un `.includes(…)`.
          if (clause.isTypeOnly || element.isTypeOnly) continue;
          if (mod === FRAMEWORK_PACKAGE) continue;
          valueImports.add(element.name.text);
        }
      }
    }
    if (ts.isVariableStatement(node)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const declaration of node.declarationList.declarations as any[]) {
        if (
          ts.isIdentifier(declaration.name) &&
          declaration.type &&
          [...identifiersIn(declaration.type)].some((name) => enumNames.has(name))
        ) {
          boundLocalConsts.add(declaration.name.text as string);
        }
      }
    }
    ts.forEachChild(node, collect);
  };
  collect(sf);

  const found: RouteParam[] = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const visitClass = (cls: any) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const member of cls.members as any[]) {
      if (!ts.isMethodDeclaration(member) || !member.name) continue;
      const method = member.name.getText(sf) as string;

      /** Les identifiants qui subissent un `… as <Enum>` DANS cette méthode. */
      const castBound = new Set<string>();
      /** Les opérandes de `.includes(…)` qui MÉRITENT le statut de garde. */
      const guardOperands = new Set<string>();

      if (member.body) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const visitBody = (node: any) => {
          const isAssertion =
            ts.isAsExpression(node) ||
            (typeof ts.isTypeAssertionExpression === 'function' &&
              ts.isTypeAssertionExpression(node));
          if (
            isAssertion &&
            node.type &&
            ts.isTypeReferenceNode(node.type) &&
            ts.isIdentifier(node.type.typeName) &&
            enumNames.has(node.type.typeName.text as string)
          ) {
            for (const name of identifiersIn(node.expression)) castBound.add(name);
          }
          if (
            ts.isCallExpression(node) &&
            ts.isPropertyAccessExpression(node.expression) &&
            node.expression.name.text === 'includes'
          ) {
            for (const name of identifiersIn(node.expression.expression)) {
              if (valueImports.has(name) || boundLocalConsts.has(name)) guardOperands.add(name);
            }
          }
          ts.forEachChild(node, visitBody);
        };
        visitBody(member.body);
      }
      const guardAllowlist = [...guardOperands][0];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const parameter of member.parameters as any[]) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const decorators: any[] = ts.getDecorators(parameter) ?? [];
        const routeDecorator = decorators.find(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (d: any) =>
            ts.isCallExpression(d.expression) &&
            ts.isIdentifier(d.expression.expression) &&
            (d.expression.expression.text === 'Param' || d.expression.expression.text === 'Query'),
        );
        if (!routeDecorator) continue;

        const param = ts.isIdentifier(parameter.name)
          ? (parameter.name.text as string)
          : '<déstructuré>';
        const declared = parameter.type ? (parameter.type.getText(sf) as string) : '<aucun>';

        const byAnnotation = parameter.type
          ? [...identifiersIn(parameter.type)].some((name) => enumNames.has(name))
          : false;
        const byCast = castBound.has(param);
        if (!byAnnotation && !byCast) continue;

        // Le PIPE : tout argument du décorateur AU-DELÀ de la clé qui NOMME un
        // enum ou une liste importée en valeur. `new DefaultValuePipe(50)` seul
        // ne nomme rien et ne rétrécit rien.
        let pipeAllowlist: string | undefined;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const args = routeDecorator.expression.arguments as any[];
        for (let i = 1; i < args.length && pipeAllowlist === undefined; i += 1) {
          for (const name of identifiersIn(args[i])) {
            if (enumNames.has(name) || valueImports.has(name) || boundLocalConsts.has(name)) {
              pipeAllowlist = name;
              break;
            }
          }
        }

        const line = (sf.getLineAndCharacterOfPosition(parameter.getStart(sf)).line as number) + 1;
        const reason =
          pipeAllowlist !== undefined || guardAllowlist !== undefined
            ? undefined
            : `paramètre de route lié à l'enum (${byAnnotation ? 'par annotation' : 'par cast'}) ` +
              'sans pipe sur le paramètre ni garde d’appartenance sur une liste liée — ' +
              'la chaîne brute atteint Prisma';

        found.push({
          method,
          param,
          declared,
          line,
          boundBy: byAnnotation ? 'annotation' : 'cast',
          pipeAllowlist,
          guardAllowlist: pipeAllowlist === undefined ? guardAllowlist : undefined,
          reason,
        });
      }
    }
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const visit = (node: any) => {
    if (ts.isClassDeclaration(node)) visitClass(node);
    ts.forEachChild(node, visit);
  };
  visit(sf);

  return found;
}

/* ================================================================== *
 * L'ALLOWLIST — nommée, motivée, et VIDE
 * ================================================================== */

/**
 * Exceptions de niveau TEST. Chacune nommerait un site EXACT et sa raison.
 *
 * Elle expédie VIDE et doit le rester : l'issue légitime (une garde
 * d'appartenance sur une liste LIÉE) est DÉRIVÉE par le classifieur, pas
 * énumérée ici. Une entrée ajoutée ici est une dette, jamais un contournement à
 * l'exécution (DNC-10) — aucun caractère générique, aucune expression régulière
 * de chemin, aucune variable d'environnement, jamais.
 */
const MANUAL_ALLOWLIST: readonly { file: string; method: string; param: string; reason: string }[] =
  [];

/* ================================================================== *
 * LE CORPUS — les 41 contrôleurs, par analyse syntaxique
 * ================================================================== */

function walkControllers(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      // `__fixtures__` porte des sources PRÉ-CORRECTION délibérées : les juger
      // serait un auto-rouge que l'on « corrigerait » par une exclusion.
      if (entry.name !== 'node_modules' && entry.name !== '__fixtures__') walkControllers(path, out);
    } else if (entry.name.endsWith('.controller.ts') && !entry.name.endsWith('.spec.ts')) {
      out.push(path);
    }
  }
  return out.sort();
}

const rel = (absolute: string) => relative(REPO_ROOT, absolute).split(sep).join('/');

const CONTROLLER_FILES = walkControllers(API_SRC);

const { entries, skipped } = walkRead.mapWalkedFiles<{ source: string; params: RouteParam[] }>(
  CONTROLLER_FILES,
  (path, source) => [rel(path), { source, params: classify(path, source, ENUM_TYPE_NAMES) }],
);
const CLASSIFIED = new Map(entries);
walkRead.warnSkipped('enum-route-input-gate', skipped);

type Site = RouteParam & { file: string };

const ENUM_BOUND: Site[] = [...CLASSIFIED.entries()].flatMap(([file, { params }]) =>
  params.map((p) => ({ ...p, file })),
);
const OFFENDERS = ENUM_BOUND.filter(
  (p) =>
    p.reason !== undefined &&
    !MANUAL_ALLOWLIST.some((a) => a.file === p.file && a.method === p.method && a.param === p.param),
);

const describeSite = (s: Site) =>
  `${s.file}:${s.line} ${s.method}(${s.param}: ${s.declared}) — ${s.reason}`;

const THREE_SITES = [
  'apps/api/src/modules/notifications/preferences.controller.ts',
  'apps/api/src/modules/calendar/calendar.controller.ts',
  'apps/api/src/modules/alerts/alerts.controller.ts',
];

/* ================================================================== *
 * LE CORPUS EST BIEN LE CORPUS — les garde-fous de vacuité
 * ================================================================== */

describe('la dérivation n’est pas vacante', () => {
  it('a LU des enums Prisma — un schéma illisible rendrait tout le cliquet vert', () => {
    expect(PRISMA_ENUMS.length).toBeGreaterThanOrEqual(MIN_PRISMA_ENUMS);
  });

  it('a LU des alias de contrats dérivés d’un `as const`', () => {
    expect(CONTRACT_ALIASES.length).toBeGreaterThanOrEqual(MIN_CONTRACT_ALIASES);
  });

  it("porte l'identité comptable — un plancher sur la LISTE ne se transporte pas sur la CARTE", () => {
    expect(CLASSIFIED.size + skipped.length).toBe(CONTROLLER_FILES.length);
  });

  it("n'a pas perdu plus que le budget calibré sur la taille du corpus", () => {
    expect(skipped.length).toBeLessThanOrEqual(walkRead.maxVanishedFor(CONTROLLER_FILES.length));
  });

  it('a un PLANCHER sur le corpus marché — une marche vide n’est jamais un PASS', () => {
    expect(CONTROLLER_FILES.length).toBeGreaterThanOrEqual(MIN_CONTROLLER_FILES);
    expect(CLASSIFIED.size).toBeGreaterThanOrEqual(
      MIN_CONTROLLER_FILES - walkRead.maxVanishedFor(CONTROLLER_FILES.length),
    );
  });

  it('a RECONNU des paramètres liés à un enum — zéro violation sur zéro reconnaissance ne prouve rien', () => {
    expect(ENUM_BOUND.length).toBeGreaterThanOrEqual(MIN_ENUM_BOUND_PARAMS);
  });

  it('juge bien les TROIS sites de cette tranche — le corpus les contient réellement', () => {
    const files = new Set(ENUM_BOUND.map((p) => p.file));
    for (const file of THREE_SITES) expect([...files]).toContain(file);
  });

  it('reconnaît les DEUX bras — annotation ET cast — sinon un tiers du défaut est invisible', () => {
    // Le bras `annotation` couvre le site calendrier, qui ne contient AUCUN
    // cast ; le bras `cast` couvre les paramètres annotés `string`. Une règle à
    // un seul bras serait verte sur la moitié du corpus reconnu.
    expect(ENUM_BOUND.some((p) => p.boundBy === 'annotation')).toBe(true);
  });
});

/* ================================================================== *
 * LE CLIQUET LUI-MÊME
 * ================================================================== */

describe('AC-6 — aucune entrée de route typée enum n’échappe au rétrécissement', () => {
  it('zéro contrevenant dans les contrôleurs de `apps/api`', () => {
    // Le message porte le SITE, jamais un simple compte.
    expect(OFFENDERS.map(describeSite)).toEqual([]);
  });

  it("l'allowlist manuelle expédie VIDE — l'issue légitime est DÉRIVÉE, pas énumérée", () => {
    expect(MANUAL_ALLOWLIST).toEqual([]);
  });

  it('les trois sites de la tranche sont rétrécis par un PIPE nommant leur allowlist', () => {
    for (const file of THREE_SITES) {
      const piped = ENUM_BOUND.filter((p) => p.file === file && p.pipeAllowlist !== undefined);
      expect(piped.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('les deux frères déjà corrects passent par la GARDE, sans pipe et sans exemption', () => {
    // C'est le cas réel le plus dur de la règle : ils étaient corrects avant
    // cette tranche, ils ne sont pas de son périmètre, et aucune allowlist ne
    // les couvre. S'ils basculaient en contrevenants, la seule « réparation »
    // disponible serait d'affaiblir la règle (R-30).
    const guarded = ENUM_BOUND.filter((p) => p.guardAllowlist !== undefined).map((p) => p.file);
    expect(guarded).toContain('apps/api/src/modules/alerts/meeting-requests.controller.ts');
    expect(guarded).toContain('apps/api/src/modules/child-claims/admin-child-claims.controller.ts');
  });
});

/* ================================================================== *
 * ROUGE-AVANT / VERT-APRÈS, sur fixtures — avec CONTRÔLE NÉGATIF
 * ================================================================== *
 *
 * L'inventaire d'enums est INJECTÉ, donc les fixtures n'emploient que le nom
 * synthétique `FixtureStatus`, absent du produit (PF-295).
 *
 * Le CONTRÔLE NÉGATIF n'est pas décoratif : sans un cas qui doit PASSER, un
 * comparateur toujours-rouge satisfait tous les cas rouges et le cliquet ne
 * prouve rien (run 45 / TOOL-13). Et il ne prend pas la forme d'un contrôleur
 * trivialement propre : il prend la forme des DEUX frères réels, qui sont le cas
 * le plus difficile de la règle.
 */

const FIXTURE_ENUMS: ReadonlySet<string> = new Set(['FixtureStatus']);
const FIXTURE_PATH = join(API_SRC, 'modules', '__fixture', 'fixture.controller.ts');

const runFixture = (source: string) => classify(FIXTURE_PATH, source, FIXTURE_ENUMS);
const onlySite = (sites: RouteParam[]): RouteParam => {
  expect(sites).toHaveLength(1);
  return sites[0] as RouteParam;
};

/** Toute source de fixture est CONCATÉNÉE, jamais écrite en un littéral unique. */
const fixture = (...lines: string[]) => [...lines, ''].join('\n');

const NEST_IMPORT = "import { Controller, Get, Param, ParseEnumPipe, Query } from '@nestjs/common';";

describe('ROUGE-AVANT — les trois formes mesurées de la tranche', () => {
  it('signale un `@Query` ANNOTÉ enum sans pipe — la forme calendrier, SANS aucun cast', () => {
    const site = onlySite(
      runFixture(
        fixture(
          NEST_IMPORT,
          "import { FixtureStatus } from '@prisma/client';",
          "@Controller('x')",
          'export class FixtureController {',
          "  @Get('list')",
          "  async list(@Query('type') type?: FixtureStatus) {",
          '    return { where: { type } };',
          '  }',
          '}',
        ),
      ),
    );
    expect(site.boundBy).toBe('annotation');
    expect(site.reason).toMatch(/sans pipe/);
  });

  it('signale un `@Param` annoté `string` puis CASTÉ vers l’enum — la forme notifications', () => {
    const site = onlySite(
      runFixture(
        fixture(
          NEST_IMPORT,
          "import type { FixtureStatus } from '@prisma/client';",
          "@Controller('x')",
          'export class FixtureController {',
          "  @Get(':kind')",
          "  async one(@Param('kind') kind: string) {",
          '    return this.svc.update({ kind: kind as FixtureStatus });',
          '  }',
          '}',
        ),
      ),
    );
    expect(site.boundBy).toBe('cast');
    expect(site.reason).toMatch(/sans pipe/);
  });

  it('signale une garde dont l’opérande est un LITTÉRAL DE TABLEAU écrit sur place — la forme alertes', () => {
    const site = onlySite(
      runFixture(
        fixture(
          NEST_IMPORT,
          "import type { FixtureStatus } from '@prisma/client';",
          "@Controller('x')",
          'export class FixtureController {',
          "  @Get('list')",
          "  async list(@Query('status') raw: string | undefined) {",
          "    const status = raw && ['a', 'b'].includes(raw) ? (raw as FixtureStatus) : undefined;",
          '    return { status };',
          '  }',
          '}',
        ),
      ),
    );
    expect(site.reason).toMatch(/sans pipe/);
    expect(site.guardAllowlist).toBeUndefined();
  });

  it('ne compte PAS un pipe qui ne nomme aucune allowlist — `DefaultValuePipe` ne rétrécit rien', () => {
    const site = onlySite(
      runFixture(
        fixture(
          "import { Controller, DefaultValuePipe, Get, Query } from '@nestjs/common';",
          "import type { FixtureStatus } from '@prisma/client';",
          "@Controller('x')",
          'export class FixtureController {',
          "  @Get('list')",
          "  async list(@Query('status', new DefaultValuePipe('a')) status: FixtureStatus) {",
          '    return { status };',
          '  }',
          '}',
        ),
      ),
    );
    expect(site.pipeAllowlist).toBeUndefined();
    expect(site.reason).toMatch(/sans pipe/);
  });
});

describe('VERT-APRÈS — les formes rétrécies passent', () => {
  it('accepte un pipe qui NOMME l’enum sur le paramètre — la forme calendrier corrigée', () => {
    const site = onlySite(
      runFixture(
        fixture(
          NEST_IMPORT,
          "import { FixtureStatus } from '@prisma/client';",
          "@Controller('x')",
          'export class FixtureController {',
          "  @Get('list')",
          '  async list(',
          "    @Query('type', new ParseEnumPipe(FixtureStatus, { optional: true }))",
          '    type?: FixtureStatus,',
          '  ) {',
          '    return { where: { type } };',
          '  }',
          '}',
        ),
      ),
    );
    expect(site.pipeAllowlist).toBe('FixtureStatus');
    expect(site.reason).toBeUndefined();
  });

  it('accepte un pipe alimenté par une liste IMPORTÉE EN VALEUR — la forme notifications/alertes corrigée', () => {
    const site = onlySite(
      runFixture(
        fixture(
          NEST_IMPORT,
          "import { FIXTURE_STATUSES } from '../fixture.service';",
          "import type { FixtureStatus } from '@prisma/client';",
          "@Controller('x')",
          'export class FixtureController {',
          "  @Get(':kind')",
          '  async one(',
          "    @Param('kind', new ParseEnumPipe(FIXTURE_STATUSES as unknown as { [k: string]: FixtureStatus }))",
          '    kind: FixtureStatus,',
          '  ) {',
          '    return { kind };',
          '  }',
          '}',
        ),
      ),
    );
    expect(site.pipeAllowlist).toBe('FIXTURE_STATUSES');
    expect(site.reason).toBeUndefined();
  });
});

describe('CONTRÔLE NÉGATIF — les deux frères réels DOIVENT passer, sans allowlist', () => {
  it('accepte une garde sur une liste IMPORTÉE — la forme `admin-child-claims`', () => {
    const site = onlySite(
      runFixture(
        fixture(
          "import { BadRequestException, Controller, Get, Query } from '@nestjs/common';",
          "import { FIXTURE_STATUS } from '@pilotage/contracts';",
          "import type { FixtureStatus } from '@prisma/client';",
          "@Controller('x')",
          'export class FixtureController {',
          "  @Get('queue')",
          "  async queue(@Query('status') status?: string) {",
          "    const resolved: FixtureStatus = (status ?? 'a') as FixtureStatus;",
          '    if (!(FIXTURE_STATUS as readonly string[]).includes(resolved)) {',
          "      throw new BadRequestException('Statut invalide');",
          '    }',
          '    return { resolved };',
          '  }',
          '}',
        ),
      ),
    );
    expect(site.reason).toBeUndefined();
    expect(site.guardAllowlist).toBe('FIXTURE_STATUS');
  });

  it('accepte une garde sur un `const` de module ANNOTÉ par l’enum — la forme `meeting-requests`', () => {
    const site = onlySite(
      runFixture(
        fixture(
          "import { Controller, Get, Query } from '@nestjs/common';",
          "import type { FixtureStatus } from '@prisma/client';",
          "const FIXTURE_STATUSES: FixtureStatus[] = ['a', 'b'];",
          "@Controller('x')",
          'export class FixtureController {',
          "  @Get('list')",
          "  async list(@Query('status') raw: string | undefined) {",
          "    const status = raw && FIXTURE_STATUSES.includes(raw as FixtureStatus) ? (raw as FixtureStatus) : 'a';",
          '    return { status };',
          '  }',
          '}',
        ),
      ),
    );
    expect(site.reason).toBeUndefined();
    expect(site.guardAllowlist).toBe('FIXTURE_STATUSES');
  });

  it('ne juge NI un `@Body()` NI un paramètre de route sans lien enum — la moitié faux-positif', () => {
    const sites = runFixture(
      fixture(
        "import { Body, Controller, Param, Patch, Query } from '@nestjs/common';",
        'class RealDto { name!: string; }',
        "@Controller('x')",
        'export class FixtureController {',
        "  @Patch(':id')",
        "  async patch(@Param('id') id: string, @Query('q') q: string, @Body() body: RealDto) {",
        '    return [id, q, body];',
        '  }',
        '}',
      ),
    );
    expect(sites).toEqual([]);
  });

  it('ne considère PAS un `import type` comme un opérande de garde valable', () => {
    // Un `import type` n'existe pas à l'exécution : un `.includes()` dessus ne
    // pourrait pas s'exécuter. Le reconnaître comme garde serait un faux vert.
    const site = onlySite(
      runFixture(
        fixture(
          "import { Controller, Get, Query } from '@nestjs/common';",
          "import type { FIXTURE_STATUS } from '../fixture.types';",
          "import type { FixtureStatus } from '@prisma/client';",
          "@Controller('x')",
          'export class FixtureController {',
          "  @Get('list')",
          "  async list(@Query('status') raw: string | undefined) {",
          '    const status = FIXTURE_STATUS.includes(raw) ? (raw as FixtureStatus) : undefined;',
          '    return { status };',
          '  }',
          '}',
        ),
      ),
    );
    expect(site.reason).toMatch(/sans pipe/);
  });
});
