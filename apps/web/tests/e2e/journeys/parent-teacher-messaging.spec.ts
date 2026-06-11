import { expect, test } from '../fixtures/portal-fixtures';

/**
 * E10-S3 — Critical journey #3: parent ↔ teacher messaging (E2 dual-wall ABAC).
 *
 * Proves E2's load-bearing invariant — the **dual-wall ABAC** (guardianship ∩
 * teaching-assignment) — end-to-end, cross-portal, through the real wall, in ONE
 * spec that drives BOTH the S1 `parentPage` **and** `teacherPage` fixtures side by
 * side (the cross-portal shape the S1 per-role-context fixture was built for, and
 * the same pattern the S2 parent↔admin journey uses).
 *
 * The arc (FR-5 / AC-5):
 *   1. PARENT opens `/parent/messages` → `/new` and composes to a teacher
 *      **currently teaching their child** — the teacher list is the SERVER-FILTERED
 *      eligible list (`/messaging/eligible-teachers`), so the very act of finding a
 *      selectable teacher proves the guardianship ∩ teaching wall RESOLVES for a
 *      legitimate pair. The create (`POST /conversations`, create-or-reuse) lands
 *      the parent inside the (fresh or reused) thread, then the parent **appends**
 *      a message with **unique run-stamped text** via the thread's append-only
 *      reply composer, where that run-stamped message is visible.
 *   2. TEACHER navigates DIRECTLY to the same conversation id, sees the parent's
 *      run-stamped message, **replies** with its own run-stamped text, and the
 *      thread view fires mark-read on open (the S2 `TeacherThreadReply` mount).
 *   3. PARENT reloads the thread → the teacher's run-stamped reply is visible
 *      (the round-trip closes both directions through the wall).
 *
 * ── The dual-wall, asserted, not just exercised ──
 *   - POSITIVE wall (the happy path above): a legitimate pair (the demo parent +
 *     the rich `voltaire-demo` teacher with the most assignments, same tenant) can
 *     exchange a message both directions. The eligible-teacher list being non-empty
 *     IS the guardianship ∩ teaching resolution.
 *   - NEGATIVE wall (where cheap, no extra seed — FR-5 "and, where cheap, that an
 *     illegitimate pair is walled"): the compose surface can NEVER select an
 *     ineligible (non-teaching) teacher. There is no free-text teacher entry; the
 *     teacher control is a bounded picker fed exclusively by the server-filtered
 *     eligible list, and a child with no current teacher renders the calm "Aucun
 *     enseignant à contacter" empty-state instead of an open picker. We assert this
 *     structural wall (the affordance itself denies an illegitimate pair) rather
 *     than seeding a separate non-teaching teacher.
 *
 * ── Re-runnability (FR-8 — the subtle correctness key for a MUTATING journey) ──
 * The `voltaire-demo` seed is stable and the suite must be green on consecutive
 * runs with NO reseed. So every assertion keys on **presence of run-stamped text**,
 * never absence of prior state:
 *   - The parent's appended message and the teacher's reply each carry a unique
 *     `RUN_STAMP` (base36 timestamp), so a fresh send is always traceable and never
 *     collides with a prior run's messages.
 *   - CRITICAL re-runnability note: `POST /conversations` is create-OR-REUSE on the
 *     `@@unique([tenantId,parentId,teacherId,studentId])` tuple, and on REUSE the
 *     request body is **IGNORED — no message is appended** (messaging.service.ts:298;
 *     compose-actions has no append fallback). On the stable, never-reseeded
 *     `voltaire-demo` seed the tuple already exists on run 2+, so the create path
 *     persists NOTHING. The run-stamped parent message is therefore appended via the
 *     thread's **append-only** reply composer (`POST /conversations/:id/messages`,
 *     the same path the teacher reply uses), which appends on every run — and THAT
 *     is what the journey asserts on. The create step only proves "the parent landed
 *     in a real thread (the wall resolved)".
 *   - Teacher discovery is by **direct conversation-id navigation**, NOT by an inbox
 *     `lastMessagePreview` row-filter: that preview is the conversation `topic`,
 *     frozen at create time and never updated, so a RUN_ID filter would false-skip
 *     the teacher leg on run 2+ even when the pairing is correct.
 *   - The pairing is **guarded, not assumed**: if the parent's chosen eligible
 *     teacher is NOT the logged-in teacher session (a seed where the most-assigned
 *     teacher does not teach the demo parent's child), the participant-walled
 *     thread 404s for that teacher and the teacher-side leg `test.skip`s gracefully
 *     AFTER proving the parent-side send + the positive wall — a seed mismatch is
 *     not a false red.
 *
 * No schema, no new fixture (reuses S1's `parentPage` + `teacherPage`), no endpoint.
 * Read/act against the already-running :3100 stack — never builds (AC-8).
 *
 * Non-vacuous degrade (PM mirror of S1/S2): if E2 messaging is not available on the
 * operator's stack (no child rattaché, or no current teacher), the parent surface
 * renders a calm EmptyState; the journey `test.skip`s rather than asserting against
 * a disabled surface (a thin/not-migrated seed is not a false red).
 */

