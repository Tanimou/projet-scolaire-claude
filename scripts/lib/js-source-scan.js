/**
 * S-E01-1k / ADR-059 §D1 — THE ONE DELIMITER MATCHER, extracted so there is
 * exactly one of it.
 *
 * WHY THIS FILE EXISTS AT ALL. `scripts/tenant-adversarial-check.js` already
 * owned a string-, comment-, regex- and template-aware paren matcher
 * (`matchingParen`), and this slice needs the SAME lexer to
 *
 *   - find the balanced `Object.freeze( … )` segment of a TypeScript constant
 *     (`app-role-closure.js`), and
 *   - walk the balanced `{ … }` argument object of a Prisma call site.
 *
 * Writing a second matcher for `{`/`[` would have been this slice's own disease:
 * TOOL-39 is on the ledger precisely because ONE matcher, fed a docblock with an
 * unbalanced parenthesis, silently zeroed a whole file's coverage. Two matchers
 * would have made that failure mode plural. So the matcher is GENERALISED over
 * the three delimiter pairs and MOVED here; `tenant-adversarial-check.js`
 * re-exports it unchanged, and `matchingParen(text, i)` is byte-for-byte the
 * function it was when `text[i] === '('`.
 *
 * Everything here is PURE — text in, indices out. No filesystem, no database, no
 * repository scan. That is the house division of labour stated verbatim on
 * `scripts/tenant-scope-deployment-check.js:53-60`, and it is what lets
 * `apps/api/src/shared/quality/tenant-adversarial-gate.spec.ts` drive the
 * pathological branches (a `)` inside a string, a `(` inside a regex, an
 * unterminated template) without touching the tree.
 *
 * FAIL-CLOSED IS THE WHOLE CONTRACT (DNC-08): every function here returns **-1**
 * when it loses its place, never a guess. The caller's rule for -1 is to REPORT
 * and to count the construct as unknown. Under-reporting is a limit;
 * over-reporting is a lie.
 */

'use strict';

/**
 * Where a `/` may legally begin a REGEX LITERAL rather than a division.
 *
 * This is the standard preceding-token heuristic, and it is here for one reason:
 * a `(` or `)` inside a regex literal must not move the brace matcher's depth.
 * The failure it prevents is not cosmetic — see `matchingDelimiter`.
 */
function startsRegexLiteral(previousSignificant) {
  return previousSignificant === '' || '(,=:[!&|?{};+-*%^~<>'.includes(previousSignificant);
}

/** The closing quote of a `'…'` / `"…"` literal, or -1 if it does not close. */
function skipQuoted(text, start, quote) {
  for (let i = start + 1; i < text.length; i += 1) {
    const c = text[i];
    if (c === '\\') {
      i += 1;
      continue;
    }
    if (c === quote) return i;
    // A newline inside a single/double-quoted literal means the lexer has lost
    // its place. Bail rather than run to EOF: see `matchingDelimiter`'s
    // fail-closed rule.
    if (c === '\n') return -1;
  }
  return -1;
}

/** The closing `/` of a regex literal, character classes included, or -1. */
function skipRegexLiteral(text, start) {
  for (let i = start + 1; i < text.length; i += 1) {
    const c = text[i];
    if (c === '\\') {
      i += 1;
      continue;
    }
    if (c === '[') {
      // Inside a character class `/` and `)` are literal and `]` is the exit.
      for (i += 1; i < text.length; i += 1) {
        if (text[i] === '\\') {
          i += 1;
          continue;
        }
        if (text[i] === ']') break;
        if (text[i] === '\n') return -1;
      }
      continue;
    }
    if (c === '/') return i;
    if (c === '\n') return -1;
  }
  return -1;
}

