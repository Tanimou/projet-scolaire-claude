import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

/**
 * S-E03-11 / PF-50 / PF-427 / ADR-081 §D5 — LE CLIQUET : plus aucune surface ne
 * RÉ-ÉCRIT à la main « quelle forme la réponse a-t-elle ? ».
 *
 * LES TROIS RÈGLES, EN UNE LIGNE CHACUNE
 * ---------------------------------------
 * Hors du fichier qui DÉCLARE `pageEnvelope`, est un contrevenant :
 *
 *   R1 — une déclaration de type NOMMÉE d'`apps/web/src` portant À LA FOIS une
 *        clé `data` et une clé `total` : une enveloppe transcrite à la main.
 *        PLAFOND DÉCROISSANT + ENSEMBLE DE CHEMINS FERMÉ.
 *        Mesuré AVANT la tranche : **5**. Gelé APRÈS : **1**.
 *
 *   R2 — un transtypage EN LIGNE `api<{ … data … total … }>(…)` : la même
 *        transcription, sans même un nom auquel l'accrocher.
 *        PLAFOND DÉCROISSANT + ENSEMBLE DE CHEMINS FERMÉ.
 *        Mesuré avant ET après : **6** (aucun n'est dans le périmètre).
 *
 *   R3 — LE FOYER, par ÉGALITÉ DE CHEMIN sur UN fichier : exactement un fichier
 *        du dépôt déclare `pageEnvelope`. Pas un glob, pas une liste
 *        d'exemptions.
 *
 * POURQUOI DES PLAFONDS ET NON DES TOLÉRANCES ZÉRO (ADR-081 §D5)
 * --------------------------------------------------------------
 * Parce que le recensement RÉEL contredit le brief, et qu'un cliquet doit être
 * gelé sur ce qui EST, pas sur ce qu'on espérait :
 *
 *   R1 = 5 avant, pas 4. La cinquième est `apps/web/src/lib/parent-children.ts:44`,
 *   une enveloppe du PORTAIL PARENT, lue par une douzaine de pages parent, et
 *   dont le `total?` est OPTIONNEL alors que l'API l'envoie toujours. La
 *   convertir toucherait le chemin chaud du tableau de bord parent (< 2 s,
 *   GUARDRAILS §1) et n'est PAS dans cette tranche. Elle est COMPTÉE, jamais
 *   ALLOWLISTÉE, et enregistrée en `PF-429`.
 *
 *   R2 = 6, pas 0. Cinq dans `admin/alerts/page.tsx` (:119,126,133,140,150) et
 *   une dans `admin/users/page.tsx` (:38). Une tolérance zéro le premier jour
 *   aurait exigé soit six conversions hors périmètre, soit une allowlist — les
 *   deux sorties qu'`academic-year-resolution-gate.spec.ts:20-32` nomme et
 *   INTERDIT. Enregistrées en `PF-428`.
 *
 * ⚠ LE PLAFOND SEUL NE SUFFIT PAS, ET C'EST LE POINT. Un plafond de 5 resterait
 * satisfait si l'on convertissait quatre sites et qu'on en écrivait quatre
 * NOUVEAUX ailleurs. Chaque règle porte donc AUSSI un ENSEMBLE DE CHEMINS
 * FERMÉ : tout résiduel doit être l'un des fichiers déjà recensés. Une
 * déclaration neuve rougit même à compte constant. C'est cela, « aucune NOUVELLE
 * forme écrite à la main ».
 *
 * LES QUATRE DÉCISIONS D'INCLUSION, EN CODE ET NON EN PROSE (ADR-081 §D5)
 * -----------------------------------------------------------------------
 * Le brief annonçait « QUATRE déclarations » et « 198 sites `api<>` » ; la
 * mesure rend 5 + 6 et 208. Deux dénominateurs différents PROUVENT qu'un
 * recensement en prose est infalsifiable. La définition est donc CE CODE :
 *
 *   1. RACINE — `apps/web/src` SEUL pour R1/R2. `packages/` n'est marché que
 *      pour R3 (le foyer). `apps/api` déclare ses enveloppes en TypeScript
 *      serveur, gouverné par `PageEnvelope` et non par ce cliquet.
 *   2. SPECS — `*.spec.ts(x)` / `*.test.ts(x)` / `.d.ts` / `__fixtures__`
 *      EXCLUS : un cliquet qui rougit sur chaque nouveau test est relâché sous
 *      deux runs.
 *   3. UNITÉ — pour R2, UNE EXPRESSION D'APPEL `api<…>(…)`. Pas une occurrence
 *      textuelle : `grep 'api<'` compte les commentaires et rend 211 là où
 *      l'AST rend 208.
 *   4. « ENVELOPPE » — un texte de type portant À LA FOIS un membre `data` et un
 *      membre `total`, optionnels COMPRIS (`total?` est la forme de
 *      `parent-children.ts`, et l'exclure aurait effacé la seule occurrence non
 *      admin du recensement).
 *
 * PLANCHERS D'ANTI-VACUITÉ, ET POURQUOI PLUSIEURS
 * ------------------------------------------------
 * Un marcheur qui ne trouve rien doit ROUGIR, pas passer. Plancher de fichiers
 * marchés (381 mesurés), plancher de sites `api<…>(` (208 mesurés — sans lui,
 * « 0 transtypage d'enveloppe » serait satisfait par « 0 appel `api` vu »),
 * plancher de transtypages `{ data }` SANS `total` (88 mesurés — il prouve que
 * le classifieur d'ARGUMENTS DE TYPE fonctionne, indépendamment du recensement
 * qu'il gèle), plancher de fichiers `packages/`, et EXACTEMENT UN foyer
 * déclarant.
 *
 * ⚠ CHAQUE RÈGLE EST DÉMONTRÉE CAPABLE DE ROUGIR. Les fixtures de
 * `__fixtures__/page-envelope/` passent au MÊME classifieur que l'arbre, et l'on
 * assied qu'il rougit sur `pre-fix-reintroduced-envelope` (les DEUX formes du
 * défaut dans un seul fichier) et reste vert sur `clean-surface`.
 *
 * `MANUAL_ALLOWLIST` existe, est nommée, et EXPÉDIE VIDE — une assertion le
 * vérifie. Aucune variable d'environnement, aucun `NODE_ENV`, aucun `SKIP_*` /
 * `ALLOW_*` (DNC-10). Les helpers requis le sont SANS garde : s'ils
 * s'évaporent, cette suite doit mourir au CHARGEMENT plutôt que dégénérer en
 * « rien à vérifier » (DNC-08).
 *
 * ⚠ CE CLIQUET EST ÉCRIT SOUS `apps/api` PARCE QU'`apps/web` N'A AUCUN RUNNER
 * DE TESTS UNITAIRES (seulement Playwright). Il MARCHE LES FICHIERS DEPUIS LE
 * DISQUE et n'IMPORTE rien d'`apps/web`, ce qui le tient à l'écart du piège
 * `rootDir`/TS6059 ; `apps/api/tsconfig.build.json` exclut les `*.spec.ts`.
 * Aucun `rootDir` n'est ajouté, et si quelqu'un en propose un, c'est un
 * drapeau rouge.
 *
 * CE QUE CE CLIQUET NE PROUVE PAS
 * -------------------------------
 * Il prouve une FORME sur le disque. Que le cadre ne DÉPOUILLE pas est porté, et
 * de façon EXÉCUTÉE, par `apps/api/src/shared/pagination/page-envelope.spec.ts`.
 * Confondre les deux serait DNC-06. Aucune sonde vivante n'a été lancée (Docker
 * Desktop refuse de démarrer, 6ᵉ run ; `pilotage@5432` est vide) : rien ici ne
 * dit ce que fait l'application en vol.
 *
 * ⚠ SUR QUEL ARBRE LES PLAFONDS SONT GELÉS, ÉCRIT PLUTÔT QUE TU. La moitié
 * `apps/web` de cette tranche est écrite par un AUTRE agent, sur des fichiers
 * disjoints. Les nombres ci-dessous ont été RE-MESURÉS sur l'arbre APRÈS que
 * cette moitié a atterri dans le même checkout (`R1` : 5 → 1 ; `R2` : 6 → 6 ;
 * `api<…>(` typés : 208 → 205 ; fichiers `apps/web/src` : 382 ; délégants : 4).
 * Ils décrivent donc l'arbre POST-DIFF, comme AC-5 l'exige, et non l'arbre que
 * la seule moitié backend aurait vu.
 */

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..', '..');
const WEB_SRC = join(REPO_ROOT, 'apps', 'web', 'src');
const PACKAGES_DIR = join(REPO_ROOT, 'packages');
const FIXTURES_DIR = join(__dirname, '__fixtures__', 'page-envelope');
const WALK_READ_PATH = join(REPO_ROOT, 'scripts', 'lib', 'walk-read.js');

