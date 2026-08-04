import {
  isIdentifierSegment,
  redactSpan,
  resolveTracingConfig,
  sanitizeSpanAttributes,
  sanitizeSpanName,
  sanitizeUrlPath,
  withRedaction,
  TRACED_SERVICES,
  REDACTED_SEGMENT,
  type SpanExporterLike,
} from '@pilotage/contracts';

import { resetTracingForTests, startTracing } from './tracing';

/**
 * S-E02-14 / PF-78 — le pipeline de traces cesse d'être une adresse morte.
 *
 * ---------------------------------------------------------------------------
 * CE QUE CE FICHIER DOIT PROUVER, ET POURQUOI IL LE FAIT SUR UNE VRAIE SOCKET
 * ---------------------------------------------------------------------------
 * La fiche PF-78 dit « configuré de bout en bout, émis par rien ». Un test qui
 * vérifierait que `startTracing()` construit un `NodeSDK` répondrait à côté :
 * c'est précisément l'état d'avant. Il faut montrer qu'une **requête réelle**
 * produit un **span réel**.
 *
 * D'où un `node:http` server sur un port éphémère, réellement interrogé —
 * même discipline que `metrics-server.spec.ts` et `version-server.spec.ts`.
 * Le serveur est volontairement `node:http` nu plutôt que Nest : importer
 * `AppModule` sous ts-jest meurt sur l'ESM de `jose` (PF-67), et le span qui
 * compte ici est celui de l'instrumentation HTTP, identique dans les deux cas.
 */
