import { createHash } from 'node:crypto';

import {
  type AuditClientHintsPolicy,
  type ClientHintsRequest,
  NO_CLIENT_HINTS,
  PILOTAGE_CLIENT_IP_HEADER,
  PILOTAGE_CLIENT_USER_AGENT_HEADER,
  PILOTAGE_FORWARD_HEADERS,
  PILOTAGE_FORWARD_TOKEN_HEADER,
  configureAuditClientHints,
  extractAuditClientHints,
  normaliseClientAddress,
  parseForwardedChain,
  resetAuditClientHintsPolicy,
} from './client-hints';
import { MAX_USER_AGENT_LENGTH } from './provenance';

/**
 * S-E04-3 — the extraction seam, stated over the property that matters:
 * **no value is ever the proxy's** (AC-3 / AC-8, `ADR-036` D4).
 *
 * Every "must be null" case below asserts the negative as well: `=== null` on
 * its own would pass if the seam returned the relay's address by another name,
 * so each one also asserts the result is NOT the socket peer it was handed.
 * That distinction is the whole slice — a forged provenance is strictly worse
 * than a blank one, because a blank is read as *unknown* and a value is read as
 * *evidence*.
 */

const TOKEN = 'a-forward-token-that-is-long-enough-to-be-realistic';
const SOCKET_PEER = '172.20.0.9'; // the web container, on the docker network
const BROWSER_IP = '92.184.7.14';
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0';

function policy(trustedHops: number, token: string | null = TOKEN): AuditClientHintsPolicy {
  return {
    trustedHops,
    forwardTokenDigest: token === null ? null : createHash('sha256').update(token, 'utf8').digest(),
  };
}

function req(
  headers: Record<string, string | string[] | undefined>,
  ip: string = SOCKET_PEER,
): ClientHintsRequest {
  return { ip, headers };
}

afterEach(() => resetAuditClientHintsPolicy());

/* ------------------------------------------------------------------ *
 * Branch 1 — a forwarder claims to be in the path
 * ------------------------------------------------------------------ */

