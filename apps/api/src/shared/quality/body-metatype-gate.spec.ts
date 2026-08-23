import 'reflect-metadata';

import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';

import { AcademicYearsController } from '../../modules/school-structure/academic-years.controller';
import { CyclesController } from '../../modules/school-structure/cycles.controller';

/**
 * S-E05-13 / PF-51 / ADR-064 — LE CLIQUET : aucun corps de requête ne s'efface
 * en `Object`.
 *
 * LA RÈGLE, EN UNE LIGNE
 * ----------------------
 * Un `@Body()` est annoté par une CLASSE, ou bien il est validé par un schéma
 * Zod partagé. Jamais rien d'autre. `ADR-064` enregistre la décision ; ce
 * fichier en est la moitié EXÉCUTÉE.
 *
 * LE MÉCANISME (mesuré sur l'artefact livré, pas déduit)
 * ------------------------------------------------------
 * `packages/tsconfig/node.json` pose `emitDecoratorMetadata: true`, donc le
 * compilateur écrit les types de paramètres dans `design:paramtypes`. Une CLASSE
 * y survit ; une EXPRESSION DE TYPE non. Avant cette tranche,
 * `apps/api/dist/modules/school-structure/cycles.controller.js` portait
 *
 *     createGradeLevel → [String, GradeLevelDto, Object]
 *     updateGradeLevel → [String, Object,        Object]
 *
 * et `ValidationPipe.toValidate()` rend `false` pour `Object` : le pipe global
 * de `main.ts:141-145` (`transform`, `whitelist`, `forbidNonWhitelisted`)
 * n'était pas indulgent sur cette route, il était SAUTÉ, et le corps repartait
 * BRUT vers `prisma.gradeLevel.update({ data: body })`.
 *
 * `Partial<T>` n'est pas seul dans ce cas. Un `interface`, un alias `type`, une
 * union, `unknown`, `any`, `Pick<>`, `Omit<>`, `Record<>` et un littéral d'objet
 * s'effacent TOUS en `Object`. C'est pourquoi ce cliquet ne cherche pas
 * `Partial<` : il exige positivement une CLASSE.
 *
 * POURQUOI UNE COUCHE STATIQUE (A) *ET* UNE COUCHE PAR RÉFLEXION (B)
 * ------------------------------------------------------------------
 * La réflexion est le meilleur oracle — c'est littéralement le mécanisme. Mais
 * elle exige de CHARGER la classe, et `boot-gate.spec.ts:26-33` a déjà écrit
 * pourquoi on ne charge pas les 41 contrôleurs sous jest : importer largement
 * tire `AuthModule → JwtStrategy → jwks-rsa → jose`, et `jose@6` est ESM-only —
 * la suite meurt au CHARGEMENT, avant la première assertion (vérifié par sonde
 * pendant `S-E02-9`). Un `try/catch` par fichier transformerait cet échec en
 * saut silencieux, ce qui est exactement le trou (DNC-08).
 *
 * D'où la division du travail :
 *   • COUCHE A — le corpus ENTIER, par ANALYSE SYNTAXIQUE. Elle mesure la
 *     source, donc elle voit les 41 contrôleurs sans en charger aucun.
 *   • COUCHE B — les DEUX contrôleurs réparés, par RÉFLEXION réelle
 *     (`design:paramtypes` + `__routeArguments__`), plus un CONTRÔLE POSITIF
 *     sur un site déjà correct. C'est elle qui prouve que la couche A modélise
 *     le vrai mécanisme et pas une théorie.
 * Aucune des deux ne remplace l'autre, et ce fichier ne prétend jamais avoir
 * booté l'application.
 *
 * ANALYSÉ, JAMAIS GREPPÉ — la doctrine est déjà écrite ici
 * --------------------------------------------------------
 * `hermetic-spec-writers-gate.spec.ts:26-34` la pose : un scan de texte se fait
 * battre par une occurrence dans une CHAÎNE (ce fichier-ci en contient
 * plusieurs, dans ses propres fixtures), et la seule façon de le reverdir est
 * de l'affaiblir — c'est `R-30`. `require('typescript')` est une devDependency
 * racine et deux scripts frères font déjà cela : aucune dépendance et aucune
 * décision d'architecture nouvelle.
 *
 * L'EXEMPTION EST DÉRIVÉE, PAS ÉNUMÉRÉE (DNC-10)
 * ----------------------------------------------
 * Le dépôt fait tourner DEUX styles de validation côté à côté, et le second est
 * légitime : prendre le corps brut et le valider avec un schéma Zod de
 * `@pilotage/contracts` — un contrat PARTAGÉ avec l'application web, ce que la
 * voie class-validator n'offre pas. Ces handlers-là s'effacent en `Object` par
 * construction et ne sont pas le défaut.
 *
 * Les nommer un par un serait la dérive de listes jumelles dont ce dépôt a déjà
 * payé le prix : la liste et le code s'écartent en silence, et il suffit
 * d'ajouter un nom pour faire passer un `Partial<T>`. L'exemption est donc
 * MÉRITÉE, jamais déclarée — un metatype `Object` n'est accepté que si le corps
 * de SA méthode atteint un `.parse(...)` / `.safeParse(...)` dont le récepteur
 * est un symbole importé de `@pilotage/contracts`. Un cinquième handler Zod
 * passera tout seul ; un `Partial<T>` ne passera jamais.
 *
 * `MANUAL_ALLOWLIST` existe, est de forme `{ file, method, param, reason }`, et
 * EXPÉDIE VIDE — c'est une exception de niveau TEST, jamais un contournement à
 * l'exécution (DNC-10). Aucun caractère générique, aucune expression régulière
 * de chemin, aucune variable d'environnement.
 *
 * CE QUI EST ENREGISTRÉ ET NON CORRIGÉ
 * ------------------------------------
 * `PF-286` — les quatre handlers Zod ne traversent JAMAIS le pipe global, donc
 * `whitelist`/`forbidNonWhitelisted` ne s'y appliquent pas : une clé inconnue y
 * est silencieusement RETIRÉE par Zod au lieu d'être refusée en 400. C'est une
 * asymétrie réelle entre les deux styles, elle est mesurée par ce cliquet, et
 * elle n'est pas de cette tranche.
 */

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..', '..');
const API_SRC = join(REPO_ROOT, 'apps', 'api', 'src');
const WALK_READ_PATH = join(REPO_ROOT, 'scripts', 'lib', 'walk-read.js');

