'use server';

import { revalidatePath } from 'next/cache';

import { api, apiResultFromError, type ApiResult } from '@/lib/api-client';

/**
 * Parent remediation plan-lifecycle server actions (E7-S6 — loop hardening).
 *
 * Thin `'use server'` wrappers over the kind, reversible plan-completion verbs:
 *  - `closePlanAction`  → `PATCH /remediation/plans/:id/close`  (resolution met|closed);
 *  - `reopenPlanAction` → `PATCH /remediation/plans/:id/reopen` (the reverse — completion is never a trap).
 *
 * Every wall (guardianship ABAC on the plan's student, the from-status-guarded
 * `updateMany` 409 on a concurrent double-flip, the P2002 "another open plan"
 * collapse) is enforced SERVER-side; these actions only normalise the result and
 * revalidate the parent plan surface. A 409 surfaces as a kind "déjà mise à jour"
 * message (the deterministic-409 posture), never a 500.
 */

/** Mark an OPEN plan as completed — `met` (objectif atteint) or `closed` (sans suite). */
export async function closePlanAction(
  planId: string,
  resolution: 'met' | 'closed',
): Promise<ApiResult<{ id: string; status: string; closedAt: string | null }>> {
  try {
    const data = await api<{ id: string; status: string; closedAt: string | null }>(
      `/api/v1/remediation/plans/${planId}/close`,
      { method: 'PATCH', body: { resolution } },
    );
    revalidatePath(`/parent/remediation/${planId}`);
    revalidatePath('/parent/dashboard');
    return { ok: true, data };
  } catch (err) {
    return apiResultFromError(err);
  }
}

/** Reopen a met/closed plan back to `open` (the reversible verb). */
export async function reopenPlanAction(
  planId: string,
): Promise<ApiResult<{ id: string; status: string; closedAt: string | null }>> {
  try {
    const data = await api<{ id: string; status: string; closedAt: string | null }>(
      `/api/v1/remediation/plans/${planId}/reopen`,
      { method: 'PATCH', body: {} },
    );
    revalidatePath(`/parent/remediation/${planId}`);
    revalidatePath('/parent/dashboard');
    return { ok: true, data };
  } catch (err) {
    return apiResultFromError(err);
  }
}
