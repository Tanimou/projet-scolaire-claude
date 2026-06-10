'use server';

import { revalidatePath } from 'next/cache';

import { api, apiResultFromError, ApiError, type ApiResult } from '@/lib/api-client';

import type {
  ChildClaimRequestInput,
  ChildClaimSubmitResponse,
  ClaimUnavailable,
} from './claim-types';

/**
 * Parent child-claim server actions (E9-S1).
 *
 * The parent half of the enrollment self-service loop: a signed-in parent
 * self-claims their child via a deny-by-default, non-enumerating matcher
 * (`POST /api/v1/parent/child-claims`, guarded by the parent-only
 * `guardianships.claim` permission). The server NEVER auto-grants access — a
 * confident match drives a `pending` Guardianship that a human approves in S2.
 *
 * The NO-LEAK wall (FR-3/AC-2) is enforced server-side: the submit response is
 * BYTE-IDENTICAL for matched / no-match / ambiguous outcomes (`outcome:'received'`,
 * `child:null`, `claimId:null`, `status:null`). The FE simply renders that
 * uniform acknowledgement and NEVER echoes any roster-resolved data — only the
 * parent's own typed input.
 *
 * NOTE: a `'use server'` module may export ONLY async functions, so the shared
 * constants & DTO shapes live in the sibling `claim-types.ts`.
 */

const NOT_MIGRATED_COPY =
  "Le rattachement en ligne n'est pas encore disponible — contactez l'établissement.";

/** A 404/501/503 on the new route family means the backend isn't migrated/booted yet. */
function isBackendUnavailable(err: unknown): boolean {
  return err instanceof ApiError && [404, 501, 503].includes(err.status);
}

/**
 * Submit a child-claim. Returns the server's uniform response on success (the
 * caller renders the SAME acknowledgement for `received` regardless of match);
 * an `unavailable` marker when the backend isn't migrated; a plain error string
 * (rate-limit 429, validation 422/400) otherwise — surfaced as calm copy.
 */
export async function submitChildClaimAction(
  input: ChildClaimRequestInput,
): Promise<ApiResult<ChildClaimSubmitResponse> | ClaimUnavailable> {
  // Trim + drop blank optionals so the server matcher sees a clean payload.
  const body: ChildClaimRequestInput = {
    firstName: input.firstName.trim(),
    lastName: input.lastName.trim(),
    relationship: input.relationship,
  };
  const birthDate = input.birthDate?.trim();
  if (birthDate) body.birthDate = birthDate;
  const externalRef = input.externalRef?.trim();
  if (externalRef) body.externalRef = externalRef;

  try {
    const data = await api<ChildClaimSubmitResponse>('/api/v1/parent/child-claims', {
      method: 'POST',
      body,
    });
    // A successful submit may have created a pending claim → refresh the status strip.
    revalidatePath('/parent/children');
    return { ok: true, data };
  } catch (err) {
    if (isBackendUnavailable(err)) {
      return { ok: false, unavailable: true, error: NOT_MIGRATED_COPY };
    }
    return apiResultFromError(err);
  }
}

/**
 * Withdraw a still-submitted claim (parent self-scoped, the api 404s a
 * non-own / non-submitted / cross-tenant id — no leak). Idempotent: a
 * double-withdraw is a harmless no-op server-side.
 */
export async function withdrawChildClaimAction(claimId: string): Promise<ApiResult<true>> {
  try {
    await api(`/api/v1/parent/child-claims/${claimId}/withdraw`, { method: 'POST' });
    revalidatePath('/parent/children');
    return { ok: true, data: true };
  } catch (err) {
    return apiResultFromError(err);
  }
}