/** Le paquet dont un schéma Zod mérite l'exemption — un contrat PARTAGÉ, pas un schéma local. */
const CONTRACTS_PACKAGE = '@pilotage/contracts';

/**
 * Planchers, jamais des égalités (convention maison : tout plancher est `>=`).
 *
 * Mesurés sur cet arbre : 41 fichiers `*.controller.ts`, 77 paramètres
 * `@Body()`. Ils existent pour une seule raison — une marche vide, un glob cassé
 * ou un classifieur qui ne reconnaît plus rien est VERT sans rien prouver.
 */
const MIN_CONTROLLER_FILES = 35;
const MIN_BODY_PARAMS = 70;

/**
 * Le NOMBRE d'exemptions Zod dérivées, épinglé.
 *
 * Ce n'est pas une liste jumelle : c'est le garde-fou de la dérivation qui
 * devient vacante. `lint-ratchet.spec.ts` enregistre exactement ce mode de
 * panne — un bug de commentaire JSONC avait produit « aucun paquet n'émet de
 * métadonnées de décorateur » et la suite était passée VERTE. Si la
 * reconnaissance Zod cesse de fonctionner, ce nombre tombe à 0 et le cliquet le
 * dit ; si un cinquième handler Zod arrive, ce nombre monte et quelqu'un le
 * révise SCIEMMENT. Mesuré ce jour : 3 dans `messaging`, 1 dans `analytics`.
 */
const DERIVED_ZOD_EXCEPTIONS = 4;

/* eslint-disable @typescript-eslint/no-require-imports */
// Non gardé, exprès (DNC-08) : un MODULE MANQUANT est un autre joint qu'un
// FICHIER MARCHÉ QUI DISPARAÎT. Si l'un des deux s'évapore, cette suite doit
// échouer au CHARGEMENT plutôt que dégénérer en « rien à vérifier, donc PASS ».
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
 * LE CLASSIFIEUR — piloté par chaîne dans les preuves rouges
 * ================================================================== */

/** Un `@Body()` dont le type ne peut PAS survivre à `emitDecoratorMetadata`. */
type BodyParam = {
  method: string;
  param: string;
  declared: string;
  line: number;
  /** `undefined` ⇔ le type est une CLASSE, donc le pipe global s'appliquera. */
  reason?: string;
  /** Le symbole Zod qui MÉRITE l'exemption, s'il y en a un. */
  sanctioningSchema?: string;
};

type Io = { readIfExists: (path: string) => string | undefined };

function defaultIo(): Io {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('node:fs');
  return {
    readIfExists: (path: string) =>
      fs.existsSync(path) ? (fs.readFileSync(path, 'utf8') as string) : undefined,
  };
}

