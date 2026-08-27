import { existsSync, readdirSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

import { $Enums } from '@prisma/client';

/**
 * S-E03-6 / `PF-20` / `PF-378` / `ADR-077` — LE CLIQUET : plus aucune surface ne
 * RE-ÉNUMÈRE le catalogue des règles d'alerte, et plus aucun KPI ne répond
 * « combien de règles sont configurées » avec la longueur d'une constante.
 *
 * LE DÉFAUT QUE CE CLIQUET REND INEXPRIMABLE
 * -------------------------------------------
 * Mesuré le 2026-08-27. `/admin/dashboard` affichait « Alertes configurées »
 * avec `AnalyticsService.DEFAULT_ALERT_RULES.length` — **la longueur d'une
 * constante privée**. Deux conséquences, et la seconde est la pire :
 *
 *   1. AUCUNE lecture en base ne pouvait contredire ce nombre. Il ne consultait
 *      jamais les données, donc il ne pouvait ni être juste ni devenir faux :
 *      il était simplement **hors sujet**. C'est le moteur mesuré du « 4
 *      alertes vs 0 règles » de `PF-20` — `/admin/alerts` comptait les règles
 *      ACTIVÉES (0 par défaut, `AlertRule.enabled @default(false)`) pendant que
 *      le tableau de bord affichait 4.
 *
 *   2. Cette constante était une SECONDE LISTE tenue à la main du catalogue, et
 *      elle avait **déjà dérivé** : quatre codes contre les huit de l'enum
 *      `AlertRuleCode`. `REPEATED_FAILURE`, `MISSING_ASSESSMENT`,
 *      `TEACHER_COMMENT_FLAG` et `IMPROVEMENT` manquaient. Personne ne pouvait
 *      le voir, parce que les deux listes ne se rencontraient nulle part dans
 *      le code. C'est exactement le couple qui a déjà coûté un 503 sur quatre
 *      portails (la course `academic_year.SELECT`, run 59).
 *
 * Le docblock de la constante disait « until R6 introduces the `AlertRule`
 * model ». R6 l'a introduit. Le substitut a survécu à sa propre date de
 * péremption, ce qui est la façon dont ces constantes meurent : personne ne
 * relit une note qui a déjà été vraie.
 *
 * LES DEUX RÈGLES
 * ---------------
 *   R-A — hors du foyer déclarant, aucun fichier ne peut énumérer une liste de
 *         codes de règles d'alerte. « Énumérer » est mesuré : contenir DEUX
 *         codes de l'enum ou plus, à l'écart des fichiers qui les rendent.
 *
 *   R-B — `analytics.service.ts` ne peut plus répondre à « combien de règles »
 *         autrement que par la dérivation partagée.
 *
 * POURQUOI LA LISTE JUGÉE EST DÉRIVÉE DE L'ENUM, PAS ÉCRITE ICI
 * -------------------------------------------------------------
 * Écrire les huit codes dans ce fichier créerait une TROISIÈME liste à tenir à
 * la main, en face de l'enum, dans le cliquet même qui interdit la deuxième.
 * `$Enums.AlertRuleCode` est la même source que la colonne : un neuvième code
 * ajouté à l'enum étend la règle tout seul.
 *
 * LES EXEMPTIONS SONT DES CATÉGORIES, JAMAIS DES NOMS DE FICHIERS
 * ----------------------------------------------------------------
 * Trois familles de fichiers nomment légitimement plusieurs codes, et aucune
 * n'est allowlistée par son chemin :
 *
 *   • le FOYER (`alerts.types.ts`, `alert-rule-population.ts`) — c'est là que
 *     le catalogue est CENSÉ vivre, et `PREDICATE_HOME` est vérifié plus bas
 *     comme existant réellement ;
 *   • les surfaces de RENDU — un `Record<AlertRuleCode, …>` d'icônes ou de
 *     libellés est une table de correspondance EXHAUSTIVE que le compilateur
 *     vérifie déjà ; elle ne peut pas dériver en silence, puisqu'un code
 *     manquant est une erreur de typage. Reconnue par la présence d'une
 *     annotation `Record<` suivie de `AlertRuleCode`, sur une ligne ou sur
 *     deux —
 *     une propriété du CODE, pas de son adresse ;
 *   • les ÉVALUATEURS sous `modules/alerts/rules/` — une règle métier nomme le
 *     code qu'elle implémente ; c'est un `switch` sur l'enum, pas un
 *     inventaire.
 *
 * CE QUE CE CLIQUET NE PROUVE PAS
 * -------------------------------
 * 1. Il prouve une FORME. Que le nombre affiché soit le BON est porté par
 *    `alert-rule-population.spec.ts` (l'invariant de matérialisation) et par
 *    les tests de comportement du service.
 * 2. LIMITE CONNUE, la même que ses frères : `scripts/ci-gate.sh` ne fait
 *    tourner la suite complète que quand le diff touche `GATE_MACHINERY`
 *    (`PF-333`). Ce fichier en fait partie, donc le cliquet tourne sur CETTE PR.
 */

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..', '..');
const API_SRC = join(REPO_ROOT, 'apps', 'api', 'src');
const WORKER_SRC = join(REPO_ROOT, 'apps', 'worker', 'src');
const WEB_SRC = join(REPO_ROOT, 'apps', 'web', 'src');
const PACKAGES_DIR = join(REPO_ROOT, 'packages');
const WALK_READ_PATH = join(REPO_ROOT, 'scripts', 'lib', 'walk-read.js');

/* eslint-disable @typescript-eslint/no-require-imports */
const walkRead = require(WALK_READ_PATH) as {
  mapWalkedFiles: <V>(
    paths: string[],
    build: (path: string, source: string) => [string, V],
  ) => { entries: [string, V][]; skipped: string[] };
  warnSkipped: (label: string, skipped: string[]) => boolean;
};
/* eslint-enable @typescript-eslint/no-require-imports */

/** Les foyers déclarants. VÉRIFIÉS existants plus bas — jamais une allowlist muette. */
const CATALOGUE_HOMES = [
  'packages/contracts/src/enums/index.ts',
  'apps/api/src/modules/alerts/alerts.types.ts',
  'apps/api/src/modules/alerts/alert-rule-population.ts',
];

/**
 * LA PORTÉE DE R-A, ET POURQUOI ELLE S'ARRÊTE AVANT `apps/web` — `PF-398`.
 *
 * En exécutant R-A sur tout le dépôt, ce cliquet a mesuré **dix** endroits qui
 * énumèrent le catalogue à la main. Trois sont des foyers légitimes
 * (ci-dessus). Les **sept** autres sont sous `apps/web/src/` et récrivent la
 * liste en union de littéraux :
 *
 *   • `app/admin/alerts/actions.ts`                       (8 codes)
 *   • `app/parent/recommendations/types.ts`               (8)
 *   • `app/parent/recommendations/page.tsx`               (8)
 *   • `app/parent/recommendations/RecommendationsFilters.tsx` (8)
 *   • `app/parent/recommendations/alert-next-steps.ts`    (5)
 *   • `components/meeting-requests/types.ts`              (8)
 *   • `components/meeting-requests/MeetingRequestList.tsx` (8)
 *   • `app/parent/children/[id]/page.tsx` et `app/parent/dashboard/page.tsx` (3 chacun)
 *
 * Aucune n'est reliée à l'énum par la compilation : `ALERT_RULE_CODE` existe
 * pourtant dans `@pilotage/contracts` et le web l'importe déjà ailleurs. Un
 * neuvième code ajouté à l'énum laisserait ces sept fichiers verts et faux —
 * exactement l'état où `DEFAULT_ALERT_RULES` a vécu (quatre codes contre huit)
 * jusqu'à ce que `S-E03-6` le mesure.
 *
 * C'EST ENREGISTRÉ, PAS CORRIGÉ, ET LA DISTINCTION EST DÉLIBÉRÉE. Convertir
 * sept fichiers web est une tranche à part entière ; la faire ici gonflerait
 * une tranche qui ferme une constatation de feuille de route en une réécriture
 * transverse. `PF-398` porte ce travail. **La restriction est ÉNONCÉE ici
 * plutôt que réalisée en silence** : une portée rétrécie sans trace se relit
 * plus tard comme « tout est couvert », et c'est la façon dont un cliquet ment.
 */
const JUDGED_ROOTS = ['apps/api/src/', 'apps/worker/src/', 'packages/'];

/** La racine des évaluateurs : une règle nomme le code qu'elle implémente. */
const EVALUATOR_ROOT = 'apps/api/src/modules/alerts/rules/';

/** Le KPI jugé par R-B, et la dérivation qu'il doit emprunter. */
const KPI_FILE = 'apps/api/src/modules/analytics/analytics.service.ts';
const SHARED_DERIVATION = 'countEnabledAlertRules';

/** La constante supprimée. Nommée pour que son retour soit un rouge, pas un oubli. */
const BANNED_CONSTANT = 'DEFAULT_ALERT_RULES';

/** Les codes jugés — DÉRIVÉS de l'enum Prisma, jamais recopiés (voir docblock). */
const RULE_CODES: ReadonlyArray<string> = Object.values($Enums.AlertRuleCode);

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

function walkPackages(): string[] {
  const out: string[] = [];
  if (!existsSync(PACKAGES_DIR)) return out;
  for (const entry of readdirSync(PACKAGES_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    walkTs(join(PACKAGES_DIR, entry.name, 'src'), out);
  }
  return out;
}

const ALL_FILES = [
  ...walkTs(API_SRC),
  ...walkTs(WORKER_SRC),
  ...walkTs(WEB_SRC),
  ...walkPackages(),
].sort();

const rel = (absolute: string) => relative(REPO_ROOT, absolute).split(sep).join('/');

const { entries, skipped } = walkRead.mapWalkedFiles<string>(ALL_FILES, (path, source) => [
  rel(path),
  source,
]);
walkRead.warnSkipped('alert-rule-catalogue-gate', skipped);
const SOURCES = new Map(entries);

/**
 * LES COMMENTAIRES NE SONT PAS DU CODE, ET CE CLIQUET LES RETIRE AVANT DE JUGER.
 *
 * Sans cela, la première prose qui EXPLIQUE le défaut — y compris le
 * commentaire que `S-E03-6` a laissé au-dessus du KPI corrigé, qui cite
 * `DEFAULT_ALERT_RULES.length` pour dire qu il est parti — devient un
 * contrevenant. Un cliquet qui rougit sur sa propre explication se fait
 * relâcher dans le mois, et il se fait relâcher POUR UNE BONNE RAISON, ce qui
 * est la pire façon de perdre une règle.
 *
 * Le retrait est volontairement grossier (blocs de commentaire et lignes
 * commençant par un double oblique) : il
 * n a pas à comprendre TypeScript, seulement à ne pas juger de la prose. Une
 * chaîne de caractères contenant `//` perd sa fin de ligne, ce qui peut au pire
 * MASQUER un code — jamais en inventer un. L erreur possible est donc le faux
 * NÉGATIF, et le contrôle positif plus bas prouve que la règle voit encore.
 */
function stripComments(source: string): string {
  const block = /\/\*[\s\S]*?\*\//g;
  const line = /\/\/[^\r\n]*/g;
  return source.replace(block, ' ').replace(line, ' ');
}

const CODE = new Map([...SOURCES].map(([path, source]) => [path, stripComments(source)]));

/** Une table de correspondance exhaustive, reconnue par sa FORME. */
function isRenderingTable(source: string): boolean {
  return /Record<\s*AlertRuleCode/.test(source);
}

function countsCodes(source: string): string[] {
  return RULE_CODES.filter((code) => source.includes(code));
}

describe('alert-rule-catalogue-gate (S-E03-6, PF-20/PF-378)', () => {
  it('anti-vacuité : le balayage a bien lu un dépôt', () => {
    expect(SOURCES.size).toBeGreaterThan(200);
    expect(RULE_CODES.length).toBeGreaterThan(1);
  });

  it('les foyers déclarés existent réellement', () => {
    for (const home of CATALOGUE_HOMES) {
      expect(SOURCES.has(home)).toBe(true);
    }
  });

  it('contrôle positif : un foyer énumère bien le catalogue', () => {
    // Sans ceci, R-A passerait si la règle cessait de détecter quoi que ce soit.
    const home = CODE.get('apps/api/src/modules/alerts/alerts.types.ts')!;
    expect(countsCodes(home).length).toBe(RULE_CODES.length);
  });

  it('R-A — aucune SECONDE énumération du catalogue hors des foyers', () => {
    const offenders: string[] = [];
    for (const [path, source] of CODE) {
      if (!JUDGED_ROOTS.some((root) => path.startsWith(root))) continue;
      if (CATALOGUE_HOMES.includes(path)) continue;
      if (path.startsWith(EVALUATOR_ROOT)) continue;
      if (isRenderingTable(source)) continue;
      const found = countsCodes(source);
      if (found.length >= 2) offenders.push(path + ' -> ' + found.join(', '));
    }
    expect(offenders).toEqual([]);
  });

  it('R-A (anti-vacuité) — la portée jugée contient bien des fichiers', () => {
    // Une portée qui ne recouvre plus rien rendrait R-A verte pour toujours.
    // Ce contrôle échoue si une arborescence est renommée sous les pieds du
    // cliquet, au lieu de le laisser passer en silence.
    const judged = [...CODE.keys()].filter((path) =>
      JUDGED_ROOTS.some((root) => path.startsWith(root)),
    );
    expect(judged.length).toBeGreaterThan(100);
    for (const root of JUDGED_ROOTS) {
      expect(judged.some((path) => path.startsWith(root))).toBe(true);
    }
  });

  it('PF-398 — la dette web est MESURÉE ici, pas oubliée', () => {
    // R-A s'arrête avant `apps/web` (voir `JUDGED_ROOTS`). Ce test rend la
    // dette VISIBLE et la chiffre, pour qu'elle ne se relise pas comme « rien
    // à signaler ». Il est volontairement écrit comme un PLANCHER : il devient
    // rouge le jour où quelqu'un croit avoir fini `PF-398` sans mettre à jour
    // ce cliquet, et il ne rougit pas à chaque fichier web ajouté.
    const webDuplicates = [...CODE]
      .filter(([path]) => path.startsWith('apps/web/src/'))
      .filter(([, source]) => !isRenderingTable(source))
      .filter(([, source]) => countsCodes(source).length >= 2)
      .map(([path]) => path);
    expect(webDuplicates.length).toBeGreaterThan(0);
    expect(webDuplicates).toContain('apps/web/src/app/parent/recommendations/types.ts');
  });

  it('R-B — le KPI « Alertes configurées » passe par la dérivation partagée', () => {
    const kpi = CODE.get(KPI_FILE);
    expect(kpi).toBeDefined();
    expect(kpi!).toContain(SHARED_DERIVATION);
    expect(kpi!).not.toContain(BANNED_CONSTANT);
  });

  it('R-B (anti-vacuité) — le fichier du KPI est bien celui qu on croit', () => {
    const kpi = SOURCES.get(KPI_FILE)!;
    expect(kpi.length).toBeGreaterThan(10_000);
    expect(kpi).toContain('adminDashboard');
    expect(kpi).toContain('configuredAlerts');
  });
});
