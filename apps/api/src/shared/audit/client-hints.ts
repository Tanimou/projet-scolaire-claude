import { createHash, timingSafeEqual } from 'node:crypto';

import { sanitiseInetOrNull, truncateUserAgent } from './provenance';

/**
 * S-E04-3 — THE one extraction seam: the only file in `apps/api` that reads a
 * request header or a socket address for the purpose of audit provenance.
 *
 * WHY IT IS NOT IN `provenance.ts`
 * --------------------------------
 * `provenance.ts` promises, in its own docblock and by test, that it reads no
 * header, no `req.ip`, no `process.env`. That promise is structural, not
 * stylistic (`ADR-036` D5): if the derivation function had a request in scope at
 * the one place every audit write funnels through, the next author would wire
 * `req.ip` in, and the hop-count decision would silently become a per-call-site
 * decision again. So the extraction lives HERE, the derivation stays pure there,
 * and `shared/quality/audit-provenance-gate.spec.ts` asserts both halves.
 *
 * THE RULE, IN ORDER — AND IT IS THE WHOLE SECURITY ARGUMENT
 * ---------------------------------------------------------
 * 1. **A forwarder is claiming to be in the path** — the request carries any of
 *    `x-pilotage-client-ip`, `x-pilotage-client-user-agent`,
 *    `x-pilotage-forward-token`. Then, and only then: if a forward token is
 *    configured on the API **and** the presented token matches it under a
 *    constant-time comparison, take the FORWARDED ip/ua. Otherwise **both**
 *    fields are `null`.
 *
 *    On this branch we NEVER fall back to `req.ip`. `req.ip` here is the web
 *    container — one constant address shared by every actor forever — and
 *    recording it is exactly `PF-31`, the defect this slice exists to remove.
 *    `x-real-ip` is refused on this branch for the same reason and is named
 *    separately because it is the subtler trap: nginx sets it on **every**
 *    request including the production web→api hairpin, so a wrong token plus an
 *    `x-real-ip` fallback would store the proxy's address through the very seam
 *    written to prevent that (`ADR-036` D4 — « no value is ever the proxy's »).
 *
 * 2. **Nobody is claiming anything** — no pilotage header at all. The address is
 *    `req.ip` as Express resolved it under the PINNED hop count
 *    (`shared/config/trust-proxy.ts`), and the user-agent is the request's own.
 *    A caller-injected `X-Forwarded-For` entry sits beyond hop `N` and Express
 *    discards it; that is the property `ADR-036` D1 refused blanket trust for
 *    lacking.
 *
 *    …with one correction Express cannot express. A numeric `trust proxy: N`
 *    **pads**: given a chain SHORTER than `N`, `proxyaddr` runs out of trusted
 *    hops and returns the leftmost entry — which, for a caller who reached the
 *    edge directly and sent a one-entry `X-Forwarded-For`, is a value they chose.
 *    `ADR-036` D4 already rules on this (« une chaîne plus courte que N » ⇒
 *    `null`), so the chain depth is counted here and a short chain yields a null
 *    address. The forged-beyond-`N` case and the forged-short-chain case are
 *    different failures; only the first is handled by Express.
 *
 * 3. Everything leaves through `sanitiseInetOrNull` / `truncateUserAgent`, so a
 *    non-`inet` value becomes `null` before it can reach the `@db.Inet` column —
 *    a failed cast must never roll back the transaction it was auditing
 *    (`S-E06-6`'s reason, inherited).
 *
 * WHY THE FORWARD TOKEN IS NOT ITSELF A DNC-10 BYPASS
 * --------------------------------------------------
 * An absent or wrong token can only make provenance **more null, never less**.
 * It relaxes no check, grants no access, resolves no tenant, derives no role,
 * and cannot cause a value to be recorded that would otherwise be blank. That
 * asymmetry is exactly what separates it from the blanket trust `ADR-036` D1
 * refuses in writing, which lets any caller **choose** the recorded value.
 *
 * The residual, stated rather than hidden — twice, because it has two halves:
 *  • **Outsider.** A caller can send a garbage token to force **its own** row to
 *    `null`. That is a downgrade to honest-unknown, the safe direction, and it
 *    is visible to an auditor as an absence rather than as evidence.
 *  • **Insider.** Anyone who can read the web container's environment can mint
 *    the token and forge an arbitrary provenance — the property D1 refused, now
 *    gated on secret custody rather than absent. The asymmetry above is true for
 *    an outsider and NOT true for an insider with environment access. Both
 *    halves are recorded in `ADR-036` D9; neither is a reason to prefer the
 *    blanket form, which is forgeable by *everyone*.
 *
 * This is not authentication and must not be named or used as such: it never
 * reaches a guard, a strategy or a tenant lookup (asserted structurally by
 * `shared/quality/audit-provenance-gate.spec.ts`), and a request bearing a valid
 * token and no valid `Bearer` is still 401.
 *
 * DNC-10 — this file reads NO `process.env` at all. The hop count and the token
 * are handed to it once at boot by `main.ts` (`configureAuditClientHints`), so
 * there is no key to override, no `SKIP_*`, no `NODE_ENV` branch, and no second
 * source of truth for `N`.
 */