describe('branch 1 — a forwarder claims to relay', () => {
  it('a VALID token yields the forwarded address and browser, sanitised', () => {
    expect(
      extractAuditClientHints(
        req({
          [PILOTAGE_FORWARD_TOKEN_HEADER]: TOKEN,
          [PILOTAGE_CLIENT_IP_HEADER]: BROWSER_IP,
          [PILOTAGE_CLIENT_USER_AGENT_HEADER]: BROWSER_UA,
        }),
        policy(0),
      ),
    ).toEqual({ ipAddress: BROWSER_IP, userAgent: BROWSER_UA });
  });

  const REJECTED_TOKENS: [string, Record<string, string | string[]>][] = [
    ['a WRONG token', { [PILOTAGE_FORWARD_TOKEN_HEADER]: 'wrong-but-same-length-ish' }],
    ['an EMPTY token', { [PILOTAGE_FORWARD_TOKEN_HEADER]: '' }],
    ['a ONE-CHARACTER token', { [PILOTAGE_FORWARD_TOKEN_HEADER]: 'x' }],
    ['a 1KB token', { [PILOTAGE_FORWARD_TOKEN_HEADER]: 'z'.repeat(1024) }],
    ['NO token at all', {}],
    ['a DUPLICATED token header', { [PILOTAGE_FORWARD_TOKEN_HEADER]: [TOKEN, TOKEN] }],
  ];

  it.each(REJECTED_TOKENS)(
    'AC-9 — %s blanks BOTH fields, and specifically does NOT fall back to the socket peer',
    (_label, tokenHeaders) => {
      const hints = extractAuditClientHints(
        req({
          ...tokenHeaders,
          [PILOTAGE_CLIENT_IP_HEADER]: BROWSER_IP,
          [PILOTAGE_CLIENT_USER_AGENT_HEADER]: BROWSER_UA,
          // The subtler trap, named separately in the docblock: nginx sets
          // `x-real-ip` on EVERY request including the prod web→api hairpin, so a
          // fallback to it would store the relay's address through the very seam
          // written to prevent that.
          'x-real-ip': SOCKET_PEER,
          'x-forwarded-for': SOCKET_PEER,
          'user-agent': 'undici',
        }),
        policy(0),
      );
      expect(hints).toEqual(NO_CLIENT_HINTS);
      expect(hints.ipAddress).not.toBe(SOCKET_PEER);
      expect(hints.userAgent).not.toBe('undici');
    },
  );

  it('AC-9 — an UNCONFIGURED token blanks both, even when the forwarded values are valid', () => {
    const hints = extractAuditClientHints(
      req({
        [PILOTAGE_FORWARD_TOKEN_HEADER]: TOKEN,
        [PILOTAGE_CLIENT_IP_HEADER]: BROWSER_IP,
        [PILOTAGE_CLIENT_USER_AGENT_HEADER]: BROWSER_UA,
      }),
      policy(0, null),
    );
    expect(hints).toEqual(NO_CLIENT_HINTS);
    expect(hints.ipAddress).not.toBe(SOCKET_PEER);
  });

  it.each([...PILOTAGE_FORWARD_HEADERS])(
    'ANY pilotage header alone (%s) puts the request on branch 1 — a partial claim is still a claim',
    (name) => {
      // Otherwise a caller could suppress the token header and slide back to
      // branch 2, where req.ip is recorded — PF-31 through the back door.
      const hints = extractAuditClientHints(req({ [name]: 'anything' }), policy(0));
      expect(hints.ipAddress).toBeNull();
      expect(hints.ipAddress).not.toBe(SOCKET_PEER);
    },
  );

  it('PM-4 / AC-9 — a MARKED request with no address reported is null, not the socket peer', () => {
    // The forwarder always marks itself, even when it could read no client
    // address. Without the marker the request would fall to branch 2 and record
    // the web container — PF-31 shipped by the slice written to remove it.
    const marked = extractAuditClientHints(
      req({ [PILOTAGE_FORWARD_TOKEN_HEADER]: TOKEN, [PILOTAGE_CLIENT_USER_AGENT_HEADER]: BROWSER_UA }),
      policy(0),
    );
    expect(marked).toEqual({ ipAddress: null, userAgent: BROWSER_UA });
    expect(marked.ipAddress).not.toBe(SOCKET_PEER);

    // …and the branch split is proven, not asserted: the same request WITHOUT
    // the marker records a different, non-null value.
    const unmarked = extractAuditClientHints(req({ 'user-agent': 'undici' }), policy(0));
    expect(unmarked.ipAddress).toBe(SOCKET_PEER);
    expect(unmarked.ipAddress).not.toBe(marked.ipAddress);
  });

  it('PM-5 — no token shape can make the comparison THROW (both sides are digests)', () => {
    for (const presented of ['', 'x', 'z'.repeat(70_000), TOKEN.slice(0, -1), TOKEN]) {
      expect(() =>
        extractAuditClientHints(req({ [PILOTAGE_FORWARD_TOKEN_HEADER]: presented }), policy(0)),
      ).not.toThrow();
    }
  });

  it('a hostile forwarded user-agent is truncated, never rejected as an exception', () => {
    const hints = extractAuditClientHints(
      req({
        [PILOTAGE_FORWARD_TOKEN_HEADER]: TOKEN,
        [PILOTAGE_CLIENT_USER_AGENT_HEADER]: 'A'.repeat(MAX_USER_AGENT_LENGTH + 5_000),
      }),
      policy(0),
    );
    expect(hints.userAgent).toHaveLength(MAX_USER_AGENT_LENGTH);
  });

  it('a forwarded address that is not an inet becomes null (the @db.Inet column is never risked)', () => {
    for (const forged of ['not-an-ip', 'unknown', '_hidden', '1.2.3.4, 5.6.7.8', '   ']) {
      const hints = extractAuditClientHints(
        req({ [PILOTAGE_FORWARD_TOKEN_HEADER]: TOKEN, [PILOTAGE_CLIENT_IP_HEADER]: forged }),
        policy(0),
      );
      expect(hints.ipAddress).toBeNull();
    }
  });
});

/* ------------------------------------------------------------------ *
 * Branch 2 — nobody claims to relay
 * ------------------------------------------------------------------ */

describe('branch 2 — nobody claims to relay', () => {
  it('N = 0, no XFF — records the socket peer and the request user-agent', () => {
    expect(
      extractAuditClientHints(req({ 'user-agent': BROWSER_UA }, BROWSER_IP), policy(0)),
    ).toEqual({ ipAddress: BROWSER_IP, userAgent: BROWSER_UA });
  });

  it('AC-7 / PM-2 — a chain SHORTER than N blanks the address (Express pads; ADR-036 D4)', () => {
    // With `trust proxy: 2` and a one-entry chain, proxyaddr runs out of trusted
    // hops and returns the LEFTMOST entry — a value the caller chose. Express
    // cannot express "shorter than N is untrustworthy"; this seam does.
    const hints = extractAuditClientHints(
      req({ 'x-forwarded-for': '1.2.3.4', 'user-agent': BROWSER_UA }, '1.2.3.4'),
      policy(2),
    );
    expect(hints.ipAddress).toBeNull();
    expect(hints.ipAddress).not.toBe('1.2.3.4');
    // The user-agent of the immediate caller is its own real header and stays.
    expect(hints.userAgent).toBe(BROWSER_UA);
  });

  it('AC-7 — a chain of EXACTLY N is trusted, and Express decides which entry', () => {
    expect(
      extractAuditClientHints(
        req({ 'x-forwarded-for': `${BROWSER_IP}, 10.0.0.5` }, BROWSER_IP),
        policy(2),
      ).ipAddress,
    ).toBe(BROWSER_IP);
  });

  it('a request with no XFF under N = 2 blanks — a direct caller bypassing the edge is not evidence', () => {
    const hints = extractAuditClientHints(req({ 'user-agent': BROWSER_UA }), policy(2));
    expect(hints.ipAddress).toBeNull();
    expect(hints.ipAddress).not.toBe(SOCKET_PEER);
  });
});

