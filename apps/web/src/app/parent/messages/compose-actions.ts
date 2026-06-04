'use server';

import { api, apiResultFromError, type ApiResult } from '@/lib/api-client';

/**
 * Parent messaging compose server actions (E2-S1 — the thin "Nouveau message"
 * spine). Mirrors the recommendations `intent-actions.ts` convention: a thin
 * `'use server'` wrapper that forwards the session token via the shared `api`
 * helper and normalizes failures into the shared `ApiResult` shape via
 * `apiResultFromError`, so the client form can surface a kind, fail-closed
 * message for every backend rejection (403 dual-wall ABAC / 404 cross-tenant /
 * 400 validation) without leaking raw HTTP semantics.
 *
 * Two read/write surfaces back the compose drawer, both server-filtered by the
 * NestJS `messaging` module (no client N+1, no client-side roster):
 *  - `loadEligibleTeachersAction` → GET /api/v1/messaging/eligible-teachers
 *    returns ONLY teachers currently teaching the caller's child intersected
 *    with guardianship; the picker can never select an ineligible teacher.
 *  - `sendFirstMessageAction` → POST /api/v1/conversations performs the
 *    idempotent create-or-reuse on the @@unique(parent,teacher,student) tuple
 *    and appends the first message; ABAC is re-checked server-side at create.
 *
 * The full inbox/thread view + alert-seeded CTA rewire are deferred to S2 — this
 * action set deliberately exposes only create + the compose picker.
 */

/** One teacher the caller may message about a given child (server-filtered). */
export interface EligibleTeacher {
  /** UserProfile id — the value POST /conversations.teacherId accepts. */
  userProfileId: string;
  displayName: string;
  subjects: { subjectId: string; name: string }[];
  isMainTeacher: boolean;
  /** Existing thread for (parent,teacher,student), so the UI can deep-link in S2. */
  existingConversationId: string | null;
}

/** Minimal create-conversation echo the compose form needs for its success state. */
export interface CreatedConversation {
  id: string;
  teacherName: string;
}

/**
 * Loads the server-filtered eligible-teacher list for one child. Returns an
 * empty array (ok) when no teacher currently teaches the child — the form
 * renders a kind EmptyState rather than an error.
 */
export async function loadEligibleTeachersAction(
  studentId: string,
): Promise<ApiResult<EligibleTeacher[]>> {
  try {
    const res = await api<{ data: EligibleTeacher[] }>(
      `/api/v1/messaging/eligible-teachers?studentId=${encodeURIComponent(studentId)}`,
      { cache: 'no-store' },
    );
    return { ok: true, data: res.data ?? [] };
  } catch (err) {
    return apiResultFromError(err);
  }
}

/**
 * Opens-or-reuses a parent↔teacher thread and appends the first message.
 *
 * Idempotency lives server-side (the @@unique tuple): a re-submit returns the
 * existing thread without appending a duplicate message, so a double-click is
 * safe even before the client `pending` guard. The optional `alertId` is
 * accepted + validated by the backend in S1 but the alert-context exposure is
 * deferred to S2 (we never surface it here).
 */
export async function sendFirstMessageAction(input: {
  studentId: string;
  teacherId: string;
  body: string;
  subjectId?: string | null;
  alertId?: string | null;
}): Promise<ApiResult<CreatedConversation>> {
  const body = input.body.trim();
  if (!body) {
    return { ok: false, error: 'Votre message ne peut pas être vide.' };
  }
  try {
    const data = await api<CreatedConversation>('/api/v1/conversations', {
      method: 'POST',
      body: {
        studentId: input.studentId,
        teacherId: input.teacherId,
        body,
        ...(input.subjectId ? { subjectId: input.subjectId } : {}),
        ...(input.alertId ? { alertId: input.alertId } : {}),
      },
    });
    return { ok: true, data };
  } catch (err) {
    return apiResultFromError(err);
  }
}
