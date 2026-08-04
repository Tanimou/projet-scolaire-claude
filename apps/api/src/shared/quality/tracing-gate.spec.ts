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
}
interface Emission {
  spans: number;
  serialised: string;
  error?: string;
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
const { evaluateTracing, collectComposeServices, normaliseEnv, OTLP_ENV } = require(
  SCRIPT_PATH,
) as {
  evaluateTracing: (input: TracingInput) => Evaluation;
  collectComposeServices: (
    files: Array<{ file: string; doc: unknown }>,
  ) => Record<string, ComposeService>;
  normaliseEnv: (environment: unknown) => Record<string, string>;
  OTLP_ENV: string;
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
