'use server';

import { revalidatePath } from 'next/cache';

import { api, apiResultFromError, type ApiResult } from '@/lib/api-client';
import type { ConversationMessageDto } from '@pilotage/contracts';

/**
 * Parent messaging thread-view server actions (E2-S2 — inbox + thread surface).
 *
 * These back the thread view (`/parent/messages/[id]`): a reply composer posting
 * to the existing S1 `POST /api/v1/conversations/:id/messages`, and a
 * fire-on-load `PATCH /api/v1/conversations/:id/read` that bumps the caller's
 * read receipt. Both are thin `'use server'` wrappers over the shared `api`
 * helper, normalizing failures into the shared `ApiResult` shape via
 * `apiResultFromError` so the client surfaces a kind, fail-closed French message
 * for every backend rejection (403 lapsed teaching wall / 404 non-participant or
 * cross-tenant / 400 validation) without leaking raw HTTP semantics.
 *
 * Real-time is deliberately polling/revalidation only (no websocket/SSE — the
 * ADR-019 tripwire stays un-triggered): after a successful send or mark-read we
 * `revalidatePath` the thread + inbox so the server-rendered message stream,
 * unread badges and previews refresh on the next navigation.
 */

/** Append a reply to an existing thread. ABAC is re-checked server-side; a
 *  lapsed teaching wall returns 403 (the thread is `read_only`). */
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
    revalidatePath(`/parent/messages/${conversationId}`);
    revalidatePath('/parent/messages');
    return { ok: true, data };
  } catch (err) {
    return apiResultFromError(err);
  }
}

/**
 * Mark the thread read for the caller — bumps `ConversationParticipant.lastReadAt`
 * to server `now()`. Idempotent and participant-only (404 otherwise). Fired once
 * on thread open so the inbox row + nav badge clear. Best-effort: a failure is
 * swallowed to a silent `ok:false` (never blocks reading the thread).
 */
export async function markThreadReadAction(
  conversationId: string,
): Promise<ApiResult<{ ok: true }>> {
  try {
    await api(`/api/v1/conversations/${conversationId}/read`, { method: 'PATCH' });
    // The inbox unread badges derive from the aggregate; refresh on next load.
    revalidatePath('/parent/messages');
    return { ok: true, data: { ok: true } };
  } catch (err) {
    return apiResultFromError(err);
  }
}