/** Le foyer légitime, par ÉGALITÉ DE CHEMIN sur UN fichier — pas un glob. */
const CANONICAL_HOME = 'packages/contracts/src/pagination/page-envelope.ts';

/** La fonction qui DÉFINIT ce foyer. Exactement un fichier doit la déclarer. */
const HOME_FUNCTION = 'pageEnvelope';

/** Nommée, et VIDE. Une assertion le vérifie (DNC-10). */
const MANUAL_ALLOWLIST: readonly string[] = [];

/* ================================================================== *
 * LES PLAFONDS ET LEURS ENSEMBLES DE CHEMINS FERMÉS
 * ================================================================== */

/**
 * R1 : **5 avant la tranche → 1 APRÈS**, gelé sur l'arbre POST-DIFF.
 *
 * Les quatre lecteurs nommés (`admin/audit`, `admin/exports`, `admin/students`,
 * `admin/teaching-assignments`) DÉRIVENT désormais leur type du schéma canonique
 * (`z.infer<typeof …Envelope>`), donc ils ne DÉCLARENT plus rien. Le résiduel
 * est UN, et il a un nom.
 */
const R1_CEILING = 1;

/**
 * Les SEULS fichiers autorisés à porter un résiduel R1. Une déclaration neuve
 * AILLEURS rougit même si le compte total a baissé.
 */
