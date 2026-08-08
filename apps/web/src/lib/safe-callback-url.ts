/**
 * The post-authentication redirect allow-list (S-E05-12 / AC-1 · AC-2, PF-102).
 *
 * Why this module exists. `PortalLoginForm` read `?callbackUrl=` straight off the
 * query string and handed it to `router.push`. Next's App Router performs a hard
 * `window.location` navigation for a cross-origin href, so
 * `/parent/login?callbackUrl=https://evil.example/` showed the GENUINE login page,
 * authenticated the parent for real (the session cookie IS set), then landed them
 * off-site — the maximally convincing phishing sequence, on a platform whose users
 * are parents of minors. This function is the one place that decides whether a
 * redirect target may be used, and it is called ONCE, at the read site, so the
 * binding is safe by construction at every sink downstream.
 *
 * Deliberately import-free, exactly like its neighbour `./portals.ts`. That module's
 * header explains the reason and it applies verbatim here: this file is one import
 * away from the **Edge** middleware bundle, so it carries no `next/*` import, no
 * server-scoped module directive, and no environment read. It is also why it is not in
 * `packages/contracts`: that package is built to CJS `dist/` and shared with the api
 * and worker runtimes, neither of which has any use for a Next route.
 *
 * ── Three design decisions, made on purpose ──────────────────────────────────
 *
 * 1. NO NORMALISATION. Nothing is trimmed, lowercased, decoded, or round-tripped
 *    through `new URL()`. The browser re-parses the exact string handed to
 *    `router.push`, and its URL parser strips leading/trailing C0 controls and
 *    whitespace, and removes tab/LF/CR from ANYWHERE, *before* deciding the origin.
 *    Normalise-then-accept therefore validates string A while string B navigates —
 *    the classic parser differential, and the way open-redirect fixes get re-broken.
 *    Validating the exact bytes that will be used means `'\n//evil.example'` and
 *    `'<NUL>/x'` fail on the first clause with no special case, and no future
 *    normalisation step can open a gap between the check and the use.
 *
 * 2. C0 REJECTED ANYWHERE, not just at position 1. This clause is a MEASURED
 *    correction to the four-clause rule the finding proposed
 *    (`raw.startsWith('/') && raw[1] !== '/' && raw[1] !== '\\'`). Resolved against
 *    Node's WHATWG `URL` with base `https://pilotage.example/parent/login`, four
 *    inputs pass that rule and still navigate off-origin: `/<TAB>/evil.example`,
 *    `/<LF>/evil.example`, `/<CR>/evil.example` (all → `https://evil.example/`) and
 *    `/<CR><LF>/evil` (→ `https://evil/`). Cause: the parser removes tab/LF/CR from
 *    anywhere in the string *before* parsing, so `/<TAB>/evil.example` becomes
 *    `//evil.example` after the check has already passed it. The clause is stated as
 *    "anywhere" rather than "at position 1" because a rule whose safety depends on
 *    WHERE the byte sits breaks the next time normalisation order changes.
 *
 * 3. THE FALLBACK IS NOT VALIDATED. It is a trusted, caller-supplied literal (the
 *    portal landing path). Validating it would imply it could be untrusted, which
 *    would be a lie about where it comes from — and a fallback that can itself fall
 *    back has no floor.
 *
 * ── Not here on purpose ──────────────────────────────────────────────────────
 *
 * There is no second `new URL(raw, base).origin === base` witness in this function.
 * It was measured over the 41-row accept/reject matrix: it catches ZERO inputs the
 * string rule accepts, and it *accepts* seven the string rule rejects (`'<NUL>/x'`,
 * `'%2F%2Fevil.example'`, `''`, `'/x/<TAB>/y'`, …). It is strictly weaker here, so
 * carrying it would add an unreachable branch that no test can fail. The origin
 * oracle belongs where it is falsifiable — in the guard spec, as the differential
 * check on this function's OUTPUT.
 *
 * There is also no bypass of any kind (DNC-10): no environment variable, no flag,
 * no build-mode branch, and no third options parameter. `safeCallbackUrl.length` is
 * 2, and the guard spec asserts that on the executed function — an options argument
 * cannot hide from arity, whereas a name-absence check can be dodged by a computed key.
 */

/**
 * True when `value` carries a control character the URL parser strips or rejects —
 * C0 (U+0000 to U+001F) or U+007F — at ANY position.
 *
 * Written as a code-unit scan rather than the obvious character-class regex for a
 * MEASURED reason, not a stylistic one: `no-control-regex` is an ESLint ERROR in
 * this repository and `next build` runs ESLint, so the regex form does not warn —
 * it FAILS the web build. That is how it was found, by running the gate rather
 * than reading it: `safe-callback-url.ts:67` → `@pilotage/web#build exited (1)`,
 * and with no `.next` emitted the web-artefact and link-integrity stages fell over
 * behind it. One lint error, four red stages.
 *
 * The other way out was `eslint-disable-next-line no-control-regex`, and it was
 * rejected: the rule is right that a control character inside a regex is usually a
 * mistake, and a disable comment sitting in the one security-critical predicate in
 * this codebase is a worse thing to leave behind than five lines of explicit
 * arithmetic. The semantics are identical — the 37-row matrix in
 * `open-redirect-gate.spec.ts` is what proves that, and it is unchanged by the
 * rewrite, so the claim is falsifiable rather than merely plausible.
 */
function hasControlCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

/**
 * Returns `raw` when it is unambiguously a path-only, same-origin redirect target,
 * and `fallback` in every other case.
 *
 * The accept rule is an ALLOW-LIST of five clauses — a deny-list of known-bad
 * shapes is a list someone has to keep complete forever:
 *
 *  1. `raw` is a string (so `null` / `undefined` / a repeated query parameter fall back);
 *  2. its first character is `/` (rejects absolute, scheme-relative-after-whitespace,
 *     `javascript:`, `data:`, `%2F%2F…`, `\/…` and the empty string in one clause);
 *  3. its second character is not `/` (rejects `//evil.example`);
 *  4. its second character is not `\` (rejects `/\evil.example` — browsers read a
 *     backslash as a slash in a special-scheme URL);
 *  5. it contains no C0 control or U+007F at any position (see decision 2 above).
 *
 * `'/'` is ACCEPTED: `raw[1]` is `undefined`, which is neither `/` nor `\`. That is
 * deliberate and has its own test — do not "fix" it with a length check, and do not
 * rewrite clauses 2–4 as `/^\/[^/\\]/`, which demands a second character and would
 * silently start rejecting the site root.
 *
 * The return value is always `raw` byte-identical or `fallback` — never a derivative.
 * A returned derivative would mean the check ran on one string and the navigation
 * runs on another.
 */
export function safeCallbackUrl(raw: string | null | undefined, fallback: string): string {
  if (typeof raw !== 'string') return fallback;
  if (raw[0] !== '/') return fallback;
  if (raw[1] === '/') return fallback;
  if (raw[1] === '\\') return fallback;
  if (hasControlCharacter(raw)) return fallback;
  return raw;
}
