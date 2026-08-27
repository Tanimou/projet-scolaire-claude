import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/**
 * S-E03-8 / PF-40 / ADR-078 — LE CLIQUET À SENS UNIQUE du calendrier scolaire.
 *
 * CE QU'IL GÈLE, EN UNE PHRASE PAR RÈGLE
 * --------------------------------------
 *   R1 — UNE SEULE DÉCLARATION. Dans le corpus calendrier, aucun fichier ne
 *        construit sa propre fenêtre (`new Date` d'arité ≥ 2), ne redéclare un
 *        nom que le module canonique exporte déjà, n'écrit à la main un prédicat
 *        « à venir » sur `endsAt`, ni ne juge l'appartenance à un mois en
 *        comparant `getMonth()` à `getMonth()` sans l'année. Et tout nom
 *        canonique employé est IMPORTÉ de `@pilotage/contracts`.
 *
 *   R2 — AUCUNE HORLOGE DU VISITEUR. Dans un fichier du corpus portant
 *        `'use client'` : zéro `new Date()` d'arité 0, zéro `Date.now()`. La
 *        portée est volontairement plus large que « au scope de rendu » : un
 *        `useMemo` en est INDISCERNABLE lexicalement, et après cette tranche
 *        aucun usage légitime ne subsiste dans ce corpus.
 *
 *   R2b — LES ACCESSEURS CIVILS AMBIANTS (`getMonth` / `getDate` / `getDay` /
 *        `getFullYear`) dans un composant client du corpus sont ÉNUMÉRÉS et
 *        PLAFONNÉS, pas interdits. Pourquoi le rétrécissement, écrit ici plutôt
 *        que subi : `CalendarManager.tsx` en garde trois dans `toLocalDate`, qui
 *        pré-remplit un `<input type="date">` du CRUD admin. Ce n'est pas un
 *        compteur, c'est une valeur de FORMULAIRE que l'admin saisit dans son
 *        propre calendrier, et le CRUD est explicitement hors périmètre (AC-8).
 *        Interdire ici produirait un ROUGE contre du code délibérément préservé —
 *        c'est-à-dire un faux POSITIF, la seule erreur que ce cliquet n'a pas le
 *        droit de commettre. La dette est donc CHIFFRÉE (`PF-405`) et gelée à sa
 *        population mesurée : elle peut décroître, jamais grandir.
 *
 *   R3 — UN PLAFOND NE SE FAIT PAS PASSER POUR UN TOTAL. Une liaison affectée
 *        depuis une chaîne se terminant par `.slice(0, N)` littéral ne peut pas
 *        voir son `.length` rendu en JSX à moins que le MÊME élément porte aussi
 *        le total non tronqué.
 *
 *   R4 — LE MODULE CANONIQUE RESTE PUR. `packages/contracts/src/calendar/**` :
 *        zéro `import`, zéro `Date.now()`, zéro `new Date(` d'arité ≠ 1, zéro
 *        `getMonth` / `getDate` / `getDay` / `getFullYear` / `getHours` /
 *        `getTimezoneOffset` (ce dernier ajouté par `PF-406` : c'est celui qui
 *        décalait TOUTES les bornes au lieu d'un seul champ civil). Un
 *        module redevenu dépendant du fuseau ré-ouvrirait A4 EN SILENCE : aucun
 *        écran ne changerait d'apparence et les compteurs recommenceraient à
 *        diverger entre le rendu serveur et l'hydratation.
 *
 * LE CLIQUET JUGE DU CODE, PAS DE LA PROSE — ET C'EST STRUCTUREL
 * --------------------------------------------------------------
 * Les commentaires sont BLANCHIS (`stripCommentsPreservingLines`, longueur et
 * numéros de ligne préservés) AVANT le parsing, et tout l'appariement se fait
 * ensuite sur l'AST TypeScript : le contenu des littéraux de chaîne n'est donc
 * jamais confondu avec du code, par construction et non par une liste
 * d'exceptions. `prose-only.tsx.txt` porte les quatre formes interdites dans ses
 * commentaires ET dans ses chaînes, et un test exige qu'il reste VERT.
 * `PROGRESS.md` §1088 enregistre un cliquet devenu rouge sur le commentaire qui
 * expliquait son propre correctif, et note qu'un cliquet pareil se fait relâcher
 * dans le mois. L'erreur admissible ici est le faux NÉGATIF, jamais le faux
 * POSITIF.
 *
 * LE CORPUS EST DÉRIVÉ, JAMAIS TAPÉ
 * ---------------------------------
 * Une liste de chemins écrite à la main devient verte PAR DISPARITION : renommez
 * le fichier, la règle ne s'applique plus, et personne ne le voit. Le corpus est
 * donc la MARCHE de `apps/web/src` filtrée par un prédicat de CONTENU — un
 * fichier est une surface calendrier ssi son code (comments blanchis) nomme
 * `PortalCalendarEvent`, `CalendarEvent` ou `CalendarEventType`. Un nouvel écran
 * calendrier entre donc dans le corpus le jour où il est écrit, sans que
 * personne pense à ce fichier.
 *
 * Deux garde-fous complètent la dérivation :
 *   • un PLANCHER de sept chemins nommés (les cinq surfaces de rendu + les pages
 *     hôtes) : si l'un sort du corpus, le cliquet le NOMME au lieu de rétrécir en
 *     silence ;
 *   • une table d'EXCLUSIONS EXACTE des fichiers nommés `*[Cc]alendar*` qui ne
 *     sont PAS des surfaces d'événements calendrier, chacun avec sa raison
 *     mesurée et, quand c'est une dette, son id `PF-`. Un nouveau fichier
 *     « calendar » qui ne parle pas d'événements fera rougir ce test et forcera
 *     une décision explicite.
 *
 * CE QUE CE CLIQUET NE PROUVE PAS — LIMITES DÉCLARÉES, PAS IMPLICITES
 * -------------------------------------------------------------------
 * • Il juge du TEXTE (parsé). Son mode d'échec propre est le FAUX VERT : un
 *   prédicat exprimé sous une forme qu'il ne reconnaît pas passe. Il ne remplace
 *   donc pas la preuve comportementale — `calendar-window.spec.ts` — il
 *   l'accompagne.
 * • R3 suit l'affectation dans le MÊME fichier. Une valeur déjà tronquée passée
 *   en prop et dont le `.length` est rendu ailleurs n'est PAS vue. C'est `PF-404`,
 *   sa dette est CHIFFRÉE par un test dédié qui exécute la règle sur une fixture
 *   contrevenante et constate qu'elle passe — mesurée, jamais supposée.
 * • Il ne dit rien des POPULATIONS servies aux trois portails, et cette absence
 *   est délibérée : `calendar.controller.ts` sert admin ⊋ teacher ⊋ parent par
 *   construction, et le parent y fusionne des évaluations synthétiques. Une règle
 *   qui exigerait des totaux égaux entre portails serait rouge pour toujours, et
 *   la façon la moins chère de la rendre verte serait d'élargir la clause parent —
 *   c'est-à-dire de transformer une tranche de lecture en régression
 *   d'autorisation. L'invariant est l'égalité du PRÉDICAT, jamais des totaux.
 *
 * AUCUN INTERRUPTEUR (DNC-10) — et c'est vérifié sur le texte de ce fichier même.
 */