/** Le module `spec` déclare-t-il `class name` ? */
function declaresClass(source: string, name: string): boolean {
  const sf = ts.createSourceFile('module.ts', source, ts.ScriptTarget.Latest, true);
  let found = false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const visit = (node: any) => {
    if (ts.isClassDeclaration(node) && node.name && node.name.text === name) found = true;
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

function resolveRelative(fromFile: string, specifier: string, io: Io): string | undefined {
  const base = resolve(join(fromFile, '..'), specifier);
  for (const candidate of [`${base}.ts`, join(base, 'index.ts')]) {
    const source = io.readIfExists(candidate);
    if (source !== undefined) return source;
  }
  return undefined;
}

/**
 * Décide, pour UN fichier, du sort de chacun de ses `@Body()`.
 *
 * La règle est POSITIVE — « ceci est une classe » — et non négative — « ceci
 * n'est pas `Partial<` ». C'est ce qui fait qu'un alias `type`, une interface,
 * une union, `unknown`, `any` et un littéral tombent tous, sans qu'aucun ait été
 * anticipé nommément.
 */
function classify(absPath: string, source: string, io: Io): BodyParam[] {
  const sf = ts.createSourceFile(absPath, source, ts.ScriptTarget.Latest, true);

  const localClasses = new Set<string>();
  const imports = new Map<string, { mod: string; typeOnly: boolean }>();
  const contractsValueSymbols = new Set<string>();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const collect = (node: any) => {
    if (ts.isClassDeclaration(node) && node.name) localClasses.add(node.name.text);
    if (ts.isImportDeclaration(node) && node.importClause && ts.isStringLiteral(node.moduleSpecifier)) {
      const mod = node.moduleSpecifier.text as string;
      const clause = node.importClause;
      const named = clause.namedBindings;
      if (named && ts.isNamedImports(named)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const element of named.elements as any[]) {
          const typeOnly = Boolean(clause.isTypeOnly || element.isTypeOnly);
          imports.set(element.name.text, { mod, typeOnly });
          // Un `import type` ne survit pas à la compilation : il ne peut pas
          // être le récepteur d'un `.parse()` à l'exécution, donc il ne peut
          // pas mériter l'exemption.
          if (mod === CONTRACTS_PACKAGE && !typeOnly) contractsValueSymbols.add(element.name.text);
        }
      }
    }
    ts.forEachChild(node, collect);
  };
  collect(sf);

  const found: BodyParam[] = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const visitClass = (cls: any) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const member of cls.members as any[]) {
      if (!ts.isMethodDeclaration(member) || !member.name) continue;
      const method = member.name.getText(sf) as string;

      // Les récepteurs de `.parse` / `.safeParse` DANS CETTE MÉTHODE.
      const zodReceivers = new Set<string>();
      if (member.body) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const visitBody = (node: any) => {
          if (
            ts.isCallExpression(node) &&
            ts.isPropertyAccessExpression(node.expression) &&
            (node.expression.name.text === 'parse' || node.expression.name.text === 'safeParse') &&
            ts.isIdentifier(node.expression.expression)
          ) {
            zodReceivers.add(node.expression.expression.text);
          }
          ts.forEachChild(node, visitBody);
        };
        visitBody(member.body);
      }
      const sanctioningSchema = [...zodReceivers].find((name) => contractsValueSymbols.has(name));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const parameter of member.parameters as any[]) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const decorators: any[] = ts.getDecorators(parameter) ?? [];
        const isBody = decorators.some(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (d: any) =>
            ts.isCallExpression(d.expression) &&
            ts.isIdentifier(d.expression.expression) &&
            d.expression.expression.text === 'Body',
        );
        if (!isBody) continue;

        const line = (sf.getLineAndCharacterOfPosition(parameter.getStart(sf)).line as number) + 1;
        const param = ts.isIdentifier(parameter.name)
          ? (parameter.name.text as string)
          : '<déstructuré>';
        const declared = parameter.type ? (parameter.type.getText(sf) as string) : '<aucun>';

        const reason = ((): string | undefined => {
          if (!parameter.type) return 'aucune annotation de type — le metatype est `Object`';
          if (!ts.isTypeReferenceNode(parameter.type)) {
            return `\`${declared}\` n'est pas une référence de type nue (union, littéral, \`unknown\`, \`any\`…) — s'efface en \`Object\``;
          }
          if (!ts.isIdentifier(parameter.type.typeName)) {
            return `\`${declared}\` est un nom qualifié, pas un identifiant nu`;
          }
          if ((parameter.type.typeArguments ?? []).length > 0) {
            return `\`${declared}\` est une EXPRESSION de type générique (\`Partial<>\`, \`Pick<>\`, \`Omit<>\`, \`Record<>\`…) — s'efface en \`Object\``;
          }
          const name = parameter.type.typeName.text as string;
          if (localClasses.has(name)) return undefined;
          const imported = imports.get(name);
          if (!imported) return `\`${name}\` n'est ni déclaré ni importé dans ce fichier`;
          if (imported.typeOnly) {
            return `\`${name}\` arrive par un import \`type\` — un type, jamais une classe`;
          }
          if (!imported.mod.startsWith('.')) {
            return `\`${name}\` vient de \`${imported.mod}\` — hors de l'arbre analysé, impossible de prouver que c'est une classe`;
          }
          const moduleSource = resolveRelative(absPath, imported.mod, io);
          if (moduleSource === undefined) return `\`${imported.mod}\` est introuvable depuis ce fichier`;
          if (!declaresClass(moduleSource, name)) {
            return `\`${name}\` n'est pas déclaré \`class\` dans \`${imported.mod}\``;
          }
          return undefined;
        })();

        found.push({
          method,
          param,
          declared,
          line,
          reason,
          sanctioningSchema: reason ? sanctioningSchema : undefined,
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
 * Exceptions de niveau TEST. Chacune nomme un site EXACT et sa raison.
 *
 * Elle expédie VIDE et doit le rester : l'exemption légitime (un corps validé
 * par un schéma Zod partagé) est DÉRIVÉE plus haut, pas énumérée ici. Une
 * entrée ajoutée ici est une dette, jamais un contournement à l'exécution
 * (DNC-10) — aucun caractère générique, aucune expression régulière de chemin,
 * aucune variable d'environnement, jamais.
 */
const MANUAL_ALLOWLIST: readonly { file: string; method: string; param: string; reason: string }[] =
  [];

/* ================================================================== *
 * COUCHE A — le corpus entier, par analyse syntaxique
 * ================================================================== */

function walkControllers(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      // `__fixtures__` porte des sources PRÉ-CORRECTION délibérées
      // (`shared/audit/__fixtures__/pre-fix/analytics.controller.ts.txt`) : les
      // juger serait un auto-rouge que l'on « corrigerait » par une exclusion
      // qui masquerait aussi du vrai code.
      if (entry.name !== 'node_modules' && entry.name !== '__fixtures__') walkControllers(path, out);
    } else if (entry.name.endsWith('.controller.ts') && !entry.name.endsWith('.spec.ts')) {
      out.push(path);
    }
  }
  return out.sort();
}

