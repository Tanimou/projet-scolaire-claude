'use server';

import { revalidatePath } from 'next/cache';

import { api, apiResultFromError, type ApiResult } from '@/lib/api-client';
import type { AdminTutorDto, AdminTutorAvailabilityDto } from '@pilotage/contracts';

/**
 * Admin remediation curation server actions (E7-S5 — "/admin/remediation").
 *
 * Thin `'use server'` wrappers over the new `remediation.manage`-gated admin
 * endpoints. Every wall (tenant scope, the teacher-link resolution, the
 * capacity-floor guard, the published approve/retire toggle) is enforced
 * server-side; these actions only normalise the result and revalidate ONLY the
 * admin remediation surface. The {ok}|{ok:false,error} Result mirrors
 * apps/web/src/app/admin/subjects/actions.ts (toError + isNextNavigationSignal,
 * via apiResultFromError).
 */

export interface CreateTutorInput {
  type: 'teacher' | 'external' | 'peer';
  costKind: 'free' | 'volunteer' | 'paid_offline';
  displayName: string;
  blurb?: string;
  subjectIds: string[];
  teacherProfileId?: string;
  published: boolean;
}

export interface UpdateTutorInput {
  costKind?: 'free' | 'volunteer' | 'paid_offline';
  displayName?: string;
  blurb?: string | null;
  subjectIds?: string[];
  published?: boolean;
}

export interface PublishSlotInput {
  kind: 'recurring_weekly' | 'one_off';
  weekday?: number | null;
  startTime?: string | null;
  endTime?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  capacity: number;
  active?: boolean;
}

/** Create a tenant-scoped tutor (teacher-linked or external/peer). */
export async function createTutorAction(input: CreateTutorInput): Promise<ApiResult<AdminTutorDto>> {
  try {
    const data = await api<AdminTutorDto>('/api/v1/remediation/tutors', {
      method: 'POST',
      body: input,
    });
    revalidatePath('/admin/remediation');
    return { ok: true, data };
  } catch (err) {
    return apiResultFromError(err);
  }
}

/** Edit a tutor (displayName / blurb / costKind / subjectIds). */
export async function updateTutorAction(
  tutorId: string,
  input: UpdateTutorInput,
): Promise<ApiResult<AdminTutorDto>> {
  try {
    const data = await api<AdminTutorDto>(`/api/v1/remediation/tutors/${tutorId}`, {
      method: 'PATCH',
      body: input,
    });
    revalidatePath('/admin/remediation');
    return { ok: true, data };
  } catch (err) {
    return apiResultFromError(err);
  }
}

/**
 * Publish (approve) or retire a tutor — a `published` toggle. History-preserving:
 * retire (`published:false`) removes it from the parent catalogue but never
 * deletes the row, its slots, or its bookings.
 */
export async function publishTutorAction(
  tutorId: string,
  published: boolean,
): Promise<ApiResult<AdminTutorDto>> {
  try {
    const data = await api<AdminTutorDto>(`/api/v1/remediation/tutors/${tutorId}`, {
      method: 'PATCH',
      body: { published },
    });
    revalidatePath('/admin/remediation');
    return { ok: true, data };
  } catch (err) {
    return apiResultFromError(err);
  }
}

/** Publish a new availability slot for any tutor (no subject-ownership wall). */
export async function publishSlotAction(
  tutorId: string,
  input: PublishSlotInput,
): Promise<ApiResult<AdminTutorAvailabilityDto>> {
  try {
    const data = await api<AdminTutorAvailabilityDto>(
      `/api/v1/remediation/tutors/${tutorId}/availabilities`,
      { method: 'POST', body: input },
    );
    revalidatePath('/admin/remediation');
    return { ok: true, data };
  } catch (err) {
    return apiResultFromError(err);
  }
}

/** Edit one of a tutor's availability slots (capacity-floor guarded server-side). */
export async function editSlotAction(
  tutorId: string,
  availabilityId: string,
  input: PublishSlotInput,
): Promise<ApiResult<AdminTutorAvailabilityDto>> {
  try {
    const data = await api<AdminTutorAvailabilityDto>(
      `/api/v1/remediation/tutors/${tutorId}/availabilities/${availabilityId}`,
      { method: 'PATCH', body: input },
    );
    revalidatePath('/admin/remediation');
    return { ok: true, data };
  } catch (err) {
    return apiResultFromError(err);
  }
}