/* eslint-disable @typescript-eslint/no-require-imports */
const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..', '..');

/**
 * Le blanchisseur de commentaires, requis SANS garde (DNC-08) : s'il disparaît,
 * cette suite doit échouer au CHARGEMENT, jamais dégénérer en « rien à vérifier,
 * donc c'est vert ».
 */
const { stripCommentsPreservingLines } = require(
  join(REPO_ROOT, 'scripts', 'link-integrity-check.js'),
) as { stripCommentsPreservingLines: (source: string) => string };

/** Le seul endroit du dépôt où un chemin MARCHÉ devient son contenu (TOOL-17). */
const walkRead = require(join(REPO_ROOT, 'scripts', 'lib', 'walk-read.js')) as {
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

const WEB_SRC = join(REPO_ROOT, 'apps', 'web', 'src');
const CANONICAL_DIR = join(REPO_ROOT, 'packages', 'contracts', 'src', 'calendar');
const FIXTURES_DIR = join(__dirname, '__fixtures__', 'calendar-window');

/** Chemin relatif au dépôt, en séparateurs POSIX — Windows compris. */
function repoRel(path: string): string {
  return relative(REPO_ROOT, path).split('\\').join('/');
}

/* ================================================================== *
 * LA MARCHE
 * ================================================================== */

function walkSources(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (
        entry.name !== 'node_modules' &&
        entry.name !== 'dist' &&
        entry.name !== '.next' &&
        entry.name !== '__fixtures__' &&
        entry.name !== '__tests__'
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
      name.endsWith('.test.tsx') ||
      name.endsWith('.stories.ts') ||
      name.endsWith('.stories.tsx');
    if (isSource && !isExcluded) out.push(path);
  }
  return out;
}

const WEB_FILES = walkSources(WEB_SRC);
const CANONICAL_FILES = walkSources(CANONICAL_DIR);

/** `chemin relatif → source AVEC commentaires blanchis`. */
const webRead = walkRead.mapWalkedFiles<string>(WEB_FILES, (path, source) => [
  repoRel(path),
  stripCommentsPreservingLines(source),
]);
walkRead.warnSkipped('calendar-window-derivation-gate/web', webRead.skipped);
const WEB_EXECUTABLE = new Map(webRead.entries);

const canonicalRead = walkRead.mapWalkedFiles<string>(CANONICAL_FILES, (path, source) => [
  repoRel(path),
  stripCommentsPreservingLines(source),
]);
walkRead.warnSkipped('calendar-window-derivation-gate/contracts', canonicalRead.skipped);
const CANONICAL_EXECUTABLE = new Map(canonicalRead.entries);

/**
 * LE PRÉDICAT DE CORPUS. Un fichier `apps/web` est une surface calendrier ssi son
 * CODE nomme le type d'événement calendrier. Rien d'autre ne le décide — ni son
 * chemin, ni son nom, ni une liste.
 */
/**
 * `CalendarAnchor` a été AJOUTÉ à cette dérivation à la passe de land du run 92,
 * et le motif mérite d'être gardé : le cliquet avait correctement refusé
 * `apps/web/src/lib/school-calendar-anchor.ts`, un fichier que sa propre tranche
 * venait de créer sans le déclarer. Le remède le moins cher — l'inscrire dans la
 * table des EXCLUSIONS, « ce n'est pas une surface calendrier » — aurait été un
 * mensonge que le cliquet se serait ensuite mis à DÉFENDRE : ce module est la
 * provenance d'ancre des cinq pages portail. Il est donc GOUVERNÉ, pas exclu.
 *
 * L'y faire entrer ne coûte rien en faux positifs, et la raison est structurelle
 * plutôt que chanceuse : `R2` est écrite pour ne juger que les fichiers CLIENT
 * (voir son test de portée), or ce module n'a pas de directive `'use client'` —
 * son `new Date()` par défaut s'exécute côté serveur, une fois, ce qui est
 * exactement le remède de `A4` et non son symptôme.
 */
const CALENDAR_EVENT_TYPES =
  /\b(PortalCalendarEvent|CalendarEventType|CalendarEvent|CalendarAnchor)\b/;

const CORPUS = new Map(
  [...WEB_EXECUTABLE.entries()].filter(([, source]) => CALENDAR_EVENT_TYPES.test(source)),
);

/**
 * LE PLANCHER. Les sept chemins qui DOIVENT rester dans le corpus. Ce n'est pas
 * le corpus (il est dérivé) : c'est le garde-fou qui empêche la dérivation de
 * rétrécir en silence. Si vous déplacez l'un de ces fichiers, mettez cette liste
 * à jour DANS LE MÊME COMMIT — c'est le seul endroit où un chemin est écrit à la
 * main, et il est écrit pour qu'un rétrécissement soit NOMMÉ.
 */
const CORPUS_FLOOR = [
  'apps/web/src/components/calendar/PortalCalendarView.tsx',
  'apps/web/src/app/admin/calendar/CalendarManager.tsx',
  'apps/web/src/app/admin/calendar/page.tsx',
  'apps/web/src/app/parent/calendar/page.tsx',
  'apps/web/src/app/teacher/calendar/page.tsx',
  'apps/web/src/app/parent/dashboard/_components/SchoolEventsPanel.tsx',
  'apps/web/src/app/teacher/dashboard/_components/SchoolEventsPanel.tsx',
  // Ajouté au land du run 92 : la PROVENANCE de l'ancre est gouvernée au même
  // titre que les surfaces qui la consomment, sans quoi le foyer unique de `A4`
  // pourrait être contourné par un second résolveur que rien ne verrait.
  'apps/web/src/lib/school-calendar-anchor.ts',
];

/**
 * LES EXCLUSIONS, ÉCRITES ET MOTIVÉES. Fichiers nommés `*calendar*` qui ne sont
 * PAS des surfaces d'événements calendrier. Une portée rétrécie en silence se
 * relit plus tard comme « tout est couvert » — c'est la leçon de `PF-398`.
 */
const DECLARED_NON_CALENDAR_SURFACES: ReadonlyArray<readonly [string, string]> = [
  [
    'apps/web/src/app/parent/attendance/AttendanceCalendar.tsx',
    "MESURE, pas dette : la population est celle des SESSIONS d'assiduité (`CalendarRecord`), " +
      "jamais des événements de l'établissement. Aucun compteur calendrier n'en dépend.",
  ],
  [
    'apps/web/src/app/parent/upcoming/UpcomingCalendarExport.tsx',
    "MESURE, pas dette : export iCalendar d'ÉVALUATIONS, déclenché par un clic. " +
      "Son `new Date()` sert à horodater un nom de fichier dans un gestionnaire d'événement — " +
      "il ne rend aucun compteur et ne peut donc pas diverger entre SSR et hydratation.",
  ],
  [
    'apps/web/src/components/calendar/CalendarExportButton.tsx',
    'MESURE, pas dette : même forme que ci-dessus, côté calendrier scolaire. ' +
      'Il sérialise des `IcsEvent`, ne compte rien, et son horloge vit dans un handler.',
  ],
  [
    'apps/web/src/app/teacher/dashboard/_components/CalendarPanel.tsx',
    'DETTE DÉCLARÉE — `PF-403`. Mini-calendrier des ÉVALUATIONS (population distincte, ' +
      "donc hors de l'invariant de cette tranche), MAIS il porte les mêmes trois mécanismes : " +
      "appartenance au mois par `getMonth()`, `today` lu sur l'horloge du VISITEUR " +
      "(`'use client'`), et `.slice(0, 4)` silencieux. À traiter par sa propre tranche, " +
      'avec le prédicat canonique généralisé aux évaluations.',
  ],
];

/**
 * LA DETTE R2b, CHIFFRÉE. Accesseurs civils ambiants tolérés dans un composant
 * client du corpus : fichier, PLAFOND de sites, raison. Elle peut décroître ; une
 * ligne de plus, ou un site de plus dans un fichier déjà listé, fait rougir.
 *
 * C'est la forme `S-E03-6` / `PF-398` : une portée rétrécie s'ÉCRIT et se COMPTE,
 * sinon elle se relit un mois plus tard comme « tout est couvert ».
 */
const DECLARED_AMBIENT_CIVIL_ACCESSOR_DEBT: ReadonlyArray<readonly [string, number, string]> = [
  [
    'apps/web/src/app/admin/calendar/CalendarManager.tsx',
    3,
    'PF-405 — `toLocalDate` pré-remplit un `<input type="date">` du CRUD admin à partir ' +
      "d'une chaîne ISO. Ce n'est pas un compteur : la valeur n'est ni lue à voix haute ni " +
      'citée, et le CRUD est hors périmètre (AC-8). Le vrai remède est un formateur qui ' +
      "prend le fuseau de l'école en paramètre — sa propre tranche.",
  ],
];

/** Le total de la dette tolérée. Gelé : il ne peut que descendre, par une édition. */
const AMBIENT_CIVIL_ACCESSOR_DEBT_CEILING = 3;

/* ================================================================== *
 * L'ANALYSE — une seule fonction, exécutée sur le produit ET sur les fixtures
 * ================================================================== */

type Rule = 'R1' | 'R2' | 'R2b' | 'R3' | 'R4';

interface Finding {
  rule: Rule;
  kind: string;
  line: number;
  snippet: string;
}

/** Les accesseurs civils qui lisent le fuseau AMBIANT du processus courant. */
const AMBIENT_CIVIL_ACCESSORS = new Set(['getMonth', 'getDate', 'getDay', 'getFullYear']);

/**
 * Idem, plus `getHours` et `getTimezoneOffset` : la contrainte de pureté du
 * module canonique est stricte.
 *
 * `getTimezoneOffset` est ajouté par la correction de `PF-406`. La première
 * version de la tranche l'appelait dans `resolveCalendarAnchor` et passait ce
 * cliquet : l'accesseur n'était pas dans la liste, et une revue a dû le trouver
 * à la main. Or c'est L'ambiant le plus dangereux du lot — les autres rendent un
 * champ civil faux, celui-ci rend un DÉCALAGE faux, donc décale silencieusement
 * TOUTES les bornes (le conteneur `web` est en UTC, l'école à `Europe/Paris`).
 * Le fuseau de l'école se DÉCLARE ; sa résolution vit hors du module canonique,
 * dans `packages/contracts/src/school-time/anchor.ts` (ADR-078 §D3).
 */
const CANONICAL_FORBIDDEN_ACCESSORS = new Set([
  ...AMBIENT_CIVIL_ACCESSORS,
  'getHours',
  'getTimezoneOffset',
]);

/**
 * Les noms de VALEUR que le module canonique exporte — DÉRIVÉS de sa source, pas
 * recopiés. Deux listes tenues à la main dérivent ; c'est le défaut que cette
 * tranche ferme, il serait absurde de l'instancier dans son propre cliquet.
 */
function canonicalValueExports(): Set<string> {
  const names = new Set<string>();
  for (const [path, source] of CANONICAL_EXECUTABLE) {
    const sf = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const statement of sf.statements as any[]) {
      const exported = (statement.modifiers ?? []).some(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (m: any) => m.kind === ts.SyntaxKind.ExportKeyword,
      );
      if (!exported) continue;
      if (ts.isFunctionDeclaration(statement) && statement.name) {
        names.add(statement.name.text);
      } else if (ts.isVariableStatement(statement)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const decl of statement.declarationList.declarations as any[]) {
          if (ts.isIdentifier(decl.name)) names.add(decl.name.text);
        }
      }
    }
  }
  return names;
}

