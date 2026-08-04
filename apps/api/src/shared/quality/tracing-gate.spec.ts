import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const REPO_ROOT = resolve(__dirname, '../../../../..');
const SCRIPT_PATH = join(REPO_ROOT, 'scripts/tracing-check.js');
const read = (rel: string): string => readFileSync(join(REPO_ROOT, rel), 'utf8');

interface Evaluation {
  problems: string[];
  notes: string[];
}

interface ComposeService {
  file: string;
  environment: Record<string, string>;
  ports: string[];
  profiles: string[];
}

interface MainFile {
  file: string;
  source: string | null;
  /**
   * Les fragments asynchrones émis À CÔTÉ de l'entrée (`bundleContains`).
   *
   * Optionnel parce que les deux artefacts Nest n'en ont pas : leur preuve est
   * l'ordre des `require` dans un `main.js` unique.
   */
  related?: Array<{ file: string; source: string }>;
}
interface Emission {
  spans: number;
  serialised: string;
  error?: string;
  /** Renseigné par la seule sonde web : l'exposition Prometheus re-scrapée. */
  exposition?: string;
}

interface TracingInput {
  tracedServices: string[];
  composeServices: Record<string, ComposeService>;
  mains: Record<string, MainFile>;
  emission: Record<string, Emission | null>;
}

/**
 * L'entrée du fixture, avec ses clés connues **nommées**.
 *
 * `noUncheckedIndexedAccess` est actif dans ce workspace : sur un
 * `Record<string, T>` nu, `input.mains.api` vaut `T | undefined` et chaque cas
 * ci-dessous devrait porter un `!` ou un `?.` qui masquerait ce qu'il teste.
 * L'intersection donne des membres nommés — donc typés, sans assertion.
 *
 * Ce n'est pas de la cosmétique : la première version de ce fichier passait
 * jest et **échouait `tsc`**, exactement comme la garde du run 10. Jest exécute,
 * il ne vérifie pas les types ; les deux stages sont là pour des raisons
 * différentes.
 */
type Named<K extends string, T> = Record<string, T> & Record<K, T>;

interface HealthyInput extends TracingInput {
  composeServices: Named<'api' | 'worker' | 'web' | 'jaeger', ComposeService>;
  mains: Named<'api' | 'worker', MainFile>;
  emission: Named<'api' | 'worker', Emission | null>;
}

/* eslint-disable @typescript-eslint/no-require-imports */
const {
  evaluateTracing,
  collectComposeServices,
  normaliseEnv,
  escapeForRegExp,
  APP_ARTEFACTS,
  OTLP_ENV,
  WEB_PROBE_ROUTE_TEMPLATE,
  WEB_DURATION_METRIC,
} = require(SCRIPT_PATH) as {
  evaluateTracing: (input: TracingInput) => Evaluation;
  collectComposeServices: (
    files: Array<{ file: string; doc: unknown }>,
  ) => Record<string, ComposeService>;
  normaliseEnv: (environment: unknown) => Record<string, string>;
  escapeForRegExp: (raw: string) => string;
  APP_ARTEFACTS: Record<string, { proof?: string; bundleCandidates?: string[]; probe: string }>;
  OTLP_ENV: string;
  WEB_PROBE_ROUTE_TEMPLATE: string;
  WEB_DURATION_METRIC: string;
};
/* eslint-enable @typescript-eslint/no-require-imports */

/**
 * S-E02-14 / PF-78 — garde sur la gate de traçage.
 *
 * ---------------------------------------------------------------------------
 * POURQUOI CE FICHIER EXISTE
 * ---------------------------------------------------------------------------
 * `scripts/tracing-check.js` juge **ce dépôt**. Lancé sur un dépôt sain, il ne
 * peut démontrer qu'une chose : que le dépôt est sain aujourd'hui. Il ne peut
 * jamais démontrer qu'il attraperait une régression.
 *
 * C'est la leçon de `S-E02-12`, et la réponse est la même : l'évaluation est
 * une fonction pure qu'on nourrit ici d'entrées **connues-fausses** — une par
 * défaut réel que la slice a corrigé, plus celles qu'elle n'a pas encore vues.
 */