/** The three headers a trusted forwarder sets. Hyphens, never underscores. */
export const PILOTAGE_CLIENT_IP_HEADER = 'x-pilotage-client-ip';
export const PILOTAGE_CLIENT_USER_AGENT_HEADER = 'x-pilotage-client-user-agent';
export const PILOTAGE_FORWARD_TOKEN_HEADER = 'x-pilotage-forward-token';

/**
 * The three names above are load-bearing in their SHAPE, not only in their
 * spelling: nginx drops headers containing underscores by default
 * (`underscores_in_headers off`), so `x_pilotage_client_ip` would be silently
 * stripped at `infra/nginx/conf.d/pilotage.conf` and every production row would
 * blank with no error anywhere. `location /api/` sets only `Host` / `X-Real-IP`
 * / `X-Forwarded-For` / `X-Forwarded-Proto` and passes all other client headers
 * through unchanged, so `infra/nginx` needs no edit for these to arrive.
 */
export const PILOTAGE_FORWARD_HEADERS = [
  PILOTAGE_CLIENT_IP_HEADER,
  PILOTAGE_CLIENT_USER_AGENT_HEADER,
  PILOTAGE_FORWARD_TOKEN_HEADER,
] as const;

/** The environment key carrying the shared forward token. Optional, by decision. */
export const AUDIT_FORWARD_TOKEN_ENV = 'AUDIT_FORWARD_TOKEN';

/**
 * The already-extracted, already-sanitised pair `deriveAuditProvenance` accepts
 * (`ADR-036` D5). App-local on purpose: it describes a transport detail on the
 * api side of one HTTP hop and is never serialised as a body shape, so it does
 * not belong in `packages/contracts` — whose two consumers would disagree about
 * direction (the web side produces headers, this side consumes a request).
 */
export interface AuditClientHints {
  ipAddress: string | null;
  userAgent: string | null;
}

/**
 * The explicit "no trustworthy provenance" value.
 *
 * Exported and named so the absence is *representable* rather than expressed as
 * `undefined`: `PROGRESS.md`'s secondary observation 1 records that a silently
 * omitted hint reads identically to a captured-then-lost one. A call site that
 * genuinely has no request in scope passes this and says so.
 */
export const NO_CLIENT_HINTS: AuditClientHints = Object.freeze({
  ipAddress: null,
  userAgent: null,
});

/** The minimal request shape this seam needs — structural, so no Express import. */
export interface ClientHintsRequest {
  ip?: string;
  headers?: Record<string, string | string[] | undefined>;
}

/**
 * The boot-time policy: the pinned hop count and the digest of the configured
 * forward token (or `null` when none is configured).
 *
 * The token is stored as a **digest**, never as the raw string: it is then never
 * a value that can be echoed into a message, a span attribute or a log line by
 * accident, and the comparison below is length-invariant by construction.
 */
export interface AuditClientHintsPolicy {
  readonly trustedHops: number;
  readonly forwardTokenDigest: Buffer | null;
}

/**
 * Unconfigured until `main.ts` says otherwise, and unconfigured is FAIL-SAFE:
 * every extraction returns `NO_CLIENT_HINTS`. A forgotten `configureAuditClientHints`
 * therefore blanks provenance (honest-unknown) rather than inventing one, which
 * is the direction `ADR-036` D4 requires.
 */
let policy: AuditClientHintsPolicy | null = null;

/**
 * Called exactly once, from `main.ts`, with the hop count `applyTrustProxy`
 * just applied and the raw forward token.
 *
 * The token is OPTIONAL by decision (`ADR-036` D9): unlike the hop count, whose
 * absence is *silently wrong*, an absent token is *fail-safe* — provenance goes
 * null and the UI says so. Making it required would mean an operator who has not
 * yet distributed the secret cannot boot at all, which is precisely the pressure
 * that produced `PF-54`'s `?? 'admin'`.
 *
 * @returns whether a forward token is configured — so boot can log the fact
 *          (never the value). A rotation that updates the api before the web is
 *          an all-null window in the safe direction, and its whole danger is
 *          that it is invisible.
 */
export function configureAuditClientHints(input: {
  trustedHops: number;
  forwardToken?: string;
}): boolean {
  const token = typeof input.forwardToken === 'string' ? input.forwardToken.trim() : '';
  policy = {
    trustedHops: input.trustedHops,
    forwardTokenDigest: token.length === 0 ? null : digestOf(token),
  };
  return policy.forwardTokenDigest !== null;
}

/** Test-only reset so a suite cannot inherit another suite's policy. */
export function resetAuditClientHintsPolicy(): void {
  policy = null;
}

/** The configured policy, or the fail-safe "trust nothing, forward nothing" one. */
function currentPolicy(): AuditClientHintsPolicy {
  return policy ?? { trustedHops: 0, forwardTokenDigest: null };
}

