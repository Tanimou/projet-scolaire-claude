/**
 * S-E01-1k / ADR-059 §D1 — READ the declared closure, never re-type it.
 *
 * `APP_ROLE_REQUIRED_PRIVILEGES` lives in `apps/api/src/shared/prisma/tenant-scope.ts`
 * and is consumed at boot by `appRoleVerdict`. This slice compares it against a
 * set DERIVED from the corpus, and the comparison is only worth anything if the
 * declared side is the SAME list the application boots on. So it is PARSED FROM
 * SOURCE.
 *
 * THREE ROADS WERE AVAILABLE AND TWO OF THEM ARE DEFECTS.
 * ------------------------------------------------------
 *  1. `require('apps/api/dist/shared/prisma/tenant-scope.js')` — the build
 *     artefact EXISTS in this tree, and agents are forbidden to build
 *     (GUARDRAILS §4). So `dist` is stale by construction: the check would
 *     compare the derivation against a list the source has already moved past
 *     and print green. That is PF-246 reproduced inside its own fix. **This file
 *     never reads `dist`, and the gate spec asserts it.**
 *  2. Re-typing the 38 pairs into this script — a THIRD hand-written list. Two
 *     hand-maintained lists is the disease PF-219 names; three is not a cure.
 *  3. Parsing the TypeScript source as TEXT. No precedent existed in
 *     `scripts/*.js` (measured: zero), so it is a new architectural decision and
 *     it carries an ADR. It is permitted because it preserves SINGLE SOURCE: one
 *     list, read.
 *
 * WHY A NAIVE SCAN BREAKS, measured on the real file: the `why` strings contain
 * typographic apostrophes (`’`), are concatenated across lines with `+`, and the
 * array holds comment blocks longer than the entries. So the segment is located
 * by the BALANCED `Object.freeze( … )` parenthesis using the repository's single
 * delimiter matcher, and entries are read as object literals through the same
 * lexer — never by counting quotes.
 *
 * FAIL-CLOSED IS THE CONTRACT (DNC-08). Zero entries parsed, an unfound
 * `Object.freeze(`, an entry missing `table`/`privilege`/`why`, a duplicate pair,
 * or a `why` that merely repeats the table or the verb — each is a NAMED problem
 * and the caller refuses the verdict. An empty declared set would otherwise make
 * the bidirectional comparison fire 38 phantom `dead-entry` findings, or pass
 * vacuously; both are worse than red.
 */

'use strict';

const {
  matchingDelimiter,
  matchingParen,
  nextSignificantIndex,
  objectLiteralProperties,
  skipQuoted,
  skipTemplateLiteral,
} = require('./js-source-scan');

/** The identifier this parser is aimed at. Named, so the aim cannot drift silently. */
const PAIR_KEY_SEPARATOR = String.fromCharCode(0);

const DECLARED_CONSTANT = 'APP_ROLE_REQUIRED_PRIVILEGES';

/**
 * The floor below which the parse is treated as failed rather than as a small
 * list. Measured: the list held 30 pairs at S-E01-1i and 37 at S-E01-1j, and it
 * only ever grows as modules convert. A wall, not a knob (DNC-10): there is no
 * env var and no argument that lowers it.
 */
const MIN_DECLARED_PAIRS = 30;

/**
 * `why` strings that say nothing. The guard already lives in `tenant-scope.ts`
 * (`:159-164`) and already refused three reasons in S-E01-1e; it is mirrored here
 * so a reason cannot be vacuous on the side the GATE reads either.
 */
function isVacuousReason(why, table, privilege) {
  const text = String(why ?? '').trim();
  if (text.length <= 10) return true;
  const normalised = text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const table_ = String(table).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const privilege_ = String(privilege).toLowerCase();
  return normalised === table_ || normalised === privilege_ || normalised === `${table_} ${privilege_}`;
}

/**
 * Parse `APP_ROLE_REQUIRED_PRIVILEGES` out of `tenant-scope.ts` source text.
 *
 * Returns `{ pairs, problems }` where each pair is `{ table, privilege, why,
 * key }` and `key` is `table<NUL>PRIVILEGE` (PAIR_KEY_SEPARATOR) — the SAME key shape the checker's
 * `required` Map uses, so the two sides are comparable without a translation
 * step that could itself drift.
 */
