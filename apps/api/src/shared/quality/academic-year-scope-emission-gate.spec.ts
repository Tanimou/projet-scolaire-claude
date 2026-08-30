import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

/**
 * S-E03-16 / `PF-15` / `ADR-090` — LE CLIQUET : une réponse HTTP qui nomme
 * l'IDENTITÉ de l'année active porte aussi sa PORTÉE.
 *
 * POURQUOI CE FICHIER EXISTE
 * --------------------------
 * `resolve-academic-year.ts` décore chaque résolution (`name`, `startDate`,
 * `endDate`, `status`, `viaFallback`, `containsReferenceDate`, `isStale`,
 * `staleByDays`, `activeCount`), et `SchoolContextService` — le service que
 * traversent les QUATRE portails — jetait tout sauf `.id`. Cinq réponses HTTP
 * émettaient donc un UUID nu : aucun portail ne pouvait dire de QUELLE année il
 * parlait, ni qu'elle était terminée depuis 56 ou 786 jours (mesuré le
 * 2026-08-30 sur les deux tenants).
 *
 * Convertir cinq sites ferme cinq sites. `PF-15` ferme comme une CLASSE, donc
 * l'ensemble doit être DÉRIVÉ des sources et maintenu vide — une liste tenue à
 * la main ne peut pas, par construction, échouer sur le site qu'elle omet
 * (« deux listes à la main = dérive silencieuse », run 59).
 *
 * ⚠ LE BRIEF EN NOMMAIT QUATRE. IL Y EN AVAIT CINQ.
 * -------------------------------------------------
 * Le cinquième — `structure.controller.ts`, `GET /structure/cycles/:id`,
 * `return { ...cycle, activeAcademicYearId }` — n'apparaît dans aucun grep
 * ancré sur la ligne, parce qu'il vit dans un SPREAD. C'est le plafond MESURÉ en
 * forçant la tolérance à zéro et en LISANT la liste imprimée, pas un chiffre
 * recopié d'une prose (run 104 : « 14 écrit, 6 réels »). Le suivi des spreads
 * n'est donc pas un raffinement : sans lui ce cliquet sortirait vert sur 4/5 et
 * AURAIT L'AIR juste.
 *
 * LA RÈGLE
 * --------
 * TOLÉRANCE ZÉRO. Un littéral d'objet EN POSITION DE RETOUR d'une méthode
 * portant un décorateur de route HTTP, dans un fichier `*.controller.ts` sous
 * `apps/api/src`, qui porte `activeAcademicYearId` EN POSITION DE CLÉ, porte
 * aussi `activeAcademicYear`. Le message nomme `fichier:ligne — méthode`.
 *
 * POURQUOI LE CORPUS EST `apps/api/src` SEUL — ET POURQUOI CE N'EST PAS LA
 * PARESSE DE MONO-RACINE QUE `academic-year-resolution-gate` DÉNONCE
 * -----------------------------------------------------------------------
 * La classe de `academic-year-resolution-gate` est « lecture Prisma », qui vit
 * RÉELLEMENT dans les trois racines. La classe D'ICI est « projection de
 * réponse HTTP », qui ne peut structurellement pas exister ailleurs :
 * `apps/worker` n'a que des processeurs BullMQ et `packages/*` n'a ni Nest ni
 * routes. La restriction est donc PROUVÉE et non affirmée — une assertion
 * ci-dessous vérifie que ZÉRO décorateur de route existe hors `apps/api/src`,
 * une classe qui vaut 0 et doit le rester.
 *
 * Cela a une conséquence VOULUE : `packages/imports-core/src/caches.ts` rend un
 * littéral avec `activeAcademicYearId` abrégé. C'est une structure de CACHE
 * interne du chemin d'écriture d'import, pas une projection HTTP, et c'est un
 * AUTRE producteur. L'inclure aurait forcé la seule sortie que cette tranche
 * s'interdit : une allowlist. Elle est enregistrée (`PF-486`), pas pardonnée.
 *
 * PLAFOND, JAMAIS PLANCHER (run 95)
 * ---------------------------------
 * Le nombre de contrevenants est exactement la classe que cette tranche fait
 * tomber à zéro : un plancher dessus serait satisfait par le correctif puis par
 * la mort du cliquet. L'ANTI-VACUITÉ est donc portée par cinq FIXTURES
 * synthétiques passées DIRECTEMENT au classifieur, et les planchers de
 * production sont des planchers de MARCHE et de RECONNAISSANCE — des grandeurs
 * qui ne rétrécissent pas.
 *
 * CE QUE CE CLIQUET NE PROUVE PAS
 * -------------------------------
 * Il prouve une FORME dans les sources. Que la pile qui tourne rende vraiment
 * `isStale: true` avec un `staleByDays` recoupé en SQL est porté par la sonde
 * live d'AC-6, avec l'âge de l'image écrit à côté de la mesure. Que la portée
 * soit AFFICHÉE est porté par le badge et ses pages. Trois affirmations, trois
 * mécanismes ; les confondre serait `DNC-06`.
 */

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..', '..');
const API_SRC = join(REPO_ROOT, 'apps', 'api', 'src');
const WORKER_SRC = join(REPO_ROOT, 'apps', 'worker', 'src');
const PACKAGES_DIR = join(REPO_ROOT, 'packages');
const WALK_READ_PATH = join(REPO_ROOT, 'scripts', 'lib', 'walk-read.js');
const FIXTURES_DIR = join(__dirname, '__fixtures__', 'academic-year-scope-emission');

