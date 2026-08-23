/**
 * S-E01-1k / ADR-059 §D2 — `schema.prisma` -> { model -> table, model -> relations },
 * PURE over the schema TEXT.
 *
 * WHY THIS EXISTS, AND WHY IT IS NOT A SECOND HAND-WRITTEN CATALOG.
 * -----------------------------------------------------------------
 * `tenant-adversarial-check.js` already maps model -> table, by lower-camelising
 * the LIVE catalog's table names (`prismaModelName`). That map carries no
 * relations at all — measured: 204 relation fields across 54 models, none of
 * them derivable from a table name. And a relation a `where`/`select`/`include`
 * traverses IS a table read under RLS: Prisma issues its own query against the
 * target and raises 42501 without the privilege. That is PF-246, and it is why a
 * root-delegate-only closure is provably less complete than the hand list it
 * would replace.
 *
 * ADR-042 §D3 forbids two hand-written statements of one catalog fact. This file
 * does not add one: it DERIVES the same fact from the schema, and the caller
 * ASSERTS the two derivations agree (`compareModelToTable` below). A
 * disagreement is a NAMED failure, never a silent preference for either side —
 * that preference is exactly how `role_permission` drifted in S-E01-1b.
 *
 * MEASURED ON THIS CHECKOUT (aaff53b): 54 `model` blocks, 54 `@@map` directives,
 * so model -> table is TOTAL. A model without `@@map` is therefore not a
 * tolerated case: it is a `model-without-map` problem, and the caller fails
 * closed on it (DNC-08).
 *
 * A CONSEQUENCE TO KNOW BEFORE EDITING THE SCHEMA: `apps/api/prisma/schema.prisma`
 * is now a GATE INPUT. Renaming an `@@map` moves this check. `scripts/ci-gate.sh`
 * already triggers the tenant-adversarial stage on `^apps/api/prisma/`, so the
 * trigger is covered; the surprise would be the failure, not the run.
 */

'use strict';

/**
 * The scalar/attribute types Prisma ships. A field whose type is NOT a declared
 * model and NOT one of these is reported rather than assumed scalar: an unknown
 * type is either a `type` block this parser does not model or a typo, and both
 * must be visible.
 */
const PRISMA_SCALARS = Object.freeze([
  'String',
  'Boolean',
  'Int',
  'BigInt',
  'Float',
  'Decimal',
  'DateTime',
  'Json',
  'Bytes',
  'Unsupported',
]);

/** `outbox_event` -> `outboxEvent`; kept identical to the checker's own helper. */
function tableToClientProperty(table) {
  return String(table).replace(/_([a-z0-9])/g, (_m, ch) => String(ch).toUpperCase());
}

/**
 * `OutboxEvent` -> `outboxEvent` — the property name Prisma Client exposes, and
 * therefore the token `PRISMA_CALL_SITE_RE` captures at a call site.
 */
function modelToClientProperty(model) {
  return model.charAt(0).toLowerCase() + model.slice(1);
}

/**
 * Parse the schema.
 *
 * Returns `{ models, byClientProperty, modelToTable, enums, problems }`:
 *  - `models`: Map<ModelName, { name, clientProperty, table, fields: Map<field,
 *    { type, isRelation, list, optional }>, relations: Map<field, TargetModel> }>
 *  - `byClientProperty`: the same entries keyed by the CALL-SITE token;
 *  - `modelToTable`: Map<clientProperty, table>;
 *  - `problems`: NAMED, never empty-on-doubt. Kinds: `no-models`,
 *    `model-without-map`, `duplicate-model`, `duplicate-table`, `unknown-type`.
 *
 * ANTI-VACUITY IS PART OF THE CONTRACT. A parser that returns an empty map on a
 * schema it failed to read is a green light that proves nothing — it would make
 * every model `unmapped`, every relation invisible, and the bidirectional
 * closure check would then report the whole declared list as dead. So `no-models`
 * is a problem, and the caller refuses the verdict on any problem at all.
 */
