import { NotificationKind } from '@prisma/client';

import { GENERATORS } from '../../modules/exports/exports.processor';

import { registry } from './metrics.registry';
import {
  DEPTH_COLLECT_TIMEOUT_MS,
  INSTRUMENTED_QUEUES,
  JOB_NAMES_BY_QUEUE,
  JOB_OUTCOMES,
  JOB_STATES,
  OTHER_JOB,
  classifyFailure,
  isTerminalFailure,
  jobLabel,
  observeJobCompleted,
  observeJobFailed,
  observeJobOutcome,
  queueDepth,
  queueDepthCollectionFailures,
  queueDepthSourceCount,
  queueJobDuration,
  queueJobsTotal,
  registerQueueDepthSources,
  type QueueDepthSource,
} from './queue-metrics';

/**
 * S-E02-17 / PF-56 — the queue third.
 *
 * Every assertion here is made over a **resolved value**: the rendered
 * exposition, a returned label, a required module's exports. Never over source
 * text, never over a comment (R-26 / PF-83 — `boot-gate.spec.ts` earned that
 * rule the hard way).
 *
 * The load-bearing cases are the two failure-mode ones. `T-D4-1` (a rejecting
 * depth source) is the obvious one and it is NOT the realistic one: measured on
 * `prom-client@15.1.3`, a `collect()` that throws makes `registry.metrics()`
 * REJECT, which `version-server.ts` turns into a 500 — but a `collect()` that
 * never settles makes `registry.metrics()` HANG, and no response is written at
 * all. `ioredis` defaults to `enableOfflineQueue: true` with a retry strategy
 * climbing to 20 s, so a dead Redis produces the second shape, not the first.
 * `T-D4-2` is therefore the case that matters, and a suite that only had
 * `T-D4-1` would pass on an implementation that hangs in production.
 */

/** A depth source whose counts are fixed — the plain object the design exists for. */
function staticSource(queue: string, counts: Record<string, number>): QueueDepthSource {
  return { queue, getJobCounts: async () => counts };
}

function fullCounts(value: number): Record<string, number> {
  return Object.fromEntries(JOB_STATES.map((state) => [state, value]));
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
 * Written as a parser rather than a `toContain` on a formatted line, because
 * measurement showed prom-client renders the registry's DEFAULT labels AFTER
 * the metric's own (`{queue="…",state="…",app="worker"}`). A string assertion
 * over that ordering is an assertion about prom-client's formatter, not about
 * what the exposition says — and it would go red on a library upgrade that
 * changed nothing we care about.
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

beforeEach(() => {
  registerQueueDepthSources([]);
  queueDepth.reset();
  queueJobsTotal.reset();
  queueJobDuration.reset();
  // Reset AND re-seed the zeroes, mirroring what the module does at import:
  // the counter is honest at zero, and the gate reads its `queue` labels.
  queueDepthCollectionFailures.reset();
  for (const queue of INSTRUMENTED_QUEUES) queueDepthCollectionFailures.inc({ queue }, 0);
});

afterEach(() => {
  registerQueueDepthSources([]);
});

/* ------------------------------------------------------------------ *
 * AC-1 — depth, every registered queue, every BullMQ state
 * ------------------------------------------------------------------ */

describe('queue depth (AC-1)', () => {
  it('T1 — publishes every BullMQ state for every instrumented queue', async () => {
    registerQueueDepthSources(
      INSTRUMENTED_QUEUES.map((queue, index) => staticSource(queue, fullCounts(index + 1))),
    );

    const exposition = await registry.metrics();

    for (const [index, queue] of INSTRUMENTED_QUEUES.entries()) {
      for (const state of JOB_STATES) {
        // The VALUE is asserted, not just the label: an assertion that only
        // looked for the label would pass on a gauge that was never set.
        expect(sample(exposition, 'pilotage_queue_depth', { queue, state })).toBe(index + 1);
      }
    }
  });

  it('T1b — the state label set is EXACTLY the declared one, in both directions', async () => {
    registerQueueDepthSources([staticSource('exports', fullCounts(3))]);
    const exposition = await registry.metrics();

    const states = samplesOf(exposition, 'pilotage_queue_depth')
      .map((line) => /state="([^"]*)"/.exec(line)?.[1] ?? '')
      .sort();

    // `toEqual`, never `toContain`: BullMQ's own `sanitizeJobTypes` silently
    // APPENDS `paused` when `waiting` is asked for, and a containment assertion
    // would not notice a set that grew behind our back.
    expect(states).toEqual([...JOB_STATES].sort());
  });

  it('T1c — covers the two states a six-state gauge would report as zero', () => {
    // Measured in bullmq@5.76.8 `classes/queue-getters.js:46-65`. A job added
    // with `priority` lands in `prioritized` and NEVER in `waiting`; a flow
    // child waits in `waiting-children`. Six states would show 0 on a
    // backlogged queue — a graph that lies is worse than no graph.
    expect(JOB_STATES).toContain('prioritized');
    expect(JOB_STATES).toContain('waiting-children');
    // and the six AC-1 names are all still there.
    for (const state of ['waiting', 'active', 'delayed', 'failed', 'completed', 'paused']) {
      expect(JOB_STATES).toContain(state);
    }
  });

  it('T1d — asks Redis for the states it publishes, so no state is silently absent', async () => {
    const asked: string[][] = [];
    registerQueueDepthSources([
      {
        queue: 'exports',
        getJobCounts: async (...states: string[]) => {
          asked.push(states);
          return fullCounts(0);
        },
      },
    ]);
    await registry.metrics();
    expect(asked).toHaveLength(1);
    expect(asked[0]).toEqual([...JOB_STATES]);
  });
});

