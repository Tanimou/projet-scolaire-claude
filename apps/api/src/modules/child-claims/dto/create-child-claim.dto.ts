import { GUARDIAN_RELATIONSHIP, type GuardianRelationship } from '@pilotage/contracts';
import { IsDateString, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * E9-S1 — parent child-claim request body (`POST /parent/child-claims`).
 *
 * The api owns the validated DTO (contracts ships the Zod/TS shape). The parent
 * supplies ONLY the claimed child's identity + the relationship — `tenantId`,
 * `schoolId` and `guardianId` are NEVER accepted from the client; the server derives
 * them from the caller's own resolved Guardian (anti-IDOR / anti scope override).
 *
 * `birthDate` is optional at the type level but REQUIRED by the matcher for a name
 * match (a name-only claim always resolves to no-match). `externalRef` is the
 * alternative corroborating factor.
 */
export class CreateChildClaimDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  firstName!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  lastName!: string;

  /** ISO yyyy-mm-dd. Optional at the type level; required by the matcher for the name path. */
  @IsOptional()
  @IsDateString()
  birthDate?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  externalRef?: string;

  @IsIn(GUARDIAN_RELATIONSHIP)
  relationship!: GuardianRelationship;
}