/* ------------------------------------------------------------------ *
 * Shapes (PM-12 / AC-17) and the chain parser
 * ------------------------------------------------------------------ */

describe('normaliseClientAddress — one client, ONE spelling (AC-1 must not pass on formats)', () => {
  const SHAPES: [string, string][] = [
    ['1.2.3.4', '1.2.3.4'],
    ['1.2.3.4:5678', '1.2.3.4'],
    ['::1', '::1'],
    ['[::1]', '::1'],
    ['[::1]:443', '::1'],
    ['[2001:db8::1]:8443', '2001:db8::1'],
    // Express on a dual-stack socket yields the mapped form. Without this,
    // "two different ip_address values" is satisfiable by two FORMATS of one.
    ['::ffff:127.0.0.1', '127.0.0.1'],
    ['::FFFF:92.184.7.14', '92.184.7.14'],
    ['  1.2.3.4  ', '1.2.3.4'],
    // RFC 7239 obfuscated identifiers pass through untouched and are refused
    // downstream by sanitiseInetOrNull — they are not addresses.
    ['unknown', 'unknown'],
    ['_hidden', '_hidden'],
  ];

  it.each(SHAPES)('normaliseClientAddress(%j) → %j', (raw, expected) => {
    expect(normaliseClientAddress(raw)).toBe(expected);
  });

  const BLANKS: [string | null | undefined][] = [[''], ['   '], [undefined], [null]];

  it.each(BLANKS)('normaliseClientAddress(%j) → null', (raw) => {
    expect(normaliseClientAddress(raw)).toBeNull();
  });
});

describe('parseForwardedChain', () => {
  const CHAINS: [string, string[]][] = [
    ['1.2.3.4', ['1.2.3.4']],
    ['1.2.3.4, 5.6.7.8', ['1.2.3.4', '5.6.7.8']],
    ['1.2.3.4,,5.6.7.8', ['1.2.3.4', '5.6.7.8']],
    ['   ', []],
    ['', []],
  ];

  it.each(CHAINS)('parseForwardedChain(%j) → %j', (raw, expected) => {
    expect(parseForwardedChain(raw)).toEqual(expected);
  });

  it('parseForwardedChain(null) → []', () => {
    expect(parseForwardedChain(null)).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 * The boot-time policy
 * ------------------------------------------------------------------ */

describe('configureAuditClientHints — fail-safe before, and after, configuration', () => {
  it('UNCONFIGURED means NO provenance, never a guess', () => {
    resetAuditClientHintsPolicy();
    expect(
      extractAuditClientHints(
        req({ [PILOTAGE_FORWARD_TOKEN_HEADER]: TOKEN, [PILOTAGE_CLIENT_IP_HEADER]: BROWSER_IP }),
      ),
    ).toEqual(NO_CLIENT_HINTS);
  });

  it('reports whether a token is configured — the PRESENCE, never the value', () => {
    expect(configureAuditClientHints({ trustedHops: 0, forwardToken: TOKEN })).toBe(true);
    expect(configureAuditClientHints({ trustedHops: 0, forwardToken: '   ' })).toBe(false);
    expect(configureAuditClientHints({ trustedHops: 0 })).toBe(false);
  });

  it('a blank configured token is treated as UNCONFIGURED, not as a token equal to ""', () => {
    configureAuditClientHints({ trustedHops: 0, forwardToken: '' });
    expect(
      extractAuditClientHints(req({ [PILOTAGE_FORWARD_TOKEN_HEADER]: '', [PILOTAGE_CLIENT_IP_HEADER]: BROWSER_IP })),
    ).toEqual(NO_CLIENT_HINTS);
  });

  it('the configured policy is what the default-argument extraction uses', () => {
    configureAuditClientHints({ trustedHops: 0, forwardToken: TOKEN });
    expect(
      extractAuditClientHints(
        req({ [PILOTAGE_FORWARD_TOKEN_HEADER]: TOKEN, [PILOTAGE_CLIENT_IP_HEADER]: BROWSER_IP }),
      ),
    ).toEqual({ ipAddress: BROWSER_IP, userAgent: null });
  });

  it('NO_CLIENT_HINTS is frozen — a caller cannot mutate the shared absence', () => {
    expect(Object.isFrozen(NO_CLIENT_HINTS)).toBe(true);
  });
});
