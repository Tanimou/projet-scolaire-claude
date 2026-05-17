import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateBrandingDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  displayName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  primaryColor?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  accentColor?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  fontFamily?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  logoUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
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
