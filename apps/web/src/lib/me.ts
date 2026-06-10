import { api, ApiError } from './api-client';

export interface MeResponse {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  roles: string[];
  permissions: string[];
  locale: string;
  tenantId: string;
  schoolId: string | null;
  mfaEnabled: boolean;
  photoUrl: string | null;
  preferences?: Record<string, unknown>;
}

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
