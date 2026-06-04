'use server';

import { api, apiResultFromError, type ApiResult } from '@/lib/api-client';

/**
 * Parent "request a meeting" intent server action (E1-S2 — "What should I do?").
 *
 * Hits the new guardianship-ABAC-scoped endpoint
 * `POST /api/v1/alerts/:id/meeting-intent` (authorized via the same
 * `authorizeParentAlertAction` helper as the S1 lifecycle routes, NOT the admin
 * `alerts.write` permission). The backend records ONE append-only `AuditLog`
 * row (`action='alert.meeting_intent'`) — no new model, no schema change — and
 * is idempotent on `(tenantId, resourceType, resourceId, action, actorId)`,
 * returning `alreadyRequested` on a re-submit.
 *
 * Crucially this does NOT mutate the alert's status, so — unlike the S1
 * lifecycle actions — we deliberately do NOT call `revalidatePath`: the alert
 * stays in the list, and the success state is held locally in the component so
 * the parent's scroll position is preserved (no jump). Mirrors the shared
 * `ApiResult` shape via `apiResultFromError`, like `actions.ts`.
 */

export interface MeetingIntentResult {
  ok: true;
  alreadyRequested: boolean;
  requestedAt: string;
}

export async function requestMeetingIntentAction(
  id: string,
): Promise<ApiResult<MeetingIntentResult>> {
  try {
    const data = await api<MeetingIntentResult>(`/api/v1/alerts/${id}/meeting-intent`, {
      method: 'POST',
    });
    // No revalidatePath: the intent is orthogonal to status; keep the alert in
    // place and avoid a scroll reset (the component holds the success state).
    return { ok: true, data };
  } catch (err) {
    return apiResultFromError(err);
  }
}
