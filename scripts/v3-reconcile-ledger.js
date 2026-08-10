#!/usr/bin/env node
/**
 * v3-reconcile-ledger.js — fold per-run ledger inbox files into the shared ledger.
 *
 * WHY THIS EXISTS
 * ---------------
 * V3 now runs up to N tracks concurrently. If every run edited
 * `traceability/OPEN.md` directly, three runs would collide on the same lines of
 * the same file on every merge — the single biggest risk of going parallel.
 *
 * So runs never touch OPEN.md. Each run appends ONE file it alone owns:
 *
 *     docs/daily-improvement-v3/traceability/inbox/<branch>.md
 *
 * Different files can never conflict in git. This reconciler — invoked under a
 * short exclusive lock by `routine-lock.sh gate` — folds those inbox files into
 * OPEN.md / CLOSED-<layer>.md and deletes them.
 *
 * INBOX FORMAT (one block per finding; order does not matter)
 *
 *     ## PF-123
 *     status: closed            # open | in-progress | blocked | closed | closed-by-other-work
 *     layer: L0                 # L0 | L1 | L2-4 | VAL   (required when closing)
 *     row: | PF-123 short title | V3-E05 | S-E05-3 | `closed` | test id | evidence |
 *
 * Rules, deliberately conservative:
 *   • A `closed` block MOVES the row: it is removed from OPEN.md and appended to
 *     CLOSED-<layer>.md. Nothing is ever deleted outright.
 *   • Any other status REPLACES the row in OPEN.md, or appends it if new.
 *   • A block whose id cannot be found and which is not `closed` is appended to
 *     OPEN.md under its layer section.
 *   • If anything is ambiguous the reconciler leaves the ledger untouched for
 *     that block and reports it, rather than guessing. A ledger that silently
 *     mis-files a finding is worse than one that asks for help.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TDIR = path.join(ROOT, 'docs/daily-improvement-v3/traceability');
const INBOX = path.join(TDIR, 'inbox');
const OPEN = path.join(TDIR, 'OPEN.md');

if (!fs.existsSync(INBOX) || !fs.existsSync(OPEN)) {
  console.log('reconcile: nothing to do (inbox or OPEN.md missing)');
  process.exit(0);
}

const files = fs.readdirSync(INBOX).filter((f) => f.endsWith('.md') && f !== 'README.md');
if (files.length === 0) {
  console.log('reconcile: inbox empty');
  process.exit(0);
}

let open = fs.readFileSync(OPEN, 'utf8');
const closedBuf = {}; // layer -> [rows]
const applied = [];
const skipped = [];

const ID_RE = /^##\s+((?:PF|LG|VAL|DNC|TOOL)-\d+)\s*$/;

for (const f of files) {
  const raw = fs.readFileSync(path.join(INBOX, f), 'utf8');
  const blocks = raw.split(/\n(?=##\s+(?:PF|LG|VAL|DNC|TOOL)-\d+\s*$)/m);

  for (const block of blocks) {
    const lines = block.split(/\r?\n/);
    const idLine = lines.find((l) => ID_RE.test(l));
    if (!idLine) continue;
    const id = idLine.match(ID_RE)[1];

    const get = (k) => {
      const l = lines.find((x) => x.toLowerCase().startsWith(k + ':'));
      return l ? l.slice(k.length + 1).trim() : '';
    };
    const status = get('status').toLowerCase();
    const layer = get('layer');
    const row = lines.find((l) => l.trim().startsWith('|')) || get('row');

    if (!status || !row) { skipped.push(`${id} (${f}): missing status or row`); continue; }

    // locate the existing row for this id in OPEN.md (whole line, id at line start)
    const rowRe = new RegExp(`^\\|[^\\n]*\\b${id}\\b[^\\n]*$`, 'm');
    const found = rowRe.test(open);

    if (status === 'closed' || status === 'closed-by-other-work') {
      if (!layer) { skipped.push(`${id} (${f}): closing without a layer`); continue; }
      open = found ? open.replace(rowRe, '') : open;
      (closedBuf[layer] = closedBuf[layer] || []).push(row.trim());
      applied.push(`${id} -> CLOSED-${layer}`);
    } else {
      if (found) { open = open.replace(rowRe, row.trim()); applied.push(`${id} updated`); }
      else {
        // append under the matching layer section, else at end
        const secRe = layer
          ? new RegExp(`(^##\\s+[^\\n]*${layer === 'L0' ? 'Layer 0' : layer === 'L1' ? 'Layer 1' : layer === 'VAL' ? 'Validation' : 'Layers 2'}[^\\n]*$)`, 'm')
          : null;
        if (secRe && secRe.test(open)) {
          // insert after that section's table (first blank line following it)
          const idx = open.search(secRe);
          const after = open.indexOf('\n\n', open.indexOf('\n', idx) + 1);
          const at = after === -1 ? open.length : after;
          open = open.slice(0, at) + '\n' + row.trim() + open.slice(at);
        } else {
          open = open.replace(/\s*$/, '\n') + row.trim() + '\n';
        }
        applied.push(`${id} appended`);
      }
    }
  }
  fs.unlinkSync(path.join(INBOX, f));
}

// tidy: collapse the blank lines left by removed rows
open = open.replace(/\n{3,}/g, '\n\n');
fs.writeFileSync(OPEN, open);

for (const [layer, rows] of Object.entries(closedBuf)) {
  const p = path.join(TDIR, `CLOSED-${layer}.md`);
  const head = fs.existsSync(p) ? fs.readFileSync(p, 'utf8').replace(/\s*$/, '\n') : `# Traceability archive — ${layer} (CLOSED)\n`;
  fs.writeFileSync(p, head + rows.join('\n') + '\n');
}

console.log(`reconcile: ${files.length} inbox file(s), ${applied.length} change(s)`);
if (applied.length) console.log('  ' + applied.slice(0, 12).join('; '));
if (skipped.length) {
  console.log(`  SKIPPED ${skipped.length} (left for a human):`);
  skipped.slice(0, 8).forEach((s) => console.log('   - ' + s));
}
