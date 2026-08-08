import 'reflect-metadata';

import { getQueueToken } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { ExportsProcessor } from '../../modules/exports/exports.processor';
import { ImportsProcessor } from '../../modules/imports/imports.processor';
import { NotificationsEmailProcessor } from '../../modules/notifications-email/notifications-email.processor';
import {
  QUEUE_EXPORTS,
  QUEUE_IMPORTS,
  QUEUE_NOTIFICATIONS_EMAIL,
} from '../queue/queue.module';

import { registry } from './metrics.registry';
import { ObservabilityModule } from './observability.module';
import { QueueDepthCollector } from './queue-depth.collector';
import {
  INSTRUMENTED_QUEUES,
  JOB_STATES,
  queueDepth,
  queueDepthCollectionFailures,
  queueDepthSourceCount,
  queueJobsTotal,
  queueStalledTotal,
  registerQueueDepthSources,
} from './queue-metrics';

/**
 * S-E02-18 / PF-106 — the wiring S-E02-17 shipped, EXECUTED.
 *
 * WHAT WAS MISSING, PRECISELY
 * ---------------------------
 * S-E02-17 added `QueueDepthCollector.onModuleInit` and six `@OnWorkerEvent`
 * handlers, and nothing anywhere ran a single one of them. A swapped
 * `@InjectQueue` token, an `ObservabilityModule` dropped from `AppModule`, or a
 * handler bound to an event BullMQ never emits would all ship green — and the
 * dashboard would render "No data" for ever, which is indistinguishable from an
 * idle system. `queue-metrics.spec.ts` beside this file covers the metric
 * FUNCTIONS; this file covers what CALLS them.
 *
 * WHY `Test.createTestingModule` OVER `getQueueToken(...)` STUBS
 * -------------------------------------------------------------
 * Importing `ObservabilityModule` (or `QueueModule`) here would evaluate
 * `BullModule.forRoot`, and Nest DI would then build a real `Queue` — i.e. open
 * an ioredis handle, which is a hung jest run, not a red test. The tokens are
 * the seam: `getQueueToken(name)` is the exact provider token
 * `BullModule.registerQueue({ name })` produces, so a collector that injected
 * the WRONG name would find no provider and Nest would throw at
 * `createTestingModule` — which is the assertion, made by the framework.
 *
 * TWO LAYERS OF DEFENCE ON THE EVENT NAMES, AND THAT IS DELIBERATE
 * ---------------------------------------------------------------
 * `OnWorkerEvent` is typed `(eventName: keyof WorkerListener)`, so
 * `@OnWorkerEvent('complete')` — an event BullMQ never emits — is a COMPILE
 * error. The compiler is the first defence. The metadata assertions below are
 * the second, and they are not redundant: they pin the fact that the decorator
 * really wrote `{ eventName }` onto the method, which is what Nest reads at
 * bootstrap. Because the first defence makes the real negative uncompilable,
 * the "can this actually fail" proof runs the SAME extracted predicate against
 * a synthetic class carrying `'complete'` through `Reflect.defineMetadata`.
 *
 * Every assertion is over a RESOLVED value — the rendered exposition, resolved
 * Nest metadata, a returned count. Never over source text (R-26 / PF-83).
 */

/**
 * `ON_WORKER_EVENT_METADATA` from `@nestjs/bullmq@10.2.3`
 * (`dist/bull.constants.js`). Declared as a literal because the package index
 * does NOT re-export it, and deep-importing `@nestjs/bullmq/dist/bull.constants`
 * would couple this spec to the package's internal file layout.
 *
 * A rename in Nest would therefore make the literal stale — so the tests below
 * ALSO assert the key is present on a method known to be decorated. Without
 * that, a rename would make every event-name assertion pass vacuously, which is
 * PF-106's exact shape relocated into the test written to close PF-106.
 */
const ON_WORKER_EVENT_METADATA = 'bullmq:worker_events_metadata';

/** A stub in the shape `QueueDepthCollector` reads: a name and a counter reader. */
function queueStub(name: string, value: number): { name: string; getJobCounts: jest.Mock } {
  return {
    name,
    getJobCounts: jest.fn(async () => Object.fromEntries(JOB_STATES.map((s) => [s, value]))),
  };
}

/** Every sample line of one metric family in the rendered exposition. */
function samplesOf(exposition: string, metric: string): string[] {
  return exposition
    .split('\n')
    .filter((line) => line.startsWith(`${metric}{`) || line.startsWith(`${metric} `));
}

/**
 * The value of one sample, matched by the labels that matter.
 *
 * A parser rather than a `toContain` on a formatted line, for the reason
 * `queue-metrics.spec.ts` states: prom-client renders the registry's DEFAULT
 * labels after the metric's own, so a string assertion over that ordering
 * asserts the formatter, not the exposition.
 */