function digestOf(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

/**
 * Constant-time comparison that CANNOT throw.
 *
 * `timingSafeEqual` throws `RangeError` on unequal lengths, so comparing raw
 * tokens would turn a one-character typo in the web container's environment into
 * an unhandled exception on every audited write — the audit-hygiene feature
 * becoming an availability failure. Hashing both sides first makes every
 * comparison 32 bytes against 32 bytes: the length is no longer an input, so
 * neither the throw nor the length oracle exists.
 */
function tokenMatches(expected: Buffer, presented: string): boolean {
  return timingSafeEqual(expected, digestOf(presented));
}

/**
 * Reads one header. A repeated header (array) is refused rather than
 * first-wins: a duplicated `x-pilotage-forward-token` is an attempt, not a typo.
 */
function header(req: ClientHintsRequest, name: string): string | null {
  const raw = req.headers?.[name];
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw) && raw.length === 1) {
    const only = raw[0];
    return typeof only === 'string' ? only : null;
  }
  return null;
}

/**
 * Strips the decorations `isIP` rejects, so a legitimate client is not blanked
 * for its spelling, and so one client is stored under ONE spelling.
 *
 * Handles: `[::1]:443` and `[::1]` (bracketed IPv6, with or without a port),
 * `1.2.3.4:5678` (IPv4 with a port — legal in an `X-Forwarded-For` entry), and
 * `::ffff:127.0.0.1` (IPv4-mapped IPv6, which Express yields on a dual-stack
 * socket). The last one matters for AC-1: without normalisation the same client
 * can be recorded under two spellings, and "two different `ip_address` values"
 * would be satisfiable by two FORMATS of one address.
 *
 * RFC 7239 obfuscated identifiers (`unknown`, `_hidden`) are left untouched and
 * are refused downstream by `sanitiseInetOrNull` — they are not addresses.
 */
export function normaliseClientAddress(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  let candidate = raw.trim();
  if (candidate.length === 0) return null;

  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(candidate);
  if (bracketed?.[1]) {
    candidate = bracketed[1];
  } else if (/^\d{1,3}(?:\.\d{1,3}){3}:\d{1,5}$/.test(candidate)) {
    candidate = candidate.slice(0, candidate.lastIndexOf(':'));
  }

  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(candidate);
  if (mapped?.[1]) candidate = mapped[1];

  return candidate;
}

/** The `X-Forwarded-For` chain, leftmost first, empties dropped. */
export function parseForwardedChain(raw: string | null): string[] {
  if (typeof raw !== 'string') return [];
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/** True when any forwarder header is present — i.e. someone claims to relay. */
function forwarderIsClaiming(req: ClientHintsRequest): boolean {
  return PILOTAGE_FORWARD_HEADERS.some((name) => header(req, name) !== null);
}

/**
 * Derives the audit client hints for one request. Never throws.
 *
 * @param req    the incoming request (structurally: `ip` + `headers`)
 * @param active the policy to apply — defaults to the one `main.ts` configured.
 *               Passed explicitly by the supertest harness so a test states the
 *               configuration it is proving rather than inheriting a global.
 */
export function extractAuditClientHints(
  req: ClientHintsRequest,
  active: AuditClientHintsPolicy = currentPolicy(),
): AuditClientHints {
  // ---- Branch 1 — a forwarder is claiming to be in the path -----------------
  if (forwarderIsClaiming(req)) {
    if (active.forwardTokenDigest === null) return NO_CLIENT_HINTS;
    const presented = header(req, PILOTAGE_FORWARD_TOKEN_HEADER);
    if (presented === null) return NO_CLIENT_HINTS;
    if (!tokenMatches(active.forwardTokenDigest, presented)) return NO_CLIENT_HINTS;

    // Trusted forwarder. `req.ip`, `x-real-ip` and `x-forwarded-for` are
    // DELIBERATELY not consulted here — on this branch every one of them is the
    // relay's own address (PF-31).
    return {
      ipAddress: sanitiseInetOrNull(normaliseClientAddress(header(req, PILOTAGE_CLIENT_IP_HEADER))),
      userAgent: truncateUserAgent(header(req, PILOTAGE_CLIENT_USER_AGENT_HEADER)),
    };
  }

  // ---- Branch 2 — nobody claims to relay; Express resolved it under N -------
  const userAgent = truncateUserAgent(header(req, 'user-agent'));

  // `ADR-036` D4: a chain shorter than N means the padding described above
  // happened, so `req.ip` may be an entry the caller chose. Null rather than
  // wrong — the user-agent is still the immediate caller's own header and stays.
  const chain = parseForwardedChain(header(req, 'x-forwarded-for'));
  if (chain.length < active.trustedHops) {
    return { ipAddress: null, userAgent };
  }

  return { ipAddress: sanitiseInetOrNull(normaliseClientAddress(req.ip)), userAgent };
}
