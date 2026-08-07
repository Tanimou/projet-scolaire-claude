#!/usr/bin/env node
/**
 * link-integrity-check.js — the gate that reads every fully-literal internal link
 * in `apps/web` and resolves it against the EMITTED route inventory (S-E06-3,
 * PF-19).
 *
 * WHY A ROUTE-EXISTENCE CHECK CANNOT SEE THE DEFECT THIS CLOSES
 * ------------------------------------------------------------
 * `apps/web/src/app/admin/classes/page.tsx` linked to `/admin/classes/new`
 * twice — the `PageHeader` action ("Ajouter une classe") and the `EmptyState`
 * action, which is the only affordance a school with zero classes ever sees.
 * That route was never emitted.
 *
 * It nonetheless **resolves**. Next matches it against `/admin/classes/[id]`
 * with `id = "new"`, the detail page fetches a class whose id is the string
 * `new`, and the admin lands on an error boundary. So the naive gate — "does
 * every link target appear in the route table?" — answers *yes* and reports
 * green while the primary call to action of an admin surface crashes.
 *
 * The defect is not the ABSENCE of a match; it is the SHAPE of the match. A
 * fully-literal target that resolves only because a single-segment `[param]`
 * swallowed a literal segment means the author intended a static page. That
 * failure class — DYNAMIC CAPTURE — is the non-obvious half of this gate, and
 * it is the half that stops the class of defect rather than one instance of it.
 * It is why the classifier returns four verdicts rather than a boolean:
 *
 *     exact            matches a template with no dynamic segment      ALIVE
 *     catch-all        matches only through a catch-all segment        ALIVE
 *     dynamic-capture  matches only because a [param] ate a literal    FAIL, always
 *     dead             matches nothing at all                          FAIL unless baselined
 *
 * `catch-all` is ALIVE on purpose. Consuming literal segments is the *entire*
 * function of a catch-all: `/api/proxy/[...path]` legitimately swallows
 * `/api/proxy/v1/notifications/unread-count`, which is how every client fetch in
 * this application reaches the API. Conflating the two would make the gate
 * permanently red on correct code, and the only way back to green would be to
 * break the BFF proxy.
 *
 * IT READS THE EMITTED ARTEFACT, NEVER THE app/ DIRECTORY TREE
 * -----------------------------------------------------------
 * The route universe comes from `apps/web/.next/app-path-routes-manifest.json`,
 * the same source `scripts/web-artifact-check.js` uses and for the same reason.
 * PF-82 exists precisely because a sibling gate read source instead of the
 * artefact; this file does not reproduce it at a new address. A route that
 * exists under `app/` and was not emitted is exactly the state in which a
 * source-reading gate reports "the link is fine" about a link that 404s. The
 * gate therefore runs AFTER the build, and is skipped by `--quick`.
 *
 * TEMPLATE LITERALS: RESOLVED OVER THE DECLARED UNION, OR REPORTED (S-E06-5, PF-97)
 * ---------------------------------------------------------------------------------
 * Until S-E06-5 the pattern below excluded the backtick, and the paragraph here
 * called that a deliberate exclusion: "an interpolated href is a dynamic target."
 * It was a hole, and it was exactly where the application shell lives. The
 * account menu of every authenticated page wrote its links as
 * `` `/${portal}/profile` ``, no per-portal profile route was ever emitted, and this
 * gate — written to stop precisely that class of defect — printed PASS.
 *
 * So a template-literal href is now READ, and one of three things happens to it.
 * Nothing is dropped, because a silent drop is how the hole was made:
 *
 *   expanded   every interpolation is a whole path segment AND every interpolated
 *              variable has a DECLARED union of string literals in the same file
 *              (`portal: 'admin' | 'teacher' | 'parent'`). The cross-product is
 *              expanded and each expansion goes through the same four-verdict
 *              classifier as a quoted literal — so a dead expansion FAILS.
 *   shape      anything else. The target is reduced to a pattern (`/*​/settings`)
 *              and checked for "a route of this shape and depth exists". That is
 *              all it may claim, and it is reported in the run output — counted in
 *              the summary and listed pattern by pattern, on PASS as well as FAIL.
 *              A shape nothing matches FAILS unless it is baselined in `deadShapes`.
 *   unparsed   a `/`-leading template literal that cannot be parsed at all. A
 *              STRUCTURAL FAILURE, never a skip (DNC-08).
 *
 * The union is read from the DECLARED type, never guessed from "the four portals".
 * `TopbarUserMenu` accepts `student` and never renders the entry; `UserMenu` types
 * the parameter as three portals. Guessing would manufacture findings that correct
 * code cannot produce, in a gate whose entire value is that its findings are real.
 * Two candidate unions for one name in one file is UNRESOLVABLE — reported as a
 * shape — never resolved by proximity: an under-approximation is a silent drop
 * wearing a different hat.
 *
 * Shape matching is deliberately WEAK: a `*` may align to a literal route segment
 * as well as to a `[param]`. Requiring alignment to a dynamic segment would make
 * `` `/${portal}/settings` `` report dead on a correct repository.
 *
 * The anti-drop invariant is asserted, not assumed:
 *
 *     templateRows === expanded + shape + unparsed
 *
 * If it does not hold the run is a structural failure. A check that quietly
 * discovers nothing must not pass.
 *
 * COMMENTS ARE STRIPPED BEFORE ANYTHING IS EXTRACTED
 * -------------------------------------------------
 * Mandatory, and measured: JSDoc prose in this repository contains route
 * TEMPLATES — `` `/admin/classes/[id]` `` at `admin/classes/new/page.tsx:16`,
 * `` `/parent/messages/[id]` `` at `messages-actions.ts:11` — each of which would
 * be extracted as a DYNAMIC CAPTURE, which is unbaselineable by design, leaving
 * the gate permanently red with no way back. Comments also hold API-relative paths
 * (`/me`, `/students`, `/calendar/events`) that would read as dead routes.
 *
 * The stripper is STRING-AWARE. A naive `/\/\/.*$/` eats everything after the
 * `//` in `https://`, silently deleting real hrefs — the hole being closed,
 * re-opened at a new address. It therefore tracks single quotes, double quotes,
 * template literals with nested `${…}`, and regex literals, and it preserves
 * length and newlines so every reported line number stays true.
 *
 * WHAT COUNTS AS A LITERAL INTERNAL LINK, AND WHY EACH EXCLUSION EXISTS
 * --------------------------------------------------------------------
 * Source set: every .ts and .tsx file under `apps/web/src`, walked from the
 * filesystem. In scope: a fully-literal single- or double-quoted string whose
 * value starts with a slash, plus every union expansion of a template literal.
 *
 *   - the bare root is excluded — it always resolves and carries no information;
 *   - anything under `_next` is excluded — build assets, not routes;
 *   - a last segment containing a dot is excluded — asset paths such as the
 *     favicon are served from `public/`, not from the router;
 *   - protocol-relative strings and anything containing a scheme separator are
 *     excluded — they are external;
 *   - `/api/v1/...` is excluded — that is the NestJS API's own namespace, reached
 *     through the BFF proxy, and it is not a Next route at any address;
 *   - query strings and fragments are stripped before matching.
 *
 * RATCHET DISCIPLINE
 * ------------------
 * `scripts/link-integrity-baseline.json` is a ceiling that may only ever SHRINK,
 * in the sense `scripts/known-test-failures.json` established: every entry
 * carries the finding id that owns the fix, so nothing here is "silenced" — it
 * is queued. Four ways to fail, and they are deliberately symmetric:
 *
 *   - a NEW dead target                            → FAIL;
 *   - a baselined target that is now ALIVE         → FAIL (remove the entry and
 *     close the finding; a ratchet that never tightens is a rubber band);
 *   - a baselined target nobody references any more → FAIL (a ceiling nobody is
 *     standing under silently re-authorises the target the day someone links it);
 *   - ANY dynamic capture                          → FAIL, unconditionally. It is
 *     not baselineable and `--update` refuses to record it.
 *
 * `deadShapes` is the same ceiling for shape-checked patterns, held to the same
 * four rules. And a `dead` row may carry `"class": "prefix-constant"` (S-E06-5,
 * PF-93): a target referenced ONLY as a string prefix that nothing will ever
 * create — `/api/auth`, whose `[...nextauth]` catch-all needs at least one
 * segment, and `/favicon`, an asset prefix. Such a row still carries a reason and
 * an owning finding; it simply stops being counted as dead DEBT, because there is
 * no fix to queue. It is not a quieter baseline, and the gate proves it: if ANY
 * reference to the target sits on an href-like line the classification is REFUSED
 * by file and line and the run FAILS. `/legal` is structurally eligible and is
 * deliberately NOT tagged — it resolves the day S-E06-4 ships `/legal/*`, so it is
 * genuinely queued debt owned by PF-38 and blocked on D-08.
 *
 * There is no bypass (DNC-10): no environment variable is read anywhere in this
 * file, and the only flags are `--update` (which rewrites the reviewed ceiling
 * and shows up in the diff) and `--help`. A flag that let a caller choose the
 * inventory would be a bypass wearing a different hat, so there is none — which
 * is also why both CI call sites invoke this script with zero arguments.
 *
 * USAGE
 *   node scripts/link-integrity-check.js            gate (exit 1 on any failure)
 *   node scripts/link-integrity-check.js --update   rewrite the reviewed baseline
 */
