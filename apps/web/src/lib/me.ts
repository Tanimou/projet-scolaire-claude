import type { MeResponse } from '@pilotage/contracts';

import { api, ApiError } from './api-client';

/**
 * S-E05-8 / PF-25 half (b) / ADR-082 §D2 — this file used to carry a SECOND,
 * hand-written copy of `MeResponseSchema` (`packages/contracts/src/dto/auth.ts`).
 * The two had ALREADY drifted: this copy declared `preferences` (which
 * `me.controller.ts` really returns) and the schema did not, and nothing failed,
 * because nothing `.parse()`s that schema. Hand-syncing them a third time —
 * inside the very slice that exists to single-source a duplicated rule — would
 * have been the `project_paired_lists_drift` shape one field over.
 *
 * So the shape is no longer copied: it is RE-EXPORTED. `@pilotage/contracts`
 * resolves `types → src/index.ts`, so this is a type-only edge with zero runtime
 * cost and no `dist` dependency (unlike the VALUE imports in `auth.ts` /
 * `middleware.ts`, which do need the built CJS).
 *
 * What changed in this slice, and what consumers must respect:
 * - `mfaEnabled: boolean | null` — `null` means NEVER MEASURED, which is not a
 *   synonym for `false`. Read it with `=== true` / `=== false` / `=== null`,
 *   never by truthiness: `{me.mfaEnabled && …}` silently renders nothing for a
 *   state that is not "off".
 * - `mfaRequired: boolean` — the invite POLICY for the holder's realm roles
 *   (ADR-004), derived with zero I/O. It is not an account fact and never says
 *   that anyone has actually configured MFA.
 */
export type { MeResponse };

export interface BrandingResponse {
  schoolId: string;
  schoolName: string;
  schoolCode: string;
  logoUrl: string | null;
  faviconUrl: string | null;
  displayName: string;
  primaryColor: string;
  accentColor: string | null;
  fontFamily: string | null;
}

export async function fetchMe(): Promise<MeResponse | null> {
  try {
    return await api<MeResponse>('/api/v1/me', { cache: 'no-store' });
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null;
    throw err;
  }
}

export async function fetchBranding(): Promise<BrandingResponse | null> {
  try {
    return await api<BrandingResponse>('/api/v1/branding/me', { cache: 'no-store' });
  } catch (err) {
    // Branding is cosmetic chrome (school name/logo/colours) — a missing or
    // forbidden branding read must NEVER crash a portal shell. Degrade to
    // defaults (null) on 401 (unauthenticated), 404 (no branding configured)
    // AND 403 (a role without `branding.read`); only a genuine 5xx propagates.
    if (err instanceof ApiError && [401, 403, 404].includes(err.status)) return null;
    throw err;
  }
}

export const hasPermission = (me: MeResponse | null, code: string): boolean =>
  !!me && me.permissions.includes(code);
