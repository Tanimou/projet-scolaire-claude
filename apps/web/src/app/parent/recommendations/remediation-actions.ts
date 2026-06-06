'use server';

import { api, apiResultFromError, type ApiResult } from '@/lib/api-client';

/**
 * Parent "Trouver un soutien en {matière}" server action (E7-S1).
 *
 * Promotes an alert into a tracked `RemediationPlan` via the guardianship-ABAC
 * endpoint `POST /api/v1/remediation/plans` (gated by `remediation.book`). The
 * promote is idempotent server-side (one OPEN plan per (student, subject) — a
 * re-tap reuses the plan), so this action is safe to call repeatedly.
 *
 * Like the meeting-intent action this does NOT mutate the alert's status, so it
 * deliberately does NOT call `revalidatePath` — the caller navigates to the
 * returned plan page (`/parent/remediation/[planId]`) on success.
 */
export interface PromotedPlanResult {
  id: string;
  subjectName: string | null;
}

export async function promoteRemediationPlanAction(
  alertId: string,
): Promise<ApiResult<PromotedPlanResult>> {
  try {
    const data = await api<{ id: string; subjectName: string | null }>(
      '/api/v1/remediation/plans',
      { method: 'POST', body: { alertId } },
    );
    return { ok: true, data: { id: data.id, subjectName: data.subjectName } };
  } catch (err) {
    return apiResultFromError(err);
  }
}