'use strict';

const { existsSync, readdirSync, readFileSync, writeFileSync } = require('node:fs');
const { join, resolve, sep } = require('node:path');

const REPO_ROOT = resolve(__dirname, '..');
const BASELINE_PATH = join(REPO_ROOT, 'scripts', 'link-integrity-baseline.json');

const SOURCE_EXTENSIONS = ['.ts', '.tsx'];
const SKIPPED_DIRECTORIES = new Set(['node_modules', '.next', '.turbo', 'dist', 'coverage']);
const NEXT_CONFIG_NAMES = ['next.config.mjs', 'next.config.js', 'next.config.cjs', 'next.config.ts'];

/* ------------------------------------------------------------------ *
 * Discovery — from the filesystem, never from the baseline
 * ------------------------------------------------------------------ */

/**
 * Every Next.js application in the workspace.
 *
 * Driven by the filesystem for the same reason `web-artifact-check.js` is: a
 * list an application can quietly omit itself from reproduces PF-69/PF-70 at a
 * new address. A second Next app added tomorrow is walked and gated the day it
 * appears, without anyone remembering to enter it anywhere.
 */
function discoverNextApps() {
  const appsDir = join(REPO_ROOT, 'apps');
  const found = [];
  for (const name of readdirSync(appsDir)) {
    const dir = join(appsDir, name);
    if (!NEXT_CONFIG_NAMES.some((f) => existsSync(join(dir, f)))) continue;
    found.push({
      id: `apps/${name}`,
      dir,
      srcDir: join(dir, 'src'),
      manifestPath: join(dir, '.next', 'app-path-routes-manifest.json'),
    });
  }
  return found.sort((a, b) => a.id.localeCompare(b.id));
}

function rel(path) {
  const normalized = path.startsWith(REPO_ROOT) ? path.slice(REPO_ROOT.length + 1) : path;
  return normalized.split(sep).join('/');
}

/* ------------------------------------------------------------------ *
 * The route matcher
 * ------------------------------------------------------------------ */

function segmentsOf(path) {
  return path.split('/').filter((s) => s.length > 0);
}

/**
 * Route-group segments never appear in a URL, so they are stripped before the
 * template is compared with anything.
 */
function templateSegments(route) {
  return segmentsOf(route).filter((s) => !(s.startsWith('(') && s.endsWith(')')));
}

function isOptionalCatchAll(segment) {
  return segment.startsWith('[[...') && segment.endsWith(']]');
}

function isCatchAll(segment) {
  return !isOptionalCatchAll(segment) && segment.startsWith('[...') && segment.endsWith(']');
}

function isParam(segment) {
  return !isCatchAll(segment) && !isOptionalCatchAll(segment) && segment.startsWith('[') && segment.endsWith(']');
}

/**
 * Query string and fragment stripped, trailing slash removed, root preserved.
 */
function normalizeTarget(raw) {
  let value = String(raw);
  const hash = value.indexOf('#');
  if (hash >= 0) value = value.slice(0, hash);
  const query = value.indexOf('?');
  if (query >= 0) value = value.slice(0, query);
  value = value.replace(/\/+$/, '');
  return value === '' ? '/' : value;
}

/**
 * Match one template against one target.
 *
 * Returns `null` when it does not match, otherwise how it matched: `capture` is
 * true when a single-segment `[param]` consumed a literal segment, `catchAll` is
 * true when a catch-all did. Depth semantics are the sharp part and a
 * segment-count equality test gets them wrong invisibly on a healthy repository:
 * `[param]` is exactly one segment, `[...slug]` is one or more, `[[...slug]]` is
 * zero or more.
 */
function matchTemplate(tplSegs, tgtSegs) {
  function walk(ti, si, capture, catchAll) {
    if (ti === tplSegs.length) {
      return si === tgtSegs.length ? { capture, catchAll } : null;
    }
    const segment = tplSegs[ti];

    if (isOptionalCatchAll(segment) || isCatchAll(segment)) {
      const minimum = isOptionalCatchAll(segment) ? 0 : 1;
      for (let take = tgtSegs.length - si; take >= minimum; take--) {
        const matched = walk(ti + 1, si + take, capture, true);
        if (matched) return matched;
      }
      return null;
    }

    if (isParam(segment)) {
      if (si >= tgtSegs.length) return null;
      return walk(ti + 1, si + 1, true, catchAll);
    }

    if (segment !== tgtSegs[si]) return null;
    return walk(ti + 1, si + 1, capture, catchAll);
  }

  return walk(0, 0, false, false);
}

/**
 * Resolve a target against the whole inventory and report the best match.
 *
 * Precedence is exact over catch-all over capture: once `/admin/classes/new` is
 * emitted, the fact that `/admin/classes/[id]` would also have matched stops
 * mattering, and the gate must say so rather than keep reporting the fixed
 * defect.
 */
function resolveTarget(target, routes) {
  const tgtSegs = segmentsOf(normalizeTarget(target));
  let best = null;

  for (const route of routes) {
    const matched = matchTemplate(templateSegments(route), tgtSegs);
    if (!matched) continue;

    let verdict = 'exact';
    if (matched.capture) verdict = 'dynamic-capture';
    else if (matched.catchAll) verdict = 'catch-all';

    const rank = { exact: 3, 'catch-all': 2, 'dynamic-capture': 1 }[verdict];
    if (!best || rank > best.rank) best = { verdict, template: route, rank };
    if (verdict === 'exact') break;
  }

  return best ? { verdict: best.verdict, template: best.template } : { verdict: 'dead', template: null };
}

/** The pure classifier the guard spec drives with synthetic inventories. */
function classifyTarget(target, routes) {
  return resolveTarget(target, routes).verdict;
}

/**
 * Match one route template against a SHAPE — a target in which one or more
 * segments are unknown and written `*`.
 *
 * Weak on purpose: a `*` may align to a literal route segment as well as to a
 * `[param]`. `` `/${portal}/settings` ``, when the union cannot be resolved,
 * becomes `/*​/settings`, and the only routes it can possibly align to are
 * `/admin/settings`, `/teacher/settings`, `/parent/settings` — literals. Demanding
 * a dynamic segment there would report a correct href as dead, which is the one
 * outcome a gate must never produce.
 *
 * The claim this supports is therefore narrow and must be read as written: *a
 * route of this shape and depth exists.* It does NOT prove that the concrete
 * runtime value resolves.
 */
