'use server';

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

export async function openSession(payload: Record<string, unknown>): Promise<Result<{ id: string }>> {
  try {
    const data = await api<{ id: string }>('/api/v1/class-sessions/open', { method: 'POST', body: payload });
    return { ok: true, data };
  } catch (err) {
    return toError(err);
  }
}

export async function fetchRoster(sessionId: string): Promise<Result> {
  try {
    const data = await api(`/api/v1/class-sessions/${sessionId}/roster`, { cache: 'no-store' });
    return { ok: true, data };
  } catch (err) {
    return toError(err);
  }
}

export async function submitAttendance(classSessionId: string, records: Array<Record<string, unknown>>): Promise<Result> {
  try {
    const data = await api('/api/v1/attendance/batch', {
      method: 'POST',
      body: { classSessionId, records },
    });
    return { ok: true, data };
  } catch (err) {
    return toError(err);
  }
}
