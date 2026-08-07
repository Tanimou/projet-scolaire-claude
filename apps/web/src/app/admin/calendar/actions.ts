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

/**
 * Dry run of the holiday import (S-E06-6 / PF-29) — a READ. The endpoint
 * computes the plan with the same code path that writes and commits nothing:
 * no calendar event, no audit row. `confirm` is deliberately absent, so this
 * request can never write even if `dryRun` were ignored server-side.
 *
 * No `revalidatePath`: nothing changed.
 */
export async function previewFrenchHolidays(year: number): Promise<Result> {
  try {
    const data = await api('/api/v1/calendar/events/seed-french-holidays', {
      method: 'POST',
      body: { year, dryRun: true },
    });
    return { ok: true, data };
  } catch (err) {
    return toError(err);
  }
}

/**
 * Applies the holiday import. `year` is REQUIRED — the server no longer falls
 * back to the active academic year (that fallback is the "stale active year"
 * half of PF-29), so an assumed year is now a 400 rather than 22 misfiled rows.
 *
 * `confirm: true` is sent only from this confirmed path and is never defaulted
 * anywhere else (DNC-12). Note that a server action is itself a reachable
 * endpoint: the binding guarantee is server-side (the API refuses a body without
 * `confirm`), not the fact that the UI shows a drawer.
 */
export async function seedFrenchHolidays(year: number): Promise<Result> {
  try {
    const data = await api('/api/v1/calendar/events/seed-french-holidays', {
      method: 'POST',
      body: { year, confirm: true },
    });
    revalidatePath('/admin/calendar');
    return { ok: true, data };
  } catch (err) {
    return toError(err);
  }
}
