#!/usr/bin/env node
/**
 * Compose invocation gate — the documented way to start the stack must start
 * the stack that is documented (S-E02-16 / PF-86).
 *
 * WHY THIS EXISTS
 * ---------------
 * Docker Compose resolves `.env` from the **project directory** — the directory
 * of the compose file, `infra/` — and not from the caller's cwd. `infra/.env`
 * does not exist in this repository; the ports live in the **root** `.env`,
 * beside the `DATABASE_URL` that prisma, the seeds and every host-side script
 * read. So `docker compose -f infra/docker-compose.yml up -d` saw none of them
 * and silently fell through to the `${VAR:-default}` defaults.
 *
 * Two commands that look identical produced two different stacks, and the
 * difference was invisible until something outside a container tried to
 * connect. Run 19 hit exactly that: Postgres was recreated without its
 * `5433:5432` mapping and every host-side prisma command failed `P1001`.
 *
 * MEASURED, AND WORSE THAN RECORDED
 * ---------------------------------
 * The finding was written up as a documentation defect. It was a functional
 * break, and the proof needs no reference to any untracked file. Inside
 * `infra/docker-compose.yml`, on the documented path:
 *
 *     KC_HOSTNAME:          http://localhost:8180     (hard-coded)
 *     KEYCLOAK_PUBLIC_URL:  http://localhost:8180     (hard-coded, and the api
 *                                                      uses it as the EXPECTED
 *                                                      TOKEN ISSUER)
 *     keycloak.ports:       ${KEYCLOAK_PORT:-8080}:8080
 *     web NEXT_PUBLIC_KEYCLOAK_URL: http://localhost:${KEYCLOAK_PORT:-8080}
 *
 * Keycloak published on host 8080, announced itself as 8180, the browser was
 * sent to 8080, and the api rejected the resulting token for a wrong issuer.
 * Login was broken by construction on the documented path — and "worked" only
 * because a gitignored `.env` on one machine happened to say 8180, on a code
 * path where compose never read it.
 *
 * WHAT THIS GATE CHECKS
 * ---------------------
 * C1  No published host port may carry a silent default. Every `ports:` entry
 *     whose host side interpolates a variable must use `${VAR:?…}`, never
 *     `${VAR:-…}` and never a bare `${VAR}`. A refusal in the operator's
 *     terminal is a control; a default is a second, undocumented stack.
 *
 * C2  Every `:?` variable must be declared in `.env.example`, so the refusal is
 *     actionable. A gate that demands a variable nobody documents has moved the
 *     defect rather than closed it.
 *
 * C3  No browser-facing URL may hard-code a host port that the file also
 *     publishes through a variable. This is the check that catches the
 *     KC_HOSTNAME/8180 contradiction, and it would have caught it on the day it
 *     was written. A port written in two places diverges; it is written once.
 *
 * C4  Profile reachability. For every service S and every service T it
 *     `depends_on`, T must be enabled by every profile that enables S —
 *     otherwise `--profile <p>` alone is not a degraded project, it is an
 *     INVALID one, and compose refuses to do anything at all. `--profile seed`
 *     failed this way: *"service seed depends on undefined service api"*.
 *
 * C5  Documented invocations. Every `docker compose` command line in the
 *     tracked files that describe how to run the local stack must carry
 *     `--env-file`. This is the rule the header of the compose file itself
 *     broke for the life of the project.
 *
 * EXECUTED, NOT ASSERTED
 * ----------------------
 * C1–C5 are computed from the parsed YAML rather than by grepping for the
 * shapes we expect, so a new service inherits the rules without anyone
 * remembering to add it. Beyond that, when a `docker` binary is on PATH this
 * script also RUNS `docker compose config` in both forms and asserts the
 * refusal actually happens — the V3 premise that a guardrail is executed rather
 * than asserted. When docker is absent it says so on stdout and reports the
 * static verdict; it never silently downgrades to a vacuous pass.
 *
 * NO BYPASS (DNC-10)
 * ------------------
 * There is no `SKIP_*`, `ALLOW_*`, `BYPASS` or `FORCE` environment read in this
 * file, and `compose-invocation-gate.spec.ts` asserts it.
 *
 * Usage:
 *   node scripts/compose-invocation-check.js
 *   node scripts/compose-invocation-check.js --no-docker   # static checks only
 */

'use strict';