describe('S-E02-14 · la gate de traçage', () => {
  /** Entrée saine, dont chaque cas ci-dessous ne casse qu'une chose. */
  const healthy = (): HealthyInput => ({
    tracedServices: ['api', 'worker'],
    composeServices: {
      api: { file: 'infra/docker-compose.yml', environment: { [OTLP_ENV]: '${X:-}' }, ports: ['4000:4000'], profiles: ['app'] },
      worker: { file: 'infra/docker-compose.yml', environment: { [OTLP_ENV]: '${X:-}' }, ports: [], profiles: ['app'] },
      web: { file: 'infra/docker-compose.yml', environment: {}, ports: [], profiles: ['app'] },
      jaeger: {
        file: 'infra/docker-compose.yml',
        environment: { COLLECTOR_OTLP_ENABLED: 'true' },
        ports: ['16686:16686', '4317:4317', '4318:4318'],
        profiles: ['obs'],
      },
    },
    mains: {
      api: {
        file: 'apps/api/dist/main.js',
        source: 'require("reflect-metadata");require("./shared/tracing/tracing.bootstrap");require("./app.module");',
      },
      worker: {
        file: 'apps/worker/dist/main.js',
        source: 'require("reflect-metadata");require("./shared/tracing/tracing.bootstrap");require("./app.module");',
      },
    },
    emission: {
      api: { spans: 2, serialised: '[{"name":"GET","attributes":{"url.path":"/api/v1/students/:id"}}]' },
      worker: { spans: 1, serialised: '[{"name":"GET"}]' },
    },
  });

  it('passes on a coherent tracing pipeline', () => {
    const { problems } = evaluateTracing(healthy());
    expect(problems).toEqual([]);
  });

  /* ---------------------------------------------------------------- *
   * 1. la déclaration doit couvrir exactement les émetteurs
   * ---------------------------------------------------------------- */
  it('fails when a service that emits nothing is handed a collector — the original PF-78 shape', () => {
    // L'état exact d'avant cette slice : la variable vivait sur l'ancre
    // partagée et atteignait migrator, api, worker, web et seed.
    const input = healthy();
    input.composeServices.web.environment[OTLP_ENV] = 'http://jaeger:4318';
    const { problems } = evaluateTracing(input);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('"web"');
    expect(problems[0]).toContain('not in TRACED_SERVICES');
  });

  it('fails in the other direction too — a traced service that stops declaring one', () => {
    const input = healthy();
    delete input.composeServices.worker.environment[OTLP_ENV];
    const { problems } = evaluateTracing(input);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('"worker"');
    expect(problems[0]).toContain('start disabled');
  });

  /* ---------------------------------------------------------------- *
   * 2. l'ordre de chargement — le défaut invisible
   * ---------------------------------------------------------------- */
  it('fails when the tracing bootstrap is required AFTER the application module', () => {
    // Ce cas est le cœur de la gate : rien ne lève, l'application démarre,
    // et aucune requête n'est tracée.
    const input = healthy();
    input.mains.api.source =
      'require("reflect-metadata");require("./app.module");require("./shared/tracing/tracing.bootstrap");';
    const { problems } = evaluateTracing(input);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('AFTER');
    expect(problems[0]).toContain('patches nothing');
  });

  it('fails when main.js never requires the bootstrap at all', () => {
    const input = healthy();
    input.mains.worker.source = 'require("reflect-metadata");require("./app.module");';
    const { problems } = evaluateTracing(input);
    expect(problems.some((p) => p.includes('never requires'))).toBe(true);
  });

  it('fails, rather than skips, when the build output is absent', () => {
    // Une gate qui saute quand elle ne trouve rien passe à vide — c'est
    // comment le gate de run 10 a failli être vert sans rien vérifier.
    const input = healthy();
    input.mains.api.source = null;
    const { problems } = evaluateTracing(input);
    expect(problems.some((p) => p.includes('failure, not a skip'))).toBe(true);
  });

  /* ---------------------------------------------------------------- *
   * 3. l'émission réelle, et le caviardage
   * ---------------------------------------------------------------- */
  it('fails when a real request produces zero spans — the finding itself', () => {
    const input = healthy();
    input.emission.api = { spans: 0, serialised: '[]' };
    const { problems } = evaluateTracing(input);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('0 spans');
  });

  it('fails when the probe did not run, instead of treating silence as success', () => {
    const input = healthy();
    input.emission.worker = null;
    const { problems } = evaluateTracing(input);
    expect(problems.some((p) => p.includes('unproven'))).toBe(true);
  });

  it('G-TENANT · fails when an identifier reaches the exported spans', () => {
    const input = healthy();
    input.emission.api = {
      spans: 2,
      serialised: '[{"attributes":{"url.path":"/api/v1/students/clx1234567890abcdefghij"}}]',
    };
    const { problems } = evaluateTracing(input);
    expect(problems.some((p) => p.includes('clx1234567890abcdefghij'))).toBe(true);
    expect(problems.some((p) => p.includes('unauthenticated'))).toBe(true);
  });

  it('G-TENANT · fails when a query parameter survives into the exported spans', () => {
    const input = healthy();
    input.emission.worker = { spans: 1, serialised: '[{"attributes":{"url.full":"?tenantId=demo"}}]' };
    const { problems } = evaluateTracing(input);
    expect(problems.some((p) => p.includes('tenantId'))).toBe(true);
  });

  /* ---------------------------------------------------------------- *
   * 4. le collecteur peut recevoir ce qu'on lui envoie
   * ---------------------------------------------------------------- */
  it('fails when jaeger does not enable OTLP', () => {
    const input = healthy();
    input.composeServices.jaeger.environment.COLLECTOR_OTLP_ENABLED = 'false';
    const { problems } = evaluateTracing(input);
    expect(problems.some((p) => p.includes('COLLECTOR_OTLP_ENABLED'))).toBe(true);
  });

  it('fails when jaeger exposes only the gRPC port, which OTLP/HTTP cannot use', () => {
    const input = healthy();
    input.composeServices.jaeger.ports = ['16686:16686', '4317:4317'];
    const { problems } = evaluateTracing(input);
    expect(problems.some((p) => p.includes('4318'))).toBe(true);
  });

  it('fails when the collector service is gone entirely', () => {
    const input = healthy();
    // Reconstruit sans `jaeger` plutôt que `delete` : la clé est nommée dans le
    // type du fixture — c'est ce qui permet aux autres cas de l'indexer sans
    // assertion — et `delete` sur un membre requis ne compile pas.
    const { jaeger: _removed, ...withoutCollector } = input.composeServices;
    const { problems } = evaluateTracing({ ...input, composeServices: withoutCollector });
    expect(problems.some((p) => p.includes('no "jaeger" service'))).toBe(true);
  });

  it('fails when an explicit endpoint names a host no compose service provides', () => {
    const input = healthy();
    input.composeServices.api.environment[OTLP_ENV] = 'http://otel-collector:4318';
    const { problems } = evaluateTracing(input);
    expect(problems.some((p) => p.includes('otel-collector'))).toBe(true);
  });

  /* ---------------------------------------------------------------- *
   * Le merge des fichiers compose — le bug que run 15 s'est infligé
   * ---------------------------------------------------------------- */
  it('merges compose overrides one level into environment, the way compose does', () => {
    // `Object.assign` au niveau service laisserait un override PARTIEL de
    // `api` remplacer la définition de base en entier — c'est le défaut que
    // `observability-check.js` s'est infligé à sa première exécution.
    const merged = collectComposeServices([
      {
        file: 'base.yml',
        doc: { services: { api: { environment: { A: '1', B: '2' }, ports: ['4000:4000'] } } },
      },
      { file: 'prod.yml', doc: { services: { api: { environment: { B: '3' } } } } },
    ]);
    expect(merged.api?.environment).toEqual({ A: '1', B: '3' });
    expect(merged.api?.ports).toEqual(['4000:4000']);
  });

  it('reads both compose environment forms — a map and a KEY=value list', () => {
    expect(normaliseEnv({ A: '1' })).toEqual({ A: '1' });
    expect(normaliseEnv(['A=1', 'B=x=y'])).toEqual({ A: '1', B: 'x=y' });
    expect(normaliseEnv(undefined)).toEqual({});
  });

  /* ---------------------------------------------------------------- *
   * Le câblage — une gate débranchée ne garde rien
   * ---------------------------------------------------------------- */
  it('is wired into ci-gate.sh AND ci.yml, which must not drift (S-E02-2 AC-4)', () => {
    expect(read('scripts/ci-gate.sh')).toContain('node scripts/tracing-check.js');
    expect(read('.github/workflows/ci.yml')).toContain('node scripts/tracing-check.js');
  });

  it('ships the emission probe the gate spawns', () => {
    expect(existsSync(join(REPO_ROOT, 'scripts/trace-emission-probe.js'))).toBe(true);
  });

  it('has no bypass flag (DNC-10)', () => {
    const source = read('scripts/tracing-check.js');
    for (const flag of ['--skip', '--force', 'SKIP_TRACING', 'ALLOW_NO_TRACES']) {
      expect(source).not.toContain(flag);
    }
  });

  /* ---------------------------------------------------------------- *
   * La règle d'ordre est aussi une propriété du SOURCE, pas seulement
   * de l'artefact — un relecteur doit la voir dans le diff.
   * ---------------------------------------------------------------- */
  it('keeps the tracing import first in both main.ts, right after reflect-metadata', () => {
    for (const main of ['apps/api/src/main.ts', 'apps/worker/src/main.ts']) {
      const imports = read(main)
        .split('\n')
        .filter((line) => line.startsWith('import '))
        .slice(0, 2);
      expect(imports[0]).toContain('reflect-metadata');
      expect(imports[1]).toContain('shared/tracing/tracing.bootstrap');
    }
  });

  it('keeps the redaction policy in ONE place, imported by both applications', () => {
    // Deux copies de la règle, et il suffit que l'une oublie `db.statement`
    // pour que des clés Redis contenant des identifiants de tenant partent
    // vers un collecteur non authentifié — sans que rien ne le dise.
    for (const app of ['apps/api/src/shared/tracing/tracing.ts', 'apps/worker/src/shared/tracing/tracing.ts']) {
      const source = read(app);
      expect(source).toContain("from '@pilotage/contracts'");
      expect(source).toContain('withRedaction');
    }
    expect(existsSync(join(REPO_ROOT, 'packages/contracts/src/observability/tracing-policy.ts'))).toBe(
      true,
    );
  });
});