function matchShape(tplSegs, shapeSegs) {
  function walk(ti, si) {
    if (si === shapeSegs.length) return ti === tplSegs.length;
    if (ti === tplSegs.length) return false;
    const segment = tplSegs[ti];

    if (isOptionalCatchAll(segment) || isCatchAll(segment)) {
      const minimum = isOptionalCatchAll(segment) ? 0 : 1;
      for (let take = shapeSegs.length - si; take >= minimum; take--) {
        if (walk(ti + 1, si + take)) return true;
      }
      return false;
    }

    if (isParam(segment)) return walk(ti + 1, si + 1);
    if (shapeSegs[si] === '*') return walk(ti + 1, si + 1);
    return shapeSegs[si] === segment ? walk(ti + 1, si + 1) : false;
  }

  return walk(0, 0);
}

/** `shape-alive` when some emitted route has this shape at this depth. */
function classifyPattern(pattern, routes) {
  const shapeSegs = segmentsOf(normalizeTarget(pattern));
  for (const route of routes) {
    if (matchShape(templateSegments(route), shapeSegs)) return 'shape-alive';
  }
  return 'shape-dead';
}

/* ------------------------------------------------------------------ *
 * The extractor
 * ------------------------------------------------------------------ */

function walkSources(root) {
  const files = [];
  if (!existsSync(root)) return files;
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
        stack.push(join(current, entry.name));
      } else if (SOURCE_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
        files.push(join(current, entry.name));
      }
    }
  }
  return files.sort();
}

/**
 * A fully-literal string whose value starts with a slash. Backticks stay outside
 * the character class: a template literal is not a literal target, and it is read
 * by `extractTemplateLinks` instead, which resolves or reports it (PF-97).
 */
const LITERAL_LINK = /(['"])(\/[^'"`\n\r]*)\1/g;

/* ------------------------------------------------------------------ *
 * Comment stripping — string-aware, length-preserving
 * ------------------------------------------------------------------ */

/**
 * A `/` opens a regex literal only in a value position. The distinction matters:
 * a regex body in this repository routinely contains quotes and backticks — the
 * pattern above is one — and mis-reading one as division puts the scanner inside
 * a string state it never leaves.
 */
const REGEX_MAY_FOLLOW_PUNCTUATION = new Set([
  '',
  '(',
  ',',
  '=',
  ':',
  '[',
  '!',
  '&',
  '|',
  '?',
  '{',
  '}',
  ';',
  '+',
  '-',
  '*',
  '%',
  '~',
  '^',
  '<',
  '>',
  '\n',
]);

const REGEX_MAY_FOLLOW_KEYWORD = new Set([
  'return',
  'typeof',
  'instanceof',
  'in',
  'of',
  'new',
  'delete',
  'void',
  'throw',
  'case',
  'do',
  'else',
  'yield',
  'await',
]);

function regexMayStartAfter(token) {
  return REGEX_MAY_FOLLOW_PUNCTUATION.has(token) || REGEX_MAY_FOLLOW_KEYWORD.has(token);
}

/**
 * Position-aware refinement of {@link regexMayStartAfter}: `'<'` is a legitimate
 * value position in plain TypeScript (`a < /re/.test(b)`), but in TSX a `/`
 * IMMEDIATELY after a `<` is a JSX **closing tag** — `</div>` — and never a regex.
 *
 * Reading that `/` as a regex opener drags the scanner forward to the next `/` on
 * the line, which silently eats whatever follows: a `//` comment stays unstripped
 * (its concrete path can then surface as an unbaselineable DYNAMIC CAPTURE), and a
 * template-literal `href` on the same line is never registered at all — neither
 * expanded, nor shape-checked, nor reported `unparsed`, i.e. exactly the silent
 * drop AC-1 forbids (PF-97's shape, at a new address).
 *
 * Narrowed to `src[i - 1] === '<'` — the adjacency is what makes it a closing tag,
 * so `a < /re/` (with any separator) keeps its old reading and nothing regresses.
 */
function regexMayStartAt(src, i, token) {
  if (i > 0 && src[i - 1] === '<') return false;
  return regexMayStartAfter(token);
}

/** Skip a quoted string starting at `i` (the quote). Returns the index after it. */
function skipQuoted(src, i) {
  const quote = src[i];
  let j = i + 1;
  while (j < src.length) {
    if (src[j] === '\\') {
      j += 2;
      continue;
    }
    if (src[j] === quote) return j + 1;
    if (src[j] === '\n') return j; // unterminated — do not run past the line
    j++;
  }
  return j;
}

/**
 * Skip a regex literal starting at `i` (the leading slash), character-class aware.
 * Returns the index after the closing slash, or `null` when the `/` turned out to
 * be division after all.
 */
function skipRegex(src, i) {
  let j = i + 1;
  let inClass = false;
  while (j < src.length) {
    const c = src[j];
    if (c === '\\') {
      j += 2;
      continue;
    }
    if (c === '\n') return null;
    if (inClass) {
      if (c === ']') inClass = false;
      j++;
      continue;
    }
    if (c === '[') {
      inClass = true;
      j++;
      continue;
    }
    if (c === '/') return j + 1;
    j++;
  }
  return null;
}

/**
 * Blank every `//` and `/* … *​/` comment, preserving byte length and every
 * newline, and leaving string and template literals untouched.
 *
 * Length preservation is not cosmetic: every line number this gate reports is
 * derived from an offset in the stripped text, and a stripper that shortened the
 * source would cite the wrong line for every finding after the first comment.
 */
function stripCommentsPreservingLines(source) {
  const src = String(source);
  const n = src.length;
  const out = src.split('');
  const stack = [{ type: 'code', interp: false, depth: 0 }];
  let i = 0;
  let token = '';

  const blank = (from, to) => {
    for (let k = from; k < to && k < n; k++) {
      if (out[k] !== '\n' && out[k] !== '\r') out[k] = ' ';
    }
  };

  while (i < n) {
    const top = stack[stack.length - 1];
    const ch = src[i];

    if (top.type === 'template') {
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (ch === '`') {
        stack.pop();
        token = '`';
        i++;
        continue;
      }
      if (ch === '$' && src[i + 1] === '{') {
        stack.push({ type: 'code', interp: true, depth: 0 });
        token = '{';
        i += 2;
        continue;
      }
      i++;
      continue;
    }

    if (ch === '/' && src[i + 1] === '/') {
      let j = i;
      while (j < n && src[j] !== '\n') j++;
      blank(i, j);
      i = j;
      continue;
    }
    if (ch === '/' && src[i + 1] === '*') {
      let j = i + 2;
      while (j < n && !(src[j] === '*' && src[j + 1] === '/')) j++;
      const end = Math.min(n, j + 2);
      blank(i, end);
      i = end;
      continue;
    }
    if (ch === "'" || ch === '"') {
      i = skipQuoted(src, i);
      token = ch;
      continue;
    }
    if (ch === '`') {
      stack.push({ type: 'template' });
      i++;
      continue;
    }
    if (ch === '{') {
      top.depth++;
      token = '{';
      i++;
      continue;
    }
    if (ch === '}') {
      if (top.depth > 0) top.depth--;
      else if (top.interp) stack.pop();
      token = '}';
      i++;
      continue;
    }
    if (ch === '/' && regexMayStartAt(src, i, token)) {
      const after = skipRegex(src, i);
      if (after !== null) {
        i = after;
        token = '/';
        continue;
      }
    }
    if (/[A-Za-z_$]/.test(ch)) {
      let j = i;
      while (j < n && /[\w$]/.test(src[j])) j++;
      token = src.slice(i, j);
      i = j;
      continue;
    }
    if (!/\s/.test(ch)) token = ch;
    else if (ch === '\n') token = token === '' ? '' : token;
    i++;
  }

  return out.join('');
}

/* ------------------------------------------------------------------ *
 * Template literals — scanned over the WHOLE file, never line by line
 * ------------------------------------------------------------------ */

/**
 * Every template literal in a source, with the offset of its first content byte.
 *
 * Whole-file, because a line-based scanner drops multi-line templates SILENTLY,
 * which is the precise failure AC-1 forbids. Measured: exactly two exist —
 * `parent/recommendations/alert-next-steps.ts:70` and
 * `parent/remediation/[planId]/page.tsx:127` — and both are hrefs.
 *
 * A template left open at EOF is returned in `unterminated`, so it can be
 * reported as a structural failure rather than skipped (DNC-08).
 */
function scanTemplateLiterals(source) {
  const src = String(source);
  const n = src.length;
  const templates = [];
  const stack = [{ type: 'code', interp: false, depth: 0 }];
  let i = 0;
  let token = '';

  while (i < n) {
    const top = stack[stack.length - 1];
    const ch = src[i];

    if (top.type === 'template') {
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (ch === '`') {
        stack.pop();
        templates.push({ raw: src.slice(top.start + 1, i), index: top.start + 1 });
        token = '`';
        i++;
        continue;
      }
      if (ch === '$' && src[i + 1] === '{') {
        stack.push({ type: 'code', interp: true, depth: 0 });
        token = '{';
        i += 2;
        continue;
      }
      i++;
      continue;
    }

    if (ch === "'" || ch === '"') {
      i = skipQuoted(src, i);
      token = ch;
      continue;
    }
    if (ch === '`') {
      stack.push({ type: 'template', start: i });
      i++;
      continue;
    }
    if (ch === '{') {
      top.depth++;
      token = '{';
      i++;
      continue;
    }
    if (ch === '}') {
      if (top.depth > 0) top.depth--;
      else if (top.interp) stack.pop();
      token = '}';
      i++;
      continue;
    }
    if (ch === '/' && regexMayStartAt(src, i, token)) {
      const after = skipRegex(src, i);
      if (after !== null) {
        i = after;
        token = '/';
        continue;
      }
    }
    if (/[A-Za-z_$]/.test(ch)) {
      let j = i;
      while (j < n && /[\w$]/.test(src[j])) j++;
      token = src.slice(i, j);
      i = j;
      continue;
    }
    if (!/\s/.test(ch)) token = ch;
    i++;
  }

  const unterminated = stack
    .filter((frame) => frame.type === 'template')
    .map((frame) => ({ raw: src.slice(frame.start + 1), index: frame.start + 1 }));

  return { templates, unterminated };
}

/**
 * The mask sentinel: a NUL byte, the one character that cannot occur in a source
 * file, let alone in a URL path. A printable sentinel would collide with the very
 * strings being masked.
 */
const MASK = '\u0000';

/**
 * Replace every `${…}` span with an opaque token BEFORE anything else touches the
 * string.
 *
 * Order is load-bearing (T1). `RemediationProgressStrip.tsx:222` is
 * `` `/parent/remediation/${visible[0]?.planId}` ``: stripping at the first `?`
 * cuts INSIDE the interpolation, leaving `/parent/remediation/${visible[0]`,
 * whose last segment then matches `[planId]` — a DYNAMIC CAPTURE, which can never
 * be baselined, so the gate would be red forever with no way back.
 *
 * Returns `null` when an interpolation is unterminated.
 */
function maskInterpolations(raw) {
  const src = String(raw);
  const parts = [];
  let masked = '';
  let i = 0;

  while (i < src.length) {
    if (src[i] === '$' && src[i + 1] === '{') {
      let depth = 1;
      let j = i + 2;
      while (j < src.length && depth > 0) {
        const c = src[j];
        if (c === '\\') {
          j += 2;
          continue;
        }
        if (c === "'" || c === '"' || c === '`') {
          j = skipQuoted(src, j);
          continue;
        }
        if (c === '{') depth++;
        else if (c === '}') depth--;
        j++;
      }
      if (depth > 0) return null;
      masked += `${MASK}${parts.length}${MASK}`;
      parts.push(src.slice(i + 2, j - 1).trim());
      i = j;
      continue;
    }
    masked += src[i];
    i++;
  }

  return { masked, parts };
}

function escapeForRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const STRING_LITERAL_SOURCE = "(?:'[^'\\r\\n]*'|\"[^\"\\r\\n]*\")";

function stringLiteralsIn(text) {
  const found = [];
  const pattern = /'([^'\r\n]*)'|"([^"\r\n]*)"/g;
  let match = pattern.exec(text);
  while (match) {
    found.push(match[1] !== undefined ? match[1] : match[2]);
    match = pattern.exec(text);
  }
  return found;
}