/** The closing backtick of a template literal, `${…}` substitutions included. */
function skipTemplateLiteral(text, start) {
  for (let i = start + 1; i < text.length; i += 1) {
    const c = text[i];
    if (c === '\\') {
      i += 1;
      continue;
    }
    if (c === '`') return i;
    if (c === '$' && text[i + 1] === '{') {
      let depth = 1;
      i += 2;
      for (; i < text.length; i += 1) {
        const d = text[i];
        if (d === '\\') {
          i += 1;
          continue;
        }
        if (d === '`') {
          const end = skipTemplateLiteral(text, i);
          if (end === -1) return -1;
          i = end;
          continue;
        }
        if (d === "'" || d === '"') {
          const end = skipQuoted(text, i, d);
          if (end === -1) return -1;
          i = end;
          continue;
        }
        if (d === '{') depth += 1;
        else if (d === '}') {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      if (i >= text.length) return -1;
      continue;
    }
  }
  return -1;
}

/** The three delimiter pairs this lexer knows. A CLOSED set: anything else is -1. */
const DELIMITERS = Object.freeze({ '(': ')', '[': ']', '{': '}' });

/**
 * The index of the delimiter matching the one at `openIndex`, or **-1**.
 *
 * A NAIVE DEPTH COUNTER OVER RAW TEXT IS NOT SAFE HERE, and the unsafe direction
 * is the silent one:
 *
 *  - a `)` inside a string closes the range EARLY, so sites really inside it are
 *    reported uncovered — noisy, and therefore self-correcting;
 *  - a `(` inside a string, a regex or a comment NEVER closes, so the range runs
 *    to END OF FILE and **every remaining Prisma call site in that file counts as
 *    covered**. That is mass phantom coverage, expressed as a number, which no
 *    reviewer sees. It is a manufactured green with no author.
 *
 * So strings, template literals (including `${…}`), regex literals and both
 * comment forms are skipped, and an unbalanced result is **-1** rather than a
 * guess. The caller's rule for -1 is FAIL-CLOSED: the file is REPORTED and every
 * site in it counts UNCOVERED. Under-reporting coverage is a limit; over-reporting
 * it is a lie.
 *
 * S-E01-1k — the depth is now counted on the pair NAMED BY `text[openIndex]`
 * rather than on `(`/`)` alone. When that character is `(` the behaviour is
 * identical to the shipped `matchingParen`, which is why that name survives as a
 * one-line alias instead of as a second implementation.
 */
function matchingDelimiter(text, openIndex) {
  const opener = text[openIndex];
  const closer = DELIMITERS[opener];
  if (closer === undefined) return -1;
  let depth = 0;
  let previousSignificant = '';
  for (let i = openIndex; i < text.length; i += 1) {
    const c = text[i];
    const next = text[i + 1];
    if (c === '/' && next === '/') {
      const eol = text.indexOf('\n', i);
      if (eol === -1) return -1;
      i = eol;
      continue;
    }
    if (c === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2);
      if (end === -1) return -1;
      i = end + 1;
      continue;
    }
    if (c === "'" || c === '"') {
      const end = skipQuoted(text, i, c);
      if (end === -1) return -1;
      i = end;
      previousSignificant = c;
      continue;
    }
    if (c === '`') {
      const end = skipTemplateLiteral(text, i);
      if (end === -1) return -1;
      i = end;
      previousSignificant = '`';
      continue;
    }
    if (c === '/' && startsRegexLiteral(previousSignificant)) {
      const end = skipRegexLiteral(text, i);
      if (end !== -1) {
        i = end;
        previousSignificant = '/';
        continue;
      }
    }
    if (c === opener) depth += 1;
    else if (c === closer) {
      depth -= 1;
      if (depth === 0) return i;
      if (depth < 0) return -1;
    }
    if (!/\s/.test(c)) previousSignificant = c;
  }
  return -1;
}

/** The shipped name, preserved so no caller and no spec has to change. */
function matchingParen(text, openIndex) {
  return matchingDelimiter(text, openIndex);
}

/**
 * The index of the next character that is neither whitespace nor a comment,
 * starting at `from`. Returns -1 at end of text or on an unterminated block
 * comment (fail-closed, as everywhere else here).
 */
function nextSignificantIndex(text, from) {
  for (let i = from; i < text.length; i += 1) {
    const c = text[i];
    if (/\s/.test(c)) continue;
    if (c === '/' && text[i + 1] === '/') {
      const eol = text.indexOf('\n', i);
      if (eol === -1) return -1;
      i = eol;
      continue;
    }
    if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      if (end === -1) return -1;
      i = end + 1;
      continue;
    }
    return i;
  }
  return -1;
}

