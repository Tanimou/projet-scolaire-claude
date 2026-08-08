# ADR-028 — Queue-owned metrics have exactly one collector, and `registry.metrics()` may now do I/O

- **Status**: accepted
- **Date**: 2026-08-07
- **Slice**: `S-E02-17` (V3-E02, finding `PF-56`, queue third)
- **Supersedes / narrows**: nothing. Adds a rule `ADR-025` and `ADR-027` do not cover — they are
  about gate *stages*, this is about what a Prometheus registry is allowed to do when it is rendered.
- **Amended**: `S-E02-18` (V3-E02, findings `PF-104`/`PF-106`) — see the amendment section at the end.
- **Numbering**: this file holds `ADR-028`. `docs/daily-improvement-v3/architecture-impact.md` §4 *also*
  reserved `ADR-028`, for a V3-E04 audit decision that had not been written when this one was
  (`PF-110`). The collision is reconciled **in that table**, not here: the reserved decisions renumber
  from `ADR-032`, and this file is deliberately **not** renumbered — a shipped ADR keeps its number, so
  every reference to it stays true. §4 also now carries the missing rule about which register wins.

## Context

Before this slice, every metric in this repository was one of two shapes:

- **observation-driven** — the API's HTTP middleware increments a counter for a request it is
  already handling (`apps/api/src/modules/metrics/metrics.middleware.ts`);
- **process-driven** — `collectDefaultMetrics` reads this process's own memory, GC and event-loop lag.

Both are free. Neither performs I/O, and neither can fail in a way that matters.

Queue depth is different, and the difference is what needed a decision. Depth is a property of the
**queue** — a shared Redis data structure — not of the process. It cannot be observed as a
side effect of work this process is doing, and it cannot be derived from this process's own state.
The only way to know it is to ask Redis, at the moment somebody asks for it.

Two things follow, and they are the two decisions recorded here.

## Decision 1 — a queue-owned series has exactly one publisher, and it is the worker

Both `apps/api` (producer) and `apps/worker` (consumer) hold a BullMQ connection to all three queues.
Both *could* publish depth. Publishing from both is `DNC-01` — one number, two sources — arriving at
the observability layer: two series that disagree during a partition, on a dashboard whose entire
value is that an operator believes it.

**Rule, stated generally so the next queue-adjacent metric does not have to re-derive it:**

> A metric that describes a **shared resource** is published by exactly one process, and that process
> is the one whose job the resource is. A metric that describes a **process** is published by that
> process. The API therefore keeps its HTTP series and gains no queue series — not now, and not as a
> "producer-side confirmation" later. If producer-side confirmation is wanted, that is a second
> decision with its own argument, not an omission to be quietly fixed.

Consequence, and it is a real cost: with the worker down, depth stops being reported at all. That is
correct — the number is genuinely unknown — and it is *why* Decision 3 below exists.

A tripwire worth writing down because nobody would look for it: **BullMQ ships its own queue-depth
gauge.** `QueueGetters.recordJobCountsMetric` (`bullmq/classes/queue-getters.js`) emits
`MetricNames.QueueJobsCount`, labelled by queue and state, whenever `queue.opts.telemetry` is set —
and this worker already runs an OpenTelemetry SDK. The day someone wires `telemetry` into the BullMQ
options, one number has two sources through a door this ADR would otherwise not mention.
`QueueDepthCollector` logs a warning when it sees `opts.telemetry` set.

## Decision 2 — `registry.metrics()` may now perform I/O, and every collector inherits a contract

Depth is read in a prom-client `collect()` callback. That changes what "rendering the exposition"
means **for every future caller**, including a gate script, so the contract is written for collectors
in general and not as a note about this one:

1. **A collector is time-bounded.** The bound is a named constant, the timer is `unref()`'d (or the
   worker will not exit on `SIGTERM` and jest reports an open handle), and it is cleared on the
   winning path (or every scrape leaks a handle).
2. **A collector never rejects.** Measured on `prom-client@15.1.3`: a `collect()` that throws or
   rejects makes `registry.metrics()` **reject**, which
   `apps/worker/src/shared/release/version-server.ts` turns into an **HTTP 500** — the exposition
   reports the worker as broken because one optional number was unavailable. Worse, a `collect()`
   that never settles makes `registry.metrics()` **hang**, and no response is written at all. The
   second shape is the realistic one: `ioredis` defaults to `enableOfflineQueue: true` with a retry
   strategy climbing to a 20 s cap, so a dead Redis makes `getJobCounts()` **wait**, not reject.