/** Top-level keys of `const <name> = { … }`, brace- and string-aware. */
function objectLiteralKeys(name, source) {
  const opener = new RegExp(`\\bconst\\s+${escapeForRegex(name)}\\b[^=;{]*=\\s*\\{`);
  const match = opener.exec(source);
  if (!match) return null;

  const start = match.index + match[0].length;
  let i = start;
  let depth = 1;
  while (i < source.length && depth > 0) {
    const c = source[i];
    if (c === "'" || c === '"' || c === '`') {
      i = skipQuoted(source, i);
      continue;
    }
    if (c === '{' || c === '[' || c === '(') depth++;
    else if (c === '}' || c === ']' || c === ')') depth--;
    i++;
  }
  if (depth > 0) return null;

  const body = source.slice(start, i - 1);
  const keys = [];
  let level = 0;
  let cursor = 0;
  let segmentStart = 0;
  while (cursor <= body.length) {
    const c = body[cursor];
    if (cursor === body.length || (c === ',' && level === 0)) {
      const part = body.slice(segmentStart, cursor);
      const key = /^\s*(?:'([^']*)'|"([^"]*)"|([A-Za-z_$][\w$]*))\s*:/.exec(part);
      if (key) keys.push(key[1] ?? key[2] ?? key[3]);
      segmentStart = cursor + 1;
      cursor++;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      cursor = skipQuoted(body, cursor);
      continue;
    }
    if (c === '{' || c === '[' || c === '(') level++;
    else if (c === '}' || c === ']' || c === ')') level--;
    cursor++;
  }

  return keys.length > 0 ? keys : null;
}

/**
 * The declared union of string literals for an identifier, read from the same
 * file — `string[]`, or `null` for "unresolvable", never a guess.
 *
 * Three declaration forms, and no fourth:
 *
 *   (a) inline union   `portal: 'admin' | 'teacher' | 'parent'`
 *   (b) named alias    `portal: AccountPortal` + `type AccountPortal = 'a' | 'b'`
 *   (c) keyof typeof   `portal: keyof typeof PORTAL_REQUIRED_ROLES`
 *
 * Form (a) requires at least one `|`, i.e. two or more members. Without that rule
 * an ordinary value assignment (`{ portal: 'admin' }`, and there are many) would
 * read as a one-member "declared union" and silently under-approximate the
 * expansion — which is the same defect as dropping the site, at a new address.
 *
 * MORE THAN ONE CANDIDATE UNION IS UNRESOLVABLE. Picking the nearest one would
 * under-approximate invisibly; reporting the site as a shape is honest. Measured:
 * `apps/web/src` contains no such file today, so the rule costs nothing and is
 * pinned by a synthetic guard case instead.
 */
function resolveDeclaredUnion(name, source) {
  if (!/^[A-Za-z_$][\w$]*$/.test(String(name))) return null;
  const executable = stripCommentsPreservingLines(source);
  const escaped = escapeForRegex(name);
  const lead = '(?:^|[\\s,({;<|&])';
  const candidates = [];

  const inline = new RegExp(
    `${lead}${escaped}\\s*\\??\\s*:\\s*(${STRING_LITERAL_SOURCE}(?:\\s*\\|\\s*${STRING_LITERAL_SOURCE})+)`,
    'g',
  );
  let match = inline.exec(executable);
  while (match) {
    candidates.push(stringLiteralsIn(match[1]));
    match = inline.exec(executable);
  }

  const referenced = new RegExp(`${lead}${escaped}\\s*\\??\\s*:\\s*([A-Za-z_$][\\w$]*)`, 'g');
  const aliases = new Set();
  match = referenced.exec(executable);
  while (match) {
    aliases.add(match[1]);
    match = referenced.exec(executable);
  }
  for (const alias of aliases) {
    if (alias === 'keyof' || alias === 'typeof') continue;
    const declaration = new RegExp(
      `\\btype\\s+${escapeForRegex(alias)}\\s*=\\s*\\|?\\s*(${STRING_LITERAL_SOURCE}(?:\\s*\\|\\s*${STRING_LITERAL_SOURCE})+)`,
    ).exec(executable);
    if (declaration) candidates.push(stringLiteralsIn(declaration[1]));
  }

  const keyof = new RegExp(`${lead}${escaped}\\s*\\??\\s*:\\s*keyof\\s+typeof\\s+([A-Za-z_$][\\w$]*)`, 'g');
  match = keyof.exec(executable);
  while (match) {
    const keys = objectLiteralKeys(match[1], executable);
    if (keys) candidates.push(keys);
    match = keyof.exec(executable);
  }

  const distinct = new Map();
  for (const candidate of candidates) {
    const key = [...candidate].sort().join('');
    if (!distinct.has(key)) distinct.set(key, candidate);
  }

  if (distinct.size !== 1) return null;
  const resolved = [...distinct.values()][0];
  return resolved.every((member) => /^[A-Za-z0-9._~-]+$/.test(member)) ? resolved : null;
}