/* ------------------------------------------------------------------ *
 * AC-2 — outcome counter and duration histogram
 * ------------------------------------------------------------------ */

describe('job outcome and duration (AC-2)', () => {
  it('T2 — records the three outcomes, labelled by queue and job only', async () => {
    observeJobOutcome('exports', { name: 'grades_xlsx' }, 'completed');
    observeJobOutcome('exports', { name: 'grades_xlsx' }, 'failed_retryable');
    observeJobOutcome('exports', { name: 'grades_xlsx' }, 'failed_terminal');

    const exposition = await registry.metrics();
    for (const outcome of JOB_OUTCOMES) {
      expect(
        sample(exposition, 'pilotage_queue_jobs_total', {
          queue: 'exports',
          job: 'grades_xlsx',
          outcome,
        }),
      ).toBe(1);
    }
    // Exactly three labels, and none of them an identifier.
    const labelNames = new Set(
      samplesOf(exposition, 'pilotage_queue_jobs_total')
        .flatMap((line) => [...line.matchAll(/([a-z_]+)="/g)].map((match) => match[1])),
    );
    expect([...labelNames].sort()).toEqual(['app', 'job', 'outcome', 'queue']);
  });

  it('T2b — observes a duration when both BullMQ timestamps are present', async () => {
    observeJobCompleted('imports', {
      name: 'apply',
      processedOn: 1_000,
      finishedOn: 3_500,
    });

    const exposition = await registry.metrics();
    const labels = { queue: 'imports', job: 'apply' };
    expect(sample(exposition, 'pilotage_queue_job_duration_seconds_sum', labels)).toBe(2.5);
    expect(sample(exposition, 'pilotage_queue_job_duration_seconds_count', labels)).toBe(1);
  });

  it('T4 — a missing timestamp records the counter but NO duration', async () => {
    observeJobCompleted('imports', { name: 'apply', processedOn: 1_000 });
    observeJobCompleted('imports', { name: 'rollback', finishedOn: 1_000 });
    observeJobCompleted('imports', { name: 'apply' });

    const exposition = await registry.metrics();
    expect(
      sample(exposition, 'pilotage_queue_jobs_total', {
        queue: 'imports',
        job: 'apply',
        outcome: 'completed',
      }),
    ).toBe(2);
    // A zero-second bucket is a lie that shifts the p95, so there must be no
    // observation at all rather than a fabricated 0.
    expect(samplesOf(exposition, 'pilotage_queue_job_duration_seconds_count')).toEqual([]);
  });

  it('T3 — isTerminalFailure boundary table', () => {
    expect(isTerminalFailure(1, 3)).toBe(false);
    expect(isTerminalFailure(2, 3)).toBe(false);
    expect(isTerminalFailure(3, 3)).toBe(true);
    expect(isTerminalFailure(4, 3)).toBe(true);
    // `attempts` absent → BullMQ's real default is 0, so the job is never
    // retried. Claiming "retryable" for a job that will not be retried is the
    // metric describing a mechanism that will not run.
    expect(isTerminalFailure(1, undefined)).toBe(true);
    expect(isTerminalFailure(1, 0)).toBe(true);
    // An unreadable attempt count is terminal: the safe default is the one that
    // does not promise a retry it cannot evidence.
    expect(isTerminalFailure(undefined, 3)).toBe(true);
  });

  it('T3b — classifyFailure mirrors BullMQ shouldRetryJob, not a paraphrase of it', () => {
    // bullmq@5.76.8 classes/job.js:483-486.
    expect(classifyFailure({ attemptsMade: 1, opts: { attempts: 3 } })).toBe('failed_retryable');
    expect(classifyFailure({ attemptsMade: 3, opts: { attempts: 3 } })).toBe('failed_terminal');
    expect(classifyFailure({ attemptsMade: 1, opts: {} })).toBe('failed_terminal');
    // `job.discard()` — terminal with attempts left. Arithmetic alone says retryable.
    // `discarded` is `protected` on BullMQ's `Job` (classes/job.d.ts:136), so it is
    // deliberately NOT a member of `JobOutcomeSource` — declaring it there would make a
    // real `Job` unassignable and take the three processors red. `classifyFailure` reads
    // it defensively off the instance instead, and this case is what proves that read
    // still happens. Bound to a variable rather than passed as a fresh object literal:
    // excess-property checking only fires on literals, and the point here is a job that
    // carries MORE than the interface names.
    const discardedJob = { attemptsMade: 1, opts: { attempts: 3 }, discarded: true };
    expect(classifyFailure(discardedJob)).toBe('failed_terminal');
    // UnrecoverableError — terminal on attempt 1 of 3.
    const unrecoverable = Object.assign(new Error('nope'), { name: 'UnrecoverableError' });
    expect(classifyFailure({ attemptsMade: 1, opts: { attempts: 3 } }, unrecoverable)).toBe(
      'failed_terminal',
    );
    // A plain error on attempt 1 of 3 is still a retry.
    expect(classifyFailure({ attemptsMade: 1, opts: { attempts: 3 } }, new Error('boom'))).toBe(
      'failed_retryable',
    );
  });

  it('T-FM7 — the failed handler survives an undefined job', async () => {
    // `worker.js:659` emits ('failed', job, err) and there are paths where the
    // job could not be loaded. A handler doing `job.name` would throw inside an
    // EventEmitter listener → unhandled rejection → the worker process exits.
    expect(() => observeJobFailed('exports', undefined, new Error('x'))).not.toThrow();
    expect(() => observeJobFailed('exports', {}, new Error('x'))).not.toThrow();

    const exposition = await registry.metrics();
    expect(
      sample(exposition, 'pilotage_queue_jobs_total', {
        queue: 'exports',
        job: OTHER_JOB,
        outcome: 'failed_terminal',
      }),
    ).toBe(2);
  });
});

/* ------------------------------------------------------------------ *
 * AC-3 — G-TENANT: no label carries an identifier
 * ------------------------------------------------------------------ */

describe('label safety (AC-3, G-TENANT)', () => {
  const TENANT_ID = 'clx8k2m1p0000abcd1234efgh';
  const EXPORT_JOB_ID = 'clx9q7r4t0001wxyz5678ijkl';
  const CUID_JOB_NAME = 'clxa1b2c3d0002mnop9012qrst';

  it('T-SEC-1 — a real payload reaches the exposition through no label at all', async () => {
    // The payload shape is `ExportJobPayload` (exports.processor.ts). The job
    // NAME is a cuid too, because that is the one value an attacker controls:
    // `apps/api/.../exports.service.ts:74` does `queue.add(dto.kind, …)`, i.e.
    // the name is client-supplied input, closed today only by an `@IsEnum`
    // decorator on a DTO. G-TENANT cannot rest on a decorator in another app.
    observeJobCompleted('exports', {
      name: CUID_JOB_NAME,
      processedOn: 1_000,
      finishedOn: 2_000,
      data: {
        exportJobId: EXPORT_JOB_ID,
        tenantId: TENANT_ID,
        schoolId: 'clx0000000000school00000',
        kind: 'grades_xlsx',
        parameters: {},
        requestedBy: 'clx0000000000user000000',
      },
    } as never);

    const exposition = await registry.metrics();

    expect(exposition).not.toContain(TENANT_ID);
    expect(exposition).not.toContain(EXPORT_JOB_ID);
    expect(exposition).not.toContain(CUID_JOB_NAME);
    expect(
      sample(exposition, 'pilotage_queue_jobs_total', {
        queue: 'exports',
        job: OTHER_JOB,
        outcome: 'completed',
      }),
    ).toBe(1);
  });

  it('T-SEC-1b — the same exposition DOES carry an allow-listed name', async () => {
    // Anti-vacuity. Without this, `not.toContain(cuid)` would also pass on an
    // implementation that emitted no `job` label whatsoever.
    observeJobCompleted('exports', { name: 'report_card_pdf' });
    const exposition = await registry.metrics();
    expect(exposition).toContain('job="report_card_pdf"');
  });

  it('T-SEC-2 — jobLabel is a whitelist, not a sanitiser', () => {
    for (const name of JOB_NAMES_BY_QUEUE.exports) {
      expect(jobLabel('exports', name)).toBe(name);
    }
    // A cuid is lowercase alphanumeric: it survives every plausible
    // character-class filter. Only set membership stops it.
    expect(jobLabel('exports', CUID_JOB_NAME)).toBe(OTHER_JOB);
    expect(jobLabel('exports', '')).toBe(OTHER_JOB);
    expect(jobLabel('exports', 'x'.repeat(300))).toBe(OTHER_JOB);
    expect(jobLabel('exports', 'a",tenant="acme')).toBe(OTHER_JOB);
    expect(jobLabel('exports', '../../etc/passwd')).toBe(OTHER_JOB);
    expect(jobLabel('exports', undefined)).toBe(OTHER_JOB);
    expect(jobLabel('exports', 12)).toBe(OTHER_JOB);
    // A name valid on ANOTHER queue is not valid here.
    expect(jobLabel('exports', 'apply')).toBe(OTHER_JOB);
    // An unknown queue has no allow-list, so everything folds — safe default,
    // not a forgotten case.
    expect(jobLabel('unknown-queue', 'apply')).toBe(OTHER_JOB);
  });

  it('T-SEC-3 — an unknown queue name never becomes its own series', async () => {
    observeJobCompleted('a-queue-nobody-registered', { name: 'apply' });
    const exposition = await registry.metrics();
    expect(exposition).not.toContain('a-queue-nobody-registered');
    expect(exposition).toContain(`queue="${OTHER_JOB}"`);
  });
});

/* ------------------------------------------------------------------ *
 * The allow-lists are COMPARED, not copied (R-26)
 * ------------------------------------------------------------------ */

describe('job-name allow-lists (R-26)', () => {
  it('T5 — exports equals the GENERATORS keys of the processor that consumes it', () => {
    expect([...JOB_NAMES_BY_QUEUE.exports].sort()).toEqual(Object.keys(GENERATORS).sort());
  });

  it('T5b — notifications-email equals NotificationKind from @prisma/client', () => {
    expect([...JOB_NAMES_BY_QUEUE['notifications-email']].sort()).toEqual(
      Object.values(NotificationKind).sort(),
    );
  });

  it('T5c — imports is hand-held, and the file says so', () => {
    // The producers live in apps/api and the worker cannot import them. Stated
    // here so the asymmetry is a recorded decision, not an oversight: a third
    // job name added there would be bucketed as `<other>` — detail lost, never
    // leaked.
    expect([...JOB_NAMES_BY_QUEUE.imports].sort()).toEqual(['apply', 'rollback']);
  });

  it('T5d — every instrumented queue has an allow-list', () => {
    expect(Object.keys(JOB_NAMES_BY_QUEUE).sort()).toEqual([...INSTRUMENTED_QUEUES].sort());
  });
});

/* ------------------------------------------------------------------ *
 * AC-6 / D4 — a Redis failure degrades, it does not wedge
 * ------------------------------------------------------------------ */

describe('depth collector failure modes (AC-6, D4)', () => {
  /** Fails the test if anything escapes as an unhandled rejection. */
  async function withUnhandledRejectionGuard(fn: () => Promise<void>): Promise<void> {
    const seen: unknown[] = [];
    const onUnhandled = (reason: unknown) => seen.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
      await fn();
      // Let the microtask queue and one macrotask turn drain, so a LATE
      // rejection (after the deadline already won) would have surfaced.
      await new Promise((resolve) => setTimeout(resolve, 50));
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
    expect(seen).toEqual([]);
  }

  it('T-D4-1 — a rejecting source still yields a rendered exposition', async () => {
    await withUnhandledRejectionGuard(async () => {
      // Seed a known-good sample first, so "stale survives" is observable.
      registerQueueDepthSources([staticSource('exports', fullCounts(7))]);
      const seeded = await registry.metrics();
      expect(sample(seeded, 'pilotage_queue_depth', { queue: 'exports', state: 'waiting' })).toBe(7);

      registerQueueDepthSources([
        { queue: 'exports', getJobCounts: async () => Promise.reject(new Error('ECONNREFUSED')) },
      ]);

      const exposition = await registry.metrics();
      // Served, not thrown. `version-server.ts` turns a rejection into a 500.
      expect(exposition).toContain('nodejs_eventloop_lag_p99_seconds');
      // C4 — degraded to STALE, never reset() to a misleading zero. Zero is a
      // number an operator acts on; the system does not know it.
      expect(sample(exposition, 'pilotage_queue_depth', { queue: 'exports', state: 'waiting' })).toBe(
        7,
      );
      // …and the degradation is VISIBLE rather than silent (DNC-06 by omission).
      expect(
        sample(exposition, 'pilotage_queue_depth_collection_failures_total', { queue: 'exports' }),
      ).toBe(1);
    });
  });

  it('T-D4-1b — a source that throws SYNCHRONOUSLY is caught too', async () => {
    await withUnhandledRejectionGuard(async () => {
      registerQueueDepthSources([
        {
          queue: 'imports',
          getJobCounts: (() => {
            throw new Error('sync boom');
          }) as QueueDepthSource['getJobCounts'],
        },
      ]);
      const exposition = await registry.metrics();
      expect(exposition).toContain('nodejs_eventloop_lag_p99_seconds');
      expect(
        sample(exposition, 'pilotage_queue_depth_collection_failures_total', { queue: 'imports' }),
      ).toBe(1);
    });
  });

  it(
    'T-D4-2 — a source that NEVER settles resolves within the declared bound',
    async () => {
      await withUnhandledRejectionGuard(async () => {
        registerQueueDepthSources([
          { queue: 'exports', getJobCounts: () => new Promise<Record<string, number>>(() => {}) },
        ]);

        const startedAt = Date.now();
        const exposition = await registry.metrics();
        const elapsed = Date.now() - startedAt;

        // This is the realistic Redis failure, and the one a `mockRejectedValue`
        // test would miss entirely: measured on prom-client@15.1.3, a collect()
        // returning a never-settling promise makes registry.metrics() hang for
        // ever — no response is ever written.
        expect(elapsed).toBeGreaterThanOrEqual(DEPTH_COLLECT_TIMEOUT_MS - 100);
        expect(elapsed).toBeLessThan(DEPTH_COLLECT_TIMEOUT_MS + 2_000);
        expect(exposition).toContain('nodejs_eventloop_lag_p99_seconds');
        expect(
          sample(exposition, 'pilotage_queue_depth_collection_failures_total', { queue: 'exports' }),
        ).toBe(1);
      });
    },
    DEPTH_COLLECT_TIMEOUT_MS + 10_000,
  );

  it('T-D4-2b — one stalled queue does not delay or hide the others', async () => {
    await withUnhandledRejectionGuard(async () => {
      registerQueueDepthSources([
        { queue: 'exports', getJobCounts: () => new Promise<Record<string, number>>(() => {}) },
        staticSource('imports', fullCounts(5)),
      ]);
      const exposition = await registry.metrics();
      expect(sample(exposition, 'pilotage_queue_depth', { queue: 'imports', state: 'waiting' })).toBe(
        5,
      );
    });
  }, 20_000);

  it('T-FM2 — the process metrics survive a total depth failure', async () => {
    // `registry.metrics()` is all-or-nothing: a rejecting queue collector would
    // take the two series a task executor actually needs with it — exactly when
    // the system is unhealthy. A regression bought with a feature.
    registerQueueDepthSources(
      INSTRUMENTED_QUEUES.map((queue) => ({
        queue,
        getJobCounts: async () => Promise.reject(new Error('down')),
      })),
    );
    const exposition = await registry.metrics();
    expect(exposition).toContain('nodejs_eventloop_lag_p99_seconds');
    expect(exposition).toContain('process_resident_memory_bytes');
    expect(exposition).toContain('app="worker"');
  });

  it('T6 — with zero sources the collector is a no-op that resolves at once', async () => {
    registerQueueDepthSources([]);
    expect(queueDepthSourceCount()).toBe(0);

    const startedAt = Date.now();
    const exposition = await registry.metrics();
    expect(Date.now() - startedAt).toBeLessThan(1_000);

    // This is the state `scripts/observability-check.js` renders in, and it is
    // why the three families still have to declare their `# TYPE` lines.
    for (const metric of [
      'pilotage_queue_depth',
      'pilotage_queue_jobs_total',
      'pilotage_queue_job_duration_seconds',
    ]) {
      expect(exposition).toContain(`# TYPE ${metric} `);
    }
  });

  it('T-FM13 — registering sources twice replaces rather than appends', () => {
    const source = staticSource('exports', fullCounts(1));
    registerQueueDepthSources([source]);
    registerQueueDepthSources([source]);
    expect(queueDepthSourceCount()).toBe(1);
  });

  it('T-FM13b — a malformed source is dropped rather than trusted', () => {
    registerQueueDepthSources([
      { queue: 'exports' } as unknown as QueueDepthSource,
      staticSource('imports', fullCounts(1)),
    ]);
    expect(queueDepthSourceCount()).toBe(1);
  });
});

/* ------------------------------------------------------------------ *
 * The gate's input, rendered rather than merely declared (C2)
 * ------------------------------------------------------------------ */

describe('the instrumented set the gate reads', () => {
  it('renders one queue label per instrumented queue with NO Redis at all', async () => {
    registerQueueDepthSources([]);
    const exposition = await registry.metrics();

    const rendered = samplesOf(exposition, 'pilotage_queue_depth_collection_failures_total')
      .map((line) => /queue="([^"]*)"/.exec(line)?.[1] ?? '')
      .sort();

    // A constant nobody executes reproduces the exact defect check 9 exists to
    // close. This is the resolved half: the declared set and the set that
    // really renders must be the same set.
    expect(rendered).toEqual([...INSTRUMENTED_QUEUES].sort());
  });

  it('names three queues, and the floor the gate enforces is not vacuous', () => {
    expect(INSTRUMENTED_QUEUES.length).toBeGreaterThanOrEqual(3);
    expect([...INSTRUMENTED_QUEUES].sort()).toEqual(['exports', 'imports', 'notifications-email']);
  });

  it('names no dead-letter mechanism anywhere in what it publishes (DNC-06)', async () => {
    const exposition = await registry.metrics();
    expect(exposition.toLowerCase()).not.toContain('dlq');
    expect(exposition.toLowerCase()).not.toContain('dead letter');
    expect(exposition.toLowerCase()).not.toContain('dead_letter');
  });
});