const rel = (absolute: string) => relative(REPO_ROOT, absolute).split(sep).join('/');

const CONTROLLER_FILES = walkControllers(API_SRC);

const IO = defaultIo();

// Lu à travers `scripts/lib/walk-read.js` — le joint qui existe précisément
// parce qu'un chemin marché peut disparaître avant d'être lu (TOOL-17).
const { entries, skipped } = walkRead.mapWalkedFiles<{ source: string; params: BodyParam[] }>(
  CONTROLLER_FILES,
  (path, source) => [rel(path), { source, params: classify(path, source, IO) }],
);
const CLASSIFIED = new Map(entries);
walkRead.warnSkipped('body-metatype-gate', skipped);

type Site = BodyParam & { file: string };

const ALL_BODY_PARAMS: Site[] = [...CLASSIFIED.entries()].flatMap(([file, { params }]) =>
  params.map((p) => ({ ...p, file })),
);
const FLAGGED = ALL_BODY_PARAMS.filter((p) => p.reason !== undefined);
const SANCTIONED = FLAGGED.filter((p) => p.sanctioningSchema !== undefined);
const OFFENDERS = FLAGGED.filter(
  (p) =>
    p.sanctioningSchema === undefined &&
    !MANUAL_ALLOWLIST.some((a) => a.file === p.file && a.method === p.method && a.param === p.param),
);

const describeSite = (s: Site) => `${s.file}:${s.line} ${s.method}(@Body() ${s.param}) — ${s.reason}`;

describe('le corpus jugé est bien le corpus marché', () => {
  it("porte l'identité comptable — un plancher sur la LISTE ne se transporte pas sur la CARTE", () => {
    expect(CLASSIFIED.size + skipped.length).toBe(CONTROLLER_FILES.length);
  });

  it("n'a pas perdu plus que le budget calibré sur la taille du corpus", () => {
    expect(skipped.length).toBeLessThanOrEqual(walkRead.maxVanishedFor(CONTROLLER_FILES.length));
  });

  it('a un PLANCHER — une marche vide n’est jamais un PASS', () => {
    expect(CONTROLLER_FILES.length).toBeGreaterThanOrEqual(MIN_CONTROLLER_FILES);
    expect(CLASSIFIED.size).toBeGreaterThanOrEqual(
      MIN_CONTROLLER_FILES - walkRead.maxVanishedFor(CONTROLLER_FILES.length),
    );
  });

  it('a RECONNU des `@Body()` — zéro violation sur zéro reconnaissance ne prouve rien', () => {
    expect(ALL_BODY_PARAMS.length).toBeGreaterThanOrEqual(MIN_BODY_PARAMS);
  });

  it('juge les DEUX contrôleurs réparés — le corpus les contient réellement', () => {
    const files = new Set(ALL_BODY_PARAMS.map((p) => p.file));
    expect(files).toContain('apps/api/src/modules/school-structure/cycles.controller.ts');
    expect(files).toContain('apps/api/src/modules/school-structure/academic-years.controller.ts');
  });
});

