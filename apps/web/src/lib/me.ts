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
    if (err instanceof ApiError && (err.status === 401 || err.status === 404)) return null;
    throw err;
  }
}

export const hasPermission = (me: MeResponse | null, code: string): boolean =>
  !!me && me.permissions.includes(code);
