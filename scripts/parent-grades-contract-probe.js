#!/usr/bin/env node
/**
 * `S-E03-2` / `AC-9` / `ADR-071` — the Tier-A LIVE probe for the student-read
 * authorisation seam, executed against the RUNNING local Docker stack.
 *
 * WHY THIS FILE EXISTS, AND WHY IT WAS WRITTEN AT THE LAND PASS
 * ------------------------------------------------------------
 * The `S-E03-2` sprint shipped the fix, the unit suites and the ratchet, and
 * then recorded honestly that this probe **did not exist** — `PF-343`, "evidence
 * owed by `S-E03-2`". Tier A is not gradeable downward (SKILL Step 5, rule 1):
 * an authZ slice that closes a live fail-open owes an EXECUTED probe. Run 77
 * shipped a probe that was structurally unable to run and the deliverable was
 * worth nothing; the lesson is that a probe counts only when someone runs it.
 * So it was written and executed by the land pass instead of being inherited —
 * which is exactly how `S-E03-4`'s probe debt became a second slice.
 *
 * THIS IS EVIDENCE, NOT A GATE STAGE
 * ----------------------------------
 * Deliberately wired into NO stage list, for the reason `scripts/ci-gate.sh`
 * states about itself: the fast tier is Docker-free by contract, and a blocking
 * stage that needs a live Keycloak is a flaky blocking stage. Precedent for an
 * unwired probe under `scripts/`: `keycloak-live-probe.js`, `restore-drill.js`,
 * `trace-emission-probe.js`.
 *
 * Unlike `keycloak-live-probe.js` this probe **mutates nothing**. It mints two
 * tokens for realm users that already exist and issues GETs. The one piece of
 * state it depends on — a guardianship linking `parent@pilotage.local` to a
 * child that actually has a published grade — it DISCOVERS rather than creates,
 * and it says so when it is absent instead of inventing it.
 *
 * WHAT IT PROVES, AND ON WHICH ARM
 * --------------------------------
 *  P1  THE FAIL-OPEN, on a real identity. `teacher@pilotage.local` holds
 *      `grades.read` and has NO `TeachingAssignment` for the probed student.
 *      BEFORE `S-E03-2` the private chain in `grades.controller.ts` answered
 *      `return;` on `roles.includes('teacher')` and the API served that child's
 *      full transcript: **HTTP 200**. AFTER, `StudentAccessService` bounds the
 *      teacher branch to taught students and the answer is **HTTP 403**.
 *      This is the RED-BEFORE / GREEN-AFTER pair, observed on the wire.
 *  P2  THE TIGHTENING DID NOT OVERSHOOT. The parent still reads their own
 *      guarded child: **HTTP 200**, before and after. A wall that also denies
 *      the legitimate reader is not a fix.
 *  P3  THE TWO PROJECTIONS AGREE. `/grades/students/:id/grades` and
 *      `/analytics/parent-dashboard/:id` are asked for the SAME child in the
 *      SAME breath and their published-grade counts are compared. This is
 *      `PF-05`'s own question, asked of the running system rather than of a
 *      fixture — and note what it can and cannot show (§LIMIT below).
 *  P4  THE LESSONS ARM. `GET /lessons?studentId=` denied the same unbound
 *      teacher only AFTER the slice: before it, the student check was gated
 *      behind `roles.includes('parent')` and every other caller skipped it.
 *
 * §LIMIT — WHAT A GREEN P3 DOES NOT PROVE
 * ---------------------------------------
 * P3 compares COUNTS on ONE child on ONE seed. `AnalyticsService.parentDashboard`
 * is a strict SUBSET of the grades feed (it additionally filters the enrolment's
 * academic year, `isAbsent: false`, and drops falsy values — `ADR-071 §D5`), so
 * agreement here means "the four divergence axes did not bite on THIS child",
 * never "the projections are the same query". `PF-05` therefore stays ADVANCED.
 * A probe that over-claimed here would be worse than no probe.
 *
 * USAGE
 *   node scripts/parent-grades-contract-probe.js            # expects the POST-fix stack
 *   node scripts/parent-grades-contract-probe.js --expect-prefix   # expects the PRE-fix stack
 *
 * The second form is what makes this a fail-before/pass-after instrument rather
 * than a one-sided assertion: run it against the old image, then rebuild and run
 * it again. Exit 0 = every expectation for the declared mode held.
 */

const fs = require('fs');
const path = require('path');

