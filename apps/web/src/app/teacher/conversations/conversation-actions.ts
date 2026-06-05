'use server';

import { revalidatePath } from 'next/cache';

import { api, apiResultFromError, type ApiResult } from '@/lib/api-client';
import type { ConversationMessageDto, ConversationReportDto } from '@pilotage/contracts';

/**
 * Teacher conversation thread-view server actions (E2-S3 — teacher inbox + reply).
 *
 * The teacher-portal mirror of the parent `messages-actions.ts`: thin
 * `'use server'` wrappers over the existing S1/S2 messaging endpoints, with the
 * SAME interaction grammar and fail-closed error normalization
 * (`apiResultFromError`) — but revalidating the TEACHER routes
 * (`/teacher/conversations…`), never the parent paths (PM-9).
 *
 * No new endpoint is introduced: reply reuses `POST /api/v1/conversations/:id/messages`
 * (append-only, dual-wall ABAC re-checked server-side → a lapsed teaching wall
 * 403s and freezes the thread to `read_only`), and mark-read reuses
 * `PATCH /api/v1/conversations/:id/read` (caller's own anchor). Real-time stays
 * polling/revalidation only (the ADR-019 websocket tripwire stays un-triggered).
 */

/** Append a teacher reply to an existing thread. ABAC is re-checked server-side;
 *  a lapsed teaching wall returns 403 (the thread flips to `read_only`). The
 *  parent is notified in-app via the existing S1 `notifyCounterpart` fan-out. */
export async function replyToThreadAction(
  conversationId: string,
  body: string,
): Promise<ApiResult<ConversationMessageDto>> {
  const trimmed = body.trim();
  if (!trimmed) {
    return { ok: false, error: 'Votre message ne peut pas être vide.' };
  }
  try {
    const data = await api<ConversationMessageDto>(
      `/api/v1/conversations/${conversationId}/messages`,
      { method: 'POST', body: { body: trimmed } },
    );
    revalidatePath(`/teacher/conversations/${conversationId}`);
    revalidatePath('/teacher/conversations');
    return { ok: true, data };
  } catch (err) {
    return apiResultFromError(err);
  }
}

/**
 * Mark the thread read for the teacher caller — bumps the caller's own
 * `ConversationParticipant.lastReadAt` to server `now()` so the parent's
 * "Vu" receipt updates and the teacher's inbox unread cue clears. Idempotent and
 * participant-only (404 otherwise). Fired once on thread open; best-effort
 * (a failure is swallowed to a silent `ok:false` and never blocks reading).
 */
export async function markThreadReadAction(
  conversationId: string,
): Promise<ApiResult<{ ok: true }>> {
  try {
    await api(`/api/v1/conversations/${conversationId}/read`, { method: 'PATCH' });
    // The inbox unread cues derive from the aggregate; refresh on next load.
    revalidatePath('/teacher/conversations');
    return { ok: true, data: { ok: true } };
  } catch (err) {
    return apiResultFromError(err);
  }
}

/**
 * Report a thread for safety review (E2-S4) — the teacher-portal mirror of the
 * parent `reportThreadAction`. Participant-only + idempotent-while-open
 * server-side; revalidates the TEACHER thread route only (PM-9). The thread is
 * never blocked here — an admin triages it in the moderation oversight surface.
 */
export async function reportThreadAction(
  conversationId: string,
  reason: string,
): Promise<ApiResult<ConversationReportDto>> {
  try {
    const data = await api<ConversationReportDto>(
      `/api/v1/conversations/${conversationId}/report`,
      { method: 'POST', body: { reason: reason.trim() || undefined } },
    );
    revalidatePath(`/teacher/conversations/${conversationId}`);
    return { ok: true, data };
  } catch (err) {
    return apiResultFromError(err);
  }
}