const CANONICAL_EXPORTS = canonicalValueExports();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isDeclarationName(node: any): boolean {
  const parent = node.parent;
  if (!parent) return false;
  return (
    ((ts.isFunctionDeclaration(parent) ||
      ts.isVariableDeclaration(parent) ||
      ts.isClassDeclaration(parent) ||
      ts.isParameter(parent) ||
      ts.isMethodDeclaration(parent) ||
      ts.isInterfaceDeclaration(parent) ||
      ts.isTypeAliasDeclaration(parent) ||
      ts.isBindingElement(parent)) &&
      parent.name === node) ||
    (ts.isImportSpecifier(parent) && parent.name === node) ||
    (ts.isImportClause(parent) && parent.name === node)
  );
}

/** Un identifiant en position de PROPRIÉTÉ n'est pas une référence à une liaison. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isPropertyPosition(node: any): boolean {
  const parent = node.parent;
  if (!parent) return false;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return true;
  if (ts.isPropertyAssignment(parent) && parent.name === node) return true;
  if (ts.isPropertySignature(parent) && parent.name === node) return true;
  if (ts.isJsxAttribute(parent) && parent.name === node) return true;
  if (ts.isQualifiedName(parent) && parent.right === node) return true;
  if (ts.isBindingElement(parent) && parent.propertyName === node) return true;
  return false;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function hasAncestor(node: any, predicate: (n: unknown) => boolean): boolean {
  let current = node.parent;
  while (current) {
    if (predicate(current)) return true;
    current = current.parent;
  }
  return false;
}

/** Le sous-arbre contient-il une référence (identifiant ou propriété) nommée `name` ? */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function subtreeNames(node: any, name: string): boolean {
  let found = false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const visit = (n: any) => {
    if (found) return;
    if (ts.isIdentifier(n) && n.text === name) {
      found = true;
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

/** Le sous-arbre appelle-t-il `x.<name>()` ? */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function subtreeCalls(node: any, name: string): boolean {
  let found = false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const visit = (n: any) => {
    if (found) return;
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      n.expression.name.text === name
    ) {
      found = true;
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

/** `new Date(…)` — et son arité. `null` quand ce n'est pas une construction de `Date`. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function dateConstructionArity(node: any): number | null {
  if (!ts.isNewExpression(node)) return null;
  if (!ts.isIdentifier(node.expression) || node.expression.text !== 'Date') return null;
  return node.arguments ? node.arguments.length : 0;
}

/** `.slice(<littéral>, <littéral>)` — la troncature déclarée, littérale, reconnaissable. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isLiteralSliceCall(node: any): boolean {
  if (!ts.isCallExpression(node)) return false;
  if (!ts.isPropertyAccessExpression(node.expression)) return false;
  if (node.expression.name.text !== 'slice') return false;
  if (node.arguments.length !== 2) return false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return node.arguments.every((arg: any) => ts.isNumericLiteral(arg));
}

/**
 * ANALYSE UN FICHIER. `source` doit déjà avoir ses commentaires blanchis.
 *
 * `scope` choisit le jeu de règles : `'web'` (R1 + R2 + R3) ou `'canonical'` (R4).
 * Le produit et les fixtures passent par CETTE fonction, sans exception — c'est
 * la seule construction qui rende le contrôle positif honnête.
 */
function analyse(path: string, source: string, scope: 'web' | 'canonical'): Finding[] {
  const scriptKind = path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, scriptKind);
  const findings: Finding[] = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lineOf = (node: any): number =>
    (sf.getLineAndCharacterOfPosition(node.getStart(sf)).line as number) + 1;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const textOf = (node: any): string => node.getText(sf).replace(/\s+/g, ' ').slice(0, 140);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const report = (rule: Rule, kind: string, node: any) =>
    findings.push({ rule, kind, line: lineOf(node), snippet: textOf(node) });

  const firstStatement = sf.statements[0];
  const isClient =
    !!firstStatement &&
    ts.isExpressionStatement(firstStatement) &&
    ts.isStringLiteral(firstStatement.expression) &&
    firstStatement.expression.text === 'use client';

  /* ── passe 1 : imports, déclarations, liaisons tronquées ─────────────── */
  const importedFromContracts = new Set<string>();
  let importsContractsNamespace = false;
  const declaredNames = new Set<string>();
  const truncatedBindings = new Set<string>();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const collect = (node: any) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      if (node.moduleSpecifier.text === '@pilotage/contracts') {
        const clause = node.importClause;
        if (clause?.name) importedFromContracts.add(clause.name.text);
        if (clause?.namedBindings) {
          if (ts.isNamespaceImport(clause.namedBindings)) importsContractsNamespace = true;
          else {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            for (const spec of clause.namedBindings.elements as any[]) {
              // Le nom LOCAL et le nom D'ORIGINE : `upcomingEvents as allUpcomingEvents`
              // est un import canonique, pas un contournement, et les deux formes
              // doivent compter comme « importé du foyer canonique ».
              importedFromContracts.add(spec.name.text);
              if (spec.propertyName) importedFromContracts.add(spec.propertyName.text);
            }
          }
        }
      }
      if (scope === 'canonical') report('R4', 'import dans le module canonique', node);
    }
    if (scope === 'canonical' && ts.isImportEqualsDeclaration(node)) {
      report('R4', 'import dans le module canonique', node);
    }
    if (
      scope === 'canonical' &&
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'require'
    ) {
      report('R4', 'import dans le module canonique', node);
    }

    if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name) {
      declaredNames.add(node.name.text);
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      declaredNames.add(node.name.text);
      if (node.initializer) {
        let truncated = false;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const scan = (n: any) => {
          if (truncated) return;
          if (isLiteralSliceCall(n)) {
            truncated = true;
            return;
          }
          ts.forEachChild(n, scan);
        };
        scan(node.initializer);
        if (truncated) truncatedBindings.add(node.name.text);
      }
    }

    ts.forEachChild(node, collect);
  };
  collect(sf);

  /* ── passe 2 : les règles ────────────────────────────────────────────── */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const judge = (node: any) => {
    const arity = dateConstructionArity(node);

    if (scope === 'web') {
      // R1 — une fenêtre bâtie à la main.
      if (arity !== null && arity >= 2) {
        report('R1', 'fenêtre calendrier construite à la main (new Date d’arité ≥ 2)', node);
      }

      // R1 — une SECONDE déclaration d'un nom canonique.
      if (
        (ts.isFunctionDeclaration(node) || ts.isVariableDeclaration(node)) &&
        node.name &&
        ts.isIdentifier(node.name) &&
        CANONICAL_EXPORTS.has(node.name.text)
      ) {
        report('R1', `seconde déclaration du prédicat canonique « ${node.name.text} »`, node);
      }

      // R1 — un prédicat « à venir » écrit à la main sur `endsAt`.
      if (
        ts.isBinaryExpression(node) &&
        (node.operatorToken.kind === ts.SyntaxKind.GreaterThanEqualsToken ||
          node.operatorToken.kind === ts.SyntaxKind.GreaterThanToken) &&
        subtreeNames(node.left, 'endsAt')
      ) {
        report('R1', 'prédicat « à venir » écrit à la main sur endsAt', node);
      }

      // R1 — appartenance au mois par composante, SANS comparer l'année.
      if (
        ts.isBinaryExpression(node) &&
        (node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken ||
          node.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken) &&
        subtreeCalls(node.left, 'getMonth') &&
        subtreeCalls(node.right, 'getMonth')
      ) {
        report('R1', 'appartenance au mois comparée sans l’année (getMonth === getMonth)', node);
      }

      // R1 — un nom canonique employé sans être importé du foyer canonique.
      if (
        ts.isIdentifier(node) &&
        CANONICAL_EXPORTS.has(node.text) &&
        !isDeclarationName(node) &&
        !isPropertyPosition(node) &&
        !declaredNames.has(node.text) &&
        !importsContractsNamespace &&
        !importedFromContracts.has(node.text) &&
        !hasAncestor(node, (n) => ts.isImportDeclaration(n))
      ) {
        report('R1', `« ${node.text} » employé sans import de @pilotage/contracts`, node);
      }

      // R2 — l'horloge et le calendrier du VISITEUR, dans un composant client.
      if (isClient) {
        if (arity === 0) {
          report('R2', 'new Date() — l’horloge du visiteur dans un composant client', node);
        }
        if (
          ts.isCallExpression(node) &&
          ts.isPropertyAccessExpression(node.expression) &&
          ts.isIdentifier(node.expression.expression) &&
          node.expression.expression.text === 'Date' &&
          node.expression.name.text === 'now'
        ) {
          report('R2', 'Date.now() — l’horloge du visiteur dans un composant client', node);
        }
        if (
          ts.isCallExpression(node) &&
          ts.isPropertyAccessExpression(node.expression) &&
          AMBIENT_CIVIL_ACCESSORS.has(node.expression.name.text)
        ) {
          report(
            'R2b',
            `${node.expression.name.text}() — accesseur civil lu dans le fuseau du visiteur`,
            node,
          );
        }
      }

      // R3 — le `.length` d'une liaison TRONQUÉE rendu en JSX sans son vrai total.
      if (
        ts.isPropertyAccessExpression(node) &&
        node.name.text === 'length' &&
        ts.isIdentifier(node.expression) &&
        truncatedBindings.has(node.expression.text) &&
        hasAncestor(node, (n) => ts.isJsxExpression(n))
      ) {
        let host = node.parent;
        while (
          host &&
          !ts.isJsxElement(host) &&
          !ts.isJsxFragment(host) &&
          !ts.isJsxSelfClosingElement(host)
        ) {
          host = host.parent;
        }
        const hostText = (host ?? node).getText(sf);
        if (!/total/i.test(hostText)) {
          report(
            'R3',
            `« ${node.expression.text}.length » est la longueur d’une liste TRONQUÉE, ` +
              'rendue sans le total non tronqué',
            node,
          );
        }
      }
    }

    if (scope === 'canonical') {
      if (arity !== null && arity !== 1) {
        report('R4', `new Date d’arité ${arity} dans le module canonique`, node);
      }
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        ts.isIdentifier(node.expression.expression) &&
        node.expression.expression.text === 'Date' &&
        node.expression.name.text === 'now'
      ) {
        report('R4', 'Date.now() dans le module canonique', node);
      }
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        CANONICAL_FORBIDDEN_ACCESSORS.has(node.expression.name.text)
      ) {
        report(
          'R4',
          `${node.expression.name.text}() — accesseur civil ambiant dans le module canonique`,
          node,
        );
      }
    }

    ts.forEachChild(node, judge);
  };
  judge(sf);

  return findings;
}