3. **A collector degrades to stale or absent, never to zero.** On failure the previous samples are
   left in place; `reset()` is forbidden. Rendering `0 waiting` during a Redis outage presents a
   number the system does not know as one it does, and zero is a value an operator will act on.
4. **A collector's inability to run is visible.** This is the resolution of a genuine tension:
   `DNC-08` says a check that cannot run must fail, and rule 2 says this collector must swallow its
   errors. Both hold, because a collector is a **measurement**, not a check. It may degrade — but the
   degradation is published as `pilotage_queue_depth_collection_failures_total{queue}`, zero-initialised
   for every instrumented queue so it is honest and present with no Redis at all. A silent degradation
   would render a Redis outage as a healthy system, which is `DNC-06` by omission. The **gate** over
   all of this stays a hard fail.
5. **A collector opens nothing at import time.** `scripts/observability-check.js` requires the
   worker's registry — and, since this slice, the queue-metrics module — **into its own process**,
   renders it, and must then exit. A transitive Redis client in that import graph is an open handle
   that makes stage 9 print `PASS` and hang, which is strictly worse than red.

Rule 5 is why `apps/worker/src/shared/observability/queue-metrics.ts` imports `prom-client` and
nothing else, and why the BullMQ queues reach it through a setter (`registerQueueDepthSources`)
bound at Nest boot by `QueueDepthCollector` rather than through an import. Unbound — the state in the
gate and in every unit test — the collector is a no-op that produces no sample, never a connection and
never a throw. This is the same reason `RouteLabelSource` exists in the API registry: an evaluation
that cannot be driven with synthetic objects can only demonstrate that today's repository is healthy.

## Decision 3 — no dead-letter series, because there is no dead-letter queue

BullMQ has none. A job that exhausts `attempts` stays in the `failed` set. A series named for a
dead-letter mechanism would be a metric describing something this system does not have — `DNC-06`, the
"UI exists therefore feature delivered" move relocated to the observability layer.

Recorded **here** and not only in a code comment, because the pressure to add it will arrive as a
dashboard request, not as a code review. What is published instead is what exists: the `failed` set
size, plus `pilotage_queue_jobs_total{outcome}` splitting a **retryable** failure from a **terminal**
one — which is the operational question such a panel is actually asked.

The retryable/terminal predicate mirrors BullMQ's own (`Job.shouldRetryJob`), not a paraphrase of it:
`attemptsMade >= opts.attempts` **or** `job.discard()` **or** `UnrecoverableError`. Arithmetic alone
would report "retryable" for a discarded job and for an unrecoverable error — a promised retry that
will never happen, inside the metric written to avoid exactly that.

## Consequences

- `registry.metrics()` on the worker is potentially I/O-touching. Any future collector inherits the
  five rules above; a collector that cannot meet them does not belong in a `collect()` callback.
- Labels stay a build-time closed set (queue, job, state, outcome). `/metrics` is unauthenticated by
  construction, and a job id is unbounded cardinality *and* one join from a tenant. The job-name label
  is resolved through a **whitelist** (`jobLabel`), not a sanitiser: a cuid is lowercase alphanumeric
  and survives any character-class filter. An un-listed name folds to `<other>` — a loss of detail,
  never a leak.
- Depth is per queue and deliberately **not** per tenant. A per-tenant breakdown on an unauthenticated
  surface is the leak.
- Approximate cardinality added: ~312 worker series. The histogram is what scales — each new
  `NotificationKind` costs ~12 series.
- **Still not decided, and deliberately so**: alert rules and SLO thresholds. What "too deep" or "too
  slow" means is a product decision. `PF-56` stays open for it, and the dashboard panels carry no
  `thresholds.steps`, no `alert` block and no axis `max` — a threshold asserted in colour is still a
  threshold, and the more persuasive of the two.

## Alternatives considered

- **Publish depth from both processes.** Rejected: `DNC-01`, and a graph that disagrees with itself
  teaches operators to distrust the graph.
