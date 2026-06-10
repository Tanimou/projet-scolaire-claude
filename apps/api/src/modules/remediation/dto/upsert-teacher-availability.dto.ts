import {
  IsBoolean,
  IsIn,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

/**
 * Publish/edit one of the teacher's OWN remediation availability slots (E7-S4).
 *
 * The teacher's `Tutor` record is resolved (or lazily created) SERVER-side from
 * the caller — never client-supplied — exactly the S1/S2 "the client passes only
 * the minimum" discipline. `subjectId` must be a subject the caller CURRENTLY
 * teaches (the ownership wall, re-checked server-side).
 *
 * Shape rules (re-validated in the service, not just here):
 *  - `recurring_weekly` needs `weekday` (0=Mon..6=Sun) + `startTime` ("HH:mm");
 *  - `one_off` needs `startsAt` (ISO).
 * `capacity` defaults to 1 (the FR-7 seat count); `active` soft-closes a slot
 * without deleting it (its bookings/history survive).
 */
export class UpsertTeacherAvailabilityDto {
  @IsIn(['recurring_weekly', 'one_off'])
  kind!: 'recurring_weekly' | 'one_off';

  @IsUUID()
  subjectId!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(6)
  weekday?: number | null;

  @IsOptional()
  @IsString()
  startTime?: string | null;

  @IsOptional()
  @IsString()
  endTime?: string | null;

  @IsOptional()
  @IsISO8601()
  startsAt?: string | null;

  @IsOptional()
  @IsISO8601()
  endsAt?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  capacity?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
