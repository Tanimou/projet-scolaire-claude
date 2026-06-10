'use server';

import { revalidatePath } from 'next/cache';

import { api, apiResultFromError, type ApiResult } from '@/lib/api-client';
import type { TeacherAvailabilityDto, TeacherBookingDto } from '@pilotage/contracts';

/**
 * Teacher remediation server actions (E7-S4 — "Mes créneaux de soutien").
 *
 * Thin `'use server'` wrappers over the new ownership-walled teacher endpoints.
 * Every wall (the caller's own tutor only, a subject they teach, the booking
 * state machine) is enforced server-side; these actions only normalise the
 * result and revalidate the teacher surface. No parent path is ever revalidated.
 */

export interface PublishSlotInput {
  kind: 'recurring_weekly' | 'one_off';
  subjectId: string;
  weekday?: number | null;
  startTime?: string | null;
  endTime?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  capacity: number;
  active?: boolean;
}

/** Publish a new availability slot on the caller's own tutor. */
export async function publishSlotAction(
  input: PublishSlotInput,
): Promise<ApiResult<TeacherAvailabilityDto>> {
  try {
    const data = await api<TeacherAvailabilityDto>('/api/v1/remediation/teacher/availabilities', {
      method: 'POST',
      body: input,
    });
    revalidatePath('/teacher/remediation');
    return { ok: true, data };
  } catch (err) {
    return apiResultFromError(err);
  }
}

/** Edit one of the caller's own availability slots (capacity / time / active). */
export async function editSlotAction(
  availabilityId: string,
  input: PublishSlotInput,
): Promise<ApiResult<TeacherAvailabilityDto>> {
  try {
    const data = await api<TeacherAvailabilityDto>(
      `/api/v1/remediation/teacher/availabilities/${availabilityId}`,
      { method: 'PATCH', body: input },
    );
    revalidatePath('/teacher/remediation');
    return { ok: true, data };
  } catch (err) {
    return apiResultFromError(err);
  }
}

/**
 * Move a booking on the caller's own tutor through the teacher lifecycle:
 * confirm / decline / honoured (`completed`) / no-show (`no_show`) / propose an
 * alternative (`proposed_alternative`, needs a note). The ownership wall + the
 * state machine are enforced server-side (404 / 409 / 422 surfaced kindly).
 */
export async function transitionBookingAction(
  bookingId: string,
  toStatus: 'confirmed' | 'declined' | 'completed' | 'no_show' | 'proposed_alternative',
  note?: string,
): Promise<ApiResult<TeacherBookingDto>> {
  try {
    const data = await api<TeacherBookingDto>(
      `/api/v1/remediation/teacher/bookings/${bookingId}/transition`,
      { method: 'PATCH', body: { toStatus, note: note?.trim() || undefined } },
    );
    revalidatePath('/teacher/remediation');
    return { ok: true, data };
  } catch (err) {
    return apiResultFromError(err);
  }
}
