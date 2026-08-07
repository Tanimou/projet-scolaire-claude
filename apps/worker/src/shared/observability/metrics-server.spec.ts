import type { AddressInfo } from 'node:net';

import { METRICS_PATH, VERSION_PATHS, startVersionServer } from '../release/version-server';

import { PROMETHEUS_CONTENT_TYPE, registry } from './metrics.registry';
import {
  DEPTH_COLLECT_TIMEOUT_MS,
  registerQueueDepthSources,
  type QueueDepthSource,
} from './queue-metrics';

/**
 * Preuve exécutée pour S-E02-13 / PF-56.
 *
 * Le worker est le seul des trois artefacts dont on peut réellement démarrer la
 * surface HTTP dans un test unitaire — c'est un serveur `node:http` de ~80
 * lignes, sans base de données ni session. On s'en sert : le socket est ouvert
 * sur un port éphémère et **réellement interrogé**.
 *
 * Ce que cela prouve, et ce que cela ne prouve pas. Cela prouve que le worker
 * *sert* des métriques au format Prometheus sur le chemin que
 * `infra/grafana/prometheus.yml` déclare scraper. Cela ne prouve **pas** que
 * Prometheus les ingère : il faudrait démarrer le profil `obs`, ce que la
 * routine interdit (pas de reconstruction d'infra). Le saut entre le scrape
 * config et cet endpoint est de la configuration que
 * `scripts/observability-check.js` lit, pas du trafic qu'il observe.
 */
