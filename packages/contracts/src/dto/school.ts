import { z } from 'zod';

import { SCHOOL_STATUS } from '../enums';

import { UuidSchema } from './common';

/**
 * Adresse géographique structurée d'un établissement.
 * Suit la hiérarchie : continent → pays → ville → quartier → établissement.
 * Tous les champs sont optionnels sauf `country` (code ISO 3166-1 alpha-2)
 * qui est obligatoire pour l'affichage localisé.
 */
export const SchoolAddressSchema = z.object({
  /** Continent (ex. « Europe », « Afrique ») — optionnel */
  continent: z.string().max(50).optional(),
  /** Code pays ISO 3166-1 alpha-2 (ex. « FR », « SN »). Requis. */
  country: z.string().length(2),
  /** Ville ou commune (ex. « Paris », « Dakar ») */
  city: z.string().max(100).optional(),
  /** Quartier ou arrondissement (ex. « 16ème », « Plateau ») */
  quartier: z.string().max(100).optional(),
  /** Première ligne d'adresse postale (rue, avenue, BP…) */
  line1: z.string().max(200).optional(),
  /** Code postal (ex. « 75016 ») */
  postalCode: z.string().max(20).optional(),
});

export type SchoolAddress = z.infer<typeof SchoolAddressSchema>;

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
  address: SchoolAddressSchema.nullable().optional(),
});
export type SchoolSummary = z.infer<typeof SchoolSummarySchema>;