/** Le suffixe qui DÉFINIT le corpus. La moitié structurelle n°1. */
const CONTROLLER_SUFFIX = '.controller.ts';

/** La moitié structurelle n°2 : seule une méthode de ROUTE émet une réponse. */
const HTTP_DECORATORS: ReadonlySet<string> = new Set([
  'Get',
  'Post',
  'Put',
  'Patch',
  'Delete',
  'Head',
  'Options',
  'All',
]);

/** Les noms jugés — INJECTÉS, jamais écrits en dur dans le classifieur (`PF-295`). */
const NAMES = {
  id: 'activeAcademicYearId',
  scope: 'activeAcademicYear',
} as const;

/**
 * Les noms des FIXTURES sont DIFFÉRENTS de ceux de production, exprès : une
 * fixture qui embarquerait la vraie clé serait un futur faux positif pour tout
 * gate marchant cet arbre (`PF-295`), et prouverait en prime moins de choses —
 * ici, le classifieur est montré AGNOSTIQUE AU NOM.
 */
const FIXTURE_NAMES = {
  id: 'scopeBearerId',
  scope: 'scopeBearer',
} as const;

/* eslint-disable @typescript-eslint/no-require-imports */
// Non gardés, exprès (`DNC-08`) : si ces helpers s'évaporent, cette suite doit
// mourir au CHARGEMENT plutôt que dégénérer en « rien à vérifier ».
const walkRead = require(WALK_READ_PATH) as {
  mapWalkedFiles: <V>(
    paths: string[],
    build: (path: string, source: string) => [string, V],
  ) => { entries: [string, V][]; skipped: string[] };
  warnSkipped: (label: string, skipped: string[]) => boolean;
  maxVanishedFor: (n: number) => number;
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ts = require('typescript') as any;
/* eslint-enable @typescript-eslint/no-require-imports */

/* ================================================================== *
 * LA MARCHE
 * ================================================================== */

const SKIPPED_DIRS: ReadonlySet<string> = new Set([
  'node_modules',
  'dist',
  '.next',
  '__fixtures__',
]);

function walk(dir: string, keep: (name: string) => boolean, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRS.has(entry.name)) walk(path, keep, out);
      continue;
    }
    if (keep(entry.name)) out.push(path);
  }
  return out;
}

const isController = (name: string) =>
  name.endsWith(CONTROLLER_SUFFIX) && !name.endsWith(`.spec${CONTROLLER_SUFFIX}`);

const isSource = (name: string) =>
  (name.endsWith('.ts') || name.endsWith('.tsx')) &&
  !name.endsWith('.d.ts') &&
  !name.endsWith('.spec.ts') &&
  !name.endsWith('.spec.tsx') &&
  !name.endsWith('.test.ts') &&
  !name.endsWith('.test.tsx');

const CONTROLLER_FILES = walk(API_SRC, isController).sort();