const KC = process.env.KEYCLOAK_URL_HOST || 'http://localhost:8180';
const REALM = process.env.KEYCLOAK_REALM || 'pilotage-scolaire';
const API = process.env.API_URL_HOST || 'http://localhost:4000';
const EXPORT = path.join(__dirname, '..', 'infra', 'keycloak', 'realm-export.json');

// Refuse to be pointed at anything but a loopback host. Same guard, same reason
// as `keycloak-live-probe.js`: `pilotage.srv861861.hstgr.cloud` is an audit
// fixture and this repository's automation never sends it a request.
for (const [name, url] of [['KEYCLOAK_URL_HOST', KC], ['API_URL_HOST', API]]) {
  const host = new URL(url).hostname;
  if (host !== 'localhost' && host !== '127.0.0.1' && host !== '[::1]') {
    console.error(`REFUSED: ${name}=${url} is not loopback. The target is the LOCAL stack only.`);
    process.exit(2);
  }
}

const EXPECT_PREFIX = process.argv.includes('--expect-prefix');

const exported = JSON.parse(fs.readFileSync(EXPORT, 'utf8'));
/** DERIVED from the export, never re-typed — a hand-kept second copy is `PF-228`. */
const secretOf = (clientId) => (exported.clients.find((c) => c.clientId === clientId) || {}).secret;
const passwordOf = (username) =>
  (((exported.users || []).find((u) => u.username === username) || {}).credentials || [])[0]?.value;

async function body(res) {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return { _raw: text.slice(0, 300) };
  }
}

async function mint(clientId, username) {
  const password = passwordOf(username);
  if (!password) throw new Error(`no credential for ${username} in realm-export.json`);
  const res = await fetch(`${KC}/realms/${REALM}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'password',
      client_id: clientId,
      client_secret: secretOf(clientId) || '',
      username,
      password,
      scope: 'openid',
    }),
  });
  const payload = await body(res);
  if (res.status !== 200 || !payload?.access_token) {
    throw new Error(
      `ROPC mint failed for ${username} via ${clientId}: HTTP ${res.status} ${JSON.stringify(payload)}`,
    );
  }
  return payload.access_token;
}

async function get(pathname, token) {
  const res = await fetch(`${API}${pathname}`, { headers: { Authorization: `Bearer ${token}` } });
  return { status: res.status, body: await body(res) };
}

const results = [];

/**
 * THE FALSE GREEN THIS GUARD EXISTS TO STOP — and it very nearly happened.
 *
 * On the first execution of this probe, every teacher expectation answered
 * **403**, which is exactly what the POST-fix mode wants to see. It was not the
 * wall under test. `teacher@pilotage.local` had no `UserProfile` at all, so
 * `UserSyncService.ensureUser` refused with `403 ACCOUNT_NOT_PROVISIONED`
 * BEFORE the request ever reached `assertCanReadStudent`. Run the probe in
 * POST-fix mode against an unprovisioned realm and it reports a perfect pass
 * while proving nothing whatsoever about the authorisation seam.
 *
 * A probe that cannot tell "denied by the rule under test" from "denied by an
 * unrelated rule upstream" is not evidence. So a refusal carrying this code is
 * INCONCLUSIVE — never a pass, never a fail — and it aborts the run loudly. The
 * fixture requirement it names is real work for the operator, and saying so is
 * the point: this is the same asymmetry `PF-127` and `PF-146` record, where a
 * green stage was mistaken for coverage.
 */
function assertReached(id, response) {
  const code = response.body?.code;
  if (code === 'ACCOUNT_NOT_PROVISIONED') {
    throw new Error(
      `${id} is INCONCLUSIVE, not a pass: the API answered 403 ACCOUNT_NOT_PROVISIONED, which is ` +
        '`UserSyncService.ensureUser` refusing an unprovisioned account BEFORE any student ' +
        'authorisation runs. Provision a UserProfile for teacher@pilotage.local (matching the token ' +
        "`sub` in `auth_provider_id`, in the student's tenant) and re-run. Without it this probe " +
        'would report a green that means nothing.',
    );
  }
}

function check(id, label, actual, expected) {
  const ok = actual === expected;
  results.push({ id, label, actual, expected, ok });
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${id} — ${label}`);
  console.log(`         expected ${expected}, observed ${actual}`);
  return ok;
}

