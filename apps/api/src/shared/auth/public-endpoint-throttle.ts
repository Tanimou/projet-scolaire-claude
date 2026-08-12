import { createHash } from 'node:crypto';

/**
 * S-E05-7 — the in-process, fixed-window admission bound for the ONE public,
 * unauthenticated mutation in the product: `POST /auth/register-parent`.
 *
 * This file is pure: no I/O, no timers, no Nest imports, no ambient
 * configuration read of any kind. It is a counter and a clock. The HTTP shape
 * (status, copy, log line) lives in `register-throttle.guard.ts`; the decision
 * lives here, so both halves stay unit-testable in isolation.
 *
 * WHY A THIRD RATE LIMITER, AND WHY IT LOOKS NOTHING LIKE THE OTHER TWO
 * --------------------------------------------------------------------
 * Two limiters already exist in `apps/api`, and neither is copyable here. Both
 * count **rows already in the database**:
 *   • `modules/child-claims/child-claims.service.ts:43-45,119-131` — per tenant +
 *     guardian, 5 per 10 min, no ambient configuration, `HttpException` + 429.
 *   • `modules/messaging/messaging.service.ts:51-70,483-495` — per tenant +
 *     sender, and tunable from the process configuration.
 *
 * Three measured differences make the row-counting shape a category error at
 * this address, and they are the whole argument for the new shape:
 *
 *  1. **There is no row to count.** Both existing limiters throttle an
 *     AUTHENTICATED actor whose previous attempts each left a durable row. A
 *     refused registration leaves nothing: this endpoint must refuse BEFORE its
 *     first side effect, and its side effects are Keycloak's, not Postgres'.
 *  2. **There is no tenant and no actor yet.** Tenancy is resolved at
 *     `register.controller.ts:358`, deep inside the handler this bound exists to
 *     keep the caller out of. A tenant-scoped `WHERE` cannot be written by a
 *     guard that runs before authentication, before validation, and before the
 *     tenant exists.
 *  3. **A database write per refused anonymous request rebuilds the very
 *     amplification this file removes**, one subsystem over.
 *
 * The configuration divergence is deliberate too, and is stated rather than left
 * to read as inconsistency: `messaging` may be relaxed from the process
 * configuration because it is an anti-spam bound on an authenticated path, where
 * a mis-set value costs noise. Here the same knob would be the only thing
 * standing between an anonymous caller and the Keycloak admin API, so this file
 * reads nothing from the environment at all (DNC-10, following the precedent
 * written down at `shared/audit/client-hints.ts:82-86`). There is no key to
 * override, no off switch, and no second source of truth for any limit below.
 *
 * See `docs/adr/ADR-038-in-process-bounds-on-public-endpoints.md` for the
 * decision record, including the single-process invariant (D2) and the
 * availability trade (D4) restated in the guard.
 *
 * WHAT IS BEING BOUNDED — FOUR ROUND-TRIPS, NOT THREE
 * --------------------------------------------------
 * Counted at `register.controller.ts`, one anonymous request can drive:
 * `findUserByEmail` (:187), `createUser` (:241), `setUserPassword` (:250), and on
 * a rolled-back transaction the compensating `deleteUser` (:431). The controller
 * docblock at :142-151 says three; it predates the compensation being counted.
 * Four is the number this file bounds.
 *
 * THE WINDOW IS EPOCH-ALIGNED AND THE SWEEP IS A WHOLE-MAP CLEAR
 * -------------------------------------------------------------
 * `windowIndex = floor(now / windowMs)`. When the index changes, EVERY counter
 * and the whole key map are dropped in one O(1) operation, and that happens on
 * the first line of `admit` — before the capacity test, never after it.
 *
 * That ordering is load-bearing and is the one thing a per-key lazy expiry gets
 * wrong: with per-key expiry the map only ever shrinks for keys that are touched
 * again, so a single busy window leaves the map permanently full of stale
 * entries, the capacity test trips, and a fail-closed limiter turns the product's
 * only self-service signup path off forever with no attacker involved. Here an
 * idle window empties the map by construction.
 *
 * Accepted property of a fixed window, named so the next reviewer does not file
 * it as a defect: a caller straddling a rollover can land up to `2 × globalMax`
 * admissions inside one `windowMs`-wide span. A sliding window is deliberately
 * not built here — it would buy a factor of two against an attacker who is
 * already bounded, at the cost of per-key timestamp lists, i.e. the unbounded
 * memory this design refuses.
 *
 * COUNTERS COUNT ADMISSIONS, NOT ATTEMPTS
 * --------------------------------------
 * A refused request increments nothing. If refusals fed the global counter, an
 * attacker hammering ONE address would exhaust the endpoint-wide ceiling and lock
 * out every legitimate registrant — a per-identity bound converted into a global
 * outage. Tier 2 is therefore evaluated FIRST and a tier-2 refusal inserts no
 * identity key at all, which is also what keeps the key map bounded below.
 */