function parseAppRoleRequiredPrivileges(sourceText) {
  const text = String(sourceText ?? '');
  const problems = [];
  const pairs = [];

  const anchor = new RegExp(`${DECLARED_CONSTANT}\\s*:[^=]*=\\s*|${DECLARED_CONSTANT}\\s*=\\s*`, 'g');
  const declaration = anchor.exec(text);
  if (declaration === null) {
    problems.push({
      kind: 'constant-not-found',
      detail: `no declaration of ${DECLARED_CONSTANT} in the source read. The comparison would run against ` +
        'an empty declared set and report every derived pair as undeclared — refused instead.',
    });
    return { pairs, problems };
  }

  const afterName = declaration.index + declaration[0].length;
  const freezeAt = text.indexOf('Object.freeze(', afterName);
  if (freezeAt === -1 || freezeAt > afterName + 40) {
    problems.push({
      kind: 'object-freeze-boundary-not-found',
      detail:
        `${DECLARED_CONSTANT} is not initialised by an immediately following \`Object.freeze(\`. The parser ` +
        'refuses to guess the array boundaries: a wrong boundary silently truncates the declared list.',
    });
    return { pairs, problems };
  }
  const open = freezeAt + 'Object.freeze('.length - 1;
  const close = matchingParen(text, open);
  if (close === -1) {
    problems.push({
      kind: 'unbalanced-object-freeze',
      detail: '`Object.freeze(` does not close. Fail-closed rather than reading to end of file.',
    });
    return { pairs, problems };
  }

  const arrayOpen = nextSignificantIndex(text, open + 1);
  if (arrayOpen === -1 || text[arrayOpen] !== '[') {
    problems.push({
      kind: 'frozen-value-is-not-an-array',
      detail: '`Object.freeze(` is not immediately followed by an array literal.',
    });
    return { pairs, problems };
  }
  const arrayClose = matchingDelimiter(text, arrayOpen);
  if (arrayClose === -1 || arrayClose > close) {
    problems.push({
      kind: 'unbalanced-frozen-array',
      detail: 'the array literal inside `Object.freeze(` does not close before the call does.',
    });
    return { pairs, problems };
  }
  // `[` exclusive, `]` exclusive: the walk below refuses any token it does not
  // model, so leaving the closing bracket inside the segment would itself be a
  // named (and wrong) failure.
  const segment = text.slice(arrayOpen, arrayClose);

  // Every `{` at array depth opens one entry — and NOTHING ELSE may. A raw
  // `indexOf('{')` was the first draft and it was WRONG on the real file:
  // measured, it found three phantom entries inside `//` comments that quote a
  // Prisma filter (`assessment: { teachingAssignment: { subjectId } }`). Those
  // phantoms became three `entry-without-pair` problems, i.e. the parser
  // failing closed on its own prose. So the walk is driven by the shared lexer,
  // which skips comments and literals, and any token at array depth that is
  // neither an entry nor a comma is NAMED.
  const seen = new Map();
  let cursor = 1;
  while (cursor < segment.length) {
    const at = nextSignificantIndex(segment, cursor);
    if (at === -1 || at >= segment.length) break;
    const ch = segment[at];
    if (ch === ',') {
      cursor = at + 1;
      continue;
    }
    if (ch !== '{') {
      if (ch === '[' || ch === '(') {
        const end = matchingDelimiter(segment, at);
        if (end === -1) {
          problems.push({ kind: 'unbalanced-array-element', detail: `an element at offset ${at} does not close` });
          return { pairs, problems };
        }
        cursor = end + 1;
      } else if (ch === "'" || ch === '"') {
        const end = skipQuoted(segment, at, ch);
        cursor = end === -1 ? segment.length : end + 1;
      } else if (ch === '`') {
        const end = skipTemplateLiteral(segment, at);
        cursor = end === -1 ? segment.length : end + 1;
      } else {
        problems.push({
          kind: 'unexpected-token-in-array',
          detail:
            `\`${segment.slice(at, at + 24)}\` sits at array depth in ${DECLARED_CONSTANT} and is neither an ` +
            'entry nor a separator. Refused rather than passed over: a construct this parser does not model is ' +
            'exactly where a requirement would go missing.',
        });
        return { pairs, problems };
      }
      continue;
    }
    const literal = objectLiteralProperties(segment, at);
    if (literal.close === -1) {
      problems.push({
        kind: 'unbalanced-entry',
        detail: `an entry starting at offset ${at} of the frozen array does not close`,
      });
      return { pairs, problems };
    }
    cursor = literal.close + 1;
    const read = new Map();
    for (const property of literal.properties) {
      if (property.key === null) continue;
      if (property.valueKind === 'literal') {
        read.set(property.key, unquote(property.text));
      } else if (
        property.valueKind === 'concatenation' ||
        property.valueKind === 'unknown' ||
        property.valueKind === 'parenthesised'
      ) {
        // `why: '…' + '…'` across lines lands here. The VALUE still has to be
        // read, because a concatenated reason is the common shape in this file.
        read.set(property.key, unquoteConcatenation(property.text));
      } else {
        read.set(property.key, null);
      }
    }
    const table = read.get('table');
    const privilege = read.get('privilege');
    const why = read.get('why');
    if (typeof table !== 'string' || table.length === 0 || typeof privilege !== 'string' || privilege.length === 0) {
      problems.push({
        kind: 'entry-without-pair',
        detail:
          `an entry of ${DECLARED_CONSTANT} carries no readable (table, privilege): ` +
          `${JSON.stringify({ table, privilege })}. Skipping it would shrink the declared side and turn a ` +
          'real requirement into a phantom `undeclared-pair`.',
      });
      continue;
    }
    if (typeof why !== 'string' || why.trim().length === 0) {
      problems.push({
        kind: 'entry-without-reason',
        table,
        privilege,
        detail:
          `${table}.${privilege} carries no reason. This list is a list of REASONS: an entry without one ` +
          'certifies a closure nobody can audit.',
      });
    } else if (isVacuousReason(why, table, privilege)) {
      problems.push({
        kind: 'entry-with-vacuous-reason',
        table,
        privilege,
        detail:
          `${table}.${privilege} has a reason that merely repeats the table or the verb (${JSON.stringify(why)}). ` +
          'The anti-vacuity guard of tenant-scope.ts:159-164 refused three such reasons in S-E01-1e; it is ' +
          'mirrored here so the gate reads the same rule.',
      });
    }
    const key = `${table}${PAIR_KEY_SEPARATOR}${String(privilege).toUpperCase()}`;
    if (seen.has(key)) {
      problems.push({
        kind: 'duplicate-pair',
        table,
        privilege,
        detail:
          `${table}.${privilege} is declared twice. The comparison is a SET comparison, so a duplicate ` +
          'cannot fail it — it is named here instead of disappearing.',
      });
      continue;
    }
    const pair = { table, privilege: String(privilege).toUpperCase(), why: typeof why === 'string' ? why : '', key };
    seen.set(key, pair);
    pairs.push(pair);
  }

  if (pairs.length === 0) {
    problems.push({
      kind: 'no-entries-parsed',
      detail:
        `zero entries parsed from ${DECLARED_CONSTANT}. A parser that silently returns [] is a green light ` +
        'that proves nothing (AC-4).',
    });
  } else if (pairs.length < MIN_DECLARED_PAIRS) {
    problems.push({
      kind: 'declared-set-below-floor',
      detail:
        `only ${pairs.length} pair(s) parsed, below the non-vacuity floor of ${MIN_DECLARED_PAIRS}. The list ` +
        'held 30 pairs at S-E01-1i and 37 at S-E01-1j; a sudden collapse is a parse failure, not a corpus ' +
        'that shrank. The floor is a WALL, not a tunable threshold (DNC-10).',
    });
  }

  return { pairs, problems };
}

/** `'a'` / `"a"` / `` `a` `` -> `a`. Anything else is returned verbatim. */
function unquote(raw) {
  const text = String(raw).trim();
  if (text.length >= 2 && /^['"`]/.test(text) && text.endsWith(text[0])) {
    return text.slice(1, -1).replace(/\\(['"`\\])/g, '$1');
  }
  return text;
}

/** `'a' + \n 'b'` -> `ab`. The shape every long `why` in this file uses. */
function unquoteConcatenation(raw) {
  const parts = String(raw).match(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g);
  if (parts === null) return null;
  return parts.map(unquote).join('');
}

module.exports = {
  DECLARED_CONSTANT,
  PAIR_KEY_SEPARATOR,
  MIN_DECLARED_PAIRS,
  isVacuousReason,
  parseAppRoleRequiredPrivileges,
};