(async () => {
  console.log(`parent-grades-contract-probe — mode=${EXPECT_PREFIX ? 'PRE-FIX (expects the fail-open)' : 'POST-FIX'}`);
  console.log(`  keycloak=${KC} realm=${REALM} api=${API}\n`);

  const parentToken = await mint('portal-parent', 'parent@pilotage.local');
  const teacherToken = await mint('portal-teacher', 'teacher@pilotage.local');

  // ── Discover the fixture rather than invent it ────────────────────────────
  const children = await get('/api/v1/students', parentToken);
  if (children.status !== 200) {
    throw new Error(`parent cannot list children: HTTP ${children.status}`);
  }
  const kids = children.body?.data ?? [];
  if (kids.length === 0) {
    throw new Error(
      'no guarded child for parent@pilotage.local — this probe reads state, it does not create it. ' +
        'Link an active guardianship to a student first.',
    );
  }

  // Prefer a child that actually HAS a published grade: P3 is vacuous on a
  // child with none, and a vacuous comparison is the failure mode this whole
  // programme keeps paying for.
  let subject = null;
  for (const kid of kids) {
    const feed = await get(`/api/v1/grades/students/${kid.id}/grades`, parentToken);
    if (feed.status === 200 && (feed.body?.data?.length ?? 0) > 0) {
      subject = { kid, gradeCount: feed.body.data.length };
      break;
    }
  }
  if (!subject) {
    throw new Error(
      `none of the ${kids.length} guarded child(ren) has a published grade — P3 would be vacuous. ` +
        'Publish a grade for one of them, then re-run.',
    );
  }
  console.log(
    `  fixture: child ${subject.kid.id} (${subject.kid.firstName} ${subject.kid.lastName}), ` +
      `${subject.gradeCount} published grade(s)\n`,
  );

  // ── P1 — the fail-open, on the grades transcript ──────────────────────────
  const teacherGrades = await get(`/api/v1/grades/students/${subject.kid.id}/grades`, teacherToken);
  assertReached('P1', teacherGrades);
  check(
    'P1',
    'unbound teacher reads an arbitrary child transcript',
    teacherGrades.status,
    EXPECT_PREFIX ? 200 : 403,
  );

  // ── P1b — the same wall on the stats sibling, which shared the private chain
  const teacherStats = await get(`/api/v1/grades/students/${subject.kid.id}/stats`, teacherToken);
  assertReached('P1b', teacherStats);
  check('P1b', 'unbound teacher reads the same child stats', teacherStats.status, EXPECT_PREFIX ? 200 : 403);

  // ── P2 — the legitimate reader is untouched ───────────────────────────────
  const parentGrades = await get(`/api/v1/grades/students/${subject.kid.id}/grades`, parentToken);
  check('P2', 'parent still reads their own guarded child', parentGrades.status, 200);

  // ── P3 — the two projections, asked the same question ─────────────────────
  const dash = await get(`/api/v1/analytics/parent-dashboard/${subject.kid.id}`, parentToken);
  check('P3a', 'parent dashboard answers for the same child', dash.status, 200);
  const feedCount = parentGrades.body?.data?.length ?? -1;
  const dashCount = (dash.body?.subjectPerf ?? []).reduce(
    (n, s) => n + (s.gradeCount ?? s.grades?.length ?? 0),
    0,
  );
  // The dashboard shape does not always expose a per-subject grade count; fall
  // back to `recentGrades`, and say which measure was used rather than silently
  // comparing two different things.
  const dashMeasure = dashCount > 0 ? 'subjectPerf' : 'recentGrades';
  const dashObserved = dashCount > 0 ? dashCount : (dash.body?.recentGrades ?? []).length;
  console.log(`  P3 measure: grades-feed=${feedCount}, parent-dashboard(${dashMeasure})=${dashObserved}`);
  check('P3b', `the two projections agree on the published-grade count (${dashMeasure})`, dashObserved, feedCount);

  // ── P4 — the lessons arm ──────────────────────────────────────────────────
  const teacherLessons = await get(`/api/v1/lessons?studentId=${subject.kid.id}`, teacherToken);
  assertReached('P4', teacherLessons);
  check(
    'P4',
    'unbound teacher reads an arbitrary child lesson feed',
    teacherLessons.status,
    EXPECT_PREFIX ? 200 : 403,
  );

  const failed = results.filter((r) => !r.ok);
  console.log(
    `\nPROBE: ${failed.length === 0 ? 'PASS' : 'FAIL'} — ${results.length - failed.length}/${results.length} expectations held ` +
      `(mode=${EXPECT_PREFIX ? 'PRE-FIX' : 'POST-FIX'})`,
  );
  if (failed.length > 0) {
    for (const f of failed) console.log(`  - ${f.id} ${f.label}: expected ${f.expected}, observed ${f.actual}`);
    process.exit(1);
  }
})().catch((err) => {
  console.error(`\nPROBE: ERROR — ${err.message}`);
  process.exit(2);
});