describe('S-E02-14 · tracing', () => {
  describe('resolveTracingConfig — la déclaration est lue, pas supposée', () => {
    it('is disabled, and says why, when no collector is declared', () => {
      const config = resolveTracingConfig({}, 'api');
      expect(config.enabled).toBe(false);
      expect(config.reason).toContain('OTEL_EXPORTER_OTLP_ENDPOINT is not set');
    });

    it('is enabled by the endpoint the compose file actually hands the API', () => {
      const config = resolveTracingConfig(
        { OTEL_EXPORTER_OTLP_ENDPOINT: 'http://jaeger:4318', GIT_SHA: 'abc123' },
        'api',
      );
      expect(config.enabled).toBe(true);
      expect(config.endpoint).toBe('http://jaeger:4318');
      expect(config.serviceName).toBe('pilotage-api');
      expect(config.serviceVersion).toBe('abc123');
    });

    it('refuses an endpoint that is not an http(s) URL rather than exporting nowhere', () => {
      const config = resolveTracingConfig({ OTEL_EXPORTER_OTLP_ENDPOINT: 'jaeger:4318' }, 'api');
      expect(config.enabled).toBe(false);
      expect(config.reason).toContain('not an http(s) URL');
    });

    it('honours OTEL_SDK_DISABLED, the OpenTelemetry-standard off switch', () => {
      const config = resolveTracingConfig(
        { OTEL_EXPORTER_OTLP_ENDPOINT: 'http://jaeger:4318', OTEL_SDK_DISABLED: 'true' },
        'api',
      );
      expect(config.enabled).toBe(false);
      expect(config.reason).toContain('OTEL_SDK_DISABLED');
    });

    it('falls back to full sampling on an unusable sampler argument', () => {
      for (const arg of ['', 'abc', '-1', '2']) {
        expect(
          resolveTracingConfig(
            { OTEL_EXPORTER_OTLP_ENDPOINT: 'http://jaeger:4318', OTEL_TRACES_SAMPLER_ARG: arg },
            'api',
          ).sampleRatio,
        ).toBe(1);
      }
      expect(
        resolveTracingConfig(
          { OTEL_EXPORTER_OTLP_ENDPOINT: 'http://jaeger:4318', OTEL_TRACES_SAMPLER_ARG: '0.25' },
          'api',
        ).sampleRatio,
      ).toBe(0.25);
    });

    it('names exactly the services that emit — migrator and seed never can', () => {
      // `OTEL_EXPORTER_OTLP_ENDPOINT` vivait sur l'ancre partagée du compose et
      // était distribué à migrator, api, worker, web et seed. Trois d'entre eux
      // ne pouvaient rien émettre. La gate compare cette liste au compose.
      //
      // S-E02-15 (PF-79) fait passer la liste de deux à TROIS : `web` émet
      // désormais pour de vrai, par le hook `register()` de Next 15. Élargir
      // cette liste n'est légitime que dans ce sens-là — parce que la capacité
      // d'émettre a été AJOUTÉE, et qu'elle est prouvée ailleurs par exécution :
      // `scripts/tracing-check.js` exige une sonde `web` qui produit au moins un
      // span, et échoue dans les DEUX sens si cette liste et le compose
      // divergent. Ce test-ci n'en est que la relecture lisible.
      //
      // `migrator` et `seed` restent dehors et doivent le rester : ce sont des
      // jobs one-shot, c'est-à-dire PF-78 lui-même.
      expect([...TRACED_SERVICES]).toEqual(['api', 'worker', 'web']);
    });
  });

  /* ---------------------------------------------------------------------- *
   * G-TENANT — la règle de caviardage
   * ---------------------------------------------------------------------- */
  describe('G-TENANT · aucun identifiant ne part vers un collecteur non authentifié', () => {
    it('recognises the identifier shapes this database actually produces', () => {
      expect(isIdentifierSegment('clx1234567890abcdefghij')).toBe(true); // cuid Prisma
      expect(isIdentifierSegment('550e8400-e29b-41d4-a716-446655440000')).toBe(true); // uuid
      expect(isIdentifierSegment('42')).toBe(true);
      expect(isIdentifierSegment('507f1f77bcf86cd799439011')).toBe(true); // ObjectId
      expect(isIdentifierSegment('students')).toBe(false);
      expect(isIdentifierSegment('api')).toBe(false);
      expect(isIdentifierSegment('')).toBe(false);
    });

    it('reduces a resolved URL to a template and drops the query string entirely', () => {
      expect(sanitizeUrlPath('/api/v1/students/clx1234567890abcdefghij/grades')).toBe(
        `/api/v1/students/${REDACTED_SEGMENT}/grades`,
      );
      // La query string part en entier : une liste d'autorisation serait à
      // tenir à jour, et l'oubli est silencieux.
      expect(sanitizeUrlPath('/api/v1/grades?studentId=clx123&tenantId=demo')).toBe(
        '/api/v1/grades',
      );
      expect(sanitizeUrlPath('http://api:4000/api/v1/students/42')).toBe(
        `http://api:4000/api/v1/students/${REDACTED_SEGMENT}`,
      );
    });

    it('drops db.statement — the ioredis attribute that carries tenant-keyed commands', () => {
      const out = sanitizeSpanAttributes({
        'db.statement': 'GET tenant:demo:user:clx1234567890abcdefghij:session',
        'db.system': 'redis',
      });
      expect(out['db.statement']).toBeUndefined();
      expect(out['db.system']).toBe('redis');
    });

    it('drops any header attribute, including one no instrumentation writes today', () => {
      const out = sanitizeSpanAttributes({
        'http.request.header.authorization': 'Bearer ey…',
        'http.request.header.x-tenant-id': 'demo',
        'http.response.header.some-future-header': 'x',
        'http.method': 'GET',
      });
      expect(Object.keys(out)).toEqual(['http.method']);
    });

    it('leaves http.route alone — it is already a template', () => {
      const out = sanitizeSpanAttributes({ 'http.route': '/api/v1/students/:id' });
      expect(out['http.route']).toBe('/api/v1/students/:id');
    });

    it('sanitises the span name, which is what an operator reads first', () => {
      expect(sanitizeSpanName('GET /api/v1/students/clx1234567890abcdefghij')).toBe(
        `GET /api/v1/students/${REDACTED_SEGMENT}`,
      );
      expect(sanitizeSpanName('GET')).toBe('GET');
    });

    it('never mutates the span it was handed', () => {
      const original = {
        name: 'GET /api/v1/students/42',
        attributes: { 'url.full': '/api/v1/students/42', 'db.statement': 'GET k' },
      };
      const redacted = redactSpan(original);

      expect(redacted.name).toBe(`GET /api/v1/students/${REDACTED_SEGMENT}`);
      expect(redacted.attributes['db.statement']).toBeUndefined();
      // Le SDK conserve et relit les spans (retries, forceFlush) : muter un
      // objet qu'un autre composant possède est un couplage invisible.
      expect(original.name).toBe('GET /api/v1/students/42');
      expect(original.attributes['db.statement']).toBe('GET k');
    });

    it('redacts through the exporter wrapper, which is the only point every span passes', () => {
      const seen: Array<{ name: string; attributes: Record<string, unknown> }> = [];
      const delegate: SpanExporterLike = {
        export: (spans, cb) => {
          seen.push(...spans.map((s) => ({ name: s.name, attributes: { ...s.attributes } })));
          cb({ code: 0 });
        },
        shutdown: () => Promise.resolve(),
      };

      withRedaction(delegate).export(
        [
          {
            name: 'GET /api/v1/students/clx1234567890abcdefghij',
            attributes: { 'url.full': 'http://api:4000/api/v1/students/42?tenantId=demo' },
          },
        ],
        () => undefined,
      );

      expect(seen).toHaveLength(1);
      expect(seen[0]?.name).toBe(`GET /api/v1/students/${REDACTED_SEGMENT}`);
      expect(seen[0]?.attributes['url.full']).toBe(
        `http://api:4000/api/v1/students/${REDACTED_SEGMENT}`,
      );
    });
  });

  /* ---------------------------------------------------------------------- *
   * Le SDK démarre — et pourquoi la preuve d'émission N'EST PAS ici
   * ---------------------------------------------------------------------- */
  describe('startTracing', () => {
    afterEach(() => resetTracingForTests());

    it('starts nothing, and reports why, when no collector is declared', () => {
      const handle = startTracing({}, () => {
        throw new Error('the exporter must not be constructed when tracing is disabled');
      });
      expect(handle.config.enabled).toBe(false);
    });

    it('builds the exporter from the resolved endpoint when one is declared', () => {
      const seen: string[] = [];
      const handle = startTracing(
        { OTEL_EXPORTER_OTLP_ENDPOINT: 'http://jaeger:4318' },
        (config) => {
          seen.push(config.endpoint ?? '');
          return { export: (_s, cb) => cb({ code: 0 }), shutdown: () => Promise.resolve() };
        },
      );
      expect(handle.config.enabled).toBe(true);
      expect(seen).toEqual(['http://jaeger:4318']);
    });

    /**
     * ------------------------------------------------------------------
     * LA PREUVE D'ÉMISSION VIT DANS `scripts/tracing-check.js`, PAS ICI
     * ------------------------------------------------------------------
     * Ce test a d'abord été écrit ici, sur une vraie socket, à l'image de
     * `metrics-server.spec.ts`. **Il rendait 0 span**, et la mesure vaut
     * d'être conservée parce qu'elle n'a rien d'évident.
     *
     * L'instrumentation automatique d'OpenTelemetry passe par
     * `require-in-the-middle`, qui pose un hook sur `Module._load` de Node.
     * Jest n'utilise pas le registre de modules de Node : le hook n'est
     * jamais déclenché, aucune instrumentation ne patche quoi que ce soit,
     * et le SDK démarre sans erreur en n'émettant rien.
     *
     * C'est la même classe de blocage que `jose` sous ts-jest (PF-67), et
     * la même réponse que `S-E02-9` : la preuve tourne **hors de jest**,
     * sous Node nu, contre `dist/`. Vérifié dans les deux sens — la même
     * sonde exécutée par `tsx` (chargeur Node réel) produit **2 spans**
     * correctement caviardés, là où jest en produit 0.
     *
     * Écrire ici un test qui « passe » en se contentant de vérifier que le
     * SDK se construit aurait reproduit exactement PF-78 : une capacité
     * déclarée que rien n'exerce.
     */
    it('documents where the emission proof lives, because jest cannot host it', () => {
      expect(EMISSION_PROOF).toBe('scripts/tracing-check.js');
    });
  });
});

/** Adresse de la preuve d'émission — assertion lisible plutôt que commentaire seul. */
const EMISSION_PROOF = 'scripts/tracing-check.js';
