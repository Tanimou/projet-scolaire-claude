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
 * Publish/edit a tutor availability slot as an admin (E7-S5, `remediation.manage`).
 *
 * Unlike the teacher path there is NO subject-ownership wall — the admin curates
 * ANY tutor's slots (teacher-linked, external, or peer); `remediation.manage` IS
 * the authority. The tutor is re-scoped to the caller's tenant (404 otherwise).
 *
 * Shape rules (re-validated in the service, not just here):
 *  - `recurring_weekly` needs `weekday` (0=Mon..6=Sun) + `startTime` ("HH:mm");
 *  - `one_off` needs `startsAt` (ISO).
 * `capacity` defaults to 1; editing it DOWN below the active-booking count on the
 * slot's next instance → deterministic 422 (the shared capacity-floor guard).
 * `active` soft-closes a slot without deleting it (its bookings/history survive).
 */
export class AdminUpsertAvailabilityDto {
  @IsIn(['recurring_weekly', 'one_off'])
  kind!: 'recurring_weekly' | 'one_off';

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