/** Rend un rapport LISIBLE : jamais un compte nu, toujours fichier + ligne + règle. */
function formatFindings(entries: Array<[string, Finding[]]>): string[] {
  const out: string[] = [];
  for (const [path, findings] of entries) {
    for (const f of findings) out.push(`${path}:${f.line} [${f.rule}] ${f.kind} — ${f.snippet}`);
  }
  return out;
}

function analyseFixture(name: string, scope: 'web' | 'canonical'): Finding[] {
  const source = readFileSync(join(FIXTURES_DIR, name), 'utf8');
  // La fixture porte l'extension `.txt` pour rester hors de `tsc`, d'ESLint et du
  // `testMatch`. On lui rend son extension réelle uniquement pour choisir le
  // `ScriptKind` — l'analyse est celle du produit, à l'identique.
  return analyse(name.replace(/\.txt$/, ''), stripCommentsPreservingLines(source), scope);
}

const CORPUS_FINDINGS: Array<[string, Finding[]]> = [...CORPUS.entries()].map(([path, source]) => [
  path,
  analyse(path, source, 'web'),
]);

const CANONICAL_FINDINGS: Array<[string, Finding[]]> = [...CANONICAL_EXECUTABLE.entries()].map(
  ([path, source]) => [path, analyse(path, source, 'canonical')],
);

