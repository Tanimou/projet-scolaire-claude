import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Create a tutor as an admin (E7-S5, `remediation.manage`).
 *
 * For `type:'teacher'` the `teacherProfileId` is REQUIRED and validated to exist
 * within the caller's tenant server-side; the linked teacher's `userProfileId`
 * is resolved + persisted so the S2 booking teaching-wall + notify resolve. For
 * `external`/`peer` the teacher link is forbidden (the service rejects it).
 *
 * `costKind` is a DISPLAY LABEL only — never a price (ADR-018). `published`
 * defaults false (an admin deliberately publishes — the parent-catalogue trust
 * gate). The cross-field rules (teacher link required-iff-teacher) are enforced
 * in the service, not just here.
 */
export class CreateAdminTutorDto {
  @IsIn(['teacher', 'external', 'peer'])
  type!: 'teacher' | 'external' | 'peer';

  @IsOptional()
  @IsIn(['free', 'volunteer', 'paid_offline'])
  costKind?: 'free' | 'volunteer' | 'paid_offline';

  @IsString()
  @MinLength(1)
  @MaxLength(160)
  displayName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  blurb?: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('all', { each: true })
  subjectIds!: string[];

  @IsOptional()
  @IsUUID()
  teacherProfileId?: string;

  @IsOptional()
  @IsBoolean()
  published?: boolean;
}