/**
 * One minute. The unit the ceiling below is sized in, and small enough that a
 * refused legitimate registrant waits well under the "quelques minutes" the
 * refusal copy promises — the copy over-states the wait on purpose, in the
 * direction that cannot disappoint.
 */
export const REGISTRATION_WINDOW_MS = 60_000;

/**
 * Tier 1 — admissions per submitted address per window.
 *
 * Five, matching `child-claims.service.ts:44` rather than inventing a third
 * number. Sized against a REAL user, not against an attacker: guards run before
 * validation pipes, so every 400 (weak password, unchecked CGU) and every 409
 * spends tier-1 budget for that address. A parent who fumbles the password rule
 * three times and then succeeds must still get an account; three fumbles plus one
 * success is four, and four is under five.
 *
 * THIS KEY IS CHOSEN BY THE CALLER AND IS THEREFORE ROTATABLE. Tier 1 is an
 * enumeration-RATE bound, not a security bound: an attacker who wants more
 * admissions simply submits a different address. Tier 2 is what actually holds,
 * and the two must never be confused when reasoning about this file.
 */
export const REGISTRATION_TIER1_MAX = 5;

/**
 * Tier 2 — total admissions endpoint-wide per window, and the only bound that
 * genuinely caps the Keycloak admin round-trips.
 *
 * Source-blind by necessity, not by oversight: this endpoint has exactly one
 * caller repo-wide and it is a Next.js server action issuing a bare server-side
 * `fetch` (`register.controller.ts:195-214`, `shared/audit/client-hints.ts:26-35`),
 * so the transport address is the web container's single egress address, shared
 * by every registrant on earth. Keying on it would put every legitimate parent in
 * one bucket, which is `PF-31` expressed as a limiter. Nothing in this file reads
 * a request address or a forwarding header — there is no such input here at all.
 *
 * Sized against a written scenario rather than a round number: a school
 * onboarding evening of 200 parents in an hour averages 3.3 admissions per
 * minute, so 30 leaves roughly nine times the average as burst headroom, and sits
 * an order of magnitude under the 120 r/m `api_zone` envelope nginx already
 * applies in production (`infra/nginx/conf.d/pilotage.conf:25,104` — note the
 * strict 10 r/m `auth_zone` at :142 matches the web PAGE routes only and has
 * never covered `/api/v1/auth/*`, and on the local `--profile app` topology there
 * is no nginx at all).
 */
export const REGISTRATION_TIER2_MAX = 30;

/**
 * The key-map capacity, DERIVED so that saturation is unreachable by
 * construction — the arithmetic, not a round number:
 *
 *   • a key is inserted only on an ADMISSION (a refusal inserts nothing);
 *   • tier 2 is evaluated first, so at most `REGISTRATION_TIER2_MAX` admissions
 *     occur per window, hence at most that many distinct keys;
 *   • the whole map is cleared on window rollover, before any capacity test.
 *
 * So the live size is bounded by `REGISTRATION_TIER2_MAX`, and doubling it leaves
 * the capacity STRICTLY greater than any reachable size. It exists only as a
 * fail-closed floor under a future edit that breaks one of the three premises:
 * saturation refuses, and never evicts. Eviction would be the actual defect —
 * it would let an attacker flush their own counter by rotating addresses.
 */