function findingsFor(rule: Rule): Array<[string, Finding[]]> {
  return CORPUS_FINDINGS.map(
    ([path, findings]) => [path, findings.filter((f) => f.rule === rule)] as [string, Finding[]],
  ).filter(([, findings]) => findings.length > 0);
}

/* ================================================================== *
 * LES TESTS
 * ================================================================== */

describe('S-E03-8 / PF-40 — le corpus calendrier est DÉRIVÉ, et il ne rétrécit pas en silence', () => {
  it('la marche de apps/web/src reste crédible et ne perd pas de fichiers', () => {
    expect(WEB_FILES.length).toBeGreaterThanOrEqual(300);
    expect(webRead.skipped.length).toBeLessThanOrEqual(walkRead.maxVanishedFor(WEB_FILES.length));
    expect(WEB_EXECUTABLE.size).toBeGreaterThanOrEqual(
      WEB_FILES.length - walkRead.maxVanishedFor(WEB_FILES.length),
    );
  });

  it('le corpus est le résultat du prédicat de CONTENU, pas d’une liste de chemins', () => {
    expect(CORPUS.size).toBeGreaterThanOrEqual(8);
    for (const [path, source] of CORPUS) {
      expect(CALENDAR_EVENT_TYPES.test(source)).toBe(true);
      expect(path.startsWith('apps/web/src/')).toBe(true);
    }
  });

  it('PLANCHER — les sept surfaces gouvernées sont toutes dans le corpus', () => {
    const missing = CORPUS_FLOOR.filter((path) => !CORPUS.has(path));
    expect({
      missing,
      why:
        'Un fichier gouverné a quitté le corpus. Soit il a été déplacé — mettez CORPUS_FLOOR à ' +
        'jour dans le MÊME commit — soit il a cessé de nommer le type d’événement calendrier, ' +
        'et c’est le prédicat de corpus qu’il faut revoir. Ne jamais retirer une ligne d’ici ' +
        'pour faire passer le test.',
    }).toEqual({ missing: [], why: expect.any(String) });
  });

  it('EXCLUSIONS — chaque fichier « calendar » hors corpus est déclaré et motivé', () => {
    const namedCalendar = [...WEB_EXECUTABLE.keys()].filter((path) =>
      /calendar/i.test(path.split('/').pop() ?? ''),
    );
    const undeclared = namedCalendar
      .filter((path) => !CORPUS.has(path))
      .filter((path) => !DECLARED_NON_CALENDAR_SURFACES.some(([declared]) => declared === path));
    expect(undeclared).toEqual([]);

    // La table ne peut pas grossir en silence non plus : sa taille est GELÉE.
    expect(DECLARED_NON_CALENDAR_SURFACES).toHaveLength(4);
    for (const [path, reason] of DECLARED_NON_CALENDAR_SURFACES) {
      expect(WEB_EXECUTABLE.has(path)).toBe(true);
      expect(CORPUS.has(path)).toBe(false);
      expect(reason.length).toBeGreaterThan(60);
    }
  });

  it('le module canonique est le SEUL foyer, et ses exports sont dérivés de sa source', () => {
    expect(CANONICAL_FILES.length).toBeGreaterThanOrEqual(1);
    expect(CANONICAL_EXPORTS.size).toBeGreaterThanOrEqual(12);
    for (const name of ['monthWindow', 'weekWindow', 'eventOverlapsWindow', 'upcomingEvents']) {
      expect([...CANONICAL_EXPORTS]).toContain(name);
    }
  });
});