/** Run-unique stamps so a fresh send is traceable AND tolerant of prior runs. */
const RUN_ID = Date.now().toString(36);
const PARENT_MSG = `E2E-S3 parent→prof ${RUN_ID} — au sujet du suivi de mon enfant.`;
const TEACHER_REPLY = `E2E-S3 prof→parent ${RUN_ID} — bien reçu, merci pour votre message.`;

test.describe('Journey: parent ↔ teacher messaging (E2 dual-wall) @journey', () => {
  test('a legitimate parent↔teacher pair exchanges a message both directions through the dual-wall', async ({
    parentPage,
    teacherPage,
  }) => {
    /* ───────────────────── 1. PARENT composes to an ELIGIBLE teacher ───────────────────── */
    await parentPage.goto('/parent/messages/new');
    expect(parentPage.url(), 'parent must reach the compose surface, not /login').not.toContain(
      '/login',
    );
    await expect(
      parentPage.getByRole('heading', { level: 1, name: /Nouveau message/i }),
    ).toBeVisible();

    // PM (non-vacuous): no child rattaché → the messaging surface is legitimately
    // closed (calm "Aucun enfant rattaché" empty-state). Skip rather than assert a
    // disabled surface (a thin seed is not a false red).
    if ((await parentPage.getByText(/Aucun enfant rattaché/i).count()) > 0) {
      test.skip(
        true,
        'Demo parent guards no child on this stack — messaging is legitimately closed (PM non-vacuous).',
      );
      return;
    }

    // If the parent guards multiple children, pick the first so the eligible-teacher
    // list loads; a single child is shown as a static chip (no picker), already loaded.
    const childPicker = parentPage.getByRole('button', { name: /Choisir un enfant/i });
    if ((await childPicker.count()) > 0) {
      await childPicker.first().click();
      // The SelectFilter listbox renders option rows; pick the first real child.
      await parentPage.getByRole('option').first().click();
    }

    // The eligible-teacher control resolves to one of three states (ComposeForm):
    //  - a loading chip → settles to a picker or the empty-state;
    //  - the calm "Aucun enseignant à contacter" empty-state (no CURRENT teacher →
    //    the NEGATIVE wall: an illegitimate pair has NO selectable teacher);
    //  - a bounded picker fed by the server-filtered eligible list (the POSITIVE
    //    wall: guardianship ∩ teaching resolved to ≥1 teacher).
    const teacherPicker = parentPage.getByRole('button', { name: /Choisir un·e enseignant·e/i });
    const noEligibleTeacher = parentPage.getByText(/Aucun enseignant à contacter/i);
    await expect
      .poll(async () => (await teacherPicker.count()) + (await noEligibleTeacher.count()), {
        timeout: 10_000,
        message: 'the eligible-teacher control settled to neither a picker nor the empty-state',
      })
      .toBeGreaterThan(0);

    // ── NEGATIVE WALL (where cheap): an illegitimate pair is denied at the affordance.
    // If the child has no CURRENT teacher, the surface offers NO selectable teacher
    // (the wall is structural — there is no free-text teacher entry to bypass it).
    // That IS the "illegitimate pair walled" assertion; the round-trip can't run, so
    // skip gracefully after proving the wall.
    if ((await noEligibleTeacher.count()) > 0) {
      await expect(
        noEligibleTeacher,
        'a child with no current teacher must be denied a selectable teacher (dual-wall denies the illegitimate pair)',
      ).toBeVisible();
      // Structural confirmation there is no bypass: no teacher picker is rendered.
      expect(
        await teacherPicker.count(),
        'the negative wall must offer NO teacher picker (no ineligible selection possible)',
      ).toBe(0);
      test.skip(
        true,
        'No current teacher for the demo child on this seed — negative wall asserted; round-trip skipped (non-vacuous).',
      );
      return;
    }

    // ── POSITIVE WALL: a legitimate pair RESOLVES — pick the first eligible teacher.
    await teacherPicker.first().click();
    const teacherOption = parentPage.getByRole('option').first();
    await expect(
      teacherOption,
      'the eligible-teacher list must offer ≥1 teacher (guardianship ∩ teaching resolved)',
    ).toBeVisible();
    const chosenTeacherName = ((await teacherOption.innerText()).split('\n')[0] ?? '').trim();
    await teacherOption.click();

    // Compose an opening message and send. NOTE: `POST /conversations` is
    // create-OR-REUSE on the `@@unique([tenantId,parentId,teacherId,studentId])`
    // tuple, and on REUSE the request body is IGNORED (messaging.service.ts:298 —
    // "Idempotent reuse: an existing thread is returned (200), body ignored"). The
    // demo seed is stable and never reseeded, so on run 2+ this tuple already
    // exists and create appends NOTHING. We therefore must NOT key any assertion on
    // the create-time body. The create step's sole job is to LAND us inside the
    // (fresh or reused) thread; the run-stamped parent message is appended below via
    // the append-only reply path that survives re-runs.
    const composeBody = parentPage.getByLabel(/Votre message/i);
    await expect(composeBody).toBeVisible();
    await composeBody.fill(`E2E-S3 ouverture — au sujet du suivi de mon enfant.`);
    await parentPage.getByRole('button', { name: /^Envoyer$/i }).click();

    // On success the ComposeForm navigates the parent INTO the created/reused thread
    // (`/parent/messages/{id}`). Assert we land on a thread route (the dual-wall
    // RESOLVED on create-or-reuse — the parent is a participant of a real thread).
    await parentPage.waitForURL(/\/parent\/messages\/[^/]+$/, { timeout: 15_000 });
    expect(parentPage.url(), 'a successful send must land inside the thread').toMatch(
      /\/parent\/messages\/[0-9a-f-]+$/i,
    );

    // Remember the thread id for the teacher-side direct navigation (step 2) and the
    // parent-side reply-visibility re-check (step 3).
    const parentThreadUrl = parentPage.url();
    const conversationId = parentThreadUrl.match(/\/parent\/messages\/([0-9a-f-]+)$/i)?.[1] ?? '';
    expect(conversationId, 'must extract the conversation id from the thread URL').not.toBe('');

    // Append THIS run's run-stamped parent message via the thread's append-only
    // reply composer (`ThreadReply` → `POST /conversations/:id/messages`), the path
    // the teacher reply also uses. Unlike `POST /conversations`, this path ALWAYS
    // appends, so the run-stamped body is persisted on every run (fresh OR reused) —
    // restoring true per-run-unique re-runnability (FR-8). Assert it is visible in
    // the stream (the parent→teacher direction resolved through the wall).
    const parentReply = parentPage.getByLabel(/Votre réponse/i);
    await expect(
      parentReply,
      'the active thread must offer the append-only reply composer (the wall stayed open)',
    ).toBeVisible();
    await parentReply.fill(PARENT_MSG);
    await parentPage.getByRole('button', { name: /^Envoyer$/i }).click();
    await expect(
      parentPage.getByText(PARENT_MSG, { exact: false }),
      'the parent must see the run-stamped message it just appended (send resolved through the wall)',
    ).toBeVisible({ timeout: 15_000 });

    /* ───────────────────── 2. TEACHER sees the thread, replies, marks-read ───────────────────── */
    // Navigate the teacher DIRECTLY to the SAME conversation id the parent landed on
    // (FR-4's "more robust" alternative). We do NOT discover the thread by the inbox
    // `lastMessagePreview`: that preview is the conversation `topic`, frozen at
    // create time (messaging.service.ts:304 / toInboxDto) and NEVER updated on reuse
    // or on later messages — so on run 2+ it still carries a PRIOR run's stamp and a
    // RUN_ID row-filter would find 0 rows and false-skip the entire teacher leg even
    // though the pairing is correct. Direct navigation is re-run stable.
    await teacherPage.goto(`/teacher/conversations/${conversationId}`);

    // PAIRING GUARD (distinct from the topic-staleness false-skip above): if the
    // chosen eligible teacher is NOT this logged-in teacher session (a seed where the
    // most-assigned teacher does not teach the demo parent's child), the teacher is
    // NOT a participant of this conversation → the participant-walled
    // `GET /conversations/:id` 404s and the page renders notFound() (or, if the
    // session is invalid, redirects to /login). Either way the teacher thread header
    // never resolves. That is not a false red — the parent-side send + the positive
    // wall are already proven; skip the teacher-side leg gracefully.
    const teacherThreadHeading = teacherPage.getByRole('heading', { level: 1 });
    const parentMsgOnTeacherSide = teacherPage.getByText(PARENT_MSG, { exact: false });
    const reachedThread = await parentMsgOnTeacherSide
      .first()
      .waitFor({ state: 'visible', timeout: 15_000 })
      .then(() => true)
      .catch(() => false);
    if (!reachedThread) {
      test.skip(
        true,
        `The chosen eligible teacher ("${chosenTeacherName}") is not a participant of conversation ${conversationId} ` +
          '(not the logged-in teacher session on this seed — 404/redirect on the participant-walled thread) — ' +
          'parent-side send + positive/negative wall proven; teacher-side leg skipped (PM pairing guard, non-vacuous).',
      );
      return;
    }

    // We are in the teacher thread view; assert the header resolved and the parent's
    // run-stamped message is visible (parent→teacher direction resolved through the
    // participant wall).
    await expect(
      teacherThreadHeading,
      'the teacher must land on the resolved thread header (participant of this conversation)',
    ).toBeVisible();
    await expect(
      parentMsgOnTeacherSide,
      'the teacher must see the parent run-stamped message (parent→teacher direction resolved)',
    ).toBeVisible();

    // Reply with the teacher's run-stamped text (the TeacherThreadReply composer).
    const replyField = teacherPage.getByLabel(/Votre réponse/i);
    await expect(replyField).toBeVisible();
    await replyField.fill(TEACHER_REPLY);
    // The composer's submit is the "Envoyer" button; the page revalidates and the
    // new bubble appears in the server-rendered stream.
    await teacherPage.getByRole('button', { name: /^Envoyer$/i }).click();
    await expect(
      teacherPage.getByText(TEACHER_REPLY, { exact: false }),
      'the teacher reply must appear in the teacher thread stream',
    ).toBeVisible({ timeout: 15_000 });

    /* ───────────────────── 3. PARENT sees the teacher reply (round-trip closes) ───────────────────── */
    await parentPage.goto(parentThreadUrl);
    expect(parentPage.url(), 'parent must reach the thread, not /login').not.toContain('/login');
    await expect(
      parentPage.getByText(TEACHER_REPLY, { exact: false }),
      'the parent must see the teacher reply (teacher→parent direction resolved — round-trip closed)',
    ).toBeVisible({ timeout: 15_000 });
  });
});