/* ================================================================== *
 * LE CLIQUET LUI-MÊME
 * ================================================================== */

describe('AC-8 — aucun `@Body()` ne s’efface en `Object`', () => {
  it('zéro contrevenant dans les 41 contrôleurs', () => {
    // Le message porte le SITE, jamais un simple compte : « je ne peux pas
    // dire » est le même échec que DNC-08 refuse, une couche plus haut.
    expect(OFFENDERS.map(describeSite)).toEqual([]);
  });

  it("l'allowlist manuelle expédie VIDE — l'exemption légitime est DÉRIVÉE, pas énumérée", () => {
    expect(MANUAL_ALLOWLIST).toEqual([]);
  });
});

describe("l'exemption Zod est DÉRIVÉE et MÉRITÉE (DNC-10)", () => {
  it('en compte exactement le nombre épinglé — une dérivation vacante est un faux vert', () => {
    expect(SANCTIONED.map(describeSite)).toHaveLength(DERIVED_ZOD_EXCEPTIONS);
  });

  it('chaque exemption NOMME le schéma qui la mérite, et ce schéma vient de `@pilotage/contracts`', () => {
    // AC-2b : une exemption se MÉRITE. Le symbole doit être (i) le récepteur
    // d'un `.parse`/`.safeParse` DANS la méthode concernée, et (ii) importé en
    // VALEUR depuis le paquet de contrats partagés — ce que le classifieur
    // vérifie avant de sanctionner. On asserte ici que la sanction porte une
    // IDENTITÉ, jamais un simple drapeau booléen, et que cette identité se lit
    // vraiment dans la source du contrôleur concerné.
    for (const site of SANCTIONED) {
      const schema = site.sanctioningSchema as string;
      expect(typeof schema).toBe('string');
      const source = CLASSIFIED.get(site.file)?.source;
      expect(source).toBeDefined();
      expect(source).toContain(schema);
      expect(source).toContain(CONTRACTS_PACKAGE);
    }
  });

  it("les deux sites réparés ne sont PAS sanctionnés — ils sont propres, pas exemptés", () => {
    const repaired = SANCTIONED.filter((s) =>
      s.file.startsWith('apps/api/src/modules/school-structure/'),
    );
    expect(repaired).toEqual([]);
  });
});

/* ================================================================== *
 * COUCHE B — la RÉFLEXION, sur les deux contrôleurs réparés seulement
 * ================================================================== */

const ROUTE_ARGS_METADATA_KEY = '__routeArguments__';
const BUILTIN_KEY = /^\d+:\d+$/;

type RouteArgs = Record<string, { data?: unknown; pipes?: unknown[] }>;

function routeArgs(ctor: unknown, method: string): RouteArgs {
  const args = Reflect.getMetadata(ROUTE_ARGS_METADATA_KEY, ctor as object, method) as
    | RouteArgs
    | undefined;
  if (!args) throw new Error(`aucune métadonnée de route sur ${method}`);
  return args;
}

/**
 * Le code du slot `@Body()`, CALIBRÉ sur un handler qui n'a qu'un seul
 * décorateur de paramètre intégré, jamais écrit en dur (FR-6).
 *
 * C'est le garde-fou de l'erreur la plus coûteuse ici : `@CurrentJwt() jwt` est
 * un `Object` LÉGITIME sur presque tous les handlers de ces fichiers. Un bug
 * d'indexation dénoncerait donc un site sain, ou laisserait passer le vrai.
 */
const BODY_PARAMTYPE = (() => {
  const builtin = Object.keys(routeArgs(CyclesController, 'create')).filter((k) =>
    BUILTIN_KEY.test(k),
  );
  const [onlyKey] = builtin;
  // Le test de longueur ne RESTREINT pas `builtin[0]` sous
  // `noUncheckedIndexedAccess` : on lit le slot, puis on jette sur son absence.
  if (builtin.length !== 1 || onlyKey === undefined) {
    throw new Error(
      `calibration impossible : CyclesController.create porte ${builtin.length} décorateurs ` +
        'de paramètre intégrés (attendu : 1). Impossible de savoir ⇒ jamais un PASS (DNC-08).',
    );
  }
  return Number(onlyKey.split(':')[0]);
})();