/**
 * Turn one template literal into either every target it can produce, or the shape
 * of the targets it produces. Never into nothing.
 */
function expandTemplateTarget(raw, source) {
  const masked = maskInterpolations(raw);
  if (!masked) return { kind: 'unparsed', raw: String(raw) };

  // `?` and `#` are stripped only OUTSIDE the masks (T1).
  let value = masked.masked;
  const hash = value.indexOf('#');
  if (hash >= 0) value = value.slice(0, hash);
  const query = value.indexOf('?');
  if (query >= 0) value = value.slice(0, query);
  value = value.replace(/\/+$/, '');

  const maskAt = (segment) => {
    const whole = new RegExp(`^${MASK}(\\d+)${MASK}$`).exec(segment);
    return whole ? Number(whole[1]) : null;
  };
  const carriesMask = (segment) => segment.includes(MASK);

  let segments = value.split('/').filter((segment, index) => !(index === 0 && segment === ''));
  // T3: an interpolation that is not a WHOLE segment expands to something this
  // gate cannot reason about — a query string, a file extension, half an id.
  // `ParentActionCenter.tsx`'s `` `/parent/recommendations${childQuery(id)}` `` is
  // the measured case: four correct links report dead if that interpolation is
  // treated as a segment, and they report against the WRONG target if the whole
  // segment is thrown away. So the target is truncated at the interpolation — the
  // literal text before it is kept (`/parent/recommendations`), everything after is
  // dropped — and that literal prefix is held to the usual four-verdict standard.
  const mixedAt = segments.findIndex((s) => carriesMask(s) && maskAt(s) === null);
  if (mixedAt >= 0) {
    const literalPrefix = segments[mixedAt].slice(0, segments[mixedAt].indexOf(MASK));
    segments = [...segments.slice(0, mixedAt), literalPrefix].filter((segment) => segment !== '');
  }

  const holes = segments.map(maskAt).filter((index) => index !== null);
  const expressionsOf = (indexes) => [...new Set(indexes.map((index) => masked.parts[index]))];

  if (holes.length === 0) {
    return { kind: 'expanded', expansions: [normalizeTarget(`/${segments.join('/')}`)], vars: [] };
  }

  const unions = [];
  const unresolved = [];
  for (const index of holes) {
    const expression = masked.parts[index];
    const union = /^[A-Za-z_$][\w$]*$/.test(expression) ? resolveDeclaredUnion(expression, source) : null;
    if (union) unions.push(union);
    else unresolved.push(index);
  }

  if (unresolved.length > 0) {
    const pattern = normalizeTarget(`/${segments.map((s) => (maskAt(s) === null ? s : '*')).join('/')}`);
    return { kind: 'shape', pattern, vars: expressionsOf(unresolved) };
  }

  let expansions = [''];
  let cursor = 0;
  for (const segment of segments) {
    const index = maskAt(segment);
    const alternatives = index === null ? [segment] : unions[cursor++];
    const next = [];
    for (const prefix of expansions) {
      for (const alternative of alternatives) next.push(`${prefix}/${alternative}`);
    }
    expansions = next;
  }

  return {
    kind: 'expanded',
    expansions: [...new Set(expansions.map((expansion) => normalizeTarget(expansion || '/')))],
    vars: expressionsOf(holes),
  };
}

/** Every exclusion in one place, each one named in the file header. */
function isInternalRouteTarget(value) {
  if (value === '/') return false;
  if (value.includes('://')) return false;
  if (value.startsWith('//')) return false;
  if (value.includes('${')) return false;
  if (value.startsWith('/_next')) return false;
  if (value.startsWith('/api/v1/') || value === '/api/v1') return false;
  const segments = segmentsOf(value);
  const last = segments[segments.length - 1];
  if (last && last.includes('.')) return false;
  // A first segment that does not begin with a letter is not a route. Next
  // route segments are named directories, and the strings this rule drops are
  // ratios and units written with a leading slash — `unit: '/20'` in
  // `admin/alerts/types.ts` is a suffix rendered next to a mark out of 20, not
  // a link. Measured: this rule removes exactly one target from the inventory.
  if (!/^[A-Za-z_]/.test(segments[0] || '')) return false;
  return /^\/[A-Za-z0-9\-._~\/]*$/.test(value);
}

/**
 * Is a template's shape in scope at all?
 *
 * The same exclusions as a quoted literal, applied to the pattern with each `*`
 * replaced by a placeholder segment. Without it `` `/api/v1/students/${id}` ``
 * would shape-check as `/api/v1/students/*`, find no Next route (correctly — that
 * is the NestJS namespace) and report a correct fetch as a dead link.
 */
function isTemplateShapeInScope(pattern) {
  const probe = pattern
    .split('/')
    .map((segment) => (segment === '*' ? 'x' : segment))
    .join('/');
  return isInternalRouteTarget(probe);
}

/**
 * A reference sits on an href-like line when the line navigates.
 *
 * This is the whole mechanism behind the `prefix-constant` refusal: `/api/auth` is
 * a `PUBLIC_PREFIXES` member consumed by `startsWith`, 89 lines below its
 * declaration, so "is this an argument to startsWith?" is not decidable
 * line-locally. "Does this line navigate?" is, and it is the question that matters
 * — the class exists for a string nobody navigates to.
 */
const HREF_LIKE_LINE = /href|<Link|redirect\(|router\.(push|replace)|NextResponse\.redirect|callbackUrl|new URL\(/;

function referenceContext(lineText) {
  return HREF_LIKE_LINE.test(lineText) ? 'href-like' : 'plain';
}

/**
 * One pass over one application's sources, comment-stripped.
 *
 * Memoised by root because `extractLiteralLinks` and `extractTemplateLinks` are
 * separate public exports the guard spec drives independently, and stripping 350
 * files twice per run is pure waste.
 */
const SCAN_CACHE = new Map();

function scanApp(srcDir) {
  const root = srcDir || (discoverNextApps()[0] || {}).srcDir;
  if (!root) return { targets: [], templates: [] };
  const cached = SCAN_CACHE.get(root);
  if (cached) return cached;

  const targets = [];
  const templates = [];

  for (const file of walkSources(root)) {
    const source = readFileSync(file, 'utf8');
    const executable = stripCommentsPreservingLines(source);
    const where = rel(file);

    const lines = executable.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].replace(/\r$/, '');
      LITERAL_LINK.lastIndex = 0;
      let match = LITERAL_LINK.exec(line);
      while (match) {
        const value = normalizeTarget(match[2]);
        if (isInternalRouteTarget(value)) {
          targets.push({ target: value, file: where, line: i + 1, context: referenceContext(line) });
        }
        match = LITERAL_LINK.exec(line);
      }
    }

    // Line numbers from offsets, because a multi-line template's `line` must be
    // the line it OPENS on — that is where a reader looks, and it is also the line
    // whose text decides `context`.
    const lineStarts = [0];
    for (let i = 0; i < executable.length; i++) {
      if (executable[i] === '\n') lineStarts.push(i + 1);
    }
    const lineOf = (offset) => {
      let low = 0;
      let high = lineStarts.length - 1;
      while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        if (lineStarts[mid] <= offset) low = mid;
        else high = mid - 1;
      }
      return low + 1;
    };
    const textOf = (offset) => {
      const index = lineOf(offset) - 1;
      return (executable.slice(lineStarts[index]).split('\n')[0] || '').replace(/\r$/, '');
    };

    const scanned = scanTemplateLiterals(executable);

    for (const open of scanned.unterminated) {
      if (!open.raw.startsWith('/')) continue;
      templates.push({
        raw: open.raw.slice(0, 80),
        file: where,
        line: lineOf(open.index),
        kind: 'unparsed',
      });
    }

    for (const template of scanned.templates) {
      if (!template.raw.startsWith('/')) continue;
      const line = lineOf(template.index);
      const context = referenceContext(textOf(template.index));
      const resolved = expandTemplateTarget(template.raw, executable);

      if (resolved.kind === 'unparsed') {
        templates.push({ raw: template.raw.slice(0, 80), file: where, line, kind: 'unparsed' });
        continue;
      }

      if (resolved.kind === 'shape') {
        if (!isTemplateShapeInScope(resolved.pattern)) continue;
        templates.push({
          raw: template.raw,
          file: where,
          line,
          kind: 'shape',
          pattern: resolved.pattern,
          vars: resolved.vars,
        });
        continue;
      }

      const expansions = resolved.expansions.filter(isInternalRouteTarget);
      if (expansions.length === 0) continue;
      templates.push({
        raw: template.raw,
        file: where,
        line,
        kind: 'expanded',
        expansions,
        vars: resolved.vars,
      });
      for (const target of expansions) {
        targets.push({ target, file: where, line, context });
      }
    }
  }

  const result = { targets, templates };
  SCAN_CACHE.set(root, result);
  return result;
}