describe('R1 — il existe EXACTEMENT UN prédicat de fenêtre calendrier déclaré', () => {
  it('aucune surface calendrier ne déclare la sienne', () => {
    expect(formatFindings(findingsFor('R1'))).toEqual([]);
  });

  it('CONTRÔLE POSITIF — la fixture contrevenante est bien VUE, sur ses quatre formes', () => {
    const findings = analyseFixture('r1-second-home.tsx.txt', 'web').filter((f) => f.rule === 'R1');
    const kinds = findings.map((f) => f.kind);

    expect(findings.length).toBeGreaterThanOrEqual(4);
    expect(kinds.some((k) => k.includes('construite à la main'))).toBe(true);
    expect(kinds.some((k) => k.includes('seconde déclaration'))).toBe(true);
    expect(kinds.some((k) => k.includes('à venir'))).toBe(true);
    expect(kinds.some((k) => k.includes('sans l’année'))).toBe(true);
    for (const f of findings) expect(f.line).toBeGreaterThan(0);
  });
});

describe('R2 — aucun compteur calendrier ne dépend de l’horloge du VISITEUR', () => {
  it('aucun composant client du corpus ne lit l’horloge ni le calendrier ambiant', () => {
    expect(formatFindings(findingsFor('R2'))).toEqual([]);
  });

  it('CONTRÔLE POSITIF — la fixture cliente contrevenante est bien VUE', () => {
    const findings = analyseFixture('r2-viewer-clock.tsx.txt', 'web');
    const hard = findings.filter((f) => f.rule === 'R2').map((f) => f.kind);
    const ambient = findings.filter((f) => f.rule === 'R2b').map((f) => f.kind);

    expect(hard.some((k) => k.startsWith('new Date()'))).toBe(true);
    expect(hard.some((k) => k.startsWith('Date.now()'))).toBe(true);
    expect(ambient.some((k) => k.startsWith('getMonth()'))).toBe(true);
    expect(ambient.some((k) => k.startsWith('getDate()'))).toBe(true);
    expect(ambient.some((k) => k.startsWith('getFullYear()'))).toBe(true);
  });

  it('la portée de R2 est le fichier CLIENT — un composant serveur n’est pas jugé par elle', () => {
    // Elle est écrite comme ça exprès : les deux `SchoolEventsPanel` s'exécutent
    // côté serveur, leur horloge ne peut pas diverger d'une hydratation. Ce qui
    // les concerne est R1 (ils REDÉCLARAIENT le prédicat), pas R2.
    const clientSource = readFileSync(join(FIXTURES_DIR, 'r2-viewer-clock.tsx.txt'), 'utf8');
    const asServer = clientSource.replace("'use client';", '');
    const findings = analyse(
      'server-variant.tsx',
      stripCommentsPreservingLines(asServer),
      'web',
    ).filter((f) => f.rule === 'R2' || f.rule === 'R2b');
    expect(findings).toEqual([]);
  });

  it('R2b — la dette d’accesseurs civils ambiants est ÉNUMÉRÉE, PLAFONNÉE, et ne grandit pas', () => {
    const declared = new Map(
      DECLARED_AMBIENT_CIVIL_ACCESSOR_DEBT.map(([path, cap]) => [path, cap] as const),
    );

    const measured = new Map<string, number>();
    for (const [path, findings] of CORPUS_FINDINGS) {
      const count = findings.filter((f) => f.rule === 'R2b').length;
      if (count > 0) measured.set(path, count);
    }

    // Aucun fichier NON déclaré ne porte cette dette.
    expect([...measured.keys()].filter((path) => !declared.has(path))).toEqual([]);
    // Aucun fichier déclaré ne la fait grandir. Le message NOMME le fichier :
    // un compte sans identité est le « je ne peux pas trancher » que DNC-08 refuse.
    const overruns = [...measured.entries()]
      .filter(([path, count]) => count > (declared.get(path) ?? 0))
      .map(([path, count]) => `${path} : ${count} sites pour un plafond de ${declared.get(path)}`);
    expect(overruns).toEqual([]);
    // Le plafond lui-même est gelé : le relever demande une édition explicite.
    expect(
      DECLARED_AMBIENT_CIVIL_ACCESSOR_DEBT.reduce((sum, [, cap]) => sum + cap, 0),
    ).toBe(AMBIENT_CIVIL_ACCESSOR_DEBT_CEILING);
    // Une entrée qui ne désigne plus rien serait une dette fantôme : elle doit
    // au moins pointer un fichier encore gouverné.
    for (const [path, , reason] of DECLARED_AMBIENT_CIVIL_ACCESSOR_DEBT) {
      expect(CORPUS.has(path)).toBe(true);
      expect(reason).toContain('PF-');
    }
  });
});

