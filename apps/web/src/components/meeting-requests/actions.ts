'use server';

import { revalidatePath } from 'next/cache';

import { api, apiResultFromError, type ApiResult } from '@/lib/api-client';

import type { MeetingRequestPortal } from './types';

/**
 * Teacher/admin meeting-request triage server action (E1-S3).
 *
 * Hits `PATCH /api/v1/meeting-requests/:id/resolve` (gated by `alerts.write`,
 * tenant-scoped, assignee-or-admin). The backend transition is idempotent
 * (open → resolved, second call = no-op, single audit row) and stamps
 * `resolvedAt`/`resolvedBy`.
 *
 * Unlike the parent S2 intent (which deliberately does NOT revalidate to
 * preserve scroll), here the row genuinely changes section — "À traiter" →
 * "Historique" — so we DO `revalidatePath` the triage list for the calling
 * portal, per the UX spec (§5 optimistic/confirmation).
 *
 * The optional `status` body lets the same endpoint close a request without
 * follow-up ("Clôturer" → cancelled); when omitted the backend defaults to the
 * `resolved` ("Planifier un échange") transition.
 */
export async function resolveMeetingRequestAction(
  id: string,
  portal: MeetingRequestPortal,
  status: 'resolved' | 'cancelled' = 'resolved',
): Promise<ApiResult<{ ok: true }>> {
  try {
    const data = await api<{ ok: true }>(`/api/v1/meeting-requests/${id}/resolve`, {
      method: 'PATCH',
      body: { status },
    });
    revalidatePath(`/${portal}/meeting-requests`);
    return { ok: true, data };
  } catch (err) {
    return apiResultFromError(err);
  }
}
