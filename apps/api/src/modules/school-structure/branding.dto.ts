import {
  sanitizeAssetUrl,
  sanitizeCssColor,
  sanitizeFontFamily,
  BRANDING_MAX_LENGTHS,
} from '@pilotage/contracts';
import { registerDecorator, IsOptional, IsString, MaxLength, type ValidationOptions } from 'class-validator';

/**
 * Décorateurs de validation adossés à la grammaire partagée
 * (`@pilotage/contracts` → `security/branding-css`), S-E06-2 / PF-45.
 *
 * Ils ne réimplémentent rien : chacun appelle la fonction d'assainissement et
 * exige que la valeur reçue soit **identique** à sa forme assainie. Écrire un
 * second jeu de règles ici serait la deuxième copie que le module partagé existe
 * pour éviter — et c'est la copie qui dérive, puisque celle du rendu est la
 * seule qui protège les lignes déjà en base.
 */
function matchesSanitizer(
  sanitize: (value: unknown) => string | null,
  name: string,
  message: string,
  validationOptions?: ValidationOptions,
) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name,
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          if (value === undefined || value === null) return true; // @IsOptional s'en charge
          const safe = sanitize(value);
          return safe !== null && safe === (typeof value === 'string' ? value.trim() : value);
        },
        defaultMessage() {
          return message;
        },
      },
    });
  };
}

/** Couleur CSS : hexadécimal, mot-clé, ou fonction de couleur sans imbrication. */
export const IsCssColor = (options?: ValidationOptions) =>
  matchesSanitizer(
    sanitizeCssColor,
    'isCssColor',
    'must be a CSS color (hex, keyword, or rgb/hsl/oklch/lab function) with no nested function',
    options,
  );

/** Liste `font-family` : noms alphanumériques séparés par des virgules. */
export const IsFontFamilyList = (options?: ValidationOptions) =>
  matchesSanitizer(
    sanitizeFontFamily,
    'isFontFamilyList',
    'must be a comma-separated list of font names (letters, digits, spaces, hyphens)',
    options,
  );

/** URL d'actif : `http(s)://…` absolue ou `/…` relative à la racine. */
export const IsAssetUrl = (options?: ValidationOptions) =>
  matchesSanitizer(
    sanitizeAssetUrl,
    'isAssetUrl',
    'must be an http(s) URL or a root-relative path',
    options,
  );

export class UpdateBrandingDto {
  @IsOptional()
  @IsString()
  @MaxLength(BRANDING_MAX_LENGTHS.displayName)
  displayName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(BRANDING_MAX_LENGTHS.color)
  @IsCssColor()
  primaryColor?: string;

  @IsOptional()
  @IsString()
  @MaxLength(BRANDING_MAX_LENGTHS.color)
  @IsCssColor()
  accentColor?: string;

  @IsOptional()
  @IsString()
  @MaxLength(BRANDING_MAX_LENGTHS.fontFamily)
  @IsFontFamilyList()
  fontFamily?: string;

  @IsOptional()
  @IsString()
  @MaxLength(BRANDING_MAX_LENGTHS.url)
  @IsAssetUrl()
  logoUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(BRANDING_MAX_LENGTHS.url)
  @IsAssetUrl()
  faviconUrl?: string;
}

export interface BrandingDto {
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