export const REGISTRATION_MAX_KEYS = REGISTRATION_TIER2_MAX * 2;

/** Which bound refused. Internal to the API; never distinguishable to a caller. */
export type ThrottleRefusalTier = 'identity' | 'global' | 'saturated';

export interface ThrottleDecision {
  readonly admitted: boolean;
  /** `null` when admitted. */
  readonly tier: ThrottleRefusalTier | null;
  /**
   * True only on the TRANSITION into refusing, once per tier (and once per key
   * for tier 1) per window.
   *
   * A refusal is cheap by design, so a flood produces refusals at line rate; a
   * log line per refused request would be a synchronous, unbounded write per
   * request — the same defect class as an audit row per refusal, in a different
   * sink. The guard logs only when this flag is set.
   */
  readonly firstRefusalOfWindow: boolean;
}

const ADMITTED: ThrottleDecision = Object.freeze({
  admitted: true,
  tier: null,
  firstRefusalOfWindow: false,
});

interface IdentityBucket {
  admissions: number;
  refusalLogged: boolean;
}

/**
 * Hashes a submitted address into the tier-1 key, or answers `null` when there is
 * no usable address.
 *
 * A DIGEST, never the address: this map would otherwise hold plaintext registrant
 * addresses in the heap of a platform whose GUARDRAILS §1 calls RGPD-level
 * governance non-negotiable, readable by anyone who can take a heap snapshot and
 * by every crash dump.
 *
 * WHAT THE DIGEST DOES *NOT* BUY — stated because the sentence above, left alone,
 * would overstate it. The hash is UNSALTED, and an email address is a low-entropy
 * identifier: anyone holding both a dump of this map and a candidate list can
 * confirm membership by hashing the candidates. So this is **not** anonymisation
 * and must never be cited as such — it is defence in depth against casual heap
 * inspection and accidental disclosure (a crash dump shipped to a log sink), and
 * it removes the address from the one place it has no reason to exist. A salt
 * would defeat the confirmation attack, but a PROCESS-LOCAL salt is what this
 * design would force (there is no configuration read here by DNC-10, and no store
 * to persist one in), and a per-process salt buys nothing against an attacker who
 * already has that process's heap — which is the only threat in scope. Recorded
 * rather than papered over; the honest claim is "no plaintext at rest in memory",
 * not "unlinkable".
 *
 * Trimmed as well as lowercased, where `register.controller.ts:183` only
 * lowercases. The divergence is in the SAFE direction — `" a@b.fr "` and
 * `"a@b.fr"` share one bucket here while the handler would treat them as one
 * address anyway after validation — and it is written down so nobody "aligns"
 * the two by removing the trim, which would hand an attacker a free key per
 * whitespace variant.
 */
export function registrationIdentityKey(email: unknown): string | null {
  if (typeof email !== 'string') return null;
  const normalised = email.trim().toLowerCase();
  if (normalised.length === 0) return null;
  return createHash('sha256').update(normalised, 'utf8').digest('hex');
}

/** How much of the digest is safe to put in a log line. */
export const THROTTLE_LOG_KEY_PREFIX_LENGTH = 12;

/**
 * A two-tier fixed-window admission counter. One instance = one endpoint.
 *
 * The clock is injected (defaulting to `Date.now`) and `admit` also accepts an
 * explicit `now`, so every temporal property is provable without real timers and
 * without `jest.useFakeTimers` — a limiter whose window expiry can only be tested
 * by waiting is a limiter whose window expiry is not tested.
 */
export class PublicEndpointFixedWindowThrottle {
  /** `NaN` never equals itself, so the first `admit` always opens a window. */
  private windowIndex = Number.NaN;
  private globalAdmissions = 0;
  private globalRefusalLogged = false;
  private saturationRefusalLogged = false;
  private readonly identities = new Map<string, IdentityBucket>();