function bodyMetatype(ctor: unknown, prototype: object, method: string): unknown {
  const paramtypes = Reflect.getMetadata('design:paramtypes', prototype, method) as
    | unknown[]
    | undefined;
  if (!paramtypes) {
    throw new Error(
      `aucun \`design:paramtypes\` sur ${method} — \`emitDecoratorMetadata\` est inactif sous ce ` +
        'runner, et TOUTE la couche B serait verte sans rien mesurer.',
    );
  }
  const keys = Object.keys(routeArgs(ctor, method)).filter((k) =>
    k.startsWith(`${BODY_PARAMTYPE}:`),
  );
  const [onlyKey] = keys;
  expect(keys).toHaveLength(1);
  if (onlyKey === undefined) {
    throw new Error(
      `aucun slot \`@Body()\` (paramtype ${BODY_PARAMTYPE}) sur ${method} — le décorateur a disparu`,
    );
  }
  return paramtypes[Number(onlyKey.split(':')[1])];
}

describe('COUCHE B — la réflexion confirme la couche A sur les deux sites réparés', () => {
  it('CONTRÔLE POSITIF : un site déjà correct reflète sa VRAIE classe', () => {
    // Sans cette assertion, tout ce bloc est vert dès que les métadonnées ne
    // sont plus émises — par exemple après un passage à `@swc/jest` sans
    // `decoratorMetadata: true`, que personne ne relierait à ce fichier.
    const metatype = bodyMetatype(CyclesController, CyclesController.prototype, 'create');
    expect(metatype).not.toBe(Object);
    expect((metatype as { name: string }).name).toBe('CreateCycleDto');
  });

  const REPAIRED: ReadonlyArray<[string, { prototype: object }, string, string]> = [
    ['CyclesController', CyclesController, 'updateGradeLevel', 'UpdateGradeLevelDto'],
    ['AcademicYearsController', AcademicYearsController, 'updateTerm', 'UpdateTermDto'],
  ];

  it.each(REPAIRED)('%s.%s reflète `%s`, plus `Object`', (_label, ctor, method, expected) => {
    const metatype = bodyMetatype(ctor, ctor.prototype, method);
    expect(metatype).not.toBe(Object);
    expect((metatype as { name: string }).name).toBe(expected);
  });
});

/* ================================================================== *
 * R-30 — MONTRÉ ROUGE, et rouge pour la raison annoncée
 * ================================================================== */

/**
 * POURQUOI PAS `git show HEAD:` (AC-8)
 * ------------------------------------
 * Une preuve « avant » lue depuis `HEAD` s'INVERSE à l'instant du commit — après
 * quoi elle mesure l'état corrigé et devient vacante —, et la CI fait son
 * checkout en profondeur 1, donc `HEAD~1` n'existe pas. `walk-read-gate.spec
 * .ts:28-31` a déjà écrit ce piège.
 *
 * POURQUOI PAS UN FICHIER PLANTÉ DANS LE VRAI ARBRE
 * --------------------------------------------------
 * Ce serait EXACTEMENT la course jest parallèle que `TOOL-17` a fermée : la
 * marche liste le fichier, un autre worker le supprime, la lecture explose, et
 * cinq suites meurent au chargement pour une raison sans rapport avec le diff.
 *
 * Donc : les fixtures vivent sous `mkdtempSync(tmpdir())`, ce que
 * `hermetic-spec-writers-gate.spec.ts` exige de tout écrivain de spec, et les
 * cas mono-fichier sont pilotés PAR CHAÎNE. Le répertoire de scratch n'est là
 * que pour ce qu'une chaîne ne peut pas prouver : la résolution d'un import
 * RELATIF vers un autre fichier.
 */
/**
 * Le SEUL site classé d'une fixture mono-handler — avec une garde qui NARROWE.
 *
 * `expect(site).toBeDefined()` est un matcher, pas une garde de type : il laisse
 * `site` en `BodyParam | undefined` sous `noUncheckedIndexedAccess`, et surtout
 * il ne protège pas la ligne SUIVANTE. Sur un classement vide, `site.reason`
 * mourrait en `TypeError: Cannot read properties of undefined` — c'est-à-dire
 * que « le classifieur n'a rien vu » (le pire des défauts pour un cliquet : il
 * rendrait le gate vert sur un fichier entier) se lirait comme un plantage de
 * lecture. On l'énonce ici, une fois, avec le compte réellement vu.
 */
function onlySite(sites: readonly BodyParam[]): BodyParam {
  const [site] = sites;
  if (sites.length !== 1 || site === undefined) {
    throw new Error(
      `la fixture attend EXACTEMENT un \`@Body()\` classé, le classifieur en a vu ` +
        `${sites.length} — « rien vu » n'est jamais rapporté comme un PASS (DNC-08).`,
    );
  }
  return site;
}