describe('worker metrics endpoint', () => {
  async function withServer<T>(fn: (base: string) => Promise<T>): Promise<T> {
    const server = await startVersionServer({}, 0);
    const { port } = server.address() as AddressInfo;
    try {
      return await fn(`http://127.0.0.1:${port}`);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }

  it('serves the Prometheus exposition on the path prometheus.yml scrapes', async () => {
    await withServer(async (base) => {
      const res = await fetch(`${base}${METRICS_PATH}`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe(PROMETHEUS_CONTENT_TYPE);
      // Un manifeste ou des métriques mis en cache décriraient l'artefact
      // précédent — exactement l'erreur que ce socket existe pour détecter.
      expect(res.headers.get('cache-control')).toBe('no-store');

      const body = await res.text();
      expect(body).toContain('nodejs_eventloop_lag_p99_seconds');
      expect(body).toContain('process_resident_memory_bytes');
    });
  });

  it('tags every series as the worker, so a misrouted proxy stays detectable', async () => {
    await withServer(async (base) => {
      const body = await (await fetch(`${base}${METRICS_PATH}`)).text();
      expect(body).toContain('app="worker"');
      expect(body).not.toContain('app="api"');
    });
  });

  it('leaks no connection string into an unauthenticated surface', async () => {
    process.env.DATABASE_URL = 'postgresql://pilotage:secret@postgres:5432/pilotage';
    process.env.REDIS_URL = 'redis://redis:6379';

    await withServer(async (base) => {
      const body = await (await fetch(`${base}${METRICS_PATH}`)).text();
      expect(body).not.toContain('secret');
      expect(body).not.toContain('postgresql://');
      expect(body).not.toContain('redis://');
    });
  });

  it('still serves the release manifest — metrics did not displace it', async () => {
    await withServer(async (base) => {
      for (const path of VERSION_PATHS) {
        expect((await fetch(`${base}${path}`)).status).toBe(200);
      }
    });
  });

  it('keeps everything else a 404, including a non-GET on the metrics path', async () => {
    await withServer(async (base) => {
      expect((await fetch(`${base}/internal/metrics`)).status).toBe(404);
      expect((await fetch(`${base}${METRICS_PATH}`, { method: 'POST' })).status).toBe(404);
    });
  });

  it('announces the content type prom-client actually produces', () => {
    expect(PROMETHEUS_CONTENT_TYPE).toBe(registry.contentType);
  });

  /* ---------------------------------------------------------------- *
   * S-E02-17 / PF-56 — the queue third, proven over the same socket
   * ---------------------------------------------------------------- */

  afterEach(() => {
    registerQueueDepthSources([]);
  });

  it('T7 — serves the three queue metric families on the scraped path', async () => {
    await withServer(async (base) => {
      const res = await fetch(`${base}${METRICS_PATH}`);
      expect(res.status).toBe(200);
      const body = await res.text();
      for (const metric of [
        'pilotage_queue_depth',
        'pilotage_queue_jobs_total',
        'pilotage_queue_job_duration_seconds',
        'pilotage_queue_depth_collection_failures_total',
      ]) {
        expect(body).toContain(`# TYPE ${metric} `);
      }
    });
  });

  /**
   * AC-6, executed end to end — this is the case that proves
   * `version-server.ts`'s `.catch(→ 500)` is never reached.
   *
   * Measured on prom-client@15.1.3: a `collect()` that rejects makes
   * `registry.metrics()` reject, and this socket turns that into an HTTP 500 —
   * the response AC-6 forbids. Nothing but the collector's own guard stands
   * between a Redis blip and a scrape endpoint that reports the worker broken.
   */
  it('T-D4-3 — a REJECTING depth source still yields 200 with a body', async () => {
    registerQueueDepthSources([
      { queue: 'exports', getJobCounts: async () => Promise.reject(new Error('ECONNREFUSED')) },
    ]);

    await withServer(async (base) => {
      const res = await fetch(`${base}${METRICS_PATH}`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe(PROMETHEUS_CONTENT_TYPE);

      const body = await res.text();
      expect(body.length).toBeGreaterThan(0);
      // The process metrics — the two most useful signals a task executor has —
      // must not disappear because one queue collector failed.
      expect(body).toContain('nodejs_eventloop_lag_p99_seconds');
      expect(body).toContain('process_resident_memory_bytes');
    });
  });

  /**
   * The load-bearing half. A dead Redis does not reject promptly: `ioredis`
   * defaults to `enableOfflineQueue: true` with a retry strategy climbing to a
   * 20 s cap, so `getJobCounts()` WAITS. A never-settling `collect()` makes
   * `registry.metrics()` hang, and this socket then writes no response at all —
   * strictly worse than a 500, and invisible to a test that only mocks a
   * rejection.
   */
  it(
    'T-D4-4 — a depth source that NEVER settles still yields 200, within the bound',
    async () => {
      registerQueueDepthSources([
        {
          queue: 'exports',
          getJobCounts: () => new Promise<Record<string, number>>(() => {}),
        } satisfies QueueDepthSource,
      ]);

      await withServer(async (base) => {
        const startedAt = Date.now();
        const res = await fetch(`${base}${METRICS_PATH}`);
        const elapsed = Date.now() - startedAt;

        expect(res.status).toBe(200);
        expect((await res.text()).length).toBeGreaterThan(0);
        expect(elapsed).toBeLessThan(DEPTH_COLLECT_TIMEOUT_MS + 3_000);
      });
    },
    DEPTH_COLLECT_TIMEOUT_MS + 12_000,
  );

  it('T8 — still leaks no connection string now that queue series are present', async () => {
    process.env.DATABASE_URL = 'postgresql://pilotage:secret@postgres:5432/pilotage';
    process.env.REDIS_URL = 'redis://redis:6379';
    registerQueueDepthSources([
      { queue: 'exports', getJobCounts: async () => ({ waiting: 3, active: 1 }) },
    ]);

    await withServer(async (base) => {
      const body = await (await fetch(`${base}${METRICS_PATH}`)).text();
      // prom-client renders the registry's default labels AFTER the metric's
      // own, so the assertion is on the label pair, not on a formatted line.
      expect(body).toMatch(
        /^pilotage_queue_depth\{queue="exports",state="waiting",[^}]*\} 3$/m,
      );
      expect(body).not.toContain('secret');
      expect(body).not.toContain('redis://');
    });
  });
});