/* ------------------------------------------------------------------ *
 * S-E02-15 / PF-79 — le troisième artefact
 * ------------------------------------------------------------------ */

interface WebHealthyInput extends TracingInput {
  composeServices: Named<'api' | 'worker' | 'web' | 'jaeger', ComposeService>;
  mains: Named<'api' | 'worker' | 'web', MainFile>;
  emission: Named<'api' | 'worker' | 'web', Emission | null>;
}

/**
 * Une exposition Prometheus minimale, telle que la sonde web la rapporte.
 *
 * Écrite à la main plutôt que capturée : chaque cas ci-dessous en casse
 * exactement un aspect, ce qui est impossible avec un échantillon figé dont on
 * ne sait plus quelle partie porte quelle règle.
 */
function webExposition(
  options: { route?: string; sampled?: boolean; leak?: string } = {},
): string {
  const route = options.route ?? WEB_PROBE_ROUTE_TEMPLATE;
  const sampled = options.sampled ?? true;
  const lines = [
    `# HELP ${WEB_DURATION_METRIC} duree`,
    `# TYPE ${WEB_DURATION_METRIC} histogram`,
  ];
  if (sampled) {
    lines.push(
      `${WEB_DURATION_METRIC}_bucket{le="0.25",app="web",method="GET",route="${route}",status_code="200"} 1`,
      `${WEB_DURATION_METRIC}_count{app="web",method="GET",route="${route}",status_code="200"} 1`,
    );
  }
  if (options.leak !== undefined) {
    lines.push(`${WEB_DURATION_METRIC}_bucket{le="0.25",app="web",route="${options.leak}"} 1`);
  }
  return `${lines.join('\n')}\n`;
}