/**
 * Every literal internal link target in one Next application's sources: the
 * comment-stripped quoted literals, PLUS every union expansion of a template
 * literal.
 *
 * The `{ target, file, line }` shape is unchanged and every emitted target is a
 * fully-resolved string — an expansion of a declared union is as literal as a
 * quoted one, which is why a widened extractor can feed the existing classifier
 * without a second code path. Unresolved templates never come out of here; they
 * come out of `extractTemplateLinks`, so this function cannot start emitting a
 * target containing a backtick or `${`.
 *
 * Positions are reported repo-relative with forward slashes, and the captured
 * value can never carry a trailing carriage return: on a CRLF checkout — and
 * this repository is developed on Windows — a line-anchored capture that let
 * `\r` through would silently turn every single link dead while the gate
 * reported a precise-looking failure for all of them.
 */
function extractLiteralLinks(srcDir) {
  return scanApp(srcDir).targets;
}

/**
 * Every `/`-leading template literal, with what became of it. One row per site,
 * always, so `templateRows === expanded + shape + unparsed` can be checked.
 */
function extractTemplateLinks(srcDir) {
  return scanApp(srcDir).templates;
}

/* ------------------------------------------------------------------ *
 * The gate's verdict
 * ------------------------------------------------------------------ */

/**
 * The baseline is keyed on the TARGET and nothing else.
 *
 * Never on file plus line: `sidebar-items.ts` and `TopbarUserMenu.tsx` are
 * edited constantly, and a line-keyed ceiling turns red on every unrelated edit
 * above a link.
 */
function normalizeBaseline(raw) {
  const root = raw || {};
  const container = root.dead || root.entries || root.targets;
  if (Array.isArray(container)) return container.map((entry) => ({ ...entry }));
  if (container && typeof container === 'object') {
    return Object.entries(container).map(([target, value]) => ({ target, ...(value || {}) }));
  }
  return [];
}

/** The same ceiling, for shape-checked patterns. Same key discipline, same rules. */
function normalizeShapeBaseline(raw) {
  const container = (raw || {}).deadShapes;
  if (Array.isArray(container)) return container.map((entry) => ({ ...entry }));
  if (container && typeof container === 'object') {
    return Object.entries(container).map(([pattern, value]) => ({ pattern, ...(value || {}) }));
  }
  return [];
}

function indent(text, spaces = 8) {
  const pad = ' '.repeat(spaces);
  return String(text)
    .split('\n')
    .map((l) => pad + l)
    .join('\n');
}

function citations(entries) {
  return indent(entries.slice(0, 6).map((e) => `- ${e.file}:${e.line}`).join('\n'));
}

/**
 * Classify FIRST, reconcile SECOND.
 *
 * The precedence is load-bearing, not stylistic: a target that was baselined as
 * dead and has since become a capture must fail AS a capture. Reporting it as
 * "now alive, remove the entry" would tell the reader to delete the only written
 * record of a live defect.
 *
 * `templates` and `deadShapes` are optional so every pre-S-E06-5 call site stays
 * valid; passing neither reduces this to exactly the behaviour it had.
 */
