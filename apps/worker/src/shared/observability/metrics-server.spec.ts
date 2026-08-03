import type { AddressInfo } from 'node:net';

import { METRICS_PATH, VERSION_PATHS, startVersionServer } from '../release/version-server';

import { PROMETHEUS_CONTENT_TYPE, registry } from './metrics.registry';

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
});