function parsePrismaSchema(text) {
  const source = String(text ?? '');
  const problems = [];
  const models = new Map();
  const enums = new Set();

  for (const match of source.matchAll(/^enum\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{/gm)) {
    enums.add(match[1]);
  }

  // Block bodies are located by their own brace depth rather than by a lazy
  // `[^}]*`: a `@default("}")` or a comment holding a brace would truncate the
  // block and silently drop every field after it.
  const blockRe = /^(model|type|view)\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{/gm;
  for (const match of source.matchAll(blockRe)) {
    if (match[1] !== 'model') continue;
    const name = match[2];
    const open = match.index + match[0].length - 1;
    const close = findMatchingBrace(source, open);
    if (close === -1) {
      problems.push({ kind: 'unbalanced-model-block', model: name });
      continue;
    }
    if (models.has(name)) {
      problems.push({ kind: 'duplicate-model', model: name });
      continue;
    }
    models.set(name, {
      name,
      clientProperty: modelToClientProperty(name),
      table: null,
      body: source.slice(open + 1, close),
      fields: new Map(),
      relations: new Map(),
      compoundKeys: new Map(),
    });
  }

  if (models.size === 0) {
    problems.push({
      kind: 'no-models',
      detail:
        'zero `model` blocks parsed. An empty graph makes every relation invisible and every declared ' +
        'privilege look dead — refused rather than returned (DNC-08).',
    });
    return { models, byClientProperty: new Map(), modelToTable: new Map(), enums, problems };
  }

  const modelNames = new Set(models.keys());
  const seenTables = new Map();

  for (const model of models.values()) {
    const lines = model.body.split('\n');
    for (const rawLine of lines) {
      const line = stripLineComment(rawLine).trim();
      if (line.length === 0) continue;
      if (line.startsWith('@@')) {
        const map = /^@@map\(\s*"([^"]+)"\s*\)/.exec(line);
        if (map !== null) model.table = map[1];
        // COMPOUND UNIQUE / COMPOUND ID keys. Prisma exposes `@@unique([a, b])`
        // as a SYNTHETIC `where` key named `a_b` (or by `name:` when given), and
        // it is neither a column nor a relation. Measured: without them the walk
        // reported `where.announcementId_userProfileId` as an unknown field at
        // `announcements.controller.ts:987` and `student-portal.service.ts:509`
        // — a fail-closed refusal on a construct that is simply a scalar lookup.
        const compound = /^@@(unique|id)\(\s*(?:fields\s*:\s*)?\[([^\]]*)\]([\s\S]*)\)/.exec(line);
        if (compound !== null) {
          const fields = compound[2]
            .split(',')
            .map((f) => f.trim())
            .filter((f) => f.length > 0);
          const named = /name\s*:\s*"([^"]+)"/.exec(compound[3] ?? '');
          const key = named === null ? fields.join('_') : named[1];
          if (key.length > 0) {
            model.compoundKeys.set(key, fields);
          }
        }
        continue;
      }
      const field = /^([A-Za-z_][A-Za-z0-9_]*)\s+([A-Za-z_][A-Za-z0-9_]*)(\[\])?(\?)?/.exec(line);
      if (field === null) continue;
      const [, fieldName, typeName, list, optional] = field;
      const isRelation = modelNames.has(typeName);
      if (!isRelation && !PRISMA_SCALARS.includes(typeName) && !enums.has(typeName)) {
        problems.push({
          kind: 'unknown-type',
          model: model.name,
          field: fieldName,
          type: typeName,
          detail:
            'the field type is neither a declared model, a Prisma scalar nor a declared enum. It is ' +
            'refused rather than assumed scalar: an unmodelled type is how a relation stops being ' +
            'walked without anyone noticing.',
        });
      }
      model.fields.set(fieldName, {
        type: typeName,
        isRelation,
        list: list === '[]',
        optional: optional === '?',
      });
      if (isRelation) model.relations.set(fieldName, typeName);
    }
    if (model.table === null) {
      problems.push({
        kind: 'model-without-map',
        model: model.name,
        detail:
          'no `@@map`, so this model names no table. Measured on this checkout: 54 models, 54 @@map — ' +
          'the mapping is TOTAL, and a gap in it is a defect, not a case to tolerate.',
      });
      continue;
    }
    const previous = seenTables.get(model.table);
    if (previous !== undefined) {
      problems.push({ kind: 'duplicate-table', table: model.table, models: [previous, model.name] });
    }
    seenTables.set(model.table, model.name);
  }

  const byClientProperty = new Map();
  const modelToTable = new Map();
  for (const model of models.values()) {
    byClientProperty.set(model.clientProperty, model);
    if (model.table !== null) modelToTable.set(model.clientProperty, model.table);
  }

  return { models, byClientProperty, modelToTable, enums, problems };
}

/**
 * ADR-042 §D3's obligation, executed: the schema-derived model->table map is
 * compared against the LIVE-CATALOG-derived one the checker already builds.
 *
 * Returns a LIST of named findings, never a boolean. Only tables the catalog
 * actually holds are compared in the catalog direction, and a schema model whose
 * table the catalog does not hold is named `table-absent-from-catalog` — the
 * shape a pending migration takes, and the shape a typo takes too.
 */
function compareModelToTable(schemaMap, catalogTables) {
  const findings = [];
  const catalog = new Set(catalogTables ?? []);
  for (const [clientProperty, table] of schemaMap) {
    if (!catalog.has(table)) {
      findings.push({
        kind: 'table-absent-from-catalog',
        model: clientProperty,
        table,
        detail:
          `schema.prisma maps \`${clientProperty}\` to \`${table}\`, which the live catalog does not hold. ` +
          'Either a migration is pending or the @@map is wrong; both are named rather than resolved in ' +
          "either side's favour.",
      });
      continue;
    }
    const fromCatalog = tableToClientProperty(table);
    if (fromCatalog !== clientProperty) {
      findings.push({
        kind: 'model-name-disagreement',
        model: clientProperty,
        table,
        detail:
          `the catalog-derived name for \`${table}\` is \`${fromCatalog}\`, the schema-derived one is ` +
          `\`${clientProperty}\`. Two derivations of ONE catalog fact disagree — this is the ` +
          'ADR-042 §D3 shape, and it is reported rather than silently preferred.',
      });
    }
  }
  return findings;
}

/** The brace matcher for a Prisma block: `//` comments only, no JS literals. */
function findMatchingBrace(text, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < text.length; i += 1) {
    const c = text[i];
    if (c === '/' && text[i + 1] === '/') {
      const eol = text.indexOf('\n', i);
      if (eol === -1) return -1;
      i = eol;
      continue;
    }
    if (c === '"') {
      const end = text.indexOf('"', i + 1);
      if (end === -1) return -1;
      i = end;
      continue;
    }
    if (c === '{') depth += 1;
    else if (c === '}') {
      depth -= 1;
      if (depth === 0) return i;
      if (depth < 0) return -1;
    }
  }
  return -1;
}

function stripLineComment(line) {
  const at = line.indexOf('//');
  return at === -1 ? line : line.slice(0, at);
}

module.exports = {
  PRISMA_SCALARS,
  compareModelToTable,
  modelToClientProperty,
  parsePrismaSchema,
  tableToClientProperty,
};