  constructor(
    private readonly windowMs: number,
    private readonly identityMax: number,
    private readonly globalMax: number,
    private readonly maxKeys: number,
    // Wrapped rather than passed as the bare `Date.now` reference, deliberately:
    // a bare reference is captured at construction, so a spec that stubs the
    // clock on the singleton would be stubbing a function this instance no longer
    // consults — green for the wrong reason.
    private readonly clock: () => number = () => Date.now(),
  ) {}

  /**
   * @param key a digest from `registrationIdentityKey`, or `null` when the
   *            request carries no usable address. A keyless request is admitted
   *            (a limiter that 500s or refuses on a malformed body is worse than
   *            no limiter) and still counts against tier 2 — otherwise an empty
   *            body would be free traffic — but inserts NO key, so it can never
   *            be a route to saturation.
   */
  admit(key: string | null, now: number = this.clock()): ThrottleDecision {
    // The sweep, FIRST — see the file docblock. Everything below reasons about a
    // map that contains only this window's keys.
    this.rollWindow(now);

    // Tier 2 before tier 1, and before any key is created.
    if (this.globalAdmissions >= this.globalMax) {
      const first = !this.globalRefusalLogged;
      this.globalRefusalLogged = true;
      return { admitted: false, tier: 'global', firstRefusalOfWindow: first };
    }

    let bucket: IdentityBucket | undefined;
    if (key !== null) {
      bucket = this.identities.get(key);

      // Fail closed, never evict. Unreachable while the three premises in
      // `REGISTRATION_MAX_KEYS` hold; present so that breaking one of them fails
      // safe instead of failing open.
      if (bucket === undefined && this.identities.size >= this.maxKeys) {
        const first = !this.saturationRefusalLogged;
        this.saturationRefusalLogged = true;
        return { admitted: false, tier: 'saturated', firstRefusalOfWindow: first };
      }

      if (bucket !== undefined && bucket.admissions >= this.identityMax) {
        const first = !bucket.refusalLogged;
        bucket.refusalLogged = true;
        return { admitted: false, tier: 'identity', firstRefusalOfWindow: first };
      }
    }

    this.globalAdmissions += 1;
    if (key !== null) {
      if (bucket === undefined) {
        bucket = { admissions: 0, refusalLogged: false };
        this.identities.set(key, bucket);
      }
      bucket.admissions += 1;
    }
    return ADMITTED;
  }

  /** Live key count. Exposed so the memory bound is assertable, not assumed. */
  trackedKeyCount(): number {
    return this.identities.size;
  }

  /**
   * Test-only reset, mirroring `resetAuditClientHintsPolicy`
   * (`shared/audit/client-hints.ts:190-193`). Module-level state means one suite
   * would otherwise inherit another's counters and pass for the wrong reason.
   */
  reset(): void {
    this.windowIndex = Number.NaN;
    this.globalAdmissions = 0;
    this.globalRefusalLogged = false;
    this.saturationRefusalLogged = false;
    this.identities.clear();
  }

  private rollWindow(now: number): void {
    const index = Math.floor(now / this.windowMs);
    if (index === this.windowIndex) return;
    this.windowIndex = index;
    this.globalAdmissions = 0;
    this.globalRefusalLogged = false;
    this.saturationRefusalLogged = false;
    this.identities.clear();
  }
}

/**
 * THE instance guarding `POST /auth/register-parent`.
 *
 * Module-level and therefore per-process. That is the whole design (see
 * ADR-038 D2): the counters are volatile, a restart clears them, and the day a
 * second API replica is declared the real ceiling silently becomes N × the
 * constant above with no test going red. `infra/docker-compose*.yml` declares no
 * `replicas` today, which is why this holds — an invariant recorded in an ADR
 * where an infra editor will meet it, not only here.
 */
export const registrationThrottle = new PublicEndpointFixedWindowThrottle(
  REGISTRATION_WINDOW_MS,
  REGISTRATION_TIER1_MAX,
  REGISTRATION_TIER2_MAX,
  REGISTRATION_MAX_KEYS,
);

/** Test-only reset for the singleton above. */
export function resetPublicEndpointThrottle(): void {
  registrationThrottle.reset();
}