function sample(
  exposition: string,
  metric: string,
  labels: Record<string, string>,
): number | undefined {
  for (const line of samplesOf(exposition, metric)) {
    const parsed = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{([^}]*)\})?\s+(\S+)$/.exec(line.trim());
    if (!parsed || parsed[1] !== metric) continue;
    const got: Record<string, string> = {};
    for (const pair of (parsed[2] ?? '').matchAll(/([a-zA-Z_][a-zA-Z0-9_]*)="([^"]*)"/g)) {
      got[pair[1] as string] = pair[2] as string;
    }
    if (Object.entries(labels).every(([key, value]) => got[key] === value)) {
      return Number(parsed[3]);
    }
  }
  return undefined;
}

/** The `queue` label values one family really carries, sorted. */
function queueLabelsOf(exposition: string, metric: string): string[] {
  return samplesOf(exposition, metric)
    .map((line) => /queue="([^"]*)"/.exec(line)?.[1] ?? '')
    .sort();
}

/* ------------------------------------------------------------------ *
 * The predicates, extracted ONCE so the guard and its proof cannot drift
 * (DNC-01 at the test layer).
 * ------------------------------------------------------------------ */

/** The `eventName` a `@OnWorkerEvent`-decorated method really carries. */
function workerEventNameOf(method: unknown): string | undefined {
  if (typeof method !== 'function') return undefined;
  const meta = Reflect.getMetadata(ON_WORKER_EVENT_METADATA, method) as
    | { eventName?: unknown }
    | undefined;
  return typeof meta?.eventName === 'string' ? meta.eventName : undefined;
}

/** Does a Nest module's RESOLVED `imports` metadata contain this module? */
// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
function moduleImportsContain(host: Function, imported: Function): boolean {
  const imports = Reflect.getMetadata('imports', host);
  return Array.isArray(imports) && imports.includes(imported);
}

/**
 * A distinctive number no other spec in this repository uses, so a residual
 * sample from an earlier test cannot satisfy the depth assertion by accident.
 */
const DISTINCTIVE_DEPTH = 4242;

beforeEach(() => {
  registerQueueDepthSources([]);
  queueDepth.reset();
  queueJobsTotal.reset();
  queueStalledTotal.reset();
  queueDepthCollectionFailures.reset();
  for (const queue of INSTRUMENTED_QUEUES) queueDepthCollectionFailures.inc({ queue }, 0);
  // `registerQueueDepthSources([])` above already re-seeded the bound gauge to
  // zero for every instrumented queue — asserted here rather than repeated, so
  // the reset path and the production path stay the same code.
});

afterEach(() => {
  // Module-scope state: `depthSources` REPLACES and `collectQueueDepth`
  // deduplicates through a module-level in-flight promise, so leaving sources
  // bound would bleed samples into the next case.
  registerQueueDepthSources([]);
});