function classifyAll(input) {
  const targets = (input && input.targets) || [];
  const routes = (input && input.routes) || [];
  const baseline = (input && input.baseline) || [];
  const templates = (input && input.templates) || [];
  const deadShapes = (input && input.deadShapes) || [];

  const problems = [];
  const byTarget = new Map();
  for (const entry of targets) {
    const list = byTarget.get(entry.target) || [];
    list.push(entry);
    byTarget.set(entry.target, list);
  }

  const baselineByTarget = new Map();
  for (const entry of baseline) baselineByTarget.set(entry.target, entry);

  const expandedRows = templates.filter((row) => row.kind === 'expanded');
  const shapeRows = templates.filter((row) => row.kind === 'shape');
  const unparsedRows = templates.filter((row) => row.kind === 'unparsed');

  const stats = {
    filesScanned: new Set(targets.map((t) => t.file)).size,
    targets: byTarget.size,
    alive: 0,
    dead: 0,
    captures: 0,
    baselined: 0,
    prefixConstants: 0,
    deadDebt: 0,
    templateRows: templates.length,
    expanded: expandedRows.length,
    shapeChecked: shapeRows.length,
    unparsed: unparsedRows.length,
    shapes: new Set(shapeRows.map((row) => row.pattern)).size,
    deadShapes: 0,
  };

  // The anti-drop invariant, checked rather than trusted. Every template row is
  // one of three kinds; if the arithmetic ever stops holding, a refactor has begun
  // discarding sites, which is the failure PF-97 was.
  if (stats.templateRows !== stats.expanded + stats.shapeChecked + stats.unparsed) {
    problems.push(
      `TEMPLATE ROWS DO NOT RECONCILE — ${stats.templateRows} template literals were read but\n` +
        `        ${stats.expanded} expanded + ${stats.shapeChecked} shape-checked + ${stats.unparsed} unparsed accounts for\n` +
        `        only ${stats.expanded + stats.shapeChecked + stats.unparsed} of them. Some interpolated href is being DROPPED, which is\n` +
        `        exactly the blindness this gate was widened to close (PF-97).`,
    );
  }

  for (const row of unparsedRows) {
    problems.push(
      `UNPARSED TEMPLATE LITERAL — ${row.file}:${row.line} opens a path template that could\n` +
        `        not be parsed: \`${row.raw}\`. A check that cannot read a site must FAIL, never\n` +
        `        skip it (DNC-08).`,
    );
  }

  const seenInSource = new Set();

  for (const [target, references] of [...byTarget.entries()].sort()) {
    seenInSource.add(target);
    const { verdict, template } = resolveTarget(target, routes);
    const entry = baselineByTarget.get(target);

    if (verdict === 'dynamic-capture') {
      stats.captures++;
      problems.push(
        `DYNAMIC CAPTURE — ${target} resolves ONLY because the dynamic segment of\n` +
          `        ${template} swallowed a literal segment. The link looks alive to a\n` +
          `        route-existence check and lands on the wrong page at runtime (PF-19).\n` +
          `        This is NOT baselineable: create the real route, or change the link.\n` +
          citations(references),
      );
      continue;
    }

    if (verdict === 'dead') {
      stats.dead++;
      if (!entry) {
        stats.deadDebt++;
        problems.push(
          `DEAD LINK — ${target} matches no emitted route.\n` +
            `        Fix the link or the route. If it is a known gap owned by another\n` +
            `        slice, enter it in scripts/link-integrity-baseline.json with a reason\n` +
            `        AND the finding id that owns the fix.\n` +
            citations(references),
        );
        continue;
      }
      stats.baselined++;
      const reason = String(entry.reason || '').trim();
      const finding = String(entry.finding || '').trim();
      if (reason === '') {
        problems.push(
          `BASELINE ENTRY WITHOUT A REASON — ${target} in scripts/link-integrity-baseline.json.\n` +
            `        An entry with no reason is a silence, not a queue.`,
        );
      }
      if (!/^(PF|R|VAL|D)-\d+$/.test(finding)) {
        problems.push(
          `BASELINE ENTRY WITHOUT AN OWNING FINDING — ${target} in\n` +
            `        scripts/link-integrity-baseline.json carries no finding id, so nothing\n` +
            `        anywhere is committed to fixing it.`,
        );
      }

      // The `prefix-constant` class, and the reason it cannot become a quieter
      // baseline. A row tagged this way stops counting as dead DEBT, because there
      // is nothing to queue: nobody will ever create `/api/auth` (its
      // `[...nextauth]` catch-all needs at least one segment) and nobody navigates
      // to `/favicon`. So the tag is honoured only while NO reference to the target
      // navigates. One href-like line and the classification is refused BY NAME —
      // reason and owning finding are still required either way, so the row cannot
      // be quieter than an ordinary one, only differently counted.
      if (String(entry.class || '') === 'prefix-constant') {
        const navigating = references.filter((r) => r.context === 'href-like');
        if (navigating.length === 0) {
          stats.prefixConstants++;
          continue;
        }
        problems.push(
          `PREFIX-CONSTANT CLASSIFICATION REFUSED — ${target} is referenced as an href at\n` +
            `        ${navigating[0].file}:${navigating[0].line}.\n` +
            `        The class is for a string used only as a prefix. It is not a quieter baseline.\n` +
            citations(navigating),
        );
      }
      stats.deadDebt++;
      continue;
    }

    stats.alive++;
    if (entry) {
      problems.push(
        `BASELINED BUT ALIVE — ${target} now resolves (${verdict}).\n` +
          `        The ceiling only comes down: remove the entry from\n` +
          `        scripts/link-integrity-baseline.json and close ${entry.finding || 'its finding'}.\n` +
          `        This is not a regression — it is a fix that was not recorded.`,
      );
    }
  }

  for (const entry of baseline) {
    if (seenInSource.has(entry.target)) continue;
    problems.push(
      `STALE BASELINE ENTRY — ${entry.target} is no longer linked from anywhere in the\n` +
        `        sources. Remove it from scripts/link-integrity-baseline.json: a ceiling\n` +
        `        nobody stands under silently re-authorises the target the day someone\n` +
        `        links it again.`,
    );
  }

  /* ---------------------------------------------------------------- *
   * The shapes — reported on PASS as well as FAIL, held to the same
   * four rules as a target
   * ---------------------------------------------------------------- */

  const byPattern = new Map();
  for (const row of shapeRows) {
    const list = byPattern.get(row.pattern) || [];
    list.push(row);
    byPattern.set(row.pattern, list);
  }

  const shapeBaseline = new Map();
  for (const entry of deadShapes) shapeBaseline.set(entry.pattern, entry);

  const patterns = [];
  const seenShapes = new Set();

  for (const [pattern, sites] of [...byPattern.entries()].sort()) {
    seenShapes.add(pattern);
    const verdict = classifyPattern(pattern, routes);
    const entry = shapeBaseline.get(pattern);
    patterns.push({ pattern, verdict, sites: sites.length, vars: [...new Set(sites.flatMap((s) => s.vars || []))] });

    if (verdict === 'shape-dead') {
      stats.deadShapes++;
      if (!entry) {
        problems.push(
          `DEAD LINK SHAPE — no emitted route has the shape ${pattern}, at that depth.\n` +
            `        An interpolated href of this shape cannot resolve for ANY value of its\n` +
            `        variable${(sites[0].vars || []).length > 1 ? 's' : ''} (${(sites[0].vars || []).join(', ') || '?'}).\n` +
            `        Fix the link or the route. If it is a known gap owned by another slice,\n` +
            `        enter it under "deadShapes" in scripts/link-integrity-baseline.json with a\n` +
            `        reason AND the finding id that owns the fix.\n` +
            citations(sites),
        );
        continue;
      }
      const reason = String(entry.reason || '').trim();
      const finding = String(entry.finding || '').trim();
      if (reason === '') {
        problems.push(
          `BASELINE SHAPE WITHOUT A REASON — ${pattern} in scripts/link-integrity-baseline.json.\n` +
            `        An entry with no reason is a silence, not a queue.`,
        );
      }
      if (!/^(PF|R|VAL|D)-\d+$/.test(finding)) {
        problems.push(
          `BASELINE SHAPE WITHOUT AN OWNING FINDING — ${pattern} in\n` +
            `        scripts/link-integrity-baseline.json carries no finding id, so nothing\n` +
            `        anywhere is committed to fixing it.`,
        );
      }
      continue;
    }

    if (entry) {
      problems.push(
        `BASELINED SHAPE BUT ALIVE — ${pattern} now matches an emitted route.\n` +
          `        The ceiling only comes down: remove the entry from the "deadShapes" section\n` +
          `        of scripts/link-integrity-baseline.json and close ${entry.finding || 'its finding'}.`,
      );
    }
  }

  for (const entry of deadShapes) {
    if (seenShapes.has(entry.pattern)) continue;
    problems.push(
      `STALE BASELINE SHAPE — ${entry.pattern} is no longer produced by any template\n` +
        `        literal in the sources. Remove it from the "deadShapes" section of\n` +
        `        scripts/link-integrity-baseline.json: a ceiling nobody stands under silently\n` +
        `        re-authorises the shape the day someone writes it again.`,
    );
  }

  return { problems, stats, patterns };
}

/* ------------------------------------------------------------------ *
 * CLI
 * ------------------------------------------------------------------ */

function loadBaselineFile() {
  if (!existsSync(BASELINE_PATH)) return null;
  return JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
}

const BASELINE_COMMENT =
  'Dead internal link targets, read off the EMITTED Next.js route inventory ' +
  '(.next/app-path-routes-manifest.json) by scripts/link-integrity-check.js, never off the app/ ' +
  'directory tree. Regenerate deliberately with `node scripts/link-integrity-check.js --update`; ' +
  'the diff is meant to be reviewed. A dynamic capture can never appear here — it is always a ' +
  'failure and --update refuses to record one.';

const BASELINE_DOC = [
  'Dead internal link targets tolerated until their owning finding is closed.',
  'This list may only ever SHRINK.',
  'Every entry carries the finding id that owns the fix, so nothing here is "silenced" — it is queued.',
  'An entry whose target resolves again, or that nothing links to any more, is a FAILURE: remove it.',
  '"class": "prefix-constant" marks a target referenced ONLY as a string prefix that nothing will ever create; it stops counting as dead DEBT but still carries a reason and an owning finding, and the gate REFUSES the class by file:line if any reference to it sits on an href-like line.',
  '"deadShapes" is the same ceiling for interpolated hrefs that could not be resolved to concrete targets, keyed on the shape (`/admin/guardians/*`) and held to the same four rules.',
];

/**
 * Read one application's emitted inventory.
 *
 * A missing or empty manifest is a structural failure, never a skip: it is the
 * exact state in which every check below would vacuously pass, which is the
 * R-25 shape the sibling web artefact gate exists for.
 */
function readInventory(app) {
  const structural = [];
  if (!existsSync(join(app.dir, '.next'))) {
    structural.push(`${app.id} — no build output at ${rel(join(app.dir, '.next'))}; run \`pnpm build\` first`);
    return { routes: [], structural };
  }
  if (!existsSync(app.manifestPath)) {
    structural.push(`${app.id} — ${rel(app.manifestPath)} is missing; no app-router routes were emitted`);
    return { routes: [], structural };
  }
  const manifest = JSON.parse(readFileSync(app.manifestPath, 'utf8'));
  const routes = Object.values(manifest);
  if (routes.length === 0) {
    structural.push(`${app.id} — ${rel(app.manifestPath)} is empty; the build emitted no routes`);
  }
  return { routes, structural };
}

