'use server';

import { revalidatePath } from 'next/cache';

import { api, ApiError, isNextNavigationSignal } from '@/lib/api-client';

type Result<T = unknown> = { ok: true; data: T } | { ok: false; error: string };

function toError(err: unknown): Result<never> {
  if (isNextNavigationSignal(err)) throw err;
  if (err instanceof ApiError) {
    const body = err.body as { message?: string | string[] } | null;
    const msg = Array.isArray(body?.message) ? body!.message.join(' · ') : (body?.message ?? `HTTP ${err.status}`);
    return { ok: false, error: msg };
  }
  return { ok: false, error: (err as Error).message };
}

export async function createCalendarEvent(payload: Record<string, unknown>): Promise<Result> {
  try {
    const data = await api('/api/v1/calendar/events', { method: 'POST', body: payload });
    revalidatePath('/admin/calendar');
    return { ok: true, data };
  } catch (err) {
    return toError(err);
  }
}

export async function updateCalendarEvent(
  id: string,
  payload: Record<string, unknown>,
): Promise<Result> {
  try {
    const data = await api(`/api/v1/calendar/events/${id}`, { method: 'PATCH', body: payload });
    revalidatePath('/admin/calendar');
    return { ok: true, data };
  } catch (err) {
    return toError(err);
  }
}

export async function deleteCalendarEvent(id: string): Promise<Result> {
  try {
    const data = await api(`/api/v1/calendar/events/${id}`, { method: 'DELETE' });
    revalidatePath('/admin/calendar');
    return { ok: true, data };
  } catch (err) {
    return toError(err);
  }
}

export async function seedFrenchHolidays(year?: number): Promise<Result> {
  try {
    const data = await api('/api/v1/calendar/events/seed-french-holidays', {
      method: 'POST',
      body: year ? { year } : {},
    });
    revalidatePath('/admin/calendar');
    return { ok: true, data };
  } catch (err) {
    return toError(err);
  }
}