describe('R3 — un plafond ne se fait jamais passer pour un total', () => {
  it('aucun en-tête calendrier ne rend la longueur d’une liste tronquée', () => {
    expect(formatFindings(findingsFor('R3'))).toEqual([]);
  });

  it('CONTRÔLE POSITIF — « 12 prochains » sur une liste coupée à 12 est bien VU', () => {
    const findings = analyseFixture('r3-truncated-total.tsx.txt', 'web').filter(
      (f) => f.rule === 'R3',
    );
    expect(findings).toHaveLength(1);
    expect(findings.map((f) => f.kind).join(' ')).toContain('TRONQUÉE');
  });

  it('CONTRÔLE NÉGATIF — « 12 affichés sur 39 » reste VERT, sinon le remède serait irréalisable', () => {
    expect(analyseFixture('r3-paired-total.tsx.txt', 'web')).toEqual([]);
  });

  it('LIMITE ÉCRITE — l’indicateur de débordement d’une case de jour n’est PAS un total tronqué', () => {
    // `+{dayEvents.length - 3}` compte la liste COMPLÈTE du jour ; la coupe à 3 est
    // appliquée en ligne au rendu. R3 ne suit que les LIAISONS affectées depuis une
    // chaîne se terminant par `.slice(0, N)`.
    expect(analyseFixture('clean-surface.tsx.txt', 'web')).toEqual([]);
  });

  it('DETTE CHIFFRÉE — PF-404 : R3 ne franchit pas une frontière de composant', () => {
    // Mesurée, pas supposée : la fixture PORTE le défaut d'AC-3 et le cliquet
    // passe. C'est la forme S-E03-6 / PF-398 — une portée rétrécie s'écrit.
    const findings = analyseFixture('r3-cross-file-limit.tsx.txt', 'web');
    expect(findings).toEqual([]);
  });
});

