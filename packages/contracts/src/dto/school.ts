import { z } from 'zod';

import { SCHOOL_STATUS } from '../enums';

import { UuidSchema } from './common';

export const BrandingSchema = z.object({
  schoolId: UuidSchema,
  logoUrl: z.string().url().nullable(),
  faviconUrl: z.string().url().nullable(),
  displayName: z.string(),
  primaryColor: z.string(),
  accentColor: z.string().nullable(),
  fontFamily: z.string().nullable(),
});
export type Branding = z.infer<typeof BrandingSchema>;

export const SchoolSummarySchema = z.object({
  id: UuidSchema,
  name: z.string(),
  schoolCode: z.string(),
  country: z.string().length(2),
  timezone: z.string(),
  locale: z.string(),
  status: z.enum(SCHOOL_STATUS),
});
export type SchoolSummary = z.infer<typeof SchoolSummarySchema>;
