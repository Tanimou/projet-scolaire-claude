import { api, ApiError } from '@/lib/api-client';
import type { StudentMeResponse } from '@pilotage/contracts';

/**
 * Fetch the learner's activation state + own header (E8-S1).
 *
 * `GET /api/v1/student/me` is the activation gate: server-resolved from the
 * caller's own `Student.userProfileId === me.id` (deny-by-default self-ABAC).
 * Returns `{ student, activated }`; an unlinked account yields
 * `{ student: null, activated: false }` — never a 500, never a peer.
 *
 * On any API error we degrade to the unlinked shape so the portal renders the
 * kind activation gate rather than crashing (a 401 still redirects to login via
 * the shared `api` helper before reaching here).
 */
export async function fetchStudentMe(): Promise<StudentMeResponse> {
  try {
    return await api<StudentMeResponse>('/api/v1/student/me', { cache: 'no-store' });
  } catch (err) {
    if (err instanceof ApiError) return { student: null, activated: false };
    throw err;
  }
}