describe('R4 — le module canonique reste PUR, ou il ré-ouvre A4 en silence', () => {
  it('packages/contracts/src/calendar/** n’importe rien et ne lit aucun fuseau ambiant', () => {
    expect(formatFindings(CANONICAL_FINDINGS.filter(([, f]) => f.length > 0))).toEqual([]);
  });

  it('CONTRÔLE POSITIF — un module canonique redevenu impur est bien VU', () => {
    const findings = analyseFixture('r4-impure-window.ts.txt', 'canonical');
    const kinds = findings.map((f) => f.kind);

    expect(findings.length).toBeGreaterThanOrEqual(4);
    expect(kinds.some((k) => k.includes('import dans le module canonique'))).toBe(true);
    expect(kinds.some((k) => k.includes('Date.now()'))).toBe(true);
    expect(kinds.some((k) => k.includes('d’arité 3'))).toBe(true);
    expect(kinds.some((k) => k.startsWith('getFullYear()'))).toBe(true);
    expect(kinds.every((k) => typeof k === 'string')).toBe(true);
    expect(findings.every((f) => f.rule === 'R4')).toBe(true);
  });

  it('`new Date(iso)` d’arité 1 reste LÉGITIME dans le module canonique', () => {
    // Parser une chaîne ISO est indépendant du fuseau ; interdire l'arité 1
    // rendrait le module incapable de lire un événement. La règle vise l'arité
    // ≠ 1, pas `Date` en général.
    const findings = analyse(
      'probe.ts',
      'export function f(s: string) { return new Date(s).getTime(); }',
      'canonical',
    );
    expect(findings).toEqual([]);
  });
});

describe('ROUGE-AVANT — le cliquet est FALSIFIABLE sur la vraie source qu’il a corrigée', () => {
  /**
   * Le contrôle positif que `PF-366` réclame, dans sa forme la plus forte : ce ne
   * sont pas quatre micro-fixtures écrites pour la règle, c'est le FICHIER DE
   * PRODUCTION tel qu'il était sur `main` avant cette tranche, gelé et rejoué à
   * travers exactement le même `analyse()`. Un cliquet qui ne peut pas rougir sur
   * le code qu'il prétend avoir corrigé ne prouve rien.
   */
  const preFix = analyseFixture('pre-fix-PortalCalendarView.tsx.txt', 'web');

  it('la source pré-correction déclenche les trois règles de surface, pas une seule', () => {
    const byRule = (rule: Rule) => preFix.filter((f) => f.rule === rule);
    expect(byRule('R1').length).toBeGreaterThan(0);
    expect(byRule('R2').length).toBeGreaterThan(0);
    expect(byRule('R3').length).toBeGreaterThan(0);
  });

  it('A1 — la fenêtre de mois bâtie à la main et sa borne fermée sont VUES', () => {
    const kinds = preFix.filter((f) => f.rule === 'R1').map((f) => f.kind);
    expect(kinds.some((k) => k.includes('construite à la main'))).toBe(true);
  });

  it('A3 — « N prochains » sur une liste coupée à 12 est VU', () => {
    const r3 = preFix.filter((f) => f.rule === 'R3');
    expect(r3.length).toBeGreaterThan(0);
    expect(r3.map((f) => f.kind).join(' ')).toContain('TRONQUÉE');
  });

  it('A4 — l’horloge du visiteur au scope de rendu est VUE', () => {
    const kinds = preFix.filter((f) => f.rule === 'R2').map((f) => f.kind);
    expect(kinds.some((k) => k.startsWith('new Date()'))).toBe(true);
    expect(kinds.some((k) => k.startsWith('Date.now()'))).toBe(true);
  });

  it('et la MÊME analyse, sur la source d’AUJOURD’HUI, est silencieuse', () => {
    // Les deux moitiés de la preuve dans un seul fichier : la même fonction, deux
    // entrées, deux verdicts opposés. C'est ce qui rend « c'est corrigé » vérifiable
    // plutôt qu'affirmé.
    const today = CORPUS.get('apps/web/src/components/calendar/PortalCalendarView.tsx');
    expect(typeof today).toBe('string');
    expect(
      analyse(
        'apps/web/src/components/calendar/PortalCalendarView.tsx',
        today ?? '',
        'web',
      ).filter((f) => f.rule !== 'R2b'),
    ).toEqual([]);
  });
});

describe('LE CLIQUET JUGE DU CODE, PAS DE LA PROSE', () => {
  it('une fixture dont les COMMENTAIRES et les CHAÎNES portent les quatre formes reste VERTE', () => {
    expect(analyseFixture('prose-only.tsx.txt', 'web')).toEqual([]);
  });

  it('le blanchiment préserve les numéros de ligne, donc les diagnostics restent exacts', () => {
    const source = readFileSync(join(FIXTURES_DIR, 'r1-second-home.tsx.txt'), 'utf8');
    const stripped = stripCommentsPreservingLines(source);
    expect(stripped.split('\n')).toHaveLength(source.split('\n').length);
    expect(stripped).toHaveLength(source.length);
  });

  it('AUCUN INTERRUPTEUR (DNC-10) — vérifié sur le texte de ce fichier même', () => {
    const ownSource = readFileSync(
      join(__dirname, 'calendar-window-derivation-gate.spec.ts'),
      'utf8',
    );
    // Les motifs sont ASSEMBLÉS pour que ce test ne se trouve pas lui-même.
    const switches = [
      'SKI' + 'P_',
      'ALLO' + 'W_',
      'DISAB' + 'LE_',
      'process' + '.' + 'env',
      'it' + '.skip',
      'describe' + '.skip',
      'x' + 'it(',
    ];
    const offenders = switches.filter((token) => ownSource.includes(token));
    expect(offenders).toEqual([]);
  });
});