describe('QueueDepthCollector — the wiring is executed, not merely declared (AC-1)', () => {
  it('C1 — starts from zero bound sources, so nothing below can pass on residue', () => {
    expect(queueDepthSourceCount()).toBe(0);
  });

  it('C2 — onModuleInit binds one depth source per instrumented queue, BY NAME', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        QueueDepthCollector,
        { provide: getQueueToken(QUEUE_EXPORTS), useValue: queueStub(QUEUE_EXPORTS, 1) },
        {
          provide: getQueueToken(QUEUE_NOTIFICATIONS_EMAIL),
          useValue: queueStub(QUEUE_NOTIFICATIONS_EMAIL, 1),
        },
        { provide: getQueueToken(QUEUE_IMPORTS), useValue: queueStub(QUEUE_IMPORTS, 1) },
      ],
    }).compile();

    await moduleRef.init();

    expect(queueDepthSourceCount()).toBe(INSTRUMENTED_QUEUES.length);

    // A COUNT is not the assertion — a collector binding three WRONG queues
    // would satisfy it, which is PF-106's own shape ("a drifting @InjectQueue
    // token") reproduced inside the test written to close it. The names are
    // read back from the exposition, i.e. from the resolved write path.
    const exposition = await registry.metrics();
    expect(queueLabelsOf(exposition, 'pilotage_queue_depth_sources_bound')).toEqual(
      [...INSTRUMENTED_QUEUES].sort(),
    );
    for (const queue of INSTRUMENTED_QUEUES) {
      expect(sample(exposition, 'pilotage_queue_depth_sources_bound', { queue })).toBe(1);
    }

    await moduleRef.close();
  });

  it('C3 — a RENDERED depth sample equals the STUB’s number, not a helper’s return value', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        QueueDepthCollector,
        {
          provide: getQueueToken(QUEUE_EXPORTS),
          useValue: queueStub(QUEUE_EXPORTS, DISTINCTIVE_DEPTH),
        },
        {
          provide: getQueueToken(QUEUE_NOTIFICATIONS_EMAIL),
          useValue: queueStub(QUEUE_NOTIFICATIONS_EMAIL, 7),
        },
        { provide: getQueueToken(QUEUE_IMPORTS), useValue: queueStub(QUEUE_IMPORTS, 7) },
      ],
    }).compile();

    await moduleRef.init();
    const exposition = await registry.metrics();

    // The number travels stub → collector → registerQueueDepthSources →
    // collect() → exposition. Nothing between is asserted; the endpoints are.
    expect(sample(exposition, 'pilotage_queue_depth', { queue: 'exports', state: 'waiting' })).toBe(
      DISTINCTIVE_DEPTH,
    );
    expect(
      sample(exposition, 'pilotage_queue_depth', { queue: 'imports', state: 'waiting' }),
    ).toBe(7);

    await moduleRef.close();
  });

  it('C4 — a queue whose getJobCounts is not a function is DROPPED, and says so (AC-2)', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        QueueDepthCollector,
        { provide: getQueueToken(QUEUE_EXPORTS), useValue: queueStub(QUEUE_EXPORTS, 1) },
        {
          provide: getQueueToken(QUEUE_NOTIFICATIONS_EMAIL),
          useValue: queueStub(QUEUE_NOTIFICATIONS_EMAIL, 1),
        },
        // The realistic shape of a partial binding: the provider resolves, but
        // it is not a Queue. Before this slice the collector dropped it with a
        // `logger.log` count nobody compared to INSTRUMENTED_QUEUES.length.
        { provide: getQueueToken(QUEUE_IMPORTS), useValue: { name: QUEUE_IMPORTS } },
      ],
    }).compile();

    await moduleRef.init();

    expect(queueDepthSourceCount()).toBe(INSTRUMENTED_QUEUES.length - 1);

    const exposition = await registry.metrics();
    expect(sample(exposition, 'pilotage_queue_depth_sources_bound', { queue: 'imports' })).toBe(0);
    expect(sample(exposition, 'pilotage_queue_depth_sources_bound', { queue: 'exports' })).toBe(1);

    // "Never bound" and "bound and failing" must stay DISTINGUISHABLE: the
    // dropped queue's collection-failure counter is still honestly at zero,
    // which is exactly why it could not carry this signal.
    expect(
      sample(exposition, 'pilotage_queue_depth_collection_failures_total', { queue: 'imports' }),
    ).toBe(0);

    await moduleRef.close();
  });

  it('C5 — rebinding REPLACES the bound gauge rather than stacking it', () => {
    registerQueueDepthSources([
      { queue: QUEUE_EXPORTS, getJobCounts: async () => ({}) },
      { queue: QUEUE_IMPORTS, getJobCounts: async () => ({}) },
    ]);
    expect(queueDepthSourceCount()).toBe(2);

    registerQueueDepthSources([{ queue: QUEUE_EXPORTS, getJobCounts: async () => ({}) }]);
    expect(queueDepthSourceCount()).toBe(1);
  });

  it('C5b — a queue unbound between two calls falls back to 0, it does not stay at 1', async () => {
    registerQueueDepthSources([{ queue: QUEUE_IMPORTS, getJobCounts: async () => ({}) }]);
    registerQueueDepthSources([{ queue: QUEUE_EXPORTS, getJobCounts: async () => ({}) }]);

    const exposition = await registry.metrics();
    expect(sample(exposition, 'pilotage_queue_depth_sources_bound', { queue: 'imports' })).toBe(0);
    expect(sample(exposition, 'pilotage_queue_depth_sources_bound', { queue: 'exports' })).toBe(1);
  });
});