const { existsSync, readFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { spawnSync } = require('node:child_process');
const yaml = require('js-yaml');

const ROOT = resolve(__dirname, '..');

/** The compose file that describes the local stack. */
const COMPOSE_FILE = 'infra/docker-compose.yml';

/** Where the `:?` variables must be documented. */
const ENV_EXAMPLE = '.env.example';

/**
 * Files that document how to run the local stack. Every `docker compose`
 * invocation in them must carry `--env-file`.
 *
 * A positive root list, not a `docs/**` exclusion, for the same reason
 * production-artefact-check.js uses one: an exclusion silently blesses whatever
 * is dropped into the excluded path later.
 */
const DOCUMENTED_INVOCATION_FILES = [
  'infra/docker-compose.yml',
  'infra/pilotage.sh',
  'docs/runbooks/backup-restore-drill.md',
  'docs/runbooks/provision-demo-tenant.md',
  'docs/DEPLOYMENT.md',
  // The routine's own instructions. Step -1 of this document tells the routine
  // how to rebuild the local stack, and until S-E02-16 its three command lines
  // omitted `--env-file` — so the document that defines the evidence base was
  // itself producing the wrong stack. Run 19 was bitten by exactly that.
  // (`~/.claude/scheduled-tasks/…/SKILL.md` carries the same lines and lives
  // outside this checkout; it is an operator action, noted in the doc.)
  'docs/daily-improvement-v3/routine/daily-improvement-v3.md',
];

/**
 * `docker compose` lines that legitimately carry no `--env-file`.
 *
 * `docker-compose.prod.yml` is the hosted overlay: it is driven by
 * `scripts/deploy-prod.sh` with its own `--env-file .env.prod`, and the audit
 * fixture it describes is out of this routine's scope (SKILL Step -1). A line
 * naming that file is therefore not a local-stack invocation.
 */
const PROD_OVERLAY = 'docker-compose.prod.yml';

// ---------------------------------------------------------------------------
// Pure evaluator — everything below `evaluateComposeInvocation` is IO.
// ---------------------------------------------------------------------------

/**
 * Split a compose short-syntax port entry into its host part and container
 * part, tolerating the `127.0.0.1:HOST:CONTAINER` form.
 *
 * Returns `{ hostSpec, containerSpec, bindAddress }`.
 */
function splitPortEntry(entry) {
  const text = String(entry);
  // A `${...}` interpolation may itself contain colons (the :? message does),
  // so split on colons that are OUTSIDE an interpolation.
  const parts = [];
  let depth = 0;
  let current = '';
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '$' && text[i + 1] === '{') {
      depth += 1;
      current += '${';
      i += 1;
      continue;
    }
    if (ch === '}' && depth > 0) {
      depth -= 1;
      current += ch;
      continue;
    }
    if (ch === ':' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  parts.push(current);

  if (parts.length >= 3) {
    return { bindAddress: parts[0], hostSpec: parts[1], containerSpec: parts.slice(2).join(':') };
  }
  if (parts.length === 2) {
    return { bindAddress: null, hostSpec: parts[0], containerSpec: parts[1] };
  }
  // Container-only form ("3000") publishes an ephemeral host port — no variable
  // is involved, so there is nothing for C1 to hold.
  return { bindAddress: null, hostSpec: null, containerSpec: parts[0] };
}

/**
 * Classify a `${...}` interpolation.
 *
 * `required` — `${VAR:?msg}` or `${VAR?msg}`: compose refuses when unset.
 * `default`  — `${VAR:-x}` or `${VAR-x}`: compose substitutes silently.
 * `bare`     — `${VAR}`: compose substitutes the EMPTY STRING silently, which
 *              on a port produces a malformed mapping rather than a refusal.
 */
function classifyInterpolation(text) {
  const m = /^\$\{([A-Za-z_][A-Za-z0-9_]*)(:?[-?])?/.exec(text);
  if (!m) return null;
  const op = m[2];
  if (op === ':?' || op === '?') return { variable: m[1], kind: 'required' };
  if (op === ':-' || op === '-') return { variable: m[1], kind: 'default' };
  return { variable: m[1], kind: 'bare' };
}

/** Every `${...}` interpolation in a string, as classified records. */
function interpolationsIn(text) {
  const out = [];
  const s = String(text);
  for (let i = 0; i < s.length; i += 1) {
    if (s[i] !== '$' || s[i + 1] !== '{') continue;
    let depth = 1;
    let j = i + 2;
    for (; j < s.length && depth > 0; j += 1) {
      if (s[j] === '{') depth += 1;
      else if (s[j] === '}') depth -= 1;
    }
    const chunk = s.slice(i, j);
    const c = classifyInterpolation(chunk);
    if (c) out.push(c);
    i = j - 1;
  }
  return out;
}

/** Walk every scalar in a nested object, yielding `[path, value]`. */
function scalars(node, path, out) {
  if (node === null || node === undefined) return out;
  if (typeof node === 'string' || typeof node === 'number' || typeof node === 'boolean') {
    out.push([path, String(node)]);
    return out;
  }
  if (Array.isArray(node)) {
    node.forEach((v, i) => scalars(v, `${path}[${i}]`, out));
    return out;
  }
  if (typeof node === 'object') {
    Object.entries(node).forEach(([k, v]) => scalars(v, path ? `${path}.${k}` : k, out));
  }
  return out;
}

/**
 * Evaluate the compose invocation rules.
 *
 * @param {object} input
 * @param {object} input.compose      parsed `infra/docker-compose.yml`
 * @param {string[]} input.envExampleNames  variable names declared in `.env.example`
 * @param {Array<{file:string,line:number,text:string}>} input.invocationLines
 *        every `docker compose …` line found in the documented files
 * @returns {{problems: string[], stats: object}}
 */
function evaluateComposeInvocation(input) {
  const problems = [];
  const compose = input.compose || {};
  const services = compose.services || {};
  const declared = new Set(input.envExampleNames || []);

  const requiredVars = new Set();
  const publishedPortVars = new Set();
  const literalHostPorts = new Set();
  let portEntries = 0;

  // --- C1 — no silent default on a published host port ---------------------
  for (const [name, svc] of Object.entries(services)) {
    const ports = (svc && svc.ports) || [];
    for (const entry of ports) {
      if (entry && typeof entry === 'object') {
        // Long syntax: `published:` carries the host port.
        const published = entry.published;
        if (published === undefined) continue;
        portEntries += 1;
        const found = interpolationsIn(published);
        if (found.length === 0) {
          literalHostPorts.add(String(published));
          continue;
        }
        for (const it of found) {
          publishedPortVars.add(it.variable);
          if (it.kind === 'required') requiredVars.add(it.variable);
          else {
            problems.push(
              `C1 ${COMPOSE_FILE}: service "${name}" publishes host port \${${it.variable}} with a ` +
                `${it.kind === 'default' ? 'silent default (:-)' : 'bare interpolation'}. ` +
                `Use \${${it.variable}:?…} so compose REFUSES instead of starting a different stack (PF-86).`,
            );
          }
        }
        continue;
      }
      portEntries += 1;
      const { hostSpec } = splitPortEntry(entry);
      if (!hostSpec) continue;
      const found = interpolationsIn(hostSpec);
      if (found.length === 0) {
        literalHostPorts.add(hostSpec);
        continue;
      }
      for (const it of found) {
        publishedPortVars.add(it.variable);
        if (it.kind === 'required') requiredVars.add(it.variable);
        else {
          problems.push(
            `C1 ${COMPOSE_FILE}: service "${name}" publishes host port \${${it.variable}} with a ` +
              `${it.kind === 'default' ? 'silent default (:-)' : 'bare interpolation'}. ` +
              `Use \${${it.variable}:?…} so compose REFUSES instead of starting a different stack (PF-86).`,
          );
        }
      }
    }
  }

  // --- C2 — every required variable is documented --------------------------
  // Collect required vars from the WHOLE file, not only from `ports:` — a `:?`
  // anywhere makes the file unusable without that variable.
  for (const [, value] of scalars(compose, '', [])) {
    for (const it of interpolationsIn(value)) {
      if (it.kind === 'required') requiredVars.add(it.variable);
    }
  }
  for (const v of [...requiredVars].sort()) {
    if (!declared.has(v)) {
      problems.push(
        `C2 ${ENV_EXAMPLE}: \${${v}} is required by ${COMPOSE_FILE} (\${${v}:?…}) but is not declared here. ` +
          `A gate that demands an undocumented variable moves the defect instead of closing it (PF-86).`,
      );
    }
  }

  // --- C3 — no browser-facing URL hard-codes a published host port ---------
  // Any `localhost:<literal>` in a service environment value where <literal> is
  // NOT also a literal published port is a port written twice: the value claims
  // a host port the file publishes through a variable, so the two can diverge.
  for (const [name, svc] of Object.entries(services)) {
    const env = (svc && svc.environment) || {};
    for (const [path, value] of scalars(env, '', [])) {
      const matches = String(value).matchAll(/(?:localhost|127\.0\.0\.1):(\d{2,5})\b/g);
      for (const m of matches) {
        const port = m[1];
        if (literalHostPorts.has(port)) continue;
        problems.push(
          `C3 ${COMPOSE_FILE}: service "${name}" environment ${path} hard-codes host port ${port} ` +
            `("${m[0]}") while no service publishes that literal port. The published port comes from a ` +
            `variable, so the two WILL diverge — derive this value from the same variable (PF-86).`,
        );
      }
    }
  }

  // --- C4 — profile reachability -------------------------------------------
  const profilesOf = (svcName) => {
    const svc = services[svcName];
    const p = (svc && svc.profiles) || [];
    return Array.isArray(p) ? p.map(String) : [];
  };
  for (const [name, svc] of Object.entries(services)) {
    const dep = (svc && svc.depends_on) || {};
    const targets = Array.isArray(dep) ? dep.map(String) : Object.keys(dep);
    const own = profilesOf(name);
    for (const target of targets) {
      if (!services[target]) {
        problems.push(
          `C4 ${COMPOSE_FILE}: service "${name}" depends_on "${target}", which is not defined at all.`,
        );
        continue;
      }
      const targetProfiles = profilesOf(target);
      if (targetProfiles.length === 0) continue; // always enabled — fine
      if (own.length === 0) {
        problems.push(
          `C4 ${COMPOSE_FILE}: service "${name}" is always enabled but depends_on "${target}", which is ` +
            `only in profile(s) ${targetProfiles.join(', ')}. A default \`up\` is an INVALID project (PF-86).`,
        );
        continue;
      }
      const unreachable = own.filter((p) => !targetProfiles.includes(p));
      if (unreachable.length > 0) {
        problems.push(
          `C4 ${COMPOSE_FILE}: \`--profile ${unreachable[0]}\` alone is an INVALID project — it enables ` +
            `"${name}", which depends_on "${target}", which that profile does not enable ` +
            `(it is in ${targetProfiles.join(', ')}). Compose refuses the whole project, it does not ` +
            `degrade (PF-86).`,
        );
      }
    }
  }

  // --- C5 — documented invocations carry --env-file ------------------------
  let invocationsChecked = 0;
  for (const line of input.invocationLines || []) {
    const text = line.text;
    if (text.includes(PROD_OVERLAY)) continue; // hosted overlay, own env file
    invocationsChecked += 1;
    if (!text.includes('--env-file')) {
      problems.push(
        `C5 ${line.file}:${line.line}: documented invocation without \`--env-file\` — ` +
          `"${text.trim()}". Compose resolves .env from the compose file's directory (infra/), not the ` +
          `caller's cwd, so this starts a different stack than the one this repository describes (PF-86).`,
      );
    }
  }

  return {
    problems,
    stats: {
      services: Object.keys(services).length,
      portEntries,
      publishedPortVars: [...publishedPortVars].sort(),
      requiredVars: [...requiredVars].sort(),
      literalHostPorts: [...literalHostPorts].sort(),
      invocationsChecked,
    },
  };
}

// ---------------------------------------------------------------------------
// IO
// ---------------------------------------------------------------------------

/**
 * Variable names declared in an env file. Values are deliberately NOT read:
 * this gate needs to know a name is documented, never what it is set to.
 */
function envNames(text) {
  const out = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=/.exec(line);
    if (m) out.push(m[1]);
  }
  return out;
}

/** Every `docker compose …` line in the documented files. */
function collectInvocationLines(files) {
  const out = [];
  for (const rel of files) {
    const abs = join(ROOT, rel);
    if (!existsSync(abs)) {
      // A documented file that disappeared is a real problem, surfaced by the
      // caller rather than skipped here.
      out.push({ file: rel, line: 0, text: null, missing: true });
      continue;
    }
    const lines = readFileSync(abs, 'utf8').split(/\r?\n/);
    lines.forEach((text, i) => {
      if (/docker\s+compose\s/.test(text)) out.push({ file: rel, line: i + 1, text });
    });
  }
  return out;
}

/**
 * Execute the two invocations and assert the refusal really happens.
 * Returns `{ ran, problems, notes }`.
 */
function probeDocker() {
  const notes = [];
  const problems = [];

  const which = spawnSync('docker', ['--version'], { encoding: 'utf8' });
  if (which.error || which.status !== 0) {
    notes.push('docker not on PATH — static checks only, the refusal was NOT executed.');
    return { ran: false, problems, notes };
  }

  // 1. Without --env-file: compose must REFUSE.
  const bare = spawnSync('docker', ['compose', '-f', COMPOSE_FILE, 'config'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  const bareOut = `${bare.stdout || ''}${bare.stderr || ''}`;
  if (bare.status === 0) {
    problems.push(
      `PROBE: \`docker compose -f ${COMPOSE_FILE} config\` (no --env-file) SUCCEEDED. It must be refused — ` +
        `that is the invocation that silently starts a different stack (PF-86).`,
    );
  } else {
    notes.push(`probe 1 — without --env-file: refused (exit ${bare.status}), as required.`);
    if (!/required|manquant/i.test(bareOut)) {
      problems.push(
        'PROBE: compose refused without --env-file, but the message names no missing variable. ' +
          'The refusal must tell the operator what to do.',
      );
    }
  }

  // 2. With --env-file .env: compose must ACCEPT (when .env exists).
  if (existsSync(join(ROOT, '.env'))) {
    const withEnv = spawnSync(
      'docker',
      ['compose', '--env-file', '.env', '-f', COMPOSE_FILE, 'config'],
      { cwd: ROOT, encoding: 'utf8' },
    );
    if (withEnv.status !== 0) {
      problems.push(
        `PROBE: \`docker compose --env-file .env -f ${COMPOSE_FILE} config\` FAILED (exit ` +
          `${withEnv.status}). The documented invocation must work: ${(withEnv.stderr || '').trim().slice(0, 400)}`,
      );
    } else {
      notes.push('probe 2 — with --env-file .env: accepted, as required.');
    }

    // 3. `--profile seed` alone must be a VALID project.
    const seed = spawnSync(
      'docker',
      ['compose', '--env-file', '.env', '-f', COMPOSE_FILE, '--profile', 'seed', 'config'],
      { cwd: ROOT, encoding: 'utf8' },
    );
    if (seed.status !== 0) {
      problems.push(
        `PROBE: \`--profile seed\` alone is still an invalid project (exit ${seed.status}): ` +
          `${(seed.stderr || '').trim().slice(0, 400)}`,
      );
    } else {
      notes.push('probe 3 — `--profile seed` alone: valid project, as required.');
    }
  } else {
    notes.push('.env absent — probes 2 and 3 (the accepting direction) were NOT executed.');
  }

  return { ran: true, problems, notes };
}

function main() {
  const noDocker = process.argv.includes('--no-docker');

  const composePath = join(ROOT, COMPOSE_FILE);
  if (!existsSync(composePath)) {
    console.error(`✗ ${COMPOSE_FILE} not found`);
    process.exit(1);
  }
  const envExamplePath = join(ROOT, ENV_EXAMPLE);
  if (!existsSync(envExamplePath)) {
    console.error(`✗ ${ENV_EXAMPLE} not found — the required variables would be undocumented`);
    process.exit(1);
  }

  const compose = yaml.load(readFileSync(composePath, 'utf8'));
  const envExampleNames = envNames(readFileSync(envExamplePath, 'utf8'));
  const invocationLines = collectInvocationLines(DOCUMENTED_INVOCATION_FILES);

  const missing = invocationLines.filter((l) => l.missing);
  const usable = invocationLines.filter((l) => !l.missing);

  const { problems, stats } = evaluateComposeInvocation({
    compose,
    envExampleNames,
    invocationLines: usable,
  });

  for (const m of missing) {
    problems.push(
      `C5 ${m.file}: listed as a file documenting how to run the stack, but it does not exist. ` +
        `Fix the list or restore the file — a silently skipped root is a vacuous pass.`,
    );
  }

  let probe = { ran: false, problems: [], notes: ['docker probe skipped (--no-docker).'] };
  if (!noDocker) probe = probeDocker();
  problems.push(...probe.problems);

  console.log('compose invocation check');
  console.log(`  services                 ${stats.services}`);
  console.log(`  published port entries   ${stats.portEntries}`);
  console.log(`  port variables           ${stats.publishedPortVars.join(', ') || '(none)'}`);
  console.log(`  required (:?) variables  ${stats.requiredVars.length}`);
  console.log(`  documented invocations   ${stats.invocationsChecked}`);
  for (const n of probe.notes) console.log(`  ${n}`);

  if (problems.length > 0) {
    console.error('');
    console.error(`✗ compose invocation check: ${problems.length} problem(s)`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }

  console.log('');
  console.log('✓ compose invocation check: the documented command starts the documented stack');
}

if (require.main === module) main();

module.exports = {
  evaluateComposeInvocation,
  splitPortEntry,
  classifyInterpolation,
  interpolationsIn,
  envNames,
  COMPOSE_FILE,
  ENV_EXAMPLE,
  DOCUMENTED_INVOCATION_FILES,
};
