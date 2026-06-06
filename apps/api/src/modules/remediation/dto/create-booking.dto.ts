import { IsISO8601, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

/**
 * Book-a-slot request body (E7-S2).
 *
 * The parent supplies ONLY the plan, the availability slot, and the concrete
 * dated `sessionAt` instance (plus an optional kind note). The booking's
 * `studentId` / `tutorId` / `schoolId` are derived SERVER-side from the plan
 * (planId → plan.studentId) and the availability (availabilityId →
 * availability.tutorId) — never client-supplied — exactly the S1 "parent passes
 * only the alert id" discipline.
 *
 * `sessionAt` is validated against the slot server-side (one_off: must equal the
 * slot's `startsAt`; recurring_weekly: must fall on the slot weekday at startTime)
 * and re-canonicalised before the write, so two parents booking "the same
 * instance" compute byte-identical capacity-guard keys (a mismatch is a 422).
 * Guardianship of the plan's student + the E2 teaching wall (for a teacher-linked
 * tutor) are re-checked server-side BEFORE any write.
 */
export class CreateBookingDto {
  @IsUUID()
  planId!: string;

  @IsUUID()
  availabilityId!: string;

  @IsISO8601()
  sessionAt!: string;

  @IsOptional()
  @IsString()
  @MaxLength(280)
  note?: string;
}
