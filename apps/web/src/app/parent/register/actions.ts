'use server';

import { ApiError } from '@/lib/api-client';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:4000';

export interface RegisterParentPayload {
  email: string;
  firstName: string;
  lastName: string;
  phone?: string;
  password: string;
  acceptTerms: boolean;
  acceptPrivacy: boolean;
  marketingOptIn: boolean;
}

/**
 * Public registration — does NOT use the auth-aware api() helper because there's no session yet.
 */
export async function registerParentAction(
  payload: RegisterParentPayload,
): Promise<{ ok: true; email: string } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${API_URL}/api/v1/auth/register-parent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { message?: string | string[] } | null;
      const msg = Array.isArray(body?.message)
        ? body!.message.join(' · ')
        : (body?.message ?? `HTTP ${res.status}`);
      throw new ApiError(res.status, body);
    }
    const data = (await res.json()) as { email: string };
    return { ok: true, email: data.email };
  } catch (err) {
    if (err instanceof ApiError) {
      const body = err.body as { message?: string | string[] } | null;
      const msg = Array.isArray(body?.message)
        ? body!.message.join(' · ')
        : (body?.message ?? `HTTP ${err.status}`);
      return { ok: false, error: msg };
    }
    return { ok: false, error: (err as Error).message };
  }
}
