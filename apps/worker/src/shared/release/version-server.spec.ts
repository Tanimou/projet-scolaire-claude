import type { AddressInfo } from 'node:net';

import {
  DEFAULT_VERSION_PORT,
  VERSION_PATHS,
  resolveVersionPort,
  startVersionServer,
} from './version-server';

/**
 * Preuve exécutée pour S-E02-10 / PF-68 (gate G-MIGRATION).
 *
 * Le serveur est réellement démarré et réellement interrogé sur un port éphémère.
 * Un test qui se contenterait d'appeler le handler prouverait que la fonction
 * renvoie un objet ; il ne prouverait pas que le worker **écoute**, ce qui est
 * précisément la moitié manquante de PF-68.
 */
describe('worker release manifest server', () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  async function withServer<T>(fn: (base: string) => Promise<T>): Promise<T> {
    const server = await startVersionServer({}, 0);
    const { port } = server.address() as AddressInfo;
    try {
      return await fn(`http://127.0.0.1:${port}`);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }

  it('serves the manifest on both paths, and names itself "worker"', async () => {
    process.env.GIT_SHA = 'abcdef1234567890';
    process.env.EXPECTED_GIT_SHA = 'abcdef1234567890';

    await withServer(async (base) => {
      for (const path of VERSION_PATHS) {
        const res = await fetch(`${base}${path}`);
        expect(res.status).toBe(200);

        const body = (await res.json()) as {
          app: string;
          buildSha: string;
          release: { verdict: string; expectedSha: string | null };
        };
        // L'identité de l'artefact est le point : sans elle, un proxy mal routé
        // qui renverrait le manifeste de l'API ici serait indiscernable.
        expect(body.app).toBe('worker');
        expect(body.buildSha).toBe('abcdef123456');
        expect(body.release.verdict).toBe('match');
        expect(body.release.expectedSha).toBe('abcdef123456');
      }
    });
  });

  it('reports drift rather than hiding it', async () => {
    process.env.GIT_SHA = '1111111111111111';
    process.env.EXPECTED_GIT_SHA = '2222222222222222';

    await withServer(async (base) => {
      const res = await fetch(`${base}/version/worker`);
      const body = (await res.json()) as { release: { verdict: string; detail: string | null } };
      expect(body.release.verdict).toBe('drift');
      expect(body.release.detail).toContain('Dérive');
    });
  });

  it('says "unverified" when nothing was compared, instead of claiming success (DNC-08)', async () => {
    process.env.GIT_SHA = '1111111111111111';
    delete process.env.EXPECTED_GIT_SHA;

    await withServer(async (base) => {
      const res = await fetch(`${base}/version/worker`);
      const body = (await res.json()) as { release: { verdict: string } };
      expect(body.release.verdict).toBe('unverified');
    });
  });

  it('exposes nothing else — no other path, no other method', async () => {
    await withServer(async (base) => {
      for (const path of ['/', '/healthz', '/version/api', '/queues', '/version/worker/../..']) {
        const res = await fetch(`${base}${path}`);
        expect(res.status).toBe(404);
      }
      const post = await fetch(`${base}/version/worker`, { method: 'POST' });
      expect(post.status).toBe(404);
    });
  });

  it('never publishes anything beyond the manifest fields', async () => {
    process.env.GIT_SHA = 'abcdef1234567890';
    process.env.DATABASE_URL = 'postgresql://pilotage:secret@postgres:5432/pilotage';
    process.env.REDIS_URL = 'redis://redis:6379';

    await withServer(async (base) => {
      const raw = await (await fetch(`${base}/version/worker`)).text();
      expect(Object.keys(JSON.parse(raw) as object).sort()).toEqual(['app', 'buildSha', 'release']);
      expect(raw).not.toContain('secret');
      expect(raw).not.toContain('postgresql://');
      expect(raw).not.toContain('redis://');
    });
  });

  describe('port resolution', () => {
    it('defaults when unset', () => {
      expect(resolveVersionPort({})).toBe(DEFAULT_VERSION_PORT);
      expect(resolveVersionPort({ WORKER_HTTP_PORT: '  ' })).toBe(DEFAULT_VERSION_PORT);
    });

    it('honours an explicit port', () => {
      expect(resolveVersionPort({ WORKER_HTTP_PORT: '4123' })).toBe(4123);
    });

    it('falls back rather than going silent on an unreadable value', () => {
      // Une valeur illisible ne doit pas devenir « n'écoute nulle part » : ce
      // serait un contournement du manifeste par erreur de configuration.
      expect(resolveVersionPort({ WORKER_HTTP_PORT: 'nope' })).toBe(DEFAULT_VERSION_PORT);
      expect(resolveVersionPort({ WORKER_HTTP_PORT: '99999' })).toBe(DEFAULT_VERSION_PORT);
    });
  });
});