const R1_KNOWN_SITES: readonly string[] = ['apps/web/src/lib/parent-children.ts'];

/**
 * Combien de fichiers d'`apps/web/src` DÉLÈGUENT réellement au contrat. Mesuré :
 * **4** — les quatre lecteurs convertis. C'est le plancher qui prouve que la
 * marche voit le code CONVERTI, et non seulement l'absence de code fautif : sans
 * lui, supprimer purement et simplement les quatre déclarations satisferait R1.
 */
const MIN_DELEGATING_WEB_FILES = 4;

/**
 * LES DÉLÉGATAIRES DE CETTE TRANCHE — un ENSEMBLE FERMÉ, pas un préfixe de
 * chemin (`PF-436`, passe de land du run 95).
 *
 * Ce que G-PORTAL peut honnêtement affirmer ici, c'est que la moitié `apps/web`
 * de CETTE tranche n'a touché que `/admin` — une propriété du diff. L'assertion
 * d'origine bouclait au contraire sur tout fichier délégant en exigeant le
 * préfixe `apps/web/src/app/admin/`, ce qui en faisait une loi sur tout adoptant
 * FUTUR : la tranche suivante visée (`PF-429`, `apps/web/src/lib/parent-children.ts`)
 * l'aurait fait rougir en faisant exactement le travail prévu.
 *
 * Ajouter une ligne ici est délibéré et se revoit ; contourner un gate rouge ne
 * se revoit pas. ⚠ La détection reste un `source.includes('pageEnvelope(')`, donc
 * un simple COMMENTAIRE citant la fabrique dans un fichier non listé fait rougir
 * cette liste : c'est enregistré comme `PF-437`, non corrigé ici.
 */
const DELEGATING_KNOWN_SITES: readonly string[] = [
  'apps/web/src/app/admin/audit/page.tsx',
  'apps/web/src/app/admin/exports/types.ts',
  'apps/web/src/app/admin/students/page.tsx',
  'apps/web/src/app/admin/teaching-assignments/types.ts',
];

/** R2 : 6 transtypages en ligne mesurés sur cet arbre. */
const R2_CEILING = 6;

