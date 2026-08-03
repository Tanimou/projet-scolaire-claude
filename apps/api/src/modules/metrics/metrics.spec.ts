import type { MiddlewareConsumer } from '@nestjs/common';

import { MetricsController } from './metrics.controller';
import { MetricsMiddleware, type MetricsRequest, type MetricsResponse } from './metrics.middleware';
import { MetricsModule } from './metrics.module';
import {
  registry,
  routeLabel,
  UNMATCHED_ROUTE,
  PROMETHEUS_CONTENT_TYPE,
  httpRequestsTotal,
} from './metrics.registry';

/**
 * S-E02-13 / PF-56 — the API's Prometheus surface.
 *
 * The rule under test is not "metrics are produced". It is that **`/metrics` is
 * an unauthenticated endpoint that must never carry an identifier**. Prometheus
 * scrapes without a token; the endpoint's access control is the docker network
 * (`scripts/observability-check.js` fails if nginx ever publishes it). So the
 * payload has to be safe on its own terms, not merely hard to reach.
 *
 * The failure mode is one line of code away: labelling by `req.originalUrl`
 * instead of by the matched route template. That turns every student id into a
 * time series — an unbounded cardinality explosion *and* a leak of tenant
 * identifiers onto an unauthenticated surface (G-TENANT). These tests drive the
 * label function with a request that carries both, and assert the resolved one
 * is not what comes out.
 */

/** A request as Express hands it to the middleware after a route matched. */
function matchedRequest(overrides: Partial<MetricsRequest> = {}): MetricsRequest {
  return {
    method: 'GET',
    route: { path: '/students/:id' },
    baseUrl: '/api/v1',
    originalUrl: '/api/v1/students/clx8k2m1p0000abcd1234efgh?include=grades',
    url: '/students/clx8k2m1p0000abcd1234efgh',
    ...overrides,
  };
}

/** A response whose `finish` handler this test controls. */
function fakeResponse(statusCode: number): MetricsResponse & { finish: () => void } {
  const listeners: (() => void)[] = [];
  return {
    statusCode,
    on(_event: 'finish', listener: () => void) {
      listeners.push(listener);
      return this;
    },
    finish() {
      for (const listener of listeners) listener();
    },
  };
}

describe('routeLabel — the cardinality and privacy rule', () => {
  it('labels by the matched route template', () => {
    expect(routeLabel(matchedRequest())).toBe('/api/v1/students/:id');
  });

  it('never emits the resolved identifier, even though the request carries it', () => {
    const label = routeLabel(matchedRequest());
    expect(label).not.toContain('clx8k2m1p0000abcd1234efgh');
    expect(label).not.toContain('?');
  });

  it('collapses every unmatched URL onto a single series', () => {
    // A scanner can invent unbounded distinct URLs. If each became its own
    // label value, an unauthenticated 404 would be a memory-exhaustion vector.
    const first = routeLabel({ originalUrl: '/wp-admin/../../etc/passwd', url: '/a' });
    const second = routeLabel({ originalUrl: '/some/other/nonsense', url: '/b' });
    expect(first).toBe(UNMATCHED_ROUTE);
    expect(second).toBe(UNMATCHED_ROUTE);
  });

  it('treats a route with an empty or non-string path as unmatched', () => {
    expect(routeLabel({ route: { path: '' } })).toBe(UNMATCHED_ROUTE);
    expect(routeLabel({ route: { path: 42 } })).toBe(UNMATCHED_ROUTE);
    expect(routeLabel({ route: undefined })).toBe(UNMATCHED_ROUTE);
  });

  it('includes the router mount point, so two routers cannot collide', () => {
    expect(routeLabel({ route: { path: '/:id' }, baseUrl: '/api/v1/classes' })).toBe(
      '/api/v1/classes/:id',
    );
  });
});

describe('MetricsMiddleware — measures without standing in the request path', () => {
  it('calls next() immediately, before the response finishes', () => {
    const next = jest.fn();
    new MetricsMiddleware().use(matchedRequest(), fakeResponse(200), next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('records the request once the response finishes', async () => {
    const before = await httpRequestsTotal.get();
    const beforeCount = before.values.length;

    const res = fakeResponse(201);
    new MetricsMiddleware().use(
      matchedRequest({ route: { path: '/metrics-spec-probe' }, baseUrl: '' }),
      res,
      () => undefined,
    );
    res.finish();

    const after = await httpRequestsTotal.get();
    const probe = after.values.find((value) => value.labels.route === '/metrics-spec-probe');
    expect(probe).toBeDefined();
    expect(probe?.labels.status_code).toBe('201');
    expect(after.values.length).toBeGreaterThan(beforeCount);
  });

  it('never throws into the response emitter when labelling fails', () => {
    // A metrics failure must degrade to "no data point", never to a crash in
    // the server's own event emitter — the request is already served by then.
    const res = fakeResponse(200);
    const hostile = {
      get method(): string {
        throw new Error('boom');
      },
    } as unknown as MetricsRequest;

    new MetricsMiddleware().use(hostile, res, () => undefined);
    expect(() => res.finish()).not.toThrow();
  });
});

describe('MetricsModule — the middleware is actually registered', () => {
  /**
   * `scripts/boot-check.js` calls `.compile()`, never `.init()` — that is what
   * lets it run with no Postgres or Redis, and it means `configure()` is never
   * executed by the boot gate. So the module could register its middleware on
   * nothing and every gate would stay green: the controller would still appear
   * in the route table, `/metrics` would still answer, and every series except
   * the HTTP ones would silently be missing.
   *
   * This test executes `configure()` directly against a fake consumer.
   */
  it('applies the middleware to every route', () => {
    const forRoutes = jest.fn();
    const apply = jest.fn().mockReturnValue({ forRoutes });

    new MetricsModule().configure({ apply } as unknown as MiddlewareConsumer);

    expect(apply).toHaveBeenCalledWith(MetricsMiddleware);
    // '*' and not a subset: excluding the operational surfaces would hide the
    // most ordinary deployment failure there is — a readiness probe that has
    // started taking eight seconds.
    expect(forRoutes).toHaveBeenCalledWith('*');
  });
});

describe('MetricsController — the exposition itself', () => {
  it('serves the Prometheus text format', async () => {
    const body = await new MetricsController().metrics();
    expect(typeof body).toBe('string');
    expect(body).toContain('pilotage_http_requests_total');
  });

  it('announces the content type prom-client actually produces', () => {
    // The literal exists because a @Header() decorator needs a constant. This
    // test is what keeps the literal honest across a prom-client upgrade.
    expect(PROMETHEUS_CONTENT_TYPE).toBe(registry.contentType);
  });

  it('carries the default node metrics an SLO dashboard needs', async () => {
    const body = await new MetricsController().metrics();
    expect(body).toContain('nodejs_eventloop_lag_p99_seconds');
    expect(body).toContain('process_resident_memory_bytes');
  });

  it('tags every series with the artefact it came from', async () => {
    const body = await new MetricsController().metrics();
    expect(body).toContain('app="api"');
  });

  it('exposes no identifier-shaped label value', async () => {
    const res = fakeResponse(200);
    new MetricsMiddleware().use(matchedRequest(), res, () => undefined);
    res.finish();

    const body = await new MetricsController().metrics();
    expect(body).not.toContain('clx8k2m1p0000abcd1234efgh');
    expect(body).toContain('/api/v1/students/:id');
  });
});