describe('the six @OnWorkerEvent handlers are bound to events BullMQ really emits (AC-1)', () => {
  const processors = [
    { name: 'ExportsProcessor', proto: ExportsProcessor.prototype, queue: QUEUE_EXPORTS },
    { name: 'ImportsProcessor', proto: ImportsProcessor.prototype, queue: QUEUE_IMPORTS },
    {
      name: 'NotificationsEmailProcessor',
      proto: NotificationsEmailProcessor.prototype,
      queue: QUEUE_NOTIFICATIONS_EMAIL,
    },
  ] as const;

  it.each(processors)('C6 — $name carries exactly completed/failed/stalled', ({ proto }) => {
    const decorated = proto as unknown as Record<string, unknown>;

    // The literal metadata key is really the one Nest wrote — without this, a
    // rename in @nestjs/bullmq would make every assertion below pass vacuously.
    expect(Reflect.getMetadataKeys(decorated.onCompleted as object)).toContain(
      ON_WORKER_EVENT_METADATA,
    );

    expect(workerEventNameOf(decorated.onCompleted)).toBe('completed');
    expect(workerEventNameOf(decorated.onFailed)).toBe('failed');
    expect(workerEventNameOf(decorated.onStalled)).toBe('stalled');
  });

  it.each(processors)(
    'C7 — $name.onStalled records the stall under ITS OWN queue label',
    async ({ proto, queue }) => {
      const onStalled = (proto as unknown as { onStalled: (id: string) => void }).onStalled;
      // Called off the prototype: the handler must not need the processor's
      // Prisma/S3/mailer collaborators, because BullMQ calls it on a worker
      // whose job could not even be loaded.
      onStalled.call({}, 'clx8k2m1p0000abcd1234efgh');

      const exposition = await registry.metrics();
      expect(sample(exposition, 'pilotage_queue_stalled_total', { queue })).toBe(1);
      expect(queueLabelsOf(exposition, 'pilotage_queue_stalled_total')).toEqual([queue]);
    },
  );

  it('C8 — the event-name predicate can actually FAIL (the compiler is only the first defence)', () => {
    // `@OnWorkerEvent('complete')` is a COMPILE error — `eventName` is typed
    // `keyof WorkerListener` — so the real negative is unwritable as a test
    // against a real processor. The predicate is proven against a throw-away
    // class carrying the misspelling through the same metadata key.
    class MisspelledProcessor {
      onCompleted(): void {
        /* no-op */
      }
    }
    Reflect.defineMetadata(
      ON_WORKER_EVENT_METADATA,
      { eventName: 'complete' },
      MisspelledProcessor.prototype.onCompleted,
    );

    expect(workerEventNameOf(MisspelledProcessor.prototype.onCompleted)).toBe('complete');
    expect(workerEventNameOf(MisspelledProcessor.prototype.onCompleted)).not.toBe('completed');

    // …and it must report "no event at all" for an undecorated method, or the
    // assertions above would be satisfied by a decorator that never ran.
    class Undecorated {
      onStalled(): void {
        /* no-op */
      }
    }
    expect(workerEventNameOf(Undecorated.prototype.onStalled)).toBeUndefined();
  });
});

describe('G-TENANT — the stalled counter cannot carry the identifier it is handed', () => {
  it('C9 — a cuid jobId and a tenant-bearing payload reach the exposition through no label', async () => {
    const JOB_ID = 'clx9q7r4t0001wxyz5678ijkl';
    const TENANT_ID = 'clx8k2m1p0000abcd1234efgh';

    const handler = (
      ExportsProcessor.prototype as unknown as { onStalled: (id: unknown) => void }
    ).onStalled;
    // BullMQ hands `('stalled', jobId, 'active')`. Driven with an
    // identifier-bearing input on purpose: G-TENANT must hold against what the
    // event really carries, not against what the signature suggests.
    handler.call({}, JOB_ID);
    handler.call({ data: { tenantId: TENANT_ID } }, JOB_ID);

    const exposition = await registry.metrics();
    expect(exposition).not.toContain(JOB_ID);
    expect(exposition).not.toContain(TENANT_ID);

    // Anti-vacuity: the series really IS there, so `not.toContain` above is not
    // passing on an implementation that recorded nothing at all.
    expect(sample(exposition, 'pilotage_queue_stalled_total', { queue: 'exports' })).toBe(2);
  });

  it('C10 — the counter is NOT zero-seeded, so "no data" means "never happened"', async () => {
    const exposition = await registry.metrics();
    expect(samplesOf(exposition, 'pilotage_queue_stalled_total')).toEqual([]);
    // The families that ARE zero-seeded stay so — the asymmetry is the point.
    expect(queueLabelsOf(exposition, 'pilotage_queue_depth_collection_failures_total')).toEqual(
      [...INSTRUMENTED_QUEUES].sort(),
    );
  });
});

describe('AppModule really imports ObservabilityModule (AC-1)', () => {
  /**
   * Asserted over RESOLVED Nest metadata, never over `app.module.ts` source
   * text. A regex would be R-26 rule (a) exactly — and it would keep passing on
   * an import that TypeScript elided or that a merge left in the file but out of
   * the decorator's `imports` array.
   */
  it('C11 — the collector is actually wired into the worker application', async () => {
    // Imported lazily: `app.module.ts` pulls Prisma, S3, the mailer and the PDF
    // renderer, and no other case in this file needs that graph.
    const { AppModule } = (await import('../../app.module')) as { AppModule: new () => unknown };
    expect(moduleImportsContain(AppModule, ObservabilityModule)).toBe(true);
  });

  it('C11b — the module-import predicate can actually FAIL', () => {
    @Module({ imports: [] })
    class WithoutObservability {}

    expect(moduleImportsContain(WithoutObservability, ObservabilityModule)).toBe(false);

    @Module({ imports: [ObservabilityModule] })
    class WithObservability {}

    expect(moduleImportsContain(WithObservability, ObservabilityModule)).toBe(true);
  });
});