/** Les SEULS fichiers autorisés à porter un résiduel R2 (`PF-428`). */
const R2_KNOWN_SITES: readonly string[] = [
  'apps/web/src/app/admin/alerts/page.tsx',
  'apps/web/src/app/admin/users/page.tsx',
];

/*
 * Planchers d'anti-vacuité. Tout plancher est `>=`, jamais une égalité.
 *
 * ⚠ UN PLANCHER NE PORTE QUE SUR CE QUE LA FEUILLE DE ROUTE NE RÉDUIT PAS
 * (`PF-435`, passe de land du run 95). Deux planchers ont été RETIRÉS ici :
 * `MIN_API_TYPED_CALL_SITES` (190 contre 205) et `MIN_BARE_DATA_CASTS`
 * (50 contre 88). Tous deux comptaient une classe que ce cliquet existe pour
 * FAIRE DIMINUER — les 88 sont `PF-431`, les 205 sont l'assiette des ~150
 * conversions à venir — donc avancer les aurait fait rougir, et la tranche
 * suivante n'aurait eu que deux issues : affaiblir le plancher, ou renoncer.
 * Le témoin qu'ils portaient a été DÉPLACÉ dans la fixture (voir
 * « LE CLASSIFIEUR SAIT LIRE UN ARGUMENT DE TYPE »), qui prouve la même chose
 * et ne bouge pas quand le produit avance.
 *
 * Les deux qui restent comptent des fichiers MARCHÉS, pas des défauts : ils ne
 * peuvent pas être franchis en corrigeant quoi que ce soit.
 */
/** 382 fichiers marchés dans `apps/web/src` sur l'arbre post-diff. */
const MIN_WEB_FILES = 300;
/** `packages/` marché pour R3. */
const MIN_PACKAGE_FILES = 100;

/* eslint-disable @typescript-eslint/no-require-imports */
// Non gardés, exprès (DNC-08) : s'ils s'évaporent, cette suite meurt au
// chargement plutôt que de dégénérer en « rien à vérifier ».
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

const WEB_FILES = walkSources(WEB_SRC).sort();
const PACKAGE_FILES = walkPackages().sort();

const rel = (absolute: string) => relative(REPO_ROOT, absolute).split(sep).join('/');

/* ================================================================== *
 * LE CLASSIFIEUR — il reçoit une SOURCE, jamais un chemin à reconnaître
 * ================================================================== */

type RuleId = 'R1-named-envelope-declaration' | 'R2-inline-envelope-cast';

type Finding = { rule: RuleId; line: number; detail: string };

type FileFacts = {
  findings: Finding[];
  /** Appels `api<…>(…)` portant un argument de type. */
  typedApiCallSites: number;
  /** Transtypages `api<{ data … }>` SANS `total` — le témoin du classifieur. */
  bareDataCasts: number;
  /** Le fichier DÉLÈGUE-t-il au contrat canonique ? */
  delegates: boolean;
  /** Le fichier DÉCLARE-t-il la fabrique ? */
  declaresHome: boolean;
};

/**
 * UNE ENVELOPPE : des membres portant À LA FOIS `data` et `total`, optionnels
 * COMPRIS. L'optionnel est délibérément inclus : `parent-children.ts` écrit
 * `total?`, et l'exclure aurait effacé la seule occurrence NON ADMIN — c'est-à-
 * dire précisément celle dont l'existence falsifie la prémisse G-PORTAL du
 * brief.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function membersFormEnvelope(members: any, sourceFile: any): boolean {
  if (!members) return false;
  let hasData = false;
  let hasTotal = false;
  for (const member of members) {
    const name = member.name;
    if (!name) continue;
    const text: string | undefined =
      typeof name.text === 'string' ? name.text : name.getText?.(sourceFile);
    if (text === 'data') hasData = true;
    if (text === 'total') hasTotal = true;
  }
  return hasData && hasTotal;
}

/**
 * LE classifieur. Il est appliqué À L'IDENTIQUE à l'arbre réel et aux fixtures —
 * c'est ce qui rend le contrôle de falsifiabilité probant plutôt que décoratif.
 */