- **Poll depth on a timer and cache it.** Rejected for this slice: it moves the failure from the
  scrape path into a background timer that must then be owned, supervised and shut down, and it makes
  every sample stale by up to the poll interval with no way for the reader to tell. The scrape-path
  collector, bounded and observable, is the smaller mechanism. Revisit if the deadline is ever hit in
  practice — `pilotage_queue_depth_collection_failures_total` is the evidence that would justify it.
- **A shared `WorkerHost` base class timing `process()`** instead of three `@OnWorkerEvent` pairs.
  Rejected on measurement: BullMQ decides retryable-vs-terminal *inside* `Job.moveToFailed`, after
  `process()` has thrown, so a wrapper would have to re-implement the predicate; and
  `Worker.handleFailed` returns early for `DelayedError`/`WaitingError`/rate-limiting **before**
  emitting `failed`, so a wrapper would count a rate-limited job as a failure. The event handlers are
  one delegating line each, with all logic in one module — the "one number, one implementation"
  property the base class was wanted for, without the wrong numbers.
- **Unify the two queue-name constant blocks into `packages/contracts`.** Rejected: it would make the
  drift guard tautological (one source cannot disagree with itself), it would not even fix the real
  invariant (which is `registerQueue`, not the constant), and it would drag the api and web runtimes
  into a worker-only concern (`PF-80`).

## Amendment (S-E02-18) — `stalled` is its own family, and the collector's binding is observable

Two additions, recorded here rather than in a new ADR because a reader arriving at "why isn't
`stalled` an `outcome`?" arrives at Decision 3, and Decision 3 currently answers only the DLQ
question. (A new number would also have repeated `PF-110` inside the PR that reconciles it.)

**`pilotage_queue_stalled_total{queue}` is a separate family, not a fourth `outcome`.** Measured
against the installed `bullmq@5.76.8`: `dist/cjs/classes/worker.js:659` is the only
`emit('failed', job, err)` and is reached only from `handleFailed`, i.e. only when the processor
threw *in this process*; `worker.js:908` emits `('stalled', jobId, 'active')` for every id
`moveStalledJobsToWait` returns; and the Lua script `moveStalledJobsToWait-8` lines 154-162 moves a
job past `maxStalledCount` into the **failed set** with reason *"job stalled more than allowable
limit"* while still emitting only `stalled`. So an OOM-killed or SIGKILLed worker leaves the outcome
counter flat at zero exactly when the worker is broken. It is not folded into `JOB_OUTCOMES` for two
reasons the event itself imposes: it carries a **bare jobId with no job name**, so a `job` label
would be `<other>` for 100 % of points; and it **does not distinguish** "moved back to `wait`" from
"moved to `failed`", so calling it an outcome would assert a terminality the event cannot support.
It follows that the series is neither a subset nor a superset of `pilotage_queue_jobs_total` — below
`maxStalledCount` the job is requeued and counted again later, above it the outcome counter never
sees it — and the two must therefore never be added on a panel. The counter is deliberately **not**
zero-seeded, so "no data" reads as "never happened". `observeJobStalled(queue)` takes no job id at
all: G-TENANT is then structural rather than merely untaken.

**`pilotage_queue_depth_sources_bound{queue}` makes a PARTIAL binding observable.** This is
Decision 1's second sentence one dimension over: depth is a property of the queue, but *which sources
this process bound* is a property of the process, so it is published by the process that binds them.
`QueueDepthCollector.onModuleInit` silently drops a queue failing its `typeof
queue.getJobCounts === 'function'` filter, and the zero-seeded failure counter then renders that
queue as perfectly healthy. The gauge is written from **exactly one place** —
`registerQueueDepthSources`, already the single binding point and already the function that knows the
shortfall — and it resets to zero for every instrumented queue before setting the bound ones, so it
replaces rather than stacks. A **counter** incremented once at boot was rejected: it is flat forever
after, so `rate(...[5m])` returns zero within five minutes and the shortfall becomes invisible again
(`PF-107`'s own shape), and it would conflate "never bound" with "bound and failing". Because it is a
gauge, it must never be aggregated with `sum()` on a dashboard — check 10 of
`scripts/observability-check.js` now enforces that class, for the reason recorded in `PF-108`: a gauge
of a shared resource is not additive across replicas, a counter `rate()` is.
