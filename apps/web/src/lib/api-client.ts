import { redirect } from 'next/navigation';

import { auth } from '@/auth';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:4000';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(`API ${status}`);
  }
}

/**
 * Server-side fetch to the NestJS API, forwarding the session's access_token.
 * Throws ApiError on non-2xx.
 *
 * **401 handling** — when the API rejects the forwarded access token (typically
 * because it expired in Keycloak's view and NextAuth's refresh failed), we
 * trigger a redirect to the portal's login page with `?error=session_expired`.
 * This avoids the cryptic "500 Internal Server Error" the user would otherwise
 * see and forces a clean re-authentication.
 *
 * @example
 *   const me = await api<MeResponse>('/api/v1/me');
 *   const updated = await api('/api/v1/schools/abc/branding', { method: 'PATCH', body: { primaryColor: '#...' } });
 */
export async function api<T = unknown>(
  path: string,
  init: {
    method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
    body?: unknown;
    headers?: Record<string, string>;
    cache?: RequestCache;
    revalidate?: number | false;
  } = {},
): Promise<T> {
  const session = await auth();
  const accessToken = session?.accessToken;

  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(init.headers ?? {}),
  };
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;

  const next =
    init.revalidate !== undefined ? ({ revalidate: init.revalidate } as const) : undefined;

  const res = await fetch(`${API_URL}${path}`, {
    method: init.method ?? 'GET',
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    cache: init.cache,
    ...(next ? { next } : {}),
  });

  // 401 from upstream means the access token is no longer valid — either
  // expired (Keycloak rotated/idled out) or the user's session was
  // invalidated server-side. Either way, the NextAuth cookie is stale; the
  // only sane recovery is to send the user back to login.
  if (res.status === 401) {
    const portal = session?.portal ?? 'admin';
    redirect(`/${portal}/login?error=session_expired`);
  }

  if (!res.ok) {
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = await res.text().catch(() => null);
    }
    throw new ApiError(res.status, body);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/**
 * Returns the API URL for client-side fetches (no auth — use session.accessToken explicitly).
 */
export const apiUrl = (path: string) => `${API_URL}${path}`;

/**
 * True for Next.js' `redirect()` / `notFound()` exceptions. These have a
 * `digest` string starting with `NEXT_REDIRECT;…` or `NEXT_NOT_FOUND`. They
 * are intentional control-flow signals that must propagate uncaught — if a
 * server action catches them and returns a normal Result, the redirect never
 * happens and the user sees stale state.
 */
export function isNextNavigationSignal(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const digest = (err as { digest?: unknown }).digest;
  return (
    typeof digest === 'string' &&
    (digest.startsWith('NEXT_REDIRECT') || digest.startsWith('NEXT_NOT_FOUND'))
  );
}

export type ApiResult<T = unknown> = { ok: true; data: T } | { ok: false; error: string };

/**
 * Shared error→result converter for server actions. Re-throws Next.js
 * navigation signals so they reach the runtime and trigger the redirect.
 *
 * @example
 *   export async function createX(payload: …): Promise<ApiResult> {
 *     try { … return { ok: true, data }; }
 *     catch (err) { return apiResultFromError(err); }
 *   }
 */
export function apiResultFromError(err: unknown): ApiResult<never> {
  if (isNextNavigationSignal(err)) throw err;
  if (err instanceof ApiError) {
    const body = err.body as { message?: string | string[] } | null;
    const msg = Array.isArray(body?.message)
      ? body!.message.join(' · ')
      : (body?.message ?? `HTTP ${err.status}`);
    return { ok: false, error: msg };
  }
  return { ok: false, error: (err as Error).message };
}