function classify(source: string, options: { isCanonicalHome: boolean; applyWebRules: boolean }): FileFacts {
  const facts: FileFacts = {
    findings: [],
    typedApiCallSites: 0,
    bareDataCasts: 0,
    delegates: source.includes('pageEnvelope(') || source.includes('unvalidatedItem('),
    declaresHome: source.includes(`export function ${HOME_FUNCTION}<`),
  };

  const sourceFile = ts.createSourceFile(
    'fixture.tsx',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lineOf = (node: any) =>
    sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const visit = (node: any): void => {
    if (options.applyWebRules && !options.isCanonicalHome) {
      // --- R1 : une déclaration de type NOMMÉE qui EST une enveloppe. ---
      if (ts.isInterfaceDeclaration(node) && membersFormEnvelope(node.members, sourceFile)) {
        facts.findings.push({
          rule: 'R1-named-envelope-declaration',
          line: lineOf(node),
          detail: `interface ${node.name.text} { data … total … }`,
        });
      }
      if (
        ts.isTypeAliasDeclaration(node) &&
        node.type &&
        ts.isTypeLiteralNode(node.type) &&
        membersFormEnvelope(node.type.members, sourceFile)
      ) {
        facts.findings.push({
          rule: 'R1-named-envelope-declaration',
          line: lineOf(node),
          detail: `type ${node.name.text} = { data … total … }`,
        });
      }
    }

    // --- R2 + les deux témoins de non-vacuité : les appels `api<…>(…)`. ---
    if (ts.isCallExpression(node) && node.expression.getText(sourceFile) === 'api') {
      const typeArgument = node.typeArguments && node.typeArguments[0];
      if (typeArgument) {
        facts.typedApiCallSites += 1;
        if (ts.isTypeLiteralNode(typeArgument)) {
          if (membersFormEnvelope(typeArgument.members, sourceFile)) {
            if (options.applyWebRules && !options.isCanonicalHome) {
              facts.findings.push({
                rule: 'R2-inline-envelope-cast',
                line: lineOf(node),
                detail: typeArgument.getText(sourceFile).replace(/\s+/g, ' ').slice(0, 80),
              });
            }
          } else if (
            typeArgument.members.some(
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (m: any) => m.name && (m.name.text === 'data' || m.name.getText?.(sourceFile) === 'data'),
            )
          ) {
            facts.bareDataCasts += 1;
          }
        }
      }
    }

    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  return facts;
}

/* ================================================================== *
 * LA MESURE SUR L'ARBRE RÉEL
 * ================================================================== */

function measure(paths: string[], options: { applyWebRules: boolean }) {
  const walked = walkRead.mapWalkedFiles<FileFacts>(paths, (path, source) => [
    rel(path),
    classify(source, {
      isCanonicalHome: rel(path) === CANONICAL_HOME,
      applyWebRules: options.applyWebRules,
    }),
  ]);
  walkRead.warnSkipped('page-envelope-boundary-gate', walked.skipped);
  return new Map(walked.entries);
}

const WEB_FACTS = measure(WEB_FILES, { applyWebRules: true });
const PACKAGE_FACTS = measure(PACKAGE_FILES, { applyWebRules: false });

const ALL_FACTS = new Map<string, FileFacts>([...WEB_FACTS, ...PACKAGE_FACTS]);

function findingsFor(rule: RuleId): string[] {
  const out: string[] = [];
  for (const [path, facts] of WEB_FACTS) {
    for (const finding of facts.findings) {
      if (finding.rule === rule) out.push(`${path}:${finding.line} — ${finding.detail}`);
    }
  }
  return out.sort();
}

const pathOf = (site: string) => site.split(':')[0] ?? '';

let TYPED_API_CALL_SITES = 0;
let BARE_DATA_CASTS = 0;
for (const facts of WEB_FACTS.values()) {
  TYPED_API_CALL_SITES += facts.typedApiCallSites;
  BARE_DATA_CASTS += facts.bareDataCasts;
}

/* ================================================================== *
 * LES FIXTURES — le MÊME classifieur, pour prouver qu'il peut rougir
 * ================================================================== */

const fixture = (name: string) => readFileSync(join(FIXTURES_DIR, name), 'utf8');

/* ================================================================== *
 * LES TESTS
 * ================================================================== */

describe('page-envelope boundary gate — anti-vacuité', () => {
  it('la marche a réellement vu les deux racines', () => {
    expect(WEB_FILES.length).toBeGreaterThanOrEqual(MIN_WEB_FILES);
    expect(PACKAGE_FILES.length).toBeGreaterThanOrEqual(MIN_PACKAGE_FILES);
  });

  /**
   * LE RECENSEMENT EST PUBLIÉ, PAS PLANCHÉ (`PF-435`).
   *
   * Ces deux nombres restent utiles à LIRE — ils disent où en est la burn-down
   * de `PF-431` et des ~150 conversions — mais ils ne peuvent plus FAIRE ROUGIR
   * quoi que ce soit, parce que les faire baisser est le TRAVAIL. Le test
   * n'assère donc que ce qui doit rester vrai à jamais : le classifieur rend
   * des entiers non négatifs, et la compétence qu'il devait démontrer est
   * démontrée sur fixture.
   */
  it('le recensement est PUBLIÉ (il baisse quand la feuille de route avance — ce n’est pas un plancher)', () => {
    expect(Number.isInteger(TYPED_API_CALL_SITES)).toBe(true);
    expect(TYPED_API_CALL_SITES).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(BARE_DATA_CASTS)).toBe(true);
    expect(BARE_DATA_CASTS).toBeGreaterThanOrEqual(0);
  });

  it('EXACTEMENT UN fichier déclare la fabrique, et c’est le foyer d’ADR-081 §D1 (R3)', () => {
    const homes = [...ALL_FACTS.entries()].filter(([, f]) => f.declaresHome).map(([p]) => p);
    expect(homes).toEqual([CANONICAL_HOME]);
  });

  it('l’allowlist manuelle expédie VIDE (DNC-10)', () => {
    expect(MANUAL_ALLOWLIST).toEqual([]);
  });
});

describe('page-envelope boundary gate — R1 : les enveloppes NOMMÉES écrites à la main', () => {
  it(`au plus ${R1_CEILING} déclarations nommées \`data\`+\`total\` dans apps/web/src`, () => {
    expect(findingsFor('R1-named-envelope-declaration').length).toBeLessThanOrEqual(R1_CEILING);
  });

  it('ENSEMBLE FERMÉ — tout résiduel est un fichier DÉJÀ recensé ; une déclaration NEUVE rougit à compte constant', () => {
    for (const site of findingsFor('R1-named-envelope-declaration')) {
      expect(R1_KNOWN_SITES).toContain(pathOf(site));
    }
  });

  it('⚠ G-PORTAL, MESURÉ ET NON AFFIRMÉ : la seule enveloppe NOMMÉE hors `/admin` est celle du portail PARENT', () => {
    // Le brief affirmait « aucune surface teacher/parent/student ne lit cette
    // forme ». C'est FAUX : `lib/parent-children.ts` en est une. On ne le
    // corrige pas ici (`PF-429`) — on l'ÉNONCE, en test, pour qu'aucune lecture
    // future ne re-fabrique la prémisse.
    const outsideAdmin = findingsFor('R1-named-envelope-declaration')
      .map(pathOf)
      .filter((path) => !path.startsWith('apps/web/src/app/admin/'));
    expect(outsideAdmin).toEqual(['apps/web/src/lib/parent-children.ts']);
  });
});

describe('page-envelope boundary gate — R2 : les enveloppes EN LIGNE (PF-428)', () => {
  it(`au plus ${R2_CEILING} transtypages \`api<{ data … total … }>\``, () => {
    expect(findingsFor('R2-inline-envelope-cast').length).toBeLessThanOrEqual(R2_CEILING);
  });

  it('ENSEMBLE FERMÉ — les résiduels restent `admin/alerts` et `admin/users`, et rien d’autre', () => {
    for (const site of findingsFor('R2-inline-envelope-cast')) {
      expect(R2_KNOWN_SITES).toContain(pathOf(site));
    }
  });
});

describe('page-envelope boundary gate — L’INTERVERROUILLAGE DES DEUX MOITIÉS', () => {
  /**
   * ⚠ CE PLANCHER EST CE QUI EMPÊCHE R1 D'ÊTRE SATISFAIT PAR UNE SUPPRESSION.
   *
   * « Zéro déclaration écrite à la main » est trivialement atteignable en
   * EFFAÇANT les déclarations et en rendant `any` ; ce serait un cliquet vert
   * au-dessus d'un client qui a cessé de typer quoi que ce soit. Le plancher de
   * DÉLÉGATION dit l'autre moitié : la forme n'a pas disparu, elle a CHANGÉ DE
   * FOYER. Les deux assertions ne se recouvrent pas et aucune ne suffit seule.
   */
  it('convertir un lecteur EXIGE d’adopter le contrat — on ne peut pas seulement supprimer la déclaration', () => {
    const delegating = [...WEB_FACTS.entries()].filter(([, f]) => f.delegates).map(([p]) => p);
    expect(delegating.length).toBeGreaterThanOrEqual(MIN_DELEGATING_WEB_FILES);
  });

  /**
   * G-PORTAL — CE QUE CETTE TRANCHE A TOUCHÉ, ET NON UNE LOI SUR TOUT ADOPTANT
   * FUTUR (`PF-436`, passe de land du run 95 — condition de land nº 9, que la
   * tranche avait NOMMÉE elle-même).
   *
   * L'assertion précédente bouclait sur TOUS les fichiers délégants et exigeait
   * `startsWith('apps/web/src/app/admin/')`. Son domaine n'était donc pas les
   * quatre fichiers convertis : c'était TOUT fichier qui adopterait jamais le
   * contrat. Or la tranche suivante explicitement visée est `PF-429` =
   * `apps/web/src/lib/parent-children.ts` — hors `app/admin/`, et sur une
   * surface de données ENFANT. L'adopter aurait fait rougir ce gate, et le seul
   * « correctif » disponible aurait été d'affaiblir l'assertion : un cliquet
   * qui punit le travail qu'il séquence, comme les deux planchers de `PF-435`.
   *
   * La revendication VRAIE et vérifiable est plus étroite : la moitié `apps/web`
   * de CETTE tranche n'a touché que `/admin`. On l'écrit donc comme un ENSEMBLE
   * FERMÉ nommé — même idiome que `R1_KNOWN_SITES` / `R2_KNOWN_SITES` — de sorte
   * qu'adopter un fichier d'un autre portail soit un ACTE DÉLIBÉRÉ (ajouter la
   * ligne, avec sa revue G-PORTAL) plutôt qu'un gate rouge à contourner.
   */
  it('G-PORTAL — les délégataires de CETTE tranche sont les quatre lecteurs admin, et rien d’autre', () => {
    const delegating = [...WEB_FACTS.entries()].filter(([, f]) => f.delegates).map(([p]) => p);
    for (const path of delegating) {
      expect(DELEGATING_KNOWN_SITES).toContain(path);
    }
    // Anti-vacuité : l'ensemble fermé ne prouve rien s'il est vide.
    expect(delegating.length).toBeGreaterThanOrEqual(MIN_DELEGATING_WEB_FILES);
  });
});

describe('page-envelope boundary gate — PF-50 et PF-427 sont AVANCÉES, PAS FERMÉES', () => {
  it('la classe résiduelle est VISIBLE, donc personne ne peut la croire close', () => {
    const residual =
      findingsFor('R1-named-envelope-declaration').length +
      findingsFor('R2-inline-envelope-cast').length;
    // Un recensement tombé à zéro voudrait dire que la classe est close ; ce
    // n'est pas le cas et ce test l'écrit, pour qu'une future lecture des
    // plafonds ne se laisse pas prendre pour une fermeture.
    expect(residual).toBeGreaterThan(0);
  });
});

describe('page-envelope boundary gate — falsifiabilité', () => {
  it('LES DEUX formes du défaut, réintroduites dans UNE source, sont TOUTES DEUX signalées', () => {
    const facts = classify(fixture('pre-fix-reintroduced-envelope.ts.txt'), {
      isCanonicalHome: false,
      applyWebRules: true,
    });
    expect(facts.findings.filter((f) => f.rule === 'R1-named-envelope-declaration')).toHaveLength(2);
    expect(facts.findings.filter((f) => f.rule === 'R2-inline-envelope-cast')).toHaveLength(2);
  });

  /**
   * LE TÉMOIN D'ANTI-VACUITÉ VIT ICI, ET PLUS DANS UN PLANCHER SUR L'ARBRE VIVANT
   * (`PF-435`, corrigé à la passe de land du run 95 — condition de land nº 8 de
   * la tranche, qu'elle avait NOMMÉE elle-même).
   *
   * Le cliquet portait `MIN_BARE_DATA_CASTS = 50` contre 88 mesurés et
   * `MIN_API_TYPED_CALL_SITES = 190` contre 205. Les deux comptes sont des
   * classes que la FEUILLE DE ROUTE s'engage à réduire : les 88 transtypages
   * `{ data }` nus SONT `PF-431`, et les 205 sites `api<…>` typés sont
   * précisément ce que les ~150 conversions suivantes doivent faire disparaître.
   * Un cliquet à sens unique dont les planchers rougissent QUAND LE TRAVAIL
   * QU'IL SÉQUENCE AVANCE cliquette dans le mauvais sens : la tranche suivante
   * n'aurait eu que deux issues, affaiblir le plancher ou renoncer.
   *
   * La question que le plancher posait — « le classifieur sait-il LIRE un
   * argument de type, ou rend-il zéro parce qu'il est cassé ? » — est réelle.
   * Elle est simplement mieux posée à une FIXTURE, qui ne bouge pas quand le
   * produit avance. `loadFacets()` y porte un `api<{ data: string[] }>` SANS
   * `total` : il ne doit compter ni en R1 ni en R2, et doit compter comme
   * témoin. Les deux moitiés sont assérées, faute de quoi « 0 » resterait
   * indiscernable d'un classifieur muet.
   */
  it('LE CLASSIFIEUR SAIT LIRE UN ARGUMENT DE TYPE — témoin en fixture, pas en plancher', () => {
    const facts = classify(fixture('pre-fix-reintroduced-envelope.ts.txt'), {
      isCanonicalHome: false,
      applyWebRules: true,
    });
    // Il VOIT le `{ data }` sans `total` …
    expect(facts.bareDataCasts).toBeGreaterThanOrEqual(1);
    // … et il ne le confond PAS avec une enveloppe : R2 reste à 2, pas 3.
    expect(facts.findings.filter((f) => f.rule === 'R2-inline-envelope-cast')).toHaveLength(2);
    // Et il voit bien des appels `api<…>` typés du tout.
    expect(facts.typedApiCallSites).toBeGreaterThanOrEqual(3);
  });

  it('CONTRÔLE NÉGATIF : la forme CONVERTIE reste VERTE, et elle DÉLÈGUE', () => {
    const facts = classify(fixture('clean-surface.ts.txt'), {
      isCanonicalHome: false,
      applyWebRules: true,
    });
    expect(facts.findings).toEqual([]);
    expect(facts.delegates).toBe(true);
  });

  it('CONTRÔLE D’EXCLUSION : l’exclusion du foyer est une ÉGALITÉ DE CHEMIN, pas un glob', () => {
    // Le module canonique DÉCLARE `PageEnvelope { data; total }`. Jugé SANS le
    // drapeau de foyer et sous les règles web, il DOIT rougir — sinon
    // l'exclusion masquerait bien plus que le seul fichier qu'elle nomme.
    const homeSource = readFileSync(join(REPO_ROOT, ...CANONICAL_HOME.split('/')), 'utf8');
    const asOrdinaryFile = classify(homeSource, { isCanonicalHome: false, applyWebRules: true });
    expect(asOrdinaryFile.findings.length).toBeGreaterThan(0);

    const asHome = classify(homeSource, { isCanonicalHome: true, applyWebRules: true });
    expect(asHome.findings).toEqual([]);
    expect(asHome.declaresHome).toBe(true);
  });
});