describe('S-E02-15 · la gate de traçage couvre apps/web', () => {
  /** Entrée saine à trois artefacts. Chaque cas n'en casse qu'un aspect. */
  const healthyWeb = (): WebHealthyInput => ({
    tracedServices: ['api', 'worker', 'web'],
    composeServices: {
      api: {
        file: 'infra/docker-compose.yml',
        environment: { [OTLP_ENV]: '${X:-}' },
        ports: ['4000:4000'],
        profiles: ['app'],
      },
      worker: {
        file: 'infra/docker-compose.yml',
        environment: { [OTLP_ENV]: '${X:-}' },
        ports: [],
        profiles: ['app'],
      },
      web: {
        file: 'infra/docker-compose.yml',
        environment: { [OTLP_ENV]: '${X:-}', WEB_METRICS_PORT: '3001' },
        ports: ['3000:3000'],
        profiles: ['app'],
      },
      jaeger: {
        file: 'infra/docker-compose.yml',
        environment: { COLLECTOR_OTLP_ENABLED: 'true' },
        ports: ['16686:16686', '4317:4317', '4318:4318'],
        profiles: ['obs'],
      },
    },
    mains: {
      api: {
        file: 'apps/api/dist/main.js',
        source:
          'require("reflect-metadata");require("./shared/tracing/tracing.bootstrap");require("./app.module");',
      },
      worker: {
        file: 'apps/worker/dist/main.js',
        source:
          'require("reflect-metadata");require("./shared/tracing/tracing.bootstrap");require("./app.module");',
      },
      web: {
        file: 'apps/web/.next/server/instrumentation.js',
        source:
          '(()=>{const a="pilotage_http_request_duration_seconds";const b="pilotage_http_requests_total";})();',
      },
    },
    emission: {
      api: {
        spans: 2,
        serialised: '[{"name":"GET","attributes":{"url.path":"/api/v1/students/:id"}}]',
      },
      worker: { spans: 1, serialised: '[{"name":"GET"}]' },
      web: {
        spans: 1,
        serialised:
          '[{"name":"GET /parent/students/:id/grades","attributes":{"url.path":"/parent/students/:id/grades"}}]',
        exposition: webExposition(),
      },
    },
  });

  it('passes on a coherent three-artefact pipeline', () => {
    const { problems } = evaluateTracing(healthyWeb());
    expect(problems).toEqual([]);
  });

  /* ---------------------------------------------------------------- *
   * (i) le collecteur doit être remis à web — et à web SEUL
   * ---------------------------------------------------------------- */
  it('fails when web is traced but handed no endpoint — the pre-slice state', () => {
    // C'est littéralement l'état d'avant : S-E02-14 avait RETIRÉ la variable du
    // service web plutôt que de laisser une fausse déclaration. La remettre
    // n'est légitime que parce que le mécanisme existe désormais.
    const input = healthyWeb();
    delete input.composeServices.web.environment[OTLP_ENV];
    const { problems } = evaluateTracing(input);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('"web"');
    expect(problems[0]).toContain('is in TRACED_SERVICES but is handed no');
  });

  it('fails naming migrator and seed when the endpoint returns to the shared anchor', () => {
    // La re-largeur interdite : l'ancre `x-app-env` est consommée par migrator,
    // api, worker, web ET seed. L'y remettre recrée PF-78 pour les deux jobs
    // one-shot, qui ne peuvent rien émettre.
    const input = healthyWeb();
    for (const name of ['migrator', 'seed']) {
      input.composeServices[name] = {
        file: 'infra/docker-compose.yml',
        environment: { [OTLP_ENV]: '${X:-}' },
        ports: [],
        profiles: ['app'],
      };
    }
    const { problems } = evaluateTracing(input);
    const joined = problems.join('\n');
    expect(problems).toHaveLength(2);
    expect(joined).toContain('"migrator"');
    expect(joined).toContain('"seed"');
    expect(joined).toContain('not in TRACED_SERVICES');
  });

  it('points at a stale contracts build as the other cause, not only at compose', () => {
    // PM-18 : `TRACED_SERVICES` est lu depuis packages/contracts/**dist**. Une
    // source à jour et un dist qui la précède produisent EXACTEMENT ce message,
    // et le remède est alors opposé — reconstruire, pas dé-déclarer.
    const input = healthyWeb();
    input.tracedServices = ['api', 'worker'];
    const { problems } = evaluateTracing(input);
    expect(problems.join('\n')).toContain('rebuild the contracts package');
  });

  /* ---------------------------------------------------------------- *
   * (iii)/(iv) la preuve d'artefact pour web est le bundle ÉMIS
   * ---------------------------------------------------------------- */
  it('fails when the emitted instrumentation bundle is absent from BOTH candidate paths', () => {
    const input = healthyWeb();
    input.mains.web = {
      file: 'apps/web/.next/server/instrumentation.js or apps/web/.next/server/src/instrumentation.js',
      source: null,
    };
    const { problems } = evaluateTracing(input);
    const joined = problems.join('\n');
    expect(joined).toContain('is absent');
    expect(joined).toContain('That is a failure, not a skip');
  });

  it('fails when the bundle was emitted but is empty', () => {
    const input = healthyWeb();
    input.mains.web.source = '   \n  ';
    const { problems } = evaluateTracing(input);
    expect(problems.join('\n')).toContain('is empty');
  });

  it('fails when the bundle does not carry the registered metric names', () => {
    // Le hook a compilé sans le registre qu'il est censé embarquer : l'artefact
    // qui ship n'est alors pas le module que la gate a lu — ce qui est tout
    // l'intérêt de lire la sortie émise plutôt que le source (R-26 règle (a)).
    const input = healthyWeb();
    input.mains.web.source = '(()=>{console.log("register");})();';
    const { problems } = evaluateTracing(input);
    const joined = problems.join('\n');
    expect(joined).toContain('pilotage_http_request_duration_seconds');
    expect(joined).toContain('pilotage_http_requests_total');
  });

  /* ---------------------------------------------------------------- *
   * La forme que webpack émet RÉELLEMENT — le défaut qui aurait rendu
   * cette gate rouge sur un artefact correct.
   * ---------------------------------------------------------------- */

  /**
   * L'entrée serveur telle que Next l'émet quand le module est atteint par
   * `await import()` : du runtime webpack, un `__webpack_require__.e(<id>)`, et
   * un `require("./chunks/<id>.js")` — et AUCUN des marqueurs, qui sont partis
   * dans le fragment. Écrite à la main, mais d'après la sortie mesurée du même
   * webpack : le pire piège serait un fixture qui inline le module et jugerait
   * donc une forme que le build ne produit jamais.
   */
  const SPLIT_ENTRY =
    '(()=>{var e={},r={};function t(n){...}' +
    't.e=n=>Promise.all([]).then(()=>require("./chunks/"+n+".js"));' +
    'Promise.resolve().then(()=>t.e(672)).then(()=>t(672));})();';

  it('passes when the markers live in the async chunk the entry loads, not in the entry', () => {
    // `instrumentation.ts` DOIT charger son implémentation par `await import()`
    // — un import statique serait résolu pour le runtime edge, où `node:http`
    // et `prom-client` n'existent pas. Webpack sort donc l'implémentation dans
    // un chunk séparé. Exiger les marqueurs dans la seule entrée mettrait cette
    // règle-là et celle-ci en contradiction, et la gate crierait faux sur un
    // build parfaitement correct.
    const input = healthyWeb();
    input.mains.web = {
      file: 'apps/web/.next/server/instrumentation.js',
      source: SPLIT_ENTRY,
      related: [
        {
          file: 'apps/web/.next/server/chunks/672.js',
          source:
            'exports.id=672;const a="pilotage_http_request_duration_seconds";const b="pilotage_http_requests_total";',
        },
        { file: 'apps/web/.next/server/chunks/48.js', source: 'exports.id=48;' },
      ],
    };
    const { problems, notes } = evaluateTracing(input);
    expect(problems).toEqual([]);
    expect(notes.join('\n')).toContain('+ 2 emitted chunk(s)');
  });

  it('still fails when NO emitted chunk carries the markers either', () => {
    // L'élargissement ne doit pas devenir une amnistie : si le registre n'est
    // nulle part dans la sortie serveur, l'artefact qui ship n'est pas le
    // module que la gate a lu, et c'est toujours une panne.
    const input = healthyWeb();
    input.mains.web = {
      file: 'apps/web/.next/server/instrumentation.js',
      source: SPLIT_ENTRY,
      related: [{ file: 'apps/web/.next/server/chunks/672.js', source: 'exports.id=672;' }],
    };
    const { problems } = evaluateTracing(input);
    const joined = problems.join('\n');
    expect(joined).toContain('chunk(s) emitted beside it');
    expect(joined).toContain('pilotage_http_request_duration_seconds');
  });

  it('never lets a chunk excuse an empty entry — register() would do nothing', () => {
    // Les fragments élargissent la recherche des MARQUEURS, jamais les deux
    // contrôles portés par l'entrée seule (émise, non vide) : un `register()`
    // creux reste une panne, quels que soient les fragments à côté.
    const input = healthyWeb();
    input.mains.web = {
      file: 'apps/web/.next/server/instrumentation.js',
      source: '   \n  ',
      related: [
        {
          file: 'apps/web/.next/server/chunks/672.js',
          source: 'const a="pilotage_http_request_duration_seconds";const b="pilotage_http_requests_total";',
        },
      ],
    };
    const { problems } = evaluateTracing(input);
    expect(problems.join('\n')).toContain('is empty');
  });

  it('never applies the require-order rule to web — Next has no main.js', () => {
    // Recopier l'assertion d'ordre d'octets ici serait affirmer au lieu
    // d'exécuter : Next GARANTIT que register() tourne avant de servir.
    const { problems, notes } = evaluateTracing(healthyWeb());
    expect(problems).toEqual([]);
    expect(notes.join('\n')).toContain('the emitted instrumentation bundle');
    expect(notes.join('\n')).not.toContain('web: tracing bootstrap is required');
  });

  /* ---------------------------------------------------------------- *
   * La mesure Prometheus doit être ALIMENTÉE, pas seulement déclarée
   * ---------------------------------------------------------------- */
  it('fails when the histogram is registered but never observed', () => {
    // prom-client émet `# HELP`/`# TYPE` pour un histogramme JAMAIS observé.
    // `observability-check.js`, qui lit les lignes `# TYPE`, accepterait donc un
    // panneau affichant "No data" pour toujours — indiscernable d'un système au
    // repos. Seule une sonde qui pousse un span puis re-scrape fait la différence.
    const input = healthyWeb();
    (input.emission.web as Emission).exposition = webExposition({ sampled: false });
    const { problems } = evaluateTracing(input);
    const joined = problems.join('\n');
    expect(joined).toContain('web:');
    expect(joined).toContain('_bucket sample');
  });

  it('fails when the sample is labelled with a resolved URL instead of the template', () => {
    const input = healthyWeb();
    (input.emission.web as Emission).exposition = webExposition({
      route: '/parent/students/clx1234567890abcdefghij/grades',
    });
    const { problems } = evaluateTracing(input);
    const joined = problems.join('\n');
    // Deux règles se déclenchent, et c'est voulu : le gabarit manque ET un
    // identifiant est présent sur une surface non authentifiée.
    expect(joined).toContain('_bucket sample');
    expect(joined).toContain('clx1234567890abcdefghij');
  });

  it('fails when a tenant identifier reaches the Prometheus exposition', () => {
    const input = healthyWeb();
    (input.emission.web as Emission).exposition = webExposition({ leak: '/x?tenantId=demo' });
    const { problems } = evaluateTracing(input);
    expect(problems.join('\n')).toContain('the Prometheus exposition contains "tenantId"');
  });

  it('fails when the web probe did not run at all', () => {
    const input = healthyWeb();
    input.emission.web = null;
    const { problems } = evaluateTracing(input);
    expect(problems.join('\n')).toContain('the emission probe did not run');
  });

  it('fails when the web probe produced zero spans', () => {
    const input = healthyWeb();
    input.emission.web = { spans: 0, serialised: '[]', exposition: webExposition() };
    const { problems } = evaluateTracing(input);
    expect(problems.join('\n')).toContain('produced 0 spans');
  });

  it('fails — and says so distinctly — when the probe hangs rather than answering', () => {
    const input = healthyWeb();
    input.emission.web = {
      spans: 0,
      serialised: '',
      error: 'probe did not complete (ETIMEDOUT) — a hung probe is a failure, not a skip',
    };
    const { problems } = evaluateTracing(input);
    expect(problems.join('\n')).toContain('a hung probe is a failure, not a skip');
  });

  it('fails loudly when TRACED_SERVICES names an artefact the gate does not know', () => {
    const input = healthyWeb();
    input.tracedServices = ['api', 'worker', 'web', 'mobile'];
    input.composeServices.mobile = {
      file: 'infra/docker-compose.yml',
      environment: { [OTLP_ENV]: '${X:-}' },
      ports: [],
      profiles: ['app'],
    };
    const { problems } = evaluateTracing(input);
    expect(problems.join('\n')).toContain('knows no artefact');
  });

  /* ---------------------------------------------------------------- *
   * Câblage — une sonde que rien ne lance ne garde rien
   * ---------------------------------------------------------------- */
  it('declares a web artefact with both emitted-bundle candidates', () => {
    // Cette application a un répertoire `src/`, ce qui est la raison pour
    // laquelle son middleware émis atterrit sous `.next/server/src/`. Les deux
    // chemins sont cherchés ; aucun n'est codé en dur seul.
    expect(APP_ARTEFACTS.web?.proof).toBe('bundleContains');
    expect(APP_ARTEFACTS.web?.bundleCandidates).toEqual([
      'apps/web/.next/server/instrumentation.js',
      'apps/web/.next/server/src/instrumentation.js',
    ]);
  });

  it('ships and spawns the web probe', () => {
    expect(existsSync(join(REPO_ROOT, 'scripts/web-observability-probe.js'))).toBe(true);
    // Une sonde que rien ne lance est le même défaut qu'une gate débranchée, un
    // étage plus bas : elle passerait pour toujours en ne prouvant rien.
    expect(read('scripts/tracing-check.js')).toContain('web-observability-probe.js');
  });

  it('reads the emitted chunks beside the entry, not the entry alone', () => {
    // Une gate qui ne lit que l'entrée redevient rouge au premier build, sur un
    // artefact correct — et une gate qui crie faux finit désactivée.
    expect(read('scripts/tracing-check.js')).toContain('readEmittedChunks');
  });

  it('has no bypass flag for the web half either (DNC-10)', () => {
    const source = read('scripts/tracing-check.js');
    for (const flag of ['SKIP_WEB_OBS', 'OBS_SKIP_WEB', '--allow-unobserved-web']) {
      expect(source).not.toContain(flag);
    }
  });

  it('escapes the Next route template, whose brackets are regexp metacharacters', () => {
    expect(escapeForRegExp('/parent/students/[id]/grades')).toBe('/parent/students/\\[id\\]/grades');
  });
});