/** Les racines dont on PROUVE qu'elles ne portent aucune route (§ docblock). */
const NON_ROUTE_FILES = [
  ...walk(WORKER_SRC, isSource),
  ...(existsSync(PACKAGES_DIR)
    ? readdirSync(PACKAGES_DIR, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .flatMap((e) => walk(join(PACKAGES_DIR, e.name, 'src'), isSource))
    : []),
].sort();

const rel = (absolute: string) => relative(REPO_ROOT, absolute).split(sep).join('/');

/**
 * Plancher de MARCHE — « la marche a bien regardé l'arbre » — et jamais un
 * plancher de contravention. Mesuré sur cet arbre : 41 fichiers
 * `*.controller.ts` sous `apps/api/src`.
 */
const MIN_CONTROLLER_FILES = 30;

/**
 * Plancher de RECONNAISSANCE : combien de littéraux retournés portant l'identité
 * d'année le classifieur voit encore. Zéro contravention sur zéro reconnaissance
 * ne prouverait rien.
 *
 * Ce n'est PAS un plancher sur une classe qui rétrécit : la conversion AJOUTE un
 * champ à ces littéraux, elle n'en supprime aucun, et `AC-9` interdit de retirer
 * `activeAcademicYearId` d'une réponse (trois pages web en dépendent). La
 * grandeur est donc invariante par la correction — c'est précisément ce qui la
 * rend légitime comme plancher.
 */
const MIN_EMISSIONS = 5;

/* ================================================================== *
 * LE CLASSIFIEUR — tous les noms sont INJECTÉS
 * ================================================================== */

type Emission = {
  readonly file: string;
  readonly line: number;
  readonly method: string;
  /** Le littéral porte l'identité d'année en position de CLÉ. */
  readonly carriesId: boolean;
  /** Le littéral porte aussi la PORTÉE. */
  readonly carriesScope: boolean;
};

/** Une méthode porte-t-elle un décorateur de ROUTE ? */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function httpDecoratorOf(node: any): string | null {
  const decorators = ts.canHaveDecorators?.(node) ? ts.getDecorators(node) : node.decorators;
  if (!decorators) return null;
  for (const decorator of decorators) {
    const expression = decorator.expression;
    const callee = ts.isCallExpression(expression) ? expression.expression : expression;
    if (callee && ts.isIdentifier(callee)) {
      const name = String(callee.escapedText);
      if (HTTP_DECORATORS.has(name)) return name;
    }
  }
  return null;
}

/**
 * Les clés de PREMIER NIVEAU d'un littéral, EN SUIVANT les spreads de littéraux,
 * les ternaires et les parenthèses.
 *
 * Un spread d'IDENTIFIANT ou d'APPEL (`...cycle`) est irrésoluble ici et n'ajoute
 * aucune clé : c'est déclaré comme la limite du classifieur. Elle est sans
 * conséquence pour cette règle — aux cinq sites réels, l'identité d'année est
 * écrite EN CLAIR à côté du spread, jamais transportée par lui.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function literalKeys(literal: any): Set<string> {
  const keys = new Set<string>();
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
    }
  };
  visit(literal, 0);
  return keys;
}

/**
 * Les littéraux d'objet atteignables EN POSITION DE RETOUR.
 *
 * On ne DESCEND PAS dans les arguments d'appel : `return this.svc.f({ … })`
 * retourne le résultat d'un appel, pas ce littéral. C'est cette discipline qui
 * évite les faux positifs sur `analytics.controller.ts`
 * (`{ academicYearId: activeAcademicYearId ?? undefined }`) sans une seule
 * ligne d'exemption.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function returnedLiterals(expression: any, depth = 0): any[] {
  if (!expression || depth > 6) return [];
  if (ts.isObjectLiteralExpression(expression)) return [expression];
  if (
    ts.isParenthesizedExpression(expression) ||
    ts.isAwaitExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isNonNullExpression(expression) ||
    (ts.isSatisfiesExpression?.(expression) ?? false)
  ) {
    return returnedLiterals(expression.expression, depth + 1);
  }
  if (ts.isConditionalExpression(expression)) {
    return [
      ...returnedLiterals(expression.whenTrue, depth + 1),
      ...returnedLiterals(expression.whenFalse, depth + 1),
    ];
  }
  return [];
}

export function classifyScopeEmissions(
  source: string,
  fileLabel: string,
  names: { id: string; scope: string },
): Emission[] {
  const sourceFile = ts.createSourceFile(
    fileLabel,
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    ts.ScriptKind.TS,
  );
  const emissions: Emission[] = [];

  /**
   * Les returns de LA méthode, sans descendre dans les fonctions imbriquées :
   * un `return` dans un `.map(…)` construit une LIGNE, pas la réponse.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ownReturns = (body: any): any[] => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const found: any[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const visit = (n: any): void => {
      if (!n) return;
      if (
        ts.isFunctionDeclaration(n) ||
        ts.isFunctionExpression(n) ||
        ts.isArrowFunction(n) ||
        ts.isClassDeclaration(n)
      ) {
        return;
      }
      if (ts.isReturnStatement(n)) found.push(n);
      ts.forEachChild(n, visit);
    };
    ts.forEachChild(body, visit);
    return found;
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const visitClassMember = (member: any): void => {
    if (!ts.isMethodDeclaration(member) || !member.body) return;
    if (httpDecoratorOf(member) === null) return;
    const methodName =
      member.name && ts.isIdentifier(member.name) ? String(member.name.escapedText) : '<anonyme>';

    for (const statement of ownReturns(member.body)) {
      for (const literal of returnedLiterals(statement.expression)) {
        const keys = literalKeys(literal);
        if (!keys.has(names.id)) continue;
        const { line } = sourceFile.getLineAndCharacterOfPosition(literal.getStart(sourceFile));
        emissions.push({
          file: fileLabel,
          line: line + 1,
          method: methodName,
          carriesId: true,
          carriesScope: keys.has(names.scope),
        });
      }
    }
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const visit = (node: any): void => {
    if (ts.isClassDeclaration(node)) {
      for (const member of node.members) visitClassMember(member);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  return emissions;
}

/** Un décorateur de route, n'importe où — pour PROUVER la restriction de racine. */
export function declaresHttpRoute(source: string, fileLabel: string): boolean {
  const sourceFile = ts.createSourceFile(
    fileLabel,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileLabel.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  let found = false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const visit = (n: any): void => {
    if (found || !n) return;
    if (ts.isMethodDeclaration(n) && httpDecoratorOf(n) !== null) {
      found = true;
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(sourceFile);
  return found;
}

/* ================================================================== *
 * LA MESURE
 * ================================================================== */

const walked = walkRead.mapWalkedFiles<Emission[]>(CONTROLLER_FILES, (path, source) => [
  rel(path),
  classifyScopeEmissions(source, rel(path), NAMES),
]);
const EMISSIONS: Emission[] = walked.entries.flatMap(([, sites]) => sites);

const nonRouteWalk = walkRead.mapWalkedFiles<boolean>(NON_ROUTE_FILES, (path, source) => [
  rel(path),
  declaresHttpRoute(source, rel(path)),
]);
const ROUTES_OUTSIDE_API = nonRouteWalk.entries
  .filter(([, hasRoute]) => hasRoute)
  .map(([file]) => file);

/**
 * `MANUAL_ALLOWLIST` existe, est NOMMÉE, et EXPÉDIE VIDE — une assertion le
 * vérifie. Aucune variable d'environnement, aucun `SKIP_*` / `ALLOW_*`
 * (`DNC-10`) : une assertion lit la source de CE fichier pour le prouver.
 */
const MANUAL_ALLOWLIST: readonly string[] = [];

const OFFENDERS = EMISSIONS.filter(
  (e) =>
    e.carriesId &&
    !e.carriesScope &&
    !MANUAL_ALLOWLIST.some((entry) => entry === `${e.file}:${e.line}`),
);

const describeSite = (e: Emission) => `${e.file}:${e.line} — ${e.method}()`;

/* ================================================================== *
 * LES FIXTURES — anti-vacuité, jamais un comptage de production
 * ================================================================== */

const FIXTURES = {
  offending: 'offending.controller.ts.txt',
  offendingSpread: 'offending-spread.controller.ts.txt',
  offendingTernary: 'offending-ternary.controller.ts.txt',
  compliant: 'compliant.controller.ts.txt',
  nonHttp: 'non-http.controller.ts.txt',
} as const;

/** Chemin NOMMÉ ⇒ lecture NUE : une fixture absente doit tuer la suite (`DNC-08`). */
function fixture(name: string): Emission[] {
  const source = readFileSync(join(FIXTURES_DIR, name), 'utf8');
  return classifyScopeEmissions(source, `__fixtures__/${name}`, FIXTURE_NAMES);
}

/* ================================================================== *
 * LES TESTS
 * ================================================================== */

describe('la marche a bien regardé l’arbre', () => {
  it('ne tait aucun fichier illisible', () => {
    expect(walkRead.warnSkipped('academic-year-scope-emission-gate', walked.skipped)).toBe(false);
  });

  it('n’a pas perdu plus que le budget calibré sur la taille du corpus', () => {
    expect(walked.skipped.length).toBeLessThanOrEqual(
      walkRead.maxVanishedFor(CONTROLLER_FILES.length),
    );
  });

  it('atteint le corpus (plancher de MARCHE, pas de contravention)', () => {
    expect(CONTROLLER_FILES.length).toBeGreaterThanOrEqual(MIN_CONTROLLER_FILES);
  });

  it('exclut `__fixtures__` — et l’exclusion est EXACTEMENT celle-là', () => {
    // Sans cette exclusion le cliquet serait rouge dès le premier jour contre
    // des fichiers que personne ne doit « corriger » (`PF-295`).
    expect(CONTROLLER_FILES.filter((p) => rel(p).includes('__fixtures__'))).toEqual([]);
    // ...et les fixtures existent bel et bien, sinon l'anti-vacuité est creuse.
    for (const name of Object.values(FIXTURES)) {
      expect(existsSync(join(FIXTURES_DIR, name))).toBe(true);
    }
  });

  it('l’allowlist manuelle expédie VIDE', () => {
    expect(MANUAL_ALLOWLIST).toEqual([]);
  });

  it('n’offre AUCUNE échappatoire par l’environnement (DNC-10)', () => {
    const self = readFileSync(join(__dirname, 'academic-year-scope-emission-gate.spec.ts'), 'utf8');
    expect(self).not.toMatch(/process\s*\.\s*env/);
  });
});

describe('la restriction de racine est PROUVÉE, pas affirmée', () => {
  it('ZÉRO décorateur de route hors `apps/api/src` — une classe à 0 qui doit le rester', () => {
    // C'est ce qui distingue cette mono-racine de la paresse que
    // `academic-year-resolution-gate` dénonce : la classe jugée ne PEUT pas
    // exister ailleurs, et on le vérifie au lieu de le déclarer.
    expect(ROUTES_OUTSIDE_API).toEqual([]);
  });

  it('la marche des autres racines a bien eu lieu — sinon « zéro » ne dit rien', () => {
    expect(NON_ROUTE_FILES.length).toBeGreaterThanOrEqual(150);
  });
});

describe('ANTI-VACUITÉ — le classifieur reconnaît ce qu’il prétend juger', () => {
  it('attrape la forme NUE (propriété abrégée dans un littéral retourné)', () => {
    const sites = fixture(FIXTURES.offending);
    expect(sites).toHaveLength(1);
    expect(sites[0]!.carriesId).toBe(true);
    expect(sites[0]!.carriesScope).toBe(false);
  });

  it('attrape la forme SPREAD — celle du cinquième site que le brief avait manqué', () => {
    const sites = fixture(FIXTURES.offendingSpread);
    expect(sites).toHaveLength(1);
    expect(sites[0]!.carriesScope).toBe(false);
  });

  it('juge les DEUX branches d’un ternaire séparément', () => {
    const sites = fixture(FIXTURES.offendingTernary);
    expect(sites).toHaveLength(2);
    expect(sites.filter((s) => s.carriesScope)).toHaveLength(1);
    expect(sites.filter((s) => !s.carriesScope)).toHaveLength(1);
  });

  it('le CONTRÔLE NÉGATIF passe — sinon un comparateur toujours-rouge suffirait', () => {
    const sites = fixture(FIXTURES.compliant);
    // Le seul littéral RETOURNÉ portant l'identité est celui qui porte aussi la
    // portée. Déstructuration, position de valeur, `where` niché et argument
    // d'appel ne sont PAS dans la classe — et aucune allowlist ne les en sort.
    expect(sites).toHaveLength(1);
    expect(sites[0]!.carriesScope).toBe(true);
  });

  it('la discrimination est STRUCTURELLE : sans décorateur HTTP, pas de réponse', () => {
    expect(fixture(FIXTURES.nonHttp)).toEqual([]);
  });

  it('voit encore de vraies émissions dans les sources (plancher de RECONNAISSANCE)', () => {
    expect(EMISSIONS.length).toBeGreaterThanOrEqual(MIN_EMISSIONS);
  });
});

describe('LA RÈGLE — tolérance ZÉRO', () => {
  it('aucune réponse HTTP n’émet l’identité de l’année sans sa PORTÉE', () => {
    if (OFFENDERS.length > 0) {
      throw new Error(
        `S-E03-16 / ADR-090 — ${OFFENDERS.length} réponse(s) émettent \`${NAMES.id}\` ` +
          `sans \`${NAMES.scope}\`.\n` +
          `Une réponse qui nomme l'IDENTITÉ de l'année porte aussi sa PORTÉE : le ` +
          `contexte la transporte déjà (\`SchoolContextService\`), il suffit de la ` +
          `déstructurer et de la placer À CÔTÉ de l'id — jamais à sa place.\n` +
          OFFENDERS.map(describeSite).join('\n'),
      );
    }
    expect(OFFENDERS.map(describeSite)).toEqual([]);
  });
});
