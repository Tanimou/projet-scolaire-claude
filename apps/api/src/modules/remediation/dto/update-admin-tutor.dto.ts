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
 * Update / approve / retire a tutor as an admin (E7-S5, `remediation.manage`).
 *
 * `type` is IMMUTABLE post-create (omitted here). Toggling `published` is the
 * approve/retire verb: `published:true` makes the tutor parent-discoverable,
 * `published:false` retires it (the row + its slots/bookings survive). For a
 * teacher tutor the teacher link is NOT editable here (resolved at create). All
 * fields optional (partial update). `subjectIds` for a teacher tutor are
 * constrained to subjects the linked teacher currently teaches (service-side).
 */
export class UpdateAdminTutorDto {
  @IsOptional()
  @IsIn(['free', 'volunteer', 'paid_offline'])
  costKind?: 'free' | 'volunteer' | 'paid_offline';

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  displayName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  blurb?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('all', { each: true })
  subjectIds?: string[];

  @IsOptional()
  @IsBoolean()
  published?: boolean;
}