describe('R-30 — le cliquet est MONTRÉ capable d’échouer', () => {
  const FILE = join(API_SRC, 'modules', '__fixture', 'fixture.controller.ts');
  const run = (source: string, io: Io = IO) => classify(FILE, source, io);

  const wrap = (paramType: string, extra = '') =>
    [
      "import { Body, Controller, Patch } from '@nestjs/common';",
      extra,
      'class RealDto { name!: string; }',
      "@Controller('x')",
      'export class FixtureController {',
      "  @Patch(':id')",
      `  async patch(@Body() body: ${paramType}) { return body; }`,
      '}',
      '',
    ]
      .filter(Boolean)
      .join('\n');

  const ERASURE_CASES: ReadonlyArray<[string, RegExp]> = [
    ['Partial<RealDto>', /EXPRESSION de type générique/],
    ["Pick<RealDto, 'name'>", /EXPRESSION de type générique/],
    ['Omit<RealDto, never>', /EXPRESSION de type générique/],
    ['Record<string, unknown>', /EXPRESSION de type générique/],
    ['unknown', /n'est pas une référence de type nue/],
    ['any', /n'est pas une référence de type nue/],
    ['{ name?: string }', /n'est pas une référence de type nue/],
    ['RealDto | undefined', /n'est pas une référence de type nue/],
  ];

  it.each(ERASURE_CASES)('signale `@Body() body: %s`', (paramType, pattern) => {
    const site = onlySite(run(wrap(paramType)));
    expect(site.reason).toMatch(pattern);
    expect(site.sanctioningSchema).toBeUndefined();
  });

  it('laisse passer une CLASSE déclarée dans le même fichier — le cas normal', () => {
    const site = onlySite(run(wrap('RealDto')));
    expect(site.reason).toBeUndefined();
  });

  it('signale un ALIAS `type` local — il s’efface exactement comme `Partial<>`', () => {
    const source = wrap('AliasDto', 'type AliasDto = { name?: string };');
    const site = onlySite(run(source));
    expect(site.reason).toMatch(/n'est ni déclaré ni importé/);
  });

  it("signale un `interface` local — même effacement, autre orthographe", () => {
    const source = wrap('ShapeDto', 'interface ShapeDto { name?: string }');
    const site = onlySite(run(source));
    expect(site.reason).toMatch(/n'est ni déclaré ni importé/);
  });

  it("signale un import `type` — c'est la forme exacte du site `analytics`", () => {
    const source = wrap(
      'RebuildSnapshotsRequest',
      `import type { RebuildSnapshotsRequest } from '${CONTRACTS_PACKAGE}';`,
    );
    const site = onlySite(run(source));
    expect(site.reason).toMatch(/import `type`/);
  });

  it("signale un `@Body()` SANS annotation du tout", () => {
    const source = [
      "import { Body, Controller, Patch } from '@nestjs/common';",
      "@Controller('x')",
      'export class FixtureController {',
      "  @Patch(':id')",
      '  async patch(@Body() body) { return body; }',
      '}',
      '',
    ].join('\n');
    const site = onlySite(run(source));
    expect(site.reason).toMatch(/aucune annotation/);
  });

  it('ne confond PAS `@Param()` ni un décorateur custom avec un `@Body()`', () => {
    const source = [
      "import { Body, Controller, Param, Patch } from '@nestjs/common';",
      "import { CurrentJwt } from '../../shared/auth/current-user.decorator';",
      'class RealDto { name!: string; }',
      "@Controller('x')",
      'export class FixtureController {',
      "  @Patch(':id')",
      "  async patch(@Param('id') id: unknown, @Body() body: RealDto, @CurrentJwt() jwt: unknown) {",
      '    return [id, body, jwt];',
      '  }',
      '}',
      '',
    ].join('\n');
    const sites = run(source);
    // Un seul site vu, et c'est le corps : `@Param('id') id: unknown` et
    // `@CurrentJwt() jwt: unknown` s'effacent eux aussi en `Object` et ne sont
    // PAS le défaut. C'est la moitié « faux positif » de la preuve.
    expect(sites).toHaveLength(1);
    expect(sites[0]!.param).toBe('body');
    expect(sites[0]!.reason).toBeUndefined();
  });
});

describe("R-30 — l'exemption Zod se MÉRITE, et rien d'autre ne l'obtient", () => {
  const FILE = join(API_SRC, 'modules', '__fixture', 'zod.controller.ts');

  const controller = (importLine: string, bodyLine: string) =>
    [
      "import { Body, Controller, Post } from '@nestjs/common';",
      importLine,
      "@Controller('x')",
      'export class ZodFixtureController {',
      "  @Post()",
      '  async create(@Body() rawBody: unknown) {',
      `    ${bodyLine}`,
      '    return rawBody;',
      '  }',
      '}',
      '',
    ].join('\n');

  it('sanctionne un corps `unknown` validé par un schéma de `@pilotage/contracts`', () => {
    const site = onlySite(
      classify(
        FILE,
        controller(
          `import { SendMessageRequestSchema } from '${CONTRACTS_PACKAGE}';`,
          'const parsed = SendMessageRequestSchema.safeParse(rawBody);',
        ),
        IO,
      ),
    );
    expect(site.reason).toBeDefined();
    expect(site.sanctioningSchema).toBe('SendMessageRequestSchema');
  });

  it('ne sanctionne PAS un `.parse()` sur un schéma LOCAL — le contrat doit être PARTAGÉ', () => {
    const site = onlySite(
      classify(
        FILE,
        controller("import { z } from 'zod';", 'const parsed = z.object({}).parse(rawBody);'),
        IO,
      ),
    );
    expect(site.reason).toBeDefined();
    expect(site.sanctioningSchema).toBeUndefined();
  });

  it('ne sanctionne PAS un `Partial<>` même si la méthode appelle un schéma partagé', () => {
    // La sanction ne blanchit pas la méthode : elle blanchit un corps que Zod
    // valide RÉELLEMENT. Ici le corps est déjà un `Partial<>` et le `.safeParse`
    // porte sur autre chose — mais le classifieur ne peut pas le savoir, donc
    // ce test épingle honnêtement CE QU'IL FAIT : il sanctionne au niveau de la
    // MÉTHODE. C'est la limite connue de la dérivation, écrite plutôt que
    // découverte. Un `Partial<>` dans une méthode SANS Zod — le cas réel de
    // PF-51 — reste un contrevenant, et c'est l'assertion suivante.
    const source = [
      "import { Body, Controller, Patch } from '@nestjs/common';",
      `import { SendMessageRequestSchema } from '${CONTRACTS_PACKAGE}';`,
      'class RealDto { name!: string; }',
      "@Controller('x')",
      'export class MixedController {',
      "  @Patch(':id')",
      '  async patch(@Body() body: Partial<RealDto>) {',
      '    return SendMessageRequestSchema.safeParse(body);',
      '  }',
      '  @Patch(\'other\')',
      '  async other(@Body() body: Partial<RealDto>) { return body; }',
      '}',
      '',
    ].join('\n');
    const sites = classify(FILE, source, IO);
    const other = sites.find((s) => s.method === 'other');
    expect(other?.reason).toMatch(/EXPRESSION de type générique/);
    expect(other?.sanctioningSchema).toBeUndefined();
  });
});

/**
 * La seule chose qu'une chaîne ne peut pas prouver : que le classifieur SUIT un
 * import relatif jusqu'au fichier voisin et y trouve (ou non) une `class`. Dix
 * sites réels en dépendent — tous les DTO de `remediation/dto/*`, par exemple —
 * et une résolution cassée les transformerait en dix faux rouges que l'on
 * « corrigerait » en affaiblissant la règle.
 */
describe('R-30 — la résolution d’un import RELATIF, sur un arbre de scratch', () => {
  let scratch = '';

  beforeAll(() => {
    scratch = mkdtempSync(join(tmpdir(), 'body-metatype-gate-'));
    mkdirSync(join(scratch, 'dto'), { recursive: true });
    writeFileSync(
      join(scratch, 'dto', 'real.dto.ts'),
      'export class RealDto { name!: string; }\n',
      'utf8',
    );
    writeFileSync(
      join(scratch, 'dto', 'alias.dto.ts'),
      'export type AliasDto = { name?: string };\n',
      'utf8',
    );
  });

  afterAll(() => {
    if (scratch) rmSync(scratch, { recursive: true, force: true });
  });

  const controller = (importLine: string, paramType: string) =>
    [
      "import { Body, Controller, Patch } from '@nestjs/common';",
      importLine,
      "@Controller('x')",
      'export class RelativeController {',
      "  @Patch(':id')",
      `  async patch(@Body() body: ${paramType}) { return body; }`,
      '}',
      '',
    ].join('\n');

  it('accepte une CLASSE importée depuis un module relatif voisin', () => {
    const site = onlySite(
      classify(
        join(scratch, 'relative.controller.ts'),
        controller("import { RealDto } from './dto/real.dto';", 'RealDto'),
        IO,
      ),
    );
    expect(site.reason).toBeUndefined();
  });

  it("signale un ALIAS importé depuis un module relatif — il n'y a pas de `class` là-bas", () => {
    const site = onlySite(
      classify(
        join(scratch, 'relative.controller.ts'),
        controller("import { AliasDto } from './dto/alias.dto';", 'AliasDto'),
        IO,
      ),
    );
    expect(site.reason).toMatch(/n'est pas déclaré `class`/);
  });

  it("signale un module relatif INTROUVABLE — un import qu'on ne peut pas lire n'est jamais un PASS", () => {
    const site = onlySite(
      classify(
        join(scratch, 'relative.controller.ts'),
        controller("import { GhostDto } from './dto/ghost.dto';", 'GhostDto'),
        IO,
      ),
    );
    expect(site.reason).toMatch(/introuvable/);
  });
});