function printHelp() {
  const lines = [
    'link-integrity-check.js — literal internal links vs the EMITTED route inventory (S-E06-3, PF-19)',
    '',
    '  node scripts/link-integrity-check.js',
    '      Gate. Exits 1 on a new dead link, on any dynamic capture, on a baselined',
    '      target that is alive again or no longer referenced, and on a baseline entry',
    '      missing its reason or its owning finding.',
    '',
    '      Template-literal hrefs are read too (S-E06-5, PF-97). One that interpolates',
    '      a variable with a declared union of string literals is EXPANDED and each',
    '      expansion judged like any other link; one that cannot be resolved is',
    '      SHAPE-checked, printed with its site count, and fails unless its shape is',
    '      baselined under "deadShapes"; one that cannot be parsed at all is a',
    '      structural failure. Nothing is dropped silently — that silence was the bug.',
    '',
    '      A baseline row may carry "class": "prefix-constant" for a target referenced',
    '      only as a string prefix that nothing will ever create. It stops counting as',
    '      dead debt, and the classification is REFUSED by file and line if any',
    '      reference to the target sits on an href-like line.',
    '',
    '  node scripts/link-integrity-check.js --update',
    '      Rewrite the reviewed ceiling at scripts/link-integrity-baseline.json.',
    '      Refuses to write from a structurally broken artefact, and refuses to record',
    '      a dynamic capture. Carries an existing row\'s class, reason and finding over.',
  ];
  console.log(lines.join('\n'));
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help')) {
    printHelp();
    return;
  }
  const update = argv.includes('--update');

  const apps = discoverNextApps();
  if (apps.length === 0) {
    console.error('✗ link integrity check found no Next.js applications — discovery is broken, not the repo');
    process.exit(1);
  }

  const baselineRaw = loadBaselineFile();
  if (!baselineRaw && !update) {
    console.error(`✗ missing ${rel(BASELINE_PATH)} — run \`node scripts/link-integrity-check.js --update\``);
    process.exit(1);
  }
  const baseline = normalizeBaseline(baselineRaw);
  const deadShapes = normalizeShapeBaseline(baselineRaw);

  const failures = [];
  const structuralFailures = [];
  const unwritable = [];
  const deadForBaseline = new Map();
  const deadShapesForBaseline = new Map();
  const shapeReports = [];

  for (const app of apps) {
    process.stdout.write(`▶ ${app.id} … `);
    const { routes, structural } = readInventory(app);
    if (structural.length > 0) {
      console.log('FAILED');
      structuralFailures.push(...structural);
      continue;
    }

    const targets = extractLiteralLinks(app.srcDir);
    const templates = extractTemplateLinks(app.srcDir);
    const { problems, stats, patterns } = classifyAll({ targets, routes, baseline, templates, deadShapes });
    console.log(
      `${routes.length} routes · ${stats.targets} literal targets · ` +
        `${stats.alive} alive · ${stats.dead} dead (${stats.baselined} baselined) · ` +
        `${stats.captures} captures`,
    );
    console.log(
      `              · ${stats.templateRows} interpolated (${stats.expanded} union-expanded · ` +
        `${stats.shapeChecked} shape-checked over ${stats.shapes} shapes · ` +
        `${stats.prefixConstants} prefix-constants)`,
    );
    for (const problem of problems) failures.push(`${app.id} — ${problem}`);
    shapeReports.push({ app: app.id, patterns });

    // Collected for `--update` only. In gate mode these same two facts are
    // already reported, with citations, by classifyAll — listing them twice
    // would make one defect read as two.
    for (const entry of targets) {
      const { verdict } = resolveTarget(entry.target, routes);
      if (verdict === 'dead') deadForBaseline.set(entry.target, entry);
      if (verdict === 'dynamic-capture') {
        unwritable.push(`${app.id} — ${entry.target} is a dynamic capture (${entry.file}:${entry.line})`);
      }
    }
    for (const row of patterns) {
      if (row.verdict === 'shape-dead') deadShapesForBaseline.set(row.pattern, row);
    }
  }

  if (update) {
    const refusals = [...structuralFailures, ...unwritable];
    if (refusals.length > 0) {
      console.error('\n✗ refusing to write the baseline: the artefact is not intact, or a capture is present.');
      for (const problem of refusals) console.error(`\n  ${problem}`);
      console.error('\n  A baseline recorded from a broken build freezes the breakage into the reviewed');
      console.error('  inventory, and a dynamic capture is never baselineable.\n');
      process.exit(1);
    }

    const known = new Map(baseline.map((entry) => [entry.target, entry]));
    const dead = {};
    const unexplained = [];
    for (const target of [...deadForBaseline.keys()].sort()) {
      const previous = known.get(target);
      dead[target] = {
        finding: (previous && previous.finding) || '',
        reason: (previous && previous.reason) || '',
      };
      // Carried, never dropped: `--update` regenerating over a reviewed file must
      // not silently strip the classification a human entered — that is the shape
      // of edit that turns a reviewed inventory back into a generated one.
      if (previous && previous.class) dead[target].class = previous.class;
      if (!previous) unexplained.push(target);
    }

    const knownShapes = new Map(deadShapes.map((entry) => [entry.pattern, entry]));
    const shapes = {};
    for (const pattern of [...deadShapesForBaseline.keys()].sort()) {
      const previous = knownShapes.get(pattern);
      shapes[pattern] = {
        finding: (previous && previous.finding) || '',
        reason: (previous && previous.reason) || '',
      };
      if (!previous) unexplained.push(pattern);
    }

    const next = {
      $comment: BASELINE_COMMENT,
      $doc: BASELINE_DOC,
      dead,
      deadShapes: shapes,
    };
    writeFileSync(BASELINE_PATH, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    console.log(`\n✎ baseline rewritten: ${rel(BASELINE_PATH)}`);
    if (unexplained.length > 0) {
      console.log('\n  New entries were written WITHOUT a finding or a reason. The gate stays red');
      console.log('  until a human supplies both — that refusal is the point of the ratchet:');
      for (const target of unexplained) console.log(`    - ${target}`);
    }
    return;
  }

  // Printed on PASS as well as on FAIL, and that verbosity is deliberate: it is
  // the discharge of "reported, never dropped". Every interpolated href this gate
  // could not resolve to concrete targets is listed here, so the blind spot is
  // enumerated in the run output instead of being invisible (DNC-08).
  for (const report of shapeReports) {
    if (report.patterns.length === 0) continue;
    console.log(`\n  interpolated href shapes — ${report.app} (a shape proves depth and form, not the runtime value)`);
    for (const row of report.patterns) {
      const mark = row.verdict === 'shape-alive' ? '·' : '✗';
      const vars = row.vars.length > 0 ? `  ← ${row.vars.slice(0, 3).join(', ')}` : '';
      console.log(`    ${mark} ${row.pattern}  (${row.sites} site${row.sites === 1 ? '' : 's'})${vars}`);
    }
  }

  const all = [...structuralFailures, ...failures];
  if (all.length > 0) {
    console.error('\n══════════════════════════════════════════════════════════════');
    console.error('  LINK INTEGRITY CHECK: FAIL');
    console.error('══════════════════════════════════════════════════════════════');
    for (const problem of all) console.error(`\n✗ ${problem}`);
    console.error('');
    process.exit(1);
  }

  console.log('\nLINK INTEGRITY CHECK: PASS — every literal internal link resolves, or is baselined with an owner');
}

module.exports = {
  classifyTarget,
  classifyPattern,
  extractLiteralLinks,
  extractTemplateLinks,
  expandTemplateTarget,
  resolveDeclaredUnion,
  stripCommentsPreservingLines,
  classifyAll,
  discoverNextApps,
  normalizeBaseline,
  normalizeShapeBaseline,
};

if (require.main === module) main();
