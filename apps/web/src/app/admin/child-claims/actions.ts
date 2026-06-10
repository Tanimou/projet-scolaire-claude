'use server';

import { revalidatePath } from 'next/cache';

import { api, apiResultFromError, type ApiResult } from '@/lib/api-client';

import type { ApproveChildClaimResponse } from './types';

/**
 * Admin child-claim decision server actions (E9-S2).
 *
 * The admin half of the enrollment self-service loop. Both routes are walled by
 * `guardianships.approve` (admin-only — a parent/teacher token holding the shared
 * `guardianships.read` is 403). The backend flow is 404-before-403 / no-leak and
 * tenant-scoped: a cross-tenant claim id is indistinguishable from a missing one.
 *
 * Approve = the single from-status-guarded `pending → active` Guardianship flip
 * (the access grant). Idempotent re-approve is a server-side no-op 200; the loser
 * of two concurrent approvers gets a deterministic 409. Reject revokes the link +
 * stores a required `decisionReason`, grants nothing, and re-opens the S1
 * re-submit path. Each decision best-effort notifies the parent (the decision
 * stands even if the notification fan-out fails).
 *
 * Both actions `revalidatePath('/admin/child-claims')` so the actioned row leaves
 * the `submitted` queue.
 */

export async function approveChildClaimAction(
  claimId: string,
): Promise<ApiResult<ApproveChildClaimResponse>> {
  try {
    const data = await api<ApproveChildClaimResponse>(
      `/api/v1/admin/child-claims/${claimId}/approve`,
      { method: 'POST' },
    );
    revalidatePath('/admin/child-claims');
    return { ok: true, data };
  } catch (err) {
    return apiResultFromError(err);
  }
}

export async function rejectChildClaimAction(
  claimId: string,
  reason: string,
): Promise<ApiResult<true>> {
  try {
    await api(`/api/v1/admin/child-claims/${claimId}/reject`, {
      method: 'POST',
      body: { reason: reason.trim() },
    });
    revalidatePath('/admin/child-claims');
    return { ok: true, data: true };
  } catch (err) {
    return apiResultFromError(err);
  }
}