/**
 * The PROPERTIES of the object literal whose `{` sits at `openIndex`, as a flat
 * list at ONE depth. Nested objects are returned as ranges, not walked — the
 * caller decides whether a nesting level means anything, which is the difference
 * between a lexer and a schema-aware walker.
 *
 * Returns `{ close, properties, problems }`:
 *  - `close` is -1 when the literal does not balance (the caller must fail);
 *  - each property is `{ key, computed, valueKind, valueStart, valueEnd, text }`
 *    with `valueKind` in {object, array, identifier, member, literal, spread,
 *    unknown};
 *  - `problems` NAMES every construct this lexer refuses to characterise, so a
 *    shorthand, a computed key or a spread is reported rather than skipped.
 *
 * `valueKind: 'unknown'` is never silently benign: it is the DNC-08 branch, and
 * every caller in this repository turns it into a named finding.
 */
function objectLiteralProperties(text, openIndex) {
  const problems = [];
  if (text[openIndex] !== '{') {
    return { close: -1, properties: [], problems: [{ kind: 'not-an-object-literal', at: openIndex }] };
  }
  const close = matchingDelimiter(text, openIndex);
  if (close === -1) {
    return { close: -1, properties: [], problems: [{ kind: 'unbalanced-object-literal', at: openIndex }] };
  }
  const properties = [];
  let i = openIndex + 1;
  while (i < close) {
    const start = nextSignificantIndex(text, i);
    if (start === -1 || start >= close) break;
    // `...IDENT` — a spread. Reported with its identifier so the caller can
    // resolve it or refuse it; never dropped.
    if (text.startsWith('...', start)) {
      // The WHOLE spread expression is consumed, not just a leading identifier.
      // Measured: `...(args.schoolId ? { schoolId: args.schoolId } : {})` at
      // `remediation.service.ts:547`. Reading only `...` and stopping made the
      // caller report an unresolvable reference on a construct whose object
      // literals are right there in the source.
      const stop = skipToNextProperty(text, start + 3, close);
      const body = text.slice(start + 3, stop).replace(/,\s*$/, '');
      const lead = body.length - body.replace(/^\s+/, '').length;
      const raw = body.trim();
      properties.push({
        key: null,
        computed: false,
        valueKind: 'spread',
        valueStart: start + 3 + lead,
        valueEnd: start + 3 + lead + raw.length,
        text: raw,
      });
      i = stop;
      continue;
    }
    // The key: a bare identifier, a quoted string, or a computed `[expr]`.
    let key = null;
    let computed = false;
    let cursor = start;
    const c = text[start];
    if (c === "'" || c === '"') {
      const end = skipQuoted(text, start, c);
      if (end === -1) {
        problems.push({ kind: 'unterminated-key-string', at: start });
        return { close, properties, problems };
      }
      key = text.slice(start + 1, end);
      cursor = end + 1;
    } else if (c === '[') {
      const end = matchingDelimiter(text, start);
      if (end === -1) {
        problems.push({ kind: 'unbalanced-computed-key', at: start });
        return { close, properties, problems };
      }
      computed = true;
      key = text.slice(start + 1, end).trim();
      cursor = end + 1;
    } else {
      const ident = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(text.slice(start));
      if (ident === null) {
        problems.push({ kind: 'unrecognised-property-start', at: start, text: text.slice(start, start + 24) });
        i = skipToNextProperty(text, start + 1, close);
        continue;
      }
      key = ident[0];
      cursor = start + ident[0].length;
    }
    const colon = nextSignificantIndex(text, cursor);
    if (colon === -1 || colon >= close || text[colon] !== ':') {
      // Shorthand (`{ tenantId }`) or a method. It carries no nested value, so
      // it can hold no relation — but it is REPORTED, because "I saw a shape I
      // do not model" and "there was nothing there" must never print the same.
      properties.push({
        key,
        computed,
        valueKind: 'shorthand',
        valueStart: start,
        valueEnd: cursor,
        text: key,
      });
      i = skipToNextProperty(text, cursor, close);
      continue;
    }
    const valueStart = nextSignificantIndex(text, colon + 1);
    if (valueStart === -1 || valueStart >= close) {
      problems.push({ kind: 'property-without-value', at: colon, key });
      break;
    }
    const v = text[valueStart];
    let valueEnd;
    let valueKind;
    if (v === '{' || v === '[' || v === '(') {
      valueEnd = matchingDelimiter(text, valueStart);
      if (valueEnd === -1) {
        problems.push({ kind: 'unbalanced-property-value', at: valueStart, key });
        return { close, properties, problems };
      }
      valueEnd += 1;
      valueKind = v === '{' ? 'object' : v === '[' ? 'array' : 'parenthesised';
    } else if (v === "'" || v === '"') {
      const end = skipQuoted(text, valueStart, v);
      if (end === -1) {
        problems.push({ kind: 'unterminated-value-string', at: valueStart, key });
        return { close, properties, problems };
      }
      valueEnd = end + 1;
      valueKind = 'literal';
    } else if (v === '`') {
      const end = skipTemplateLiteral(text, valueStart);
      if (end === -1) {
        problems.push({ kind: 'unterminated-template', at: valueStart, key });
        return { close, properties, problems };
      }
      valueEnd = end + 1;
      valueKind = 'literal';
    } else {
      const stop = skipToNextProperty(text, valueStart, close);
      const raw = text.slice(valueStart, stop).trim().replace(/,$/, '').trim();
      valueEnd = valueStart + raw.length;
      if (/^(true|false|null|undefined|-?\d[\d_.eE+-]*)$/.test(raw)) valueKind = 'literal';
      else if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(raw)) valueKind = 'identifier';
      else if (/^[A-Za-z_$][A-Za-z0-9_$.]*$/.test(raw)) valueKind = 'member';
      else valueKind = 'unknown';
    }

    // `why: 'a…' + 'b…'` spans lines in the shipped constants this lexer is
    // pointed at. Reading only the FIRST operand truncated one measured reason
    // to 78 of its 214 characters, which would have made the anti-vacuity guard
    // judge a sentence it never saw. So a `+` chain is consumed whole and
    // reported as one `concatenation` value.
    let after = nextSignificantIndex(text, valueEnd);
    while (after !== -1 && after < close && text[after] === '+' && text[after + 1] !== '+') {
      const operand = nextSignificantIndex(text, after + 1);
      if (operand === -1 || operand >= close) break;
      const o = text[operand];
      let end;
      if (o === "'" || o === '"') end = skipQuoted(text, operand, o);
      else if (o === '`') end = skipTemplateLiteral(text, operand);
      else if (o === '(' || o === '[' || o === '{') end = matchingDelimiter(text, operand);
      else {
        const ident = /^[A-Za-z0-9_$.]+/.exec(text.slice(operand));
        end = ident === null ? -1 : operand + ident[0].length - 1;
      }
      if (end === -1) {
        problems.push({ kind: 'unbalanced-concatenation-operand', at: operand, key });
        break;
      }
      valueEnd = end + 1;
      valueKind = 'concatenation';
      after = nextSignificantIndex(text, valueEnd);
    }

    properties.push({
      key,
      computed,
      valueKind,
      valueStart,
      valueEnd,
      text: text.slice(valueStart, valueEnd),
    });
    i = skipToNextProperty(text, valueEnd, close);
  }
  return { close, properties, problems };
}

/**
 * The index just past the comma that ends the current property, bounded by
 * `limit`. Nested delimiters and every literal form are skipped, so a comma
 * inside `{ a: [1, 2] }` or inside `'a, b'` never splits a property.
 */
function skipToNextProperty(text, from, limit) {
  for (let i = from; i < limit; i += 1) {
    const c = text[i];
    const next = text[i + 1];
    if (c === '/' && next === '/') {
      const eol = text.indexOf('\n', i);
      if (eol === -1 || eol >= limit) return limit;
      i = eol;
      continue;
    }
    if (c === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2);
      if (end === -1 || end >= limit) return limit;
      i = end + 1;
      continue;
    }
    if (c === "'" || c === '"') {
      const end = skipQuoted(text, i, c);
      if (end === -1) return limit;
      i = end;
      continue;
    }
    if (c === '`') {
      const end = skipTemplateLiteral(text, i);
      if (end === -1) return limit;
      i = end;
      continue;
    }
    if (c === '(' || c === '[' || c === '{') {
      const end = matchingDelimiter(text, i);
      if (end === -1) return limit;
      i = end;
      continue;
    }
    if (c === ',') return i + 1;
  }
  return limit;
}

module.exports = {
  DELIMITERS,
  matchingDelimiter,
  matchingParen,
  nextSignificantIndex,
  objectLiteralProperties,
  skipQuoted,
  skipRegexLiteral,
  skipTemplateLiteral,
  skipToNextProperty,
  startsRegexLiteral,
};
